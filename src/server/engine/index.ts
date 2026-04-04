import { FundAllocator } from "./fund-allocator.js";
import { PositionManager } from "./position-manager.js";
import { broadcast } from "../ws/broadcaster.js";
import { logger } from "../lib/logger.js";

let fundAllocator: FundAllocator | null = null;
let positionManager: PositionManager | null = null;

export async function initEngine(): Promise<void> {
  if (fundAllocator && positionManager) {
    logger.warn("Engine already initialized — skipping re-initialization");
    return;
  }

  fundAllocator = new FundAllocator();
  positionManager = new PositionManager(fundAllocator, broadcast);

  await fundAllocator.loadFromDb();
  await positionManager.loadFromDb();

  // Reconcile: subtract open position sizes from fund allocator remaining
  const openPositions = positionManager.getInternalPositions();
  if (openPositions.length > 0) {
    fundAllocator.reconcilePositions(openPositions);
    logger.info({ count: openPositions.length }, "Reconciled fund allocator with open positions");
  }

  logger.info("Engine initialized — fund allocator and position manager ready");
}

export function getEngine(): {
  fundAllocator: FundAllocator;
  positionManager: PositionManager;
} {
  if (!fundAllocator || !positionManager) {
    throw new Error("Engine not initialized — call initEngine() first");
  }
  return { fundAllocator, positionManager };
}
