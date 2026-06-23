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
