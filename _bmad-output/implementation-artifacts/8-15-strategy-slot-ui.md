# Story 8.15: Strategy Slot UI with Selector Dropdown

Status: done

## Story

As theRoad,
I want the dashboard to show 3 fixed strategy card slots with a dropdown to pick which strategy each slot runs,
So that the UI stays clean and usable as the number of available strategies grows beyond 3.

## Problem

Currently the dashboard renders one mode card per registered strategy in a single auto-sizing row. With 6 strategies (VolumeMax, ProfitHunter, Arbitrage + Grid, Momentum, Funding Arb), that would be 6 columns on a 1280px screen = ~200px per card — too narrow for the stats, controls, and config inputs each card contains. Since nobody runs all 6 simultaneously, we need a slot-based approach.

## Acceptance Criteria

1. **Given** the dashboard loads, **When** rendering, **Then** exactly 3 strategy card slots appear in a row.
2. **Given** a card slot, **When** clicking the strategy dropdown, **Then** all registered strategies are listed with already-selected ones disabled/greyed out.
3. **Given** a stopped strategy in a slot, **When** selecting a different strategy, **Then** the card switches to the new strategy immediately.
4. **Given** a running strategy in a slot, **When** selecting a different strategy, **Then** the card switches optimistically and the running strategy auto-stops in the background; if the stop fails, the swap reverts and shows an error toast.
5. **Given** slot assignments, **When** the page reloads, **Then** assignments are restored from localStorage.
6. **Given** 3 slots, **When** all show different strategies, **Then** no strategy appears in more than one slot.
7. **Given** the dropdown, **When** listing strategies, **Then** each option shows a color dot matching its modeColor and the strategy name.
8. **Given** a running strategy in a slot, **When** the dropdown is open, **Then** a visual indicator warns that switching will stop the current strategy.
9. **Given** fewer than 3 registered strategies, **When** rendering, **Then** unassigned slots show an empty placeholder card with a "Select Strategy" dropdown prompt.
10. **Given** all changes, **When** running `pnpm test`, **Then** all tests pass.

## Tasks / Subtasks

- [x] Task 1: Add strategy selector dropdown to ModeCard (AC: 2, 6, 7)
  - [x] 1.1 Add dropdown component at top of card (above name/status row)
  - [x] 1.2 List all strategies from store with color dot + name
  - [x] 1.3 Disable strategies already assigned to other slots
  - [x] 1.4 `onSelect` callback prop to notify parent of selection change

- [x] Task 2: Refactor App.tsx to fixed 3-slot grid (AC: 1, 5, 9)
  - [x] 2.1 Replace dynamic `strategies.map()` grid with fixed 3-column grid (`grid-cols-3`)
  - [x] 2.2 Add `slotAssignments` state: `[ModeType | null, ModeType | null, ModeType | null]`
  - [x] 2.3 Initialize from localStorage, fallback to first 3 registered strategies (pad with `null` if fewer than 3)
  - [x] 2.4 Persist to localStorage on every change
  - [x] 2.5 Pass selected strategy info + `onSelect` handler to each ModeCard; render empty placeholder for `null` slots
  - [x] 2.6 Compute `assignedModes` set to pass to each card for disabling duplicates

- [x] Task 3: Implement auto-stop on swap (AC: 3, 4, 8)
  - [x] 3.1 In `handleSlotChange`: check if current slot's strategy status is "running"
  - [x] 3.2 If stopped: update slot assignment immediately, done
  - [x] 3.3 If running: switch card optimistically, then call `POST /api/mode/:mode/stop` in background
  - [x] 3.4 On stop failure: revert slot assignment, show error toast
  - [x] 3.5 Add warning indicator to dropdown when current slot has a running strategy (e.g., amber dot + "Will stop current strategy" text)

- [x] Task 4: Tests (AC: 10)
  - [x] 4.1 Existing mode-card tests still pass
  - [x] 4.2 Test: 3 slots render on dashboard
  - [x] 4.3 Test: dropdown shows all strategies, disables assigned ones
  - [x] 4.4 Test: slot assignment persists in localStorage
  - [x] 4.5 Test: stopped strategy swap switches immediately without API call
  - [x] 4.6 Test: running strategy swap triggers stop API call and reverts on failure
  - [x] 4.7 Test: warning indicator shown when slot has running strategy

### Review Findings

- [x] [Review][Patch] Stale closure in `handleSlotChange` — moved logic inside `setSlots` functional updater; revert now checks slot still holds expected value
- [x] [Review][Patch] No `Array.isArray()` guard after `JSON.parse` on localStorage — extracted `parseSavedSlots()` with `Array.isArray` guard
- [x] [Review][Patch] No dedup guard in `handleSlotChange` — added `prev.some()` check inside updater to reject duplicate assignments
- [x] [Review][Patch] `handleToggle` removed from `useCallback` — restored `useCallback` wrapper, moved above early return with null guard
- [x] [Review][Patch] `grid-cols-3` hardcoded separately from `SLOT_COUNT` constant — switched to inline `gridTemplateColumns: repeat(${SLOT_COUNT}, ...)`
- [x] [Review][Patch] `localStorage.setItem` in persist effect has no try-catch — added try-catch to swallow quota errors
- [x] [Review][Patch] Strategy validation `useEffect([strategies])` re-runs on every strategies array reference change — added `slotsInitialized` ref guard to run once
- [x] [Review][Patch] Custom dropdown lacks arrow-key navigation — added full WCAG listbox keyboard nav (Arrow Up/Down, Home, End, Enter/Space, Escape) with roving tabindex
- [x] [Review][Patch] `key={idx}` on ModeCard instead of stable identity — changed to `key={slotMode ?? \`empty-${idx}\`}` to force remount on strategy swap

## Dev Notes

### Key Files

- `src/client/App.tsx` — Fixed 3-slot grid, slot assignment state, localStorage persistence
- `src/client/components/mode-card.tsx` — Add strategy selector dropdown at top of card

### What Stays the Same

- ModeCard internals (stats, controls, allocation, pairs) — already driven by `mode` prop
- All API endpoints — no server changes
- Store structure — no changes
- WebSocket events — no changes
- Strategy registration — no changes

### Design Details

**Slot Assignment State:**
```typescript
const [slots, setSlots] = useState<(ModeType | null)[]>(() => {
  const saved = localStorage.getItem("strategySlots");
  if (saved) {
    const parsed = JSON.parse(saved);
    // Pad to 3 slots if needed
    while (parsed.length < 3) parsed.push(null);
    return parsed.slice(0, 3);
  }
  const initial = strategies.slice(0, 3).map(s => s.modeType);
  while (initial.length < 3) initial.push(null);
  return initial;
});
```

**Dropdown Component:**
- Use shadcn Select if available, or native `<select>` styled with Tailwind
- Each option: `[color dot] Strategy Name`
- Disabled items show `(in use)` suffix
- Running strategy shows warning: "Will stop current strategy"

**Empty Slot Placeholder:**
- Render a Card with muted border and "Select Strategy" dropdown only
- No stats, controls, or allocation bar

### Activity Log Consideration

The `<ActivityLog />` currently renders only when profitHunter is running. With the slot system, this should check if ANY mode with an activity log is running in any slot (future-proofing for when other strategies get activity logs). This is out of scope for this story — tracked for a follow-up.

### Implementation Order

This story (8-15) should be implemented **before** Stories 8-11 through 8-14 so the UI is ready for additional strategies.

## Dev Agent Record

### Implementation Plan

- Added `StrategySelector` component inside mode-card.tsx — custom dropdown with color dots, disabled items with "(in use)" suffix, and running-strategy warning banner
- Refactored `ModeCard` to accept `mode: ModeType | null` and new props (`strategies`, `assignedModes`, `onSelectStrategy`) for slot integration
- Moved all React hooks before the empty-slot early return to comply with React's rules of hooks
- Refactored `App.tsx` to render a fixed 3-column grid with `slots` state (`(ModeType | null)[]`), localStorage persistence, and `handleSlotChange` with optimistic swap + background stop + revert-on-failure
- Updated existing `app.test.tsx` tests and added 7 new tests covering slot rendering, localStorage persistence, dropdown behavior, stopped/running swap, revert on failure, and warning indicator

### Debug Log

- Fixed "Rendered more hooks than during the previous render" error by hoisting `useCallback`, `useEffect`, and `useRef` calls above the empty-slot early return
- Fixed test failures from duplicate text matches by switching `getByText` to `getAllByText` where strategy names appear in both card headers and dropdown options
- Fixed api mock missing `fetchTrades` export

### Completion Notes

- All 4 tasks completed, all 10 acceptance criteria satisfied
- 743 tests pass (7 new tests added, 0 regressions)
- No server-side changes required — purely frontend
- StrategySelector uses custom dropdown (not Radix Select) to avoid portal/testing issues and maintain consistent styling with existing pair dropdown pattern

## File List

- `src/client/App.tsx` — Modified: fixed 3-slot grid, slot assignment state, localStorage persistence, handleSlotChange with auto-stop
- `src/client/components/mode-card.tsx` — Modified: added StrategySelector component, updated ModeCardProps to support null mode and slot-related props, empty slot placeholder
- `src/client/app.test.tsx` — Modified: updated existing tests for slot system, added 7 new tests for slot functionality

## Change Log

- 2026-04-08: Implemented Strategy Slot UI with selector dropdown (Story 8-15) — fixed 3-slot grid, strategy selector with color dots and in-use disabling, auto-stop on swap with revert, localStorage persistence, empty slot placeholders
