import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SessionManager } from "./session-manager.js";
import { getDb, closeDb, _resetDbState } from "../db/index.js";
import { sessions } from "../db/schema.js";
import { sql } from "drizzle-orm";
import path from "path";
import fs from "fs";

const TEST_DB_PATH = path.resolve(process.cwd(), "test-session-manager.db");

function setupTestDb() {
  // Ensure clean state by removing any leftover test DB files
  try { fs.unlinkSync(TEST_DB_PATH); } catch { /* ignore */ }
  try { fs.unlinkSync(TEST_DB_PATH + "-wal"); } catch { /* ignore */ }
  try { fs.unlinkSync(TEST_DB_PATH + "-shm"); } catch { /* ignore */ }
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
  // Clean all tables between tests
  db.delete(sessions).run();
  return db;
}

describe("SessionManager", () => {
  let sm: SessionManager;

  beforeEach(() => {
    setupTestDb();
    sm = new SessionManager();
  });

  afterEach(() => {
    closeDb();
    _resetDbState();
    try { fs.unlinkSync(TEST_DB_PATH); } catch { /* ignore */ }
    try { fs.unlinkSync(TEST_DB_PATH + "-wal"); } catch { /* ignore */ }
    try { fs.unlinkSync(TEST_DB_PATH + "-shm"); } catch { /* ignore */ }
  });

  describe("startSession", () => {
    it("creates a session row and returns its id", () => {
      const id = sm.startSession("volumeMax");
      expect(id).toBeGreaterThan(0);

      const db = getDb();
      const row = db.select().from(sessions).get();
      expect(row).toBeDefined();
      expect(row!.mode).toBe("volumeMax");
      expect(row!.trades).toBe(0);
      expect(row!.volume).toBe(0);
      expect(row!.pnl).toBe(0);
      expect(row!.endTime).toBeNull();
      expect(row!.startTime).toBeGreaterThan(0);
    });

    it("creates separate sessions for different modes", () => {
      const id1 = sm.startSession("volumeMax");
      const id2 = sm.startSession("profitHunter");
      expect(id1).not.toBe(id2);

      const db = getDb();
      const rows = db.select().from(sessions).all();
      expect(rows).toHaveLength(2);
    });
  });

  describe("updateSession", () => {
    it("increments trades, volume, and pnl", () => {
      const id = sm.startSession("volumeMax");

      sm.updateSession(id, 100_000_000, 5_000_000);
      sm.updateSession(id, 200_000_000, -3_000_000);

      const db = getDb();
      const row = db.select().from(sessions).get();
      expect(row!.trades).toBe(2);
      expect(row!.volume).toBe(300_000_000);
      expect(row!.pnl).toBe(2_000_000);
    });

    it("handles negative pnl correctly", () => {
      const id = sm.startSession("profitHunter");
      sm.updateSession(id, 50_000_000, -10_000_000);

      const db = getDb();
      const row = db.select().from(sessions).get();
      expect(row!.pnl).toBe(-10_000_000);
    });
  });

  describe("finalizeSession", () => {
    it("sets endTime on the session", () => {
      const id = sm.startSession("volumeMax");

      const db = getDb();
      let row = db.select().from(sessions).get();
      expect(row!.endTime).toBeNull();

      sm.finalizeSession(id);

      row = db.select().from(sessions).get();
      expect(row!.endTime).toBeGreaterThan(0);
    });
  });

  describe("getHistoricalStats", () => {
    it("returns zeros when no sessions exist", () => {
      const stats = sm.getHistoricalStats();
      expect(stats.totalPnl).toBe(0);
      expect(stats.totalTrades).toBe(0);
      expect(stats.totalVolume).toBe(0);
    });

    it("sums only finalized sessions", () => {
      const id1 = sm.startSession("volumeMax");
      sm.updateSession(id1, 100_000_000, 10_000_000);
      sm.finalizeSession(id1);

      const id2 = sm.startSession("profitHunter");
      sm.updateSession(id2, 200_000_000, 20_000_000);
      sm.finalizeSession(id2);

      // Active session — should NOT be included
      const id3 = sm.startSession("arbitrage");
      sm.updateSession(id3, 50_000_000, 5_000_000);

      const stats = sm.getHistoricalStats();
      expect(stats.totalPnl).toBe(30_000_000);
      expect(stats.totalTrades).toBe(2);
      expect(stats.totalVolume).toBe(300_000_000);
    });

    it("handles negative pnl in aggregation", () => {
      const id1 = sm.startSession("volumeMax");
      sm.updateSession(id1, 100_000_000, 10_000_000);
      sm.finalizeSession(id1);

      const id2 = sm.startSession("volumeMax");
      sm.updateSession(id2, 100_000_000, -15_000_000);
      sm.finalizeSession(id2);

      const stats = sm.getHistoricalStats();
      expect(stats.totalPnl).toBe(-5_000_000);
    });
  });

  describe("getActiveSession", () => {
    it("returns null when no active session exists", () => {
      expect(sm.getActiveSession("volumeMax")).toBeNull();
    });

    it("returns null when session is finalized", () => {
      const id = sm.startSession("volumeMax");
      sm.finalizeSession(id);
      expect(sm.getActiveSession("volumeMax")).toBeNull();
    });

    it("returns active session for the given mode", () => {
      const id = sm.startSession("volumeMax");
      sm.updateSession(id, 100_000_000, 5_000_000);

      const active = sm.getActiveSession("volumeMax");
      expect(active).not.toBeNull();
      expect(active!.id).toBe(id);
      expect(active!.mode).toBe("volumeMax");
      expect(active!.trades).toBe(1);
      expect(active!.volume).toBe(100_000_000);
      expect(active!.pnl).toBe(5_000_000);
    });

    it("does not return active sessions for other modes", () => {
      sm.startSession("volumeMax");
      expect(sm.getActiveSession("profitHunter")).toBeNull();
    });
  });

  describe("finalizeOrphanedSessions", () => {
    it("returns 0 when no orphaned sessions exist", () => {
      expect(sm.finalizeOrphanedSessions()).toBe(0);
    });

    it("finalizes all sessions with null endTime", () => {
      sm.startSession("volumeMax");
      sm.startSession("profitHunter");

      const count = sm.finalizeOrphanedSessions();
      expect(count).toBe(2);

      const db = getDb();
      const rows = db.select().from(sessions).all();
      for (const row of rows) {
        expect(row.endTime).toBeGreaterThan(0);
      }
    });

    it("does not affect already-finalized sessions", () => {
      const id1 = sm.startSession("volumeMax");
      sm.finalizeSession(id1);

      sm.startSession("profitHunter");

      const count = sm.finalizeOrphanedSessions();
      expect(count).toBe(1);
    });
  });
});
