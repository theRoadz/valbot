import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock logger to avoid pino-pretty transport issues in tests
vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock @nktkas/hyperliquid
const mockClearinghouseState = vi.fn().mockResolvedValue({
  marginSummary: { accountValue: "1000.50" },
  withdrawable: "500.25",
});

const mockSpotClearinghouseState = vi.fn().mockResolvedValue({
  balances: [
    { coin: "USDC", token: 0, total: "1000.50", hold: "200.00", entryNtl: "0" },
  ],
});

const mockPredictedFundings = vi.fn().mockResolvedValue([]);

class MockHttpRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HttpRequestError";
  }
}

vi.mock("@nktkas/hyperliquid", () => {
  return {
    HttpTransport: class MockHttpTransport {},
    ExchangeClient: class MockExchangeClient {
      constructor() {}
    },
    InfoClient: class MockInfoClient {
      clearinghouseState = mockClearinghouseState;
      spotClearinghouseState = mockSpotClearinghouseState;
      predictedFundings = mockPredictedFundings;
      constructor() {}
    },
    HttpRequestError: MockHttpRequestError,
  };
});

// Mock broadcaster
const mockBroadcast = vi.fn();
const mockCacheAlert = vi.fn();
vi.mock("../ws/broadcaster.js", () => ({
  broadcast: (...args: unknown[]) => mockBroadcast(...args),
  cacheAlert: (...args: unknown[]) => mockCacheAlert(...args),
}));

// Mock events
vi.mock("../../shared/events.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return actual;
});

// Mock viem/accounts
vi.mock("viem/accounts", () => ({
  privateKeyToAccount: vi.fn((key: string) => ({
    address: "0x1234567890abcdef1234567890abcdef12345678",
    signTypedData: vi.fn(),
  })),
}));

function expectAppError(err: unknown, code: string, severity?: string) {
  const e = err as { name: string; code: string; severity: string };
  expect(e.name).toBe("AppError");
  expect(e.code).toBe(code);
  if (severity) expect(e.severity).toBe(severity);
}

describe("loadAgentWallet", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("throws AppError with SESSION_KEY_MISSING when env is empty", async () => {
    delete process.env.SESSION_KEY;
    const { loadAgentWallet } = await import("./client.js");

    try {
      loadAgentWallet();
      expect.unreachable("should have thrown");
    } catch (err) {
      expectAppError(err, "SESSION_KEY_MISSING", "critical");
    }
  });

  it("throws AppError with SESSION_KEY_INVALID for malformed key", async () => {
    process.env.SESSION_KEY = "not-valid-hex!!!";
    const { loadAgentWallet } = await import("./client.js");

    try {
      loadAgentWallet();
      expect.unreachable("should have thrown");
    } catch (err) {
      expectAppError(err, "SESSION_KEY_INVALID", "critical");
    }
  });

  it("throws SESSION_KEY_INVALID for wrong-length hex", async () => {
    process.env.SESSION_KEY = "0xabcd"; // too short
    const { loadAgentWallet } = await import("./client.js");

    try {
      loadAgentWallet();
      expect.unreachable("should have thrown");
    } catch (err) {
      expectAppError(err, "SESSION_KEY_INVALID", "critical");
    }
  });

  it("returns account for valid 0x-prefixed 64-char hex key", async () => {
    process.env.SESSION_KEY =
      "0x" + "ab".repeat(32); // 0x + 64 hex chars
    const { loadAgentWallet } = await import("./client.js");

    const result = loadAgentWallet();
    expect(result).toHaveProperty("address");
    expect(result.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("accepts raw hex without 0x prefix", async () => {
    process.env.SESSION_KEY = "ab".repeat(32); // 64 hex chars, no prefix
    const { loadAgentWallet } = await import("./client.js");

    const result = loadAgentWallet();
    expect(result).toHaveProperty("address");
  });
});

describe("WALLET validation", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("throws WALLET_ADDRESS_MISSING when WALLET env is absent", async () => {
    process.env.SESSION_KEY = "0x" + "ab".repeat(32);
    delete process.env.WALLET;
    const { initBlockchainClient } = await import("./client.js");

    try {
      await initBlockchainClient();
      expect.unreachable("should have thrown");
    } catch (err) {
      expectAppError(err, "WALLET_ADDRESS_MISSING", "critical");
    }
  });

  it("throws WALLET_ADDRESS_INVALID for malformed wallet address", async () => {
    process.env.SESSION_KEY = "0x" + "ab".repeat(32);
    process.env.WALLET = "not-an-address";
    const { initBlockchainClient } = await import("./client.js");

    try {
      await initBlockchainClient();
      expect.unreachable("should have thrown");
    } catch (err) {
      expectAppError(err, "WALLET_ADDRESS_INVALID", "critical");
    }
  });
});

describe("initBlockchainClient", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("initializes client with valid SESSION_KEY and WALLET", async () => {
    process.env.SESSION_KEY = "0x" + "ab".repeat(32);
    process.env.WALLET = "0x" + "cd".repeat(20);
    const { initBlockchainClient } = await import("./client.js");

    const client = await initBlockchainClient();
    expect(client).toHaveProperty("exchange");
    expect(client).toHaveProperty("info");
    expect(client).toHaveProperty("walletAddress");
    expect(client).toHaveProperty("agentAddress");
    expect(client.walletAddress).toBe("0x" + "cd".repeat(20));
  });
});

describe("getWalletBalances", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns equity (total) and available (total - hold) from spot USDC", async () => {
    const { getWalletBalances } = await import("./client.js");

    const mockInfo = {
      spotClearinghouseState: vi.fn().mockResolvedValue({
        balances: [
          { coin: "USDC", token: 0, total: "145.169176", hold: "66.497523", entryNtl: "0" },
        ],
      }),
    } as never;

    const balances = await getWalletBalances(mockInfo, "0x1234");
    expect(balances.equity).toBe(145_169_176); // 145.169176 * 1e6
    expect(balances.available).toBe(78_671_653); // (145.169176 - 66.497523) * 1e6
  });

  it("returns 0 for both when no USDC balance", async () => {
    const { getWalletBalances } = await import("./client.js");

    const mockInfo = {
      spotClearinghouseState: vi.fn().mockResolvedValue({
        balances: [],
      }),
    } as never;

    const balances = await getWalletBalances(mockInfo, "0x1234");
    expect(balances.equity).toBe(0);
    expect(balances.available).toBe(0);
  });

  it("re-throws API_CONNECTION_FAILED on network error (not wrapped as BALANCE_FETCH_FAILED)", async () => {
    vi.useFakeTimers();
    const { getWalletBalances } = await import("./client.js");

    const mockInfo = {
      spotClearinghouseState: vi.fn().mockRejectedValue(new Error("Network error")),
    } as never;

    const promise = getWalletBalances(mockInfo, "0x1234").catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(10000);
    const err = await promise;
    expectAppError(err, "API_CONNECTION_FAILED", "critical");
    vi.useRealTimers();
  });

  it("throws BALANCE_FETCH_FAILED on non-connection API error", async () => {
    const { getWalletBalances } = await import("./client.js");

    const mockInfo = {
      spotClearinghouseState: vi.fn().mockResolvedValue({
        balances: "not-an-array",
      }),
    } as never;

    try {
      await getWalletBalances(mockInfo, "0x1234");
      expect.unreachable("should have thrown");
    } catch (err) {
      expectAppError(err, "BALANCE_FETCH_FAILED", "warning");
    }
  });
});

describe("getConnectionStatus", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns null when client not initialized", async () => {
    const { getConnectionStatus } = await import("./client.js");
    const status = await getConnectionStatus();
    expect(status).toBeNull();
  });

  it("returns status with wallet and balance after init", async () => {
    process.env.SESSION_KEY = "0x" + "ab".repeat(32);
    process.env.WALLET = "0x" + "cd".repeat(20);
    const { initBlockchainClient, getConnectionStatus } = await import("./client.js");

    await initBlockchainClient();
    const status = await getConnectionStatus();
    expect(status).not.toBeNull();
    expect(status!.rpc).toBe(true);
    expect(status!.wallet).toBe("0x" + "cd".repeat(20));
    expect(typeof status!.equity).toBe("number");
    expect(typeof status!.available).toBe("number");
  });
});

describe("isRetriableError", () => {
  beforeEach(() => {
    vi.resetModules();
    mockBroadcast.mockReset();
    mockCacheAlert.mockReset();
  });

  it("returns false for AppError (business error)", async () => {
    const { isRetriableError } = await import("./client.js");
    const { AppError } = await import("../lib/errors.js");
    const err = new AppError({ severity: "warning", code: "TEST", message: "test" });
    expect(isRetriableError(err, false)).toBe(false);
    expect(isRetriableError(err, true)).toBe(false);
  });

  it("returns true for HttpRequestError on read calls", async () => {
    const { isRetriableError } = await import("./client.js");
    const err = new MockHttpRequestError("ECONNREFUSED");
    expect(isRetriableError(err, false)).toBe(true);
  });

  it("returns true for HttpRequestError with connection error on write calls", async () => {
    const { isRetriableError } = await import("./client.js");
    const err = new MockHttpRequestError("ECONNREFUSED");
    expect(isRetriableError(err, true)).toBe(true);
  });

  it("returns false for HttpRequestError with timeout on write calls", async () => {
    const { isRetriableError } = await import("./client.js");
    const err = new MockHttpRequestError("ETIMEDOUT");
    expect(isRetriableError(err, true)).toBe(false);
  });

  it("returns false for timeout-like errors on write calls (AbortError)", async () => {
    const { isRetriableError } = await import("./client.js");
    const err = new MockHttpRequestError("AbortError: request timed out");
    expect(isRetriableError(err, true)).toBe(false);
  });

  it("returns true for unknown network error", async () => {
    const { isRetriableError } = await import("./client.js");
    const err = new Error("fetch failed");
    expect(isRetriableError(err, false)).toBe(true);
  });

  it("returns false for unknown non-network error on write calls", async () => {
    const { isRetriableError } = await import("./client.js");
    const err = new Error("something random happened");
    expect(isRetriableError(err, true)).toBe(false);
  });

  it("returns false for HttpRequestError with ECONNRESET on write calls", async () => {
    const { isRetriableError } = await import("./client.js");
    const err = new MockHttpRequestError("ECONNRESET");
    expect(isRetriableError(err, true)).toBe(false);
  });

  it("returns true for HttpRequestError with ECONNRESET on read calls", async () => {
    const { isRetriableError } = await import("./client.js");
    const err = new MockHttpRequestError("ECONNRESET");
    expect(isRetriableError(err, false)).toBe(true);
  });
});

describe("withRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    mockBroadcast.mockReset();
    mockCacheAlert.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns result on first try without retry", async () => {
    const { withRetry } = await import("./client.js");
    const fn = vi.fn().mockResolvedValue("success");
    const result = await withRetry(fn, "test");
    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(mockBroadcast).not.toHaveBeenCalled();
  });

  it("succeeds on second retry after first failure", async () => {
    const { withRetry } = await import("./client.js");
    const fn = vi.fn()
      .mockRejectedValueOnce(new MockHttpRequestError("ECONNREFUSED"))
      .mockResolvedValue("recovered");

    const promise = withRetry(fn, "test");
    await vi.advanceTimersByTimeAsync(10000);
    const result = await promise;
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws after 3 retries are exhausted", async () => {
    const { withRetry } = await import("./client.js");
    const fn = vi.fn().mockRejectedValue(new MockHttpRequestError("ECONNREFUSED"));

    const promise = withRetry(fn, "test").catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(10000);
    const result = await promise;
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain("failed after 3 retries");
    // 1 initial + 3 retries = 4 calls
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it("broadcasts warning during retries", async () => {
    const { withRetry } = await import("./client.js");
    const fn = vi.fn()
      .mockRejectedValueOnce(new MockHttpRequestError("ECONNREFUSED"))
      .mockResolvedValue("ok");

    const promise = withRetry(fn, "test");
    await vi.advanceTimersByTimeAsync(10000);
    await promise;

    const warningCalls = mockBroadcast.mock.calls.filter(
      (call: unknown[]) => call[0] === "alert.triggered" && (call[1] as Record<string, unknown>).severity === "warning",
    );
    expect(warningCalls.length).toBeGreaterThan(0);
    expect((warningCalls[0][1] as Record<string, string>).code).toBe("API_CONNECTION_FAILED");
    expect((warningCalls[0][1] as Record<string, string>).message).toContain("retrying (1/3)");
  });

  it("broadcasts info on recovery", async () => {
    const { withRetry } = await import("./client.js");
    const fn = vi.fn()
      .mockRejectedValueOnce(new MockHttpRequestError("ECONNREFUSED"))
      .mockResolvedValue("ok");

    const promise = withRetry(fn, "test");
    await vi.advanceTimersByTimeAsync(10000);
    await promise;

    const infoCalls = mockBroadcast.mock.calls.filter(
      (call: unknown[]) => call[0] === "alert.triggered" && (call[1] as Record<string, unknown>).severity === "info",
    );
    expect(infoCalls.length).toBe(1);
    expect((infoCalls[0][1] as Record<string, string>).message).toContain("reconnected");
  });

  it("broadcasts critical connection status on exhaustion", async () => {
    const { withRetry } = await import("./client.js");
    const fn = vi.fn().mockRejectedValue(new MockHttpRequestError("ECONNREFUSED"));

    const promise = withRetry(fn, "test").catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(10000);
    const result = await promise;
    expect(result).toBeInstanceOf(Error);

    const criticalCalls = mockBroadcast.mock.calls.filter(
      (call: unknown[]) => call[0] === "alert.triggered" && (call[1] as Record<string, unknown>).severity === "critical",
    );
    expect(criticalCalls.length).toBe(1);
  });

  it("calls cacheAlert on exhaustion", async () => {
    const { withRetry } = await import("./client.js");
    const fn = vi.fn().mockRejectedValue(new MockHttpRequestError("ECONNREFUSED"));

    const promise = withRetry(fn, "test").catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(10000);
    const result = await promise;
    expect(result).toBeInstanceOf(Error);
    expect(mockCacheAlert).toHaveBeenCalledOnce();
  });

  it("does not retry timeout errors for write calls", async () => {
    const { withRetry } = await import("./client.js");
    const fn = vi.fn().mockRejectedValue(new MockHttpRequestError("ETIMEDOUT"));

    await expect(withRetry(fn, "test", { writeCall: true })).rejects.toThrow("ETIMEDOUT");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry ECONNRESET errors for write calls", async () => {
    const { withRetry } = await import("./client.js");
    const fn = vi.fn().mockRejectedValue(new MockHttpRequestError("ECONNRESET"));

    await expect(withRetry(fn, "test", { writeCall: true })).rejects.toThrow("ECONNRESET");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("broadcasts CONNECTION_STATUS on non-retriable error during retry", async () => {
    const { withRetry } = await import("./client.js");
    const { AppError } = await import("../lib/errors.js");

    const fn = vi.fn()
      .mockRejectedValueOnce(new MockHttpRequestError("ECONNREFUSED"))
      .mockRejectedValue(new AppError({ severity: "warning", code: "BIZ", message: "business" }));

    const promise = withRetry(fn, "test").catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(10000);
    const result = await promise;
    expect((result as Error).message).toBe("business");

    // Should have broadcast CONNECTION_STATUS with rpc: false on non-retriable exit
    const connCalls = mockBroadcast.mock.calls.filter(
      (call: unknown[]) => call[0] === "connection.status" && (call[1] as Record<string, unknown>).rpc === false,
    );
    expect(connCalls.length).toBeGreaterThan(0);
  });
});

describe("isApiHealthy", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    mockBroadcast.mockReset();
    mockCacheAlert.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns true initially", async () => {
    const { isApiHealthy } = await import("./client.js");
    expect(isApiHealthy()).toBe(true);
  });

  it("returns false after retry exhaustion", async () => {
    const { withRetry, isApiHealthy } = await import("./client.js");
    const fn = vi.fn().mockRejectedValue(new MockHttpRequestError("ECONNREFUSED"));

    const promise = withRetry(fn, "test").catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(10000);
    await promise;
    expect(isApiHealthy()).toBe(false);
  });

  it("returns true after recovery", async () => {
    const { withRetry, isApiHealthy } = await import("./client.js");
    const fn = vi.fn()
      .mockRejectedValueOnce(new MockHttpRequestError("ECONNREFUSED"))
      .mockResolvedValue("ok");

    const promise = withRetry(fn, "test");
    await vi.advanceTimersByTimeAsync(10000);
    await promise;
    expect(isApiHealthy()).toBe(true);
  });

  it("recovers on next successful call after exhaustion", async () => {
    const { withRetry, isApiHealthy } = await import("./client.js");

    // First: exhaust retries
    const failFn = vi.fn().mockRejectedValue(new MockHttpRequestError("ECONNREFUSED"));
    const failPromise = withRetry(failFn, "fail").catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(10000);
    await failPromise;
    expect(isApiHealthy()).toBe(false);

    // Second: next successful call restores health
    const successFn = vi.fn().mockResolvedValue("recovered");
    const result = await withRetry(successFn, "success");
    expect(result).toBe("recovered");
    expect(isApiHealthy()).toBe(true);

    // Should broadcast recovery info alert
    const infoCalls = mockBroadcast.mock.calls.filter(
      (call: unknown[]) => call[0] === "alert.triggered" && (call[1] as Record<string, unknown>).severity === "info",
    );
    expect(infoCalls.length).toBeGreaterThan(0);
  });
});

describe("withRetry concurrency guard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    mockBroadcast.mockReset();
    mockCacheAlert.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("concurrent call fails fast while another retry is active", async () => {
    const { withRetry } = await import("./client.js");

    // First call: will keep retrying (slow)
    const slowFn = vi.fn().mockRejectedValue(new MockHttpRequestError("ECONNREFUSED"));

    // Start first retry — don't await yet. Catch to prevent unhandled rejection.
    const firstPromise = withRetry(slowFn, "first").catch((e: Error) => e);

    // Allow microtasks to execute so first call enters retry mode
    await vi.advanceTimersByTimeAsync(0);

    // Second call should fail fast
    const fastFn = vi.fn().mockRejectedValue(new MockHttpRequestError("ECONNREFUSED"));
    const secondPromise = withRetry(fastFn, "second").catch((e: Error) => e);

    // Advance timers to complete first retry sequence
    await vi.advanceTimersByTimeAsync(10000);

    // Both should have rejected (caught as Error instances)
    const [firstResult, secondResult] = await Promise.all([firstPromise, secondPromise]);
    expect(firstResult).toBeInstanceOf(Error);
    expect(secondResult).toBeInstanceOf(Error);

    // Fast fn only called once (initial try), then fails fast
    expect(fastFn).toHaveBeenCalledTimes(1);
  });
});

describe("getPredictedFundings", () => {
  beforeEach(() => {
    vi.resetModules();
    mockPredictedFundings.mockReset();
  });

  it("filters for Hyperliquid exchange and parses fundingRate string to number", async () => {
    mockPredictedFundings.mockResolvedValue([
      ["ETH", [
        ["Binance", { fundingRate: "0.0005", nextFundingTime: 1700000000000 }],
        ["Hyperliquid", { fundingRate: "0.00012", nextFundingTime: 1700000000000 }],
        ["Bybit", { fundingRate: "0.0003", nextFundingTime: 1700000000000 }],
      ]],
      ["BTC", [
        ["Binance", { fundingRate: "0.0001", nextFundingTime: 1700003600000 }],
        ["Hyperliquid", { fundingRate: "-0.00005", nextFundingTime: 1700003600000 }],
      ]],
    ]);

    const { getPredictedFundings } = await import("./client.js");
    const mockInfo = { predictedFundings: mockPredictedFundings } as never;
    const result = await getPredictedFundings(mockInfo);

    expect(result.size).toBe(2);
    expect(result.get("ETH")).toEqual({ rate: 0.00012, nextFundingTime: 1700000000000 });
    expect(result.get("BTC")).toEqual({ rate: -0.00005, nextFundingTime: 1700003600000 });
  });

  it("skips assets where Hyperliquid data is null", async () => {
    mockPredictedFundings.mockResolvedValue([
      ["SOL", [
        ["Hyperliquid", null],
        ["Binance", { fundingRate: "0.0001", nextFundingTime: 1700000000000 }],
      ]],
      ["ETH", [
        ["Hyperliquid", { fundingRate: "0.0002", nextFundingTime: 1700000000000 }],
      ]],
    ]);

    const { getPredictedFundings } = await import("./client.js");
    const mockInfo = { predictedFundings: mockPredictedFundings } as never;
    const result = await getPredictedFundings(mockInfo);

    expect(result.size).toBe(1);
    expect(result.has("SOL")).toBe(false);
    expect(result.get("ETH")).toEqual({ rate: 0.0002, nextFundingTime: 1700000000000 });
  });

  it("returns empty map when no Hyperliquid entries exist", async () => {
    mockPredictedFundings.mockResolvedValue([
      ["ETH", [
        ["Binance", { fundingRate: "0.0001", nextFundingTime: 1700000000000 }],
      ]],
    ]);

    const { getPredictedFundings } = await import("./client.js");
    const mockInfo = { predictedFundings: mockPredictedFundings } as never;
    const result = await getPredictedFundings(mockInfo);

    expect(result.size).toBe(0);
  });

  it("returns empty map when response is empty array", async () => {
    mockPredictedFundings.mockResolvedValue([]);

    const { getPredictedFundings } = await import("./client.js");
    const mockInfo = { predictedFundings: mockPredictedFundings } as never;
    const result = await getPredictedFundings(mockInfo);

    expect(result.size).toBe(0);
  });
});

describe("getWalletBalances retry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    mockBroadcast.mockReset();
    mockCacheAlert.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries on network error", async () => {
    const { getWalletBalances } = await import("./client.js");

    const mockInfo = {
      spotClearinghouseState: vi.fn()
        .mockRejectedValueOnce(new MockHttpRequestError("ECONNREFUSED"))
        .mockResolvedValue({
          balances: [
            { coin: "USDC", token: 0, total: "100.00", hold: "0", entryNtl: "0" },
          ],
        }),
    } as never;

    const promise = getWalletBalances(mockInfo, "0x1234");
    await vi.advanceTimersByTimeAsync(10000);
    const result = await promise;
    expect(result.equity).toBe(100_000_000);
  });

  it("does NOT retry when AppError is thrown from inner logic", async () => {
    const { getWalletBalances } = await import("./client.js");

    // spotClearinghouseState returns data that causes inner AppError
    // However, the AppError is thrown AFTER the withRetry succeeds,
    // so let's test a case where spotClearinghouseState itself is an AppError
    const { AppError } = await import("../lib/errors.js");
    const bizErr = new AppError({ severity: "warning", code: "CUSTOM", message: "business error" });

    const mockInfo = {
      spotClearinghouseState: vi.fn().mockRejectedValue(bizErr),
    } as never;

    // withRetry should NOT retry AppError — it should bubble up.
    // But getWalletBalances catches all errors and wraps them as BALANCE_FETCH_FAILED
    try {
      await getWalletBalances(mockInfo, "0x1234");
      expect.unreachable("should have thrown");
    } catch (err) {
      // The AppError passes through withRetry (not retried) and gets caught by
      // getWalletBalances' outer try/catch which wraps it as BALANCE_FETCH_FAILED
      expectAppError(err, "BALANCE_FETCH_FAILED", "warning");
    }
    // Only called once — no retry
    expect((mockInfo as { spotClearinghouseState: ReturnType<typeof vi.fn> }).spotClearinghouseState).toHaveBeenCalledTimes(1);
  });
});
