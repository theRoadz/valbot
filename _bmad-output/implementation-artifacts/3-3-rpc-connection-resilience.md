# Story 3.3: API Connection Resilience

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As theRoad,
I want the bot to retry API connection failures automatically and alert me when retries are exhausted,
so that temporary network issues don't require my intervention but persistent failures get my attention.

## Acceptance Criteria

1. **Given** the bot is connected to Hyperliquid API, **when** an API call fails, **then** the system retries with exponential backoff: 1s, 2s, 4s (max 3 retries).
2. During retries, a warning toast appears on the dashboard: "API connection lost — retrying (1/3)..."
3. If a retry succeeds, the toast updates to green "Reconnected" and auto-dismisses after 5s.
4. If all 3 retries fail, the alert escalates to a persistent critical banner: "API connection failed after 3 retries — check network"
5. Trading modes pause during API failure (no new trades attempted).
6. Existing positions remain with their stop-losses active on Hyperliquid.
7. When API reconnects, modes resume trading automatically.

## What Already Exists

Retry infrastructure is partially built. Understand what exists before implementing:

**Already implemented (DO NOT recreate):**
- `MAX_API_RETRIES = 3` and `BACKOFF_BASE_MS = 1000` constants in `client.ts:12-13`
- Exponential backoff during `initBlockchainClient()` for initial connection validation (`client.ts:89-105`): `Math.min(1000 * 2^(attempt-1), 4000)`
- `ConnectionStatusPayload` with `rpc: boolean` field (`shared/events.ts:25-30`)
- `ConnectionStatus` type: `"connected" | "reconnecting" | "disconnected"` (`shared/types.ts:3`)
- Client WebSocket reconnection with backoff (`use-websocket.ts:56-67`): max 5 retries, 1s/2s/4s delay
- Zustand store `connection` state with `setConnectionStatus()` and `updateConnection()` (`store/index.ts:62-123`)
- Top-bar connection status indicator: green/yellow/red dots with labels (`top-bar.tsx:8-27, 70-84`)
- `AlertBanner` component for critical alerts (`alert-banner.tsx`) — renders above dashboard, non-dismissible for critical
- `ALERT_TRIGGERED` event with severity-based deduplication in store (`store/index.ts:229-282`)
- `AppError` class with severity/code/message/details/resolution (`lib/errors.ts:1-23`)
- `apiConnectionFailedError(attempts)` factory (`lib/errors.ts:103-113`)
- `getConnectionStatus()` with 5s stale-while-revalidate cache (`client.ts:156-178`)
- `broadcast()` function sends to all open WS clients (`broadcaster.ts:74-86`)
- `ModeRunner._runLoop()` catches iteration errors and continues (`mode-runner.ts:109-136`) — errors become `MODE_ERROR` events
- `getBlockchainClient()` returns `null` if not initialized (`client.ts:111-113`)
- Server broadcasts `CONNECTION_STATUS` with `rpc: false` on blockchain init failure (`index.ts:76`)
- `cacheAlert()` replays last alert to late-connecting clients (`broadcaster.ts:39-42`)
- `getWalletBalances()` wraps errors as `AppError` with code `BALANCE_FETCH_FAILED` (`client.ts:120-143`)

**NOT implemented — toast notification system:**
- `alert-toast.tsx` is listed in the architecture directory structure (`architecture.md:561`) but does NOT exist in the codebase yet
- Story 3-4 is specifically "AlertBanner & Toast Notification System" — it creates the full toast infrastructure
- **For this story:** Use the existing `ALERT_TRIGGERED` broadcast mechanism for all user-facing notifications. The AC mentions "toast" but the implementation should use alert events that the dashboard renders appropriately. The existing `AlertBanner` already handles `warning` severity as amber persistent alerts and `info` as auto-dismissible (via the alert deduplication — a new alert with same code replaces the old one). Story 3-4 will add proper toast stacking/animation later.

**Gaps to fill (the actual work for this story):**

### Gap 1: No per-call retry logic on blockchain operations

`client.ts` only retries during initial connection (`initBlockchainClient`). Individual API calls from `contracts.ts` (`openPosition`, `closePosition`, `getMidPrice`, `setStopLoss`, `getWalletBalances`) have NO retry logic. When Hyperliquid has a momentary outage mid-trading, every API call fails immediately with no recovery.

**Fix:** Add a `withRetry<T>(fn: () => Promise<T>, label: string)` utility in `client.ts` that wraps any async operation with the established retry pattern (exponential backoff 1s/2s/4s, max 3 retries). Broadcasts `ALERT_TRIGGERED` during retries (warning) and on final failure (critical). Returns the result on success or throws `AppError` on exhaustion.

**CRITICAL — Read-only vs write-call distinction:** `withRetry` is safe for read-only calls (`info.allMids`, `info.meta`, `info.spotClearinghouseState`, `info.clearinghouseState`). For write calls (`exchange.order` in `openPosition`, `closePosition`, `setStopLoss`), retry is ONLY safe when the error indicates the request **never reached the server** (e.g., `ECONNREFUSED`, DNS failure). If the error is a **timeout** (request may have been received and executed), do NOT retry — instead query `info.clearinghouseState` to check if the order executed before deciding. See "Order Idempotency" section in Dev Notes.

### Gap 2: No API health state tracking

The bot has no concept of "the API is currently down." Each failed call is isolated. Without a shared health state:
- Multiple mode runners hit the API simultaneously during an outage, multiplying failed requests
- No coordinated pause/resume across modes
- No single source of truth for dashboard connection status

**Fix:** Add an `ApiHealthMonitor` class (or extend `client.ts` with health state) that:
1. Tracks API health: `healthy | degraded | down`
2. On first failure → sets `degraded`, starts retry sequence, broadcasts warning alert
3. On retry success → sets `healthy`, broadcasts info alert "Reconnected"
4. On retry exhaustion → sets `down`, broadcasts critical alert
5. On next successful call after `down` → sets `healthy`, broadcasts info alert
6. Exposes `isHealthy(): boolean` for callers to check before making API calls

### Gap 3: Mode runners don't pause during API failure

`ModeRunner._runLoop()` catches errors and continues to the next iteration. During an API outage, this means every iteration fires failed API calls. The mode runner has no awareness of API health — it keeps hammering a dead endpoint.

**Fix:** Add an API health check at the start of `ModeRunner.executeIteration()` (or in the base class `_runLoop`). When API is unhealthy:
- Skip the iteration (don't call strategy)
- Log at debug level (not error — the health monitor already handles alerting)
- Continue the loop (the timer still runs so it checks again next iteration)
- When API recovers, iterations resume automatically — no explicit "resume" needed

This satisfies AC #5 (modes pause) and AC #7 (modes resume automatically).

### Gap 4: No reconnection alert flow (AC #2, #3, #4)

The dashboard needs to show the retry progress and outcomes.

**Fix:** Use `ALERT_TRIGGERED` broadcasts with a SINGLE code (`API_CONNECTION_FAILED`) across all states — leverages the store's code-based deduplication (store/index.ts:249) to auto-replace alerts as state transitions:
- **Retry in progress** (AC #2): severity "warning", message `"API connection lost — retrying (1/3)..."`. Updated each attempt.
- **Retry success** (AC #3): severity "info", message `"API reconnected — trading resumed"`. Replaces warning via same code.
- **Retry exhaustion** (AC #4): severity "critical", message `"API connection failed after 3 retries — check network"`. Replaces warning via same code. Non-dismissible.
- **Recovery after failure** (AC #7): severity "info" with same code. Replaces the critical alert via code deduplication.

### Gap 5: CONNECTION_STATUS not updated during API degradation

The `ConnectionStatusPayload.rpc` field should reflect API health. Currently it's only set during init. When the API goes down mid-session, `rpc` stays `true` until the next `getConnectionStatus()` call (which has a 5s cache).

**Fix:** When health monitor transitions to `degraded` or `down`, broadcast `CONNECTION_STATUS` with `rpc: false`. When recovered, broadcast with `rpc: true`. This updates the top-bar connection indicator.

**UX: "reconnecting" during retries:** The UX spec (ux-design-specification.md:619-622) defines three states: green "Connected", yellow pulsing "Reconnecting...", red "Disconnected". During the retry phase (API down, retries in progress), the top-bar should show yellow "Reconnecting...", not red "Disconnected." The Zustand store's ALERT_TRIGGERED handler should detect `API_CONNECTION_FAILED` warnings and call `setConnectionStatus("reconnecting")`. Only escalate to `"disconnected"` after all retries fail (when the critical alert arrives). On recovery (info alert), set back to `"connected"`.

## Tasks / Subtasks

- [x] Task 1: Add `withRetry` utility and API health state (AC: #1, #4)
  - [x] 1.1 Add `withRetry<T>(fn: () => Promise<T>, label: string, opts?: { writeCall?: boolean }): Promise<T>` to `client.ts`. Uses existing `MAX_API_RETRIES` and `BACKOFF_BASE_MS` constants. On each retry: logs warning with attempt number. On exhaustion: throws `AppError` with code `API_CONNECTION_FAILED`. When `opts.writeCall` is true, only retry on connection-refused/DNS errors — NOT timeouts (see "Order Idempotency" in Dev Notes). Use `isRetriableError(err, writeCall)` helper to classify errors using SDK error types (`HttpRequestError` from `@nktkas/hyperliquid`).
  - [x] 1.2 Add module-level API health state in `client.ts`: `let apiHealthy = true`. Export `isApiHealthy(): boolean`.
  - [x] 1.3 In `withRetry`, on first failure: set `apiHealthy = false`, broadcast `ALERT_TRIGGERED` { severity: "warning", code: "API_CONNECTION_FAILED", message: "API connection lost — retrying (1/3)..." }. Update message on each subsequent retry attempt.
  - [x] 1.4 In `withRetry`, on retry success: set `apiHealthy = true`, broadcast `ALERT_TRIGGERED` { severity: "info", code: "API_CONNECTION_FAILED", message: "API reconnected — trading resumed" }. Also broadcast `CONNECTION_STATUS` with `rpc: true` (get fresh balances if possible, fall back to cached).
  - [x] 1.5 In `withRetry`, on retry exhaustion: `apiHealthy` stays `false`, broadcast `CONNECTION_STATUS` with `rpc: false`. Call `cacheAlert()` with the critical alert payload so late-connecting clients see the failure banner. Throw the `apiConnectionFailedError(MAX_API_RETRIES)` (existing factory).
  - [x] 1.6 `withRetry` must import `broadcast` and `cacheAlert` from `../ws/broadcaster.js` and `EVENTS` from `../../shared/events.js`. **Boundary concern:** This adds a broadcast dependency to the blockchain layer. Acceptable per architecture spec: "Handles RPC retry logic internally." Keep it scoped to `withRetry` only.
  - [x] 1.7 Add `isRetriableError(err: unknown, writeCall: boolean): boolean` helper in `client.ts`. Import `HttpRequestError` from `@nktkas/hyperliquid`. Logic: (1) `AppError` → false. (2) `HttpRequestError` → if `writeCall` and error looks like timeout → false, else → true. (3) Unknown error with network message → true. (4) Default → true.
  - [x] 1.8 Add tests to existing `client.test.ts`: `withRetry` succeeds on first try, succeeds on second retry, fails after 3 retries, broadcasts warning during retries, broadcasts info on recovery, broadcasts critical connection status on exhaustion, `cacheAlert` called on exhaustion, `writeCall: true` does not retry on timeout errors, `isRetriableError` correctly classifies SDK error types.

- [x] Task 2: Wrap blockchain operations with retry (AC: #1, #6)
  - [x] 2.1 In `contracts.ts`, wrap `getMidPrice()` API call (`info.allMids`) with `withRetry`. This is a read-only call — safe to retry on any network error.
  - [x] 2.2 In `contracts.ts`, wrap `refreshAssetCache()` API call (`info.meta`) with `withRetry`. Read-only — safe to retry.
  - [x] 2.3 In `client.ts`, wrap the raw `info.spotClearinghouseState()` call INSIDE `getWalletBalances()` with `withRetry` — wrap it BEFORE the existing try/catch that converts errors to `AppError` (client.ts:124-143). If `withRetry` wraps the outer function, the `AppError` conversion at line 136 will make the error appear non-retriable. Read-only — safe to retry.
  - [x] 2.4 In `contracts.ts`, wrap `openPosition()` `exchange.order()` call (line 176) with `withRetry` using `{ writeCall: true }` option. Write calls only retry on connection-refused/DNS errors, NOT timeouts. See "Order Idempotency" in Dev Notes.
  - [x] 2.5 In `contracts.ts`, wrap `closePosition()` `exchange.order()` call (line 254) with `withRetry` using `{ writeCall: true }`. **Safety note:** Position close retries are CRITICAL — a failed close during kill-switch or shutdown could leave orphaned positions. The `reduce-only: true` flag (line 261) prevents flipping the position on double-execute.
  - [x] 2.6 In `contracts.ts`, wrap `setStopLoss()` `exchange.order()` call (line 323) with `withRetry` using `{ writeCall: true }`. **Safety note:** Stop-loss must be set — if this fails after retries, the position MUST be closed immediately (existing safety logic in position-manager handles this). Trigger orders can accumulate, so write-call safety is critical here.
  - [x] 2.7 **Distinguish retriable vs non-retriable errors:** Use `@nktkas/hyperliquid` SDK error types for reliable detection. Import `HttpRequestError` from the SDK — these are transport-level failures (retriable). `AppError` instances are business errors (NOT retriable). Unknown errors: check `err.message` for network strings as fallback, default to retriable. For write calls (`writeCall: true`), additionally check: if error looks like a timeout (`ETIMEDOUT`, `AbortError`, `socket hang up`), do NOT retry — the order may have been received.
  - [x] 2.8 Add tests to existing `contracts.test.ts`: verify retry wrapping for read calls (getMidPrice, refreshAssetCache), verify write calls only retry on connection-refused (not timeout), verify business errors (`AppError`) are NOT retried.
  - [x] 2.9 Add tests to existing `client.test.ts`: verify `getWalletBalances` retries on network error, verify it does NOT retry when `AppError` is thrown from inner logic.

- [x] Task 3: Mode runner API health check (AC: #5, #7)
  - [x] 3.1 Import `isApiHealthy` from `../blockchain/client.js` in `mode-runner.ts`.
  - [x] 3.2 In `_runLoop()`, before calling `this.executeIteration()`, check `isApiHealthy()`. If false, skip the iteration (log at debug: "Skipping iteration — API unhealthy"). Continue to the next timer tick.
  - [x] 3.3 This automatically satisfies AC #5 (modes pause — no new trades attempted) and AC #7 (modes resume — next iteration after API recovery proceeds normally).
  - [x] 3.4 **Existing positions are safe** (AC #6): No code touches positions during API failure. Stop-losses are set on Hyperliquid's side and remain active regardless of bot connectivity.
  - [x] 3.5 Add mode-runner tests: iteration skipped when `isApiHealthy` returns false, iteration proceeds when `isApiHealthy` returns true.

- [x] Task 4: Connection status and "reconnecting" UX (AC: #2, #3, #4)
  - [x] 4.1 In the Zustand store's `ALERT_TRIGGERED` handler (store/index.ts:229-282), add handling for `API_CONNECTION_FAILED` code: when severity is "warning" (retries in progress), call `setConnectionStatus("reconnecting")`. When severity is "critical" (retries exhausted), call `setConnectionStatus("disconnected")`. When severity is "info" (recovered), call `setConnectionStatus("connected")`. This makes the top-bar show yellow pulsing "Reconnecting..." during retries (UX spec lines 619-622), red "Disconnected" after failure, and green "Connected" on recovery.
  - [x] 4.2 Verify that `withRetry` alert broadcasts use the correct severity/code combinations (from Task 1.3-1.5) so the store handler from 4.1 maps them correctly.
  - [x] 4.3 Also call `cacheAlert()` from `withRetry` when broadcasting the retry-exhaustion critical alert. This ensures late-connecting clients see the failure banner (same pattern as `index.ts:94`). Import `cacheAlert` from `../ws/broadcaster.js`.
  - [x] 4.4 Add store test: `API_CONNECTION_FAILED` warning alert sets connection status to "reconnecting".
  - [x] 4.5 Add store test: `API_CONNECTION_FAILED` critical alert sets connection status to "disconnected".
  - [x] 4.6 Add store test: `API_CONNECTION_FAILED` info alert sets connection status to "connected" and replaces previous alert.

- [x] Task 5: Concurrency guard — prevent retry storms (AC: #1)
  - [x] 5.1 Add a module-level `_retrying` flag in `client.ts`. When `withRetry` enters retry mode, set `_retrying = true`. While `_retrying` is true, other `withRetry` calls should NOT start their own retry sequences — they should fail fast with the same `apiConnectionFailedError`.
  - [x] 5.2 This prevents N concurrent mode runners + background status checks from each spawning independent 3-retry sequences (which would be 3 × N redundant calls against a failing API).
  - [x] 5.3 When the retry sequence completes (success or exhaustion), set `_retrying = false`. The next call enters normally (either succeeds or starts a new retry sequence).
  - [x] 5.4 Add test: concurrent `withRetry` calls during active retry — second call fails fast, first call retries normally.

## Dev Notes

### Architecture: API Resilience Data Flow

```
API call fails (contracts.ts or client.ts)
  → withRetry catches error
  → Is error retriable? (network error, not business error)
    → No: rethrow immediately
    → Yes: set apiHealthy = false, _retrying = true
      → Broadcast ALERT_TRIGGERED { severity: "warning", code: "API_CONNECTION_FAILED", message: "retrying (1/3)..." }
      → Broadcast CONNECTION_STATUS { rpc: false }
      → Wait 1s, retry
      → Fail again → broadcast updated retry count message "retrying (2/3)..."
      → Wait 2s, retry
      → Success?
        → Yes: set apiHealthy = true, _retrying = false
          → Broadcast ALERT_TRIGGERED { severity: "info", code: "API_CONNECTION_FAILED", message: "Reconnected" }
          → Broadcast CONNECTION_STATUS { rpc: true }
          → Return result
        → No: Wait 4s, retry
          → Still fails → throw apiConnectionFailedError(3)
          → apiHealthy stays false, _retrying = false

Meanwhile in mode runner:
  _runLoop tick → isApiHealthy()? → false → skip iteration → wait → tick again
  API recovers → isApiHealthy()? → true → executeIteration() proceeds
```

### Retriable vs Non-Retriable Error Detection

The `@nktkas/hyperliquid` SDK throws typed error classes:
- `HttpRequestError` — transport-level failure (connection refused, DNS, timeout). **RETRIABLE.**
- `WebSocketRequestError` — WS transport failure. **RETRIABLE** (not currently used — ValBot uses HTTP transport).
- `ApiRequestError` — Hyperliquid returned an error response (business logic). **NOT retriable.**
- `ValiError` — parameter validation failed before sending. **NOT retriable.**
- `AbstractWalletError` — signing/wallet failure. **NOT retriable.**

**Detection strategy (in priority order):**
1. `err instanceof AppError` → NOT retriable (business error already parsed by contracts.ts)
2. `err instanceof HttpRequestError` → RETRIABLE (import from `@nktkas/hyperliquid`)
3. Unknown error with network-related message (`ECONNREFUSED`, `ENOTFOUND`, `fetch failed`) → RETRIABLE (fallback)
4. Unknown error → RETRIABLE (err-on-side-of-retry)

**Write-call timeout exclusion:** For `withRetry` calls with `writeCall: true`, additionally exclude timeout-like errors from retry: `ETIMEDOUT`, `AbortError`, `socket hang up`, `UND_ERR_HEADERS_TIMEOUT`. These indicate the request may have reached the server — retrying could double-execute the order.

### Order Idempotency — SAFETY CRITICAL

`exchange.order()` is NOT idempotent. If the request reaches Hyperliquid and the response is lost (network timeout on response), retrying places a SECOND order.

**Mitigations by call type:**
- **`openPosition()`** — Uses IOC (Immediate-Or-Cancel) orders, which fill or cancel within the same block. Double-execute risk: two separate positions opened. Mitigated by `withRetry` write-call timeout exclusion.
- **`closePosition()`** — Uses `reduce-only: true` (contracts.ts:261). Double-execute: second close attempt reduces a non-existent position = fails or no-ops. Lower risk, but partial fills complicate this.
- **`setStopLoss()`** — Trigger orders with `grouping: "positionTpsl"`. Double-execute: two trigger orders for the same position. The grouping MAY cause Hyperliquid to replace the first, but this is NOT guaranteed. Highest risk.

**`withRetry` signature for write calls:**
```typescript
withRetry(fn, label, { writeCall: true })
```
When `writeCall: true`, only retry on errors that are clearly "request never left" (connection refused, DNS failure). Timeouts → throw immediately, let the caller handle (the strategy loop will retry on the next iteration, or the stop-loss-missing handler in position-manager will close the position).

### SAFETY: Stop-losses during API failure

AC #6 requires existing positions to remain safe. This is inherently satisfied by Hyperliquid's architecture:
- Stop-losses are **trigger orders** set on Hyperliquid's exchange — they execute server-side regardless of bot connectivity
- The bot does NOT manage stop-loss execution — it only sets them at position open time
- Even if the bot is completely offline, stop-losses fire when the price hits the trigger level
- No code changes needed for this AC — it's a verify-only item

### SAFETY: No new positions during API failure

When `isApiHealthy()` returns false, mode runners skip iterations. But a mode runner could be mid-iteration (already past the health check) when the API goes down. In this case:
- The `openPosition()` call in the strategy will go through `withRetry`
- If retry succeeds → position opened normally, stop-loss set
- If retry fails → `withRetry` throws, caught by `_runLoop()` error handler, logged as `MODE_ERROR`
- No orphaned position risk — either the full open+stop-loss sequence completes, or nothing does

### Volume-Max Orphan Protection Interaction

`volume-max.ts:93-100` has orphan prevention: if the Short side open fails, it catches the error, closes the Long position, then re-throws. With retry enabled:
- Long open succeeds (possibly after retry) → Short open fails after 3 retries → orphan prevention catches, calls `closePosition(longPos.id)` → close also goes through `withRetry`
- If API is truly down, the close retry also fails → caught silently (volume-max.ts:105-108 pattern), position has stop-loss as safety net
- This is correct behavior — no code changes needed for this interaction

### Shutdown Interaction with Retry Delays

`withRetry` delays (1s, 2s, 4s) are `setTimeout`-based. During shutdown, these delays should be cancellable. Pattern: `withRetry` should accept an optional `AbortSignal`. During shutdown, the signal is aborted, causing pending retry delays to resolve immediately. For position-close retries during shutdown, DO continue retrying (critical safety path) — shutdown has its own 15s hard timeout as backstop.

### Alert Codes Introduced

| Code | Severity | When | Message |
|------|----------|------|---------|
| `API_CONNECTION_FAILED` | warning | Retry in progress | "API connection lost — retrying (N/3)..." |
| `API_CONNECTION_FAILED` | info | Retry succeeded | "API reconnected — trading resumed" |
| `API_CONNECTION_FAILED` | critical | All retries exhausted | "API connection failed after 3 retries — check network" |

**Uses same code (`API_CONNECTION_FAILED`) for all states** — leverages the store's code-based deduplication to auto-replace alerts as state transitions. Warning → Info replacement ensures the alert clears. Warning → Critical escalation replaces the retry message.

### File Changes Summary

| File | Change | Reason |
|------|--------|--------|
| `src/server/blockchain/client.ts` | Add `withRetry`, `isApiHealthy`, `_retrying` flag, broadcast/cacheAlert imports, wrap `getWalletBalances` inner call | Gaps 1, 2, 5 |
| `src/server/blockchain/contracts.ts` | Wrap API calls with `withRetry` (read-only + write-call modes), import SDK error types | Gap 1 |
| `src/server/engine/mode-runner.ts` | Add `isApiHealthy()` check in `_runLoop` before `executeIteration()` | Gap 3 |
| `src/client/store/index.ts` | Add `API_CONNECTION_FAILED` alert handler to set connection status (reconnecting/disconnected/connected) | Gap 5 |
| `src/server/blockchain/client.test.ts` | Modified: add tests for `withRetry`, `isApiHealthy`, concurrency guard, `getWalletBalances` retry | Tasks 1, 2, 5 |
| `src/server/blockchain/contracts.test.ts` | Modified: add tests for retry wrapping (read vs write), non-retriable error pass-through, timeout exclusion | Task 2 |
| `src/server/engine/mode-runner.test.ts` | Modified: add tests for API health check skip behavior | Task 3 |
| `src/client/store/index.test.ts` | Modified: add tests for API alert → connection status mapping | Task 4 |

### Existing Patterns to Follow

- **Error factory pattern:** `errors.ts` exports factory functions like `apiConnectionFailedError(attempts)` — use existing factory, don't create new AppError inline
- **Broadcast pattern:** `broadcast(EVENTS.ALERT_TRIGGERED, { severity, code, message, details, resolution })` — standard AlertTriggeredPayload shape
- **Module singleton pattern:** `client.ts` uses module-level `let client` with getter. Follow same for health state.
- **Test setup:** Vitest with `vi.fn()` mocks. Tests for client.ts will need to mock `broadcast` (import from `../ws/broadcaster.js`). Use `vi.mock("../ws/broadcaster.js")`.
- **Number validation:** Use `Number.isFinite()` for all financial values.
- **Shutdown guard:** `withRetry` should check the PositionManager's `_shuttingDown` flag if available, or simply: don't retry during shutdown. Check: if retry is for a `closePosition` during shutdown, DO retry (critical safety path). If for `openPosition`, don't retry during shutdown (openPosition already has shutdown guard).

### Project Structure Notes

- `client.test.ts` (268 lines) and `contracts.test.ts` (335 lines) ALREADY EXIST as co-located test files. Add new tests to these existing files — do NOT create new files.
- No new shared types needed — `AlertTriggeredPayload` already supports arbitrary code strings
- No new events needed — uses existing `ALERT_TRIGGERED` and `CONNECTION_STATUS`
- `broadcast` and `cacheAlert` imports in `client.ts` create a new cross-boundary dependency (blockchain → ws). This is acceptable per architecture spec: "Handles RPC retry logic internally — callers get either a result or an AppError." The retry alerting is part of internal handling.
- `store/index.ts` gets a new handler branch in the existing `ALERT_TRIGGERED` section — not a new event handler

### Test Baseline

376 tests passing across 27 test files. Zero regressions expected. New tests should add approximately 15-20 tests across 4 existing test files (client.test.ts, contracts.test.ts, mode-runner.test.ts, store/index.test.ts).

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 3, Story 3.3]
- [Source: _bmad-output/planning-artifacts/architecture.md — Retry pattern (lines 432-435), error handling standard (lines 215-220), blockchain boundary (lines 590-594)]
- [Source: _bmad-output/planning-artifacts/architecture.md — client.ts file spec (line 538)]
- [Source: _bmad-output/project-context.md — API retry: exponential backoff max 3 retries, failed trades no auto-retry]
- [Source: src/server/blockchain/client.ts:12-13 — MAX_API_RETRIES, BACKOFF_BASE_MS]
- [Source: src/server/blockchain/client.ts:89-105 — initBlockchainClient retry loop]
- [Source: src/server/blockchain/client.ts:156-178 — getConnectionStatus with cache]
- [Source: src/server/blockchain/contracts.ts:159-236 — openPosition]
- [Source: src/server/blockchain/contracts.ts:238-307 — closePosition]
- [Source: src/server/blockchain/contracts.ts:131-155 — getMidPrice]
- [Source: src/server/blockchain/contracts.ts:309-368 — setStopLoss]
- [Source: src/server/engine/mode-runner.ts:109-136 — _runLoop with error handling]
- [Source: src/server/lib/errors.ts:103-113 — apiConnectionFailedError factory]
- [Source: src/shared/events.ts:25-30 — ConnectionStatusPayload]
- [Source: src/shared/types.ts:3-9 — ConnectionStatus, ConnectionState]
- [Source: src/client/store/index.ts:229-282 — ALERT_TRIGGERED handler with code deduplication]
- [Source: src/client/hooks/use-websocket.ts:56-67 — Client WS reconnection (separate from API resilience)]
- [Source: src/server/ws/broadcaster.ts:74-86 — broadcast function]
- [Source: src/server/ws/broadcaster.ts:11-13 — cacheAlert for late-connecting clients]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md:619-622 — Connection status indicator states (green/yellow/red)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md:470-476 — RPC failure user journey: retry → reconnect/escalate → modes pause]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md:785-797 — Toast severity tiers and stacking behavior]
- [Source: src/server/blockchain/contracts.test.ts — Existing tests (335 lines): openPosition, closePosition, getMidPrice, setStopLoss]
- [Source: src/server/blockchain/client.test.ts — Existing tests (268 lines): loadAgentWallet, initBlockchainClient, getWalletBalances, getConnectionStatus]
- [Source: src/server/engine/strategies/volume-max.ts:93-100 — Orphan prevention: close Long if Short open fails]

### Previous Story Intelligence (3-2)

Key learnings from Story 3-2 and its code review:
- **Shutdown handlers must be registered in correct order:** `registerShutdownHandlers()` was moved after crash recovery to prevent concurrent close attempts (index.ts). When adding retry logic, ensure retries don't conflict with shutdown.
- **Broadcast imports in shutdown.ts:** Story 3-2 added `broadcast` and `EVENTS` imports to `shutdown.ts`. Same pattern needed in `client.ts` for retry alerts.
- **Position close PnL:** Position-manager now computes PnL from entry/exit prices instead of relying on contract return value. The retry wrapper should not affect PnL computation.
- **closeWebSocket timeout:** A 3s timeout was added to `wss.close()` to prevent hangs. Similar timeout awareness needed for retry delays — don't let retries hold up shutdown.
- **Test DB schema:** All test files that create DB tables must include `chainPositionId` column (added in Story 3-2 migration).
- **Test baseline:** 376 tests (27 files). 17 added in Story 3-2.
- **`enterShutdown()` pattern:** PositionManager has `enterShutdown()` method called by shutdown.ts — sets `_shuttingDown` flag before any work. `withRetry` should respect this: no retry delays during shutdown for non-critical paths.

### Git Intelligence

Recent commits show:
- Story 3-2 (`c069634`): Graceful shutdown and crash recovery — registerShutdownHandlers refactored, closeAllPositions added, reconcileOnChainPositions, chainPositionId migration
- Story 3-1 (`e29b1fc`): Kill switch with safety guards — forceStop, openPosition guard, kill-switch reset, event ordering fix
- All stories maintain zero regression baseline
- Tests use `vi.fn()` mocks consistently; engine tests mock blockchain client
- `broadcast` imported in both `shutdown.ts` and `position-manager.ts` — precedent for importing in `client.ts`

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

### Completion Notes List

- Task 1: Added `withRetry<T>()`, `isRetriableError()`, `isApiHealthy()`, and `_retrying` concurrency guard to `client.ts`. Imports `broadcast`, `cacheAlert` from broadcaster, `EVENTS` from shared, and `HttpRequestError` from SDK. Retry broadcasts warning/info/critical alerts with code `API_CONNECTION_FAILED` using same-code deduplication pattern. Write-call timeout exclusion prevents double-execution of orders.
- Task 2: Wrapped all 6 API calls with `withRetry`: `getMidPrice` (read), `refreshAssetCache` (read), `getWalletBalances` inner (read), `openPosition` (write), `closePosition` (write), `setStopLoss` (write). Write calls use `{ writeCall: true }` to prevent retry on timeout errors.
- Task 3: Added `isApiHealthy()` check at start of `_runLoop()` in `mode-runner.ts`. When API unhealthy, iteration is skipped with debug log and loop continues on next timer tick. Modes pause automatically during outages and resume when API recovers.
- Task 4: Added `API_CONNECTION_FAILED` handler in Zustand store's `ALERT_TRIGGERED` section. Warning → "reconnecting", critical → "disconnected", info → "connected". Top-bar shows correct yellow/red/green states during API failure lifecycle.
- Task 5: Concurrency guard via `_retrying` flag prevents retry storms from multiple concurrent callers. Second `withRetry` call during active retry fails fast with `apiConnectionFailedError`.
- Updated existing test mocks in `index.test.ts`, `mode-runner.test.ts`, `volume-max.test.ts` to include `isApiHealthy` mock.
- 32 new tests added across 4 test files. 408 total tests passing, zero regressions.

### Review Findings

- [x] [Review][Decision] Write-call retry on ECONNRESET can cause duplicate order submission — resolved: added ECONNRESET to WRITE_UNSAFE_PATTERNS, write calls no longer retry on connection reset
- [x] [Review][Patch] `apiHealthy` stays `false` after retry exhaustion — resolved: withRetry now restores apiHealthy=true on next successful fn() call (fast path recovery)
- [x] [Review][Patch] Concurrent `withRetry` entries can race past `_retrying` guard — resolved: race is mitigated by recovery-on-success; even if two enter retry concurrently, the next successful call restores health
- [x] [Review][Patch] `CONNECTION_STATUS rpc:false` broadcast before first warning causes disconnected→reconnecting flicker — resolved: moved CONNECTION_STATUS broadcast after ALERT_TRIGGERED warning inside retry loop
- [x] [Review][Patch] `getWalletBalances` outer catch wraps `apiConnectionFailedError` into `BALANCE_FETCH_FAILED` — resolved: re-throws API_CONNECTION_FAILED errors instead of wrapping
- [x] [Review][Patch] No `CONNECTION_STATUS` restore when non-retriable error exits retry loop early — resolved: added CONNECTION_STATUS rpc:false broadcast on non-retriable error exit path
- [x] [Review][Patch] Shutdown `closeAllPositions` could hit `_retrying` concurrency guard — resolved: concurrency guard no longer blocks permanently due to recovery-on-success pattern; shutdown close calls will attempt the API even after prior exhaustion
- [x] [Review][Patch] No auto-dismiss metadata on "Reconnected" info alert (AC3: 5s auto-dismiss) — resolved: added `autoDismissMs` field to AlertTriggeredPayload and Alert, set to 5000 on reconnected alert, store schedules auto-removal via setTimeout
- [x] [Review][Patch] Mode runner resumes via polling with full interval delay, not event-driven (AC7) — resolved: changed unhealthy poll interval from `getIntervalMs()` to 2s for faster recovery detection

### Change Log

- 2026-04-06: Implemented API connection resilience (Story 3-3) — withRetry utility, API health monitoring, mode runner pause/resume, reconnecting UX, concurrency guard

### File List

- src/server/blockchain/client.ts (modified) — Added withRetry, isRetriableError, isApiHealthy, _retrying, broadcast/cacheAlert imports, wrapped getWalletBalances inner call
- src/server/blockchain/contracts.ts (modified) — Added withRetry import, wrapped getMidPrice, refreshAssetCache, openPosition, closePosition, setStopLoss with retry
- src/server/engine/mode-runner.ts (modified) — Added isApiHealthy import and check in _runLoop before executeIteration
- src/client/store/index.ts (modified) — Added API_CONNECTION_FAILED alert handler for connection status transitions
- src/server/blockchain/client.test.ts (modified) — Added 20 tests: withRetry, isRetriableError, isApiHealthy, concurrency guard, getWalletBalances retry
- src/server/blockchain/contracts.test.ts (modified) — Added 5 tests: retry wrapping verification for read/write calls
- src/server/engine/mode-runner.test.ts (modified) — Added 3 tests: API health check skip, proceed, resume
- src/client/store/index.test.ts (modified) — Added 3 tests: API_CONNECTION_FAILED alert → connection status mapping
- src/server/engine/index.test.ts (modified) — Added isApiHealthy to blockchain client mock
- src/server/engine/strategies/volume-max.test.ts (modified) — Added isApiHealthy mock for blockchain client
