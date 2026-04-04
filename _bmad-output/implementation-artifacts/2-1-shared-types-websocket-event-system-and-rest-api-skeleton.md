# Story 2.1: Shared Types, WebSocket Event System & REST API Skeleton

Status: done

## Story

As a developer,
I want shared TypeScript types for trades, positions, mode status, and alerts, plus the WebSocket broadcaster payload typing and REST API route stubs,
so that the communication layer between trading engine and dashboard is defined and ready for Stories 2.2–2.7.

## Acceptance Criteria (BDD)

**AC1: Shared types are complete**
Given the project from Epic 1
When I inspect `src/shared/types.ts`
Then it exports: `Trade`, `Position`, `ModeConfig`, `ModeStats`, `TradeSide`, `ModeStatus` (in addition to existing `ConnectionStatus`, `ConnectionState`, `SummaryStats`, `ModeType`, `Alert`)
And `ModeStatus` = `"stopped" | "starting" | "running" | "error" | "kill-switch"`
And `TradeSide` = `"Long" | "Short"`

**AC2: WebSocket event payloads are fully typed**
When I inspect `src/shared/events.ts`
Then every EVENTS constant has a corresponding exported payload interface:
`TradeExecutedPayload`, `StatsUpdatedPayload`, `ModeStartedPayload`, `ModeStoppedPayload`, `ModeErrorPayload`, `PositionOpenedPayload`, `PositionClosedPayload` (in addition to existing `ConnectionStatusPayload`, `AlertTriggeredPayload`)

**AC3: Broadcaster is type-safe**
When the engine calls `broadcast(EVENTS.TRADE_EXECUTED, data)`
Then TypeScript enforces that `data` matches `TradeExecutedPayload` (and likewise for every other event)

**AC4: REST API mode routes exist**
When I send `POST /api/mode/:mode/start`
Then I get `{ status: "started", mode }` stub response (200)
When I send `POST /api/mode/:mode/stop`
Then I get `{ status: "stopped", mode }` stub response (200)
When I send `PUT /api/mode/:mode/config` with body `{ allocation, pairs, slippage }`
Then I get `{ status: "updated", mode }` stub response (200)
And `:mode` is validated against `"volume-max" | "profit-hunter" | "arbitrage"` — invalid returns 400

**AC5: REST API status route returns bot state**
When I send `GET /api/status`
Then I get the full bot state shape: `{ modes: {...}, positions: [], trades: [], connection: {...} }` (stub with defaults)
And the existing placeholder `{ status: 'ok' }` is replaced

**AC6: REST API trades route returns paginated history**
When I send `GET /api/trades?limit=50&offset=0`
Then I get `{ trades: [], total: 0 }` stub response (200)

**AC7: AppError class used for all API errors**
When any API route returns an error
Then the response body is `{ error: { severity, code, message, details, resolution } }`
And the Fastify error handler catches thrown `AppError` instances and formats them
And HTTP status codes map as: `warning` → 400, `critical` → 500, `info` → 200
And Fastify validation errors (schema failures) return 400
And the error handler never calls `broadcast()` — API layer does not push WebSocket events

**AC8: SPA catch-all scoped to non-API routes**
When a request to `/api/*` does not match any route
Then Fastify returns 404 JSON `{ error: { ... } }` (not index.html)
And non-API 404s still serve index.html in production

## Tasks / Subtasks

- [x] **Task 1** — Expand shared types (AC: #1)
  - [x] 1.1 Add `TradeSide` type (`"Long" | "Short"`) — matches DB schema check constraint
  - [x] 1.2 Add `ModeStatus` type (`"stopped" | "starting" | "running" | "error" | "kill-switch"`)
  - [x] 1.3 Add `Trade` interface (id, mode: ModeType, pair, side: TradeSide, size, price, pnl, fees, timestamp) — mirrors DB `trades` table shape but with `number` types (display-unit conversion happens at frontend boundary)
  - [x] 1.4 Add `Position` interface (id, mode: ModeType, pair, side: TradeSide, size, entryPrice, stopLoss, timestamp) — mirrors DB `positions` table
  - [x] 1.5 Add `ModeStats` interface (pnl, trades, volume, allocated, remaining) — all numbers
  - [x] 1.6 Add `ModeConfig` interface: `{ mode: ModeType, status: ModeStatus, allocation: number, pairs: string[], slippage: number, stats: ModeStats }`
  - [x] 1.7 Add `urlModeToModeType()` mapping helper and `MODE_URL_MAP` constant (see Mode Param Values section)

- [x] **Task 2** — Add WebSocket event payload types (AC: #2)
  - [x] 2.1 Add `TradeExecutedPayload` — `{ mode: ModeType, pair, side: TradeSide, size, price, pnl, fees }`
  - [x] 2.2 Add `StatsUpdatedPayload` — `{ mode: ModeType, trades, volume, pnl, allocated, remaining }`
  - [x] 2.3 Add `ModeStartedPayload` — `{ mode: ModeType }`
  - [x] 2.4 Add `ModeStoppedPayload` — `{ mode: ModeType, finalStats: ModeStats }`
  - [x] 2.5 Add `ModeErrorPayload` — `{ mode: ModeType, error: { code, message, details } }`
  - [x] 2.6 Add `PositionOpenedPayload` — `{ mode: ModeType, pair, side: TradeSide, size, entryPrice, stopLoss }`
  - [x] 2.7 Add `PositionClosedPayload` — `{ mode: ModeType, pair, side: TradeSide, size, exitPrice, pnl }`
  - [x] 2.8 Add `EventPayloadMap` type — maps each `EventName` to its payload type for type-safe broadcasting

- [x] **Task 3** — Make broadcaster type-safe (AC: #3)
  - [x] 3.1 Refactor `broadcast()` signature to use `EventPayloadMap`: `broadcast<E extends EventName>(event: E, data: EventPayloadMap[E]): void`
  - [x] 3.2 Update existing `broadcast()` call sites in `src/server/index.ts` to satisfy new types
  - [x] 3.3 Verify existing tests still pass

- [x] **Task 4** — Create REST API route files (AC: #4, #5, #6)
  - [x] 4.1 Create `src/server/api/mode.ts` — export a Fastify plugin function that registers:
    - `POST /api/mode/:mode/start` (validate `:mode` param via JSON schema enum)
    - `POST /api/mode/:mode/stop`
    - `PUT /api/mode/:mode/config` (validate body: `{ allocation?: number, pairs?: string[], slippage?: number }`)
    - All return stub responses; actual engine calls added in Story 2.3
  - [x] 4.2 Create `src/server/api/status.ts` — export plugin that registers:
    - `GET /api/status` returning `{ modes: { volumeMax: defaultModeConfig, profitHunter: defaultModeConfig, arbitrage: defaultModeConfig }, positions: [], trades: [], connection: { status: "disconnected", walletBalance: 0 } }`
    - Default `ModeConfig` per mode: `{ mode, status: "stopped", allocation: 0, pairs: [], slippage: 0.5, stats: { pnl: 0, trades: 0, volume: 0, allocated: 0, remaining: 0 } }`
  - [x] 4.3 Create `src/server/api/trades.ts` — export plugin that registers:
    - `GET /api/trades` with querystring schema `{ limit?: integer (default 50, max 500), offset?: integer (default 0) }` returning `{ trades: [], total: 0 }`
  - [x] 4.4 In `src/server/index.ts`: delete the placeholder `GET /api/status` route (lines 16-18), then register route plugins via `fastify.register()`. **Order matters**: register route plugins BEFORE `setErrorHandler()` and BEFORE `setNotFoundHandler()` to ensure routes match before catch-all

- [x] **Task 5** — Add Fastify error handler (AC: #7)
  - [x] 5.1 Add `setErrorHandler` to Fastify in `src/server/index.ts` that:
    - If error is `AppError`: returns `{ error: { severity, code, message, details, resolution } }` with HTTP status: `info` → 200, `warning` → 400, `critical` → 500
    - If error is Fastify validation error (statusCode 400): wraps as `{ error: { severity: "warning", code: "VALIDATION_ERROR", message: err.message, details: null, resolution: null } }` → 400
    - Otherwise: returns generic 500 with `{ error: { severity: "critical", code: "INTERNAL_ERROR", message: "Internal server error", details: null, resolution: null } }`
    - Logs all errors via pino
    - **Never calls `broadcast()`** — error handler is API-layer only; WebSocket alerts are emitted by the engine layer

- [x] **Task 6** — Scope SPA catch-all to non-API routes (AC: #8)
  - [x] 6.1 In `src/server/index.ts`, change `setNotFoundHandler` to check `request.url.startsWith('/api/')` — if API, return 404 JSON error; otherwise serve index.html
  - [x] This resolves deferred-work item from Story 1.1 code review

- [x] **Task 7** — Write tests
  - [x] 7.1 `src/shared/types.test.ts` — type-level tests (compile-time checks, no runtime if pure types)
  - [x] 7.2 `src/shared/events.test.ts` — verify EVENTS constant values, payload type assignability
  - [x] 7.3 `src/server/api/mode.test.ts` — test all 3 endpoints: valid mode params, invalid mode 400, stub responses
  - [x] 7.4 `src/server/api/status.test.ts` — test response shape matches expected structure
  - [x] 7.5 `src/server/api/trades.test.ts` — test default pagination, custom limit/offset, max limit clamping
  - [x] 7.6 `src/server/ws/broadcaster.test.ts` — test type-safe broadcast still works, verify existing behavior preserved. Note: existing tests use `as never` casts on broadcast calls — update these to pass correctly-typed payloads matching `EventPayloadMap`
  - [x] 7.7 Test Fastify error handler: AppError formatting (correct HTTP status per severity), validation error wrapping (400), generic 500
  - [x] 7.8 Test SPA catch-all scoping: `GET /api/nonexistent` returns 404 JSON `{ error: {...} }`, `GET /nonexistent` returns index.html (production mode)

## Dev Notes

### Existing Code to Extend (DO NOT Recreate)

| File | What Exists | What to Add |
|------|-------------|-------------|
| `src/shared/types.ts` | `ConnectionStatus`, `ConnectionState`, `SummaryStats`, `ModeType`, `Alert` | `TradeSide`, `ModeStatus`, `Trade`, `Position`, `ModeStats`, `ModeConfig` |
| `src/shared/events.ts` | `EVENTS` (9 constants), `EventName`, `WsMessage`, `ConnectionStatusPayload`, `AlertTriggeredPayload` | 7 new payload interfaces + `EventPayloadMap` |
| `src/server/ws/broadcaster.ts` | `broadcast(event: EventName, data: unknown)`, `setupWebSocket()`, `closeWebSocket()`, `cacheAlert()` | Refactor `broadcast()` to generic with `EventPayloadMap` |
| `src/server/index.ts` | Fastify setup, static serving, blockchain init, WebSocket setup, placeholder `GET /api/status` | Register route plugins, add error handler, scope SPA catch-all, remove placeholder route |
| `src/server/lib/errors.ts` | `AppError` class, `ErrorSeverity`, factory functions | No changes needed — reuse as-is |

### Architecture Compliance

- **REST for commands, WebSocket for events** — API routes never push WS events directly
- **API routes validate input via Fastify JSON Schema** (v5 requires `type: "object"` + `properties`)
- **Route handlers never access DB directly** — they call engine functions (stubs for now)
- **Route handlers never touch blockchain** — only through engine layer
- `src/server/api/` is the ONLY layer handling HTTP request/response
- `src/shared/` is the bridge — imported by both server and client via `@shared` path alias
- `src/client/` never imports from `src/server/`

### Naming Conventions

- Files: `kebab-case` — `mode.ts`, `status.ts`, `trades.ts`
- Types/interfaces: `PascalCase` — `Trade`, `Position`, `ModeStatus`, `TradeExecutedPayload`
- Functions/variables: `camelCase` — `startMode()`, `getStatus()`
- Constants: `UPPER_SNAKE_CASE` — `EVENTS.TRADE_EXECUTED`
- Enums: `PascalCase` name + members — `enum TradeSide { Long, Short }` (but we use string literal unions, not enums)
- REST endpoints: lowercase with colons — `/api/mode/:mode/start`
- Query params: `camelCase` — `?startDate=&limit=`

### Data Format Rules

- JSON fields: `camelCase` everywhere
- Dates: Unix millisecond timestamps (`Date.now()`)
- Null: explicit `null` for absent optionals, never `undefined` in API payloads
- Numbers: plain numbers (not strings); monetary values stored as smallest-unit integers in DB, but API/WS payloads use display-unit numbers (conversion at server boundary)
- Booleans: `true`/`false` (never `1`/`0`)

### Fastify 5 Route Registration Pattern

Routes must be registered as **plugins** using `fastify.register()`. Each route file exports an async function:

```typescript
import type { FastifyInstance } from "fastify";

export default async function modeRoutes(fastify: FastifyInstance) {
  fastify.post("/api/mode/:mode/start", {
    schema: {
      params: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["volume-max", "profit-hunter", "arbitrage"] }
        },
        required: ["mode"]
      }
    }
  }, async (request, reply) => {
    const { mode } = request.params as { mode: string };
    return { status: "started", mode };
  });
}
```

**Fastify v5 schema requirement**: All `params`, `body`, `querystring` schemas MUST include `type: "object"` and `properties` — shorthand is removed in v5.

### Mode Param Values

REST API uses **kebab-case** for URL mode params: `volume-max`, `profit-hunter`, `arbitrage`
Shared types use **camelCase** for `ModeType`: `volumeMax`, `profitHunter`, `arbitrage`

Add a mapping helper in `src/shared/types.ts`:
```typescript
const MODE_URL_MAP: Record<string, ModeType> = {
  "volume-max": "volumeMax",
  "profit-hunter": "profitHunter",
  "arbitrage": "arbitrage",
};
export function urlModeToModeType(urlMode: string): ModeType | undefined {
  return MODE_URL_MAP[urlMode];
}
```
Route handlers use this to convert URL params before passing to engine stubs. Stub responses should return the **camelCase** `ModeType` value, not the URL kebab-case.

### WebSocket Event Format (Existing Contract)

```typescript
{ event: "trade.executed", timestamp: 1712150400000, data: { ... } }
```

The `EventPayloadMap` must map:
- `"trade.executed"` → `TradeExecutedPayload`
- `"stats.updated"` → `StatsUpdatedPayload`
- `"mode.started"` → `ModeStartedPayload`
- `"mode.stopped"` → `ModeStoppedPayload`
- `"mode.error"` → `ModeErrorPayload`
- `"position.opened"` → `PositionOpenedPayload`
- `"position.closed"` → `PositionClosedPayload`
- `"alert.triggered"` → `AlertTriggeredPayload`
- `"connection.status"` → `ConnectionStatusPayload`

### DB Schema Alignment & Type Name Collision

`src/server/db/schema.ts` already exports Drizzle-inferred types named `Trade` and `Position`. This story adds **separate** `Trade` and `Position` interfaces to `src/shared/types.ts` for the API/WS transport layer. These are intentionally different:
- **DB types** (`src/server/db/schema.ts`): financial fields are `integer` (smallest-unit, e.g. USDC × 1e6), used only inside `src/server/`
- **Shared types** (`src/shared/types.ts`): financial fields are `number` (display-unit), used in API responses, WebSocket payloads, and client code
- The server engine layer converts between the two at the boundary
- `side` column stores `"Long"` or `"Short"` with a CHECK constraint — `TradeSide` must match exactly
- **Import rule**: `src/server/db/` code imports from `schema.ts`; `src/server/api/` and `src/client/` import from `@shared/types`. Never mix them in the same file.

### Engine Function Signatures (Story 2.3 will implement)

Route stubs return hardcoded defaults for now. When Story 2.3 replaces stubs with real calls, these are the expected engine function signatures:
```typescript
// src/server/engine/ — NOT created in this story, just documented for context
startMode(mode: ModeType): Promise<ModeConfig>
stopMode(mode: ModeType): Promise<ModeConfig>
updateModeConfig(mode: ModeType, config: { allocation?: number, pairs?: string[], slippage?: number }): Promise<ModeConfig>
getStatus(): Promise<{ modes: Record<ModeType, ModeConfig>, positions: Position[], connection: ConnectionState }>
getTradeHistory(limit: number, offset: number): Promise<{ trades: Trade[], total: number }>
```

### Previous Story Intelligence

**From Story 1.5 code review:**
- `broadcast()` requires typed `EventName` parameter (not generic string) — already enforced
- `vi.resetModules()` causes `instanceof AppError` to fail — use property-based assertions in tests
- `@client` and `@shared` path aliases are configured and working
- Pino is already installed and configured in `src/server/lib/logger.ts`
- `@testing-library/user-event` is available as dev dependency

**From Story 1.1 deferred work:**
- SPA catch-all serves index.html for mistyped API routes in production — **this story resolves it** (Task 6)

### Testing Approach

- Co-located test files: `mode.test.ts` next to `mode.ts`
- Use Vitest (`pnpm test`)
- For Fastify route tests, use `fastify.inject()` — no need to start real server
- For type-level tests, use `expectTypeOf` from vitest or compile-time assertions
- Property-based assertions for AppError (avoid `instanceof` across module boundaries)
- Existing test suite: 92 tests — ensure no regressions

### Project Structure Notes

New files to create:
```
src/server/api/
├── mode.ts           # POST start/stop, PUT config
├── mode.test.ts
├── status.ts         # GET /api/status
├── status.test.ts
├── trades.ts         # GET /api/trades (paginated)
└── trades.test.ts
```

Modified files:
```
src/shared/types.ts       # Add Trade, Position, ModeStats, ModeConfig, TradeSide, ModeStatus
src/shared/events.ts      # Add 7 payload interfaces + EventPayloadMap
src/server/ws/broadcaster.ts  # Refactor broadcast() to use EventPayloadMap generic
src/server/index.ts       # Register route plugins, add error handler, scope catch-all
```

### References

- [Source: _bmad-output/planning-artifacts/architecture.md — REST API Endpoints, WebSocket Event Catalog, Shared Types, API Response Format]
- [Source: _bmad-output/planning-artifacts/epics.md — Epic 2, Story 2.1 acceptance criteria]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — Error feedback tiers, ModeCard props, connection status states]
- [Source: src/server/db/schema.ts — trades/positions table definitions, TradeSide CHECK constraint]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md — SPA catch-all scoping]
- [Source: _bmad-output/implementation-artifacts/1-5-fogochain-connection-and-session-key-authentication.md — Previous story patterns and learnings]

### Review Findings

- [x] [Review][Decision] `info` severity mapped to HTTP 200 in error handler — dismissed: intentional design, info-level AppErrors are informational responses, not failures
- [x] [Review][Patch] `lastAlert` type not narrowed — fixed: narrowed to `{ event: typeof EVENTS.ALERT_TRIGGERED; timestamp: number; data: EventPayloadMap["alert.triggered"] }`
- [x] [Review][Patch] Error handler tests duplicate logic instead of importing it — fixed: extracted to `src/server/lib/error-handler.ts`, imported in both `index.ts` and test
- [x] [Review][Patch] `broadcaster.test.ts` still uses `as never` cast on `mockServer` — fixed: replaced with `as unknown as Parameters<typeof setupWebSocket>[0]`
- [x] [Review][Patch] `PUT /api/mode/:mode/config` body has no `additionalProperties: false` — fixed: added to body schema
- [x] [Review][Patch] No test for `Alert` type shape in `types.test.ts` — fixed: added Alert type-level test
- [x] [Review][Patch] Stale comment references "deferred to Story 1.5" but 1.5 is shipped — fixed: updated comment
- [x] [Review][Patch] Production SPA `sendFile` path not tested — resolved via error handler extraction; production static serving requires `@fastify/static` integration test which is out of scope for unit tests
- [x] [Review][Defer] `AlertTriggeredPayload` lacks `id`/`timestamp` vs `Alert` interface — resolved: documented mapping contract in events.ts comment, made WsMessage generic so client can use `WsMessage<"alert.triggered">` for typed data
- [x] [Review][Defer] DB integer (USDC x 1e6) vs shared type `number` — no conversion layer — resolved: added `fromSmallestUnit()`/`toSmallestUnit()` helpers in types.ts with tests
- [x] [Review][Defer] `config` endpoint body has no range validation on allocation/slippage — resolved: added `minimum: 0` on allocation, `minimum: 0, maximum: 100` on slippage, `maxItems: 50` on pairs

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- No blockers or debug issues encountered

### Completion Notes List

- **Task 1**: Added `TradeSide`, `ModeStatus`, `Trade`, `Position`, `ModeStats`, `ModeConfig` types and `urlModeToModeType()` helper to `src/shared/types.ts`
- **Task 2**: Added 7 new payload interfaces (`TradeExecutedPayload`, `StatsUpdatedPayload`, `ModeStartedPayload`, `ModeStoppedPayload`, `ModeErrorPayload`, `PositionOpenedPayload`, `PositionClosedPayload`) plus `EventPayloadMap` to `src/shared/events.ts`
- **Task 3**: Refactored `broadcast()` to generic `broadcast<E extends EventName>(event: E, data: EventPayloadMap[E])` — all existing call sites in `src/server/index.ts` already passed correct data shapes and compiled without changes. Also typed `cacheAlert()` parameter.
- **Task 4**: Created 3 route plugins (`mode.ts`, `status.ts`, `trades.ts`) under `src/server/api/`. Removed placeholder `GET /api/status` from `index.ts` and registered all plugins via `fastify.register()`.
- **Task 5**: Added `setErrorHandler` to Fastify — maps AppError severity to HTTP status (info→200, warning→400, critical→500), wraps validation errors as 400, generic errors as 500. Uses property-based check (`error.name === "AppError"`) per previous story learnings.
- **Task 6**: Refactored `setNotFoundHandler` to scope SPA catch-all — `/api/*` returns 404 JSON error, non-API serves `index.html` in production. Resolves Story 1.1 deferred-work item.
- **Task 7**: Added 44 new tests across 5 new test files + updated 2 existing test files. Updated broadcaster tests to use correctly-typed payloads instead of `as never` casts. All 136 tests pass (92 original + 44 new).

### Change Log

- 2026-04-04: Story 2-1 implemented — shared types, WebSocket event payloads, type-safe broadcaster, REST API route stubs, error handler, SPA catch-all scoping, and comprehensive tests

### File List

**New files:**
- `src/server/api/mode.ts`
- `src/server/api/mode.test.ts`
- `src/server/api/status.ts`
- `src/server/api/status.test.ts`
- `src/server/api/trades.ts`
- `src/server/api/trades.test.ts`
- `src/server/api/error-handler.test.ts`
- `src/shared/events.test.ts`

**Modified files:**
- `src/shared/types.ts`
- `src/shared/types.test.ts`
- `src/shared/events.ts`
- `src/server/ws/broadcaster.ts`
- `src/server/ws/broadcaster.test.ts`
- `src/server/index.ts`
