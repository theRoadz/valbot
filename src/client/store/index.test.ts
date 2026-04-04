// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import useStore from "./index";
import { EVENTS } from "@shared/events";

describe("ValBotStore", () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useStore.setState({
      connection: { status: "disconnected", walletBalance: 0 },
      stats: {
        walletBalance: 0,
        totalPnl: 0,
        sessionPnl: 0,
        totalTrades: 0,
        totalVolume: 0,
      },
    });
  });

  it("initializes with disconnected status and zero stats", () => {
    const state = useStore.getState();
    expect(state.connection.status).toBe("disconnected");
    expect(state.connection.walletBalance).toBe(0);
    expect(state.stats.walletBalance).toBe(0);
    expect(state.stats.totalPnl).toBe(0);
    expect(state.stats.sessionPnl).toBe(0);
    expect(state.stats.totalTrades).toBe(0);
    expect(state.stats.totalVolume).toBe(0);
  });

  it("setConnectionStatus updates connection status", () => {
    useStore.getState().setConnectionStatus("connected");
    expect(useStore.getState().connection.status).toBe("connected");

    useStore.getState().setConnectionStatus("reconnecting");
    expect(useStore.getState().connection.status).toBe("reconnecting");

    useStore.getState().setConnectionStatus("disconnected");
    expect(useStore.getState().connection.status).toBe("disconnected");
  });

  it("setWalletBalance updates both connection and stats walletBalance", () => {
    useStore.getState().setWalletBalance(5000000);
    expect(useStore.getState().connection.walletBalance).toBe(5000000);
    expect(useStore.getState().stats.walletBalance).toBe(5000000);
  });

  it("updateConnection updates status based on rpc flag and balance in both places", () => {
    useStore.getState().updateConnection({
      rpc: true,
      wallet: "abc123",
      balance: 10000000,
    });

    const state = useStore.getState();
    expect(state.connection.status).toBe("connected");
    expect(state.connection.walletBalance).toBe(10000000);
    expect(state.stats.walletBalance).toBe(10000000);
  });

  it("updateConnection sets disconnected when rpc is false", () => {
    // First set to connected
    useStore.getState().setConnectionStatus("connected");

    useStore.getState().updateConnection({
      rpc: false,
      wallet: "",
      balance: 0,
    });

    expect(useStore.getState().connection.status).toBe("disconnected");
  });

  it("handleWsMessage dispatches connection.status events", () => {
    useStore.getState().handleWsMessage({
      event: EVENTS.CONNECTION_STATUS,
      timestamp: Date.now(),
      data: { rpc: true, wallet: "wallet123", balance: 7500000 },
    });

    const state = useStore.getState();
    expect(state.connection.status).toBe("connected");
    expect(state.connection.walletBalance).toBe(7500000);
    expect(state.stats.walletBalance).toBe(7500000);
  });

  it("handleWsMessage ignores unknown events", () => {
    const stateBefore = { ...useStore.getState().connection };

    useStore.getState().handleWsMessage({
      event: "unknown.event" as never,
      timestamp: Date.now(),
      data: {},
    });

    expect(useStore.getState().connection).toEqual(stateBefore);
  });
});
