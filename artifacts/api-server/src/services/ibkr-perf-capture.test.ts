import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const testDir = mkdtempSync(join(tmpdir(), "pyrus-perf-"));
const previousDir = process.env["PYRUS_FLIGHT_RECORDER_DIR"];
process.env["PYRUS_FLIGHT_RECORDER_DIR"] = testDir;

const perf = await import("./ibkr-perf-capture");
const audit = await import("./ibkr-connection-audit");
const sse = await import("./sse-stream-diagnostics");

after(() => {
  perf.__resetIbkrPerfCaptureForTests();
  if (previousDir) {
    process.env["PYRUS_FLIGHT_RECORDER_DIR"] = previousDir;
  } else {
    delete process.env["PYRUS_FLIGHT_RECORDER_DIR"];
  }
  rmSync(testDir, { force: true, recursive: true });
});

test("derives SSE event rate between two samples", () => {
  perf.__resetIbkrPerfCaptureForTests();
  sse.__resetSseStreamDiagnosticsForTests();
  const t0 = Date.parse("2026-06-09T20:00:00.000Z");
  perf.recordIbkrPerfSample(t0); // baseline, sseEmit.events = 0
  for (let i = 0; i < 50; i += 1) {
    sse.serializeSseEventData({ x: i }); // +50 emitted events
  }
  const second = perf.recordIbkrPerfSample(t0 + 10_000); // dt = 10s
  assert(second.rates, "expected derived rates on the second sample");
  assert.equal(second.rates["sseEventsPerSec"], 5); // 50 / 10
  assert(
    (second.rates["sseBytesPerSec"] ?? 0) > 0,
    "expected non-zero SSE bytes/sec",
  );
});

test("buckets samples by connection state into before/after", () => {
  perf.__resetIbkrPerfCaptureForTests();
  audit.__resetConnectionAuditForTests();

  audit.recordConnectionLiveState({ connected: false, streamState: "offline" });
  perf.recordIbkrPerfSample(Date.parse("2026-06-09T20:01:00.000Z"));

  audit.recordConnectionLiveState({ connected: true, streamState: "live" });
  perf.recordIbkrPerfSample(Date.parse("2026-06-09T20:01:07.000Z"));
  perf.recordIbkrPerfSample(Date.parse("2026-06-09T20:01:14.000Z"));

  const snapshot = perf.getIbkrPerfSnapshot();
  assert.equal(snapshot.before_disconnected.samples, 1);
  assert.equal(snapshot.after_connected.samples, 2);
  assert(existsSync(join(testDir, "ibkr-perf-current.json")));
  assert(existsSync(join(testDir, "ibkr-perf.md")));
});

test("client liveData attribution flows into the connected bucket", () => {
  perf.__resetIbkrPerfCaptureForTests();
  audit.__resetConnectionAuditForTests();
  audit.recordConnectionLiveState({ connected: true, streamState: "live" });
  perf.recordLatestClientPerfMetrics({
    liveData: {
      longTaskMsPerWindow: 1200,
      notificationsPerSec: 340,
      symbolListenerCount: 512,
    },
  });
  perf.recordIbkrPerfSample(Date.parse("2026-06-09T20:02:00.000Z"));

  const snapshot = perf.getIbkrPerfSnapshot();
  assert.equal(snapshot.after_connected.avg["notificationsPerSec"], 340);
  assert.equal(snapshot.after_connected.avg["symbolListenerCount"], 512);
  assert.equal(snapshot.after_connected.avg["longTaskMsPerWindow"], 1200);
});

test("prunes perf logs older than retention", () => {
  perf.__resetIbkrPerfCaptureForTests();
  const stale = join(testDir, "ibkr-perf-2000-01-01.jsonl");
  writeFileSync(stale, "{}\n");
  assert(existsSync(stale));
  perf.startIbkrPerfCapture(); // prunes on start
  perf.stopIbkrPerfCapture();
  assert(!existsSync(stale), "expected the stale perf log to be pruned");
});
