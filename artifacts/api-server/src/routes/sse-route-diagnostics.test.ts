import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  subscribeAlgoCockpitSnapshots,
  type AlgoCockpitStreamPayload,
} from "../services/algo-cockpit-streams";
import {
  __resetSseStreamDiagnosticsForTests,
  createSseConnectionWriter,
  getSseEmitCounters,
} from "../services/sse-stream-diagnostics";

class BackpressuredResponse extends EventEmitter {
  destroyed = false;
  writableEnded = false;
  chunks: string[] = [];

  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return false;
  }
}

function flushAsyncWork(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

for (const [file, stream] of [
  ["./marketing.ts", "marketing-shadow-dashboard"],
  ["./automation.ts", "algo-cockpit"],
] as const) {
  test(`${stream} route records SSE lifecycle and serialization diagnostics`, () => {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");

    assert.match(source, /createSseConnectionWriter\(/);
    assert.match(source, new RegExp(`recordSseStreamOpen\\("${stream}"\\)`));
    assert.match(
      source,
      new RegExp(`recordSseStreamClose\\("${stream}", closeReason\\)`),
    );
    assert.match(source, /closeReason = "request_aborted"/);
    assert.match(source, /closeReason = "client_close"/);
    assert.match(source, /closeReason = "setup_error"/);
  });
}

test("diagnostics stream sends one authoritative initial snapshot", () => {
  const routeSource = readFileSync(
    new URL("./diagnostics.ts", import.meta.url),
    "utf8",
  );
  const serviceSource = readFileSync(
    new URL("../services/diagnostics.ts", import.meta.url),
    "utf8",
  );
  const routeStart = routeSource.indexOf(
    'router.get("/diagnostics/stream",',
  );
  const routeEnd = routeSource.indexOf("\nrouter.", routeStart + 1);
  const handler = routeSource.slice(routeStart, routeEnd);

  assert.match(
    handler,
    /writer\.writeEvent\("ready", \{\s*at: new Date\(\)\.toISOString\(\),?\s*\}\);/,
    "ready must contain connection metadata only",
  );
  assert.doesNotMatch(
    handler,
    /writeEvent\("ready", \{[^}]*latest:/s,
    "ready must not duplicate the full diagnostics snapshot",
  );
  assert.match(
    serviceSource,
    /if \(latestPayload\) \{\s*listener\(\{ type: "snapshot", payload: latestPayload \}\);\s*\}/,
    "the diagnostics subscription owns the single initial full snapshot",
  );
});

test("marketing snapshots and heartbeats use bounded coalesced SSE writes", () => {
  const source = readFileSync(new URL("./marketing.ts", import.meta.url), "utf8");

  assert.doesNotMatch(source, /res\.write\(/);
  assert.doesNotMatch(source, /error\.message/);
  assert.match(
    source,
    /writer\.writeEvent\(\s*"snapshot",\s*initialPayload,\s*"marketing-shadow-dashboard-snapshot"/,
  );
  assert.match(
    source,
    /writer\?\.writeEvent\(\s*"snapshot",\s*payload,\s*"marketing-shadow-dashboard-snapshot"/,
  );
  assert.match(
    source,
    /writer\?\.writeChunk\(\s*": ping\\n\\n",\s*"marketing-shadow-dashboard-heartbeat"/,
  );
});

test("an SSE connection keeps only the latest safe payload while its socket is backpressured", async () => {
  __resetSseStreamDiagnosticsForTests();
  const response = new BackpressuredResponse();
  const closeReasons: string[] = [];
  const writer = createSseConnectionWriter({
    response,
    onWriteFailure: (reason) => closeReasons.push(reason),
  });

  writer.writeEvent("snapshot", { version: 1 }, "snapshot");
  await Promise.resolve();
  for (let version = 2; version <= 1_000; version += 1) {
    writer.writeEvent("snapshot", { version }, "snapshot");
  }

  assert.equal(response.listenerCount("drain"), 1);
  response.emit("drain");
  await flushAsyncWork();

  assert.equal(response.chunks.length, 2);
  assert.match(response.chunks[0]!, /"version":1/);
  assert.match(response.chunks[1]!, /"version":1000/);
  assert.equal(
    getSseEmitCounters().events,
    2,
    "superseded snapshots must not consume JSON serialization time",
  );
  assert.deepEqual(closeReasons, []);
  writer.close();
  assert.equal(response.listenerCount("drain"), 0);
  __resetSseStreamDiagnosticsForTests();
});

test("an SSE connection visibly fails instead of retaining an unbounded write backlog", async () => {
  const response = new BackpressuredResponse();
  const closeReasons: string[] = [];
  const writer = createSseConnectionWriter({
    response,
    maxPendingChunks: 2,
    onWriteFailure: (reason) => closeReasons.push(reason),
  });

  writer.writeEvent("event", { sequence: 1 });
  await Promise.resolve();
  writer.writeEvent("event", { sequence: 2 });
  writer.writeEvent("event", { sequence: 3 });
  writer.writeEvent("event", { sequence: 4 });

  assert.deepEqual(closeReasons, ["write_backpressure_overflow"]);
  assert.equal(response.listenerCount("drain"), 0);
});

test("an SSE connection closes with a visible reason when drain never arrives", async () => {
  const response = new BackpressuredResponse();
  const closeReasons: string[] = [];
  const writer = createSseConnectionWriter({
    response,
    drainTimeoutMs: 5,
    onWriteFailure: (reason) => closeReasons.push(reason),
  });

  writer.writeEvent("event", { sequence: 1 });
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.deepEqual(closeReasons, ["write_backpressure_timeout"]);
  assert.equal(response.listenerCount("drain"), 0);
  assert.equal(response.listenerCount("close"), 0);
  assert.equal(response.listenerCount("error"), 0);
});

test("an SSE socket error is reported as a write error, not a drain timeout", async () => {
  const response = new BackpressuredResponse();
  const closeReasons: string[] = [];
  const writer = createSseConnectionWriter({
    response,
    drainTimeoutMs: 5_000,
    onWriteFailure: (reason) => closeReasons.push(reason),
  });

  writer.writeEvent("event", { sequence: 1 });
  await Promise.resolve();
  response.emit("error", new Error("socket reset"));
  await flushAsyncWork();

  assert.deepEqual(closeReasons, ["write_error"]);
  assert.equal(response.listenerCount("drain"), 0);
  assert.equal(response.listenerCount("close"), 0);
  assert.equal(response.listenerCount("error"), 0);
});

test("algo cockpit polling awaits live delivery before freshness", async () => {
  let releaseLive!: () => void;
  const liveGate = new Promise<void>((resolve) => {
    releaseLive = resolve;
  });
  const deliveries: string[] = [];
  const input = {
    appUserId: "sse-order-test",
    deploymentId: "deployment-sse-order-test",
    mode: "shadow" as const,
  };
  const payload = {
    stream: "algo-cockpit-live",
    phase: "full",
    mode: "shadow",
    deploymentId: input.deploymentId,
    updatedAt: "2026-07-16T00:00:00.000Z",
    deployments: { deployments: [] },
    focusedDeployment: null,
    events: { events: [] },
    signalOptionsState: null,
    cockpit: null,
    performance: null,
    signalMonitorProfile: null,
  } as AlgoCockpitStreamPayload;
  const interval = { unref() {} };
  const timeout = { unref() {} };
  let intervalTick = () => {};
  let fetchCount = 0;
  const unsubscribe = subscribeAlgoCockpitSnapshots(
    input,
    async () => {
      deliveries.push("live:start");
      await liveGate;
      deliveries.push("live:complete");
    },
    {
      fetchPayload: async () => {
        fetchCount += 1;
        return payload;
      },
      subscribeChanges: () => () => {},
      setInterval: ((callback: () => void) => {
        intervalTick = callback;
        return interval;
      }) as unknown as typeof setInterval,
      clearInterval: (() => {}) as unknown as typeof clearInterval,
      setTimeout: (() => timeout) as unknown as typeof setTimeout,
      clearTimeout: (() => {}) as unknown as typeof clearTimeout,
      onPollSuccess: async () => {
        deliveries.push("freshness");
      },
    },
  );

  try {
    await flushAsyncWork();
    assert.deepEqual(deliveries, ["live:start"]);
    intervalTick();
    await flushAsyncWork();
    assert.equal(fetchCount, 1, "a second poll must not overlap live delivery");

    releaseLive();
    await flushAsyncWork();
    assert.deepEqual(deliveries, [
      "live:start",
      "live:complete",
      "freshness",
    ]);
  } finally {
    releaseLive();
    unsubscribe();
  }
});

test("diagnostics and Algo routes use the bounded connection writer", () => {
  const diagnosticsSource = readFileSync(
    new URL("./diagnostics.ts", import.meta.url),
    "utf8",
  );
  const automationSource = readFileSync(
    new URL("./automation.ts", import.meta.url),
    "utf8",
  );

  assert.match(diagnosticsSource, /createSseConnectionWriter\(/);
  assert.doesNotMatch(diagnosticsSource, /let queue = Promise\.resolve\(\)/);
  assert.match(
    diagnosticsSource,
    /message\.type === "snapshot" \? "diagnostics-snapshot" : undefined/,
  );
  assert.match(automationSource, /createSseConnectionWriter\(/);
  assert.match(automationSource, /async \(payload\) =>/);
  assert.doesNotMatch(
    automationSource,
    /void scopeAlgoCockpitPayloadForSession\(session, payload\)/,
  );
});
