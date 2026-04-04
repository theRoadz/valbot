# Story 1.1: Project Scaffolding & Dev Environment

Status: done

## Story

As a developer,
I want the project scaffolded with Vite + React, Fastify backend, Tailwind v4 + shadcn/ui, Drizzle ORM + better-sqlite3, and Vitest configured in a single project,
So that I have a working dev environment where `pnpm dev` runs both frontend and backend with hot reload.

## Acceptance Criteria

1. **Given** a fresh clone of the repository, **When** I run `pnpm install && pnpm dev`, **Then** the Fastify server starts on port 3000 and serves the React app.
2. **And** Vite HMR works for frontend changes.
3. **And** tsx watch reloads the backend on server file changes.
4. **And** the project structure matches the Architecture spec (`src/server/`, `src/client/`, `src/shared/`).
5. **And** TypeScript strict mode is enabled with path aliases for shared types (`@shared/*`).
6. **And** `.env.example` exists with `SESSION_KEY`, `RPC_URL`, `PORT=3000`.
7. **And** `.gitignore` excludes `.env`, `node_modules`, `dist/`, and `valbot.db`.

## Tasks / Subtasks

- [x] Task 1: Initialize project and install dependencies (AC: #1)
  - [x] 1.1 Run `pnpm init` to create `package.json` with name `valbot`
  - [x] 1.2 Install production dependencies: `fastify`, `@fastify/static`, `ws`, `drizzle-orm`, `better-sqlite3`, `dotenv`, `react`, `react-dom`, `zustand`
  - [x] 1.3 Install dev dependencies: `typescript`, `@types/node`, `@types/ws`, `@types/better-sqlite3`, `@types/react`, `@types/react-dom`, `tsx`, `vite`, `@vitejs/plugin-react`, `@tailwindcss/vite`, `tailwindcss`, `drizzle-kit`, `vitest`, `@vitest/coverage-v8`, `concurrently`

- [x] Task 2: Create project directory structure (AC: #4)
  - [x] 2.1 Create `src/server/` with subdirectories: `api/`, `engine/`, `engine/strategies/`, `blockchain/`, `ws/`, `db/`, `db/migrations/`, `lib/`
  - [x] 2.2 Create `src/client/` with subdirectories: `components/`, `components/ui/`, `store/`, `hooks/`, `lib/`
  - [x] 2.3 Create `src/shared/`
  - [x] 2.4 Create placeholder `index.ts` in `src/server/` (Fastify entry point)
  - [x] 2.5 Create placeholder `main.tsx` and `App.tsx` in `src/client/`
  - [x] 2.6 Create placeholder `types.ts` and `events.ts` in `src/shared/`
  - [x] 2.7 Create `src/client/index.css` with Tailwind v4 import and font-face declarations
  - [x] 2.8 Create `index.html` at project root — Vite entry point referencing `src/client/main.tsx`, with `<html lang="en" class="dark">`, `<title>ValBot</title>`, viewport meta tag, and font preload links for Inter and JetBrains Mono

- [x] Task 3: Configure TypeScript (AC: #5)
  - [x] 3.1 Create `tsconfig.json` — base config with `strict: true`, path aliases `@shared/*` → `src/shared/*`
  - [x] 3.2 Create `tsconfig.server.json` — extends base, targets Node.js 22 (`"target": "ES2022"`, `"module": "Node16"`)
  - [x] 3.3 Create `tsconfig.app.json` — extends base, for Vite/React client code (includes `vite/client` types)
  - [x] 3.4 Add `"compilerOptions.types": ["vite/client"]` in `tsconfig.app.json` for asset import type shimming

- [x] Task 4: Configure Vite (AC: #1, #2)
  - [x] 4.1 Create `vite.config.ts` with `@vitejs/plugin-react` and `@tailwindcss/vite` plugins
  - [x] 4.2 Set `root` to `src/client`
  - [x] 4.3 Configure `server.proxy` to forward `/api` and `/ws` requests to Fastify on port 3000
  - [x] 4.4 Configure `build.outDir` to `../../dist/client`
  - [x] 4.5 Configure `resolve.alias` for `@shared` path alias

- [x] Task 5: Configure Fastify entry point (AC: #1)
  - [x] 5.1 Create `src/server/index.ts` — imports Fastify, loads dotenv, registers a health check route `GET /api/status` returning `{ status: "ok" }`
  - [x] 5.2 In production mode, serve static files from `dist/client/` using `@fastify/static` (already in prod deps from Task 1.2), with SPA fallback routing `/*` → `index.html`
  - [x] 5.3 Listen on port from `process.env.PORT` (default 3000)

- [x] Task 6: Configure Drizzle (AC: #1)
  - [x] 6.1 Create `drizzle.config.ts` — dialect `sqlite`, schema path `src/server/db/schema.ts`, out `src/server/db/migrations`
  - [x] 6.2 Create placeholder `src/server/db/schema.ts` with a comment (full schema is Story 1.2)
  - [x] 6.3 Create `src/server/db/index.ts` — DB connection placeholder using better-sqlite3 + drizzle

- [x] Task 7: Configure Vitest (AC: #1)
  - [x] 7.1 Create `vitest.config.ts` — references Vite config, resolves `@shared` alias
  - [x] 7.2 Add a sample test file `src/shared/types.test.ts` that passes to verify setup

- [x] Task 8: Configure shadcn/ui (AC: #1)
  - [x] 8.1 Run `npx shadcn@latest init` — select default style, dark theme defaults
  - [x] 8.2 Ensure components install to `src/client/components/ui/`
  - [x] 8.3 Create or update `components.json` with correct aliases and paths

- [x] Task 9: Create npm scripts (AC: #1, #2, #3)
  - [x] 9.1 `"dev"` — uses `concurrently` to run `"dev:server"` and `"dev:client"` in parallel
  - [x] 9.2 `"dev:server"` — `tsx watch src/server/index.ts`
  - [x] 9.3 `"dev:client"` — `vite dev` (with client root)
  - [x] 9.4 `"build"` — `vite build && tsc -p tsconfig.server.json` (Vite outputs to `dist/client/`, tsc outputs to `dist/server/` — ensure `tsconfig.server.json` has `"outDir": "../../dist/server"`)
  - [x] 9.5 `"start"` — `node dist/server/index.js`
  - [x] 9.6 `"test"` — `vitest`
  - [x] 9.7 `"test:coverage"` — `vitest run --coverage`
  - [x] 9.8 `"db:generate"` — `drizzle-kit generate`
  - [x] 9.9 `"db:migrate"` — `drizzle-kit migrate`

- [x] Task 10: Create environment and git config files (AC: #6, #7)
  - [x] 10.1 Create `.env.example` with `SESSION_KEY=your_session_key_here`, `RPC_URL=https://rpc.fogo.chain`, `PORT=3000`
  - [x] 10.2 Create `.gitignore` excluding: `.env`, `node_modules/`, `dist/`, `valbot.db`, `*.db-journal`
  - [x] 10.3 Initialize git repo with `git init`

- [x] Task 11: Verify end-to-end setup (AC: #1, #2, #3)
  - [x] 11.1 Run `pnpm install` — all dependencies install without errors
  - [x] 11.2 Run `pnpm dev` — Fastify starts on port 3000, Vite dev server starts on port 5173 with proxy
  - [x] 11.3 Open browser to `http://localhost:5173` — see React app served with Tailwind dark theme
  - [x] 11.4 Modify a React component — verify HMR updates without full page reload
  - [x] 11.5 Modify server code — verify tsx watch restarts the backend
  - [x] 11.6 Run `pnpm test` — sample test passes

## Dev Notes

### Critical Architecture Constraints

- **Single project, NOT monorepo.** No Turborepo, no workspace configuration. Server and client in the same `package.json`.
- **Fastify 5.8.x** — NOT Express. Fastify is 2-3x faster, has first-class TypeScript support, and schema validation. Do NOT install Express.
- **Vite 8.x** — Uses Rolldown-based builds. Template is `react-ts`.
- **Tailwind CSS v4** — Uses `@import "tailwindcss"` in CSS, NOT `@tailwind base/components/utilities` directives (that's v3 syntax). Uses `@tailwindcss/vite` plugin, NOT PostCSS config.
- **ws library (native WebSocket)** — NOT Socket.io. Single-user localhost tool doesn't need Socket.io overhead.
- **pnpm** — NOT npm or yarn. Use `pnpm` for all package management commands.
- **Node.js 22.x LTS** — Required by Vite 8 and Fastify 5.

### Naming Conventions (MUST follow)

- **Files:** `kebab-case` for everything — `mode-card.tsx`, `fund-allocator.ts`
- **React components:** `PascalCase` in code — `ModeCard`, `TradeLog`
- **Functions/variables:** `camelCase` — `startMode()`, `fundBalance`
- **Types/interfaces:** `PascalCase` — `Trade`, `Position`, `ModeStatus`
- **Constants:** `UPPER_SNAKE_CASE` — `MAX_RETRIES`, `DEFAULT_SLIPPAGE`

### File Organization Rules

- Server organized **by domain**: `api/`, `engine/`, `blockchain/`, `ws/`, `db/`, `lib/`
- Client organized **by type**: `components/`, `store/`, `hooks/`, `lib/`
- Components are **flat files** — no nested folders per component
- No `utils/` or `helpers/` grab-bag folders — utilities go in `lib/` within their layer
- Tests co-located with source: `fund-allocator.test.ts` next to `fund-allocator.ts`

### Vite 8 + Fastify Dev Setup Pattern

In development, two processes run in parallel:
1. **Fastify backend** via `tsx watch src/server/index.ts` — handles `/api/*` routes and will later handle WebSocket upgrades
2. **Vite dev server** on port 5173 — serves React app with HMR, proxies `/api` and `/ws` to Fastify on port 3000

In production, Fastify serves the built React app from `dist/client/` using `@fastify/static` on a single port.

### Font Loading & index.html Setup

The `index.html` file at the project root is Vite's mandatory entry point. It must include:
```html
<!DOCTYPE html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ValBot</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/client/main.tsx"></script>
  </body>
</html>
```

Key points:
- `class="dark"` on `<html>` — required for shadcn/ui dark mode CSS to apply
- **Inter** (UI text) and **JetBrains Mono** (financial numbers) loaded via Google Fonts
- Font-family declarations go in `src/client/index.css`:
  ```css
  @import "tailwindcss";

  body {
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
  }

  .font-mono {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
  }
  ```

### Tailwind v4 Specific Setup

Tailwind v4 is a major change from v3:
- CSS file uses `@import "tailwindcss"` (NOT `@tailwind base; @tailwind components; @tailwind utilities;`)
- Configuration is done via CSS `@theme` directive, NOT `tailwind.config.js` (no config file needed)
- Use `@tailwindcss/vite` plugin in `vite.config.ts` (NOT PostCSS)
- Custom OKLCH color tokens will be added in Story 1.3

### shadcn/ui v4 CLI Setup

- shadcn/ui components are copied into `src/client/components/ui/` — they are NOT imported from a package
- `npx shadcn@latest init` will prompt for configuration — set the components directory to `src/client/components/ui`
- A `components.json` config file will be created at the project root
- Individual components are added later with `npx shadcn@latest add <component>`

### TypeScript Path Aliases

Configure `@shared/*` path alias so both server and client can import shared types:
```json
{
  "compilerOptions": {
    "paths": {
      "@shared/*": ["./src/shared/*"]
    }
  }
}
```
Vite also needs `resolve.alias` in `vite.config.ts` to resolve `@shared` at build time.

### What NOT to Do

- Do NOT create a `tailwind.config.js` — Tailwind v4 uses CSS-based configuration
- Do NOT use `@tailwind` directives — use `@import "tailwindcss"`
- Do NOT install Express — use Fastify
- Do NOT install Socket.io — use the `ws` library
- Do NOT use npm or yarn — use pnpm
- Do NOT create a monorepo structure — single `package.json`
- Do NOT create `__tests__/` directories — tests go next to source files
- Do NOT put utilities in `utils/` — use `lib/` within the appropriate layer
- Do NOT use ISO date strings in any payload — use Unix ms timestamps

### Project Structure Notes

Alignment with unified project structure (from Architecture spec):
```
valbot/
├── src/
│   ├── server/           # Fastify backend + trading engine
│   │   ├── index.ts      # Entry point
│   │   ├── api/          # Route handlers
│   │   ├── engine/       # Trading logic (empty for now)
│   │   │   └── strategies/
│   │   ├── blockchain/   # Chain interaction (empty for now)
│   │   ├── ws/           # WebSocket broadcaster (empty for now)
│   │   ├── db/           # Database layer
│   │   │   ├── schema.ts
│   │   │   ├── index.ts
│   │   │   └── migrations/
│   │   └── lib/          # Shared server utilities (empty for now)
│   ├── client/
│   │   ├── main.tsx      # React entry
│   │   ├── App.tsx       # Root component
│   │   ├── index.css     # Tailwind v4 imports
│   │   ├── components/
│   │   │   └── ui/       # shadcn/ui primitives
│   │   ├── store/        # Zustand (empty for now)
│   │   ├── hooks/        # Custom hooks (empty for now)
│   │   └── lib/          # Client utilities (empty for now)
│   └── shared/
│       ├── types.ts      # Shared type definitions (placeholder)
│       └── events.ts     # WebSocket event types (placeholder)
├── package.json
├── tsconfig.json
├── tsconfig.server.json
├── tsconfig.app.json
├── vite.config.ts
├── drizzle.config.ts
├── vitest.config.ts
├── .env.example
├── .gitignore
└── index.html           # Vite HTML entry (dark mode, fonts, references src/client/main.tsx)
```

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#Selected Stack] — Technology versions and rationale
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure] — Directory layout
- [Source: _bmad-output/planning-artifacts/architecture.md#Initialization Commands] — Scaffold commands
- [Source: _bmad-output/planning-artifacts/architecture.md#Development Workflow Integration] — Dev/build/test scripts
- [Source: _bmad-output/planning-artifacts/architecture.md#Naming Patterns] — All naming conventions
- [Source: _bmad-output/planning-artifacts/architecture.md#Structure Patterns] — File organization rules
- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.1] — Acceptance criteria
- [Source: _bmad-output/planning-artifacts/prd.md#Technical Architecture] — Chain and wallet requirements
- [Source: _bmad-output/project-context.md] — Critical implementation rules for AI agents

### Latest Technology Notes (April 2026)

- **Vite 8.x** — Uses Rolldown engine (Rust-based bundler replacing Rollup). `pnpm create vite@latest` scaffolds with Vite 8. The `react-ts` template includes ESLint config by default.
- **Tailwind CSS v4** — No `tailwind.config.js` needed. Config via `@theme` in CSS. The `@tailwindcss/vite` plugin handles everything.
- **Fastify 5.8.x** — Stable v5 with full ESM support. Use `@fastify/static` for serving built files in production.
- **Drizzle ORM 1.0-beta** — Use `defineConfig` in `drizzle.config.ts`. Dialect is `sqlite`. Schema definitions use `sqliteTable()` from `drizzle-orm/sqlite-core`.
- **Vitest 4.1.x** — Supports Vite 8. Shares Vite transforms and config.

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- Fixed TypeScript 6.0 deprecation of `baseUrl` — removed from tsconfig.json (Vite handles alias resolution)
- Fixed Node16 module resolution requiring `.js` extensions in server imports (db/index.ts)

### Completion Notes List

- All 11 tasks completed successfully
- Project scaffolded with Vite 8.0.3, React 19.2.4, Fastify 5.8.4, Tailwind CSS 4.2.2, Drizzle ORM 0.45.2, Vitest 4.1.2
- TypeScript 6.0.2 strict mode with `@shared/*` path alias configured
- `pnpm dev` runs both Fastify (port 3000) and Vite dev server (port 5173) concurrently
- Health check endpoint `GET /api/status` returns `{"status":"ok"}`
- shadcn/ui configured via `components.json` with dark theme, components targeting `src/client/components/ui/`
- Added `clsx` and `tailwind-merge` as shadcn/ui utility dependencies
- Sample test passes via `pnpm test`
- Git repo initialized, `.env.example` and `.gitignore` created

### Change Log

- 2026-04-04: Story 1.1 implementation complete — full project scaffolding with all dependencies, configs, and dev environment

### File List

- package.json (new)
- pnpm-lock.yaml (new)
- index.html (new)
- tsconfig.json (new)
- tsconfig.server.json (new)
- tsconfig.app.json (new)
- vite.config.ts (new)
- vitest.config.ts (new)
- drizzle.config.ts (new)
- components.json (new)
- .env.example (new)
- .gitignore (new)
- src/server/index.ts (new)
- src/server/db/index.ts (new)
- src/server/db/schema.ts (new)
- src/client/main.tsx (new)
- src/client/App.tsx (new)
- src/client/index.css (new)
- src/client/lib/utils.ts (new)
- src/shared/types.ts (new)
- src/shared/events.ts (new)
- src/shared/types.test.ts (new)

### Review Findings

- [x] [Review][Defer] **SQLite database path is relative with no CWD guarantee** [src/server/db/index.ts:5, drizzle.config.ts:8] — deferred to Story 1.2 (DB layer rework)
- [x] [Review][Patch] **Production static path resolves incorrectly after tsc compilation** — Fixed: changed `outDir` to `./dist` so `src/server/index.ts` compiles to `dist/server/index.js` and static path resolves correctly. [tsconfig.server.json:7-8]
- [x] [Review][Patch] **Server binds to 0.0.0.0 — exposed to all network interfaces** — Fixed: changed host to `127.0.0.1`. [src/server/index.ts:29]
- [x] [Review][Patch] **vitest.config.ts has `globals: true` but should be `false`** — Fixed: set to `false`. [vitest.config.ts:11]
- [x] [Review][Defer] **SPA catch-all serves index.html for mistyped API routes in production** [src/server/index.ts:21] — deferred, pre-existing pattern to fix when API routes are added
- [x] [Review][Defer] **db/index.ts executes at module load with no error handling** [src/server/db/index.ts:5] — deferred, DB layer will be reworked in Story 1.2
- [x] [Review][Defer] **Top-level await may fail if dist/ deployed without package.json** [src/server/index.ts:17,29] — deferred, deployment packaging is a future concern
