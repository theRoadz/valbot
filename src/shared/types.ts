// Shared type definitions for ValBot

export type ConnectionStatus = "connected" | "reconnecting" | "disconnected";

export interface ConnectionState {
  status: ConnectionStatus;
  equity: number;
  available: number;
}

export interface SummaryStats {
  equity: number;
  available: number;
  totalPnl: number;
  sessionPnl: number;
  totalTrades: number;
  totalVolume: number;
}

export type ModeType = string;

export interface Alert {
  id: number;
  severity: "info" | "warning" | "critical";
  code: string;
  message: string;
  details: string | null;
  resolution: string | null;
  timestamp: number;
  autoDismissMs?: number;
  mode?: ModeType;
}

export type TradeSide = "Long" | "Short";

export type ModeStatus = "stopped" | "starting" | "running" | "stopping" | "error" | "kill-switch";

export interface Trade {
  id: number;
  mode: ModeType;
  pair: string;
  side: TradeSide;
  size: number;
  price: number;
  pnl: number;
  fees: number;
  timestamp: number;
}

export interface Position {
  id: number;
  mode: ModeType;
  pair: string;
  side: TradeSide;
  size: number;
  entryPrice: number;
  stopLoss: number;
  timestamp: number;
}

export interface ModeStats {
  pnl: number;
  trades: number;
  volume: number;
  allocated: number;
  remaining: number;
}

export interface ModeConfig {
  mode: ModeType;
  status: ModeStatus;
  allocation: number;
  positionSize?: number;
  maxAllocation?: number;
  pairs: string[];
  slippage: number;
  stats: ModeStats;
  // RSI strategy config (Profit Hunter only)
  rsiPeriod?: number;
  oversoldThreshold?: number;
  overboughtThreshold?: number;
  exitRsi?: number;
}

// DB stores monetary values as smallest-unit integers (USDC × 1e6) — see ADR-001
// These helpers convert between DB integers and display numbers.
const USDC_DECIMALS = 6;
const USDC_SCALE = 10 ** USDC_DECIMALS;

export function fromSmallestUnit(value: number): number {
  return value / USDC_SCALE;
}

export function toSmallestUnit(value: number): number {
  return Math.round(value * USDC_SCALE);
}

// --- Pyth Oracle types ---

export interface PythPriceData {
  price: number;
  confidence: number;
  expo: number;
  publishTime: number;
  feedId: string;
}

export interface PriceFeedEntry {
  pair: string;
  price: number;
  movingAverage: number | null;
  lastUpdate: number;
  feedId: string;
}

export const PYTH_FEED_IDS: Record<string, string> = {
  "SOL-PERP": "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
  "BTC-PERP": "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  "ETH-PERP": "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
};

export interface TradeHistoryResponse {
  trades: Trade[];
  total: number;
}

export interface StrategyInfo {
  name: string;
  description: string;
  modeType: ModeType;
  urlSlug: string;
  modeColor: string;
  status: ModeStatus;
}

export interface StatusResponse {
  modes: Record<ModeType, ModeConfig>;
  positions: Position[];
  trades: Trade[];
  connection: ConnectionState;
  stats?: { totalPnl: number; sessionPnl: number; totalTrades: number; totalVolume: number };
  strategies: StrategyInfo[];
}
