import type { FastifyInstance } from "fastify";
import type { ModeConfig, ModeType } from "../../shared/types.js";

function defaultModeConfig(mode: ModeType): ModeConfig {
  return {
    mode,
    status: "stopped",
    allocation: 0,
    pairs: [],
    slippage: 0.5,
    stats: { pnl: 0, trades: 0, volume: 0, allocated: 0, remaining: 0 },
  };
}

export default async function statusRoutes(fastify: FastifyInstance) {
  fastify.get("/api/status", async () => {
    return {
      modes: {
        volumeMax: defaultModeConfig("volumeMax"),
        profitHunter: defaultModeConfig("profitHunter"),
        arbitrage: defaultModeConfig("arbitrage"),
      },
      positions: [],
      trades: [],
      connection: { status: "disconnected", walletBalance: 0 },
    };
  });
}
