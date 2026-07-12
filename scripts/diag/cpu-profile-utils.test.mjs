import assert from "node:assert/strict";
import test from "node:test";

import {
  parseCpuProfilerArgs,
  parseCpuProfileSummaryOutput,
  readInspectorProcessId,
  summarizeCpuProfile,
} from "./cpu-profile-utils.mjs";

test("CPU profiler arguments reject unsafe process and duration values", () => {
  for (const argv of [
    [],
    ["0"],
    ["-1"],
    ["1.5"],
    ["123", "0"],
    ["123", "Infinity"],
  ]) {
    assert.throws(() => parseCpuProfilerArgs(argv), /positive safe integer/);
  }

  assert.deepEqual(parseCpuProfilerArgs(["123", "2500", "profile.json"]), {
    pid: 123,
    durationMs: 2_500,
    outPath: "profile.json",
  });
});

test("CPU profiler reads the process id reported by the inspector target", () => {
  assert.equal(
    readInspectorProcessId({ result: { type: "number", value: 123 } }),
    123,
  );
  assert.equal(readInspectorProcessId({ result: { value: "123" } }), null);
  assert.equal(readInspectorProcessId({ result: { value: -1 } }), null);
  assert.equal(readInspectorProcessId({}), null);
});

test("CPU summaries weight samples by timeDeltas instead of hitCount", () => {
  const summary = summarizeCpuProfile({
    nodes: [
      {
        id: 1,
        hitCount: 100,
        callFrame: { functionName: "(idle)", url: "", lineNumber: -1 },
      },
      {
        id: 2,
        hitCount: 1,
        callFrame: { functionName: "work", url: "file:///app.mjs", lineNumber: 9 },
      },
    ],
    samples: [1, 2],
    timeDeltas: [1_000, 9_000],
  });

  assert.equal(summary.totalSamples, 2);
  assert.equal(summary.totalDurationUs, 10_000);
  assert.equal(summary.idleDurationUs, 1_000);
  assert.equal(summary.busyDurationUs, 9_000);
  assert.equal(summary.busyPercent, 90);
  assert.deepEqual(summary.rows, [
    {
      frame: "work app.mjs:10",
      durationUs: 9_000,
      percent: 100,
    },
  ]);
});

test("CPU summaries reject profiles without aligned timeDeltas", () => {
  assert.throws(
    () =>
      summarizeCpuProfile({
        nodes: [],
        samples: [1],
        timeDeltas: [],
      }),
    /aligned samples and timeDeltas/,
  );
});

test("CPU summary output preserves weighted microseconds for acceptance reports", () => {
  const parsed = parseCpuProfileSummaryOutput([
    "total samples=2 idle=1000 busy=9000 (busy%=90.0)",
    "top self-time as % of BUSY microseconds:",
    "  70.0%       6300  work app.mjs:10",
    "  30.0%       2700  (garbage collector) :0",
  ].join("\n"));

  assert.equal(parsed.totalSamples, 2);
  assert.equal(parsed.idleDurationUs, 1_000);
  assert.equal(parsed.busyDurationUs, 9_000);
  assert.equal(parsed.busyPercent, 90);
  assert.equal(parsed.gcPercent, 30);
  assert.deepEqual(parsed.rows[0], {
    percent: 70,
    durationUs: 6_300,
    frame: "work app.mjs:10",
  });
});
