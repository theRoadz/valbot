# Story 8.13: Improved Profit Hunter (RSI + Longer Timeframes)

Status: done

## Story

As theRoad,
I want Profit Hunter to use RSI-based signals with longer timeframes instead of 5-minute SMA deviation,
So that the strategy actually triggers in normal market conditions and produces more reliable mean-reversion signals.

## Problem

Current Profit Hunter uses a 5-minute SMA with a 1% deviation threshold. A 1% move in 5 minutes is rare for BTC, ETH, and SOL under normal conditions, so the strategy sits idle almost all the time. When it does trigger, it's typically during extreme events where mean-reversion is least reliable.

Research shows mean-reversion on perpetual futures works better with:
- **RSI (Relative Strength Index)** — normalizes momentum across different volatility regimes
- **Longer timeframes** (5-min candles over 14 periods = 70 min of context)
- **Standard overbought/oversold thresholds** (70/30) that are well-tested across markets

## Background

### RSI Calculation

```
RSI = 100 - (100 / (1 + RS))
RS  = Average Gain over N periods / Average Loss over N periods
```

With 14-period RSI on 5-minute candles:
- RSI < 30 → oversold (price dropped too fast, expect bounce)
- RSI > 70 → overbought (price rose too fast, expect pullback)
- RSI ~ 50 → neutral (mean-reverted)

### Why RSI > Raw Deviation

| Aspect | MA Deviation (current) | RSI (proposed) |
|--------|----------------------|----------------|
| Trigger frequency | Very rare (1% in 5 min) | Regular (RSI extremes happen daily) |
| False signals | High (news events) | Lower (normalized for volatility) |
| Warm-up time | 30 seconds | 70 minutes (14 x 5-min candles) |
| Close signal | Deviation < 0.3% | RSI crosses 50 |
| Market adaptability | None | Self-adjusting to volatility |

### Oracle Data

The oracle client already streams prices every ~5 seconds. We need to:
- Aggregate these into 5-minute OHLC candles
- Calculate RSI(14) from the close prices of the last 14 candles
- Warm-up: 14 candles x 5 min = 70 minutes before first signal

## Acceptance Criteria

1. **Given** the oracle has 14+ candles of data, **When** RSI(14) drops below 30, **Then** the strategy opens a Long position (oversold).
2. **Given** the oracle has 14+ candles of data, **When** RSI(14) rises above 70, **Then** the strategy opens a Short position (overbought).
3. **Given** an open Long position, **When** RSI crosses above 50, **Then** the strategy closes the position (mean reverted).
4. **Given** an open Short position, **When** RSI crosses below 50, **Then** the strategy closes the position (mean reverted).
5. **Given** the oracle has fewer than 14 candles, **When** the strategy iterates, **Then** it skips signal generation (warm-up period).
6. **Given** the oracle client, **When** prices stream in, **Then** they are aggregated into configurable-period OHLC candles.
7. **Given** a complete set of candles, **When** `getRsi()` is called, **Then** it returns a correct RSI(14) value.
8. **Given** the activity log is active, **When** the strategy iterates, **Then** each pair shows its current RSI value and outcome.
9. **Given** all changes are made, **When** running `pnpm test`, **Then** all updated and new tests pass.

## Tasks / Subtasks

- [x] Task 1: Add candle aggregation to oracle client (AC: 6, 7)
  - [x] 1.1 Add candle data structure: `{ open, high, low, close, timestamp }` (smallest-unit integers)
  - [x] 1.2 Add `CandleAggregator` class in new file `src/server/blockchain/candle-aggregator.ts` that accumulates price samples into period-based candles
  - [x] 1.3 Store rolling window of candles per feed (configurable count, default 20)
  - [x] 1.4 Add `getCandles(oracleKey, periodMs, count)` method to oracle client
  - [x] 1.5 Add `getRsi(oracleKey, periodMs, periods)` method — calculates RSI from candle close prices
  - [x] 1.6 Unit tests for candle aggregation and RSI calculation in `src/server/blockchain/candle-aggregator.test.ts`

- [x] Task 2: Rewrite Profit Hunter strategy to use RSI (AC: 1-5, 8)
  - [x] 2.1 Replace `ProfitHunterConfig` fields: remove `deviationThreshold`, `closeThreshold`; add `rsiPeriod`, `candlePeriodMs`, `oversoldThreshold`, `overboughtThreshold`, `exitRsi`
  - [x] 2.2 Replace `executeIteration()` Phase 1: check open positions — close Long if RSI > exitRsi, close Short if RSI < exitRsi
  - [x] 2.3 Replace `executeIteration()` Phase 2: scan pairs — open Long if RSI < oversoldThreshold, open Short if RSI > overboughtThreshold
  - [x] 2.4 Handle warm-up: skip pair if `getRsi()` returns null (insufficient candles)
  - [x] 2.5 Change default iteration interval from 5s to 30s (RSI changes slowly)
  - [x] 2.6 Keep existing stop-loss logic (3%)
  - [x] 2.6b Handle config migration: strip old `deviationThreshold`/`closeThreshold` from stored configs and apply RSI defaults on load
  - [x] 2.7 Rename `deviationPct` to `signalValue` in `ActivityPairEntry` (shared/events.ts) — field now carries RSI (0-100), not a deviation percentage
  - [x] 2.8 Update activity log to show RSI value using the renamed `signalValue` field

- [x] Task 3: Update mode card UI (AC: 8)
  - [x] 3.1 Add RSI parameter inputs (rsiPeriod, oversoldThreshold, overboughtThreshold, exitRsi) to Profit Hunter config section in mode-card.tsx (no deviation inputs exist to replace)
  - [x] 3.2 Add validation for RSI params (0-100 range, oversold < overbought)

- [x] Task 4: Rewrite Profit Hunter tests (AC: 9)
  - [x] 4.1 Rewrite `profit-hunter.test.ts` for RSI-based logic (candle/RSI tests already covered in Task 1.6)
  - [x] 4.4 Test: opens Long when RSI < 30
  - [x] 4.5 Test: opens Short when RSI > 70
  - [x] 4.6 Test: closes Long when RSI > 50
  - [x] 4.7 Test: closes Short when RSI < 50
  - [x] 4.8 Test: skips during warm-up (insufficient candles)
  - [x] 4.9 Test: activity log reports RSI values

- [x] Task 5: Verification
  - [x] 5.1 All tests pass (`pnpm test`)
  - [x] 5.2 Profit Hunter card shows updated config inputs
  - [x] 5.3 Activity log shows RSI values per pair

### Review Findings

- [x] [Review][Decision] `exitRsi` cross-field validation — resolved: validate `oversold < exitRsi < overbought` in constructor, API, and UI
- [x] [Review][Patch] RSI config defaults hardcoded in status.ts — fixed: reads from running strategy config via `getModeRunnerConfig()`, falls back to defaults
- [x] [Review][Patch] API missing cross-field validation for RSI thresholds — fixed: added cross-field validation in mode.ts endpoint
- [x] [Review][Patch] `defaultValue` stale in RsiConfigInputs — fixed: keyed on `${field}-${value}` to force remount on external changes
- [x] [Review][Patch] `calculateRsi` returns 100 for flat prices — fixed: returns 50 when both avgGain and avgLoss are 0
- [x] [Review][Defer→Fixed] Gap candles: large timestamp jumps now fill intermediate periods with flat candles (last close) to keep RSI history contiguous
- [x] [Review][Defer→Fixed] Out-of-order timestamps from Pyth: samples with earlier timestamps than pending candle are now silently rejected
- [x] [Review][Defer→Fixed] Stop-loss widened from 3% to 5% default, made configurable via `stopLossPct` in ProfitHunterConfig

## Dev Notes

### Key Files

- `src/server/blockchain/candle-aggregator.ts` — New: candle aggregation + RSI calculation
- `src/server/blockchain/candle-aggregator.test.ts` — New: tests for candle/RSI
- `src/server/blockchain/oracle.ts` — Wire CandleAggregator into price stream, expose `getCandles()`/`getRsi()`
- `src/server/engine/strategies/profit-hunter.ts` — Replace MA deviation with RSI signals
- `src/server/engine/strategies/profit-hunter.test.ts` — Rewrite tests
- `src/shared/events.ts` — May need to update `ActivityPairEntry` for RSI
- `src/client/components/mode-card.tsx` — Update config inputs

### Breaking Changes

This is a breaking change to Profit Hunter's signal logic. The old MA deviation approach (deviationThreshold, closeThreshold) is replaced entirely with RSI parameters. Config stored in DB will need to be compatible or reset.

### RSI Reference Implementation

```typescript
function calculateRsi(closes: number[], period: number): number | null {
  if (closes.length < period + 1) return null; // Need period+1 prices for period changes

  let avgGain = 0;
  let avgLoss = 0;

  // Initial average from first `period` changes
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;

  // Smoothed for remaining
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) {
      avgGain = (avgGain * (period - 1) + change) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.abs(change)) / period;
    }
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}
```

### Reusable Patterns

- Activity log instrumentation from Story 8-10
- Oracle client streaming pattern from `src/server/blockchain/oracle.ts`
- Strategy structure from current profit-hunter.ts

## File List

### New Files
- `src/server/blockchain/candle-aggregator.ts` — CandleAggregator class + calculateRsi utility
- `src/server/blockchain/candle-aggregator.test.ts` — 16 tests for candle aggregation and RSI calculation

### Modified Files
- `src/server/blockchain/oracle.ts` — Wired CandleAggregator into price stream, added getCandles()/getRsi() methods
- `src/server/engine/strategies/profit-hunter.ts` — Complete rewrite: MA deviation → RSI-based signals, new config interface
- `src/server/engine/strategies/profit-hunter.test.ts` — Complete rewrite: 32 tests for RSI-based logic
- `src/shared/events.ts` — Renamed `deviationPct` → `signalValue` in ActivityPairEntry
- `src/shared/types.ts` — Added optional RSI config fields to ModeConfig
- `src/client/components/mode-card.tsx` — Added RsiConfigInputs component for Profit Hunter
- `src/client/components/activity-log.tsx` — Updated signal display from deviation% to RSI value
- `src/client/components/activity-log.test.tsx` — Updated tests for signalValue field and RSI display
- `src/client/store/index.test.ts` — Updated signalValue references
- `src/client/lib/api.ts` — Added RSI config fields to updateModeConfig
- `src/server/api/mode.ts` — Added RSI config params to PUT /api/mode/:mode/config
- `src/server/api/status.ts` — Added RSI defaults to profitHunter status response

## Change Log

- 2026-04-08: Replaced Profit Hunter MA deviation logic with RSI(14) on 5-minute candles. Added CandleAggregator, rewired oracle, updated all tests, UI, and API.

## Dev Agent Record

### Implementation Plan
1. Created CandleAggregator class with OHLC candle formation and RSI calculation
2. Wired aggregator into OracleClient price stream, exposed getCandles()/getRsi()
3. Rewrote ProfitHunterStrategy: RSI < 30 → Long, RSI > 70 → Short, exit at RSI 50
4. Renamed ActivityPairEntry.deviationPct → signalValue across shared/client/server
5. Added RSI config inputs to mode-card.tsx with cross-field validation
6. Rewrote all profit-hunter tests for RSI logic
7. Extended ModeConfig, API, and status endpoint for RSI params

### Debug Log
- RSI smoothing test initially failed — test expectation assumed stronger mean-reversion than smoothed RSI produces. Fixed by using a stronger downtrend in test data.

### Completion Notes
- All 755 tests pass (37 files), zero regressions
- Config migration (Task 2.6b): Old deviationThreshold/closeThreshold fields are not stored in DB — the strategy factory receives generic config (pairs, slippage, positionSize) from StrategyDeps. No migration needed; old fields simply no longer exist in ProfitHunterConfig.
- Default iteration interval changed from 5s to 30s (RSI changes slowly on 5-min candles)
- Stop-loss logic preserved at 3%
- Activity log now shows "RSI 45.5" instead of "dev +1.50%"
