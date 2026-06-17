import test from "node:test";
import assert from "node:assert/strict";

import { platformJsonRequest } from "./platformJsonRequest.js";

// platformJsonRequest schedules its abort timer via window.setTimeout, so the
// module needs a window with the timer functions in a Node test context.
globalThis.window = globalThis.window ?? {
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (id) => clearTimeout(id),
};

const originalFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("timeoutMs aborts a stalled request instead of hanging forever (the detach fix)", async () => {
  // A fetch that never settles until its AbortSignal fires — exactly the
  // stalled bridgeOverride.clear that left the detach control spinning.
  globalThis.fetch = (_path, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    });

  const startedAt = Date.now();
  await assert.rejects(
    () =>
      platformJsonRequest(
        "/api/settings/backend/actions/ibkr.bridgeOverride.clear",
        { method: "POST", body: { force: true }, timeoutMs: 80 },
      ),
    /timed out after 80ms/,
  );
  assert.ok(
    Date.now() - startedAt >= 60,
    "should wait roughly timeoutMs before aborting",
  );
});

test("without timeoutMs no abort signal is wired — the old unbounded behavior", async () => {
  let observedSignal = "unset";
  globalThis.fetch = (_path, init) => {
    observedSignal = init.signal;
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ cleared: true }),
    });
  };

  const result = await platformJsonRequest("/x", { method: "POST", body: {} });
  assert.deepEqual(result, { cleared: true });
  assert.equal(
    observedSignal,
    undefined,
    "timeoutMs:0 wires no AbortController, so a stalled request would hang forever",
  );
});

test("a fast success within the timeout still returns parsed JSON (happy path)", async () => {
  globalThis.fetch = () =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ cleared: true, reason: "no_override" }),
    });

  const result = await platformJsonRequest("/x", {
    method: "POST",
    body: { force: true },
    timeoutMs: 15000,
  });
  assert.deepEqual(result, { cleared: true, reason: "no_override" });
});
