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

// gammaTheta must be dimensionless: premium-fraction gained from gamma on a 1%
// underlying move vs premium-fraction lost to one day of theta. Two contracts with
// identical premium-relative gamma efficiency and theta burden must earn the same
// component regardless of the underlying's price level. (The old dollars-vs-fraction
// ratio saturated every ~$600-underlying candidate at 15 pts and starved ~$20 ones.)
test("gammaTheta is spot-level invariant for equal premium-relative efficiency", () => {
  // Both candidates: gamma premium-fraction on a 1% move = 0.025, theta burn 5%/day
  // → ratio 0.5 → exactly half of the 15-pt component.
  const low = scoreOptionGreekCandidate({
    right: "call",
    spot: 20,
    strike: 20,
    entryPrice: 0.5,
    volume: 200,
    greeks: {
      price: 0.5,
      delta: 0.5,
      gamma: 0.3125, // (0.3125 × 20² × 1e-4) / 0.5 = 0.025
      theta: -0.025, // 0.025 / 0.5 = 5%/day
      vega: 0.02,
      impliedVolatility: 0.5,
      timeToExpirationYears: 2 / 365,
    },
  });
  const high = scoreOptionGreekCandidate({
    right: "call",
    spot: 600,
    strike: 600,
    entryPrice: 15,
    volume: 200,
    greeks: {
      price: 15,
      delta: 0.5,
      gamma: 0.0104166667, // (g × 600² × 1e-4) / 15 = 0.025
      theta: -0.75, // 0.75 / 15 = 5%/day
      vega: 0.6,
      impliedVolatility: 0.5,
      timeToExpirationYears: 2 / 365,
    },
  });
  assert.equal(low.components.gammaTheta, 7.5);
  assert.equal(high.components.gammaTheta, 7.5);
});
