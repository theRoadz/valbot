import { describe, it, expectTypeOf } from "vitest";
import type {
  ConnectionStatus,
  ConnectionState,
  SummaryStats,
  ModeType,
} from "./types";

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

  it("ConnectionState has status and walletBalance", () => {
    expectTypeOf<ConnectionState>().toHaveProperty("status");
    expectTypeOf<ConnectionState>().toHaveProperty("walletBalance");
    const state: ConnectionState = { status: "disconnected", walletBalance: 0 };
    expectTypeOf(state.status).toEqualTypeOf<ConnectionStatus>();
    expectTypeOf(state.walletBalance).toEqualTypeOf<number>();
  });

  it("SummaryStats has all required fields", () => {
    const stats: SummaryStats = {
      walletBalance: 0,
      totalPnl: 0,
      sessionPnl: 0,
      totalTrades: 0,
      totalVolume: 0,
    };
    expectTypeOf(stats.walletBalance).toEqualTypeOf<number>();
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
});
