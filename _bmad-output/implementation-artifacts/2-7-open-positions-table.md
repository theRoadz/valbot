# Story 2.7: Open Positions Table

Status: done

## Story

As theRoad,
I want to see all currently open positions in a live-updating table,
so that I can monitor my exposure and verify stop-losses are set.

## Acceptance Criteria

1. **Given** the bottom-left panel of the dashboard layout, **when** Volume Max has open positions, **then** the PositionsTable renders with columns: Mode (purple "VOL"), Pair, Side (green "Long" / red "Short"), Size, Entry, Mark (live-updating), PnL (colored), Stop-Loss.
2. All number columns are right-aligned JetBrains Mono (`font-mono text-right`).
3. PnL shows +/- prefix with green positive (`text-profit`), red negative (`text-loss`), gray zero (`text-text-muted`).
4. `position.opened` WebSocket events add rows to the table.
5. `position.closed` WebSocket events trigger a yellow highlight (200ms fade) on the row before removal.
6. Mark price and PnL update in real-time via stats or position update events.
7. The table uses semantic HTML (`<thead>`/`<tbody>`) with proper structure (already provided by shadcn Table primitives).
8. When no positions exist, "No open positions" shows centered in muted text.
9. Row hover shows subtle background elevation (`hover:bg-surface-elevated`).
10. Positions hydrate from `loadInitialStatus` (StatusResponse already includes `positions: Position[]`).

## Tasks / Subtasks

- [x] Task 1: Add `positions` array to Zustand store and wire POSITION_OPENED / POSITION_CLOSED handlers (AC: #4, #5, #10)
  - [x] 1.1 Add `positions: Position[]` to `ValBotStore` interface and initial state (`positions: []`)
  - [x] 1.2 Import `Position` type into the store: add `Position` to the existing `@shared/types` import line
  - [x] 1.3 Import `PositionOpenedPayload` and `PositionClosedPayload` from `@shared/events` (add to existing import)
  - [x] 1.4 Replace `POSITION_OPENED` no-op (line 362-363) with handler that validates payload with `typeof` guards + `VALID_MODES`/`VALID_SIDES` checks, creates a `Position` object using `message.timestamp` and an incrementing `positionIdCounter`, and appends to `positions` array
  - [x] 1.5 Replace `POSITION_CLOSED` no-op (line 364-365) with handler that validates payload, finds the matching position by `mode + pair + side`, marks it for closing animation (see Task 1.6), then removes after a brief delay OR marks with a `closing` flag for the component to animate
  - [x] 1.6 For closing animation support: the simplest approach is to add a `closingPositionIds: Set<number>` or `closingPositions: number[]` to the store. On POSITION_CLOSED: add the matched position ID to `closingPositions`, then after 200ms remove both the ID from `closingPositions` and the position from `positions`. Use `setTimeout` inside the handler (Zustand supports this — pattern: call `set()` twice, once immediately for highlight, once after timeout for removal)
  - [x] 1.7 Hydrate `positions` from `loadInitialStatus`: add `positions: data.positions?.slice(0, 200) ?? []` to the returned state. Sync `positionIdCounter` same pattern as `tradeIdCounter`
  - [x] 1.8 Add `positions: []` and `closingPositions: []` to the `beforeEach` `useStore.setState()` reset block in `index.test.ts`
  - [x] 1.9 Write store tests: POSITION_OPENED adds position, validates payload (rejects invalid mode/side/non-finite numbers/empty pair), POSITION_CLOSED removes matching position, loadInitialStatus populates positions

- [x] Task 2: Build `PositionsTable` component with position row rendering (AC: #1, #2, #3, #7, #8, #9)
  - [x] 2.1 Replace placeholder in `src/client/components/positions-table.tsx` — keep Card/Table imports, add store subscription
  - [x] 2.2 Subscribe to `useStore(s => s.positions)` and `useStore(s => s.closingPositions)` (slice selectors, never full store)
  - [x] 2.3 Render each position row with:
    - **Mode:** Abbreviated tag — `volumeMax` → "VOL" in `text-mode-volume`, `profitHunter` → "PRO" in `text-mode-profit`, `arbitrage` → "ARB" in `text-mode-arb`. **No brackets** — TradeLog uses `[VOL]` but PositionsTable uses plain `VOL` per the epics AC. Do NOT copy brackets from TradeLog.
    - **Pair:** Plain text, e.g. "SOL-PERP"
    - **Side:** "Long" in `text-profit` / "Short" in `text-loss`
    - **Size:** `formatCurrency(position.size)` right-aligned mono
    - **Entry:** `formatCurrency(position.entryPrice)` right-aligned mono (2 decimal places — consistent with all other financial displays; higher-precision crypto pricing is deferred)
    - **Mark:** Display mark price if available, otherwise "—" in muted text (see Dev Notes on mark price)
    - **PnL:** `formatCurrency(pnl, true)` with `text-profit` / `text-loss` / `text-text-muted` coloring. PnL is computed client-side from mark vs entry when mark data is available; otherwise show "—"
    - **Stop-Loss:** `formatCurrency(position.stopLoss)` right-aligned mono
  - [x] 2.4 Closing animation: rows in `closingPositions` get `bg-warning/20` class with `transition-colors duration-200` for yellow highlight fade
  - [x] 2.5 Empty state: centered `"No open positions"` in `text-sm text-text-muted` when positions array is empty
  - [x] 2.6 Row hover: `hover:bg-surface-elevated` on each `TableRow`
  - [x] 2.7 All number cells: `font-mono text-xs text-right` — header cells for number columns also `text-right`

- [x] Task 3: Write component tests (AC: all)
  - [x] 3.1 Renders empty state when positions array is empty
  - [x] 3.2 Renders position rows with correct mode tag abbreviation and color class
  - [x] 3.3 Side renders "Long" with `text-profit` class and "Short" with `text-loss` class
  - [x] 3.4 Financial values render with `font-mono` class
  - [x] 3.5 PnL values render with correct sign and color class (when mark price is available)
  - [x] 3.6 Closing positions get yellow highlight class
  - [x] 3.7 All table headers render correctly

## Dev Notes

### Store Changes

The Zustand store (`src/client/store/index.ts`) currently has no-ops for position events on lines 362-365:
```typescript
} else if (message.event === EVENTS.POSITION_OPENED) {
  // No-op — positions table (Story 2.7) will consume these
} else if (message.event === EVENTS.POSITION_CLOSED) {
  // No-op — positions table (Story 2.7) will consume these
```

**POSITION_OPENED handler pattern** (follow the same validation pattern as TRADE_EXECUTED handler at lines 336-361):
1. Cast `message.data` as `Record<string, unknown>`
2. Validate with `typeof` guards: `mode` is string in `VALID_MODES`, `pair` is non-empty string, `side` is string in `VALID_SIDES`, `size`/`entryPrice`/`stopLoss` are all `Number.isFinite()` (not just `typeof === "number"` — learned from Story 2-6 review)
3. Create Position: `{ id: ++positionIdCounter, mode, pair, side, size, entryPrice, stopLoss, timestamp: message.timestamp }`
4. Append to positions: `[...state.positions, newPosition]`

**POSITION_CLOSED handler pattern:**
1. Same payload validation (mode, pair, side, size, exitPrice, pnl — all validated)
2. Find matching position: `state.positions.find(p => p.mode === mode && p.pair === pair && p.side === side)` — match by mode+pair+side since a mode should only have one open position per pair per side
3. If found, add position ID to `closingPositions` array
4. Use `setTimeout(() => { set(state => ({ positions: state.positions.filter(p => p.id !== matchedId), closingPositions: state.closingPositions.filter(id => id !== matchedId) })); }, 300)` for delayed removal after animation. **Use 300ms, not 200ms** — the CSS `transition-colors duration-200` needs 200ms to complete the fade-in to yellow; a 300ms timeout gives the user ~100ms to perceive the highlight before the row is removed from the DOM.

**Add to store interface:**
```typescript
positions: Position[];
closingPositions: number[];
```

**Add to initial state:**
```typescript
positions: [],
closingPositions: [],
```

**Add counter at module level** (next to `tradeIdCounter` on line 6):
```typescript
let positionIdCounter = 0;
```

**loadInitialStatus** — add to the return object (around line 161-170):
```typescript
positions: data.positions?.slice(0, 200) ?? [],
```
And sync counter:
```typescript
const loadedPositions = data.positions?.slice(0, 200) ?? [];
if (loadedPositions.length > 0) {
  positionIdCounter = Math.max(positionIdCounter, ...loadedPositions.map((p) => p.id));
}
```

### Mark Price / Live PnL — Architecture Gap

**Critical finding:** The `Position` interface (`src/shared/types.ts:48-57`) does NOT include a `markPrice` field. The WebSocket event catalog defines `position.opened` and `position.closed` but no `position.updated` event for live mark price updates.

**UX-DR7 requires:** "Mark (live-updating)" column and "mark price and PnL update in real-time."

**Recommended approach for this story:**
1. Render the Mark and PnL columns but show "—" (muted dash) when mark price is unavailable
2. The table structure is ready for future mark price data
3. When a future story adds live price feeds (e.g., Epic 4 with Pyth oracle, or a `position.updated` WS event), the component can compute mark and PnL dynamically
4. **Do NOT invent a mark price mechanism** — this would be scope creep beyond the defined architecture. The positions table should display what data is available now (mode, pair, side, size, entry, stop-loss) and gracefully degrade on mark/PnL

**Alternative if the dev wants to add basic PnL:** The POSITION_CLOSED event includes `exitPrice` and `pnl` — but that's only available at close time. For open positions, there's no live data source defined yet.

**Add this as a deferred item** to `deferred-work.md`:
```
- [ ] Live mark price and PnL for PositionsTable — requires a position.updated WS event or Pyth oracle feed integration (Story 2.7 renders "—" for Mark/PnL columns until this is available)
```

### Component Architecture

The placeholder component exists at `src/client/components/positions-table.tsx`. It already imports Card, CardContent, CardHeader, CardTitle, Table, TableBody, TableCell, TableHead, TableHeader, TableRow — all shadcn/ui primitives needed.

**Mode tag map** (same structure as TradeLog at `src/client/components/trade-log.tsx`, but **without brackets** — table cells use plain abbreviations per epics AC):
```typescript
const MODE_TAGS: Record<ModeType, { label: string; colorClass: string }> = {
  volumeMax:    { label: "VOL", colorClass: "text-mode-volume" },
  profitHunter: { label: "PRO", colorClass: "text-mode-profit" },
  arbitrage:    { label: "ARB", colorClass: "text-mode-arb" },
};
```

**Side coloring** (same pattern as TradeLog):
- "Long" → `text-profit` (green #22c55e)
- "Short" → `text-loss` (red #ef4444)

**PnL coloring** (same inline pattern as TopBar `src/client/components/top-bar.tsx:53-57`):
```typescript
function pnlColorClass(value: number): string {
  if (value > 0) return "text-profit";
  if (value < 0) return "text-loss";
  return "text-text-muted";
}
```
Define this as a local helper in PositionsTable (same as TopBar does). Do not extract to a shared util — two usages doesn't warrant an abstraction.

**Closing animation:** Apply `bg-warning/20` (amber at 20% opacity) + `transition-colors duration-200` to rows whose ID is in `closingPositions`. The 300ms timeout in the store handler removes the position, causing the row to disappear. The visual flow:
1. POSITION_CLOSED received → position ID added to `closingPositions` → CSS transition fades row to yellow over 200ms
2. After 300ms (200ms transition + 100ms visible) → position removed from `positions` + `closingPositions` → row disappears from DOM

### Existing Patterns to Follow

- **Slice selectors:** `useStore(s => s.positions)` — never subscribe to full store (pattern from Story 2-5)
- **typeof + Number.isFinite() guards on WS payloads:** Validate with `Number.isFinite()` not just `typeof === "number"` to catch NaN/Infinity (fix from Story 2-6 review)
- **Non-empty string guards:** Check `pair.length > 0` not just `typeof === "string"` (fix from Story 2-6 review)
- **VALID_MODES / VALID_SIDES sets:** Already defined in store at lines 8-9, reuse for position validation
- **File naming:** `positions-table.tsx` / `positions-table.test.tsx` (kebab-case, co-located tests)
- **Test setup:** `// @vitest-environment jsdom` directive, `@testing-library/react`, mock store state
- **No wrapper abstractions:** Compose directly from shadcn/ui primitives (Card, Table)
- **Immutable store updates:** Spread + filter patterns for array management
- **formatCurrency:** Import from `src/client/lib/format.ts` — `formatCurrency(value)` for amounts, `formatCurrency(value, true)` for PnL with sign

### Project Structure Notes

- Component: `src/client/components/positions-table.tsx` (already exists as placeholder — replace)
- Test: `src/client/components/positions-table.test.tsx` (already exists with 3 basic tests — expand)
- Store: `src/client/store/index.ts` (modify — add `positions` + `closingPositions` slices + handlers)
- Store test: `src/client/store/index.test.ts` (modify — add position handler tests)
- Deferred work: `_bmad-output/implementation-artifacts/deferred-work.md` (add mark price deferred item)
- No new shared types needed — `Position`, `PositionOpenedPayload`, `PositionClosedPayload` already exist
- No new CSS variables needed — mode colors, financial colors, surface-elevated, warning all already defined
- No changes to App.tsx — PositionsTable is already placed in the layout (bottom-left, 3fr)

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 2, Story 2.7]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — UX-DR7 PositionsTable, UX-DR12, UX-DR14, UX-DR15]
- [Source: _bmad-output/planning-artifacts/architecture.md — WebSocket event catalog, component structure, Zustand store shape]
- [Source: src/shared/types.ts:48-57 — Position interface]
- [Source: src/shared/events.ts:11-12, 77-93 — POSITION_OPENED/CLOSED events + payloads]
- [Source: src/client/store/index.ts:362-365 — POSITION_OPENED/CLOSED no-ops to replace]
- [Source: src/client/store/index.ts:140-171 — loadInitialStatus function to extend]
- [Source: src/client/components/positions-table.tsx — existing placeholder to replace]
- [Source: src/client/components/positions-table.test.tsx — existing 3 tests to expand]
- [Source: src/client/components/trade-log.tsx — MODE_TAGS constant pattern to reuse]
- [Source: src/client/components/top-bar.tsx — pnlColorClass pattern to reuse]
- [Source: src/client/lib/format.ts — formatCurrency(value, showSign)]

### Previous Story Intelligence (2-6)

Key learnings from Story 2-6 that apply here:
- **Number.isFinite() guards:** `typeof === "number"` passes NaN and Infinity. Always validate financial numbers with `Number.isFinite()` (review finding from 2-6)
- **Non-empty string check:** `typeof === "string"` passes empty strings. Always check `.length > 0` for pair names (review finding from 2-6)
- **Radix ScrollArea ref quirk:** Does not apply here — PositionsTable uses `overflow-auto` on CardContent, not ScrollArea
- **Trade order append vs prepend:** Positions should be appended (newest at bottom) matching the natural table reading order. On close, position is removed from wherever it sits.
- **Counter sync in loadInitialStatus:** Always sync `positionIdCounter` from loaded data to prevent ID collisions (same pattern as `tradeIdCounter` sync on line 158-159)
- **Test baseline:** 326 tests passing as of Story 2-6; expect zero regressions

### Git Intelligence

Recent commits show consistent patterns:
- Story implementations follow TDD with co-located test files
- Store changes are tested with dedicated store test cases in `index.test.ts`
- Component tests use `@testing-library/react` with mocked store state via `useStore.setState()`
- All stories maintain zero regression baseline
- Most recent commit (`690e969`) was Story 2-6 (TradeLog) — direct predecessor with similar patterns

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
- Full test suite: 343 tests passing (baseline 326 + 17 new), zero regressions
- Bug fix: `isValidStatusResponse()` in `src/client/lib/api.ts` was checking stale `conn.walletBalance` field (renamed to `equity`/`available` in Story 8-2). This caused `fetchStatus()` to silently throw, preventing `loadInitialStatus()` from running — positions (and trades) from initial `/api/status` response were never hydrated.

### Completion Notes List
- Task 1: Added `positions: Position[]` and `closingPositions: number[]` to Zustand store. Implemented POSITION_OPENED handler with full payload validation (typeof + Number.isFinite + VALID_MODES/VALID_SIDES + non-empty pair). Implemented POSITION_CLOSED handler with match-by-mode+pair+side, closing animation via closingPositions array, and 300ms delayed removal. Hydrated positions from loadInitialStatus with 200-entry cap and positionIdCounter sync. 11 new store tests.
- Task 2: Replaced PositionsTable placeholder with full implementation. Subscribes via slice selectors. Renders mode tags (VOL/PRO/ARB without brackets), side coloring (Long=green, Short=red), right-aligned mono financial numbers, closing animation highlight (bg-warning/20), empty state, and hover elevation. Mark and PnL columns show "—" pending future mark price data (deferred item added).
- Task 3: Expanded component tests from 3 to 11. Tests cover: empty state, mode tag abbreviations and colors, side coloring, font-mono on financial cells, mark/PnL dash rendering, closing highlight class, header text-right alignment, and no-empty-state-when-positions-exist.

### Change Log
- 2026-04-05: Implemented Story 2.7 — Open Positions Table (all 3 tasks complete)
- 2026-04-05: Bug fix — `isValidStatusResponse()` validator used stale `walletBalance` field instead of `equity`/`available` (left over from Story 8-2 rename). Fixed validator + 4 stale test files. Positions now hydrate correctly on page load.

### File List
- src/client/store/index.ts (modified — added positions/closingPositions slices, POSITION_OPENED/CLOSED handlers, loadInitialStatus hydration)
- src/client/store/index.test.ts (modified — added 11 position handler tests, reset block updated)
- src/client/components/positions-table.tsx (modified — replaced placeholder with full implementation)
- src/client/components/positions-table.test.tsx (modified — expanded from 3 to 11 tests)
- _bmad-output/implementation-artifacts/deferred-work.md (modified — added mark price deferred item)
- _bmad-output/implementation-artifacts/sprint-status.yaml (modified — status updated)
- src/client/lib/api.ts (modified — fixed `isValidStatusResponse()` to check `equity`/`available` instead of stale `walletBalance`)
- src/client/lib/api.test.ts (modified — updated mock data and test name for `equity`/`available`)
- src/shared/types.test.ts (modified — updated ConnectionState and SummaryStats type tests for `equity`/`available`)
- src/client/hooks/use-websocket.test.ts (modified — updated stale `walletBalance` references in beforeEach reset)
- _bmad-output/implementation-artifacts/2-7-open-positions-table.md (modified — tasks checked, status, dev record)

### Review Findings

- [x] [Review][Patch] P1: Remove dead `pnlColorClass` function [positions-table.tsx:20-24] — applied
- [x] [Review][Patch] P2: `isValidStatusResponse` uses `typeof` not `Number.isFinite()` for equity/available [api.ts:122] — applied
- [x] [Review][Patch] P3: POSITION_CLOSED race — second `getState()` read can orphan closingPositions entries [store/index.ts:412-432] — applied
- [x] [Review][Patch] P4: Duplicate POSITION_CLOSED events can add same ID to closingPositions twice [store/index.ts:412] — applied
- [x] [Review][Defer] D1: Position close matching by (mode,pair,side) ambiguous with duplicates — deferred, server gap
- [x] [Review][Patch] D2: No upper bound on positions array from WS events [store/index.ts] — applied: added `.slice(-200)` cap
- [x] [Review][Patch] D3: loadInitialStatus does not validate individual position objects [store/index.ts] — applied: added `isValidPosition()` filter
- [x] [Review][Patch] D4: POSITION_CLOSED setTimeout never cancelled on unmount [store/index.ts] — applied: added `pendingCloseTimers` Map with cleanup on rehydration
- [x] [Review][Dismiss] D5: TableRow base hover class conflict — dismissed: `cn()` uses `twMerge` which resolves it correctly
