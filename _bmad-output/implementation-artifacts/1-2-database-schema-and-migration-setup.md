# Story 1.2: Database Schema & Migration Setup

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want the SQLite database with Drizzle ORM schema for trades, positions, sessions, and config tables,
So that the persistence layer is ready for trade and session data storage.

## Acceptance Criteria

1. **Given** the project is scaffolded (Story 1.1), **When** I run `pnpm db:generate` and `pnpm db:migrate`, **Then** the SQLite database file is created with all four tables.
2. **And** the `trades` table has columns: id, mode, pair, side, size, price, pnl, fees, timestamp.
3. **And** the `positions` table has columns: id, mode, pair, side, size, entryPrice, stopLoss, timestamp.
4. **And** the `sessions` table has columns: id, startTime, endTime, mode, trades, volume, pnl.
5. **And** the `config` table has columns: key, value.
6. **And** all column names use camelCase per Architecture naming conventions.
7. **And** Drizzle schema TypeScript types are exported from `src/server/db/schema.ts`.

## Tasks / Subtasks

- [x] Task 1: Define Drizzle schema in `src/server/db/schema.ts` (AC: #2-#7)
  - [x] 1.1 Import `sqliteTable`, `integer`, `text`, `real` from `drizzle-orm/sqlite-core`
  - [x] 1.2 Define `trades` table: `id` (integer, primaryKey, autoIncrement), `mode` (text, notNull), `pair` (text, notNull), `side` (text, notNull — "Long" or "Short"), `size` (real, notNull), `price` (real, notNull), `pnl` (real, notNull), `fees` (real, notNull), `timestamp` (integer, notNull — Unix ms)
  - [x] 1.3 Define `positions` table: `id` (integer, primaryKey, autoIncrement), `mode` (text, notNull), `pair` (text, notNull), `side` (text, notNull), `size` (real, notNull), `entryPrice` (real, notNull), `stopLoss` (real, notNull), `timestamp` (integer, notNull — Unix ms)
  - [x] 1.4 Define `sessions` table: `id` (integer, primaryKey, autoIncrement), `startTime` (integer, notNull — Unix ms), `endTime` (integer — nullable, null while session active), `mode` (text, notNull), `trades` (integer, notNull, default 0), `volume` (real, notNull, default 0), `pnl` (real, notNull, default 0)
  - [x] 1.5 Define `config` table: `key` (text, primaryKey), `value` (text, notNull)
  - [x] 1.6 Export inferred TypeScript types using `$inferSelect` and `$inferInsert` for each table

- [x] Task 2: Fix `src/server/db/index.ts` database connection (AC: #1)
  - [x] 2.1 Fix relative DB path — resolve `valbot.db` relative to project root using `import.meta.dirname` or `path.resolve`, NOT relative to CWD (deferred fix from Story 1.1 review)
  - [x] 2.2 Add error handling for DB initialization — wrap in try/catch, log meaningful error if DB creation fails (deferred fix from Story 1.1 review)
  - [x] 2.3 Export a `closeDb()` function for graceful shutdown (needed by NFR9 shutdown sequence)
  - [x] 2.4 Enable WAL mode on the SQLite connection for better concurrent read/write performance: `sqlite.pragma('journal_mode = WAL')`

- [x] Task 3: Generate and verify migrations (AC: #1)
  - [x] 3.1 Run `pnpm db:generate` — verify migration SQL files are created in `src/server/db/migrations/`
  - [x] 3.2 Run `pnpm db:migrate` — verify `valbot.db` is created with all four tables
  - [x] 3.3 Inspect generated SQL to confirm camelCase column names and correct types

- [x] Task 4: Write schema tests (AC: #2-#7)
  - [x] 4.1 Create `src/server/db/schema.test.ts` — co-located with schema.ts
  - [x] 4.2 Test: all four tables can be created in an in-memory SQLite database
  - [x] 4.3 Test: insert and select a row in each table, verifying column types and constraints
  - [x] 4.4 Test: `config` table uses `key` as primary key (not auto-increment id)
  - [x] 4.5 Test: `trades` and `positions` tables enforce notNull constraints on required columns
  - [x] 4.6 Test: `sessions.endTime` accepts null (active session)
  - [x] 4.7 Test: verify `$inferSelect` and `$inferInsert` types are exported for each table — insert an object matching the inferred type and confirm it round-trips via select

- [x] Task 5: ADR-001 — Convert financial columns from `real()` to `integer()` smallest-unit (AC: #2-#4)
  - [x] 5.1 Change `real()` → `integer()` for: `size`, `price`, `pnl`, `fees` (trades table); `size`, `entryPrice`, `stopLoss` (positions table); `volume`, `pnl` (sessions table)
  - [x] 5.2 Regenerate migration via `pnpm db:generate` and verify the new SQL uses `integer` for all financial columns
  - [x] 5.3 Run `pnpm db:migrate` to apply — delete existing `valbot.db` first (no production data exists yet)
  - [x] 5.4 Update tests in `schema.test.ts` to use integer smallest-unit values (e.g., `size: 100_500_000` instead of `100.5`)
  - [x] 5.5 Add a `// Values stored as smallest-unit integers (e.g., USDC × 1e6)` comment at the top of schema.ts
  - [x] 5.6 Run full test suite — all tests pass

- [x] Task 6: ADR-002 — Convert DB connection to lazy `getDb()` initialization
  - [x] 6.1 Rewrite `src/server/db/index.ts`: replace `export const db = drizzle(...)` with `export function getDb()` that lazily initializes on first call. Keep `closeDb()` — it should null both `_sqlite` and `_db` refs after closing.
  - [x] 6.2 No call sites currently import `db` from `index.ts` (tests use their own in-memory DB), so no import changes needed. Verified with grep.
  - [x] 6.3 Run full test suite — all tests pass

## Dev Notes

### Critical Architecture Constraints

- **Drizzle ORM 0.45.2** with **better-sqlite3 12.8.0** — use `sqliteTable` from `drizzle-orm/sqlite-core`. NOT PostgreSQL or MySQL core.
- **drizzle-kit 0.31.10** — use `pnpm db:generate` (alias for `drizzle-kit generate`) and `pnpm db:migrate` (alias for `drizzle-kit migrate`). These npm scripts already exist from Story 1.1.
- **drizzle.config.ts** already exists at project root with correct settings: dialect `sqlite`, schema `./src/server/db/schema.ts`, out `./src/server/db/migrations`.
- **camelCase columns everywhere** — Drizzle maps directly to TypeScript without naming translation. Do NOT use snake_case.
- **Timestamps are Unix milliseconds** (`Date.now()`), stored as `integer`. NEVER use ISO strings or SQLite datetime functions.
- **Numbers (prices, sizes, pnl, fees, volume)** use `integer()` — stored as **smallest-unit** (e.g., USDC × 1e6). NEVER use `real()` for monetary values — IEEE 754 rounding compounds across aggregated trades (ADR-001).
- **`config` table uses `key` as primary key** — it's a key-value store, NOT auto-increment id. This is different from the other three tables.

### Drizzle ORM API Reference (v0.45.x for SQLite)

```typescript
// Column types to use:
import { sqliteTable, integer, text, real } from 'drizzle-orm/sqlite-core';

// Auto-increment primary key:
id: integer().primaryKey({ autoIncrement: true })

// Text primary key (for config table):
key: text().primaryKey()

// NotNull + default:
trades: integer().notNull().default(0)

// Nullable column (omit .notNull()):
endTime: integer()

// Type inference:
type Trade = typeof trades.$inferSelect;
type NewTrade = typeof trades.$inferInsert;
```

### Deferred Fixes from Story 1.1 Review (MUST address)

Two review findings were explicitly deferred to this story:

1. **SQLite database path is relative with no CWD guarantee** [src/server/db/index.ts:5] — Current code: `new Database('valbot.db')` uses CWD which varies depending on how the server is started. Fix: resolve path relative to project root.
2. **db/index.ts executes at module load with no error handling** [src/server/db/index.ts:5] — Database connection and Drizzle instance are created at import time with no try/catch. Fix: add error handling.

### Current State of Files to Modify

**`src/server/db/schema.ts`** — Currently a placeholder with only a comment: `// Full schema will be defined in Story 1.2`. Replace entirely with full schema definitions.

**`src/server/db/index.ts`** — Currently:
```typescript
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

const sqlite = new Database('valbot.db');
export const db = drizzle(sqlite, { schema });
```
Rewrite with: resolved path, error handling, WAL mode, and `closeDb()` export.

**`src/server/db/migrations/`** — Currently empty. Will be populated by `drizzle-kit generate`.

### Data Flow Context

These tables serve specific roles in the trading system (future stories):
- **`trades`**: Append-only trade history. Written async-batched from in-memory buffer (Epic 2). Read for trade history view (Epic 5).
- **`positions`**: Mirrors live in-memory positions for crash recovery. On restart, the bot detects orphaned positions here and closes them (Epic 3). Rows deleted when position is closed.
- **`sessions`**: Per-session aggregates. Created on bot start, updated on stop. `endTime` is null while session is active.
- **`config`**: Key-value store for persisted user settings (fund allocations, pair selections, slippage). Read on startup, written on user config changes.

### What NOT to Do

- Do NOT add indexes yet — premature optimization. Add when query patterns are established in Epic 2.
- Do NOT create repository/DAO abstractions — direct Drizzle queries are the pattern. No `TradeRepository` class.
- Do NOT add seed data or mock data — tables start empty.
- Do NOT use `@shared/` types in the schema file — schema is server-only. Shared types will reference these in Story 2.1.
- Do NOT use `text({ mode: 'json' })` for any column — keep the schema simple with primitive types.
- Do NOT add `createdAt`/`updatedAt` columns — the `timestamp` column serves this purpose for trades and positions. Sessions have explicit `startTime`/`endTime`.
- Do NOT import from `drizzle-orm/pg-core` or `drizzle-orm/mysql-core` — SQLite only.

### Project Structure Notes

Files created/modified by this story:
```
src/server/db/
├── schema.ts          # MODIFY — full Drizzle schema (trades, positions, sessions, config)
├── index.ts           # MODIFY — fix DB path, add error handling, WAL mode, closeDb()
├── schema.test.ts     # NEW — schema validation tests
└── migrations/        # GENERATED — by drizzle-kit generate
    ├── 0000_*.sql
    └── meta/
```

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#Data Architecture] — Schema design table with columns and rationale
- [Source: _bmad-output/planning-artifacts/architecture.md#Database Naming Conventions] — camelCase tables and columns
- [Source: _bmad-output/planning-artifacts/architecture.md#Caching Strategy] — In-memory maps + async-batched SQLite writes
- [Source: _bmad-output/planning-artifacts/architecture.md#Graceful Shutdown] — closeDb() needed for shutdown sequence step 5
- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.2] — Acceptance criteria
- [Source: _bmad-output/project-context.md#Boundary Rules] — `src/server/db/` is the ONLY code that imports better-sqlite3
- [Source: _bmad-output/implementation-artifacts/1-1-project-scaffolding-and-dev-environment.md#Review Findings] — Deferred DB fixes
- [Source: _bmad-output/planning-artifacts/architecture.md#Migration Strategy] — drizzle-kit generate + migrate, schema-first

### Latest Technology Notes (April 2026)

- **Drizzle ORM 0.45.2** — Use `int()` or `integer()` (both work). Use `real()` for floating-point. Use `text()` for strings. Import from `drizzle-orm/sqlite-core`.
- **drizzle-kit 0.31.10** — `generate` creates SQL migration files. `migrate` applies them. Config in `drizzle.config.ts` with `defineConfig()`.
- **better-sqlite3 12.8.0** — Synchronous SQLite driver. WAL mode recommended for concurrent reads during async-batched writes.
- **Type inference** — Use `typeof table.$inferSelect` and `typeof table.$inferInsert` for inferred types. Do NOT manually duplicate types.

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- `drizzle-kit migrate` required `dbCredentials.url` in `drizzle.config.ts` — added `url: './valbot.db'` to fix.

### Completion Notes List

- **Task 1:** Defined full Drizzle schema in `src/server/db/schema.ts` with all four tables (trades, positions, sessions, config) using correct SQLite column types, camelCase naming, and exported `$inferSelect`/`$inferInsert` types for each table.
- **Task 2:** Rewrote `src/server/db/index.ts` — resolved DB path relative to project root via `fileURLToPath(import.meta.url)`, added try/catch error handling, enabled WAL mode, and exported `closeDb()` for graceful shutdown.
- **Task 3:** Generated migration via `pnpm db:generate` (produced `0000_cooing_gamora.sql`), ran `pnpm db:migrate` successfully, verified all four tables created with correct camelCase columns. Added `dbCredentials.url` to `drizzle.config.ts` to fix migrate command.
- **Task 4:** Created 12 co-located tests in `src/server/db/schema.test.ts` covering: table creation in in-memory DB, insert/select round-trips, notNull constraints, config key-as-PK, sessions nullable endTime, and type export verification. All 12 tests pass. Full suite (13 tests) passes with no regressions.

### Change Log

- 2026-04-04: Implemented Story 1.2 — Database Schema & Migration Setup. Defined Drizzle ORM schema for trades, positions, sessions, and config tables. Fixed DB connection with resolved path, error handling, WAL mode, and closeDb(). Generated and applied migrations. Added 12 schema tests. Updated drizzle.config.ts with dbCredentials.

### File List

- `src/server/db/schema.ts` — MODIFIED — Full Drizzle schema with 4 tables and exported types
- `src/server/db/index.ts` — MODIFIED — Fixed DB path, error handling, WAL mode, closeDb()
- `src/server/db/schema.test.ts` — NEW — 12 co-located schema tests
- `src/server/db/migrations/0000_cooing_gamora.sql` — GENERATED — Initial migration SQL
- `src/server/db/migrations/meta/` — GENERATED — Drizzle migration metadata
- `drizzle.config.ts` — MODIFIED — Added dbCredentials.url for migrate command

### Review Findings

- [x] [Review][Decision] DB path resolution breaks when running from compiled `dist/` output — resolved: added `VALBOT_DB_PATH` env var with fallback to project-root resolution [src/server/db/index.ts:8-10]
- [x] [Review][Patch] DB path mismatch between `drizzle.config.ts` and `index.ts` — fixed: config now uses `process.env.VALBOT_DB_PATH || './valbot.db'` [drizzle.config.ts:8]
- [x] [Review][Patch] `closeDb()` has no guard against double-close — fixed: added `sqlite.open` check before closing [src/server/db/index.ts:25-27]
- [x] [Review][Patch] WAL pragma result not verified — fixed: now checks return value and warns if WAL not activated [src/server/db/index.ts:17-19]
- [x] [Review][Patch] Test `createTestDb()` duplicates schema SQL manually — fixed: tests now read actual migration files to avoid drift [src/server/db/schema.test.ts]
- [x] [Review][Defer] `real` type for financial fields — architecture spec mandates `real()` for numbers; cannot change without architecture decision — deferred
- [x] [Review][Patch] No CHECK constraints on `side` columns — fixed: added CHECK constraints enforcing `IN ('Long', 'Short')` on trades and positions [src/server/db/schema.ts]
- [x] [Review][Defer] Module-level side effect: DB opens on import — architectural pattern per spec (`export const db`); changing to lazy init would require updating all future importers — deferred
- [x] [Review][Patch] No `busy_timeout` pragma — fixed: added `busy_timeout = 5000` for concurrent WAL access [src/server/db/index.ts:21]

### Review Findings (Round 2 — 2026-04-04)

- [x] [Review][Decision] `positions.mode` column not in AC3 spec — confirmed spec omission: `mode` is correct and needed for multi-mode operation. AC3 text should be updated.
- [x] [Review][Patch] `getDb()` partial-init leaks `_sqlite` if `drizzle()` throws — fixed: catch block now closes and nulls `_sqlite` before re-throwing [src/server/db/index.ts:27-31]
- [x] [Review][Patch] Tests don't cover CHECK constraints on `side` column — fixed: added 2 tests for invalid side values on trades and positions [src/server/db/schema.test.ts]
- [x] [Review][Patch] `readMigrationSql()` sorts lexicographically — fixed: now uses numeric sort on filename prefix [src/server/db/schema.test.ts:27]
- [x] [Review][Patch] `VALBOT_DB_PATH` env var not documented in `.env.example` — fixed: added to .env.example [.env.example]
- [x] [Review][Patch] `closeDb()` then `getDb()` silently re-opens DB — fixed: added `_closed` flag, `getDb()` throws after `closeDb()` [src/server/db/index.ts:16-18]
- [x] [Review][Patch] SQLite integer values above `Number.MAX_SAFE_INTEGER` lose precision via `better-sqlite3` — fixed: added `assertSafeInteger()` guard in schema.ts for callers to validate before writes [src/server/db/schema.ts]
- [x] [Review][Patch] No migration guard — `getDb()` returns handle to unmigrated DB — fixed: added table existence check on init [src/server/db/index.ts:30-35]
- [x] [Review][Patch] `drizzle.config.ts` DB path is CWD-relative vs `index.ts` absolute path — fixed: now uses `__dirname`-anchored resolution [drizzle.config.ts:5-6]
- [x] [Review][Patch] `__dirname` ESM shim breaks when bundled — fixed: replaced `import.meta.url` traversal with `process.cwd()` in both index.ts and drizzle.config.ts [src/server/db/index.ts, drizzle.config.ts]
- [x] [Review][Patch] `getDb()`/`closeDb()` have no unit tests — fixed: added 4 tests covering init, singleton, close guard, and safe double-close [src/server/db/schema.test.ts]
