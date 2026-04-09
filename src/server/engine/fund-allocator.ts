import { eq, like } from "drizzle-orm";
import type { ModeType, ModeStats } from "../../shared/types.js";
import { fromSmallestUnit } from "../../shared/types.js";
import { getDb } from "../db/index.js";
import { config, assertSafeInteger } from "../db/schema.js";
import { AppError, insufficientFundsError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { strategyRegistry } from "./strategy-registry.js";

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
  private maxAllocation = 500_000_000; // default 500 USDC in smallest-unit
  private positionSizes = new Map<ModeType, number>(); // smallest-unit, per mode

  private getOrCreate(mode: ModeType): ModeAllocation {
    let entry = this.state.get(mode);
    if (!entry) {
      entry = defaultAllocation();
      this.state.set(mode, entry);
    }
    return entry;
  }

  /** Get the sum of all mode allocations (smallest-unit) */
  getTotalAllocated(): number {
    let total = 0;
    for (const entry of this.state.values()) {
      total += entry.allocation;
    }
    return total;
  }

  setAllocation(mode: ModeType, amount: number): void {
    assertSafeInteger(amount, `allocation:${mode}`);
    if (amount > this.maxAllocation) {
      throw new AppError({
        severity: "warning",
        code: "ALLOCATION_TOO_LARGE",
        message: `Allocation ${amount} exceeds maximum of ${this.maxAllocation}`,
        resolution: `Enter a value up to $${fromSmallestUnit(this.maxAllocation)}`,
      });
    }
    // Cross-mode total allocation check: sum of all modes cannot exceed maxAllocation
    const currentModeAllocation = this.getOrCreate(mode).allocation;
    const totalAfter = this.getTotalAllocated() - currentModeAllocation + amount;
    if (totalAfter > this.maxAllocation) {
      const available = this.maxAllocation - this.getTotalAllocated() + currentModeAllocation;
      throw new AppError({
        severity: "warning",
        code: "TOTAL_ALLOCATION_EXCEEDED",
        message: `Total allocation across all modes would be $${fromSmallestUnit(totalAfter)}, exceeding maximum of $${fromSmallestUnit(this.maxAllocation)}`,
        resolution: `Available for ${mode}: $${fromSmallestUnit(Math.max(0, available))}`,
      });
    }
    const entry = this.getOrCreate(mode);
    const prevAllocation = entry.allocation;
    const prevRemaining = entry.remaining;
    const diff = amount - prevAllocation;
    entry.allocation = amount;
    entry.remaining = Math.max(0, entry.remaining + diff);

    // Clear position size if it now exceeds the new allocation
    const currentPS = this.positionSizes.get(mode);
    if (currentPS !== undefined && currentPS > amount) {
      this.clearPositionSize(mode);
    }

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

  resetModeStats(mode: ModeType): void {
    const entry = this.state.get(mode);
    if (entry) {
      entry.trades = 0;
      entry.volume = 0;
      entry.pnl = 0;
      entry.remaining = entry.allocation;
    }
  }

  checkKillSwitch(mode: ModeType): boolean {
    const entry = this.state.get(mode);
    if (!entry || entry.allocation === 0) return false;
    const maxLoss = entry.allocation - entry.allocation * KILL_SWITCH_THRESHOLD;
    return entry.pnl < -maxLoss;
  }

  async loadFromDb(): Promise<void> {
    const db = getDb();

    // Discover all modes with persisted allocations (registry-driven, not hardcoded)
    const registeredModes = new Set(strategyRegistry.getRegisteredModeTypes());
    const allocationRows = db.select().from(config).where(like(config.key, "allocation:%")).all();
    for (const row of allocationRows) {
      const mode = row.key.replace("allocation:", "") as ModeType;
      if (!registeredModes.has(mode)) continue;
      try {
        const parsed = JSON.parse(row.value) as { amount: number };
        if (typeof parsed.amount === "number" && Number.isFinite(parsed.amount) && Number.isSafeInteger(parsed.amount)) {
          const entry = this.getOrCreate(mode);
          entry.allocation = parsed.amount;
          entry.remaining = parsed.amount;
        }
      } catch {
        logger.warn({ key: row.key }, "Skipping config row with malformed JSON");
      }
    }

    const positionSizeRows = db.select().from(config).where(like(config.key, "positionSize:%")).all();
    for (const row of positionSizeRows) {
      const mode = row.key.replace("positionSize:", "") as ModeType;
      if (!registeredModes.has(mode)) continue;
      try {
        const parsed = JSON.parse(row.value) as { amount: number };
        if (typeof parsed.amount === "number" && Number.isFinite(parsed.amount) && Number.isSafeInteger(parsed.amount)) {
          this.positionSizes.set(mode, parsed.amount);
        }
      } catch {
        logger.warn({ key: row.key }, "Skipping config row with malformed JSON");
      }
    }

    // Load global max allocation
    const maRows = db.select().from(config).where(eq(config.key, "maxAllocation")).all();
    if (maRows.length > 0) {
      const parsed = JSON.parse(maRows[0].value) as { amount: number };
      if (typeof parsed.amount === "number" && Number.isFinite(parsed.amount) && Number.isSafeInteger(parsed.amount)) {
        this.maxAllocation = parsed.amount;
      }
    }

    this.loadMetadataFromDb();
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

  // --- Max allocation ---

  getMaxAllocation(): number {
    return this.maxAllocation;
  }

  setMaxAllocation(amount: number): void {
    assertSafeInteger(amount, "maxAllocation");
    const MIN = 10_000_000; // $10
    const MAX = 100_000_000_000; // $100,000
    if (amount < MIN || amount > MAX) {
      throw new AppError({
        severity: "warning",
        code: "INVALID_MAX_ALLOCATION",
        message: `Max allocation must be between $10 and $100,000`,
        resolution: `Enter a value between $10 and $100,000`,
      });
    }
    const prev = this.maxAllocation;
    this.maxAllocation = amount;
    try {
      const db = getDb();
      const key = "maxAllocation";
      const value = JSON.stringify({ amount });
      db.insert(config)
        .values({ key, value })
        .onConflictDoUpdate({ target: config.key, set: { value } })
        .run();
    } catch (err) {
      this.maxAllocation = prev;
      throw err;
    }
  }

  // --- Position size ---

  getPositionSize(mode: ModeType): number | null {
    return this.positionSizes.get(mode) ?? null;
  }

  setPositionSize(mode: ModeType, amount: number): void {
    assertSafeInteger(amount, `positionSize:${mode}`);
    const MIN = 10_000_000; // $10
    if (amount < MIN) {
      throw new AppError({
        severity: "warning",
        code: "POSITION_SIZE_TOO_SMALL",
        message: `Position size must be at least $10`,
        resolution: `Enter a value of $10 or more`,
      });
    }
    const alloc = this.getAllocation(mode);
    if (amount > alloc.allocation) {
      throw new AppError({
        severity: "warning",
        code: "POSITION_SIZE_TOO_LARGE",
        message: `Position size cannot exceed allocation`,
        resolution: `Enter a value up to $${fromSmallestUnit(alloc.allocation)}`,
      });
    }
    const prev = this.positionSizes.get(mode);
    this.positionSizes.set(mode, amount);
    try {
      const db = getDb();
      const key = `positionSize:${mode}`;
      const value = JSON.stringify({ amount });
      db.insert(config)
        .values({ key, value })
        .onConflictDoUpdate({ target: config.key, set: { value } })
        .run();
    } catch (err) {
      if (prev !== undefined) this.positionSizes.set(mode, prev);
      else this.positionSizes.delete(mode);
      throw err;
    }
  }

  clearPositionSize(mode: ModeType): void {
    const prev = this.positionSizes.get(mode);
    this.positionSizes.delete(mode);
    try {
      const db = getDb();
      const key = `positionSize:${mode}`;
      db.delete(config).where(eq(config.key, key)).run();
    } catch (err) {
      if (prev !== undefined) this.positionSizes.set(mode, prev);
      throw err;
    }
  }

  // --- Strategy-specific config (e.g., grid trading upperPrice/lowerPrice/gridLines) ---

  private modeMetadata = new Map<string, number>(); // key = "fieldName:modeType"

  getModeMetadata(mode: ModeType, field: string): number | null {
    return this.modeMetadata.get(`${field}:${mode}`) ?? null;
  }

  setModeMetadata(mode: ModeType, field: string, value: number): void {
    const metaKey = `${field}:${mode}`;
    const prev = this.modeMetadata.get(metaKey);
    this.modeMetadata.set(metaKey, value);
    try {
      const db = getDb();
      const dbKey = `meta:${metaKey}`;
      const dbValue = JSON.stringify({ amount: value });
      db.insert(config)
        .values({ key: dbKey, value: dbValue })
        .onConflictDoUpdate({ target: config.key, set: { value: dbValue } })
        .run();
    } catch (err) {
      if (prev !== undefined) this.modeMetadata.set(metaKey, prev);
      else this.modeMetadata.delete(metaKey);
      throw err;
    }
  }

  /** Load strategy-specific metadata from DB during init */
  private loadMetadataFromDb(): void {
    try {
      const db = getDb();
      const metaRows = db.select().from(config).where(like(config.key, "meta:%")).all();
      for (const row of metaRows) {
        const metaKey = row.key.replace("meta:", "");
        try {
          const parsed = JSON.parse(row.value) as { amount: number };
          if (typeof parsed.amount === "number" && Number.isFinite(parsed.amount)) {
            this.modeMetadata.set(metaKey, parsed.amount);
          }
        } catch {
          logger.warn({ key: row.key }, "Skipping metadata row with malformed JSON");
        }
      }
    } catch {
      // DB may not be available yet — skip
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
