# Story 8.9: SQLite WAL Persistence Fix

Status: done

## Story

As theRoad,
I want config changes (max allocation, per-mode allocation, position size) to survive server restarts during development,
So that I don't lose settings every time `tsx watch` restarts the process.

## Problem & Discovery

After setting Max Allocation to $5,000 via the dashboard, the value reverted to the default $500 on the next `tsx watch` restart. The API call succeeded (HTTP 200, sub-1ms response), and no errors appeared in browser console or server logs. The `config` table had no `maxAllocation` row despite the successful write.

## Root Cause

SQLite WAL mode with default `synchronous = NORMAL` does not fsync writes to the WAL file immediately. The write lands in the OS page cache but is not guaranteed on disk until the next checkpoint or fsync.

During development, `tsx watch` detects file changes and hard-kills the Node process (no SIGINT/SIGTERM delivered). The graceful shutdown handler (`src/server/lib/shutdown.ts`) never runs, so `closeDb()` never executes, and the WAL is never checkpointed. The OS page cache is discarded with the process, and the unflushed WAL writes are lost.

Evidence:
- `valbot.db-shm` and `valbot.db-wal` files present in working directory (unclean shutdown)
- `SELECT * FROM config WHERE key = 'maxAllocation'` returned zero rows after restart
- `PRAGMA wal_checkpoint(FULL)` confirmed no pending data — the writes were already gone

This affects **all** config writes (allocations, position sizes, max allocation) — any write that happens shortly before a `tsx watch` restart is at risk.

## Acceptance Criteria

1. **Given** the user sets Max Allocation to $5,000, **When** `tsx watch` restarts the server, **Then** the Max Allocation is still $5,000 after reload.
2. **Given** the user sets a per-mode allocation, **When** the server restarts, **Then** the allocation persists.
3. **Given** the user sets a position size, **When** the server restarts, **Then** the position size persists.
4. **Given** `synchronous = FULL` is set, **When** `setMaxAllocation()` returns, **Then** the data is fsynced to disk (not just in page cache).
5. **Given** the pragma is added, **When** running the full test suite, **Then** all existing tests still pass.
6. **Given** the user enters a max allocation up to $100,000, **When** submitting via the UI, **Then** the value is accepted by both client and server validation.
7. **Given** the bot is running or the user changes allocation values, **When** DB writes occur, **Then** the dashboard does NOT trigger a full page refresh.

## Tasks / Subtasks

- [x] Task 1: Add `synchronous = FULL` pragma to DB initialization (AC: 1, 2, 3, 4)
  - [x] 1.1 Add `_sqlite.pragma('synchronous = FULL')` after `busy_timeout` in `src/server/db/index.ts:29`

- [x] Task 2: Raise max allocation cap from $10,000 to $100,000 (AC: 6)
  - [x] 2.1 Change `MAX` constant in `src/server/engine/fund-allocator.ts:214` from `10_000_000_000` to `100_000_000_000`, update error messages
  - [x] 2.2 Change Fastify schema `maximum` in `src/server/api/mode.ts:80` from `10000` to `100000`
  - [x] 2.3 Change client validation in `src/client/components/max-allocation-control.tsx:29` from `10000` to `100000`
  - [x] 2.4 Update test assertion in `src/server/engine/fund-allocator.test.ts` from $10K to $100K

- [x] Task 3: Fix dev page refresh caused by Vite watching SQLite DB files (AC: 7)
  - [x] 3.1 Add `server.watch.ignored` for `valbot.db*` files in `vite.config.ts`
  - [x] 3.2 Add `--exclude` for DB files to `tsx watch` in `package.json`

- [x] Task 4: Verification (AC: 1–7)
  - [x] 3.1 `pnpm test src/server/db/` — 23 tests passed across 2 files
  - [x] 3.2 `pnpm test src/server/engine/fund-allocator src/server/api/mode` — 72 tests passed across 2 files
  - [x] 3.3 Manual: Set Max Allocation to $5,000, restart server, confirm value persists

## Dev Notes

### Key Files

- `src/server/db/index.ts:29` — New pragma added after `busy_timeout`
- `src/server/engine/fund-allocator.ts:214` — Max allocation cap raised to $100K
- `src/server/api/mode.ts:80` — Fastify schema max raised to 100000
- `src/client/components/max-allocation-control.tsx:29` — Client validation max raised to 100000
- `vite.config.ts:15-17` — Vite watcher ignores SQLite DB files
- `package.json:9` — tsx watch excludes SQLite DB files

### Why This Fix Works

SQLite's `synchronous = FULL` forces an fsync after every transaction commit, ensuring data reaches the physical disk (not just OS cache) before the write call returns. This means even if the process is killed immediately after `setMaxAllocation()` completes, the WAL file on disk contains the committed data. On the next startup, SQLite's WAL recovery replays it into the main database file.

The performance cost is negligible for this application — config writes happen only on user interaction (seconds apart at minimum), not in hot trading paths.

However, `synchronous = FULL` causes more frequent/reliable disk writes to the WAL file. Vite's dev server file watcher monitors the project root by default, and was detecting `valbot.db` / `valbot.db-wal` / `valbot.db-shm` changes as file modifications — triggering full page reloads. This was a pre-existing issue (visible on allocation changes) but became much worse with `FULL` sync. Fixed by adding `server.watch.ignored` in `vite.config.ts` and `--exclude` flags on `tsx watch` in `package.json`.

### Why Not Other Approaches

- **WAL checkpoint after each write**: More invasive, requires changes in every write site (`fund-allocator.ts`, etc.)
- **Switch to `journal_mode = DELETE`**: Loses WAL's read concurrency benefits
- **`synchronous = FULL` (chosen)**: Single-line change, zero API surface change, protects all writes globally

### File List

- `src/server/db/index.ts`
- `src/server/engine/fund-allocator.ts`
- `src/server/engine/fund-allocator.test.ts`
- `src/server/api/mode.ts`
- `src/client/components/max-allocation-control.tsx`
- `vite.config.ts`
- `package.json`
- `_bmad-output/implementation-artifacts/8-9-sqlite-wal-persistence-fix.md`

### Review Findings

- [x] [Review][Patch] positionSize API schema max still $10K — should match maxAllocation cap [src/server/api/mode.ts:79]
- [x] [Review][Patch] Input field w-24 too narrow for 6-digit values near $100,000 [src/client/components/max-allocation-control.tsx:54]
- [x] [Review][Patch] synchronous=FULL pragma now verified like WAL pragma [src/server/db/index.ts:29] — fixed
- [x] [Review][Patch] Client fallback default replaced with null + loading placeholder [src/client/components/max-allocation-control.tsx:9] — fixed

### Review Findings (Round 2)

- [x] [Review][Patch] synchronous=FULL verification should coerce to number to avoid false-alarm if better-sqlite3 returns string [src/server/db/index.ts:30-33] — fixed
- [x] [Review][Patch] Add boundary test that exactly $100,000 (100_000_000_000) is accepted [src/server/engine/fund-allocator.test.ts] — fixed
- [x] [Review][Patch] Dollar sign `$` always rendered even when maxAllocation is null — shows `$—` instead of just `—` [src/client/components/max-allocation-control.tsx:50-53] — fixed
- [x] [Review][Defer] Missing client-side max validation on positionSize input in mode-card [src/client/components/mode-card.tsx:299] — fixed: added `numVal <= 100000` upper bound
- [x] [Review][Defer] Concurrent allocation updates not atomic — race condition on total allocation check [src/server/engine/fund-allocator.ts:57-68] — dismissed: Node.js is single-threaded, setAllocation is synchronous, no actual race possible
- [x] [Review][Defer] Position size not cleared when allocation set to zero [src/server/engine/fund-allocator.ts:76-80] — fixed: removed `amount > 0` guard so positionSize clears on zero allocation
- [x] [Review][Defer] No cross-field validation that positionSize <= maxAllocation [src/server/api/mode.ts] — dismissed: backend already enforces positionSize <= allocation in setPositionSize (fund-allocator.ts:257)
