import type { FastifyInstance } from "fastify";
import type { ModeConfig, ModeType } from "../../shared/types.js";
import { fromSmallestUnit } from "../../shared/types.js";
import { getEngine, getModeStatus, getModeRunnerConfig } from "../engine/index.js";
import { strategyRegistry } from "../engine/strategy-registry.js";
import { logger } from "../lib/logger.js";
import { getConnectionStatus } from "../blockchain/client.js";
import { getRecentTrades } from "./trades.js";

const RSI_DEFAULTS = { rsiPeriod: 14, oversoldThreshold: 30, overboughtThreshold: 70, exitRsi: 50 };

function getRsiConfig(mode: ModeType): Pick<ModeConfig, "rsiPeriod" | "oversoldThreshold" | "overboughtThreshold" | "exitRsi"> | undefined {
  if (mode !== "profitHunter") return undefined;
  const runnerCfg = getModeRunnerConfig(mode);
  if (runnerCfg) {
    return {
      rsiPeriod: (runnerCfg.rsiPeriod as number) ?? RSI_DEFAULTS.rsiPeriod,
      oversoldThreshold: (runnerCfg.oversoldThreshold as number) ?? RSI_DEFAULTS.oversoldThreshold,
      overboughtThreshold: (runnerCfg.overboughtThreshold as number) ?? RSI_DEFAULTS.overboughtThreshold,
      exitRsi: (runnerCfg.exitRsi as number) ?? RSI_DEFAULTS.exitRsi,
    };
  }
  return RSI_DEFAULTS;
}

function getGridConfig(mode: ModeType): Pick<ModeConfig, "gridUpperPrice" | "gridLowerPrice" | "gridLines"> | undefined {
  if (mode !== "gridTrading") return undefined;
  try {
    const { fundAllocator } = getEngine();
    const upperRaw = fundAllocator.getModeMetadata(mode, "gridUpperPrice");
    const lowerRaw = fundAllocator.getModeMetadata(mode, "gridLowerPrice");
    const lines = fundAllocator.getModeMetadata(mode, "gridLines");
    return {
      gridUpperPrice: upperRaw !== null ? fromSmallestUnit(upperRaw) : undefined,
      gridLowerPrice: lowerRaw !== null ? fromSmallestUnit(lowerRaw) : undefined,
      gridLines: lines ?? undefined,
    };
  } catch {
    return undefined;
  }
}

function defaultModeConfig(mode: ModeType): ModeConfig {
  const base: ModeConfig = {
    mode,
    status: "stopped",
    allocation: 0,
    maxAllocation: 500,
    pairs: ["SOL/USDC"],
    slippage: 0.5,
    stats: { pnl: 0, trades: 0, volume: 0, allocated: 0, remaining: 0 },
  };
  const rsi = getRsiConfig(mode);
  if (rsi) Object.assign(base, rsi);
  const grid = getGridConfig(mode);
  if (grid) Object.assign(base, grid);
  return base;
}

function getModeConfig(mode: ModeType): ModeConfig {
  try {
    const { fundAllocator, positionManager } = getEngine();
    const alloc = fundAllocator.getAllocation(mode);
    const stats = fundAllocator.getStats(mode);
    const pmStatus = positionManager.getModeStatus(mode);
    const runnerStatus = getModeStatus(mode);
    const posSize = fundAllocator.getPositionSize(mode);
    const config: ModeConfig = {
      mode,
      status: pmStatus === "kill-switch" ? "kill-switch" : runnerStatus,
      allocation: fromSmallestUnit(alloc.allocation),
      positionSize: posSize !== null ? fromSmallestUnit(posSize) : undefined,
      maxAllocation: fromSmallestUnit(fundAllocator.getMaxAllocation()),
      pairs: ["SOL/USDC"],
      slippage: 0.5,
      stats,
    };
    const rsi = getRsiConfig(mode);
    if (rsi) Object.assign(config, rsi);
    const grid = getGridConfig(mode);
    if (grid) Object.assign(config, grid);
    return config;
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

function getStats(): { totalPnl: number; sessionPnl: number; totalTrades: number; totalVolume: number } {
  try {
    const { fundAllocator, sessionManager } = getEngine();

    const modes: ModeType[] = strategyRegistry.getRegisteredModeTypes();
    let sessionPnl = 0;
    let sessionTrades = 0;
    let sessionVolume = 0;

    for (const mode of modes) {
      const modeStats = fundAllocator.getStats(mode);
      sessionPnl += modeStats.pnl;
      sessionTrades += modeStats.trades;
      sessionVolume += modeStats.volume;
    }

    // historical values from DB are smallest-unit integers — convert pnl and volume
    // totalTrades is a plain count — no conversion needed
    const historical = sessionManager.getHistoricalStats();
    const totalPnl = fromSmallestUnit(historical.totalPnl) + sessionPnl;
    const totalTrades = historical.totalTrades + sessionTrades;
    const totalVolume = fromSmallestUnit(historical.totalVolume) + sessionVolume;

    return { totalPnl, sessionPnl, totalTrades, totalVolume };
  } catch (err) {
    logger.warn({ err }, "getStats failed, returning zeros");
    return { totalPnl: 0, sessionPnl: 0, totalTrades: 0, totalVolume: 0 };
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

    const modesRecord: Record<ModeType, ModeConfig> = {};
    for (const modeType of strategyRegistry.getRegisteredModeTypes()) {
      modesRecord[modeType] = getModeConfig(modeType);
    }

    return {
      modes: modesRecord,
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
      strategies: strategyRegistry.getAvailableStrategies(getModeStatus),
    };
  });
}
