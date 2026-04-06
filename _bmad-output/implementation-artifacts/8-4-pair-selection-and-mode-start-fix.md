# Story 8.4: Fix Pair Selection, Mode Start, and Store Sync

Status: done

## Story

As theRoad,
I want pair selection checkboxes to actually toggle and the selected pairs to be sent when starting a mode,
So that I can configure and start trading modes from the dashboard.

## Problem & Discovery

Three interconnected bugs prevent modes from being configured and started:

### Bug 1: Pair checkboxes don't stay checked
`handlePairToggle()` in `mode-card.tsx` (line 251-258) calls `api.updateModeConfig()` but **never updates the Zustand store**. The checkbox `checked` state reads from `pairs.includes(pair)` (store value), which never changes. Same pattern as the allocation bug fixed in 8-3.

### Bug 2: `startMode` doesn't send pairs or slippage
`api.startMode(mode)` in `api.ts` (line 62) sends an empty POST body. The server defaults to `["SOL/USDC"]`. The user's selected pairs are never sent.

### Bug 3: Status API returns empty pairs, overwriting defaults
`status.ts` always returns `pairs: []` (lines 12, 29). On page load, `loadInitialStatus()` overwrites the client default `["SOL/USDC"]` with `[]`, causing "Select pairs..." to show with nothing selected.

### Pair origin context
Available pairs are hardcoded in `mode-card.tsx` line 20: `["SOL/USDC", "ETH/USDC", "BTC/USDC"]`. Not loaded from Hyperliquid or Valiant. Pyth oracle feeds use `SOL-PERP` format (`src/shared/types.ts` lines 129-133) — only relevant for ProfitHunter's oracle lookups. VolumeMax contracts handle `SOL/USDC` fine by splitting on `/`.

## Acceptance Criteria

1. **Given** the pair dropdown is open, **When** the user clicks a pair checkbox, **Then** the checkbox toggles and stays checked/unchecked.
2. **Given** pairs are selected in the UI, **When** the user toggles the mode ON, **Then** the selected pairs and slippage are sent to the server's start endpoint.
3. **Given** the dashboard loads, **Then** pairs are pre-selected (default: `["SOL/USDC"]`) instead of showing empty "Select pairs...".
4. **Given** ProfitHunter is started with pairs like `"SOL/USDC"`, **Then** the strategy correctly maps to `"SOL-PERP"` for oracle lookups.
5. **Given** pair selection API call fails, **Then** the UI rolls back to the previous selection.

## Tasks / Subtasks

- [x] Task 1: Fix pair selection store sync (AC: 1, 5)
  - [x] 1.1 In `src/client/components/mode-card.tsx` `handlePairToggle()`, add optimistic `setModeConfig(mode, { pairs: newPairs })` before API call
  - [x] 1.2 Add rollback `setModeConfig(mode, { pairs: prevPairs })` on API failure
  - [x] 1.3 `setModeConfig` already imported from 8-3 fix — verified available

- [x] Task 2: Send pairs + slippage on startMode (AC: 2)
  - [x] 2.1 In `src/client/lib/api.ts`, changed `startMode` to accept optional `{ pairs?, slippage? }` and send as JSON body
  - [x] 2.2 In `src/client/components/mode-card.tsx` `handleToggle()`, changed to `api.startMode(mode, { pairs, slippage })`

- [x] Task 3: Return default pairs from status API (AC: 3)
  - [x] 3.1 In `src/server/api/status.ts`, changed `pairs: []` to `pairs: ["SOL/USDC"]` in both functions

- [x] Task 4: Map pair format for ProfitHunter oracle (AC: 4)
  - [x] 4.1 In `src/server/engine/strategies/profit-hunter.ts`, added `private pairToOracleKey(pair)` converting `"SOL/USDC"` → `"SOL-PERP"`
  - [x] 4.2 Used `pairToOracleKey()` in `executeIteration()` for all oracle calls (both close-signal and open-signal paths)

- [x] Task 5: Verification (AC: all)
  - [x] 5.1 TypeScript compile check: `npx tsc --noEmit` — clean
  - [x] 5.2 Full test suite: `pnpm test` — 519 passed, 1 pre-existing failure (resetKillSwitch)
  - [ ] 5.3 Manual test: reload → pairs pre-selected → click checkboxes → they toggle → allocate → toggle ON → stays running

### Review Findings

- [x] [Review][Decision] #2 Rapid pair toggles cause rollback race condition — resolved: added `pairTogglingRef` guard to `handlePairToggle` [mode-card.tsx:254-264]
- [x] [Review][Decision] #7 Server `getModeConfig` hardcodes `pairs: ["SOL/USDC"]` — dismissed: by-design per spec "no pair persistence", no active data-loss path [status.ts:12,29]
- [x] [Review][Patch] #1 `handleToggle` useCallback missing `pairs`/`slippage` deps — fixed: added `pairs` and `slippage` to dependency array [mode-card.tsx:183]
- [x] [Review][Patch] #4 No test for pair rollback on API failure (AC 5) — fixed: added "rolls back pair selection on API failure" test [mode-card.test.tsx]
- [x] [Review][Patch] #5 `startMode` test doesn't assert `slippage` is passed (AC 2) — fixed: updated assertion to include `slippage: expect.any(Number)` [mode-card.test.tsx:125]
- [x] [Review][Patch] #6 No test for `pairToOracleKey` mapping correctness (AC 4) — fixed: added "oracle key mapping" describe block with 2 tests [profit-hunter.test.ts]
- [x] [Review][Patch] #10 No test for checkbox toggle state persistence after click (AC 1) — fixed: added "checkbox stays checked after toggling a pair" test [mode-card.test.tsx]
- [x] [Review][Defer→Fixed] #3 `pairToOracleKey` silently handles malformed pair strings — resolved: added validation guard with logger.warn [profit-hunter.ts:200]
- [x] [Review][Defer→Fixed] #8 No server-side allowlist validation for `pairs` — resolved: added `enum: VALID_PAIRS` to both endpoints [mode.ts:26,75]
- [x] [Review][Defer→Fixed] #9 `catch` block on pair update swallows error silently — resolved: added toast.warning on rollback [mode-card.tsx:265]

## Dev Notes

### Key Files

- `src/client/components/mode-card.tsx` — `handlePairToggle()` (line 251-258), `handleToggle()` (line 162), `AVAILABLE_PAIRS` (line 20)
- `src/client/lib/api.ts` — `startMode()` (line 59-72), sends empty POST body
- `src/server/api/status.ts` — `getModeConfig()` returns `pairs: []` (lines 12, 29)
- `src/server/api/mode.ts` — start endpoint defaults `pairs` to `["SOL/USDC"]` (line 40)
- `src/server/engine/strategies/profit-hunter.ts` — `executeIteration()` calls oracle with pair directly
- `src/shared/types.ts` — `PYTH_FEED_IDS` uses `"SOL-PERP"` format (line 129-133)

### Existing Patterns to Reuse

- `setModeConfig()` — already imported in mode-card.tsx (from 8-3 fix)
- Optimistic update + rollback pattern — already used in `handleAllocationCommit()` (from 8-3 fix)
- `pair.split("/")[0]` — used in `contracts.ts` `resolveAsset()` to extract coin name

### What NOT To Build

- No new API endpoints
- No new store actions — reuse `setModeConfig`
- No pair persistence on server — pairs are client-side config, sent on each startMode call
- No changes to `AVAILABLE_PAIRS` constant — keep `SOL/USDC` format for UI consistency

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

- TypeScript compile check: clean
- Test suite: 519 passed, 1 pre-existing failure (resetKillSwitch)
- Updated 3 test files to match new behavior: api.test.ts, mode-card.test.tsx, status.test.ts

### Completion Notes List

- Pair checkboxes now toggle via optimistic store update with rollback
- `startMode` API sends `{ pairs, slippage }` in JSON body instead of empty POST
- Status API returns `pairs: ["SOL/USDC"]` default so UI loads with pairs pre-selected
- ProfitHunter maps `"SOL/USDC"` → `"SOL-PERP"` for oracle lookups via `pairToOracleKey()`

### File List

- `src/client/components/mode-card.tsx` (modified — optimistic pair toggle + send pairs on start)
- `src/client/components/mode-card.test.tsx` (modified — updated startMode assertion)
- `src/client/lib/api.ts` (modified — startMode accepts config param)
- `src/client/lib/api.test.ts` (modified — updated startMode test assertions)
- `src/server/api/status.ts` (modified — default pairs `["SOL/USDC"]`)
- `src/server/api/status.test.ts` (modified — updated pairs assertion)
- `src/server/engine/strategies/profit-hunter.ts` (modified — added pairToOracleKey for oracle lookups)

### Change Log

- 2026-04-06: Implemented Story 8-4 — pair selection, mode start, and oracle key mapping fixes
