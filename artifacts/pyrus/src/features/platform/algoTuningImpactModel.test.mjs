import assert from "node:assert/strict";
import test from "node:test";

import { buildAlgoTuningImpact } from "./algoTuningImpactModel.js";

const buildImpact = (optionSelection, candidates) =>
  buildAlgoTuningImpact({
    cockpit: { candidates },
    profile: { optionSelection },
    positions: [],
  });

test("tuning preview excludes 0DTE when execution disables it", () => {
  const candidates = [
    { symbol: "ZERO", dte: 0 },
    { symbol: "ONE", dte: 1 },
  ];

  const disabled = buildImpact(
    { allowZeroDte: false, minDte: 0, maxDte: 1 },
    candidates,
  );
  assert.equal(disabled.dteWindow.count, 1);
  assert.deepEqual(disabled.dteWindow.sampleSymbols, ["ZERO"]);

  const enabled = buildImpact(
    { allowZeroDte: true, minDte: 0, maxDte: 1 },
    candidates,
  );
  assert.equal(enabled.dteWindow.count, 0);
});

test("tuning preview clamps maxDte to the effective minimum", () => {
  const impact = buildImpact(
    { allowZeroDte: false, minDte: 0, maxDte: 0 },
    [
      { symbol: "ZERO", dte: 0 },
      { symbol: "ONE", dte: 1 },
      { symbol: "TWO", dte: 2 },
    ],
  );

  assert.equal(impact.dteWindow.count, 2);
  assert.deepEqual(impact.dteWindow.sampleSymbols, ["ZERO", "TWO"]);
  assert.equal(impact.dteWindow.histogram.thresholdPosition, 0.5);
});
