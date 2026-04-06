import { describe, it, expect, beforeEach, vi } from "vitest";
import { ProfitHunterStrategy } from "./profit-hunter.js";
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

  const broadcast = vi.fn() as unknown as BroadcastFn;

  return { fundAllocator, positionManager, oracleClient, broadcast };
}

describe("ProfitHunterStrategy", () => {
  let mocks: ReturnType<typeof createMocks>;

  beforeEach(() => {
    mocks = createMocks();
  });

  // --- Constructor tests (Task 4.2) ---

  describe("constructor validation", () => {
    it("rejects empty pairs array", () => {
      expect(
        () =>
          new ProfitHunterStrategy(
            mocks.fundAllocator as any,
            mocks.positionManager as any,
            mocks.broadcast,
            mocks.oracleClient as any,
            { pairs: [] },
          ),
      ).toThrow("Invalid strategy configuration");
    });

    it("rejects invalid deviationThreshold", () => {
      expect(
        () =>
          new ProfitHunterStrategy(
            mocks.fundAllocator as any,
            mocks.positionManager as any,
            mocks.broadcast,
            mocks.oracleClient as any,
            { pairs: ["SOL/USDC"], deviationThreshold: -0.01 },
          ),
      ).toThrow("Invalid strategy configuration");
    });

    it("rejects zero deviationThreshold", () => {
      expect(
        () =>
          new ProfitHunterStrategy(
            mocks.fundAllocator as any,
            mocks.positionManager as any,
            mocks.broadcast,
            mocks.oracleClient as any,
            { pairs: ["SOL/USDC"], deviationThreshold: 0 },
          ),
      ).toThrow("Invalid strategy configuration");
    });

    it("rejects invalid closeThreshold", () => {
      expect(
        () =>
          new ProfitHunterStrategy(
            mocks.fundAllocator as any,
            mocks.positionManager as any,
            mocks.broadcast,
            mocks.oracleClient as any,
            { pairs: ["SOL/USDC"], closeThreshold: 0 },
          ),
      ).toThrow("Invalid strategy configuration");
    });

    it("creates strategy with valid config and defaults", () => {
      const strategy = new ProfitHunterStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        { pairs: ["SOL/USDC", "ETH/USDC"] },
      );
      expect(strategy.getIntervalMs()).toBe(5_000);
    });

    it("creates strategy with custom config values", () => {
      const strategy = new ProfitHunterStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        {
          pairs: ["SOL/USDC"],
          deviationThreshold: 0.02,
          closeThreshold: 0.005,
          iterationIntervalMs: 10_000,
          slippage: 1.0,
          positionSize: 500_000,
        },
      );
      expect(strategy.getIntervalMs()).toBe(10_000);
    });
  });

  // --- executeIteration: open Long when price < MA (Task 4.3) ---

  describe("opens Long when price < MA beyond threshold", () => {
    it("opens Long position for mean-reversion up", async () => {
      // Price 2% below MA → deviation = -0.02, exceeds default 1% threshold
      mocks.oracleClient.getPrice.mockReturnValue(98_000_000); // 98 USDC
      mocks.oracleClient.getMovingAverage.mockReturnValue(100_000_000); // 100 USDC

      const strategy = new ProfitHunterStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.executeIteration();

      expect(mocks.positionManager.openPosition).toHaveBeenCalledTimes(1);
      expect(mocks.positionManager.openPosition).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "profitHunter",
          pair: "SOL/USDC",
          side: "Long",
        }),
      );
    });
  });

  // --- executeIteration: open Short when price > MA (Task 4.4) ---

  describe("opens Short when price > MA beyond threshold", () => {
    it("opens Short position for mean-reversion down", async () => {
      // Price 2% above MA → deviation = +0.02
      mocks.oracleClient.getPrice.mockReturnValue(102_000_000);
      mocks.oracleClient.getMovingAverage.mockReturnValue(100_000_000);

      const strategy = new ProfitHunterStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.executeIteration();

      expect(mocks.positionManager.openPosition).toHaveBeenCalledTimes(1);
      expect(mocks.positionManager.openPosition).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "profitHunter",
          pair: "SOL/USDC",
          side: "Short",
        }),
      );
    });
  });

  // --- No trade when deviation within threshold (Task 4.5) ---

  describe("no trade when deviation within threshold", () => {
    it("does not open position when price is within deviation threshold", async () => {
      // Price 0.5% above MA → within default 1% threshold
      mocks.oracleClient.getPrice.mockReturnValue(100_500_000);
      mocks.oracleClient.getMovingAverage.mockReturnValue(100_000_000);

      const strategy = new ProfitHunterStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.executeIteration();

      expect(mocks.positionManager.openPosition).not.toHaveBeenCalled();
    });
  });

  // --- Close position when price reverts (Task 4.6) ---

  describe("closes position when price reverts within closeThreshold", () => {
    it("closes position when deviation returns within close threshold of MA", async () => {
      // Open position exists on SOL/USDC
      mocks.positionManager.getPositions.mockReturnValue([
        { id: 42, mode: "profitHunter", pair: "SOL/USDC", side: "Long", size: 50, entryPrice: 98, stopLoss: 95, timestamp: Date.now() },
      ]);

      // Price has reverted: 0.1% deviation from MA (within default 0.3% close threshold)
      mocks.oracleClient.getPrice.mockReturnValue(100_100_000);
      mocks.oracleClient.getMovingAverage.mockReturnValue(100_000_000);

      const strategy = new ProfitHunterStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.executeIteration();

      expect(mocks.positionManager.closePosition).toHaveBeenCalledWith(42);
    });
  });

  // --- Skip pair when oracle unavailable or MA null (Task 4.7) ---

  describe("skips pair when oracle unavailable or MA null", () => {
    it("skips pair when oracle isAvailable returns false", async () => {
      mocks.oracleClient.isAvailable.mockReturnValue(false);

      const strategy = new ProfitHunterStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.executeIteration();

      expect(mocks.positionManager.openPosition).not.toHaveBeenCalled();
    });

    it("skips pair when moving average is null (warm-up period)", async () => {
      mocks.oracleClient.getPrice.mockReturnValue(100_000_000);
      mocks.oracleClient.getMovingAverage.mockReturnValue(null);

      const strategy = new ProfitHunterStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.executeIteration();

      expect(mocks.positionManager.openPosition).not.toHaveBeenCalled();
    });

    it("skips pair when price is null", async () => {
      mocks.oracleClient.getPrice.mockReturnValue(null);
      mocks.oracleClient.getMovingAverage.mockReturnValue(100_000_000);

      const strategy = new ProfitHunterStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.executeIteration();

      expect(mocks.positionManager.openPosition).not.toHaveBeenCalled();
    });
  });

  // --- Skip trade when canAllocate returns false (Task 4.8) ---

  describe("skips trade when canAllocate returns false", () => {
    it("does not open position when funds insufficient", async () => {
      mocks.fundAllocator.canAllocate.mockReturnValue(false);
      mocks.oracleClient.getPrice.mockReturnValue(98_000_000);
      mocks.oracleClient.getMovingAverage.mockReturnValue(100_000_000);

      const strategy = new ProfitHunterStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.executeIteration();

      expect(mocks.positionManager.openPosition).not.toHaveBeenCalled();
    });
  });

  // --- Stop-loss calculated correctly (Task 4.9) ---

  describe("stop-loss calculation", () => {
    it("sets stop-loss below price for Long (3% below)", async () => {
      const price = 100_000_000; // 100 USDC
      mocks.oracleClient.getPrice.mockReturnValue(price);
      // MA higher so price < MA → Long
      mocks.oracleClient.getMovingAverage.mockReturnValue(102_000_000);

      const strategy = new ProfitHunterStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        { pairs: ["SOL/USDC"], deviationThreshold: 0.01 },
      );

      await strategy.executeIteration();

      expect(mocks.positionManager.openPosition).toHaveBeenCalledWith(
        expect.objectContaining({
          side: "Long",
          stopLossPrice: Math.floor(price * 0.97), // 97_000_000
        }),
      );
    });

    it("sets stop-loss above price for Short (3% above)", async () => {
      const price = 104_000_000; // 104 USDC
      mocks.oracleClient.getPrice.mockReturnValue(price);
      // MA lower so price > MA → Short
      mocks.oracleClient.getMovingAverage.mockReturnValue(100_000_000);

      const strategy = new ProfitHunterStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        { pairs: ["SOL/USDC"], deviationThreshold: 0.01 },
      );

      await strategy.executeIteration();

      expect(mocks.positionManager.openPosition).toHaveBeenCalledWith(
        expect.objectContaining({
          side: "Short",
          stopLossPrice: Math.floor(price * 1.03), // 107_120_000
        }),
      );
    });
  });

  // --- stop() calls closeAllForMode (Task 4.10) ---

  describe("stop() closes all positions", () => {
    it("calls closeAllForMode via super.stop()", async () => {
      const strategy = new ProfitHunterStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        { pairs: ["SOL/USDC"] },
      );

      // Need to start first so _running = true, otherwise stop() is a no-op
      // We can test by directly calling stop after simulating running state
      // Since start() fires _runLoop in background, we use a different approach:
      // Call stop() directly — it checks _running. We'll verify closeAllForMode
      // is called when the mode is stopped after being started.

      // Simulate a started strategy by starting then immediately stopping
      await strategy.start();
      await strategy.stop();

      expect(mocks.positionManager.closeAllForMode).toHaveBeenCalledWith("profitHunter");
    });
  });

  // --- Does not open duplicate on same pair (Task 4.11) ---

  describe("no duplicate positions on same pair", () => {
    it("does not open position on pair that already has an open position", async () => {
      // Existing position on SOL/USDC
      mocks.positionManager.getPositions.mockReturnValue([
        { id: 42, mode: "profitHunter", pair: "SOL/USDC", side: "Long", size: 50, entryPrice: 98, stopLoss: 95, timestamp: Date.now() },
      ]);

      // Strong deviation signal
      mocks.oracleClient.getPrice.mockReturnValue(95_000_000);
      mocks.oracleClient.getMovingAverage.mockReturnValue(100_000_000);

      const strategy = new ProfitHunterStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.executeIteration();

      // closePosition may be called (close check), but openPosition should NOT
      expect(mocks.positionManager.openPosition).not.toHaveBeenCalled();
    });
  });

  // --- CAN open positions on different pairs simultaneously (Task 4.12) ---

  describe("opens positions on different pairs simultaneously", () => {
    it("opens positions on multiple pairs in same iteration", async () => {
      // Both pairs have strong deviation signals
      mocks.oracleClient.getPrice.mockReturnValue(98_000_000); // 2% below MA
      mocks.oracleClient.getMovingAverage.mockReturnValue(100_000_000);

      const strategy = new ProfitHunterStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
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

  // --- getIntervalMs returns configured value ---

  describe("getIntervalMs", () => {
    it("returns configured iteration interval", () => {
      const strategy = new ProfitHunterStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        { pairs: ["SOL/USDC"], iterationIntervalMs: 3_000 },
      );
      expect(strategy.getIntervalMs()).toBe(3_000);
    });

    it("returns default interval when not configured", () => {
      const strategy = new ProfitHunterStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        { pairs: ["SOL/USDC"] },
      );
      expect(strategy.getIntervalMs()).toBe(5_000);
    });
  });

  // --- Dynamic position sizing ---

  describe("dynamic position sizing", () => {
    it("recalculates position size from current allocation when not explicitly configured", async () => {
      // Start with 1B allocation → positionSize = floor(1B / 20) = 50_000_000
      mocks.oracleClient.getPrice.mockReturnValue(98_000_000);
      mocks.oracleClient.getMovingAverage.mockReturnValue(100_000_000);

      const strategy = new ProfitHunterStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.executeIteration();
      expect(mocks.positionManager.openPosition).toHaveBeenCalledWith(
        expect.objectContaining({ size: 50_000_000 }),
      );

      // Simulate allocation change to 500M → positionSize = floor(500M / 20) = 25_000_000
      mocks.fundAllocator.getAllocation.mockReturnValue({ allocation: 500_000_000, remaining: 500_000_000 });
      mocks.positionManager.getPositions.mockReturnValue([]);
      mocks.positionManager.openPosition.mockClear();

      await strategy.executeIteration();
      expect(mocks.positionManager.openPosition).toHaveBeenCalledWith(
        expect.objectContaining({ size: 25_000_000 }),
      );
    });

    it("uses static position size when explicitly configured", async () => {
      mocks.oracleClient.getPrice.mockReturnValue(98_000_000);
      mocks.oracleClient.getMovingAverage.mockReturnValue(100_000_000);

      const strategy = new ProfitHunterStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        { pairs: ["SOL/USDC"], positionSize: 10_000_000 },
      );

      // Change allocation — should NOT affect position size
      mocks.fundAllocator.getAllocation.mockReturnValue({ allocation: 500_000_000, remaining: 500_000_000 });

      await strategy.executeIteration();
      expect(mocks.positionManager.openPosition).toHaveBeenCalledWith(
        expect.objectContaining({ size: 10_000_000 }),
      );
    });
  });
});
