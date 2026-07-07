import assert from "node:assert/strict";
import test from "node:test";

import {
  getCurrentSignalDirection,
  hasCurrentSignalDirection,
} from "./signalStateFreshness.js";

test("signal direction falls back to persisted trend for hydrated display cells", () => {
  const state = {
    status: "ok",
    active: true,
    currentSignalDirection: null,
    trendDirection: "bullish",
    latestBarAt: "2026-06-23T17:58:00.000Z",
  };

  assert.equal(getCurrentSignalDirection(state), "buy");
  assert.equal(hasCurrentSignalDirection(state), true);
});

test("signal direction falls back to indicator snapshot trend for stream cells", () => {
  const state = {
    status: "stale",
    active: true,
    currentSignalDirection: null,
    indicatorSnapshot: { trendDirection: "bearish" },
    latestBarAt: "2026-06-23T17:58:00.000Z",
  };

  assert.equal(getCurrentSignalDirection(state), "sell");
});

test("problem states do not render trend fallback directions", () => {
  const state = {
    status: "unavailable",
    active: true,
    currentSignalDirection: null,
    trendDirection: "bullish",
    latestBarAt: "2026-06-23T17:58:00.000Z",
  };

  assert.equal(getCurrentSignalDirection(state), "");
});

test("signal direction follows the crossover, not the seed-bullish trend, when they diverge", () => {
  // The mixed-MTF bug: a decliner fires a SELL crossover but the basisLength=80
  // trend still reads bullish. The display must follow the crossover (arrow
  // down), not the lagging trend, so a SHORT row's MTF cells never render as
  // bullish up-arrows.
  const state = {
    status: "ok",
    active: true,
    currentSignalDirection: "sell",
    trendDirection: "bullish",
    fresh: true,
    latestBarAt: "2026-06-23T17:58:00.000Z",
  };

  assert.equal(getCurrentSignalDirection(state), "sell");
});
