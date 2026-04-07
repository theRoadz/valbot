import { describe, it, expect, beforeAll, afterAll, vi, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import statusRoutes from "./status.js";

// Mock blockchain client module
vi.mock("../blockchain/client.js", () => ({
  getConnectionStatus: vi.fn(() => Promise.resolve(null)),
}));

import { getConnectionStatus } from "../blockchain/client.js";

// Mock engine module
vi.mock("../engine/index.js", () => {
  let mockEngine: unknown = null;
  return {
    initEngine: vi.fn(),
    getEngine: vi.fn(() => {
      if (!mockEngine) throw new Error("Engine not initialized");
      return mockEngine;
    }),
    getModeStatus: vi.fn(() => "stopped"),
    _setMockEngine: (engine: unknown) => { mockEngine = engine; },
  };
});

// Mock trades module
vi.mock("./trades.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./trades.js")>();
  return {
    ...original,
    getRecentTrades: vi.fn(() => ({ trades: [], total: 0 })),
  };
});

import { getEngine, _setMockEngine } from "../engine/index.js";
import { getRecentTrades } from "./trades.js";

describe("status route", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await app.register(statusRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    (_setMockEngine as (e: unknown) => void)(null);
  });

  it("GET /api/status returns default stubs when engine not initialized", async () => {
    const res = await app.inject({ method: "GET", url: "/api/status" });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body).toHaveProperty("modes");
    expect(body).toHaveProperty("positions");
    expect(body).toHaveProperty("trades");
    expect(body).toHaveProperty("connection");

    expect(body.modes).toHaveProperty("volumeMax");
    expect(body.modes).toHaveProperty("profitHunter");
    expect(body.modes).toHaveProperty("arbitrage");

    const vm = body.modes.volumeMax;
    expect(vm).toEqual({
      mode: "volumeMax",
      status: "stopped",
      allocation: 0,
      maxAllocation: 500,
      pairs: ["SOL/USDC"],
      slippage: 0.5,
      stats: { pnl: 0, trades: 0, volume: 0, allocated: 0, remaining: 0 },
    });

    expect(body.positions).toEqual([]);
    expect(body.trades).toEqual([]);
    expect(body.connection).toEqual({ status: "disconnected", equity: 0, available: 0 });
  });

  it("GET /api/status returns live data from engine when initialized", async () => {
    const mockFundAllocator = {
      getAllocation: vi.fn((mode: string) => {
        if (mode === "volumeMax") return { allocation: 1_000_000_000, remaining: 800_000_000 };
        return { allocation: 0, remaining: 0 };
      }),
      getStats: vi.fn((mode: string) => {
        if (mode === "volumeMax") return { pnl: 50, trades: 3, volume: 500, allocated: 1000, remaining: 800 };
        return { pnl: 0, trades: 0, volume: 0, allocated: 0, remaining: 0 };
      }),
      getPositionSize: vi.fn(() => null),
      getMaxAllocation: vi.fn(() => 500_000_000),
    };
    const mockPositionManager = {
      getPositions: vi.fn(() => [
        { id: 1, mode: "volumeMax", pair: "SOL/USDC", side: "Long", size: 10, entryPrice: 100, stopLoss: 95, timestamp: 1000 },
      ]),
      getModeStatus: vi.fn(() => undefined),
    };

    (_setMockEngine as (e: unknown) => void)({
      fundAllocator: mockFundAllocator,
      positionManager: mockPositionManager,
    });

    const res = await app.inject({ method: "GET", url: "/api/status" });
    expect(res.statusCode).toBe(200);

    const body = res.json();

    // volumeMax should have live stats
    expect(body.modes.volumeMax.allocation).toBe(1000); // fromSmallestUnit(1B) = 1000
    expect(body.modes.volumeMax.stats.trades).toBe(3);
    expect(body.modes.volumeMax.stats.pnl).toBe(50);

    // Positions from engine
    expect(body.positions).toHaveLength(1);
    expect(body.positions[0].pair).toBe("SOL/USDC");
  });

  it("GET /api/status returns live connection data when blockchain client is connected", async () => {
    vi.mocked(getConnectionStatus).mockResolvedValueOnce({
      rpc: true,
      wallet: "0x1234",
      equity: 150_000_000,
      available: 80_000_000,
    });

    const res = await app.inject({ method: "GET", url: "/api/status" });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.connection).toEqual({ status: "connected", equity: 150_000_000, available: 80_000_000 });
  });

  it("GET /api/status returns recent trades from DB", async () => {
    const mockTrades = [
      { id: 1, mode: "volumeMax" as const, pair: "SOL/USDC", side: "Long" as const, size: 10, price: 150, pnl: 5, fees: 0.1, timestamp: 3000 },
      { id: 2, mode: "profitHunter" as const, pair: "SOL/USDC", side: "Short" as const, size: 20, price: 145, pnl: -2, fees: 0.2, timestamp: 2000 },
    ];
    vi.mocked(getRecentTrades).mockReturnValueOnce({ trades: mockTrades, total: 2 });

    const res = await app.inject({ method: "GET", url: "/api/status" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.trades).toHaveLength(2);
    expect(body.trades[0].id).toBe(1);
    expect(body.trades[1].mode).toBe("profitHunter");
  });

  it("GET /api/status returns empty trades when DB query fails", async () => {
    vi.mocked(getRecentTrades).mockImplementationOnce(() => { throw new Error("DB failed"); });

    const res = await app.inject({ method: "GET", url: "/api/status" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.trades).toEqual([]);
  });

  it("GET /api/status returns disconnected when getConnectionStatus throws", async () => {
    vi.mocked(getConnectionStatus).mockRejectedValueOnce(new Error("API down"));

    const res = await app.inject({ method: "GET", url: "/api/status" });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.connection).toEqual({ status: "disconnected", equity: 0, available: 0 });
  });
});
