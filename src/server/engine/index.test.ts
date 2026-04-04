import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { sql } from "drizzle-orm";
import path from "path";
import fs from "fs";
import { getDb, closeDb, _resetDbState } from "../db/index.js";

const TEST_DB_PATH = path.resolve(process.cwd(), "test-engine-index.db");

// Mock broadcaster
vi.mock("../ws/broadcaster.js", () => ({
  broadcast: vi.fn(),
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
    timestamp INTEGER NOT NULL
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

describe("engine/index", () => {
  beforeEach(() => {
    setupTestDb();
  });

  afterEach(() => {
    closeDb();
    _resetDbState();
    try { fs.unlinkSync(TEST_DB_PATH); } catch { /* ignore */ }
    try { fs.unlinkSync(TEST_DB_PATH + "-wal"); } catch { /* ignore */ }
    try { fs.unlinkSync(TEST_DB_PATH + "-shm"); } catch { /* ignore */ }
  });

  it("initEngine creates instances and getEngine returns them", async () => {
    // Dynamic import to get fresh module state
    const { initEngine, getEngine } = await import("./index.js");
    await initEngine();

    const engine = getEngine();
    expect(engine).toHaveProperty("fundAllocator");
    expect(engine).toHaveProperty("positionManager");
    expect(engine.fundAllocator).toBeDefined();
    expect(engine.positionManager).toBeDefined();
  });
});
