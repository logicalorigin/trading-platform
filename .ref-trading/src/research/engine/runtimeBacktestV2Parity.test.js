import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveBacktestV2EntryGateDecision,
  resolveBacktestV2LayerPlan,
  resolveBacktestV2RiskControlDecision,
  resolveBacktestV2StopLossPct,
  resolveBacktestV2TimeCliffDecision,
  resolveBacktestV2TrailProfile,
} from "./runtime.js";

function assertApprox(actual, expected, epsilon = 1e-9) {
  assert.ok(Math.abs(Number(actual) - Number(expected)) < epsilon, `expected ${actual} to be within ${epsilon} of ${expected}`);
}

test("resolveBacktestV2LayerPlan gates follow-on layers by edge strength and applies the layer bump", () => {
  const layerConfig = {
    layerFractions: [1, 0.5, 0.25],
    edgeBumpMultiplier: 1.2,
    edgeSkipThreshold: 1.1,
    maxLayersPerPosition: 3,
  };

  const firstLayer = resolveBacktestV2LayerPlan({
    layerConfig,
    openSameDirectionCount: 0,
    score: 0.78,
    conviction: 0.78,
    minConviction: 0.48,
  });
  const secondLayer = resolveBacktestV2LayerPlan({
    layerConfig,
    openSameDirectionCount: 1,
    score: 0.62,
    conviction: 0.62,
    minConviction: 0.48,
  });
  const weakSecondLayer = resolveBacktestV2LayerPlan({
    layerConfig,
    openSameDirectionCount: 1,
    score: 0.50,
    conviction: 0.50,
    minConviction: 0.48,
  });

  assert.deepEqual(firstLayer, {
    allow: true,
    reason: null,
    layerIndex: 0,
    layerNumber: 1,
    edgeRatio: 0.78 / 0.48,
    baseFraction: 1,
    sizeMultiplier: 1,
    edgeBumpApplied: false,
    maxLayersPerPosition: 3,
  });
  assert.equal(secondLayer.allow, true);
  assert.equal(secondLayer.layerNumber, 2);
  assert.equal(secondLayer.baseFraction, 0.5);
  assert.equal(secondLayer.edgeBumpApplied, true);
  assert.equal(secondLayer.sizeMultiplier, 0.6);
  assert.equal(weakSecondLayer.allow, false);
  assert.equal(weakSecondLayer.reason, "edge_below_threshold");
});

test("resolveBacktestV2StopLossPct applies staged max-loss buckets by entry DTE", () => {
  const exitGovernorConfig = {
    maxLoss0dtePct: 0.5,
    maxLoss1to3dtePct: 0.4,
    maxLoss5plusPct: 0.3,
  };

  assert.equal(resolveBacktestV2StopLossPct({
    position: { actualDteAtEntry: 0 },
    legacyStopLossPct: 0.25,
    exitGovernorConfig,
  }), 0.5);
  assert.equal(resolveBacktestV2StopLossPct({
    position: { actualDteAtEntry: 2 },
    legacyStopLossPct: 0.25,
    exitGovernorConfig,
  }), 0.4);
  assert.equal(resolveBacktestV2StopLossPct({
    position: { actualDteAtEntry: 7 },
    legacyStopLossPct: 0.25,
    exitGovernorConfig,
  }), 0.3);
});

test("resolveBacktestV2EntryGateDecision applies staged confluence, VIX, and edge sizing rules", () => {
  const entryGateConfig = {
    edgeRatioSkip: 1.1,
    edgeRatioHalf: 1.3,
    edgeRatio0dteShift: 0.1,
    edgeRatioWeekendShift: 0.15,
    vixConfluenceFloors: {
      low: 0.55,
      mid: 0.7,
      high: 0.85,
      veryHigh: 0.9,
    },
    vix25To30TrendingEdgeShift: 0.1,
    vix30PlusTrendingEdgeShift: 0.2,
    vix25To30ChoppySkip: true,
    vix30PlusChoppySkip: true,
    regimeExpectedMoveMultipliers: {
      trending: 1.3,
      neutral: 1,
      choppy: 0.7,
    },
    mtfConfirmUpgradesSizing: true,
    oppositeDirectionSkip: true,
  };

  const fullSize = resolveBacktestV2EntryGateDecision({
    signal: { conviction: 0.95 },
    regime: { regime: "range", vix: 14 },
    entryDate: "2026-03-25",
    dte: 1,
    conviction: 0.95,
    entryGateConfig,
  });
  assert.equal(fullSize.allow, true);
  assert.equal(fullSize.reason, "full_size");
  assert.equal(fullSize.sizeMultiplier, 1);
  assert.ok(fullSize.edgeRatio > fullSize.effectiveHalf);

  const weekendHalfSize = resolveBacktestV2EntryGateDecision({
    signal: { conviction: 0.84 },
    regime: { regime: "range", vix: 14 },
    entryDate: "2026-03-26",
    dte: 2,
    conviction: 0.84,
    entryGateConfig,
  });
  assert.equal(weekendHalfSize.allow, true);
  assert.equal(weekendHalfSize.reason, "half_size");
  assert.equal(weekendHalfSize.sizeMultiplier, 0.5);
  assert.ok(weekendHalfSize.edgeRatio > weekendHalfSize.effectiveSkip);
  assert.ok(weekendHalfSize.edgeRatio < weekendHalfSize.effectiveHalf);

  const choppySkip = resolveBacktestV2EntryGateDecision({
    signal: { conviction: 0.92 },
    regime: { regime: "bear", vix: 26 },
    entryDate: "2026-03-25",
    dte: 1,
    conviction: 0.92,
    entryGateConfig,
  });
  assert.equal(choppySkip.allow, false);
  assert.equal(choppySkip.reason, "vix_25_30_choppy_skip");

  const confluenceSkip = resolveBacktestV2EntryGateDecision({
    signal: { conviction: 0.6 },
    regime: { regime: "range", vix: 22 },
    entryDate: "2026-03-25",
    dte: 1,
    conviction: 0.6,
    entryGateConfig,
  });
  assert.equal(confluenceSkip.allow, false);
  assert.equal(confluenceSkip.reason, "confluence_floor");
  assertApprox(confluenceSkip.confluenceFloor, 0.85);
});

test("resolveBacktestV2EntryGateDecision applies RayAlgo trend-change quality floors by direction", () => {
  const entryGateConfig = {
    edgeRatioSkip: 0.9,
    edgeRatioHalf: 1.1,
    edgeRatio0dteShift: 0,
    edgeRatioWeekendShift: 0,
    vixConfluenceFloors: {
      low: 0.4,
      mid: 0.45,
      high: 0.5,
      veryHigh: 0.55,
    },
    vix25To30TrendingEdgeShift: 0,
    vix30PlusTrendingEdgeShift: 0,
    vix25To30ChoppySkip: false,
    vix30PlusChoppySkip: false,
    regimeExpectedMoveMultipliers: {
      trending: 1.3,
      neutral: 1,
      choppy: 0.7,
    },
    mtfConfirmUpgradesSizing: true,
    oppositeDirectionSkip: true,
    rayalgoMinQualityScore: 0.46,
    rayalgoShortMinQualityScore: 0.52,
    rayalgoTrendChangeShortMinQualityScore: 0.54,
  };

  const weakTrendChange = resolveBacktestV2EntryGateDecision({
    signal: {
      strategyUsed: "rayalgo",
      direction: "short",
      conviction: 0.8,
      signalClass: "trend_change",
      scoring: {
        signalClass: "trend_change",
        qualityScore: 0.49,
      },
    },
    regime: { regime: "range", vix: 16 },
    entryDate: "2026-03-25",
    dte: 1,
    conviction: 0.8,
    entryGateConfig,
  });
  assert.equal(weakTrendChange.allow, false);
  assert.equal(weakTrendChange.reason, "rayalgo_quality_floor");
  assertApprox(weakTrendChange.requiredQualityScore, 0.54);

  const qualifiedTrendChange = resolveBacktestV2EntryGateDecision({
    signal: {
      strategyUsed: "rayalgo",
      direction: "long",
      conviction: 0.82,
      signalClass: "trend_change",
      scoring: {
        signalClass: "trend_change",
        qualityScore: 0.5,
      },
    },
    regime: { regime: "range", vix: 16 },
    entryDate: "2026-03-25",
    dte: 1,
    conviction: 0.82,
    entryGateConfig,
  });
  assert.equal(qualifiedTrendChange.allow, true);
  assert.equal(qualifiedTrendChange.reason, "full_size");
  assertApprox(qualifiedTrendChange.requiredQualityScore, 0.46);

  const effectiveScoreOverride = resolveBacktestV2EntryGateDecision({
    signal: {
      strategyUsed: "rayalgo",
      direction: "long",
      conviction: 0.82,
      signalClass: "trend_change",
      scoring: {
        signalClass: "trend_change",
        qualityScore: 0.43,
        effectiveScore: 0.5,
      },
    },
    regime: { regime: "range", vix: 16 },
    entryDate: "2026-03-25",
    dte: 1,
    conviction: 0.82,
    entryGateConfig,
  });
  assert.equal(effectiveScoreOverride.allow, true);
  assert.equal(effectiveScoreOverride.reason, "full_size");
  assertApprox(effectiveScoreOverride.requiredQualityScore, 0.46);
});

test("resolveBacktestV2RiskControlDecision applies staged day-loss persistence and cooldown rules", () => {
  const riskStopConfig = {
    dailyLossLimitPct: 3,
    consecutiveLossCooldownCount: 2,
    consecutiveLossCooldownMinutes: 30,
    drawdownThrottlePct: 5,
    drawdownHaltPct: 10,
    maxConcurrentSameDirection: 2,
    postMaxLossCooldownMinutes: 15,
    persistUntilNewEquityHigh: true,
  };
  const now = Date.parse("2026-03-25T15:00:00Z");

  const dayLoss = resolveBacktestV2RiskControlDecision({
    riskStopConfig,
    riskStopPolicy: "legacy_halt",
    currentCapital: 24000,
    peakCapital: 25000,
    initialCapital: 25000,
    dayPnl: -800,
    barTimeMs: now,
  });
  assert.equal(dayLoss.allowEntries, false);
  assert.equal(dayLoss.haltTrading, true);
  assert.equal(dayLoss.reason, "day_loss");
  assertApprox(dayLoss.dayLossPct, 3.2);

  const consecutiveLossCooldown = resolveBacktestV2RiskControlDecision({
    riskStopConfig,
    riskStopPolicy: "legacy_halt",
    currentCapital: 25000,
    peakCapital: 25000,
    initialCapital: 25000,
    dayPnl: 0,
    barTimeMs: now,
    direction: "long",
    consecutiveLosses: 2,
    lastLossTsMs: now - 5 * 60000,
  });
  assert.equal(consecutiveLossCooldown.allowEntries, false);
  assert.equal(consecutiveLossCooldown.haltTrading, false);
  assert.equal(consecutiveLossCooldown.reason, "consecutive_loss_cooldown");

  const maxLossCooldown = resolveBacktestV2RiskControlDecision({
    riskStopConfig,
    riskStopPolicy: "legacy_halt",
    currentCapital: 25000,
    peakCapital: 25000,
    initialCapital: 25000,
    dayPnl: 0,
    barTimeMs: now,
    direction: "short",
    lastMaxLossTsMs: now - 10 * 60000,
  });
  assert.equal(maxLossCooldown.allowEntries, false);
  assert.equal(maxLossCooldown.reason, "post_max_loss_cooldown_short");

  const persistentHalt = resolveBacktestV2RiskControlDecision({
    riskStopConfig,
    riskStopPolicy: "legacy_halt",
    currentCapital: 25500,
    peakCapital: 26000,
    initialCapital: 25000,
    dayPnl: 0,
    barTimeMs: now,
    persistentHaltResumeCapital: 26000,
  });
  assert.equal(persistentHalt.allowEntries, false);
  assert.equal(persistentHalt.haltTrading, true);
  assert.equal(persistentHalt.reason, "persist_until_new_equity_high");
});

test("resolveBacktestV2TimeCliffDecision honors staged DTE-specific time exits and profitable overrides", () => {
  const tradingDayIndexByDate = new Map([
    ["2026-03-24", 0],
    ["2026-03-25", 1],
    ["2026-03-26", 2],
  ]);
  const exitGovernorConfig = {
    timeCliff0dteMinutes: 45,
    timeCliff1to3dteEod: true,
    timeCliff5plusSessions: 2,
    timeCliffProfitableOverride: true,
  };

  assert.deepEqual(resolveBacktestV2TimeCliffDecision({
    position: {
      actualDteAtEntry: 0,
      ts: "2026-03-24T14:00:00Z",
      entryDate: "2026-03-24",
      entryMinuteOfDay: 14 * 60,
      expiryDate: "2026-03-24",
    },
    executionBar: {
      ts: "2026-03-24T14:50:00Z",
      date: "2026-03-24",
      hour: 14,
      min: 50,
    },
    pricePerformance: -0.02,
    exitGovernorConfig,
    tradingDayIndexByDate,
  }), {
    reason: "time_cliff_0dte",
    heldMinutes: 50,
    heldSessions: 1,
  });

  assert.equal(resolveBacktestV2TimeCliffDecision({
    position: {
      actualDteAtEntry: 0,
      ts: "2026-03-24T14:00:00Z",
      entryDate: "2026-03-24",
      entryMinuteOfDay: 14 * 60,
      expiryDate: "2026-03-24",
    },
    executionBar: {
      ts: "2026-03-24T14:50:00Z",
      date: "2026-03-24",
      hour: 14,
      min: 50,
    },
    pricePerformance: 0.08,
    exitGovernorConfig,
    tradingDayIndexByDate,
  }), null);

  assert.deepEqual(resolveBacktestV2TimeCliffDecision({
    position: {
      actualDteAtEntry: 2,
      ts: "2026-03-24T15:10:00Z",
      entryDate: "2026-03-24",
      entryMinuteOfDay: 15 * 60 + 10,
      expiryDate: "2026-03-26",
    },
    executionBar: {
      ts: "2026-03-25T15:56:00Z",
      date: "2026-03-25",
      hour: 15,
      min: 56,
    },
    pricePerformance: -0.01,
    exitGovernorConfig,
    tradingDayIndexByDate,
  }), {
    reason: "time_cliff_1to3dte_eod",
    heldMinutes: 1486,
    heldSessions: 2,
  });

  assert.deepEqual(resolveBacktestV2TimeCliffDecision({
    position: {
      actualDteAtEntry: 5,
      ts: "2026-03-24T10:15:00Z",
      entryDate: "2026-03-24",
      entryMinuteOfDay: 10 * 60 + 15,
      expiryDate: "2026-03-31",
    },
    executionBar: {
      ts: "2026-03-25T15:57:00Z",
      date: "2026-03-25",
      hour: 15,
      min: 57,
    },
    pricePerformance: -0.03,
    exitGovernorConfig,
    tradingDayIndexByDate,
  }), {
    reason: "time_cliff_5plus_sessions",
    heldMinutes: 1782,
    heldSessions: 2,
  });
});

test("resolveBacktestV2TrailProfile applies DTE bucket activation and lock-ratio tightening", () => {
  const exitGovernorConfig = {
    trailActivationAtr0dte: 0.35,
    trailActivationAtr1dte: 0.55,
    trailActivationAtr2to3dte: 0.75,
    trailOptionPnlFloor0dte: 0.15,
    trailOptionPnlFloor1dte: 0.11,
    trailOptionPnlFloor2to3dte: 0.09,
    trailLockRatioInitial: 0.45,
    trailLockRatioMax: 0.85,
    thetaTighten0dte30min: 0.05,
    thetaTighten0dte60min: 0.1,
    thetaTighten0dte90min: 0.15,
    thetaTighten1to3dte60min: 0.07,
    thetaTighten1to3dte120min: 0.11,
    todMultipliers: {
      open: 1.25,
      midmorning: 1.05,
      midday: 0.95,
      powerHour: 0.8,
    },
    regimeMultipliers: {
      trending: 1.2,
      neutral: 1,
      choppy: 0.75,
    },
  };

  const zeroDteProfile = resolveBacktestV2TrailProfile({
    position: {
      oe: 2,
      entrySpotPrice: 100,
      ic: true,
      actualDteAtEntry: 0,
      ts: "2026-03-24T13:00:00Z",
      entryDate: "2026-03-24",
      entryMinuteOfDay: 13 * 60,
    },
    executionBar: {
      ts: "2026-03-24T13:35:00Z",
      date: "2026-03-24",
      hour: 13,
      min: 35,
      h: 100.3,
      l: 100.1,
    },
    priceRange: {
      open: 2,
      high: 2.1,
      low: 1.95,
      close: 2.02,
    },
    trailStartPct: 0.08,
    exitGovernorConfig,
    spotAtr: 0.5,
    regime: { regime: "bull" },
  });
  assert.equal(zeroDteProfile.activationTriggered, true);
  assert.equal(zeroDteProfile.activationMode, "spot_atr");
  assertApprox(zeroDteProfile.optionActivationPrice, 2.3);
  assertApprox(zeroDteProfile.profitFloorPct, 0.15);
  assertApprox(zeroDteProfile.favorableSpotMove, 0.3);
  assertApprox(zeroDteProfile.lockRatio, 0.5);
  assertApprox(zeroDteProfile.requiredSpotMove, 0.1995);

  const oneDteProfile = resolveBacktestV2TrailProfile({
    position: {
      oe: 2,
      entrySpotPrice: 100,
      ic: true,
      actualDteAtEntry: 1,
      ts: "2026-03-24T13:00:00Z",
      entryDate: "2026-03-24",
      entryMinuteOfDay: 13 * 60,
    },
    executionBar: {
      ts: "2026-03-24T14:10:00Z",
      date: "2026-03-24",
      hour: 14,
      min: 10,
      h: 100.15,
      l: 99.95,
    },
    priceRange: {
      open: 2,
      high: 2.23,
      low: 1.96,
      close: 2.18,
    },
    trailStartPct: 0.08,
    exitGovernorConfig,
    spotAtr: 0.5,
    regime: { regime: "range" },
  });
  assert.equal(oneDteProfile.activationTriggered, true);
  assert.equal(oneDteProfile.activationMode, "option_floor");
  assertApprox(oneDteProfile.optionActivationPrice, 2.22);
  assertApprox(oneDteProfile.profitFloorPct, 0.11);
  assertApprox(oneDteProfile.lockRatio, 0.52);
  assertApprox(oneDteProfile.requiredSpotMove, 0.26125);

  const twoToThreeDteProfile = resolveBacktestV2TrailProfile({
    position: {
      oe: 2,
      entrySpotPrice: 100,
      ic: true,
      actualDteAtEntry: 3,
      ts: "2026-03-24T13:00:00Z",
      entryDate: "2026-03-24",
      entryMinuteOfDay: 13 * 60,
    },
    executionBar: {
      ts: "2026-03-24T15:10:00Z",
      date: "2026-03-24",
      hour: 15,
      min: 10,
      h: 100.1,
      l: 99.9,
    },
    priceRange: {
      open: 2,
      high: 2.19,
      low: 1.98,
      close: 2.16,
    },
    trailStartPct: 0.08,
    exitGovernorConfig,
    spotAtr: 0.5,
    regime: { regime: "bear" },
  });
  assert.equal(twoToThreeDteProfile.activationTriggered, true);
  assert.equal(twoToThreeDteProfile.activationMode, "option_floor");
  assertApprox(twoToThreeDteProfile.optionActivationPrice, 2.18);
  assertApprox(twoToThreeDteProfile.profitFloorPct, 0.09);
  assertApprox(twoToThreeDteProfile.lockRatio, 0.63);
  assertApprox(twoToThreeDteProfile.requiredSpotMove, 0.225);
});
