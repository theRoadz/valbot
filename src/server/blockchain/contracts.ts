// TODO: Replace stubs with real Valiant Perps contract calls

import type { Connection, Keypair } from "@solana/web3.js";
import type { TradeSide } from "../../shared/types.js";

// --- Param / Result interfaces ---

export interface OpenPositionParams {
  connection: Connection;
  keypair: Keypair;
  pair: string;
  side: TradeSide;
  size: number; // smallest-unit
  slippage: number;
}

export interface OpenPositionResult {
  txHash: string;
  positionId: string;
  entryPrice: number; // smallest-unit
}

export interface ClosePositionParams {
  connection: Connection;
  keypair: Keypair;
  positionId: string;
  pair: string;
  side: TradeSide;
  size: number; // smallest-unit
}

export interface ClosePositionResult {
  txHash: string;
  exitPrice: number; // smallest-unit
  pnl: number; // smallest-unit
  fees: number; // smallest-unit
}

export interface SetStopLossParams {
  connection: Connection;
  keypair: Keypair;
  positionId: string;
  stopLossPrice: number; // smallest-unit
}

export interface SetStopLossResult {
  txHash: string;
}

// --- Module-level counter for unique mock txHashes ---
let txCounter = 0;

function mockTxHash(): string {
  return `mock-tx-${Date.now()}-${++txCounter}`;
}

// --- Stub implementations ---

export async function openPosition(
  _params: OpenPositionParams,
): Promise<OpenPositionResult> {
  await new Promise((r) => setTimeout(r, 50));
  return {
    txHash: mockTxHash(),
    positionId: `pos-${Date.now()}-${txCounter}`,
    entryPrice: 100_000_000, // 100 USDC in smallest-unit
  };
}

export async function closePosition(
  params: ClosePositionParams,
): Promise<ClosePositionResult> {
  await new Promise((r) => setTimeout(r, 50));
  const fees = Math.round(params.size * 0.001); // 0.1% of size
  return {
    txHash: mockTxHash(),
    exitPrice: 100_000_000, // 100 USDC in smallest-unit
    pnl: 0, // break-even by default
    fees,
  };
}

export async function setStopLoss(
  _params: SetStopLossParams,
): Promise<SetStopLossResult> {
  await new Promise((r) => setTimeout(r, 50));
  return {
    txHash: mockTxHash(),
  };
}
