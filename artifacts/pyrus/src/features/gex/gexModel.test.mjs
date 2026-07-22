import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateMetrics,
  computeDirectionalSqueeze,
  contractGex,
  normalizeGexResponseOptions,
  resolveHeadlineZeroGamma,
} from "./gexModel.js";

const option = ({ strike, cp, gamma = 1, openInterest }) => ({
  strike,
  cp,
  gamma,
  openInterest,
  multiplier: 1,
});

test("aggregateMetrics uses net GEX support and resistance for headline walls", () => {
  const spot = 100;
  const rows = [
    option({ strike: 105, cp: "C", openInterest: 40 }),
    option({ strike: 105, cp: "P", openInterest: 35 }),
    option({ strike: 110, cp: "C", openInterest: 30 }),
    option({ strike: 110, cp: "P", openInterest: 5 }),
    option({ strike: 95, cp: "C", openInterest: 35 }),
    option({ strike: 95, cp: "P", openInterest: 40 }),
    option({ strike: 90, cp: "C", openInterest: 5 }),
    option({ strike: 90, cp: "P", openInterest: 30 }),
  ];

  const metrics = aggregateMetrics(rows, spot);

  assert.equal(metrics.callWall, 110);
  assert.equal(metrics.putWall, 90);
});

test("resolveHeadlineZeroGamma prefers server simulation over legacy metrics", () => {
  assert.equal(
    resolveHeadlineZeroGamma({ zeroGamma: 98 }, { zeroGamma: 101.5 }),
    101.5,
  );
  assert.equal(resolveHeadlineZeroGamma({ zeroGamma: 98 }, null), 98);
  assert.equal(resolveHeadlineZeroGamma({ zeroGamma: null }, { zeroGamma: null }), null);
});

test("GEX normalization honors positive shares-per-contract fallbacks", () => {
  const base = {
    strike: 100,
    expireYear: 2026,
    expireMonth: 7,
    expireDay: 24,
    cp: "C",
    gamma: 0.01,
    openInterest: 10,
    impliedVol: 0.2,
  };
  const { rows } = normalizeGexResponseOptions([
    { ...base, sharesPerContract: 50 },
    { ...base, strike: 101, multiplier: -1, sharesPerContract: 25 },
    { ...base, strike: 102, multiplier: 0, sharesPerContract: 0 },
  ]);

  assert.deepEqual(rows.map((row) => row.multiplier), [50, 25, 100]);
  assert.equal(contractGex(rows[0], 100), 500);
});

test("directional squeeze score stays on the documented 0-100 scale", () => {
  const squeeze = computeDirectionalSqueeze(
    { netGex: -1, callWall: 100, putWall: 100 },
    100,
    {
      pending: false,
      bullishShare: 1,
      netDelta: 1,
      refDelta: 1,
      todayVol: 2,
      avg30dVol: 1,
      volumeBaselineReady: true,
    },
    "bullish",
  );

  assert.equal(squeeze.score, 100);
  assert.equal(squeeze.verdict, "Imminent");
});
