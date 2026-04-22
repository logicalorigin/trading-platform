import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDirectExpiryProbeDates,
  buildDirectStrikeProbeValues,
  fetchMassiveJsonWithRetry,
  isRetryableMassiveError,
} from "./massiveClient.js";

test("fetchMassiveJsonWithRetry retries a retryable Massive status once", async () => {
  const originalFetch = global.fetch;
  let callCount = 0;
  global.fetch = async () => {
    callCount += 1;
    if (callCount === 1) {
      return new Response(JSON.stringify({ error: "gateway timeout" }), { status: 504 });
    }
    return new Response(JSON.stringify({ ok: true, results: [] }), { status: 200 });
  };

  try {
    const result = await fetchMassiveJsonWithRetry("https://example.test/massive", {
      method: "GET",
      timeoutMs: 1000,
      retries: 1,
      retryDelayMs: 0,
    });
    assert.equal(callCount, 2);
    assert.equal(result.attempts, 2);
    assert.deepEqual(result.payload, { ok: true, results: [] });
  } finally {
    global.fetch = originalFetch;
  }
});

test("fetchMassiveJsonWithRetry does not retry non-retryable Massive errors", async () => {
  const originalFetch = global.fetch;
  let callCount = 0;
  global.fetch = async () => {
    callCount += 1;
    return new Response(JSON.stringify({ error: "bad request" }), { status: 400 });
  };

  try {
    await assert.rejects(
      () => fetchMassiveJsonWithRetry("https://example.test/massive", {
        method: "GET",
        timeoutMs: 1000,
        retries: 1,
        retryDelayMs: 0,
      }),
      /bad request/,
    );
    assert.equal(callCount, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test("isRetryableMassiveError recognizes timeout-style failures", () => {
  assert.equal(isRetryableMassiveError(new Error("Massive request timed out after 15000ms")), true);
  assert.equal(isRetryableMassiveError(new Error("Massive request failed (400)")), false);
});

test("buildDirectExpiryProbeDates prefers the nearest weekday expiries around target DTE", () => {
  assert.deepEqual(
    buildDirectExpiryProbeDates("2024-03-28", { targetDte: 1, minDte: 1, maxDte: 1, limit: 4 }),
    ["2024-03-29", "2024-04-01", "2024-04-02", "2024-04-03"],
  );
});

test("buildDirectStrikeProbeValues creates a sorted, deduped grid around spot", () => {
  const values = buildDirectStrikeProbeValues(523.2, { radius: 2, increments: [1, 0.5] });
  assert.deepEqual(values, [521, 522, 522.5, 523, 523.5, 524, 524.5, 525, 526]);
});
