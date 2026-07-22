import assert from "node:assert/strict";
import test from "node:test";

import {
  WATCH_DEFAULTS,
  assertExecutableSourceHashesUnchanged,
  assertHeartbeatBinding,
  assertRecorderEventCoverage,
  assertRuntimeChainRoles,
  assertWatchCoverage,
  recorderSourceSpecs,
  recorderTimingsFromEnviron,
  recordWatchInterruption,
  watchEvidenceAcceptance,
} from "./same-process-runtime-watch.mjs";

const REPO_ROOT = "/repo";
const API_ROOT = `${REPO_ROOT}/artifacts/api-server`;
const PYRUS_ROOT = `${REPO_ROOT}/artifacts/pyrus`;
const CGROUP = "0::/pyrus";

function identity(pid, ppid, argv, cwd, cgroup = CGROUP) {
  return {
    pid,
    ppid,
    startTimeTicks: `start-${pid}`,
    cgroup,
    cmdlineRaw: `${argv.join("\0")}\0`,
    cwd,
  };
}

function runtimeChain() {
  return [
    identity(
      50,
      40,
      ["/bin/node", "--enable-source-maps", "./dist/index.mjs"],
      API_ROOT,
    ),
    identity(
      40,
      30,
      [
        "/bin/node",
        "/bin/pnpm",
        "--filter",
        "@workspace/api-server",
        "run",
        "dev",
      ],
      REPO_ROOT,
    ),
    identity(30, 20, ["/bin/node", "./scripts/runDevApp.mjs"], PYRUS_ROOT),
    identity(
      20,
      10,
      [
        "/bin/node",
        "/bin/pnpm",
        "--filter",
        "@workspace/pyrus",
        "run",
        "dev:replit",
      ],
      PYRUS_ROOT,
    ),
    identity(
      10,
      1,
      ["pid2", "/mnt/pid2/server.cjs"],
      REPO_ROOT,
      "0::/system.slice/pid1.scope",
    ),
  ];
}

test("keeps the acceptance window fixed and rejects invalid recorder timing", () => {
  assert.deepEqual(WATCH_DEFAULTS, {
    durationMs: 900_000,
    sampleIntervalMs: 5_000,
    probeIntervalMs: 30_000,
    maxGapMs: 7_500,
    maxWallDriftMs: 2_000,
    recorderSetupAllowanceMs: 15_000,
    healthTimeoutMs: 5_000,
    recorderFlushMs: 1_500,
    apiPort: 8_080,
    frontendPort: 18_747,
  });
  assert.equal(recorderTimingsFromEnviron("").apiHeartbeatIntervalMs, 5_000);
  assert.throws(
    () =>
      recorderTimingsFromEnviron(
        "PYRUS_API_FLIGHT_RECORDER_INTERVAL_MS=0",
      ),
    /positive integer interval/iu,
  );
});

test("accepts only the exact API to pid2 runtime chain", () => {
  assert.doesNotThrow(() =>
    assertRuntimeChainRoles(runtimeChain(), {
      repoRoot: REPO_ROOT,
      apiRoot: API_ROOT,
      pyrusRoot: PYRUS_ROOT,
    }),
  );

  const drifted = runtimeChain();
  drifted[2].cmdlineRaw =
    "/bin/node\0./scripts/runDevApp.mjs\0--unexpected\0";
  assert.throws(
    () =>
      assertRuntimeChainRoles(drifted, {
        repoRoot: REPO_ROOT,
        apiRoot: API_ROOT,
        pyrusRoot: PYRUS_ROOT,
      }),
    /supervisor role/iu,
  );
});

test("uses exact procfs lineage and API recorder evidence without the retired supervisor recorder", () => {
  const chain = runtimeChain();
  const startMs = Date.parse("2026-07-19T16:00:00.000Z");
  const endMs = startMs + 1_000;

  assert.doesNotThrow(() =>
    assertHeartbeatBinding({
      apiHeartbeat: {
        pid: chain[0].pid,
        ppid: chain[1].pid,
        updatedAt: new Date(startMs + 500).toISOString(),
      },
      chain,
      nowMs: endMs,
      apiMaxAgeMs: 7_500,
    }),
  );
  assert.deepEqual(
    recorderSourceSpecs({
      recorderDir: "/recorder",
      startMs,
      endMs,
    }),
    [
      {
        key: "api-2026-07-19",
        kind: "api",
        path: "/recorder/api-events-2026-07-19.jsonl",
      },
    ],
  );
  assert.deepEqual(
    assertRecorderEventCoverage(
      {
        api: [
          {
            event: "api-memory-sample",
            time: new Date(startMs + 500).toISOString(),
            memoryMb: { rss: 128 },
          },
        ],
      },
      {
        startMs,
        endMs,
        timings: { apiMemoryMaxGapMs: 1_000 },
      },
    ),
    {
      apiMemory: {
        event: "api-memory-sample",
        count: 1,
        firstAt: new Date(startMs + 500).toISOString(),
        lastAt: new Date(startMs + 500).toISOString(),
        maxGapMs: 500,
      },
    },
  );
});

test("a late interruption can never produce accepted evidence", () => {
  const abortController = new AbortController();
  let exitCode = 0;
  recordWatchInterruption(
    abortController,
    "SIGTERM",
    (value) => (exitCode = value),
  );

  assert.equal(exitCode, 1);
  assert.deepEqual(
    watchEvidenceAcceptance({
      primaryError: null,
      finalizationErrors: [],
      signal: abortController.signal,
    }),
    {
      evidenceIntegrityPassed: false,
      interruptionReason: "watch interrupted by SIGTERM",
    },
  );
});

test("coverage and executable hashes reject gaps or source drift", () => {
  assert.equal(
    assertWatchCoverage(
      [
        { ok: true, elapsedMs: 0 },
        { ok: true, elapsedMs: 5_000 },
        { ok: true, elapsedMs: 10_000 },
      ],
      10_000,
      7_500,
    ),
    true,
  );
  assert.throws(
    () =>
      assertWatchCoverage(
        [
          { ok: true, elapsedMs: 0 },
          { ok: true, elapsedMs: 8_000 },
        ],
        8_000,
        7_500,
      ),
    /sample gap/iu,
  );

  const start = [{ path: "/watch.mjs", sha256: "a".repeat(64) }];
  assert.equal(assertExecutableSourceHashesUnchanged(start, start), true);
  assert.throws(
    () =>
      assertExecutableSourceHashesUnchanged(start, [
        { path: "/watch.mjs", sha256: "b".repeat(64) },
      ]),
    /source changed/iu,
  );
});
