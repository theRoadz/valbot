import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FundAllocator } from "./fund-allocator.js";
import { PositionManager } from "./position-manager.js";
import { getDb, closeDb, _resetDbState } from "../db/index.js";
import { positions as positionsTable, trades as tradesTable } from "../db/schema.js";
import { sql } from "drizzle-orm";
import path from "path";
import fs from "fs";

const TEST_DB_PATH = path.resolve(process.cwd(), "test-position-manager.db");

// Mock blockchain client
vi.mock("../blockchain/client.js", () => ({
  getBlockchainClient: () => ({
    exchange: null as never,
    info: null as never,
    walletAddress: "0x0000000000000000000000000000000000000000",
    agentAddress: "0x0000000000000000000000000000000000000001",
  }),
}));

// Mock contracts — default stubs, individual tests override via vi.mocked
vi.mock("../blockchain/contracts.js", () => ({
  openPosition: vi.fn().mockResolvedValue({
    txHash: "mock-tx-open",
    positionId: "pos-mock-1",
    entryPrice: 100_000_000,
  }),
  closePosition: vi.fn().mockResolvedValue({
    txHash: "mock-tx-close",
    exitPrice: 100_000_000,
    pnl: 0,
    fees: 10_000, // 0.1% of 10M
  }),
  setStopLoss: vi.fn().mockResolvedValue({
    txHash: "mock-tx-sl",
  }),
}));

// Import mocked modules for override access
import * as contracts from "../blockchain/contracts.js";

function setupTestDb() {
  process.env.VALBOT_DB_PATH = TEST_DB_PATH;
  _resetDbState();
  const db = getDb();
  db.run(sql`CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mode TEXT NOT NULL,
    pair TEXT NOT NULL,
    side TEXT NOT NULL CHECK(side IN ('Long', 'Short')),
    size INTEGER NOT NULL,
    price INTEGER NOT NULL,
    pnl INTEGER NOT NULL,
    fees INTEGER NOT NULL,
    timestamp INTEGER NOT NULL
  )`);
  db.run(sql`CREATE TABLE IF NOT EXISTS positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mode TEXT NOT NULL,
    pair TEXT NOT NULL,
    side TEXT NOT NULL CHECK(side IN ('Long', 'Short')),
    size INTEGER NOT NULL,
    entryPrice INTEGER NOT NULL,
    stopLoss INTEGER NOT NULL,
    timestamp INTEGER NOT NULL
  )`);
  db.run(sql`CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    startTime INTEGER NOT NULL,
    endTime INTEGER,
    mode TEXT NOT NULL,
    trades INTEGER NOT NULL DEFAULT 0,
    volume INTEGER NOT NULL DEFAULT 0,
    pnl INTEGER NOT NULL DEFAULT 0
  )`);
  db.run(sql`CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);
  // Clean tables between tests
  db.delete(positionsTable).run();
  db.delete(tradesTable).run();
  return db;
}

describe("PositionManager", () => {
  let allocator: FundAllocator;
  let pm: PositionManager;
  let mockBroadcast: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setupTestDb();
    allocator = new FundAllocator();
    mockBroadcast = vi.fn();
    pm = new PositionManager(allocator, mockBroadcast);

    // Reset contract mocks to defaults
    vi.mocked(contracts.openPosition).mockResolvedValue({
      txHash: "mock-tx-open",
      positionId: "pos-mock-1",
      entryPrice: 100_000_000,
    });
    vi.mocked(contracts.closePosition).mockResolvedValue({
      txHash: "mock-tx-close",
      exitPrice: 100_000_000,
      pnl: 0,
      fees: 10_000,
    });
    vi.mocked(contracts.setStopLoss).mockResolvedValue({
      txHash: "mock-tx-sl",
    });
  });

  afterEach(() => {
    closeDb();
    _resetDbState();
    vi.clearAllMocks();
    try { fs.unlinkSync(TEST_DB_PATH); } catch { /* ignore */ }
    try { fs.unlinkSync(TEST_DB_PATH + "-wal"); } catch { /* ignore */ }
    try { fs.unlinkSync(TEST_DB_PATH + "-shm"); } catch { /* ignore */ }
  });

  describe("openPosition", () => {
    it("reserves funds, calls contracts, sets stop-loss, inserts DB, broadcasts", async () => {
      allocator.setAllocation("volumeMax", 1_000_000_000);

      const pos = await pm.openPosition({
        mode: "volumeMax",
        pair: "SOL/USDC",
        side: "Long",
        size: 10_000_000,
        slippage: 0.5,
        stopLossPrice: 95_000_000,
      });

      // Funds reserved
      expect(allocator.getAllocation("volumeMax").remaining).toBe(990_000_000);

      // Contracts called
      expect(contracts.openPosition).toHaveBeenCalledOnce();
      expect(contracts.setStopLoss).toHaveBeenCalledOnce();

      // DB row exists
      const db = getDb();
      const rows = db.select().from(positionsTable).all();
      expect(rows).toHaveLength(1);
      expect(rows[0].mode).toBe("volumeMax");

      // Broadcast called with POSITION_OPENED
      expect(mockBroadcast).toHaveBeenCalledWith(
        "position.opened",
        expect.objectContaining({ mode: "volumeMax", pair: "SOL/USDC" }),
      );

      // Return value in display units
      expect(pos.size).toBe(10); // 10M / 1e6
      expect(pos.entryPrice).toBe(100); // 100M / 1e6
    });

    it("rolls back if setStopLoss fails — closes position and releases funds", async () => {
      allocator.setAllocation("volumeMax", 1_000_000_000);

      vi.mocked(contracts.setStopLoss).mockRejectedValueOnce(new Error("SL failed"));

      await expect(
        pm.openPosition({
          mode: "volumeMax",
          pair: "SOL/USDC",
          side: "Long",
          size: 10_000_000,
          slippage: 0.5,
          stopLossPrice: 95_000_000,
        }),
      ).rejects.toThrow();

      // Funds released
      expect(allocator.getAllocation("volumeMax").remaining).toBe(1_000_000_000);

      // Position was closed for rollback
      expect(contracts.closePosition).toHaveBeenCalledOnce();

      // No DB row
      const db = getDb();
      const rows = db.select().from(positionsTable).all();
      expect(rows).toHaveLength(0);
    });

    it("rolls back if openPosition fails — releases funds, no DB row", async () => {
      allocator.setAllocation("volumeMax", 1_000_000_000);

      vi.mocked(contracts.openPosition).mockRejectedValueOnce(new Error("TX failed"));

      await expect(
        pm.openPosition({
          mode: "volumeMax",
          pair: "SOL/USDC",
          side: "Long",
          size: 10_000_000,
          slippage: 0.5,
          stopLossPrice: 95_000_000,
        }),
      ).rejects.toThrow();

      // Funds released
      expect(allocator.getAllocation("volumeMax").remaining).toBe(1_000_000_000);

      // No DB row
      const db = getDb();
      expect(db.select().from(positionsTable).all()).toHaveLength(0);
    });
  });

  describe("closePosition", () => {
    it("throws and preserves position state when on-chain close fails", async () => {
      allocator.setAllocation("volumeMax", 1_000_000_000);
      const pos = await pm.openPosition({
        mode: "volumeMax",
        pair: "SOL/USDC",
        side: "Long",
        size: 10_000_000,
        slippage: 0.5,
        stopLossPrice: 95_000_000,
      });

      vi.mocked(contracts.closePosition).mockRejectedValueOnce(new Error("Chain unavailable"));

      await expect(pm.closePosition(pos.id)).rejects.toThrow();

      // Position still in memory and DB
      expect(pm.getPositions()).toHaveLength(1);
      const db = getDb();
      expect(db.select().from(positionsTable).all()).toHaveLength(1);

      // Funds still reserved
      expect(allocator.getAllocation("volumeMax").remaining).toBe(990_000_000);
    });

    it("calls contracts, writes trade, deletes position, releases funds, records stats, broadcasts", async () => {
      allocator.setAllocation("volumeMax", 1_000_000_000);
      const pos = await pm.openPosition({
        mode: "volumeMax",
        pair: "SOL/USDC",
        side: "Long",
        size: 10_000_000,
        slippage: 0.5,
        stopLossPrice: 95_000_000,
      });

      mockBroadcast.mockClear();

      const result = await pm.closePosition(pos.id);

      // Contract called
      expect(contracts.closePosition).toHaveBeenCalled();

      // Trade record written
      const db = getDb();
      const tradeRows = db.select().from(tradesTable).all();
      expect(tradeRows).toHaveLength(1);
      expect(tradeRows[0].mode).toBe("volumeMax");

      // Position deleted from DB
      const posRows = db.select().from(positionsTable).all();
      expect(posRows).toHaveLength(0);

      // Funds released (size + pnl - fees = 10M + 0 - 10K = 9.99M)
      // Allocation was 1B, reserved 10M (remaining 990M), released 9.99M back
      expect(allocator.getAllocation("volumeMax").remaining).toBe(999_990_000);

      // Trade stats recorded
      expect(allocator.getStats("volumeMax").trades).toBe(1);

      // Broadcasts: POSITION_CLOSED, TRADE_EXECUTED, STATS_UPDATED
      const events = mockBroadcast.mock.calls.map((c: unknown[]) => c[0]);
      expect(events).toContain("position.closed");
      expect(events).toContain("trade.executed");
      expect(events).toContain("stats.updated");

      // Return contains position in display units
      expect(result.position.mode).toBe("volumeMax");
    });
  });

  describe("kill-switch", () => {
    it("triggers closeAllForMode when cumulative loss threshold breached", async () => {
      allocator.setAllocation("volumeMax", 1_000_000_000);

      // Open two positions
      const pos1 = await pm.openPosition({
        mode: "volumeMax",
        pair: "SOL/USDC",
        side: "Long",
        size: 500_000_000,
        slippage: 0.5,
        stopLossPrice: 95_000_000,
      });
      const pos2 = await pm.openPosition({
        mode: "volumeMax",
        pair: "ETH/USDC",
        side: "Long",
        size: 200_000_000,
        slippage: 0.5,
        stopLossPrice: 90_000_000,
      });

      // Close pos1 with big loss: pnl = -150M, fees = 50K
      // returnedAmount = 500M + (-150M) - 50K = 349.95M
      // remaining after: 300M (from pos2 reserve) + 349.95M = 649.95M
      // 649.95M <= 1B * 0.9 = 900M → kill-switch triggers
      vi.mocked(contracts.closePosition).mockResolvedValueOnce({
        txHash: "mock-tx-loss",
        exitPrice: 70_000_000,
        pnl: -150_000_000,
        fees: 50_000,
      });

      // The second close (from closeAllForMode) returns break-even
      vi.mocked(contracts.closePosition).mockResolvedValueOnce({
        txHash: "mock-tx-close-all",
        exitPrice: 100_000_000,
        pnl: 0,
        fees: 20_000,
      });

      mockBroadcast.mockClear();

      await pm.closePosition(pos1.id);

      // Kill-switch should have triggered and closed pos2
      const remaining = pm.getPositions("volumeMax");
      expect(remaining).toHaveLength(0);

      // Alert broadcast
      const alertCalls = mockBroadcast.mock.calls.filter(
        (c: unknown[]) => c[0] === "alert.triggered",
      );
      expect(alertCalls.length).toBe(1);
      expect((alertCalls[0] as unknown[])[1]).toMatchObject({
        severity: "critical",
        code: "KILL_SWITCH_TRIGGERED",
      });
    });

    it("closeAllForMode does not re-trigger kill-switch (no infinite recursion)", async () => {
      allocator.setAllocation("volumeMax", 1_000_000_000);

      await pm.openPosition({
        mode: "volumeMax",
        pair: "SOL/USDC",
        side: "Long",
        size: 100_000_000,
        slippage: 0.5,
        stopLossPrice: 95_000_000,
      });
      await pm.openPosition({
        mode: "volumeMax",
        pair: "ETH/USDC",
        side: "Long",
        size: 100_000_000,
        slippage: 0.5,
        stopLossPrice: 90_000_000,
      });

      // Both closes will have big losses but skipKillSwitchCheck = true
      vi.mocked(contracts.closePosition).mockResolvedValue({
        txHash: "mock-tx-all",
        exitPrice: 50_000_000,
        pnl: -50_000_000,
        fees: 10_000,
      });

      const summary = await pm.closeAllForMode("volumeMax");
      expect(summary.count).toBe(2);
      expect(pm.getPositions("volumeMax")).toHaveLength(0);

      // No alert.triggered broadcast from individual closes (only from the caller)
      const alertCalls = mockBroadcast.mock.calls.filter(
        (c: unknown[]) => c[0] === "alert.triggered",
      );
      expect(alertCalls.length).toBe(0);
    });
  });

  describe("getPositions", () => {
    it("returns display-unit values", async () => {
      allocator.setAllocation("volumeMax", 1_000_000_000);
      await pm.openPosition({
        mode: "volumeMax",
        pair: "SOL/USDC",
        side: "Long",
        size: 10_000_000,
        slippage: 0.5,
        stopLossPrice: 95_000_000,
      });

      const positions = pm.getPositions();
      expect(positions).toHaveLength(1);
      expect(positions[0].size).toBe(10); // display unit
      expect(positions[0].entryPrice).toBe(100); // display unit
      expect(positions[0].stopLoss).toBe(95); // display unit
    });

    it("filters by mode", async () => {
      allocator.setAllocation("volumeMax", 1_000_000_000);
      allocator.setAllocation("profitHunter", 500_000_000);

      await pm.openPosition({
        mode: "volumeMax",
        pair: "SOL/USDC",
        side: "Long",
        size: 10_000_000,
        slippage: 0.5,
        stopLossPrice: 95_000_000,
      });
      await pm.openPosition({
        mode: "profitHunter",
        pair: "ETH/USDC",
        side: "Short",
        size: 5_000_000,
        slippage: 0.3,
        stopLossPrice: 105_000_000,
      });

      expect(pm.getPositions("volumeMax")).toHaveLength(1);
      expect(pm.getPositions("profitHunter")).toHaveLength(1);
      expect(pm.getPositions()).toHaveLength(2);
    });
  });

  describe("loadFromDb", () => {
    it("restores positions from DB", async () => {
      allocator.setAllocation("volumeMax", 1_000_000_000);
      await pm.openPosition({
        mode: "volumeMax",
        pair: "SOL/USDC",
        side: "Long",
        size: 10_000_000,
        slippage: 0.5,
        stopLossPrice: 95_000_000,
      });

      // Create new PM and load from DB
      const pm2 = new PositionManager(allocator, mockBroadcast);
      await pm2.loadFromDb();

      const positions = pm2.getPositions();
      expect(positions).toHaveLength(1);
      expect(positions[0].mode).toBe("volumeMax");
      expect(positions[0].pair).toBe("SOL/USDC");
    });
  });

  describe("getModeStatus", () => {
    it("returns undefined for modes that have not been kill-switched", () => {
      expect(pm.getModeStatus("volumeMax")).toBeUndefined();
    });

    it("returns kill-switch after kill-switch triggers", async () => {
      allocator.setAllocation("volumeMax", 1_000_000_000);

      const pos = await pm.openPosition({
        mode: "volumeMax",
        pair: "SOL/USDC",
        side: "Long",
        size: 500_000_000,
        slippage: 0.5,
        stopLossPrice: 95_000_000,
      });

      // Close with big loss to trigger kill-switch
      vi.mocked(contracts.closePosition).mockResolvedValueOnce({
        txHash: "mock-tx-loss",
        exitPrice: 70_000_000,
        pnl: -150_000_000,
        fees: 50_000,
      });

      await pm.closePosition(pos.id);

      expect(pm.getModeStatus("volumeMax")).toBe("kill-switch");
    });
  });

  describe("getInternalPositions", () => {
    it("returns raw positions with smallest-unit sizes for reconciliation", async () => {
      allocator.setAllocation("volumeMax", 1_000_000_000);
      await pm.openPosition({
        mode: "volumeMax",
        pair: "SOL/USDC",
        side: "Long",
        size: 10_000_000,
        slippage: 0.5,
        stopLossPrice: 95_000_000,
      });

      const internal = pm.getInternalPositions();
      expect(internal).toHaveLength(1);
      expect(internal[0].mode).toBe("volumeMax");
      expect(internal[0].size).toBe(10_000_000); // smallest-unit, not display
    });
  });
});
