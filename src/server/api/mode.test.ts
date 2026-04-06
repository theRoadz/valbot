import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import modeRoutes from "./mode.js";

const mockStartMode = vi.fn();
const mockStopMode = vi.fn();

// Mock broadcaster
vi.mock("../ws/broadcaster.js", () => ({
  broadcast: vi.fn(),
}));

// Mock engine
vi.mock("../engine/index.js", () => {
  const mockFundAllocator = {
    setAllocation: vi.fn(),
    getStats: vi.fn().mockReturnValue({ pnl: 0, trades: 0, volume: 0, allocated: 0, remaining: 0 }),
  };
  return {
    getEngine: vi.fn(() => ({ fundAllocator: mockFundAllocator })),
    startMode: (...args: any[]) => mockStartMode(...args),
    stopMode: (...args: any[]) => mockStopMode(...args),
    getModeStatus: vi.fn().mockReturnValue("stopped"),
    resetKillSwitch: vi.fn(),
    _getMockFundAllocator: () => mockFundAllocator,
  };
});

import { _getMockFundAllocator } from "../engine/index.js";
import { broadcast } from "../ws/broadcaster.js";

describe("mode routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await app.register(modeRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("POST /api/mode/:mode/start", () => {
    it("calls startMode and returns started status for valid mode", async () => {
      mockStartMode.mockResolvedValueOnce(undefined);
      const res = await app.inject({ method: "POST", url: "/api/mode/volume-max/start", payload: {} });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: "started", mode: "volumeMax" });
      expect(mockStartMode).toHaveBeenCalledWith("volumeMax", { pairs: ["SOL/USDC"], slippage: undefined });
    });

    it("calls startMode with custom pairs and slippage", async () => {
      mockStartMode.mockResolvedValueOnce(undefined);
      const res = await app.inject({
        method: "POST",
        url: "/api/mode/volume-max/start",
        payload: { pairs: ["ETH/USDC"], slippage: 0.3 },
      });
      expect(res.statusCode).toBe(200);
      expect(mockStartMode).toHaveBeenCalledWith("volumeMax", { pairs: ["ETH/USDC"], slippage: 0.3 });
    });

    it("returns error when mode is already running", async () => {
      const err = new Error("MODE_ALREADY_RUNNING");
      (err as any).name = "AppError";
      (err as any).code = "MODE_ALREADY_RUNNING";
      (err as any).statusCode = 500;
      mockStartMode.mockRejectedValueOnce(err);

      const res = await app.inject({ method: "POST", url: "/api/mode/volume-max/start", payload: {} });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });

    it("returns error when no allocation", async () => {
      const err = new Error("NO_ALLOCATION");
      (err as any).name = "AppError";
      (err as any).code = "NO_ALLOCATION";
      mockStartMode.mockRejectedValueOnce(err);

      const res = await app.inject({ method: "POST", url: "/api/mode/volume-max/start", payload: {} });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });

    it("returns error when mode is kill-switched", async () => {
      const err = new Error("MODE_KILL_SWITCHED");
      (err as any).name = "AppError";
      (err as any).code = "MODE_KILL_SWITCHED";
      mockStartMode.mockRejectedValueOnce(err);

      const res = await app.inject({ method: "POST", url: "/api/mode/volume-max/start", payload: {} });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });

    it("returns 400 for invalid mode", async () => {
      const res = await app.inject({ method: "POST", url: "/api/mode/invalid/start", payload: {} });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("POST /api/mode/:mode/stop", () => {
    it("calls stopMode and returns stopped status for valid mode", async () => {
      mockStopMode.mockResolvedValueOnce(undefined);
      const res = await app.inject({ method: "POST", url: "/api/mode/volume-max/stop" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: "stopped", mode: "volumeMax" });
      expect(mockStopMode).toHaveBeenCalledWith("volumeMax");
    });

    it("returns 400 for invalid mode", async () => {
      const res = await app.inject({ method: "POST", url: "/api/mode/bad-mode/stop" });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("PUT /api/mode/:mode/config", () => {
    it("returns updated status for valid mode and body", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/mode/volume-max/config",
        payload: { allocation: 400, pairs: ["SOL/USDC"], slippage: 0.3 },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: "updated", mode: "volumeMax" });
    });

    it("calls fundAllocator.setAllocation when allocation is provided", async () => {
      const mockAllocator = (_getMockFundAllocator as () => { setAllocation: ReturnType<typeof vi.fn> })();
      mockAllocator.setAllocation.mockClear();

      await app.inject({
        method: "PUT",
        url: "/api/mode/volume-max/config",
        payload: { allocation: 500 },
      });

      expect(mockAllocator.setAllocation).toHaveBeenCalledWith(
        "volumeMax",
        500_000_000, // toSmallestUnit(500)
      );
    });

    it("broadcasts STATS_UPDATED after allocation is set", async () => {
      const mockAllocator = (_getMockFundAllocator as () => { setAllocation: ReturnType<typeof vi.fn>; getStats: ReturnType<typeof vi.fn> })();
      mockAllocator.setAllocation.mockClear();
      (broadcast as ReturnType<typeof vi.fn>).mockClear();
      mockAllocator.getStats.mockReturnValue({ pnl: 0, trades: 0, volume: 0, allocated: 500, remaining: 500 });

      await app.inject({
        method: "PUT",
        url: "/api/mode/volume-max/config",
        payload: { allocation: 500 },
      });

      expect(broadcast).toHaveBeenCalledWith("stats.updated", {
        mode: "volumeMax",
        pnl: 0,
        trades: 0,
        volume: 0,
        allocated: 500,
        remaining: 500,
      });
    });

    it("does not call setAllocation when allocation is not provided", async () => {
      const mockAllocator = (_getMockFundAllocator as () => { setAllocation: ReturnType<typeof vi.fn> })();
      mockAllocator.setAllocation.mockClear();

      await app.inject({
        method: "PUT",
        url: "/api/mode/arbitrage/config",
        payload: { slippage: 0.3 },
      });

      expect(mockAllocator.setAllocation).not.toHaveBeenCalled();
    });

    it("accepts partial body", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/mode/arbitrage/config",
        payload: { allocation: 500 },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: "updated", mode: "arbitrage" });
    });

    it("accepts empty body", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/mode/profit-hunter/config",
        payload: {},
      });
      expect(res.statusCode).toBe(200);
    });

    it("returns 400 for invalid mode", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/mode/nope/config",
        payload: { allocation: 100 },
      });
      expect(res.statusCode).toBe(400);
    });

    it("rejects negative allocation", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/mode/volume-max/config",
        payload: { allocation: -1 },
      });
      expect(res.statusCode).toBe(400);
    });

    it("rejects negative slippage", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/mode/volume-max/config",
        payload: { slippage: -0.5 },
      });
      expect(res.statusCode).toBe(400);
    });

    it("rejects slippage over 100", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/mode/volume-max/config",
        payload: { slippage: 101 },
      });
      expect(res.statusCode).toBe(400);
    });

    it("strips additional properties in body", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/mode/volume-max/config",
        payload: { allocation: 100, unknown: "field" },
      });
      expect(res.statusCode).toBe(200);
    });
  });
});
