import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "./errors.js";
import { logger } from "./logger.js";

export function errorHandler(
  error: FastifyError,
  _request: FastifyRequest,
  reply: FastifyReply,
): ReturnType<FastifyReply["send"]> {
  if (error.name === "AppError") {
    const appErr = error as unknown as AppError;
    const statusMap = { info: 200, warning: 400, critical: 500 } as const;
    const httpStatus = statusMap[appErr.severity] ?? 500;
    return reply.status(httpStatus).send({
      error: {
        severity: appErr.severity,
        code: appErr.code,
        message: appErr.message,
        details: appErr.details ?? null,
        resolution: appErr.resolution ?? null,
      },
    });
  }

  if (error.statusCode === 400 && error.validation) {
    return reply.status(400).send({
      error: {
        severity: "warning",
        code: "VALIDATION_ERROR",
        message: error.message,
        details: null,
        resolution: null,
      },
    });
  }

  logger.error({ err: error }, "Unhandled error");
  return reply.status(500).send({
    error: {
      severity: "critical",
      code: "INTERNAL_ERROR",
      message: "Internal server error",
      details: null,
      resolution: null,
    },
  });
}
