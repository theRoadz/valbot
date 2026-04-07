import { create } from "zustand";
import type { ConnectionStatus, SummaryStats, Alert, ModeType, ModeStatus, ModeConfig, ModeStats, StatusResponse, Trade, Position, TradeHistoryResponse, StrategyInfo } from "@shared/types";
import { EVENTS, type ConnectionStatusPayload, type PositionOpenedPayload, type PositionClosedPayload, type WsMessage } from "@shared/events";

let alertIdCounter = Date.now();
let tradeIdCounter = -1;
let positionIdCounter = 0;
const pendingCloseTimers: Map<number, ReturnType<typeof setTimeout>> = new Map();
const VALID_SEVERITIES = new Set(["info", "warning", "critical"]);
const VALID_SIDES = new Set<string>(["Long", "Short"]);

function isValidPosition(p: unknown): p is Position {
  if (p == null || typeof p !== "object") return false;
  const pos = p as Record<string, unknown>;
  return (
    Number.isFinite(pos.id) &&
    typeof pos.mode === "string" &&
    (pos.mode as string).length > 0 &&
    typeof pos.pair === "string" &&
    (pos.pair as string).length > 0 &&
    typeof pos.side === "string" &&
    VALID_SIDES.has(pos.side) &&
    Number.isFinite(pos.size) &&
    Number.isFinite(pos.entryPrice) &&
    Number.isFinite(pos.stopLoss) &&
    Number.isFinite(pos.timestamp)
  );
}

function aggregateSummaryStats(modes: ValBotStore["modes"], equity: number, available: number, historicalPnlBase: number, historicalTradesBase: number, historicalVolumeBase: number): SummaryStats {
  const allModes = Object.values(modes);
  const sessionPnl = allModes.reduce((sum, m) => sum + m.stats.pnl, 0);
  return {
    equity,
    available,
    totalPnl: historicalPnlBase + sessionPnl,
    sessionPnl,
    totalTrades: historicalTradesBase + allModes.reduce((sum, m) => sum + m.stats.trades, 0),
    totalVolume: historicalVolumeBase + allModes.reduce((sum, m) => sum + m.stats.volume, 0),
  };
}

export interface ModeStoreEntry extends ModeConfig {
  errorDetail: { code: string; message: string; details: string | null } | null;
  killSwitchDetail: { positionsClosed: number; lossAmount: number } | null;
}

function createDefaultMode(mode: ModeType): ModeStoreEntry {
  return {
    mode,
    status: "stopped",
    allocation: 0,
    maxAllocation: 500,
    pairs: ["SOL/USDC"],
    slippage: 0.5,
    stats: { pnl: 0, trades: 0, volume: 0, allocated: 0, remaining: 0 },
    errorDetail: null,
    killSwitchDetail: null,
  };
}

interface ValBotStore {
  connection: {
    status: ConnectionStatus;
    equity: number;
    available: number;
  };
  historicalPnlBase: number;
  historicalTradesBase: number;
  historicalVolumeBase: number;
  stats: SummaryStats;
  alerts: Alert[];
  trades: Trade[];
  positions: Position[];
  closingPositions: number[];
  strategies: StrategyInfo[];
  modes: Record<ModeType, ModeStoreEntry>;
  setConnectionStatus: (status: ConnectionStatus) => void;
  updateConnection: (data: ConnectionStatusPayload) => void;
  addAlert: (alert: Alert) => void;
  dismissAlert: (id: number) => void;
  setModeStatus: (mode: ModeType, status: ModeStatus) => void;
  updateModeStats: (mode: ModeType, stats: ModeStats) => void;
  setModeConfig: (mode: ModeType, config: Partial<ModeConfig>) => void;
  tradeHistory: {
    trades: Trade[];
    total: number;
    page: number;
    loading: boolean;
  };
  setTradeHistory: (data: TradeHistoryResponse, page: number) => void;
  setTradeHistoryLoading: (loading: boolean) => void;
  setTradeHistoryPage: (page: number) => void;
  initialized: boolean;
  loadInitialStatus: (data: StatusResponse) => void;
  handleWsMessage: (message: WsMessage) => void;
  toastQueue: Alert[];
  clearToastQueue: () => void;
}

const useStore = create<ValBotStore>()((set) => ({
  connection: {
    status: "disconnected",
    equity: 0,
    available: 0,
  },
  historicalPnlBase: 0,
  historicalTradesBase: 0,
  historicalVolumeBase: 0,
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
  tradeHistory: {
    trades: [],
    total: 0,
    page: 0,
    loading: false,
  },
  initialized: false,
  toastQueue: [],
  closingPositions: [],
  strategies: [],
  modes: {},
  setConnectionStatus: (status) =>
    set((state) => ({
      connection: { ...state.connection, status },
    })),
  updateConnection: (data) =>
    set((state) => ({
      connection: {
        status: data.rpc ? "connected" : "disconnected",
        equity: data.equity,
        available: data.available,
      },
      stats: { ...state.stats, equity: data.equity, available: data.available },
    })),
  addAlert: (alert) =>
    set((state) => ({ alerts: [...state.alerts, alert] })),
  clearToastQueue: () => set({ toastQueue: [] }),
  dismissAlert: (id) =>
    set((state) => ({
      alerts: state.alerts.filter((a) => a.id !== id),
    })),
  setModeStatus: (mode, status) =>
    set((state) => {
      if (!state.modes[mode]) return state;
      return {
        modes: {
          ...state.modes,
          [mode]: {
            ...state.modes[mode],
            status,
            errorDetail: status !== "error" ? null : state.modes[mode].errorDetail,
            killSwitchDetail: status !== "kill-switch" ? null : state.modes[mode].killSwitchDetail,
          },
        },
      };
    }),
  updateModeStats: (mode, stats) =>
    set((state) => {
      if (!state.modes[mode]) return state;
      const modes = {
        ...state.modes,
        [mode]: { ...state.modes[mode], stats },
      };
      return {
        modes,
        stats: aggregateSummaryStats(modes, state.stats.equity, state.stats.available, state.historicalPnlBase, state.historicalTradesBase, state.historicalVolumeBase),
      };
    }),
  setModeConfig: (mode, config) =>
    set((state) => {
      const current = state.modes[mode];
      if (!current) return state;
      const isKillSwitchReset = current.status === "kill-switch" && config.allocation !== undefined;
      const modes = {
        ...state.modes,
        [mode]: {
          ...current,
          ...config,
          ...(isKillSwitchReset ? { status: "stopped" as ModeStatus, killSwitchDetail: null } : {}),
        },
      };
      return {
        modes,
        stats: aggregateSummaryStats(modes, state.stats.equity, state.stats.available, state.historicalPnlBase, state.historicalTradesBase, state.historicalVolumeBase),
      };
    }),
  setTradeHistory: (data, page) =>
    set({
      tradeHistory: {
        trades: data.trades,
        total: data.total,
        page,
        loading: false,
      },
    }),
  setTradeHistoryLoading: (loading) =>
    set((state) => ({
      tradeHistory: { ...state.tradeHistory, loading },
    })),
  setTradeHistoryPage: (page) =>
    set((state) => ({
      tradeHistory: { ...state.tradeHistory, page },
    })),
  loadInitialStatus: (data) =>
    set((state) => {
      const strategies = data.strategies ?? [];
      const modes: Record<ModeType, ModeStoreEntry> = {};
      for (const s of strategies) {
        modes[s.modeType] = createDefaultMode(s.modeType);
      }
      for (const [key, mc] of Object.entries(data.modes)) {
        if (modes[key]) {
          modes[key] = {
            ...modes[key],
            ...mc,
            errorDetail: (mc as Record<string, unknown>).errorDetail !== undefined
              ? (mc as ModeStoreEntry).errorDetail
              : modes[key].errorDetail,
            killSwitchDetail: (mc as Record<string, unknown>).killSwitchDetail !== undefined
              ? (mc as ModeStoreEntry).killSwitchDetail
              : modes[key].killSwitchDetail,
          };
        }
      }
      const loadedTrades = data.trades?.slice(0, 500) ?? [];
      if (loadedTrades.length > 0) {
        tradeIdCounter = Math.max(tradeIdCounter, ...loadedTrades.map((t) => t.id));
      }
      const loadedPositions = (data.positions ?? []).filter((p) => isValidPosition(p) && modes[(p as Position).mode] !== undefined).slice(0, 200);
      if (loadedPositions.length > 0) {
        positionIdCounter = Math.max(positionIdCounter, ...loadedPositions.map((p) => p.id));
      }
      // Clear any pending close timers from previous session
      for (const timer of pendingCloseTimers.values()) clearTimeout(timer);
      pendingCloseTimers.clear();
      // Extract historical baselines from server stats (total - session current = historical base)
      const serverStats = data.stats;
      const historicalPnlBase = serverStats ? serverStats.totalPnl - serverStats.sessionPnl : 0;
      const modesArray = Object.values(modes);
      const historicalTradesBase = serverStats ? Math.max(0, (serverStats.totalTrades ?? 0) - modesArray.reduce((s, m) => s + m.stats.trades, 0)) : 0;
      const historicalVolumeBase = serverStats ? Math.max(0, (serverStats.totalVolume ?? 0) - modesArray.reduce((s, m) => s + m.stats.volume, 0)) : 0;
      return {
        initialized: true,
        strategies,
        modes,
        historicalPnlBase,
        historicalTradesBase,
        historicalVolumeBase,
        trades: loadedTrades,
        positions: loadedPositions,
        closingPositions: [],
        connection: {
          status: data.connection.status,
          equity: data.connection.equity,
          available: data.connection.available,
        },
        stats: aggregateSummaryStats(modes, data.connection.equity, data.connection.available, historicalPnlBase, historicalTradesBase, historicalVolumeBase),
        tradeHistory: {
          trades: loadedTrades.slice(0, 50),
          total: loadedTrades.length,
          page: 0,
          loading: false,
        },
      };
    }),
  handleWsMessage: (message) => {
    if (message.event === EVENTS.CONNECTION_STATUS) {
      const data = message.data as Record<string, unknown>;
      if (
        typeof data?.rpc === "boolean" &&
        typeof data?.wallet === "string" &&
        typeof data?.equity === "number" &&
        typeof data?.available === "number"
      ) {
        set((state) => ({
          connection: {
            status: data.rpc ? "connected" : "disconnected",
            equity: data.equity,
            available: data.available,
          },
          stats: { ...state.stats, equity: data.equity, available: data.available },
        }));
      }
    } else if (message.event === EVENTS.ALERT_TRIGGERED) {
      const data = message.data as Record<string, unknown>;
      if (
        typeof data?.severity === "string" &&
        VALID_SEVERITIES.has(data.severity) &&
        typeof data?.code === "string" &&
        typeof data?.message === "string"
      ) {
        const autoDismissMs = typeof data.autoDismissMs === "number" && data.autoDismissMs > 0
          ? data.autoDismissMs
          : undefined;
        const alertMode = typeof data.mode === "string" && data.mode.length > 0
          ? data.mode as ModeType
          : undefined;
        const alert: Alert = {
          id: ++alertIdCounter,
          severity: data.severity as Alert["severity"],
          code: data.code,
          message: data.message,
          details: typeof data.details === "string" ? data.details : null,
          resolution: typeof data.resolution === "string" ? data.resolution : null,
          timestamp: message.timestamp,
          autoDismissMs,
          mode: alertMode,
        };

        // Handle API connection failure — update connection status for top-bar indicator
        // (runs BEFORE severity routing — must not break)
        if (data.code === "API_CONNECTION_FAILED") {
          if (data.severity === "warning") {
            set((state) => ({
              connection: { ...state.connection, status: "reconnecting" },
            }));
          } else if (data.severity === "critical") {
            set((state) => ({
              connection: { ...state.connection, status: "disconnected" },
            }));
          } else if (data.severity === "info") {
            set((state) => ({
              connection: { ...state.connection, status: "connected" },
            }));
          }
        }

        // Handle kill switch alert for modes
        // (runs BEFORE severity routing — must not break)
        if (data.code === "KILL_SWITCH_TRIGGERED") {
          // Use validated alertMode first, fall back to regex extraction with validation
          const details = data.details as string | undefined;
          const modeMatch = details?.match(/mode[:\s]+(\w+)/i);
          const regexMode = modeMatch?.[1];
          const targetMode = alertMode
            || (regexMode ? regexMode as ModeType : undefined);
          if (targetMode) {
            set((state) => {
              if (!state.modes[targetMode]) return state;
              return {
                modes: {
                  ...state.modes,
                  [targetMode]: {
                    ...state.modes[targetMode],
                    status: "kill-switch" as ModeStatus,
                    killSwitchDetail: {
                      positionsClosed: typeof (data as Record<string, unknown>).positionsClosed === "number"
                        ? (data as Record<string, unknown>).positionsClosed as number
                        : 0,
                      lossAmount: typeof (data as Record<string, unknown>).lossAmount === "number"
                        ? (data as Record<string, unknown>).lossAmount as number
                        : 0,
                    },
                  },
                },
              };
            });
          }
        }

        // Route by severity: critical → banner (alerts[]), warning/info → toast queue
        if (alert.severity === "critical") {
          // Deduplicate by code — replace existing alert with same code
          // Critical alerts are never auto-dismissed (AC #1) — they persist until resolved
          set((state) => ({
            alerts: [
              ...state.alerts.filter((a) => a.code !== alert.code),
              alert,
            ],
          }));
        } else {
          // warning/info → toast queue (batches survive rapid consecutive alerts)
          set((state) => ({ toastQueue: [...state.toastQueue, alert] }));
        }
      }
    } else if (message.event === EVENTS.MODE_STARTED) {
      const data = message.data as Record<string, unknown>;
      const mode = data?.mode as ModeType | undefined;
      if (mode) {
        set((state) => {
          if (!state.modes[mode]) return state;
          if (state.modes[mode].status === "kill-switch") return state;
          return {
            modes: {
              ...state.modes,
              [mode]: { ...state.modes[mode], status: "running" as ModeStatus, errorDetail: null },
            },
          };
        });
      }
    } else if (message.event === EVENTS.MODE_STOPPED) {
      const data = message.data as Record<string, unknown>;
      const mode = data?.mode as ModeType | undefined;
      if (mode) {
        set((state) => {
          if (!state.modes[mode]) return state;
          // Preserve kill-switch status — MODE_STOPPED from forceStop() must not overwrite it
          if (state.modes[mode].status === "kill-switch") return state;
          const finalStats = data.finalStats as ModeStats | undefined;
          const modes = {
            ...state.modes,
            [mode]: {
              ...state.modes[mode],
              status: "stopped" as ModeStatus,
              errorDetail: null,
              ...(finalStats ? { stats: finalStats } : {}),
            },
          };
          return {
            modes,
            stats: aggregateSummaryStats(modes, state.stats.equity, state.stats.available, state.historicalPnlBase, state.historicalTradesBase, state.historicalVolumeBase),
          };
        });
      }
    } else if (message.event === EVENTS.MODE_ERROR) {
      const data = message.data as Record<string, unknown>;
      const mode = data?.mode as ModeType | undefined;
      if (mode) {
        set((state) => {
          if (!state.modes[mode]) return state;
          const error = data.error as { code: string; message: string; details: string | null } | undefined;
          return {
            modes: {
              ...state.modes,
              [mode]: {
                ...state.modes[mode],
                status: "error" as ModeStatus,
                errorDetail: error ?? null,
              },
            },
          };
        });
      }
    } else if (message.event === EVENTS.STATS_UPDATED) {
      const data = message.data as Record<string, unknown>;
      const mode = data?.mode as ModeType | undefined;
      if (
        mode &&
        Number.isFinite(data.pnl) &&
        Number.isFinite(data.trades) &&
        Number.isFinite(data.volume) &&
        Number.isFinite(data.allocated) &&
        Number.isFinite(data.remaining)
      ) {
        set((state) => {
          if (!state.modes[mode]) return state;
          const modes = {
            ...state.modes,
            [mode]: {
              ...state.modes[mode],
              allocation: typeof data.allocated === "number" ? (data.allocated as number) : state.modes[mode].allocation,
              stats: {
                pnl: data.pnl,
                trades: data.trades,
                volume: data.volume,
                allocated: data.allocated,
                remaining: data.remaining,
              },
            },
          };
          return {
            modes,
            stats: aggregateSummaryStats(modes, state.stats.equity, state.stats.available, state.historicalPnlBase, state.historicalTradesBase, state.historicalVolumeBase),
          };
        });
      }
    } else if (message.event === EVENTS.TRADE_EXECUTED) {
      const data = message.data as Record<string, unknown>;
      if (
        typeof data?.mode === "string" &&
        typeof data?.pair === "string" &&
        data.pair.length > 0 &&
        typeof data?.side === "string" &&
        VALID_SIDES.has(data.side) &&
        Number.isFinite(data?.size) &&
        Number.isFinite(data?.price) &&
        Number.isFinite(data?.pnl) &&
        Number.isFinite(data?.fees)
      ) {
        set((state) => {
          if (state.modes[data.mode as string] === undefined) return state;
          const trade: Trade = {
            id: tradeIdCounter--,
            mode: data.mode as ModeType,
            pair: data.pair,
            side: data.side as Trade["side"],
            size: data.size,
            price: data.price,
            pnl: data.pnl,
            fees: data.fees,
            timestamp: message.timestamp,
          };
          return {
            trades: [...state.trades, trade].slice(-500),
            tradeHistory: {
              ...state.tradeHistory,
              total: state.tradeHistory.total + 1,
              trades: state.tradeHistory.page === 0
                ? [trade, ...state.tradeHistory.trades].slice(0, 50)
                : state.tradeHistory.trades,
            },
          };
        });
      }
    } else if (message.event === EVENTS.POSITION_OPENED) {
      const data = message.data as Record<string, unknown>;
      if (
        typeof data?.mode === "string" &&
        typeof data?.pair === "string" &&
        data.pair.length > 0 &&
        typeof data?.side === "string" &&
        VALID_SIDES.has(data.side) &&
        Number.isFinite(data?.size) &&
        Number.isFinite(data?.entryPrice) &&
        Number.isFinite(data?.stopLoss)
      ) {
        set((state) => {
          if (state.modes[data.mode as string] === undefined) return state;
          const position: Position = {
            id: ++positionIdCounter,
            mode: data.mode as ModeType,
            pair: data.pair,
            side: data.side as Position["side"],
            size: data.size as number,
            entryPrice: data.entryPrice as number,
            stopLoss: data.stopLoss as number,
            timestamp: message.timestamp,
          };
          return {
            positions: [...state.positions, position].slice(-200),
          };
        });
      }
    } else if (message.event === EVENTS.POSITION_CLOSED) {
      const data = message.data as Record<string, unknown>;
      if (
        typeof data?.mode === "string" &&
        typeof data?.pair === "string" &&
        data.pair.length > 0 &&
        typeof data?.side === "string" &&
        VALID_SIDES.has(data.side) &&
        Number.isFinite(data?.size) &&
        Number.isFinite(data?.exitPrice) &&
        Number.isFinite(data?.pnl)
      ) {
        let matchedId: number | null = null;
        set((state) => {
          if (state.modes[data.mode as string] === undefined) return state;
          const matched = state.positions.find(
            (p) => p.mode === data.mode && p.pair === data.pair && p.side === data.side
          );
          if (!matched || state.closingPositions.includes(matched.id)) return state;
          matchedId = matched.id;
          return {
            closingPositions: [...state.closingPositions, matched.id],
          };
        });
        if (matchedId !== null) {
          const idToRemove = matchedId;
          const timer = setTimeout(() => {
            pendingCloseTimers.delete(idToRemove);
            set((state) => ({
              positions: state.positions.filter((p) => p.id !== idToRemove),
              closingPositions: state.closingPositions.filter((id) => id !== idToRemove),
            }));
          }, 300);
          pendingCloseTimers.set(idToRemove, timer);
        }
      }
    } else if (import.meta.env.DEV) {
      console.log(`[WS] Unhandled event: ${message.event}`);
    }
  },
}));

export default useStore;
