import assert from "node:assert/strict";
import test from "node:test";

import { aggregateMetrics, resolveHeadlineZeroGamma } from "./gexModel.js";

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
