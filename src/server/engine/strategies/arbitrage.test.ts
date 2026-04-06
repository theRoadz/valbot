import { describe, it, expect, beforeEach, vi } from "vitest";
import { ArbitrageStrategy } from "./arbitrage.js";
import type { BroadcastFn } from "../mode-runner.js";

vi.mock("../../blockchain/client.js", () => ({
  isApiHealthy: vi.fn(() => true),
}));

function createMocks(allocationAmount = 1_000_000_000) {
  const fundAllocator = {
    getAllocation: vi.fn().mockReturnValue({ allocation: allocationAmount, remaining: allocationAmount }),
    getStats: vi.fn().mockReturnValue({ pnl: 0, trades: 0, volume: 0, allocated: 1000, remaining: 1000 }),
    canAllocate: vi.fn().mockReturnValue(true),
    reserve: vi.fn(),
    release: vi.fn(),
    setAllocation: vi.fn(),
    reconcilePositions: vi.fn(),
    recordTrade: vi.fn(),
    checkKillSwitch: vi.fn().mockReturnValue(false),
    loadFromDb: vi.fn(),
    resetModeStats: vi.fn(),
  };

  const positionManager = {
    openPosition: vi.fn().mockImplementation(async (params: any) => ({
      id: Math.floor(Math.random() * 10000),
      mode: params.mode,
      pair: params.pair,
      side: params.side,
      size: params.size / 1e6,
      entryPrice: 100,
      stopLoss: params.stopLossPrice / 1e6,
      timestamp: Date.now(),
    })),
    closePosition: vi.fn().mockResolvedValue({
      exitPrice: 100_000_000,
      pnl: 0,
      fees: 100_000,
      txHash: "mock-tx",
      position: { id: 1 },
    }),
    closeAllForMode: vi.fn().mockResolvedValue({ count: 0, totalPnl: 0, positions: [], closedDetails: [] }),
    getModeStatus: vi.fn().mockReturnValue(undefined),
    getPositions: vi.fn().mockReturnValue([]),
    getInternalPositions: vi.fn().mockReturnValue([]),
    loadFromDb: vi.fn(),
    resetModeStatus: vi.fn(),
  };

  const oracleClient = {
    getPrice: vi.fn().mockReturnValue(100_000_000), // 100 USDC in smallest-unit
    getMovingAverage: vi.fn().mockReturnValue(100_000_000),
    isAvailable: vi.fn().mockReturnValue(true),
    connect: vi.fn(),
    disconnect: vi.fn(),
    getFeedEntry: vi.fn(),
    getRawData: vi.fn(),
  };

  // getMidPrice returns float USD (e.g., 100.0)
  const getMidPrice = vi.fn().mockResolvedValue(100.0);

  const broadcast = vi.fn() as unknown as BroadcastFn;

  return { fundAllocator, positionManager, oracleClient, getMidPrice, broadcast };
}

describe("ArbitrageStrategy", () => {
  let mocks: ReturnType<typeof createMocks>;

  beforeEach(() => {
    mocks = createMocks();
  });

  // --- Constructor tests (Task 5.2, 5.3) ---

  describe("constructor validation", () => {
    it("rejects empty pairs array", () => {
      expect(
        () =>
          new ArbitrageStrategy(
            mocks.fundAllocator as any,
            mocks.positionManager as any,
            mocks.broadcast,
            mocks.oracleClient as any,
            mocks.getMidPrice,
            { pairs: [] },
          ),
      ).toThrow("Invalid strategy configuration");
    });

    it("rejects invalid spreadThreshold (negative)", () => {
      expect(
        () =>
          new ArbitrageStrategy(
            mocks.fundAllocator as any,
            mocks.positionManager as any,
            mocks.broadcast,
            mocks.oracleClient as any,
            mocks.getMidPrice,
            { pairs: ["SOL/USDC"], spreadThreshold: -0.01 },
          ),
      ).toThrow("Invalid strategy configuration");
    });

    it("rejects zero spreadThreshold", () => {
      expect(
        () =>
          new ArbitrageStrategy(
            mocks.fundAllocator as any,
            mocks.positionManager as any,
            mocks.broadcast,
            mocks.oracleClient as any,
            mocks.getMidPrice,
            { pairs: ["SOL/USDC"], spreadThreshold: 0 },
          ),
      ).toThrow("Invalid strategy configuration");
    });

    it("rejects invalid closeSpreadThreshold", () => {
      expect(
        () =>
          new ArbitrageStrategy(
            mocks.fundAllocator as any,
            mocks.positionManager as any,
            mocks.broadcast,
            mocks.oracleClient as any,
            mocks.getMidPrice,
            { pairs: ["SOL/USDC"], closeSpreadThreshold: 0 },
          ),
      ).toThrow("Invalid strategy configuration");
    });

    it("rejects closeSpreadThreshold >= spreadThreshold", () => {
      expect(
        () =>
          new ArbitrageStrategy(
            mocks.fundAllocator as any,
            mocks.positionManager as any,
            mocks.broadcast,
            mocks.oracleClient as any,
            mocks.getMidPrice,
            { pairs: ["SOL/USDC"], spreadThreshold: 0.005, closeSpreadThreshold: 0.005 },
          ),
      ).toThrow("Invalid strategy configuration");
    });

    it("rejects NaN spreadThreshold", () => {
      expect(
        () =>
          new ArbitrageStrategy(
            mocks.fundAllocator as any,
            mocks.positionManager as any,
            mocks.broadcast,
            mocks.oracleClient as any,
            mocks.getMidPrice,
            { pairs: ["SOL/USDC"], spreadThreshold: NaN },
          ),
      ).toThrow("Invalid strategy configuration");
    });

    it("rejects NaN closeSpreadThreshold", () => {
      expect(
        () =>
          new ArbitrageStrategy(
            mocks.fundAllocator as any,
            mocks.positionManager as any,
            mocks.broadcast,
            mocks.oracleClient as any,
            mocks.getMidPrice,
            { pairs: ["SOL/USDC"], closeSpreadThreshold: NaN },
          ),
      ).toThrow("Invalid strategy configuration");
    });

    it("rejects negative slippage", () => {
      expect(
        () =>
          new ArbitrageStrategy(
            mocks.fundAllocator as any,
            mocks.positionManager as any,
            mocks.broadcast,
            mocks.oracleClient as any,
            mocks.getMidPrice,
            { pairs: ["SOL/USDC"], slippage: -1 },
          ),
      ).toThrow("Invalid strategy configuration");
    });

    it("rejects positionSize of 0", () => {
      expect(
        () =>
          new ArbitrageStrategy(
            mocks.fundAllocator as any,
            mocks.positionManager as any,
            mocks.broadcast,
            mocks.oracleClient as any,
            mocks.getMidPrice,
            { pairs: ["SOL/USDC"], positionSize: 0 },
          ),
      ).toThrow("Invalid strategy configuration");
    });

    it("rejects positionSize below minimum", () => {
      expect(
        () =>
          new ArbitrageStrategy(
            mocks.fundAllocator as any,
            mocks.positionManager as any,
            mocks.broadcast,
            mocks.oracleClient as any,
            mocks.getMidPrice,
            { pairs: ["SOL/USDC"], positionSize: 5_000_000 },
          ),
      ).toThrow("Invalid strategy configuration");
    });

    it("rejects spreadThreshold below 2x taker fee", () => {
      expect(
        () =>
          new ArbitrageStrategy(
            mocks.fundAllocator as any,
            mocks.positionManager as any,
            mocks.broadcast,
            mocks.oracleClient as any,
            mocks.getMidPrice,
            { pairs: ["SOL/USDC"], spreadThreshold: 0.0003, closeSpreadThreshold: 0.0001 },
          ),
      ).toThrow("Invalid strategy configuration");
    });

    it("rejects allocation below $10 minimum", () => {
      const smallMocks = createMocks(5_000_000); // $5
      expect(
        () =>
          new ArbitrageStrategy(
            smallMocks.fundAllocator as any,
            smallMocks.positionManager as any,
            smallMocks.broadcast,
            smallMocks.oracleClient as any,
            smallMocks.getMidPrice,
            { pairs: ["SOL/USDC"] },
          ),
      ).toThrow("Invalid strategy configuration");
    });

    it("creates strategy with valid config and defaults", () => {
      const strategy = new ArbitrageStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        mocks.getMidPrice,
        { pairs: ["SOL/USDC", "ETH/USDC"] },
      );
      expect(strategy.getIntervalMs()).toBe(3_000);
    });

    it("creates strategy with custom config values", () => {
      const strategy = new ArbitrageStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        mocks.getMidPrice,
        {
          pairs: ["SOL/USDC"],
          spreadThreshold: 0.01,
          closeSpreadThreshold: 0.003,
          iterationIntervalMs: 5_000,
          slippage: 1.0,
          positionSize: 500_000_000,
        },
      );
      expect(strategy.getIntervalMs()).toBe(5_000);
    });
  });

  // --- executeIteration: open Long when oracle > mid (Task 5.4) ---

  describe("opens Long when oracle price > mid price beyond threshold", () => {
    it("opens Long position (perp underpriced vs spot)", async () => {
      // Oracle 1% above mid → spread = 0.01, exceeds default 0.5% threshold
      mocks.oracleClient.getPrice.mockReturnValue(101_000_000); // 101 USDC smallest-unit
      mocks.getMidPrice.mockResolvedValue(100.0); // 100 USDC float → 100_000_000 smallest-unit

      const strategy = new ArbitrageStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        mocks.getMidPrice,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.executeIteration();

      expect(mocks.positionManager.openPosition).toHaveBeenCalledTimes(1);
      expect(mocks.positionManager.openPosition).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "arbitrage",
          pair: "SOL/USDC",
          side: "Long",
        }),
      );
    });
  });

  // --- executeIteration: open Short when oracle < mid (Task 5.5) ---

  describe("opens Short when oracle price < mid price beyond threshold", () => {
    it("opens Short position (perp overpriced vs spot)", async () => {
      // Oracle 1% below mid → spread = -0.01
      mocks.oracleClient.getPrice.mockReturnValue(99_000_000); // 99 USDC
      mocks.getMidPrice.mockResolvedValue(100.0); // 100 USDC

      const strategy = new ArbitrageStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        mocks.getMidPrice,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.executeIteration();

      expect(mocks.positionManager.openPosition).toHaveBeenCalledTimes(1);
      expect(mocks.positionManager.openPosition).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "arbitrage",
          pair: "SOL/USDC",
          side: "Short",
        }),
      );
    });
  });

  // --- No trade when spread within threshold (Task 5.6) ---

  describe("no trade when spread is within threshold", () => {
    it("does not open position when spread within default 0.5% threshold", async () => {
      // Oracle 0.2% above mid → within threshold
      mocks.oracleClient.getPrice.mockReturnValue(100_200_000); // 100.2
      mocks.getMidPrice.mockResolvedValue(100.0);

      const strategy = new ArbitrageStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        mocks.getMidPrice,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.executeIteration();

      expect(mocks.positionManager.openPosition).not.toHaveBeenCalled();
    });
  });

  // --- Close position when spread converges (Task 5.7) ---

  describe("closes position when spread converges within closeSpreadThreshold", () => {
    it("closes position when spread returns within close threshold", async () => {
      mocks.positionManager.getPositions.mockReturnValue([
        { id: 42, mode: "arbitrage", pair: "SOL/USDC", side: "Long", size: 50, entryPrice: 100, stopLoss: 97, timestamp: Date.now() },
      ]);

      // Spread converged: 0.05% difference (within default 0.1% close threshold)
      mocks.oracleClient.getPrice.mockReturnValue(100_050_000); // 100.05
      mocks.getMidPrice.mockResolvedValue(100.0); // 100.0

      const strategy = new ArbitrageStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        mocks.getMidPrice,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.executeIteration();

      expect(mocks.positionManager.closePosition).toHaveBeenCalledWith(42);
    });
  });

  // --- Skip pair when oracle unavailable (Task 5.8) ---

  describe("skips pair when oracle unavailable", () => {
    it("skips pair when oracle isAvailable returns false", async () => {
      mocks.oracleClient.isAvailable.mockReturnValue(false);

      const strategy = new ArbitrageStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        mocks.getMidPrice,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.executeIteration();

      expect(mocks.positionManager.openPosition).not.toHaveBeenCalled();
    });
  });

  // --- Skip pair when mid-price fetch fails (Task 5.9) ---

  describe("skips pair when mid-price fetch fails", () => {
    it("logs warning and continues when getMidPrice throws", async () => {
      mocks.oracleClient.getPrice.mockReturnValue(101_000_000);
      mocks.getMidPrice.mockRejectedValue(new Error("API timeout"));

      const strategy = new ArbitrageStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        mocks.getMidPrice,
        { pairs: ["SOL/USDC"] },
      );

      // Should not throw
      await strategy.executeIteration();

      expect(mocks.positionManager.openPosition).not.toHaveBeenCalled();
    });

    it("processes other pairs when one mid-price fetch fails", async () => {
      // SOL fails, ETH succeeds
      mocks.getMidPrice
        .mockRejectedValueOnce(new Error("API timeout")) // SOL
        .mockResolvedValueOnce(100.0); // ETH
      mocks.oracleClient.getPrice.mockReturnValue(101_000_000); // 1% above mid for both

      const strategy = new ArbitrageStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        mocks.getMidPrice,
        { pairs: ["SOL/USDC", "ETH/USDC"] },
      );

      await strategy.executeIteration();

      // Only ETH should open
      expect(mocks.positionManager.openPosition).toHaveBeenCalledTimes(1);
      expect(mocks.positionManager.openPosition).toHaveBeenCalledWith(
        expect.objectContaining({ pair: "ETH/USDC" }),
      );
    });
  });

  // --- Skip trade when canAllocate returns false (Task 5.10) ---

  describe("skips trade when canAllocate returns false", () => {
    it("does not open position when funds insufficient", async () => {
      mocks.fundAllocator.canAllocate.mockReturnValue(false);
      mocks.oracleClient.getPrice.mockReturnValue(101_000_000);
      mocks.getMidPrice.mockResolvedValue(100.0);

      const strategy = new ArbitrageStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        mocks.getMidPrice,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.executeIteration();

      expect(mocks.positionManager.openPosition).not.toHaveBeenCalled();
    });
  });

  // --- Stop-loss calculated correctly (Task 5.11) ---

  describe("stop-loss calculation", () => {
    it("sets stop-loss below mid-price for Long (3% below)", async () => {
      const midFloat = 100.0;
      const midSmallest = 100_000_000;
      mocks.oracleClient.getPrice.mockReturnValue(101_000_000); // oracle > mid → Long
      mocks.getMidPrice.mockResolvedValue(midFloat);

      const strategy = new ArbitrageStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        mocks.getMidPrice,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.executeIteration();

      expect(mocks.positionManager.openPosition).toHaveBeenCalledWith(
        expect.objectContaining({
          side: "Long",
          stopLossPrice: Math.floor(midSmallest * 0.97), // 97_000_000
        }),
      );
    });

    it("sets stop-loss above mid-price for Short (3% above)", async () => {
      const midFloat = 100.0;
      const midSmallest = 100_000_000;
      mocks.oracleClient.getPrice.mockReturnValue(99_000_000); // oracle < mid → Short
      mocks.getMidPrice.mockResolvedValue(midFloat);

      const strategy = new ArbitrageStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        mocks.getMidPrice,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.executeIteration();

      expect(mocks.positionManager.openPosition).toHaveBeenCalledWith(
        expect.objectContaining({
          side: "Short",
          stopLossPrice: Math.floor(midSmallest * 1.03), // 103_000_000
        }),
      );
    });
  });

  // --- stop() calls closeAllForMode (Task 5.12) ---

  describe("stop() closes all positions", () => {
    it("calls closeAllForMode via super.stop()", async () => {
      const strategy = new ArbitrageStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        mocks.getMidPrice,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.start();
      await strategy.stop();

      expect(mocks.positionManager.closeAllForMode).toHaveBeenCalledWith("arbitrage");
    });
  });

  // --- Does not open duplicate on same pair (Task 5.13) ---

  describe("no duplicate positions on same pair", () => {
    it("does not open position on pair that already has an open position", async () => {
      mocks.positionManager.getPositions.mockReturnValue([
        { id: 42, mode: "arbitrage", pair: "SOL/USDC", side: "Long", size: 50, entryPrice: 100, stopLoss: 97, timestamp: Date.now() },
      ]);

      // Strong spread signal
      mocks.oracleClient.getPrice.mockReturnValue(102_000_000);
      mocks.getMidPrice.mockResolvedValue(100.0);

      const strategy = new ArbitrageStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        mocks.getMidPrice,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.executeIteration();

      // closePosition may be called (close check), but openPosition should NOT
      expect(mocks.positionManager.openPosition).not.toHaveBeenCalled();
    });
  });

  // --- CAN open positions on different pairs simultaneously (Task 5.14) ---

  describe("opens positions on different pairs simultaneously", () => {
    it("opens positions on multiple pairs in same iteration", async () => {
      mocks.oracleClient.getPrice.mockReturnValue(101_000_000); // 1% above mid
      mocks.getMidPrice.mockResolvedValue(100.0);

      const strategy = new ArbitrageStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        mocks.getMidPrice,
        { pairs: ["SOL/USDC", "ETH/USDC"] },
      );

      await strategy.executeIteration();

      expect(mocks.positionManager.openPosition).toHaveBeenCalledTimes(2);
      expect(mocks.positionManager.openPosition).toHaveBeenCalledWith(
        expect.objectContaining({ pair: "SOL/USDC", side: "Long" }),
      );
      expect(mocks.positionManager.openPosition).toHaveBeenCalledWith(
        expect.objectContaining({ pair: "ETH/USDC", side: "Long" }),
      );
    });
  });

  // --- Mid-price conversion (Task 5.15) ---

  describe("mid-price conversion from float to smallest-unit", () => {
    it("correctly converts mid-price float to smallest-unit for spread calculation", async () => {
      // Oracle: 145.50 USDC in smallest-unit = 145_500_000
      // Mid-price: 145.00 USDC float → 145_000_000 smallest-unit
      // Spread = (145_500_000 - 145_000_000) / 145_000_000 ≈ 0.00345 → above 0.005? No.
      // Use larger spread: Oracle 146.00 = 146_000_000, Mid 145.00
      // Spread = (146_000_000 - 145_000_000) / 145_000_000 ≈ 0.0069 → above 0.005 threshold
      mocks.oracleClient.getPrice.mockReturnValue(146_000_000);
      mocks.getMidPrice.mockResolvedValue(145.0);

      const strategy = new ArbitrageStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        mocks.getMidPrice,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.executeIteration();

      expect(mocks.positionManager.openPosition).toHaveBeenCalledTimes(1);
      expect(mocks.positionManager.openPosition).toHaveBeenCalledWith(
        expect.objectContaining({
          side: "Long",
          // Stop-loss based on mid-price: floor(145_000_000 * 0.97) = 140_650_000
          stopLossPrice: Math.floor(145_000_000 * 0.97),
        }),
      );
    });

    it("handles mid-price with many decimal places", async () => {
      // Mid = 145.123456 → Math.round(145.123456 * 1_000_000) = 145_123_456
      // Oracle = 146_200_000
      // Spread = (146_200_000 - 145_123_456) / 145_123_456 ≈ 0.00741 → above threshold
      mocks.oracleClient.getPrice.mockReturnValue(146_200_000);
      mocks.getMidPrice.mockResolvedValue(145.123456);

      const strategy = new ArbitrageStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        mocks.getMidPrice,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.executeIteration();

      expect(mocks.positionManager.openPosition).toHaveBeenCalledTimes(1);
    });
  });

  // --- getIntervalMs ---

  describe("getIntervalMs", () => {
    it("returns configured iteration interval", () => {
      const strategy = new ArbitrageStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        mocks.getMidPrice,
        { pairs: ["SOL/USDC"], iterationIntervalMs: 5_000 },
      );
      expect(strategy.getIntervalMs()).toBe(5_000);
    });

    it("returns default interval when not configured", () => {
      const strategy = new ArbitrageStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        mocks.getMidPrice,
        { pairs: ["SOL/USDC"] },
      );
      expect(strategy.getIntervalMs()).toBe(3_000);
    });
  });

  // --- Dynamic position sizing ---

  describe("dynamic position sizing", () => {
    it("recalculates position size from current allocation when not explicitly configured", async () => {
      mocks.oracleClient.getPrice.mockReturnValue(101_000_000);
      mocks.getMidPrice.mockResolvedValue(100.0);

      const strategy = new ArbitrageStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        mocks.getMidPrice,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.executeIteration();
      expect(mocks.positionManager.openPosition).toHaveBeenCalledWith(
        expect.objectContaining({ size: 50_000_000 }), // 1B / 20
      );

      // Simulate allocation change
      mocks.fundAllocator.getAllocation.mockReturnValue({ allocation: 500_000_000, remaining: 500_000_000 });
      mocks.positionManager.getPositions.mockReturnValue([]);
      mocks.positionManager.openPosition.mockClear();

      await strategy.executeIteration();
      expect(mocks.positionManager.openPosition).toHaveBeenCalledWith(
        expect.objectContaining({ size: 25_000_000 }), // 500M / 20
      );
    });

    it("uses static position size when explicitly configured", async () => {
      mocks.oracleClient.getPrice.mockReturnValue(101_000_000);
      mocks.getMidPrice.mockResolvedValue(100.0);

      const strategy = new ArbitrageStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        mocks.getMidPrice,
        { pairs: ["SOL/USDC"], positionSize: 10_000_000 },
      );

      mocks.fundAllocator.getAllocation.mockReturnValue({ allocation: 500_000_000, remaining: 500_000_000 });

      await strategy.executeIteration();
      expect(mocks.positionManager.openPosition).toHaveBeenCalledWith(
        expect.objectContaining({ size: 10_000_000 }),
      );
    });
  });

  // --- Oracle key mapping ---

  describe("oracle key mapping", () => {
    it("calls oracle with SOL-PERP key for SOL/USDC pair", async () => {
      mocks.oracleClient.getPrice.mockReturnValue(101_000_000);
      mocks.getMidPrice.mockResolvedValue(100.0);

      const strategy = new ArbitrageStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        mocks.getMidPrice,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.executeIteration();

      expect(mocks.oracleClient.isAvailable).toHaveBeenCalledWith("SOL-PERP");
      expect(mocks.oracleClient.getPrice).toHaveBeenCalledWith("SOL-PERP");
    });

    it("extracts coin symbol from pair for getMidPrice", async () => {
      mocks.oracleClient.getPrice.mockReturnValue(101_000_000);
      mocks.getMidPrice.mockResolvedValue(100.0);

      const strategy = new ArbitrageStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        mocks.getMidPrice,
        { pairs: ["BTC/USDC"] },
      );

      await strategy.executeIteration();

      expect(mocks.getMidPrice).toHaveBeenCalledWith("BTC");
    });
  });

  // --- Skip when oracle price is null or zero ---

  describe("handles null/zero prices", () => {
    it("skips pair when oracle price is null", async () => {
      mocks.oracleClient.getPrice.mockReturnValue(null);

      const strategy = new ArbitrageStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        mocks.getMidPrice,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.executeIteration();

      expect(mocks.positionManager.openPosition).not.toHaveBeenCalled();
      expect(mocks.getMidPrice).not.toHaveBeenCalled(); // Should not even fetch mid-price
    });

    it("skips pair when oracle price is zero", async () => {
      mocks.oracleClient.getPrice.mockReturnValue(0);

      const strategy = new ArbitrageStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        mocks.getMidPrice,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.executeIteration();

      expect(mocks.positionManager.openPosition).not.toHaveBeenCalled();
    });
  });
});
