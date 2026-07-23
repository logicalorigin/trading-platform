import {
  appendFile,
  appendFileSync,
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  readlinkSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import * as v8 from "node:v8";
import {
  getPostgresDiagnosticContext,
  getPoolStats,
  safeDatabaseDiagnosticValue,
  setPostgresPoolDiagnosticListener,
  type PostgresDiagnosticContext,
  type PostgresPoolDiagnosticEvent,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { isLongLivedApiRequestUrl } from "../lib/request-logging";
import type { DiagnosticEventPayload, DiagnosticSeverity } from "./diagnostics";
import {
  getApiResourcePressureSnapshot,
  resolveApiRssPressureThresholds,
} from "./resource-pressure";
import { getRecentRequestSamples } from "./request-metrics";
import {
  getWorkGovernorSnapshot,
  setWorkGovernorTimingListener,
  type WorkGovernorTiming,
} from "./work-governor";

type JsonRecord = Record<string, unknown>;

const ACCOUNT_POSITIONS_STAGE_NAMES = [
  "universe",
  "universe_ibkr_accounts",
  "universe_snaptrade_accounts",
  "universe_snaptrade_credential_lookup",
  "universe_snaptrade_account_lookup",
  "universe_snaptrade_balances_http",
  "universe_snaptrade_positions_http",
  "universe_snaptrade_normalization",
  "universe_robinhood_accounts",
  "universe_provider_fanout",
  "universe_balance_overlay",
  "positions_upstream",
  "positions_snaptrade_snapshot",
  "positions_ibkr",
  "positions_robinhood",
  "positions_robinhood_session",
  "positions_robinhood_holdings",
  "positions_robinhood_market_data",
  "positions_provider_fanout",
  "fast_open_date_schedule",
  "equity_quotes",
  "option_quotes",
  "fast_quote_fanout",
  "market_hydration_initial",
  "full_orders",
  "full_lots",
  "full_greeks",
  "full_flex_open_dates",
  "full_execution_open_dates",
  "full_fanout",
  "real_attribution",
  "market_hydration_full",
  "response_shape",
] as const;

export type AccountPositionsStage =
  (typeof ACCOUNT_POSITIONS_STAGE_NAMES)[number];

export type AccountPositionsCacheDisposition = "hit" | "inflight" | "miss";

export type AccountPositionsTiming = {
  detail: "fast" | "full";
  liveQuotes: boolean;
  outcome: "success" | "failure";
  universeCache: AccountPositionsCacheDisposition | null;
  positionsCache: AccountPositionsCacheDisposition | null;
  positionCount: number | null;
  rowCount: number | null;
  stagesMs: Partial<Record<AccountPositionsStage, number>>;
  totalDurationMs: number;
};

const ACCOUNT_POSITIONS_DURATION_BUCKETS = [
  ["le50", 50],
  ["le100", 100],
  ["le250", 250],
  ["le500", 500],
  ["le1000", 1_000],
  ["le2500", 2_500],
] as const;

type AccountPositionsDurationBucket =
  | (typeof ACCOUNT_POSITIONS_DURATION_BUCKETS)[number][0]
  | "gt2500";
type AccountPositionsCacheBucket = AccountPositionsCacheDisposition | "unknown";
type AccountPositionsStageAggregate = {
  count: number;
  totalMs: number;
  maxMs: number;
};
type AccountPositionsTimingAggregate = {
  count: number;
  successCount: number;
  failureCount: number;
  sub250SuccessCount: number;
  totalDurationMs: number;
  maxDurationMs: number;
  durationBuckets: Record<AccountPositionsDurationBucket, number>;
  universeCache: Record<AccountPositionsCacheBucket, number>;
  positionsCache: Record<AccountPositionsCacheBucket, number>;
  stagesMs: Partial<
    Record<AccountPositionsStage, AccountPositionsStageAggregate>
  >;
};

function emptyAccountPositionsTimingAggregate(): AccountPositionsTimingAggregate {
  return {
    count: 0,
    successCount: 0,
    failureCount: 0,
    sub250SuccessCount: 0,
    totalDurationMs: 0,
    maxDurationMs: 0,
    durationBuckets: {
      le50: 0,
      le100: 0,
      le250: 0,
      le500: 0,
      le1000: 0,
      le2500: 0,
      gt2500: 0,
    },
    universeCache: { hit: 0, inflight: 0, miss: 0, unknown: 0 },
    positionsCache: { hit: 0, inflight: 0, miss: 0, unknown: 0 },
    stagesMs: {},
  };
}

type RuntimeIncident = JsonRecord & {
  incidentId?: string;
  classification?: string;
  confidence?: string;
  severity?: DiagnosticSeverity;
  message?: string;
  observedAt?: string;
};

const SCHEMA_VERSION = 1;
const configuredHeartbeatIntervalMs = Number.parseInt(
  process.env["PYRUS_API_FLIGHT_RECORDER_INTERVAL_MS"] ?? "5000",
  10,
);
const HEARTBEAT_INTERVAL_MS =
  Number.isFinite(configuredHeartbeatIntervalMs) &&
  configuredHeartbeatIntervalMs > 0
    ? configuredHeartbeatIntervalMs
    : 5_000;
const HEARTBEAT_CADENCE_TOLERANCE = 1.5;
type ApiHeartbeatPublicationState = {
  successfulPublicationSequence: number;
  lastSuccessfulAttemptStartMonoMs: number | null;
  cadenceViolationCount: number;
  lastSuccessfulAttemptGapMs: number | null;
  maxSuccessfulAttemptGapMs: number;
  lastSuccessfulCompletionMonoMs: number | null;
  completionCadenceViolationCount: number;
  lastSuccessfulCompletionGapMs: number | null;
  maxSuccessfulCompletionGapMs: number;
};
const initialApiHeartbeatPublicationState =
  (): ApiHeartbeatPublicationState => ({
    successfulPublicationSequence: 0,
    lastSuccessfulAttemptStartMonoMs: null,
    cadenceViolationCount: 0,
    lastSuccessfulAttemptGapMs: null,
    maxSuccessfulAttemptGapMs: 0,
    lastSuccessfulCompletionMonoMs: null,
    completionCadenceViolationCount: 0,
    lastSuccessfulCompletionGapMs: null,
    maxSuccessfulCompletionGapMs: 0,
  });
let apiHeartbeatPublicationState = initialApiHeartbeatPublicationState();
let apiHeartbeatWriteFailureCount = 0;
const MAX_IMPORTED_INCIDENT_IDS = 500;
const MAX_IMPORTED_INCIDENT_ID_LENGTH = 256;
// JSON.stringify can encode one UTF-16 code unit as a six-byte escape. Include
// the pretty-printed array's indentation, quotes, comma, and newline per item.
const IMPORTED_INCIDENT_IDS_MAX_BYTES =
  3 +
  MAX_IMPORTED_INCIDENT_IDS * (MAX_IMPORTED_INCIDENT_ID_LENGTH * 6 + 6);
const RUNTIME_DIAGNOSTIC_MAX_DEPTH = 4;
const RUNTIME_DIAGNOSTIC_MAX_KEYS = 40;
const RUNTIME_DIAGNOSTIC_MAX_ITEMS = 20;
const RUNTIME_DIAGNOSTIC_MAX_TEXT = 2_000;
const RUNTIME_DIAGNOSTIC_SENSITIVE_KEY_PATTERN =
  /(?:api[\s_-]*key|authorization|code|cookie|credential|password|secret|session|signature|token)/iu;
const RUNTIME_DIAGNOSTIC_OPAQUE_SECRET_PATTERN =
  /(?:\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bsk-[A-Za-z0-9_-]{16,}\b|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b)/u;
const DEFAULT_TEST_PROCESS_MIN_AGE_MS = 30_000;
let heartbeatTimer: NodeJS.Timeout | null = null;
let processHandlersInstalled = false;
let dbDiagnosticsInstalled = false;
let memoryCensusProvider: (() => JsonRecord) | null = null;

export function setRuntimeFlightRecorderMemoryCensusProvider(
  provider: (() => JsonRecord) | null,
): void {
  memoryCensusProvider = provider;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function findRepoRoot(): string {
  const configured = process.env["PYRUS_REPO_ROOT"];
  if (configured) return path.resolve(configured);

  let current = process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    try {
      const pkg = JSON.parse(
        readFileSync(path.join(current, "package.json"), "utf8"),
      );
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

function readCurrentGuestSupervisorMarker(dir: string): JsonRecord | null {
  try {
    const match = readFileSync("/proc/stat", "utf8").match(/^btime\s+(\d+)$/mu);
    const btime = Number(match?.[1]);
    if (!Number.isSafeInteger(btime) || btime <= 0) return null;
    const marker = safeReadJson(
      path.join(dir, "boot-markers", `btime-${btime}.json`),
    ) as JsonRecord | null;
    const boot = marker?.["boot"] as JsonRecord | undefined;
    return boot?.["bootId"] === `btime:${btime}` ? marker : null;
  } catch {
    return null;
  }
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

function safeReadJson(filePath: string, maxBytes?: number): unknown {
  try {
    if (maxBytes === undefined) {
      return JSON.parse(readFileSync(filePath, "utf8"));
    }
    const fd = openSync(filePath, "r");
    try {
      if (fstatSync(fd).size > maxBytes) return null;
      const buffer = Buffer.allocUnsafe(maxBytes + 1);
      const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
      return bytesRead <= maxBytes
        ? JSON.parse(buffer.subarray(0, bytesRead).toString("utf8"))
        : null;
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
}

function safeRuntimeDiagnosticText(
  value: unknown,
  maxLength: number,
): string | null {
  if (typeof value !== "string") return null;
  const bounded = value.trim().slice(0, maxLength);
  return bounded && !RUNTIME_DIAGNOSTIC_OPAQUE_SECRET_PATTERN.test(bounded)
    ? safeDatabaseDiagnosticValue(bounded)
    : null;
}

function sanitizeRuntimeDiagnosticValue(
  value: unknown,
  key = "",
  depth = 0,
): unknown {
  if (RUNTIME_DIAGNOSTIC_SENSITIVE_KEY_PATTERN.test(key)) return "[redacted]";
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    return (
      safeRuntimeDiagnosticText(value, RUNTIME_DIAGNOSTIC_MAX_TEXT) ??
      "[redacted]"
    );
  }
  if (depth >= RUNTIME_DIAGNOSTIC_MAX_DEPTH) return { __truncated: "depth" };
  if (Array.isArray(value)) {
    return value
      .slice(0, RUNTIME_DIAGNOSTIC_MAX_ITEMS)
      .map((item) => sanitizeRuntimeDiagnosticValue(item, key, depth + 1));
  }
  if (typeof value !== "object") return null;
  const sanitized: JsonRecord = {};
  for (const [entryKey, entryValue] of Object.entries(
    value as Record<string, unknown>,
  ).slice(0, RUNTIME_DIAGNOSTIC_MAX_KEYS)) {
    const safeKey = RUNTIME_DIAGNOSTIC_SENSITIVE_KEY_PATTERN.test(entryKey)
      ? "[redacted]"
      : (safeRuntimeDiagnosticText(entryKey, 128) ?? "[redacted]");
    sanitized[safeKey] = sanitizeRuntimeDiagnosticValue(
      entryValue,
      entryKey,
      depth + 1,
    );
  }
  return sanitized;
}

function sanitizeRuntimeDiagnosticRecord(value: unknown): JsonRecord {
  const sanitized = sanitizeRuntimeDiagnosticValue(value);
  return sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)
    ? (sanitized as JsonRecord)
    : {};
}

export const sanitizeRuntimeDiagnosticRecordForTests =
  sanitizeRuntimeDiagnosticRecord;

export function* readFlightRecorderJsonlReverse(
  filePath: string,
  chunkBytes = 64 * 1024,
  maxBytes = 4 * 1024 * 1024,
  maxRecords = 10_000,
): Generator<Record<string, unknown>> {
  const size = Math.floor(chunkBytes);
  const byteLimit = Math.floor(maxBytes);
  const recordLimit = Math.floor(maxRecords);
  if (
    !Number.isFinite(size) ||
    size <= 0 ||
    !Number.isFinite(byteLimit) ||
    byteLimit <= 0 ||
    !Number.isFinite(recordLimit) ||
    recordLimit <= 0
  ) {
    return;
  }

  let fd: number | undefined;
  try {
    fd = openSync(filePath, "r");
    let position = fstatSync(fd).size;
    let bytesScanned = 0;
    let recordsRead = 0;
    let suffix = Buffer.alloc(0);
    const parse = (line: Buffer): JsonRecord | null => {
      try {
        return JSON.parse(line.toString("utf8")) as JsonRecord;
      } catch {
        return null;
      }
    };

    while (
      position > 0 &&
      bytesScanned < byteLimit &&
      recordsRead < recordLimit
    ) {
      const length = Math.min(position, size, byteLimit - bytesScanned);
      position -= length;
      bytesScanned += length;
      const chunk = Buffer.allocUnsafe(length);
      let bytesRead = 0;
      while (bytesRead < length) {
        const count = readSync(
          fd,
          chunk,
          bytesRead,
          length - bytesRead,
          position + bytesRead,
        );
        if (count === 0) break;
        bytesRead += count;
      }
      const data = Buffer.concat([chunk.subarray(0, bytesRead), suffix]);
      let lineEnd = data.length;
      for (let index = data.length - 1; index >= 0; index -= 1) {
        if (data[index] !== 0x0a) continue;
        const record = parse(data.subarray(index + 1, lineEnd));
        if (record) {
          yield record;
          recordsRead += 1;
          if (recordsRead >= recordLimit) {
            return;
          }
        }
        lineEnd = index;
      }
      suffix = data.subarray(0, lineEnd);
    }

    if (position === 0 && recordsRead < recordLimit) {
      const first = parse(suffix);
      if (first) yield first;
    }
  } catch {
    return;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // Best-effort diagnostic read.
      }
    }
  }
}

const RUNTIME_INCIDENT_TAIL_MAX_BYTES = 4 * 1024 * 1024;
const RUNTIME_INCIDENT_TAIL_MAX_RECORDS = 10_000;

type RuntimeIncidentTail = {
  records: RuntimeIncident[];
  truncated: boolean;
  fileSize: number;
};

let runtimeIncidentTailCache: {
  key: string;
  value: RuntimeIncidentTail;
} | null = null;

function readRuntimeIncidentTail(
  filePath: string,
  options: { maxBytes?: number; maxRecords?: number } = {},
): RuntimeIncidentTail {
  const maxBytes = Math.max(
    1,
    Math.floor(options.maxBytes ?? RUNTIME_INCIDENT_TAIL_MAX_BYTES),
  );
  const maxRecords = Math.max(
    1,
    Math.floor(options.maxRecords ?? RUNTIME_INCIDENT_TAIL_MAX_RECORDS),
  );
  let fileSize = 0;
  let fileIdentity = "";
  try {
    const stats = statSync(filePath);
    fileSize = stats.size;
    fileIdentity = `${stats.dev}\0${stats.ino}\0${stats.ctimeMs}\0${stats.mtimeMs}`;
  } catch {
    runtimeIncidentTailCache = null;
    return { records: [], truncated: false, fileSize: 0 };
  }
  const key = `${filePath}\0${fileSize}\0${fileIdentity}\0${maxBytes}\0${maxRecords}`;
  if (runtimeIncidentTailCache?.key === key) {
    return runtimeIncidentTailCache.value;
  }
  const scanned = [
    ...readFlightRecorderJsonlReverse(
      filePath,
      64 * 1024,
      maxBytes,
      maxRecords + 1,
    ),
  ] as RuntimeIncident[];
  const value = {
    records: scanned.slice(0, maxRecords),
    truncated: fileSize > maxBytes || scanned.length > maxRecords,
    fileSize,
  };
  runtimeIncidentTailCache = { key, value };
  return value;
}

export function readRuntimeIncidentTailForTests(
  filePath: string,
  options?: { maxBytes?: number; maxRecords?: number },
): RuntimeIncidentTail {
  return readRuntimeIncidentTail(filePath, options);
}

export function resetRuntimeIncidentTailCacheForTests(): void {
  runtimeIncidentTailCache = null;
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
    return Number.isFinite(mtimeMs)
      ? Math.max(0, Math.round(nowMs - mtimeMs))
      : null;
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
      cwd: safeRuntimeDiagnosticText(cwd, RUNTIME_DIAGNOSTIC_MAX_TEXT),
      command: safeRuntimeDiagnosticText(cmdline, 320),
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
  const index = Math.min(
    sorted.length - 1,
    Math.ceil(sorted.length * ratio) - 1,
  );
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
  const routeSummaries = [...byPath.entries()].map(
    ([route, routeDurations]) => ({
      route,
      samples: routeDurations.length,
      p95Ms: percentile(routeDurations, 0.95),
    }),
  );
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

export function nextApiHeartbeatPublicationState(
  previous: Readonly<ApiHeartbeatPublicationState>,
  attemptStartMonoMs: number,
  intervalMs: number,
): ApiHeartbeatPublicationState {
  if (
    !Number.isFinite(attemptStartMonoMs) ||
    attemptStartMonoMs < 0 ||
    !Number.isFinite(intervalMs) ||
    intervalMs <= 0
  ) {
    throw new Error("API heartbeat publication timing is invalid");
  }
  const previousAttemptStartMonoMs = previous.lastSuccessfulAttemptStartMonoMs;
  if (
    previousAttemptStartMonoMs != null &&
    attemptStartMonoMs < previousAttemptStartMonoMs
  ) {
    throw new Error("API heartbeat monotonic publication time moved backward");
  }
  const gapMs =
    previousAttemptStartMonoMs == null
      ? null
      : attemptStartMonoMs - previousAttemptStartMonoMs;
  const cadenceLimitMs = Math.ceil(intervalMs * HEARTBEAT_CADENCE_TOLERANCE);
  return {
    ...previous,
    successfulPublicationSequence: previous.successfulPublicationSequence + 1,
    lastSuccessfulAttemptStartMonoMs: attemptStartMonoMs,
    cadenceViolationCount:
      previous.cadenceViolationCount +
      Number(gapMs != null && gapMs > cadenceLimitMs),
    lastSuccessfulAttemptGapMs: gapMs,
    maxSuccessfulAttemptGapMs:
      gapMs == null
        ? previous.maxSuccessfulAttemptGapMs
        : Math.max(previous.maxSuccessfulAttemptGapMs, gapMs),
  };
}

export function completeApiHeartbeatPublicationState(
  publication: Readonly<ApiHeartbeatPublicationState>,
  completionMonoMs: number,
  intervalMs: number,
): ApiHeartbeatPublicationState {
  if (
    !Number.isFinite(completionMonoMs) ||
    completionMonoMs < 0 ||
    !Number.isFinite(intervalMs) ||
    intervalMs <= 0
  ) {
    throw new Error("API heartbeat completion timing is invalid");
  }
  const previousCompletionMonoMs = publication.lastSuccessfulCompletionMonoMs;
  if (
    previousCompletionMonoMs != null &&
    completionMonoMs < previousCompletionMonoMs
  ) {
    throw new Error("API heartbeat monotonic completion time moved backward");
  }
  const gapMs =
    previousCompletionMonoMs == null
      ? null
      : completionMonoMs - previousCompletionMonoMs;
  const cadenceLimitMs = Math.ceil(intervalMs * HEARTBEAT_CADENCE_TOLERANCE);
  return {
    ...publication,
    lastSuccessfulCompletionMonoMs: completionMonoMs,
    completionCadenceViolationCount:
      publication.completionCadenceViolationCount +
      Number(gapMs != null && gapMs > cadenceLimitMs),
    lastSuccessfulCompletionGapMs: gapMs,
    maxSuccessfulCompletionGapMs:
      gapMs == null
        ? publication.maxSuccessfulCompletionGapMs
        : Math.max(publication.maxSuccessfulCompletionGapMs, gapMs),
  };
}

export function __resetApiHeartbeatPublicationStateForTests(): void {
  apiHeartbeatPublicationState = initialApiHeartbeatPublicationState();
  apiHeartbeatWriteFailureCount = 0;
}

function buildApiHeartbeat(
  publishedAtMs: number,
  publication: ApiHeartbeatPublicationState,
): JsonRecord {
  const memory = process.memoryUsage();
  const heapStats = v8.getHeapStatistics();
  const pressure = getApiResourcePressureSnapshot();
  const cadenceLimitMs = Math.ceil(
    HEARTBEAT_INTERVAL_MS * HEARTBEAT_CADENCE_TOLERANCE,
  );
  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: new Date(publishedAtMs).toISOString(),
    pid: process.pid,
    ppid: process.ppid,
    uptimeMs: Math.round(process.uptime() * 1000),
    memoryMb: {
      rss: mb(memory.rss),
      heapUsed: mb(memory.heapUsed),
      heapTotal: mb(memory.heapTotal),
      external: mb(memory.external),
      arrayBuffers: mb(memory.arrayBuffers),
      heapLimit: mb(heapStats.heap_size_limit),
    },
    apiPressure: pressure,
    dbPool: getPoolStats(),
    workGovernor: getWorkGovernorSnapshot(),
    accountPositions: accountPositionsTimingSummary(),
    requests: requestSummary(),
    flightRecorder: {
      droppedJsonLineCount,
      heartbeatPublication: {
        successfulPublicationSequence:
          publication.successfulPublicationSequence,
        cadenceViolationCount: publication.cadenceViolationCount,
        lastSuccessfulAttemptGapMs: publication.lastSuccessfulAttemptGapMs,
        maxSuccessfulAttemptGapMs: publication.maxSuccessfulAttemptGapMs,
        // Completion is only knowable after this document's atomic rename.
        // Every heartbeat therefore reports completion evidence through its
        // immediate predecessor; the watcher waits for one final successor.
        completionEvidenceThroughSequence:
          publication.successfulPublicationSequence - 1,
        completionCadenceViolationCount:
          publication.completionCadenceViolationCount,
        lastSuccessfulCompletionGapMs:
          publication.lastSuccessfulCompletionGapMs,
        maxSuccessfulCompletionGapMs: publication.maxSuccessfulCompletionGapMs,
        cadenceLimitMs,
        writeFailureCount: apiHeartbeatWriteFailureCount,
      },
    },
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
    const pressureInputs = (
      heartbeat["apiPressure"] as JsonRecord | undefined
    )?.["inputs"] as JsonRecord | undefined;
    const dbPool = heartbeat["dbPool"] as JsonRecord | undefined;
    const compactPoolLane = (lane: unknown): JsonRecord | null => {
      if (!lane || typeof lane !== "object" || Array.isArray(lane)) {
        return null;
      }
      const value = lane as JsonRecord;
      return {
        active: value["active"] ?? null,
        waiting: value["waiting"] ?? null,
        totalWaiting: value["totalWaiting"] ?? value["waiting"] ?? null,
        rawPoolWaiting: value["rawPoolWaiting"] ?? null,
        admissionWaiting: value["admissionWaiting"] ?? null,
        ...(value["appPoolSaturated"] === undefined
          ? {}
          : { appPoolSaturated: value["appPoolSaturated"] }),
        max: value["max"] ?? null,
      };
    };
    let retainedBars: JsonRecord | null = null;
    try {
      retainedBars = memoryCensusProvider?.() ?? null;
    } catch {
      // A census failure must not suppress the base process-memory sample.
    }
    appendRuntimeFlightRecorderEvent("api-memory-sample", {
      memoryMb: heartbeat["memoryMb"] ?? null,
      retainedBars,
      system: systemMemorySnapshotMb(),
      eventLoopDelayP95Ms: pressureInputs?.["eventLoopDelayP95Ms"] ?? null,
      eventLoopUtilization: pressureInputs?.["eventLoopUtilization"] ?? null,
      dbPool: dbPool
        ? {
            ...compactPoolLane(dbPool),
            ...(dbPool["authPool"]
              ? { authPool: compactPoolLane(dbPool["authPool"]) }
              : {}),
            ...(dbPool["tradingPool"]
              ? { tradingPool: compactPoolLane(dbPool["tradingPool"]) }
              : {}),
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
// explicit api-event-loop-stall event when the monotonic interval between
// callbacks reaches the configured threshold. Classification key: the
// SUPERVISOR heartbeats (separate process, 5s cadence) gap too on a VM pause but
// keep beating through a Node block — correlate the two streams at the next
// occurrence.
const STALL_TICK_MS = 1_000;
const STALL_REPORT_THRESHOLD_MS = (() => {
  const raw = Number.parseInt(
    process.env["PYRUS_API_FLIGHT_RECORDER_STALL_THRESHOLD_MS"] ?? "5000",
    10,
  );
  return Number.isFinite(raw) && raw > 0 ? raw : 5_000;
})();
let stallTimer: NodeJS.Timeout | null = null;
let lastStallTickMonoMs = 0;

export function eventLoopStallObservation(
  previousTickMonoMs: number,
  currentTickMonoMs: number,
  expectedTickIntervalMs: number,
  thresholdMs: number,
): JsonRecord | null {
  if (
    !Number.isFinite(previousTickMonoMs) ||
    previousTickMonoMs < 0 ||
    !Number.isFinite(currentTickMonoMs) ||
    currentTickMonoMs < previousTickMonoMs ||
    !Number.isFinite(expectedTickIntervalMs) ||
    expectedTickIntervalMs <= 0 ||
    !Number.isFinite(thresholdMs) ||
    thresholdMs <= 0
  ) {
    if (currentTickMonoMs < previousTickMonoMs) {
      throw new Error("Event-loop stall monotonic time moved backward");
    }
    throw new Error("Event-loop stall timing is invalid");
  }
  const tickIntervalMs = currentTickMonoMs - previousTickMonoMs;
  if (tickIntervalMs < thresholdMs) return null;
  const lateByMs = Math.max(0, tickIntervalMs - expectedTickIntervalMs);
  return {
    // Preserve the existing field as scheduling lateness while making the
    // threshold basis and total observed silence explicit.
    stallMs: lateByMs,
    tickIntervalMs,
    lateByMs,
    expectedTickIntervalMs,
    thresholdMs,
    thresholdBasis: "tick-interval",
  };
}

export function startEventLoopStallDetector(): void {
  if (stallTimer) return;
  lastStallTickMonoMs = performance.now();
  stallTimer = setInterval(() => {
    const nowMonoMs = performance.now();
    const observation = eventLoopStallObservation(
      lastStallTickMonoMs,
      nowMonoMs,
      STALL_TICK_MS,
      STALL_REPORT_THRESHOLD_MS,
    );
    lastStallTickMonoMs = nowMonoMs;
    if (observation) {
      appendRuntimeFlightRecorderEvent("api-event-loop-stall", observation);
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
    if (
      memoryPressureActive &&
      now - lastMemoryPressureWarnAt < RSS_PRESSURE_MIN_REWARN_MS
    ) {
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

// Observability only: records an event while every shared app-pool connection is
// checked out. Admission backlog and raw node-postgres waiting remain separate
// payload fields so intentional pacing or an idle-client handoff cannot be
// mistaken for saturation. Takes no action and holds no connection.
function recordDbPoolPressureIfNeeded(): void {
  try {
    const stats = getPoolStats();
    if (!stats.appPoolSaturated) {
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
      totalWaiting: stats.totalWaiting,
      rawPoolWaiting: stats.rawPoolWaiting,
      admissionWaiting: stats.admissionWaiting,
      admissionBacklog: stats.admissionBacklog,
      appPoolSaturated: stats.appPoolSaturated,
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
    const attemptStartMonoMs = performance.now();
    const publication = nextApiHeartbeatPublicationState(
      apiHeartbeatPublicationState,
      attemptStartMonoMs,
      HEARTBEAT_INTERVAL_MS,
    );
    const heartbeat = buildApiHeartbeat(Date.now(), publication);
    atomicWriteJson(path.join(recorderDir(), "api-current.json"), heartbeat);
    // Commit only after the atomic rename succeeds. The published document
    // therefore self-attests to every sequence/cadence counter it exposes, and
    // a failed write cannot make a later observer infer a publication that did
    // not occur.
    apiHeartbeatPublicationState = completeApiHeartbeatPublicationState(
      publication,
      performance.now(),
      HEARTBEAT_INTERVAL_MS,
    );
    recordMemorySampleIfDue(heartbeat);
    recordMemoryPressureIfNeeded();
    recordDbPoolPressureIfNeeded();
    return heartbeat;
  } catch (error) {
    apiHeartbeatWriteFailureCount += 1;
    logger.debug(
      {
        error:
          safeRuntimeDiagnosticText(
            error instanceof Error ? error.message : null,
            RUNTIME_DIAGNOSTIC_MAX_TEXT,
          ) ?? "Runtime flight recorder heartbeat failed.",
      },
      "Runtime flight recorder heartbeat failed",
    );
    return null;
  }
}

export function startRuntimeFlightRecorder(): void {
  if (heartbeatTimer) return;
  appendRuntimeFlightRecorderEvent("api-flight-recorder-start");
  writeRuntimeFlightRecorderHeartbeat();
  heartbeatTimer = setInterval(() => {
    writeRuntimeFlightRecorderHeartbeat();
  }, HEARTBEAT_INTERVAL_MS);
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
const SLOW_EVENT_RATE_MAX_FAMILY_STATES = 256;
const SLOW_EVENT_RATE_OVERFLOW_FAMILY = Symbol("slow-event-rate-overflow");
const SLOW_EVENT_INTRADAY_BYTE_CAP_DEFAULT = 64 * 1024 * 1024;
const WORK_GOVERNOR_TIMING_MIN_MS = 250;
const WORK_GOVERNOR_TIMING_RATE_MS = 10_000;
const ACCOUNT_POSITIONS_TIMING_MIN_MS = 250;
const ACCOUNT_POSITIONS_TIMING_RATE_MS = 10_000;

type WorkGovernorTimingRateState = {
  lastEmittedAt: number;
  suppressedSinceEmit: number;
};

const workGovernorTimingRateByFamily = new Map<
  string,
  WorkGovernorTimingRateState
>();
const accountPositionsTimingRateByFamily = new Map<
  string,
  WorkGovernorTimingRateState
>();
let accountPositionsTimingAggregate = emptyAccountPositionsTimingAggregate();
const accountPositionsTimingAggregateByFamily = new Map<
  string,
  AccountPositionsTimingAggregate
>();

function roundedDiagnosticMs(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function addAccountPositionsTimingToAggregate(
  aggregate: AccountPositionsTimingAggregate,
  timing: AccountPositionsTiming,
): void {
  const durationMs = Number.isFinite(timing.totalDurationMs)
    ? Math.max(0, timing.totalDurationMs)
    : 0;
  aggregate.count += 1;
  aggregate.successCount += Number(timing.outcome === "success");
  aggregate.failureCount += Number(timing.outcome === "failure");
  aggregate.sub250SuccessCount += Number(
    timing.outcome === "success" &&
      durationMs < ACCOUNT_POSITIONS_TIMING_MIN_MS,
  );
  aggregate.totalDurationMs += durationMs;
  aggregate.maxDurationMs = Math.max(aggregate.maxDurationMs, durationMs);

  let matchedDurationBucket = false;
  for (const [bucket, upperBoundMs] of ACCOUNT_POSITIONS_DURATION_BUCKETS) {
    if (durationMs <= upperBoundMs) {
      aggregate.durationBuckets[bucket] += 1;
      matchedDurationBucket = true;
    }
  }
  if (!matchedDurationBucket) {
    aggregate.durationBuckets.gt2500 += 1;
  }

  aggregate.universeCache[timing.universeCache ?? "unknown"] += 1;
  aggregate.positionsCache[timing.positionsCache ?? "unknown"] += 1;
  for (const stage of ACCOUNT_POSITIONS_STAGE_NAMES) {
    const duration = timing.stagesMs[stage];
    if (typeof duration !== "number" || !Number.isFinite(duration)) {
      continue;
    }
    const current = aggregate.stagesMs[stage] ?? {
      count: 0,
      totalMs: 0,
      maxMs: 0,
    };
    current.count += 1;
    current.totalMs += Math.max(0, duration);
    current.maxMs = Math.max(current.maxMs, Math.max(0, duration));
    aggregate.stagesMs[stage] = current;
  }
}

function accountPositionsTimingAggregateSnapshot(
  aggregate: AccountPositionsTimingAggregate,
) {
  return {
    count: aggregate.count,
    successCount: aggregate.successCount,
    failureCount: aggregate.failureCount,
    sub250SuccessCount: aggregate.sub250SuccessCount,
    durationMs: {
      total: roundedDiagnosticMs(aggregate.totalDurationMs),
      average:
        aggregate.count > 0
          ? roundedDiagnosticMs(aggregate.totalDurationMs / aggregate.count)
          : 0,
      max: roundedDiagnosticMs(aggregate.maxDurationMs),
      buckets: { ...aggregate.durationBuckets },
    },
    universeCache: { ...aggregate.universeCache },
    positionsCache: { ...aggregate.positionsCache },
    stagesMs: Object.fromEntries(
      ACCOUNT_POSITIONS_STAGE_NAMES.flatMap((stage) => {
        const value = aggregate.stagesMs[stage];
        return value
          ? [
              [
                stage,
                {
                  count: value.count,
                  average: roundedDiagnosticMs(value.totalMs / value.count),
                  max: roundedDiagnosticMs(value.maxMs),
                },
              ] as const,
            ]
          : [];
      }),
    ),
  };
}

function accountPositionsTimingSummary() {
  return {
    total: accountPositionsTimingAggregateSnapshot(
      accountPositionsTimingAggregate,
    ),
    families: Object.fromEntries(
      Array.from(
        accountPositionsTimingAggregateByFamily,
        ([family, aggregate]) => [
          family,
          accountPositionsTimingAggregateSnapshot(aggregate),
        ],
      ),
    ),
  };
}

function recordAccountPositionsTimingAggregate(
  timing: AccountPositionsTiming,
): void {
  addAccountPositionsTimingToAggregate(accountPositionsTimingAggregate, timing);
  const family = `${timing.detail}:${timing.liveQuotes ? "quotes-on" : "quotes-off"}`;
  const aggregate =
    accountPositionsTimingAggregateByFamily.get(family) ??
    emptyAccountPositionsTimingAggregate();
  accountPositionsTimingAggregateByFamily.set(family, aggregate);
  addAccountPositionsTimingToAggregate(aggregate, timing);
}

const REQUEST_CORRELATION_TEXT_KEYS = [
  "requestId",
  "routeClass",
  "requestFamily",
  "clientRole",
  "requestOrigin",
  "admissionAction",
  "workloadFamily",
] as const satisfies ReadonlyArray<keyof PostgresDiagnosticContext>;

function currentRequestCorrelation(): JsonRecord | null {
  const context = getPostgresDiagnosticContext();
  if (!context) return null;
  const correlation: JsonRecord = {};
  for (const key of REQUEST_CORRELATION_TEXT_KEYS) {
    const value = context[key];
    const safeValue = safeRuntimeDiagnosticText(value, 128);
    if (safeValue) correlation[key] = safeValue;
  }
  if (
    typeof context.fetchPriority === "number" &&
    Number.isFinite(context.fetchPriority)
  ) {
    correlation["fetchPriority"] = context.fetchPriority;
  }
  return Object.keys(correlation).length > 0 ? correlation : null;
}

function appendAccountPositionsTiming(
  timing: AccountPositionsTiming,
  nowMs: number = Date.now(),
): void {
  try {
    recordAccountPositionsTimingAggregate(timing);
    if (
      timing.outcome === "success" &&
      timing.totalDurationMs < ACCOUNT_POSITIONS_TIMING_MIN_MS
    ) {
      return;
    }
    const family = `${timing.detail}:${timing.liveQuotes ? "quotes-on" : "quotes-off"}:${timing.outcome}`;
    const state = accountPositionsTimingRateByFamily.get(family) ?? {
      lastEmittedAt: Number.NEGATIVE_INFINITY,
      suppressedSinceEmit: 0,
    };
    accountPositionsTimingRateByFamily.set(family, state);
    if (nowMs - state.lastEmittedAt < ACCOUNT_POSITIONS_TIMING_RATE_MS) {
      state.suppressedSinceEmit += 1;
      return;
    }

    const stagesMs = Object.fromEntries(
      ACCOUNT_POSITIONS_STAGE_NAMES.flatMap((stage) => {
        const durationMs = timing.stagesMs[stage];
        return typeof durationMs === "number" && Number.isFinite(durationMs)
          ? [[stage, durationMs] as const]
          : [];
      }),
    );
    const detail: JsonRecord = {
      detail: timing.detail,
      liveQuotes: timing.liveQuotes,
      outcome: timing.outcome,
      universeCache: timing.universeCache,
      positionsCache: timing.positionsCache,
      positionCount: timing.positionCount,
      rowCount: timing.rowCount,
      stagesMs,
      totalDurationMs: timing.totalDurationMs,
    };
    const correlation = currentRequestCorrelation();
    if (correlation) detail["correlation"] = correlation;
    if (state.suppressedSinceEmit > 0) {
      detail["suppressedCount"] = state.suppressedSinceEmit;
    }
    state.lastEmittedAt = nowMs;
    state.suppressedSinceEmit = 0;
    appendRuntimeFlightRecorderEvent("api-account-positions-timing", detail);
  } catch {
    // Diagnostics must never affect account reads.
  }
}

export function recordAccountPositionsTiming(
  timing: AccountPositionsTiming,
): void {
  appendAccountPositionsTiming(timing);
}

export function __appendAccountPositionsTimingForTests(
  timing: AccountPositionsTiming,
  nowMs?: number,
): void {
  appendAccountPositionsTiming(timing, nowMs);
}

export function __resetAccountPositionsTimingRateLimitForTests(): void {
  accountPositionsTimingRateByFamily.clear();
  accountPositionsTimingAggregate = emptyAccountPositionsTimingAggregate();
  accountPositionsTimingAggregateByFamily.clear();
}

export function __getAccountPositionsTimingSummaryForTests() {
  return accountPositionsTimingSummary();
}

function appendWorkGovernorTiming(
  timing: WorkGovernorTiming,
  nowMs: number = Date.now(),
): void {
  if (
    timing.outcome === "success" &&
    timing.totalDurationMs < WORK_GOVERNOR_TIMING_MIN_MS
  ) {
    return;
  }
  const family = `${timing.category}:${timing.operation ?? "unknown"}:${timing.outcome}`;
  const state = workGovernorTimingRateByFamily.get(family) ?? {
    lastEmittedAt: Number.NEGATIVE_INFINITY,
    suppressedSinceEmit: 0,
  };
  workGovernorTimingRateByFamily.set(family, state);
  if (nowMs - state.lastEmittedAt < WORK_GOVERNOR_TIMING_RATE_MS) {
    state.suppressedSinceEmit += 1;
    return;
  }

  const detail: JsonRecord = { ...timing };
  const correlation = currentRequestCorrelation();
  if (correlation) detail["correlation"] = correlation;
  if (state.suppressedSinceEmit > 0) {
    detail["suppressedCount"] = state.suppressedSinceEmit;
  }
  state.lastEmittedAt = nowMs;
  state.suppressedSinceEmit = 0;
  appendRuntimeFlightRecorderEvent("api-work-governor-timing", detail);
}

export function __appendWorkGovernorTimingForTests(
  timing: WorkGovernorTiming,
  nowMs?: number,
): void {
  appendWorkGovernorTiming(timing, nowMs);
}

export function __resetWorkGovernorTimingRateLimitForTests(): void {
  workGovernorTimingRateByFamily.clear();
}

type SlowEventRateState = {
  windowStartMs: number;
  countInWindow: number;
  suppressedSinceEmit: number;
  lastThrottledEmitAt: number;
};

const slowEventRateStateByFamily = new Map<
  string | typeof SLOW_EVENT_RATE_OVERFLOW_FAMILY,
  SlowEventRateState
>();
let slowEventIntradayBytes = 0;
let slowEventIntradayDateKey = "";
let slowEventCapNoticeEmitted = false;
let slowEventIntradayByteCap = SLOW_EVENT_INTRADAY_BYTE_CAP_DEFAULT;

function appendPostgresPoolDiagnosticEvent(
  event: PostgresPoolDiagnosticEvent,
  nowMs: number = Date.now(),
): void {
  const eventName =
    event.type === "acquire" ? "api-db-pool-acquire-slow" : "api-db-query-slow";
  const contextFamily = [
    event.lane,
    event.context?.workloadFamily,
    event.context?.route,
  ]
    .filter((value): value is string => Boolean(value))
    .join(":");
  const requestedFamily = `${event.type}:${
    event.queryName ??
    (event.sql ? event.sql.slice(0, 60) : contextFamily || "unknown")
  }`;
  // ponytail: one overflow bucket bounds memory without letting rotating names
  // reset the rate limit; split it only if operational evidence needs attribution.
  const family =
    slowEventRateStateByFamily.has(requestedFamily) ||
    slowEventRateStateByFamily.size < SLOW_EVENT_RATE_MAX_FAMILY_STATES - 1
      ? requestedFamily
      : SLOW_EVENT_RATE_OVERFLOW_FAMILY;

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
    lane: event.lane,
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

export function __getPostgresPoolDiagnosticRateLimitFamilyCountForTests(): number {
  return slowEventRateStateByFamily.size;
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
  setWorkGovernorTimingListener(appendWorkGovernorTiming);
}

export function installRuntimeFlightRecorderProcessHandlers(): void {
  if (processHandlersInstalled) return;
  processHandlersInstalled = true;
  process.on("warning", (warning) => {
    appendRuntimeFlightRecorderEvent(
      "node-warning",
      sanitizeRuntimeDiagnosticRecord({
        name: warning.name,
        message: warning.message,
        stack: warning.stack?.split("\n").slice(0, 8).join("\n") ?? null,
      }),
    );
  });
  process.on("uncaughtExceptionMonitor", (error) => {
    appendRuntimeFlightRecorderEvent(
      "uncaught-exception",
      sanitizeRuntimeDiagnosticRecord({
        name: error.name,
        message: error.message,
        stack: error.stack?.split("\n").slice(0, 8).join("\n") ?? null,
      }),
    );
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
  const parsed = safeReadJson(importedPath(), IMPORTED_INCIDENT_IDS_MAX_BYTES);
  if (Array.isArray(parsed)) {
    return new Set(
      parsed
        .slice(-MAX_IMPORTED_INCIDENT_IDS)
        .map((value) =>
          safeRuntimeDiagnosticText(value, MAX_IMPORTED_INCIDENT_ID_LENGTH),
        )
        .filter((value): value is string => Boolean(value)),
    );
  }
  return new Set();
}

function writeImportedIncidentIds(ids: Set<string>): void {
  const values = [...ids].slice(-MAX_IMPORTED_INCIDENT_IDS);
  atomicWriteJson(importedPath(), values);
}

function incidentSeverity(incident: RuntimeIncident): DiagnosticSeverity {
  if (incident.severity === "warning" || incident.severity === "info") {
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
  const incidents = readRuntimeIncidentTail(path.join(dir, "incidents.jsonl"), {
    maxRecords: MAX_IMPORTED_INCIDENT_IDS,
  })
    .records.slice()
    .reverse();
  const importedIds = readImportedIncidentIds();
  let imported = 0;
  let skipped = 0;

  for (const incident of incidents) {
    const incidentId = safeRuntimeDiagnosticText(
      incident.incidentId ??
        `${incident.classification ?? "unknown"}:${incident.observedAt ?? ""}`,
      MAX_IMPORTED_INCIDENT_ID_LENGTH,
    );
    if (!incidentId || importedIds.has(incidentId)) {
      skipped += 1;
      continue;
    }
    await record({
      subsystem: "runtime",
      category: "replit-restart",
      code: safeRuntimeDiagnosticText(incident.classification, 96) ?? "unknown",
      severity: incidentSeverity(incident),
      message:
        safeRuntimeDiagnosticText(incident.message, 2_000) ??
        `Previous Replit/PYRUS run classified as ${
          safeRuntimeDiagnosticText(incident.classification, 96) ?? "unknown"
        }.`,
      dimensions: {
        incidentId,
        classification: safeRuntimeDiagnosticText(incident.classification, 96),
        confidence: safeRuntimeDiagnosticText(incident.confidence, 32),
      },
      raw: sanitizeRuntimeDiagnosticRecord(incident),
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
  const supervisorCurrent = readCurrentGuestSupervisorMarker(dir);
  const apiCurrent = safeReadJson(
    path.join(dir, "api-current.json"),
  ) as JsonRecord | null;
  const incidentTail = readRuntimeIncidentTail(
    path.join(dir, "incidents.jsonl"),
  );
  const latestIncident = incidentTail.records[0]
    ? sanitizeRuntimeDiagnosticRecord(incidentTail.records[0])
    : null;
  const apiUpdatedAt =
    typeof apiCurrent?.["updatedAt"] === "string"
      ? apiCurrent["updatedAt"]
      : null;
  const supervisorUpdatedAt =
    typeof supervisorCurrent?.["updatedAt"] === "string"
      ? supervisorCurrent["updatedAt"]
      : null;
  const workspaceTestProcesses = getWorkspaceTestProcessDiagnostics();
  const dbPool = apiCurrent?.["dbPool"] as JsonRecord | undefined;
  const authDbPool = dbPool?.["authPool"] as JsonRecord | undefined;
  const tradingDbPool = dbPool?.["tradingPool"] as JsonRecord | undefined;
  const accountPositions =
    (apiCurrent?.["accountPositions"] as JsonRecord | undefined) ??
    accountPositionsTimingSummary();
  const accountPositionsTotal = accountPositions["total"] as
    | JsonRecord
    | undefined;

  return {
    metrics: {
      recorderDir: dir,
      flightRecorderDroppedJsonLineCount: droppedJsonLineCount,
      supervisorUpdatedAt,
      apiUpdatedAt,
      incidentCount: incidentTail.records.length,
      incidentHistoryTruncated: incidentTail.truncated,
      incidentFileBytes: incidentTail.fileSize,
      latestIncidentClassification: latestIncident?.classification ?? null,
      latestIncidentConfidence: latestIncident?.confidence ?? null,
      latestIncidentObservedAt: latestIncident?.observedAt ?? null,
      apiPressureLevel:
        (apiCurrent?.["apiPressure"] as JsonRecord | undefined)?.["level"] ??
        null,
      apiRssMb:
        (apiCurrent?.["memoryMb"] as JsonRecord | undefined)?.["rss"] ?? null,
      apiRequestP95Ms:
        (apiCurrent?.["requests"] as JsonRecord | undefined)?.["p95Ms"] ?? null,
      apiDbPoolWaiting:
        (apiCurrent?.["dbPool"] as JsonRecord | undefined)?.["waiting"] ?? null,
      apiDbPoolTotalWaiting:
        (apiCurrent?.["dbPool"] as JsonRecord | undefined)?.["totalWaiting"] ??
        (apiCurrent?.["dbPool"] as JsonRecord | undefined)?.["waiting"] ??
        null,
      apiDbPoolRawWaiting:
        (apiCurrent?.["dbPool"] as JsonRecord | undefined)?.["rawPoolWaiting"] ??
        null,
      apiDbPoolAdmissionWaiting:
        (apiCurrent?.["dbPool"] as JsonRecord | undefined)?.[
          "admissionWaiting"
        ] ?? null,
      apiDbPoolAdmissionBacklog:
        (apiCurrent?.["dbPool"] as JsonRecord | undefined)?.[
          "admissionBacklog"
        ] ?? null,
      apiDbPoolAppSaturated:
        (apiCurrent?.["dbPool"] as JsonRecord | undefined)?.[
          "appPoolSaturated"
        ] ?? null,
      apiDbPoolActive:
        (apiCurrent?.["dbPool"] as JsonRecord | undefined)?.["active"] ?? null,
      apiDbPoolTotal:
        (apiCurrent?.["dbPool"] as JsonRecord | undefined)?.["total"] ?? null,
      apiDbPoolMax:
        (apiCurrent?.["dbPool"] as JsonRecord | undefined)?.["max"] ?? null,
      apiAuthDbPoolActive: authDbPool?.["active"] ?? null,
      apiAuthDbPoolRawWaiting: authDbPool?.["rawPoolWaiting"] ?? null,
      apiAuthDbPoolSaturated: authDbPool?.["appPoolSaturated"] ?? null,
      apiTradingDbPoolActive: tradingDbPool?.["active"] ?? null,
      apiTradingDbPoolRawWaiting: tradingDbPool?.["rawPoolWaiting"] ?? null,
      apiTradingDbPoolSaturated: tradingDbPool?.["appPoolSaturated"] ?? null,
      apiAccountPositionsRequestCount: accountPositionsTotal?.["count"] ?? 0,
      apiAccountPositionsSuccessCount:
        accountPositionsTotal?.["successCount"] ?? 0,
      apiAccountPositionsFailureCount:
        accountPositionsTotal?.["failureCount"] ?? 0,
      apiAccountPositionsSub250SuccessCount:
        accountPositionsTotal?.["sub250SuccessCount"] ?? 0,
      workspaceTestProcessScanEnabled: workspaceTestProcesses.enabled,
      workspaceTestProcessCount: workspaceTestProcesses.count,
      workspaceLongRunningTestProcessCount:
        workspaceTestProcesses.longRunningCount,
      workspaceTestProcessMaxAgeMs: workspaceTestProcesses.maxAgeMs,
    },
    raw: {
      supervisorCurrent,
      apiCurrent,
      accountPositions,
      latestIncident,
      workspaceTestProcesses: workspaceTestProcesses.processes,
    },
  };
}
