import {
  appendFile,
  appendFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import * as v8 from "node:v8";
import {
  getPoolStats,
  setPostgresPoolDiagnosticListener,
  type PostgresPoolDiagnosticEvent,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { isLongLivedApiRequestUrl } from "../lib/request-logging";
import type {
  DiagnosticEventPayload,
  DiagnosticSeverity,
} from "./diagnostics";
import {
  getApiResourcePressureSnapshot,
  resolveApiRssPressureThresholds,
} from "./resource-pressure";
import { getRecentRequestSamples } from "./request-metrics";

type JsonRecord = Record<string, unknown>;

type RuntimeIncident = JsonRecord & {
  incidentId?: string;
  classification?: string;
  confidence?: string;
  severity?: DiagnosticSeverity;
  message?: string;
  observedAt?: string;
};

const SCHEMA_VERSION = 1;
const HEARTBEAT_INTERVAL_MS = Number.parseInt(
  process.env["PYRUS_API_FLIGHT_RECORDER_INTERVAL_MS"] ?? "5000",
  10,
);
const MAX_IMPORTED_INCIDENT_IDS = 500;
const DEFAULT_TEST_PROCESS_MIN_AGE_MS = 30_000;
let heartbeatTimer: NodeJS.Timeout | null = null;
let processHandlersInstalled = false;
let dbDiagnosticsInstalled = false;

function nowIso(): string {
  return new Date().toISOString();
}

export function findRepoRoot(): string {
  const configured = process.env["PYRUS_REPO_ROOT"];
  if (configured) return path.resolve(configured);

  let current = process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(current, "package.json"), "utf8"));
      if (pkg?.name === "workspace" || pkg?.workspaces) {
        return current;
      }
    } catch {
      // Keep walking.
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return path.resolve(process.cwd(), "../..");
}

export function recorderDir(): string {
  return process.env["PYRUS_FLIGHT_RECORDER_DIR"]
    ? path.resolve(process.env["PYRUS_FLIGHT_RECORDER_DIR"])
    : path.join(findRepoRoot(), ".pyrus-runtime", "flight-recorder");
}

export function flightRecorderDateKey(iso = nowIso()): string {
  return iso.slice(0, 10);
}

function dateKey(iso = nowIso()): string {
  return flightRecorderDateKey(iso);
}

const ensuredDirs = new Set<string>();
function ensureDir(dirPath: string): void {
  if (ensuredDirs.has(dirPath)) return;
  mkdirSync(dirPath, { recursive: true });
  ensuredDirs.add(dirPath);
}

// JSONL appends are buffered in memory and flushed ASYNCHRONOUSLY so the hot
// diagnostic path (api-db-query-slow / api-db-pool-acquire-slow — up to ~1,100
// events/sec under DB pressure) never blocks the event loop on a synchronous
// fs write. A synchronous appendFileSync per event was a self-amplifying
// contributor to event-loop stalls: slow DB -> diagnostic event -> blocking
// write -> more stall -> more slow events. Buffered lines flush every
// FLUSH_INTERVAL_MS and synchronously on process exit/crash. Trade-off: a hard
// kill (SIGKILL) can lose up to one flush interval of buffered diagnostic lines
// — acceptable for the high-volume firehose; the 5s heartbeat (api-current.json,
// atomicWrite below) stays synchronous and captures pre-crash state.
const FLUSH_INTERVAL_MS = (() => {
  const raw = Number.parseInt(
    process.env["PYRUS_API_FLIGHT_RECORDER_FLUSH_MS"] ?? "1000",
    10,
  );
  return Number.isFinite(raw) && raw > 0 ? raw : 1000;
})();
// Memory backstop: if the disk stalls and a file's buffer grows past this, drop
// the oldest lines (counted) rather than grow unbounded.
const MAX_BUFFERED_LINES_PER_FILE = 100_000;
const jsonlBuffers = new Map<string, string[]>();
const flushInFlight = new Set<string>();
let flushTimer: NodeJS.Timeout | null = null;
let droppedJsonLineCount = 0;

function ensureFlushTimer(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    flushRuntimeFlightRecorderBuffers();
  }, FLUSH_INTERVAL_MS);
  flushTimer.unref?.();
}

export function appendFlightRecorderJsonLine(
  filePath: string,
  value: JsonRecord,
): void {
  let buffer = jsonlBuffers.get(filePath);
  if (!buffer) {
    buffer = [];
    jsonlBuffers.set(filePath, buffer);
  }
  buffer.push(`${JSON.stringify(value)}\n`);
  if (buffer.length > MAX_BUFFERED_LINES_PER_FILE) {
    const overflow = buffer.length - MAX_BUFFERED_LINES_PER_FILE;
    buffer.splice(0, overflow);
    droppedJsonLineCount += overflow;
  }
  ensureFlushTimer();
}

// Timer-driven async flush: one appendFile per file with all pending lines. A
// per-file in-flight guard prevents concurrent ASYNC writes to the same file
// from interleaving. On a transient write error the failed batch is re-queued
// oldest-first as INDIVIDUAL line elements (not one joined string) so the
// per-line cap still bounds memory — a single joined element would make the
// element-count cap ineffective and let a persistent disk error grow the buffer
// unbounded.
export function flushRuntimeFlightRecorderBuffers(): void {
  for (const [filePath, buffer] of jsonlBuffers) {
    if (buffer.length === 0 || flushInFlight.has(filePath)) continue;
    const lines = buffer.splice(0, buffer.length);
    flushInFlight.add(filePath);
    try {
      ensureDir(path.dirname(filePath));
    } catch {
      // appendFile below will surface any directory error.
    }
    appendFile(
      filePath,
      lines.join(""),
      { encoding: "utf8", mode: 0o600 },
      (error) => {
        flushInFlight.delete(filePath);
        if (!error) return;
        // The dir may have been removed at runtime; drop it from the memoized
        // set so the next flush recreates it (restores the pre-memoization
        // self-healing).
        ensuredDirs.delete(path.dirname(filePath));
        // Re-queue failed lines ahead of any newly-buffered ones, then re-apply
        // the per-line cap so a persistent write failure can't grow unbounded.
        const current = jsonlBuffers.get(filePath) ?? [];
        const merged = lines.concat(current);
        if (merged.length > MAX_BUFFERED_LINES_PER_FILE) {
          const overflow = merged.length - MAX_BUFFERED_LINES_PER_FILE;
          merged.splice(0, overflow);
          droppedJsonLineCount += overflow;
        }
        jsonlBuffers.set(filePath, merged);
      },
    );
  }
}

// Best-effort synchronous flush for process exit / crash handlers. Never throws.
// Note: this does NOT consult flushInFlight, so on a crash an async flush already
// dispatched for the same file may still be pending on the libuv threadpool; both
// use O_APPEND (no truncation/corruption), but their relative on-disk order isn't
// guaranteed and a not-yet-run async batch can be lost. Acceptable for a crash
// best-effort path — every line carries a timestamp for post-mortem reordering.
export function flushRuntimeFlightRecorderBuffersSync(): void {
  for (const [filePath, buffer] of jsonlBuffers) {
    if (buffer.length === 0) continue;
    const payload = buffer.splice(0, buffer.length).join("");
    try {
      ensureDir(path.dirname(filePath));
      appendFileSync(filePath, payload, { encoding: "utf8", mode: 0o600 });
    } catch {
      // Exit-path best-effort: nothing actionable if the final write fails.
    }
  }
}

function appendJsonLine(filePath: string, value: JsonRecord): void {
  appendFlightRecorderJsonLine(filePath, value);
}

export function atomicWriteFlightRecorderJson(
  filePath: string,
  value: unknown,
): void {
  ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  renameSync(tmpPath, filePath);
}

function atomicWriteJson(filePath: string, value: unknown): void {
  atomicWriteFlightRecorderJson(filePath, value);
}

export function atomicWriteFlightRecorderText(
  filePath: string,
  text: string,
): void {
  ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmpPath, text, { mode: 0o600 });
  renameSync(tmpPath, filePath);
}

function safeReadJson(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function readJsonl(filePath: string): JsonRecord[] {
  try {
    return readFileSync(filePath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as JsonRecord;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is JsonRecord => Boolean(entry));
  } catch {
    return [];
  }
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value == null) return fallback;
  return value !== "0" && value.toLowerCase() !== "false";
}

function positiveNumberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function safeReadText(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function safeReadLink(filePath: string): string | null {
  try {
    return readlinkSync(filePath);
  } catch {
    return null;
  }
}

function processAgeMs(pidDir: string, nowMs: number): number | null {
  try {
    const mtimeMs = statSync(pidDir).mtimeMs;
    return Number.isFinite(mtimeMs) ? Math.max(0, Math.round(nowMs - mtimeMs)) : null;
  } catch {
    return null;
  }
}

function isWorkspaceTestCommand(input: {
  cmdline: string;
  cwd: string | null;
  repoRoot: string;
}): boolean {
  const command = input.cmdline.replace(/\s+/g, " ").trim();
  if (!command) return false;
  const looksLikeTest =
    /\.test\.(?:cjs|js|jsx|mjs|ts|tsx)\b/.test(command) ||
    /\b--test\b/.test(command) ||
    /\bvitest\b/.test(command) ||
    /\bjest\b/.test(command);
  if (!looksLikeTest) return false;

  const repoRoot = path.resolve(input.repoRoot);
  const cwd = input.cwd ? path.resolve(input.cwd) : null;
  return Boolean(
    (cwd && (cwd === repoRoot || cwd.startsWith(`${repoRoot}${path.sep}`))) ||
      command.includes(repoRoot) ||
      command.includes("/workspace/") ||
      command.includes("artifacts/api-server") ||
      command.includes("artifacts/pyrus") ||
      command.includes("src/services/"),
  );
}

function getWorkspaceTestProcessDiagnostics(): {
  enabled: boolean;
  processes: JsonRecord[];
  count: number;
  longRunningCount: number;
  maxAgeMs: number | null;
} {
  const enabled = readBooleanEnv("PYRUS_RUNTIME_TEST_PROCESS_SCAN", true);
  if (!enabled) {
    return {
      enabled: false,
      processes: [],
      count: 0,
      longRunningCount: 0,
      maxAgeMs: null,
    };
  }

  const procRoot = path.resolve(
    process.env["PYRUS_RUNTIME_PROCESS_SCAN_DIR"] ?? "/proc",
  );
  const minAgeMs = positiveNumberEnv(
    "PYRUS_RUNTIME_TEST_PROCESS_MIN_AGE_MS",
    DEFAULT_TEST_PROCESS_MIN_AGE_MS,
  );
  const repoRoot = findRepoRoot();
  const nowMs = Date.now();
  const processes: JsonRecord[] = [];

  let entries: { name: string; isDirectory: () => boolean }[];
  try {
    entries = readdirSync(procRoot, { withFileTypes: true });
  } catch {
    return {
      enabled: true,
      processes: [],
      count: 0,
      longRunningCount: 0,
      maxAgeMs: null,
    };
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) {
      continue;
    }
    const pid = Number(entry.name);
    if (!Number.isFinite(pid) || pid === process.pid) {
      continue;
    }
    const pidDir = path.join(procRoot, entry.name);
    const rawCmdline = safeReadText(path.join(pidDir, "cmdline"));
    const cmdline = rawCmdline?.replace(/\0/g, " ").trim() ?? "";
    const cwd = safeReadLink(path.join(pidDir, "cwd"));
    if (!isWorkspaceTestCommand({ cmdline, cwd, repoRoot })) {
      continue;
    }
    const ageMs = processAgeMs(pidDir, nowMs);
    const longRunning = ageMs !== null && ageMs >= minAgeMs;
    processes.push({
      pid,
      ageMs,
      longRunning,
      cwd,
      command: cmdline.slice(0, 320),
    });
  }

  const longRunningCount = processes.filter(
    (processInfo) => processInfo["longRunning"] === true,
  ).length;
  const ages = processes
    .map((processInfo) => Number(processInfo["ageMs"]))
    .filter((value) => Number.isFinite(value));

  return {
    enabled: true,
    processes: processes.slice(0, 8),
    count: processes.length,
    longRunningCount,
    maxAgeMs: ages.length ? Math.max(...ages) : null,
  };
}

function round(value: number, places = 1): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function mb(bytes: number): number {
  return round(bytes / 1024 / 1024, 1);
}

function percentile(values: number[], ratio: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return round(sorted[index], 1);
}

function requestSummary(): JsonRecord {
  const samples = getRecentRequestSamples();
  const latencySamples = samples.filter(
    (sample) => !isLongLivedApiRequestUrl(sample.path),
  );
  const durations = latencySamples
    .map((sample) => sample.durationMs)
    .filter(Number.isFinite);
  const byPath = new Map<string, number[]>();
  const byStatusFamily: Record<string, number> = {
    "2xx": 0,
    "3xx": 0,
    "4xx": 0,
    "5xx": 0,
    other: 0,
  };
  for (const sample of samples) {
    const isLatencySample = !isLongLivedApiRequestUrl(sample.path);
    const key = `${sample.method} ${sample.path}`;
    if (isLatencySample) {
      const current = byPath.get(key) ?? [];
      current.push(sample.durationMs);
      byPath.set(key, current);
    }
    const family =
      sample.statusCode >= 200 && sample.statusCode < 300
        ? "2xx"
        : sample.statusCode >= 300 && sample.statusCode < 400
          ? "3xx"
          : sample.statusCode >= 400 && sample.statusCode < 500
            ? "4xx"
            : sample.statusCode >= 500 && sample.statusCode < 600
              ? "5xx"
              : "other";
    byStatusFamily[family] += 1;
  }
  let dominantSlowRoute: JsonRecord | null = null;
  const routeSummaries = [...byPath.entries()].map(([route, routeDurations]) => ({
    route,
    samples: routeDurations.length,
    p95Ms: percentile(routeDurations, 0.95),
  }));
  for (const [route, routeDurations] of byPath) {
    const p95 = percentile(routeDurations, 0.95);
    if (p95 !== null && p95 > Number(dominantSlowRoute?.["p95Ms"] ?? 0)) {
      dominantSlowRoute = { route, p95Ms: p95, samples: routeDurations.length };
    }
  }
  return {
    sampleCount: samples.length,
    latencySampleCount: latencySamples.length,
    longLivedRequestCount: samples.length - latencySamples.length,
    p95Ms: percentile(durations, 0.95),
    byStatusFamily,
    dominantSlowRoute,
    topRoutes: routeSummaries
      .sort((left, right) => right.samples - left.samples)
      .slice(0, 8),
    recentFailures: samples
      .filter((sample) => sample.statusCode >= 400)
      .slice(-8)
      .map((sample) => ({
        method: sample.method,
        path: sample.path,
        routeClass: sample.routeClass ?? null,
        requestFamily: sample.requestFamily ?? null,
        fetchPriority: sample.fetchPriority ?? null,
        requestOrigin: sample.requestOrigin ?? null,
        clientRole: sample.clientRole ?? null,
        statusCode: sample.statusCode,
        durationMs: sample.durationMs,
        recordedAt: new Date(sample.recordedAt).toISOString(),
      })),
  };
}

function buildApiHeartbeat(): JsonRecord {
  const memory = process.memoryUsage();
  const heapStats = v8.getHeapStatistics();
  const pressure = getApiResourcePressureSnapshot();
  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: nowIso(),
    pid: process.pid,
    ppid: process.ppid,
    uptimeMs: Math.round(process.uptime() * 1000),
    memoryMb: {
      rss: mb(memory.rss),
      heapUsed: mb(memory.heapUsed),
      heapTotal: mb(memory.heapTotal),
      external: mb(memory.external),
      heapLimit: mb(heapStats.heap_size_limit),
    },
    apiPressure: pressure,
    dbPool: getPoolStats(),
    requests: requestSummary(),
  };
}

export function appendRuntimeFlightRecorderEvent(
  event: string,
  detail: JsonRecord = {},
): void {
  try {
    const dir = recorderDir();
    appendJsonLine(path.join(dir, `api-events-${dateKey()}.jsonl`), {
      schemaVersion: SCHEMA_VERSION,
      time: nowIso(),
      event,
      pid: process.pid,
      ...detail,
    });
  } catch {
    // Recorder writes must not affect runtime behavior.
  }
}

// Periodic memory/ELU samples go to the APPEND-ONLY events JSONL, not just
// api-current.json: the current-state file is overwritten by the next boot, so
// after the 2026-07-03 container replacement no pre-crash memory trajectory
// survived. Samples capture SYSTEM memory (all processes) as well — that
// incident never tripped the per-process api-memory-pressure threshold; the
// box ran out in aggregate.
const MEMORY_SAMPLE_INTERVAL_MS = (() => {
  const raw = Number.parseInt(
    process.env["PYRUS_API_FLIGHT_RECORDER_MEMORY_SAMPLE_MS"] ?? "30000",
    10,
  );
  return Number.isFinite(raw) && raw > 0 ? raw : 30_000;
})();
let lastMemorySampleAt = 0;

function systemMemorySnapshotMb(): JsonRecord | null {
  try {
    const meminfo = readFileSync("/proc/meminfo", "utf8");
    const readKb = (key: string): number | null => {
      const match = meminfo.match(new RegExp(`^${key}:\\s+(\\d+) kB`, "m"));
      return match ? Math.round(Number(match[1]) / 1024) : null;
    };
    return {
      totalMb: readKb("MemTotal"),
      availableMb: readKb("MemAvailable"),
      freeMb: readKb("MemFree"),
    };
  } catch {
    return null;
  }
}

function recordMemorySampleIfDue(heartbeat: JsonRecord): void {
  try {
    const now = Date.now();
    if (now - lastMemorySampleAt < MEMORY_SAMPLE_INTERVAL_MS) return;
    lastMemorySampleAt = now;
    const pressureInputs = (heartbeat["apiPressure"] as JsonRecord | undefined)?.[
      "inputs"
    ] as JsonRecord | undefined;
    const dbPool = heartbeat["dbPool"] as JsonRecord | undefined;
    appendRuntimeFlightRecorderEvent("api-memory-sample", {
      memoryMb: heartbeat["memoryMb"] ?? null,
      system: systemMemorySnapshotMb(),
      eventLoopDelayP95Ms: pressureInputs?.["eventLoopDelayP95Ms"] ?? null,
      eventLoopUtilization: pressureInputs?.["eventLoopUtilization"] ?? null,
      dbPool: dbPool
        ? {
            active: dbPool["active"] ?? null,
            waiting: dbPool["waiting"] ?? null,
            max: dbPool["max"] ?? null,
          }
        : null,
    });
  } catch {
    // Recorder writes must not affect runtime behavior.
  }
}

export function __recordMemorySampleForTests(heartbeat: JsonRecord): void {
  lastMemorySampleAt = 0;
  recordMemorySampleIfDue(heartbeat);
}

// Event-loop stall detector. A ~54s whole-process stall was observed on
// 2026-07-11 (memory-sample timer gap carrying byte-identical stale ELU
// values) and could not be classified: a Node event-loop block and a
// whole-VM pause look identical in the 5s samples. This 1s ticker records an
// explicit api-event-loop-stall event with the measured gap whenever a tick
// arrives late. Classification key: the SUPERVISOR heartbeats (separate
// process, 5s cadence) gap too on a VM pause but keep beating through a Node
// block — correlate the two streams at the next occurrence.
const STALL_TICK_MS = 1_000;
const STALL_REPORT_THRESHOLD_MS = (() => {
  const raw = Number.parseInt(
    process.env["PYRUS_API_FLIGHT_RECORDER_STALL_THRESHOLD_MS"] ?? "5000",
    10,
  );
  return Number.isFinite(raw) && raw > 0 ? raw : 5_000;
})();
let stallTimer: NodeJS.Timeout | null = null;
let lastStallTickAt = 0;

export function startEventLoopStallDetector(): void {
  if (stallTimer) return;
  lastStallTickAt = Date.now();
  stallTimer = setInterval(() => {
    const now = Date.now();
    const gapMs = now - lastStallTickAt - STALL_TICK_MS;
    lastStallTickAt = now;
    if (gapMs >= STALL_REPORT_THRESHOLD_MS) {
      appendRuntimeFlightRecorderEvent("api-event-loop-stall", {
        stallMs: gapMs,
        thresholdMs: STALL_REPORT_THRESHOLD_MS,
      });
    }
  }, STALL_TICK_MS);
  stallTimer.unref?.();
}

const RSS_PRESSURE_REARM_RATIO = 0.9;
const RSS_PRESSURE_MIN_REWARN_MS = 60_000;
let memoryPressureActive = false;
let lastMemoryPressureWarnAt = 0;

let cachedDefaultRssWarnBytes: number | null = null;

// Default the observability threshold to the same cgroup-derived RSS pressure
// thresholds the user-facing signals use (resource-pressure), instead of a fixed
// 1.5GiB. On a multi-GB container that fixed value fired this alarm every minute
// while the app was healthy (heap ~20%, RSS well under the user-facing 6/8GB
// watch/high lines), flooding the flight recorder with misleading
// "memory pressure" events. The API_RSS_WARN_BYTES env override still wins.
export function rssPressureThresholdBytes(): number {
  const raw = Number(process.env.API_RSS_WARN_BYTES);
  if (Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  if (cachedDefaultRssWarnBytes === null) {
    cachedDefaultRssWarnBytes =
      resolveApiRssPressureThresholds().watch * 1024 * 1024;
  }
  return cachedDefaultRssWarnBytes;
}

// Observability only: records an event (no action taken, not a memory cap) when
// RSS crosses a configurable threshold so a future container eviction under
// memory pressure is attributable from the flight recorder.
function recordMemoryPressureIfNeeded(): void {
  try {
    const memory = process.memoryUsage();
    const threshold = rssPressureThresholdBytes();
    if (memory.rss < threshold * RSS_PRESSURE_REARM_RATIO) {
      memoryPressureActive = false;
      return;
    }
    if (memory.rss < threshold) {
      return;
    }
    const now = Date.now();
    if (memoryPressureActive && now - lastMemoryPressureWarnAt < RSS_PRESSURE_MIN_REWARN_MS) {
      return;
    }
    memoryPressureActive = true;
    lastMemoryPressureWarnAt = now;
    appendRuntimeFlightRecorderEvent("api-memory-pressure", {
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      externalBytes: memory.external,
      thresholdBytes: threshold,
    });
  } catch {
    // Recorder writes must not affect runtime behavior.
  }
}

const DB_POOL_PRESSURE_MIN_REWARN_MS = 60_000;
let dbPoolPressureActive = false;
let lastDbPoolPressureWarnAt = 0;

// Observability only: records an event when the shared Postgres pool saturates
// (acquire requests queued because every connection is checked out) so a slow
// load or a "degraded"/"stale" cockpit banner can be correlated with real pool
// contention from the flight recorder. Takes no action and holds no connection.
function recordDbPoolPressureIfNeeded(): void {
  try {
    const stats = getPoolStats();
    if (stats.waiting <= 0) {
      dbPoolPressureActive = false;
      return;
    }
    const now = Date.now();
    if (
      dbPoolPressureActive &&
      now - lastDbPoolPressureWarnAt < DB_POOL_PRESSURE_MIN_REWARN_MS
    ) {
      return;
    }
    dbPoolPressureActive = true;
    lastDbPoolPressureWarnAt = now;
    appendRuntimeFlightRecorderEvent("api-db-pool-pressure", {
      waiting: stats.waiting,
      total: stats.total,
      idle: stats.idle,
      active: stats.active,
      max: stats.max,
    });
  } catch {
    // Recorder writes must not affect runtime behavior.
  }
}

export function writeRuntimeFlightRecorderHeartbeat(): JsonRecord | null {
  try {
    const heartbeat = buildApiHeartbeat();
    atomicWriteJson(path.join(recorderDir(), "api-current.json"), heartbeat);
    recordMemorySampleIfDue(heartbeat);
    recordMemoryPressureIfNeeded();
    recordDbPoolPressureIfNeeded();
    return heartbeat;
  } catch (error) {
    logger.debug({ err: error }, "Runtime flight recorder heartbeat failed");
    return null;
  }
}

export function startRuntimeFlightRecorder(): void {
  if (heartbeatTimer) return;
  appendRuntimeFlightRecorderEvent("api-flight-recorder-start");
  writeRuntimeFlightRecorderHeartbeat();
  heartbeatTimer = setInterval(() => {
    writeRuntimeFlightRecorderHeartbeat();
  }, Number.isFinite(HEARTBEAT_INTERVAL_MS) && HEARTBEAT_INTERVAL_MS > 0 ? HEARTBEAT_INTERVAL_MS : 5000);
  heartbeatTimer.unref?.();
  startEventLoopStallDetector();
}

// Slow-query firehose diet (census S3+D5): the recorder wrote full SQL + stack +
// context per slow event and grew to 306 MB/day, amplifying exactly under DB
// pressure. Truncate SQL, drop the (always-empty) stack, rate-limit per
// query-family, and cap the intra-day slow-event bytes.
const SLOW_EVENT_SQL_MAX_CHARS = 300;
const SLOW_EVENT_RATE_WINDOW_MS = 60_000;
const SLOW_EVENT_RATE_BURST = 5; // first N per family per window emitted freely
const SLOW_EVENT_RATE_THROTTLE_MS = 10_000; // then at most one per 10s
const SLOW_EVENT_INTRADAY_BYTE_CAP_DEFAULT = 64 * 1024 * 1024;

type SlowEventRateState = {
  windowStartMs: number;
  countInWindow: number;
  suppressedSinceEmit: number;
  lastThrottledEmitAt: number;
};

const slowEventRateStateByFamily = new Map<string, SlowEventRateState>();
let slowEventIntradayBytes = 0;
let slowEventIntradayDateKey = "";
let slowEventCapNoticeEmitted = false;
let slowEventIntradayByteCap = SLOW_EVENT_INTRADAY_BYTE_CAP_DEFAULT;

function appendPostgresPoolDiagnosticEvent(
  event: PostgresPoolDiagnosticEvent,
  nowMs: number = Date.now(),
): void {
  const eventName =
    event.type === "acquire"
      ? "api-db-pool-acquire-slow"
      : "api-db-query-slow";
  const family = `${event.type}:${
    event.queryName ?? (event.sql ? event.sql.slice(0, 60) : "unknown")
  }`;

  // Rate-limit per family: emit the first BURST per rolling minute, then at most
  // one per THROTTLE window carrying the count suppressed since the last emit.
  const existing = slowEventRateStateByFamily.get(family);
  const state: SlowEventRateState =
    !existing || nowMs - existing.windowStartMs >= SLOW_EVENT_RATE_WINDOW_MS
      ? {
          windowStartMs: nowMs,
          countInWindow: 0,
          suppressedSinceEmit: existing?.suppressedSinceEmit ?? 0,
          lastThrottledEmitAt: existing?.lastThrottledEmitAt ?? 0,
        }
      : existing;
  slowEventRateStateByFamily.set(family, state);
  state.countInWindow += 1;
  let suppressedCount = 0;
  if (state.countInWindow <= SLOW_EVENT_RATE_BURST) {
    suppressedCount = state.suppressedSinceEmit;
    state.suppressedSinceEmit = 0;
  } else if (nowMs - state.lastThrottledEmitAt >= SLOW_EVENT_RATE_THROTTLE_MS) {
    suppressedCount = state.suppressedSinceEmit;
    state.suppressedSinceEmit = 0;
    state.lastThrottledEmitAt = nowMs;
  } else {
    state.suppressedSinceEmit += 1;
    return;
  }

  // Intra-day size cap: once the day's slow-event budget is spent, stop appending
  // slow events (other recorder event kinds keep flowing).
  const dateKey = new Date(nowMs).toISOString().slice(0, 10);
  if (dateKey !== slowEventIntradayDateKey) {
    slowEventIntradayDateKey = dateKey;
    slowEventIntradayBytes = 0;
    slowEventCapNoticeEmitted = false;
  }
  if (slowEventIntradayBytes >= slowEventIntradayByteCap) {
    if (!slowEventCapNoticeEmitted) {
      slowEventCapNoticeEmitted = true;
      appendRuntimeFlightRecorderEvent("api-db-slow-recording-capped", {
        dateKey,
        capBytes: slowEventIntradayByteCap,
      });
    }
    return;
  }

  const detail: JsonRecord = {
    source: event.source,
    durationMs: event.durationMs,
    executionDurationMs: event.executionDurationMs ?? null,
    sql:
      event.sql == null ? null : event.sql.slice(0, SLOW_EVENT_SQL_MAX_CHARS),
    queryName: event.queryName,
    error: event.error,
    pool: event.pool,
    context: event.context,
  };
  if (suppressedCount > 0) {
    detail["suppressedCount"] = suppressedCount;
  }
  slowEventIntradayBytes += JSON.stringify(detail).length;
  appendRuntimeFlightRecorderEvent(eventName, detail);
}

export function __appendPostgresPoolDiagnosticEventForTests(
  event: PostgresPoolDiagnosticEvent,
  nowMs?: number,
): void {
  appendPostgresPoolDiagnosticEvent(event, nowMs);
}

export function __resetPostgresPoolDiagnosticRateLimitForTests(overrides?: {
  byteCap?: number;
}): void {
  slowEventRateStateByFamily.clear();
  slowEventIntradayBytes = 0;
  slowEventIntradayDateKey = "";
  slowEventCapNoticeEmitted = false;
  slowEventIntradayByteCap =
    overrides?.byteCap ?? SLOW_EVENT_INTRADAY_BYTE_CAP_DEFAULT;
}

export function installRuntimeFlightRecorderDbDiagnostics(): void {
  if (dbDiagnosticsInstalled) return;
  dbDiagnosticsInstalled = true;
  setPostgresPoolDiagnosticListener((event: PostgresPoolDiagnosticEvent) => {
    appendPostgresPoolDiagnosticEvent(event);
  });
}

export function installRuntimeFlightRecorderProcessHandlers(): void {
  if (processHandlersInstalled) return;
  processHandlersInstalled = true;
  process.on("warning", (warning) => {
    appendRuntimeFlightRecorderEvent("node-warning", {
      name: warning.name,
      message: warning.message,
      stack: warning.stack?.split("\n").slice(0, 8).join("\n") ?? null,
    });
  });
  process.on("uncaughtExceptionMonitor", (error) => {
    appendRuntimeFlightRecorderEvent("uncaught-exception", {
      name: error.name,
      message: error.message,
      stack: error.stack?.split("\n").slice(0, 8).join("\n") ?? null,
    });
    // Persist the buffered diagnostics synchronously before the process dies.
    flushRuntimeFlightRecorderBuffersSync();
  });
  process.once("exit", (code) => {
    appendRuntimeFlightRecorderEvent("api-process-exit", { code });
    // "exit" runs only synchronous work — flush the JSONL buffer here so a
    // graceful shutdown never loses the tail of the diagnostic stream.
    flushRuntimeFlightRecorderBuffersSync();
  });
}

function importedPath(): string {
  return path.join(recorderDir(), "diagnostics-imported.json");
}

function readImportedIncidentIds(): Set<string> {
  const parsed = safeReadJson(importedPath());
  if (Array.isArray(parsed)) {
    return new Set(parsed.map(String));
  }
  return new Set();
}

function writeImportedIncidentIds(ids: Set<string>): void {
  const values = [...ids].slice(-MAX_IMPORTED_INCIDENT_IDS);
  atomicWriteJson(importedPath(), values);
}

function incidentSeverity(incident: RuntimeIncident): DiagnosticSeverity {
  if (
    incident.severity === "warning" ||
    incident.severity === "info"
  ) {
    return incident.severity;
  }
  return "warning";
}

export async function importRuntimeFlightRecorderIncidents(
  record: (input: {
    subsystem: "runtime";
    category: string;
    severity: DiagnosticSeverity;
    message: string;
    code?: string | null;
    dimensions?: JsonRecord;
    raw?: JsonRecord;
  }) => Promise<DiagnosticEventPayload>,
): Promise<{ imported: number; skipped: number }> {
  const dir = recorderDir();
  const incidents = readJsonl(path.join(dir, "incidents.jsonl")) as RuntimeIncident[];
  const importedIds = readImportedIncidentIds();
  let imported = 0;
  let skipped = 0;

  for (const incident of incidents) {
    const incidentId =
      incident.incidentId ??
      `${incident.classification ?? "unknown"}:${incident.observedAt ?? ""}`;
    if (!incidentId || importedIds.has(incidentId)) {
      skipped += 1;
      continue;
    }
    await record({
      subsystem: "runtime",
      category: "replit-restart",
      code: String(incident.classification ?? "unknown").slice(0, 96),
      severity: incidentSeverity(incident),
      message:
        incident.message ??
        `Previous Replit/PYRUS run classified as ${incident.classification ?? "unknown"}.`,
      dimensions: {
        incidentId,
        classification: incident.classification ?? null,
        confidence: incident.confidence ?? null,
      },
      raw: incident,
    });
    importedIds.add(incidentId);
    imported += 1;
  }

  if (imported > 0) {
    writeImportedIncidentIds(importedIds);
  }

  return { imported, skipped };
}

export function getRuntimeFlightRecorderDiagnostics(): {
  metrics: JsonRecord;
  raw: JsonRecord;
} {
  const dir = recorderDir();
  const supervisorCurrent = safeReadJson(path.join(dir, "current.json")) as JsonRecord | null;
  const apiCurrent = safeReadJson(path.join(dir, "api-current.json")) as JsonRecord | null;
  const incidents = readJsonl(path.join(dir, "incidents.jsonl"));
  const latestIncident = incidents.at(-1) ?? null;
  const apiUpdatedAt =
    typeof apiCurrent?.["updatedAt"] === "string" ? apiCurrent["updatedAt"] : null;
  const supervisorUpdatedAt =
    typeof supervisorCurrent?.["updatedAt"] === "string"
      ? supervisorCurrent["updatedAt"]
      : null;
  const workspaceTestProcesses = getWorkspaceTestProcessDiagnostics();

  return {
    metrics: {
      recorderDir: dir,
      flightRecorderDroppedJsonLineCount: droppedJsonLineCount,
      supervisorUpdatedAt,
      apiUpdatedAt,
      incidentCount: incidents.length,
      latestIncidentClassification: latestIncident?.classification ?? null,
      latestIncidentConfidence: latestIncident?.confidence ?? null,
      latestIncidentObservedAt: latestIncident?.observedAt ?? null,
      apiPressureLevel:
        (apiCurrent?.["apiPressure"] as JsonRecord | undefined)?.["level"] ?? null,
      apiRssMb: (apiCurrent?.["memoryMb"] as JsonRecord | undefined)?.["rss"] ?? null,
      apiRequestP95Ms:
        (apiCurrent?.["requests"] as JsonRecord | undefined)?.["p95Ms"] ?? null,
      apiDbPoolWaiting:
        (apiCurrent?.["dbPool"] as JsonRecord | undefined)?.["waiting"] ?? null,
      apiDbPoolActive:
        (apiCurrent?.["dbPool"] as JsonRecord | undefined)?.["active"] ?? null,
      apiDbPoolTotal:
        (apiCurrent?.["dbPool"] as JsonRecord | undefined)?.["total"] ?? null,
      apiDbPoolMax:
        (apiCurrent?.["dbPool"] as JsonRecord | undefined)?.["max"] ?? null,
      workspaceTestProcessScanEnabled: workspaceTestProcesses.enabled,
      workspaceTestProcessCount: workspaceTestProcesses.count,
      workspaceLongRunningTestProcessCount: workspaceTestProcesses.longRunningCount,
      workspaceTestProcessMaxAgeMs: workspaceTestProcesses.maxAgeMs,
    },
    raw: {
      supervisorCurrent,
      apiCurrent,
      latestIncident,
      workspaceTestProcesses: workspaceTestProcesses.processes,
    },
  };
}
