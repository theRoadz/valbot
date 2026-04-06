# Story 4.2: Profit Hunter Strategy

Status: done

## Story

As theRoad,
I want to activate Profit Hunter mode to trade based on Pyth oracle price deviation from the 5-minute moving average,
So that I can capture mean-reversion profits when prices diverge from the short-term average.

## Acceptance Criteria

1. **Given** the mode-runner base class and position manager from Epic 2, **When** Profit Hunter mode is started via the dashboard, **Then** the strategy subscribes to Pyth oracle price feeds for its configured pairs.

2. **Given** continuous Pyth price data, **When** the current price deviates from the 5-minute moving average beyond a configurable threshold, **Then** the strategy opens a position in the mean-reversion direction (short if price > MA, long if price < MA).

3. **Given** an open Profit Hunter position, **When** positions are opened, **Then** stop-loss protection is set (NFR8) before the position is considered active.

4. **Given** an open Profit Hunter position, **When** price reverts toward the moving average (crosses back within a close threshold), **Then** the position is closed to capture profit.

5. **Given** Profit Hunter is running, **Then** the strategy respects its own fund allocation — never exceeds its budget via `fundAllocator.canAllocate()` checks before every trade.

6. **Given** Profit Hunter executes trades, **Then** all trades emit `trade.executed`, `position.opened`, `position.closed`, and `stats.updated` WebSocket events.

7. **Given** Profit Hunter is running on the dashboard, **Then** the ModeCard badge shows green "Running" and stats update in real-time.

8. **Given** Profit Hunter trades appear in the trade log, **Then** entries are tagged `[PRO]` in green (`#22c55e`).

9. **Given** Profit Hunter is stopped via toggle, **Then** all its open positions are closed before emitting `mode.stopped`.

10. **Given** Volume Max is already running, **When** Profit Hunter is started, **Then** both modes run simultaneously without interference (FR5).

## Tasks / Subtasks

- [x] Task 1: Create ProfitHunterStrategy class (AC: 1, 2, 3, 4, 5)
  - [x] 1.1 Create `src/server/engine/strategies/profit-hunter.ts`
  - [x] 1.2 Extend `ModeRunner` base class — implement `executeIteration()` and `getIntervalMs()`
  - [x] 1.3 Accept `ProfitHunterConfig` with: pairs, slippage, deviationThreshold, closeThreshold, iterationIntervalMs, positionSize
  - [x] 1.4 In constructor: validate config (reuse `invalidStrategyConfigError` from errors.ts), inject `OracleClient` as 4th constructor arg (before config), sort pairs with boosted first
  - [x] 1.5 In `executeIteration()`: for each configured pair, get price and moving average from oracle
  - [x] 1.6 Compute deviation: `(price - movingAverage) / movingAverage`
  - [x] 1.7 If `|deviation| > deviationThreshold`: open position in mean-reversion direction
  - [x] 1.8 If price < MA → open Long (expect reversion up); if price > MA → open Short (expect reversion down)
  - [x] 1.9 Calculate stop-loss: Long → `price * (1 - stopLossFactor)`, Short → `price * (1 + stopLossFactor)`
  - [x] 1.10 Check existing positions — close if price has reverted within `closeThreshold` of MA
  - [x] 1.11 Fund check via `fundAllocator.canAllocate(mode, size)` before every open
  - [x] 1.12 Skip pair if oracle `isAvailable(pair)` returns false or `getMovingAverage(pair)` returns null (MA requires ~30s of data after connect — this is normal warm-up, not an error)

- [x] Task 2: Register ProfitHunterStrategy in engine (AC: 1, 10)
  - [x] 2.1 Import `ProfitHunterStrategy` in `src/server/engine/index.ts`
  - [x] 2.2 Add `case "profitHunter"` to the `startMode()` switch — construct with `oracleClient!` (module-level variable, already null-checked by oracle gate above):
    ```typescript
    case "profitHunter":
      runner = new ProfitHunterStrategy(
        engine.fundAllocator, engine.positionManager, broadcast,
        oracleClient!, { pairs: config.pairs, slippage: config.slippage },
      );
      break;
    ```
  - [x] 2.3 Verify oracle gate already checks `oracleClient.isAvailable()` (global check) before Profit Hunter start (exists from 4-1). Per-pair availability is checked in `executeIteration()`.
  - [x] 2.4 Update `unsupportedModeError` resolution text in `errors.ts` to include `profitHunter` in supported modes list

- [x] Task 3: Add Profit Hunter error factories (AC: 2, 4, 5)
  - [x] 3.1 In `src/server/lib/errors.ts` add: `profitHunterNoSignalError(pair)`, `profitHunterStaleOracleError(pair)`
  - [x] 3.2 These are `info` severity — logged but don't stop the mode

- [x] Task 4: Write unit tests (AC: all)
  - [x] 4.1 Create `src/server/engine/strategies/profit-hunter.test.ts`
  - [x] 4.2 Test: constructor validates config (rejects empty pairs, invalid thresholds)
  - [x] 4.3 Test: `executeIteration()` opens Long when price < MA beyond threshold
  - [x] 4.4 Test: `executeIteration()` opens Short when price > MA beyond threshold
  - [x] 4.5 Test: no trade when deviation is within threshold
  - [x] 4.6 Test: closes position when price reverts within closeThreshold of MA
  - [x] 4.7 Test: skips pair when oracle unavailable or MA is null
  - [x] 4.8 Test: skips trade when `canAllocate()` returns false
  - [x] 4.9 Test: stop-loss calculated correctly for Long and Short
  - [x] 4.10 Test: `stop()` calls `closeAllForMode()` (inherited from ModeRunner)
  - [x] 4.11 Test: does not open duplicate position on same pair if one already open
  - [x] 4.12 Test: CAN open positions on different pairs simultaneously
  - [x] 4.13 Test error factory outputs in `src/server/lib/errors.test.ts` (consistent with existing pattern)
  - [x] 4.14 Test: engine `startMode("profitHunter")` creates ProfitHunterStrategy instance

- [x] Task 5: Verify integration (AC: 6, 7, 8, 9, 10)
  - [x] 5.1 Confirm all events emitted via positionManager (TRADE_EXECUTED, POSITION_OPENED, POSITION_CLOSED, STATS_UPDATED) — these are already wired in position-manager.ts
  - [x] 5.2 Confirm trade log [PRO] tagging works via `mode: "profitHunter"` on all trade/position payloads — client-side ModeCard and TradeLog already use mode field for color tagging
  - [x] 5.3 Confirm `stop()` inherited behavior closes all positions before emitting MODE_STOPPED
  - [x] 5.4 Run full test suite: `pnpm test` — expect 0 new failures
  - [x] 5.5 TypeScript compile check: `npx tsc --noEmit`

## Dev Notes

### Strategy Architecture

Profit Hunter follows the exact same extension pattern as VolumeMax (`src/server/engine/strategies/volume-max.ts`):

1. **Extend `ModeRunner`** — inherit start/stop lifecycle, event broadcasting, error handling loop
2. **Implement `executeIteration()`** — called on each tick of the run loop
3. **Implement `getIntervalMs()`** — return the polling interval (configurable, default ~5000ms — faster than VolumeMax's 30s since price signals are time-sensitive)
4. **Register in `startMode()` switch** in `engine/index.ts`

### Constructor Signature

```typescript
constructor(
  fundAllocator: FundAllocator,
  positionManager: PositionManager,
  broadcast: BroadcastFn,
  oracleClient: OracleClient,  // NEW — VolumeMax doesn't have this
  config: Partial<ProfitHunterConfig> & { pairs: string[] },
)
```

### executeIteration() Pseudocode

```
1. Get open positions for this mode: positions = positionManager.getPositions(this.mode)
2. For each open position:
   a. Get oracle price and MA for position's pair
   b. Compute deviation = (price - MA) / MA
   c. If |deviation| <= closeThreshold → close position (mean reverted)
3. For each configured pair:
   a. Skip if oracle unavailable or MA is null for this pair
   b. Skip if position already open on this pair
   c. Get price and MA, compute deviation
   d. If |deviation| > deviationThreshold:
      - If price < MA → open Long (reversion up expected)
      - If price > MA → open Short (reversion down expected)
      - Check canAllocate() before opening
      - Set stop-loss based on current price
```

### Key Difference from VolumeMax

VolumeMax is **stateless per iteration** — it opens and closes positions within a single cycle. Profit Hunter is **stateful** — it opens positions that remain open across iterations until a close signal is detected. This means:

- Track open Profit Hunter positions in-memory (or query via `positionManager`) to check close conditions each iteration
- Never open a duplicate position on the same pair if one is already open
- Each iteration must: (1) check existing positions for close signals, (2) scan for new entry signals

### Oracle Integration

The `OracleClient` (created in Story 4-1) is already initialized in `engine/index.ts` and available via `getOracleClient()`. The strategy needs:

- `oracleClient.getPrice(pair)` → returns `number | null` (smallest-unit integer)
- `oracleClient.getMovingAverage(pair)` → returns `number | null` (smallest-unit integer, 5-min SMA)
- `oracleClient.isAvailable(pair)` → returns `boolean` (false if no updates in 30s)

**All oracle prices are in smallest-unit integers (USDC × 1e6).** Deviation calculations use these directly — no conversion needed.

**Important:** `getPositions()` returns display-unit values (divided by 1e6). Oracle `getPrice()`/`getMovingAverage()` return smallest-unit integers. Do NOT mix these in calculations. Close-condition checks should compare oracle prices against MA (both smallest-unit), not against position entry prices.

### Position Opening via PositionManager

Follow the exact same pattern as VolumeMax:
```typescript
await this.positionManager.openPosition({
  mode: this.mode,         // "profitHunter"
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

### Suggested Default Config Values

```typescript
const DEFAULT_DEVIATION_THRESHOLD = 0.01;   // 1% deviation from MA to open
const DEFAULT_CLOSE_THRESHOLD = 0.003;       // 0.3% from MA to close (mean reverted)
const DEFAULT_ITERATION_INTERVAL_MS = 5_000; // 5s polling — price-sensitive
const DEFAULT_SLIPPAGE = 0.5;                // 0.5% slippage tolerance
const STOP_LOSS_FACTOR = 0.03;              // 3% stop-loss distance
const MIN_POSITION_SIZE = 1;
```

These are tuneable by the user via mode config API. Sensible defaults prevent immediate losses.

### Tracking Open Positions

Use `positionManager`'s existing API to query open positions for this mode. **Do NOT maintain a separate position tracking data structure** — this would diverge from the single source of truth. Instead:

- Use `this.positionManager.getPositions(this.mode)` — returns `Position[]` with `id`, `pair`, `side`, `size`, `entryPrice`, `stopLoss`, `timestamp` (all in **display units**, not smallest-unit)
- Check if a position already exists for a pair before opening a new one
- **Note:** `getInternalPositions()` only returns `{ mode, size }[]` — insufficient for close-condition checks. Use `getPositions()` instead.

### Fund Allocation Pattern

Before every trade:
```typescript
if (!this.fundAllocator.canAllocate(this.mode, size)) {
  logger.info({ mode: this.mode, pair }, "Insufficient funds, skipping");
  return;
}
```

Fund reservation/release is handled inside `positionManager.openPosition()` and `closePosition()`. **Do NOT call `reserve()` or `release()` directly from the strategy.**

### Error Handling

- Use `AppError` factories from `errors.ts` — never throw plain strings
- Strategy iteration errors are caught by `ModeRunner._runLoop()` and broadcast as `MODE_ERROR` events
- The mode continues running after non-fatal errors (ModeRunner handles this)
- Oracle unavailability for a specific pair → skip that pair (info-level log), don't stop the mode
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
- **No new shared types** — `ModeType` already includes `"profitHunter"`, `Trade`/`Position`/`ModeStats` work as-is
- **No client-side changes** — ModeCard, TradeLog, PositionsTable already handle `profitHunter` mode via the `mode` field; [PRO] tagging and green color are client-side concerns already wired
- **No database changes** — trades and positions tables already support any ModeType
- **No new API endpoints** — `POST /api/mode/:mode/start` and `/stop` already accept `"profitHunter"`
- **No oracle changes** — OracleClient from Story 4-1 is complete and tested

### Project Structure Notes

- New file: `src/server/engine/strategies/profit-hunter.ts` (kebab-case, matches volume-max.ts)
- New file: `src/server/engine/strategies/profit-hunter.test.ts` (co-located tests)
- Modified: `src/server/engine/index.ts` (add case + import)
- Modified: `src/server/lib/errors.ts` (add 2 error factories)
- Modified: `src/server/lib/errors.test.ts` (add 2 error factory tests)

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 4, Story 4.2]
- [Source: _bmad-output/planning-artifacts/architecture.md — Mode Runner Architecture, Strategy Extension Pattern]
- [Source: _bmad-output/planning-artifacts/architecture.md — Fund Allocator, Position Manager, WebSocket Events]
- [Source: _bmad-output/planning-artifacts/prd.md — FR3, FR5, FR6, FR7, FR8, FR9-11, NFR8]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — ModeCard, TradeLog, PositionsTable]
- [Source: _bmad-output/implementation-artifacts/4-1-pyth-oracle-client-and-price-feed.md — OracleClient API, price format, SSE patterns]
- [Source: src/server/engine/strategies/volume-max.ts — Strategy extension pattern reference]
- [Source: src/server/engine/mode-runner.ts — Base class contract: executeIteration(), getIntervalMs()]
- [Source: src/server/engine/index.ts — startMode() registration, oracle gate pattern]
- [Source: src/server/engine/position-manager.ts — openPosition/closePosition API]
- [Source: src/server/engine/fund-allocator.ts — canAllocate/reserve/release API]

### Previous Story Intelligence (4-1)

**Key learnings from Story 4-1 (Pyth Oracle Client):**
- Use `.js` extensions in all imports (ESM)
- Constants use `UPPER_SNAKE_CASE`
- All errors use factory functions from `errors.ts` (never inline `new AppError(...)`)
- All prices stored as smallest-unit integers (USDC × 1e6) — use `Math.round()` for conversion
- Alert broadcasts must include `resolution` field
- Current test baseline: 485 passed (1 pre-existing failure: `resetKillSwitch`)
- TypeScript compiles clean
- Code review applied 12 patches in 4-1 — common issues: race conditions, null handling, unused code, timer cleanup

### Git Intelligence

Recent commits follow pattern: `feat: add <feature description> with code review fixes (Story X-Y)`
Files created in 4-1: `oracle.ts`, `oracle.test.ts`. Modified: `types.ts`, `events.ts`, `errors.ts`, `engine/index.ts`, `shutdown.ts`.

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- TypeScript compile check: clean (0 errors)
- Test suite: 516 passed, 1 pre-existing failure (resetKillSwitch from prior stories)

### Completion Notes List

- Created ProfitHunterStrategy extending ModeRunner with mean-reversion logic
- executeIteration() follows two-phase approach: (1) check open positions for close signals, (2) scan for new entry signals
- Deviation calculated as (price - MA) / MA using smallest-unit oracle prices
- Stop-loss set at 3% distance from entry price (Long: below, Short: above)
- Registered profitHunter case in engine startMode() switch
- Added 2 info-severity error factories: profitHunterNoSignalError, profitHunterStaleOracleError
- Updated unsupportedModeError resolution to list profitHunter
- 20 new unit tests covering all ACs: constructor validation, Long/Short opening, close on reversion, oracle skip, fund check, stop-loss calculation, duplicate prevention, multi-pair support
- 2 new error factory tests in errors.test.ts
- 1 new engine integration test for profitHunter startMode

### File List

- `src/server/engine/strategies/profit-hunter.ts` (new)
- `src/server/engine/strategies/profit-hunter.test.ts` (new)
- `src/server/engine/index.ts` (modified — import + case)
- `src/server/engine/index.test.ts` (modified — profitHunter startMode test)
- `src/server/lib/errors.ts` (modified — 2 error factories + unsupportedMode resolution)
- `src/server/lib/errors.test.ts` (modified — 2 error factory tests)

### Review Findings

- [x] [Review][Decision] `return` vs `continue` in fund-check loop — resolved: changed to `continue` for per-pair consistency
- [x] [Review][Patch] Wire up or remove unused error factory imports — resolved: wired `profitHunterStaleOracleError` into oracle-unavailable skip, removed unused `profitHunterNoSignalError` import
- [x] [Review][Patch] Remove dead `stop()` override — resolved: removed pass-through override
- [x] [Review][Patch] Add `isAvailable` check in close-signal path — resolved: added `isAvailable(pair)` guard before close-condition check
- [x] [Review][Patch] Guard against `price === 0` in open-signal and close-signal paths — resolved: added `price === 0` guard in both paths
- [x] [Review][Patch] Validate `deviationThreshold > closeThreshold` — resolved: added constructor validation
- [x] [Review][Defer] Position size frozen at construction time — resolved: added dynamic `getPositionSize()` that recalculates from current allocation each iteration when no explicit size configured

### Change Log

- 2026-04-06: Implemented Story 4-2 Profit Hunter Strategy — all tasks complete, all ACs satisfied
- 2026-04-06: Code review completed — 1 decision-needed, 5 patches, 1 deferred, 8 dismissed
