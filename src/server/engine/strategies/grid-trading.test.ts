import { describe, it, expect, beforeEach, vi } from "vitest";
import { GridTradingStrategy } from "./grid-trading.js";
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
    getPrice: vi.fn().mockReturnValue(150_000_000), // $150 default
    getMovingAverage: vi.fn().mockReturnValue(150_000_000),
    isAvailable: vi.fn().mockReturnValue(true),
    connect: vi.fn(),
    disconnect: vi.fn(),
    getFeedEntry: vi.fn(),
    getRawData: vi.fn(),
    getRsi: vi.fn().mockReturnValue(50),
    getCandles: vi.fn().mockReturnValue([]),
    getEma: vi.fn().mockReturnValue(150_000_000),
  };

  const broadcast = vi.fn() as unknown as BroadcastFn;

  return { fundAllocator, positionManager, oracleClient, broadcast };
}

const DEFAULT_CONFIG = {
  pair: "SOL/USDC",
  upperPrice: 160_000_000,
  lowerPrice: 140_000_000,
  gridLines: 10,
};

function createStrategy(mocks: ReturnType<typeof createMocks>, configOverrides?: Partial<typeof DEFAULT_CONFIG>) {
  const config = { ...DEFAULT_CONFIG, ...configOverrides };
  return new GridTradingStrategy(
    mocks.fundAllocator as any,
    mocks.positionManager as any,
    mocks.broadcast,
    mocks.oracleClient as any,
    config,
  );
}

describe("GridTradingStrategy", () => {
  let mocks: ReturnType<typeof createMocks>;

  beforeEach(() => {
    mocks = createMocks();
  });

  // --- Grid level calculation (AC 1) ---

  describe("calculateGridLevels", () => {
    it("calculates evenly spaced grid levels between lower and upper price (inclusive)", () => {
      const strategy = createStrategy(mocks);
      const levels = strategy.calculateGridLevels();

      expect(levels).toHaveLength(10);
      expect(levels[0]).toBe(140_000_000); // lowerPrice
      expect(levels[9]).toBe(160_000_000); // upperPrice
      // Step = (160M - 140M) / 9 = ~2_222_222
      const step = (160_000_000 - 140_000_000) / 9;
      for (let i = 0; i < levels.length; i++) {
        expect(levels[i]).toBe(Math.round(140_000_000 + step * i));
      }
    });

    it("calculates 2 grid levels (min)", () => {
      const strategy = createStrategy(mocks, { gridLines: 2 });
      const levels = strategy.calculateGridLevels();

      expect(levels).toHaveLength(2);
      expect(levels[0]).toBe(140_000_000);
      expect(levels[1]).toBe(160_000_000);
    });
  });

  // --- Open Long on price cross below level (AC 2) ---

  describe("opens Long when price crosses below a grid level", () => {
    it("opens Long position when price is below a grid level with no position", async () => {
      // Price at $148 — below most grid levels
      mocks.oracleClient.getPrice.mockReturnValue(148_000_000);

      const strategy = createStrategy(mocks);
      // Simulate onStart to initialize grid state
      await strategy.start();

      // Clear start broadcast
      (mocks.broadcast as any).mockClear();

      await strategy.executeIteration();

      expect(mocks.positionManager.openPosition).toHaveBeenCalled();
      const calls = mocks.positionManager.openPosition.mock.calls;
      // All calls should be Long with mode "gridTrading"
      for (const call of calls) {
        expect(call[0]).toEqual(
          expect.objectContaining({
            mode: "gridTrading",
            pair: "SOL/USDC",
            side: "Long",
          }),
        );
      }

      await strategy.stop();
    });
  });

  // --- Close Long on price cross above next level up (AC 3) ---

  describe("closes Long when price crosses above next level up", () => {
    it("closes position when price rises above the next grid level", async () => {
      // Use a fixed position ID so we can track it
      let nextId = 100;
      mocks.positionManager.openPosition.mockImplementation(async (params: any) => ({
        id: nextId++,
        mode: params.mode,
        pair: params.pair,
        side: params.side,
        size: params.size / 1e6,
        entryPrice: 141,
        stopLoss: params.stopLossPrice / 1e6,
        timestamp: Date.now(),
      }));

      const strategy = createStrategy(mocks);
      await strategy.start();

      // First: open a position at the lowest level by setting price just below it
      // Lowest level = 140_000_000. Set price below it to trigger buy.
      mocks.oracleClient.getPrice.mockReturnValue(139_000_000);
      await strategy.executeIteration();

      // Get all opened position IDs
      const openedResults = await Promise.all(
        mocks.positionManager.openPosition.mock.results.map((r: any) => r.value),
      );
      const openedIds = openedResults.map((r: any) => r.id);

      // Mock getPositions to return all opened positions
      mocks.positionManager.getPositions.mockReturnValue(
        openedResults.map((r: any) => ({
          id: r.id,
          mode: "gridTrading",
          pair: "SOL/USDC",
          side: "Long",
          size: 100_000_000,
          entryPrice: 139,
          stopLoss: 137,
          timestamp: Date.now(),
        })),
      );

      // Now price rises well above — should trigger close for positions whose next level up is below price
      mocks.oracleClient.getPrice.mockReturnValue(165_000_000);
      await strategy.executeIteration();

      expect(mocks.positionManager.closePosition).toHaveBeenCalled();

      await strategy.stop();
    });
  });

  // --- Position sizing: allocation / gridLines (AC 4) ---

  describe("position sizing", () => {
    it("sizes each position as allocation / gridLines", async () => {
      // Allocation = $1000 = 1_000_000_000 smallest-unit, gridLines = 10 → $100 each
      mocks.oracleClient.getPrice.mockReturnValue(148_000_000); // below some levels

      const strategy = createStrategy(mocks);
      await strategy.start();
      await strategy.executeIteration();

      const calls = mocks.positionManager.openPosition.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        // 1_000_000_000 / 10 = 100_000_000
        expect(call[0].size).toBe(100_000_000);
      }

      await strategy.stop();
    });
  });

  // --- No duplicate at same level (AC 5) ---

  describe("no duplicate positions at same level", () => {
    it("does NOT open a duplicate when position exists at a grid level", async () => {
      mocks.oracleClient.getPrice.mockReturnValue(148_000_000);

      const strategy = createStrategy(mocks);
      await strategy.start();

      // First iteration — opens positions
      await strategy.executeIteration();
      const firstCallCount = mocks.positionManager.openPosition.mock.calls.length;
      expect(firstCallCount).toBeGreaterThan(0);

      // Mock getPositions to return opened positions
      const openedPositions = await Promise.all(
        mocks.positionManager.openPosition.mock.results.map(async (r: any) => {
          const pos = await r.value;
          return { id: pos.id, mode: "gridTrading", pair: "SOL/USDC", side: "Long" as const, size: 100_000_000, entryPrice: 148, stopLoss: 137, timestamp: Date.now() };
        }),
      );
      mocks.positionManager.getPositions.mockReturnValue(openedPositions);
      mocks.positionManager.openPosition.mockClear();

      // Second iteration — same price, should NOT open duplicates
      await strategy.executeIteration();
      expect(mocks.positionManager.openPosition).not.toHaveBeenCalled();

      await strategy.stop();
    });
  });

  // --- Stop-loss at lowerPrice * 0.98 (AC 6) ---

  describe("stop-loss", () => {
    it("sets stop-loss at lowerPrice * 0.98 when opening positions", async () => {
      mocks.oracleClient.getPrice.mockReturnValue(148_000_000);

      const strategy = createStrategy(mocks);
      await strategy.start();
      await strategy.executeIteration();

      const calls = mocks.positionManager.openPosition.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const expectedStopLoss = Math.floor(140_000_000 * 0.98);
      for (const call of calls) {
        expect(call[0].stopLossPrice).toBe(expectedStopLoss);
      }

      await strategy.stop();
    });
  });

  // --- Constructor rejects invalid config (AC 8, 9, 10) ---

  describe("constructor validation", () => {
    it("rejects upperPrice <= lowerPrice (AC 8)", () => {
      expect(
        () => createStrategy(mocks, { upperPrice: 140_000_000, lowerPrice: 160_000_000 }),
      ).toThrow("Invalid strategy configuration");
    });

    it("rejects upperPrice equal to lowerPrice (AC 8)", () => {
      expect(
        () => createStrategy(mocks, { upperPrice: 150_000_000, lowerPrice: 150_000_000 }),
      ).toThrow("Invalid strategy configuration");
    });

    it("rejects gridLines < 2 (AC 9)", () => {
      expect(
        () => createStrategy(mocks, { gridLines: 1 }),
      ).toThrow("Invalid strategy configuration");
    });

    it("rejects allocation < gridLines * $10 (AC 10)", () => {
      // Allocation = 50_000_000 ($50), gridLines = 10 → needs $100 min
      const smallMocks = createMocks(50_000_000);
      expect(
        () => createStrategy(smallMocks),
      ).toThrow("Invalid strategy configuration");
    });
  });

  // --- onStart/onStop lifecycle ---

  describe("lifecycle", () => {
    it("initializes grid state on start and clears on stop", async () => {
      const strategy = createStrategy(mocks);
      await strategy.start();

      // Grid state should be initialized (we can verify via an iteration)
      mocks.oracleClient.getPrice.mockReturnValue(155_000_000); // within range, no opens
      await strategy.executeIteration();

      // Broadcast should have been called (at least activity)
      expect(mocks.broadcast).toHaveBeenCalled();

      await strategy.stop();
    });
  });

  // --- Oracle unavailable ---

  describe("oracle unavailable", () => {
    it("skips iteration when oracle is unavailable", async () => {
      mocks.oracleClient.isAvailable.mockReturnValue(false);

      const strategy = createStrategy(mocks);
      await strategy.start();
      await strategy.executeIteration();

      expect(mocks.positionManager.openPosition).not.toHaveBeenCalled();

      await strategy.stop();
    });
  });

  // --- getIntervalMs ---

  describe("getIntervalMs", () => {
    it("returns default interval (30s) when not configured", () => {
      const strategy = createStrategy(mocks);
      expect(strategy.getIntervalMs()).toBe(30_000);
    });
  });
});
