import assert from "node:assert/strict";
import test from "node:test";

import { freshnessUnchanged, isStreamFresh } from "./streamFreshness";

const THRESHOLD = 5_000;

test("isStreamFresh: null timestamp is never fresh", () => {
  assert.equal(isStreamFresh(null, 10_000, THRESHOLD), false);
});

test("isStreamFresh: fresh exactly at the threshold boundary", () => {
  const now = 10_000;
  assert.equal(isStreamFresh(now - THRESHOLD, now, THRESHOLD), true);
});

test("isStreamFresh: just inside the window is fresh, just past it is stale (the flip)", () => {
  const now = 10_000;
  assert.equal(isStreamFresh(now - (THRESHOLD - 1), now, THRESHOLD), true);
  assert.equal(isStreamFresh(now - (THRESHOLD + 1), now, THRESHOLD), false);
});

test("isStreamFresh: a future-ish timestamp (just-arrived event) is fresh", () => {
  assert.equal(isStreamFresh(10_000, 10_000, THRESHOLD), true);
});

// The re-render gate: equal snapshot => the hook returns prev (React bails out,
// no re-render); any changed field => returns next (re-render). This is what
// makes the once-per-second staleness poll commit only on an actual flip.
test("freshnessUnchanged: identical snapshots are unchanged (no re-render)", () => {
  const prev = { accountFresh: true, accountPrimaryFresh: false, accountLastEventAt: 1 };
  const next = { accountFresh: true, accountPrimaryFresh: false, accountLastEventAt: 1 };
  assert.equal(freshnessUnchanged(prev, next), true);
});

test("freshnessUnchanged: a flipped boolean is a change (re-render)", () => {
  const prev = { accountFresh: true, accountPrimaryFresh: false, accountLastEventAt: 1 };
  const next = { accountFresh: false, accountPrimaryFresh: false, accountLastEventAt: 1 };
  assert.equal(freshnessUnchanged(prev, next), false);
});

test("freshnessUnchanged: a changed timestamp is a change (re-render)", () => {
  const prev = { accountFresh: true, accountLastEventAt: 1 };
  const next = { accountFresh: true, accountLastEventAt: 2 };
  assert.equal(freshnessUnchanged(prev, next), false);
});

// End-to-end of the poll decision: simulate the once-per-second recompute over a
// stream that goes quiet. It must stay "unchanged" every tick until the threshold
// is crossed, then report exactly one change (fresh -> stale).
test("staleness poll: unchanged each second until the threshold crossing, then one flip", () => {
  const lastEventAt = 0;
  let prev = { fresh: isStreamFresh(lastEventAt, 0, THRESHOLD) };
  assert.equal(prev.fresh, true);

  const changes: number[] = [];
  for (let nowMs = 1_000; nowMs <= 10_000; nowMs += 1_000) {
    const next = { fresh: isStreamFresh(lastEventAt, nowMs, THRESHOLD) };
    if (!freshnessUnchanged(prev, next)) {
      changes.push(nowMs);
      prev = next;
    }
  }

  // Exactly one commit across 10 polls, at the first tick past the threshold.
  assert.deepEqual(changes, [6_000]);
  assert.equal(prev.fresh, false);
});
