import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
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
  __getPostgresPoolDiagnosticRateLimitFamilyCountForTests,
  __recordMemorySampleForTests,
  __resetApiHeartbeatPublicationStateForTests,
  __resetPostgresPoolDiagnosticRateLimitForTests,
  __resetAccountPositionsTimingRateLimitForTests,
  __resetWorkGovernorTimingRateLimitForTests,
  appendFlightRecorderJsonLine,
  flushRuntimeFlightRecorderBuffersSync,
  importRuntimeFlightRecorderIncidents,
  completeApiHeartbeatPublicationState,
  eventLoopStallObservation,
  getRuntimeFlightRecorderDiagnostics,
  nextApiHeartbeatPublicationState,
  readFlightRecorderJsonlReverse,
  readRuntimeIncidentTailForTests,
  resetRuntimeIncidentTailCacheForTests,
  rssPressureThresholdBytes,
  sanitizeRuntimeDiagnosticRecordForTests,
  setRuntimeFlightRecorderMemoryCensusProvider,
  writeRuntimeFlightRecorderHeartbeat,
} from "./runtime-flight-recorder";
import { resolveApiRssPressureThresholds } from "./resource-pressure";

test("flight recorder reads complete JSONL records backward across chunks", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pyrus-flight-recorder-tail-"));
  const file = path.join(dir, "events.jsonl");

  try {
    writeFileSync(
      file,
      [
        JSON.stringify({ event: "outside-tail", value: "x".repeat(200) }),
        JSON.stringify({ event: "first-complete" }),
        JSON.stringify({ event: "latest" }),
        '{"event":"partial"',
      ].join("\n"),
    );

    assert.deepEqual(
      [...readFlightRecorderJsonlReverse(file, 16)],
      [
        { event: "latest" },
        { event: "first-complete" },
        { event: "outside-tail", value: "x".repeat(200) },
      ],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reverse JSONL reads enforce explicit byte and record ceilings", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pyrus-flight-recorder-bounds-"));
  const file = path.join(dir, "incidents.jsonl");

  try {
    writeFileSync(
      file,
      [
        JSON.stringify({ incidentId: "oldest", value: "x".repeat(200) }),
        JSON.stringify({ incidentId: "middle" }),
        JSON.stringify({ incidentId: "latest" }),
      ].join("\n") + "\n",
    );

    assert.deepEqual(
      [...readFlightRecorderJsonlReverse(file, 16, 1_024, 2)],
      [{ incidentId: "latest" }, { incidentId: "middle" }],
    );
    assert.deepEqual(
      [...readFlightRecorderJsonlReverse(file, 16, 48, 10)],
      [{ incidentId: "latest" }],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("hot incident diagnostics reuse a bounded tail cache until file identity changes", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pyrus-flight-recorder-cache-"));
  const file = path.join(dir, "incidents.jsonl");
  resetRuntimeIncidentTailCacheForTests();

  try {
    writeFileSync(
      file,
      [
        JSON.stringify({ incidentId: "one" }),
        JSON.stringify({ incidentId: "two" }),
        JSON.stringify({ incidentId: "three" }),
      ].join("\n") + "\n",
    );
    const first = readRuntimeIncidentTailForTests(file, {
      maxBytes: 1_024,
      maxRecords: 2,
    });
    const cached = readRuntimeIncidentTailForTests(file, {
      maxBytes: 1_024,
      maxRecords: 2,
    });
    assert.strictEqual(cached, first);
    assert.equal(first.records.length, 2);
    assert.equal(first.records[0]?.incidentId, "three");
    assert.equal(first.truncated, true);

    writeFileSync(
      file,
      [
        JSON.stringify({ incidentId: "one" }),
        JSON.stringify({ incidentId: "two" }),
        JSON.stringify({ incidentId: "three" }),
        JSON.stringify({ incidentId: "four" }),
      ].join("\n") + "\n",
    );
    const refreshed = readRuntimeIncidentTailForTests(file, {
      maxBytes: 1_024,
      maxRecords: 2,
    });
    assert.notStrictEqual(refreshed, first);
    assert.equal(refreshed.records[0]?.incidentId, "four");
  } finally {
    resetRuntimeIncidentTailCacheForTests();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("incident tail cache invalidates for a same-size replacement with preserved mtime", () => {
  const dir = mkdtempSync(
    path.join(tmpdir(), "pyrus-flight-recorder-identity-"),
  );
  const file = path.join(dir, "incidents.jsonl");
  const replacement = path.join(dir, "replacement.jsonl");
  resetRuntimeIncidentTailCacheForTests();

  try {
    writeFileSync(file, `${JSON.stringify({ incidentId: "one" })}\n`);
    const originalStats = statSync(file);
    const first = readRuntimeIncidentTailForTests(file);

    writeFileSync(replacement, `${JSON.stringify({ incidentId: "two" })}\n`);
    utimesSync(replacement, originalStats.atime, originalStats.mtime);
    renameSync(replacement, file);
    const refreshed = readRuntimeIncidentTailForTests(file);

    assert.notStrictEqual(refreshed, first);
    assert.equal(refreshed.records[0]?.incidentId, "two");
  } finally {
    resetRuntimeIncidentTailCacheForTests();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runtime diagnostics recursively remove credential-bearing errors", () => {
  const secret = "flight-recorder-runtime-secret";
  const sanitized = sanitizeRuntimeDiagnosticRecordForTests({
    message: `failed at postgres://worker:${secret}@db.internal/pyrus`,
    stack: `Error: token=${secret}`,
    nested: { apiKey: `sk-${"c".repeat(48)}`, safe: "kept" },
  });
  const serialized = JSON.stringify(sanitized);

  assert.doesNotMatch(serialized, new RegExp(secret, "u"));
  assert.doesNotMatch(serialized, /sk-|postgres:\/\//u);
  assert.match(serialized, /kept/u);
});

test("runtime diagnostics ignore an advisory pointer from another guest", () => {
  const previousRecorderDir = process.env["PYRUS_FLIGHT_RECORDER_DIR"];
  const recorderDir = mkdtempSync(
    path.join(tmpdir(), "pyrus-flight-supervisor-marker-"),
  );
  const btime = Number(
    readFileSync("/proc/stat", "utf8").match(/^btime\s+(\d+)$/mu)?.[1],
  );

  mkdirSync(path.join(recorderDir, "boot-markers"), { recursive: true });
  writeFileSync(
    path.join(recorderDir, "current.json"),
    JSON.stringify({
      boot: { bootId: "btime:1" },
      updatedAt: "2026-01-01T00:00:00.000Z",
    }),
  );
  writeFileSync(
    path.join(recorderDir, "boot-markers", `btime-${btime}.json`),
    JSON.stringify({
      boot: { bootId: `btime:${btime}` },
      updatedAt: "2026-01-02T00:00:00.000Z",
    }),
  );
  process.env["PYRUS_FLIGHT_RECORDER_DIR"] = recorderDir;

  try {
    const diagnostics = getRuntimeFlightRecorderDiagnostics();
    assert.equal(
      (diagnostics.raw["supervisorCurrent"] as Record<string, unknown>)?.[
        "updatedAt"
      ],
      "2026-01-02T00:00:00.000Z",
    );
    assert.equal(
      diagnostics.metrics["supervisorUpdatedAt"],
      "2026-01-02T00:00:00.000Z",
    );
  } finally {
    if (previousRecorderDir === undefined) {
      delete process.env["PYRUS_FLIGHT_RECORDER_DIR"];
    } else {
      process.env["PYRUS_FLIGHT_RECORDER_DIR"] = previousRecorderDir;
    }
    rmSync(recorderDir, { recursive: true, force: true });
  }
});

test("runtime process diagnostics redact credential-bearing commands and working directories", () => {
  const previousProcRoot = process.env["PYRUS_RUNTIME_PROCESS_SCAN_DIR"];
  const previousRecorderDir = process.env["PYRUS_FLIGHT_RECORDER_DIR"];
  const previousRepoRoot = process.env["PYRUS_REPO_ROOT"];
  const previousScanEnabled = process.env["PYRUS_RUNTIME_TEST_PROCESS_SCAN"];
  const root = mkdtempSync(
    path.join(tmpdir(), "pyrus-flight-process-redaction-"),
  );
  const procRoot = path.join(root, "proc");
  const recorderDir = path.join(root, "recorder");
  const repoRoot = path.join(root, "repo");
  const secret = "flight-recorder-test-secret";
  const pidDir = path.join(procRoot, "424242");
  const cwd = path.join(repoRoot, `token=${secret}`);

  mkdirSync(pidDir, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  symlinkSync(cwd, path.join(pidDir, "cwd"));
  writeFileSync(
    path.join(pidDir, "cmdline"),
    `node\0--test\0${path.join(repoRoot, "secret.test.ts")}\0--token=${secret}\0`,
  );
  process.env["PYRUS_RUNTIME_PROCESS_SCAN_DIR"] = procRoot;
  process.env["PYRUS_FLIGHT_RECORDER_DIR"] = recorderDir;
  process.env["PYRUS_REPO_ROOT"] = repoRoot;
  process.env["PYRUS_RUNTIME_TEST_PROCESS_SCAN"] = "1";

  try {
    const diagnostics = getRuntimeFlightRecorderDiagnostics();
    const processes = diagnostics.raw["workspaceTestProcesses"] as Array<
      Record<string, unknown>
    >;

    assert.equal(processes.length, 1);
    assert.equal(processes[0]?.["cwd"], null);
    assert.equal(processes[0]?.["command"], null);
    assert.doesNotMatch(JSON.stringify(diagnostics), new RegExp(secret, "u"));
  } finally {
    if (previousProcRoot === undefined) {
      delete process.env["PYRUS_RUNTIME_PROCESS_SCAN_DIR"];
    } else {
      process.env["PYRUS_RUNTIME_PROCESS_SCAN_DIR"] = previousProcRoot;
    }
    if (previousRecorderDir === undefined) {
      delete process.env["PYRUS_FLIGHT_RECORDER_DIR"];
    } else {
      process.env["PYRUS_FLIGHT_RECORDER_DIR"] = previousRecorderDir;
    }
    if (previousRepoRoot === undefined) {
      delete process.env["PYRUS_REPO_ROOT"];
    } else {
      process.env["PYRUS_REPO_ROOT"] = previousRepoRoot;
    }
    if (previousScanEnabled === undefined) {
      delete process.env["PYRUS_RUNTIME_TEST_PROCESS_SCAN"];
    } else {
      process.env["PYRUS_RUNTIME_TEST_PROCESS_SCAN"] = previousScanEnabled;
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test("runtime incident import rejects an oversized imported-ID sidecar", async () => {
  const previousRecorderDir = process.env["PYRUS_FLIGHT_RECORDER_DIR"];
  const recorderDir = mkdtempSync(
    path.join(tmpdir(), "pyrus-flight-import-sidecar-"),
  );
  process.env["PYRUS_FLIGHT_RECORDER_DIR"] = recorderDir;
  resetRuntimeIncidentTailCacheForTests();

  try {
    const writerMaxBytes = 3 + 500 * (256 * 6 + 6);
    writeFileSync(
      path.join(recorderDir, "incidents.jsonl"),
      `${JSON.stringify({ incidentId: "incident-1", classification: "test" })}\n`,
    );
    writeFileSync(
      path.join(recorderDir, "diagnostics-imported.json"),
      JSON.stringify(["incident-1", "x".repeat(writerMaxBytes)]),
    );
    const recorded: unknown[] = [];
    const result = await importRuntimeFlightRecorderIncidents(async (input) => {
      recorded.push(input);
      return {} as never;
    });

    assert.deepEqual(result, { imported: 1, skipped: 0 });
    assert.equal(recorded.length, 1);
  } finally {
    resetRuntimeIncidentTailCacheForTests();
    if (previousRecorderDir === undefined) {
      delete process.env["PYRUS_FLIGHT_RECORDER_DIR"];
    } else {
      process.env["PYRUS_FLIGHT_RECORDER_DIR"] = previousRecorderDir;
    }
    rmSync(recorderDir, { recursive: true, force: true });
  }
});

test("runtime incident import reuses a maximum-size writer sidecar", async () => {
  const previousRecorderDir = process.env["PYRUS_FLIGHT_RECORDER_DIR"];
  const recorderDir = mkdtempSync(
    path.join(tmpdir(), "pyrus-flight-import-writer-limit-"),
  );
  process.env["PYRUS_FLIGHT_RECORDER_DIR"] = recorderDir;
  resetRuntimeIncidentTailCacheForTests();

  try {
    const incidents = Array.from({ length: 500 }, (_, index) => {
      return {
        incidentId: `${String.fromCharCode(0xd800 + index)}${"\ud800".repeat(255)}`,
        classification: "test",
      };
    });
    writeFileSync(
      path.join(recorderDir, "incidents.jsonl"),
      `${incidents.map((incident) => JSON.stringify(incident)).join("\n")}\n`,
    );
    let recorded = 0;
    const record = async () => {
      recorded += 1;
      return {} as never;
    };

    assert.deepEqual(await importRuntimeFlightRecorderIncidents(record), {
      imported: 500,
      skipped: 0,
    });
    assert.equal(
      statSync(path.join(recorderDir, "diagnostics-imported.json")).size,
      3 + 500 * (256 * 6 + 6),
    );
    assert.deepEqual(await importRuntimeFlightRecorderIncidents(record), {
      imported: 0,
      skipped: 500,
    });
    assert.equal(recorded, 500);
  } finally {
    resetRuntimeIncidentTailCacheForTests();
    if (previousRecorderDir === undefined) {
      delete process.env["PYRUS_FLIGHT_RECORDER_DIR"];
    } else {
      process.env["PYRUS_FLIGHT_RECORDER_DIR"] = previousRecorderDir;
    }
    rmSync(recorderDir, { recursive: true, force: true });
  }
});

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
  const recorderDir = mkdtempSync(
    path.join(tmpdir(), "pyrus-flight-recorder-"),
  );
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
    assert.equal(typeof current.memoryMb.arrayBuffers, "number");
    assert.equal(current.flightRecorder.droppedJsonLineCount, 0);
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

test("heartbeat publication cadence uses monotonic successful-attempt state", () => {
  const initial = {
    successfulPublicationSequence: 0,
    lastSuccessfulAttemptStartMonoMs: null,
    cadenceViolationCount: 0,
    lastSuccessfulAttemptGapMs: null,
    maxSuccessfulAttemptGapMs: 0,
    lastSuccessfulCompletionMonoMs: null,
    completionCadenceViolationCount: 0,
    lastSuccessfulCompletionGapMs: null,
    maxSuccessfulCompletionGapMs: 0,
  };
  const first = nextApiHeartbeatPublicationState(initial, 1_000, 5_000);
  assert.deepEqual(first, {
    successfulPublicationSequence: 1,
    lastSuccessfulAttemptStartMonoMs: 1_000,
    cadenceViolationCount: 0,
    lastSuccessfulAttemptGapMs: null,
    maxSuccessfulAttemptGapMs: 0,
    lastSuccessfulCompletionMonoMs: null,
    completionCadenceViolationCount: 0,
    lastSuccessfulCompletionGapMs: null,
    maxSuccessfulCompletionGapMs: 0,
  });
  const atLimit = nextApiHeartbeatPublicationState(first, 8_500, 5_000);
  assert.equal(atLimit.successfulPublicationSequence, 2);
  assert.equal(atLimit.lastSuccessfulAttemptGapMs, 7_500);
  assert.equal(atLimit.cadenceViolationCount, 0);
  const overLimit = nextApiHeartbeatPublicationState(atLimit, 16_001, 5_000);
  assert.equal(overLimit.successfulPublicationSequence, 3);
  assert.equal(overLimit.lastSuccessfulAttemptGapMs, 7_501);
  assert.equal(overLimit.maxSuccessfulAttemptGapMs, 7_501);
  assert.equal(overLimit.cadenceViolationCount, 1);
  assert.throws(
    () => nextApiHeartbeatPublicationState(overLimit, 16_000, 5_000),
    /moved backward/iu,
  );
});

test("heartbeat completion cadence catches an on-time attempt that becomes visible late", () => {
  const initial = {
    successfulPublicationSequence: 0,
    lastSuccessfulAttemptStartMonoMs: null,
    cadenceViolationCount: 0,
    lastSuccessfulAttemptGapMs: null,
    maxSuccessfulAttemptGapMs: 0,
    lastSuccessfulCompletionMonoMs: null,
    completionCadenceViolationCount: 0,
    lastSuccessfulCompletionGapMs: null,
    maxSuccessfulCompletionGapMs: 0,
  };
  const firstAttempt = nextApiHeartbeatPublicationState(initial, 1_000, 5_000);
  const firstComplete = completeApiHeartbeatPublicationState(
    firstAttempt,
    1_100,
    5_000,
  );
  const secondAttempt = nextApiHeartbeatPublicationState(
    firstComplete,
    6_000,
    5_000,
  );
  assert.equal(secondAttempt.lastSuccessfulAttemptGapMs, 5_000);
  assert.equal(secondAttempt.cadenceViolationCount, 0);

  const secondComplete = completeApiHeartbeatPublicationState(
    secondAttempt,
    8_601,
    5_000,
  );
  assert.equal(secondComplete.lastSuccessfulCompletionGapMs, 7_501);
  assert.equal(secondComplete.maxSuccessfulCompletionGapMs, 7_501);
  assert.equal(secondComplete.completionCadenceViolationCount, 1);
  assert.throws(
    () => completeApiHeartbeatPublicationState(secondComplete, 8_600, 5_000),
    /moved backward/iu,
  );
});

test("event-loop stall threshold uses a monotonic total tick interval", () => {
  assert.equal(eventLoopStallObservation(1_000, 5_999, 1_000, 5_000), null);
  assert.deepEqual(eventLoopStallObservation(1_000, 6_000, 1_000, 5_000), {
    stallMs: 4_000,
    tickIntervalMs: 5_000,
    lateByMs: 4_000,
    expectedTickIntervalMs: 1_000,
    thresholdMs: 5_000,
    thresholdBasis: "tick-interval",
  });
  assert.throws(
    () => eventLoopStallObservation(2_000, 1_999, 1_000, 5_000),
    /moved backward/iu,
  );
});

test("failed heartbeat publication is counted but does not commit its sequence", () => {
  const previousRecorderDir = process.env["PYRUS_FLIGHT_RECORDER_DIR"];
  const root = mkdtempSync(path.join(tmpdir(), "pyrus-heartbeat-publication-"));
  const blockedDir = path.join(root, "blocked");
  const workingDir = path.join(root, "working");
  writeFileSync(blockedDir, "not a directory");
  __resetApiHeartbeatPublicationStateForTests();

  try {
    process.env["PYRUS_FLIGHT_RECORDER_DIR"] = blockedDir;
    assert.equal(writeRuntimeFlightRecorderHeartbeat(), null);

    process.env["PYRUS_FLIGHT_RECORDER_DIR"] = workingDir;
    const first = writeRuntimeFlightRecorderHeartbeat();
    const firstPublication = (
      first?.["flightRecorder"] as Record<string, unknown> | undefined
    )?.["heartbeatPublication"] as Record<string, unknown>;
    assert.equal(firstPublication["successfulPublicationSequence"], 1);
    assert.equal(firstPublication["writeFailureCount"], 1);

    const second = writeRuntimeFlightRecorderHeartbeat();
    const secondPublication = (
      second?.["flightRecorder"] as Record<string, unknown> | undefined
    )?.["heartbeatPublication"] as Record<string, unknown>;
    assert.equal(secondPublication["successfulPublicationSequence"], 2);
    assert.equal(secondPublication["writeFailureCount"], 1);
  } finally {
    __resetApiHeartbeatPublicationStateForTests();
    if (previousRecorderDir === undefined) {
      delete process.env["PYRUS_FLIGHT_RECORDER_DIR"];
    } else {
      process.env["PYRUS_FLIGHT_RECORDER_DIR"] = previousRecorderDir;
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test("flight recorder recent failures include lower 4xx errors", () => {
  const previousRecorderDir = process.env["PYRUS_FLIGHT_RECORDER_DIR"];
  const recorderDir = mkdtempSync(
    path.join(tmpdir(), "pyrus-flight-recorder-"),
  );
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
  const recorderDir = mkdtempSync(
    path.join(tmpdir(), "pyrus-flight-recorder-"),
  );
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
  const recorderDir = mkdtempSync(
    path.join(tmpdir(), "pyrus-flight-recorder-"),
  );
  process.env["PYRUS_FLIGHT_RECORDER_DIR"] = recorderDir;

  try {
    setRuntimeFlightRecorderMemoryCensusProvider(() => ({
      residentBars: {
        backfilledBase: { cells: 12_000, bars: 2_880_000 },
        mainThreadSignalWork: {
          phases: {
            canonicalFullSeries: { count: 3, totalDurationMs: 12.5 },
          },
          callerLanes: {
            "matrix-stream": { phaseCount: 3, totalDurationMs: 12.5 },
          },
        },
      },
      storedBarsCache: {
        cellCount: 24_000,
        barCount: 5_760_000,
        compactBytes: 276_480_000,
      },
      optionExpirations: {
        entries: 820,
        maxEntries: 1_128,
        capacityEvictions: 0,
        staleTtlEvictions: 3,
      },
    }));
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
    assert.deepEqual(event.retainedBars, {
      residentBars: {
        backfilledBase: { cells: 12_000, bars: 2_880_000 },
        mainThreadSignalWork: {
          phases: {
            canonicalFullSeries: { count: 3, totalDurationMs: 12.5 },
          },
          callerLanes: {
            "matrix-stream": { phaseCount: 3, totalDurationMs: 12.5 },
          },
        },
      },
      storedBarsCache: {
        cellCount: 24_000,
        barCount: 5_760_000,
        compactBytes: 276_480_000,
      },
      optionExpirations: {
        entries: 820,
        maxEntries: 1_128,
        capacityEvictions: 0,
        staleTtlEvictions: 3,
      },
    });
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
    setRuntimeFlightRecorderMemoryCensusProvider(null);
    if (previousRecorderDir === undefined) {
      delete process.env["PYRUS_FLIGHT_RECORDER_DIR"];
    } else {
      process.env["PYRUS_FLIGHT_RECORDER_DIR"] = previousRecorderDir;
    }
    rmSync(recorderDir, { recursive: true, force: true });
  }
});

test("API startup wires option-expiration diagnostics into the memory census", () => {
  const indexSource = readFileSync(
    new URL("../index.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    indexSource,
    /optionExpirations:\s*getOptionExpirationCacheDiagnostics\(\)/,
  );
});

test("DB diagnostic flight-recorder events include request workload context", () => {
  const previousRecorderDir = process.env["PYRUS_FLIGHT_RECORDER_DIR"];
  const recorderDir = mkdtempSync(
    path.join(tmpdir(), "pyrus-flight-recorder-"),
  );
  process.env["PYRUS_FLIGHT_RECORDER_DIR"] = recorderDir;

  try {
    __appendPostgresPoolDiagnosticEventForTests({
      type: "query",
      source: "pool",
      lane: "background",
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
    assert.equal(event.lane, "background");
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
  const recorderDir = mkdtempSync(
    path.join(tmpdir(), "pyrus-flight-recorder-"),
  );
  process.env["PYRUS_FLIGHT_RECORDER_DIR"] = recorderDir;
  __resetPostgresPoolDiagnosticRateLimitForTests();

  try {
    __appendPostgresPoolDiagnosticEventForTests({
      type: "query",
      source: "pool",
      lane: "interactive",
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
  const recorderDir = mkdtempSync(
    path.join(tmpdir(), "pyrus-flight-recorder-"),
  );
  process.env["PYRUS_FLIGHT_RECORDER_DIR"] = recorderDir;
  __resetPostgresPoolDiagnosticRateLimitForTests();

  const event = (extra: Record<string, unknown> = {}) => ({
    type: "query" as const,
    source: "pool" as const,
    lane: "interactive" as const,
    durationMs: 2500,
    sql: null,
    queryName: null,
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
    context: { workloadFamily: "rate-test-a" },
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
    // A distinct safe workload family gets its own burst budget. Unnamed,
    // redacted queries must not all collapse into one global "query:unknown".
    __appendPostgresPoolDiagnosticEventForTests(
      event({ context: { workloadFamily: "rate-test-b" } }),
      t0 + 11_000,
    );
    flushRuntimeFlightRecorderBuffersSync();

    const slow = readDayEvents(recorderDir).filter(
      (item) => item["event"] === "api-db-query-slow",
    );
    // Family A: 5 burst + 1 throttled-at-t0 + 1 throttled-at-t0+11s.
    // Family B: its independent first burst event.
    assert.equal(slow.length, 8);
    assert.equal(slow[slow.length - 2]?.["suppressedCount"], 4);
    assert.equal(
      (slow[slow.length - 1]?.["context"] as { workloadFamily?: string })
        ?.workloadFamily,
      "rate-test-b",
    );
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

test("slow-query family cardinality is bounded without bypassing overflow rate limits", () => {
  const previousRecorderDir = process.env["PYRUS_FLIGHT_RECORDER_DIR"];
  const recorderDir = mkdtempSync(
    path.join(tmpdir(), "pyrus-flight-recorder-"),
  );
  process.env["PYRUS_FLIGHT_RECORDER_DIR"] = recorderDir;
  __resetPostgresPoolDiagnosticRateLimitForTests();
  const maxFamilyStates = 256;

  try {
    const t0 = 20_000_000;
    for (let i = 0; i < maxFamilyStates + 100; i += 1) {
      __appendPostgresPoolDiagnosticEventForTests(
        {
          type: "query",
          source: "pool",
          lane: "interactive",
          durationMs: 2_500,
          sql: null,
          queryName: `unique-family-${i}`,
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
        },
        t0,
      );
    }
    flushRuntimeFlightRecorderBuffersSync();

    const slow = readDayEvents(recorderDir).filter(
      (event) => event["event"] === "api-db-query-slow",
    );
    assert.equal(
      __getPostgresPoolDiagnosticRateLimitFamilyCountForTests(),
      maxFamilyStates,
    );
    // 255 named buckets plus one overflow bucket: five burst events and the
    // first throttled overflow event are emitted; rotating names cannot bypass it.
    assert.equal(slow.length, maxFamilyStates + 5);
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
  const recorderDir = mkdtempSync(
    path.join(tmpdir(), "pyrus-flight-recorder-"),
  );
  process.env["PYRUS_FLIGHT_RECORDER_DIR"] = recorderDir;
  // Tiny cap so a few events exhaust the day's slow-event budget.
  __resetPostgresPoolDiagnosticRateLimitForTests({ byteCap: 200 });

  try {
    for (let i = 0; i < 8; i += 1) {
      __appendPostgresPoolDiagnosticEventForTests({
        type: "query",
        source: "pool",
        lane: "interactive",
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
    assert.ok(
      slow.length >= 1 && slow.length < 8,
      `capped count: ${slow.length}`,
    );
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
