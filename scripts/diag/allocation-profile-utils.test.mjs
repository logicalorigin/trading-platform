import assert from "node:assert/strict";
import test from "node:test";

import {
  ALLOCATION_SAMPLING_MODE,
  HEAP_PROFILER_SAMPLING_PARAMS,
  MAX_ALLOCATION_PROFILE_DURATION_MS,
  allocationProfilerInterruptionError,
  assertAllocationTargetBinding,
  assertDefaultSigusr1InspectorOptions,
  assertInspectorTargetBinding,
  cleanupHeapProfilerStrict,
  isValidHealthInstanceToken,
  parseAllocationProfilerArgs,
  profileArtifactPaths,
  recordAllocationProfilerInterruption,
  summarizeAllocationProfile,
  validateInspectorWebSocketUrl,
} from "./allocation-profile-utils.mjs";

test("health instance validation accepts the API's exact UUIDv4 shape", () => {
  assert.equal(
    isValidHealthInstanceToken("403f632b-b278-4078-8d88-33e3275a42ba"),
    true,
  );
  assert.equal(
    isValidHealthInstanceToken("403f632b-b278-4078-8d8833e3275a42ba"),
    false,
  );
  assert.equal(isValidHealthInstanceToken(null), false);
});

test("allocation mode includes objects collected by both GC generations", () => {
  assert.deepEqual(HEAP_PROFILER_SAMPLING_PARAMS, {
    samplingInterval: 65_536,
    includeObjectsCollectedByMajorGC: true,
    includeObjectsCollectedByMinorGC: true,
  });
  assert.deepEqual(ALLOCATION_SAMPLING_MODE, {
    kind: "sampled-js-heap-allocations",
    samplingIntervalBytes: 65_536,
    includeObjectsCollectedByMajorGC: true,
    includeObjectsCollectedByMinorGC: true,
  });
});

test("allocation profiler arguments are bounded and always resolve a raw output path", () => {
  const defaults = parseAllocationProfilerArgs(["123"], {
    cwd: "/workspace",
    tempDirectory: "/tmp",
    nowMs: Date.parse("2026-07-17T01:02:03.456Z"),
  });
  assert.deepEqual(defaults, {
    pid: 123,
    durationMs: 30_000,
    outPath: "/tmp/pyrus-allocation-123-20260717T010203Z.heapprofile",
  });
  assert.deepEqual(
    parseAllocationProfilerArgs(["123", "2500", "profiles/raw.json"], {
      cwd: "/workspace",
    }),
    {
      pid: 123,
      durationMs: 2_500,
      outPath: "/workspace/profiles/raw.json",
    },
  );

  for (const argv of [
    [],
    ["0"],
    ["1.5"],
    ["123", "0"],
    ["123", String(MAX_ALLOCATION_PROFILE_DURATION_MS + 1)],
    ["123", "Infinity"],
    ["123", "1000", ""],
    ["123", "1000", "bad\0path"],
    ["123", "1000", "path", "extra"],
  ]) {
    assert.throws(() => parseAllocationProfilerArgs(argv));
  }
});

test("inspector targets are restricted to the expected loopback endpoint", () => {
  assert.equal(
    validateInspectorWebSocketUrl("ws://127.0.0.1:9229/uuid"),
    "ws://127.0.0.1:9229/uuid",
  );
  assert.equal(
    validateInspectorWebSocketUrl("ws://[::1]:9229/uuid"),
    "ws://[::1]:9229/uuid",
  );
  for (const value of [
    "not-a-url",
    "wss://127.0.0.1:9229/uuid",
    "ws://127.0.0.1:9230/uuid",
    "ws://example.com:9229/uuid",
  ]) {
    assert.throws(() => validateInspectorWebSocketUrl(value));
  }
});

test("allocation summaries combine identical call frames and preserve sampled byte rates", () => {
  const sharedFrame = {
    functionName: "allocate",
    scriptId: "42",
    url: "file:///workspace/app.mjs",
    lineNumber: 9,
    columnNumber: 4,
  };
  const summary = summarizeAllocationProfile(
    {
      head: {
        selfSize: 0,
        callFrame: { functionName: "(root)" },
        children: [
          {
            selfSize: 1_048_576,
            callFrame: sharedFrame,
            children: [
              {
                selfSize: 524_288,
                callFrame: sharedFrame,
                children: [],
              },
            ],
          },
          {
            selfSize: 524_288,
            callFrame: {
              functionName: "other",
              scriptId: "43",
              url: "node:internal/test",
              lineNumber: 0,
              columnNumber: 0,
            },
            children: [],
          },
        ],
      },
    },
    2_000,
  );

  assert.equal(summary.totalBytes, 2_097_152);
  assert.equal(summary.samplingMode, ALLOCATION_SAMPLING_MODE);
  assert.equal(summary.totalMb, 2);
  assert.equal(summary.mbPerSec, 1);
  assert.deepEqual(summary.rows[0], {
    frame: "allocate file:///workspace/app.mjs:10:5 [script 42]",
    selfSizeBytes: 1_572_864,
    selfSizeMb: 1.5,
    mbPerSec: 0.75,
    percent: 75,
  });
  assert.equal(summary.rows[1].percent, 25);
});

test("allocation summaries reject malformed protocol data", () => {
  assert.throws(
    () => summarizeAllocationProfile({}, 1_000),
    /requires a head node/,
  );
  assert.throws(
    () =>
      summarizeAllocationProfile(
        { head: { selfSize: -1, children: [] } },
        1_000,
      ),
    /invalid selfSize/,
  );
  assert.throws(
    () =>
      summarizeAllocationProfile(
        { head: { selfSize: 0, children: {} } },
        1_000,
      ),
    /invalid children/,
  );
  assert.throws(
    () =>
      summarizeAllocationProfile({ head: { selfSize: 0, children: [] } }, 0),
    /duration must be positive/,
  );
});

test("profiler target binding requires a fresh exact heartbeat, health instance, and sole port owner", () => {
  const binding = {
    requestedPid: 50,
    identity: {
      pid: 50,
      ppid: 40,
      startTimeTicks: "500",
      cgroup: "0::/pyrus",
    },
    heartbeat: {
      pid: 50,
      ppid: 40,
      updatedAt: "2026-07-17T01:00:09.000Z",
      uptimeMs: 10_000,
    },
    nowMs: Date.parse("2026-07-17T01:00:10.000Z"),
    maxHeartbeatAgeMs: 15_000,
    healthInstanceToken: "11111111-1111-4111-8111-111111111111",
    listeningInodes: new Set(["100", "101"]),
    holders: [
      {
        pid: 50,
        startTimeTicks: "500",
        cgroup: "0::/pyrus",
        socketInodes: new Set(["100", "101"]),
      },
    ],
  };
  assert.doesNotThrow(() => assertAllocationTargetBinding(binding));

  for (const mutate of [
    (value) => (value.heartbeat.pid = 51),
    (value) => (value.heartbeat.ppid = 41),
    (value) => (value.heartbeat.updatedAt = "2026-07-17T00:59:00.000Z"),
    (value) => (value.heartbeat.uptimeMs = -1),
    (value) => (value.healthInstanceToken = null),
    (value) => (value.identity.startTimeTicks = "recycled"),
    (value) => (value.identity.cgroup = ""),
    (value) => value.listeningInodes.clear(),
    (value) => value.holders.push({ ...value.holders[0] }),
    (value) => value.holders[0].socketInodes.delete("101"),
  ]) {
    const value = structuredClone(binding);
    mutate(value);
    assert.throws(() => assertAllocationTargetBinding(value));
  }
});

test("profile artifact paths preserve raw, provenance, bundle, and source map separately", () => {
  assert.deepEqual(profileArtifactPaths("/tmp/capture.heapprofile"), {
    profilePath: "/tmp/capture.heapprofile",
    provenancePath: "/tmp/capture.heapprofile.provenance.json",
    bundleEvidencePath: "/tmp/capture.heapprofile.dist-index.mjs",
    sourceMapEvidencePath: "/tmp/capture.heapprofile.dist-index.mjs.map",
  });
});

test("strict heap-profiler cleanup reports stop and disable failures after attempting both", async () => {
  const methods = [];
  await assert.rejects(
    cleanupHeapProfilerStrict(
      {
        async send(method) {
          methods.push(method);
          throw new Error(`${method} failed`);
        },
      },
      true,
    ),
    (error) =>
      error instanceof AggregateError &&
      error.errors.length === 2 &&
      /stopSampling failed/.test(String(error.errors[0])) &&
      /disable failed/.test(String(error.errors[1])),
  );
  assert.deepEqual(methods, [
    "HeapProfiler.stopSampling",
    "HeapProfiler.disable",
  ]);
});

test("a late recorded profiler interruption is acceptance-fatal after cleanup", () => {
  assert.equal(allocationProfilerInterruptionError(null), null);
  for (const signalName of ["SIGINT", "SIGTERM"]) {
    const controller = new AbortController();
    let exitCode = 0;
    recordAllocationProfilerInterruption(
      controller,
      signalName,
      (value) => (exitCode = value),
    );
    assert.equal(exitCode, 1);
    assert.equal(controller.signal.aborted, true);
    const error = allocationProfilerInterruptionError(signalName);
    assert.ok(error instanceof Error);
    assert.match(error.message, new RegExp(signalName, "u"));
  }
  assert.throws(
    () => allocationProfilerInterruptionError("SIGUSR1"),
    /invalid interruption/iu,
  );
  assert.throws(
    () =>
      recordAllocationProfilerInterruption(
        new AbortController(),
        "SIGUSR1",
        () => {},
      ),
    /invalid/iu,
  );
});

test("SIGUSR1 activation refuses Node options that can move or suppress the inspector", () => {
  assert.doesNotThrow(() =>
    assertDefaultSigusr1InspectorOptions("--max-old-space-size=2560"),
  );
  for (const value of [
    "--inspect-port=9230",
    "--inspect_port=9230",
    "--inspect=127.0.0.1:9230",
    "--disable-sigusr1",
    "--experimental-config-file=./node.config.json",
    "'--inspect-port=9230'",
    '"--disable-sigusr1"',
    "\"'--experimental-config-file=./node.config.json'\"",
    "--debug-port=9230",
    "--inspect-publish-uid=stderr",
    "--max-old-space-size=2560 --trace-warnings",
    " --max-old-space-size=2560",
    "--max-old-space-size=2560 ",
  ]) {
    assert.throws(() => assertDefaultSigusr1InspectorOptions(value));
  }
});

test("the activated inspector listener belongs only to the requested API leaf", () => {
  const input = {
    identity: {
      pid: 50,
      startTimeTicks: "500",
      cgroup: "0::/pyrus",
    },
    listeningInodes: new Set(["100"]),
    holders: [
      {
        pid: 50,
        startTimeTicks: "500",
        cgroup: "0::/pyrus",
        socketInodes: new Set(["100"]),
      },
    ],
  };
  assert.equal(assertInspectorTargetBinding(input), true);
  for (const mutate of [
    (value) => value.listeningInodes.clear(),
    (value) => value.holders.push({ ...value.holders[0] }),
    (value) => (value.holders[0].pid = 51),
    (value) => (value.holders[0].startTimeTicks = "recycled"),
    (value) => value.holders[0].socketInodes.add("101"),
  ]) {
    const value = structuredClone(input);
    mutate(value);
    assert.throws(() => assertInspectorTargetBinding(value));
  }
});
