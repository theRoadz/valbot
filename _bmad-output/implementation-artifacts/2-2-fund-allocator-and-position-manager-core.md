# Story 2.2: Fund Allocator & Position Manager Core

Status: done

## Story

As a developer,
I want the fund allocator to track per-mode fund isolation and the position manager to handle opening/closing positions with stop-loss enforcement,
so that the trading engine has its safety and fund management foundation before any strategy can execute trades.

## Acceptance Criteria (BDD)

**AC1: Fund allocator enforces per-mode isolation**
Given three modes (volumeMax, profitHunter, arbitrage) each with independent allocations
When a mode requests to open a position
Then the fund allocator checks the mode has sufficient remaining allocation before allowing the trade
And the fund allocator prevents cross-mode fund access — each mode can only use its own allocated funds
And the fund allocator tracks remaining balance per mode in memory, updated on every position open/close

**AC2: Fund allocator persists allocation config**
Given the config DB table exists from Story 1.2
When a mode's fund allocation is set or updated via the API
Then the allocation is persisted in the config table (key: `allocation:{modeType}`, value: JSON string of amount in smallest-unit)
And on engine startup, allocations are loaded from config table to restore state

**AC3: Position manager opens positions through blockchain interface**
Given a mode has sufficient allocation
When the position manager opens a position
Then it calls the blockchain contracts interface to submit the on-chain transaction
And every position-opening transaction confirms stop-loss is set before the position is considered active (NFR8)
And the position is tracked in-memory and synced to the positions DB table
And the fund allocator's remaining balance for that mode is decremented by the position size

**AC4: Position manager handles failed transactions safely**
Given a position open is attempted
When the on-chain transaction fails at any stage
Then no orphaned positions exist — if open succeeds but stop-loss set fails, the position is immediately closed
And the fund allocator's remaining balance is restored (not decremented)
And an `AppError` is thrown with details and resolution
And no partial state is left in the positions DB table

**AC5: Position manager closes positions and updates state**
Given one or more open positions exist for a mode
When the position manager closes a position
Then the blockchain contracts interface is called to close the on-chain position
And the position is removed from in-memory tracking and the positions DB table
And the fund allocator's remaining balance for that mode is incremented by the returned amount
And a trade record is written to the trades DB table (with pnl, fees, timestamps)

**AC6: Position manager supports close-all-for-mode**
Given a mode has multiple open positions
When closeAllForMode(mode) is called (used by kill-switch and mode stop)
Then all positions for that mode are closed sequentially
And each close follows AC5 behavior but skips the per-close kill-switch re-check (to prevent infinite recursion)
And the function returns a summary of all closed positions
Note: This capability is forward-pulled from Story 2.3 (mode stop) and Story 3.1 (kill-switch). Those stories will use this method, not re-implement it.

**AC7: Kill-switch threshold detection**
Given a mode is running with allocated funds
When cumulative realized losses cause the mode's remaining balance to drop to 90% or less of its original allocation (i.e., `remaining <= allocation * 0.9`)
Then the fund allocator triggers the kill-switch for that mode
And all positions for that mode are closed via the position manager (AC6)
And an `alert.triggered` event is broadcast with severity `critical`, code `KILL_SWITCH_TRIGGERED`, and details (positions closed, loss amount)
And the mode status is set to `kill-switch`
Note: "remaining" reflects the current value of the mode's portfolio after realized losses, NOT simply "allocation minus deployed position sizes." Opening a position decrements remaining by position size; closing increments by the returned amount (size + pnl - fees). The kill-switch detects when cumulative losses erode the allocation, not when funds are merely deployed into positions.

**AC8: Crash recovery from positions DB**
Given the bot restarts after an unexpected shutdown
When the engine initializes
Then the position manager loads all rows from the positions DB table
And these are treated as potentially orphaned positions requiring reconciliation
And the fund allocator restores mode allocations from the config table
Note: This is the foundation for crash recovery — forward-pulled from Story 3.2. Story 3.2 will extend this with active orphaned-position closing and full graceful shutdown sequencing.

**AC9: Blockchain contracts interface is defined**
Given no `src/server/blockchain/contracts.ts` exists yet
When this story is complete
Then `contracts.ts` exports typed functions for on-chain operations: `openPosition()`, `closePosition()`, `setStopLoss()`
And the implementations are **stubs** returning mock results (actual on-chain integration deferred to when FOGOChain devnet is available)
And the stub interface matches what the position manager expects so it can be swapped for real implementations later

## Tasks / Subtasks

- [x] **Task 1** — Create blockchain contracts interface stubs (AC: #9)
  - [x] 1.1 Create `src/server/blockchain/contracts.ts` exporting:
    - `openPosition(params: OpenPositionParams): Promise<OpenPositionResult>` — stub returns mock txHash + positionId
    - `closePosition(params: ClosePositionParams): Promise<ClosePositionResult>` — stub returns mock txHash + pnl + fees
    - `setStopLoss(params: SetStopLossParams): Promise<SetStopLossResult>` — stub returns mock txHash
  - [x] 1.2 Define param/result interfaces in the same file:
    - `OpenPositionParams`: `{ connection: Connection, keypair: Keypair, pair: string, side: TradeSide, size: number, slippage: number }` — size in smallest-unit
    - `OpenPositionResult`: `{ txHash: string, positionId: string, entryPrice: number }` — entryPrice in smallest-unit
    - `ClosePositionParams`: `{ connection: Connection, keypair: Keypair, positionId: string, pair: string, side: TradeSide, size: number }` — size in smallest-unit
    - `ClosePositionResult`: `{ txHash: string, exitPrice: number, pnl: number, fees: number }` — all smallest-unit
    - `SetStopLossParams`: `{ connection: Connection, keypair: Keypair, positionId: string, stopLossPrice: number }` — smallest-unit
    - `SetStopLossResult`: `{ txHash: string }`
  - [x] 1.3 Stubs generate mock data: entry price = `100_000_000` (100 USDC), fees = 0.1% of size, txHash = `"mock-tx-" + Date.now() + "-" + counter++` (module-level counter for uniqueness). For `closePosition`, pnl defaults to 0 (break-even) — tests that need specific pnl values should mock the contracts module via `vi.mock()` rather than relying on stub randomness
  - [x] 1.4 Add `TODO: Replace stubs with real Valiant Perps contract calls` comment at top

- [x] **Task 2** — Create fund allocator module (AC: #1, #2, #7)
  - [x] 2.1 Create `src/server/engine/fund-allocator.ts` exporting a `FundAllocator` class (not singleton — instantiated by engine on startup)
  - [x] 2.2 Internal state: `Map<ModeType, { allocation: number, remaining: number, trades: number, volume: number, pnl: number }>` — monetary values in smallest-unit integers, trades as count
  - [x] 2.3 Methods:
    - `setAllocation(mode: ModeType, amount: number): void` — sets total allocation for a mode; validates `assertSafeInteger()`; persists to config DB via `getDb()` + Drizzle; updates remaining = allocation - sumOfOpenPositionSizes
    - `getAllocation(mode: ModeType): { allocation: number, remaining: number }` — returns current state (0/0 if unset)
    - `canAllocate(mode: ModeType, size: number): boolean` — checks `remaining >= size`
    - `reserve(mode: ModeType, size: number): void` — decrements remaining; throws AppError `INSUFFICIENT_FUNDS` if insufficient
    - `release(mode: ModeType, amount: number): void` — increments remaining (capped at allocation)
    - `recordTrade(mode: ModeType, size: number, pnl: number): void` — increments `trades` count by 1, adds `size` to `volume`, adds `pnl` to cumulative `pnl`. Called by position manager after each trade close.
    - `checkKillSwitch(mode: ModeType): boolean` — returns true if cumulative losses have eroded remaining to `<= allocation * 0.9`
    - `loadFromDb(): Promise<void>` — reads config table for `allocation:volumeMax`, `allocation:profitHunter`, `allocation:arbitrage` keys; restores state
    - `getStats(mode: ModeType): ModeStats` — returns stats object for WebSocket/API consumption (converts to display units via `fromSmallestUnit()`). The fund allocator tracks `allocated` and `remaining`; it also maintains running counters for `trades` (count), `volume` (sum of trade sizes), and `pnl` (sum of trade pnl). These counters are incremented by the position manager calling `recordTrade(mode: ModeType, size: number, pnl: number): void` after each close. This keeps all per-mode stats in one place.
  - [x] 2.4 Config DB persistence format: key = `allocation:{modeType}` (e.g., `allocation:volumeMax`), value = JSON `{ amount: number }` where amount is smallest-unit
  - [x] 2.5 Fund allocator NEVER accesses blockchain — it only tracks numbers. The position manager is responsible for calling blockchain contracts.

- [x] **Task 3** — Create position manager module (AC: #3, #4, #5, #6, #8)
  - [x] 3.1 Create `src/server/engine/position-manager.ts` exporting a `PositionManager` class
  - [x] 3.2 Constructor receives: `fundAllocator: FundAllocator`, `broadcaster: BroadcastFn`
    - Define `BroadcastFn` type in `position-manager.ts`: `type BroadcastFn = <E extends EventName>(event: E, data: EventPayloadMap[E]) => void` — this matches the exact signature of `broadcast()` from `src/server/ws/broadcaster.ts` (line 65)
  - [x] 3.3 Internal state: `Map<number, Position>` keyed by DB position id — mirrors the positions DB table
  - [x] 3.4 Methods:
    - `async openPosition(params: { mode: ModeType, pair: string, side: TradeSide, size: number, slippage: number, stopLossPrice: number }): Promise<Position>` — size and stopLossPrice in smallest-unit
      - Step 1: `fundAllocator.reserve(mode, size)` — throws if insufficient
      - Step 2: Call `contracts.openPosition()` — if fails, call `fundAllocator.release()` and throw
      - Step 3: Call `contracts.setStopLoss()` — if fails, call `contracts.closePosition()`, `fundAllocator.release()`, and throw (no orphans)
      - Step 4: Insert row into positions DB table via `getDb()` + Drizzle
      - Step 5: Add to in-memory map
      - Step 6: Broadcast `EVENTS.POSITION_OPENED` via broadcaster
      - Step 7: Return the Position object (display-unit via `fromSmallestUnit()`)
    - `async closePosition(positionId: number, opts?: { skipKillSwitchCheck?: boolean }): Promise<ClosePositionResult & { position: Position }>`
      - Step 1: Look up position in memory map
      - Step 2: Call `contracts.closePosition()` to close on-chain
      - Step 3: Write trade record to trades DB table (with pnl, fees from result)
      - Step 4: Delete position row from positions DB table
      - Step 5: Remove from in-memory map
      - Step 6: `fundAllocator.release(mode, returnedAmount)` — returnedAmount = size + pnl - fees (can be less than size if trade lost money)
      - Step 7: `fundAllocator.recordTrade(mode, size, pnl)` — updates running stats counters
      - Step 8: Broadcast `EVENTS.POSITION_CLOSED`, `EVENTS.TRADE_EXECUTED`, and `EVENTS.STATS_UPDATED` (with current `fundAllocator.getStats(mode)`)
      - Step 9: Unless `opts.skipKillSwitchCheck` is true: check `fundAllocator.checkKillSwitch(mode)` — if triggered, call `closeAllForMode(mode)` and broadcast alert
      - Step 10: Return close result
    - `async closeAllForMode(mode: ModeType): Promise<CloseSummary>` — sets `_killSwitchActive` guard for the mode, then closes all positions sequentially via `closePosition(id, { skipKillSwitchCheck: true })` to prevent infinite recursion; returns summary (count, totalPnl, positions closed)
    - `getPositions(mode?: ModeType): Position[]` — returns current open positions (optionally filtered by mode); values in display units
    - `async loadFromDb(): Promise<void>` — loads positions DB table into memory on startup (crash recovery)
  - [x] 3.5 All DB writes use `assertSafeInteger()` before inserting integer columns
  - [x] 3.6 All monetary values passed to contracts and DB are in smallest-unit; values returned to callers/broadcast are in display units via `fromSmallestUnit()`
  - [x] 3.7 The position manager uses pino logger for all operations (open, close, error, kill-switch)

- [x] **Task 4** — Wire engine modules to API routes (AC: #1, #2, #3)
  - [x] 4.1 Create `src/server/engine/index.ts` that exports engine initialization:
    - `async initEngine(): Promise<void>` — creates FundAllocator + PositionManager instances, calls `loadFromDb()` on both, stores in module-level variables
    - `getEngine(): { fundAllocator: FundAllocator, positionManager: PositionManager }` — returns cached instances (throws if not initialized)
  - [x] 4.2 Update `src/server/index.ts` to call `initEngine()` during server startup (after DB init, before routes listen)
  - [x] 4.3 Update `src/server/api/status.ts`:
    - Replace stub `positions: []` with `positionManager.getPositions()`
    - Replace stub mode configs with live data from `fundAllocator.getAllocation()` for each mode
    - Guard with try/catch around `getEngine()` — if engine not initialized, fall back to existing default stubs (this handles the case where blockchain init failed but server still serves the dashboard)
  - [x] 4.4 Update `src/server/api/mode.ts`:
    - `PUT /api/mode/:mode/config` — when `allocation` is provided in body, call `fundAllocator.setAllocation(mode, toSmallestUnit(allocation))` to persist it
    - Start/stop routes remain stubs (Story 2.3 implements mode-runner)

- [x] **Task 5** — Write tests (AC: all)
  - [x] 5.1 `src/server/blockchain/contracts.test.ts` — verify stub functions return expected shapes, entry price format, fee calculation
  - [x] 5.2 `src/server/engine/fund-allocator.test.ts`:
    - Set allocation, verify remaining tracks correctly
    - Reserve funds, verify remaining decrements
    - Release funds, verify remaining increments (capped at allocation)
    - canAllocate returns false when insufficient
    - reserve throws `INSUFFICIENT_FUNDS` AppError when insufficient
    - Kill-switch detection at exactly 10% loss threshold and above
    - Kill-switch does NOT trigger from merely deploying funds into positions (only from realized losses)
    - Cross-mode isolation: allocating/reserving in one mode doesn't affect another
    - recordTrade increments trades count, accumulates volume and pnl
    - getStats returns correct ModeStats with all 5 fields in display units
    - Config DB persistence: setAllocation writes to DB, loadFromDb restores state
    - assertSafeInteger guards on allocation values
  - [x] 5.3 `src/server/engine/position-manager.test.ts`:
    - Open position: reserves funds, calls contracts, sets stop-loss, inserts DB, broadcasts event
    - Open position rollback: if setStopLoss fails, position is closed and funds released
    - Open position rollback: if openPosition fails, funds released, no DB row
    - Close position: calls contracts, writes trade, deletes position, releases funds, records trade stats, broadcasts POSITION_CLOSED + TRADE_EXECUTED + STATS_UPDATED
    - Close triggers kill-switch check: when cumulative loss threshold breached, closeAllForMode is called
    - closeAllForMode: closes all mode positions with skipKillSwitchCheck — no infinite recursion
    - closeAllForMode does not re-trigger kill-switch check on individual closes
    - getPositions: returns display-unit values, filters by mode
    - loadFromDb: restores positions from DB
  - [x] 5.4 `src/server/engine/index.test.ts` — verify initEngine creates instances and getEngine returns them
  - [x] 5.5 Update `src/server/api/status.test.ts` — verify status route returns live position/allocation data from engine
  - [x] 5.6 Update `src/server/api/mode.test.ts` — verify PUT config route persists allocation via fund allocator

## Dev Notes

### Existing Code to Extend (DO NOT Recreate)

| File | What Exists | What to Add/Change |
|------|-------------|---------------------|
| `src/server/blockchain/client.ts` | `BlockchainClient` interface, `initBlockchainClient()`, `getBlockchainClient()`, `getWalletBalance()` | No changes — position manager accesses client via `getBlockchainClient()` |
| `src/server/db/schema.ts` (tables) | `trades`, `positions`, `sessions`, `config` tables with Drizzle types | No changes — use existing tables as-is |
| `src/server/db/index.ts` | `getDb()` lazy connection, `closeDb()` | No changes — engine modules call `getDb()` for queries |
| `src/server/db/schema.ts` (exports) | `assertSafeInteger()`, table definitions, inferred types | No schema changes — import `assertSafeInteger` from here for DB write guards |
| `src/shared/types.ts` | `Trade`, `Position`, `ModeConfig`, `ModeStats`, `ModeType`, `TradeSide`, `fromSmallestUnit()`, `toSmallestUnit()` | No changes — reuse all existing types |
| `src/shared/events.ts` | All 9 events + `EventPayloadMap`, type-safe `broadcast()` | No changes — engine broadcasts via existing events |
| `src/server/ws/broadcaster.ts` | `broadcast()`, `setupWebSocket()`, `closeWebSocket()` | No changes — position manager receives `broadcast` as dependency |
| `src/server/lib/errors.ts` | `AppError` class + existing error factories | Add new factory: `insufficientFundsError(mode, requested, available)` and `killSwitchTriggeredError(mode, details)` |
| `src/server/api/mode.ts` | Stub route handlers for start/stop/config | Update config handler to call `fundAllocator.setAllocation()` when allocation field present |
| `src/server/api/status.ts` | Stub returning empty arrays and defaults | Replace stubs with live engine data |
| `src/server/index.ts` | Server setup, route registration, blockchain init | Add `initEngine()` call after blockchain init |

### Architecture Compliance

- **Engine boundary**: `src/server/engine/` owns all trading logic and state. Fund allocator and position manager live here.
- **REST for commands, WebSocket for events**: API routes call engine functions; engine broadcasts events via broadcaster. API routes NEVER call `broadcast()` directly.
- **Blockchain boundary**: Only `src/server/blockchain/contracts.ts` touches on-chain operations. Position manager calls contracts through typed interface.
- **DB boundary**: Engine modules access DB via `getDb()` + Drizzle ORM. No raw SQL.
- **Import rules**:
  - `src/server/engine/` imports from `blockchain/`, `db/`, `ws/`, `lib/`, and `@shared/`
  - `src/server/api/` imports from `engine/` (via `getEngine()`) — NEVER from `blockchain/` or `db/` directly
  - `src/server/blockchain/` NEVER imports from `engine/` or `ws/`

### Naming Conventions (Match Established Patterns)

- Files: `kebab-case` — `fund-allocator.ts`, `position-manager.ts`, `contracts.ts`
- Classes: `PascalCase` — `FundAllocator`, `PositionManager`
- Methods/variables: `camelCase` — `setAllocation()`, `openPosition()`, `canAllocate()`
- Constants: `UPPER_SNAKE_CASE` — `KILL_SWITCH_THRESHOLD` (= 0.9)
- Error codes: `UPPER_SNAKE_CASE` — `INSUFFICIENT_FUNDS`, `KILL_SWITCH_TRIGGERED`, `POSITION_OPEN_FAILED`

### Data Format Rules (CRITICAL)

- **All monetary values in engine/DB are smallest-unit integers** (USDC x 1e6). Use `toSmallestUnit()` when receiving from API (display units) and `fromSmallestUnit()` when sending to API/WebSocket.
- **Dates**: `Date.now()` Unix millisecond timestamps everywhere
- **Nulls**: explicit `null` for absent optionals, never `undefined` in payloads
- **Use `assertSafeInteger()`** before every DB integer write to prevent precision loss
- The `config` table stores values as JSON strings: `{ amount: 1000000000 }` (not raw numbers)

### Contract Stub Design

The `contracts.ts` stubs exist to define the interface that real blockchain calls will implement. Stubs should:
- Accept the same params as real calls (Connection, Keypair, etc.)
- Return the same result shapes with mock data
- Simulate realistic latency: `await new Promise(r => setTimeout(r, 50))` — 50ms per call
- Use deterministic mock prices: entry = `100_000_000` (100 USDC), exit varies by +-5%
- Generate unique mock txHashes: `"mock-tx-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8)`
- The `connection` and `keypair` params are unused in stubs but must be accepted for interface compatibility

### Kill-Switch Implementation Details

- **Threshold**: `KILL_SWITCH_THRESHOLD = 0.9` — triggers when `remaining <= allocation * 0.9`
- **What "remaining" means**: `remaining` starts at `allocation`. Opening a position decrements by `size`. Closing increments by `returnedAmount` (= size + pnl - fees). If trades lose money, `remaining` drops below `allocation`. The kill-switch detects when cumulative losses erode the remaining balance to 90% or less of the original allocation — NOT when funds are merely deployed into positions.
- **Check timing**: After every `closePosition()` call (unless called from `closeAllForMode()`), the position manager checks the fund allocator's kill-switch status
- **Recursion prevention**: `closeAllForMode()` calls `closePosition()` with `{ skipKillSwitchCheck: true }` to prevent re-triggering. Additionally, a `_killSwitchActive: Set<ModeType>` guard prevents re-entry.
- **Cascade prevention**: Once kill-switch triggers for a mode, that mode's status becomes `"kill-switch"` and no further trades are allowed until manually reset
- **Isolation**: Kill-switch for one mode MUST NOT affect other modes. Each mode's allocation is completely independent.
- **Alert payload**: `{ severity: "critical", code: "KILL_SWITCH_TRIGGERED", message: "Kill switch triggered on {modeName}", details: "Closed {count} positions. Loss: ${amount}.", resolution: "Review positions and re-allocate funds to restart the mode." }`

### Dependency Injection Pattern

The position manager receives its dependencies via constructor rather than importing singletons directly. This enables testing without mocking module imports:

```typescript
// Production wiring (in engine/index.ts)
const fundAllocator = new FundAllocator();
const positionManager = new PositionManager(fundAllocator, broadcast);

// Test wiring
const mockAllocator = new FundAllocator();
const mockBroadcast = vi.fn();
const pm = new PositionManager(mockAllocator, mockBroadcast);
```

The fund allocator accesses DB via `getDb()` directly (not injected) — this matches the existing `getDb()` lazy pattern used throughout the server.

### Blockchain Client Access Pattern

The position manager accesses the blockchain client via `getBlockchainClient()` from `blockchain/client.ts`. In production, the client is initialized at server startup. In tests, the contracts are stubbed, so the blockchain client doesn't need to exist.

```typescript
// Inside position manager methods
const client = getBlockchainClient();
if (!client) throw new AppError({ severity: "critical", code: "NO_BLOCKCHAIN_CLIENT", ... });
const result = await openPosition({ connection: client.connection, keypair: client.keypair, ... });
```

### Previous Story Intelligence

**From Story 2.1:**
- `broadcast()` is generic: `broadcast<E extends EventName>(event: E, data: EventPayloadMap[E])` — use correct payload types
- `vi.resetModules()` causes `instanceof AppError` to fail — use property-based assertions: `expect(err.name).toBe("AppError")`
- Error handler extracted to `src/server/lib/error-handler.ts`
- `urlModeToModeType()` converts URL kebab-case to camelCase ModeType
- `fromSmallestUnit()` and `toSmallestUnit()` are in `src/shared/types.ts` — use for all API/WS boundary conversions

**From Story 1.5:**
- `getBlockchainClient()` returns `null` if not initialized — always null-check before use
- Session key and RPC connection validated at startup; engine init should happen AFTER blockchain init
- `getWalletBalance()` returns smallest-unit integer — consistent with fund allocator's internal format

**From Story 1.2:**
- `getDb()` is lazy — first call opens the connection. Safe to call from engine modules.
- `assertSafeInteger()` exported from `src/server/db/schema.ts` — import and use before every integer DB write
- Config table uses `key: text (PK), value: text` — store allocations as JSON strings

### Testing Approach

- Co-located test files: `fund-allocator.test.ts` next to `fund-allocator.ts`, etc.
- Use Vitest (`pnpm test`)
- For DB tests: use real SQLite via `getDb()` with a test database (set `VALBOT_DB_PATH` env var)
- For position manager tests: mock `contracts` module and `broadcast` function; use real `FundAllocator` with real DB
- Property-based assertions for AppError (avoid `instanceof` across module boundaries)
- Existing test suite: 136 tests — ensure no regressions

### Project Structure Notes

New files to create:
```
src/server/blockchain/
└── contracts.ts              # Blockchain contract stubs (open/close/stop-loss)
    contracts.test.ts

src/server/engine/
├── index.ts                  # Engine initialization + getEngine()
├── index.test.ts
├── fund-allocator.ts         # Per-mode fund tracking and isolation
├── fund-allocator.test.ts
├── position-manager.ts       # Position lifecycle + kill-switch
└── position-manager.test.ts
```

Modified files:
```
src/server/lib/errors.ts      # Add insufficientFundsError() and killSwitchTriggeredError() factories
src/server/api/status.ts      # Replace stubs with live engine data
src/server/api/mode.ts        # Wire config route to fund allocator
src/server/index.ts           # Add initEngine() call
```

### References

- [Source: _bmad-output/planning-artifacts/architecture.md — Engine Layer, Fund Allocation (FR9-FR11), Position Management (FR12-FR15), Blockchain Boundary, Data Flow]
- [Source: _bmad-output/planning-artifacts/epics.md — Epic 2, Story 2.2 acceptance criteria]
- [Source: _bmad-output/planning-artifacts/prd.md — FR9-FR15 (Fund Allocation, Position Management), NFR8 (stop-loss mandatory), Trading Safety]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — Kill-switch UX (Journey 3), FundAllocationBar states, ModeCard props]
- [Source: src/server/db/schema.ts — trades/positions/config table definitions]
- [Source: src/server/blockchain/client.ts — BlockchainClient interface, getBlockchainClient()]
- [Source: src/shared/types.ts — ModeType, TradeSide, Position, Trade, ModeStats, fromSmallestUnit/toSmallestUnit]
- [Source: src/shared/events.ts — EVENTS constants, EventPayloadMap, broadcast signature]
- [Source: _bmad-output/implementation-artifacts/2-1-shared-types-websocket-event-system-and-rest-api-skeleton.md — Previous story patterns and learnings]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

None — implementation completed without blocking issues.

### Completion Notes List

- Task 1: Created `contracts.ts` with typed stubs for `openPosition`, `closePosition`, `setStopLoss`. All accept Connection/Keypair params for interface compatibility, return mock data with 50ms simulated latency. 5 tests.
- Task 2: Created `FundAllocator` class with per-mode fund isolation, config DB persistence, kill-switch detection at 10% loss threshold, trade stats tracking, and display-unit conversion via `getStats()`. 24 tests covering allocation, reserve/release, kill-switch, cross-mode isolation, DB persistence, and safe integer guards.
- Task 3: Created `PositionManager` class with full position lifecycle (open/close/closeAll), rollback safety on failed transactions, kill-switch integration, trade record persistence, and multi-event broadcasting. 9 tests covering open, close, rollback scenarios, kill-switch trigger/recursion prevention, position filtering, and crash recovery.
- Task 4: Created `engine/index.ts` with `initEngine()`/`getEngine()`. Wired to server startup after blockchain init. Updated `status.ts` to return live engine data (with graceful fallback). Updated `mode.ts` config route to persist allocation via fund allocator. 1 engine init test.
- Task 5: Full test suite — 192 tests passing (56 new tests added), zero regressions from baseline of 136 tests. Updated `status.test.ts` to verify live engine data integration. Updated `mode.test.ts` to verify allocation persistence via fund allocator.

### Review Findings

- [x] [Review][Fixed] **Crash recovery: loadFromDb resets remaining to full allocation, ignoring open positions** — Fixed: added `reconcilePositions()` to FundAllocator, called from `initEngine()` after both loads
- [x] [Review][Fixed] **Kill-switch does not set mode status to "kill-switch"** — Fixed: added `_modeStatus` map to PositionManager, set on kill-switch trigger, exposed via `getModeStatus()`, wired to status API
- [x] [Review][Patch] **Negative returnedAmount can corrupt fund allocator remaining** — Fixed: added `Math.max(0, returnedAmount)` guard. [position-manager.ts:254]
- [x] [Review][Patch] **Silent catch-all in mode.ts swallows DB/validation errors** — Fixed: catch now only swallows engine-not-initialized, re-throws real errors. [mode.ts:72-78]
- [x] [Review][Patch] **setAllocation mutates in-memory before DB write — divergence on failure** — Fixed: added rollback of in-memory state on DB failure. [fund-allocator.ts:34-48]
- [x] [Review][Patch] **initEngine has no double-init guard** — Fixed: added early return with warning log if already initialized. [engine/index.ts:9-17]
- [x] [Review][Patch] **initEngine inside blockchain try/catch — won't init if blockchain fails** — Fixed: moved initEngine() outside blockchain try/catch into its own block. [server/index.ts:70-73]
- [x] [Review][Patch] **On-chain positionId never stored — DB row ID passed to contracts instead** — Fixed: added `chainPositionId` to InternalPosition, stored from openPosition result, used in closePosition. [position-manager.ts]
- [x] [Review][Fixed] **closePosition does not handle on-chain close failure** — Fixed: wrapped in try/catch, throws AppError with POSITION_CLOSE_FAILED, position preserved in memory/DB for retry
- [x] [Review][Fixed] **DB insert failure after on-chain open orphans position** — Fixed: wrapped DB insert in try/catch, closes on-chain position and releases funds on failure

### Change Log

- 2026-04-04: Story 2.2 implementation complete — fund allocator, position manager, blockchain contract stubs, engine initialization, API integration, and comprehensive tests.

### File List

New files:
- src/server/blockchain/contracts.ts
- src/server/blockchain/contracts.test.ts
- src/server/engine/fund-allocator.ts
- src/server/engine/fund-allocator.test.ts
- src/server/engine/position-manager.ts
- src/server/engine/position-manager.test.ts
- src/server/engine/index.ts
- src/server/engine/index.test.ts

Modified files:
- src/server/lib/errors.ts (added `insufficientFundsError` and `killSwitchTriggeredError` factories)
- src/server/api/status.ts (replaced stubs with live engine data)
- src/server/api/status.test.ts (added live engine data verification tests)
- src/server/api/mode.ts (wired config route to fund allocator)
- src/server/api/mode.test.ts (added allocation persistence tests)
- src/server/index.ts (added `initEngine()` call after blockchain init)
