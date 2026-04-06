import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FundAllocator } from "./fund-allocator.js";
import { PositionManager } from "./position-manager.js";
import { getDb, closeDb, _resetDbState } from "../db/index.js";
import { positions as positionsTable, trades as tradesTable } from "../db/schema.js";
import { sql } from "drizzle-orm";
import path from "path";
import fs from "fs";
import { AppError } from "../lib/errors.js";

const TEST_DB_PATH = path.resolve(process.cwd(), "test-position-manager.db");

// Mock blockchain client
vi.mock("../blockchain/client.js", () => ({
  getBlockchainClient: vi.fn(() => ({
    exchange: null as never,
    info: null as never,
    walletAddress: "0x0000000000000000000000000000000000000000",
    agentAddress: "0x0000000000000000000000000000000000000001",
  })),
}));

// Mock contracts — default stubs, individual tests override via vi.mocked
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
    fees: 10_000, // 0.1% of 10M
  }),
  setStopLoss: vi.fn().mockResolvedValue({
    txHash: "mock-tx-sl",
  }),
}));

// Import mocked modules for override access
import * as contracts from "../blockchain/contracts.js";
import { getBlockchainClient } from "../blockchain/client.js";

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
    timestamp INTEGER NOT NULL,
    chainPositionId TEXT,
    filledSz TEXT
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
      filledSz: "0.10",
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
      allocator.setAllocation("volumeMax", 400_000_000);

      const pos = await pm.openPosition({
        mode: "volumeMax",
        pair: "SOL/USDC",
        side: "Long",
        size: 10_000_000,
        slippage: 0.5,
        stopLossPrice: 95_000_000,
      });

      // Funds reserved
      expect(allocator.getAllocation("volumeMax").remaining).toBe(390_000_000);

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
      allocator.setAllocation("volumeMax", 400_000_000);

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
      expect(allocator.getAllocation("volumeMax").remaining).toBe(400_000_000);

      // Position was closed for rollback
      expect(contracts.closePosition).toHaveBeenCalledOnce();

      // No DB row
      const db = getDb();
      const rows = db.select().from(positionsTable).all();
      expect(rows).toHaveLength(0);
    });

    it("rolls back if openPosition fails — releases funds, no DB row", async () => {
      allocator.setAllocation("volumeMax", 400_000_000);

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
      expect(allocator.getAllocation("volumeMax").remaining).toBe(400_000_000);

      // No DB row
      const db = getDb();
      expect(db.select().from(positionsTable).all()).toHaveLength(0);
    });
  });

  describe("closePosition", () => {
    it("throws and preserves position state when on-chain close fails", async () => {
      allocator.setAllocation("volumeMax", 400_000_000);
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
      expect(allocator.getAllocation("volumeMax").remaining).toBe(390_000_000);
    });

    it("calls contracts, writes trade, deletes position, releases funds, records stats, broadcasts", async () => {
      allocator.setAllocation("volumeMax", 400_000_000);
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
      // Allocation was 400M, reserved 10M (remaining 390M), released 9.99M back
      expect(allocator.getAllocation("volumeMax").remaining).toBe(399_990_000);

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
      allocator.setAllocation("volumeMax", 400_000_000);

      // Open two positions
      const pos1 = await pm.openPosition({
        mode: "volumeMax",
        pair: "SOL/USDC",
        side: "Long",
        size: 200_000_000,
        slippage: 0.5,
        stopLossPrice: 95_000_000,
      });
      const pos2 = await pm.openPosition({
        mode: "volumeMax",
        pair: "ETH/USDC",
        side: "Long",
        size: 100_000_000,
        slippage: 0.5,
        stopLossPrice: 90_000_000,
      });

      // Close pos1 with big loss: pnl = -150M, fees = 50K
      // returnedAmount = 200M + (-150M) - 50K = 49.95M
      // remaining after: 100M (from pos2 reserve) + 49.95M = 149.95M
      // 149.95M <= 400M * 0.9 = 360M → kill-switch triggers
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
      allocator.setAllocation("volumeMax", 400_000_000);

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
      allocator.setAllocation("volumeMax", 400_000_000);
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
      allocator.setAllocation("volumeMax", 400_000_000);
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
      allocator.setAllocation("volumeMax", 400_000_000);
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
      allocator.setAllocation("volumeMax", 400_000_000);

      const pos = await pm.openPosition({
        mode: "volumeMax",
        pair: "SOL/USDC",
        side: "Long",
        size: 200_000_000,
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

  describe("openPosition kill-switch guard", () => {
    it("throws MODE_KILL_SWITCHED when _killSwitchActive contains the mode", async () => {
      allocator.setAllocation("volumeMax", 400_000_000);

      // Open a position and trigger kill-switch to set _killSwitchActive
      const pos = await pm.openPosition({
        mode: "volumeMax",
        pair: "SOL/USDC",
        side: "Long",
        size: 200_000_000,
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

      // Try to open — should be rejected
      await expect(
        pm.openPosition({
          mode: "volumeMax",
          pair: "ETH/USDC",
          side: "Long",
          size: 10_000_000,
          slippage: 0.5,
          stopLossPrice: 90_000_000,
        }),
      ).rejects.toThrow("kill-switch state");
    });
  });

  describe("onKillSwitch callback", () => {
    it("invokes onKillSwitch callback when kill-switch triggers", async () => {
      const onKillSwitch = vi.fn();
      const pmWithCallback = new PositionManager(allocator, mockBroadcast, onKillSwitch);

      allocator.setAllocation("volumeMax", 400_000_000);

      const pos = await pmWithCallback.openPosition({
        mode: "volumeMax",
        pair: "SOL/USDC",
        side: "Long",
        size: 200_000_000,
        slippage: 0.5,
        stopLossPrice: 95_000_000,
      });

      vi.mocked(contracts.closePosition).mockResolvedValueOnce({
        txHash: "mock-tx-loss",
        exitPrice: 70_000_000,
        pnl: -150_000_000,
        fees: 50_000,
      });

      await pmWithCallback.closePosition(pos.id);

      expect(onKillSwitch).toHaveBeenCalledWith("volumeMax");
    });
  });

  describe("alert details", () => {
    it("alert includes per-position breakdown", async () => {
      allocator.setAllocation("volumeMax", 400_000_000);

      const pos1 = await pm.openPosition({
        mode: "volumeMax",
        pair: "SOL/USDC",
        side: "Long",
        size: 200_000_000,
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

      vi.mocked(contracts.closePosition).mockResolvedValueOnce({
        txHash: "mock-tx-loss",
        exitPrice: 70_000_000,
        pnl: -150_000_000,
        fees: 50_000,
      });
      vi.mocked(contracts.closePosition).mockResolvedValueOnce({
        txHash: "mock-tx-close-all",
        exitPrice: 100_000_000,
        pnl: 0,
        fees: 20_000,
      });

      mockBroadcast.mockClear();
      await pm.closePosition(pos1.id);

      const alertCalls = mockBroadcast.mock.calls.filter(
        (c: unknown[]) => c[0] === "alert.triggered",
      );
      expect(alertCalls.length).toBe(1);
      const payload = (alertCalls[0] as unknown[])[1] as {
        details: string;
        positionsClosed: number;
        lossAmount: number;
      };
      // Should include both the triggering position (SOL/USDC) and the swept position (ETH/USDC)
      expect(payload.details).toContain("SOL/USDC");
      expect(payload.details).toContain("ETH/USDC");
      expect(payload.details).toContain("Long");
      // Should show exit prices (entry → exit format)
      expect(payload.details).toContain("→");
      // Total closed = triggering position + swept positions
      expect(payload.positionsClosed).toBe(2);
      expect(payload.details).toContain("Closed 2 positions");
      // lossAmount should be a number
      expect(typeof payload.lossAmount).toBe("number");
    });
  });

  describe("resetModeStatus", () => {
    it("clears kill-switch state allowing mode to restart", async () => {
      allocator.setAllocation("volumeMax", 400_000_000);

      const pos = await pm.openPosition({
        mode: "volumeMax",
        pair: "SOL/USDC",
        side: "Long",
        size: 200_000_000,
        slippage: 0.5,
        stopLossPrice: 95_000_000,
      });

      vi.mocked(contracts.closePosition).mockResolvedValueOnce({
        txHash: "mock-tx-loss",
        exitPrice: 70_000_000,
        pnl: -150_000_000,
        fees: 50_000,
      });

      await pm.closePosition(pos.id);
      expect(pm.getModeStatus("volumeMax")).toBe("kill-switch");

      pm.resetModeStatus("volumeMax");
      expect(pm.getModeStatus("volumeMax")).toBeUndefined();
    });
  });

  describe("getInternalPositions", () => {
    it("returns raw positions with smallest-unit sizes for reconciliation", async () => {
      allocator.setAllocation("volumeMax", 400_000_000);
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

  describe("chainPositionId persistence", () => {
    it("persisted position includes chainPositionId from open result", async () => {
      allocator.setAllocation("volumeMax", 400_000_000);

      vi.mocked(contracts.openPosition).mockResolvedValueOnce({
        txHash: "mock-tx-open",
        positionId: "BTC-Long",
        entryPrice: 100_000_000,
        filledSz: "0.10",
      });

      await pm.openPosition({
        mode: "volumeMax",
        pair: "BTC/USDC",
        side: "Long",
        size: 10_000_000,
        slippage: 0.5,
        stopLossPrice: 95_000_000,
      });

      const db = getDb();
      const rows = db.select().from(positionsTable).all();
      expect(rows).toHaveLength(1);
      expect(rows[0].chainPositionId).toBe("BTC-Long");
    });

    it("loadFromDb uses persisted chainPositionId when available, falls back to placeholder when null", async () => {
      const db = getDb();

      // Insert row WITH chainPositionId
      db.insert(positionsTable).values({
        mode: "volumeMax",
        pair: "BTC/USDC",
        side: "Long",
        size: 10_000_000,
        entryPrice: 100_000_000,
        stopLoss: 95_000_000,
        timestamp: Date.now(),
        chainPositionId: "BTC-Long",
      }).run();

      // Insert row WITHOUT chainPositionId (pre-migration)
      db.insert(positionsTable).values({
        mode: "volumeMax",
        pair: "ETH/USDC",
        side: "Short",
        size: 5_000_000,
        entryPrice: 50_000_000,
        stopLoss: 55_000_000,
        timestamp: Date.now(),
      }).run();

      const pm2 = new PositionManager(allocator, mockBroadcast);
      await pm2.loadFromDb();

      const positions = pm2.getPositions();
      expect(positions).toHaveLength(2);
      // Both loaded — the actual chainPositionId is internal, we just verify they loaded
      expect(positions.some((p) => p.pair === "BTC/USDC")).toBe(true);
      expect(positions.some((p) => p.pair === "ETH/USDC")).toBe(true);
    });
  });

  describe("closeAllPositions", () => {
    it("closes positions across multiple modes", async () => {
      allocator.setAllocation("volumeMax", 400_000_000);
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

      expect(pm.getPositions()).toHaveLength(2);

      await pm.closeAllPositions();

      expect(pm.getPositions()).toHaveLength(0);
    });

    it("sets _shuttingDown flag preventing new positions", async () => {
      allocator.setAllocation("volumeMax", 400_000_000);

      await pm.closeAllPositions();

      await expect(
        pm.openPosition({
          mode: "volumeMax",
          pair: "SOL/USDC",
          side: "Long",
          size: 10_000_000,
          slippage: 0.5,
          stopLossPrice: 95_000_000,
        }),
      ).rejects.toThrow("Cannot open position — shutdown in progress");
    });
  });

  describe("reconcileOnChainPositions", () => {
    it("matches on-chain position and updates chainPositionId + size", async () => {
      const db = getDb();
      // Insert a recovered position
      db.insert(positionsTable).values({
        mode: "volumeMax",
        pair: "BTC/USDC",
        side: "Long",
        size: 10_000_000,
        entryPrice: 100_000_000,
        stopLoss: 95_000_000,
        timestamp: Date.now(),
      }).run();

      const pm2 = new PositionManager(allocator, mockBroadcast);
      await pm2.loadFromDb();

      // Mock blockchain client to return matching on-chain position
      vi.mocked(getBlockchainClient).mockReturnValue({
        exchange: null as never,
        info: {
          clearinghouseState: vi.fn().mockResolvedValue({
            assetPositions: [{
              position: { coin: "BTC", szi: "0.1", entryPx: "100" },
            }],
          }),
        } as never,
        walletAddress: "0x0000000000000000000000000000000000000000",
        agentAddress: "0x0000000000000000000000000000000000000001",
      });

      // Mock closePosition to succeed
      vi.mocked(contracts.closePosition).mockResolvedValueOnce({
        txHash: "mock-tx-recovery",
        exitPrice: 100_000_000,
        pnl: 0,
        fees: 10_000,
      });

      allocator.setAllocation("volumeMax", 400_000_000);

      await pm2.reconcileOnChainPositions("0x0000000000000000000000000000000000000000");

      // Position should have been closed
      expect(pm2.getPositions()).toHaveLength(0);

      // Should broadcast recovery summary
      const alertCalls = mockBroadcast.mock.calls.filter(
        (c: unknown[]) => c[0] === "alert.triggered",
      );
      const recoverySummary = alertCalls.find(
        (c: unknown[]) => (c[1] as { code: string }).code === "CRASH_RECOVERY_COMPLETE",
      );
      expect(recoverySummary).toBeDefined();
    });

    it("removes position not found on-chain from map and DB", async () => {
      const db = getDb();
      db.insert(positionsTable).values({
        mode: "volumeMax",
        pair: "BTC/USDC",
        side: "Long",
        size: 10_000_000,
        entryPrice: 100_000_000,
        stopLoss: 95_000_000,
        timestamp: Date.now(),
      }).run();

      const pm2 = new PositionManager(allocator, mockBroadcast);
      await pm2.loadFromDb();
      expect(pm2.getPositions()).toHaveLength(1);

      // Mock blockchain client — no on-chain positions
      vi.mocked(getBlockchainClient).mockReturnValue({
        exchange: null as never,
        info: {
          clearinghouseState: vi.fn().mockResolvedValue({
            assetPositions: [],
          }),
        } as never,
        walletAddress: "0x0000000000000000000000000000000000000000",
        agentAddress: "0x0000000000000000000000000000000000000001",
      });

      await pm2.reconcileOnChainPositions("0x0000000000000000000000000000000000000000");

      // Position should be removed from memory
      expect(pm2.getPositions()).toHaveLength(0);

      // Position should be removed from DB
      const rows = db.select().from(positionsTable).all();
      expect(rows).toHaveLength(0);
    });

    it("broadcasts critical alert when blockchain client is null", async () => {
      const db = getDb();
      db.insert(positionsTable).values({
        mode: "volumeMax",
        pair: "BTC/USDC",
        side: "Long",
        size: 10_000_000,
        entryPrice: 100_000_000,
        stopLoss: 95_000_000,
        timestamp: Date.now(),
      }).run();

      const pm2 = new PositionManager(allocator, mockBroadcast);
      await pm2.loadFromDb();

      // Mock blockchain client as null
      vi.mocked(getBlockchainClient).mockReturnValue(null);

      mockBroadcast.mockClear();
      await pm2.reconcileOnChainPositions("0x0000000000000000000000000000000000000000");

      // Should broadcast critical alert
      expect(mockBroadcast).toHaveBeenCalledWith("alert.triggered", expect.objectContaining({
        severity: "critical",
        code: "CRASH_RECOVERY_FAILED",
      }));

      // Positions should remain in memory (not cleaned up)
      expect(pm2.getPositions()).toHaveLength(1);
    });

    it("broadcasts summary alert with correct counts", async () => {
      const db = getDb();
      // Position that IS on-chain (will be closed)
      db.insert(positionsTable).values({
        mode: "volumeMax",
        pair: "BTC/USDC",
        side: "Long",
        size: 10_000_000,
        entryPrice: 100_000_000,
        stopLoss: 95_000_000,
        timestamp: Date.now(),
      }).run();
      // Position that is NOT on-chain (will be cleaned up)
      db.insert(positionsTable).values({
        mode: "volumeMax",
        pair: "ETH/USDC",
        side: "Short",
        size: 5_000_000,
        entryPrice: 50_000_000,
        stopLoss: 55_000_000,
        timestamp: Date.now(),
      }).run();

      const pm2 = new PositionManager(allocator, mockBroadcast);
      await pm2.loadFromDb();
      expect(pm2.getPositions()).toHaveLength(2);

      vi.mocked(getBlockchainClient).mockReturnValue({
        exchange: null as never,
        info: {
          clearinghouseState: vi.fn().mockResolvedValue({
            assetPositions: [{
              position: { coin: "BTC", szi: "0.1", entryPx: "100" },
            }],
          }),
        } as never,
        walletAddress: "0x0000000000000000000000000000000000000000",
        agentAddress: "0x0000000000000000000000000000000000000001",
      });

      vi.mocked(contracts.closePosition).mockResolvedValueOnce({
        txHash: "mock-tx-recovery",
        exitPrice: 100_000_000,
        pnl: 0,
        fees: 10_000,
      });

      allocator.setAllocation("volumeMax", 400_000_000);
      mockBroadcast.mockClear();

      await pm2.reconcileOnChainPositions("0x0000000000000000000000000000000000000000");

      const alertCalls = mockBroadcast.mock.calls.filter(
        (c: unknown[]) => c[0] === "alert.triggered",
      );
      const summary = alertCalls.find(
        (c: unknown[]) => (c[1] as { code: string }).code === "CRASH_RECOVERY_COMPLETE",
      );
      expect(summary).toBeDefined();
      const payload = (summary as unknown[])[1] as { message: string };
      // 2 recovered, 1 closed, 1 already gone
      expect(payload.message).toContain("2");
      expect(payload.message).toContain("1 closed");
      expect(payload.message).toContain("1 already gone");
    });

    it("handles delta-neutral netting — both Long and Short for same coin with near-zero szi", async () => {
      const db = getDb();
      // Long BTC position
      db.insert(positionsTable).values({
        mode: "volumeMax",
        pair: "BTC/USDC",
        side: "Long",
        size: 10_000_000,
        entryPrice: 100_000_000,
        stopLoss: 95_000_000,
        timestamp: Date.now(),
      }).run();
      // Short BTC position
      db.insert(positionsTable).values({
        mode: "volumeMax",
        pair: "BTC/USDC",
        side: "Short",
        size: 10_000_000,
        entryPrice: 100_000_000,
        stopLoss: 105_000_000,
        timestamp: Date.now(),
      }).run();

      const pm2 = new PositionManager(allocator, mockBroadcast);
      await pm2.loadFromDb();
      expect(pm2.getPositions()).toHaveLength(2);

      // On-chain szi is near zero (netted out)
      vi.mocked(getBlockchainClient).mockReturnValue({
        exchange: null as never,
        info: {
          clearinghouseState: vi.fn().mockResolvedValue({
            assetPositions: [{
              position: { coin: "BTC", szi: "0.000001", entryPx: "100" },
            }],
          }),
        } as never,
        walletAddress: "0x0000000000000000000000000000000000000000",
        agentAddress: "0x0000000000000000000000000000000000000001",
      });

      await pm2.reconcileOnChainPositions("0x0000000000000000000000000000000000000000");

      // Both positions should be deleted (netted)
      expect(pm2.getPositions()).toHaveLength(0);
      const rows = db.select().from(positionsTable).all();
      expect(rows).toHaveLength(0);
    });
  });

  describe("stop-loss failure alert broadcasts (AC#2)", () => {
    it("broadcasts warning alert when stop-loss fails but rollback close succeeds", async () => {
      allocator.setAllocation("volumeMax", 400_000_000);

      vi.mocked(contracts.setStopLoss).mockRejectedValueOnce(new Error("SL submission failed"));

      mockBroadcast.mockClear();

      await expect(
        pm.openPosition({
          mode: "volumeMax",
          pair: "SOL/USDC",
          side: "Long",
          size: 10_000_000,
          slippage: 0.5,
          stopLossPrice: 95_000_000,
        }),
      ).rejects.toThrow(AppError);

      // Should broadcast warning alert (rollback close succeeded)
      const alertCalls = mockBroadcast.mock.calls.filter(
        (c: unknown[]) => c[0] === "alert.triggered",
      );
      expect(alertCalls.length).toBe(1);
      const payload = (alertCalls[0] as unknown[])[1] as {
        severity: string;
        code: string;
        message: string;
        mode: string;
      };
      expect(payload.severity).toBe("warning");
      expect(payload.code).toBe("STOP_LOSS_FAILED");
      expect(payload.message).toContain("automatically closed");
      expect(payload.message).toContain("No capital at risk");
      expect(payload.mode).toBe("volumeMax");
    });

    it("broadcasts critical alert when stop-loss fails AND rollback close fails", async () => {
      allocator.setAllocation("volumeMax", 400_000_000);

      vi.mocked(contracts.setStopLoss).mockRejectedValueOnce(new Error("SL submission failed"));
      vi.mocked(contracts.closePosition).mockRejectedValueOnce(new Error("Close also failed"));

      mockBroadcast.mockClear();

      await expect(
        pm.openPosition({
          mode: "volumeMax",
          pair: "SOL/USDC",
          side: "Long",
          size: 10_000_000,
          slippage: 0.5,
          stopLossPrice: 95_000_000,
        }),
      ).rejects.toThrow(AppError);

      // Should broadcast critical alert (both failed)
      const alertCalls = mockBroadcast.mock.calls.filter(
        (c: unknown[]) => c[0] === "alert.triggered",
      );
      expect(alertCalls.length).toBe(1);
      const payload = (alertCalls[0] as unknown[])[1] as {
        severity: string;
        code: string;
        message: string;
        mode: string;
      };
      expect(payload.severity).toBe("critical");
      expect(payload.code).toBe("STOP_LOSS_FAILED");
      expect(payload.message).toContain("rollback close also failed");
      expect(payload.message).toContain("safety net");
      expect(payload.mode).toBe("volumeMax");
    });

    it("keeps position in DB when stop-loss fails AND rollback close fails", async () => {
      allocator.setAllocation("volumeMax", 400_000_000);

      vi.mocked(contracts.setStopLoss).mockRejectedValueOnce(new Error("SL failed"));
      vi.mocked(contracts.closePosition).mockRejectedValueOnce(new Error("Close failed"));

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

      // Position should be persisted to DB for crash recovery
      const db = getDb();
      const rows = db.select().from(positionsTable).all();
      expect(rows).toHaveLength(1);
      expect(rows[0].pair).toBe("SOL/USDC");

      // Position should be in memory too
      expect(pm.getPositions()).toHaveLength(1);
    });
  });

  describe("close failure alert broadcasts (AC#3)", () => {
    it("broadcasts critical alert when position close fails", async () => {
      allocator.setAllocation("volumeMax", 400_000_000);

      const pos = await pm.openPosition({
        mode: "volumeMax",
        pair: "SOL/USDC",
        side: "Long",
        size: 10_000_000,
        slippage: 0.5,
        stopLossPrice: 95_000_000,
      });

      vi.mocked(contracts.closePosition).mockRejectedValueOnce(new Error("Chain unavailable"));
      mockBroadcast.mockClear();

      await expect(pm.closePosition(pos.id)).rejects.toThrow(AppError);

      // Should broadcast critical alert with stop-loss info
      const alertCalls = mockBroadcast.mock.calls.filter(
        (c: unknown[]) => c[0] === "alert.triggered",
      );
      expect(alertCalls.length).toBe(1);
      const payload = (alertCalls[0] as unknown[])[1] as {
        severity: string;
        code: string;
        message: string;
        mode: string;
      };
      expect(payload.severity).toBe("critical");
      expect(payload.code).toBe("POSITION_CLOSE_FAILED");
      expect(payload.message).toContain("stop-loss");
      expect(payload.mode).toBe("volumeMax");

      // Position should still be tracked
      expect(pm.getPositions()).toHaveLength(1);
      const db = getDb();
      expect(db.select().from(positionsTable).all()).toHaveLength(1);
    });
  });
});
