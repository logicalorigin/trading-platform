import assert from "node:assert/strict";
import test from "node:test";

import { scoreOptionGreekCandidate } from "./option-greek-selector";

// The greek scorer must never RANK a no-directional-exposure contract as
// selectable. Regression for the DIA 471P @ spot ~521.8 lottery-ticket entry
// (|delta| ~= 0): before this, deltaFit floored at 0 and the ivValue+dataQuality
// baseline floated it to a positive total that cleared minScore:0.
test("disqualifies a near-zero-delta contract (negative total, below_min_tradeable_delta)", () => {
  const score = scoreOptionGreekCandidate({
    right: "put",
    spot: 521.8,
    strike: 471,
    entryPrice: 0.04,
    volume: 0,
    greeks: {
      price: 0.04,
      delta: -0.00003,
      gamma: 0.0000085,
      theta: -0.000076,
      vega: 0.000043,
      impliedVolatility: 0.45,
      timeToExpirationYears: 2 / 365,
    },
  });
  assert.ok(score.total < 0, `expected negative total, got ${score.total}`);
  assert.ok(score.notes.includes("below_min_tradeable_delta"));
});

test("keeps a healthy near-ATM contract selectable (positive total, not disqualified)", () => {
  const score = scoreOptionGreekCandidate({
    right: "call",
    spot: 100,
    strike: 100,
    entryPrice: 2.5,
    volume: 200,
    greeks: {
      price: 2.5,
      delta: 0.5,
      gamma: 0.05,
      theta: -0.05,
      vega: 0.1,
      impliedVolatility: 0.3,
      timeToExpirationYears: 0.02,
    },
  });
  assert.ok(score.total > 0, `expected positive total, got ${score.total}`);
  assert.ok(!score.notes.includes("below_min_tradeable_delta"));
});
