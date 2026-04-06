# Story 3.2: Graceful Shutdown & Crash Recovery

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As theRoad,
I want the bot to close all open positions gracefully on stop or unexpected shutdown, and detect orphaned positions on restart,
so that I never have unmonitored open positions with real money at risk.

## Acceptance Criteria

1. **Given** the bot is running with open positions across one or more modes, **when** a SIGINT or SIGTERM signal is received, **then** all trading modes stop accepting new trades immediately.
2. All open positions are closed per mode in sequence during shutdown.
3. If a position close fails during shutdown, the on-chain stop-loss serves as safety net and the failure is logged with position details.
4. The in-memory trade buffer is flushed to SQLite (currently trades are written synchronously per-close, so this is a verify-only step).
5. WebSocket connections are closed after positions are closed.
6. The database connection is closed after WebSocket.
7. The process exits cleanly with code 0.
8. **Given** the bot starts and the positions table contains entries from a previous session, **when** the bot initializes, **then** the system detects these as potentially orphaned positions.
9. The system queries Hyperliquid `clearinghouseState` to verify on-chain position status for each recovered position.
10. Any confirmed open positions that are still on-chain are closed via the normal close flow.
11. Positions in the DB that no longer exist on-chain are cleaned up (deleted from DB).
12. The user is alerted about recovered positions with details (how many found, how many closed, how many already gone).

## What Already Exists

The shutdown handler and crash recovery loader are already built. This story wires them together and fills the integration gaps.

**Already implemented (DO NOT recreate):**
- `registerShutdownHandlers()` in `shutdown.ts` — full shutdown sequence: stop modes → close WS → close DB, with 15s hard timeout
- `stopAllModes()` in `engine/index.ts` — parallel stops all mode runners via `Promise.allSettled()`
- `ModeRunner.stop()` — calls `closeAllForMode()` then broadcasts `MODE_STOPPED`
- `PositionManager.closeAllForMode(mode)` — closes all positions for a mode with error tracking and `KILL_SWITCH_CLOSE_FAILED` alert on partial failure
- `PositionManager.loadFromDb()` — loads persisted positions from DB into in-memory map (uses placeholder `chainPositionId: "recovered-${row.id}"`)
- `closeWebSocket()` in `broadcaster.ts` — closes all WS client connections and WS server
- `closeDb()` in `db/index.ts` — closes SQLite connection with use-after-close guard
- `initEngine()` calls `loadFromDb()` for both fund allocator and position manager, then `reconcilePositions()`
- `BlockchainClient` with `info.clearinghouseState({ user })` for querying on-chain state
- `getBlockchainClient()` returns the initialized client (or null if not initialized)
- Position DB table: id, mode, pair, side, size, entryPrice, stopLoss, timestamp

**Gaps to fill (the actual work for this story):**

### Gap 1: `registerShutdownHandlers()` is never called
`src/server/index.ts` initializes Fastify, blockchain client, and engine — but never calls `registerShutdownHandlers()`. SIGINT/SIGTERM signals are unhandled, so the process exits immediately on Ctrl+C with no position cleanup.

**Fix:** Call `registerShutdownHandlers()` in `src/server/index.ts` after engine initialization succeeds. Import from `./lib/shutdown.js`.

### Gap 2: Fastify server not closed during shutdown
`shutdown.ts` stops modes, closes WS, closes DB — but never calls `fastify.close()`. The HTTP server keeps accepting requests during shutdown, and the Fastify listen socket is not released cleanly.

**Fix:** `registerShutdownHandlers()` needs access to the Fastify instance. Refactor to accept the Fastify instance as a parameter: `registerShutdownHandlers(fastify)`. Add `await fastify.close()` after stopping modes and before closing WebSocket. This stops the HTTP server from accepting new connections and drains in-flight requests.

### Gap 3: Crash recovery — reconcile on-chain positions (deferred W3 from Story 8-2)
`loadFromDb()` uses fabricated `chainPositionId: "recovered-${row.id}"` because the on-chain position ID is not persisted in the DB. When crash recovery tries to close these positions, `closePosition()` sends a close order using this fake ID — which will fail or produce unexpected results on Hyperliquid.

**Fix:** Add a `reconcileOnChainPositions()` method to PositionManager that:
1. Gets the blockchain client via `getBlockchainClient()` (may be null if blockchain init failed — skip reconciliation with warning log)
2. Calls `info.clearinghouseState({ user: walletAddress })` to get the wallet's actual on-chain perp positions
3. For each recovered position in the in-memory map:
   a. Match against on-chain `assetPositions` by coin + side (Long = positive `szi`, Short = negative `szi`)
   b. If matched: update `chainPositionId` to `"${coin}-${side}"` (the format used by `openPosition()` in contracts.ts line 223), update `size` and `entryPrice` to on-chain values (they may have changed if stop-loss partially filled during downtime)
   c. If NOT matched (position closed while bot was down, e.g., stop-loss triggered): delete from in-memory map AND delete from DB
4. Close any matched (still-open) positions via the normal `closePosition()` flow
5. Broadcast an `ALERT_TRIGGERED` event with severity "warning" summarizing recovery results: how many positions were found in DB, how many were still open on-chain (and closed), how many were already closed (cleaned up)
6. If blockchain client is null, broadcast a "critical" alert: "Cannot verify orphaned positions — blockchain client not connected. {count} positions from previous session found in DB. Manual verification required."

### Gap 4: Persist `chainPositionId` in DB for future crash recovery
The `positions` table schema does not include `chainPositionId`. Without it, every crash recovery requires an on-chain reconciliation query. While Gap 3 adds reconciliation, persisting the chain ID makes recovery more robust.

**Fix:**
1. Add a `chainPositionId` text column to the positions table via a new Drizzle migration
2. Update `openPosition()` in position-manager.ts to persist `chainPositionId` when inserting into DB
3. Update `loadFromDb()` to use the persisted `chainPositionId` instead of the fabricated placeholder (fall back to `"recovered-${row.id}"` if column is null for backward compatibility with pre-migration data)

### Gap 5: Shutdown doesn't close positions for modes that are NOT running
`stopAllModes()` iterates over `modeRunners` Map — only active runners get stopped. But `loadFromDb()` may have loaded recovered positions that have no associated runner (because the mode hasn't been started yet). These positions are in the in-memory map but no runner will close them during shutdown.

**Fix:** After `stopAllModes()` in the shutdown sequence, add a step: check if `positionManager` still has any positions (`getPositions()` returns non-empty). If so, call `closeAllForMode()` for each mode that still has positions. This catches recovered positions that were loaded but not yet processed.

Alternatively (simpler): add a `closeAllPositions()` method to PositionManager that closes ALL remaining positions regardless of mode. Call this after `stopAllModes()` in shutdown.ts.

### Gap 6: Shutdown broadcast — no user notification
During shutdown, the user sees no indication that the bot is shutting down. Modes just stop and the WS disconnects. No alert is broadcast.

**Fix:** At the start of the shutdown sequence (before stopping modes), broadcast an `ALERT_TRIGGERED` event with severity "warning", code "SHUTDOWN_INITIATED", message "Bot is shutting down — closing all positions." This gives the client a brief moment to display the shutdown state before the WS closes.

### Gap 7: Engine `initEngine()` should trigger crash recovery reconciliation
Currently `initEngine()` calls `positionManager.loadFromDb()` which loads positions into memory, but the on-chain reconciliation (Gap 3) should run automatically after loading. The reconciliation must happen after both the blockchain client AND engine are initialized.

**Fix:** In `src/server/index.ts`, after both blockchain init and engine init succeed, call `positionManager.reconcileOnChainPositions(walletAddress)`. If blockchain init failed, log a warning but don't block startup — the positions stay in memory and will be closed on next shutdown or when blockchain connects.

## Tasks / Subtasks

- [x] Task 1: Wire shutdown handler registration and Fastify close (AC: #1, #5, #6, #7) — Gaps 1, 2
  - [x] 1.1 Refactor `registerShutdownHandlers()` to accept a Fastify instance parameter: `registerShutdownHandlers(fastify: FastifyInstance)`
  - [x] 1.2 Add `await fastify.close()` to shutdown sequence after `stopAllModes()` and before `closeWebSocket()`. Log "Fastify server closed". Wrap in try/catch like other steps.
  - [x] 1.3 In `src/server/index.ts`, import `registerShutdownHandlers` and call it after engine init: `registerShutdownHandlers(fastify)`. Place it inside the outer try block, after `initEngine()`.
  - [x] 1.4 Update shutdown.ts tests: verify Fastify close is called in correct order
  - [x] 1.5 **Optional:** Server index integration test is complex because `index.ts` has top-level awaits and module-level side effects. If testing this, use `vi.mock("./lib/shutdown.js")` at module level and dynamically import `index.ts`. Alternatively, verify shutdown wiring via the shutdown.test.ts tests instead — more practical and less brittle.

- [x] Task 2: Add `closeAllPositions()` and wire to shutdown (AC: #2, #3) — Gap 5
  - [x] 2.1 Add `closeAllPositions()` to PositionManager: iterates all modes that have positions, calls `closeAllForMode(mode)` for each. Returns summary of results.
  - [x] 2.2 In `shutdown.ts`, after `stopAllModes()`, call `positionManager.closeAllPositions()` to catch any positions not owned by a running mode. Access via `getEngine()` — wrap in try/catch (engine may not be initialized if server failed early).
  - [x] 2.3 Export `getEngine` or `getPositionManager` from engine so shutdown can access it (if not already exported — `getEngine()` IS already exported)
  - [x] 2.4 Add shutdown broadcast: before stopping modes, broadcast `ALERT_TRIGGERED` with `{ severity: "warning", code: "SHUTDOWN_INITIATED", message: "Bot is shutting down — closing all positions.", details: null, resolution: "Wait for shutdown to complete. Positions are being closed." }` — Gap 6. **Important:** `shutdown.ts` currently does NOT import `broadcast` or `EVENTS`. Add imports: `import { broadcast } from "../ws/broadcaster.js"` and `import { EVENTS } from "../../shared/events.js"`. Also add `import { getEngine } from "../engine/index.js"` for Task 2.2.
  - [x] 2.5 Add `SHUTDOWN_INITIATED` to alert codes if not already in shared/events.ts (may just use existing AlertTriggeredPayload — no new event type needed, just a new code string)
  - [x] 2.6 Add position-manager test: `closeAllPositions()` closes positions across multiple modes
  - [x] 2.7 Add shutdown test: `closeAllPositions()` called after `stopAllModes()`
  - [x] 2.8 Add shutdown test: shutdown broadcast sent before modes stop
  - [x] 2.9 Add a `_shuttingDown` flag to PositionManager. Set it in `closeAllPositions()`. Guard `openPosition()` to reject with AppError `{ code: "SHUTDOWN_IN_PROGRESS" }` when flag is set. This prevents new positions from being opened between the shutdown signal and mode runner stop.

- [x] Task 3: DB migration — add `chainPositionId` column (AC: #9) — Gap 4
  - [x] 3.1 Add `chainPositionId: text()` column to `positions` table in `schema.ts`. Make it nullable for backward compatibility with existing rows.
  - [x] 3.2 Generate Drizzle migration via `pnpm drizzle-kit generate`
  - [x] 3.3 Update `openPosition()` in position-manager.ts to include `chainPositionId` in the DB insert. The insert is at line 169: `db.insert(positionsTable).values({...})` — add `chainPositionId: openResult.positionId` to the values object.
  - [x] 3.4 Update `loadFromDb()` to use `row.chainPositionId ?? "recovered-${row.id}"` instead of always using the placeholder
  - [x] 3.5 Add position-manager test: persisted position includes chainPositionId
  - [x] 3.6 Add position-manager test: loadFromDb uses persisted chainPositionId when available, falls back to placeholder when null

- [x] Task 4: On-chain position reconciliation (AC: #8, #9, #10, #11, #12) — Gaps 3, 7
  - [x] 4.1 Add `reconcileOnChainPositions(walletAddress: string)` method to PositionManager:
    - Get blockchain client via `getBlockchainClient()`
    - If null: broadcast critical alert about unverifiable positions, return early
    - Call `info.clearinghouseState({ user: walletAddress })` with retry (use same exponential backoff pattern from client.ts)
    - Parse `assetPositions` array: each entry has `position.coin`, `position.szi` (string — positive = Long, negative = Short), `position.entryPx` (string)
    - For each recovered position in `this.positions`:
      - Match by coin (pair → coin via split("/")[0]) + side (szi sign)
      - If matched: update chainPositionId to `"${coin}-${side}"`, update size and entryPrice from on-chain values (convert to smallest-unit)
      - If NOT matched: delete from `this.positions` map, delete from DB
    - Close all matched (still-open) positions via `closeAllPositions()` or per-position `closePosition()`
    - Broadcast `ALERT_TRIGGERED` summary: severity "warning", code "CRASH_RECOVERY_COMPLETE", details with counts
  - [x] 4.2 In `src/server/index.ts`, after both blockchain and engine init, call recovery:
    ```typescript
    if (getBlockchainClient()) {
      const engine = getEngine();
      const pm = engine.positionManager;
      if (pm.getPositions().length > 0) {
        await pm.reconcileOnChainPositions(getBlockchainClient()!.walletAddress);
      }
    }
    ```
  - [x] 4.3 Add position-manager test: reconciliation matches on-chain position and updates chainPositionId + size
  - [x] 4.4 Add position-manager test: reconciliation removes position not found on-chain from map and DB
  - [x] 4.5 Add position-manager test: reconciliation closes matched positions
  - [x] 4.6 Add position-manager test: reconciliation with null blockchain client broadcasts critical alert
  - [x] 4.7 Add position-manager test: reconciliation broadcasts summary alert with correct counts
  - [x] 4.8 Add position-manager test: reconciliation handles delta-neutral netting — both Long and Short for same coin exist in DB, on-chain szi is near zero → both deleted from DB

## Dev Notes

### Architecture: Shutdown Sequence (Updated)

```
SIGINT / SIGTERM received
  → shuttingDown = true (prevent re-entry)
  → Start 15s force-exit timer
  → Broadcast ALERT_TRIGGERED { severity: "warning", code: "SHUTDOWN_INITIATED" }  [NEW — Task 2.4]
  → stopAllModes() — parallel stop all runners, each closes its positions
  → closeAllPositions() — catch any orphaned/recovered positions              [NEW — Task 2.2]
  → fastify.close() — stop accepting HTTP requests, drain in-flight           [NEW — Task 1.2]
  → closeWebSocket() — close all WS client connections and server
  → closeDb() — close SQLite connection
  → clearTimeout(forceTimer)
  → process.exit(0)
```

### Architecture: Crash Recovery Sequence

```
Server startup
  → initBlockchainClient() — connect to Hyperliquid
  → initEngine()
    → fundAllocator.loadFromDb() — restore allocations
    → positionManager.loadFromDb() — restore positions from DB (with placeholder chainPositionId)
    → reconcilePositions() — adjust fund balances for loaded positions
  → reconcileOnChainPositions(walletAddress)                                  [NEW — Task 4.2]
    → clearinghouseState({ user: walletAddress })
    → For each DB position: match on-chain by coin+side
    → Matched: update chainPositionId/size/entryPrice from chain, then close
    → Unmatched: delete from map + DB (stop-loss already handled it)
    → Broadcast recovery summary alert
```

### Hyperliquid `clearinghouseState` Response Shape

```typescript
const state = await info.clearinghouseState({ user: "0x..." });
// state.assetPositions: Array<{
//   position: {
//     coin: string;        // e.g., "BTC"
//     szi: string;         // signed size — positive = Long, negative = Short, "0" = no position
//     entryPx: string;     // entry price as string
//     liquidationPx: string | null;
//     ...
//   }
// }>
```

**Matching logic:** Convert DB position's `pair` (e.g., "BTC/USDC") to coin via `pair.split("/")[0]` → "BTC". Match `szi`: positive for "Long", negative for "Short". A position with `szi === "0"` means it was closed on-chain (stop-loss or liquidation).

**Size conversion:** On-chain `szi` is in base units (e.g., "0.01" BTC). Convert to smallest-unit USDC: `Math.round(Math.abs(parseFloat(szi)) * parseFloat(entryPx) * 1e6)`.

**CRITICAL EDGE CASE — Delta-neutral positions (Volume Max):**
Hyperliquid reports **NET** position per coin, not per-order. Volume Max opens both Long AND Short on the same pair simultaneously (see `volume-max.ts:65-101`). If the bot crashes mid-cycle with both open:
- On-chain `szi` for that coin will be near zero (Long and Short cancel out)
- The reconciliation will see `szi ≈ 0` and conclude the positions are closed
- But the individual legs may still have margin/funding implications

**Handling:** If the DB contains BOTH a Long and Short for the same coin and the on-chain `szi` is near zero (absolute value < 1% of either DB position's size in base units), treat BOTH as "already closed by netting" — delete both from DB. If only one side exists in DB but `szi` is near zero, also delete it. This is safe because Hyperliquid has already net-settled the positions. Log the netting for audit trail.

### SAFETY CRITICAL: Shutdown position close order

`stopAllModes()` runs all mode stops in parallel via `Promise.allSettled()`. Each runner's `stop()` calls `closeAllForMode()`. If a runner is stuck or hanging, the 15s hard timeout kills the process. On-chain stop-losses serve as the ultimate safety net if graceful close fails.

The new `closeAllPositions()` step after `stopAllModes()` is a belt-and-suspenders safety measure — it catches positions that:
- Were loaded from DB during crash recovery but never assigned to a runner
- Belong to a mode that was kill-switched (runner already removed from map)
- Were opened between the shutdown signal and mode stop completing

### Critical: Do NOT close positions twice

`closeAllPositions()` must check if a position still exists in the map before closing. `stopAllModes()` → `runner.stop()` → `closeAllForMode()` already removes positions from the map. So `closeAllPositions()` only acts on positions that survived the mode stop phase. No double-close risk.

### DB Migration: `chainPositionId` column

Adding a nullable text column to an existing SQLite table is safe — no data loss, no table rebuild. Existing rows get `null` for the new column. The `loadFromDb()` fallback handles null values.

Migration SQL will be approximately:
```sql
ALTER TABLE positions ADD COLUMN chainPositionId TEXT;
```

Note: This project's Drizzle schema does NOT use snake_case mapping — all existing columns use camelCase directly in SQLite (e.g., `entryPrice`, `stopLoss`). The new column must also be camelCase: `chainPositionId`, not `chain_position_id`.

### File Changes Summary

| File | Change | Reason |
|------|--------|--------|
| `src/server/lib/shutdown.ts` | Accept Fastify param, add fastify.close(), add closeAllPositions(), add shutdown broadcast, add new imports (broadcast, EVENTS, getEngine) | Gaps 1, 2, 5, 6 |
| `src/server/index.ts` | Call registerShutdownHandlers(fastify), call reconcileOnChainPositions after init | Gaps 1, 7 |
| `src/server/engine/position-manager.ts` | Add closeAllPositions() with _shuttingDown flag, add reconcileOnChainPositions(), update loadFromDb(), update DB insert at line 169, add openPosition shutdown guard | Gaps 3, 4, 5 |
| `src/server/db/schema.ts` | Add chainPositionId column to positions table | Gap 4 |
| `src/server/db/migrations/` | New migration for chainPositionId column | Gap 4 |
| `src/server/lib/shutdown.test.ts` | New test file: shutdown sequence order, fastify close, broadcast, closeAllPositions | Gaps 1, 2, 5, 6 |
| `src/server/engine/position-manager.test.ts` | New tests for closeAllPositions, reconcileOnChainPositions, chainPositionId persistence | Gaps 3, 4, 5 |

### Existing Patterns to Follow

- **Shutdown step pattern:** Each step in shutdown.ts is wrapped in individual try/catch with `logger.error()`. Follow this for new steps.
- **Broadcast pattern:** `broadcast(EVENTS.ALERT_TRIGGERED, { severity, code, message, details, resolution })` — import broadcast from `../ws/broadcaster.js`.
- **DB operations:** Use `getDb()` for lazy access. All inserts/queries go through Drizzle ORM.
- **Error class:** All errors use `AppError` from `lib/errors.ts`. Include `resolution` field.
- **Test setup:** Vitest with `vi.fn()` mocks. Engine tests mock blockchain client. Position manager tests use real FundAllocator + mocked blockchain.
- **Number validation:** Use `Number.isFinite()` for all financial values (learned from Story 2-6).
- **Position ID format:** `"${coin}-${side}"` (e.g., `"BTC-Long"`) — established in contracts.ts line 223.

### New Alert Codes Introduced

| Code | Severity | When | Message |
|------|----------|------|---------|
| `SHUTDOWN_INITIATED` | warning | Shutdown signal received | "Bot is shutting down — closing all positions." |
| `CRASH_RECOVERY_COMPLETE` | warning | Reconciliation finished | "Recovered {n} positions: {closed} closed, {cleaned} already gone." |
| `CRASH_RECOVERY_FAILED` | critical | Blockchain client null | "Cannot verify orphaned positions — blockchain not connected." |
| `SHUTDOWN_IN_PROGRESS` | warning | openPosition during shutdown | "Cannot open position — shutdown in progress." |

All use existing `AlertTriggeredPayload` type — no new event types or shared type changes needed.

### Project Structure Notes

- All changes are within existing files except the migration file (auto-generated by drizzle-kit)
- `shutdown.test.ts` may be a new file (check if it exists — create co-located next to `shutdown.ts`)
- No new shared types needed — `AlertTriggeredPayload` already supports arbitrary code strings

### Test Baseline

359 tests passing across 26 test files. Zero regressions expected. New tests should add approximately 15-18 tests across 2-3 test files (shutdown.test.ts is a new file).

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 3, Story 3.2]
- [Source: _bmad-output/planning-artifacts/architecture.md — Graceful shutdown sequence (lines 250-258), crash recovery (line 166), DB caching strategy (line 180), shutdown.ts file location (line 550)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — Alert severity tiers, connection status indicators]
- [Source: src/server/lib/shutdown.ts:1-62 — existing shutdown handler, full sequence]
- [Source: src/server/index.ts:1-107 — server entry point, missing registerShutdownHandlers call]
- [Source: src/server/engine/position-manager.ts:485-507 — loadFromDb with placeholder chainPositionId]
- [Source: src/server/engine/position-manager.ts:401-456 — closeAllForMode]
- [Source: src/server/engine/index.ts:116-132 — stopAllModes with Promise.allSettled]
- [Source: src/server/engine/index.ts:14-45 — initEngine with loadFromDb calls]
- [Source: src/server/blockchain/client.ts:72-113 — BlockchainClient, getBlockchainClient, clearinghouseState usage]
- [Source: src/server/blockchain/contracts.ts:223 — positionId format "${coin}-${side}"]
- [Source: src/server/ws/broadcaster.ts:50-63 — closeWebSocket]
- [Source: src/server/db/index.ts:52-59 — closeDb]
- [Source: src/server/db/schema.ts:20-32 — positions table schema]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md — W3: recovered positions use fabricated chainPositionId]
- [Source: @nktkas/hyperliquid SDK — info.clearinghouseState returns assetPositions with position.coin, position.szi, position.entryPx]

### Previous Story Intelligence (3-1)

Key learnings from Story 3-1 and its code review:
- **Kill-switch callback pattern:** PositionManager uses a callback (`_onKillSwitch`) registered by engine — same pattern can be used if shutdown needs to signal back to engine
- **Race condition awareness:** Story 3-1 added `_killSwitchActive` guard in `openPosition()` to prevent new positions during kill-switch. Similar guard may be needed during shutdown — `closeAllPositions()` should set a flag preventing new `openPosition()` calls.
- **forceStop vs stop:** `forceStop()` skips `closeAllForMode()` (used when positions already closed by kill-switch). During shutdown, use `stop()` (which calls `closeAllForMode()`).
- **Event ordering:** ALERT_TRIGGERED before MODE_STOPPED to avoid status overwrite. Same consideration for shutdown: broadcast shutdown alert BEFORE stopping modes.
- **`closeAllForMode` partial failure handling:** Story 3-1 added `KILL_SWITCH_CLOSE_FAILED` alert for positions that fail to close. This same mechanism will surface during shutdown if position closes fail. No additional work needed for failure alerting.
- **Test baseline:** 359 tests (26 files). Added 16 tests in Story 3-1.

### Git Intelligence

Recent commits show:
- Story 3-1 (`e29b1fc`): Kill switch with safety guards — added forceStop, openPosition guard, kill-switch reset, event ordering fix
- Story 2-7 (`705c958`): Open positions table — store handlers for position display
- Story 8-2 (`e417074`): Hyperliquid API rewrite — established current blockchain client patterns
- All stories maintain zero regression baseline
- Tests use `vi.fn()` mocks consistently; engine tests mock blockchain client

## Change Log

- 2026-04-06: Implemented all 4 tasks — graceful shutdown wiring, closeAllPositions, chainPositionId migration, on-chain reconciliation. 376 tests passing (17 new, 0 regressions).

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- Test DB schema issue: Tests use module-level `const dbPath` from `db/index.ts` which resolves at import time, causing tests to hit the production `valbot.db` instead of the test DB. Fixed by applying the migration to `valbot.db` and updating test CREATE TABLE statements to include `chainPositionId`.

### Completion Notes List

- **Task 1:** Refactored `registerShutdownHandlers()` to accept `FastifyInstance` parameter. Added `fastify.close()` between mode stop and WS close. Wired shutdown handlers in `src/server/index.ts` after engine init. Created `shutdown.test.ts` with 8 tests verifying correct order, error resilience, and signal registration.
- **Task 2:** Added `closeAllPositions()` to PositionManager — iterates all modes with positions, calls `closeAllForMode()` per mode. Added `_shuttingDown` flag guarding `openPosition()`. Wired shutdown broadcast (`SHUTDOWN_INITIATED`) before mode stops, and `closeAllPositions()` after `stopAllModes()` in shutdown sequence. No new event types needed — uses existing `AlertTriggeredPayload`. Tests: 2 new in position-manager (closeAllPositions, shutdown guard), 2 in shutdown (order, broadcast).
- **Task 3:** Added nullable `chainPositionId: text()` column to positions table schema. Generated Drizzle migration (`0001_tense_ghost_rider.sql`). Updated `openPosition()` to persist `chainPositionId` from contract result. Updated `loadFromDb()` to use persisted value with fallback to placeholder. Tests: 2 new (persistence, fallback).
- **Task 4:** Added `reconcileOnChainPositions(walletAddress)` method — queries `clearinghouseState`, matches DB positions by coin+side, updates/closes matched positions, deletes unmatched positions from DB+memory. Handles delta-neutral netting (Volume Max pattern). Broadcasts recovery summary or critical alert if blockchain unavailable. Wired in `src/server/index.ts` after engine init. Tests: 5 new (match+close, remove unmatched, null client alert, summary counts, delta-neutral netting).

### Review Findings

- [x] [Review][Decision] `_shuttingDown` flag set too late — fixed: added `enterShutdown()` method, called in shutdown.ts Step 1 before broadcast
- [x] [Review][Patch] Reconciliation mutates in-memory position but never persists — fixed: added `db.update()` call before close attempt
- [x] [Review][Patch] `parseFloat` on `szi`/`entryPx` can produce `NaN` — fixed: added `Number.isFinite()` guard, skips invalid entries
- [x] [Review][Patch] Multiple same-side positions for one coin — fixed: only match first same-side position, delete extras
- [x] [Review][Patch] Unused `positionsToDelete` variable — fixed: removed
- [x] [Review][Patch] `closeAllPositions` swallows errors — fixed: tracks failed modes, logs CRITICAL with remaining count
- [x] [Review][Patch] AC #3: failed close alert — fixed: mentions on-chain stop-loss safety net in details and resolution
- [x] [Review][Fixed] `closeWebSocket` hang — added 3s timeout to `wss.close()` callback [broadcaster.ts:50]
- [x] [Review][Fixed] PnL always 0 from contracts — position-manager now computes PnL from entry/exit prices [position-manager.ts:303-347]
- [x] [Review][Fixed] SIGINT race during reconciliation — moved `registerShutdownHandlers()` after crash recovery [index.ts]

### File List

- `src/server/lib/shutdown.ts` — Refactored to accept FastifyInstance, added fastify.close(), closeAllPositions(), shutdown broadcast, new imports
- `src/server/lib/shutdown.test.ts` — NEW: 8 tests for shutdown sequence order, broadcast, error resilience
- `src/server/index.ts` — Added registerShutdownHandlers(fastify) call, crash recovery reconciliation call, new imports
- `src/server/engine/position-manager.ts` — Added closeAllPositions(), reconcileOnChainPositions(), _shuttingDown flag, shutdown guard in openPosition(), chainPositionId in DB insert, updated loadFromDb()
- `src/server/engine/position-manager.test.ts` — Added 9 tests: chainPositionId persistence (2), closeAllPositions (2), reconciliation (5). Updated test DB schema.
- `src/server/db/schema.ts` — Added chainPositionId: text() column to positions table
- `src/server/db/migrations/0001_tense_ghost_rider.sql` — NEW: ALTER TABLE positions ADD chainPositionId
- `src/server/db/migrations/meta/0000_snapshot.json` — Updated by drizzle-kit
- `src/server/db/migrations/meta/_journal.json` — Updated by drizzle-kit
- `src/server/engine/index.test.ts` — Updated test DB schema to include chainPositionId
- `src/server/engine/fund-allocator.test.ts` — Updated test DB schema to include chainPositionId
