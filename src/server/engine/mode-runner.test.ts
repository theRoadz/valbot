import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ModeType } from "../../shared/types.js";
import { EVENTS } from "../../shared/events.js";
import { ModeRunner, type BroadcastFn } from "./mode-runner.js";

const mockIsApiHealthy = vi.fn(() => true);
vi.mock("../blockchain/client.js", () => ({
  isApiHealthy: (...args: unknown[]) => mockIsApiHealthy(...args),
}));

// Concrete test subclass
class TestModeRunner extends ModeRunner {
  iterationFn = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  intervalMs = 1000;

  async executeIteration(): Promise<void> {
    await this.iterationFn();
  }

  getIntervalMs(): number {
    return this.intervalMs;
  }
}

function createMocks() {
  const fundAllocator = {
    getAllocation: vi.fn().mockReturnValue({ allocation: 1_000_000, remaining: 1_000_000 }),
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
    openPosition: vi.fn(),
    closePosition: vi.fn(),
    closeAllForMode: vi.fn().mockResolvedValue({ count: 0, totalPnl: 0, positions: [] }),
    getModeStatus: vi.fn().mockReturnValue(undefined),
    getPositions: vi.fn().mockReturnValue([]),
    getInternalPositions: vi.fn().mockReturnValue([]),
    loadFromDb: vi.fn(),
  };

  const broadcast = vi.fn() as unknown as BroadcastFn;

  return { fundAllocator, positionManager, broadcast };
}

describe("ModeRunner", () => {
  let runner: TestModeRunner;
  let mocks: ReturnType<typeof createMocks>;

  beforeEach(() => {
    vi.useFakeTimers();
    mocks = createMocks();
    runner = new TestModeRunner(
      "volumeMax" as ModeType,
      mocks.fundAllocator as any,
      mocks.positionManager as any,
      mocks.broadcast,
    );
  });

  it("start broadcasts MODE_STARTED and sets running = true", async () => {
    await runner.start();

    expect(runner.isRunning()).toBe(true);
    expect(mocks.broadcast).toHaveBeenCalledWith(EVENTS.MODE_STARTED, { mode: "volumeMax" });
  });

  it("start throws MODE_ALREADY_RUNNING if already running", async () => {
    await runner.start();

    try {
      await runner.start();
      expect.unreachable("Should have thrown");
    } catch (err: any) {
      expect(err.name).toBe("AppError");
      expect(err.code).toBe("MODE_ALREADY_RUNNING");
    }
  });

  it("start throws NO_ALLOCATION if allocation is zero", async () => {
    mocks.fundAllocator.getAllocation.mockReturnValue({ allocation: 0, remaining: 0 });

    try {
      await runner.start();
      expect.unreachable("Should have thrown");
    } catch (err: any) {
      expect(err.name).toBe("AppError");
      expect(err.code).toBe("NO_ALLOCATION");
    }
  });

  it("start throws MODE_KILL_SWITCHED if mode is in kill-switch state", async () => {
    mocks.positionManager.getModeStatus.mockReturnValue("kill-switch");

    try {
      await runner.start();
      expect.unreachable("Should have thrown");
    } catch (err: any) {
      expect(err.name).toBe("AppError");
      expect(err.code).toBe("MODE_KILL_SWITCHED");
    }
  });

  it("stop sets running = false, calls closeAllForMode, broadcasts MODE_STOPPED", async () => {
    await runner.start();
    // Let one iteration complete
    await vi.advanceTimersByTimeAsync(0);

    await runner.stop();

    expect(runner.isRunning()).toBe(false);
    expect(mocks.positionManager.closeAllForMode).toHaveBeenCalledWith("volumeMax");
    expect(mocks.broadcast).toHaveBeenCalledWith(EVENTS.MODE_STOPPED, {
      mode: "volumeMax",
      finalStats: mocks.fundAllocator.getStats(),
    });
  });

  it("stop is idempotent — calling stop when not running does nothing", async () => {
    await runner.stop();

    expect(mocks.positionManager.closeAllForMode).not.toHaveBeenCalled();
    expect(mocks.broadcast).not.toHaveBeenCalledWith(
      EVENTS.MODE_STOPPED,
      expect.anything(),
    );
  });

  it("loop continues on iteration error and broadcasts MODE_ERROR", async () => {
    const testError = new Error("iteration failed");
    runner.iterationFn
      .mockRejectedValueOnce(testError)
      .mockResolvedValue(undefined);

    await runner.start();

    // Let the first (failing) iteration run
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.broadcast).toHaveBeenCalledWith(EVENTS.MODE_ERROR, {
      mode: "volumeMax",
      error: {
        code: "STRATEGY_ITERATION_FAILED",
        message: "iteration failed",
        details: null,
      },
    });

    // Runner should still be running
    expect(runner.isRunning()).toBe(true);

    // Advance past interval to let second iteration run
    await vi.advanceTimersByTimeAsync(1000);

    // Second iteration should have been called
    expect(runner.iterationFn).toHaveBeenCalledTimes(2);

    await runner.stop();
  });

  it("loop stops when _running set to false via stop()", async () => {
    await runner.start();

    // Let first iteration complete
    await vi.advanceTimersByTimeAsync(0);
    expect(runner.iterationFn).toHaveBeenCalledTimes(1);

    await runner.stop();

    // Advance time — no more iterations should happen
    await vi.advanceTimersByTimeAsync(5000);
    expect(runner.iterationFn).toHaveBeenCalledTimes(1);
  });

  it("forceStop sets running to false and emits MODE_STOPPED without closing positions", async () => {
    await runner.start();
    // Let one iteration complete
    await vi.advanceTimersByTimeAsync(0);

    runner.forceStop();

    expect(runner.isRunning()).toBe(false);
    // Should NOT call closeAllForMode (positions already closed by kill-switch)
    expect(mocks.positionManager.closeAllForMode).not.toHaveBeenCalled();
    // Should broadcast MODE_STOPPED with finalStats
    expect(mocks.broadcast).toHaveBeenCalledWith(EVENTS.MODE_STOPPED, {
      mode: "volumeMax",
      finalStats: mocks.fundAllocator.getStats(),
    });
  });

  it("forceStop is idempotent — calling when not running does nothing", async () => {
    runner.forceStop();

    expect(runner.isRunning()).toBe(false);
    expect(mocks.broadcast).not.toHaveBeenCalledWith(
      EVENTS.MODE_STOPPED,
      expect.anything(),
    );
  });

  it("forceStop prevents further loop iterations", async () => {
    await runner.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(runner.iterationFn).toHaveBeenCalledTimes(1);

    runner.forceStop();

    // Advance time — no more iterations should happen
    await vi.advanceTimersByTimeAsync(5000);
    expect(runner.iterationFn).toHaveBeenCalledTimes(1);
  });

  it("skips iteration when isApiHealthy returns false", async () => {
    mockIsApiHealthy.mockReturnValue(false);

    await runner.start();
    // Let the loop tick — should skip iteration
    await vi.advanceTimersByTimeAsync(0);

    expect(runner.iterationFn).not.toHaveBeenCalled();
    expect(runner.isRunning()).toBe(true);

    await runner.stop();
  });

  it("proceeds with iteration when isApiHealthy returns true", async () => {
    mockIsApiHealthy.mockReturnValue(true);

    await runner.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(runner.iterationFn).toHaveBeenCalledTimes(1);

    await runner.stop();
  });

  it("resumes iteration after API recovers", async () => {
    mockIsApiHealthy.mockReturnValue(false);

    await runner.start();
    // First tick — skipped
    await vi.advanceTimersByTimeAsync(0);
    expect(runner.iterationFn).not.toHaveBeenCalled();

    // API recovers
    mockIsApiHealthy.mockReturnValue(true);

    // Next tick after 2s health-check poll — should proceed
    await vi.advanceTimersByTimeAsync(2000);
    expect(runner.iterationFn).toHaveBeenCalledTimes(1);

    await runner.stop();
  });
});
