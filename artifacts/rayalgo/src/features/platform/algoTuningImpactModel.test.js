import assert from "node:assert/strict";
import test from "node:test";

import {
  __internalsForTests,
  buildAlgoTuningImpact,
} from "./algoTuningImpactModel";

const candidate = (overrides) => ({
  symbol: "SPY",
  reason: "",
  dte: 1,
  ...overrides,
});

const position = (overrides) => ({
  symbol: "SPY",
  entryPrice: 4.0,
  lastMarkPrice: 4.0,
  peakPrice: 4.0,
  ...overrides,
});

test("spreadTooWide counts candidates blocked on spread and samples top symbols", () => {
  const impact = buildAlgoTuningImpact({
    cockpit: {
      candidates: [
        candidate({ symbol: "TSLA", reason: "spread_too_wide" }),
        candidate({ symbol: "SMCI", reason: "spread_too_wide" }),
        candidate({ symbol: "NVDA", reason: "" }),
        candidate({ symbol: "TSLA", reason: "spread_too_wide" }),
      ],
    },
    profile: { optionSelection: { minDte: 1, maxDte: 3 } },
  });
  assert.equal(impact.spreadTooWide.count, 3);
  assert.deepEqual(impact.spreadTooWide.sampleSymbols, ["TSLA", "SMCI"]);
});

test("dte window impact counts candidates outside the configured bounds", () => {
  const impact = buildAlgoTuningImpact({
    cockpit: {
      candidates: [
        candidate({ symbol: "AAPL", dte: 5 }),
        candidate({ symbol: "MSFT", dte: 1 }),
        candidate({ symbol: "AMZN", dte: 0 }),
        candidate({ symbol: "GOOG", dte: 7 }),
      ],
    },
    profile: { optionSelection: { minDte: 1, maxDte: 3 } },
  });
  assert.equal(impact.dteWindow.count, 3);
  assert.deepEqual(impact.dteWindow.sampleSymbols, ["AAPL", "AMZN", "GOOG"]);
});

test("regime blockers fold mtf + bear + inverse + entry gate into one bucket", () => {
  const impact = buildAlgoTuningImpact({
    cockpit: {
      candidates: [
        candidate({ symbol: "SPY", reason: "bear_regime_gate_failed" }),
        candidate({ symbol: "QQQ", reason: "mtf_not_aligned" }),
        candidate({ symbol: "TSLA", reason: "inverse_put_blocked" }),
        candidate({ symbol: "AMD", reason: "entry_gate_failed" }),
        candidate({ symbol: "PLTR", reason: "" }),
      ],
    },
    profile: {},
  });
  assert.equal(impact.regimeBlocks.count, 4);
  assert.equal(impact.regimeBlocks.sampleSymbols.length, 3);
});

test("hardStop impact computes trigger prices for open positions and sorts by distance", () => {
  const impact = buildAlgoTuningImpact({
    cockpit: { candidates: [] },
    profile: { exitPolicy: { hardStopPct: -40 } },
    positions: [
      position({ symbol: "SPY", entryPrice: 4.2, lastMarkPrice: 3.1 }),
      position({ symbol: "NVDA", entryPrice: 8.0, lastMarkPrice: 6.5 }),
      position({ symbol: "MSFT", entryPrice: 1.9, lastMarkPrice: 2.6 }),
    ],
  });
  assert.equal(impact.hardStop.count, 3);
  assert.equal(impact.hardStop.triggers[0].symbol, "SPY");
  assert.equal(Math.round(impact.hardStop.triggers[0].triggerPrice * 100) / 100, 2.52);
});

test("trailing impact counts positions where peak has moved above entry", () => {
  const impact = buildAlgoTuningImpact({
    cockpit: { candidates: [] },
    profile: {},
    positions: [
      position({ symbol: "SPY", entryPrice: 4.0, peakPrice: 5.1 }),
      position({ symbol: "NVDA", entryPrice: 8.0, peakPrice: 7.5 }),
      position({ symbol: "MSFT", entryPrice: 1.9, peakPrice: 2.6 }),
    ],
  });
  assert.equal(impact.trailing.count, 2);
  assert.equal(impact.trailing.total, 3);
  assert.deepEqual(impact.trailing.sampleSymbols, ["SPY", "MSFT"]);
});

test("sampleTopSymbols dedupes and caps the result list", () => {
  const symbols = __internalsForTests.sampleTopSymbols(
    [{ symbol: "spy" }, { symbol: "SPY" }, { symbol: "NVDA" }, { symbol: "TSLA" }, { symbol: "MSFT" }],
    3,
  );
  assert.deepEqual(symbols, ["SPY", "NVDA", "TSLA"]);
});

test("distributionOf buckets values evenly across the min..max range", () => {
  const result = __internalsForTests.distributionOf([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], {
    bucketCount: 5,
  });
  assert.equal(result.buckets.length, 5);
  assert.equal(result.min, 1);
  assert.equal(result.max, 10);
  // 10 values across 5 buckets in 1..10 range
  assert.equal(result.buckets.reduce((sum, count) => sum + count, 0), 10);
});

test("distributionOf handles empty input", () => {
  const result = __internalsForTests.distributionOf([], { bucketCount: 5 });
  assert.deepEqual(result.buckets, []);
});

test("distributionOf collapses to one bucket when all values are equal", () => {
  const result = __internalsForTests.distributionOf([5, 5, 5, 5], { bucketCount: 10 });
  assert.deepEqual(result.buckets, [4]);
});

test("thresholdPositionWithin clamps the result to 0..1", () => {
  const distribution = { buckets: [1, 2, 3], min: 0, max: 10 };
  assert.equal(__internalsForTests.thresholdPositionWithin(distribution, -5), 0);
  assert.equal(__internalsForTests.thresholdPositionWithin(distribution, 0), 0);
  assert.equal(__internalsForTests.thresholdPositionWithin(distribution, 5), 0.5);
  assert.equal(__internalsForTests.thresholdPositionWithin(distribution, 10), 1);
  assert.equal(__internalsForTests.thresholdPositionWithin(distribution, 25), 1);
});

test("buildAlgoTuningImpact attaches histograms for spread / bid / premium", () => {
  const impact = buildAlgoTuningImpact({
    cockpit: {
      candidates: [
        { symbol: "SPY", liquidity: { spreadPctOfMid: 4, bid: 0.5 }, orderPlan: { premiumAtRisk: 220 } },
        { symbol: "NVDA", liquidity: { spreadPctOfMid: 8, bid: 0.6 }, orderPlan: { premiumAtRisk: 420 } },
        { symbol: "MSFT", liquidity: { spreadPctOfMid: 12, bid: 0.4 }, orderPlan: { premiumAtRisk: 380 } },
        { symbol: "TSLA", liquidity: { spreadPctOfMid: 18, bid: 0.1 }, orderPlan: { premiumAtRisk: 560 } },
      ],
    },
    profile: {
      liquidityGate: { maxSpreadPctOfMid: 10, minBid: 0.2 },
      riskCaps: { maxPremiumPerEntry: 500 },
      optionSelection: { minDte: 1, maxDte: 3 },
    },
  });
  assert.ok(impact.spreadTooWide.histogram.buckets.length > 0);
  assert.ok(impact.spreadTooWide.histogram.thresholdPosition >= 0);
  assert.ok(impact.spreadTooWide.histogram.thresholdPosition <= 1);
  assert.equal(impact.spreadTooWide.histogram.min, 4);
  assert.equal(impact.spreadTooWide.histogram.max, 18);

  assert.ok(impact.bidBelowMinimum.histogram.buckets.length > 0);
  assert.ok(impact.premiumBudget.histogram.buckets.length > 0);
  assert.ok(impact.dteWindow.histogram.thresholdPosition !== undefined);
});
