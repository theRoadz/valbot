# Story 5.2: Trade History View

Status: done

## Story

As theRoad,
I want to browse my complete trade history with pagination,
So that I can review past trades, verify execution, and analyze performance.

## Acceptance Criteria

1. **Paginated trade history API** — Given trades have been recorded in the database, when `GET /api/trades?limit=50&offset=0` is called, then the response returns `{ trades: [...], total: number }` with trades converted to display units, and `total` reflects the full count of all trades in the DB
2. **Reverse chronological order** — Given the API returns trades, when displayed on the dashboard, then trades are sorted newest-first (descending `timestamp`)
3. **Trade row data** — Given a trade is displayed, then each row shows: timestamp (formatted date+time, not just HH:mm:ss), mode (colored tag), pair, side (green "Long" / red "Short"), size, price, PnL (colored with +/- prefix), and fees — all number columns use `font-mono` and are right-aligned
4. **Reuse PositionsTable styling** — Given the trade history table is rendered, then it reuses the same shadcn/ui Table components, row hover (`hover:bg-surface-elevated`), semantic HTML (`<table>`), and empty state pattern as PositionsTable
5. **Pagination controls** — Given more trades exist than the current page shows, then pagination controls allow navigating through historical trades (previous/next page buttons with current page indicator)
6. **Empty state** — Given no trade history exists in the database, then "No trade history" shows centered in muted text (same pattern as PositionsTable empty state)
7. **Initial load from /api/status** — Given the dashboard loads, when `/api/status` returns, then `trades` field contains the most recent trades (up to 50) from the DB instead of the hardcoded `[]`, and the store populates the trade history view from this initial data
8. **Dashboard integration** — Given the dashboard loads, when the bottom-left panel renders, then both open positions and trade history are visible inline on the same screen without tab-based or multi-page navigation (UX spec anti-pattern rule: no tabs for "positions," "history," "settings" as separate pages)

## Tasks / Subtasks

- [x] Task 1: Implement `/api/trades` with DB query and pagination (AC: #1, #2)
  - [x] 1.1 In `src/server/api/trades.ts`, replace the stub with a real Drizzle query: `SELECT * FROM trades ORDER BY timestamp DESC LIMIT :limit OFFSET :offset` using `getDb()`. Return `{ trades: [...], total: number }` where `total` = `SELECT COUNT(*) FROM trades`
  - [x] 1.2 Convert all monetary fields (`size`, `price`, `pnl`, `fees`) from smallest-unit integers to display units via `fromSmallestUnit()` before returning. Map `mode` to `ModeType` — the DB stores it as `text`, shared type expects `ModeType`
  - [x] 1.3 Add `mode` optional query parameter to filter trades by mode: `GET /api/trades?mode=volumeMax&limit=50&offset=0` (useful for Story 5.3 later, add the schema now)
  - [x] 1.4 Unit tests for `/api/trades`: empty DB returns `{ trades: [], total: 0 }`; insert N trades, verify pagination (limit, offset), verify reverse chronological order, verify display-unit conversion, verify mode filter

- [x] Task 2: Wire `/api/status` trades field to DB (AC: #7)
  - [x] 2.1 In `src/server/api/status.ts`, replace `trades: []` with a query to fetch the 50 most recent trades from DB, converted to display units (same conversion as Task 1.2). Reuse the query logic — extract a shared helper function in `trades.ts` that both endpoints use
  - [x] 2.2 Wrap in try/catch — if DB query fails, fall back to `trades: []` (same pattern as positions fallback)
  - [x] 2.3 Tests: `/api/status` returns recent trades when DB has data, returns `[]` when DB empty or engine not initialized

- [x] Task 3: Add `TradeHistoryTable` component (AC: #2, #3, #4, #5, #6)
  - [x] 3.1 Create `src/client/components/trade-history-table.tsx` — a new component that displays paginated trade history in a shadcn/ui Table
  - [x] 3.2 Table columns: Timestamp (formatted date+time), Mode (colored tag — reuse `MODE_TAGS` pattern from positions-table.tsx), Pair, Side (green/red), Size (font-mono, right-aligned), Price (font-mono, right-aligned), PnL (font-mono, right-aligned, colored with +/- prefix), Fees (font-mono, right-aligned)
  - [x] 3.3 Timestamp column uses a new `formatDateTime` helper in `src/client/lib/format.ts` that shows both date and time: `"Apr 7, 14:23:05"` format (since trade history spans multiple sessions/days, HH:mm:ss alone is insufficient)
  - [x] 3.4 Pagination controls: "Previous" and "Next" buttons (disabled at boundaries), page indicator showing `Page X of Y`. Use local component state for `currentPage`. Fetch trades via `GET /api/trades?limit=50&offset={page*50}`
  - [x] 3.5 Empty state: `"No trade history"` centered muted text in the table body (same `colSpan` pattern as PositionsTable)
  - [x] 3.6 Loading state: Show the same empty state during fetch — no per-component spinners per UX spec. Use `useEffect` to fetch on mount and page change
  - [x] 3.7 Component tests: renders empty state, renders trade rows with correct formatting, pagination buttons enable/disable correctly, mode tags use correct colors

- [x] Task 4: Add trade history store state, API helper, and fetching (AC: #5, #7)
  - [x] 4.1 In `src/client/lib/api.ts`, add a `fetchTrades(limit: number, offset: number, mode?: ModeType)` function following the exact same pattern as `fetchStatus()` — use `ApiError`, `handleResponse()`, and add a `isValidTradeHistoryResponse()` runtime shape validator. Return `TradeHistoryResponse`
  - [x] 4.2 In `src/client/store/index.ts`, add `tradeHistory: { trades: Trade[]; total: number; page: number; loading: boolean }` state slice with initial state `{ trades: [], total: 0, page: 0, loading: false }`. Add `setTradeHistory(data: TradeHistoryResponse, page: number)` synchronous setter and `setTradeHistoryLoading(loading: boolean)` setter. **Do NOT add async actions to the store** — the codebase pattern is that all fetch calls live in `api.ts` and are called from components, with results passed to the store via setters
  - [x] 4.3 In `loadInitialStatus()`, populate `tradeHistory.trades` from the status response `trades` array and set `tradeHistory.total` to `trades.length` as initial estimate (real total fetched on first paginated request via `/api/trades`)
  - [x] 4.4 In the existing `handleWsMessage` TRADE_EXECUTED case (~line 424 in store/index.ts), after the existing logic that appends to the live `trades` array, add: if `state.tradeHistory.page === 0`, prepend the new trade to `state.tradeHistory.trades` (`.slice(0, 50)` cap) and increment `state.tradeHistory.total`. If on another page, just increment `total`
  - [x] 4.5 In `TradeHistoryTable` component, call `fetchTrades()` from `api.ts` in a `useEffect` on mount and page change, then update store via `setTradeHistory()`. Handle errors with try/catch (log in dev, no user-facing error needed)
  - [x] 4.6 Store tests: `setTradeHistory` updates state correctly, TRADE_EXECUTED prepends to page 0, `loadInitialStatus` populates trade history. Mock `fetch` in component tests for `fetchTrades` calls

- [x] Task 5: Integrate TradeHistoryTable into dashboard layout (AC: #3, #4, #8)
  - [x] 5.1 The current layout has a bottom split: `PositionsTable (3fr)` + `TradeLog (2fr)`. The UX spec **explicitly forbids tabs** for positions/history/settings: *"No tabs for 'positions,' 'history,' 'settings' as separate pages. Inline or sectioned on the single view."* **Approach:** Stack PositionsTable and TradeHistoryTable vertically in the bottom-left panel, both visible inline. PositionsTable on top, TradeHistoryTable below, separated by a visual section divider
  - [x] 5.2 In `App.tsx`, replace the single `<PositionsTable />` in the bottom-left grid cell with a flex column containing both: `<div className="flex flex-col gap-4 min-h-0 overflow-auto"><PositionsTable /><TradeHistoryTable /></div>`. Both components render inside the same scrollable area
  - [x] 5.3 Remove the `Card` wrapper from `TradeHistoryTable` — it should be a bare section with a heading ("Trade History") to avoid nested cards in the scrollable column. Alternatively, keep the Card wrapper and let both cards stack naturally within the scroll container
  - [x] 5.4 The combined panel scrolls vertically — PositionsTable is visible first (usually small: 0-10 rows), TradeHistoryTable is below. When no positions are open, the positions empty state is compact and trade history dominates the view
  - [x] 5.5 Fetch trade history on initial mount (not lazy) since it's always visible inline

## Dev Notes

### Current State — Stub API Exists, DB Has Data

The `/api/trades` endpoint exists at `src/server/api/trades.ts` but returns `{ trades: [], total: 0 }`. The `trades` DB table is fully populated — every closed position writes a trade row via `PositionManager.closePosition()`. The `/api/status` endpoint also returns `trades: []` hardcoded. This story replaces both stubs with real DB queries.

### Key Files to Touch

| File | Action | Reason |
|------|--------|--------|
| `src/server/api/trades.ts` | Modify | Replace stub with real paginated DB query |
| `src/server/api/status.ts` | Modify | Replace `trades: []` with recent trades from DB |
| `src/client/components/trade-history-table.tsx` | **CREATE** | New paginated trade history table component |
| `src/client/components/trade-history-table.test.tsx` | **CREATE** | Component tests |
| `src/server/api/trades.test.ts` | **CREATE** | API endpoint tests |
| `src/client/store/index.ts` | Modify | Add `tradeHistory` state slice, setters, and TRADE_EXECUTED integration |
| `src/client/lib/api.ts` | Modify | Add `fetchTrades()` helper following existing `fetchStatus()` pattern |
| `src/client/lib/format.ts` | Modify | Add `formatDateTime` helper for date+time display |
| `src/client/App.tsx` | Modify | Stack PositionsTable + TradeHistoryTable inline in bottom-left panel |
| `src/shared/types.ts` | Modify | Add `TradeHistoryResponse` type |

### Architecture Compliance

- **DB boundary:** All queries go through Drizzle ORM via `getDb()`. No raw SQL except Drizzle's `sql` template when needed for COUNT.
- **Monetary values:** DB stores smallest-unit integers. Convert to display-unit via `fromSmallestUnit()` at the API response boundary. Client receives display-unit numbers — no conversion needed in frontend.
- **Naming:** File `trade-history-table.tsx` (kebab-case). Component `TradeHistoryTable` (PascalCase). API endpoint `/api/trades` (lowercase). Query params `camelCase`.
- **Lazy DB:** Use `getDb()` for every query — never cache the DB instance.
- **Error handling:** API try/catch with fallback to empty array. Use `AppError` for any structured errors.
- **API response format:** Direct payload `{ trades: [...], total: number }` — no wrapper object. Per architecture: "Trade history endpoint uses `{ trades: [...], total: number }` for pagination."

### Trade Data Conversion Pattern

The DB `trades` table stores all monetary fields as smallest-unit integers (USDC × 1e6). The API must convert before returning:

```typescript
// Conversion at API boundary — DO NOT convert in client
function dbTradeToApiTrade(dbTrade: DBTrade): Trade {
  return {
    id: dbTrade.id,
    mode: dbTrade.mode as ModeType,
    pair: dbTrade.pair,
    side: dbTrade.side as TradeSide,
    size: fromSmallestUnit(dbTrade.size),
    price: fromSmallestUnit(dbTrade.price),
    pnl: fromSmallestUnit(dbTrade.pnl),
    fees: fromSmallestUnit(dbTrade.fees),
    timestamp: dbTrade.timestamp, // Unix ms — no conversion
  };
}
```

This is the SAME conversion that `TRADE_EXECUTED` WebSocket events already do (position-manager.ts broadcasts display-unit values). The client `Trade` type already expects display-unit numbers.

### Shared Query Helper

Extract a reusable function that both `/api/trades` and `/api/status` use:

```typescript
// In src/server/api/trades.ts — exported for reuse
// NOTE: better-sqlite3 is SYNCHRONOUS — this function is sync, not async
export function getRecentTrades(limit: number, offset: number, mode?: ModeType): { trades: Trade[]; total: number } {
  const db = getDb();
  // Query with optional mode filter, ORDER BY timestamp DESC, LIMIT/OFFSET
  // Convert all monetary fields via fromSmallestUnit()
  // COUNT(*) for total (with same mode filter if applied)
}
```

`/api/status` calls `getRecentTrades(50, 0)` to populate its `trades` field.

### Reuse Patterns from PositionsTable

The `TradeHistoryTable` should closely follow `positions-table.tsx` patterns:
- Same shadcn/ui imports: `Table`, `TableBody`, `TableCell`, `TableHead`, `TableHeader`, `TableRow`
- Same `Card > CardHeader > CardContent` wrapper
- Same `MODE_TAGS` map with identical color classes: `text-mode-volume`, `text-mode-profit`, `text-mode-arb`
- Same `hover:bg-surface-elevated` on `TableRow`
- Same `font-mono text-xs text-right` on number cells
- Same empty state: `<TableCell colSpan={N} className="h-32 text-center"><span className="text-sm text-text-muted">No trade history</span></TableCell>`
- Side coloring: `text-profit` for Long, `text-loss` for Short (same as PositionsTable)
- PnL coloring: `text-profit` for positive, `text-loss` for negative (same as TradeLog trade-log.tsx pattern)

### Dashboard Layout Change

**UX anti-pattern rule:** *"No tabs for 'positions,' 'history,' 'settings' as separate pages. Inline or sectioned on the single view."* — Trade history must be visible inline, not behind tabs.

Current layout (App.tsx):
```
┌──────────────────────────────────────┐
│              TopBar                   │
├────────────┬───────────┬─────────────┤
│  ModeCard  │ ModeCard  │  ModeCard   │
├────────────┴─────┬─────┴─────────────┤
│ PositionsTable   │   TradeLog        │
│ (3fr)            │   (2fr)           │
└──────────────────┴───────────────────┘
```

New layout — stacked inline sections in left panel:
```
┌──────────────────────────────────────┐
│              TopBar                   │
├────────────┬───────────┬─────────────┤
│  ModeCard  │ ModeCard  │  ModeCard   │
├────────────┴─────┬─────┴─────────────┤
│ PositionsTable   │   TradeLog        │
│ ─────────────    │   (2fr)           │
│ TradeHistoryTable│                   │
│ (3fr, scrollable)│                   │
└──────────────────┴───────────────────┘
```

The bottom-left panel becomes a scrollable column with both tables stacked vertically. PositionsTable typically has 0-10 rows and is compact. TradeHistoryTable with pagination fills the remaining space. No new shadcn/ui components needed — just flex layout.

### Pagination UX

- Default page size: 50 trades (matches API schema `default: 50`)
- Page indicator: `"Page 1 of 3"` (compute `Math.ceil(total / limit)`)
- Previous/Next buttons: `disabled` at boundaries (page 0 for Previous, last page for Next)
- Style: Small buttons with `text-xs` size, muted colors, consistent with dashboard density
- No page-size selector — keep it simple, 50 per page is sufficient for a single-user trading bot

### DateTime Formatting

The existing `formatTime()` only shows `HH:mm:ss` which is fine for the live trade log (current session only). Trade history spans multiple days/sessions, so add:

```typescript
// In src/client/lib/format.ts
const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export function formatDateTime(timestamp: number): string {
  return dateTimeFormatter.format(new Date(timestamp));
}
```

### Shared Type Addition

Add to `src/shared/types.ts`:

```typescript
export interface TradeHistoryResponse {
  trades: Trade[];
  total: number;
}
```

This type is used by both the API response and the client store/fetcher.

### Store Shape Change

```typescript
// Add to ValBotStore interface — synchronous setters ONLY, no async actions in store
tradeHistory: {
  trades: Trade[];
  total: number;
  page: number;
  loading: boolean;
};
setTradeHistory: (data: TradeHistoryResponse, page: number) => void;
setTradeHistoryLoading: (loading: boolean) => void;
```

Initial state: `{ trades: [], total: 0, page: 0, loading: false }`.

**Pattern:** The codebase keeps the store synchronous — all `fetch()` calls live in `src/client/lib/api.ts` and are called from components/App.tsx. Results are passed to the store via setters. Do NOT add async actions to the store. Follow the same pattern as `fetchStatus()` → `loadInitialStatus()`.

### Client-Side API Helper

Add to `src/client/lib/api.ts`:

```typescript
export async function fetchTrades(
  limit = 50, offset = 0, mode?: ModeType,
): Promise<TradeHistoryResponse> {
  // Follow exact fetchStatus() pattern: try/catch fetch, handleResponse, shape validation
  // URL: `/api/trades?limit=${limit}&offset=${offset}` + optional `&mode=${mode}`
  // Validate shape with isValidTradeHistoryResponse() before returning
}
```

### WebSocket Live Update on Page 0

In the existing `handleWsMessage` TRADE_EXECUTED case (~line 424 in `store/index.ts`), the handler currently creates a `Trade` object and appends it to the live `trades` array (the trade log). **Extend this same case block** — after the existing logic — to also update `tradeHistory`:

```typescript
// After existing: set((state) => ({ trades: [...state.trades, newTrade].slice(-500) }))
// Add tradeHistory update in the same set() call:
if (state.tradeHistory.page === 0) {
  state.tradeHistory.trades = [newTrade, ...state.tradeHistory.trades].slice(0, 50);
}
state.tradeHistory.total++;
```

This keeps the first page live without requiring manual refresh. Other pages are static until navigated to.

### What NOT to Build

- Do NOT add filtering by date range — not in AC, keep it simple
- Do NOT add sorting controls — reverse chronological is the only order
- Do NOT add CSV/export functionality — not in scope
- Do NOT add per-mode trade history tabs — Story 5.3 handles per-mode stats
- Do NOT virtualize the table — 50 rows per page is well within DOM performance
- Do NOT modify the live TradeLog component — it stays unchanged in the right panel
- Do NOT add trade detail expandable rows — not in AC
- Do NOT change the WebSocket event payloads or trade recording logic — that all works correctly

### Cross-Story Dependencies

- **Story 5.1 (done):** Session persistence — ensures trades are flushed to DB on shutdown. This story depends on trades existing in the DB, which 5.1 guarantees.
- **Story 5.3 (backlog):** Combined Cross-Mode Statistics — depends on the `/api/trades?mode=X` endpoint this story implements. The `mode` query parameter (Task 1.3) is added here to support 5.3's per-mode trade count and volume aggregation.

### Deferred Work Items to Be Aware Of

- Live mark price for PositionsTable still shows "—" (deferred from Story 2-7)
- Position close matching by (mode, pair, side) is ambiguous with duplicates (deferred from Story 2-7)
- `loadFromDb` bypasses cross-mode total allocation validation (deferred from Story 4-4)
- These do NOT block this story

### Previous Story Learnings (from 5-1)

- 639 tests currently passing — do NOT break existing tests
- `fromSmallestUnit()` is the standard conversion at API boundaries — used in status.ts, position-manager broadcasts, etc.
- Store `loadInitialStatus()` is the entry point for initial data hydration — add trade history population there
- Store is purely synchronous — async fetch calls live in `src/client/lib/api.ts`, results passed to store setters from components/App.tsx
- `onTradeRecorded` callback pattern avoids circular dependencies between engine modules
- `Promise.allSettled` for parallel operations that must not block each other

### Git Intelligence

Recent commits follow the pattern: `feat: <description> with code review fixes (Story X-Y)`. All changes are committed as single squashed commits per story.

### Testing Patterns

- Co-locate tests: `trade-history-table.test.tsx` next to `trade-history-table.tsx`, `trades.test.ts` next to `trades.ts`
- **No shared test helpers.** Each test file defines its own inline `setupTestDb()`. Follow the pattern from previous story test files.
- For API tests, use the Drizzle query pattern to insert test data, then call the route handler
- For component tests, mock the store with `useStore.setState()`
- For store tests, use `useStore.getState()` and `useStore.setState()` for setup/assertion
- For component tests that call `fetchTrades()`, mock the `api.ts` module via `vi.mock("@client/lib/api")`
- Use `vi.fn()` for mocking, `vi.mock()` for module-level mocks

### Project Structure Notes

- New component goes in `src/client/components/trade-history-table.tsx` (flat file, no nested folder)
- API modifications stay in `src/server/api/trades.ts` and `status.ts`
- Shared type additions in `src/shared/types.ts`
- Format helpers in `src/client/lib/format.ts`
- All aligned with existing project structure conventions

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 5, Story 5.2]
- [Source: _bmad-output/planning-artifacts/architecture.md — REST API Endpoints, Database Schema, API Response Formats, WebSocket Events, Testing Standards, Component Architecture]
- [Source: _bmad-output/planning-artifacts/prd.md — FR21 (trade history), FR24 (live trade log)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — Dashboard Layout, Table Patterns, Data Display, Typography, Empty States]
- [Source: _bmad-output/implementation-artifacts/5-1-session-persistence-and-cross-session-profit-tracking.md — Previous story learnings]
- [Source: _bmad-output/project-context.md — All implementation rules]
- [Source: src/server/api/trades.ts — Existing stub endpoint]
- [Source: src/server/api/status.ts — Current hardcoded trades: []]
- [Source: src/server/db/schema.ts — trades table definition]
- [Source: src/shared/types.ts — Trade interface, StatusResponse, fromSmallestUnit]
- [Source: src/client/components/positions-table.tsx — Table styling pattern to reuse]
- [Source: src/client/components/trade-log.tsx — MODE_TAGS pattern, TradeEntry formatting]
- [Source: src/client/store/index.ts — Store patterns, loadInitialStatus, TRADE_EXECUTED handler]
- [Source: src/client/lib/api.ts — fetchStatus(), ApiError, handleResponse() patterns for client-side API calls]
- [Source: src/client/lib/format.ts — formatCurrency, formatTime helpers]
- [Source: src/client/App.tsx — Current dashboard layout structure]

### Review Findings

- [x] [Review][Decision] `/api/status` wraps `getRecentTrades` in try/catch IIFE — dismissed: intentional graceful degradation at composition boundary, consistent with positions fallback pattern [src/server/api/status.ts:90-96]
- [x] [Review][Patch] `loadInitialStatus` sets `tradeHistory.total` to `loadedTrades.length` (≤50) — self-corrects on mount via `useEffect` fetch; pagination stranding fixed by patch 6 [src/client/store/index.ts:248-250]
- [x] [Review][Patch] WS `TRADE_EXECUTED` client-generated ID collision — fixed: changed to negative decrementing IDs to avoid collision with DB auto-increment [src/client/store/index.ts:6,472]
- [x] [Review][Patch] `goToPrevPage`/`goToNextPage` stale closure — fixed: now reads from `useStore.getState().tradeHistory.page` [src/client/components/trade-history-table.tsx:72-86]
- [x] [Review][Patch] `goToPrevPage`/`goToNextPage` bypass store actions — fixed: added `setTradeHistoryPage` store action [src/client/store/index.ts, trade-history-table.tsx]
- [x] [Review][Patch] Pagination controls hidden at `total <= PAGE_SIZE` — fixed: now also shown when `currentPage > 0` [src/client/components/trade-history-table.tsx:93]
- [x] [Review][Defer] ~~`formatDateTime` uses runtime-local timezone~~ — resolved: added `timeZone: "UTC"` to both `timeFormatter` and `dateTimeFormatter` [src/client/lib/format.ts:27,40]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- Initial test failure: DB state leaking between sibling `describe` blocks — resolved by restructuring to file-level `beforeAll`/`afterAll`/`beforeEach` with unique DB path per process

### Completion Notes List

- Task 1: Replaced `/api/trades` stub with real Drizzle query using `getRecentTrades()` shared helper. Supports `limit`, `offset`, and optional `mode` filter. 13 tests covering empty DB, pagination, reverse chronological order, display-unit conversion, mode filtering, and validation.
- Task 2: Wired `/api/status` trades field to DB via `getRecentTrades(50, 0)` with try/catch fallback to `[]`. Added 2 status tests (DB data return + DB failure fallback).
- Task 3: Created `TradeHistoryTable` component with shadcn/ui Table, MODE_TAGS pattern, `formatDateTime` helper, pagination controls, empty state. 12 component tests.
- Task 4: Added `tradeHistory` state slice, `setTradeHistory`/`setTradeHistoryLoading` setters, `fetchTrades()` API helper with shape validation, `loadInitialStatus` trade history population, TRADE_EXECUTED live update on page 0. 5 store tests.
- Task 5: Integrated `TradeHistoryTable` inline below `PositionsTable` in a scrollable flex column in `App.tsx` — no tabs, both visible on the single view.

### Change Log

- 2026-04-07: Story 5.2 implementation complete — trade history view with paginated API, DB-backed status endpoint, inline dashboard integration, and 668 passing tests (29 new, 0 regressions)

### File List

- `src/server/api/trades.ts` — Modified: replaced stub with real Drizzle query, exported `getRecentTrades()` shared helper
- `src/server/api/trades.test.ts` — Modified: rewrote with 13 tests covering `getRecentTrades` helper and route handler
- `src/server/api/status.ts` — Modified: replaced `trades: []` with `getRecentTrades(50, 0)` call with fallback
- `src/server/api/status.test.ts` — Modified: added mock for `getRecentTrades`, 2 new tests for trades from DB and DB failure fallback
- `src/shared/types.ts` — Modified: added `TradeHistoryResponse` interface
- `src/client/components/trade-history-table.tsx` — Created: paginated trade history table component
- `src/client/components/trade-history-table.test.tsx` — Created: 12 component tests
- `src/client/store/index.ts` — Modified: added `tradeHistory` state slice, setters, `loadInitialStatus` population, TRADE_EXECUTED live update
- `src/client/store/index.test.ts` — Modified: added `tradeHistory` to beforeEach reset, 5 new store tests
- `src/client/lib/api.ts` — Modified: added `fetchTrades()` helper with `isValidTradeHistoryResponse` validator
- `src/client/lib/format.ts` — Modified: added `formatDateTime()` helper for date+time display
- `src/client/App.tsx` — Modified: stacked PositionsTable + TradeHistoryTable inline in bottom-left panel
