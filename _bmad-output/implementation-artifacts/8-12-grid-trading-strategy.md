# Story 8.12: Grid Trading Strategy

Status: done

## Story

As theRoad,
I want a grid trading strategy that places layered buy/sell orders within a price range,
So that I can profit from price oscillation in sideways markets without needing to predict direction.

## Problem

The existing strategies (Profit Hunter, Arbitrage) rely on detecting specific signals that may rarely trigger. Grid trading is a mechanical approach that works in the most common market condition — sideways/choppy price action. It buys dips and sells rallies at predetermined price levels, turning volatility into profit opportunities.

## Background

### How Grid Trading Works

1. Define a price range: `lowerPrice` to `upperPrice`
2. Divide into `gridLines` evenly spaced levels
3. When price drops below a level → buy (open Long)
4. When price rises above the next level up → sell (close Long)
5. Each level operates independently — no direction prediction needed

### Example

With SOL at $150, grid from $140-$160 with 10 levels ($2 spacing):
- Price drops to $148 → buy at $148 level
- Price rises to $150 → sell the $148 position for $2 profit
- Price drops to $146 → buy at $146 and $148 levels
- Price rises to $150 → sell both for profit

### Design Decisions

- **Long-only grid**: Simpler, natural for trending-up or sideways markets
- **Oracle-based**: Uses Pyth price (same as Profit Hunter)
- **Single pair per instance**: Grid uses only `pairs[0]` — avoids complexity of multi-pair grid state
- **Grid state in memory**: `Map<gridLevelPrice, positionId | null>`. Positions persist in DB via position manager.
- **Position sizing override**: Grid ignores `StrategyDeps.config.positionSize` — always uses `allocation / gridLines` to ensure even distribution across levels
- **Static stop-loss**: `lowerPrice * 0.98` set at position open time, not updated if grid is reconfigured

## Acceptance Criteria

1. **Given** upperPrice and lowerPrice are configured, **When** the strategy starts, **Then** it calculates evenly spaced grid levels between them.
2. **Given** the current price crosses below a grid level, **When** no position exists at that level, **Then** it opens a Long position.
3. **Given** a Long position exists at a grid level, **When** price crosses above the next grid level up, **Then** it closes the position.
4. **Given** gridLines is 10 and allocation is $1000, **When** positions are sized, **Then** each position is $100 (allocation / gridLines), ignoring any `positionSize` from config.
5. **Given** a position exists at a grid level, **When** price crosses below it again, **Then** it does NOT open a duplicate.
6. **Given** the grid is active, **When** price drops below lowerPrice, **Then** stop-losses at `lowerPrice * 0.98` protect all positions (set at open time, static).
7. **Given** the strategy is registered, **When** the dashboard loads, **Then** a new mode card appears with blue color (#3b82f6) and grid-specific config inputs (upperPrice, lowerPrice, gridLines).
8. **Given** upperPrice <= lowerPrice, **When** the strategy is created, **Then** it throws a validation error.
9. **Given** gridLines < 2, **When** the strategy is created, **Then** it throws a validation error.
10. **Given** allocation < gridLines * $10, **When** the strategy is created, **Then** it throws a validation error.
11. **Given** all changes are made, **When** running `pnpm test`, **Then** all tests pass.

## Tasks / Subtasks

- [x] Task 1: Create GridTradingStrategy class with tests (AC: 1-6, 8-10)
  - [x] 1.1 Create `src/server/engine/strategies/grid-trading.ts` extending `ModeRunner`
  - [x] 1.2 Define `GridTradingConfig` (private to this file): `pair` (string), `upperPrice` (number), `lowerPrice` (number), `gridLines` (number), `iterationIntervalMs` (number), `slippage` (number). Note: `pair` derived from `deps.config.pairs[0]`
  - [x] 1.3 Constructor: validate `upperPrice > lowerPrice`, `gridLines >= 2`, `allocation >= gridLines * 10` (MIN_POSITION_SIZE = $10). Throw `AppError` with resolution text on failure.
  - [x] 1.4 `calculateGridLevels()`: compute evenly spaced prices between lower and upper (inclusive of both bounds). Returns `number[]`.
  - [x] 1.5 Grid state tracking: `Map<number, number | null>` (level price → positionId). Initialized in `onStart()`, cleared in `onStop()`.
  - [x] 1.6 `executeIteration()`: get oracle price via `oracleClient.getPrice()`, then two-phase check — Phase 1: check existing positions for close signals (price crossed above next level up); Phase 2: check empty levels for open signals (price crossed below level). Pattern matches Profit Hunter/Momentum two-phase iteration.
  - [x] 1.7 Position size = `fundAllocator.getAllocation(mode) / gridLines` (computed dynamically, min $10). Ignores `deps.config.positionSize`.
  - [x] 1.8 Stop-loss: `lowerPrice * 0.98` passed to `positionManager.openPosition()` at open time (static, never updated)
  - [x] 1.9 Self-register at module bottom: `strategyRegistry.registerStrategy({ name: "Grid Trading", modeType: "gridTrading", urlSlug: "grid-trading", modeColor: "#3b82f6", requires: { oracle: true }, factory })`. Pattern: see any existing strategy file bottom.
  - [x] 1.10 Create `src/server/engine/strategies/grid-trading.test.ts` with tests for: grid level calculation, open Long on price cross below level, close Long on price cross above next level, no duplicate at same level, position sizing (allocation / gridLines), stop-loss at lowerPrice * 0.98, constructor rejects invalid config (3 cases)
  - [x] 1.11 Run `pnpm test` — all tests pass before proceeding

- [x] Task 2: Update infrastructure and registration (AC: 7)
  - [x] 2.1 Import `./strategies/grid-trading.js` in `src/server/engine/index.ts` to trigger self-registration (side-effect import, same pattern as other strategies)
  - [x] 2.2 Verify `ModeType` in `src/shared/types.ts` is `string` (it is — no union to extend, no change needed)
  - [x] 2.3 Run `pnpm test` — all tests pass before proceeding

- [x] Task 3: Add grid config fields to shared types and API (AC: 7)
  - [x] 3.1 Add optional grid fields to `ModeConfig` in `src/shared/types.ts`: `gridUpperPrice?: number`, `gridLowerPrice?: number`, `gridLines?: number` (follows same pattern as `rsiPeriod?`, `oversoldThreshold?` etc.)
  - [x] 3.2 Add grid config fields to `PUT /api/mode/:mode/config` body schema in `src/server/api/mode.ts`: `gridUpperPrice` (number, minimum: 0), `gridLowerPrice` (number, minimum: 0), `gridLines` (integer, minimum: 2, maximum: 50). Add to Body type and schema properties.
  - [x] 3.3 Add cross-field validation in the config route: `gridLowerPrice < gridUpperPrice` when either is provided. Throw `AppError` with resolution on failure (follows RSI cross-field validation pattern at line ~136).
  - [x] 3.4 Add grid config fields to `updateModeConfig` in `src/client/lib/api.ts` type signature (follows RSI field pattern)
  - [x] 3.5 Run `pnpm test` — all tests pass before proceeding

- [x] Task 4: Mode card UI — grid config inputs (AC: 7)
  - [x] 4.1 Create `GridConfigInputs` component in `src/client/components/mode-card.tsx` (follows `RsiConfigInputs` pattern at line ~304): renders upperPrice, lowerPrice, gridLines inputs with blur/Enter commit, cross-field validation (lower < upper), disabled when running
  - [x] 4.2 Conditionally render `GridConfigInputs` when `mode === "gridTrading"` (follows `mode === "profitHunter"` pattern at line ~838), reading `gridUpperPrice`, `gridLowerPrice`, `gridLines` from mode state
  - [x] 4.3 Add grid fields to the mode state destructuring at line ~494: `gridUpperPrice`, `gridLowerPrice`, `gridLines`
  - [x] 4.4 Run `pnpm test` — all tests pass

### Review Findings

- [x] [Review][Decision] StrategyDeps modified — violates spec "Do NOT" constraint — Fixed: reverted `StrategyDeps.config`, factory now reads from `fundAllocator.getModeMetadata` directly [strategy-registry.ts:15, engine/index.ts, grid-trading.ts:262-264]
- [x] [Review][Decision] Grid state lost on restart — orphaned positions — Accepted as-is: spec says "Grid state in memory", orphans protected by stop-loss
- [x] [Review][Decision] Single iteration opens positions at all levels below price — Accepted as-is: this is how grids work, allocation guards prevent over-spending
- [x] [Review][Patch] API cross-field validation allows invalid single-field updates — Fixed: now fetches stored value for the missing field [mode.ts:164-186]
- [x] [Review][Patch] React key includes value, causing input remount — Fixed: changed to `key={field}` [mode-card.tsx:~403]
- [x] [Review][Patch] API schema allows gridUpperPrice/gridLowerPrice of 0 — Fixed: changed minimum to 0.01 [mode.ts:87-88]
- [x] [Review][Defer] No server-side max for gridUpperPrice/gridLowerPrice — Fixed: added `maximum: 1_000_000` to API schema [mode.ts:87-88]

## Dev Notes

### Key Files

- `src/server/engine/strategies/grid-trading.ts` — New strategy (create)
- `src/server/engine/strategies/grid-trading.test.ts` — New tests (create)
- `src/server/engine/index.ts` — Add import for registration
- `src/shared/types.ts` — Add optional grid fields to ModeConfig
- `src/server/api/mode.ts` — Add grid fields to config endpoint schema + validation
- `src/client/lib/api.ts` — Add grid fields to updateModeConfig type
- `src/client/components/mode-card.tsx` — GridConfigInputs component + conditional render

### Reusable Patterns

- Strategy class structure from `src/server/engine/strategies/profit-hunter.ts`
- Self-registration pattern from any existing strategy file (bottom of file)
- Two-phase iteration (exit first, then entry) from Profit Hunter/Momentum
- Position manager operations: `openPosition`, `closePosition`, `getPositions`
- Oracle client: `oracleClient.getPrice(oracleKey)` where key = `COIN-PERP`
- RSI config UI pattern: `RsiConfigInputs` component + conditional render in mode-card.tsx
- API config validation: RSI cross-field validation block in mode.ts (~line 136)

### Do NOT

- Do NOT modify `StrategyDeps` in `strategy-registry.ts` — grid config is private to the strategy class, not a shared dependency
- Do NOT use `deps.config.positionSize` — grid always sizes as `allocation / gridLines`
- Do NOT update stop-losses after position open — they are static at `lowerPrice * 0.98`

## Dev Agent Record

### Implementation Plan

- Task 1: Created `GridTradingStrategy` extending `ModeRunner` with grid level calculation, two-phase iteration (close first, then open), grid state tracking via `Map<number, number | null>`, position sizing as `allocation / gridLines`, static stop-loss at `lowerPrice * 0.98`, and self-registration.
- Task 2: Added side-effect import in engine index. ModeType confirmed as `string`.
- Task 3: Added grid config fields (`gridUpperPrice`, `gridLowerPrice`, `gridLines`) to `ModeConfig` types, API body schema with validation, client API type, and status endpoint. Extended `StrategyDeps.config` to include grid fields. Added `modeMetadata` store to `FundAllocator` for persisting grid config to the DB `config` table. Updated `startMode` to load and pass grid metadata to the factory.
- Task 4: Created `GridConfigInputs` component following `RsiConfigInputs` pattern with cross-field validation (lower < upper), blur/Enter commit, and disabled-when-running logic. Conditionally rendered for `gridTrading` mode.

### Debug Log

No blocking issues encountered.

### Completion Notes

- All 4 tasks complete, all 11 ACs satisfied
- 803 tests pass (0 regressions)
- Grid trading strategy implements a mechanical long-only grid that buys on dips and sells on rallies at evenly spaced price levels
- Grid config is persisted to DB via `FundAllocator.modeMetadata` using the existing `config` table pattern
- Grid state (level→positionId mapping) is in-memory, initialized on `onStart()` and cleared on `onStop()`
- Position sizing is always `allocation / gridLines` (ignores `positionSize` from config)
- Stop-loss is static at `lowerPrice * 0.98`, set at position open time

## File List

- `src/server/engine/strategies/grid-trading.ts` — New: GridTradingStrategy class with self-registration
- `src/server/engine/strategies/grid-trading.test.ts` — New: Tests for grid level calculation, open/close signals, no duplicates, position sizing, stop-loss, and constructor validation
- `src/server/engine/index.ts` — Modified: Added side-effect import for grid-trading strategy
- `src/server/engine/strategy-registry.ts` — Modified: Extended `StrategyDeps.config` type with grid fields
- `src/server/engine/fund-allocator.ts` — Modified: Added `modeMetadata` store with DB persistence for strategy-specific config
- `src/shared/types.ts` — Modified: Added `gridUpperPrice`, `gridLowerPrice`, `gridLines` to `ModeConfig`
- `src/server/api/mode.ts` — Modified: Added grid fields to PUT config schema, cross-field validation, and DB persistence
- `src/server/api/status.ts` — Modified: Added `getGridConfig()` to include grid values in status response
- `src/client/lib/api.ts` — Modified: Added grid fields to `updateModeConfig` type signature
- `src/client/components/mode-card.tsx` — Modified: Added `GridConfigInputs` component, conditional render for `gridTrading` mode, grid fields in state destructuring

## Change Log

- 2026-04-09: Implemented Grid Trading Strategy (Story 8-12) — full strategy class, tests, API, types, and UI config inputs
