# Story 2.5: Zustand Store & Real-Time Dashboard Updates

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As theRoad,
I want the dashboard to update in real-time as Volume Max trades,
so that I see live stats, PnL, trade counts, and volume updating on the ModeCard and SummaryBar without refreshing.

## Acceptance Criteria (BDD)

**AC1: Zustand store shape matches architecture spec**
Given the project from Story 2.4
When I inspect the Zustand store
Then the store shape includes: modes (per-mode status/stats/config), alerts[], connection state, stats (aggregated), and actions
And the `stats` slice aggregates totals from all mode stats for the SummaryBar
Note: `positions[]` and `trades[]` store slices are deferred to Stories 2.6 and 2.7 respectively — they are part of the architecture spec but not this story's scope

**AC2: WebSocket onmessage dispatches events to store actions**
Given the WebSocket connection is established
When a WebSocket message arrives
Then the `handleWsMessage` handler dispatches events directly to store actions
And no middleware or action creators are used

**AC3: stats.updated events update ModeCard stats in real-time**
Given Volume Max is running and executing trades
When a `stats.updated` WebSocket event arrives with `{ mode: "volumeMax", pnl, trades, volume, allocated, remaining }`
Then the Volume Max ModeCard stats (PnL, trades, volume, allocated, remaining) update in real-time
And the SummaryBar total stats (Total PnL, Session PnL, Total Trades, Total Volume) recalculate by aggregating from all mode stats

**AC4: mode.started and mode.stopped events update status badge**
Given a mode state change occurs on the server
When `mode.started` event arrives
Then the corresponding ModeCard status badge updates to "Running"
When `mode.stopped` event arrives with `finalStats`
Then the badge updates to "Stopped" and stats reflect `finalStats`

**AC5: connection.status events update SummaryBar**
Given the WebSocket connection is active
When a `connection.status` event arrives with `{ rpc, wallet, balance }`
Then the SummaryBar connection indicator updates (green/yellow/red dot + label)
And the wallet balance updates in the SummaryBar

**AC6: Components subscribe to store slices via selectors**
Given any dashboard component
When it subscribes to the Zustand store
Then it uses selectors like `useStore(s => s.modes.volumeMax)` — never `useStore(s => s)`

**AC7: Financial number formatting**
Given any financial number on the dashboard
When it renders
Then it uses JetBrains Mono font (`font-mono`)
And PnL shows +/- prefix with green (positive), red (negative), gray (zero) coloring
And numbers use comma separators and 2 decimal places (e.g., `+$1,247.83`)

**AC8: Initial state hydration from GET /api/status**
Given the dashboard loads
When the initial fetch completes
Then `GET /api/status` populates the store state (modes, positions, connection) before WebSocket takes over
And the SummaryBar reflects aggregated totals from the initial data

## Tasks / Subtasks

- [x] **Task 1** — Compute SummaryBar stats from mode stats (AC: #1, #3, #8)
  - [x] 1.1 Modify `src/client/store/index.ts` — replace the hardcoded `stats: SummaryStats` slice with a computed aggregation. The current store has a `stats` object with `{ walletBalance, totalPnl, sessionPnl, totalTrades, totalVolume }` that is only updated by `connection.status` events for `walletBalance`. **The problem**: `totalPnl`, `sessionPnl`, `totalTrades`, `totalVolume` are always zero — they're never updated by any event handler.
  - [x] 1.2 **Approach**: Add an `aggregateSummaryStats` helper that recalculates `stats` by aggregating from all mode stats. Use `Object.values(modes)` for resilience to future mode additions:
    ```typescript
    function aggregateSummaryStats(modes: ValBotStore["modes"], walletBalance: number): SummaryStats {
      const allModes = Object.values(modes);
      return {
        walletBalance,
        totalPnl: allModes.reduce((sum, m) => sum + m.stats.pnl, 0),
        sessionPnl: allModes.reduce((sum, m) => sum + m.stats.pnl, 0), // intentionally equals totalPnl — single-session app, no cross-session tracking yet (Story 5.1)
        totalTrades: allModes.reduce((sum, m) => sum + m.stats.trades, 0),
        totalVolume: allModes.reduce((sum, m) => sum + m.stats.volume, 0),
      };
    }
    ```
  - [x] 1.3 Call `aggregateSummaryStats()` inside every `set()` that changes mode stats — specifically in `STATS_UPDATED` handler, `MODE_STOPPED` handler (which sets `finalStats`), `updateModeStats` action, and `loadInitialStatus` action.
  - [x] 1.4 Keep `walletBalance` updating from `connection.status` events as it does now. The aggregate function uses `state.connection.walletBalance` for the wallet value.
  - [x] 1.5 **Fix `loadInitialStatus`**: The current implementation sets `connection.walletBalance` but NOT `stats.walletBalance`. TopBar reads `stats.walletBalance`, so after hydration wallet shows `$0.00` until a `connection.status` event arrives. Fix: `loadInitialStatus` must return the aggregated `stats` (including `walletBalance` from `data.connection.walletBalance`) alongside `modes` and `connection`.
  - [x] 1.6 **Race condition note**: WebSocket events may arrive before `loadInitialStatus` resolves. The `handleWsMessage` handlers already guard with `if (!state.modes[mode]) return state`, so stale overwrites are unlikely. If a `stats.updated` event arrives first and then `loadInitialStatus` overwrites it, the next `stats.updated` event will correct the data within seconds. No additional gating mechanism needed.

- [x] **Task 2** — Fix TopBar unit handling and add PnL coloring (AC: #7, #3)
  - [x] 2.1 **Fix `fromSmallestUnit()` usage in TopBar** — The aggregated `totalPnl`, `sessionPnl`, and `totalVolume` are already in **display units** (the server calls `fromSmallestUnit()` before emitting stats). But TopBar currently wraps ALL stat values with `fromSmallestUnit()`. This double-converts and produces wrong values. **Specific lines to fix in `top-bar.tsx`**:
    - `totalPnl` (line 87): REMOVE `fromSmallestUnit()` — pass directly to `formatCurrency()`
    - `sessionPnl` (line 91): REMOVE `fromSmallestUnit()` — pass directly to `formatCurrency()`
    - `totalVolume` (line 101): REMOVE `fromSmallestUnit()` — pass directly to `formatCurrency()`
    - `walletBalance` (line 81): KEEP `fromSmallestUnit()` — wallet balance arrives in smallest-unit from `connection.status` events
    - `totalTrades` (line 96): No change needed — already uses `formatInteger()` directly without `fromSmallestUnit()`
  - [x] 2.2 **Add PnL coloring** — the `StatItem` subcomponent renders ALL values in `text-text-muted`. Add a `valueClassName` prop to allow per-item color override:
    - Total PnL, Session PnL: `value > 0 ? "text-profit" : value < 0 ? "text-loss" : "text-text-muted"` (same pattern as ModeCard's StatCell)
    - Non-PnL stats (Wallet, Trades, Volume): remain `text-text-muted` (current behavior)
  - [x] 2.3 PnL stats should use `formatCurrency(value, true)` to get the `+`/`-` sign prefix.

- [x] **Task 3** — Handle `trade.executed` events in store (AC: #2)
  - [x] 3.1 The store currently does NOT handle `TRADE_EXECUTED` events — they log as "Unhandled event" in dev mode. Add a handler in `handleWsMessage`:
    ```typescript
    else if (message.event === EVENTS.TRADE_EXECUTED) {
      const data = message.data as TradeExecutedPayload;
      // No store update needed now — trade log (Story 2.6) and positions table (Story 2.7) will consume these.
      // For now, just prevent the "unhandled event" dev log.
    }
    ```
  - [x] 3.2 Similarly handle `POSITION_OPENED` and `POSITION_CLOSED` events as no-ops for now to suppress dev warnings. These will be fully wired in Stories 2.6 and 2.7.
    ```typescript
    else if (message.event === EVENTS.POSITION_OPENED) {
      // Consumed by Story 2.7 (PositionsTable)
    } else if (message.event === EVENTS.POSITION_CLOSED) {
      // Consumed by Story 2.7 (PositionsTable)
    }
    ```

- [x] **Task 4** — Write tests (AC: all)
  - [x] 4.1 `src/client/store/index.test.ts` (extend existing):
    - Test `aggregateSummaryStats` recalculates after STATS_UPDATED event — verify `stats.totalPnl` = sum of all mode pnl values
    - Test `aggregateSummaryStats` recalculates after MODE_STOPPED with finalStats
    - Test `loadInitialStatus` populates `stats` aggregation correctly — totalPnl/totalVolume should be display-unit values NOT double-converted
    - Test `loadInitialStatus` sets `stats.walletBalance` from `data.connection.walletBalance`
    - Test `stats.walletBalance` comes from connection events, not mode stats
    - Test `TRADE_EXECUTED`, `POSITION_OPENED`, `POSITION_CLOSED` events don't throw (no-op handlers)
    - Test SummaryBar stats aggregate correctly when multiple modes have different stats
    - Test stats remain correct when one mode has zero stats and others don't
    - Test aggregation when one mode stops (MODE_STOPPED) while others continue — total should reflect the stopped mode's finalStats
  - [x] 4.2 `src/client/components/top-bar.test.tsx` (extend existing if present, or create):
    - Test PnL stats render with `text-profit` class when positive
    - Test PnL stats render with `text-loss` class when negative
    - Test PnL stats render with `text-text-muted` class when zero
    - Test non-PnL stats remain `text-text-muted`
    - Test `+` prefix on positive PnL values
    - Test wallet balance uses `fromSmallestUnit()` (smallest-unit → display)
    - Test totalPnl/totalVolume do NOT use `fromSmallestUnit()` (already display units)
    - Test totalTrades uses `formatInteger()` directly (no unit conversion)

## Dev Notes

### Existing Code to Extend (DO NOT Recreate)

| File | What Exists | What to Add/Change |
|------|-------------|---------------------|
| `src/client/store/index.ts` | Full Zustand store with `modes` slice (ModeStoreEntry), `stats` slice (SummaryStats), `connection` slice, `alerts[]`, `handleWsMessage` handling CONNECTION_STATUS, ALERT_TRIGGERED, MODE_STARTED, MODE_STOPPED, MODE_ERROR, STATS_UPDATED | ADD: `aggregateSummaryStats()` helper, call it from STATS_UPDATED/MODE_STOPPED/updateModeStats/loadInitialStatus handlers. ADD: no-op handlers for TRADE_EXECUTED, POSITION_OPENED, POSITION_CLOSED to prevent dev warnings |
| `src/client/components/top-bar.tsx` | TopBar with StatItem subcomponent, connection status display, 5 summary stats (wallet, totalPnl, sessionPnl, totalTrades, totalVolume). All stat values rendered in `text-text-muted`. Currently wraps ALL stat values with `fromSmallestUnit()` | MODIFY: Remove `fromSmallestUnit()` from totalPnl, sessionPnl, totalVolume (already display units). Keep it on walletBalance only. Add `valueClassName` prop to StatItem for PnL coloring (green/red/gray) |
| `src/client/App.tsx` | Main layout, `fetchStatus()` on mount → `loadInitialStatus()`, WebSocket hook, AlertBanner | No changes needed — already wired correctly |
| `src/shared/types.ts` | SummaryStats, ModeType, ModeStats, ModeConfig, StatusResponse, fromSmallestUnit | No changes needed |
| `src/shared/events.ts` | All 9 EVENTS, typed payloads including TradeExecutedPayload, PositionOpenedPayload, PositionClosedPayload | No changes needed — import existing payload types |
| `src/client/lib/format.ts` | `formatCurrency(value, showSign?)`, `formatInteger(value)` | No changes needed — already supports sign formatting |
| `src/client/lib/api.ts` | `fetchStatus()`, `startMode()`, `stopMode()`, `updateModeConfig()` | No changes needed |
| `src/client/hooks/use-websocket.ts` | WebSocket hook with reconnection, dispatches to `store.handleWsMessage()` | No changes needed |

### Architecture Compliance

Follow all Zustand rules from `project-context.md`. Key points for this story:
- `aggregateSummaryStats` is a plain helper called inside `set()` — not middleware
- TopBar subscribes via `useStore(s => s.connection)` and `useStore(s => s.stats)` — never whole store

### Data Flow for SummaryBar Stats (CRITICAL)

Current state (broken):
```
stats.totalPnl = 0 (always)
stats.totalTrades = 0 (always)
stats.totalVolume = 0 (always)
stats.walletBalance = from connection.status events (works)
```

After this story:
```
STATS_UPDATED event → updates modes[mode].stats → aggregateSummaryStats() → updates stats slice
MODE_STOPPED event → updates modes[mode].stats from finalStats → aggregateSummaryStats() → updates stats slice
loadInitialStatus → populates modes → aggregateSummaryStats() → updates stats slice
connection.status → updates connection.walletBalance AND stats.walletBalance (unchanged)
```

### Data Unit Consistency (CRITICAL)

The `stats` slice has **mixed units** — this is the most likely source of bugs:

| Field | Source | Unit in Store | TopBar Treatment |
|-------|--------|---------------|------------------|
| `walletBalance` | `connection.status` event | **smallest-unit** (raw chain balance) | `fromSmallestUnit()` before `formatCurrency()` — KEEP |
| `totalPnl` | aggregated from `modes[*].stats.pnl` | **display units** (server already converted) | REMOVE `fromSmallestUnit()` — pass directly to `formatCurrency()` |
| `sessionPnl` | aggregated from `modes[*].stats.pnl` | **display units** | REMOVE `fromSmallestUnit()` |
| `totalTrades` | aggregated from `modes[*].stats.trades` | **plain integer** | Already uses `formatInteger()` directly — no change |
| `totalVolume` | aggregated from `modes[*].stats.volume` | **display units** | REMOVE `fromSmallestUnit()` — pass directly to `formatCurrency()` |

**Verified**: `fundAllocator.getStats()` calls `fromSmallestUnit()` on pnl/volume/allocated/remaining before returning. Both `stats.updated` events and `GET /api/status` mode stats arrive in display units. Do NOT re-encode with `toSmallestUnit()` — that would introduce floating-point precision errors from the round-trip.

### Naming Conventions (Match Established Patterns)

- Files: `kebab-case` — `top-bar.tsx`, `top-bar.test.tsx`
- Functions: `camelCase` — `aggregateSummaryStats()`, `handleWsMessage()`
- CSS classes: Tailwind utilities + custom tokens — `text-profit`, `text-loss`, `text-text-muted`, `font-mono`

### UX Design Compliance

- **PnL formatting**: `+$1,247.83` (green), `-$42.10` (red), `$0.00` (gray muted) — `formatCurrency(value, true)` handles sign prefix, `Intl.NumberFormat` handles commas and decimals
- **Font**: JetBrains Mono (`font-mono`) for all stat values — already applied via StatItem
- Dark theme only, CSS custom properties (`--profit`, `--loss`, `--text-muted`). Connection status display already implemented.

### Previous Story Intelligence

**From Story 2.4 (ModeCard Component):**
- ModeCard subscribes via `useStore(s => s.modes[mode])` — single component definition renders all three modes
- Store `modes` slice has `ModeStoreEntry` with errorDetail/killSwitchDetail — already fully implemented
- `handleWsMessage` already handles MODE_STARTED, MODE_STOPPED, MODE_ERROR, STATS_UPDATED, KILL_SWITCH_TRIGGERED — extend don't rewrite
- `loadInitialStatus` already hydrates modes and connection — extend to also aggregate stats
- 284 tests passing — ensure no regressions
- `formatCurrency(value, showSign)` in `src/client/lib/format.ts` already supports sign prefix
- Review findings from 2-4: safety timeout cleanup, AbortController coordination, togglingRef lock — all already applied
- `StatusResponse` type already defined in `src/shared/types.ts`

**From Story 1.4 (SummaryBar & WebSocket):**
- TopBar uses `fromSmallestUnit()` on stat values before formatting — **this story fixes the over-application** (see Task 2)
- WebSocket hook dispatches all messages to `store.handleWsMessage()`
- Connection status display with colored dots already implemented
- **Known gap**: the `"reconnecting"` connection status is styled in TopBar but can never be set from a server event — `connection.status` handler maps `data.rpc === true` → `"connected"` and `false` → `"disconnected"`. The `"reconnecting"` state is only set by the WebSocket hook's `onclose` handler. This is not a bug — just note it to avoid confusion

### Git Intelligence

Recent commits show:
- 284 tests passing as of Story 2-4
- Pattern: co-located tests next to source files
- Path aliases: `@shared/*` for shared types, `@client/*` for client internals, relative paths for same-directory imports
- `top-bar.tsx` was refactored in Story 2-4 to use extracted `formatCurrency`/`formatInteger` from `../lib/format`

### Testing Approach

- Co-located test files: `top-bar.test.tsx` next to `top-bar.tsx`
- Extend existing `store/index.test.ts` with new aggregation tests
- Use Vitest + React Testing Library
- `// @vitest-environment jsdom` directive at top of component test files
- Mock Zustand store in component tests or use real store with controlled state
- For TopBar color tests: render component with known store state, query for CSS classes on stat elements

### Project Structure Notes

Modified files:
```
src/client/store/index.ts              # ADD: aggregateSummaryStats, fix loadInitialStatus stats, no-op event handlers
src/client/store/index.test.ts         # EXTEND: aggregation tests, loadInitialStatus stats, no-op handler tests
src/client/components/top-bar.tsx      # MODIFY: remove fromSmallestUnit on PnL/volume, add PnL coloring
src/client/components/top-bar.test.tsx # CREATE or EXTEND: PnL color tests, unit handling tests
```

No new files created (all changes are extensions of existing files).

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 2, Story 2.5 acceptance criteria]
- [Source: _bmad-output/planning-artifacts/architecture.md — Zustand Store Shape (lines 224-241), WebSocket Event Catalog (lines 403-415), Update Pattern (lines 417-421), Performance/loading states (lines 438-440)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — SummaryBar anatomy (lines 611-631), Financial number formatting (lines 829-835), Font rules (lines 300-315)]
- [Source: _bmad-output/planning-artifacts/prd.md — FR16-FR23 (stats/PnL/volume display), NFR2 (real-time WebSocket updates)]
- [Source: _bmad-output/project-context.md — Zustand Store Rules, Data Format Rules, Tailwind v4 rules]
- [Source: src/client/store/index.ts — Current store: modes slice, handleWsMessage, stats slice (lines 50-295)]
- [Source: src/client/components/top-bar.tsx — Current TopBar with StatItem, fromSmallestUnit usage (lines 1-109)]
- [Source: src/shared/events.ts — TradeExecutedPayload, PositionOpenedPayload, PositionClosedPayload types]
- [Source: src/shared/types.ts — SummaryStats interface, fromSmallestUnit/toSmallestUnit helpers]
- [Source: _bmad-output/implementation-artifacts/2-4-modecard-component-with-controls.md — Previous story: store implementation details, review findings]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

None — clean implementation, no debugging required.

### Completion Notes List

- **Task 1**: Added `aggregateSummaryStats()` helper to `src/client/store/index.ts` that computes `stats` by aggregating from all mode stats via `Object.values(modes)`. Wired it into `STATS_UPDATED`, `MODE_STOPPED`, `updateModeStats`, and `loadInitialStatus` handlers. Fixed `loadInitialStatus` to populate `stats.walletBalance` from connection data.
- **Task 2**: Removed `fromSmallestUnit()` from `totalPnl`, `sessionPnl`, and `totalVolume` in TopBar (these arrive in display units from server). Kept `fromSmallestUnit()` on `walletBalance` (arrives in smallest-unit). Added `valueClassName` prop to `StatItem` and `pnlColorClass()` helper for green/red/gray PnL coloring.
- **Task 3**: Added no-op handlers for `TRADE_EXECUTED`, `POSITION_OPENED`, `POSITION_CLOSED` events to suppress dev console warnings. These will be fully implemented in Stories 2.6 and 2.7.
- **Task 4**: Tests written using TDD (red-green-refactor) alongside each task. 22 new tests added (32 store tests, 17 TopBar tests). Full suite: 306 tests passing, 0 regressions.

### Review Findings

- [x] [Review][Patch] STATS_UPDATED handler lacks runtime type validation — casts `data.pnl as number` etc. without `typeof` guards, risking NaN propagation into aggregated stats [`src/client/store/index.ts:287`] — fixed: added typeof guards
- [x] [Review][Patch] loadInitialStatus does not validate mode keys — `as ModeType[]` cast allows unknown server keys to corrupt store shape and inflate aggregation [`src/client/store/index.ts:135`] — fixed: filter to known mode keys
- [x] [Review][Defer] setModeConfig can overwrite stats without re-aggregating — pre-existing [`src/client/store/index.ts:125`] — fixed: added aggregateSummaryStats() call

### Change Log

- 2026-04-04: Story 2.5 implementation complete — Zustand store aggregation, TopBar unit fix, PnL coloring, no-op event handlers

### File List

- `src/client/store/index.ts` — MODIFIED: added `aggregateSummaryStats()` helper, wired into STATS_UPDATED/MODE_STOPPED/updateModeStats/loadInitialStatus, added no-op handlers for TRADE_EXECUTED/POSITION_OPENED/POSITION_CLOSED
- `src/client/store/index.test.ts` — MODIFIED: added 10 new tests for aggregation, loadInitialStatus stats, no-op event handlers
- `src/client/components/top-bar.tsx` — MODIFIED: removed `fromSmallestUnit()` from PnL/volume stats, added `valueClassName` prop to StatItem, added `pnlColorClass()` for PnL coloring
- `src/client/components/top-bar.test.tsx` — MODIFIED: updated existing test for display-unit values, added 9 new tests for PnL coloring, unit handling verification
