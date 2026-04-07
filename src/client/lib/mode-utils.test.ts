import { describe, it, expect } from "vitest";
import { getModeTag } from "./mode-utils";
import type { StrategyInfo, ModeStatus } from "@shared/types";

const strategies: StrategyInfo[] = [
  { name: "Volume Max", description: "Volume maximization", modeType: "volumeMax", urlSlug: "volume-max", modeColor: "#8b5cf6", status: "stopped" as ModeStatus },
  { name: "Profit Hunter", description: "Profit hunting", modeType: "profitHunter", urlSlug: "profit-hunter", modeColor: "#22c55e", status: "stopped" as ModeStatus },
  { name: "Arbitrage", description: "Arbitrage trading", modeType: "arbitrage", urlSlug: "arbitrage", modeColor: "#06b6d4", status: "stopped" as ModeStatus },
];

describe("getModeTag", () => {
  it("returns first 3 chars uppercased and color for known strategy", () => {
    const tag = getModeTag("volumeMax", strategies);
    expect(tag.label).toBe("VOL");
    expect(tag.color).toBe("#8b5cf6");
  });

  it("returns correct tag for profitHunter", () => {
    const tag = getModeTag("profitHunter", strategies);
    expect(tag.label).toBe("PRO");
    expect(tag.color).toBe("#22c55e");
  });

  it("returns correct tag for arbitrage", () => {
    const tag = getModeTag("arbitrage", strategies);
    expect(tag.label).toBe("ARB");
    expect(tag.color).toBe("#06b6d4");
  });

  it("falls back gracefully for unknown mode", () => {
    const tag = getModeTag("unknownMode", strategies);
    expect(tag.label).toBe("UNK");
    expect(tag.color).toBe("#6b7280");
  });

  it("falls back when strategies array is empty", () => {
    const tag = getModeTag("volumeMax", []);
    expect(tag.label).toBe("VOL");
    expect(tag.color).toBe("#6b7280");
  });

  it("handles a 4th strategy correctly", () => {
    const extended = [
      ...strategies,
      { name: "Mean Reversion", description: "Mean reversion", modeType: "meanReversion", urlSlug: "mean-reversion", modeColor: "#f59e0b", status: "stopped" as ModeStatus },
    ];
    const tag = getModeTag("meanReversion", extended);
    expect(tag.label).toBe("MEA");
    expect(tag.color).toBe("#f59e0b");
  });
});
