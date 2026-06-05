import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env["DATABASE_URL"] = "postgres://test:test@127.0.0.1:5432/test";
process.env["DB_CONNECTION_TIMEOUT_MS"] = "50";
process.env["DB_QUERY_TIMEOUT_MS"] = "50";
process.env["DB_STATEMENT_TIMEOUT_MS"] = "50";
process.env["DIAGNOSTICS_SUPPRESS_DB_WARNINGS"] = "1";
process.env["DIAGNOSTICS_SKIP_STORAGE_TABLE_STATS"] = "1";
process.env["PYRUS_RUNTIME_TEST_PROCESS_SCAN"] = "0";
process.env["PYRUS_FLIGHT_RECORDER_DIR"] = path.join(
  mkdtempSync(path.join(tmpdir(), "pyrus-flight-recorder-diagnostics-")),
  "flight-recorder",
);

const diagnosticsModule = await import("./diagnostics");
const requestMetricsModule = await import("./request-metrics");
const resourcePressureModule = await import("./resource-pressure");
const signalOptionsWorkerStateModule = await import("./signal-options-worker-state");
const storageHealthModule = await import("./storage-health");
const {
  collectDiagnosticSnapshot,
  __resetDiagnosticThresholdOverridesCacheForTests,
  __setDiagnosticThresholdOverrideRowsLoaderForTests,
  exportDiagnostics,
  getDiagnosticThresholds,
  listDiagnosticHistory,
  listDiagnosticEvents,
  recordBrowserReports,
  recordBrowserDiagnosticEvent,
  recordClientDiagnosticsMetrics,
  recordServerDiagnosticEvent,
} = diagnosticsModule;
const { recordApiRequest, __resetRequestMetricsForTests } = requestMetricsModule;
const {
  __resetApiResourcePressureForTests,
  resolveApiRssPressureThresholds,
  updateApiResourcePressure,
} = resourcePressureModule;
const {
  __resetStorageHealthForTests,
  __setStorageHealthProbeForTests,
} = storageHealthModule;
const { registerSignalOptionsWorkerSnapshotGetter } = signalOptionsWorkerStateModule;
const diagnosticsSource = readFileSync(
  new URL("./diagnostics.ts", import.meta.url),
  "utf8",
);

function emptyWorkerMaintenanceSnapshot() {
  return {
    runCount: 0,
    totalClosedCount: 0,
    lastRunAt: null,
    lastError: null,
    lastClosedCount: 0,
    lastSkippedCount: 0,
    lastDueCount: 0,
    lastOrphanCount: 0,
  };
}

function registerEmptySignalOptionsWorkerSnapshot() {
  registerSignalOptionsWorkerSnapshotGetter(() => ({
    started: false,
    tickRunning: false,
    deploymentCount: 0,
    activeDeploymentCount: 0,
    maintenance: emptyWorkerMaintenanceSnapshot(),
    deployments: [],
  }));
}

function healthyDiagnosticInput(now = new Date().toISOString()) {
  return {
    runtime: {
      ibkr: {
        configured: true,
        bridgeUrlConfigured: true,
        bridgeTokenConfigured: true,
        reachable: true,
        connected: true,
        authenticated: true,
        competing: false,
        healthFresh: true,
        streamFresh: true,
        strictReady: true,
        strictReason: null,
        streamState: "live",
        streamStateReason: "fresh_stream_event",
        lastTickleAt: now,
      },
    },
    probes: {
      accounts: { ok: true, count: 1 },
      positions: { ok: true, count: 1 },
      orders: { ok: true, count: 0 },
    },
  };
}

test.beforeEach(() => {
  __setStorageHealthProbeForTests(async () => {});
  registerEmptySignalOptionsWorkerSnapshot();
});

test.afterEach(() => {
  __resetRequestMetricsForTests();
  __resetApiResourcePressureForTests();
  __resetStorageHealthForTests();
  registerEmptySignalOptionsWorkerSnapshot();
});

test("diagnostics do not page on low-sample startup latency", async () => {
  recordApiRequest({
    method: "GET",
    path: "/api/startup",
    statusCode: 200,
    durationMs: 5_000,
  });

  const collected = await collectDiagnosticSnapshot({
    runtime: {
      api: {
        uptimeMs: 5_000,
        memoryMb: {
          heapUsed: 128,
          heapTotal: 256,
          rss: 512,
          external: 16,
        },
      },
      ibkr: {
        configured: true,
        reachable: true,
        connected: true,
        authenticated: true,
        competing: false,
        accountCount: 1,
        lastTickleAt: new Date().toISOString(),
        liveMarketDataAvailable: true,
      },
    },
    probes: {
      accounts: { ok: true, count: 1 },
      positions: { ok: true, count: 2 },
      orders: { ok: true, count: 3 },
    },
  });

  const api = collected.snapshots.find((snapshot) => snapshot.subsystem === "api");

  assert.equal(api?.status, "ok");
  assert.equal(api?.metrics.p95LatencyMs, 5_000);
  assert.equal(api?.metrics.p95_latency_ms, null);
  assert.equal(api?.metrics.latencyAlertMinSamples, 20);
});

test("diagnostics degrade but do not mark latency-only API pressure critical", async () => {
  for (let index = 0; index < 20; index += 1) {
    recordApiRequest({
      method: "GET",
      path: "/api/algo/events",
      statusCode: 200,
      durationMs: 5_200,
    });
  }

  const collected = await collectDiagnosticSnapshot({
    runtime: {
      api: {
        uptimeMs: 30_000,
        memoryMb: {
          heapUsed: 128,
          heapTotal: 256,
          rss: 512,
          external: 16,
        },
      },
      ibkr: {
        configured: true,
        reachable: true,
        connected: true,
        authenticated: true,
        competing: false,
        accountCount: 1,
        lastTickleAt: new Date().toISOString(),
        liveMarketDataAvailable: true,
      },
    },
    probes: {
      accounts: { ok: true, count: 1 },
      positions: { ok: true, count: 2 },
      orders: { ok: true, count: 3 },
    },
  });

  const api = collected.snapshots.find((snapshot) => snapshot.subsystem === "api");

  assert.equal(api?.metrics.p95LatencyMs, 5_200);
  assert.equal(api?.metrics.p95_latency_ms, 5_200);
  assert.equal(api?.status, "degraded");
  assert.equal(api?.severity, "warning");
  assert.equal(collected.status, "degraded");
  assert.equal(collected.severity, "warning");
});

test("diagnostics do not use raw heap megabytes as a pressure severity driver", async () => {
  const collected = await collectDiagnosticSnapshot({
    runtime: {
      api: {
        uptimeMs: 30_000,
        memoryMb: {
          heapUsed: 1_500,
          heapTotal: 1_800,
          rss: 1_900,
          external: 16,
        },
      },
      ibkr: {
        configured: true,
        reachable: true,
        connected: true,
        authenticated: true,
        competing: false,
        accountCount: 1,
        lastTickleAt: new Date().toISOString(),
        liveMarketDataAvailable: true,
      },
    },
    probes: {
      accounts: { ok: true, count: 1 },
      positions: { ok: true, count: 2 },
      orders: { ok: true, count: 3 },
    },
  });

  const api = collected.snapshots.find((snapshot) => snapshot.subsystem === "api");
  const heapThresholdEvent = collected.events.find(
    (event) => event.code === "api.heap_used_mb",
  );

  assert.equal(api?.metrics.heapUsedMb, 1_500);
  assert.equal(api?.severity, "info");
  assert.equal(heapThresholdEvent, undefined);
});

test("diagnostics keep active scans past the stale window warning until timeout", async () => {
  const nowMs = Date.now();
  registerSignalOptionsWorkerSnapshotGetter(() => ({
    started: true,
    tickRunning: true,
    deploymentCount: 1,
    activeDeploymentCount: 1,
    maintenance: emptyWorkerMaintenanceSnapshot(),
    deployments: [
      {
        deploymentId: "deployment-1",
        lastCheckedAtMs: nowMs - 360_000,
        failedUntilMs: 0,
        lastSuccessAt: new Date(nowMs - 360_000).toISOString(),
        lastError: null,
        currentScanStartedAt: new Date(nowMs - 360_000).toISOString(),
        currentScanAgeMs: 360_000,
        lastScanDurationMs: 12_000,
        timedOut: false,
        unsettledAfterTimeout: false,
        lastScanOutcome: "scan_running",
        scanCount: 4,
        totalFailureCount: 0,
        failureCount: 0,
        lastFailureAt: null,
        lastSignalCount: 8,
        lastFreshSignalCount: 8,
        lastStaleSignalCount: 0,
        lastUnavailableSignalCount: 0,
        lastLatestSignalBarAt: new Date(nowMs - 360_000).toISOString(),
        lastOldestSignalBarAt: new Date(nowMs - 360_000).toISOString(),
        lastCandidateCount: 0,
        lastBlockedCandidateCount: 0,
      },
    ],
  }));

  const collected = await collectDiagnosticSnapshot(healthyDiagnosticInput());
  const automation = collected.snapshots.find(
    (snapshot) => snapshot.subsystem === "automation",
  );
  const longScanEvent = collected.events.find(
    (event) => event.code === "signal_options_scan_long_running",
  );
  const staleEvent = collected.events.find(
    (event) => event.code === "signal_options_scan_stale",
  );

  assert.equal(automation?.status, "degraded");
  assert.equal(automation?.severity, "warning");
  assert.equal(automation?.metrics.activeLongScanCount, 1);
  assert.equal(automation?.metrics.timedOutDeploymentCount, 0);
  assert.equal(longScanEvent?.severity, "warning");
  assert.equal(staleEvent, undefined);
});

test("diagnostics mark timed-out active scans critical", async () => {
  const nowMs = Date.now();
  registerSignalOptionsWorkerSnapshotGetter(() => ({
    started: true,
    tickRunning: true,
    deploymentCount: 1,
    activeDeploymentCount: 1,
    maintenance: emptyWorkerMaintenanceSnapshot(),
    deployments: [
      {
        deploymentId: "deployment-1",
        lastCheckedAtMs: nowMs - 360_000,
        failedUntilMs: 0,
        lastSuccessAt: new Date(nowMs - 360_000).toISOString(),
        lastError: null,
        currentScanStartedAt: new Date(nowMs - 360_000).toISOString(),
        currentScanAgeMs: 360_000,
        lastScanDurationMs: 12_000,
        timedOut: true,
        timeoutReason: "scan_timeout",
        unsettledAfterTimeout: true,
        lastScanOutcome: "timed_out_unsettled",
        scanCount: 4,
        totalFailureCount: 0,
        failureCount: 0,
        lastFailureAt: null,
        lastSignalCount: 8,
        lastFreshSignalCount: 8,
        lastStaleSignalCount: 0,
        lastUnavailableSignalCount: 0,
        lastLatestSignalBarAt: new Date(nowMs - 360_000).toISOString(),
        lastOldestSignalBarAt: new Date(nowMs - 360_000).toISOString(),
        lastCandidateCount: 0,
        lastBlockedCandidateCount: 0,
      },
    ],
  }));

  const collected = await collectDiagnosticSnapshot(healthyDiagnosticInput());
  const automation = collected.snapshots.find(
    (snapshot) => snapshot.subsystem === "automation",
  );

  assert.equal(automation?.status, "down");
  assert.equal(automation?.severity, "critical");
  assert.equal(automation?.metrics.timedOutDeploymentCount, 1);
  assert.equal(automation?.metrics.unsettledAfterTimeoutCount, 1);
});

test("diagnostics collect API latency and runtime snapshots without broker mutations", async () => {
  recordApiRequest({
    method: "GET",
    path: "/api/example",
    statusCode: 200,
    durationMs: 42,
  });
  recordApiRequest({
    method: "GET",
    path: "/api/slow",
    statusCode: 500,
    durationMs: 1_250,
  });

  const collected = await collectDiagnosticSnapshot({
    runtime: {
      api: {
        uptimeMs: 10_000,
        memoryMb: {
          heapUsed: 128,
          heapTotal: 256,
          rss: 512,
          external: 16,
        },
      },
      ibkr: {
        configured: true,
        reachable: true,
        connected: true,
        authenticated: true,
        competing: false,
        accountCount: 1,
        lastTickleAt: new Date().toISOString(),
        liveMarketDataAvailable: true,
      },
    },
    probes: {
      accounts: { ok: true, count: 1 },
      positions: { ok: true, count: 2 },
      orders: { ok: true, count: 3 },
    },
  });

  const api = collected.snapshots.find((snapshot) => snapshot.subsystem === "api");
  const ibkr = collected.snapshots.find((snapshot) => snapshot.subsystem === "ibkr");
  const marketData = collected.snapshots.find((snapshot) => snapshot.subsystem === "market-data");
  const browser = collected.snapshots.find((snapshot) => snapshot.subsystem === "browser");
  const orders = collected.snapshots.find((snapshot) => snapshot.subsystem === "orders");
  const runtime = collected.snapshots.find((snapshot) => snapshot.subsystem === "runtime");
  const storage = collected.snapshots.find((snapshot) => snapshot.subsystem === "storage");

  assert.equal((api?.metrics.requestCount5m as number) >= 2, true);
  assert.equal(api?.metrics.errorCount5m, 1);
  assert.equal(
    Array.isArray(api?.metrics.errorRoutes) &&
      api.metrics.errorRoutes.some(
        (route) =>
          route.path === "/api/slow" && route.errorCount5m === 1,
      ),
    true,
  );
  assert.equal(api?.metrics.dominantErrorRoute, "/api/slow");
  assert.equal(api?.metrics.dominantErrorRouteCount, 1);
  assert.equal(ibkr?.status, "ok");
  assert.equal(marketData?.status, "ok");
  assert.equal(browser?.metrics.warningCount5m, 0);
  assert.equal(orders?.metrics.orderCount, 3);
  assert.equal(runtime?.status, "ok");
  assert.equal(typeof runtime?.metrics.recorderDir, "string");
  assert.equal(storage?.status, "ok");
  assert.equal(storage?.metrics.status, "ok");
});

test("diagnostics exclude long-lived streams from API latency pressure", async () => {
  recordApiRequest({
    method: "GET",
    path: "/api/example",
    statusCode: 200,
    durationMs: 42,
  });
  recordApiRequest({
    method: "GET",
    path: "/streams/accounts/shadow",
    statusCode: 500,
    durationMs: 109_540,
  });

  const collected = await collectDiagnosticSnapshot(healthyDiagnosticInput());
  const api = collected.snapshots.find((snapshot) => snapshot.subsystem === "api");
  const resourcePressure = collected.snapshots.find(
    (snapshot) => snapshot.subsystem === "resource-pressure",
  );
  const dominantDrivers = Array.isArray(
    resourcePressure?.metrics.dominantDrivers,
  )
    ? resourcePressure?.metrics.dominantDrivers
    : [];

  assert.equal(api?.metrics.requestCount5m, 2);
  assert.equal(api?.metrics.latencySampleCount5m, 1);
  assert.equal(api?.metrics.longLivedRequestCount5m, 1);
  assert.equal(api?.metrics.rawP95LatencyMs, 42);
  assert.equal(api?.metrics.slowRouteCount5m, 0);
  assert.equal(api?.metrics.dominantSlowRoute, null);
  assert.equal(api?.metrics.dominantSlowRouteP95Ms, null);
  assert.equal(
    Array.isArray(api?.metrics.errorRoutes) &&
      api.metrics.errorRoutes.some(
        (route) =>
          route.path === "/streams/accounts/shadow" &&
          route.errorCount5m === 1,
      ),
    true,
  );
  assert.equal(api?.metrics.dominantErrorRoute, "/streams/accounts/shadow");
  assert.equal(resourcePressure?.metrics.pressureLevel, "normal");
  assert.equal(resourcePressure?.metrics.apiPressureLevel, "normal");
  assert.equal(
    dominantDrivers.some((driver) => driver?.kind === "api-latency"),
    false,
  );
});

test("diagnostics exclude bridge long-polls from API latency pressure", async () => {
  recordApiRequest({
    method: "GET",
    path: "/api/example",
    statusCode: 200,
    durationMs: 42,
  });
  for (const path of [
    "/api/ibkr/desktop/jobs/claim",
    "/ibkr/activation/activation-1/login-key/read",
    "/api/ibkr/activation/activation-1/login-envelope/claim",
  ]) {
    recordApiRequest({
      method: "POST",
      path,
      statusCode: 200,
      durationMs: 25_456,
    });
  }

  const collected = await collectDiagnosticSnapshot(healthyDiagnosticInput());
  const api = collected.snapshots.find((snapshot) => snapshot.subsystem === "api");
  const resourcePressure = collected.snapshots.find(
    (snapshot) => snapshot.subsystem === "resource-pressure",
  );
  const dominantDrivers = Array.isArray(
    resourcePressure?.metrics.dominantDrivers,
  )
    ? resourcePressure?.metrics.dominantDrivers
    : [];

  assert.equal(api?.metrics.requestCount5m, 4);
  assert.equal(api?.metrics.latencySampleCount5m, 1);
  assert.equal(api?.metrics.longLivedRequestCount5m, 3);
  assert.equal(api?.metrics.rawP95LatencyMs, 42);
  assert.equal(api?.metrics.slowRouteCount5m, 0);
  assert.equal(api?.metrics.dominantSlowRoute, null);
  assert.equal(api?.metrics.dominantSlowRoutePressureP95Ms, null);
  assert.equal(resourcePressure?.metrics.pressureLevel, "normal");
  assert.equal(resourcePressure?.metrics.apiPressureLevel, "normal");
  assert.equal(
    dominantDrivers.some((driver) => driver?.kind === "api-latency"),
    false,
  );
});

test("diagnostics do not let one route outlier drive API resource pressure", async () => {
  for (let index = 0; index < 40; index += 1) {
    recordApiRequest({
      method: "GET",
      path: "/api/fast",
      statusCode: 200,
      durationMs: 42,
    });
  }
  for (let index = 0; index < 6; index += 1) {
    recordApiRequest({
      method: "GET",
      path: "/algo/deployments",
      statusCode: 200,
      durationMs: 50,
    });
  }
  recordApiRequest({
    method: "GET",
    path: "/algo/deployments",
    statusCode: 200,
    durationMs: 20_730,
  });

  const collected = await collectDiagnosticSnapshot(healthyDiagnosticInput());
  const api = collected.snapshots.find((snapshot) => snapshot.subsystem === "api");
  const resourcePressure = collected.snapshots.find(
    (snapshot) => snapshot.subsystem === "resource-pressure",
  );
  const dominantDrivers = Array.isArray(
    resourcePressure?.metrics.dominantDrivers,
  )
    ? resourcePressure?.metrics.dominantDrivers
    : [];

  assert.equal(api?.metrics.rawP95LatencyMs, 50);
  assert.equal(api?.metrics.dominantSlowRoute, "/algo/deployments");
  assert.equal(api?.metrics.dominantSlowRouteP95Ms, 20_730);
  assert.equal(api?.metrics.dominantSlowRoutePressureP95Ms, null);
  assert.equal(resourcePressure?.metrics.pressureLevel, "normal");
  assert.equal(resourcePressure?.metrics.apiPressureLevel, "normal");
  assert.equal(
    dominantDrivers.some((driver) => driver?.kind === "api-latency"),
    false,
  );
});

test("diagnostics keep sustained slow route pressure high", async () => {
  for (let index = 0; index < 100; index += 1) {
    recordApiRequest({
      method: "GET",
      path: "/api/fast",
      statusCode: 200,
      durationMs: 42,
    });
  }
  for (let index = 0; index < 4; index += 1) {
    recordApiRequest({
      method: "GET",
      path: "/accounts/shadow/cash-activity",
      statusCode: 200,
      durationMs: 50,
    });
  }
  for (let index = 0; index < 3; index += 1) {
    recordApiRequest({
      method: "GET",
      path: "/accounts/shadow/cash-activity",
      statusCode: 200,
      durationMs: 13_869,
    });
  }

  const collected = await collectDiagnosticSnapshot(healthyDiagnosticInput());
  const api = collected.snapshots.find((snapshot) => snapshot.subsystem === "api");
  const resourcePressure = collected.snapshots.find(
    (snapshot) => snapshot.subsystem === "resource-pressure",
  );
  const dominantDrivers = Array.isArray(
    resourcePressure?.metrics.dominantDrivers,
  )
    ? resourcePressure?.metrics.dominantDrivers
    : [];

  assert.equal(api?.metrics.rawP95LatencyMs, 50);
  assert.equal(api?.metrics.dominantSlowRoute, "/accounts/shadow/cash-activity");
  assert.equal(api?.metrics.dominantSlowRouteP95Ms, 13_869);
  assert.equal(api?.metrics.dominantSlowRoutePressureP95Ms, 13_869);
  assert.equal(api?.metrics.dominantSlowRoutePressureSlowCount5m, 3);
  assert.equal(resourcePressure?.metrics.apiPressureLevel, "high");
  assert.equal(
    dominantDrivers.some((driver) => driver?.kind === "api-latency"),
    true,
  );
});

test("diagnostics do not let decorative routes drive API resource pressure", async () => {
  for (let index = 0; index < 80; index += 1) {
    recordApiRequest({
      method: "GET",
      path: "/api/fast",
      statusCode: 200,
      durationMs: 42,
    });
  }
  for (let index = 0; index < 3; index += 1) {
    recordApiRequest({
      method: "GET",
      path: "/universe/logos",
      statusCode: 200,
      durationMs: 28_665,
    });
  }

  const collected = await collectDiagnosticSnapshot(healthyDiagnosticInput());
  const api = collected.snapshots.find((snapshot) => snapshot.subsystem === "api");
  const resourcePressure = collected.snapshots.find(
    (snapshot) => snapshot.subsystem === "resource-pressure",
  );
  const dominantDrivers = Array.isArray(
    resourcePressure?.metrics.dominantDrivers,
  )
    ? resourcePressure?.metrics.dominantDrivers
    : [];

  assert.equal(api?.metrics.dominantSlowRoute, "/universe/logos");
  assert.equal(api?.metrics.dominantSlowRouteP95Ms, 28_665);
  assert.equal(api?.metrics.dominantSlowRoutePressureP95Ms, null);
  assert.equal(resourcePressure?.metrics.apiPressureLevel, "normal");
  assert.equal(
    dominantDrivers.some((driver) => driver?.kind === "api-latency"),
    false,
  );
});

test("diagnostics warn on long-running workspace test processes", async () => {
  const procRoot = mkdtempSync(path.join(tmpdir(), "pyrus-diagnostics-proc-"));
  const pidDir = path.join(procRoot, "5252");
  mkdirSync(pidDir, { recursive: true });
  writeFileSync(
    path.join(pidDir, "cmdline"),
    [
      process.execPath,
      "--import",
      "tsx",
      "--test",
      "/home/runner/workspace/artifacts/api-server/src/services/options-flow-scanner.test.ts",
    ].join("\0"),
  );
  symlinkSync("/home/runner/workspace", path.join(pidDir, "cwd"));
  const oldTime = new Date(Date.now() - 60_000);
  utimesSync(pidDir, oldTime, oldTime);

  process.env["PYRUS_RUNTIME_TEST_PROCESS_SCAN"] = "1";
  process.env["PYRUS_RUNTIME_PROCESS_SCAN_DIR"] = procRoot;
  process.env["PYRUS_RUNTIME_TEST_PROCESS_MIN_AGE_MS"] = "1000";
  try {
    const collected = await collectDiagnosticSnapshot(healthyDiagnosticInput());
    const runtime = collected.snapshots.find(
      (snapshot) => snapshot.subsystem === "runtime",
    );

    assert.equal(runtime?.status, "degraded");
    assert.equal(runtime?.metrics.workspaceLongRunningTestProcessCount, 1);
    assert.match(runtime?.summary ?? "", /long-running workspace test process/);
  } finally {
    process.env["PYRUS_RUNTIME_TEST_PROCESS_SCAN"] = "0";
    delete process.env["PYRUS_RUNTIME_PROCESS_SCAN_DIR"];
    delete process.env["PYRUS_RUNTIME_TEST_PROCESS_MIN_AGE_MS"];
  }
});

test("diagnostics treat recovered signal-options worker failures as historical", async () => {
  registerSignalOptionsWorkerSnapshotGetter(() => ({
    started: true,
    tickRunning: false,
    deploymentCount: 1,
    activeDeploymentCount: 0,
    maintenance: emptyWorkerMaintenanceSnapshot(),
    deployments: [
      {
        deploymentId: "deployment-1",
        lastCheckedAtMs: Date.now(),
        failedUntilMs: 0,
        lastSuccessAt: new Date().toISOString(),
        lastError: null,
        currentScanStartedAt: null,
        currentScanAgeMs: null,
        lastScanDurationMs: 1_000,
        scanCount: 4,
        totalFailureCount: 3,
        failureCount: 0,
        lastFailureAt: new Date(Date.now() - 120_000).toISOString(),
        lastSignalCount: 10,
        lastFreshSignalCount: 10,
        lastStaleSignalCount: 0,
        lastUnavailableSignalCount: 0,
        lastLatestSignalBarAt: new Date().toISOString(),
        lastOldestSignalBarAt: new Date().toISOString(),
        lastCandidateCount: 2,
        lastBlockedCandidateCount: 1,
      },
    ],
  }));

  const collected = await collectDiagnosticSnapshot({
    runtime: {
      ibkr: {
        configured: true,
        bridgeUrlConfigured: true,
        bridgeTokenConfigured: true,
        reachable: true,
        connected: true,
        authenticated: true,
        competing: false,
        healthFresh: true,
        streamFresh: true,
        strictReady: true,
        strictReason: null,
        streamState: "live",
        streamStateReason: "fresh_stream_event",
        lastTickleAt: new Date().toISOString(),
      },
    },
    probes: {
      accounts: { ok: true, count: 1 },
      positions: { ok: true, count: 1 },
      orders: { ok: true, count: 0 },
    },
  });

  const automation = collected.snapshots.find(
    (snapshot) => snapshot.subsystem === "automation",
  );
  const workerEvent = collected.events.find(
    (event) => event.code === "signal_options_worker_failure",
  );

  assert.equal(automation?.status, "ok");
  assert.equal(automation?.metrics.failureCount, 0);
  assert.equal(automation?.metrics.totalFailureCount, 3);
  assert.equal(workerEvent, undefined);
});

test("diagnostics surface stale signal-options scan inputs", async () => {
  registerSignalOptionsWorkerSnapshotGetter(() => ({
    started: true,
    tickRunning: false,
    deploymentCount: 1,
    activeDeploymentCount: 0,
    maintenance: emptyWorkerMaintenanceSnapshot(),
    deployments: [
      {
        deploymentId: "deployment-1",
        lastCheckedAtMs: Date.now(),
        failedUntilMs: 0,
        lastSuccessAt: new Date().toISOString(),
        lastError: null,
        currentScanStartedAt: null,
        currentScanAgeMs: null,
        lastScanDurationMs: 1_000,
        scanCount: 4,
        totalFailureCount: 0,
        failureCount: 0,
        lastFailureAt: null,
        lastSignalCount: 8,
        lastFreshSignalCount: 2,
        lastStaleSignalCount: 5,
        lastUnavailableSignalCount: 1,
        lastLatestSignalBarAt: new Date().toISOString(),
        lastOldestSignalBarAt: new Date(Date.now() - 45 * 60_000).toISOString(),
        lastCandidateCount: 12,
        lastBlockedCandidateCount: 12,
      },
    ],
  }));

  const collected = await collectDiagnosticSnapshot({
    runtime: {
      ibkr: {
        configured: true,
        bridgeUrlConfigured: true,
        bridgeTokenConfigured: true,
        reachable: true,
        connected: true,
        authenticated: true,
        competing: false,
        healthFresh: true,
        streamFresh: true,
        strictReady: true,
        strictReason: null,
        streamState: "live",
        streamStateReason: "fresh_stream_event",
        lastTickleAt: new Date().toISOString(),
      },
    },
    probes: {
      accounts: { ok: true, count: 1 },
      positions: { ok: true, count: 1 },
      orders: { ok: true, count: 0 },
    },
  });

  const automation = collected.snapshots.find(
    (snapshot) => snapshot.subsystem === "automation",
  );
  const signalFreshnessEvent = collected.events.find(
    (event) => event.code === "signal_options_signal_scan_degraded",
  );

  assert.equal(automation?.status, "degraded");
  assert.equal(automation?.metrics.signalCount, 8);
  assert.equal(automation?.metrics.freshSignalCount, 2);
  assert.equal(automation?.metrics.notFreshSignalCount, 6);
  assert.equal(signalFreshnessEvent?.severity, "warning");
});

test("diagnostics do not treat inactive but current signals as degraded input", async () => {
  const now = new Date().toISOString();
  registerSignalOptionsWorkerSnapshotGetter(() => ({
    started: true,
    tickRunning: false,
    deploymentCount: 1,
    activeDeploymentCount: 0,
    maintenance: emptyWorkerMaintenanceSnapshot(),
    deployments: [
      {
        deploymentId: "deployment-1",
        lastCheckedAtMs: Date.now(),
        failedUntilMs: 0,
        lastSuccessAt: now,
        lastError: null,
        currentScanStartedAt: null,
        currentScanAgeMs: null,
        lastScanDurationMs: 1_000,
        scanCount: 4,
        totalFailureCount: 0,
        failureCount: 0,
        lastFailureAt: null,
        lastSignalCount: 8,
        lastFreshSignalCount: 0,
        lastStaleSignalCount: 0,
        lastUnavailableSignalCount: 0,
        lastLatestSignalBarAt: now,
        lastOldestSignalBarAt: now,
        lastCandidateCount: 0,
        lastBlockedCandidateCount: 0,
      },
    ],
  }));

  const collected = await collectDiagnosticSnapshot({
    runtime: {
      ibkr: {
        configured: true,
        bridgeUrlConfigured: true,
        bridgeTokenConfigured: true,
        reachable: true,
        connected: true,
        authenticated: true,
        competing: false,
        healthFresh: true,
        streamFresh: true,
        strictReady: true,
        strictReason: null,
        streamState: "live",
        streamStateReason: "fresh_stream_event",
        lastTickleAt: now,
      },
    },
    probes: {
      accounts: { ok: true, count: 1 },
      positions: { ok: true, count: 1 },
      orders: { ok: true, count: 0 },
    },
  });

  const automation = collected.snapshots.find(
    (snapshot) => snapshot.subsystem === "automation",
  );

  assert.equal(automation?.status, "ok");
  assert.equal(automation?.metrics.notFreshSignalCount, 8);
});

test("diagnostics resolve inactive automation collector incidents", async () => {
  const staleEvents = await Promise.all([
    recordServerDiagnosticEvent({
      subsystem: "automation",
      category: "deployment",
      code: "signal_options_deployment_missing",
      severity: "critical",
      message: "stale deployment incident",
    }),
    recordServerDiagnosticEvent({
      subsystem: "automation",
      category: "ledger-maintenance",
      code: "signal_options_orphan_shadow_options",
      severity: "critical",
      message: "stale ledger incident",
    }),
    recordServerDiagnosticEvent({
      subsystem: "automation",
      category: "signal-freshness",
      code: "signal_options_signal_scan_degraded",
      severity: "warning",
      message: "stale signal freshness incident",
    }),
  ]);
  const staleIncidentKeys = new Set(
    staleEvents.map((event) => event.incidentKey),
  );

  const collected = await collectDiagnosticSnapshot(healthyDiagnosticInput());
  const openEvents = await listDiagnosticEvents({
    from: new Date(Date.now() - 60_000),
    to: new Date(Date.now() + 60_000),
    subsystem: "automation",
    status: "open",
  });

  assert.equal(
    collected.events.some((event) => staleIncidentKeys.has(event.incidentKey)),
    false,
  );
  assert.equal(
    openEvents.events.some((event) => staleIncidentKeys.has(event.incidentKey)),
    false,
  );
});

test("diagnostics separate long-running scans from stopped stale scans", async () => {
  const nowMs = Date.now();
  registerSignalOptionsWorkerSnapshotGetter(() => ({
    started: true,
    tickRunning: true,
    deploymentCount: 1,
    activeDeploymentCount: 1,
    maintenance: emptyWorkerMaintenanceSnapshot(),
    deployments: [
      {
        deploymentId: "deployment-1",
        lastCheckedAtMs: nowMs - 150_000,
        failedUntilMs: 0,
        lastSuccessAt: new Date(nowMs - 150_000).toISOString(),
        lastError: null,
        currentScanStartedAt: new Date(nowMs - 150_000).toISOString(),
        currentScanAgeMs: 150_000,
        lastScanDurationMs: 12_000,
        scanCount: 4,
        totalFailureCount: 0,
        failureCount: 0,
        lastFailureAt: null,
        lastSignalCount: 8,
        lastFreshSignalCount: 8,
        lastStaleSignalCount: 0,
        lastUnavailableSignalCount: 0,
        lastLatestSignalBarAt: new Date(nowMs - 150_000).toISOString(),
        lastOldestSignalBarAt: new Date(nowMs - 150_000).toISOString(),
        lastCandidateCount: 0,
        lastBlockedCandidateCount: 0,
      },
    ],
  }));

  const collected = await collectDiagnosticSnapshot(healthyDiagnosticInput());
  const automation = collected.snapshots.find(
    (snapshot) => snapshot.subsystem === "automation",
  );
  const longScanEvent = collected.events.find(
    (event) => event.code === "signal_options_scan_long_running",
  );
  const stoppedScanEvent = collected.events.find(
    (event) => event.code === "signal_options_scan_stale",
  );

  assert.equal(automation?.status, "degraded");
  assert.equal(automation?.metrics.activeLongScanCount, 1);
  assert.equal(automation?.metrics.inactiveStaleScanCount, 0);
  assert.equal(longScanEvent?.severity, "warning");
  assert.equal(stoppedScanEvent, undefined);
});

test("diagnostics keep automation long-scan pressure out of footer memory pressure", async () => {
  const nowMs = Date.now();
  registerSignalOptionsWorkerSnapshotGetter(() => ({
    started: true,
    tickRunning: true,
    deploymentCount: 1,
    activeDeploymentCount: 1,
    maintenance: emptyWorkerMaintenanceSnapshot(),
    deployments: [
      {
        deploymentId: "deployment-1",
        lastCheckedAtMs: nowMs - 150_000,
        failedUntilMs: 0,
        lastSuccessAt: new Date(nowMs - 150_000).toISOString(),
        lastError: null,
        currentScanStartedAt: new Date(nowMs - 150_000).toISOString(),
        currentScanAgeMs: 150_000,
        lastScanDurationMs: 12_000,
        scanCount: 4,
        totalFailureCount: 0,
        failureCount: 0,
        lastFailureAt: null,
        lastSignalCount: 8,
        lastFreshSignalCount: 8,
        lastStaleSignalCount: 0,
        lastUnavailableSignalCount: 0,
        lastLatestSignalBarAt: new Date(nowMs - 150_000).toISOString(),
        lastOldestSignalBarAt: new Date(nowMs - 150_000).toISOString(),
        lastCandidateCount: 0,
        lastBlockedCandidateCount: 0,
      },
    ],
  }));

  const collected = await collectDiagnosticSnapshot(healthyDiagnosticInput());
  const resourcePressure = collected.snapshots.find(
    (snapshot) => snapshot.subsystem === "resource-pressure",
  );
  const apiResourcePressure = resourcePressure?.metrics.apiResourcePressure as
    | {
        scannerPressure?: {
          level?: string;
          activeLongScanCount?: number | null;
        };
      }
    | undefined;
  const dominantDrivers = Array.isArray(
    resourcePressure?.metrics.dominantDrivers,
  )
    ? resourcePressure?.metrics.dominantDrivers
    : [];

  assert.equal(resourcePressure?.status, "ok");
  assert.equal(resourcePressure?.metrics.pressureLevel, "normal");
  assert.equal(resourcePressure?.metrics.apiPressureLevel, "normal");
  assert.deepEqual(
    resourcePressure?.metrics.apiRssThresholds,
    resolveApiRssPressureThresholds(),
  );
  assert.equal(apiResourcePressure?.scannerPressure?.level, "high");
  assert.equal(
    apiResourcePressure?.scannerPressure?.activeLongScanCount,
    1,
  );
  assert.equal(
    dominantDrivers.some((driver) => driver?.kind === "automation"),
    false,
  );
  assert.equal(collected.footerMemoryPressure?.level, "normal");
});

test("diagnostics keep API latency and cache pressure out of footer memory pressure", async () => {
  for (let index = 0; index < 20; index += 1) {
    recordApiRequest({
      method: "GET",
      path: "/api/slow-resource",
      statusCode: 200,
      durationMs: 1_250,
    });
  }

  const collected = await collectDiagnosticSnapshot({
    runtime: {
      api: {
        uptimeMs: 10_000,
        memoryMb: {
          heapUsed: 128,
          heapTotal: 256,
          rss: 512,
          external: 16,
          arrayBuffers: 4,
        },
        resourceCaches: {
          bars: { entries: 256, maxEntries: 256, inFlight: 0 },
        },
      },
      ibkr: {
        configured: true,
        reachable: true,
        connected: true,
        authenticated: true,
        competing: false,
        lastTickleAt: new Date().toISOString(),
      },
    },
    probes: {
      accounts: { ok: true, count: 1 },
      positions: { ok: true, count: 1 },
      orders: { ok: true, count: 0 },
    },
  });
  const resourcePressure = collected.snapshots.find(
    (snapshot) => snapshot.subsystem === "resource-pressure",
  );
  const dominantDrivers = Array.isArray(
    resourcePressure?.metrics.dominantDrivers,
  )
    ? resourcePressure?.metrics.dominantDrivers
    : [];

  assert.equal(resourcePressure?.metrics.pressureLevel, "watch");
  assert.equal(
    dominantDrivers.some((driver) => driver?.kind === "api-latency"),
    true,
  );
  assert.equal(
    dominantDrivers.some((driver) => driver?.kind === "cache-pressure"),
    true,
  );
  assert.equal(collected.footerMemoryPressure?.level, "normal");
  assert.equal(collected.footerMemoryPressure?.apiRssMb, 512);
  assert.deepEqual(
    collected.footerMemoryPressure?.apiRssThresholds,
    resolveApiRssPressureThresholds(),
  );
  assert.deepEqual(collected.footerMemoryPressure?.dominantDrivers, []);
});

test("diagnostics reports resource-pressure paused scans without stale critical paging", async () => {
  const nowMs = Date.now();
  registerSignalOptionsWorkerSnapshotGetter(() => ({
    started: true,
    tickRunning: false,
    deploymentCount: 1,
    activeDeploymentCount: 0,
    maintenance: emptyWorkerMaintenanceSnapshot(),
    deployments: [
      {
        deploymentId: "deployment-1",
        lastCheckedAtMs: nowMs - 600_000,
        failedUntilMs: 0,
        lastSuccessAt: new Date(nowMs - 600_000).toISOString(),
        lastError: null,
        lastSkippedAt: new Date(nowMs - 10_000).toISOString(),
        lastSkipReason: "resource_pressure",
        skippedScanCount: 8,
        pressurePaused: true,
        pressurePauseStartedAt: new Date(nowMs - 480_000).toISOString(),
        pressurePauseAgeMs: 480_000,
        currentScanStartedAt: null,
        currentScanAgeMs: null,
        lastScanDurationMs: 12_000,
        scanCount: 4,
        totalFailureCount: 0,
        failureCount: 0,
        lastFailureAt: null,
        lastSignalCount: 8,
        lastFreshSignalCount: 8,
        lastStaleSignalCount: 0,
        lastUnavailableSignalCount: 0,
        lastLatestSignalBarAt: new Date(nowMs - 600_000).toISOString(),
        lastOldestSignalBarAt: new Date(nowMs - 600_000).toISOString(),
        lastCandidateCount: 0,
        lastBlockedCandidateCount: 0,
      },
    ],
  }));

  const collected = await collectDiagnosticSnapshot(healthyDiagnosticInput());
  const automation = collected.snapshots.find(
    (snapshot) => snapshot.subsystem === "automation",
  );
  const pressurePausedEvent = collected.events.find(
    (event) => event.code === "signal_options_scan_pressure_paused",
  );
  const staleEvent = collected.events.find(
    (event) => event.code === "signal_options_scan_stale",
  );
  const latestAgeThreshold = collected.events.find(
    (event) => event.code === "automation.latest_scan_age_ms",
  );

  assert.equal(automation?.status, "degraded");
  assert.equal(automation?.severity, "warning");
  assert.equal(automation?.metrics.pressurePausedDeploymentCount, 1);
  assert.equal(pressurePausedEvent?.severity, "warning");
  assert.equal(staleEvent, undefined);
  assert.equal(latestAgeThreshold, undefined);
});

test("diagnostics do not treat prior resource-pressure skips as active pauses", async () => {
  const nowMs = Date.now();
  registerSignalOptionsWorkerSnapshotGetter(() => ({
    started: true,
    tickRunning: false,
    deploymentCount: 1,
    activeDeploymentCount: 0,
    maintenance: emptyWorkerMaintenanceSnapshot(),
    deployments: [
      {
        deploymentId: "deployment-1",
        lastCheckedAtMs: nowMs - 600_000,
        failedUntilMs: 0,
        lastSuccessAt: new Date(nowMs - 600_000).toISOString(),
        lastError: null,
        lastSkippedAt: new Date(nowMs - 600_000).toISOString(),
        lastSkipReason: "resource_pressure",
        skippedScanCount: 2,
        pressurePaused: false,
        pressurePauseStartedAt: null,
        pressurePauseAgeMs: null,
        currentScanStartedAt: null,
        currentScanAgeMs: null,
        lastScanDurationMs: 12_000,
        scanCount: 4,
        totalFailureCount: 0,
        failureCount: 0,
        lastFailureAt: null,
        lastSignalCount: 8,
        lastFreshSignalCount: 8,
        lastStaleSignalCount: 0,
        lastUnavailableSignalCount: 0,
        lastLatestSignalBarAt: new Date(nowMs - 600_000).toISOString(),
        lastOldestSignalBarAt: new Date(nowMs - 600_000).toISOString(),
        lastCandidateCount: 0,
        lastBlockedCandidateCount: 0,
      },
    ],
  }));

  const collected = await collectDiagnosticSnapshot(healthyDiagnosticInput());
  const automation = collected.snapshots.find(
    (snapshot) => snapshot.subsystem === "automation",
  );

  assert.equal(automation?.metrics.pressurePausedDeploymentCount, 0);
  assert.equal(automation?.metrics.pressurePausedMaxAgeMs, null);
});

test("diagnostics distinguish expiring-today options from due expiration maintenance", () => {
  assert.match(diagnosticsSource, /function isMarketCloseOrLater/);
  assert.match(diagnosticsSource, /expirationMaintenanceDueCount/);
  assert.match(diagnosticsSource, /expiringTodayOpenShadowOptionCount/);
  assert.match(diagnosticsSource, /shadow_option_expiring_today/);
  assert.match(
    diagnosticsSource,
    /expiration === todayMarketDate[\s\S]*?if \(marketCloseReached\)[\s\S]*?counts\.due \+= 1/,
  );
});

test("diagnostics classify configured Postgres outages as storage events only", async () => {
  __setStorageHealthProbeForTests(async () => {
    throw new Error("Connection terminated due to connection timeout");
  });

  const collected = await collectDiagnosticSnapshot({
    runtime: {
      ibkr: {
        configured: true,
        bridgeUrlConfigured: true,
        bridgeTokenConfigured: true,
        reachable: true,
        connected: true,
        authenticated: true,
        competing: false,
        healthFresh: true,
        streamState: "quiet",
        strictReady: true,
        strictReason: null,
        lastTickleAt: new Date().toISOString(),
      },
    },
    probes: {
      accounts: { ok: true, count: 1 },
      positions: { ok: true, count: 1 },
      orders: { ok: true, count: 0 },
    },
  });

  const ibkr = collected.snapshots.find((snapshot) => snapshot.subsystem === "ibkr");
  const storage = collected.snapshots.find((snapshot) => snapshot.subsystem === "storage");
  const storageEvent = collected.events.find(
    (event) => event.code === "postgres_unavailable",
  );

  assert.equal(ibkr?.status, "ok");
  assert.equal(storage?.status, "down");
  assert.equal(storage?.metrics.status, "unavailable");
  assert.equal(storageEvent?.subsystem, "storage");
  assert.equal(storageEvent?.severity, "critical");
});

test("diagnostics expose defaults, browser events, and memory-backed history", async () => {
  const thresholds = await getDiagnosticThresholds();
  assert.ok(thresholds.some((threshold) => threshold.metricKey === "api.p95_latency_ms"));
  assert.ok(
    thresholds.some(
      (threshold) =>
        threshold.metricKey === "chart_hydration.prepend_p95_ms",
    ),
  );

  const event = await recordBrowserDiagnosticEvent({
    category: "unit-test",
    severity: "warning",
    message: "Client event test",
    raw: { ok: true },
  });
  assert.equal(event.subsystem, "browser");
  assert.equal(event.category, "unit-test");

  const history = await listDiagnosticHistory({
    from: new Date(Date.now() - 60_000),
    to: new Date(Date.now() + 60_000),
  });
  assert.ok(history.snapshots.length > 0);
  assert.ok(history.points.length > 0);
});

test("diagnostic threshold reads reuse short-lived override cache", async () => {
  let loadCount = 0;
  const restore = __setDiagnosticThresholdOverrideRowsLoaderForTests(async () => {
    loadCount += 1;
    return [
      {
        metricKey: "api.p95_latency_ms",
        warning: 1234,
        critical: 5678,
        enabled: false,
        audible: false,
      },
    ];
  });

  try {
    const first = await getDiagnosticThresholds();
    const second = await getDiagnosticThresholds();
    const firstApiThreshold = first.find(
      (threshold) => threshold.metricKey === "api.p95_latency_ms",
    );
    const secondApiThreshold = second.find(
      (threshold) => threshold.metricKey === "api.p95_latency_ms",
    );

    assert.equal(loadCount, 1);
    assert.equal(firstApiThreshold?.warning, 1234);
    assert.equal(firstApiThreshold?.critical, 5678);
    assert.equal(secondApiThreshold?.enabled, false);
    assert.equal(secondApiThreshold?.audible, false);

    __resetDiagnosticThresholdOverridesCacheForTests();
    await getDiagnosticThresholds();
    assert.equal(loadCount, 2);
  } finally {
    restore();
  }
});

test("diagnostics clamp raw history and export limits under API pressure", async () => {
  updateApiResourcePressure({
    rssMb: resolveApiRssPressureThresholds().critical + 1,
  });
  const from = new Date(Date.now() - 60_000);
  const to = new Date(Date.now() + 60_000);

  const history = await listDiagnosticHistory({
    from,
    to,
    limit: 2_500,
  });
  assert.equal(history.limits.pressureLevel, "critical");
  assert.equal(history.limits.appliedLimit, 120);
  assert.equal(history.limits.pressureLimited, true);

  const exported = await exportDiagnostics({
    from,
    to,
    snapshotLimit: 2_500,
    eventLimit: 1_000,
  });
  assert.equal(exported.limits.pressureLevel, "critical");
  assert.equal(exported.limits.historyLimit, 60);
  assert.equal(exported.limits.eventLimit, 40);
  assert.equal(exported.limits.history.pressureLimited, true);
  assert.equal(exported.limits.events.pressureLimited, true);
});

test("diagnostics compact raw payloads retained in memory and events", async () => {
  const collected = await collectDiagnosticSnapshot({
    ...healthyDiagnosticInput(),
    runtime: {
      ...healthyDiagnosticInput().runtime,
      largeDebugTree: {
        items: Array.from({ length: 60 }, (_unused, index) => ({
          index,
          text: "x".repeat(2_500),
        })),
      },
    },
  });
  const api = collected.snapshots.find((snapshot) => snapshot.subsystem === "api");
  assert.deepEqual(api?.raw, {});

  const event = await recordServerDiagnosticEvent({
    subsystem: "api",
    category: "unit-test",
    severity: "warning",
    message: "large raw payload",
    raw: {
      items: Array.from({ length: 25 }, (_unused, index) => ({ index })),
      text: "x".repeat(2_500),
    },
  });
  assert.equal(Array.isArray(event.raw.items), true);
  assert.equal((event.raw.items as unknown[]).length, 21);
  assert.equal(String(event.raw.text).length, 2_003);
});

test("diagnostics classify stale IB Gateway tunnels and market-data gaps", async () => {
  const collected = await collectDiagnosticSnapshot({
    runtime: {
      ibkr: {
        configured: true,
        bridgeUrlConfigured: true,
        bridgeTokenConfigured: true,
        reachable: false,
        connected: false,
        authenticated: false,
        competing: false,
        healthError: "Upstream request failed.",
        healthErrorCode: "upstream_request_failed",
        healthErrorStatusCode: 502,
        healthErrorDetail: "getaddrinfo ENOTFOUND stale.trycloudflare.com",
      },
    },
    probes: {
      marketData: {
        activeConsumerCount: 2,
        unionSymbolCount: 2,
        cachedQuoteCount: 1,
        eventCount: 8,
        lastEventAgeMs: 12_500,
        freshnessAgeMs: 12_500,
        streamGapCount: 1,
        maxGapMs: 12_500,
        reconnectCount: 1,
      },
      accounts: { ok: true, count: 0 },
      positions: { ok: true, count: 0 },
      orders: { ok: true, count: 0 },
    },
  });

  const ibkrEvent = collected.events.find(
    (event) => event.code === "ibkr_bridge_stale_tunnel",
  );
  const marketData = collected.snapshots.find(
    (snapshot) => snapshot.subsystem === "market-data",
  );

  assert.equal(ibkrEvent?.severity, "critical");
  assert.match(ibkrEvent?.message ?? "", /stale|unreachable/i);
  assert.equal(marketData?.status, "down");
  assert.equal(marketData?.metrics.freshness_age_ms, 12_500);
});

test("diagnostics preserve stale tunnel root cause while bridge health is backed off", async () => {
  const rootFailure =
    "HTTP 502 Bad Gateway: 502 Bad Gateway\nUnable to reach the origin service. The service may be down or it may not be responding to traffic from cloudflared";
  const collected = await collectDiagnosticSnapshot({
    runtime: {
      ibkr: {
        configured: true,
        bridgeUrlConfigured: true,
        bridgeTokenConfigured: true,
        reachable: false,
        connected: false,
        authenticated: false,
        competing: false,
        healthFresh: false,
        healthError: "IBKR bridge health is temporarily backed off.",
        healthErrorCode: "ibkr_bridge_health_backoff",
        healthErrorStatusCode: 503,
        healthErrorDetail: "Bridge health checks are backed off for 5716ms.",
        governor: {
          health: {
            lastFailure: rootFailure,
          },
        },
      },
    },
    probes: {
      marketData: {
        activeConsumerCount: 0,
        unionSymbolCount: 0,
        cachedQuoteCount: 0,
        eventCount: 0,
      },
      accounts: { ok: false },
      positions: { ok: false },
      orders: { ok: false },
    },
  });

  const staleTunnel = collected.events.find(
    (event) => event.code === "ibkr_bridge_stale_tunnel",
  );
  const backoffOnly = collected.events.find(
    (event) => event.code === "ibkr_bridge_health_backoff",
  );

  assert.equal(staleTunnel?.severity, "critical");
  assert.match(staleTunnel?.message ?? "", /Unable to reach the origin service/);
  assert.match(staleTunnel?.message ?? "", /cloudflared/);
  assert.equal(backoffOnly, undefined);
});

test("diagnostics link bridge-dependent symptoms to stale tunnel root cause", async () => {
  const nowMs = Date.now();
  const rootFailure =
    "HTTP 502 Bad Gateway: 502 Bad Gateway\nUnable to reach the origin service. The service may be down or it may not be responding to traffic from cloudflared";
  registerSignalOptionsWorkerSnapshotGetter(() => ({
    started: true,
    tickRunning: false,
    deploymentCount: 1,
    activeDeploymentCount: 1,
    maintenance: emptyWorkerMaintenanceSnapshot(),
    deployments: [
      {
        deploymentId: "deployment-1",
        lastCheckedAtMs: nowMs - 420_000,
        failedUntilMs: 0,
        lastSuccessAt: new Date(nowMs - 420_000).toISOString(),
        lastError: "IB Gateway is required for algorithm execution.",
        currentScanStartedAt: null,
        currentScanAgeMs: null,
        lastScanDurationMs: 1_000,
        scanCount: 4,
        totalFailureCount: 9,
        failureCount: 9,
        lastFailureAt: new Date(nowMs - 20_000).toISOString(),
        lastSignalCount: 10,
        lastFreshSignalCount: 10,
        lastStaleSignalCount: 0,
        lastUnavailableSignalCount: 0,
        lastLatestSignalBarAt: new Date(nowMs - 420_000).toISOString(),
        lastOldestSignalBarAt: new Date(nowMs - 420_000).toISOString(),
        lastCandidateCount: 0,
        lastBlockedCandidateCount: 0,
      },
    ],
  }));

  const collected = await collectDiagnosticSnapshot({
    runtime: {
      ibkr: {
        configured: true,
        bridgeUrlConfigured: true,
        bridgeTokenConfigured: true,
        reachable: false,
        connected: false,
        authenticated: false,
        competing: false,
        healthFresh: false,
        healthError: "IBKR bridge health is temporarily backed off.",
        healthErrorCode: "ibkr_bridge_health_backoff",
        healthErrorStatusCode: 503,
        healthErrorDetail: "Bridge health checks are backed off for 5716ms.",
        governor: {
          health: {
            lastFailure: rootFailure,
          },
        },
      },
    },
    probes: {
      marketData: {
        activeConsumerCount: 3,
        unionSymbolCount: 30,
        cachedQuoteCount: 20,
        eventCount: 50,
        lastEventAgeMs: 620_000,
        freshnessAgeMs: 620_000,
        streamGapCount: 5,
        maxGapMs: 62_000,
        lastError: "IBKR bridge quote stream failed with HTTP 502.",
      },
      accounts: { ok: false, error: "bridge unavailable" },
      positions: { ok: false, error: "bridge unavailable" },
      orders: { ok: false, error: "bridge unavailable" },
    },
  });

  const staleTunnel = collected.events.find(
    (event) => event.code === "ibkr_bridge_stale_tunnel",
  );
  const dependentEvents = [
    "bridge_quote_stream_error",
    "read_probe_failed",
    "signal_options_worker_failure",
    "signal_options_scan_stale",
  ].map((code) => collected.events.find((event) => event.code === code));
  const suppressedAutomationThresholds = collected.events.filter(
    (event) =>
      event.category === "threshold" &&
      [
        "automation.latest_scan_age_ms",
        "automation.gateway_blocked_count",
        "automation.failure_count",
      ].includes(event.code ?? ""),
  );

  assert.equal(staleTunnel?.severity, "critical");
  assert.ok(staleTunnel?.incidentKey);
  dependentEvents.forEach((event) => {
    assert.equal(event?.severity, "warning");
    assert.equal(event?.dimensions.dependencyBlocked, true);
    assert.equal(event?.dimensions.rootCauseIncidentKey, staleTunnel?.incidentKey);
    assert.equal(event?.dimensions.rootCauseCode, "ibkr_bridge_stale_tunnel");
  });
  assert.deepEqual(suppressedAutomationThresholds, []);
});

test("diagnostics keep recovered market-data gaps visible without alerting current health", async () => {
  const collected = await collectDiagnosticSnapshot({
    runtime: {
      ibkr: {
        configured: true,
        bridgeUrlConfigured: true,
        bridgeTokenConfigured: true,
        reachable: true,
        connected: true,
        authenticated: true,
        competing: false,
        healthFresh: true,
        streamFresh: true,
        strictReady: true,
        strictReason: null,
        streamState: "live",
        streamStateReason: "fresh_stream_event",
        lastTickleAt: new Date().toISOString(),
      },
    },
    probes: {
      marketData: {
        activeConsumerCount: 2,
        unionSymbolCount: 78,
        cachedQuoteCount: 79,
        eventCount: 750_000,
        lastEventAgeMs: 120,
        freshnessAgeMs: 120,
        streamGapCount: 9,
        maxGapMs: 64_075,
        recentGapCount: 0,
        recentMaxGapMs: null,
        reconnectCount: 9,
        lastError: "IBKR bridge quote stream ended.",
      },
      accounts: { ok: true, count: 2 },
      positions: { ok: true, count: 1 },
      orders: { ok: true, count: 0 },
    },
  });

  const marketData = collected.snapshots.find(
    (snapshot) => snapshot.subsystem === "market-data",
  );

  assert.equal(marketData?.status, "ok");
  assert.equal(marketData?.metrics.stream_gap_ms, null);
  assert.equal(marketData?.metrics.lastError, null);
  assert.equal(marketData?.metrics.rawLastError, "IBKR bridge quote stream ended.");
  assert.equal(marketData?.metrics.rawMaxGapMs, 64_075);
  assert.equal(marketData?.metrics.rawStreamGapCount, 9);
});

test("diagnostics do not flap IBKR status between normal bridge tickles", async () => {
  const collected = await collectDiagnosticSnapshot({
    runtime: {
      ibkr: {
        configured: true,
        bridgeUrlConfigured: true,
        bridgeTokenConfigured: true,
        reachable: true,
        connected: true,
        authenticated: true,
        competing: false,
        healthFresh: true,
        streamFresh: true,
        strictReady: true,
        strictReason: null,
        streamState: "live",
        streamStateReason: "fresh_stream_event",
        lastStreamEventAgeMs: 150,
        lastTickleAt: new Date(Date.now() - 120_000).toISOString(),
      },
    },
    probes: {
      marketData: {
        activeConsumerCount: 2,
        unionSymbolCount: 25,
        cachedQuoteCount: 25,
        eventCount: 1_000,
        lastEventAgeMs: 150,
        freshnessAgeMs: 150,
        streamGapCount: 0,
        maxGapMs: null,
        reconnectCount: 0,
      },
      accounts: { ok: true, count: 2 },
      positions: { ok: true, count: 1 },
      orders: { ok: true, count: 0 },
    },
  });

  const ibkr = collected.snapshots.find((snapshot) => snapshot.subsystem === "ibkr");
  const ibkrEvents = collected.events.filter(
    (event) => event.subsystem === "ibkr",
  );

  assert.equal(ibkr?.status, "ok");
  assert.equal(ibkrEvents.length, 0);
});

test("diagnostics treat quiet market stream as healthy", async () => {
  const collected = await collectDiagnosticSnapshot({
    runtime: {
      ibkr: {
        configured: true,
        bridgeUrlConfigured: true,
        bridgeTokenConfigured: true,
        reachable: true,
        connected: true,
        authenticated: true,
        competing: false,
        healthFresh: true,
        streamFresh: false,
        strictReady: false,
        strictReason: "stream_not_fresh",
        streamState: "quiet",
        streamStateReason: "market_session_quiet",
        lastTickleAt: new Date().toISOString(),
      },
    },
    probes: {
      marketData: {
        activeConsumerCount: 2,
        unionSymbolCount: 1,
        cachedQuoteCount: 19,
        eventCount: 20,
        lastEventAgeMs: 31_000,
        freshnessAgeMs: 31_000,
        streamGapCount: 0,
        maxGapMs: 3_229,
        reconnectCount: 2,
      },
      accounts: { ok: true, count: 2 },
      positions: { ok: true, count: 1 },
      orders: { ok: true, count: 0 },
    },
  });

  const ibkr = collected.snapshots.find((snapshot) => snapshot.subsystem === "ibkr");
  const marketData = collected.snapshots.find(
    (snapshot) => snapshot.subsystem === "market-data",
  );
  const streamFreshnessEvent = collected.events.find(
    (event) =>
      event.category === "stream-freshness" &&
      event.raw &&
      typeof event.raw === "object" &&
      "streamState" in event.raw &&
      event.raw.streamState === "quiet",
  );

  assert.equal(ibkr?.status, "ok");
  assert.equal(marketData?.status, "ok");
  assert.equal(marketData?.metrics.freshness_age_ms, null);
  assert.equal(marketData?.metrics.rawFreshnessAgeMs, 31_000);
  assert.equal(streamFreshnessEvent, undefined);

  const openEvents = await listDiagnosticEvents({
    from: new Date(Date.now() - 60_000),
    to: new Date(Date.now() + 60_000),
    status: "open",
  });
  assert.equal(
    openEvents.events.some(
      (event) => event.incidentKey === "ibkr:stale-tunnel:ibkr_bridge_stale_tunnel",
    ),
    false,
  );
  assert.equal(
    openEvents.events.some(
      (event) => event.incidentKey === "market-data:threshold:market_data.freshness_age_ms",
    ),
    false,
  );
});

test("diagnostics surface active Massive stock WebSocket when IBKR is quiet", async () => {
  const collected = await collectDiagnosticSnapshot({
    runtime: {
      ibkr: {
        configured: true,
        bridgeUrlConfigured: true,
        bridgeTokenConfigured: true,
        reachable: true,
        connected: true,
        authenticated: true,
        competing: false,
        healthFresh: true,
        streamFresh: false,
        strictReady: false,
        strictReason: "market_session_quiet",
        streamState: "quiet",
        streamStateReason: "market_session_quiet",
        lastTickleAt: new Date().toISOString(),
      },
      providers: {
        massive: {
          configured: true,
          websocket: {
            status: "ok",
            subscribedSymbolCount: 500,
            activeConsumerCount: 3,
            eventCount: 0,
            reconnectCount: 0,
            lastSocketMessageAgeMs: 31_000,
            lastError: null,
          },
        },
      },
    },
    probes: {
      marketData: {
        activeConsumerCount: 0,
        unionSymbolCount: 0,
        cachedQuoteCount: 0,
        eventCount: 0,
        lastEventAgeMs: null,
        freshnessAgeMs: null,
        streamGapCount: 0,
        maxGapMs: null,
        reconnectCount: 0,
      },
      accounts: { ok: true, count: 2 },
      positions: { ok: true, count: 1 },
      orders: { ok: true, count: 0 },
    },
  });

  const marketData = collected.snapshots.find(
    (snapshot) => snapshot.subsystem === "market-data",
  );
  assert.equal(marketData?.status, "ok");
  assert.equal(marketData?.metrics.streamState, "live");
  assert.equal(
    marketData?.metrics.streamStateReason,
    "massive_stock_stream_subscribed",
  );
  assert.equal(marketData?.metrics.unionSymbolCount, 500);
  assert.equal(marketData?.metrics.activeConsumerCount, 3);
  assert.equal(marketData?.metrics.massiveSubscribedSymbolCount, 500);
  assert.equal(marketData?.metrics.massiveLastSocketMessageAgeMs, 31_000);
  assert.equal(marketData?.metrics.freshnessAgeMs, null);
});

test("diagnostics include reconnecting quote-stream errors without truncation", async () => {
  const lastError =
    "Error validating request.-'bO' : cause - Snapshot market data subscription is not applicable to generic ticks";
  const collected = await collectDiagnosticSnapshot({
    runtime: {
      ibkr: {
        configured: true,
        bridgeUrlConfigured: true,
        bridgeTokenConfigured: true,
        reachable: true,
        connected: true,
        authenticated: true,
        competing: false,
        healthFresh: true,
        streamFresh: false,
        strictReady: false,
        strictReason: "stream_not_fresh",
        streamState: "reconnecting",
        streamStateReason: "quote_stream_error",
        lastError,
        lastTickleAt: new Date().toISOString(),
      },
    },
    probes: {
      marketData: {
        activeConsumerCount: 2,
        unionSymbolCount: 1,
        cachedQuoteCount: 19,
        eventCount: 20,
        lastEventAgeMs: 31_000,
        freshnessAgeMs: 31_000,
        streamGapCount: 0,
        maxGapMs: 3_229,
        reconnectCount: 2,
      },
      accounts: { ok: true, count: 2 },
      positions: { ok: true, count: 1 },
      orders: { ok: true, count: 0 },
    },
  });

  const streamFreshnessEvent = collected.events.find(
    (event) => event.category === "stream-freshness",
  );

  assert.equal(
    streamFreshnessEvent?.message,
    `IB Gateway is authenticated and the quote stream is reconnecting: ${lastError}`,
  );
  assert.doesNotMatch(streamFreshnessEvent?.message ?? "", /\.\.\.$/);
});

test("diagnostics classify degraded order reads without marking IBKR disconnected", async () => {
  const collected = await collectDiagnosticSnapshot({
    runtime: {
      ibkr: {
        configured: true,
        bridgeUrlConfigured: true,
        bridgeTokenConfigured: true,
        reachable: true,
        connected: true,
        authenticated: true,
        competing: false,
        lastTickleAt: new Date().toISOString(),
      },
    },
    probes: {
      accounts: { ok: true, count: 1 },
      positions: { ok: true, count: 1 },
      orders: {
        ok: true,
        count: 0,
        degraded: true,
        reason: "orders_timeout",
        stale: false,
      },
    },
  });

  const ibkr = collected.snapshots.find((snapshot) => snapshot.subsystem === "ibkr");
  const orders = collected.snapshots.find((snapshot) => snapshot.subsystem === "orders");
  const orderEvent = collected.events.find(
    (event) => event.code === "read_probe_degraded",
  );

  assert.equal(ibkr?.status, "ok");
  assert.equal(orders?.status, "degraded");
  assert.equal(orders?.metrics.degraded, true);
  assert.equal(orderEvent?.severity, "warning");
});

test("diagnostics include resource pressure and browser isolation readiness", async () => {
  await recordClientDiagnosticsMetrics({
    memory: {
      source: "measureUserAgentSpecificMemory",
      confidence: "high",
      bytes: 256 * 1024 * 1024,
    },
    isolation: {
      crossOriginIsolated: true,
      memoryApiAvailable: true,
      memoryApiUsed: true,
    },
    workload: { chartScopeCount: 2 },
  });

  const collected = await collectDiagnosticSnapshot({
    runtime: {
      api: {
        uptimeMs: 10_000,
        memoryMb: {
          heapUsed: 128,
          heapTotal: 256,
          rss: 512,
          external: 16,
          arrayBuffers: 4,
        },
        resourceCaches: {
          bars: { entries: 2, maxEntries: 256, inFlight: 0 },
        },
      },
      ibkr: {
        configured: true,
        reachable: true,
        connected: true,
        authenticated: true,
        competing: false,
        lastTickleAt: new Date().toISOString(),
      },
    },
    probes: {
      accounts: { ok: true, count: 1 },
      positions: { ok: true, count: 1 },
      orders: { ok: true, count: 0 },
    },
  });

  const resourcePressure = collected.snapshots.find(
    (snapshot) => snapshot.subsystem === "resource-pressure",
  );
  const isolation = collected.snapshots.find(
    (snapshot) => snapshot.subsystem === "isolation",
  );

  assert.equal(resourcePressure?.status, "ok");
  assert.equal(resourcePressure?.metrics.browserMemoryMb, 256);
  assert.equal(resourcePressure?.metrics.browserMemoryConfidence, "high");
  assert.equal(collected.footerMemoryPressure?.level, "normal");
  assert.equal(collected.footerMemoryPressure?.browserMemoryMb, 256);
  assert.equal(isolation?.metrics.crossOriginIsolated, true);
  assert.equal(isolation?.metrics.memoryApiUsed, true);
});

test("diagnostics use browser heap limit before classifying browser memory as critical", async () => {
  await recordClientDiagnosticsMetrics({
    memory: {
      source: "performance.memory",
      confidence: "medium",
      usedJsHeapSize: 2_600 * 1024 * 1024,
      jsHeapSizeLimit: 4_096 * 1024 * 1024,
    },
    isolation: {
      crossOriginIsolated: false,
      memoryApiAvailable: true,
      memoryApiUsed: false,
    },
    workload: { chartScopeCount: 2 },
  });

  const collected = await collectDiagnosticSnapshot({
    runtime: {
      api: {
        uptimeMs: 10_000,
        memoryMb: {
          heapUsed: 128,
          heapTotal: 256,
          rss: 512,
          external: 16,
          arrayBuffers: 4,
        },
        resourceCaches: {
          bars: { entries: 2, maxEntries: 256, inFlight: 0 },
        },
      },
      ibkr: {
        configured: true,
        reachable: true,
        connected: true,
        authenticated: true,
        competing: false,
        lastTickleAt: new Date().toISOString(),
      },
    },
    probes: {
      accounts: { ok: true, count: 1 },
      positions: { ok: true, count: 1 },
      orders: { ok: true, count: 0 },
    },
  });

  const resourcePressure = collected.snapshots.find(
    (snapshot) => snapshot.subsystem === "resource-pressure",
  );
  const browserThresholdEvents = collected.events.filter(
    (event) => event.code === "resource_pressure.browser_memory_mb",
  );

  assert.equal(resourcePressure?.status, "degraded");
  assert.equal(resourcePressure?.severity, "warning");
  assert.equal(resourcePressure?.metrics.browserMemoryMb, 2600);
  assert.equal(resourcePressure?.metrics.browserMemoryLimitMb, 4096);
  assert.equal(resourcePressure?.metrics.browserMemoryLimitPercent, 63.5);
  assert.equal(collected.footerMemoryPressure?.level, "watch");
  assert.equal(collected.footerMemoryPressure?.browserMemoryLimitMb, 4096);
  assert.equal(
    browserThresholdEvents.some((event) => event.severity === "critical"),
    false,
  );
});

test("diagnostics treat full bounded caches as warning pressure, not outage", async () => {
  const collected = await collectDiagnosticSnapshot({
    runtime: {
      api: {
        uptimeMs: 10_000,
        memoryMb: {
          heapUsed: 128,
          heapTotal: 256,
          rss: 512,
          external: 16,
          arrayBuffers: 4,
        },
        resourceCaches: {
          optionChains: { entries: 128, maxEntries: 128, inFlight: 0 },
        },
      },
      ibkr: {
        configured: true,
        bridgeUrlConfigured: true,
        bridgeTokenConfigured: true,
        reachable: true,
        connected: true,
        authenticated: true,
        competing: false,
        healthFresh: true,
        streamState: "quiet",
        streamStateReason: "no_active_quote_consumers",
        strictReady: true,
        strictReason: null,
        lastTickleAt: new Date().toISOString(),
      },
    },
    probes: {
      accounts: { ok: true, count: 1 },
      positions: { ok: true, count: 1 },
      orders: { ok: true, count: 0 },
    },
  });

  const resourcePressure = collected.snapshots.find(
    (snapshot) => snapshot.subsystem === "resource-pressure",
  );

  assert.equal(resourcePressure?.status, "degraded");
  assert.equal(resourcePressure?.severity, "warning");
  assert.equal(resourcePressure?.metrics.pressureLevel, "watch");
  assert.notEqual(collected.status, "down");
});

test("diagnostics keep non-isolation browser reports out of isolation alerts", async () => {
  const result = await recordBrowserReports([
    {
      type: "threshold",
      url: "https://pyrus.local/",
      body: {
        id: "layout-shift",
        message: "Browser threshold report",
      },
    },
  ]);

  assert.equal(result.accepted, 1);

  const collected = await collectDiagnosticSnapshot({
    runtime: {
      ibkr: {
        configured: true,
        reachable: true,
        connected: true,
        authenticated: true,
        competing: false,
        lastTickleAt: new Date().toISOString(),
      },
    },
    probes: {
      accounts: { ok: true, count: 1 },
      positions: { ok: true, count: 1 },
      orders: { ok: true, count: 0 },
    },
  });

  const isolation = collected.snapshots.find(
    (snapshot) => snapshot.subsystem === "isolation",
  );
  const browser = collected.snapshots.find(
    (snapshot) => snapshot.subsystem === "browser",
  );

  assert.equal(isolation?.status, "ok");
  assert.equal(isolation?.metrics.reportCount5m, 0);
  assert.equal(
    Number((browser?.metrics as Record<string, unknown> | undefined)?.eventCount5m ?? 0) >= 1,
    true,
  );
});

test("diagnostics record COOP/COEP browser reports as isolation events", async () => {
  const result = await recordBrowserReports([
    {
      type: "coep",
      url: "https://pyrus.local/",
      body: {
        blockedURL: "https://s3-symbol-logo.tradingview.com/aapl.svg",
        disposition: "reporting",
      },
    },
  ]);

  assert.equal(result.accepted, 1);

  const collected = await collectDiagnosticSnapshot({
    runtime: {
      ibkr: {
        configured: true,
        reachable: true,
        connected: true,
        authenticated: true,
        competing: false,
        lastTickleAt: new Date().toISOString(),
      },
    },
    probes: {
      accounts: { ok: true, count: 1 },
      positions: { ok: true, count: 1 },
      orders: { ok: true, count: 0 },
    },
  });

  const isolation = collected.snapshots.find(
    (snapshot) => snapshot.subsystem === "isolation",
  );
  const event = collected.events.find(
    (item) => item.subsystem === "isolation" && item.code === "coep",
  );

  assert.equal(["degraded", "down"].includes(String(isolation?.status)), true);
  assert.equal(
    Number((isolation?.metrics as Record<string, unknown> | undefined)?.reportCount5m ?? 0) >= 1,
    true,
  );
  assert.equal(event?.severity, "warning");
});

test("diagnostics collect chart hydration metrics without leaking provider cursors", async () => {
  await recordClientDiagnosticsMetrics({
    chartHydration: {
      prependRequestMs: { p95: 2_250, count: 3 },
      modelBuildMs: { p95: 18, count: 3 },
      firstPaintMs: { p95: 75, count: 3 },
      counters: {
        payloadShapeError: 1,
        olderPageDuplicate: 4,
        olderPageFetch: 6,
        providerCursorPage: 2,
        historyCursorPage: 2,
      },
      activeScopeCount: 1,
      exhaustedScopeCount: 0,
      prependingScopeCount: 1,
      scopeRoles: { primary: 1 },
      scopes: [
        {
          scope: "SPY:1m:test",
          role: "primary",
          timeframe: "1m",
          hydratedBaseCount: 500,
          renderedBarCount: 500,
          livePatchedBarCount: 3,
          oldestLoadedAt: "2026-04-30T13:30:00.000Z",
          isPrependingOlder: true,
          hasExhaustedOlderHistory: false,
          olderHistoryProvider: "massive-history",
          olderHistoryProviderCursor:
            "https://api.massive.com/v2/aggs/ticker/SPY?apiKey=secret",
          olderHistoryProviderNextUrl:
            "https://api.massive.com/v2/aggs/ticker/SPY?apiKey=secret",
          olderHistoryCursor: "opaque-history-cursor",
          olderHistoryProviderPageCount: 2,
          olderHistoryProviderPageLimitReached: true,
        },
      ],
    },
  });

  const collected = await collectDiagnosticSnapshot({
    runtime: {
      api: {
        resourceCaches: {
          bars: {
            entries: 8,
            maxEntries: 256,
            inFlight: 1,
            historyCursorEntries: 2,
            historyCursorMaxEntries: 512,
            historyCursorTtlMs: 600_000,
            cursorEnabled: true,
            dedupeEnabled: true,
            backgroundEnabled: true,
            hydration: {
              cacheHit: 12,
              cacheMiss: 3,
              inFlightJoin: 4,
              staleServed: 1,
              providerFetch: 5,
              providerPage: 7,
              cursorContinuation: 2,
              cursorFallback: 4,
              backgroundRefresh: 1,
            },
          },
        },
      },
      ibkr: {
        configured: true,
        reachable: true,
        connected: true,
        authenticated: true,
        competing: false,
        lastTickleAt: new Date().toISOString(),
      },
    },
    probes: {
      accounts: { ok: true, count: 1 },
      positions: { ok: true, count: 1 },
      orders: { ok: true, count: 0 },
    },
  });

  const chartHydration = collected.snapshots.find(
    (snapshot) => snapshot.subsystem === "chart-hydration",
  );
  const rawText = JSON.stringify(chartHydration?.raw ?? {});

  assert.equal(chartHydration?.status, "degraded");
  assert.equal(chartHydration?.metrics.prependP95Ms, 2_250);
  assert.equal(chartHydration?.metrics.cursorFallbackCount, 4);
  assert.equal(chartHydration?.metrics.payloadShapeErrors, 1);
  assert.equal(chartHydration?.metrics.duplicateOlderPageCount, 4);
  assert.equal(rawText.includes("apiKey"), false);
  assert.equal(rawText.includes("opaque-history-cursor"), false);
  assert.ok(
    collected.events.some(
      (event) =>
        event.subsystem === "chart-hydration" &&
        event.code === "chart_hydration_cursor_fallbacks",
    ),
  );
  assert.ok(
    collected.events.some(
      (event) =>
        event.subsystem === "chart-hydration" &&
        event.code === "chart_hydration_payload_shape_error",
    ),
  );
});
