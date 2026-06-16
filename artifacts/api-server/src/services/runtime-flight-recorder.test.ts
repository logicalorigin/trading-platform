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
