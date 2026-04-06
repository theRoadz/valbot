# Story 8.5: Enforce Minimum Order Value ($10 Hyperliquid Minimum)

Status: done

## Story

As theRoad,
I want orders to meet Hyperliquid's $10 minimum notional value,
So that modes don't fail with cryptic exchange errors when allocations are small.

## Problem & Discovery

When starting Volume Max with $20 allocated on SOL/USDC, the error occurs:
```
Order must have minimum value of $10. asset=5
```

### Root Cause
`MIN_POSITION_SIZE = 1` (= $0.000001) in both strategies provides no meaningful floor. The position size formula `Math.floor(allocation / 20)` with $20 allocation yields $1 per position — far below Hyperliquid's $10 minimum notional.

**Math trace (SOL at $200, $20 allocation):**
1. `positionSize = Math.floor(20_000_000 / 20) = 1_000_000` ($1)
2. `sizeDisplay = 1_000_000 / 1e6 = 1` USDC
3. `baseSize = 1 / 200 = 0.005` SOL → rounded to `0.01` SOL
4. Notional = `0.01 × 200 = $2` → **rejected** (minimum $10)

Same bug exists in Profit Hunter strategy (lines 26, 74, 197).

## Acceptance Criteria

1. **Given** `MIN_POSITION_SIZE` is set, **Then** it equals `10_000_000` ($10 smallest-unit) in both strategies.
2. **Given** Volume Max is started with allocation < $10, **Then** the constructor throws `invalidStrategyConfigError` with clear message about minimum allocation. *(Updated: sequential round-trips only need one $10 position at a time.)*
3. **Given** Profit Hunter is started with allocation < $10, **Then** the constructor throws `invalidStrategyConfigError` with clear message.
4. **Given** any strategy opens a position with size < $10, **Then** `contracts.ts:openPosition()` throws `orderFailedError` before hitting the exchange.
5. **Given** Volume Max with $20 allocation, **Then** `positionSize` is clamped to $10 and trades execute successfully.

## Tasks / Subtasks

- [x] Task 1: Fix MIN_POSITION_SIZE in volume-max.ts (AC: 1, 2, 5)
  - [x] 1.1 Change `MIN_POSITION_SIZE` from `1` to `10_000_000` ($10 smallest-unit)
  - [x] 1.2 Add allocation validation after line 39: if `allocation < MIN_POSITION_SIZE * 2`, throw `invalidStrategyConfigError("volumeMax", "allocation must be at least $20 (need $10 per side)")`

- [x] Task 2: Fix MIN_POSITION_SIZE in profit-hunter.ts (AC: 1, 3)
  - [x] 2.1 Change `MIN_POSITION_SIZE` from `1` to `10_000_000`
  - [x] 2.2 Add allocation validation after line 67: if `allocation < MIN_POSITION_SIZE`, throw `invalidStrategyConfigError("profitHunter", "allocation must be at least $10")`

- [x] Task 3: Add pre-flight guard in contracts.ts (AC: 4)
  - [x] 3.1 Add `MIN_ORDER_VALUE = 10_000_000` constant
  - [x] 3.2 In `openPosition()`, guard: if `size < MIN_ORDER_VALUE`, throw `orderFailedError` with clear message

- [x] Task 4: Tests (AC: all)
  - [x] 4.1 `volume-max.test.ts`: constructor throws when allocation < $20
  - [x] 4.2 `volume-max.test.ts`: positionSize clamped to $10 when allocation/20 < $10
  - [x] 4.3 `profit-hunter.test.ts`: constructor throws when allocation < $10
  - [x] 4.4 `profit-hunter.test.ts`: dynamic getPositionSize() clamps to $10
  - [x] 4.5 `contracts.test.ts`: openPosition throws when size < $10
  - [x] 4.6 Full test suite: 528 passed, 1 pre-existing failure (resetKillSwitch)

## Dev Notes

### Key Files

- `src/server/engine/strategies/volume-max.ts` — `MIN_POSITION_SIZE` (line 20), positionSize calc (line 44)
- `src/server/engine/strategies/profit-hunter.ts` — `MIN_POSITION_SIZE` (line 26), positionSize calc (lines 74, 197)
- `src/server/blockchain/contracts.ts` — `openPosition()` (line 154), size conversion (lines 167-169)
- `src/server/lib/errors.ts` — reuse `invalidStrategyConfigError` (line 165), `orderFailedError` (line 387)

### Existing Patterns to Reuse

- `invalidStrategyConfigError(mode, details)` — already used in both strategy constructors for config validation
- `orderFailedError(details)` — already used in contracts.ts for order failures
- No new error factories needed

### What NOT To Build

- No changes to the `/20` divisor — it's intentional risk management (5% of allocation per position)
- No new API endpoints or UI changes
- No changes to fund-allocator.ts — the validation belongs in strategy constructors

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- TypeScript compile: clean (via test run)
- Test suite: 530 passed, 0 failures (final)

### Completion Notes List

- `MIN_POSITION_SIZE` raised from `1` to `10_000_000` ($10) in both volume-max.ts and profit-hunter.ts
- Constructor allocation validation added: VolumeMax requires $20 min (2 sides), ProfitHunter requires $10 min
- Pre-flight `MIN_ORDER_VALUE` guard added in `contracts.ts:openPosition()` — catches any strategy trying to submit sub-$10 orders
- With $20 allocation, VolumeMax now uses $10 position size (clamped by `Math.max`) instead of $1
- Fixed `roundToSzDecimals` to use directional rounding: `Math.ceil` for opens (ensures notional >= $10), `Math.floor` for closes/stop-losses (ensures we never try to close more than the actual position)
- Added `mode` parameter to `roundToSzDecimals`: `"ceil"` (default, for opens) and `"floor"` (for reduce-only orders)
- **Redesigned VolumeMax from simultaneous long+short to sequential round-trips** — Hyperliquid uses net (oneWay) positions, so simultaneous long+short on the same asset nets to 0 and closes fail. New approach: open long → close long → open short → close short
- Min allocation reduced from $20 to $10 (only one position open at a time)
- Fund check changed from `2x size` to `1x size`
- Each leg is independent — if long fails, short still runs; if close fails, stop-loss is safety net
- **Close orders now use exact `filledSz` from open** — `openPosition` returns `filledSz` (the raw `totalSz` from Hyperliquid, e.g., "0.08"), stored in `InternalPosition` and passed to `closePosition` as `baseSz`. Eliminates USDC-to-base re-derivation that caused both "minimum value" and "reduce only would increase" errors
- Added `filledSz: string` to `OpenPositionResult` and `baseSz?: string` to `ClosePositionParams`
- Added `filledSz?: string` to `InternalPosition` (in-memory only, no DB migration needed)
- All 4 close call sites in position-manager.ts now pass `baseSz: openResult.filledSz` or `baseSz: pos.filledSz`

### File List

- `src/server/engine/strategies/volume-max.ts` (modified — MIN_POSITION_SIZE + allocation validation)
- `src/server/engine/strategies/volume-max.test.ts` (modified — 2 new tests)
- `src/server/engine/strategies/profit-hunter.ts` (modified — MIN_POSITION_SIZE + allocation validation)
- `src/server/engine/strategies/profit-hunter.test.ts` (modified — 2 new tests)
- `src/server/blockchain/contracts.ts` (modified — MIN_ORDER_VALUE + pre-flight guard)
- `src/server/blockchain/contracts.test.ts` (modified — 1 new test)

### Change Log

- 2026-04-06: Story created for minimum order value enforcement bug
- 2026-04-06: Implemented Story 8-5 — all tasks complete, ready for code review
- 2026-04-06: Code review complete — 2 patches applied, 2 deferred, 5 dismissed
- 2026-04-06: All deferred findings resolved — setStopLoss baseSz plumbing, filledSz DB persistence, szDecimals=0 guard

### Review Findings

- [x] [Review][Decision→Patch] `setStopLoss` derives baseSize from USDC/triggerPx, not filledSz — fixed: added `baseSz` to `SetStopLossParams`, piped from position-manager
- [x] [Review][Decision→Patch] AC2 min allocation updated from $20 to $10 — sequential round-trips only need one position at a time
- [x] [Review][Patch] VolumeMax: skip Short leg when Long close fails (net-position conflict) [volume-max.ts:72–73] — fixed
- [x] [Review][Patch] Orphan in-memory positions missing `filledSz` [position-manager.ts:200,314] — fixed
- [x] [Review][Patch] `filledSz` persisted to DB — added column + migration, wired into inserts and loadFromDb
- [x] [Review][Patch] `roundToSzDecimals` with szDecimals=0 guard — floor rounding now returns minimum unit instead of "0"
