import {
  appendFileSync,
  existsSync,
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

function nowIso(): string {
  return new Date().toISOString();
}

function findRepoRoot(): string {
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

function ensureDir(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true });
}

export function appendFlightRecorderJsonLine(
  filePath: string,
  value: JsonRecord,
): void {
  ensureDir(path.dirname(filePath));
  appendFileSync(filePath, `${JSON.stringify(value)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
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

export function writeRuntimeFlightRecorderHeartbeat(): JsonRecord | null {
  try {
    const heartbeat = buildApiHeartbeat();
    atomicWriteJson(path.join(recorderDir(), "api-current.json"), heartbeat);
    recordMemoryPressureIfNeeded();
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
  });
  process.once("exit", (code) => {
    appendRuntimeFlightRecorderEvent("api-process-exit", { code });
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
