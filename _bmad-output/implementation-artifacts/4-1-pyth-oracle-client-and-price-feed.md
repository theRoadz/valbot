# Story 4.1: Pyth Oracle Client & Price Feed

Status: done

## Story

As a developer,
I want a reliable Pyth Network oracle client that streams continuous price feeds,
So that the Profit Hunter strategy has real-time price data to trade against.

## Acceptance Criteria

1. **Given** the blockchain client layer from Epic 1, **when** the Pyth oracle client is initialized, **then** `src/server/blockchain/oracle.ts` connects to the Pyth Network price feed via SSE (Server-Sent Events) subscription using the Hermes API.
2. **Given** the oracle client is connected, **when** price updates stream in, **then** price updates stream continuously for all configured trading pairs.
3. **Given** continuous price data, **when** sufficient data has accumulated, **then** the client maintains a 5-minute moving average for each subscribed pair.
4. **Given** the oracle is running, **when** any component requests price data, **then** price data is available via a typed interface: `getPrice(pair)` and `getMovingAverage(pair)`.
5. **Given** the SSE connection drops, **when** the client detects disconnection, **then** it reconnects with exponential backoff (same pattern as RPC retry in `client.ts`).
6. **Given** the feed is unavailable after retry exhaustion, **when** Profit Hunter mode attempts to start, **then** Profit Hunter mode is prevented from starting and an alert is broadcast.

## Tasks / Subtasks

- [x] Task 1: Install `@pythnetwork/hermes-client` package (AC: #1)
  - [x] 1.1 Run `pnpm add @pythnetwork/hermes-client`
  - [x] 1.2 Verify package installs cleanly and TypeScript types are available. **CRITICAL:** `EventSource` is a browser API — Node.js 22.x only has it behind `--experimental-websocket`. Check if `@pythnetwork/hermes-client` bundles an EventSource polyfill (inspect its dependencies for `eventsource` or similar). If NOT bundled, run `pnpm add eventsource` and `pnpm add -D @types/eventsource` to provide the global. Test by importing the client and calling `getStreamingPriceUpdates()` — if it throws `EventSource is not defined`, the polyfill is missing.

- [x] Task 2: Add shared types for Pyth price data (AC: #4)
  - [x] 2.1 In `src/shared/types.ts`, add `PythPriceData` interface: `{ price: number; confidence: number; expo: number; publishTime: number; feedId: string }` — price and confidence as raw integer values (NOT converted)
  - [x] 2.2 In `src/shared/types.ts`, add `PriceFeedEntry` interface: `{ pair: string; price: number; movingAverage: number; lastUpdate: number; feedId: string }` — price and movingAverage in smallest-unit integers (USDC × 1e6)
  - [x] 2.3 In `src/shared/types.ts`, add `PYTH_FEED_IDS` constant mapping pair names to Pyth hex feed IDs for supported pairs (at minimum: SOL-PERP, BTC-PERP, ETH-PERP)
  - [x] 2.4 In `src/shared/events.ts`, add `PRICE_UPDATED` event with payload type `PriceUpdatedPayload`: `{ pair: string; price: number; movingAverage: number; timestamp: number }` — prices in smallest-unit integers

- [x] Task 3: Implement `src/server/blockchain/oracle.ts` — Pyth Oracle Client (AC: #1, #2, #3, #4, #5)
  - [x] 3.1 Create `OracleClient` class with constructor accepting `broadcast` function (same pattern as engine components)
  - [x] 3.2 Implement `connect(pairs: string[])` — creates `HermesClient` pointed at `https://hermes.pyth.network`, resolves pair names to feed IDs via `PYTH_FEED_IDS`, builds a **reverse map** `feedIdToPair: Map<string, string>` (feedId→pair name) for use in the `onmessage` handler, then calls `getStreamingPriceUpdates(feedIds)` to open SSE stream
  - [x] 3.3 Implement SSE `onmessage` handler: `JSON.parse(event.data)` yields `{ parsed: [{ id, price: { price, conf, expo, publish_time }, ema_price: {...} }] }` — the `parsed` array may contain multiple feed updates per message. For each entry: look up pair name via `feedIdToPair.get(entry.id)`, convert Pyth price (`parseInt(price) * 10^expo`) to smallest-unit integer (`Math.round(usdPrice * 1e6)`), store in `Map<string, PriceEntry>`
  - [x] 3.4 Implement 5-minute moving average: maintain a circular buffer of price samples per pair (one sample per update, capped at 5 minutes of history based on `publishTime`). Calculate simple moving average over all samples within the 5-minute window. Store result in the same `PriceEntry` map.
  - [x] 3.5 Implement `getPrice(pair): number | null` — returns latest price in smallest-unit integer, or `null` if no data
  - [x] 3.6 Implement `getMovingAverage(pair): number | null` — returns 5-minute SMA in smallest-unit integer, or `null` if insufficient data (less than 30 seconds of samples)
  - [x] 3.7 Implement `isAvailable(pair?: string): boolean` — if `pair` is provided, returns `true` only if that specific pair has received a price update within the last 30 seconds. If no `pair` argument, returns `true` if SSE connection is active and ANY pair has been updated within 30 seconds. The engine gate in `startMode()` calls `isAvailable()` without args for the global check.
  - [x] 3.8 Implement SSE `onerror` handler with reconnection: exponential backoff (1s, 2s, 4s), max 3 retries, then broadcast `alert.triggered` (critical severity) with resolution: "Pyth oracle feed unavailable. Check network connection and Pyth Network status at https://pyth.network"
  - [x] 3.9 Implement `disconnect()` — close SSE connection, clear price buffers, used during shutdown
  - [x] 3.10 On each price update, broadcast `PRICE_UPDATED` WebSocket event with latest price and moving average (debounce to max 1 broadcast per 500ms per pair to avoid flooding dashboard)
  - [x] 3.11 Log price feed connections at `info` level, disconnections at `warn`, reconnection attempts at `warn`, feed failures at `error`
  - [x] 3.12 Implement staleness-based proactive reconnection: start a `setInterval` heartbeat check (every 10 seconds) that checks if the most recent price update is older than `STALE_THRESHOLD_MS` (30s). If stale while `isConnected` is true, the SSE stream may have silently closed (e.g., 24-hour Hermes auto-disconnect sends no `onerror`). In this case, proactively close the current EventSource and trigger the reconnection sequence. Clear the interval on `disconnect()`.

- [x] Task 4: Add oracle error factories to `src/server/lib/errors.ts` (AC: #5, #6)
  - [x] 4.1 Add `oracleConnectionFailedError(details)` — severity: critical, code: ORACLE_CONNECTION_FAILED, resolution: "Pyth oracle feed unavailable. Check network connection and Pyth Network status."
  - [x] 4.2 Add `oracleFeedUnavailableError(mode)` — severity: warning, code: ORACLE_FEED_UNAVAILABLE, resolution: "{mode} mode requires live oracle price data which is currently unavailable. Wait for Pyth feed to reconnect or check network status."
  - [x] 4.3 Add `oracleStaleDataError(pair, lastUpdate)` — severity: warning, code: ORACLE_STALE_DATA, resolution: "Price data for {pair} is stale (last update: {lastUpdate}). Verify Pyth feed status."

- [x] Task 5: Integrate oracle with engine startup/shutdown (AC: #6)
  - [x] 5.1 In `src/server/engine/index.ts`, add oracle client initialization in `initEngine()` — create `OracleClient` instance and store as module-level reference (same pattern as `positionManager`, `fundAllocator`)
  - [x] 5.2 Export `getOracleClient()` function for strategy access
  - [x] 5.3 In engine's `startMode()`, if mode is `profitHunter`: check `oracleClient.isAvailable()` before starting. If unavailable, throw `oracleFeedUnavailableError()` to prevent starting Profit Hunter without price data.
  - [x] 5.4 In `src/server/lib/shutdown.ts`, add oracle disconnect to the shutdown sequence. The current sequence is: (1) block positions, (2) broadcast alert, (3) stop modes, (4) close remaining positions, (5) close Fastify, (6) close WebSocket, (7) close DB. Insert `oracleClient.disconnect()` as a new step between step 4 (close positions) and step 5 (close Fastify) — positions may reference oracle data during closing, so oracle must remain available until positions are fully closed. Follow the same try-catch-log pattern as other steps.
  - [x] 5.5 Ensure oracle connects on engine init with the pairs from config (or a default set). The oracle should start streaming immediately so data is warm when Profit Hunter mode starts.

- [x] Task 6: Tests (AC: all)
  - [x] 6.1 `src/server/blockchain/oracle.test.ts` (**New**) — Test OracleClient:
    - Constructor creates instance with broadcast function
    - `connect()` creates HermesClient and opens SSE stream (mock HermesClient)
    - `onmessage` handler correctly parses Pyth price format and converts to smallest-unit integers
    - Moving average calculation is correct with known sample data
    - Moving average returns null when insufficient data (<30s of samples)
    - `getPrice()` returns latest price or null when no data
    - `getMovingAverage()` returns SMA or null
    - `isAvailable()` returns false when no updates received in 30s
    - SSE error triggers reconnection with exponential backoff
    - After 3 failed reconnections, broadcasts critical alert
    - `disconnect()` closes SSE and clears buffers
    - Price broadcast is debounced (max 1 per 500ms per pair)
    - Staleness heartbeat triggers reconnection when no updates received for 30s
    - `isAvailable("SOL-PERP")` returns per-pair availability correctly
  - [x] 6.2 `src/server/lib/errors.test.ts` (**Modified**) — Add tests for 3 new oracle error factories
  - [x] 6.3 `src/server/engine/index.test.ts` (**Modified**) — Add test: starting profitHunter mode when oracle unavailable throws `oracleFeedUnavailableError`
  - [x] 6.4 Run `pnpm test` to verify zero regressions

## Dev Notes

### What Already Exists (DO NOT recreate)

- **`withRetry()` in `src/server/blockchain/client.ts`** — Exponential backoff retry with API health tracking. The oracle should implement its OWN reconnection logic (SSE reconnection is different from REST retry), but follow the same backoff timing pattern (1s, 2s, 4s, max 3 attempts).
- **`broadcast()` in `src/server/ws/broadcaster.ts`** — WebSocket event broadcasting. Import and use for `PRICE_UPDATED` and `alert.triggered` events.
- **`AppError` class and factories in `src/server/lib/errors.ts`** — 37 existing factory functions. Add oracle-specific factories here.
- **`EventPayloadMap` in `src/shared/events.ts`** — Typed event catalog. Add `PRICE_UPDATED` event here.
- **`fromSmallestUnit()` / `toSmallestUnit()` in `src/shared/types.ts`** — Conversion helpers for USDC × 1e6 values. Use `toSmallestUnit()` when converting Pyth prices to internal format.
- **Engine singleton pattern in `src/server/engine/index.ts`** — Module-level references to `positionManager`, `fundAllocator`, `modeRunners`. Add `oracleClient` following the same pattern.
- **Shutdown sequence in `src/server/lib/shutdown.ts`** — Ordered shutdown steps. Insert oracle disconnect after stopping modes.
- **Logger in `src/server/lib/logger.ts`** — Pino logger. Use for oracle connection status logging.

### Architecture: Oracle Data Flow

```
Pyth Hermes API (SSE)
  → OracleClient.onmessage()
    → Parse price: raw_price × 10^expo
    → Convert to smallest-unit: Math.round(price_usd × 1e6)
    → Store in priceMap: Map<pair, { price, samples[], movingAvg, lastUpdate }>
    → Calculate 5-min SMA over samples within window
    → Debounced broadcast("price.updated", { pair, price, movingAverage, timestamp })

Profit Hunter Strategy (future Story 4.2)
  → oracleClient.getPrice("SOL-PERP")    → number (smallest-unit USDC)
  → oracleClient.getMovingAverage("SOL-PERP") → number (smallest-unit USDC)
  → Compare: if |price - MA| > threshold → open position
```

### Pyth Hermes Client — Key Technical Details

- **Package:** `@pythnetwork/hermes-client` (v3.1.0 latest stable)
- **Transport:** SSE (Server-Sent Events), NOT WebSocket. The `getStreamingPriceUpdates()` method returns an `EventSource` object.
- **Endpoint:** `https://hermes.pyth.network` (production, free tier)
- **Rate limits:** 30 requests per 10 seconds on free tier. SSE streaming counts as 1 request (long-lived connection).
- **Auto-disconnect:** SSE connections auto-close after 24 hours. MUST implement reconnection.
- **Price format:** `{ price: string, conf: string, expo: number, publish_time: number }` — price is a raw integer string, actual USD price = `parseInt(price) * 10^expo`. Example: price="6163260000000", expo=-8 → $61,632.60
- **EMA price:** Pyth provides its own `ema_price` field (exponentially-weighted MA). However, the acceptance criteria specify a 5-minute SMA, so calculate our own from raw price samples.
- **Feed IDs:** Hex strings, universal across chains:
  - SOL/USD: `0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d`
  - BTC/USD: `0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43`
  - ETH/USD: `0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace`

### Price Conversion Pipeline

```
Pyth raw: price = "3847250000", expo = -8
  → USD float: 3847250000 × 10^(-8) = $38.4725
  → Smallest-unit (USDC × 1e6): Math.round(38.4725 × 1_000_000) = 38_472_500
  → Stored and returned as integer: 38472500
```

**CRITICAL:** Use `Math.round()` after conversion to avoid floating-point drift. The conversion from Pyth format involves floating-point math (multiplying by `10^expo`), but the final stored value MUST be an integer in smallest-unit format per ADR-001.

### Moving Average Implementation

- Maintain a circular buffer (array) of `{ price: number, timestamp: number }` samples per pair
- On each price update, push new sample, prune samples older than 5 minutes (300,000ms)
- Safety cap: `MAX_SAMPLES_PER_PAIR = 2000` — if buffer exceeds this after pruning (e.g., Pyth sends bursts), drop oldest samples. Prevents unbounded memory growth. For 3 pairs at ~2 updates/sec over 5 min = ~1,800 samples, so 2,000 provides headroom.
- SMA = sum of all sample prices / count of samples
- Return `null` if fewer than 30 seconds of samples (cold start protection)
- The buffer grows naturally during the first 5 minutes, then stabilizes as old samples are pruned

### SSE Reconnection Pattern

```
SSE onerror fires
  → Set isConnected = false
  → Log warning: "Pyth oracle SSE disconnected, attempting reconnect"
  → Attempt 1: wait 1s → reconnect
  → Attempt 2: wait 2s → reconnect
  → Attempt 3: wait 4s → reconnect
  → All failed: broadcast alert.triggered (critical) with resolution
  → Set oracleAvailable = false
  → On successful reconnect: reset attempt counter, set isConnected = true, log info
```

The SSE connection also auto-closes after 24 hours (Hermes server-side limit). This may NOT always fire `onerror` — the stream can close silently. The staleness heartbeat check (Task 3.12) detects this case and triggers reconnection proactively.

### Profit Hunter Gate (Engine Integration)

In `src/server/engine/index.ts`, the `startMode()` function currently validates mode config and fund allocation before starting. Add an oracle availability check specifically for `profitHunter` mode:

```
startMode(mode):
  ... existing validation ...
  if mode === "profitHunter":
    if !oracleClient.isAvailable():
      throw oracleFeedUnavailableError("profitHunter")  // param is mode name, not pair
  ... start mode runner ...
```

This prevents starting Profit Hunter without live price data. Volume Max and Arbitrage modes do NOT require the oracle gate.

### File Placement

- `src/server/blockchain/oracle.ts` — New file. Same directory as `client.ts` and `contracts.ts`. The blockchain directory owns all external data source connections.
- `src/server/blockchain/oracle.test.ts` — Co-located test file.
- All other changes are modifications to existing files.

### Existing Patterns to Follow

- **Error factories:** Follow the domain-grouped pattern in `errors.ts`. Add an `// Oracle` comment group.
- **Import convention:** Use `.js` extensions in imports: `import { logger } from "../lib/logger.js"`
- **Pino logging:** `logger.info({ pairs, endpoint }, "Pyth oracle connected")` — structured context objects.
- **Event constants:** Add to `EVENTS` object in `events.ts` as `PRICE_UPDATED: "price.updated"`.
- **Module exports:** Export `OracleClient` class and typed interfaces. Use named exports, not default.
- **Constants:** `UPPER_SNAKE_CASE` for configuration values like `MOVING_AVERAGE_WINDOW_MS = 300_000`, `STALE_THRESHOLD_MS = 30_000`, `BROADCAST_DEBOUNCE_MS = 500`, `MAX_SAMPLES_PER_PAIR = 2_000`, `HEARTBEAT_INTERVAL_MS = 10_000`.

### Previous Story Intelligence (3-5)

Key learnings from Story 3-5 (Error Handling Framework):
- **All errors use factory functions** — never inline `new AppError(...)`. Add oracle factories to `errors.ts`.
- **28 factory functions already exist** — follow the exact same pattern for oracle errors.
- **Alert broadcasts include resolution field** — every oracle error MUST have actionable resolution text.
- **Test baseline:** 465 tests pass (28 files). Run `pnpm test` before starting to confirm.
- **Code review applied critical fixes** including race condition handling and fund release in error paths. Be mindful of similar patterns in oracle reconnection (e.g., don't lose state during reconnection attempts).

### Git Intelligence

Recent commits show consistent patterns:
- `baf3566`: Story 3-5 — Error handling framework. 28 error factories added, transaction safety hardened.
- `491a61c`: Story 3-4 — AlertBanner and toast system. Alert routing: critical→banner, warning→toast, info→auto-dismiss.
- `47aa1e8`: Story 3-3 — API connection resilience. `withRetry()`, health monitoring, connection status broadcasts.
- `c069634`: Story 3-2 — Graceful shutdown. Ordered shutdown sequence, crash recovery.
- `e29b1fc`: Story 3-1 — Kill switch. Per-mode threshold monitoring, cascading alerts.

Pattern: Each story commits implementation + tests together. All test files use Vitest + `vi.fn()` mocks. Tests verify both happy path and error/edge cases.

### Critical Warnings

1. **Do NOT use `@pythnetwork/price-service-client`** — it is deprecated. Use `@pythnetwork/hermes-client` (v3.x).
2. **Do NOT use `@pythnetwork/client`** — it is the old Solana-specific client, also deprecated.
3. **Do NOT use WebSocket for Pyth Core** — Hermes uses SSE (Server-Sent Events). The `getStreamingPriceUpdates()` method returns an `EventSource`, not a WebSocket.
4. **Do NOT use `real()` or floating-point for stored prices** — convert Pyth prices to smallest-unit integers (USDC × 1e6) immediately on receipt. All internal price representation is integer per ADR-001.
5. **Do NOT store prices in the database** — price data is ephemeral, kept in-memory only. The oracle is a real-time data source, not a persistence layer.
6. **Do NOT modify `withRetry()` in `client.ts`** — implement oracle-specific reconnection logic in `oracle.ts`. The patterns are similar but SSE reconnection is fundamentally different from REST retry.
7. **Do NOT block engine initialization** on oracle connection — connect asynchronously. The oracle gate in `startMode()` prevents Profit Hunter from starting before data is available, but other modes should not be delayed.
8. **Do NOT broadcast price updates for every SSE message** — debounce to max 1 broadcast per 500ms per pair. Pyth can send updates multiple times per second; flooding the WebSocket to the dashboard would waste bandwidth.
9. **Feed IDs are hex strings with `0x` prefix** — do NOT strip the prefix when passing to HermesClient. The SDK expects the full hex string.
10. **SSE auto-disconnects after 24 hours** — this is expected behavior from Hermes, not an error. The 24-hour disconnect may NOT fire `onerror` (silent close). The staleness heartbeat (Task 3.12) detects this and triggers reconnection proactively.

### Project Structure Notes

- `src/server/blockchain/oracle.ts` — New file in the blockchain boundary. This is the correct location per architecture: blockchain directory owns all external data source connections (Hyperliquid API, Pyth oracle).
- No new client-side components needed for this story — price display on dashboard is a future concern.
- The `PRICE_UPDATED` WebSocket event is defined now for forward compatibility, but the dashboard store handler for it will be added in Story 4.2 or later.

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 4, Story 4.1]
- [Source: _bmad-output/planning-artifacts/architecture.md — Blockchain Boundary, Integration Points, oracle.ts placement]
- [Source: _bmad-output/planning-artifacts/architecture.md — ADR-001: Numeric Precision (smallest-unit integers)]
- [Source: _bmad-output/planning-artifacts/architecture.md — Error Handling Framework, AppError pattern]
- [Source: _bmad-output/planning-artifacts/prd.md — FR3 (Profit Hunter mode), NFR4 (Pyth oracle continuous feeds)]
- [Source: _bmad-output/planning-artifacts/prd.md — Blockchain/Web3 Requirements: Pyth Network for price feeds]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — Mode independence, error severity tiers]
- [Source: _bmad-output/project-context.md — Boundary rules, error handling, naming conventions]
- [Source: src/server/blockchain/client.ts — withRetry() pattern, exponential backoff, API health tracking]
- [Source: src/server/blockchain/contracts.ts — Contract interface pattern, error factory usage]
- [Source: src/shared/types.ts — Existing type patterns, toSmallestUnit/fromSmallestUnit helpers]
- [Source: src/shared/events.ts — Event catalog, EventPayloadMap pattern]
- [Source: src/server/engine/index.ts — Engine singleton, module-level references, startMode() validation]
- [Source: src/server/lib/shutdown.ts — Ordered shutdown sequence]
- [Source: src/server/lib/errors.ts — 37 existing error factory functions]
- [Source: _bmad-output/implementation-artifacts/3-5-error-handling-framework-and-transaction-safety.md — Previous story learnings]
- [Source: Pyth Developer Hub — Hermes Client API, feed IDs, SSE streaming]
- [Source: npm @pythnetwork/hermes-client v3.1.0 — Package API reference]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
- Test baseline: 466 passed, 1 pre-existing failure (resetKillSwitch)
- Final: 485 passed, same 1 pre-existing failure
- TypeScript compiles clean (npx tsc --noEmit passes)
- hermes-client v3.1.0 bundles eventsource@^3.0.5 — no separate polyfill needed
- Actual API method is `getPriceUpdatesStream` (not `getStreamingPriceUpdates` as story noted)
- Feed IDs from Pyth SSE come WITHOUT 0x prefix — oracle prepends "0x" for reverse map lookup

### Completion Notes List
- Task 1: Installed @pythnetwork/hermes-client v3.1.0 via pnpm. EventSource polyfill bundled.
- Task 2: Added PythPriceData, PriceFeedEntry, PYTH_FEED_IDS to types.ts. Added PRICE_UPDATED event and PriceUpdatedPayload to events.ts.
- Task 3: Created OracleClient class in oracle.ts with all specified methods: connect, getPrice, getMovingAverage, isAvailable, disconnect. Includes SSE message parsing, 5-min SMA, exponential backoff reconnection, staleness heartbeat, and debounced price broadcasts.
- Task 4: Added 3 oracle error factories: oracleConnectionFailedError, oracleFeedUnavailableError, oracleStaleDataError.
- Task 5: Integrated oracle into engine init (non-blocking connect), exported getOracleClient(), added profitHunter oracle gate in startMode(), added oracle disconnect to shutdown sequence (step 5, before Fastify close).
- Task 6: 13 oracle unit tests, 3 error factory tests, 1 engine integration test. Updated events count test. All pass.

### File List
- src/server/blockchain/oracle.ts (New) — OracleClient class
- src/server/blockchain/oracle.test.ts (New) — 13 unit tests
- src/shared/types.ts (Modified) — Added PythPriceData, PriceFeedEntry, PYTH_FEED_IDS
- src/shared/events.ts (Modified) — Added PRICE_UPDATED event and PriceUpdatedPayload
- src/shared/events.test.ts (Modified) — Updated EVENTS count from 9 to 10
- src/server/lib/errors.ts (Modified) — Added 3 oracle error factories
- src/server/lib/errors.test.ts (Modified) — Added 3 oracle error factory tests
- src/server/engine/index.ts (Modified) — Oracle init, getOracleClient export, profitHunter gate
- src/server/engine/index.test.ts (Modified) — Added oracle mock, profitHunter gate test, updated unsupported mode test
- src/server/lib/shutdown.ts (Modified) — Added oracle disconnect step
- package.json (Modified) — @pythnetwork/hermes-client dependency
- pnpm-lock.yaml (Modified) — lockfile updated

### Review Findings

- [x] [Review][Decision] `movingAverage ?? 0` in broadcast masks `null` — resolved: changed `PriceUpdatedPayload.movingAverage` to `number | null`, broadcast `null` when MA unavailable
- [x] [Review][Patch] `isAvailable(pair)` skips `isConnected` check — fixed: added `isConnected` guard to per-pair path [oracle.ts]
- [x] [Review][Patch] `oracleConnectionFailedError` imported but never called — fixed: `attemptReconnect()` now uses factory [oracle.ts]
- [x] [Review][Patch] No guard against concurrent `connect()` / `attemptReconnect()` chains — fixed: added `connecting` flag [oracle.ts]
- [x] [Review][Patch] No validation of `rawPrice`/`expo` — fixed: added `isNaN` and `Number.isFinite` guards [oracle.ts]
- [x] [Review][Patch] `reconnectTimer` not cancelled before overwrite in `attemptReconnect()` — fixed: added `clearTimeout` before reassignment [oracle.ts]
- [x] [Review][Patch] `oracleStaleDataError` factory never called — fixed: wired into staleness heartbeat [oracle.ts]
- [x] [Review][Patch] `PriceFeedEntry` type never produced — fixed: added `getFeedEntry(pair)` returning `PriceFeedEntry | null` [oracle.ts]
- [x] [Review][Patch] `PythPriceData` never instantiated — fixed: stored raw data in PriceEntry, added `getRawData(pair)` [oracle.ts]
- [x] [Review][Patch] Running modes not notified when oracle disconnects — fixed: `handleError()` broadcasts warning alert when connection was active [oracle.ts]
- [x] [Review][Patch] `priceMap` not cleared on `connect()` for dropped pairs — fixed: prune entries for pairs not in new subscription [oracle.ts]
- [x] [Review][Patch] Clock skew: `lastUpdate` used Pyth `publish_time` — fixed: now uses `Date.now()` for local-clock consistency [oracle.ts]

## Change Log
- 2026-04-06: Implemented Story 4.1 — Pyth Oracle Client & Price Feed. Added OracleClient with SSE streaming, 5-min SMA, reconnection with exponential backoff, staleness heartbeat, debounced price broadcasts. Integrated with engine startup/shutdown and profitHunter mode gate. 19 new tests added.
- 2026-04-06: Code review complete — 12 patches applied (all 7 original + 5 formerly deferred). Added getFeedEntry(), getRawData(), disconnect alert broadcast, priceMap pair pruning, Date.now() for lastUpdate. 8 new tests added (21 total oracle tests).
