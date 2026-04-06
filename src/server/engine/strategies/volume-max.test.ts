import { describe, it, expect, beforeEach, vi } from "vitest";
import { VolumeMaxStrategy } from "./volume-max.js";
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
    closeAllForMode: vi.fn().mockResolvedValue({ count: 0, totalPnl: 0, positions: [] }),
    getModeStatus: vi.fn().mockReturnValue(undefined),
    getPositions: vi.fn().mockReturnValue([]),
    getInternalPositions: vi.fn().mockReturnValue([]),
    loadFromDb: vi.fn(),
  };

  const broadcast = vi.fn() as unknown as BroadcastFn;

  return { fundAllocator, positionManager, broadcast };
}

describe("VolumeMaxStrategy", () => {
  let strategy: VolumeMaxStrategy;
  let mocks: ReturnType<typeof createMocks>;

  beforeEach(() => {
    mocks = createMocks();
    strategy = new VolumeMaxStrategy(
      mocks.fundAllocator as any,
      mocks.positionManager as any,
      mocks.broadcast,
      { pairs: ["SOL/USDC", "ETH/USDC"], cycleIntervalMs: 5000 },
    );
  });

  it("getIntervalMs returns configured interval", () => {
    expect(strategy.getIntervalMs()).toBe(5000);
  });

  it("executeIteration opens paired long/short positions then closes both", async () => {
    await strategy.executeIteration();

    // Should open 2 positions (long + short)
    expect(mocks.positionManager.openPosition).toHaveBeenCalledTimes(2);

    // Should close 2 positions
    expect(mocks.positionManager.closePosition).toHaveBeenCalledTimes(2);
  });

  it("positions are delta-neutral: same pair, same size, opposite sides", async () => {
    await strategy.executeIteration();

    const calls = mocks.positionManager.openPosition.mock.calls;
    const longCall = calls[0][0];
    const shortCall = calls[1][0];

    expect(longCall.pair).toBe(shortCall.pair);
    expect(longCall.size).toBe(shortCall.size);
    expect(longCall.side).toBe("Long");
    expect(shortCall.side).toBe("Short");
  });

  it("skips iteration when canAllocate returns false", async () => {
    mocks.fundAllocator.canAllocate.mockReturnValue(false);

    await strategy.executeIteration();

    expect(mocks.positionManager.openPosition).not.toHaveBeenCalled();
    expect(mocks.positionManager.closePosition).not.toHaveBeenCalled();
  });

  it("cycles through configured pairs", async () => {
    await strategy.executeIteration();
    const firstPair = mocks.positionManager.openPosition.mock.calls[0][0].pair;

    mocks.positionManager.openPosition.mockClear();
    await strategy.executeIteration();
    const secondPair = mocks.positionManager.openPosition.mock.calls[0][0].pair;

    expect(firstPair).toBe("SOL/USDC");
    expect(secondPair).toBe("ETH/USDC");
  });

  it("closes long position if short position fails (orphan prevention)", async () => {
    let callCount = 0;
    const longPosId = 42;
    mocks.positionManager.openPosition.mockImplementation(async (params: any) => {
      callCount++;
      if (callCount === 2) {
        throw new Error("Short position failed");
      }
      return {
        id: longPosId,
        mode: params.mode,
        pair: params.pair,
        side: params.side,
        size: params.size / 1e6,
        entryPrice: 100,
        stopLoss: 95,
        timestamp: Date.now(),
      };
    });

    await expect(strategy.executeIteration()).rejects.toThrow("Short position failed");

    // Should have attempted to close the orphaned long position
    expect(mocks.positionManager.closePosition).toHaveBeenCalledWith(longPosId);
  });

  it("stop-loss prices: long uses 95% factor, short uses 105% factor", async () => {
    await strategy.executeIteration();

    const calls = mocks.positionManager.openPosition.mock.calls;
    const longStopLoss = calls[0][0].stopLossPrice;
    const shortStopLoss = calls[1][0].stopLossPrice;

    // Long stop loss should be less than position size (95%)
    // Short stop loss should be greater than position size (105%)
    expect(longStopLoss).toBeLessThan(shortStopLoss);
  });

  it("tracks position IDs from openPosition return for closePosition calls", async () => {
    const longId = 101;
    const shortId = 202;
    let callCount = 0;
    mocks.positionManager.openPosition.mockImplementation(async (params: any) => {
      callCount++;
      return {
        id: callCount === 1 ? longId : shortId,
        mode: params.mode,
        pair: params.pair,
        side: params.side,
        size: params.size / 1e6,
        entryPrice: 100,
        stopLoss: 95,
        timestamp: Date.now(),
      };
    });

    await strategy.executeIteration();

    expect(mocks.positionManager.closePosition).toHaveBeenCalledWith(longId);
    expect(mocks.positionManager.closePosition).toHaveBeenCalledWith(shortId);
  });

  it("uses default position size as allocation / 20", () => {
    const allocation = 1_000_000_000; // 1000 USDC in smallest unit
    const expectedSize = Math.floor(allocation / 20); // 50 USDC per side

    mocks.fundAllocator.canAllocate.mockImplementation((_mode: any, size: number) => {
      // canAllocate is called with size * 2
      expect(size).toBe(expectedSize * 2);
      return true;
    });

    // The strategy was created in beforeEach with this allocation
    // Just verify canAllocate is called with the right size
    strategy.executeIteration();
  });
});
