# Story 8.20: Backfill Historical Candles on Oracle Startup

Status: complete

## Story

As theRoad,
I want the oracle to backfill historical candles from Pyth on startup,
So that strategies can evaluate signals immediately without a ~105 minute warmup.

## Problem

The CandleAggregator builds 5-minute candles only from the live Pyth SSE stream. The Momentum strategy's EMA(21) indicator requires 21 completed candles before it can produce a value, meaning ~105 minutes of live data must accumulate before the first signal evaluation is possible. This makes the bot unusable for the first 1.5+ hours after every restart.

### Root Cause

- `OracleClient.connect()` starts streaming live prices via SSE but never seeds the CandleAggregator with historical data
- The `@pythnetwork/hermes-client` HermesClient provides `getPriceUpdatesAtTimestamp(publishTime, ids, options)` for historical price lookups, but it's unused
- The CandleAggregator's `addPrice()` accepts any chronologically ordered prices — no distinction between live and historical

## Background

### Current flow (slow warmup)

1. Oracle connects → starts receiving live SSE prices
2. Each price update feeds into `candleAggregator.addPrice()` building 5-min candles
3. After ~105 minutes, 21 candles are complete → EMA(21) returns a value
4. Strategy can finally evaluate crossover signals

### Correct flow (immediate readiness)

1. Oracle connects → HermesClient created
2. **Backfill**: Fetch 25 historical prices at 5-min intervals (125 min back) via `getPriceUpdatesAtTimestamp()`
3. Feed historical prices into CandleAggregator in chronological order → 25 candles built instantly
4. Start SSE stream → live prices continue building new candles
5. Strategy can evaluate signals on first iteration

## Acceptance Criteria

1. **Given** the oracle connects, **When** `connect()` completes, **Then** the candle aggregator has >=21 completed candles per subscribed pair.
2. **Given** a single historical fetch fails, **When** other fetches succeed, **Then** backfill continues with remaining timestamps (graceful degradation).
3. **Given** backfill fails completely, **When** SSE stream setup runs, **Then** it still connects normally (backfill failure is non-blocking).
4. **Given** all changes are made, **When** running `pnpm test`, **Then** all tests pass.

## Tasks / Subtasks

- [x] Task 1: Add `backfillCandles` private method to OracleClient in `oracle.ts`
  - [x] 1.1 Calculate 25 timestamps going back 125 minutes at 5-min intervals (oldest first)
  - [x] 1.2 For each timestamp, call `hermesClient.getPriceUpdatesAtTimestamp(timestampSec, feedIds, { parsed: true })`
  - [x] 1.3 Parse response using same conversion as `handleMessage()` (rawPrice x 10^expo x 1e6)
  - [x] 1.4 Feed into `candleAggregator.addPrice()` — do NOT call `updatePrice()` (stale guard rejects historical prices)
  - [x] 1.5 Per-fetch try/catch — log warning on failure, continue with remaining timestamps
  - [x] 1.6 Outer try/catch — total failure logs error but doesn't throw
  - [x] 1.7 Log summary: "Backfilled N candles for M pairs"

- [x] Task 2: Integrate backfill in `connect()` method
  - [x] 2.1 Call `await this.backfillCandles(feedIds)` after `this.hermesClient = new HermesClient(...)` and before SSE `getPriceUpdatesStream()`

- [x] Task 3: Add unit tests in `oracle.test.ts`
  - [x] 3.1 Happy path: Mock `getPriceUpdatesAtTimestamp` → verify candle aggregator has >=21 candles after connect
  - [x] 3.2 Partial failure: One fetch throws → verify other candles still populated
  - [x] 3.3 Total failure: All fetches throw → verify SSE stream still connects normally
  - [x] 3.4 Multi-pair backfill: Both SOL and BTC candles populated

## Dev Notes

### Key Files

- `src/server/blockchain/oracle.ts` — Add `backfillCandles()` method + integrate in `connect()`
- `src/server/blockchain/oracle.test.ts` — Add backfill tests
- `src/server/blockchain/candle-aggregator.ts` — No changes (existing `addPrice()` handles this)

### SDK API Used

- `hermesClient.getPriceUpdatesAtTimestamp(publishTimeSec, feedIds, { parsed: true })` — returns prices at a specific historical timestamp

### Do NOT

- Do NOT call `updatePrice()` with historical prices — the stale guard (30s threshold) would reject them
- Do NOT modify the CandleAggregator — it already handles chronological price insertion correctly
- Do NOT block SSE connection if backfill fails — wrap in try/catch
- Do NOT change candle period (5 min) or indicator defaults

## Dev Agent Record

- Added `BACKFILL_CANDLE_COUNT = 25` constant to oracle.ts
- Added `backfillCandles(feedIds)` private async method that fetches historical prices from Pyth REST API at 5-min intervals going back 125 minutes, oldest first
- Price conversion reuses same logic as `handleMessage()`: `rawPrice * 10^expo * 1e6 = smallest-unit`
- Only feeds into `candleAggregator.addPrice()` — does NOT call `updatePrice()` since stale guard would reject historical prices
- Per-fetch try/catch logs warning and continues; outer try/catch ensures total failure doesn't block SSE connection
- Integrated call in `connect()` between HermesClient creation and SSE stream setup
- Added `getPriceUpdatesAtTimestamp` to mock HermesClient in tests
- Added 4 test cases: happy path (25 fetches → ≥21 candles), partial failure (1 fetch fails → ≥20 candles), total failure (SSE still connects), multi-pair backfill
- Pre-existing test failure in `getFeedEntry` is unrelated (confirmed by running tests on stashed changes)

### Review Findings

- [x] [Review][Decision] **Backfill blocks SSE stream startup** — Fixed: moved backfill to fire-and-forget after SSE setup. Live prices flow immediately. [oracle.ts:126-130]
- [x] [Review][Decision] **Backfill re-runs on every reconnect** — Fixed: added `backfillDone` flag, skipped on reconnects. Added test "skips backfill on reconnect". [oracle.ts:54,136]
- [x] [Review][Decision] **Single price sample per candle produces flat OHLC** — Accepted as-is with code comment documenting the limitation. [oracle.ts:133-135]
- [x] [Review][Patch] **`backfilledCount` counts fetches, not candles** — Fixed: renamed to `insertedCount`, increments per `addPrice` call. [oracle.ts:138]
- [x] [Review][Patch] **Log message doesn't interpolate counts into string** — Fixed: message now reads "Backfilled N candle samples for M pairs". [oracle.ts:176]
- [x] [Review][Patch] **Unused variable `pairsReceived`** — Fixed: removed. [oracle.test.ts]
- [x] [Review][Defer] **`parseInt` on Pyth price field can lose precision for very large values** — Pre-existing pattern from `handleMessage()` (line 134). Not introduced by this change. — deferred, pre-existing
- [x] [Review][Defer] **Floating-point intermediate arithmetic may lose precision** — Pre-existing pattern from `handleMessage()`. The `rawPrice * Math.pow(10, expo) * 1e6` chain is copied from existing code. — deferred, pre-existing
- [x] [Review][Defer] **Errors logged raw rather than wrapped in AppError** — The backfill intentionally swallows errors (graceful degradation). Using AppError for logged-but-not-thrown errors is debatable. Matches existing `handleMessage` pattern. — deferred, pre-existing

## File List

- `src/server/blockchain/oracle.ts` — Added `backfillCandles()` method + `BACKFILL_CANDLE_COUNT` constant + call in `connect()`
- `src/server/blockchain/oracle.test.ts` — Added mock for `getPriceUpdatesAtTimestamp` + 4 backfill test cases
- `_bmad-output/implementation-artifacts/8-20-backfill-oracle-candles.md` — This story file
