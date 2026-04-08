import type { FastifyInstance } from "fastify";
import { toSmallestUnit, fromSmallestUnit } from "../../shared/types.js";
import { EVENTS } from "../../shared/events.js";
import { AppError } from "../lib/errors.js";
import { getEngine, startMode, stopMode, resetKillSwitch, getModeStatus } from "../engine/index.js";
import { strategyRegistry } from "../engine/strategy-registry.js";
import { broadcast } from "../ws/broadcaster.js";

const VALID_PAIRS = ["SOL/USDC", "ETH/USDC", "BTC/USDC"];

const modeParamSchema = {
  type: "object" as const,
  properties: {
    mode: { type: "string" as const, maxLength: 64, pattern: "^[a-zA-Z0-9-]+$" },
  },
  required: ["mode"] as const,
};

function resolveMode(slugOrMode: string): string {
  // Try slug lookup first
  const fromSlug = strategyRegistry.getModeTypeFromSlug(slugOrMode);
  if (fromSlug) return fromSlug;

  // Try direct mode type lookup
  const reg = strategyRegistry.getRegistration(slugOrMode);
  if (reg) return slugOrMode;

  const available = strategyRegistry.getAvailableStrategies(() => "stopped")
    .map((s) => s.urlSlug)
    .join(", ");
  throw new AppError({
    severity: "warning",
    code: "INVALID_MODE",
    message: `Invalid mode: ${slugOrMode}`,
    resolution: `Use one of: ${available}`,
  });
}

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
    const modeType = resolveMode(request.params.mode);

    const pairs = request.body?.pairs ?? ["SOL/USDC"];
    const slippage = request.body?.slippage;

    await startMode(modeType, { pairs, slippage });
    return { status: "started", mode: modeType };
  });

  fastify.post<{ Params: { mode: string } }>("/api/mode/:mode/stop", {
    schema: { params: modeParamSchema },
  }, async (request) => {
    const modeType = resolveMode(request.params.mode);

    await stopMode(modeType);
    return { status: "stopped", mode: modeType };
  });

  fastify.put<{ Params: { mode: string }; Body: { allocation?: number; positionSize?: number | null; maxAllocation?: number; pairs?: string[]; slippage?: number; rsiPeriod?: number; oversoldThreshold?: number; overboughtThreshold?: number; exitRsi?: number; gridUpperPrice?: number; gridLowerPrice?: number; gridLines?: number } }>("/api/mode/:mode/config", {
    schema: {
      params: modeParamSchema,
      body: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          allocation: { type: "number" as const, minimum: 0 },
          positionSize: { type: ["number", "null"] as const, minimum: 10, maximum: 100000 },
          maxAllocation: { type: "number" as const, minimum: 10, maximum: 100000 },
          pairs: { type: "array" as const, items: { type: "string" as const, enum: VALID_PAIRS }, maxItems: 50 },
          slippage: { type: "number" as const, minimum: 0, maximum: 100 },
          rsiPeriod: { type: "number" as const, minimum: 2, maximum: 50 },
          oversoldThreshold: { type: "number" as const, minimum: 0, maximum: 100 },
          overboughtThreshold: { type: "number" as const, minimum: 0, maximum: 100 },
          exitRsi: { type: "number" as const, minimum: 0, maximum: 100 },
          gridUpperPrice: { type: "number" as const, minimum: 0.01, maximum: 1_000_000 },
          gridLowerPrice: { type: "number" as const, minimum: 0.01, maximum: 1_000_000 },
          gridLines: { type: "integer" as const, minimum: 2, maximum: 50 },
        },
      },
    },
  }, async (request) => {
    const modeType = resolveMode(request.params.mode);
    try {
      const { fundAllocator } = getEngine();

      // Process maxAllocation first (it affects allocation validation)
      if (request.body.maxAllocation !== undefined) {
        fundAllocator.setMaxAllocation(toSmallestUnit(request.body.maxAllocation));
      }

      // Persist allocation via fund allocator if provided
      if (request.body.allocation !== undefined) {
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
      }

      // Process positionSize (after allocation so validation uses updated value)
      if (request.body.positionSize !== undefined) {
        if (request.body.positionSize === null) {
          fundAllocator.clearPositionSize(modeType);
        } else {
          fundAllocator.setPositionSize(modeType, toSmallestUnit(request.body.positionSize));
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("Engine not initialized")) {
        throw new AppError({
          severity: "warning",
          code: "ENGINE_NOT_READY",
          message: "Engine is still initializing — config was not saved",
          resolution: "Wait a moment and try again",
        });
      }
      throw err;
    }

    // Cross-field validation for RSI config params
    const { oversoldThreshold, overboughtThreshold, exitRsi } = request.body;
    if (oversoldThreshold !== undefined || overboughtThreshold !== undefined || exitRsi !== undefined) {
      const oversold = oversoldThreshold ?? 30;
      const overbought = overboughtThreshold ?? 70;
      const exit = exitRsi ?? 50;
      if (oversold >= overbought) {
        throw new AppError({
          severity: "warning",
          code: "INVALID_RSI_CONFIG",
          message: "oversoldThreshold must be less than overboughtThreshold",
          resolution: "Adjust thresholds so oversold < overbought",
        });
      }
      if (exit <= oversold || exit >= overbought) {
        throw new AppError({
          severity: "warning",
          code: "INVALID_RSI_CONFIG",
          message: "exitRsi must be between oversoldThreshold and overboughtThreshold",
          resolution: "Set exitRsi to a value between oversold and overbought thresholds",
        });
      }
    }

    // Cross-field validation for Grid Trading config params
    const { gridUpperPrice, gridLowerPrice, gridLines } = request.body;
    if (gridUpperPrice !== undefined || gridLowerPrice !== undefined) {
      // Fetch stored values for missing fields to validate cross-field constraint
      let storedUpper = 0;
      let storedLower = 0;
      try {
        const { fundAllocator } = getEngine();
        const rawUpper = fundAllocator.getModeMetadata(modeType, "gridUpperPrice");
        const rawLower = fundAllocator.getModeMetadata(modeType, "gridLowerPrice");
        if (rawUpper !== null) storedUpper = fromSmallestUnit(rawUpper);
        if (rawLower !== null) storedLower = fromSmallestUnit(rawLower);
      } catch {
        // Engine not ready — skip stored lookup, constructor will validate at start
      }
      const upper = gridUpperPrice ?? storedUpper;
      const lower = gridLowerPrice ?? storedLower;
      if (upper > 0 && lower > 0 && lower >= upper) {
        throw new AppError({
          severity: "warning",
          code: "INVALID_GRID_CONFIG",
          message: "gridLowerPrice must be less than gridUpperPrice",
          resolution: "Adjust prices so lowerPrice < upperPrice",
        });
      }
    }

    // Persist grid config via fund allocator metadata
    try {
      const { fundAllocator } = getEngine();
      if (gridUpperPrice !== undefined) {
        fundAllocator.setModeMetadata(modeType, "gridUpperPrice", toSmallestUnit(gridUpperPrice));
      }
      if (gridLowerPrice !== undefined) {
        fundAllocator.setModeMetadata(modeType, "gridLowerPrice", toSmallestUnit(gridLowerPrice));
      }
      if (gridLines !== undefined) {
        fundAllocator.setModeMetadata(modeType, "gridLines", gridLines);
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("Engine not initialized")) {
        // Skip persistence if engine not ready
      } else {
        throw err;
      }
    }

    return { status: "updated", mode: modeType };
  });
}
