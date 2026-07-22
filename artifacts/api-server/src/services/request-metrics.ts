import { isApiHealthProbeUrl } from "../lib/request-logging";

export type ApiRequestSample = {
  method: string;
  path: string;
  routeClass?: string | null;
  requestFamily?: string | null;
  fetchPriority?: number | null;
  requestOrigin?: string | null;
  clientRole?: string | null;
  statusCode: number;
  durationMs: number;
  recordedAt: number;
};

const REQUEST_WINDOW_MS = 5 * 60 * 1000;
const MAX_REQUEST_SAMPLES = 2_000;

const requestSamples: ApiRequestSample[] = [];

function normalizeMetricContextValue(value: string | null | undefined): string | null {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "-");
  return normalized ? normalized.slice(0, 64) : null;
}

function normalizeMetricFetchPriority(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

export function recordApiRequest(input: {
  method: string;
  path: string;
  routeClass?: string | null;
  requestFamily?: string | null;
  fetchPriority?: number | null;
  requestOrigin?: string | null;
  clientRole?: string | null;
  statusCode: number;
  durationMs: number;
}): void {
  if (
    input.statusCode >= 200 &&
    input.statusCode < 300 &&
    isApiHealthProbeUrl(input.path)
  ) {
    return;
  }
  requestSamples.push({
    method: input.method,
    path: input.path,
    routeClass: input.routeClass ?? null,
    requestFamily: normalizeMetricContextValue(input.requestFamily),
    fetchPriority: normalizeMetricFetchPriority(input.fetchPriority),
    requestOrigin: normalizeMetricContextValue(input.requestOrigin),
    clientRole: normalizeMetricContextValue(input.clientRole),
    statusCode: input.statusCode,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    recordedAt: Date.now(),
  });
  if (requestSamples.length > MAX_REQUEST_SAMPLES) {
    requestSamples.splice(0, requestSamples.length - MAX_REQUEST_SAMPLES);
  }
}

export function getRecentRequestSamples(): ApiRequestSample[] {
  const cutoff = Date.now() - REQUEST_WINDOW_MS;
  while (requestSamples.length && requestSamples[0]!.recordedAt < cutoff) {
    requestSamples.shift();
  }
  return requestSamples;
}

export function __resetRequestMetricsForTests(): void {
  requestSamples.splice(0, requestSamples.length);
}
