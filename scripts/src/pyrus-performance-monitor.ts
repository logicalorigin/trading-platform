export {};

import { createRequire } from "node:module";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type JsonRecord = Record<string, unknown>;

type FetchResult = {
  path: string;
  ok: boolean;
  status: number | null;
  latencyMs: number;
  value: JsonRecord | null;
  error: string | null;
};

type ProcessSnapshot = {
  pid: number;
  role: string;
  rssMb: number | null;
  threads: number | null;
  fdCount: number | null;
  cpuTicks: number | null;
};

type BrowserSample = {
  at: string;
  ok: boolean;
  url: string | null;
  title: string | null;
  bodyTextLength: number | null;
  domNodeCount: number | null;
  jsHeapUsedMb: number | null;
  apiTimingCount: number;
  longTaskCount: number;
  screenReadyCount: number;
  error: string | null;
};

type MonitorSample = {
  at: string;
  elapsedMs: number;
  health: FetchResult;
  frontendHealth: FetchResult;
  diagnostics: FetchResult;
  runtime: FetchResult;
  lineUsage: FetchResult;
  lanes: FetchResult | null;
  session: FetchResult | null;
  browser: BrowserSample | null;
  processes: ProcessSnapshot[];
  cgroup: JsonRecord;
};

type EndpointStats = {
  calls: number;
  ok: number;
  fail: number;
  latencies: number[];
};

export type MonitorReport = {
  window: {
    startedAt: string | null;
    endedAt: string | null;
    durationSeconds: number;
    samples: number;
  };
  verdict: {
    status: "healthy" | "degraded" | "critical";
    reasons: string[];
  };
  endpoints: Record<string, {
    calls: number;
    ok: number;
    fail: number;
    p50Ms: number | null;
    p95Ms: number | null;
    maxMs: number | null;
  }>;
  api: {
    p95LatencyMs: RangeSummary;
    p99LatencyMs: RangeSummary;
    eventLoopP95Ms: RangeSummary;
    eventLoopMaxMs: RangeSummary;
    heapUsedMb: RangeSummary;
    rssMb: RangeSummary;
    requestCount5m: RangeSummary;
    slowRoutes: JsonRecord[];
  };
  resourcePressure: {
    levels: string[];
    latestDrivers: JsonRecord[];
  };
  browser: {
    enabled: boolean;
    sampleCount: number;
    jsHeapUsedMb: RangeSummary;
    apiTimingCount: RangeSummary;
    longTaskCount: RangeSummary;
    pageErrors: string[];
    consoleErrors: string[];
    requestFailures: string[];
    launchError: string | null;
  };
  ibkr: {
    lineUtilization: RangeSummary;
    admissionActiveLines: RangeSummary;
    bridgeActiveLines: RangeSummary;
    drift: RangeSummary;
    schedulerPressureStates: string[];
  };
  processes: Record<string, {
    pid: number | null;
    rssMb: RangeSummary;
    threads: RangeSummary;
    fdCount: RangeSummary;
    cpuTicksDelta: number | null;
  }>;
  cgroup: {
    memoryCurrentMb: RangeSummary;
    memoryMaxMb: number | null;
    events: JsonRecord;
  };
  diagnosticsEvents: JsonRecord[];
  optimizationCandidates: string[];
};

type RangeSummary = {
  min: number | null;
  avg: number | null;
  max: number | null;
};

type MonitorOptions = {
  seconds: number;
  intervalMs: number;
  deepIntervalMs: number;
  frontendUrl: string;
  apiBaseUrl: string;
  outputDir: string;
  browser: boolean;
  jsonOnly: boolean;
};

type BrowserObserver = {
  launchError: string | null;
  pageErrors: string[];
  consoleErrors: string[];
  requestFailures: string[];
  sample: () => Promise<BrowserSample | null>;
  stop: () => Promise<void>;
};

type PlaywrightPage = {
  addInitScript: (script: string) => Promise<void>;
  goto: (url: string, options: JsonRecord) => Promise<unknown>;
  evaluate: <T>(fn: () => T) => Promise<T>;
  on: (event: string, listener: (...args: any[]) => void) => void;
  waitForTimeout: (ms: number) => Promise<void>;
};

type PlaywrightBrowser = {
  close: () => Promise<void>;
  newContext: (options: JsonRecord) => Promise<{
    newPage: () => Promise<PlaywrightPage>;
  }>;
};

const currentFile = fileURLToPath(import.meta.url);
const scriptsRoot = path.resolve(path.dirname(currentFile), "..");
const repoRoot = path.resolve(scriptsRoot, "..");
const pyrusRoot = path.join(repoRoot, "artifacts/pyrus");
const endpointStats = new Map<string, EndpointStats>();

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseArg(name: string): string | null {
  const prefix = `--${name}=`;
  const match = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

function parsePositiveInteger(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function buildUrl(baseUrl: string, requestPath: string): string {
  const url = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const basePath = url.pathname.replace(/\/+$/, "");
  const separator = requestPath.indexOf("?");
  const pathPart = separator === -1 ? requestPath : requestPath.slice(0, separator);
  const queryPart = separator === -1 ? "" : requestPath.slice(separator + 1);
  const nextPath = pathPart.replace(/^\/+/, "");
  url.pathname = `${basePath}/${nextPath}`.replace(/\/{2,}/g, "/");
  url.search = queryPart ? `?${queryPart}` : "";
  return url.toString();
}

function recordEndpoint(pathKey: string, ok: boolean, latencyMs: number): void {
  const stats = endpointStats.get(pathKey) ?? {
    calls: 0,
    ok: 0,
    fail: 0,
    latencies: [],
  };
  stats.calls += 1;
  if (ok) {
    stats.ok += 1;
  } else {
    stats.fail += 1;
  }
  stats.latencies.push(latencyMs);
  endpointStats.set(pathKey, stats);
}

async function fetchJson(
  baseUrl: string,
  requestPath: string,
  timeoutMs: number,
  pathKey = requestPath,
): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(buildUrl(baseUrl, requestPath), {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    const latencyMs = Date.now() - startedAt;
    recordEndpoint(pathKey, response.ok, latencyMs);
    if (!response.ok) {
      return {
        path: pathKey,
        ok: false,
        status: response.status,
        latencyMs,
        value: null,
        error: `HTTP ${response.status}`,
      };
    }
    const value = (await response.json()) as JsonRecord;
    return {
      path: pathKey,
      ok: true,
      status: response.status,
      latencyMs,
      value,
      error: null,
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    recordEndpoint(pathKey, false, latencyMs);
    return {
      path: pathKey,
      ok: false,
      status: null,
      latencyMs,
      value: null,
      error:
        error instanceof Error && error.name === "AbortError"
          ? `timeout after ${timeoutMs}ms`
          : safeError(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

export function percentile(values: number[], p: number): number | null {
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  if (!sorted.length) return null;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return Math.round(sorted[index] ?? 0);
}

export function numberRange(values: Array<number | null | undefined>): RangeSummary {
  const finiteValues = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
  if (!finiteValues.length) return { min: null, avg: null, max: null };
  return {
    min: Math.min(...finiteValues),
    avg: Number(
      (finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length)
        .toFixed(3),
    ),
    max: Math.max(...finiteValues),
  };
}

export function deltaNumber(first: unknown, last: unknown): number | null {
  const firstNumber = numberValue(first);
  const lastNumber = numberValue(last);
  return firstNumber !== null && lastNumber !== null
    ? Math.round(lastNumber - firstNumber)
    : null;
}

function metricFromSnapshot(sample: MonitorSample, subsystem: string, key: string): number | null {
  const snapshots = asArray(sample.diagnostics.value?.["snapshots"]);
  const snapshot = snapshots.find((entry) => asRecord(entry)["subsystem"] === subsystem);
  const metrics = asRecord(asRecord(snapshot)["metrics"]);
  return numberValue(metrics[key]);
}

function snapshotMetrics(sample: MonitorSample, subsystem: string): JsonRecord {
  const snapshots = asArray(sample.diagnostics.value?.["snapshots"]);
  const snapshot = snapshots.find((entry) => asRecord(entry)["subsystem"] === subsystem);
  return asRecord(asRecord(snapshot)["metrics"]);
}

function endpointSummary(): MonitorReport["endpoints"] {
  return Object.fromEntries(
    Array.from(endpointStats.entries()).map(([pathKey, stats]) => [
      pathKey,
      {
        calls: stats.calls,
        ok: stats.ok,
        fail: stats.fail,
        p50Ms: percentile(stats.latencies, 50),
        p95Ms: percentile(stats.latencies, 95),
        maxMs: stats.latencies.length ? Math.max(...stats.latencies) : null,
      },
    ]),
  );
}

function latestSlowRoutes(samples: MonitorSample[]): JsonRecord[] {
  for (const sample of [...samples].reverse()) {
    const routes = asArray(snapshotMetrics(sample, "api")["slowRoutes"])
      .map(asRecord)
      .filter((entry) => stringValue(entry["path"]));
    if (routes.length) return routes.slice(0, 10);
  }
  return [];
}

function sanitizeDiagnosticEvent(event: JsonRecord): JsonRecord {
  return {
    id: event["id"] ?? null,
    incidentKey: event["incidentKey"] ?? null,
    subsystem: event["subsystem"] ?? null,
    category: event["category"] ?? null,
    code: event["code"] ?? null,
    severity: event["severity"] ?? null,
    status: event["status"] ?? null,
    message: event["message"] ?? event["summary"] ?? null,
    firstSeenAt: event["firstSeenAt"] ?? null,
    lastSeenAt: event["lastSeenAt"] ?? null,
    eventCount: event["eventCount"] ?? null,
    dimensions: asRecord(event["dimensions"]),
  };
}

function latestDiagnosticEvents(samples: MonitorSample[]): JsonRecord[] {
  for (const sample of [...samples].reverse()) {
    const events = asArray(sample.diagnostics.value?.["events"])
      .map(asRecord)
      .map(sanitizeDiagnosticEvent);
    if (events.length) return events.slice(0, 20);
  }
  return [];
}

function distinctStrings(values: unknown[]): string[] {
  return Array.from(
    new Set(values.map(stringValue).filter((value): value is string => Boolean(value))),
  );
}

function collectResourceLevels(samples: MonitorSample[]): string[] {
  return distinctStrings(
    samples.map((sample) => snapshotMetrics(sample, "resource-pressure")["pressureLevel"]),
  );
}

function latestResourceDrivers(samples: MonitorSample[]): JsonRecord[] {
  for (const sample of [...samples].reverse()) {
    const drivers = asArray(snapshotMetrics(sample, "resource-pressure")["dominantDrivers"])
      .map(asRecord);
    if (drivers.length) return drivers.slice(0, 8);
  }
  return [];
}

function processSummary(samples: MonitorSample[]): MonitorReport["processes"] {
  const roles = distinctStrings(
    samples.flatMap((sample) => sample.processes.map((entry) => entry.role)),
  );
  return Object.fromEntries(
    roles.map((role) => {
      const entries = samples
        .flatMap((sample) => sample.processes)
        .filter((entry) => entry.role === role);
      const first = entries[0];
      const last = entries.at(-1);
      return [
        role,
        {
          pid: last?.pid ?? first?.pid ?? null,
          rssMb: numberRange(entries.map((entry) => entry.rssMb)),
          threads: numberRange(entries.map((entry) => entry.threads)),
          fdCount: numberRange(entries.map((entry) => entry.fdCount)),
          cpuTicksDelta: deltaNumber(first?.cpuTicks, last?.cpuTicks),
        },
      ];
    }),
  );
}

function schedulerPressureStates(samples: MonitorSample[]): string[] {
  return distinctStrings(
    samples.flatMap((sample) => {
      const scheduler = asRecord(asRecord(asRecord(sample.lineUsage.value?.["bridge"])["diagnostics"])["scheduler"]);
      return Object.values(scheduler).map((entry) => asRecord(entry)["pressure"]);
    }),
  );
}

function reportStatus(samples: MonitorSample[], browser: BrowserObserver | null): MonitorReport["verdict"] {
  const reasons: string[] = [];
  const latest = samples.at(-1);
  const latestSeverity = stringValue(latest?.diagnostics.value?.["severity"]);
  if (latestSeverity === "critical") {
    reasons.push("Latest diagnostics severity is critical.");
  } else if (latestSeverity === "warning") {
    reasons.push("Latest diagnostics severity is warning.");
  }

  const failedEndpoints = Object.entries(endpointSummary()).filter(([, stats]) => stats.fail > 0);
  if (failedEndpoints.length) {
    reasons.push(`${failedEndpoints.length} sampled endpoint(s) had failures.`);
  }
  if ((browser?.pageErrors.length ?? 0) > 0) {
    reasons.push("Browser observer recorded page errors.");
  }
  if (collectResourceLevels(samples).includes("critical")) {
    reasons.push("Resource pressure reached critical.");
  }

  if (reasons.some((reason) => /critical|page errors/i.test(reason))) {
    return { status: "critical", reasons };
  }
  if (reasons.length) {
    return { status: "degraded", reasons };
  }
  return { status: "healthy", reasons: ["No sampled critical or degraded signals."] };
}

function buildOptimizationCandidates(report: Omit<MonitorReport, "optimizationCandidates">): string[] {
  const candidates: string[] = [];
  const slowRoute = report.api.slowRoutes[0];
  if (slowRoute) {
    candidates.push(
      `Investigate slow route ${String(slowRoute["path"])}: p95 ${String(slowRoute["p95LatencyMs"] ?? "n/a")}ms, max ${String(slowRoute["maxLatencyMs"] ?? "n/a")}ms.`,
    );
  }
  if ((report.api.eventLoopMaxMs.max ?? 0) >= 1_000) {
    candidates.push(`Reduce API event-loop stalls; max observed ${report.api.eventLoopMaxMs.max}ms.`);
  }
  if ((report.api.rssMb.max ?? 0) >= 1_200) {
    candidates.push(`Review API memory/cache pressure; RSS peaked at ${report.api.rssMb.max} MB.`);
  }
  if (report.resourcePressure.latestDrivers.length) {
    const driver = report.resourcePressure.latestDrivers[0];
    candidates.push(
      `Start with resource-pressure driver ${String(driver["label"] ?? driver["kind"])} (${String(driver["detail"] ?? driver["level"] ?? "no detail")}).`,
    );
  }
  if ((report.ibkr.lineUtilization.max ?? 0) >= 0.85) {
    candidates.push(`Tune market-data line allocation; utilization peaked at ${report.ibkr.lineUtilization.max}.`);
  }
  if (report.browser.pageErrors.length || report.browser.requestFailures.length) {
    candidates.push("Fix browser errors/request failures before deeper UI optimization.");
  }
  if ((report.browser.longTaskCount.max ?? 0) > 0) {
    candidates.push(`Inspect client long tasks; browser observer saw ${report.browser.longTaskCount.max} cumulative long tasks.`);
  }
  return candidates.length ? candidates : ["No obvious hotspot crossed the monitor thresholds; compare raw samples before changing behavior."];
}

export function buildReport(
  samples: MonitorSample[],
  browser: BrowserObserver | null,
  diagnosticsEvents: JsonRecord[] = [],
): MonitorReport {
  const browserSamples = samples
    .map((sample) => sample.browser)
    .filter((sample): sample is BrowserSample => Boolean(sample));
  const lineUtilization = samples.map((sample) =>
    numberValue(asRecord(asRecord(sample.lineUsage.value?.["admission"])["pressure"])["utilization"]),
  );
  const cgroupEvents = asRecord(samples.at(-1)?.cgroup["events"]);
  const partial = {
    window: {
      startedAt: samples[0]?.at ?? null,
      endedAt: samples.at(-1)?.at ?? null,
      durationSeconds: samples.length
        ? Math.round((samples.at(-1)?.elapsedMs ?? 0) / 1_000)
        : 0,
      samples: samples.length,
    },
    verdict: reportStatus(samples, browser),
    endpoints: endpointSummary(),
    api: {
      p95LatencyMs: numberRange(samples.map((sample) => metricFromSnapshot(sample, "api", "p95LatencyMs"))),
      p99LatencyMs: numberRange(samples.map((sample) => metricFromSnapshot(sample, "api", "p99LatencyMs"))),
      eventLoopP95Ms: numberRange(samples.map((sample) => metricFromSnapshot(sample, "api", "eventLoopP95Ms"))),
      eventLoopMaxMs: numberRange(samples.map((sample) => metricFromSnapshot(sample, "api", "eventLoopMaxMs"))),
      heapUsedMb: numberRange(samples.map((sample) => metricFromSnapshot(sample, "api", "heapUsedMb"))),
      rssMb: numberRange(samples.map((sample) => metricFromSnapshot(sample, "api", "rssMb"))),
      requestCount5m: numberRange(samples.map((sample) => metricFromSnapshot(sample, "api", "requestCount5m"))),
      slowRoutes: latestSlowRoutes(samples),
    },
    resourcePressure: {
      levels: collectResourceLevels(samples),
      latestDrivers: latestResourceDrivers(samples),
    },
    browser: {
      enabled: Boolean(browser),
      sampleCount: browserSamples.length,
      jsHeapUsedMb: numberRange(browserSamples.map((sample) => sample.jsHeapUsedMb)),
      apiTimingCount: numberRange(browserSamples.map((sample) => sample.apiTimingCount)),
      longTaskCount: numberRange(browserSamples.map((sample) => sample.longTaskCount)),
      pageErrors: browser?.pageErrors.slice(-20) ?? [],
      consoleErrors: browser?.consoleErrors.slice(-20) ?? [],
      requestFailures: browser?.requestFailures.slice(-20) ?? [],
      launchError: browser?.launchError ?? null,
    },
    ibkr: {
      lineUtilization: numberRange(lineUtilization),
      admissionActiveLines: numberRange(samples.map((sample) => numberValue(asRecord(sample.lineUsage.value?.["admission"])["activeLineCount"]))),
      bridgeActiveLines: numberRange(samples.map((sample) => numberValue(asRecord(sample.lineUsage.value?.["bridge"])["activeLineCount"]))),
      drift: numberRange(samples.map((sample) => numberValue(asRecord(sample.lineUsage.value?.["drift"])["admissionVsBridgeLineDelta"]))),
      schedulerPressureStates: schedulerPressureStates(samples),
    },
    processes: processSummary(samples),
    cgroup: {
      memoryCurrentMb: numberRange(samples.map((sample) => numberValue(sample.cgroup["memoryCurrentMb"]))),
      memoryMaxMb: numberValue(samples.at(-1)?.cgroup["memoryMaxMb"]),
      events: cgroupEvents,
    },
    diagnosticsEvents: diagnosticsEvents.length ? diagnosticsEvents : latestDiagnosticEvents(samples),
  };
  return {
    ...partial,
    optimizationCandidates: buildOptimizationCandidates(partial),
  };
}

function formatRange(range: RangeSummary, suffix = ""): string {
  if (range.max === null) return "n/a";
  return `${range.min}${suffix} / ${range.avg}${suffix} / ${range.max}${suffix}`;
}

function markdownTable(rows: string[][]): string {
  if (!rows.length) return "";
  const header = rows[0]!;
  const body = rows.slice(1);
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...body.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

export function renderMarkdownReport(report: MonitorReport): string {
  const endpointRows = [
    ["Endpoint", "Calls", "Fail", "P95", "Max"],
    ...Object.entries(report.endpoints).map(([pathKey, stats]) => [
      pathKey,
      String(stats.calls),
      String(stats.fail),
      stats.p95Ms === null ? "n/a" : `${stats.p95Ms}ms`,
      stats.maxMs === null ? "n/a" : `${stats.maxMs}ms`,
    ]),
  ];
  const processRows = [
    ["Role", "PID", "RSS min/avg/max", "Threads", "FDs", "CPU ticks Δ"],
    ...Object.entries(report.processes).map(([role, stats]) => [
      role,
      stats.pid === null ? "n/a" : String(stats.pid),
      formatRange(stats.rssMb, " MB"),
      formatRange(stats.threads),
      formatRange(stats.fdCount),
      stats.cpuTicksDelta === null ? "n/a" : String(stats.cpuTicksDelta),
    ]),
  ];
  const slowRouteRows = [
    ["Route", "P95", "Max", "Slow Count"],
    ...report.api.slowRoutes.slice(0, 8).map((route) => [
      String(route["path"] ?? "unknown"),
      `${String(route["p95LatencyMs"] ?? "n/a")}ms`,
      `${String(route["maxLatencyMs"] ?? "n/a")}ms`,
      String(route["slowCount5m"] ?? "n/a"),
    ]),
  ];

  return [
    "# PYRUS 15-Minute Performance Monitor",
    "",
    `- Window: ${report.window.startedAt ?? "n/a"} to ${report.window.endedAt ?? "n/a"}`,
    `- Samples: ${report.window.samples}`,
    `- Verdict: ${report.verdict.status.toUpperCase()}`,
    `- Reasons: ${report.verdict.reasons.join(" ")}`,
    "",
    "## Optimization Candidates",
    ...report.optimizationCandidates.map((candidate) => `- ${candidate}`),
    "",
    "## API Runtime",
    `- API p95 latency min/avg/max: ${formatRange(report.api.p95LatencyMs, "ms")}`,
    `- API p99 latency min/avg/max: ${formatRange(report.api.p99LatencyMs, "ms")}`,
    `- Event loop p95 min/avg/max: ${formatRange(report.api.eventLoopP95Ms, "ms")}`,
    `- Event loop max min/avg/max: ${formatRange(report.api.eventLoopMaxMs, "ms")}`,
    `- Heap used min/avg/max: ${formatRange(report.api.heapUsedMb, " MB")}`,
    `- RSS min/avg/max: ${formatRange(report.api.rssMb, " MB")}`,
    "",
    "## Slow Routes",
    markdownTable(slowRouteRows),
    "",
    "## Browser Observer",
    `- Enabled: ${report.browser.enabled ? "yes" : "no"}`,
    `- Launch error: ${report.browser.launchError ?? "none"}`,
    `- JS heap min/avg/max: ${formatRange(report.browser.jsHeapUsedMb, " MB")}`,
    `- API timing count min/avg/max: ${formatRange(report.browser.apiTimingCount)}`,
    `- Long task count min/avg/max: ${formatRange(report.browser.longTaskCount)}`,
    `- Page errors: ${report.browser.pageErrors.length}`,
    `- Console errors: ${report.browser.consoleErrors.length}`,
    `- Request failures: ${report.browser.requestFailures.length}`,
    "",
    "## IBKR And Market Data",
    `- Line utilization min/avg/max: ${formatRange(report.ibkr.lineUtilization)}`,
    `- Admission active lines min/avg/max: ${formatRange(report.ibkr.admissionActiveLines)}`,
    `- Bridge active lines min/avg/max: ${formatRange(report.ibkr.bridgeActiveLines)}`,
    `- Drift min/avg/max: ${formatRange(report.ibkr.drift)}`,
    `- Scheduler pressure states: ${report.ibkr.schedulerPressureStates.join(", ") || "none"}`,
    "",
    "## Resource Pressure",
    `- Levels observed: ${report.resourcePressure.levels.join(", ") || "none"}`,
    `- Cgroup memory current min/avg/max: ${formatRange(report.cgroup.memoryCurrentMb, " MB")}`,
    `- Cgroup memory max: ${report.cgroup.memoryMaxMb === null ? "n/a" : `${report.cgroup.memoryMaxMb} MB`}`,
    "",
    "## Processes",
    markdownTable(processRows),
    "",
    "## Endpoint Sampling",
    markdownTable(endpointRows),
    "",
    "## Diagnostics Events",
    report.diagnosticsEvents.length
      ? report.diagnosticsEvents
          .slice(0, 12)
          .map((event) => `- ${String(event["subsystem"] ?? "unknown")} ${String(event["severity"] ?? "info")}: ${String(event["message"] ?? event["summary"] ?? "no message")}`)
          .join("\n")
      : "- No open diagnostics events captured.",
    "",
  ].join("\n");
}

async function discoverProcesses(): Promise<Array<{ pid: number; role: string }>> {
  const discovered: Array<{ pid: number; role: string }> = [];
  try {
    const entries = await readdir("/proc", { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
      const pid = Number(entry.name);
      const cmdline = await readFile(`/proc/${entry.name}/cmdline`, "utf8")
        .then((value) => value.replace(/\0/g, " "))
        .catch(() => "");
      if (!cmdline) continue;
      if (cmdline.includes("./dist/index.mjs") && cmdline.includes("api-server")) {
        discovered.push({ pid, role: "api" });
      } else if (cmdline.includes("./dist/index.mjs") && discovered.every((item) => item.role !== "api")) {
        discovered.push({ pid, role: "api" });
      } else if (cmdline.includes("vite") && cmdline.includes("vite.config.ts")) {
        discovered.push({ pid, role: "web" });
      } else if (cmdline.includes("runDevApp.mjs")) {
        discovered.push({ pid, role: "supervisor" });
      }
    }
  } catch {
    return discovered;
  }
  return discovered;
}

async function readProcessSnapshot(processInfo: { pid: number; role: string }): Promise<ProcessSnapshot | null> {
  try {
    const [status, stat] = await Promise.all([
      readFile(`/proc/${processInfo.pid}/status`, "utf8"),
      readFile(`/proc/${processInfo.pid}/stat`, "utf8").catch(() => ""),
    ]);
    const rssKb = Number((status.match(/^VmRSS:\s+(\d+)/m) ?? [])[1]);
    const threads = Number((status.match(/^Threads:\s+(\d+)/m) ?? [])[1]);
    const statFields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/);
    const userTicks = Number(statFields[11]);
    const systemTicks = Number(statFields[12]);
    const fdCount = await readdir(`/proc/${processInfo.pid}/fd`)
      .then((entries) => entries.length)
      .catch(() => null);
    return {
      pid: processInfo.pid,
      role: processInfo.role,
      rssMb: Number.isFinite(rssKb) ? Math.round(rssKb / 1024) : null,
      threads: Number.isFinite(threads) ? threads : null,
      fdCount,
      cpuTicks:
        Number.isFinite(userTicks) && Number.isFinite(systemTicks)
          ? userTicks + systemTicks
          : null,
    };
  } catch {
    return null;
  }
}

async function readProcessSnapshots(processes: Array<{ pid: number; role: string }>): Promise<ProcessSnapshot[]> {
  const snapshots = await Promise.all(processes.map(readProcessSnapshot));
  return snapshots.filter((snapshot): snapshot is ProcessSnapshot => Boolean(snapshot));
}

function parseMemoryMax(raw: string): number | null {
  const text = raw.trim();
  if (!text || text === "max") return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? Math.round(parsed / 1024 / 1024) : null;
}

function parseMemoryEvents(raw: string): JsonRecord {
  return Object.fromEntries(
    raw
      .split("\n")
      .map((line) => line.trim().split(/\s+/))
      .filter((parts) => parts.length === 2)
      .map(([key, value]) => [key!, Number(value)]),
  );
}

async function readCgroupSnapshot(): Promise<JsonRecord> {
  const base = "/sys/fs/cgroup";
  const [currentRaw, maxRaw, eventsRaw] = await Promise.all([
    readFile(path.join(base, "memory.current"), "utf8").catch(() => ""),
    readFile(path.join(base, "memory.max"), "utf8").catch(() => ""),
    readFile(path.join(base, "memory.events"), "utf8").catch(() => ""),
  ]);
  const current = Number(currentRaw.trim());
  return {
    memoryCurrentMb: Number.isFinite(current) ? Math.round(current / 1024 / 1024) : null,
    memoryMaxMb: maxRaw ? parseMemoryMax(maxRaw) : null,
    events: eventsRaw ? parseMemoryEvents(eventsRaw) : {},
  };
}

async function resolveChromiumExecutable(): Promise<string | null> {
  const preparePath = path.join(pyrusRoot, "scripts/preparePlaywrightChromium.mjs");
  if (!existsSync(preparePath)) return null;
  try {
    const module = await import(pathToFileURL(preparePath).href) as {
      ensurePatchedPlaywrightChromium?: () => Promise<string>;
    };
    return module.ensurePatchedPlaywrightChromium
      ? await module.ensurePatchedPlaywrightChromium()
      : null;
  } catch {
    return null;
  }
}

async function startBrowserObserver(frontendUrl: string): Promise<BrowserObserver> {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const requestFailures: string[] = [];
  let browser: PlaywrightBrowser | null = null;
  let page: PlaywrightPage | null = null;

  try {
    const require = createRequire(import.meta.url);
    const playwrightPath = require.resolve("@playwright/test", { paths: [pyrusRoot] });
    const playwright = require(playwrightPath) as {
      chromium: {
        launch: (options: JsonRecord) => Promise<PlaywrightBrowser>;
      };
    };
    const executablePath = await resolveChromiumExecutable();
    browser = await playwright.chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    page = await context.newPage();
    if (!page) {
      throw new Error("Playwright did not create a page.");
    }
    page.on("pageerror", (error: unknown) => {
      pageErrors.push(safeError(error));
    });
    page.on("console", (message: { type: () => string; text: () => string }) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });
    page.on("requestfailed", (request: { method: () => string; url: () => string; failure: () => { errorText?: string } | null }) => {
      const failureText = request.failure()?.errorText ?? "";
      if (!/ERR_ABORTED/.test(failureText)) {
        requestFailures.push(`${request.method()} ${request.url()} ${failureText}`.trim());
      }
    });
    await page.addInitScript(`
      (() => {
        const boundedPush = (target, value, max) => {
          target.push(value);
          if (target.length > max) target.splice(0, target.length - max);
        };
        window.__PYRUS_MONITOR__ = {
          apiTimings: [],
          longTasks: [],
          screenReady: []
        };
        window.addEventListener("pyrus:api-request-timing", (event) => {
          boundedPush(window.__PYRUS_MONITOR__.apiTimings, event.detail || {}, 240);
        });
        window.addEventListener("pyrus:screen-ready", (event) => {
          boundedPush(window.__PYRUS_MONITOR__.screenReady, event.detail || {}, 80);
        });
        if (typeof PerformanceObserver !== "undefined" &&
            PerformanceObserver.supportedEntryTypes &&
            PerformanceObserver.supportedEntryTypes.includes("longtask")) {
          try {
            const observer = new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) {
                boundedPush(window.__PYRUS_MONITOR__.longTasks, {
                  name: entry.name || "longtask",
                  durationMs: Math.round(entry.duration),
                  startedAtMs: Math.round(entry.startTime),
                  observedAt: new Date().toISOString()
                }, 160);
              }
            });
            observer.observe({ entryTypes: ["longtask"] });
          } catch {}
        }
      })();
    `);
    await page.goto(frontendUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(1_000);
  } catch (error) {
    const launchError = safeError(error);
    return {
      launchError,
      pageErrors,
      consoleErrors,
      requestFailures,
      sample: async () => ({
        at: nowIso(),
        ok: false,
        url: null,
        title: null,
        bodyTextLength: null,
        domNodeCount: null,
        jsHeapUsedMb: null,
        apiTimingCount: 0,
        longTaskCount: 0,
        screenReadyCount: 0,
        error: launchError,
      }),
      stop: async () => {
        if (browser) await browser.close();
      },
    };
  }

  return {
    launchError: null,
    pageErrors,
    consoleErrors,
    requestFailures,
    sample: async () => {
      if (!page) return null;
      try {
        return await page.evaluate<BrowserSample>(() => {
          const win = globalThis as any;
          const doc = win.document;
          const perf = win.performance || {};
          const monitor = win.__PYRUS_MONITOR__ || {};
          const memory = perf.memory || {};
          return {
            at: new Date().toISOString(),
            ok: true,
            url: win.location?.href ?? null,
            title: doc?.title ?? null,
            bodyTextLength: doc?.body?.innerText?.length ?? 0,
            domNodeCount: doc?.querySelectorAll("*")?.length ?? 0,
            jsHeapUsedMb:
              typeof memory.usedJSHeapSize === "number"
                ? Math.round(memory.usedJSHeapSize / 1024 / 1024)
                : null,
            apiTimingCount: Array.isArray(monitor.apiTimings) ? monitor.apiTimings.length : 0,
            longTaskCount: Array.isArray(monitor.longTasks) ? monitor.longTasks.length : 0,
            screenReadyCount: Array.isArray(monitor.screenReady) ? monitor.screenReady.length : 0,
            error: null,
          };
        });
      } catch (error) {
        return {
          at: nowIso(),
          ok: false,
          url: null,
          title: null,
          bodyTextLength: null,
          domNodeCount: null,
          jsHeapUsedMb: null,
          apiTimingCount: 0,
          longTaskCount: 0,
          screenReadyCount: 0,
          error: safeError(error),
        };
      }
    },
    stop: async () => {
      if (browser) await browser.close();
    },
  };
}

function parseOptions(): MonitorOptions {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return {
    seconds: parsePositiveInteger(parseArg("seconds"), 900),
    intervalMs: parsePositiveInteger(parseArg("interval-ms"), 5_000),
    deepIntervalMs: parsePositiveInteger(parseArg("deep-interval-ms"), 30_000),
    frontendUrl:
      parseArg("frontend-url") ??
      process.env["PYRUS_MONITOR_FRONTEND_URL"] ??
      "http://127.0.0.1:18747/",
    apiBaseUrl:
      parseArg("api-base-url") ??
      process.env["PYRUS_MONITOR_API_BASE_URL"] ??
      "http://127.0.0.1:8080/api",
    outputDir:
      parseArg("output-dir") ??
      path.join(repoRoot, "scripts/reports/pyrus-performance-monitor", timestamp),
    browser: !hasFlag("no-browser"),
    jsonOnly: hasFlag("json-only"),
  };
}

async function collectDiagnosticsEvents(apiBaseUrl: string, startedAt: string): Promise<JsonRecord[]> {
  const to = encodeURIComponent(nowIso());
  const from = encodeURIComponent(startedAt);
  const response = await fetchJson(
    apiBaseUrl,
    `/diagnostics/events?from=${from}&to=${to}&limit=200`,
    5_000,
    "/diagnostics/events",
  );
  return asArray(response.value?.["events"] ?? response.value)
    .map(asRecord)
    .map(sanitizeDiagnosticEvent);
}

async function collectSample(
  options: MonitorOptions,
  startedAtMs: number,
  index: number,
  processes: Array<{ pid: number; role: string }>,
  browser: BrowserObserver | null,
): Promise<MonitorSample> {
  const deep = index === 0 || index * options.intervalMs % options.deepIntervalMs === 0;
  const frontendApiBase = buildUrl(options.frontendUrl, "/api");
  const [
    health,
    frontendHealth,
    diagnostics,
    runtime,
    lineUsage,
    lanes,
    session,
    browserSample,
    processSnapshots,
    cgroup,
  ] = await Promise.all([
    fetchJson(options.apiBaseUrl, "/healthz", 2_500),
    fetchJson(frontendApiBase, "/healthz", 2_500, "frontend:/api/healthz"),
    fetchJson(options.apiBaseUrl, "/diagnostics/latest", 5_000),
    fetchJson(options.apiBaseUrl, "/diagnostics/runtime", 8_000),
    fetchJson(options.apiBaseUrl, "/settings/ibkr-line-usage", 8_000),
    deep
      ? fetchJson(options.apiBaseUrl, "/settings/ibkr-lanes", 10_000)
      : Promise.resolve(null),
    deep
      ? fetchJson(options.apiBaseUrl, "/session", 5_000)
      : Promise.resolve(null),
    browser ? browser.sample() : Promise.resolve(null),
    readProcessSnapshots(processes),
    readCgroupSnapshot(),
  ]);
  return {
    at: nowIso(),
    elapsedMs: Date.now() - startedAtMs,
    health,
    frontendHealth,
    diagnostics,
    runtime,
    lineUsage,
    lanes,
    session,
    browser: browserSample,
    processes: processSnapshots,
    cgroup,
  };
}

async function writeArtifacts(
  options: MonitorOptions,
  samples: MonitorSample[],
  report: MonitorReport,
): Promise<{ jsonPath: string; markdownPath: string | null }> {
  await mkdir(options.outputDir, { recursive: true });
  const jsonPath = path.join(options.outputDir, "samples-and-report.json");
  await writeFile(
    jsonPath,
    JSON.stringify(
      {
        generatedAt: nowIso(),
        options,
        report,
        samples,
      },
      null,
      2,
    ),
    "utf8",
  );
  if (options.jsonOnly) {
    return { jsonPath, markdownPath: null };
  }
  const markdownPath = path.join(options.outputDir, "report.md");
  await writeFile(markdownPath, renderMarkdownReport(report), "utf8");
  return { jsonPath, markdownPath };
}

async function main(): Promise<void> {
  if (hasFlag("help")) {
    console.log([
      "Usage: pnpm --filter @workspace/scripts run pyrus:performance-monitor -- [options]",
      "",
      "Options:",
      "  --seconds=900",
      "  --interval-ms=5000",
      "  --deep-interval-ms=30000",
      "  --frontend-url=http://127.0.0.1:18747/",
      "  --api-base-url=http://127.0.0.1:8080/api",
      "  --output-dir=scripts/reports/pyrus-performance-monitor/<timestamp>",
      "  --no-browser",
      "  --json-only",
    ].join("\n"));
    return;
  }

  const options = parseOptions();
  endpointStats.clear();
  const processes = await discoverProcesses();
  const browser = options.browser ? await startBrowserObserver(options.frontendUrl) : null;
  const startedAtMs = Date.now();
  const samples: MonitorSample[] = [];

  try {
    for (let index = 0; Date.now() - startedAtMs <= options.seconds * 1_000; index += 1) {
      const dueAt = startedAtMs + index * options.intervalMs;
      const sample = await collectSample(options, startedAtMs, index, processes, browser);
      samples.push(sample);
      const apiMetrics = snapshotMetrics(sample, "api");
      const resourceMetrics = snapshotMetrics(sample, "resource-pressure");
      console.log(
        [
          `[monitor] ${Math.round(sample.elapsedMs / 1_000)}s`,
          `samples=${samples.length}`,
          `apiP95=${String(apiMetrics["p95LatencyMs"] ?? "n/a")}ms`,
          `rss=${String(apiMetrics["rssMb"] ?? "n/a")}MB`,
          `pressure=${String(resourceMetrics["pressureLevel"] ?? "n/a")}`,
          `browser=${sample.browser?.ok === false ? "error" : sample.browser ? "ok" : "off"}`,
        ].join(" "),
      );
      const waitMs = dueAt + options.intervalMs - Date.now();
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
  } finally {
    if (browser) {
      await browser.stop();
    }
  }

  const events = samples[0]?.at
    ? await collectDiagnosticsEvents(options.apiBaseUrl, samples[0].at).catch(() => [])
    : [];
  const report = buildReport(samples, browser, events);
  const artifacts = await writeArtifacts(options, samples, report);
  console.log(JSON.stringify({
    verdict: report.verdict,
    window: report.window,
    optimizationCandidates: report.optimizationCandidates,
    artifacts,
  }, null, 2));
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
