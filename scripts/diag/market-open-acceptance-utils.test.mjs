import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import {
  acceptanceFailedStepKeys,
  assertApiDescendsFromSupervisor,
  assertApiProcessRole,
  assertFreshApiHeartbeat,
  assertRuntimeSamplesComplete,
  assertSameProcessIdentity,
  assertStableApiPid,
  calculateCounterRate,
  classifyIncrementalAcceptanceCounters,
  cleanupHeapProfiler,
  createSingleFlightRunner,
  diffRuntimeCounters,
  isWithinAcceptanceWindow,
  isRunDevSupervisorProcess,
  parseProcCmdline,
  pickRuntimeAcceptanceSnapshot,
  psqlEnvironment,
  summarizeRuntimeSamples,
  terminateChildWithFallback,
  validateRuntimeAcceptanceSnapshot,
  withTimeout,
} from "./market-open-acceptance-utils.mjs";

function runtime(overrides = {}) {
  return {
    api: {
      memoryMb: { heapUsed: 500, rss: 900 },
      eventLoopDelayMs: { p95: 42 },
      eventLoopUtilization: 0.4,
      resourcePressure: {
        inputs: { dbPoolActive: 4, dbPoolWaiting: 2, dbPoolMax: 12 },
      },
    },
    dbPoolAdmission: {
      lanes: [
        { lane: "interactive", queued: 3, inFlight: 1, admitted: 10 },
        { lane: "background", queued: 1, inFlight: 2, admitted: 20 },
      ],
    },
    ibkr: {
      streams: {
        signalMonitorLocalBars: {
          storedBarsCache: {
            barCount: 100,
            compactBarCount: 100,
            objectBarCount: 0,
            hitCount: 7,
            deltaReadCount: 5,
          },
          storedBarsDelta: {
            deltaReads: 5,
            gapFallbacks: 1,
            shadowMismatches: 0,
          },
        },
        signalMonitorResidentBars: {
          completedBarsCache: { entries: 2, bars: 40 },
        },
        signalMonitorIncrementalEval: {
          seeds: 2,
          appends: 3,
          shadowMismatches: 0,
          matrixServeMismatchCount: 0,
        },
        massiveStockQuotes: { reconnectCount: 4 },
        stockAggregates: {
          massiveDelayedWebSocket: { reconnectCount: 2 },
        },
        signalMatrix: { eventCount: 9, activeScopeSymbols: 3 },
        marketDataAdmission: {
          optionsFlowScanner: {
            coverage: { selectedSymbols: 50, cycleScannedSymbols: 20 },
          },
          ownerClasses: { retiredOwnerCount: 0, unknownOwnerCount: 0 },
          lineOwnership: { lineCount: 8, scannerOverlapLineCount: 0 },
        },
      },
    },
    ...overrides,
  };
}

test("runtime acceptance snapshots include admission waiters and bounded diagnostics", () => {
  const snapshot = pickRuntimeAcceptanceSnapshot(runtime());

  assert.equal(snapshot.db.rawWaiting, 2);
  assert.equal(snapshot.db.admissionQueued, 4);
  assert.equal(snapshot.db.totalWaiting, 6);
  assert.equal(snapshot.counters.storedBarsHitCount, 7);
  assert.equal(snapshot.counters.matrixEventCount, 9);
  assert.equal(snapshot.diagnostics.storedBarsCache.barCount, 100);
  assert.equal(snapshot.diagnostics.scannerCoverage.selectedSymbols, 50);
  assert.equal(JSON.stringify(snapshot).includes("perSymbol"), false);
});

test("runtime counter deltas are scoped to the captured window", () => {
  const before = pickRuntimeAcceptanceSnapshot(runtime());
  const afterRuntime = runtime();
  afterRuntime.ibkr.streams.signalMonitorLocalBars.storedBarsCache.hitCount = 17;
  afterRuntime.ibkr.streams.signalMonitorIncrementalEval.appends = 8;
  const after = pickRuntimeAcceptanceSnapshot(afterRuntime);

  const delta = diffRuntimeCounters(before.counters, after.counters);
  assert.equal(delta.storedBarsHitCount, 10);
  assert.equal(delta.incrementalAppends, 5);
  assert.equal(
    diffRuntimeCounters({ missing: null }, { missing: null }).missing,
    null,
  );
});

test("incremental acceptance treats stored-state transitions as observational churn", () => {
  assert.deepEqual(
    classifyIncrementalAcceptanceCounters({
      incrementalShadowMismatches: 0,
      matrixServeMismatchCount: 12,
    }),
    { parityVerdict: "PASS", storedStateChurnVerdict: "OBSERVE" },
  );
  assert.equal(
    classifyIncrementalAcceptanceCounters({
      incrementalShadowMismatches: 1,
      matrixServeMismatchCount: 0,
    }).parityVerdict,
    "FAIL",
  );
});

test("runtime sample summaries preserve peaks and exact-window deltas", () => {
  const first = pickRuntimeAcceptanceSnapshot(runtime());
  const secondRuntime = runtime();
  secondRuntime.api.eventLoopUtilization = 0.8;
  secondRuntime.api.eventLoopDelayMs.p95 = 120;
  secondRuntime.api.memoryMb.heapUsed = 700;
  secondRuntime.api.resourcePressure.inputs.dbPoolWaiting = 5;
  secondRuntime.ibkr.streams.signalMonitorLocalBars.storedBarsCache.hitCount = 12;
  const second = pickRuntimeAcceptanceSnapshot(secondRuntime);

  const summary = summarizeRuntimeSamples([
    { at: "2026-07-13T13:30:00.000Z", fetchDurationMs: 10, snapshot: first },
    { at: "2026-07-13T13:30:05.000Z", fetchDurationMs: 25, snapshot: second },
  ]);
  assert.equal(summary.peakEventLoopUtilization, 0.8);
  assert.equal(summary.peakEventLoopDelayP95Ms, 120);
  assert.equal(summary.peakHeapUsedMb, 700);
  assert.equal(summary.peakDbTotalWaiting, 9);
  assert.equal(summary.peakRuntimeFetchMs, 25);
  assert.equal(summary.averageRuntimeFetchMs, 17.5);
  assert.equal(summary.counterDelta.storedBarsHitCount, 5);
});

test("acceptance fails closed on PID changes and required phase failures", () => {
  assert.doesNotThrow(() => assertStableApiPid(100, 100));
  assert.throws(() => assertStableApiPid(100, 101), /changed from 100 to 101/);
  for (const pid of [-1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => assertStableApiPid(pid, pid), /positive safe integer/);
  }
  assert.deepEqual(
    acceptanceFailedStepKeys(
      {
        identity: { ok: true },
        cpuProfile: { ok: false },
        counters: { ok: true },
      },
      ["identity", "cpuProfile", "counters", "allocationProfile"],
    ),
    ["cpuProfile", "allocationProfile"],
  );
});

test("acceptance log windows include only their exact inclusive bounds", () => {
  assert.equal(isWithinAcceptanceWindow(1_000, 1_000, 2_000), true);
  assert.equal(isWithinAcceptanceWindow(2_000, 1_000, 2_000), true);
  assert.equal(isWithinAcceptanceWindow(999, 1_000, 2_000), false);
  assert.equal(isWithinAcceptanceWindow(2_001, 1_000, 2_000), false);
  assert.equal(isWithinAcceptanceWindow(Number.NaN, 1_000, 2_000), false);
});

test("runtime sampling coalesces interval ticks while a fetch is pending", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const runner = createSingleFlightRunner(async () => {
    calls += 1;
    await gate;
  });

  const first = runner.run();
  assert.equal(runner.run(), first);
  await Promise.resolve();
  assert.equal(calls, 1);

  release();
  await runner.wait();
  await runner.run();
  assert.equal(calls, 2);
});

test("acceptance verifies API ancestry before signaling the recorded PID", () => {
  assert.doesNotThrow(() =>
    assertApiDescendsFromSupervisor([{ pid: 301 }, { pid: 200 }], 200),
  );
  assert.throws(
    () => assertApiDescendsFromSupervisor([{ pid: 301 }, { pid: 1 }], 200),
    /not descended from supervisor 200/,
  );
});

test("supervisor discovery requires the canonical Node script argument", () => {
  assert.equal(
    isRunDevSupervisorProcess(
      "node\0./scripts/runDevApp.mjs\0",
      "/workspace/artifacts/pyrus",
      "/workspace/artifacts/pyrus",
    ),
    true,
  );
  assert.equal(
    isRunDevSupervisorProcess(
      "node\0-e\0prompt mentions ./scripts/runDevApp.mjs\0",
      "/workspace/artifacts/pyrus",
      "/workspace/artifacts/pyrus",
    ),
    false,
  );
  assert.equal(
    isRunDevSupervisorProcess(
      "codex\0review runDevApp.mjs\0",
      "/workspace",
      "/workspace/artifacts/pyrus",
    ),
    false,
  );
  assert.equal(
    isRunDevSupervisorProcess(
      "node\0./scripts/runDevApp.mjs\0--extra\0",
      "/workspace/artifacts/pyrus",
      "/workspace/artifacts/pyrus",
    ),
    false,
  );
});

test("proc cmdline parsing removes one terminal NUL and rejects empty argv", () => {
  assert.deepEqual(parseProcCmdline("node\0script.mjs\0"), [
    "node",
    "script.mjs",
  ]);
  for (const raw of [
    "node\0script.mjs",
    "node\0\0script.mjs\0",
    "node\0script.mjs\0\0",
    "\0",
    "",
  ]) {
    assert.equal(parseProcCmdline(raw), null);
  }
});

test("psql receives its connection string outside the process arguments", () => {
  assert.deepEqual(
    psqlEnvironment(
      "postgresql://agent%40user:p%40ss%3Aword@db.internal:6543/app%2Ddb?sslmode=require",
      {
        DATABASE_URL: "redacted",
        PATH: "/bin",
        PGDATABASE: "stale-db",
        PGHOST: "stale-host",
      },
    ),
    {
      PATH: "/bin",
      PGDATABASE: "app-db",
      PGHOST: "db.internal",
      PGPASSWORD: "p@ss:word",
      PGPORT: "6543",
      PGSSLMODE: "require",
      PGUSER: "agent@user",
    },
  );
});

test("command termination and protocol waits have hard deadlines", async () => {
  const signals = [];
  let forceKillObserved = false;
  const forceKillTimer = terminateChildWithFallback(
    { kill: (signal) => signals.push(signal) },
    0,
    () => {
      forceKillObserved = true;
    },
  );
  await sleep(5);
  clearTimeout(forceKillTimer);
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(forceKillObserved, true);

  await assert.rejects(
    withTimeout(new Promise(() => {}), 5, "CDP reply"),
    /CDP reply timed out/,
  );
  assert.equal(await withTimeout(Promise.resolve("ok"), 5, "CDP reply"), "ok");
});

test("runtime snapshots fail closed when acceptance metrics are absent", () => {
  assert.doesNotThrow(() =>
    validateRuntimeAcceptanceSnapshot(pickRuntimeAcceptanceSnapshot(runtime())),
  );
  assert.throws(
    () => validateRuntimeAcceptanceSnapshot(pickRuntimeAcceptanceSnapshot({})),
    /missing required runtime metrics/,
  );
});

test("runtime sampling fails closed on missing or failed interval probes", () => {
  assert.doesNotThrow(() => assertRuntimeSamplesComplete([{ snapshot: {} }]));
  assert.throws(
    () => assertRuntimeSamplesComplete([]),
    /no runtime interval samples/,
  );
  assert.throws(
    () => assertRuntimeSamplesComplete([{ error: "request timed out" }]),
    /runtime interval sampling failed/,
  );
  assert.throws(
    () =>
      assertRuntimeSamplesComplete(
        [
          { at: "2026-07-13T13:30:01.000Z", snapshot: {} },
          { at: "2026-07-13T13:30:16.000Z", snapshot: {} },
        ],
        {
          windowStart: "2026-07-13T13:30:00.000Z",
          windowEnd: "2026-07-13T13:30:20.000Z",
          maxGapMs: 10_000,
        },
      ),
    /runtime sample gap 15000ms exceeds 10000ms/,
  );
});

test("symbol-state rates reject counter resets and invalid windows", () => {
  assert.equal(
    calculateCounterRate(
      { total: 100, atMs: 1_000 },
      { total: 105, atMs: 2_000 },
    ).rowsPerMin,
    300,
  );
  assert.throws(
    () =>
      calculateCounterRate(
        { total: 100, atMs: 1_000 },
        { total: 99, atMs: 2_000 },
      ),
    /counter decreased/,
  );
  assert.throws(
    () =>
      calculateCounterRate(
        { total: 100, atMs: 1_000 },
        { total: 101, atMs: 1_000 },
      ),
    /elapsed time must be positive/,
  );
});

test("process fingerprints reject PID reuse before profiling", () => {
  const expected = {
    pid: 301,
    startTimeTicks: "12345",
    cmdlineRaw: "node\0--enable-source-maps\0./dist/index.mjs\0",
    cwd: "/workspace",
  };
  assert.doesNotThrow(() =>
    assertSameProcessIdentity(expected, { ...expected }),
  );
  assert.doesNotThrow(() =>
    assertApiProcessRole(expected, "/workspace", "./dist/index.mjs"),
  );
  assert.doesNotThrow(() =>
    assertApiProcessRole(
      {
        ...expected,
        cmdlineRaw:
          "node\0--enable-source-maps\0/workspace/dist/index.mjs\0",
      },
      "/workspace",
      "./dist/index.mjs",
    ),
  );
  assert.throws(
    () =>
      assertApiProcessRole(
        {
          ...expected,
          cmdlineRaw:
            "node\0--enable-source-maps\0/workspace-other/dist/index.mjs\0",
        },
        "/workspace",
        "./dist/index.mjs",
      ),
    /does not match the API role/,
  );
  assert.throws(
    () =>
      assertApiProcessRole(
        {
          ...expected,
          cmdlineRaw: "node\0evil.mjs\0./dist/index.mjs\0",
        },
        "/workspace",
        "./dist/index.mjs",
      ),
    /does not match the API role/,
  );
  assert.throws(
    () =>
      assertApiProcessRole(
        {
          ...expected,
          cmdlineRaw: "node\0\0--enable-source-maps\0./dist/index.mjs\0",
        },
        "/workspace",
        "./dist/index.mjs",
      ),
    /does not match the API role/,
  );
  assert.doesNotThrow(() =>
    assertFreshApiHeartbeat(
      "2026-07-13T13:30:00.000Z",
      Date.parse("2026-07-13T13:30:10.000Z"),
      15_000,
    ),
  );
  assert.throws(
    () =>
      assertSameProcessIdentity(expected, {
        ...expected,
        startTimeTicks: "12346",
      }),
    /process identity changed/,
  );
  assert.throws(
    () => assertApiProcessRole(expected, "/other", "./dist/index.mjs"),
    /does not match the API role/,
  );
  assert.throws(
    () =>
      assertFreshApiHeartbeat(
        "2026-07-13T13:30:00.000Z",
        Date.parse("2026-07-13T13:30:20.000Z"),
        15_000,
      ),
    /API heartbeat is stale or invalid/,
  );
});

test("allocation profiler cleanup stops active sampling and disables the domain", async () => {
  const methods = [];
  await cleanupHeapProfiler(
    {
      async send(method) {
        methods.push(method);
        if (method === "HeapProfiler.stopSampling") throw new Error("stuck");
      },
    },
    true,
  );
  assert.deepEqual(methods, [
    "HeapProfiler.stopSampling",
    "HeapProfiler.disable",
  ]);
});

test("acceptance captures retain redacted SQL shapes without raw SQL samples", async () => {
  const source = await readFile(
    new URL("./market-open-acceptance.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /sampleSql/);
});
