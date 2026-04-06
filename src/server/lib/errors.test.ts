import { describe, it, expect } from "vitest";
import {
  AppError,
  sessionKeyExpiredError,
  sessionKeyInvalidError,
  apiConnectionFailedError,
  walletAddressMissingError,
  dbInitializationFailedError,
  dbClosedError,
  engineNotInitializedError,
  modeTransitioningError,
  unsupportedModeError,
  invalidStrategyConfigError,
  sessionKeyMissingError,
  walletAddressInvalidError,
  noBlockchainClientError,
  balanceFetchFailedError,
  positionOpenFailedError,
  positionCloseFailedError,
  positionDbFailedError,
  positionNotFoundError,
  shutdownInProgressError,
  stopLossFailedError,
  stopLossOrphanedError,
  killSwitchCloseFailedError,
  killSwitchInProgressError,
  crashRecoveryFailedError,
  allocationPersistenceFailedError,
  assetNotFoundError,
  midPriceUnavailableError,
  midPriceInvalidError,
  orderFailedError,
  orderNotFilledError,
  closeFailedError,
  closeNotFilledError,
  stopLossSubmissionFailedError,
  oracleConnectionFailedError,
  oracleFeedUnavailableError,
  oracleStaleDataError,
  profitHunterNoSignalError,
  profitHunterStaleOracleError,
  arbitrageNoBlockchainClientError,
  arbitrageNoSpreadError,
  arbitrageMidPriceError,
} from "./errors.js";

describe("AppError", () => {
  it("creates error with all fields", () => {
    const err = new AppError({
      severity: "critical",
      code: "TEST_ERROR",
      message: "Test message",
      details: "Some details",
      resolution: "Fix it",
    });

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
    expect(err.name).toBe("AppError");
    expect(err.severity).toBe("critical");
    expect(err.code).toBe("TEST_ERROR");
    expect(err.message).toBe("Test message");
    expect(err.details).toBe("Some details");
    expect(err.resolution).toBe("Fix it");
  });

  it("creates error without optional fields", () => {
    const err = new AppError({
      severity: "info",
      code: "MINIMAL",
      message: "Minimal error",
    });

    expect(err.severity).toBe("info");
    expect(err.code).toBe("MINIMAL");
    expect(err.message).toBe("Minimal error");
    expect(err.details).toBeUndefined();
    expect(err.resolution).toBeUndefined();
  });
});

describe("sessionKeyExpiredError", () => {
  it("returns AppError with correct fields", () => {
    const err = sessionKeyExpiredError();
    expect(err).toBeInstanceOf(AppError);
    expect(err.severity).toBe("critical");
    expect(err.code).toBe("SESSION_KEY_EXPIRED");
    expect(err.message).toContain("expired");
    expect(err.resolution).toBeDefined();
  });
});

describe("sessionKeyInvalidError", () => {
  it("returns AppError with correct fields and details", () => {
    const err = sessionKeyInvalidError("bad base58");
    expect(err).toBeInstanceOf(AppError);
    expect(err.severity).toBe("critical");
    expect(err.code).toBe("SESSION_KEY_INVALID");
    expect(err.message).toContain("invalid");
    expect(err.details).toBe("bad base58");
    expect(err.resolution).toBeDefined();
  });

  it("works without details", () => {
    const err = sessionKeyInvalidError();
    expect(err.details).toBeUndefined();
  });
});

describe("apiConnectionFailedError", () => {
  it("returns AppError with correct fields", () => {
    const err = apiConnectionFailedError(3);
    expect(err).toBeInstanceOf(AppError);
    expect(err.severity).toBe("critical");
    expect(err.code).toBe("API_CONNECTION_FAILED");
    expect(err.message).toContain("3 retries");
    expect(err.resolution).toBeDefined();
  });
});

describe("walletAddressMissingError", () => {
  it("returns AppError with correct fields", () => {
    const err = walletAddressMissingError();
    expect(err).toBeInstanceOf(AppError);
    expect(err.severity).toBe("critical");
    expect(err.code).toBe("WALLET_ADDRESS_MISSING");
    expect(err.message).toContain("WALLET");
    expect(err.resolution).toBeDefined();
  });
});

// --- Database error factories ---

describe("dbInitializationFailedError", () => {
  it("returns critical AppError with details", () => {
    const err = dbInitializationFailedError("missing tables: trades");
    expect(err).toBeInstanceOf(AppError);
    expect(err.severity).toBe("critical");
    expect(err.code).toBe("DB_INITIALIZATION_FAILED");
    expect(err.details).toBe("missing tables: trades");
    expect(err.resolution).toBeDefined();
  });
});

describe("dbClosedError", () => {
  it("returns critical AppError", () => {
    const err = dbClosedError();
    expect(err).toBeInstanceOf(AppError);
    expect(err.severity).toBe("critical");
    expect(err.code).toBe("DB_CLOSED");
    expect(err.resolution).toBeDefined();
  });
});

// --- Engine error factories ---

describe("engineNotInitializedError", () => {
  it("returns critical AppError", () => {
    const err = engineNotInitializedError();
    expect(err).toBeInstanceOf(AppError);
    expect(err.severity).toBe("critical");
    expect(err.code).toBe("ENGINE_NOT_INITIALIZED");
    expect(err.resolution).toBeDefined();
  });
});

describe("modeTransitioningError", () => {
  it("returns warning AppError with mode", () => {
    const err = modeTransitioningError("volumeMax");
    expect(err).toBeInstanceOf(AppError);
    expect(err.severity).toBe("warning");
    expect(err.code).toBe("MODE_TRANSITIONING");
    expect(err.message).toContain("volumeMax");
    expect(err.resolution).toBeDefined();
  });
});

describe("unsupportedModeError", () => {
  it("returns warning AppError with mode", () => {
    const err = unsupportedModeError("badMode");
    expect(err).toBeInstanceOf(AppError);
    expect(err.severity).toBe("warning");
    expect(err.code).toBe("UNSUPPORTED_MODE");
    expect(err.message).toContain("badMode");
    expect(err.resolution).toBeDefined();
  });
});

describe("invalidStrategyConfigError", () => {
  it("returns warning AppError with mode and details", () => {
    const err = invalidStrategyConfigError("volumeMax", "requires at least one trading pair");
    expect(err).toBeInstanceOf(AppError);
    expect(err.severity).toBe("warning");
    expect(err.code).toBe("INVALID_STRATEGY_CONFIG");
    expect(err.message).toContain("volumeMax");
    expect(err.details).toContain("trading pair");
    expect(err.resolution).toBeDefined();
  });
});

// --- Blockchain error factories ---

describe("sessionKeyMissingError", () => {
  it("returns critical AppError", () => {
    const err = sessionKeyMissingError();
    expect(err).toBeInstanceOf(AppError);
    expect(err.severity).toBe("critical");
    expect(err.code).toBe("SESSION_KEY_MISSING");
    expect(err.resolution).toBeDefined();
  });
});

describe("walletAddressInvalidError", () => {
  it("returns critical AppError with details", () => {
    const err = walletAddressInvalidError("Got: 0xabc");
    expect(err).toBeInstanceOf(AppError);
    expect(err.severity).toBe("critical");
    expect(err.code).toBe("WALLET_ADDRESS_INVALID");
    expect(err.details).toBe("Got: 0xabc");
    expect(err.resolution).toBeDefined();
  });
});

describe("noBlockchainClientError", () => {
  it("returns critical AppError", () => {
    const err = noBlockchainClientError();
    expect(err).toBeInstanceOf(AppError);
    expect(err.severity).toBe("critical");
    expect(err.code).toBe("NO_BLOCKCHAIN_CLIENT");
    expect(err.resolution).toBeDefined();
  });
});

describe("balanceFetchFailedError", () => {
  it("returns warning AppError with details", () => {
    const err = balanceFetchFailedError("timeout");
    expect(err).toBeInstanceOf(AppError);
    expect(err.severity).toBe("warning");
    expect(err.code).toBe("BALANCE_FETCH_FAILED");
    expect(err.details).toBe("timeout");
    expect(err.resolution).toBeDefined();
  });
});

// --- Position error factories ---

describe("positionOpenFailedError", () => {
  it("returns warning AppError with details", () => {
    const err = positionOpenFailedError("chain error");
    expect(err).toBeInstanceOf(AppError);
    expect(err.severity).toBe("warning");
    expect(err.code).toBe("POSITION_OPEN_FAILED");
    expect(err.details).toBe("chain error");
    expect(err.resolution).toBeDefined();
  });
});

describe("positionCloseFailedError", () => {
  it("returns critical AppError with details", () => {
    const err = positionCloseFailedError("retry exhausted");
    expect(err).toBeInstanceOf(AppError);
    expect(err.severity).toBe("critical");
    expect(err.code).toBe("POSITION_CLOSE_FAILED");
    expect(err.details).toBe("retry exhausted");
    expect(err.resolution).toBeDefined();
  });
});

describe("positionDbFailedError", () => {
  it("returns critical AppError with details", () => {
    const err = positionDbFailedError("SQLITE_BUSY");
    expect(err).toBeInstanceOf(AppError);
    expect(err.severity).toBe("critical");
    expect(err.code).toBe("POSITION_DB_FAILED");
    expect(err.details).toBe("SQLITE_BUSY");
    expect(err.resolution).toBeDefined();
  });
});

describe("positionNotFoundError", () => {
  it("returns warning AppError with position ID in message", () => {
    const err = positionNotFoundError(42);
    expect(err).toBeInstanceOf(AppError);
    expect(err.severity).toBe("warning");
    expect(err.code).toBe("POSITION_NOT_FOUND");
    expect(err.message).toContain("42");
    expect(err.resolution).toBeDefined();
  });
});

describe("shutdownInProgressError", () => {
  it("returns warning AppError", () => {
    const err = shutdownInProgressError();
    expect(err).toBeInstanceOf(AppError);
    expect(err.severity).toBe("warning");
    expect(err.code).toBe("SHUTDOWN_IN_PROGRESS");
    expect(err.resolution).toBeDefined();
  });
});

describe("stopLossFailedError", () => {
  it("returns warning AppError with details", () => {
    const err = stopLossFailedError("submission timeout");
    expect(err).toBeInstanceOf(AppError);
    expect(err.severity).toBe("warning");
    expect(err.code).toBe("STOP_LOSS_FAILED");
    expect(err.details).toBe("submission timeout");
    expect(err.resolution).toBeDefined();
  });
});

describe("stopLossOrphanedError", () => {
  it("returns critical AppError with details", () => {
    const err = stopLossOrphanedError("rollback close failed");
    expect(err).toBeInstanceOf(AppError);
    expect(err.severity).toBe("critical");
    expect(err.code).toBe("STOP_LOSS_FAILED");
    expect(err.details).toBe("rollback close failed");
    expect(err.resolution).toBeDefined();
  });
});

describe("killSwitchCloseFailedError", () => {
  it("returns critical AppError with details", () => {
    const err = killSwitchCloseFailedError("Position IDs: 1, 2");
    expect(err).toBeInstanceOf(AppError);
    expect(err.severity).toBe("critical");
    expect(err.code).toBe("KILL_SWITCH_CLOSE_FAILED");
    expect(err.details).toContain("1, 2");
    expect(err.resolution).toBeDefined();
  });
});

describe("killSwitchInProgressError", () => {
  it("returns warning AppError with mode", () => {
    const err = killSwitchInProgressError("volumeMax");
    expect(err).toBeInstanceOf(AppError);
    expect(err.severity).toBe("warning");
    expect(err.code).toBe("KILL_SWITCH_IN_PROGRESS");
    expect(err.message).toContain("volumeMax");
    expect(err.resolution).toBeDefined();
  });
});

describe("crashRecoveryFailedError", () => {
  it("returns critical AppError with details", () => {
    const err = crashRecoveryFailedError("API timeout");
    expect(err).toBeInstanceOf(AppError);
    expect(err.severity).toBe("critical");
    expect(err.code).toBe("CRASH_RECOVERY_FAILED");
    expect(err.details).toBe("API timeout");
    expect(err.resolution).toBeDefined();
  });
});

describe("allocationPersistenceFailedError", () => {
  it("returns warning AppError with details", () => {
    const err = allocationPersistenceFailedError("DB locked");
    expect(err).toBeInstanceOf(AppError);
    expect(err.severity).toBe("warning");
    expect(err.code).toBe("ALLOCATION_PERSISTENCE_FAILED");
    expect(err.details).toBe("DB locked");
    expect(err.resolution).toBeDefined();
  });
});

// --- Contract error factories ---

describe("assetNotFoundError", () => {
  it("returns warning AppError with pair info", () => {
    const err = assetNotFoundError("BTC/USDC");
    expect(err).toBeInstanceOf(AppError);
    expect(err.severity).toBe("warning");
    expect(err.code).toBe("ASSET_NOT_FOUND");
    expect(err.message).toContain("BTC");
    expect(err.resolution).toBeDefined();
  });
});

describe("midPriceUnavailableError", () => {
  it("returns warning AppError with coin", () => {
    const err = midPriceUnavailableError("ETH");
    expect(err).toBeInstanceOf(AppError);
    expect(err.severity).toBe("warning");
    expect(err.code).toBe("MID_PRICE_UNAVAILABLE");
    expect(err.message).toContain("ETH");
    expect(err.resolution).toBeDefined();
  });
});

describe("midPriceInvalidError", () => {
  it("returns warning AppError with coin", () => {
    const err = midPriceInvalidError("SOL");
    expect(err).toBeInstanceOf(AppError);
    expect(err.severity).toBe("warning");
    expect(err.code).toBe("MID_PRICE_INVALID");
    expect(err.message).toContain("SOL");
    expect(err.resolution).toBeDefined();
  });
});

describe("orderFailedError", () => {
  it("returns warning AppError with details", () => {
    const err = orderFailedError("Insufficient margin");
    expect(err).toBeInstanceOf(AppError);
    expect(err.severity).toBe("warning");
    expect(err.code).toBe("ORDER_FAILED");
    expect(err.details).toBe("Insufficient margin");
    expect(err.resolution).toBeDefined();
  });
});

describe("orderNotFilledError", () => {
  it("returns warning AppError with details", () => {
    const err = orderNotFilledError("IOC order for BTC/USDC");
    expect(err).toBeInstanceOf(AppError);
    expect(err.severity).toBe("warning");
    expect(err.code).toBe("ORDER_NOT_FILLED");
    expect(err.details).toContain("BTC/USDC");
    expect(err.resolution).toBeDefined();
  });
});

describe("closeFailedError", () => {
  it("returns warning AppError with details", () => {
    const err = closeFailedError("reduce-only failed");
    expect(err).toBeInstanceOf(AppError);
    expect(err.severity).toBe("warning");
    expect(err.code).toBe("CLOSE_FAILED");
    expect(err.details).toBe("reduce-only failed");
    expect(err.resolution).toBeDefined();
  });
});

describe("closeNotFilledError", () => {
  it("returns warning AppError with details", () => {
    const err = closeNotFilledError("IOC close for ETH");
    expect(err).toBeInstanceOf(AppError);
    expect(err.severity).toBe("warning");
    expect(err.code).toBe("CLOSE_NOT_FILLED");
    expect(err.details).toContain("ETH");
    expect(err.resolution).toBeDefined();
  });
});

describe("stopLossSubmissionFailedError", () => {
  it("returns warning AppError with details", () => {
    const err = stopLossSubmissionFailedError("Invalid trigger price");
    expect(err).toBeInstanceOf(AppError);
    expect(err.severity).toBe("warning");
    expect(err.code).toBe("STOP_LOSS_SUBMISSION_FAILED");
    expect(err.details).toBe("Invalid trigger price");
    expect(err.resolution).toBeDefined();
  });
});

// --- Oracle error factories ---

describe("oracleConnectionFailedError", () => {
  it("returns critical AppError with details", () => {
    const err = oracleConnectionFailedError("SSE timeout");
    expect(err).toBeInstanceOf(AppError);
    expect(err.severity).toBe("critical");
    expect(err.code).toBe("ORACLE_CONNECTION_FAILED");
    expect(err.details).toBe("SSE timeout");
    expect(err.resolution).toContain("Pyth");
  });

  it("works without details", () => {
    const err = oracleConnectionFailedError();
    expect(err.details).toBeUndefined();
  });
});

describe("oracleFeedUnavailableError", () => {
  it("returns warning AppError with mode name", () => {
    const err = oracleFeedUnavailableError("profitHunter");
    expect(err).toBeInstanceOf(AppError);
    expect(err.severity).toBe("warning");
    expect(err.code).toBe("ORACLE_FEED_UNAVAILABLE");
    expect(err.message).toContain("profitHunter");
    expect(err.resolution).toContain("profitHunter");
  });
});

describe("oracleStaleDataError", () => {
  it("returns warning AppError with pair and lastUpdate", () => {
    const err = oracleStaleDataError("SOL-PERP", 1700000000);
    expect(err).toBeInstanceOf(AppError);
    expect(err.severity).toBe("warning");
    expect(err.code).toBe("ORACLE_STALE_DATA");
    expect(err.message).toContain("SOL-PERP");
    expect(err.message).toContain("1700000000");
    expect(err.resolution).toContain("SOL-PERP");
  });
});

// --- Arbitrage error factories ---

describe("arbitrageNoBlockchainClientError", () => {
  it("returns warning AppError for missing Hyperliquid client", () => {
    const err = arbitrageNoBlockchainClientError();
    expect(err).toBeInstanceOf(AppError);
    expect(err.severity).toBe("warning");
    expect(err.code).toBe("ARBITRAGE_NO_BLOCKCHAIN_CLIENT");
    expect(err.message).toContain("Hyperliquid");
    expect(err.resolution).toBeDefined();
  });
});

describe("arbitrageNoSpreadError", () => {
  it("returns info AppError with pair", () => {
    const err = arbitrageNoSpreadError("SOL/USDC");
    expect(err).toBeInstanceOf(AppError);
    expect(err.severity).toBe("info");
    expect(err.code).toBe("ARBITRAGE_NO_SPREAD");
    expect(err.message).toContain("SOL/USDC");
    expect(err.resolution).toBeDefined();
  });
});

describe("arbitrageMidPriceError", () => {
  it("returns warning AppError with pair", () => {
    const err = arbitrageMidPriceError("ETH/USDC");
    expect(err).toBeInstanceOf(AppError);
    expect(err.severity).toBe("warning");
    expect(err.code).toBe("ARBITRAGE_MID_PRICE_ERROR");
    expect(err.message).toContain("ETH/USDC");
    expect(err.resolution).toBeDefined();
  });
});

// --- Profit Hunter error factories ---

describe("profitHunterNoSignalError", () => {
  it("returns info AppError with pair", () => {
    const err = profitHunterNoSignalError("SOL/USDC");
    expect(err).toBeInstanceOf(AppError);
    expect(err.severity).toBe("info");
    expect(err.code).toBe("PROFIT_HUNTER_NO_SIGNAL");
    expect(err.message).toContain("SOL/USDC");
    expect(err.resolution).toBeDefined();
  });
});

describe("profitHunterStaleOracleError", () => {
  it("returns info AppError with pair", () => {
    const err = profitHunterStaleOracleError("ETH/USDC");
    expect(err).toBeInstanceOf(AppError);
    expect(err.severity).toBe("info");
    expect(err.code).toBe("PROFIT_HUNTER_STALE_ORACLE");
    expect(err.message).toContain("ETH/USDC");
    expect(err.resolution).toBeDefined();
  });
});
