import assert from "node:assert/strict";
import test from "node:test";

import { __shadowLedgerLateEntryCorrection20260714InternalsForTests as internals } from "./correct-shadow-ledger-late-entries-2026-07-14";

test("late-entry correction is import-safe and defaults to dry-run", () => {
  const previous = process.env.SHADOW_LEDGER_CORRECTION_MODE;
  delete process.env.SHADOW_LEDGER_CORRECTION_MODE;
  try {
    assert.equal(internals.mode(), "dry-run");
    assert.equal(
      internals.CORRECTION_ID,
      "617e750e-3d35-4e0d-8394-1582a4404379",
    );
    assert.deepEqual(
      internals.LIFECYCLES.map((item) => [item.symbol, item.positionStrategy]),
      [
        ["BABA", "tombstone_unique"],
        ["A", "tombstone_unique"],
        ["BA", "subtract_reused"],
        ["BABA", "restore_prior"],
      ],
    );
    assert.equal(internals.BABA_MARK_EVENT_COUNT, 133);
    assert.equal(
      internals.BABA_MARK_EVENT_ID_SHA256,
      "dd3b6bc575277bbf471ccbe8047c31692096ffeb7a9c093fb9d2f47edef83242",
    );
    assert.equal(
      internals.INVALID_BABA_POSITION_ID,
      "c829a4a8-7763-4303-a494-0063777e72d3",
    );
    assert.equal(
      internals.INVALID_BABA_POSITION_KEY,
      "shadow_equity_forward:ledger_correction:617e750e-3d35-4e0d-8394-1582a4404379:invalid_lifecycle:option:BABA:2026-07-17:112:call:O:BABA260717C00112000",
    );
    assert.equal(internals.INVALID_BABA_PHYSICAL_MARK_COUNT, 228);
    assert.equal(
      internals.INVALID_BABA_PHYSICAL_MARK_ID_SHA256,
      "b5ee9da75b34d58b96903699331fd116ee311ea56076127e04b0fc11bf210411",
    );
    assert.deepEqual(
      [
        internals.RETAINED_BABA_LIFECYCLE.entry.eventId,
        internals.RETAINED_BABA_LIFECYCLE.entry.orderId,
        internals.RETAINED_BABA_LIFECYCLE.entry.fillId,
        internals.RETAINED_BABA_LIFECYCLE.exit.eventId,
        internals.RETAINED_BABA_LIFECYCLE.exit.orderId,
        internals.RETAINED_BABA_LIFECYCLE.exit.fillId,
      ],
      [
        "38ee4681-77d4-4300-9382-8c62623725fc",
        "0f4edfea-a487-407a-a146-b103cf6a9c56",
        "30414e9d-14d2-4bd1-96a7-37d332f8ced3",
        "94538e0f-66eb-497c-98d5-f677848ef2ec",
        "6e665167-8969-45f8-9065-a161d36746f1",
        "02c8d498-1e79-4d07-a66f-6d159f9bcf62",
      ],
    );
    assert.deepEqual(
      [
        internals.RETAINED_BABA_LIFECYCLE.entry.side,
        internals.RETAINED_BABA_LIFECYCLE.entry.occurredAt,
        internals.RETAINED_BABA_LIFECYCLE.entry.price,
        internals.RETAINED_BABA_LIFECYCLE.entry.grossAmount,
        internals.RETAINED_BABA_LIFECYCLE.entry.fees,
        internals.RETAINED_BABA_LIFECYCLE.entry.realizedPnl,
        internals.RETAINED_BABA_LIFECYCLE.entry.cashDelta,
        internals.RETAINED_BABA_LIFECYCLE.exit.side,
        internals.RETAINED_BABA_LIFECYCLE.exit.occurredAt,
        internals.RETAINED_BABA_LIFECYCLE.exit.price,
        internals.RETAINED_BABA_LIFECYCLE.exit.grossAmount,
        internals.RETAINED_BABA_LIFECYCLE.exit.fees,
        internals.RETAINED_BABA_LIFECYCLE.exit.realizedPnl,
        internals.RETAINED_BABA_LIFECYCLE.exit.cashDelta,
      ],
      [
        "buy",
        "2026-07-14T15:51:27.732Z",
        2.74,
        1370,
        3.36,
        0,
        -1373.36,
        "sell",
        "2026-07-14T19:45:01.020Z",
        2.32,
        1160,
        3.36,
        -213.36,
        1156.64,
      ],
    );
  } finally {
    if (previous === undefined) delete process.env.SHADOW_LEDGER_CORRECTION_MODE;
    else process.env.SHADOW_LEDGER_CORRECTION_MODE = previous;
  }
});

test("late-entry correction accepts only explicit dry-run or apply modes", () => {
  const previous = process.env.SHADOW_LEDGER_CORRECTION_MODE;
  try {
    process.env.SHADOW_LEDGER_CORRECTION_MODE = "apply";
    assert.equal(internals.mode(), "apply");
    process.env.SHADOW_LEDGER_CORRECTION_MODE = "yes-really";
    assert.throws(() => internals.mode(), /must be dry-run or apply/);
  } finally {
    if (previous === undefined) delete process.env.SHADOW_LEDGER_CORRECTION_MODE;
    else process.env.SHADOW_LEDGER_CORRECTION_MODE = previous;
  }
});

test("late-entry correction plan balances exact lifecycle economics", () => {
  assert.deepEqual(internals.validatePlan(), {
    eventCount: 8,
    orderCount: 8,
    fillCount: 8,
    retainedEventCount: 2,
    retainedOrderCount: 2,
    retainedFillCount: 2,
    invalidBabaPhysicalMarkCount: 228,
    recordedCashDelta: 2266.8,
    recordedRealizedPnl: 2278.9,
    recordedFees: 24.2,
    correctionCashDelta: -2266.8,
    correctionRealizedPnlDelta: -2278.9,
    correctionFeesDelta: -24.2,
  });
});
