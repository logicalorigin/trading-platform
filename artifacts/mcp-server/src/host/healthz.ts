import { config } from "../config";

export interface HealthzResult {
  url: string;
  ok: boolean;
  status: number | null;
  body: unknown;
  error: string | null;
}

export async function checkHealthz(): Promise<HealthzResult> {
  const url = "/api/healthz";
  try {
    const res = await fetch(`${config.apiBaseUrl}${url}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return { url, ok: false, status: res.status, body: null, error: "http_error" };
    }
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { url, ok: res.ok, status: res.status, body, error: null };
  } catch (error) {
    const name =
      error !== null && typeof error === "object" && "name" in error
        ? String(error.name)
        : "";
    return {
      url,
      ok: false,
      status: null,
      body: null,
      error:
        name === "TimeoutError" || name === "AbortError"
          ? "timeout"
          : "request_failed",
    };
  }
}
