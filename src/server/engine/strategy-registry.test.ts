import { describe, it, expect, beforeEach } from "vitest";
import type { ModeRunner } from "./mode-runner.js";
import { StrategyRegistry, type StrategyDeps } from "./strategy-registry.js";

class TestModeRunner {
  mode: string;
  get strategyName() { return "Test"; }
  get strategyDescription() { return "Test strategy"; }
  get defaultConfig() { return {}; }
  get modeColor() { return "#000"; }
  get urlSlug() { return "test"; }
  isRunning() { return false; }
  constructor(mode: string) { this.mode = mode; }
}

describe("StrategyRegistry", () => {
  let registry: StrategyRegistry;

  const volumeMaxReg = {
    name: "Volume Max",
    description: "Volume strategy",
    modeType: "volumeMax",
    urlSlug: "volume-max",
    modeColor: "#3b82f6",
    requires: {},
    factory: () => new TestModeRunner("volumeMax") as unknown as ModeRunner,
  };

  const profitHunterReg = {
    name: "Profit Hunter",
    description: "Profit strategy",
    modeType: "profitHunter",
    urlSlug: "profit-hunter",
    modeColor: "#22c55e",
    requires: { oracle: true },
    factory: () => new TestModeRunner("profitHunter") as unknown as ModeRunner,
  };

  beforeEach(() => {
    registry = new StrategyRegistry();
  });

  it("registers a strategy and retrieves it by modeType", () => {
    registry.registerStrategy(volumeMaxReg);
    const reg = registry.getRegistration("volumeMax");
    expect(reg).toBeDefined();
    expect(reg.name).toBe("Volume Max");
    expect(reg.modeType).toBe("volumeMax");
  });

  it("rejects duplicate modeType registration", () => {
    registry.registerStrategy(volumeMaxReg);
    expect(() => registry.registerStrategy(volumeMaxReg)).toThrow("already registered");
  });

  it("rejects duplicate urlSlug registration", () => {
    registry.registerStrategy(volumeMaxReg);
    const duplicate = { ...profitHunterReg, urlSlug: "volume-max" };
    expect(() => registry.registerStrategy(duplicate)).toThrow("already registered");
  });

  it("returns undefined for unregistered modeType", () => {
    expect(registry.getRegistration("unknown")).toBeUndefined();
  });

  it("getAvailableStrategies returns all registered strategies with status", () => {
    registry.registerStrategy(volumeMaxReg);
    registry.registerStrategy(profitHunterReg);

    const strategies = registry.getAvailableStrategies((mode) =>
      mode === "volumeMax" ? "running" : "stopped",
    );

    expect(strategies).toHaveLength(2);
    expect(strategies[0]).toEqual({
      name: "Volume Max",
      description: "Volume strategy",
      modeType: "volumeMax",
      urlSlug: "volume-max",
      modeColor: "#3b82f6",
      status: "running",
    });
    expect(strategies[1].status).toBe("stopped");
  });

  it("getModeTypeFromSlug resolves slug to modeType", () => {
    registry.registerStrategy(volumeMaxReg);
    expect(registry.getModeTypeFromSlug("volume-max")).toBe("volumeMax");
  });

  it("getModeTypeFromSlug returns undefined for unknown slug", () => {
    expect(registry.getModeTypeFromSlug("unknown")).toBeUndefined();
  });

  it("getRegisteredModeTypes returns all registered mode types", () => {
    registry.registerStrategy(volumeMaxReg);
    registry.registerStrategy(profitHunterReg);
    const types = registry.getRegisteredModeTypes();
    expect(types).toContain("volumeMax");
    expect(types).toContain("profitHunter");
    expect(types).toHaveLength(2);
  });

  it("factory creates a runner instance", () => {
    registry.registerStrategy(volumeMaxReg);
    const reg = registry.getRegistration("volumeMax");
    const runner = reg.factory({} as StrategyDeps);
    expect(runner).toBeDefined();
    expect((runner as any).mode).toBe("volumeMax");
  });
});

describe("Singleton strategyRegistry (integration)", () => {
  it("has all three built-in strategies registered", async () => {
    // Import triggers self-registration via side effects
    const { strategyRegistry } = await import("./strategy-registry.js");
    // Import strategies to trigger their registration
    await import("./strategies/volume-max.js");
    await import("./strategies/profit-hunter.js");
    await import("./strategies/arbitrage.js");

    const types = strategyRegistry.getRegisteredModeTypes();
    expect(types).toContain("volumeMax");
    expect(types).toContain("profitHunter");
    expect(types).toContain("arbitrage");
  });

  it("getAvailableStrategies returns typed metadata for all strategies", async () => {
    const { strategyRegistry } = await import("./strategy-registry.js");
    const strategies = strategyRegistry.getAvailableStrategies(() => "stopped");
    expect(strategies.length).toBeGreaterThanOrEqual(3);

    for (const s of strategies) {
      expect(s).toHaveProperty("name");
      expect(s).toHaveProperty("description");
      expect(s).toHaveProperty("modeType");
      expect(s).toHaveProperty("urlSlug");
      expect(s).toHaveProperty("modeColor");
      expect(s).toHaveProperty("status");
      expect(typeof s.name).toBe("string");
      expect(typeof s.urlSlug).toBe("string");
    }
  });

  it("getModeTypeFromSlug works for all three strategies", async () => {
    const { strategyRegistry } = await import("./strategy-registry.js");
    expect(strategyRegistry.getModeTypeFromSlug("volume-max")).toBe("volumeMax");
    expect(strategyRegistry.getModeTypeFromSlug("profit-hunter")).toBe("profitHunter");
    expect(strategyRegistry.getModeTypeFromSlug("arbitrage")).toBe("arbitrage");
  });

  it("each strategy declares correct requires", async () => {
    const { strategyRegistry } = await import("./strategy-registry.js");

    const vm = strategyRegistry.getRegistration("volumeMax");
    expect(vm?.requires).toEqual({});

    const ph = strategyRegistry.getRegistration("profitHunter");
    expect(ph?.requires).toEqual({ oracle: true });

    const arb = strategyRegistry.getRegistration("arbitrage");
    expect(arb?.requires).toEqual({ oracle: false, blockchain: true });
  });
});
