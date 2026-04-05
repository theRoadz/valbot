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

// Mock blockchain client (needed by position manager)
vi.mock("../blockchain/client.js", () => ({
  getBlockchainClient: vi.fn(() => null),
  getConnectionStatus: vi.fn().mockResolvedValue(null),
}));

// Mock contracts (needed by position manager)
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
    fees: 10_000,
  }),
  setStopLoss: vi.fn().mockResolvedValue({
    txHash: "mock-tx-sl",
  }),
  initAssetIndices: vi.fn().mockResolvedValue(undefined),
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
    getEngine().fundAllocator.setAllocation("volumeMax", 1_000_000_000);

    await startMode("volumeMax", { pairs: ["SOL/USDC"] });
    expect(getModeStatus("volumeMax")).toBe("running");
  });

  it("stopMode stops runner and removes from map", async () => {
    const { initEngine, getEngine, startMode, stopMode, getModeStatus } = await import("./index.js");
    await initEngine();

    getEngine().fundAllocator.setAllocation("volumeMax", 1_000_000_000);
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

  it("startMode throws for unsupported mode type", async () => {
    const { initEngine, startMode } = await import("./index.js");
    await initEngine();

    await expect(startMode("profitHunter", { pairs: ["SOL/USDC"] }))
      .rejects.toThrow("Unsupported mode type");
  });

  it("stopAllModes stops all running modes", async () => {
    const { initEngine, getEngine, startMode, stopAllModes, getModeStatus } = await import("./index.js");
    await initEngine();

    getEngine().fundAllocator.setAllocation("volumeMax", 1_000_000_000);
    await startMode("volumeMax", { pairs: ["SOL/USDC"] });

    await stopAllModes();
    expect(getModeStatus("volumeMax")).toBe("stopped");
  });
});
