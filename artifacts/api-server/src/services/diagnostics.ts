import { randomUUID } from "node:crypto";
import * as v8 from "node:v8";
import {
  and,
  desc,
  eq,
  gte,
  lte,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  algoDeploymentsTable,
  db,
  diagnosticEventsTable,
  diagnosticSnapshotsTable,
  diagnosticThresholdOverridesTable,
  executionEventsTable,
  getPoolStats,
  pool,
  shadowPositionsTable,
  type DiagnosticEvent,
  type DiagnosticSnapshot,
} from "@workspace/db";
import * as dbExports from "@workspace/db";
import { logger } from "../lib/logger";
import { isLongLivedApiRequestUrl } from "../lib/request-logging";
import {
  isTransientPostgresError,
  summarizeTransientPostgresError,
} from "../lib/transient-db-error";
import { getSignalOptionsWorkerSnapshot } from "./signal-options-worker-state";
import {
  getRecentRequestSamples,
  type ApiRequestSample,
} from "./request-metrics";
import {
  getApiResourcePressureSnapshot,
  getContainerMemoryLimitMb,
  normalizeApiResourcePressureLevel,
  resolveApiRssPressureThresholds,
  updateApiResourcePressure,
  type ApiResourcePressureLevel,
} from "./resource-pressure";
import {
  markStorageHealthDegraded,
  refreshStorageHealthSnapshot,
} from "./storage-health";
import {
  appendRuntimeFlightRecorderEvent,
  getRuntimeFlightRecorderDiagnostics,
} from "./runtime-flight-recorder";
import { classifyApiRoute } from "./route-admission";

const SIGNAL_OPTIONS_EVENT_PREFIX = "signal_options_";
const SIGNAL_OPTIONS_GATEWAY_BLOCKED_EVENT =
  "signal_options_gateway_blocked";
const SIGNAL_OPTIONS_SKIPPED_EVENT = "signal_options_candidate_skipped";
const SIGNAL_OPTIONS_EXIT_EVENT = "signal_options_shadow_exit";
const DIAGNOSTICS_HEAVY_READ_CACHE_TTL_MS = 60_000;
const DIAGNOSTICS_HEAVY_READ_STALE_TTL_MS = 5 * 60_000;
type DbLaneRunner = <T>(lane: "background", fn: () => T) => T;
const runInDbLane = (
  dbExports as typeof dbExports & { runInDbLane: DbLaneRunner }
).runInDbLane;

export type DiagnosticSeverity = "info" | "warning";
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
  | "storage"
  | "runtime";

type JsonRecord = Record<string, unknown>;

export type DiagnosticThreshold = {
  metricKey: string;
  label: string;
  subsystem: DiagnosticSubsystem;
  unit: "ms" | "count" | "mb" | "percent";
  warning: number;
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
  countOccurrence?: boolean;
};

type AutomationRecentEventRow = {
  eventType: string;
  payload: unknown;
  occurredAt: Date;
};

type CachedHeavyRead<T> = {
  value: T;
  cachedAt: number;
};

export type DiagnosticEventStatus = "open" | "resolved";

type DiagnosticThresholdOverrideRow = {
  metricKey: string;
  warning: number | null;
  enabled: boolean;
  audible: boolean;
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
  marketDataWorkPlan?: JsonRecord;
  footerMemoryPressure?: {
    observedAt: string | null;
    level: "normal" | "watch" | "high";
    trend: "steady" | "rising" | "recovering";
    browserMemoryMb: number | null;
    browserMemoryLimitMb: number | null;
    apiRssMb: number | null;
    apiRssThresholds: {
      watch: number;
      high: number;
    };
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

const FOOTER_MEMORY_DRIVER_KINDS = new Set([
  "api-heap",
  "api-rss",
  "db-pool",
  "browser-memory",
  "chart-hydration",
  "client-pressure",
  "query-cache",
  "runtime-stores",
  "workload",
]);

const SNAPSHOT_RETENTION_MS = 24 * 60 * 60 * 1000;
const SNAPSHOT_RETENTION_DAYS = SNAPSHOT_RETENTION_MS / (24 * 60 * 60 * 1000);
const STORAGE_WARNING_DATABASE_MB = Number(
  process.env["STORAGE_WARNING_DATABASE_MB"] ?? "15360",
);
const DEFAULT_COLLECTION_INTERVAL_MS = 15_000;
const REQUEST_WINDOW_MS = 5 * 60 * 1000;
const API_LATENCY_ALERT_MIN_SAMPLES = 20;
const SLOW_API_ROUTE_MS = 1_000;
const API_ROUTE_PRESSURE_MIN_SLOW_COUNT = 3;
const MAX_MEMORY_SNAPSHOTS = 2_000;
const MAX_MEMORY_EVENTS = 500;
const DIAGNOSTIC_HISTORY_DEFAULT_LIMIT = 500;
const DIAGNOSTIC_HISTORY_MAX_LIMIT = 2_500;
const DIAGNOSTIC_EVENTS_DEFAULT_LIMIT = 200;
const DIAGNOSTIC_EVENTS_MAX_LIMIT = 1_000;
const DIAGNOSTIC_THRESHOLD_OVERRIDES_CACHE_TTL_MS = 30_000;
const DIAGNOSTIC_LIMIT_CAPS: Record<
  ApiResourcePressureLevel,
  {
    history: number;
    events: number;
    exportHistory: number;
    exportEvents: number;
  }
> = {
  normal: {
    history: DIAGNOSTIC_HISTORY_MAX_LIMIT,
    events: DIAGNOSTIC_EVENTS_MAX_LIMIT,
    exportHistory: DIAGNOSTIC_HISTORY_DEFAULT_LIMIT,
    exportEvents: DIAGNOSTIC_EVENTS_DEFAULT_LIMIT,
  },
  watch: {
    history: DIAGNOSTIC_HISTORY_DEFAULT_LIMIT,
    events: 300,
    exportHistory: 240,
    exportEvents: 150,
  },
  high: {
    history: 240,
    events: 150,
    exportHistory: 120,
    exportEvents: 80,
  },
};
const MAX_RECENT_EVENTS = 50;
const CLIENT_METRIC_RETENTION_MS = 10 * 60 * 1000;
const CLIENT_METRIC_MAX_SAMPLES = 500;
const BROWSER_MEMORY_LIMIT_PRESSURE = Object.freeze({
  watch: 60,
  high: 75,
});
const BROWSER_MEMORY_MB_FALLBACK_PRESSURE = Object.freeze({
  watch: 1_000,
  high: 1_500,
});
const API_LATENCY_WARNING_MS = 1_000;
const ACTIONABLE_ISOLATION_REPORT_TYPES = new Set(["coep", "coop"]);
const ACTIONABLE_ISOLATION_BODY_TYPES = new Set(["coep", "coop", "corp"]);
const DIAGNOSTIC_RAW_MAX_DEPTH = 4;
const DIAGNOSTIC_RAW_MAX_OBJECT_KEYS = 40;
const DIAGNOSTIC_RAW_MAX_ARRAY_ITEMS = 20;
const DIAGNOSTIC_RAW_MAX_STRING_LENGTH = 2_000;

type ResourcePressureLevel = ApiResourcePressureLevel | "shed";

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
    warning: API_LATENCY_WARNING_MS,
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
    enabled: true,
    audible: true,
    description: "Largest unrecovered market data stream gap.",
  },
  {
    metricKey: "api.heap_used_mb",
    label: "API heap used (display only)",
    subsystem: "api",
    unit: "mb",
    warning: 750,
    enabled: false,
    audible: false,
    description:
      "Node heap used by the API process. Severity uses resource_pressure.heap_used_percent instead.",
  },
  {
    metricKey: "resource_pressure.heap_used_percent",
    label: "API heap pressure",
    subsystem: "resource-pressure",
    unit: "percent",
    warning: 70,
    enabled: true,
    audible: false,
    description: "Node heap used as a percentage of the V8 heap limit.",
  },
  {
    metricKey: "resource_pressure.db_pool_waiting",
    label: "DB pool waiting",
    subsystem: "resource-pressure",
    unit: "count",
    warning: 1,
    enabled: true,
    audible: true,
    description:
      "Postgres acquire requests queued because every shared Node pool connection is checked out.",
  },
  {
    metricKey: "resource_pressure.browser_memory_mb",
    label: "Browser memory estimate",
    subsystem: "resource-pressure",
    unit: "mb",
    warning: BROWSER_MEMORY_MB_FALLBACK_PRESSURE.high,
    enabled: false,
    audible: false,
    description:
      "Latest browser memory estimate from client diagnostics. Limit-aware browser pressure uses browser_memory_limit_percent when available.",
  },
  {
    metricKey: "resource_pressure.browser_memory_limit_percent",
    label: "Browser heap pressure",
    subsystem: "resource-pressure",
    unit: "percent",
    warning: BROWSER_MEMORY_LIMIT_PRESSURE.watch,
    enabled: true,
    audible: false,
    description: "Browser heap usage as a percentage of the browser-reported heap limit.",
  },
  {
    metricKey: "isolation.report_count_5m",
    label: "Isolation reports",
    subsystem: "isolation",
    unit: "count",
    warning: 1,
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

const memorySnapshots: DiagnosticSnapshotPayload[] = [];
const memoryEvents = new Map<string, DiagnosticEventPayload>();
const clientMetrics: ClientDiagnosticsMetric[] = [];
const subscribers = new Set<(message: DiagnosticsStreamMessage) => void>();

let latestPayload: DiagnosticsLatestPayload | null = null;
let collectorTimer: NodeJS.Timeout | null = null;
let diagnosticsCollectorInFlight = false;
let lastDbWarningAt = 0;

// Write-hygiene state (census R3+S12): collapse the observability system's own
// per-tick DB churn.
const DIAGNOSTIC_EVENT_PERSIST_TOUCH_MS = 5 * 60 * 1000;
const DIAGNOSTIC_RETENTION_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

type PersistedDiagnosticEventSignature = {
  status: DiagnosticEventStatus;
  severity: DiagnosticSeverity;
  message: string;
  lastSeenAtMs: number;
};

const lastPersistedDiagnosticEventByKey = new Map<
  string,
  PersistedDiagnosticEventSignature
>();
let lastDiagnosticsRetentionCleanupAt = 0;

// Skip the diagnostic-event DB upsert when nothing material changed and the
// persisted row's lastSeenAt is still within the coarse touch window. The 5-min
// touch keeps the DB row fresh enough that the 24h retention DELETE never prunes
// an active-but-unchanged incident.
function shouldPersistDiagnosticEventToDb(
  last: PersistedDiagnosticEventSignature | undefined,
  next: PersistedDiagnosticEventSignature,
  touchMs: number,
): boolean {
  if (!last) return true;
  if (
    last.status !== next.status ||
    last.severity !== next.severity ||
    last.message !== next.message
  ) {
    return true;
  }
  return next.lastSeenAtMs - last.lastSeenAtMs >= touchMs;
}

// 24h retention changes at most once/day, so the DELETEs do not need to run on
// every 15s collector tick — a 6h cadence prunes eligible rows well within the
// retention window while removing ~11.5k no-op DELETEs/day.
function shouldRunDiagnosticsRetentionCleanup(
  nowMs: number,
  lastRunMs: number,
  intervalMs: number,
): boolean {
  return nowMs - lastRunMs >= intervalMs;
}

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

function minFiniteNumber(...values: Array<number | null | undefined>): number | null {
  const finiteValues = values.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );
  return finiteValues.length ? Math.min(...finiteValues) : null;
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
  if (level === "shed" || level === "high" || level === "watch") return "warning";
  return "info";
}

function maxPressureLevel(levels: ResourcePressureLevel[]): ResourcePressureLevel {
  if (levels.includes("high")) return "high";
  if (levels.includes("shed")) return "shed";
  if (levels.includes("watch")) return "watch";
  return "normal";
}

function pressureLevelFromRatio(value: number | null): ResourcePressureLevel {
  if (value === null) return "normal";
  if (value >= 0.8) return "high";
  if (value >= 0.7) return "watch";
  return "normal";
}

function browserMemoryPressureLevel(input: {
  memoryMb: number | null;
  limitMb: number | null;
}): ResourcePressureLevel {
  if (
    input.memoryMb !== null &&
    input.limitMb !== null &&
    input.limitMb > 0
  ) {
    const percent = (input.memoryMb / input.limitMb) * 100;
    if (percent >= BROWSER_MEMORY_LIMIT_PRESSURE.high) return "high";
    if (percent >= BROWSER_MEMORY_LIMIT_PRESSURE.watch) return "watch";
    return "normal";
  }
  if (input.memoryMb === null) return "normal";
  if (input.memoryMb >= BROWSER_MEMORY_MB_FALLBACK_PRESSURE.high) {
    return "high";
  }
  if (input.memoryMb >= BROWSER_MEMORY_MB_FALLBACK_PRESSURE.watch) {
    return "watch";
  }
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

function optionExpirationKey(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function marketDateKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function marketClockMinutes(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  const hour = Number(part("hour"));
  const minute = Number(part("minute"));
  return Number.isFinite(hour) && Number.isFinite(minute)
    ? hour * 60 + minute
    : null;
}

function isMarketCloseOrLater(value = new Date()) {
  const minutes = marketClockMinutes(value);
  return minutes !== null && minutes >= 16 * 60;
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
  if (values.includes("warning")) {
    return "warning";
  }
  return "info";
}

function statusFromSeverity(severity: DiagnosticSeverity): DiagnosticStatus {
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

function diagnosticsDbPoolIsSaturated(): boolean {
  const stats = getPoolStats();
  return stats.totalWaiting > 0 || (stats.max > 0 && stats.active >= stats.max);
}

function compactDiagnosticRawValue(value: unknown, depth = 0): unknown {
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "string") {
    return value.length > DIAGNOSTIC_RAW_MAX_STRING_LENGTH
      ? `${value.slice(0, DIAGNOSTIC_RAW_MAX_STRING_LENGTH)}...`
      : value;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (depth >= DIAGNOSTIC_RAW_MAX_DEPTH) {
    return Array.isArray(value) ? { __truncated: "array-depth" } : { __truncated: "object-depth" };
  }
  if (Array.isArray(value)) {
    const items = value
      .slice(0, DIAGNOSTIC_RAW_MAX_ARRAY_ITEMS)
      .map((item) => compactDiagnosticRawValue(item, depth + 1));
    return value.length > DIAGNOSTIC_RAW_MAX_ARRAY_ITEMS
      ? [
          ...items,
          {
            __truncated: value.length - DIAGNOSTIC_RAW_MAX_ARRAY_ITEMS,
          },
        ]
      : items;
  }
  if (typeof value !== "object") {
    return null;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  const compact: JsonRecord = {};
  entries.slice(0, DIAGNOSTIC_RAW_MAX_OBJECT_KEYS).forEach(([key, item]) => {
    compact[key] = compactDiagnosticRawValue(item, depth + 1);
  });
  if (entries.length > DIAGNOSTIC_RAW_MAX_OBJECT_KEYS) {
    compact.__truncated = entries.length - DIAGNOSTIC_RAW_MAX_OBJECT_KEYS;
  }
  return compact;
}

function compactDiagnosticRaw(
  raw: unknown,
  severity: DiagnosticSeverity = "warning",
): JsonRecord {
  if (severity === "info") {
    return {};
  }
  return asJsonRecord(compactDiagnosticRawValue(raw));
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
    raw: compactDiagnosticRaw(row.raw, row.severity as DiagnosticSeverity),
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
    raw: compactDiagnosticRaw(row.raw, row.severity as DiagnosticSeverity),
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

function isLongLivedApiRequestMetric(sample: ApiRequestSample): boolean {
  return isLongLivedApiRequestUrl(sample.path);
}

function incrementApiContextCounter(
  map: Map<string, number>,
  value: string | null | undefined,
): void {
  if (!value) {
    return;
  }
  map.set(value, (map.get(value) ?? 0) + 1);
}

function topApiContextCounts(map: Map<string, number>): JsonRecord[] {
  return Array.from(map.entries())
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }
      return left[0].localeCompare(right[0]);
    })
    .slice(0, 5)
    .map(([value, count]) => ({ value, count }));
}

function dominantApiContextValue(map: Map<string, number>): string | null {
  return (topApiContextCounts(map)[0]?.["value"] as string | undefined) ?? null;
}

function apiPriorityRange(values: number[]): JsonRecord | null {
  if (!values.length) {
    return null;
  }
  return {
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

function buildApiRouteStats(samples: ApiRequestSample[]): JsonRecord[] {
  const byPath = new Map<
    string,
    {
      count: number;
      errors: number;
      durations: number[];
      lastSeenAt: number;
      routeClass: string | null;
      requestFamilies: Map<string, number>;
      slowRequestFamilies: Map<string, number>;
      requestOrigins: Map<string, number>;
      clientRoles: Map<string, number>;
      fetchPriorities: number[];
      slowFetchPriorities: number[];
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
        routeClass: sample.routeClass ?? null,
        requestFamilies: new Map<string, number>(),
        slowRequestFamilies: new Map<string, number>(),
        requestOrigins: new Map<string, number>(),
        clientRoles: new Map<string, number>(),
        fetchPriorities: [],
        slowFetchPriorities: [],
      };
    const slow = sample.durationMs >= SLOW_API_ROUTE_MS;
    current.count += 1;
    current.errors += sample.statusCode >= 500 ? 1 : 0;
    current.durations.push(sample.durationMs);
    current.lastSeenAt = Math.max(current.lastSeenAt, sample.recordedAt);
    current.routeClass ??= sample.routeClass ?? null;
    incrementApiContextCounter(current.requestFamilies, sample.requestFamily);
    incrementApiContextCounter(current.requestOrigins, sample.requestOrigin);
    incrementApiContextCounter(current.clientRoles, sample.clientRole);
    if (typeof sample.fetchPriority === "number" && Number.isFinite(sample.fetchPriority)) {
      current.fetchPriorities.push(sample.fetchPriority);
    }
    if (slow) {
      incrementApiContextCounter(current.slowRequestFamilies, sample.requestFamily);
      if (typeof sample.fetchPriority === "number" && Number.isFinite(sample.fetchPriority)) {
        current.slowFetchPriorities.push(sample.fetchPriority);
      }
    }
    byPath.set(sample.path, current);
  });

  return Array.from(byPath.entries())
    .map(([path, value]) => {
      const p95LatencyMs = percentile(value.durations, 95);
      const maxLatencyMs =
        value.durations.length > 0 ? Math.max(...value.durations) : null;
      return {
        path,
        routeClass:
          value.routeClass ??
          classifyApiRoute({
            method: "GET",
            path,
          }),
        dominantRequestFamily: dominantApiContextValue(value.requestFamilies),
        dominantSlowRequestFamily: dominantApiContextValue(
          value.slowRequestFamilies,
        ),
        requestFamilies: topApiContextCounts(value.requestFamilies),
        slowRequestFamilies: topApiContextCounts(value.slowRequestFamilies),
        requestOrigins: topApiContextCounts(value.requestOrigins),
        clientRoles: topApiContextCounts(value.clientRoles),
        fetchPriorityRange: apiPriorityRange(value.fetchPriorities),
        slowFetchPriorityRange: apiPriorityRange(value.slowFetchPriorities),
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

function buildApiErrorRouteStats(samples: ApiRequestSample[]): JsonRecord[] {
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
    if (sample.statusCode >= 500) {
      current.errors += 1;
      current.durations.push(sample.durationMs);
      current.lastSeenAt = Math.max(current.lastSeenAt, sample.recordedAt);
    }
    byPath.set(sample.path, current);
  });

  return Array.from(byPath.entries())
    .filter(([, value]) => value.errors > 0)
    .map(([path, value]) => ({
      path,
      requestCount5m: value.count,
      errorCount5m: value.errors,
      p95ErrorLatencyMs: percentile(value.durations, 95),
      maxErrorLatencyMs:
        value.durations.length > 0 ? Math.max(...value.durations) : null,
      lastErrorAt: new Date(value.lastSeenAt).toISOString(),
    }))
    .sort((left, right) => {
      const rightErrors = numeric(right["errorCount5m"]) ?? 0;
      const leftErrors = numeric(left["errorCount5m"]) ?? 0;
      if (rightErrors !== leftErrors) {
        return rightErrors - leftErrors;
      }
      const rightP95 = numeric(right["p95ErrorLatencyMs"]) ?? 0;
      const leftP95 = numeric(left["p95ErrorLatencyMs"]) ?? 0;
      return rightP95 - leftP95;
    })
    .slice(0, 8);
}

function buildApiMetrics(runtime: JsonRecord): JsonRecord {
  const samples = getRecentRequestSamples();
  const latencySamples = samples.filter(
    (sample) => !isLongLivedApiRequestMetric(sample),
  );
  const durations = latencySamples.map((sample) => sample.durationMs);
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
  const latencyAlertReady =
    latencySamples.length >= API_LATENCY_ALERT_MIN_SAMPLES;
  const slowRoutes = buildApiRouteStats(latencySamples);
  const errorRoutes = buildApiErrorRouteStats(samples);
  const dominantSlowRoute = slowRoutes.find(
    (route) => (numeric(route["p95LatencyMs"]) ?? 0) >= SLOW_API_ROUTE_MS,
  );
  const dominantSlowRoutePressure = slowRoutes.find(
    (route) =>
      route["routeClass"] !== "decorative" &&
      (numeric(route["p95LatencyMs"]) ?? 0) >= SLOW_API_ROUTE_MS &&
      (numeric(route["slowCount5m"]) ?? 0) >= API_ROUTE_PRESSURE_MIN_SLOW_COUNT,
  );
  const dominantErrorRoute = errorRoutes[0] ?? null;
  return {
    requestCount5m: samples.length,
    latencySampleCount5m: latencySamples.length,
    longLivedRequestCount5m: samples.length - latencySamples.length,
    errorCount5m: errors,
    warningCount5m: warnings,
    p50LatencyMs,
    p95LatencyMs,
    p95_latency_ms: latencyAlertReady ? p95LatencyMs : null,
    rawP95LatencyMs: p95LatencyMs,
    latencyAlertMinSamples: API_LATENCY_ALERT_MIN_SAMPLES,
    p99LatencyMs,
    slowRouteCount5m: latencySamples.filter(
      (sample) => sample.durationMs >= SLOW_API_ROUTE_MS,
    ).length,
    slowRoutes,
    errorRoutes,
    dominantSlowRoute: dominantSlowRoute?.["path"] ?? null,
    dominantSlowRouteP95Ms: dominantSlowRoute?.["p95LatencyMs"] ?? null,
    dominantSlowRoutePressureP95Ms:
      dominantSlowRoutePressure?.["p95LatencyMs"] ?? null,
    dominantSlowRoutePressureSlowCount5m:
      dominantSlowRoutePressure?.["slowCount5m"] ?? null,
    routePressureMinSlowCount5m: API_ROUTE_PRESSURE_MIN_SLOW_COUNT,
    dominantErrorRoute: dominantErrorRoute?.["path"] ?? null,
    dominantErrorRouteCount: dominantErrorRoute?.["errorCount5m"] ?? null,
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
    eventLoopUtilization: numeric(apiRuntime["eventLoopUtilization"]),
    activeDiagnosticsClients: subscribers.size,
  };
}

function classifyApiSnapshot(metrics: JsonRecord): DiagnosticSeverity {
  const p95 = numeric(metrics["p95LatencyMs"]) ?? 0;
  const errors = numeric(metrics["errorCount5m"]) ?? 0;
  const latencySampleCount =
    numeric(metrics["latencySampleCount5m"]) ??
    numeric(metrics["requestCount5m"]) ??
    0;
  const latencyAlertReady =
    latencySampleCount >= API_LATENCY_ALERT_MIN_SAMPLES;
  if ((latencyAlertReady && p95 >= API_LATENCY_WARNING_MS) || errors > 0) {
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
      severity: "warning",
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
  const providers = asJsonRecord(runtime["providers"]);
  const massiveProvider = asJsonRecord(providers["massive"]);
  const massiveWebSocket = asJsonRecord(massiveProvider["websocket"]);
  const ibkrStreamState = textValue(ibkr["streamState"]);
  const ibkrStreamStateReason = textValue(ibkr["streamStateReason"]);
  const massiveWebSocketStatus = textValue(massiveWebSocket["status"]);
  const massiveSubscribedSymbolCount =
    numeric(massiveWebSocket["subscribedSymbolCount"]) ?? 0;
  const massiveActiveConsumerCount =
    numeric(massiveWebSocket["activeConsumerCount"]) ?? 0;
  const massiveEventCount = numeric(massiveWebSocket["eventCount"]) ?? 0;
  const massiveReconnectCount = numeric(massiveWebSocket["reconnectCount"]) ?? 0;
  const massiveTransportAgeMs = numeric(
    massiveWebSocket["lastSocketMessageAgeMs"],
  );
  const massiveDataAgeMs = numeric(massiveWebSocket["lastMessageAgeMs"]);
  const massiveLastError = textValue(massiveWebSocket["lastError"]);
  const massiveStreamActive =
    Boolean(massiveProvider["configured"]) &&
    (massiveWebSocketStatus === "ok" ||
      massiveSubscribedSymbolCount > 0 ||
      massiveActiveConsumerCount > 0);
  const streamState = massiveStreamActive
    ? massiveLastError
      ? "reconnecting"
      : "live"
    : ibkrStreamState;
  const streamStateReason = massiveStreamActive
    ? massiveEventCount > 0
      ? "massive_stock_stream_active"
      : "massive_stock_stream_subscribed"
    : ibkrStreamStateReason;
  const bridgeActiveConsumerCount =
    numeric(marketData["activeConsumerCount"]) ?? 0;
  const activeConsumerCount =
    bridgeActiveConsumerCount + massiveActiveConsumerCount;
  const unionSymbolCount = Math.max(
    numeric(marketData["unionSymbolCount"]) ?? 0,
    massiveSubscribedSymbolCount,
  );
  const cachedQuoteCount = numeric(marketData["cachedQuoteCount"]) ?? 0;
  const eventCount = (numeric(marketData["eventCount"]) ?? 0) + massiveEventCount;
  const reconnectCount = Math.max(
    numeric(marketData["reconnectCount"]) ?? 0,
    massiveReconnectCount,
  );
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
  const transportFreshnessAgeMs = minFiniteNumber(
    numeric(marketData["transportFreshnessAgeMs"]),
    massiveTransportAgeMs,
  );
  const dataFreshnessAgeMs =
    minFiniteNumber(numeric(marketData["dataFreshnessAgeMs"]), massiveDataAgeMs) ??
    lastEventAgeMs;
  const freshnessAgeMs =
    transportFreshnessAgeMs ??
    numeric(marketData["freshnessAgeMs"]) ??
    lastEventAgeMs;
  const streamCurrentlyFresh =
    streamState === "live" &&
    freshnessAgeMs !== null &&
    freshnessAgeMs < 2_000;
  const massiveSubscribedWithoutEvents =
    massiveStreamActive && massiveEventCount === 0 && !massiveLastError;
  const currentLastError = streamCurrentlyFresh
    ? null
    : (massiveLastError ?? textValue(marketData["lastError"]));
  const thresholdFreshnessAgeMs =
    streamState === "quiet" || massiveSubscribedWithoutEvents
      ? null
      : freshnessAgeMs;
  const thresholdMaxGapMs =
    streamState === "quiet" ||
    streamCurrentlyFresh ||
    massiveSubscribedWithoutEvents
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
    streamActive:
      booleanValue(marketData["streamActive"]) || massiveStreamActive,
    reconnectScheduled: booleanValue(marketData["reconnectScheduled"]),
    pressure: textValue(marketData["pressure"]),
    lastError: currentLastError,
    rawLastError: massiveLastError ?? textValue(marketData["lastError"]),
    lastErrorAt: massiveWebSocket["lastErrorAt"] ?? marketData["lastErrorAt"] ?? null,
    massiveActiveConsumerCount,
    massiveSubscribedSymbolCount,
    massiveWebSocketStatus,
    massiveLastSocketMessageAgeMs: massiveTransportAgeMs,
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
    metrics["streamStateReason"] === "massive_stock_stream_subscribed" &&
    !metrics["lastError"]
  ) {
    return "info";
  }

  if (
    metrics["lastError"] ||
    (freshnessAgeMs !== null && freshnessAgeMs >= 10_000) ||
    (maxGapMs !== null && maxGapMs >= 30_000)
  ) {
    return "warning";
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
  const lastEvent = recentBrowserEvents.sort(
    (left, right) => Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt),
  )[0];

  return {
    eventCount5m: recentBrowserEvents.length,
    warningCount5m: warningCount,
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
    return "warning";
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
      severity: payloadShapeErrors >= 5 ? "warning" : "warning",
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
      severity: cursorFallbackCount >= 10 ? "warning" : "warning",
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
      severity: prependP95Ms >= 4_000 ? "warning" : "warning",
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
      severity: duplicateOlderPageCount >= 10 ? "warning" : "warning",
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

function buildIbkrDiagnosticEvents(
  ibkrRaw: JsonRecord,
  metrics: JsonRecord,
): DiagnosticEventInput[] {
  const events: DiagnosticEventInput[] = [];
  // The IBKR desktop bridge is retired by design (platform.ts hard-codes
  // bridgeRuntimeStatus:"retired"), so every branch below would fire a
  // vestigial warning (ibkr_bridge_required, health-stale, …) every 15s
  // forever. No consumer keys on these codes; emit nothing when retired.
  if (textValue(ibkrRaw["bridgeRuntimeStatus"]) === "retired") {
    return events;
  }
  const configured = booleanValue(metrics["configured"]);
  const bridgeUrlConfigured = booleanValue(ibkrRaw["bridgeUrlConfigured"]);
  const bridgeTokenConfigured = booleanValue(ibkrRaw["bridgeTokenConfigured"]);
  const desktopAgentOnline = booleanValue(ibkrRaw["desktopAgentOnline"]);
  const bridgeRuntimeReason = textValue(ibkrRaw["bridgeRuntimeReason"]);
  const reachable = booleanValue(metrics["reachable"]);
  const connected = booleanValue(metrics["connected"]);
  const connectivityUp = booleanValue(metrics["connectivityUp"]);
  const authenticated = booleanValue(metrics["authenticated"]);
  const competing = booleanValue(metrics["competing"]);
  const healthError = textValue(ibkrRaw["healthError"]);
  const healthErrorDetail = textValue(ibkrRaw["healthErrorDetail"]);
  const healthErrorCode = textValue(ibkrRaw["healthErrorCode"]);
  const healthErrorStatusCode = numeric(ibkrRaw["healthErrorStatusCode"]);
  const runtimeLastError = textValue(ibkrRaw["lastError"]);
  const recoveryError = textValue(ibkrRaw["lastRecoveryError"]);
  const liveMarketDataAvailable = ibkrRaw["liveMarketDataAvailable"];
  const marketDataMode = textValue(ibkrRaw["marketDataMode"]);
  const healthFresh = booleanValue(ibkrRaw["healthFresh"]);
  const streamFresh = booleanValue(ibkrRaw["streamFresh"]);
  const streamState = textValue(ibkrRaw["streamState"]);
  const strictReady = booleanValue(ibkrRaw["strictReady"]);
  const strictReason = textValue(ibkrRaw["strictReason"]);

  if (!bridgeUrlConfigured && desktopAgentOnline) {
    events.push({
      subsystem: "ibkr",
      category: "bridge-runtime",
      code: bridgeRuntimeReason ?? "ibkr_bridge_runtime_unattached",
      severity: "warning",
      message:
        "IBKR desktop agent is online, but the bridge runtime URL is not attached yet.",
      raw: ibkrRaw,
    });
  } else if (!bridgeUrlConfigured || !configured) {
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
      healthBackoff && runtimeLastError ? runtimeLastError : healthError;
    const diagnosticHealthDetail =
      healthBackoff && runtimeLastError
        ? runtimeLastError
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
      severity: "warning",
      message: staleTunnel
        ? compactErrorMessage(
            "IB Gateway bridge tunnel is stale or unreachable",
            diagnosticHealthDetail ?? diagnosticHealthMessage,
          )
        : compactErrorMessage(healthError, healthErrorDetail),
      dimensions:
        healthBackoff && runtimeLastError
          ? {
              healthError,
              healthErrorCode,
              healthErrorDetail,
            }
          : undefined,
      raw: ibkrRaw,
    });
  }

  if (configured && reachable && !connected && !connectivityUp) {
    events.push({
      subsystem: "ibkr",
      category: "gateway-socket",
      code: "ibkr_gateway_socket_disconnected",
      severity: "warning",
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
      severity: "warning",
      message: "IB Gateway bridge is connected, but the broker session is not authenticated.",
      raw: ibkrRaw,
    });
  }

  if (competing) {
    events.push({
      subsystem: "ibkr",
      category: "competing-session",
      code: "10197",
      severity: "warning",
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
  const configured =
    Boolean(ibkr["configured"]) || Boolean(ibkr["desktopAgentOnline"]);
  const lastTickleAt = configured ? timestampMs(ibkr["lastTickleAt"]) : null;
  const strictReason =
    textValue(ibkr["strictReason"]) ??
    textValue(ibkr["bridgeRuntimeReason"]) ??
    null;
  const rawConnectivityUp =
    typeof ibkr["connectivityUp"] === "boolean"
      ? Boolean(ibkr["connectivityUp"])
      : null;
  const connected = configured
    ? rawConnectivityUp ?? Boolean(ibkr["connected"])
    : false;
  const heartbeatAgeMs =
    lastTickleAt === null ? null : Math.max(0, Date.now() - lastTickleAt);
  return {
    configured,
    reachable: configured ? Boolean(ibkr["reachable"]) : false,
    connected,
    connectivityUp: connected,
    connectivityReason: configured ? textValue(ibkr["connectivityReason"]) : null,
    lastTickleAgeMs: configured ? numeric(ibkr["lastTickleAgeMs"]) : null,
    authenticated: configured ? Boolean(ibkr["authenticated"]) : false,
    competing: configured ? Boolean(ibkr["competing"]) : false,
    heartbeatAgeMs,
    accountCount: configured ? numeric(ibkr["accountCount"]) ?? 0 : 0,
    marketDataMode: configured ? ibkr["marketDataMode"] ?? null : null,
    liveMarketDataAvailable: configured
      ? ibkr["liveMarketDataAvailable"] ?? null
      : null,
    healthFresh: configured ? ibkr["healthFresh"] ?? null : false,
    healthAgeMs: configured ? numeric(ibkr["healthAgeMs"]) : null,
    streamFresh: configured ? ibkr["streamFresh"] ?? null : false,
    streamState: configured ? ibkr["streamState"] ?? null : "offline",
    streamStateReason: configured
      ? ibkr["streamStateReason"] ?? null
      : "bridge_not_configured",
    lastStreamEventAgeMs: configured
      ? numeric(ibkr["lastStreamEventAgeMs"])
      : null,
    strictReady: configured ? ibkr["strictReady"] ?? null : false,
    strictReason: configured ? strictReason : "ibkr_bridge_not_configured",
    lastRecoveryAttemptAt: configured
      ? ibkr["lastRecoveryAttemptAt"] ?? null
      : null,
    lastRecoveryError: configured ? ibkr["lastRecoveryError"] ?? null : null,
  };
}

function classifyIbkrSnapshot(metrics: JsonRecord): DiagnosticSeverity {
  if (!metrics["configured"]) {
    return "warning";
  }
  if (
    metrics["connectivityUp"] !== true &&
    (!metrics["reachable"] || !metrics["connected"])
  ) {
    return "warning";
  }
  if (!metrics["authenticated"] || metrics["competing"]) {
    return "warning";
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
  if (metrics["streamFresh"] === true && metrics["strictReady"] === true) {
    return "info";
  }
  const heartbeatAgeMs = numeric(metrics["heartbeatAgeMs"]);
  if (heartbeatAgeMs !== null && heartbeatAgeMs >= 180_000) {
    return "warning";
  }
  if (heartbeatAgeMs !== null && heartbeatAgeMs >= 90_000) {
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
      positionProbeProvider: positionProbe["provider"] ?? null,
      positionProbeReason: positionProbe["reason"] ?? null,
      skippedLegacyBridgeProbe:
        positionProbe["skippedLegacyBridgeProbe"] === true,
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

const SIGNAL_OPTIONS_SCAN_STALE_WARNING_MS = 120_000;
let automationRecentEventsCache: CachedHeavyRead<AutomationRecentEventRow[]> | null =
  null;
let automationRecentEventsInFlight: Promise<AutomationRecentEventRow[]> | null =
  null;

async function readRecentAutomationEvents(
  recentSince: Date,
): Promise<AutomationRecentEventRow[]> {
  const now = Date.now();
  if (
    automationRecentEventsCache &&
    now - automationRecentEventsCache.cachedAt < DIAGNOSTICS_HEAVY_READ_CACHE_TTL_MS
  ) {
    return automationRecentEventsCache.value;
  }
  if (
    automationRecentEventsCache &&
    diagnosticsDbPoolIsSaturated() &&
    now - automationRecentEventsCache.cachedAt <
      DIAGNOSTICS_HEAVY_READ_STALE_TTL_MS
  ) {
    return automationRecentEventsCache.value;
  }
  if (automationRecentEventsInFlight) {
    return automationRecentEventsInFlight;
  }

  const request = safeDb(
    "list automation diagnostic events",
    async () =>
      db
        .select({
          eventType: executionEventsTable.eventType,
          payload: executionEventsTable.payload,
          occurredAt: executionEventsTable.occurredAt,
        })
        .from(executionEventsTable)
        .where(
          and(
            gte(executionEventsTable.occurredAt, recentSince),
            sql`${executionEventsTable.eventType} LIKE 'signal_options_%'`,
          ),
        )
        .orderBy(desc(executionEventsTable.occurredAt))
        .limit(1_000),
    automationRecentEventsCache?.value ?? [],
  ).then((rows) => {
    automationRecentEventsCache = { value: rows, cachedAt: Date.now() };
    return rows;
  });
  automationRecentEventsInFlight = request;
  try {
    return await request;
  } finally {
    if (automationRecentEventsInFlight === request) {
      automationRecentEventsInFlight = null;
    }
  }
}

async function buildAutomationMetrics(): Promise<{
  metrics: JsonRecord;
  raw: JsonRecord;
}> {
  const worker = getSignalOptionsWorkerSnapshot();
  const nowMs = Date.now();
  const recentSince = new Date(nowMs - 60 * 60 * 1000);
  const automationEvents = await readRecentAutomationEvents(recentSince);
  const automationDeployments = await safeDb(
    "list automation deployments",
    async () =>
      db
        .select({
          enabled: algoDeploymentsTable.enabled,
          config: algoDeploymentsTable.config,
        })
        .from(algoDeploymentsTable),
    [],
  );
  const signalOptionsDeploymentRows = automationDeployments.filter((deployment) => {
    const config = asJsonRecord(deployment.config);
    const parameters = asJsonRecord(config["parameters"]);
    return Boolean(config["signalOptions"]) || parameters["executionMode"] === "signal_options";
  });
  const signalOptionsDeploymentCount = signalOptionsDeploymentRows.length;
  const enabledSignalOptionsDeploymentCount = signalOptionsDeploymentRows.filter(
    (deployment) => deployment.enabled === true,
  ).length;
  const legacyEquityForwardEnabledCount = automationDeployments.filter((deployment) => {
    const config = asJsonRecord(deployment.config);
    const parameters = asJsonRecord(config["parameters"]);
    return (
      deployment.enabled === true &&
      parameters["executionMode"] === "signal_equity_shadow"
    );
  }).length;
  const openShadowOptionRows = await safeDb(
    "list open shadow option positions",
    async () =>
      db
        .select({
          optionContract: shadowPositionsTable.optionContract,
        })
        .from(shadowPositionsTable)
        .where(
          and(
            eq(shadowPositionsTable.accountId, "shadow"),
            eq(shadowPositionsTable.assetClass, "option"),
            eq(shadowPositionsTable.status, "open"),
          ),
        ),
    [],
  );
  const nowDate = new Date(nowMs);
  const todayMarketDate = marketDateKey(nowDate);
  const marketCloseReached = isMarketCloseOrLater(nowDate);
  const optionExpirationCounts = openShadowOptionRows.reduce(
    (counts, position) => {
      const expiration = optionExpirationKey(
        asJsonRecord(position.optionContract)["expirationDate"],
      );
      if (expiration === null) {
        return counts;
      }
      if (expiration < todayMarketDate) {
        counts.prior += 1;
        counts.due += 1;
      } else if (expiration === todayMarketDate) {
        counts.today += 1;
        if (marketCloseReached) {
          counts.due += 1;
        }
      }
      return counts;
    },
    { prior: 0, today: 0, due: 0 },
  );
  const expiringOpenShadowOptionCount =
    optionExpirationCounts.prior + optionExpirationCounts.today;
  const deployments = Array.isArray(worker.deployments)
    ? worker.deployments
    : [];
  const workerScanEnabled = worker.scanEnabled === true;
  const latestSuccessMs = deployments.reduce<number | null>(
    (latest, deployment) => {
      const time = timestampMs(asJsonRecord(deployment)["lastSuccessAt"]);
      return time === null ? latest : Math.max(latest ?? 0, time);
    },
    null,
  );
  const latestScanAgeMs =
    workerScanEnabled && latestSuccessMs !== null
      ? Math.max(0, nowMs - latestSuccessMs)
      : null;
  const staleScanCount = workerScanEnabled
    ? deployments.filter((deployment) => {
        const lastSuccessAt = timestampMs(asJsonRecord(deployment)["lastSuccessAt"]);
        return (
          lastSuccessAt === null ||
          nowMs - lastSuccessAt >= SIGNAL_OPTIONS_SCAN_STALE_WARNING_MS
        );
      }).length
    : 0;
  const inactiveStaleScanCount = workerScanEnabled
    ? deployments.filter((deployment) => {
        const record = asJsonRecord(deployment);
        const currentScanAgeMs = numeric(record["currentScanAgeMs"]);
        const lastSuccessAt = timestampMs(record["lastSuccessAt"]);
        return (
          currentScanAgeMs === null &&
          (lastSuccessAt === null ||
            nowMs - lastSuccessAt >= SIGNAL_OPTIONS_SCAN_STALE_WARNING_MS)
        );
      }).length
    : 0;
  const activeScanAges = deployments
    .map((deployment) => numeric(asJsonRecord(deployment)["currentScanAgeMs"]))
    .filter((value): value is number => value !== null);
  const activeLongScanCount = activeScanAges.filter(
    (ageMs) => workerScanEnabled && ageMs >= SIGNAL_OPTIONS_SCAN_STALE_WARNING_MS,
  ).length;
  const activeMaxScanAgeMs =
    activeScanAges.length > 0 ? Math.max(...activeScanAges) : null;
  const skippedScanCount = deployments.reduce(
    (sum, deployment) =>
      sum + (numeric(asJsonRecord(deployment)["skippedScanCount"]) ?? 0),
    0,
  );
  const latestSkippedAt =
    deployments
      .map((deployment) => timestampMs(asJsonRecord(deployment)["lastSkippedAt"]))
      .filter((value): value is number => value !== null)
      .sort((left, right) => right - left)[0] ?? null;
  const lastSkipReason =
    deployments
      .map((deployment) => textValue(asJsonRecord(deployment)["lastSkipReason"]))
      .find(Boolean) ?? null;
  const lastScanDurationMs =
    deployments
      .map((deployment) =>
        numeric(asJsonRecord(deployment)["lastScanDurationMs"]),
      )
      .filter((value): value is number => value !== null)
      .sort((left, right) => right - left)[0] ?? null;
  const latestSuccessAtMs = latestSuccessMs;
  const gatewayBlockedEvents = automationEvents.filter(
    (event) => event.eventType === SIGNAL_OPTIONS_GATEWAY_BLOCKED_EVENT,
  );
  const gatewayBlockedCount = gatewayBlockedEvents.filter((event) => {
    const occurredAtMs = timestampMs(event.occurredAt);
    return (
      occurredAtMs !== null &&
      (latestSuccessAtMs === null || occurredAtMs > latestSuccessAtMs)
    );
  }).length;
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
  const totalFailureCount = deployments.reduce(
    (sum, deployment) =>
      sum +
      (numeric(asJsonRecord(deployment)["totalFailureCount"]) ??
        numeric(asJsonRecord(deployment)["failureCount"]) ??
        0),
    0,
  );
  const latestFailureAt =
    deployments
      .map((deployment) => timestampMs(asJsonRecord(deployment)["lastFailureAt"]))
      .filter((value): value is number => value !== null)
      .sort((left, right) => right - left)[0] ?? null;
  const latestError =
    deployments
      .map((deployment) => textValue(asJsonRecord(deployment)["lastError"]))
      .find(Boolean) ?? null;
  const signalCount = deployments.reduce(
    (sum, deployment) =>
      sum + (numeric(asJsonRecord(deployment)["lastSignalCount"]) ?? 0),
    0,
  );
  const freshSignalCount = deployments.reduce(
    (sum, deployment) =>
      sum + (numeric(asJsonRecord(deployment)["lastFreshSignalCount"]) ?? 0),
    0,
  );
  const staleSignalCount = deployments.reduce(
    (sum, deployment) =>
      sum + (numeric(asJsonRecord(deployment)["lastStaleSignalCount"]) ?? 0),
    0,
  );
  const unavailableSignalCount = deployments.reduce(
    (sum, deployment) =>
      sum +
      (numeric(asJsonRecord(deployment)["lastUnavailableSignalCount"]) ?? 0),
    0,
  );
  const notFreshSignalCount = Math.max(0, signalCount - freshSignalCount);
  const latestSignalBarAt =
    deployments
      .map((deployment) =>
        timestampMs(asJsonRecord(deployment)["lastLatestSignalBarAt"]),
      )
      .filter((value): value is number => value !== null)
      .sort((left, right) => right - left)[0] ?? null;
  const oldestSignalBarAt =
    deployments
      .map((deployment) =>
        timestampMs(asJsonRecord(deployment)["lastOldestSignalBarAt"]),
      )
      .filter((value): value is number => value !== null)
      .sort((left, right) => left - right)[0] ?? null;
  const maxSignalBarAgeMs =
    oldestSignalBarAt === null
      ? null
      : Math.max(0, nowMs - oldestSignalBarAt);
  const candidateCount = deployments.reduce(
    (sum, deployment) =>
      sum + (numeric(asJsonRecord(deployment)["lastCandidateCount"]) ?? 0),
    0,
  );
  const blockedCandidateCount = deployments.reduce(
    (sum, deployment) =>
      sum +
      (numeric(asJsonRecord(deployment)["lastBlockedCandidateCount"]) ?? 0),
    0,
  );
  const maintenance = asJsonRecord(worker.maintenance);
  const workerDeploymentCount = numeric(worker.deploymentCount) ?? deployments.length;
  const enabledDeploymentCount =
    enabledSignalOptionsDeploymentCount > 0
      ? enabledSignalOptionsDeploymentCount
      : workerDeploymentCount;
  const orphanOpenOptionCount =
    signalOptionsDeploymentCount === 0 ? openShadowOptionRows.length : 0;

  return {
    metrics: {
      workerRunning: worker.started === true,
      workerScanEnabled,
      tickRunning: worker.tickRunning === true,
      deploymentCount: workerDeploymentCount,
      signalOptionsDeploymentCount,
      enabledDeployments: enabledDeploymentCount,
      enabledSignalOptionsDeploymentCount,
      legacyEquityForwardEnabledCount,
      activeDeploymentCount: numeric(worker.activeDeploymentCount) ?? 0,
      openShadowOptionCount: openShadowOptionRows.length,
      orphanOpenOptionCount,
      expiringOpenShadowOptionCount,
      expiringTodayOpenShadowOptionCount: optionExpirationCounts.today,
      priorExpirationOpenShadowOptionCount: optionExpirationCounts.prior,
      expirationMaintenanceDueCount: optionExpirationCounts.due,
      expirationMaintenanceMarketCloseReached: marketCloseReached,
      maintenanceRunCount: numeric(maintenance["runCount"]) ?? 0,
      maintenanceClosedCount: numeric(maintenance["lastClosedCount"]) ?? 0,
      maintenanceTotalClosedCount: numeric(maintenance["totalClosedCount"]) ?? 0,
      maintenanceDueCount: numeric(maintenance["lastDueCount"]) ?? 0,
      maintenanceOrphanCount: numeric(maintenance["lastOrphanCount"]) ?? 0,
      maintenanceLastRunAt: textValue(maintenance["lastRunAt"]),
      maintenanceLastError: textValue(maintenance["lastError"]),
      latestScanAgeMs,
      latest_scan_age_ms: latestScanAgeMs,
      staleScanCount,
      inactiveStaleScanCount,
      activeLongScanCount,
      activeMaxScanAgeMs,
      skippedScanCount,
      lastSkippedAt:
        latestSkippedAt === null ? null : new Date(latestSkippedAt).toISOString(),
      lastSkipReason,
      lastScanDurationMs,
      gatewayBlockedCount,
      gateway_blocked_count: gatewayBlockedCount,
      activeGatewayBlockedCount: gatewayBlockedCount,
      totalGatewayBlockedCount: gatewayBlockedEvents.length,
      candidateSkipCount,
      dailyHaltCount,
      shadowExitCount,
      failureCount,
      failure_count: failureCount,
      consecutiveFailureCount: failureCount,
      totalFailureCount,
      lastFailureAt:
        latestFailureAt === null ? null : new Date(latestFailureAt).toISOString(),
      latestError,
      signalCount,
      freshSignalCount,
      notFreshSignalCount,
      staleSignalCount,
      unavailableSignalCount,
      latestSignalBarAt:
        latestSignalBarAt === null
          ? null
          : new Date(latestSignalBarAt).toISOString(),
      oldestSignalBarAt:
        oldestSignalBarAt === null
          ? null
          : new Date(oldestSignalBarAt).toISOString(),
      maxSignalBarAgeMs,
      candidateCount,
      blockedCandidateCount,
    },
    raw: {
      worker,
      signalOptionsDeploymentCount,
      legacyEquityForwardEnabledCount,
      openShadowOptionCount: openShadowOptionRows.length,
      expiringOpenShadowOptionCount,
      expiringTodayOpenShadowOptionCount: optionExpirationCounts.today,
      priorExpirationOpenShadowOptionCount: optionExpirationCounts.prior,
      expirationMaintenanceDueCount: optionExpirationCounts.due,
      expirationMaintenanceMarketCloseReached: marketCloseReached,
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
  const signalOptionsDeploymentCount =
    numeric(metrics["signalOptionsDeploymentCount"]) ?? enabledDeployments;
  const orphanOpenOptionCount = numeric(metrics["orphanOpenOptionCount"]) ?? 0;
  const expiringOpenShadowOptionCount =
    numeric(metrics["expiringOpenShadowOptionCount"]) ?? 0;
  const expirationMaintenanceDueCount =
    numeric(metrics["expirationMaintenanceDueCount"]) ??
    expiringOpenShadowOptionCount;
  const legacyEquityForwardEnabledCount =
    numeric(metrics["legacyEquityForwardEnabledCount"]) ?? 0;
  const latestScanAgeMs = numeric(metrics["latestScanAgeMs"]);
  const workerScanEnabled = metrics["workerScanEnabled"] === true;
  const gatewayBlockedCount = numeric(metrics["gatewayBlockedCount"]) ?? 0;
  const failureCount = numeric(metrics["failureCount"]) ?? 0;
  const staleScanCount = numeric(metrics["staleScanCount"]) ?? 0;
  const inactiveStaleScanCount =
    numeric(metrics["inactiveStaleScanCount"]) ?? staleScanCount;
  const activeLongScanCount = numeric(metrics["activeLongScanCount"]) ?? 0;
  const signalCount = numeric(metrics["signalCount"]) ?? 0;
  const staleSignalCount = numeric(metrics["staleSignalCount"]) ?? 0;
  const unavailableSignalCount = numeric(metrics["unavailableSignalCount"]) ?? 0;
  const degradedSignalInputCount = staleSignalCount + unavailableSignalCount;
  const degradedSignalInputRatio =
    signalCount > 0 ? degradedSignalInputCount / signalCount : 0;

  if (
    orphanOpenOptionCount > 0 ||
    (signalOptionsDeploymentCount === 0 && expirationMaintenanceDueCount > 0)
  ) {
    return "warning";
  }

  if (
    gatewayBlockedCount >= 3 ||
    failureCount >= 3 ||
    (workerScanEnabled &&
      activeLongScanCount === 0 &&
      enabledDeployments > 0 &&
      latestScanAgeMs !== null &&
      latestScanAgeMs >= SIGNAL_OPTIONS_SCAN_STALE_WARNING_MS)
  ) {
    return "warning";
  }

  if (
    workerScanEnabled &&
    enabledDeployments > 0 &&
    (metrics["workerRunning"] !== true ||
      inactiveStaleScanCount > 0 ||
      activeLongScanCount > 0 ||
      latestScanAgeMs === null ||
      latestScanAgeMs >= SIGNAL_OPTIONS_SCAN_STALE_WARNING_MS ||
      (signalCount > 0 &&
        degradedSignalInputCount > 0 &&
        degradedSignalInputRatio >= 0.1) ||
      gatewayBlockedCount > 0 ||
      failureCount > 0)
  ) {
    return "warning";
  }

  if (legacyEquityForwardEnabledCount > 0) {
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
  const mode =
    process.env["PYRUS_CROSS_ORIGIN_ISOLATION"] ??
    "report-only";
  const reportCount = reports.reduce((total, event) => total + event.eventCount, 0);
  const rawReportCount = rawReports.reduce(
    (total, event) => total + event.eventCount,
    0,
  );
  return {
    mode,
    crossOriginIsolated: isolation["crossOriginIsolated"] === true,
    coopMode:
      process.env["PYRUS_COOP_POLICY"] ??
      "same-origin",
    coepMode:
      process.env["PYRUS_COEP_POLICY"] ??
      "require-corp",
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
  if (reportCount >= 10) return "warning";
  if (reportCount > 0) return "warning";
  return "info";
}

function toResourcePressureLevel(
  value: unknown,
): ApiResourcePressureLevel | null {
  const normalized = textValue(value);
  if (normalized === "high" || normalized === "shed") return "high";
  if (normalized === "watch") return "watch";
  if (normalized === "normal") return "normal";
  return null;
}

function normalizeFooterPressureLevel(
  value: unknown,
): "normal" | "watch" | "high" {
  const normalized = textValue(value);
  if (normalized === "high" || normalized === "shed") return "high";
  if (normalized === "watch") return "watch";
  return "normal";
}

function sanitizeDominantDrivers(
  value: unknown,
  options: { memoryOnly?: boolean } = {},
): FooterMemoryPressureDriver[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const drivers = value.map((entry) => {
    const record = asJsonRecord(entry);
    return {
      kind: textValue(record["kind"]),
      label: textValue(record["label"]),
      level: textValue(record["level"]),
      detail: textValue(record["detail"]),
      score: numeric(record["score"]),
    };
  });

  return (options.memoryOnly
    ? drivers.filter((driver) =>
        driver.kind !== null && FOOTER_MEMORY_DRIVER_KINDS.has(driver.kind),
      )
    : drivers
  ).slice(0, 4);
}

function maxFooterPressureLevel(
  levels: unknown[],
): "normal" | "watch" | "high" {
  return levels.reduce<"normal" | "watch" | "high">(
    (current, next) => {
      const normalized = normalizeFooterPressureLevel(next);
      return maxPressureLevel([current, normalized]) as "normal" | "watch" | "high";
    },
    "normal",
  );
}

function buildResourcePressureMetrics(
  runtime: JsonRecord,
  automationMetrics: JsonRecord = {},
  readApiProcessMemoryUsage: () => Pick<NodeJS.MemoryUsage, "rss"> = () =>
    process.memoryUsage(),
): JsonRecord {
  const api = buildApiMetrics(runtime);
  const apiRssMb = mb(readApiProcessMemoryUsage().rss);
  const latest = latestClientMetric();
  const browserMemory = asJsonRecord(latest?.memory);
  const clientPressure = asJsonRecord(latest?.memoryPressure);
  const resourceCaches = asJsonRecord(asJsonRecord(runtime["api"])["resourceCaches"]);
  const heapUsedPercent = numeric(api["heapUsedPercent"]);
  // Gate heap pressure on heap as a fraction of the CONTAINER memory limit
  // (~16GB), not the ~2.7GB V8 heap ceiling that `heapUsedPercent` uses — a
  // healthy ~1.5GB working set reads ~55-80% of the V8 ceiling and would
  // errantly trip pressure while most of the container is free. RSS stays the
  // primary container-memory signal; this keeps heap from false-positiving and
  // leaves the V8-ceiling `heapUsedPercent` intact for display/GC observability.
  // When the cgroup limit is unreadable (cgroup-v1 / sandbox / local dev), fall
  // back to the always-available V8-ceiling percent so the heap signal is never
  // fully inert in those environments (prod reads the 16GB cgroup limit and uses
  // the de-flapped container-relative percent).
  const heapUsedMbValue = numeric(api["heapUsedMb"]);
  const containerMemoryLimitMb = getContainerMemoryLimitMb();
  const heapPressurePercent =
    heapUsedMbValue !== null &&
    containerMemoryLimitMb !== null &&
    containerMemoryLimitMb > 0
      ? roundMetric((heapUsedMbValue / containerMemoryLimitMb) * 100)
      : heapUsedPercent;
  const dbPool = getPoolStats();
  const apiRssThresholds = resolveApiRssPressureThresholds();
  const heapLevel = pressureLevelFromRatio(
    heapPressurePercent === null ? null : heapPressurePercent / 100,
  );
  const browserMemoryMb =
    numeric(browserMemory["bytes"]) !== null
      ? mb(numeric(browserMemory["bytes"])!)
      : numeric(browserMemory["usedJsHeapSize"]) !== null
        ? mb(numeric(browserMemory["usedJsHeapSize"])!)
        : null;
  const browserMemoryLimitMb =
    numeric(browserMemory["jsHeapSizeLimit"]) !== null
      ? mb(numeric(browserMemory["jsHeapSizeLimit"])!)
      : null;
  const browserMemoryLimitPercent =
    browserMemoryMb !== null &&
    browserMemoryLimitMb !== null &&
    browserMemoryLimitMb > 0
      ? Math.round((browserMemoryMb / browserMemoryLimitMb) * 1000) / 10
      : null;
  const browserLevel = browserMemoryPressureLevel({
    memoryMb: browserMemoryMb,
    limitMb: browserMemoryLimitMb,
  });
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
  const cacheLevel = maxPressureLevel(cacheLevels);
  const baseLevel = maxPressureLevel([
    heapLevel,
    browserLevel as ResourcePressureLevel,
    ...(clientLevel ? [clientLevel] : []),
    cacheLevel,
  ]);
  const resourcePressure = updateApiResourcePressure({
    // Sample the API process at the pressure-update point. `runtime` was
    // captured before the collector's async probes and can be minutes stale
    // when a loaded collector skips overlapping 15-second ticks.
    rssMb: apiRssMb,
    apiHeapUsedPercent: heapPressurePercent,
    apiP95LatencyMs: numeric(api["rawP95LatencyMs"]),
    dominantSlowRouteP95Ms: numeric(api["dominantSlowRoutePressureP95Ms"]),
    eventLoopDelayP95Ms: numeric(api["eventLoopP95Ms"]),
    eventLoopUtilization: numeric(api["eventLoopUtilization"]),
    dbPoolActive: dbPool.active,
    dbPoolWaiting: dbPool.waiting,
    dbPoolMax: dbPool.max,
    clientLevel: clientLevel
      ? normalizeApiResourcePressureLevel(clientLevel)
      : null,
    cacheLevel: normalizeApiResourcePressureLevel(cacheLevel),
    automationActiveLongScanCount: numeric(
      automationMetrics["activeLongScanCount"],
    ),
  });
  const apiPressureLevel = resourcePressure.level;
  const level = maxPressureLevel([apiPressureLevel, baseLevel]);
  const browserMemoryDriver =
    browserLevel !== "normal"
      ? [
          {
            kind: "browser-memory",
            label: "Browser memory",
            level: browserLevel,
            detail:
              browserMemoryLimitMb !== null
                ? `${browserMemoryMb} MB / ${browserMemoryLimitMb} MB limit`
                : `${browserMemoryMb} MB`,
            score: browserMemoryLimitPercent ?? browserMemoryMb,
          },
        ]
      : [];
  const dominantDrivers = [
    ...sanitizeDominantDrivers(clientPressure["dominantDrivers"]),
    ...browserMemoryDriver,
    ...resourcePressure.drivers.map((entry) => ({
      kind: entry.kind,
      label: entry.label,
      level: entry.level,
      detail: entry.detail,
      score: entry.score,
    })),
  ].slice(0, 6);
  return {
    pressureLevel: level,
    effectivePressureLevel: level,
    apiPressureLevel,
    basePressureLevel: baseLevel,
    clientPressureLevel: normalizeFooterPressureLevel(clientPressure["level"]),
    clientPressureTrend: textValue(clientPressure["trend"]) ?? "steady",
    heapUsedPercent,
    heap_used_percent: heapUsedPercent,
    heapUsedMb: api["heapUsedMb"],
    heapLimitMb: api["heapLimitMb"],
    rssMb: apiRssMb,
    apiRssThresholds,
    eventLoopP95Ms: api["eventLoopP95Ms"],
    dbPoolActive: dbPool.active,
    dbPoolWaiting: dbPool.waiting,
    dbPoolTotalWaiting: dbPool.totalWaiting,
    dbPoolRawWaiting: dbPool.rawPoolWaiting,
    dbPoolAdmissionWaiting: dbPool.admissionWaiting,
    dbPoolMax: dbPool.max,
    dbPoolTotal: dbPool.total,
    dbPoolIdle: dbPool.idle,
    dbPoolActivePercent:
      dbPool.max > 0 ? roundMetric((dbPool.active / dbPool.max) * 100) : null,
    db_pool_waiting: dbPool.waiting,
    db_pool_total_waiting: dbPool.totalWaiting,
    db_pool_raw_waiting: dbPool.rawPoolWaiting,
    db_pool_admission_waiting: dbPool.admissionWaiting,
    db_pool_active_percent:
      dbPool.max > 0 ? roundMetric((dbPool.active / dbPool.max) * 100) : null,
    browserMemoryMb,
    browser_memory_mb: browserMemoryMb,
    browserMemoryLimitMb,
    browser_memory_limit_mb: browserMemoryLimitMb,
    browserMemoryLimitPercent,
    browser_memory_limit_percent: browserMemoryLimitPercent,
    browserMemoryConfidence: browserMemory["confidence"] ?? null,
    browserMemorySource: browserMemory["source"] ?? null,
    sourceQuality:
      textValue(clientPressure["sourceQuality"]) ??
      textValue(browserMemory["confidence"]),
    dominantDrivers,
    apiResourcePressure: resourcePressure,
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
      apiPressureLevel === "high"
        ? "Inspect pressure drivers and keep work running."
        : level === "high"
          ? "Inspect browser memory and workload drivers."
          : level === "watch"
            ? "Monitor growth while work continues."
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
  { table: "flow_events", column: "occurred_at" },
  { table: "flow_event_hydration_sessions", column: "window_to" },
  { table: "bar_cache", column: "starts_at" },
  { table: "quote_cache", column: "as_of" },
  { table: "diagnostic_snapshots", column: "observed_at" },
  { table: "diagnostic_events", column: "last_seen_at" },
  { table: "ticker_reference_cache", column: "fetched_at" },
] as const;

async function buildMonitoredStorageTableStats() {
  // One round trip for all monitored tables. The min/max bound column differs
  // per table, so those come from a union-all CTE built from the static list.
  const boundsSql = MONITORED_STORAGE_TABLES.map(
    (table) =>
      `select '${table.table}'::text as relname, min(${table.column}) as oldest_at, max(${table.column}) as newest_at from ${table.table}`,
  ).join(" union all ");
  const result = await pool.query<{
    relname: string;
    row_count: string;
    dead_row_count: string;
    total_bytes: string;
    oldest_at: Date | null;
    newest_at: Date | null;
  }>(
    `with bounds as (${boundsSql})
     select c.relname,
            coalesce(s.n_live_tup, 0)::text as row_count,
            coalesce(s.n_dead_tup, 0)::text as dead_row_count,
            coalesce(pg_total_relation_size(c.oid), 0)::text as total_bytes,
            b.oldest_at,
            b.newest_at
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       left join pg_stat_user_tables s on s.relid = c.oid
       left join bounds b on b.relname = c.relname
      where n.nspname = 'public'
        and c.relname = any($1)`,
    [MONITORED_STORAGE_TABLES.map((table) => table.table)],
  );
  const rowsByTable = new Map(result.rows.map((row) => [row.relname, row]));
  const stats: JsonRecord[] = [];
  for (const table of MONITORED_STORAGE_TABLES) {
    const row = rowsByTable.get(table.table);
    stats.push({
      table: table.table,
      rowEstimate: Number(row?.row_count ?? 0),
      deadRowEstimate: Number(row?.dead_row_count ?? 0),
      totalMb: roundMetric(Number(row?.total_bytes ?? 0) / 1024 / 1024),
      oldestAt: row?.oldest_at?.toISOString?.() ?? null,
      newestAt: row?.newest_at?.toISOString?.() ?? null,
    });
  }
  return stats;
}

async function buildDatabaseStorageStats(): Promise<JsonRecord> {
  const result = await pool.query<{ database_bytes: string }>(
    "select pg_database_size(current_database())::text as database_bytes",
  );
  const databaseMb =
    Number(result.rows[0]?.database_bytes ?? 0) / 1024 / 1024;
  const warningMb = Number.isFinite(STORAGE_WARNING_DATABASE_MB)
    ? STORAGE_WARNING_DATABASE_MB
    : 15360;
  return {
    databaseMb: roundMetric(databaseMb),
    warningDatabaseMb: warningMb,
    storagePressureLevel:
      databaseMb >= warningMb
        ? "warning"
        : "ok",
  };
}

let storageMetricsCache: CachedHeavyRead<JsonRecord> | null = null;
let storageMetricsInFlight: Promise<JsonRecord> | null = null;

async function buildStorageMetrics(): Promise<JsonRecord> {
  const health = await refreshStorageHealthSnapshot();
  if (!health.reachable) {
    return { ...health };
  }

  if (process.env["DIAGNOSTICS_SKIP_STORAGE_TABLE_STATS"] === "1") {
    return {
      ...health,
      snapshotRetentionDays: SNAPSHOT_RETENTION_DAYS,
      monitoredTables: [],
    };
  }

  const now = Date.now();
  if (
    storageMetricsCache &&
    now - storageMetricsCache.cachedAt < DIAGNOSTICS_HEAVY_READ_CACHE_TTL_MS
  ) {
    return { ...storageMetricsCache.value, storageStatsCacheStatus: "hit" };
  }
  if (
    storageMetricsCache &&
    diagnosticsDbPoolIsSaturated() &&
    now - storageMetricsCache.cachedAt < DIAGNOSTICS_HEAVY_READ_STALE_TTL_MS
  ) {
    return {
      ...storageMetricsCache.value,
      storageStatsCacheStatus: "stale",
      storageStatsCacheAgeMs: now - storageMetricsCache.cachedAt,
    };
  }
  if (storageMetricsInFlight) {
    return storageMetricsInFlight;
  }

  const request = (async () => {
  try {
    const [monitoredTables, databaseStats] = await Promise.all([
      buildMonitoredStorageTableStats(),
      buildDatabaseStorageStats(),
    ]);
    const metrics = {
      ...health,
      ...databaseStats,
      snapshotRetentionDays: SNAPSHOT_RETENTION_DAYS,
      monitoredTables,
      storageStatsCacheStatus: "miss",
    };
    storageMetricsCache = { value: metrics, cachedAt: Date.now() };
    return metrics;
  } catch (error) {
    warnDbFailure(error, "load monitored storage table stats");
    const degraded = markStorageHealthDegraded(
      "storage_table_stats_unavailable",
      error,
    );
    const fallback = {
      ...degraded,
      snapshotRetentionDays: SNAPSHOT_RETENTION_DAYS,
      monitoredTables: [],
      tableStatsError: summarizeTransientPostgresError(error),
    };
    if (storageMetricsCache) {
      return {
        ...storageMetricsCache.value,
        status: fallback.status,
        reason: fallback.reason,
        tableStatsError: fallback.tableStatsError,
        storageStatsCacheStatus: "stale",
        storageStatsCacheAgeMs: Date.now() - storageMetricsCache.cachedAt,
      };
    }
    return fallback;
  }
  })();
  storageMetricsInFlight = request;
  try {
    return await request;
  } finally {
    if (storageMetricsInFlight === request) {
      storageMetricsInFlight = null;
    }
  }
}

function classifyStorageSnapshot(metrics: JsonRecord): DiagnosticSeverity {
  const status = textValue(metrics["status"]);
  if (status === "ok") {
    const pressure = textValue(metrics["storagePressureLevel"]);
    if (pressure === "warning") {
      return "warning";
    }
    return "info";
  }
  if (status === "degraded") {
    return "warning";
  }
  return "warning";
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

function classifyRuntimeRecorderSnapshot(metrics: JsonRecord): DiagnosticSeverity {
  const classification = textValue(metrics["latestIncidentClassification"]);
  const longRunningTestProcessCount =
    numeric(metrics["workspaceLongRunningTestProcessCount"]) ?? 0;
  if (
    classification === "api-child-exit" ||
    classification === "web-child-exit" ||
    classification === "suspected-resource-pressure"
  ) {
    return "warning";
  }
  if (classification === "container-replaced" || longRunningTestProcessCount > 0) {
    return "warning";
  }
  return "info";
}

function runtimeRecorderSnapshotSummary(metrics: JsonRecord): string {
  const classification = textValue(metrics["latestIncidentClassification"]);
  const longRunningTestProcessCount =
    numeric(metrics["workspaceLongRunningTestProcessCount"]) ?? 0;
  if (!classification) {
    if (longRunningTestProcessCount > 0) {
      const suffix = longRunningTestProcessCount === 1 ? "" : "es";
      return `${longRunningTestProcessCount} long-running workspace test process${suffix} detected`;
    }
    return "Replit flight recorder is active";
  }
  return `Last Replit restart classified as ${classification}`;
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
    raw: compactDiagnosticRaw(raw, severity),
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
    [
      "deployment",
      "freshness",
      "gateway-readiness",
      "ledger-maintenance",
      "signal-freshness",
      "worker",
      "threshold",
    ].includes(event.category)
  ) {
    return true;
  }

  return event.subsystem === "storage" && event.category === "collector";
}

function diagnosticSnapshotRow(snapshot: DiagnosticSnapshotPayload) {
  const raw = compactDiagnosticRaw(snapshot.raw, snapshot.severity);
  return {
    observedAt: new Date(snapshot.observedAt),
    subsystem: snapshot.subsystem,
    status: snapshot.status,
    severity: snapshot.severity,
    summary: snapshot.summary,
    dimensions: snapshot.dimensions,
    metrics: snapshot.metrics,
    raw,
  };
}

async function persistSnapshots(
  snapshots: DiagnosticSnapshotPayload[],
): Promise<void> {
  if (!snapshots.length) {
    return;
  }
  await runInDbLane(
    "background",
    () =>
      safeDb(
        "insert diagnostic snapshots",
        async () => {
          await db
            .insert(diagnosticSnapshotsTable)
            .values(snapshots.map(diagnosticSnapshotRow));
        },
        undefined,
      ),
  );
}

async function upsertEvent(
  input: DiagnosticEventInput,
): Promise<DiagnosticEventPayload> {
  const now = nowIso();
  const key = incidentKey(input);
  const existing = memoryEvents.get(key);
  const existingOpen = existing?.status === "open";
  const countOccurrence =
    input.countOccurrence !== false || !existingOpen;
  const eventCount = existing
    ? countOccurrence
      ? existing.eventCount + 1
      : 1
    : 1;
  const shouldBroadcast =
    input.countOccurrence !== false ||
    !existingOpen ||
    existing?.severity !== input.severity;
  const raw =
    input.raw === undefined && existing
      ? existing.raw
      : compactDiagnosticRaw(input.raw ?? {}, input.severity);
  const payload: DiagnosticEventPayload = existing
    ? {
        ...existing,
        severity: input.severity,
        status: "open",
        message: input.message,
        lastSeenAt: now,
        eventCount,
        dimensions: input.dimensions ?? existing.dimensions,
        raw,
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
        raw,
      };
  memoryEvents.set(key, payload);
  trimMemoryEvents();

  // Under server saturation the diagnostics DB persist would otherwise pile
  // onto an already-exhausted Postgres pool (a write-storm feedback loop:
  // diagnostics writing to the DB because the DB is overloaded). The event is
  // already in the in-memory store (used by the SSE stream and latestPayload)
  // and is mirrored to the flight-recorder file here, so we never lose the
  // important diagnostic; we only defer the DB row while resourceLevel is high.
  if (getApiResourcePressureSnapshot().resourceLevel === "high") {
    appendRuntimeFlightRecorderEvent("diagnostic-event-db-persist-skipped", {
      incidentKey: key,
      subsystem: input.subsystem,
      category: input.category,
      code: input.code ?? null,
      severity: input.severity,
      status: payload.status,
      message: input.message,
      lastSeenAt: payload.lastSeenAt,
      eventCount: payload.eventCount,
      reason: "resource-pressure-high",
    });
    if (shouldBroadcast) {
      broadcast({ type: "event", payload });
    }
    return payload;
  }

  const nextSignature: PersistedDiagnosticEventSignature = {
    status: payload.status,
    severity: payload.severity,
    message: payload.message,
    lastSeenAtMs: Date.parse(payload.lastSeenAt),
  };
  if (
    !shouldPersistDiagnosticEventToDb(
      lastPersistedDiagnosticEventByKey.get(key),
      nextSignature,
      DIAGNOSTIC_EVENT_PERSIST_TOUCH_MS,
    )
  ) {
    if (shouldBroadcast) {
      broadcast({ type: "event", payload });
    }
    return payload;
  }

  await runInDbLane(
    "background",
    () =>
      safeDb(
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
              raw,
            })
            .onConflictDoUpdate({
              target: diagnosticEventsTable.incidentKey,
              set: {
                severity: input.severity,
                status: "open",
                message: input.message,
                lastSeenAt: new Date(payload.lastSeenAt),
                eventCount:
                  input.countOccurrence === false
                    ? sql`case when ${diagnosticEventsTable.status} = 'open' then 1 else ${diagnosticEventsTable.eventCount} + 1 end`
                    : sql`${diagnosticEventsTable.eventCount} + 1`,
                dimensions: input.dimensions ?? {},
                raw,
                updatedAt: new Date(),
              },
            });
        },
        undefined,
      ),
  );
  lastPersistedDiagnosticEventByKey.set(key, nextSignature);

  if (shouldBroadcast) {
    broadcast({ type: "event", payload });
  }
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
  // Drop the persisted "open" signature so a later reopen is never skipped as
  // "unchanged" and correctly flips the DB row back to open.
  lastPersistedDiagnosticEventByKey.delete(event.incidentKey);

  await runInDbLane(
    "background",
    () =>
      safeDb(
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
      ),
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

  const dbCandidates = await runInDbLane(
    "background",
    () =>
      safeDb(
        "list open diagnostic events for resolution",
        () =>
          db
            .select()
            .from(diagnosticEventsTable)
            .where(eq(diagnosticEventsTable.status, "open"))
            .limit(1_000),
        [],
      ),
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

  for (const event of candidatesByKey.values()) {
    await resolveEvent(event);
  }
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

function normalizeDiagnosticLimit(
  value: number | null | undefined,
  fallback: number,
  max: number,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(1, Math.min(max, Math.floor(value)))
    : fallback;
}

function resolveDiagnosticLimit(input: {
  requestedLimit?: number | null;
  fallback: number;
  max: number;
  cap:
    | "history"
    | "events"
    | "exportHistory"
    | "exportEvents";
}) {
  const requestedLimit = normalizeDiagnosticLimit(
    input.requestedLimit,
    input.fallback,
    input.max,
  );
  const pressureLevel = getApiResourcePressureSnapshot().resourceLevel;
  const pressureCap = DIAGNOSTIC_LIMIT_CAPS[pressureLevel][input.cap];
  const appliedLimit = Math.min(requestedLimit, pressureCap);
  return {
    limit: appliedLimit,
    info: {
      requestedLimit,
      appliedLimit,
      maxLimit: Math.min(input.max, pressureCap),
      absoluteMaxLimit: input.max,
      pressureLevel,
      pressureLimited: appliedLimit < requestedLimit,
    },
  };
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

let diagnosticThresholdOverrideRowsLoader: () => Promise<
  DiagnosticThresholdOverrideRow[]
> = async () =>
  await db
    .select({
      metricKey: diagnosticThresholdOverridesTable.metricKey,
      warning: diagnosticThresholdOverridesTable.warning,
      enabled: diagnosticThresholdOverridesTable.enabled,
      audible: diagnosticThresholdOverridesTable.audible,
    })
    .from(diagnosticThresholdOverridesTable);
let diagnosticThresholdOverridesCache: {
  expiresAt: number;
  value: Map<string, Partial<DiagnosticThreshold>>;
} | null = null;
let diagnosticThresholdOverridesInFlight: Promise<
  Map<string, Partial<DiagnosticThreshold>>
> | null = null;

function invalidateDiagnosticThresholdOverridesCache(): void {
  diagnosticThresholdOverridesCache = null;
}

function mapThresholdOverrideRows(
  rows: DiagnosticThresholdOverrideRow[],
): Map<string, Partial<DiagnosticThreshold>> {
  return new Map(
    rows.map((row) => [
      row.metricKey,
      {
        warning: row.warning ?? undefined,
        enabled: row.enabled,
        audible: row.audible,
      },
    ]),
  );
}

async function readThresholdOverridesFromStore(): Promise<
  Map<string, Partial<DiagnosticThreshold>>
> {
  const rows = await safeDb(
    "load diagnostic threshold overrides",
    diagnosticThresholdOverrideRowsLoader,
    [],
  );
  return mapThresholdOverrideRows(rows);
}

async function loadThresholdOverrides({
  forceRefresh = false,
}: {
  forceRefresh?: boolean;
} = {}): Promise<Map<string, Partial<DiagnosticThreshold>>> {
  const now = Date.now();
  if (
    !forceRefresh &&
    diagnosticThresholdOverridesCache &&
    diagnosticThresholdOverridesCache.expiresAt > now
  ) {
    return diagnosticThresholdOverridesCache.value;
  }

  if (!forceRefresh && diagnosticThresholdOverridesInFlight) {
    return diagnosticThresholdOverridesInFlight;
  }

  const request = readThresholdOverridesFromStore()
    .then((value) => {
      diagnosticThresholdOverridesCache = {
        value,
        expiresAt: Date.now() + DIAGNOSTIC_THRESHOLD_OVERRIDES_CACHE_TTL_MS,
      };
      return value;
    })
    .finally(() => {
      if (diagnosticThresholdOverridesInFlight === request) {
        diagnosticThresholdOverridesInFlight = null;
      }
    });
  diagnosticThresholdOverridesInFlight = request;
  return request;
}

async function evaluateThresholds(
  snapshots: DiagnosticSnapshotPayload[],
  suppressedMetricKeys = new Set<string>(),
): Promise<Set<string>> {
  const activeIncidentKeys = new Set<string>();
  const thresholds = await getDiagnosticThresholds();
  for (const snapshot of snapshots) {
    for (const threshold of thresholds) {
      if (
        !threshold.enabled ||
        threshold.subsystem !== snapshot.subsystem ||
        suppressedMetricKeys.has(threshold.metricKey)
      ) {
        continue;
      }
      const localKey = threshold.metricKey.split(".").at(-1);
      const value =
        numeric(snapshot.metrics[threshold.metricKey]) ??
        (localKey ? numeric(snapshot.metrics[localKey]) : null);
      if (value === null) {
        continue;
      }

      const severity = value >= threshold.warning ? "warning" : null;
      if (!severity) {
        continue;
      }

      const eventInput = {
        subsystem: threshold.subsystem,
        category: "threshold",
        code: threshold.metricKey,
        severity,
        message: `${threshold.label} ${value}${threshold.unit} breached ${severity} threshold`,
        dimensions: { metricKey: threshold.metricKey, unit: threshold.unit },
        raw: { threshold, value, snapshot },
        countOccurrence: false,
      } satisfies DiagnosticEventInput;
      const key = incidentKey(eventInput);
      const existing = memoryEvents.get(key);
      const shouldBroadcastThreshold =
        existing?.status !== "open" || existing.severity !== severity;
      activeIncidentKeys.add(key);
      await upsertEvent(eventInput);
      if (shouldBroadcastThreshold) {
        broadcast({
          type: "threshold-breach",
          payload: {
            threshold,
            value,
            severity,
            observedAt: snapshot.observedAt,
          },
        });
      }
    }
  }
  return activeIncidentKeys;
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
  const fallbackRssThresholds = resolveApiRssPressureThresholds();
  const resourceRssThresholds = asJsonRecord(resourceMetrics["apiRssThresholds"]);
  const dominantDrivers = sanitizeDominantDrivers(
    resourceMetrics["dominantDrivers"],
    { memoryOnly: true },
  );
  const level = maxFooterPressureLevel([
    resourceMetrics["clientPressureLevel"],
    ...dominantDrivers.map((driver) => driver.level),
  ]);

  return {
    observedAt:
      textValue(resourceMetrics["browserObservedAt"]) ??
      textValue(resourceMetrics["latestClientAt"]) ??
      null,
    level,
    trend: (textValue(resourceMetrics["clientPressureTrend"]) ??
      "steady") as "steady" | "rising" | "recovering",
    browserMemoryMb: numeric(resourceMetrics["browserMemoryMb"]),
    browserMemoryLimitMb: numeric(resourceMetrics["browserMemoryLimitMb"]),
    apiRssMb: numeric(resourceMetrics["rssMb"]),
    apiRssThresholds: {
      watch: numeric(resourceRssThresholds["watch"]) ?? fallbackRssThresholds.watch,
      high: numeric(resourceRssThresholds["high"]) ?? fallbackRssThresholds.high,
    },
    apiHeapUsedPercent: numeric(resourceMetrics["heapUsedPercent"]),
    sourceQuality: textValue(resourceMetrics["sourceQuality"]),
    dominantDrivers,
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
  // Client memory pressure is folded into the snapshot by the 15s diagnostic tick
  // (buildResourcePressureMetrics reads latestClientMetric() -> clientLevel), so we
  // do NOT re-run updateApiResourcePressure here. A clientLevel-only update at
  // client-POST cadence re-evaluates the resourceLevel hysteresis against the prior
  // tick's STALE dbPool/heap inputs, advancing the 2-sample counter far faster than
  // the intended ~30s and undoing the dbPool/heap de-flap. clientLevel only affects
  // the display `level` (capped at watch), so deferring it to the next tick is safe.
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
  const resourceMetrics = buildResourcePressureMetrics(
    runtime,
    automation.metrics,
  );
  const resourceSeverity = classifyResourcePressureSnapshot(resourceMetrics);
  const isolationMetrics = buildIsolationMetrics();
  const isolationSeverity = classifyIsolationSnapshot(isolationMetrics);
  const runtimeRecorder = getRuntimeFlightRecorderDiagnostics();
  const runtimeRecorderSeverity = classifyRuntimeRecorderSnapshot(
    runtimeRecorder.metrics,
  );
  const marketDataWorkPlan = asJsonRecord(runtime["marketDataWorkPlan"]);
  const marketDataRaw = {
    ...asJsonRecord(probes["marketData"]),
    massive: asJsonRecord(asJsonRecord(runtime["providers"])["massive"]),
    marketDataWorkPlan,
  };

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
      marketDataRaw,
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
      "runtime",
      runtimeRecorderSeverity,
      runtimeRecorderSnapshotSummary(runtimeRecorder.metrics),
      runtimeRecorder.metrics,
      runtimeRecorder.raw,
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
      accountFailures > 0 ? "warning" : "info",
      accountFailures > 0
        ? "Account or position read probe failed"
        : "Account and position read probes are healthy",
      probeMetrics.accounts,
      asJsonRecord(probes["accounts"]),
    ),
    buildSnapshot(
      "orders",
      orderFailures > 0 ? "warning" : orderReadDegraded ? "warning" : "info",
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
  const ibkrEvents = buildIbkrDiagnosticEvents(ibkrRaw, ibkrMetrics);
  activeEvents.push(...ibkrEvents);
  const staleTunnelEvent = ibkrEvents.find(
    (event) => event.code === "ibkr_bridge_stale_tunnel",
  );
  const staleTunnelRootCauseIncidentKey = staleTunnelEvent
    ? incidentKey(staleTunnelEvent)
    : null;
  const withBridgeRootCause = (dimensions: JsonRecord = {}): JsonRecord =>
    staleTunnelRootCauseIncidentKey
      ? {
          ...dimensions,
          dependencyBlocked: true,
          rootCauseIncidentKey: staleTunnelRootCauseIncidentKey,
          rootCauseCode: "ibkr_bridge_stale_tunnel",
        }
      : dimensions;
  const bridgeDependentSeverity = (
    defaultSeverity: DiagnosticSeverity,
  ): DiagnosticSeverity =>
    staleTunnelRootCauseIncidentKey && defaultSeverity === "warning"
      ? "warning"
      : defaultSeverity;
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
      severity: bridgeDependentSeverity("warning"),
      message: marketDataLastError,
      dimensions: withBridgeRootCause(),
      raw: asJsonRecord(probes["marketData"]),
    });
  }

  if (accountFailures > 0 || orderFailures > 0) {
    activeEvents.push({
      subsystem: orderFailures > 0 ? "orders" : "accounts",
      category: "visibility",
      code: "read_probe_failed",
      severity: bridgeDependentSeverity("warning"),
      message: "Read-only account/order diagnostics probe failed",
      dimensions: withBridgeRootCause(),
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
      dimensions: withBridgeRootCause(),
      raw: asJsonRecord(probes["orders"]),
    });
  }

  if (storageSeverity !== "info") {
    const status = textValue(storageMetrics["status"]) ?? "unavailable";
    const reason = textValue(storageMetrics["reason"]);
    const pressure = textValue(storageMetrics["storagePressureLevel"]);
    if (status === "ok" && (pressure === "warning" || pressure === "high")) {
      activeEvents.push({
        subsystem: "storage",
        category: "capacity",
        code: "postgres_storage_pressure",
        severity: storageSeverity,
        message: "Postgres storage usage is approaching the configured limit.",
        dimensions: {
          databaseMb: storageMetrics["databaseMb"] ?? null,
          warningDatabaseMb: storageMetrics["warningDatabaseMb"] ?? null,
        },
        raw: storageMetrics,
      });
    } else {
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
  }

  if ((numeric(automation.metrics["gatewayBlockedCount"]) ?? 0) > 0) {
    activeEvents.push({
      subsystem: "automation",
      category: "gateway-readiness",
      code: "signal_options_gateway_blocked",
      severity: bridgeDependentSeverity(
        (numeric(automation.metrics["gatewayBlockedCount"]) ?? 0) >= 3
          ? "warning"
          : "warning",
      ),
      message: "Signal-options scans are blocked by IB Gateway readiness.",
      dimensions: withBridgeRootCause({
        gatewayBlockedCount: automation.metrics["gatewayBlockedCount"],
      }),
      raw: automation.raw,
    });
  }

  if ((numeric(automation.metrics["failureCount"]) ?? 0) > 0) {
    activeEvents.push({
      subsystem: "automation",
      category: "worker",
      code: "signal_options_worker_failure",
      severity: bridgeDependentSeverity(
        (numeric(automation.metrics["failureCount"]) ?? 0) >= 3
          ? "warning"
          : "warning",
      ),
      message:
        textValue(automation.metrics["latestError"]) ??
        "Signal-options worker scans are failing.",
      dimensions: withBridgeRootCause({
        failureCount: automation.metrics["failureCount"],
      }),
      raw: automation.raw,
    });
  }

  const enabledAutomationDeployments =
    numeric(automation.metrics["enabledDeployments"]) ?? 0;
  const workerScanEnabled = automation.metrics["workerScanEnabled"] === true;
  const inactiveStaleScanCount =
    numeric(automation.metrics["inactiveStaleScanCount"]) ??
    numeric(automation.metrics["staleScanCount"]) ??
    0;
  const activeLongScanCount =
    numeric(automation.metrics["activeLongScanCount"]) ?? 0;

  if (
    workerScanEnabled &&
    enabledAutomationDeployments > 0 &&
    (automation.metrics["workerRunning"] !== true ||
      inactiveStaleScanCount > 0)
  ) {
    activeEvents.push({
      subsystem: "automation",
      category: "freshness",
      code: "signal_options_scan_stale",
      severity: bridgeDependentSeverity("warning"),
      message: "Signal-options worker scans are stale or the worker is stopped.",
      dimensions: withBridgeRootCause({
        staleScanCount: automation.metrics["staleScanCount"],
        inactiveStaleScanCount,
        latestScanAgeMs: automation.metrics["latestScanAgeMs"],
        workerRunning: automation.metrics["workerRunning"],
        tickRunning: automation.metrics["tickRunning"],
        activeDeploymentCount: automation.metrics["activeDeploymentCount"],
      }),
      raw: automation.raw,
    });
  }

  if (
    workerScanEnabled &&
    enabledAutomationDeployments > 0 &&
    activeLongScanCount > 0
  ) {
    activeEvents.push({
      subsystem: "automation",
      category: "worker",
      code: "signal_options_scan_long_running",
      severity: "warning",
      message:
        "Signal-options worker scan is still running past the freshness window.",
      dimensions: {
        activeLongScanCount,
        activeMaxScanAgeMs: automation.metrics["activeMaxScanAgeMs"],
        latestScanAgeMs: automation.metrics["latestScanAgeMs"],
        lastScanDurationMs: automation.metrics["lastScanDurationMs"],
      },
      raw: automation.raw,
    });
  }

  if (
    (numeric(automation.metrics["signalOptionsDeploymentCount"]) ?? 0) === 0 &&
    (numeric(automation.metrics["openShadowOptionCount"]) ?? 0) > 0
  ) {
    activeEvents.push({
      subsystem: "automation",
      category: "deployment",
      code: "signal_options_deployment_missing",
      severity: "warning",
      message:
        "Open shadow option positions exist, but no signal-options deployment is present to manage entries and exits.",
      dimensions: {
        openShadowOptionCount: automation.metrics["openShadowOptionCount"],
      },
      raw: automation.raw,
    });
  }

  if ((numeric(automation.metrics["orphanOpenOptionCount"]) ?? 0) > 0) {
    activeEvents.push({
      subsystem: "automation",
      category: "ledger-maintenance",
      code: "signal_options_orphan_shadow_options",
      severity: "warning",
      message:
        "Open shadow option positions are orphaned from their signal-options deployment.",
      dimensions: {
        orphanOpenOptionCount: automation.metrics["orphanOpenOptionCount"],
        maintenanceOrphanCount: automation.metrics["maintenanceOrphanCount"],
      },
      raw: automation.raw,
    });
  }

  const expirationMaintenanceDueCount =
    numeric(automation.metrics["expirationMaintenanceDueCount"]) ?? 0;
  const expiringTodayOpenShadowOptionCount =
    numeric(automation.metrics["expiringTodayOpenShadowOptionCount"]) ?? 0;

  if (expirationMaintenanceDueCount > 0) {
    activeEvents.push({
      subsystem: "automation",
      category: "ledger-maintenance",
      code: "shadow_option_expiry_pending",
      severity: "warning",
      message: "Open shadow option positions are due for expiration maintenance.",
      dimensions: {
        expirationMaintenanceDueCount,
        expiringOpenShadowOptionCount:
          automation.metrics["expiringOpenShadowOptionCount"],
        expiringTodayOpenShadowOptionCount,
        priorExpirationOpenShadowOptionCount:
          automation.metrics["priorExpirationOpenShadowOptionCount"],
        marketCloseReached:
          automation.metrics["expirationMaintenanceMarketCloseReached"],
        maintenanceLastRunAt: automation.metrics["maintenanceLastRunAt"],
        maintenanceClosedCount: automation.metrics["maintenanceClosedCount"],
        maintenanceLastError: automation.metrics["maintenanceLastError"],
      },
      raw: automation.raw,
    });
  } else if (expiringTodayOpenShadowOptionCount > 0) {
    activeEvents.push({
      subsystem: "automation",
      category: "ledger-maintenance",
      code: "shadow_option_expiring_today",
      severity: "warning",
      message:
        "Open shadow option positions expire today and are not due for maintenance until market close.",
      dimensions: {
        expiringTodayOpenShadowOptionCount,
        marketCloseReached:
          automation.metrics["expirationMaintenanceMarketCloseReached"],
        maintenanceLastRunAt: automation.metrics["maintenanceLastRunAt"],
      },
      raw: automation.raw,
    });
  }

  if ((numeric(automation.metrics["legacyEquityForwardEnabledCount"]) ?? 0) > 0) {
    activeEvents.push({
      subsystem: "automation",
      category: "deployment",
      code: "legacy_shadow_equity_forward_enabled",
      severity: "warning",
      message:
        "Legacy shadow equity-forward deployment is enabled; signal-options shadow automation is the supported worker path.",
      dimensions: {
        legacyEquityForwardEnabledCount:
          automation.metrics["legacyEquityForwardEnabledCount"],
      },
      raw: automation.raw,
    });
  }

  const signalCount = numeric(automation.metrics["signalCount"]) ?? 0;
  const freshSignalCount = numeric(automation.metrics["freshSignalCount"]) ?? 0;
  const notFreshSignalCount =
    numeric(automation.metrics["notFreshSignalCount"]) ?? 0;
  const staleSignalCount = numeric(automation.metrics["staleSignalCount"]) ?? 0;
  const unavailableSignalCount =
    numeric(automation.metrics["unavailableSignalCount"]) ?? 0;
  const degradedSignalInputCount = staleSignalCount + unavailableSignalCount;
  const degradedSignalInputRatio =
    signalCount > 0 ? degradedSignalInputCount / signalCount : 0;
  if (
    (numeric(automation.metrics["enabledDeployments"]) ?? 0) > 0 &&
    signalCount > 0 &&
    degradedSignalInputCount > 0 &&
    degradedSignalInputRatio >= 0.1
  ) {
    activeEvents.push({
      subsystem: "automation",
      category: "signal-freshness",
      code: "signal_options_signal_scan_degraded",
      severity: "warning",
      message:
        "Signal-options scans are completing with stale or unavailable signal inputs.",
      dimensions: {
        signalCount,
        freshSignalCount,
        notFreshSignalCount,
        staleSignalCount,
        unavailableSignalCount,
        latestSignalBarAt: automation.metrics["latestSignalBarAt"],
        oldestSignalBarAt: automation.metrics["oldestSignalBarAt"],
        maxSignalBarAgeMs: automation.metrics["maxSignalBarAgeMs"],
      },
      raw: automation.raw,
    });
  }

  for (const event of activeEvents) {
    activeIncidentKeys.add(incidentKey(event));
    await upsertEvent({ ...event, countOccurrence: false });
  }

  memorySnapshots.push(...snapshots);
  trimMemorySnapshots();
  await persistSnapshots(snapshots);
  const suppressedThresholdMetricKeys = new Set<string>();
  suppressedThresholdMetricKeys.add("api.heap_used_mb");
  if (staleTunnelRootCauseIncidentKey) {
    suppressedThresholdMetricKeys.add("automation.latest_scan_age_ms");
    suppressedThresholdMetricKeys.add("automation.gateway_blocked_count");
    suppressedThresholdMetricKeys.add("automation.failure_count");
  }
  if (numeric(resourceMetrics["browserMemoryLimitMb"]) !== null) {
    suppressedThresholdMetricKeys.add("resource_pressure.browser_memory_mb");
  }
  const activeThresholdKeys = await evaluateThresholds(
    snapshots,
    suppressedThresholdMetricKeys,
  );
  activeThresholdKeys.forEach((key) => activeIncidentKeys.add(key));
  await resolveInactiveCollectorEvents(activeIncidentKeys);
  if (
    shouldRunDiagnosticsRetentionCleanup(
      Date.now(),
      lastDiagnosticsRetentionCleanupAt,
      DIAGNOSTIC_RETENTION_CLEANUP_INTERVAL_MS,
    )
  ) {
    lastDiagnosticsRetentionCleanupAt = Date.now();
    await runInDbLane(
      "background",
      () =>
        safeDb(
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
        ),
    );
  }

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
    marketDataWorkPlan,
    footerMemoryPressure: buildFooterMemoryPressureSummary(resourceMetrics),
  };
  broadcast({ type: "snapshot", payload: latestPayload });
  return latestPayload;
}

export async function getDiagnosticThresholds({
  forceRefresh = false,
}: {
  forceRefresh?: boolean;
} = {}): Promise<DiagnosticThreshold[]> {
  const overrides = await loadThresholdOverrides({ forceRefresh });
  return DEFAULT_THRESHOLDS.map((threshold) => ({
    ...threshold,
    ...(overrides.get(threshold.metricKey) ?? {}),
  }));
}

export async function updateDiagnosticThresholds(
  overrides: Array<{
    metricKey: string;
    warning?: number | null;
    enabled?: boolean;
    audible?: boolean;
  }>,
): Promise<DiagnosticThreshold[]> {
  invalidateDiagnosticThresholdOverridesCache();
  const knownKeys = new Set(DEFAULT_THRESHOLDS.map((threshold) => threshold.metricKey));
  for (const override of overrides) {
    if (!knownKeys.has(override.metricKey)) {
      continue;
    }
    const warning =
      typeof override.warning === "number" && Number.isFinite(override.warning)
        ? override.warning
        : null;
    await safeDb(
      "update diagnostic threshold override",
      async () => {
        await db
          .insert(diagnosticThresholdOverridesTable)
          .values({
            metricKey: override.metricKey,
            warning,
            enabled: override.enabled ?? true,
            audible: override.audible ?? true,
          })
          .onConflictDoUpdate({
            target: diagnosticThresholdOverridesTable.metricKey,
            set: {
              warning,
              enabled: override.enabled ?? true,
              audible: override.audible ?? true,
              updatedAt: new Date(),
            },
          });
      },
      undefined,
    );
  }
  invalidateDiagnosticThresholdOverridesCache();
  return getDiagnosticThresholds({ forceRefresh: true });
}

export function __setDiagnosticThresholdOverrideRowsLoaderForTests(
  loader: () => Promise<DiagnosticThresholdOverrideRow[]>,
): () => void {
  const previous = diagnosticThresholdOverrideRowsLoader;
  diagnosticThresholdOverrideRowsLoader = loader;
  invalidateDiagnosticThresholdOverridesCache();
  diagnosticThresholdOverridesInFlight = null;
  return () => {
    diagnosticThresholdOverrideRowsLoader = previous;
    invalidateDiagnosticThresholdOverridesCache();
    diagnosticThresholdOverridesInFlight = null;
  };
}

export function __resetDiagnosticThresholdOverridesCacheForTests(): void {
  invalidateDiagnosticThresholdOverridesCache();
  diagnosticThresholdOverridesInFlight = null;
}

export async function listDiagnosticHistory(input: {
  from: Date;
  to: Date;
  subsystem?: string | null;
  limit?: number | null;
}) {
  const { limit, info: limits } = resolveDiagnosticLimit({
    requestedLimit: input.limit,
    fallback: DIAGNOSTIC_HISTORY_DEFAULT_LIMIT,
    max: DIAGNOSTIC_HISTORY_MAX_LIMIT,
    cap: "history",
  });
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
    limits,
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
  const { limit, info: limits } = resolveDiagnosticLimit({
    requestedLimit: input.limit,
    fallback: DIAGNOSTIC_EVENTS_DEFAULT_LIMIT,
    max: DIAGNOSTIC_EVENTS_MAX_LIMIT,
    cap: "events",
  });
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
    limits,
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
  snapshotLimit?: number | null;
  eventLimit?: number | null;
}) {
  const { limit: snapshotLimit, info: snapshotLimits } = resolveDiagnosticLimit({
    requestedLimit: input.snapshotLimit,
    fallback: DIAGNOSTIC_HISTORY_DEFAULT_LIMIT,
    max: DIAGNOSTIC_HISTORY_MAX_LIMIT,
    cap: "exportHistory",
  });
  const { limit: eventLimit, info: eventLimits } = resolveDiagnosticLimit({
    requestedLimit: input.eventLimit,
    fallback: DIAGNOSTIC_EVENTS_DEFAULT_LIMIT,
    max: DIAGNOSTIC_EVENTS_MAX_LIMIT,
    cap: "exportEvents",
  });
  const [history, events, thresholds] = await Promise.all([
    listDiagnosticHistory({ ...input, limit: snapshotLimit }),
    listDiagnosticEvents({ ...input, limit: eventLimit }),
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
    limits: {
      pressureLevel: snapshotLimits.pressureLevel,
      historyLimit: snapshotLimits.appliedLimit,
      eventLimit: eventLimits.appliedLimit,
      history: snapshotLimits,
      events: eventLimits,
    },
  };
}

const PRUNABLE_CACHE_TABLES: Record<string, { table: string; column: string }> = {
  flow_events: { table: "flow_events", column: "occurred_at" },
  flow_event_hydration_sessions: {
    table: "flow_event_hydration_sessions",
    column: "window_to",
  },
  bar_cache: { table: "bar_cache", column: "starts_at" },
  quote_cache: { table: "quote_cache", column: "as_of" },
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
    : ["bar_cache", "quote_cache"];
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

export const __diagnosticsInternalsForTests = {
  buildIbkrDiagnosticEvents,
  buildIbkrMetrics,
  buildResourcePressureMetrics,
  diagnosticsDbPoolIsSaturated,
  shouldPersistDiagnosticEventToDb,
  shouldRunDiagnosticsRetentionCleanup,
};

export function __resetDiagnosticsStateForTests(): void {
  memorySnapshots.splice(0, memorySnapshots.length);
  memoryEvents.clear();
  clientMetrics.splice(0, clientMetrics.length);
  latestPayload = null;
  lastPersistedDiagnosticEventByKey.clear();
  lastDiagnosticsRetentionCleanupAt = 0;
  automationRecentEventsCache = null;
  automationRecentEventsInFlight = null;
  storageMetricsCache = null;
  storageMetricsInFlight = null;
  diagnosticsCollectorInFlight = false;
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
    if (diagnosticsCollectorInFlight) {
      return;
    }
    diagnosticsCollectorInFlight = true;
    void Promise.resolve()
      .then(collect)
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
      })
      .finally(() => {
        diagnosticsCollectorInFlight = false;
      });
  };

  tick();
  collectorTimer = setInterval(tick, intervalMs);
  collectorTimer.unref?.();
}
