import type { ModeType, ModeStatus } from "../../shared/types.js";
import { PYTH_FEED_IDS } from "../../shared/types.js";
import { FundAllocator } from "./fund-allocator.js";
import { PositionManager } from "./position-manager.js";
import type { ModeRunner } from "./mode-runner.js";
import { strategyRegistry } from "./strategy-registry.js";
// Import strategy files to trigger self-registration
import "./strategies/volume-max.js";
import "./strategies/profit-hunter.js";
import "./strategies/arbitrage.js";
import { OracleClient } from "../blockchain/oracle.js";
import { getMidPrice } from "../blockchain/contracts.js";
import { getBlockchainClient, getPredictedFundings } from "../blockchain/client.js";
import { broadcast } from "../ws/broadcaster.js";
import { SessionManager } from "./session-manager.js";
import { logger } from "../lib/logger.js";
import {
  engineNotInitializedError,
  modeTransitioningError,
  unsupportedModeError,
  oracleFeedUnavailableError,
  arbitrageNoBlockchainClientError,
} from "../lib/errors.js";

let fundAllocator: FundAllocator | null = null;
let positionManager: PositionManager | null = null;
let sessionManager: SessionManager | null = null;
let oracleClient: OracleClient | null = null;
let modeRunners: Map<ModeType, ModeRunner> = new Map();
const activeSessions: Map<ModeType, number> = new Map();
const modeLocks: Set<ModeType> = new Set();

export async function initEngine(): Promise<void> {
  if (fundAllocator && positionManager) {
    logger.warn("Engine already initialized — skipping re-initialization");
    return;
  }

  fundAllocator = new FundAllocator();
  sessionManager = new SessionManager();
  positionManager = new PositionManager(
    fundAllocator,
    broadcast,
    (mode) => {
      const runner = modeRunners.get(mode);
      if (!runner) return;
      // Guard: if kill-switch was reset and a new runner started between closeAllForMode
      // completing and this callback firing, the mode status would no longer be "kill-switch".
      // Only stop the runner if the mode is still in kill-switch state.
      if (positionManager!.getModeStatus(mode) !== "kill-switch") return;
      runner.forceStop();
      modeRunners.delete(mode);

      // Finalize the killed mode's session
      const sessionId = activeSessions.get(mode);
      if (sessionId != null && sessionManager) {
        sessionManager.finalizeSession(sessionId);
        activeSessions.delete(mode);
      }
    },
    (mode, size, pnl) => {
      const sessionId = activeSessions.get(mode);
      if (sessionId != null && sessionManager) {
        sessionManager.updateSession(sessionId, size, pnl);
      }
    },
  );

  await fundAllocator.loadFromDb();
  await positionManager.loadFromDb();

  // Finalize any orphaned sessions from a previous crash (before reconciliation)
  sessionManager.finalizeOrphanedSessions();

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

    // Registry lookup
    const registration = strategyRegistry.getRegistration(mode);
    if (!registration) {
      throw unsupportedModeError(mode, strategyRegistry.getRegisteredModeTypes());
    }

    // Generic dependency gate checks based on strategy's `requires` declaration
    if (registration.requires.oracle) {
      if (!oracleClient || !oracleClient.isAvailable()) {
        throw oracleFeedUnavailableError(mode);
      }
    }
    if (registration.requires.blockchain) {
      if (!getBlockchainClient()) {
        throw arbitrageNoBlockchainClientError();
      }
    }

    const storedPositionSize = engine.fundAllocator.getPositionSize(mode) ?? undefined;
    const bcClient = getBlockchainClient();
    const getMidPriceFn = bcClient ? (coin: string) => getMidPrice(bcClient.info, coin) : undefined;
    const getPredictedFundingsFn = bcClient ? () => getPredictedFundings(bcClient.info) : undefined;

    const runner: ModeRunner = registration.factory({
      fundAllocator: engine.fundAllocator,
      positionManager: engine.positionManager,
      broadcast,
      oracleClient: oracleClient ?? undefined,
      getMidPrice: getMidPriceFn,
      getPredictedFundings: getPredictedFundingsFn,
      config: { pairs: config.pairs, slippage: config.slippage, positionSize: storedPositionSize },
    });

    // Set runner in map BEFORE start() so kill-switch callback can find it
    // during the run loop that fires immediately after start()
    modeRunners.set(mode, runner);
    try {
      await runner.start();
    } catch (err) {
      modeRunners.delete(mode);
      throw err;
    }

    // Start session tracking for this mode
    if (sessionManager) {
      // Finalize any existing session for this mode (guard against double-start orphaning)
      const existingSessionId = activeSessions.get(mode);
      if (existingSessionId != null) {
        sessionManager.finalizeSession(existingSessionId);
        activeSessions.delete(mode);
      }
      const sessionId = sessionManager.startSession(mode);
      activeSessions.set(mode, sessionId);
    }
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

    // Finalize session for this mode
    const sessionId = activeSessions.get(mode);
    if (sessionId != null && sessionManager) {
      sessionManager.finalizeSession(sessionId);
      activeSessions.delete(mode);
    }
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

  // Acquire locks to prevent concurrent startMode during shutdown
  for (const [mode] of entries) {
    modeLocks.add(mode);
  }

  try {
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
  } finally {
    for (const [mode] of entries) {
      modeLocks.delete(mode);
    }
  }

  // Finalize all active sessions after all runners have stopped
  // Snapshot and clear first to prevent conflicts with kill-switch callback
  if (sessionManager) {
    const sessionsToFinalize = [...activeSessions.entries()];
    activeSessions.clear();
    for (const [mode, sessionId] of sessionsToFinalize) {
      try {
        sessionManager.finalizeSession(sessionId);
      } catch (err) {
        logger.error({ err, mode, sessionId }, "Failed to finalize session during stopAllModes");
      }
    }
  }
}

export function getEngine(): {
  fundAllocator: FundAllocator;
  positionManager: PositionManager;
  sessionManager: SessionManager;
} {
  if (!fundAllocator || !positionManager || !sessionManager) {
    throw engineNotInitializedError();
  }
  return { fundAllocator, positionManager, sessionManager };
}
