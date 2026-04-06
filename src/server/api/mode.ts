import type { FastifyInstance } from "fastify";
import { urlModeToModeType, toSmallestUnit } from "../../shared/types.js";
import { EVENTS } from "../../shared/events.js";
import { AppError } from "../lib/errors.js";
import { getEngine, startMode, stopMode, resetKillSwitch, getModeStatus } from "../engine/index.js";
import { broadcast } from "../ws/broadcaster.js";

const modeEnum = ["volume-max", "profit-hunter", "arbitrage"] as const;
const VALID_PAIRS = ["SOL/USDC", "ETH/USDC", "BTC/USDC"];

const modeParamSchema = {
  type: "object" as const,
  properties: {
    mode: { type: "string" as const, enum: [...modeEnum] },
  },
  required: ["mode"] as const,
};

export default async function modeRoutes(fastify: FastifyInstance) {
  fastify.post<{ Params: { mode: string }; Body: { pairs?: string[]; slippage?: number } }>("/api/mode/:mode/start", {
    schema: {
      params: modeParamSchema,
      body: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          pairs: { type: "array" as const, items: { type: "string" as const, enum: VALID_PAIRS }, maxItems: 50 },
          slippage: { type: "number" as const, minimum: 0, maximum: 100 },
        },
      },
    },
  }, async (request) => {
    const modeType = urlModeToModeType(request.params.mode);
    if (!modeType) {
      throw new AppError({
        severity: "warning",
        code: "INVALID_MODE",
        message: `Invalid mode: ${request.params.mode}`,
        resolution: "Use one of: volume-max, profit-hunter, arbitrage",
      });
    }

    const pairs = request.body?.pairs ?? ["SOL/USDC"];
    const slippage = request.body?.slippage;

    await startMode(modeType, { pairs, slippage });
    return { status: "started", mode: modeType };
  });

  fastify.post<{ Params: { mode: string } }>("/api/mode/:mode/stop", {
    schema: { params: modeParamSchema },
  }, async (request) => {
    const modeType = urlModeToModeType(request.params.mode);
    if (!modeType) {
      throw new AppError({
        severity: "warning",
        code: "INVALID_MODE",
        message: `Invalid mode: ${request.params.mode}`,
        resolution: "Use one of: volume-max, profit-hunter, arbitrage",
      });
    }

    await stopMode(modeType);
    return { status: "stopped", mode: modeType };
  });

  fastify.put<{ Params: { mode: string }; Body: { allocation?: number; pairs?: string[]; slippage?: number } }>("/api/mode/:mode/config", {
    schema: {
      params: modeParamSchema,
      body: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          allocation: { type: "number" as const, minimum: 0, maximum: 500 },
          pairs: { type: "array" as const, items: { type: "string" as const, enum: VALID_PAIRS }, maxItems: 50 },
          slippage: { type: "number" as const, minimum: 0, maximum: 100 },
        },
      },
    },
  }, async (request) => {
    const modeType = urlModeToModeType(request.params.mode);
    if (!modeType) {
      throw new AppError({
        severity: "warning",
        code: "INVALID_MODE",
        message: `Invalid mode: ${request.params.mode}`,
        resolution: "Use one of: volume-max, profit-hunter, arbitrage",
      });
    }
    // Persist allocation via fund allocator if provided
    if (request.body.allocation !== undefined) {
      try {
        const { fundAllocator } = getEngine();
        fundAllocator.setAllocation(modeType, toSmallestUnit(request.body.allocation));
        // Reset kill-switch state when re-allocating a kill-switched mode (only for meaningful allocations)
        if (request.body.allocation > 0 && getModeStatus(modeType) === "kill-switch") {
          resetKillSwitch(modeType);
        }
        // Broadcast updated stats after all state changes (including kill-switch reset)
        try {
          const stats = fundAllocator.getStats(modeType);
          broadcast(EVENTS.STATS_UPDATED, { mode: modeType, ...stats });
        } catch {
          // Stats broadcast failure should not fail the allocation request
        }
      } catch (err) {
        // Only swallow engine-not-initialized; re-throw real errors
        if (err instanceof Error && err.message.includes("Engine not initialized")) {
          // Engine not ready — allocation will be set when engine starts
        } else {
          throw err;
        }
      }
    }

    return { status: "updated", mode: modeType };
  });
}
