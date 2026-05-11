import assert from "node:assert/strict";
import test from "node:test";
import {
  computeSignals,
  resolveSignalDescription,
  resolveSqueezeNarrative,
} from "./gexModel.js";

test("resolveSignalDescription embeds the level and spot relation for each kind", () => {
  assert.match(
    resolveSignalDescription("Volatility", { source: "positive-gex" }),
    /Long-gamma/,
  );
  assert.match(
    resolveSignalDescription("Magnet", { level: 740, spot: 737 }),
    /\$740/,
  );
  assert.match(
    resolveSignalDescription("Magnet", { level: 740, spot: 737 }),
    /gravitate/,
  );
  assert.match(
    resolveSignalDescription("Support", { level: 726, spot: 737 }),
    /Zero-gamma/,
  );
  assert.match(
    resolveSignalDescription("Support", { level: 726, spot: 737 }),
    /\$726/,
  );
  assert.match(
    resolveSignalDescription("Volatility", {
      level: 710,
      spot: 737,
      source: "put-wall",
    }),
    /Put wall at \$710/,
  );
});

test("computeSignals emits the enriched description with level data per signal", () => {
  const signals = computeSignals(
    {
      netGex: 1,
      peakGexStrike: 100.1,
      zeroGamma: 99,
      putWall: 95,
      callWall: 105,
    },
    100,
  );

  const byKind = (kind, levelMatch) =>
    signals.find(
      (signal) =>
        signal.kind === kind &&
        (levelMatch === undefined || signal.level === levelMatch),
    );

  const longGamma = byKind("Volatility", 100);
  assert.ok(longGamma, "expected Volatility signal under positive net GEX");
  assert.match(longGamma.description, /Long-gamma/);

  const magnet = byKind("Magnet");
  assert.ok(magnet, "expected Magnet signal when peak is near spot");
  assert.match(magnet.description, /gravitate/);

  const support = byKind("Support");
  assert.ok(support, "expected Support signal when zero-gamma below spot");
  assert.match(support.description, /Zero-gamma/);

  const putWall = byKind("Volatility", 95);
  assert.ok(putWall, "expected Put wall volatility signal");
  assert.match(putWall.description, /Put wall/);
});

test("resolveSqueezeNarrative is empty when no squeeze present", () => {
  assert.deepEqual(resolveSqueezeNarrative(null), {
    stronger: [],
    implication: "",
  });
});

test("resolveSqueezeNarrative bullets surface every low-scoring factor", () => {
  const squeeze = {
    direction: "bullish",
    verdict: "Possible",
    score: 30,
    wallStrike: 102,
    factors: {
      gammaRegime: 0,
      wallProximity: 5,
      flowAlignment: 25,
      volumeConfirm: 25,
      dexBias: 5,
    },
  };

  const narrative = resolveSqueezeNarrative(squeeze);
  assert.equal(narrative.stronger.length, 3);
  assert.ok(narrative.stronger.some((line) => /regime/.test(line)));
  assert.ok(narrative.stronger.some((line) => /wall/.test(line)));
  assert.ok(narrative.stronger.some((line) => /delta/.test(line)));
});

test("resolveSqueezeNarrative implication adapts to verdict and regime", () => {
  const imminent = resolveSqueezeNarrative({
    direction: "bullish",
    verdict: "Imminent",
    wallStrike: 102,
    factors: { gammaRegime: 25 },
  });
  assert.match(imminent.implication, /accelerated upside/);

  const likelyDown = resolveSqueezeNarrative({
    direction: "bearish",
    verdict: "Likely",
    wallStrike: 95,
    factors: { gammaRegime: 25 },
  });
  assert.match(likelyDown.implication, /downside squeeze/);

  const longGammaDamp = resolveSqueezeNarrative({
    direction: "bullish",
    verdict: "Possible",
    wallStrike: 102,
    factors: { gammaRegime: 0 },
  });
  assert.match(longGammaDamp.implication, /Long-gamma/);
  assert.match(longGammaDamp.implication, /mean-reversion/);

  const unlikely = resolveSqueezeNarrative({
    direction: "bullish",
    verdict: "Unlikely",
    wallStrike: 102,
    factors: { gammaRegime: 0 },
  });
  assert.match(unlikely.implication, /No actionable squeeze/);
});

test("resolveSqueezeNarrative threshold respects custom lowFactorThreshold", () => {
  const squeeze = {
    direction: "bullish",
    verdict: "Possible",
    wallStrike: 102,
    factors: {
      gammaRegime: 12,
      wallProximity: 12,
      flowAlignment: 12,
      volumeConfirm: 12,
      dexBias: 12,
    },
  };

  assert.equal(resolveSqueezeNarrative(squeeze).stronger.length, 0);
  assert.equal(
    resolveSqueezeNarrative(squeeze, { lowFactorThreshold: 15 }).stronger.length,
    5,
  );
});
