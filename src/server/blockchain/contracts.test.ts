import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock logger
vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock withRetry — pass through by default (executes fn immediately)
const mockWithRetry = vi.fn().mockImplementation(
  (fn: () => Promise<unknown>) => fn(),
);
vi.mock("./client.js", () => ({
  withRetry: (...args: unknown[]) => mockWithRetry(...args),
}));

// Build mock exchange and info clients
const mockOrder = vi.fn();
const mockAllMids = vi.fn();
const mockMeta = vi.fn();

const mockExchange = { order: mockOrder } as never;
const mockInfo = {
  allMids: mockAllMids,
  meta: mockMeta,
} as never;

describe("initAssetIndices & resolveAsset", () => {
  beforeEach(() => {
    vi.resetModules();
    mockMeta.mockReset();
  });

  it("loads asset indices from meta and resolves pairs", async () => {
    mockMeta.mockResolvedValue({
      universe: [
        { name: "BTC", szDecimals: 5, maxLeverage: 50 },
        { name: "ETH", szDecimals: 4, maxLeverage: 50 },
        { name: "SOL", szDecimals: 2, maxLeverage: 20 },
      ],
    });

    const { initAssetIndices, resolveAsset } = await import("./contracts.js");
    await initAssetIndices(mockInfo);

    const btc = resolveAsset("BTC/USDC");
    expect(btc.index).toBe(0);
    expect(btc.coin).toBe("BTC");
    expect(btc.szDecimals).toBe(5);

    const eth = resolveAsset("ETH/USDC");
    expect(eth.index).toBe(1);
    expect(eth.coin).toBe("ETH");

    const sol = resolveAsset("SOL/USDC");
    expect(sol.index).toBe(2);
  });

  it("throws ASSET_NOT_FOUND for unknown pairs", async () => {
    mockMeta.mockResolvedValue({
      universe: [{ name: "BTC", szDecimals: 5, maxLeverage: 50 }],
    });

    const { initAssetIndices, resolveAsset } = await import("./contracts.js");
    await initAssetIndices(mockInfo);

    expect(() => resolveAsset("DOGE/USDC")).toThrow();
  });
});

describe("openPosition", () => {
  beforeEach(async () => {
    vi.resetModules();
    mockOrder.mockReset();
    mockAllMids.mockReset();
    mockMeta.mockReset();

    mockMeta.mockResolvedValue({
      universe: [
        { name: "BTC", szDecimals: 5, maxLeverage: 50 },
        { name: "ETH", szDecimals: 4, maxLeverage: 50 },
      ],
    });

    // Pre-load asset indices
    const { initAssetIndices } = await import("./contracts.js");
    await initAssetIndices(mockInfo);
  });

  it("places IOC order and returns fill data on success", async () => {
    mockAllMids.mockResolvedValue({ BTC: "95000.5" });
    mockOrder.mockResolvedValue({
      status: "ok",
      response: {
        type: "order",
        data: {
          statuses: [
            { filled: { totalSz: "0.01", avgPx: "95100.0", oid: 12345 } },
          ],
        },
      },
    });

    const { openPosition } = await import("./contracts.js");
    const result = await openPosition({
      exchange: mockExchange,
      info: mockInfo,
      pair: "BTC/USDC",
      side: "Long",
      size: 10_000_000, // 10 USDC
      slippage: 0.5,
    });

    expect(result.txHash).toBe("hl-12345");
    expect(result.positionId).toBe("BTC-Long");
    expect(result.entryPrice).toBe(95_100_000_000); // 95100.0 * 1e6

    // Verify order was called with correct structure
    expect(mockOrder).toHaveBeenCalledOnce();
    const orderArgs = mockOrder.mock.calls[0][0];
    expect(orderArgs.orders[0].a).toBe(0); // BTC index
    expect(orderArgs.orders[0].b).toBe(true); // Long = buy
    expect(orderArgs.orders[0].r).toBe(false); // not reduce-only
    expect(orderArgs.orders[0].t).toEqual({ limit: { tif: "Ioc" } });
  });

  it("throws ORDER_FAILED when order returns error", async () => {
    mockAllMids.mockResolvedValue({ BTC: "95000.5" });
    mockOrder.mockResolvedValue({
      status: "ok",
      response: {
        type: "order",
        data: { statuses: [{ error: "Insufficient margin" }] },
      },
    });

    const { openPosition } = await import("./contracts.js");

    await expect(
      openPosition({
        exchange: mockExchange,
        info: mockInfo,
        pair: "BTC/USDC",
        side: "Long",
        size: 10_000_000,
        slippage: 0.5,
      }),
    ).rejects.toThrow("Insufficient margin");
  });

  it("throws MID_PRICE_UNAVAILABLE when no mid price", async () => {
    mockAllMids.mockResolvedValue({}); // no BTC mid

    const { openPosition } = await import("./contracts.js");

    await expect(
      openPosition({
        exchange: mockExchange,
        info: mockInfo,
        pair: "BTC/USDC",
        side: "Long",
        size: 10_000_000,
        slippage: 0.5,
      }),
    ).rejects.toThrow("No mid price");
  });
});

describe("closePosition", () => {
  beforeEach(async () => {
    vi.resetModules();
    mockOrder.mockReset();
    mockAllMids.mockReset();
    mockMeta.mockReset();

    mockMeta.mockResolvedValue({
      universe: [
        { name: "BTC", szDecimals: 5, maxLeverage: 50 },
      ],
    });

    const { initAssetIndices } = await import("./contracts.js");
    await initAssetIndices(mockInfo);
  });

  it("places reduce-only IOC order on opposite side", async () => {
    mockAllMids.mockResolvedValue({ BTC: "95000.0" });
    mockOrder.mockResolvedValue({
      status: "ok",
      response: {
        type: "order",
        data: {
          statuses: [
            { filled: { totalSz: "0.01", avgPx: "95000.0", oid: 99999 } },
          ],
        },
      },
    });

    const { closePosition } = await import("./contracts.js");
    const result = await closePosition({
      exchange: mockExchange,
      info: mockInfo,
      positionId: "BTC-Long",
      pair: "BTC/USDC",
      side: "Long",
      size: 10_000_000,
    });

    expect(result.txHash).toBe("hl-99999");
    expect(result.exitPrice).toBe(95_000_000_000);
    expect(typeof result.fees).toBe("number");
    expect(result.fees).toBeGreaterThan(0);

    // Closing a Long means selling (b = false)
    const orderArgs = mockOrder.mock.calls[0][0];
    expect(orderArgs.orders[0].b).toBe(false); // Short side to close Long
    expect(orderArgs.orders[0].r).toBe(true); // reduce-only
  });

  it("closes Short by buying (b = true)", async () => {
    mockAllMids.mockResolvedValue({ BTC: "95000.0" });
    mockOrder.mockResolvedValue({
      status: "ok",
      response: {
        type: "order",
        data: {
          statuses: [
            { filled: { totalSz: "0.01", avgPx: "95000.0", oid: 88888 } },
          ],
        },
      },
    });

    const { closePosition } = await import("./contracts.js");
    await closePosition({
      exchange: mockExchange,
      info: mockInfo,
      positionId: "BTC-Short",
      pair: "BTC/USDC",
      side: "Short",
      size: 10_000_000,
    });

    const orderArgs = mockOrder.mock.calls[0][0];
    expect(orderArgs.orders[0].b).toBe(true); // Buy to close Short
  });
});

describe("setStopLoss", () => {
  beforeEach(async () => {
    vi.resetModules();
    mockOrder.mockReset();
    mockMeta.mockReset();

    mockMeta.mockResolvedValue({
      universe: [
        { name: "BTC", szDecimals: 5, maxLeverage: 50 },
      ],
    });

    const { initAssetIndices } = await import("./contracts.js");
    await initAssetIndices(mockInfo);
  });

  it("places trigger order with tpsl: sl and positionTpsl grouping", async () => {
    mockOrder.mockResolvedValue({
      status: "ok",
      response: {
        type: "order",
        data: { statuses: ["waitingForTrigger"] },
      },
    });

    const { setStopLoss } = await import("./contracts.js");
    const result = await setStopLoss({
      exchange: mockExchange,
      pair: "BTC/USDC",
      side: "Long",
      size: 10_000_000,
      stopLossPrice: 90_000_000_000, // 90000 USDC
    });

    expect(result.txHash).toMatch(/^hl-sl-/);

    const orderArgs = mockOrder.mock.calls[0][0];
    expect(orderArgs.orders[0].t.trigger.tpsl).toBe("sl");
    expect(orderArgs.orders[0].t.trigger.isMarket).toBe(true);
    expect(orderArgs.orders[0].r).toBe(true); // reduce-only
    expect(orderArgs.grouping).toBe("positionTpsl");

    // Stop-loss for Long should sell (b = false for Short side)
    expect(orderArgs.orders[0].b).toBe(false);
  });

  it("stop-loss for Short position buys back (b = true)", async () => {
    mockOrder.mockResolvedValue({
      status: "ok",
      response: {
        type: "order",
        data: { statuses: ["waitingForTrigger"] },
      },
    });

    const { setStopLoss } = await import("./contracts.js");
    await setStopLoss({
      exchange: mockExchange,
      pair: "BTC/USDC",
      side: "Short",
      size: 10_000_000,
      stopLossPrice: 100_000_000_000,
    });

    const orderArgs = mockOrder.mock.calls[0][0];
    expect(orderArgs.orders[0].b).toBe(true); // Buy to close Short
  });

  it("throws STOP_LOSS_FAILED on error response", async () => {
    mockOrder.mockResolvedValue({
      status: "ok",
      response: {
        type: "order",
        data: { statuses: [{ error: "Invalid trigger price" }] },
      },
    });

    const { setStopLoss } = await import("./contracts.js");

    await expect(
      setStopLoss({
        exchange: mockExchange,
        pair: "BTC/USDC",
        side: "Long",
        size: 10_000_000,
        stopLossPrice: 90_000_000_000,
      }),
    ).rejects.toThrow("Invalid trigger price");
  });
});

describe("retry wrapping", () => {
  beforeEach(async () => {
    vi.resetModules();
    mockWithRetry.mockReset();
    mockWithRetry.mockImplementation((fn: () => Promise<unknown>) => fn());
    mockOrder.mockReset();
    mockAllMids.mockReset();
    mockMeta.mockReset();

    mockMeta.mockResolvedValue({
      universe: [
        { name: "BTC", szDecimals: 5, maxLeverage: 50 },
      ],
    });

    const { initAssetIndices } = await import("./contracts.js");
    await initAssetIndices(mockInfo);
  });

  it("getMidPrice calls withRetry for read-only operation", async () => {
    mockAllMids.mockResolvedValue({ BTC: "95000.0" });
    mockOrder.mockResolvedValue({
      status: "ok",
      response: {
        type: "order",
        data: {
          statuses: [
            { filled: { totalSz: "0.01", avgPx: "95000.0", oid: 1 } },
          ],
        },
      },
    });

    const { openPosition } = await import("./contracts.js");
    await openPosition({
      exchange: mockExchange,
      info: mockInfo,
      pair: "BTC/USDC",
      side: "Long",
      size: 10_000_000,
      slippage: 0.5,
    });

    // withRetry called for getMidPrice (read) and openPosition order (write)
    const calls = mockWithRetry.mock.calls;
    // Find the getMidPrice call (no writeCall option)
    const readCalls = calls.filter((c: unknown[]) => c.length === 2 || (c[2] === undefined));
    expect(readCalls.length).toBeGreaterThan(0);
  });

  it("openPosition calls withRetry with writeCall: true for order", async () => {
    mockAllMids.mockResolvedValue({ BTC: "95000.0" });
    mockOrder.mockResolvedValue({
      status: "ok",
      response: {
        type: "order",
        data: {
          statuses: [
            { filled: { totalSz: "0.01", avgPx: "95000.0", oid: 1 } },
          ],
        },
      },
    });

    const { openPosition } = await import("./contracts.js");
    await openPosition({
      exchange: mockExchange,
      info: mockInfo,
      pair: "BTC/USDC",
      side: "Long",
      size: 10_000_000,
      slippage: 0.5,
    });

    const writeCalls = mockWithRetry.mock.calls.filter(
      (c: unknown[]) => c[2] && (c[2] as Record<string, boolean>).writeCall === true,
    );
    expect(writeCalls.length).toBe(1);
    expect(writeCalls[0][1]).toBe("openPosition");
  });

  it("closePosition calls withRetry with writeCall: true", async () => {
    mockAllMids.mockResolvedValue({ BTC: "95000.0" });
    mockOrder.mockResolvedValue({
      status: "ok",
      response: {
        type: "order",
        data: {
          statuses: [
            { filled: { totalSz: "0.01", avgPx: "95000.0", oid: 1 } },
          ],
        },
      },
    });

    const { closePosition } = await import("./contracts.js");
    await closePosition({
      exchange: mockExchange,
      info: mockInfo,
      positionId: "BTC-Long",
      pair: "BTC/USDC",
      side: "Long",
      size: 10_000_000,
    });

    const writeCalls = mockWithRetry.mock.calls.filter(
      (c: unknown[]) => c[2] && (c[2] as Record<string, boolean>).writeCall === true,
    );
    expect(writeCalls.length).toBe(1);
    expect(writeCalls[0][1]).toBe("closePosition");
  });

  it("setStopLoss calls withRetry with writeCall: true", async () => {
    mockOrder.mockResolvedValue({
      status: "ok",
      response: {
        type: "order",
        data: { statuses: ["waitingForTrigger"] },
      },
    });

    const { setStopLoss } = await import("./contracts.js");
    await setStopLoss({
      exchange: mockExchange,
      pair: "BTC/USDC",
      side: "Long",
      size: 10_000_000,
      stopLossPrice: 90_000_000_000,
    });

    const writeCalls = mockWithRetry.mock.calls.filter(
      (c: unknown[]) => c[2] && (c[2] as Record<string, boolean>).writeCall === true,
    );
    expect(writeCalls.length).toBe(1);
    expect(writeCalls[0][1]).toBe("setStopLoss");
  });

  it("refreshAssetCache calls withRetry for read-only meta call", async () => {
    // initAssetIndices was already called in beforeEach, which uses refreshAssetCache
    // Check that withRetry was called with "refreshAssetCache" label
    const metaCalls = mockWithRetry.mock.calls.filter(
      (c: unknown[]) => c[1] === "refreshAssetCache",
    );
    expect(metaCalls.length).toBe(1);
    // No writeCall option for read-only
    expect(metaCalls[0][2]).toBeUndefined();
  });
});
