# Story 8.10: Profit Hunter Activity Log

Status: done

## Story

As theRoad,
I want to see what Profit Hunter is doing each iteration in a real-time activity log on the dashboard,
So that I can verify it's actually working, understand its decisions, and debug issues without reading server logs.

## Problem

Profit Hunter runs every 5 seconds but the UI only shows trade opens/closes. All iteration-level decisions — scanning pairs, checking oracle availability, calculating deviations, skipping due to insufficient funds or stale oracle — are completely invisible from the dashboard. The mode card shows "Running" but there's no way to know what's happening inside.

## Acceptance Criteria

1. **Given** Profit Hunter is running, **When** the dashboard renders, **Then** an "Activity Log" panel appears below the Open Positions table and above Trade History.
2. **Given** Profit Hunter is stopped, **When** the dashboard renders, **Then** the Activity Log panel is hidden.
3. **Given** Profit Hunter completes an iteration, **When** the iteration finishes, **Then** a new entry appears in the Activity Log showing the iteration number, timestamp, and per-pair breakdown.
4. **Given** a pair is scanned, **When** the deviation is within threshold, **Then** the entry shows the deviation percentage and "No signal".
5. **Given** a pair triggers a signal, **When** a position is opened, **Then** the entry shows deviation %, direction (Long/Short), and position size in USD.
6. **Given** a position is held, **When** deviation has not reverted, **Then** the entry shows "Holding" with current deviation %.
7. **Given** a position reverts to MA, **When** it is closed, **Then** the entry shows "Closed (reverted)" with the deviation %.
8. **Given** the oracle is stale or warming up for a pair, **When** the iteration scans it, **Then** the entry shows the oracle status and "Skipped".
9. **Given** funds are insufficient, **When** a signal is detected, **Then** the entry shows "Skipped (no funds)".
10. **Given** a position open or close fails, **When** the error occurs, **Then** the entry shows "FAILED" in red.
11. **Given** the Activity Log has entries, **When** it auto-scrolls, **Then** new entries appear at the bottom; hovering pauses auto-scroll with a "New activity below" indicator.
12. **Given** Profit Hunter is stopped, **When** MODE_STOPPED fires, **Then** the activity log state is cleared.
13. **Given** Profit Hunter has been running for a long time, **When** entries exceed 100, **Then** older entries are evicted (memory cap).
14. **Given** all changes are made, **When** running `pnpm test`, **Then** all existing and new tests pass.

## Tasks / Subtasks

- [x] Task 1: Add MODE_ACTIVITY WebSocket event type (AC: 3)
  - [x] 1.1 Add `MODE_ACTIVITY: "mode.activity"` to EVENTS in `src/shared/events.ts`
  - [x] 1.2 Add `ActivityPairEntry` interface with pair, deviationPct, oracleStatus, outcome, size, side fields
  - [x] 1.3 Add `ModeActivityPayload` interface with mode, iteration, pairs fields
  - [x] 1.4 Add `"mode.activity": ModeActivityPayload` to EventPayloadMap

- [x] Task 2: Instrument Profit Hunter executeIteration() (AC: 3-10)
  - [x] 2.1 Add `private iterationCount = 0` to ProfitHunterStrategy class
  - [x] 2.2 Collect `ActivityPairEntry[]` alongside each decision in Phase 1 (position close checks) and Phase 2 (new entry scan)
  - [x] 2.3 Track `reportedPairs` set to avoid duplicate entries for pairs in both phases
  - [x] 2.4 Broadcast `EVENTS.MODE_ACTIVITY` once at end of iteration with collected entries
  - [x] 2.5 Verify no behavior changes — same oracle checks, deviation logic, open/close calls

- [x] Task 3: Add activity log state to Zustand store (AC: 11, 12, 13)
  - [x] 3.1 Add `activityLog: (ModeActivityPayload & { timestamp })[]` to ValBotStore interface and initialize to `[]`
  - [x] 3.2 Add MODE_ACTIVITY handler in `handleWsMessage` — append and cap at 100 entries
  - [x] 3.3 Clear activityLog in MODE_STOPPED handler when mode is profitHunter
  - [x] 3.4 Import ModeActivityPayload from @shared/events

- [x] Task 4: Create ActivityLog component (AC: 1, 3-11)
  - [x] 4.1 Create `src/client/components/activity-log.tsx` with Card/ScrollArea structure (pattern from trade-log.tsx)
  - [x] 4.2 Render iteration headers with timestamp and iteration number
  - [x] 4.3 Render per-pair entries with deviation %, oracle status, and outcome text
  - [x] 4.4 Color-code outcomes: green (opened/closed), red (failed), amber (skipped), muted (no-signal/held)
  - [x] 4.5 Implement auto-scroll with pause-on-hover and "New activity below" indicator
  - [x] 4.6 Set max-h-[200px] to prevent layout overflow

- [x] Task 5: Integrate into dashboard layout (AC: 1, 2)
  - [x] 5.1 Import ActivityLog in `src/client/App.tsx`
  - [x] 5.2 Add store selector for profitHunter running status
  - [x] 5.3 Conditionally render between PositionsTable and TradeHistoryTable
  - [x] 5.4 Update grid-rows to accommodate the conditional row

- [x] Task 6: Tests (AC: 14)
  - [x] 6.1 Add "iteration activity broadcast" describe block to `profit-hunter.test.ts`
  - [x] 6.2 Test: broadcasts MODE_ACTIVITY with correct structure
  - [x] 6.3 Test: reports correct outcomes (no-signal, opened-long, skipped-stale, closed-reverted, skipped-no-funds)
  - [x] 6.4 Test: iteration counter increments
  - [x] 6.5 Test: existing tests still pass (717/717)
  - [ ] 6.6 Create `activity-log.test.tsx` with rendering tests (deferred — no jsdom/React test setup in project)

## Dev Agent Record

### Implementation Summary

Added real-time activity log that shows what Profit Hunter does each iteration:
- New `mode.activity` WebSocket event with per-pair breakdown (deviation %, oracle status, outcome)
- Strategy collects `ActivityPairEntry[]` during each iteration, broadcasts once at end
- Zustand store holds last 100 entries, clears on mode stop
- `<ActivityLog />` component appears below Open Positions when PH is running, hidden when off
- Auto-scroll with pause-on-hover, color-coded outcomes

### Tests Created

6 new tests in `profit-hunter.test.ts` covering:
- MODE_ACTIVITY broadcast structure validation
- Correct outcome reporting: `no-signal`, `opened-long`, `skipped-stale`, `closed-reverted`, `skipped-no-funds`
- Iteration counter incrementation

### Decisions

- Stored WsMessage `timestamp` alongside payload data so the UI can render actual server timestamps
- Used `reportedPairs` set to prevent duplicate activity entries when a pair has an open position that gets checked in Phase 1 and also appears in Phase 2's pair scan
- Deferred `activity-log.test.tsx` — project has no jsdom/React testing setup configured

### File List

| File | Change |
|------|--------|
| `src/shared/events.ts` | Added MODE_ACTIVITY event, ActivityPairEntry, ModeActivityPayload types |
| `src/shared/events.test.ts` | Updated EVENTS length assertion from 10 to 11 |
| `src/server/engine/strategies/profit-hunter.ts` | Added iterationCount, activity collection in executeIteration(), MODE_ACTIVITY broadcast |
| `src/server/engine/strategies/profit-hunter.test.ts` | Added 6 tests for activity broadcast |
| `src/client/store/index.ts` | Added activityLog state, MODE_ACTIVITY handler, clear on MODE_STOPPED |
| `src/client/components/activity-log.tsx` | New component — scrollable activity log with auto-scroll |
| `src/client/App.tsx` | Conditionally render ActivityLog when profitHunter is running |

### Review Findings

- [x] [Review][Patch] Kill-switch stop did not clear activityLog — moved clear above kill-switch guard [store/index.ts:410]
- [x] [Review][Patch] ActivityLog hidden during error status — changed selector to include "error" [App.tsx:23]
- [x] [Review][Patch] Scroll viewport listener not re-attached if Radix viewport renders late [activity-log.tsx:122]
- [x] [Review][Patch] message.timestamp not validated — added typeof check to MODE_ACTIVITY handler [store/index.ts:585]
- [x] [Review][Patch] Empty activity broadcast when zero pairs configured — added guard [profit-hunter.ts:232]
- [x] [Review][Patch] No client-side tests — added activity-log.test.tsx (10 tests) + 8 store handler tests
- [x] [Review][Patch] Touch devices: mouseenter/mouseleave freeze — replaced with pointerEnter/pointerLeave with pointerType guard
