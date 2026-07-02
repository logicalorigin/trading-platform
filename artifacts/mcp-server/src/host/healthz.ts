import { config } from "../config";

export interface HealthzResult {
  url: string;
  ok: boolean;
  status: number | null;
  body: unknown;
  error: string | null;
}

export async function checkHealthz(): Promise<HealthzResult> {
  const url = `${config.apiBaseUrl}/api/healthz`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { url, ok: res.ok, status: res.status, body, error: null };
  } catch (error) {
    return {
      url,
      ok: false,
      status: null,
      body: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
