import { config } from "../config";

// The API server mounts every route under /api; OpenAPI paths are relative to
// that prefix (e.g. spec "/readiness" is served at "/api/readiness").
const API_PREFIX = "/api";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly endpoint: string,
  ) {
    super(`GET ${endpoint} -> HTTP ${status}`);
    this.name = "ApiError";
  }
}

export type QueryValue = string | number | boolean | undefined | null;

export interface ApiGetOptions {
  query?: Record<string, QueryValue>;
}

/**
 * Read-only by construction: only ever issues GET with no body. `endpointPath`
 * is the OpenAPI path (e.g. "/diagnostics/latest").
 */
export async function apiGet(endpointPath: string, opts: ApiGetOptions = {}): Promise<unknown> {
  const url = new URL(config.apiBaseUrl + API_PREFIX + endpointPath);
  for (const [key, value] of Object.entries(opts.query ?? {})) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }

  const headers: Record<string, string> = { accept: "application/json" };
  if (config.apiBearer) {
    headers["authorization"] = `Bearer ${config.apiBearer}`;
  }

  const res = await fetch(url, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(config.apiTimeoutMs),
  });
  if (!res.ok) {
    throw new ApiError(res.status, endpointPath);
  }
  return (await res.json()) as unknown;
}
