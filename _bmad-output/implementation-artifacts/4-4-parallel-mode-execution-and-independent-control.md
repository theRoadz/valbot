# Story 4.4: Parallel Mode Execution & Independent Control

Status: done

## Story

As theRoad,
I want to run all three modes simultaneously with independent start/stop control,
So that I can stack strategies based on market conditions without any mode interfering with another.

## Acceptance Criteria

1. **Start second mode alongside running mode** — Volume Max running + Profit Hunter toggled on → both show green "Running" badges simultaneously, both update independent stats, trade log shows entries from both with distinct color tags ([VOL] purple, [PRO] green), SummaryBar totals aggregate both active modes
2. **Stop one mode while others continue** — Two+ modes running, toggle one off → only that mode stops and closes positions, other modes continue unaffected (FR6), stopped mode shows "Stopping..." then "Stopped" with final stats, SummaryBar updates to reflect only remaining active modes
3. **All three modes running concurrently** — All three ModeCards show green "Running" with independent stats, trade log shows [VOL] purple / [PRO] green / [ARB] cyan interleaved, PositionsTable shows positions from all modes tagged with mode color, fund allocator enforces total allocation across all modes does not exceed wallet balance

## Tasks / Subtasks

- [x] Task 1: Validate & fix parallel mode start/stop in engine (AC: #1, #2)
  - [x] 1.1 Verify `startMode()` allows starting a second mode while first is running (already supported by `modeRunners` Map + `modeLocks` Set — write integration test)
  - [x] 1.2 Verify `stopMode()` only stops the targeted mode, others continue (write integration test)
  - [x] 1.3 Verify `stopAllModes()` with `Promise.allSettled` handles mixed success/failure
  - [x] 1.4 Test mode lock prevents concurrent start/stop on same mode while allowing different modes
  - [x] 1.5 Test that kill-switch on one mode does NOT affect other running modes

- [x] Task 2: Validate fund allocator cross-mode isolation (AC: #1, #3)
  - [x] 2.1 Test `canAllocate()` respects per-mode budgets — mode A allocation doesn't draw from mode B
  - [x] 2.2 Test total allocation validation: sum of all mode allocations cannot exceed wallet balance (add validation if missing)
  - [x] 2.3 Test `reserve()`/`release()` for concurrent modes — mode A's reserve doesn't affect mode B's remaining
  - [x] 2.4 Test kill-switch triggers independently per mode — mode A hitting 10% loss doesn't affect mode B
  - [x] 2.5 Test `reconcilePositions()` correctly attributes positions to the right mode after restart

- [x] Task 3: Validate SummaryBar aggregation across active modes (AC: #1, #2, #3)
  - [x] 3.1 Verify `aggregateSummaryStats()` in Zustand store sums stats from all running modes
  - [x] 3.2 Test aggregation updates when a mode stops — removed mode's final stats still included until next session
  - [x] 3.3 Test aggregation when a mode re-starts — stats persist from previous run (NOT reset to zero); stats only begin at zero on fresh app load via `createDefaultMode()`
  - [x] 3.4 Test aggregation handles partial mode states (1 running, 1 stopped, 1 error)

- [x] Task 4: Validate trade log interleaving and color tagging — manual verification (AC: #1, #3)
  - [x] 4.1 Verify `TRADE_EXECUTED` events from different modes appear in chronological order in the trade log
  - [x] 4.2 Verify trade entries are tagged: [VOL] purple `#8b5cf6` / `text-mode-volume`, [PRO] green `#22c55e` / `text-mode-profit`, [ARB] cyan `#06b6d4` / `text-mode-arb` — `MODE_TAGS` in `trade-log.tsx` already maps these
  - [x] 4.3 Test trade log with high-frequency trades from multiple modes (500 entry DOM limit)

- [x] Task 5: Validate PositionsTable multi-mode display — manual verification (AC: #3)
  - [x] 5.1 Verify positions from all running modes appear in the table with correct mode color tag — `MODE_TAGS` in `positions-table.tsx` already maps VOL/PRO/ARB with color classes
  - [x] 5.2 Verify position close from one mode doesn't affect positions from other modes in the table
  - [x] 5.3 Verify position close animation (300ms) for simultaneous closes — `closingPositions: number[]` tracks per-position IDs, so multi-mode closes are naturally independent (no extra work expected)

- [x] Task 6: Validate ModeCard independent state management — manual verification (AC: #1, #2)
  - [x] 6.1 Test toggling mode A does not change mode B's badge, stats, or controls
  - [x] 6.2 Test error state in mode A does not disable controls in mode B
  - [x] 6.3 Test kill-switch in mode A shows red badge only on mode A, others remain green — note: store has a kill-switch guard where `MODE_STOPPED` from `forceStop()` is ignored if status is already `kill-switch` (prevents overwrite)
  - [x] 6.4 Test fund allocation input disabled when mode running, but other stopped modes' inputs remain editable

- [x] Task 7: Add total allocation validation (AC: #3 — new logic if missing)
  - [x] 7.1 In `FundAllocator.setAllocation()`, use existing `getTotalAllocated()` to validate sum of all mode allocations does not exceed `maxAllocation` (method already exists — do NOT reimplement)
  - [x] 7.2 In ModeCard allocation input, validate available balance = `getMaxAllocation() - getTotalAllocated() + currentModeAllocation`
  - [x] 7.3 API route `PUT /api/mode/:mode/config` returns clear error when allocation would exceed total
  - [x] 7.4 Client displays remaining allocatable amount in the allocation input placeholder

- [x] Task 8: Integration tests for full parallel scenario (AC: #1, #2, #3)
  - [x] 8.1 Test: start volumeMax → start profitHunter → both running → stop volumeMax → profitHunter still running
  - [x] 8.2 Test: all three modes started → one errors → other two continue unaffected
  - [x] 8.3 Test: all three modes → stopAllModes → all positions closed, all modes stopped
  - [x] 8.4 Test: mode start fails (oracle unavailable) while other modes running — no disruption

## Dev Notes

### Current State — Parallel Infrastructure Already Exists

The engine (`src/server/engine/index.ts`) already supports parallel modes:
- `modeRunners: Map<ModeType, ModeRunner>` — each mode gets its own runner instance
- `modeLocks: Set<ModeType>` — prevents concurrent transitions on the same mode, but allows different modes to start/stop independently
- `stopAllModes()` uses `Promise.allSettled()` for graceful multi-mode shutdown
- Each `ModeRunner` has independent `_loopTimer` and `_running` state

**This story is primarily about validation, testing, and fixing any gaps in the existing parallel infrastructure** rather than building new parallel execution from scratch.

### Key Files to Touch

| File | Action | Reason |
|------|--------|--------|
| `src/server/engine/index.ts` | Test + minor fixes | Verify parallel start/stop works correctly |
| `src/server/engine/index.test.ts` | Extend heavily | Add parallel mode integration tests |
| `src/server/engine/fund-allocator.ts` | Add total allocation validation | Prevent over-allocation across modes |
| `src/server/engine/fund-allocator.test.ts` | Extend | Cross-mode isolation tests |
| `src/client/store/index.ts` | Verify aggregation | `aggregateSummaryStats()` must sum all modes |
| `src/client/components/mode-card.tsx` | Minor fixes if needed | Verify independent state isolation |
| `src/server/api/mode.ts` | Add allocation validation | Reject over-allocation at API level |

### Architecture Compliance

- **Fund isolation is absolute** — `canAllocate(mode, size)` checks per-mode remaining, NOT global pool. Verify this.
- **Kill-switch per-mode** — `checkKillSwitch(mode)` triggers only for the specified mode. Other modes MUST be unaffected.
- **WebSocket events scoped by mode** — All events include `mode` field. Store dispatches to correct mode slice.
- **Graceful shutdown** — `stopAllModes()` with `Promise.allSettled()` ensures one mode's stop failure doesn't block others.

### Fund Allocator Internals

```typescript
// src/server/engine/fund-allocator.ts
state: Map<ModeType, ModeAllocation>  // Per-mode: { allocation, remaining, trades, volume, pnl }
maxAllocation: number                  // Global cap (default 500 USDC)
positionSizes: Map<ModeType, number>  // Per-mode position size
```

**Confirmed gap:** `setAllocation()` only checks `amount > this.maxAllocation` per-mode. It does NOT check the sum across all modes. `getTotalAllocated()` already exists — use it in the validation: `getTotalAllocated() - currentModeAllocation + newAmount > maxAllocation` → reject.

### Zustand Store Aggregation

```typescript
// src/client/store/index.ts
aggregateSummaryStats(modes, equity, available) — already implemented correctly:
  - Sums ALL modes via Object.values(modes) regardless of running/stopped status
  - Total PnL = sum of all modes' pnl
  - Total Trades = sum of all modes' trades
  - Total Volume = sum of all modes' volume
  - Equity/Available from connection state (blockchain)
```

### Store Mode Event Behavior (validated)

- **MODE_STARTED**: Sets `status: "running"`, does NOT reset stats. Stats persist across start/stop cycles within a session. Only reset on app reload via `createDefaultMode()`.
- **MODE_STOPPED**: Applies `finalStats` if provided, sets `status: "stopped"`. Has kill-switch guard: if mode status is already `kill-switch`, the MODE_STOPPED event is **ignored** (prevents `forceStop()` from overwriting kill-switch state).
- **MODE_ERROR**: Sets `status: "error"`, stores `errorDetail`. Only affects the targeted mode.
- **All handlers**: Scoped to `state.modes[mode]` only — zero cross-mode coupling confirmed.

### UI Components Already Support Multi-Mode (validated)

- **trade-log.tsx**: `MODE_TAGS` maps mode → `[VOL]`/`[PRO]`/`[ARB]` with `text-mode-volume`/`text-mode-profit`/`text-mode-arb` CSS classes. Renders all trades from store without filtering.
- **positions-table.tsx**: `MODE_TAGS` maps mode → color-tagged labels. Displays ALL positions from store. `closingPositions` tracks per-position IDs (animation is per-position, not per-mode).
- **top-bar.tsx**: Reads `useStore(s => s.stats)` — already aggregated values from `aggregateSummaryStats()`.
- **Conclusion**: Tasks 4-6 are primarily manual verification, not new code. Focus dev effort on engine-level tests (Tasks 1-3, 7-8).

### Mode Color Tags (Existing)

| Mode | Tag | Color | Hex |
|------|-----|-------|-----|
| Volume Max | [VOL] | Purple | `#8b5cf6` |
| Profit Hunter | [PRO] | Green | `#22c55e` |
| Arbitrage | [ARB] | Cyan | `#06b6d4` |

### Previous Story Learnings (from 4-3 Arbitrage)

- Constructor validates: non-empty pairs, positive thresholds, $10 minimum
- Fund check via `canAllocate()` before every trade; dynamic position sizing
- Oracle gate + blockchain connectivity gate both checked before mode start
- Error handling: strategy iteration errors caught by `ModeRunner._runLoop()` and broadcast as `MODE_ERROR` events
- Insufficient funds → skip trade (info-level log), don't stop mode
- All 581 tests passing after story 4-3

### Testing Patterns Established

- Tests co-located: `*.test.ts` next to source
- Mock patterns already set up in `index.test.ts`: broadcaster, blockchain client, oracle, contracts
- Use `setupTestDb()` / `teardownTestDb()` for DB-dependent tests
- `vi.mock()` for module-level mocks, `vi.fn()` for function mocks
- `Promise.allSettled` pattern for parallel stop testing

### What NOT to Build

- Do NOT create a new orchestration layer — the existing `Map<ModeType, ModeRunner>` IS the orchestrator
- Do NOT add inter-mode communication — modes MUST be independent
- Do NOT create shared position pools — each mode manages its own positions via `PositionManager` tagged by mode
- Do NOT add mode priority or scheduling — all modes are equal peers
- Do NOT refactor ModeRunner base class — it works correctly for parallel use

### Project Structure Notes

- All source follows `kebab-case` file naming
- Server boundary rules: engine layer handles trading logic, API layer handles HTTP, ws layer handles WebSocket
- Tests use Vitest with `@vitest/coverage-v8`
- No separate `__tests__/` directory

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 4, Story 4.4]
- [Source: _bmad-output/planning-artifacts/architecture.md — Mode Runner, Fund Allocator, WebSocket Events]
- [Source: _bmad-output/planning-artifacts/prd.md — FR5, FR6, FR9-FR11, FR13]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — Mode Card, Multi-Mode Operation]
- [Source: _bmad-output/implementation-artifacts/4-3-arbitrage-strategy.md — Previous story learnings]
- [Source: src/server/engine/index.ts — Current parallel mode implementation]
- [Source: _bmad-output/project-context.md — All implementation rules]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
- Fixed pre-existing test failure: `resetKillSwitch` test needed `_killSwitchActive` cleared
- Fixed test isolation: added `beforeEach` reset of allocations and kill-switch state in engine tests
- Fixed 8 tests across fund-allocator.test.ts and position-manager.test.ts where multi-mode allocations exceeded the new total allocation cap

### Completion Notes List
- Task 1: Confirmed parallel infrastructure works as-is. Added 5 integration tests covering parallel start, independent stop, stopAllModes, mode locking, and kill-switch isolation. Fixed pre-existing resetKillSwitch test.
- Task 2: Added 5 cross-mode fund isolation tests. Confirmed canAllocate, reserve/release, kill-switch, and reconcilePositions all operate per-mode with zero cross-mode coupling.
- Task 3: Added 4 aggregation tests. Confirmed aggregateSummaryStats sums all modes regardless of status, stats persist across start/stop cycles, and partial mode states handled correctly.
- Task 4: Added 2 store-level tests confirming trade log chronological order, mode tagging, and 500-entry limit. Verified trade-log.tsx MODE_TAGS already maps all three modes with correct color classes.
- Task 5: Added 2 store-level tests confirming multi-mode positions display and independent close behavior. Verified positions-table.tsx already supports multi-mode with per-position close animation.
- Task 6: Added 3 store-level tests confirming mode state isolation: toggle, error, and kill-switch events only affect targeted mode. Verified mode-card.tsx uses per-mode store selectors.
- Task 7: Added cross-mode total allocation validation in FundAllocator.setAllocation() using existing getTotalAllocated(). API route naturally returns TOTAL_ALLOCATION_EXCEEDED error. ModeCard now computes availableForMode and shows it in allocation input placeholder.
- Task 8: Added 4 full parallel scenario integration tests covering: two modes concurrent with selective stop, three modes with one error, stopAllModes, and start failure isolation.

### File List
- `src/server/engine/fund-allocator.ts` — Added cross-mode total allocation validation in setAllocation()
- `src/server/engine/fund-allocator.test.ts` — Extended with 6 cross-mode isolation and total allocation tests; fixed existing tests for new validation
- `src/server/engine/index.test.ts` — Extended with 9 parallel mode tests (Tasks 1, 8); added beforeEach cleanup; fixed resetKillSwitch test
- `src/client/store/index.test.ts` — Extended with 11 multi-mode store tests (Tasks 3-6)
- `src/client/components/mode-card.tsx` — Added totalAllocated selector, availableForMode computation, and allocation placeholder
- `src/server/engine/position-manager.test.ts` — Fixed 2 tests where multi-mode allocations exceeded total cap

### Review Findings

- [x] [Review][Patch] Client `?? 500` fallback — skipped: consistent with store default and existing pattern in max-allocation-control.tsx
- [x] [Review][Patch] No error toast when server rejects allocation with TOTAL_ALLOCATION_EXCEEDED — fixed: added toast.warning on catch [src/client/components/mode-card.tsx]
- [x] [Review][Patch] `expect.fail()` is non-standard in Vitest — fixed: added `expect().toThrow()` guard before try/catch [src/server/engine/fund-allocator.test.ts]
- [x] [Review][Patch] Missing API route test for Task 7.3 — fixed: added TOTAL_ALLOCATION_EXCEEDED test [src/server/api/mode.test.ts]
- [x] [Review][Patch] Test 8.2 title says "errors" but simulates kill-switch — fixed: renamed to "hits kill-switch" [src/server/engine/index.test.ts]
- [x] [Review][Patch] Position close test (5.2) doesn't assert final position count dropped — fixed: added assertion [src/client/store/index.test.ts]
- [x] [Review][Patch] `totalAllocated` selector causes all ModeCards to re-render — dismissed: Zustand uses Object.is on primitives, reduce returns a number so only re-renders when sum actually changes
- [x] [Review][Patch] Placeholder should use `formatCurrency` for consistency — fixed [src/client/components/mode-card.tsx]
- [x] [Review][Defer] `loadFromDb` bypasses cross-mode total allocation validation — could restore over-allocated state after maxAllocation reduction [src/server/engine/fund-allocator.ts:148-181] — deferred, pre-existing
- [x] [Review][Defer] `setMaxAllocation` doesn't clamp or warn when existing allocations already exceed new max [src/server/engine/fund-allocator.ts:199-225] — deferred, pre-existing
- [x] [Review][Defer] `setAllocation(mode, 0)` with open positions leaves stale accounting — remaining capped at 0, released funds lost [src/server/engine/fund-allocator.ts] — deferred, pre-existing
- [x] [Review][Defer] No negative allocation guard on server `setAllocation` — API schema validates but direct calls don't [src/server/engine/fund-allocator.ts] — deferred, pre-existing

### Change Log
- 2026-04-07: Story 4-4 implementation — parallel mode validation, cross-mode total allocation cap, 22 new tests (617 total passing)
