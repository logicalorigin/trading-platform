import assert from "node:assert/strict";
import test from "node:test";

import {
  signalOptionsShadowSellFillPrice,
} from "./signal-options-automation";

// A shadow market sell cannot book proceeds above the executable bid. Open option
// marks and stop elections use that same bid, so using midpoint-derived proceeds
// would recreate the P&L/stop-basis mismatch this path is meant to prevent.

test("normal-spread shadow sells fill at the executable bid", () => {
  assert.equal(signalOptionsShadowSellFillPrice(3.7, 3.5, 3.7), 3.5);
});

test("wide spreads cannot fall back to a non-executable midpoint fill", () => {
  assert.equal(signalOptionsShadowSellFillPrice(3.925, 2.05, 3.925), 2.05);
});

test("a valid bid remains authoritative when midpoint is unavailable", () => {
  assert.equal(signalOptionsShadowSellFillPrice(null, 2.05, 4.1), 2.05);
  assert.equal(signalOptionsShadowSellFillPrice(0, 2.05, 4.1), 2.05);
});

test("null / non-positive bid falls back to the provided fallback price", () => {
  // 3.925.toFixed(2) === "3.92" (float), so the rounded fallback is 3.92.
  assert.equal(signalOptionsShadowSellFillPrice(3.925, null, 3.925), 3.92);
  assert.equal(signalOptionsShadowSellFillPrice(3.925, 0, 3.925), 3.92);
  assert.equal(signalOptionsShadowSellFillPrice(3.925, -1, 3.7), 3.7);
});

test("midpoint and fallback cannot improve a valid bid", () => {
  assert.equal(signalOptionsShadowSellFillPrice(10, 6, 10), 6);
  assert.equal(signalOptionsShadowSellFillPrice(10, 5.9, 10), 5.9);
});
