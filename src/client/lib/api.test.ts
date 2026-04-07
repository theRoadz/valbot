// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { startMode, stopMode, updateModeConfig, fetchStatus, ApiError } from "./api";

describe("API client", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("startMode", () => {
    it("sends POST to correct URL for volumeMax", async () => {
      mockFetch.mockResolvedValue({ ok: true });
      await startMode("volumeMax");
      expect(mockFetch).toHaveBeenCalledWith("/api/mode/volumeMax/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
    });

    it("sends POST to correct URL for profitHunter", async () => {
      mockFetch.mockResolvedValue({ ok: true });
      await startMode("profitHunter", { pairs: ["SOL/USDC"], slippage: 0.5 });
      expect(mockFetch).toHaveBeenCalledWith("/api/mode/profitHunter/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pairs: ["SOL/USDC"], slippage: 0.5 }),
      });
    });

    it("sends POST to correct URL for arbitrage", async () => {
      mockFetch.mockResolvedValue({ ok: true });
      await startMode("arbitrage");
      expect(mockFetch).toHaveBeenCalledWith("/api/mode/arbitrage/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
    });
  });

  describe("stopMode", () => {
    it("sends POST to correct URL", async () => {
      mockFetch.mockResolvedValue({ ok: true });
      await stopMode("volumeMax");
      expect(mockFetch).toHaveBeenCalledWith("/api/mode/volumeMax/stop", { method: "POST" });
    });
  });

  describe("updateModeConfig", () => {
    it("sends PUT with body", async () => {
      mockFetch.mockResolvedValue({ ok: true });
      await updateModeConfig("volumeMax", { allocation: 100, pairs: ["SOL/USDC"], slippage: 0.5 });
      expect(mockFetch).toHaveBeenCalledWith("/api/mode/volumeMax/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allocation: 100, pairs: ["SOL/USDC"], slippage: 0.5 }),
      });
    });
  });

  describe("fetchStatus", () => {
    it("returns parsed response", async () => {
      const mockData = { modes: {}, positions: [], trades: [], strategies: [], connection: { status: "connected", equity: 0, available: 0 } };
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(mockData) });
      const result = await fetchStatus();
      expect(result).toEqual(mockData);
    });

    it("throws ApiError on malformed response shape", async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ bad: "data" }) });
      try {
        await fetchStatus();
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError);
        const err = e as ApiError;
        expect(err.code).toBe("INVALID_RESPONSE");
      }
    });

    it("throws ApiError when connection lacks equity", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ modes: {}, positions: [], trades: [], connection: { status: "connected" } }),
      });
      try {
        await fetchStatus();
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError);
        expect((e as ApiError).code).toBe("INVALID_RESPONSE");
      }
    });
  });

  describe("error handling", () => {
    it("parses JSON error response into ApiError", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({
          error: { severity: "warning", code: "MODE_ALREADY_RUNNING", message: "Mode is already running", details: null, resolution: "Stop the mode first" },
        }),
      });

      try {
        await startMode("volumeMax");
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError);
        const err = e as ApiError;
        expect(err.severity).toBe("warning");
        expect(err.code).toBe("MODE_ALREADY_RUNNING");
        expect(err.message).toBe("Mode is already running");
        expect(err.details).toBeNull();
        expect(err.resolution).toBe("Stop the mode first");
      }
    });

    it("throws generic error on network failure", async () => {
      mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));

      try {
        await startMode("volumeMax");
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError);
        const err = e as ApiError;
        expect(err.code).toBe("NETWORK_ERROR");
        expect(err.resolution).toBe("Check your network connection");
      }
    });

    it("throws generic error when JSON parse fails on error response", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error("invalid json")),
      });

      try {
        await startMode("volumeMax");
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError);
        const err = e as ApiError;
        expect(err.code).toBe("NETWORK_ERROR");
      }
    });
  });
});
