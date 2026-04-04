import 'dotenv/config';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';
import { setupWebSocket, broadcast, cacheAlert } from './ws/broadcaster.js';
import { initBlockchainClient, getConnectionStatus } from './blockchain/client.js';
import { AppError } from './lib/errors.js';
import { logger } from './lib/logger.js';
import { EVENTS } from '../shared/events.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const fastify = Fastify({ logger: true });

fastify.get('/api/status', async () => {
  return { status: 'ok' };
});

if (process.env.NODE_ENV === 'production') {
  const clientPath = path.join(__dirname, '..', 'client');
  await fastify.register(fastifyStatic, {
    root: clientPath,
  });

  fastify.setNotFoundHandler(async (_request, reply) => {
    return reply.sendFile('index.html');
  });
}

const port = Number(process.env.PORT) || 3000;

try {
  await fastify.listen({ port, host: '127.0.0.1' });
  setupWebSocket(fastify);

  // Initialize blockchain client — server stays running even if this fails
  try {
    await initBlockchainClient();
    const status = await getConnectionStatus();
    if (status) {
      broadcast(EVENTS.CONNECTION_STATUS, status);
    }
    logger.info("Blockchain client initialized, balance broadcast");
  } catch (err) {
    // Broadcast disconnected status so dashboard shows explicit state
    broadcast(EVENTS.CONNECTION_STATUS, { rpc: false, wallet: "", balance: 0 });

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
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
