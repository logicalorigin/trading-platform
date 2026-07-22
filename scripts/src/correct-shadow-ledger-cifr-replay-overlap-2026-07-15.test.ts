import assert from "node:assert/strict";
import test from "node:test";

import { __shadowLedgerCifrReplayOverlapCorrection20260715InternalsForTests as internals } from "./correct-shadow-ledger-cifr-replay-overlap-2026-07-15";

test("CIFR overlap correction is import-safe and defaults to dry-run", () => {
  const previous = process.env.SHADOW_LEDGER_CORRECTION_MODE;
  delete process.env.SHADOW_LEDGER_CORRECTION_MODE;
  try {
    assert.equal(internals.mode(), "dry-run");
    assert.equal(
      internals.CORRECTION_ID,
      "c1f2026f-0715-4e18-9453-048100000001",
    );
    assert.equal(
      internals.TOMBSTONE_POSITION_ID,
      "c1f2026f-0715-4e18-9453-048100000002",
    );
    assert.equal(
      internals.PRIOR_CORRECTION_ID,
      "ddf5e2af-ab87-4edc-9029-6d5ae9061bd7",
    );
  } finally {
    if (previous === undefined) delete process.env.SHADOW_LEDGER_CORRECTION_MODE;
    else process.env.SHADOW_LEDGER_CORRECTION_MODE = previous;
  }
});

test("CIFR overlap correction accepts only explicit dry-run or apply modes", () => {
  const previous = process.env.SHADOW_LEDGER_CORRECTION_MODE;
  try {
    process.env.SHADOW_LEDGER_CORRECTION_MODE = "apply";
    assert.equal(internals.mode(), "apply");
    process.env.SHADOW_LEDGER_CORRECTION_MODE = "reconcile";
    assert.throws(() => internals.mode(), /must be dry-run or apply/);
  } finally {
    if (previous === undefined) delete process.env.SHADOW_LEDGER_CORRECTION_MODE;
    else process.env.SHADOW_LEDGER_CORRECTION_MODE = previous;
  }
});

test("CIFR overlap correction plan balances exact replacement economics", () => {
  assert.deepEqual(internals.validatePlan(), {
    invalidLifecycleEventCount: 2,
    invalidMarkEventCount: 3,
    invalidOrderCount: 2,
    preservedFillCount: 2,
    retainedPhysicalMarkCount: 30,
    reparentedPhysicalMarkCount: 2,
    replacementCashDelta: -278.8,
    replacementRealizedPnl: -271.4,
    replacementFees: 14.8,
    correctionCashDelta: 278.8,
    correctionRealizedPnlDelta: 271.4,
    correctionFeesDelta: -14.8,
    expectedBefore: {
      cash: 154950.6755,
      realizedPnl: 130742.0755,
      fees: 5456.88,
    },
    expectedAfter: {
      cash: 155229.4755,
      realizedPnl: 131013.4755,
      fees: 5442.08,
    },
    restoredPosition: {
      averageCost: 0.86,
      mark: 0.99,
      realizedPnl: -102.8,
      fees: 29.6,
      openedAt: "2026-07-15T17:50:53.396Z",
      closedAt: "2026-07-15T18:45:30.481Z",
    },
  });
});

test("CIFR overlap correction exposes only sourced replay quote facts", () => {
  assert.deepEqual(internals.REPLAY_EVIDENCE, {
    source: "Massive historical quote replay",
    asOf: "2026-07-15T18:45:30.481Z",
    entryPrice: 0.86,
    exitPrice: 0.99,
    quantity: 11,
    multiplier: 100,
    peakPrice: 1.18,
    bid: 0.93,
    ask: 1.04,
    mark: 0.985,
    stopPrice: 0.99,
    reason: "runner_trail_stop",
    grossPnl: 143,
    exitFees: 7.4,
    fillRealizedPnl: 135.6,
    exitCashDelta: 1081.6,
  });
  assert.equal("last" in internals.REPLAY_EVIDENCE, false);
  assert.equal("greeks" in internals.REPLAY_EVIDENCE, false);
});
