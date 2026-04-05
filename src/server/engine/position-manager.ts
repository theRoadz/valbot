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
import { AppError } from "../lib/errors.js";
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
}

export interface CloseSummary {
  count: number;
  totalPnl: number; // display-unit
  positions: Position[];
}

export class PositionManager {
  private positions = new Map<number, InternalPosition>();
  private _killSwitchActive = new Set<ModeType>();
  private _modeStatus = new Map<ModeType, "active" | "kill-switch">();
  private fundAllocator: FundAllocator;
  private broadcast: BroadcastFn;

  constructor(fundAllocator: FundAllocator, broadcast: BroadcastFn) {
    this.fundAllocator = fundAllocator;
    this.broadcast = broadcast;
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

    const client = getBlockchainClient();
    if (!client) {
      throw new AppError({
        severity: "critical",
        code: "NO_BLOCKCHAIN_CLIENT",
        message: "Blockchain client not initialized",
        resolution: "Check Hyperliquid API connection and restart the bot.",
      });
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
      });
    } catch (err) {
      this.fundAllocator.release(mode, size);
      logger.error({ err, mode, pair, side, size }, "Failed to open position on-chain");
      throw new AppError({
        severity: "warning",
        code: "POSITION_OPEN_FAILED",
        message: `Failed to open ${side} position on ${pair}`,
        details: err instanceof Error ? err.message : String(err),
        resolution: "Check blockchain connection and retry.",
      });
    }

    // Step 3: Set stop-loss
    try {
      await contractSetStopLoss({
        exchange: client.exchange,
        pair,
        side,
        size,
        stopLossPrice,
      });
    } catch (err) {
      // Rollback: close position and release funds
      logger.error({ err, positionId: openResult.positionId }, "Failed to set stop-loss, closing position");
      try {
        await contractClosePosition({
          exchange: client.exchange,
          info: client.info,
          positionId: openResult.positionId,
          pair,
          side,
          size,
        });
      } catch (closeErr) {
        logger.error({ closeErr, positionId: openResult.positionId }, "Failed to close position during rollback");
      }
      this.fundAllocator.release(mode, size);
      throw new AppError({
        severity: "warning",
        code: "STOP_LOSS_FAILED",
        message: `Failed to set stop-loss for position ${openResult.positionId}`,
        details: err instanceof Error ? err.message : String(err),
        resolution: "Position was closed to prevent orphaned positions. Retry the trade.",
      });
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
        })
        .run();
      positionId = Number(insertResult.lastInsertRowid);
    } catch (dbErr) {
      logger.error({ dbErr, positionId: openResult.positionId }, "DB insert failed after on-chain open, closing position");
      try {
        await contractClosePosition({
          exchange: client.exchange,
          info: client.info,
          positionId: openResult.positionId,
          pair,
          side,
          size,
        });
      } catch (closeErr) {
        logger.error({ closeErr, positionId: openResult.positionId }, "Failed to close position during DB rollback");
      }
      this.fundAllocator.release(mode, size);
      throw new AppError({
        severity: "critical",
        code: "POSITION_DB_FAILED",
        message: `Position opened on-chain but DB insert failed — position was closed`,
        details: dbErr instanceof Error ? dbErr.message : String(dbErr),
        resolution: "Check database health and retry the trade.",
      });
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
      throw new AppError({
        severity: "warning",
        code: "POSITION_NOT_FOUND",
        message: `Position ${positionId} not found`,
        resolution: "Check position ID and try again.",
      });
    }

    const client = getBlockchainClient();
    if (!client) {
      throw new AppError({
        severity: "critical",
        code: "NO_BLOCKCHAIN_CLIENT",
        message: "Blockchain client not initialized",
        resolution: "Check Hyperliquid API connection and restart the bot.",
      });
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
      });
    } catch (err) {
      logger.error({ err, positionId, mode: pos.mode }, "Failed to close position on-chain");
      throw new AppError({
        severity: "critical",
        code: "POSITION_CLOSE_FAILED",
        message: `Failed to close position ${positionId} on-chain`,
        details: err instanceof Error ? err.message : String(err),
        resolution: "Position remains open. Check blockchain connection and retry, or use kill-switch.",
      });
    }

    // Step 3: Write trade record + delete position from DB
    // Wrapped in try/catch — on-chain close already succeeded, so DB failure
    // must not leave funds locked or position stuck in memory
    const now = Date.now();
    assertSafeInteger(pos.size, "trade.size");
    assertSafeInteger(closeResult.exitPrice, "trade.price");
    assertSafeInteger(closeResult.pnl, "trade.pnl");
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
          pnl: closeResult.pnl,
          fees: closeResult.fees,
          timestamp: now,
        })
        .run();

      // Step 4: Delete position from DB
      db.delete(positionsTable).where(eq(positionsTable.id, positionId)).run();
    } catch (dbErr) {
      // On-chain position is already closed — log critically but continue
      // to release funds and clean up in-memory state
      logger.error(
        { dbErr, positionId, mode: pos.mode },
        "DB write failed after on-chain close — position closed but trade record may be missing",
      );
    }

    // Step 5: Remove from in-memory map
    this.positions.delete(positionId);

    // Step 6: Release funds — returnedAmount = size + pnl - fees (clamped to 0)
    const returnedAmount = Math.max(0, pos.size + closeResult.pnl - closeResult.fees);
    this.fundAllocator.release(pos.mode, returnedAmount);

    // Step 7: Record trade stats
    this.fundAllocator.recordTrade(pos.mode, pos.size, closeResult.pnl);

    // Step 8: Broadcast events
    this.broadcast(EVENTS.POSITION_CLOSED, {
      mode: pos.mode,
      pair: pos.pair,
      side: pos.side,
      size: fromSmallestUnit(pos.size),
      exitPrice: fromSmallestUnit(closeResult.exitPrice),
      pnl: fromSmallestUnit(closeResult.pnl),
    });

    this.broadcast(EVENTS.TRADE_EXECUTED, {
      mode: pos.mode,
      pair: pos.pair,
      side: pos.side,
      size: fromSmallestUnit(pos.size),
      price: fromSmallestUnit(closeResult.exitPrice),
      pnl: fromSmallestUnit(closeResult.pnl),
      fees: fromSmallestUnit(closeResult.fees),
    });

    this.broadcast(EVENTS.STATS_UPDATED, {
      mode: pos.mode,
      ...this.fundAllocator.getStats(pos.mode),
    });

    logger.info(
      { positionId, mode: pos.mode, pnl: closeResult.pnl, txHash: closeResult.txHash },
      "Position closed",
    );

    // Step 9: Kill-switch check
    if (!opts?.skipKillSwitchCheck && !this._killSwitchActive.has(pos.mode)) {
      if (this.fundAllocator.checkKillSwitch(pos.mode)) {
        logger.warn({ mode: pos.mode }, "Kill switch triggered");
        this._modeStatus.set(pos.mode, "kill-switch");
        const summary = await this.closeAllForMode(pos.mode);
        this.broadcast(EVENTS.ALERT_TRIGGERED, {
          severity: "critical",
          code: "KILL_SWITCH_TRIGGERED",
          message: `Kill switch triggered on ${pos.mode}`,
          mode: pos.mode,
          details: `Closed ${summary.count} positions. Loss: $${Math.abs(summary.totalPnl).toFixed(2)}.`,
          resolution: "Review positions and re-allocate funds to restart the mode.",
        });
      }
    }

    // Step 10: Return
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
    let totalPnl = 0;

    for (const pos of modePositions) {
      try {
        const result = await this.closePosition(pos.id, {
          skipKillSwitchCheck: true,
        });
        closedPositions.push(result.position);
        // Compute actual PnL from entry vs exit price (contracts returns pnl: 0)
        // PnL = size * (exit - entry) / entry for Long, inverted for Short
        const priceDelta = result.exitPrice - pos.entryPrice;
        const rawPnl = pos.entryPrice !== 0
          ? Math.round(pos.size * priceDelta / pos.entryPrice)
          : 0;
        totalPnl += pos.side === "Long" ? rawPnl : -rawPnl;
      } catch (err) {
        logger.error(
          { err, positionId: pos.id, mode },
          "Failed to close position during closeAllForMode",
        );
      }
    }

    this._killSwitchActive.delete(mode);

    return {
      count: closedPositions.length,
      totalPnl: fromSmallestUnit(totalPnl),
      positions: closedPositions,
    };
  }

  getModeStatus(mode: ModeType): "active" | "kill-switch" | undefined {
    return this._modeStatus.get(mode);
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
        chainPositionId: `recovered-${row.id}`, // on-chain ID not persisted; Story 3.2 will reconcile
        mode: row.mode as ModeType,
        pair: row.pair,
        side: row.side as TradeSide,
        size: row.size,
        entryPrice: row.entryPrice,
        stopLoss: row.stopLoss,
        timestamp: row.timestamp,
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
