import type { FastifyInstance } from "fastify";
import { WebSocketServer, WebSocket } from "ws";
import { EVENTS, type EventName } from "../../shared/events.js";

const clients = new Set<WebSocket>();
let wss: WebSocketServer | null = null;

export function setupWebSocket(server: FastifyInstance): void {
  const httpServer = server.server;
  wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws) => {
    clients.add(ws);

    // Story 1.5 will send real connection.status with RPC state on connect.
    // No placeholder sent here to avoid connected→disconnected flicker.

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
