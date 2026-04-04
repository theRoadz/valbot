import { eq } from "drizzle-orm";
import type { ModeType, ModeStats } from "../../shared/types.js";
import { fromSmallestUnit } from "../../shared/types.js";
import { getDb } from "../db/index.js";
import { config, assertSafeInteger } from "../db/schema.js";
import { AppError, insufficientFundsError } from "../lib/errors.js";

const KILL_SWITCH_THRESHOLD = 0.9;

interface ModeAllocation {
  allocation: number; // smallest-unit
  remaining: number; // smallest-unit
  trades: number;
  volume: number; // smallest-unit
  pnl: number; // smallest-unit
}

function defaultAllocation(): ModeAllocation {
  return { allocation: 0, remaining: 0, trades: 0, volume: 0, pnl: 0 };
}

export class FundAllocator {
  private state = new Map<ModeType, ModeAllocation>();

  private getOrCreate(mode: ModeType): ModeAllocation {
    let entry = this.state.get(mode);
    if (!entry) {
      entry = defaultAllocation();
      this.state.set(mode, entry);
    }
    return entry;
  }

  setAllocation(mode: ModeType, amount: number): void {
    assertSafeInteger(amount, `allocation:${mode}`);
    const entry = this.getOrCreate(mode);
    const prevAllocation = entry.allocation;
    const prevRemaining = entry.remaining;
    const diff = amount - prevAllocation;
    entry.allocation = amount;
    entry.remaining = Math.max(0, entry.remaining + diff);

    // Persist to config DB — rollback in-memory on failure
    try {
      const db = getDb();
      const key = `allocation:${mode}`;
      const value = JSON.stringify({ amount });
      db.insert(config)
        .values({ key, value })
        .onConflictDoUpdate({ target: config.key, set: { value } })
        .run();
    } catch (err) {
      entry.allocation = prevAllocation;
      entry.remaining = prevRemaining;
      throw err;
    }
  }

  getAllocation(mode: ModeType): { allocation: number; remaining: number } {
    const entry = this.state.get(mode);
    if (!entry) return { allocation: 0, remaining: 0 };
    return { allocation: entry.allocation, remaining: entry.remaining };
  }

  canAllocate(mode: ModeType, size: number): boolean {
    const entry = this.state.get(mode);
    if (!entry) return false;
    return entry.remaining >= size;
  }

  reserve(mode: ModeType, size: number): void {
    const entry = this.state.get(mode);
    if (!entry || entry.remaining < size) {
      throw insufficientFundsError(
        mode,
        size,
        entry?.remaining ?? 0,
      );
    }
    entry.remaining -= size;
  }

  release(mode: ModeType, amount: number): void {
    const entry = this.getOrCreate(mode);
    entry.remaining = Math.min(entry.allocation, entry.remaining + amount);
  }

  recordTrade(mode: ModeType, size: number, pnl: number): void {
    const entry = this.getOrCreate(mode);
    entry.trades += 1;
    entry.volume += size;
    entry.pnl += pnl;
  }

  checkKillSwitch(mode: ModeType): boolean {
    const entry = this.state.get(mode);
    if (!entry || entry.allocation === 0) return false;
    return entry.remaining <= entry.allocation * KILL_SWITCH_THRESHOLD;
  }

  async loadFromDb(): Promise<void> {
    const db = getDb();
    const modes: ModeType[] = ["volumeMax", "profitHunter", "arbitrage"];
    for (const mode of modes) {
      const key = `allocation:${mode}`;
      const rows = db.select().from(config).where(eq(config.key, key)).all();
      if (rows.length > 0) {
        const parsed = JSON.parse(rows[0].value) as { amount: number };
        const entry = this.getOrCreate(mode);
        entry.allocation = parsed.amount;
        entry.remaining = parsed.amount;
      }
    }
  }

  /** Subtract open position sizes from remaining after crash recovery */
  reconcilePositions(positions: Array<{ mode: ModeType; size: number }>): void {
    for (const pos of positions) {
      const entry = this.state.get(pos.mode);
      if (entry) {
        entry.remaining = Math.max(0, entry.remaining - pos.size);
      }
    }
  }

  getStats(mode: ModeType): ModeStats {
    const entry = this.state.get(mode);
    if (!entry) {
      return { pnl: 0, trades: 0, volume: 0, allocated: 0, remaining: 0 };
    }
    return {
      pnl: fromSmallestUnit(entry.pnl),
      trades: entry.trades,
      volume: fromSmallestUnit(entry.volume),
      allocated: fromSmallestUnit(entry.allocation),
      remaining: fromSmallestUnit(entry.remaining),
    };
  }
}
