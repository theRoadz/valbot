// WebSocket event type catalog for ValBot

import type { ModeType, TradeSide, ModeStats } from "./types.js";

export const EVENTS = {
  TRADE_EXECUTED: "trade.executed",
  STATS_UPDATED: "stats.updated",
  MODE_STARTED: "mode.started",
  MODE_STOPPED: "mode.stopped",
  MODE_ERROR: "mode.error",
  POSITION_OPENED: "position.opened",
  POSITION_CLOSED: "position.closed",
  ALERT_TRIGGERED: "alert.triggered",
  CONNECTION_STATUS: "connection.status",
  PRICE_UPDATED: "price.updated",
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

export interface WsMessage<E extends EventName = EventName> {
  event: E;
  timestamp: number;
  data: E extends keyof EventPayloadMap ? EventPayloadMap[E] : unknown;
}

export interface ConnectionStatusPayload {
  rpc: boolean;
  wallet: string;
  equity: number;
  available: number;
}

// AlertTriggeredPayload intentionally omits `id` (DB-generated) and `timestamp`
// (carried on WsMessage envelope). Client maps to Alert via:
//   { ...payload, id: localCounter++, timestamp: wsMessage.timestamp }
export interface AlertTriggeredPayload {
  severity: "info" | "warning" | "critical";
  code: string;
  message: string;
  mode?: ModeType;
  details: string | null;
  resolution: string | null;
  positionsClosed?: number;
  lossAmount?: number;
  autoDismissMs?: number;
}

export interface TradeExecutedPayload {
  mode: ModeType;
  pair: string;
  side: TradeSide;
  size: number;
  price: number;
  pnl: number;
  fees: number;
}

export interface StatsUpdatedPayload {
  mode: ModeType;
  trades: number;
  volume: number;
  pnl: number;
  allocated: number;
  remaining: number;
}

export interface ModeStartedPayload {
  mode: ModeType;
}

export interface ModeStoppedPayload {
  mode: ModeType;
  finalStats: ModeStats;
}

export interface ModeErrorPayload {
  mode: ModeType;
  error: { code: string; message: string; details: string | null };
}

export interface PositionOpenedPayload {
  mode: ModeType;
  pair: string;
  side: TradeSide;
  size: number;
  entryPrice: number;
  stopLoss: number;
}

export interface PositionClosedPayload {
  mode: ModeType;
  pair: string;
  side: TradeSide;
  size: number;
  exitPrice: number;
  pnl: number;
}

export interface PriceUpdatedPayload {
  pair: string;
  price: number;
  movingAverage: number | null;
  timestamp: number;
}

export interface EventPayloadMap {
  "trade.executed": TradeExecutedPayload;
  "stats.updated": StatsUpdatedPayload;
  "mode.started": ModeStartedPayload;
  "mode.stopped": ModeStoppedPayload;
  "mode.error": ModeErrorPayload;
  "position.opened": PositionOpenedPayload;
  "position.closed": PositionClosedPayload;
  "alert.triggered": AlertTriggeredPayload;
  "connection.status": ConnectionStatusPayload;
  "price.updated": PriceUpdatedPayload;
}
