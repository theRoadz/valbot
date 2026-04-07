// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { useWebSocket } from "./use-websocket";
import useStore from "@client/store";

type WsHandler = ((event: { data: string }) => void) | (() => void) | null;

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;
  static CLOSED = 3;

  url: string;
  readyState = MockWebSocket.OPEN;
  onopen: WsHandler = null;
  onmessage: WsHandler = null;
  onclose: WsHandler = null;
  onerror: WsHandler = null;
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  simulateOpen() {
    if (this.onopen) (this.onopen as () => void)();
  }

  simulateMessage(data: unknown) {
    if (this.onmessage) {
      (this.onmessage as (e: { data: string }) => void)({
        data: JSON.stringify(data),
      });
    }
  }

  simulateClose() {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) (this.onclose as () => void)();
  }

  simulateError() {
    if (this.onerror) (this.onerror as () => void)();
  }
}

describe("useWebSocket", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.useFakeTimers();
    useStore.setState({
      initialized: true,
      connection: { status: "disconnected", equity: 0, available: 0 },
      stats: {
        equity: 0,
        available: 0,
        totalPnl: 0,
        sessionPnl: 0,
        totalTrades: 0,
        totalVolume: 0,
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not connect before store is initialized", () => {
    useStore.setState({ initialized: false });
    renderHook(() => useWebSocket());
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it("creates a WebSocket connection on mount", () => {
    renderHook(() => useWebSocket());
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].url).toContain("/ws");
  });

  it("sets status to connected on open", () => {
    renderHook(() => useWebSocket());
    MockWebSocket.instances[0].simulateOpen();
    expect(useStore.getState().connection.status).toBe("connected");
  });

  it("dispatches parsed messages to store", () => {
    renderHook(() => useWebSocket());
    MockWebSocket.instances[0].simulateOpen();

    MockWebSocket.instances[0].simulateMessage({
      event: "connection.status",
      timestamp: Date.now(),
      data: { rpc: true, wallet: "test", equity: 1000000, available: 500000 },
    });

    expect(useStore.getState().connection.equity).toBe(1000000);
  });

  it("attempts reconnection with backoff on close", async () => {
    renderHook(() => useWebSocket());
    MockWebSocket.instances[0].simulateOpen();
    MockWebSocket.instances[0].simulateClose();

    expect(useStore.getState().connection.status).toBe("reconnecting");

    // After 1s backoff, should create a new WebSocket
    await vi.advanceTimersByTimeAsync(1000);
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it("stops reconnecting after max retries", async () => {
    renderHook(() => useWebSocket());
    MockWebSocket.instances[0].simulateOpen();

    // Simulate 5 close events with backoff (no open events = attempts increment)
    for (let i = 0; i < 5; i++) {
      const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
      ws.simulateClose();
      const delay = Math.min(1000 * 2 ** i, 4000);
      await vi.advanceTimersByTimeAsync(delay);
      // New WebSocket created but don't call simulateOpen — simulating failed connections
    }

    // 6th close should not reconnect — attempts exhausted
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    ws.simulateClose();

    expect(useStore.getState().connection.status).toBe("disconnected");

    // No more reconnection attempts
    const countBefore = MockWebSocket.instances.length;
    await vi.advanceTimersByTimeAsync(10000);
    expect(MockWebSocket.instances).toHaveLength(countBefore);
  });

  it("cleans up on unmount", () => {
    const { unmount } = renderHook(() => useWebSocket());
    MockWebSocket.instances[0].simulateOpen();

    const ws = MockWebSocket.instances[0];
    unmount();

    expect(ws.close).toHaveBeenCalled();
  });
});
