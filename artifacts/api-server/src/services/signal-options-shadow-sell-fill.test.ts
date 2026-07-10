import assert from "node:assert/strict";
import test from "node:test";

import {
  signalOptionsShadowSellFillPrice,
  SIGNAL_OPTIONS_DEGENERATE_SELL_GAP_FRACTION,
} from "./signal-options-automation";

// Regression for the daily-loss-halt corruption (2026-07-09): a pathologically
// wide, non-executable option quote must NOT book a near-bid "fill" as a phantom
// realized loss. The BRKR case had a live quote bid 2.05 / ask 5.80 / mid 3.925
// (~96%-of-mid spread); the near-bid model filled the exit at 2.24 on a position
// that trailed out well in profit, booking pnl (2.24-3.65)*4*100 = -564 and
// inflating the day's realized loss that feeds computeSignalOptionsDailyRealizedPnl.

test("normal spread keeps the unchanged near-bid sell model (mid - 90% of mid->bid gap)", () => {
  // bid 3.50, mid 3.70 -> 3.70 - 0.9*0.20 = 3.52
  assert.equal(signalOptionsShadowSellFillPrice(3.7, 3.5, 3.7), 3.52);
});

test("moderately wide but executable spread stays on the near-bid model", () => {
  // gap (4.0-3.0)/4.0 = 25% < 40% -> near-bid: 4.0 - 0.9*1.0 = 3.10
  assert.equal(signalOptionsShadowSellFillPrice(4.0, 3.0, 4.0), 3.1);
});

test("degenerate spread (BRKR) falls back to the mid, not the near-bid", () => {
  // bid 2.05 / mid 3.925 -> gap 47.8% > 40% -> mid, NOT the old 2.24
  const fill = signalOptionsShadowSellFillPrice(3.925, 2.05, 3.925);
  assert.notEqual(fill, 2.24, "must not book the phantom near-bid fill");
  assert.ok(fill >= 3.9, `expected ~mid (3.925), got ${fill}`);
  // Realized pnl for the trade (entry 3.65, qty 4, standard 100x) flips from the
  // phantom -564 to a non-loss consistent with the mid-based unrealized P&L.
  const pnl = Number(((fill - 3.65) * 4 * 100).toFixed(2));
  assert.ok(pnl > 0, `expected non-loss realized pnl, got ${pnl}`);
});

test("null / non-positive bid falls back to the provided fallback price", () => {
  // 3.925.toFixed(2) === "3.92" (float), so the rounded fallback is 3.92.
  assert.equal(signalOptionsShadowSellFillPrice(3.925, null, 3.925), 3.92);
  assert.equal(signalOptionsShadowSellFillPrice(3.925, 0, 3.925), 3.92);
  assert.equal(signalOptionsShadowSellFillPrice(3.925, -1, 3.7), 3.7);
});

test("null / non-positive mid falls back to the provided fallback price", () => {
  assert.equal(signalOptionsShadowSellFillPrice(null, 2.05, 4.1), 4.1);
  assert.equal(signalOptionsShadowSellFillPrice(0, 2.05, 4.1), 4.1);
});

test("threshold boundary is exactly 40% of mid (inclusive stays near-bid)", () => {
  assert.equal(SIGNAL_OPTIONS_DEGENERATE_SELL_GAP_FRACTION, 0.4);
  // gap exactly 40% -> not degenerate (uses strict >) -> near-bid 10 - 0.9*4 = 6.4
  assert.equal(signalOptionsShadowSellFillPrice(10, 6, 10), 6.4);
  // gap just over 40% -> degenerate -> mid
  assert.equal(signalOptionsShadowSellFillPrice(10, 5.9, 10), 10);
});
