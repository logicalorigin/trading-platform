export type ApiRequestSample = {
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  recordedAt: number;
};

const REQUEST_WINDOW_MS = 5 * 60 * 1000;
const MAX_REQUEST_SAMPLES = 2_000;

const requestSamples: ApiRequestSample[] = [];

export function recordApiRequest(input: {
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
}): void {
  requestSamples.push({
    method: input.method,
    path: input.path,
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
