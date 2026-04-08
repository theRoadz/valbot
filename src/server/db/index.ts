import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { dbClosedError, dbInitializationFailedError } from '../lib/errors.js';

// Resolve DB path: prefer VALBOT_DB_PATH env var, fallback to CWD (project root via npm scripts).
// Uses process.cwd() instead of import.meta.url to stay bundler-safe.
const dbPath = process.env.VALBOT_DB_PATH || path.resolve(process.cwd(), 'valbot.db');

let _sqlite: Database.Database | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _closed = false;

export function getDb() {
  if (_closed) {
    throw dbClosedError();
  }
  if (!_db) {
    try {
      _sqlite = new Database(dbPath);

      const walResult = _sqlite.pragma('journal_mode = WAL') as { journal_mode: string }[];
      if (walResult[0]?.journal_mode !== 'wal') {
        console.warn(`WAL mode not activated (got: ${walResult[0]?.journal_mode}). Concurrent performance may be degraded.`);
      }

      _sqlite.pragma('busy_timeout = 5000');
      _sqlite.pragma('synchronous = FULL');
      const syncResult = _sqlite.pragma('synchronous') as { synchronous: number | string }[];
      if (Number(syncResult[0]?.synchronous) !== 2) {
        console.warn(`synchronous = FULL not activated (got: ${syncResult[0]?.synchronous}). Data persistence may be at risk.`);
      }

      // Verify schema tables exist (migration guard)
      const tables = _sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('trades','positions','sessions','config')").all() as { name: string }[];
      if (tables.length < 4) {
        const found = tables.map((t) => t.name);
        const missing = ['trades', 'positions', 'sessions', 'config'].filter((t) => !found.includes(t));
        throw dbInitializationFailedError(`Database is missing tables: ${missing.join(', ')}. Run 'pnpm db:migrate' first.`);
      }

      _db = drizzle(_sqlite, { schema });
    } catch (error) {
      if (_sqlite?.open) {
        _sqlite.close();
      }
      _sqlite = null;
      _db = null;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to initialize SQLite database at ${dbPath}: ${message}`);
      if (error instanceof Error && error.name === 'AppError') throw error;
      throw dbInitializationFailedError(message);
    }
  }
  return _db;
}

export function closeDb(): void {
  _closed = true;
  if (_sqlite?.open) {
    _sqlite.close();
  }
  _sqlite = null;
  _db = null;
}

/** Reset closed state — for testing only. */
export function _resetDbState(): void {
  _closed = false;
  _sqlite = null;
  _db = null;
}
