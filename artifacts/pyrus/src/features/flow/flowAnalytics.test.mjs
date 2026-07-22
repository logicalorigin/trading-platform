import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFlowClockFromEvents,
  buildFlowTideFromEvents,
} from "./flowAnalytics.js";

const event = (occurredAt, cp = "C", premium = 100) => ({
  occurredAt,
  cp,
  premium,
});

test("flow session buckets use New York RTH across standard and daylight time", () => {
  const clock = buildFlowClockFromEvents([
    event("2026-01-20T14:30:00.000Z"),
    event("2026-07-20T13:30:00.000Z"),
    event("2026-07-20T19:45:00.000Z"),
  ]);

  assert.equal(clock.length, 13);
  assert.equal(clock[0].time, "9:30a");
  assert.equal(clock[0].count, 2);
  assert.equal(clock.at(-1).time, "3:30p");
  assert.equal(clock.at(-1).count, 1);
});

test("flow session buckets exclude missing, invalid, and non-RTH timestamps", () => {
  const events = [
    event(undefined),
    event("not-a-date"),
    event("2026-07-20T13:00:00.000Z"),
    event("2026-07-20T20:30:00.000Z"),
    event("2026-07-18T15:00:00.000Z"),
    event("2026-11-27T18:30:00.000Z"),
  ];

  assert.equal(
    buildFlowClockFromEvents(events).reduce((sum, bucket) => sum + bucket.count, 0),
    0,
  );
  assert.equal(
    buildFlowTideFromEvents(events).reduce(
      (sum, bucket) => sum + bucket.calls + bucket.puts,
      0,
    ),
    0,
  );
});
