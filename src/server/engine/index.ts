import type { ModeType, ModeStatus } from "../../shared/types.js";
import { PYTH_FEED_IDS } from "../../shared/types.js";
import { FundAllocator } from "./fund-allocator.js";
import { PositionManager } from "./position-manager.js";
import { ModeRunner } from "./mode-runner.js";
import { VolumeMaxStrategy } from "./strategies/volume-max.js";
import { OracleClient } from "../blockchain/oracle.js";
import { broadcast } from "../ws/broadcaster.js";
import { logger } from "../lib/logger.js";
import {
  engineNotInitializedError,
  modeTransitioningError,
  unsupportedModeError,
  oracleFeedUnavailableError,
} from "../lib/errors.js";

let fundAllocator: FundAllocator | null = null;
let positionManager: PositionManager | null = null;
let oracleClient: OracleClient | null = null;
let modeRunners: Map<ModeType, ModeRunner> = new Map();
const modeLocks: Set<ModeType> = new Set();

export async function initEngine(): Promise<void> {
  if (fundAllocator && positionManager) {
    logger.warn("Engine already initialized — skipping re-initialization");
    return;
  }

  fundAllocator = new FundAllocator();
  positionManager = new PositionManager(fundAllocator, broadcast, (mode) => {
    const runner = modeRunners.get(mode);
    if (!runner) return;
    // Guard: if kill-switch was reset and a new runner started between closeAllForMode
    // completing and this callback firing, the mode status would no longer be "kill-switch".
    // Only stop the runner if the mode is still in kill-switch state.
    if (positionManager!.getModeStatus(mode) !== "kill-switch") return;
    runner.forceStop();
    modeRunners.delete(mode);
  });

  await fundAllocator.loadFromDb();
  await positionManager.loadFromDb();

  // Reconcile: subtract open position sizes from fund allocator remaining
  const openPositions = positionManager.getInternalPositions();
  if (openPositions.length > 0) {
    fundAllocator.reconcilePositions(openPositions);
    logger.info({ count: openPositions.length }, "Reconciled fund allocator with open positions");
  }

  modeRunners = new Map();

  // Initialize oracle client and start streaming (non-blocking)
  oracleClient = new OracleClient(broadcast);
  const defaultPairs = Object.keys(PYTH_FEED_IDS);
  oracleClient.connect(defaultPairs).catch((err) => {
    logger.error({ err }, "Oracle client connection failed during init");
  });

  logger.info("Engine initialized — fund allocator and position manager ready");
}

export function getOracleClient(): OracleClient | null {
  return oracleClient;
}

export async function startMode(
  mode: ModeType,
  config: { pairs: string[]; slippage?: number },
): Promise<void> {
  if (modeLocks.has(mode)) {
    throw modeTransitioningError(mode);
  }

  modeLocks.add(mode);
  try {
    const engine = getEngine();

    // Oracle gate: Profit Hunter requires live price data
    if (mode === "profitHunter") {
      if (!oracleClient || !oracleClient.isAvailable()) {
        throw oracleFeedUnavailableError("profitHunter");
      }
    }

    let runner: ModeRunner;

    switch (mode) {
      case "volumeMax":
        runner = new VolumeMaxStrategy(
          engine.fundAllocator,
          engine.positionManager,
          broadcast,
          { pairs: config.pairs, slippage: config.slippage },
        );
        break;
      default:
        throw unsupportedModeError(mode);
    }

    await runner.start();
    modeRunners.set(mode, runner);
  } finally {
    modeLocks.delete(mode);
  }
}

export async function stopMode(mode: ModeType): Promise<void> {
  if (modeLocks.has(mode)) {
    throw modeTransitioningError(mode);
  }

  const runner = modeRunners.get(mode);
  if (!runner) {
    return; // idempotent
  }

  modeLocks.add(mode);
  try {
    await runner.stop();
    modeRunners.delete(mode);
  } finally {
    modeLocks.delete(mode);
  }
}

export function getModeStatus(mode: ModeType): ModeStatus {
  if (positionManager && positionManager.getModeStatus(mode) === "kill-switch") {
    return "kill-switch";
  }
  const runner = modeRunners.get(mode);
  if (runner && runner.isRunning()) {
    return "running";
  }
  return "stopped";
}

export function resetKillSwitch(mode: ModeType): void {
  const engine = getEngine();
  engine.positionManager.resetModeStatus(mode);
  engine.fundAllocator.resetModeStats(mode);
}

export async function stopAllModes(): Promise<void> {
  const entries = [...modeRunners.entries()];
  const results = await Promise.allSettled(
    entries.map(([, runner]) => runner.stop()),
  );

  for (let i = 0; i < results.length; i++) {
    if (results[i].status === "rejected") {
      logger.error(
        { err: (results[i] as PromiseRejectedResult).reason, mode: entries[i][0] },
        "Failed to stop mode during stopAllModes",
      );
    }
  }

  modeRunners.clear();
}

export function getEngine(): {
  fundAllocator: FundAllocator;
  positionManager: PositionManager;
} {
  if (!fundAllocator || !positionManager) {
    throw engineNotInitializedError();
  }
  return { fundAllocator, positionManager };
}
