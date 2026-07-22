import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  __resetRequestMetricsForTests,
  recordApiRequest,
} from "./request-metrics";
import {
  __appendAccountPositionsTimingForTests,
  __appendWorkGovernorTimingForTests,
  __appendPostgresPoolDiagnosticEventForTests,
  __recordMemorySampleForTests,
  __resetPostgresPoolDiagnosticRateLimitForTests,
  __resetAccountPositionsTimingRateLimitForTests,
  __resetWorkGovernorTimingRateLimitForTests,
  appendFlightRecorderJsonLine,
  flushRuntimeFlightRecorderBuffersSync,
  rssPressureThresholdBytes,
  writeRuntimeFlightRecorderHeartbeat,
} from "./runtime-flight-recorder";
import { resolveApiRssPressureThresholds } from "./resource-pressure";

test("RSS observability threshold defaults to the cgroup-derived watch level, not a fixed 1.5GiB", () => {
  const prev = process.env["API_RSS_WARN_BYTES"];
  delete process.env["API_RSS_WARN_BYTES"];
  try {
    const expected = resolveApiRssPressureThresholds().watch * 1024 * 1024;
    assert.equal(rssPressureThresholdBytes(), expected);
    // Guard against regressing to the old fixed 1.5GiB, which on a multi-GB
    // container fired the observability alarm while the app was healthy.
    assert.notEqual(rssPressureThresholdBytes(), 1_536 * 1024 * 1024);
  } finally {
    if (prev == null) {
      delete process.env["API_RSS_WARN_BYTES"];
    } else {
      process.env["API_RSS_WARN_BYTES"] = prev;
    }
  }
});

test("API_RSS_WARN_BYTES env overrides the RSS observability threshold", () => {
  const prev = process.env["API_RSS_WARN_BYTES"];
  process.env["API_RSS_WARN_BYTES"] = String(9 * 1024 * 1024 * 1024);
  try {
    assert.equal(rssPressureThresholdBytes(), 9 * 1024 * 1024 * 1024);
  } finally {
    if (prev == null) {
      delete process.env["API_RSS_WARN_BYTES"];
    } else {
      process.env["API_RSS_WARN_BYTES"] = prev;
    }
  }
});

test("flight recorder recent failures include route admission context", () => {
  const previousRecorderDir = process.env["PYRUS_FLIGHT_RECORDER_DIR"];
  const recorderDir = mkdtempSync(path.join(tmpdir(), "pyrus-flight-recorder-"));
  process.env["PYRUS_FLIGHT_RECORDER_DIR"] = recorderDir;
  __resetRequestMetricsForTests();

  try {
    recordApiRequest({
      method: "GET",
      path: "/api/bars",
      routeClass: "deferred-analytics",
      requestFamily: "algo-signal-sparkline",
      fetchPriority: 4,
      requestOrigin: "algo",
      clientRole: "operations-signal-table",
      statusCode: 429,
      durationMs: 1,
    });

    const heartbeat = writeRuntimeFlightRecorderHeartbeat();
    const current = JSON.parse(
      readFileSync(path.join(recorderDir, "api-current.json"), "utf8"),
    );
    const failure = (
      current.requests.recentFailures as Array<Record<string, unknown>>
    )[0];

    assert.deepEqual(
      (heartbeat?.["requests"] as Record<string, unknown>)?.["recentFailures"],
      current.requests.recentFailures,
    );
    assert.deepEqual(
      {
        method: failure?.method,
        path: failure?.path,
        routeClass: failure?.routeClass,
        requestFamily: failure?.requestFamily,
        fetchPriority: failure?.fetchPriority,
        requestOrigin: failure?.requestOrigin,
        clientRole: failure?.clientRole,
        statusCode: failure?.statusCode,
        durationMs: failure?.durationMs,
      },
      {
        method: "GET",
        path: "/api/bars",
        routeClass: "deferred-analytics",
        requestFamily: "algo-signal-sparkline",
        fetchPriority: 4,
        requestOrigin: "algo",
        clientRole: "operations-signal-table",
        statusCode: 429,
        durationMs: 1,
      },
    );
  } finally {
    __resetRequestMetricsForTests();
    if (previousRecorderDir === undefined) {
      delete process.env["PYRUS_FLIGHT_RECORDER_DIR"];
    } else {
      process.env["PYRUS_FLIGHT_RECORDER_DIR"] = previousRecorderDir;
    }
    rmSync(recorderDir, { recursive: true, force: true });
  }
});

test("flight recorder recent failures include lower 4xx errors", () => {
  const previousRecorderDir = process.env["PYRUS_FLIGHT_RECORDER_DIR"];
  const recorderDir = mkdtempSync(path.join(tmpdir(), "pyrus-flight-recorder-"));
  process.env["PYRUS_FLIGHT_RECORDER_DIR"] = recorderDir;
  __resetRequestMetricsForTests();

  try {
    recordApiRequest({
      method: "GET",
      path: "/api/missing",
      statusCode: 404,
      durationMs: 2,
    });

    writeRuntimeFlightRecorderHeartbeat();
    const current = JSON.parse(
      readFileSync(path.join(recorderDir, "api-current.json"), "utf8"),
    );
    assert.equal(current.requests.recentFailures[0]?.statusCode, 404);
    assert.equal(current.requests.recentFailures[0]?.path, "/api/missing");
  } finally {
    __resetRequestMetricsForTests();
    if (previousRecorderDir === undefined) {
      delete process.env["PYRUS_FLIGHT_RECORDER_DIR"];
    } else {
      process.env["PYRUS_FLIGHT_RECORDER_DIR"] = previousRecorderDir;
    }
    rmSync(recorderDir, { recursive: true, force: true });
  }
});

test("appendFlightRecorderJsonLine buffers and does not block the loop with a sync write", () => {
  const previousRecorderDir = process.env["PYRUS_FLIGHT_RECORDER_DIR"];
  const recorderDir = mkdtempSync(path.join(tmpdir(), "pyrus-flight-recorder-"));
  process.env["PYRUS_FLIGHT_RECORDER_DIR"] = recorderDir;
  const file = path.join(recorderDir, "buffer-test.jsonl");

  try {
    appendFlightRecorderJsonLine(file, { marker: "buffered-write-test", n: 1 });

    // The write is buffered, NOT synchronously flushed — the file must not exist
    // yet (this is the whole point: no appendFileSync on the hot loop).
    let existsBeforeFlush = true;
    try {
      readFileSync(file, "utf8");
    } catch {
      existsBeforeFlush = false;
    }
    assert.equal(
      existsBeforeFlush,
      false,
      "append must buffer, not write synchronously",
    );

    // The exit/crash sync-flush path persists the buffered line.
    flushRuntimeFlightRecorderBuffersSync();
    const contents = readFileSync(file, "utf8");
    assert.match(contents, /"marker":"buffered-write-test"/);
    assert.match(contents, /\n$/);
  } finally {
    if (previousRecorderDir === undefined) {
      delete process.env["PYRUS_FLIGHT_RECORDER_DIR"];
    } else {
      process.env["PYRUS_FLIGHT_RECORDER_DIR"] = previousRecorderDir;
    }
    rmSync(recorderDir, { recursive: true, force: true });
  }
});

test("memory sample event captures process, system, and event-loop state in the append-only log", () => {
  const previousRecorderDir = process.env["PYRUS_FLIGHT_RECORDER_DIR"];
  const recorderDir = mkdtempSync(path.join(tmpdir(), "pyrus-flight-recorder-"));
  process.env["PYRUS_FLIGHT_RECORDER_DIR"] = recorderDir;

  try {
    __recordMemorySampleForTests({
      memoryMb: { rss: 1800.5, heapUsed: 400.2 },
      apiPressure: {
        inputs: { eventLoopDelayP95Ms: 12.5, eventLoopUtilization: 0.42 },
      },
      dbPool: {
        max: 12,
        total: 12,
        idle: 0,
        active: 12,
        waiting: 1,
        rawPoolWaiting: 1,
        admissionWaiting: 22,
        totalWaiting: 23,
      },
    });
    flushRuntimeFlightRecorderBuffersSync();

    const file = path.join(
      recorderDir,
      `api-events-${new Date().toISOString().slice(0, 10)}.jsonl`,
    );
    const line = readFileSync(file, "utf8").trim().split("\n")[0];
    const event = JSON.parse(line);

    assert.equal(event.event, "api-memory-sample");
    assert.deepEqual(event.memoryMb, { rss: 1800.5, heapUsed: 400.2 });
    assert.equal(event.eventLoopDelayP95Ms, 12.5);
    assert.equal(event.eventLoopUtilization, 0.42);
    assert.deepEqual(event.dbPool, {
      active: 12,
      waiting: 1,
      rawPoolWaiting: 1,
      admissionWaiting: 22,
      totalWaiting: 23,
      max: 12,
    });
    // System memory comes from /proc/meminfo — real values on Linux, null
    // (not a crash) where /proc is unavailable.
    if (event.system !== null) {
      assert.equal(typeof event.system.totalMb, "number");
      assert.equal(typeof event.system.availableMb, "number");
    }
  } finally {
    if (previousRecorderDir === undefined) {
      delete process.env["PYRUS_FLIGHT_RECORDER_DIR"];
    } else {
      process.env["PYRUS_FLIGHT_RECORDER_DIR"] = previousRecorderDir;
    }
    rmSync(recorderDir, { recursive: true, force: true });
  }
});

test("DB diagnostic flight-recorder events include request workload context", () => {
  const previousRecorderDir = process.env["PYRUS_FLIGHT_RECORDER_DIR"];
  const recorderDir = mkdtempSync(path.join(tmpdir(), "pyrus-flight-recorder-"));
  process.env["PYRUS_FLIGHT_RECORDER_DIR"] = recorderDir;

  try {
    __appendPostgresPoolDiagnosticEventForTests({
      type: "query",
      source: "pool",
      durationMs: 2500,
      executionDurationMs: 1800,
      sql: "select 1",
      queryName: "test-query",
      error: null,
      pool: {
        max: 12,
        total: 12,
        idle: 0,
        active: 12,
        waiting: 4,
        rawPoolWaiting: 4,
        admissionWaiting: 0,
        totalWaiting: 4,
      },
      stack: [],
      context: {
        requestId: "req-1",
        method: "GET",
        path: "/api/flow/events",
        route: "GET /api/flow/events",
        routeClass: "live-data",
        requestFamily: "flow-events",
        clientRole: "flow-screen",
        fetchPriority: 5,
        requestOrigin: "flow",
        admissionAction: "allow",
        workloadFamily: "live-data",
      },
    });
    flushRuntimeFlightRecorderBuffersSync();

    const file = path.join(
      recorderDir,
      `api-events-${new Date().toISOString().slice(0, 10)}.jsonl`,
    );
    const line = readFileSync(file, "utf8").trim().split("\n")[0];
    const event = JSON.parse(line);

    assert.equal(event.event, "api-db-query-slow");
    assert.equal(event.executionDurationMs, 1800);
    assert.deepEqual(event.context, {
      requestId: "req-1",
      method: "GET",
      path: "/api/flow/events",
      route: "GET /api/flow/events",
      routeClass: "live-data",
      requestFamily: "flow-events",
      clientRole: "flow-screen",
      fetchPriority: 5,
      requestOrigin: "flow",
      admissionAction: "allow",
      workloadFamily: "live-data",
    });
  } finally {
    if (previousRecorderDir === undefined) {
      delete process.env["PYRUS_FLIGHT_RECORDER_DIR"];
    } else {
      process.env["PYRUS_FLIGHT_RECORDER_DIR"] = previousRecorderDir;
    }
    rmSync(recorderDir, { recursive: true, force: true });
  }
});

function readDayEvents(recorderDir: string): Array<Record<string, unknown>> {
  const file = path.join(
    recorderDir,
    `api-events-${new Date().toISOString().slice(0, 10)}.jsonl`,
  );
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

test("slow-query recorder truncates SQL to 300 chars and drops the stack field", () => {
  const previousRecorderDir = process.env["PYRUS_FLIGHT_RECORDER_DIR"];
  const recorderDir = mkdtempSync(path.join(tmpdir(), "pyrus-flight-recorder-"));
  process.env["PYRUS_FLIGHT_RECORDER_DIR"] = recorderDir;
  __resetPostgresPoolDiagnosticRateLimitForTests();

  try {
    __appendPostgresPoolDiagnosticEventForTests({
      type: "query",
      source: "pool",
      durationMs: 2500,
      sql: "x".repeat(500),
      queryName: "trunc-test",
      error: null,
      pool: {
        max: 12,
        total: 12,
        idle: 0,
        active: 12,
        waiting: 4,
        rawPoolWaiting: 4,
        admissionWaiting: 0,
        totalWaiting: 4,
      },
      stack: ["frame-a", "frame-b"],
      context: null,
    });
    flushRuntimeFlightRecorderBuffersSync();

    const event = readDayEvents(recorderDir).find(
      (item) => item["queryName"] === "trunc-test",
    );
    assert.ok(event, "the truncated slow-query event should be recorded");
    assert.equal((event["sql"] as string).length, 300);
    assert.equal("stack" in event, false);
  } finally {
    __resetPostgresPoolDiagnosticRateLimitForTests();
    if (previousRecorderDir === undefined) {
      delete process.env["PYRUS_FLIGHT_RECORDER_DIR"];
    } else {
      process.env["PYRUS_FLIGHT_RECORDER_DIR"] = previousRecorderDir;
    }
    rmSync(recorderDir, { recursive: true, force: true });
  }
});

test("slow-query recorder rate-limits per family and carries a suppressedCount", () => {
  const previousRecorderDir = process.env["PYRUS_FLIGHT_RECORDER_DIR"];
  const recorderDir = mkdtempSync(path.join(tmpdir(), "pyrus-flight-recorder-"));
  process.env["PYRUS_FLIGHT_RECORDER_DIR"] = recorderDir;
  __resetPostgresPoolDiagnosticRateLimitForTests();

  const event = (extra: Record<string, unknown> = {}) => ({
    type: "query" as const,
    source: "pool" as const,
    durationMs: 2500,
    sql: "select 1",
    queryName: "rate-test",
    error: null,
    pool: {
      max: 12,
      total: 12,
      idle: 0,
      active: 12,
      waiting: 4,
      rawPoolWaiting: 4,
      admissionWaiting: 0,
      totalWaiting: 4,
    },
    stack: [],
    context: null,
    ...extra,
  });

  try {
    const t0 = 10_000_000;
    // 5-burst + first over-burst emit via the 10s throttle gate (lastThrottled=0),
    // then 4 suppressed within the same instant.
    for (let i = 0; i < 10; i += 1) {
      __appendPostgresPoolDiagnosticEventForTests(event(), t0);
    }
    // One more after the throttle window flushes the 4 suppressed on its emit.
    __appendPostgresPoolDiagnosticEventForTests(event(), t0 + 11_000);
    flushRuntimeFlightRecorderBuffersSync();

    const slow = readDayEvents(recorderDir).filter(
      (item) => item["queryName"] === "rate-test",
    );
    // 5 burst + 1 throttled-at-t0 + 1 throttled-at-t0+11s = 7 recorded of 11.
    assert.equal(slow.length, 7);
    assert.equal(slow[slow.length - 1]?.["suppressedCount"], 4);
    // Burst lines carry no suppressedCount noise.
    assert.equal("suppressedCount" in (slow[0] as object), false);
  } finally {
    __resetPostgresPoolDiagnosticRateLimitForTests();
    if (previousRecorderDir === undefined) {
      delete process.env["PYRUS_FLIGHT_RECORDER_DIR"];
    } else {
      process.env["PYRUS_FLIGHT_RECORDER_DIR"] = previousRecorderDir;
    }
    rmSync(recorderDir, { recursive: true, force: true });
  }
});

test("slow-query recorder stops appending after the intra-day byte cap and flags it once", () => {
  const previousRecorderDir = process.env["PYRUS_FLIGHT_RECORDER_DIR"];
  const recorderDir = mkdtempSync(path.join(tmpdir(), "pyrus-flight-recorder-"));
  process.env["PYRUS_FLIGHT_RECORDER_DIR"] = recorderDir;
  // Tiny cap so a few events exhaust the day's slow-event budget.
  __resetPostgresPoolDiagnosticRateLimitForTests({ byteCap: 200 });

  try {
    for (let i = 0; i < 8; i += 1) {
      __appendPostgresPoolDiagnosticEventForTests({
        type: "query",
        source: "pool",
        durationMs: 2500,
        sql: "select 1",
        // Distinct family per event so the rate-limiter never suppresses — the
        // byte cap is the only gate under test.
        queryName: `cap-test-${i}`,
        error: null,
        pool: {
          max: 12,
          total: 12,
          idle: 0,
          active: 12,
          waiting: 4,
          rawPoolWaiting: 4,
          admissionWaiting: 0,
          totalWaiting: 4,
        },
        stack: [],
        context: null,
      });
    }
    flushRuntimeFlightRecorderBuffersSync();

    const events = readDayEvents(recorderDir);
    const slow = events.filter(
      (item) =>
        typeof item["queryName"] === "string" &&
        (item["queryName"] as string).startsWith("cap-test-"),
    );
    const capNotices = events.filter(
      (item) => item["event"] === "api-db-slow-recording-capped",
    );

    // At least one slow event recorded before the cap, but not all 8.
    assert.ok(slow.length >= 1 && slow.length < 8, `capped count: ${slow.length}`);
    // The cap is flagged exactly once (other event kinds keep flowing).
    assert.equal(capNotices.length, 1);
    assert.equal(capNotices[0]?.["capBytes"], 200);
  } finally {
    __resetPostgresPoolDiagnosticRateLimitForTests();
    if (previousRecorderDir === undefined) {
      delete process.env["PYRUS_FLIGHT_RECORDER_DIR"];
    } else {
      process.env["PYRUS_FLIGHT_RECORDER_DIR"] = previousRecorderDir;
    }
    rmSync(recorderDir, { recursive: true, force: true });
  }
});

test("work-governor timings are slow-only, rate-bounded, and sanitized", () => {
  const previousRecorderDir = process.env["PYRUS_FLIGHT_RECORDER_DIR"];
  const recorderDir = mkdtempSync(
    path.join(tmpdir(), "pyrus-work-governor-recorder-"),
  );
  process.env["PYRUS_FLIGHT_RECORDER_DIR"] = recorderDir;
  __resetWorkGovernorTimingRateLimitForTests();

  try {
    __appendWorkGovernorTimingForTests(
      {
        category: "account",
        operation: "positions",
        outcome: "success",
        queued: false,
        queueWaitMs: 0,
        executionDurationMs: 249,
        totalDurationMs: 249,
      },
      1_000,
    );
    __appendWorkGovernorTimingForTests(
      {
        category: "account",
        operation: "positions",
        outcome: "success",
        queued: true,
        queueWaitMs: 100,
        executionDurationMs: 200,
        totalDurationMs: 300,
      },
      2_000,
    );
    __appendWorkGovernorTimingForTests(
      {
        category: "account",
        operation: "positions",
        outcome: "success",
        queued: true,
        queueWaitMs: 120,
        executionDurationMs: 181,
        totalDurationMs: 301,
      },
      3_000,
    );
    __appendWorkGovernorTimingForTests(
      {
        category: "account",
        operation: "positions",
        outcome: "success",
        queued: false,
        queueWaitMs: 0,
        executionDurationMs: 302,
        totalDurationMs: 302,
      },
      12_001,
    );
    flushRuntimeFlightRecorderBuffersSync();

    const events = readDayEvents(recorderDir).filter(
      (event) => event["event"] === "api-work-governor-timing",
    );
    assert.equal(events.length, 2);
    assert.deepEqual(
      events.map((event) => ({
        category: event["category"],
        operation: event["operation"],
        outcome: event["outcome"],
        queued: event["queued"],
        queueWaitMs: event["queueWaitMs"],
        executionDurationMs: event["executionDurationMs"],
        totalDurationMs: event["totalDurationMs"],
        suppressedCount: event["suppressedCount"] ?? 0,
      })),
      [
        {
          category: "account",
          operation: "positions",
          outcome: "success",
          queued: true,
          queueWaitMs: 100,
          executionDurationMs: 200,
          totalDurationMs: 300,
          suppressedCount: 0,
        },
        {
          category: "account",
          operation: "positions",
          outcome: "success",
          queued: false,
          queueWaitMs: 0,
          executionDurationMs: 302,
          totalDurationMs: 302,
          suppressedCount: 1,
        },
      ],
    );
    assert.equal(JSON.stringify(events).includes("accountId"), false);
    assert.equal(JSON.stringify(events).includes("symbol"), false);
  } finally {
    __resetWorkGovernorTimingRateLimitForTests();
    if (previousRecorderDir === undefined) {
      delete process.env["PYRUS_FLIGHT_RECORDER_DIR"];
    } else {
      process.env["PYRUS_FLIGHT_RECORDER_DIR"] = previousRecorderDir;
    }
    rmSync(recorderDir, { recursive: true, force: true });
  }
});

test("runtime heartbeat exposes work-governor occupancy", () => {
  const previousRecorderDir = process.env["PYRUS_FLIGHT_RECORDER_DIR"];
  const recorderDir = mkdtempSync(
    path.join(tmpdir(), "pyrus-work-governor-heartbeat-"),
  );
  process.env["PYRUS_FLIGHT_RECORDER_DIR"] = recorderDir;

  try {
    const heartbeat = writeRuntimeFlightRecorderHeartbeat();
    assert.ok(heartbeat);
    const workGovernor = heartbeat["workGovernor"] as
      | Record<string, Record<string, unknown>>
      | undefined;
    assert.equal(workGovernor?.["account"]?.["active"], 0);
    assert.equal(workGovernor?.["account"]?.["queued"], 0);
    assert.equal(workGovernor?.["orders"]?.["active"], 0);
    assert.equal(workGovernor?.["orders"]?.["queued"], 0);
  } finally {
    flushRuntimeFlightRecorderBuffersSync();
    if (previousRecorderDir === undefined) {
      delete process.env["PYRUS_FLIGHT_RECORDER_DIR"];
    } else {
      process.env["PYRUS_FLIGHT_RECORDER_DIR"] = previousRecorderDir;
    }
    rmSync(recorderDir, { recursive: true, force: true });
  }
});

test("account-position timings are slow-only, rate-bounded, and sanitized", () => {
  const previousRecorderDir = process.env["PYRUS_FLIGHT_RECORDER_DIR"];
  const recorderDir = mkdtempSync(
    path.join(tmpdir(), "pyrus-account-position-recorder-"),
  );
  process.env["PYRUS_FLIGHT_RECORDER_DIR"] = recorderDir;
  __resetAccountPositionsTimingRateLimitForTests();
  const timing = {
    detail: "full" as const,
    liveQuotes: false,
    outcome: "success" as const,
    universeCache: "miss" as const,
    positionsCache: "miss" as const,
    positionCount: 4,
    rowCount: 4,
    stagesMs: {
      universe: 50,
      positions_upstream: 200,
      positions_ibkr: 180,
      positions_provider_fanout: 181,
    },
  };

  try {
    __appendAccountPositionsTimingForTests(
      { ...timing, totalDurationMs: 249 },
      1_000,
    );
    __appendAccountPositionsTimingForTests(
      { ...timing, totalDurationMs: 300 },
      2_000,
    );
    __appendAccountPositionsTimingForTests(
      { ...timing, totalDurationMs: 301 },
      3_000,
    );
    __appendAccountPositionsTimingForTests(
      { ...timing, totalDurationMs: 302 },
      12_001,
    );
    flushRuntimeFlightRecorderBuffersSync();

    const events = readDayEvents(recorderDir).filter(
      (event) => event["event"] === "api-account-positions-timing",
    );
    assert.equal(events.length, 2);
    assert.equal(events[0]?.["totalDurationMs"], 300);
    assert.equal(events[0]?.["positionsCache"], "miss");
    assert.equal(events[1]?.["totalDurationMs"], 302);
    assert.equal(events[1]?.["suppressedCount"], 1);
    assert.deepEqual(events[0]?.["stagesMs"], timing.stagesMs);
    assert.equal(JSON.stringify(events).includes("accountId"), false);
    assert.equal(JSON.stringify(events).includes("symbol"), false);
  } finally {
    __resetAccountPositionsTimingRateLimitForTests();
    if (previousRecorderDir === undefined) {
      delete process.env["PYRUS_FLIGHT_RECORDER_DIR"];
    } else {
      process.env["PYRUS_FLIGHT_RECORDER_DIR"] = previousRecorderDir;
    }
    rmSync(recorderDir, { recursive: true, force: true });
  }
});
