import type { ModeType } from "../../../shared/types.js";
import type { FundAllocator } from "../fund-allocator.js";
import type { PositionManager } from "../position-manager.js";
import type { OracleClient } from "../../blockchain/oracle.js";
import { ModeRunner, type BroadcastFn } from "../mode-runner.js";
import { logger } from "../../lib/logger.js";
import {
  invalidStrategyConfigError,
  profitHunterStaleOracleError,
} from "../../lib/errors.js";

export interface ProfitHunterConfig {
  pairs: string[];
  slippage: number;
  deviationThreshold: number;
  closeThreshold: number;
  iterationIntervalMs: number;
  positionSize: number; // smallest-unit per position
}

const DEFAULT_DEVIATION_THRESHOLD = 0.01;
const DEFAULT_CLOSE_THRESHOLD = 0.003;
const DEFAULT_ITERATION_INTERVAL_MS = 5_000;
const DEFAULT_SLIPPAGE = 0.5;
const STOP_LOSS_FACTOR = 0.03;
const MIN_POSITION_SIZE = 10_000_000; // $10 in smallest-unit — Hyperliquid minimum order value

export class ProfitHunterStrategy extends ModeRunner {
  private readonly config: ProfitHunterConfig;
  private readonly oracleClient: OracleClient;
  private readonly dynamicPositionSize: boolean;

  constructor(
    fundAllocator: FundAllocator,
    positionManager: PositionManager,
    broadcast: BroadcastFn,
    oracleClient: OracleClient,
    config: Partial<ProfitHunterConfig> & { pairs: string[] },
  ) {
    const mode: ModeType = "profitHunter";
    super(mode, fundAllocator, positionManager, broadcast);

    if (!config.pairs.length) {
      throw invalidStrategyConfigError(mode, "requires at least one trading pair");
    }

    if (config.deviationThreshold !== undefined && config.deviationThreshold <= 0) {
      throw invalidStrategyConfigError(mode, "deviationThreshold must be positive");
    }

    if (config.closeThreshold !== undefined && config.closeThreshold <= 0) {
      throw invalidStrategyConfigError(mode, "closeThreshold must be positive");
    }

    const effectiveDeviation = config.deviationThreshold ?? DEFAULT_DEVIATION_THRESHOLD;
    const effectiveClose = config.closeThreshold ?? DEFAULT_CLOSE_THRESHOLD;
    if (effectiveClose >= effectiveDeviation) {
      throw invalidStrategyConfigError(
        mode,
        "closeThreshold must be less than deviationThreshold to avoid open-then-close churn",
      );
    }

    this.oracleClient = oracleClient;
    this.dynamicPositionSize = config.positionSize === undefined;

    const allocation = fundAllocator.getAllocation(mode).allocation;
    if (allocation < MIN_POSITION_SIZE) {
      throw invalidStrategyConfigError(mode, "allocation must be at least $10");
    }

    this.config = {
      pairs: this.sortPairsWithBoostedFirst(config.pairs),
      slippage: config.slippage ?? DEFAULT_SLIPPAGE,
      deviationThreshold: config.deviationThreshold ?? DEFAULT_DEVIATION_THRESHOLD,
      closeThreshold: config.closeThreshold ?? DEFAULT_CLOSE_THRESHOLD,
      iterationIntervalMs: config.iterationIntervalMs ?? DEFAULT_ITERATION_INTERVAL_MS,
      positionSize: config.positionSize ?? Math.max(MIN_POSITION_SIZE, Math.floor(allocation / 20)),
    };
  }

  getIntervalMs(): number {
    return this.config.iterationIntervalMs;
  }

  async executeIteration(): Promise<void> {
    // Step 1: Check existing positions for close signals
    const openPositions = this.positionManager.getPositions(this.mode);

    for (const position of openPositions) {
      const oracleKey = this.pairToOracleKey(position.pair);
      if (!this.oracleClient.isAvailable(oracleKey)) {
        continue;
      }

      const price = this.oracleClient.getPrice(oracleKey);
      const ma = this.oracleClient.getMovingAverage(oracleKey);

      if (price === null || price === 0 || ma === null || ma === 0) {
        continue;
      }

      const deviation = (price - ma) / ma;

      if (Math.abs(deviation) <= this.config.closeThreshold) {
        try {
          await this.positionManager.closePosition(position.id);
          logger.info(
            { mode: this.mode, pair: position.pair, deviation },
            "Closed position — price reverted to MA",
          );
        } catch (err) {
          logger.error(
            { err, mode: this.mode, positionId: position.id },
            "Failed to close reverted position",
          );
        }
      }
    }

    // Step 2: Scan for new entry signals
    // Re-fetch positions after closes to get current state
    const currentPositions = this.positionManager.getPositions(this.mode);
    const openPairs = new Set(currentPositions.map((p) => p.pair));

    for (const pair of this.config.pairs) {
      // Skip if position already open on this pair
      if (openPairs.has(pair)) {
        continue;
      }

      // Skip if oracle unavailable for this pair
      const oracleKey = this.pairToOracleKey(pair);
      if (!this.oracleClient.isAvailable(oracleKey)) {
        const err = profitHunterStaleOracleError(pair);
        logger.info({ mode: this.mode, pair, code: err.code }, err.message);
        continue;
      }

      const price = this.oracleClient.getPrice(oracleKey);
      const ma = this.oracleClient.getMovingAverage(oracleKey);

      if (price === null || ma === null) {
        // MA requires ~30s of data after connect — normal warm-up, not an error
        continue;
      }

      if (price === 0 || ma === 0) {
        continue;
      }

      const deviation = (price - ma) / ma;

      // No signal if within threshold
      if (Math.abs(deviation) <= this.config.deviationThreshold) {
        continue;
      }

      // Mean-reversion direction: short if price > MA, long if price < MA
      const side = price < ma ? "Long" : "Short";
      const size = this.getPositionSize();

      // Fund check before every open
      if (!this.fundAllocator.canAllocate(this.mode, size)) {
        logger.info({ mode: this.mode, pair }, "Insufficient funds, skipping");
        continue;
      }

      // Calculate stop-loss
      const stopLossPrice = side === "Long"
        ? Math.floor(price * (1 - STOP_LOSS_FACTOR))
        : Math.floor(price * (1 + STOP_LOSS_FACTOR));

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
          { mode: this.mode, pair, side, deviation },
          "Opened position on deviation signal",
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
      return pair; // return as-is; isAvailable() will return false
    }
    return `${parts[0]}-PERP`;
  }

  private sortPairsWithBoostedFirst(pairs: string[]): string[] {
    return [...pairs];
  }
}
