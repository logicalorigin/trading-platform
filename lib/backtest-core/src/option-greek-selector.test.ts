import assert from "node:assert/strict";
import test from "node:test";

import {
  scoreOptionGreekCandidate,
  timeToExpirationYears,
  type ScoreOptionGreekCandidateInput,
} from "./option-greek-selector";

type NamedCandidate = ScoreOptionGreekCandidateInput & { id: string };
type CandidateOverrides = Omit<
  Partial<ScoreOptionGreekCandidateInput>,
  "greeks"
> & {
  greeks?: Partial<ScoreOptionGreekCandidateInput["greeks"]>;
};

const BASE_CANDIDATE: ScoreOptionGreekCandidateInput = {
  right: "call",
  spot: 100,
  strike: 100,
  entryPrice: 1,
  volume: 100,
  hasExitPrice: true,
  greeks: {
    price: 1,
    delta: 0.45,
    gamma: 0.01,
    theta: -0.01,
    vega: 0.1,
    impliedVolatility: 0.5,
    timeToExpirationYears: 0.04,
  },
};

function candidate(overrides: CandidateOverrides = {}): ScoreOptionGreekCandidateInput {
  const { greeks, ...rest } = overrides;
  return {
    ...BASE_CANDIDATE,
    ...rest,
    greeks: {
      ...BASE_CANDIDATE.greeks,
      price: rest.entryPrice ?? BASE_CANDIDATE.entryPrice,
      ...greeks,
    },
  };
}

function namedCandidate(id: string, overrides: CandidateOverrides = {}): NamedCandidate {
  return { id, ...candidate(overrides) };
}

function score(overrides: CandidateOverrides = {}) {
  return scoreOptionGreekCandidate(candidate(overrides));
}

function rankCandidates(
  candidates: NamedCandidate[],
  policy: { minScore: number; maxCandidates: number },
) {
  return candidates
    .map((item) => ({
      id: item.id,
      strike: item.strike,
      score: scoreOptionGreekCandidate(item),
    }))
    .filter((item) => item.score.total >= policy.minScore)
    .sort(
      (left, right) =>
        right.score.total - left.score.total || left.strike - right.strike,
    )
    .slice(0, policy.maxCandidates);
}

// The expiry horizon must anchor on the real 16:00 America/New_York close, which
// is DST-dependent: 20:00 UTC in summer (EDT) but 21:00 UTC in winter (EST). The
// old code hardcoded 20:00 UTC, running every winter horizon 1h short. Both
// expiries below are ordinary (non-early-close) trading Fridays, so the close is
// 16:00 ET in both zones — the two instants must differ by exactly 1h.
test("expiry horizon anchors on DST-correct 16:00 ET, not a fixed 20:00 UTC", () => {
  const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
  const HOUR_MS = 60 * 60 * 1000;

  // Summer (EDT): 16:00 ET == 20:00 UTC, so an `at` of 20:00 UTC IS the close.
  const summerYears = timeToExpirationYears({
    at: new Date("2026-07-17T20:00:00.000Z"),
    expirationDate: new Date(Date.UTC(2026, 6, 17)),
  });
  assert.equal(summerYears, 0, "summer close should be exactly 20:00 UTC");

  // Winter (EST): 16:00 ET == 21:00 UTC, so 20:00 UTC is still 1h BEFORE the close;
  // the old fixed-20:00-UTC code would have returned 0 here.
  const winterYears = timeToExpirationYears({
    at: new Date("2026-01-16T20:00:00.000Z"),
    expirationDate: new Date(Date.UTC(2026, 0, 16)),
  });
  assert.ok(
    Math.abs(winterYears - HOUR_MS / YEAR_MS) < 1e-9,
    `winter close should be 21:00 UTC (1h after 20:00 UTC); got years ${winterYears}`,
  );

  // Recover each close instant and confirm both read as 16:00 in New York.
  const recoverCloseUtc = (expirationDate: Date, at: Date) =>
    at.getTime() + timeToExpirationYears({ at, expirationDate }) * YEAR_MS;
  const nyTime = (ms: number) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(Math.round(ms)));
  const summerClose = recoverCloseUtc(
    new Date(Date.UTC(2026, 6, 17)),
    new Date("2026-01-01T00:00:00.000Z"),
  );
  const winterClose = recoverCloseUtc(
    new Date(Date.UTC(2026, 0, 16)),
    new Date("2026-01-01T00:00:00.000Z"),
  );
  assert.equal(nyTime(summerClose), "16:00");
  assert.equal(nyTime(winterClose), "16:00");
});

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

test("deltaFit gives full credit across the near-ATM plateau and falls off outside it", () => {
  const lowerPlateau = score({ greeks: { delta: 0.35 } });
  const centerPlateau = score({ greeks: { delta: 0.45 } });
  const upperPlateau = score({ greeks: { delta: 0.55 } });
  const putPlateau = score({ right: "put", greeks: { delta: -0.45 } });
  const lowShoulder = score({ greeks: { delta: 0.25 } });
  const highShoulder = score({ greeks: { delta: 0.7 } });

  assert.equal(lowerPlateau.components.deltaFit, 20);
  assert.equal(centerPlateau.components.deltaFit, 20);
  assert.equal(upperPlateau.components.deltaFit, 20);
  assert.equal(putPlateau.components.deltaFit, 20);
  assert.ok(lowShoulder.components.deltaFit < lowerPlateau.components.deltaFit);
  assert.ok(highShoulder.components.deltaFit < upperPlateau.components.deltaFit);
  assert.ok(lowShoulder.components.deltaFit < 10);
});

test("delta below 0.15 is disqualified and excluded by the minScore gate", () => {
  const disqualified = namedCandidate("lottery-ticket", {
    greeks: { delta: 0.149 },
  });
  const threshold = namedCandidate("threshold", {
    greeks: { delta: 0.15 },
  });

  const disqualifiedScore = scoreOptionGreekCandidate(disqualified);
  const thresholdScore = scoreOptionGreekCandidate(threshold);
  const ranked = rankCandidates([disqualified, threshold], {
    minScore: 0,
    maxCandidates: 10,
  });

  assert.equal(disqualifiedScore.total, -100);
  assert.ok(disqualifiedScore.notes.includes("below_min_tradeable_delta"));
  assert.ok(!thresholdScore.notes.includes("below_min_tradeable_delta"));
  assert.ok(thresholdScore.total >= 0);
  assert.deepEqual(
    ranked.map((item) => item.id),
    ["threshold"],
  );
});

// gammaTheta must be dimensionless: premium-fraction gained from gamma on a 1%
// underlying move vs premium-fraction lost to one day of theta. Two contracts with
// identical premium-relative gamma efficiency and theta burden must earn the same
// component regardless of the underlying's price level. (The old dollars-vs-fraction
// ratio saturated every ~$600-underlying candidate at 15 pts and starved ~$20 ones.)
test("gammaTheta is spot-level invariant for equal premium-relative efficiency", () => {
  // Both candidates: gamma premium-fraction on a 1% move = 0.025, theta burn 5%/day
  // -> ratio 0.5 -> exactly half of the 20-pt component.
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
  assert.equal(low.components.gammaTheta, 10);
  assert.equal(high.components.gammaTheta, 10);
});

test("gammaTheta is capped at its 20 point maximum", () => {
  const capped = score({
    entryPrice: 1,
    greeks: {
      gamma: 0.02, // (0.02 x 100^2 x 1e-4) / 1 = 2% premium fraction.
      theta: -0.01, // 1% daily theta burden, so the raw ratio is 2x.
    },
  });

  assert.equal(capped.components.gammaTheta, 20);
});

test("breakevenFit rewards breakeven inside expected move and penalizes beyond it", () => {
  const inside = score({
    entryPrice: 1,
    strike: 100,
    greeks: {
      impliedVolatility: 0.5,
      timeToExpirationYears: 0.04,
    },
  });
  const outside = score({
    entryPrice: 12,
    strike: 100,
    greeks: {
      impliedVolatility: 0.5,
      timeToExpirationYears: 0.04,
    },
  });

  assert.equal(inside.expectedMovePct, 0.1);
  assert.equal(inside.breakevenMovePct, 0.01);
  assert.equal(inside.components.breakevenFit, 22.5);
  assert.ok(!inside.notes.includes("breakeven_beyond_expected_move"));
  assert.equal(outside.breakevenMovePct, 0.12);
  assert.equal(outside.components.breakevenFit, -5);
  assert.ok(outside.notes.includes("breakeven_beyond_expected_move"));
});

test("liquidity alone materially separates otherwise identical ladder candidates", () => {
  const tight = score({ volume: 100 });
  const thin = score({ volume: 10 });

  assert.equal(tight.components.deltaFit, thin.components.deltaFit);
  assert.equal(tight.components.breakevenFit, thin.components.breakevenFit);
  assert.ok(
    tight.total - thin.total >= 10,
    `expected at least 10 points of separation, got ${tight.total - thin.total}`,
  );
});

test("breakeven alone materially separates otherwise identical ladder candidates", () => {
  const inside = score({ strike: 100, entryPrice: 1, greeks: { price: 1 } });
  const stretched = score({ strike: 100, entryPrice: 5, greeks: { price: 5 } });

  assert.equal(inside.components.deltaFit, stretched.components.deltaFit);
  assert.equal(inside.components.liquidity, stretched.components.liquidity);
  assert.ok(
    inside.total - stretched.total >= 10,
    `expected at least 10 points of separation, got ${inside.total - stretched.total}`,
  );
});

test("minScore admits scores on the boundary and rejects scores below it", () => {
  const atBoundary = namedCandidate("at-boundary");
  const belowBoundary = namedCandidate("below-boundary", {
    greeks: { delta: 0.25 },
  });
  const boundaryScore = scoreOptionGreekCandidate(atBoundary).total;

  const ranked = rankCandidates([belowBoundary, atBoundary], {
    minScore: boundaryScore,
    maxCandidates: 10,
  });

  assert.deepEqual(
    ranked.map((item) => item.id),
    ["at-boundary"],
  );
});

test("maxCandidates slices after highest-score ordering", () => {
  const ranked = rankCandidates(
    [
      namedCandidate("middle", { volume: 60, greeks: { delta: 0.35 } }),
      namedCandidate("best", { volume: 100, greeks: { delta: 0.45 } }),
      namedCandidate("worst", { greeks: { delta: 0.8 } }),
    ],
    { minScore: 0, maxCandidates: 2 },
  );

  assert.deepEqual(
    ranked.map((item) => item.id),
    ["best", "middle"],
  );
});

test("score ties break by lower strike, documenting the current put/call asymmetry", () => {
  const callTie = rankCandidates(
    [
      namedCandidate("call-lower-strike", {
        right: "call",
        strike: 99,
        volume: 66.667,
      }),
      namedCandidate("call-higher-strike", {
        right: "call",
        strike: 101,
        volume: 100,
      }),
    ],
    { minScore: 0, maxCandidates: 2 },
  );
  const putTie = rankCandidates(
    [
      namedCandidate("put-lower-strike", {
        right: "put",
        strike: 99,
        volume: 100,
        greeks: { delta: -0.45 },
      }),
      namedCandidate("put-higher-strike", {
        right: "put",
        strike: 101,
        volume: 66.667,
        greeks: { delta: -0.45 },
      }),
    ],
    { minScore: 0, maxCandidates: 2 },
  );

  assert.equal(callTie[0]?.score.total, callTie[1]?.score.total);
  assert.deepEqual(
    callTie.map((item) => item.id),
    ["call-lower-strike", "call-higher-strike"],
  );
  assert.equal(putTie[0]?.score.total, putTie[1]?.score.total);
  assert.deepEqual(
    putTie.map((item) => item.id),
    ["put-lower-strike", "put-higher-strike"],
  );
});

test("score composition ranks a hand-built candidate set end-to-end", () => {
  const ranked = rankCandidates(
    [
      namedCandidate("expensive-perfect-delta", {
        entryPrice: 9,
        greeks: {
          price: 9,
          delta: 0.45,
          gamma: 0.09,
          theta: -0.09,
        },
      }),
      namedCandidate("balanced", {
        entryPrice: 1,
        greeks: {
          delta: 0.45,
          gamma: 0.02,
          theta: -0.01,
        },
      }),
      namedCandidate("cheap-low-delta", {
        entryPrice: 1,
        greeks: {
          delta: 0.25,
          gamma: 0.02,
          theta: -0.01,
        },
      }),
    ],
    { minScore: 0, maxCandidates: 10 },
  );

  assert.deepEqual(
    ranked.map((item) => item.id),
    ["balanced", "cheap-low-delta", "expensive-perfect-delta"],
  );
  assert.ok(
    ranked[0]!.score.total - ranked[1]!.score.total >= 10,
    "balanced candidate should clear the low-delta candidate by a material margin",
  );
});
