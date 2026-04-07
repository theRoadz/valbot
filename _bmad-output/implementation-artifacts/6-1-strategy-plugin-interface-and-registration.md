# Story 6.1: Strategy Plugin Interface & Registration

Status: done

## Story

As a developer,
I want a clearly defined strategy interface and automatic registration system,
So that adding a new trading strategy requires only creating a new file in the strategies folder.

## Acceptance Criteria

1. **Given** the mode-runner base class from Epic 2, **When** a developer wants to add a new strategy, **Then** the `ModeRunner` base class in `mode-runner.ts` defines a clear interface: `name`, `description`, `defaultConfig`, `onStart()`, `onStop()`, `onIteration()`, and lifecycle hooks.
2. **Given** strategy files exist in `src/server/engine/strategies/`, **When** the engine initializes, **Then** a strategy registry discovers and registers all strategy files in that folder automatically.
3. **Given** the three existing strategies (Volume Max, Profit Hunter, Arbitrage), **When** the registry is active, **Then** all three conform to the new interface without behavior changes.
4. **Given** a new strategy file implementing the interface is placed in `src/server/engine/strategies/`, **When** the engine initializes, **Then** it is automatically available to the system without any other code changes.
5. **Given** the registry has registered strategies, **When** `getAvailableStrategies()` is called, **Then** it returns typed metadata (name, description, status) for each registered strategy.
6. **Given** the registry is active, **When** `GET /api/status` is called, **Then** the response includes the list of registered strategies.

## Tasks / Subtasks

- [x] Task 1: Widen `ModeType` and update related type maps (AC: #1, #4) — DO THIS FIRST
  - [x] Change `ModeType` in `shared/types.ts` from union literal to `string` with runtime validation
  - [x] Replace `MODE_URL_MAP` and `MODE_SLUG_MAP` static dictionaries with registry-driven lookups
  - [x] Remove `urlModeToModeType()` and `modeTypeToSlug()` — will be replaced by registry methods
  - [x] Update `StatusResponse` type to include `strategies` field
- [x] Task 2: Extend ModeRunner base class with plugin metadata (AC: #1)
  - [x] Add abstract getters: `strategyName: string`, `strategyDescription: string`, `defaultConfig: Record<string, unknown>`
  - [x] Add abstract `modeColor: string` property for mode identity color
  - [x] Add abstract `urlSlug: string` property for URL routing
  - [x] Add optional lifecycle hooks: `onStart()`, `onStop()` called from existing `start()`/`stop()` methods
  - [x] Keep `executeIteration()` as-is (it already serves as `onIteration()`)
  - [x] Ensure backward compatibility — existing strategies must not break
- [x] Task 3: Create strategy registry (AC: #2, #4, #5)
  - [x] Create `src/server/engine/strategy-registry.ts`
  - [x] Implement `StrategyRegistration` type: `{ name, description, modeType, urlSlug, factory, modeColor, requires }`
  - [x] `requires` field: `{ oracle?: boolean, blockchain?: boolean }` — declares strategy dependencies
  - [x] Implement `StrategyDeps` type for factory functions (see Strategy Constructor Signatures below)
  - [x] Implement `registerStrategy()` — strategies call it from their module; rejects duplicates
  - [x] Implement `getAvailableStrategies()` returning `{ name, description, modeType, urlSlug, modeColor, status }[]`
  - [x] Implement `getRegistration(modeType: string)` for engine lookup
  - [x] Implement `getModeTypeFromSlug(slug: string)` replacing the old `urlModeToModeType()`
  - [x] Implement `getRegisteredModeTypes()` returning all registered mode type strings
  - [x] Export singleton registry instance
- [x] Task 4: Refactor existing strategies to register themselves (AC: #3)
  - [x] Update `VolumeMaxStrategy` — implement new abstract members, add self-registration call
  - [x] Update `ProfitHunterStrategy` — implement new abstract members, add self-registration call
  - [x] Update `ArbitrageStrategy` — implement new abstract members, add self-registration call
  - [x] Each strategy exports a factory function encapsulating its unique dependency wiring
  - [x] ProfitHunter factory: pulls `oracleClient` from deps
  - [x] Arbitrage factory: pulls `oracleClient` and `getMidPrice` from deps
- [x] Task 5: Refactor engine/index.ts to use registry (AC: #2, #4)
  - [x] Import all strategy files to trigger self-registration
  - [x] Replace hardcoded switch-case in `startMode()` with registry lookup + factory call
  - [x] Replace hardcoded oracle/blockchain gate checks with generic `requires` checks from registration
  - [x] Preserve existing `modeLocks`, session management, kill-switch callbacks
- [x] Task 6: Update API routes and error messages (AC: #6)
  - [x] Update `src/server/api/status.ts` — add `strategies` field, replace hardcoded mode arrays with `getRegisteredModeTypes()`
  - [x] Update `src/server/api/mode.ts` — replace hardcoded `modeEnum` and `urlModeToModeType()` with registry's `getModeTypeFromSlug()`
  - [x] Update `src/server/api/mode.ts` error messages to list available modes dynamically
  - [x] Update `unsupportedModeError()` in `src/server/lib/errors.ts` — make resolution message dynamic from registry
  - [x] Update `src/server/engine/fund-allocator.ts:150` — replace hardcoded `["volumeMax", "profitHunter", "arbitrage"]` in `loadFromDb()` with `getRegisteredModeTypes()`
- [x] Task 7: Update existing tests (AC: #1-6)
  - [x] Update `mode-runner.test.ts` for new abstract members
  - [x] Update `volume-max.test.ts` for new interface compliance
  - [x] Update `profit-hunter.test.ts` for new interface compliance
  - [x] Update `arbitrage.test.ts` for new interface compliance
  - [x] Update `index.test.ts` (engine) for registry-based startMode
- [x] Task 8: Write new tests (AC: #1-6)
  - [x] Unit test registry: register, duplicate rejection, lookup, getAvailableStrategies, getModeTypeFromSlug
  - [x] Unit test that all three strategies implement the extended interface correctly
  - [x] Integration test: engine startMode via registry path
  - [x] Test that `/api/status` includes strategies list
  - [x] Test that `/api/mode/:mode/*` routes work with registry-driven slug resolution

### Review Findings

- [x] [Review][Decision] `resolveMode()` accepts raw modeType strings bypassing slug-only routing — dismissed: intentional convenience for debugging/internal use, no real risk
- [x] [Review][Patch] ProfitHunter factory uses `oracleClient!` without explicit guard — fixed: added explicit null check with AppError [strategies/profit-hunter.ts]
- [x] [Review][Patch] `loadFromDb` LIKE query loads phantom/unregistered modes — fixed: filters against `getRegisteredModeTypes()` [fund-allocator.ts]
- [x] [Review][Patch] No Fastify schema validation on mode parameter — fixed: added `maxLength: 64` and `pattern: "^[a-zA-Z0-9-]+$"` [mode.ts]
- [x] [Review][Patch] Arbitrage factory throws plain `Error` instead of `AppError` — fixed: uses AppError with MISSING_DEPENDENCY code, also added oracleClient guard [strategies/arbitrage.ts]
- [x] [Review][Patch] `modeTypeToSlug` fallback asymmetry — skipped: minor, both deprecated functions removed in Story 6.2
- [x] [Review][Patch] Registry unit tests re-implement StrategyRegistry inline — fixed: exported class, tests now import real StrategyRegistry [strategy-registry.ts, strategy-registry.test.ts]
- [x] [Review][Defer] Race condition: runner added to modeRunners map after `start()` already fires run loop — **fixed**: set runner in map before `start()`, delete on failure [engine/index.ts]
- [x] [Review][Defer] `stopAllModes` doesn't acquire `modeLocks`, allowing concurrent start during shutdown — **fixed**: acquires modeLocks for all modes during shutdown [engine/index.ts]
- [x] [Review][Defer] `loadFromDb` doesn't handle malformed JSON in config rows — **fixed**: wrapped JSON.parse in try/catch with logger.warn [fund-allocator.ts]

## Dev Notes

### Current Architecture (What Exists)

**ModeRunner base class** (`src/server/engine/mode-runner.ts`):
- Abstract class with `executeIteration()` and `getIntervalMs()` abstract methods
- Constructor takes: `mode: ModeType`, `FundAllocator`, `PositionManager`, `BroadcastFn`
- Manages run loop, start/stop/forceStop lifecycle, error broadcasting
- No metadata (name, description) — only raw `mode: ModeType` identifier

**Strategy Constructor Signatures** (each is different — factory must handle this):
- `VolumeMaxStrategy(fundAllocator, positionManager, broadcast, config: Partial<VolumeMaxConfig> & { pairs: string[] })`
- `ProfitHunterStrategy(fundAllocator, positionManager, broadcast, oracleClient: OracleClient, config: Partial<ProfitHunterConfig> & { pairs: string[] })`
- `ArbitrageStrategy(fundAllocator, positionManager, broadcast, oracleClient: OracleClient, getMidPrice: (coin: string) => Promise<number>, config: Partial<ArbitrageConfig> & { pairs: string[] })`

The `StrategyDeps` type for factory functions must include:
```
{
  fundAllocator: FundAllocator;
  positionManager: PositionManager;
  broadcast: BroadcastFn;
  oracleClient?: OracleClient;       // required by profitHunter, arbitrage
  getMidPrice?: (coin: string) => Promise<number>;  // required by arbitrage only
  config: { pairs: string[]; slippage?: number; positionSize?: number };
}
```

**Engine registration** (`src/server/engine/index.ts`):
- Hardcoded switch-case (lines 125-152) instantiates strategies by `ModeType` string
- Oracle gate checks (lines 109-113): `if (mode === "profitHunter" || mode === "arbitrage")` — must become generic
- Blockchain gate check (lines 116-119): `if (mode === "arbitrage")` — must become generic
- Mode runners stored in `Map<ModeType, ModeRunner>`

**Hardcoded mode references across codebase** (all must become registry-driven in this story):
- `shared/types.ts:20` — `ModeType` union literal
- `shared/types.ts:93-111` — `MODE_URL_MAP` and `MODE_SLUG_MAP` dictionaries
- `src/server/engine/index.ts:125-152` — switch-case instantiation
- `src/server/engine/index.ts:109-119` — oracle/blockchain gate checks
- `src/server/engine/fund-allocator.ts:150` — `const modes: ModeType[] = ["volumeMax", "profitHunter", "arbitrage"]` in `loadFromDb()`
- `src/server/api/status.ts:60` — `const modes: ModeType[] = ["volumeMax", "profitHunter", "arbitrage"]` in `getStats()`
- `src/server/api/status.ts:97-100` — hardcoded modes object in status response
- `src/server/api/mode.ts` — hardcoded `modeEnum` array and inline "Use one of:" error messages
- `src/server/lib/errors.ts` — `unsupportedModeError()` hardcoded resolution: `"Supported modes: volumeMax, profitHunter, arbitrage."`

**Frontend hardcoded references** (NOT changed in this story — deferred to Story 6.2):
- `src/client/store/index.ts:10` — `VALID_MODES` set
- `src/client/store/index.ts:78-80` — hardcoded mode entries in store type
- `src/client/store/index.ts:133-135` — hardcoded defaults
- `src/client/App.tsx:17-19` — hardcoded `MODES` array with names/colors

### Design Decisions

**Registry Pattern: Self-Registration (not directory scanning)**
- Each strategy file exports a class AND calls `registerStrategy()` at module level
- Engine imports strategy files to trigger registration (avoids dynamic filesystem scanning)
- Rationale: TypeScript doesn't support filesystem-based auto-discovery cleanly; explicit imports are type-safe and bundle-friendly

**Strategy Factory with Dependency Declaration:**
- Each strategy registers a factory function: `(deps: StrategyDeps) => ModeRunner`
- Each registration declares `requires: { oracle?: boolean, blockchain?: boolean }`
- Engine checks `requires` generically instead of hardcoded `if (mode === "profitHunter" || ...)` checks
- Factory encapsulates dependency wiring — engine doesn't need to know strategy-specific deps

**ModeType Evolution:**
- Widen `ModeType` to `string` for extensibility
- Registry validates mode strings at runtime
- URL slug conversion becomes registry-driven: each strategy declares its `urlSlug`

**Scope Boundary — Story 6.1 vs 6.2:**
- Story 6.1: Backend only — registry, interface, engine refactor, API update
- Story 6.2: Frontend — dynamic ModeCards, store refactor, SummaryBar aggregation
- The frontend can remain hardcoded for now; 6.2 will make it dynamic

### Architecture Compliance

- **File naming:** `kebab-case` — `strategy-registry.ts`
- **Location:** `src/server/engine/strategy-registry.ts` (engine boundary owns strategy lifecycle)
- **No new dependencies:** Pure TypeScript, no runtime reflection or dynamic imports needed
- **Error handling:** Use `AppError` with appropriate error codes (e.g., `STRATEGY_NOT_FOUND`, `STRATEGY_ALREADY_REGISTERED`)
- **Testing:** Co-located `strategy-registry.test.ts` using Vitest
- **Type exports:** New types go in `shared/types.ts` for cross-boundary use

### Anti-Pattern Prevention

- **DO NOT** use `fs.readdir()` or dynamic filesystem scanning — use explicit imports
- **DO NOT** break existing strategy constructor signatures — add new abstract members alongside existing ones
- **DO NOT** change trade execution behavior — this is a pure structural refactor
- **DO NOT** modify frontend in this story — that's Story 6.2
- **DO NOT** use decorators or reflect-metadata — keep it simple with explicit registration
- **DO NOT** remove `ModeType` from shared types — evolve it to `string` with runtime validation
- **DO NOT** duplicate oracle/blockchain gate logic — use `requires` declaration from registration

### Existing Test Files (must be updated, not replaced)

| Test File | What Changes |
|-----------|-------------|
| `src/server/engine/mode-runner.test.ts` | Add tests for new abstract members, lifecycle hooks |
| `src/server/engine/strategies/volume-max.test.ts` | Update for new interface (strategyName, etc.) |
| `src/server/engine/strategies/profit-hunter.test.ts` | Update for new interface |
| `src/server/engine/strategies/arbitrage.test.ts` | Update for new interface |
| `src/server/engine/index.test.ts` | Update startMode tests for registry path |
| `src/server/engine/fund-allocator.test.ts` | May need update if loadFromDb changes |
| `src/server/engine/position-manager.test.ts` | No changes expected (mode-agnostic) |
| `src/server/engine/session-manager.test.ts` | No changes expected (stores mode as string) |

### Critical Code Locations

| File | Relevance |
|------|-----------|
| `src/server/engine/mode-runner.ts` | Base class to extend with metadata |
| `src/server/engine/index.ts` | Engine switch-case + oracle/blockchain gates to replace |
| `src/server/engine/strategies/volume-max.ts` | Strategy to refactor |
| `src/server/engine/strategies/profit-hunter.ts` | Strategy to refactor |
| `src/server/engine/strategies/arbitrage.ts` | Strategy to refactor |
| `src/shared/types.ts` | ModeType union + URL/slug maps to make dynamic |
| `src/server/api/status.ts` | Status endpoint — hardcoded mode arrays + add strategies list |
| `src/server/api/mode.ts` | Mode routing — hardcoded modeEnum + slug validation |
| `src/server/lib/errors.ts` | `unsupportedModeError()` hardcoded resolution message |
| `src/server/engine/fund-allocator.ts` | `loadFromDb()` hardcoded mode list (line 150) |

### Database Compatibility

All safe for ModeType widening — mode is stored as `text()` column in all tables:
- `trades.mode` — `text().notNull()`
- `positions.mode` — `text().notNull()`
- `sessions.mode` — `text().notNull()`
- `SessionManager` uses `as ModeType` assertion on DB reads — compatible with string
- `PositionManager` uses `Map<ModeType, ...>` and `Set<ModeType>` — compatible with string
- `FundAllocator` uses `Map<ModeType, ...>` — compatible, but `loadFromDb()` line 150 has hardcoded mode list that must be updated

### Previous Epic Intelligence

- All three strategies are stable and passing code review (Epics 2, 4)
- Kill-switch, graceful shutdown, and session tracking all depend on `ModeRunner` lifecycle — must not break
- `FundAllocator` and `PositionManager` are mode-agnostic — they work with `ModeType` strings, so widening to `string` is safe
- Session tracking in `SessionManager` stores mode as string column — compatible with new modes
- The `modeLocks` Set and `activeSessions` Map in engine/index.ts use `ModeType` — will work with string widening

### Git Intelligence

Recent commits show a pattern of:
- Feature implementation + code review fixes in single commits
- All strategies follow the same constructor pattern: `(fundAllocator, positionManager, broadcast, ...strategySpecificDeps, config)`
- Tests are co-located and use Vitest `describe/it` pattern
- No snapshot testing — assertion-based only

### Project Structure Notes

- Alignment: New file `strategy-registry.ts` goes in `src/server/engine/` alongside `mode-runner.ts` — both are engine core
- The strategies folder `src/server/engine/strategies/` already exists and is the natural home for plugins
- No conflicts with existing structure

### References

- [Source: _bmad-output/planning-artifacts/architecture.md — Extensibility section: FR34-FR35]
- [Source: _bmad-output/planning-artifacts/epics.md — Epic 6, Story 6.1]
- [Source: src/server/engine/mode-runner.ts — current base class]
- [Source: src/server/engine/index.ts — current hardcoded registration, lines 109-152]
- [Source: src/shared/types.ts:20 — ModeType union definition]
- [Source: src/server/api/mode.ts — hardcoded modeEnum and slug validation]
- [Source: src/server/lib/errors.ts — unsupportedModeError() hardcoded resolution]
- [Source: src/server/engine/fund-allocator.ts:150 — hardcoded mode list in loadFromDb()]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Implementation Plan
- Task 1: Widen ModeType to string, remove static maps, update StatusResponse
- Task 2: Add abstract plugin metadata to ModeRunner base class
- Task 3: Create strategy-registry.ts with registration/lookup
- Task 4: Refactor existing strategies with self-registration
- Task 5: Refactor engine/index.ts to use registry
- Task 6: Update API routes and error messages
- Task 7: Update existing tests
- Task 8: Write new tests

### Debug Log References

No debug issues encountered.

### Completion Notes List

- Widened `ModeType` from `"volumeMax" | "profitHunter" | "arbitrage"` union to `string` — all existing code compatible
- Added `StrategyInfo` type and `strategies` field to `StatusResponse`
- Extended `ModeRunner` with 5 abstract getters (`strategyName`, `strategyDescription`, `defaultConfig`, `modeColor`, `urlSlug`) and 2 lifecycle hooks (`onStart()`, `onStop()`)
- Created `strategy-registry.ts` with singleton `StrategyRegistry` class: `registerStrategy()`, `getRegistration()`, `getAvailableStrategies()`, `getModeTypeFromSlug()`, `getRegisteredModeTypes()`
- All three strategies implement new abstract members and self-register at module level with factory functions and `requires` declarations
- Engine `startMode()` replaced hardcoded switch-case with generic registry lookup + factory + `requires` checks
- `fund-allocator.ts` `loadFromDb()` now discovers modes dynamically via `LIKE 'allocation:%'` queries instead of hardcoded array
- API routes use registry for slug resolution and dynamic error messages
- `unsupportedModeError()` accepts optional `availableModes` parameter
- Kept `urlModeToModeType()` and `modeTypeToSlug()` in `shared/types.ts` with `@deprecated` tags for frontend compatibility (Story 6.2)
- 13 new tests added in `strategy-registry.test.ts`
- All 690 tests pass (677 existing + 13 new)

### Change Log

- 2026-04-07: Implemented Story 6.1 — Strategy Plugin Interface & Registration

### File List

New files:
- `src/server/engine/strategy-registry.ts` — Strategy registry singleton with registration, lookup, and metadata
- `src/server/engine/strategy-registry.test.ts` — 13 unit + integration tests for registry

Modified files:
- `src/shared/types.ts` — Widened `ModeType` to `string`, added `StrategyInfo` type, added `strategies` to `StatusResponse`, deprecated slug functions
- `src/server/engine/mode-runner.ts` — Added 5 abstract getters + 2 lifecycle hooks to `ModeRunner`
- `src/server/engine/mode-runner.test.ts` — Updated `TestModeRunner` with new abstract members
- `src/server/engine/index.ts` — Replaced hardcoded switch-case with registry-based startMode
- `src/server/engine/strategies/volume-max.ts` — Added abstract member implementations + self-registration
- `src/server/engine/strategies/profit-hunter.ts` — Added abstract member implementations + self-registration
- `src/server/engine/strategies/arbitrage.ts` — Added abstract member implementations + self-registration
- `src/server/engine/fund-allocator.ts` — Replaced hardcoded mode list in `loadFromDb()` with dynamic LIKE query
- `src/server/api/status.ts` — Registry-driven modes + strategies field in response
- `src/server/api/status.test.ts` — Added strategy registry mock
- `src/server/api/mode.ts` — Registry-driven slug resolution + dynamic error messages
- `src/server/api/mode.test.ts` — Added strategy registry mock + error handler registration
- `src/server/lib/errors.ts` — `unsupportedModeError()` accepts dynamic mode list
