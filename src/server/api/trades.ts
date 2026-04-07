import type { FastifyInstance } from "fastify";
import { desc, eq, count, sql } from "drizzle-orm";
import type { ModeType, Trade as ApiTrade, TradeHistoryResponse } from "../../shared/types.js";
import { fromSmallestUnit } from "../../shared/types.js";
import { getDb } from "../db/index.js";
import { trades } from "../db/schema.js";

function dbTradeToApiTrade(dbTrade: typeof trades.$inferSelect): ApiTrade {
  return {
    id: dbTrade.id,
    mode: dbTrade.mode as ModeType,
    pair: dbTrade.pair,
    side: dbTrade.side as ApiTrade["side"],
    size: fromSmallestUnit(dbTrade.size),
    price: fromSmallestUnit(dbTrade.price),
    pnl: fromSmallestUnit(dbTrade.pnl),
    fees: fromSmallestUnit(dbTrade.fees),
    timestamp: dbTrade.timestamp,
  };
}

export function getRecentTrades(limit: number, offset: number, mode?: ModeType): TradeHistoryResponse {
  const db = getDb();

  const conditions = mode ? eq(trades.mode, mode) : undefined;

  const rows = db
    .select()
    .from(trades)
    .where(conditions)
    .orderBy(desc(trades.timestamp))
    .limit(limit)
    .offset(offset)
    .all();

  const [totalRow] = db
    .select({ count: count() })
    .from(trades)
    .where(conditions)
    .all();

  return {
    trades: rows.map(dbTradeToApiTrade),
    total: totalRow?.count ?? 0,
  };
}

const VALID_MODES = new Set<string>(["volumeMax", "profitHunter", "arbitrage"]);

export default async function tradesRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: { limit?: number; offset?: number; mode?: string } }>("/api/trades", {
    schema: {
      querystring: {
        type: "object" as const,
        properties: {
          limit: { type: "integer" as const, default: 50, minimum: 1, maximum: 500 },
          offset: { type: "integer" as const, default: 0, minimum: 0 },
          mode: { type: "string" as const },
        },
      },
    },
  }, async (request) => {
    const { limit = 50, offset = 0, mode } = request.query;
    const modeFilter = mode && VALID_MODES.has(mode) ? mode as ModeType : undefined;
    return getRecentTrades(limit, offset, modeFilter);
  });
}
