// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import useStore from "./index";
import { EVENTS } from "@shared/events";

describe("ValBotStore", () => {
  beforeEach(() => {
    useStore.setState({
      connection: { status: "disconnected", equity: 0, available: 0 },
      stats: {
        equity: 0,
        available: 0,
        totalPnl: 0,
        sessionPnl: 0,
        totalTrades: 0,
        totalVolume: 0,
      },
      alerts: [],
      trades: [],
      positions: [],
      closingPositions: [],
      modes: {
        volumeMax: {
          mode: "volumeMax",
          status: "stopped",
          allocation: 0,
          pairs: ["SOL/USDC"],
          slippage: 0.5,
          stats: { pnl: 0, trades: 0, volume: 0, allocated: 0, remaining: 0 },
          errorDetail: null,
          killSwitchDetail: null,
        },
        profitHunter: {
          mode: "profitHunter",
          status: "stopped",
          allocation: 0,
          pairs: ["SOL/USDC"],
          slippage: 0.5,
          stats: { pnl: 0, trades: 0, volume: 0, allocated: 0, remaining: 0 },
          errorDetail: null,
          killSwitchDetail: null,
        },
        arbitrage: {
          mode: "arbitrage",
          status: "stopped",
          allocation: 0,
          pairs: ["SOL/USDC"],
          slippage: 0.5,
          stats: { pnl: 0, trades: 0, volume: 0, allocated: 0, remaining: 0 },
          errorDetail: null,
          killSwitchDetail: null,
        },
      },
    });
  });

  it("initializes with disconnected status and zero stats", () => {
    const state = useStore.getState();
    expect(state.connection.status).toBe("disconnected");
    expect(state.connection.equity).toBe(0);
    expect(state.stats.equity).toBe(0);
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

  it("updateConnection updates status based on rpc flag and balance in both places", () => {
    useStore.getState().updateConnection({
      rpc: true,
      wallet: "abc123",
      equity: 10000000,
      available: 5000000,
    });

    const state = useStore.getState();
    expect(state.connection.status).toBe("connected");
    expect(state.connection.equity).toBe(10000000);
    expect(state.connection.available).toBe(5000000);
    expect(state.stats.equity).toBe(10000000);
    expect(state.stats.available).toBe(5000000);
  });

  it("updateConnection sets disconnected when rpc is false", () => {
    useStore.getState().setConnectionStatus("connected");

    useStore.getState().updateConnection({
      rpc: false,
      wallet: "",
      equity: 0,
      available: 0,
    });

    expect(useStore.getState().connection.status).toBe("disconnected");
  });

  it("handleWsMessage dispatches connection.status events", () => {
    useStore.getState().handleWsMessage({
      event: EVENTS.CONNECTION_STATUS,
      timestamp: Date.now(),
      data: { rpc: true, wallet: "wallet123", equity: 7500000, available: 3000000 },
    });

    const state = useStore.getState();
    expect(state.connection.status).toBe("connected");
    expect(state.connection.equity).toBe(7500000);
    expect(state.connection.available).toBe(3000000);
    expect(state.stats.equity).toBe(7500000);
    expect(state.stats.available).toBe(3000000);
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

  // Mode state tests
  describe("modes", () => {
    it("initializes with default mode state", () => {
      const modes = useStore.getState().modes;
      expect(modes.volumeMax.status).toBe("stopped");
      expect(modes.volumeMax.allocation).toBe(0);
      expect(modes.volumeMax.pairs).toEqual(["SOL/USDC"]);
      expect(modes.volumeMax.slippage).toBe(0.5);
      expect(modes.volumeMax.stats.pnl).toBe(0);
      expect(modes.volumeMax.errorDetail).toBeNull();
      expect(modes.volumeMax.killSwitchDetail).toBeNull();
    });

    it("setModeStatus updates correct mode and clears errorDetail on non-error transition", () => {
      // First set to error with detail
      useStore.setState((s) => ({
        modes: {
          ...s.modes,
          volumeMax: {
            ...s.modes.volumeMax,
            status: "error",
            errorDetail: { code: "E", message: "err", details: null },
          },
        },
      }));

      useStore.getState().setModeStatus("volumeMax", "stopped");
      const mode = useStore.getState().modes.volumeMax;
      expect(mode.status).toBe("stopped");
      expect(mode.errorDetail).toBeNull();
    });

    it("updateModeStats updates correct mode stats", () => {
      const newStats = { pnl: 100, trades: 5, volume: 5000, allocated: 1000, remaining: 500 };
      useStore.getState().updateModeStats("volumeMax", newStats);
      expect(useStore.getState().modes.volumeMax.stats).toEqual(newStats);
      // Other modes unaffected
      expect(useStore.getState().modes.profitHunter.stats.pnl).toBe(0);
    });

    it("handleWsMessage MODE_STARTED sets status to running, clears errorDetail", () => {
      useStore.setState((s) => ({
        modes: {
          ...s.modes,
          volumeMax: {
            ...s.modes.volumeMax,
            status: "starting",
            errorDetail: { code: "E", message: "old", details: null },
          },
        },
      }));

      useStore.getState().handleWsMessage({
        event: EVENTS.MODE_STARTED,
        timestamp: Date.now(),
        data: { mode: "volumeMax" },
      });

      const mode = useStore.getState().modes.volumeMax;
      expect(mode.status).toBe("running");
      expect(mode.errorDetail).toBeNull();
    });

    it("handleWsMessage MODE_STOPPED sets status to stopped and updates stats", () => {
      useStore.setState((s) => ({
        modes: { ...s.modes, volumeMax: { ...s.modes.volumeMax, status: "running" } },
      }));

      const finalStats = { pnl: 50, trades: 10, volume: 2000, allocated: 500, remaining: 450 };
      useStore.getState().handleWsMessage({
        event: EVENTS.MODE_STOPPED,
        timestamp: Date.now(),
        data: { mode: "volumeMax", finalStats },
      });

      const mode = useStore.getState().modes.volumeMax;
      expect(mode.status).toBe("stopped");
      expect(mode.stats).toEqual(finalStats);
    });

    it("handleWsMessage MODE_ERROR sets status to error and stores errorDetail", () => {
      useStore.getState().handleWsMessage({
        event: EVENTS.MODE_ERROR,
        timestamp: Date.now(),
        data: {
          mode: "volumeMax",
          error: { code: "CHAIN_ERR", message: "RPC unavailable", details: "timeout" },
        },
      });

      const mode = useStore.getState().modes.volumeMax;
      expect(mode.status).toBe("error");
      expect(mode.errorDetail).toEqual({ code: "CHAIN_ERR", message: "RPC unavailable", details: "timeout" });
    });

    it("handleWsMessage STATS_UPDATED updates mode stats", () => {
      useStore.getState().handleWsMessage({
        event: EVENTS.STATS_UPDATED,
        timestamp: Date.now(),
        data: { mode: "profitHunter", pnl: 200, trades: 15, volume: 8000, allocated: 2000, remaining: 1800 },
      });

      const stats = useStore.getState().modes.profitHunter.stats;
      expect(stats.pnl).toBe(200);
      expect(stats.trades).toBe(15);
      expect(stats.volume).toBe(8000);
    });

    it("handleWsMessage ignores events for unknown modes (race condition guard)", () => {
      const stateBefore = { ...useStore.getState().modes };

      useStore.getState().handleWsMessage({
        event: EVENTS.MODE_STARTED,
        timestamp: Date.now(),
        data: { mode: "unknownMode" },
      });

      expect(useStore.getState().modes).toEqual(stateBefore);
    });

    it("loadInitialStatus hydrates all mode configs", () => {
      useStore.getState().loadInitialStatus({
        modes: {
          volumeMax: {
            mode: "volumeMax",
            status: "running",
            allocation: 500,
            pairs: ["SOL/USDC", "ETH/USDC"],
            slippage: 1.0,
            stats: { pnl: 100, trades: 5, volume: 3000, allocated: 500, remaining: 400 },
          },
          profitHunter: {
            mode: "profitHunter",
            status: "stopped",
            allocation: 0,
            pairs: ["SOL/USDC"],
            slippage: 0.5,
            stats: { pnl: 0, trades: 0, volume: 0, allocated: 0, remaining: 0 },
          },
          arbitrage: {
            mode: "arbitrage",
            status: "stopped",
            allocation: 0,
            pairs: ["SOL/USDC"],
            slippage: 0.5,
            stats: { pnl: 0, trades: 0, volume: 0, allocated: 0, remaining: 0 },
          },
        },
        positions: [],
        trades: [],
        connection: { status: "connected", equity: 5000, available: 0 },
      });

      const state = useStore.getState();
      expect(state.modes.volumeMax.status).toBe("running");
      expect(state.modes.volumeMax.allocation).toBe(500);
      expect(state.modes.volumeMax.stats.pnl).toBe(100);
      expect(state.connection.status).toBe("connected");
      expect(state.connection.equity).toBe(5000);
    });

    it("loadInitialStatus sets stats.equity from connection data", () => {
      useStore.getState().loadInitialStatus({
        modes: {
          volumeMax: {
            mode: "volumeMax",
            status: "stopped",
            allocation: 0,
            pairs: ["SOL/USDC"],
            slippage: 0.5,
            stats: { pnl: 0, trades: 0, volume: 0, allocated: 0, remaining: 0 },
          },
          profitHunter: {
            mode: "profitHunter",
            status: "stopped",
            allocation: 0,
            pairs: ["SOL/USDC"],
            slippage: 0.5,
            stats: { pnl: 0, trades: 0, volume: 0, allocated: 0, remaining: 0 },
          },
          arbitrage: {
            mode: "arbitrage",
            status: "stopped",
            allocation: 0,
            pairs: ["SOL/USDC"],
            slippage: 0.5,
            stats: { pnl: 0, trades: 0, volume: 0, allocated: 0, remaining: 0 },
          },
        },
        positions: [],
        trades: [],
        connection: { status: "connected", equity: 9999000, available: 0 },
      });

      expect(useStore.getState().stats.equity).toBe(9999000);
    });

    it("loadInitialStatus populates aggregated stats from mode stats", () => {
      useStore.getState().loadInitialStatus({
        modes: {
          volumeMax: {
            mode: "volumeMax",
            status: "running",
            allocation: 500,
            pairs: ["SOL/USDC"],
            slippage: 0.5,
            stats: { pnl: 100, trades: 5, volume: 3000, allocated: 500, remaining: 400 },
          },
          profitHunter: {
            mode: "profitHunter",
            status: "running",
            allocation: 300,
            pairs: ["SOL/USDC"],
            slippage: 0.5,
            stats: { pnl: 50, trades: 3, volume: 1000, allocated: 300, remaining: 250 },
          },
          arbitrage: {
            mode: "arbitrage",
            status: "stopped",
            allocation: 0,
            pairs: ["SOL/USDC"],
            slippage: 0.5,
            stats: { pnl: 0, trades: 0, volume: 0, allocated: 0, remaining: 0 },
          },
        },
        positions: [],
        trades: [],
        connection: { status: "connected", equity: 7000, available: 0 },
      });

      const stats = useStore.getState().stats;
      expect(stats.totalPnl).toBe(150); // 100 + 50
      expect(stats.sessionPnl).toBe(150);
      expect(stats.totalTrades).toBe(8); // 5 + 3
      expect(stats.totalVolume).toBe(4000); // 3000 + 1000
      expect(stats.equity).toBe(7000);
    });

    it("STATS_UPDATED recalculates aggregated summary stats", () => {
      // Set some initial stats on profitHunter
      useStore.setState((s) => ({
        modes: {
          ...s.modes,
          profitHunter: {
            ...s.modes.profitHunter,
            stats: { pnl: 50, trades: 3, volume: 1000, allocated: 300, remaining: 250 },
          },
        },
      }));

      useStore.getState().handleWsMessage({
        event: EVENTS.STATS_UPDATED,
        timestamp: Date.now(),
        data: { mode: "volumeMax", pnl: 200, trades: 15, volume: 8000, allocated: 2000, remaining: 1800 },
      });

      const stats = useStore.getState().stats;
      expect(stats.totalPnl).toBe(250); // 200 + 50
      expect(stats.totalTrades).toBe(18); // 15 + 3
      expect(stats.totalVolume).toBe(9000); // 8000 + 1000
    });

    it("MODE_STOPPED with finalStats recalculates aggregated summary stats", () => {
      // Set volumeMax as running with stats
      useStore.setState((s) => ({
        modes: {
          ...s.modes,
          volumeMax: {
            ...s.modes.volumeMax,
            status: "running",
            stats: { pnl: 100, trades: 10, volume: 5000, allocated: 1000, remaining: 500 },
          },
          profitHunter: {
            ...s.modes.profitHunter,
            stats: { pnl: 30, trades: 2, volume: 500, allocated: 200, remaining: 170 },
          },
        },
      }));

      const finalStats = { pnl: 120, trades: 12, volume: 6000, allocated: 1000, remaining: 400 };
      useStore.getState().handleWsMessage({
        event: EVENTS.MODE_STOPPED,
        timestamp: Date.now(),
        data: { mode: "volumeMax", finalStats },
      });

      const stats = useStore.getState().stats;
      expect(stats.totalPnl).toBe(150); // 120 + 30
      expect(stats.totalTrades).toBe(14); // 12 + 2
      expect(stats.totalVolume).toBe(6500); // 6000 + 500
    });

    it("stats.equity comes from connection events not mode stats", () => {
      useStore.getState().handleWsMessage({
        event: EVENTS.CONNECTION_STATUS,
        timestamp: Date.now(),
        data: { rpc: true, wallet: "wallet1", equity: 5000000, available: 2000000 },
      });

      expect(useStore.getState().stats.equity).toBe(5000000);

      // STATS_UPDATED should NOT change walletBalance
      useStore.getState().handleWsMessage({
        event: EVENTS.STATS_UPDATED,
        timestamp: Date.now(),
        data: { mode: "volumeMax", pnl: 100, trades: 5, volume: 3000, allocated: 500, remaining: 400 },
      });

      expect(useStore.getState().stats.equity).toBe(5000000);
    });

    it("aggregation works correctly when one mode has zero stats", () => {
      useStore.getState().handleWsMessage({
        event: EVENTS.STATS_UPDATED,
        timestamp: Date.now(),
        data: { mode: "volumeMax", pnl: 300, trades: 20, volume: 10000, allocated: 2000, remaining: 1700 },
      });

      const stats = useStore.getState().stats;
      // profitHunter and arbitrage are zero
      expect(stats.totalPnl).toBe(300);
      expect(stats.totalTrades).toBe(20);
      expect(stats.totalVolume).toBe(10000);
    });

    it("aggregation reflects stopped mode finalStats while others continue", () => {
      // volumeMax running
      useStore.getState().handleWsMessage({
        event: EVENTS.STATS_UPDATED,
        timestamp: Date.now(),
        data: { mode: "volumeMax", pnl: 200, trades: 10, volume: 5000, allocated: 1000, remaining: 800 },
      });
      // profitHunter running
      useStore.getState().handleWsMessage({
        event: EVENTS.STATS_UPDATED,
        timestamp: Date.now(),
        data: { mode: "profitHunter", pnl: 80, trades: 4, volume: 2000, allocated: 500, remaining: 420 },
      });

      // Stop volumeMax with final stats
      useStore.getState().handleWsMessage({
        event: EVENTS.MODE_STOPPED,
        timestamp: Date.now(),
        data: { mode: "volumeMax", finalStats: { pnl: 220, trades: 11, volume: 5500, allocated: 1000, remaining: 780 } },
      });

      const stats = useStore.getState().stats;
      expect(stats.totalPnl).toBe(300); // 220 + 80
      expect(stats.totalTrades).toBe(15); // 11 + 4
      expect(stats.totalVolume).toBe(7500); // 5500 + 2000
    });

    it("updateModeStats recalculates aggregated summary stats", () => {
      const newStats = { pnl: 100, trades: 5, volume: 5000, allocated: 1000, remaining: 500 };
      useStore.getState().updateModeStats("volumeMax", newStats);

      const stats = useStore.getState().stats;
      expect(stats.totalPnl).toBe(100);
      expect(stats.totalTrades).toBe(5);
      expect(stats.totalVolume).toBe(5000);
    });

    it("STATS_UPDATED rejects NaN and Infinity values", () => {
      useStore.getState().handleWsMessage({
        event: EVENTS.STATS_UPDATED,
        timestamp: Date.now(),
        data: { mode: "volumeMax", pnl: NaN, trades: 5, volume: 5000, allocated: 1000, remaining: 500 },
      });
      expect(useStore.getState().modes.volumeMax.stats.pnl).toBe(0);

      useStore.getState().handleWsMessage({
        event: EVENTS.STATS_UPDATED,
        timestamp: Date.now(),
        data: { mode: "volumeMax", pnl: 100, trades: Infinity, volume: 5000, allocated: 1000, remaining: 500 },
      });
      expect(useStore.getState().modes.volumeMax.stats.trades).toBe(0);
    });

    it("TRADE_EXECUTED appends trade to trades array", () => {
      useStore.getState().handleWsMessage({
        event: EVENTS.TRADE_EXECUTED,
        timestamp: 1000,
        data: { mode: "volumeMax", pair: "SOL-PERP", side: "Long", size: 100, price: 150, pnl: 0, fees: 0.5 },
      });

      const trades = useStore.getState().trades;
      expect(trades).toHaveLength(1);
      expect(trades[0].mode).toBe("volumeMax");
      expect(trades[0].pair).toBe("SOL-PERP");
      expect(trades[0].side).toBe("Long");
      expect(trades[0].size).toBe(100);
      expect(trades[0].price).toBe(150);
      expect(trades[0].pnl).toBe(0);
      expect(trades[0].fees).toBe(0.5);
      expect(trades[0].timestamp).toBe(1000);
      expect(trades[0].id).toBeGreaterThan(0);
    });

    it("TRADE_EXECUTED appends new trades (newest last)", () => {
      useStore.getState().handleWsMessage({
        event: EVENTS.TRADE_EXECUTED,
        timestamp: 1000,
        data: { mode: "volumeMax", pair: "SOL-PERP", side: "Long", size: 100, price: 150, pnl: 0, fees: 0.5 },
      });
      useStore.getState().handleWsMessage({
        event: EVENTS.TRADE_EXECUTED,
        timestamp: 2000,
        data: { mode: "profitHunter", pair: "ETH-PERP", side: "Short", size: 50, price: 3000, pnl: 0, fees: 1.0 },
      });

      const trades = useStore.getState().trades;
      expect(trades).toHaveLength(2);
      expect(trades[0].pair).toBe("SOL-PERP");
      expect(trades[1].pair).toBe("ETH-PERP");
    });

    it("TRADE_EXECUTED enforces 500-entry cap", () => {
      // Fill with 500 trades
      for (let i = 0; i < 500; i++) {
        useStore.getState().handleWsMessage({
          event: EVENTS.TRADE_EXECUTED,
          timestamp: i,
          data: { mode: "volumeMax", pair: "SOL-PERP", side: "Long", size: 1, price: 1, pnl: 0, fees: 0 },
        });
      }
      expect(useStore.getState().trades).toHaveLength(500);

      // Add one more
      useStore.getState().handleWsMessage({
        event: EVENTS.TRADE_EXECUTED,
        timestamp: 9999,
        data: { mode: "volumeMax", pair: "ETH-PERP", side: "Short", size: 1, price: 1, pnl: 0, fees: 0 },
      });

      const trades = useStore.getState().trades;
      expect(trades).toHaveLength(500);
      expect(trades[499].pair).toBe("ETH-PERP"); // newest is last
    });

    it("TRADE_EXECUTED validates payload fields with typeof guards", () => {
      // Missing mode
      useStore.getState().handleWsMessage({
        event: EVENTS.TRADE_EXECUTED,
        timestamp: 1000,
        data: { pair: "SOL-PERP", side: "Long", size: 100, price: 150, pnl: 0, fees: 0.5 },
      });
      expect(useStore.getState().trades).toHaveLength(0);

      // Invalid side
      useStore.getState().handleWsMessage({
        event: EVENTS.TRADE_EXECUTED,
        timestamp: 1000,
        data: { mode: "volumeMax", pair: "SOL-PERP", side: "invalid", size: 100, price: 150, pnl: 0, fees: 0.5 },
      });
      expect(useStore.getState().trades).toHaveLength(0);

      // Non-number size
      useStore.getState().handleWsMessage({
        event: EVENTS.TRADE_EXECUTED,
        timestamp: 1000,
        data: { mode: "volumeMax", pair: "SOL-PERP", side: "Long", size: "100", price: 150, pnl: 0, fees: 0.5 },
      });
      expect(useStore.getState().trades).toHaveLength(0);

      // Unknown mode
      useStore.getState().handleWsMessage({
        event: EVENTS.TRADE_EXECUTED,
        timestamp: 1000,
        data: { mode: "unknownMode", pair: "SOL-PERP", side: "Long", size: 100, price: 150, pnl: 0, fees: 0.5 },
      });
      expect(useStore.getState().trades).toHaveLength(0);

      // NaN size
      useStore.getState().handleWsMessage({
        event: EVENTS.TRADE_EXECUTED,
        timestamp: 1000,
        data: { mode: "volumeMax", pair: "SOL-PERP", side: "Long", size: NaN, price: 150, pnl: 0, fees: 0.5 },
      });
      expect(useStore.getState().trades).toHaveLength(0);

      // Infinity price
      useStore.getState().handleWsMessage({
        event: EVENTS.TRADE_EXECUTED,
        timestamp: 1000,
        data: { mode: "volumeMax", pair: "SOL-PERP", side: "Long", size: 100, price: Infinity, pnl: 0, fees: 0.5 },
      });
      expect(useStore.getState().trades).toHaveLength(0);

      // Empty pair
      useStore.getState().handleWsMessage({
        event: EVENTS.TRADE_EXECUTED,
        timestamp: 1000,
        data: { mode: "volumeMax", pair: "", side: "Long", size: 100, price: 150, pnl: 0, fees: 0.5 },
      });
      expect(useStore.getState().trades).toHaveLength(0);
    });

    it("loadInitialStatus populates trades", () => {
      const trades = [
        { id: 1, mode: "volumeMax" as const, pair: "SOL-PERP", side: "Long" as const, size: 100, price: 150, pnl: 0, fees: 0.5, timestamp: 1000 },
        { id: 2, mode: "profitHunter" as const, pair: "ETH-PERP", side: "Short" as const, size: 50, price: 3000, pnl: 14.2, fees: 1.0, timestamp: 2000 },
      ];
      useStore.getState().loadInitialStatus({
        modes: {
          volumeMax: { mode: "volumeMax", status: "stopped", allocation: 0, pairs: ["SOL/USDC"], slippage: 0.5, stats: { pnl: 0, trades: 0, volume: 0, allocated: 0, remaining: 0 } },
          profitHunter: { mode: "profitHunter", status: "stopped", allocation: 0, pairs: ["SOL/USDC"], slippage: 0.5, stats: { pnl: 0, trades: 0, volume: 0, allocated: 0, remaining: 0 } },
          arbitrage: { mode: "arbitrage", status: "stopped", allocation: 0, pairs: ["SOL/USDC"], slippage: 0.5, stats: { pnl: 0, trades: 0, volume: 0, allocated: 0, remaining: 0 } },
        },
        positions: [],
        trades,
        connection: { status: "connected", equity: 5000, available: 0 },
      });

      expect(useStore.getState().trades).toHaveLength(2);
      expect(useStore.getState().trades[0].pair).toBe("SOL-PERP");
    });

    it("POSITION_OPENED adds position to positions array", () => {
      useStore.getState().handleWsMessage({
        event: EVENTS.POSITION_OPENED,
        timestamp: 5000,
        data: { mode: "volumeMax", pair: "SOL-PERP", side: "Long", size: 100, entryPrice: 150, stopLoss: 140 },
      });

      const positions = useStore.getState().positions;
      expect(positions).toHaveLength(1);
      expect(positions[0].mode).toBe("volumeMax");
      expect(positions[0].pair).toBe("SOL-PERP");
      expect(positions[0].side).toBe("Long");
      expect(positions[0].size).toBe(100);
      expect(positions[0].entryPrice).toBe(150);
      expect(positions[0].stopLoss).toBe(140);
      expect(positions[0].timestamp).toBe(5000);
      expect(positions[0].id).toBeGreaterThan(0);
    });

    it("POSITION_OPENED validates payload — rejects invalid mode", () => {
      useStore.getState().handleWsMessage({
        event: EVENTS.POSITION_OPENED,
        timestamp: 1000,
        data: { mode: "unknownMode", pair: "SOL-PERP", side: "Long", size: 100, entryPrice: 150, stopLoss: 140 },
      });
      expect(useStore.getState().positions).toHaveLength(0);
    });

    it("POSITION_OPENED validates payload — rejects invalid side", () => {
      useStore.getState().handleWsMessage({
        event: EVENTS.POSITION_OPENED,
        timestamp: 1000,
        data: { mode: "volumeMax", pair: "SOL-PERP", side: "invalid", size: 100, entryPrice: 150, stopLoss: 140 },
      });
      expect(useStore.getState().positions).toHaveLength(0);
    });

    it("POSITION_OPENED validates payload — rejects empty pair", () => {
      useStore.getState().handleWsMessage({
        event: EVENTS.POSITION_OPENED,
        timestamp: 1000,
        data: { mode: "volumeMax", pair: "", side: "Long", size: 100, entryPrice: 150, stopLoss: 140 },
      });
      expect(useStore.getState().positions).toHaveLength(0);
    });

    it("POSITION_OPENED validates payload — rejects NaN/Infinity numbers", () => {
      useStore.getState().handleWsMessage({
        event: EVENTS.POSITION_OPENED,
        timestamp: 1000,
        data: { mode: "volumeMax", pair: "SOL-PERP", side: "Long", size: NaN, entryPrice: 150, stopLoss: 140 },
      });
      expect(useStore.getState().positions).toHaveLength(0);

      useStore.getState().handleWsMessage({
        event: EVENTS.POSITION_OPENED,
        timestamp: 1000,
        data: { mode: "volumeMax", pair: "SOL-PERP", side: "Long", size: 100, entryPrice: Infinity, stopLoss: 140 },
      });
      expect(useStore.getState().positions).toHaveLength(0);

      useStore.getState().handleWsMessage({
        event: EVENTS.POSITION_OPENED,
        timestamp: 1000,
        data: { mode: "volumeMax", pair: "SOL-PERP", side: "Long", size: 100, entryPrice: 150, stopLoss: NaN },
      });
      expect(useStore.getState().positions).toHaveLength(0);
    });

    it("POSITION_OPENED validates payload — rejects non-number fields", () => {
      useStore.getState().handleWsMessage({
        event: EVENTS.POSITION_OPENED,
        timestamp: 1000,
        data: { mode: "volumeMax", pair: "SOL-PERP", side: "Long", size: "100", entryPrice: 150, stopLoss: 140 },
      });
      expect(useStore.getState().positions).toHaveLength(0);
    });

    it("POSITION_CLOSED removes matching position after delay", async () => {
      // Add a position first
      useStore.getState().handleWsMessage({
        event: EVENTS.POSITION_OPENED,
        timestamp: 1000,
        data: { mode: "volumeMax", pair: "SOL-PERP", side: "Long", size: 100, entryPrice: 150, stopLoss: 140 },
      });
      expect(useStore.getState().positions).toHaveLength(1);

      // Close it
      useStore.getState().handleWsMessage({
        event: EVENTS.POSITION_CLOSED,
        timestamp: 2000,
        data: { mode: "volumeMax", pair: "SOL-PERP", side: "Long", size: 100, exitPrice: 160, pnl: 10 },
      });

      // Should be in closingPositions immediately
      expect(useStore.getState().closingPositions).toHaveLength(1);
      // Position still in array (for animation)
      expect(useStore.getState().positions).toHaveLength(1);

      // After 300ms timeout, position should be removed
      await new Promise((r) => setTimeout(r, 350));
      expect(useStore.getState().positions).toHaveLength(0);
      expect(useStore.getState().closingPositions).toHaveLength(0);
    });

    it("POSITION_CLOSED ignores when no matching position found", () => {
      useStore.getState().handleWsMessage({
        event: EVENTS.POSITION_CLOSED,
        timestamp: 2000,
        data: { mode: "volumeMax", pair: "SOL-PERP", side: "Long", size: 100, exitPrice: 160, pnl: 10 },
      });

      expect(useStore.getState().positions).toHaveLength(0);
      expect(useStore.getState().closingPositions).toHaveLength(0);
    });

    it("POSITION_CLOSED validates payload — rejects invalid data", () => {
      // Add a position first
      useStore.getState().handleWsMessage({
        event: EVENTS.POSITION_OPENED,
        timestamp: 1000,
        data: { mode: "volumeMax", pair: "SOL-PERP", side: "Long", size: 100, entryPrice: 150, stopLoss: 140 },
      });

      // Try to close with invalid mode
      useStore.getState().handleWsMessage({
        event: EVENTS.POSITION_CLOSED,
        timestamp: 2000,
        data: { mode: "unknownMode", pair: "SOL-PERP", side: "Long", size: 100, exitPrice: 160, pnl: 10 },
      });
      expect(useStore.getState().closingPositions).toHaveLength(0);

      // Try to close with NaN exitPrice
      useStore.getState().handleWsMessage({
        event: EVENTS.POSITION_CLOSED,
        timestamp: 2000,
        data: { mode: "volumeMax", pair: "SOL-PERP", side: "Long", size: 100, exitPrice: NaN, pnl: 10 },
      });
      expect(useStore.getState().closingPositions).toHaveLength(0);
    });

    it("loadInitialStatus populates positions", () => {
      const positions = [
        { id: 10, mode: "volumeMax" as const, pair: "SOL-PERP", side: "Long" as const, size: 100, entryPrice: 150, stopLoss: 140, timestamp: 1000 },
        { id: 20, mode: "profitHunter" as const, pair: "ETH-PERP", side: "Short" as const, size: 50, entryPrice: 3000, stopLoss: 3100, timestamp: 2000 },
      ];
      useStore.getState().loadInitialStatus({
        modes: {
          volumeMax: { mode: "volumeMax", status: "running", allocation: 500, pairs: ["SOL/USDC"], slippage: 0.5, stats: { pnl: 0, trades: 0, volume: 0, allocated: 0, remaining: 0 } },
          profitHunter: { mode: "profitHunter", status: "stopped", allocation: 0, pairs: ["SOL/USDC"], slippage: 0.5, stats: { pnl: 0, trades: 0, volume: 0, allocated: 0, remaining: 0 } },
          arbitrage: { mode: "arbitrage", status: "stopped", allocation: 0, pairs: ["SOL/USDC"], slippage: 0.5, stats: { pnl: 0, trades: 0, volume: 0, allocated: 0, remaining: 0 } },
        },
        positions,
        trades: [],
        connection: { status: "connected", equity: 5000, available: 0 },
      });

      expect(useStore.getState().positions).toHaveLength(2);
      expect(useStore.getState().positions[0].pair).toBe("SOL-PERP");
      expect(useStore.getState().positions[1].pair).toBe("ETH-PERP");
    });

    it("MODE_STOPPED does NOT overwrite kill-switch status", () => {
      // Set mode to kill-switch first
      useStore.setState((s) => ({
        modes: {
          ...s.modes,
          volumeMax: {
            ...s.modes.volumeMax,
            status: "kill-switch",
            killSwitchDetail: { positionsClosed: 2, lossAmount: 100 },
          },
        },
      }));

      // Receive MODE_STOPPED (from forceStop after kill-switch)
      useStore.getState().handleWsMessage({
        event: EVENTS.MODE_STOPPED,
        timestamp: Date.now(),
        data: { mode: "volumeMax", finalStats: { pnl: -100, trades: 5, volume: 500, allocated: 1000, remaining: 0 } },
      });

      const mode = useStore.getState().modes.volumeMax;
      expect(mode.status).toBe("kill-switch"); // NOT "stopped"
      expect(mode.killSwitchDetail).toEqual({ positionsClosed: 2, lossAmount: 100 });
    });

    it("kill-switch state clears when allocation is updated via setModeConfig", () => {
      // Set mode to kill-switch
      useStore.setState((s) => ({
        modes: {
          ...s.modes,
          volumeMax: {
            ...s.modes.volumeMax,
            status: "kill-switch",
            killSwitchDetail: { positionsClosed: 3, lossAmount: 150 },
          },
        },
      }));

      // Update allocation
      useStore.getState().setModeConfig("volumeMax", { allocation: 500 });

      const mode = useStore.getState().modes.volumeMax;
      expect(mode.status).toBe("stopped");
      expect(mode.killSwitchDetail).toBeNull();
      expect(mode.allocation).toBe(500);
    });

    it("setModeConfig does NOT clear kill-switch when non-allocation config changes", () => {
      useStore.setState((s) => ({
        modes: {
          ...s.modes,
          volumeMax: {
            ...s.modes.volumeMax,
            status: "kill-switch",
            killSwitchDetail: { positionsClosed: 2, lossAmount: 100 },
          },
        },
      }));

      // Update only pairs, not allocation
      useStore.getState().setModeConfig("volumeMax", { pairs: ["ETH/USDC"] });

      const mode = useStore.getState().modes.volumeMax;
      expect(mode.status).toBe("kill-switch");
      expect(mode.killSwitchDetail).toEqual({ positionsClosed: 2, lossAmount: 100 });
    });

    it("ALERT_TRIGGERED with KILL_SWITCH_TRIGGERED sets mode to kill-switch", () => {
      useStore.getState().handleWsMessage({
        event: EVENTS.ALERT_TRIGGERED,
        timestamp: Date.now(),
        data: {
          severity: "critical",
          code: "KILL_SWITCH_TRIGGERED",
          message: "Kill switch activated",
          details: null,
          resolution: "Review positions",
          mode: "volumeMax",
          positionsClosed: 3,
          lossAmount: 150,
        },
      });

      const mode = useStore.getState().modes.volumeMax;
      expect(mode.status).toBe("kill-switch");
      expect(mode.killSwitchDetail).toEqual({ positionsClosed: 3, lossAmount: 150 });
    });

    it("full kill-switch WS event sequence: ALERT_TRIGGERED → MODE_STOPPED preserves kill-switch status", () => {
      // Simulate the full event sequence that happens during a kill-switch
      // 1. POSITION_CLOSED events (positions being closed by kill-switch)
      useStore.getState().handleWsMessage({
        event: EVENTS.POSITION_OPENED,
        timestamp: 1000,
        data: { mode: "volumeMax", pair: "SOL-PERP", side: "Long", size: 100, entryPrice: 150, stopLoss: 140 },
      });

      useStore.getState().handleWsMessage({
        event: EVENTS.POSITION_CLOSED,
        timestamp: 2000,
        data: { mode: "volumeMax", pair: "SOL-PERP", side: "Long", size: 100, exitPrice: 130, pnl: -20 },
      });

      // 2. ALERT_TRIGGERED with KILL_SWITCH_TRIGGERED (sets status to kill-switch)
      useStore.getState().handleWsMessage({
        event: EVENTS.ALERT_TRIGGERED,
        timestamp: 3000,
        data: {
          severity: "critical",
          code: "KILL_SWITCH_TRIGGERED",
          message: "Kill switch triggered on volumeMax",
          mode: "volumeMax",
          details: "Closed 1 positions. Loss: $20.00.",
          resolution: "Review positions and re-allocate funds.",
          positionsClosed: 1,
          lossAmount: 20,
        },
      });

      expect(useStore.getState().modes.volumeMax.status).toBe("kill-switch");

      // 3. MODE_STOPPED (from forceStop — should NOT overwrite kill-switch)
      useStore.getState().handleWsMessage({
        event: EVENTS.MODE_STOPPED,
        timestamp: 3001,
        data: { mode: "volumeMax", finalStats: { pnl: -20, trades: 1, volume: 100, allocated: 1000, remaining: 0 } },
      });

      // Status should STILL be kill-switch, NOT stopped
      const mode = useStore.getState().modes.volumeMax;
      expect(mode.status).toBe("kill-switch");
      expect(mode.killSwitchDetail).toEqual({ positionsClosed: 1, lossAmount: 20 });
    });

    it("multi-mode: kill-switch on one mode does not affect other modes", () => {
      // Set up two modes as running
      useStore.setState((s) => ({
        modes: {
          ...s.modes,
          volumeMax: { ...s.modes.volumeMax, status: "running", stats: { pnl: 100, trades: 5, volume: 5000, allocated: 1000, remaining: 800 } },
          profitHunter: { ...s.modes.profitHunter, status: "running", stats: { pnl: 50, trades: 3, volume: 2000, allocated: 500, remaining: 450 } },
        },
      }));

      // Kill-switch on volumeMax
      useStore.getState().handleWsMessage({
        event: EVENTS.ALERT_TRIGGERED,
        timestamp: Date.now(),
        data: {
          severity: "critical",
          code: "KILL_SWITCH_TRIGGERED",
          message: "Kill switch triggered on volumeMax",
          mode: "volumeMax",
          details: null,
          resolution: "Review positions.",
          positionsClosed: 2,
          lossAmount: 100,
        },
      });

      // volumeMax should be kill-switched
      expect(useStore.getState().modes.volumeMax.status).toBe("kill-switch");

      // profitHunter should be completely unaffected
      expect(useStore.getState().modes.profitHunter.status).toBe("running");
      expect(useStore.getState().modes.profitHunter.stats.pnl).toBe(50);
      expect(useStore.getState().modes.profitHunter.stats.trades).toBe(3);
    });
  });
});
