import { readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";

import { getApiResourcePressureSnapshot } from "./resource-pressure";
import { getBridgeGovernorSnapshot } from "./bridge-governor";
import { getBridgeOptionQuoteStreamDiagnostics } from "./bridge-option-quote-stream";
import { getBridgeQuoteStreamDiagnostics } from "./bridge-quote-stream";
import { getConnectionAuditSnapshot } from "./ibkr-connection-audit";
import {
  appendFlightRecorderJsonLine,
  atomicWriteFlightRecorderJson,
  atomicWriteFlightRecorderText,
  flightRecorderDateKey,
  recorderDir,
} from "./runtime-flight-recorder";
import {
  getSseEmitCounters,
  getSseStreamDiagnostics,
} from "./sse-stream-diagnostics";
import { getStockAggregateStreamDiagnostics } from "./stock-aggregate-stream";

/**
 * Before/after IBKR-data performance capture.
 *
 * A flag-gated sampler periodically bundles a consolidated server perf snapshot (windowed
 * event-loop delay, RSS, pressure, bridge/aggregate/SSE/governor stats, SSE serialization cost)
 * plus the latest client-reported attribution metrics, tags each sample with the live broker
 * connection state, derives rates between samples, and writes a rolling document under the
 * flight-recorder dir:
 *   - ibkr-perf-YYYY-MM-DD.jsonl   append-only per-sample log
 *   - ibkr-perf-current.json       latest sample + before(disconnected)/after(connected) buckets
 *   - ibkr-perf.md                 human-readable before/after comparison
 *
 * Goal: prove whether live-data lag is server-side (event loop blocked by SSE serialization /
 * fan-out) or client-side (re-render storm), with numbers. Adds no hot-path cost: sampling runs
 * on the timer, never per tick; off unless explicitly started.
 */

const DEFAULT_INTERVAL_MS = 7000;
const RETENTION_DAYS = 7;

// Numeric metrics tracked for the before/after buckets.
const METRIC_KEYS = [
  "eventLoopDelayP95Ms",
  "eventLoopDelayMaxMs",
  "rssMb",
  "apiP95LatencyMs",
  "quoteEventsPerSec",
  "aggregateEventsPerSec",
  "optionEventsPerSec",
  "sseEventsPerSec",
  "sseStringifyMsPerSec",
  "sseBytesPerSec",
  "pendingFanoutCount",
  "longTaskMsPerWindow",
  "notificationsPerSec",
  "symbolListenerCount",
] as const;
type MetricKey = (typeof METRIC_KEYS)[number];

type Bucket = {
  samples: number;
  sums: Record<MetricKey, number>;
  counts: Record<MetricKey, number>;
  maxes: Record<MetricKey, number>;
};

const elMonitor = monitorEventLoopDelay({ resolution: 20 });
let samplerTimer: ReturnType<typeof setInterval> | null = null;
let prevSample: { atMs: number; server: ServerPerfSnapshot } | null = null;
let latestSample: PerfSample | null = null;
let latestClientMetrics: Record<string, unknown> | null = null;
const buckets: { disconnected: Bucket; connected: Bucket } = {
  disconnected: newBucket(),
  connected: newBucket(),
};

type ServerPerfSnapshot = {
  eventLoopDelay: { meanMs: number; p95Ms: number; maxMs: number };
  memoryMb: { rss: number; heapUsed: number };
  apiPressure: unknown;
  bridgeQuote: unknown;
  optionQuote: unknown;
  stockAggregate: unknown;
  sseStreams: unknown;
  sseEmit: { events: number; bytes: number; stringifyMs: number } | null;
  governor: unknown;
};

type PerfSample = {
  ts: string;
  connected: boolean | null;
  server: ServerPerfSnapshot;
  rates: Record<string, number> | null;
  client: Record<string, unknown> | null;
};

function newBucket(): Bucket {
  const zero = () =>
    Object.fromEntries(METRIC_KEYS.map((k) => [k, 0])) as Record<MetricKey, number>;
  return { samples: 0, sums: zero(), counts: zero(), maxes: zero() };
}

function bytesToMb(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

function safeCall<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

function numericField(value: unknown, ...keyPath: string[]): number | null {
  let cur: unknown = value;
  for (const key of keyPath) {
    if (!cur || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[key];
  }
  return typeof cur === "number" && Number.isFinite(cur) ? cur : null;
}

export function captureServerPerfSnapshot(): ServerPerfSnapshot {
  const mem = process.memoryUsage();
  const ms = (ns: number): number =>
    Number.isFinite(ns) ? Math.round((ns / 1_000_000) * 100) / 100 : 0;
  const eventLoopDelay = safeCall(() => ({
    meanMs: ms(elMonitor.mean),
    p95Ms: ms(elMonitor.percentile(95)),
    maxMs: ms(elMonitor.max),
  })) ?? { meanMs: 0, p95Ms: 0, maxMs: 0 };
  const snapshot: ServerPerfSnapshot = {
    eventLoopDelay,
    memoryMb: { rss: bytesToMb(mem.rss), heapUsed: bytesToMb(mem.heapUsed) },
    apiPressure: safeCall(getApiResourcePressureSnapshot),
    bridgeQuote: safeCall(getBridgeQuoteStreamDiagnostics),
    optionQuote: safeCall(getBridgeOptionQuoteStreamDiagnostics),
    stockAggregate: safeCall(getStockAggregateStreamDiagnostics),
    sseStreams: safeCall(getSseStreamDiagnostics),
    sseEmit: safeCall(getSseEmitCounters),
    governor: safeCall(getBridgeGovernorSnapshot),
  };
  // Window the event-loop delay histogram so each sample reflects the interval since the last.
  elMonitor.reset();
  return snapshot;
}

function deriveRates(
  prev: { atMs: number; server: ServerPerfSnapshot },
  curAtMs: number,
  cur: ServerPerfSnapshot,
): Record<string, number> | null {
  const dt = (curAtMs - prev.atMs) / 1000;
  if (dt <= 0) return null;
  const rate = (
    a: number | null,
    b: number | null,
  ): number | null =>
    a === null || b === null ? null : Math.max(0, (a - b) / dt);
  const out: Record<string, number> = {};
  const set = (key: string, value: number | null) => {
    if (value !== null) out[key] = Math.round(value * 100) / 100;
  };
  set(
    "quoteEventsPerSec",
    rate(
      numericField(cur.bridgeQuote, "eventCount"),
      numericField(prev.server.bridgeQuote, "eventCount"),
    ),
  );
  set(
    "aggregateEventsPerSec",
    rate(
      numericField(cur.stockAggregate, "eventCount"),
      numericField(prev.server.stockAggregate, "eventCount"),
    ),
  );
  set(
    "optionEventsPerSec",
    rate(
      numericField(cur.optionQuote, "eventCount"),
      numericField(prev.server.optionQuote, "eventCount"),
    ),
  );
  set(
    "sseEventsPerSec",
    rate(cur.sseEmit?.events ?? null, prev.server.sseEmit?.events ?? null),
  );
  set(
    "sseBytesPerSec",
    rate(cur.sseEmit?.bytes ?? null, prev.server.sseEmit?.bytes ?? null),
  );
  set(
    "sseStringifyMsPerSec",
    rate(
      cur.sseEmit?.stringifyMs ?? null,
      prev.server.sseEmit?.stringifyMs ?? null,
    ),
  );
  return out;
}

function extractMetrics(sample: PerfSample): Partial<Record<MetricKey, number>> {
  const r = sample.rates ?? {};
  const liveData =
    sample.client && typeof sample.client["liveData"] === "object"
      ? (sample.client["liveData"] as Record<string, unknown>)
      : null;
  const m: Partial<Record<MetricKey, number>> = {
    eventLoopDelayP95Ms: sample.server.eventLoopDelay.p95Ms,
    eventLoopDelayMaxMs: sample.server.eventLoopDelay.maxMs,
    rssMb: sample.server.memoryMb.rss,
  };
  const apiP95 = numericField(sample.server.apiPressure, "inputs", "apiP95LatencyMs");
  if (apiP95 !== null) m.apiP95LatencyMs = apiP95;
  const pending = numericField(sample.server.stockAggregate, "pendingFanoutCount");
  if (pending !== null) m.pendingFanoutCount = pending;
  for (const key of [
    "quoteEventsPerSec",
    "aggregateEventsPerSec",
    "optionEventsPerSec",
    "sseEventsPerSec",
    "sseStringifyMsPerSec",
    "sseBytesPerSec",
  ] as const) {
    if (typeof r[key] === "number") m[key] = r[key];
  }
  if (liveData) {
    const lt = numericField(liveData, "longTaskMsPerWindow");
    if (lt !== null) m.longTaskMsPerWindow = lt;
    const notif = numericField(liveData, "notificationsPerSec");
    if (notif !== null) m.notificationsPerSec = notif;
    const sl = numericField(liveData, "symbolListenerCount");
    if (sl !== null) m.symbolListenerCount = sl;
  }
  return m;
}

function accumulate(sample: PerfSample): void {
  if (sample.connected === null) return;
  const bucket = sample.connected ? buckets.connected : buckets.disconnected;
  bucket.samples += 1;
  const metrics = extractMetrics(sample);
  for (const key of METRIC_KEYS) {
    const value = metrics[key];
    if (typeof value === "number") {
      bucket.sums[key] += value;
      bucket.counts[key] += 1;
      if (value > bucket.maxes[key]) bucket.maxes[key] = value;
    }
  }
}

function bucketSummary(bucket: Bucket) {
  const avg = {} as Record<MetricKey, number | null>;
  const max = {} as Record<MetricKey, number | null>;
  for (const key of METRIC_KEYS) {
    avg[key] =
      bucket.counts[key] > 0
        ? Math.round((bucket.sums[key] / bucket.counts[key]) * 100) / 100
        : null;
    max[key] = bucket.counts[key] > 0 ? bucket.maxes[key] : null;
  }
  return { samples: bucket.samples, avg, max };
}

export function getIbkrPerfSnapshot() {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    running: samplerTimer !== null,
    intervalMs: Number(
      process.env["IBKR_PERF_CAPTURE_INTERVAL_MS"] ?? DEFAULT_INTERVAL_MS,
    ),
    before_disconnected: bucketSummary(buckets.disconnected),
    after_connected: bucketSummary(buckets.connected),
    latest: latestSample,
  };
}

function renderMarkdown(snapshot: ReturnType<typeof getIbkrPerfSnapshot>): string {
  const lines: string[] = [];
  lines.push("# IBKR Data Performance Capture (before/after)");
  lines.push("");
  lines.push(`- Updated: \`${snapshot.updatedAt}\``);
  lines.push(
    `- Running: \`${snapshot.running}\` | Interval: ${snapshot.intervalMs}ms | ` +
      `samples: disconnected=${snapshot.before_disconnected.samples} connected=${snapshot.after_connected.samples}`,
  );
  lines.push("");
  lines.push("## Before (disconnected) vs After (connected)");
  lines.push("");
  lines.push("| metric | disc avg | disc max | conn avg | conn max |");
  lines.push("|--------|---------:|---------:|---------:|---------:|");
  for (const key of METRIC_KEYS) {
    const b = snapshot.before_disconnected;
    const a = snapshot.after_connected;
    lines.push(
      `| ${key} | ${fmt(b.avg[key])} | ${fmt(b.max[key])} | ${fmt(a.avg[key])} | ${fmt(a.max[key])} |`,
    );
  }
  lines.push("");
  if (snapshot.latest) {
    lines.push(
      `Latest sample: connected=\`${snapshot.latest.connected}\` at \`${snapshot.latest.ts}\``,
    );
  }
  return `${lines.join("\n")}\n`;
}

function fmt(value: number | null): string {
  return value === null ? "-" : String(value);
}

function logFilePath(iso: string): string {
  return path.join(recorderDir(), `ibkr-perf-${flightRecorderDateKey(iso)}.jsonl`);
}

function writeOutputs(sample: PerfSample): void {
  try {
    appendFlightRecorderJsonLine(
      logFilePath(sample.ts),
      sample as unknown as Record<string, unknown>,
    );
  } catch {
    // best-effort
  }
  try {
    const snapshot = getIbkrPerfSnapshot();
    atomicWriteFlightRecorderJson(
      path.join(recorderDir(), "ibkr-perf-current.json"),
      snapshot,
    );
    atomicWriteFlightRecorderText(
      path.join(recorderDir(), "ibkr-perf.md"),
      renderMarkdown(snapshot),
    );
  } catch {
    // best-effort
  }
}

function pruneOldLogs(nowMs: number): void {
  try {
    const cutoffKey = flightRecorderDateKey(
      new Date(nowMs - RETENTION_DAYS * 86_400_000).toISOString(),
    );
    const dir = recorderDir();
    for (const name of readdirSync(dir)) {
      const match = name.match(/^ibkr-perf-(\d{4}-\d{2}-\d{2})\.jsonl$/);
      if (match && match[1] < cutoffKey) {
        rmSync(path.join(dir, name), { force: true });
      }
    }
  } catch {
    // best-effort
  }
}

export function recordIbkrPerfSample(nowMs = Date.now()): PerfSample {
  const server = captureServerPerfSnapshot();
  const connected =
    safeCall(() => getConnectionAuditSnapshot().liveState.connected) ?? null;
  const rates = prevSample ? deriveRates(prevSample, nowMs, server) : null;
  const sample: PerfSample = {
    ts: new Date(nowMs).toISOString(),
    connected,
    server,
    rates,
    client: latestClientMetrics,
  };
  prevSample = { atMs: nowMs, server };
  latestSample = sample;
  accumulate(sample);
  writeOutputs(sample);
  return sample;
}

/** Latest client-reported performance/attribution payload (from /api/diagnostics/client-metrics). */
export function recordLatestClientPerfMetrics(payload: unknown): void {
  if (payload && typeof payload === "object") {
    latestClientMetrics = payload as Record<string, unknown>;
  }
}

export function startIbkrPerfCapture(): void {
  if (samplerTimer) return;
  elMonitor.enable();
  pruneOldLogs(Date.now());
  const intervalMs = Math.max(
    1000,
    Number(process.env["IBKR_PERF_CAPTURE_INTERVAL_MS"] ?? DEFAULT_INTERVAL_MS) ||
      DEFAULT_INTERVAL_MS,
  );
  recordIbkrPerfSample();
  samplerTimer = setInterval(() => {
    try {
      recordIbkrPerfSample();
    } catch {
      // best-effort
    }
  }, intervalMs);
  samplerTimer.unref?.();
}

export function stopIbkrPerfCapture(): void {
  if (samplerTimer) {
    clearInterval(samplerTimer);
    samplerTimer = null;
    elMonitor.disable();
  }
}

export function isIbkrPerfCaptureRunning(): boolean {
  return samplerTimer !== null;
}

/** Test-only: reset in-memory state. */
export function __resetIbkrPerfCaptureForTests(): void {
  stopIbkrPerfCapture();
  prevSample = null;
  latestSample = null;
  latestClientMetrics = null;
  buckets.disconnected = newBucket();
  buckets.connected = newBucket();
}
