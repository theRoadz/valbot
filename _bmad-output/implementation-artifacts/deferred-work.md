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
