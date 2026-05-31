import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyFlowUniverseOptionabilityProbeResult,
  createFlowUniverseOptionabilityVerifier,
  type FlowUniverseOptionabilityCandidate,
} from "./flow-universe-optionability-verifier";

function candidate(symbol: string): FlowUniverseOptionabilityCandidate {
  return {
    symbol,
    market: "stocks",
    listingKey: `stocks:${symbol}`,
  };
}

test("optionability classifier treats future expirations as verified", () => {
  assert.deepEqual(
    classifyFlowUniverseOptionabilityProbeResult({
      expirations: [{ expirationDate: new Date("2026-06-19T00:00:00.000Z") }],
      debug: { reason: null },
    }),
    { status: "verified", reason: null },
  );
});

test("optionability classifier rejects only successful empty expiration probes", () => {
  assert.deepEqual(
    classifyFlowUniverseOptionabilityProbeResult({
      expirations: [],
      debug: { degraded: true, reason: "option_expirations_successful_empty" },
    }),
    { status: "rejected", reason: "no_option_expirations" },
  );
});

test("optionability classifier does not reject transient empty expiration probes", () => {
  assert.deepEqual(
    classifyFlowUniverseOptionabilityProbeResult({
      expirations: [],
      debug: {
        stale: true,
        degraded: true,
        reason: "options_backoff",
        backoffRemainingMs: 60_000,
      },
    }),
    { status: "error", reason: "options_backoff" },
  );
});

test("optionability verifier skips without loading candidates when pressure guard blocks it", async () => {
  let loaded = false;
  let fetched = false;
  const verifier = createFlowUniverseOptionabilityVerifier({
    fetchExpirations: async () => {
      fetched = true;
      return { expirations: [] };
    },
    loadCandidates: async () => {
      loaded = true;
      return [candidate("AAPL")];
    },
    markOptionability: async () => {},
    shouldRun: () => "resource-pressure",
  });

  const summary = await verifier.runOnce("test");

  assert.equal(summary.skippedReason, "resource-pressure");
  assert.equal(loaded, false);
  assert.equal(fetched, false);
  assert.equal(
    verifier.getDiagnostics().lastSkippedReason,
    "resource-pressure",
  );
});

test("optionability verifier marks verified and rejected symbols but leaves degraded empties unmarked", async () => {
  const marked: Array<{
    symbol: string;
    status: string;
    reason: string | null;
  }> = [];
  const verifier = createFlowUniverseOptionabilityVerifier({
    batchSize: 3,
    delayMs: 0,
    fetchExpirations: async ({ underlying }) => {
      if (underlying === "AAPL") {
        return { expirations: [{ expirationDate: new Date("2026-06-19") }] };
      }
      if (underlying === "XYZ") {
        return {
          expirations: [],
          debug: {
            degraded: true,
            reason: "option_expirations_successful_empty",
          },
        };
      }
      return {
        expirations: [],
        debug: {
          stale: true,
          degraded: true,
          reason: "options_upstream_failure",
        },
      };
    },
    loadCandidates: async () => [
      candidate("AAPL"),
      candidate("XYZ"),
      candidate("BACKOFF"),
    ],
    markOptionability: async (input) => {
      marked.push({
        symbol: input.symbol,
        status: input.status,
        reason: input.reason,
      });
    },
  });

  const summary = await verifier.runOnce("test");

  assert.equal(summary.attempted, 3);
  assert.equal(summary.verified, 1);
  assert.equal(summary.rejected, 1);
  assert.equal(summary.errors, 1);
  assert.deepEqual(marked, [
    { symbol: "AAPL", status: "verified", reason: null },
    { symbol: "XYZ", status: "rejected", reason: "no_option_expirations" },
  ]);
});

test("optionability verifier counts successful probes as errors when persistence fails", async () => {
  const verifier = createFlowUniverseOptionabilityVerifier({
    batchSize: 1,
    delayMs: 0,
    fetchExpirations: async () => ({
      expirations: [{ expirationDate: new Date("2026-06-19") }],
    }),
    loadCandidates: async () => [candidate("AAPL")],
    markOptionability: async () => {
      throw new Error("db write failed");
    },
  });

  const summary = await verifier.runOnce("test");

  assert.equal(summary.verified, 0);
  assert.equal(summary.errors, 1);
  assert.deepEqual(summary.sample, [
    { symbol: "AAPL", status: "error", reason: "db write failed" },
  ]);
});

test("optionability verifier backs off after consecutive all-error batches", async () => {
  let nowMs = new Date("2026-05-29T15:30:00.000Z").getTime();
  let fetchCount = 0;
  const verifier = createFlowUniverseOptionabilityVerifier({
    batchSize: 1,
    delayMs: 0,
    backoffMs: 60_000,
    maxConsecutiveErrors: 2,
    now: () => new Date(nowMs),
    fetchExpirations: async () => {
      fetchCount += 1;
      throw new Error("bridge unavailable");
    },
    loadCandidates: async () => [candidate("AAPL")],
    markOptionability: async () => {},
  });

  await verifier.runOnce("first");
  const second = await verifier.runOnce("second");
  const third = await verifier.runOnce("third");

  assert.equal(second.errors, 1);
  assert.equal(third.skippedReason, "error-backoff");
  assert.equal(fetchCount, 2);
  assert.equal(
    verifier.getDiagnostics().backoffUntil?.toISOString(),
    "2026-05-29T15:31:00.000Z",
  );

  nowMs += 60_001;
  await verifier.runOnce("after-backoff");
  assert.equal(fetchCount, 3);
});
