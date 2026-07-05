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
  __appendPostgresPoolDiagnosticEventForTests,
  __recordMemorySampleForTests,
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
      dbPool: { max: 12, total: 12, idle: 0, active: 12, waiting: 3 },
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
    assert.deepEqual(event.dbPool, { active: 12, waiting: 3, max: 12 });
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
      sql: "select 1",
      queryName: "test-query",
      error: null,
      pool: { max: 12, total: 12, idle: 0, active: 12, waiting: 4 },
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
