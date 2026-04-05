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

vi.mock("@nktkas/hyperliquid", () => {
  return {
    HttpTransport: class MockHttpTransport {},
    ExchangeClient: class MockExchangeClient {
      constructor() {}
    },
    InfoClient: class MockInfoClient {
      clearinghouseState = mockClearinghouseState;
      spotClearinghouseState = mockSpotClearinghouseState;
      constructor() {}
    },
  };
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

  it("throws BALANCE_FETCH_FAILED on API error", async () => {
    const { getWalletBalances } = await import("./client.js");

    const mockInfo = {
      spotClearinghouseState: vi.fn().mockRejectedValue(new Error("Network error")),
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
