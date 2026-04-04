import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

// Mock logger to avoid pino-pretty transport issues in tests
vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function expectAppError(err: unknown, code: string, severity?: string) {
  const e = err as { name: string; code: string; severity: string };
  expect(e.name).toBe("AppError");
  expect(e.code).toBe(code);
  if (severity) expect(e.severity).toBe(severity);
}

describe("loadSessionKey", () => {
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
    const { loadSessionKey } = await import("./client.js");

    try {
      loadSessionKey();
      expect.unreachable("should have thrown");
    } catch (err) {
      expectAppError(err, "SESSION_KEY_MISSING", "critical");
    }
  });

  it("throws AppError with SESSION_KEY_INVALID when key is malformed", async () => {
    process.env.SESSION_KEY = "not-valid-base58!!!";
    const { loadSessionKey } = await import("./client.js");

    try {
      loadSessionKey();
      expect.unreachable("should have thrown");
    } catch (err) {
      expectAppError(err, "SESSION_KEY_INVALID", "critical");
    }
  });

  it("returns Keypair for valid base58 key", async () => {
    const keypair = Keypair.generate();
    process.env.SESSION_KEY = bs58.encode(keypair.secretKey);
    const { loadSessionKey } = await import("./client.js");

    const result = loadSessionKey();
    expect(result).toBeInstanceOf(Keypair);
    expect(result.publicKey.toBase58()).toBe(keypair.publicKey.toBase58());
  });
});

describe("createRpcConnection", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("throws AppError with RPC_URL_MISSING when env is empty", async () => {
    delete process.env.RPC_URL;
    const { createRpcConnection } = await import("./client.js");

    try {
      await createRpcConnection();
      expect.unreachable("should have thrown");
    } catch (err) {
      expectAppError(err, "RPC_URL_MISSING", "critical");
    }
  });

  it("throws RPC_CONNECTION_FAILED after MAX_RPC_RETRIES failures", async () => {
    process.env.RPC_URL = "https://fake-rpc.test";

    vi.doMock("@solana/web3.js", async (importOriginal) => {
      const actual =
        await importOriginal<typeof import("@solana/web3.js")>();
      return {
        ...actual,
        Connection: class MockConnection {
          async getLatestBlockhash() {
            throw new Error("Connection refused");
          }
        },
      };
    });

    const { createRpcConnection } = await import("./client.js");

    try {
      await createRpcConnection();
      expect.unreachable("should have thrown");
    } catch (err) {
      expectAppError(err, "RPC_CONNECTION_FAILED", "critical");
      expect((err as Error).message).toContain("3 retries");
    }
  }, 30000);

  it("succeeds when RPC connects on first attempt", async () => {
    process.env.RPC_URL = "https://fake-rpc.test";

    vi.doMock("@solana/web3.js", async (importOriginal) => {
      const actual =
        await importOriginal<typeof import("@solana/web3.js")>();
      return {
        ...actual,
        Connection: class MockConnection {
          async getLatestBlockhash() {
            return { blockhash: "fake", lastValidBlockHeight: 100 };
          }
        },
      };
    });

    const { createRpcConnection } = await import("./client.js");
    const conn = await createRpcConnection();
    expect(conn).toBeDefined();
  });
});

describe("getWalletBalance", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns 0 when no token account exists", async () => {
    vi.doMock("@solana/spl-token", () => ({
      getAssociatedTokenAddress: vi.fn().mockResolvedValue("fake-ata"),
      getAccount: vi.fn().mockRejectedValue(
        Object.assign(new Error("not found"), {
          name: "TokenAccountNotFoundError",
        }),
      ),
    }));

    const { getWalletBalance } = await import("./client.js");
    const balance = await getWalletBalance(
      {} as never,
      { toBase58: () => "test" } as never,
    );
    expect(balance).toBe(0);
  });

  it("returns correct smallest-unit value", async () => {
    vi.doMock("@solana/spl-token", () => ({
      getAssociatedTokenAddress: vi.fn().mockResolvedValue("fake-ata"),
      getAccount: vi.fn().mockResolvedValue({
        amount: BigInt(5_000_000), // 5 USDC
      }),
    }));

    const { getWalletBalance } = await import("./client.js");
    const balance = await getWalletBalance(
      {} as never,
      { toBase58: () => "test" } as never,
    );
    expect(balance).toBe(5_000_000);
  });

  it("throws AppError on unexpected errors", async () => {
    vi.doMock("@solana/spl-token", () => ({
      getAssociatedTokenAddress: vi.fn().mockResolvedValue("fake-ata"),
      getAccount: vi.fn().mockRejectedValue(new Error("Network error")),
    }));

    const { getWalletBalance } = await import("./client.js");
    try {
      await getWalletBalance(
        {} as never,
        { toBase58: () => "test" } as never,
      );
      expect.unreachable("should have thrown");
    } catch (err) {
      expectAppError(err, "BALANCE_FETCH_FAILED", "warning");
    }
  });
});
