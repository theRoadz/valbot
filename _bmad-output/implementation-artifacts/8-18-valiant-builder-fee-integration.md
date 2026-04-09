# Story 8.18: Integrate Valiant Builder Fee into Hyperliquid Orders

Status: review

## Story

As theRoad,
I want all Hyperliquid orders to include Valiant's builder code and fee,
So that agent wallet trades are properly attributed on Valiant's rewards dashboard.

## Problem

Valiant requires agent wallets to integrate their builder codes/fees for proper volume attribution on the rewards tab. Without it, trades from agent wallets show inconsistencies. The `@nktkas/hyperliquid` SDK already supports an optional `builder` parameter on `exchange.order()` — it just needs to be wired up.

### Builder Details

- **Builder address:** `0x751d254c07f7a4b454eb5c2a23ebe3adf1a4eaec`
- **SDK builder param:** `{ b: "0x...", f: number }` where `f` is fee in 0.1bps units (1 = 0.0001%). Max 100 for perps.
- **Fee approval:** SDK provides `exchange.approveBuilderFee()` — must be called before orders with builder fee succeed.

## Background

### Current order flow

All orders go through 3 functions in `src/server/blockchain/contracts.ts`:
- `openPosition()` — market/IOC order
- `closePosition()` — reduce-only IOC order
- `setStopLoss()` — trigger order

Each calls `exchange.order({ orders, grouping, vaultAddress })`. The `builder` param is not set.

### SDK support (already available)

```typescript
// In exchange.order() params:
builder?: {
  b: `0x${string}`;  // Builder address
  f: number;          // Fee in 0.1bps units. Max 100 for perps.
};

// One-time approval:
exchange.approveBuilderFee({ maxFeeRate: "0.001%", builder: "0x..." });
```

### Fee estimation

`closePosition()` estimates fees using `TAKER_FEE_RATE` (line 308). Builder fee must be added to this estimation.

## Acceptance Criteria

1. **Given** `BUILDER_ADDRESS` and `BUILDER_FEE_RATE` env vars are set, **When** any order is placed (open, close, stop-loss), **Then** the `builder` parameter is included in the `exchange.order()` call with the configured address and fee rate.
2. **Given** `BUILDER_ADDRESS` or `BUILDER_FEE_RATE` env vars are NOT set, **When** any order is placed, **Then** no `builder` parameter is sent (backward compatible, no behavior change).
3. **Given** builder fee is configured, **When** the bot starts up, **Then** `approveBuilderFee` is called during `initBlockchainClient()` (non-fatal on failure).
4. **Given** builder fee is configured, **When** `closePosition()` estimates fees, **Then** the estimation includes both taker fee and builder fee.
5. **Given** all changes are made, **When** running `pnpm test`, **Then** all tests pass.

## Tasks / Subtasks

- [x] Task 1: Add environment variables
  - [x] 1.1 Add `BUILDER_ADDRESS` and `BUILDER_FEE_RATE` to `.env.example` with documentation comment
  - [x] 1.2 Add actual values to `.env`

- [x] Task 2: Add builder config and pass to order calls in `contracts.ts`
  - [x] 2.1 Add `BUILDER_ADDRESS`, `BUILDER_FEE_RATE_UNITS`, `BUILDER_FEE`, and `BUILDER_FEE_DECIMAL` constants after `TAKER_FEE_RATE` (line 19)
  - [x] 2.2 Add startup log when builder fee is enabled
  - [x] 2.3 Add `builder: BUILDER_FEE,` to `openPosition()` exchange.order() call
  - [x] 2.4 Add `builder: BUILDER_FEE,` to `closePosition()` exchange.order() call
  - [x] 2.5 Add `builder: BUILDER_FEE,` to `setStopLoss()` exchange.order() call
  - [x] 2.6 Update fee estimation in `closePosition()` to include `BUILDER_FEE_DECIMAL`

- [x] Task 3: Add builder fee approval at startup in `client.ts`
  - [x] 3.1 After connection validation loop (line 273), call `exchange.approveBuilderFee()` if env vars are set
  - [x] 3.2 Wrap in try/catch — non-fatal, log warning on failure

- [x] Task 4: Tests in `contracts.test.ts`
  - [x] 4.1 Test: builder param included in openPosition when env vars set
  - [x] 4.2 Test: builder param included in closePosition when env vars set
  - [x] 4.3 Test: builder param included in setStopLoss when env vars set
  - [x] 4.4 Test: builder param omitted when env vars not set
  - [x] 4.5 Test: fee estimation includes builder fee
  - [x] 4.6 Run full test suite — all 808 tests pass across 39 files

## Dev Agent Record

### Implementation Notes

- Builder fee config is fully optional — when `BUILDER_ADDRESS` or `BUILDER_FEE_RATE` env vars are unset, `BUILDER_FEE` is `undefined` and the SDK ignores it (optional param). Zero behavior change for existing deployments.
- `BUILDER_FEE_RATE` uses 0.1bps units per SDK spec. Default `10` = 0.001%. Max 100 for perps.
- `approveBuilderFee` is called at startup in `initBlockchainClient()`, wrapped in try/catch. Non-fatal — if already approved (on-chain persistence) or network blip, bot still starts.
- Fee estimation in `closePosition()` now includes `BUILDER_FEE_DECIMAL` alongside `TAKER_FEE_RATE`.
- Added `afterEach` import to test file for env var cleanup between test runs.

### Completion Notes

All 4 tasks completed. 5 new builder fee tests added (3 for builder inclusion per order type, 1 for omission without env vars, 1 for fee estimation). Full regression suite passes (808/808 tests, 39/39 files).

## Change Log

- 2026-04-09: Story 8-18 implemented — Valiant builder fee integration across all order calls

## File List

- `.env.example` — added `BUILDER_ADDRESS` and `BUILDER_FEE_RATE` env vars
- `.env` — added actual builder address and fee rate values
- `src/server/blockchain/contracts.ts` — added builder config constants, `builder: BUILDER_FEE` to 3 order calls, updated fee estimation
- `src/server/blockchain/client.ts` — added `approveBuilderFee` call at startup
- `src/server/blockchain/contracts.test.ts` — added 5 builder fee tests
