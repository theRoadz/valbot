import { describe, it, expect, vi, beforeEach } from "vitest";
import { EVENTS } from "../../shared/events.js";

describe("broadcaster", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  function createMockWss() {
    const handlers: Record<string, (...args: unknown[]) => void> = {};
    const instance = {
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        handlers[event] = handler;
      }),
      _handlers: handlers,
    };

    vi.doMock("ws", () => ({
      WebSocketServer: class {
        on: typeof instance.on;
        constructor() {
          this.on = instance.on;
          Object.assign(this, instance);
        }
      },
      WebSocket: { OPEN: 1, CLOSED: 3 },
    }));

    return instance;
  }

  it("creates WebSocket server on setup", async () => {
    createMockWss();
    const { setupWebSocket } = await import("./broadcaster.js");

    const mockServer = { server: {} } as unknown as Parameters<typeof setupWebSocket>[0];
    setupWebSocket(mockServer);

    // If it doesn't throw, setup succeeded
    expect(true).toBe(true);
  });

  it("tracks clients on connection and removal on close", async () => {
    const wssInstance = createMockWss();
    const { setupWebSocket, broadcast } = await import("./broadcaster.js");

    const mockServer = { server: {} } as unknown as Parameters<typeof setupWebSocket>[0];
    setupWebSocket(mockServer);

    const connectionHandler = wssInstance._handlers["connection"] as (ws: { send: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; readyState: number }) => void;
    expect(connectionHandler).toBeDefined();

    const closeHandlers: Record<string, () => void> = {};
    const mockWs = {
      send: vi.fn(),
      on: vi.fn((event: string, handler: () => void) => {
        closeHandlers[event] = handler;
      }),
      close: vi.fn(),
      readyState: 1,
    };
    connectionHandler(mockWs);

    // No initial message sent (getConnectionStatus is async, mock doesn't resolve)
    expect(mockWs.send).not.toHaveBeenCalled();

    // Client receives broadcasts
    broadcast(EVENTS.CONNECTION_STATUS, { rpc: true, wallet: "abc", balance: 100 });
    expect(mockWs.send).toHaveBeenCalledTimes(1);

    // Simulate close — client should no longer receive broadcasts
    closeHandlers["close"]();
    mockWs.send.mockClear();
    broadcast(EVENTS.CONNECTION_STATUS, { rpc: true, wallet: "abc", balance: 100 });
    expect(mockWs.send).not.toHaveBeenCalled();
  });

  it("broadcast sends to all connected clients", async () => {
    const wssInstance = createMockWss();
    const { setupWebSocket, broadcast } = await import("./broadcaster.js");

    const mockServer = { server: {} } as unknown as Parameters<typeof setupWebSocket>[0];
    setupWebSocket(mockServer);

    const connectionHandler = wssInstance._handlers["connection"] as (ws: { send: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn>; readyState: number }) => void;

    const client1 = { send: vi.fn(), on: vi.fn(), readyState: 1 };
    const client2 = { send: vi.fn(), on: vi.fn(), readyState: 1 };
    connectionHandler(client1);
    connectionHandler(client2);

    const statsPayload = { mode: "volumeMax" as const, trades: 5, volume: 1000, pnl: 50, allocated: 500, remaining: 450 };
    broadcast(EVENTS.STATS_UPDATED, statsPayload);

    expect(client1.send).toHaveBeenCalledTimes(1);
    expect(client2.send).toHaveBeenCalledTimes(1);

    const sent = JSON.parse(client1.send.mock.calls[0][0] as string);
    expect(sent.event).toBe(EVENTS.STATS_UPDATED);
    expect(sent.data).toEqual(statsPayload);
  });
});
