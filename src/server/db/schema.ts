// Values stored as smallest-unit integers (e.g., USDC × 1e6) — see ADR-001
import { sql } from 'drizzle-orm';
import { sqliteTable, integer, text, check } from 'drizzle-orm/sqlite-core';

// --- trades table ---
export const trades = sqliteTable('trades', {
  id: integer().primaryKey({ autoIncrement: true }),
  mode: text().notNull(),
  pair: text().notNull(),
  side: text().notNull(), // "Long" or "Short"
  size: integer().notNull(),
  price: integer().notNull(),
  pnl: integer().notNull(),
  fees: integer().notNull(),
  timestamp: integer().notNull(), // Unix ms
}, (t) => [
  check('trades_side_check', sql`${t.side} IN ('Long', 'Short')`),
]);

// --- positions table ---
export const positions = sqliteTable('positions', {
  id: integer().primaryKey({ autoIncrement: true }),
  mode: text().notNull(),
  pair: text().notNull(),
  side: text().notNull(),
  size: integer().notNull(),
  entryPrice: integer().notNull(),
  stopLoss: integer().notNull(),
  timestamp: integer().notNull(), // Unix ms
  chainPositionId: text(), // nullable — null for pre-migration rows
}, (t) => [
  check('positions_side_check', sql`${t.side} IN ('Long', 'Short')`),
]);

// --- sessions table ---
export const sessions = sqliteTable('sessions', {
  id: integer().primaryKey({ autoIncrement: true }),
  startTime: integer().notNull(), // Unix ms
  endTime: integer(), // nullable — null while session active
  mode: text().notNull(),
  trades: integer().notNull().default(0),
  volume: integer().notNull().default(0),
  pnl: integer().notNull().default(0),
});

// --- config table ---
export const config = sqliteTable('config', {
  key: text().primaryKey(),
  value: text().notNull(),
});

// --- Inferred types ---
export type Trade = typeof trades.$inferSelect;
export type NewTrade = typeof trades.$inferInsert;

export type Position = typeof positions.$inferSelect;
export type NewPosition = typeof positions.$inferInsert;

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

export type Config = typeof config.$inferSelect;
export type NewConfig = typeof config.$inferInsert;

// --- Safe integer guard ---
// better-sqlite3 returns 64-bit integers as JS number (IEEE-754 double),
// which loses precision above Number.MAX_SAFE_INTEGER (~9×10¹⁵).
// Call this before writing financial values to catch overflow early.
export function assertSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} value ${value} exceeds Number.MAX_SAFE_INTEGER — precision would be lost in SQLite`);
  }
}
