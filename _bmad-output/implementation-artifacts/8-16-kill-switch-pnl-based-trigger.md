# Story 8.16: Kill Switch PnL-Based Trigger

Status: review

## Story

As theRoad,
I want the kill switch to trigger based on actual realized losses (PnL), not on deployed capital,
So that multi-position strategies don't falsely kill-switch when funds are merely reserved in open positions.

## Problem

The kill switch uses `remaining <= allocation * 0.9` to detect 10% loss. But `remaining` decreases whenever funds are **reserved** into open positions — not just when actual losses occur. Any strategy deploying >10% of allocation simultaneously (e.g., Momentum with 2 pairs at ~$10 each from $100) will trigger a false kill switch even with zero or positive PnL.

### Real-world incident (2026-04-09)

Momentum strategy with $100 allocation opened BTC ($10.63) and SOL ($10.70) positions. After reserve, `remaining` dropped to ~$78.67. SOL closed with -$0.03 loss, returning ~$10.67. Remaining rose to ~$89.34 — still under the $90 threshold. Kill switch fired despite only $0.03 total loss and +$0.01 net PnL.

## Background

### Current implementation

```typescript
// fund-allocator.ts line 147
const KILL_SWITCH_THRESHOLD = 0.9;
return entry.remaining <= entry.allocation * KILL_SWITCH_THRESHOLD;
```

`remaining` = `allocation - reserved + released`. When positions are open, reserved funds reduce `remaining` even though no loss has occurred.

### Why PnL-based is correct

The `FundAllocator` already tracks realized PnL via `recordTrade(mode, size, pnl)` — called after every position close. This field accumulates actual trade gains/losses and is the correct signal for loss detection.

### Design decision

- Use `entry.pnl < -(entry.allocation * (1 - KILL_SWITCH_THRESHOLD))` — triggers when cumulative realized loss exceeds 10% of allocation
- Use strict `<` (not `<=`) so exactly-at-threshold does not trigger
- No change to kill switch UI, reset mechanism, or position manager integration

## Acceptance Criteria

1. **Given** a strategy deploys >10% of allocation in open positions, **When** no realized losses have occurred, **Then** the kill switch does NOT trigger.
2. **Given** a strategy's cumulative realized PnL exceeds -10% of allocation, **When** a position closes with a loss, **Then** the kill switch triggers.
3. **Given** cumulative PnL is exactly -10% of allocation (boundary), **When** checked, **Then** the kill switch does NOT trigger (strict `<`).
4. **Given** cumulative PnL exceeds -10% of allocation, **When** checked, **Then** the kill switch triggers.
5. **Given** losses are below the 10% threshold, **When** checked, **Then** the kill switch does NOT trigger.
6. **Given** all changes are made, **When** running `pnpm test`, **Then** all tests pass.

## Tasks / Subtasks

- [x] Task 1: Fix `checkKillSwitch` to use PnL (AC: 1-5)
  - [x] 1.1 Changed `checkKillSwitch` to use `entry.pnl < -maxLoss` where `maxLoss = entry.allocation - entry.allocation * KILL_SWITCH_THRESHOLD` (avoids floating-point precision issue with `1 - 0.9`)
  - [x] 1.2 Updated 4 kill-switch tests: added `recordTrade` calls, fixed "funds merely deployed" to expect `false`, fixed boundary to expect `false` (strict `<`)
  - [x] 1.3 Updated cross-mode isolation test to use `recordTrade` for loss simulation
  - [x] 1.4 All 803 tests pass

## Dev Notes

### Key Files

- `src/server/engine/fund-allocator.ts` — Fix `checkKillSwitch` method (line 144-148)
- `src/server/engine/fund-allocator.test.ts` — Update kill-switch detection tests (lines 165-202, 520-528)

### Do NOT

- Do NOT change the kill switch threshold constant (0.9)
- Do NOT change the kill switch reset mechanism (`resetModeStats`)
- Do NOT change how `recordTrade` accumulates PnL — it already works correctly
- Do NOT change the position manager's kill switch call site (line 522) — only the check logic changes
