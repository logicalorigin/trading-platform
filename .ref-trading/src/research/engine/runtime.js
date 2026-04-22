// Extracted from ResearchWorkbench.jsx so the research engine can evolve independently
// of the current UI shell.
import { findOptionHistoryBar, normalizeOptionHistoryBars } from "../options/history.js";
import { aggregateBarsToMinutes } from "../data/aggregateBars.js";
import { normalizeResearchStrategy } from "../config/strategyPresets.js";
import { normalizeRayAlgoSettings } from "../config/rayalgoSettings.js";
import { timeframeToMinutes } from "../chart/timeframeModel.js";
import { resolveBacktestV2CandidateSelection } from "../config/backtestV2RuntimeBridge.js";
import {
  getDateTextDayOfWeek,
  getBarTimeMs,
  MARKET_SESSION_CLOSE_MINUTES,
  MARKET_SESSION_OPEN_MINUTES,
} from "../market/time.js";
import { buildResearchTradeId } from "../trades/selection.js";
import {
  RAYALGO_AUTHORITY_SIZE_UPGRADE_ONLY,
  buildRayAlgoSignalScore,
  normalizeRayAlgoScoringConfig,
} from "./rayalgoScoring.js";

function erf(x) {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  let value = Math.abs(x);
  const t = 1 / (1 + p * value);
  value = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-value * value);
  return sign * value;
}

const normCdf = (x) => 0.5 * (1 + erf(x / Math.SQRT2));
const normPdf = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

export const RISK_STOP_DISABLED = "disabled";
export const RISK_STOP_LEGACY_HALT = "legacy_halt";
const TRAIL_HISTORY_PRICE_EPSILON = 0.0005;
const DEFAULT_LAYER_MIN_CONVICTION = 0.48;
const BACKTEST_V2_VIX_BUCKETS = Object.freeze({
  mid: 15,
  high: 20,
  veryHigh: 25,
  extreme: 30,
});

export function normalizeRiskStopPolicy(value) {
  return String(value || "").trim().toLowerCase() === RISK_STOP_DISABLED
    ? RISK_STOP_DISABLED
    : RISK_STOP_LEGACY_HALT;
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
}

function normalizePositionSizingConfig(config = null) {
  const source = config && typeof config === "object" ? config : {};
  const floorPct = clampNumber(source.kellyFloorPct, 0.1, 25, 0.5);
  const ceilingPct = Math.max(
    floorPct,
    clampNumber(source.kellyCeilingPct, floorPct, 25, 5.0),
  );
  const maxPositionPct = clampNumber(source.maxPositionPct, 0.5, 100, 10);
  return {
    kellyLookbackTrades: Math.max(10, Math.round(clampNumber(source.kellyLookbackTrades, 10, 200, 30))),
    kellyFloorPct: floorPct,
    kellyCeilingPct: ceilingPct,
    maxPositionPct,
    maxExposurePct: Math.max(
      maxPositionPct,
      clampNumber(source.maxExposurePct, maxPositionPct, 100, 15),
    ),
  };
}

function normalizeRuntimeRiskStopConfig(config = null, fallbackMaxPositions = 4) {
  const source = config && typeof config === "object" ? config : {};
  const drawdownThrottlePct = clampNumber(source.drawdownThrottlePct, 0, 100, 5);
  return {
    dailyLossLimitPct: clampNumber(source.dailyLossLimitPct, 0, 100, 3),
    consecutiveLossCooldownCount: Math.max(
      0,
      Math.round(clampNumber(source.consecutiveLossCooldownCount, 0, 20, 0)),
    ),
    consecutiveLossCooldownMinutes: Math.max(
      0,
      Math.round(clampNumber(source.consecutiveLossCooldownMinutes, 0, 1440, 0)),
    ),
    drawdownThrottlePct,
    drawdownHaltPct: Math.max(
      drawdownThrottlePct,
      clampNumber(source.drawdownHaltPct, drawdownThrottlePct, 100, 12),
    ),
    maxConcurrentSameDirection: Math.max(
      1,
      Math.round(clampNumber(source.maxConcurrentSameDirection, 1, 50, Math.max(1, fallbackMaxPositions))),
    ),
    maxPositions: Math.max(
      1,
      Math.round(clampNumber(source.maxPositions, 1, 50, Math.max(1, fallbackMaxPositions))),
    ),
    postMaxLossCooldownMinutes: Math.max(
      0,
      Math.round(clampNumber(source.postMaxLossCooldownMinutes, 0, 1440, 0)),
    ),
    persistUntilNewEquityHigh: Boolean(source.persistUntilNewEquityHigh),
  };
}

function optionalClampedNumber(value, min, max, fallback = null) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return fallback;
  }
  return clampNumber(value, min, max, fallback);
}

function normalizeBacktestV2EntryGateConfig(config = null) {
  const source = config && typeof config === "object" ? config : null;
  if (!source) {
    return null;
  }
  const edgeRatioSkip = clampNumber(source.edgeRatioSkip, 0.1, 5, 1.1);
  return {
    edgeRatioSkip,
    edgeRatioHalf: Math.max(
      edgeRatioSkip,
      clampNumber(source.edgeRatioHalf, edgeRatioSkip, 5, 1.3),
    ),
    edgeRatio0dteShift: clampNumber(source.edgeRatio0dteShift, -2, 2, 0.1),
    edgeRatioWeekendShift: clampNumber(source.edgeRatioWeekendShift, -2, 2, 0.15),
    vixConfluenceFloors: {
      low: clampNumber(source.vixConfluenceFloors?.low, 0, 1, 0.55),
      mid: clampNumber(source.vixConfluenceFloors?.mid, 0, 1, 0.7),
      high: clampNumber(source.vixConfluenceFloors?.high, 0, 1, 0.85),
      veryHigh: clampNumber(source.vixConfluenceFloors?.veryHigh, 0, 1, 0.9),
    },
    vix25To30TrendingEdgeShift: clampNumber(source.vix25To30TrendingEdgeShift, -2, 2, 0.1),
    vix30PlusTrendingEdgeShift: clampNumber(source.vix30PlusTrendingEdgeShift, -2, 2, 0.2),
    vix25To30ChoppySkip: Boolean(source.vix25To30ChoppySkip),
    vix30PlusChoppySkip: Boolean(source.vix30PlusChoppySkip),
    regimeExpectedMoveMultipliers: {
      trending: clampNumber(source.regimeExpectedMoveMultipliers?.trending, 0.1, 5, 1.3),
      neutral: clampNumber(source.regimeExpectedMoveMultipliers?.neutral, 0.1, 5, 1),
      choppy: clampNumber(source.regimeExpectedMoveMultipliers?.choppy, 0.1, 5, 0.7),
    },
    mtfConfirmUpgradesSizing: Boolean(source.mtfConfirmUpgradesSizing),
    oppositeDirectionSkip: Boolean(source.oppositeDirectionSkip),
    minConviction: clampNumber(source.minConviction, 0.01, 1, 0.48),
    rayalgoMinQualityScore: optionalClampedNumber(source.rayalgoMinQualityScore, 0, 1, null),
    rayalgoTrendChangeMinQualityScore: optionalClampedNumber(source.rayalgoTrendChangeMinQualityScore, 0, 1, null),
    rayalgoLongMinQualityScore: optionalClampedNumber(source.rayalgoLongMinQualityScore, 0, 1, null),
    rayalgoShortMinQualityScore: optionalClampedNumber(source.rayalgoShortMinQualityScore, 0, 1, null),
    rayalgoTrendChangeLongMinQualityScore: optionalClampedNumber(source.rayalgoTrendChangeLongMinQualityScore, 0, 1, null),
    rayalgoTrendChangeShortMinQualityScore: optionalClampedNumber(source.rayalgoTrendChangeShortMinQualityScore, 0, 1, null),
    allowShorts: Boolean(source.allowShorts),
    regimeFilter: String(source.regimeFilter || "").trim().toLowerCase() === "none"
      ? "none"
      : "not_bear",
  };
}

function normalizeBacktestV2LayerConfig(config = null) {
  const source = config && typeof config === "object" ? config : null;
  if (!source) {
    return null;
  }
  const fractions = Array.isArray(source.layerFractions) && source.layerFractions.length
    ? source.layerFractions
    : [1, 0.5, 0.25];
  return {
    layerFractions: fractions.map((value, index) => clampNumber(value, 0.05, 5, index === 0 ? 1 : index === 1 ? 0.5 : 0.25)),
    edgeBumpMultiplier: clampNumber(source.edgeBumpMultiplier, 1, 5, 1.2),
    edgeSkipThreshold: clampNumber(source.edgeSkipThreshold, 0.5, 5, 1.1),
    maxLayersPerPosition: Math.max(1, Math.round(clampNumber(source.maxLayersPerPosition, 1, 5, 3))),
  };
}

function normalizeBacktestV2ExitGovernorConfig(config = null) {
  const source = config && typeof config === "object" ? config : null;
  if (!source) {
    return null;
  }
  return {
    trailActivationAtr0dte: clampNumber(source.trailActivationAtr0dte, 0.05, 5, 0.4),
    trailActivationAtr1dte: clampNumber(source.trailActivationAtr1dte, 0.05, 5, 0.6),
    trailActivationAtr2to3dte: clampNumber(source.trailActivationAtr2to3dte, 0.05, 5, 0.85),
    trailOptionPnlFloor0dte: clampNumber(source.trailOptionPnlFloor0dte, 0, 5, 0.15),
    trailOptionPnlFloor1dte: clampNumber(source.trailOptionPnlFloor1dte, 0, 5, 0.1),
    trailOptionPnlFloor2to3dte: clampNumber(source.trailOptionPnlFloor2to3dte, 0, 5, 0.08),
    trailEntryDrawdownPct: clampNumber(source.trailEntryDrawdownPct, 0.001, 10, 0.18),
    trailLockRatioInitial: clampNumber(source.trailLockRatioInitial, 0, 1, 0.4),
    trailLockRatioMax: clampNumber(source.trailLockRatioMax, 0, 1, 0.8),
    thetaTighten0dte30min: clampNumber(source.thetaTighten0dte30min, 0, 1, 0.1),
    thetaTighten0dte60min: clampNumber(source.thetaTighten0dte60min, 0, 1, 0.2),
    thetaTighten0dte90min: clampNumber(source.thetaTighten0dte90min, 0, 1, 0.3),
    thetaTighten1to3dte60min: clampNumber(source.thetaTighten1to3dte60min, 0, 1, 0.1),
    thetaTighten1to3dte120min: clampNumber(source.thetaTighten1to3dte120min, 0, 1, 0.15),
    todMultipliers: {
      open: clampNumber(source.todMultipliers?.open, 0.1, 5, 1.2),
      midmorning: clampNumber(source.todMultipliers?.midmorning, 0.1, 5, 1),
      midday: clampNumber(source.todMultipliers?.midday, 0.1, 5, 0.9),
      powerHour: clampNumber(source.todMultipliers?.powerHour, 0.1, 5, 0.85),
    },
    regimeMultipliers: {
      trending: clampNumber(source.regimeMultipliers?.trending, 0.1, 5, 1.15),
      neutral: clampNumber(source.regimeMultipliers?.neutral, 0.1, 5, 1),
      choppy: clampNumber(source.regimeMultipliers?.choppy, 0.1, 5, 0.85),
    },
    timeCliff0dteMinutes: Math.round(clampNumber(source.timeCliff0dteMinutes, 0, 390, 45)),
    timeCliff1to3dteEod: Boolean(source.timeCliff1to3dteEod),
    timeCliff5plusSessions: Math.round(clampNumber(source.timeCliff5plusSessions, 0, 20, 2)),
    timeCliffProfitableOverride: Boolean(source.timeCliffProfitableOverride),
    maxLoss0dtePct: clampNumber(source.maxLoss0dtePct, 0.01, 10, 0.5),
    maxLoss1to3dtePct: clampNumber(source.maxLoss1to3dtePct, 0.01, 10, 0.4),
    maxLoss5plusPct: clampNumber(source.maxLoss5plusPct, 0.01, 10, 0.3),
    takeProfitPct: clampNumber(source.takeProfitPct, 0.01, 10, 0.35),
    zombieBars: Math.round(clampNumber(source.zombieBars, 1, 500, 30)),
  };
}

function normalizeBooleanArray(value = null, fallback = []) {
  if (!Array.isArray(value) || value.length !== fallback.length) {
    return fallback;
  }
  return value.map(Boolean);
}

function normalizeBacktestV2ExecutionPolicyConfig(config = null) {
  const source = config && typeof config === "object" ? config : null;
  if (!source) {
    return null;
  }
  return {
    regimeAdapt: Boolean(source.regimeAdapt),
    commPerContract: clampNumber(source.commPerContract, 0, 25, 0.65),
    slipBps: Math.round(clampNumber(source.slipBps, 0, 5000, 150)),
    tradeDays: normalizeBooleanArray(source.tradeDays, [true, true, true, true, true]),
    sessionBlocks: normalizeBooleanArray(source.sessionBlocks, [true, true, true, true, true, false, false, false, false, false, true, true, false]),
  };
}

function buildTradingDayIndexByDate(bars = []) {
  const map = new Map();
  for (const bar of Array.isArray(bars) ? bars : []) {
    const date = String(bar?.date || "").trim();
    if (!date || map.has(date)) {
      continue;
    }
    map.set(date, map.size);
  }
  return map;
}

function buildAtrByBarTs(bars = [], atrLength = 14, atrSmoothing = 14) {
  const map = new Map();
  if (!Array.isArray(bars) || bars.length < 2) {
    return map;
  }
  const alpha = 2 / (Math.max(1, atrSmoothing) + 1);
  const trueRanges = [];
  let atr = null;
  for (let index = 1; index < bars.length; index += 1) {
    const current = bars[index];
    const previousClose = Number(bars[index - 1]?.c) || Number(current?.o) || Number(current?.c) || 0;
    const high = Number(current?.h) || previousClose;
    const low = Number(current?.l) || previousClose;
    const trueRange = Math.max(
      high - low,
      Math.abs(high - previousClose),
      Math.abs(low - previousClose),
    );
    trueRanges.push(trueRange);
    const sample = trueRanges.slice(Math.max(0, trueRanges.length - atrLength));
    const seed = sample.reduce((sum, value) => sum + value, 0) / Math.max(sample.length, 1);
    atr = atr == null ? seed : alpha * seed + (1 - alpha) * atr;
    const ts = String(current?.ts || "").trim();
    if (ts) {
      map.set(ts, atr);
    }
  }
  return map;
}

function resolveBacktestV2TrailDteBucket(position = {}) {
  const candidates = [
    position?.actualDteAtEntry,
    position?.targetDteAtEntry,
    position?.dte,
  ];
  const dte = candidates.find((value) => Number.isFinite(Number(value)));
  const normalized = Number.isFinite(Number(dte)) ? Number(dte) : null;
  if (normalized != null && normalized <= 0) {
    return "0dte";
  }
  if (normalized != null && normalized <= 1) {
    return "1dte";
  }
  if (normalized != null && normalized <= 3) {
    return "2to3dte";
  }
  return "5plus";
}

function resolveBacktestV2PositionDteBucket(position = {}) {
  const candidates = [
    position?.actualDteAtEntry,
    position?.targetDteAtEntry,
    position?.dte,
  ];
  const dte = candidates.find((value) => Number.isFinite(Number(value)));
  const normalized = Number.isFinite(Number(dte)) ? Number(dte) : null;
  if (normalized != null && normalized <= 0) {
    return "0dte";
  }
  if (normalized != null && normalized <= 3) {
    return "1to3dte";
  }
  return "5plus";
}

function resolveBacktestV2TrailSessionBucket(executionBar = null) {
  const minuteOfDay = Number(executionBar?.hour) * 60 + Number(executionBar?.min);
  if (minuteOfDay < 10 * 60) {
    return "open";
  }
  if (minuteOfDay < 12 * 60) {
    return "midmorning";
  }
  if (minuteOfDay >= 15 * 60) {
    return "powerHour";
  }
  return "midday";
}

function resolveBacktestV2TrailRegimeBucket(regime = null) {
  const label = String(regime?.regime || "").trim().toLowerCase();
  if (label === "bull") {
    return "trending";
  }
  if (label === "bear") {
    return "choppy";
  }
  return "neutral";
}

function resolveBacktestV2ConfluenceFloor(vix = 0, entryGateConfig = null) {
  if (!entryGateConfig) {
    return 0;
  }
  const normalizedVix = Math.max(Number(vix) || 0, 0);
  if (normalizedVix >= BACKTEST_V2_VIX_BUCKETS.veryHigh) {
    return clampNumber(entryGateConfig.vixConfluenceFloors?.veryHigh, 0, 1, 0.9);
  }
  if (normalizedVix >= BACKTEST_V2_VIX_BUCKETS.high) {
    return clampNumber(entryGateConfig.vixConfluenceFloors?.high, 0, 1, 0.85);
  }
  if (normalizedVix >= BACKTEST_V2_VIX_BUCKETS.mid) {
    return clampNumber(entryGateConfig.vixConfluenceFloors?.mid, 0, 1, 0.7);
  }
  return clampNumber(entryGateConfig.vixConfluenceFloors?.low, 0, 1, 0.55);
}

function calculateBacktestV2EdgeRatio({
  conviction = 0,
  vix = 0,
  regime = null,
  entryGateConfig = null,
} = {}) {
  const normalizedConviction = Math.max(Number(conviction) || 0, 0);
  const normalizedVix = Math.max(Number(vix) || 0, 1);
  const dailyImpliedMove = normalizedVix / 100 / Math.sqrt(252);
  const intradayImpliedMove = dailyImpliedMove * Math.sqrt(1 / 6.5);
  const regimeBucket = resolveBacktestV2TrailRegimeBucket(regime);
  const expectedMoveMultiplier = clampNumber(
    entryGateConfig?.regimeExpectedMoveMultipliers?.[regimeBucket],
    0.1,
    5,
    regimeBucket === "trending" ? 1.3 : regimeBucket === "choppy" ? 0.7 : 1,
  );
  const expectedMove = 0.004 * (normalizedConviction / 0.7) * expectedMoveMultiplier;
  if (intradayImpliedMove <= 0) {
    return 1;
  }
  return expectedMove / intradayImpliedMove;
}

function crossesWeekend(dateText, dte) {
  if (!dateText || !Number.isFinite(Number(dte)) || Number(dte) <= 0) {
    return false;
  }
  const date = new Date(`${dateText}T12:00:00Z`);
  const day = date.getUTCDay();
  return (day === 5 && Number(dte) > 0) || (day === 4 && Number(dte) > 1);
}

export function resolveBacktestV2EntryGateDecision({
  signal = null,
  regime = null,
  entryDate = null,
  dte = null,
  conviction = null,
  entryGateConfig = null,
} = {}) {
  const signalStrategy = String(signal?.strategyUsed || signal?.strategy || "").trim().toLowerCase();
  const signalDirection = String(signal?.direction || "").trim().toLowerCase() === "short" ? "short" : "long";
  const signalClass = "trend_change";
  const rayalgoQualityScore = Number(
    signal?.scoring?.effectiveScore
    ?? signal?.scoring?.qualityScore
    ?? signal?.scoring?.score,
  );
  const rayalgoPocketMinQualityScore = signalDirection === "short"
    ? optionalClampedNumber(entryGateConfig?.rayalgoTrendChangeShortMinQualityScore, 0, 1, null)
    : optionalClampedNumber(entryGateConfig?.rayalgoTrendChangeLongMinQualityScore, 0, 1, null);
  const rayalgoQualityFloors = [
    rayalgoPocketMinQualityScore,
    optionalClampedNumber(entryGateConfig?.rayalgoMinQualityScore, 0, 1, null),
    optionalClampedNumber(entryGateConfig?.rayalgoTrendChangeMinQualityScore, 0, 1, null),
    signalDirection === "short"
      ? optionalClampedNumber(entryGateConfig?.rayalgoShortMinQualityScore, 0, 1, null)
      : optionalClampedNumber(entryGateConfig?.rayalgoLongMinQualityScore, 0, 1, null),
  ].filter((value) => Number.isFinite(Number(value))).map(Number);
  const rayalgoRequiredQualityScore = rayalgoQualityFloors.length
    ? Math.max(...rayalgoQualityFloors)
    : null;
  const normalizedConviction = Math.max(
    Number.isFinite(Number(conviction))
      ? Number(conviction)
      : Number(signal?.conviction) || 0,
    0,
  );
  if (!entryGateConfig) {
    return {
      allow: true,
      reason: "legacy",
      edgeRatio: null,
      sizeMultiplier: 1,
      signalClass,
      qualityScore: Number.isFinite(rayalgoQualityScore) ? rayalgoQualityScore : null,
      requiredQualityScore: rayalgoRequiredQualityScore,
      confluenceFloor: 0,
      effectiveSkip: null,
      effectiveHalf: null,
      regimeBucket: resolveBacktestV2TrailRegimeBucket(regime),
    };
  }

  const regimeBucket = resolveBacktestV2TrailRegimeBucket(regime);
  const vix = Math.max(Number(regime?.vix) || 0, 0);
  if (
    regimeBucket === "choppy"
    && vix >= BACKTEST_V2_VIX_BUCKETS.extreme
    && entryGateConfig.vix30PlusChoppySkip
  ) {
    return {
      allow: false,
      reason: "vix_30_plus_choppy_skip",
      edgeRatio: 0,
      sizeMultiplier: 0,
      signalClass,
      qualityScore: Number.isFinite(rayalgoQualityScore) ? rayalgoQualityScore : null,
      requiredQualityScore: rayalgoRequiredQualityScore,
      confluenceFloor: resolveBacktestV2ConfluenceFloor(vix, entryGateConfig),
      effectiveSkip: null,
      effectiveHalf: null,
      regimeBucket,
    };
  }
  if (
    regimeBucket === "choppy"
    && vix >= BACKTEST_V2_VIX_BUCKETS.veryHigh
    && entryGateConfig.vix25To30ChoppySkip
  ) {
    return {
      allow: false,
      reason: "vix_25_30_choppy_skip",
      edgeRatio: 0,
      sizeMultiplier: 0,
      signalClass,
      qualityScore: Number.isFinite(rayalgoQualityScore) ? rayalgoQualityScore : null,
      requiredQualityScore: rayalgoRequiredQualityScore,
      confluenceFloor: resolveBacktestV2ConfluenceFloor(vix, entryGateConfig),
      effectiveSkip: null,
      effectiveHalf: null,
      regimeBucket,
    };
  }

  const confluenceFloor = resolveBacktestV2ConfluenceFloor(vix, entryGateConfig);
  if (normalizedConviction < confluenceFloor) {
    return {
      allow: false,
      reason: "confluence_floor",
      edgeRatio: 0,
      sizeMultiplier: 0,
      confluenceFloor,
      effectiveSkip: null,
      effectiveHalf: null,
      regimeBucket,
    };
  }

  if (signalStrategy === "rayalgo" && Number.isFinite(rayalgoRequiredQualityScore)) {
    if (!Number.isFinite(rayalgoQualityScore)) {
      return {
        allow: false,
        reason: "rayalgo_quality_missing",
        edgeRatio: 0,
        sizeMultiplier: 0,
        signalClass,
        qualityScore: null,
        requiredQualityScore: rayalgoRequiredQualityScore,
        confluenceFloor,
        effectiveSkip: null,
        effectiveHalf: null,
        regimeBucket,
      };
    }
    if (rayalgoQualityScore < rayalgoRequiredQualityScore) {
      return {
        allow: false,
        reason: "rayalgo_quality_floor",
        edgeRatio: 0,
        sizeMultiplier: 0,
        signalClass,
        qualityScore: rayalgoQualityScore,
        requiredQualityScore: rayalgoRequiredQualityScore,
        confluenceFloor,
        effectiveSkip: null,
        effectiveHalf: null,
        regimeBucket,
      };
    }
  }

  const edgeRatio = calculateBacktestV2EdgeRatio({
    conviction: normalizedConviction,
    vix,
    regime,
    entryGateConfig,
  });
  let effectiveSkip = clampNumber(entryGateConfig.edgeRatioSkip, 0.1, 5, 1.1);
  let effectiveHalf = Math.max(
    effectiveSkip,
    clampNumber(entryGateConfig.edgeRatioHalf, effectiveSkip, 5, 1.3),
  );
  if (Number(dte) === 0) {
    effectiveSkip += clampNumber(entryGateConfig.edgeRatio0dteShift, -2, 2, 0.1);
    effectiveHalf += clampNumber(entryGateConfig.edgeRatio0dteShift, -2, 2, 0.1);
  }
  if (crossesWeekend(entryDate, dte)) {
    effectiveSkip += clampNumber(entryGateConfig.edgeRatioWeekendShift, -2, 2, 0.15);
    effectiveHalf += clampNumber(entryGateConfig.edgeRatioWeekendShift, -2, 2, 0.15);
  }
  if (regimeBucket === "trending" && vix >= BACKTEST_V2_VIX_BUCKETS.extreme) {
    effectiveSkip += clampNumber(entryGateConfig.vix30PlusTrendingEdgeShift, -2, 2, 0.2);
    effectiveHalf += clampNumber(entryGateConfig.vix30PlusTrendingEdgeShift, -2, 2, 0.2);
  } else if (regimeBucket === "trending" && vix >= BACKTEST_V2_VIX_BUCKETS.veryHigh) {
    effectiveSkip += clampNumber(entryGateConfig.vix25To30TrendingEdgeShift, -2, 2, 0.1);
    effectiveHalf += clampNumber(entryGateConfig.vix25To30TrendingEdgeShift, -2, 2, 0.1);
  }

  if (edgeRatio < effectiveSkip) {
    return {
      allow: false,
      reason: "edge_ratio_skip",
      edgeRatio,
      sizeMultiplier: 0,
      signalClass,
      qualityScore: Number.isFinite(rayalgoQualityScore) ? rayalgoQualityScore : null,
      requiredQualityScore: rayalgoRequiredQualityScore,
      confluenceFloor,
      effectiveSkip,
      effectiveHalf,
      regimeBucket,
    };
  }

  const sizeMultiplier = edgeRatio < effectiveHalf ? 0.5 : 1;
  return {
    allow: true,
    reason: sizeMultiplier < 1 ? "half_size" : "full_size",
    edgeRatio,
    sizeMultiplier,
    signalClass,
    qualityScore: Number.isFinite(rayalgoQualityScore) ? rayalgoQualityScore : null,
    requiredQualityScore: rayalgoRequiredQualityScore,
    confluenceFloor,
    effectiveSkip,
    effectiveHalf,
    regimeBucket,
  };
}

export function resolveBacktestV2RiskControlDecision({
  riskStopPolicy = RISK_STOP_LEGACY_HALT,
  riskStopConfig = null,
  currentCapital = 0,
  peakCapital = 0,
  initialCapital = 0,
  dayPnl = 0,
  barTimeMs = null,
  direction = "long",
  consecutiveLosses = 0,
  lastLossTsMs = null,
  lastMaxLossTsMs = null,
  persistentHaltResumeCapital = null,
} = {}) {
  const config = normalizeRuntimeRiskStopConfig(riskStopConfig, 4);
  const peakDrawdownPct = peakCapital > 0
    ? ((peakCapital - currentCapital) / peakCapital) * 100
    : 0;
  const dailyLossLimit = initialCapital > 0
    ? initialCapital * config.dailyLossLimitPct / 100
    : 0;
  const dayLossPct = initialCapital > 0
    ? (Math.max(-dayPnl, 0) / initialCapital) * 100
    : 0;
  const hitDrawdownLimit = riskStopPolicy === RISK_STOP_LEGACY_HALT
    && config.drawdownHaltPct > 0
    && peakDrawdownPct >= config.drawdownHaltPct;
  const hitDayLossLimit = riskStopPolicy === RISK_STOP_LEGACY_HALT
    && dailyLossLimit > 0
    && dayPnl <= -dailyLossLimit;
  const persistActive = config.persistUntilNewEquityHigh
    && Number.isFinite(Number(persistentHaltResumeCapital))
    && currentCapital < Number(persistentHaltResumeCapital);
  if (hitDrawdownLimit || hitDayLossLimit || persistActive) {
    return {
      allowEntries: false,
      haltTrading: true,
      reason: hitDrawdownLimit
        ? "max_drawdown"
        : hitDayLossLimit
          ? "day_loss"
          : "persist_until_new_equity_high",
      peakDrawdownPct,
      dayLossPct,
      hitDrawdownLimit,
      hitDayLossLimit,
      persistActive,
    };
  }

  if (
    config.consecutiveLossCooldownCount > 0
    && consecutiveLosses >= config.consecutiveLossCooldownCount
    && Number.isFinite(Number(barTimeMs))
    && Number.isFinite(Number(lastLossTsMs))
    && (Number(barTimeMs) - Number(lastLossTsMs)) < config.consecutiveLossCooldownMinutes * 60000
  ) {
    return {
      allowEntries: false,
      haltTrading: false,
      reason: "consecutive_loss_cooldown",
      peakDrawdownPct,
      dayLossPct,
      hitDrawdownLimit: false,
      hitDayLossLimit: false,
      persistActive: false,
    };
  }

  if (
    config.postMaxLossCooldownMinutes > 0
    && Number.isFinite(Number(barTimeMs))
    && Number.isFinite(Number(lastMaxLossTsMs))
    && (Number(barTimeMs) - Number(lastMaxLossTsMs)) < config.postMaxLossCooldownMinutes * 60000
  ) {
    return {
      allowEntries: false,
      haltTrading: false,
      reason: `post_max_loss_cooldown_${String(direction || "long").trim().toLowerCase()}`,
      peakDrawdownPct,
      dayLossPct,
      hitDrawdownLimit: false,
      hitDayLossLimit: false,
      persistActive: false,
    };
  }

  return {
    allowEntries: true,
    haltTrading: false,
    reason: null,
    peakDrawdownPct,
    dayLossPct,
    hitDrawdownLimit: false,
    hitDayLossLimit: false,
    persistActive: false,
  };
}

export function resolveBacktestV2StopLossPct({
  position = null,
  legacyStopLossPct = 0.25,
  exitGovernorConfig = null,
} = {}) {
  const fallback = clampNumber(legacyStopLossPct, 0.001, 10, 0.25);
  if (!exitGovernorConfig) {
    return fallback;
  }
  const bucket = resolveBacktestV2PositionDteBucket(position);
  if (bucket === "0dte") {
    return clampNumber(exitGovernorConfig.maxLoss0dtePct, 0.01, 10, fallback);
  }
  if (bucket === "1to3dte") {
    return clampNumber(exitGovernorConfig.maxLoss1to3dtePct, 0.01, 10, fallback);
  }
  return clampNumber(exitGovernorConfig.maxLoss5plusPct, 0.01, 10, fallback);
}

function resolveBacktestV2HeldMinutes(position = {}, executionBar = null) {
  const startMs = new Date(position?.ts || "").getTime();
  const endMs = new Date(executionBar?.ts || "").getTime();
  if (Number.isFinite(startMs) && Number.isFinite(endMs)) {
    return Math.max(0, Math.round((endMs - startMs) / 60000));
  }
  const startDate = String(position?.entryDate || "").trim();
  const endDate = String(executionBar?.date || "").trim();
  const startMinute = Number(position?.entryMinuteOfDay);
  const endMinute = Number(executionBar?.hour) * 60 + Number(executionBar?.min);
  if (startDate && endDate && startDate === endDate && Number.isFinite(startMinute) && Number.isFinite(endMinute)) {
    return Math.max(0, endMinute - startMinute);
  }
  return 0;
}

function resolveBacktestV2HeldSessions(position = {}, executionBar = null, tradingDayIndexByDate = null) {
  const startDate = String(position?.entryDate || "").trim();
  const endDate = String(executionBar?.date || "").trim();
  if (!startDate || !endDate) {
    return 1;
  }
  const startIndex = tradingDayIndexByDate?.get(startDate);
  const endIndex = tradingDayIndexByDate?.get(endDate);
  if (Number.isFinite(startIndex) && Number.isFinite(endIndex)) {
    return Math.max(1, endIndex - startIndex + 1);
  }
  return startDate === endDate ? 1 : 2;
}

export function resolveBacktestV2TimeCliffDecision({
  position = null,
  executionBar = null,
  pricePerformance = 0,
  exitGovernorConfig = null,
  tradingDayIndexByDate = null,
} = {}) {
  if (!position || !executionBar || !exitGovernorConfig) {
    return null;
  }
  if (exitGovernorConfig.timeCliffProfitableOverride && Number(pricePerformance) > 0) {
    return null;
  }

  const bucket = resolveBacktestV2PositionDteBucket(position);
  const marketMinutes = Number(executionBar?.hour) * 60 + Number(executionBar?.min);
  if (bucket === "0dte") {
    const heldMinutes = resolveBacktestV2HeldMinutes(position, executionBar);
    if (heldMinutes >= exitGovernorConfig.timeCliff0dteMinutes) {
      return {
        reason: "time_cliff_0dte",
        heldMinutes,
        heldSessions: 1,
      };
    }
    return null;
  }

  if (marketMinutes < MARKET_SESSION_CLOSE_MINUTES - 5) {
    return null;
  }

  if (bucket === "1to3dte") {
    if (exitGovernorConfig.timeCliff1to3dteEod && executionBar.date !== position.expiryDate) {
      return {
        reason: "time_cliff_1to3dte_eod",
        heldMinutes: resolveBacktestV2HeldMinutes(position, executionBar),
        heldSessions: resolveBacktestV2HeldSessions(position, executionBar, tradingDayIndexByDate),
      };
    }
    return null;
  }

  const heldSessions = resolveBacktestV2HeldSessions(position, executionBar, tradingDayIndexByDate);
  if (exitGovernorConfig.timeCliff5plusSessions > 0 && heldSessions >= exitGovernorConfig.timeCliff5plusSessions) {
    return {
      reason: "time_cliff_5plus_sessions",
      heldMinutes: resolveBacktestV2HeldMinutes(position, executionBar),
      heldSessions,
    };
  }
  return null;
}

export function resolveBacktestV2TrailProfile({
  position = null,
  executionBar = null,
  priceRange = null,
  trailStartPct = 0.08,
  exitGovernorConfig = null,
  spotAtr = null,
  regime = null,
} = {}) {
  const fallbackActivationPct = exitGovernorConfig
    ? 0
    : clampNumber(trailStartPct, 0.001, 10, 0.08);
  const baseActivationPrice = position?.oe * (1 + fallbackActivationPct);
  if (!position || !executionBar || !priceRange || !exitGovernorConfig) {
    const activationTriggered = Number.isFinite(Number(priceRange?.high))
      && Number(priceRange.high) >= baseActivationPrice;
    return {
      optionActivationPrice: baseActivationPrice,
      activationTriggered,
      activationMode: activationTriggered ? "legacy" : null,
      profitFloorPct: fallbackActivationPct,
      requiredSpotMove: null,
      favorableSpotMove: null,
      lockRatio: null,
    };
  }

  const trailBucket = resolveBacktestV2TrailDteBucket(position);
  const sessionBucket = resolveBacktestV2TrailSessionBucket(executionBar);
  const regimeBucket = resolveBacktestV2TrailRegimeBucket(regime);
  const todMultiplier = exitGovernorConfig.todMultipliers?.[sessionBucket] ?? 1;
  const regimeMultiplier = exitGovernorConfig.regimeMultipliers?.[regimeBucket] ?? 1;
  const heldMinutes = resolveBacktestV2HeldMinutes(position, executionBar);
  let profitFloorPct = fallbackActivationPct;
  let requiredSpotMove = null;
  let lockRatio = clampNumber(
    exitGovernorConfig.trailLockRatioInitial,
    0,
    1,
    0.4,
  );

  if (trailBucket === "0dte") {
    profitFloorPct = Math.max(
      fallbackActivationPct,
      clampNumber(exitGovernorConfig.trailOptionPnlFloor0dte, 0, 10, 0.15),
    );
    if (Number.isFinite(Number(spotAtr)) && Number(spotAtr) > 0) {
      requiredSpotMove = Number(spotAtr)
        * clampNumber(exitGovernorConfig.trailActivationAtr0dte, 0.05, 5, 0.4)
        * todMultiplier
        * regimeMultiplier;
    }
    if (heldMinutes >= 30) {
      lockRatio += clampNumber(exitGovernorConfig.thetaTighten0dte30min, 0, 1, 0.1);
    }
    if (heldMinutes >= 60) {
      lockRatio += clampNumber(exitGovernorConfig.thetaTighten0dte60min, 0, 1, 0.2);
    }
    if (heldMinutes >= 90) {
      lockRatio += clampNumber(exitGovernorConfig.thetaTighten0dte90min, 0, 1, 0.3);
    }
  } else if (trailBucket === "1dte") {
    profitFloorPct = Math.max(
      fallbackActivationPct,
      clampNumber(exitGovernorConfig.trailOptionPnlFloor1dte, 0, 10, 0.1),
    );
    if (Number.isFinite(Number(spotAtr)) && Number(spotAtr) > 0) {
      requiredSpotMove = Number(spotAtr)
        * clampNumber(exitGovernorConfig.trailActivationAtr1dte, 0.05, 5, 0.6)
        * todMultiplier
        * regimeMultiplier;
    }
    if (heldMinutes >= 60) {
      lockRatio += clampNumber(exitGovernorConfig.thetaTighten1to3dte60min, 0, 1, 0.1);
    }
    if (heldMinutes >= 120) {
      lockRatio += clampNumber(exitGovernorConfig.thetaTighten1to3dte120min, 0, 1, 0.15);
    }
  } else if (trailBucket === "2to3dte") {
    profitFloorPct = Math.max(
      fallbackActivationPct,
      clampNumber(exitGovernorConfig.trailOptionPnlFloor2to3dte, 0, 10, 0.08),
    );
    if (Number.isFinite(Number(spotAtr)) && Number(spotAtr) > 0) {
      requiredSpotMove = Number(spotAtr)
        * clampNumber(exitGovernorConfig.trailActivationAtr2to3dte, 0.05, 5, 0.85)
        * todMultiplier
        * regimeMultiplier;
    }
    if (heldMinutes >= 60) {
      lockRatio += clampNumber(exitGovernorConfig.thetaTighten1to3dte60min, 0, 1, 0.1);
    }
    if (heldMinutes >= 120) {
      lockRatio += clampNumber(exitGovernorConfig.thetaTighten1to3dte120min, 0, 1, 0.15);
    }
  }

  lockRatio = Math.min(
    clampNumber(exitGovernorConfig.trailLockRatioMax, 0, 1, 0.8),
    Math.max(0, lockRatio),
  );
  const optionActivationPrice = position.oe * (1 + profitFloorPct);
  const entrySpotPrice = Number.isFinite(Number(position.entrySpotPrice))
    ? Number(position.entrySpotPrice)
    : (Number.isFinite(Number(position.sp)) ? Number(position.sp) : null);
  const favorableSpot = position.ic ? Number(executionBar?.h) : Number(executionBar?.l);
  const favorableSpotMove = Number.isFinite(entrySpotPrice) && Number.isFinite(favorableSpot)
    ? Math.max(0, position.ic ? favorableSpot - entrySpotPrice : entrySpotPrice - favorableSpot)
    : null;
  const optionActivation = Number(priceRange.high) >= optionActivationPrice;
  const spotActivation = Number.isFinite(Number(requiredSpotMove))
    && Number(requiredSpotMove) > 0
    && Number.isFinite(Number(favorableSpotMove))
    && Number(favorableSpotMove) >= Number(requiredSpotMove);
  return {
    optionActivationPrice,
    activationTriggered: optionActivation || spotActivation,
    activationMode: spotActivation && !optionActivation
      ? "spot_atr"
      : optionActivation
        ? "option_floor"
        : null,
    profitFloorPct,
    requiredSpotMove,
    favorableSpotMove,
    lockRatio,
  };
}

export function resolveBacktestV2LayerPlan({
  layerConfig = null,
  openSameDirectionCount = 0,
  score = null,
  conviction = null,
  minConviction = DEFAULT_LAYER_MIN_CONVICTION,
} = {}) {
  const normalizedOpenCount = Math.max(0, Math.round(Number(openSameDirectionCount) || 0));
  const normalizedScore = Number.isFinite(Number(score))
    ? Number(score)
    : (Number.isFinite(Number(conviction)) ? Number(conviction) : 0);
  if (!layerConfig) {
    return {
      allow: true,
      reason: null,
      layerIndex: normalizedOpenCount,
      layerNumber: normalizedOpenCount + 1,
      edgeRatio: normalizedScore / Math.max(Number(minConviction) || DEFAULT_LAYER_MIN_CONVICTION, 0.01),
      baseFraction: 1,
      sizeMultiplier: 1,
      edgeBumpApplied: false,
      maxLayersPerPosition: null,
    };
  }

  const edgeFloor = Math.max(Number(minConviction) || DEFAULT_LAYER_MIN_CONVICTION, 0.01);
  const edgeRatio = normalizedScore / edgeFloor;
  const maxLayersPerPosition = Math.max(1, Math.round(Number(layerConfig.maxLayersPerPosition) || 1));
  if (normalizedOpenCount >= maxLayersPerPosition) {
    return {
      allow: false,
      reason: "max_layers",
      layerIndex: normalizedOpenCount,
      layerNumber: normalizedOpenCount + 1,
      edgeRatio,
      baseFraction: 0,
      sizeMultiplier: 0,
      edgeBumpApplied: false,
      maxLayersPerPosition,
    };
  }

  if (normalizedOpenCount > 0 && edgeRatio < layerConfig.edgeSkipThreshold) {
    return {
      allow: false,
      reason: "edge_below_threshold",
      layerIndex: normalizedOpenCount,
      layerNumber: normalizedOpenCount + 1,
      edgeRatio,
      baseFraction: 0,
      sizeMultiplier: 0,
      edgeBumpApplied: false,
      maxLayersPerPosition,
    };
  }

  const fractionIndex = Math.min(
    normalizedOpenCount,
    Math.max((layerConfig.layerFractions?.length || 1) - 1, 0),
  );
  const baseFraction = clampNumber(
    layerConfig.layerFractions?.[fractionIndex],
    0.05,
    5,
    fractionIndex === 0 ? 1 : fractionIndex === 1 ? 0.5 : 0.25,
  );
  const edgeBumpApplied = normalizedOpenCount > 0 && edgeRatio >= layerConfig.edgeSkipThreshold;
  return {
    allow: true,
    reason: null,
    layerIndex: normalizedOpenCount,
    layerNumber: normalizedOpenCount + 1,
    edgeRatio,
    baseFraction,
    sizeMultiplier: baseFraction * (edgeBumpApplied ? layerConfig.edgeBumpMultiplier : 1),
    edgeBumpApplied,
    maxLayersPerPosition,
  };
}

function pushTrailStopHistory(position, {
  ts,
  trailStopPrice,
  referenceOptionPrice = null,
  referenceSpotPrice = null,
} = {}) {
  if (!position || !ts) {
    return;
  }
  const value = Number(trailStopPrice);
  if (!Number.isFinite(value) || value <= 0) {
    return;
  }
  const history = Array.isArray(position.trailStopHistory)
    ? position.trailStopHistory
    : [];
  const lastEntry = history[history.length - 1] || null;
  if (
    lastEntry
    && String(lastEntry.ts || "") === String(ts)
    && Math.abs(Number(lastEntry.value) - value) <= TRAIL_HISTORY_PRICE_EPSILON
  ) {
    if (Number.isFinite(Number(referenceOptionPrice))) {
      lastEntry.referenceOptionPrice = Number(referenceOptionPrice);
    }
    if (Number.isFinite(Number(referenceSpotPrice))) {
      lastEntry.referenceSpotPrice = Number(referenceSpotPrice);
    }
    position.trailStopHistory = history;
    return;
  }
  if (lastEntry && Math.abs(Number(lastEntry.value) - value) <= TRAIL_HISTORY_PRICE_EPSILON) {
    return;
  }
  history.push({
    ts: String(ts),
    value,
    referenceOptionPrice: Number.isFinite(Number(referenceOptionPrice)) ? Number(referenceOptionPrice) : null,
    referenceSpotPrice: Number.isFinite(Number(referenceSpotPrice)) ? Number(referenceSpotPrice) : null,
  });
  position.trailStopHistory = history;
}

export function addTradingDays(dateStr, n) {
  if (n <= 0) {
    return dateStr;
  }
  const date = new Date(`${dateStr}T12:00:00Z`);
  let added = 0;
  while (added < n) {
    date.setUTCDate(date.getUTCDate() + 1);
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) {
      added += 1;
    }
  }
  return date.toISOString().slice(0, 10);
}

export function calendarDaysTo(fromDate, fromHour, fromMinute, toDate) {
  const sessionMinutes = MARKET_SESSION_CLOSE_MINUTES - MARKET_SESSION_OPEN_MINUTES;

  if (fromDate > toDate) {
    return 0.001;
  }

  if (fromDate === toDate) {
    const nowMinutes = fromHour * 60 + fromMinute;
    const remainingMinutes = Math.max(MARKET_SESSION_CLOSE_MINUTES - nowMinutes, 1);
    return Math.max((remainingMinutes / sessionMinutes) * (1 / 365.25), 0.001);
  }

  const nowMinutes = fromHour * 60 + fromMinute;
  const todayFraction = Math.max(MARKET_SESSION_CLOSE_MINUTES - nowMinutes, 0) / sessionMinutes;
  const startDate = new Date(`${fromDate}T12:00:00Z`);
  const endDate = new Date(`${toDate}T12:00:00Z`);
  const calendarDays = (endDate - startDate) / 86400000;
  return Math.max((todayFraction + calendarDays) / 365.25, 0.001);
}

export function ivForDTE(baseIv, calendarDteYears) {
  const dteDays = calendarDteYears * 365.25;
  if (dteDays <= 0.15) return baseIv * 2.0;
  if (dteDays <= 1.5) return baseIv * 1.5;
  if (dteDays <= 3.5) return baseIv * 1.3;
  if (dteDays <= 6) return baseIv * 1.15;
  if (dteDays <= 10) return baseIv * 1.08;
  if (dteDays <= 16) return baseIv * 1.0;
  if (dteDays <= 25) return baseIv * 0.97;
  return baseIv * 0.95;
}

export function spreadModel(calendarDteYears, premium, marketHourDecimal) {
  const dteDays = calendarDteYears * 365.25;
  let spreadPct = 0.02;
  if (dteDays < 0.15) spreadPct = 0.08;
  else if (dteDays < 1.5) spreadPct = 0.05;
  else if (dteDays < 5) spreadPct = 0.03;

  if (marketHourDecimal >= 15.5) spreadPct *= 1.3;
  if (marketHourDecimal < 10.25) spreadPct *= 1.2;
  return Math.max((premium * spreadPct) / 2, 0.01);
}

export function priceOption(spot, strike, dte, iv, isCall = true, rate = 0.045) {
  if (dte <= 0 || iv <= 0) {
    return Math.max(isCall ? spot - strike : strike - spot, 0);
  }
  const years = dte / 365;
  const sqrtYears = Math.sqrt(years);
  const d1 = (Math.log(spot / strike) + (rate + 0.5 * iv * iv) * years) / (iv * sqrtYears);
  const d2 = d1 - iv * sqrtYears;
  return isCall
    ? spot * normCdf(d1) - strike * Math.exp(-rate * years) * normCdf(d2)
    : strike * Math.exp(-rate * years) * normCdf(-d2) - spot * normCdf(-d1);
}

export function bsGreeks(spot, strike, dte, iv, isCall = true, rate = 0.045) {
  if (dte <= 0 || iv <= 0) {
    return {
      delta: (isCall && spot > strike) || (!isCall && spot < strike) ? 1 : 0,
      gamma: 0,
      theta: 0,
      vega: 0,
    };
  }
  const years = dte / 365;
  const sqrtYears = Math.sqrt(years);
  const d1 = (Math.log(spot / strike) + (rate + 0.5 * iv * iv) * years) / (iv * sqrtYears);
  const d2 = d1 - iv * sqrtYears;
  const nd1 = normPdf(d1);
  return {
    delta: isCall ? normCdf(d1) : normCdf(d1) - 1,
    gamma: nd1 / (spot * iv * sqrtYears),
    theta: (
      isCall
        ? (-(spot * nd1 * iv) / (2 * sqrtYears) - rate * strike * Math.exp(-rate * years) * normCdf(d2))
        : (-(spot * nd1 * iv) / (2 * sqrtYears) + rate * strike * Math.exp(-rate * years) * normCdf(-d2))
    ) / 365,
    vega: (spot * nd1 * sqrtYears) / 100,
  };
}

function calcEma(values, period) {
  if (values.length < period) {
    return values[values.length - 1] || 0;
  }
  const alpha = 2 / (period + 1);
  let ema = values[values.length - period];
  for (let index = values.length - period + 1; index < values.length; index += 1) {
    ema = alpha * values[index] + (1 - alpha) * ema;
  }
  return ema;
}

function calcRsi(closes, period = 14) {
  if (closes.length < period + 1) {
    return 50;
  }
  const sample = closes.slice(-(period + 1));
  let gains = 0;
  let losses = 0;
  for (let index = 1; index < sample.length; index += 1) {
    const delta = sample[index] - sample[index - 1];
    if (delta > 0) gains += delta;
    else losses -= delta;
  }
  return 100 - 100 / (1 + gains / Math.max(losses, 0.001));
}

function vwapBands(bars, sigma = 1.5) {
  if (bars.length < 5) {
    const price = bars[bars.length - 1].c;
    return [price, price, price];
  }
  let cumulativeVolume = 0;
  let cumulativeTpVolume = 0;
  let cumulativeSquaredDistance = 0;
  for (const bar of bars) {
    const typicalPrice = (bar.h + bar.l + bar.c) / 3;
    const volume = Math.max(bar.v, 1);
    cumulativeVolume += volume;
    cumulativeTpVolume += typicalPrice * volume;
    const vwap = cumulativeTpVolume / cumulativeVolume;
    cumulativeSquaredDistance += ((typicalPrice - vwap) ** 2) * volume;
  }
  const vwap = cumulativeTpVolume / cumulativeVolume;
  const band = sigma * Math.sqrt(Math.max(0, cumulativeSquaredDistance / cumulativeVolume));
  return [vwap, vwap + band, vwap - band];
}

function calcAtrSeries(bars, atrLength = 14, atrSmoothing = 14) {
  if (!Array.isArray(bars) || bars.length < 3) {
    return 0;
  }
  const trueRanges = [];
  for (let index = 1; index < bars.length; index += 1) {
    const current = bars[index];
    const previousClose = Number(bars[index - 1]?.c) || Number(current?.o) || Number(current?.c) || 0;
    const high = Number(current?.h) || previousClose;
    const low = Number(current?.l) || previousClose;
    trueRanges.push(Math.max(
      high - low,
      Math.abs(high - previousClose),
      Math.abs(low - previousClose),
    ));
  }
  if (!trueRanges.length) {
    return 0;
  }
  const atrSeed = [];
  for (let index = 0; index < trueRanges.length; index += 1) {
    const sample = trueRanges.slice(Math.max(0, index - atrLength + 1), index + 1);
    atrSeed.push(sample.reduce((sum, value) => sum + value, 0) / sample.length);
  }
  return calcEma(atrSeed, Math.max(1, atrSmoothing));
}

function analyzeTech(bar, lookbackBars, swingState, regime = "range", adapt = false, rayalgoSettings = null) {
  const signal = {
    emaBias: 0,
    rsi: 50,
    rsi7: 50,
    rsiSig: 0,
    vPos: 0,
    vPos2: 0,
    volSurge: false,
    volRatio: 1,
    mktStr: 0,
    sweep: false,
    sweepDir: 0,
    ob: false,
    obDir: 0,
    fvg: false,
    fvgDir: 0,
    emaStack: 0,
    macdLine: 0,
    macdCross: 0,
    bbPos: 0,
    bbSqueeze: false,
    bodyDir: 0,
    e8: 0,
    e13: 0,
    mom: 0,
    rev: 0,
    emaCross: 0,
    emaCrossAge: 999,
    bosRecent: 0,
    chochRecent: 0,
    rayConv: 0,
    e9: 0,
    e21: 0,
    e50: 0,
    sweepLevel: null,
    bosLevel: null,
    chochLevel: null,
    obTop: null,
    obBottom: null,
    obAnchorTs: null,
    fvgTop: null,
    fvgBottom: null,
    fvgAnchorTs: null,
    bandBasis: null,
    bandUpper: null,
    bandLower: null,
    bandTrend: 0,
    bandRetest: 0,
  };
  if (lookbackBars.length < 30) {
    return signal;
  }

  const normalizedRayAlgoSettings = normalizeRayAlgoSettings(rayalgoSettings || {});
  const timeHorizon = Math.max(4, Math.min(40, normalizedRayAlgoSettings.marketStructure.timeHorizon));
  const bosConfirmation = normalizedRayAlgoSettings.marketStructure.bosConfirmation;
  const waitForBarClose = normalizedRayAlgoSettings.appearance.waitForBarClose;
  const bandBasisLength = normalizedRayAlgoSettings.bands.basisLength;
  const bandAtrLength = normalizedRayAlgoSettings.bands.atrLength;
  const bandAtrSmoothing = normalizedRayAlgoSettings.bands.atrSmoothing;
  const bandVolatilityMultiplier = normalizedRayAlgoSettings.bands.volatilityMultiplier;
  const sampleBars = [...lookbackBars, bar];
  const closes = sampleBars.map((candidate) => candidate.c);
  const highs = sampleBars.map((candidate) => candidate.h);
  const lows = sampleBars.map((candidate) => candidate.l);
  const volumes = sampleBars.map((candidate) => candidate.v);

  const ema5 = calcEma(closes, 5);
  signal.e8 = calcEma(closes, 8);
  const emaFast = calcEma(closes, 9);
  signal.e13 = calcEma(closes, 13);
  const emaSlow = calcEma(closes, 21);
  const emaTrend = calcEma(closes, 50);
  signal.e9 = emaFast;
  signal.e21 = emaSlow;
  signal.e50 = emaTrend;

  if (emaFast > emaSlow && emaSlow > emaTrend) signal.emaBias = 1;
  else if (emaFast < emaSlow && emaSlow < emaTrend) signal.emaBias = -1;

  if (ema5 > signal.e8 && signal.e8 > signal.e13 && signal.e13 > emaSlow) signal.emaStack = 1;
  else if (ema5 < signal.e8 && signal.e8 < signal.e13 && signal.e13 < emaSlow) signal.emaStack = -1;

  if (closes.length >= 22) {
    const previousCloses = closes.slice(0, -1);
    const previousEmaFast = calcEma(previousCloses, 9);
    const previousEmaSlow = calcEma(previousCloses, 21);
    if (emaFast > emaSlow && previousEmaFast <= previousEmaSlow) signal.emaCross = 1;
    else if (emaFast < emaSlow && previousEmaFast >= previousEmaSlow) signal.emaCross = -1;

    signal.emaCrossAge = 0;
    for (let index = closes.length - 2; index >= Math.max(0, closes.length - 50); index -= 1) {
      const sampleFast = calcEma(closes.slice(0, index + 1), 9);
      const sampleSlow = calcEma(closes.slice(0, index + 1), 21);
      if ((emaFast > emaSlow) !== (sampleFast > sampleSlow)) break;
      signal.emaCrossAge += 1;
    }
  }

  signal.rsi = calcRsi(closes, 14);
  signal.rsi7 = calcRsi(closes, 7);
  if (signal.rsi < 30) signal.rsiSig = 1;
  else if (signal.rsi > 70) signal.rsiSig = -1;

  const [_, upperBand, lowerBand] = vwapBands(lookbackBars);
  const [, upperBandWide, lowerBandWide] = vwapBands(lookbackBars, 2.5);
  if (bar.c > upperBand) signal.vPos = 1;
  else if (bar.c < lowerBand) signal.vPos = -1;
  if (bar.c > upperBandWide) signal.vPos2 = 1;
  else if (bar.c < lowerBandWide) signal.vPos2 = -1;

  const avgVolume = volumes.slice(-20).reduce((sum, value) => sum + value, 0) / Math.min(20, volumes.length);
  signal.volRatio = bar.v / Math.max(avgVolume, 1);
  signal.volSurge = signal.volRatio > 1.5;
  signal.bodyDir = bar.c > bar.o ? 1 : bar.c < bar.o ? -1 : 0;

  if (closes.length >= 27) {
    const ema12 = calcEma(closes, 12);
    const ema26 = calcEma(closes, 26);
    signal.macdLine = ema12 - ema26;
    const previousCloses = closes.slice(0, -1);
    if (previousCloses.length >= 26) {
      const previousMacd = calcEma(previousCloses, 12) - calcEma(previousCloses, 26);
      if (signal.macdLine > 0 && previousMacd <= 0) signal.macdCross = 1;
      else if (signal.macdLine < 0 && previousMacd >= 0) signal.macdCross = -1;
    }
  }

  if (closes.length >= 20) {
    const sample = closes.slice(-20);
    const sma = sample.reduce((sum, value) => sum + value, 0) / 20;
    const stdDev = Math.sqrt(sample.reduce((sum, value) => sum + (value - sma) ** 2, 0) / 20);
    signal.bbPos = bar.c > sma + 2 * stdDev ? 1 : bar.c < sma - 2 * stdDev ? -1 : 0;
    signal.bbSqueeze = stdDev / sma < 0.004;
  }

  const bandBasis = calcEma(closes, bandBasisLength);
  const bandAtr = calcAtrSeries(sampleBars, bandAtrLength, bandAtrSmoothing);
  const bandWidth = Math.max(bandAtr * bandVolatilityMultiplier, bar.c * 0.0012);
  signal.bandBasis = bandBasis;
  signal.bandUpper = bandBasis + bandWidth;
  signal.bandLower = bandBasis - bandWidth;
  const bullishBandBreak = waitForBarClose ? bar.c > signal.bandUpper : bar.h > signal.bandUpper;
  const bearishBandBreak = waitForBarClose ? bar.c < signal.bandLower : bar.l < signal.bandLower;
  if (bullishBandBreak) swingState.bandTrend = 1;
  else if (bearishBandBreak) swingState.bandTrend = -1;
  else if (!swingState.bandTrend) swingState.bandTrend = bar.c >= bandBasis ? 1 : -1;
  signal.bandTrend = swingState.bandTrend || 0;
  const bandTouchTolerance = Math.max(bandAtr * 0.2, Math.abs(bar.c) * 0.0008);
  const bullishRetest = signal.bandTrend === 1
    && bar.l <= (bandBasis + bandTouchTolerance)
    && (waitForBarClose ? bar.c >= bandBasis : bar.h >= bandBasis);
  const bearishRetest = signal.bandTrend === -1
    && bar.h >= (bandBasis - bandTouchTolerance)
    && (waitForBarClose ? bar.c <= bandBasis : bar.l <= bandBasis);
  signal.bandRetest = bullishRetest ? 1 : bearishRetest ? -1 : 0;

  const swingLookback = timeHorizon;
  if (highs.length >= 2 * swingLookback + 1) {
    const pivotIndex = highs.length - swingLookback - 1;
    if (highs[pivotIndex] === Math.max(...highs.slice(pivotIndex - swingLookback, pivotIndex + swingLookback + 1))) {
      swingState.hi.push(highs[pivotIndex]);
    }
    if (lows[pivotIndex] === Math.min(...lows.slice(pivotIndex - swingLookback, pivotIndex + swingLookback + 1))) {
      swingState.lo.push(lows[pivotIndex]);
    }
    if (swingState.hi.length > 30) swingState.hi.shift();
    if (swingState.lo.length > 30) swingState.lo.shift();
  }

  if (swingState.hi.length >= 2 && swingState.lo.length >= 2) {
    const swingHigh = swingState.hi[swingState.hi.length - 1];
    const swingLow = swingState.lo[swingState.lo.length - 1];
    const currentClose = closes[closes.length - 1];
    const previousClose = closes[closes.length - 2] || currentClose;
    if (currentClose > swingHigh && previousClose > swingHigh * 0.999) swingState.str = 1;
    else if (currentClose < swingLow && previousClose < swingLow * 1.001) swingState.str = -1;
    signal.mktStr = swingState.str;
  }

  if (swingState.hi.length > 0 && swingState.lo.length > 0) {
    const swingHigh = swingState.hi[swingState.hi.length - 1];
    const swingLow = swingState.lo[swingState.lo.length - 1];
    if (bar.h > swingHigh && bar.c < swingHigh) {
      signal.sweep = true;
      signal.sweepDir = -1;
      signal.sweepLevel = swingHigh;
    }
    if (bar.l < swingLow && bar.c > swingLow) {
      signal.sweep = true;
      signal.sweepDir = 1;
      signal.sweepLevel = swingLow;
    }
  }

  const recentCandles = lookbackBars.slice(-15);
  for (let index = recentCandles.length - 3; index > Math.max(0, recentCandles.length - 10); index -= 1) {
    const candidate = recentCandles[index];
    const invalidatedBullishOb = recentCandles
      .slice(index + 1)
      .some((sample) => sample.c < candidate.l);
    const invalidatedBearishOb = recentCandles
      .slice(index + 1)
      .some((sample) => sample.c > candidate.h);
    if (
      candidate.c < candidate.o
      && index + 1 < recentCandles.length
      && (recentCandles[index + 1].c - candidate.c) / candidate.c > 0.002
      && !invalidatedBullishOb
    ) {
      signal.ob = true;
      signal.obDir = 1;
      signal.obTop = candidate.h;
      signal.obBottom = candidate.l;
      signal.obAnchorTs = candidate.ts || null;
      break;
    }
    if (
      candidate.c > candidate.o
      && index + 1 < recentCandles.length
      && (candidate.c - recentCandles[index + 1].c) / candidate.c > 0.002
      && !invalidatedBearishOb
    ) {
      signal.ob = true;
      signal.obDir = -1;
      signal.obTop = candidate.h;
      signal.obBottom = candidate.l;
      signal.obAnchorTs = candidate.ts || null;
      break;
    }
  }

  if (recentCandles.length >= 5) {
    for (let index = recentCandles.length - 3; index >= 0; index -= 1) {
      const left = recentCandles[index];
      const middle = recentCandles[index + 1];
      const right = recentCandles[index + 2];
      const invalidatedBullishFvg = recentCandles
        .slice(index + 2)
        .some((sample) => sample.l <= left.h);
      const invalidatedBearishFvg = recentCandles
        .slice(index + 2)
        .some((sample) => sample.h >= left.l);
      if (
        index + 2 < recentCandles.length
        && middle.c > middle.o
        && right.l > left.h
        && !invalidatedBullishFvg
      ) {
        signal.fvg = true;
        signal.fvgDir = 1;
        signal.fvgTop = right.l;
        signal.fvgBottom = left.h;
        signal.fvgAnchorTs = right.ts || null;
        break;
      }
      if (
        index + 2 < recentCandles.length
        && middle.c < middle.o
        && right.h < left.l
        && !invalidatedBearishFvg
      ) {
        signal.fvg = true;
        signal.fvgDir = -1;
        signal.fvgTop = left.l;
        signal.fvgBottom = right.h;
        signal.fvgAnchorTs = right.ts || null;
        break;
      }
    }
  }

  const momentumWeights = adapt
    ? ({ bull: [0.35, 0.3, 0.1, 0.1, 0.15], bear: [0.2, 0.22, 0.2, 0.2, 0.18], range: [0.25, 0.2, 0.2, 0.2, 0.15] }[regime] || [0.3, 0.25, 0.15, 0.15, 0.15])
    : [0.3, 0.25, 0.15, 0.15, 0.15];
  let momentum = (
    momentumWeights[0] * signal.emaBias
    + momentumWeights[1] * signal.mktStr
    + momentumWeights[2] * signal.vPos
    + momentumWeights[3] * ((signal.rsi - 50) / 50)
  );
  if (signal.volSurge && lookbackBars.length >= 3) {
    momentum += momentumWeights[4] * Math.sign((bar.c - lookbackBars[lookbackBars.length - 3].c) / lookbackBars[lookbackBars.length - 3].c);
  }
  signal.mom = Math.max(-1, Math.min(1, momentum));

  const bearishAsymmetry = adapt ? 1.3 : 1.0;
  let reversal = 0;
  if (signal.sweep) reversal += signal.sweepDir > 0 ? 0.4 * signal.sweepDir : 0.4 * signal.sweepDir * bearishAsymmetry;
  if (signal.rsi < 25) reversal += 0.25;
  else if (signal.rsi > 75) reversal -= 0.25 * bearishAsymmetry;
  else if (signal.rsi < 35) reversal += 0.1;
  else if (signal.rsi > 65) reversal -= 0.1 * bearishAsymmetry;
  reversal += signal.vPos > 0 ? -0.2 * signal.vPos : -0.2 * signal.vPos * bearishAsymmetry;
  if (signal.ob) reversal += signal.obDir === 1 ? 0.15 : signal.obDir === -1 ? -0.15 * bearishAsymmetry : 0;
  signal.rev = Math.max(-1, Math.min(1, reversal));

  if (swingState.hi.length >= 2 && swingState.lo.length >= 2) {
    const currentClose = closes[closes.length - 1];
    const previousSwingHigh = swingState.hi.length >= 2 ? swingState.hi[swingState.hi.length - 2] : swingState.hi[swingState.hi.length - 1];
    const previousSwingLow = swingState.lo.length >= 2 ? swingState.lo[swingState.lo.length - 2] : swingState.lo[swingState.lo.length - 1];
    const brokeHigh = bosConfirmation === "wicks" ? bar.h > previousSwingHigh : currentClose > previousSwingHigh;
    const brokeLow = bosConfirmation === "wicks" ? bar.l < previousSwingLow : currentClose < previousSwingLow;
    if (brokeHigh) {
      signal.bosRecent = swingState.str === -1 ? 0 : 1;
      signal.chochRecent = swingState.str === -1 ? 1 : 0;
      if (signal.bosRecent) signal.bosLevel = previousSwingHigh;
      if (signal.chochRecent) signal.chochLevel = previousSwingHigh;
    }
    if (brokeLow) {
      signal.bosRecent = swingState.str === 1 ? 0 : -1;
      signal.chochRecent = swingState.str === 1 ? -1 : 0;
      if (signal.bosRecent) signal.bosLevel = previousSwingLow;
      if (signal.chochRecent) signal.chochLevel = previousSwingLow;
    }
  }

  {
    let rayConviction = 0;
    const direction = signal.emaCross || signal.emaBias;
    if (direction !== 0) {
      const hasFreshCross = signal.emaCross !== 0;
      const hasRecentCross = signal.emaCrossAge < 8;
      const triggerScore = hasFreshCross ? 0.3 : hasRecentCross ? 0.2 : 0.08;
      rayConviction += triggerScore;

      let smcCount = 0;
      if (signal.chochRecent === direction) {
        rayConviction += 0.12;
        smcCount += 1;
      }
      if (signal.bosRecent === direction) {
        rayConviction += 0.12;
        smcCount += 1;
      }
      if (signal.ob && signal.obDir === direction) {
        rayConviction += 0.12;
        smcCount += 1;
      }
      if (signal.sweep && signal.sweepDir === direction) {
        rayConviction += 0.12;
        smcCount += 1;
      }
      if (signal.fvg && signal.fvgDir === direction) {
        rayConviction += 0.06;
        smcCount += 1;
      }

      if (direction === 1 && bar.c > emaTrend) rayConviction += 0.05;
      else if (direction === -1 && bar.c < emaTrend) rayConviction += 0.05;
      if (direction === 1 && signal.rsi >= 40 && signal.rsi <= 60) rayConviction += 0.05;
      else if (direction === -1 && signal.rsi >= 40 && signal.rsi <= 60) rayConviction += 0.05;
      if (signal.volSurge) rayConviction += 0.04;
      if (signal.bandTrend === direction) rayConviction += 0.14;
      if (signal.bandRetest === direction) rayConviction += 0.12;
      if (direction === 1 && Number.isFinite(signal.bandBasis) && bar.c > signal.bandBasis) rayConviction += 0.05;
      else if (direction === -1 && Number.isFinite(signal.bandBasis) && bar.c < signal.bandBasis) rayConviction += 0.05;
      if ((regime === "bull" && direction === 1) || (regime === "bear" && direction === -1)) {
        rayConviction += 0.05;
      }

      if (hasRecentCross && signal.emaCrossAge > 1) {
        const distance = Math.abs(bar.c - emaSlow) / emaSlow;
        if (distance < 0.0015) rayConviction += 0.1;
      }

      if ((regime === "bull" && direction === -1) || (regime === "bear" && direction === 1)) rayConviction *= 0.84;
      if ((direction === 1 && signal.rsi > 68) || (direction === -1 && signal.rsi < 32)) rayConviction *= 0.88;
      if (signal.vPos2 === direction) rayConviction *= 0.82;
      else if (signal.vPos === direction) rayConviction *= 0.9;
      if (!hasFreshCross && !hasRecentCross) rayConviction *= 0.6;
      if (smcCount === 0) rayConviction *= 0.92;
      if (signal.bandTrend && signal.bandTrend !== direction) rayConviction *= 0.72;
      if (signal.bandRetest && signal.bandRetest !== direction) rayConviction *= 0.88;
    }
    signal.rayConv = Math.min(1.0, rayConviction) * Math.sign(direction || 1);
  }

  return signal;
}

export function detectRegimes(bars) {
  const daily = {};
  for (const bar of bars) {
    if (!daily[bar.date]) {
      daily[bar.date] = { o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: 0, vix: bar.vix };
    }
    daily[bar.date].h = Math.max(daily[bar.date].h, bar.h);
    daily[bar.date].l = Math.min(daily[bar.date].l, bar.l);
    daily[bar.date].c = bar.c;
    daily[bar.date].v += bar.v;
    daily[bar.date].vix = bar.vix;
  }

  const regimes = {};
  const dates = Object.keys(daily).sort();
  for (let index = 5; index < dates.length; index += 1) {
    const current = daily[dates[index]];
    const prev5 = daily[dates[Math.max(0, index - 5)]];
    const prev20 = daily[dates[Math.max(0, index - 20)]];
    const return5 = (current.c - prev5.c) / prev5.c;
    const return20 = prev20 ? (current.c - prev20.c) / prev20.c : 0;
    const vix = current.vix || 17;
    let score = 0;
    if (return20 > 0.03) score += 2;
    else if (return20 > 0.015) score += 1;
    if (return5 > 0.015) score += 1;
    else if (return5 > 0.008) score += 0.5;
    if (return20 < -0.03) score -= 2;
    else if (return20 < -0.015) score -= 1;
    if (return5 < -0.015) score -= 1;
    else if (return5 < -0.008) score -= 0.5;
    if (vix > 25) score -= 1;
    if (vix > 30) score -= 0.5;
    if (vix < 14) score += 0.3;

    regimes[dates[index]] = {
      regime: score >= 1.5 ? "bull" : score <= -1.5 ? "bear" : "range",
      vix,
    };
  }
  return regimes;
}

function inferExecutionBarMinutes(bars = []) {
  if (!Array.isArray(bars) || bars.length < 2) {
    return null;
  }
  let smallestPositiveDeltaMs = Number.POSITIVE_INFINITY;
  for (let index = 1; index < bars.length; index += 1) {
    const currentTimeMs = Number(getBarTimeMs(bars[index]));
    const previousTimeMs = Number(getBarTimeMs(bars[index - 1]));
    if (!Number.isFinite(currentTimeMs) || !Number.isFinite(previousTimeMs)) {
      continue;
    }
    const deltaMs = currentTimeMs - previousTimeMs;
    if (deltaMs > 0) {
      smallestPositiveDeltaMs = Math.min(smallestPositiveDeltaMs, deltaMs);
    }
  }
  if (!Number.isFinite(smallestPositiveDeltaMs) || smallestPositiveDeltaMs <= 0) {
    return null;
  }
  return Math.max(1, Math.round(smallestPositiveDeltaMs / 60000));
}

function buildRayAlgoBaseSignalEvents({
  bars,
  regimes,
  tfMin = 5,
  activeTimeframe = "5m",
  rayalgoSettings = null,
} = {}) {
  if (!Array.isArray(bars) || !bars.length) {
    return [];
  }
  const swingState = { hi: [], lo: [], str: 0 };
  const warmup = Math.round(100 * (5 / Math.max(1, tfMin || 5)));
  const events = [];

  for (let index = warmup; index < bars.length; index += 1) {
    const bar = bars[index];
    const lookbackBars = bars.slice(Math.max(0, index - warmup), index);
    const regime = regimes?.[bar.date] || { regime: "range", vix: 17 };
    const tech = analyzeTech(bar, lookbackBars, swingState, regime.regime, false, rayalgoSettings);
    const rayDirection = tech.rayConv > 0 ? "long" : tech.rayConv < 0 ? "short" : null;
    const featureSnapshot = buildRayAlgoFeatureSnapshot({
      signal: tech,
      bar,
      direction: rayDirection,
      regime,
    });
    const scoring = buildRayAlgoSignalScore({
      rayConviction: tech.rayConv,
      signalDirection: rayDirection,
      signalClass: "trend_change",
      signalTs: bar.ts,
      signalTimeMs: getBarTimeMs(bar),
      signalMinuteOfDay: Number.isFinite(Number(bar?.hour)) && Number.isFinite(Number(bar?.min))
        ? Number(bar.hour) * 60 + Number(bar.min)
        : null,
      precursorEventsByFrame: {},
      signalFeatures: featureSnapshot,
      config: {
        activeTimeframe,
        precursorLadderId: "none",
      },
    });
    if (!scoring.signalFired) {
      continue;
    }
    events.push({
      ts: String(bar.ts || "").trim(),
      timeMs: Number(getBarTimeMs(bar)),
      barIndex: index,
      direction: scoring.direction,
      rawScore: scoring.rawScore,
      score: scoring.score,
    });
  }

  return events;
}

function buildRayAlgoScoringContext({
  strategy,
  signalTimeframe = "5m",
  executionBars = [],
  rayalgoSettings = null,
  rayalgoScoringConfig = null,
} = {}) {
  const normalizedStrategy = normalizeResearchStrategy(strategy);
  if (normalizedStrategy !== "rayalgo") {
    return null;
  }
  const normalizedConfig = normalizeRayAlgoScoringConfig({
    activeTimeframe: signalTimeframe,
    ...(rayalgoScoringConfig || {}),
  });
  const precursorFrames = Array.isArray(normalizedConfig.precursorFrames)
    ? normalizedConfig.precursorFrames
    : [];
  const executionFrameMinutes = inferExecutionBarMinutes(executionBars);
  const precursorEventsByFrame = {};
  const precursorBarTimesByFrame = {};
  const availableFrames = [];
  const missingFrames = [];

  for (const timeframe of precursorFrames) {
    const frameMinutes = Math.max(1, Number(timeframeToMinutes(timeframe)) || 0);
    if (!frameMinutes) {
      missingFrames.push(timeframe);
      continue;
    }
    if (executionFrameMinutes != null && frameMinutes < executionFrameMinutes) {
      missingFrames.push(timeframe);
      continue;
    }
    const frameBars = aggregateBarsToMinutes(executionBars, frameMinutes);
    if (!frameBars.length) {
      missingFrames.push(timeframe);
      continue;
    }
    precursorEventsByFrame[timeframe] = buildRayAlgoBaseSignalEvents({
      bars: frameBars,
      regimes: detectRegimes(frameBars),
      tfMin: frameMinutes,
      activeTimeframe: timeframe,
      rayalgoSettings,
    });
    precursorBarTimesByFrame[timeframe] = frameBars.map((bar) => Number(getBarTimeMs(bar)));
    availableFrames.push(timeframe);
  }

  return {
    config: normalizedConfig,
    precursorEventsByFrame,
    precursorBarTimesByFrame,
    dataStatus: precursorFrames.length
      ? (missingFrames.length ? "degraded" : "ready")
      : "none",
    availableFrames,
    missingFrames,
    executionFrameMinutes,
  };
}

function buildExecutionWindows(signalBars, executionBars, fallbackMinutes = 5) {
  const normalizedExecutionBars = Array.isArray(executionBars) && executionBars.length
    ? executionBars
    : signalBars;
  const windows = signalBars.map(() => []);
  let executionIndex = 0;

  for (let index = 0; index < signalBars.length; index += 1) {
    const startMs = getBarTimeMs(signalBars[index]);
    if (!Number.isFinite(startMs)) {
      continue;
    }

    const nextStartMs = index + 1 < signalBars.length
      ? getBarTimeMs(signalBars[index + 1])
      : startMs + Math.max(1, fallbackMinutes) * 60 * 1000;
    const endMs = Number.isFinite(nextStartMs)
      ? nextStartMs
      : startMs + Math.max(1, fallbackMinutes) * 60 * 1000;

    while (
      executionIndex < normalizedExecutionBars.length
      && Number(getBarTimeMs(normalizedExecutionBars[executionIndex])) < startMs
    ) {
      executionIndex += 1;
    }

    let cursor = executionIndex;
    while (
      cursor < normalizedExecutionBars.length
      && Number(getBarTimeMs(normalizedExecutionBars[cursor])) < endMs
    ) {
      windows[index].push(normalizedExecutionBars[cursor]);
      cursor += 1;
    }

    if (!windows[index].length) {
      windows[index].push(signalBars[index]);
    }

    executionIndex = cursor;
  }

  return windows;
}

function resolveSpotOptionPriceRange(bar, position, remainingCalendarDte, iv, regimeAdapt) {
  const useIv = regimeAdapt && position.vix > 0
    ? ivForDTE(position.vix / 100, remainingCalendarDte)
    : ivForDTE(iv, remainingCalendarDte);
  const favorableSpot = position.ic ? bar.h : bar.l;
  const adverseSpot = position.ic ? bar.l : bar.h;
  return {
    open: Math.max(priceOption(bar.o, position.k, remainingCalendarDte, useIv, position.ic), 0.001),
    high: Math.max(priceOption(favorableSpot, position.k, remainingCalendarDte, useIv, position.ic), 0.001),
    low: Math.max(priceOption(adverseSpot, position.k, remainingCalendarDte, useIv, position.ic), 0.001),
    close: Math.max(priceOption(bar.c, position.k, remainingCalendarDte, useIv, position.ic), 0.001),
  };
}

function resolveOptionHistoryPriceRange(bar, optionSnapshot, position, remainingDays) {
  if (optionSnapshot) {
    return {
      open: Math.max(Number(optionSnapshot.o), 0.001),
      high: Math.max(Number(optionSnapshot.h), 0.001),
      low: Math.max(Number(optionSnapshot.l), 0.001),
      close: Math.max(Number(optionSnapshot.c), 0.001),
    };
  }

  const intrinsicOpen = Math.max(position.ic ? bar.o - position.k : position.k - bar.o, 0.001);
  const intrinsicHigh = Math.max(position.ic ? bar.h - position.k : position.k - bar.l, 0.001);
  const intrinsicLow = Math.max(position.ic ? bar.l - position.k : position.k - bar.h, 0.001);
  const intrinsicClose = Math.max(position.ic ? bar.c - position.k : position.k - bar.c, 0.001);

  if (remainingDays < 0.05 && bar.date === position.expiryDate) {
    return {
      open: intrinsicOpen,
      high: intrinsicHigh,
      low: intrinsicLow,
      close: intrinsicClose,
    };
  }

  const fallbackPrice = Math.max((position.mtm || position.cost) / Math.max(position.qty * 100, 1), 0.001);
  return {
    open: fallbackPrice,
    high: fallbackPrice,
    low: fallbackPrice,
    close: fallbackPrice,
  };
}

function resolvePositionPriceRange({
  executionMode,
  executionBar,
  position,
  iv,
  regimeAdapt,
  getOptionSnapshotForPosition,
}) {
  const remainingCalendarDte = calendarDaysTo(
    executionBar.date,
    executionBar.hour,
    executionBar.min,
    position.expiryDate,
  );
  const remainingDays = remainingCalendarDte * 365.25;

  if (executionMode === "option_history") {
    const optionSnapshot = getOptionSnapshotForPosition(position, executionBar);
    return {
      remainingCalendarDte,
      remainingDays,
      priceRange: resolveOptionHistoryPriceRange(executionBar, optionSnapshot, position, remainingDays),
    };
  }

  return {
    remainingCalendarDte,
    remainingDays,
    priceRange: resolveSpotOptionPriceRange(executionBar, position, remainingCalendarDte, iv, regimeAdapt),
  };
}

function resolveOptionSlippageAmount(referencePrice, slipBps) {
  const price = Number(referencePrice);
  const basisPoints = Math.max(0, Number(slipBps) || 0);
  if (!Number.isFinite(price) || price <= 0 || basisPoints <= 0) {
    return 0;
  }
  return price * (basisPoints / 10000);
}

function evaluatePositionExitPolicy({
  position,
  executionBar,
  remainingDays,
  priceRange,
  tpPct,
  slPct,
  trailStartPct,
  trailPct,
  zombieBarsAdjusted,
  exitGovernorConfig = null,
  tradingDayIndexByDate = null,
  spotAtr = null,
  regime = null,
}) {
  const marketMinutes = executionBar.hour * 60 + executionBar.min;
  let exitReason = null;
  let exitPrice = null;

  if (executionBar.date > position.expiryDate) {
    exitReason = "expired";
    exitPrice = priceRange.close;
  } else if (
    executionBar.date === position.expiryDate
    && marketMinutes >= MARKET_SESSION_CLOSE_MINUTES - 10
  ) {
    exitReason = "expired";
    exitPrice = priceRange.close;
  } else if (remainingDays < 0.05 && executionBar.date === position.expiryDate) {
    exitReason = "expired";
    exitPrice = priceRange.close;
  }

  if (!exitReason) {
    const effectiveStopLossPct = resolveBacktestV2StopLossPct({
      position,
      legacyStopLossPct: slPct,
      exitGovernorConfig,
    });
    const takeProfitPrice = Number.isFinite(Number(position.takeProfitPrice))
      ? Number(position.takeProfitPrice)
      : position.oe * (1 + tpPct);
    const stopPrice = Number.isFinite(Number(position.stopLossPrice))
      ? Number(position.stopLossPrice)
      : position.oe * (1 - effectiveStopLossPct);
    const pricePerformance = (priceRange.close - position.oe) / position.oe;
    const trailProfile = resolveBacktestV2TrailProfile({
      position,
      executionBar,
      priceRange,
      trailStartPct,
      exitGovernorConfig,
      spotAtr,
      regime,
    });
    position.trailActivationPrice = Number.isFinite(Number(trailProfile?.optionActivationPrice))
      ? Number(trailProfile.optionActivationPrice)
      : position.trailActivationPrice;
    position.trailActivationModeApplied = trailProfile?.activationMode || position.trailActivationModeApplied || null;
    position.trailProfitFloorPctApplied = Number.isFinite(Number(trailProfile?.profitFloorPct))
      ? Number(trailProfile.profitFloorPct)
      : position.trailProfitFloorPctApplied;
    position.trailRequiredSpotMoveApplied = Number.isFinite(Number(trailProfile?.requiredSpotMove))
      ? Number(trailProfile.requiredSpotMove)
      : position.trailRequiredSpotMoveApplied;
    position.trailLockRatioApplied = Number.isFinite(Number(trailProfile?.lockRatio))
      ? Number(trailProfile.lockRatio)
      : position.trailLockRatioApplied;

    if (priceRange.low <= stopPrice) {
      exitReason = "stop_loss";
      exitPrice = stopPrice;
    } else if (priceRange.high >= takeProfitPrice) {
      exitReason = "take_profit";
      exitPrice = takeProfitPrice;
    } else if (trailProfile?.activationTriggered) {
      const peakPerformance = (position.pk - position.oe) / position.oe;
      const lockRatioStopPrice = exitGovernorConfig
        ? position.oe * (1 + peakPerformance * Math.max(trailProfile.lockRatio || 0, 0))
        : null;
      const trailGivebackStopPrice = exitGovernorConfig
        ? position.pk - position.oe * clampNumber(exitGovernorConfig.trailEntryDrawdownPct, 0.001, 10, 0.18)
        : null;
      const trailStopPrice = exitGovernorConfig
        ? Math.max(lockRatioStopPrice || 0, trailGivebackStopPrice || 0, 0.001)
        : Math.max(position.oe * (1 + peakPerformance - trailPct), 0.001);
      position.lastTrailStopPrice = trailStopPrice;
      pushTrailStopHistory(position, {
        ts: executionBar.ts,
        trailStopPrice,
        referenceOptionPrice: position.pk,
        referenceSpotPrice: position.ic ? executionBar.h : executionBar.l,
      });
      const trailArmed = exitGovernorConfig
        ? peakPerformance > 0
        : peakPerformance > trailStartPct;
      if (trailArmed && priceRange.low <= trailStopPrice) {
        exitReason = "trailing_stop";
        exitPrice = trailStopPrice;
      }
    }

    if (!exitReason && position.bh >= zombieBarsAdjusted && pricePerformance < 0.02) {
      exitReason = "zombie_kill";
      exitPrice = priceRange.close;
    }

    if (!exitReason) {
      const timeCliffDecision = resolveBacktestV2TimeCliffDecision({
        position,
        executionBar,
        pricePerformance,
        exitGovernorConfig,
        tradingDayIndexByDate,
      });
      if (timeCliffDecision) {
        exitReason = timeCliffDecision.reason;
        exitPrice = priceRange.close;
      } else if (!exitGovernorConfig && executionBar.date !== position.expiryDate && marketMinutes >= MARKET_SESSION_CLOSE_MINUTES - 5) {
        exitReason = "time_exit";
        exitPrice = priceRange.close;
      }
    }
  }

  return exitReason
    ? { exitReason, exitPrice }
    : null;
}

function evaluatePositionOnExecutionBar({
  position,
  executionBar,
  executionMode,
  iv,
  regimeAdapt,
  tpPct,
  slPct,
  trailStartPct,
  trailPct,
  zombieBarsAdjusted,
  getOptionSnapshotForPosition,
  exitGovernorConfig,
  tradingDayIndexByDate,
  spotAtr,
  regime,
}) {
  const {
    remainingCalendarDte,
    remainingDays,
    priceRange,
  } = resolvePositionPriceRange({
    executionMode,
    executionBar,
    position,
    iv,
    regimeAdapt,
    getOptionSnapshotForPosition,
  });

  position.pk = Math.max(position.pk, priceRange.high);
  position.mtm = priceRange.close * 100 * position.qty;
  const decision = evaluatePositionExitPolicy({
    position,
    executionBar,
    remainingDays,
    priceRange,
    tpPct,
    slPct,
    trailStartPct,
    trailPct,
    zombieBarsAdjusted,
    exitGovernorConfig,
    tradingDayIndexByDate,
    spotAtr,
    regime,
  });
  const exitReason = decision?.exitReason || null;
  const exitPrice = decision?.exitPrice ?? null;

  if (!exitReason) {
    return false;
  }

  position.exitTriggerPrice = exitPrice;
  position.exitOptionOpen = priceRange.open;
  position.exitOptionHigh = priceRange.high;
  position.exitOptionLow = priceRange.low;
  position.exitOptionClose = priceRange.close;
  position.ep = exitPrice;
  position.er = exitReason;
  position.et = executionBar.ts;
  return true;
}

export function buildReplayEntryKey(entryTs, right, strategyUsed = "") {
  return `${String(entryTs || "").trim()}|${String(right || "").trim().toLowerCase()}|${String(strategyUsed || "").trim().toLowerCase()}`;
}

const STRATEGY_SIGNAL_TYPES = {
  momentum_breakout: "trend",
  ema_stack: "trend",
  sweep_reversal: "revert",
  vwap_extreme: "revert",
  bb_squeeze: "breakout",
  rayalgo: "trend",
};

function resolveBaseSignal({
  bar,
  lookbackBars,
  swingState,
  regime,
  strategy,
  rayalgoSettings,
  signalTimeframe = "5m",
  rayalgoScoringContext = null,
  techOverride = null,
}) {
  const tech = techOverride || analyzeTech(bar, lookbackBars, swingState, regime.regime, false, rayalgoSettings);
  let direction = null;
  let conviction = 0;
  let strategyUsed = "";
  let scoring = null;
  const normalizedStrategy = normalizeResearchStrategy(strategy);

  const strategyList = [normalizedStrategy];

  for (const candidate of strategyList) {
    if (direction) break;

    if (candidate === "rayalgo") {
      const rayDirection = tech.rayConv > 0 ? "long" : tech.rayConv < 0 ? "short" : null;
      const featureSnapshot = buildRayAlgoFeatureSnapshot({
        signal: tech,
        bar,
        direction: rayDirection,
        regime,
      });
      scoring = buildRayAlgoSignalScore({
        rayConviction: tech.rayConv,
        signalDirection: rayDirection,
        signalClass: "trend_change",
        signalTs: bar?.ts || null,
        signalTimeMs: getBarTimeMs(bar),
        signalMinuteOfDay: Number.isFinite(Number(bar?.hour)) && Number.isFinite(Number(bar?.min))
          ? Number(bar.hour) * 60 + Number(bar.min)
          : null,
        precursorEventsByFrame: rayalgoScoringContext?.precursorEventsByFrame || {},
        precursorBarTimesByFrame: rayalgoScoringContext?.precursorBarTimesByFrame || {},
        signalFeatures: featureSnapshot,
        config: rayalgoScoringContext?.config || { activeTimeframe: signalTimeframe },
      });
      tech.rayRawScore = scoring.rawScore;
      tech.rayConfidenceScore = scoring.confidenceScore;
      tech.rayQualityScore = scoring.qualityScore;
      tech.rayScore = scoring.score;
      tech.rayPrecursorBonus = scoring.precursorBonus;
      tech.rayDisplayScoreText = scoring.displayScoreText;
      tech.rayScoring = {
        ...scoring,
        precursorContext: {
          ...(scoring.precursorContext || {}),
          dataStatus: rayalgoScoringContext?.dataStatus || scoring.precursorContext?.dataStatus || "none",
          missingFrames: Array.isArray(rayalgoScoringContext?.missingFrames)
            ? [...rayalgoScoringContext.missingFrames]
            : [],
          availableFrames: Array.isArray(rayalgoScoringContext?.availableFrames)
            ? [...rayalgoScoringContext.availableFrames]
            : [],
        },
      };
      if (scoring.signalFired) {
        direction = scoring.direction;
        conviction = scoring.rawScore;
        strategyUsed = candidate;
      }
    }

    if (candidate === "momentum_breakout") {
      const momentum = tech.mom;
      if (Math.abs(momentum) >= 0.2) {
        if (momentum > 0) direction = "long";
        else direction = "short";
        if (direction) {
          const directionMultiplier = direction === "long" ? 1 : -1;
          conviction = Math.abs(momentum) * 0.4;
          if (tech.emaBias === directionMultiplier) conviction += 0.2;
          if (tech.mktStr === directionMultiplier) conviction += 0.15;
          if (tech.volSurge) conviction += 0.1;
          if (tech.fvg && tech.fvgDir === directionMultiplier) conviction += 0.08;
          conviction = Math.min(conviction, 0.68);
          strategyUsed = candidate;
        }
      }
    } else if (candidate === "sweep_reversal") {
      const reversal = tech.rev;
      if (Math.abs(reversal) >= 0.18) {
        if (reversal > 0) direction = "long";
        else direction = "short";
        if (direction) {
          const directionMultiplier = direction === "long" ? 1 : -1;
          conviction = Math.abs(reversal) * 0.35;
          if (tech.sweep) conviction += 0.25;
          if (tech.rsiSig === directionMultiplier) conviction += 0.15;
          if (tech.vPos === -directionMultiplier) conviction += 0.12;
          if (tech.ob && tech.obDir === directionMultiplier) conviction += 0.08;
          if (tech.volSurge) conviction += 0.05;
          conviction = Math.min(conviction, 1.0);
          strategyUsed = candidate;
        }
      }
    } else if (candidate === "vwap_extreme") {
      if (tech.vPos2 === -1 && tech.rsi7 < 25 && tech.bodyDir > 0) {
        direction = "long";
        conviction = 0.45;
        if (tech.rsi7 < 20) conviction += 0.1;
        if (tech.sweep && tech.sweepDir === 1) conviction += 0.15;
        conviction = Math.min(conviction, 0.7);
        strategyUsed = candidate;
      } else if (tech.vPos2 === 1 && tech.rsi7 > 75 && tech.bodyDir < 0) {
        direction = "short";
        conviction = 0.45;
        if (tech.rsi7 > 80) conviction += 0.1;
        if (tech.sweep && tech.sweepDir === -1) conviction += 0.15;
        conviction = Math.min(conviction, 0.7);
        strategyUsed = candidate;
      }
    } else if (candidate === "ema_stack") {
      if (tech.emaStack === 1 && bar.l <= tech.e13 * 1.001 && bar.c > tech.e8 && tech.rsi > 40) {
        direction = "long";
        conviction = 0.35;
        if (tech.mktStr === 1) conviction += 0.15;
        if (tech.volSurge) conviction += 0.1;
        if (tech.fvg && tech.fvgDir === 1) conviction += 0.08;
        conviction = Math.min(conviction, 0.68);
        strategyUsed = candidate;
      } else if (tech.emaStack === -1 && bar.h >= tech.e13 * 0.999 && bar.c < tech.e8 && tech.rsi < 60) {
        direction = "short";
        conviction = 0.35;
        if (tech.mktStr === -1) conviction += 0.15;
        if (tech.volSurge) conviction += 0.1;
        conviction = Math.min(conviction, 0.68);
        strategyUsed = candidate;
      }
    } else if (candidate === "bb_squeeze") {
      if (tech.bbSqueeze && tech.bbPos === 1 && tech.volRatio > 1.2) {
        direction = "long";
        conviction = 0.35;
        if (tech.emaBias === 1) conviction += 0.15;
        if (tech.mktStr === 1) conviction += 0.1;
        conviction = Math.min(conviction, 0.6);
        strategyUsed = candidate;
      } else if (tech.bbSqueeze && tech.bbPos === -1 && tech.volRatio > 1.2) {
        direction = "short";
        conviction = 0.35;
        if (tech.emaBias === -1) conviction += 0.15;
        conviction = Math.min(conviction, 0.6);
        strategyUsed = candidate;
      }
    }

    if (!direction) {
      conviction = 0;
    }
  }

  if (!direction) {
    return null;
  }

  return {
    direction,
    conviction,
    strategyUsed,
    tech,
    scoring,
    signalClass: scoring?.signalClass || (normalizedStrategy === "rayalgo" ? "trend_change" : null),
  };
}

function resolveExecutableSignal({
  baseSignal,
  regime,
  allowShorts,
  minConviction,
  regimeAdapt,
}) {
  if (!baseSignal?.direction || !baseSignal?.strategyUsed) {
    return null;
  }
  if (baseSignal.direction === "short" && !allowShorts) {
    return null;
  }

  let conviction = Number(baseSignal.conviction) || 0;
  if (conviction < minConviction) {
    return null;
  }

  if (regimeAdapt && baseSignal.strategyUsed) {
    const type = STRATEGY_SIGNAL_TYPES[baseSignal.strategyUsed] || "trend";
    const regimeMultiplier = {
      trend: { bull: 1.15, range: 0.9, bear: 0.8 },
      revert: { bull: 0.85, range: 1.05, bear: 1.15 },
      breakout: { bull: 1.0, range: 1.1, bear: 0.9 },
    }[type] || { bull: 1, range: 1, bear: 1 };
    conviction *= regimeMultiplier[regime.regime] || 1.0;
  }

  if (regimeAdapt) {
    const callPutMultiplier = baseSignal.direction === "long"
      ? ({ bull: 1.2, range: 1.1, bear: 0.85 }[regime.regime] || 1.0)
      : ({ bear: 1.1, range: 0.8, bull: 0.7 }[regime.regime] || 1.0);
    conviction *= callPutMultiplier;
  }

  return {
    ...baseSignal,
    conviction,
  };
}

function resolveTradeSignal({
  bar,
  lookbackBars,
  swingState,
  regime,
  strategy,
  allowShorts,
  minConviction,
  regimeAdapt,
  rayalgoSettings,
  signalTimeframe = "5m",
  rayalgoScoringContext = null,
  techOverride = null,
}) {
  const normalizedStrategy = normalizeResearchStrategy(strategy);
  const effectiveTech = techOverride || (
    normalizedStrategy === "rayalgo"
      ? analyzeTech(bar, lookbackBars, swingState, regime.regime, false, rayalgoSettings)
      : null
  );
  let baseSignal = null;
  if (normalizedStrategy === "rayalgo") {
    baseSignal = resolveBaseSignal({
      bar,
      lookbackBars,
      swingState,
      regime,
      strategy,
      rayalgoSettings,
      signalTimeframe,
      rayalgoScoringContext,
      techOverride: effectiveTech,
    });
  } else {
    baseSignal = resolveBaseSignal({
      bar,
      lookbackBars,
      swingState,
      regime,
      strategy,
      rayalgoSettings,
      signalTimeframe,
      rayalgoScoringContext,
      techOverride: effectiveTech,
    });
  }
  return resolveExecutableSignal({
    baseSignal,
    regime,
    allowShorts,
    minConviction,
    regimeAdapt,
  });
}

function strategyOverlayTag(strategy) {
  return {
    rayalgo: "RA",
    momentum_breakout: "MB",
    sweep_reversal: "SW",
    vwap_extreme: "VX",
    ema_stack: "ES",
    bb_squeeze: "BB",
  }[String(strategy || "").trim().toLowerCase()] || "SIG";
}

function directionToSign(direction) {
  return String(direction || "").trim().toLowerCase() === "short" ? -1 : 1;
}

function resolveRayAlgoSizingUpgrade(scoring = null, allowUpgrade = true) {
  if (!allowUpgrade || !scoring || scoring.authority !== RAYALGO_AUTHORITY_SIZE_UPGRADE_ONLY) {
    return {
      applied: false,
      multiplier: 1,
    };
  }
  if (String(scoring?.displayScoreMode || "").trim().toLowerCase() === "raw") {
    return {
      applied: false,
      multiplier: 1,
    };
  }

  const rawScore = Number(scoring.rawScore);
  const score = Number(scoring.confidenceScore ?? scoring.score);
  const precursorBonus = Number(scoring.precursorBonus);
  const hasConflict = Boolean(scoring?.precursorContext?.hasConflict);
  if (!Number.isFinite(rawScore) || rawScore <= 0 || !Number.isFinite(score) || score <= rawScore) {
    return {
      applied: false,
      multiplier: 1,
    };
  }
  if (!Number.isFinite(precursorBonus) || precursorBonus <= 0 || hasConflict) {
    return {
      applied: false,
      multiplier: 1,
    };
  }

  return {
    applied: true,
    multiplier: Math.max(1, Math.min(2, score / rawScore)),
  };
}

function createEmptyIndicatorOverlayTape() {
  return {
    events: [],
    zones: [],
    windows: [],
  };
}

function buildIndicatorEventId(strategy, eventType, ts, direction) {
  return [
    String(strategy || "").trim().toLowerCase(),
    String(eventType || "").trim().toLowerCase(),
    String(ts || "").trim(),
    String(direction || "").trim().toLowerCase(),
  ].join("|");
}

function buildIndicatorZoneId(strategy, zoneType, startTs, direction, top, bottom) {
  return [
    String(strategy || "").trim().toLowerCase(),
    String(zoneType || "").trim().toLowerCase(),
    String(startTs || "").trim(),
    String(direction || "").trim().toLowerCase(),
    Number.isFinite(Number(top)) ? Number(top).toFixed(4) : "",
    Number.isFinite(Number(bottom)) ? Number(bottom).toFixed(4) : "",
  ].join("|");
}

function buildIndicatorWindowId(direction, startTs, endTs, strategies = []) {
  return [
    String(direction || "").trim().toLowerCase(),
    String(startTs || "").trim(),
    String(endTs || "").trim(),
    [...strategies].sort().join(","),
  ].join("|");
}

function zoneIsInvalidatedByBar(zoneType, direction, bar, top, bottom) {
  if (!bar || !Number.isFinite(Number(top)) || !Number.isFinite(Number(bottom))) {
    return false;
  }
  if (zoneType === "fair_value_gap") {
    return direction === "long"
      ? Number(bar.l) <= Number(bottom)
      : Number(bar.h) >= Number(top);
  }
  return direction === "long"
    ? Number(bar.c) < Number(bottom)
    : Number(bar.c) > Number(top);
}

function resolveIndicatorZoneEndTs(bars, startIndex, zoneType, direction, top, bottom) {
  if (!Array.isArray(bars) || !bars.length) {
    return null;
  }
  const safeStartIndex = Number.isInteger(startIndex) ? startIndex : 0;
  for (let index = Math.max(0, safeStartIndex + 1); index < bars.length; index += 1) {
    if (zoneIsInvalidatedByBar(zoneType, direction, bars[index], top, bottom)) {
      return bars[index].ts || null;
    }
  }
  return bars[bars.length - 1]?.ts || null;
}

function resolveAnchorVolumeRatio(bars, anchorIndex, lookback = 20) {
  if (!Array.isArray(bars) || !bars.length || !Number.isInteger(anchorIndex)) {
    return null;
  }
  const safeAnchorIndex = Math.max(0, Math.min(bars.length - 1, anchorIndex));
  const anchorVolume = Math.max(0, Number(bars[safeAnchorIndex]?.v) || 0);
  if (!Number.isFinite(anchorVolume) || anchorVolume <= 0) {
    return null;
  }
  const startIndex = Math.max(0, safeAnchorIndex - Math.max(1, Math.floor(Number(lookback) || 20)) + 1);
  let volumeSum = 0;
  let volumeCount = 0;
  for (let index = startIndex; index <= safeAnchorIndex; index += 1) {
    const volume = Math.max(0, Number(bars[index]?.v) || 0);
    if (!Number.isFinite(volume)) {
      continue;
    }
    volumeSum += volume;
    volumeCount += 1;
  }
  if (volumeCount <= 0) {
    return null;
  }
  const averageVolume = volumeSum / volumeCount;
  if (!Number.isFinite(averageVolume) || averageVolume <= 0) {
    return null;
  }
  return +(anchorVolume / averageVolume).toFixed(2);
}

function pushIndicatorEvent(tape, seenKeys, event) {
  if (!event || !event.id || seenKeys.has(event.id)) {
    return;
  }
  seenKeys.add(event.id);
  tape.events.push(event);
}

function pushIndicatorZone(tape, seenKeys, zone) {
  if (!zone || !zone.id || seenKeys.has(zone.id)) {
    return;
  }
  seenKeys.add(zone.id);
  tape.zones.push(zone);
}

function buildIndicatorSignalWindows(events, bars) {
  if (!Array.isArray(bars) || !bars.length) {
    return [];
  }

  const barIndexByTs = new Map(bars.map((bar, index) => [String(bar?.ts || "").trim(), index]));
  const signalEvents = (Array.isArray(events) ? events : [])
    .filter((event) => event?.eventType === "signal_fire" && event?.ts)
    .map((event) => ({
      event,
      strategy: String(event?.strategy || "").trim().toLowerCase(),
      direction: String(event?.direction || "").trim().toLowerCase() === "short" ? "short" : "long",
      signalTs: String(event?.signalTs || event?.ts || "").trim(),
      barIndex: barIndexByTs.get(String(event?.signalTs || event?.ts || "").trim()),
    }))
    .filter((entry) => entry.signalTs && entry.strategy && Number.isInteger(entry.barIndex))
    .sort((left, right) => left.barIndex - right.barIndex);

  const lastBarTs = String(bars[bars.length - 1]?.ts || "").trim();
  if (!signalEvents.length || !lastBarTs) {
    return [];
  }

  const windows = [];
  const signalsByStrategy = new Map();
  for (const signalEvent of signalEvents) {
    const strategyEvents = signalsByStrategy.get(signalEvent.strategy) || [];
    strategyEvents.push(signalEvent);
    signalsByStrategy.set(signalEvent.strategy, strategyEvents);
  }

  for (const [strategy, strategyEvents] of signalsByStrategy.entries()) {
    let currentWindow = null;

    const createWindowSeed = ({ event, signalTs, barIndex, direction: signalDirection }) => ({
      strategy,
      direction: signalDirection,
      startTs: signalTs,
      startIndex: barIndex,
      lastSignalTs: signalTs,
      lastSignalIndex: barIndex,
      maxConviction: Number(event?.conviction) || 0,
      signalRefs: [{
        signalTs,
        strategy,
        conviction: Number(event?.conviction) || 0,
      }],
    });

    const closeWindow = (endTs, openEnded = false) => {
      if (!currentWindow || !endTs) {
        return;
      }
      windows.push({
        id: buildIndicatorWindowId(currentWindow.direction, currentWindow.startTs, endTs, [strategy]),
        strategy,
        direction: currentWindow.direction,
        startTs: currentWindow.startTs,
        endTs,
        tone: currentWindow.direction === "short" ? "bearish" : "bullish",
        conviction: currentWindow.maxConviction,
        openEnded,
        signalRefs: currentWindow.signalRefs,
        meta: {
          strategies: [strategy],
          signalCount: currentWindow.signalRefs.length,
        },
      });
      currentWindow = null;
    };

    for (const signalEvent of strategyEvents) {
      const {
        event,
        signalTs,
        barIndex,
        direction,
      } = signalEvent;
      if (!currentWindow) {
        currentWindow = createWindowSeed(signalEvent);
        continue;
      }

      if (currentWindow.direction === direction) {
        currentWindow.maxConviction = Math.max(currentWindow.maxConviction, Number(event?.conviction) || 0);
        currentWindow.lastSignalTs = signalTs;
        currentWindow.lastSignalIndex = barIndex;
        if (!currentWindow.signalRefs.some((ref) => ref.signalTs === signalTs)) {
          currentWindow.signalRefs.push({
            signalTs,
            strategy,
            conviction: Number(event?.conviction) || 0,
          });
        }
        continue;
      }

      closeWindow(signalTs, false);
      currentWindow = createWindowSeed(signalEvent);
    }

    if (currentWindow) {
      closeWindow(lastBarTs, true);
    }
  }

  return windows.sort((left, right) => {
    const leftIndex = barIndexByTs.get(String(left?.startTs || "").trim()) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = barIndexByTs.get(String(right?.startTs || "").trim()) ?? Number.MAX_SAFE_INTEGER;
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }
    return String(left?.strategy || "").localeCompare(String(right?.strategy || ""));
  });
}

function buildRayAlgoTrendWindows(samples, bars) {
  const orderedSamples = (Array.isArray(samples) ? samples : [])
    .filter((sample) => sample?.ts && (sample?.direction === "long" || sample?.direction === "short"))
    .slice()
    .sort((left, right) => String(left.ts).localeCompare(String(right.ts)));

  if (!orderedSamples.length) {
    return [];
  }

  const lastBarTs = String(bars?.[bars.length - 1]?.ts || orderedSamples[orderedSamples.length - 1]?.ts || "").trim();
  const strategy = "rayalgo";
  const windows = [];
  let currentWindow = null;

  const closeWindow = (endTs, openEnded = false) => {
    if (!currentWindow || !endTs) {
      return;
    }
    windows.push({
      id: buildIndicatorWindowId(currentWindow.direction, currentWindow.startTs, endTs, [strategy]),
      strategy,
      direction: currentWindow.direction,
      startTs: currentWindow.startTs,
      endTs,
      tone: currentWindow.direction === "short" ? "bearish" : "bullish",
      conviction: currentWindow.maxConviction,
      openEnded,
      meta: {
        strategies: [strategy],
        sampleCount: currentWindow.sampleCount,
        source: "band_trend",
      },
    });
    currentWindow = null;
  };

  for (const sample of orderedSamples) {
    const sampleConviction = Math.max(0.18, Math.min(1, Number(sample?.conviction) || 0));
    if (!currentWindow) {
      currentWindow = {
        direction: sample.direction,
        startTs: sample.ts,
        maxConviction: sampleConviction,
        sampleCount: 1,
      };
      continue;
    }

    if (currentWindow.direction === sample.direction) {
      currentWindow.maxConviction = Math.max(currentWindow.maxConviction, sampleConviction);
      currentWindow.sampleCount += 1;
      continue;
    }

    closeWindow(sample.ts, false);
    currentWindow = {
      direction: sample.direction,
      startTs: sample.ts,
      maxConviction: sampleConviction,
      sampleCount: 1,
    };
  }

  if (currentWindow) {
    closeWindow(lastBarTs, true);
  }

  return windows;
}

function buildRayAlgoFeatureSnapshot({
  signal = null,
  bar = null,
  direction = "long",
  regime = null,
}) {
  const directionSign = String(direction || "").trim().toLowerCase() === "short" ? -1 : 1;
  const close = Number(bar?.c) || 0;
  const ema21 = Number(signal?.e21) || 0;
  const ema50 = Number(signal?.e50) || 0;
  const bandBasis = Number(signal?.bandBasis) || 0;
  const normalizedRegime = String(regime?.regime || "").trim().toLowerCase() || "unknown";
  const regimeAligned = normalizedRegime === "bull"
    ? directionSign > 0
    : normalizedRegime === "bear"
      ? directionSign < 0
      : null;
  const smcAlignedCount = [
    signal?.chochRecent === directionSign,
    signal?.bosRecent === directionSign,
    Boolean(signal?.ob) && signal?.obDir === directionSign,
    Boolean(signal?.sweep) && signal?.sweepDir === directionSign,
    Boolean(signal?.fvg) && signal?.fvgDir === directionSign,
  ].filter(Boolean).length;
  const recentCross = Number(signal?.emaCrossAge) < 8;

  return {
    regime: normalizedRegime,
    regimeAligned,
    emaBiasAligned: signal?.emaBias === directionSign,
    emaStackAligned: signal?.emaStack === directionSign,
    emaCrossAligned: signal?.emaCross === directionSign,
    freshCross: signal?.emaCross === directionSign,
    recentCross,
    nearSlowEma: recentCross && ema21 > 0 && Math.abs(close - ema21) / ema21 < 0.0015,
    chochAligned: signal?.chochRecent === directionSign,
    bosAligned: signal?.bosRecent === directionSign,
    obAligned: Boolean(signal?.ob) && signal?.obDir === directionSign,
    sweepAligned: Boolean(signal?.sweep) && signal?.sweepDir === directionSign,
    fvgAligned: Boolean(signal?.fvg) && signal?.fvgDir === directionSign,
    smcAlignedCount,
    trendAligned: directionSign > 0 ? close > (ema50 || close) : close < (ema50 || close),
    marketStructureAligned: signal?.mktStr === directionSign,
    rsiSupportive: directionSign > 0
      ? Number(signal?.rsi) >= 40 && Number(signal?.rsi) <= 68
      : Number(signal?.rsi) >= 32 && Number(signal?.rsi) <= 60,
    rsiExtended: directionSign > 0
      ? Number(signal?.rsi) > 68
      : Number(signal?.rsi) < 32,
    volSurge: Boolean(signal?.volSurge),
    bandTrendAligned: signal?.bandTrend === directionSign,
    bandRetestAligned: signal?.bandRetest === directionSign,
    bandBasisAligned: directionSign > 0 ? close > bandBasis : close < bandBasis,
    opposingBandTrend: Boolean(signal?.bandTrend) && signal?.bandTrend !== directionSign,
    opposingBandRetest: Boolean(signal?.bandRetest) && signal?.bandRetest !== directionSign,
    bodyAligned: signal?.bodyDir === directionSign,
    macdAligned: directionSign > 0
      ? (Number(signal?.macdLine) > 0 || signal?.macdCross === 1)
      : (Number(signal?.macdLine) < 0 || signal?.macdCross === -1),
    vwapPositionAligned: signal?.vPos === directionSign || signal?.vPos2 === directionSign,
    bbPositionAligned: signal?.bbPos === directionSign,
    volRatio: Number.isFinite(Number(signal?.volRatio)) ? +(Number(signal.volRatio).toFixed(3)) : null,
    rsi: Number.isFinite(Number(signal?.rsi)) ? +Number(signal.rsi).toFixed(1) : null,
    emaCrossAge: Number.isFinite(Number(signal?.emaCrossAge)) ? Number(signal.emaCrossAge) : null,
    distanceToE21Bps: ema21 > 0 ? +((((close - ema21) / ema21) * 10000)).toFixed(2) : null,
    distanceToBandBasisBps: bandBasis > 0 ? +((((close - bandBasis) / bandBasis) * 10000)).toFixed(2) : null,
  };
}

export function buildSignalOverlayTape(bars, regimes, cfg = {}) {
  if (!Array.isArray(bars) || !bars.length) {
    return createEmptyIndicatorOverlayTape();
  }

  const {
    strategy: rawStrategy,
    tfMin = 5,
    rayalgoSettings = null,
    executionBars: rawExecutionBars = [],
    signalTimeframe = "5m",
    rayalgoScoringConfig = null,
  } = cfg;
  const strategy = normalizeResearchStrategy(rawStrategy);
  const signalTfLabel = String(signalTimeframe || "").trim() || "5m";
  const executionBars = Array.isArray(rawExecutionBars) && rawExecutionBars.length
    ? rawExecutionBars
    : bars;
  const rayalgoScoringContext = buildRayAlgoScoringContext({
    strategy,
    signalTimeframe: signalTfLabel,
    executionBars,
    rayalgoSettings,
    rayalgoScoringConfig,
  });
  const tape = createEmptyIndicatorOverlayTape();
  const eventKeys = new Set();
  const zoneKeys = new Set();
  const barIndexByTs = new Map(bars.map((bar, index) => [bar?.ts, index]));
  const rayalgoTrendSamples = strategy === "rayalgo" ? [] : null;
  const swingState = { hi: [], lo: [], str: 0 };
  const warmup = Math.round(100 * (5 / tfMin));

  for (let index = warmup; index < bars.length; index += 1) {
    const bar = bars[index];
    const lookbackBars = bars.slice(Math.max(0, index - warmup), index);
    const regime = regimes[bar.date] || { regime: "range", vix: 17 };
    const tech = strategy === "rayalgo"
      ? analyzeTech(bar, lookbackBars, swingState, regime.regime, false, rayalgoSettings)
      : null;
    const signal = resolveBaseSignal({
      bar,
      lookbackBars,
      swingState,
      regime,
      strategy,
      rayalgoSettings,
      signalTimeframe: signalTfLabel,
      rayalgoScoringContext,
      techOverride: tech,
    });
    if (!signal) {
      continue;
    }

    if (rayalgoTrendSamples && bar?.ts && Number(signal?.tech?.bandTrend)) {
      rayalgoTrendSamples.push({
        ts: String(bar.ts).trim(),
        direction: Number(signal.tech.bandTrend) < 0 ? "short" : "long",
        conviction: Number(signal?.scoring?.score) || Math.abs(Number(signal?.tech?.rayConv) || 0),
      });
    }

    emitSignalIndicatorOverlays({
      tape,
      eventKeys,
      zoneKeys,
      bars,
      barIndexByTs,
      barIndex: index,
      bar,
      signal: signal.tech,
      strategyUsed: signal.strategyUsed,
      direction: signal.direction,
      conviction: signal.conviction,
      scoring: signal.scoring,
      regime,
    });
  }

  tape.windows = strategy === "rayalgo"
    ? buildRayAlgoTrendWindows(rayalgoTrendSamples, bars)
    : buildIndicatorSignalWindows(tape.events, bars);
  return tape;
}

function emitSignalIndicatorOverlays({
  tape,
  eventKeys,
  zoneKeys,
  bars,
  barIndexByTs,
  barIndex,
  bar,
  signal,
  strategyUsed,
  direction,
  conviction,
  scoring = null,
  regime,
}) {
  if (!tape || !signal || !strategyUsed || !bar?.ts) {
    return;
  }

  const signalDirection = String(direction || "").trim().toLowerCase() === "short" ? "short" : "long";
  const directionSign = directionToSign(signalDirection);
  const strategyKey = String(strategyUsed || "").trim().toLowerCase();
  const signalTs = bar.ts;
  const featureSnapshot = strategyKey === "rayalgo"
    ? buildRayAlgoFeatureSnapshot({ signal, bar, direction: signalDirection, regime })
    : null;
  const baseMeta = {
    signalTs,
    strategy: strategyKey,
    regime: regime?.regime || null,
    scoring: scoring || null,
    features: featureSnapshot,
  };
  const displayText = strategyKey === "rayalgo"
    ? String(scoring?.displayScoreText || signal?.rayDisplayScoreText || "").trim()
    : "";

  pushIndicatorEvent(tape, eventKeys, {
    id: buildIndicatorEventId(strategyKey, "signal_fire", signalTs, signalDirection),
    ts: signalTs,
    signalTs,
    strategy: strategyKey,
    eventType: "signal_fire",
    signalClass: strategyKey === "rayalgo" ? "trend_change" : null,
    direction: signalDirection,
    conviction,
    displayText,
    rawScore: scoring?.rawScore ?? null,
    confidenceScore: scoring?.confidenceScore ?? null,
    qualityScore: scoring?.qualityScore ?? null,
    effectiveScore: scoring?.effectiveScore ?? scoring?.score ?? conviction,
    effectiveScoreMode: scoring?.effectiveScoreMode ?? null,
    precursorBonus: scoring?.precursorBonus ?? null,
    score: scoring?.score ?? conviction,
    precursorLadderId: scoring?.precursorLadderId || null,
    signalRole: scoring?.signalRole || null,
    scoringVersion: scoring?.scoringVersion || null,
    executionProfile: scoring?.executionProfile || null,
    label: `${strategyOverlayTag(strategyKey)} ${Number(conviction).toFixed(2)}`,
    meta: {
      ...baseMeta,
      components: {
        emaCross: signal.emaCross,
        bosRecent: signal.bosRecent,
        chochRecent: signal.chochRecent,
        obDir: signal.ob ? signal.obDir : 0,
        sweepDir: signal.sweep ? signal.sweepDir : 0,
        bandTrend: signal.bandTrend || 0,
        bandRetest: signal.bandRetest || 0,
      },
    },
  });

  if (strategyKey === "rayalgo" && signal.emaCross === directionSign) {
    pushIndicatorEvent(tape, eventKeys, {
      id: buildIndicatorEventId(strategyKey, "ema_cross", signalTs, signalDirection),
      ts: signalTs,
      signalTs,
      strategy: strategyKey,
      eventType: "ema_cross",
      direction: signalDirection,
      conviction,
      displayText: "",
      label: "X",
      meta: baseMeta,
    });
  }

  if (signal.chochRecent === directionSign) {
    pushIndicatorEvent(tape, eventKeys, {
      id: buildIndicatorEventId(strategyKey, "choch", signalTs, signalDirection),
      ts: signalTs,
      signalTs,
      strategy: strategyKey,
      eventType: "choch",
      direction: signalDirection,
      conviction,
      displayText: "",
      label: "CH",
      price: signal.chochLevel,
      meta: {
        ...baseMeta,
        level: signal.chochLevel,
      },
    });
  }

  if (signal.bosRecent === directionSign) {
    pushIndicatorEvent(tape, eventKeys, {
      id: buildIndicatorEventId(strategyKey, "bos", signalTs, signalDirection),
      ts: signalTs,
      signalTs,
      strategy: strategyKey,
      eventType: "bos",
      direction: signalDirection,
      conviction,
      displayText: "",
      label: "BOS",
      price: signal.bosLevel,
      meta: {
        ...baseMeta,
        level: signal.bosLevel,
      },
    });
  }

  if (signal.sweep && signal.sweepDir === directionSign) {
    pushIndicatorEvent(tape, eventKeys, {
      id: buildIndicatorEventId(strategyKey, "sweep", signalTs, signalDirection),
      ts: signalTs,
      signalTs,
      strategy: strategyKey,
      eventType: "sweep",
      direction: signalDirection,
      conviction,
      displayText: "",
      label: "SWP",
      price: signal.sweepLevel,
      meta: {
        ...baseMeta,
        level: signal.sweepLevel,
      },
    });
  }

  if (strategyKey === "bb_squeeze" && signal.bbSqueeze) {
    pushIndicatorEvent(tape, eventKeys, {
      id: buildIndicatorEventId(strategyKey, "squeeze", signalTs, signalDirection),
      ts: signalTs,
      signalTs,
      strategy: strategyKey,
      eventType: "squeeze",
      direction: signalDirection,
      conviction,
      displayText: "",
      label: "SQZ",
      meta: baseMeta,
    });
  }

  if (["rayalgo", "sweep_reversal"].includes(strategyKey) && signal.ob && signal.obDir === directionSign) {
    pushIndicatorEvent(tape, eventKeys, {
      id: buildIndicatorEventId(strategyKey, "order_block_touch", signalTs, signalDirection),
      ts: signalTs,
      signalTs,
      strategy: strategyKey,
      eventType: "order_block_touch",
      direction: signalDirection,
      conviction,
      displayText: "",
      label: "OB",
      meta: {
        ...baseMeta,
        top: signal.obTop,
        bottom: signal.obBottom,
      },
    });
  }

  if (strategyKey === "momentum_breakout" && signal.fvg && signal.fvgDir === directionSign) {
    pushIndicatorEvent(tape, eventKeys, {
      id: buildIndicatorEventId(strategyKey, "fvg_touch", signalTs, signalDirection),
      ts: signalTs,
      signalTs,
      strategy: strategyKey,
      eventType: "fvg_touch",
      direction: signalDirection,
      conviction,
      displayText: "",
      label: "FVG",
      meta: {
        ...baseMeta,
        top: signal.fvgTop,
        bottom: signal.fvgBottom,
      },
    });
  }

  if (signal.ob && signal.obDir === directionSign && Number.isFinite(Number(signal.obTop)) && Number.isFinite(Number(signal.obBottom))) {
    const startIndex = barIndexByTs.get(signal.obAnchorTs) ?? barIndex;
    const anchorVolumeRatio = resolveAnchorVolumeRatio(bars, startIndex);
    const endTs = resolveIndicatorZoneEndTs(bars, startIndex, "order_block", signalDirection, signal.obTop, signal.obBottom);
    pushIndicatorZone(tape, zoneKeys, {
      id: buildIndicatorZoneId(strategyKey, "order_block", signal.obAnchorTs || signalTs, signalDirection, signal.obTop, signal.obBottom),
      signalTs,
      strategy: strategyKey,
      zoneType: "order_block",
      direction: signalDirection,
      startTs: signal.obAnchorTs || signalTs,
      endTs,
      top: signal.obTop,
      bottom: signal.obBottom,
      label: "OB",
      meta: {
        ...baseMeta,
        anchorVolumeRatio,
      },
    });
  }

  if (signal.fvg && signal.fvgDir === directionSign && Number.isFinite(Number(signal.fvgTop)) && Number.isFinite(Number(signal.fvgBottom))) {
    const startIndex = barIndexByTs.get(signal.fvgAnchorTs) ?? barIndex;
    const endTs = resolveIndicatorZoneEndTs(bars, startIndex, "fair_value_gap", signalDirection, signal.fvgTop, signal.fvgBottom);
    pushIndicatorZone(tape, zoneKeys, {
      id: buildIndicatorZoneId(strategyKey, "fair_value_gap", signal.fvgAnchorTs || signalTs, signalDirection, signal.fvgTop, signal.fvgBottom),
      signalTs,
      strategy: strategyKey,
      zoneType: "fair_value_gap",
      direction: signalDirection,
      startTs: signal.fvgAnchorTs || signalTs,
      endTs,
      top: signal.fvgTop,
      bottom: signal.fvgBottom,
      label: "FVG",
      meta: baseMeta,
    });
  }
}

export function collectReplayEntryCandidates(bars, regimes, cfg = {}) {
  const {
    strategy: rawStrategy,
    minConviction,
    allowShorts,
    regimeFilter,
    sessionBlocks,
    tradeDays = [true, true, true, true, true],
    executionFidelity = "bar_close",
    executionBars: rawExecutionBars = [],
    regimeAdapt = false,
    rayalgoSettings = null,
    signalTimeframe = "5m",
    rayalgoScoringConfig = null,
    optionSelectionSpec = null,
    backtestV2RuntimeBridge = null,
    tfMin = 5,
  } = cfg;
  const strategy = normalizeResearchStrategy(rawStrategy);
  const entryGateConfig = normalizeBacktestV2EntryGateConfig(backtestV2RuntimeBridge?.entryGateConfig || null);
  const executionPolicyConfig = normalizeBacktestV2ExecutionPolicyConfig(backtestV2RuntimeBridge?.executionPolicyConfig || null);
  const effectiveMinConviction = entryGateConfig?.minConviction ?? minConviction;
  const effectiveAllowShorts = entryGateConfig?.allowShorts ?? allowShorts;
  const effectiveRegimeFilter = entryGateConfig?.regimeFilter ?? regimeFilter;
  const effectiveTradeDays = executionPolicyConfig?.tradeDays || tradeDays;
  const effectiveSessionBlocks = executionPolicyConfig?.sessionBlocks || sessionBlocks;
  const effectiveRegimeAdapt = executionPolicyConfig?.regimeAdapt ?? regimeAdapt;
  const normalizedExecutionBars = Array.isArray(rawExecutionBars) && rawExecutionBars.length
    ? rawExecutionBars
    : bars;
  const rayalgoScoringContext = buildRayAlgoScoringContext({
    strategy,
    signalTimeframe,
    executionBars: normalizedExecutionBars,
    rayalgoSettings,
    rayalgoScoringConfig,
  });

  const useSubCandleExecution = executionFidelity === "sub_candle";
  const executionWindows = useSubCandleExecution
    ? buildExecutionWindows(bars, normalizedExecutionBars, tfMin)
    : [];
  const swingState = { hi: [], lo: [], str: 0 };
  const warmup = Math.round(100 * (5 / tfMin));
  const seen = new Set();
  const candidates = [];

  for (let index = warmup; index < bars.length; index += 1) {
    const bar = bars[index];
    const lookbackBars = bars.slice(Math.max(0, index - warmup), index);
    const dayOfWeek = getDateTextDayOfWeek(bar.date);
    if (dayOfWeek >= 1 && dayOfWeek <= 5 && !effectiveTradeDays[dayOfWeek - 1]) {
      continue;
    }

    const barMinutes = bar.hour * 60 + bar.min - MARKET_SESSION_OPEN_MINUTES;
    const blockIndex = Math.floor(barMinutes / 30);
    if (blockIndex < 0 || blockIndex > 12 || !effectiveSessionBlocks?.[blockIndex]) {
      continue;
    }

    const regime = regimes[bar.date] || { regime: "range", vix: 17 };
    if (effectiveRegimeFilter === "not_bear" && regime.regime === "bear") {
      continue;
    }

    const signal = resolveTradeSignal({
      bar,
      lookbackBars,
      swingState,
      regime,
      strategy,
      allowShorts: effectiveAllowShorts,
      minConviction: effectiveMinConviction,
      regimeAdapt: effectiveRegimeAdapt,
      rayalgoSettings,
      signalTimeframe,
      rayalgoScoringContext,
    });
    if (!signal) {
      continue;
    }

    const entryBar = useSubCandleExecution
      ? (executionWindows[index + 1]?.[0] || bars[index + 1] || null)
      : bar;
    if (!entryBar) {
      continue;
    }

    const right = signal.direction === "short" ? "put" : "call";
    const key = buildReplayEntryKey(entryBar.ts, right, signal.strategyUsed);
    if (seen.has(key)) {
      continue;
    }

    const fallbackSelectionSpec = optionSelectionSpec && typeof optionSelectionSpec === "object"
      ? optionSelectionSpec
      : {};
    const resolvedSelectionSpec = backtestV2RuntimeBridge?.replaySelectionConfig?.dynamicTargetDte
      ? resolveBacktestV2CandidateSelection({
        stageConfig: backtestV2RuntimeBridge.stageConfig,
        signalTimeframe,
        regime,
        signal,
        entryTs: entryBar.ts,
        fallbackMinuteOfDay: entryBar.hour * 60 + entryBar.min,
        fallbackStrikeSlot: fallbackSelectionSpec.strikeSlot,
      })
      : null;
    const selectedTargetDte = resolvedSelectionSpec?.targetDte ?? fallbackSelectionSpec?.targetDte ?? null;
    const entryGateDecision = resolveBacktestV2EntryGateDecision({
      signal,
      regime,
      entryDate: bar.date,
      dte: selectedTargetDte,
      conviction: signal.conviction,
      entryGateConfig,
    });
    if (!entryGateDecision.allow) {
      continue;
    }

    seen.add(key);

    const entrySpot = Number.isFinite(Number(entryBar.o)) ? Number(entryBar.o) : Number(entryBar.c);
    if (!Number.isFinite(entrySpot) || entrySpot <= 0) {
      continue;
    }

    candidates.push({
      key,
      signalTs: bar.ts,
      entryTs: entryBar.ts,
      entryDate: entryBar.date,
      direction: signal.direction,
      signalClass: signal.signalClass || signal.scoring?.signalClass || null,
      qualityScore: signal.scoring?.qualityScore ?? signal.scoring?.score ?? null,
      spotPrice: entrySpot,
      optionSelectionSpec: {
        targetDte: resolvedSelectionSpec?.targetDte ?? fallbackSelectionSpec?.targetDte ?? null,
        minDte: resolvedSelectionSpec?.minDte ?? fallbackSelectionSpec?.minDte ?? null,
        maxDte: resolvedSelectionSpec?.maxDte ?? fallbackSelectionSpec?.maxDte ?? null,
        strikeSlot: resolvedSelectionSpec?.strikeSlot ?? fallbackSelectionSpec?.strikeSlot ?? null,
        moneyness: fallbackSelectionSpec?.moneyness ?? null,
        strikeSteps: fallbackSelectionSpec?.strikeSteps ?? null,
      },
      dteSelectionMode: resolvedSelectionSpec?.selectionMode || null,
    });
  }

  return candidates;
}

const PROGRESS_CHUNK_SIZE = 300;
export const BACKTEST_PHASES = [
  { id: 0, label: "Preparing signals" },
  { id: 1, label: "Scanning for entries" },
  { id: 2, label: "Closing positions" },
  { id: 3, label: "Building overlays" },
  { id: 4, label: "Computing results" },
];
const PHASE_PREPARE = 0;
const PHASE_SCAN = 1;
const PHASE_CLOSE = 2;
const PHASE_OVERLAYS = 3;
const PHASE_RESULTS = 4;

function* runBacktestGenerator(bars, regimes, cfg) {
  const {
    strategy: rawStrategy,
    dte,
    iv,
    slPct,
    tpPct,
    trailStartPct,
    trailPct,
    zombieBars,
    minConviction,
    allowShorts,
    kellyFrac,
    regimeFilter,
    maxPositions,
    capital: initialCapital,
    sessionBlocks,
    tfMin = 5,
    regimeAdapt = false,
    commPerContract = 0.65,
    slipBps = 150,
    tradeDays = [true, true, true, true, true],
    executionFidelity = "bar_close",
    executionBars: rawExecutionBars = [],
    executionMode = "spot_model",
    optionHistoryBars: rawOptionHistoryBars = [],
    optionContract = null,
    optionReplayDataset = null,
    includeIndicatorOverlays = false,
    rayalgoSettings = null,
    signalTimeframe = "5m",
    rayalgoScoringConfig = null,
    optionSelectionSpec = null,
    positionSizingConfig: rawPositionSizingConfig = null,
    riskStopConfig: rawRiskStopConfig = null,
    backtestV2RuntimeBridge = null,
    riskStopPolicy: rawRiskStopPolicy = RISK_STOP_LEGACY_HALT,
  } = cfg;
  const bridgeLegacyOverrides = backtestV2RuntimeBridge?.legacyOverrides || null;
  const strategy = normalizeResearchStrategy(rawStrategy);
  const riskStopPolicy = normalizeRiskStopPolicy(bridgeLegacyOverrides?.riskStopPolicy ?? rawRiskStopPolicy);
  const positionSizingConfig = normalizePositionSizingConfig(rawPositionSizingConfig);
  const riskStopConfig = normalizeRuntimeRiskStopConfig(rawRiskStopConfig, maxPositions);
  const entryGateConfig = normalizeBacktestV2EntryGateConfig(backtestV2RuntimeBridge?.entryGateConfig || null);
  const layerConfig = normalizeBacktestV2LayerConfig(backtestV2RuntimeBridge?.layerConfig || null);
  const exitGovernorConfig = normalizeBacktestV2ExitGovernorConfig(backtestV2RuntimeBridge?.exitGovernorConfig || null);
  const executionPolicyConfig = normalizeBacktestV2ExecutionPolicyConfig(backtestV2RuntimeBridge?.executionPolicyConfig || null);
  const effectiveInitialCapital = clampNumber(
    bridgeLegacyOverrides?.capital,
    100,
    100000000,
    initialCapital,
  );
  const effectiveKellyFrac = clampNumber(
    bridgeLegacyOverrides?.kellyFrac,
    0,
    5,
    kellyFrac,
  );
  const effectiveBaseDte = Number.isFinite(Number(backtestV2RuntimeBridge?.optionSelectionSpec?.targetDte))
    ? Number(backtestV2RuntimeBridge.optionSelectionSpec.targetDte)
    : (Number.isFinite(Number(bridgeLegacyOverrides?.dte)) ? Number(bridgeLegacyOverrides.dte) : dte);
  const effectiveMinConviction = entryGateConfig?.minConviction ?? minConviction;
  const effectiveAllowShorts = entryGateConfig?.allowShorts ?? allowShorts;
  const effectiveRegimeFilter = entryGateConfig?.regimeFilter ?? regimeFilter;
  const effectiveMaxPositions = riskStopConfig.maxPositions ?? Math.max(1, Number(maxPositions) || 1);
  const effectiveSessionBlocks = executionPolicyConfig?.sessionBlocks || sessionBlocks;
  const effectiveTradeDays = executionPolicyConfig?.tradeDays || tradeDays;
  const effectiveRegimeAdapt = executionPolicyConfig?.regimeAdapt ?? regimeAdapt;
  const effectiveCommPerContract = executionPolicyConfig?.commPerContract ?? commPerContract;
  const effectiveSlipBps = executionPolicyConfig?.slipBps ?? slipBps;
  const effectiveTakeProfitPct = exitGovernorConfig?.takeProfitPct ?? tpPct;
  const useSubCandleExecution = executionFidelity === "sub_candle";
  const normalizedExecutionBars = Array.isArray(rawExecutionBars) && rawExecutionBars.length
    ? rawExecutionBars
    : bars;

  yield { phase: PHASE_PREPARE, phasePct: 33, totalBars: bars.length };

  const tradingDayIndexByDate = buildTradingDayIndexByDate(normalizedExecutionBars);
  const spotAtrByTs = buildAtrByBarTs(normalizedExecutionBars);
  const rayalgoScoringContext = buildRayAlgoScoringContext({
    strategy,
    signalTimeframe,
    executionBars: normalizedExecutionBars,
    rayalgoSettings,
    rayalgoScoringConfig,
  });

  yield { phase: PHASE_PREPARE, phasePct: 66, totalBars: bars.length };

  const fixedOptionHistoryBars = executionMode === "option_history"
    ? normalizeOptionHistoryBars(rawOptionHistoryBars)
    : [];
  const optionReplayContractsByKey = executionMode === "option_history" && optionReplayDataset?.contractsByKey
    ? optionReplayDataset.contractsByKey
    : {};
  const optionReplaySkippedByKey = executionMode === "option_history" && optionReplayDataset?.skippedByKey
    ? optionReplayDataset.skippedByKey
    : {};
  const optionReplayBarsByTicker = executionMode === "option_history" && optionReplayDataset?.barsByTicker
    ? Object.fromEntries(
      Object.entries(optionReplayDataset.barsByTicker)
        .map(([ticker, optionBars]) => [ticker, normalizeOptionHistoryBars(optionBars)])
        .filter(([, optionBars]) => optionBars.length > 0),
    )
    : {};
  const hasDynamicOptionReplay = executionMode === "option_history"
    && Object.keys(optionReplayContractsByKey).length > 0;
  const fixedOptionRight = String(optionContract?.right || "").trim().toLowerCase();
  const fixedOptionExpiry = String(optionContract?.expiry || "").trim() || null;
  const fixedOptionStrike = Number(optionContract?.strike);
  const optionHistoryReady = executionMode !== "option_history"
    || (
      fixedOptionHistoryBars.length > 0
      && fixedOptionExpiry
      && Number.isFinite(fixedOptionStrike)
      && ["call", "put"].includes(fixedOptionRight)
    );
  const getOptionSnapshotForPosition = (position, bar) => {
    if (executionMode !== "option_history") {
      return null;
    }
    const ticker = String(position?.optionTicker || "").trim().toUpperCase();
    if (ticker && optionReplayBarsByTicker[ticker]?.length) {
      return findOptionHistoryBar(optionReplayBarsByTicker[ticker], bar);
    }
    return findOptionHistoryBar(fixedOptionHistoryBars, bar);
  };
  const executionWindows = useSubCandleExecution
    ? buildExecutionWindows(bars, normalizedExecutionBars, tfMin)
    : [];
  const indicatorOverlayTape = includeIndicatorOverlays
    ? createEmptyIndicatorOverlayTape()
    : null;
  const indicatorEventKeys = new Set();
  const indicatorZoneKeys = new Set();
  const barIndexByTs = new Map(bars.map((candidate, index) => [candidate?.ts, index]));
  const rayalgoTrendSamples = indicatorOverlayTape && strategy === "rayalgo" ? [] : null;

  const zombieBarsAdjusted = Math.round((exitGovernorConfig?.zombieBars ?? zombieBars) * (5 / tfMin));
  const equityEvery = Math.max(1, Math.round((5 / tfMin) * 5));
  const vixValues = Object.values(regimes).map((row) => row.vix).filter((value) => value > 0).sort((a, b) => a - b);
  const vixPercentile = (value) => {
    if (!vixValues.length) return 50;
    const index = vixValues.findIndex((candidate) => candidate >= value);
    if (index < 0) return 100;
    return (index / vixValues.length) * 100;
  };

  let capital = effectiveInitialCapital;
  const openPositions = [];
  const closedTrades = [];
  const skippedTrades = [];
  const equity = [];
  const kellyHistory = [];
  const swingState = { hi: [], lo: [], str: 0 };
  let dayPnl = 0;
  let currentDate = "";
  let peakCapital = effectiveInitialCapital;
  let equityIndex = 0;
  let tradeSequence = 0;
  const warmup = Math.round(100 * (5 / tfMin));
  let lastProgressTradeCount = 0;
  let lastProgressEquityCount = 0;
  let consecutiveLosses = 0;
  let winCount = 0;
  let lastLossTsMs = null;
  const lastMaxLossCooldownByDirection = {
    long: null,
    short: null,
  };
  let persistentRiskHaltResumeCapital = null;
  const riskStop = {
    policy: riskStopPolicy,
    config: riskStopConfig,
    profileName: backtestV2RuntimeBridge?.support?.profileName || null,
    triggered: false,
    reason: null,
    triggerTs: null,
    triggerDate: null,
    peakDrawdownPct: 0,
    dayLossPct: 0,
  };
  const recordSkippedTrade = (payload) => {
    skippedTrades.push({
      pricingMode: executionMode,
      ...payload,
    });
  };
  const buildProgressDeltas = () => {
    const tradeDelta = closedTrades
      .slice(lastProgressTradeCount)
      .map((trade) => ({ ...trade }));
    const equityDelta = equity
      .slice(lastProgressEquityCount)
      .map((entry) => ({ ...entry }));
    lastProgressTradeCount = closedTrades.length;
    lastProgressEquityCount = equity.length;
    return {
      tradeDelta,
      equityDelta,
    };
  };

  yield { phase: PHASE_PREPARE, phasePct: 100, totalBars: bars.length, ...buildProgressDeltas() };

  for (let index = warmup; index < bars.length; index += 1) {
    const bar = bars[index];
    const lookbackBars = bars.slice(Math.max(0, index - warmup), index);

    if (bar.date !== currentDate) {
      dayPnl = 0;
      currentDate = bar.date;
    }

    if (
      Number.isFinite(Number(persistentRiskHaltResumeCapital))
      && capital >= Number(persistentRiskHaltResumeCapital)
    ) {
      persistentRiskHaltResumeCapital = null;
    }

    peakCapital = Math.max(peakCapital, capital);
    const toClose = [];

    for (const position of openPositions) {
      position.bh += 1;
      if (useSubCandleExecution) {
        const executionWindow = executionWindows[index] || [bar];
        for (const executionBar of executionWindow) {
          if (
            evaluatePositionOnExecutionBar({
              position,
              executionBar,
              executionMode,
              iv,
              regimeAdapt: effectiveRegimeAdapt,
              tpPct: effectiveTakeProfitPct,
              slPct,
              trailStartPct,
              trailPct,
              zombieBarsAdjusted,
              getOptionSnapshotForPosition,
              exitGovernorConfig,
              tradingDayIndexByDate,
              spotAtr: spotAtrByTs.get(String(executionBar?.ts || "").trim()) ?? null,
              regime: regimes[executionBar?.date] || regimes[position?.entryDate] || null,
            })
          ) {
          toClose.push({ position, exitBar: executionBar });
          break;
        }
        }
        continue;
      }

      const remainingCalendarDte = calendarDaysTo(bar.date, bar.hour, bar.min, position.expiryDate);
      const remainingDays = remainingCalendarDte * 365.25;
      const optionSnapshot = getOptionSnapshotForPosition(position, bar);
      let currentOptionPrice;
      if (executionMode === "option_history") {
        if (optionSnapshot) {
          currentOptionPrice = Math.max(optionSnapshot.c, 0.001);
        } else if (remainingDays < 0.05 && bar.date === position.expiryDate) {
          currentOptionPrice = Math.max(position.ic ? bar.c - position.k : position.k - bar.c, 0.001);
        } else {
          currentOptionPrice = Math.max((position.mtm || position.cost) / Math.max(position.qty * 100, 1), 0.001);
        }
      } else {
        const useIv = effectiveRegimeAdapt && position.vix > 0
          ? ivForDTE(position.vix / 100, remainingCalendarDte)
          : ivForDTE(iv, remainingCalendarDte);
        currentOptionPrice = Math.max(priceOption(bar.c, position.k, remainingCalendarDte, useIv, position.ic), 0.001);
      }
      position.pk = Math.max(position.pk, currentOptionPrice);
      position.mtm = currentOptionPrice * 100 * position.qty;
      const decision = evaluatePositionExitPolicy({
        position,
        executionBar: bar,
        remainingDays,
        priceRange: {
          open: currentOptionPrice,
          high: currentOptionPrice,
          low: currentOptionPrice,
          close: currentOptionPrice,
        },
        tpPct: effectiveTakeProfitPct,
        slPct,
        trailStartPct,
        trailPct,
        zombieBarsAdjusted,
        exitGovernorConfig,
        tradingDayIndexByDate,
        spotAtr: spotAtrByTs.get(String(bar?.ts || "").trim()) ?? null,
        regime: regimes[bar?.date] || regimes[position?.entryDate] || null,
      });
      const exitReason = decision?.exitReason || null;

      if (exitReason) {
        position.exitTriggerPrice = decision?.exitPrice ?? currentOptionPrice;
        position.exitSpotPrice = Number.isFinite(Number(bar?.c))
          ? Number(bar.c)
          : (Number.isFinite(Number(bar?.o)) ? Number(bar.o) : position.exitSpotPrice);
        position.ep = exitReason === "expired"
          ? Math.max(position.ic ? bar.c - position.k : position.k - bar.c, 0)
          : currentOptionPrice;
        position.er = exitReason;
        position.et = bar.ts;
        position.exitOptionOpen = currentOptionPrice;
        position.exitOptionHigh = currentOptionPrice;
        position.exitOptionLow = currentOptionPrice;
        position.exitOptionClose = currentOptionPrice;
        if (!Number.isFinite(Number(position.exitTriggerPrice))) {
          position.exitTriggerPrice = position.ep;
        }
        toClose.push({ position, exitBar: bar });
      }
    }

    for (const closing of toClose) {
      const position = closing.position;
      const exitBar = closing.exitBar || bar;
      const remainingCalendarDte = calendarDaysTo(exitBar.date, exitBar.hour, exitBar.min, position.expiryDate);
      const exitHalfSpread = position.er === "expired"
        ? 0.01
        : spreadModel(remainingCalendarDte, position.ep, exitBar.hour + exitBar.min / 60);
      const exitSlippageAmount = resolveOptionSlippageAmount(position.ep, effectiveSlipBps);
      const exitFill = Math.max(position.ep - exitHalfSpread - exitSlippageAmount, 0);
      const exitCommission = position.qty * effectiveCommPerContract;
      position.exitBasePrice = position.ep;
      position.exitSpreadHalf = exitHalfSpread;
      position.exitSlippageBps = effectiveSlipBps;
      position.exitSlippageAmount = exitSlippageAmount;
      position.exitFill = exitFill;
      position.commOut = exitCommission;
      position.fees = (position.fees || 0) + exitCommission;
      position.pnl = (exitFill - position.oe) * 100 * position.qty - exitCommission;
      const exitTimeMs = getBarTimeMs(exitBar);
      capital += position.cost + position.pnl;
      dayPnl += position.pnl;
      kellyHistory.push((position.pnl / position.cost) * 100);
      if (position.pnl <= 0) {
        consecutiveLosses += 1;
        lastLossTsMs = Number.isFinite(exitTimeMs) ? exitTimeMs : lastLossTsMs;
      } else {
        consecutiveLosses = 0;
        winCount += 1;
      }
      if (
        position.er === "max_loss_breaker"
        || (exitGovernorConfig && position.er === "stop_loss")
      ) {
        const directionKey = position.dir === "short" ? "short" : "long";
        lastMaxLossCooldownByDirection[directionKey] = Number.isFinite(exitTimeMs)
          ? exitTimeMs
          : lastMaxLossCooldownByDirection[directionKey];
      }
      openPositions.splice(openPositions.indexOf(position), 1);
      closedTrades.push(position);
    }

    if (index % equityEvery === 0) {
      const openValue = openPositions.reduce((sum, position) => sum + (position.mtm || position.cost), 0);
      equity.push({ i: equityIndex += 1, bal: +(capital + openValue).toFixed(2), ts: bar.ts });
    }

    if ((index - warmup) % PROGRESS_CHUNK_SIZE === 0 && index > warmup) {
      const effectiveTotal = Math.max(bars.length - warmup, 1);
      yield {
        phase: PHASE_SCAN,
        phasePct: Math.round(((index - warmup) / effectiveTotal) * 100),
        totalBars: bars.length,
        barIndex: index,
        currentDate,
        tradeCount: closedTrades.length,
        winCount,
        openPositionCount: openPositions.length,
        capital: +capital.toFixed(2),
        initialCapital: effectiveInitialCapital,
        peakCapital,
        ...buildProgressDeltas(),
      };
    }

    if (
      Number.isFinite(Number(persistentRiskHaltResumeCapital))
      && capital >= Number(persistentRiskHaltResumeCapital)
    ) {
      persistentRiskHaltResumeCapital = null;
    }

    const barTimeMs = getBarTimeMs(bar);
    const entryRiskDecision = resolveBacktestV2RiskControlDecision({
      riskStopPolicy,
      riskStopConfig,
      currentCapital: capital,
      peakCapital,
      initialCapital: effectiveInitialCapital,
      dayPnl,
      barTimeMs,
      direction: null,
      consecutiveLosses,
      lastLossTsMs,
      lastMaxLossTsMs: null,
      persistentHaltResumeCapital: persistentRiskHaltResumeCapital,
    });
    if (
      (entryRiskDecision.hitDrawdownLimit || entryRiskDecision.hitDayLossLimit)
      && riskStopConfig.persistUntilNewEquityHigh
      && !Number.isFinite(Number(persistentRiskHaltResumeCapital))
    ) {
      persistentRiskHaltResumeCapital = peakCapital;
    }
    if ((entryRiskDecision.hitDrawdownLimit || entryRiskDecision.hitDayLossLimit) && !riskStop.triggered) {
      riskStop.triggered = true;
      riskStop.reason = entryRiskDecision.reason;
      riskStop.triggerTs = bar.ts || null;
      riskStop.triggerDate = bar.date || null;
      riskStop.peakDrawdownPct = +Number(entryRiskDecision.peakDrawdownPct || 0).toFixed(2);
      riskStop.dayLossPct = +Number(entryRiskDecision.dayLossPct || 0).toFixed(2);
    }

    if (
      !entryRiskDecision.allowEntries
      || openPositions.length >= effectiveMaxPositions
    ) {
      continue;
    }

    const dayOfWeek = getDateTextDayOfWeek(bar.date);
    if (dayOfWeek >= 1 && dayOfWeek <= 5 && !effectiveTradeDays[dayOfWeek - 1]) {
      continue;
    }

    const barMinutes = bar.hour * 60 + bar.min - MARKET_SESSION_OPEN_MINUTES;
    const blockIndex = Math.floor(barMinutes / 30);
    if (blockIndex < 0 || blockIndex > 12 || !effectiveSessionBlocks[blockIndex]) {
      continue;
    }

    const regime = regimes[bar.date] || { regime: "range", vix: 17 };
    if (effectiveRegimeFilter === "not_bear" && regime.regime === "bear") {
      continue;
    }

    const rayalgoTech = indicatorOverlayTape && strategy === "rayalgo"
      ? analyzeTech(bar, lookbackBars, swingState, regime.regime, false, rayalgoSettings)
      : null;
    const signalCandidate = resolveTradeSignal({
      bar,
      lookbackBars,
      swingState,
      regime,
      strategy,
      allowShorts: indicatorOverlayTape ? true : effectiveAllowShorts,
      minConviction: effectiveMinConviction,
      regimeAdapt: effectiveRegimeAdapt,
      rayalgoSettings,
      signalTimeframe,
      rayalgoScoringContext,
      techOverride: rayalgoTech,
    });
    if (!signalCandidate) {
      continue;
    }

    const overlaySignal = signalCandidate;
    const executableSignal = overlaySignal.direction === "short" && !effectiveAllowShorts
      ? null
      : overlaySignal;

    if (rayalgoTrendSamples && bar?.ts && Number(overlaySignal?.tech?.bandTrend)) {
      rayalgoTrendSamples.push({
        ts: String(bar.ts).trim(),
        direction: Number(overlaySignal.tech.bandTrend) < 0 ? "short" : "long",
        conviction: Number(overlaySignal?.scoring?.score) || Math.abs(Number(overlaySignal?.tech?.rayConv) || 0),
      });
    }

    if (indicatorOverlayTape) {
      emitSignalIndicatorOverlays({
        tape: indicatorOverlayTape,
        eventKeys: indicatorEventKeys,
        zoneKeys: indicatorZoneKeys,
        bars,
        barIndexByTs,
        barIndex: index,
        bar,
        signal: overlaySignal.tech,
        strategyUsed: overlaySignal.strategyUsed,
        direction: overlaySignal.direction,
        conviction: overlaySignal.conviction,
        scoring: overlaySignal.scoring,
        regime,
      });
    }

    if (!executableSignal) {
      continue;
    }
    const {
      direction,
      conviction,
      strategyUsed,
      tech,
    } = executableSignal;
    const entryBar = useSubCandleExecution
      ? (executionWindows[index + 1]?.[0] || bars[index + 1] || null)
      : bar;
    if (!entryBar) {
      continue;
    }
    const fallbackSelectionSpec = optionSelectionSpec && typeof optionSelectionSpec === "object"
      ? optionSelectionSpec
      : {};
    const resolvedSelectionSpec = backtestV2RuntimeBridge?.replaySelectionConfig?.dynamicTargetDte
      ? resolveBacktestV2CandidateSelection({
        stageConfig: backtestV2RuntimeBridge.stageConfig,
        signalTimeframe,
        regime,
        signal: executableSignal,
        entryTs: entryBar.ts,
        fallbackMinuteOfDay: entryBar.hour * 60 + entryBar.min,
        fallbackStrikeSlot: fallbackSelectionSpec.strikeSlot,
      })
      : null;
    const selectedTargetDte = resolvedSelectionSpec?.targetDte ?? effectiveBaseDte;
    const directionKey = direction === "short" ? "short" : "long";
    const directionRiskDecision = resolveBacktestV2RiskControlDecision({
      riskStopPolicy,
      riskStopConfig,
      currentCapital: capital,
      peakCapital,
      initialCapital: effectiveInitialCapital,
      dayPnl,
      barTimeMs,
      direction,
      consecutiveLosses,
      lastLossTsMs,
      lastMaxLossTsMs: lastMaxLossCooldownByDirection[directionKey],
      persistentHaltResumeCapital: persistentRiskHaltResumeCapital,
    });
    if (!directionRiskDecision.allowEntries) {
      continue;
    }
    if (
      entryGateConfig?.oppositeDirectionSkip
      && openPositions.some((position) => position.dir && position.dir !== direction)
    ) {
      continue;
    }
    const entryGateDecision = resolveBacktestV2EntryGateDecision({
      signal: executableSignal,
      regime,
      entryDate: bar.date,
      dte: selectedTargetDte,
      conviction,
      entryGateConfig,
    });
    if (!entryGateDecision.allow) {
      continue;
    }
    const openSameDirectionCount = openPositions.filter((position) => position.dir === direction).length;
    if (openSameDirectionCount >= riskStopConfig.maxConcurrentSameDirection) {
      continue;
    }
    const layerPlan = resolveBacktestV2LayerPlan({
      layerConfig,
      openSameDirectionCount,
      score: executableSignal?.scoring?.score,
      conviction,
      minConviction: effectiveMinConviction,
    });
    if (!layerPlan.allow) {
      continue;
    }
    const rayalgoSizingUpgrade = strategyUsed === "rayalgo"
      ? resolveRayAlgoSizingUpgrade(
        executableSignal?.scoring,
        entryGateConfig?.mtfConfirmUpgradesSizing ?? true,
      )
      : { applied: false, multiplier: 1 };
    const sizingConviction = conviction * rayalgoSizingUpgrade.multiplier;

    let baseSizePct = 0.5 * sizingConviction;
    if (kellyHistory.length >= 10) {
      const recent = kellyHistory.slice(-positionSizingConfig.kellyLookbackTrades);
      const winners = recent.filter((value) => value > 0);
      const losers = recent.filter((value) => value <= 0);
      if (winners.length && losers.length) {
        const winRate = winners.length / recent.length;
        const avgWinner = winners.reduce((sum, value) => sum + value, 0) / winners.length;
        const avgLoser = Math.abs(losers.reduce((sum, value) => sum + value, 0) / losers.length);
        let kelly = (
          (winRate * (avgWinner / Math.max(avgLoser, 0.01)) - (1 - winRate))
          / Math.max(avgWinner / Math.max(avgLoser, 0.01), 0.01)
        ) * 100;
        kelly = Math.max(0, kelly) * effectiveKellyFrac * Math.max(sizingConviction, 0.5);
        if (effectiveRegimeAdapt) {
          const percentile = vixPercentile(regime.vix);
          const sizing = percentile < 20 ? 1.2 : percentile < 40 ? 1.05 : percentile < 60 ? 1.0 : percentile < 80 ? 0.75 : 0.5;
          kelly *= sizing;
        } else if (regime.vix > 30) kelly *= 0.5;
        else if (regime.vix > 25) kelly *= 0.65;
        else if (regime.vix > 20) kelly *= 0.8;
        baseSizePct = Math.max(positionSizingConfig.kellyFloorPct, Math.min(positionSizingConfig.kellyCeilingPct, kelly));
      }
    }

    if (effectiveRegimeAdapt && direction === "long" && (regime.regime === "bull" || regime.regime === "range")) {
      baseSizePct *= 1.1;
    }
    if (riskStopConfig.drawdownThrottlePct > 0 && peakCapital > 0) {
      const liveDrawdownPct = ((peakCapital - capital) / peakCapital) * 100;
      if (liveDrawdownPct >= riskStopConfig.drawdownThrottlePct) {
        baseSizePct *= 0.5;
      }
    }
    baseSizePct = Math.max(
      positionSizingConfig.kellyFloorPct,
      Math.min(positionSizingConfig.kellyCeilingPct, baseSizePct),
    );
    const sizePct = Math.max(
      0.05,
      baseSizePct * entryGateDecision.sizeMultiplier * layerPlan.sizeMultiplier,
    );

    const entryRegime = regimes[entryBar.date] || regime;
    const isCall = direction === "long";
    const desiredRight = isCall ? "call" : "put";

    let entryIv = null;
    let optionPrice;
    let strike = entryBar.c;
    let expiryDate = addTradingDays(entryBar.date, selectedTargetDte);
    let optionTicker = null;
    let actualDteAtEntry = selectedTargetDte;
    let targetDteAtEntry = selectedTargetDte;
    let dteSelectionMode = resolvedSelectionSpec?.selectionMode || null;
    let selectionStrikeSlot = Number.isFinite(Number(resolvedSelectionSpec?.strikeSlot))
      ? Number(resolvedSelectionSpec.strikeSlot)
      : null;
    let selectionStrikeLabel = null;
    let selectionMoneyness = fallbackSelectionSpec?.moneyness ?? null;
    let selectionSteps = Number.isFinite(Number(fallbackSelectionSpec?.strikeSteps))
      ? Number(fallbackSelectionSpec.strikeSteps)
      : null;
    const entrySpot = Number.isFinite(Number(entryBar.o))
      ? Number(entryBar.o)
      : (Number.isFinite(Number(entryBar.c)) ? Number(entryBar.c) : null);
    if (executionMode === "option_history") {
      let optionSnapshot = null;
      if (hasDynamicOptionReplay) {
        const entryKey = buildReplayEntryKey(entryBar.ts, desiredRight, strategyUsed);
        const resolvedContract = optionReplayContractsByKey[entryKey] || null;
        const skippedEntry = optionReplaySkippedByKey[entryKey] || null;
        if (!resolvedContract) {
          recordSkippedTrade({
            ts: entryBar.ts,
            signalTs: bar.ts,
            dir: direction,
            strat: strategyUsed,
            reason: skippedEntry?.reason || "contract_not_found",
            rawScore: executableSignal?.scoring?.rawScore ?? null,
            precursorBonus: executableSignal?.scoring?.precursorBonus ?? null,
            score: executableSignal?.scoring?.score ?? conviction,
            precursorLadderId: executableSignal?.scoring?.precursorLadderId || null,
            signalRole: executableSignal?.scoring?.signalRole || null,
            scoringVersion: executableSignal?.scoring?.scoringVersion || null,
            executionProfile: executableSignal?.scoring?.executionProfile || null,
          });
          continue;
        }
        expiryDate = resolvedContract.expiryDate || resolvedContract.expiry || null;
        strike = Number(resolvedContract.strike);
        optionTicker = resolvedContract.optionTicker || null;
        actualDteAtEntry = Number.isFinite(Number(resolvedContract.actualDteAtEntry))
          ? Number(resolvedContract.actualDteAtEntry)
          : selectedTargetDte;
        targetDteAtEntry = Number.isFinite(Number(resolvedContract.targetDteAtEntry))
          ? Number(resolvedContract.targetDteAtEntry)
          : selectedTargetDte;
        dteSelectionMode = String(resolvedContract.dteSelectionMode || "").trim() || null;
        selectionStrikeSlot = Number.isFinite(Number(resolvedContract.selectionStrikeSlot))
          ? Number(resolvedContract.selectionStrikeSlot)
          : null;
        selectionStrikeLabel = resolvedContract.selectionStrikeLabel || null;
        selectionMoneyness = resolvedContract.selectionMoneyness || null;
        selectionSteps = Number.isFinite(Number(resolvedContract.selectionSteps))
          ? Number(resolvedContract.selectionSteps)
          : null;
        if (!optionTicker || !expiryDate || !Number.isFinite(strike) || String(resolvedContract.right || "").trim().toLowerCase() !== desiredRight) {
          recordSkippedTrade({
            ts: entryBar.ts,
            signalTs: bar.ts,
            dir: direction,
            strat: strategyUsed,
            reason: "invalid_chain",
            rawScore: executableSignal?.scoring?.rawScore ?? null,
            precursorBonus: executableSignal?.scoring?.precursorBonus ?? null,
            score: executableSignal?.scoring?.score ?? conviction,
            precursorLadderId: executableSignal?.scoring?.precursorLadderId || null,
            signalRole: executableSignal?.scoring?.signalRole || null,
            scoringVersion: executableSignal?.scoring?.scoringVersion || null,
            executionProfile: executableSignal?.scoring?.executionProfile || null,
          });
          continue;
        }
        optionSnapshot = getOptionSnapshotForPosition({ optionTicker }, entryBar);
      } else {
        expiryDate = fixedOptionExpiry;
        strike = Number.isFinite(fixedOptionStrike) ? fixedOptionStrike : entryBar.c;
        optionTicker = optionContract?.optionTicker || null;
        targetDteAtEntry = selectedTargetDte;
        if (!optionHistoryReady || fixedOptionRight !== desiredRight) {
          recordSkippedTrade({
            ts: entryBar.ts,
            signalTs: bar.ts,
            dir: direction,
            strat: strategyUsed,
            reason: "contract_not_found",
            rawScore: executableSignal?.scoring?.rawScore ?? null,
            precursorBonus: executableSignal?.scoring?.precursorBonus ?? null,
            score: executableSignal?.scoring?.score ?? conviction,
            precursorLadderId: executableSignal?.scoring?.precursorLadderId || null,
            signalRole: executableSignal?.scoring?.signalRole || null,
            scoringVersion: executableSignal?.scoring?.scoringVersion || null,
            executionProfile: executableSignal?.scoring?.executionProfile || null,
          });
          continue;
        }
        optionSnapshot = findOptionHistoryBar(fixedOptionHistoryBars, entryBar);
      }
      if (!expiryDate || entryBar.date > expiryDate) {
        recordSkippedTrade({
          ts: entryBar.ts,
          signalTs: bar.ts,
          dir: direction,
          strat: strategyUsed,
          reason: "contract_not_found",
          rawScore: executableSignal?.scoring?.rawScore ?? null,
          precursorBonus: executableSignal?.scoring?.precursorBonus ?? null,
          score: executableSignal?.scoring?.score ?? conviction,
          precursorLadderId: executableSignal?.scoring?.precursorLadderId || null,
          signalRole: executableSignal?.scoring?.signalRole || null,
          scoringVersion: executableSignal?.scoring?.scoringVersion || null,
          executionProfile: executableSignal?.scoring?.executionProfile || null,
        });
        continue;
      }
      if (!optionSnapshot) {
        recordSkippedTrade({
          ts: entryBar.ts,
          signalTs: bar.ts,
          dir: direction,
          strat: strategyUsed,
          reason: "bars_not_found",
          rawScore: executableSignal?.scoring?.rawScore ?? null,
          precursorBonus: executableSignal?.scoring?.precursorBonus ?? null,
          score: executableSignal?.scoring?.score ?? conviction,
          precursorLadderId: executableSignal?.scoring?.precursorLadderId || null,
          signalRole: executableSignal?.scoring?.signalRole || null,
          scoringVersion: executableSignal?.scoring?.scoringVersion || null,
          executionProfile: executableSignal?.scoring?.executionProfile || null,
        });
        continue;
      }
      optionPrice = Math.max(optionSnapshot.o ?? optionSnapshot.c, 0.05);
    } else {
      if (!expiryDate || entryBar.date > expiryDate) {
        continue;
      }
      if (!Number.isFinite(entrySpot) || entrySpot <= 0) {
        continue;
      }
      const entryCalendarDte = calendarDaysTo(entryBar.date, entryBar.hour, entryBar.min, expiryDate);
      entryIv = effectiveRegimeAdapt && entryRegime.vix > 0
        ? ivForDTE(entryRegime.vix / 100, entryCalendarDte)
        : ivForDTE(iv, entryCalendarDte);
      optionPrice = Math.max(priceOption(entrySpot, strike, entryCalendarDte, entryIv, isCall), 0.05);
    }
    const entryCalendarDte = calendarDaysTo(entryBar.date, entryBar.hour, entryBar.min, expiryDate);
    const entryHalfSpread = spreadModel(entryCalendarDte, optionPrice, entryBar.hour + entryBar.min / 60);
    const entrySlippageAmount = resolveOptionSlippageAmount(optionPrice, effectiveSlipBps);
    const optionFill = optionPrice + entryHalfSpread + entrySlippageAmount;
    const effectiveStopLossPct = resolveBacktestV2StopLossPct({
      position: {
        actualDteAtEntry,
        targetDteAtEntry,
        dte: selectedTargetDte,
      },
      legacyStopLossPct: slPct,
      exitGovernorConfig,
    });
    const entryTrailProfile = resolveBacktestV2TrailProfile({
      position: {
        oe: optionFill,
        entrySpotPrice: entrySpot,
        sp: entryBar.c,
        ic: isCall,
        actualDteAtEntry,
        targetDteAtEntry,
        dte: selectedTargetDte,
      },
      executionBar: entryBar,
      priceRange: {
        open: optionFill,
        high: optionFill,
        low: optionFill,
        close: optionFill,
      },
      trailStartPct,
      exitGovernorConfig,
      spotAtr: spotAtrByTs.get(String(entryBar?.ts || "").trim()) ?? null,
      regime: entryRegime,
    });
    const positionValue = capital * sizePct / 100;
    const contractPrice = optionFill * 100;
    let qty = Math.max(1, Math.floor(positionValue / contractPrice));
    let entryCommission = qty * effectiveCommPerContract;
    let totalTradeCost = qty * contractPrice + entryCommission;

    const maxPositionBudget = effectiveInitialCapital * positionSizingConfig.maxPositionPct / 100;
    const openExposureCost = openPositions.reduce((sum, position) => sum + (Number(position.cost) || 0), 0);
    const remainingExposureBudget = effectiveInitialCapital * positionSizingConfig.maxExposurePct / 100 - openExposureCost;
    const effectivePositionBudget = Math.min(maxPositionBudget, remainingExposureBudget);
    if (effectivePositionBudget <= 0) {
      continue;
    }
    if (totalTradeCost > effectivePositionBudget) {
      qty = Math.max(1, Math.floor(effectivePositionBudget / (optionFill * 100 + effectiveCommPerContract)));
      entryCommission = qty * effectiveCommPerContract;
      totalTradeCost = qty * optionFill * 100 + entryCommission;
    }
    if (totalTradeCost > capital) {
      continue;
    }

    capital -= totalTradeCost;
    const optionCost = qty * contractPrice;
    const tradeId = buildResearchTradeId({
      ts: entryBar.ts,
      signalTs: bar.ts,
      strat: strategyUsed,
      dir: direction,
      optionTicker,
      expiryDate,
      k: strike,
      ic: isCall,
    }, tradeSequence += 1);
    openPositions.push({
      tradeId,
      tradeSelectionId: tradeId,
      id: tradeId,
      ts: entryBar.ts,
      signalTs: bar.ts,
      sp: Number.isFinite(entrySpot) ? entrySpot : entryBar.c,
      entrySpotPrice: entrySpot,
      oe: optionFill,
      qty,
      cost: optionCost,
      mtm: optionCost,
      dte: targetDteAtEntry,
      k: strike,
      ic: isCall,
      dir: direction,
      signalClass: executableSignal?.signalClass || executableSignal?.scoring?.signalClass || null,
      bh: 0,
      pk: optionFill,
      conv: conviction,
      qualityScoreAtEntry: executableSignal?.scoring?.qualityScore ?? executableSignal?.scoring?.score ?? null,
      requiredQualityScoreAtEntry: entryGateDecision?.requiredQualityScore ?? null,
      rawScoreAtEntry: executableSignal?.scoring?.rawScore ?? null,
      precursorBonusAtEntry: executableSignal?.scoring?.precursorBonus ?? null,
      scoreAtEntry: executableSignal?.scoring?.score ?? conviction,
      precursorLadderId: executableSignal?.scoring?.precursorLadderId || null,
      signalRole: executableSignal?.scoring?.signalRole || null,
      precursorConflictAtEntry: Boolean(executableSignal?.scoring?.precursorContext?.hasConflict),
      precursorDataStatus: executableSignal?.scoring?.precursorContext?.dataStatus || rayalgoScoringContext?.dataStatus || null,
      scoringVersion: executableSignal?.scoring?.scoringVersion || null,
      executionProfile: executableSignal?.scoring?.executionProfile || null,
      scoringAuthorityApplied: executableSignal?.scoring?.authority || null,
      sizeUpgradeApplied: rayalgoSizingUpgrade.applied,
      sizeUpgradeMultiplier: rayalgoSizingUpgrade.multiplier,
      sizingConvictionApplied: sizingConviction,
      baseSizePctApplied: baseSizePct,
      regime: entryRegime.regime,
      vix: entryRegime.vix,
      strat: strategyUsed,
      expiryDate,
      targetDteAtEntry,
      actualDteAtEntry,
      dteSelectionMode,
      selectionStrikeSlot,
      selectionStrikeLabel,
      selectionMoneyness,
      selectionSteps,
      layerIndex: layerPlan.layerIndex,
      layerNumber: layerPlan.layerNumber,
      layerFractionApplied: layerPlan.baseFraction,
      layerSizeMultiplierApplied: layerPlan.sizeMultiplier,
      layerEdgeRatio: layerPlan.edgeRatio,
      layerEdgeBumpApplied: layerPlan.edgeBumpApplied,
      entryGateEdgeRatio: Number.isFinite(Number(entryGateDecision?.edgeRatio))
        ? Number(entryGateDecision.edgeRatio)
        : null,
      entryGateReason: entryGateDecision?.reason || null,
      entryGateSizeMultiplierApplied: Number.isFinite(Number(entryGateDecision?.sizeMultiplier))
        ? Number(entryGateDecision.sizeMultiplier)
        : 1,
      sizePctApplied: sizePct,
      entryIV: Number.isFinite(entryIv) ? +(entryIv * 100).toFixed(1) : null,
      entryBasePrice: optionPrice,
      entrySpreadHalf: entryHalfSpread,
      entrySlippageBps: effectiveSlipBps,
      entrySlippageAmount,
      stopLossPctApplied: effectiveStopLossPct,
      takeProfitPctApplied: effectiveTakeProfitPct,
      trailStartPctApplied: Number.isFinite(Number(entryTrailProfile?.profitFloorPct))
        ? Number(entryTrailProfile.profitFloorPct)
        : trailStartPct,
      trailPctApplied: exitGovernorConfig ? null : trailPct,
      trailActivationModeApplied: entryTrailProfile?.activationMode || null,
      trailProfitFloorPctApplied: Number.isFinite(Number(entryTrailProfile?.profitFloorPct))
        ? Number(entryTrailProfile.profitFloorPct)
        : null,
      trailRequiredSpotMoveApplied: Number.isFinite(Number(entryTrailProfile?.requiredSpotMove))
        ? Number(entryTrailProfile.requiredSpotMove)
        : null,
      trailLockRatioApplied: Number.isFinite(Number(entryTrailProfile?.lockRatio))
        ? Number(entryTrailProfile.lockRatio)
        : null,
      zombieBarsApplied: zombieBarsAdjusted,
      entryDate: entryBar.date,
      entryMinuteOfDay: entryBar.hour * 60 + entryBar.min,
      stopLossPrice: optionFill * (1 - effectiveStopLossPct),
      takeProfitPrice: optionFill * (1 + effectiveTakeProfitPct),
      trailActivationPrice: Number.isFinite(Number(entryTrailProfile?.optionActivationPrice))
        ? Number(entryTrailProfile.optionActivationPrice)
        : optionFill * (1 + (exitGovernorConfig ? 0 : trailStartPct)),
      lastTrailStopPrice: null,
      trailStopHistory: [],
      pricingMode: executionMode,
      optionTicker,
      ep: null,
      exitSpotPrice: null,
      exitBasePrice: null,
      exitSpreadHalf: null,
      exitSlippageBps: effectiveSlipBps,
      exitSlippageAmount: null,
      exitFill: null,
      exitTriggerPrice: null,
      exitOptionOpen: null,
      exitOptionHigh: null,
      exitOptionLow: null,
      exitOptionClose: null,
      er: null,
      et: null,
      pnl: 0,
      fees: entryCommission,
      commIn: entryCommission,
      commOut: 0,
      slip: entryHalfSpread + entrySlippageAmount,
    });
  }

  yield {
    phase: PHASE_SCAN,
    phasePct: 100,
    totalBars: bars.length,
    barIndex: bars.length,
    currentDate,
    tradeCount: closedTrades.length,
    winCount,
    openPositionCount: openPositions.length,
    capital: +capital.toFixed(2),
    initialCapital: effectiveInitialCapital,
    peakCapital,
    ...buildProgressDeltas(),
  };

  const positionsToClose = [...openPositions];
  const totalToClose = positionsToClose.length;
  let closedCount = 0;

  yield {
    phase: PHASE_CLOSE,
    phasePct: totalToClose === 0 ? 100 : 0,
    totalToClose,
    closedCount: 0,
    tradeCount: closedTrades.length,
    ...buildProgressDeltas(),
  };

  for (const position of positionsToClose) {
    const lastBar = normalizedExecutionBars[normalizedExecutionBars.length - 1] || bars[bars.length - 1];
    const remainingCalendarDte = calendarDaysTo(lastBar.date, lastBar.hour || 15, lastBar.min || 59, position.expiryDate);
    const remainingDays = remainingCalendarDte * 365.25;
    let exitPrice;
    if (executionMode === "option_history") {
      const optionSnapshot = getOptionSnapshotForPosition(position, lastBar);
      if (remainingDays < 0.5) {
        exitPrice = Math.max(position.ic ? lastBar.c - position.k : position.k - lastBar.c, 0);
      } else {
        exitPrice = Math.max(
          optionSnapshot?.c ?? ((position.mtm || position.cost) / Math.max(position.qty * 100, 1)),
          0,
        );
      }
    } else if (remainingDays < 0.5) {
      exitPrice = Math.max(position.ic ? lastBar.c - position.k : position.k - lastBar.c, 0);
    } else {
      const exitIv = ivForDTE(iv, remainingCalendarDte);
      exitPrice = priceOption(lastBar.c, position.k, remainingCalendarDte, exitIv, position.ic);
    }
    const exitHalfSpread = spreadModel(remainingCalendarDte, exitPrice, 15.99);
    const exitSlippageAmount = resolveOptionSlippageAmount(exitPrice, effectiveSlipBps);
    const exitFill = Math.max(exitPrice - exitHalfSpread - exitSlippageAmount, 0);
    const exitCommission = position.qty * effectiveCommPerContract;
    position.exitSpotPrice = Number.isFinite(Number(lastBar?.c))
      ? Number(lastBar.c)
      : (Number.isFinite(Number(lastBar?.o)) ? Number(lastBar.o) : position.exitSpotPrice);
    position.ep = exitPrice;
    position.exitBasePrice = exitPrice;
    position.exitSpreadHalf = exitHalfSpread;
    position.exitSlippageBps = effectiveSlipBps;
    position.exitSlippageAmount = exitSlippageAmount;
    position.exitFill = exitFill;
    position.er = remainingDays < 0.5 ? "expired" : "time_exit";
    position.et = lastBar.ts;
    position.exitTriggerPrice = exitPrice;
    position.exitOptionOpen = exitPrice;
    position.exitOptionHigh = exitPrice;
    position.exitOptionLow = exitPrice;
    position.exitOptionClose = exitPrice;
    position.commOut = exitCommission;
    position.fees = (position.fees || 0) + exitCommission;
    position.pnl = (exitFill - position.oe) * 100 * position.qty - exitCommission;
    capital += position.cost + position.pnl;
    closedTrades.push(position);
    closedCount += 1;
    if (totalToClose > 1) {
      yield {
        phase: PHASE_CLOSE,
        phasePct: Math.round((closedCount / totalToClose) * 100),
        totalToClose,
        closedCount,
        tradeCount: closedTrades.length,
        ...buildProgressDeltas(),
      };
    }
  }

  yield {
    phase: PHASE_CLOSE,
    phasePct: 100,
    totalToClose,
    closedCount,
    tradeCount: closedTrades.length,
    ...buildProgressDeltas(),
  };

  yield { phase: PHASE_OVERLAYS, phasePct: 0, ...buildProgressDeltas() };

  equity.push({ i: equityIndex, bal: +capital.toFixed(2), ts: bars[bars.length - 1]?.ts });
  const skippedByReason = skippedTrades.reduce((summary, skippedTrade) => {
    const reason = String(skippedTrade?.reason || "unknown");
    summary[reason] = (summary[reason] || 0) + 1;
    return summary;
  }, {});
  if (indicatorOverlayTape) {
    indicatorOverlayTape.windows = strategy === "rayalgo"
      ? buildRayAlgoTrendWindows(rayalgoTrendSamples, bars)
      : buildIndicatorSignalWindows(
        indicatorOverlayTape.events,
        bars,
      );
  }

  yield { phase: PHASE_OVERLAYS, phasePct: 100, ...buildProgressDeltas() };
  yield { phase: PHASE_RESULTS, phasePct: 100, ...buildProgressDeltas() };

  return {
    trades: closedTrades,
    equity,
    skippedTrades,
    skippedByReason,
    riskStop,
    rayalgoScoringContext: rayalgoScoringContext
      ? {
        ...rayalgoScoringContext.config,
        dataStatus: rayalgoScoringContext.dataStatus,
        availableFrames: [...rayalgoScoringContext.availableFrames],
        missingFrames: [...rayalgoScoringContext.missingFrames],
        executionFrameMinutes: rayalgoScoringContext.executionFrameMinutes,
      }
      : null,
    indicatorOverlayTape: indicatorOverlayTape || createEmptyIndicatorOverlayTape(),
  };
}

export function runBacktest(bars, regimes, cfg) {
  const gen = runBacktestGenerator(bars, regimes, cfg);
  let step = gen.next();
  while (!step.done) {
    step = gen.next();
  }
  return step.value;
}

export async function runBacktestAsync(bars, regimes, cfg, onProgress, isCancelled) {
  const gen = runBacktestGenerator(bars, regimes, cfg);
  let step = gen.next();
  while (!step.done) {
    if (typeof isCancelled === "function" && isCancelled()) {
      gen.return();
      return null;
    }
    if (typeof onProgress === "function") {
      onProgress(step.value);
    }
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    step = gen.next();
  }
  return step.value;
}

export function computeMetrics(trades, capital) {
  if (!trades.length) {
    return {
      pnl: 0,
      roi: 0,
      wr: 0,
      w: 0,
      l: 0,
      pf: 0,
      avgW: 0,
      avgL: 0,
      exp: 0,
      dd: 0,
      sharpe: 0,
      n: 0,
      streak: 0,
      avgBars: 0,
      totalFees: 0,
    };
  }

  let peak = capital;
  let drawdown = 0;
  let balance = capital;
  let wins = 0;
  let losses = 0;
  let winnerPnl = 0;
  let loserPnl = 0;
  let streak = 0;
  let maxStreak = 0;
  const returns = [];
  let totalBars = 0;
  let totalFees = 0;

  for (const trade of trades) {
    const net = trade.pnl - (trade.commIn || 0);
    balance += net;
    returns.push(net);
    totalBars += trade.bh || 0;
    totalFees += trade.fees || 0;
    if (net > 0) {
      wins += 1;
      winnerPnl += net;
      streak = 0;
    } else {
      losses += 1;
      loserPnl += net;
      streak += 1;
      maxStreak = Math.max(maxStreak, streak);
    }
    peak = Math.max(peak, balance);
    drawdown = Math.max(drawdown, (peak - balance) / peak * 100);
  }

  const totalPnl = balance - capital;
  const avgWinner = wins > 0 ? winnerPnl / wins : 0;
  const avgLoser = losses > 0 ? loserPnl / losses : 0;
  const winRate = wins / trades.length * 100;
  const expectancy = (winRate / 100) * avgWinner + (1 - winRate / 100) * avgLoser;
  const profitFactor = loserPnl !== 0 ? Math.abs(winnerPnl / loserPnl) : wins > 0 ? 99 : 0;
  const meanReturn = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const stdDev = Math.sqrt(returns.reduce((sum, value) => sum + (value - meanReturn) ** 2, 0) / returns.length);
  const sharpe = stdDev > 0 ? (meanReturn / stdDev) * Math.sqrt(returns.length) : 0;

  return {
    pnl: +totalPnl.toFixed(0),
    roi: +(totalPnl / capital * 100).toFixed(1),
    wr: +winRate.toFixed(1),
    w: wins,
    l: losses,
    pf: profitFactor > 50 ? "∞" : +profitFactor.toFixed(2),
    avgW: +avgWinner.toFixed(0),
    avgL: +avgLoser.toFixed(0),
    exp: +expectancy.toFixed(2),
    dd: +drawdown.toFixed(1),
    sharpe: +sharpe.toFixed(2),
    n: trades.length,
    streak: maxStreak,
    avgBars: trades.length ? +(totalBars / trades.length).toFixed(0) : 0,
    totalFees: +totalFees.toFixed(0),
  };
}

export function runOptimizer(
  bars,
  regimes,
  capital,
  tfMin = 5,
  regimeAdapt = false,
  commPerContract = 0.65,
  slipBps = 150,
  tradeDays = [true, true, true, true, true],
  runtimeConfig = {},
) {
  const executionMode = runtimeConfig.executionMode || "spot_model";
  const riskStopPolicy = normalizeRiskStopPolicy(runtimeConfig.riskStopPolicy);
  const optionHistoryBars = Array.isArray(runtimeConfig.optionHistoryBars) ? runtimeConfig.optionHistoryBars : [];
  const optionContract = runtimeConfig.optionContract || null;
  const strategies = ["rayalgo", "momentum_breakout", "sweep_reversal", "vwap_extreme", "ema_stack", "bb_squeeze"];
  const dtes = executionMode === "option_history" ? [0] : [0, 1, 3, 5, 7, 10, 14, 21, 30];
  const exits = [
    { name: "scalp", sl: 0.15, tp: 0.2, ts: 0.05, tr: 0.1 },
    { name: "tight", sl: 0.2, tp: 0.28, ts: 0.06, tr: 0.15 },
    { name: "moderate", sl: 0.25, tp: 0.35, ts: 0.08, tr: 0.18 },
    { name: "wide", sl: 0.45, tp: 0.7, ts: 0.12, tr: 0.22 },
    { name: "runner", sl: 0.3, tp: 2.0, ts: 0.2, tr: 0.3 },
    { name: "lotto", sl: 0.6, tp: 5.0, ts: 0.5, tr: 0.5 },
  ];
  const regimeFilters = ["not_bear", "none"];

  const results = [];
  const seen = new Set();
  for (const strategy of strategies) {
    for (const dte of dtes) {
      for (const exit of exits) {
        for (const regimeFilter of regimeFilters) {
          const cfg = {
            strategy,
            dte,
            iv: 0.2,
            slPct: exit.sl,
            tpPct: exit.tp,
            trailStartPct: exit.ts,
            trailPct: exit.tr,
            zombieBars: 30,
            minConviction: 0.48,
            allowShorts: false,
            kellyFrac: 0.25,
            regimeFilter,
            maxPositions: 4,
            capital,
            sessionBlocks: Array(13).fill(true),
            tfMin,
            regimeAdapt,
            commPerContract,
            slipBps,
            tradeDays,
            executionMode,
            optionHistoryBars,
            optionContract,
            riskStopPolicy,
          };
          const { trades } = runBacktest(bars, regimes, cfg);
          const metrics = computeMetrics(trades, capital);
          if (metrics.n < 5) {
            continue;
          }
          const dedupeKey = `${strategy}|${dte}|${exit.name}|${metrics.n}|${metrics.pnl}|${metrics.wr}`;
          if (seen.has(dedupeKey)) {
            continue;
          }
          seen.add(dedupeKey);

          const profitFactor = metrics.pf === "∞" ? 10 : parseFloat(metrics.pf);
          const cappedPf = Math.min(Math.max(profitFactor, 0), 5);
          const drawdownPenalty = Math.pow(1 - Math.min(metrics.dd, 80) / 100, 1.5);
          const significance = Math.log2(Math.max(metrics.n, 2));
          const sharpe = Math.max(metrics.sharpe, 0);
          const winRate = metrics.wr / 100;
          const score = sharpe * cappedPf * drawdownPenalty * significance * winRate;

          results.push({
            strategy,
            dte,
            exit: exit.name,
            sl: exit.sl,
            tp: exit.tp,
            regime: regimeFilter,
            executionMode,
            ...metrics,
            score: +score.toFixed(4),
          });
        }
      }
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, 50);
}
