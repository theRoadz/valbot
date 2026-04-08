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
} from "../../lib/errors.js";
import { EVENTS, type ActivityPairEntry } from "../../../shared/events.js";

export interface MomentumConfig {
  pairs: string[];
  fastEmaPeriod: number;
  slowEmaPeriod: number;
  rsiPeriod: number;
  trailingStopPct: number;
  iterationIntervalMs: number;
  slippage: number;
  positionSize: number; // smallest-unit per position
}

const DEFAULT_FAST_EMA_PERIOD = 9;
const DEFAULT_SLOW_EMA_PERIOD = 21;
const DEFAULT_RSI_PERIOD = 14;
const DEFAULT_TRAILING_STOP_PCT = 0.03;
const DEFAULT_ITERATION_INTERVAL_MS = 30_000;
const DEFAULT_SLIPPAGE = 0.5;
const MIN_POSITION_SIZE = 10_000_000; // $10 in smallest-unit

interface CrossoverState {
  prevFastAboveSlow: boolean | null;
}

interface TrailingStopState {
  peakPrice: number; // high watermark (Long) or low watermark (Short)
}

export class MomentumStrategy extends ModeRunner {
  private readonly config: MomentumConfig;
  private readonly oracleClient: OracleClient;
  private readonly dynamicPositionSize: boolean;
  private iterationCount = 0;
  private crossoverState = new Map<string, CrossoverState>();
  private trailingStops = new Map<number, TrailingStopState>();

  get strategyName() { return "Momentum"; }
  get strategyDescription() { return "Trend-following strategy using EMA crossovers with RSI confirmation."; }
  get defaultConfig(): Record<string, unknown> {
    return {
      fastEmaPeriod: DEFAULT_FAST_EMA_PERIOD,
      slowEmaPeriod: DEFAULT_SLOW_EMA_PERIOD,
      rsiPeriod: DEFAULT_RSI_PERIOD,
      trailingStopPct: DEFAULT_TRAILING_STOP_PCT,
      iterationIntervalMs: DEFAULT_ITERATION_INTERVAL_MS,
      slippage: DEFAULT_SLIPPAGE,
    };
  }
  get modeColor() { return "#f97316"; }
  get urlSlug() { return "momentum"; }

  constructor(
    fundAllocator: FundAllocator,
    positionManager: PositionManager,
    broadcast: BroadcastFn,
    oracleClient: OracleClient,
    config: Partial<MomentumConfig> & { pairs: string[] },
  ) {
    const mode: ModeType = "momentum";
    super(mode, fundAllocator, positionManager, broadcast);

    if (!config.pairs.length) {
      throw invalidStrategyConfigError(mode, "requires at least one trading pair");
    }

    const fast = config.fastEmaPeriod ?? DEFAULT_FAST_EMA_PERIOD;
    const slow = config.slowEmaPeriod ?? DEFAULT_SLOW_EMA_PERIOD;

    if (fast >= slow) {
      throw invalidStrategyConfigError(mode, "fastEmaPeriod must be less than slowEmaPeriod");
    }

    const trailingStopPct = config.trailingStopPct ?? DEFAULT_TRAILING_STOP_PCT;
    if (trailingStopPct <= 0) {
      throw invalidStrategyConfigError(mode, "trailingStopPct must be greater than 0");
    }

    this.oracleClient = oracleClient;
    this.dynamicPositionSize = config.positionSize === undefined;

    const allocation = fundAllocator.getAllocation(mode).allocation;
    if (allocation < MIN_POSITION_SIZE) {
      throw invalidStrategyConfigError(mode, "allocation must be at least $10");
    }

    this.config = {
      pairs: [...config.pairs],
      fastEmaPeriod: fast,
      slowEmaPeriod: slow,
      rsiPeriod: config.rsiPeriod ?? DEFAULT_RSI_PERIOD,
      trailingStopPct,
      iterationIntervalMs: config.iterationIntervalMs ?? DEFAULT_ITERATION_INTERVAL_MS,
      slippage: config.slippage ?? DEFAULT_SLIPPAGE,
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
    const closedThisIteration = new Set<string>(); // prevent close-then-reopen whipsaw

    // Phase 1: Manage existing positions (trailing stop + reverse crossover close)
    const openPositions = this.positionManager.getPositions(this.mode);

    // Reconcile trailing stop state — prune entries for positions closed externally
    const openIds = new Set(openPositions.map((p) => p.id));
    for (const posId of this.trailingStops.keys()) {
      if (!openIds.has(posId)) this.trailingStops.delete(posId);
    }

    for (const position of openPositions) {
      const oracleKey = this.pairToOracleKey(position.pair);

      if (!this.oracleClient.isAvailable(oracleKey)) {
        activity.push({ pair: position.pair, signalValue: null, oracleStatus: "stale", outcome: "held", size: null, side: position.side });
        reportedPairs.add(position.pair);
        continue;
      }

      const fastEma = this.oracleClient.getEma(oracleKey, this.config.fastEmaPeriod);
      const slowEma = this.oracleClient.getEma(oracleKey, this.config.slowEmaPeriod);

      if (fastEma === null || slowEma === null) {
        activity.push({ pair: position.pair, signalValue: null, oracleStatus: "warming-up", outcome: "held", size: null, side: position.side });
        reportedPairs.add(position.pair);
        continue;
      }

      // Check reverse crossover → close
      const fastAboveSlow = fastEma > slowEma;
      const shouldClose =
        (position.side === "Long" && !fastAboveSlow) ||
        (position.side === "Short" && fastAboveSlow);

      if (shouldClose) {
        try {
          // Clean up trailing stop state
          this.trailingStops.delete(position.id);
          await this.positionManager.closePosition(position.id);
          logger.info(
            { mode: this.mode, pair: position.pair, side: position.side },
            "Closed position — reverse EMA crossover",
          );
          activity.push({ pair: position.pair, signalValue: null, oracleStatus: "ok", outcome: "closed-crossover", size: position.size, side: position.side });
          closedThisIteration.add(position.pair);
        } catch (err) {
          logger.error({ err, mode: this.mode, positionId: position.id }, "Failed to close position on reverse crossover");
          activity.push({ pair: position.pair, signalValue: null, oracleStatus: "ok", outcome: "close-failed", size: null, side: position.side });
        }
        reportedPairs.add(position.pair);
        continue;
      }

      // Trailing stop update
      const price = this.oracleClient.getPrice(oracleKey);
      if (price !== null && price > 0) {
        let stopState = this.trailingStops.get(position.id);
        if (!stopState) {
          // Initialize from current price
          stopState = { peakPrice: price };
          this.trailingStops.set(position.id, stopState);
        }

        let peakUpdated = false;
        if (position.side === "Long" && price > stopState.peakPrice) {
          stopState.peakPrice = price;
          peakUpdated = true;
        } else if (position.side === "Short" && price < stopState.peakPrice) {
          stopState.peakPrice = price;
          peakUpdated = true;
        }

        if (peakUpdated) {
          const newStop = position.side === "Long"
            ? Math.floor(stopState.peakPrice * (1 - this.config.trailingStopPct))
            : Math.ceil(stopState.peakPrice * (1 + this.config.trailingStopPct));

          try {
            await this.positionManager.updateStopLoss(position.id, newStop);
            activity.push({ pair: position.pair, signalValue: null, oracleStatus: "ok", outcome: "stop-updated", size: null, side: position.side });
          } catch (err) {
            logger.error({ err, mode: this.mode, positionId: position.id }, "Failed to update trailing stop");
            activity.push({ pair: position.pair, signalValue: null, oracleStatus: "ok", outcome: "held", size: null, side: position.side });
          }
          reportedPairs.add(position.pair);
          continue;  // ← ensures no duplicate activity entry from fallthrough
        }
      }

      activity.push({ pair: position.pair, signalValue: null, oracleStatus: "ok", outcome: "held", size: null, side: position.side });
      reportedPairs.add(position.pair);
    }

    // Phase 2: Scan for new entry signals (EMA crossover + RSI confirmation)
    const currentPositions = this.positionManager.getPositions(this.mode);
    const openPairs = new Set(currentPositions.map((p) => p.pair));

    for (const pair of this.config.pairs) {
      // Skip pairs closed this iteration to prevent close-then-reopen whipsaw
      if (closedThisIteration.has(pair)) continue;

      if (openPairs.has(pair)) {
        if (!reportedPairs.has(pair)) {
          activity.push({ pair, signalValue: null, oracleStatus: "ok", outcome: "skipped-has-position", size: null, side: null });
        }
        continue;
      }

      const oracleKey = this.pairToOracleKey(pair);

      if (!this.oracleClient.isAvailable(oracleKey)) {
        if (!reportedPairs.has(pair)) {
          activity.push({ pair, signalValue: null, oracleStatus: "stale", outcome: "skipped-stale", size: null, side: null });
        }
        continue;
      }

      const fastEma = this.oracleClient.getEma(oracleKey, this.config.fastEmaPeriod);
      const slowEma = this.oracleClient.getEma(oracleKey, this.config.slowEmaPeriod);

      if (fastEma === null || slowEma === null) {
        activity.push({ pair, signalValue: null, oracleStatus: "warming-up", outcome: "skipped-warming", size: null, side: null });
        continue;
      }

      const fastAboveSlow = fastEma > slowEma;
      let state = this.crossoverState.get(pair);
      if (!state) {
        state = { prevFastAboveSlow: null };
        this.crossoverState.set(pair, state);
      }

      // Detect crossover (relationship changed since last check)
      const prevAbove = state.prevFastAboveSlow;
      state.prevFastAboveSlow = fastAboveSlow;

      if (prevAbove === null || prevAbove === fastAboveSlow) {
        // No crossover this iteration (first check or same relationship)
        const rsi = this.oracleClient.getRsi(oracleKey, this.config.rsiPeriod);
        activity.push({ pair, signalValue: rsi, oracleStatus: "ok", outcome: "no-signal", size: null, side: null });
        continue;
      }

      // Crossover detected — check RSI confirmation
      const rsi = this.oracleClient.getRsi(oracleKey, this.config.rsiPeriod);
      if (rsi === null) {
        activity.push({ pair, signalValue: null, oracleStatus: "warming-up", outcome: "skipped-warming", size: null, side: null });
        continue;
      }

      let side: "Long" | "Short" | null = null;
      if (fastAboveSlow && rsi > 50) {
        side = "Long"; // bullish crossover + RSI confirms
      } else if (!fastAboveSlow && rsi < 50) {
        side = "Short"; // bearish crossover + RSI confirms
      }

      if (!side) {
        // Crossover but RSI doesn't confirm
        activity.push({ pair, signalValue: rsi, oracleStatus: "ok", outcome: "no-signal", size: null, side: null });
        continue;
      }

      const size = this.getPositionSize();

      if (!this.fundAllocator.canAllocate(this.mode, size)) {
        activity.push({ pair, signalValue: rsi, oracleStatus: "ok", outcome: "skipped-no-funds", size: null, side });
        continue;
      }

      const price = this.oracleClient.getPrice(oracleKey);
      if (price === null || price === 0) {
        activity.push({ pair, signalValue: rsi, oracleStatus: "warming-up", outcome: "skipped-warming", size: null, side: null });
        continue;
      }

      // Initial stop-loss at trailingStopPct from entry
      const stopLossPrice = side === "Long"
        ? Math.floor(price * (1 - this.config.trailingStopPct))
        : Math.ceil(price * (1 + this.config.trailingStopPct));

      try {
        const position = await this.positionManager.openPosition({
          mode: this.mode,
          pair,
          side,
          size,
          slippage: this.config.slippage,
          stopLossPrice,
        });
        // Initialize trailing stop state with entry price
        this.trailingStops.set(position.id, { peakPrice: price });
        logger.info(
          { mode: this.mode, pair, side, rsi },
          "Opened position on EMA crossover + RSI confirmation",
        );
        activity.push({ pair, signalValue: rsi, oracleStatus: "ok", outcome: side === "Long" ? "opened-long" : "opened-short", size, side });
      } catch (err) {
        logger.error({ err, mode: this.mode, pair, side }, "Failed to open momentum position");
        activity.push({ pair, signalValue: rsi, oracleStatus: "ok", outcome: "open-failed", size: null, side });
      }
    }

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
      return pair;
    }
    return `${parts[0]}-PERP`;
  }
}

// Self-registration
strategyRegistry.registerStrategy({
  name: "Momentum",
  description: "Trend-following strategy using EMA crossovers with RSI confirmation.",
  modeType: "momentum",
  urlSlug: "momentum",
  modeColor: "#f97316",
  requires: { oracle: true },
  factory: (deps: StrategyDeps) => {
    if (!deps.oracleClient) {
      throw new AppError({
        severity: "critical",
        code: "MISSING_DEPENDENCY",
        message: "Momentum strategy requires oracleClient dependency",
        resolution: "Ensure oracle is available before starting Momentum.",
      });
    }
    return new MomentumStrategy(
      deps.fundAllocator,
      deps.positionManager,
      deps.broadcast,
      deps.oracleClient,
      { pairs: deps.config.pairs, slippage: deps.config.slippage, positionSize: deps.config.positionSize },
    );
  },
});
