# Story 1.5: FOGOChain Connection & Session Key Authentication

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As theRoad,
I want the bot to authenticate using my session key from `.env` and connect to FOGOChain RPC,
So that I can confirm my wallet is connected and see my balance on the dashboard.

## Acceptance Criteria

1. **Scenario 1: Valid Session Key and RPC Connection**
   - **Given** a valid SESSION_KEY and RPC_URL are set in `.env`
   - **When** the bot starts
   - **Then** the blockchain client connects to FOGOChain RPC
   - **And** the session key is loaded from `.env` via dotenv
   - **And** the wallet balance is fetched and displayed in the SummaryBar
   - **And** `connection.status` WebSocket event broadcasts the connected state
   - **And** the dashboard shows green "Connected" status

2. **Scenario 2: Invalid Session Key Format**
   - **Given** the SESSION_KEY in `.env` is malformed (not valid base58, wrong length)
   - **When** the bot attempts to load the key
   - **Then** the system detects the invalid key format at startup
   - **And** an `alert.triggered` WebSocket event is broadcast with severity "critical"
   - **And** the dashboard shows the message: "Session key is invalid — check .env and re-extract if needed"
   - **And** the resolution steps are displayed to the user
   - **Note:** True session key *expiry* is only detectable when a transaction fails (per architecture: "Session key expiry detected by transaction failures"). Format validation happens at startup; expiry detection happens in Story 2.2+ when trading begins. The `sessionKeyExpiredError()` factory is provided for use by future stories.

3. **Scenario 3: Unreachable RPC URL**
   - **Given** the RPC_URL is unreachable
   - **When** the bot attempts to connect
   - **Then** the system retries with exponential backoff (1s, 2s, 4s) up to 3 times
   - **And** if all retries fail, an alert is broadcast with severity "critical" and resolution steps

## Tasks / Subtasks

- [x] Task 1: Install blockchain dependencies (AC: #1)
  - [x] 1.1 Install `@solana/web3.js` (v1.x stable — NOT v2/kit, v1 is the stable production-proven API for SVM chains). Also install `@solana/spl-token` for SPL token balance queries (USDC). Also install `bs58` for base58 session key decoding.
    ```bash
    pnpm add @solana/web3.js @solana/spl-token bs58
    pnpm add -D @types/bs58
    ```
  - [x] 1.2 Verify packages resolve correctly and `pnpm build` still succeeds after installation.

- [x] Task 2: Create `AppError` class in `src/server/lib/errors.ts` (AC: #2, #3)
  - [x] 2.1 Create the `AppError` class that the architecture mandates for ALL error handling. This does NOT exist yet — `src/server/lib/` is currently empty.
    ```typescript
    export type ErrorSeverity = "info" | "warning" | "critical";

    export class AppError extends Error {
      readonly severity: ErrorSeverity;
      readonly code: string;
      readonly details?: string;
      readonly resolution?: string;

      constructor(opts: {
        severity: ErrorSeverity;
        code: string;
        message: string;
        details?: string;
        resolution?: string;
      }) {
        super(opts.message);
        this.name = "AppError";
        this.severity = opts.severity;
        this.code = opts.code;
        this.details = opts.details;
        this.resolution = opts.resolution;
      }
    }
    ```
  - [x] 2.2 Add factory functions for common blockchain errors:
    ```typescript
    export function sessionKeyExpiredError(): AppError {
      return new AppError({
        severity: "critical",
        code: "SESSION_KEY_EXPIRED",
        message: "Session key expired — re-extract from browser console and update .env",
        resolution: "1. Open Valiant Perps in browser\n2. Run agent key extraction script in console\n3. Copy new session key to .env\n4. Restart the bot",
      });
    }

    export function sessionKeyInvalidError(details?: string): AppError {
      return new AppError({
        severity: "critical",
        code: "SESSION_KEY_INVALID",
        message: "Session key is invalid — check .env and re-extract if needed",
        details,
        resolution: "Verify SESSION_KEY in .env is a valid base58-encoded secret key. Re-extract from browser console if needed.",
      });
    }

    export function rpcConnectionFailedError(url: string, attempts: number): AppError {
      return new AppError({
        severity: "critical",
        code: "RPC_CONNECTION_FAILED",
        message: `RPC connection failed after ${attempts} retries — check network and RPC_URL`,
        details: `Failed to connect to ${url}`,
        resolution: "1. Check your internet connection\n2. Verify RPC_URL in .env is correct\n3. Try an alternative FOGOChain RPC endpoint\n4. Restart the bot",
      });
    }
    ```
  - [x] 2.3 Write co-located test: `src/server/lib/errors.test.ts` — verify AppError instances have correct severity, code, message, resolution fields. Verify factory functions return correct error types.

- [x] Task 3: Create Pino logger in `src/server/lib/logger.ts` (AC: #1, #2, #3)
  - [x] 3.1 Fastify already uses Pino internally. Create a standalone logger instance for non-Fastify code (blockchain client). Use Fastify's Pino instance if available, otherwise create a minimal logger.
    ```typescript
    import pino from "pino";

    export const logger = pino({
      transport:
        process.env.NODE_ENV !== "production"
          ? { target: "pino-pretty", options: { colorize: true } }
          : undefined,
    });
    ```
  - [x] 3.2 Fastify 5.x bundles `pino` as a dependency — check if `import pino from "pino"` resolves without explicit install first. If it does, skip adding `pino` to `package.json`. `pino-pretty` is NOT bundled and must be installed as a dev dependency:
    ```bash
    # Only if pino doesn't resolve from Fastify's deps:
    pnpm add pino
    # Always needed:
    pnpm add -D pino-pretty
    ```
    No test needed for the logger module — it's a simple config wrapper.
  - [x] 3.3 **CRITICAL:** The logger MUST NEVER log the session key value. Use `logger.info({ wallet: publicKey.toBase58() }, "Connected to FOGOChain")` — never `logger.info({ sessionKey })`.

- [x] Task 4: Create FOGOChain RPC client in `src/server/blockchain/client.ts` (AC: #1, #2, #3)
  - [x] 4.1 Create the blockchain client module. Architecture specifies this file handles RPC connection + retry logic. The file goes in the **existing empty** `src/server/blockchain/` directory.
    ```typescript
    import { Connection, Keypair, PublicKey } from "@solana/web3.js";
    import { getAssociatedTokenAddress, getAccount } from "@solana/spl-token";
    import bs58 from "bs58";
    import { logger } from "../lib/logger.js";
    import { AppError, sessionKeyInvalidError, rpcConnectionFailedError } from "../lib/errors.js";

    const MAX_RPC_RETRIES = 3;
    const BACKOFF_BASE_MS = 1000;
    // USDC mint address — standard across Solana/SVM chains
    // If FOGOChain uses a different USDC mint, update this constant
    const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    ```
  - [x] 4.2 Implement `loadSessionKey()` function:
    ```typescript
    export function loadSessionKey(): Keypair {
      const sessionKeyStr = process.env.SESSION_KEY;
      if (!sessionKeyStr) {
        throw new AppError({
          severity: "critical",
          code: "SESSION_KEY_MISSING",
          message: "SESSION_KEY not found in .env",
          resolution: "Add SESSION_KEY=<your_base58_key> to .env file",
        });
      }
      try {
        const secretKey = bs58.decode(sessionKeyStr);
        return Keypair.fromSecretKey(secretKey);
      } catch (err) {
        throw sessionKeyInvalidError(err instanceof Error ? err.message : "Failed to decode session key");
      }
    }
    ```
  - [x] 4.3 Implement `createRpcConnection()` with retry logic:
    ```typescript
    export async function createRpcConnection(): Promise<Connection> {
      const rpcUrl = process.env.RPC_URL;
      if (!rpcUrl) {
        throw new AppError({
          severity: "critical",
          code: "RPC_URL_MISSING",
          message: "RPC_URL not found in .env",
          resolution: "Add RPC_URL=https://rpc.fogo.chain to .env file",
        });
      }

      const connection = new Connection(rpcUrl, "confirmed");

      // Validate connection with retry
      for (let attempt = 1; attempt <= MAX_RPC_RETRIES; attempt++) {
        try {
          await connection.getLatestBlockhash();
          logger.info({ rpcUrl }, "Connected to FOGOChain RPC");
          return connection;
        } catch (err) {
          logger.warn({ attempt, maxRetries: MAX_RPC_RETRIES, rpcUrl }, "RPC connection attempt failed");
          if (attempt < MAX_RPC_RETRIES) {
            const delay = Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), 4000);
            await new Promise((r) => setTimeout(r, delay));
          }
        }
      }
      throw rpcConnectionFailedError(rpcUrl, MAX_RPC_RETRIES);
    }
    ```
  - [x] 4.4 Implement `getWalletBalance()` function — returns balance in **integer smallest-unit** (USDC × 1e6) per ADR-001. **Note:** Architecture places `getBalance()` on `contracts.ts`, but that file is created in Story 2.2. For now, balance logic lives in `client.ts` and may be moved to `contracts.ts` when the contract interface is built.
    ```typescript
    export async function getWalletBalance(connection: Connection, wallet: PublicKey): Promise<number> {
      try {
        const ata = await getAssociatedTokenAddress(USDC_MINT, wallet);
        const account = await getAccount(connection, ata);
        // account.amount is bigint — convert to number (safe for USDC balances)
        return Number(account.amount); // Already in smallest-unit (6 decimals)
      } catch (err: unknown) {
        // TokenAccountNotFoundError means 0 balance (no ATA created yet)
        if (err && typeof err === "object" && "name" in err && (err as { name: string }).name === "TokenAccountNotFoundError") {
          return 0;
        }
        throw new AppError({
          severity: "warning",
          code: "BALANCE_FETCH_FAILED",
          message: "Failed to fetch wallet balance",
          details: err instanceof Error ? err.message : String(err),
          resolution: "Check RPC connection. Balance will retry on next cycle.",
        });
      }
    }
    ```
  - [x] 4.5 Implement the main `initBlockchainClient()` function that orchestrates startup. **Note:** Session key format is validated by `loadSessionKey()` (base58 decode + Keypair construction). True session key *expiry* cannot be detected until a transaction is attempted — per architecture: "Session key expiry detected by transaction failures." This story does NOT add a `validateSessionKey()` function — expiry detection will be added in Story 2.2+ when trading begins.
    ```typescript
    export interface BlockchainClient {
      connection: Connection;
      keypair: Keypair;
      walletAddress: PublicKey;
    }

    let client: BlockchainClient | null = null;

    export async function initBlockchainClient(): Promise<BlockchainClient> {
      // 1. Load and validate session key format (throws on invalid base58 or wrong length)
      const keypair = loadSessionKey();
      logger.info({ wallet: keypair.publicKey.toBase58() }, "Session key loaded");

      // 2. Connect to RPC (with retry)
      const connection = await createRpcConnection();

      client = { connection, keypair, walletAddress: keypair.publicKey };
      return client;
    }

    export function getBlockchainClient(): BlockchainClient | null {
      return client;
    }
    ```
  - [x] 4.6 Write co-located test: `src/server/blockchain/client.test.ts`. Mock `@solana/web3.js` Connection and `@solana/spl-token`. Test:
    - `loadSessionKey()` throws `AppError` with code `SESSION_KEY_MISSING` when env is empty
    - `loadSessionKey()` throws `AppError` with code `SESSION_KEY_INVALID` when key is malformed
    - `loadSessionKey()` returns Keypair for valid base58 key
    - `createRpcConnection()` retries on failure with correct backoff timing
    - `createRpcConnection()` throws after MAX_RPC_RETRIES failures
    - `getWalletBalance()` returns 0 when no token account exists
    - `getWalletBalance()` returns correct smallest-unit value

- [x] Task 5: Integrate blockchain client into Fastify startup in `src/server/index.ts` (AC: #1, #2, #3)
  - [x] 5.1 Import `initBlockchainClient`, `getWalletBalance`, and the `broadcast` function. After `server.listen()` and `setupWebSocket()`, call `initBlockchainClient()`.
  - [x] 5.2 On successful init, fetch wallet balance and broadcast `connection.status` event with real data:
    ```typescript
    try {
      const blockchainClient = await initBlockchainClient();
      const balance = await getWalletBalance(blockchainClient.connection, blockchainClient.walletAddress);
      broadcast(EVENTS.CONNECTION_STATUS, {
        rpc: true,
        wallet: blockchainClient.walletAddress.toBase58(),
        balance,
      });
      logger.info("Blockchain client initialized, balance broadcast");
    } catch (err) {
      // On failure, broadcast alert
      if (err instanceof AppError) {
        broadcast(EVENTS.ALERT_TRIGGERED, {
          severity: err.severity,
          code: err.code,
          message: err.message,
          details: err.details ?? null,
          resolution: err.resolution ?? null,
        });
      }
      // Don't crash the server — dashboard should show the error
      logger.error({ err }, "Blockchain client initialization failed");
    }
    ```
  - [x] 5.3 **CRITICAL:** The server MUST NOT crash if blockchain init fails. The Fastify server, WebSocket, and dashboard must remain running so the user can see the error on the dashboard. Wrap the blockchain init in try/catch as shown above.
  - [x] 5.4 Import `EVENTS` from `@shared/events` and `AppError` from `./lib/errors.js`. Import `broadcast` from `./ws/broadcaster.js`.
  - [x] 5.5 **Late-connecting clients:** The broadcaster currently sends NO message when a WebSocket client connects (placeholder was removed in Story 1.4 review). If the blockchain client initialized before a browser connects (or reconnects after disconnect), the dashboard stays "Disconnected" until the next event. Fix: in `broadcaster.ts`, update the `on("connection")` handler to send the current connection state to newly connected clients. Import `getBlockchainClient` and `getWalletBalance` from the blockchain module. If `getBlockchainClient()` returns non-null, fetch balance and send a `connection.status` event to the individual new client (not broadcast). If null, send nothing (let the dashboard stay disconnected until blockchain init completes).

- [x] Task 6: Add `alert.triggered` handling to Zustand store and dashboard (AC: #2, #3)
  - [x] 6.1 In `src/shared/types.ts`, add the `Alert` type (scoped for this story — Story 2.1 may extend it):
    ```typescript
    export interface Alert {
      id: number;
      severity: "info" | "warning" | "critical";
      code: string;
      message: string;
      details: string | null;
      resolution: string | null;
      timestamp: number;
    }
    ```
  - [x] 6.2 In `src/shared/events.ts`, add `AlertTriggeredPayload`:
    ```typescript
    export interface AlertTriggeredPayload {
      severity: "info" | "warning" | "critical";
      code: string;
      message: string;
      details: string | null;
      resolution: string | null;
    }
    ```
  - [x] 6.3 In `src/client/store/index.ts`, add an `alerts` slice and handle `alert.triggered` events:
    ```typescript
    // Add to store interface:
    alerts: Alert[];
    addAlert: (alert: Alert) => void;
    dismissAlert: (id: number) => void;  // Use alert.id, NOT array index

    // Initialize alerts: []
    // Each alert gets a unique id via an incrementing counter:
    let alertIdCounter = 0;

    // In handleWsMessage, add case for EVENTS.ALERT_TRIGGERED:
    // CRITICAL: Validate payload shape before use (same pattern as connection.status validation)
    case EVENTS.ALERT_TRIGGERED: {
      const data = message.data as Record<string, unknown>;
      if (
        typeof data?.severity === "string" &&
        typeof data?.code === "string" &&
        typeof data?.message === "string"
      ) {
        const alert: Alert = {
          id: ++alertIdCounter,
          severity: data.severity as Alert["severity"],
          code: data.code,
          message: data.message,
          details: typeof data.details === "string" ? data.details : null,
          resolution: typeof data.resolution === "string" ? data.resolution : null,
          timestamp: message.timestamp,
        };
        set((state) => ({ alerts: [...state.alerts, alert] }));
      }
      break;
    }

    // dismissAlert implementation:
    dismissAlert: (id) => set((state) => ({
      alerts: state.alerts.filter((a) => a.id !== id),
    })),
    ```
  - [x] 6.4 Create `src/client/components/alert-banner.tsx` — the critical alert banner component that renders ABOVE the dashboard. Per UX spec:
    - **Critical (red):** Session expired, RPC failed — persistent, cannot be dismissed
    - **Warning (amber):** Can be dismissed but re-appears if unresolved
    - Shows message, details (expandable), and resolution steps
    - Uses `bg-loss/10` with `border-loss` for critical, `bg-warning/10` with `border-warning` for warning
    - Resolution text rendered with `whitespace-pre-line` to preserve newlines from resolution field
    - Add `role="alert"` and `aria-live="assertive"` for accessibility
  - [x] 6.5 In `src/client/App.tsx`, **replace** the existing empty `<div />` placeholder (with comment `{/* Alert Banner slot — reserved for Story 3.4 */}`) with the `AlertBanner` component. Read alerts from store: `const alerts = useStore(s => s.alerts)`. Filter to only critical/warning alerts (info toasts are Story 3.4). Pass filtered alerts and `dismissAlert` action as props to `AlertBanner`.
  - [x] 6.6 Write tests:
    - `src/client/store/index.test.ts` — add tests for `addAlert`, `dismissAlert`, `handleWsMessage` with `alert.triggered` event
    - `src/client/components/alert-banner.test.tsx` — test renders critical alert with message and resolution, test warning alert is dismissable, test no banner when no alerts

- [x] Task 7: Update `.env.example` (AC: #1)
  - [x] 7.1 Verify `.env.example` already has `SESSION_KEY`, `RPC_URL`, `PORT`, `VALBOT_DB_PATH`. No new env vars needed — USDC mint is hardcoded in `client.ts` (change the constant if FOGOChain uses a different mint).

- [x] Task 8: End-to-end verification (AC: #1, #2, #3)
  - [x] 8.1 Verify existing store behavior works with real balance data: the store's `updateConnection` already handles `connection.status` events and updates `connection.walletBalance` + `stats.walletBalance`. The SummaryBar already formats by dividing by 1e6 with `$` prefix (Story 1.4). No code changes expected — verify in tests.
  - [x] 8.2 Verify end-to-end flow manually:
    - With valid `.env` → dashboard shows "Connected" + wallet balance
    - With invalid SESSION_KEY → dashboard shows critical alert banner with resolution steps
    - With unreachable RPC_URL → dashboard shows critical alert after retries
  - [x] 8.3 Run `pnpm test` — all existing + new tests pass
  - [x] 8.4 Run `pnpm build` — production build succeeds with zero errors

### Review Findings

- [x] [Review][Decision] **RPC URL may leak API key via alert broadcast** — Accepted as-is: localhost-only single-user app, user already has RPC URL in .env. No real leak risk.
- [x] [Review][Patch] **`broadcaster.ts` orchestrates RPC call outside `blockchain/` boundary** — Added `getConnectionStatus()` facade in `blockchain/client.ts`. Updated `broadcaster.ts` and `server/index.ts` to use facade.
- [x] [Review][Patch] **Late-connecting clients don't receive current alert state** — Broadcast disconnected `connection.status` on init failure. Added `cacheAlert()` to broadcaster for alert replay to new clients.
- [x] [Review][Patch] Non-`AppError` exceptions during blockchain init — now wrapped in generic `AppError` before broadcast.
- [x] [Review][Patch] Balance fetch error in `broadcaster.ts` — added `logger.warn` in `.catch()`.
- [x] [Review][Patch] `pino-pretty` runtime guard — changed condition from `!== "production"` to `=== "development"` so unset `NODE_ENV` defaults to plain JSON.
- [x] [Review][Patch] Unbounded alert accumulation — alerts now deduplicated by `code` (replaces existing alert with same code).
- [x] [Review][Patch] `data.severity` validation — now checked against `VALID_SEVERITIES` set before accepting.
- [x] [Review][Fixed] `alertIdCounter` resets on HMR — initialized from `Date.now()` for HMR-safe unique IDs
- [x] [Review][Fixed] `Number(account.amount)` precision — added `MAX_SAFE_INTEGER` guard with warning log and clamping
- [x] [Review][Fixed] RPC call on every WS connection — added 5s TTL cache on `getConnectionStatus()`
- [x] [Review][Fixed] `loadSessionKey` key length — added explicit 64-byte length check with clear error message
- [x] [Review][Fixed] Session key error details sanitization — raw error messages no longer forwarded to client, logged server-side only

## Dev Notes

### Critical Architecture Constraints

- **Boundary rule:** `src/server/blockchain/` is the ONLY code that touches FOGOChain RPC. No other layer imports `@solana/web3.js`. The blockchain client exposes typed functions — callers get results or `AppError`.
- **AppError is mandatory.** Architecture mandates ALL errors use the `AppError` class. NEVER `throw new Error("something")`. Every error MUST have severity, code, message, and resolution.
- **Session keys MUST NOT be logged.** Use `logger.info({ wallet: publicKey.toBase58() })` — NEVER log the secret key, private key, or SESSION_KEY env value.
- **All monetary values are integer smallest-unit** (ADR-001). USDC has 6 decimals, so `1 USDC = 1_000_000`. The `getWalletBalance()` function returns raw smallest-unit integers. The frontend divides by 1e6 for display (already implemented in Story 1.4's SummaryBar formatting).
- **Server must not crash on blockchain failure.** The Fastify server, WebSocket, and dashboard must keep running. Blockchain errors are caught and broadcast as alerts.
- **Use `@solana/web3.js` v1.x** (stable, class-based API). Do NOT use v2/kit — it has breaking API differences and is less proven for custom SVM chains.

### Existing Code to Reuse (DO NOT recreate)

- **`src/server/ws/broadcaster.ts`** — already has `broadcast(event, data)`, `setupWebSocket()`, and `closeWebSocket()`. Import and use `broadcast()` to send `connection.status` and `alert.triggered` events. This story also modifies the `on("connection")` handler to send current blockchain status to newly connected clients. Do NOT create a new broadcast mechanism.
- **`src/shared/events.ts`** — already has `EVENTS.CONNECTION_STATUS` and `EVENTS.ALERT_TRIGGERED` constants, `ConnectionStatusPayload` type, `WsMessage` type. EXTEND these, do not recreate.
- **`src/shared/types.ts`** — already has `ConnectionStatus`, `ConnectionState`, `SummaryStats`. Add `Alert` type here.
- **`src/client/store/index.ts`** — already handles `connection.status` events and updates `walletBalance` in both `connection` and `stats` slices. Add `alerts` slice and `alert.triggered` handling.
- **`src/client/components/top-bar.tsx`** — already shows connection status (green/yellow/red dot) and formats wallet balance from store. No changes needed for this story.
- **`src/server/index.ts`** — already imports dotenv/config, sets up Fastify, calls `setupWebSocket()`. Add blockchain init AFTER these.
- **`cn()` utility** at `src/client/lib/utils.ts` — use for conditional class merging in AlertBanner.

### What NOT to Do

- Do NOT implement `contracts.ts` (open/close position) — Story 2.2+
- Do NOT implement `oracle.ts` (Pyth price feeds) — Story 4.1
- Do NOT add REST API routes for blockchain state — Story 2.1
- Do NOT implement graceful shutdown for blockchain — Story 3.2
- Do NOT add RPC connection health polling/reconnection loop — this story does initial connection at startup only
- Do NOT implement toast notifications (info/warning level) — Story 3.4. Only the critical/warning AlertBanner for this story
- Do NOT add `validateSessionKey()` that tries to detect expiry via RPC — expiry is only detectable on transaction failure (Story 2.2+)
- Do NOT use `@solana/web3.js` v2 or `@solana/kit` — use v1.x stable
- Do NOT use Socket.io — use existing `ws`-based broadcaster
- Do NOT create a `__tests__/` directory — co-locate tests with source
- Do NOT expose session key in any API response, WebSocket payload, or log output

### Project Structure Notes

```
src/server/
├── blockchain/
│   ├── client.ts          # NEW — RPC connection, session key loading, balance query, retry logic
│   └── client.test.ts     # NEW — unit tests with mocked @solana/web3.js
├── lib/
│   ├── errors.ts          # NEW — AppError class + factory functions
│   ├── errors.test.ts     # NEW — AppError tests
│   └── logger.ts          # NEW — Pino logger (dev pretty-print, prod JSON)
├── ws/
│   └── broadcaster.ts     # MODIFY — add initial status send to new WS clients if blockchain is initialized
├── index.ts               # MODIFY — add blockchain init after server.listen() + setupWebSocket()
src/shared/
├── types.ts               # MODIFY — add Alert type
├── events.ts              # MODIFY — add AlertTriggeredPayload type
src/client/
├── store/
│   └── index.ts           # MODIFY — add alerts slice, handle alert.triggered events
├── components/
│   ├── alert-banner.tsx   # NEW — critical/warning alert banner above dashboard
│   └── alert-banner.test.tsx  # NEW — alert banner tests
├── App.tsx                # MODIFY — render AlertBanner above dashboard grid
```

### Previous Story Intelligence

**From Story 1.4 (SummaryBar & Connection Status) — CRITICAL learnings:**
- `broadcast()` in `broadcaster.ts` was updated to accept typed `EventName` parameter (not generic string). Import `EVENTS` constants to call `broadcast(EVENTS.CONNECTION_STATUS, data)`.
- The initial placeholder `connection.status` message was REMOVED in Story 1.4 code review — the broadcaster no longer sends a message on client connect. THIS story must send the real `connection.status` after blockchain init.
- Store's `handleWsMessage` validates `ConnectionStatusPayload` shape before use (checks rpc/wallet/balance types). Ensure the broadcast payload matches exactly: `{ rpc: boolean, wallet: string, balance: number }`.
- `updateConnection` in the store updates BOTH `connection.walletBalance` AND `stats.walletBalance` when a `connection.status` event arrives.
- Disconnected status shows red dot (`bg-loss`) not gray — was fixed in code review.
- `@client` path alias is used for client imports. `@shared` path alias for shared imports.
- Each client test file needs `// @vitest-environment jsdom` docblock.
- `vitest.config.ts` excludes `dist/` from test discovery.
- `tsconfig.server.json` excludes test files from server compilation.

**From Story 1.2 (Database Schema):**
- ADR-001: Integer smallest-unit for all monetary values. USDC × 1e6.
- ADR-002: Lazy initialization pattern via `getDb()`. Apply same pattern to blockchain client — `getBlockchainClient()` returns cached instance or null.

**From Story 1.1 (Project Scaffolding):**
- `dotenv/config` is already imported at the top of `src/server/index.ts` — env vars are loaded before any other code runs.
- Vite proxy for `/api` and `/ws` already configured.

### Git Intelligence

Recent commits follow pattern: `feat: add <description> (Story X-Y)`. All prior story code reviews resolved — no deferred fixes.

### Technical Research Notes

**@solana/web3.js v1.x (stable):**
- `Connection` class: `new Connection(rpcUrl, "confirmed")` — use `"confirmed"` commitment for balance queries
- `Keypair.fromSecretKey(bs58.decode(base58String))` — session keys are base58-encoded 64-byte secret keys
- `connection.getBalance(publicKey)` — returns SOL balance in lamports
- `connection.getLatestBlockhash()` — lightweight RPC health check (use for connection validation)

**@solana/spl-token:**
- `getAssociatedTokenAddress(mint, owner)` — derives the ATA address for a wallet+token pair
- `getAccount(connection, ata)` — returns token account with `amount` (bigint)
- Throws `TokenAccountNotFoundError` if wallet has never held the token — handle as 0 balance

**FOGOChain specifics:**
- SVM-compatible chain — standard `@solana/web3.js` works with custom RPC URL
- Default RPC: `https://rpc.fogo.chain` (from `.env.example`)
- USDC mint is hardcoded to Solana mainnet USDC (`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`). If FOGOChain uses a different mint, update the `USDC_MINT` constant in `client.ts`
- Gas covered by Fogo sessions — no SOL balance needed for gas

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.5] — Acceptance criteria, three scenarios
- [Source: _bmad-output/planning-artifacts/architecture.md#Blockchain Client] — client.ts structure, retry logic, contract interface
- [Source: _bmad-output/planning-artifacts/architecture.md#Authentication & Security] — Session key patterns, no key logging, localhost-only
- [Source: _bmad-output/planning-artifacts/architecture.md#Error Handling] — AppError class, severity levels, resolution fields
- [Source: _bmad-output/planning-artifacts/architecture.md#WebSocket Event Catalog] — connection.status and alert.triggered event shapes
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#AlertBanner] — Critical/warning banner UX, three-tier error system
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Journey 3] — Session key expiry flow, RPC failure flow
- [Source: _bmad-output/planning-artifacts/prd.md#FR27-FR29] — Session key authentication requirements
- [Source: _bmad-output/planning-artifacts/prd.md#Security Model] — No key exposure in logs/UI, localhost-only
- [Source: _bmad-output/project-context.md#RPC & Blockchain Rules] — Retry pattern, session key rules
- [Source: _bmad-output/implementation-artifacts/1-4-summarybar-and-connection-status.md] — Previous story learnings, broadcaster changes, store shape

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- bs58 v6 ships its own types; `@types/bs58` is deprecated — removed after initial install
- pino does not resolve from Fastify's deps under pnpm strict hoisting — installed explicitly
- `vi.resetModules()` causes `instanceof AppError` to fail across dynamic imports — used property-based assertions instead
- `@testing-library/user-event` was not installed — added as dev dependency

### Completion Notes List

- **Task 1:** Installed `@solana/web3.js` v1.98.4, `@solana/spl-token` v0.4.14, `bs58` v6.0.0. Build verified.
- **Task 2:** Created `AppError` class with severity/code/message/details/resolution fields and 3 factory functions (`sessionKeyExpiredError`, `sessionKeyInvalidError`, `rpcConnectionFailedError`). 6 tests passing.
- **Task 3:** Created Pino logger with pino-pretty dev transport. Installed `pino` v10.3.1 and `pino-pretty` v13.1.3. Session key is never logged — only wallet public key.
- **Task 4:** Created FOGOChain RPC client with `loadSessionKey()`, `createRpcConnection()` (exponential backoff retry), `getWalletBalance()` (USDC via SPL token ATA), and `initBlockchainClient()` orchestrator. 9 tests passing.
- **Task 5:** Integrated blockchain init into Fastify startup after `setupWebSocket()`. Server does not crash on blockchain failure — errors broadcast as alerts. Updated broadcaster to send `connection.status` to newly connected WebSocket clients if blockchain is already initialized.
- **Task 6:** Added `Alert` type to shared types, `AlertTriggeredPayload` to events. Extended Zustand store with `alerts` slice, `addAlert`, `dismissAlert`, and `alert.triggered` WebSocket handler. Created `AlertBanner` component with critical (persistent) and warning (dismissable) variants. Integrated into `App.tsx`. 10 new tests (5 store + 5 component).
- **Task 7:** Verified `.env.example` — already has `SESSION_KEY` and `RPC_URL`. No changes needed.
- **Task 8:** Full test suite: 92 tests across 13 files, all passing. Production build succeeds.

### Change Log

- 2026-04-04: Story 1.5 implementation complete — FOGOChain connection, session key authentication, AppError framework, alert banner UI

### File List

New files:
- src/server/lib/errors.ts
- src/server/lib/errors.test.ts
- src/server/lib/logger.ts
- src/server/blockchain/client.ts
- src/server/blockchain/client.test.ts
- src/client/components/alert-banner.tsx
- src/client/components/alert-banner.test.tsx

Modified files:
- src/server/index.ts
- src/server/ws/broadcaster.ts
- src/shared/types.ts
- src/shared/events.ts
- src/client/store/index.ts
- src/client/store/index.test.ts
- src/client/App.tsx
- package.json
- pnpm-lock.yaml
