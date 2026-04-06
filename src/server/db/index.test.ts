import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const TEST_DB_PATH = path.resolve(process.cwd(), "test-db-index.db");

function cleanupTestDb() {
  try { fs.unlinkSync(TEST_DB_PATH); } catch { /* ignore */ }
  try { fs.unlinkSync(TEST_DB_PATH + "-wal"); } catch { /* ignore */ }
  try { fs.unlinkSync(TEST_DB_PATH + "-shm"); } catch { /* ignore */ }
}

describe("db/index", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.VALBOT_DB_PATH = TEST_DB_PATH;
    cleanupTestDb();
  });

  afterEach(() => {
    cleanupTestDb();
  });

  it("throws AppError with DB_CLOSED code when accessing closed DB", async () => {
    // Create a valid DB with all required tables
    const sqlite = new Database(TEST_DB_PATH);
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS trades (id INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS positions (id INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS sessions (id INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT);
    `);
    sqlite.close();

    const { getDb, closeDb, _resetDbState } = await import("./index.js");

    _resetDbState();
    getDb();
    closeDb();

    let threwError = false;
    try {
      getDb();
    } catch (err: unknown) {
      threwError = true;
      const appErr = err as { name: string; code: string; severity: string; resolution?: string };
      expect(appErr.name).toBe("AppError");
      expect(appErr.code).toBe("DB_CLOSED");
      expect(appErr.severity).toBe("critical");
      expect(appErr.resolution).toBeDefined();
    }
    expect(threwError).toBe(true);
  });

  it("throws AppError with DB_INITIALIZATION_FAILED when tables are missing", async () => {
    const sqlite = new Database(TEST_DB_PATH);
    sqlite.exec("CREATE TABLE IF NOT EXISTS trades (id INTEGER PRIMARY KEY)");
    sqlite.close();

    const { getDb } = await import("./index.js");

    let threwError = false;
    try {
      getDb();
    } catch (err: unknown) {
      threwError = true;
      const appErr = err as { name: string; code: string; severity: string; details?: string; resolution?: string };
      expect(appErr.name).toBe("AppError");
      expect(appErr.code).toBe("DB_INITIALIZATION_FAILED");
      expect(appErr.severity).toBe("critical");
      expect(appErr.details).toContain("missing tables");
      expect(appErr.resolution).toBeDefined();
    }
    expect(threwError).toBe(true);
  });
});
