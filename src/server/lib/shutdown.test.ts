import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// Track call order
const callOrder: string[] = [];
const mockCloseAllPositions = vi.fn(async () => { callOrder.push("closeAllPositions"); });
const mockEnterShutdown = vi.fn(() => { callOrder.push("enterShutdown"); });

// Mock dependencies
vi.mock("../engine/index.js", () => ({
  stopAllModes: vi.fn(async () => { callOrder.push("stopAllModes"); }),
  getEngine: vi.fn(() => ({
    positionManager: {
      closeAllPositions: mockCloseAllPositions,
      enterShutdown: mockEnterShutdown,
    },
  })),
}));

vi.mock("../ws/broadcaster.js", () => ({
  broadcast: vi.fn((...args: unknown[]) => { callOrder.push("broadcast:" + (args[0] as string)); }),
  closeWebSocket: vi.fn(async () => { callOrder.push("closeWebSocket"); }),
}));

vi.mock("../db/index.js", () => ({
  closeDb: vi.fn(() => { callOrder.push("closeDb"); }),
}));

vi.mock("../../shared/events.js", () => ({
  EVENTS: {
    ALERT_TRIGGERED: "alert.triggered",
  },
}));

vi.mock("./logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

import { registerShutdownHandlers, _resetShutdownState } from "./shutdown.js";
import { stopAllModes, getEngine } from "../engine/index.js";
import { broadcast, closeWebSocket } from "../ws/broadcaster.js";
import { closeDb } from "../db/index.js";

describe("shutdown", () => {
  let mockFastify: FastifyInstance;
  let processExitSpy: ReturnType<typeof vi.spyOn>;
  let registeredHandlers: Map<string, Array<(...args: unknown[]) => void>>;

  beforeEach(() => {
    vi.clearAllMocks();
    callOrder.length = 0;
    _resetShutdownState();

    mockFastify = {
      close: vi.fn(async () => { callOrder.push("fastify.close"); }),
    } as unknown as FastifyInstance;

    // Prevent actual process.exit
    processExitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    // Capture process.on registrations without actually registering them
    registeredHandlers = new Map();
    vi.spyOn(process, "on").mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      const handlers = registeredHandlers.get(event) ?? [];
      handlers.push(handler);
      registeredHandlers.set(event, handlers);
      return process;
    });
  });

  async function triggerShutdown(): Promise<void> {
    registerShutdownHandlers(mockFastify);

    const sigintHandlers = registeredHandlers.get("SIGINT");
    expect(sigintHandlers).toBeDefined();
    expect(sigintHandlers!.length).toBeGreaterThan(0);

    // Call the handler (which calls shutdown("SIGINT") internally)
    // The handler is () => shutdown("SIGINT") — it doesn't return the promise
    // We invoke it and then wait for process.exit to be called
    sigintHandlers![0]();

    // Flush microtasks — the shutdown function is async so we need to let it complete
    await vi.waitFor(() => {
      expect(processExitSpy).toHaveBeenCalled();
    }, { timeout: 2000, interval: 10 });
  }

  it("registers SIGINT and SIGTERM handlers", () => {
    registerShutdownHandlers(mockFastify);

    expect(registeredHandlers.has("SIGINT")).toBe(true);
    expect(registeredHandlers.has("SIGTERM")).toBe(true);
  });

  it("shutdown sequence calls steps in correct order", async () => {
    await triggerShutdown();

    expect(callOrder).toEqual([
      "enterShutdown",
      "broadcast:alert.triggered",
      "stopAllModes",
      "closeAllPositions",
      "fastify.close",
      "closeWebSocket",
      "closeDb",
    ]);
  });

  it("broadcasts SHUTDOWN_INITIATED alert before stopping modes", async () => {
    await triggerShutdown();

    expect(broadcast).toHaveBeenCalledWith("alert.triggered", expect.objectContaining({
      severity: "warning",
      code: "SHUTDOWN_INITIATED",
      message: "Bot is shutting down — closing all positions.",
    }));

    const enterIdx = callOrder.indexOf("enterShutdown");
    const broadcastIdx = callOrder.indexOf("broadcast:alert.triggered");
    const stopIdx = callOrder.indexOf("stopAllModes");
    expect(enterIdx).toBeLessThan(broadcastIdx);
    expect(broadcastIdx).toBeLessThan(stopIdx);
  });

  it("calls fastify.close() after stopAllModes and before closeWebSocket", async () => {
    await triggerShutdown();

    expect(mockFastify.close).toHaveBeenCalledOnce();

    const fastifyIdx = callOrder.indexOf("fastify.close");
    const stopIdx = callOrder.indexOf("stopAllModes");
    const wsIdx = callOrder.indexOf("closeWebSocket");

    expect(fastifyIdx).toBeGreaterThan(stopIdx);
    expect(fastifyIdx).toBeLessThan(wsIdx);
  });

  it("calls closeAllPositions after stopAllModes", async () => {
    await triggerShutdown();

    expect(mockCloseAllPositions).toHaveBeenCalledOnce();

    const closeAllIdx = callOrder.indexOf("closeAllPositions");
    const stopIdx = callOrder.indexOf("stopAllModes");
    expect(closeAllIdx).toBeGreaterThan(stopIdx);
  });

  it("exits with code 0 on successful shutdown", async () => {
    await triggerShutdown();
    expect(processExitSpy).toHaveBeenCalledWith(0);
  });

  it("continues shutdown even if stopAllModes throws", async () => {
    vi.mocked(stopAllModes).mockRejectedValueOnce(new Error("mode stop failed"));

    await triggerShutdown();

    expect(closeWebSocket).toHaveBeenCalled();
    expect(closeDb).toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(0);
  });

  it("continues shutdown even if getEngine throws (engine not initialized)", async () => {
    vi.mocked(getEngine).mockImplementationOnce(() => {
      throw new Error("Engine not initialized");
    });

    await triggerShutdown();

    expect(mockFastify.close).toHaveBeenCalled();
    expect(closeWebSocket).toHaveBeenCalled();
    expect(closeDb).toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(0);
  });
});
