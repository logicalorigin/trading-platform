import type { EventEmitter } from "node:events";
import { performance } from "node:perf_hooks";

export type SseStreamCloseReason =
  | "client_close"
  | "request_aborted"
  | "write_backpressure_overflow"
  | "write_backpressure_timeout"
  | "write_error"
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
  "write_backpressure_overflow",
  "write_backpressure_timeout",
  "write_error",
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

type SseConnectionResponse = Pick<EventEmitter, "off" | "once"> & {
  destroyed: boolean;
  writableEnded: boolean;
  write(chunk: string): boolean;
};

type SseWriteFailureReason = Extract<
  SseStreamCloseReason,
  | "write_backpressure_overflow"
  | "write_backpressure_timeout"
  | "write_error"
>;

type SseDrainOutcome =
  | "drain"
  | "closed"
  | "write_backpressure_timeout"
  | "write_error";

type PendingSseChunk = {
  chunk: string | null;
  event: string | null;
  payload: unknown;
  eventId: number | null;
  coalesceKey: string | null;
};

/**
 * Owns one response's write ordering and socket backpressure without allocating
 * one promise/listener pair per published event.
 */
export function createSseConnectionWriter(input: {
  response: SseConnectionResponse;
  onWriteFailure: (reason: SseWriteFailureReason) => void;
  drainTimeoutMs?: number;
  maxPendingChunks?: number;
}) {
  const response = input.response;
  const drainTimeoutMs = Math.max(
    1,
    Math.floor(input.drainTimeoutMs ?? 15_000),
  );
  // ponytail: this bounds per-client frame retention; use a byte budget if
  // measured frame sizes diverge enough that a count stops bounding memory.
  const maxPendingChunks = Math.max(
    1,
    Math.floor(input.maxPendingChunks ?? 256),
  );
  const pendingChunks: PendingSseChunk[] = [];
  const coalescedChunks = new Map<string, PendingSseChunk>();
  let activeDrainCancel: (() => void) | null = null;
  let closed = false;
  let pumping = false;
  let nextEventId = 1;

  const close = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    pendingChunks.splice(0, pendingChunks.length);
    coalescedChunks.clear();
    activeDrainCancel?.();
    activeDrainCancel = null;
  };

  const fail = (reason: SseWriteFailureReason): void => {
    if (closed) {
      return;
    }
    close();
    input.onWriteFailure(reason);
  };

  const waitForDrain = (): Promise<SseDrainOutcome> =>
    new Promise<SseDrainOutcome>((resolve) => {
      let settled = false;
      const finish = (outcome: SseDrainOutcome) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        response.off("drain", onDrain);
        response.off("close", onClose);
        response.off("error", onError);
        activeDrainCancel = null;
        resolve(outcome);
      };
      const onDrain = () => finish("drain");
      const onClose = () => finish("closed");
      const onError = () => finish("write_error");
      const timeout = setTimeout(
        () => finish("write_backpressure_timeout"),
        drainTimeoutMs,
      );
      timeout.unref?.();
      response.once("drain", onDrain);
      response.once("close", onClose);
      response.once("error", onError);
      activeDrainCancel = () => finish("closed");
    });

  const pump = async (): Promise<void> => {
    if (pumping || closed) {
      return;
    }
    pumping = true;
    try {
      while (!closed && pendingChunks.length > 0) {
        const pending = pendingChunks.shift()!;
        if (pending.coalesceKey) {
          coalescedChunks.delete(pending.coalesceKey);
        }
        if (response.destroyed || response.writableEnded) {
          close();
          break;
        }
        const chunk =
          pending.chunk ??
          `id: ${pending.eventId}\nevent: ${pending.event}\ndata: ${serializeSseEventData(pending.payload)}\n\n`;
        if (!response.write(chunk)) {
          const outcome = await waitForDrain();
          if (outcome === "closed") {
            close();
            break;
          }
          if (outcome !== "drain") {
            fail(outcome);
            break;
          }
        }
      }
    } catch {
      fail("write_error");
    } finally {
      pumping = false;
      if (!closed && pendingChunks.length > 0) {
        void pump();
      }
    }
  };

  const enqueue = (pending: PendingSseChunk): void => {
    if (closed || response.destroyed || response.writableEnded) {
      close();
      return;
    }
    if (pending.coalesceKey) {
      const existing = coalescedChunks.get(pending.coalesceKey);
      if (existing) {
        existing.chunk = pending.chunk;
        existing.event = pending.event;
        existing.payload = pending.payload;
        existing.eventId = pending.eventId;
        return;
      }
    }
    if (pendingChunks.length >= maxPendingChunks) {
      fail("write_backpressure_overflow");
      return;
    }
    pendingChunks.push(pending);
    if (pending.coalesceKey) {
      coalescedChunks.set(pending.coalesceKey, pending);
    }
    void pump();
  };

  const writeChunk = (chunk: string, coalesceKey?: string): void => {
    enqueue({
      chunk,
      event: null,
      payload: null,
      eventId: null,
      coalesceKey: coalesceKey ?? null,
    });
  };

  const writeEvent = (
    event: string,
    payload: unknown,
    coalesceKey?: string,
  ): void => {
    const eventId = nextEventId;
    nextEventId += 1;
    if (!coalesceKey) {
      writeChunk(
        `id: ${eventId}\nevent: ${event}\ndata: ${serializeSseEventData(payload)}\n\n`,
      );
      return;
    }
    enqueue({
      chunk: null,
      event,
      payload,
      eventId,
      coalesceKey,
    });
  };

  return { close, writeChunk, writeEvent };
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
