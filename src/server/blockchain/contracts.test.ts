import { describe, it, expect } from "vitest";
import { openPosition, closePosition, setStopLoss } from "./contracts.js";

// Stubs don't use connection/keypair, so we pass null-casted values
const mockConnection = null as never;
const mockKeypair = null as never;

describe("blockchain contract stubs", () => {
  describe("openPosition", () => {
    it("returns expected result shape with mock data", async () => {
      const result = await openPosition({
        connection: mockConnection,
        keypair: mockKeypair,
        pair: "SOL/USDC",
        side: "Long",
        size: 10_000_000,
        slippage: 0.5,
      });

      expect(result).toHaveProperty("txHash");
      expect(result).toHaveProperty("positionId");
      expect(result).toHaveProperty("entryPrice");
      expect(result.txHash).toMatch(/^mock-tx-/);
      expect(result.entryPrice).toBe(100_000_000);
      expect(typeof result.positionId).toBe("string");
    });

    it("generates unique txHashes across calls", async () => {
      const r1 = await openPosition({
        connection: mockConnection,
        keypair: mockKeypair,
        pair: "SOL/USDC",
        side: "Long",
        size: 10_000_000,
        slippage: 0.5,
      });
      const r2 = await openPosition({
        connection: mockConnection,
        keypair: mockKeypair,
        pair: "SOL/USDC",
        side: "Long",
        size: 10_000_000,
        slippage: 0.5,
      });
      expect(r1.txHash).not.toBe(r2.txHash);
    });
  });

  describe("closePosition", () => {
    it("returns expected result shape with break-even pnl", async () => {
      const size = 10_000_000;
      const result = await closePosition({
        connection: mockConnection,
        keypair: mockKeypair,
        positionId: "pos-123",
        pair: "SOL/USDC",
        side: "Long",
        size,
      });

      expect(result).toHaveProperty("txHash");
      expect(result).toHaveProperty("exitPrice");
      expect(result).toHaveProperty("pnl");
      expect(result).toHaveProperty("fees");
      expect(result.txHash).toMatch(/^mock-tx-/);
      expect(result.pnl).toBe(0);
      expect(result.fees).toBe(Math.round(size * 0.001));
    });

    it("calculates fees as 0.1% of size", async () => {
      const result = await closePosition({
        connection: mockConnection,
        keypair: mockKeypair,
        positionId: "pos-456",
        pair: "ETH/USDC",
        side: "Short",
        size: 50_000_000,
      });
      expect(result.fees).toBe(50_000); // 0.1% of 50M
    });
  });

  describe("setStopLoss", () => {
    it("returns expected result shape", async () => {
      const result = await setStopLoss({
        connection: mockConnection,
        keypair: mockKeypair,
        positionId: "pos-789",
        stopLossPrice: 95_000_000,
      });

      expect(result).toHaveProperty("txHash");
      expect(result.txHash).toMatch(/^mock-tx-/);
    });
  });
});
