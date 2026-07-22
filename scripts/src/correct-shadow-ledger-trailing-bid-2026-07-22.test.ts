import assert from "node:assert/strict";
import test from "node:test";

import { __trailingBidCorrectionInternals as internals } from "./correct-shadow-ledger-trailing-bid-2026-07-22";

const quote = (input: {
  at: string;
  bid: number;
  ask: number;
  sequenceNumber: number;
}) =>
  ({
    bid: input.bid,
    ask: input.ask,
    bidSize: 10,
    askSize: 20,
    sequenceNumber: input.sequenceNumber,
    occurredAt: new Date(input.at),
  }) as never;

test("trailing-bid correction is import-safe and defaults to dry-run", () => {
  const previous = process.env.SHADOW_TRAILING_BID_CORRECTION_MODE;
  delete process.env.SHADOW_TRAILING_BID_CORRECTION_MODE;
  try {
    assert.equal(internals.readMode(), "dry-run");
    assert.equal(
      internals.CORRECTION_ID,
      "41b8f7e5-4b26-4d04-b7bd-3a9ba4d923e4",
    );
  } finally {
    if (previous === undefined) {
      delete process.env.SHADOW_TRAILING_BID_CORRECTION_MODE;
    } else {
      process.env.SHADOW_TRAILING_BID_CORRECTION_MODE = previous;
    }
  }
});

test("trailing-bid correction accepts only explicit dry-run or apply modes", () => {
  const previous = process.env.SHADOW_TRAILING_BID_CORRECTION_MODE;
  try {
    process.env.SHADOW_TRAILING_BID_CORRECTION_MODE = "apply";
    assert.equal(internals.readMode(), "apply");
    process.env.SHADOW_TRAILING_BID_CORRECTION_MODE = "yes";
    assert.throws(() => internals.readMode(), /must be dry-run or apply/);
  } finally {
    if (previous === undefined) {
      delete process.env.SHADOW_TRAILING_BID_CORRECTION_MODE;
    } else {
      process.env.SHADOW_TRAILING_BID_CORRECTION_MODE = previous;
    }
  }
});

test("profit retracement applies only to profit above entry and honors its floor", () => {
  assert.equal(
    internals.computeProfitRetraceStop({
      entryPrice: 2.34,
      peakPrice: 2.85,
      retracementPct: 30,
      minLockedGainPct: 0,
    }),
    2.7,
  );
  assert.equal(
    internals.computeProfitRetraceStop({
      entryPrice: 1.59,
      peakPrice: 2.27,
      retracementPct: 25,
      minLockedGainPct: 15,
    }),
    2.1,
  );
});

test("two distinct bid observations elect the audited stop and an intervening recovery resets it", () => {
  const confirmation = internals.findEarliestBidConfirmation({
    quotes: [
      quote({ at: "2026-07-22T15:20:23.100Z", bid: 9, ask: 11, sequenceNumber: 1 }),
      quote({ at: "2026-07-22T15:20:23.150Z", bid: 9.2, ask: 11, sequenceNumber: 2 }),
      quote({ at: "2026-07-22T15:20:23.200Z", bid: 9, ask: 11, sequenceNumber: 3 }),
      quote({ at: "2026-07-22T15:20:23.250Z", bid: 9, ask: 11, sequenceNumber: 4 }),
    ],
    from: new Date("2026-07-22T15:20:23.000Z"),
    stopPrice: 9.14,
  });

  assert.deepEqual(
    confirmation?.map((item) => [item.sequenceNumber, item.bid]),
    [
      [3, 9],
      [4, 9],
    ],
  );
});

test("mark plan converts only provable midpoint rows, preserves bids, and removes post-exit rows", () => {
  const spec = internals.corrections[0];
  const plan = internals.buildMarkPlan({
    spec,
    quotes: [
      quote({ at: "2026-07-22T13:30:00.000Z", bid: 1, ask: 3, sequenceNumber: 1 }),
      quote({ at: "2026-07-22T13:31:00.000Z", bid: 1.5, ask: 2.5, sequenceNumber: 2 }),
    ],
    marks: [
      {
        id: "00000000-0000-4000-8000-000000000001",
        mark: 2,
        marketValue: 1_200,
        unrealizedPnl: -204,
        source: "automation",
        asOf: new Date("2026-07-22T13:30:01.000Z"),
      },
      {
        id: "00000000-0000-4000-8000-000000000002",
        mark: 1.5,
        marketValue: 900,
        unrealizedPnl: -504,
        source: "automation",
        asOf: new Date("2026-07-22T13:31:01.000Z"),
      },
      {
        id: "00000000-0000-4000-8000-000000000003",
        mark: 1.1,
        marketValue: 660,
        unrealizedPnl: -744,
        source: "automation",
        asOf: new Date(spec.evidence[1].at),
      },
    ],
  });

  assert.deepEqual(
    plan.updates.map((mark) => ({
      id: mark.id,
      mark: mark.mark,
      marketValue: mark.marketValue,
      unrealizedPnl: mark.unrealizedPnl,
      source: mark.source,
    })),
    [
      {
        id: "00000000-0000-4000-8000-000000000001",
        mark: 1,
        marketValue: 600,
        unrealizedPnl: -804,
        source: "ledger_correction_executable_bid",
      },
    ],
  );
  assert.deepEqual(
    plan.removals.map((mark) => mark.id),
    ["00000000-0000-4000-8000-000000000003"],
  );
});

test("replacement economics are pinned to the second confirming executable bid", () => {
  assert.deepEqual(
    internals.corrections.map((spec) => ({
      symbol: spec.symbol,
      ...internals.replacementEconomics(spec),
    })),
    [
      {
        symbol: "ABT",
        price: 1.1,
        grossAmount: 660,
        grossPnl: -744,
        fees: 4.04,
        cashDelta: 655.96,
        realizedPnl: -748.04,
      },
      {
        symbol: "AA",
        price: 2.08,
        grossAmount: 1_872,
        grossPnl: 441,
        fees: 6.06,
        cashDelta: 1_865.94,
        realizedPnl: 434.94,
      },
      {
        symbol: "COF",
        price: 9,
        grossAmount: 1_800,
        grossPnl: 368,
        fees: 1.35,
        cashDelta: 1_798.65,
        realizedPnl: 366.65,
      },
    ],
  );
});
