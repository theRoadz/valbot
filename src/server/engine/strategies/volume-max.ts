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
const MIN_POSITION_SIZE = 1;

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

    // Step 3: Check funds (need 2x size for both sides)
    if (!this.fundAllocator.canAllocate(this.mode, size * 2)) {
      logger.info({ mode: this.mode, pair }, "Insufficient funds for cycle, skipping");
      return;
    }

    // Step 4: Open long position
    let longPos;
    try {
      longPos = await this.positionManager.openPosition({
        mode: this.mode,
        pair,
        side: "Long",
        size,
        slippage: this.config.slippage,
        stopLossPrice: Math.floor(DEFAULT_REFERENCE_PRICE * LONG_STOP_LOSS_FACTOR), // placeholder until oracle provides real-time price
      });
    } catch (err) {
      logger.error({ err, mode: this.mode, pair, side: "Long" }, "Failed to open long position");
      throw err;
    }

    // Step 5: Open short position
    let shortPos;
    try {
      shortPos = await this.positionManager.openPosition({
        mode: this.mode,
        pair,
        side: "Short",
        size,
        slippage: this.config.slippage,
        stopLossPrice: Math.floor(DEFAULT_REFERENCE_PRICE * SHORT_STOP_LOSS_FACTOR), // placeholder until oracle provides real-time price
      });
    } catch (err) {
      // Step 6: Orphan prevention — close long if short fails
      logger.error({ err, mode: this.mode, pair, side: "Short" }, "Failed to open short position, closing long");
      try {
        await this.positionManager.closePosition(longPos.id);
      } catch (closeErr) {
        logger.error({ closeErr, positionId: longPos.id }, "Failed to close orphaned long position");
      }
      throw err;
    }

    // Step 7 & 8: Close both positions (delta-neutral cycling)
    try {
      await this.positionManager.closePosition(longPos.id);
    } catch (err) {
      logger.error({ err, positionId: longPos.id }, "Failed to close long position");
    }

    try {
      await this.positionManager.closePosition(shortPos.id);
    } catch (err) {
      logger.error({ err, positionId: shortPos.id }, "Failed to close short position");
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
