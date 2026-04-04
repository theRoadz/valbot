# Story 1.4: SummaryBar & Connection Status

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As theRoad,
I want the top bar to show the ValBot name, connection status, and summary stat placeholders (wallet balance, PnL, trades, volume),
So that I can see at a glance whether the system is connected and ready.

## Acceptance Criteria

1. **Given** the dashboard layout shell exists (Story 1.3), **When** the dashboard loads, **Then** the SummaryBar shows "ValBot" with a connection status indicator.
2. **And** connection status shows green dot + "Connected" when WebSocket is active.
3. **And** connection status shows yellow pulsing dot + "Reconnecting..." during reconnection.
4. **And** connection status shows red dot + "Disconnected" when WebSocket is down.
5. **And** stat groups display: Wallet Balance, Total PnL, Session PnL, Total Trades, Total Volume — all showing $0.00 / 0 in muted color.
6. **And** financial numbers use JetBrains Mono font.
7. **And** the WebSocket hook (`use-websocket.ts`) connects to the backend and dispatches to Zustand store.

## Tasks / Subtasks

- [x] Task 1: Define shared types and WebSocket event types in `src/shared/` (AC: #7)
  - [x] 1.1 In `src/shared/types.ts`, define the **connection-relevant** types needed for this story: `ConnectionStatus` (literal union: `"connected" | "reconnecting" | "disconnected"`), `ConnectionState` (`{ status: ConnectionStatus; walletBalance: number }`), `SummaryStats` (`{ walletBalance: number; totalPnl: number; sessionPnl: number; totalTrades: number; totalVolume: number }`). Also define `ModeType` (`"volumeMax" | "profitHunter" | "arbitrage"`) as it will be referenced by the store shape. Do NOT define the full Trade, Position, Alert types yet — those belong in Story 2.1.
  - [x] 1.2 In `src/shared/events.ts`, define the WebSocket event name constants and the `WsMessage` discriminated union type. Define event names as `const` string literals: `EVENTS = { TRADE_EXECUTED: "trade.executed", STATS_UPDATED: "stats.updated", MODE_STARTED: "mode.started", MODE_STOPPED: "mode.stopped", MODE_ERROR: "mode.error", POSITION_OPENED: "position.opened", POSITION_CLOSED: "position.closed", ALERT_TRIGGERED: "alert.triggered", CONNECTION_STATUS: "connection.status" } as const`. Define the `WsMessage` base shape: `{ event: string; timestamp: number; data: unknown }`. Define the `ConnectionStatusPayload`: `{ rpc: boolean; wallet: string; balance: number }`. Full payload types for other events will be added in Story 2.1.

- [x] Task 2: Create Zustand store in `src/client/store/index.ts` (AC: #2, #3, #4, #7)
  - [x] 2.1 Define the store interface matching Architecture spec shape (scoped to what's needed now + placeholders for future slices). **Note:** `walletBalance` lives in `connection` (the source of truth from blockchain). The `stats.walletBalance` field mirrors it for convenience — `updateConnection` should update both when a `connection.status` event arrives.
    ```typescript
    interface ValBotStore {
      // Connection state (source of truth for wallet balance)
      connection: {
        status: ConnectionStatus;  // "connected" | "reconnecting" | "disconnected"
        walletBalance: number;
      };
      // Summary stats (aggregated across all modes — walletBalance mirrors connection.walletBalance)
      stats: SummaryStats;
      // Actions
      setConnectionStatus: (status: ConnectionStatus) => void;
      setWalletBalance: (balance: number) => void;
      updateConnection: (data: ConnectionStatusPayload) => void;
      handleWsMessage: (message: WsMessage) => void;
    }
    ```
  - [x] 2.2 Create store using `create<ValBotStore>()((set) => ({...}))` pattern (Zustand 5.x curried form). Initialize connection as `{ status: "disconnected", walletBalance: 0 }`, stats with all zeros.
  - [x] 2.3 Implement `handleWsMessage` action that switches on `message.event` and dispatches to the correct state update. For now, only handle `connection.status` events. Other events should be no-ops (logged to console in dev).
  - [x] 2.4 Export the store hook as `useStore` (default export). Components MUST use selectors: `useStore(s => s.connection)` — never `useStore(s => s)`.

- [x] Task 3: Create WebSocket hook in `src/client/hooks/use-websocket.ts` (AC: #2, #3, #4, #7)
  - [x] 3.1 Create `useWebSocket()` hook that manages a single WebSocket connection to `ws://localhost:${PORT}/ws`. Use `useEffect` with cleanup. The WebSocket URL should be derived from `window.location` (protocol `ws:`/`wss:`, host, path `/ws`) so it works in both dev (Vite proxy) and production.
  - [x] 3.2 On `open`: call `useStore.getState().setConnectionStatus("connected")`. **CRITICAL:** Use `useStore.getState()` (not the React hook form) inside WebSocket event handlers — they are not React render functions. Reset the reconnection attempt counter to 0.
  - [x] 3.3 On `message`: parse JSON, validate it has `event`, `timestamp`, `data` fields, then call `useStore.getState().handleWsMessage(parsed)`. Same pattern — access store outside React via `.getState()`.
  - [x] 3.4 On `close`: call `useStore.getState().setConnectionStatus("disconnected")`. Start reconnection with exponential backoff: 1s, 2s, 4s delays, max 5 attempts. Set status to `"reconnecting"` before each retry attempt. After 5 failures: stay disconnected permanently — user must refresh the page to reattempt.
  - [x] 3.5 On `error`: log to console, let `close` handler deal with reconnection.
  - [x] 3.6 Cleanup: close WebSocket and clear any reconnection timeout on component unmount.
  - [x] 3.7 Return `{ status }` from the hook (the current connection status from the store) for convenience, though components can also read from store directly.

- [x] Task 4: Create WebSocket endpoint on the Fastify server (AC: #7)
  - [x] 4.1 In `src/server/ws/broadcaster.ts`, create the WebSocket server. Import `WebSocketServer` from `ws`. Create a `setupWebSocket(server: FastifyInstance)` function that:
    - Gets the underlying HTTP server via `server.server`
    - Creates `new WebSocketServer({ server: httpServer, path: "/ws" })`. The `path: "/ws"` filter ensures the WebSocket upgrade handler only intercepts requests to `/ws`, preventing collision with Fastify's HTTP routes on the same port.
    - Tracks connected clients in a `Set<WebSocket>`
    - On `connection`: add client to set, send an initial `connection.status` event with `{ rpc: false, wallet: "", balance: 0 }` (placeholder until Story 1.5 adds real blockchain connection). **Note:** This initial event arrives AFTER the client's WebSocket `open` event — the client connection flow is: `open` fires → hook sets status to "connected" → then first message arrives with `connection.status` → hook dispatches to store updating wallet balance.
    - On `close`: remove client from set
    - Exports `broadcast(event: string, data: unknown)` function that JSON-stringifies `{ event, timestamp: Date.now(), data }` and sends to all connected clients
  - [x] 4.2 In `src/server/index.ts`, import and call `setupWebSocket(server)` after Fastify is ready (after `await server.listen()`). Ensure the WebSocket server shares the same HTTP server as Fastify.
  - [x] 4.3 Ensure Vite dev proxy forwards `/ws` to the backend WebSocket — verify the existing proxy config in `vite.config.ts` handles this (it was set up in Story 1.1 with `ws: true`).

- [x] Task 5: Upgrade TopBar component to reactive SummaryBar (AC: #1, #2, #3, #4, #5, #6)
  - [x] 5.1 Refactor `src/client/components/top-bar.tsx` to read from Zustand store instead of hardcoded values. Use selectors: `const connection = useStore(s => s.connection)` and `const stats = useStore(s => s.stats)`.
  - [x] 5.2 Implement connection status indicator with three visual states. The existing TopBar uses `h-2 w-2` (8px) for the dot — keep this size for visual consistency with the existing layout:
    - Connected: `bg-profit` green dot (h-2 w-2 rounded-full) + "Connected" in `text-profit`
    - Reconnecting: `bg-warning` yellow dot with CSS `animate-pulse` (built-in Tailwind, CSS-driven not JS-driven per UX-DR15) + "Reconnecting..." in `text-warning`
    - Disconnected: `bg-neutral` gray dot + "Disconnected" in `text-text-muted`
  - [x] 5.3 Format stat values using a `formatCurrency(value: number)` utility: display as `$X,XXX.XX` with comma separators, 2 decimal places, `+`/`-` prefix for PnL values. For now all values are 0, but the formatting must be ready. Format trade count as plain integer with comma separators. These are display-layer conversions from integer smallest-unit (Story 1.2 ADR-001) — divide by 1e6 for USDC before formatting.
  - [x] 5.4 Ensure financial numbers use `font-mono` class (JetBrains Mono). Stat labels use Inter (default).
  - [x] 5.5 Add `aria-live="assertive"` on the connection status container for screen reader announcements on status change. Add `aria-label` on stat values with full context (e.g., "Total profit and loss: $0.00").
  - [x] 5.6 Use semantic `<header>` element for the SummaryBar wrapper (per UX-DR16 accessibility).

- [x] Task 6: Wire WebSocket hook into App.tsx (AC: #7)
  - [x] 6.1 Call `useWebSocket()` at the top level of `App.tsx` (or in a wrapper component) so the WebSocket connection is established when the dashboard mounts.
  - [x] 6.2 Verify the connection status updates reactively in the TopBar when WebSocket connects/disconnects.

- [x] Task 7: Write tests (all ACs)
  - [x] 7.1 `src/shared/types.test.ts` — type-level tests ensuring ConnectionStatus, SummaryStats, ConnectionState are correctly typed (compile-time checks).
  - [x] 7.2 `src/client/store/index.test.ts` — test store initialization (defaults to disconnected, zero stats), test `setConnectionStatus` updates, test `updateConnection` updates both status and balance, test `handleWsMessage` dispatches connection.status events.
  - [x] 7.3 `src/client/hooks/use-websocket.test.ts` — test hook connects on mount, test reconnection on close with backoff, test cleanup on unmount. Mock `WebSocket` global.
  - [x] 7.4 Update `src/client/components/top-bar.test.tsx` — test renders "Disconnected" by default, test renders "Connected" with green dot when store has connected status, test renders "Reconnecting..." with pulsing yellow dot, test stat values display with correct formatting, test `aria-live` attribute present.
  - [x] 7.5 `src/server/ws/broadcaster.test.ts` — test WebSocket server accepts connections, test broadcast sends to all connected clients, test initial connection.status event sent on connect.

- [x] Task 8: Verify end-to-end (all ACs)
  - [x] 8.1 Run `pnpm dev`, open browser — dashboard should show "Disconnected" initially, then transition to "Connected" when WebSocket connects.
  - [x] 8.2 Stop the backend server — dashboard should show "Reconnecting..." then "Disconnected" after max retries.
  - [x] 8.3 Restart backend — dashboard should reconnect and show "Connected".
  - [x] 8.4 All stat values show $0.00 / 0 in muted monospace font.
  - [x] 8.5 Run `pnpm test` — all tests pass.
  - [x] 8.6 Run `pnpm build` — production build succeeds with zero errors.

## Dev Notes

### Critical Architecture Constraints

- **Zustand 5.x API.** Use the curried `create<T>()((set, get) => ({...}))` form. Do NOT use the old `create<T>((set) => ({...}))` form — that's Zustand 4.x.
- **Store selectors are mandatory.** Components MUST use `useStore(s => s.connection)` — NEVER `useStore(s => s)`. This prevents unnecessary re-renders on unrelated state changes.
- **WebSocket `onmessage` dispatches directly to store actions.** No middleware, no action creators, no Redux pattern. Just `store.getState().handleWsMessage(parsed)`.
- **All monetary values are stored as integers in smallest-unit** (USDC × 1e6). The store holds raw integers. Display-layer formatting (divide by 1e6, format with $ and commas) happens in the component or a utility function. Never store pre-formatted strings.
- **WebSocket event format:** Every message is `{ event: "dot.notation", timestamp: number, data: {...} }`. Defined in `src/shared/events.ts`.
- **Dark theme is the ONLY theme.** No light mode, no toggle.
- **No React Router.** Single-page dashboard.
- **`cn()` utility** exists at `src/client/lib/utils.ts` — use for conditional class merging.
- **`@client` path alias** configured in vite.config.ts, tsconfig.app.json, vitest.config.ts — shadcn/ui components import from `@client/lib/utils`.

### Scope Boundary with Story 2.1 (CRITICAL)

Story 2.1 ("Shared Types, WebSocket Event System & REST API Skeleton") creates the **full** versions of `src/shared/types.ts`, `src/shared/events.ts`, and `src/server/ws/broadcaster.ts`. **Story 1.4 creates the foundational versions of these same files.** Story 2.1 MUST EXTEND what Story 1.4 builds — not recreate from scratch. Specifically:
- `types.ts`: Story 1.4 adds `ConnectionStatus`, `ConnectionState`, `SummaryStats`, `ModeType`. Story 2.1 adds `Trade`, `Position`, `ModeConfig`, `ModeStats`, `Alert`, `TradeSide`, `ModeStatus` alongside them.
- `events.ts`: Story 1.4 adds `EVENTS` constants, `WsMessage` base type, `ConnectionStatusPayload`. Story 2.1 adds full payload types for all other 8 events.
- `broadcaster.ts`: Story 1.4 creates the WebSocket server with `broadcast()`. Story 2.1 adds typing and potentially the `AppError` integration.
- `store/index.ts`: Story 1.4 creates the Zustand store with `connection` + `stats` slices. Story 2.5 extends it with `modes`, `positions`, `trades`, `alerts` slices.

### WebSocket URL Construction

The WebSocket URL must work in both dev and production:
- **Dev:** Vite dev server on port 5173 proxies `/ws` to Fastify on port 3000. The proxy is already configured in `vite.config.ts` from Story 1.1 with `ws: true`.
- **Production:** Fastify serves everything on a single port. WebSocket connects directly.
- **Pattern:** Derive URL from `window.location`: `const wsUrl = \`\${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws\``

### WebSocket Server Setup (Fastify + ws)

Fastify 5.x does not have a built-in WebSocket plugin that's required. Use the raw `ws` library directly:
```typescript
import { WebSocketServer } from "ws";
// Get the Node.js http.Server from Fastify
const httpServer = fastify.server;
const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
```
**CRITICAL:** Call `setupWebSocket()` AFTER `await server.listen()` so the HTTP server is bound. If you call it before, `server.server` may not be ready.

### Reconnection Backoff Pattern

Architecture specifies: exponential backoff 1s, 2s, 4s — max 5 attempts. Implementation:
```
attempt 1: wait 1000ms
attempt 2: wait 2000ms
attempt 3: wait 4000ms
attempt 4: wait 4000ms (cap at 4s)
attempt 5: wait 4000ms (cap at 4s)
→ after 5 failures: stay disconnected, do not retry
```
Use `Math.min(1000 * 2 ** attempt, 4000)` for backoff calculation. Reset attempt counter to 0 on successful connection (`open` event). After max retries exhausted, set status to `"disconnected"` and stop retrying — user must refresh the page to reattempt. A future story may add a "Retry Connection" button.

### Zustand Store Shape (Scoped for This Story)

This story creates the store foundation. The full store shape from the Architecture spec includes `modes`, `positions`, `trades`, `alerts` — but those slices are NOT needed yet. Define them as empty/placeholder to establish the structure, but implementation is deferred:
```typescript
// What this story implements:
connection: { status, walletBalance }
stats: { walletBalance, totalPnl, sessionPnl, totalTrades, totalVolume }
actions: setConnectionStatus, setWalletBalance, updateConnection, handleWsMessage

// What future stories will add:
modes: {}           // Story 2.1+
positions: []       // Story 2.2+
trades: []          // Story 2.6+
alerts: []          // Story 3.4+
```

### Existing TopBar Component — Refactor, Don't Rewrite

The current `src/client/components/top-bar.tsx` (from Story 1.3) has the correct layout structure:
- Left: "ValBot" title + connection status dot + label
- Right: horizontal stat items (Wallet, Total PnL, Session PnL, Trades, Volume)
- Uses shadcn Card wrapper, correct spacing (`gap-3`, `gap-6`), correct typography classes

**Refactor it to:**
1. Import and use `useStore` selectors for connection and stats
2. Make the connection dot/label dynamic based on `connection.status`
3. Make stat values dynamic (currently hardcoded `"$0.00"`)
4. Add accessibility attributes (`aria-live`, `aria-label`)
5. Wrap in `<header>` semantic element
6. Add number formatting utility

Do NOT change the visual layout, spacing, or typography — those were validated in Story 1.3 code review.

### File Structure

```
src/shared/
├── types.ts          # MODIFY — add ConnectionStatus, ConnectionState, SummaryStats, ModeType
├── events.ts         # MODIFY — add EVENTS constants, WsMessage type, ConnectionStatusPayload
src/client/
├── App.tsx           # MODIFY — add useWebSocket() call
├── store/
│   └── index.ts      # NEW — Zustand store with connection + stats slices
├── hooks/
│   └── use-websocket.ts  # NEW — WebSocket connection hook with reconnection
├── components/
│   └── top-bar.tsx   # MODIFY — read from store, dynamic connection status, formatting
src/server/
├── index.ts          # MODIFY — add setupWebSocket(server) call
├── ws/
│   └── broadcaster.ts    # NEW — WebSocket server, client tracking, broadcast()
```

### What NOT to Do

**Scope boundaries (future story work):**
- Do NOT add real blockchain connection logic — that's Story 1.5
- Do NOT add REST API routes — that's Story 2.1
- Do NOT add `GET /api/status` initial state fetch — that's Story 2.5
- Do NOT add loading spinners or skeleton states — architecture mandates no global loading state

**Technology constraints:**
- Do NOT install new npm packages — `ws` and `zustand` are already in `package.json`
- Do NOT use `@fastify/websocket` plugin — use raw `ws` library directly
- Do NOT use Socket.io, Redux, MobX, or middleware/action creators

**Code conventions:**
- Do NOT change the existing CSS Grid layout, theme tokens, or shadcn component styling from Story 1.3
- Do NOT create nested component folders — flat files in `components/`

### Previous Story Intelligence

**From Story 1.3 (Dark Theme & Dashboard Layout):**
- `@client` path alias is configured (NOT `src/client`). All imports within client code should use `@client/...` for shadcn UI components.
- shadcn/ui components are in `src/client/components/ui/` — Card, Badge, Switch, Table, ScrollArea, Alert, Input, Select all installed.
- `vitest.config.ts` does NOT set `environment: 'jsdom'` globally — each client test file needs `// @vitest-environment jsdom` docblock.
- Test setup file at `src/client/vitest.setup.ts` configures `@testing-library/jest-dom/vitest`. Tests should use `.toBeInTheDocument()` not `.toBeDefined()`.
- `class-variance-authority` and `lucide-react` were manually installed as shadcn peer deps.
- TopBar currently renders hardcoded "Disconnected" + gray dot + static $0.00 values.

**From Story 1.2 (Database Schema):**
- ADR-001: All monetary values use integer smallest-unit (USDC × 1e6). The frontend must convert when displaying.
- ADR-002: DB connection is lazy via `getDb()`. Same pattern of lazy initialization should apply to the WebSocket server — don't create it at module import time.
- `src/server/index.ts` entry point: Fastify starts with `await server.listen({ port, host: '127.0.0.1' })` (localhost only, single-user tool).

**From Story 1.1 (Project Scaffolding):**
- `vite.config.ts` has proxy config for `/api` → `localhost:3000` and `/ws` → WebSocket with `ws: true`.
- `@shared` path alias configured in `tsconfig.json` and `vite.config.ts` for `src/shared/`.
- `pnpm dev` runs both frontend (Vite) and backend (tsx watch) concurrently.
- Dev dependencies include `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`.

### Git Intelligence

Recent commits show a consistent pattern:
- One commit per story: `feat: add <description> (Story X-Y)`
- Stories 1.1 → 1.2 → 1.3 completed sequentially, all done
- All code review findings from prior stories have been resolved
- No deferred work items remain unresolved

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.4] — Acceptance criteria and user story
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#SummaryBar] — Component anatomy, states, props, accessibility
- [Source: _bmad-output/planning-artifacts/architecture.md#Frontend Architecture] — Zustand store shape, component architecture
- [Source: _bmad-output/planning-artifacts/architecture.md#WebSocket Event Catalog] — connection.status payload: `{ rpc, wallet, balance }`
- [Source: _bmad-output/planning-artifacts/architecture.md#Communication Patterns] — WsMessage format, event dot notation
- [Source: _bmad-output/planning-artifacts/architecture.md#Structure Patterns] — File locations: hooks/use-websocket.ts, store/index.ts, ws/broadcaster.ts
- [Source: _bmad-output/planning-artifacts/architecture.md#Process Patterns] — Retry pattern: 1s/2s/4s backoff, max 5 client attempts
- [Source: _bmad-output/project-context.md#WebSocket Event Contract] — `{ event, timestamp, data }` shape
- [Source: _bmad-output/project-context.md#Zustand Store Rules] — Slice selectors, direct dispatch, immutable updates
- [Source: _bmad-output/project-context.md#Data Format Rules] — Unix ms timestamps, camelCase JSON, integer money, null not undefined

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- Fixed tsconfig.server.json to exclude test files from compilation (was causing build failures when test files were picked up by `src/shared/**/*` include pattern)
- Fixed vitest.config.ts to exclude `dist/` directory (compiled test JS files from dist/ were being picked up as test targets)

### Completion Notes List

- Task 1: Defined `ConnectionStatus`, `ConnectionState`, `SummaryStats`, `ModeType` types in `src/shared/types.ts`. Defined `EVENTS` constants, `WsMessage`, `ConnectionStatusPayload` in `src/shared/events.ts`.
- Task 2: Created Zustand 5.x store with `connection` + `stats` slices, `handleWsMessage` dispatcher that routes `connection.status` events. Uses curried `create<T>()((set) => ...)` form.
- Task 3: Created `useWebSocket()` hook with WebSocket connection, exponential backoff reconnection (1s/2s/4s, max 5 attempts), proper cleanup. Uses `useStore.getState()` pattern for non-React callbacks.
- Task 4: Created `broadcaster.ts` with `setupWebSocket()` and `broadcast()`. Sends initial `connection.status` placeholder on connect. Called after `server.listen()` in `src/server/index.ts`.
- Task 5: Refactored TopBar to read from Zustand store. Dynamic connection status indicator (green/yellow-pulse/gray). Currency formatting with `Intl.NumberFormat`, integer-to-USDC conversion (÷1e6). Added `aria-live="assertive"`, `aria-label`, `role="status"`, semantic `<header>`.
- Task 6: Wired `useWebSocket()` into `App.tsx` at top level.
- Task 7: 68 tests across 10 files — type tests, store tests, hook tests (with mock WebSocket), TopBar rendering tests, broadcaster tests.
- Task 8: All tests pass (`pnpm test`), build succeeds (`pnpm build`).

### File List

- `src/shared/types.ts` — Modified: added ConnectionStatus, ConnectionState, SummaryStats, ModeType
- `src/shared/events.ts` — Modified: added EVENTS constants, WsMessage, ConnectionStatusPayload
- `src/shared/types.test.ts` — Modified: type-level tests for shared types
- `src/client/store/index.ts` — New: Zustand store with connection + stats slices
- `src/client/store/index.test.ts` — New: store unit tests (7 tests)
- `src/client/hooks/use-websocket.ts` — New: WebSocket hook with reconnection
- `src/client/hooks/use-websocket.test.ts` — New: hook tests with mock WebSocket (6 tests)
- `src/client/components/top-bar.tsx` — Modified: reactive store-driven SummaryBar with formatting
- `src/client/components/top-bar.test.tsx` — Modified: expanded tests for all states, formatting, a11y (9 tests)
- `src/client/App.tsx` — Modified: added useWebSocket() call
- `src/server/ws/broadcaster.ts` — New: WebSocket server with broadcast()
- `src/server/ws/broadcaster.test.ts` — New: broadcaster tests (3 tests)
- `src/server/index.ts` — Modified: import and call setupWebSocket after listen
- `tsconfig.server.json` — Modified: exclude test files from server build
- `vitest.config.ts` — Modified: exclude dist/ from test discovery

### Review Findings

- [x] [Review][Patch] AC #4: Disconnected dot uses `bg-neutral` (gray) instead of red — fixed: now uses `bg-loss` and `text-loss` [src/client/components/top-bar.tsx:38-41]
- [x] [Review][Patch] `handleWsMessage` calls `useStore.getState().updateConnection()` inside an action instead of using `set` directly — fixed: now uses `set()` directly [src/client/store/index.ts:46-58]
- [x] [Review][Patch] Reconnecting WebSockets not closed before creating new ones — fixed: old ws is now closed before creating new one [src/client/hooks/use-websocket.ts:24-28]
- [x] [Review][Patch] Test describes disconnected as "gray dot" — fixed: now asserts red (`bg-loss`) class [src/client/components/top-bar.test.tsx:28-32]
- [x] [Review][Patch] Unsafe `as ConnectionStatusPayload` cast without validating `data` shape — fixed: now validates rpc/wallet/balance types before use [src/client/store/index.ts:47-55]
- [x] [Review][Fixed] `WsMessage.event` typed as `string` — fixed: added `EventName` type derived from `EVENTS`, tightened `WsMessage.event` and `broadcast()` parameter [src/shared/events.ts:17]
- [x] [Review][Fixed] Server sends `rpc: false` on initial connect causing connected→disconnected flicker — fixed: removed placeholder initial message, Story 1.5 will send real status [src/server/ws/broadcaster.ts]
- [x] [Review][Fixed] No `teardown`/`close` export for broadcaster module singletons — fixed: added `closeWebSocket()` that closes all clients and WSS [src/server/ws/broadcaster.ts]

### Change Log

- 2026-04-04: Story 1.4 implementation complete — SummaryBar with reactive connection status, Zustand store, WebSocket hook with reconnection, broadcaster server, comprehensive tests (68 total). All ACs satisfied.
