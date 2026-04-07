import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { sql } from "drizzle-orm";
import path from "path";
import fs from "fs";
import { getDb, closeDb, _resetDbState } from "../db/index.js";
import { AppError } from "../lib/errors.js";

const TEST_DB_PATH = path.resolve(process.cwd(), "test-engine-index.db");

// Mock broadcaster
vi.mock("../ws/broadcaster.js", () => ({
  broadcast: vi.fn(),
}));

// Mock blockchain client (needed by position manager)
vi.mock("../blockchain/client.js", () => ({
  getBlockchainClient: vi.fn(() => null),
  getConnectionStatus: vi.fn().mockResolvedValue(null),
  isApiHealthy: vi.fn(() => true),
}));

// Mock oracle client
vi.mock("../blockchain/oracle.js", () => {
  class MockOracleClient {
    connect = vi.fn().mockResolvedValue(undefined);
    disconnect = vi.fn();
    isAvailable = vi.fn(() => false);
    getPrice = vi.fn(() => null);
    getMovingAverage = vi.fn(() => null);
    getFeedEntry = vi.fn(() => null);
    getRawData = vi.fn(() => null);
  }
  return { OracleClient: MockOracleClient };
});

// Mock contracts (needed by position manager)
vi.mock("../blockchain/contracts.js", () => ({
  openPosition: vi.fn().mockResolvedValue({
    txHash: "mock-tx-open",
    positionId: "pos-mock-1",
    entryPrice: 100_000_000,
    filledSz: "0.10",
  }),
  closePosition: vi.fn().mockResolvedValue({
    txHash: "mock-tx-close",
    exitPrice: 100_000_000,
    pnl: 0,
    fees: 10_000,
  }),
  setStopLoss: vi.fn().mockResolvedValue({
    txHash: "mock-tx-sl",
  }),
  initAssetIndices: vi.fn().mockResolvedValue(undefined),
  getMidPrice: vi.fn().mockResolvedValue(100.0),
}));

function setupTestDb() {
  process.env.VALBOT_DB_PATH = TEST_DB_PATH;
  _resetDbState();
  const db = getDb();
  db.run(sql`CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mode TEXT NOT NULL, pair TEXT NOT NULL, side TEXT NOT NULL,
    size INTEGER NOT NULL, price INTEGER NOT NULL, pnl INTEGER NOT NULL,
    fees INTEGER NOT NULL, timestamp INTEGER NOT NULL
  )`);
  db.run(sql`CREATE TABLE IF NOT EXISTS positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mode TEXT NOT NULL, pair TEXT NOT NULL, side TEXT NOT NULL,
    size INTEGER NOT NULL, entryPrice INTEGER NOT NULL, stopLoss INTEGER NOT NULL,
    timestamp INTEGER NOT NULL, chainPositionId TEXT, filledSz TEXT
  )`);
  db.run(sql`CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    startTime INTEGER NOT NULL, endTime INTEGER, mode TEXT NOT NULL,
    trades INTEGER NOT NULL DEFAULT 0, volume INTEGER NOT NULL DEFAULT 0, pnl INTEGER NOT NULL DEFAULT 0
  )`);
  db.run(sql`CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY, value TEXT NOT NULL
  )`);
}

/** Zero out all mode allocations to prevent cross-test total allocation conflicts */
function resetAllocations(fa: import("./fund-allocator.js").FundAllocator) {
  for (const mode of ["volumeMax", "profitHunter", "arbitrage"] as const) {
    try { fa.setAllocation(mode, 0); } catch { /* ignore if not yet initialized */ }
  }
}

describe("engine/index", () => {
  beforeEach(async () => {
    setupTestDb();
    // Reset allocations and mode status from previous tests
    try {
      const { getEngine, resetKillSwitch, getModeStatus, stopAllModes } = await import("./index.js");
      const { fundAllocator, positionManager } = getEngine();
      await stopAllModes();
      for (const mode of ["volumeMax", "profitHunter", "arbitrage"] as const) {
        // Clear kill-switch active flag and mode status
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (positionManager as any)._killSwitchActive.delete(mode);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (positionManager as any)._modeStatus.delete(mode);
      }
      resetAllocations(fundAllocator);
    } catch { /* engine not yet initialized — ok */ }
  });

  afterEach(() => {
    closeDb();
    _resetDbState();
    try { fs.unlinkSync(TEST_DB_PATH); } catch { /* ignore */ }
    try { fs.unlinkSync(TEST_DB_PATH + "-wal"); } catch { /* ignore */ }
    try { fs.unlinkSync(TEST_DB_PATH + "-shm"); } catch { /* ignore */ }
  });

  it("getEngine throws AppError when engine not initialized", async () => {
    // Must be the first test — engine module state is fresh
    const { getEngine } = await import("./index.js");
    expect(() => getEngine()).toThrow(AppError);
    expect(() => getEngine()).toThrow("Engine not initialized");
  });

  it("initEngine creates instances and getEngine returns them", async () => {
    const { initEngine, getEngine } = await import("./index.js");
    await initEngine();

    const engine = getEngine();
    expect(engine).toHaveProperty("fundAllocator");
    expect(engine).toHaveProperty("positionManager");
    expect(engine.fundAllocator).toBeDefined();
    expect(engine.positionManager).toBeDefined();
  });

  it("getModeStatus returns 'stopped' when no runner exists", async () => {
    const { initEngine, getModeStatus } = await import("./index.js");
    await initEngine();

    expect(getModeStatus("volumeMax")).toBe("stopped");
  });

  it("startMode creates runner and starts it", async () => {
    const { initEngine, getEngine, startMode, getModeStatus } = await import("./index.js");
    await initEngine();

    // Set allocation so start doesn't throw
    getEngine().fundAllocator.setAllocation("volumeMax", 400_000_000);

    await startMode("volumeMax", { pairs: ["SOL/USDC"] });
    expect(getModeStatus("volumeMax")).toBe("running");
  });

  it("stopMode stops runner and removes from map", async () => {
    const { initEngine, getEngine, startMode, stopMode, getModeStatus } = await import("./index.js");
    await initEngine();

    getEngine().fundAllocator.setAllocation("volumeMax", 400_000_000);
    await startMode("volumeMax", { pairs: ["SOL/USDC"] });
    await stopMode("volumeMax");

    expect(getModeStatus("volumeMax")).toBe("stopped");
  });

  it("stopMode is idempotent for non-running mode", async () => {
    const { initEngine, stopMode } = await import("./index.js");
    await initEngine();

    // Should not throw
    await stopMode("volumeMax");
  });

  it("startMode throws AppError for unsupported mode type", async () => {
    const { initEngine, startMode } = await import("./index.js");
    await initEngine();

    await expect(startMode("badMode" as any, { pairs: ["SOL/USDC"] }))
      .rejects.toThrow(AppError);
    await expect(startMode("badMode" as any, { pairs: ["SOL/USDC"] }))
      .rejects.toThrow("Unsupported mode type");
  });

  it("startMode throws AppError when mode is transitioning", async () => {
    const { initEngine, getEngine, startMode } = await import("./index.js");
    await initEngine();
    getEngine().fundAllocator.setAllocation("volumeMax", 400_000_000);

    // Start first — will lock the mode briefly
    const p1 = startMode("volumeMax", { pairs: ["SOL/USDC"] });
    // Immediately try again — mode is locked
    const p2 = startMode("volumeMax", { pairs: ["SOL/USDC"] });

    await expect(p2).rejects.toThrow(AppError);
    await expect(p1).resolves.toBeUndefined();
  });

  it("stopAllModes stops all running modes", async () => {
    const { initEngine, getEngine, startMode, stopAllModes, getModeStatus } = await import("./index.js");
    await initEngine();

    getEngine().fundAllocator.setAllocation("volumeMax", 400_000_000);
    await startMode("volumeMax", { pairs: ["SOL/USDC"] });

    await stopAllModes();
    expect(getModeStatus("volumeMax")).toBe("stopped");
  });

  it("getModeStatus returns 'kill-switch' when position-manager reports kill-switch", async () => {
    const { initEngine, getEngine, getModeStatus } = await import("./index.js");
    await initEngine();

    const { positionManager } = getEngine();
    // Simulate kill-switch state by directly setting mode status via internal method
    // We'll trigger it by manipulating the fund allocator to trigger a kill-switch
    // For simplicity, we check the pass-through works
    // First, it should be stopped
    expect(getModeStatus("volumeMax")).toBe("stopped");

    // Use internal state: set mode as kill-switched via the position manager
    // We need to trigger it naturally — set allocation, open, close with big loss
    // But blockchain client is mocked to null, so we test the status pass-through
    // by checking that when positionManager.getModeStatus returns "kill-switch",
    // engine.getModeStatus also returns "kill-switch"
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (positionManager as any)._modeStatus.set("volumeMax", "kill-switch");
    expect(getModeStatus("volumeMax")).toBe("kill-switch");
  });

  it("resetKillSwitch clears kill-switch state and zeros stats", async () => {
    const { initEngine, getEngine, getModeStatus, resetKillSwitch } = await import("./index.js");
    await initEngine();

    const { positionManager, fundAllocator } = getEngine();
    fundAllocator.setAllocation("volumeMax", 400_000_000);
    fundAllocator.recordTrade("volumeMax", 100_000_000, -50_000_000);

    // Set kill-switch state (ensure _killSwitchActive is clear — simulates completed close sweep)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (positionManager as any)._killSwitchActive.delete("volumeMax");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (positionManager as any)._modeStatus.set("volumeMax", "kill-switch");
    expect(getModeStatus("volumeMax")).toBe("kill-switch");

    resetKillSwitch("volumeMax");

    expect(getModeStatus("volumeMax")).toBe("stopped");
    expect(fundAllocator.getStats("volumeMax").trades).toBe(0);
    expect(fundAllocator.getStats("volumeMax").pnl).toBe(0);
    expect(fundAllocator.getStats("volumeMax").volume).toBe(0);
    // allocation preserved, remaining reset to match allocation
    expect(fundAllocator.getStats("volumeMax").allocated).toBe(400);
    expect(fundAllocator.getStats("volumeMax").remaining).toBe(400);
  });

  it("startMode throws when starting arbitrage with oracle unavailable", async () => {
    const { initEngine, startMode } = await import("./index.js");
    await initEngine();

    await expect(startMode("arbitrage", { pairs: ["SOL/USDC"] }))
      .rejects.toThrow(AppError);
    await expect(startMode("arbitrage", { pairs: ["SOL/USDC"] }))
      .rejects.toThrow("requires live oracle price data");
  });

  it("startMode throws arbitrageNoBlockchainClientError when blockchain client unavailable", async () => {
    const { initEngine, getEngine, startMode, getOracleClient } = await import("./index.js");
    await initEngine();

    getEngine().fundAllocator.setAllocation("arbitrage", 400_000_000);

    // Make oracle available but blockchain client is already mocked to null
    const oracle = getOracleClient()!;
    (oracle.isAvailable as any).mockReturnValue(true);

    await expect(startMode("arbitrage", { pairs: ["SOL/USDC"] }))
      .rejects.toThrow(AppError);
    await expect(startMode("arbitrage", { pairs: ["SOL/USDC"] }))
      .rejects.toThrow("Hyperliquid connectivity");
  });

  it("startMode throws oracleFeedUnavailableError when starting profitHunter with oracle unavailable", async () => {
    const { initEngine, startMode, getOracleClient } = await import("./index.js");
    await initEngine();

    // Ensure oracle is unavailable (may have been changed by prior tests)
    const oracle = getOracleClient()!;
    (oracle.isAvailable as any).mockReturnValue(false);

    await expect(startMode("profitHunter", { pairs: ["SOL-PERP"] }))
      .rejects.toThrow(AppError);
    await expect(startMode("profitHunter", { pairs: ["SOL-PERP"] }))
      .rejects.toThrow("requires live oracle price data");
  });

  it("startMode creates ProfitHunterStrategy when oracle is available", async () => {
    const { initEngine, getEngine, startMode, getOracleClient, getModeStatus, stopMode } = await import("./index.js");
    await initEngine();

    getEngine().fundAllocator.setAllocation("profitHunter", 400_000_000);

    // Make oracle available for profitHunter start
    const oracle = getOracleClient()!;
    (oracle.isAvailable as any).mockReturnValue(true);

    await startMode("profitHunter", { pairs: ["SOL/USDC"] });
    expect(getModeStatus("profitHunter")).toBe("running");

    await stopMode("profitHunter");
    expect(getModeStatus("profitHunter")).toBe("stopped");
  });

  // === Task 1: Parallel mode start/stop validation (Story 4-4) ===

  it("startMode allows starting a second mode while first is running (1.1)", async () => {
    const { initEngine, getEngine, startMode, getModeStatus, stopMode } = await import("./index.js");
    await initEngine();

    const { fundAllocator } = getEngine();
    fundAllocator.setAllocation("volumeMax", 200_000_000);
    fundAllocator.setAllocation("profitHunter", 200_000_000);

    // Make oracle available for profitHunter
    const { getOracleClient } = await import("./index.js");
    const oracle = getOracleClient()!;
    (oracle.isAvailable as any).mockReturnValue(true);

    await startMode("volumeMax", { pairs: ["SOL/USDC"] });
    expect(getModeStatus("volumeMax")).toBe("running");

    await startMode("profitHunter", { pairs: ["SOL/USDC"] });
    expect(getModeStatus("profitHunter")).toBe("running");

    // Both should be running simultaneously
    expect(getModeStatus("volumeMax")).toBe("running");
    expect(getModeStatus("profitHunter")).toBe("running");

    await stopMode("volumeMax");
    await stopMode("profitHunter");
  });

  it("stopMode only stops the targeted mode, others continue (1.2)", async () => {
    const { initEngine, getEngine, startMode, stopMode, getModeStatus, getOracleClient } = await import("./index.js");
    await initEngine();

    const { fundAllocator } = getEngine();
    fundAllocator.setAllocation("volumeMax", 200_000_000);
    fundAllocator.setAllocation("profitHunter", 200_000_000);

    const oracle = getOracleClient()!;
    (oracle.isAvailable as any).mockReturnValue(true);

    await startMode("volumeMax", { pairs: ["SOL/USDC"] });
    await startMode("profitHunter", { pairs: ["SOL/USDC"] });

    // Stop only volumeMax
    await stopMode("volumeMax");

    expect(getModeStatus("volumeMax")).toBe("stopped");
    expect(getModeStatus("profitHunter")).toBe("running");

    await stopMode("profitHunter");
  });

  it("stopAllModes with Promise.allSettled handles mixed success/failure (1.3)", async () => {
    const { initEngine, getEngine, startMode, stopAllModes, getModeStatus, getOracleClient } = await import("./index.js");
    await initEngine();

    const { fundAllocator } = getEngine();
    fundAllocator.setAllocation("volumeMax", 200_000_000);
    fundAllocator.setAllocation("profitHunter", 200_000_000);

    const oracle = getOracleClient()!;
    (oracle.isAvailable as any).mockReturnValue(true);

    await startMode("volumeMax", { pairs: ["SOL/USDC"] });
    await startMode("profitHunter", { pairs: ["SOL/USDC"] });

    expect(getModeStatus("volumeMax")).toBe("running");
    expect(getModeStatus("profitHunter")).toBe("running");

    await stopAllModes();

    expect(getModeStatus("volumeMax")).toBe("stopped");
    expect(getModeStatus("profitHunter")).toBe("stopped");
  });

  it("mode lock prevents concurrent start/stop on same mode while allowing different modes (1.4)", async () => {
    const { initEngine, getEngine, startMode, getOracleClient } = await import("./index.js");
    await initEngine();

    const { fundAllocator } = getEngine();
    fundAllocator.setAllocation("volumeMax", 200_000_000);
    fundAllocator.setAllocation("profitHunter", 200_000_000);

    const oracle = getOracleClient()!;
    (oracle.isAvailable as any).mockReturnValue(true);

    // Start volumeMax — lock kicks in during start
    const p1 = startMode("volumeMax", { pairs: ["SOL/USDC"] });
    // Concurrent start of same mode should throw
    const p2 = startMode("volumeMax", { pairs: ["SOL/USDC"] });
    // But different mode should succeed concurrently
    const p3 = startMode("profitHunter", { pairs: ["SOL/USDC"] });

    await expect(p2).rejects.toThrow("transitioning");
    await expect(p1).resolves.toBeUndefined();
    await expect(p3).resolves.toBeUndefined();

    const { stopAllModes } = await import("./index.js");
    await stopAllModes();
  });

  it("kill-switch on one mode does NOT affect other running modes (1.5)", async () => {
    const { initEngine, getEngine, getModeStatus, startMode, getOracleClient, stopAllModes } = await import("./index.js");
    await initEngine();

    const { fundAllocator, positionManager } = getEngine();
    fundAllocator.setAllocation("volumeMax", 200_000_000);
    fundAllocator.setAllocation("profitHunter", 200_000_000);

    const oracle = getOracleClient()!;
    (oracle.isAvailable as any).mockReturnValue(true);

    await startMode("volumeMax", { pairs: ["SOL/USDC"] });
    await startMode("profitHunter", { pairs: ["SOL/USDC"] });

    // Simulate kill-switch on volumeMax
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (positionManager as any)._modeStatus.set("volumeMax", "kill-switch");

    expect(getModeStatus("volumeMax")).toBe("kill-switch");
    // profitHunter should be completely unaffected
    expect(getModeStatus("profitHunter")).toBe("running");

    await stopAllModes();
  });

  // === Task 8: Full parallel scenario integration tests (Story 4-4) ===

  it("start volumeMax → start profitHunter → both running → stop volumeMax → profitHunter still running (8.1)", async () => {
    const { initEngine, getEngine, startMode, stopMode, getModeStatus, getOracleClient, stopAllModes } = await import("./index.js");
    await initEngine();

    const { fundAllocator } = getEngine();
    fundAllocator.setAllocation("volumeMax", 200_000_000);
    fundAllocator.setAllocation("profitHunter", 200_000_000);

    const oracle = getOracleClient()!;
    (oracle.isAvailable as any).mockReturnValue(true);

    // Step 1: Start volumeMax
    await startMode("volumeMax", { pairs: ["SOL/USDC"] });
    expect(getModeStatus("volumeMax")).toBe("running");

    // Step 2: Start profitHunter alongside
    await startMode("profitHunter", { pairs: ["SOL/USDC"] });
    expect(getModeStatus("volumeMax")).toBe("running");
    expect(getModeStatus("profitHunter")).toBe("running");

    // Step 3: Stop volumeMax only
    await stopMode("volumeMax");
    expect(getModeStatus("volumeMax")).toBe("stopped");
    expect(getModeStatus("profitHunter")).toBe("running");

    await stopAllModes();
  });

  it("all three modes started → one hits kill-switch → other two continue unaffected (8.2)", async () => {
    const { initEngine, getEngine, startMode, getModeStatus, getOracleClient, stopAllModes } = await import("./index.js");
    await initEngine();

    const { fundAllocator, positionManager } = getEngine();
    fundAllocator.setAllocation("volumeMax", 150_000_000);
    fundAllocator.setAllocation("profitHunter", 150_000_000);
    fundAllocator.setAllocation("arbitrage", 150_000_000);

    const oracle = getOracleClient()!;
    (oracle.isAvailable as any).mockReturnValue(true);
    const { getBlockchainClient } = await import("../blockchain/client.js");
    (getBlockchainClient as any).mockReturnValue({ exchange: {}, info: {} });

    await startMode("volumeMax", { pairs: ["SOL/USDC"] });
    await startMode("profitHunter", { pairs: ["SOL/USDC"] });
    await startMode("arbitrage", { pairs: ["SOL/USDC"] });

    expect(getModeStatus("volumeMax")).toBe("running");
    expect(getModeStatus("profitHunter")).toBe("running");
    expect(getModeStatus("arbitrage")).toBe("running");

    // Simulate error on arbitrage via kill-switch (since we can't easily trigger a strategy error)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (positionManager as any)._modeStatus.set("arbitrage", "kill-switch");

    expect(getModeStatus("arbitrage")).toBe("kill-switch");
    expect(getModeStatus("volumeMax")).toBe("running");
    expect(getModeStatus("profitHunter")).toBe("running");

    // Reset blockchain client mock to prevent side effects
    (getBlockchainClient as any).mockReturnValue(null);
    await stopAllModes();
  });

  it("all three modes → stopAllModes → all stopped (8.3)", async () => {
    const { initEngine, getEngine, startMode, stopAllModes, getModeStatus, getOracleClient } = await import("./index.js");
    await initEngine();

    const { fundAllocator } = getEngine();
    fundAllocator.setAllocation("volumeMax", 150_000_000);
    fundAllocator.setAllocation("profitHunter", 150_000_000);
    fundAllocator.setAllocation("arbitrage", 150_000_000);

    const oracle = getOracleClient()!;
    (oracle.isAvailable as any).mockReturnValue(true);
    const { getBlockchainClient } = await import("../blockchain/client.js");
    (getBlockchainClient as any).mockReturnValue({ exchange: {}, info: {} });

    await startMode("volumeMax", { pairs: ["SOL/USDC"] });
    await startMode("profitHunter", { pairs: ["SOL/USDC"] });
    await startMode("arbitrage", { pairs: ["SOL/USDC"] });

    expect(getModeStatus("volumeMax")).toBe("running");
    expect(getModeStatus("profitHunter")).toBe("running");
    expect(getModeStatus("arbitrage")).toBe("running");

    await stopAllModes();

    expect(getModeStatus("volumeMax")).toBe("stopped");
    expect(getModeStatus("profitHunter")).toBe("stopped");
    expect(getModeStatus("arbitrage")).toBe("stopped");

    (getBlockchainClient as any).mockReturnValue(null);
  });

  it("mode start fails (oracle unavailable) while other modes running — no disruption (8.4)", async () => {
    const { initEngine, getEngine, startMode, getModeStatus, getOracleClient, stopAllModes } = await import("./index.js");
    await initEngine();

    const { fundAllocator } = getEngine();
    fundAllocator.setAllocation("volumeMax", 250_000_000);
    fundAllocator.setAllocation("profitHunter", 250_000_000);

    // Start volumeMax (no oracle needed)
    await startMode("volumeMax", { pairs: ["SOL/USDC"] });
    expect(getModeStatus("volumeMax")).toBe("running");

    // Try to start profitHunter with oracle unavailable
    const oracle = getOracleClient()!;
    (oracle.isAvailable as any).mockReturnValue(false);

    await expect(startMode("profitHunter", { pairs: ["SOL/USDC"] }))
      .rejects.toThrow("requires live oracle price data");

    // volumeMax should be unaffected by profitHunter's failure
    expect(getModeStatus("volumeMax")).toBe("running");
    expect(getModeStatus("profitHunter")).toBe("stopped");

    await stopAllModes();
  });

  describe("session tracking integration", () => {
    it("creates a session on startMode and finalizes on stopMode", async () => {
      const { initEngine, startMode, stopMode, getEngine } = await import("./index.js");
      const { sessions } = await import("../db/schema.js");
      await initEngine();
      const engine = getEngine();
      engine.fundAllocator.setAllocation("volumeMax", 100_000_000);

      await startMode("volumeMax", { pairs: ["SOL/USDC"] });

      // Session should exist with endTime null
      const db = getDb();
      let rows = db.select().from(sessions).all();
      const activeSession = rows.find((r) => r.mode === "volumeMax" && r.endTime === null);
      expect(activeSession).toBeDefined();
      expect(activeSession!.trades).toBe(0);

      await stopMode("volumeMax");

      // Session should be finalized (endTime set)
      rows = db.select().from(sessions).all();
      const finalized = rows.find((r) => r.id === activeSession!.id);
      expect(finalized).toBeDefined();
      expect(finalized!.endTime).not.toBeNull();
      expect(finalized!.endTime).toBeGreaterThan(0);
    });

    it("finalizes all active sessions on stopAllModes", async () => {
      const { initEngine, startMode, stopAllModes, getEngine } = await import("./index.js");
      const { sessions } = await import("../db/schema.js");
      await initEngine();
      const engine = getEngine();
      engine.fundAllocator.setAllocation("volumeMax", 100_000_000);

      // Only start volumeMax — profitHunter requires oracle which is mocked unavailable
      await startMode("volumeMax", { pairs: ["SOL/USDC"] });

      const db = getDb();
      let activeSessions = db.select().from(sessions).all().filter((r) => r.endTime === null);
      expect(activeSessions.length).toBeGreaterThanOrEqual(1);

      await stopAllModes();

      activeSessions = db.select().from(sessions).all().filter((r) => r.endTime === null);
      expect(activeSessions).toHaveLength(0);
    });

    it("finalizes orphaned sessions via SessionManager directly", async () => {
      const { sessions } = await import("../db/schema.js");
      const { SessionManager } = await import("./session-manager.js");
      // Insert orphaned session directly into DB
      const db = getDb();
      db.insert(sessions).values({
        startTime: Date.now() - 60000,
        mode: "volumeMax",
        trades: 5,
        volume: 500_000_000,
        pnl: 10_000_000,
      }).run();

      // Verify orphaned session exists
      let orphans = db.select().from(sessions).all().filter((r) => r.endTime === null);
      expect(orphans).toHaveLength(1);

      // SessionManager.finalizeOrphanedSessions should finalize it
      const sm = new SessionManager();
      const count = sm.finalizeOrphanedSessions();
      expect(count).toBe(1);

      orphans = db.select().from(sessions).all().filter((r) => r.endTime === null);
      expect(orphans).toHaveLength(0);
    });
  });
});
