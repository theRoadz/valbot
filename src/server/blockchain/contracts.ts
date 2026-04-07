import type { ExchangeClient, InfoClient } from "@nktkas/hyperliquid";
import type { TradeSide } from "../../shared/types.js";
import { logger } from "../lib/logger.js";
import {
  assetNotFoundError,
  midPriceUnavailableError,
  midPriceInvalidError,
  orderFailedError,
  orderNotFilledError,
  closeFailedError,
  closeNotFilledError,
  stopLossSubmissionFailedError,
} from "../lib/errors.js";
import { withRetry } from "./client.js";

// Estimated taker fee rate — Hyperliquid doesn't return fees in order responses,
// so we approximate. Actual fees vary by volume tier (0.01%-0.035%).
// Override via TAKER_FEE_RATE env var if needed.
const TAKER_FEE_RATE = parseFloat(process.env.TAKER_FEE_RATE || "0.00025");

// Hyperliquid minimum order notional value
const MIN_ORDER_VALUE = 10_000_000; // $10 in smallest-unit

// --- Asset index cache ---

interface AssetInfo {
  index: number;
  coin: string;
  szDecimals: number;
}

const assetCache = new Map<string, AssetInfo>();
const ASSET_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
let assetCacheExpiry = 0;
let cachedInfoClient: InfoClient | null = null;

export async function initAssetIndices(
  info: InfoClient,
): Promise<void> {
  cachedInfoClient = info;
  await refreshAssetCache(info);
}

async function refreshAssetCache(info: InfoClient): Promise<void> {
  const meta = await withRetry(() => info.meta(), "refreshAssetCache");
  assetCache.clear();
  for (let i = 0; i < meta.universe.length; i++) {
    const asset = meta.universe[i];
    assetCache.set(asset.name, {
      index: i,
      coin: asset.name,
      szDecimals: asset.szDecimals,
    });
  }
  assetCacheExpiry = Date.now() + ASSET_CACHE_TTL_MS;
  logger.info({ assetCount: assetCache.size }, "Asset indices loaded");
}

export function resolveAsset(
  pair: string,
): AssetInfo {
  // Convert "BTC/USDC" → "BTC"
  const coin = pair.split("/")[0];
  const info = assetCache.get(coin);
  if (!info) {
    // Trigger background refresh if cache is stale — next call may succeed
    if (cachedInfoClient && Date.now() > assetCacheExpiry) {
      refreshAssetCache(cachedInfoClient).catch((err) =>
        logger.warn({ err }, "Background asset cache refresh failed"),
      );
    }
    throw assetNotFoundError(pair);
  }
  return info;
}

// --- Param / Result interfaces ---

export interface OpenPositionParams {
  exchange: ExchangeClient;
  info: InfoClient;
  pair: string;
  side: TradeSide;
  size: number; // smallest-unit
  slippage: number;
  vaultAddress: `0x${string}`;
}

export interface OpenPositionResult {
  txHash: string;
  positionId: string;
  entryPrice: number; // smallest-unit
  actualSize?: number; // smallest-unit — filled notional; undefined if not available
  filledSz: string; // exact base-unit size from exchange (e.g., "0.08")
}

export interface ClosePositionParams {
  exchange: ExchangeClient;
  info: InfoClient;
  positionId: string;
  pair: string;
  side: TradeSide;
  size: number; // smallest-unit
  baseSz?: string; // exact base-unit size; if provided, skip re-derivation from USDC/price
  vaultAddress: `0x${string}`;
}

export interface ClosePositionResult {
  txHash: string;
  exitPrice: number; // smallest-unit
  pnl: number; // smallest-unit
  fees: number; // smallest-unit
}

export interface SetStopLossParams {
  exchange: ExchangeClient;
  pair: string;
  side: TradeSide;
  size: number; // smallest-unit (position size for the stop-loss)
  stopLossPrice: number; // smallest-unit
  baseSz?: string; // exact base-unit size; if provided, skip re-derivation from USDC/price
  vaultAddress: `0x${string}`;
}

export interface SetStopLossResult {
  txHash: string;
}

// --- Helpers ---

function roundToSzDecimals(value: number, szDecimals: number, mode: "ceil" | "floor" = "ceil"): string {
  const factor = 10 ** szDecimals;
  const rounded = mode === "ceil"
    ? Math.ceil(value * factor) / factor
    : Math.floor(value * factor) / factor;
  // Guard: floor rounding with low szDecimals can produce 0 for small values
  if (rounded <= 0 && value > 0) {
    const minUnit = 1 / factor;
    return minUnit.toFixed(szDecimals);
  }
  return rounded.toFixed(szDecimals);
}

function roundPrice(price: number): string {
  // Hyperliquid prices: up to 5 significant figures
  if (price >= 10000) return price.toFixed(0);
  if (price >= 1000) return price.toFixed(1);
  if (price >= 100) return price.toFixed(2);
  if (price >= 10) return price.toFixed(3);
  if (price >= 1) return price.toFixed(4);
  return price.toFixed(5);
}

export async function getMidPrice(
  info: InfoClient,
  coin: string,
): Promise<number> {
  const mids = await withRetry(() => info.allMids(), "getMidPrice");
  const midStr = (mids as Record<string, string>)[coin];
  if (!midStr) {
    throw midPriceUnavailableError(coin);
  }
  const mid = parseFloat(midStr);
  if (!Number.isFinite(mid) || mid <= 0) {
    throw midPriceInvalidError(coin);
  }
  return mid;
}

// --- Contract functions ---

export async function openPosition(
  params: OpenPositionParams,
): Promise<OpenPositionResult> {
  const { exchange, info, pair, side, size, slippage, vaultAddress } = params;

  if (size < MIN_ORDER_VALUE) {
    throw orderFailedError(
      `Order size $${(size / 1e6).toFixed(2)} is below Hyperliquid minimum of $10. Increase allocation or position size.`,
    );
  }

  const asset = resolveAsset(pair);
  const isBuy = side === "Long";

  // Get mid price and calculate limit with slippage
  const midPrice = await getMidPrice(info, asset.coin);
  const slippageMultiplier = isBuy ? 1 + slippage / 100 : 1 - slippage / 100;
  const limitPrice = midPrice * slippageMultiplier;

  // Convert size from smallest-unit to display-unit for order
  const sizeDisplay = size / 1e6;
  // Convert to base currency units: sizeDisplay (USDC) / midPrice = base units
  const baseSize = sizeDisplay / midPrice;

  const result = await withRetry(
    () => exchange.order({
      orders: [
        {
          a: asset.index,
          b: isBuy,
          p: roundPrice(limitPrice),
          s: roundToSzDecimals(baseSize, asset.szDecimals),
          r: false,
          t: { limit: { tif: "Ioc" } },
        },
      ],
      grouping: "na",
      vaultAddress,
    }),
    "openPosition",
    { writeCall: true },
  );

  // Parse response
  const status = result.response.data.statuses[0];
  if (!status || typeof status === "string" || "error" in status) {
    const errorMsg =
      typeof status === "string"
        ? status
        : status && "error" in status
          ? status.error
          : "Unknown order error";
    throw orderFailedError(`Failed to open ${side} position on ${pair}: ${errorMsg}`);
  }

  if ("filled" in status) {
    const avgPx = parseFloat(status.filled.avgPx);
    const totalSz = parseFloat(status.filled.totalSz);
    const entryPriceSmallest = Math.round(avgPx * 1e6);

    // Detect partial fills — actual filled size vs intended base size
    const filledNotional = Math.round(totalSz * avgPx * 1e6);
    if (filledNotional < size * 0.95) {
      logger.warn(
        { pair, side, requestedSize: size, filledNotional, totalSz, avgPx },
        "Partial fill detected on IOC open — filled significantly less than requested",
      );
    }

    return {
      txHash: `hl-${status.filled.oid}`,
      positionId: `${asset.coin}-${side}`,
      entryPrice: entryPriceSmallest,
      actualSize: filledNotional,
      filledSz: status.filled.totalSz,
    };
  }

  // "resting" means not filled (IOC should fill or cancel, so this is unexpected)
  throw orderNotFilledError(`IOC order for ${pair} was not filled`);
}

export async function closePosition(
  params: ClosePositionParams,
): Promise<ClosePositionResult> {
  const { exchange, info, pair, side, size, baseSz, vaultAddress } = params;
  const asset = resolveAsset(pair);
  // Close = opposite side, reduce-only
  const isBuy = side === "Short"; // Closing a Short means buying back

  const midPrice = await getMidPrice(info, asset.coin);
  // 1% slippage for closes — generous to avoid CLOSE_NOT_FILLED during volatility
  const slippageMultiplier = isBuy ? 1.01 : 0.99;
  const limitPrice = midPrice * slippageMultiplier;

  // Use exact filled size from open if available; otherwise re-derive from USDC/price
  const orderSz = baseSz ?? roundToSzDecimals((size / 1e6) / midPrice, asset.szDecimals, "floor");

  const result = await withRetry(
    () => exchange.order({
      orders: [
        {
          a: asset.index,
          b: isBuy,
          p: roundPrice(limitPrice),
          s: orderSz,
          r: true, // reduce-only
          t: { limit: { tif: "Ioc" } },
        },
      ],
      grouping: "na",
      vaultAddress,
    }),
    "closePosition",
    { writeCall: true },
  );

  const status = result.response.data.statuses[0];
  if (!status || typeof status === "string" || "error" in status) {
    const errorMsg =
      typeof status === "string"
        ? status
        : status && "error" in status
          ? status.error
          : "Unknown order error";
    throw closeFailedError(`Failed to close ${side} position on ${pair}: ${errorMsg}`);
  }

  if ("filled" in status) {
    const avgPx = parseFloat(status.filled.avgPx);
    const exitPriceSmallest = Math.round(avgPx * 1e6);
    // Approximate PnL: (exitPrice - entryPrice) * baseSize for Long, inverse for Short
    // Actual PnL will be refined by position-manager using stored entryPrice
    // Here we return 0 for pnl — the caller computes actual pnl from entry vs exit
    // Fees: Hyperliquid charges ~0.025% taker fee
    const totalSz = parseFloat(status.filled.totalSz);
    const fees = Math.round(totalSz * avgPx * TAKER_FEE_RATE * 1e6);
    return {
      txHash: `hl-${status.filled.oid}`,
      exitPrice: exitPriceSmallest,
      pnl: 0, // caller computes actual pnl
      fees,
    };
  }

  throw closeNotFilledError(`IOC close order for ${pair} was not filled`);
}

export async function setStopLoss(
  params: SetStopLossParams,
): Promise<SetStopLossResult> {
  const { exchange, pair, side, size, stopLossPrice, baseSz, vaultAddress } = params;
  const asset = resolveAsset(pair);
  // Stop-loss: when price hits trigger, sell (for Long) or buy (for Short)
  const isBuy = side === "Short"; // SL for Short = buy back

  const triggerPx = stopLossPrice / 1e6;
  // Use exact filled size from open if available; otherwise re-derive from USDC/triggerPrice
  const orderSz = baseSz ?? roundToSzDecimals((size / 1e6) / triggerPx, asset.szDecimals, "floor");

  const result = await withRetry(
    () => exchange.order({
      orders: [
        {
          a: asset.index,
          b: isBuy,
          p: roundPrice(triggerPx), // limit price = trigger price for SL
          s: orderSz,
          r: true, // reduce-only
          t: {
            trigger: {
              isMarket: true,
              triggerPx: roundPrice(triggerPx),
              tpsl: "sl",
            },
          },
        },
      ],
      grouping: "positionTpsl",
      vaultAddress,
    }),
    "setStopLoss",
    { writeCall: true },
  );

  const status = result.response.data.statuses[0];
  if (!status || (typeof status !== "string" && "error" in status)) {
    const errorMsg =
      status && typeof status !== "string" && "error" in status
        ? status.error
        : "Unknown error";
    throw stopLossSubmissionFailedError(`Failed to set stop-loss on ${pair}: ${errorMsg}`);
  }

  // Trigger orders return "waitingForTrigger" on success, or "resting" with an oid
  let oid = 0;
  if (typeof status === "string") {
    // "waitingForTrigger" — no oid available for trigger orders
    logger.info({ pair, status }, "Stop-loss trigger order accepted");
  } else if ("resting" in status) {
    oid = status.resting.oid;
  }
  return {
    txHash: `hl-sl-${oid || Date.now()}`,
  };
}
