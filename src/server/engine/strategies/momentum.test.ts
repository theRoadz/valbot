import { describe, it, expect, beforeEach, vi } from "vitest";
import { MomentumStrategy } from "./momentum.js";
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
    updateStopLoss: vi.fn().mockResolvedValue(undefined),
  };

  const oracleClient = {
    getPrice: vi.fn().mockReturnValue(100_000_000),
    getMovingAverage: vi.fn().mockReturnValue(100_000_000),
    isAvailable: vi.fn().mockReturnValue(true),
    connect: vi.fn(),
    disconnect: vi.fn(),
    getFeedEntry: vi.fn(),
    getRawData: vi.fn(),
    getRsi: vi.fn().mockReturnValue(50),
    getEma: vi.fn().mockReturnValue(100_000_000),
    getCandles: vi.fn().mockReturnValue([]),
  };

  const broadcast = vi.fn() as unknown as BroadcastFn;

  return { fundAllocator, positionManager, oracleClient, broadcast };
}

function getActivityCall(broadcast: ReturnType<typeof vi.fn>) {
  const calls = broadcast.mock.calls as [string, unknown][];
  return calls.find(([event]) => event === "mode.activity");
}

describe("MomentumStrategy", () => {
  let mocks: ReturnType<typeof createMocks>;

  beforeEach(() => {
    mocks = createMocks();
  });

  // --- Constructor validation (Task 4.10) ---

  describe("constructor validation", () => {
    it("rejects empty pairs array", () => {
      expect(
        () =>
          new MomentumStrategy(
            mocks.fundAllocator as any,
            mocks.positionManager as any,
            mocks.broadcast,
            mocks.oracleClient as any,
            { pairs: [] },
          ),
      ).toThrow("Invalid strategy configuration");
    });

    it("rejects fastEmaPeriod >= slowEmaPeriod", () => {
      expect(
        () =>
          new MomentumStrategy(
            mocks.fundAllocator as any,
            mocks.positionManager as any,
            mocks.broadcast,
            mocks.oracleClient as any,
            { pairs: ["SOL/USDC"], fastEmaPeriod: 21, slowEmaPeriod: 9 },
          ),
      ).toThrow("Invalid strategy configuration");
    });

    it("rejects fastEmaPeriod equal to slowEmaPeriod", () => {
      expect(
        () =>
          new MomentumStrategy(
            mocks.fundAllocator as any,
            mocks.positionManager as any,
            mocks.broadcast,
            mocks.oracleClient as any,
            { pairs: ["SOL/USDC"], fastEmaPeriod: 14, slowEmaPeriod: 14 },
          ),
      ).toThrow("Invalid strategy configuration");
    });

    it("rejects trailingStopPct <= 0", () => {
      expect(
        () =>
          new MomentumStrategy(
            mocks.fundAllocator as any,
            mocks.positionManager as any,
            mocks.broadcast,
            mocks.oracleClient as any,
            { pairs: ["SOL/USDC"], trailingStopPct: 0 },
          ),
      ).toThrow("Invalid strategy configuration");
    });

    it("rejects allocation below $10 minimum", () => {
      const smallMocks = createMocks(5_000_000);
      expect(
        () =>
          new MomentumStrategy(
            smallMocks.fundAllocator as any,
            smallMocks.positionManager as any,
            smallMocks.broadcast,
            smallMocks.oracleClient as any,
            { pairs: ["SOL/USDC"] },
          ),
      ).toThrow("Invalid strategy configuration");
    });

    it("creates strategy with valid config and defaults", () => {
      const strategy = new MomentumStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        { pairs: ["SOL/USDC"] },
      );
      expect(strategy.getIntervalMs()).toBe(30_000);
    });
  });

  // --- Opens Long on bullish crossover + RSI > 50 (Task 4.2 / AC1) ---

  describe("opens Long on bullish crossover + RSI > 50", () => {
    it("opens Long when EMA(9) crosses above EMA(21) and RSI > 50", async () => {
      // Iteration 1: fast < slow (set initial state)
      mocks.oracleClient.getEma.mockImplementation((_pair: string, period: number) => {
        return period === 9 ? 99_000_000 : 101_000_000; // fast < slow
      });
      mocks.oracleClient.getRsi.mockReturnValue(55);

      const strategy = new MomentumStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.executeIteration();
      expect(mocks.positionManager.openPosition).not.toHaveBeenCalled();

      // Iteration 2: fast > slow (crossover!)
      mocks.oracleClient.getEma.mockImplementation((_pair: string, period: number) => {
        return period === 9 ? 102_000_000 : 100_000_000; // fast > slow
      });
      mocks.oracleClient.getRsi.mockReturnValue(55); // RSI > 50 confirms

      await strategy.executeIteration();

      expect(mocks.positionManager.openPosition).toHaveBeenCalledTimes(1);
      expect(mocks.positionManager.openPosition).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "momentum",
          pair: "SOL/USDC",
          side: "Long",
        }),
      );
    });
  });

  // --- Opens Short on bearish crossover + RSI < 50 (Task 4.3 / AC2) ---

  describe("opens Short on bearish crossover + RSI < 50", () => {
    it("opens Short when EMA(9) crosses below EMA(21) and RSI < 50", async () => {
      // Iteration 1: fast > slow
      mocks.oracleClient.getEma.mockImplementation((_pair: string, period: number) => {
        return period === 9 ? 102_000_000 : 100_000_000;
      });
      mocks.oracleClient.getRsi.mockReturnValue(45);

      const strategy = new MomentumStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.executeIteration();
      expect(mocks.positionManager.openPosition).not.toHaveBeenCalled();

      // Iteration 2: fast < slow (crossover!)
      mocks.oracleClient.getEma.mockImplementation((_pair: string, period: number) => {
        return period === 9 ? 99_000_000 : 101_000_000;
      });
      mocks.oracleClient.getRsi.mockReturnValue(45); // RSI < 50 confirms

      await strategy.executeIteration();

      expect(mocks.positionManager.openPosition).toHaveBeenCalledTimes(1);
      expect(mocks.positionManager.openPosition).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "momentum",
          pair: "SOL/USDC",
          side: "Short",
        }),
      );
    });
  });

  // --- Does NOT open when RSI doesn't confirm crossover (Task 4.4 / AC9) ---

  describe("does NOT open when RSI doesn't confirm", () => {
    it("no Long when bullish crossover but RSI < 50", async () => {
      // Iteration 1: fast < slow
      mocks.oracleClient.getEma.mockImplementation((_pair: string, period: number) => {
        return period === 9 ? 99_000_000 : 101_000_000;
      });

      const strategy = new MomentumStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.executeIteration();

      // Iteration 2: bullish crossover but RSI < 50
      mocks.oracleClient.getEma.mockImplementation((_pair: string, period: number) => {
        return period === 9 ? 102_000_000 : 100_000_000;
      });
      mocks.oracleClient.getRsi.mockReturnValue(45); // RSI < 50 — doesn't confirm bullish

      await strategy.executeIteration();

      expect(mocks.positionManager.openPosition).not.toHaveBeenCalled();
    });

    it("no Short when bearish crossover but RSI > 50", async () => {
      // Iteration 1: fast > slow
      mocks.oracleClient.getEma.mockImplementation((_pair: string, period: number) => {
        return period === 9 ? 102_000_000 : 100_000_000;
      });

      const strategy = new MomentumStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.executeIteration();

      // Iteration 2: bearish crossover but RSI > 50
      mocks.oracleClient.getEma.mockImplementation((_pair: string, period: number) => {
        return period === 9 ? 99_000_000 : 101_000_000;
      });
      mocks.oracleClient.getRsi.mockReturnValue(55); // RSI > 50 — doesn't confirm bearish

      await strategy.executeIteration();

      expect(mocks.positionManager.openPosition).not.toHaveBeenCalled();
    });
  });

  // --- Closes on reverse crossover (Task 4.5 / AC3, AC4) ---

  describe("closes on reverse crossover", () => {
    it("closes Long when EMA(9) crosses below EMA(21)", async () => {
      mocks.positionManager.getPositions.mockReturnValue([
        { id: 42, mode: "momentum", pair: "SOL/USDC", side: "Long", size: 50, entryPrice: 100, stopLoss: 97, timestamp: Date.now() },
      ]);
      // fast < slow → bearish, opposite of Long
      mocks.oracleClient.getEma.mockImplementation((_pair: string, period: number) => {
        return period === 9 ? 99_000_000 : 101_000_000;
      });

      const strategy = new MomentumStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.executeIteration();

      expect(mocks.positionManager.closePosition).toHaveBeenCalledWith(42);
    });

    it("closes Short when EMA(9) crosses above EMA(21)", async () => {
      mocks.positionManager.getPositions.mockReturnValue([
        { id: 43, mode: "momentum", pair: "SOL/USDC", side: "Short", size: 50, entryPrice: 100, stopLoss: 103, timestamp: Date.now() },
      ]);
      // fast > slow → bullish, opposite of Short
      mocks.oracleClient.getEma.mockImplementation((_pair: string, period: number) => {
        return period === 9 ? 102_000_000 : 100_000_000;
      });

      const strategy = new MomentumStrategy(
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

  // --- Trailing stop updates on new high for Long (Task 4.6 / AC5) ---

  describe("trailing stop updates on new high (Long)", () => {
    it("calls updateStopLoss when price reaches new high", async () => {
      mocks.positionManager.getPositions.mockReturnValue([
        { id: 42, mode: "momentum", pair: "SOL/USDC", side: "Long", size: 50, entryPrice: 100, stopLoss: 97, timestamp: Date.now() },
      ]);
      // fast > slow → no reverse crossover
      mocks.oracleClient.getEma.mockImplementation((_pair: string, period: number) => {
        return period === 9 ? 102_000_000 : 100_000_000;
      });
      mocks.oracleClient.getPrice.mockReturnValue(105_000_000); // new high

      const strategy = new MomentumStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.executeIteration();

      // First iteration initializes peak, then sees 105M > peak (105M)
      // Actually: first time no state → init peak to 105M → 105M > init? No, it IS the init.
      // We need a second iteration with higher price.

      mocks.oracleClient.getPrice.mockReturnValue(110_000_000); // even higher

      await strategy.executeIteration();

      expect(mocks.positionManager.updateStopLoss).toHaveBeenCalledWith(
        42,
        Math.floor(110_000_000 * (1 - 0.03)), // 3% trailing stop
      );
    });
  });

  // --- Trailing stop updates on new low for Short (Task 4.7 / AC6) ---

  describe("trailing stop updates on new low (Short)", () => {
    it("calls updateStopLoss when price reaches new low", async () => {
      mocks.positionManager.getPositions.mockReturnValue([
        { id: 43, mode: "momentum", pair: "SOL/USDC", side: "Short", size: 50, entryPrice: 100, stopLoss: 103, timestamp: Date.now() },
      ]);
      // fast < slow → no reverse crossover for Short
      mocks.oracleClient.getEma.mockImplementation((_pair: string, period: number) => {
        return period === 9 ? 99_000_000 : 101_000_000;
      });
      mocks.oracleClient.getPrice.mockReturnValue(95_000_000);

      const strategy = new MomentumStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.executeIteration();

      // Second iteration with even lower price
      mocks.oracleClient.getPrice.mockReturnValue(90_000_000);

      await strategy.executeIteration();

      expect(mocks.positionManager.updateStopLoss).toHaveBeenCalledWith(
        43,
        Math.ceil(90_000_000 * (1 + 0.03)), // 3% trailing stop above trough
      );
    });
  });

  // --- Trailing stop never moves backward (Task 4.8 / AC7) ---

  describe("trailing stop never moves backward", () => {
    it("does not call updateStopLoss when price retraces (Long)", async () => {
      mocks.positionManager.getPositions.mockReturnValue([
        { id: 42, mode: "momentum", pair: "SOL/USDC", side: "Long", size: 50, entryPrice: 100, stopLoss: 97, timestamp: Date.now() },
      ]);
      // fast > slow → no reverse crossover for Long
      mocks.oracleClient.getEma.mockImplementation((_pair: string, period: number) => {
        return period === 9 ? 102_000_000 : 100_000_000;
      });
      mocks.oracleClient.getPrice.mockReturnValue(110_000_000); // high

      const strategy = new MomentumStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.executeIteration(); // init peak at 110M

      // Price drops — peak should NOT update
      mocks.oracleClient.getPrice.mockReturnValue(105_000_000);
      mocks.positionManager.updateStopLoss.mockClear();

      await strategy.executeIteration();

      // updateStopLoss should NOT be called because price is below peak
      expect(mocks.positionManager.updateStopLoss).not.toHaveBeenCalled();
    });

    it("does not call updateStopLoss when price retraces (Short)", async () => {
      mocks.positionManager.getPositions.mockReturnValue([
        { id: 43, mode: "momentum", pair: "SOL/USDC", side: "Short", size: 50, entryPrice: 100, stopLoss: 103, timestamp: Date.now() },
      ]);
      mocks.oracleClient.getEma.mockImplementation((_pair: string, period: number) => {
        return period === 9 ? 99_000_000 : 101_000_000;
      });
      mocks.oracleClient.getPrice.mockReturnValue(90_000_000); // low

      const strategy = new MomentumStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.executeIteration(); // init peak at 90M

      // Price rises — peak should NOT update for Short
      mocks.oracleClient.getPrice.mockReturnValue(95_000_000);
      mocks.positionManager.updateStopLoss.mockClear();

      await strategy.executeIteration();

      expect(mocks.positionManager.updateStopLoss).not.toHaveBeenCalled();
    });
  });

  // --- Skips during warm-up (Task 4.9 / AC8) ---

  describe("skips during warm-up (< 21 candles)", () => {
    it("skips when getEma returns null for slow EMA", async () => {
      mocks.oracleClient.getEma.mockReturnValue(null); // insufficient candles

      const strategy = new MomentumStrategy(
        mocks.fundAllocator as any,
        mocks.positionManager as any,
        mocks.broadcast,
        mocks.oracleClient as any,
        { pairs: ["SOL/USDC"] },
      );

      await strategy.executeIteration();

      expect(mocks.positionManager.openPosition).not.toHaveBeenCalled();
    });

    it("reports skipped-warming in activity log", async () => {
      mocks.oracleClient.getEma.mockReturnValue(null);

      const strategy = new MomentumStrategy(
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
        outcome: "skipped-warming",
        oracleStatus: "warming-up",
      }));
    });
  });

  // --- updateStopLoss on position-manager (Task 4.11) ---
  // This is tested indirectly via trailing stop tests above (updateStopLoss is called).
  // The actual never-backward enforcement is in position-manager, tested below.

  // --- Broadcasts MODE_ACTIVITY (Task 4.12) ---

  describe("broadcasts MODE_ACTIVITY with correct pair entries", () => {
    it("broadcasts activity each iteration", async () => {
      // No crossover — just monitoring
      mocks.oracleClient.getEma.mockImplementation((_pair: string, period: number) => {
        return period === 9 ? 102_000_000 : 100_000_000; // fast > slow
      });

      const strategy = new MomentumStrategy(
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
        mode: "momentum",
        iteration: 1,
        pairs: expect.arrayContaining([
          expect.objectContaining({ pair: "SOL/USDC" }),
        ]),
      }));
    });

    it("reports closed-crossover outcome when position closed by reverse crossover", async () => {
      mocks.positionManager.getPositions.mockReturnValue([
        { id: 42, mode: "momentum", pair: "SOL/USDC", side: "Long", size: 50, entryPrice: 100, stopLoss: 97, timestamp: Date.now() },
      ]);
      mocks.oracleClient.getEma.mockImplementation((_pair: string, period: number) => {
        return period === 9 ? 99_000_000 : 101_000_000; // bearish → close Long
      });

      const strategy = new MomentumStrategy(
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
        outcome: "closed-crossover",
        side: "Long",
      }));
    });
  });
});
