import type { ModeType, StatusResponse } from "@shared/types";
import { modeTypeToSlug } from "@shared/types";

export class ApiError extends Error {
  severity: string;
  code: string;
  details: string | null;
  resolution: string;

  constructor(fields: {
    severity: string;
    code: string;
    message: string;
    details: string | null;
    resolution: string;
  }) {
    super(fields.message);
    this.severity = fields.severity;
    this.code = fields.code;
    this.details = fields.details;
    this.resolution = fields.resolution;
  }
}

async function handleResponse(res: Response): Promise<void> {
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new ApiError({
        severity: "critical",
        code: "NETWORK_ERROR",
        message: `Request failed with status ${res.status}`,
        details: null,
        resolution: "Check your network connection",
      });
    }
    const err = (body as { error?: { severity?: string; code?: string; message?: string; details?: string | null; resolution?: string } }).error;
    if (err?.code && err?.message && err?.resolution) {
      throw new ApiError({
        severity: err.severity ?? "critical",
        code: err.code,
        message: err.message,
        details: err.details ?? null,
        resolution: err.resolution,
      });
    }
    throw new ApiError({
      severity: "critical",
      code: "UNKNOWN_ERROR",
      message: `Request failed with status ${res.status}`,
      details: null,
      resolution: "Check your network connection",
    });
  }
}

export async function startMode(mode: ModeType): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api/mode/${modeTypeToSlug(mode)}/start`, { method: "POST" });
  } catch {
    throw new ApiError({
      severity: "critical",
      code: "NETWORK_ERROR",
      message: "Network request failed",
      details: null,
      resolution: "Check your network connection",
    });
  }
  await handleResponse(res);
}

export async function stopMode(mode: ModeType): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api/mode/${modeTypeToSlug(mode)}/stop`, { method: "POST" });
  } catch {
    throw new ApiError({
      severity: "critical",
      code: "NETWORK_ERROR",
      message: "Network request failed",
      details: null,
      resolution: "Check your network connection",
    });
  }
  await handleResponse(res);
}

export async function updateModeConfig(
  mode: ModeType,
  config: { allocation?: number; pairs?: string[]; slippage?: number },
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api/mode/${modeTypeToSlug(mode)}/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
  } catch {
    throw new ApiError({
      severity: "critical",
      code: "NETWORK_ERROR",
      message: "Network request failed",
      details: null,
      resolution: "Check your network connection",
    });
  }
  await handleResponse(res);
}

function isValidStatusResponse(data: unknown): data is StatusResponse {
  if (data == null || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  if (d.modes == null || typeof d.modes !== "object") return false;
  if (!Array.isArray(d.positions)) return false;
  if (!Array.isArray(d.trades)) return false;
  if (d.connection == null || typeof d.connection !== "object") return false;
  const conn = d.connection as Record<string, unknown>;
  if (typeof conn.status !== "string" || !Number.isFinite(conn.equity) || !Number.isFinite(conn.available)) return false;
  return true;
}

export async function fetchStatus(): Promise<StatusResponse> {
  let res: Response;
  try {
    res = await fetch("/api/status");
  } catch {
    throw new ApiError({
      severity: "critical",
      code: "NETWORK_ERROR",
      message: "Network request failed",
      details: null,
      resolution: "Check your network connection",
    });
  }
  if (!res.ok) {
    await handleResponse(res);
  }
  const data: unknown = await res.json();
  if (!isValidStatusResponse(data)) {
    throw new ApiError({
      severity: "critical",
      code: "INVALID_RESPONSE",
      message: "Status response has unexpected shape",
      details: null,
      resolution: "Server may be running an incompatible version",
    });
  }
  return data;
}
