import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import statusRoutes from "./status.js";

describe("status route", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await app.register(statusRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /api/status returns full bot state shape", async () => {
    const res = await app.inject({ method: "GET", url: "/api/status" });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body).toHaveProperty("modes");
    expect(body).toHaveProperty("positions");
    expect(body).toHaveProperty("trades");
    expect(body).toHaveProperty("connection");

    // Modes shape
    expect(body.modes).toHaveProperty("volumeMax");
    expect(body.modes).toHaveProperty("profitHunter");
    expect(body.modes).toHaveProperty("arbitrage");

    // Default mode config shape
    const vm = body.modes.volumeMax;
    expect(vm).toEqual({
      mode: "volumeMax",
      status: "stopped",
      allocation: 0,
      pairs: [],
      slippage: 0.5,
      stats: { pnl: 0, trades: 0, volume: 0, allocated: 0, remaining: 0 },
    });

    // Stubs
    expect(body.positions).toEqual([]);
    expect(body.trades).toEqual([]);
    expect(body.connection).toEqual({ status: "disconnected", walletBalance: 0 });
  });
});
