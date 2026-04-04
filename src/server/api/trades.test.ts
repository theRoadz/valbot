import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import tradesRoutes from "./trades.js";

describe("trades route", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await app.register(tradesRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /api/trades returns default paginated response", async () => {
    const res = await app.inject({ method: "GET", url: "/api/trades" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ trades: [], total: 0 });
  });

  it("accepts custom limit and offset", async () => {
    const res = await app.inject({ method: "GET", url: "/api/trades?limit=10&offset=5" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ trades: [], total: 0 });
  });

  it("rejects limit exceeding 500", async () => {
    const res = await app.inject({ method: "GET", url: "/api/trades?limit=501" });
    expect(res.statusCode).toBe(400);
  });

  it("rejects negative offset", async () => {
    const res = await app.inject({ method: "GET", url: "/api/trades?offset=-1" });
    expect(res.statusCode).toBe(400);
  });
});
