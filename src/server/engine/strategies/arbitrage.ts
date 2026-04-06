import type { ModeType } from "../../../shared/types.js";
import type { FundAllocator } from "../fund-allocator.js";
import type { PositionManager } from "../position-manager.js";
import type { OracleClient } from "../../blockchain/oracle.js";
import { ModeRunner, type BroadcastFn } from "../mode-runner.js";
import { logger } from "../../lib/logger.js";
import {
  invalidStrategyConfigError,
  arbitrageMidPriceError,
} from "../../lib/errors.js";

export interface ArbitrageConfig {
  pairs: string[];
  slippage: number;
  spreadThreshold: number;
  closeSpreadThreshold: number;
  iterationIntervalMs: number;
  positionSize: number; // smallest-unit per position
}

const DEFAULT_SPREAD_THRESHOLD = 0.005; // 0.5% spread to open
const DEFAULT_CLOSE_SPREAD_THRESHOLD = 0.001; // 0.1% spread to close
const DEFAULT_ITERATION_INTERVAL_MS = 3_000; // 3s — arb windows close quickly
const DEFAULT_SLIPPAGE = 0.5;
const STOP_LOSS_FACTOR = 0.03; // 3% stop-loss distance
const MIN_POSITION_SIZE = 10_000_000; // $10 in smallest-unit
const TAKER_FEE_RATE = 0.00025; // 0.025% Hyperliquid taker fee

export class ArbitrageStrategy extends ModeRunner {
  private readonly config: ArbitrageConfig;
  private readonly oracleClient: OracleClient;
  private readonly getMidPriceFn: (coin: string) => Promise<number>;
  private readonly dynamicPositionSize: boolean;

  constructor(
    fundAllocator: FundAllocator,
    positionManager: PositionManager,
    broadcast: BroadcastFn,
    oracleClient: OracleClient,
    getMidPrice: (coin: string) => Promise<number>,
    config: Partial<ArbitrageConfig> & { pairs: string[] },
  ) {
    const mode: ModeType = "arbitrage";
    super(mode, fundAllocator, positionManager, broadcast);

    if (!config.pairs.length) {
      throw invalidStrategyConfigError(mode, "requires at least one trading pair");
    }

    if (config.spreadThreshold !== undefined && (!(config.spreadThreshold > 0))) {
      throw invalidStrategyConfigError(mode, "spreadThreshold must be a positive number");
    }

    if (config.closeSpreadThreshold !== undefined && (!(config.closeSpreadThreshold > 0))) {
      throw invalidStrategyConfigError(mode, "closeSpreadThreshold must be a positive number");
    }

    if (config.slippage !== undefined && (!(config.slippage >= 0))) {
      throw invalidStrategyConfigError(mode, "slippage must be a non-negative number");
    }

    if (config.positionSize !== undefined && config.positionSize < MIN_POSITION_SIZE) {
      throw invalidStrategyConfigError(mode, `positionSize must be at least ${MIN_POSITION_SIZE} ($$10)`);
    }

    const effectiveSpread = config.spreadThreshold ?? DEFAULT_SPREAD_THRESHOLD;
    const effectiveClose = config.closeSpreadThreshold ?? DEFAULT_CLOSE_SPREAD_THRESHOLD;
    if (effectiveClose >= effectiveSpread) {
      throw invalidStrategyConfigError(
        mode,
        "closeSpreadThreshold must be less than spreadThreshold to avoid open-then-close churn",
      );
    }

    const minProfitableSpread = 2 * TAKER_FEE_RATE;
    if (effectiveSpread < minProfitableSpread) {
      throw invalidStrategyConfigError(
        mode,
        `spreadThreshold (${effectiveSpread}) must be >= 2x taker fee (${minProfitableSpread}) for profitable trades`,
      );
    }

    this.oracleClient = oracleClient;
    this.getMidPriceFn = getMidPrice;
    this.dynamicPositionSize = config.positionSize === undefined;

    const allocation = fundAllocator.getAllocation(mode).allocation;
    if (allocation < MIN_POSITION_SIZE) {
      throw invalidStrategyConfigError(mode, "allocation must be at least $10");
    }

    this.config = {
      pairs: [...config.pairs],
      slippage: config.slippage ?? DEFAULT_SLIPPAGE,
      spreadThreshold: effectiveSpread,
      closeSpreadThreshold: effectiveClose,
      iterationIntervalMs: config.iterationIntervalMs ?? DEFAULT_ITERATION_INTERVAL_MS,
      positionSize: config.positionSize ?? Math.max(MIN_POSITION_SIZE, Math.floor(allocation / 20)),
    };
  }

  getIntervalMs(): number {
    return this.config.iterationIntervalMs;
  }

  async executeIteration(): Promise<void> {
    // Step 1: Check existing positions for close signals (spread convergence)
    const openPositions = this.positionManager.getPositions(this.mode);

    for (const position of openPositions) {
      const oracleKey = this.pairToOracleKey(position.pair);
      if (!this.oracleClient.isAvailable(oracleKey)) {
        continue; // Don't close on stale data
      }

      const oraclePrice = this.oracleClient.getPrice(oracleKey);
      if (oraclePrice === null || oraclePrice === 0) {
        continue;
      }

      let midPriceSmallest: number;
      try {
        const midFloat = await this.getMidPriceFn(this.pairToCoin(position.pair));
        midPriceSmallest = Math.round(midFloat * 1_000_000);
      } catch {
        continue; // Skip close check if mid-price unavailable
      }

      if (midPriceSmallest === 0) {
        continue;
      }

      const spread = (oraclePrice - midPriceSmallest) / midPriceSmallest;

      if (Math.abs(spread) <= this.config.closeSpreadThreshold) {
        try {
          await this.positionManager.closePosition(position.id);
          logger.info(
            { mode: this.mode, pair: position.pair, spread },
            "Closed position — spread converged",
          );
        } catch (err) {
          logger.error(
            { err, mode: this.mode, positionId: position.id },
            "Failed to close converged position",
          );
        }
      }
    }

    // Step 2: Scan for new entry signals
    const currentPositions = this.positionManager.getPositions(this.mode);
    const openPairs = new Set(currentPositions.map((p) => p.pair));

    for (const pair of this.config.pairs) {
      // Skip if position already open on this pair
      if (openPairs.has(pair)) {
        continue;
      }

      const oracleKey = this.pairToOracleKey(pair);
      if (!this.oracleClient.isAvailable(oracleKey)) {
        logger.info({ mode: this.mode, pair }, `Oracle unavailable for ${pair}, skipping`);
        continue;
      }

      const oraclePrice = this.oracleClient.getPrice(oracleKey);
      if (oraclePrice === null || oraclePrice === 0) {
        continue;
      }

      // Fetch Hyperliquid mid-price (async REST call)
      let midPriceSmallest: number;
      try {
        const midFloat = await this.getMidPriceFn(this.pairToCoin(pair));
        midPriceSmallest = Math.round(midFloat * 1_000_000);
      } catch (err) {
        const appErr = arbitrageMidPriceError(pair);
        logger.warn({ mode: this.mode, pair, code: appErr.code, err }, appErr.message);
        continue;
      }

      if (midPriceSmallest === 0) {
        continue;
      }

      const spread = (oraclePrice - midPriceSmallest) / midPriceSmallest;

      // No signal if within threshold
      if (Math.abs(spread) <= this.config.spreadThreshold) {
        continue;
      }

      // Arbitrage direction: oracle > mid → Long (perp underpriced, expect rise)
      // oracle < mid → Short (perp overpriced, expect fall)
      const side = oraclePrice > midPriceSmallest ? "Long" : "Short";
      const size = this.getPositionSize();

      // Fund check before every open
      if (!this.fundAllocator.canAllocate(this.mode, size)) {
        logger.info({ mode: this.mode, pair }, "Insufficient funds, skipping");
        continue;
      }

      // Calculate stop-loss based on mid-price (execution reference)
      const stopLossPrice = side === "Long"
        ? Math.floor(midPriceSmallest * (1 - STOP_LOSS_FACTOR))
        : Math.floor(midPriceSmallest * (1 + STOP_LOSS_FACTOR));

      try {
        await this.positionManager.openPosition({
          mode: this.mode,
          pair,
          side,
          size,
          slippage: this.config.slippage,
          stopLossPrice,
        });
        logger.info(
          { mode: this.mode, pair, side, spread },
          "Opened position on arbitrage spread signal",
        );
      } catch (err) {
        logger.error(
          { err, mode: this.mode, pair, side },
          "Failed to open position",
        );
      }
    }
  }

  private getPositionSize(): number {
    if (!this.dynamicPositionSize) {
      return this.config.positionSize;
    }
    const { allocation } = this.fundAllocator.getAllocation(this.mode);
    return Math.max(MIN_POSITION_SIZE, Math.floor(allocation / 20));
  }

  private pairToOracleKey(pair: string): string {
    const parts = pair.split("/");
    if (parts.length < 2 || !parts[0]) {
      logger.warn({ mode: this.mode, pair }, "Malformed pair format — expected 'COIN/QUOTE'");
      return pair;
    }
    return `${parts[0]}-PERP`;
  }

  private pairToCoin(pair: string): string {
    return pair.split("/")[0] ?? pair;
  }
}
