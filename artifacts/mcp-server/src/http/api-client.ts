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

/**
 * Read-only by construction: only ever issues GET with no body. `endpointPath`
 * is the OpenAPI path (e.g. "/diagnostics/latest").
 */
export async function apiGet(endpointPath: string): Promise<unknown> {
  const url = new URL(config.apiBaseUrl + API_PREFIX + endpointPath);

  const res = await fetch(url, {
    method: "GET",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(config.apiTimeoutMs),
  });
  if (!res.ok) {
    throw new ApiError(res.status, endpointPath);
  }
  return (await res.json()) as unknown;
}
