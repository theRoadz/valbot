# Story 5.1: Session Persistence & Cross-Session Profit Tracking

Status: done

## Story

As theRoad,
I want the bot to persist session data and track total profit across all sessions,
So that I can see my cumulative performance over time, not just the current session.

## Acceptance Criteria

1. **New session record on trading start** — Given the bot starts a new trading session, when any mode begins trading, then a new session record is created in the `sessions` table with `startTime` and `mode`
2. **Running totals during session** — Given a trading session is active, when trades execute, then the session record is updated with running totals: trade count, volume, and PnL
3. **Session finalization on shutdown** — Given the bot shuts down (gracefully or via kill switch), when the shutdown completes, then the session record is finalized with `endTime` and final stats, and the in-memory trade buffer is flushed to the trades table
4. **Cross-session Total Profit on dashboard** — Given the bot starts and previous sessions exist in the database, when the dashboard loads, then Total Profit in the SummaryBar aggregates PnL from all historical sessions plus the current session (FR20), and Session PnL in the SummaryBar shows only the current session's PnL, and `GET /api/status` returns both `totalProfit` (all-time) and `sessionPnl` (current)

## Tasks / Subtasks

- [x] Task 1: Session lifecycle management in engine (AC: #1, #3)
  - [x] 1.1 Create `SessionManager` class in `src/server/engine/session-manager.ts` — responsible for creating, updating, and finalizing session records in the `sessions` table
  - [x] 1.2 `startSession(mode: ModeType)` — inserts a new row into `sessions` with `startTime = Date.now()`, `mode`, `trades = 0`, `volume = 0`, `pnl = 0`, `endTime = null`. Returns the session `id`
  - [x] 1.3 `updateSession(sessionId: number, tradeSize: number, tradePnl: number)` — increments `trades` by 1, adds `tradeSize` to `volume`, adds `tradePnl` to `pnl` (all smallest-unit integers)
  - [x] 1.4 `finalizeSession(sessionId: number)` — sets `endTime = Date.now()` on the session row
  - [x] 1.5 `getHistoricalStats()` — queries sum of `pnl`, `trades`, `volume` from ALL finalized sessions (`endTime IS NOT NULL`). Returns `{ totalPnl, totalTrades, totalVolume }` in smallest-unit
  - [x] 1.6 `getActiveSession(mode: ModeType)` — returns the active session (where `endTime IS NULL`) for a given mode, or `null`
  - [x] 1.7 Unit tests for all SessionManager methods in `src/server/engine/session-manager.test.ts`

- [x] Task 2: Integrate SessionManager into engine mode lifecycle (AC: #1, #2, #3)
  - [x] 2.1 In `startMode()` (`src/server/engine/index.ts`), after starting the ModeRunner, call `sessionManager.startSession(mode)` and store the returned `sessionId` in a `Map<ModeType, number>`
  - [x] 2.2 In `PositionManager.closePosition()` (`src/server/engine/position-manager.ts`), after `fundAllocator.recordTrade()`, call session update. **Dependency injection:** PositionManager receives dependencies via constructor (`fundAllocator`, `broadcast`, `onKillSwitch`). Add a `sessionManager: SessionManager` parameter to the constructor (or add a callback `onTradeRecorded?: (mode, size, pnl) => void`). Do NOT reference the engine module from PositionManager — that would create a circular dependency. Preferred approach: pass SessionManager as a constructor dependency alongside FundAllocator
  - [x] 2.3 In `stopMode()` and `forceStop()`, call `sessionManager.finalizeSession(sessionId)` and remove from the active session map
  - [x] 2.4 In `stopAllModes()` (graceful shutdown), finalize ALL active sessions before closing DB
  - [x] 2.5 Integration tests verifying session creates on start, updates on trade, finalizes on stop

- [x] Task 3: Update `/api/status` to include historical profit (AC: #4)
  - [x] 3.1 **Current /api/status response has NO `stats` field.** It returns `{ modes, positions, trades: [], connection }`. Add a new `stats` field to the response containing `totalPnl` and `sessionPnl` (both display-unit via `fromSmallestUnit()`)
  - [x] 3.2 Compute server-side: `totalPnl = sum(finalized sessions pnl) + sum(active modes' in-memory pnl from FundAllocator)`. `sessionPnl = sum(active modes' in-memory pnl)`. Both converted to display-unit at the API boundary
  - [x] 3.3 Do NOT modify `SummaryStats` in `src/shared/types.ts` — it already has `totalPnl` and `sessionPnl` fields. Instead, ensure the server response matches what the client expects
  - [x] 3.4 Add `StatusResponse` type update if needed — current type in `shared/types.ts` may need a `stats` field added
  - [x] 3.5 Test `/api/status` returns correct totalPnl with historical + current data

- [x] Task 4: Update Zustand store to differentiate totalPnl from sessionPnl (AC: #4)
  - [x] 4.1 **Current state:** `aggregateSummaryStats()` sets `totalPnl` and `sessionPnl` to the SAME value (both sum `m.stats.pnl` from all modes). Fix: `sessionPnl` continues to sum current in-memory mode stats. `totalPnl` must incorporate the historical base from `/api/status`
  - [x] 4.2 In `loadInitialStatus()`, extract `stats.totalPnl` from the new `/api/status` response and store as `historicalPnlBase` (the all-time total from DB at load time). Then `totalPnl = historicalPnlBase + sessionPnl`
  - [x] 4.3 Update `aggregateSummaryStats()` to accept the historical base and compute: `totalPnl = historicalPnlBase + allModes.reduce(pnl)`, `sessionPnl = allModes.reduce(pnl)` (unchanged)
  - [x] 4.4 `top-bar.tsx` already displays both "Total PnL" and "Session PnL" labels with correct formatting (`formatCurrency(..., true)`, `pnlColorClass()`, `font-mono`). No UI changes needed — just ensure the store feeds different values
  - [x] 4.5 Test store correctly distinguishes totalPnl from sessionPnl after initial load and after STATS_UPDATED events

- [x] Task 5: Handle edge cases and crash recovery (AC: #1, #3)
  - [x] 5.1 On engine startup in `initEngine()`, after `positionManager.loadFromDb()` and before reconciliation, call `sessionManager.finalizeOrphanedSessions()` to close any sessions with `endTime IS NULL` (orphaned from crash) — set `endTime = Date.now()` on all orphaned rows
  - [x] 5.2 If mode starts but no trades execute before stop → session has `trades = 0, volume = 0, pnl = 0` and gets finalized normally (no special case)
  - [x] 5.3 Kill-switch triggers `forceStop()` which must finalize the session for that mode only (other modes' sessions unaffected)
  - [x] 5.4 Tests for orphaned session recovery on startup and kill-switch session finalization

## Dev Notes

### Current State — Sessions Table Exists But Is Unused

The `sessions` table already exists in the DB schema (`src/server/db/schema.ts:36-45`) with columns: `id`, `startTime`, `endTime` (nullable), `mode`, `trades`, `volume`, `pnl`. Schema tests pass. **However, no production code creates, reads, or updates session records.** This story wires up the full lifecycle.

The `trades` table is already written to by `PositionManager.closePosition()` — each closed position inserts a row. This story does NOT change trade persistence — it adds session-level aggregation on top.

### Key Files to Touch

| File | Action | Reason |
|------|--------|--------|
| `src/server/engine/session-manager.ts` | **CREATE** | New session lifecycle manager |
| `src/server/engine/session-manager.test.ts` | **CREATE** | Unit tests |
| `src/server/engine/index.ts` | Modify | Integrate SessionManager into start/stop/forceStop |
| `src/server/engine/position-manager.ts` | Modify | Call sessionManager.updateSession on trade close |
| `src/server/api/status.ts` | Modify | Add historical stats to response |
| `src/shared/types.ts` | Modify | Add `stats` field to `StatusResponse` if missing (SummaryStats already has `totalPnl`/`sessionPnl`) |
| `src/client/store/index.ts` | Modify | Fix `aggregateSummaryStats()` to differentiate `totalPnl` (historical + current) from `sessionPnl` (current only) |
| `src/client/components/top-bar.tsx` | **No change expected** | Already displays "Total PnL" and "Session PnL" — just needs correct values from store |

### Architecture Compliance

- **DB boundary:** SessionManager uses Drizzle ORM queries only, via `getDb()`. No raw SQL.
- **Monetary values:** All DB values in smallest-unit integers (`integer()` columns). Conversion to display-unit only at API response boundary via `fromSmallestUnit()`.
- **Naming:** File `session-manager.ts` (kebab-case). DB columns `camelCase`. API response `camelCase`.
- **Error handling:** Use `AppError` from `server/lib/errors.ts` for any session-related errors. Include `resolution` field.
- **Lazy DB:** Use `getDb()` for every query — never cache the DB instance.

### Database Schema (Already Exists)

```typescript
// src/server/db/schema.ts — already defined (lines 36-45)
export const sessions = sqliteTable('sessions', {
  id: integer().primaryKey({ autoIncrement: true }),
  startTime: integer().notNull(),        // Unix ms
  endTime: integer(),                     // nullable — null while session active
  mode: text().notNull(),
  trades: integer().notNull().default(0), // count
  volume: integer().notNull().default(0), // smallest-unit
  pnl: integer().notNull().default(0),    // smallest-unit (signed)
});

// Types already exported (lines 60-61):
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
```

No migration needed — table already exists in migration 0000. Reuse `Session` and `NewSession` types from schema.ts — do NOT create duplicate types.

### SessionManager Design Pattern

Follow the same pattern as `FundAllocator` and `PositionManager`:
- Class with constructor that accepts dependencies (no global singletons)
- Methods use `getDb()` for each query
- All monetary math in smallest-unit integers
- Export instance from engine setup, pass to consumers

```typescript
// Pattern reference — similar to fund-allocator.ts
class SessionManager {
  startSession(mode: ModeType): number { /* INSERT, return id */ }
  updateSession(id: number, size: number, pnl: number): void { /* UPDATE trades+1, volume+=, pnl+= */ }
  finalizeSession(id: number): void { /* UPDATE endTime */ }
  getHistoricalStats(): { totalPnl: number; totalTrades: number; totalVolume: number } { /* SUM query */ }
  getActiveSession(mode: ModeType): { id: number; ... } | null { /* WHERE endTime IS NULL */ }
  finalizeOrphanedSessions(): number { /* UPDATE all WHERE endTime IS NULL, return count */ }
}
```

### Integration Points in Engine

**`startMode()` in `src/server/engine/index.ts`:**
```typescript
// After modeRunner.start() succeeds:
const sessionId = sessionManager.startSession(mode);
activeSessions.set(mode, sessionId);
```

**`closePosition()` in `src/server/engine/position-manager.ts`:**
```typescript
// After fundAllocator.recordTrade(mode, size, pnl) at line ~471:
// SessionManager is injected via PositionManager constructor (same pattern as fundAllocator)
// PositionManager must track active session IDs via a Map<ModeType, number> set by the engine
this.sessionManager.updateSession(this.activeSessions.get(pos.mode)!, pos.size, computedPnl);
```

**`stopMode()` / `forceStop()` in engine:**
```typescript
// After positions closed, before broadcasting MODE_STOPPED:
const sessionId = activeSessions.get(mode);
if (sessionId) { sessionManager.finalizeSession(sessionId); activeSessions.delete(mode); }
```

### API Response Shape Change

```typescript
// GET /api/status — ACTUAL current shape (src/server/api/status.ts lines 64-73):
{ modes: { volumeMax: {...}, profitHunter: {...}, arbitrage: {...} }, positions: [...], trades: [], connection: { status, equity, available } }
// NOTE: There is NO stats field currently. Stats are computed entirely client-side.

// GET /api/status — new shape (add stats field):
{ modes: {...}, positions: [...], trades: [], connection: {...}, stats: { totalPnl: number, sessionPnl: number } }
// totalPnl = fromSmallestUnit(sum finalized sessions pnl + sum active modes' in-memory pnl) — display-unit
// sessionPnl = fromSmallestUnit(sum active modes' in-memory pnl from FundAllocator) — display-unit
// NOTE: trades field is still hardcoded [] — trade history is Story 5.2 scope, do NOT implement here
```

### SummaryBar Display — Already Correct UI

`top-bar.tsx` already displays 6 stat items: Equity, Available, **Total PnL**, **Session PnL**, Trades, Volume. Both PnL values use `formatCurrency(value, true)` with `pnlColorClass()` for green/red/gray coloring and +/- prefix. **No UI changes needed** — the issue is that the store currently feeds identical values to both. This story fixes the store to provide the correct differentiated values.

### Graceful Shutdown Integration

**Clarification:** `stopAllModes()` calls `runner.stop()` on each ModeRunner via `Promise.allSettled()` — position closing happens INSIDE each ModeRunner's `stop()` method, not as a separate step in `stopAllModes()`. The sequence is:
1. `stopAllModes()` → calls `runner.stop()` on all runners in parallel (positions close inside each runner)
2. **This story adds:** after all runners stop, finalize ALL active sessions via `activeSessions` map
3. Then: clear runners, close DB

Kill-switch flow (`forceStop(mode)`) already closes positions and emits events. This story adds: **finalize the killed mode's session** after position closure, before `MODE_STOPPED` broadcast.

### Previous Story Learnings (from 4-4)

- 617 tests currently passing — do NOT break existing tests
- `Promise.allSettled` pattern used for parallel stop — session finalization must not throw and block other modes
- FundAllocator cross-mode isolation is absolute — SessionManager must similarly be per-mode with no cross-mode coupling
- Store uses `Object.values(modes)` for aggregation — historical PnL base should be stored separately in the store, NOT computed from mode entries
- Mock patterns: `vi.mock()` for module-level, `vi.fn()` for functions

### What NOT to Build

- Do NOT modify the `trades` table or trade insertion logic — that already works correctly
- Do NOT add a new migration — `sessions` table already exists
- Do NOT create a session history list/view UI — that's Story 5.2
- Do NOT add per-mode historical stats breakdown — that's Story 5.3
- Do NOT add authentication or session tokens — sessions here means "trading sessions"
- Do NOT batch session updates — SQLite writes are fast enough for per-trade updates given single-user local bot
- Do NOT fix the hardcoded `trades: []` in `/api/status` or the empty `/api/trades` endpoint — trade history implementation is Story 5.2
- Do NOT create new Session types in `shared/types.ts` — reuse `Session` and `NewSession` from `src/server/db/schema.ts` (lines 60-61)

### Deferred Work Items to Be Aware Of

- `loadFromDb` bypasses cross-mode total allocation validation (Story 4-4 deferred)
- `setAllocation(mode, 0)` with open positions leaves stale accounting (Story 4-4 deferred)
- These do NOT block this story but may affect integration testing

### Testing Patterns

- Co-locate tests: `session-manager.test.ts` next to `session-manager.ts`
- **No shared test helpers exist.** Each test file defines its own inline `setupTestDb()`. Follow the established pattern from `fund-allocator.test.ts` or `position-manager.test.ts`:
  ```typescript
  function setupTestDb() {
    process.env.VALBOT_DB_PATH = TEST_DB_PATH;
    _resetDbState();  // from src/server/db/index.ts — resets lazy DB singleton
    const db = getDb();
    db.run(sql`CREATE TABLE IF NOT EXISTS sessions (...)`);
    // Create other tables if needed for integration tests
  }
  afterEach(() => {
    closeDb();
    _resetDbState();
    try { fs.unlinkSync(TEST_DB_PATH); } catch { /* ignore */ }
    try { fs.unlinkSync(TEST_DB_PATH + "-wal"); } catch { /* ignore */ }
    try { fs.unlinkSync(TEST_DB_PATH + "-shm"); } catch { /* ignore */ }
  });
  ```
- **Critical:** Import `_resetDbState` from `src/server/db/index.ts` — without this, test DB connections leak between test runs
- Use `vi.fn()` for mocking SessionManager methods in engine integration tests
- Verify with `getDb().select().from(sessions).all()` in assertions

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 5, Story 5.1]
- [Source: _bmad-output/planning-artifacts/architecture.md — Database Schema, Sessions Table, Caching Strategy, Graceful Shutdown]
- [Source: _bmad-output/planning-artifacts/prd.md — FR19, FR20, FR21, FR22, FR23]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — SummaryBar, Journey 4 Monitoring]
- [Source: _bmad-output/implementation-artifacts/4-4-parallel-mode-execution-and-independent-control.md — Previous story learnings]
- [Source: src/server/db/schema.ts — Existing sessions table schema]
- [Source: src/server/engine/position-manager.ts — Trade insertion on closePosition()]
- [Source: src/client/store/index.ts — aggregateSummaryStats(), STATS_UPDATED handler]
- [Source: src/client/components/top-bar.tsx — Current SummaryBar display]
- [Source: src/server/api/status.ts — Current /api/status response]
- [Source: _bmad-output/project-context.md — All implementation rules]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
- SessionManager SQL update uses raw column names in sql template (`"trades" + 1`) for Drizzle ORM compatibility
- PositionManager uses `onTradeRecorded` callback pattern (not direct SessionManager injection) to avoid circular dependency between engine and position-manager modules
- Store computes `historicalPnlBase = stats.totalPnl - stats.sessionPnl` from API response, stores separately, and adds to sessionPnl in aggregation

### Completion Notes List
- Created `SessionManager` class with 6 methods: startSession, updateSession, finalizeSession, getHistoricalStats, getActiveSession, finalizeOrphanedSessions
- Integrated SessionManager into engine lifecycle: startMode creates sessions, stopMode/forceStop/stopAllModes finalize them, kill-switch callback finalizes killed mode's session
- Added `onTradeRecorded` callback to PositionManager constructor; engine wires it to SessionManager.updateSession via activeSessions map
- Added `stats: { totalPnl, sessionPnl }` field to `/api/status` response; totalPnl = historical DB sum + current session, sessionPnl = current session only
- Added `stats?` optional field to `StatusResponse` type in shared/types.ts
- Fixed Zustand store `aggregateSummaryStats()` to accept `historicalPnlBase` parameter; totalPnl = base + session sum, sessionPnl = session sum only
- `loadInitialStatus()` extracts historicalPnlBase from server stats and stores it for use in all subsequent aggregations
- `initEngine()` calls `finalizeOrphanedSessions()` on startup to close any sessions orphaned by crash
- 22 new tests added (15 unit + 3 integration + 3 store + 1 orphan recovery), all 639 tests pass

### Change Log
- 2026-04-07: Story 5.1 implementation complete — session persistence and cross-session profit tracking

### File List
- `src/server/engine/session-manager.ts` — **NEW** — SessionManager class
- `src/server/engine/session-manager.test.ts` — **NEW** — 15 unit tests
- `src/server/engine/index.ts` — Modified — SessionManager integration, activeSessions map, orphan finalization
- `src/server/engine/index.test.ts` — Modified — 3 integration tests for session tracking
- `src/server/engine/position-manager.ts` — Modified — onTradeRecorded callback in constructor and closePosition
- `src/server/api/status.ts` — Modified — getStats() function, stats field in response
- `src/shared/types.ts` — Modified — stats? field added to StatusResponse
- `src/client/store/index.ts` — Modified — historicalPnlBase state, updated aggregateSummaryStats, loadInitialStatus
- `src/client/store/index.test.ts` — Modified — 3 tests for historical PnL differentiation

### Review Findings

- [x] [Review][Decision] **SessionManager does not wrap DB errors in `AppError`** — Dismissed: session tracking is non-critical; callers already guard with try/catch. Consistent with project patterns (getStats, getConnectionData use bare catch with defaults).
- [x] [Review][Decision] **`sql` template literals used as raw SQL fragments** — Resolved: refactored `getActiveSession` WHERE to use `and(eq(...), isNull(...))`. Aggregation/increment queries accepted as valid Drizzle `sql` API usage (no query-builder equivalent).
- [x] [Review][Patch] **`startMode` overwrites `activeSessions` without checking for existing session** — Fixed: added guard to finalize existing session before creating new one. [engine/index.ts]
- [x] [Review][Patch] **`sessionManager!` non-null assertion in `onTradeRecorded` callback** — Fixed: replaced with `if (sessionManager)` guard. [engine/index.ts]
- [x] [Review][Patch] **`stopAllModes` iteration over `activeSessions` can conflict with kill-switch callback** — Fixed: snapshot entries and clear map before iterating. [engine/index.ts]
- [x] [Review][Patch] **`getActiveSession` return type has `mode: string` instead of `mode: ModeType`** — Fixed: updated return type and refactored WHERE clause to use Drizzle operators. [session-manager.ts]
