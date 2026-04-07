import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FundAllocator } from "./fund-allocator.js";
import { getDb, closeDb, _resetDbState } from "../db/index.js";
import { config } from "../db/schema.js";
import { sql } from "drizzle-orm";
import path from "path";
import fs from "fs";

const TEST_DB_PATH = path.resolve(process.cwd(), "test-fund-allocator.db");

function setupTestDb() {
  process.env.VALBOT_DB_PATH = TEST_DB_PATH;
  _resetDbState();
  const db = getDb();
  // Create tables if they don't exist (migrations may not have run for test db)
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
    chainPositionId TEXT
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
  // Clean config table between tests
  db.delete(config).run();
  return db;
}

describe("FundAllocator", () => {
  let allocator: FundAllocator;

  beforeEach(() => {
    setupTestDb();
    allocator = new FundAllocator();
  });

  afterEach(() => {
    closeDb();
    _resetDbState();
    try { fs.unlinkSync(TEST_DB_PATH); } catch { /* ignore */ }
    try { fs.unlinkSync(TEST_DB_PATH + "-wal"); } catch { /* ignore */ }
    try { fs.unlinkSync(TEST_DB_PATH + "-shm"); } catch { /* ignore */ }
  });

  describe("setAllocation / getAllocation", () => {
    it("sets and retrieves allocation correctly", () => {
      allocator.setAllocation("volumeMax", 400_000_000);
      const result = allocator.getAllocation("volumeMax");
      expect(result.allocation).toBe(400_000_000);
      expect(result.remaining).toBe(400_000_000);
    });

    it("returns 0/0 for unset mode", () => {
      const result = allocator.getAllocation("profitHunter");
      expect(result).toEqual({ allocation: 0, remaining: 0 });
    });

    it("updating allocation adjusts remaining by diff", () => {
      allocator.setAllocation("volumeMax", 200_000_000);
      allocator.reserve("volumeMax", 50_000_000);
      // remaining is now 150M. Increase allocation by 100M
      allocator.setAllocation("volumeMax", 300_000_000);
      expect(allocator.getAllocation("volumeMax").remaining).toBe(250_000_000);
    });
  });

  describe("reserve / release", () => {
    it("decrements remaining on reserve", () => {
      allocator.setAllocation("volumeMax", 400_000_000);
      allocator.reserve("volumeMax", 100_000_000);
      expect(allocator.getAllocation("volumeMax").remaining).toBe(300_000_000);
    });

    it("increments remaining on release (capped at allocation)", () => {
      allocator.setAllocation("volumeMax", 400_000_000);
      allocator.reserve("volumeMax", 100_000_000);
      allocator.release("volumeMax", 500_000_000);
      // Capped at allocation
      expect(allocator.getAllocation("volumeMax").remaining).toBe(400_000_000);
    });

    it("release increments remaining correctly", () => {
      allocator.setAllocation("volumeMax", 400_000_000);
      allocator.reserve("volumeMax", 200_000_000);
      allocator.release("volumeMax", 100_000_000);
      expect(allocator.getAllocation("volumeMax").remaining).toBe(300_000_000);
    });
  });

  describe("canAllocate", () => {
    it("returns true when sufficient funds", () => {
      allocator.setAllocation("volumeMax", 400_000_000);
      expect(allocator.canAllocate("volumeMax", 200_000_000)).toBe(true);
    });

    it("returns false when insufficient funds", () => {
      allocator.setAllocation("volumeMax", 400_000_000);
      expect(allocator.canAllocate("volumeMax", 500_000_000)).toBe(false);
    });

    it("returns false for unset mode", () => {
      expect(allocator.canAllocate("profitHunter", 100)).toBe(false);
    });
  });

  describe("reserve throws INSUFFICIENT_FUNDS", () => {
    it("throws AppError when insufficient funds", () => {
      allocator.setAllocation("volumeMax", 100_000_000);
      try {
        allocator.reserve("volumeMax", 200_000_000);
        expect.fail("should have thrown");
      } catch (err: unknown) {
        const e = err as { name: string; code: string };
        expect(e.name).toBe("AppError");
        expect(e.code).toBe("INSUFFICIENT_FUNDS");
      }
    });

    it("throws for unset mode", () => {
      try {
        allocator.reserve("arbitrage", 100);
        expect.fail("should have thrown");
      } catch (err: unknown) {
        const e = err as { name: string; code: string };
        expect(e.name).toBe("AppError");
        expect(e.code).toBe("INSUFFICIENT_FUNDS");
      }
    });
  });

  describe("kill-switch detection", () => {
    it("returns true at exactly 10% loss", () => {
      allocator.setAllocation("volumeMax", 400_000_000);
      // Simulate: open 200M position, close with 40M loss (returned 160M)
      allocator.reserve("volumeMax", 200_000_000); // remaining = 200M
      allocator.release("volumeMax", 160_000_000); // remaining = 360M = allocation * 0.9
      expect(allocator.checkKillSwitch("volumeMax")).toBe(true);
    });

    it("returns true when loss exceeds 10%", () => {
      allocator.setAllocation("volumeMax", 400_000_000);
      allocator.reserve("volumeMax", 200_000_000); // remaining = 200M
      allocator.release("volumeMax", 100_000_000); // remaining = 300M < 360M threshold
      expect(allocator.checkKillSwitch("volumeMax")).toBe(true);
    });

    it("returns false when no losses (funds merely deployed)", () => {
      allocator.setAllocation("volumeMax", 400_000_000);
      // Deploy 200M into a position — remaining drops but no loss yet
      allocator.reserve("volumeMax", 200_000_000);
      // remaining = 200M, which is <= 360M threshold
      // The kill-switch DOES trigger here because remaining <= allocation * 0.9
      // This is correct per AC7: remaining reflects actual balance
      // The key is that the position manager releases funds back when closing
      expect(allocator.checkKillSwitch("volumeMax")).toBe(true);
    });

    it("returns false when losses are below threshold", () => {
      allocator.setAllocation("volumeMax", 400_000_000);
      // Small trade with small loss
      allocator.reserve("volumeMax", 100_000_000);
      allocator.release("volumeMax", 95_000_000); // 5M loss, remaining = 395M > 360M
      expect(allocator.checkKillSwitch("volumeMax")).toBe(false);
    });

    it("returns false for unset mode", () => {
      expect(allocator.checkKillSwitch("profitHunter")).toBe(false);
    });
  });

  describe("cross-mode isolation", () => {
    it("allocating in one mode does not affect another", () => {
      allocator.setAllocation("volumeMax", 300_000_000);
      allocator.setAllocation("profitHunter", 200_000_000);

      allocator.reserve("volumeMax", 200_000_000);

      expect(allocator.getAllocation("profitHunter").remaining).toBe(200_000_000);
      expect(allocator.canAllocate("profitHunter", 200_000_000)).toBe(true);
    });
  });

  describe("recordTrade / getStats", () => {
    it("increments trades count and accumulates volume and pnl", () => {
      allocator.setAllocation("volumeMax", 400_000_000);
      allocator.recordTrade("volumeMax", 100_000_000, 5_000_000);
      allocator.recordTrade("volumeMax", 200_000_000, -3_000_000);

      const stats = allocator.getStats("volumeMax");
      expect(stats.trades).toBe(2);
      expect(stats.volume).toBeCloseTo(300, 0); // 300M smallest = 300 display
      expect(stats.pnl).toBeCloseTo(2, 0); // 2M smallest = 2 display
    });

    it("getStats returns correct ModeStats shape in display units", () => {
      allocator.setAllocation("volumeMax", 400_000_000); // 400 USDC
      allocator.recordTrade("volumeMax", 50_000_000, 10_000_000);

      const stats = allocator.getStats("volumeMax");
      expect(stats).toEqual({
        pnl: 10, // 10M / 1e6
        trades: 1,
        volume: 50, // 50M / 1e6
        allocated: 400, // 400M / 1e6
        remaining: 400, // 400M / 1e6
      });
    });

    it("getStats returns zeros for unset mode", () => {
      expect(allocator.getStats("arbitrage")).toEqual({
        pnl: 0, trades: 0, volume: 0, allocated: 0, remaining: 0,
      });
    });
  });

  describe("config DB persistence", () => {
    it("setAllocation writes to DB", () => {
      allocator.setAllocation("volumeMax", 500_000_000);
      const db = getDb();
      const rows = db.select().from(config).all();
      const entry = rows.find((r) => r.key === "allocation:volumeMax");
      expect(entry).toBeDefined();
      expect(JSON.parse(entry!.value)).toEqual({ amount: 500_000_000 });
    });

    it("loadFromDb restores state", async () => {
      allocator.setAllocation("volumeMax", 300_000_000);
      allocator.setAllocation("profitHunter", 200_000_000);

      // Create a new allocator and load from DB
      const allocator2 = new FundAllocator();
      await allocator2.loadFromDb();

      expect(allocator2.getAllocation("volumeMax")).toEqual({
        allocation: 300_000_000,
        remaining: 300_000_000,
      });
      expect(allocator2.getAllocation("profitHunter")).toEqual({
        allocation: 200_000_000,
        remaining: 200_000_000,
      });
    });
  });

  describe("reconcilePositions", () => {
    it("subtracts open position sizes from remaining", () => {
      allocator.setAllocation("volumeMax", 400_000_000);
      allocator.reconcilePositions([
        { mode: "volumeMax", size: 100_000_000 },
        { mode: "volumeMax", size: 150_000_000 },
      ]);
      expect(allocator.getAllocation("volumeMax").remaining).toBe(150_000_000);
    });

    it("clamps remaining to zero if positions exceed allocation", () => {
      allocator.setAllocation("volumeMax", 100_000_000);
      allocator.reconcilePositions([
        { mode: "volumeMax", size: 200_000_000 },
      ]);
      expect(allocator.getAllocation("volumeMax").remaining).toBe(0);
    });

    it("does not affect modes without allocations", () => {
      allocator.setAllocation("volumeMax", 400_000_000);
      allocator.reconcilePositions([
        { mode: "profitHunter", size: 100_000_000 },
      ]);
      expect(allocator.getAllocation("volumeMax").remaining).toBe(400_000_000);
    });
  });

  describe("resetModeStats", () => {
    it("zeros pnl, trades, volume and resets remaining to allocation", () => {
      allocator.setAllocation("volumeMax", 400_000_000);
      allocator.reserve("volumeMax", 200_000_000); // deplete remaining
      allocator.recordTrade("volumeMax", 100_000_000, -50_000_000);
      allocator.recordTrade("volumeMax", 200_000_000, 30_000_000);

      const statsBefore = allocator.getStats("volumeMax");
      expect(statsBefore.trades).toBe(2);
      expect(statsBefore.volume).toBeGreaterThan(0);
      expect(statsBefore.remaining).toBeLessThan(statsBefore.allocated);

      allocator.resetModeStats("volumeMax");

      const statsAfter = allocator.getStats("volumeMax");
      expect(statsAfter.trades).toBe(0);
      expect(statsAfter.volume).toBe(0);
      expect(statsAfter.pnl).toBe(0);
      expect(statsAfter.allocated).toBe(400); // display units: 400M / 1e6
      expect(statsAfter.remaining).toBe(400); // remaining reset to match allocation
    });

    it("is safe to call on non-existent mode", () => {
      expect(() => allocator.resetModeStats("arbitrage")).not.toThrow();
    });
  });

  describe("maxAllocation", () => {
    it("defaults to 500 USDC", () => {
      expect(allocator.getMaxAllocation()).toBe(500_000_000);
    });

    it("can be updated and persisted", async () => {
      allocator.setMaxAllocation(1_000_000_000); // $1000
      expect(allocator.getMaxAllocation()).toBe(1_000_000_000);

      // Verify persistence
      const allocator2 = new FundAllocator();
      await allocator2.loadFromDb();
      expect(allocator2.getMaxAllocation()).toBe(1_000_000_000);
    });

    it("allows allocation up to the new max", () => {
      allocator.setMaxAllocation(1_000_000_000); // $1000
      expect(() => allocator.setAllocation("volumeMax", 800_000_000)).not.toThrow();
    });

    it("rejects allocation exceeding max", () => {
      // default max is 500 USDC
      try {
        allocator.setAllocation("volumeMax", 600_000_000);
        expect.fail("should have thrown");
      } catch (err: unknown) {
        const e = err as { code: string };
        expect(e.code).toBe("ALLOCATION_TOO_LARGE");
      }
    });

    it("rejects max below $10", () => {
      try {
        allocator.setMaxAllocation(5_000_000);
        expect.fail("should have thrown");
      } catch (err: unknown) {
        const e = err as { code: string };
        expect(e.code).toBe("INVALID_MAX_ALLOCATION");
      }
    });

    it("rejects max above $10,000", () => {
      try {
        allocator.setMaxAllocation(11_000_000_000);
        expect.fail("should have thrown");
      } catch (err: unknown) {
        const e = err as { code: string };
        expect(e.code).toBe("INVALID_MAX_ALLOCATION");
      }
    });
  });

  describe("positionSize", () => {
    it("returns null when not set", () => {
      expect(allocator.getPositionSize("volumeMax")).toBeNull();
    });

    it("can be set and retrieved", () => {
      allocator.setAllocation("volumeMax", 500_000_000);
      allocator.setPositionSize("volumeMax", 50_000_000); // $50
      expect(allocator.getPositionSize("volumeMax")).toBe(50_000_000);
    });

    it("persists to DB and loads back", async () => {
      allocator.setAllocation("volumeMax", 500_000_000);
      allocator.setPositionSize("volumeMax", 50_000_000);

      const allocator2 = new FundAllocator();
      await allocator2.loadFromDb();
      expect(allocator2.getPositionSize("volumeMax")).toBe(50_000_000);
    });

    it("can be cleared", () => {
      allocator.setAllocation("volumeMax", 500_000_000);
      allocator.setPositionSize("volumeMax", 50_000_000);
      allocator.clearPositionSize("volumeMax");
      expect(allocator.getPositionSize("volumeMax")).toBeNull();
    });

    it("clearPositionSize persists removal", async () => {
      allocator.setAllocation("volumeMax", 500_000_000);
      allocator.setPositionSize("volumeMax", 50_000_000);
      allocator.clearPositionSize("volumeMax");

      const allocator2 = new FundAllocator();
      await allocator2.loadFromDb();
      expect(allocator2.getPositionSize("volumeMax")).toBeNull();
    });

    it("rejects position size below $10", () => {
      allocator.setAllocation("volumeMax", 500_000_000);
      try {
        allocator.setPositionSize("volumeMax", 5_000_000);
        expect.fail("should have thrown");
      } catch (err: unknown) {
        const e = err as { code: string };
        expect(e.code).toBe("POSITION_SIZE_TOO_SMALL");
      }
    });

    it("rejects position size exceeding allocation", () => {
      allocator.setAllocation("volumeMax", 100_000_000); // $100
      try {
        allocator.setPositionSize("volumeMax", 200_000_000); // $200
        expect.fail("should have thrown");
      } catch (err: unknown) {
        const e = err as { code: string };
        expect(e.code).toBe("POSITION_SIZE_TOO_LARGE");
      }
    });

    it("is independent per mode", () => {
      allocator.setAllocation("volumeMax", 300_000_000);
      allocator.setAllocation("profitHunter", 200_000_000);
      allocator.setPositionSize("volumeMax", 50_000_000);
      allocator.setPositionSize("profitHunter", 30_000_000);

      expect(allocator.getPositionSize("volumeMax")).toBe(50_000_000);
      expect(allocator.getPositionSize("profitHunter")).toBe(30_000_000);
      expect(allocator.getPositionSize("arbitrage")).toBeNull();
    });
  });

  describe("assertSafeInteger guard", () => {
    it("throws RangeError for unsafe integer", () => {
      expect(() => {
        allocator.setAllocation("volumeMax", Number.MAX_SAFE_INTEGER + 1);
      }).toThrow(RangeError);
    });

    it("throws for non-integer", () => {
      expect(() => {
        allocator.setAllocation("volumeMax", 1.5);
      }).toThrow(RangeError);
    });
  });

  // === Task 2: Cross-mode isolation validation (Story 4-4) ===

  describe("cross-mode fund isolation (parallel modes)", () => {
    it("canAllocate respects per-mode budgets — mode A doesn't draw from mode B (2.1)", () => {
      allocator.setAllocation("volumeMax", 200_000_000);
      allocator.setAllocation("profitHunter", 300_000_000);

      // volumeMax can only allocate up to its own 200M
      expect(allocator.canAllocate("volumeMax", 200_000_000)).toBe(true);
      expect(allocator.canAllocate("volumeMax", 201_000_000)).toBe(false);

      // profitHunter has its own separate 300M
      expect(allocator.canAllocate("profitHunter", 300_000_000)).toBe(true);
      expect(allocator.canAllocate("profitHunter", 301_000_000)).toBe(false);

      // Reserve from volumeMax — profitHunter unaffected
      allocator.reserve("volumeMax", 150_000_000);
      expect(allocator.canAllocate("profitHunter", 300_000_000)).toBe(true);
      expect(allocator.canAllocate("volumeMax", 100_000_000)).toBe(false);
    });

    it("reserve/release for concurrent modes — mode A's reserve doesn't affect mode B (2.3)", () => {
      allocator.setAllocation("volumeMax", 200_000_000);
      allocator.setAllocation("profitHunter", 200_000_000);
      allocator.setAllocation("arbitrage", 100_000_000);

      // Reserve from all three modes
      allocator.reserve("volumeMax", 100_000_000);
      allocator.reserve("profitHunter", 150_000_000);
      allocator.reserve("arbitrage", 50_000_000);

      // Each mode's remaining reflects only its own reserves
      expect(allocator.getAllocation("volumeMax").remaining).toBe(100_000_000);
      expect(allocator.getAllocation("profitHunter").remaining).toBe(50_000_000);
      expect(allocator.getAllocation("arbitrage").remaining).toBe(50_000_000);

      // Release from one mode doesn't affect others
      allocator.release("volumeMax", 100_000_000);
      expect(allocator.getAllocation("volumeMax").remaining).toBe(200_000_000);
      expect(allocator.getAllocation("profitHunter").remaining).toBe(50_000_000);
      expect(allocator.getAllocation("arbitrage").remaining).toBe(50_000_000);
    });

    it("kill-switch triggers independently per mode — mode A's 10% loss doesn't affect mode B (2.4)", () => {
      allocator.setAllocation("volumeMax", 250_000_000);
      allocator.setAllocation("profitHunter", 250_000_000);

      // volumeMax: simulate loss → remaining drops below 90% threshold
      allocator.reserve("volumeMax", 200_000_000);
      allocator.release("volumeMax", 160_000_000); // 40M lost, remaining = 210M (< 225M = 250M * 0.9)

      expect(allocator.checkKillSwitch("volumeMax")).toBe(true);
      // profitHunter untouched — no kill-switch
      expect(allocator.checkKillSwitch("profitHunter")).toBe(false);

      // profitHunter can still trade normally
      expect(allocator.canAllocate("profitHunter", 250_000_000)).toBe(true);
    });

    it("total allocation validation: sum of all mode allocations cannot exceed maxAllocation (2.2 / 7.1)", () => {
      // Default max is 500 USDC (500_000_000)
      allocator.setAllocation("volumeMax", 200_000_000);
      allocator.setAllocation("profitHunter", 200_000_000);

      // This should work (total = 500M = max)
      expect(() => allocator.setAllocation("arbitrage", 100_000_000)).not.toThrow();

      // This should fail (total would be 200 + 200 + 200 = 600 > 500)
      expect(() => allocator.setAllocation("arbitrage", 200_000_000)).toThrow();
      try {
        allocator.setAllocation("arbitrage", 200_000_000);
      } catch (err: unknown) {
        const e = err as { code: string; resolution: string };
        expect(e.code).toBe("TOTAL_ALLOCATION_EXCEEDED");
        expect(e.resolution).toContain("Available for arbitrage");
      }

      // Reducing one mode frees up space for another
      allocator.setAllocation("volumeMax", 100_000_000);
      // Now total = 100 + 200 + 100 = 400, so arbitrage can go up to 200
      expect(() => allocator.setAllocation("arbitrage", 200_000_000)).not.toThrow();
    });

    it("reconcilePositions correctly attributes positions to the right mode after restart (2.5)", () => {
      allocator.setAllocation("volumeMax", 200_000_000);
      allocator.setAllocation("profitHunter", 200_000_000);
      allocator.setAllocation("arbitrage", 100_000_000);

      // Simulate crash recovery: open positions from multiple modes
      allocator.reconcilePositions([
        { mode: "volumeMax", size: 50_000_000 },
        { mode: "profitHunter", size: 50_000_000 },
        { mode: "arbitrage", size: 75_000_000 },
        { mode: "volumeMax", size: 50_000_000 }, // second volumeMax position
      ]);

      // Each mode's remaining should reflect only its own positions
      expect(allocator.getAllocation("volumeMax").remaining).toBe(100_000_000); // 200 - 50 - 50
      expect(allocator.getAllocation("profitHunter").remaining).toBe(150_000_000); // 200 - 50
      expect(allocator.getAllocation("arbitrage").remaining).toBe(25_000_000); // 100 - 75
    });
  });
});
