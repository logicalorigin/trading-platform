import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readLocalSource = (filename) =>
  readFileSync(new URL(filename, import.meta.url), "utf8");

test("header status cluster does not reference an unbound React namespace", () => {
  const source = readLocalSource("./HeaderStatusCluster.jsx");

  assert.doesNotMatch(source, /\bReact\./);
});

test("detach only waits on a Windows desktop shutdown when the gateway is connected", () => {
  // Regression: detaching an already-off bridge must settle immediately. If the
  // remote-shutdown wait is queued unconditionally, the "Desktop" step animates
  // for 35s on a job no desktop will claim, which reads as "stuck detaching".
  const source = readLocalSource("./HeaderStatusCluster.jsx");

  assert.match(
    source,
    /action\.queueRemoteShutdown === true && gatewayConnectedForBridge/,
  );
});

test("every detach/clear request is bounded by a timeout so a stalled connection can't hang the control", () => {
  // Regression: the clear-state "Detach bridge" path awaited platformJsonRequest
  // with no timeout (timeoutMs:0 => no AbortController), so a stalled request
  // (e.g. queued behind live SSE streams, or any transport latency) left the
  // detach control animating forever. The bridge/detach call plus both
  // bridgeOverride.clear calls must each pass a bounded timeoutMs.
  const source = readLocalSource("./HeaderStatusCluster.jsx");

  const boundedRequests = source.match(/timeoutMs: 15000/g) ?? [];
  assert.ok(
    boundedRequests.length >= 3,
    `expected the 3 detach/clear fetches to be bounded; found ${boundedRequests.length}`,
  );
});
