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

// --- Database errors ---

export function dbInitializationFailedError(details: string): AppError {
  return new AppError({
    severity: "critical",
    code: "DB_INITIALIZATION_FAILED",
    message: "Failed to initialize database",
    details,
    resolution: "Check database file permissions and run 'pnpm db:migrate' if tables are missing.",
  });
}

export function dbClosedError(): AppError {
  return new AppError({
    severity: "critical",
    code: "DB_CLOSED",
    message: "Database has been permanently closed via closeDb(). Cannot re-open.",
    resolution: "Restart the application. The database was closed during shutdown.",
  });
}

// --- Engine errors ---

export function engineNotInitializedError(): AppError {
  return new AppError({
    severity: "critical",
    code: "ENGINE_NOT_INITIALIZED",
    message: "Engine not initialized — call initEngine() first",
    resolution: "Ensure the server startup sequence completes before making API calls.",
  });
}

export function modeTransitioningError(mode: string): AppError {
  return new AppError({
    severity: "warning",
    code: "MODE_TRANSITIONING",
    message: `Mode ${mode} is currently transitioning — try again shortly`,
    resolution: `Wait a few seconds and retry. The ${mode} mode is starting or stopping.`,
  });
}

export function unsupportedModeError(mode: string, availableModes?: string[]): AppError {
  const modeList = availableModes?.length ? availableModes.join(", ") : "check registered strategies";
  return new AppError({
    severity: "warning",
    code: "UNSUPPORTED_MODE",
    message: `Unsupported mode type: ${mode}`,
    resolution: `Check mode name. Supported modes: ${modeList}.`,
  });
}

export function invalidStrategyConfigError(mode: string, details: string): AppError {
  return new AppError({
    severity: "warning",
    code: "INVALID_STRATEGY_CONFIG",
    message: `Invalid strategy configuration for ${mode}`,
    details,
    resolution: "Check strategy parameters and retry.",
  });
}

// --- Blockchain errors ---

export function sessionKeyMissingError(): AppError {
  return new AppError({
    severity: "critical",
    code: "SESSION_KEY_MISSING",
    message: "SESSION_KEY not found in .env",
    resolution:
      "Add SESSION_KEY=0x<64-char-hex> to .env file. Must be a 0x-prefixed 32-byte hex key.",
  });
}

export function walletAddressInvalidError(details?: string): AppError {
  return new AppError({
    severity: "critical",
    code: "WALLET_ADDRESS_INVALID",
    message: "WALLET address is invalid — must be 0x-prefixed 40-char hex (20 bytes)",
    details,
    resolution:
      "Set WALLET=0x<your-master-wallet-address> in .env. This is the master wallet from Valiant, not the agent key.",
  });
}

export function noBlockchainClientError(): AppError {
  return new AppError({
    severity: "critical",
    code: "NO_BLOCKCHAIN_CLIENT",
    message: "Blockchain client not initialized",
    resolution: "Check Hyperliquid API connection and restart the bot.",
  });
}

export function balanceFetchFailedError(details?: string): AppError {
  return new AppError({
    severity: "warning",
    code: "BALANCE_FETCH_FAILED",
    message: "Failed to fetch wallet balances",
    details,
    resolution: "Check Hyperliquid API connection. Balance will retry on next cycle.",
  });
}

// --- Position errors ---

export function positionOpenFailedError(details?: string): AppError {
  return new AppError({
    severity: "warning",
    code: "POSITION_OPEN_FAILED",
    message: "Failed to open position on-chain",
    details,
    resolution: "Check blockchain connection and retry.",
  });
}

export function positionCloseFailedError(details?: string): AppError {
  return new AppError({
    severity: "critical",
    code: "POSITION_CLOSE_FAILED",
    message: "Failed to close position on-chain",
    details,
    resolution: "Position remains open. Check blockchain connection and retry, or use kill-switch.",
  });
}

export function positionDbFailedError(details?: string): AppError {
  return new AppError({
    severity: "critical",
    code: "POSITION_DB_FAILED",
    message: "Position opened on-chain but DB insert failed — position was closed",
    details,
    resolution: "Check database health and retry the trade.",
  });
}

export function positionNotFoundError(positionId: number): AppError {
  return new AppError({
    severity: "warning",
    code: "POSITION_NOT_FOUND",
    message: `Position ${positionId} not found`,
    resolution: "Check position ID and try again.",
  });
}

export function shutdownInProgressError(): AppError {
  return new AppError({
    severity: "warning",
    code: "SHUTDOWN_IN_PROGRESS",
    message: "Cannot open position — shutdown in progress.",
    resolution: "Wait for shutdown to complete.",
  });
}

export function stopLossFailedError(details?: string): AppError {
  return new AppError({
    severity: "warning",
    code: "STOP_LOSS_FAILED",
    message: "Failed to set stop-loss — position was closed to prevent orphan",
    details,
    resolution: "Position was closed to prevent orphaned positions. Retry the trade.",
  });
}

export function stopLossOrphanedError(details?: string): AppError {
  return new AppError({
    severity: "critical",
    code: "STOP_LOSS_FAILED",
    message: "Failed to set stop-loss and rollback close also failed — position orphaned on-chain",
    details,
    resolution: "Verify on-chain stop-loss is active. If not, manually close the position via the exchange interface.",
  });
}

export function killSwitchCloseFailedError(details?: string): AppError {
  return new AppError({
    severity: "critical",
    code: "KILL_SWITCH_CLOSE_FAILED",
    message: "Some positions failed to close during kill-switch",
    details,
    resolution: "Verify on-chain stop-losses are active. If not, manually close the listed positions via the exchange interface.",
  });
}

export function killSwitchInProgressError(mode: string): AppError {
  return new AppError({
    severity: "warning",
    code: "KILL_SWITCH_IN_PROGRESS",
    message: `Cannot reset kill-switch on ${mode} — close sweep still in progress`,
    resolution: "Wait for all positions to close before re-allocating.",
  });
}

export function crashRecoveryFailedError(details?: string): AppError {
  return new AppError({
    severity: "critical",
    code: "CRASH_RECOVERY_FAILED",
    message: "Failed to reconcile positions during crash recovery",
    details,
    resolution: "Check Hyperliquid API connection and restart the bot.",
  });
}

export function allocationPersistenceFailedError(details?: string): AppError {
  return new AppError({
    severity: "warning",
    code: "ALLOCATION_PERSISTENCE_FAILED",
    message: "Failed to persist fund allocation to database",
    details,
    resolution: "Check database health. Allocation is active in memory but may not survive a restart.",
  });
}

// --- Oracle errors ---

export function oracleConnectionFailedError(details?: string): AppError {
  return new AppError({
    severity: "critical",
    code: "ORACLE_CONNECTION_FAILED",
    message: "Pyth oracle feed connection failed",
    details,
    resolution:
      "Pyth oracle feed unavailable. Check network connection and Pyth Network status at https://pyth.network",
  });
}

export function oracleFeedUnavailableError(mode: string): AppError {
  return new AppError({
    severity: "warning",
    code: "ORACLE_FEED_UNAVAILABLE",
    message: `${mode} mode requires live oracle price data which is currently unavailable`,
    resolution: `${mode} mode requires live oracle price data which is currently unavailable. Wait for Pyth feed to reconnect or check network status.`,
  });
}

export function oracleStaleDataError(pair: string, lastUpdate: number): AppError {
  return new AppError({
    severity: "warning",
    code: "ORACLE_STALE_DATA",
    message: `Price data for ${pair} is stale (last update: ${lastUpdate})`,
    resolution: `Price data for ${pair} is stale (last update: ${lastUpdate}). Verify Pyth feed status.`,
  });
}

// --- Contract errors ---

export function assetNotFoundError(pair: string): AppError {
  const coin = pair.split("/")[0];
  return new AppError({
    severity: "warning",
    code: "ASSET_NOT_FOUND",
    message: `Unknown asset: ${coin} (from pair ${pair})`,
    resolution: `Check pair format (e.g., "BTC/USDC"). Asset may not be listed on Hyperliquid.`,
  });
}

export function midPriceUnavailableError(coin: string): AppError {
  return new AppError({
    severity: "warning",
    code: "MID_PRICE_UNAVAILABLE",
    message: `No mid price available for ${coin}`,
    resolution: "Asset may be delisted or temporarily unavailable.",
  });
}

export function midPriceInvalidError(coin: string): AppError {
  return new AppError({
    severity: "warning",
    code: "MID_PRICE_INVALID",
    message: `Invalid mid price for ${coin}`,
    resolution: "Market data may be stale. Try again shortly.",
  });
}

export function orderFailedError(details: string): AppError {
  return new AppError({
    severity: "warning",
    code: "ORDER_FAILED",
    message: "Failed to open position",
    details,
    resolution: "Check order parameters and try again.",
  });
}

export function orderNotFilledError(details: string): AppError {
  return new AppError({
    severity: "warning",
    code: "ORDER_NOT_FILLED",
    message: "IOC order was not filled",
    details,
    resolution: "Market may be illiquid. Try again or increase slippage.",
  });
}

export function closeFailedError(details: string): AppError {
  return new AppError({
    severity: "warning",
    code: "CLOSE_FAILED",
    message: "Failed to close position",
    details,
    resolution: "Check position and try again.",
  });
}

export function closeNotFilledError(details: string): AppError {
  return new AppError({
    severity: "warning",
    code: "CLOSE_NOT_FILLED",
    message: "IOC close order was not filled",
    details,
    resolution: "Market may be illiquid. Try again.",
  });
}

export function stopLossSubmissionFailedError(details: string): AppError {
  return new AppError({
    severity: "warning",
    code: "STOP_LOSS_SUBMISSION_FAILED",
    message: "Failed to submit stop-loss order on-chain",
    details,
    resolution: "Check stop-loss price and try again.",
  });
}

// --- Arbitrage errors ---

export function arbitrageNoBlockchainClientError(): AppError {
  return new AppError({
    severity: "warning",
    code: "ARBITRAGE_NO_BLOCKCHAIN_CLIENT",
    message: "Arbitrage requires Hyperliquid connectivity for mid-price data",
    resolution: "Ensure the Hyperliquid blockchain client is connected before starting Arbitrage mode.",
  });
}

export function arbitrageNoSpreadError(pair: string): AppError {
  return new AppError({
    severity: "info",
    code: "ARBITRAGE_NO_SPREAD",
    message: `No arbitrage spread for ${pair} — within threshold`,
    resolution: "No action needed. The strategy will continue monitoring for spread opportunities.",
  });
}

export function arbitrageMidPriceError(pair: string): AppError {
  return new AppError({
    severity: "warning",
    code: "ARBITRAGE_MID_PRICE_ERROR",
    message: `Failed to fetch Hyperliquid mid-price for ${pair}`,
    resolution: "Check Hyperliquid API connection. The strategy will retry on the next iteration.",
  });
}

// --- Profit Hunter errors ---

export function profitHunterNoSignalError(pair: string): AppError {
  return new AppError({
    severity: "info",
    code: "PROFIT_HUNTER_NO_SIGNAL",
    message: `No trading signal for ${pair} — deviation within threshold`,
    resolution: "No action needed. The strategy will continue monitoring for signals.",
  });
}

export function profitHunterStaleOracleError(pair: string): AppError {
  return new AppError({
    severity: "info",
    code: "PROFIT_HUNTER_STALE_ORACLE",
    message: `Oracle data for ${pair} is stale or unavailable — skipping pair`,
    resolution: "Wait for Pyth oracle feed to resume. The strategy will automatically retry on the next iteration.",
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
