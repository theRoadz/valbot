import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { AppError } from "../lib/errors.js";
import { errorHandler } from "../lib/error-handler.js";

describe("Fastify error handler", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();

    // Register test routes that throw errors
    app.get("/api/test/app-error-warning", async () => {
      throw new AppError({
        severity: "warning",
        code: "TEST_WARNING",
        message: "Test warning",
        details: "some details",
        resolution: "fix it",
      });
    });

    app.get("/api/test/app-error-critical", async () => {
      throw new AppError({
        severity: "critical",
        code: "TEST_CRITICAL",
        message: "Test critical",
      });
    });

    app.get("/api/test/app-error-info", async () => {
      throw new AppError({
        severity: "info",
        code: "TEST_INFO",
        message: "Test info",
      });
    });

    app.get("/api/test/generic-error", async () => {
      throw new Error("Something unexpected");
    });

    app.post<{ Body: { name: string } }>("/api/test/validation", {
      schema: {
        body: {
          type: "object" as const,
          required: ["name"] as const,
          properties: { name: { type: "string" as const } },
        },
      },
    }, async (request) => {
      return { name: (request.body as { name: string }).name };
    });

    // Use the shared error handler from lib/error-handler.ts
    app.setErrorHandler(errorHandler);

    // SPA catch-all matching index.ts
    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith("/api/")) {
        return reply.status(404).send({
          error: {
            severity: "warning",
            code: "NOT_FOUND",
            message: `Route ${request.method} ${request.url} not found`,
            details: null,
            resolution: null,
          },
        });
      }
      return reply.status(404).send({ error: { severity: "info", code: "NOT_FOUND", message: "Not found", details: null, resolution: null } });
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("formats AppError with warning severity as 400", async () => {
    const res = await app.inject({ method: "GET", url: "/api/test/app-error-warning" });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.severity).toBe("warning");
    expect(body.error.code).toBe("TEST_WARNING");
    expect(body.error.message).toBe("Test warning");
    expect(body.error.details).toBe("some details");
    expect(body.error.resolution).toBe("fix it");
  });

  it("formats AppError with critical severity as 500", async () => {
    const res = await app.inject({ method: "GET", url: "/api/test/app-error-critical" });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error.severity).toBe("critical");
    expect(body.error.code).toBe("TEST_CRITICAL");
    expect(body.error.details).toBeNull();
    expect(body.error.resolution).toBeNull();
  });

  it("formats AppError with info severity as 200", async () => {
    const res = await app.inject({ method: "GET", url: "/api/test/app-error-info" });
    expect(res.statusCode).toBe(200);
    expect(res.json().error.severity).toBe("info");
  });

  it("wraps Fastify validation errors as 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/test/validation",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.severity).toBe("warning");
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns generic 500 for unknown errors", async () => {
    const res = await app.inject({ method: "GET", url: "/api/test/generic-error" });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error.severity).toBe("critical");
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).toBe("Internal server error");
  });

  describe("SPA catch-all scoping", () => {
    it("returns 404 JSON for unmatched /api/* routes", async () => {
      const res = await app.inject({ method: "GET", url: "/api/nonexistent" });
      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.error.code).toBe("NOT_FOUND");
      expect(body.error.message).toContain("/api/nonexistent");
    });

    it("returns 404 for non-API routes (no static serving in test)", async () => {
      const res = await app.inject({ method: "GET", url: "/some-page" });
      expect(res.statusCode).toBe(404);
    });
  });
});
