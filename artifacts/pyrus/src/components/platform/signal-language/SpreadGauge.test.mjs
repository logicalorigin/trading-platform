import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveSpreadWidthFraction,
  spreadGaugeTone,
  spreadThresholdScaleForDte,
} from "./SpreadGauge.jsx";
import { SPREAD_WIDE_PCT } from "./thresholds.js";
import { getTone } from "./tones.js";

test("spread DTE scale is 1 at/under the 21d baseline and for non-finite tenor", () => {
  assert.equal(spreadThresholdScaleForDte(5), 1);
  assert.equal(spreadThresholdScaleForDte(21), 1);
  assert.equal(spreadThresholdScaleForDte(undefined), 1);
  assert.equal(spreadThresholdScaleForDte(Number.NaN), 1);
});

test("spread DTE scale widens roughly linearly with tenor and caps at 4x", () => {
  assert.equal(spreadThresholdScaleForDte(131), 2); // 1 + (131 - 21) / 110
  assert.equal(spreadThresholdScaleForDte(100000), 4); // capped at SPREAD_DTE_MAX_SCALE
});

test("a structurally wide LEAP spread reads warn, while the same spread on a weekly reads sell", () => {
  const wideForWeekly = SPREAD_WIDE_PCT * 1.5; // above the weekly wide band, inside the LEAP band
  assert.equal(spreadGaugeTone(wideForWeekly, 5), getTone("sell"));
  assert.equal(spreadGaugeTone(wideForWeekly, 200), getTone("warn"));
});

test("spread tone falls back to the dim tone when the width is non-finite", () => {
  assert.equal(spreadGaugeTone(undefined, 200), getTone("dim"));
  assert.equal(spreadGaugeTone(Number.NaN, 200), getTone("dim"));
});

test("spread width stays unavailable when either quote side is absent", () => {
  assert.equal(resolveSpreadWidthFraction({ bid: null, ask: 1, mid: 0.5 }), null);
  assert.equal(resolveSpreadWidthFraction({ bid: 1, ask: null, mid: 1.05 }), null);
  assert.equal(resolveSpreadWidthFraction({ bid: "", ask: 1, mid: 0.5 }), null);
  assert.equal(resolveSpreadWidthFraction({ bid: 1, ask: "", mid: 1.05 }), null);
});

test("spread width stays unavailable for a crossed quote", () => {
  assert.equal(resolveSpreadWidthFraction({ bid: 1.1, ask: 1, mid: 1.05 }), null);
});
