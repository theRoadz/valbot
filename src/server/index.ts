import 'dotenv/config';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';
import { setupWebSocket, broadcast, cacheAlert } from './ws/broadcaster.js';
import { initBlockchainClient, getConnectionStatus } from './blockchain/client.js';
import { initAssetIndices } from './blockchain/contracts.js';
import { AppError } from './lib/errors.js';
import { logger } from './lib/logger.js';
import { errorHandler } from './lib/error-handler.js';
import { EVENTS } from '../shared/events.js';
import { initEngine } from './engine/index.js';
import modeRoutes from './api/mode.js';
import statusRoutes from './api/status.js';
import tradesRoutes from './api/trades.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const fastify = Fastify({ logger: true });

// Register API route plugins
await fastify.register(modeRoutes);
await fastify.register(statusRoutes);
await fastify.register(tradesRoutes);

// Error handler — API layer only, never calls broadcast()
fastify.setErrorHandler(errorHandler);

if (process.env.NODE_ENV === 'production') {
  const clientPath = path.join(__dirname, '..', 'client');
  await fastify.register(fastifyStatic, {
    root: clientPath,
  });
}

// SPA catch-all scoped to non-API routes
fastify.setNotFoundHandler(async (request, reply) => {
  if (request.url.startsWith('/api/')) {
    return reply.status(404).send({
      error: {
        severity: "warning",
        code: "NOT_FOUND",
        message: `Route ${request.method} ${request.url} not found`,
        details: null,
        resolution: null,
      },
    });
  }

  if (process.env.NODE_ENV === 'production') {
    return reply.sendFile('index.html');
  }

  return reply.status(404).send({ error: { severity: "info", code: "NOT_FOUND", message: "Not found", details: null, resolution: null } });
});

const port = Number(process.env.PORT) || 3000;

try {
  await fastify.listen({ port, host: '127.0.0.1' });
  setupWebSocket(fastify);

  // Initialize blockchain client — server stays running even if this fails
  try {
    const bcClient = await initBlockchainClient();
    await initAssetIndices(bcClient.info);
    const status = await getConnectionStatus();
    if (status) {
      broadcast(EVENTS.CONNECTION_STATUS, status);
    }
    logger.info("Blockchain client initialized, balance broadcast");
  } catch (err) {
    // Broadcast disconnected status so dashboard shows explicit state
    broadcast(EVENTS.CONNECTION_STATUS, { rpc: false, wallet: "", equity: 0, available: 0 });

    const appErr = err instanceof AppError
      ? err
      : new AppError({
          severity: "critical",
          code: "BLOCKCHAIN_INIT_FAILED",
          message: err instanceof Error ? err.message : "Unknown blockchain initialization error",
          resolution: "Check server logs for details and restart the bot.",
        });
    const alertPayload = {
      severity: appErr.severity,
      code: appErr.code,
      message: appErr.message,
      details: appErr.details ?? null,
      resolution: appErr.resolution ?? null,
    };
    broadcast(EVENTS.ALERT_TRIGGERED, alertPayload);
    cacheAlert(alertPayload);
    logger.error({ err }, "Blockchain client initialization failed");
  }

  // Initialize engine independently of blockchain — needed for crash recovery and status API
  try {
    await initEngine();
  } catch (engineErr) {
    logger.error({ err: engineErr }, "Engine initialization failed");
  }
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
