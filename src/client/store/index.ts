import { create } from "zustand";
import type { ConnectionStatus, SummaryStats, Alert } from "@shared/types";
import { EVENTS, type ConnectionStatusPayload, type WsMessage } from "@shared/events";

let alertIdCounter = Date.now();
const VALID_SEVERITIES = new Set(["info", "warning", "critical"]);

interface ValBotStore {
  connection: {
    status: ConnectionStatus;
    walletBalance: number;
  };
  stats: SummaryStats;
  alerts: Alert[];
  setConnectionStatus: (status: ConnectionStatus) => void;
  setWalletBalance: (balance: number) => void;
  updateConnection: (data: ConnectionStatusPayload) => void;
  addAlert: (alert: Alert) => void;
  dismissAlert: (id: number) => void;
  handleWsMessage: (message: WsMessage) => void;
}

const useStore = create<ValBotStore>()((set) => ({
  connection: {
    status: "disconnected",
    walletBalance: 0,
  },
  stats: {
    walletBalance: 0,
    totalPnl: 0,
    sessionPnl: 0,
    totalTrades: 0,
    totalVolume: 0,
  },
  alerts: [],
  setConnectionStatus: (status) =>
    set((state) => ({
      connection: { ...state.connection, status },
    })),
  setWalletBalance: (balance) =>
    set((state) => ({
      connection: { ...state.connection, walletBalance: balance },
      stats: { ...state.stats, walletBalance: balance },
    })),
  updateConnection: (data) =>
    set((state) => ({
      connection: {
        status: data.rpc ? "connected" : "disconnected",
        walletBalance: data.balance,
      },
      stats: { ...state.stats, walletBalance: data.balance },
    })),
  addAlert: (alert) =>
    set((state) => ({ alerts: [...state.alerts, alert] })),
  dismissAlert: (id) =>
    set((state) => ({
      alerts: state.alerts.filter((a) => a.id !== id),
    })),
  handleWsMessage: (message) => {
    if (message.event === EVENTS.CONNECTION_STATUS) {
      const data = message.data as Record<string, unknown>;
      if (
        typeof data?.rpc === "boolean" &&
        typeof data?.wallet === "string" &&
        typeof data?.balance === "number"
      ) {
        set((state) => ({
          connection: {
            status: data.rpc ? "connected" : "disconnected",
            walletBalance: data.balance,
          },
          stats: { ...state.stats, walletBalance: data.balance },
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
      }
    } else if (import.meta.env.DEV) {
      console.log(`[WS] Unhandled event: ${message.event}`);
    }
  },
}));

export default useStore;
