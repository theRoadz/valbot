# Deferred Work

## Deferred from: code review of 1-1-project-scaffolding-and-dev-environment (2026-04-04)

- SPA catch-all serves index.html for mistyped API routes in production [src/server/index.ts:21] — should scope the not-found handler to non-API routes when API routes are added
- ~~db/index.ts executes at module load with no error handling~~ — resolved in Story 1.2: added try/catch with meaningful error
- Top-level await may fail if dist/ deployed without package.json [src/server/index.ts:17,29] — deployment packaging should ensure package.json (with "type": "module") is included in dist/
- ~~SQLite database path is relative with no CWD guarantee~~ — resolved in Story 1.2: env var `VALBOT_DB_PATH` with project-root fallback

## Deferred from: code review of 1-2-database-schema-and-migration-setup (2026-04-04)

- ~~`real` type for financial fields~~ — resolved: ADR-001 approved, Task 5 added to Story 1-2 to convert to `integer()` smallest-unit
- ~~Module-level side effect: DB opens on import~~ — resolved: ADR-002 approved, Task 6 added to Story 1-2 to convert to lazy `getDb()`

## Deferred from: code review of 1-2-database-schema-and-migration-setup, round 2 (2026-04-04)

- ~~`closeDb()` then `getDb()` silently re-opens DB~~ — resolved: added `_closed` flag guard
- ~~SQLite integer values above `Number.MAX_SAFE_INTEGER` lose precision via `better-sqlite3`~~ — resolved: added `assertSafeInteger()` guard for callers to validate before writes.
- ~~No migration guard — `getDb()` returns handle to unmigrated DB~~ — resolved: added table existence check on init
- ~~`drizzle.config.ts` DB path is CWD-relative vs `index.ts` absolute path~~ — resolved: now uses `__dirname`-anchored resolution
- ~~`__dirname` ESM shim breaks when bundled~~ — resolved: replaced with `process.cwd()` in index.ts and drizzle.config.ts.
- ~~`getDb()`/`closeDb()` have no unit tests~~ — resolved: added 4 tests

## Deferred from: code review of story 1-3 (2026-04-04)

- ~~PositionsTable not scrollable when rows exceed available height~~ — resolved: added `overflow-auto` to CardContent
- ~~TradeLog ScrollArea height chain may not resolve correctly~~ — resolved: added `overflow-hidden` to CardContent
- ~~`min-w-[1280px]` causes horizontal scroll on narrow viewports~~ — resolved: added `overflow-hidden` to root container
- ~~Non-standard bare `src/client` path alias~~ — resolved: renamed to `@client` across all configs and UI component imports

## Deferred from: code review of story 1-4 (2026-04-04)

- ~~`WsMessage.event` typed as `string`~~ — resolved: added `EventName` type, tightened `WsMessage.event` and `broadcast()` parameter
- ~~Server sends `rpc: false` on initial connect causing flicker~~ — resolved: removed placeholder initial message
- ~~No `teardown`/`close` for broadcaster singletons~~ — resolved: added `closeWebSocket()` export

## Deferred from: code review of story 1-5 (2026-04-04)

- ~~`alertIdCounter` resets on HMR module re-evaluation~~ — resolved: initialized from `Date.now()` for HMR-safe unique IDs
- ~~`Number(account.amount)` loses precision above `Number.MAX_SAFE_INTEGER`~~ — resolved: added `MAX_SAFE_INTEGER` guard with warning log and clamping
- ~~RPC call on every WS client connection~~ — resolved: added 5s TTL cache on `getConnectionStatus()`
- ~~`loadSessionKey` doesn't explicitly check key length (64 bytes)~~ — resolved: added explicit length check with clear error message
- ~~Session key `err.message` may contain key fragments in alert `details`~~ — resolved: raw error messages no longer forwarded to client, logged server-side only

## Deferred from: code review of story 2-1 (2026-04-04)

- ~~`AlertTriggeredPayload` lacks `id`/`timestamp` vs `Alert` interface~~ — resolved: documented mapping contract, made WsMessage generic for typed payload access
- ~~DB integer (USDC x 1e6) vs shared type `number` — no conversion layer~~ — resolved: added `fromSmallestUnit()`/`toSmallestUnit()` helpers in shared/types.ts
- ~~`PUT /api/mode/:mode/config` body has no range validation~~ — resolved: added minimum/maximum constraints on allocation, slippage, and pairs maxItems

## Deferred from: code review of story 2-2 (2026-04-04)

- ~~`closePosition` does not handle on-chain close failure~~ — resolved: wrapped in try/catch with AppError, position preserved for retry
- ~~DB insert failure after successful on-chain open orphans on-chain position~~ — resolved: DB insert wrapped in try/catch, closes on-chain and releases funds on failure
- ~~`loadFromDb` resets remaining to full allocation, ignoring open positions~~ — resolved: added `reconcilePositions()` called from `initEngine()` after both loads
- ~~Kill-switch does not set mode status to "kill-switch"~~ — resolved: added `_modeStatus` map, `getModeStatus()`, wired to status API

## Deferred from: code review of story 2-3 (2026-04-04)

- ~~Concurrent startMode calls race — no mutex/lock~~ — resolved: added per-mode lock via modeLocks Set in engine/index.ts
- ~~Rapid stop-then-start overlaps closeAllForMode with new runner~~ — resolved: same per-mode lock guards both startMode and stopMode
- ~~stopAllModes stops runners sequentially~~ — resolved: now uses Promise.allSettled for parallel shutdown
- ~~Shutdown has no timeout~~ — resolved: added 15s hard deadline with forceTimer.unref() in shutdown.ts

## Deferred from: code review of story 2-4 (2026-04-04)

- ~~Safety timeout + API in-flight creates split-brain on slow API~~ — resolved: added AbortController to cancel in-flight fetch when timeout fires, clear timeout on successful API response
- ~~Rapid toggles can cause concurrent API calls and stale reverts~~ — resolved: added togglingRef lock to prevent concurrent toggle operations
- ~~fetchStatus JSON response not runtime-validated~~ — resolved: added isValidStatusResponse runtime shape validator, throws INVALID_RESPONSE ApiError on mismatch

## Deferred from: code review of story 2-5 (2026-04-04)

- ~~`setModeConfig` can overwrite `stats` via `Partial<ModeConfig>` spread without calling `aggregateSummaryStats()` — summary stats silently diverge until next STATS_UPDATED event~~ — resolved: added `aggregateSummaryStats()` call to `setModeConfig` [src/client/store/index.ts:125]

## Deferred from: code review of story 8-2-hyperliquid-blockchain-layer-rewrite (2026-04-05)

- ~~W1: `status.ts` always returns hardcoded `disconnected`~~ — resolved: wired `getConnectionStatus()` into `/api/status` with fallback
- ~~W2: Asset cache never refreshes after init~~ — resolved: added 1h TTL with background refresh on cache miss
- ~~W3: `loadFromDb` recovered positions use fabricated `chainPositionId: "recovered-${id}"`~~ — resolved in Story 3-2: added `chainPositionId` DB column, `reconcileOnChainPositions()`, and computed PnL from entry/exit prices
- ~~W4: `getConnectionStatus` has no stale-while-revalidate~~ — resolved: returns stale cached data on API failure instead of throwing
- ~~W5: Hardcoded 0.025% taker fee~~ — resolved: fee rate now configurable via `TAKER_FEE_RATE` env var (defaults to 0.025%)

## Deferred from: code review of story 2-6-live-trade-log (2026-04-05)

- ~~W1: `typeof` guards on WS payload numeric fields accept `NaN` and `Infinity`~~ — resolved: replaced with `Number.isFinite()` in both STATS_UPDATED and TRADE_EXECUTED handlers
- ~~W2: `typeof` guard on `pair` field accepts empty string~~ — resolved: added `data.pair.length > 0` guard in TRADE_EXECUTED handler

## Deferred from: story 2-7-open-positions-table (2026-04-05)

- [ ] Live mark price and PnL for PositionsTable — requires a position.updated WS event or Pyth oracle feed integration (Story 2.7 renders "—" for Mark/PnL columns until this is available)

## Deferred from: code review of story 2-7-open-positions-table (2026-04-05)

- [ ] D1: Position close matching by (mode, pair, side) is ambiguous when duplicates exist — needs server-side position ID in close events
- ~~D2: No upper bound on positions array from WS events~~ — resolved: added `.slice(-200)` cap in POSITION_OPENED handler
- ~~D3: loadInitialStatus does not validate individual position objects~~ — resolved: added `isValidPosition()` filter in loadInitialStatus
- ~~D4: POSITION_CLOSED setTimeout is never cancelled on unmount/reconnect~~ — resolved: added `pendingCloseTimers` Map tracking with cleanup on rehydration
- ~~D5: TableRow base hover:bg-muted/50 may conflict with custom hover:bg-surface-elevated~~ — dismissed: `cn()` uses `twMerge` which correctly resolves the conflict

## Deferred from: code review of story 3-1-per-mode-kill-switch (2026-04-06)

- ~~D4: Stale `onKillSwitch` callback could kill newly started runner~~ — resolved: callback now checks `getModeStatus` before stopping runner
- ~~D9: `closeAllForMode` partial failure leaves orphan positions~~ — resolved: failed positions tracked with `KILL_SWITCH_CLOSE_FAILED` critical alert
- ~~D10: `closeAllForMode` PnL uses custom formula instead of `closeResult.pnl`~~ — resolved: now uses `result.pnl` directly from contract

## Deferred from: code review of story 3-2-graceful-shutdown-and-crash-recovery (2026-04-06)

- ~~D1: `closeWebSocket` may hang if `fastify.close()` already destroyed the underlying HTTP server~~ — resolved: added 3s timeout to `wss.close()` callback in broadcaster.ts
- ~~D2: PnL always 0 from contracts — `returnedAmount` ignores actual profit/loss~~ — resolved: position-manager now computes PnL from (exitPrice - entryPrice) / entryPrice * size, with side awareness
- ~~D3: SIGINT during `reconcileOnChainPositions` at startup creates concurrent close attempts~~ — resolved: moved `registerShutdownHandlers()` after crash recovery in index.ts

## Deferred from: code review of story 3-3-rpc-connection-resilience (2026-04-06)

- ~~No auto-dismiss metadata on "Reconnected" info alert (AC3: 5s auto-dismiss)~~ — resolved: added `autoDismissMs` field to AlertTriggeredPayload/Alert, store auto-removes after delay
- ~~Mode runner resumes via polling with full interval delay, not event-driven (AC7)~~ — resolved: changed unhealthy poll to 2s for faster recovery

## Deferred from: code review of story 3-4-alertbanner-and-toast-notification-system (2026-04-06)

- ~~Warning toasts with `duration: Infinity` have no explicit dismiss button~~ — resolved: added `cancel` button to warning toasts
- ~~Kill switch mode extraction regex fragility~~ — resolved: reuse validated `alertMode`, validate regex-extracted mode against VALID_MODES

## Deferred from: code review of story 3-5-error-handling-framework-and-transaction-safety (2026-04-06)

- ~~Race: kill-switch activates after `openPosition` passes guard~~ — resolved: added kill-switch re-check after `await contractOpenPosition()`
- ~~`_killSwitchActive` cleared after partial close failure~~ — resolved: only cleared when all positions successfully closed
- ~~Crash-recovery "already gone" positions never release funds~~ — resolved: added `fundAllocator.release()` in both reconciliation cleanup paths
- ~~Rollback-close success path never records trade~~ — resolved: added `fundAllocator.recordTrade(mode, size, 0)` after successful rollback close
- ~~Kill-switch alert `lossAmount` excludes triggering position's loss~~ — resolved: triggering position's PnL now included
- ~~`apiHealthy` stays false after non-retriable error during retry~~ — resolved: non-retriable errors restore `apiHealthy = true`

## Deferred from: code review of story 4-1-pyth-oracle-client-and-price-feed (2026-04-06)

- ~~`PriceFeedEntry` type defined but never produced by `OracleClient`~~ — resolved: added `getFeedEntry(pair)` method
- ~~`PythPriceData` interface defined but never instantiated~~ — resolved: stored raw data, added `getRawData(pair)` method
- ~~Running profitHunter mode has no ongoing oracle availability re-check after startup~~ — resolved: `handleError()` broadcasts warning alert when active connection drops
- ~~`priceMap` not cleared on `connect()` for dropped pairs~~ — resolved: added pair pruning on `connect()`
- ~~Clock skew between local machine and Pyth `publish_time`~~ — resolved: `lastUpdate` now uses `Date.now()` instead of Pyth publish_time

## Deferred from: code review of story 4-2-profit-hunter-strategy (2026-04-06)

- ~~Position size frozen at construction time~~ — resolved: added dynamic `getPositionSize()` that recalculates from current allocation each iteration when no explicit size configured

## Deferred from: code review of story 8-3-fund-allocation-sync-fix (2026-04-06)

- ~~No upper-bound validation on allocation~~ — resolved: added 10M USDC max in API schema (`maximum: 10_000_000`) and `ALLOCATION_TOO_LARGE` AppError guard in `FundAllocator.setAllocation()` [src/server/api/mode.ts, src/server/engine/fund-allocator.ts]

## Deferred from: code review of story 8-4-pair-selection-and-mode-start-fix (2026-04-06)

- ~~D3: `pairToOracleKey` silently handles malformed pair strings (no `/`)~~ — resolved: added validation guard with logger.warn, returns pair as-is so isAvailable() returns false [profit-hunter.ts:200]
- ~~D8: No server-side allowlist validation for `pairs` on start endpoint~~ — resolved: added `enum: VALID_PAIRS` constraint to pairs schema on both start and config endpoints [mode.ts:26,75]
- ~~D9: `catch` block on pair update swallows error silently in production~~ — resolved: added `toast.warning()` on rollback so user sees feedback [mode-card.tsx:265]

## Deferred from: code review of story 8-5-minimum-order-value-enforcement (2026-04-06)

- ~~`setStopLoss` derives baseSize from USDC/triggerPx, not from `filledSz`~~ — resolved: added `baseSz` to `SetStopLossParams`, piped from position-manager [contracts.ts:312]
- ~~`filledSz` not persisted to DB~~ — resolved: added `filledSz TEXT` column via migration 0002, wired into DB inserts and `loadFromDb` [schema.ts:31, position-manager.ts]
- ~~`roundToSzDecimals` with `szDecimals=0` and `floor` mode produces `"0"`~~ — resolved: added guard returning minimum unit (1/factor) when floor rounds to 0 [contracts.ts:132]

## Deferred from: code review of story 8-6-configurable-position-size-and-max-allocation (2026-04-06)

- `positionSize` updated while strategy is running not reflected until restart [engine/index.ts:88] — strategies snapshot config at construction; live config re-read is a broader architecture change

## Deferred from: code review of story 4-4-parallel-mode-execution-and-independent-control (2026-04-07)

- [ ] `loadFromDb` bypasses cross-mode total allocation validation — could restore over-allocated state after maxAllocation reduction [src/server/engine/fund-allocator.ts:148-181]
- [ ] `setMaxAllocation` doesn't clamp or warn when existing allocations already exceed new max [src/server/engine/fund-allocator.ts:199-225]
- [ ] `setAllocation(mode, 0)` with open positions leaves stale accounting — remaining capped at 0, released funds lost from accounting [src/server/engine/fund-allocator.ts]
- [ ] No negative allocation guard on server `setAllocation` — API schema validates but direct engine calls don't [src/server/engine/fund-allocator.ts]

## Deferred from: code review of story 4-3-arbitrage-strategy (2026-04-06)

- ~~No staleness guard on oracle `publishTime` after SSE reconnection~~ — resolved: added `publish_time` freshness check in `updatePrice()` — rejects prices where `receiveTime - publishTime > 30s` before creating/updating priceMap entry
