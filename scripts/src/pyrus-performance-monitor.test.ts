import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  __pyrusPerformanceMonitorInternalsForTests as monitor,
  buildReport,
  renderMarkdownReport,
} from "./pyrus-performance-monitor";

type MonitorSample = Parameters<typeof buildReport>[0][number];

function successfulFetch(path: string, value: Record<string, unknown> = {}) {
  return {
    path,
    ok: true,
    status: 200,
    latencyMs: 1,
    value,
    error: null,
  };
}

function sampleWithPressure(
  pressureLevel: "normal" | "watch" | "high",
): MonitorSample {
  return {
    at: "2026-07-14T00:00:00.000Z",
    elapsedMs: 0,
    health: successfulFetch("/healthz"),
    frontendHealth: successfulFetch("frontend:/api/healthz"),
    diagnostics: successfulFetch("/diagnostics/latest", {
      severity: "info",
      snapshots: [
        {
          subsystem: "api",
          metrics: {},
        },
        {
          subsystem: "resource-pressure",
          metrics: { pressureLevel, dominantDrivers: [] },
        },
      ],
      events: [
        {
          id: "sample-event",
          subsystem: "runtime",
          severity: "warning",
          message: "Sampled event",
        },
      ],
    }),
    runtime: successfulFetch("/diagnostics/runtime"),
    session: null,
    browser: null,
    processes: [],
    cgroup: {},
  };
}

for (const pressureLevel of ["watch", "high"] as const) {
  test(`current ${pressureLevel} resource pressure produces a warning verdict`, () => {
    const report = buildReport([sampleWithPressure(pressureLevel)]);

    assert.equal(report.verdict.status, "warning");
    assert.ok(
      report.verdict.reasons.some((reason) =>
        reason.includes(`Resource pressure reached ${pressureLevel}`),
      ),
    );
  });
}

test("reports retain events sampled from the public latest diagnostics payload", () => {
  const report = buildReport([sampleWithPressure("normal")]);

  assert.equal(report.diagnosticsEvents.length, 1);
  assert.equal(report.diagnosticsEvents[0]?.["id"], "sample-event");
});

test("the monitor does not call the authenticated diagnostics-events route", () => {
  const source = readFileSync(
    new URL("./pyrus-performance-monitor.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /["']\/diagnostics\/events(?:\?|["'])/u);
});

test("custom-duration reports use a duration-neutral title", () => {
  const markdown = renderMarkdownReport(
    buildReport([sampleWithPressure("normal")]),
  );

  assert.match(markdown, /^# PYRUS Performance Monitor$/mu);
  assert.doesNotMatch(markdown, /15-Minute/u);
});

test("markdown reports cannot be structurally rewritten by remote diagnostics", () => {
  const report = buildReport([sampleWithPressure("normal")]);
  report.api.slowRoutes = [
    {
      path: "/slow|route\n# FORGED HEADING",
      p95LatencyMs: 1,
      maxLatencyMs: 2,
      slowCount5m: 1,
    },
  ];
  report.resourcePressure.levels = ["normal\n# FORGED PRESSURE"];
  report.browser.launchError = "<img src=x onerror=alert(1)>";
  report.diagnosticsEvents = [
    {
      subsystem: "api|forged",
      severity: "warning",
      message: "[forged link](https://example.test)\n<script>alert(1)</script>",
    },
  ];
  report.optimizationCandidates = [
    "Investigate [forged](https://example.test)\n# FORGED CANDIDATE",
  ];

  const markdown = renderMarkdownReport(report);

  assert.doesNotMatch(markdown, /^# FORGED/mu);
  assert.doesNotMatch(markdown, /<img|<script/iu);
  assert.doesNotMatch(markdown, /\[forged(?: link)?\]\(https:/u);
  assert.match(markdown, /\\\|/u);
  assert.match(markdown, /&lt;(?:img|script)/iu);
});

test("CLI parsing is strict and resolves documented output paths from the repository root", () => {
  const parsed = monitor.parseOptions(
    [
      "--seconds=60",
      "--interval-ms=5000",
      "--deep-interval-ms=30001",
      "--frontend-url=https://example.test/app",
      "--api-base-url=https://example.test/api",
      "--output-dir=scripts/reports/pyrus-performance-monitor/test-run",
      "--json-only",
    ],
    {},
    new Date("2026-07-14T12:34:56.789Z"),
  );

  assert.deepEqual(parsed, {
    seconds: 60,
    intervalMs: 5_000,
    deepIntervalMs: 30_001,
    frontendUrl: "https://example.test/app",
    apiBaseUrl: "https://example.test/api",
    outputDir: path.resolve(
      import.meta.dirname,
      "../..",
      "scripts/reports/pyrus-performance-monitor/test-run",
    ),
    jsonOnly: true,
  });
  const blankEnv = monitor.parseOptions(
    [],
    {
      PYRUS_MONITOR_FRONTEND_URL: "",
      PYRUS_MONITOR_API_BASE_URL: "",
    },
    new Date("2026-07-14T12:34:56.789Z"),
  );
  assert.equal(blankEnv.frontendUrl, "http://127.0.0.1:18747/");
  assert.equal(blankEnv.apiBaseUrl, "http://127.0.0.1:8080/api");

  for (const args of [
    ["--unknown=value"],
    ["--seconds=60", "--seconds=120"],
    ["--seconds=0"],
    ["--seconds=2.5"],
    ["--interval-ms=1e3"],
    ["--frontend-url="],
    ["--api-base-url="],
    ["--frontend-url=file:///tmp/app"],
    ["--api-base-url=https://user:secret@example.test/api"],
    ["--api-base-url=https://example.test/api?token=secret"],
    ["--api-base-url=https://example.test/api#fragment"],
    ["positional"],
  ]) {
    assert.throws(() => monitor.parseOptions(args, {}), /Usage:/u);
  }
});

test("help still rejects unknown options before doing monitor work", () => {
  const script = fileURLToPath(
    new URL("./pyrus-performance-monitor.ts", import.meta.url),
  );
  const invalid = spawnSync(
    process.execPath,
    ["--import", "tsx", script, "--help", "--unknown"],
    { encoding: "utf8" },
  );
  const help = spawnSync(
    process.execPath,
    ["--import", "tsx", script, "--help"],
    {
      encoding: "utf8",
    },
  );

  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /Usage:/u);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage:/u);
});

test("deep sampling follows elapsed cadence when intervals are not divisible", () => {
  assert.equal(monitor.isDeepSample(0, 5_000, 30_001), true);
  assert.equal(monitor.isDeepSample(6, 5_000, 30_001), false);
  assert.equal(monitor.isDeepSample(7, 5_000, 30_001), true);
});

test("normal samples use compact runtime diagnostics while deep samples retain full detail", () => {
  assert.equal(
    monitor.runtimeDiagnosticsPath(false),
    "/diagnostics/runtime?detail=compact",
  );
  assert.equal(monitor.runtimeDiagnosticsPath(true), "/diagnostics/runtime");
});

test("a malformed successful JSON response is counted once as a failure", async () => {
  const originalFetch = globalThis.fetch;
  monitor.resetEndpointStats();
  globalThis.fetch = async () =>
    new Response("{", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  try {
    const result = await monitor.fetchJson(
      "https://example.test/api",
      "/malformed",
      100,
    );
    const report = buildReport([]);

    assert.equal(result.ok, false);
    assert.equal(result.status, 200);
    assert.equal(result.error, "Invalid JSON response.");
    assert.deepEqual(report.endpoints["/malformed"], {
      calls: 1,
      ok: 0,
      fail: 1,
      p50Ms: result.latencyMs,
      p95Ms: result.latencyMs,
      maxMs: result.latencyMs,
    });
  } finally {
    globalThis.fetch = originalFetch;
    monitor.resetEndpointStats();
  }
});

test("endpoint latency includes JSON body parsing", async () => {
  const originalFetch = globalThis.fetch;
  monitor.resetEndpointStats();
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          void delay(25).then(() => {
            controller.enqueue(new TextEncoder().encode("{}"));
            controller.close();
          });
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  try {
    const result = await monitor.fetchJson(
      "https://example.test/api",
      "/delayed-body",
      100,
    );

    assert.equal(result.ok, true);
    assert.ok(result.latencyMs >= 20, `latency was ${result.latencyMs}ms`);
  } finally {
    globalThis.fetch = originalFetch;
    monitor.resetEndpointStats();
  }
});

test("successful JSON responses must have an object root", async () => {
  const originalFetch = globalThis.fetch;
  monitor.resetEndpointStats();
  globalThis.fetch = async () =>
    new Response("[]", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  try {
    const result = await monitor.fetchJson(
      "https://example.test/api",
      "/array",
      100,
    );

    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /JSON object/u);
    assert.equal(buildReport([]).endpoints["/array"]?.calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    monitor.resetEndpointStats();
  }
});

test("JSON responses reject a declared body above the monitor limit", async () => {
  const originalFetch = globalThis.fetch;
  monitor.resetEndpointStats();
  globalThis.fetch = async () =>
    new Response("{}", {
      status: 200,
      headers: {
        "content-length": String(64 * 1024 * 1024),
        "content-type": "application/json",
      },
    });
  try {
    const result = await monitor.fetchJson(
      "https://example.test/api",
      "/oversized",
      100,
    );

    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /response.*limit/iu);
    assert.equal(buildReport([]).endpoints["/oversized"]?.calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    monitor.resetEndpointStats();
  }
});

test("response cleanup cannot mask an oversized-body failure", async () => {
  const response = new Response(
    new ReadableStream<Uint8Array>({
      cancel() {
        throw new Error("cleanup failed");
      },
    }),
    { headers: { "content-length": "4" } },
  );

  await assert.rejects(
    monitor.readResponseText(response, 3),
    /exceeded the 3-byte limit/u,
  );
});

test("failed HTTP responses cancel bodies the monitor will not read", async () => {
  const originalFetch = globalThis.fetch;
  let cancelled = false;
  monitor.resetEndpointStats();
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("untrusted failure"));
        },
        cancel() {
          cancelled = true;
        },
      }),
      { status: 503 },
    );
  try {
    const result = await monitor.fetchJson(
      "https://example.test/api",
      "/unavailable",
      100,
    );

    assert.equal(result.ok, false);
    assert.equal(result.status, 503);
    assert.equal(cancelled, true);
    assert.equal(buildReport([]).endpoints["/unavailable"]?.calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    monitor.resetEndpointStats();
  }
});

test("JSON response reads enforce the limit without a content-length header", async () => {
  let cancelled = false;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{}"));
        controller.enqueue(new TextEncoder().encode("{}"));
      },
      cancel() {
        cancelled = true;
      },
    }),
  );

  assert.equal(response.headers.get("content-length"), null);
  await assert.rejects(
    monitor.readResponseText(response, 3),
    /exceeded the 3-byte limit/u,
  );
  assert.equal(cancelled, true);
});

test("operator-facing errors redact credentials, controls, and unbounded text", () => {
  const message = monitor.errorMessage(
    new Error(
      `https://operator:super-secret@example.test/api \u001b[31mline\nnext\u202e${"x".repeat(2_000)}`,
    ),
  );

  assert.match(message, /https:\/\/\[redacted\]@example\.test\/api/u);
  assert.doesNotMatch(message, /super-secret/u);
  assert.doesNotMatch(
    message,
    /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u,
  );
  assert.ok(message.length <= 1_000);
});
