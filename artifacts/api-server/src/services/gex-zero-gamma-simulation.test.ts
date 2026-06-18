import assert from "node:assert/strict";
import test from "node:test";

import { buildGexZeroGammaSimulation } from "./gex-zero-gamma-simulation";

const option = ({
  strike,
  cp,
  openInterest,
  impliedVol = 0.2,
}: {
  strike: number;
  cp: "C" | "P";
  openInterest: number;
  impliedVol?: number;
}) => ({
  strike,
  cp,
  expirationDate: "2026-07-17",
  expireYear: 2026,
  expireMonth: 7,
  expireDay: 17,
  gamma: 0,
  delta: 0,
  openInterest,
  impliedVol,
  bid: 1,
  ask: 1.1,
  multiplier: 100,
});

test("zero-gamma simulation finds the nearest spot-sweep crossing", () => {
  const simulation = buildGexZeroGammaSimulation({
    ticker: "TEST",
    spot: 100,
    asOf: "2026-06-18T19:00:00.000Z",
    options: [
      option({ strike: 95, cp: "P", openInterest: 1500 }),
      option({ strike: 105, cp: "C", openInterest: 1500 }),
    ],
    scan: { lower: 85, upper: 115, pointCount: 121 },
  });

  assert.equal(simulation.quality.status, "partial");
  assert.ok(simulation.zeroGamma);
  assert.ok(simulation.zeroGamma > 95);
  assert.ok(simulation.zeroGamma < 105);
  assert.ok(simulation.crossings.length >= 1);
});

test("zero-gamma simulation returns null when net gamma never crosses", () => {
  const simulation = buildGexZeroGammaSimulation({
    ticker: "TEST",
    spot: 100,
    asOf: "2026-06-18T19:00:00.000Z",
    options: [
      option({ strike: 100, cp: "C", openInterest: 1000 }),
      option({ strike: 105, cp: "C", openInterest: 500 }),
    ],
    scan: { lower: 85, upper: 115, pointCount: 121 },
  });

  assert.equal(simulation.zeroGamma, null);
  assert.deepEqual(simulation.crossings, []);
  assert.ok(simulation.netGexAtSpot > 0);
});
