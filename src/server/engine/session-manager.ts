import { and, eq, isNull, sql } from "drizzle-orm";
import type { ModeType } from "../../shared/types.js";
import { getDb } from "../db/index.js";
import { sessions } from "../db/schema.js";
import { logger } from "../lib/logger.js";

export class SessionManager {
  /** Insert a new session row and return its ID. */
  startSession(mode: ModeType): number {
    const db = getDb();
    const result = db
      .insert(sessions)
      .values({
        startTime: Date.now(),
        mode,
        trades: 0,
        volume: 0,
        pnl: 0,
      })
      .run();
    const id = Number(result.lastInsertRowid);
    logger.info({ sessionId: id, mode }, "Session started");
    return id;
  }

  /** Increment trade count, add size to volume, add pnl. All smallest-unit integers. */
  updateSession(sessionId: number, tradeSize: number, tradePnl: number): void {
    const db = getDb();
    db.update(sessions)
      .set({
        trades: sql`"trades" + 1`,
        volume: sql`"volume" + ${tradeSize}`,
        pnl: sql`"pnl" + ${tradePnl}`,
      })
      .where(eq(sessions.id, sessionId))
      .run();
  }

  /** Set endTime on a session to finalize it. */
  finalizeSession(sessionId: number): void {
    const db = getDb();
    db.update(sessions)
      .set({ endTime: Date.now() })
      .where(eq(sessions.id, sessionId))
      .run();
    logger.info({ sessionId }, "Session finalized");
  }

  /** Sum pnl, trades, volume from ALL finalized sessions (endTime IS NOT NULL). */
  getHistoricalStats(): { totalPnl: number; totalTrades: number; totalVolume: number } {
    const db = getDb();
    const result = db
      .select({
        totalPnl: sql<number>`COALESCE(SUM(${sessions.pnl}), 0)`,
        totalTrades: sql<number>`COALESCE(SUM(${sessions.trades}), 0)`,
        totalVolume: sql<number>`COALESCE(SUM(${sessions.volume}), 0)`,
      })
      .from(sessions)
      .where(sql`${sessions.endTime} IS NOT NULL`)
      .get();

    return {
      totalPnl: result?.totalPnl ?? 0,
      totalTrades: result?.totalTrades ?? 0,
      totalVolume: result?.totalVolume ?? 0,
    };
  }

  /** Return the active session (endTime IS NULL) for a given mode, or null. */
  getActiveSession(mode: ModeType): { id: number; startTime: number; mode: ModeType; trades: number; volume: number; pnl: number } | null {
    const db = getDb();
    const row = db
      .select()
      .from(sessions)
      .where(and(eq(sessions.mode, mode), isNull(sessions.endTime)))
      .get();

    if (!row) return null;
    return {
      id: row.id,
      startTime: row.startTime,
      mode: row.mode as ModeType,
      trades: row.trades,
      volume: row.volume,
      pnl: row.pnl,
    };
  }

  /** Finalize all sessions with endTime IS NULL (orphaned from crash). Returns count. */
  finalizeOrphanedSessions(): number {
    const db = getDb();
    const now = Date.now();
    const result = db
      .update(sessions)
      .set({ endTime: now })
      .where(isNull(sessions.endTime))
      .run();
    const count = result.changes;
    if (count > 0) {
      logger.warn({ count }, "Finalized orphaned sessions from previous crash");
    }
    return count;
  }
}
