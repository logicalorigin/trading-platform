export type ApiRequestLogLevel = "silent" | "error" | "warn" | "info";

const SLOW_REQUEST_LOG_MS = 1_000;

const requestPath = (url: string | null | undefined): string => {
  const path = String(url || "/").split("?")[0] || "/";
  return path.startsWith("/") ? path : `/${path}`;
};

export function isApiHealthProbeUrl(url: string | null | undefined): boolean {
  const path = requestPath(url);
  return path === "/healthz" || path === "/api/healthz";
}

export function isLongLivedStreamUrl(url: string | null | undefined): boolean {
  const path = requestPath(url);
  return (
    path.startsWith("/api/streams/") ||
    path.startsWith("/api/diagnostics/stream") ||
    (path.startsWith("/api/") && path.endsWith("/stream"))
  );
}

export function isExpectedStreamCloseForLogging(input: {
  url: string | null | undefined;
  statusCode: number;
  err?: Error | null;
}): boolean {
  if (!isLongLivedStreamUrl(input.url) || input.statusCode >= 500) {
    return false;
  }
  if (input.statusCode >= 400 && !input.err) {
    return false;
  }
  if (!input.err) {
    return true;
  }
  return /abort|close|premature/i.test(input.err.message);
}

export function resolveApiRequestLogLevel(input: {
  url: string | null | undefined;
  statusCode: number;
  responseTimeMs: number;
  err?: Error | null;
}): ApiRequestLogLevel {
  if (isExpectedStreamCloseForLogging(input)) return "silent";
  if (input.err || input.statusCode >= 500) return "error";
  if (input.statusCode >= 400) return "warn";
  if (isApiHealthProbeUrl(input.url)) return "silent";
  if (input.responseTimeMs >= SLOW_REQUEST_LOG_MS) return "warn";
  if (input.statusCode >= 200 && input.statusCode < 400) return "silent";
  return "info";
}
