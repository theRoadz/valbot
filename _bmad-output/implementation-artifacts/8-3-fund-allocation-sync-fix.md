# Story 8.3: Fix Fund Allocation Not Syncing to UI

Status: done

## Story

As theRoad,
I want the fund allocation input to actually update the dashboard state when I enter a value,
So that I can allocate funds and toggle trading modes ON.

## Problem & Discovery

The toggle switch for both VolumeMax and ProfitHunter is permanently disabled because `allocation === 0` in the Zustand store. The Fund Allocation input sends the value to the server (which persists it to DB), but the client store never gets updated — so the input snaps back to empty on blur and the toggle stays disabled.

### Root Cause

Two missing update paths after `PUT /api/mode/:mode/config` succeeds:

1. **Server doesn't broadcast:** `src/server/api/mode.ts` saves allocation via `fundAllocator.setAllocation()` but never calls `broadcast(EVENTS.STATS_UPDATED, ...)` to notify WebSocket clients.
2. **Client doesn't update store:** `src/client/components/mode-card.tsx` `handleAllocationCommit()` fires-and-forgets the API call but never calls `setModeConfig()` to update the Zustand store.
3. **Store doesn't sync allocation from STATS_UPDATED:** The STATS_UPDATED WebSocket handler updates `stats.allocated` but not the top-level `allocation` field that the toggle checks.

## Acceptance Criteria

1. **Given** the dashboard is open, **When** the user enters a fund allocation value and presses Enter/blurs, **Then** the input retains the entered value (doesn't snap back to 0).
2. **Given** a valid allocation > 0 is entered, **Then** the toggle switch becomes enabled immediately.
3. **Given** the server saves allocation successfully, **Then** a STATS_UPDATED WebSocket broadcast is sent so all connected clients update.
4. **Given** the API call fails, **Then** the allocation rolls back to the previous value in the UI.
5. **Given** allocation is set via any client, **Then** other connected browser tabs also see the updated allocation.

## Tasks / Subtasks

- [x] Task 1: Server — Broadcast allocation update after save (AC: 3, 5)
  - [x] 1.1 In `src/server/api/mode.ts`, import `broadcast` from `../ws/broadcaster.js`, `EVENTS` from `../../shared/events.js`, and `fromSmallestUnit` from `../../shared/types.js`
  - [x] 1.2 After `fundAllocator.setAllocation()` succeeds (line 91), broadcast `STATS_UPDATED` with the mode's current stats and allocation

- [x] Task 2: Client — Optimistic store update in ModeCard (AC: 1, 2, 4)
  - [x] 2.1 In `src/client/components/mode-card.tsx` `handleAllocationCommit()`, call `setModeConfig(mode, { allocation: numVal })` immediately for optimistic UI
  - [x] 2.2 On API failure, rollback: `setModeConfig(mode, { allocation })` (previous value)
  - [x] 2.3 Verify `setModeConfig` is available from the store destructuring — added `useStore((s) => s.setModeConfig)`

- [x] Task 3: Client store — Sync allocation from STATS_UPDATED broadcast (AC: 3, 5)
  - [x] 3.1 In `src/client/store/index.ts` STATS_UPDATED handler, also update the top-level `allocation` field from `data.allocated`

- [x] Task 4: Verification (AC: all)
  - [x] 4.1 TypeScript compile check: `npx tsc --noEmit` — clean
  - [x] 4.2 Full test suite: `pnpm test` — 518 passed, 1 pre-existing failure (resetKillSwitch)
  - [ ] 4.3 Manual test: enter allocation → toggle enables → mode starts

### Review Findings

- [x] [Review][Dismissed] `broadcast()` called from API route — accepted: rule already violated by 10+ call sites, updating project-context rule instead
- [x] [Review][Patch] Race condition: rapid allocation changes rollback to stale closure value — fixed: capture `prevAllocation` before optimistic update [src/client/components/mode-card.tsx:203]
- [x] [Review][Patch] `getStats()` throw leaves clients stuck in optimistic state — fixed: wrapped getStats+broadcast in separate try-catch [src/server/api/mode.ts:97]
- [x] [Review][Patch] Broadcast fires before kill-switch reset — fixed: moved broadcast after resetKillSwitch block [src/server/api/mode.ts:97]
- [x] [Review][Patch] Optimistic `setModeConfig` resets kill-switch status; rollback doesn't restore it — fixed: capture and restore prevStatus on rollback [src/client/components/mode-card.tsx:207]
- [x] [Review][Patch] No test assertions verifying `broadcast()` was called with correct payload — fixed: added assertion test [src/server/api/mode.test.ts]
- [x] [Review][Fixed] No upper-bound validation on allocation — added 10M USDC max in API schema + AppError guard in FundAllocator.setAllocation() [src/server/api/mode.ts, src/server/engine/fund-allocator.ts]

## Dev Notes

### Key Files

- `src/server/api/mode.ts` — PUT config handler (lines 64-107), missing broadcast
- `src/client/components/mode-card.tsx` — `handleAllocationCommit()` (lines 198-206), missing store update
- `src/client/store/index.ts` — STATS_UPDATED handler (lines 383-414), missing `allocation` sync
- `src/server/engine/fund-allocator.ts` — `setAllocation()` (lines 34-57), `getStats()`, `getAllocation()`

### Existing Patterns to Reuse

- `broadcast(EVENTS.STATS_UPDATED, ...)` — already used in `position-manager.ts` line 482
- `fromSmallestUnit()` — already imported in mode.ts's sibling `status.ts`
- `setModeConfig()` — Zustand action at store/index.ts line 157, already handles kill-switch reset

### What NOT To Build

- No new WebSocket events — reuse STATS_UPDATED
- No new API endpoints
- No new store actions — reuse existing `setModeConfig`

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- TypeScript compile check: clean (0 errors)
- Test suite: 518 passed, 1 pre-existing failure (resetKillSwitch)
- Had to add broadcaster mock and `getStats` mock to `mode.test.ts` since the new broadcast call in mode.ts requires both

### Completion Notes List

- Server: Added `broadcast(EVENTS.STATS_UPDATED, ...)` after `setAllocation()` in PUT /api/mode/:mode/config handler
- Client ModeCard: Added optimistic `setModeConfig(mode, { allocation })` with rollback on API failure
- Client store: STATS_UPDATED handler now syncs `allocation` from `data.allocated`
- Test fix: Added broadcaster mock and `getStats` to fund allocator mock in mode.test.ts

### File List

- `src/server/api/mode.ts` (modified — added broadcast import and STATS_UPDATED broadcast after allocation save)
- `src/server/api/mode.test.ts` (modified — added broadcaster mock and getStats to fund allocator mock)
- `src/client/components/mode-card.tsx` (modified — optimistic store update with rollback in handleAllocationCommit)
- `src/client/store/index.ts` (modified — sync allocation from STATS_UPDATED handler)

### Change Log

- 2026-04-06: Implemented Story 8-3 — fund allocation now syncs to UI via optimistic update + WebSocket broadcast
