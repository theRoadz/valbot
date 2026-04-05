# Story 2.6: Live Trade Log

Status: done

## Story

As theRoad,
I want a live streaming trade log on the dashboard showing every trade as it happens,
so that I can see the bot is alive and verify what it's doing in real-time.

## Acceptance Criteria

1. **Given** the bottom-right panel of the dashboard layout, **when** Volume Max is executing trades, **then** the TradeLog component renders inside a ScrollArea filling the available height.
2. Each entry shows: timestamp (`HH:mm:ss`, 24hr, muted), mode tag (`[VOL]` in purple / `[PRO]` in green / `[ARB]` in cyan), action, side, pair, and details.
3. `trade.executed` WebSocket events append entries to the log in real-time.
4. Position close entries include inline PnL: `"Closed Long SOL-PERP +$14.20"`.
5. The log auto-scrolls to the newest entry.
6. Auto-scroll pauses when the user hovers or manually scrolls up.
7. A "New trades below" indicator appears when paused with new entries.
8. Auto-scroll resumes when the user scrolls to bottom or moves mouse away.
9. Maximum 500 entries retained in DOM; older entries are garbage collected.
10. When no trades exist, `"Waiting for trades..."` placeholder shows centered in muted text.
11. All text uses JetBrains Mono font.

## Tasks / Subtasks

- [x] Task 1: Add `trades` array to Zustand store and wire `TRADE_EXECUTED` handler (AC: #3, #9)
  - [x] 1.1 Add `trades: Trade[]` to `ValBotStore` interface
  - [x] 1.2 Replace `TRADE_EXECUTED` no-op with handler that validates payload, creates a `Trade` object (using `message.timestamp` and an incrementing counter for `id`), prepends to `trades`, and slices to 500
  - [x] 1.3 Hydrate `trades` from `loadInitialStatus` (StatusResponse already includes `trades: Trade[]`)
  - [x] 1.4 **Replace** the existing no-op TRADE_EXECUTED test (line 569-579 in `index.test.ts`) with functional tests: TRADE_EXECUTED appends trade, enforces 500-entry cap, validates payload fields with `typeof` guards, loadInitialStatus populates trades
  - [x] 1.5 Add `trades: []` to the `beforeEach` `useStore.setState()` reset block in `index.test.ts` to prevent state leakage

- [x] Task 2: Build `TradeLog` component with entry rendering (AC: #1, #2, #4, #10, #11)
  - [x] 2.1 Replace placeholder in `src/client/components/trade-log.tsx`
  - [x] 2.2 Subscribe to `useStore(s => s.trades)` (slice selector, never full store)
  - [x] 2.3 Render each trade entry with: timestamp formatted via `Intl.DateTimeFormat` (`HH:mm:ss` 24hr), mode badge with mode color, action text ("Opened"/"Closed"), side, pair, size/price or PnL details
  - [x] 2.4 Mode tag abbreviations: `volumeMax` → `[VOL]` (purple `text-mode-volume`), `profitHunter` → `[PRO]` (green `text-mode-profit`), `arbitrage` → `[ARB]` (cyan `text-mode-arb`)
  - [x] 2.5 PnL coloring on close entries: positive → `text-profit`, negative → `text-loss`, zero → `text-text-muted`
  - [x] 2.6 Empty state: centered `"Waiting for trades..."` in `text-xs font-mono text-text-muted`
  - [x] 2.7 All entry text in `font-mono text-xs` (JetBrains Mono, 12px)

- [x] Task 3: Implement auto-scroll with pause-on-hover (AC: #5, #6, #7, #8)
  - [x] 3.1 Use a `ref` on the scroll container; on new trades, call `scrollTo({ top: scrollHeight, behavior: 'smooth' })` if auto-scroll is active
  - [x] 3.2 Track `isAutoScroll` state: set `false` on `onMouseEnter` or manual scroll-up (detect via `scrollTop + clientHeight < scrollHeight - threshold`); set `true` on `onMouseLeave` or scroll-to-bottom
  - [x] 3.3 Render a sticky "New trades below ↓" indicator at the bottom when `isAutoScroll === false` and new trades have arrived since pause
  - [x] 3.4 Clicking the indicator scrolls to bottom and re-enables auto-scroll

- [x] Task 4: Write component tests (AC: all)
  - [x] 4.1 Renders empty state when trades array is empty
  - [x] 4.2 Renders trade entries with correct timestamp, mode tag, side, pair
  - [x] 4.3 Mode tags display correct abbreviation and color class
  - [x] 4.4 PnL values render with correct sign and color class
  - [x] 4.5 All entry text has `font-mono` class

## Dev Notes

### Store Changes

The Zustand store (`src/client/store/index.ts`) currently has a no-op for `TRADE_EXECUTED` on line 323-324:
```typescript
} else if (message.event === EVENTS.TRADE_EXECUTED) {
  // No-op — trade log (Story 2.6) will consume these
}
```

Replace with a handler that:
1. Validates payload with `typeof` guards (same pattern as `STATS_UPDATED` handler, line 291-322)
2. Creates a `Trade` object: `{ id: ++tradeIdCounter, mode, pair, side, size, price, pnl, fees, timestamp: message.timestamp }`
3. Prepends to `trades` array: `[newTrade, ...state.trades].slice(0, 500)`

Add `trades: Trade[]` initialized to `[]` in the store's initial state.

In `loadInitialStatus`, add: `trades: data.trades?.slice(0, 500) ?? []`

The `Trade` interface is already defined in `src/shared/types.ts:36-46` with all needed fields.
The `TradeExecutedPayload` is already defined in `src/shared/events.ts:44-52`.

### Component Architecture

The placeholder component exists at `src/client/components/trade-log.tsx`. It already imports Card, CardContent, CardHeader, CardTitle, and ScrollArea.

**Entry format per UX-DR6:**
```
14:23:47 [VOL] Opened Long SOL-PERP $1,000.00
14:23:52 [PRO] Closed Long SOL-PERP +$14.20
```

**Determining action text:** The `TradeExecutedPayload` has a `pnl` field. Use it to distinguish:
- `pnl === 0` → opening trade → action = "Opened"
- `pnl !== 0` → closing trade → action = "Closed"

For closing trades, show PnL instead of size/price: `"Closed Long SOL-PERP +$14.20"` using `formatCurrency(pnl, true)` from `src/client/lib/format.ts`.
For opening trades, show size: `"Opened Long SOL-PERP $1,000.00"` using `formatCurrency(size * price)`.

**Mode tag map (constant, define once):**
```typescript
const MODE_TAGS: Record<ModeType, { label: string; colorClass: string }> = {
  volumeMax:    { label: "[VOL]", colorClass: "text-mode-volume" },
  profitHunter: { label: "[PRO]", colorClass: "text-mode-profit" },
  arbitrage:    { label: "[ARB]", colorClass: "text-mode-arb" },
};
```

These CSS color classes are already defined in `src/client/index.css` as custom properties:
- `--mode-volume: #8b5cf6` (purple)
- `--mode-profit: #22c55e` (green)
- `--mode-arb: #06b6d4` (cyan)

**PnL coloring** uses the same pattern as TopBar (`src/client/components/top-bar.tsx`):
- Positive → `text-profit` (#22c55e)
- Negative → `text-loss` (#ef4444)
- Zero → `text-text-muted`

### Auto-Scroll Implementation

**Critical:** The `ScrollArea` component's forwarded ref points to the Radix **Root** element, NOT the scrollable viewport. The actual scrollable element is a child with `[data-radix-scroll-area-viewport]`. You cannot call `scrollTo()` on the Root ref.

**Recommended approach:** Wrap `ScrollArea` in a div with a `useRef`, then query for the viewport:
```typescript
const wrapperRef = useRef<HTMLDivElement>(null);
const getViewport = () =>
  wrapperRef.current?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]");
```

Then attach scroll/mouse event listeners to the viewport element:
1. On `mouseenter` on the wrapper → set `isAutoScroll = false`
2. On `mouseleave` on the wrapper → set `isAutoScroll = true`, scroll to bottom
3. On `scroll` event on viewport → if `scrollTop + clientHeight >= scrollHeight - 20` then `isAutoScroll = true`, else `isAutoScroll = false`
4. In `useEffect` when `trades.length` changes and `isAutoScroll` is true → `viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' })`

The "New trades below ↓" indicator: render as an absolutely positioned element at the bottom of the wrapper div when `!isAutoScroll && newTradesSincePause > 0`.

### Timestamp Formatting

Add a `formatTime` helper to `src/client/lib/format.ts` alongside existing `formatCurrency`/`formatInteger`:
```typescript
const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit", minute: "2-digit", second: "2-digit",
  hour12: false,
});

export function formatTime(timestamp: number): string {
  return timeFormatter.format(new Date(timestamp));
}
```
Input is `Trade.timestamp` (Unix ms from WsMessage envelope).

### Existing Patterns to Follow

- **Slice selectors:** `useStore(s => s.trades)` — never subscribe to full store (pattern from Story 2-5)
- **Type guards on WS payloads:** Validate with `typeof` before use (pattern from STATS_UPDATED handler)
- **File naming:** `trade-log.tsx` / `trade-log.test.tsx` (kebab-case, co-located tests)
- **Test setup:** `// @vitest-environment jsdom` directive, `@testing-library/react`, mock store state
- **No wrapper abstractions:** Compose directly from shadcn/ui primitives (Card, ScrollArea)
- **Immutable store updates:** Spread + slice pattern for array management

### Project Structure Notes

- Component: `src/client/components/trade-log.tsx` (already exists as placeholder)
- Test: `src/client/components/trade-log.test.tsx` (new file)
- Store: `src/client/store/index.ts` (modify — add `trades` slice + handler)
- Store test: `src/client/store/index.test.ts` (modify — add trade handler tests)
- Format helper: `src/client/lib/format.ts` (modify — add `formatTime`)
- No new shared types needed — `Trade` and `TradeExecutedPayload` already exist
- No new CSS variables needed — mode colors and financial colors already defined

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 2, Story 2.6]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — UX-DR6 TradeLog]
- [Source: _bmad-output/planning-artifacts/architecture.md — WebSocket event catalog, component structure]
- [Source: src/shared/types.ts — Trade interface, ModeType]
- [Source: src/shared/events.ts — TRADE_EXECUTED, TradeExecutedPayload]
- [Source: src/client/store/index.ts:323-324 — TRADE_EXECUTED no-op to replace]
- [Source: src/client/components/trade-log.tsx — existing placeholder]
- [Source: src/client/lib/format.ts — formatCurrency(value, showSign)]
- [Source: src/client/components/top-bar.tsx — pnlColorClass pattern]
- [Source: _bmad-output/implementation-artifacts/2-5-zustand-store-and-real-time-dashboard-updates.md — previous story learnings]

### Previous Story Intelligence (2-5)

Key learnings from Story 2-5 that apply here:
- **typeof guards required:** Always validate WS payload fields before use to prevent NaN propagation (review finding from 2-5)
- **Filter to known mode keys:** Use `validModes` set when processing mode data from server
- **Aggregation on every mutation:** Any handler that modifies mode data must call `aggregateSummaryStats()` — but TRADE_EXECUTED only modifies `trades[]`, not mode stats, so no re-aggregation needed here
- **No double-conversion:** Trade amounts from WS are already in display units (server pre-converts via `fromSmallestUnit()`)
- **Test baseline:** 306 tests passing as of Story 2-5; expect zero regressions

### Git Intelligence

Recent commits show consistent patterns:
- Story implementations follow TDD with co-located test files
- Store changes are tested with dedicated store test cases
- Component tests use `@testing-library/react` with mocked store state
- All stories maintain zero regression baseline

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
- jsdom `scrollTo` not available — guarded with optional chaining (`viewport?.scrollTo`)
- Timestamp tests needed timezone-agnostic approach — used `formatTime()` to compute expected value

### Completion Notes List
- Task 1: Added `trades: Trade[]` to Zustand store, replaced TRADE_EXECUTED no-op with validated handler (typeof guards, VALID_MODES/VALID_SIDES checks), prepend+slice(500) pattern, hydration from loadInitialStatus. 5 new store tests.
- Task 2: Built TradeLog component with entry rendering — timestamp (HH:mm:ss 24hr), mode tags ([VOL]/[PRO]/[ARB] with color classes), action text (Opened/Closed based on pnl), PnL coloring (text-profit/text-loss/text-text-muted), empty state, all text in font-mono text-xs.
- Task 3: Implemented auto-scroll with pause-on-hover — useRef on wrapper div, querySelector for Radix viewport, isAutoScroll state with mouseenter/mouseleave/scroll handlers, "New trades below ↓" indicator with click-to-resume.
- Task 4: 7 component tests covering empty state, entry rendering, mode tag abbreviations/colors, PnL sign/color, font-mono class, open vs close detail rendering.
- Full regression: 326 tests passing (baseline was 306, +20 new tests)

### Review Findings
- [x] [Review][Patch] Merge duplicate formatCurrency import [src/client/components/trade-log.tsx:5-6] — fixed
- [x] [Review][Patch] Sync tradeIdCounter after loadInitialStatus to prevent React key collisions [src/client/store/index.ts:159] — fixed
- [x] [Review][Patch] Change trade order from prepend to append so newest renders at bottom matching auto-scroll direction [src/client/store/index.ts:354, src/client/components/trade-log.tsx:67] — fixed
- [x] [Review][Patch] NaN/Infinity bypass typeof number guards — fixed with Number.isFinite() in STATS_UPDATED and TRADE_EXECUTED [src/client/store/index.ts]
- [x] [Review][Patch] Empty string pair accepted by typeof string guard — fixed with length check [src/client/store/index.ts]

### Change Log
- 2026-04-05: Story 2-6 implementation complete — all 4 tasks done, 20 new tests, 0 regressions

### File List
- src/client/store/index.ts (modified — added trades slice, TRADE_EXECUTED handler, loadInitialStatus hydration)
- src/client/store/index.test.ts (modified — added trades reset in beforeEach, replaced no-op test with 5 functional tests)
- src/client/components/trade-log.tsx (modified — replaced placeholder with full TradeLog component)
- src/client/components/trade-log.test.tsx (modified — expanded from 2 to 7 tests)
- src/client/lib/format.ts (modified — added formatTime helper)
