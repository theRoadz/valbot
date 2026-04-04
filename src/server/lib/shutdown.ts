import { stopAllModes } from "../engine/index.js";
import { closeWebSocket } from "../ws/broadcaster.js";
import { closeDb } from "../db/index.js";
import { logger } from "./logger.js";

const SHUTDOWN_TIMEOUT_MS = 15_000;

let shuttingDown = false;

export function registerShutdownHandlers(): void {
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ signal }, "Graceful shutdown initiated");

    // Hard deadline: force exit if graceful shutdown hangs
    const forceTimer = setTimeout(() => {
      logger.error("Shutdown timed out — forcing exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceTimer.unref();

    // Step 1: Stop all running modes (closes their positions via closeAllForMode)
    try {
      await stopAllModes();
      logger.info("All modes stopped");
    } catch (err) {
      logger.error({ err }, "Error stopping modes during shutdown");
    }

    // Step 2: Close any remaining positions not owned by a mode runner
    // Currently handled by stopAllModes → runner.stop() → closeAllForMode

    // Step 3: Flush trade buffer (not yet implemented — trades are written synchronously in closePosition)
    // TODO: Add trade buffer flush when batch writing is introduced

    // Step 4: Close WebSocket connections
    try {
      await closeWebSocket();
      logger.info("WebSocket connections closed");
    } catch (err) {
      logger.error({ err }, "Error closing WebSocket during shutdown");
    }

    // Step 5: Close database
    try {
      closeDb();
      logger.info("Database closed");
    } catch (err) {
      logger.error({ err }, "Error closing database during shutdown");
    }

    clearTimeout(forceTimer);
    logger.info("Shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
