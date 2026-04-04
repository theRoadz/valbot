import type { FastifyInstance } from "fastify";
import { urlModeToModeType } from "../../shared/types.js";
import { AppError } from "../lib/errors.js";

const modeEnum = ["volume-max", "profit-hunter", "arbitrage"] as const;

const modeParamSchema = {
  type: "object" as const,
  properties: {
    mode: { type: "string" as const, enum: [...modeEnum] },
  },
  required: ["mode"] as const,
};

export default async function modeRoutes(fastify: FastifyInstance) {
  fastify.post<{ Params: { mode: string } }>("/api/mode/:mode/start", {
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
    return { status: "stopped", mode: modeType };
  });

  fastify.put<{ Params: { mode: string }; Body: { allocation?: number; pairs?: string[]; slippage?: number } }>("/api/mode/:mode/config", {
    schema: {
      params: modeParamSchema,
      body: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          allocation: { type: "number" as const, minimum: 0 },
          pairs: { type: "array" as const, items: { type: "string" as const }, maxItems: 50 },
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
    return { status: "updated", mode: modeType };
  });
}
