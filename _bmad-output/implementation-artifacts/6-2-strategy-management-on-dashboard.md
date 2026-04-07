# Story 6.2: Strategy Management on Dashboard

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As theRoad,
I want to see all available trading strategies on the dashboard and have their ModeCards render dynamically,
So that when new strategies are added, they appear automatically without dashboard code changes.

## Acceptance Criteria

1. **Given** the strategy registry has registered strategies, **When** the dashboard loads, **Then** the mode cards row renders a ModeCard for each registered strategy (not hardcoded to three).
2. **Given** the strategy registry has registered strategies, **When** the dashboard loads, **Then** each strategy's ModeCard shows its name, description, status, and controls.
3. **Given** N strategies are registered, **When** the dashboard renders the mode cards row, **Then** the grid layout adapts: `repeat(N, 1fr)` columns where N is the number of strategies (min 1, max accommodated by the layout).
4. **Given** a new strategy is added to the backend, **When** the user restarts the bot, **Then** it appears on the dashboard without frontend code changes.
5. **Given** the strategy registry provides `modeColor` for each strategy, **When** a ModeCard renders, **Then** each strategy's mode identity color comes from the registry (not CSS variables or hardcoded values).
6. **Given** the SummaryBar (top-bar) aggregates stats, **When** strategies are registered dynamically, **Then** the SummaryBar aggregates stats across all registered and active strategies dynamically (not hardcoded to three modes).

## Tasks / Subtasks

- [x] Task 1: Store strategies from StatusResponse in Zustand store (AC: #1, #4, #6)
  - [x] Add `strategies: StrategyInfo[]` field to `ValBotStore` interface
  - [x] Change `modes` type from `{ volumeMax: ModeStoreEntry; profitHunter: ModeStoreEntry; arbitrage: ModeStoreEntry }` to `Record<ModeType, ModeStoreEntry>`
  - [x] Initialize store with `modes: {}` (empty) and `strategies: []`
  - [x] Remove the module-level `VALID_MODES` hardcoded `Set`. Replace with a store-derived check: `state.modes[mode] !== undefined`
  - [x] **CRITICAL — Rewrite `loadInitialStatus()` merge logic (see Store Initialization Flow below)**
  - [x] **CRITICAL — Fix WebSocket event handler race condition**: Replace `VALID_MODES.has(data.mode)` with `state.modes[data.mode] !== undefined`
  - [x] **Add null guards**: Added `if (!state.modes[mode]) return state;` to setModeStatus, updateModeStats, setModeConfig, and WS handlers
  - [x] Update `aggregateSummaryStats()` — verified: already uses `Object.values(modes)`, no regression
  - [x] Update `isValidStatusResponse()` in `src/client/lib/api.ts` — added `Array.isArray(d.strategies)` check

- [x] Task 2: Replace hardcoded MODES array in App.tsx (AC: #1, #2, #5)
  - [x] Remove the static `MODES` array (lines 16-20)
  - [x] Read `strategies` from store state
  - [x] Map `StrategyInfo` → ModeCard props: `{ mode: s.modeType, name: s.name, color: s.modeColor, barColor: s.modeColor }`
  - [x] Render ModeCards from dynamic strategies list

- [x] Task 3: Make grid layout dynamic (AC: #3)
  - [x] Update mode cards container grid: `gridTemplateColumns: repeat(N, minmax(0, 1fr))` where N = strategies.length
  - [x] Ensure layout gracefully handles 1 strategy (full width) through 5+ strategies (narrower cards)

- [x] Task 4: Replace hardcoded MODE_TAGS in trade-log, positions-table, trade-history-table (AC: #2, #5)
  - [x] Create `src/client/lib/mode-utils.ts` with `getModeTag()` utility
  - [x] Replace `MODE_TAGS` in `src/client/components/trade-log.tsx` — trade-log adds brackets in render
  - [x] Replace `MODE_TAGS` in `src/client/components/positions-table.tsx`
  - [x] Replace `MODE_TAGS` in `src/client/components/trade-history-table.tsx`

- [x] Task 5: Update max-allocation-control.tsx (AC: #4, #6)
  - [x] **Fix hardcoded store selector**: replaced with `Object.values(s.modes)[0]?.maxAllocation ?? 500`
  - [x] Replace hardcoded mode loop with dynamic `Object.keys(useStore.getState().modes)` iteration

- [x] Task 6: Remove deprecated functions and cleanup shared/types.ts (AC: #4)
  - [x] Remove `MODE_URL_MAP` and `MODE_SLUG_MAP` dictionaries from `src/shared/types.ts`
  - [x] Remove deprecated `urlModeToModeType()` function
  - [x] Remove deprecated `modeTypeToSlug()` function
  - [x] Update `src/client/lib/api.ts` — replaced `modeTypeToSlug(mode)` with `${mode}` directly (API's `resolveMode()` accepts modeType strings)

- [x] Task 7: Handle dynamic CSS colors for new strategies (AC: #5)
  - [x] **Update ModeCard component**: Changed `className={color}` to `style={{ color }}` for inline hex color rendering
  - [x] Replace all Tailwind mode color classes with `style={{ color: strategy.modeColor }}` in all touched components
  - [x] Keep CSS custom properties in `src/client/index.css` for backward compatibility

- [x] Task 8: Update existing tests (AC: #1-6)
  - [x] Update `src/client/store/index.test.ts` — added `TEST_STRATEGIES` constant, added strategies to all `loadInitialStatus` calls and `beforeEach`
  - [x] Update `src/client/components/mode-card.test.tsx` — updated color props from Tailwind to hex, strategies in store reset
  - [x] Update `src/client/components/trade-log.test.tsx` — strategies in store, inline color assertions
  - [x] Update `src/client/components/positions-table.test.tsx` — strategies in store, inline color assertions
  - [x] Update `src/client/components/trade-history-table.test.tsx` — strategies in store, inline color assertions
  - [x] Note: max-allocation-control.test.tsx did not exist previously, no update needed

- [x] Task 9: Write new tests (AC: #1-6)
  - [x] Test that store populates `strategies` from StatusResponse (store test: "dynamic strategy support")
  - [x] Test that adding a 4th strategy to StatusResponse results in a 4th ModeCard rendering (app test: "renders a 4th mode card")
  - [x] Test that mode tags fall back gracefully for unknown modes (mode-utils.test.ts)
  - [x] Test grid layout adapts to different strategy counts (app test: "grid layout adapts" + "grid adapts to 1 strategy")

## Dev Notes

### What Story 6.1 Already Provides (Backend — DO NOT MODIFY)

The strategy registry (`src/server/engine/strategy-registry.ts`) is fully implemented. The `GET /api/status` endpoint already returns `strategies: StrategyInfo[]` in its response. The `StrategyInfo` type is already defined in `src/shared/types.ts`:

```typescript
export interface StrategyInfo {
  name: string;
  description: string;
  modeType: ModeType;   // e.g., "volumeMax"
  urlSlug: string;       // e.g., "volume-max"
  modeColor: string;     // e.g., "#8b5cf6"
  status: ModeStatus;
}
```

The API mode endpoint (`src/server/api/mode.ts`) already accepts both modeType strings and URL slugs via `resolveMode()` — no backend changes needed.

### Store Initialization Flow (CRITICAL — Read Carefully)

**Current flow (broken for dynamic modes):**
1. Store initializes with hardcoded `modes: { volumeMax: ..., profitHunter: ..., arbitrage: ... }`
2. `loadInitialStatus()` fetches `/api/status`, then filters incoming `data.modes` against pre-existing store keys via `const validModes = new Set(Object.keys(modes))`

**New flow:**
```
// In loadInitialStatus(data):
1. Set state.strategies = data.strategies
2. Create empty modes object
3. For each strategy in data.strategies:
     modes[s.modeType] = createDefaultMode(s.modeType)
4. For each [key, cfg] in Object.entries(data.modes):
     if modes[key] exists: merge cfg into modes[key]
5. Set state.modes = modes
```

**Why the current merge logic breaks:** The existing code at ~line 217 does `const validModes = new Set(Object.keys(state.modes))` to decide which incoming modes to accept. If `state.modes` starts empty, `validModes` is empty, and ALL server mode data is rejected. The fix: derive valid keys from `data.strategies` (step 3), not from pre-existing store state.

**WebSocket race condition:** WS events may arrive before `loadInitialStatus()` completes. With `modes: {}` initially and `VALID_MODES` removed, use `state.modes[data.mode] !== undefined` as the sole guard in all WS handlers. Events for modes not yet loaded are safely rejected (the mode entry doesn't exist yet) and will be correct once `loadInitialStatus()` populates the modes.

### CSS Color Strategy

Replace all Tailwind mode color classes (`text-mode-volume`, etc.) with `style={{ color: strategy.modeColor }}`. Keep CSS custom properties in `src/client/index.css` for backward compatibility but don't require them for rendering. Tailwind cannot generate classes for runtime hex values.

### Files Confirmed NOT Needing Changes

| File | Why No Changes |
|------|---------------|
| `src/client/components/top-bar.tsx` | Reads from `useStore((s) => s.stats)` which is computed by `aggregateSummaryStats()` using `Object.values(modes)` — already dynamic |
| All backend files | Story 6.1 completed all backend work; this story is frontend-only |

### Grid Layout

Use inline style for dynamic grid columns (Tailwind can't generate dynamic counts at runtime):
```tsx
<div style={{ display: 'grid', gridTemplateColumns: `repeat(${strategies.length}, minmax(0, 1fr))`, gap: '1rem' }}>
```
Consider `repeat(auto-fill, minmax(300px, 1fr))` if 6+ strategies need graceful wrapping, but `repeat(N, ...)` matches the UX spec's explicit `repeat(N, 1fr)` requirement.

### API Call Migration

`src/client/lib/api.ts` uses `modeTypeToSlug(mode)` at lines 2, 65, 85, 104. Replace with the mode type string directly — the API's `resolveMode()` already accepts both slugs and camelCase modeType strings (confirmed in Story 6.1: `resolveMode()` tries slug lookup first, then falls back to raw modeType). Safe for all current mode types.

### Anti-Pattern Prevention

- **DO NOT** modify any backend files — this story is frontend-only
- **DO NOT** create hardcoded arrays of strategies anywhere in the frontend
- **DO NOT** use Tailwind dynamic class generation (e.g., `text-[${color}]`) — Tailwind can't handle runtime values; use inline styles
- **DO NOT** break the existing 3-strategy experience — the dynamic approach must produce identical output for the current 3 strategies
- **DO NOT** remove CSS custom properties (`--mode-volume`, etc.) in `index.css` — keep for backward compatibility
- **DO NOT** change ModeCard's state management, toggle logic, or input handling — only change how it renders the `color` prop (from Tailwind class → inline style) and how it receives its props from App.tsx

### Previous Story Intelligence

From Story 6.1 code review:
- `resolveMode()` in mode.ts accepts raw modeType strings bypassing slug-only routing — useful for API calls
- Registry exported class `StrategyRegistry` for testability
- `loadFromDb` now uses dynamic LIKE queries instead of hardcoded arrays — the pattern to follow
- `unsupportedModeError()` now accepts optional `availableModes` parameter
- The `@deprecated` tags on `urlModeToModeType()` and `modeTypeToSlug()` in shared/types.ts were explicitly left for this story to clean up
- Review noted: `modeTypeToSlug` fallback asymmetry — "skipped: minor, both deprecated functions removed in Story 6.2"

### Git Intelligence

Recent commits follow pattern: `feat: <description> with code review fixes (Story X-Y)`. All tests use Vitest `describe/it` pattern. React components use functional style with hooks. Store uses Zustand with `create()`.

### Existing Test Files (must be updated, not replaced)

| Test File | What Changes |
|-----------|-------------|
| `src/client/store/index.test.ts` | Dynamic mode initialization, strategies field |
| `src/client/components/mode-card.test.tsx` | MODES array references, dynamic rendering |
| `src/client/components/trade-log.test.tsx` | MODE_TAGS replacement |
| `src/client/components/positions-table.test.tsx` | MODE_TAGS replacement |
| `src/client/components/trade-history-table.test.tsx` | MODE_TAGS replacement |
| `src/client/components/max-allocation-control.test.tsx` | Dynamic mode iteration |

### Project Structure Notes

- New file: `src/client/lib/mode-utils.ts` — shared utility for dynamic mode tag generation
- All other changes are modifications to existing files
- No new dependencies needed — pure refactor using existing `StrategyInfo` type from shared/types.ts

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 6, Story 6.2]
- [Source: _bmad-output/planning-artifacts/architecture.md — Extensibility section: FR34-FR35]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — ModeCard anatomy, lines 575-608]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — Grid layout, lines 349-354]
- [Source: _bmad-output/implementation-artifacts/6-1-strategy-plugin-interface-and-registration.md — Previous story context]
- [Source: src/shared/types.ts — StrategyInfo type, StatusResponse, deprecated functions]
- [Source: src/server/engine/strategy-registry.ts — Registry API shape]
- [Source: src/client/store/index.ts — Current hardcoded store shape]
- [Source: src/client/App.tsx — Current hardcoded MODES array]
- [Source: src/client/lib/api.ts — modeTypeToSlug usage]
- [Source: src/client/index.css — CSS custom properties for mode colors]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

None — clean implementation with no blocking issues.

### Completion Notes List

- Refactored entire frontend from hardcoded 3-mode architecture to dynamic strategy-driven rendering
- Store `modes` changed from fixed object to `Record<ModeType, ModeStoreEntry>`, populated from `strategies` on initial status load
- Removed `VALID_MODES` Set — WS events now use `state.modes[mode] !== undefined` for validation
- Added null guards to all store actions that access modes by key
- `loadInitialStatus()` rewritten to derive valid modes from `data.strategies`, not from pre-existing store state
- Created `getModeTag()` utility for dynamic mode tag generation — replaces 3 separate hardcoded `MODE_TAGS` objects
- All mode colors now use inline `style={{ color }}` instead of Tailwind classes — enables runtime hex values from registry
- ModeCard grid uses inline `repeat(N, minmax(0, 1fr))` for dynamic column count
- Removed deprecated `modeTypeToSlug()`, `urlModeToModeType()`, `MODE_URL_MAP`, `MODE_SLUG_MAP` from shared/types.ts
- API calls now use modeType directly in URLs — backend `resolveMode()` already accepts both formats
- All 696 tests pass (13 new tests added), TypeScript compiles cleanly

### Review Findings

- [x] [Review][Decision→Patch] AC-2: ModeCard does not receive `description` prop — resolved: added `description` prop to ModeCardProps, passed from App.tsx, rendered below header
- [x] [Review][Patch] ModeCard crashes when `modes[mode]` is undefined during initial render [src/client/components/mode-card.tsx:127] — fixed: added `if (!modeState) return null` early-return
- [x] [Review][Patch] MaxAllocationControl hardcoded "volumeMax" fallback when modes is empty [src/client/components/max-allocation-control.tsx:35] — fixed: added `if (modeKeys.length === 0) return` guard, removed fallback
- [x] [Review][Patch] `isValidPosition` accepts any non-empty string as mode [src/client/store/index.ts:237] — fixed: added `modes[mode] !== undefined` cross-check in loadInitialStatus filter
- [x] [Review][Patch] Unsanitized ModeType strings in API URL paths [src/client/lib/api.ts:64,84,103] — fixed: added `encodeURIComponent(mode)` to all URL interpolations
- [x] [Review][Patch] WS events silently dropped before `loadInitialStatus` completes [src/client/hooks/use-websocket.ts] — fixed: added `initialized` store flag; WS hook defers connection until after initial status load
- [x] [Review][Defer] No WS event for runtime strategy registration [src/client/store/index.ts] — deferred, requires new server-side WS event (feature, not bug)

### Change Log

- 2026-04-07: Story 6.2 implementation — Dynamic strategy management on dashboard

### File List

**New:**
- src/client/lib/mode-utils.ts
- src/client/lib/mode-utils.test.ts

**Modified:**
- src/client/store/index.ts
- src/client/store/index.test.ts
- src/client/App.tsx
- src/client/app.test.tsx
- src/client/lib/api.ts
- src/client/lib/api.test.ts
- src/client/components/mode-card.tsx
- src/client/components/mode-card.test.tsx
- src/client/components/trade-log.tsx
- src/client/components/trade-log.test.tsx
- src/client/components/positions-table.tsx
- src/client/components/positions-table.test.tsx
- src/client/components/trade-history-table.tsx
- src/client/components/trade-history-table.test.tsx
- src/client/components/max-allocation-control.tsx
- src/shared/types.ts
- src/shared/types.test.ts
