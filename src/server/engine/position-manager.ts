import { eq } from "drizzle-orm";
import type { ModeType, TradeSide, Position } from "../../shared/types.js";
import { fromSmallestUnit } from "../../shared/types.js";
import type { EventName, EventPayloadMap } from "../../shared/events.js";
import { EVENTS } from "../../shared/events.js";
import { getDb } from "../db/index.js";
import {
  positions as positionsTable,
  trades as tradesTable,
  assertSafeInteger,
} from "../db/schema.js";
import { getBlockchainClient } from "../blockchain/client.js";
import {
  openPosition as contractOpenPosition,
  closePosition as contractClosePosition,
  setStopLoss as contractSetStopLoss,
} from "../blockchain/contracts.js";
import type { ClosePositionResult } from "../blockchain/contracts.js";
import {
  shutdownInProgressError,
  modeKillSwitchedError,
  noBlockchainClientError,
  positionOpenFailedError,
  stopLossFailedError,
  stopLossOrphanedError,
  positionDbFailedError,
  positionNotFoundError,
  positionCloseFailedError,
  killSwitchInProgressError,
} from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import type { FundAllocator } from "./fund-allocator.js";

export type BroadcastFn = <E extends EventName>(
  event: E,
  data: EventPayloadMap[E],
) => void;

interface InternalPosition {
  id: number;
  chainPositionId: string; // on-chain position ID from contracts
  mode: ModeType;
  pair: string;
  side: TradeSide;
  size: number; // smallest-unit
  entryPrice: number; // smallest-unit
  stopLoss: number; // smallest-unit
  timestamp: number;
  filledSz?: string; // exact base-unit size from exchange (e.g., "0.08") — used for precise close orders
}

export interface ClosedPositionDetail {
  pair: string;
  side: TradeSide;
  entryPrice: number; // display-unit
  exitPrice: number; // display-unit
}

export interface CloseSummary {
  count: number;
  totalPnl: number; // display-unit
  positions: Position[];
  closedDetails: ClosedPositionDetail[];
}

export class PositionManager {
  private positions = new Map<number, InternalPosition>();
  private _killSwitchActive = new Set<ModeType>();
  private _modeStatus = new Map<ModeType, "active" | "kill-switch">();
  private _shuttingDown = false;
  private fundAllocator: FundAllocator;
  private broadcast: BroadcastFn;
  private readonly _onKillSwitch?: (mode: ModeType) => void;
  private readonly _onTradeRecorded?: (mode: ModeType, size: number, pnl: number) => void;

  constructor(
    fundAllocator: FundAllocator,
    broadcast: BroadcastFn,
    onKillSwitch?: (mode: ModeType) => void,
    onTradeRecorded?: (mode: ModeType, size: number, pnl: number) => void,
  ) {
    this.fundAllocator = fundAllocator;
    this.broadcast = broadcast;
    this._onKillSwitch = onKillSwitch;
    this._onTradeRecorded = onTradeRecorded;
  }

  /** Signal that shutdown is in progress — blocks new openPosition calls. */
  enterShutdown(): void {
    this._shuttingDown = true;
  }

  async openPosition(params: {
    mode: ModeType;
    pair: string;
    side: TradeSide;
    size: number; // smallest-unit
    slippage: number;
    stopLossPrice: number; // smallest-unit
  }): Promise<Position> {
    const { mode, pair, side, size, slippage, stopLossPrice } = params;

    // SAFETY: Prevent opening positions during shutdown
    if (this._shuttingDown) {
      throw shutdownInProgressError();
    }

    // SAFETY: Prevent opening positions on a kill-switched mode (race condition guard)
    if (this._killSwitchActive.has(mode) || this._modeStatus.get(mode) === "kill-switch") {
      throw modeKillSwitchedError(mode);
    }

    const client = getBlockchainClient();
    if (!client) {
      throw noBlockchainClientError();
    }

    // Step 1: Reserve funds
    this.fundAllocator.reserve(mode, size);

    // Step 2: Open position on-chain
    let openResult;
    try {
      openResult = await contractOpenPosition({
        exchange: client.exchange,
        info: client.info,
        pair,
        side,
        size,
        slippage,
        vaultAddress: client.walletAddress,
      });
    } catch (err) {
      this.fundAllocator.release(mode, size);
      logger.warn({ err, mode, pair, side, size, code: "POSITION_OPEN_FAILED" }, "Failed to open position on-chain");
      throw positionOpenFailedError(`Failed to open ${side} position on ${pair}: ${err instanceof Error ? err.message : String(err)}`);
    }

    // SAFETY: Re-check kill-switch after async open — may have fired mid-operation
    if (this._killSwitchActive.has(mode) || this._modeStatus.get(mode) === "kill-switch") {
      logger.warn({ mode, pair, positionId: openResult.positionId, code: "KILL_SWITCH_RACE" },
        "Kill-switch activated during openPosition — immediately closing just-opened position");
      try {
        await contractClosePosition({
          exchange: client.exchange,
          info: client.info,
          positionId: openResult.positionId,
          pair,
          side,
          size,
          baseSz: openResult.filledSz,
          vaultAddress: client.walletAddress,
        });
      } catch (closeErr) {
        logger.error({ err: closeErr, positionId: openResult.positionId, code: "POSITION_CLOSE_FAILED" },
          "Failed to close position after kill-switch race detection — position orphaned on-chain");
        throw modeKillSwitchedError(mode);
      }
      this.fundAllocator.release(mode, size);
      throw modeKillSwitchedError(mode);
    }

    // Step 3: Set stop-loss
    try {
      await contractSetStopLoss({
        exchange: client.exchange,
        pair,
        side,
        size,
        stopLossPrice,
        baseSz: openResult.filledSz,
        vaultAddress: client.walletAddress,
      });
    } catch (err) {
      // Rollback: close position and release funds
      logger.warn({ err, positionId: openResult.positionId, code: "STOP_LOSS_FAILED" }, "Failed to set stop-loss, closing position");
      let rollbackCloseSucceeded = false;
      try {
        await contractClosePosition({
          exchange: client.exchange,
          info: client.info,
          positionId: openResult.positionId,
          pair,
          side,
          size,
          baseSz: openResult.filledSz,
          vaultAddress: client.walletAddress,
        });
        rollbackCloseSucceeded = true;
      } catch (closeErr) {
        logger.error({ err: closeErr, positionId: openResult.positionId, code: "POSITION_CLOSE_FAILED" }, "Failed to close position during stop-loss rollback");
      }

      if (rollbackCloseSucceeded) {
        // AC#2: Stop-loss failed but rollback close succeeded — no capital at risk
        // Record the zero-PnL trade so volume/trade count are tracked for kill-switch accounting
        this.fundAllocator.recordTrade(mode, size, 0);
        this.broadcast(EVENTS.ALERT_TRIGGERED, {
          severity: "warning",
          code: "STOP_LOSS_FAILED",
          message: `Stop-loss setup failed for ${pair}. Position was automatically closed. No capital at risk.`,
          details: err instanceof Error ? err.message : String(err),
          resolution: "Retry the trade. The position was safely closed.",
          mode,
        });
      } else {
        // AC#2: Stop-loss failed AND rollback close failed — critical, on-chain stop-loss is safety net
        // Task 4.4: Keep position in DB and in-memory for crash recovery reconciliation
        const now = Date.now();
        // Add to in-memory map first so the position is always tracked even if DB insert fails
        const tempId = -(Date.now()); // negative temp ID until DB assigns real one
        this.positions.set(tempId, {
          id: tempId,
          chainPositionId: openResult.positionId,
          mode,
          pair,
          side,
          size,
          entryPrice: openResult.entryPrice,
          stopLoss: stopLossPrice,
          timestamp: now,
          filledSz: openResult.filledSz,
        });
        try {
          assertSafeInteger(size, "position.size");
          assertSafeInteger(openResult.entryPrice, "position.entryPrice");
          assertSafeInteger(stopLossPrice, "position.stopLoss");
          assertSafeInteger(now, "position.timestamp");
          const db = getDb();
          const insertResult = db
            .insert(positionsTable)
            .values({
              mode,
              pair,
              side,
              size,
              entryPrice: openResult.entryPrice,
              stopLoss: stopLossPrice,
              timestamp: now,
              chainPositionId: openResult.positionId,
              filledSz: openResult.filledSz,
            })
            .run();
          const posId = Number(insertResult.lastInsertRowid);
          // Replace temp entry with real DB ID
          this.positions.delete(tempId);
          this.positions.set(posId, {
            id: posId,
            chainPositionId: openResult.positionId,
            mode,
            pair,
            side,
            size,
            entryPrice: openResult.entryPrice,
            stopLoss: stopLossPrice,
            timestamp: now,
            filledSz: openResult.filledSz,
          });
          logger.warn({ positionId: posId, mode, pair }, "Orphaned position persisted to DB for crash recovery");
        } catch (dbErr) {
          logger.error({ err: dbErr, mode, pair, chainPositionId: openResult.positionId }, "Failed to persist orphaned position to DB — position tracked in-memory only, manual intervention required");
        }

        this.broadcast(EVENTS.ALERT_TRIGGERED, {
          severity: "critical",
          code: "STOP_LOSS_FAILED",
          message: `Stop-loss setup failed for ${pair} and rollback close also failed. On-chain stop-loss is active as safety net. Check position manually.`,
          details: `Position ID: ${openResult.positionId}. ${err instanceof Error ? err.message : String(err)}`,
          resolution: "Verify on-chain stop-loss is active. If not, manually close the position via the exchange interface.",
          mode,
        });
        // Do NOT release funds — position is still open on-chain
        throw stopLossOrphanedError(`Failed to set stop-loss for position ${openResult.positionId}: ${err instanceof Error ? err.message : String(err)}`);
      }

      this.fundAllocator.release(mode, size);
      throw stopLossFailedError(`Failed to set stop-loss for position ${openResult.positionId}: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Step 4: Insert into positions DB — rollback on-chain if DB fails
    const now = Date.now();
    assertSafeInteger(size, "position.size");
    assertSafeInteger(openResult.entryPrice, "position.entryPrice");
    assertSafeInteger(stopLossPrice, "position.stopLoss");
    assertSafeInteger(now, "position.timestamp");

    let positionId: number;
    try {
      const db = getDb();
      const insertResult = db
        .insert(positionsTable)
        .values({
          mode,
          pair,
          side,
          size,
          entryPrice: openResult.entryPrice,
          stopLoss: stopLossPrice,
          timestamp: now,
          chainPositionId: openResult.positionId,
          filledSz: openResult.filledSz,
        })
        .run();
      positionId = Number(insertResult.lastInsertRowid);
    } catch (dbErr) {
      logger.error({ err: dbErr, positionId: openResult.positionId, code: "POSITION_DB_FAILED" }, "DB insert failed after on-chain open, closing position");
      let dbRollbackCloseSucceeded = false;
      try {
        await contractClosePosition({
          exchange: client.exchange,
          info: client.info,
          positionId: openResult.positionId,
          pair,
          side,
          size,
          baseSz: openResult.filledSz,
          vaultAddress: client.walletAddress,
        });
        dbRollbackCloseSucceeded = true;
      } catch (closeErr) {
        logger.error({ err: closeErr, positionId: openResult.positionId, code: "POSITION_CLOSE_FAILED" }, "Failed to close position during DB rollback");
      }
      if (dbRollbackCloseSucceeded) {
        this.fundAllocator.release(mode, size);
        throw positionDbFailedError(dbErr instanceof Error ? dbErr.message : String(dbErr));
      }
      // Rollback close also failed — position is still open on-chain, do NOT release funds
      // Track in memory for crash recovery (DB insert already failed, so only in-memory)
      const orphanTempId = -(Date.now());
      this.positions.set(orphanTempId, {
        id: orphanTempId,
        chainPositionId: openResult.positionId,
        mode,
        pair,
        side,
        size,
        entryPrice: openResult.entryPrice,
        stopLoss: stopLossPrice,
        timestamp: now,
        filledSz: openResult.filledSz,
      });
      this.broadcast(EVENTS.ALERT_TRIGGERED, {
        severity: "critical",
        code: "POSITION_DB_FAILED",
        message: `DB insert failed for ${pair} and rollback close also failed. On-chain stop-loss is active as safety net. Check position manually.`,
        details: `Position ID: ${openResult.positionId}. ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`,
        resolution: "Verify on-chain stop-loss is active. If not, manually close the position via the exchange interface.",
        mode,
      });
      throw positionDbFailedError(dbErr instanceof Error ? dbErr.message : String(dbErr));
    }

    // Step 5: Add to in-memory map
    const internalPos: InternalPosition = {
      id: positionId,
      chainPositionId: openResult.positionId,
      mode,
      pair,
      side,
      size,
      entryPrice: openResult.entryPrice,
      stopLoss: stopLossPrice,
      timestamp: now,
      filledSz: openResult.filledSz,
    };
    this.positions.set(positionId, internalPos);

    // Step 6: Broadcast event
    this.broadcast(EVENTS.POSITION_OPENED, {
      mode,
      pair,
      side,
      size: fromSmallestUnit(size),
      entryPrice: fromSmallestUnit(openResult.entryPrice),
      stopLoss: fromSmallestUnit(stopLossPrice),
    });

    logger.info(
      { positionId, mode, pair, side, size, txHash: openResult.txHash },
      "Position opened",
    );

    // Step 7: Return display-unit Position
    return toDisplayPosition(internalPos);
  }

  async closePosition(
    positionId: number,
    opts?: { skipKillSwitchCheck?: boolean },
  ): Promise<ClosePositionResult & { position: Position }> {
    // Step 1: Look up in memory
    const pos = this.positions.get(positionId);
    if (!pos) {
      throw positionNotFoundError(positionId);
    }

    const client = getBlockchainClient();
    if (!client) {
      throw noBlockchainClientError();
    }

    // Step 2: Close on-chain
    let closeResult;
    try {
      closeResult = await contractClosePosition({
        exchange: client.exchange,
        info: client.info,
        positionId: pos.chainPositionId,
        pair: pos.pair,
        side: pos.side,
        size: pos.size,
        baseSz: pos.filledSz,
        vaultAddress: client.walletAddress,
      });
    } catch (err) {
      logger.error({ err, positionId, mode: pos.mode, code: "POSITION_CLOSE_FAILED" }, "Failed to close position on-chain");
      // AC#3: Broadcast critical alert — position remains tracked, on-chain stop-loss is safety net
      const stopLossDisplay = fromSmallestUnit(pos.stopLoss);
      this.broadcast(EVENTS.ALERT_TRIGGERED, {
        severity: "critical",
        code: "POSITION_CLOSE_FAILED",
        message: `Position close failed after retries. On-chain stop-loss at $${stopLossDisplay} is active. Monitor position on Hyperliquid dashboard.`,
        details: `Position ${positionId}: ${pos.pair} ${pos.side}. ${err instanceof Error ? err.message : String(err)}`,
        resolution: "Check blockchain connection and retry closing the position, or use kill-switch. On-chain stop-loss is your safety net.",
        mode: pos.mode,
      });
      throw positionCloseFailedError(`Failed to close position ${positionId} on-chain: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Step 3: Compute actual PnL from entry vs exit prices
    // Contract returns pnl: 0 — caller must compute from stored entryPrice
    // PnL = (exitPrice - entryPrice) / entryPrice * size for Long
    // PnL = (entryPrice - exitPrice) / entryPrice * size for Short
    const priceDiff = pos.side === "Long"
      ? closeResult.exitPrice - pos.entryPrice
      : pos.entryPrice - closeResult.exitPrice;
    const computedPnl = pos.entryPrice > 0
      ? Math.round(priceDiff / pos.entryPrice * pos.size)
      : 0;

    // Step 4: Write trade record + delete position from DB
    // Wrapped in try/catch — on-chain close already succeeded, so DB failure
    // must not leave funds locked or position stuck in memory
    const now = Date.now();
    assertSafeInteger(pos.size, "trade.size");
    assertSafeInteger(closeResult.exitPrice, "trade.price");
    assertSafeInteger(computedPnl, "trade.pnl");
    assertSafeInteger(closeResult.fees, "trade.fees");
    assertSafeInteger(now, "trade.timestamp");

    try {
      const db = getDb();
      db.insert(tradesTable)
        .values({
          mode: pos.mode,
          pair: pos.pair,
          side: pos.side,
          size: pos.size,
          price: closeResult.exitPrice,
          pnl: computedPnl,
          fees: closeResult.fees,
          timestamp: now,
        })
        .run();

      // Step 5: Delete position from DB
      db.delete(positionsTable).where(eq(positionsTable.id, positionId)).run();
    } catch (dbErr) {
      // On-chain position is already closed — log critically but continue
      // to release funds and clean up in-memory state
      logger.error(
        { dbErr, positionId, mode: pos.mode },
        "DB write failed after on-chain close — position closed but trade record may be missing",
      );
    }

    // Step 6: Remove from in-memory map
    this.positions.delete(positionId);

    // Step 7: Release funds — returnedAmount = size + pnl - fees (clamped to 0)
    const returnedAmount = Math.max(0, pos.size + computedPnl - closeResult.fees);
    this.fundAllocator.release(pos.mode, returnedAmount);

    // Step 8: Record trade stats
    this.fundAllocator.recordTrade(pos.mode, pos.size, computedPnl);

    // Step 8b: Notify session manager of trade
    this._onTradeRecorded?.(pos.mode, pos.size, computedPnl);

    // Step 9: Broadcast events
    this.broadcast(EVENTS.POSITION_CLOSED, {
      mode: pos.mode,
      pair: pos.pair,
      side: pos.side,
      size: fromSmallestUnit(pos.size),
      exitPrice: fromSmallestUnit(closeResult.exitPrice),
      pnl: fromSmallestUnit(computedPnl),
    });

    this.broadcast(EVENTS.TRADE_EXECUTED, {
      mode: pos.mode,
      pair: pos.pair,
      side: pos.side,
      size: fromSmallestUnit(pos.size),
      price: fromSmallestUnit(closeResult.exitPrice),
      pnl: fromSmallestUnit(computedPnl),
      fees: fromSmallestUnit(closeResult.fees),
    });

    this.broadcast(EVENTS.STATS_UPDATED, {
      mode: pos.mode,
      ...this.fundAllocator.getStats(pos.mode),
    });

    logger.info(
      { positionId, mode: pos.mode, pnl: computedPnl, txHash: closeResult.txHash },
      "Position closed",
    );

    // Step 10: Kill-switch check
    if (!opts?.skipKillSwitchCheck && !this._killSwitchActive.has(pos.mode)) {
      if (this.fundAllocator.checkKillSwitch(pos.mode)) {
        logger.warn({ mode: pos.mode }, "Kill switch triggered");
        this._modeStatus.set(pos.mode, "kill-switch");
        const summary = await this.closeAllForMode(pos.mode);
        // Include the triggering position (already closed above) in the details
        const triggeringDetail: ClosedPositionDetail = {
          pair: pos.pair,
          side: pos.side,
          entryPrice: fromSmallestUnit(pos.entryPrice),
          exitPrice: fromSmallestUnit(closeResult.exitPrice),
        };
        const allDetails = [triggeringDetail, ...summary.closedDetails];
        const totalClosed = summary.count + 1;
        const positionDetails = allDetails
          .map((d) => `  ${d.pair} ${d.side} @ ${d.entryPrice} → ${d.exitPrice}`)
          .join("\n");
        const triggeringPnlDisplay = fromSmallestUnit(computedPnl);
        const lossAmount = Math.abs(summary.totalPnl + triggeringPnlDisplay);
        this.broadcast(EVENTS.ALERT_TRIGGERED, {
          severity: "critical",
          code: "KILL_SWITCH_TRIGGERED",
          message: `Kill switch triggered on ${pos.mode}`,
          mode: pos.mode,
          details: `Closed ${totalClosed} positions. Loss: $${lossAmount.toFixed(2)}.\n${positionDetails}`,
          resolution: "Review positions and re-allocate funds to restart the mode.",
          positionsClosed: totalClosed,
          lossAmount,
        });
        this._onKillSwitch?.(pos.mode);
      }
    }

    // Step 11: Return
    return {
      ...closeResult,
      position: toDisplayPosition(pos),
    };
  }

  async closeAllForMode(mode: ModeType): Promise<CloseSummary> {
    this._killSwitchActive.add(mode);
    const modePositions = [...this.positions.values()].filter(
      (p) => p.mode === mode,
    );
    const closedPositions: Position[] = [];
    const closedDetails: ClosedPositionDetail[] = [];
    let totalPnl = 0;
    const failedPositionIds: number[] = [];

    for (const pos of modePositions) {
      try {
        const result = await this.closePosition(pos.id, {
          skipKillSwitchCheck: true,
        });
        closedPositions.push(result.position);
        closedDetails.push({
          pair: pos.pair,
          side: pos.side,
          entryPrice: fromSmallestUnit(pos.entryPrice),
          exitPrice: fromSmallestUnit(result.exitPrice),
        });
        totalPnl += result.pnl;
      } catch (err) {
        failedPositionIds.push(pos.id);
        logger.error(
          { err, positionId: pos.id, mode, code: "POSITION_CLOSE_FAILED" },
          "Failed to close position during closeAllForMode",
        );
      }
    }

    if (failedPositionIds.length > 0) {
      logger.error(
        { mode, failedPositionIds, failedCount: failedPositionIds.length },
        "CRITICAL: Some positions failed to close during kill-switch — manual intervention required",
      );
      this.broadcast(EVENTS.ALERT_TRIGGERED, {
        severity: "critical",
        code: "KILL_SWITCH_CLOSE_FAILED",
        message: `${failedPositionIds.length} position(s) failed to close during kill-switch on ${mode}`,
        mode,
        details: `Position IDs: ${failedPositionIds.join(", ")}. These positions remain open on-chain. On-chain stop-losses serve as safety net.`,
        resolution: "Verify on-chain stop-losses are active. If not, manually close the listed positions via the exchange interface.",
      });
    }

    // Only clear kill-switch flag when ALL positions were successfully closed.
    // If some failed, the flag stays active to prevent mode restart via resetModeStatus().
    if (failedPositionIds.length === 0) {
      this._killSwitchActive.delete(mode);
    }

    return {
      count: closedPositions.length,
      totalPnl: fromSmallestUnit(totalPnl),
      positions: closedPositions,
      closedDetails,
    };
  }

  async reconcileOnChainPositions(walletAddress: `0x${string}`): Promise<void> {
    const client = getBlockchainClient();
    const recoveredCount = this.positions.size;

    if (recoveredCount === 0) return;

    if (!client) {
      this.broadcast(EVENTS.ALERT_TRIGGERED, {
        severity: "critical",
        code: "CRASH_RECOVERY_FAILED",
        message: `Cannot verify orphaned positions — blockchain not connected. ${recoveredCount} positions from previous session found in DB. Manual verification required.`,
        details: null,
        resolution: "Connect to Hyperliquid and restart the bot to reconcile positions.",
      });
      return;
    }

    // Query on-chain clearing house state
    let assetPositions: Array<{ position: { coin: string; szi: string; entryPx: string } }>;
    try {
      const state = await client.info.clearinghouseState({ user: walletAddress });
      assetPositions = (state as { assetPositions: Array<{ position: { coin: string; szi: string; entryPx: string } }> }).assetPositions ?? [];
    } catch (err) {
      logger.error({ err }, "Failed to fetch clearing house state for crash recovery");
      this.broadcast(EVENTS.ALERT_TRIGGERED, {
        severity: "critical",
        code: "CRASH_RECOVERY_FAILED",
        message: `Failed to query on-chain positions for reconciliation. ${recoveredCount} positions remain unverified.`,
        details: err instanceof Error ? err.message : String(err),
        resolution: "Check Hyperliquid API connection and restart the bot.",
      });
      return;
    }

    // Build map of on-chain positions: coin → { szi, entryPx }
    const onChainMap = new Map<string, { szi: number; entryPx: number }>();
    for (const ap of assetPositions) {
      const szi = parseFloat(ap.position.szi);
      const entryPx = parseFloat(ap.position.entryPx);
      if (!Number.isFinite(szi) || !Number.isFinite(entryPx)) {
        logger.error({ coin: ap.position.coin, szi: ap.position.szi, entryPx: ap.position.entryPx }, "Invalid on-chain position data — skipping");
        continue;
      }
      if (szi !== 0) {
        onChainMap.set(ap.position.coin, { szi, entryPx });
      }
    }

    const db = getDb();
    let closedCount = 0;
    let cleanedCount = 0;
    const positionsToClose: number[] = [];

    // Group recovered positions by coin to handle delta-neutral netting
    const byCoin = new Map<string, InternalPosition[]>();
    for (const pos of this.positions.values()) {
      const coin = pos.pair.split("/")[0];
      const existing = byCoin.get(coin) ?? [];
      existing.push(pos);
      byCoin.set(coin, existing);
    }

    for (const [coin, dbPositions] of byCoin) {
      const onChain = onChainMap.get(coin);

      if (!onChain || Math.abs(onChain.szi) < 1e-10) {
        // Delta-neutral netting or position fully closed on-chain
        // Check for near-zero: if DB has both Long and Short for same coin
        // and on-chain szi is near zero, treat as netted
        const hasLong = dbPositions.some((p) => p.side === "Long");
        const hasShort = dbPositions.some((p) => p.side === "Short");

        if (hasLong && hasShort && onChain) {
          // Delta-neutral: both sides exist in DB, near-zero on-chain
          const minSize = Math.min(...dbPositions.map((p) => p.size));
          const sziBaseUnits = Math.abs(onChain.szi);
          const dbMinBaseUnits = minSize / 1e6 / (onChain.entryPx || 1);
          if (sziBaseUnits < dbMinBaseUnits * 0.01) {
            logger.info({ coin, positionCount: dbPositions.length }, "Delta-neutral netting detected — both sides netted on-chain");
          }
        }

        // All positions for this coin are gone on-chain — clean up
        for (const pos of dbPositions) {
          this.positions.delete(pos.id);
          try {
            db.delete(positionsTable).where(eq(positionsTable.id, pos.id)).run();
          } catch (dbErr) {
            logger.error({ dbErr, positionId: pos.id }, "Failed to delete reconciled position from DB");
          }
          // Release reserved funds — position is gone on-chain
          this.fundAllocator.release(pos.mode, pos.size);
          cleanedCount++;
        }
        continue;
      }

      // On-chain position exists — match by side
      const onChainSide: TradeSide = onChain.szi > 0 ? "Long" : "Short";
      const onChainSizeSmallest = Math.round(Math.abs(onChain.szi) * onChain.entryPx * 1e6);
      const onChainEntrySmallest = Math.round(onChain.entryPx * 1e6);

      // Only match the first same-side position — Hyperliquid reports net position per coin
      let matchedOne = false;
      for (const pos of dbPositions) {
        if (pos.side === onChainSide && !matchedOne) {
          matchedOne = true;
          // Matched — update with on-chain values and persist to DB
          pos.chainPositionId = `${coin}-${pos.side}`;
          pos.size = onChainSizeSmallest;
          pos.entryPrice = onChainEntrySmallest;
          try {
            db.update(positionsTable)
              .set({ chainPositionId: pos.chainPositionId, size: pos.size, entryPrice: pos.entryPrice })
              .where(eq(positionsTable.id, pos.id))
              .run();
          } catch (dbErr) {
            logger.error({ dbErr, positionId: pos.id }, "Failed to persist reconciled position updates to DB");
          }
          positionsToClose.push(pos.id);
        } else if (pos.side !== onChainSide || matchedOne) {
          // Wrong side — position closed or netted on-chain
          this.positions.delete(pos.id);
          try {
            db.delete(positionsTable).where(eq(positionsTable.id, pos.id)).run();
          } catch (dbErr) {
            logger.error({ dbErr, positionId: pos.id }, "Failed to delete reconciled position from DB");
          }
          // Release reserved funds — position is gone on-chain
          this.fundAllocator.release(pos.mode, pos.size);
          cleanedCount++;
        }
      }
    }

    // Close matched positions via normal close flow
    for (const posId of positionsToClose) {
      try {
        await this.closePosition(posId, { skipKillSwitchCheck: true });
        closedCount++;
      } catch (err) {
        logger.error({ err, positionId: posId }, "Failed to close reconciled position");
      }
    }

    // Broadcast recovery summary
    this.broadcast(EVENTS.ALERT_TRIGGERED, {
      severity: "warning",
      code: "CRASH_RECOVERY_COMPLETE",
      message: `Recovered ${recoveredCount} positions: ${closedCount} closed, ${cleanedCount} already gone.`,
      details: null,
      resolution: null,
    });

    logger.info(
      { recoveredCount, closedCount, cleanedCount },
      "Crash recovery reconciliation complete",
    );
  }

  async closeAllPositions(): Promise<void> {
    this._shuttingDown = true;

    // Collect distinct modes that still have positions
    const modesWithPositions = new Set<ModeType>();
    for (const pos of this.positions.values()) {
      modesWithPositions.add(pos.mode);
    }

    const failedModes: string[] = [];
    for (const mode of modesWithPositions) {
      try {
        await this.closeAllForMode(mode);
      } catch (err) {
        failedModes.push(mode);
        logger.error({ err, mode }, "Error closing positions for mode during closeAllPositions");
      }
    }

    // Surface remaining open positions so caller/logs are aware
    const remaining = this.positions.size;
    if (remaining > 0 || failedModes.length > 0) {
      logger.error(
        { remainingPositions: remaining, failedModes },
        "CRITICAL: closeAllPositions completed with positions still open — on-chain stop-losses serve as safety net",
      );
    }
  }

  getModeStatus(mode: ModeType): "active" | "kill-switch" | undefined {
    return this._modeStatus.get(mode);
  }

  resetModeStatus(mode: ModeType): void {
    if (this._killSwitchActive.has(mode)) {
      throw killSwitchInProgressError(mode);
    }
    this._modeStatus.delete(mode);
  }

  getPositions(mode?: ModeType): Position[] {
    const all = [...this.positions.values()];
    const filtered = mode ? all.filter((p) => p.mode === mode) : all;
    return filtered.map(toDisplayPosition);
  }

  /** Returns raw internal position data for fund reconciliation (smallest-unit sizes) */
  getInternalPositions(): Array<{ mode: ModeType; size: number }> {
    return [...this.positions.values()].map((p) => ({ mode: p.mode, size: p.size }));
  }

  async loadFromDb(): Promise<void> {
    const db = getDb();
    const rows = db.select().from(positionsTable).all();
    for (const row of rows) {
      this.positions.set(row.id, {
        id: row.id,
        chainPositionId: row.chainPositionId ?? `recovered-${row.id}`,
        mode: row.mode as ModeType,
        pair: row.pair,
        side: row.side as TradeSide,
        size: row.size,
        entryPrice: row.entryPrice,
        stopLoss: row.stopLoss,
        timestamp: row.timestamp,
        filledSz: row.filledSz ?? undefined,
      });
    }
    if (rows.length > 0) {
      logger.info(
        { count: rows.length },
        "Loaded positions from DB for crash recovery",
      );
    }
  }
}

function toDisplayPosition(pos: InternalPosition): Position {
  return {
    id: pos.id,
    mode: pos.mode,
    pair: pos.pair,
    side: pos.side,
    size: fromSmallestUnit(pos.size),
    entryPrice: fromSmallestUnit(pos.entryPrice),
    stopLoss: fromSmallestUnit(pos.stopLoss),
    timestamp: pos.timestamp,
  };
}
