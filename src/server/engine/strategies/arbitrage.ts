import type { ModeType } from "../../../shared/types.js";
import type { FundAllocator } from "../fund-allocator.js";
import type { PositionManager } from "../position-manager.js";
import { ModeRunner, type BroadcastFn } from "../mode-runner.js";
import { strategyRegistry, type StrategyDeps } from "../strategy-registry.js";
import { logger } from "../../lib/logger.js";
import {
  AppError,
  invalidStrategyConfigError,
} from "../../lib/errors.js";

export interface FundingArbitrageConfig {
  pairs: string[];
  slippage: number;
  rateThreshold: number;
  closeRateThreshold: number;
  minHoldTimeMs: number;
  iterationIntervalMs: number;
  positionSize: number; // smallest-unit per position
}

const DEFAULT_RATE_THRESHOLD = 0.0001; // 0.01% funding rate to open
const DEFAULT_CLOSE_RATE_THRESHOLD = 0.00005; // 0.005% to close
const DEFAULT_MIN_HOLD_TIME_MS = 3_600_000; // 1 hour — at least one funding payment
const DEFAULT_ITERATION_INTERVAL_MS = 30_000; // 30s — rates change slowly
const DEFAULT_SLIPPAGE = 0.5;
const STOP_LOSS_FACTOR = 0.02; // 2% stop-loss distance
const MIN_POSITION_SIZE = 10_000_000; // $10 in smallest-unit

export class ArbitrageStrategy extends ModeRunner {
  private readonly config: FundingArbitrageConfig;
  private readonly getPredictedFundingsFn: () => Promise<Map<string, { rate: number; nextFundingTime: number }>>;
  private readonly getMidPriceFn?: (coin: string) => Promise<number>;
  private readonly dynamicPositionSize: boolean;
  private readonly positionOpenTimes = new Map<string, number>(); // pair → timestamp
  private _stopped = false;

  get strategyName() { return "Funding Rate Arbitrage"; }
  get strategyDescription() { return "Collects hourly funding payments by positioning on the receiving side of Hyperliquid perpetuals."; }
  get defaultConfig(): Record<string, unknown> { return { rateThreshold: DEFAULT_RATE_THRESHOLD, closeRateThreshold: DEFAULT_CLOSE_RATE_THRESHOLD, minHoldTimeMs: DEFAULT_MIN_HOLD_TIME_MS, iterationIntervalMs: DEFAULT_ITERATION_INTERVAL_MS, slippage: DEFAULT_SLIPPAGE }; }
  get modeColor() { return "#a855f7"; }
  get urlSlug() { return "arbitrage"; }

  constructor(
    fundAllocator: FundAllocator,
    positionManager: PositionManager,
    broadcast: BroadcastFn,
    getPredictedFundings: () => Promise<Map<string, { rate: number; nextFundingTime: number }>>,
    config: Partial<FundingArbitrageConfig> & { pairs: string[] },
    getMidPrice?: (coin: string) => Promise<number>,
  ) {
    const mode: ModeType = "arbitrage";
    super(mode, fundAllocator, positionManager, broadcast);

    if (!config.pairs.length) {
      throw invalidStrategyConfigError(mode, "requires at least one trading pair");
    }

    if (config.rateThreshold !== undefined && (!(config.rateThreshold > 0))) {
      throw invalidStrategyConfigError(mode, "rateThreshold must be a positive number");
    }

    if (config.closeRateThreshold !== undefined && (!(config.closeRateThreshold > 0))) {
      throw invalidStrategyConfigError(mode, "closeRateThreshold must be a positive number");
    }

    if (config.slippage !== undefined && (!(config.slippage >= 0))) {
      throw invalidStrategyConfigError(mode, "slippage must be a non-negative number");
    }

    if (config.positionSize !== undefined && config.positionSize < MIN_POSITION_SIZE) {
      throw invalidStrategyConfigError(mode, `positionSize must be at least ${MIN_POSITION_SIZE} ($$10)`);
    }

    const effectiveRate = config.rateThreshold ?? DEFAULT_RATE_THRESHOLD;
    const effectiveClose = config.closeRateThreshold ?? DEFAULT_CLOSE_RATE_THRESHOLD;
    if (effectiveClose >= effectiveRate) {
      throw invalidStrategyConfigError(
        mode,
        "closeRateThreshold must be less than rateThreshold to avoid open-then-close churn",
      );
    }

    this.getPredictedFundingsFn = getPredictedFundings;
    this.getMidPriceFn = getMidPrice;
    this.dynamicPositionSize = config.positionSize === undefined;

    const allocation = fundAllocator.getAllocation(mode).allocation;
    if (allocation < MIN_POSITION_SIZE) {
      throw invalidStrategyConfigError(mode, "allocation must be at least $10");
    }

    this.config = {
      pairs: [...config.pairs],
      slippage: config.slippage ?? DEFAULT_SLIPPAGE,
      rateThreshold: effectiveRate,
      closeRateThreshold: effectiveClose,
      minHoldTimeMs: config.minHoldTimeMs ?? DEFAULT_MIN_HOLD_TIME_MS,
      iterationIntervalMs: config.iterationIntervalMs ?? DEFAULT_ITERATION_INTERVAL_MS,
      positionSize: config.positionSize ?? Math.max(MIN_POSITION_SIZE, Math.floor(allocation / 20)),
    };
  }

  protected override onStop(): void {
    this._stopped = true;
  }

  getIntervalMs(): number {
    return this.config.iterationIntervalMs;
  }

  async executeIteration(): Promise<void> {
    // Fetch predicted funding rates
    let fundingRates: Map<string, { rate: number; nextFundingTime: number }>;
    try {
      fundingRates = await this.getPredictedFundingsFn();
    } catch (err) {
      logger.warn({ err, mode: this.mode }, "Failed to fetch predicted funding rates");
      return;
    }

    if (fundingRates.size === 0) {
      logger.warn({ mode: this.mode }, "Predicted funding rates empty — no data from API");
    }

    // Phase 1: Check existing positions for close signals (rate flip or drop)
    const openPositions = this.positionManager.getPositions(this.mode);

    // Clean up positionOpenTimes for positions closed externally (stop-loss, liquidation, kill switch)
    const openPairSet = new Set(openPositions.map((p) => p.pair));
    for (const pair of this.positionOpenTimes.keys()) {
      if (!openPairSet.has(pair)) {
        this.positionOpenTimes.delete(pair);
      }
    }

    for (const position of openPositions) {
      const coin = this.pairToCoin(position.pair);
      const funding = fundingRates.get(coin);

      if (!funding) {
        continue; // No rate data — keep position
      }

      const now = Date.now();
      const openTime = this.positionOpenTimes.get(position.pair) ?? position.timestamp;

      // Respect minimum hold time — wait for at least one funding payment
      if (now - openTime < this.config.minHoldTimeMs) {
        continue;
      }

      // Close if rate flipped sign (Long should have negative rate, Short should have positive rate)
      const rateFlipped = (position.side === "Short" && funding.rate < 0) ||
                          (position.side === "Long" && funding.rate > 0);

      // Close if rate dropped below close threshold
      const rateTooLow = Math.abs(funding.rate) < this.config.closeRateThreshold;

      if (rateFlipped || rateTooLow) {
        try {
          await this.positionManager.closePosition(position.id);
          this.positionOpenTimes.delete(position.pair);
          logger.info(
            { mode: this.mode, pair: position.pair, rate: funding.rate, rateFlipped, rateTooLow },
            "Closed position — funding rate signal expired",
          );
        } catch (err) {
          logger.error(
            { err, mode: this.mode, positionId: position.id },
            "Failed to close position",
          );
        }
      }
    }

    // Bail if stopped during Phase 1
    if (this._stopped) return;

    // Phase 2: Scan for new entry signals
    const currentPositions = this.positionManager.getPositions(this.mode);
    const openPairs = new Set(currentPositions.map((p) => p.pair));

    for (const pair of this.config.pairs) {
      if (openPairs.has(pair)) {
        continue;
      }

      const coin = this.pairToCoin(pair);
      const funding = fundingRates.get(coin);

      if (!funding) {
        continue;
      }

      const absRate = Math.abs(funding.rate);
      if (absRate < this.config.rateThreshold) {
        continue;
      }

      // Positive rate: longs pay shorts → go Short to collect
      // Negative rate: shorts pay longs → go Long to collect
      const side = funding.rate > 0 ? "Short" : "Long";
      const size = this.getPositionSize();

      if (!this.fundAllocator.canAllocate(this.mode, size)) {
        logger.info({ mode: this.mode, pair }, "Insufficient funds, skipping");
        continue;
      }

      // Bail if stopped during iteration
      if (this._stopped) return;

      // Calculate stop-loss using mid-price as reference (2% distance)
      let stopLossPrice: number;
      if (this.getMidPriceFn) {
        try {
          const midFloat = await this.getMidPriceFn(coin);
          if (!Number.isFinite(midFloat) || midFloat <= 0) {
            logger.warn({ mode: this.mode, pair, midFloat }, "Invalid mid-price for stop-loss, skipping");
            continue;
          }
          const midSmallest = Math.round(midFloat * 1_000_000);
          stopLossPrice = side === "Long"
            ? Math.floor(midSmallest * (1 - STOP_LOSS_FACTOR))
            : Math.floor(midSmallest * (1 + STOP_LOSS_FACTOR));
        } catch (err) {
          logger.warn({ err, mode: this.mode, pair }, "Mid-price unavailable for stop-loss, skipping");
          continue;
        }
      } else {
        logger.warn({ mode: this.mode, pair }, "No mid-price function for stop-loss, skipping");
        continue;
      }

      try {
        await this.positionManager.openPosition({
          mode: this.mode,
          pair,
          side,
          size,
          slippage: this.config.slippage,
          stopLossPrice,
        });
        this.positionOpenTimes.set(pair, Date.now());
        logger.info(
          { mode: this.mode, pair, side, rate: funding.rate },
          "Opened position on funding rate signal",
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

  private pairToCoin(pair: string): string {
    return pair.split("/")[0] ?? pair;
  }
}

// Self-registration
strategyRegistry.registerStrategy({
  name: "Funding Rate Arbitrage",
  description: "Collects hourly funding payments by positioning on the receiving side of Hyperliquid perpetuals.",
  modeType: "arbitrage",
  urlSlug: "arbitrage",
  modeColor: "#a855f7",
  requires: { oracle: false, blockchain: true },
  factory: (deps: StrategyDeps) => {
    if (!deps.getPredictedFundings) {
      throw new AppError({
        severity: "critical",
        code: "MISSING_DEPENDENCY",
        message: "Funding Rate Arbitrage strategy requires getPredictedFundings dependency",
        resolution: "Ensure blockchain client is available before starting Funding Rate Arbitrage.",
      });
    }
    return new ArbitrageStrategy(
      deps.fundAllocator,
      deps.positionManager,
      deps.broadcast,
      deps.getPredictedFundings,
      { pairs: deps.config.pairs, slippage: deps.config.slippage, positionSize: deps.config.positionSize },
      deps.getMidPrice,
    );
  },
});
