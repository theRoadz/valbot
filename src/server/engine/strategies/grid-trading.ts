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

interface GridTradingConfig {
  pair: string;
  upperPrice: number;
  lowerPrice: number;
  gridLines: number;
  iterationIntervalMs: number;
  slippage: number;
}

const DEFAULT_ITERATION_INTERVAL_MS = 30_000;
const DEFAULT_SLIPPAGE = 0.5;
const MIN_POSITION_SIZE = 10_000_000; // $10 in smallest-unit

export class GridTradingStrategy extends ModeRunner {
  private readonly config: GridTradingConfig;
  private readonly oracleClient: OracleClient;
  private iterationCount = 0;

  /** Map<gridLevelPrice, positionId | null> */
  private gridState = new Map<number, number | null>();

  get strategyName() { return "Grid Trading"; }
  get strategyDescription() { return "Mechanical grid strategy that buys dips and sells rallies at predetermined price levels."; }
  get defaultConfig(): Record<string, unknown> {
    return {
      gridLines: 10,
      iterationIntervalMs: DEFAULT_ITERATION_INTERVAL_MS,
      slippage: DEFAULT_SLIPPAGE,
    };
  }
  get modeColor() { return "#3b82f6"; }
  get urlSlug() { return "grid-trading"; }

  constructor(
    fundAllocator: FundAllocator,
    positionManager: PositionManager,
    broadcast: BroadcastFn,
    oracleClient: OracleClient,
    config: {
      pair: string;
      upperPrice: number;
      lowerPrice: number;
      gridLines: number;
      iterationIntervalMs?: number;
      slippage?: number;
    },
  ) {
    const mode: ModeType = "gridTrading";
    super(mode, fundAllocator, positionManager, broadcast);

    // Validation (AC 8, 9, 10)
    if (config.upperPrice <= config.lowerPrice) {
      throw invalidStrategyConfigError(mode, "upperPrice must be greater than lowerPrice");
    }

    if (config.gridLines < 2) {
      throw invalidStrategyConfigError(mode, "gridLines must be at least 2");
    }

    const allocation = fundAllocator.getAllocation(mode).allocation;
    if (allocation < config.gridLines * MIN_POSITION_SIZE) {
      throw invalidStrategyConfigError(
        mode,
        `allocation must be at least $${config.gridLines * 10} (gridLines * $10 minimum per position)`,
      );
    }

    this.oracleClient = oracleClient;

    this.config = {
      pair: config.pair,
      upperPrice: config.upperPrice,
      lowerPrice: config.lowerPrice,
      gridLines: config.gridLines,
      iterationIntervalMs: config.iterationIntervalMs ?? DEFAULT_ITERATION_INTERVAL_MS,
      slippage: config.slippage ?? DEFAULT_SLIPPAGE,
    };
  }

  getIntervalMs(): number {
    return this.config.iterationIntervalMs;
  }

  calculateGridLevels(): number[] {
    const { lowerPrice, upperPrice, gridLines } = this.config;
    const step = (upperPrice - lowerPrice) / (gridLines - 1);
    const levels: number[] = [];
    for (let i = 0; i < gridLines; i++) {
      levels.push(Math.round(lowerPrice + step * i));
    }
    return levels;
  }

  protected onStart(): void {
    const levels = this.calculateGridLevels();
    this.gridState = new Map();
    for (const level of levels) {
      this.gridState.set(level, null);
    }
  }

  protected onStop(): void {
    this.gridState.clear();
  }

  async executeIteration(): Promise<void> {
    this.iterationCount++;
    const activity: ActivityPairEntry[] = [];
    const pair = this.config.pair;
    const oracleKey = this.pairToOracleKey(pair);

    if (!this.oracleClient.isAvailable(oracleKey)) {
      activity.push({ pair, signalValue: null, oracleStatus: "stale", outcome: "skipped-stale", size: null, side: null });
      this.broadcastActivity(activity);
      return;
    }

    const price = this.oracleClient.getPrice(oracleKey);
    if (price === null || price === 0) {
      activity.push({ pair, signalValue: null, oracleStatus: "warming-up", outcome: "skipped-warming", size: null, side: null });
      this.broadcastActivity(activity);
      return;
    }

    const levels = this.calculateGridLevels();
    const positionSize = this.getPositionSize();
    const stopLossPrice = Math.floor(this.config.lowerPrice * 0.98);

    // Reconcile grid state with actual positions
    const openPositions = this.positionManager.getPositions(this.mode);
    const openPositionIds = new Set(openPositions.map((p) => p.id));

    // Clear stale position references (positions closed externally, e.g., by stop-loss)
    for (const [level, posId] of this.gridState.entries()) {
      if (posId !== null && !openPositionIds.has(posId)) {
        this.gridState.set(level, null);
      }
    }

    // Phase 1: Check existing positions for close signals (price crossed above next level up)
    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];
      const positionId = this.gridState.get(level);
      if (positionId === null || positionId === undefined) continue;

      const nextLevelUp = i < levels.length - 1 ? levels[i + 1] : null;
      if (nextLevelUp === null) continue; // top level — no sell target

      if (price > nextLevelUp) {
        try {
          await this.positionManager.closePosition(positionId);
          this.gridState.set(level, null);
          logger.info(
            { mode: this.mode, pair, level, nextLevelUp, price },
            "Closed grid position — price crossed above next level",
          );
          activity.push({ pair, signalValue: price, oracleStatus: "ok", outcome: "closed-reverted", size: positionSize, side: "Long" });
        } catch (err) {
          logger.error({ err, mode: this.mode, positionId }, "Failed to close grid position");
          activity.push({ pair, signalValue: price, oracleStatus: "ok", outcome: "close-failed", size: null, side: "Long" });
        }
      }
    }

    // Phase 2: Check empty levels for open signals (price crossed below level)
    for (const level of levels) {
      const positionId = this.gridState.get(level);
      if (positionId !== null && positionId !== undefined) continue; // AC 5: no duplicate

      if (price < level) {
        if (!this.fundAllocator.canAllocate(this.mode, positionSize)) {
          activity.push({ pair, signalValue: price, oracleStatus: "ok", outcome: "skipped-no-funds", size: null, side: "Long" });
          continue;
        }

        try {
          const position = await this.positionManager.openPosition({
            mode: this.mode,
            pair,
            side: "Long",
            size: positionSize,
            slippage: this.config.slippage,
            stopLossPrice,
          });
          this.gridState.set(level, position.id);
          logger.info(
            { mode: this.mode, pair, level, price },
            "Opened grid position — price crossed below level",
          );
          activity.push({ pair, signalValue: price, oracleStatus: "ok", outcome: "opened-long", size: positionSize, side: "Long" });
        } catch (err) {
          logger.error({ err, mode: this.mode, pair, level }, "Failed to open grid position");
          activity.push({ pair, signalValue: price, oracleStatus: "ok", outcome: "open-failed", size: null, side: "Long" });
        }
      }
    }

    if (activity.length === 0) {
      activity.push({ pair, signalValue: price, oracleStatus: "ok", outcome: "no-signal", size: null, side: null });
    }

    this.broadcastActivity(activity);
  }

  private getPositionSize(): number {
    const { allocation } = this.fundAllocator.getAllocation(this.mode);
    return Math.max(MIN_POSITION_SIZE, Math.floor(allocation / this.config.gridLines));
  }

  private pairToOracleKey(pair: string): string {
    const parts = pair.split("/");
    if (parts.length < 2 || !parts[0]) {
      logger.warn({ mode: this.mode, pair }, "Malformed pair format — expected 'COIN/QUOTE'");
      return pair;
    }
    return `${parts[0]}-PERP`;
  }

  private broadcastActivity(activity: ActivityPairEntry[]): void {
    if (activity.length > 0) {
      this.broadcast(EVENTS.MODE_ACTIVITY, {
        mode: this.mode,
        iteration: this.iterationCount,
        pairs: activity,
      });
    }
  }
}

// Self-registration
strategyRegistry.registerStrategy({
  name: "Grid Trading",
  description: "Mechanical grid strategy that buys dips and sells rallies at predetermined price levels.",
  modeType: "gridTrading",
  urlSlug: "grid-trading",
  modeColor: "#3b82f6",
  requires: { oracle: true },
  factory: (deps: StrategyDeps) => {
    if (!deps.oracleClient) {
      throw new AppError({
        severity: "critical",
        code: "MISSING_DEPENDENCY",
        message: "Grid Trading strategy requires oracleClient dependency",
        resolution: "Ensure oracle is available before starting Grid Trading.",
      });
    }

    // Grid config read directly from fund allocator metadata (not via StrategyDeps.config)
    const gridUpperPrice = deps.fundAllocator.getModeMetadata("gridTrading", "gridUpperPrice") ?? undefined;
    const gridLowerPrice = deps.fundAllocator.getModeMetadata("gridTrading", "gridLowerPrice") ?? undefined;
    const gridLines = deps.fundAllocator.getModeMetadata("gridTrading", "gridLines") ?? 10;

    if (gridUpperPrice === undefined || gridLowerPrice === undefined) {
      throw invalidStrategyConfigError(
        "gridTrading",
        "Grid Trading requires gridUpperPrice and gridLowerPrice to be configured before starting",
      );
    }

    return new GridTradingStrategy(
      deps.fundAllocator,
      deps.positionManager,
      deps.broadcast,
      deps.oracleClient,
      {
        pair: deps.config.pairs[0],
        upperPrice: gridUpperPrice,
        lowerPrice: gridLowerPrice,
        gridLines,
        slippage: deps.config.slippage,
      },
    );
  },
});
