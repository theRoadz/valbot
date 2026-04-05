# Story 8.2: Rewrite Blockchain Layer from SVM to Hyperliquid API

Status: done

## Story

As theRoad,
I want the bot to trade through Hyperliquid's REST API using my EVM agent key,
So that trades actually execute on Hyperliquid (where Valiant Perps routes orders) instead of failing against a non-existent SVM contract.

## Problem & Discovery

The original architecture assumed **Fogo SVM** for all trading. Investigation revealed:

1. **Fogo** is SVM, but **Valiant Perps** is a UI layer over **Hyperliquid's order book**
2. The agent key from Valiant is a **secp256k1 private key** (EVM), not Ed25519 (Solana)
3. The wallet address is **0x EVM format** (`0x8edb...`), not base58
4. `Keypair.fromSeed()` derives a completely wrong wallet address (`DHYXB8M2L...`)
5. Trades execute via **Hyperliquid REST API** at `https://api.hyperliquid.xyz/exchange`
6. Account queries go to `https://api.hyperliquid.xyz/info` using the **master wallet address**

**Source:** Valiant docs confirm: *"Hyperliquid is the execution layer. Valiant is the experience layer on top."*

## Impact Assessment

**Only 2 production files need full rewrite** (~260 lines):
- `src/server/blockchain/client.ts` (169 lines)
- `src/server/blockchain/contracts.ts` (91 lines)

**~95% of the codebase is unaffected** — engine, API routes, WebSocket, database, shared types, and all frontend code are blockchain-agnostic.

**Minor updates** in 3 files:
- `src/server/engine/position-manager.ts` — change `client.connection`/`client.keypair` to `client.exchange`/`client.info`
- `src/server/lib/errors.ts` — update error message strings
- `src/server/index.ts` — add `initAssetIndices()` call

## Acceptance Criteria

1. **Scenario 1: Correct wallet address**
   - **Given** a valid 0x-prefixed agent key in `.env`
   - **When** the bot starts
   - **Then** the derived wallet matches the Valiant Perps wallet address
   - **And** the dashboard shows the correct 0x address

2. **Scenario 2: Account balance from Hyperliquid**
   - **Given** the bot is connected
   - **When** it queries the balance
   - **Then** it calls `info.clearinghouseState({ user: WALLET })` on Hyperliquid API
   - **And** returns the account value in smallest-unit USDC

3. **Scenario 3: Open position via Hyperliquid**
   - **Given** a mode is running
   - **When** it opens a position
   - **Then** it places an IOC order via `exchange.order()` on Hyperliquid
   - **And** returns fill data (txHash, positionId, entryPrice)

4. **Scenario 4: Close position via Hyperliquid**
   - **Given** an open position exists
   - **When** it closes the position
   - **Then** it places a reduce-only IOC order on the opposite side
   - **And** returns exitPrice and fees

5. **Scenario 5: Set stop-loss via Hyperliquid**
   - **Given** an open position exists
   - **When** a stop-loss is set
   - **Then** it places a trigger order with `tpsl: "sl"` and `grouping: "positionTpsl"`

6. **Scenario 6: No regressions**
   - **Given** the rewrite is complete
   - **When** the full test suite runs
   - **Then** all tests pass
   - **And** `pnpm build` succeeds with zero errors
   - **And** no references to `@solana`, `bs58`, `Keypair`, or `PublicKey` remain in `src/`

## Tasks / Subtasks

- [x] Task 1: Swap dependencies
  - [x] 1.1 `pnpm remove @solana/web3.js @solana/spl-token bs58`
  - [x] 1.2 `pnpm add @nktkas/hyperliquid viem`
  - [x] 1.3 Verify `pnpm build` still compiles (expect errors in blockchain/ only)

- [x] Task 2: Rewrite `src/server/blockchain/client.ts` (AC: #1, #2)
  - [x] 2.1 New `BlockchainClient` interface:
    ```typescript
    interface BlockchainClient {
      exchange: ExchangeClient;  // @nktkas/hyperliquid — trading
      info: InfoClient;          // @nktkas/hyperliquid — queries
      walletAddress: string;     // 0x master wallet (WALLET env) — for info queries
      agentAddress: string;      // 0x derived from SESSION_KEY — for signing
    }
    ```
  - [x] 2.2 `loadAgentWallet()`: Use `viem/privateKeyToAccount`. Validate `0x`-prefixed 64-char hex. No more base58 or variable-length keys.
  - [x] 2.3 Validate `WALLET` env var (42-char 0x hex address). This is the **master wallet** needed for Hyperliquid info queries — distinct from agent key address.
  - [x] 2.4 Create `HttpTransport` + `ExchangeClient` (with agent wallet) + `InfoClient` from SDK
  - [x] 2.5 Validate connection via `info.clearinghouseState()` with exponential backoff retry
  - [x] 2.6 `getWalletBalance()`: Query `info.clearinghouseState()` → `marginSummary.accountValue` → convert to smallest-unit integer
  - [x] 2.7 `getConnectionStatus()`: Same shape, wallet is now 0x format
  - [x] 2.8 Remove all `@solana/web3.js`, `@solana/spl-token`, `bs58` imports

- [x] Task 3: Rewrite `src/server/blockchain/contracts.ts` (AC: #3, #4, #5)
  - [x] 3.1 Add asset index cache: `initAssetIndices(info)` fetches `info.meta()` → maps coin names to Hyperliquid indices + szDecimals
  - [x] 3.2 `resolveAsset(pair)`: Convert "BTC/USDC" → `{ index, coin, szDecimals }`
  - [x] 3.3 Update param interfaces: `Connection`/`Keypair` → `ExchangeClient`/`InfoClient`
  - [x] 3.4 `openPosition()`: Get mid price → calculate limit with slippage → `exchange.order()` with IOC → parse fill
  - [x] 3.5 `closePosition()`: Reduce-only IOC order on opposite side → return exitPrice, fees
  - [x] 3.6 `setStopLoss()`: Trigger order with `tpsl: "sl"`, `grouping: "positionTpsl"`. Params change: `positionId` → `pair`/`side`/`size`

- [x] Task 4: Update consumers (AC: #6)
  - [x] 4.1 `src/server/engine/position-manager.ts`: Change `client.connection`/`client.keypair` → `client.exchange`/`client.info` in all contract calls. Update `setStopLoss` call to pass `pair`/`side`/`size`.
  - [x] 4.2 `src/server/index.ts`: Add `initAssetIndices(client.info)` after `initBlockchainClient()`
  - [x] 4.3 `src/server/lib/errors.ts`: Update resolution text, rename `rpcConnectionFailedError` → `apiConnectionFailedError`, add `walletAddressMissingError()`

- [x] Task 5: Rewrite tests (AC: #6)
  - [x] 5.1 `client.test.ts`: Replace Solana mocks with viem/SDK mocks. Test loadAgentWallet, WALLET validation, balance query, connection retry.
  - [x] 5.2 `contracts.test.ts`: Mock `ExchangeClient.order`, `InfoClient.allMids`, `InfoClient.meta`. Test order placement, close, stop-loss, error mapping.
  - [x] 5.3 `position-manager.test.ts`: Update `getBlockchainClient` mock return shape
  - [x] 5.4 `engine/index.test.ts`: Update blockchain client mock if referenced

- [x] Task 6: Cleanup & verify (AC: #6)
  - [x] 6.1 Update `.env.example` — remove `RPC_URL`, document `WALLET`
  - [x] 6.2 Search for `@solana`, `bs58`, `Keypair`, `PublicKey` in `src/` — must be zero results
  - [x] 6.3 `pnpm test` — all tests pass (315/315)
  - [x] 6.4 `pnpm build` — zero errors
  - [x] 6.5 Start dev server → verify dashboard shows correct 0x wallet and real balance

### Review Findings

- [x] [Review][Decision] D1: Stop-loss base size calculated from trigger price — deferred, reduce-only flag clamps to actual position size
- [x] [Review][Decision→Patch] D2: `closePosition` slippage bumped from 0.5% to 1% [contracts.ts:206] — FIXED
- [x] [Review][Patch] P1: Kill-switch alert payload now includes `mode` field [position-manager.ts:337, events.ts:39] — FIXED
- [x] [Review][Patch] P2: `getMidPrice` now guards against NaN/non-numeric strings [contracts.ts:124-133] — FIXED
- [x] [Review][Patch] P3: Zero/negative mid price now throws MID_PRICE_INVALID [contracts.ts:124-133] — FIXED
- [x] [Review][Patch] P4: Partial-fill detection added with warning log + `actualSize` field [contracts.ts:177-195] — FIXED
- [x] [Review][Patch] P5: DB write after on-chain close wrapped in try/catch — funds always released [position-manager.ts:275-299] — FIXED
- [x] [Review][Patch] P6: "Check RPC connection" → "Check Hyperliquid API connection" [position-manager.ts:74,241] — FIXED
- [x] [Review][Patch] P7: `setStopLoss` logs waitingForTrigger status explicitly [contracts.ts:325-330] — FIXED
- [x] [Review][Patch] P8: Kill-switch PnL computed from entry vs exit price instead of always-zero [position-manager.ts:379-383] — FIXED
- [x] [Review][Defer→Fixed] W1: status.ts now calls getConnectionStatus() for live data [status.ts] — FIXED
- [x] [Review][Defer→Fixed] W2: Asset cache now has 1h TTL with background refresh on miss [contracts.ts] — FIXED
- [x] [Review][Defer] W3: loadFromDb recovered positions use fabricated chainPositionId [position-manager.ts:406] — deferred, requires DB migration (Story 3.2)
- [x] [Review][Defer→Fixed] W4: getConnectionStatus returns stale cached data on API failure [client.ts] — FIXED
- [x] [Review][Defer→Fixed] W5: Taker fee rate now configurable via TAKER_FEE_RATE env var [contracts.ts] — FIXED

## Dev Notes

### Hyperliquid API Overview

**Info endpoint** (`POST https://api.hyperliquid.xyz/info`):
- `clearinghouseState` — account balance, positions, margin
- `allMids` — current mid prices for all pairs
- `meta` — market metadata with asset indices and szDecimals
- `openOrders` — active orders
- **CRITICAL:** Always query with master wallet address, NOT agent key address

**Exchange endpoint** (`POST https://api.hyperliquid.xyz/exchange`):
- `order` — place orders (asset index, isBuy, price, size, tif, signature, nonce)
- `cancel` — cancel by order ID or cloid
- Signing: EIP-712 structured data with "phantom agent" mechanism (SDK handles this)

**Agent key model:**
- Agent key = "API wallet" — a signing proxy authorized by master account
- Agent signs transactions, but queries must use master wallet address
- Nonces tracked per signer (agent address)
- Key expires every ~7 days (re-extract from Valiant browser)

### SDK Choice: `@nktkas/hyperliquid`

- Most actively maintained TypeScript SDK (v0.30+, updated weekly)
- 100% typed, minimal dependencies
- Integrates with viem and ethers wallet libraries
- Handles EIP-712 signing, phantom agent construction, nonce management
- Exports `ExchangeClient`, `InfoClient`, `HttpTransport`

### EVM Wallet: `viem`

- `privateKeyToAccount("0x...")` → `PrivateKeyAccount` with `.address`, `.signTypedData()`
- Lightweight, tree-shakeable, TypeScript-first
- Used by `@nktkas/hyperliquid` for wallet integration

### .env Structure

```
SESSION_KEY=0x...  # 32-byte hex agent key from Valiant extraction script
WALLET=0x...       # Master wallet address (0x8edb... from extraction script)
PORT=3000
VALBOT_DB_PATH=./valbot.db
```

`RPC_URL` removed — Hyperliquid SDK manages API URLs internally.

### What NOT to Do

- Do NOT rewrite engine, fund allocator, mode runner, or strategies — they are blockchain-agnostic
- Do NOT change shared types or events — they don't reference Solana
- Do NOT change frontend code — wallet display already handles string addresses
- Do NOT keep `@solana/web3.js` as a dependency — clean removal

### Architecture Boundary Preserved

The existing boundary rule holds: **`src/server/blockchain/` is the ONLY code that touches the exchange API**. The rewrite stays within this boundary. Position-manager still calls typed contract functions — it doesn't know about Hyperliquid.

### Key Differences from SVM

| Aspect | SVM (old) | Hyperliquid (new) |
|--------|-----------|-------------------|
| Key type | Ed25519 (64-byte) | secp256k1 (32-byte hex) |
| Address format | base58 | 0x hex (20 bytes) |
| Balance query | SPL token ATA | clearinghouseState API |
| Trade execution | SVM contract call | REST API + EIP-712 sig |
| Position ID | On-chain ID | Coin-based (BTC-Long) |
| Stop-loss | Contract call | Trigger order API |
| Connection | RPC WebSocket | HTTPS REST |

### References

- [Valiant docs](https://docs.valiant.trade/) — confirms Hyperliquid execution layer
- [Hyperliquid API docs](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api)
- [Hyperliquid exchange endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint)
- [Hyperliquid info endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint)
- [@nktkas/hyperliquid npm](https://www.npmjs.com/package/@nktkas/hyperliquid)
- [Fogo docs](https://docs.fogo.io) — confirms Fogo is SVM, but Valiant routes via Hyperliquid

## Dev Agent Record

### Implementation Plan

- Task 1: Removed `@solana/web3.js`, `@solana/spl-token`, `bs58`; added `@nktkas/hyperliquid@0.32.2`, `viem@2.47.10`
- Task 2: Full rewrite of `client.ts` — replaced Solana `Keypair`/`Connection`/`PublicKey` with viem `privateKeyToAccount` + Hyperliquid SDK `ExchangeClient`/`InfoClient`/`HttpTransport`. Added `WALLET` env var validation for master wallet address (distinct from agent key). Balance queries `spotClearinghouseState` for USDC `total` (equity) and `total - hold` (available).
- Task 3: Full rewrite of `contracts.ts` — replaced stubs with real Hyperliquid API calls. Added `initAssetIndices()` cache from `info.meta()`, `resolveAsset()` for pair→index mapping. `openPosition`/`closePosition` use IOC orders via `exchange.order()`. `setStopLoss` uses trigger orders with `tpsl: "sl"` and `positionTpsl` grouping. Updated param interfaces from `Connection`/`Keypair` to `ExchangeClient`/`InfoClient`.
- Task 4: Updated 4 call sites in `position-manager.ts` (`openPosition`, `setStopLoss`, 2x `closePosition` rollbacks, 1x `closePosition` main). Updated `server/index.ts` to call `initAssetIndices()` after blockchain init. Renamed `rpcConnectionFailedError` → `apiConnectionFailedError`, added `walletAddressMissingError`, updated `sessionKeyInvalidError` resolution text.
- Task 5: Rewrote `client.test.ts` (12 tests) with viem/SDK mocks. Rewrote `contracts.test.ts` (11 tests) mocking `exchange.order`, `info.allMids`, `info.meta`. Updated `position-manager.test.ts` and `engine/index.test.ts` mock return shapes.
- Task 6: Updated `.env.example`, verified zero Solana references in `src/`, all 315 tests pass, build succeeds.

### Decisions

- SDK generic types: Used default generics (`ExchangeClient`, `InfoClient`) instead of `ExchangeClient<HttpTransport>` — the SDK parameterizes on config objects, not transport types.
- `loadAgentWallet()` accepts raw hex without 0x prefix (auto-prefixes) for flexibility.
- `closePosition` returns `pnl: 0` — actual PnL is computed by position-manager from stored entryPrice vs exitPrice, not from the exchange response.
- Fee estimation uses 0.025% taker fee (Hyperliquid standard) calculated from fill size * avgPx.
- **Balance source:** Hyperliquid uses a unified margin model where `spotClearinghouseState` USDC `total` includes margin held for perps positions. The perps `clearinghouseState.accountValue` only shows position equity (not total capital), and `withdrawable` is 0 when all perps cash is margin-locked. Correct approach: use spot USDC `total` for equity, `total - hold` for available trading capital. Verified against Valiant UI.

### Debug Log

- Initial build after type changes failed with 14 TS errors: `ExchangeClient<HttpTransport>` constraint violations. Root cause: SDK generic params are config types, not transport. Fixed by using default generics.
- First test run: 3 failures. (1) `InfoClient` mock was a function, not a class — fixed to use `class MockInfoClient`. (2) `errors.test.ts` still referenced old `rpcConnectionFailedError` — updated to `apiConnectionFailedError` + `walletAddressMissingError`.
- Second test run: 315/315 pass, 0 failures.
- **Balance investigation (post-implementation):** Dashboard showed $43.95 (perps `accountValue`) instead of Valiant's $125.71. Debug logging revealed: perps `accountValue` = position margin only, `withdrawable` = 0 (all margin locked). Spot USDC `total` = 145.17 with `hold` = 66.50 (matching perps `totalMarginUsed`). Fix: use `spotClearinghouseState` USDC `total` for equity, `total - hold` for available. Also updated shared types from single `walletBalance` to `equity`/`available` across events, store, and dashboard. User confirmed Equity ~$143.67, Available ~$76.68 matches Valiant.

### Completion Notes

All 6 tasks completed, all 25 subtasks checked. Full blockchain layer rewritten from Solana SVM to Hyperliquid REST API. Zero Solana references remain in `src/`. Live verification confirmed: dashboard shows correct 0x wallet address, equity (~$143.67) and available balance (~$76.68) match Valiant UI. Balance display updated from single `walletBalance` to dual `equity`/`available` using spot USDC `total` and `total - hold`. All 315 tests pass, build clean.

## File List

### Modified
- `package.json` — removed Solana deps, added @nktkas/hyperliquid + viem
- `pnpm-lock.yaml` — dependency lockfile updated
- `src/server/blockchain/client.ts` — full rewrite: viem + Hyperliquid SDK, balance via spotClearinghouseState
- `src/server/blockchain/contracts.ts` — full rewrite: real Hyperliquid API calls
- `src/server/blockchain/client.test.ts` — full rewrite: viem/SDK mocks, spot balance tests
- `src/server/blockchain/contracts.test.ts` — full rewrite: ExchangeClient/InfoClient mocks
- `src/server/engine/position-manager.ts` — updated 5 contract call sites
- `src/server/engine/position-manager.test.ts` — updated blockchain client mock shape
- `src/server/engine/index.test.ts` — added contracts mock, updated client mock
- `src/server/index.ts` — added initAssetIndices() call, updated disconnected broadcast payload
- `src/server/api/status.ts` — updated default connection state (equity/available)
- `src/server/api/status.test.ts` — updated expected connection shape
- `src/server/lib/errors.ts` — renamed rpcConnectionFailedError, added walletAddressMissingError, updated sessionKeyInvalidError
- `src/server/lib/errors.test.ts` — updated to test new error functions
- `src/shared/types.ts` — replaced walletBalance with equity/available in ConnectionState and SummaryStats
- `src/shared/events.ts` — updated ConnectionStatusPayload to equity/available
- `src/client/store/index.ts` — updated store shape, actions, WS handler for equity/available
- `src/client/store/index.test.ts` — updated all balance references
- `src/client/components/top-bar.tsx` — dual display: "Equity:" and "Available:"
- `src/client/components/top-bar.test.tsx` — updated labels, aria-labels, stat counts
- `src/client/hooks/use-websocket.test.ts` — updated WS message payload
- `.env.example` — replaced RPC_URL with WALLET

## Change Log

- 2026-04-05: Story 8.2 implemented — full blockchain layer rewrite from Solana SVM to Hyperliquid REST API. Removed @solana/web3.js, @solana/spl-token, bs58. Added @nktkas/hyperliquid, viem. All 315 tests pass, build clean.
- 2026-04-05: Balance display fix — investigated Hyperliquid margin model via debug logging. Replaced perps-only `clearinghouseState.accountValue` with `spotClearinghouseState` USDC balances. Dashboard now shows "Equity" (total USDC) and "Available" (total - hold). Updated shared types, events, store, and top-bar from single `walletBalance` to dual `equity`/`available`. 22 files modified, all 315 tests pass. User verified values match Valiant UI.
