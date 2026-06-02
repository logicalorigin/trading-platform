import assert from "node:assert/strict";
import test from "node:test";
import {
  blackScholes,
  computeOptionGreeksFromPrice,
  impliedVolatilityFromPrice,
  scoreOptionGreekCandidate,
} from "./option-greek-selector";

function approx(actual: number, expected: number, tolerance: number) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

test("Black-Scholes prices calls, puts, and greeks in parity with compute service", () => {
  const call = blackScholes({
    spot: 100,
    strike: 100,
    timeToExpirationYears: 1,
    volatility: 0.2,
    right: "call",
    riskFreeRate: 0.05,
  });
  const put = blackScholes({
    spot: 100,
    strike: 100,
    timeToExpirationYears: 1,
    volatility: 0.2,
    right: "put",
    riskFreeRate: 0.05,
  });

  approx(call.price, 10.4506, 0.0001);
  approx(put.price, 5.5735, 0.0001);
  approx(call.delta, 0.6368, 0.0001);
  approx(put.delta, -0.3632, 0.0001);
  approx(call.gamma, 0.018762, 0.000001);
  approx(call.vega, 0.37524, 0.00001);
});

test("implied volatility solver recovers the volatility used for a mark", () => {
  const price = blackScholes({
    spot: 100,
    strike: 105,
    timeToExpirationYears: 30 / 365,
    volatility: 0.42,
    right: "call",
    riskFreeRate: 0.05,
  }).price;

  const volatility = impliedVolatilityFromPrice({
    spot: 100,
    strike: 105,
    timeToExpirationYears: 30 / 365,
    optionPrice: price,
    right: "call",
    riskFreeRate: 0.05,
  });

  assert.ok(volatility != null);
  approx(volatility, 0.42, 0.000001);
});

test("Greek reconstruction returns null when required market inputs are invalid", () => {
  assert.equal(
    computeOptionGreeksFromPrice({
      spot: 0,
      strike: 100,
      optionPrice: 1,
      right: "call",
      at: new Date("2026-05-29T14:30:00.000Z"),
      expirationDate: new Date("2026-06-01T00:00:00.000Z"),
      riskFreeRate: 0.05,
    }),
    null,
  );
});

test("Greek expectancy scorer penalizes overpriced high-theta contracts", () => {
  const at = new Date("2026-05-29T14:30:00.000Z");
  const expirationDate = new Date("2026-06-01T00:00:00.000Z");
  const balancedGreeks = computeOptionGreeksFromPrice({
    spot: 100,
    strike: 101,
    optionPrice: 1.4,
    right: "call",
    at,
    expirationDate,
    riskFreeRate: 0.05,
  });
  const overpricedGreeks = computeOptionGreeksFromPrice({
    spot: 100,
    strike: 110,
    optionPrice: 5.5,
    right: "call",
    at,
    expirationDate,
    riskFreeRate: 0.05,
  });

  assert.ok(balancedGreeks);
  assert.ok(overpricedGreeks);
  const balanced = scoreOptionGreekCandidate({
    right: "call",
    spot: 100,
    strike: 101,
    entryPrice: 1.4,
    volume: 250,
    greeks: balancedGreeks,
  });
  const overpriced = scoreOptionGreekCandidate({
    right: "call",
    spot: 100,
    strike: 110,
    entryPrice: 5.5,
    volume: 250,
    greeks: overpricedGreeks,
  });

  assert.ok(balanced.total > overpriced.total);
  assert.ok(overpriced.notes.includes("overprice_penalty"));
});
