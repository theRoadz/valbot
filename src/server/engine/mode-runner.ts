import type { ModeType } from "../../shared/types.js";
import type { EventName, EventPayloadMap } from "../../shared/events.js";
import { EVENTS } from "../../shared/events.js";
import type { FundAllocator } from "./fund-allocator.js";
import type { PositionManager } from "./position-manager.js";
import {
  AppError,
  modeAlreadyRunningError,
  modeNotAllocatedError,
  modeKillSwitchedError,
} from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { isApiHealthy } from "../blockchain/client.js";

export type BroadcastFn = <E extends EventName>(
  event: E,
  data: EventPayloadMap[E],
) => void;

export abstract class ModeRunner {
  protected readonly mode: ModeType;
  protected readonly fundAllocator: FundAllocator;
  protected readonly positionManager: PositionManager;
  protected readonly broadcast: BroadcastFn;

  private _running = false;
  private _loopTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    mode: ModeType,
    fundAllocator: FundAllocator,
    positionManager: PositionManager,
    broadcast: BroadcastFn,
  ) {
    this.mode = mode;
    this.fundAllocator = fundAllocator;
    this.positionManager = positionManager;
    this.broadcast = broadcast;
  }

  abstract executeIteration(): Promise<void>;
  abstract getIntervalMs(): number;

  async start(): Promise<void> {
    if (this._running) {
      throw modeAlreadyRunningError(this.mode);
    }

    if (this.positionManager.getModeStatus(this.mode) === "kill-switch") {
      throw modeKillSwitchedError(this.mode);
    }

    if (this.fundAllocator.getAllocation(this.mode).allocation <= 0) {
      throw modeNotAllocatedError(this.mode);
    }

    this._running = true;
    this.broadcast(EVENTS.MODE_STARTED, { mode: this.mode });
    logger.info({ mode: this.mode }, "Mode started");

    // Run loop in background — do NOT await
    this._runLoop().catch((err) => {
      logger.error({ err, mode: this.mode }, "Unexpected error in run loop");
    });
  }

  async stop(): Promise<void> {
    if (!this._running) {
      return;
    }

    this._running = false;

    if (this._loopTimer !== null) {
      clearTimeout(this._loopTimer);
      this._loopTimer = null;
    }

    try {
      await this.positionManager.closeAllForMode(this.mode);
    } catch (err) {
      logger.error({ err, mode: this.mode }, "Error closing positions during stop");
    }

    const finalStats = this.fundAllocator.getStats(this.mode);
    this.broadcast(EVENTS.MODE_STOPPED, { mode: this.mode, finalStats });
    logger.info({ mode: this.mode }, "Mode stopped");
  }

  /** Stop the mode without closing positions (used by kill-switch — positions already closed) */
  forceStop(): void {
    if (!this._running) return;

    this._running = false;

    if (this._loopTimer !== null) {
      clearTimeout(this._loopTimer);
      this._loopTimer = null;
    }

    const finalStats = this.fundAllocator.getStats(this.mode);
    this.broadcast(EVENTS.MODE_STOPPED, { mode: this.mode, finalStats });
    logger.info({ mode: this.mode }, "Mode force-stopped (kill-switch)");
  }

  isRunning(): boolean {
    return this._running;
  }

  private async _runLoop(): Promise<void> {
    while (this._running) {
      if (!isApiHealthy()) {
        logger.debug({ mode: this.mode }, "Skipping iteration — API unhealthy");
        if (this._running) {
          // Poll at 2s instead of full strategy interval for faster recovery
          await new Promise<void>((resolve) => {
            this._loopTimer = setTimeout(resolve, 2000);
          });
        }
        continue;
      }

      try {
        await this.executeIteration();
      } catch (err) {
        const errorPayload =
          err instanceof AppError
            ? { code: err.code, message: err.message, details: err.details ?? null }
            : {
                code: "STRATEGY_ITERATION_FAILED",
                message: err instanceof Error ? err.message : String(err),
                details: null,
              };

        // Log at severity-appropriate level, preserving inner error context
        if (err instanceof AppError) {
          const logCtx = { err, mode: this.mode, code: err.code, iteration: "failed" };
          if (err.severity === "critical") {
            logger.error(logCtx, "Strategy iteration failed");
          } else {
            logger.warn(logCtx, "Strategy iteration failed");
          }
        } else {
          logger.error({ err, mode: this.mode }, "Strategy iteration failed");
        }

        this.broadcast(EVENTS.MODE_ERROR, {
          mode: this.mode,
          error: errorPayload,
        });
      }

      if (this._running) {
        await new Promise<void>((resolve) => {
          this._loopTimer = setTimeout(resolve, this.getIntervalMs());
        });
      }
    }
  }
}
