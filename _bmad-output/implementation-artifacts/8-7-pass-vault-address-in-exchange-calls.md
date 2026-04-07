# Story 8.7: Pass vaultAddress in Hyperliquid Exchange Calls

Status: done

## Story

As theRoad,
I want all exchange order calls to include the master wallet's `vaultAddress`,
So that the agent key correctly signs on behalf of the WALLET and doesn't rely on the agent address having its own Hyperliquid account.

## Problem & Discovery

The `ExchangeClient` is initialized with SESSION_KEY (agent key), which means all `exchange.order()` calls sign with the agent key's derived address. However, the trading account and funds live on the WALLET (master wallet) address. The SDK's `order()` method accepts an optional `vaultAddress` parameter to specify which account the agent is acting on behalf of, but the code never passes it.

This worked previously because the agent key's own derived address (`0x5d20...554d`) happened to have an account on Hyperliquid. When that account was invalidated (perps re-enabled in a different browser on Valiant, generating/re-registering a new agent key), orders started failing with: `User or API Wallet 0x5d20...554d does not exist.`

Info queries (equity, balances) continued working because they use `walletAddress` (WALLET) directly.

## Root Cause

`src/server/blockchain/contracts.ts` — all 3 `exchange.order()` calls (openPosition, closePosition, setStopLoss) omit the `vaultAddress` parameter. The `@nktkas/hyperliquid` SDK supports `vaultAddress?: \`0x${string}\`` on every order call.

## Acceptance Criteria

1. **Given** an agent key (SESSION_KEY) approved to trade on behalf of WALLET, **When** any order is placed, **Then** `vaultAddress` is set to WALLET in the exchange call.
2. **Given** the fix is applied, **When** volumeMax/profitHunter/arbitrage modes open or close positions, **Then** orders execute against the master wallet.
3. **Given** existing tests, **When** the test suite runs, **Then** all tests pass.

## Tasks / Subtasks

- [x] Task 1: Update contracts.ts param interfaces (AC: 1)
  - [x] 1.1 Add `vaultAddress: \`0x${string}\`` to `OpenPositionParams`
  - [x] 1.2 Add `vaultAddress: \`0x${string}\`` to `ClosePositionParams`
  - [x] 1.3 Add `vaultAddress: \`0x${string}\`` to `SetStopLossParams`

- [x] Task 2: Pass vaultAddress in exchange.order() calls (AC: 1, 2)
  - [x] 2.1 `openPosition` — add `vaultAddress` to order call
  - [x] 2.2 `closePosition` — add `vaultAddress` to order call
  - [x] 2.3 `setStopLoss` — add `vaultAddress` to order call

- [x] Task 3: Update position-manager.ts call sites (AC: 2)
  - [x] 3.1 `contractOpenPosition` call — pass `client.walletAddress`
  - [x] 3.2 `contractClosePosition` call (kill-switch race rollback) — pass `client.walletAddress`
  - [x] 3.3 `contractSetStopLoss` call — pass `client.walletAddress`
  - [x] 3.4 `contractClosePosition` call (stop-loss rollback) — pass `client.walletAddress`
  - [x] 3.5 `contractClosePosition` call (DB-write rollback) — pass `client.walletAddress`
  - [x] 3.6 `contractClosePosition` call (normal close) — pass `client.walletAddress`

- [x] Task 4: Verification (AC: 3)
  - [x] 4.1 `pnpm build` — no type errors (clean `tsc --noEmit`)
  - [x] 4.2 `pnpm test` — 710 tests passed across 35 files
  - [ ] 4.3 Manual: start bot, run volumeMax — orders execute against master wallet

### Review Findings

- [x] [Review][Patch] Narrow `BlockchainClient.walletAddress` type from `string` to `` `0x${string}` `` to eliminate unsafe casts [client.ts:231] — **fixed**
- [x] [Review][Patch] Zero-address guard in `loadWalletAddress()` [client.ts:225] — **fixed**
- [x] [Review][Patch] Document singleton client immutability [client.ts:238] — **fixed**
- [x] [Review][Patch] Orphaned position replacement now includes `filledSz` [position-manager.ts:252] — **fixed**
- [x] [Review][Patch] Narrow `reconcileOnChainPositions` param to `` `0x${string}` `` [position-manager.ts:621] — **fixed**

## Dev Notes

### Key Files

- `src/server/blockchain/contracts.ts` — OpenPositionParams (line 79), ClosePositionParams (line 96), SetStopLossParams (line 113), order calls (lines 194, 267, 328)
- `src/server/engine/position-manager.ts` — 6 contract call sites (lines 124, 143, 163, 176, 304, 399)
- `src/server/blockchain/client.ts` — BlockchainClient.walletAddress (line 231)

### File List

- `src/server/blockchain/client.ts`
- `src/server/blockchain/contracts.ts`
- `src/server/engine/position-manager.ts`
- `_bmad-output/implementation-artifacts/8-7-pass-vault-address-in-exchange-calls.md`
