// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import useStore from "./index";
import { EVENTS } from "@shared/events";
import type { StrategyInfo, ModeStatus } from "@shared/types";

const TEST_STRATEGIES: StrategyInfo[] = [
  { name: "Volume Max", description: "Volume maximization", modeType: "volumeMax", urlSlug: "volume-max", modeColor: "#8b5cf6", status: "stopped" as ModeStatus },
  { name: "Profit Hunter", description: "Profit hunting", modeType: "profitHunter", urlSlug: "profit-hunter", modeColor: "#22c55e", status: "stopped" as ModeStatus },
  { name: "Arbitrage", description: "Arbitrage trading", modeType: "arbitrage", urlSlug: "arbitrage", modeColor: "#06b6d4", status: "stopped" as ModeStatus },
];

describe("ValBotStore", () => {
  beforeEach(() => {
    useStore.setState({
      connection: { status: "disconnected", equity: 0, available: 0 },
      historicalPnlBase: 0,
      historicalTradesBase: 0,
      historicalVolumeBase: 0,
      strategies: TEST_STRATEGIES,
      stats: {
        equity: 0,
        available: 0,
        totalPnl: 0,
        sessionPnl: 0,
        totalTrades: 0,
        totalVolume: 0,
      },
      alerts: [],
      toastQueue: [],
      trades: [],
      positions: [],
      closingPositions: [],
      tradeHistory: {
        trades: [],
        total: 0,
        page: 0,
        loading: false,
      },
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
        strategies: TEST_STRATEGIES,
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
        strategies: TEST_STRATEGIES,
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
        strategies: TEST_STRATEGIES,
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
      expect(trades[0].id).toBeLessThan(0);
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
        strategies: TEST_STRATEGIES,
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
        strategies: TEST_STRATEGIES,
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

  describe("API_CONNECTION_FAILED alert → connection status", () => {
    it("warning alert sets connection status to reconnecting", () => {
      useStore.getState().setConnectionStatus("connected");

      useStore.getState().handleWsMessage({
        event: EVENTS.ALERT_TRIGGERED,
        timestamp: Date.now(),
        data: {
          severity: "warning",
          code: "API_CONNECTION_FAILED",
          message: "API connection lost — retrying (1/3)...",
          details: null,
          resolution: null,
        },
      });

      expect(useStore.getState().connection.status).toBe("reconnecting");
    });

    it("critical alert sets connection status to disconnected", () => {
      useStore.getState().setConnectionStatus("reconnecting");

      useStore.getState().handleWsMessage({
        event: EVENTS.ALERT_TRIGGERED,
        timestamp: Date.now(),
        data: {
          severity: "critical",
          code: "API_CONNECTION_FAILED",
          message: "API connection failed after 3 retries — check network",
          details: null,
          resolution: null,
        },
      });

      expect(useStore.getState().connection.status).toBe("disconnected");
    });

    it("info alert sets connection status to connected and routes to toastQueue", () => {
      // First add a warning alert
      useStore.getState().handleWsMessage({
        event: EVENTS.ALERT_TRIGGERED,
        timestamp: Date.now(),
        data: {
          severity: "warning",
          code: "API_CONNECTION_FAILED",
          message: "API connection lost — retrying (1/3)...",
          details: null,
          resolution: null,
        },
      });

      expect(useStore.getState().connection.status).toBe("reconnecting");
      // Warning goes to toastQueue, not alerts[]
      expect(useStore.getState().alerts).toHaveLength(0);
      expect(useStore.getState().toastQueue).toHaveLength(1);
      expect(useStore.getState().toastQueue[0].severity).toBe("warning");

      // Now send info alert (recovery)
      useStore.getState().handleWsMessage({
        event: EVENTS.ALERT_TRIGGERED,
        timestamp: Date.now(),
        data: {
          severity: "info",
          code: "API_CONNECTION_FAILED",
          message: "API reconnected — trading resumed",
          details: null,
          resolution: null,
        },
      });

      expect(useStore.getState().connection.status).toBe("connected");
      // Info also goes to toastQueue
      expect(useStore.getState().alerts).toHaveLength(0);
      expect(useStore.getState().toastQueue).toHaveLength(2);
      expect(useStore.getState().toastQueue[1].severity).toBe("info");
    });

    it("info alert with autoDismissMs routes to toastQueue with autoDismissMs preserved", () => {
      useStore.getState().handleWsMessage({
        event: EVENTS.ALERT_TRIGGERED,
        timestamp: Date.now(),
        data: {
          severity: "info",
          code: "API_CONNECTION_FAILED",
          message: "API reconnected — trading resumed",
          details: null,
          resolution: null,
          autoDismissMs: 5000,
        },
      });

      // Info alerts go to toastQueue, not alerts[]
      expect(useStore.getState().alerts).toHaveLength(0);
      expect(useStore.getState().toastQueue).toHaveLength(1);
      expect(useStore.getState().toastQueue[0].autoDismissMs).toBe(5000);
    });
  });

  describe("severity routing (alert.triggered)", () => {
    it("critical alerts go to alerts[] (banner)", () => {
      useStore.getState().handleWsMessage({
        event: EVENTS.ALERT_TRIGGERED,
        timestamp: 1000,
        data: {
          severity: "critical",
          code: "CRITICAL_ERR",
          message: "Critical error",
          details: null,
          resolution: null,
        },
      });

      expect(useStore.getState().alerts).toHaveLength(1);
      expect(useStore.getState().alerts[0].severity).toBe("critical");
      expect(useStore.getState().toastQueue).toHaveLength(0);
    });

    it("warning alerts go to toastQueue (toast)", () => {
      useStore.getState().handleWsMessage({
        event: EVENTS.ALERT_TRIGGERED,
        timestamp: 1000,
        data: {
          severity: "warning",
          code: "WARN_TEST",
          message: "Warning message",
          details: "Some details",
          resolution: null,
        },
      });

      expect(useStore.getState().alerts).toHaveLength(0);
      expect(useStore.getState().toastQueue).toHaveLength(1);
      expect(useStore.getState().toastQueue[0].severity).toBe("warning");
      expect(useStore.getState().toastQueue[0].code).toBe("WARN_TEST");
      expect(useStore.getState().toastQueue[0].details).toBe("Some details");
    });

    it("info alerts go to toastQueue (toast)", () => {
      useStore.getState().handleWsMessage({
        event: EVENTS.ALERT_TRIGGERED,
        timestamp: 1000,
        data: {
          severity: "info",
          code: "INFO_TEST",
          message: "Info message",
          details: null,
          resolution: null,
        },
      });

      expect(useStore.getState().alerts).toHaveLength(0);
      expect(useStore.getState().toastQueue).toHaveLength(1);
      expect(useStore.getState().toastQueue[0].severity).toBe("info");
    });

    it("autoDismissMs is passed through on toastQueue", () => {
      useStore.getState().handleWsMessage({
        event: EVENTS.ALERT_TRIGGERED,
        timestamp: 1000,
        data: {
          severity: "info",
          code: "INFO_DISMISS",
          message: "Auto-dismiss test",
          details: null,
          resolution: null,
          autoDismissMs: 3000,
        },
      });

      expect(useStore.getState().toastQueue[0].autoDismissMs).toBe(3000);
    });

    it("rapid consecutive alerts all queued (no drops)", () => {
      useStore.getState().handleWsMessage({
        event: EVENTS.ALERT_TRIGGERED,
        timestamp: 1000,
        data: { severity: "warning", code: "W1", message: "First", details: null, resolution: null },
      });
      useStore.getState().handleWsMessage({
        event: EVENTS.ALERT_TRIGGERED,
        timestamp: 1001,
        data: { severity: "info", code: "I1", message: "Second", details: null, resolution: null },
      });
      useStore.getState().handleWsMessage({
        event: EVENTS.ALERT_TRIGGERED,
        timestamp: 1002,
        data: { severity: "warning", code: "W2", message: "Third", details: null, resolution: null },
      });

      expect(useStore.getState().toastQueue).toHaveLength(3);
      expect(useStore.getState().toastQueue[0].code).toBe("W1");
      expect(useStore.getState().toastQueue[1].code).toBe("I1");
      expect(useStore.getState().toastQueue[2].code).toBe("W2");
    });

    it("critical alerts are never auto-dismissed", () => {
      vi.useFakeTimers();

      useStore.getState().handleWsMessage({
        event: EVENTS.ALERT_TRIGGERED,
        timestamp: 1000,
        data: {
          severity: "critical",
          code: "CRIT_DISMISS",
          message: "Critical with autoDismiss",
          details: null,
          resolution: null,
          autoDismissMs: 5000,
        },
      });

      expect(useStore.getState().alerts).toHaveLength(1);
      vi.advanceTimersByTime(10000);
      // Critical alert still present — never auto-dismissed
      expect(useStore.getState().alerts).toHaveLength(1);

      vi.useRealTimers();
    });

    it("special handlers still run for warning alerts (API_CONNECTION_FAILED)", () => {
      useStore.getState().setConnectionStatus("connected");

      useStore.getState().handleWsMessage({
        event: EVENTS.ALERT_TRIGGERED,
        timestamp: 1000,
        data: {
          severity: "warning",
          code: "API_CONNECTION_FAILED",
          message: "Retrying...",
          details: null,
          resolution: null,
        },
      });

      // Connection status updated AND routed to toast
      expect(useStore.getState().connection.status).toBe("reconnecting");
      expect(useStore.getState().toastQueue).toHaveLength(1);
      expect(useStore.getState().alerts).toHaveLength(0);
    });

    it("special handlers still run for info alerts (API_CONNECTION_FAILED)", () => {
      useStore.getState().setConnectionStatus("reconnecting");

      useStore.getState().handleWsMessage({
        event: EVENTS.ALERT_TRIGGERED,
        timestamp: 1000,
        data: {
          severity: "info",
          code: "API_CONNECTION_FAILED",
          message: "Reconnected",
          details: null,
          resolution: null,
        },
      });

      expect(useStore.getState().connection.status).toBe("connected");
      expect(useStore.getState().toastQueue).toHaveLength(1);
    });

    it("clearToastQueue resets toastQueue to empty", () => {
      useStore.getState().handleWsMessage({
        event: EVENTS.ALERT_TRIGGERED,
        timestamp: 1000,
        data: {
          severity: "info",
          code: "TEST",
          message: "Test",
          details: null,
          resolution: null,
        },
      });

      expect(useStore.getState().toastQueue).toHaveLength(1);
      useStore.getState().clearToastQueue();
      expect(useStore.getState().toastQueue).toHaveLength(0);
    });

    it("alert includes mode field from payload", () => {
      useStore.getState().handleWsMessage({
        event: EVENTS.ALERT_TRIGGERED,
        timestamp: 1000,
        data: {
          severity: "critical",
          code: "KILL_SWITCH_TRIGGERED",
          message: "Kill switch",
          details: null,
          resolution: null,
          mode: "volumeMax",
        },
      });

      expect(useStore.getState().alerts[0].mode).toBe("volumeMax");
    });
  });

  // === Tasks 3-6: Multi-mode store validation (Story 4-4) ===

  describe("aggregateSummaryStats multi-mode (Story 4-4)", () => {
    it("aggregates stats from all running modes (3.1)", () => {
      // Set stats for all three modes
      useStore.getState().handleWsMessage({
        event: EVENTS.STATS_UPDATED,
        timestamp: 1000,
        data: { mode: "volumeMax", pnl: 10, trades: 5, volume: 500, allocated: 200, remaining: 100 },
      });
      useStore.getState().handleWsMessage({
        event: EVENTS.STATS_UPDATED,
        timestamp: 1001,
        data: { mode: "profitHunter", pnl: 20, trades: 3, volume: 300, allocated: 150, remaining: 80 },
      });
      useStore.getState().handleWsMessage({
        event: EVENTS.STATS_UPDATED,
        timestamp: 1002,
        data: { mode: "arbitrage", pnl: -5, trades: 2, volume: 100, allocated: 100, remaining: 50 },
      });

      const stats = useStore.getState().stats;
      expect(stats.totalPnl).toBe(25); // 10 + 20 + (-5)
      expect(stats.totalTrades).toBe(10); // 5 + 3 + 2
      expect(stats.totalVolume).toBe(900); // 500 + 300 + 100
    });

    it("updates aggregation when a mode stops — final stats still included (3.2)", () => {
      // Set stats for two modes
      useStore.getState().handleWsMessage({
        event: EVENTS.STATS_UPDATED,
        timestamp: 1000,
        data: { mode: "volumeMax", pnl: 10, trades: 5, volume: 500, allocated: 200, remaining: 100 },
      });
      useStore.getState().handleWsMessage({
        event: EVENTS.STATS_UPDATED,
        timestamp: 1001,
        data: { mode: "profitHunter", pnl: 15, trades: 3, volume: 300, allocated: 150, remaining: 80 },
      });

      // Stop volumeMax with finalStats
      useStore.getState().handleWsMessage({
        event: EVENTS.MODE_STOPPED,
        timestamp: 1002,
        data: { mode: "volumeMax", finalStats: { pnl: 12, trades: 6, volume: 550, allocated: 200, remaining: 120 } },
      });

      const stats = useStore.getState().stats;
      // Stopped mode's final stats are included in aggregation
      expect(stats.totalPnl).toBe(27); // 12 (volumeMax final) + 15 (profitHunter)
      expect(stats.totalTrades).toBe(9); // 6 + 3
    });

    it("stats persist on mode re-start — NOT reset to zero (3.3)", () => {
      // Set stats
      useStore.getState().handleWsMessage({
        event: EVENTS.STATS_UPDATED,
        timestamp: 1000,
        data: { mode: "volumeMax", pnl: 10, trades: 5, volume: 500, allocated: 200, remaining: 100 },
      });

      // Stop mode
      useStore.getState().handleWsMessage({
        event: EVENTS.MODE_STOPPED,
        timestamp: 1001,
        data: { mode: "volumeMax", finalStats: { pnl: 10, trades: 5, volume: 500, allocated: 200, remaining: 100 } },
      });

      // Re-start mode — stats should persist (MODE_STARTED does NOT reset stats)
      useStore.getState().handleWsMessage({
        event: EVENTS.MODE_STARTED,
        timestamp: 1002,
        data: { mode: "volumeMax" },
      });

      const modeState = useStore.getState().modes.volumeMax;
      expect(modeState.status).toBe("running");
      expect(modeState.stats.pnl).toBe(10); // preserved, not zero
      expect(modeState.stats.trades).toBe(5); // preserved
      expect(modeState.stats.volume).toBe(500); // preserved
    });

    it("handles partial mode states (1 running, 1 stopped, 1 error) (3.4)", () => {
      // volumeMax: running with stats
      useStore.getState().handleWsMessage({
        event: EVENTS.MODE_STARTED,
        timestamp: 1000,
        data: { mode: "volumeMax" },
      });
      useStore.getState().handleWsMessage({
        event: EVENTS.STATS_UPDATED,
        timestamp: 1001,
        data: { mode: "volumeMax", pnl: 10, trades: 5, volume: 500, allocated: 200, remaining: 100 },
      });

      // profitHunter: stopped with final stats
      useStore.getState().handleWsMessage({
        event: EVENTS.STATS_UPDATED,
        timestamp: 1002,
        data: { mode: "profitHunter", pnl: 8, trades: 2, volume: 200, allocated: 150, remaining: 80 },
      });

      // arbitrage: error state
      useStore.getState().handleWsMessage({
        event: EVENTS.STATS_UPDATED,
        timestamp: 1003,
        data: { mode: "arbitrage", pnl: -3, trades: 1, volume: 50, allocated: 100, remaining: 50 },
      });
      useStore.getState().handleWsMessage({
        event: EVENTS.MODE_ERROR,
        timestamp: 1004,
        data: { mode: "arbitrage", error: { code: "TEST", message: "test error", details: null } },
      });

      const stats = useStore.getState().stats;
      // All modes' stats included regardless of running/stopped/error status
      expect(stats.totalPnl).toBe(15); // 10 + 8 + (-3)
      expect(stats.totalTrades).toBe(8); // 5 + 2 + 1
      expect(stats.totalVolume).toBe(750); // 500 + 200 + 50
    });
  });

  // Task 4: Trade log interleaving and mode tagging
  describe("trade log multi-mode interleaving (Story 4-4)", () => {
    it("TRADE_EXECUTED from different modes appear in chronological order with correct mode tags (4.1, 4.2)", () => {
      const trades = [
        { mode: "volumeMax", pair: "SOL/USDC", side: "Long", size: 100, price: 50, pnl: 5, fees: 0.1 },
        { mode: "profitHunter", pair: "ETH/USDC", side: "Short", size: 200, price: 3000, pnl: -10, fees: 0.2 },
        { mode: "arbitrage", pair: "BTC/USDC", side: "Long", size: 50, price: 60000, pnl: 15, fees: 0.3 },
        { mode: "volumeMax", pair: "SOL/USDC", side: "Short", size: 100, price: 51, pnl: 2, fees: 0.1 },
      ];

      trades.forEach((t, i) => {
        useStore.getState().handleWsMessage({
          event: EVENTS.TRADE_EXECUTED,
          timestamp: 1000 + i,
          data: t,
        });
      });

      const storedTrades = useStore.getState().trades;
      expect(storedTrades).toHaveLength(4);

      // Chronological order preserved
      expect(storedTrades[0].timestamp).toBe(1000);
      expect(storedTrades[3].timestamp).toBe(1003);

      // Mode tags present on each trade
      expect(storedTrades[0].mode).toBe("volumeMax");
      expect(storedTrades[1].mode).toBe("profitHunter");
      expect(storedTrades[2].mode).toBe("arbitrage");
      expect(storedTrades[3].mode).toBe("volumeMax");
    });

    it("trade log respects 500 entry limit with multi-mode trades (4.3)", () => {
      // Fill 500 trades from multiple modes
      for (let i = 0; i < 510; i++) {
        const modes = ["volumeMax", "profitHunter", "arbitrage"] as const;
        useStore.getState().handleWsMessage({
          event: EVENTS.TRADE_EXECUTED,
          timestamp: 1000 + i,
          data: { mode: modes[i % 3], pair: "SOL/USDC", side: "Long", size: 10, price: 50, pnl: 1, fees: 0.01 },
        });
      }

      const storedTrades = useStore.getState().trades;
      expect(storedTrades.length).toBeLessThanOrEqual(500);
      // Most recent trades preserved
      expect(storedTrades[storedTrades.length - 1].timestamp).toBe(1509);
    });
  });

  // Task 5: PositionsTable multi-mode display
  describe("positions multi-mode display (Story 4-4)", () => {
    it("positions from all modes appear with correct mode tag (5.1)", () => {
      const positions = [
        { mode: "volumeMax", pair: "SOL/USDC", side: "Long", size: 100, entryPrice: 50, stopLoss: 45 },
        { mode: "profitHunter", pair: "ETH/USDC", side: "Short", size: 200, entryPrice: 3000, stopLoss: 3200 },
        { mode: "arbitrage", pair: "BTC/USDC", side: "Long", size: 50, entryPrice: 60000, stopLoss: 55000 },
      ];

      positions.forEach((p, i) => {
        useStore.getState().handleWsMessage({
          event: EVENTS.POSITION_OPENED,
          timestamp: 1000 + i,
          data: p,
        });
      });

      const storedPositions = useStore.getState().positions;
      expect(storedPositions).toHaveLength(3);
      expect(storedPositions[0].mode).toBe("volumeMax");
      expect(storedPositions[1].mode).toBe("profitHunter");
      expect(storedPositions[2].mode).toBe("arbitrage");
    });

    it("closing position from one mode doesn't affect positions from other modes (5.2)", () => {
      // Open positions for two modes
      useStore.getState().handleWsMessage({
        event: EVENTS.POSITION_OPENED,
        timestamp: 1000,
        data: { mode: "volumeMax", pair: "SOL/USDC", side: "Long", size: 100, entryPrice: 50, stopLoss: 45 },
      });
      useStore.getState().handleWsMessage({
        event: EVENTS.POSITION_OPENED,
        timestamp: 1001,
        data: { mode: "profitHunter", pair: "ETH/USDC", side: "Short", size: 200, entryPrice: 3000, stopLoss: 3200 },
      });

      expect(useStore.getState().positions).toHaveLength(2);

      // Close the volumeMax position
      useStore.getState().handleWsMessage({
        event: EVENTS.POSITION_CLOSED,
        timestamp: 1002,
        data: { mode: "volumeMax", pair: "SOL/USDC", side: "Long", size: 100, exitPrice: 52, pnl: 4 },
      });

      // profitHunter position still present (volumeMax enters closingPositions animation)
      const positions = useStore.getState().positions;
      const profitHunterPos = positions.find((p) => p.mode === "profitHunter");
      expect(profitHunterPos).toBeDefined();
      expect(profitHunterPos!.pair).toBe("ETH/USDC");
      // volumeMax position removed (or in closingPositions), total count should reflect the close
      const activeNonClosing = positions.filter((p) => p.mode !== "volumeMax");
      expect(activeNonClosing).toHaveLength(1);
    });
  });

  // Task 6: ModeCard independent state management
  describe("ModeCard independent state isolation (Story 4-4)", () => {
    it("toggling mode A does not change mode B's badge, stats, or controls (6.1)", () => {
      useStore.getState().handleWsMessage({
        event: EVENTS.MODE_STARTED,
        timestamp: 1000,
        data: { mode: "volumeMax" },
      });

      expect(useStore.getState().modes.volumeMax.status).toBe("running");
      expect(useStore.getState().modes.profitHunter.status).toBe("stopped");
      expect(useStore.getState().modes.arbitrage.status).toBe("stopped");

      useStore.getState().handleWsMessage({
        event: EVENTS.MODE_STOPPED,
        timestamp: 1001,
        data: { mode: "volumeMax" },
      });

      expect(useStore.getState().modes.volumeMax.status).toBe("stopped");
      expect(useStore.getState().modes.profitHunter.status).toBe("stopped");
      expect(useStore.getState().modes.arbitrage.status).toBe("stopped");
    });

    it("error state in mode A does not disable controls in mode B (6.2)", () => {
      // Start both modes
      useStore.getState().handleWsMessage({
        event: EVENTS.MODE_STARTED,
        timestamp: 1000,
        data: { mode: "volumeMax" },
      });
      useStore.getState().handleWsMessage({
        event: EVENTS.MODE_STARTED,
        timestamp: 1001,
        data: { mode: "profitHunter" },
      });

      // Error on volumeMax
      useStore.getState().handleWsMessage({
        event: EVENTS.MODE_ERROR,
        timestamp: 1002,
        data: { mode: "volumeMax", error: { code: "TEST_ERROR", message: "test", details: null } },
      });

      expect(useStore.getState().modes.volumeMax.status).toBe("error");
      expect(useStore.getState().modes.volumeMax.errorDetail).toBeTruthy();
      // profitHunter completely unaffected
      expect(useStore.getState().modes.profitHunter.status).toBe("running");
      expect(useStore.getState().modes.profitHunter.errorDetail).toBeNull();
    });

    it("kill-switch in mode A shows kill-switch only on mode A, others remain unaffected (6.3)", () => {
      // Start all three modes
      useStore.getState().handleWsMessage({ event: EVENTS.MODE_STARTED, timestamp: 1000, data: { mode: "volumeMax" } });
      useStore.getState().handleWsMessage({ event: EVENTS.MODE_STARTED, timestamp: 1001, data: { mode: "profitHunter" } });
      useStore.getState().handleWsMessage({ event: EVENTS.MODE_STARTED, timestamp: 1002, data: { mode: "arbitrage" } });

      // Kill-switch on volumeMax
      useStore.getState().handleWsMessage({
        event: EVENTS.ALERT_TRIGGERED,
        timestamp: 1003,
        data: {
          severity: "critical",
          code: "KILL_SWITCH_TRIGGERED",
          message: "Kill switch triggered on volumeMax",
          details: "mode: volumeMax",
          resolution: "Re-allocate funds",
          mode: "volumeMax",
          positionsClosed: 2,
          lossAmount: 50,
        },
      });

      // MODE_STOPPED from forceStop — should be IGNORED because kill-switch is already set
      useStore.getState().handleWsMessage({
        event: EVENTS.MODE_STOPPED,
        timestamp: 1004,
        data: { mode: "volumeMax" },
      });

      expect(useStore.getState().modes.volumeMax.status).toBe("kill-switch");
      expect(useStore.getState().modes.volumeMax.killSwitchDetail).toEqual({ positionsClosed: 2, lossAmount: 50 });
      // Others remain running
      expect(useStore.getState().modes.profitHunter.status).toBe("running");
      expect(useStore.getState().modes.arbitrage.status).toBe("running");
    });
  });

  describe("historical PnL differentiation (Story 5.1)", () => {
    it("loadInitialStatus with stats differentiates totalPnl from sessionPnl", () => {
      useStore.getState().loadInitialStatus({
        strategies: TEST_STRATEGIES,
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
        stats: { totalPnl: 600, sessionPnl: 100 },
      });

      const state = useStore.getState();
      // historicalPnlBase = totalPnl - sessionPnl = 600 - 100 = 500
      expect(state.historicalPnlBase).toBe(500);
      // sessionPnl = sum of mode pnl = 100
      expect(state.stats.sessionPnl).toBe(100);
      // totalPnl = historicalPnlBase + sessionPnl = 500 + 100 = 600
      expect(state.stats.totalPnl).toBe(600);
    });

    it("STATS_UPDATED preserves historical base in totalPnl", () => {
      // Set historicalPnlBase via loadInitialStatus
      useStore.getState().loadInitialStatus({
        strategies: TEST_STRATEGIES,
        modes: {
          volumeMax: {
            mode: "volumeMax",
            status: "running",
            allocation: 500,
            pairs: ["SOL/USDC"],
            slippage: 0.5,
            stats: { pnl: 50, trades: 2, volume: 1000, allocated: 500, remaining: 450 },
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
        stats: { totalPnl: 350, sessionPnl: 50 },
      });

      expect(useStore.getState().historicalPnlBase).toBe(300);
      expect(useStore.getState().stats.totalPnl).toBe(350);
      expect(useStore.getState().stats.sessionPnl).toBe(50);

      // Now a STATS_UPDATED event comes in — pnl increases
      useStore.getState().handleWsMessage({
        event: EVENTS.STATS_UPDATED,
        timestamp: Date.now(),
        data: { mode: "volumeMax", pnl: 80, trades: 4, volume: 2000, allocated: 500, remaining: 420 },
      });

      const stats = useStore.getState().stats;
      // sessionPnl = mode sum = 80 (volumeMax) + 0 (others) = 80
      expect(stats.sessionPnl).toBe(80);
      // totalPnl = historicalPnlBase(300) + sessionPnl(80) = 380
      expect(stats.totalPnl).toBe(380);
    });

    it("loadInitialStatus without stats field defaults historicalPnlBase to 0", () => {
      useStore.getState().loadInitialStatus({
        strategies: TEST_STRATEGIES,
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
        connection: { status: "disconnected", equity: 0, available: 0 },
      });

      expect(useStore.getState().historicalPnlBase).toBe(0);
      expect(useStore.getState().stats.totalPnl).toBe(0);
      expect(useStore.getState().stats.sessionPnl).toBe(0);
    });

    it("loadInitialStatus with stats populates historicalTradesBase and historicalVolumeBase", () => {
      useStore.getState().loadInitialStatus({
        strategies: TEST_STRATEGIES,
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
        connection: { status: "connected", equity: 5000, available: 0 },
        stats: { totalPnl: 600, sessionPnl: 150, totalTrades: 58, totalVolume: 9000 },
      });

      const state = useStore.getState();
      // historicalTradesBase = totalTrades - (5 + 3 + 0) = 58 - 8 = 50
      expect(state.historicalTradesBase).toBe(50);
      // historicalVolumeBase = totalVolume - (3000 + 1000 + 0) = 9000 - 4000 = 5000
      expect(state.historicalVolumeBase).toBe(5000);
      // combined stats include historical baselines
      expect(state.stats.totalTrades).toBe(58); // 50 + 8
      expect(state.stats.totalVolume).toBe(9000); // 5000 + 4000
    });

    it("STATS_UPDATED preserves historical trades and volume baselines", () => {
      // Set historical baselines via loadInitialStatus
      useStore.getState().loadInitialStatus({
        strategies: TEST_STRATEGIES,
        modes: {
          volumeMax: {
            mode: "volumeMax",
            status: "running",
            allocation: 500,
            pairs: ["SOL/USDC"],
            slippage: 0.5,
            stats: { pnl: 50, trades: 2, volume: 1000, allocated: 500, remaining: 450 },
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
        stats: { totalPnl: 350, sessionPnl: 50, totalTrades: 42, totalVolume: 6000 },
      });

      expect(useStore.getState().historicalTradesBase).toBe(40); // 42 - 2
      expect(useStore.getState().historicalVolumeBase).toBe(5000); // 6000 - 1000

      // STATS_UPDATED event — trades and volume increase
      useStore.getState().handleWsMessage({
        event: EVENTS.STATS_UPDATED,
        timestamp: Date.now(),
        data: { mode: "volumeMax", pnl: 80, trades: 4, volume: 2000, allocated: 500, remaining: 420 },
      });

      const stats = useStore.getState().stats;
      // totalTrades = historicalTradesBase(40) + mode sum(4) = 44
      expect(stats.totalTrades).toBe(44);
      // totalVolume = historicalVolumeBase(5000) + mode sum(2000) = 7000
      expect(stats.totalVolume).toBe(7000);
    });

    it("loadInitialStatus without stats field defaults historical trades and volume baselines to 0", () => {
      useStore.getState().loadInitialStatus({
        strategies: TEST_STRATEGIES,
        modes: {
          volumeMax: {
            mode: "volumeMax",
            status: "running",
            allocation: 500,
            pairs: ["SOL/USDC"],
            slippage: 0.5,
            stats: { pnl: 0, trades: 3, volume: 500, allocated: 500, remaining: 500 },
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
        connection: { status: "disconnected", equity: 0, available: 0 },
      });

      expect(useStore.getState().historicalTradesBase).toBe(0);
      expect(useStore.getState().historicalVolumeBase).toBe(0);
      // totalTrades = 0 + 3 = 3 (only current session mode trades)
      expect(useStore.getState().stats.totalTrades).toBe(3);
      expect(useStore.getState().stats.totalVolume).toBe(500);
    });

    it("clamps historicalTradesBase and historicalVolumeBase to zero when mode stats exceed server totals", () => {
      useStore.getState().loadInitialStatus({
        strategies: TEST_STRATEGIES,
        modes: {
          volumeMax: {
            mode: "volumeMax",
            status: "running",
            allocation: 500,
            pairs: ["SOL/USDC"],
            slippage: 0.5,
            stats: { pnl: 0, trades: 10, volume: 2000, allocated: 500, remaining: 500 },
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
        stats: { totalPnl: 0, sessionPnl: 0, totalTrades: 5, totalVolume: 500 },
      });

      // mode trades (10) > server totalTrades (5) — would be -5 without clamp
      expect(useStore.getState().historicalTradesBase).toBe(0);
      // mode volume (2000) > server totalVolume (500) — would be -1500 without clamp
      expect(useStore.getState().historicalVolumeBase).toBe(0);
      // totalTrades = 0 + 10 = 10 (only current mode trades, no negative historical)
      expect(useStore.getState().stats.totalTrades).toBe(10);
      expect(useStore.getState().stats.totalVolume).toBe(2000);
    });
  });

  describe("tradeHistory", () => {
    it("setTradeHistory updates state correctly", () => {
      const trades = [
        { id: 1, mode: "volumeMax" as const, pair: "SOL/USDC", side: "Long" as const, size: 10, price: 150, pnl: 5, fees: 0.1, timestamp: 1000 },
        { id: 2, mode: "profitHunter" as const, pair: "SOL/USDC", side: "Short" as const, size: 20, price: 145, pnl: -2, fees: 0.2, timestamp: 2000 },
      ];
      useStore.getState().setTradeHistory({ trades, total: 42 }, 2);

      const th = useStore.getState().tradeHistory;
      expect(th.trades).toHaveLength(2);
      expect(th.total).toBe(42);
      expect(th.page).toBe(2);
      expect(th.loading).toBe(false);
    });

    it("setTradeHistoryLoading updates loading state", () => {
      useStore.getState().setTradeHistoryLoading(true);
      expect(useStore.getState().tradeHistory.loading).toBe(true);

      useStore.getState().setTradeHistoryLoading(false);
      expect(useStore.getState().tradeHistory.loading).toBe(false);
    });

    it("loadInitialStatus populates tradeHistory from trades", () => {
      const trades = [
        { id: 1, mode: "volumeMax" as const, pair: "SOL/USDC", side: "Long" as const, size: 10, price: 150, pnl: 5, fees: 0.1, timestamp: 1000 },
      ];

      useStore.getState().loadInitialStatus({
        strategies: TEST_STRATEGIES,
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
        trades,
        connection: { status: "disconnected", equity: 0, available: 0 },
      });

      const th = useStore.getState().tradeHistory;
      expect(th.trades).toHaveLength(1);
      expect(th.total).toBe(1);
      expect(th.page).toBe(0);
    });

    it("TRADE_EXECUTED prepends trade to tradeHistory on page 0", () => {
      useStore.setState({
        tradeHistory: {
          trades: [
            { id: 1, mode: "volumeMax" as const, pair: "SOL/USDC", side: "Long" as const, size: 10, price: 150, pnl: 5, fees: 0.1, timestamp: 1000 },
          ],
          total: 1,
          page: 0,
          loading: false,
        },
      });

      useStore.getState().handleWsMessage({
        event: "trade.executed",
        timestamp: 2000,
        data: {
          mode: "profitHunter",
          pair: "SOL/USDC",
          side: "Short",
          size: 20,
          price: 145,
          pnl: -2,
          fees: 0.2,
        },
      });

      const th = useStore.getState().tradeHistory;
      expect(th.trades).toHaveLength(2);
      expect(th.trades[0].mode).toBe("profitHunter"); // newest first
      expect(th.total).toBe(2);
    });

    it("TRADE_EXECUTED only increments total on other pages", () => {
      useStore.setState({
        tradeHistory: {
          trades: [
            { id: 1, mode: "volumeMax" as const, pair: "SOL/USDC", side: "Long" as const, size: 10, price: 150, pnl: 5, fees: 0.1, timestamp: 1000 },
          ],
          total: 51,
          page: 1,
          loading: false,
        },
      });

      useStore.getState().handleWsMessage({
        event: "trade.executed",
        timestamp: 2000,
        data: {
          mode: "volumeMax",
          pair: "SOL/USDC",
          side: "Long",
          size: 10,
          price: 150,
          pnl: 0,
          fees: 0.1,
        },
      });

      const th = useStore.getState().tradeHistory;
      expect(th.trades).toHaveLength(1); // not prepended
      expect(th.total).toBe(52); // incremented
    });
  });

  describe("dynamic strategy support (Story 6.2)", () => {
    it("loadInitialStatus populates strategies from response", () => {
      useStore.getState().loadInitialStatus({
        strategies: TEST_STRATEGIES,
        modes: {
          volumeMax: { mode: "volumeMax", status: "stopped", allocation: 0, pairs: ["SOL/USDC"], slippage: 0.5, stats: { pnl: 0, trades: 0, volume: 0, allocated: 0, remaining: 0 } },
          profitHunter: { mode: "profitHunter", status: "stopped", allocation: 0, pairs: ["SOL/USDC"], slippage: 0.5, stats: { pnl: 0, trades: 0, volume: 0, allocated: 0, remaining: 0 } },
          arbitrage: { mode: "arbitrage", status: "stopped", allocation: 0, pairs: ["SOL/USDC"], slippage: 0.5, stats: { pnl: 0, trades: 0, volume: 0, allocated: 0, remaining: 0 } },
        },
        positions: [],
        trades: [],
        connection: { status: "connected", equity: 5000, available: 0 },
      });

      expect(useStore.getState().strategies).toEqual(TEST_STRATEGIES);
      expect(Object.keys(useStore.getState().modes)).toEqual(["volumeMax", "profitHunter", "arbitrage"]);
    });

    it("loadInitialStatus creates modes from strategies, not hardcoded", () => {
      const customStrategies: StrategyInfo[] = [
        { name: "Volume Max", description: "V", modeType: "volumeMax", urlSlug: "volume-max", modeColor: "#8b5cf6", status: "stopped" as ModeStatus },
        { name: "Mean Reversion", description: "M", modeType: "meanReversion", urlSlug: "mean-reversion", modeColor: "#f59e0b", status: "stopped" as ModeStatus },
      ];

      useStore.getState().loadInitialStatus({
        strategies: customStrategies,
        modes: {
          volumeMax: { mode: "volumeMax", status: "running", allocation: 500, pairs: ["SOL/USDC"], slippage: 0.5, stats: { pnl: 50, trades: 3, volume: 1000, allocated: 500, remaining: 450 } },
          meanReversion: { mode: "meanReversion", status: "stopped", allocation: 0, pairs: ["ETH/USDC"], slippage: 1.0, stats: { pnl: 0, trades: 0, volume: 0, allocated: 0, remaining: 0 } },
        },
        positions: [],
        trades: [],
        connection: { status: "connected", equity: 5000, available: 0 },
      });

      const state = useStore.getState();
      expect(state.strategies).toEqual(customStrategies);
      expect(Object.keys(state.modes)).toEqual(["volumeMax", "meanReversion"]);
      expect(state.modes.volumeMax.status).toBe("running");
      expect(state.modes.meanReversion).toBeDefined();
      expect(state.modes.meanReversion.pairs).toEqual(["ETH/USDC"]);
    });

    it("WS events for modes not yet loaded are safely rejected", () => {
      // Start with empty modes (before loadInitialStatus)
      useStore.setState({ modes: {}, strategies: [] });

      useStore.getState().handleWsMessage({
        event: EVENTS.TRADE_EXECUTED,
        timestamp: Date.now(),
        data: { mode: "volumeMax", pair: "SOL-PERP", side: "Long", size: 100, price: 150, pnl: 0, fees: 0.5 },
      });

      expect(useStore.getState().trades).toHaveLength(0);
    });

    it("WS events work after loadInitialStatus populates modes", () => {
      useStore.getState().loadInitialStatus({
        strategies: TEST_STRATEGIES,
        modes: {
          volumeMax: { mode: "volumeMax", status: "running", allocation: 500, pairs: ["SOL/USDC"], slippage: 0.5, stats: { pnl: 0, trades: 0, volume: 0, allocated: 0, remaining: 0 } },
          profitHunter: { mode: "profitHunter", status: "stopped", allocation: 0, pairs: ["SOL/USDC"], slippage: 0.5, stats: { pnl: 0, trades: 0, volume: 0, allocated: 0, remaining: 0 } },
          arbitrage: { mode: "arbitrage", status: "stopped", allocation: 0, pairs: ["SOL/USDC"], slippage: 0.5, stats: { pnl: 0, trades: 0, volume: 0, allocated: 0, remaining: 0 } },
        },
        positions: [],
        trades: [],
        connection: { status: "connected", equity: 5000, available: 0 },
      });

      useStore.getState().handleWsMessage({
        event: EVENTS.TRADE_EXECUTED,
        timestamp: Date.now(),
        data: { mode: "volumeMax", pair: "SOL-PERP", side: "Long", size: 100, price: 150, pnl: 0, fees: 0.5 },
      });

      expect(useStore.getState().trades).toHaveLength(1);
    });
  });
});
