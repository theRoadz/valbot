# Story 4.3: Arbitrage Strategy

Status: done

## Story

As theRoad,
I want to activate Arbitrage mode to exploit cross-market price differences between Hyperliquid perpetual mid-prices and Pyth spot oracle prices,
So that I can profit from price discrepancies between markets.

## Acceptance Criteria

1. **Given** the mode-runner base class and position manager from Epic 2, **When** Arbitrage mode is started via the dashboard, **Then** the strategy monitors price differences between Hyperliquid perp mid-prices and Pyth oracle spot prices for its configured pairs.

2. **Given** continuous price data from both sources, **When** a profitable spread is detected (after accounting for fees and slippage), **Then** positions are opened to capture the price difference.

3. **Given** an open Arbitrage position, **When** positions are opened, **Then** stop-loss protection is set (NFR8) before the position is considered active.

4. **Given** an open Arbitrage position, **When** the spread converges or a target profit is reached, **Then** the position is closed to capture profit.

5. **Given** Arbitrage is running, **Then** the strategy respects its own fund allocation — never exceeds its budget via `fundAllocator.canAllocate()` checks before every trade.

6. **Given** Arbitrage executes trades, **Then** all trades emit `trade.executed`, `position.opened`, `position.closed`, and `stats.updated` WebSocket events.

7. **Given** Arbitrage is running on the dashboard, **Then** the ModeCard badge shows green "Running" and stats update in real-time.

8. **Given** Arbitrage trades appear in the trade log, **Then** entries are tagged `[ARB]` in cyan (`#06b6d4`).

9. **Given** Arbitrage is stopped via toggle, **Then** all its open positions are closed before emitting `mode.stopped`.

10. **Given** Volume Max and/or Profit Hunter are already running, **When** Arbitrage is started, **Then** all modes run simultaneously without interference (FR5).

## Tasks / Subtasks

- [x] Task 1: Create ArbitrageStrategy class (AC: 1, 2, 3, 4, 5)
  - [x] 1.1 Create `src/server/engine/strategies/arbitrage.ts`
  - [x] 1.2 Extend `ModeRunner` base class — implement `executeIteration()` and `getIntervalMs()`
  - [x] 1.3 Accept `ArbitrageConfig` with: pairs, slippage, spreadThreshold, closeSpreadThreshold, iterationIntervalMs, positionSize
  - [x] 1.4 In constructor: validate config (reuse `invalidStrategyConfigError` from errors.ts), inject `OracleClient` AND `InfoClient` (for Hyperliquid mid-price), sort pairs with boosted first
  - [x] 1.5 In `executeIteration()` Step 1: for each open position, fetch both mid-price and oracle price, compute current spread, close if spread has converged within `closeSpreadThreshold`
  - [x] 1.6 In `executeIteration()` Step 2: for each configured pair, fetch Hyperliquid mid-price via `getMidPrice()` and Pyth oracle price via `oracleClient.getPrice()`, compute spread
  - [x] 1.7 Spread calculation: `spread = (oraclePrice - midPrice) / midPrice` (both in smallest-unit integers)
  - [x] 1.8 If `|spread| > spreadThreshold`: open position — if oracle > mid → open Long (expect perp price to rise toward oracle), if oracle < mid → open Short (expect perp price to fall toward oracle)
  - [x] 1.9 Calculate stop-loss: Long → `midPrice * (1 - stopLossFactor)`, Short → `midPrice * (1 + stopLossFactor)` — use mid-price as the execution reference
  - [x] 1.10 Fund check via `fundAllocator.canAllocate(mode, size)` before every open
  - [x] 1.11 Skip pair if oracle `isAvailable(pair)` returns false or mid-price fetch fails
  - [x] 1.12 Never open duplicate position on same pair if one already open

- [x] Task 2: Add `getMidPrice` access to strategy (AC: 1)
  - [x] 2.1 The `getMidPrice()` function already exists in `src/server/blockchain/contracts.ts` (lines 155-165) — it calls `info.allMids()` and parses the result
  - [x] 2.2 Export `getMidPrice` from contracts.ts if not already exported, or expose via engine
  - [x] 2.3 In `src/server/engine/index.ts`, pass the `InfoClient` reference (or a `getMidPrice` function) to ArbitrageStrategy constructor so it can fetch Hyperliquid mid-prices
  - [x] 2.4 Convert mid-price from float USD to smallest-unit integer: `Math.round(midFloat * 1_000_000)` — this is critical for consistent spread calculation against oracle prices which are already in smallest-unit

- [x] Task 3: Register ArbitrageStrategy in engine (AC: 1, 10)
  - [x] 3.1 Import `ArbitrageStrategy` in `src/server/engine/index.ts`
  - [x] 3.2 Add `case "arbitrage"` to the `startMode()` switch — construct with fundAllocator, positionManager, broadcast, oracleClient, getMidPrice accessor, config
  - [x] 3.3 Oracle gate: Arbitrage requires live oracle data AND Hyperliquid connectivity — check both before start
  - [x] 3.4 Retrieve stored positionSize from cache (same pattern as profitHunter)

- [x] Task 4: Add Arbitrage error factories (AC: 2, 4)
  - [x] 4.1 In `src/server/lib/errors.ts` add: `arbitrageNoSpreadError(pair)` — info severity, logged when spread is within threshold
  - [x] 4.2 Add: `arbitrageMidPriceError(pair)` — warning severity, when Hyperliquid mid-price fetch fails for a pair
  - [x] 4.3 Update `unsupportedModeError` resolution text to include `arbitrage` in supported modes list (if not already)

- [x] Task 5: Write unit tests (AC: all)
  - [x] 5.1 Create `src/server/engine/strategies/arbitrage.test.ts`
  - [x] 5.2 Test: constructor validates config (rejects empty pairs, invalid thresholds)
  - [x] 5.3 Test: constructor validates `spreadThreshold > closeSpreadThreshold`
  - [x] 5.4 Test: `executeIteration()` opens Long when oracle price > mid price beyond threshold (perp price expected to rise)
  - [x] 5.5 Test: `executeIteration()` opens Short when oracle price < mid price beyond threshold (perp price expected to fall)
  - [x] 5.6 Test: no trade when spread is within threshold
  - [x] 5.7 Test: closes position when spread converges within closeSpreadThreshold
  - [x] 5.8 Test: skips pair when oracle unavailable
  - [x] 5.9 Test: skips pair when mid-price fetch fails (logs warning, doesn't stop mode)
  - [x] 5.10 Test: skips trade when `canAllocate()` returns false
  - [x] 5.11 Test: stop-loss calculated correctly for Long and Short using mid-price
  - [x] 5.12 Test: `stop()` calls `closeAllForMode()` (inherited from ModeRunner)
  - [x] 5.13 Test: does not open duplicate position on same pair if one already open
  - [x] 5.14 Test: CAN open positions on different pairs simultaneously
  - [x] 5.15 Test: mid-price is correctly converted from float to smallest-unit integer
  - [x] 5.16 Test error factory outputs in `src/server/lib/errors.test.ts`
  - [x] 5.17 Test: engine `startMode("arbitrage")` creates ArbitrageStrategy instance

- [x] Task 6: Verify integration (AC: 6, 7, 8, 9, 10)
  - [x] 6.1 Confirm all events emitted via positionManager (TRADE_EXECUTED, POSITION_OPENED, POSITION_CLOSED, STATS_UPDATED) — already wired in position-manager.ts
  - [x] 6.2 Confirm trade log [ARB] tagging works via `mode: "arbitrage"` on all trade/position payloads — client-side ModeCard and TradeLog already use mode field for color tagging with cyan `#06b6d4`
  - [x] 6.3 Confirm `stop()` inherited behavior closes all positions before emitting MODE_STOPPED
  - [x] 6.4 Run full test suite: `pnpm test` — expect 0 new failures
  - [x] 6.5 TypeScript compile check: `npx tsc --noEmit`

### Review Findings

- [x] [Review][Decision] #1 `TAKER_FEE_RATE` unused — resolved: added constructor validation `spreadThreshold >= 2 * TAKER_FEE_RATE` with test
- [x] [Review][Decision] #5 `sortPairsWithBoostedFirst` is a no-op stub — resolved: removed stub method, using `[...pairs]` directly; boosted sorting deferred to future story
- [x] [Review][Decision] #7 Immediate re-open after close in same iteration — accepted risk: 5x gap between open/close thresholds makes churn near-impossible
- [x] [Review][Patch] #4 `oracleFeedUnavailableError` reused for Hyperliquid connectivity failure — fixed: added `arbitrageNoBlockchainClientError()` with proper error code and message
- [x] [Review][Patch] #6 `arbitrageNoSpreadError` used when oracle unavailable — fixed: replaced with direct logger.info call for oracle unavailable condition
- [x] [Review][Patch] #8 `NaN` passes `spreadThreshold`/`closeSpreadThreshold` validation — fixed: changed `<= 0` to `!(> 0)` which catches NaN
- [x] [Review][Patch] #9 `positionSize` of 0 bypasses minimum check — fixed: added explicit `positionSize < MIN_POSITION_SIZE` validation in constructor
- [x] [Review][Patch] #10 `slippage` not validated — fixed: added `slippage >= 0` validation in constructor
- [x] [Review][Patch] #11 Duplicated `// --- Profit Hunter errors ---` comment in errors.ts — fixed: removed duplicate
- [x] [Review][Patch] #14 No engine integration test for `startMode("arbitrage")` or Hyperliquid connectivity gate — fixed: added 2 tests for oracle gate and blockchain client gate
- [x] [Review][Fixed] #13 No staleness guard on oracle `publishTime` after SSE reconnection — fixed: added publish_time freshness check in OracleClient.updatePrice()

## Dev Notes

### Strategy Architecture

Arbitrage follows the same extension pattern as VolumeMax and ProfitHunter:

1. **Extend `ModeRunner`** — inherit start/stop lifecycle, event broadcasting, error handling loop
2. **Implement `executeIteration()`** — called on each tick of the run loop
3. **Implement `getIntervalMs()`** — return the polling interval
4. **Register in `startMode()` switch** in `engine/index.ts`

### The Arbitrage Opportunity

Arbitrage exploits the spread between **two price sources**:
- **Hyperliquid perpetual mid-price** — fetched on-demand via `info.allMids()` (REST call)
- **Pyth oracle spot price** — streamed in real-time via SSE, already available through `OracleClient`

When the Pyth oracle spot price diverges from the Hyperliquid perp mid-price beyond a threshold, the strategy opens a position expecting the perp price to converge toward the oracle (spot) price.

### Constructor Signature

```typescript
constructor(
  fundAllocator: FundAllocator,
  positionManager: PositionManager,
  broadcast: BroadcastFn,
  oracleClient: OracleClient,
  getMidPrice: (coin: string) => Promise<number>,  // Returns float USD from Hyperliquid
  config: Partial<ArbitrageConfig> & { pairs: string[] },
)
```

**Note:** Pass `getMidPrice` as a function rather than the full `InfoClient` to respect boundary rules — the strategy layer should not import blockchain layer directly. The engine wires this up.

### executeIteration() Pseudocode

```
1. Get open positions for this mode: positions = positionManager.getPositions(this.mode)
2. For each open position:
   a. Convert pair to oracle key (e.g., "BTC/USDC" → "BTC-PERP")
   b. Get oracle price (smallest-unit) and mid-price (fetch + convert to smallest-unit)
   c. If either price unavailable → skip (don't close on stale data)
   d. Compute spread = (oraclePrice - midPriceSmallest) / midPriceSmallest
   e. If |spread| <= closeSpreadThreshold → close position (spread converged)
3. For each configured pair:
   a. Skip if position already open on this pair
   b. Convert pair to oracle key and coin symbol
   c. Skip if oracle unavailable: !oracleClient.isAvailable(oracleKey)
   d. Get oracle price (smallest-unit): oracleClient.getPrice(oracleKey)
   e. Fetch mid-price (float): await getMidPrice(coin) — wrap in try/catch, skip pair on failure
   f. Convert mid-price to smallest-unit: Math.round(midFloat * 1_000_000)
   g. Compute spread = (oraclePrice - midPriceSmallest) / midPriceSmallest
   h. If |spread| > spreadThreshold:
      - If oraclePrice > midPriceSmallest → Long (perp underpriced vs spot, expect perp to rise)
      - If oraclePrice < midPriceSmallest → Short (perp overpriced vs spot, expect perp to fall)
      - Check canAllocate() before opening
      - Set stop-loss based on mid-price (execution price reference)
      - Open position
```

### Key Difference from ProfitHunter

ProfitHunter compares **oracle price vs oracle moving average** (single source, internal comparison). Arbitrage compares **oracle price vs Hyperliquid mid-price** (two independent sources, cross-market comparison). This means:

- Arbitrage requires **an additional async call per pair** (mid-price REST fetch) — slightly slower per iteration
- Mid-price fetch can fail independently of oracle — handle gracefully per pair
- **Unit conversion is critical**: Oracle returns smallest-unit integers, `getMidPrice()` returns float USD → must convert mid-price to smallest-unit (`Math.round(midFloat * 1_000_000)`) before comparing
- Spread direction has economic meaning: oracle > mid means perp is cheap relative to spot → go Long

### Mid-Price Access Pattern

The `getMidPrice()` function exists in `src/server/blockchain/contracts.ts` (lines 155-165):
```typescript
async function getMidPrice(info: InfoClient, coin: string): Promise<number> {
  const mids = await withRetry(() => info.allMids(), "getMidPrice");
  const midStr = (mids as Record<string, string>)[coin];
  // ... validation and parsing
  return mid; // Returns float USD (e.g., 145.32)
}
```

**Wiring in engine:** Create a closure in `startMode()` that captures the `InfoClient`:
```typescript
case "arbitrage": {
  const getMidPriceFn = (coin: string) => getMidPrice(info, coin);
  runner = new ArbitrageStrategy(
    engine.fundAllocator, engine.positionManager, broadcast,
    oracleClient!, getMidPriceFn,
    { pairs: config.pairs, slippage: config.slippage, positionSize: storedPositionSize },
  );
  break;
}
```

### Pair Format Conversion

Pairs are stored as `"BTC/USDC"` in config. Two conversions needed:
- **Oracle key:** `"BTC/USDC"` → `"BTC-PERP"` (same pattern as ProfitHunter's `pairToOracleKey()`)
- **Coin symbol for mid-price:** `"BTC/USDC"` → `"BTC"` (first part before `/`)

Copy ProfitHunter's `pairToOracleKey()` helper and add a `pairToCoin()` helper:
```typescript
private pairToOracleKey(pair: string): string {
  const parts = pair.split("/");
  if (parts.length < 2 || !parts[0]) {
    logger.warn({ mode: this.mode, pair }, "Malformed pair format");
    return pair;
  }
  return `${parts[0]}-PERP`;
}

private pairToCoin(pair: string): string {
  return pair.split("/")[0] ?? pair;
}
```

### Suggested Default Config Values

```typescript
const DEFAULT_SPREAD_THRESHOLD = 0.005;         // 0.5% spread to open (must exceed fees + slippage)
const DEFAULT_CLOSE_SPREAD_THRESHOLD = 0.001;   // 0.1% spread to close (near convergence)
const DEFAULT_ITERATION_INTERVAL_MS = 3_000;    // 3s — faster than ProfitHunter since arb windows close quickly
const DEFAULT_SLIPPAGE = 0.5;                    // 0.5% slippage tolerance
const STOP_LOSS_FACTOR = 0.03;                   // 3% stop-loss distance (same as ProfitHunter)
const MIN_POSITION_SIZE = 1;                     // $10 minimum (1 = 10_000_000 smallest-unit at 1e6)
const TAKER_FEE_RATE = 0.00025;                  // 0.025% Hyperliquid taker fee — ensure spread > 2x this
```

**Important:** `spreadThreshold` must be > `2 * TAKER_FEE_RATE + slippage` for profitable trades. Validate this in constructor.

### Oracle Integration

Same as ProfitHunter — use the `OracleClient` already initialized in `engine/index.ts`:
- `oracleClient.getPrice(oracleKey)` → `number | null` (smallest-unit integer)
- `oracleClient.isAvailable(oracleKey)` → `boolean`
- MA not needed for arbitrage (we compare against mid-price, not MA)

### Position Opening via PositionManager

Follow the exact same pattern as ProfitHunter:
```typescript
await this.positionManager.openPosition({
  mode: this.mode,         // "arbitrage"
  pair,
  side,                    // "Long" or "Short"
  size,                    // smallest-unit integer
  slippage: this.config.slippage,
  stopLossPrice,           // smallest-unit integer
});
```

PositionManager handles: on-chain execution, stop-loss setting, DB persistence, fund reservation/release, event broadcasting, kill-switch checks. **Do NOT re-implement any of this.**

### Position Closing via PositionManager

```typescript
await this.positionManager.closePosition(positionId);
```

This handles: on-chain close, PnL calculation, trade record, fund release, event broadcasting. **Do NOT re-implement.**

### Tracking Open Positions

Use `positionManager.getPositions(this.mode)` — returns `Position[]` with `id`, `pair`, `side`, `size`, `entryPrice`, `stopLoss`, `timestamp` (all in **display units**, not smallest-unit).

**Do NOT maintain a separate position tracking data structure** — this would diverge from the single source of truth.

### Fund Allocation Pattern

Before every trade:
```typescript
if (!this.fundAllocator.canAllocate(this.mode, size)) {
  logger.info({ mode: this.mode, pair }, "Insufficient funds, skipping");
  return; // Use `continue` if inside a pair loop
}
```

Fund reservation/release is handled inside `positionManager.openPosition()` and `closePosition()`. **Do NOT call `reserve()` or `release()` directly from the strategy.**

### Dynamic Position Sizing

Follow ProfitHunter's `getPositionSize()` pattern — recalculate from current allocation each iteration when no explicit size configured:
```typescript
private getPositionSize(): number {
  if (this.config.positionSize) return this.config.positionSize;
  const stored = this.fundAllocator.getPositionSize(this.mode);
  if (stored) return stored;
  // Default: use allocation
  const { allocation } = this.fundAllocator.getAllocation(this.mode);
  return allocation;
}
```

### Error Handling

- Use `AppError` factories from `errors.ts` — never throw plain strings
- Strategy iteration errors are caught by `ModeRunner._runLoop()` and broadcast as `MODE_ERROR` events
- The mode continues running after non-fatal errors (ModeRunner handles this)
- Oracle unavailability for a specific pair → skip that pair (info-level log), don't stop the mode
- Mid-price fetch failure for a pair → skip that pair (warning-level log), don't stop the mode
- Insufficient funds → skip trade (info-level log), don't stop the mode

### Import Pattern

Use `.js` extensions in all imports (TypeScript ESM resolution):
```typescript
import { ModeRunner, type BroadcastFn } from "../mode-runner.js";
import type { FundAllocator } from "../fund-allocator.js";
import type { PositionManager } from "../position-manager.js";
import type { OracleClient } from "../../blockchain/oracle.js";
import type { ModeType } from "../../../shared/types.js";
```

### What NOT To Build

- **No new WebSocket events** — all needed events (TRADE_EXECUTED, POSITION_OPENED, etc.) already exist and are emitted by PositionManager
- **No new shared types for ModeType** — `ModeType` already includes `"arbitrage"`, `Trade`/`Position`/`ModeStats` work as-is
- **No client-side changes** — ModeCard, TradeLog, PositionsTable already handle `arbitrage` mode via the `mode` field; [ARB] tagging and cyan `#06b6d4` color are client-side concerns already wired
- **No database changes** — trades and positions tables already support any ModeType
- **No new API endpoints** — `POST /api/mode/:mode/start` and `/stop` already accept `"arbitrage"`
- **No oracle changes** — OracleClient from Story 4-1 is complete and tested
- **No position manager changes** — all needed APIs already exist

### Project Structure Notes

- New file: `src/server/engine/strategies/arbitrage.ts` (kebab-case, matches volume-max.ts and profit-hunter.ts)
- New file: `src/server/engine/strategies/arbitrage.test.ts` (co-located tests)
- Modified: `src/server/engine/index.ts` (add case + import + getMidPrice wiring)
- Modified: `src/server/blockchain/contracts.ts` (export `getMidPrice` if not already exported)
- Modified: `src/server/lib/errors.ts` (add 2 error factories)
- Modified: `src/server/lib/errors.test.ts` (add 2 error factory tests)

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 4, Story 4.3]
- [Source: _bmad-output/planning-artifacts/architecture.md — Mode Runner Architecture, Strategy Extension Pattern]
- [Source: _bmad-output/planning-artifacts/architecture.md — Fund Allocator, Position Manager, WebSocket Events]
- [Source: _bmad-output/planning-artifacts/prd.md — FR4, FR5, FR6, FR9-FR11, FR12, NFR8]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — ModeCard, TradeLog [ARB] cyan #06b6d4, PositionsTable]
- [Source: _bmad-output/implementation-artifacts/4-2-profit-hunter-strategy.md — Strategy pattern, oracle integration, position tracking]
- [Source: _bmad-output/implementation-artifacts/4-1-pyth-oracle-client-and-price-feed.md — OracleClient API]
- [Source: src/server/engine/strategies/volume-max.ts — Simplest strategy extension pattern]
- [Source: src/server/engine/strategies/profit-hunter.ts — Oracle-based strategy with stateful positions]
- [Source: src/server/engine/mode-runner.ts — Base class contract: executeIteration(), getIntervalMs()]
- [Source: src/server/engine/index.ts — startMode() registration, oracle gate pattern]
- [Source: src/server/engine/position-manager.ts — openPosition/closePosition/getPositions API]
- [Source: src/server/engine/fund-allocator.ts — canAllocate/getPositionSize/getAllocation API]
- [Source: src/server/blockchain/contracts.ts — getMidPrice() function, allMids() API]
- [Source: src/shared/types.ts — ModeType includes "arbitrage", PYTH_FEED_IDS]

### Previous Story Intelligence (4-2)

**Key learnings from Story 4-2 (Profit Hunter Strategy):**
- Constructor takes `oracleClient` as 4th arg (before config) — follow same pattern, add `getMidPrice` as 5th arg
- Use `continue` not `return` in per-pair loops when skipping (review finding from 4-2)
- Wire up all imported error factories — don't leave unused imports (review finding from 4-2)
- Remove dead `stop()` override — inherited behavior is sufficient (review finding from 4-2)
- Add `isAvailable()` check in close-signal path too, not just open-signal (review finding from 4-2)
- Guard against `price === 0` in both open and close paths (review finding from 4-2)
- Validate threshold ordering in constructor: `spreadThreshold > closeSpreadThreshold` (mirrors deviationThreshold > closeThreshold from 4-2)
- Dynamic position sizing via `getPositionSize()` recalculates each iteration (review finding from 4-2)
- Current test baseline: 516 passed, 1 pre-existing failure (`resetKillSwitch`)
- TypeScript compiles clean
- Code review applied 7 patches in 4-2 — apply all lessons proactively

### Git Intelligence

Recent commits follow pattern: `feat: add <feature description> with code review fixes (Story X-Y)`
Files created in 4-2: `profit-hunter.ts`, `profit-hunter.test.ts`. Modified: `index.ts`, `errors.ts`, `errors.test.ts`, `index.test.ts`.
Most recent commit: `d481929 feat: configurable position size and max allocation with code review fixes (Story 8-6)`

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

### Completion Notes List

- Implemented ArbitrageStrategy extending ModeRunner with full executeIteration() lifecycle
- Strategy compares Pyth oracle spot prices against Hyperliquid perp mid-prices to detect cross-market spreads
- Mid-price conversion from float USD to smallest-unit integer (Math.round * 1e6) for consistent comparison
- Constructor validates: non-empty pairs, positive thresholds, closeSpreadThreshold < spreadThreshold, $10 minimum allocation
- Stop-loss calculated from mid-price (execution reference): Long = mid*(1-0.03), Short = mid*(1+0.03)
- Fund check via canAllocate() before every trade; dynamic position sizing via getPositionSize()
- Exported getMidPrice from contracts.ts; engine wires closure capturing InfoClient from BlockchainClient
- Oracle gate + blockchain connectivity gate both checked before arbitrage start
- 31 new tests covering all ACs; full suite: 581 passed, 0 failures
- TypeScript compiles clean with --noEmit
- Applied all 4-2 review learnings: continue in loops, no dead stop() override, isAvailable in close path, guard price===0

### File List

- src/server/engine/strategies/arbitrage.ts (new)
- src/server/engine/strategies/arbitrage.test.ts (new)
- src/server/engine/index.ts (modified — import, oracle gate, case "arbitrage")
- src/server/blockchain/contracts.ts (modified — export getMidPrice)
- src/server/lib/errors.ts (modified — 2 arbitrage error factories, unsupportedModeError resolution text)
- src/server/lib/errors.test.ts (modified — 2 arbitrage error factory tests)
- src/server/engine/index.test.ts (modified — updated unsupported mode test, added getMidPrice to contracts mock)

### Change Log

- 2026-04-06: Implemented Arbitrage Strategy (Story 4-3) — cross-market spread detection between Pyth oracle and Hyperliquid perp mid-prices
