import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { sql } from 'drizzle-orm';
import {
  trades,
  positions,
  sessions,
  config,
  type Trade,
  type NewTrade,
  type Position,
  type NewPosition,
  type Session,
  type NewSession,
  type Config,
  type NewConfig,
  assertSafeInteger,
} from './schema.js';
import { getDb, closeDb, _resetDbState } from './index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationDir = path.resolve(__dirname, 'migrations');

function readMigrationSql(): string {
  const files = fs.readdirSync(migrationDir).filter((f) => f.endsWith('.sql')).sort((a, b) => {
    const numA = parseInt(a, 10);
    const numB = parseInt(b, 10);
    return numA - numB;
  });
  return files.map((f) => fs.readFileSync(path.join(migrationDir, f), 'utf-8')).join('\n');
}

function createTestDb() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema: { trades, positions, sessions, config } });

  // Apply actual migration SQL to avoid drift between test and production schema
  const migrationSql = readMigrationSql();
  const statements = migrationSql.split('--> statement-breakpoint');
  for (const stmt of statements) {
    const trimmed = stmt.trim();
    if (trimmed) sqlite.exec(trimmed);
  }

  return { db, sqlite };
}

describe('Database Schema', () => {
  let db: ReturnType<typeof drizzle>;
  let sqlite: Database.Database;

  beforeEach(() => {
    const testDb = createTestDb();
    db = testDb.db;
    sqlite = testDb.sqlite;
  });

  afterEach(() => {
    sqlite.close();
  });

  it('creates all four tables in an in-memory database', () => {
    const tableNames = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];

    const names = tableNames.map((t) => t.name);
    expect(names).toContain('trades');
    expect(names).toContain('positions');
    expect(names).toContain('sessions');
    expect(names).toContain('config');
  });

  describe('trades table', () => {
    it('inserts and selects a row with correct column types', () => {
      const newTrade: NewTrade = {
        mode: 'volumeMax',
        pair: 'SOL/USDC',
        side: 'Long',
        size: 100_500_000,       // 100.5 USDC × 1e6
        price: 25_750_000,       // 25.75 USDC × 1e6
        pnl: 12_300_000,         // 12.30 USDC × 1e6
        fees: 50_000,            // 0.05 USDC × 1e6
        timestamp: Date.now(),
      };

      db.insert(trades).values(newTrade).run();
      const rows = db.select().from(trades).all();

      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(1);
      expect(rows[0].mode).toBe('volumeMax');
      expect(rows[0].pair).toBe('SOL/USDC');
      expect(rows[0].side).toBe('Long');
      expect(rows[0].size).toBe(100_500_000);
      expect(rows[0].price).toBe(25_750_000);
      expect(rows[0].pnl).toBe(12_300_000);
      expect(rows[0].fees).toBe(50_000);
      expect(typeof rows[0].timestamp).toBe('number');
    });

    it('enforces notNull constraints on required columns', () => {
      expect(() => {
        sqlite.prepare('INSERT INTO trades (mode, pair, side, size, price, pnl, fees) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
          'volumeMax', 'SOL/USDC', 'Long', 100, 25, 0, 0
        );
      }).toThrow();
    });

    it('rejects invalid side values via CHECK constraint', () => {
      expect(() => {
        sqlite.prepare('INSERT INTO trades (mode, pair, side, size, price, pnl, fees, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
          'volumeMax', 'SOL/USDC', 'Buy', 100, 25, 0, 0, Date.now()
        );
      }).toThrow();
    });
  });

  describe('positions table', () => {
    it('inserts and selects a row with correct column types', () => {
      const newPosition: NewPosition = {
        mode: 'profitHunter',
        pair: 'ETH/USDC',
        side: 'Short',
        size: 50_000_000,          // 50.0 × 1e6
        entryPrice: 3_500_250_000, // 3500.25 × 1e6
        stopLoss: 3_600_000_000,   // 3600.00 × 1e6
        timestamp: Date.now(),
      };

      db.insert(positions).values(newPosition).run();
      const rows = db.select().from(positions).all();

      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(1);
      expect(rows[0].mode).toBe('profitHunter');
      expect(rows[0].entryPrice).toBe(3_500_250_000);
      expect(rows[0].stopLoss).toBe(3_600_000_000);
    });

    it('enforces notNull constraints on required columns', () => {
      expect(() => {
        sqlite.prepare('INSERT INTO positions (mode, pair, side, size, entryPrice, stopLoss) VALUES (?, ?, ?, ?, ?, ?)').run(
          'volumeMax', 'SOL/USDC', 'Long', 100, 25, 30
        );
      }).toThrow();
    });

    it('rejects invalid side values via CHECK constraint', () => {
      expect(() => {
        sqlite.prepare('INSERT INTO positions (mode, pair, side, size, entryPrice, stopLoss, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
          'profitHunter', 'ETH/USDC', 'Sell', 100, 3500, 3600, Date.now()
        );
      }).toThrow();
    });
  });

  describe('sessions table', () => {
    it('inserts and selects a row with correct column types', () => {
      const newSession: NewSession = {
        startTime: Date.now(),
        mode: 'volumeMax',
      };

      db.insert(sessions).values(newSession).run();
      const rows = db.select().from(sessions).all();

      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(1);
      expect(rows[0].trades).toBe(0);
      expect(rows[0].volume).toBe(0);
      expect(rows[0].pnl).toBe(0);
    });

    it('accepts null for endTime (active session)', () => {
      const newSession: NewSession = {
        startTime: Date.now(),
        mode: 'volumeMax',
      };

      db.insert(sessions).values(newSession).run();
      const rows = db.select().from(sessions).all();

      expect(rows[0].endTime).toBeNull();
    });

    it('accepts a value for endTime (completed session)', () => {
      const start = Date.now();
      const end = start + 3600000;

      db.insert(sessions).values({
        startTime: start,
        endTime: end,
        mode: 'volumeMax',
        trades: 42,
        volume: 10_000_000_000, // 10000 × 1e6
        pnl: 150_750_000,       // 150.75 × 1e6
      }).run();

      const rows = db.select().from(sessions).all();
      expect(rows[0].endTime).toBe(end);
      expect(rows[0].trades).toBe(42);
    });
  });

  describe('config table', () => {
    it('uses key as primary key (not auto-increment id)', () => {
      db.insert(config).values({ key: 'slippage', value: '0.5' }).run();
      db.insert(config).values({ key: 'maxAllocation', value: '1000' }).run();

      const rows = db.select().from(config).all();
      expect(rows).toHaveLength(2);

      // Verify there's no id column
      const columns = sqlite.prepare("PRAGMA table_info('config')").all() as { name: string }[];
      const columnNames = columns.map((c) => c.name);
      expect(columnNames).toEqual(['key', 'value']);
      expect(columnNames).not.toContain('id');
    });

    it('enforces unique key constraint', () => {
      db.insert(config).values({ key: 'slippage', value: '0.5' }).run();

      expect(() => {
        db.insert(config).values({ key: 'slippage', value: '1.0' }).run();
      }).toThrow();
    });

    it('inserts and selects correctly', () => {
      const newConfig: NewConfig = { key: 'theme', value: 'dark' };

      db.insert(config).values(newConfig).run();
      const rows = db.select().from(config).all();

      expect(rows).toHaveLength(1);
      expect(rows[0].key).toBe('theme');
      expect(rows[0].value).toBe('dark');
    });
  });

  describe('type exports', () => {
    it('$inferSelect and $inferInsert types round-trip correctly for each table', () => {
      // Trade types
      const newTrade: NewTrade = {
        mode: 'volumeMax',
        pair: 'SOL/USDC',
        side: 'Long',
        size: 100_000_000,
        price: 25_000_000,
        pnl: 5_000_000,
        fees: 100_000,
        timestamp: Date.now(),
      };
      db.insert(trades).values(newTrade).run();
      const selectedTrade: Trade = db.select().from(trades).all()[0];
      expect(selectedTrade.mode).toBe(newTrade.mode);

      // Position types
      const newPosition: NewPosition = {
        mode: 'arbitrage',
        pair: 'BTC/USDC',
        side: 'Long',
        size: 1_000_000,
        entryPrice: 60_000_000_000,
        stopLoss: 59_000_000_000,
        timestamp: Date.now(),
      };
      db.insert(positions).values(newPosition).run();
      const selectedPosition: Position = db.select().from(positions).all()[0];
      expect(selectedPosition.entryPrice).toBe(newPosition.entryPrice);

      // Session types
      const newSession: NewSession = {
        startTime: Date.now(),
        mode: 'volumeMax',
      };
      db.insert(sessions).values(newSession).run();
      const selectedSession: Session = db.select().from(sessions).all()[0];
      expect(selectedSession.mode).toBe(newSession.mode);

      // Config types
      const newConfig: NewConfig = { key: 'test', value: 'val' };
      db.insert(config).values(newConfig).run();
      const selectedConfig: Config = db.select().from(config).all()[0];
      expect(selectedConfig.key).toBe(newConfig.key);
    });
  });
});

describe('getDb / closeDb', () => {
  afterEach(() => {
    // Clean up: ensure DB is closed and state is reset for next test
    try { closeDb(); } catch { /* ignore */ }
    _resetDbState();
  });

  it('returns a usable Drizzle instance', () => {
    const db = getDb();
    expect(db).toBeDefined();
    // Verify we can query (tables exist because migrations ran)
    const rows = db.select().from(config).all();
    expect(Array.isArray(rows)).toBe(true);
  });

  it('returns the same instance on repeated calls', () => {
    const db1 = getDb();
    const db2 = getDb();
    expect(db1).toBe(db2);
  });

  it('throws after closeDb() is called', () => {
    getDb(); // initialize
    closeDb();
    expect(() => getDb()).toThrow('Database has been permanently closed');
  });

  it('closeDb() is safe to call when never opened', () => {
    expect(() => closeDb()).not.toThrow();
  });
});

describe('assertSafeInteger', () => {
  it('accepts values within safe integer range', () => {
    expect(() => assertSafeInteger(0, 'test')).not.toThrow();
    expect(() => assertSafeInteger(100_500_000, 'size')).not.toThrow();
    expect(() => assertSafeInteger(-50_000_000, 'pnl')).not.toThrow();
    expect(() => assertSafeInteger(Number.MAX_SAFE_INTEGER, 'max')).not.toThrow();
    expect(() => assertSafeInteger(Number.MIN_SAFE_INTEGER, 'min')).not.toThrow();
  });

  it('throws for values exceeding MAX_SAFE_INTEGER', () => {
    expect(() => assertSafeInteger(Number.MAX_SAFE_INTEGER + 1, 'price')).toThrow(RangeError);
    expect(() => assertSafeInteger(Number.MAX_SAFE_INTEGER + 1, 'price')).toThrow('exceeds Number.MAX_SAFE_INTEGER');
  });

  it('throws for non-integer values', () => {
    expect(() => assertSafeInteger(1.5, 'size')).toThrow(RangeError);
    expect(() => assertSafeInteger(NaN, 'price')).toThrow(RangeError);
    expect(() => assertSafeInteger(Infinity, 'volume')).toThrow(RangeError);
  });
});
