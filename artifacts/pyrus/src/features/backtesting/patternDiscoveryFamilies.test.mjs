import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyPatternBiasAlignment,
  classifyPatternSetup,
  expectedBiasForPatternSetup,
  summarizePatternSetupFamilies,
  totalPossiblePatternCombinations,
} from "./patternDiscoveryFamilies.ts";

test("classifyPatternSetup labels confluence patterns", () => {
  assert.equal(
    classifyPatternSetup("1m:buy|2m:buy|5m:buy|15m:buy").id,
    "bull_confluence",
  );
  assert.equal(
    classifyPatternSetup("1m:sell|2m:sell|5m:sell|15m:sell").id,
    "bear_confluence",
  );
});

test("classifyPatternSetup labels fast-frame reversal against slower context", () => {
  assert.equal(
    classifyPatternSetup("1m:buy|2m:buy|5m:sell|15m:sell").id,
    "fast_bullish_reversal",
  );
  assert.equal(
    classifyPatternSetup("1m:sell|2m:sell|5m:buy|15m:buy").id,
    "fast_bearish_reversal",
  );
  assert.equal(
    classifyPatternSetup("15m:sell|1m:buy|5m:sell|2m:buy").id,
    "fast_bullish_reversal",
  );
});

test("classifyPatternSetup separates mixed divergence and inactive patterns", () => {
  assert.equal(
    classifyPatternSetup("1m:buy|2m:sell|5m:sell|15m:buy").id,
    "mixed_divergence",
  );
  assert.equal(
    classifyPatternSetup("1m:none|2m:none|5m:none|15m:none").id,
    "inactive",
  );
});

test("totalPossiblePatternCombinations counts buy/sell/none vectors", () => {
  assert.equal(totalPossiblePatternCombinations(["1m", "2m", "5m", "15m"]), 81);
  assert.equal(totalPossiblePatternCombinations(["1m", "2m", "5m", "15m", "1h"]), 243);
});

test("expectedBiasForPatternSetup maps thesis families to directional bias", () => {
  assert.equal(expectedBiasForPatternSetup("bull_confluence"), "long");
  assert.equal(expectedBiasForPatternSetup("fast_bullish_reversal"), "long");
  assert.equal(expectedBiasForPatternSetup("bear_confluence"), "short");
  assert.equal(expectedBiasForPatternSetup("fast_bearish_reversal"), "short");
  assert.equal(expectedBiasForPatternSetup("mixed_divergence"), null);
});

test("classifyPatternBiasAlignment flags reversal thesis agreement", () => {
  assert.equal(
    classifyPatternBiasAlignment("1m:buy|2m:buy|5m:sell|15m:sell", "long"),
    "aligned",
  );
  assert.equal(
    classifyPatternBiasAlignment("1m:buy|2m:buy|5m:sell|15m:sell", "short"),
    "counter",
  );
  assert.equal(
    classifyPatternBiasAlignment("1m:sell|2m:sell|5m:buy|15m:buy", "short"),
    "aligned",
  );
  assert.equal(
    classifyPatternBiasAlignment("1m:buy|2m:sell|5m:sell|15m:buy", "long"),
    "neutral",
  );
});

test("summarizePatternSetupFamilies groups rows and preserves best absolute t-stat", () => {
  const summaries = summarizePatternSetupFamilies([
    {
      patternKey: "1m:buy|2m:buy|5m:sell|15m:sell",
      sampleCount: 10,
      meanReturnPct: 0.2,
      tStat: 1.4,
    },
    {
      patternKey: "1m:sell|2m:sell|5m:buy|15m:buy",
      sampleCount: 20,
      meanReturnPct: -0.4,
      tStat: -2.1,
    },
    {
      patternKey: "1m:sell|2m:sell|5m:buy|15m:buy",
      sampleCount: 5,
      meanReturnPct: -0.1,
      tStat: -0.5,
    },
  ]);

  const bearish = summaries.find((summary) => summary.id === "fast_bearish_reversal");
  assert.equal(bearish?.patternCount, 2);
  assert.equal(bearish?.sampleCount, 25);
  assert.equal(bearish?.bestPatternKey, "1m:sell|2m:sell|5m:buy|15m:buy");
  assert.equal(bearish?.bestAbsTStat, 2.1);
  assert.equal(bearish?.weightedMeanReturnPct, -0.34);
});

test("summarizePatternSetupFamilies excludes null returns from the weighted mean", () => {
  const summaries = summarizePatternSetupFamilies([
    {
      patternKey: "1m:buy|5m:buy",
      sampleCount: 10,
      meanReturnPct: 1,
      tStat: 1,
    },
    {
      patternKey: "1m:buy|5m:buy",
      sampleCount: 90,
      meanReturnPct: null,
      tStat: null,
    },
  ]);

  const bullish = summaries.find((summary) => summary.id === "bull_confluence");
  assert.equal(bullish?.sampleCount, 100);
  assert.equal(bullish?.weightedMeanReturnPct, 1);
});
