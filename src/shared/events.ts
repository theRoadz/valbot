// WebSocket event type catalog for ValBot
// Story 1.4: Event constants, WsMessage base type, ConnectionStatusPayload
// Full payload types for other events will be added in Story 2.1

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
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

export interface WsMessage {
  event: EventName;
  timestamp: number;
  data: unknown;
}

export interface ConnectionStatusPayload {
  rpc: boolean;
  wallet: string;
  balance: number;
}
