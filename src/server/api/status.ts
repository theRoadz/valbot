import type { FastifyInstance } from "fastify";
import type { ModeConfig, ModeType } from "../../shared/types.js";
import { fromSmallestUnit } from "../../shared/types.js";
import { getEngine, getModeStatus } from "../engine/index.js";
import { getConnectionStatus } from "../blockchain/client.js";
import { getRecentTrades } from "./trades.js";

function defaultModeConfig(mode: ModeType): ModeConfig {
  return {
    mode,
    status: "stopped",
    allocation: 0,
    maxAllocation: 500,
    pairs: ["SOL/USDC"],
    slippage: 0.5,
    stats: { pnl: 0, trades: 0, volume: 0, allocated: 0, remaining: 0 },
  };
}

function getModeConfig(mode: ModeType): ModeConfig {
  try {
    const { fundAllocator, positionManager } = getEngine();
    const alloc = fundAllocator.getAllocation(mode);
    const stats = fundAllocator.getStats(mode);
    const pmStatus = positionManager.getModeStatus(mode);
    const runnerStatus = getModeStatus(mode);
    const posSize = fundAllocator.getPositionSize(mode);
    return {
      mode,
      status: pmStatus === "kill-switch" ? "kill-switch" : runnerStatus,
      allocation: fromSmallestUnit(alloc.allocation),
      positionSize: posSize !== null ? fromSmallestUnit(posSize) : undefined,
      maxAllocation: fromSmallestUnit(fundAllocator.getMaxAllocation()),
      pairs: ["SOL/USDC"],
      slippage: 0.5,
      stats,
    };
  } catch {
    return defaultModeConfig(mode);
  }
}

async function getConnectionData() {
  try {
    const status = await getConnectionStatus();
    if (status) {
      return { status: "connected" as const, equity: status.equity, available: status.available };
    }
  } catch {
    // Connection query failed — fall back to disconnected
  }
  return { status: "disconnected" as const, equity: 0, available: 0 };
}

function getStats(): { totalPnl: number; sessionPnl: number } {
  try {
    const { fundAllocator, sessionManager } = getEngine();

    // sessionPnl = sum of in-memory pnl across all active modes (display-unit from getStats)
    const modes: ModeType[] = ["volumeMax", "profitHunter", "arbitrage"];
    const sessionPnl = modes.reduce((sum, mode) => sum + fundAllocator.getStats(mode).pnl, 0);

    // historicalPnl = sum of finalized sessions pnl (smallest-unit from DB, convert to display)
    const historical = sessionManager.getHistoricalStats();
    const totalPnl = fromSmallestUnit(historical.totalPnl) + sessionPnl;

    return { totalPnl, sessionPnl };
  } catch {
    return { totalPnl: 0, sessionPnl: 0 };
  }
}

export default async function statusRoutes(fastify: FastifyInstance) {
  fastify.get("/api/status", async () => {
    let positions: unknown[] = [];
    try {
      const { positionManager } = getEngine();
      positions = positionManager.getPositions();
    } catch {
      // Engine not initialized — fall back to empty
    }

    return {
      modes: {
        volumeMax: getModeConfig("volumeMax"),
        profitHunter: getModeConfig("profitHunter"),
        arbitrage: getModeConfig("arbitrage"),
      },
      positions,
      trades: (() => {
        try {
          return getRecentTrades(50, 0).trades;
        } catch {
          return [];
        }
      })(),
      connection: await getConnectionData(),
      stats: getStats(),
    };
  });
}
