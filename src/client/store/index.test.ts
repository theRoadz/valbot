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
      alerts: [],
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

  it("handleWsMessage dispatches alert.triggered events", () => {
    useStore.getState().handleWsMessage({
      event: EVENTS.ALERT_TRIGGERED,
      timestamp: 1000,
      data: {
        severity: "critical",
        code: "TEST_ERROR",
        message: "Something broke",
        details: "More info",
        resolution: "Fix it",
      },
    });

    const alerts = useStore.getState().alerts;
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("critical");
    expect(alerts[0].code).toBe("TEST_ERROR");
    expect(alerts[0].message).toBe("Something broke");
    expect(alerts[0].details).toBe("More info");
    expect(alerts[0].resolution).toBe("Fix it");
    expect(alerts[0].timestamp).toBe(1000);
    expect(alerts[0].id).toBeGreaterThan(0);
  });

  it("handleWsMessage ignores malformed alert.triggered events", () => {
    useStore.getState().handleWsMessage({
      event: EVENTS.ALERT_TRIGGERED,
      timestamp: 1000,
      data: { severity: 123 },
    });

    expect(useStore.getState().alerts).toHaveLength(0);
  });

  it("addAlert adds alert to store", () => {
    useStore.getState().addAlert({
      id: 99,
      severity: "warning",
      code: "WARN",
      message: "Warning",
      details: null,
      resolution: null,
      timestamp: Date.now(),
    });

    expect(useStore.getState().alerts).toHaveLength(1);
    expect(useStore.getState().alerts[0].id).toBe(99);
  });

  it("dismissAlert removes alert by id", () => {
    useStore.getState().addAlert({
      id: 1,
      severity: "warning",
      code: "A",
      message: "A",
      details: null,
      resolution: null,
      timestamp: Date.now(),
    });
    useStore.getState().addAlert({
      id: 2,
      severity: "critical",
      code: "B",
      message: "B",
      details: null,
      resolution: null,
      timestamp: Date.now(),
    });

    useStore.getState().dismissAlert(1);
    const alerts = useStore.getState().alerts;
    expect(alerts).toHaveLength(1);
    expect(alerts[0].id).toBe(2);
  });
});
