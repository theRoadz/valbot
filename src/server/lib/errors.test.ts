import { describe, it, expect } from "vitest";
import {
  AppError,
  sessionKeyExpiredError,
  sessionKeyInvalidError,
  rpcConnectionFailedError,
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

describe("rpcConnectionFailedError", () => {
  it("returns AppError with correct fields", () => {
    const err = rpcConnectionFailedError("https://rpc.fogo.chain", 3);
    expect(err).toBeInstanceOf(AppError);
    expect(err.severity).toBe("critical");
    expect(err.code).toBe("RPC_CONNECTION_FAILED");
    expect(err.message).toContain("3 retries");
    expect(err.details).toContain("https://rpc.fogo.chain");
    expect(err.resolution).toBeDefined();
  });
});
