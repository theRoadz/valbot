import { create } from "zustand";
import type { ConnectionStatus, SummaryStats, Alert, ModeType, ModeStatus, ModeConfig, ModeStats, StatusResponse } from "@shared/types";
import { EVENTS, type ConnectionStatusPayload, type WsMessage } from "@shared/events";

let alertIdCounter = Date.now();
const VALID_SEVERITIES = new Set(["info", "warning", "critical"]);

function aggregateSummaryStats(modes: ValBotStore["modes"], equity: number, available: number): SummaryStats {
  const allModes = Object.values(modes);
  return {
    equity,
    available,
    totalPnl: allModes.reduce((sum, m) => sum + m.stats.pnl, 0),
    sessionPnl: allModes.reduce((sum, m) => sum + m.stats.pnl, 0),
    totalTrades: allModes.reduce((sum, m) => sum + m.stats.trades, 0),
    totalVolume: allModes.reduce((sum, m) => sum + m.stats.volume, 0),
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
  stats: SummaryStats;
  alerts: Alert[];
  modes: {
    volumeMax: ModeStoreEntry;
    profitHunter: ModeStoreEntry;
    arbitrage: ModeStoreEntry;
  };
  setConnectionStatus: (status: ConnectionStatus) => void;
  updateConnection: (data: ConnectionStatusPayload) => void;
  addAlert: (alert: Alert) => void;
  dismissAlert: (id: number) => void;
  setModeStatus: (mode: ModeType, status: ModeStatus) => void;
  updateModeStats: (mode: ModeType, stats: ModeStats) => void;
  setModeConfig: (mode: ModeType, config: Partial<ModeConfig>) => void;
  loadInitialStatus: (data: StatusResponse) => void;
  handleWsMessage: (message: WsMessage) => void;
}

const useStore = create<ValBotStore>()((set) => ({
  connection: {
    status: "disconnected",
    equity: 0,
    available: 0,
  },
  stats: {
    equity: 0,
    available: 0,
    totalPnl: 0,
    sessionPnl: 0,
    totalTrades: 0,
    totalVolume: 0,
  },
  alerts: [],
  modes: {
    volumeMax: createDefaultMode("volumeMax"),
    profitHunter: createDefaultMode("profitHunter"),
    arbitrage: createDefaultMode("arbitrage"),
  },
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
  dismissAlert: (id) =>
    set((state) => ({
      alerts: state.alerts.filter((a) => a.id !== id),
    })),
  setModeStatus: (mode, status) =>
    set((state) => ({
      modes: {
        ...state.modes,
        [mode]: {
          ...state.modes[mode],
          status,
          errorDetail: status !== "error" ? null : state.modes[mode].errorDetail,
          killSwitchDetail: status !== "kill-switch" ? null : state.modes[mode].killSwitchDetail,
        },
      },
    })),
  updateModeStats: (mode, stats) =>
    set((state) => {
      const modes = {
        ...state.modes,
        [mode]: { ...state.modes[mode], stats },
      };
      return {
        modes,
        stats: aggregateSummaryStats(modes, state.stats.equity, state.stats.available),
      };
    }),
  setModeConfig: (mode, config) =>
    set((state) => {
      const modes = {
        ...state.modes,
        [mode]: { ...state.modes[mode], ...config },
      };
      return {
        modes,
        stats: aggregateSummaryStats(modes, state.stats.equity, state.stats.available),
      };
    }),
  loadInitialStatus: (data) =>
    set((state) => {
      const modes = { ...state.modes };
      const validModes = new Set<string>(Object.keys(modes));
      for (const key of Object.keys(data.modes).filter((k) => validModes.has(k)) as ModeType[]) {
        const mc = data.modes[key];
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
      return {
        modes,
        connection: {
          status: data.connection.status,
          equity: data.connection.equity,
          available: data.connection.available,
        },
        stats: aggregateSummaryStats(modes, data.connection.equity, data.connection.available),
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
        const alert: Alert = {
          id: ++alertIdCounter,
          severity: data.severity as Alert["severity"],
          code: data.code,
          message: data.message,
          details: typeof data.details === "string" ? data.details : null,
          resolution: typeof data.resolution === "string" ? data.resolution : null,
          timestamp: message.timestamp,
        };
        // Deduplicate by code — replace existing alert with same code
        set((state) => ({
          alerts: [
            ...state.alerts.filter((a) => a.code !== alert.code),
            alert,
          ],
        }));

        // Handle kill switch alert for modes
        if (data.code === "KILL_SWITCH_TRIGGERED") {
          const details = data.details as string | undefined;
          const modeMatch = details?.match(/mode[:\s]+(\w+)/i);
          const mode = (data as Record<string, unknown>).mode as ModeType | undefined;
          const targetMode = mode || (modeMatch ? modeMatch[1] as ModeType : undefined);
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
            stats: aggregateSummaryStats(modes, state.stats.equity, state.stats.available),
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
        typeof data.pnl === "number" &&
        typeof data.trades === "number" &&
        typeof data.volume === "number" &&
        typeof data.allocated === "number" &&
        typeof data.remaining === "number"
      ) {
        set((state) => {
          if (!state.modes[mode]) return state;
          const modes = {
            ...state.modes,
            [mode]: {
              ...state.modes[mode],
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
            stats: aggregateSummaryStats(modes, state.stats.equity, state.stats.available),
          };
        });
      }
    } else if (message.event === EVENTS.TRADE_EXECUTED) {
      // No-op — trade log (Story 2.6) will consume these
    } else if (message.event === EVENTS.POSITION_OPENED) {
      // No-op — positions table (Story 2.7) will consume these
    } else if (message.event === EVENTS.POSITION_CLOSED) {
      // No-op — positions table (Story 2.7) will consume these
    } else if (import.meta.env.DEV) {
      console.log(`[WS] Unhandled event: ${message.event}`);
    }
  },
}));

export default useStore;
