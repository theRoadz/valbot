# Deferred Work

## Deferred from: code review of 1-1-project-scaffolding-and-dev-environment (2026-04-04)

- SPA catch-all serves index.html for mistyped API routes in production [src/server/index.ts:21] — should scope the not-found handler to non-API routes when API routes are added
- db/index.ts executes at module load with no error handling [src/server/db/index.ts:5] — DB connection should be lazy-initialized with error handling; will be reworked in Story 1.2
- Top-level await may fail if dist/ deployed without package.json [src/server/index.ts:17,29] — deployment packaging should ensure package.json (with "type": "module") is included in dist/
- SQLite database path is relative with no CWD guarantee [src/server/db/index.ts:5, drizzle.config.ts:8] — deferred to Story 1.2; runtime resolves `valbot.db` against CWD, drizzle-kit resolves against project root
