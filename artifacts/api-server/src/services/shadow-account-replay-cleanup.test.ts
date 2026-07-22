import assert from "node:assert/strict";
import test from "node:test";

import { __shadowWatchlistBacktestInternalsForTests as internals } from "./shadow-account";

const windowStart = new Date("2026-07-08T13:30:00.000Z");
const cleanupEnd = new Date("2026-07-08T20:00:00.000Z");

function replayOrder(sourceEventId: string | null) {
  return {
    source: "signal_options_replay",
    sourceEventId,
    placedAt: new Date("2026-07-08T15:00:00.000Z"),
  } as never;
}

test("legacy replay cleanup fallback requires a deployment-scoped source event", () => {
  const matchingEventIds = new Set(["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]);
  const input = { windowStart, cleanupEnd };

  assert.equal(
    internals.signalOptionsReplayOrderSourceMatchesRange(
      replayOrder("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
      input,
      matchingEventIds,
    ),
    false,
  );
  assert.equal(
    internals.signalOptionsReplayOrderSourceMatchesRange(
      replayOrder(null),
      input,
      matchingEventIds,
    ),
    false,
  );
  assert.equal(
    internals.signalOptionsReplayOrderSourceMatchesRange(
      replayOrder("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
      input,
      matchingEventIds,
    ),
    true,
  );
});
