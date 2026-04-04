---
project_name: 'ValBot'
user_name: 'theRoad'
date: '2026-04-03'
sections_completed: ['technology_stack', 'boundary_rules', 'naming_conventions', 'data_formats', 'websocket_contract', 'error_handling', 'trading_safety', 'zustand_rules', 'tailwind_shadcn', 'testing', 'rpc_blockchain', 'dev_workflow']
existing_patterns_found: 42
rule_count: 42
optimized_for_llm: true
status: 'complete'
---

# Project Context for AI Agents

_Critical rules and patterns for implementing ValBot. Focus on unobvious details that agents might otherwise miss._

---

## Technology Stack & Versions

- **Runtime:** Node.js 22.x LTS
- **Language:** TypeScript 5.x (strict mode)
- **Package Manager:** pnpm (not npm or yarn)
- **Frontend:** Vite 8.x + React + Tailwind CSS v4 + shadcn/ui CLI v4
- **Backend:** Fastify 5.8.x
- **Database:** Drizzle ORM 1.0-beta + better-sqlite3 11.x
- **Testing:** Vitest 4.1.x + @vitest/coverage-v8
- **WebSocket:** ws (native, not Socket.io)
- **State Management:** Zustand
- **Blockchain:** `@nktkas/hyperliquid` (Hyperliquid TypeScript SDK), `viem` (EVM wallet), Pyth Network SDK

## Critical Implementation Rules

### Boundary Rules (NEVER violate)

- `src/server/api/` — ONLY layer that handles HTTP request/response. Never access DB or blockchain directly from routes.
- `src/server/blockchain/` — ONLY code that touches Hyperliquid API or Valiant Perps order management. Never emits WebSocket events or writes to DB.
- `src/server/db/` — ONLY code that imports `better-sqlite3` or uses Drizzle queries. No other layer uses raw SQL. DB connection is lazy via `getDb()`, NOT module-level.
- `src/server/ws/broadcaster.ts` — ONLY code that manages WebSocket connections. Only engine and error handler call `broadcast()`.
- `src/client/` — NEVER imports from `src/server/`. Communication only via REST API and WebSocket.
- `src/shared/` — Shared types imported by BOTH sides via TypeScript path aliases. Define types here BEFORE using them.

### Naming Conventions

- **Files:** `kebab-case` for everything — `mode-card.tsx`, `fund-allocator.ts`
- **DB columns:** `camelCase` — `entryPrice`, `stopLoss`, `createdAt` (Drizzle maps directly to TS)
- **API endpoints:** lowercase with colons — `/api/mode/:mode/start`
- **WebSocket events:** `dot.notation` — `trade.executed`, `mode.started`, `alert.triggered`
- **React components:** `PascalCase` in code — `ModeCard`, `TradeLog`
- **Constants:** `UPPER_SNAKE_CASE` — `MAX_RETRIES`, `KILL_SWITCH_THRESHOLD`
- **Types/interfaces:** `PascalCase` — `Trade`, `Position`, `ModeStatus`

### Data Format Rules

- **Dates:** Unix millisecond timestamps (`Date.now()`) in ALL payloads. NEVER ISO strings. Frontend formats for display with `Intl.DateTimeFormat`.
- **JSON fields:** `camelCase` everywhere — API, WebSocket, Zustand store. No snake_case.
- **Nulls:** Explicit `null` for absent optional values. NEVER `undefined` in API payloads.
- **Numbers:** Monetary/financial values stored as **integer smallest-unit** (e.g., USDC × 1e6). Frontend converts to display units with fixed decimals. NEVER use `real()` for money — IEEE 754 rounding compounds across aggregated trades.
- **API success:** Direct payload `{ modes: [...] }`. NO wrapper `{ success: true, data: {...} }`.
- **API error:** `{ error: { severity, code, message, details, resolution } }`

### WebSocket Event Contract

Every WebSocket message follows this shape:
```typescript
{ event: "dot.notation.name", timestamp: number, data: { ... } }
```
New events MUST be added to `shared/events.ts` before use. The event catalog in the architecture document is the contract.

### Error Handling

- ALL errors use the `AppError` class from `server/lib/errors.ts`. NEVER throw plain strings or generic `Error`.
- Three severity levels: `info` (auto-dismiss toast), `warning` (persistent toast), `critical` (banner above top bar).
- Every error includes a `resolution` field — agents must always provide actionable resolution text.
- Blockchain errors are caught in the engine layer and mapped to `AppError` with resolution guidance.
- No `try/catch` wrapping every function. Use Fastify's error handling chain.

### Trading Safety Rules (CRITICAL — real money at risk)

- **Stop-loss is mandatory.** Every position opened MUST have stop-loss set BEFORE the position is considered active.
- **Fund isolation is absolute.** A mode MUST check `fund-allocator.ts` before every trade. A mode can NEVER exceed its allocation.
- **Kill switch threshold:** Auto-close ALL positions for a mode when that mode's allocated collateral drops 10%. Other modes MUST be unaffected.
- **No orphaned positions.** On crash, error, or shutdown — all positions must be closed. The `positions` DB table exists for crash recovery.
- **Graceful shutdown sequence:** Stop modes → close positions → flush DB buffer → close WebSocket → close DB → exit. NEVER skip steps.
- **Failed trades:** No automatic retry. Log failure, emit error event, let strategy loop decide on next iteration.

### Zustand Store Rules

- Subscribe to **slices** via selectors: `useStore(s => s.modes.volumeMax)`. NEVER `useStore(s => s)`.
- WebSocket `onmessage` dispatches directly to store actions. No middleware, no action creators.
- All state updates are **immutable** — use spread operator or Zustand `set()`.
- REST API calls are `async` functions within the store actions.

### Tailwind v4 + shadcn/ui Rules

- Tailwind v4 uses `@import "tailwindcss"` in CSS, NOT `@tailwind` directives.
- Use `@tailwindcss/vite` plugin, NOT PostCSS config.
- shadcn/ui components go in `src/client/components/ui/`. Install with `npx shadcn@latest add <component>`.
- Dark theme is the ONLY theme. No light mode toggle.
- Custom color tokens use hex values: `--profit` (green), `--loss` (red), `--warning` (amber), `--neutral` (gray), `--accent-blue` (blue).
- Financial numbers use `font-mono` (JetBrains Mono). UI text uses Inter.

### Testing Rules

- Tests co-located with source: `fund-allocator.test.ts` next to `fund-allocator.ts`.
- No separate `__tests__/` directory.
- Vitest config shares Vite transforms.

### API & Blockchain Rules

- Hyperliquid API retry: Exponential backoff (1s, 2s, 4s), max 3 retries, then emit critical alert.
- WebSocket reconnection (client-side): 1s/2s/4s backoff, max 5 attempts.
- Agent key (SESSION_KEY) and master wallet (WALLET) loaded from `.env` via dotenv. NEVER log keys, expose in UI, or transmit beyond API signatures.
- Agent key is secp256k1 EVM private key (0x hex). Master wallet address used for Hyperliquid info queries — NOT the agent key's derived address.

### Development Workflow

- `pnpm dev` runs backend (tsx watch) + frontend (Vite dev with proxy) in parallel.
- `pnpm build` outputs client to `dist/client/`, server to `dist/server/`.
- Production: single process `node dist/server/index.js` serves everything.
- SQLite DB file auto-created on first run. Gitignored.

---

## Usage Guidelines

**For AI Agents:**
- Read this file before implementing any code
- Follow ALL rules exactly as documented
- When in doubt, prefer the more restrictive option
- Refer to `_bmad-output/planning-artifacts/architecture.md` for full architectural details

**For Humans:**
- Keep this file lean and focused on agent needs
- Update when technology stack changes
- Remove rules that become obvious over time

Last Updated: 2026-04-04
