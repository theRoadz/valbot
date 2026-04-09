import { privateKeyToAccount } from "viem/accounts";
import type { PrivateKeyAccount } from "viem";
import { HttpTransport, ExchangeClient, InfoClient, HttpRequestError } from "@nktkas/hyperliquid";
import { logger } from "../lib/logger.js";
import {
  AppError,
  sessionKeyInvalidError,
  apiConnectionFailedError,
  walletAddressMissingError,
  sessionKeyMissingError,
  walletAddressInvalidError,
  balanceFetchFailedError,
} from "../lib/errors.js";
import { broadcast, cacheAlert } from "../ws/broadcaster.js";
import { EVENTS } from "../../shared/events.js";

const MAX_API_RETRIES = 3;
const BACKOFF_BASE_MS = 1000;

// --- API health state ---
let apiHealthy = true;
let _retrying = false;

export function isApiHealthy(): boolean {
  return apiHealthy;
}

// --- Retry utilities ---

const WRITE_UNSAFE_PATTERNS = [
  "ETIMEDOUT",
  "AbortError",
  "socket hang up",
  "UND_ERR_HEADERS_TIMEOUT",
  "ECONNRESET",
];

export function isRetriableError(err: unknown, writeCall: boolean): boolean {
  if (err instanceof AppError) return false;
  if (err instanceof HttpRequestError) {
    if (writeCall) {
      const msg = err.message || "";
      if (WRITE_UNSAFE_PATTERNS.some((p) => msg.includes(p))) return false;
    }
    return true;
  }
  // Unknown error — check message for network patterns
  if (err instanceof Error) {
    const msg = err.message || "";
    if (writeCall && WRITE_UNSAFE_PATTERNS.some((p) => msg.includes(p))) return false;
    const networkPatterns = ["ECONNREFUSED", "ENOTFOUND", "fetch failed", "ECONNRESET", "network"];
    if (networkPatterns.some((p) => msg.toLowerCase().includes(p.toLowerCase()))) return true;
  }
  // Default: retriable for read calls, not for write calls
  return !writeCall;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  opts?: { writeCall?: boolean },
): Promise<T> {
  const writeCall = opts?.writeCall ?? false;

  // Fast path: if API is healthy, just call fn. On success, restore health
  // in case a previous exhaustion left apiHealthy = false (recovery on next success).
  try {
    const result = await fn();
    if (!apiHealthy) {
      apiHealthy = true;
      broadcast(EVENTS.ALERT_TRIGGERED, {
        severity: "info",
        code: "API_CONNECTION_FAILED",
        message: "API reconnected — trading resumed",
        details: null,
        resolution: null,
        autoDismissMs: 5000,
      });
      broadcast(EVENTS.CONNECTION_STATUS, {
        rpc: true,
        wallet: client?.walletAddress ?? "",
        equity: cachedStatus?.data.equity ?? 0,
        available: cachedStatus?.data.available ?? 0,
      });
    }
    return result;
  } catch (firstErr) {
    if (!isRetriableError(firstErr, writeCall)) throw firstErr;

    // Concurrency guard: if another retry sequence is active, fail fast
    // Exception: closePosition is a critical safety path — always allow its initial attempt
    if (_retrying) {
      throw apiConnectionFailedError(MAX_API_RETRIES);
    }

    _retrying = true;
    apiHealthy = false;

    try {
      for (let attempt = 1; attempt <= MAX_API_RETRIES; attempt++) {
        // Broadcast retry progress (warning first, then connection status)
        broadcast(EVENTS.ALERT_TRIGGERED, {
          severity: "warning",
          code: "API_CONNECTION_FAILED",
          message: `API connection lost — retrying (${attempt}/${MAX_API_RETRIES})...`,
          details: `${label}: ${firstErr instanceof Error ? firstErr.message : String(firstErr)}`,
          resolution: null,
        });

        broadcast(EVENTS.CONNECTION_STATUS, {
          rpc: false,
          wallet: client?.walletAddress ?? "",
          equity: cachedStatus?.data.equity ?? 0,
          available: cachedStatus?.data.available ?? 0,
        });

        const delay = Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), 4000);
        logger.warn({ attempt, maxRetries: MAX_API_RETRIES, label }, "API retry attempt");
        await new Promise((r) => setTimeout(r, delay));

        try {
          const result = await fn();
          // Success — restore health
          apiHealthy = true;
          _retrying = false;

          broadcast(EVENTS.ALERT_TRIGGERED, {
            severity: "info",
            code: "API_CONNECTION_FAILED",
            message: "API reconnected — trading resumed",
            details: null,
            resolution: null,
          });

          broadcast(EVENTS.CONNECTION_STATUS, {
            rpc: true,
            wallet: client?.walletAddress ?? "",
            equity: cachedStatus?.data.equity ?? 0,
            available: cachedStatus?.data.available ?? 0,
          });

          return result;
        } catch (retryErr) {
          if (!isRetriableError(retryErr, writeCall)) {
            // Non-retriable error during retry — API is reachable (domain error, not network)
            // Restore healthy state so mode-runner iterations aren't blocked
            apiHealthy = true;
            _retrying = false;
            broadcast(EVENTS.CONNECTION_STATUS, {
              rpc: true,
              wallet: client?.walletAddress ?? "",
              equity: cachedStatus?.data.equity ?? 0,
              available: cachedStatus?.data.available ?? 0,
            });
            throw retryErr;
          }
          // Continue to next retry
        }
      }

      // All retries exhausted
      _retrying = false;
      // apiHealthy stays false — will recover on next successful call

      const criticalAlert = {
        severity: "critical" as const,
        code: "API_CONNECTION_FAILED",
        message: `API connection failed after ${MAX_API_RETRIES} retries — check network`,
        details: `${label}: ${firstErr instanceof Error ? firstErr.message : String(firstErr)}`,
        resolution: "1. Check your internet connection\n2. Verify WALLET address in .env is correct\n3. Check Hyperliquid API status\n4. Restart the bot",
      };
      broadcast(EVENTS.ALERT_TRIGGERED, criticalAlert);
      cacheAlert(criticalAlert);

      broadcast(EVENTS.CONNECTION_STATUS, {
        rpc: false,
        wallet: client?.walletAddress ?? "",
        equity: cachedStatus?.data.equity ?? 0,
        available: cachedStatus?.data.available ?? 0,
      });

      throw apiConnectionFailedError(MAX_API_RETRIES);
    } catch (err) {
      _retrying = false;
      throw err;
    }
  }
}

export function loadAgentWallet(): PrivateKeyAccount {
  const sessionKeyStr = process.env.SESSION_KEY;
  if (!sessionKeyStr) {
    throw sessionKeyMissingError();
  }
  try {
    const trimmed = sessionKeyStr.trim();
    // Normalize: accept raw hex or 0x-prefixed hex
    const hex = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
    // Validate hex format: 0x + 64 hex chars = 32 bytes
    if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) {
      throw sessionKeyInvalidError(
        `Expected 0x-prefixed 64-char hex key (32 bytes), got ${trimmed.length} chars`,
      );
    }
    const account = privateKeyToAccount(hex as `0x${string}`);
    return account;
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.error({ err }, "Session key decode failed");
    throw sessionKeyInvalidError(
      "Failed to decode session key — must be 0x-prefixed 32-byte hex.",
    );
  }
}

function loadWalletAddress(): `0x${string}` {
  const wallet = process.env.WALLET;
  if (!wallet) {
    throw walletAddressMissingError();
  }
  const trimmed = wallet.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
    throw walletAddressInvalidError(`Got: ${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`);
  }
  if (/^0x0+$/.test(trimmed)) {
    throw walletAddressInvalidError("Zero address is not allowed");
  }
  return trimmed as `0x${string}`;
}

export interface BlockchainClient {
  exchange: ExchangeClient;
  info: InfoClient;
  walletAddress: `0x${string}`; // 0x master wallet — for info queries and vault address
  agentAddress: string; // 0x derived from SESSION_KEY — for signing
}

// Immutable singleton — wallet/agent addresses are fixed after init.
// Restart required if .env changes.
let client: BlockchainClient | null = null;

export async function initBlockchainClient(): Promise<BlockchainClient> {
  // 1. Load and validate agent key
  const agentAccount = loadAgentWallet();
  logger.info({ agentAddress: agentAccount.address }, "Agent key loaded");

  // 2. Load and validate master wallet address
  const walletAddress = loadWalletAddress();
  logger.info({ walletAddress }, "Master wallet address loaded");

  // 3. Create transport and clients
  const transport = new HttpTransport();
  const exchange = new ExchangeClient({ transport, wallet: agentAccount });
  const info = new InfoClient({ transport });

  // 4. Validate connection with retry
  for (let attempt = 1; attempt <= MAX_API_RETRIES; attempt++) {
    try {
      await info.clearinghouseState({ user: walletAddress });
      logger.info("Connected to Hyperliquid API");
      break;
    } catch (err) {
      logger.warn(
        { attempt, maxRetries: MAX_API_RETRIES },
        "Hyperliquid API connection attempt failed",
      );
      if (attempt === MAX_API_RETRIES) {
        throw apiConnectionFailedError(MAX_API_RETRIES);
      }
      const delay = Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), 4000);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  client = { exchange, info, walletAddress, agentAddress: agentAccount.address };
  return client;
}

export function getBlockchainClient(): BlockchainClient | null {
  return client;
}

export interface WalletBalances {
  equity: number;    // smallest-unit — total account value (margin + unrealized PnL)
  available: number; // smallest-unit — withdrawable cash for new trades
}

export async function getWalletBalances(
  info: InfoClient,
  walletAddress: string,
): Promise<WalletBalances> {
  try {
    const spotState = await withRetry(
      () => info.spotClearinghouseState({ user: walletAddress }),
      "getWalletBalances",
    );
    const usdcBalance = spotState.balances.find(
      (b: { coin: string }) => b.coin === "USDC",
    );
    const total = usdcBalance ? parseFloat(usdcBalance.total) : 0;
    const hold = usdcBalance ? parseFloat(usdcBalance.hold) : 0;
    return {
      equity: Math.round(total * 1e6),
      available: Math.round((total - hold) * 1e6),
    };
  } catch (err) {
    // Re-throw connection failures so callers see the real error
    if (err instanceof AppError && err.code === "API_CONNECTION_FAILED") throw err;
    throw balanceFetchFailedError(err instanceof Error ? err.message : String(err));
  }
}

export interface ConnectionStatusData {
  rpc: boolean;
  wallet: string;
  equity: number;
  available: number;
}

const STATUS_CACHE_TTL_MS = 5000;
let cachedStatus: { data: ConnectionStatusData; expiry: number } | null = null;

const FUNDING_CACHE_TTL_MS = 10_000;
let cachedFundings: { data: Map<string, { rate: number; nextFundingTime: number }>; expiry: number } | null = null;

export async function getPredictedFundings(
  info: InfoClient,
): Promise<Map<string, { rate: number; nextFundingTime: number }>> {
  if (cachedFundings && Date.now() < cachedFundings.expiry) {
    return cachedFundings.data;
  }

  const raw = await withRetry(
    () => info.predictedFundings(),
    "getPredictedFundings",
  );

  const result = new Map<string, { rate: number; nextFundingTime: number }>();

  if (!Array.isArray(raw)) {
    logger.warn({ mode: "arbitrage" }, "predictedFundings returned non-array response");
    return result;
  }

  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const [asset, exchanges] = entry as [string, [string, { fundingRate: string; nextFundingTime: number; fundingIntervalHours?: number } | null][]];
    if (typeof asset !== "string" || !Array.isArray(exchanges)) continue;

    for (const [exchange, data] of exchanges) {
      if (exchange === "Hyperliquid" && data !== null) {
        const rate = parseFloat(data.fundingRate);
        if (!Number.isFinite(rate)) continue;
        result.set(asset, {
          rate,
          nextFundingTime: data.nextFundingTime,
        });
        break;
      }
    }
  }

  cachedFundings = { data: result, expiry: Date.now() + FUNDING_CACHE_TTL_MS };
  return result;
}

export async function getConnectionStatus(): Promise<ConnectionStatusData | null> {
  if (!client) return null;
  if (cachedStatus && Date.now() < cachedStatus.expiry) {
    return cachedStatus.data;
  }
  try {
    const balances = await getWalletBalances(client.info, client.walletAddress);
    const data: ConnectionStatusData = {
      rpc: true,
      wallet: client.walletAddress,
      ...balances,
    };
    cachedStatus = { data, expiry: Date.now() + STATUS_CACHE_TTL_MS };
    return data;
  } catch (err) {
    // Stale-while-revalidate: return last known good data if available
    if (cachedStatus) {
      logger.warn({ err }, "Balance fetch failed, returning stale cached status");
      return cachedStatus.data;
    }
    throw err;
  }
}
