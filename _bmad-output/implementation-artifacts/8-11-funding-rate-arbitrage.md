# Story 8.11: Funding Rate Arbitrage

Status: done

## Story

As theRoad,
I want the Arbitrage strategy to collect funding rate payments by taking the opposite side of the paying direction,
So that I can earn a reliable, low-risk yield on Hyperliquid perpetuals instead of chasing rare oracle-vs-mid-price spread events.

## Problem

The current Arbitrage strategy detects cross-market price divergences between Pyth oracle spot prices and Hyperliquid perpetual mid-prices. In practice, these divergences rarely exceed the 0.5% threshold, making the strategy idle most of the time. Funding rate arbitrage is a proven, lower-risk approach (4-21% APY) that collects hourly funding payments by positioning on the receiving side.

## Background

### How Hyperliquid Funding Works

- Funding is paid **hourly** (1/8 of the computed 8-hour rate each hour)
- **Positive rate**: longs pay shorts (contract trading above spot)
- **Negative rate**: shorts pay longs (contract trading below spot)
- Payment = `position_size x oracle_price x funding_rate`
- Rate capped at 4%/hour
- Premium sampled every 5 seconds, averaged over each hour

### Hyperliquid API

- `InfoClient.predictedFundings()` — returns predicted funding rates across venues with next funding times
- `InfoClient.fundingHistory({ coin, startTime })` — returns historical funding rates
- `InfoClient.userFunding({ user, startTime })` — returns user's funding payment history

### Key Differences from Current Arbitrage

| Aspect | Current Arbitrage | Funding Rate Arb |
|--------|------------------|-----------------|
| Signal | Oracle-vs-mid spread | Predicted funding rate |
| Direction | Spread direction | Opposite of paying side |
| Hold time | Seconds-minutes | Hours (funding accrual) |
| Close trigger | Spread converges | Rate flips or drops below threshold |
| API needed | `allMids()` (exists) | `predictedFundings()` (new) |
| Interval | 3s | 30s (rates change slowly) |
| Risk | Spread widens further | Price moves against position |

## Acceptance Criteria

1. **Given** a predicted funding rate > 0.01% for a pair, **When** the strategy iterates, **Then** it opens a Short position (collect from longs paying shorts).
2. **Given** a predicted funding rate < -0.01% for a pair, **When** the strategy iterates, **Then** it opens a Long position (collect from shorts paying longs).
3. **Given** an open position where the funding rate has flipped sign, **When** the strategy iterates, **Then** it closes the position.
4. **Given** an open position where the rate has dropped below closeRateThreshold, **When** the strategy iterates, **Then** it closes the position.
5. **Given** an open position held for less than minHoldTimeMs (1 hour), **When** the rate drops, **Then** it does NOT close (wait for at least one funding payment).
6. **Given** the strategy needs predicted funding rates, **When** it fetches from the API, **Then** it uses `InfoClient.predictedFundings()` via the blockchain client.
7. **Given** a position is opened, **When** the stop-loss is set, **Then** it is 2% from entry price (tighter than current 3%).
8. **Given** all changes are made, **When** running `pnpm test`, **Then** all existing and new tests pass.
9. **Given** the strategy is registered, **When** it appears on the dashboard, **Then** it keeps the same mode type ("arbitrage"), slug, and color as the current strategy.

## Tasks / Subtasks

- [x] Task 1: Add funding rate API method to blockchain client (AC: 6)
  - [x] 1.1 Add `getPredictedFundings()` to `src/server/blockchain/client.ts` — calls `InfoClient.predictedFundings()` via `withRetry()`. The SDK returns `[asset: string, exchanges: [exchange: string, data: { fundingRate: string; nextFundingTime: number; fundingIntervalHours?: number } | null][]][]`. This wrapper must: (a) filter for the `"Hyperliquid"` exchange entry per asset, (b) parse `fundingRate` from string to number via `parseFloat()`, (c) return `Map<string, { rate: number; nextFundingTime: number }>` keyed by asset symbol (e.g., `"ETH"`, `"BTC"`)
  - [x] 1.2 Add unit tests for `getPredictedFundings()` — mock SDK response with multi-exchange tuples, verify Hyperliquid filtering and string→number parsing

- [x] Task 2: Extend StrategyDeps and wire dependency in engine (AC: 6)
  - [x] 2.1 Add `getPredictedFundings?: () => Promise<Map<string, { rate: number; nextFundingTime: number }>>` to `StrategyDeps` interface in `src/server/engine/strategy-registry.ts`
  - [x] 2.2 In `src/server/engine/index.ts` `startMode()`, build `getPredictedFundingsFn` from `bcClient.info` by calling the new `getPredictedFundings()` wrapper from `client.ts`, and pass it into the `StrategyDeps` object alongside existing deps (lines ~132-139). This is analogous to how `getMidPriceFn` is built today

- [x] Task 3: Rewrite ArbitrageStrategy as FundingArbitrageStrategy (AC: 1-5, 7, 9)
  - [x] 3.1 Replace `ArbitrageConfig` with `FundingArbitrageConfig`: `rateThreshold`, `closeRateThreshold`, `minHoldTimeMs`, `iterationIntervalMs`, `slippage`, `positionSize`, `pairs`
  - [x] 3.2 Replace `executeIteration()` Phase 1: check open positions for rate flip/drop below closeRateThreshold, respect minHoldTimeMs
  - [x] 3.3 Replace `executeIteration()` Phase 2: scan pairs for high predicted rates, open positions on receiving side
  - [x] 3.4 Track position open timestamps for minHoldTime enforcement
  - [x] 3.5 Change stop-loss from 3% to 2%
  - [x] 3.6 Change iteration interval default from 3s to 30s
  - [x] 3.7 Update strategy self-registration: keep modeType `"arbitrage"`, urlSlug `"arbitrage"`, modeColor `"#a855f7"`. Change `requires` to `{ oracle: false, blockchain: true }` (no longer needs Pyth oracle). Update name to `"Funding Rate Arbitrage"` and description accordingly
  - [x] 3.8 Remove dependency on `getMidPrice` and `oracleClient` from the strategy class — remove constructor params, remove factory guards for these deps. Add factory guard for `getPredictedFundings` (throw `MISSING_DEPENDENCY` AppError if absent). Do NOT remove `getMidPrice` or `oracleClient` from the `StrategyDeps` interface — other strategies may use them

- [x] Task 4: Rewrite tests (AC: 8)
  - [x] 4.1 Rewrite `src/server/engine/strategies/arbitrage.test.ts` for funding rate logic
  - [x] 4.2 Test: opens Short on positive rate above threshold
  - [x] 4.3 Test: opens Long on negative rate above threshold
  - [x] 4.4 Test: closes when rate flips sign
  - [x] 4.5 Test: closes when rate drops below closeRateThreshold
  - [x] 4.6 Test: does NOT close before minHoldTimeMs
  - [x] 4.7 Test: skips when rate below threshold
  - [x] 4.8 Test: stop-loss at 2%
  - [x] 4.9 Test: existing constructor validations still work

- [x] Task 5: Verification
  - [x] 5.1 All tests pass (`pnpm test`)
  - [x] 5.2 Strategy appears on dashboard with same arbitrage card
  - [x] 5.3 No regressions in other strategies

### Review Findings

- [x] [Review][Decision] `positionOpenTimes` lost on restart — resolved: `position.timestamp` DB field IS the open time, fallback is correct as-is
- [x] [Review][Decision] `getMidPrice` still optional dependency — resolved: intentional; stop-loss is mandatory per safety rules and needs a price reference, making getMidPrice optional-but-used is the correct design
- [x] [Review][Patch] `parseFloat` NaN not validated on funding rate — fixed: added `Number.isFinite(rate)` guard in `getPredictedFundings` [client.ts:337]
- [x] [Review][Patch] No runtime validation on raw API response shape — fixed: added `Array.isArray` checks and structural validation before destructuring [client.ts:331-340]
- [x] [Review][Patch] Empty fundingRates Map silently skips all logic — fixed: added `logger.warn` when fundingRates is empty [arbitrage.ts:117]
- [x] [Review][Patch] Mid-price zero/NaN not validated before stop-loss calculation — fixed: added `Number.isFinite(midFloat) && midFloat > 0` guard [arbitrage.ts:196]
- [x] [Review][Patch] `positionOpenTimes` never cleaned for externally closed positions — fixed: added cleanup loop at start of Phase 1 [arbitrage.ts:121-125]
- [x] [Review][Patch] Swallowed error in mid-price catch block — fixed: captured error variable and passed to logger [arbitrage.ts:211]
- [x] [Review][Defer] No caching on `getPredictedFundings` calls — resolved: added 10s TTL cache [client.ts:323]
- [x] [Review][Defer] Strategy stopped mid-iteration leaves pending async calls — resolved: added `_stopped` flag with `onStop()` hook and Phase boundary checks [arbitrage.ts]

## Dev Notes

### Key Files

- `src/server/blockchain/client.ts` — Add `getPredictedFundings()` wrapper
- `src/server/engine/strategy-registry.ts` — Extend StrategyDeps with `getPredictedFundings?`
- `src/server/engine/strategies/arbitrage.ts` — Rewrite to funding rate arbitrage
- `src/server/engine/strategies/arbitrage.test.ts` — Rewrite tests
- `src/server/engine/index.ts` — Wire `getPredictedFundingsFn` into StrategyDeps

### Reusable Patterns

- `withRetry()` from `src/server/blockchain/client.ts` for API calls
- `ModeRunner` lifecycle from `src/server/engine/mode-runner.ts`
- Activity log broadcast pattern from Story 8-10 (`EVENTS.MODE_ACTIVITY`)

### API Reference

- Hyperliquid `predictedFundings`: POST `https://api.hyperliquid.xyz/info` with `{ type: "predictedFundings" }`
- SDK type: `PredictedFundingsResponse = [asset: string, exchanges: [exchange: string, data: { fundingRate: string; nextFundingTime: number; fundingIntervalHours?: number } | null][]][]`
- Returns predicted rates across venues (Binance, Bybit, Hyperliquid) with next funding times
- `fundingRate` is a **string** (e.g., `"0.00012"`) — must `parseFloat()` before use
- Filter for exchange name `"Hyperliquid"` to get the relevant rate
- `@nktkas/hyperliquid` SDK: `InfoClient.predictedFundings()` (no params) and `InfoClient.userFunding({ user, startTime?, endTime? })`

## Dev Agent Record

### Implementation Plan

Rewrote the Arbitrage strategy from oracle-vs-mid-price spread detection to funding rate arbitrage. The new strategy:
1. Fetches predicted funding rates via `InfoClient.predictedFundings()`
2. Opens Short when positive rate (longs pay shorts), Long when negative rate (shorts pay longs)
3. Closes positions when rate flips sign or drops below threshold
4. Respects 1-hour minimum hold time to collect at least one funding payment
5. Uses 2% stop-loss (tighter than previous 3%)
6. Iterates every 30s (was 3s) since funding rates change slowly

### Debug Log

No issues encountered during implementation.

### Completion Notes

- Added `getPredictedFundings()` to blockchain client with Hyperliquid exchange filtering and string→number parsing
- Extended `StrategyDeps` interface with optional `getPredictedFundings` field
- Wired `getPredictedFundingsFn` in engine's `startMode()` analogous to existing `getMidPriceFn`
- Completely rewrote `ArbitrageStrategy` class — replaced spread-based logic with funding rate-based logic
- Strategy keeps `modeType: "arbitrage"`, `urlSlug: "arbitrage"`, `modeColor: "#a855f7"` for dashboard compatibility
- Changed `requires` from `{ oracle: true, blockchain: true }` to `{ oracle: false, blockchain: true }`
- Factory guard now checks for `getPredictedFundings` (not oracle/getMidPrice)
- `getMidPrice` is still passed through optionally for stop-loss calculation but not required
- Rewrote all 31 tests covering: Short on positive rate, Long on negative rate, rate flip close, rate drop close, minHoldTime enforcement, rate threshold skipping, 2% stop-loss, constructor validations
- Updated `strategy-registry.test.ts` for new `requires` value
- Updated `index.test.ts` for oracle-not-required behavior and added `getPredictedFundings` mock
- Full test suite: 740 tests pass, 0 failures, 0 regressions

## File List

- `src/server/blockchain/client.ts` — Added `getPredictedFundings()` function
- `src/server/blockchain/client.test.ts` — Added 4 tests for `getPredictedFundings()`
- `src/server/engine/strategy-registry.ts` — Added `getPredictedFundings?` to `StrategyDeps`
- `src/server/engine/index.ts` — Added `getPredictedFundings` import and wiring in `startMode()`
- `src/server/engine/strategies/arbitrage.ts` — Complete rewrite to funding rate arbitrage
- `src/server/engine/strategies/arbitrage.test.ts` — Complete rewrite with 31 funding rate tests
- `src/server/engine/strategy-registry.test.ts` — Updated `requires` assertion for arbitrage
- `src/server/engine/index.test.ts` — Updated arbitrage test and added `getPredictedFundings` mock

## Change Log

- 2026-04-08: Rewrote Arbitrage strategy from oracle spread detection to funding rate arbitrage (Story 8-11)
