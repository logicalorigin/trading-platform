import assert from "node:assert/strict";
import test from "node:test";

import { __flowAggregateInternalsForTests } from "./platform";

const { dedupeAggregateFlowEvents, compareAggregateFlowEventsByRecency } =
  __flowAggregateInternalsForTests;

// One logical trade reported by BOTH the IBKR realtime feed and the Massive
// delayed feed. Today the only thing keeping them distinct in the aggregate
// dedup is that each source happens to set a format-distinct `id`. These events
// omit `id` to model the latent hazard: if an id is ever blank, the composite
// identity (which excludes provider) collapses realtime and delayed into one,
// and a delayed event can silently drop a realtime one.
const sharedContract = {
  underlying: "SPY",
  symbol: "SPY  250620C00500000",
  expirationDate: "2025-06-20",
  strike: 500,
  right: "call",
  side: "buy",
  occurredAt: "2025-06-13T15:00:00.000Z",
  premium: 125000,
  isUnusual: true,
};
const ibkrEvent = { ...sharedContract, provider: "ibkr" };
const massiveEvent = { ...sharedContract, provider: "massive" };

test("dedup never collapses a realtime (IBKR) and a delayed (Massive) event together", () => {
  const deduped = dedupeAggregateFlowEvents([ibkrEvent, massiveEvent]);
  // Both must survive: cross-provider collision must not drop either source.
  assert.equal(deduped.length, 2);
  const providers = deduped
    .map((event) => (event as { provider: string }).provider)
    .sort();
  assert.deepEqual(providers, ["ibkr", "massive"]);
});

test("two IBKR events with the same id still dedupe (no behavior change within a provider)", () => {
  const a = { ...sharedContract, provider: "ibkr", id: "SPY-1718290800000" };
  const b = { ...sharedContract, provider: "ibkr", id: "SPY-1718290800000" };
  assert.equal(dedupeAggregateFlowEvents([a, b]).length, 1);
});

test("at equal recency and premium, realtime (IBKR) is ordered ahead of delayed (Massive)", () => {
  const sorted = [massiveEvent, ibkrEvent].sort(compareAggregateFlowEventsByRecency);
  assert.equal((sorted[0] as { provider: string }).provider, "ibkr");
  assert.equal((sorted[1] as { provider: string }).provider, "massive");
});
