import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import modeRoutes from "./mode.js";

// Mock engine
vi.mock("../engine/index.js", () => {
  const mockFundAllocator = {
    setAllocation: vi.fn(),
  };
  return {
    getEngine: vi.fn(() => ({ fundAllocator: mockFundAllocator })),
    _getMockFundAllocator: () => mockFundAllocator,
  };
});

import { _getMockFundAllocator } from "../engine/index.js";

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
    it("returns started status for valid mode", async () => {
      const res = await app.inject({ method: "POST", url: "/api/mode/volume-max/start" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: "started", mode: "volumeMax" });
    });

    it("returns started for profit-hunter", async () => {
      const res = await app.inject({ method: "POST", url: "/api/mode/profit-hunter/start" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: "started", mode: "profitHunter" });
    });

    it("returns started for arbitrage", async () => {
      const res = await app.inject({ method: "POST", url: "/api/mode/arbitrage/start" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: "started", mode: "arbitrage" });
    });

    it("returns 400 for invalid mode", async () => {
      const res = await app.inject({ method: "POST", url: "/api/mode/invalid/start" });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("POST /api/mode/:mode/stop", () => {
    it("returns stopped status for valid mode", async () => {
      const res = await app.inject({ method: "POST", url: "/api/mode/volume-max/stop" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: "stopped", mode: "volumeMax" });
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
        payload: { allocation: 1000, pairs: ["SOL/USDC"], slippage: 0.3 },
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
