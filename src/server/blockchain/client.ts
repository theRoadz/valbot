import { privateKeyToAccount } from "viem/accounts";
import type { PrivateKeyAccount } from "viem";
import { HttpTransport, ExchangeClient, InfoClient } from "@nktkas/hyperliquid";
import { logger } from "../lib/logger.js";
import {
  AppError,
  sessionKeyInvalidError,
  apiConnectionFailedError,
  walletAddressMissingError,
} from "../lib/errors.js";

const MAX_API_RETRIES = 3;
const BACKOFF_BASE_MS = 1000;

export function loadAgentWallet(): PrivateKeyAccount {
  const sessionKeyStr = process.env.SESSION_KEY;
  if (!sessionKeyStr) {
    throw new AppError({
      severity: "critical",
      code: "SESSION_KEY_MISSING",
      message: "SESSION_KEY not found in .env",
      resolution:
        "Add SESSION_KEY=0x<64-char-hex> to .env file. Must be a 0x-prefixed 32-byte hex key.",
    });
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
    throw new AppError({
      severity: "critical",
      code: "WALLET_ADDRESS_INVALID",
      message: "WALLET address is invalid — must be 0x-prefixed 40-char hex (20 bytes)",
      resolution:
        "Set WALLET=0x<your-master-wallet-address> in .env. This is the master wallet from Valiant, not the agent key.",
    });
  }
  return trimmed as `0x${string}`;
}

export interface BlockchainClient {
  exchange: ExchangeClient;
  info: InfoClient;
  walletAddress: string; // 0x master wallet — for info queries
  agentAddress: string; // 0x derived from SESSION_KEY — for signing
}

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
    const spotState = await info.spotClearinghouseState({ user: walletAddress });
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
    throw new AppError({
      severity: "warning",
      code: "BALANCE_FETCH_FAILED",
      message: "Failed to fetch wallet balances",
      details: err instanceof Error ? err.message : String(err),
      resolution: "Check Hyperliquid API connection. Balance will retry on next cycle.",
    });
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
