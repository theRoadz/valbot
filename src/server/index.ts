import 'dotenv/config';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';
import { setupWebSocket } from './ws/broadcaster.js';

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
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
