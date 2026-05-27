import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReport,
  buildUrl,
  deltaNumber,
  numberRange,
  percentile,
  renderMarkdownReport,
} from "./pyrus-performance-monitor";

const fetchResult = (value: Record<string, unknown>) => ({
  path: "/test",
  ok: true,
  status: 200,
  latencyMs: 10,
  value,
  error: null,
});

const sample = (overrides: {
  at: string;
  elapsedMs: number;
  apiP95: number;
  rssMb: number;
  pressure: string;
  utilization: number;
}) => ({
  at: overrides.at,
  elapsedMs: overrides.elapsedMs,
  health: fetchResult({ status: "ok" }),
  frontendHealth: fetchResult({ status: "ok" }),
  diagnostics: fetchResult({
    severity: overrides.pressure === "critical" ? "critical" : "warning",
    snapshots: [
      {
        subsystem: "api",
        metrics: {
          p95LatencyMs: overrides.apiP95,
          p99LatencyMs: overrides.apiP95 + 250,
          eventLoopP95Ms: 12,
          eventLoopMaxMs: 1800,
          heapUsedMb: 900,
          rssMb: overrides.rssMb,
          requestCount5m: 120,
          slowRoutes: [
            {
              path: "/accounts/shadow/positions",
              p95LatencyMs: 4500,
              maxLatencyMs: 9000,
              slowCount5m: 3,
            },
          ],
        },
      },
      {
        subsystem: "resource-pressure",
        metrics: {
          pressureLevel: overrides.pressure,
          dominantDrivers: [
            {
              kind: "api-rss",
              label: "API RSS",
              level: overrides.pressure,
              detail: `${overrides.rssMb} MB`,
            },
          ],
        },
      },
    ],
    events: [
      {
        subsystem: "api",
        severity: "warning",
        message: "API latency is elevated.",
      },
    ],
  }),
  runtime: fetchResult({}),
  lineUsage: fetchResult({
    admission: {
      activeLineCount: 100,
      pressure: { utilization: overrides.utilization },
    },
    bridge: {
      activeLineCount: 98,
      diagnostics: {
        scheduler: {
          quotes: { pressure: "normal" },
        },
      },
    },
    drift: { admissionVsBridgeLineDelta: 2 },
  }),
  lanes: null,
  session: null,
  browser: {
    at: overrides.at,
    ok: true,
    url: "http://127.0.0.1:18747/",
    title: "PYRUS",
    bodyTextLength: 1000,
    domNodeCount: 400,
    jsHeapUsedMb: 120,
    apiTimingCount: 4,
    longTaskCount: 1,
    screenReadyCount: 1,
    error: null,
  },
  processes: [
    {
      pid: 123,
      role: "api",
      rssMb: overrides.rssMb,
      threads: 12,
      fdCount: 45,
      cpuTicks: overrides.elapsedMs / 1000,
    },
  ],
  cgroup: {
    memoryCurrentMb: 2400,
    memoryMaxMb: 8192,
    events: { oom_kill: 0 },
  },
});

test("performance monitor numeric helpers summarize bounded samples", () => {
  assert.equal(percentile([10, 20, 30, 40], 95), 40);
  assert.deepEqual(numberRange([10, null, 20, 30]), { min: 10, avg: 20, max: 30 });
  assert.deepEqual(numberRange([0.605, 0.615]), { min: 0.605, avg: 0.61, max: 0.615 });
  assert.equal(deltaNumber(10, 42), 32);
  assert.equal(deltaNumber(null, 42), null);
});

test("performance monitor URL builder preserves API base paths and queries", () => {
  assert.equal(
    buildUrl("http://127.0.0.1:8080/api", "/diagnostics/events?from=a&to=b"),
    "http://127.0.0.1:8080/api/diagnostics/events?from=a&to=b",
  );
  assert.equal(
    buildUrl("http://127.0.0.1:18747/", "/api/healthz"),
    "http://127.0.0.1:18747/api/healthz",
  );
});

test("performance monitor report ranks concrete optimization candidates", () => {
  const report = buildReport(
    [
      sample({
        at: "2026-05-27T19:00:00.000Z",
        elapsedMs: 0,
        apiP95: 1200,
        rssMb: 1300,
        pressure: "high",
        utilization: 0.5,
      }),
      sample({
        at: "2026-05-27T19:15:00.000Z",
        elapsedMs: 900_000,
        apiP95: 4200,
        rssMb: 1800,
        pressure: "critical",
        utilization: 0.92,
      }),
    ] as Parameters<typeof buildReport>[0],
    {
      launchError: null,
      pageErrors: [],
      consoleErrors: [],
      requestFailures: [],
      sample: async () => null,
      stop: async () => {},
    },
  );

  assert.equal(report.verdict.status, "critical");
  assert.equal(report.window.durationSeconds, 900);
  assert.equal(report.api.p95LatencyMs.max, 4200);
  assert.equal(report.ibkr.lineUtilization.max, 0.92);
  assert.match(report.optimizationCandidates.join("\n"), /accounts\/shadow\/positions/);
  assert.match(report.optimizationCandidates.join("\n"), /API event-loop stalls/);
});

test("performance monitor renders a reusable markdown report", () => {
  const report = buildReport(
    [
      sample({
        at: "2026-05-27T19:00:00.000Z",
        elapsedMs: 0,
        apiP95: 1000,
        rssMb: 1200,
        pressure: "high",
        utilization: 0.75,
      }),
    ] as Parameters<typeof buildReport>[0],
    null,
  );
  const markdown = renderMarkdownReport(report);

  assert.match(markdown, /PYRUS 15-Minute Performance Monitor/);
  assert.match(markdown, /Optimization Candidates/);
  assert.match(markdown, /Endpoint Sampling/);
  assert.match(markdown, /accounts\/shadow\/positions/);
});
