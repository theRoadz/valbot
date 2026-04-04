export type ErrorSeverity = "info" | "warning" | "critical";

export class AppError extends Error {
  readonly severity: ErrorSeverity;
  readonly code: string;
  readonly details?: string;
  readonly resolution?: string;

  constructor(opts: {
    severity: ErrorSeverity;
    code: string;
    message: string;
    details?: string;
    resolution?: string;
  }) {
    super(opts.message);
    this.name = "AppError";
    this.severity = opts.severity;
    this.code = opts.code;
    this.details = opts.details;
    this.resolution = opts.resolution;
  }
}

export function sessionKeyExpiredError(): AppError {
  return new AppError({
    severity: "critical",
    code: "SESSION_KEY_EXPIRED",
    message:
      "Session key expired — re-extract from browser console and update .env",
    resolution:
      "1. Open Valiant Perps in browser\n2. Run agent key extraction script in console\n3. Copy new session key to .env\n4. Restart the bot",
  });
}

export function sessionKeyInvalidError(details?: string): AppError {
  return new AppError({
    severity: "critical",
    code: "SESSION_KEY_INVALID",
    message: "Session key is invalid — check .env and re-extract if needed",
    details,
    resolution:
      "Verify SESSION_KEY in .env is a valid base58-encoded secret key. Re-extract from browser console if needed.",
  });
}

export function insufficientFundsError(
  mode: string,
  requested: number,
  available: number,
): AppError {
  return new AppError({
    severity: "warning",
    code: "INSUFFICIENT_FUNDS",
    message: `Insufficient funds for mode ${mode}: requested ${requested}, available ${available}`,
    details: `Mode ${mode} has ${available} remaining but ${requested} was requested`,
    resolution:
      "Reduce position size or increase fund allocation for this mode.",
  });
}

export function killSwitchTriggeredError(
  mode: string,
  details: string,
): AppError {
  return new AppError({
    severity: "critical",
    code: "KILL_SWITCH_TRIGGERED",
    message: `Kill switch triggered on ${mode}`,
    details,
    resolution:
      "Review positions and re-allocate funds to restart the mode.",
  });
}

export function rpcConnectionFailedError(
  url: string,
  attempts: number,
): AppError {
  return new AppError({
    severity: "critical",
    code: "RPC_CONNECTION_FAILED",
    message: `RPC connection failed after ${attempts} retries — check network and RPC_URL`,
    details: `Failed to connect to ${url}`,
    resolution:
      "1. Check your internet connection\n2. Verify RPC_URL in .env is correct\n3. Try an alternative FOGOChain RPC endpoint\n4. Restart the bot",
  });
}
