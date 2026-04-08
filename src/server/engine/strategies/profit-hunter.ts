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
  rsiPeriod: number;
  candlePeriodMs: number;
  oversoldThreshold: number;
  overboughtThreshold: number;
  exitRsi: number;
  stopLossPct: number; // percentage (e.g., 5 = 5%)
  iterationIntervalMs: number;
  positionSize: number; // smallest-unit per position
}

const DEFAULT_RSI_PERIOD = 14;
const DEFAULT_CANDLE_PERIOD_MS = 300_000; // 5 minutes
const DEFAULT_OVERSOLD_THRESHOLD = 30;
const DEFAULT_OVERBOUGHT_THRESHOLD = 70;
const DEFAULT_EXIT_RSI = 50;
const DEFAULT_ITERATION_INTERVAL_MS = 30_000;
const DEFAULT_SLIPPAGE = 0.5;
const DEFAULT_STOP_LOSS_PCT = 5; // 5% — wider than old 3% to match RSI's 70-min signal timeframe
const MIN_POSITION_SIZE = 10_000_000; // $10 in smallest-unit — Hyperliquid minimum order value

export class ProfitHunterStrategy extends ModeRunner {
  private readonly config: ProfitHunterConfig;
  private readonly oracleClient: OracleClient;
  private readonly dynamicPositionSize: boolean;
  private iterationCount = 0;

  get strategyName() { return "Profit Hunter"; }
  get strategyDescription() { return "Mean-reversion strategy using RSI signals on 5-minute candles."; }
  get defaultConfig(): Record<string, unknown> { return { rsiPeriod: DEFAULT_RSI_PERIOD, oversoldThreshold: DEFAULT_OVERSOLD_THRESHOLD, overboughtThreshold: DEFAULT_OVERBOUGHT_THRESHOLD, exitRsi: DEFAULT_EXIT_RSI, stopLossPct: DEFAULT_STOP_LOSS_PCT, iterationIntervalMs: DEFAULT_ITERATION_INTERVAL_MS, slippage: DEFAULT_SLIPPAGE }; }
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

    const oversold = config.oversoldThreshold ?? DEFAULT_OVERSOLD_THRESHOLD;
    const overbought = config.overboughtThreshold ?? DEFAULT_OVERBOUGHT_THRESHOLD;

    if (oversold < 0 || oversold > 100) {
      throw invalidStrategyConfigError(mode, "oversoldThreshold must be between 0 and 100");
    }
    if (overbought < 0 || overbought > 100) {
      throw invalidStrategyConfigError(mode, "overboughtThreshold must be between 0 and 100");
    }
    if (oversold >= overbought) {
      throw invalidStrategyConfigError(mode, "oversoldThreshold must be less than overboughtThreshold");
    }

    const exit = config.exitRsi ?? DEFAULT_EXIT_RSI;
    if (exit <= oversold || exit >= overbought) {
      throw invalidStrategyConfigError(mode, "exitRsi must be between oversoldThreshold and overboughtThreshold");
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
      rsiPeriod: config.rsiPeriod ?? DEFAULT_RSI_PERIOD,
      candlePeriodMs: config.candlePeriodMs ?? DEFAULT_CANDLE_PERIOD_MS,
      oversoldThreshold: oversold,
      overboughtThreshold: overbought,
      exitRsi: config.exitRsi ?? DEFAULT_EXIT_RSI,
      stopLossPct: config.stopLossPct ?? DEFAULT_STOP_LOSS_PCT,
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

    // Phase 1: Check existing positions for close signals (RSI mean-reversion exit)
    const openPositions = this.positionManager.getPositions(this.mode);

    for (const position of openPositions) {
      const oracleKey = this.pairToOracleKey(position.pair);
      if (!this.oracleClient.isAvailable(oracleKey)) {
        activity.push({ pair: position.pair, signalValue: null, oracleStatus: "stale", outcome: "held", size: null, side: position.side });
        reportedPairs.add(position.pair);
        continue;
      }

      const rsi = this.oracleClient.getRsi(oracleKey, this.config.rsiPeriod);

      if (rsi === null) {
        activity.push({ pair: position.pair, signalValue: null, oracleStatus: "warming-up", outcome: "held", size: null, side: position.side });
        reportedPairs.add(position.pair);
        continue;
      }

      // Close Long when RSI crosses above exitRsi (mean reverted)
      // Close Short when RSI crosses below exitRsi (mean reverted)
      const shouldClose =
        (position.side === "Long" && rsi > this.config.exitRsi) ||
        (position.side === "Short" && rsi < this.config.exitRsi);

      if (shouldClose) {
        try {
          await this.positionManager.closePosition(position.id);
          logger.info(
            { mode: this.mode, pair: position.pair, rsi, side: position.side },
            "Closed position — RSI mean-reverted",
          );
          activity.push({ pair: position.pair, signalValue: rsi, oracleStatus: "ok", outcome: "closed-reverted", size: position.size, side: position.side });
        } catch (err) {
          logger.error(
            { err, mode: this.mode, positionId: position.id },
            "Failed to close reverted position",
          );
          activity.push({ pair: position.pair, signalValue: rsi, oracleStatus: "ok", outcome: "close-failed", size: null, side: position.side });
        }
      } else {
        activity.push({ pair: position.pair, signalValue: rsi, oracleStatus: "ok", outcome: "held", size: null, side: position.side });
      }
      reportedPairs.add(position.pair);
    }

    // Phase 2: Scan for new entry signals
    const currentPositions = this.positionManager.getPositions(this.mode);
    const openPairs = new Set(currentPositions.map((p) => p.pair));

    for (const pair of this.config.pairs) {
      if (openPairs.has(pair)) {
        if (!reportedPairs.has(pair)) {
          activity.push({ pair, signalValue: null, oracleStatus: "ok", outcome: "skipped-has-position", size: null, side: null });
        }
        continue;
      }

      const oracleKey = this.pairToOracleKey(pair);
      if (!this.oracleClient.isAvailable(oracleKey)) {
        const err = profitHunterStaleOracleError(pair);
        logger.info({ mode: this.mode, pair, code: err.code }, err.message);
        if (!reportedPairs.has(pair)) {
          activity.push({ pair, signalValue: null, oracleStatus: "stale", outcome: "skipped-stale", size: null, side: null });
        }
        continue;
      }

      const rsi = this.oracleClient.getRsi(oracleKey, this.config.rsiPeriod);

      if (rsi === null) {
        activity.push({ pair, signalValue: null, oracleStatus: "warming-up", outcome: "skipped-warming", size: null, side: null });
        continue;
      }

      // Determine signal
      let side: "Long" | "Short" | null = null;
      if (rsi < this.config.oversoldThreshold) {
        side = "Long"; // oversold → expect bounce
      } else if (rsi > this.config.overboughtThreshold) {
        side = "Short"; // overbought → expect pullback
      }

      if (!side) {
        activity.push({ pair, signalValue: rsi, oracleStatus: "ok", outcome: "no-signal", size: null, side: null });
        continue;
      }

      const size = this.getPositionSize();

      if (!this.fundAllocator.canAllocate(this.mode, size)) {
        logger.info({ mode: this.mode, pair }, "Insufficient funds, skipping");
        activity.push({ pair, signalValue: rsi, oracleStatus: "ok", outcome: "skipped-no-funds", size: null, side });
        continue;
      }

      const price = this.oracleClient.getPrice(oracleKey);
      if (price === null || price === 0) {
        activity.push({ pair, signalValue: rsi, oracleStatus: "warming-up", outcome: "skipped-warming", size: null, side: null });
        continue;
      }

      const stopLossFactor = this.config.stopLossPct / 100;
      const stopLossPrice = side === "Long"
        ? Math.floor(price * (1 - stopLossFactor))
        : Math.floor(price * (1 + stopLossFactor));

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
          { mode: this.mode, pair, side, rsi },
          "Opened position on RSI signal",
        );
        activity.push({ pair, signalValue: rsi, oracleStatus: "ok", outcome: side === "Long" ? "opened-long" : "opened-short", size, side });
      } catch (err) {
        logger.error(
          { err, mode: this.mode, pair, side },
          "Failed to open position",
        );
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

  private sortPairsWithBoostedFirst(pairs: string[]): string[] {
    return [...pairs];
  }
}

// Self-registration
strategyRegistry.registerStrategy({
  name: "Profit Hunter",
  description: "Mean-reversion strategy using RSI signals on 5-minute candles.",
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
