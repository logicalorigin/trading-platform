import assert from "node:assert/strict";
import test from "node:test";

import { rebaseAccountReturnPercentSeries } from "./EquityCurvePanel.jsx";

// Return % mode plots the account line rebased to 0% at the window start so it
// shares the benchmark baseline (joinBenchmarkPercentSeries) and percent axis.
test("Return % mode rebases the account return to 0% at window start", () => {
  const out = rebaseAccountReturnPercentSeries([
    { returnPercent: 5 },
    { returnPercent: null },
    { returnPercent: 8.5 },
    { returnPercent: 2 },
  ]);
  assert.equal(out[0], 0, "first point is the 0% baseline");
  assert.deepEqual(out, [0, null, 3.5, -3]);
});

test("baseline is the first finite return, mirroring benchmark rebasing", () => {
  const out = rebaseAccountReturnPercentSeries([
    { returnPercent: null },
    { returnPercent: 10 },
    { returnPercent: 12 },
  ]);
  assert.deepEqual(out, [null, 0, 2]);
});

test("all-null return series passes through without a baseline", () => {
  assert.deepEqual(rebaseAccountReturnPercentSeries([{}, {}]), [null, null]);
});
