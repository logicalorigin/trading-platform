import { performance } from "node:perf_hooks";

export type SseStreamCloseReason =
  | "client_close"
  | "request_aborted"
  | "write_backpressure_timeout"
  | "setup_error"
  | "server_cleanup";

type SseStreamCounters = {
  opens: number;
  closes: number;
  lastOpenedAt: string | null;
  lastClosedAt: string | null;
  lastCloseReason: SseStreamCloseReason | null;
  closeReasons: Record<SseStreamCloseReason, number>;
};

const CLOSE_REASONS: SseStreamCloseReason[] = [
  "client_close",
  "request_aborted",
  "write_backpressure_timeout",
  "setup_error",
  "server_cleanup",
];

const countersByStream = new Map<string, SseStreamCounters>();

function createCounters(): SseStreamCounters {
  return {
    opens: 0,
    closes: 0,
    lastOpenedAt: null,
    lastClosedAt: null,
    lastCloseReason: null,
    closeReasons: Object.fromEntries(
      CLOSE_REASONS.map((reason) => [reason, 0]),
    ) as Record<SseStreamCloseReason, number>,
  };
}

function countersForStream(stream: string): SseStreamCounters {
  const existing = countersByStream.get(stream);
  if (existing) {
    return existing;
  }
  const counters = createCounters();
  countersByStream.set(stream, counters);
  return counters;
}

export function recordSseStreamOpen(stream: string): void {
  const counters = countersForStream(stream);
  counters.opens += 1;
  counters.lastOpenedAt = new Date().toISOString();
}

export function recordSseStreamClose(
  stream: string,
  reason: SseStreamCloseReason,
): void {
  const counters = countersForStream(stream);
  counters.closes += 1;
  counters.lastClosedAt = new Date().toISOString();
  counters.lastCloseReason = reason;
  counters.closeReasons[reason] = (counters.closeReasons[reason] ?? 0) + 1;
}

export function getSseStreamDiagnostics() {
  return Object.fromEntries(
    Array.from(countersByStream.entries()).map(([stream, counters]) => [
      stream,
      {
        ...counters,
        closeReasons: { ...counters.closeReasons },
      },
    ]),
  );
}

// Cheap cumulative counters for the per-tick SSE serialization cost. Read by the IBKR perf
// capture sampler to quantify how much event-loop time SSE emission consumes once data flows.
// Hot-path additions are integer/performance.now increments only — no extra allocation.
let sseEmitEventCount = 0;
let sseEmitBytes = 0;
let sseEmitStringifyNs = 0;

/** Serialize an SSE event payload while accumulating emit cost counters. */
export function serializeSseEventData(payload: unknown): string {
  const startNs = performance.now();
  const json = JSON.stringify(payload);
  sseEmitStringifyNs += (performance.now() - startNs) * 1_000_000;
  sseEmitEventCount += 1;
  sseEmitBytes += json.length;
  return json;
}

export function getSseEmitCounters(): {
  events: number;
  bytes: number;
  stringifyMs: number;
} {
  return {
    events: sseEmitEventCount,
    bytes: sseEmitBytes,
    stringifyMs: sseEmitStringifyNs / 1_000_000,
  };
}

export function __resetSseStreamDiagnosticsForTests(): void {
  countersByStream.clear();
  sseEmitEventCount = 0;
  sseEmitBytes = 0;
  sseEmitStringifyNs = 0;
}
