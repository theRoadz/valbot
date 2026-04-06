# Story 3.5: Error Handling Framework & Transaction Safety

Status: done

## Story

As theRoad,
I want every error in the system to have a clear message, details, and resolution steps, and failed transactions to never leave orphaned positions,
So that I always know what went wrong and what to do, and my capital is never at risk from half-completed trades.

## Acceptance Criteria

1. **Given** any error occurs in the trading engine, **when** the error is caught, **then** it is wrapped in an AppError with severity, code, message, details, and resolution fields, **and** the error is logged via pino at the appropriate level, **and** if user-facing, the error is broadcast via WebSocket `alert.triggered` event, **and** the dashboard renders the error according to its severity tier (info/warning/critical).
2. **Given** a position-opening transaction succeeds but the stop-loss transaction fails, **when** the system detects the inconsistency, **then** the position is immediately closed to prevent an unprotected position, **and** the failed transaction is logged with full details, **and** the user is alerted with the error details and resolution steps.
3. **Given** a position-closing transaction fails, **when** the system detects the failure, **then** the system retries the close operation, **and** if retries fail the on-chain stop-loss is relied upon as safety net, **and** the user is alerted that a position close failed with the position details and that stop-loss is active.

## Tasks / Subtasks

- [x] Task 1: Replace all generic `Error` throws with `AppError` in engine layer (AC: #1)
  - [x] 1.1 Add new error factory functions to `src/server/lib/errors.ts`: `engineNotInitializedError()` (critical), `modeTransitioningError(mode)` (warning), `unsupportedModeError(mode)` (warning), `invalidStrategyConfigError(mode, details)` (warning)
  - [x] 1.2 Replace 4 generic `Error` throws in `src/server/engine/index.ts` (lines ~52, ~70, ~82, ~139) with the new AppError factories
  - [x] 1.3 Replace 1 generic `Error` throw in `src/server/engine/strategies/volume-max.ts` (line ~35: "requires at least one trading pair") with `invalidStrategyConfigError(mode, "requires at least one trading pair")`
  - [x] 1.4 Add new error factory functions: `dbInitializationFailedError(details)` (critical), `dbClosedError()` (critical)
  - [x] 1.5 Replace 2 generic `Error` throws in `src/server/db/index.ts` (line ~16: DB closed guard, line ~34: missing tables) with the new AppError factories

- [x] Task 2: Consolidate inline AppError construction into factory functions (AC: #1)
  - [x] 2.1 Add factories for currently-inline errors: `sessionKeyMissingError()`, `walletAddressInvalidError(details)`, `noBlockchainClientError()`, `positionOpenFailedError(details)`, `positionCloseFailedError(details)`, `positionDbFailedError(details)`, `positionNotFoundError(positionId)`, `shutdownInProgressError()`, `killSwitchCloseFailedError(details)`, `killSwitchInProgressError(mode)`, `crashRecoveryFailedError(details)`, `balanceFetchFailedError(details)`, `allocationPersistenceFailedError(details)`
  - [x] 2.2 Replace 3 inline `new AppError(...)` calls in `src/server/blockchain/client.ts` with factory functions (SESSION_KEY_MISSING line ~188, WALLET_ADDRESS_INVALID line ~224, BALANCE_FETCH_FAILED line ~311)
  - [x] 2.3 Replace 10 inline `new AppError(...)` calls in `src/server/engine/position-manager.ts` with factory functions (SHUTDOWN_IN_PROGRESS line ~86, MODE_KILL_SWITCHED line ~96, NO_BLOCKCHAIN_CLIENT lines ~106 and ~272, POSITION_OPEN_FAILED line ~131, STOP_LOSS_FAILED line ~165, POSITION_DB_FAILED line ~213, POSITION_NOT_FOUND line ~262, POSITION_CLOSE_FAILED line ~293, KILL_SWITCH_IN_PROGRESS line ~677)
  - [x] 2.4 Replace 8 inline `new AppError(...)` calls in `src/server/blockchain/contracts.ts` with factory functions — add factories for: `assetNotFoundError(pair)`, `midPriceUnavailableError(pair)`, `midPriceInvalidError(pair)`, `orderFailedError(details)`, `orderNotFilledError(details)`, `closeFailedError(details)`, `closeNotFilledError(details)`, `stopLossSubmissionFailedError(details)` (ASSET_NOT_FOUND line ~60, MID_PRICE_UNAVAILABLE line ~139, MID_PRICE_INVALID line ~148, ORDER_FAILED line ~204, ORDER_NOT_FILLED line ~235, CLOSE_FAILED line ~285, CLOSE_NOT_FILLED line ~310, STOP_LOSS_FAILED line ~362)
  - [x] 2.5 **Code disambiguation:** contracts.ts line ~362 and position-manager.ts line ~165 both use code `STOP_LOSS_FAILED`. Rename the contracts.ts factory to `stopLossSubmissionFailedError()` with code `STOP_LOSS_SUBMISSION_FAILED` (blockchain layer failure) and position-manager.ts factory to `stopLossFailedError()` keeping code `STOP_LOSS_FAILED` (rollback context). Verify no store handlers or alert code checks depend on the contracts.ts code string before renaming.

- [x] Task 3: Add structured pino logging at correct levels for all error paths (AC: #1)
  - [x] 3.1 In `src/server/engine/position-manager.ts`: ensure every catch block logs via `logger.error()` for critical, `logger.warn()` for warning, `logger.info()` for info — include error code, mode, and relevant position/trade context
  - [x] 3.2 In `src/server/engine/mode-runner.ts`: log strategy iteration errors with `logger.warn()` including mode, iteration count, and original error code (preserve context from inner AppError instead of wrapping as generic STRATEGY_ITERATION_FAILED)
  - [x] 3.3 In `src/server/engine/index.ts`: log mode start/stop failures with appropriate level
  - [x] 3.4 In `src/server/blockchain/client.ts`: verify retry logging includes attempt number, total attempts, and error code at `logger.warn()` level for retries, `logger.error()` for final failure

- [x] Task 4: Verify and harden transaction safety for stop-loss failure rollback (AC: #2)
  - [x] 4.1 Audit `openPosition()` in position-manager.ts: confirm the existing stop-loss failure → close position → release funds rollback path is correct and complete
  - [x] 4.2 Add explicit broadcast of `alert.triggered` (warning severity) when stop-loss fails and rollback close succeeds — message: "Stop-loss setup failed for {pair}. Position was automatically closed. No capital at risk."
  - [x] 4.3 Add explicit broadcast of `alert.triggered` (critical severity) when stop-loss fails AND rollback close also fails — message: "Stop-loss setup failed for {pair} and rollback close also failed. On-chain stop-loss is active as safety net. Check position manually."
  - [x] 4.4 If the rollback close fails, ensure the position remains in the DB `positions` table (for crash recovery reconciliation) and is NOT removed from in-memory tracking

- [x] Task 5: Harden position-close retry with on-chain stop-loss fallback (AC: #3)
  - [x] 5.1 In `closePosition()` in position-manager.ts: the blockchain layer's `withRetry()` already retries 3 times. Verify that after retry exhaustion, the error is broadcast as critical alert with resolution: "Position close failed after retries. On-chain stop-loss at ${stopLoss} is active. Monitor position on Hyperliquid dashboard."
  - [x] 5.2 When close fails after retries, do NOT remove the position from DB or in-memory tracking — it must remain tracked for crash recovery
  - [x] 5.3 In `closeAllForMode()`: verify that positions which fail to close remain in DB with their stop-loss details intact, and the broadcast includes the list of failed position IDs
  - [x] 5.4 In `volume-max.ts` strategy close catch blocks (lines ~106-114): currently these catch, log, and rethrow to mode-runner which broadcasts `mode.error` (MODE_ERROR event). Note that MODE_ERROR is a separate event from `alert.triggered` — the user sees mode.error in logs but NOT as a toast/banner. Add an `alert.triggered` broadcast (warning severity) in `closePosition()` failure path in position-manager.ts so the user IS notified via toast, before the error propagates up to mode-runner.

- [x] Task 6: Tests (AC: all)
  - [x] 6.1 `src/server/lib/errors.test.ts` (**Modified**) — Add tests for all new factory functions: verify severity, code, message, details, and resolution fields are correct for each
  - [x] 6.2 `src/server/engine/index.test.ts` (**Modified**) — Test that engine throws AppError (not generic Error) for: mode transitioning, unsupported mode
  - [x] 6.3 `src/server/db/index.test.ts` (**New**) — Test that DB layer throws AppError for: closed DB access, missing tables
  - [x] 6.4 `src/server/engine/position-manager.test.ts` (**Modified**) — Add/verify tests for: stop-loss failure triggers rollback close + alert broadcast, rollback close failure keeps position in DB + broadcasts critical alert, close failure after retries keeps position tracked + broadcasts critical alert
  - [x] 6.5 Run `pnpm test` to verify zero regressions — 465 tests pass (28 files), up from 430 (27 files)

## Dev Notes

### What Already Exists (DO NOT recreate)

- **`AppError` class** in `src/server/lib/errors.ts` — Already has `severity`, `code`, `message`, `details`, `resolution` fields. Already has 9 factory functions: `sessionKeyExpiredError`, `sessionKeyInvalidError`, `insufficientFundsError`, `killSwitchTriggeredError`, `modeAlreadyRunningError`, `modeNotAllocatedError`, `modeKillSwitchedError`, `apiConnectionFailedError`, `walletAddressMissingError`.
- **`error-handler.ts`** in `src/server/lib/error-handler.ts` — Fastify error handler maps AppError severity to HTTP status: info→200, warning→400, critical→500. Also handles validation errors as VALIDATION_ERROR (warning). Generic errors become INTERNAL_ERROR (critical, 500).
- **`logger.ts`** in `src/server/lib/logger.ts` — Pino logger with pretty-print in dev, JSON in prod.
- **Position transaction rollback** in `src/server/engine/position-manager.ts` — `openPosition()` already implements the multi-step rollback: open → set stop-loss (if fails: close + release funds) → DB insert (if fails: close + release funds). The rollback logic exists but does NOT currently broadcast `alert.triggered` events for stop-loss failure or rollback close failure. Task 4 adds those alert broadcasts.
- **Close retry** via `withRetry()` in `src/server/blockchain/client.ts` — All blockchain calls go through `withRetry()` which does exponential backoff (1s, 2s, 4s), max 3 attempts.
- **Crash recovery** in `position-manager.ts` `reconcileOnChainPositions()` — Reconciles DB positions against on-chain state on startup.
- **Alert broadcast system** — `broadcast()` in `src/server/ws/broadcaster.ts`, alert routing in Zustand store (critical→banner, warning/info→toast via sonner).
- **Existing error tests** — `errors.test.ts` tests the AppError class and existing factories. `error-handler.test.ts` tests HTTP status mapping.

### Architecture: Error Flow (After This Story)

```
Error occurs in engine/blockchain/db
  → Wrapped in AppError (via factory function — NEVER inline or generic Error)
  → Logged via pino at severity-appropriate level
  → If user-facing → broadcast("alert.triggered", { severity, code, message, details, resolution })
  → Client Zustand store routes by severity:
      critical → AlertBanner (persistent red banner)
      warning  → toast.warning() via sonner (persistent amber toast)
      info     → toast.success() via sonner (auto-dismiss 5s green toast)
```

### Key Design Decision: Factories Over Inline Construction

All `new AppError(...)` calls must be replaced with named factory functions in `errors.ts`. Reasons:
- **Consistent resolution text** — Same error type always gives same resolution guidance
- **Discoverability** — All error types visible in one file
- **Testability** — Each factory tested for correct severity/code/message/resolution
- **Grep-ability** — Search for error code usage across codebase
- **No new error class** — Keep the existing `AppError` class unchanged. Only add factories.

### Transaction Safety Diagram

```
openPosition(mode, pair, side, size):
  1. Check shutdown + kill-switch + blockchain client
  2. Reserve funds via fundAllocator.reserve()
  3. Open position on-chain via contracts.openPosition()
     └─ FAIL → release funds → throw AppError
  4. Set stop-loss on-chain via contracts.setStopLoss()
     └─ FAIL → close position on-chain → release funds
              └─ Close FAIL → keep in DB for recovery → broadcast CRITICAL alert
              └─ Close OK → broadcast WARNING alert (safe, position closed)
  5. Insert position into DB
     └─ FAIL → close position on-chain → release funds → broadcast CRITICAL alert
  6. Track in-memory, broadcast position.opened

closePosition(positionId):
  1. Look up position
  2. Close on-chain via contracts.closePosition() [retries via withRetry()]
     └─ FAIL after retries → keep position in DB + in-memory → broadcast CRITICAL alert
        (on-chain stop-loss is safety net)
  3. Write trade to DB, delete position from DB, release funds
  4. Check kill-switch threshold
```

### Specific Code Changes Required

**`src/server/lib/errors.ts`** — Add ~22 new factory functions. Group by domain:
- **Engine:** `engineNotInitializedError()`, `modeTransitioningError(mode)`, `unsupportedModeError(mode)`, `invalidStrategyConfigError(mode, details)`
- **Database:** `dbInitializationFailedError(details)`, `dbClosedError()`
- **Blockchain:** `sessionKeyMissingError()`, `walletAddressInvalidError(details)`, `noBlockchainClientError()`
- **Position:** `positionOpenFailedError(details)`, `positionCloseFailedError(details)`, `positionDbFailedError(details)`, `positionNotFoundError(positionId)`, `shutdownInProgressError()`, `killSwitchCloseFailedError(details)`, `killSwitchInProgressError(mode)`, `crashRecoveryFailedError(details)`, `stopLossFailedError(details)` (rollback context, code: STOP_LOSS_FAILED)
- **Contracts:** `assetNotFoundError(pair)`, `midPriceUnavailableError(pair)`, `midPriceInvalidError(pair)`, `orderFailedError(details)`, `orderNotFilledError(details)`, `closeFailedError(details)`, `closeNotFilledError(details)`, `stopLossSubmissionFailedError(details)` (blockchain layer, code: STOP_LOSS_SUBMISSION_FAILED — disambiguated from position-manager's STOP_LOSS_FAILED)
- **Fund:** `balanceFetchFailedError(details)`, `allocationPersistenceFailedError(details)`

**`src/server/engine/index.ts`** — Replace 4 generic Error throws with AppError factories.

**`src/server/engine/strategies/volume-max.ts`** — Replace 1 generic Error throw (line ~35) with AppError factory.

**`src/server/db/index.ts`** — Replace 2 generic Error throws with AppError factories.

**`src/server/blockchain/client.ts`** — Replace 3 inline `new AppError(...)` calls with factories.

**`src/server/blockchain/contracts.ts`** — Replace 8 inline `new AppError(...)` calls with factories.

**`src/server/engine/position-manager.ts`** — Replace 10 inline `new AppError(...)` calls with factories. Add alert broadcasts for stop-loss failure and close failure paths.

**`src/server/engine/mode-runner.ts`** — Preserve inner AppError context when logging strategy iteration errors instead of wrapping as generic STRATEGY_ITERATION_FAILED.

### Existing Patterns to Follow

- **Error factory pattern:** Follow existing factories in `errors.ts` — each returns `new AppError({ severity, code, message, details, resolution })`. Every factory MUST include a `resolution` field (FR31).
- **Pino logging:** `logger.error({ err, mode, code }, "message")` for structured logging. Use `err` key for error objects (pino serializes them correctly).
- **Alert broadcast:** `broadcast("alert.triggered", { severity, code, message, details, resolution, autoDismissMs?, positionsClosed?, lossAmount?, mode? })` — match `AlertTriggeredPayload` in `shared/events.ts`.
- **Co-located tests:** Place `.test.ts` next to source files.
- **Test patterns:** Vitest + `vi.fn()` mocks. See `errors.test.ts` for factory testing pattern, `position-manager.test.ts` for engine testing pattern.
- **Import convention:** `import { logger } from "../lib/logger.js"` — use `.js` extensions in imports (TypeScript ESM).

### Previous Story Intelligence (3-4)

Key learnings from Story 3-4:
- **Alert routing is complete** — critical→banner, warning→toast.warning(), info→toast.success(). This story can rely on the routing being correct.
- **`toastQueue` pattern** — Store uses `toastQueue[]` (not single `lastToast`) to handle rapid consecutive alerts. New alert broadcasts will route correctly.
- **`AlertTriggeredPayload` fields** — `severity`, `code`, `message`, `details`, `resolution`, `positionsClosed`, `lossAmount`, `autoDismissMs`, `mode` — all available for broadcasts.
- **`USDC_DECIMALS` constant** — Use this for formatting loss amounts in alert details (defined in alert-banner.tsx).
- **Test baseline:** 430 tests (27 files). Run `pnpm test` before starting to confirm.

### Git Intelligence

Recent commits:
- `491a61c`: Story 3-4 — AlertBanner enhancements, toast notification system. Alert routing complete.
- `47aa1e8`: Story 3-3 — API connection resilience with retry, health monitoring. `withRetry()` and health tracking established.
- `c069634`: Story 3-2 — Graceful shutdown and crash recovery. Shutdown sequence and position reconciliation.
- `e29b1fc`: Story 3-1 — Per-mode kill switch. Kill switch threshold, `closeAllForMode()`, cascading alerts.

Pattern: Each story commits implementation + tests together. All test files use Vitest + `vi.fn()` mocks.

### Critical Warnings

1. **Do NOT change the `AppError` class itself.** Only add new factory functions. The class, error-handler, and all existing consumers depend on the current interface.
2. **Do NOT change the alert routing in the Zustand store.** Story 3-4 completed that work. This story only adds/improves error origination on the server side.
3. **Do NOT add try/catch wrapping to every function.** Follow the architecture: let errors propagate naturally through Fastify's error handling chain. Only catch where you need to rollback or broadcast.
4. **Do NOT change the `withRetry()` logic.** It already works correctly. Only verify that the errors it throws after exhaustion are properly broadcast.
5. **Position safety is #1 priority.** When modifying error handling in position-manager.ts, test every rollback path. A bug here means real money at risk.
6. **Keep contracts.ts error codes as-is for existing codes** (ORDER_FAILED, CLOSE_FAILED, etc.). Only move them from inline to factory. Don't rename codes that other parts of the system may check against (e.g., store handlers that check `alert.code`).
7. **Mode runner error preservation:** When a strategy iteration catches an AppError, log the original error's code and details — don't wrap it in a new AppError that loses the inner context. Log the original, then optionally broadcast a MODE_ERROR event.
8. **`STOP_LOSS_FAILED` code disambiguation:** contracts.ts (line ~362) and position-manager.ts (line ~165) both currently use code `STOP_LOSS_FAILED`. Rename the contracts.ts code to `STOP_LOSS_SUBMISSION_FAILED` to distinguish blockchain-level submission failure from position-manager's rollback context. Check that no client-side code (store handlers, alert code checks) depends on the contracts.ts code string before renaming.
9. **`mode.error` vs `alert.triggered` are different events.** `mode.error` (MODE_ERROR) is broadcast by mode-runner for strategy iteration failures — it appears in logs but does NOT trigger a toast/banner. `alert.triggered` is what triggers user-visible toasts/banners. For close failures that the user must see, broadcast `alert.triggered` from position-manager, not just rely on mode-runner's MODE_ERROR.

### Project Structure Notes

- All new factory functions go in `src/server/lib/errors.ts` — this is the single source of truth for error definitions
- No new files needed except potentially test files if they don't exist yet
- Changes are entirely server-side — no client changes required (alert rendering already complete from Stories 3-1 through 3-4)

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 3, Story 3.5]
- [Source: _bmad-output/planning-artifacts/architecture.md — Error Handling FR30-FR33, Process Patterns]
- [Source: _bmad-output/planning-artifacts/prd.md — FR30-FR33, NFR Reliability]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — Journey 3: Error & Kill Switch, severity tiers]
- [Source: _bmad-output/project-context.md — Error Handling rules, AppError class, resolution requirement]
- [Source: src/server/lib/errors.ts — Current AppError class and 9 factory functions]
- [Source: src/server/lib/error-handler.ts — Fastify error handler, severity→HTTP status mapping]
- [Source: src/server/engine/position-manager.ts — Transaction rollback, closeAllForMode, crash recovery]
- [Source: src/server/engine/mode-runner.ts — Strategy iteration error handling]
- [Source: src/server/blockchain/client.ts — withRetry(), inline AppErrors]
- [Source: src/server/blockchain/contracts.ts — Order/position operation errors]
- [Source: src/server/engine/index.ts — Generic Error throws to replace]
- [Source: src/server/db/index.ts — Generic Error throws to replace]
- [Source: _bmad-output/implementation-artifacts/3-4-alertbanner-and-toast-notification-system.md — Alert routing, toastQueue pattern]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

### Completion Notes List

- Added 28 new error factory functions to `errors.ts` grouped by domain (database, engine, blockchain, position, contract, fund)
- Replaced all 7 generic `Error` throws across engine/index.ts, volume-max.ts, and db/index.ts with AppError factories
- Consolidated all 21 inline `new AppError(...)` calls across client.ts, contracts.ts, and position-manager.ts into factory functions
- Disambiguated STOP_LOSS_FAILED code: contracts.ts now uses STOP_LOSS_SUBMISSION_FAILED for blockchain-layer failures
- Aligned pino log levels with error severity: warning-severity errors use `logger.warn()`, critical use `logger.error()`
- Mode-runner now logs AppError iteration failures at severity-appropriate level with inner error code context
- Added alert.triggered broadcasts for stop-loss rollback scenarios (warning when close succeeds, critical when both fail)
- When stop-loss fails AND rollback close fails, position is now persisted to DB for crash recovery (funds NOT released)
- Added alert.triggered broadcast in closePosition failure path so users get toast/banner notification (not just mode.error logs)
- Position close failures keep position in DB and in-memory — verified existing behavior is correct
- 35 new tests added: 27 factory tests, 2 DB layer tests, 2 engine AppError tests, 4 position-manager alert broadcast tests
- Test suite: 465 pass (28 files), zero regressions from baseline of 430 (27 files)

### Change Log

- 2026-04-06: Story 3-5 implementation complete — error handling framework and transaction safety

### Review Findings

- [x] [Review][Decision] **DB-rollback close failure releases funds even when on-chain position is still open** — Fixed: mirrored stop-loss orphan pattern — when rollback close fails, funds are NOT released and position is tracked in-memory. [position-manager.ts:257-261]
- [x] [Review][Patch] **`stopLossFailedError` severity is "warning" but double-failure path is critical** — Fixed: added `stopLossOrphanedError` factory with `severity: "critical"`, used in double-failure path. [errors.ts, position-manager.ts]
- [x] [Review][Patch] **Orphan position fully invisible when DB insert fails in double-failure path** — Fixed: position is now added to `this.positions` before DB insert attempt, so it's always in-memory even if DB fails. [position-manager.ts:169-215]
- [x] [Review][Patch] **`walletAddressInvalidError` leaks full wallet address into error details** — Fixed: truncated to `0x1234...abcd` format. [client.ts:218]
- [x] [Review][Patch] **`midPriceUnavailableError`/`midPriceInvalidError` receive coin but factory expects pair** — Fixed: renamed parameter from `pair` to `coin` and removed unnecessary `.split("/")`. [errors.ts]
- [x] [Review][Patch] **`db/index.ts` outer catch still throws raw Error** — Fixed: outer catch now wraps non-AppError exceptions in `dbInitializationFailedError`. [db/index.ts:47]
- [x] [Review][Patch] **`engineNotInitializedError` not tested in `index.test.ts`** — Fixed: added test that calls `getEngine()` before `initEngine()`. [index.test.ts]
- [x] [Review][Defer→Fixed] **Race: kill-switch activates after `openPosition` passes guard** — Fixed: added kill-switch re-check after `await contractOpenPosition()`, immediately closes position if kill-switch fired mid-operation. [position-manager.ts]
- [x] [Review][Defer→Fixed] **`_killSwitchActive` cleared after partial close failure** — Fixed: `_killSwitchActive` only cleared when all positions successfully closed. [position-manager.ts]
- [x] [Review][Defer→Fixed] **Crash-recovery "already gone" positions never release funds** — Fixed: added `fundAllocator.release()` in both reconciliation cleanup paths. [position-manager.ts]
- [x] [Review][Defer→Fixed] **Rollback-close success path never records trade — fees unaccounted** — Fixed: added `fundAllocator.recordTrade(mode, size, 0)` after successful rollback close. [position-manager.ts]
- [x] [Review][Defer→Fixed] **Kill-switch alert `lossAmount` excludes triggering position's loss** — Fixed: triggering position's PnL now included in `lossAmount` calculation. [position-manager.ts]
- [x] [Review][Defer→Fixed] **`apiHealthy` stays false after non-retriable error during retry** — Fixed: non-retriable errors during retry now restore `apiHealthy = true` and broadcast `rpc: true`. [client.ts]

### File List

- `src/server/lib/errors.ts` (modified) — Added 28 new error factory functions
- `src/server/lib/errors.test.ts` (modified) — Added 27 new factory function tests
- `src/server/engine/index.ts` (modified) — Replaced 4 generic Error throws with AppError factories
- `src/server/engine/index.test.ts` (modified) — Added 2 AppError-specific tests
- `src/server/engine/strategies/volume-max.ts` (modified) — Replaced 1 generic Error throw
- `src/server/engine/position-manager.ts` (modified) ��� Replaced 10 inline AppErrors, added alert broadcasts, hardened rollback
- `src/server/engine/position-manager.test.ts` (modified) — Added 4 alert broadcast tests, updated assertions
- `src/server/engine/mode-runner.ts` (modified) — Severity-aware logging for strategy iteration errors
- `src/server/blockchain/client.ts` (modified) — Replaced 3 inline AppErrors with factories
- `src/server/blockchain/contracts.ts` (modified) — Replaced 8 inline AppErrors, disambiguated STOP_LOSS code
- `src/server/blockchain/contracts.test.ts` (modified) — Updated assertions for new error messages/codes
- `src/server/db/index.ts` (modified) — Replaced 2 generic Errors with AppError factories
- `src/server/db/index.test.ts` (new) — 2 tests for DB layer AppError throws
