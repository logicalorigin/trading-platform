import test from "node:test";
import assert from "node:assert/strict";

import {
  hasCoverageForDateWindow,
  canUseBrokerSpotHistoryFallback,
  mergeContiguousCoverageWindow,
  resolveMassiveFiveMinutePrimaryDateWindow,
  resolveBootstrappedWarmState,
  resolveNextWarmCoverageWindow,
} from "./researchSpotHistory.js";

test("resolveBootstrappedWarmState only trusts existing warm state", () => {
  const existingState = {
    ticker: "SPY",
    targetStart: "2026-01-01",
    targetEnd: "2026-03-27",
    nextCursorDate: "2026-01-01",
    lastStatus: "complete",
  };

  assert.deepEqual(
    resolveBootstrappedWarmState({
      existingState,
      coverage: {
        coverageStart: "2025-01-01",
        coverageEnd: "2026-03-27",
      },
      targetStart: "2025-01-01",
      targetEnd: "2026-03-27",
    }),
    existingState,
  );
  assert.equal(resolveBootstrappedWarmState({ existingState: null }), null);
});

test("mergeContiguousCoverageWindow extends contiguous range when windows touch", () => {
  assert.deepEqual(
    mergeContiguousCoverageWindow({
      currentStart: "2026-02-01",
      currentEnd: "2026-03-27",
      windowFrom: "2026-01-01",
      windowTo: "2026-01-31",
    }),
    {
      coverageStart: "2026-01-01",
      coverageEnd: "2026-03-27",
      merged: true,
    },
  );
});

test("mergeContiguousCoverageWindow refuses to bridge disjoint gaps", () => {
  assert.deepEqual(
    mergeContiguousCoverageWindow({
      currentStart: "2026-02-10",
      currentEnd: "2026-03-27",
      windowFrom: "2026-01-01",
      windowTo: "2026-01-31",
    }),
    {
      coverageStart: "2026-02-10",
      coverageEnd: "2026-03-27",
      merged: false,
    },
  );
});

test("resolveNextWarmCoverageWindow advances from verified contiguous coverage only", () => {
  assert.deepEqual(
    resolveNextWarmCoverageWindow({
      targetStart: "2026-01-01",
      targetEnd: "2026-03-27",
      contiguousCoverageStart: "2026-02-01",
      contiguousCoverageEnd: "2026-03-27",
      nextCursorDate: "2026-02-01",
    }),
    {
      from: "2026-01-01",
      to: "2026-01-31",
      kind: "initial",
    },
  );
});

test("resolveNextWarmCoverageWindow starts from latest window when nothing is verified", () => {
  assert.deepEqual(
    resolveNextWarmCoverageWindow({
      targetStart: "2026-01-01",
      targetEnd: "2026-03-27",
      contiguousCoverageStart: null,
      contiguousCoverageEnd: null,
      nextCursorDate: null,
    }),
    {
      from: "2026-02-11",
      to: "2026-03-27",
      kind: "initial",
    },
  );
});

test("resolveMassiveFiveMinutePrimaryDateWindow includes latest window on initial loads", () => {
  assert.deepEqual(
    resolveMassiveFiveMinutePrimaryDateWindow({
      mode: "initial",
      historyStart: "2024-03-04",
      dateWindow: {
        from: "2026-02-15",
        to: "2026-03-31",
      },
    }),
    {
      from: "2024-03-04",
      to: "2026-03-31",
    },
  );
});

test("resolveMassiveFiveMinutePrimaryDateWindow preserves requested window outside initial mode", () => {
  assert.deepEqual(
    resolveMassiveFiveMinutePrimaryDateWindow({
      mode: "full",
      historyStart: "2024-03-04",
      dateWindow: {
        from: "2024-03-04",
        to: "2026-03-31",
      },
    }),
    {
      from: "2024-03-04",
      to: "2026-03-31",
    },
  );
  assert.deepEqual(
    resolveMassiveFiveMinutePrimaryDateWindow({
      mode: "chunk",
      historyStart: "2024-03-04",
      dateWindow: {
        from: "2025-12-01",
        to: "2026-01-31",
      },
    }),
    {
      from: "2025-12-01",
      to: "2026-01-31",
    },
  );
});

test("canUseBrokerSpotHistoryFallback only enables broker fallback when a usable adapter is present", () => {
  assert.equal(canUseBrokerSpotHistoryFallback({ account: null, adapter: null }), false);
  assert.equal(canUseBrokerSpotHistoryFallback({ account: { id: "acct" }, adapter: null }), false);
  assert.equal(canUseBrokerSpotHistoryFallback({ account: null, adapter: { getBars() {} } }), false);
  assert.equal(canUseBrokerSpotHistoryFallback({ account: { id: "acct" }, adapter: { getBars() {} } }), true);
});

test("hasCoverageForDateWindow returns true only when cached coverage fully spans the requested range", () => {
  assert.equal(
    hasCoverageForDateWindow({
      coverageStart: "2024-03-04",
      coverageEnd: "2026-04-02",
      from: "2024-03-04",
      to: "2026-04-02",
    }),
    true,
  );
  assert.equal(
    hasCoverageForDateWindow({
      coverageStart: "2024-03-05",
      coverageEnd: "2026-04-02",
      from: "2024-03-04",
      to: "2026-04-02",
    }),
    false,
  );
});
