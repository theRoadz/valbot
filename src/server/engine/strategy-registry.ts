import type { ModeType, ModeStatus, StrategyInfo } from "../../shared/types.js";
import type { FundAllocator } from "./fund-allocator.js";
import type { PositionManager } from "./position-manager.js";
import type { ModeRunner, BroadcastFn } from "./mode-runner.js";
import type { OracleClient } from "../blockchain/oracle.js";
import { AppError } from "../lib/errors.js";

export interface StrategyDeps {
  fundAllocator: FundAllocator;
  positionManager: PositionManager;
  broadcast: BroadcastFn;
  oracleClient?: OracleClient;
  getMidPrice?: (coin: string) => Promise<number>;
  getPredictedFundings?: () => Promise<Map<string, { rate: number; nextFundingTime: number }>>;
  config: { pairs: string[]; slippage?: number; positionSize?: number };
}

export interface StrategyRegistration {
  name: string;
  description: string;
  modeType: ModeType;
  urlSlug: string;
  modeColor: string;
  factory: (deps: StrategyDeps) => ModeRunner;
  requires: { oracle?: boolean; blockchain?: boolean };
}

export class StrategyRegistry {
  private registrations = new Map<ModeType, StrategyRegistration>();
  private slugToMode = new Map<string, ModeType>();

  registerStrategy(registration: StrategyRegistration): void {
    if (this.registrations.has(registration.modeType)) {
      throw new AppError({
        severity: "critical",
        code: "STRATEGY_ALREADY_REGISTERED",
        message: `Strategy already registered for mode type: ${registration.modeType}`,
        resolution: "Each mode type can only have one registered strategy.",
      });
    }

    if (this.slugToMode.has(registration.urlSlug)) {
      throw new AppError({
        severity: "critical",
        code: "STRATEGY_ALREADY_REGISTERED",
        message: `URL slug already registered: ${registration.urlSlug}`,
        resolution: "Each strategy must have a unique URL slug.",
      });
    }

    this.registrations.set(registration.modeType, registration);
    this.slugToMode.set(registration.urlSlug, registration.modeType);
  }

  getRegistration(modeType: ModeType): StrategyRegistration | undefined {
    return this.registrations.get(modeType);
  }

  getAvailableStrategies(getStatus: (mode: ModeType) => ModeStatus): StrategyInfo[] {
    return Array.from(this.registrations.values()).map((reg) => ({
      name: reg.name,
      description: reg.description,
      modeType: reg.modeType,
      urlSlug: reg.urlSlug,
      modeColor: reg.modeColor,
      status: getStatus(reg.modeType),
    }));
  }

  getModeTypeFromSlug(slug: string): ModeType | undefined {
    return this.slugToMode.get(slug);
  }

  getRegisteredModeTypes(): ModeType[] {
    return Array.from(this.registrations.keys());
  }
}

export const strategyRegistry = new StrategyRegistry();
