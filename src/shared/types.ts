// Shared type definitions for ValBot
// Story 1.4: Connection-relevant types
// Full Trade, Position, Alert types will be added in Story 2.1

export type ConnectionStatus = "connected" | "reconnecting" | "disconnected";

export interface ConnectionState {
  status: ConnectionStatus;
  walletBalance: number;
}

export interface SummaryStats {
  walletBalance: number;
  totalPnl: number;
  sessionPnl: number;
  totalTrades: number;
  totalVolume: number;
}

export type ModeType = "volumeMax" | "profitHunter" | "arbitrage";

export interface Alert {
  id: number;
  severity: "info" | "warning" | "critical";
  code: string;
  message: string;
  details: string | null;
  resolution: string | null;
  timestamp: number;
}
