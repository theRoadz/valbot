# Story 8.2: Rewrite Blockchain Layer from SVM to Hyperliquid API

Status: planned

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

- [ ] Task 1: Swap dependencies
  - [ ] 1.1 `pnpm remove @solana/web3.js @solana/spl-token bs58`
  - [ ] 1.2 `pnpm add @nktkas/hyperliquid viem`
  - [ ] 1.3 Verify `pnpm build` still compiles (expect errors in blockchain/ only)

- [ ] Task 2: Rewrite `src/server/blockchain/client.ts` (AC: #1, #2)
  - [ ] 2.1 New `BlockchainClient` interface:
    ```typescript
    interface BlockchainClient {
      exchange: ExchangeClient;  // @nktkas/hyperliquid — trading
      info: InfoClient;          // @nktkas/hyperliquid — queries
      walletAddress: string;     // 0x master wallet (WALLET env) — for info queries
      agentAddress: string;      // 0x derived from SESSION_KEY — for signing
    }
    ```
  - [ ] 2.2 `loadAgentWallet()`: Use `viem/privateKeyToAccount`. Validate `0x`-prefixed 64-char hex. No more base58 or variable-length keys.
  - [ ] 2.3 Validate `WALLET` env var (42-char 0x hex address). This is the **master wallet** needed for Hyperliquid info queries — distinct from agent key address.
  - [ ] 2.4 Create `HttpTransport` + `ExchangeClient` (with agent wallet) + `InfoClient` from SDK
  - [ ] 2.5 Validate connection via `info.clearinghouseState()` with exponential backoff retry
  - [ ] 2.6 `getWalletBalance()`: Query `info.clearinghouseState()` → `marginSummary.accountValue` → convert to smallest-unit integer
  - [ ] 2.7 `getConnectionStatus()`: Same shape, wallet is now 0x format
  - [ ] 2.8 Remove all `@solana/web3.js`, `@solana/spl-token`, `bs58` imports

- [ ] Task 3: Rewrite `src/server/blockchain/contracts.ts` (AC: #3, #4, #5)
  - [ ] 3.1 Add asset index cache: `initAssetIndices(info)` fetches `info.meta()` → maps coin names to Hyperliquid indices + szDecimals
  - [ ] 3.2 `resolveAsset(pair)`: Convert "BTC/USDC" → `{ index, coin, szDecimals }`
  - [ ] 3.3 Update param interfaces: `Connection`/`Keypair` → `ExchangeClient`/`InfoClient`
  - [ ] 3.4 `openPosition()`: Get mid price → calculate limit with slippage → `exchange.order()` with IOC → parse fill
  - [ ] 3.5 `closePosition()`: Reduce-only IOC order on opposite side → return exitPrice, fees
  - [ ] 3.6 `setStopLoss()`: Trigger order with `tpsl: "sl"`, `grouping: "positionTpsl"`. Params change: `positionId` → `pair`/`side`/`size`

- [ ] Task 4: Update consumers (AC: #6)
  - [ ] 4.1 `src/server/engine/position-manager.ts`: Change `client.connection`/`client.keypair` → `client.exchange`/`client.info` in all contract calls. Update `setStopLoss` call to pass `pair`/`side`/`size`.
  - [ ] 4.2 `src/server/index.ts`: Add `initAssetIndices(client.info)` after `initBlockchainClient()`
  - [ ] 4.3 `src/server/lib/errors.ts`: Update resolution text, rename `rpcConnectionFailedError` → `apiConnectionFailedError`, add `walletAddressMissingError()`

- [ ] Task 5: Rewrite tests (AC: #6)
  - [ ] 5.1 `client.test.ts`: Replace Solana mocks with viem/SDK mocks. Test loadAgentWallet, WALLET validation, balance query, connection retry.
  - [ ] 5.2 `contracts.test.ts`: Mock `ExchangeClient.order`, `InfoClient.allMids`, `InfoClient.meta`. Test order placement, close, stop-loss, error mapping.
  - [ ] 5.3 `position-manager.test.ts`: Update `getBlockchainClient` mock return shape
  - [ ] 5.4 `engine/index.test.ts`: Update blockchain client mock if referenced

- [ ] Task 6: Cleanup & verify (AC: #6)
  - [ ] 6.1 Update `.env.example` — remove `RPC_URL`, document `WALLET`
  - [ ] 6.2 Search for `@solana`, `bs58`, `Keypair`, `PublicKey` in `src/` — must be zero results
  - [ ] 6.3 `pnpm test` — all tests pass
  - [ ] 6.4 `pnpm build` — zero errors
  - [ ] 6.5 Start dev server → verify dashboard shows correct 0x wallet and real balance

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
