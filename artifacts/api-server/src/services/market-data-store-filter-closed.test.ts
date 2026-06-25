import assert from "node:assert/strict";
import { test } from "node:test";

import {
  filterClosedBarsForStore,
  type MarketDataStoreBarInput,
  type MarketDataStoreTimeframe,
} from "./market-data-store";

// Pure unit test for the forming-bar filter wired into the HTTP /bars persist path
// (services/platform.ts). It drops the still-forming (open) bucket from the write so
// concurrent fetches stop re-upserting that one hot row; closed buckets persist as
// before. `now` is injected for determinism.

function bar(timestampIso: string): MarketDataStoreBarInput {
  return {
    timestamp: new Date(timestampIso),
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: 1,
  };
}

test("keeps closed buckets, drops the still-forming bucket (1m)", () => {
  // now sits exactly on a minute boundary so we can assert the inclusive edge:
  // a bar whose bucket ENDS exactly at now counts as closed.
  const now = new Date("2026-06-24T15:31:00.000Z");
  const closedOld = bar("2026-06-24T15:28:00.000Z"); // bucket ends 15:29 < now -> closed
  const closedEdge = bar("2026-06-24T15:30:00.000Z"); // bucket ends 15:31 == now -> closed
  const forming = bar("2026-06-24T15:31:00.000Z"); // bucket ends 15:32 > now -> forming

  const kept = filterClosedBarsForStore(
    [closedOld, closedEdge, forming],
    "1m",
    now,
  );

  assert.deepEqual(
    kept.map((b) => b.timestamp.toISOString()),
    [closedOld, closedEdge].map((b) => b.timestamp.toISOString()),
    "the forming bar is dropped; both closed bars (incl. the exact boundary) are kept",
  );
});

test("unknown timeframe passes all bars through unchanged", () => {
  const now = new Date("2026-06-24T15:31:00.000Z");
  const forming = bar("2026-06-24T15:31:00.000Z");
  // "3m" is not a real MarketDataStoreTimeframe / has no TIMEFRAME_STEP_MS entry — the
  // cast deliberately exercises the defensive "no bucket math -> persist all" branch.
  const kept = filterClosedBarsForStore(
    [forming],
    "3m" as MarketDataStoreTimeframe,
    now,
  );
  assert.equal(kept.length, 1, "no step => no filtering, behavior unchanged");
});

test("coarse timeframes (>1h) persist all bars — UTC bucket != session close", () => {
  // A US-session daily bar is final ~20:00 UTC but its UTC-grid bucket only "closes"
  // at 00:00 UTC the next day. The filter must NOT treat it as forming/drop it — that
  // would withhold today's finalized daily bar from durable storage for hours. So 1d
  // (and any step > 1h) passes through unchanged regardless of `now`.
  const now = new Date("2026-06-24T20:30:00.000Z"); // after session close, before UTC rollover
  const todaysDailyBar = bar("2026-06-24T00:00:00.000Z"); // bucket ends 2026-06-25 00:00 UTC > now
  const kept = filterClosedBarsForStore([todaysDailyBar], "1d", now);
  assert.equal(kept.length, 1, "coarse-timeframe open bucket is kept, not dropped");
});
