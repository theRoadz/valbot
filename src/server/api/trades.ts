import type { FastifyInstance } from "fastify";

export default async function tradesRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: { limit?: number; offset?: number } }>("/api/trades", {
    schema: {
      querystring: {
        type: "object" as const,
        properties: {
          limit: { type: "integer" as const, default: 50, minimum: 1, maximum: 500 },
          offset: { type: "integer" as const, default: 0, minimum: 0 },
        },
      },
    },
  }, async () => {
    return { trades: [], total: 0 };
  });
}
