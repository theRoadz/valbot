# Story 8.8: Fix Dashboard Bottom Section Clipping

Status: done

## Story

As theRoad,
I want the Open Positions, Trade History, and Live Trade Log sections to display fully on the dashboard,
So that I can monitor trading activity without content being clipped at the viewport bottom.

## Problem & Discovery

The bottom section of the dashboard — Open Positions, Trade History, and Live Trade Log — is barely visible. Only section headers show; table content and log entries are cut off at the viewport bottom. The ModeCards row consumes most of the viewport height, leaving minimal space for the `1fr` bottom row.

## Root Cause

Three compounding CSS layout issues in `App.tsx` and child components:

1. **Root div** uses `h-screen overflow-hidden` — locks everything to viewport with no scroll escape. When the auto-sized ModeCards row consumes ~450px, the remaining `1fr` bottom row gets squeezed.
2. **Left column** uses `flex flex-col` — does not distribute height between PositionsTable and TradeHistoryTable. Both cards collapse to header-only height under `overflow-hidden` when space is tight.
3. **Card components** lack `min-h-0` — as CSS grid/flex children they can't shrink below content size, preventing internal scroll from activating.

## Acceptance Criteria

1. **Given** the dashboard loads, **When** viewing the bottom section, **Then** Open Positions shows the table header row plus content or empty-state.
2. **Given** the dashboard loads, **When** viewing the bottom section, **Then** Trade History shows the table header row plus content or empty-state with pagination controls.
3. **Given** the dashboard loads, **When** viewing the bottom section, **Then** Live Trade Log shows log entries with a scrollable area.
4. **Given** a small viewport height, **When** content exceeds the screen, **Then** the page scrolls and the bottom section maintains at least 400px height.
5. **Given** a large viewport, **When** viewing the dashboard, **Then** the bottom section expands to fill all available space.

## Tasks / Subtasks

- [x] Task 1: Update root and main layout in App.tsx (AC: 4, 5)
  - [x] 1.1 Change root div from `h-screen overflow-hidden` to `min-h-screen overflow-auto`
  - [x] 1.2 Change bottom section grid from `min-h-0` to `min-h-[400px]`
  - [x] 1.3 Change left column from `flex flex-col gap-4 min-h-0 overflow-auto` to `grid grid-rows-2 gap-4 min-h-0`

- [x] Task 2: Update child Card components for grid compatibility (AC: 1, 2, 3)
  - [x] 2.1 Add `min-h-0` to PositionsTable Card className
  - [x] 2.2 Add `min-h-0` to TradeHistoryTable Card className
  - [x] 2.3 Add `min-h-0 h-full` to TradeLog Card className

- [x] Task 3: Verification (AC: 1–5)
  - [x] 3.1 `pnpm build` — client builds clean (server TS errors pre-existing, unrelated)
  - [x] 3.2 `pnpm test` — 710 tests passed across 35 files
  - [x] 3.3 Manual: Open Positions table visible with header + rows/empty-state
  - [x] 3.4 Manual: Trade History table visible with header + rows/empty-state + pagination
  - [x] 3.5 Manual: Live Trade Log shows entries with scrollable area
  - [x] 3.6 Manual: Resize to small viewport — page scrolls, bottom section ≥ 400px
  - [x] 3.7 Manual: Large viewport — bottom section fills available space

## Dev Notes

### Key Files

- `src/client/App.tsx` — Root layout, grid structure (lines 35, 54, 55)
- `src/client/components/positions-table.tsx` — Card wrapper (line 46)
- `src/client/components/trade-history-table.tsx` — Card wrapper (line 82)
- `src/client/components/trade-log.tsx` — Card wrapper (line 108)

### Why This Fix Works

- `min-h-screen` + `overflow-auto` replaces `h-screen` + `overflow-hidden` — page can scroll when mode cards push bottom off-screen
- `min-h-[400px]` on bottom grid guarantees tables always get meaningful space
- `grid grid-rows-2` on left column evenly splits height between both cards (flex-col was letting them collapse)
- `min-h-0` on each Card allows CSS grid children to shrink below content size, enabling internal scroll

### File List

- `src/client/App.tsx`
- `src/client/components/positions-table.tsx`
- `src/client/components/trade-history-table.tsx`
- `src/client/components/trade-log.tsx`
- `_bmad-output/implementation-artifacts/8-8-fix-dashboard-bottom-section-clipping.md`

### Follow-up Fix (2026-04-08)

**Problem:** When Open Positions has no rows, the `grid-rows-2` layout still allocates 50% of the bottom section height to the empty positions table, creating a large visual gap before Trade History.

**Changes:**
- `App.tsx:55` — Changed `grid-rows-2` to `grid-rows-[auto_1fr]` so Open Positions shrinks to content when empty and Trade History fills remaining space
- `positions-table.tsx:67` — Changed empty state cell from `h-32` (128px) to `h-16` (64px) for a more compact empty state
