export {};

import { readdir, readFile } from "node:fs/promises";

type EndpointStats = {
  calls: number;
  ok: number;
  fail: number;
  latencies: number[];
};

type Sample = {
  at: string;
  line: Record<string, any> | null;
  lineError: string | null;
  lanesError: string | null;
  diagnosticsError: string | null;
  healthError: string | null;
  process: { pid: number; rssMb: number | null; threads: number | null } | null;
};

const endpointStats = new Map<string, EndpointStats>();

function parseArg(name: string): string | null {
  const prefix = `--${name}=`;
  const match = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function parsePositiveInteger(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function buildUrl(baseUrl: string, path: string): string {
  const url = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const basePath = url.pathname.replace(/\/+$/, "");
  const nextPath = path.replace(/^\/+/, "");
  url.pathname = `${basePath}/${nextPath}`.replace(/\/{2,}/g, "/");
  return url.toString();
}

function recordEndpoint(path: string, ok: boolean, latencyMs: number): void {
  const stats = endpointStats.get(path) ?? {
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
  endpointStats.set(path, stats);
}

async function fetchJson(
  apiBaseUrl: string,
  path: string,
  timeoutMs: number,
): Promise<{ value: Record<string, any> | null; error: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(buildUrl(apiBaseUrl, path), {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    const latencyMs = Date.now() - startedAt;
    recordEndpoint(path, response.ok, latencyMs);
    if (!response.ok) {
      return { value: null, error: `HTTP ${response.status}` };
    }
    return { value: (await response.json()) as Record<string, any>, error: null };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    recordEndpoint(path, false, latencyMs);
    return {
      value: null,
      error:
        error instanceof Error && error.name === "AbortError"
          ? `timeout after ${timeoutMs}ms`
          : error instanceof Error
            ? error.message
            : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function discoverApiPid(): Promise<number | null> {
  try {
    const entries = await readdir("/proc", { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) {
        continue;
      }
      const cmdline = await readFile(`/proc/${entry.name}/cmdline`, "utf8")
        .then((value) => value.replace(/\0/g, " "))
        .catch(() => "");
      if (
        cmdline.includes("--enable-source-maps") &&
        cmdline.includes("./dist/index.mjs")
      ) {
        return Number(entry.name);
      }
    }
  } catch {
    // Fall through to null below.
  }
  return null;
}

async function readProcessSnapshot(pid: number | null): Promise<Sample["process"]> {
  if (!pid) return null;
  try {
    const status = await readFile(`/proc/${pid}/status`, "utf8");
    const rssKb = Number((status.match(/^VmRSS:\s+(\d+)/m) ?? [])[1]);
    const threads = Number((status.match(/^Threads:\s+(\d+)/m) ?? [])[1]);
    return {
      pid,
      rssMb: Number.isFinite(rssKb) ? Math.round(rssKb / 1024) : null,
      threads: Number.isFinite(threads) ? threads : null,
    };
  } catch {
    return null;
  }
}

function percentile(values: number[], p: number): number | null {
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  if (!sorted.length) return null;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

function range(samples: Sample[], read: (sample: Sample) => unknown) {
  const values = samples
    .map(read)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!values.length) return { min: null, avg: null, max: null };
  return {
    min: Math.min(...values),
    avg: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length),
    max: Math.max(...values),
  };
}

function delta(first: unknown, last: unknown): number | null {
  return typeof first === "number" && typeof last === "number" ? last - first : null;
}

function summarize(samples: Sample[]) {
  const first = samples[0]?.line;
  const last = samples.at(-1)?.line;
  const schedulerKeys = Array.from(
    new Set(samples.flatMap((sample) => Object.keys(sample.line?.bridge?.diagnostics?.scheduler ?? {}))),
  );

  return {
    window: {
      startedAt: samples[0]?.at ?? null,
      endedAt: samples.at(-1)?.at ?? null,
      samples: samples.length,
    },
    lineUsage: {
      admissionActive: range(samples, (sample) => sample.line?.admission?.activeLineCount),
      bridgeActive: range(samples, (sample) => sample.line?.bridge?.activeLineCount),
      bridgeRemaining: range(samples, (sample) => sample.line?.bridge?.remainingLineCount),
      drift: range(samples, (sample) => sample.line?.drift?.admissionVsBridgeLineDelta),
      lastReconciliation: last?.drift?.reconciliation ?? null,
    },
    scheduler: Object.fromEntries(
      schedulerKeys.map((key) => [
        key,
        {
          queuedMax: range(samples, (sample) => sample.line?.bridge?.diagnostics?.scheduler?.[key]?.queued).max,
          queueAgeMaxMs: range(samples, (sample) => sample.line?.bridge?.diagnostics?.scheduler?.[key]?.queueAgeMs).max,
          completedDelta: delta(
            first?.bridge?.diagnostics?.scheduler?.[key]?.completed,
            last?.bridge?.diagnostics?.scheduler?.[key]?.completed,
          ),
          timedOutDelta: delta(
            first?.bridge?.diagnostics?.scheduler?.[key]?.timedOut,
            last?.bridge?.diagnostics?.scheduler?.[key]?.timedOut,
          ),
          rejectedDelta: delta(
            first?.bridge?.diagnostics?.scheduler?.[key]?.rejected,
            last?.bridge?.diagnostics?.scheduler?.[key]?.rejected,
          ),
          lastFailure: last?.bridge?.diagnostics?.scheduler?.[key]?.lastFailure ?? null,
          pressureStates: Array.from(
            new Set(
              samples
                .map((sample) => sample.line?.bridge?.diagnostics?.scheduler?.[key]?.pressure)
                .filter(Boolean),
            ),
          ),
        },
      ]),
    ),
    streams: {
      stockAggregates: {
        eventDelta: delta(
          first?.streams?.stockAggregates?.eventCount,
          last?.streams?.stockAggregates?.eventCount,
        ),
        gapDelta: delta(
          first?.streams?.stockAggregates?.gapCount,
          last?.streams?.stockAggregates?.gapCount,
        ),
        lastAggregateAgeMsP95: percentile(
          samples
            .map((sample) => sample.line?.streams?.stockAggregates?.lastAggregateAgeMs)
            .filter((value): value is number => typeof value === "number"),
          95,
        ),
        perSymbol: last?.streams?.stockAggregates?.perSymbol ?? [],
      },
    },
    endpoints: Object.fromEntries(
      Array.from(endpointStats.entries()).map(([path, stats]) => [
        path,
        {
          calls: stats.calls,
          ok: stats.ok,
          fail: stats.fail,
          p50Ms: percentile(stats.latencies, 50),
          p95Ms: percentile(stats.latencies, 95),
          maxMs: stats.latencies.length ? Math.max(...stats.latencies) : null,
        },
      ]),
    ),
    process: {
      rssMb: range(samples, (sample) => sample.process?.rssMb),
      threads: range(samples, (sample) => sample.process?.threads),
    },
  };
}

async function main(): Promise<void> {
  const apiBaseUrl =
    parseArg("api-base-url") ??
    process.env["API_BASE_URL"] ??
    "http://127.0.0.1:8080/api";
  const seconds = parsePositiveInteger(parseArg("seconds"), 300);
  const intervalMs = parsePositiveInteger(parseArg("interval-ms"), 5_000);
  const apiPid =
    parsePositiveInteger(parseArg("api-pid"), 0) || (await discoverApiPid());
  const startedAt = Date.now();
  const samples: Sample[] = [];

  for (let index = 0; Date.now() - startedAt <= seconds * 1_000; index += 1) {
    const dueAt = startedAt + index * intervalMs;
    const [line, diagnostics, health, lanes, processSnapshot] = await Promise.all([
      fetchJson(apiBaseUrl, "/settings/ibkr-line-usage", 5_000),
      fetchJson(apiBaseUrl, "/diagnostics/latest", 3_000),
      fetchJson(apiBaseUrl, "/healthz", 2_000),
      index % 6 === 0
        ? fetchJson(apiBaseUrl, "/settings/ibkr-lanes", 8_000)
        : Promise.resolve({ value: null, error: null }),
      readProcessSnapshot(apiPid),
    ]);
    samples.push({
      at: new Date().toISOString(),
      line: line.value,
      lineError: line.error,
      lanesError: lanes.error,
      diagnosticsError: diagnostics.error,
      healthError: health.error,
      process: processSnapshot,
    });

    const admission = line.value?.admission?.activeLineCount ?? "n/a";
    const bridge = line.value?.bridge?.activeLineCount ?? "n/a";
    const drift = line.value?.drift?.admissionVsBridgeLineDelta ?? "n/a";
    const pressure = line.value?.bridge?.diagnostics?.pressure ?? "n/a";
    console.log(
      `[monitor] ${Math.round((Date.now() - startedAt) / 1_000)}s samples=${samples.length} apiLines=${admission} bridgeLines=${bridge} drift=${drift} pressure=${pressure}`,
    );

    const waitMs = dueAt + intervalMs - Date.now();
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  console.log(JSON.stringify(summarize(samples), null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
