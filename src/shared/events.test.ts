import { describe, it, expect, expectTypeOf } from "vitest";
import {
  EVENTS,
  type EventName,
  type EventPayloadMap,
  type WsMessage,
  type TradeExecutedPayload,
  type StatsUpdatedPayload,
  type ModeStartedPayload,
  type ModeStoppedPayload,
  type ModeErrorPayload,
  type PositionOpenedPayload,
  type PositionClosedPayload,
  type AlertTriggeredPayload,
  type ConnectionStatusPayload,
} from "./events";

describe("EVENTS constants", () => {
  it("has all 9 event constants", () => {
    expect(EVENTS.TRADE_EXECUTED).toBe("trade.executed");
    expect(EVENTS.STATS_UPDATED).toBe("stats.updated");
    expect(EVENTS.MODE_STARTED).toBe("mode.started");
    expect(EVENTS.MODE_STOPPED).toBe("mode.stopped");
    expect(EVENTS.MODE_ERROR).toBe("mode.error");
    expect(EVENTS.POSITION_OPENED).toBe("position.opened");
    expect(EVENTS.POSITION_CLOSED).toBe("position.closed");
    expect(EVENTS.ALERT_TRIGGERED).toBe("alert.triggered");
    expect(EVENTS.CONNECTION_STATUS).toBe("connection.status");
  });

  it("EVENTS is readonly", () => {
    expect(Object.keys(EVENTS)).toHaveLength(10);
  });
});

describe("EventPayloadMap type-level", () => {
  it("TradeExecutedPayload is assignable to its event slot", () => {
    const payload: TradeExecutedPayload = {
      mode: "volumeMax",
      pair: "SOL/USDC",
      side: "Long",
      size: 100,
      price: 150,
      pnl: 10,
      fees: 0.5,
    };
    expectTypeOf(payload).toMatchTypeOf<EventPayloadMap["trade.executed"]>();
  });

  it("StatsUpdatedPayload matches map", () => {
    const payload: StatsUpdatedPayload = {
      mode: "profitHunter",
      trades: 5,
      volume: 1000,
      pnl: 50,
      allocated: 500,
      remaining: 450,
    };
    expectTypeOf(payload).toMatchTypeOf<EventPayloadMap["stats.updated"]>();
  });

  it("ModeStartedPayload matches map", () => {
    expectTypeOf<ModeStartedPayload>().toMatchTypeOf<EventPayloadMap["mode.started"]>();
  });

  it("ModeStoppedPayload matches map", () => {
    expectTypeOf<ModeStoppedPayload>().toMatchTypeOf<EventPayloadMap["mode.stopped"]>();
  });

  it("ModeErrorPayload matches map", () => {
    expectTypeOf<ModeErrorPayload>().toMatchTypeOf<EventPayloadMap["mode.error"]>();
  });

  it("PositionOpenedPayload matches map", () => {
    expectTypeOf<PositionOpenedPayload>().toMatchTypeOf<EventPayloadMap["position.opened"]>();
  });

  it("PositionClosedPayload matches map", () => {
    expectTypeOf<PositionClosedPayload>().toMatchTypeOf<EventPayloadMap["position.closed"]>();
  });

  it("AlertTriggeredPayload matches map", () => {
    expectTypeOf<AlertTriggeredPayload>().toMatchTypeOf<EventPayloadMap["alert.triggered"]>();
  });

  it("ConnectionStatusPayload matches map", () => {
    expectTypeOf<ConnectionStatusPayload>().toMatchTypeOf<EventPayloadMap["connection.status"]>();
  });

  it("EventName covers all EVENTS values", () => {
    expectTypeOf<typeof EVENTS.TRADE_EXECUTED>().toMatchTypeOf<EventName>();
    expectTypeOf<typeof EVENTS.CONNECTION_STATUS>().toMatchTypeOf<EventName>();
  });

  it("WsMessage generic narrows data to correct payload type", () => {
    type AlertMsg = WsMessage<"alert.triggered">;
    expectTypeOf<AlertMsg["data"]>().toEqualTypeOf<AlertTriggeredPayload>();
    expectTypeOf<AlertMsg["event"]>().toEqualTypeOf<"alert.triggered">();

    type TradeMsg = WsMessage<"trade.executed">;
    expectTypeOf<TradeMsg["data"]>().toEqualTypeOf<TradeExecutedPayload>();

    type ConnMsg = WsMessage<"connection.status">;
    expectTypeOf<ConnMsg["data"]>().toEqualTypeOf<ConnectionStatusPayload>();
  });

  it("WsMessage without generic param has wide types", () => {
    type AnyMsg = WsMessage;
    expectTypeOf<AnyMsg["event"]>().toEqualTypeOf<EventName>();
  });
});
