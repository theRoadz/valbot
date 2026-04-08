import type { ModeType } from "../../../shared/types.js";
import type { FundAllocator } from "../fund-allocator.js";
import type { PositionManager } from "../position-manager.js";
import type { OracleClient } from "../../blockchain/oracle.js";
import { ModeRunner, type BroadcastFn } from "../mode-runner.js";
import { strategyRegistry, type StrategyDeps } from "../strategy-registry.js";
import { logger } from "../../lib/logger.js";
import {
  AppError,
  invalidStrategyConfigError,
  profitHunterStaleOracleError,
} from "../../lib/errors.js";
import { EVENTS, type ActivityPairEntry } from "../../../shared/events.js";

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
  private iterationCount = 0;

  get strategyName() { return "Profit Hunter"; }
  get strategyDescription() { return "Mean-reversion strategy using Pyth oracle price vs moving average deviation signals."; }
  get defaultConfig(): Record<string, unknown> { return { deviationThreshold: DEFAULT_DEVIATION_THRESHOLD, closeThreshold: DEFAULT_CLOSE_THRESHOLD, iterationIntervalMs: DEFAULT_ITERATION_INTERVAL_MS, slippage: DEFAULT_SLIPPAGE }; }
  get modeColor() { return "#22c55e"; }
  get urlSlug() { return "profit-hunter"; }

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
    this.iterationCount++;
    const activity: ActivityPairEntry[] = [];
    const reportedPairs = new Set<string>();

    // Step 1: Check existing positions for close signals
    const openPositions = this.positionManager.getPositions(this.mode);

    for (const position of openPositions) {
      const oracleKey = this.pairToOracleKey(position.pair);
      if (!this.oracleClient.isAvailable(oracleKey)) {
        activity.push({ pair: position.pair, deviationPct: null, oracleStatus: "stale", outcome: "held", size: null, side: position.side });
        reportedPairs.add(position.pair);
        continue;
      }

      const price = this.oracleClient.getPrice(oracleKey);
      const ma = this.oracleClient.getMovingAverage(oracleKey);

      if (price === null || price === 0 || ma === null || ma === 0) {
        activity.push({ pair: position.pair, deviationPct: null, oracleStatus: "warming-up", outcome: "held", size: null, side: position.side });
        reportedPairs.add(position.pair);
        continue;
      }

      const deviation = (price - ma) / ma;
      const deviationPct = deviation * 100;

      if (Math.abs(deviation) <= this.config.closeThreshold) {
        try {
          await this.positionManager.closePosition(position.id);
          logger.info(
            { mode: this.mode, pair: position.pair, deviation },
            "Closed position — price reverted to MA",
          );
          activity.push({ pair: position.pair, deviationPct, oracleStatus: "ok", outcome: "closed-reverted", size: position.size, side: position.side });
        } catch (err) {
          logger.error(
            { err, mode: this.mode, positionId: position.id },
            "Failed to close reverted position",
          );
          activity.push({ pair: position.pair, deviationPct, oracleStatus: "ok", outcome: "close-failed", size: null, side: position.side });
        }
      } else {
        activity.push({ pair: position.pair, deviationPct, oracleStatus: "ok", outcome: "held", size: null, side: position.side });
      }
      reportedPairs.add(position.pair);
    }

    // Step 2: Scan for new entry signals
    // Re-fetch positions after closes to get current state
    const currentPositions = this.positionManager.getPositions(this.mode);
    const openPairs = new Set(currentPositions.map((p) => p.pair));

    for (const pair of this.config.pairs) {
      // Skip if position already open on this pair
      if (openPairs.has(pair)) {
        if (!reportedPairs.has(pair)) {
          activity.push({ pair, deviationPct: null, oracleStatus: "ok", outcome: "skipped-has-position", size: null, side: null });
        }
        continue;
      }

      // Skip if oracle unavailable for this pair
      const oracleKey = this.pairToOracleKey(pair);
      if (!this.oracleClient.isAvailable(oracleKey)) {
        const err = profitHunterStaleOracleError(pair);
        logger.info({ mode: this.mode, pair, code: err.code }, err.message);
        if (!reportedPairs.has(pair)) {
          activity.push({ pair, deviationPct: null, oracleStatus: "stale", outcome: "skipped-stale", size: null, side: null });
        }
        continue;
      }

      const price = this.oracleClient.getPrice(oracleKey);
      const ma = this.oracleClient.getMovingAverage(oracleKey);

      if (price === null || ma === null) {
        // MA requires ~30s of data after connect — normal warm-up, not an error
        activity.push({ pair, deviationPct: null, oracleStatus: "warming-up", outcome: "skipped-warming", size: null, side: null });
        continue;
      }

      if (price === 0 || ma === 0) {
        activity.push({ pair, deviationPct: null, oracleStatus: "warming-up", outcome: "skipped-warming", size: null, side: null });
        continue;
      }

      const deviation = (price - ma) / ma;
      const deviationPct = deviation * 100;

      // No signal if within threshold
      if (Math.abs(deviation) <= this.config.deviationThreshold) {
        activity.push({ pair, deviationPct, oracleStatus: "ok", outcome: "no-signal", size: null, side: null });
        continue;
      }

      // Mean-reversion direction: short if price > MA, long if price < MA
      const side = price < ma ? "Long" : "Short";
      const size = this.getPositionSize();

      // Fund check before every open
      if (!this.fundAllocator.canAllocate(this.mode, size)) {
        logger.info({ mode: this.mode, pair }, "Insufficient funds, skipping");
        activity.push({ pair, deviationPct, oracleStatus: "ok", outcome: "skipped-no-funds", size: null, side });
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
        activity.push({ pair, deviationPct, oracleStatus: "ok", outcome: side === "Long" ? "opened-long" : "opened-short", size, side });
      } catch (err) {
        logger.error(
          { err, mode: this.mode, pair, side },
          "Failed to open position",
        );
        activity.push({ pair, deviationPct, oracleStatus: "ok", outcome: "open-failed", size: null, side });
      }
    }

    // Broadcast iteration activity summary (skip if no pairs processed)
    if (activity.length > 0) {
      this.broadcast(EVENTS.MODE_ACTIVITY, {
        mode: this.mode,
        iteration: this.iterationCount,
        pairs: activity,
      });
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

// Self-registration
strategyRegistry.registerStrategy({
  name: "Profit Hunter",
  description: "Mean-reversion strategy using Pyth oracle price vs moving average deviation signals.",
  modeType: "profitHunter",
  urlSlug: "profit-hunter",
  modeColor: "#22c55e",
  requires: { oracle: true },
  factory: (deps: StrategyDeps) => {
    if (!deps.oracleClient) {
      throw new AppError({
        severity: "critical",
        code: "MISSING_DEPENDENCY",
        message: "Profit Hunter strategy requires oracleClient dependency",
        resolution: "Ensure oracle is available before starting Profit Hunter.",
      });
    }
    return new ProfitHunterStrategy(
      deps.fundAllocator,
      deps.positionManager,
      deps.broadcast,
      deps.oracleClient,
      { pairs: deps.config.pairs, slippage: deps.config.slippage, positionSize: deps.config.positionSize },
    );
  },
});
