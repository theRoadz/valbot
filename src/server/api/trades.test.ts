import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import tradesRoutes from "./trades.js";
import { getRecentTrades } from "./trades.js";
import { getDb, _resetDbState, closeDb } from "../db/index.js";
import { trades } from "../db/schema.js";
import { toSmallestUnit } from "../../shared/types.js";

const TEST_DB_PATH = path.resolve(process.cwd(), `test-trades-api-${process.pid}.db`);

function setupTestDb() {
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
  return db;
}

function insertTrade(db: ReturnType<typeof getDb>, overrides: Partial<typeof trades.$inferInsert> = {}) {
  const defaults = {
    mode: "volumeMax",
    pair: "SOL/USDC",
    side: "Long",
    size: toSmallestUnit(10),
    price: toSmallestUnit(150),
    pnl: toSmallestUnit(5),
    fees: toSmallestUnit(0.1),
    timestamp: Date.now(),
  };
  return db.insert(trades).values({ ...defaults, ...overrides }).run();
}

let db: ReturnType<typeof getDb>;
let app: FastifyInstance;

beforeAll(async () => {
  db = setupTestDb();
  app = Fastify();
  await app.register(tradesRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  closeDb();
  _resetDbState();
  try { fs.unlinkSync(TEST_DB_PATH); } catch { /* ignore */ }
  try { fs.unlinkSync(TEST_DB_PATH + "-wal"); } catch { /* ignore */ }
  try { fs.unlinkSync(TEST_DB_PATH + "-shm"); } catch { /* ignore */ }
});

beforeEach(() => {
  db.delete(trades).run();
});

describe("getRecentTrades helper", () => {
  it("returns empty result when DB has no trades", () => {
    const result = getRecentTrades(50, 0);
    expect(result).toEqual({ trades: [], total: 0 });
  });

  it("returns trades in reverse chronological order", () => {
    insertTrade(db, { timestamp: 1000 });
    insertTrade(db, { timestamp: 3000 });
    insertTrade(db, { timestamp: 2000 });

    const result = getRecentTrades(50, 0);
    expect(result.total).toBe(3);
    expect(result.trades).toHaveLength(3);
    expect(result.trades[0].timestamp).toBe(3000);
    expect(result.trades[1].timestamp).toBe(2000);
    expect(result.trades[2].timestamp).toBe(1000);
  });

  it("respects limit and offset for pagination", () => {
    for (let i = 0; i < 10; i++) {
      insertTrade(db, { timestamp: 1000 + i * 100 });
    }

    const page1 = getRecentTrades(3, 0);
    expect(page1.trades).toHaveLength(3);
    expect(page1.total).toBe(10);
    expect(page1.trades[0].timestamp).toBe(1900);

    const page2 = getRecentTrades(3, 3);
    expect(page2.trades).toHaveLength(3);
    expect(page2.total).toBe(10);
    expect(page2.trades[0].timestamp).toBe(1600);
  });

  it("converts monetary values from smallest unit to display unit", () => {
    insertTrade(db, {
      size: toSmallestUnit(25.5),
      price: toSmallestUnit(148.75),
      pnl: toSmallestUnit(-3.2),
      fees: toSmallestUnit(0.05),
    });

    const result = getRecentTrades(50, 0);
    expect(result.trades[0].size).toBeCloseTo(25.5);
    expect(result.trades[0].price).toBeCloseTo(148.75);
    expect(result.trades[0].pnl).toBeCloseTo(-3.2);
    expect(result.trades[0].fees).toBeCloseTo(0.05);
  });

  it("filters by mode when provided", () => {
    insertTrade(db, { mode: "volumeMax", timestamp: 3000 });
    insertTrade(db, { mode: "profitHunter", timestamp: 2000 });
    insertTrade(db, { mode: "volumeMax", timestamp: 1000 });

    const result = getRecentTrades(50, 0, "volumeMax");
    expect(result.total).toBe(2);
    expect(result.trades).toHaveLength(2);
    expect(result.trades.every((t) => t.mode === "volumeMax")).toBe(true);
  });

  it("maps mode string to ModeType correctly", () => {
    insertTrade(db, { mode: "profitHunter" });
    const result = getRecentTrades(50, 0);
    expect(result.trades[0].mode).toBe("profitHunter");
  });

  it("maps side string to TradeSide correctly", () => {
    insertTrade(db, { side: "Short" });
    const result = getRecentTrades(50, 0);
    expect(result.trades[0].side).toBe("Short");
  });
});

describe("trades route /api/trades", () => {
  it("GET /api/trades returns default paginated response when empty", async () => {
    const res = await app.inject({ method: "GET", url: "/api/trades" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ trades: [], total: 0 });
  });

  it("returns trades with pagination", async () => {
    for (let i = 0; i < 5; i++) {
      insertTrade(db, { timestamp: 1000 + i * 100 });
    }

    const res = await app.inject({ method: "GET", url: "/api/trades?limit=2&offset=0" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.trades).toHaveLength(2);
    expect(body.total).toBe(5);
  });

  it("filters by mode query parameter", async () => {
    insertTrade(db, { mode: "volumeMax" });
    insertTrade(db, { mode: "profitHunter" });
    insertTrade(db, { mode: "arbitrage" });

    const res = await app.inject({ method: "GET", url: "/api/trades?mode=arbitrage" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.trades).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(body.trades[0].mode).toBe("arbitrage");
  });

  it("ignores invalid mode parameter", async () => {
    insertTrade(db, { mode: "volumeMax" });

    const res = await app.inject({ method: "GET", url: "/api/trades?mode=invalidMode" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
  });

  it("rejects limit exceeding 500", async () => {
    const res = await app.inject({ method: "GET", url: "/api/trades?limit=501" });
    expect(res.statusCode).toBe(400);
  });

  it("rejects negative offset", async () => {
    const res = await app.inject({ method: "GET", url: "/api/trades?offset=-1" });
    expect(res.statusCode).toBe(400);
  });
});
