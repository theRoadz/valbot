# Story 8.6: Configurable Position Size & Max Allocation Limit

Status: done

## Story

As theRoad,
I want to configure the position size per mode and the max allocation limit,
So that I can control how much each trade uses instead of the hardcoded allocation/20 default, and raise the allocation cap beyond 500 USDC.

## Problem & Discovery

Position size is hardcoded as `allocation / 20` in both VolumeMax (line 48) and ProfitHunter (line 78) strategies. Max allocation is hardcoded at 500 USDC (`MAX_SINGLE_ALLOCATION = 500_000_000` in fund-allocator.ts line 46). Neither is configurable from the UI or API.

**Example:** User allocates $500, expects larger trades, but every position is $25 (`500/20`). No way to change this without code edits.

## Acceptance Criteria

1. **Given** the mode card UI, **When** the user enters a position size value (e.g., $50), **Then** that value is persisted and used as the trade size on next mode start.
2. **Given** no position size is set (or cleared), **Then** the strategy defaults to `allocation / 20`.
3. **Given** the mode card UI, **When** the user enters a max allocation value (e.g., $1000), **Then** the allocation input accepts values up to that limit.
4. **Given** position size is set to a value > current allocation, **Then** the API rejects with a validation error.
5. **Given** position size is set to a value < $10, **Then** the API rejects (Hyperliquid minimum).
6. **Given** any client sets these configs, **Then** they are persisted to DB and survive restarts.

## Tasks / Subtasks

- [x] Task 1: Shared Types — `src/shared/types.ts` (AC: all)
  - [x] 1.1 Add `positionSize?: number` to `ModeConfig` interface
  - [x] 1.2 Add `maxAllocation?: number` to `ModeConfig` interface

- [x] Task 2: Fund Allocator — `src/server/engine/fund-allocator.ts` (AC: 1, 2, 4, 5, 6)
  - [x] 2.1 Replace hardcoded `MAX_SINGLE_ALLOCATION` constant with instance field `private maxAllocation`
  - [x] 2.2 Add `getMaxAllocation()` / `setMaxAllocation(amount)` with DB persistence (key: `"maxAllocation"`)
  - [x] 2.3 Add `getPositionSize(mode)` / `setPositionSize(mode, amount)` / `clearPositionSize(mode)` with DB persistence (key: `"positionSize:{mode}"`)
  - [x] 2.4 Update `loadFromDb()` to restore maxAllocation and positionSize entries
  - [x] 2.5 Update `setAllocation()` to use `this.maxAllocation` instead of constant
  - [x] 2.6 Write tests for all new methods in `fund-allocator.test.ts`

- [x] Task 3: Engine — `src/server/engine/index.ts` (AC: 1, 2)
  - [x] 3.1 Read stored positionSize from fundAllocator before constructing strategies
  - [x] 3.2 Pass positionSize to VolumeMaxStrategy and ProfitHunterStrategy constructors

- [x] Task 4: API — `src/server/api/mode.ts` (AC: 1, 2, 3, 4, 5)
  - [x] 4.1 Add `positionSize` (nullable) and `maxAllocation` to PUT config schema
  - [x] 4.2 Remove static `maximum: 500` on allocation; validate dynamically
  - [x] 4.3 Add handler logic for positionSize (set/clear) and maxAllocation
  - [x] 4.4 Write tests in `mode.test.ts`

- [x] Task 5: Status API — `src/server/api/status.ts` (AC: 6)
  - [x] 5.1 Include `positionSize` and `maxAllocation` in `getModeConfig()` response

- [x] Task 6: Client API — `src/client/lib/api.ts` (AC: all)
  - [x] 6.1 Add `positionSize` and `maxAllocation` to `updateModeConfig` params

- [x] Task 7: Client Store — `src/client/store/index.ts` (AC: all)
  - [x] 7.1 Update `createDefaultMode` to include new fields
  - [x] 7.2 Ensure `setModeConfig` and `loadInitialStatus` handle new fields (works via ModeConfig spread)

- [x] Task 8: Mode Card UI — `src/client/components/mode-card.tsx` (AC: 1, 2, 3)
  - [x] 8.1 Add position size input with Auto placeholder
  - [x] 8.2 Add max allocation editable field near allocation input
  - [x] 8.3 Both use optimistic update with rollback pattern

- [x] Task 9: Verification (AC: all)
  - [x] 9.1 TypeScript compile check: `npx tsc --noEmit` — clean
  - [x] 9.2 Full test suite: `pnpm test` — 547 passed, 1 pre-existing failure (resetKillSwitch)
  - [ ] 9.3 Manual test: set position size → mode uses it

## Dev Notes

### Key Files

- `src/shared/types.ts` — ModeConfig interface (line 69)
- `src/server/engine/fund-allocator.ts` — MAX_SINGLE_ALLOCATION (line 46), loadFromDb (line 130)
- `src/server/engine/index.ts` — startMode (line 68), strategy construction (lines 89-106)
- `src/server/api/mode.ts` — PUT config schema (lines 70-77), handler (lines 80-117)
- `src/server/api/status.ts` — getModeConfig (line 18)
- `src/client/lib/api.ts` — updateModeConfig (line 98)
- `src/client/store/index.ts` — createDefaultMode (line 48), setModeConfig (line 157)
- `src/client/components/mode-card.tsx` — allocation input (lines 360-374), slippage input (lines 415-428)

### Existing Patterns to Reuse

- Config DB key-value pattern: `allocation:{mode}` → `{ amount: number }` in fund-allocator.ts
- Optimistic update + rollback pattern in mode-card.tsx `handleAllocationCommit()`
- `assertSafeInteger()` from db/schema.ts for validation
- `fromSmallestUnit()` / `toSmallestUnit()` for unit conversion

### What NOT To Build

- No new API endpoints — reuse `PUT /api/mode/:mode/config`
- No new WebSocket events
- No new store actions — reuse `setModeConfig`
- No new files except this story

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Completion Notes List

- Shared types: Added `positionSize?` and `maxAllocation?` to `ModeConfig`
- Fund allocator: Replaced hardcoded 500 USDC cap with configurable `maxAllocation` instance field; added `positionSize` per-mode storage with DB persistence
- Engine: Reads stored positionSize and passes to strategy constructors
- API: Accepts `positionSize` (nullable) and `maxAllocation` in PUT config; validates allocation dynamically against current max
- Status API: Includes `positionSize` and `maxAllocation` in mode config response
- Client: Updated API types, store defaults, mode card UI with position size input, and global max allocation control above mode cards
- Tests: 18 new tests across fund-allocator.test.ts and mode.test.ts

### File List

- `src/shared/types.ts` (modified — added positionSize and maxAllocation to ModeConfig)
- `src/server/engine/fund-allocator.ts` (modified — configurable max allocation, position size CRUD, loadFromDb with validation, positionSize cascade clear on allocation reduction)
- `src/server/engine/fund-allocator.test.ts` (modified — 13 new tests for maxAllocation and positionSize)
- `src/server/engine/index.ts` (modified — pass stored positionSize to strategy constructors)
- `src/server/api/mode.ts` (modified — positionSize and maxAllocation in PUT config schema + handler, ENGINE_NOT_READY error)
- `src/server/api/mode.test.ts` (modified — 5 new tests for positionSize and maxAllocation; updated mock)
- `src/server/api/status.ts` (modified — include positionSize and maxAllocation in response)
- `src/server/api/status.test.ts` (modified — updated mock and expected response for new fields)
- `src/client/lib/api.ts` (modified — updated updateModeConfig param type)
- `src/client/store/index.ts` (modified — maxAllocation in createDefaultMode)
- `src/client/components/mode-card.tsx` (modified — position size input, removed per-mode max allocation input)
- `src/client/components/max-allocation-control.tsx` (new — global max allocation control component)
- `src/client/App.tsx` (modified — added MaxAllocationControl above mode cards row)

### Review Findings

- [x] [Review][Decision] `maxAllocation` is global but UI presents it per-mode — resolved: removed per-mode input from mode cards, added global MaxAllocationControl component above mode cards row in App.tsx
- [x] [Review][Patch] `setMaxAllocation` reverts to hardcoded $500 default on DB failure instead of previous value — fixed: captures `prev` before mutation
- [x] [Review][Patch] Reducing allocation below stored `positionSize` creates silent inconsistency — fixed: `setAllocation` now clears positionSize when it exceeds new allocation
- [x] [Review][Patch] No `maximum` on `positionSize` in JSON schema — fixed: added `maximum: 10000` to schema
- [x] [Review][Patch] Engine-not-initialized silently swallows config and returns 200 without persisting — fixed: now throws ENGINE_NOT_READY AppError so client sees the failure
- [x] [Review][Patch] Double validation of allocation in API handler vs `setAllocation` — fixed: removed redundant API-layer check, `setAllocation` is authoritative
- [x] [Review][Patch] `loadFromDb` does not validate JSON shape — fixed: added type/finite/safeInteger guards on all parsed amounts
- [x] [Review][Defer] `positionSize` updated while strategy is running not reflected until restart [engine/index.ts:88] — deferred, pre-existing pattern (strategies snapshot config at construction)

### Change Log

- 2026-04-06: Story created
- 2026-04-06: Implemented all tasks — position size and max allocation configurable via UI and API
- 2026-04-06: Code review complete — 1 decision-needed, 6 patches, 1 deferred, 4 dismissed
- 2026-04-06: Code review patches applied — all 7 fixed
- 2026-04-06: Moved Max Allocation to global control above mode cards (new component + App.tsx update)
