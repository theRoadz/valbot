import type { FastifyInstance } from "fastify";
import { WebSocketServer, WebSocket } from "ws";
import { EVENTS, type EventName } from "../../shared/events.js";
import { getConnectionStatus } from "../blockchain/client.js";
import { logger } from "../lib/logger.js";

const clients = new Set<WebSocket>();
let wss: WebSocketServer | null = null;
let lastAlert: { event: string; timestamp: number; data: unknown } | null = null;

export function cacheAlert(data: unknown): void {
  lastAlert = { event: EVENTS.ALERT_TRIGGERED, timestamp: Date.now(), data };
}

export function setupWebSocket(server: FastifyInstance): void {
  const httpServer = server.server;
  wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws) => {
    clients.add(ws);

    // Send current blockchain connection status to newly connected clients
    getConnectionStatus()
      .then((status) => {
        if (status && ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              event: EVENTS.CONNECTION_STATUS,
              timestamp: Date.now(),
              data: status,
            }),
          );
        }
      })
      .catch((err) => {
        logger.warn({ err }, "Balance fetch failed for new WS client");
      });

    // Replay cached alert to late-connecting clients
    if (lastAlert && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(lastAlert));
    }

    ws.on("close", () => {
      clients.delete(ws);
    });
  });
}

export function closeWebSocket(): Promise<void> {
  return new Promise((resolve) => {
    for (const client of clients) {
      client.close();
    }
    clients.clear();
    if (wss) {
      wss.close(() => resolve());
      wss = null;
    } else {
      resolve();
    }
  });
}

export function broadcast(event: EventName, data: unknown): void {
  const message = JSON.stringify({
    event,
    timestamp: Date.now(),
    data,
  });

  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}
