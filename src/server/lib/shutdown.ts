import type { FastifyInstance } from "fastify";
import { stopAllModes, getEngine, getOracleClient } from "../engine/index.js";
import { broadcast } from "../ws/broadcaster.js";
import { closeWebSocket } from "../ws/broadcaster.js";
import { closeDb } from "../db/index.js";
import { EVENTS } from "../../shared/events.js";
import { logger } from "./logger.js";

const SHUTDOWN_TIMEOUT_MS = 15_000;

let shuttingDown = false;

/** Reset module state — for testing only. */
export function _resetShutdownState(): void {
  shuttingDown = false;
}

export function registerShutdownHandlers(fastify: FastifyInstance): void {
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

    // Step 1: Block new positions immediately
    try {
      const engine = getEngine();
      engine.positionManager.enterShutdown();
    } catch {
      // Engine may not be initialized — that's OK, no positions to guard
    }

    // Step 2: Broadcast shutdown alert to connected clients
    try {
      broadcast(EVENTS.ALERT_TRIGGERED, {
        severity: "warning",
        code: "SHUTDOWN_INITIATED",
        message: "Bot is shutting down — closing all positions.",
        details: null,
        resolution: "Wait for shutdown to complete. Positions are being closed.",
      });
    } catch (err) {
      logger.error({ err }, "Error broadcasting shutdown alert");
    }

    // Step 3: Stop all running modes (closes their positions via closeAllForMode)
    try {
      await stopAllModes();
      logger.info("All modes stopped");
    } catch (err) {
      logger.error({ err }, "Error stopping modes during shutdown");
    }

    // Step 4: Close any remaining positions not owned by a mode runner
    try {
      const engine = getEngine();
      await engine.positionManager.closeAllPositions();
      logger.info("Remaining positions closed");
    } catch (err) {
      // Engine may not be initialized if server failed early — that's OK
      logger.error({ err }, "Error closing remaining positions during shutdown");
    }

    // Step 5: Disconnect oracle client
    try {
      const oracle = getOracleClient();
      if (oracle) {
        oracle.disconnect();
        logger.info("Oracle client disconnected");
      }
    } catch (err) {
      logger.error({ err }, "Error disconnecting oracle during shutdown");
    }

    // Step 6: Close Fastify HTTP server
    try {
      await fastify.close();
      logger.info("Fastify server closed");
    } catch (err) {
      logger.error({ err }, "Error closing Fastify server during shutdown");
    }

    // Step 7: Close WebSocket connections
    try {
      await closeWebSocket();
      logger.info("WebSocket connections closed");
    } catch (err) {
      logger.error({ err }, "Error closing WebSocket during shutdown");
    }

    // Step 8: Close database
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
