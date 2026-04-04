import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress, getAccount } from "@solana/spl-token";
import bs58 from "bs58";
import { logger } from "../lib/logger.js";
import {
  AppError,
  sessionKeyInvalidError,
  rpcConnectionFailedError,
} from "../lib/errors.js";

const MAX_RPC_RETRIES = 3;
const BACKOFF_BASE_MS = 1000;
// USDC mint address — standard across Solana/SVM chains
// If FOGOChain uses a different USDC mint, update this constant
const USDC_MINT = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
);

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
    if (secretKey.length !== 64) {
      throw sessionKeyInvalidError(
        `Expected 64-byte secret key, got ${secretKey.length} bytes`,
      );
    }
    return Keypair.fromSecretKey(secretKey);
  } catch (err) {
    if (err instanceof AppError) throw err;
    // Sanitize: don't forward raw error message — it may contain key fragments
    logger.error({ err }, "Session key decode failed");
    throw sessionKeyInvalidError("Failed to decode base58 key — check format");
  }
}

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
      logger.warn(
        { attempt, maxRetries: MAX_RPC_RETRIES, rpcUrl },
        "RPC connection attempt failed",
      );
      if (attempt < MAX_RPC_RETRIES) {
        const delay = Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), 4000);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw rpcConnectionFailedError(rpcUrl, MAX_RPC_RETRIES);
}

export async function getWalletBalance(
  connection: Connection,
  wallet: PublicKey,
): Promise<number> {
  try {
    const ata = await getAssociatedTokenAddress(USDC_MINT, wallet);
    const account = await getAccount(connection, ata);
    // account.amount is bigint — convert to number (smallest-unit, 6 decimals)
    if (account.amount > BigInt(Number.MAX_SAFE_INTEGER)) {
      logger.warn({ amount: account.amount.toString() }, "Balance exceeds MAX_SAFE_INTEGER, clamping");
      return Number.MAX_SAFE_INTEGER;
    }
    return Number(account.amount);
  } catch (err: unknown) {
    // TokenAccountNotFoundError means 0 balance (no ATA created yet)
    if (
      err &&
      typeof err === "object" &&
      "name" in err &&
      (err as { name: string }).name === "TokenAccountNotFoundError"
    ) {
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

export interface ConnectionStatusData {
  rpc: boolean;
  wallet: string;
  balance: number;
}

const STATUS_CACHE_TTL_MS = 5000;
let cachedStatus: { data: ConnectionStatusData; expiry: number } | null = null;

export async function getConnectionStatus(): Promise<ConnectionStatusData | null> {
  if (!client) return null;
  if (cachedStatus && Date.now() < cachedStatus.expiry) {
    return cachedStatus.data;
  }
  const balance = await getWalletBalance(client.connection, client.walletAddress);
  const data: ConnectionStatusData = {
    rpc: true,
    wallet: client.walletAddress.toBase58(),
    balance,
  };
  cachedStatus = { data, expiry: Date.now() + STATUS_CACHE_TTL_MS };
  return data;
}
