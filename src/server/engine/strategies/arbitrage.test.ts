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
    getPositionSize: vi.fn(),
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

  // getPredictedFundings returns Map<string, { rate, nextFundingTime }>
  const getPredictedFundings = vi.fn().mockResolvedValue(new Map());

  // getMidPrice returns float USD (e.g., 100.0)
  const getMidPrice = vi.fn().mockResolvedValue(100.0);

  const broadcast = vi.fn() as unknown as BroadcastFn;

  return { fundAllocator, positionManager, getPredictedFundings, getMidPrice, broadcast };
}

describe("ArbitrageStrategy (Funding Rate)", () => {
  let mocks: ReturnType<typeof createMocks>;

  beforeEach(() => {
    mocks = createMocks();
  });

  // --- Constructor tests (Task 4.9) ---

  describe("constructor validation", () => {
    it("rejects empty pairs array", () => {
      expect(
        () =>
          new ArbitrageStrategy(
            mocks.fundAllocator as any,
            mocks.positionManager as any,
            mocks.broadcast,
            mocks.getPredictedFundings,
            { pairs: [] },
            mocks.getMidPrice,
          ),
      ).toThrow("Invalid strategy configuration");
    });

    it("rejects invalid rateThreshold (negative)", () => {
      expect(
        () =>
          new ArbitrageStrategy(
            mocks.fundAllocator as any,
            mocks.positionManager as any,
            mocks.broadcast,
            mocks.getPredictedFundings,
            { pairs: ["SOL/USDC"], rateThreshold: -0.01 },
            mocks.getMidPrice,
          ),
      ).toThrow("Invalid strategy configuration");
    });

    it("rejects zero rateThreshold", () => {
      expect(
        () =>
          new ArbitrageStrategy(
            mocks.fundAllocator as any,
            mocks.positionManager as any,
            mocks.broadcast,
            mocks.getPredictedFundings,
            { pairs: ["SOL/USDC"], rateThreshold: 0 },
            mocks.getMidPrice,
          ),
      ).toThrow("Invalid strategy configuration");
    });

    it("rejects NaN rateThreshold", () => {
      expect(
        () =>
          new ArbitrageStrategy(
            mocks.fundAllocator as any,
            mocks.positionManager as any,
            mocks.broadcast,
            mocks.getPredictedFundings,
            { pairs: ["SOL/USDC"], rateThreshold: NaN },
            mocks.getMidPrice,
          ),
      ).toThrow("Invalid strategy configuration");
    });

    it("rejects invalid closeRateThreshold", () => {
      expect(
        () =>
          new ArbitrageStrategy(
            mocks.fundAllocator as any,
            mocks.positionManager as any,
            mocks.broadcast,
            mocks.getPredictedFundings,
            { pairs: ["SOL/USDC"], closeRateThreshold: 0 },
            mocks.getMidPrice,
          ),
      ).toThrow("Invalid strategy configuration");
    });

    it("rejects NaN closeRateThreshold", () => {
      expect(
        () =>
          new ArbitrageStrategy(
            mocks.fundAllocator as any,
            mocks.positionManager as any,
            mocks.broadcast,
            mocks.getPredictedFundings,
            { pairs: ["SOL/USDC"], closeRateThreshold: NaN },
            mocks.getMidPrice,
          ),
      ).toThrow("Invalid strategy configuration");
    });

    it("rejects closeRateThreshold >= rateThreshold", () => {
      expect(
        () =>
          new ArbitrageStrategy(
            mocks.fundAllocator as any,
            mocks.positionManager as any,
            mocks.broadcast,
            mocks.getPredictedFundings,
            { pairs: ["SOL/USDC"], rateThreshold: 0.0001, closeRateThreshold: 0.0001 },
            mocks.getMidPrice,
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
            mocks.getPredictedFundings,
            { pairs: ["SOL/USDC"], slippage: -1 },
            mocks.getMidPrice,
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
            mocks.getPredictedFundings,
            { pairs: ["SOL/USDC"], positionSize: 5_000_000 },
            mocks.getMidPrice,
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
            smallMocks.getPredictedFundings,
            { pairs: ["SOL/USDC"] },
            smallMocks.getMidPrice,
          ),
      ).toThrow("Invalid strategy configuration");
    });

    it("creates strategy with valid config and defaults", () => {
      const strategy = new ArbitrageStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.getPredictedFundings,
        { pairs: ["SOL/USDC", "ETH/USDC"] },
        mocks.getMidPrice,
      );
      expect(strategy.getIntervalMs()).toBe(30_000);
    });

    it("creates strategy with custom config values", () => {
      const strategy = new ArbitrageStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.getPredictedFundings,
        {
          pairs: ["SOL/USDC"],
          rateThreshold: 0.001,
          closeRateThreshold: 0.0003,
          iterationIntervalMs: 60_000,
          slippage: 1.0,
          positionSize: 500_000_000,
        },
        mocks.getMidPrice,
      );
      expect(strategy.getIntervalMs()).toBe(60_000);
    });
  });

  // --- Task 4.2: Opens Short on positive rate above threshold ---

  describe("opens Short on positive funding rate (AC 1)", () => {
    it("opens Short position when positive rate exceeds threshold", async () => {
      // Positive rate: longs pay shorts → go Short to collect
      mocks.getPredictedFundings.mockResolvedValue(new Map([
        ["SOL", { rate: 0.0005, nextFundingTime: Date.now() + 3600000 }],
      ]));

      const strategy = new ArbitrageStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.getPredictedFundings,
        { pairs: ["SOL/USDC"] },
        mocks.getMidPrice,
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

  // --- Task 4.3: Opens Long on negative rate above threshold ---

  describe("opens Long on negative funding rate (AC 2)", () => {
    it("opens Long position when negative rate exceeds threshold", async () => {
      // Negative rate: shorts pay longs → go Long to collect
      mocks.getPredictedFundings.mockResolvedValue(new Map([
        ["ETH", { rate: -0.0005, nextFundingTime: Date.now() + 3600000 }],
      ]));

      const strategy = new ArbitrageStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.getPredictedFundings,
        { pairs: ["ETH/USDC"] },
        mocks.getMidPrice,
      );

      await strategy.executeIteration();

      expect(mocks.positionManager.openPosition).toHaveBeenCalledTimes(1);
      expect(mocks.positionManager.openPosition).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "arbitrage",
          pair: "ETH/USDC",
          side: "Long",
        }),
      );
    });
  });

  // --- Task 4.4: Closes when rate flips sign ---

  describe("closes position when rate flips sign (AC 3)", () => {
    it("closes Short when rate turns negative", async () => {
      const openTime = Date.now() - 7_200_000; // 2 hours ago (past minHoldTime)
      mocks.positionManager.getPositions.mockReturnValue([
        { id: 42, mode: "arbitrage", pair: "SOL/USDC", side: "Short", size: 50, entryPrice: 100, stopLoss: 102, timestamp: openTime },
      ]);

      // Rate flipped to negative — Short should close
      mocks.getPredictedFundings.mockResolvedValue(new Map([
        ["SOL", { rate: -0.0002, nextFundingTime: Date.now() + 3600000 }],
      ]));

      const strategy = new ArbitrageStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.getPredictedFundings,
        { pairs: ["SOL/USDC"] },
        mocks.getMidPrice,
      );

      await strategy.executeIteration();

      expect(mocks.positionManager.closePosition).toHaveBeenCalledWith(42);
    });

    it("closes Long when rate turns positive", async () => {
      const openTime = Date.now() - 7_200_000;
      mocks.positionManager.getPositions.mockReturnValue([
        { id: 99, mode: "arbitrage", pair: "ETH/USDC", side: "Long", size: 50, entryPrice: 100, stopLoss: 98, timestamp: openTime },
      ]);

      // Rate flipped to positive — Long should close
      mocks.getPredictedFundings.mockResolvedValue(new Map([
        ["ETH", { rate: 0.0002, nextFundingTime: Date.now() + 3600000 }],
      ]));

      const strategy = new ArbitrageStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.getPredictedFundings,
        { pairs: ["ETH/USDC"] },
        mocks.getMidPrice,
      );

      await strategy.executeIteration();

      expect(mocks.positionManager.closePosition).toHaveBeenCalledWith(99);
    });
  });

  // --- Task 4.5: Closes when rate drops below closeRateThreshold ---

  describe("closes position when rate drops below closeRateThreshold (AC 4)", () => {
    it("closes when absolute rate is below close threshold", async () => {
      const openTime = Date.now() - 7_200_000;
      mocks.positionManager.getPositions.mockReturnValue([
        { id: 55, mode: "arbitrage", pair: "SOL/USDC", side: "Short", size: 50, entryPrice: 100, stopLoss: 102, timestamp: openTime },
      ]);

      // Rate positive but below default closeRateThreshold (0.00005)
      mocks.getPredictedFundings.mockResolvedValue(new Map([
        ["SOL", { rate: 0.00003, nextFundingTime: Date.now() + 3600000 }],
      ]));

      const strategy = new ArbitrageStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.getPredictedFundings,
        { pairs: ["SOL/USDC"] },
        mocks.getMidPrice,
      );

      await strategy.executeIteration();

      expect(mocks.positionManager.closePosition).toHaveBeenCalledWith(55);
    });
  });

  // --- Task 4.6: Does NOT close before minHoldTimeMs ---

  describe("does NOT close before minHoldTimeMs (AC 5)", () => {
    it("keeps position open when held less than minHoldTime even if rate drops", async () => {
      const openTime = Date.now() - 1_800_000; // Only 30 min ago (< 1h default)
      mocks.positionManager.getPositions.mockReturnValue([
        { id: 77, mode: "arbitrage", pair: "SOL/USDC", side: "Short", size: 50, entryPrice: 100, stopLoss: 102, timestamp: openTime },
      ]);

      // Rate dropped below threshold — but should NOT close due to minHoldTime
      mocks.getPredictedFundings.mockResolvedValue(new Map([
        ["SOL", { rate: 0.00002, nextFundingTime: Date.now() + 3600000 }],
      ]));

      const strategy = new ArbitrageStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.getPredictedFundings,
        { pairs: ["SOL/USDC"] },
        mocks.getMidPrice,
      );

      await strategy.executeIteration();

      expect(mocks.positionManager.closePosition).not.toHaveBeenCalled();
    });

    it("keeps position open when held less than custom minHoldTime", async () => {
      const openTime = Date.now() - 600_000; // 10 min ago
      mocks.positionManager.getPositions.mockReturnValue([
        { id: 88, mode: "arbitrage", pair: "SOL/USDC", side: "Short", size: 50, entryPrice: 100, stopLoss: 102, timestamp: openTime },
      ]);

      mocks.getPredictedFundings.mockResolvedValue(new Map([
        ["SOL", { rate: -0.001, nextFundingTime: Date.now() + 3600000 }], // flipped sign
      ]));

      const strategy = new ArbitrageStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.getPredictedFundings,
        { pairs: ["SOL/USDC"], minHoldTimeMs: 1_800_000 }, // 30 min
        mocks.getMidPrice,
      );

      await strategy.executeIteration();

      expect(mocks.positionManager.closePosition).not.toHaveBeenCalled();
    });
  });

  // --- Task 4.7: Skips when rate below threshold ---

  describe("skips when rate is below threshold", () => {
    it("does not open position when rate below default threshold", async () => {
      mocks.getPredictedFundings.mockResolvedValue(new Map([
        ["SOL", { rate: 0.00005, nextFundingTime: Date.now() + 3600000 }], // below 0.01% threshold
      ]));

      const strategy = new ArbitrageStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.getPredictedFundings,
        { pairs: ["SOL/USDC"] },
        mocks.getMidPrice,
      );

      await strategy.executeIteration();

      expect(mocks.positionManager.openPosition).not.toHaveBeenCalled();
    });

    it("does not open position when no funding data for pair", async () => {
      mocks.getPredictedFundings.mockResolvedValue(new Map()); // empty

      const strategy = new ArbitrageStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.getPredictedFundings,
        { pairs: ["SOL/USDC"] },
        mocks.getMidPrice,
      );

      await strategy.executeIteration();

      expect(mocks.positionManager.openPosition).not.toHaveBeenCalled();
    });
  });

  // --- Task 4.8: Stop-loss at 2% ---

  describe("stop-loss at 2% (AC 7)", () => {
    it("sets stop-loss 2% above mid-price for Short", async () => {
      const midFloat = 100.0;
      const midSmallest = 100_000_000;
      mocks.getMidPrice.mockResolvedValue(midFloat);
      mocks.getPredictedFundings.mockResolvedValue(new Map([
        ["SOL", { rate: 0.0005, nextFundingTime: Date.now() + 3600000 }],
      ]));

      const strategy = new ArbitrageStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.getPredictedFundings,
        { pairs: ["SOL/USDC"] },
        mocks.getMidPrice,
      );

      await strategy.executeIteration();

      expect(mocks.positionManager.openPosition).toHaveBeenCalledWith(
        expect.objectContaining({
          side: "Short",
          stopLossPrice: Math.floor(midSmallest * 1.02), // 102_000_000
        }),
      );
    });

    it("sets stop-loss 2% below mid-price for Long", async () => {
      const midFloat = 100.0;
      const midSmallest = 100_000_000;
      mocks.getMidPrice.mockResolvedValue(midFloat);
      mocks.getPredictedFundings.mockResolvedValue(new Map([
        ["ETH", { rate: -0.0005, nextFundingTime: Date.now() + 3600000 }],
      ]));

      const strategy = new ArbitrageStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.getPredictedFundings,
        { pairs: ["ETH/USDC"] },
        mocks.getMidPrice,
      );

      await strategy.executeIteration();

      expect(mocks.positionManager.openPosition).toHaveBeenCalledWith(
        expect.objectContaining({
          side: "Long",
          stopLossPrice: Math.floor(midSmallest * 0.98), // 98_000_000
        }),
      );
    });
  });

  // --- getIntervalMs ---

  describe("getIntervalMs", () => {
    it("returns configured iteration interval", () => {
      const strategy = new ArbitrageStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.getPredictedFundings,
        { pairs: ["SOL/USDC"], iterationIntervalMs: 60_000 },
        mocks.getMidPrice,
      );
      expect(strategy.getIntervalMs()).toBe(60_000);
    });

    it("returns default 30s interval when not configured", () => {
      const strategy = new ArbitrageStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.getPredictedFundings,
        { pairs: ["SOL/USDC"] },
        mocks.getMidPrice,
      );
      expect(strategy.getIntervalMs()).toBe(30_000);
    });
  });

  // --- stop() closes all positions ---

  describe("stop() closes all positions", () => {
    it("calls closeAllForMode via super.stop()", async () => {
      const strategy = new ArbitrageStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.getPredictedFundings,
        { pairs: ["SOL/USDC"] },
        mocks.getMidPrice,
      );

      await strategy.start();
      await strategy.stop();

      expect(mocks.positionManager.closeAllForMode).toHaveBeenCalledWith("arbitrage");
    });
  });

  // --- No duplicate positions on same pair ---

  describe("no duplicate positions on same pair", () => {
    it("does not open position on pair that already has an open position", async () => {
      mocks.positionManager.getPositions.mockReturnValue([
        { id: 42, mode: "arbitrage", pair: "SOL/USDC", side: "Short", size: 50, entryPrice: 100, stopLoss: 102, timestamp: Date.now() },
      ]);

      mocks.getPredictedFundings.mockResolvedValue(new Map([
        ["SOL", { rate: 0.001, nextFundingTime: Date.now() + 3600000 }],
      ]));

      const strategy = new ArbitrageStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.getPredictedFundings,
        { pairs: ["SOL/USDC"] },
        mocks.getMidPrice,
      );

      await strategy.executeIteration();

      expect(mocks.positionManager.openPosition).not.toHaveBeenCalled();
    });
  });

  // --- Opens positions on different pairs simultaneously ---

  describe("opens positions on different pairs simultaneously", () => {
    it("opens positions on multiple pairs in same iteration", async () => {
      mocks.getPredictedFundings.mockResolvedValue(new Map([
        ["SOL", { rate: 0.0005, nextFundingTime: Date.now() + 3600000 }],
        ["ETH", { rate: 0.0005, nextFundingTime: Date.now() + 3600000 }],
      ]));

      const strategy = new ArbitrageStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.getPredictedFundings,
        { pairs: ["SOL/USDC", "ETH/USDC"] },
        mocks.getMidPrice,
      );

      await strategy.executeIteration();

      expect(mocks.positionManager.openPosition).toHaveBeenCalledTimes(2);
      expect(mocks.positionManager.openPosition).toHaveBeenCalledWith(
        expect.objectContaining({ pair: "SOL/USDC", side: "Short" }),
      );
      expect(mocks.positionManager.openPosition).toHaveBeenCalledWith(
        expect.objectContaining({ pair: "ETH/USDC", side: "Short" }),
      );
    });
  });

  // --- Skips trade when canAllocate returns false ---

  describe("skips trade when canAllocate returns false", () => {
    it("does not open position when funds insufficient", async () => {
      mocks.fundAllocator.canAllocate.mockReturnValue(false);
      mocks.getPredictedFundings.mockResolvedValue(new Map([
        ["SOL", { rate: 0.001, nextFundingTime: Date.now() + 3600000 }],
      ]));

      const strategy = new ArbitrageStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.getPredictedFundings,
        { pairs: ["SOL/USDC"] },
        mocks.getMidPrice,
      );

      await strategy.executeIteration();

      expect(mocks.positionManager.openPosition).not.toHaveBeenCalled();
    });
  });

  // --- Dynamic position sizing ---

  describe("dynamic position sizing", () => {
    it("recalculates position size from current allocation when not explicitly configured", async () => {
      mocks.getPredictedFundings.mockResolvedValue(new Map([
        ["SOL", { rate: 0.001, nextFundingTime: Date.now() + 3600000 }],
      ]));

      const strategy = new ArbitrageStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.getPredictedFundings,
        { pairs: ["SOL/USDC"] },
        mocks.getMidPrice,
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
  });

  // --- Graceful handling of getPredictedFundings failure ---

  describe("handles getPredictedFundings failure", () => {
    it("skips iteration when funding rate fetch fails", async () => {
      mocks.getPredictedFundings.mockRejectedValue(new Error("API timeout"));

      const strategy = new ArbitrageStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.getPredictedFundings,
        { pairs: ["SOL/USDC"] },
        mocks.getMidPrice,
      );

      // Should not throw
      await strategy.executeIteration();

      expect(mocks.positionManager.openPosition).not.toHaveBeenCalled();
    });
  });
});
