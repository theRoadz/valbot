# Story 5.3: Combined Cross-Mode Statistics

Status: done

## Story

As theRoad,
I want to see combined statistics aggregated across all active and historical modes,
So that I get a complete picture of overall bot performance at a glance.

## Acceptance Criteria

1. **Combined Total PnL** — Given multiple modes have been active (currently or historically), when I view the SummaryBar, then Total PnL shows the sum of PnL across all modes and all sessions
2. **Combined Session PnL** — Given active modes are running, when I view the SummaryBar, then Session PnL shows the sum of current-session PnL across all active modes
3. **Combined Total Trades** — Given trades have been executed across modes, when I view the SummaryBar, then Total Trades shows the count of all trades across all modes
4. **Combined Total Volume** — Given trades have been executed across modes, when I view the SummaryBar, then Total Volume shows the sum of volume across all modes
5. **Real-time updates** — Given any mode executes a trade, when stats.updated fires, then all combined stats in the SummaryBar update in real-time
6. **Initial load completeness** — Given the dashboard loads fresh (initial page load or reconnect), when GET /api/status returns, then the response includes combined stats calculated from all mode stats plus historical session data — including totalTrades and totalVolume (not just totalPnl and sessionPnl)
7. **Dual population** — Given the dashboard loads, when /api/status returns combined stats, then the Zustand store populates both per-mode stats (on ModeCards) and combined stats (on SummaryBar), and subsequent WebSocket stats.updated events keep both in sync

## Tasks / Subtasks

- [x] Task 1: Extend `/api/status` response to include complete combined stats (AC: #1, #2, #3, #4, #6)
  - [x]1.1 In `src/server/api/status.ts`, extend the `getStats()` function to also return `totalTrades` and `totalVolume` — sum per-mode current stats from `fundAllocator.getStats(mode)` plus historical totals from `sessionManager.getHistoricalStats()`
  - [x]1.2 Update `StatusResponse.stats` type in `src/shared/types.ts` to include `totalTrades: number` and `totalVolume: number` alongside existing `totalPnl` and `sessionPnl`
  - [x]1.3 Unit tests: The existing `status.test.ts` has ZERO tests for the `body.stats` field — no test mocks `sessionManager.getHistoricalStats()` or validates combined stats composition. Write comprehensive stats tests covering ALL four fields (totalPnl, sessionPnl, totalTrades, totalVolume): verify correct summing across modes + historical, verify fallback to zeros when engine not initialized, verify correct `fromSmallestUnit()` conversion on historical values
- [x] Task 2: Update client store to use server-provided combined stats on initial load (AC: #6, #7)
  - [x]2.1 In `src/client/store/index.ts`, update `loadInitialStatus()` to populate `stats.totalTrades` and `stats.totalVolume` from the server response `stats.totalTrades` and `stats.totalVolume` instead of only aggregating from per-mode stats. Historical trades/volume from past sessions that aren't in current mode stats must be included
  - [x]2.2 Ensure `aggregateSummaryStats()` correctly incorporates the historical baseline for totalTrades and totalVolume (same pattern as `historicalPnlBase` for totalPnl)
  - [x]2.3 Store tests: `loadInitialStatus()` with server-provided stats populates `totalTrades` and `totalVolume` correctly including historical data
- [x] Task 3: Verify real-time combined stats update on WebSocket events (AC: #5, #7)
  - [x]3.1 Verify that the existing `handleWsMessage` STATS_UPDATED handler triggers `aggregateSummaryStats()` recalculation — the handler directly updates `modes` state and calls `aggregateSummaryStats()` inline (it does NOT delegate to the `updateModeStats` action, but the aggregation still happens)
  - [x]3.2 Store tests: when a STATS_UPDATED event arrives for one mode, the combined stats (totalTrades, totalVolume, sessionPnl, totalPnl) reflect the updated mode values summed across all modes
- [x] Task 4: Verify SummaryBar displays all combined stats correctly (AC: #1, #2, #3, #4)
  - [x]4.1 Verify `top-bar.tsx` already consumes `stats.totalTrades` and `stats.totalVolume` — the component already renders these fields. Confirm no code changes needed in the SummaryBar component
  - [x]4.2 If any display gaps exist, fix them (unlikely — component already shows all SummaryStats fields)
  - [x]4.3 Component tests: SummaryBar displays correct combined values when store has multi-mode stats

## Dev Notes

### Current State — Mostly Working, Key Gaps in Server Stats

The combined stats display is **already largely functional** on the client side. The `aggregateSummaryStats()` function in `store/index.ts` already sums per-mode stats to produce combined totals for the SummaryBar. The gap is that the **server's `/api/status` response is incomplete** — it only returns `totalPnl` and `sessionPnl` in the `stats` field, **missing `totalTrades` and `totalVolume`**. This means on initial page load, historical trades/volume from past sessions are lost.

### What Already Works

| Feature | Status | Details |
|---------|--------|---------|
| SummaryBar UI | DONE | `top-bar.tsx` displays all SummaryStats fields |
| Client aggregation | DONE | `aggregateSummaryStats()` sums modes correctly |
| Per-mode stats tracking | DONE | `fundAllocator.getStats(mode)` returns trades, volume, pnl |
| Historical PnL | DONE | `sessionManager.getHistoricalStats()` returns totalPnl |
| Real-time per-mode updates | DONE | `stats.updated` WebSocket event triggers recalculation |
| Historical trades/volume | DONE | `sessionManager.getHistoricalStats()` already returns `totalTrades` and `totalVolume` |

### What Needs Implementation

| Gap | Fix |
|-----|-----|
| `/api/status` stats missing `totalTrades`/`totalVolume` | Extend `getStats()` in `status.ts` to sum historical + current trades/volume |
| `StatusResponse.stats` type incomplete | Add `totalTrades: number` and `totalVolume: number` |
| Store initial load only gets PnL history | Update `loadInitialStatus()` to use `totalTrades`/`totalVolume` from server response |

### Key Files to Touch

| File | Action | Reason |
|------|--------|--------|
| `src/server/api/status.ts` | Modify | Extend `getStats()` to return `totalTrades` and `totalVolume` |
| `src/server/api/status.test.ts` | Modify | Add tests for complete combined stats |
| `src/shared/types.ts` | Modify | Add `totalTrades`, `totalVolume` to `StatusResponse.stats` |
| `src/client/store/index.ts` | Modify | Update `loadInitialStatus()` to use server-provided historical trades/volume |
| `src/client/store/index.test.ts` | Modify | Add tests for historical trades/volume on initial load |

### Files NOT to Touch

- `src/client/components/top-bar.tsx` — Already displays all SummaryStats fields correctly
- `src/server/engine/fund-allocator.ts` — Per-mode stats already work
- `src/server/engine/session-manager.ts` — Already returns `totalTrades` and `totalVolume` from historical sessions
- `src/shared/events.ts` — No new WebSocket events needed
- `src/server/ws/broadcaster.ts` — No changes needed

### Architecture Compliance

- **Server `getStats()` pattern:** Sum per-mode stats from `fundAllocator.getStats(mode)` for current session + `sessionManager.getHistoricalStats()` for historical. Convert smallest-unit integers via `fromSmallestUnit()` at API boundary. Current trades/volume are already display-unit from `fundAllocator.getStats()`.
- **Monetary conversion:** `sessionManager.getHistoricalStats()` returns smallest-unit integers for `totalPnl`, `totalVolume`. Use `fromSmallestUnit()` on both. `totalTrades` is a plain count — no conversion needed.
- **Store pattern:** Keep store synchronous. No async actions. `loadInitialStatus()` receives the full status response and populates state.
- **Zustand selectors:** `useStore(s => s.stats)` is already the selector pattern used by `top-bar.tsx`.
- **Type safety:** `StatusResponse.stats` must be updated to match the full `SummaryStats` shape (minus `equity` and `available` which come from `connection` state).
- **Unit conversion note:** In the store, `stats.totalPnl`, `stats.totalVolume`, `stats.sessionPnl`, `stats.totalTrades` are all display-unit (no conversion at render time). However, `stats.equity` and `stats.available` are stored as smallest-unit and `top-bar.tsx` applies `fromSmallestUnit()` at render time (lines 89, 94). Do NOT change this asymmetry — it's the established pattern.

### Implementation Details

#### Extending `getStats()` in `status.ts`

Current implementation (lines 55-71):
```typescript
function getStats(): { totalPnl: number; sessionPnl: number } {
  const { fundAllocator, sessionManager } = getEngine();
  const modes = ["volumeMax", "profitHunter", "arbitrage"] as const;
  const sessionPnl = modes.reduce((sum, mode) =>
    sum + fundAllocator.getStats(mode).pnl, 0
  );
  const historical = sessionManager.getHistoricalStats();
  const totalPnl = fromSmallestUnit(historical.totalPnl) + sessionPnl;
  return { totalPnl, sessionPnl };
}
```

**Extend to:**
```typescript
function getStats(): { totalPnl: number; sessionPnl: number; totalTrades: number; totalVolume: number } {
  const { fundAllocator, sessionManager } = getEngine();
  const modes = ["volumeMax", "profitHunter", "arbitrage"] as const;

  let sessionPnl = 0;
  let sessionTrades = 0;
  let sessionVolume = 0;

  for (const mode of modes) {
    const modeStats = fundAllocator.getStats(mode);
    sessionPnl += modeStats.pnl;
    sessionTrades += modeStats.trades;
    sessionVolume += modeStats.volume;
  }

  const historical = sessionManager.getHistoricalStats();
  const totalPnl = fromSmallestUnit(historical.totalPnl) + sessionPnl;
  const totalTrades = historical.totalTrades + sessionTrades;
  const totalVolume = fromSmallestUnit(historical.totalVolume) + sessionVolume;

  return { totalPnl, sessionPnl, totalTrades, totalVolume };
}
```

**Key details:**
- `fundAllocator.getStats(mode).volume` already returns display-unit (converted inside `getStats()`), while `historical.totalVolume` returns smallest-unit integer — must call `fromSmallestUnit()` on the historical value only.
- The current `getStats()` has a try/catch that returns `{ totalPnl: 0, sessionPnl: 0 }` on failure. The extended version MUST also return `{ totalTrades: 0, totalVolume: 0 }` in the catch block — do not drop the error handling.

#### Updating `loadInitialStatus()` in `store/index.ts`

Current behavior: `loadInitialStatus()` extracts `historicalPnlBase` from server stats, but `totalTrades` and `totalVolume` come only from aggregating current per-mode stats (which resets to 0 on server restart).

**Fix:** Store the historical baselines for trades and volume the same way `historicalPnlBase` works for PnL:

```typescript
// In loadInitialStatus(), after extracting historicalPnlBase:
const historicalTradesBase = (statusData.stats?.totalTrades ?? 0) - modesArray.reduce((s, m) => s + m.stats.trades, 0);
const historicalVolumeBase = (statusData.stats?.totalVolume ?? 0) - modesArray.reduce((s, m) => s + m.stats.volume, 0);
```

Then pass these baselines to `aggregateSummaryStats()` so it can add them to the live mode sums.

#### `aggregateSummaryStats()` Update

Current signature:
```typescript
function aggregateSummaryStats(modes, equity, available, historicalPnlBase): SummaryStats
```

**Extend to include historical trade/volume baselines:**
```typescript
function aggregateSummaryStats(modes, equity, available, historicalPnlBase, historicalTradesBase, historicalVolumeBase): SummaryStats {
  const sessionPnl = modes.reduce((sum, m) => sum + m.stats.pnl, 0);
  return {
    equity,
    available,
    totalPnl: historicalPnlBase + sessionPnl,
    sessionPnl,
    totalTrades: historicalTradesBase + modes.reduce((sum, m) => sum + m.stats.trades, 0),
    totalVolume: historicalVolumeBase + modes.reduce((sum, m) => sum + m.stats.volume, 0),
  };
}
```

Store the baselines as store state (same pattern as `historicalPnlBase`). Add `historicalTradesBase: number` and `historicalVolumeBase: number` to the `ValBotStore` interface and initialize both to `0` in the `create()` call, matching the `historicalPnlBase` pattern on the same lines.

**All 5 call sites for `aggregateSummaryStats()` must be updated:**
1. `updateModeStats` action
2. `setModeConfig` action
3. `loadInitialStatus` action
4. `MODE_STOPPED` handler in `handleWsMessage`
5. `STATS_UPDATED` handler in `handleWsMessage`

TypeScript will enforce this — changing the function signature will cause compile errors at any missed call site.

### Type Changes

In `src/shared/types.ts`, update `StatusResponse`:
```typescript
export interface StatusResponse {
  modes: Record<ModeType, ModeConfig>;
  positions: Position[];
  trades: Trade[];
  connection: ConnectionState;
  stats?: {
    totalPnl: number;
    sessionPnl: number;
    totalTrades: number;   // NEW
    totalVolume: number;   // NEW
  };
}
```

### Previous Story Learnings (from 5-2)

- 668 tests currently passing — do NOT break existing tests
- `fromSmallestUnit()` is the standard conversion at API boundaries
- Store `loadInitialStatus()` is the entry point for initial data hydration
- Store is purely synchronous — no async actions in store
- `getRecentTrades()` shared helper pattern works well for reusable query logic
- `aggregateSummaryStats()` is called from multiple locations — changes must be consistent across all call sites
- Store state `historicalPnlBase` pattern is the model for adding historical trade/volume baselines

### Testing Patterns

- Co-locate tests next to source files
- No shared test helpers — each test file defines its own setup
- For API tests: mock `getEngine()` to return mock `fundAllocator` and `sessionManager`
- For store tests: use `useStore.setState()` for setup, `useStore.getState()` for assertions
- Mock `fetch` for API calls in component/integration tests
- Use `vi.fn()` for mocking, `vi.mock()` for module-level mocks

### What NOT to Build

- Do NOT create a new WebSocket event for combined stats — the existing per-mode `stats.updated` event already triggers client-side recalculation
- Do NOT modify `fund-allocator.ts` or `session-manager.ts` — they already provide the data needed
- Do NOT add a separate combined stats API endpoint — extend the existing `/api/status` response
- Do NOT add per-mode stat breakdowns to the SummaryBar — that's what ModeCards are for
- Do NOT add time-range filtering for combined stats — not in scope
- Do NOT change the WebSocket event payloads — per-mode events are sufficient
- Do NOT modify `top-bar.tsx` unless there's an actual display gap (verify first)

### Cross-Story Dependencies

- **Story 5.1 (done):** Session persistence — `sessionManager.getHistoricalStats()` returns totalPnl, totalTrades, totalVolume from finalized sessions
- **Story 5.2 (done):** Trade history — `/api/trades?mode=X` endpoint exists for per-mode trade filtering (not needed for this story but available)
- **Story 4.4 (done):** Parallel mode execution — all three modes can run independently and report stats

### Deferred Work Items to Be Aware Of

- Live mark price for PositionsTable still shows "—" (deferred from Story 2-7)
- Position close matching by (mode, pair, side) is ambiguous with duplicates (deferred from Story 2-7)
- `loadFromDb` bypasses cross-mode total allocation validation (deferred from Story 4-4)
- These do NOT block this story

### Project Structure Notes

- All modifications stay within existing files — no new files created
- Server API modifications in `src/server/api/status.ts`
- Type updates in `src/shared/types.ts`
- Store updates in `src/client/store/index.ts`
- Aligned with existing project structure conventions

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 5, Story 5.3]
- [Source: _bmad-output/planning-artifacts/architecture.md — REST API Endpoints, Database Schema, Zustand Store Shape, WebSocket Events, Stats Patterns]
- [Source: _bmad-output/planning-artifacts/prd.md — FR23 (combined stats across modes)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — SummaryBar component, Stats Display]
- [Source: _bmad-output/project-context.md — All implementation rules]
- [Source: _bmad-output/implementation-artifacts/5-2-trade-history-view.md — Previous story learnings]
- [Source: src/server/api/status.ts — Current getStats() implementation]
- [Source: src/server/engine/session-manager.ts — getHistoricalStats() method]
- [Source: src/server/engine/fund-allocator.ts — getStats(mode) per-mode stats]
- [Source: src/client/store/index.ts — aggregateSummaryStats(), loadInitialStatus(), historicalPnlBase]
- [Source: src/client/components/top-bar.tsx — SummaryBar consuming stats]
- [Source: src/shared/types.ts — SummaryStats, StatusResponse interfaces]

### Review Findings

- [x] [Review][Decision] Negative historicalTradesBase/historicalVolumeBase possible — resolved: added `Math.max(0, ...)` clamp [src/client/store/index.ts:246-247]
- [x] [Review][Patch] Add test for negative historical baseline edge case — resolved: added clamp test [src/client/store/index.test.ts]
- [x] [Review][Defer] Server getStats() catch block swallows errors silently — resolved: added `logger.warn` with error context [src/server/api/status.ts:80]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

None — clean implementation with no blocking issues.

### Completion Notes List

- Extended `getStats()` in `status.ts` to return `totalTrades` and `totalVolume` by summing per-mode current stats from `fundAllocator.getStats(mode)` plus historical totals from `sessionManager.getHistoricalStats()`. Applied `fromSmallestUnit()` on historical pnl and volume (smallest-unit integers) but not on trades (plain count).
- Updated `StatusResponse.stats` type in `types.ts` to include `totalTrades: number` and `totalVolume: number`.
- Added `historicalTradesBase` and `historicalVolumeBase` to the Zustand store state, following the same pattern as `historicalPnlBase`.
- Updated `aggregateSummaryStats()` to accept and use the new historical baselines. Updated all 5 call sites (updateModeStats, setModeConfig, loadInitialStatus, MODE_STOPPED handler, STATS_UPDATED handler).
- `loadInitialStatus()` now calculates `historicalTradesBase` and `historicalVolumeBase` from server-provided combined stats minus current mode stats, same derivation pattern as `historicalPnlBase`.
- Verified `top-bar.tsx` already consumes `stats.totalTrades` and `stats.totalVolume` — no UI changes needed.
- Added 3 new server API tests for combined stats (zero fallback, multi-mode + historical summing, fromSmallestUnit conversion correctness).
- Added 3 new store tests for historical trades/volume baselines (initial load, STATS_UPDATED preservation, no-stats-field fallback).
- Added 1 new component test for SummaryBar displaying combined multi-mode stats.
- All 113 tests across changed files pass. Full suite: 675 pass, 1 pre-existing failure in trades.test.ts (test isolation issue unrelated to this story).

### Change Log

- 2026-04-07: Story 5-3 implementation — extended /api/status with totalTrades and totalVolume, added historical baselines to store, 7 new tests

### File List

- src/server/api/status.ts (modified) — Extended `getStats()` to return totalTrades and totalVolume
- src/server/api/status.test.ts (modified) — Added 3 stats tests covering combined stats, zero fallback, and unit conversion
- src/shared/types.ts (modified) — Added totalTrades, totalVolume to StatusResponse.stats type
- src/client/store/index.ts (modified) — Added historicalTradesBase/historicalVolumeBase state, updated aggregateSummaryStats signature and all 5 call sites, updated loadInitialStatus to extract historical baselines
- src/client/store/index.test.ts (modified) — Added 3 tests for historical trades/volume baselines
- src/client/components/top-bar.test.tsx (modified) — Added 1 test for combined multi-mode stats display
