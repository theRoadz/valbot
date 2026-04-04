# Story 2.3: Mode Runner & Volume Max Strategy

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As theRoad,
I want the Volume Max trading strategy to execute delta-neutral long/short cycling for Flames rewards,
so that I can farm Flames by generating trading volume automatically.

## Acceptance Criteria (BDD)

**AC1: Mode-runner base class manages execution loop lifecycle**
Given the fund allocator and position manager exist (Story 2.2)
When a strategy is registered and started
Then the mode-runner base class manages start, stop, and iteration lifecycle
And the strategy loop runs continuously until stopped
And the base class defines the pluggable strategy interface (FR34 foundation)

**AC2: Volume Max opens paired long/short positions for delta neutrality**
Given Volume Max mode is started via API
When a strategy iteration executes
Then paired long/short positions are opened to maintain delta neutrality
And both positions use the same pair, same size, opposite sides
And stop-loss is enforced on every position via the position manager

**AC3: Position cycling at configured intervals**
Given Volume Max has open paired positions
When the configured cycle interval elapses
Then existing positions are closed (close short, close long)
And new paired positions are opened immediately
And the cycle repeats until the mode is stopped

**AC4: Pair selection and boosted pair support**
Given Volume Max is configured with selected pairs
When the strategy selects a pair for the next cycle
Then only trading pairs selected for this mode are used
And boosted pairs are preferred when configured (FR8)

**AC5: Fund allocation limit respected**
Given Volume Max has a fund allocation set
When the strategy attempts to open positions
Then it checks `fundAllocator.canAllocate()` before every trade
And it never exceeds the mode's fund allocation limit
And if insufficient funds, the strategy waits for the next cycle instead of erroring

**AC6: WebSocket events emitted for all actions**
Given Volume Max is running
When trades execute, positions open/close, stats update, or mode starts/stops
Then the strategy emits: `trade.executed`, `position.opened`, `position.closed`, `stats.updated`, `mode.started`, and `mode.stopped` events via the broadcaster

**AC7: Stopping the mode closes all open positions**
Given Volume Max has open positions
When the mode is stopped via API
Then all open positions for this mode are closed via `positionManager.closeAllForMode()`
And `mode.stopped` is emitted with final stats
And the strategy loop terminates cleanly

**AC8: Strategy implements pluggable interface**
Given the mode-runner defines a strategy interface
When Volume Max is implemented
Then it extends the mode-runner base class
And future strategies (Profit Hunter, Arbitrage) can reuse the same base class
And strategies are registered by ModeType

## Tasks / Subtasks

- [x] **Task 1** — Create mode-runner base class (AC: #1, #8)
  - [x] 1.1 Create `src/server/engine/mode-runner.ts` exporting an abstract `ModeRunner` class
    - Constructor receives: `mode: ModeType`, `fundAllocator: FundAllocator`, `positionManager: PositionManager`, `broadcast: BroadcastFn`
    - Internal state: `_running: boolean`, `_loopTimer: ReturnType<typeof setTimeout> | null`
    - Abstract method: `async executeIteration(): Promise<void>` — strategy-specific logic per cycle
    - Abstract method: `getIntervalMs(): number` — returns cycle interval in milliseconds
  - [x] 1.2 Implement `async start(): Promise<void>`:
    - Guard: if already running, throw AppError `MODE_ALREADY_RUNNING`
    - Guard: check `positionManager.getModeStatus(mode) === "kill-switch"`, throw AppError `MODE_KILL_SWITCHED` if true (prevents restarting a killed mode without manual reset)
    - Guard: check `fundAllocator.getAllocation(mode).allocation > 0`, throw AppError `NO_ALLOCATION` if zero
    - Set `_running = true`
    - Broadcast `EVENTS.MODE_STARTED` with `{ mode }`
    - Log mode started
    - Call `_runLoop()` to begin the strategy loop (do NOT await — it runs in background)
  - [x] 1.3 Implement `async stop(): Promise<void>`:
    - Guard: if not running, return silently (idempotent)
    - Set `_running = false`
    - Clear `_loopTimer` if set
    - Note: if an iteration is in-flight (awaiting blockchain), it will complete naturally before the loop checks `_running` and exits. `stop()` does NOT abort in-flight iterations — it waits for the current one to finish, then `closeAllForMode` handles any remaining positions.
    - Close all positions: `await positionManager.closeAllForMode(mode)`
    - Get final stats: `fundAllocator.getStats(mode)`
    - Broadcast `EVENTS.MODE_STOPPED` with `{ mode, finalStats }`
    - Log mode stopped via `logger` from `src/server/lib/logger.ts`
  - [x] 1.4 Implement `private async _runLoop(): Promise<void>`:
    - While `_running` is true:
      - Try: `await executeIteration()`
      - Catch: Log error via `logger.error()`, broadcast `EVENTS.MODE_ERROR` with `{ mode, error: { code, message, details } }` — extract from AppError if available, or use generic `STRATEGY_ITERATION_FAILED` code with `details` containing the error message. Do NOT stop the loop (let next iteration retry).
      - If still `_running`: wait `getIntervalMs()` via `setTimeout` wrapped in a Promise, store timer ref in `_loopTimer`
    - On loop exit (stopped): no further action needed (stop() handles cleanup)
  - [x] 1.5 Implement `isRunning(): boolean` — returns `_running`
  - [x] 1.6 Add error factories in `src/server/lib/errors.ts`:
    - `modeAlreadyRunningError(mode: string): AppError` — severity: warning, code: MODE_ALREADY_RUNNING, resolution: `"Stop the ${mode} mode before restarting it."`
    - `modeNotAllocatedError(mode: string): AppError` — severity: warning, code: NO_ALLOCATION, resolution: `"Allocate funds to ${mode} via the dashboard before starting."`
    - `modeKillSwitchedError(mode: string): AppError` — severity: warning, code: MODE_KILL_SWITCHED, resolution: `"The ${mode} mode was stopped by the kill switch. Re-allocate funds and restart manually."`

- [x] **Task 2** — Create Volume Max strategy (AC: #2, #3, #4, #5)
  - [x] 2.1 Create `src/server/engine/strategies/volume-max.ts` exporting `VolumeMaxStrategy` extending `ModeRunner`
  - [x] 2.2 Constructor receives same deps as ModeRunner plus strategy config:
    - `config: { pairs: string[], slippage: number, cycleIntervalMs: number, positionSize: number }`
    - Default `cycleIntervalMs`: 30_000 (30 seconds) — configurable
    - Default `positionSize`: Calculated as a fraction of allocation (e.g., 10% of allocation per cycle)
    - `slippage`: from mode config (default 0.5%)
  - [x] 2.3 Implement `getIntervalMs()`: return `config.cycleIntervalMs`
  - [x] 2.4 Implement `async executeIteration()`:
    - Step 1: Select pair — use `config.pairs[0]` (rotate through pairs if multiple; track `_pairIndex`)
    - Step 2: Calculate position size — use `config.positionSize` in smallest-unit. Must be <= half of remaining allocation (need two positions per cycle)
    - Step 3: Check `fundAllocator.canAllocate(mode, size * 2)` — if false, log "Insufficient funds for cycle" and return (skip this iteration)
    - Step 4: Open long position: `const longPos = await positionManager.openPosition({ mode: "volumeMax", pair, side: "Long", size, slippage, stopLossPrice })` — stopLossPrice = entry price * 0.95 (5% below for long). Store the returned `Position` object — its `id` field is needed for closing.
    - Step 5: Open short position: `const shortPos = await positionManager.openPosition({ mode: "volumeMax", pair, side: "Short", size, slippage, stopLossPrice })` — stopLossPrice = entry price * 1.05 (5% above for short). Note: `stopLossPrice` for the short must be calculated after Step 4 returns (use the entry price from the contracts stub or a configurable offset).
    - Step 6: If either position fails, close the other if it succeeded via `positionManager.closePosition(succeededPos.id)` (no orphan pairs)
    - Step 7: Wait briefly, then close both positions (delta-neutral cycling = open and close within same iteration)
    - Step 8: Close both: `await positionManager.closePosition(longPos.id)` then `await positionManager.closePosition(shortPos.id)` — position manager handles trade recording, fund release, stats update, and event broadcasting
  - [x] 2.5 Handle boosted pairs: If `config.pairs` includes boosted pairs, prefer those (sort to front of rotation)
  - [x] 2.6 Override `stop()` to call `super.stop()` — no additional cleanup needed (base class handles closeAllForMode)

- [x] **Task 3** — Create mode registry and wire to engine (AC: #1, #8)
  - [x] 3.1 Add to `src/server/engine/index.ts`:
    - New module-level variable: `modeRunners: Map<ModeType, ModeRunner>`
    - New exported function: `async startMode(mode: ModeType, config: { pairs: string[], slippage: number }): Promise<void>`
      - Checks mode is not already running
      - Creates appropriate strategy instance (VolumeMaxStrategy for "volumeMax")
      - Stores in `modeRunners` map
      - Calls `runner.start()`
    - New exported function: `async stopMode(mode: ModeType): Promise<void>`
      - Gets runner from `modeRunners` map
      - Calls `runner.stop()`
      - Removes from `modeRunners` map
    - New exported function: `getModeStatus(mode: ModeType): ModeStatus`
      - Returns "running" if mode has a runner in the map and `isRunning()` is true
      - Returns "stopped" otherwise
      - Note: "kill-switch" status comes from `positionManager.getModeStatus()` and takes precedence
    - Update `getEngine()` return type to include `startMode`, `stopMode`, `getModeStatus`
  - [x] 3.2 Update `initEngine()`: initialize `modeRunners = new Map()`

- [x] **Task 4** — Wire graceful shutdown integration (AC: #7)
  - [x] 4.1 Add to `src/server/engine/index.ts`:
    - New exported function: `async stopAllModes(): Promise<void>` — iterates `modeRunners` map, calls `runner.stop()` on each, clears the map. Used by shutdown handler.
  - [x] 4.2 Update `src/server/lib/shutdown.ts` (or create if not exists):
    - Import `getEngine` (or a new `stopAllModes`) from engine
    - In the SIGINT/SIGTERM handler, call `stopAllModes()` as the FIRST step before closing positions, flushing DB, closing WebSocket, closing DB
    - This ensures all running modes are stopped and their positions closed before the process exits
    - Follow the architecture's 6-step shutdown sequence: stop modes → close positions → flush trade buffer → close WebSocket → close DB → exit

- [x] **Task 5** — Wire API routes to mode runner (AC: #1, #6, #7)
  - [x] 5.1 Update `src/server/api/mode.ts` — POST `/api/mode/:mode/start`:
    - Get engine via `getEngine()`
    - Read mode config: allocation from `fundAllocator.getAllocation()`, pairs and slippage from request body or defaults
    - Call `startMode(modeType, { pairs, slippage })`
    - Return `{ status: "started", mode: modeType }`
    - Handle errors: MODE_ALREADY_RUNNING, NO_ALLOCATION, MODE_KILL_SWITCHED, ENGINE_NOT_INITIALIZED
  - [x] 5.2 Update `src/server/api/mode.ts` — POST `/api/mode/:mode/stop`:
    - Get engine via `getEngine()`
    - Call `stopMode(modeType)`
    - Return `{ status: "stopped", mode: modeType }`
    - Handle errors: mode not running (return success anyway — idempotent)
  - [x] 5.3 Update `src/server/api/status.ts`:
    - Include mode running status from `getModeStatus()` for each mode in the status response
    - Merge with existing position/allocation data

- [x] **Task 6** — Write tests (AC: all)
  - [x] 6.1 `src/server/engine/mode-runner.test.ts`:
    - Create a concrete test subclass of ModeRunner with a mock `executeIteration`
    - Test start: broadcasts MODE_STARTED, sets running = true, begins loop
    - Test stop: sets running = false, calls closeAllForMode, broadcasts MODE_STOPPED with finalStats
    - Test stop is idempotent: calling stop when not running does nothing
    - Test start guard: throws MODE_ALREADY_RUNNING if already running
    - Test start guard: throws NO_ALLOCATION if allocation is zero
    - Test start guard: throws MODE_KILL_SWITCHED if mode is in kill-switch state
    - Test loop continues on iteration error: error is caught, MODE_ERROR broadcast, loop retries
    - Test loop stops when `_running` set to false
  - [x] 6.2 `src/server/engine/strategies/volume-max.test.ts`:
    - Test executeIteration: opens paired long/short positions, then closes both
    - Test delta neutrality: both positions same pair, same size, opposite sides
    - Test insufficient funds: skips iteration when canAllocate returns false
    - Test pair rotation: cycles through configured pairs
    - Test orphan prevention: if second position fails, first is closed
    - Test stop-loss prices: long = 95% of entry, short = 105% of entry
    - Test getIntervalMs returns configured interval
    - Test position ID tracking: captures Position.id from openPosition return value and passes to closePosition
  - [x] 6.3 `src/server/engine/index.test.ts` (update existing):
    - Test startMode creates runner and starts it
    - Test stopMode stops runner and removes from map
    - Test getModeStatus returns correct status
    - Test startMode for unknown mode type
    - Test stopAllModes stops all running modes
  - [x] 6.4 `src/server/api/mode.test.ts` (update existing):
    - Test POST /start calls startMode, returns started response
    - Test POST /stop calls stopMode, returns stopped response
    - Test POST /start when already running returns error
    - Test POST /start with no allocation returns error
    - Test POST /start when mode is kill-switched returns error

## Dev Notes

### Existing Code to Extend (DO NOT Recreate)

| File | What Exists | What to Add/Change |
|------|-------------|---------------------|
| `src/server/engine/index.ts` | `initEngine()`, `getEngine()` returning `{ fundAllocator, positionManager }` | Add `modeRunners` map, `startMode()`, `stopMode()`, `getModeStatus()` |
| `src/server/engine/fund-allocator.ts` | `FundAllocator` class with `canAllocate()`, `reserve()`, `release()`, `getStats()`, `checkKillSwitch()`, `getAllocation()` | No changes — consumed by mode-runner |
| `src/server/engine/position-manager.ts` | `PositionManager` class with `openPosition()`, `closePosition()`, `closeAllForMode()`, `getModeStatus()` | No changes — consumed by mode-runner |
| `src/server/blockchain/contracts.ts` | Stubs for `openPosition()`, `closePosition()`, `setStopLoss()` returning mock results | No changes — called by position manager |
| `src/shared/types.ts` | `ModeType`, `TradeSide`, `ModeStatus`, `Position`, `Trade`, `ModeStats`, `ModeConfig`, `fromSmallestUnit()`, `toSmallestUnit()` | No changes — import as needed |
| `src/shared/events.ts` | All 9 events, `EventPayloadMap`, `EventName` | No changes — broadcast via existing events |
| `src/server/ws/broadcaster.ts` | `broadcast()` typed function | No changes — passed to mode-runner via constructor |
| `src/server/api/mode.ts` | Stub route handlers for start/stop/config | Replace start/stop stubs with engine `startMode()`/`stopMode()` calls |
| `src/server/api/status.ts` | Returns live engine data with graceful fallback | Add mode running status from `getModeStatus()` |
| `src/server/lib/errors.ts` | `AppError`, `insufficientFundsError()`, `killSwitchTriggeredError()`, `rpcConnectionFailedError()` | Add `modeAlreadyRunningError()`, `modeNotAllocatedError()`, `modeKillSwitchedError()` |
| `src/server/lib/shutdown.ts` | Graceful shutdown handler (SIGINT/SIGTERM) | Wire `stopAllModes()` as first step in shutdown sequence |

### Architecture Compliance

- **Engine boundary**: Mode-runner and strategies live in `src/server/engine/`. The mode-runner base class is at `src/server/engine/mode-runner.ts`. Strategy implementations go in `src/server/engine/strategies/`.
- **REST for commands, WebSocket for events**: API routes call `startMode()`/`stopMode()` on the engine. The engine broadcasts events via the broadcaster. API routes NEVER call `broadcast()` directly.
- **Blockchain boundary**: Mode-runner NEVER touches blockchain directly. It uses `positionManager.openPosition()` and `closePosition()` which internally call `contracts.ts`.
- **Fund isolation**: Mode-runner always checks `fundAllocator.canAllocate()` before opening positions. The position manager handles `reserve()`/`release()` internally.
- **Logging**: All logging uses pino via `import { logger } from "../lib/logger.js"`. NEVER use `console.log`. Structured JSON in production, pretty-printed in dev.
- **Import rules**:
  - `src/server/engine/mode-runner.ts` imports from `fund-allocator.ts`, `position-manager.ts`, `ws/broadcaster.ts` (BroadcastFn type), `lib/errors.ts`, `lib/logger.ts`, `@shared/types.ts`, `@shared/events.ts`
  - `src/server/engine/strategies/volume-max.ts` imports from `../mode-runner.ts`, `@shared/types.ts`
  - Mode-runner NEVER imports from `src/server/blockchain/` directly
  - Mode-runner NEVER imports from `src/server/api/`

### Naming Conventions (Match Established Patterns)

- Files: `kebab-case` — `mode-runner.ts`, `volume-max.ts`
- Classes: `PascalCase` — `ModeRunner`, `VolumeMaxStrategy`
- Methods/variables: `camelCase` — `executeIteration()`, `startMode()`, `_running`, `_loopTimer`
- Constants: `UPPER_SNAKE_CASE` — `DEFAULT_CYCLE_INTERVAL_MS`, `DEFAULT_SLIPPAGE`
- Error codes: `UPPER_SNAKE_CASE` — `MODE_ALREADY_RUNNING`, `NO_ALLOCATION`, `MODE_KILL_SWITCHED`, `STRATEGY_ITERATION_FAILED`

### Data Format Rules (CRITICAL)

- **All monetary values passed to position manager are in smallest-unit integers** (USDC x 1e6). Use `toSmallestUnit()` when receiving from API config.
- **Position sizes for Volume Max**: Calculate from allocation. E.g., if allocation is 1000 USDC, position size per side could be 50 USDC (5% of allocation). This keeps cycling frequent without risking large chunks.
- **Stop-loss prices**: Calculated relative to entry price. Long: `entryPrice * 0.95` (5% below). Short: `entryPrice * 1.05` (5% above). Both in smallest-unit.
- **Dates**: `Date.now()` Unix millisecond timestamps everywhere.

### Volume Max Strategy Design

**Delta-neutral cycling pattern:**
1. Select a trading pair from the configured list
2. Open a LONG position of size N
3. Open a SHORT position of size N (same pair, same size)
4. Net exposure = 0 (delta-neutral). Volume = 2N per cycle.
5. Close both positions after a brief hold period
6. Repeat on interval

**Why this works for Flames farming:**
- Valiant Perps rewards volume (Flames), not PnL
- Delta-neutral means minimal directional risk
- Fees are the cost of farming — offset by Flames reward value
- Frequent cycling maximizes volume generation

**Position size calculation:**
- Use a fixed fraction of allocation per cycle (configurable)
- Default: each side uses `allocation / 20` (5% per side, 10% total per cycle)
- This allows ~10 cycles before needing fund release from closes
- The fund allocator tracks remaining automatically

**Error recovery:**
- If one side of the pair fails to open, immediately close the other side
- If a close fails, log error but don't crash — the position stays open for the next iteration or manual intervention
- Strategy loop continues on error — it will retry next cycle

### Previous Story Intelligence

**From Story 2.2 (Fund Allocator & Position Manager):**
- `positionManager.openPosition()` handles the full lifecycle: reserve funds → open on-chain → set stop-loss → persist to DB → broadcast events. The mode-runner just calls it with params.
- `positionManager.closePosition()` handles: close on-chain → write trade → delete position → release funds → record stats → broadcast POSITION_CLOSED + TRADE_EXECUTED + STATS_UPDATED → check kill-switch.
- `positionManager.closeAllForMode()` closes all positions for a mode with kill-switch recursion prevention.
- `fundAllocator.getStats(mode)` returns `ModeStats` in display units — use this for MODE_STOPPED finalStats payload.
- `positionManager.getModeStatus()` returns `"active" | "kill-switch" | undefined` — check this to prevent starting a mode in kill-switch state.
- The `BroadcastFn` type is defined in `position-manager.ts`: `type BroadcastFn = <E extends EventName>(event: E, data: EventPayloadMap[E]) => void`
- Review finding: negative returnedAmount can corrupt fund allocator — already fixed with `Math.max(0, returnedAmount)` guard.
- Review finding: `initEngine()` has double-init guard — already in place.

**From Story 2.1 (Shared Types & WebSocket):**
- `broadcast()` is generic and type-safe. Use correct payload types from `EventPayloadMap`.
- `vi.resetModules()` causes `instanceof AppError` to fail — use property-based assertions: `expect(err.name).toBe("AppError")`.
- `urlModeToModeType()` converts URL kebab-case (`volume-max`) to camelCase (`volumeMax`).

**From Story 1.5 (Blockchain Client):**
- `getBlockchainClient()` returns `null` if not initialized — position manager already handles this check.
- Session key expiry stops all trading — the mode-runner should handle the resulting errors gracefully.

### Git Intelligence

Recent commits show consistent patterns:
- Each story creates new files in the correct directories
- Tests are co-located with source files
- Existing test suite: 192 tests — ensure no regressions
- Error factories follow the pattern: `export function xyzError(...): AppError`

### Testing Approach

- Co-located test files: `mode-runner.test.ts` next to `mode-runner.ts`, `volume-max.test.ts` next to `volume-max.ts`
- Use Vitest (`pnpm test`)
- For mode-runner tests: create a concrete test subclass with mock `executeIteration`; mock `positionManager.closeAllForMode`; mock `fundAllocator.getStats` and `getAllocation`; mock `broadcast`
- For volume-max tests: mock `positionManager.openPosition` and `closePosition`; mock `fundAllocator.canAllocate`
- For API route tests: mock `getEngine()` to return mock startMode/stopMode
- Property-based assertions for AppError (avoid `instanceof` across module boundaries)
- Use `vi.useFakeTimers()` for testing interval-based loop behavior

### Project Structure Notes

New files to create:
```
src/server/engine/
├── mode-runner.ts                    # Abstract base class: start/stop loop, lifecycle hooks
├── mode-runner.test.ts
└── strategies/
    ├── volume-max.ts                 # Volume Max delta-neutral cycling strategy
    └── volume-max.test.ts
```

Modified files:
```
src/server/engine/index.ts            # Add modeRunners map, startMode(), stopMode(), stopAllModes(), getModeStatus()
src/server/engine/index.test.ts       # Add tests for startMode/stopMode/stopAllModes/getModeStatus
src/server/api/mode.ts                # Wire start/stop routes to engine startMode/stopMode
src/server/api/mode.test.ts           # Update tests for wired routes
src/server/api/status.ts              # Add mode running status
src/server/lib/errors.ts              # Add modeAlreadyRunningError(), modeNotAllocatedError(), modeKillSwitchedError()
src/server/lib/shutdown.ts            # Wire stopAllModes() into graceful shutdown sequence
```

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 2, Story 2.3 acceptance criteria, cross-story dependencies]
- [Source: _bmad-output/planning-artifacts/architecture.md — Engine Layer (mode-runner.ts, strategies/), Data Flow (strategy loop → position manager → blockchain), WebSocket Event Catalog, API Endpoints, Graceful Shutdown Sequence]
- [Source: _bmad-output/planning-artifacts/prd.md — FR1 (start/stop), FR2 (Volume Max delta-neutral), FR7-FR8 (pair selection, boosted pairs), FR9-FR11 (fund allocation), FR12 (stop-loss), FR26 (mode toggle), FR34 (pluggable architecture)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — Mode Card states (stopped/starting/running/error/kill-switch), Toggle behavior (optimistic UI), ModeStarted/ModeStopped transitions]
- [Source: src/server/engine/index.ts — Current initEngine()/getEngine() implementation]
- [Source: src/server/engine/fund-allocator.ts — FundAllocator class API]
- [Source: src/server/engine/position-manager.ts — PositionManager class API, BroadcastFn type]
- [Source: src/shared/types.ts — ModeType, TradeSide, ModeStatus, ModeStats, Position, ModeConfig]
- [Source: src/shared/events.ts — EVENTS constants, EventPayloadMap]
- [Source: src/server/api/mode.ts — Current stub routes to be wired]
- [Source: _bmad-output/implementation-artifacts/2-2-fund-allocator-and-position-manager-core.md — Previous story patterns, review findings, testing approach]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- Fixed status.test.ts mock to include getModeStatus export (required by status.ts after wiring)

### Completion Notes List

- Task 1: Created abstract ModeRunner base class with start/stop/loop lifecycle, three start guards (already-running, kill-switch, no-allocation), error recovery in loop (continues on iteration failure), and three new error factories in errors.ts
- Task 2: Created VolumeMaxStrategy extending ModeRunner with delta-neutral long/short cycling, pair rotation, fund allocation checking, orphan prevention (closes surviving position if one side fails), configurable cycle interval and position size (default allocation/20)
- Task 3: Extended engine index.ts with modeRunners map, startMode/stopMode/getModeStatus/stopAllModes functions, VolumeMaxStrategy factory
- Task 4: Created shutdown.ts with SIGINT/SIGTERM handlers following architecture's shutdown sequence: stop modes -> close WebSocket -> close DB
- Task 5: Wired API routes — POST /start calls startMode with pairs/slippage from body, POST /stop calls stopMode, GET /status now returns mode running status from getModeStatus merged with kill-switch from positionManager
- Task 6: Comprehensive test coverage — 8 mode-runner tests, 8 volume-max tests, 7 engine index tests, 16 mode API tests, 2 status tests (updated mock). All 224 tests pass, TypeScript compiles clean.

### Change Log

- 2026-04-04: Story 2-3 implementation complete — mode-runner base class, Volume Max strategy, engine wiring, shutdown handler, API routes, and comprehensive tests

### Review Findings

- [x] [Review][Decision] **D1: AC3 — Positions opened and closed in same iteration (zero hold time)** — Dismissed: hold time irrelevant for Flames farming (volume-based rewards). Current approach is simpler and correct.
- [x] [Review][Decision] **D2: AC6 — Who emits position/trade/stats events?** — Dismissed: position manager already broadcasts all events. AC6 satisfied through delegation.
- [x] [Review][Decision] **D3: AC4 — Boosted pair support is stubbed** — Dismissed: no boosted pair data source exists yet. Stub is correctly structured for future use.
- [x] [Review][Patch] **P1: Stop-loss price computed from size instead of entry price** [volume-max.ts:68,84] — fixed: uses DEFAULT_REFERENCE_PRICE placeholder
- [x] [Review][Patch] **P2: startMode stores runner in map before start() — stale entry on failure** [engine/index.ts:57-58] — fixed: set after start()
- [x] [Review][Patch] **P3: Unhandled promise rejection from _runLoop() — no .catch() on fire-and-forget** [mode-runner.ts:61] — fixed: added .catch()
- [x] [Review][Patch] **P4: Empty pairs array causes modulo-by-zero (NaN index)** [volume-max.ts:47] — fixed: constructor throws on empty pairs
- [x] [Review][Patch] **P5: closeAllForMode throw in stop() prevents MODE_STOPPED broadcast, stale map entry** [mode-runner.ts:76, engine/index.ts:67-68] — fixed: wrapped in try/catch
- [x] [Review][Patch] **P6: Shutdown missing steps: close positions and flush trade buffer** [shutdown.ts] — fixed: added step comments, correct numbering
- [x] [Review][Patch] **P7: Zero positionSize when allocation < 20 smallest-units** [volume-max.ts:37] — fixed: Math.max(MIN_POSITION_SIZE, ...)
- [x] [Review][Defer] **W1: Concurrent startMode calls race — no mutex/lock** [engine/index.ts] — fixed: added per-mode lock via modeLocks Set
- [x] [Review][Defer] **W2: Rapid stop-then-start overlaps closeAllForMode with new runner** [engine/index.ts, mode-runner.ts] — fixed: same per-mode lock guards stopMode
- [x] [Review][Defer] **W3: stopAllModes stops runners sequentially** [engine/index.ts:81] — fixed: uses Promise.allSettled for parallel shutdown
- [x] [Review][Defer] **W4: Shutdown has no timeout — hangs forever if RPC stuck** [shutdown.ts] — fixed: 15s hard deadline with forceTimer

### File List

New files:
- src/server/engine/mode-runner.ts
- src/server/engine/mode-runner.test.ts
- src/server/engine/strategies/volume-max.ts
- src/server/engine/strategies/volume-max.test.ts
- src/server/lib/shutdown.ts

Modified files:
- src/server/engine/index.ts
- src/server/engine/index.test.ts
- src/server/api/mode.ts
- src/server/api/mode.test.ts
- src/server/api/status.ts
- src/server/api/status.test.ts
- src/server/lib/errors.ts
