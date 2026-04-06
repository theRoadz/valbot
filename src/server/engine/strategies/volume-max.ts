import type { ModeType } from "../../../shared/types.js";
import type { FundAllocator } from "../fund-allocator.js";
import type { PositionManager } from "../position-manager.js";
import { ModeRunner, type BroadcastFn } from "../mode-runner.js";
import { logger } from "../../lib/logger.js";
import { invalidStrategyConfigError } from "../../lib/errors.js";

export interface VolumeMaxConfig {
  pairs: string[];
  slippage: number;
  cycleIntervalMs: number;
  positionSize: number; // smallest-unit per side
}

const DEFAULT_CYCLE_INTERVAL_MS = 30_000;
const DEFAULT_SLIPPAGE = 0.5;
const LONG_STOP_LOSS_FACTOR = 0.95;
const SHORT_STOP_LOSS_FACTOR = 1.05;
const DEFAULT_REFERENCE_PRICE = 100_000_000; // placeholder: 100 USDC in smallest-unit until oracle is integrated
const MIN_POSITION_SIZE = 10_000_000; // $10 in smallest-unit — Hyperliquid minimum order value

export class VolumeMaxStrategy extends ModeRunner {
  private readonly config: VolumeMaxConfig;
  private _pairIndex = 0;

  constructor(
    fundAllocator: FundAllocator,
    positionManager: PositionManager,
    broadcast: BroadcastFn,
    config: Partial<VolumeMaxConfig> & { pairs: string[] },
  ) {
    const mode: ModeType = "volumeMax";
    super(mode, fundAllocator, positionManager, broadcast);

    if (!config.pairs.length) {
      throw invalidStrategyConfigError(mode, "requires at least one trading pair");
    }

    const allocation = fundAllocator.getAllocation(mode).allocation;
    if (allocation < MIN_POSITION_SIZE) {
      throw invalidStrategyConfigError(mode, "allocation must be at least $10");
    }

    this.config = {
      pairs: this.sortPairsWithBoostedFirst(config.pairs),
      slippage: config.slippage ?? DEFAULT_SLIPPAGE,
      cycleIntervalMs: config.cycleIntervalMs ?? DEFAULT_CYCLE_INTERVAL_MS,
      positionSize: config.positionSize ?? Math.max(MIN_POSITION_SIZE, Math.floor(allocation / 20)),
    };
  }

  getIntervalMs(): number {
    return this.config.cycleIntervalMs;
  }

  async executeIteration(): Promise<void> {
    // Step 1: Select pair
    const pair = this.config.pairs[this._pairIndex % this.config.pairs.length];
    this._pairIndex = (this._pairIndex + 1) % this.config.pairs.length;

    // Step 2: Position size
    const size = this.config.positionSize;

    // Step 3: Check funds (only 1x size — sequential round-trips, not simultaneous)
    if (!this.fundAllocator.canAllocate(this.mode, size)) {
      logger.info({ mode: this.mode, pair }, "Insufficient funds for cycle, skipping");
      return;
    }

    // Sequential round-trips: open→close each side independently
    // Hyperliquid uses net positions — simultaneous long+short on same asset nets to 0
    const longClosed = await this.executeRoundTrip(pair, "Long", size);
    if (longClosed) {
      await this.executeRoundTrip(pair, "Short", size);
    }
  }

  /** Returns true if the round-trip completed (position closed or never opened). */
  private async executeRoundTrip(
    pair: string,
    side: "Long" | "Short",
    size: number,
  ): Promise<boolean> {
    const stopLossFactor = side === "Long" ? LONG_STOP_LOSS_FACTOR : SHORT_STOP_LOSS_FACTOR;

    let position;
    try {
      position = await this.positionManager.openPosition({
        mode: this.mode,
        pair,
        side,
        size,
        slippage: this.config.slippage,
        stopLossPrice: Math.floor(DEFAULT_REFERENCE_PRICE * stopLossFactor),
      });
    } catch (err) {
      logger.error({ err, mode: this.mode, pair, side }, `Failed to open ${side} position, skipping leg`);
      return true; // nothing opened — safe to continue
    }

    try {
      await this.positionManager.closePosition(position.id);
      return true;
    } catch (err) {
      logger.error({ err, positionId: position.id, side }, `Failed to close ${side} position — skipping remaining legs`);
      return false; // position still open — unsafe to open opposite side
    }
  }

  async stop(): Promise<void> {
    await super.stop();
  }

  private sortPairsWithBoostedFirst(pairs: string[]): string[] {
    // For now, pairs are returned as-is. When boosted pair config is added,
    // boosted pairs will be sorted to the front of the list.
    return [...pairs];
  }
}
