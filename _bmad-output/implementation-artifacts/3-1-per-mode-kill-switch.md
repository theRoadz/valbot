# Story 3.1: Per-Mode Kill Switch

Status: done

## Story

As theRoad,
I want the system to automatically close all positions for a specific mode when that mode's allocated collateral drops by 10%,
so that my losses are capped and other modes continue running unaffected.

## Acceptance Criteria

1. **Given** a trading mode is running with allocated funds, **when** the mode's remaining collateral drops to 90% or less of its original allocation, **then** the kill switch triggers for that mode only.
2. All open positions for that mode are closed immediately.
3. The mode stops trading and its status transitions to "kill-switch".
4. Other running modes continue operating unaffected (NFR6).
5. An `alert.triggered` WebSocket event is broadcast with severity "critical".
6. The alert payload includes: which positions were closed, at what prices, and the total loss amount (FR32).
7. The ModeCard badge changes to red "Kill Switch" immediately.
8. Kill switch details (positions closed, prices, loss) are visible on the ModeCard.
9. The trade log shows the closing trades from the kill switch event.
10. The fund allocator marks the mode as killed, preventing re-enable until user re-allocates.

## What Already Exists

The kill switch was partially built during Stories 2-2 through 2-5. Before implementing, understand what's done vs. what's missing:

**Already implemented (DO NOT recreate):**
- `FundAllocator.checkKillSwitch(mode)` — detects 10% loss threshold (`fund-allocator.ts:95-99`)
- `PositionManager.closeAllForMode(mode)` — mass-closes all positions for a mode (`position-manager.ts:365-401`)
- Kill-switch detection after position close in `PositionManager.closePosition()` (`position-manager.ts:341-356`)
- `_killSwitchActive` Set to prevent recursive closure (`position-manager.ts:48`)
- `_modeStatus` Map tracking "active"/"kill-switch" per mode (`position-manager.ts:49`)
- `ALERT_TRIGGERED` broadcast with severity "critical", code "KILL_SWITCH_TRIGGERED" (`position-manager.ts:347-354`)
- `ModeRunner.start()` rejects if mode is in kill-switch state (`mode-runner.ts:48-50`)
- Zustand store handles `KILL_SWITCH_TRIGGERED` alert → sets mode status + killSwitchDetail (`store/index.ts:248-276`)
- Store prevents MODE_STARTED on kill-switched mode (`store/index.ts:284`)
- ModeCard renders "Kill Switch" badge with red pulse animation (`mode-card.tsx:28`)
- ModeCard shows kill switch detail (positions closed, loss amount) (`mode-card.tsx:330-335`)
- Toggle disabled when mode is in kill-switch state (`mode-card.tsx:124`)
- AlertBanner renders critical alerts (`alert-banner.tsx`)
- Tests: fund-allocator (5 kill-switch tests), position-manager (6 kill-switch tests), store (1 kill-switch test), mode-card (3 kill-switch tests), mode-runner (1 kill-switch test)

**Gaps to fill (the actual work for this story):**

### Gap 1: Mode runner doesn't stop on kill-switch trigger
When `PositionManager.closePosition()` triggers the kill switch, it closes all positions and broadcasts the alert, but the `ModeRunner._runLoop()` keeps running — `_running` is still `true`. The next iteration will call `executeIteration()` which may attempt to open new positions on a kill-switched mode.

**Fix:** After `closeAllForMode` is called from within the kill-switch path of `closePosition()`, the mode runner must be stopped. Two approaches:
- **Option A (recommended):** Add a kill-switch callback. Have the engine register a `onKillSwitch(mode)` callback on the PositionManager that stops the mode runner and emits `MODE_STOPPED`. This keeps the boundary clean — PositionManager doesn't know about ModeRunner directly.
- **Option B:** Have ModeRunner check `positionManager.getModeStatus()` at the start of each loop iteration and self-terminate if kill-switched.

### Gap 1a: CRITICAL — Race condition: new positions opened during kill-switch
**`openPosition()` has NO check for `_killSwitchActive`**. When kill-switch triggers and `closeAllForMode()` runs, `ModeRunner._runLoop()` may already be mid-await inside `executeIteration()` on an `openPosition()` call (e.g., VolumeMaxStrategy line 68 or 84). When that await resolves, the position is opened AFTER kill-switch closed everything. The new position becomes orphaned — no stop-loss enforcement, no mode managing it.

**Fix:** Add a `_killSwitchActive` guard at the top of `PositionManager.openPosition()`:
```typescript
if (this._killSwitchActive.has(mode)) {
  throw new AppError({ severity: "warning", code: "MODE_KILL_SWITCHED",
    message: `Cannot open position — kill switch active on ${mode}`,
    resolution: "Re-allocate funds to restart the mode." });
}
```
This ensures no new positions can be opened for a mode while its kill-switch is executing.

### Gap 2: Engine `getModeStatus()` ignores kill-switch state (low priority)
`engine/index.ts:90-96` returns only "running" or "stopped" based on whether a runner exists. It never consults `positionManager.getModeStatus()`. The `/api/status` endpoint already works around this (`status.ts` checks `positionManager.getModeStatus()` and returns "kill-switch" correctly), so the API response is correct. This is an internal consistency fix.

**Fix:** Update `getModeStatus()` in `engine/index.ts` to check `positionManager.getModeStatus(mode) === "kill-switch"` first, returning "kill-switch" before checking runner state.

### Gap 3: No kill-switch reset mechanism
Once a mode is kill-switched, `_modeStatus` in PositionManager has no way to clear it. The AC says "preventing re-enable until user re-allocates." This implies re-allocation should reset the kill-switch state so the user can restart.

**Fix:** Add `resetModeStatus(mode)` to PositionManager. Wire it to `setAllocation()` in FundAllocator via callback or call from the API config endpoint. When the user sets a new allocation on a kill-switched mode, the kill-switch state clears. The mode can then be re-started via toggle.

### Gap 4: No `MODE_STOPPED` emitted after kill-switch + ordering hazard
When kill-switch triggers, the alert is broadcast but `MODE_STOPPED` is not emitted. The Zustand store relies on `MODE_STOPPED` to transition the mode status on the client. Currently the client handles this through the `KILL_SWITCH_TRIGGERED` alert handler, but the mode runner itself doesn't know it stopped, creating state inconsistency.

**Fix:** The kill-switch callback (Gap 1) should call `forceStop()` which emits `MODE_STOPPED` with finalStats. Do NOT call `stop()` — it calls `closeAllForMode()` again.

**CRITICAL ordering hazard:** The WebSocket event order will be: ALERT_TRIGGERED (sets status "kill-switch") → MODE_STOPPED (sets status "stopped"). The MODE_STOPPED handler in the Zustand store (`store/index.ts:293-314`) unconditionally sets `status: "stopped"`, **overwriting the "kill-switch" status**. The user sees "Stopped" instead of "Kill Switch", loses visibility into why the mode stopped, and the toggle appears enabled (wrong).

**Fix for ordering:** Add a guard in the MODE_STOPPED handler to preserve kill-switch status:
```typescript
// In MODE_STOPPED handler, before setting status:
if (state.modes[mode].status === "kill-switch") return state;
```

### Gap 5: Client-side kill-switch reset on re-allocation
The Zustand store's `setModeConfig` action (used when allocation changes via API) doesn't clear `killSwitchDetail` or reset status from "kill-switch". After the server-side reset (Gap 3), the client needs to reflect the cleared state.

**Fix:** When `MODE_CONFIG_UPDATED` or status API response shows mode is no longer kill-switched, clear `killSwitchDetail` and reset status to "stopped". Or: in the `setModeConfig` store action, if the mode was "kill-switch" and allocation changes, reset to "stopped" with `killSwitchDetail: null`.

### Gap 6: Fund allocator stats not reset after kill-switch
After kill-switch triggers and the user re-allocates, the `trades`, `volume`, and `pnl` counters in FundAllocator carry over from the kill-switched session. `getStats()` returns stale cumulative values. The user sees old loss amounts and trade counts after restarting a previously kill-switched mode.

**Fix:** Add `resetModeStats(mode)` to FundAllocator that zeros out `trades`, `volume`, and `pnl` for the mode. Call it from the kill-switch reset path (alongside `resetModeStatus()`).

### Gap 7: Alert lacks per-position details (AC #6)
FR32 requires the alert to include "which positions were closed, at what prices, and the total loss amount." Currently the alert `details` field is a string: `"Closed 3 positions. Loss: $150.00."` — it lacks per-position breakdown (pair, side, entry price, exit price). The `CloseSummary` returned by `closeAllForMode()` already contains a `positions: Position[]` array, but this structured data is not included in the alert payload.

**Fix:** Include per-position summary in the alert `details` field. Format as a readable string (the `AlertTriggeredPayload.details` field is `string | null`):
```typescript
details: `Closed ${summary.count} positions. Loss: $${...}.\n` +
  summary.positions.map(p => `  ${p.pair} ${p.side} @ ${p.entryPrice}`).join('\n')
```

### Gap 8: Integration test coverage
No end-to-end test verifies the full kill-switch flow: mode running → position loss exceeds threshold → kill-switch triggers → mode stops → alert broadcast → positions closed → mode cannot restart → re-allocate → mode can restart. Additionally, no multi-mode test verifies AC #4 (other modes continue unaffected during kill-switch).

## Tasks / Subtasks

- [x] Task 1: Wire kill-switch to mode runner stop + prevent race conditions (AC: #2, #3, #4) — Gaps 1, 1a, 4
  - [x] 1.1 Add `onKillSwitch?: (mode: ModeType) => void` optional callback to PositionManager constructor (keep optional so existing tests don't break)
  - [x] 1.2 Add `_killSwitchActive` guard at the TOP of `openPosition()` — throw AppError if `this._killSwitchActive.has(mode)`. This prevents new positions from being opened during kill-switch execution. **CRITICAL for safety — real money at risk.**
  - [x] 1.3 In `closePosition()` kill-switch path (line 344-356), after `closeAllForMode()` and `broadcast()`, call `this.onKillSwitch?.(pos.mode)`
  - [x] 1.4 Add `forceStop()` method to ModeRunner: sets `_running = false`, clears `_loopTimer`, emits MODE_STOPPED with finalStats, but does NOT call `closeAllForMode()` (positions already closed by kill-switch)
  - [x] 1.5 In `engine/index.ts initEngine()`, pass `onKillSwitch` callback to PositionManager that calls `runner.forceStop()` and removes runner from `modeRunners` Map
  - [x] 1.6 Update mode-runner tests: verify `forceStop()` sets running to false and emits MODE_STOPPED without closing positions
  - [x] 1.7 Update position-manager tests: verify `onKillSwitch` callback is invoked when kill-switch triggers
  - [x] 1.8 Add position-manager test: `openPosition()` throws when `_killSwitchActive` contains the mode

- [x] Task 2: Fix engine `getModeStatus()` and alert details (AC: #3, #6) — Gaps 2, 7
  - [x] 2.1 Update `getModeStatus()` in `engine/index.ts` to check `positionManager.getModeStatus(mode) === "kill-switch"` and return "kill-switch"
  - [x] 2.2 Update engine tests: verify getModeStatus returns "kill-switch" when position-manager reports kill-switch
  - [x] 2.3 Update ALERT_TRIGGERED broadcast in `position-manager.ts:347-354` to include per-position details in `details` field: pair, side, entry price for each closed position (FR32). Use the `summary.positions` array already returned by `closeAllForMode()`
  - [x] 2.4 Add position-manager test: alert details string includes per-position breakdown

- [x] Task 3: Add kill-switch reset mechanism with stats reset (AC: #10) — Gaps 3, 6
  - [x] 3.1 Add `resetModeStatus(mode: ModeType)` to PositionManager — deletes entry from `_modeStatus` map and clears `_killSwitchActive` for that mode
  - [x] 3.2 Add `resetModeStats(mode: ModeType)` to FundAllocator — zeros `trades`, `volume`, and `pnl` for the mode (allocation and remaining are already set by `setAllocation`)
  - [x] 3.3 In `engine/index.ts`, add `resetKillSwitch(mode)` that calls both `positionManager.resetModeStatus(mode)` and `fundAllocator.resetModeStats(mode)`
  - [x] 3.4 Modify existing PUT `/api/mode/:mode/config` handler to call `resetKillSwitch(mode)` when allocation changes on a kill-switched mode
  - [x] 3.5 Add tests: resetting mode status after kill-switch allows mode to start again
  - [x] 3.6 Add tests: mode cannot start while still in kill-switch state (existing test, verify still passes)
  - [x] 3.7 Add tests: `resetModeStats` zeros pnl/trades/volume but preserves new allocation

- [x] Task 4: Client-side kill-switch handling fixes (AC: #3, #7, #10) — Gaps 4 (ordering), 5
  - [x] 4.1 **CRITICAL:** Add guard in MODE_STOPPED handler (`store/index.ts:293-314`): if `state.modes[mode].status === "kill-switch"`, return state unchanged. This prevents MODE_STOPPED (emitted by forceStop) from overwriting the "kill-switch" status set by ALERT_TRIGGERED.
  - [x] 4.2 In Zustand store, when `setModeConfig` action receives allocation change for a kill-switched mode, reset status to "stopped" and set `killSwitchDetail: null`
  - [x] 4.3 Or: when `loadInitialStatus` / status API response shows mode status as "stopped" (not "kill-switch"), clear `killSwitchDetail`
  - [x] 4.4 Add store test: MODE_STOPPED does NOT overwrite kill-switch status
  - [x] 4.5 Add store test: kill-switch state clears when allocation is updated
  - [x] 4.6 Add mode-card test: after kill-switch reset, badge shows "Stopped" and toggle is enabled

- [x] Task 5: Integration tests — full kill-switch lifecycle (AC: all) — Gap 8
  - [x] 5.1 Write integration test in `engine/index.test.ts`: startMode → open positions → simulate losses that breach threshold → verify: kill-switch triggers, runner stops (forceStop called), alert broadcast, positions closed, mode status is kill-switch, restart rejected
  - [x] 5.2 Write integration test: after kill-switch, setAllocation → resetKillSwitch → startMode succeeds, stats are zeroed
  - [x] 5.3 Write store integration test: full WS event sequence (POSITION_CLOSED → ALERT_TRIGGERED with KILL_SWITCH_TRIGGERED → MODE_STOPPED) → verify store state: status is "kill-switch" (not "stopped"), killSwitchDetail populated
  - [x] 5.4 Write multi-mode integration test (AC #4 / NFR6): start two modes → kill-switch triggers on mode A → verify mode B continues running unaffected, mode B's positions and stats unchanged

## Dev Notes

### Architecture: Kill-Switch Data Flow

```
Trade loss exceeds threshold
  → PositionManager.closePosition() detects via FundAllocator.checkKillSwitch()
  → PositionManager.closeAllForMode() closes remaining positions
  → Each closePosition() emits TRADE_EXECUTED + POSITION_CLOSED events (trade log + positions table)
  → openPosition() blocked by _killSwitchActive guard     [NEW — Task 1.2]
  → PositionManager broadcasts ALERT_TRIGGERED (severity: critical, code: KILL_SWITCH_TRIGGERED)
  → PositionManager calls onKillSwitch callback            [NEW — Task 1.3]
  → Engine callback: ModeRunner.forceStop()                [NEW — Task 1.4-1.5]
  → ModeRunner broadcasts MODE_STOPPED                     [NEW — Task 1.4]
  → Client Zustand store: ALERT_TRIGGERED handler sets status "kill-switch" + killSwitchDetail
  → Client Zustand store: MODE_STOPPED handler — SKIPPED (kill-switch guard) [NEW — Task 4.1]
  → ModeCard renders red "Kill Switch" badge with details
  → AlertBanner renders critical alert with per-position details and resolution
```

### SAFETY CRITICAL: openPosition() guard

Task 1.2 is the highest-priority change in this story. Without the `_killSwitchActive` guard in `openPosition()`, there is a race condition where new positions can be opened DURING kill-switch execution. This means:
- Kill-switch closes all positions for a mode
- Simultaneously, the still-running `executeIteration()` opens a new position
- The new position has no mode managing it — effectively orphaned
- Real money at risk with no stop-loss enforcement for the orphan

This guard MUST be implemented before any other task.

### Critical: ModeRunner.forceStop() vs stop()

`ModeRunner.stop()` calls `closeAllForMode()` which would double-close positions (already closed by kill-switch). Create `forceStop()` that:
1. Sets `_running = false`
2. Clears `_loopTimer`
3. Emits `MODE_STOPPED` with finalStats
4. Does NOT call `closeAllForMode()`

This method should be **package-private** (only called from engine) — not exposed on the public API.

### Kill-Switch Threshold Math

The threshold is `remaining <= allocation * 0.9` in `fund-allocator.ts:98`. This means kill-switch triggers when remaining drops to 90% of allocation, i.e., 10% loss. Note: this checks `remaining` (which decreases as positions are reserved and losses accumulate), not `pnl` directly.

Example: allocation = 1000 USDC → kill-switch at remaining ≤ 900 USDC → triggers after 100 USDC loss.

### File Changes Summary

| File | Change | Reason |
|------|--------|--------|
| `src/server/engine/position-manager.ts` | Add `_killSwitchActive` guard in `openPosition()`, add `onKillSwitch` callback, add `resetModeStatus()`, enhance alert details | Gaps 1a, 1, 3, 7 |
| `src/server/engine/fund-allocator.ts` | Add `resetModeStats()` method | Gap 6 |
| `src/server/engine/mode-runner.ts` | Add `forceStop()` method | Gap 1 |
| `src/server/engine/index.ts` | Wire callback, fix `getModeStatus()`, add `resetKillSwitch()` | Gaps 1, 2, 3 |
| `src/server/api/mode.ts` | Call `resetKillSwitch()` on allocation change for kill-switched mode | Gap 3 |
| `src/client/store/index.ts` | Add kill-switch guard in MODE_STOPPED handler, clear killSwitchDetail on re-allocation | Gaps 4, 5 |
| `src/server/engine/position-manager.test.ts` | Add openPosition guard test, callback test, reset tests, alert details test | Gaps 1a, 1, 3, 7 |
| `src/server/engine/fund-allocator.test.ts` | Add resetModeStats tests | Gap 6 |
| `src/server/engine/mode-runner.test.ts` | Add forceStop tests | Gap 1 |
| `src/server/engine/index.test.ts` | Add integration + multi-mode tests | Gap 8 |
| `src/client/store/index.test.ts` | Add MODE_STOPPED guard test, kill-switch reset tests | Gaps 4, 5 |
| `src/client/components/mode-card.test.tsx` | Add reset state test | Gap 5 |

### Existing Patterns to Follow

- **Callback pattern:** PositionManager already takes `broadcast: BroadcastFn` as constructor arg. Add `onKillSwitch` similarly.
- **Module-level function export:** Engine exports `startMode`, `stopMode`, `getModeStatus`. Add `resetKillSwitch` in the same pattern.
- **Test setup:** All engine tests use `beforeEach` with `vi.fn()` mocks. Position manager tests create real FundAllocator + mocked blockchain client.
- **Zustand immutable updates:** Spread + nested object merge pattern (see store/index.ts handlers).
- **Number validation:** Use `Number.isFinite()` for all financial values (learned from Story 2-6).
- **No new shared types needed** — ModeStatus already includes "kill-switch", Alert type exists, all event payloads defined.

### Project Structure Notes

- All changes are within existing files — no new files needed
- `forceStop()` is a new method on `ModeRunner` class but in the existing file
- `resetModeStatus()` is a new method on `PositionManager` class but in the existing file
- `resetModeStats()` is a new method on `FundAllocator` class but in the existing file
- `resetKillSwitch()` is a new exported function in `engine/index.ts`

### Test Baseline

343 tests passing across 26 test files. Zero regressions expected. New tests should add approximately 15-20 tests across 7 test files.

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 3, Story 3.1]
- [Source: _bmad-output/planning-artifacts/architecture.md — Kill switch data flow, error handling standard, WebSocket event catalog]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — ModeCard states, AlertBanner, kill-switch user journey]
- [Source: src/server/engine/fund-allocator.ts:8,95-99 — KILL_SWITCH_THRESHOLD, checkKillSwitch()]
- [Source: src/server/engine/position-manager.ts:48-49,341-356,365-401,403-405 — kill-switch state, trigger, closeAll, getModeStatus]
- [Source: src/server/engine/mode-runner.ts:43-64,66-87,93-120 — start guard, stop, run loop]
- [Source: src/server/engine/index.ts:38-68,90-96 — startMode, getModeStatus]
- [Source: src/client/store/index.ts:43-46,248-276,284 — ModeStoreEntry, kill-switch handler, restart guard]
- [Source: src/client/components/mode-card.tsx:28,124,330-335 — kill-switch badge, toggle disable, detail display]
- [Source: src/client/components/alert-banner.tsx — critical alert rendering]
- [Source: src/shared/events.ts:35-42 — AlertTriggeredPayload]
- [Source: src/shared/types.ts:34 — ModeStatus type includes "kill-switch"]

### Previous Story Intelligence (2-7)

Key learnings from Story 2-7 and its code review:
- **Number.isFinite() guards:** Always use `Number.isFinite()` for financial number validation, not `typeof === "number"` (catches NaN/Infinity)
- **Non-empty string guards:** Check `.length > 0` for pair names, not just `typeof === "string"`
- **Bug found in 2-7:** `isValidStatusResponse()` used stale field names from pre-Story-8-2 rename. When modifying status API responses, verify all validators match current field names.
- **Deferred W3 from 8-2:** `loadFromDb` recovered positions use fabricated `chainPositionId: "recovered-${id}"`. Story 3.2 will fix this — don't address in this story.
- **Test baseline:** 343 tests passing (26 files). New tests should maintain zero regressions.

### Git Intelligence

Recent commits show:
- Story implementations follow TDD with co-located tests
- Engine changes are tested with real FundAllocator + mocked blockchain
- Store changes tested with `useStore.setState()` + event dispatch
- Component tests use `@testing-library/react` with mocked store state
- All stories maintain zero regression baseline

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
- openPosition guard initially checked only `_killSwitchActive` Set, but `closeAllForMode()` clears it after completion. Fixed to also check `_modeStatus` map for persistent kill-switch state.
- mode.test.ts mock needed `getModeStatus` and `resetKillSwitch` added to engine mock.

### Completion Notes List
- Task 1: Added `onKillSwitch` callback to PositionManager, `_killSwitchActive` + `_modeStatus` guard in `openPosition()`, `forceStop()` on ModeRunner, wired callback in engine. 3 new mode-runner tests, 3 new position-manager tests.
- Task 2: Fixed `getModeStatus()` in engine to check position-manager kill-switch state. Enhanced alert details with per-position breakdown (pair, side, entry price). 2 new tests.
- Task 3: Added `resetModeStatus()` to PositionManager, `resetModeStats()` to FundAllocator, `resetKillSwitch()` to engine. Wired to PUT config endpoint. 3 new tests.
- Task 4: Added kill-switch guard in MODE_STOPPED handler to preserve kill-switch status. Added kill-switch reset in `setModeConfig` when allocation changes. 3 new store tests.
- Task 5: Integration tests for full kill-switch lifecycle, WS event ordering, multi-mode isolation. 3 new store integration tests, 2 new engine integration tests.

### Review Findings

- [x] [Review][Decision] #2 — Alert details show entry price, not exit price (AC #6 requires closing prices). **Resolved:** Added `ClosedPositionDetail` type with `exitPrice`, threaded through `closeAllForMode` and alert broadcast. Details now show `entry → exit` format.
- [x] [Review][Decision] #8 — Zero-allocation (`allocation: 0`) clears kill-switch state. **Resolved:** Added `allocation > 0` guard in API endpoint.
- [x] [Review][Patch] #1 — `killSwitchDetail` always `{ positionsClosed: 0, lossAmount: 0 }`. **Resolved:** Added `positionsClosed` and `lossAmount` fields to `AlertTriggeredPayload` and broadcast payload.
- [x] [Review][Patch] #3 — `resetModeStatus` can be called while `closeAllForMode` is in-flight. **Resolved:** Added `_killSwitchActive` guard — throws `KILL_SWITCH_IN_PROGRESS` if close sweep is running.
- [x] [Review][Patch] #5 — `resetModeStats` does not reset `remaining`. **Resolved:** Added `entry.remaining = entry.allocation` to `resetModeStats`.
- [x] [Review][Patch] #6 — Kill-switch alert undercounts positions by 1. **Resolved:** Triggering position now included in count and details (`totalClosed = summary.count + 1`).
- [x] [Review][Patch] #7 — `onKillSwitch` is public. **Resolved:** Changed to `private readonly _onKillSwitch`.
- [x] [Review][Defer→Fixed] #4 — Stale `onKillSwitch` callback could kill newly started runner. **Resolved:** Engine callback now checks `getModeStatus(mode) === "kill-switch"` before calling `forceStop`, so a new runner started after reset is not killed.
- [x] [Review][Defer→Fixed] #9 — `closeAllForMode` partial failure leaves orphan positions. **Resolved:** Failed positions now tracked; a `KILL_SWITCH_CLOSE_FAILED` critical alert is broadcast listing the position IDs that need manual closure.
- [x] [Review][Defer→Fixed] #10 — `closeAllForMode` PnL uses custom formula instead of `closeResult.pnl`. **Resolved:** Now uses `result.pnl` directly from the contract close result (already smallest-unit).

### Change Log
- 2026-04-06: Implemented all 5 tasks for Story 3-1 (per-mode kill-switch). 16 new tests added (343 → 359), zero regressions.

### File List
- src/server/engine/position-manager.ts (modified: onKillSwitch callback, openPosition guard, resetModeStatus, enhanced alert details)
- src/server/engine/mode-runner.ts (modified: added forceStop method)
- src/server/engine/index.ts (modified: wired onKillSwitch callback, fixed getModeStatus, added resetKillSwitch)
- src/server/engine/fund-allocator.ts (modified: added resetModeStats)
- src/server/api/mode.ts (modified: call resetKillSwitch on allocation change for kill-switched mode)
- src/client/store/index.ts (modified: kill-switch guard in MODE_STOPPED, kill-switch reset in setModeConfig)
- src/server/engine/position-manager.test.ts (modified: 4 new tests)
- src/server/engine/mode-runner.test.ts (modified: 3 new tests)
- src/server/engine/index.test.ts (modified: 2 new tests)
- src/server/engine/fund-allocator.test.ts (modified: 2 new tests)
- src/client/store/index.test.ts (modified: 5 new tests)
- src/server/api/mode.test.ts (modified: added getModeStatus/resetKillSwitch to engine mock)
