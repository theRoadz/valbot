import type { ModeType, StrategyInfo } from "@shared/types";

export function getModeTag(
  mode: ModeType,
  strategies: StrategyInfo[],
): { label: string; color: string } {
  const strategy = strategies.find((s) => s.modeType === mode);
  if (strategy) {
    return {
      label: strategy.name.slice(0, 3).toUpperCase(),
      color: strategy.modeColor,
    };
  }
  return {
    label: mode.slice(0, 3).toUpperCase(),
    color: "#6b7280",
  };
}
