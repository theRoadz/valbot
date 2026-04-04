import { create } from "zustand";
import type { ConnectionStatus, SummaryStats } from "@shared/types";
import { EVENTS, type ConnectionStatusPayload, type WsMessage } from "@shared/events";

interface ValBotStore {
  connection: {
    status: ConnectionStatus;
    walletBalance: number;
  };
  stats: SummaryStats;
  setConnectionStatus: (status: ConnectionStatus) => void;
  setWalletBalance: (balance: number) => void;
  updateConnection: (data: ConnectionStatusPayload) => void;
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
    } else if (import.meta.env.DEV) {
      console.log(`[WS] Unhandled event: ${message.event}`);
    }
  },
}));

export default useStore;
