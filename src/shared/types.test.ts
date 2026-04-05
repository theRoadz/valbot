import { describe, it, expect, expectTypeOf } from "vitest";
import type {
  ConnectionStatus,
  ConnectionState,
  SummaryStats,
  ModeType,
  Alert,
  TradeSide,
  ModeStatus,
  Trade,
  Position,
  ModeStats,
  ModeConfig,
} from "./types";
import { urlModeToModeType, modeTypeToSlug, fromSmallestUnit, toSmallestUnit } from "./types";

describe("shared types", () => {
  it("ConnectionStatus is a string literal union", () => {
    expectTypeOf<ConnectionStatus>().toMatchTypeOf<string>();
    const connected: ConnectionStatus = "connected";
    const reconnecting: ConnectionStatus = "reconnecting";
    const disconnected: ConnectionStatus = "disconnected";
    expectTypeOf(connected).toEqualTypeOf<ConnectionStatus>();
    expectTypeOf(reconnecting).toEqualTypeOf<ConnectionStatus>();
    expectTypeOf(disconnected).toEqualTypeOf<ConnectionStatus>();
  });

  it("ConnectionState has status, equity, and available", () => {
    expectTypeOf<ConnectionState>().toHaveProperty("status");
    expectTypeOf<ConnectionState>().toHaveProperty("equity");
    expectTypeOf<ConnectionState>().toHaveProperty("available");
    const state: ConnectionState = { status: "disconnected", equity: 0, available: 0 };
    expectTypeOf(state.status).toEqualTypeOf<ConnectionStatus>();
    expectTypeOf(state.equity).toEqualTypeOf<number>();
    expectTypeOf(state.available).toEqualTypeOf<number>();
  });

  it("SummaryStats has all required fields", () => {
    const stats: SummaryStats = {
      equity: 0,
      available: 0,
      totalPnl: 0,
      sessionPnl: 0,
      totalTrades: 0,
      totalVolume: 0,
    };
    expectTypeOf(stats.equity).toEqualTypeOf<number>();
    expectTypeOf(stats.available).toEqualTypeOf<number>();
    expectTypeOf(stats.totalPnl).toEqualTypeOf<number>();
    expectTypeOf(stats.sessionPnl).toEqualTypeOf<number>();
    expectTypeOf(stats.totalTrades).toEqualTypeOf<number>();
    expectTypeOf(stats.totalVolume).toEqualTypeOf<number>();
  });

  it("ModeType is a string literal union", () => {
    expectTypeOf<ModeType>().toMatchTypeOf<string>();
    const vm: ModeType = "volumeMax";
    const ph: ModeType = "profitHunter";
    const arb: ModeType = "arbitrage";
    expectTypeOf(vm).toEqualTypeOf<ModeType>();
    expectTypeOf(ph).toEqualTypeOf<ModeType>();
    expectTypeOf(arb).toEqualTypeOf<ModeType>();
  });

  it("Alert has all required fields", () => {
    const alert: Alert = {
      id: 1,
      severity: "warning",
      code: "TEST",
      message: "test",
      details: null,
      resolution: null,
      timestamp: Date.now(),
    };
    expectTypeOf(alert.id).toEqualTypeOf<number>();
    expectTypeOf(alert.severity).toEqualTypeOf<"info" | "warning" | "critical">();
    expectTypeOf(alert.code).toEqualTypeOf<string>();
    expectTypeOf(alert.details).toEqualTypeOf<string | null>();
    expectTypeOf(alert.timestamp).toEqualTypeOf<number>();
  });

  it("TradeSide is Long or Short", () => {
    expectTypeOf<TradeSide>().toMatchTypeOf<string>();
    const long: TradeSide = "Long";
    const short: TradeSide = "Short";
    expectTypeOf(long).toEqualTypeOf<TradeSide>();
    expectTypeOf(short).toEqualTypeOf<TradeSide>();
  });

  it("ModeStatus has all six values including stopping", () => {
    expectTypeOf<ModeStatus>().toMatchTypeOf<string>();
    const stopped: ModeStatus = "stopped";
    const starting: ModeStatus = "starting";
    const running: ModeStatus = "running";
    const stopping: ModeStatus = "stopping";
    const error: ModeStatus = "error";
    const killSwitch: ModeStatus = "kill-switch";
    expectTypeOf(stopped).toEqualTypeOf<ModeStatus>();
    expectTypeOf(starting).toEqualTypeOf<ModeStatus>();
    expectTypeOf(running).toEqualTypeOf<ModeStatus>();
    expectTypeOf(stopping).toEqualTypeOf<ModeStatus>();
    expectTypeOf(error).toEqualTypeOf<ModeStatus>();
    expectTypeOf(killSwitch).toEqualTypeOf<ModeStatus>();
  });

  it("Trade interface mirrors DB shape with number types", () => {
    const trade: Trade = {
      id: 1,
      mode: "volumeMax",
      pair: "SOL/USDC",
      side: "Long",
      size: 100,
      price: 150.5,
      pnl: 10,
      fees: 0.5,
      timestamp: Date.now(),
    };
    expectTypeOf(trade.id).toEqualTypeOf<number>();
    expectTypeOf(trade.mode).toEqualTypeOf<ModeType>();
    expectTypeOf(trade.side).toEqualTypeOf<TradeSide>();
    expectTypeOf(trade.size).toEqualTypeOf<number>();
  });

  it("Position interface has required fields", () => {
    const pos: Position = {
      id: 1,
      mode: "profitHunter",
      pair: "ETH/USDC",
      side: "Short",
      size: 50,
      entryPrice: 3000,
      stopLoss: 3100,
      timestamp: Date.now(),
    };
    expectTypeOf(pos.entryPrice).toEqualTypeOf<number>();
    expectTypeOf(pos.stopLoss).toEqualTypeOf<number>();
  });

  it("ModeStats has all number fields", () => {
    const stats: ModeStats = { pnl: 0, trades: 0, volume: 0, allocated: 0, remaining: 0 };
    expectTypeOf(stats.pnl).toEqualTypeOf<number>();
    expectTypeOf(stats.allocated).toEqualTypeOf<number>();
  });

  it("ModeConfig composes ModeStats", () => {
    const config: ModeConfig = {
      mode: "arbitrage",
      status: "stopped",
      allocation: 0,
      pairs: [],
      slippage: 0.5,
      stats: { pnl: 0, trades: 0, volume: 0, allocated: 0, remaining: 0 },
    };
    expectTypeOf(config.mode).toEqualTypeOf<ModeType>();
    expectTypeOf(config.status).toEqualTypeOf<ModeStatus>();
    expectTypeOf(config.stats).toEqualTypeOf<ModeStats>();
  });
});

describe("urlModeToModeType", () => {
  it("maps volume-max to volumeMax", () => {
    expect(urlModeToModeType("volume-max")).toBe("volumeMax");
  });

  it("maps profit-hunter to profitHunter", () => {
    expect(urlModeToModeType("profit-hunter")).toBe("profitHunter");
  });

  it("maps arbitrage to arbitrage", () => {
    expect(urlModeToModeType("arbitrage")).toBe("arbitrage");
  });

  it("returns undefined for unknown mode", () => {
    expect(urlModeToModeType("invalid")).toBeUndefined();
  });
});

describe("modeTypeToSlug", () => {
  it("maps volumeMax to volume-max", () => {
    expect(modeTypeToSlug("volumeMax")).toBe("volume-max");
  });

  it("maps profitHunter to profit-hunter", () => {
    expect(modeTypeToSlug("profitHunter")).toBe("profit-hunter");
  });

  it("maps arbitrage to arbitrage", () => {
    expect(modeTypeToSlug("arbitrage")).toBe("arbitrage");
  });
});

describe("fromSmallestUnit / toSmallestUnit", () => {
  it("converts 1_000_000 smallest units to 1.0", () => {
    expect(fromSmallestUnit(1_000_000)).toBe(1);
  });

  it("converts 1.0 to 1_000_000 smallest units", () => {
    expect(toSmallestUnit(1)).toBe(1_000_000);
  });

  it("handles fractional display values", () => {
    expect(fromSmallestUnit(500_000)).toBe(0.5);
    expect(toSmallestUnit(0.5)).toBe(500_000);
  });

  it("rounds to nearest integer on toSmallestUnit", () => {
    expect(toSmallestUnit(1.0000001)).toBe(1_000_000);
  });

  it("roundtrips without precision loss", () => {
    const original = 123.456789;
    expect(fromSmallestUnit(toSmallestUnit(original))).toBeCloseTo(original, 5);
  });

  it("handles zero", () => {
    expect(fromSmallestUnit(0)).toBe(0);
    expect(toSmallestUnit(0)).toBe(0);
  });

  it("handles negative values", () => {
    expect(fromSmallestUnit(-1_500_000)).toBe(-1.5);
    expect(toSmallestUnit(-1.5)).toBe(-1_500_000);
  });
});
