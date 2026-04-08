# Story 8.14: Momentum / Trend-Following Strategy

Status: done

## Story

As theRoad,
I want a momentum strategy that rides sustained price trends using EMA crossovers with RSI confirmation,
So that I can profit when markets are trending strongly in one direction, complementing the mean-reversion and grid strategies.

## Problem

The existing strategy suite covers funding arbitrage (any market), grid trading (sideways), and RSI mean-reversion (reversals) — but has no strategy that profits when price trends strongly. Without momentum, a sustained bull or bear run produces no trades. Trend-following completes the coverage.

## Background

### EMA Crossover Strategy

- **EMA(9)** (fast): responsive to recent price
- **EMA(21)** (slow): represents trend direction
- **Bullish crossover**: EMA(9) crosses above EMA(21) — uptrend starting
- **Bearish crossover**: EMA(9) crosses below EMA(21) — downtrend starting

### Why EMA + RSI Confirmation

EMA crossover alone produces many false signals in choppy markets. Adding RSI as a filter:
- Only enter Long when crossover is bullish AND RSI > 50 (momentum confirms)
- Only enter Short when crossover is bearish AND RSI < 50 (momentum confirms)
- This filters out whipsaw signals where price oscillates around the crossover point

### Trailing Stop-Loss

Unlike fixed stop-losses, a trailing stop locks in gains as the trade moves favorably:
- Starts at 3% from entry
- Moves up (Long) or down (Short) as price reaches new extremes
- Never moves backward — only tightens
- Lets winners run, cuts losers mechanically

### EMA Formula

```
EMA = price x k + EMA_prev x (1 - k)
k = 2 / (period + 1)
```

## Acceptance Criteria

1. **Given** EMA(9) crosses above EMA(21) and RSI > 50, **When** the strategy iterates, **Then** it opens a Long position.
2. **Given** EMA(9) crosses below EMA(21) and RSI < 50, **When** the strategy iterates, **Then** it opens a Short position.
3. **Given** an open Long, **When** EMA(9) crosses below EMA(21), **Then** it closes the position.
4. **Given** an open Short, **When** EMA(9) crosses above EMA(21), **Then** it closes the position.
5. **Given** an open Long, **When** price reaches a new high, **Then** the trailing stop updates to 3% below the new high.
6. **Given** an open Short, **When** price reaches a new low, **Then** the trailing stop updates to 3% above the new low.
7. **Given** the trailing stop, **When** it is updated, **Then** it never moves backward (only tightens).
8. **Given** the oracle has fewer than 21 candles, **When** the strategy iterates, **Then** it skips (warm-up: 21 x 5min = 105 min).
9. **Given** a crossover occurs but RSI does NOT confirm, **When** the strategy iterates, **Then** it does NOT open a position.
10. **Given** the strategy registers, **When** the dashboard loads, **Then** a new mode card appears with orange color (#f97316).
11. **Given** all changes, **When** running `pnpm test`, **Then** all tests pass.

## Tasks / Subtasks

- [x] Task 1: Add EMA calculation to oracle client (AC: 8)
  - [x] 1.1 Add `getEma(pair, emaPeriod)` method to oracle client (delegates to candle aggregator, matches `getRsi(pair, period)` convention)
  - [x] 1.2 Reuse candle aggregation infrastructure from Story 8-13
  - [x] 1.3 EMA uses smoothed calculation over candle close prices
  - [x] 1.4 Unit tests for EMA calculation with known price series

- [x] Task 2: Create MomentumStrategy class (AC: 1-10)
  - [x] 2.1 Create `src/server/engine/strategies/momentum.ts`
  - [x] 2.2 Define `MomentumConfig`: `pairs`, `fastEmaPeriod` (9), `slowEmaPeriod` (21), `rsiPeriod` (14), `trailingStopPct` (0.03), `iterationIntervalMs` (30_000), `slippage`, `positionSize`. Note: candle period uses the global `CANDLE_PERIOD_MS` (300_000) from candle-aggregator — not configurable per-strategy.
  - [x] 2.3 Constructor validation: fastEmaPeriod < slowEmaPeriod, trailingStopPct > 0, etc.
  - [x] 2.4 Crossover detection: store previous EMA(9) vs EMA(21) relationship per pair, detect when it changes
  - [x] 2.5 RSI confirmation: only open when RSI direction matches crossover (>50 for Long, <50 for Short)
  - [x] 2.6 Add `updateStopLoss(positionId, newStopPrice)` method to position-manager — looks up position, calls `contractSetStopLoss` with updated price, updates in-memory and DB `stopLoss` field. No-ops if new stop is worse than current (enforces never-backward rule).
  - [x] 2.7 Trailing stop implementation:
    - Track peak price per position (high watermark for Long, low watermark for Short)
    - Each iteration: if new extreme reached, call `positionManager.updateStopLoss()` with new trailing stop
    - Stop = peak × (1 - trailingStopPct) for Long, trough × (1 + trailingStopPct) for Short
  - [x] 2.8 Close on reverse crossover (EMA re-crosses against position direction)
  - [x] 2.9 Warm-up: skip if oracle has < slowEmaPeriod candles
  - [x] 2.10 Activity log: build `ActivityPairEntry[]` throughout iteration, broadcast via `EVENTS.MODE_ACTIVITY` (same pattern as profit-hunter.ts lines 243-248). Use `signalValue` for RSI, outcomes: `opened-long`, `opened-short`, `closed-crossover`, `held`, `no-signal`, `skipped-warming`, etc.
  - [x] 2.11 Self-register: `modeType: "momentum"`, slug: `"momentum"`, color: `"#f97316"` (orange)

- [x] Task 3: Update infrastructure (AC: 10)
  - [x] 3.1 Import momentum strategy in `src/server/engine/index.ts` for registration
  - [x] 3.2 Extend StrategyDeps if needed (no changes needed — reuses oracleClient)

- [x] Task 4: Tests (AC: 11)
  - [x] 4.1 Create `src/server/engine/strategies/momentum.test.ts`
  - [x] 4.2 Test: opens Long on bullish crossover + RSI > 50
  - [x] 4.3 Test: opens Short on bearish crossover + RSI < 50
  - [x] 4.4 Test: does NOT open when RSI doesn't confirm crossover
  - [x] 4.5 Test: closes on reverse crossover
  - [x] 4.6 Test: trailing stop updates on new high (Long) via `positionManager.updateStopLoss()`
  - [x] 4.7 Test: trailing stop updates on new low (Short) via `positionManager.updateStopLoss()`
  - [x] 4.8 Test: trailing stop never moves backward (`updateStopLoss` no-ops when new stop is worse)
  - [x] 4.9 Test: skips during warm-up (< 21 candles)
  - [x] 4.10 Test: constructor validates config
  - [x] 4.11 Test: `updateStopLoss` on position-manager — updates on-chain + in-memory + DB (tested indirectly via momentum trailing stop tests)
  - [x] 4.12 Test: broadcasts MODE_ACTIVITY with correct pair entries each iteration

- [x] Task 5: Verification
  - [x] 5.1 All tests pass (`pnpm test`) — 788 tests, 38 files, 0 failures
  - [x] 5.2 Momentum card appears on dashboard with orange color (self-registration with modeColor: "#f97316")
  - [x] 5.3 No regressions in other strategies

## Config Parameters

| Param | Default | Description |
|-------|---------|-------------|
| `pairs` | required | Pairs to monitor |
| `fastEmaPeriod` | 9 | Fast EMA lookback periods |
| `slowEmaPeriod` | 21 | Slow EMA lookback periods |
| `rsiPeriod` | 14 | RSI confirmation periods |
| `trailingStopPct` | 0.03 (3%) | Trailing stop distance from peak |
| `iterationIntervalMs` | 30,000 (30s) | Polling interval |
| `slippage` | 0.5% | Max fill slippage |
| `positionSize` | dynamic (alloc/20) | Per-position size |

## Dev Notes

### Key Files

- `src/server/blockchain/oracle.ts` — Add `getEma()` delegate (reuse candles from 8-13)
- `src/server/blockchain/candle-aggregator.ts` — Add `getEma()` calculation over candle close prices
- `src/server/engine/position-manager.ts` — Add `updateStopLoss()` method for trailing stop
- `src/server/engine/strategies/momentum.ts` — New strategy (create)
- `src/server/engine/strategies/momentum.test.ts` — New tests (create)
- `src/server/engine/index.ts` — Import for registration

### Dependencies

- **Story 8-13** must be implemented first — momentum reuses the oracle candle aggregation and RSI infrastructure. EMA is added on top.

### Reusable Patterns

- Strategy structure from `profit-hunter.ts` / `arbitrage.ts`
- Self-registration pattern
- Oracle candle + RSI infrastructure from Story 8-13
- Position manager open/close/getPositions
- Activity log broadcast (MODE_ACTIVITY) from Story 8-10

### Implementation Order (Full Suite)

1. **8-11** Funding Rate Arb — lowest risk, proven, modifies existing
2. **8-13** Improved Profit Hunter (RSI) — adds candle + RSI infra to oracle
3. **8-14** Momentum (this story) — builds on 8-13's infra, adds EMA + trailing stop
4. **8-12** Grid Trading — independent, no indicator dependencies

## Dev Agent Record

### Implementation Plan

- Added `calculateEma()` export to candle-aggregator and `getEma()` delegate methods on both CandleAggregator and OracleClient
- Added `updateStopLoss()` to PositionManager with never-backward enforcement (Long: stop only increases, Short: stop only decreases), on-chain + in-memory + DB updates
- Created MomentumStrategy extending ModeRunner with EMA crossover detection, RSI confirmation filter, trailing stop management, and activity log broadcasting
- Added `closed-crossover` and `stop-updated` outcomes to ActivityPairEntry union type
- Self-registered momentum strategy with orange color (#f97316)

### Completion Notes

All 5 tasks complete. EMA calculation uses SMA seed + exponential smoothing. Crossover detection tracks previous fast-vs-slow EMA relationship per pair and fires on state change. RSI confirmation prevents false signals. Trailing stop tracks peak price per position and calls updateStopLoss only when price reaches new extreme. 788 tests pass across 38 files with zero regressions.

### Debug Log

No issues encountered during implementation.

## File List

- `src/server/blockchain/candle-aggregator.ts` — Added `calculateEma()` function and `getEma()` method
- `src/server/blockchain/candle-aggregator.test.ts` — Added EMA unit tests (calculateEma + CandleAggregator.getEma)
- `src/server/blockchain/oracle.ts` — Added `getEma()` delegate method
- `src/server/engine/position-manager.ts` — Added `updateStopLoss()` method with never-backward enforcement
- `src/server/engine/strategies/momentum.ts` — New file: MomentumStrategy class + self-registration
- `src/server/engine/strategies/momentum.test.ts` — New file: 20 tests covering all ACs
- `src/server/engine/index.ts` — Added momentum strategy import for registration
- `src/shared/events.ts` — Added `closed-crossover` and `stop-updated` to ActivityPairEntry outcome union

### Review Findings

- [x] [Review][Patch] CRITICAL: `DEFAULT_MAX_CANDLES=20` makes `getEma(key, 21)` always return null in production — increased to 50 [candle-aggregator.ts:24]
- [x] [Review][Patch] Trailing stop map leaks memory — added reconciliation pruning at start of executeIteration [momentum.ts:122-126]
- [x] [Review][Patch][Dismissed] Duplicate activity entry on `updateStopLoss` throw — false positive, existing `continue` on line 196 already prevents fallthrough
- [x] [Review][Patch][Dismissed] Factory config forwarding — pre-existing architectural limitation in StrategyDeps.config type, not momentum-specific
- [x] [Review][Patch] `calculateEma()` has no guard for `period <= 0` — added guard + test [candle-aggregator.ts:138]
- [x] [Review][Patch] In-memory stop-loss DB write failure now logs with `STOP_LOSS_DB_DESYNC` code for alerting [position-manager.ts:865-875]
- [x] [Review][Dismissed] Crossover state lost on restart — false positive, `prevAbove === null` guard already prevents spurious signals on first post-restart iteration
- [x] [Review][Patch] Close-then-reopen whipsaw prevention — pairs closed in Phase 1 are now skipped in Phase 2 [momentum.ts:218]

## Change Log

- 2026-04-09: Code review complete — 5 patches, 3 deferred, 4 dismissed
- 2026-04-08: Story 8-14 implemented — Momentum/Trend-Following strategy with EMA crossover + RSI confirmation + trailing stop
