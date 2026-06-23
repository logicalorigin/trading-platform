import assert from "node:assert/strict";
import test from "node:test";

import { __signalMonitorInternalsForTests } from "./signal-monitor";

const { isSignalMonitorStateCurrentForLane, signalMonitorStreamLaneLatestCompletedBarAt } =
  __signalMonitorInternalsForTests;

// RTH closes 16:00 ET (20:00 UTC); 22:30 UTC is the `after` extended-hours
// session, where Massive still streams aggregates for liquid symbols.
const evaluatedAt = new Date("2026-06-23T22:30:00.000Z");

// A stored `ok` lane whose producer last refreshed it ~29 min ago: the persisted
// 1m bar age (29 min) exceeds the 1m stale window (15 min), so the stored-age
// check alone would relabel it stale. lastEvaluatedAt stays inside the 1m
// evaluation window (30 min) so only the bar-age branch is exercised.
const frozenAfterHoursLane = {
  status: "ok",
  latestBarAt: new Date("2026-06-23T22:01:00.000Z"),
  lastEvaluatedAt: new Date("2026-06-23T22:01:02.000Z"),
};

test("stored-age staleness is rescued when the live ring has a current bar", () => {
  // Massive is still printing this symbol after hours: the ring's latest
  // completed 1m bar closed at 22:30, well inside the stale window.
  const current = isSignalMonitorStateCurrentForLane({
    state: frozenAfterHoursLane,
    timeframe: "1m",
    evaluatedAt,
    streamLatestBarAt: new Date("2026-06-23T22:30:00.000Z"),
  });
  assert.equal(current, true);
});

test("legitimate idle is preserved when the live ring is empty", () => {
  // An illiquid symbol with no after-hours prints: the ring yields nothing, so
  // the lane stays non-current (the read path relabels it idle/stale).
  const current = isSignalMonitorStateCurrentForLane({
    state: frozenAfterHoursLane,
    timeframe: "1m",
    evaluatedAt,
    streamLatestBarAt: null,
  });
  assert.equal(current, false);
});

test("staleness is preserved when the live ring bar is itself stale", () => {
  // The ring's freshest bar is also ~29 min old (no recent prints), so it cannot
  // rescue the lane — genuinely stale data stays stale.
  const current = isSignalMonitorStateCurrentForLane({
    state: frozenAfterHoursLane,
    timeframe: "1m",
    evaluatedAt,
    streamLatestBarAt: new Date("2026-06-23T22:01:00.000Z"),
  });
  assert.equal(current, false);
});

test("a stale ring bar never overrides a fresher persisted bar", () => {
  // A lane that is already current by its persisted bar must not be pushed stale
  // by an older ring bar — the fresher of the two is used.
  const current = isSignalMonitorStateCurrentForLane({
    state: {
      status: "ok",
      latestBarAt: new Date("2026-06-23T22:29:00.000Z"),
      lastEvaluatedAt: new Date("2026-06-23T22:29:02.000Z"),
    },
    timeframe: "1m",
    evaluatedAt,
    streamLatestBarAt: new Date("2026-06-23T22:00:00.000Z"),
  });
  assert.equal(current, true);
});

test("a non-ok stored status is never rescued by the live ring", () => {
  // Producer-determined idle/stale (e.g. a delayed-bar gate) is authoritative;
  // the ring rescue only targets stored-`ok` lanes relabeled by bar age.
  const current = isSignalMonitorStateCurrentForLane({
    state: {
      status: "stale",
      latestBarAt: new Date("2026-06-23T22:29:00.000Z"),
      lastEvaluatedAt: new Date("2026-06-23T22:29:02.000Z"),
    },
    timeframe: "1m",
    evaluatedAt,
    streamLatestBarAt: new Date("2026-06-23T22:30:00.000Z"),
  });
  assert.equal(current, false);
});

test("the 1d timeframe never streams, so the ring lookup returns null", () => {
  // 1d depends on the backfilled base, not the live ring; the lookup must opt
  // out so daily staleness keeps its existing backfill-driven semantics.
  const streamLatestBarAt = signalMonitorStreamLaneLatestCompletedBarAt({
    symbol: "SPY",
    timeframe: "1d",
    evaluatedAt,
  });
  assert.equal(streamLatestBarAt, null);
});
