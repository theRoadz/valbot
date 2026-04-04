---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
lastStep: 8
status: 'complete'
completedAt: '2026-04-03'
inputDocuments:
  - prd.md
  - ux-design-specification.md
workflowType: 'architecture'
project_name: 'ValBot'
user_name: 'theRoad'
date: '2026-04-03'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**
35 FRs across 8 categories. The core architectural challenge is the trading engine — three independent strategy modes (Volume Max, Profit Hunter, Arbitrage) that must execute in parallel with isolated fund pools, each interfacing with FOGOChain smart contracts through SVM-Web3 libraries. The dashboard layer (FR16-FR26) requires real-time WebSocket updates for trade streaming, stats, and position monitoring. The safety layer (FR12-FR15, FR30-FR33) enforces per-mode kill switches, stop-loss protection, and graceful error recovery — this cross-cuts every trading mode.

**Non-Functional Requirements:**
- Performance: Sub-second trade execution, real-time WebSocket dashboard updates, continuous Pyth oracle feeds
- Reliability: Zero orphaned positions on crash, independent per-mode kill switches, 3-retry RPC with alerting, graceful shutdown closes all positions
- Security: Session keys in `.env` only, localhost-only dashboard, no key exposure in logs or UI

**Scale & Complexity:**
- Primary domain: Full-stack (Node.js/TypeScript backend + React SPA frontend)
- Complexity level: Low-Medium
- Estimated architectural components: ~8-10 (trading engine core, 3 strategy modules, position manager, fund allocator, WebSocket server, dashboard SPA, blockchain client, oracle client)

### Technical Constraints & Dependencies

- **FOGOChain (SVM-based):** All trading operations go through SVM-Web3 libraries; gas covered by Fogo sessions
- **Pyth Network:** Required for Profit Hunter mode price feeds; must maintain continuous connection
- **Valiant Perps contracts:** Smart contract interface for position open/close/manage
- **Session key auth:** Extracted from browser console, stored in `.env`, rotated every 7 days or on expiry
- **Public RPC endpoints:** Single point of external dependency; must handle failures gracefully
- **Design system:** Tailwind CSS + shadcn/ui (dark theme, React-based dashboard)

### Cross-Cutting Concerns Identified

1. **Position safety** — Stop-loss enforcement and kill-switch logic must be consistent across all three trading modes
2. **Fund isolation** — Each mode operates within strict allocation boundaries; the allocator must prevent cross-mode fund access
3. **Real-time data flow** — WebSocket pipeline from trading engine events → dashboard must handle high-frequency updates from parallel modes
4. **Error propagation** — Errors in one mode must not cascade to others; severity-based alerting (toast/banner) surfaces across all modes
5. **Blockchain connection resilience** — RPC retry logic, connection state management, and reconnection affect all modes simultaneously
6. **Graceful shutdown** — On stop or crash, all modes must close positions orderly; this requires coordinated but independent shutdown per mode

## Starter Template Evaluation

### Primary Technology Domain

Full-stack Node.js/TypeScript — backend trading engine with Fastify HTTP/WebSocket server, React SPA dashboard served from the same process. Single-user localhost tool with no separate deployment targets.

### Approach: Single Project (No Monorepo)

A monorepo (Turborepo) was considered but rejected. ValBot is a personal localhost tool — the backend and frontend run on the same machine, served from the same Fastify process. A monorepo adds workspace configuration, package publishing, and build orchestration overhead with no benefit for this use case. A single project with folder-based separation and TypeScript path aliases provides the same type sharing with zero overhead.

### Selected Stack

| Layer | Choice | Version | Rationale |
|---|---|---|---|
| Runtime | Node.js | 22.x LTS | Required by Vite 8 and Fastify 5 |
| Language | TypeScript | 5.x | End-to-end type safety across server and client |
| Package manager | pnpm | latest | Fast installs, strict dependency resolution |
| Frontend | Vite + React | Vite 8.x | Rolldown-based builds, fast HMR, react-ts template |
| Styling | Tailwind CSS v4 + shadcn/ui | CLI v4 | Decided in UX spec; OKLCH colors, @theme directive |
| Backend | Fastify | 5.8.x | 2-3x faster than Express, first-class TypeScript, schema validation, WebSocket upgrade support |
| Database | Drizzle ORM + better-sqlite3 | 1.0-beta / 11.x | Type-safe SQL, zero overhead, synchronous driver, migration tooling via drizzle-kit |
| Testing | Vitest | 4.1.x | Shares Vite config, Vite 8 support, fast |
| Real-time | ws (native WebSocket) | latest | Lightweight; no Socket.io overhead needed for single-user localhost |

### Initialization Commands

```bash
# Scaffold frontend with Vite
pnpm create vite@latest valbot --template react-ts
cd valbot

# Tailwind v4 + shadcn/ui
pnpm add -D tailwindcss @tailwindcss/vite
npx shadcn@latest init

# Backend dependencies
pnpm add fastify ws drizzle-orm better-sqlite3 dotenv
pnpm add -D drizzle-kit @types/better-sqlite3 @types/ws tsx

# Testing
pnpm add -D vitest @vitest/coverage-v8
```

### Project Structure

```
valbot/
├── src/
│   ├── server/        # Fastify backend + WebSocket + trading engine
│   ├── client/        # React dashboard (Vite builds to dist/)
│   └── shared/        # Shared TypeScript types (trade events, mode states, etc.)
├── package.json
├── vite.config.ts
├── tsconfig.json
├── drizzle.config.ts
└── .env
```

- Fastify serves the built React app and handles WebSocket upgrades on the same port
- One `pnpm dev` runs both backend (tsx watch) and frontend (Vite dev server with proxy)
- Shared types used by both sides via TypeScript path aliases — no package publishing

### Architectural Decisions Provided by Stack

**Language & Runtime:** TypeScript strict mode across server and client. Single tsconfig with path aliases for shared types.

**Styling:** Tailwind v4 utility-first CSS with @tailwindcss/vite plugin. shadcn/ui components copied into project source (components/ui/). Dark theme default with custom OKLCH color tokens.

**Build Tooling:** Vite 8 with Rolldown for frontend bundling. tsx for backend dev server with watch mode. Production: Vite builds client to dist/, tsx compiles server.

**Database:** SQLite via better-sqlite3 (synchronous, zero-config, single file). Drizzle ORM for type-safe queries and drizzle-kit for schema migrations. Stores trade history, session stats, and persistent configuration.

**Testing:** Vitest shares Vite transforms and config. @vitest/coverage-v8 for coverage reporting.

**Real-time:** Native WebSocket (ws library) upgraded from the Fastify HTTP server. Pushes trade events, stat updates, status changes, and alerts to the dashboard in real-time.

**Note:** Project initialization using these commands should be the first implementation story.

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
- Data model schema for trades, positions, sessions, and config
- State management approach for real-time WebSocket-driven dashboard
- API pattern for dashboard ↔ trading engine communication
- Error handling strategy mapped to UX severity levels
- Graceful shutdown with position safety

**Important Decisions (Shape Architecture):**
- Logging strategy
- In-memory caching for hot trading data
- Process lifecycle management

**Deferred Decisions (Post-MVP):**
- Dynamic slippage based on order book depth (Phase 2)
- Configurable strategy parameters UI (Phase 2)
- Mobile notifications (Phase 2)

### Data Architecture

**Database:** SQLite via Drizzle ORM + better-sqlite3 (decided in step 3)

**Schema Design:**

| Table | Purpose | Key Fields |
|---|---|---|
| `trades` | Complete trade history | id, mode, pair, side, size, price, pnl, fees, timestamp |
| `positions` | Currently open positions | id, mode, pair, side, size, entryPrice, stopLoss, timestamp |
| `sessions` | Per-session aggregates | id, startTime, endTime, mode, trades, volume, pnl |
| `config` | Persisted user settings | key, value (fund allocations, pair selections, slippage) |

**Rationale:** Four tables cover all PRD data requirements (FR16-FR24). `positions` table mirrors live state for crash recovery — on restart, the bot can detect orphaned positions and close them. `config` persists dashboard settings across restarts so the user doesn't re-enter allocations.

**Numeric Precision Strategy (ADR-001):** All monetary/financial columns (`size`, `price`, `pnl`, `fees`, `entryPrice`, `stopLoss`, `volume`) use `integer()` storing values in **smallest-unit denomination** (e.g., USDC = 6 decimals → multiply by 1,000,000). This eliminates IEEE 754 floating-point rounding errors that compound across thousands of aggregated trades. Conversion to display units happens only at the frontend display boundary. This is the standard pattern in blockchain/trading systems — the chain already returns values in lamports/smallest-unit. A `DECIMALS` constant per token defines the conversion factor.

**DB Connection Pattern (ADR-002):** The database connection in `src/server/db/index.ts` uses **lazy initialization** via `getDb()`. The connection is NOT opened at module import time — it opens on first call to `getDb()`. This prevents accidental file I/O and lock acquisition when modules import schema types or when CLI tools need DB types without a live connection. `closeDb()` closes the connection and nulls references to prevent use-after-close.

```typescript
// Pattern — src/server/db/index.ts
export function getDb() { /* opens connection on first call, returns cached instance */ }
export function closeDb() { /* closes + nulls, safe to call multiple times */ }
```

**Migration Strategy:** drizzle-kit generate + drizzle-kit migrate. Schema-first approach — TypeScript schema definitions are the source of truth.

**Caching Strategy:** In-memory maps for hot data (current positions, live stats per mode, fund balances). SQLite writes are async-batched for trade history — trades log to memory first, flush to SQLite in batches to avoid per-trade write latency. On shutdown, flush remaining buffer before closing.

### Authentication & Security

**All decided by PRD constraints — no additional decisions needed:**
- Session keys stored in `.env`, loaded via dotenv
- No authentication UI (localhost only, single user)
- No API keys or tokens for the dashboard — it's served on localhost
- Session key expiry detected by transaction failures; bot surfaces error with resolution steps
- `.env` excluded from version control via `.gitignore`

### API & Communication Patterns

**REST API (Fastify routes)** for user-initiated actions:

| Endpoint | Purpose |
|---|---|
| `POST /api/mode/:mode/start` | Start a trading mode |
| `POST /api/mode/:mode/stop` | Stop a trading mode |
| `PUT /api/mode/:mode/config` | Update mode config (allocation, pairs, slippage) |
| `GET /api/status` | Current bot state (all modes, positions, stats) |
| `GET /api/trades` | Trade history (paginated) |

**WebSocket** for server-pushed real-time events:

| Event | Payload | Trigger |
|---|---|---|
| `trade` | Trade details + mode tag | Every executed trade |
| `stats` | Updated mode stats | After each trade settles |
| `status` | Mode state change | Start/stop/error/kill-switch |
| `position` | Position open/close/update | Position lifecycle events |
| `alert` | Severity + message + details | Errors, kill-switch, session expiry |

**Rationale:** REST for commands (user → bot), WebSocket for events (bot → dashboard). Clean separation. No GraphQL — fixed UI with known data needs doesn't benefit from flexible queries.

**Error Handling Standard:** Fastify typed errors with three severity levels mapped to UX spec:
- **Info** (auto-dismiss toast): Trade confirmations, reconnection success
- **Warning** (persistent toast): RPC retry in progress, kill-switch threshold approaching
- **Critical** (banner): Session expired, kill-switch triggered, RPC failed after 3 retries

All errors include: `{ severity, code, message, details, resolution }` — the `resolution` field maps directly to the UX spec's "every error has a resolution path" requirement.

### Frontend Architecture

**State Management: Zustand**

A single global store updated by WebSocket event handlers. Components subscribe to slices of state they need.

```
Store shape:
├── modes: { volumeMax, profitHunter, arbitrage }  // status, stats, config per mode
├── positions: Position[]                            // all open positions
├── trades: Trade[]                                  // recent trade log buffer
├── alerts: Alert[]                                  // active alerts
├── connection: { status, wallet balance }           // bot connection state
└── actions: { startMode, stopMode, updateConfig }   // REST API calls
```

**Rationale:** Zustand is ~1KB, no boilerplate, no providers. WebSocket `onmessage` handler dispatches directly to store. React components re-render only when their subscribed slice changes — efficient for high-frequency trade updates. Simpler than Redux, more structured than Context+useReducer for a dashboard with multiple independent data streams.

**Component Architecture:** Composition from shadcn/ui primitives as defined in UX spec. No component library abstraction — components are flat files in `src/client/components/`. ModeCard, TopBar, PositionsTable, TradeLog, AlertBanner as top-level components.

**Routing:** None. Single-page dashboard, no router needed. All content visible on one viewport.

### Infrastructure & Deployment

**Hosting:** Localhost only. `pnpm start` runs Fastify which serves the built React app and handles WebSocket connections on a single port (default 3000).

**Logging:** Fastify's built-in pino logger. Structured JSON logs in production, pretty-printed in development. Log levels: trade execution at `info`, errors at `error`, WebSocket events at `debug`. No external log aggregation — logs go to stdout/file for personal review.

**Graceful Shutdown:** On SIGINT/SIGTERM:
1. Stop all trading modes (prevent new trades)
2. Close all open positions per mode (with stop-loss as fallback)
3. Flush in-memory trade buffer to SQLite
4. Close WebSocket connections
5. Close database connection
6. Exit

**Rationale:** Position safety is the #1 priority. The shutdown sequence ensures no orphaned positions. If position closing fails, stop-losses are already set on-chain as a safety net.

**Environment Configuration:** Single `.env` file with dotenv. No environment-specific configs needed (no staging/production split for a personal tool).

### Decision Impact Analysis

**Implementation Sequence:**
1. Project scaffolding (Vite + Fastify + SQLite setup)
2. Database schema + Drizzle config
3. Blockchain client (FOGOChain RPC + Valiant Perps contract interface)
4. Trading engine core (position manager, fund allocator, mode runner)
5. REST API endpoints
6. WebSocket event streaming
7. React dashboard with Zustand store
8. Strategy implementations (Volume Max, Profit Hunter, Arbitrage)
9. Safety systems (kill switch, graceful shutdown)

**Cross-Component Dependencies:**
- Trading engine → blockchain client (all trades go through chain)
- Trading engine → WebSocket (emits events for every trade/status change)
- Dashboard → Zustand store → WebSocket (real-time updates)
- Dashboard → REST API (user commands)
- All modes → position manager → fund allocator (shared safety layer)
- Graceful shutdown → all modes + position manager + database (coordinated teardown)

## Implementation Patterns & Consistency Rules

### Pattern Categories Defined

**Critical Conflict Points Identified:** 7 areas where AI agents could make different choices, all resolved below.

### Naming Patterns

**Database Naming Conventions:**
- Tables: `camelCase` plural — `trades`, `positions`, `sessions`, `config`
- Columns: `camelCase` — `entryPrice`, `stopLoss`, `sessionPnl`, `createdAt`
- Primary keys: `id` (integer, auto-increment)
- Foreign keys: `{table}Id` — `sessionId`, `modeId`
- Rationale: Drizzle ORM maps directly to TypeScript without a naming translation layer

**API Naming Conventions:**
- REST endpoints: lowercase plural with colons for params — `/api/mode/:mode/start`
- Query parameters: `camelCase` — `?startDate=&limit=`
- WebSocket event names: `dot.notation` — `trade.executed`, `mode.started`, `mode.stopped`, `position.opened`, `position.closed`, `alert.triggered`, `stats.updated`
- Rationale: REST follows Fastify convention; dot notation for events provides natural namespacing and is grep-friendly

**Code Naming Conventions:**
- Files: `kebab-case` for everything — `mode-card.tsx`, `fund-allocator.ts`, `trade-log.tsx`
- React components: `PascalCase` in code — `ModeCard`, `TradeLog`, `TopBar`
- Functions/variables: `camelCase` — `startMode()`, `fundBalance`, `tradeHistory`
- Types/interfaces: `PascalCase` — `Trade`, `Position`, `ModeStatus`, `AlertPayload`
- Constants: `UPPER_SNAKE_CASE` — `MAX_RETRIES`, `DEFAULT_SLIPPAGE`, `KILL_SWITCH_THRESHOLD`
- Enums: `PascalCase` name, `PascalCase` members — `enum TradeSide { Long, Short }`
- Rationale: Follows TypeScript community conventions and shadcn/ui patterns

### Structure Patterns

**Project Organization:**
```
src/
├── server/
│   ├── api/              # Fastify route handlers
│   │   ├── mode.ts       # /api/mode/* routes
│   │   ├── status.ts     # /api/status route
│   │   └── trades.ts     # /api/trades route
│   ├── engine/           # Trading engine core
│   │   ├── mode-runner.ts        # Base mode execution loop
│   │   ├── position-manager.ts   # Open/close/track positions
│   │   ├── fund-allocator.ts     # Per-mode fund isolation
│   │   └── strategies/           # Strategy implementations
│   │       ├── volume-max.ts
│   │       ├── profit-hunter.ts
│   │       └── arbitrage.ts
│   ├── blockchain/       # Chain interaction layer
│   │   ├── client.ts     # FOGOChain RPC connection
│   │   ├── contracts.ts  # Valiant Perps contract interface
│   │   └── oracle.ts     # Pyth price feed client
│   ├── ws/               # WebSocket event broadcasting
│   │   └── broadcaster.ts
│   ├── db/               # Database layer
│   │   ├── schema.ts     # Drizzle table definitions
│   │   ├── index.ts      # DB connection + drizzle instance
│   │   └── migrations/   # drizzle-kit generated migrations
│   ├── lib/              # Shared server utilities
│   │   ├── logger.ts     # Pino logger config
│   │   ├── errors.ts     # Error types and factory
│   │   └── shutdown.ts   # Graceful shutdown handler
│   └── index.ts          # Fastify server entry point
├── client/
│   ├── components/       # React components (flat, no nesting)
│   │   ├── mode-card.tsx
│   │   ├── top-bar.tsx
│   │   ├── positions-table.tsx
│   │   ├── trade-log.tsx
│   │   ├── alert-banner.tsx
│   │   └── ui/           # shadcn/ui primitives
│   ├── store/            # Zustand store
│   │   └── index.ts
│   ├── hooks/            # Custom React hooks
│   │   └── use-websocket.ts
│   ├── lib/              # Client utilities
│   │   └── api.ts        # REST API client functions
│   ├── App.tsx
│   └── main.tsx
└── shared/               # Shared types (server + client)
    ├── types.ts          # Trade, Position, ModeStatus, Alert, etc.
    └── events.ts         # WebSocket event type definitions
```

- Server organized **by domain** (api, engine, blockchain, ws, db) — each folder is a bounded context
- Client organized **by type** (components, store, hooks, lib) — flat structure suits a single-page dashboard
- Components are **flat files** — no nested folders per component. A component is one file unless it needs a co-located test
- No `utils/` or `helpers/` grab-bag folders — utilities go in `lib/` within their layer (server or client)

**Test Location:**
- Co-located with source: `fund-allocator.test.ts` next to `fund-allocator.ts`
- Vitest picks up `*.test.ts` and `*.test.tsx` automatically
- No separate `__tests__/` directory

### Format Patterns

**API Response Formats:**
- Success: Direct payload — `{ modes: [...], positions: [...] }`
- Error: `{ error: { severity, code, message, details, resolution } }`
- No wrapper object on success — keep it simple, the HTTP status code indicates success/failure
- Rationale: Single-user tool with a fixed frontend; no need for pagination metadata or generic envelope patterns on most endpoints. Trade history endpoint uses `{ trades: [...], total: number }` for pagination.

**WebSocket Event Format:**
```typescript
{
  event: "trade.executed",    // dot notation event name
  timestamp: 1712150400000,   // Unix ms timestamp
  data: { ... }              // event-specific payload
}
```

**Data Exchange Formats:**
- JSON field naming: `camelCase` everywhere — API responses, WebSocket payloads, Zustand store
- Dates: **Unix millisecond timestamps** (`Date.now()`) in all API/WebSocket payloads. Frontend formats for display using `Intl.DateTimeFormat`. Rationale: no timezone parsing issues, trivially sortable, numeric comparisons work directly
- Booleans: `true`/`false` (never `1`/`0`)
- Null: explicit `null` for absent optional values, never `undefined` in API payloads
- Numbers: Plain numbers for quantities/prices (not strings). PnL and financial values as numbers with frontend formatting to fixed decimals

### Communication Patterns

**WebSocket Event Catalog:**

| Event | Payload Shape | When Emitted |
|---|---|---|
| `trade.executed` | `{ mode, pair, side, size, price, pnl, fees }` | After every trade settles on-chain |
| `stats.updated` | `{ mode, trades, volume, pnl, allocated, remaining }` | After each trade settles |
| `mode.started` | `{ mode }` | Mode toggle on confirmed |
| `mode.stopped` | `{ mode, finalStats }` | Mode fully stopped, positions closed |
| `mode.error` | `{ mode, error }` | Mode encounters non-fatal error |
| `position.opened` | `{ mode, pair, side, size, entryPrice, stopLoss }` | Position confirmed on-chain |
| `position.closed` | `{ mode, pair, side, size, exitPrice, pnl }` | Position close confirmed |
| `alert.triggered` | `{ severity, code, message, details, resolution }` | Kill switch, session expiry, RPC failure |
| `connection.status` | `{ rpc, wallet, balance }` | RPC connect/disconnect, balance change |

**Zustand State Update Pattern:**
- All updates are **immutable** — use spread operator or Zustand's `set()` with partial state
- WebSocket `onmessage` handler calls store actions directly — no middleware, no action creators
- Store actions that call REST API use `async` functions within the store
- Components subscribe to **slices** via selectors: `useStore(s => s.modes.volumeMax)` — never subscribe to the whole store

### Process Patterns

**Error Handling:**
- Server: All errors are instances of a custom `AppError` class with `severity`, `code`, `message`, `details`, `resolution`
- Server errors are caught at the Fastify error handler and logged via pino, then broadcast via WebSocket if user-facing
- Client: Errors arrive via WebSocket `alert.triggered` events and are rendered by severity (toast vs banner)
- No `try/catch` wrapping around every function — use Fastify's error handling chain and let errors propagate naturally
- Blockchain transaction errors: Caught at the trading engine layer, mapped to `AppError` with resolution guidance

**Retry Pattern:**
- RPC failures: Exponential backoff, max 3 retries (1s, 2s, 4s), then emit `alert.triggered` with critical severity
- Failed trades: No automatic retry — log the failure, emit error event, let the strategy loop decide on next iteration
- WebSocket reconnection (client): Automatic reconnect with 1s/2s/4s backoff, max 5 attempts

**Loading States:**
- No global loading state — the dashboard is always showing current data via WebSocket
- REST API calls (start/stop mode, update config) use per-action loading: `isStarting`, `isStopping` on the mode object in Zustand
- No skeleton screens or spinners on initial load — dashboard shows current state from `GET /api/status` on connect, then WebSocket keeps it live

### Enforcement Guidelines

**All AI Agents MUST:**
- Follow the naming conventions above — no exceptions for "quick fixes"
- Place new files in the correct domain folder as defined in the project structure
- Use the `AppError` class for all error creation — never throw plain strings or generic `Error`
- Use the WebSocket event catalog format for any new events — add new events to `shared/events.ts` first
- Use Unix ms timestamps for all date/time values in payloads
- Co-locate tests with source files using `.test.ts` / `.test.tsx` suffix
- Define shared types in `shared/types.ts` before using them in server or client code

### Pattern Examples

**Good:**
```typescript
// shared/types.ts — define shared types first
export interface Trade {
  id: number;
  mode: ModeType;
  pair: string;
  side: TradeSide;
  size: number;
  price: number;
  pnl: number;
  fees: number;
  timestamp: number;  // Unix ms
}

// server/engine/strategies/volume-max.ts — kebab-case file
export class VolumeMaxStrategy { ... }

// server/db/schema.ts — camelCase columns, integer smallest-unit for money
export const trades = sqliteTable('trades', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  mode: text('mode').notNull(),
  entryPrice: integer('entryPrice').notNull(), // smallest-unit (e.g., USDC × 1e6)
  createdAt: integer('createdAt').notNull(),
});
```

**Anti-Patterns:**
```typescript
// ❌ snake_case columns
entry_price: integer('entry_price')

// ❌ real() for monetary values — use integer() with smallest-unit
price: real('price').notNull()

// ❌ PascalCase file names
VolumeMax.ts, TradeLog.tsx

// ❌ Wrapped success responses
{ success: true, data: { ... } }

// ❌ ISO date strings in payloads
{ timestamp: "2026-04-03T12:00:00Z" }

// ❌ Throwing plain strings
throw "Something went wrong"

// ❌ Subscribing to entire Zustand store
const everything = useStore(s => s)
```

## Project Structure & Boundaries

### Complete Project Directory Structure

```
valbot/
├── package.json
├── tsconfig.json
├── tsconfig.server.json          # Server-specific TS config (Node target)
├── vite.config.ts                # Vite frontend build + dev proxy
├── drizzle.config.ts             # Drizzle-kit migration config
├── vitest.config.ts              # Vitest test config
├── .env                          # Session keys, RPC URL, port (never committed)
├── .env.example                  # Template with placeholder values
├── .gitignore
├── valbot.db                     # SQLite database file (auto-created, gitignored)
├── src/
│   ├── server/
│   │   ├── index.ts              # Fastify entry: register routes, WS, serve static, start
│   │   ├── api/
│   │   │   ├── mode.ts           # POST /api/mode/:mode/start, /stop; PUT /config
│   │   │   ├── status.ts         # GET /api/status
│   │   │   └── trades.ts         # GET /api/trades (paginated)
│   │   ├── engine/
│   │   │   ├── mode-runner.ts    # Base class: start/stop loop, lifecycle hooks
│   │   │   ├── position-manager.ts   # Open/close positions, stop-loss enforcement
│   │   │   ├── fund-allocator.ts     # Per-mode fund tracking and isolation
│   │   │   └── strategies/
│   │   │       ├── volume-max.ts     # Delta-neutral cycling for Flames
│   │   │       ├── profit-hunter.ts  # Pyth oracle mean reversion
│   │   │       └── arbitrage.ts      # Cross-market price exploitation
│   │   ├── blockchain/
│   │   │   ├── client.ts         # FOGOChain RPC connection + retry logic
│   │   │   ├── contracts.ts      # Valiant Perps contract interface (open, close, query)
│   │   │   └── oracle.ts         # Pyth Network price feed subscription
│   │   ├── ws/
│   │   │   └── broadcaster.ts    # WebSocket upgrade handler + event emit helpers
│   │   ├── db/
│   │   │   ├── schema.ts         # Drizzle table definitions (trades, positions, sessions, config)
│   │   │   ├── index.ts          # DB connection, drizzle instance, flush helpers
│   │   │   └── migrations/       # drizzle-kit generated SQL migrations
│   │   └── lib/
│   │       ├── logger.ts         # Pino logger config (dev pretty, prod JSON)
│   │       ├── errors.ts         # AppError class + error factory functions
│   │       └── shutdown.ts       # SIGINT/SIGTERM handler: stop modes → close positions → flush → exit
│   ├── client/
│   │   ├── main.tsx              # React entry point
│   │   ├── App.tsx               # Root component: layout grid, WebSocket init
│   │   ├── index.css             # Tailwind v4 @import + custom theme tokens
│   │   ├── components/
│   │   │   ├── mode-card.tsx     # Self-contained mode control + stats card
│   │   │   ├── top-bar.tsx       # Summary stats bar (wallet, total PnL, connection)
│   │   │   ├── positions-table.tsx   # Open positions table with PnL coloring
│   │   │   ├── trade-log.tsx     # Live streaming trade log with auto-scroll
│   │   │   ├── alert-banner.tsx  # Critical alert banner (kill switch, session expiry)
│   │   │   ├── alert-toast.tsx   # Warning/info toast notifications
│   │   │   └── ui/              # shadcn/ui primitives (Card, Table, Badge, Switch, etc.)
│   │   ├── store/
│   │   │   └── index.ts          # Zustand store: modes, positions, trades, alerts, connection
│   │   ├── hooks/
│   │   │   └── use-websocket.ts  # WebSocket connect/reconnect + dispatch to store
│   │   └── lib/
│   │       └── api.ts            # REST API client: startMode(), stopMode(), updateConfig()
│   └── shared/
│       ├── types.ts              # Trade, Position, ModeConfig, ModeStats, Alert, etc.
│       └── events.ts             # WebSocket event name constants + payload type definitions
└── dist/                         # Vite build output (gitignored)
```

### Architectural Boundaries

**API Boundary (REST):**
- `src/server/api/` is the only layer that handles HTTP request/response
- Route handlers validate input (Fastify JSON Schema), call engine functions, return results
- Route handlers never access the database directly — they go through engine or db layer
- Route handlers never interact with blockchain directly

**Engine Boundary:**
- `src/server/engine/` owns all trading logic and state
- The engine exposes functions: `startMode()`, `stopMode()`, `getModeStatus()`, `getPositions()`
- The engine emits events via the broadcaster — it never sends WebSocket messages directly
- The engine calls blockchain layer for on-chain operations and db layer for persistence
- Strategies implement a common interface defined by `mode-runner.ts`

**Blockchain Boundary:**
- `src/server/blockchain/` is the only code that touches FOGOChain RPC or Valiant Perps contracts
- Exposes typed functions: `openPosition()`, `closePosition()`, `getPrice()`, `getBalance()`
- Handles RPC retry logic internally — callers get either a result or an `AppError`
- Never emits WebSocket events or writes to the database

**Data Boundary:**
- `src/server/db/` owns all SQLite access via Drizzle ORM
- Exports query functions: `insertTrade()`, `getTradeHistory()`, `upsertConfig()`, `getOpenPositions()`
- No other layer imports `better-sqlite3` or uses raw SQL
- Schema changes go through drizzle-kit migrations only

**WebSocket Boundary:**
- `src/server/ws/broadcaster.ts` owns the WebSocket server and client connections
- Exposes `broadcast(event, data)` — typed by `shared/events.ts`
- Only the engine and error handler call `broadcast()` — API routes never push WebSocket events directly

**Client Boundary:**
- `src/client/` never imports from `src/server/` — communication only via REST API and WebSocket
- `src/shared/` is the bridge — type definitions imported by both sides via TypeScript path aliases

### Requirements to Structure Mapping

**FR Category → Location:**

| FR Category | Primary Location | Supporting Files |
|---|---|---|
| Trading Engine (FR1-FR8) | `server/engine/mode-runner.ts`, `server/engine/strategies/*` | `server/blockchain/*`, `shared/types.ts` |
| Fund Allocation (FR9-FR11) | `server/engine/fund-allocator.ts` | `server/db/schema.ts` (config table) |
| Position Management (FR12-FR15) | `server/engine/position-manager.ts` | `server/blockchain/contracts.ts`, `server/db/schema.ts` |
| Dashboard & Monitoring (FR16-FR24) | `client/components/*`, `client/store/index.ts` | `server/api/status.ts`, `server/ws/broadcaster.ts` |
| Configuration (FR25-FR26) | `client/components/mode-card.tsx` | `server/api/mode.ts`, `server/db/schema.ts` (config) |
| Authentication (FR27-FR29) | `server/blockchain/client.ts` | `.env`, `server/lib/errors.ts` |
| Error Handling (FR30-FR33) | `server/lib/errors.ts`, `client/components/alert-*.tsx` | `server/ws/broadcaster.ts`, `client/store/index.ts` |
| Extensibility (FR34-FR35) | `server/engine/mode-runner.ts` (base class) | `server/engine/strategies/` (add new files) |

**Cross-Cutting Concerns → Location:**

| Concern | Location |
|---|---|
| Position safety (stop-loss, kill switch) | `server/engine/position-manager.ts`, `server/engine/fund-allocator.ts` |
| Real-time data flow | `server/ws/broadcaster.ts` → `client/hooks/use-websocket.ts` → `client/store/index.ts` |
| Error propagation | `server/lib/errors.ts` → `server/ws/broadcaster.ts` → `client/store/index.ts` → `client/components/alert-*.tsx` |
| Graceful shutdown | `server/lib/shutdown.ts` → `server/engine/*` → `server/db/index.ts` |
| Fund isolation | `server/engine/fund-allocator.ts` (enforced before every trade in `position-manager.ts`) |

### Integration Points

**Internal Communication:**
```
Dashboard ──REST──→ API Routes ──calls──→ Engine ──calls──→ Blockchain
                                   │                          │
                                   ├──calls──→ DB             │
                                   │                          │
Engine ──emits──→ Broadcaster ──WS──→ Dashboard Store ──renders──→ Components
```

**External Integrations:**

| External System | Integration Point | Protocol |
|---|---|---|
| FOGOChain RPC | `server/blockchain/client.ts` | JSON-RPC over HTTPS |
| Valiant Perps Contracts | `server/blockchain/contracts.ts` | SVM transactions via RPC |
| Pyth Network Oracle | `server/blockchain/oracle.ts` | WebSocket price feed subscription |

**Data Flow:**
1. **Trade execution:** Strategy → position-manager → blockchain/contracts → on-chain confirmation → position-manager updates in-memory state → broadcaster emits `trade.executed` + `stats.updated` → db batches write
2. **User command:** Dashboard → REST API → engine.startMode() → mode-runner begins loop → broadcaster emits `mode.started`
3. **Kill switch:** fund-allocator detects 10% drop → position-manager closes all mode positions → broadcaster emits `alert.triggered` → mode-runner stops

### Development Workflow Integration

**Development:**
- `pnpm dev` runs two processes in parallel:
  - `tsx watch src/server/index.ts` — backend with hot reload
  - `vite dev` — frontend with HMR, proxying `/api` and `/ws` to Fastify
- SQLite database file created automatically on first run

**Build:**
- `pnpm build` runs:
  - `vite build` → outputs to `dist/client/`
  - `tsc -p tsconfig.server.json` → compiles server to `dist/server/`
- Production: `node dist/server/index.js` serves everything from one process

**Testing:**
- `pnpm test` runs Vitest across all `*.test.ts` / `*.test.tsx` files
- `pnpm test:coverage` runs with `@vitest/coverage-v8`

## Architecture Validation Results

### Coherence Validation ✅

**Decision Compatibility:**
All technology choices are version-compatible and work together without conflicts. Vite 8 + React + Tailwind v4 + shadcn/ui for the frontend; Fastify 5.8 + ws + Drizzle ORM + better-sqlite3 for the backend; Vitest 4.1 for testing. No version conflicts or incompatible dependencies.

**Pattern Consistency:**
Naming conventions flow consistently end-to-end: camelCase from database columns through Drizzle types, API payloads, WebSocket events, Zustand store, to React components. No translation layers needed. kebab-case file naming is consistent with shadcn/ui and Vite conventions.

**Structure Alignment:**
Project structure directly maps to architectural boundaries. Each boundary (api, engine, blockchain, ws, db) is a folder with clear import rules. No circular dependencies possible given the defined boundary rules.

### Requirements Coverage Validation ✅

**Functional Requirements Coverage:**
All 35 functional requirements (FR1-FR35) have explicit architectural support mapped to specific files and modules. Trading engine FRs map to `engine/` domain, dashboard FRs map to `client/components/` + `client/store/`, safety FRs map to `engine/position-manager.ts` + `engine/fund-allocator.ts`, extensibility FRs are enabled by the `mode-runner.ts` base class pattern.

**Non-Functional Requirements Coverage:**
- Performance: Sub-second execution via Fastify + synchronous SQLite + in-memory hot data. Real-time dashboard via WebSocket push.
- Reliability: Graceful shutdown sequence ensures zero orphaned positions. On-chain stop-losses as safety net. Per-mode kill switches operate independently.
- Security: Session keys in `.env` only, localhost-only dashboard, no key exposure in logs or UI. `.env` gitignored.

### Implementation Readiness Validation ✅

**Decision Completeness:**
All critical decisions documented with specific versions. Technology stack fully specified. No ambiguous "TBD" decisions remaining for MVP scope.

**Structure Completeness:**
Complete directory tree with every file named and its purpose described. Integration points explicitly mapped. Component boundaries defined with import rules.

**Pattern Completeness:**
Naming conventions cover database, API, code, and events. Format patterns cover API responses, WebSocket events, and data exchange. Process patterns cover error handling, retries, loading states, and graceful shutdown. Good/bad examples provided.

### Gap Analysis Results

**Critical Gaps:** None.

**Minor Gaps:**
- `.env.example` variable list not specified — should include: `SESSION_KEY`, `RPC_URL`, `PORT=3000`. Addressed in first implementation story.

### Architecture Completeness Checklist

**✅ Requirements Analysis**
- [x] Project context thoroughly analyzed
- [x] Scale and complexity assessed (Low-Medium)
- [x] Technical constraints identified (FOGOChain, Pyth, session keys)
- [x] Cross-cutting concerns mapped (6 concerns)

**✅ Architectural Decisions**
- [x] Critical decisions documented with versions
- [x] Technology stack fully specified (9 technology choices with versions)
- [x] Integration patterns defined (REST + WebSocket)
- [x] Performance considerations addressed (in-memory caching, batch writes)

**✅ Implementation Patterns**
- [x] Naming conventions established (database, API, code, events)
- [x] Structure patterns defined (server by domain, client by type)
- [x] Communication patterns specified (WebSocket event catalog, REST endpoints)
- [x] Process patterns documented (error handling, retry, shutdown)

**✅ Project Structure**
- [x] Complete directory structure defined (every file named)
- [x] Component boundaries established (5 boundaries with import rules)
- [x] Integration points mapped (internal + 3 external)
- [x] Requirements to structure mapping complete (all 35 FRs mapped)

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** High — all requirements mapped, all decisions made, all patterns defined, no critical gaps.

**Key Strengths:**
- Clear boundary separation prevents cross-concern coupling
- End-to-end type safety via shared types eliminates serialization bugs
- WebSocket event catalog provides a complete contract between backend and frontend
- Safety-first design: stop-loss + kill switch + graceful shutdown form defense in depth
- Extensibility: new trading strategies require only a new file in `strategies/`

**Areas for Future Enhancement:**
- Dynamic slippage based on order book depth (Phase 2)
- Configurable strategy parameters via dashboard (Phase 2)
- Mobile notifications for key events (Phase 2)
- Multi-market support beyond Valiant Perps (Phase 3)

### Implementation Handoff

**AI Agent Guidelines:**
- Follow all architectural decisions exactly as documented
- Use implementation patterns consistently across all components
- Respect project structure and boundaries — no cross-boundary imports
- Refer to this document for all architectural questions
- New WebSocket events must be added to `shared/events.ts` before use
- All errors must use the `AppError` class — never throw plain strings

**First Implementation Priority:**
Project scaffolding using the initialization commands from the Starter Template section, followed by database schema setup with Drizzle.
