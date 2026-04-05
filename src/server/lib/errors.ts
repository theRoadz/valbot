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
      "Verify SESSION_KEY in .env is a valid 0x-prefixed 32-byte hex key. Re-extract from Valiant browser console if needed.",
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

export function modeAlreadyRunningError(mode: string): AppError {
  return new AppError({
    severity: "warning",
    code: "MODE_ALREADY_RUNNING",
    message: `Mode ${mode} is already running`,
    resolution: `Stop the ${mode} mode before restarting it.`,
  });
}

export function modeNotAllocatedError(mode: string): AppError {
  return new AppError({
    severity: "warning",
    code: "NO_ALLOCATION",
    message: `No funds allocated to mode ${mode}`,
    resolution: `Allocate funds to ${mode} via the dashboard before starting.`,
  });
}

export function modeKillSwitchedError(mode: string): AppError {
  return new AppError({
    severity: "warning",
    code: "MODE_KILL_SWITCHED",
    message: `Mode ${mode} is in kill-switch state`,
    resolution: `The ${mode} mode was stopped by the kill switch. Re-allocate funds and restart manually.`,
  });
}

export function apiConnectionFailedError(
  attempts: number,
): AppError {
  return new AppError({
    severity: "critical",
    code: "API_CONNECTION_FAILED",
    message: `Hyperliquid API connection failed after ${attempts} retries`,
    resolution:
      "1. Check your internet connection\n2. Verify WALLET address in .env is correct\n3. Check Hyperliquid API status\n4. Restart the bot",
  });
}

export function walletAddressMissingError(): AppError {
  return new AppError({
    severity: "critical",
    code: "WALLET_ADDRESS_MISSING",
    message: "WALLET address not found in .env",
    resolution:
      "Add WALLET=0x<your-master-wallet-address> to .env. This is the master wallet address from Valiant, needed for Hyperliquid info queries.",
  });
}
