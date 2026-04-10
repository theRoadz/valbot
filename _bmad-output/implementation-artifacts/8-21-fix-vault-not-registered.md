# Story 8.21: Fix "Vault not registered" Error on Order Placement

Status: done

## Story

As theRoad,
I want orders to be placed directly from my wallet without specifying a vault address,
So that VolumeMax (and all other modes) can trade without the "Vault not registered" error.

## Problem

All order placement calls (`openPosition`, `closePosition`, `setStopLoss`) pass `client.walletAddress` as `vaultAddress` to the Hyperliquid SDK. The master wallet is NOT a registered Hyperliquid vault, so the API rejects every order with `"Vault not registered: 0x..."`.

### Root Cause

- `position-manager.ts` unconditionally passes `vaultAddress: client.walletAddress` in all 7 contract call sites
- The Hyperliquid SDK's `vaultAddress` in `OrderOptions` is **optional** — it's only needed when trading on behalf of a registered vault sub-account
- Commit `b9a29a5` moved `vaultAddress` from inside `OrderParameters` (where the SDK ignored it) to `OrderOptions` (where the SDK sends it to Hyperliquid), exposing the bug

### Real-world incident (2026-04-10)

VolumeMax mode fails immediately on every order attempt with `ApiRequestError: Vault not registered: 0x8edbf62e500f3a032c4da0032c6dbbad271b4bca`. Both Long and Short legs fail, making the mode completely non-functional.

## Background

### Current flow (broken)

1. Mode calls `positionManager.openPosition()`
2. `openPosition` passes `vaultAddress: client.walletAddress` to `contractOpenPosition()`
3. `contracts.ts` passes `{ vaultAddress }` as `OrderOptions` to `exchange.order()`
4. SDK sends wallet address as vault address to Hyperliquid API
5. Hyperliquid rejects: "Vault not registered"

### Correct flow

1. Mode calls `positionManager.openPosition()`
2. `openPosition` does NOT pass `vaultAddress` (omitted)
3. `contracts.ts` passes `{ vaultAddress: undefined }` as `OrderOptions` — SDK ignores it
4. SDK sends order without vault context — trades from the agent key's authorized wallet
5. Order succeeds

## Acceptance Criteria

1. **Given** VolumeMax mode is started, **When** it attempts to open a position, **Then** the order succeeds without "Vault not registered" error.
2. **Given** any mode closes a position or sets a stop-loss, **When** the contract function is called, **Then** no `vaultAddress` is sent to the SDK.
3. **Given** the `vaultAddress` fields in param interfaces are made optional, **When** running `pnpm tsc --noEmit`, **Then** no type errors.
4. **Given** all changes are made, **When** running `pnpm test`, **Then** all tests pass.

## Tasks / Subtasks

- [x] Task 1: Make `vaultAddress` optional in contracts.ts param interfaces
  - [x] 1.1 Change `vaultAddress: \`0x${string}\`` to `vaultAddress?: \`0x${string}\`` in `OpenPositionParams`, `ClosePositionParams`, `SetStopLossParams`

- [x] Task 2: Remove `vaultAddress` from position-manager.ts contract calls
  - [x] 2.1 Remove `vaultAddress: client.walletAddress` from all 7 call sites (lines 131, 152, 172, 187, 317, 413, 849)

- [x] Task 3: Clean up tests
  - [x] 3.1 Remove `vaultAddress` from test params in `contracts.test.ts` (5 occurrences)

- [x] Task 4: Verify
  - [x] 4.1 `pnpm tsc --noEmit` — no type errors
  - [x] 4.2 `pnpm vitest run` — all 51 tests pass (21 contracts + 30 position-manager)

### Review Findings

- [x] [Review][Patch] Clean up trailing whitespace and orphaned blank lines from vaultAddress removals [position-manager.ts, contracts.test.ts]

## Dev Agent Record

### Changes Made
- Made `vaultAddress` optional (`?`) in 3 param interfaces in `contracts.ts`
- Removed all 7 `vaultAddress: client.walletAddress` lines from `position-manager.ts`
- Removed 5 `vaultAddress` test params from `contracts.test.ts`

### Files Changed
- `src/server/blockchain/contracts.ts`
- `src/server/engine/position-manager.ts`
- `src/server/blockchain/contracts.test.ts`

## Dev Notes

### Key Files

- `src/server/blockchain/contracts.ts` — Param interfaces + SDK call sites
- `src/server/engine/position-manager.ts` — 7 call sites passing walletAddress as vaultAddress
- `src/server/blockchain/contracts.test.ts` — Test params with vaultAddress

### Will this resurrect the build error from commit b9a29a5?

**No.** That error was caused by `vaultAddress` being inside `OrderParameters` (the action payload). It's now in `OrderOptions` (the opts arg). Making it optional and passing `undefined` is valid — the SDK signature is `order(config, params, opts?: OrderOptions)` where both `opts` and `opts.vaultAddress` are optional.

### Do NOT

- Do NOT remove the `vaultAddress` field from the param interfaces entirely — keep it optional for future vault support
- Do NOT change how `contracts.ts` passes `{ vaultAddress }` to the SDK — when undefined, the SDK correctly ignores it
