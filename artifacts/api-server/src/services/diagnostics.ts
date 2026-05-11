import { randomUUID } from "node:crypto";
import * as v8 from "node:v8";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  lte,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  db,
  diagnosticEventsTable,
  diagnosticSnapshotsTable,
  diagnosticThresholdOverridesTable,
  executionEventsTable,
  pool,
  type DiagnosticEvent,
  type DiagnosticSnapshot,
} from "@workspace/db";
import { logger } from "../lib/logger";
import {
  isTransientPostgresError,
  summarizeTransientPostgresError,
} from "../lib/transient-db-error";
import { getSignalOptionsWorkerSnapshot } from "./signal-options-worker-state";
import {
  markStorageHealthDegraded,
  refreshStorageHealthSnapshot,
} from "./storage-health";

const SIGNAL_OPTIONS_EVENT_PREFIX = "signal_options_";
const SIGNAL_OPTIONS_GATEWAY_BLOCKED_EVENT =
  "signal_options_gateway_blocked";
const SIGNAL_OPTIONS_SKIPPED_EVENT = "signal_options_candidate_skipped";
const SIGNAL_OPTIONS_EXIT_EVENT = "signal_options_shadow_exit";

export type DiagnosticSeverity = "info" | "warning" | "critical";
export type DiagnosticStatus = "ok" | "degraded" | "down" | "unknown";
export type DiagnosticSubsystem =
  | "api"
  | "browser"
  | "isolation"
  | "resource-pressure"
  | "ibkr"
  | "market-data"
  | "chart-hydration"
  | "automation"
  | "orders"
  | "accounts"
  | "storage";

type JsonRecord = Record<string, unknown>;

export type DiagnosticThreshold = {
  metricKey: string;
  label: string;
  subsystem: DiagnosticSubsystem;
  unit: "ms" | "count" | "mb" | "percent";
  warning: number;
  critical: number;
  enabled: boolean;
  audible: boolean;
  description: string;
};

export type RuntimeDiagnosticInput = {
  runtime: JsonRecord;
  probes?: JsonRecord;
};

export type DiagnosticSnapshotPayload = {
  id: string;
  observedAt: string;
  subsystem: DiagnosticSubsystem;
  status: DiagnosticStatus;
  severity: DiagnosticSeverity;
  summary: string;
  dimensions: JsonRecord;
  metrics: JsonRecord;
  raw: JsonRecord;
};

export type DiagnosticEventPayload = {
  id: string;
  incidentKey: string;
  subsystem: DiagnosticSubsystem;
  category: string;
  code: string | null;
  severity: DiagnosticSeverity;
  status: "open" | "resolved";
  message: string;
  firstSeenAt: string;
  lastSeenAt: string;
  eventCount: number;
  dimensions: JsonRecord;
  raw: JsonRecord;
};

type DiagnosticEventInput = {
  subsystem: DiagnosticSubsystem;
  category: string;
  code?: string | null;
  severity: DiagnosticSeverity;
  message: string;
  dimensions?: JsonRecord;
  raw?: JsonRecord;
};

export type DiagnosticEventStatus = "open" | "resolved";

type ApiRequestSample = {
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  recordedAt: number;
};

type DiagnosticsStreamMessage =
  | { type: "snapshot"; payload: DiagnosticsLatestPayload }
  | { type: "event"; payload: DiagnosticEventPayload }
  | {
      type: "threshold-breach";
      payload: {
        threshold: DiagnosticThreshold;
        value: number;
        severity: DiagnosticSeverity;
        observedAt: string;
      };
    };

export type DiagnosticsLatestPayload = {
  timestamp: string;
  status: DiagnosticStatus;
  severity: DiagnosticSeverity;
  summary: string;
  snapshots: DiagnosticSnapshotPayload[];
  events: DiagnosticEventPayload[];
  thresholds: DiagnosticThreshold[];
  footerMemoryPressure?: {
    observedAt: string | null;
    level: "normal" | "watch" | "high" | "critical";
    trend: "steady" | "rising" | "recovering";
    browserMemoryMb: number | null;
    apiHeapUsedPercent: number | null;
    sourceQuality: string | null;
    dominantDrivers: Array<{
      kind: string | null;
      label: string | null;
      level: string | null;
      detail: string | null;
      score: number | null;
    }>;
  };
};

type FooterMemoryPressureDriver = NonNullable<
  DiagnosticsLatestPayload["footerMemoryPressure"]
>["dominantDrivers"][number];

const SNAPSHOT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_COLLECTION_INTERVAL_MS = 15_000;
const REQUEST_WINDOW_MS = 5 * 60 * 1000;
const API_LATENCY_ALERT_MIN_SAMPLES = 20;
const SLOW_API_ROUTE_MS = 1_000;
const MAX_REQUEST_SAMPLES = 2_000;
const MAX_MEMORY_SNAPSHOTS = 2_000;
const MAX_MEMORY_EVENTS = 500;
const MAX_RECENT_EVENTS = 50;
const CLIENT_METRIC_RETENTION_MS = 10 * 60 * 1000;
const CLIENT_METRIC_MAX_SAMPLES = 500;
const ACTIONABLE_ISOLATION_REPORT_TYPES = new Set(["coep", "coop"]);
const ACTIONABLE_ISOLATION_BODY_TYPES = new Set(["coep", "coop", "corp"]);

type ResourcePressureLevel = "normal" | "watch" | "shed" | "critical";

type ClientDiagnosticsMetric = {
  id: string;
  observedAt: string;
  receivedAt: number;
  memory: JsonRecord;
  memoryPressure: JsonRecord;
  isolation: JsonRecord;
  workload: JsonRecord;
  chartHydration: JsonRecord;
  storage: JsonRecord;
  caches: JsonRecord;
  navigation: JsonRecord;
  screens: JsonRecord;
  longTasks: JsonRecord;
  apiTimings: JsonRecord;
  raw: JsonRecord;
};

const DEFAULT_THRESHOLDS: DiagnosticThreshold[] = [
  {
    metricKey: "api.p95_latency_ms",
    label: "API p95 latency",
    subsystem: "api",
    unit: "ms",
    warning: 1_000,
    critical: 3_000,
    enabled: true,
    audible: true,
    description: "Recent API request p95 latency once enough samples exist.",
  },
  {
    metricKey: "ibkr.heartbeat_age_ms",
    label: "IBKR heartbeat age",
    subsystem: "ibkr",
    unit: "ms",
    warning: 30_000,
    critical: 120_000,
    enabled: true,
    audible: true,
    description: "Age of the last bridge/TWS tickle or heartbeat.",
  },
  {
    metricKey: "market_data.freshness_age_ms",
    label: "Market data freshness",
    subsystem: "market-data",
    unit: "ms",
    warning: 2_000,
    critical: 10_000,
    enabled: true,
    audible: true,
    description: "Age of the freshest live quote/bar stream event.",
  },
  {
    metricKey: "market_data.stream_gap_ms",
    label: "Market data stream gap",
    subsystem: "market-data",
    unit: "ms",
    warning: 5_000,
    critical: 30_000,
    enabled: true,
    audible: true,
    description: "Largest unrecovered market data stream gap.",
  },
  {
    metricKey: "api.heap_used_mb",
    label: "API heap used",
    subsystem: "api",
    unit: "mb",
    warning: 750,
    critical: 1_000,
    enabled: true,
    audible: false,
    description: "Node heap used by the API process.",
  },
  {
    metricKey: "resource_pressure.heap_used_percent",
    label: "API heap pressure",
    subsystem: "resource-pressure",
    unit: "percent",
    warning: 70,
    critical: 85,
    enabled: true,
    audible: false,
    description: "Node heap used as a percentage of the V8 heap limit.",
  },
  {
    metricKey: "resource_pressure.browser_memory_mb",
    label: "Browser memory estimate",
    subsystem: "resource-pressure",
    unit: "mb",
    warning: 1_500,
    critical: 2_500,
    enabled: true,
    audible: false,
    description: "Latest browser memory estimate from client diagnostics.",
  },
  {
    metricKey: "isolation.report_count_5m",
    label: "Isolation reports",
    subsystem: "isolation",
    unit: "count",
    warning: 1,
    critical: 10,
    enabled: true,
    audible: false,
    description: "Recent actionable COOP/COEP isolation reports received from browsers.",
  },
  {
    metricKey: "ibkr.pacing_events_5m",
    label: "IBKR pacing events",
    subsystem: "ibkr",
    unit: "count",
    warning: 1,
    critical: 3,
    enabled: true,
    audible: true,
    description: "Known IBKR pacing/subscription errors in the last five minutes.",
  },
  {
    metricKey: "orders.visibility_failures",
    label: "Order/account visibility failures",
    subsystem: "orders",
    unit: "count",
    warning: 1,
    critical: 1,
    enabled: true,
    audible: true,
    description: "Read-only account, position, or order probe failures.",
  },
  {
    metricKey: "automation.latest_scan_age_ms",
    label: "Automation scan age",
    subsystem: "automation",
    unit: "ms",
    warning: 120_000,
    critical: 300_000,
    enabled: true,
    audible: false,
    description: "Age of the latest successful signal-options worker scan.",
  },
  {
    metricKey: "automation.gateway_blocked_count",
    label: "Automation Gateway blocks",
    subsystem: "automation",
    unit: "count",
    warning: 1,
    critical: 3,
    enabled: true,
    audible: true,
    description: "Signal-options scans blocked by IB Gateway readiness in the last hour.",
  },
  {
    metricKey: "automation.failure_count",
    label: "Automation scan failures",
    subsystem: "automation",
    unit: "count",
    warning: 1,
    critical: 3,
    enabled: true,
    audible: true,
    description: "Signal-options worker scan failures in the current API process.",
  },
  {
    metricKey: "chart_hydration.prepend_p95_ms",
    label: "Chart prepend p95",
    subsystem: "chart-hydration",
    unit: "ms",
    warning: 1_500,
    critical: 4_000,
    enabled: true,
    audible: false,
    description: "Browser-observed p95 latency for loading older chart bars.",
  },
  {
    metricKey: "chart_hydration.cursor_fallback_count",
    label: "Chart cursor fallbacks",
    subsystem: "chart-hydration",
    unit: "count",
    warning: 3,
    critical: 10,
    enabled: true,
    audible: false,
    description: "Server-side fallback count after opaque chart history cursors could not be used.",
  },
  {
    metricKey: "chart_hydration.payload_shape_errors",
    label: "Chart payload shape errors",
    subsystem: "chart-hydration",
    unit: "count",
    warning: 1,
    critical: 5,
    enabled: true,
    audible: false,
    description: "Browser-side chart hydration payload shape errors.",
  },
  {
    metricKey: "chart_hydration.duplicate_older_page_count",
    label: "Duplicate older chart pages",
    subsystem: "chart-hydration",
    unit: "count",
    warning: 3,
    critical: 10,
    enabled: true,
    audible: false,
    description: "Older-history chart prepend pages that returned no new bars.",
  },
];

const IBKR_CODE_CATEGORY: Record<string, string> = {
  "100": "pacing",
  "101": "subscription-limit",
  "502": "socket-connect",
  "504": "not-connected",
  "1100": "connectivity-lost",
  "1101": "connectivity-restored-data-lost",
  "1102": "connectivity-restored-data-maintained",
  "10197": "competing-session",
};

const requestSamples: ApiRequestSample[] = [];
const memorySnapshots: DiagnosticSnapshotPayload[] = [];
const memoryEvents = new Map<string, DiagnosticEventPayload>();
const clientMetrics: ClientDiagnosticsMetric[] = [];
const subscribers = new Set<(message: DiagnosticsStreamMessage) => void>();

let latestPayload: DiagnosticsLatestPayload | null = null;
let collectorTimer: NodeJS.Timeout | null = null;
let lastDbWarningAt = 0;

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeJson(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeJson(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        normalizeJson(entry),
      ]),
    );
  }

  return value;
}

function asJsonRecord(value: unknown): JsonRecord {
  const normalized = normalizeJson(value);
  return normalized && typeof normalized === "object" && !Array.isArray(normalized)
    ? (normalized as JsonRecord)
    : {};
}

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function roundMetric(value: number | null, digits = 1): number | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mb(value: number): number {
  return Math.round((value / 1024 / 1024) * 10) / 10;
}

function pressureSeverity(level: ResourcePressureLevel): DiagnosticSeverity {
  if (level === "critical") return "critical";
  if (level === "shed" || level === "watch") return "warning";
  return "info";
}

function maxPressureLevel(levels: ResourcePressureLevel[]): ResourcePressureLevel {
  if (levels.includes("critical")) return "critical";
  if (levels.includes("shed")) return "shed";
  if (levels.includes("watch")) return "watch";
  return "normal";
}

function pressureLevelFromRatio(value: number | null): ResourcePressureLevel {
  if (value === null) return "normal";
  if (value >= 0.9) return "critical";
  if (value >= 0.8) return "shed";
  if (value >= 0.7) return "watch";
  return "normal";
}

function cacheOccupancyPressureLevel(value: number | null): ResourcePressureLevel {
  if (value === null) return "normal";
  if (value >= 0.9) return "watch";
  return "normal";
}

function timestampMs(value: unknown): number | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }

  if (typeof value === "string" || typeof value === "number") {
    const time = Date.parse(String(value));
    return Number.isFinite(time) ? time : null;
  }

  return null;
}

function percentile(values: number[], percentileValue: number): number | null {
  if (!values.length) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1),
  );
  return Math.round(sorted[index] ?? 0);
}

function maxSeverity(values: DiagnosticSeverity[]): DiagnosticSeverity {
  if (values.includes("critical")) {
    return "critical";
  }
  if (values.includes("warning")) {
    return "warning";
  }
  return "info";
}

function statusFromSeverity(severity: DiagnosticSeverity): DiagnosticStatus {
  if (severity === "critical") {
    return "down";
  }
  if (severity === "warning") {
    return "degraded";
  }
  return "ok";
}

function trimMemorySnapshots(): void {
  if (memorySnapshots.length > MAX_MEMORY_SNAPSHOTS) {
    memorySnapshots.splice(0, memorySnapshots.length - MAX_MEMORY_SNAPSHOTS);
  }
}

function trimMemoryEvents(): void {
  if (memoryEvents.size <= MAX_MEMORY_EVENTS) {
    return;
  }

  const sorted = Array.from(memoryEvents.values()).sort(
    (left, right) =>
      Date.parse(left.lastSeenAt) - Date.parse(right.lastSeenAt),
  );
  sorted.slice(0, sorted.length - MAX_MEMORY_EVENTS).forEach((event) => {
    memoryEvents.delete(event.incidentKey);
  });
}

function warnDbFailure(error: unknown, operation: string): void {
  if (process.env["DIAGNOSTICS_SUPPRESS_DB_WARNINGS"] === "1") {
    return;
  }
  const now = Date.now();
  if (now - lastDbWarningAt < 60_000) {
    return;
  }
  lastDbWarningAt = now;
  if (isTransientPostgresError(error)) {
    logger.warn(
      { dbError: summarizeTransientPostgresError(error), operation },
      "Diagnostics database unavailable; returning fallback diagnostics",
    );
    return;
  }
  logger.warn({ err: error, operation }, "Diagnostics DB operation failed");
}

async function safeDb<T>(
  operation: string,
  callback: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    warnDbFailure(error, operation);
    return fallback;
  }
}

function toSnapshotPayload(row: DiagnosticSnapshot): DiagnosticSnapshotPayload {
  return {
    id: row.id,
    observedAt: row.observedAt.toISOString(),
    subsystem: row.subsystem as DiagnosticSubsystem,
    status: row.status as DiagnosticStatus,
    severity: row.severity as DiagnosticSeverity,
    summary: row.summary ?? "",
    dimensions: row.dimensions,
    metrics: row.metrics,
    raw: row.raw,
  };
}

function toEventPayload(row: DiagnosticEvent): DiagnosticEventPayload {
  return {
    id: row.id,
    incidentKey: row.incidentKey,
    subsystem: row.subsystem as DiagnosticSubsystem,
    category: row.category,
    code: row.code,
    severity: row.severity as DiagnosticSeverity,
    status: row.status as "open" | "resolved",
    message: row.message,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    eventCount: row.eventCount,
    dimensions: row.dimensions,
    raw: row.raw,
  };
}

function broadcast(message: DiagnosticsStreamMessage): void {
  subscribers.forEach((subscriber) => {
    try {
      subscriber(message);
    } catch (error) {
      logger.debug({ err: error }, "Diagnostics subscriber failed");
    }
  });
}

function getRecentRequestSamples(): ApiRequestSample[] {
  const cutoff = Date.now() - REQUEST_WINDOW_MS;
  while (requestSamples.length && requestSamples[0]!.recordedAt < cutoff) {
    requestSamples.shift();
  }
  return requestSamples;
}

function buildApiRouteStats(samples: ApiRequestSample[]): JsonRecord[] {
  const byPath = new Map<
    string,
    {
      count: number;
      errors: number;
      durations: number[];
      lastSeenAt: number;
    }
  >();

  samples.forEach((sample) => {
    const current =
      byPath.get(sample.path) ??
      {
        count: 0,
        errors: 0,
        durations: [],
        lastSeenAt: 0,
      };
    current.count += 1;
    current.errors += sample.statusCode >= 500 ? 1 : 0;
    current.durations.push(sample.durationMs);
    current.lastSeenAt = Math.max(current.lastSeenAt, sample.recordedAt);
    byPath.set(sample.path, current);
  });

  return Array.from(byPath.entries())
    .map(([path, value]) => {
      const p95LatencyMs = percentile(value.durations, 95);
      const maxLatencyMs =
        value.durations.length > 0 ? Math.max(...value.durations) : null;
      return {
        path,
        requestCount5m: value.count,
        errorCount5m: value.errors,
        p95LatencyMs,
        maxLatencyMs,
        slowCount5m: value.durations.filter(
          (durationMs) => durationMs >= SLOW_API_ROUTE_MS,
        ).length,
        lastSeenAt: new Date(value.lastSeenAt).toISOString(),
      };
    })
    .sort((left, right) => {
      const rightP95 = numeric(right["p95LatencyMs"]) ?? 0;
      const leftP95 = numeric(left["p95LatencyMs"]) ?? 0;
      return rightP95 - leftP95;
    })
    .slice(0, 8);
}

function buildApiMetrics(runtime: JsonRecord): JsonRecord {
  const samples = getRecentRequestSamples();
  const durations = samples.map((sample) => sample.durationMs);
  const errors = samples.filter((sample) => sample.statusCode >= 500).length;
  const warnings = samples.filter(
    (sample) => sample.statusCode >= 400 && sample.statusCode < 500,
  ).length;
  const apiRuntime = asJsonRecord(runtime["api"]);
  const memory = asJsonRecord(apiRuntime["memoryMb"]);
  const eventLoopDelay = asJsonRecord(apiRuntime["eventLoopDelayMs"]);
  const heapStats = v8.getHeapStatistics();
  const heapLimitMb = mb(heapStats.heap_size_limit);
  const heapUsedMb = numeric(memory["heapUsed"]);
  const heapUsedPercent =
    heapUsedMb !== null && heapLimitMb > 0
      ? roundMetric((heapUsedMb / heapLimitMb) * 100)
      : null;
  const p50LatencyMs = percentile(durations, 50);
  const p95LatencyMs = percentile(durations, 95);
  const p99LatencyMs = percentile(durations, 99);
  const latencyAlertReady = samples.length >= API_LATENCY_ALERT_MIN_SAMPLES;
  const slowRoutes = buildApiRouteStats(samples);
  const dominantSlowRoute = slowRoutes.find(
    (route) => (numeric(route["p95LatencyMs"]) ?? 0) >= SLOW_API_ROUTE_MS,
  );
  return {
    requestCount5m: samples.length,
    errorCount5m: errors,
    warningCount5m: warnings,
    p50LatencyMs,
    p95LatencyMs,
    p95_latency_ms: latencyAlertReady ? p95LatencyMs : null,
    rawP95LatencyMs: p95LatencyMs,
    latencyAlertMinSamples: API_LATENCY_ALERT_MIN_SAMPLES,
    p99LatencyMs,
    slowRouteCount5m: samples.filter(
      (sample) => sample.durationMs >= SLOW_API_ROUTE_MS,
    ).length,
    slowRoutes,
    dominantSlowRoute: dominantSlowRoute?.["path"] ?? null,
    dominantSlowRouteP95Ms: dominantSlowRoute?.["p95LatencyMs"] ?? null,
    uptimeMs: numeric(apiRuntime["uptimeMs"]),
    heapUsedMb,
    heapTotalMb: numeric(memory["heapTotal"]),
    heapLimitMb,
    heapUsedPercent,
    rssMb: numeric(memory["rss"]),
    externalMb: numeric(memory["external"]),
    arrayBuffersMb: numeric(memory["arrayBuffers"]),
    eventLoopP95Ms: numeric(eventLoopDelay["p95"]),
    eventLoopMaxMs: numeric(eventLoopDelay["max"]),
    activeDiagnosticsClients: subscribers.size,
  };
}

function classifyApiSnapshot(metrics: JsonRecord): DiagnosticSeverity {
  const p95 = numeric(metrics["p95LatencyMs"]) ?? 0;
  const errors = numeric(metrics["errorCount5m"]) ?? 0;
  const requestCount = numeric(metrics["requestCount5m"]) ?? 0;
  const latencyAlertReady = requestCount >= API_LATENCY_ALERT_MIN_SAMPLES;
  if ((latencyAlertReady && p95 >= 3_000) || errors >= 3) {
    return "critical";
  }
  if ((latencyAlertReady && p95 >= 1_000) || errors > 0) {
    return "warning";
  }
  return "info";
}

function classifyIbkrCode(message: string): {
  code: string | null;
  category: string;
  severity: DiagnosticSeverity;
} {
  const code = Object.keys(IBKR_CODE_CATEGORY).find((candidate) =>
    new RegExp(`\\b${candidate}\\b`).test(message),
  );
  if (!code) {
    return { code: null, category: "bridge", severity: "warning" };
  }

  if (["1100", "502", "504", "10197"].includes(code)) {
    return {
      code,
      category: IBKR_CODE_CATEGORY[code] ?? "bridge",
      severity: "critical",
    };
  }

  return {
    code,
    category: IBKR_CODE_CATEGORY[code] ?? "bridge",
    severity: ["100", "101"].includes(code) ? "warning" : "info",
  };
}

function buildMarketDataMetrics(probes: JsonRecord, runtime: JsonRecord = {}): JsonRecord {
  const marketData = asJsonRecord(probes["marketData"]);
  const ibkr = asJsonRecord(runtime["ibkr"]);
  const streamState = textValue(ibkr["streamState"]);
  const streamStateReason = textValue(ibkr["streamStateReason"]);
  const activeConsumerCount = numeric(marketData["activeConsumerCount"]) ?? 0;
  const unionSymbolCount = numeric(marketData["unionSymbolCount"]) ?? 0;
  const cachedQuoteCount = numeric(marketData["cachedQuoteCount"]) ?? 0;
  const eventCount = numeric(marketData["eventCount"]) ?? 0;
  const reconnectCount = numeric(marketData["reconnectCount"]) ?? 0;
  const streamGapCount =
    numeric(marketData["dataGapCount"]) ??
    numeric(marketData["streamGapCount"]) ??
    0;
  const recentGapCount =
    numeric(marketData["recentDataGapCount"]) ??
    numeric(marketData["recentGapCount"]) ??
    0;
  const maxGapMs =
    numeric(marketData["maxDataGapMs"]) ?? numeric(marketData["maxGapMs"]);
  const recentMaxGapMs =
    numeric(marketData["recentMaxDataGapMs"]) ??
    numeric(marketData["recentMaxGapMs"]);
  const lastGapMs =
    numeric(marketData["lastDataGapMs"]) ?? numeric(marketData["lastGapMs"]);
  const lastGapAgeMs =
    numeric(marketData["lastDataGapAgeMs"]) ??
    numeric(marketData["lastGapAgeMs"]);
  const lastEventAgeMs = numeric(marketData["lastEventAgeMs"]);
  const transportFreshnessAgeMs = numeric(marketData["transportFreshnessAgeMs"]);
  const dataFreshnessAgeMs =
    numeric(marketData["dataFreshnessAgeMs"]) ?? lastEventAgeMs;
  const freshnessAgeMs =
    transportFreshnessAgeMs ??
    numeric(marketData["freshnessAgeMs"]) ??
    lastEventAgeMs;
  const streamCurrentlyFresh =
    streamState === "live" &&
    freshnessAgeMs !== null &&
    freshnessAgeMs < 2_000;
  const currentLastError = streamCurrentlyFresh
    ? null
    : textValue(marketData["lastError"]);
  const thresholdFreshnessAgeMs =
    streamState === "quiet" ? null : freshnessAgeMs;
  const thresholdMaxGapMs =
    streamState === "quiet" || streamCurrentlyFresh
      ? null
      : (recentMaxGapMs ?? maxGapMs);

  return {
    activeConsumerCount,
    unionSymbolCount,
    cachedQuoteCount,
    eventCount,
    reconnectCount,
    streamGapCount,
    dataGapCount: streamGapCount,
    rawStreamGapCount: streamGapCount,
    rawDataGapCount: streamGapCount,
    recentGapCount,
    recentDataGapCount: recentGapCount,
    maxGapMs: thresholdMaxGapMs,
    streamGapMs: thresholdMaxGapMs,
    stream_gap_ms: thresholdMaxGapMs,
    rawMaxGapMs: maxGapMs,
    rawDataMaxGapMs: maxGapMs,
    recentMaxGapMs,
    lastGapMs,
    lastGapAt: marketData["lastDataGapAt"] ?? marketData["lastGapAt"] ?? null,
    lastGapAgeMs,
    lastEventAgeMs,
    lastSignalAgeMs: transportFreshnessAgeMs,
    freshnessAgeMs: thresholdFreshnessAgeMs,
    freshness_age_ms: thresholdFreshnessAgeMs,
    rawFreshnessAgeMs: freshnessAgeMs,
    dataFreshnessAgeMs,
    transportFreshnessAgeMs,
    streamState,
    streamStateReason,
    streamActive: booleanValue(marketData["streamActive"]),
    reconnectScheduled: booleanValue(marketData["reconnectScheduled"]),
    pressure: textValue(marketData["pressure"]),
    lastError: currentLastError,
    rawLastError: textValue(marketData["lastError"]),
    lastErrorAt: marketData["lastErrorAt"] ?? null,
  };
}

function classifyMarketDataSnapshot(metrics: JsonRecord): DiagnosticSeverity {
  if (metrics["streamState"] === "quiet") {
    return "info";
  }

  const activeConsumerCount = numeric(metrics["activeConsumerCount"]) ?? 0;
  const freshnessAgeMs = numeric(metrics["freshnessAgeMs"]);
  const maxGapMs = numeric(metrics["maxGapMs"]);
  const pressure = textValue(metrics["pressure"]);
  const reconnectScheduled = metrics["reconnectScheduled"] === true;

  if (activeConsumerCount <= 0) {
    return "info";
  }

  if (
    metrics["lastError"] ||
    (freshnessAgeMs !== null && freshnessAgeMs >= 10_000) ||
    (maxGapMs !== null && maxGapMs >= 30_000)
  ) {
    return "critical";
  }

  if (
    freshnessAgeMs === null ||
    freshnessAgeMs >= 2_000 ||
    (maxGapMs !== null && maxGapMs >= 5_000) ||
    reconnectScheduled ||
    pressure === "reconnecting" ||
    pressure === "stale"
  ) {
    return "warning";
  }

  return "info";
}

function buildBrowserMetrics(): JsonRecord {
  const cutoff = Date.now() - REQUEST_WINDOW_MS;
  const latest = latestClientMetric();
  const navigation = asJsonRecord(latest?.navigation);
  const screens = asJsonRecord(latest?.screens);
  const longTasks = asJsonRecord(latest?.longTasks);
  const apiTimings = asJsonRecord(latest?.apiTimings);
  const recentBrowserEvents = Array.from(memoryEvents.values()).filter(
    (event) =>
      event.subsystem === "browser" &&
      Date.parse(event.lastSeenAt) >= cutoff,
  );
  const warningCount = recentBrowserEvents.filter(
    (event) => event.severity === "warning",
  ).length;
  const criticalCount = recentBrowserEvents.filter(
    (event) => event.severity === "critical",
  ).length;
  const lastEvent = recentBrowserEvents.sort(
    (left, right) => Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt),
  )[0];

  return {
    eventCount5m: recentBrowserEvents.length,
    warningCount5m: warningCount,
    criticalCount5m: criticalCount,
    activeDiagnosticsClients: subscribers.size,
    latestClientAt: latest?.observedAt ?? null,
    firstScreenId: textValue(navigation["firstScreenId"]),
    firstScreenReadyMs: numeric(navigation["firstScreenReadyMs"]),
    screenReadyCount: numeric(screens["count"]) ?? 0,
    screenReadyP95Ms: numeric(screens["p95Ms"]),
    screenReadyMaxMs: numeric(screens["maxMs"]),
    slowScreenCount: numeric(screens["slowCount"]) ?? 0,
    slowScreens: Array.isArray(screens["topScreens"])
      ? screens["topScreens"]
      : [],
    longTaskCount: numeric(longTasks["count"]) ?? 0,
    longTaskP95Ms: numeric(longTasks["p95Ms"]),
    longTaskMaxMs: numeric(longTasks["maxMs"]),
    clientApiTimingCount: numeric(apiTimings["count"]) ?? 0,
    clientApiTimingP95Ms: numeric(apiTimings["p95Ms"]),
    clientSlowApiCount: numeric(apiTimings["slowCount"]) ?? 0,
    clientSlowApiRoutes: Array.isArray(apiTimings["topRoutes"])
      ? apiTimings["topRoutes"]
      : [],
    lastEventAt: lastEvent?.lastSeenAt ?? null,
    lastCategory: lastEvent?.category ?? null,
    recentEvents: recentBrowserEvents.slice(0, 10).map((event) => ({
      id: event.id,
      category: event.category,
      code: event.code,
      severity: event.severity,
      message: event.message,
      lastSeenAt: event.lastSeenAt,
      eventCount: event.eventCount,
    })),
  };
}

function classifyBrowserSnapshot(metrics: JsonRecord): DiagnosticSeverity {
  if ((numeric(metrics["criticalCount5m"]) ?? 0) > 0) {
    return "critical";
  }
  if (
    (numeric(metrics["warningCount5m"]) ?? 0) > 0 ||
    (numeric(metrics["screenReadyP95Ms"]) ?? 0) >= 4_000 ||
    (numeric(metrics["clientApiTimingP95Ms"]) ?? 0) >= 3_000
  ) {
    return "warning";
  }
  return "info";
}

function sanitizedChartHydrationScopes(input: unknown): JsonRecord[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.slice(0, 8).map((entry) => {
    const scope = asJsonRecord(entry);
    const hasProviderCursor =
      booleanValue(scope["hasProviderCursor"]) ||
      Boolean(textValue(scope["olderHistoryProviderCursor"])) ||
      Boolean(textValue(scope["olderHistoryProviderNextUrl"]));
    const hasHistoryCursor =
      booleanValue(scope["hasHistoryCursor"]) ||
      Boolean(textValue(scope["olderHistoryCursor"]));
    return {
      scope: textValue(scope["scope"]),
      role: textValue(scope["role"]),
      timeframe: textValue(scope["timeframe"]),
      requestedLimit: numeric(scope["requestedLimit"]),
      initialLimit: numeric(scope["initialLimit"]),
      targetLimit: numeric(scope["targetLimit"]),
      maxLimit: numeric(scope["maxLimit"]),
      hydratedBaseCount: numeric(scope["hydratedBaseCount"]),
      renderedBarCount: numeric(scope["renderedBarCount"]),
      livePatchedBarCount: numeric(scope["livePatchedBarCount"]),
      oldestLoadedAt: scope["oldestLoadedAt"] ?? null,
      isPrependingOlder: scope["isPrependingOlder"] === true,
      hasExhaustedOlderHistory: scope["hasExhaustedOlderHistory"] === true,
      olderHistoryNextBeforeAt: scope["olderHistoryNextBeforeAt"] ?? null,
      emptyOlderHistoryWindowCount: numeric(scope["emptyOlderHistoryWindowCount"]),
      olderHistoryPageCount: numeric(scope["olderHistoryPageCount"]),
      olderHistoryProvider: textValue(scope["olderHistoryProvider"]),
      olderHistoryExhaustionReason: textValue(scope["olderHistoryExhaustionReason"]),
      olderHistoryProviderPageCount: numeric(scope["olderHistoryProviderPageCount"]),
      olderHistoryProviderPageLimitReached:
        scope["olderHistoryProviderPageLimitReached"] === true,
      hasProviderCursor,
      hasHistoryCursor,
      updatedAt: numeric(scope["updatedAt"]),
      barsRequestMs: numeric(scope["barsRequestMs"]),
      prependRequestMs: numeric(scope["prependRequestMs"]),
      modelBuildMs: numeric(scope["modelBuildMs"]),
      firstPaintMs: numeric(scope["firstPaintMs"]),
      payloadShapeError: numeric(scope["payloadShapeError"]),
      olderPageFetch: numeric(scope["olderPageFetch"]),
      olderPageDuplicate: numeric(scope["olderPageDuplicate"]),
      providerCursorPage: numeric(scope["providerCursorPage"]),
      historyCursorPage: numeric(scope["historyCursorPage"]),
    };
  });
}

function countChartScopes(scopes: JsonRecord[], predicate: (scope: JsonRecord) => boolean): number {
  return scopes.filter(predicate).length;
}

function countChartScopeRoles(scopes: JsonRecord[]): JsonRecord {
  return scopes.reduce<JsonRecord>((result, scope) => {
    const role = textValue(scope["role"]) ?? "unknown";
    result[role] = (numeric(result[role]) ?? 0) + 1;
    return result;
  }, {});
}

function oldestChartScopeLoadedAt(scopes: JsonRecord[]): string | null {
  const oldest = scopes
    .map((scope) => timestampMs(scope["oldestLoadedAt"]))
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right)[0];
  return Number.isFinite(oldest) ? new Date(oldest).toISOString() : null;
}

function metricSummaryP95(input: JsonRecord, key: string): number | null {
  return numeric(asJsonRecord(input[key])["p95"]);
}

function buildChartHydrationMetrics(runtime: JsonRecord): {
  metrics: JsonRecord;
  raw: JsonRecord;
} {
  const apiRuntime = asJsonRecord(runtime["api"]);
  const resourceCaches = asJsonRecord(apiRuntime["resourceCaches"]);
  const bars = asJsonRecord(resourceCaches["bars"]);
  const serverHydration = asJsonRecord(bars["hydration"]);
  const latest = latestClientMetric();
  const browserHydration = asJsonRecord(latest?.chartHydration);
  const browserWorkload = asJsonRecord(latest?.workload);
  const browserAggregateStream = asJsonRecord(browserWorkload["aggregateStream"]);
  const browserCounters = asJsonRecord(browserHydration["counters"]);
  const scopes = sanitizedChartHydrationScopes(browserHydration["scopes"]);
  const activeScopeCount =
    numeric(browserHydration["activeScopeCount"]) ?? scopes.length;
  const exhaustedScopeCount =
    numeric(browserHydration["exhaustedScopeCount"]) ??
    countChartScopes(scopes, (scope) => scope["hasExhaustedOlderHistory"] === true);
  const prependingScopeCount =
    numeric(browserHydration["prependingScopeCount"]) ??
    countChartScopes(scopes, (scope) => scope["isPrependingOlder"] === true);
  const scopeRoles = asJsonRecord(browserHydration["scopeRoles"]);
  const payloadShapeErrors = numeric(browserCounters["payloadShapeError"]) ?? 0;
  const duplicateOlderPageCount = numeric(browserCounters["olderPageDuplicate"]) ?? 0;
  const providerCursorPageCount = numeric(browserCounters["providerCursorPage"]) ?? 0;
  const historyCursorPageCount = numeric(browserCounters["historyCursorPage"]) ?? 0;
  const olderPageFetchCount = numeric(browserCounters["olderPageFetch"]) ?? 0;
  const liveFallbackFetchCount = numeric(browserCounters["liveFallbackFetch"]) ?? 0;
  const cursorFallbackCount = numeric(serverHydration["cursorFallback"]) ?? 0;
  const prependP95Ms = metricSummaryP95(browserHydration, "prependRequestMs");

  const metrics = {
    cacheEntries: numeric(bars["entries"]) ?? 0,
    cacheMaxEntries: numeric(bars["maxEntries"]) ?? 0,
    cacheExpired: numeric(bars["expired"]) ?? 0,
    cacheStaleExpired: numeric(bars["staleExpired"]) ?? 0,
    inFlight: numeric(bars["inFlight"]) ?? 0,
    historyCursorEntries: numeric(bars["historyCursorEntries"]) ?? 0,
    historyCursorMaxEntries: numeric(bars["historyCursorMaxEntries"]) ?? 0,
    historyCursorTtlMs: numeric(bars["historyCursorTtlMs"]),
    cursorEnabled: bars["cursorEnabled"] === true,
    dedupeEnabled: bars["dedupeEnabled"] === true,
    backgroundEnabled: bars["backgroundEnabled"] === true,
    cacheHit: numeric(serverHydration["cacheHit"]) ?? 0,
    cacheMiss: numeric(serverHydration["cacheMiss"]) ?? 0,
    inFlightJoin: numeric(serverHydration["inFlightJoin"]) ?? 0,
    staleServed: numeric(serverHydration["staleServed"]) ?? 0,
    providerFetch: numeric(serverHydration["providerFetch"]) ?? 0,
    providerPage: numeric(serverHydration["providerPage"]) ?? 0,
    cursorContinuation: numeric(serverHydration["cursorContinuation"]) ?? 0,
    cursorFallback: cursorFallbackCount,
    backgroundRefresh: numeric(serverHydration["backgroundRefresh"]) ?? 0,
    activeScopeCount,
    exhaustedScopeCount,
    prependingScopeCount,
    scopeRoles: Object.keys(scopeRoles).length ? scopeRoles : countChartScopeRoles(scopes),
    oldestLoadedAtMin:
      browserHydration["oldestLoadedAtMin"] ?? oldestChartScopeLoadedAt(scopes),
    sampleCount: numeric(browserHydration["sampleCount"]) ?? 0,
    barsRequestP95Ms: metricSummaryP95(browserHydration, "barsRequestMs"),
    favoritePrewarmP95Ms: metricSummaryP95(
      browserHydration,
      "favoritePrewarmRequestMs",
    ),
    liveFallbackP95Ms: metricSummaryP95(
      browserHydration,
      "liveFallbackRequestMs",
    ),
    prependP95Ms,
    prepend_p95_ms: prependP95Ms,
    modelBuildP95Ms: metricSummaryP95(browserHydration, "modelBuildMs"),
    firstPaintP95Ms: metricSummaryP95(browserHydration, "firstPaintMs"),
    livePatchToPaintP95Ms: metricSummaryP95(
      browserHydration,
      "livePatchToPaintMs",
    ),
    payloadShapeErrors,
    payload_shape_errors: payloadShapeErrors,
    duplicateOlderPageCount,
    duplicate_older_page_count: duplicateOlderPageCount,
    providerCursorPageCount,
    historyCursorPageCount,
    olderPageFetchCount,
    liveFallbackFetchCount,
    cursorFallbackCount,
    cursor_fallback_count: cursorFallbackCount,
    browserAggregateActiveConsumerCount:
      numeric(browserAggregateStream["activeConsumerCount"]) ?? 0,
    browserAggregateUnionSymbolCount:
      numeric(browserAggregateStream["unionSymbolCount"]) ?? 0,
    browserAggregateEventCount:
      numeric(browserAggregateStream["eventCount"]) ?? 0,
    browserAggregateStreamGapCount:
      numeric(browserAggregateStream["streamGapCount"]) ?? 0,
    browserAggregateReconnectCount:
      numeric(browserAggregateStream["reconnectCount"]) ?? 0,
    browserAggregateRefreshCount:
      numeric(browserAggregateStream["refreshCount"]) ?? 0,
    browserAggregateStallReconnectCount:
      numeric(browserAggregateStream["stallReconnectCount"]) ?? 0,
    browserAggregateMaxGapMs:
      numeric(browserAggregateStream["maxGapMs"]),
    latestClientAt: latest?.observedAt ?? null,
    scopes,
  };

  return {
    metrics,
    raw: {
      backendBars: {
        ...bars,
        hydration: serverHydration,
      },
      browserChartHydration: {
        ...browserHydration,
        scopes,
      },
      browserAggregateStream,
      latestClientAt: latest?.observedAt ?? null,
    },
  };
}

function classifyChartHydrationSnapshot(metrics: JsonRecord): DiagnosticSeverity {
  const payloadShapeErrors = numeric(metrics["payloadShapeErrors"]) ?? 0;
  const cursorFallbackCount = numeric(metrics["cursorFallbackCount"]) ?? 0;
  const duplicateOlderPageCount = numeric(metrics["duplicateOlderPageCount"]) ?? 0;
  const prependP95Ms = numeric(metrics["prependP95Ms"]);
  const exhaustedScopeCount = numeric(metrics["exhaustedScopeCount"]) ?? 0;

  if (
    payloadShapeErrors >= 5 ||
    cursorFallbackCount >= 10 ||
    duplicateOlderPageCount >= 10 ||
    (prependP95Ms !== null && prependP95Ms >= 4_000)
  ) {
    return "critical";
  }

  if (
    payloadShapeErrors >= 1 ||
    cursorFallbackCount >= 3 ||
    duplicateOlderPageCount >= 3 ||
    exhaustedScopeCount >= 2 ||
    (prependP95Ms !== null && prependP95Ms >= 1_500)
  ) {
    return "warning";
  }

  return "info";
}

function buildChartHydrationDiagnosticEvents(
  metrics: JsonRecord,
  raw: JsonRecord,
): DiagnosticEventInput[] {
  const events: DiagnosticEventInput[] = [];
  const payloadShapeErrors = numeric(metrics["payloadShapeErrors"]) ?? 0;
  const cursorFallbackCount = numeric(metrics["cursorFallbackCount"]) ?? 0;
  const duplicateOlderPageCount = numeric(metrics["duplicateOlderPageCount"]) ?? 0;
  const prependP95Ms = numeric(metrics["prependP95Ms"]);
  const exhaustedScopeCount = numeric(metrics["exhaustedScopeCount"]) ?? 0;

  if (payloadShapeErrors > 0) {
    events.push({
      subsystem: "chart-hydration",
      category: "payload",
      code: "chart_hydration_payload_shape_error",
      severity: payloadShapeErrors >= 5 ? "critical" : "warning",
      message: "Chart hydration received malformed bar payloads.",
      dimensions: { payloadShapeErrors },
      raw,
    });
  }

  if (cursorFallbackCount >= 3) {
    events.push({
      subsystem: "chart-hydration",
      category: "cursor",
      code: "chart_hydration_cursor_fallbacks",
      severity: cursorFallbackCount >= 10 ? "critical" : "warning",
      message: "Chart history cursors are falling back to windowed provider fetches.",
      dimensions: { cursorFallbackCount },
      raw,
    });
  }

  if (prependP95Ms !== null && prependP95Ms >= 1_500) {
    events.push({
      subsystem: "chart-hydration",
      category: "latency",
      code: "chart_hydration_slow_prepend",
      severity: prependP95Ms >= 4_000 ? "critical" : "warning",
      message: "Loading older chart bars is slower than expected.",
      dimensions: { prependP95Ms },
      raw,
    });
  }

  if (duplicateOlderPageCount >= 3) {
    events.push({
      subsystem: "chart-hydration",
      category: "pagination",
      code: "chart_hydration_duplicate_pages",
      severity: duplicateOlderPageCount >= 10 ? "critical" : "warning",
      message: "Chart history prepend requests are returning duplicate older pages.",
      dimensions: { duplicateOlderPageCount },
      raw,
    });
  }

  if (exhaustedScopeCount >= 2) {
    events.push({
      subsystem: "chart-hydration",
      category: "exhaustion",
      code: "chart_hydration_exhausted_scopes",
      severity: "warning",
      message: "Multiple chart scopes have exhausted older history.",
      dimensions: { exhaustedScopeCount },
      raw,
    });
  }

  return events;
}

function compactErrorMessage(message: string, detail: string | null): string {
  if (!detail || message.includes(detail)) {
    return message;
  }
  return `${message}: ${detail}`;
}

function withOptionalDetail(message: string, detail: string | null): string {
  if (!detail || message.includes(detail)) {
    return message;
  }
  const base = message.endsWith(".") ? message.slice(0, -1) : message;
  return `${base}: ${detail}`;
}

function isStaleBridgeTunnelError(input: {
  message: string;
  detail: string | null;
  code: string | null;
  statusCode: number | null;
}): boolean {
  const combined = `${input.message} ${input.detail ?? ""} ${input.code ?? ""}`.toLowerCase();
  return (
    input.code === "upstream_request_failed" ||
    input.statusCode === 502 ||
    /enotfound|eai_again|econnrefused|etimedout|upstream request failed|fetch failed|socket hang up|502 bad gateway|unable to reach the origin service|cloudflared/.test(
      combined,
    )
  );
}

function ibkrGovernorLastFailure(ibkrRaw: JsonRecord): string | null {
  const governor = asJsonRecord(ibkrRaw["governor"]);
  for (const lane of ["health", "account", "quotes", "orders", "options"]) {
    const failure = textValue(asJsonRecord(governor[lane])["lastFailure"]);
    if (failure) {
      return failure;
    }
  }
  return null;
}

function buildIbkrDiagnosticEvents(
  ibkrRaw: JsonRecord,
  metrics: JsonRecord,
): DiagnosticEventInput[] {
  const events: DiagnosticEventInput[] = [];
  const configured = booleanValue(metrics["configured"]);
  const bridgeUrlConfigured = booleanValue(ibkrRaw["bridgeUrlConfigured"]);
  const bridgeTokenConfigured = booleanValue(ibkrRaw["bridgeTokenConfigured"]);
  const reachable = booleanValue(metrics["reachable"]);
  const connected = booleanValue(metrics["connected"]);
  const authenticated = booleanValue(metrics["authenticated"]);
  const competing = booleanValue(metrics["competing"]);
  const healthError = textValue(ibkrRaw["healthError"]);
  const healthErrorDetail = textValue(ibkrRaw["healthErrorDetail"]);
  const healthErrorCode = textValue(ibkrRaw["healthErrorCode"]);
  const healthErrorStatusCode = numeric(ibkrRaw["healthErrorStatusCode"]);
  const healthGovernorFailure = ibkrGovernorLastFailure(ibkrRaw);
  const runtimeLastError = textValue(ibkrRaw["lastError"]);
  const recoveryError = textValue(ibkrRaw["lastRecoveryError"]);
  const liveMarketDataAvailable = ibkrRaw["liveMarketDataAvailable"];
  const marketDataMode = textValue(ibkrRaw["marketDataMode"]);
  const healthFresh = booleanValue(ibkrRaw["healthFresh"]);
  const streamFresh = booleanValue(ibkrRaw["streamFresh"]);
  const streamState = textValue(ibkrRaw["streamState"]);
  const strictReady = booleanValue(ibkrRaw["strictReady"]);
  const strictReason = textValue(ibkrRaw["strictReason"]);

  if (!bridgeUrlConfigured || !configured) {
    events.push({
      subsystem: "ibkr",
      category: "configuration",
      code: "ibkr_bridge_required",
      severity: "warning",
      message: "IB Gateway bridge connection is required before broker data is available.",
      raw: ibkrRaw,
    });
  } else if (!bridgeTokenConfigured) {
    events.push({
      subsystem: "ibkr",
      category: "configuration",
      code: "ibkr_bridge_token_missing",
      severity: "warning",
      message: "IB Gateway bridge token is not configured.",
      raw: ibkrRaw,
    });
  }

  if (healthError) {
    const healthBackoff =
      /backoff|backed off/i.test(`${healthErrorCode ?? ""} ${healthError}`);
    const diagnosticHealthMessage =
      healthBackoff && healthGovernorFailure ? healthGovernorFailure : healthError;
    const diagnosticHealthDetail =
      healthBackoff && healthGovernorFailure
        ? healthGovernorFailure
        : healthErrorDetail;
    const staleTunnel = isStaleBridgeTunnelError({
      message: diagnosticHealthMessage,
      detail: diagnosticHealthDetail,
      code: healthErrorCode,
      statusCode: healthErrorStatusCode,
    });
    events.push({
      subsystem: "ibkr",
      category: staleTunnel ? "stale-tunnel" : "bridge-health",
      code: staleTunnel ? "ibkr_bridge_stale_tunnel" : healthErrorCode,
      severity: "critical",
      message: staleTunnel
        ? compactErrorMessage(
            "IB Gateway bridge tunnel is stale or unreachable",
            diagnosticHealthDetail ?? diagnosticHealthMessage,
          )
        : compactErrorMessage(healthError, healthErrorDetail),
      dimensions:
        healthBackoff && healthGovernorFailure
          ? {
              healthError,
              healthErrorCode,
              healthErrorDetail,
            }
          : undefined,
      raw: ibkrRaw,
    });
  }

  if (configured && reachable && !connected) {
    events.push({
      subsystem: "ibkr",
      category: "gateway-socket",
      code: "ibkr_gateway_socket_disconnected",
      severity: "critical",
      message: "IB Gateway bridge is reachable, but the TWS socket is disconnected.",
      raw: ibkrRaw,
    });
  }

  if (configured && healthFresh === false) {
    events.push({
      subsystem: "ibkr",
      category: "bridge-health",
      code: "ibkr_bridge_health_stale",
      severity: "warning",
      message: "IB Gateway bridge health is pending; UI status should not be green until a current health check succeeds.",
      raw: ibkrRaw,
    });
  }

  if (configured && connected && !authenticated) {
    events.push({
      subsystem: "ibkr",
      category: "authentication",
      code: "ibkr_gateway_login_required",
      severity: "critical",
      message: "IB Gateway bridge is connected, but the broker session is not authenticated.",
      raw: ibkrRaw,
    });
  }

  if (competing) {
    events.push({
      subsystem: "ibkr",
      category: "competing-session",
      code: "10197",
      severity: "critical",
      message: "IB Gateway reports a competing client session.",
      raw: ibkrRaw,
    });
  }

  if (connected && authenticated && liveMarketDataAvailable === false) {
    events.push({
      subsystem: "ibkr",
      category: "market-data",
      code: "ibkr_delayed_market_data",
      severity: "warning",
      message: `IB Gateway is authenticated, but live market data is unavailable${marketDataMode ? ` (${marketDataMode})` : ""}.`,
      raw: ibkrRaw,
    });
  }

  if (connected && authenticated && streamFresh === false && streamState !== "quiet") {
    const streamMessage =
      streamState === "reconnecting"
        ? "IB Gateway is authenticated and the quote stream is reconnecting."
        : "IB Gateway is authenticated, but stream events are stale.";
    events.push({
      subsystem: "ibkr",
      category: "stream-freshness",
      code: strictReason || "ibkr_stream_not_fresh",
      severity: strictReady === false ? "warning" : "info",
      message: withOptionalDetail(streamMessage, runtimeLastError),
      raw: ibkrRaw,
    });
  }

  const operationalError = runtimeLastError || recoveryError;
  if (operationalError && operationalError !== healthError) {
    const classified = classifyIbkrCode(operationalError);
    events.push({
      subsystem: "ibkr",
      category: classified.category,
      code: classified.code,
      severity: classified.severity,
      message: operationalError,
      raw: ibkrRaw,
    });
  }

  return events;
}

function buildIbkrMetrics(runtime: JsonRecord): JsonRecord {
  const ibkr = asJsonRecord(runtime["ibkr"]);
  const lastTickleAt = timestampMs(ibkr["lastTickleAt"]);
  const heartbeatAgeMs =
    lastTickleAt === null ? null : Math.max(0, Date.now() - lastTickleAt);
  return {
    configured: Boolean(ibkr["configured"]),
    reachable: Boolean(ibkr["reachable"]),
    connected: Boolean(ibkr["connected"]),
    authenticated: Boolean(ibkr["authenticated"]),
    competing: Boolean(ibkr["competing"]),
    heartbeatAgeMs,
    accountCount: numeric(ibkr["accountCount"]) ?? 0,
    marketDataMode: ibkr["marketDataMode"] ?? null,
    liveMarketDataAvailable: ibkr["liveMarketDataAvailable"] ?? null,
    healthFresh: ibkr["healthFresh"] ?? null,
    healthAgeMs: numeric(ibkr["healthAgeMs"]),
    streamFresh: ibkr["streamFresh"] ?? null,
    streamState: ibkr["streamState"] ?? null,
    streamStateReason: ibkr["streamStateReason"] ?? null,
    lastStreamEventAgeMs: numeric(ibkr["lastStreamEventAgeMs"]),
    strictReady: ibkr["strictReady"] ?? null,
    strictReason: ibkr["strictReason"] ?? null,
    lastRecoveryAttemptAt: ibkr["lastRecoveryAttemptAt"] ?? null,
    lastRecoveryError: ibkr["lastRecoveryError"] ?? null,
  };
}

function classifyIbkrSnapshot(metrics: JsonRecord): DiagnosticSeverity {
  if (!metrics["configured"]) {
    return "warning";
  }
  if (!metrics["reachable"] || !metrics["connected"]) {
    return "critical";
  }
  if (!metrics["authenticated"] || metrics["competing"]) {
    return "critical";
  }
  if (metrics["healthFresh"] === false) {
    return "warning";
  }
  if (metrics["streamState"] === "quiet") {
    return "info";
  }
  if (metrics["streamFresh"] === false || metrics["strictReady"] === false) {
    return "warning";
  }
  const heartbeatAgeMs = numeric(metrics["heartbeatAgeMs"]);
  if (heartbeatAgeMs !== null && heartbeatAgeMs >= 120_000) {
    return "critical";
  }
  if (heartbeatAgeMs !== null && heartbeatAgeMs >= 30_000) {
    return "warning";
  }
  return "info";
}

function buildProbeMetrics(probes: JsonRecord): {
  accounts: JsonRecord;
  orders: JsonRecord;
} {
  const accountProbe = asJsonRecord(probes["accounts"]);
  const orderProbe = asJsonRecord(probes["orders"]);
  const positionProbe = asJsonRecord(probes["positions"]);
  const accountFailures = [accountProbe, positionProbe].filter(
    (probe) => probe["ok"] === false,
  ).length;
  const orderFailures = orderProbe["ok"] === false ? 1 : 0;
  const orderDegraded = orderProbe["degraded"] === true;

  return {
    accounts: {
      accountCount: numeric(accountProbe["count"]) ?? 0,
      positionCount: numeric(positionProbe["count"]) ?? 0,
      visibilityFailures: accountFailures,
      lastError: accountProbe["error"] ?? positionProbe["error"] ?? null,
    },
    orders: {
      orderCount: numeric(orderProbe["count"]) ?? 0,
      visibilityFailures: orderFailures,
      degraded: orderDegraded,
      degradedReason: orderProbe["reason"] ?? null,
      stale: orderProbe["stale"] ?? null,
      lastError: orderProbe["error"] ?? null,
    },
  };
}

async function buildAutomationMetrics(): Promise<{
  metrics: JsonRecord;
  raw: JsonRecord;
}> {
  const worker = getSignalOptionsWorkerSnapshot();
  const recentSince = new Date(Date.now() - 60 * 60 * 1000);
  const recentEvents = await safeDb(
    "list automation diagnostic events",
    async () =>
      db
        .select({
          eventType: executionEventsTable.eventType,
          payload: executionEventsTable.payload,
          occurredAt: executionEventsTable.occurredAt,
        })
        .from(executionEventsTable)
        .where(gte(executionEventsTable.occurredAt, recentSince))
        .orderBy(desc(executionEventsTable.occurredAt))
        .limit(1_000),
    [],
  );
  const automationEvents = recentEvents.filter((event) =>
    event.eventType.startsWith(SIGNAL_OPTIONS_EVENT_PREFIX),
  );
  const deployments = Array.isArray(worker.deployments)
    ? worker.deployments
    : [];
  const latestSuccessMs = deployments.reduce<number | null>(
    (latest, deployment) => {
      const time = timestampMs(asJsonRecord(deployment)["lastSuccessAt"]);
      return time === null ? latest : Math.max(latest ?? 0, time);
    },
    null,
  );
  const latestScanAgeMs =
    latestSuccessMs === null ? null : Math.max(0, Date.now() - latestSuccessMs);
  const staleScanCount = deployments.filter((deployment) => {
    const lastSuccessAt = timestampMs(asJsonRecord(deployment)["lastSuccessAt"]);
    return (
      lastSuccessAt === null ||
      Date.now() - lastSuccessAt >= 120_000
    );
  }).length;
  const gatewayBlockedCount = automationEvents.filter(
    (event) => event.eventType === SIGNAL_OPTIONS_GATEWAY_BLOCKED_EVENT,
  ).length;
  const candidateSkipCount = automationEvents.filter(
    (event) => event.eventType === SIGNAL_OPTIONS_SKIPPED_EVENT,
  ).length;
  const dailyHaltCount = automationEvents.filter((event) => {
    const payload = asJsonRecord(event.payload);
    return (
      event.eventType === SIGNAL_OPTIONS_SKIPPED_EVENT &&
      payload["reason"] === "daily_loss_halt_active"
    );
  }).length;
  const shadowExitCount = automationEvents.filter(
    (event) => event.eventType === SIGNAL_OPTIONS_EXIT_EVENT,
  ).length;
  const failureCount = deployments.reduce(
    (sum, deployment) =>
      sum + (numeric(asJsonRecord(deployment)["failureCount"]) ?? 0),
    0,
  );
  const latestError =
    deployments
      .map((deployment) => textValue(asJsonRecord(deployment)["lastError"]))
      .find(Boolean) ?? null;

  return {
    metrics: {
      workerRunning: worker.started === true,
      tickRunning: worker.tickRunning === true,
      deploymentCount: numeric(worker.deploymentCount) ?? deployments.length,
      enabledDeployments: numeric(worker.deploymentCount) ?? deployments.length,
      activeDeploymentCount: numeric(worker.activeDeploymentCount) ?? 0,
      latestScanAgeMs,
      latest_scan_age_ms: latestScanAgeMs,
      staleScanCount,
      gatewayBlockedCount,
      gateway_blocked_count: gatewayBlockedCount,
      candidateSkipCount,
      dailyHaltCount,
      shadowExitCount,
      failureCount,
      failure_count: failureCount,
      latestError,
    },
    raw: {
      worker,
      recentEventCount: automationEvents.length,
      recentEvents: automationEvents.slice(0, 20).map((event) => ({
        eventType: event.eventType,
        occurredAt: event.occurredAt,
        payload: event.payload,
      })),
    },
  };
}

function classifyAutomationSnapshot(metrics: JsonRecord): DiagnosticSeverity {
  const enabledDeployments = numeric(metrics["enabledDeployments"]) ?? 0;
  const latestScanAgeMs = numeric(metrics["latestScanAgeMs"]);
  const gatewayBlockedCount = numeric(metrics["gatewayBlockedCount"]) ?? 0;
  const failureCount = numeric(metrics["failureCount"]) ?? 0;
  const staleScanCount = numeric(metrics["staleScanCount"]) ?? 0;

  if (
    gatewayBlockedCount >= 3 ||
    failureCount >= 3 ||
    (enabledDeployments > 0 &&
      latestScanAgeMs !== null &&
      latestScanAgeMs >= 300_000)
  ) {
    return "critical";
  }

  if (
    enabledDeployments > 0 &&
    (metrics["workerRunning"] !== true ||
      staleScanCount > 0 ||
      latestScanAgeMs === null ||
      latestScanAgeMs >= 120_000 ||
      gatewayBlockedCount > 0 ||
      failureCount > 0)
  ) {
    return "warning";
  }

  return "info";
}

function trimClientMetrics(): void {
  const cutoff = Date.now() - CLIENT_METRIC_RETENTION_MS;
  while (clientMetrics.length && clientMetrics[0]!.receivedAt < cutoff) {
    clientMetrics.shift();
  }
  if (clientMetrics.length > CLIENT_METRIC_MAX_SAMPLES) {
    clientMetrics.splice(0, clientMetrics.length - CLIENT_METRIC_MAX_SAMPLES);
  }
}

function latestClientMetric(): ClientDiagnosticsMetric | null {
  trimClientMetrics();
  return clientMetrics.at(-1) ?? null;
}

function isActionableIsolationReportType(
  type: string | null,
  bodyType?: string | null,
): boolean {
  const normalizedType = String(type ?? "").trim().toLowerCase();
  const normalizedBodyType = String(bodyType ?? "").trim().toLowerCase();
  return (
    ACTIONABLE_ISOLATION_REPORT_TYPES.has(normalizedType) ||
    ACTIONABLE_ISOLATION_BODY_TYPES.has(normalizedBodyType) ||
    normalizedType.includes("coep") ||
    normalizedType.includes("coop")
  );
}

function browserReportBodyType(input: JsonRecord): string | null {
  const body = asJsonRecord(input["body"]);
  return textValue(body["type"]) ?? textValue(body["violationType"]);
}

function browserReportType(input: JsonRecord): string {
  return textValue(input["type"]) ?? "browser-report";
}

function isActionableIsolationReport(input: JsonRecord): boolean {
  return isActionableIsolationReportType(
    browserReportType(input),
    browserReportBodyType(input),
  );
}

function isActionableIsolationEvent(event: DiagnosticEventPayload): boolean {
  const raw = asJsonRecord(event.raw);
  return isActionableIsolationReportType(
    textValue(event.dimensions["type"]) ?? event.code ?? event.category,
    browserReportBodyType(raw),
  );
}

function buildIsolationMetrics(): JsonRecord {
  const latest = latestClientMetric();
  const isolation = asJsonRecord(latest?.isolation);
  const cutoff = Date.now() - REQUEST_WINDOW_MS;
  const rawReports = Array.from(memoryEvents.values()).filter(
    (event) =>
      event.subsystem === "isolation" &&
      Date.parse(event.lastSeenAt) >= cutoff,
  );
  const reports = rawReports.filter(isActionableIsolationEvent);
  const byType: Record<string, number> = {};
  const rawByType: Record<string, number> = {};
  const byOrigin: Record<string, number> = {};
  rawReports.forEach((event) => {
    const type = textValue(event.dimensions["type"]) ?? event.category;
    rawByType[type] = (rawByType[type] ?? 0) + event.eventCount;
  });
  reports.forEach((event) => {
    const type = textValue(event.dimensions["type"]) ?? event.category;
    byType[type] = (byType[type] ?? 0) + event.eventCount;
    const origin = textValue(event.dimensions["blockedOrigin"]);
    if (origin) byOrigin[origin] = (byOrigin[origin] ?? 0) + event.eventCount;
  });
  const mode = process.env["RAYALGO_CROSS_ORIGIN_ISOLATION"] || "report-only";
  const reportCount = reports.reduce((total, event) => total + event.eventCount, 0);
  const rawReportCount = rawReports.reduce(
    (total, event) => total + event.eventCount,
    0,
  );
  return {
    mode,
    crossOriginIsolated: isolation["crossOriginIsolated"] === true,
    coopMode: process.env["RAYALGO_COOP_POLICY"] || "same-origin",
    coepMode: process.env["RAYALGO_COEP_POLICY"] || "require-corp",
    reportOnly: !String(mode).startsWith("enforce"),
    reportCount5m: reportCount,
    report_count_5m: reportCount,
    rawReportCount5m: rawReportCount,
    reportTypes: byType,
    rawReportTypes: rawByType,
    blockedOrigins: byOrigin,
    memoryApiAvailable: isolation["memoryApiAvailable"] === true,
    memoryApiUsed: isolation["memoryApiUsed"] === true,
    latestClientAt: latest?.observedAt ?? null,
  };
}

function classifyIsolationSnapshot(metrics: JsonRecord): DiagnosticSeverity {
  const reportCount = numeric(metrics["reportCount5m"]) ?? 0;
  if (reportCount >= 10) return "critical";
  if (reportCount > 0) return "warning";
  return "info";
}

function toResourcePressureLevel(
  value: unknown,
): ResourcePressureLevel | null {
  const normalized = textValue(value);
  if (normalized === "critical") return "critical";
  if (normalized === "high" || normalized === "shed") return "shed";
  if (normalized === "watch") return "watch";
  if (normalized === "normal") return "normal";
  return null;
}

function normalizeFooterPressureLevel(
  value: unknown,
): "normal" | "watch" | "high" | "critical" {
  const normalized = textValue(value);
  if (normalized === "critical") return "critical";
  if (normalized === "high" || normalized === "shed") return "high";
  if (normalized === "watch") return "watch";
  return "normal";
}

function sanitizeDominantDrivers(
  value: unknown,
): FooterMemoryPressureDriver[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, 4).map((entry) => {
    const record = asJsonRecord(entry);
    return {
      kind: textValue(record["kind"]),
      label: textValue(record["label"]),
      level: textValue(record["level"]),
      detail: textValue(record["detail"]),
      score: numeric(record["score"]),
    };
  });
}

function buildResourcePressureMetrics(runtime: JsonRecord): JsonRecord {
  const api = buildApiMetrics(runtime);
  const latest = latestClientMetric();
  const browserMemory = asJsonRecord(latest?.memory);
  const clientPressure = asJsonRecord(latest?.memoryPressure);
  const resourceCaches = asJsonRecord(asJsonRecord(runtime["api"])["resourceCaches"]);
  const heapUsedPercent = numeric(api["heapUsedPercent"]);
  const heapLevel = pressureLevelFromRatio(
    heapUsedPercent === null ? null : heapUsedPercent / 100,
  );
  const browserMemoryMb =
    numeric(browserMemory["bytes"]) !== null
      ? mb(numeric(browserMemory["bytes"])!)
      : numeric(browserMemory["usedJsHeapSize"]) !== null
        ? mb(numeric(browserMemory["usedJsHeapSize"])!)
        : null;
  const browserLevel =
    browserMemoryMb !== null && browserMemoryMb >= 2_500
      ? "critical"
      : browserMemoryMb !== null && browserMemoryMb >= 1_500
        ? "watch"
        : "normal";
  const clientLevel = toResourcePressureLevel(clientPressure["level"]);
  const cacheLevels = Object.values(resourceCaches).map((entry) => {
    const record = asJsonRecord(entry);
    const entries = numeric(record["entries"]);
    const maxEntries = numeric(record["maxEntries"]);
    return cacheOccupancyPressureLevel(
      entries !== null && maxEntries !== null && maxEntries > 0
        ? entries / maxEntries
        : null,
    );
  });
  const level = maxPressureLevel([
    heapLevel,
    browserLevel as ResourcePressureLevel,
    ...(clientLevel ? [clientLevel] : []),
    ...cacheLevels,
  ]);
  return {
    pressureLevel: level,
    clientPressureLevel: normalizeFooterPressureLevel(clientPressure["level"]),
    clientPressureTrend: textValue(clientPressure["trend"]) ?? "steady",
    heapUsedPercent,
    heap_used_percent: heapUsedPercent,
    heapUsedMb: api["heapUsedMb"],
    heapLimitMb: api["heapLimitMb"],
    rssMb: api["rssMb"],
    eventLoopP95Ms: api["eventLoopP95Ms"],
    browserMemoryMb,
    browser_memory_mb: browserMemoryMb,
    browserMemoryConfidence: browserMemory["confidence"] ?? null,
    browserMemorySource: browserMemory["source"] ?? null,
    sourceQuality:
      textValue(clientPressure["sourceQuality"]) ??
      textValue(browserMemory["confidence"]),
    dominantDrivers: sanitizeDominantDrivers(clientPressure["dominantDrivers"]),
    browserObservedAt: latest?.observedAt ?? null,
    latestClientAt: latest?.observedAt ?? null,
    activeDiagnosticsClients: subscribers.size,
    cacheInventory: resourceCaches,
    v8HeapSpaces: v8.getHeapSpaceStatistics().map((space) => ({
      name: space.space_name,
      sizeMb: mb(space.space_size),
      usedMb: mb(space.space_used_size),
      availableMb: mb(space.space_available_size),
      physicalMb: mb(space.physical_space_size),
    })),
    recommendedAction:
      level === "critical"
        ? "Pause optional scanners and clear stale caches."
        : level === "shed"
          ? "Shed background hydration and stale cache entries."
          : level === "watch"
            ? "Monitor growth and prepare to shed optional work."
            : "No pressure response required.",
  };
}

function classifyResourcePressureSnapshot(metrics: JsonRecord): DiagnosticSeverity {
  return pressureSeverity(
    (textValue(metrics["pressureLevel"]) as ResourcePressureLevel | null) ??
      "normal",
  );
}

const MONITORED_STORAGE_TABLES = [
  { table: "bar_cache", column: "starts_at" },
  { table: "quote_cache", column: "as_of" },
  { table: "option_chain_snapshots", column: "as_of" },
  { table: "diagnostic_snapshots", column: "observed_at" },
  { table: "diagnostic_events", column: "last_seen_at" },
  { table: "ticker_reference_cache", column: "fetched_at" },
] as const;

async function buildMonitoredStorageTableStats() {
  return Promise.all(
    MONITORED_STORAGE_TABLES.map(async (table) => {
      const result = await pool.query<{
        row_count: string;
        total_bytes: string;
        oldest_at: Date | null;
        newest_at: Date | null;
      }>(
        `select count(*)::text as row_count,
                coalesce(pg_total_relation_size($$${table.table}$$::regclass), 0)::text as total_bytes,
                min(${table.column}) as oldest_at,
                max(${table.column}) as newest_at
           from ${table.table}`,
      );
      const row = result.rows[0];
      return {
        table: table.table,
        rowEstimate: Number(row?.row_count ?? 0),
        totalMb: roundMetric(Number(row?.total_bytes ?? 0) / 1024 / 1024),
        oldestAt: row?.oldest_at?.toISOString?.() ?? null,
        newestAt: row?.newest_at?.toISOString?.() ?? null,
      };
    }),
  );
}

async function buildStorageMetrics(): Promise<JsonRecord> {
  const health = await refreshStorageHealthSnapshot();
  if (!health.reachable) {
    return { ...health };
  }

  if (process.env["DIAGNOSTICS_SKIP_STORAGE_TABLE_STATS"] === "1") {
    return {
      ...health,
      snapshotRetentionDays: 7,
      monitoredTables: [],
    };
  }

  try {
    const monitoredTables = await buildMonitoredStorageTableStats();
    return {
      ...health,
      snapshotRetentionDays: 7,
      monitoredTables,
    };
  } catch (error) {
    warnDbFailure(error, "load monitored storage table stats");
    const degraded = markStorageHealthDegraded(
      "storage_table_stats_unavailable",
      error,
    );
    return {
      ...degraded,
      snapshotRetentionDays: 7,
      monitoredTables: [],
      tableStatsError: summarizeTransientPostgresError(error),
    };
  }
}

function classifyStorageSnapshot(metrics: JsonRecord): DiagnosticSeverity {
  const status = textValue(metrics["status"]);
  if (status === "ok") {
    return "info";
  }
  if (status === "degraded") {
    return "warning";
  }
  return "critical";
}

function storageSnapshotSummary(metrics: JsonRecord): string {
  const status = textValue(metrics["status"]);
  const source = textValue(metrics["source"]);
  const sourceLabel =
    source === "workspace-local-postgres"
      ? "Workspace local Postgres"
      : source === "external-postgres"
        ? "External Postgres"
        : "Replit internal dev DB";
  if (status === "ok") {
    return `${sourceLabel} storage is reachable`;
  }
  if (status === "degraded") {
    return `${sourceLabel} is reachable, but diagnostics storage is degraded`;
  }
  return `${sourceLabel} storage is not reachable`;
}

function buildSnapshot(
  subsystem: DiagnosticSubsystem,
  severity: DiagnosticSeverity,
  summary: string,
  metrics: JsonRecord,
  raw: JsonRecord,
  dimensions: JsonRecord = {},
): DiagnosticSnapshotPayload {
  return {
    id: randomUUID(),
    observedAt: nowIso(),
    subsystem,
    status: statusFromSeverity(severity),
    severity,
    summary,
    dimensions,
    metrics: asJsonRecord(metrics),
    raw: asJsonRecord(raw),
  };
}

function incidentKey(input: DiagnosticEventInput): string {
  const code = input.code?.trim() || input.category;
  return `${input.subsystem}:${input.category}:${code}`.toLowerCase();
}

function isCollectorManagedEvent(event: DiagnosticEventPayload): boolean {
  if (event.category === "threshold") {
    return true;
  }

  if (event.subsystem === "ibkr") {
    return [
      "authentication",
      "bridge",
      "bridge-health",
      "competing-session",
      "configuration",
      "gateway-socket",
      "market-data",
      "stale-tunnel",
      "stream-freshness",
      "subscription-limit",
      "pacing",
      "socket-connect",
      "not-connected",
      "connectivity-lost",
      "connectivity-restored-data-lost",
      "connectivity-restored-data-maintained",
    ].includes(event.category);
  }

  if (
    (event.subsystem === "accounts" || event.subsystem === "orders") &&
    event.category === "visibility"
  ) {
    return true;
  }

  if (
    event.subsystem === "market-data" &&
    (event.category === "stream" || event.category === "threshold")
  ) {
    return true;
  }

  if (
    event.subsystem === "chart-hydration" &&
    [
      "exhaustion",
      "cursor",
      "latency",
      "pagination",
      "payload",
      "threshold",
    ].includes(event.category)
  ) {
    return true;
  }

  if (
    event.subsystem === "automation" &&
    ["freshness", "gateway-readiness", "worker", "threshold"].includes(
      event.category,
    )
  ) {
    return true;
  }

  return event.subsystem === "storage" && event.category === "collector";
}

async function persistSnapshot(snapshot: DiagnosticSnapshotPayload): Promise<void> {
  await safeDb(
    "insert diagnostic snapshot",
    async () => {
      await db.insert(diagnosticSnapshotsTable).values({
        observedAt: new Date(snapshot.observedAt),
        subsystem: snapshot.subsystem,
        status: snapshot.status,
        severity: snapshot.severity,
        summary: snapshot.summary,
        dimensions: snapshot.dimensions,
        metrics: snapshot.metrics,
        raw: snapshot.raw,
      });
    },
    undefined,
  );
}

async function upsertEvent(
  input: DiagnosticEventInput,
): Promise<DiagnosticEventPayload> {
  const now = nowIso();
  const key = incidentKey(input);
  const existing = memoryEvents.get(key);
  const payload: DiagnosticEventPayload = existing
    ? {
        ...existing,
        severity: input.severity,
        status: "open",
        message: input.message,
        lastSeenAt: now,
        eventCount: existing.eventCount + 1,
        dimensions: input.dimensions ?? existing.dimensions,
        raw: input.raw ?? existing.raw,
      }
    : {
        id: randomUUID(),
        incidentKey: key,
        subsystem: input.subsystem,
        category: input.category,
        code: input.code ?? null,
        severity: input.severity,
        status: "open",
        message: input.message,
        firstSeenAt: now,
        lastSeenAt: now,
        eventCount: 1,
        dimensions: input.dimensions ?? {},
        raw: input.raw ?? {},
      };
  memoryEvents.set(key, payload);
  trimMemoryEvents();

  await safeDb(
    "upsert diagnostic event",
    async () => {
      await db
        .insert(diagnosticEventsTable)
        .values({
          incidentKey: key,
          subsystem: input.subsystem,
          category: input.category,
          code: input.code ?? null,
          severity: input.severity,
          status: "open",
          message: input.message,
          firstSeenAt: new Date(payload.firstSeenAt),
          lastSeenAt: new Date(payload.lastSeenAt),
          eventCount: 1,
          dimensions: input.dimensions ?? {},
          raw: input.raw ?? {},
        })
        .onConflictDoUpdate({
          target: diagnosticEventsTable.incidentKey,
          set: {
            severity: input.severity,
            status: "open",
            message: input.message,
            lastSeenAt: new Date(payload.lastSeenAt),
            eventCount: sql`${diagnosticEventsTable.eventCount} + 1`,
            dimensions: input.dimensions ?? {},
            raw: input.raw ?? {},
            updatedAt: new Date(),
          },
        });
    },
    undefined,
  );

  broadcast({ type: "event", payload });
  return payload;
}

async function resolveEvent(event: DiagnosticEventPayload): Promise<void> {
  if (event.status === "resolved") {
    return;
  }

  const resolved: DiagnosticEventPayload = {
    ...event,
    status: "resolved",
    lastSeenAt: nowIso(),
  };
  memoryEvents.set(event.incidentKey, resolved);

  await safeDb(
    "resolve diagnostic event",
    async () => {
      await db
        .update(diagnosticEventsTable)
        .set({
          status: "resolved",
          lastSeenAt: new Date(resolved.lastSeenAt),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(diagnosticEventsTable.incidentKey, event.incidentKey),
            eq(diagnosticEventsTable.status, "open"),
          ),
        );
    },
    undefined,
  );
}

async function resolveInactiveCollectorEvents(
  activeIncidentKeys: Set<string>,
): Promise<void> {
  const memoryCandidates = Array.from(memoryEvents.values()).filter(
    (event) =>
      event.status === "open" &&
      isCollectorManagedEvent(event) &&
      !activeIncidentKeys.has(event.incidentKey),
  );

  const dbCandidates = await safeDb(
    "list open diagnostic events for resolution",
    () =>
      db
        .select()
        .from(diagnosticEventsTable)
        .where(eq(diagnosticEventsTable.status, "open"))
        .limit(1_000),
    [],
  );

  const candidatesByKey = new Map<string, DiagnosticEventPayload>();
  [...memoryCandidates, ...dbCandidates.map(toEventPayload)].forEach((event) => {
    if (
      event.status === "open" &&
      isCollectorManagedEvent(event) &&
      !activeIncidentKeys.has(event.incidentKey)
    ) {
      candidatesByKey.set(event.incidentKey, event);
    }
  });

  await Promise.all(Array.from(candidatesByKey.values()).map(resolveEvent));
}

function filterMemorySnapshots(input: {
  from: Date;
  to: Date;
  subsystem?: string | null;
  limit?: number | null;
}): DiagnosticSnapshotPayload[] {
  const snapshots = memorySnapshots
    .filter((snapshot) => {
      const observedAt = Date.parse(snapshot.observedAt);
      return (
        observedAt >= input.from.getTime() &&
        observedAt <= input.to.getTime() &&
        (!input.subsystem || snapshot.subsystem === input.subsystem)
      );
    })
    .sort(
      (left, right) =>
        Date.parse(right.observedAt) - Date.parse(left.observedAt),
    );

  if (input.limit && snapshots.length > input.limit) {
    snapshots.length = input.limit;
  }

  return snapshots.reverse();
}

function filterMemoryEvents(input: {
  from: Date;
  to: Date;
  subsystem?: string | null;
  severity?: string | null;
  status?: DiagnosticEventStatus | null;
  limit?: number | null;
}): DiagnosticEventPayload[] {
  const events = Array.from(memoryEvents.values())
    .filter((event) => {
      const lastSeenAt = Date.parse(event.lastSeenAt);
      return (
        lastSeenAt >= input.from.getTime() &&
        lastSeenAt <= input.to.getTime() &&
        (!input.subsystem || event.subsystem === input.subsystem) &&
        (!input.severity || event.severity === input.severity) &&
        (!input.status || event.status === input.status)
      );
    })
    .sort((left, right) => Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt));

  if (input.limit && events.length > input.limit) {
    events.length = input.limit;
  }

  return events;
}

function resolveResolutionMs(from: Date, to: Date): number {
  const span = to.getTime() - from.getTime();
  if (span <= 3 * 60 * 60 * 1000) {
    return 15_000;
  }
  if (span <= 36 * 60 * 60 * 1000) {
    return 60_000;
  }
  return 5 * 60_000;
}

function aggregateHistory(
  snapshots: DiagnosticSnapshotPayload[],
  resolutionMs: number,
): Array<{
  at: string;
  subsystem: DiagnosticSubsystem;
  severity: DiagnosticSeverity;
  status: DiagnosticStatus;
  count: number;
  metrics: JsonRecord;
}> {
  const buckets = new Map<
    string,
    {
      at: number;
      subsystem: DiagnosticSubsystem;
      severities: DiagnosticSeverity[];
      metrics: Record<string, number[]>;
      count: number;
    }
  >();

  snapshots.forEach((snapshot) => {
    const observedAt = Date.parse(snapshot.observedAt);
    const bucketAt = Math.floor(observedAt / resolutionMs) * resolutionMs;
    const key = `${bucketAt}:${snapshot.subsystem}`;
    const bucket =
      buckets.get(key) ??
      {
        at: bucketAt,
        subsystem: snapshot.subsystem,
        severities: [],
        metrics: {},
        count: 0,
      };
    bucket.severities.push(snapshot.severity);
    bucket.count += 1;
    Object.entries(snapshot.metrics).forEach(([metricKey, value]) => {
      const numberValue = numeric(value);
      if (numberValue === null) {
        return;
      }
      bucket.metrics[metricKey] ??= [];
      bucket.metrics[metricKey]!.push(numberValue);
    });
    buckets.set(key, bucket);
  });

  return Array.from(buckets.values())
    .sort((left, right) => left.at - right.at)
    .map((bucket) => {
      const severity = maxSeverity(bucket.severities);
      const metrics = Object.fromEntries(
        Object.entries(bucket.metrics).map(([metricKey, values]) => [
          metricKey,
          percentile(values, 95) ?? values.at(-1) ?? null,
        ]),
      );
      return {
        at: new Date(bucket.at).toISOString(),
        subsystem: bucket.subsystem,
        severity,
        status: statusFromSeverity(severity),
        count: bucket.count,
        metrics,
      };
    });
}

async function loadThresholdOverrides(): Promise<
  Map<string, Partial<DiagnosticThreshold>>
> {
  const rows = await safeDb(
    "load diagnostic threshold overrides",
    () => db.select().from(diagnosticThresholdOverridesTable),
    [],
  );
  return new Map(
    rows.map((row) => [
      row.metricKey,
      {
        warning: row.warning ?? undefined,
        critical: row.critical ?? undefined,
        enabled: row.enabled,
        audible: row.audible,
      },
    ]),
  );
}

async function evaluateThresholds(
  snapshots: DiagnosticSnapshotPayload[],
): Promise<Set<string>> {
  const activeIncidentKeys = new Set<string>();
  const thresholds = await getDiagnosticThresholds();
  await Promise.all(
    snapshots.flatMap((snapshot) =>
      thresholds
      .filter(
        (threshold) =>
          threshold.enabled && threshold.subsystem === snapshot.subsystem,
      )
      .map(async (threshold) => {
        const localKey = threshold.metricKey.split(".").at(-1);
        const value =
          numeric(snapshot.metrics[threshold.metricKey]) ??
          (localKey ? numeric(snapshot.metrics[localKey]) : null);
        if (value === null) {
          return;
        }

        const severity =
          value >= threshold.critical
            ? "critical"
            : value >= threshold.warning
              ? "warning"
              : null;
        if (!severity) {
          return;
        }

        const eventInput = {
          subsystem: threshold.subsystem,
          category: "threshold",
          code: threshold.metricKey,
          severity,
          message: `${threshold.label} ${value}${threshold.unit} breached ${severity} threshold`,
          dimensions: { metricKey: threshold.metricKey, unit: threshold.unit },
          raw: { threshold, value, snapshot },
        } satisfies DiagnosticEventInput;
        activeIncidentKeys.add(incidentKey(eventInput));
        await upsertEvent(eventInput);
        broadcast({
          type: "threshold-breach",
          payload: {
            threshold,
            value,
            severity,
            observedAt: snapshot.observedAt,
          },
        });
      }),
    ),
  );
  return activeIncidentKeys;
}

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

export async function recordBrowserDiagnosticEvent(input: {
  category?: string;
  severity?: DiagnosticSeverity;
  message?: string;
  code?: string | null;
  dimensions?: JsonRecord;
  raw?: JsonRecord;
}): Promise<DiagnosticEventPayload> {
  return upsertEvent({
    subsystem: "browser",
    category: input.category || "client-event",
    code: input.code ?? null,
    severity: input.severity ?? "warning",
    message: input.message || "Browser diagnostic event",
    dimensions: input.dimensions ?? {},
    raw: input.raw ?? {},
  });
}

function buildFooterMemoryPressureSummary(
  resourceMetrics: JsonRecord,
): DiagnosticsLatestPayload["footerMemoryPressure"] {
  return {
    observedAt:
      textValue(resourceMetrics["browserObservedAt"]) ??
      textValue(resourceMetrics["latestClientAt"]) ??
      null,
    level: normalizeFooterPressureLevel(
      resourceMetrics["clientPressureLevel"] ?? resourceMetrics["pressureLevel"],
    ),
    trend: (textValue(resourceMetrics["clientPressureTrend"]) ??
      "steady") as "steady" | "rising" | "recovering",
    browserMemoryMb: numeric(resourceMetrics["browserMemoryMb"]),
    apiHeapUsedPercent: numeric(resourceMetrics["heapUsedPercent"]),
    sourceQuality: textValue(resourceMetrics["sourceQuality"]),
    dominantDrivers: sanitizeDominantDrivers(resourceMetrics["dominantDrivers"]),
  };
}

export async function recordClientDiagnosticsMetrics(input: {
  memory?: JsonRecord;
  memoryPressure?: JsonRecord;
  isolation?: JsonRecord;
  workload?: JsonRecord;
  chartHydration?: JsonRecord;
  storage?: JsonRecord;
  caches?: JsonRecord;
  navigation?: JsonRecord;
  screens?: JsonRecord;
  longTasks?: JsonRecord;
  apiTimings?: JsonRecord;
  raw?: JsonRecord;
}): Promise<{ accepted: true; id: string }> {
  const id = randomUUID();
  const sample: ClientDiagnosticsMetric = {
    id,
    observedAt: nowIso(),
    receivedAt: Date.now(),
    memory: asJsonRecord(input.memory),
    memoryPressure: asJsonRecord(input.memoryPressure),
    isolation: asJsonRecord(input.isolation),
    workload: asJsonRecord(input.workload),
    chartHydration: asJsonRecord(input.chartHydration),
    storage: asJsonRecord(input.storage),
    caches: asJsonRecord(input.caches),
    navigation: asJsonRecord(input.navigation),
    screens: asJsonRecord(input.screens),
    longTasks: asJsonRecord(input.longTasks),
    apiTimings: asJsonRecord(input.apiTimings),
    raw: asJsonRecord(input.raw),
  };
  clientMetrics.push(sample);
  trimClientMetrics();
  return { accepted: true, id };
}

function reportMessage(input: JsonRecord): string {
  const type = browserReportType(input);
  const body = asJsonRecord(input["body"]);
  const blockedUrl =
    textValue(body["blockedURL"]) ??
    textValue(body["blocked-url"]) ??
    textValue(body["blockedUrl"]);
  return blockedUrl
    ? `${type} report for ${blockedUrl}`
    : `${type} browser report received`;
}

export async function recordBrowserReports(input: unknown): Promise<{
  accepted: number;
}> {
  const reports = Array.isArray(input) ? input : [input];
  let accepted = 0;
  for (const report of reports) {
    const record = asJsonRecord(report);
    const type = browserReportType(record);
    const body = asJsonRecord(record["body"]);
    const actionableIsolation = isActionableIsolationReport(record);
    const blockedUrl =
      textValue(body["blockedURL"]) ??
      textValue(body["blocked-url"]) ??
      textValue(body["blockedUrl"]);
    let blockedOrigin: string | null = null;
    if (blockedUrl) {
      try {
        blockedOrigin = new URL(blockedUrl).origin;
      } catch {
        blockedOrigin = blockedUrl;
      }
    }
    const severity: DiagnosticSeverity = actionableIsolation ? "warning" : "info";
    await upsertEvent({
      subsystem: actionableIsolation ? "isolation" : "browser",
      category: "browser-report",
      code: type,
      severity,
      message: reportMessage(record),
      dimensions: {
        type,
        bodyType: browserReportBodyType(record),
        blockedOrigin,
        disposition: textValue(body["disposition"]),
      },
      raw: record,
    });
    accepted += 1;
  }
  return { accepted };
}

export async function recordServerDiagnosticEvent(input: {
  subsystem: DiagnosticSubsystem;
  category: string;
  severity: DiagnosticSeverity;
  message: string;
  code?: string | null;
  dimensions?: JsonRecord;
  raw?: JsonRecord;
}): Promise<DiagnosticEventPayload> {
  return upsertEvent({
    subsystem: input.subsystem,
    category: input.category,
    code: input.code ?? null,
    severity: input.severity,
    message: input.message,
    dimensions: input.dimensions ?? {},
    raw: input.raw ?? {},
  });
}

export async function collectDiagnosticSnapshot(
  input: RuntimeDiagnosticInput,
): Promise<DiagnosticsLatestPayload> {
  const runtime = asJsonRecord(input.runtime);
  const probes = asJsonRecord(input.probes);
  const apiMetrics = buildApiMetrics(runtime);
  const apiSeverity = classifyApiSnapshot(apiMetrics);
  const ibkrMetrics = buildIbkrMetrics(runtime);
  const ibkrSeverity = classifyIbkrSnapshot(ibkrMetrics);
  const marketDataMetrics = buildMarketDataMetrics(probes, runtime);
  const marketDataSeverity = classifyMarketDataSnapshot(marketDataMetrics);
  const browserMetrics = buildBrowserMetrics();
  const browserSeverity = classifyBrowserSnapshot(browserMetrics);
  const chartHydration = buildChartHydrationMetrics(runtime);
  const chartHydrationSeverity = classifyChartHydrationSnapshot(
    chartHydration.metrics,
  );
  const probeMetrics = buildProbeMetrics(probes);
  const accountFailures = numeric(probeMetrics.accounts["visibilityFailures"]) ?? 0;
  const orderFailures = numeric(probeMetrics.orders["visibilityFailures"]) ?? 0;
  const orderReadDegraded = probeMetrics.orders["degraded"] === true;
  const automation = await buildAutomationMetrics();
  const automationSeverity = classifyAutomationSnapshot(automation.metrics);
  const storageMetrics = await buildStorageMetrics();
  const storageSeverity = classifyStorageSnapshot(storageMetrics);
  const resourceMetrics = buildResourcePressureMetrics(runtime);
  const resourceSeverity = classifyResourcePressureSnapshot(resourceMetrics);
  const isolationMetrics = buildIsolationMetrics();
  const isolationSeverity = classifyIsolationSnapshot(isolationMetrics);

  const snapshots = [
    buildSnapshot(
      "api",
      apiSeverity,
      apiSeverity === "info"
        ? "API latency and runtime are normal"
        : "API latency or errors are elevated",
      apiMetrics,
      runtime,
    ),
    buildSnapshot(
      "ibkr",
      ibkrSeverity,
      ibkrSeverity === "info"
        ? "IBKR bridge and TWS session are healthy"
        : "IBKR bridge or TWS session needs attention",
      ibkrMetrics,
      asJsonRecord(runtime["ibkr"]),
    ),
    buildSnapshot(
      "market-data",
      marketDataSeverity,
      marketDataSeverity === "info"
        ? "Market-data streams are healthy or idle"
        : "Market-data streams need attention",
      marketDataMetrics,
      asJsonRecord(probes["marketData"]),
    ),
    buildSnapshot(
      "browser",
      browserSeverity,
      browserSeverity === "info"
        ? "Browser diagnostics are quiet"
        : "Recent browser diagnostics need attention",
      browserMetrics,
      browserMetrics,
    ),
    buildSnapshot(
      "chart-hydration",
      chartHydrationSeverity,
      chartHydrationSeverity === "info"
        ? "Chart hydration is healthy"
        : "Chart hydration needs attention",
      chartHydration.metrics,
      chartHydration.raw,
    ),
    buildSnapshot(
      "resource-pressure",
      resourceSeverity,
      resourceSeverity === "info"
        ? "Resource pressure is normal"
        : "Memory, cache, or workload pressure is elevated",
      resourceMetrics,
      resourceMetrics,
    ),
    buildSnapshot(
      "isolation",
      isolationSeverity,
      isolationSeverity === "info"
        ? "Cross-origin isolation readiness reports are quiet"
        : "Cross-origin isolation readiness reports need attention",
      isolationMetrics,
      isolationMetrics,
    ),
    buildSnapshot(
      "accounts",
      accountFailures > 0 ? "critical" : "info",
      accountFailures > 0
        ? "Account or position read probe failed"
        : "Account and position read probes are healthy",
      probeMetrics.accounts,
      asJsonRecord(probes["accounts"]),
    ),
    buildSnapshot(
      "orders",
      orderFailures > 0 ? "critical" : orderReadDegraded ? "warning" : "info",
      orderFailures > 0
        ? "Order visibility read probe failed"
        : orderReadDegraded
          ? "Order visibility read probe is degraded"
          : "Order visibility read probe is healthy",
      probeMetrics.orders,
      asJsonRecord(probes["orders"]),
    ),
    buildSnapshot(
      "automation",
      automationSeverity,
      automationSeverity === "info"
        ? "Signal-options automation worker is healthy"
        : "Signal-options automation needs attention",
      automation.metrics,
      automation.raw,
    ),
    buildSnapshot(
      "storage",
      storageSeverity,
      storageSnapshotSummary(storageMetrics),
      storageMetrics,
      storageMetrics,
    ),
  ];

  const activeIncidentKeys = new Set<string>();
  const activeEvents: DiagnosticEventInput[] = [];
  const ibkrRaw = asJsonRecord(runtime["ibkr"]);
  activeEvents.push(...buildIbkrDiagnosticEvents(ibkrRaw, ibkrMetrics));
  activeEvents.push(
    ...buildChartHydrationDiagnosticEvents(
      chartHydration.metrics,
      chartHydration.raw,
    ),
  );

  const marketDataLastError = textValue(marketDataMetrics["lastError"]);
  if (
    marketDataLastError &&
    (numeric(marketDataMetrics["activeConsumerCount"]) ?? 0) > 0
  ) {
    activeEvents.push({
      subsystem: "market-data",
      category: "stream",
      code: "bridge_quote_stream_error",
      severity: "critical",
      message: marketDataLastError,
      raw: asJsonRecord(probes["marketData"]),
    });
  }

  if (accountFailures > 0 || orderFailures > 0) {
    activeEvents.push({
      subsystem: orderFailures > 0 ? "orders" : "accounts",
      category: "visibility",
      code: "read_probe_failed",
      severity: "critical",
      message: "Read-only account/order diagnostics probe failed",
      raw: probes,
    });
  }

  if (orderReadDegraded) {
    activeEvents.push({
      subsystem: "orders",
      category: "visibility",
      code: "read_probe_degraded",
      severity: "warning",
      message: "Open-orders snapshot timed out; using cached order stream.",
      raw: asJsonRecord(probes["orders"]),
    });
  }

  if (storageSeverity !== "info") {
    const status = textValue(storageMetrics["status"]) ?? "unavailable";
    const reason = textValue(storageMetrics["reason"]);
    activeEvents.push({
      subsystem: "storage",
      category: "connectivity",
      code:
        status === "degraded"
          ? "postgres_storage_degraded"
          : "postgres_unavailable",
      severity: storageSeverity,
      message:
        status === "degraded"
          ? "Configured Postgres storage is reachable, but diagnostics storage is degraded."
          : "Configured Postgres storage is unreachable; DB-backed services are degraded.",
      dimensions: {
        status,
        reason,
        host: storageMetrics["host"] ?? null,
        database: storageMetrics["database"] ?? null,
      },
      raw: storageMetrics,
    });
  }

  if ((numeric(automation.metrics["gatewayBlockedCount"]) ?? 0) > 0) {
    activeEvents.push({
      subsystem: "automation",
      category: "gateway-readiness",
      code: "signal_options_gateway_blocked",
      severity:
        (numeric(automation.metrics["gatewayBlockedCount"]) ?? 0) >= 3
          ? "critical"
          : "warning",
      message: "Signal-options scans are blocked by IB Gateway readiness.",
      dimensions: {
        gatewayBlockedCount: automation.metrics["gatewayBlockedCount"],
      },
      raw: automation.raw,
    });
  }

  if ((numeric(automation.metrics["failureCount"]) ?? 0) > 0) {
    activeEvents.push({
      subsystem: "automation",
      category: "worker",
      code: "signal_options_worker_failure",
      severity:
        (numeric(automation.metrics["failureCount"]) ?? 0) >= 3
          ? "critical"
          : "warning",
      message:
        textValue(automation.metrics["latestError"]) ??
        "Signal-options worker scans are failing.",
      dimensions: {
        failureCount: automation.metrics["failureCount"],
      },
      raw: automation.raw,
    });
  }

  if (
    (numeric(automation.metrics["enabledDeployments"]) ?? 0) > 0 &&
    ((numeric(automation.metrics["staleScanCount"]) ?? 0) > 0 ||
      automation.metrics["workerRunning"] !== true)
  ) {
    activeEvents.push({
      subsystem: "automation",
      category: "freshness",
      code: "signal_options_scan_stale",
      severity: automationSeverity === "critical" ? "critical" : "warning",
      message: "Signal-options worker scans are stale or the worker is stopped.",
      dimensions: {
        staleScanCount: automation.metrics["staleScanCount"],
        latestScanAgeMs: automation.metrics["latestScanAgeMs"],
      },
      raw: automation.raw,
    });
  }

  await Promise.all(
    activeEvents.map((event) => {
      activeIncidentKeys.add(incidentKey(event));
      return upsertEvent(event);
    }),
  );

  memorySnapshots.push(...snapshots);
  trimMemorySnapshots();
  await Promise.all(snapshots.map((snapshot) => persistSnapshot(snapshot)));
  const activeThresholdKeys = await evaluateThresholds(snapshots);
  activeThresholdKeys.forEach((key) => activeIncidentKeys.add(key));
  await resolveInactiveCollectorEvents(activeIncidentKeys);
  await safeDb(
    "diagnostics retention cleanup",
    async () => {
      await db
        .delete(diagnosticSnapshotsTable)
        .where(
          lte(
            diagnosticSnapshotsTable.observedAt,
            new Date(Date.now() - SNAPSHOT_RETENTION_MS),
          ),
        );
      await db
        .delete(diagnosticEventsTable)
        .where(
          lte(
            diagnosticEventsTable.lastSeenAt,
            new Date(Date.now() - SNAPSHOT_RETENTION_MS),
          ),
        );
    },
    undefined,
  );

  const events = Array.from(memoryEvents.values())
    .filter((event) => event.status === "open")
    .sort((left, right) => Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt))
    .slice(0, MAX_RECENT_EVENTS);
  const severity = maxSeverity(snapshots.map((snapshot) => snapshot.severity));
  latestPayload = {
    timestamp: nowIso(),
    status: statusFromSeverity(severity),
    severity,
    summary:
      severity === "info"
        ? "Diagnostics are healthy"
        : "One or more diagnostics need attention",
    snapshots,
    events,
    thresholds: await getDiagnosticThresholds(),
    footerMemoryPressure: buildFooterMemoryPressureSummary(resourceMetrics),
  };
  broadcast({ type: "snapshot", payload: latestPayload });
  return latestPayload;
}

export async function getDiagnosticThresholds(): Promise<DiagnosticThreshold[]> {
  const overrides = await loadThresholdOverrides();
  return DEFAULT_THRESHOLDS.map((threshold) => ({
    ...threshold,
    ...(overrides.get(threshold.metricKey) ?? {}),
  }));
}

export async function updateDiagnosticThresholds(
  overrides: Array<{
    metricKey: string;
    warning?: number | null;
    critical?: number | null;
    enabled?: boolean;
    audible?: boolean;
  }>,
): Promise<DiagnosticThreshold[]> {
  const knownKeys = new Set(DEFAULT_THRESHOLDS.map((threshold) => threshold.metricKey));
  for (const override of overrides) {
    if (!knownKeys.has(override.metricKey)) {
      continue;
    }
    const warning =
      typeof override.warning === "number" && Number.isFinite(override.warning)
        ? override.warning
        : null;
    const critical =
      typeof override.critical === "number" && Number.isFinite(override.critical)
        ? override.critical
        : null;
    await safeDb(
      "update diagnostic threshold override",
      async () => {
        await db
          .insert(diagnosticThresholdOverridesTable)
          .values({
            metricKey: override.metricKey,
            warning,
            critical,
            enabled: override.enabled ?? true,
            audible: override.audible ?? true,
          })
          .onConflictDoUpdate({
            target: diagnosticThresholdOverridesTable.metricKey,
            set: {
              warning,
              critical,
              enabled: override.enabled ?? true,
              audible: override.audible ?? true,
              updatedAt: new Date(),
            },
          });
      },
      undefined,
    );
  }
  return getDiagnosticThresholds();
}

export async function listDiagnosticHistory(input: {
  from: Date;
  to: Date;
  subsystem?: string | null;
  limit?: number | null;
}) {
  const limit =
    typeof input.limit === "number" && Number.isFinite(input.limit)
      ? Math.max(1, Math.min(2_500, Math.floor(input.limit)))
      : 500;
  const clauses: SQL[] = [
    gte(diagnosticSnapshotsTable.observedAt, input.from),
    lte(diagnosticSnapshotsTable.observedAt, input.to),
  ];
  if (input.subsystem) {
    clauses.push(eq(diagnosticSnapshotsTable.subsystem, input.subsystem));
  }

  const rows = await safeDb(
    "list diagnostic history",
    () =>
      db
        .select()
        .from(diagnosticSnapshotsTable)
        .where(and(...clauses))
        .orderBy(desc(diagnosticSnapshotsTable.observedAt))
        .limit(limit),
    [],
  );
  const snapshots =
    rows.length > 0
      ? rows.map(toSnapshotPayload).reverse()
      : filterMemorySnapshots({ ...input, limit });
  const resolutionMs = resolveResolutionMs(input.from, input.to);
  return {
    from: input.from.toISOString(),
    to: input.to.toISOString(),
    resolutionMs,
    points: aggregateHistory(snapshots, resolutionMs),
    snapshots,
  };
}

export async function listDiagnosticEvents(input: {
  from: Date;
  to: Date;
  subsystem?: string | null;
  severity?: string | null;
  status?: DiagnosticEventStatus | null;
  limit?: number | null;
}) {
  const limit =
    typeof input.limit === "number" && Number.isFinite(input.limit)
      ? Math.max(1, Math.min(1_000, Math.floor(input.limit)))
      : 200;
  const clauses: SQL[] = [
    gte(diagnosticEventsTable.lastSeenAt, input.from),
    lte(diagnosticEventsTable.lastSeenAt, input.to),
  ];
  if (input.subsystem) {
    clauses.push(eq(diagnosticEventsTable.subsystem, input.subsystem));
  }
  if (input.severity) {
    clauses.push(eq(diagnosticEventsTable.severity, input.severity));
  }
  if (input.status) {
    clauses.push(eq(diagnosticEventsTable.status, input.status));
  }

  const rows = await safeDb(
    "list diagnostic events",
    () =>
      db
        .select()
        .from(diagnosticEventsTable)
        .where(and(...clauses))
        .orderBy(desc(diagnosticEventsTable.lastSeenAt))
        .limit(limit),
    [],
  );
  return {
    from: input.from.toISOString(),
    to: input.to.toISOString(),
    events:
      rows.length > 0
        ? rows.map(toEventPayload)
        : filterMemoryEvents({ ...input, limit }),
  };
}

export async function getDiagnosticEventDetail(eventId: string) {
  const dbRows = await safeDb(
    "get diagnostic event",
    () =>
      db
        .select()
        .from(diagnosticEventsTable)
        .where(eq(diagnosticEventsTable.id, eventId))
        .limit(1),
    [],
  );
  const event =
    dbRows[0] ? toEventPayload(dbRows[0]) : Array.from(memoryEvents.values()).find(
      (item) => item.id === eventId || item.incidentKey === eventId,
    );
  if (!event) {
    return null;
  }

  const from = new Date(Date.parse(event.firstSeenAt) - 15 * 60 * 1000);
  const to = new Date(Date.parse(event.lastSeenAt) + 15 * 60 * 1000);
  const history = await listDiagnosticHistory({
    from,
    to,
    subsystem: event.subsystem,
  });
  return {
    event,
    relatedSnapshots: history.snapshots,
  };
}

export async function exportDiagnostics(input: {
  from: Date;
  to: Date;
  subsystem?: string | null;
}) {
  const [history, events, thresholds] = await Promise.all([
    listDiagnosticHistory(input),
    listDiagnosticEvents(input),
    getDiagnosticThresholds(),
  ]);
  return {
    exportedAt: nowIso(),
    from: input.from.toISOString(),
    to: input.to.toISOString(),
    filters: { subsystem: input.subsystem ?? null },
    latest: latestPayload,
    thresholds,
    history,
    events: events.events,
  };
}

const PRUNABLE_CACHE_TABLES: Record<string, { table: string; column: string }> = {
  bar_cache: { table: "bar_cache", column: "starts_at" },
  quote_cache: { table: "quote_cache", column: "as_of" },
  option_chain_snapshots: { table: "option_chain_snapshots", column: "as_of" },
  diagnostic_snapshots: { table: "diagnostic_snapshots", column: "observed_at" },
  diagnostic_events: { table: "diagnostic_events", column: "last_seen_at" },
  ticker_reference_cache: { table: "ticker_reference_cache", column: "fetched_at" },
};

export async function pruneDiagnosticStorage(input: {
  tables?: string[];
  olderThanDays?: number;
  dryRun?: boolean;
}) {
  const olderThanDays =
    typeof input.olderThanDays === "number" && Number.isFinite(input.olderThanDays)
      ? Math.max(1, Math.min(365, Math.round(input.olderThanDays)))
      : 30;
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const requested = input.tables?.length
    ? input.tables
    : ["bar_cache", "quote_cache", "option_chain_snapshots"];
  const tables = requested.filter((table) => PRUNABLE_CACHE_TABLES[table]);
  const dryRun = input.dryRun !== false;
  const results = [];

  for (const tableName of tables) {
    const table = PRUNABLE_CACHE_TABLES[tableName]!;
    const countResult = await pool.query<{ count: string }>(
      `select count(*)::text as count from ${table.table} where ${table.column} < $1`,
      [cutoff],
    );
    const matchingRows = Number(countResult.rows[0]?.count ?? 0);
    let deletedRows = 0;
    if (!dryRun && matchingRows > 0) {
      const deleteResult = await pool.query(
        `delete from ${table.table} where ${table.column} < $1`,
        [cutoff],
      );
      deletedRows = deleteResult.rowCount ?? 0;
    }
    results.push({
      table: tableName,
      cutoff: cutoff.toISOString(),
      matchingRows,
      deletedRows,
      dryRun,
    });
  }

  return {
    dryRun,
    olderThanDays,
    allowedTables: Object.keys(PRUNABLE_CACHE_TABLES),
    results,
  };
}

export function getLatestDiagnostics(): DiagnosticsLatestPayload | null {
  return latestPayload;
}

export function subscribeDiagnostics(
  listener: (message: DiagnosticsStreamMessage) => void,
): () => void {
  subscribers.add(listener);
  if (latestPayload) {
    listener({ type: "snapshot", payload: latestPayload });
  }
  return () => {
    subscribers.delete(listener);
  };
}

export function getDiagnosticsClientCount(): number {
  return subscribers.size;
}

export function startDiagnosticsCollector(
  collect: () => Promise<RuntimeDiagnosticInput>,
  intervalMs = DEFAULT_COLLECTION_INTERVAL_MS,
): void {
  if (collectorTimer) {
    return;
  }

  const tick = () => {
    void collect()
      .then((input) => collectDiagnosticSnapshot(input))
      .catch((error) => {
        logger.warn({ err: error }, "Diagnostics collection failed");
        void upsertEvent({
          subsystem: "storage",
          category: "collector",
          code: "collection_failed",
          severity: "warning",
          message:
            error instanceof Error
              ? error.message
              : "Diagnostics collection failed",
          raw: { error: String(error) },
        });
      });
  };

  tick();
  collectorTimer = setInterval(tick, intervalMs);
  collectorTimer.unref?.();
}
