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
    getPrice: vi.fn().mockReturnValue(100_000_000),
    getMovingAverage: vi.fn().mockReturnValue(100_000_000),
    isAvailable: vi.fn().mockReturnValue(true),
    connect: vi.fn(),
    disconnect: vi.fn(),
    getFeedEntry: vi.fn(),
    getRawData: vi.fn(),
    getRsi: vi.fn().mockReturnValue(50), // neutral RSI by default
    getCandles: vi.fn().mockReturnValue([]),
  };

  const broadcast = vi.fn() as unknown as BroadcastFn;

  return { fundAllocator, positionManager, oracleClient, broadcast };
}

describe("ProfitHunterStrategy", () => {
  let mocks: ReturnType<typeof createMocks>;

  beforeEach(() => {
    mocks = createMocks();
  });

  // --- Constructor tests ---

  describe("constructor validation", () => {
    it("rejects allocation below $10 minimum", () => {
      const smallMocks = createMocks(5_000_000);
      expect(
        () =>
          new ProfitHunterStrategy(
            smallMocks.fundAllocator as any,
            smallMocks.positionManager as any,
            smallMocks.broadcast,
            smallMocks.oracleClient as any,
            { pairs: ["SOL/USDC"] },
          ),
      ).toThrow("Invalid strategy configuration");
    });

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

    it("rejects oversoldThreshold >= overboughtThreshold", () => {
      expect(
        () =>
          new ProfitHunterStrategy(
            mocks.fundAllocator as any,
            mocks.positionManager as any,
            mocks.broadcast,
            mocks.oracleClient as any,
            { pairs: ["SOL/USDC"], oversoldThreshold: 70, overboughtThreshold: 30 },
          ),
      ).toThrow("Invalid strategy configuration");
    });

    it("rejects oversoldThreshold out of range", () => {
      expect(
        () =>
          new ProfitHunterStrategy(
            mocks.fundAllocator as any,
            mocks.positionManager as any,
            mocks.broadcast,
            mocks.oracleClient as any,
            { pairs: ["SOL/USDC"], oversoldThreshold: -5 },
          ),
      ).toThrow("Invalid strategy configuration");
    });

    it("rejects exitRsi outside oversold/overbought range", () => {
      expect(
        () =>
          new ProfitHunterStrategy(
            mocks.fundAllocator as any,
            mocks.positionManager as any,
            mocks.broadcast,
            mocks.oracleClient as any,
            { pairs: ["SOL/USDC"], oversoldThreshold: 30, overboughtThreshold: 70, exitRsi: 20 },
          ),
      ).toThrow("Invalid strategy configuration");
      expect(
        () =>
          new ProfitHunterStrategy(
            mocks.fundAllocator as any,
            mocks.positionManager as any,
            mocks.broadcast,
            mocks.oracleClient as any,
            { pairs: ["SOL/USDC"], oversoldThreshold: 30, overboughtThreshold: 70, exitRsi: 80 },
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
      expect(strategy.getIntervalMs()).toBe(30_000);
    });

    it("creates strategy with custom config values", () => {
      const strategy = new ProfitHunterStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        {
          pairs: ["SOL/USDC"],
          rsiPeriod: 10,
          oversoldThreshold: 25,
          overboughtThreshold: 75,
          exitRsi: 50,
          iterationIntervalMs: 60_000,
          slippage: 1.0,
          positionSize: 500_000,
        },
      );
      expect(strategy.getIntervalMs()).toBe(60_000);
    });
  });

  // --- Opens Long when RSI < 30 (Task 4.4) ---

  describe("opens Long when RSI < oversoldThreshold", () => {
    it("opens Long position when RSI is below 30", async () => {
      mocks.oracleClient.getRsi.mockReturnValue(25); // RSI 25 < 30 → oversold

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

  // --- Opens Short when RSI > 70 (Task 4.5) ---

  describe("opens Short when RSI > overboughtThreshold", () => {
    it("opens Short position when RSI is above 70", async () => {
      mocks.oracleClient.getRsi.mockReturnValue(75); // RSI 75 > 70 → overbought

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

  // --- Closes Long when RSI > 50 (Task 4.6) ---

  describe("closes Long when RSI > exitRsi", () => {
    it("closes Long position when RSI crosses above 50", async () => {
      mocks.positionManager.getPositions.mockReturnValue([
        { id: 42, mode: "profitHunter", pair: "SOL/USDC", side: "Long", size: 50_000_000, entryPrice: 98, stopLoss: 95, timestamp: Date.now() },
      ]);
      mocks.oracleClient.getRsi.mockReturnValue(55); // RSI > 50 → mean reverted

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

  // --- Closes Short when RSI < 50 (Task 4.7) ---

  describe("closes Short when RSI < exitRsi", () => {
    it("closes Short position when RSI crosses below 50", async () => {
      mocks.positionManager.getPositions.mockReturnValue([
        { id: 43, mode: "profitHunter", pair: "SOL/USDC", side: "Short", size: 50_000_000, entryPrice: 102, stopLoss: 105, timestamp: Date.now() },
      ]);
      mocks.oracleClient.getRsi.mockReturnValue(45); // RSI < 50 → mean reverted

      const strategy = new ProfitHunterStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.executeIteration();

      expect(mocks.positionManager.closePosition).toHaveBeenCalledWith(43);
    });
  });

  // --- Skips during warm-up (Task 4.8) ---

  describe("skips during warm-up (insufficient candles)", () => {
    it("skips pair when getRsi returns null", async () => {
      mocks.oracleClient.getRsi.mockReturnValue(null); // insufficient candles

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
  });

  // --- No trade when RSI is neutral ---

  describe("no trade when RSI is within thresholds", () => {
    it("does not open position when RSI is neutral (between 30-70)", async () => {
      mocks.oracleClient.getRsi.mockReturnValue(50); // neutral

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

  // --- Activity log reports RSI values (Task 4.9) ---

  describe("activity log reports RSI values", () => {
    function getActivityCall(broadcast: ReturnType<typeof vi.fn>) {
      const calls = broadcast.mock.calls as [string, unknown][];
      return calls.find(([event]) => event === "mode.activity");
    }

    it("broadcasts MODE_ACTIVITY with RSI signalValue", async () => {
      mocks.oracleClient.getRsi.mockReturnValue(50);

      const strategy = new ProfitHunterStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.executeIteration();

      const call = getActivityCall(mocks.broadcast as unknown as ReturnType<typeof vi.fn>);
      expect(call).toBeDefined();
      const [, payload] = call!;
      expect(payload).toEqual(expect.objectContaining({
        mode: "profitHunter",
        iteration: 1,
        pairs: expect.arrayContaining([
          expect.objectContaining({ pair: "SOL/USDC", signalValue: 50, outcome: "no-signal" }),
        ]),
      }));
    });

    it("reports null signalValue during warm-up", async () => {
      mocks.oracleClient.getRsi.mockReturnValue(null);

      const strategy = new ProfitHunterStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.executeIteration();

      const call = getActivityCall(mocks.broadcast as unknown as ReturnType<typeof vi.fn>);
      const payload = call![1] as any;
      expect(payload.pairs[0]).toEqual(expect.objectContaining({
        pair: "SOL/USDC",
        signalValue: null,
        oracleStatus: "warming-up",
        outcome: "skipped-warming",
      }));
    });

    it("reports opened-long when RSI triggers Long", async () => {
      mocks.oracleClient.getRsi.mockReturnValue(25);

      const strategy = new ProfitHunterStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.executeIteration();

      const call = getActivityCall(mocks.broadcast as unknown as ReturnType<typeof vi.fn>);
      const payload = call![1] as any;
      expect(payload.pairs[0]).toEqual(expect.objectContaining({
        pair: "SOL/USDC",
        signalValue: 25,
        outcome: "opened-long",
        side: "Long",
        oracleStatus: "ok",
      }));
    });

    it("reports skipped-stale when oracle unavailable", async () => {
      mocks.oracleClient.isAvailable.mockReturnValue(false);

      const strategy = new ProfitHunterStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.executeIteration();

      const call = getActivityCall(mocks.broadcast as unknown as ReturnType<typeof vi.fn>);
      const payload = call![1] as any;
      expect(payload.pairs[0]).toEqual(expect.objectContaining({
        pair: "SOL/USDC",
        outcome: "skipped-stale",
        oracleStatus: "stale",
        signalValue: null,
      }));
    });

    it("reports closed-reverted when position closes", async () => {
      mocks.positionManager.getPositions.mockReturnValue([
        { id: 42, mode: "profitHunter", pair: "SOL/USDC", side: "Long", size: 50_000_000, entryPrice: 98, stopLoss: 95, timestamp: Date.now() },
      ]);
      mocks.oracleClient.getRsi.mockReturnValue(55);

      const strategy = new ProfitHunterStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.executeIteration();

      const call = getActivityCall(mocks.broadcast as unknown as ReturnType<typeof vi.fn>);
      const payload = call![1] as any;
      expect(payload.pairs[0]).toEqual(expect.objectContaining({
        pair: "SOL/USDC",
        outcome: "closed-reverted",
        side: "Long",
        size: 50_000_000,
      }));
    });

    it("reports skipped-no-funds when canAllocate returns false", async () => {
      mocks.fundAllocator.canAllocate.mockReturnValue(false);
      mocks.oracleClient.getRsi.mockReturnValue(25);

      const strategy = new ProfitHunterStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.executeIteration();

      const call = getActivityCall(mocks.broadcast as unknown as ReturnType<typeof vi.fn>);
      const payload = call![1] as any;
      expect(payload.pairs[0]).toEqual(expect.objectContaining({
        pair: "SOL/USDC",
        outcome: "skipped-no-funds",
        side: "Long",
      }));
    });

    it("increments iteration counter across calls", async () => {
      mocks.oracleClient.getRsi.mockReturnValue(50);

      const strategy = new ProfitHunterStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.executeIteration();
      await strategy.executeIteration();

      const broadcastFn = mocks.broadcast as unknown as ReturnType<typeof vi.fn>;
      const activityCalls = broadcastFn.mock.calls.filter(([e]: [string]) => e === "mode.activity");
      expect(activityCalls).toHaveLength(2);
      expect((activityCalls[0][1] as any).iteration).toBe(1);
      expect((activityCalls[1][1] as any).iteration).toBe(2);
    });
  });

  // --- Stop-loss calculated correctly ---

  describe("stop-loss calculation", () => {
    it("sets stop-loss below price for Long (5% below)", async () => {
      const price = 100_000_000;
      mocks.oracleClient.getRsi.mockReturnValue(25); // triggers Long
      mocks.oracleClient.getPrice.mockReturnValue(price);

      const strategy = new ProfitHunterStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.executeIteration();

      expect(mocks.positionManager.openPosition).toHaveBeenCalledWith(
        expect.objectContaining({
          side: "Long",
          stopLossPrice: Math.floor(price * 0.95), // 5% stop-loss
        }),
      );
    });

    it("sets stop-loss above price for Short (5% above)", async () => {
      const price = 100_000_000;
      mocks.oracleClient.getRsi.mockReturnValue(75); // triggers Short
      mocks.oracleClient.getPrice.mockReturnValue(price);

      const strategy = new ProfitHunterStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.executeIteration();

      expect(mocks.positionManager.openPosition).toHaveBeenCalledWith(
        expect.objectContaining({
          side: "Short",
          stopLossPrice: Math.floor(price * 1.05), // 5% stop-loss
        }),
      );
    });
  });

  // --- stop() calls closeAllForMode ---

  describe("stop() closes all positions", () => {
    it("calls closeAllForMode via super.stop()", async () => {
      const strategy = new ProfitHunterStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.start();
      await strategy.stop();

      expect(mocks.positionManager.closeAllForMode).toHaveBeenCalledWith("profitHunter");
    });
  });

  // --- Does not open duplicate on same pair ---

  describe("no duplicate positions on same pair", () => {
    it("does not open position on pair that already has an open position", async () => {
      mocks.positionManager.getPositions.mockReturnValue([
        { id: 42, mode: "profitHunter", pair: "SOL/USDC", side: "Long", size: 50, entryPrice: 98, stopLoss: 95, timestamp: Date.now() },
      ]);
      mocks.oracleClient.getRsi.mockReturnValue(25); // strong buy signal

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

  // --- CAN open positions on different pairs simultaneously ---

  describe("opens positions on different pairs simultaneously", () => {
    it("opens positions on multiple pairs in same iteration", async () => {
      mocks.oracleClient.getRsi.mockReturnValue(25); // oversold on all pairs

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

  // --- oracle key mapping ---

  describe("oracle key mapping", () => {
    it("calls oracle with SOL-PERP key for SOL/USDC pair", async () => {
      mocks.oracleClient.getRsi.mockReturnValue(50);

      const strategy = new ProfitHunterStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.executeIteration();

      expect(mocks.oracleClient.isAvailable).toHaveBeenCalledWith("SOL-PERP");
      expect(mocks.oracleClient.getRsi).toHaveBeenCalledWith("SOL-PERP", 14);
    });
  });

  // --- getIntervalMs ---

  describe("getIntervalMs", () => {
    it("returns configured iteration interval", () => {
      const strategy = new ProfitHunterStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        { pairs: ["SOL/USDC"], iterationIntervalMs: 60_000 },
      );
      expect(strategy.getIntervalMs()).toBe(60_000);
    });

    it("returns default interval (30s) when not configured", () => {
      const strategy = new ProfitHunterStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        { pairs: ["SOL/USDC"] },
      );
      expect(strategy.getIntervalMs()).toBe(30_000);
    });
  });

  // --- Dynamic position sizing ---

  describe("dynamic position sizing", () => {
    it("recalculates position size from current allocation when not explicitly configured", async () => {
      mocks.oracleClient.getRsi.mockReturnValue(25);

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

      mocks.fundAllocator.getAllocation.mockReturnValue({ allocation: 500_000_000, remaining: 500_000_000 });
      mocks.positionManager.getPositions.mockReturnValue([]);
      mocks.positionManager.openPosition.mockClear();

      await strategy.executeIteration();
      expect(mocks.positionManager.openPosition).toHaveBeenCalledWith(
        expect.objectContaining({ size: 25_000_000 }),
      );
    });

    it("uses static position size when explicitly configured", async () => {
      mocks.oracleClient.getRsi.mockReturnValue(25);

      const strategy = new ProfitHunterStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        { pairs: ["SOL/USDC"], positionSize: 10_000_000 },
      );

      mocks.fundAllocator.getAllocation.mockReturnValue({ allocation: 500_000_000, remaining: 500_000_000 });

      await strategy.executeIteration();
      expect(mocks.positionManager.openPosition).toHaveBeenCalledWith(
        expect.objectContaining({ size: 10_000_000 }),
      );
    });
  });

  // --- Does not close positions that haven't mean-reverted ---

  describe("holds positions when RSI has not mean-reverted", () => {
    it("holds Long when RSI is still below exitRsi", async () => {
      mocks.positionManager.getPositions.mockReturnValue([
        { id: 42, mode: "profitHunter", pair: "SOL/USDC", side: "Long", size: 50_000_000, entryPrice: 98, stopLoss: 95, timestamp: Date.now() },
      ]);
      mocks.oracleClient.getRsi.mockReturnValue(40); // still below 50

      const strategy = new ProfitHunterStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.executeIteration();

      expect(mocks.positionManager.closePosition).not.toHaveBeenCalled();
    });

    it("holds Short when RSI is still above exitRsi", async () => {
      mocks.positionManager.getPositions.mockReturnValue([
        { id: 43, mode: "profitHunter", pair: "SOL/USDC", side: "Short", size: 50_000_000, entryPrice: 102, stopLoss: 105, timestamp: Date.now() },
      ]);
      mocks.oracleClient.getRsi.mockReturnValue(60); // still above 50

      const strategy = new ProfitHunterStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.executeIteration();

      expect(mocks.positionManager.closePosition).not.toHaveBeenCalled();
    });
  });
});
