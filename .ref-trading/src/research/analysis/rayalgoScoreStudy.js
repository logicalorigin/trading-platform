import { SIGNAL_OVERLAY_TIMEFRAME_OPTIONS, timeframeToMinutes } from "../chart/timeframeModel.js";
import { normalizeRayAlgoSettings } from "../config/rayalgoSettings.js";
import { aggregateBarsToMinutes } from "../data/aggregateBars.js";
import { buildSignalOverlayTape, detectRegimes } from "../engine/runtime.js";
import { normalizeRayAlgoScoringConfig, normalizeRayAlgoScoringPreferences } from "../engine/rayalgoScoring.js";
import { getBarTimeMs } from "../market/time.js";

export const RAYALGO_SCORE_STUDY_HORIZONS = Object.freeze([
  { key: "1x", label: "1x", multiplier: 1, headline: false },
  { key: "3x", label: "3x", multiplier: 3, headline: true },
  { key: "6x", label: "6x", multiplier: 6, headline: false },
  { key: "9x", label: "9x", multiplier: 9, headline: false },
  { key: "12x", label: "12x", multiplier: 12, headline: false, secondary: true },
  { key: "24x", label: "24x", multiplier: 24, headline: false, secondary: true },
  { key: "36x", label: "36x", multiplier: 36, headline: false, secondary: true },
  { key: "48x", label: "48x", multiplier: 48, headline: false, secondary: true },
  { key: "60x", label: "60x", multiplier: 60, headline: false, secondary: true },
  { key: "72x", label: "72x", multiplier: 72, headline: false, secondary: true },
  { key: "84x", label: "84x", multiplier: 84, headline: false, secondary: true },
  { key: "96x", label: "96x", multiplier: 96, headline: false, secondary: true },
  { key: "108x", label: "108x", multiplier: 108, headline: false, secondary: true },
  { key: "120x", label: "120x", multiplier: 120, headline: false, secondary: true },
]);
export const RAYALGO_SCORE_STUDY_TENURE_HORIZONS = Object.freeze([
  { key: "3x", label: "3x", multiplier: 3, headline: true },
  { key: "6x", label: "6x", multiplier: 6, headline: false },
  { key: "9x", label: "9x", multiplier: 9, headline: false },
  { key: "12x", label: "12x", multiplier: 12, headline: false, secondary: true },
  { key: "24x", label: "24x", multiplier: 24, headline: false, secondary: true },
  { key: "36x", label: "36x", multiplier: 36, headline: false, secondary: true },
  { key: "48x", label: "48x", multiplier: 48, headline: false, secondary: true },
  { key: "60x", label: "60x", multiplier: 60, headline: false, secondary: true },
  { key: "72x", label: "72x", multiplier: 72, headline: false, secondary: true },
  { key: "84x", label: "84x", multiplier: 84, headline: false, secondary: true },
  { key: "96x", label: "96x", multiplier: 96, headline: false, secondary: true },
  { key: "108x", label: "108x", multiplier: 108, headline: false, secondary: true },
  { key: "120x", label: "120x", multiplier: 120, headline: false, secondary: true },
]);

export const RAYALGO_SCORE_STUDY_HEADLINE_HORIZON = "3x";
export const RAYALGO_SCORE_STUDY_DEFAULT_MODE = "forward";
export const RAYALGO_SCORE_STUDY_MODES = Object.freeze([
  { key: "forward", label: "Forward Expectancy" },
  { key: "tenure", label: "Directional Tenure" },
]);
export const RAYALGO_SCORE_STUDY_SCORE_TYPES = Object.freeze(["raw", "final", "effective"]);
export const RAYALGO_SCORE_STUDY_DIRECTIONS = Object.freeze([
  { key: "combined", label: "Both" },
  { key: "long", label: "Buy" },
  { key: "short", label: "Sell" },
]);
export const RAYALGO_SCORE_STUDY_SIGNAL_CLASSES = Object.freeze([
  { key: "trend_change", label: "Trend Change" },
]);
export const RAYALGO_SCORE_STUDY_BUCKETS = Object.freeze([
  { key: "b00", label: "0.00-0.40", lower: 0, upper: 0.4 },
  { key: "b40", label: "0.40-0.50", lower: 0.4, upper: 0.5 },
  { key: "b50", label: "0.50-0.60", lower: 0.5, upper: 0.6 },
  { key: "b60", label: "0.60-0.70", lower: 0.6, upper: 0.7 },
  { key: "b70", label: "0.70-0.80", lower: 0.7, upper: 0.8 },
  { key: "b80", label: "0.80-0.90", lower: 0.8, upper: 0.9 },
  { key: "b90", label: "0.90-1.00", lower: 0.9, upper: 1.0001 },
]);

const MIN_BUCKET_SAMPLE = 12;
const MIN_RECOMMENDATION_SAMPLE = 24;
const FEATURE_IMPACT_MIN_SAMPLE = 64;
const RENDER_FLOOR_THRESHOLDS = [0.5, 0.6, 0.7, 0.8];
const QUALITY_FLOOR_THRESHOLDS = [0.45, 0.5, 0.55, 0.6, 0.65, 0.7];
const MATERIAL_MONOTONICITY_DELTA = 8;
const MATERIAL_HIT_DELTA = 4;
const MATERIAL_ATR_DELTA = 0.08;
const MATERIAL_REALIZED_QUALITY_DELTA = 0.03;
const QUALITY_FLOOR_MIN_COVERAGE_PCT = 8;
const QUALITY_FLOOR_GOOD_GUIDANCE_PCT = 50;
const QUALITY_FLOOR_GOOD_REALIZED_QUALITY = 0.48;
const QUALITY_FLOOR_MIN_EDGE_ATR = 0.05;
const TENURE_RENDER_BAD_MAJORITY_PCT = 45;
const TENURE_RENDER_BAD_TENURE_PCT = 35;
const TENURE_RENDER_GOOD_TENURE_PCT = 60;
const TENURE_RENDER_HIDE_MAJORITY_PCT = 40;
const TENURE_RENDER_HIDE_TENURE_PCT = 25;
const TENURE_RENDER_GOOD_MAJOR_PCT = 55;
const REALIZED_QUALITY_FORWARD_HORIZONS = Object.freeze(["3x", "6x", "9x", "12x", "24x", "48x", "72x", "96x", "120x"]);
const REALIZED_QUALITY_TENURE_HORIZONS = Object.freeze(["3x", "6x", "9x", "12x", "24x", "48x", "72x", "96x", "120x"]);
const REALIZED_QUALITY_SHARED_HORIZONS = Object.freeze(
  REALIZED_QUALITY_FORWARD_HORIZONS.filter((horizonKey) => REALIZED_QUALITY_TENURE_HORIZONS.includes(horizonKey)),
);
const VALIDATED_QUALITY_DISPLAY_HORIZONS = Object.freeze(
  RAYALGO_SCORE_STUDY_HORIZONS
    .map((horizon) => horizon.key)
    .filter((horizonKey) => horizonKey !== "1x"),
);
const REALIZED_QUALITY_EDGE_ATR_CAP = 2;
const REALIZED_QUALITY_CLOSE_ATR_CAP = 2;
export const RAYALGO_VALIDATED_QUALITY_COMPONENTS = Object.freeze([
  {
    key: "best_move_atr",
    label: "Best Move",
    unit: "ATR",
    weight: 0.35,
    description: "Favorable opportunity created inside the horizon, normalized by entry ATR.",
  },
  {
    key: "close_result_atr",
    label: "Close Result",
    unit: "ATR",
    weight: 0.25,
    description: "Signed return at the horizon close, normalized by entry ATR.",
  },
  {
    key: "direction_correct_pct",
    label: "Direction Correct",
    unit: "%",
    weight: 0.15,
    description: "Whether the move primarily resolved in the predicted direction.",
  },
  {
    key: "stayed_right_pct",
    label: "Stayed Right",
    unit: "%",
    weight: 0.25,
    description: "How much of the horizon stayed on the correct side of entry.",
  },
]);
const FEW_CANDLE_GUIDANCE_HORIZON = "3x";
const FEW_CANDLE_TENURE_HORIZON = "3x";
const FEW_CANDLE_MIN_TENURE_PCT = 66.7;
const SUSTAINED_GUIDANCE_HORIZON = "6x";
const SUSTAINED_TENURE_HORIZON = "6x";
const SUSTAINED_MIN_TENURE_PCT = 55;
const FEW_CANDLE_TARGET_RATE_PCT = 75;
const SCORE_COVERAGE_FRONTIER_TIERS = Object.freeze([
  { key: "top_50", label: "Top 50%", coverageRatio: 0.5 },
  { key: "top_25", label: "Top 25%", coverageRatio: 0.25 },
  { key: "top_10", label: "Top 10%", coverageRatio: 0.1 },
  { key: "top_05", label: "Top 5%", coverageRatio: 0.05 },
]);
const FORWARD_HEADLINE_BLOCKS = Object.freeze([
  { key: "immediate", label: "Immediate", horizons: ["3x", "6x", "9x", "12x"] },
  { key: "follow_through", label: "Follow-through", horizons: ["24x", "48x", "72x", "96x", "120x"] },
]);
const FORWARD_PREFERENCE_HORIZONS = Object.freeze(["24x", "48x", "72x", "96x", "120x"]);
const CONTRARIAN_MIN_SCORE_GRID = Object.freeze([0.5, 0.55, 0.6, 0.65]);
const CONTRARIAN_MARGIN_GRID = Object.freeze([0, 0.03, 0.05, 0.1]);
const CONTRARIAN_PRECURSOR_MIN_BUMP = 0.05;
const CONTRARIAN_PRECURSOR_MARGIN_BUMP = 0.02;
const CONTRARIAN_SCORE_BASIS = "effectiveScore";

function round(value, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return +numeric.toFixed(digits);
}

function buildScoreStudyCancelledError(message = "Score-study job cancelled.") {
  const error = new Error(message);
  error.code = "SCORE_STUDY_CANCELLED";
  return error;
}

function throwIfScoreStudyCancelled(shouldCancel) {
  if (typeof shouldCancel === "function" && shouldCancel()) {
    throw buildScoreStudyCancelledError();
  }
}

function emitScoreStudyProgress(onProgress, shouldCancel, payload = {}) {
  throwIfScoreStudyCancelled(shouldCancel);
  if (typeof onProgress === "function") {
    onProgress(payload);
  }
  throwIfScoreStudyCancelled(shouldCancel);
}

function clampUnit(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.min(1, numeric));
}

function getRecordScoreByBasis(record = null, scoreBasis = CONTRARIAN_SCORE_BASIS) {
  const normalizedBasis = String(scoreBasis || CONTRARIAN_SCORE_BASIS).trim();
  if (normalizedBasis === "rawScore") {
    return clampUnit(record?.rawScore);
  }
  if (normalizedBasis === "finalScore") {
    return clampUnit(record?.finalScore);
  }
  return clampUnit(record?.effectiveScore);
}

function buildContrarianPolicyConfigs() {
  const configs = [{
    id: "baseline_first_opposite",
    family: "baseline",
    label: "Baseline first-opposite",
    scope: "scoped",
    scoreBasis: CONTRARIAN_SCORE_BASIS,
    minimumScore: null,
    minimumDelta: null,
    precursorMinBump: 0,
    precursorDeltaBump: 0,
    activeOnly: false,
    requireScoreGate: false,
    requireMargin: false,
  }];

  for (const minimumScore of CONTRARIAN_MIN_SCORE_GRID) {
    configs.push({
      id: `active_min_only_${minimumScore.toFixed(2).replace(".", "")}`,
      family: "active_min_only",
      label: `Active min ${minimumScore.toFixed(2)}`,
      scope: "active",
      scoreBasis: CONTRARIAN_SCORE_BASIS,
      minimumScore,
      minimumDelta: null,
      precursorMinBump: 0,
      precursorDeltaBump: 0,
      activeOnly: true,
      requireScoreGate: true,
      requireMargin: false,
    });
    configs.push({
      id: `scoped_min_only_${minimumScore.toFixed(2).replace(".", "")}`,
      family: "scoped_min_only",
      label: `Scoped min ${minimumScore.toFixed(2)}`,
      scope: "scoped",
      scoreBasis: CONTRARIAN_SCORE_BASIS,
      minimumScore,
      minimumDelta: null,
      precursorMinBump: CONTRARIAN_PRECURSOR_MIN_BUMP,
      precursorDeltaBump: 0,
      activeOnly: false,
      requireScoreGate: true,
      requireMargin: false,
    });
    for (const minimumDelta of CONTRARIAN_MARGIN_GRID) {
      configs.push({
        id: `scoped_min_margin_${minimumScore.toFixed(2).replace(".", "")}_${minimumDelta.toFixed(2).replace(".", "")}`,
        family: "scoped_min_margin",
        label: `Scoped min ${minimumScore.toFixed(2)} + d${minimumDelta.toFixed(2)}`,
        scope: "scoped",
        scoreBasis: CONTRARIAN_SCORE_BASIS,
        minimumScore,
        minimumDelta,
        precursorMinBump: CONTRARIAN_PRECURSOR_MIN_BUMP,
        precursorDeltaBump: CONTRARIAN_PRECURSOR_MARGIN_BUMP,
        activeOnly: false,
        requireScoreGate: true,
        requireMargin: true,
      });
    }
  }
  return configs;
}

const CONTRARIAN_POLICY_CONFIGS = Object.freeze(buildContrarianPolicyConfigs());

function inferSourceBarMinutes(bars = []) {
  let previous = null;
  let smallestDiff = Number.POSITIVE_INFINITY;
  for (const bar of Array.isArray(bars) ? bars : []) {
    const time = getBarTimeMs(bar);
    if (!Number.isFinite(time)) {
      continue;
    }
    if (Number.isFinite(previous)) {
      const diffMinutes = Math.max(0, Math.round((time - previous) / 60000));
      if (diffMinutes > 0) {
        smallestDiff = Math.min(smallestDiff, diffMinutes);
      }
    }
    previous = time;
  }
  return Number.isFinite(smallestDiff) ? smallestDiff : null;
}

function calcEma(values, period) {
  if (!Array.isArray(values) || !values.length) {
    return 0;
  }
  if (values.length < period) {
    return Number(values[values.length - 1]) || 0;
  }
  const alpha = 2 / (period + 1);
  let ema = Number(values[values.length - period]) || 0;
  for (let index = values.length - period + 1; index < values.length; index += 1) {
    ema = alpha * (Number(values[index]) || 0) + (1 - alpha) * ema;
  }
  return ema;
}

function calcAtrSeries(bars = [], atrLength = 14, atrSmoothing = 14) {
  const trueRanges = [];
  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index];
    if (index === 0) {
      trueRanges.push(Math.max(0, Number(bar?.h) - Number(bar?.l)));
      continue;
    }
    const prevClose = Number(bars[index - 1]?.c) || 0;
    trueRanges.push(Math.max(
      Number(bar?.h) - Number(bar?.l),
      Math.abs(Number(bar?.h) - prevClose),
      Math.abs(Number(bar?.l) - prevClose),
    ));
  }
  const atrSeed = [];
  for (let index = 0; index < trueRanges.length; index += 1) {
    const sample = trueRanges.slice(Math.max(0, index - atrLength + 1), index + 1);
    atrSeed.push(sample.reduce((sum, value) => sum + value, 0) / Math.max(sample.length, 1));
  }
  const output = [];
  for (let index = 0; index < atrSeed.length; index += 1) {
    output.push(calcEma(atrSeed.slice(0, index + 1), Math.max(1, atrSmoothing)));
  }
  return output;
}

function resolveBucket(score) {
  const normalized = clampUnit(score);
  return RAYALGO_SCORE_STUDY_BUCKETS.find((bucket) => normalized >= bucket.lower && normalized < bucket.upper)
    || RAYALGO_SCORE_STUDY_BUCKETS[RAYALGO_SCORE_STUDY_BUCKETS.length - 1];
}

function getOutcomeDirectionSign(direction) {
  return String(direction || "").trim().toLowerCase() === "short" ? -1 : 1;
}

function getOutcomeForHorizon({
  bars = [],
  atrSeries = [],
  startIndex = -1,
  direction = "long",
  horizon = null,
  contrarian = null,
  barTimeMs = [],
  timeframeMinutes = null,
}) {
  if (!horizon || startIndex < 0) {
    return null;
  }
  const entryBar = bars[startIndex];
  const requestedEndIndex = startIndex + horizon.multiplier;
  const contrarianBarIndex = Number.isFinite(Number(contrarian?.timeMs))
    ? findContainingBarIndex(barTimeMs, Number(contrarian.timeMs))
    : null;
  const endedByContrarian = Number.isInteger(contrarianBarIndex) && contrarianBarIndex <= requestedEndIndex;
  if (!entryBar || (requestedEndIndex >= bars.length && !endedByContrarian)) {
    return null;
  }
  const effectiveEndIndex = Math.min(
    bars.length - 1,
    requestedEndIndex,
    endedByContrarian ? contrarianBarIndex - 1 : requestedEndIndex,
  );
  const windowBars = bars.slice(startIndex + 1, effectiveEndIndex + 1);
  if (!windowBars.length) {
    return {
      horizonKey: horizon.key,
      barsForward: horizon.multiplier,
      timeframeMinutes: Number.isFinite(Number(timeframeMinutes)) ? Number(timeframeMinutes) : null,
      clockMinutesForward: Number.isFinite(Number(timeframeMinutes))
        ? horizon.multiplier * Number(timeframeMinutes)
        : null,
      effectiveBars: 0,
      closeReturnBps: null,
      closeReturnAtr: null,
      mfeBps: 0,
      mfeAtr: 0,
      maeBps: 0,
      maeAtr: 0,
      excursionEdgeBps: 0,
      excursionEdgeAtr: 0,
      guidanceCorrect: false,
      endedByContrarian,
      contrarianTimeframe: contrarian?.timeframe || null,
      contrarianSignalTs: contrarian?.signalTs || null,
      contrarianScoreBasis: contrarian?.scoreBasis || null,
      contrarianScoreUsed: contrarian?.scoreUsed ?? null,
      contrarianPolicyId: contrarian?.policyId || null,
      contrarianIsPrecursorFrame: Boolean(contrarian?.isPrecursorFrame),
      barsUntilContrarian: endedByContrarian && Number.isInteger(contrarianBarIndex)
        ? Math.max(0, contrarianBarIndex - startIndex - 1)
        : null,
      zeroWindow: true,
    };
  }
  const referenceClose = Number(entryBar.c) || 0;
  if (!(referenceClose > 0)) {
    return null;
  }
  const atr = Number(atrSeries[startIndex]) || 0;
  const directionSign = getOutcomeDirectionSign(direction);
  const closingBar = bars[effectiveEndIndex];
  const signedCloseReturnBps = directionSign * ((Number(closingBar.c) - referenceClose) / referenceClose) * 10000;
  let mfeBps = Number.NEGATIVE_INFINITY;
  let maeBps = Number.POSITIVE_INFINITY;
  for (const bar of windowBars) {
    const high = Number(bar?.h) || referenceClose;
    const low = Number(bar?.l) || referenceClose;
    const favorableBps = directionSign > 0
      ? ((high - referenceClose) / referenceClose) * 10000
      : ((referenceClose - low) / referenceClose) * 10000;
    const adverseBps = directionSign > 0
      ? ((low - referenceClose) / referenceClose) * 10000
      : ((referenceClose - high) / referenceClose) * 10000;
    mfeBps = Math.max(mfeBps, favorableBps);
    maeBps = Math.min(maeBps, adverseBps);
  }
  const atrBps = atr > 0 ? (atr / referenceClose) * 10000 : null;
  const excursionEdgeBps = mfeBps + maeBps;
  return {
    horizonKey: horizon.key,
    barsForward: horizon.multiplier,
    timeframeMinutes: Number.isFinite(Number(timeframeMinutes)) ? Number(timeframeMinutes) : null,
    clockMinutesForward: Number.isFinite(Number(timeframeMinutes))
      ? horizon.multiplier * Number(timeframeMinutes)
      : null,
    effectiveBars: windowBars.length,
    closeReturnBps: round(signedCloseReturnBps, 2) || 0,
    closeReturnAtr: atrBps ? round(signedCloseReturnBps / atrBps, 3) : null,
    mfeBps: round(mfeBps, 2) || 0,
    mfeAtr: atrBps ? round(mfeBps / atrBps, 3) : null,
    maeBps: round(maeBps, 2) || 0,
    maeAtr: atrBps ? round(maeBps / atrBps, 3) : null,
    excursionEdgeBps: round(excursionEdgeBps, 2) || 0,
    excursionEdgeAtr: atrBps ? round(excursionEdgeBps / atrBps, 3) : null,
    guidanceCorrect: mfeBps > Math.abs(maeBps),
    endedByContrarian,
    contrarianTimeframe: contrarian?.timeframe || null,
    contrarianSignalTs: contrarian?.signalTs || null,
    contrarianScoreBasis: contrarian?.scoreBasis || null,
    contrarianScoreUsed: contrarian?.scoreUsed ?? null,
    contrarianPolicyId: contrarian?.policyId || null,
    contrarianIsPrecursorFrame: Boolean(contrarian?.isPrecursorFrame),
    barsUntilContrarian: endedByContrarian && Number.isInteger(contrarianBarIndex)
      ? Math.max(0, contrarianBarIndex - startIndex - 1)
      : null,
    zeroWindow: false,
    atrBps: atrBps ? round(atrBps, 2) : null,
  };
}

function upperBoundNumeric(values = [], target) {
  let low = 0;
  let high = Array.isArray(values) ? values.length : 0;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if ((Number(values[mid]) || 0) <= target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

function findContainingBarIndex(barTimeMs = [], epochMs) {
  if (!Array.isArray(barTimeMs) || !barTimeMs.length || !Number.isFinite(Number(epochMs))) {
    return null;
  }
  const insertIndex = upperBoundNumeric(barTimeMs, Number(epochMs));
  if (insertIndex <= 0) {
    return 0;
  }
  return Math.min(barTimeMs.length - 1, insertIndex - 1);
}

function isTenureBarCorrect(bar, direction = "long", referenceClose = 0) {
  const high = Number(bar?.h);
  const low = Number(bar?.l);
  if (!Number.isFinite(high) || !Number.isFinite(low) || !(referenceClose > 0)) {
    return false;
  }
  if (direction === "short") {
    return low < referenceClose && high <= referenceClose;
  }
  return high > referenceClose && low >= referenceClose;
}

function getTenureOutcomeForHorizon({
  bars = [],
  barTimeMs = [],
  referenceClose = 0,
  startIndex = -1,
  direction = "long",
  horizon = null,
  contrarian = null,
  timeframeMinutes = null,
}) {
  if (!horizon || startIndex < 0 || !(referenceClose > 0)) {
    return null;
  }

  const requestedEndIndex = startIndex + horizon.multiplier;
  const contrarianBarIndex = Number.isFinite(Number(contrarian?.timeMs))
    ? findContainingBarIndex(barTimeMs, Number(contrarian.timeMs))
    : null;
  const endedByContrarian = Number.isInteger(contrarianBarIndex) && contrarianBarIndex <= requestedEndIndex;

  if (requestedEndIndex >= bars.length && !endedByContrarian) {
    return null;
  }

  const effectiveEndIndex = Math.min(
    bars.length - 1,
    requestedEndIndex,
    endedByContrarian ? contrarianBarIndex - 1 : requestedEndIndex,
  );
  const eligibleBars = Math.max(0, effectiveEndIndex - startIndex);

  if (eligibleBars <= 0) {
    return {
      horizonKey: horizon.key,
      barsForward: horizon.multiplier,
      timeframeMinutes: Number.isFinite(Number(timeframeMinutes)) ? Number(timeframeMinutes) : null,
      clockMinutesForward: Number.isFinite(Number(timeframeMinutes))
        ? horizon.multiplier * Number(timeframeMinutes)
        : null,
      eligibleBars: 0,
      correctBars: 0,
      tenurePct: null,
      majorityCorrect: false,
      endedByContrarian,
      contrarianTimeframe: contrarian?.timeframe || null,
      contrarianSignalTs: contrarian?.signalTs || null,
      contrarianScoreBasis: contrarian?.scoreBasis || null,
      contrarianScoreUsed: contrarian?.scoreUsed ?? null,
      contrarianPolicyId: contrarian?.policyId || null,
      contrarianIsPrecursorFrame: Boolean(contrarian?.isPrecursorFrame),
      barsUntilContrarian: endedByContrarian && Number.isInteger(contrarianBarIndex)
        ? Math.max(0, contrarianBarIndex - startIndex - 1)
        : null,
      zeroWindow: true,
    };
  }

  let correctBars = 0;
  for (let index = startIndex + 1; index <= effectiveEndIndex; index += 1) {
    if (isTenureBarCorrect(bars[index], direction, referenceClose)) {
      correctBars += 1;
    }
  }

  const tenureRatio = correctBars / eligibleBars;
  return {
    horizonKey: horizon.key,
    barsForward: horizon.multiplier,
    timeframeMinutes: Number.isFinite(Number(timeframeMinutes)) ? Number(timeframeMinutes) : null,
    clockMinutesForward: Number.isFinite(Number(timeframeMinutes))
      ? horizon.multiplier * Number(timeframeMinutes)
      : null,
    eligibleBars,
    correctBars,
    tenurePct: round(tenureRatio * 100, 1),
    majorityCorrect: tenureRatio > 0.5,
    endedByContrarian,
    contrarianTimeframe: contrarian?.timeframe || null,
    contrarianSignalTs: contrarian?.signalTs || null,
    contrarianScoreBasis: contrarian?.scoreBasis || null,
    contrarianScoreUsed: contrarian?.scoreUsed ?? null,
    contrarianPolicyId: contrarian?.policyId || null,
    contrarianIsPrecursorFrame: Boolean(contrarian?.isPrecursorFrame),
    barsUntilContrarian: endedByContrarian && Number.isInteger(contrarianBarIndex)
      ? Math.max(0, contrarianBarIndex - startIndex - 1)
      : null,
    zeroWindow: false,
  };
}

function mean(values = [], digits = 2) {
  const numeric = (Array.isArray(values) ? values : []).filter((value) => Number.isFinite(Number(value))).map(Number);
  if (!numeric.length) {
    return null;
  }
  return round(numeric.reduce((sum, value) => sum + value, 0) / numeric.length, digits);
}

function getRequestedClockMinutes(outcome = null) {
  const value = Number(outcome?.clockMinutesForward);
  return Number.isFinite(value) ? value : null;
}

function getEffectiveClockMinutes(outcome = null, barsKey = "effectiveBars") {
  const bars = Number(outcome?.[barsKey]);
  const timeframeMinutes = Number(outcome?.timeframeMinutes);
  if (!Number.isFinite(bars) || !Number.isFinite(timeframeMinutes)) {
    return null;
  }
  return bars * timeframeMinutes;
}

function buildForwardHeadlineBlocks(horizonSummaries = {}, preferredScoreType = "final") {
  const scoreKey = String(preferredScoreType || "final").trim().toLowerCase() === "raw" ? "raw" : "final";
  return Object.fromEntries(
    FORWARD_HEADLINE_BLOCKS.map((block) => {
      const resolvedHorizons = (Array.isArray(block.horizons) ? block.horizons : [])
        .map((horizonKey) => [horizonKey, horizonSummaries?.[horizonKey]?.[scoreKey]?.overall || null])
        .filter(([, summary]) => summary);
      const summaries = resolvedHorizons.map(([, summary]) => summary);
      return [
        block.key,
        {
          key: block.key,
          label: block.label,
          horizons: resolvedHorizons.map(([horizonKey]) => horizonKey),
          signalCount: summaries.length
            ? Math.min(...summaries.map((summary) => Number(summary?.signalCount)).filter((value) => Number.isFinite(value)))
            : null,
          guidanceRatePct: mean(summaries.map((summary) => summary?.guidanceRatePct), 1),
          meanValidatedQualityScore: mean(summaries.map((summary) => summary?.meanValidatedQualityScore), 3),
          meanExcursionEdgeAtr: mean(summaries.map((summary) => summary?.meanExcursionEdgeAtr), 3),
          meanExcursionEdgeBps: mean(summaries.map((summary) => summary?.meanExcursionEdgeBps), 2),
          meanCloseReturnAtr: mean(summaries.map((summary) => summary?.meanCloseReturnAtr), 3),
          meanCloseReturnBps: mean(summaries.map((summary) => summary?.meanCloseReturnBps), 2),
          meanStayedRightPct: mean(summaries.map((summary) => summary?.meanStayedRightPct), 1),
        },
      ];
    }),
  );
}

function normalizeStudyScoreType(scoreType = "final") {
  const normalized = String(scoreType || "final").trim().toLowerCase();
  if (normalized === "raw") {
    return "raw";
  }
  if (normalized === "effective") {
    return "effective";
  }
  return "final";
}

function normalizeSignedUnit(value, cap = REALIZED_QUALITY_EDGE_ATR_CAP, digits = 3) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  const safeCap = Math.max(0.001, Number(cap) || REALIZED_QUALITY_EDGE_ATR_CAP);
  return round(clampUnit(0.5 + (numeric / (safeCap * 2))), digits);
}

function buildValidatedQualityComponentScores({
  bestMoveAtr = null,
  closeResultAtr = null,
  guidanceCorrect = null,
  stayedRightPct = null,
} = {}) {
  const componentValues = {
    best_move_atr: {
      rawValue: Number.isFinite(Number(bestMoveAtr)) ? round(bestMoveAtr, 3) : null,
      normalizedScore: normalizeSignedUnit(bestMoveAtr, REALIZED_QUALITY_EDGE_ATR_CAP, 3),
    },
    close_result_atr: {
      rawValue: Number.isFinite(Number(closeResultAtr)) ? round(closeResultAtr, 3) : null,
      normalizedScore: normalizeSignedUnit(closeResultAtr, REALIZED_QUALITY_CLOSE_ATR_CAP, 3),
    },
    direction_correct_pct: {
      rawValue: guidanceCorrect == null ? null : (guidanceCorrect ? 100 : 0),
      normalizedScore: guidanceCorrect == null ? null : (guidanceCorrect ? 1 : 0),
    },
    stayed_right_pct: {
      rawValue: Number.isFinite(Number(stayedRightPct)) ? round(stayedRightPct, 1) : null,
      normalizedScore: Number.isFinite(Number(stayedRightPct)) ? clampUnit(Number(stayedRightPct) / 100) : null,
    },
  };
  const weightedComponents = RAYALGO_VALIDATED_QUALITY_COMPONENTS
    .map((component) => ({
      ...component,
      ...componentValues[component.key],
    }))
    .filter((component) => Number.isFinite(Number(component.normalizedScore)));
  const weightTotal = weightedComponents.reduce((sum, component) => sum + component.weight, 0);
  const score = weightTotal > 0
    ? round(weightedComponents.reduce((sum, component) => sum + (Number(component.normalizedScore) * component.weight), 0) / weightTotal, 3)
    : null;
  return {
    score,
    components: Object.fromEntries(
      RAYALGO_VALIDATED_QUALITY_COMPONENTS.map((component) => [
        component.key,
        {
          key: component.key,
          label: component.label,
          unit: component.unit,
          weight: component.weight,
          description: component.description,
          rawValue: componentValues[component.key]?.rawValue ?? null,
          normalizedScore: componentValues[component.key]?.normalizedScore ?? null,
        },
      ]),
    ),
    bestMoveAtr: componentValues.best_move_atr.rawValue,
    closeResultAtr: componentValues.close_result_atr.rawValue,
    directionCorrectPct: componentValues.direction_correct_pct.rawValue,
    stayedRightPct: componentValues.stayed_right_pct.rawValue,
    bestMoveQualityScore: componentValues.best_move_atr.normalizedScore,
    closeResultQualityScore: componentValues.close_result_atr.normalizedScore,
    directionCorrectQualityScore: componentValues.direction_correct_pct.normalizedScore,
    stayedRightQualityScore: componentValues.stayed_right_pct.normalizedScore,
  };
}

function buildValidatedQualityForHorizon(record = null, horizonKey = null) {
  const forwardOutcome = record?.outcomes?.[horizonKey];
  const tenureOutcome = record?.tenureOutcomes?.[horizonKey];
  const usableForwardOutcome = forwardOutcome && !forwardOutcome.zeroWindow ? forwardOutcome : null;
  const usableTenureOutcome = tenureOutcome && !tenureOutcome.zeroWindow ? tenureOutcome : null;
  if (!usableForwardOutcome && !usableTenureOutcome) {
    return null;
  }
  return {
    horizonKey,
    ...buildValidatedQualityComponentScores({
      bestMoveAtr: usableForwardOutcome?.excursionEdgeAtr ?? null,
      closeResultAtr: usableForwardOutcome?.closeReturnAtr ?? null,
      guidanceCorrect: usableForwardOutcome ? Boolean(usableForwardOutcome.guidanceCorrect) : null,
      stayedRightPct: usableTenureOutcome?.tenurePct ?? null,
    }),
  };
}

function summarizeValidatedQualitySnapshots(snapshots = []) {
  const usable = (Array.isArray(snapshots) ? snapshots : []).filter(Boolean);
  if (!usable.length) {
    return {
      signalCount: 0,
      meanValidatedQualityScore: null,
      meanBestMoveAtr: null,
      meanCloseResultAtr: null,
      meanDirectionCorrectPct: null,
      meanStayedRightPct: null,
      meanBestMoveQualityScore: null,
      meanCloseResultQualityScore: null,
      meanDirectionCorrectQualityScore: null,
      meanStayedRightQualityScore: null,
    };
  }
  return {
    signalCount: usable.length,
    meanValidatedQualityScore: mean(usable.map((snapshot) => snapshot.score), 3),
    meanBestMoveAtr: mean(usable.map((snapshot) => snapshot.bestMoveAtr), 3),
    meanCloseResultAtr: mean(usable.map((snapshot) => snapshot.closeResultAtr), 3),
    meanDirectionCorrectPct: mean(usable.map((snapshot) => snapshot.directionCorrectPct), 1),
    meanStayedRightPct: mean(usable.map((snapshot) => snapshot.stayedRightPct), 1),
    meanBestMoveQualityScore: mean(usable.map((snapshot) => snapshot.bestMoveQualityScore), 3),
    meanCloseResultQualityScore: mean(usable.map((snapshot) => snapshot.closeResultQualityScore), 3),
    meanDirectionCorrectQualityScore: mean(usable.map((snapshot) => snapshot.directionCorrectQualityScore), 3),
    meanStayedRightQualityScore: mean(usable.map((snapshot) => snapshot.stayedRightQualityScore), 3),
  };
}

function buildRealizedQualityScore(record = null) {
  const forwardOutcomes = REALIZED_QUALITY_FORWARD_HORIZONS
    .map((horizonKey) => record?.outcomes?.[horizonKey])
    .filter((outcome) => outcome && !outcome.zeroWindow);
  const tenureOutcomes = REALIZED_QUALITY_TENURE_HORIZONS
    .map((horizonKey) => record?.tenureOutcomes?.[horizonKey])
    .filter((outcome) => outcome && !outcome.zeroWindow);
  const horizonSnapshots = REALIZED_QUALITY_SHARED_HORIZONS
    .map((horizonKey) => buildValidatedQualityForHorizon(record, horizonKey))
    .filter(Boolean);
  const summary = summarizeValidatedQualitySnapshots(horizonSnapshots);
  return {
    score: summary.meanValidatedQualityScore,
    excursionQualityScore: summary.meanBestMoveQualityScore,
    closeQualityScore: summary.meanCloseResultQualityScore,
    guidanceQualityScore: summary.meanDirectionCorrectQualityScore,
    tenureQualityScore: summary.meanStayedRightQualityScore,
    bestMoveQualityScore: summary.meanBestMoveQualityScore,
    closeResultQualityScore: summary.meanCloseResultQualityScore,
    directionCorrectQualityScore: summary.meanDirectionCorrectQualityScore,
    stayedRightQualityScore: summary.meanStayedRightQualityScore,
    meanBestMoveAtr: summary.meanBestMoveAtr,
    meanCloseResultAtr: summary.meanCloseResultAtr,
    meanDirectionCorrectPct: summary.meanDirectionCorrectPct,
    meanStayedRightPct: summary.meanStayedRightPct,
    forwardOutcomeCount: forwardOutcomes.length,
    tenureOutcomeCount: tenureOutcomes.length,
    validatedHorizonCount: horizonSnapshots.length,
    validatedByHorizon: Object.fromEntries(horizonSnapshots.map((snapshot) => [snapshot.horizonKey, snapshot])),
  };
}

function buildPredictedScoreSummary(records = [], preferredScoreType = "final") {
  return {
    preferredScoreType: normalizeStudyScoreType(preferredScoreType),
    meanRawScore: mean(records.map((record) => record?.rawScore), 3),
    meanFinalScore: mean(records.map((record) => record?.finalScore), 3),
    meanEffectiveScore: mean(records.map((record) => record?.effectiveScore), 3),
  };
}

function buildValidatedOutcomeSummary(records = [], fewCandleSummary = null) {
  const usableRecords = Array.isArray(records) ? records : [];
  const fewCandle = fewCandleSummary || summarizeFewCandleMetrics(usableRecords);
  return {
    signalCount: usableRecords.length,
    evaluatedSignalCount: usableRecords.filter((record) => Number.isFinite(Number(record?.realizedQualityScore))).length,
    validatedQualityScore: mean(usableRecords.map((record) => record?.realizedQualityScore), 3),
    bestMoveAtr: mean(usableRecords.map((record) => record?.realizedQuality?.meanBestMoveAtr), 3),
    closeResultAtr: mean(usableRecords.map((record) => record?.realizedQuality?.meanCloseResultAtr), 3),
    directionCorrectPct: mean(usableRecords.map((record) => record?.realizedQuality?.meanDirectionCorrectPct), 1),
    stayedRightPct: mean(usableRecords.map((record) => record?.realizedQuality?.meanStayedRightPct), 1),
    earlyCheckPct: fewCandle?.fewCandleCorrectRatePct ?? null,
    sustainedCheckPct: fewCandle?.sustainedCorrectRatePct ?? null,
    fewCandleQualityScore: fewCandle?.meanFewCandleQualityScore ?? null,
  };
}

function buildForwardRankEvaluation(horizonSummaries = {}, preferredScoreType = "final") {
  const scoreType = normalizeStudyScoreType(preferredScoreType);
  return aggregateScoreTypeEvaluations(
    REALIZED_QUALITY_SHARED_HORIZONS.map((horizonKey) => horizonSummaries?.[horizonKey]?.[scoreType]?.evaluation),
  );
}

function buildValidatedOutcomeCell(horizonSummary = null, preferredScoreType = "final") {
  const scoreType = normalizeStudyScoreType(preferredScoreType);
  const scoreEntry = horizonSummary?.[scoreType]
    || horizonSummary?.final
    || horizonSummary?.raw
    || horizonSummary?.effective
    || null;
  const overall = scoreEntry?.overall || null;
  const evaluation = scoreEntry?.evaluation || null;
  const signalCount = Number(overall?.signalCount) || 0;
  return {
    signalCount,
    lowSample: signalCount > 0 && signalCount < MIN_RECOMMENDATION_SAMPLE,
    validatedQualityScore: overall?.meanValidatedQualityScore ?? null,
    bestMoveAtr: overall?.meanExcursionEdgeAtr ?? null,
    closeResultAtr: overall?.meanCloseReturnAtr ?? null,
    directionCorrectPct: overall?.guidanceRatePct ?? null,
    stayedRightPct: overall?.meanStayedRightPct ?? overall?.meanTenurePct ?? null,
    orderReliabilityPct: evaluation?.qualityMonotonicityPct ?? evaluation?.monotonicityPct ?? null,
    topBottomValidatedQualityLift: evaluation?.topBottomQualityLift ?? null,
    topBottomBestMoveLiftAtr: evaluation?.topBottomEdgeLift ?? null,
    topBottomCloseLiftAtr: evaluation?.topBottomCloseLift ?? null,
    topBottomDirectionCorrectLiftPct: evaluation?.topBottomGuidanceLiftPct ?? null,
    topBottomStayedRightLiftPct: evaluation?.topBottomStayedRightLiftPct ?? null,
    qualifiedBucketCount: evaluation?.qualifiedBucketCount ?? null,
  };
}

function buildTimeframeHorizonValidityRow({
  timeframe = "overall",
  label = "All",
  signalCount = 0,
  preferredScoreType = "final",
  horizonSummaries = {},
} = {}) {
  const cells = Object.fromEntries(
    VALIDATED_QUALITY_DISPLAY_HORIZONS.map((horizonKey) => [
      horizonKey,
      buildValidatedOutcomeCell(horizonSummaries?.[horizonKey], preferredScoreType),
    ]),
  );
  const rankEvaluation = buildForwardRankEvaluation(horizonSummaries, preferredScoreType);
  return {
    timeframe,
    label,
    signalCount: Number(signalCount) || 0,
    preferredScoreType: normalizeStudyScoreType(preferredScoreType),
    lowSample: (Number(signalCount) || 0) > 0 && (Number(signalCount) || 0) < MIN_RECOMMENDATION_SAMPLE,
    cells,
    summary: {
      validatedQualityScore: mean(Object.values(cells).map((cell) => cell?.validatedQualityScore), 3),
      bestMoveAtr: mean(Object.values(cells).map((cell) => cell?.bestMoveAtr), 3),
      closeResultAtr: mean(Object.values(cells).map((cell) => cell?.closeResultAtr), 3),
      directionCorrectPct: mean(Object.values(cells).map((cell) => cell?.directionCorrectPct), 1),
      stayedRightPct: mean(Object.values(cells).map((cell) => cell?.stayedRightPct), 1),
      orderReliabilityPct: rankEvaluation?.qualityMonotonicityPct ?? rankEvaluation?.monotonicityPct ?? null,
      topBottomValidatedQualityLift: rankEvaluation?.topBottomQualityLift ?? null,
      topBottomBestMoveLiftAtr: rankEvaluation?.topBottomEdgeLift ?? null,
      topBottomCloseLiftAtr: rankEvaluation?.topBottomCloseLift ?? null,
      topBottomDirectionCorrectLiftPct: rankEvaluation?.topBottomGuidanceLiftPct ?? null,
      topBottomStayedRightLiftPct: rankEvaluation?.topBottomStayedRightLiftPct ?? null,
      qualifiedBucketCount: rankEvaluation?.qualifiedBucketCount ?? null,
    },
  };
}

function buildDirectionTimeframeHorizonRows(usableStudies = [], directionKey = "combined", directionSummary = null) {
  const preferredScoreType = normalizeStudyScoreType(
    directionSummary?.overallSummary?.preferredScoreType
      || directionSummary?.preferredScoreType
      || "final",
  );
  const rows = [
    buildTimeframeHorizonValidityRow({
      timeframe: "overall",
      label: "All",
      signalCount: directionSummary?.overallSummary?.totalSignals ?? directionSummary?.signalCount ?? 0,
      preferredScoreType,
      horizonSummaries: directionSummary?.horizonSummaries || directionSummary?.horizons || {},
    }),
  ];
  const sortedStudies = [...(Array.isArray(usableStudies) ? usableStudies : [])]
    .filter((study) => study?.timeframe)
    .sort((left, right) => (Number(left?.tfMinutes) || 0) - (Number(right?.tfMinutes) || 0));
  sortedStudies.forEach((study) => {
    const directional = study?.directions?.[directionKey] || null;
    rows.push(buildTimeframeHorizonValidityRow({
      timeframe: study.timeframe,
      label: study.timeframe,
      signalCount: directional?.signalCount ?? study?.signalCount ?? 0,
      preferredScoreType: directional?.preferredScoreType || preferredScoreType,
      horizonSummaries: directional?.horizons || {},
    }));
  });
  return rows;
}

function resolveRankValidityVerdict({
  signalCount = 0,
  orderReliabilityPct = null,
  topBottomValidatedQualityLift = null,
  evaluatedTimeframeCount = 0,
  workingTimeframeCount = 0,
} = {}) {
  if ((Number(signalCount) || 0) < MIN_RECOMMENDATION_SAMPLE || !Number.isFinite(Number(orderReliabilityPct))) {
    return {
      status: "insufficient",
      verdict: "Need more evidence",
      headline: "Not enough ranked outcome data yet to judge whether higher predicted scores are mapping to better validated quality.",
      tone: "amber",
    };
  }
  if (
    Number(orderReliabilityPct) >= 75
    && Number(topBottomValidatedQualityLift) >= 0.05
    && (evaluatedTimeframeCount === 0 || workingTimeframeCount >= Math.max(1, Math.min(2, evaluatedTimeframeCount)))
  ) {
    return {
      status: "working",
      verdict: "Score rank working",
      headline: "Higher predicted scores are separating better validated outcomes cleanly.",
      tone: "green",
    };
  }
  if (Number(orderReliabilityPct) >= 60 && Number(topBottomValidatedQualityLift) >= 0.02) {
    return {
      status: "mixed",
      verdict: "Mixed / unstable",
      headline: "Higher predicted scores are helping, but the separation is not broad or consistent enough yet.",
      tone: "blue",
    };
  }
  return {
    status: "not_working",
    verdict: "No clear separation",
    headline: "Higher predicted scores are not reliably mapping to better validated outcomes yet.",
    tone: "red",
  };
}

function buildRankValiditySummary({
  signalCount = 0,
  preferredScoreType = "final",
  horizonSummaries = {},
  timeframeRows = [],
} = {}) {
  const evaluation = buildForwardRankEvaluation(horizonSummaries, preferredScoreType);
  const timeframeDiagnostics = (Array.isArray(timeframeRows) ? timeframeRows : [])
    .filter((row) => row?.timeframe && row.timeframe !== "overall" && (Number(row?.signalCount) || 0) >= MIN_RECOMMENDATION_SAMPLE);
  const workingTimeframes = timeframeDiagnostics.filter((row) => (
    Number(row?.summary?.orderReliabilityPct) >= 60
    && Number(row?.summary?.topBottomValidatedQualityLift) >= MATERIAL_REALIZED_QUALITY_DELTA
  ));
  const verdict = resolveRankValidityVerdict({
    signalCount,
    orderReliabilityPct: evaluation?.qualityMonotonicityPct ?? evaluation?.monotonicityPct ?? null,
    topBottomValidatedQualityLift: evaluation?.topBottomQualityLift ?? null,
    evaluatedTimeframeCount: timeframeDiagnostics.length,
    workingTimeframeCount: workingTimeframes.length,
  });
  return {
    preferredScoreType: normalizeStudyScoreType(preferredScoreType),
    signalCount: Number(signalCount) || 0,
    orderReliabilityPct: evaluation?.qualityMonotonicityPct ?? evaluation?.monotonicityPct ?? null,
    topBottomValidatedQualityLift: evaluation?.topBottomQualityLift ?? null,
    topBottomBestMoveLiftAtr: evaluation?.topBottomEdgeLift ?? null,
    topBottomCloseLiftAtr: evaluation?.topBottomCloseLift ?? null,
    topBottomDirectionCorrectLiftPct: evaluation?.topBottomGuidanceLiftPct ?? null,
    topBottomStayedRightLiftPct: evaluation?.topBottomStayedRightLiftPct ?? null,
    qualifiedBucketCount: evaluation?.qualifiedBucketCount ?? null,
    evaluatedTimeframeCount: timeframeDiagnostics.length,
    workingTimeframeCount: workingTimeframes.length,
    stabilityPct: timeframeDiagnostics.length
      ? round((workingTimeframes.length / timeframeDiagnostics.length) * 100, 1)
      : null,
    ...verdict,
  };
}

function buildFewCandleOutcome(record = null) {
  const guidance3x = record?.outcomes?.[FEW_CANDLE_GUIDANCE_HORIZON];
  const tenure3x = record?.tenureOutcomes?.[FEW_CANDLE_TENURE_HORIZON];
  const guidance6x = record?.outcomes?.[SUSTAINED_GUIDANCE_HORIZON];
  const tenure6x = record?.tenureOutcomes?.[SUSTAINED_TENURE_HORIZON];
  const guidance3xCorrect = Boolean(guidance3x && !guidance3x.zeroWindow && guidance3x.guidanceCorrect);
  const tenure3xPct = Number(tenure3x?.tenurePct);
  const tenure3xValid = Number.isFinite(tenure3xPct);
  const tenure3xCorrect = tenure3xValid && tenure3xPct >= FEW_CANDLE_MIN_TENURE_PCT;
  const guidance6xCorrect = Boolean(guidance6x && !guidance6x.zeroWindow && guidance6x.guidanceCorrect);
  const tenure6xPct = Number(tenure6x?.tenurePct);
  const tenure6xValid = Number.isFinite(tenure6xPct);
  const tenure6xCorrect = tenure6xValid && tenure6xPct >= SUSTAINED_MIN_TENURE_PCT;
  const fewCandleCorrect = guidance3xCorrect && tenure3xCorrect;
  const sustainedCorrect = fewCandleCorrect && guidance6xCorrect && tenure6xCorrect;
  const score = mean([
    guidance3xCorrect ? 1 : 0,
    tenure3xValid ? clampUnit(tenure3xPct / 100) : null,
    guidance6x && !guidance6x.zeroWindow ? (guidance6xCorrect ? 1 : 0) : null,
    tenure6xValid ? clampUnit(tenure6xPct / 100) : null,
  ], 3);
  return {
    score,
    guidance3xCorrect,
    tenure3xPct: tenure3xValid ? round(tenure3xPct, 1) : null,
    guidance6xCorrect: guidance6x && !guidance6x.zeroWindow ? guidance6xCorrect : null,
    tenure6xPct: tenure6xValid ? round(tenure6xPct, 1) : null,
    fewCandleCorrect,
    sustainedCorrect,
  };
}

function summarizeFewCandleMetrics(records = []) {
  const usable = (Array.isArray(records) ? records : [])
    .map((record) => record?.fewCandleOutcome)
    .filter(Boolean);
  return {
    usableCount: usable.length,
    meanFewCandleQualityScore: mean(usable.map((outcome) => outcome?.score), 3),
    fewCandleCorrectRatePct: usable.length
      ? round((usable.filter((outcome) => outcome?.fewCandleCorrect).length / usable.length) * 100, 1)
      : null,
    sustainedCorrectRatePct: usable.length
      ? round((usable.filter((outcome) => outcome?.sustainedCorrect).length / usable.length) * 100, 1)
      : null,
    mean3xTenurePct: mean(usable.map((outcome) => outcome?.tenure3xPct), 1),
    mean6xTenurePct: mean(usable.map((outcome) => outcome?.tenure6xPct), 1),
  };
}

function createContrarianPolicyForwardAccumulator() {
  return {
    signalCount: 0,
    guidanceCorrectCount: 0,
    excursionEdgeAtrSum: 0,
    excursionEdgeAtrCount: 0,
    closeReturnAtrSum: 0,
    closeReturnAtrCount: 0,
    contrarianStopCount: 0,
  };
}

function createContrarianPolicyTenureAccumulator() {
  return {
    signalCount: 0,
    majorityCorrectCount: 0,
    tenurePctSum: 0,
    tenurePctCount: 0,
    eligibleBarsSum: 0,
    eligibleBarsCount: 0,
    contrarianStopCount: 0,
  };
}

function createContrarianPolicyDirectionAccumulator() {
  return {
    signalCount: 0,
    predictedEffectiveScoreSum: 0,
    predictedEffectiveScoreCount: 0,
    realizedQualityScoreSum: 0,
    realizedQualityScoreCount: 0,
    fewCandleQualityScoreSum: 0,
    fewCandleQualityScoreCount: 0,
    fewCandleCorrectCount: 0,
    sustainedCorrectCount: 0,
    fewCandleUsableCount: 0,
    forwardByHorizon: Object.fromEntries(
      RAYALGO_SCORE_STUDY_HORIZONS.map((horizon) => [horizon.key, createContrarianPolicyForwardAccumulator()]),
    ),
    tenureByHorizon: Object.fromEntries(
      RAYALGO_SCORE_STUDY_TENURE_HORIZONS.map((horizon) => [horizon.key, createContrarianPolicyTenureAccumulator()]),
    ),
  };
}

function accumulateContrarianPolicyDirection(accumulator = null, {
  record = null,
  outcomes = {},
  tenureOutcomes = {},
  realizedQualityScore = null,
  fewCandleOutcome = null,
} = {}) {
  if (!accumulator) {
    return;
  }

  accumulator.signalCount += 1;

  const effectiveScore = Number(record?.effectiveScore);
  if (Number.isFinite(effectiveScore)) {
    accumulator.predictedEffectiveScoreSum += effectiveScore;
    accumulator.predictedEffectiveScoreCount += 1;
  }

  const qualityScore = Number(realizedQualityScore);
  if (Number.isFinite(qualityScore)) {
    accumulator.realizedQualityScoreSum += qualityScore;
    accumulator.realizedQualityScoreCount += 1;
  }

  const fewCandleScore = Number(fewCandleOutcome?.score);
  if (Number.isFinite(fewCandleScore)) {
    accumulator.fewCandleQualityScoreSum += fewCandleScore;
    accumulator.fewCandleQualityScoreCount += 1;
  }
  if (fewCandleOutcome) {
    accumulator.fewCandleUsableCount += 1;
    if (fewCandleOutcome.fewCandleCorrect) {
      accumulator.fewCandleCorrectCount += 1;
    }
    if (fewCandleOutcome.sustainedCorrect) {
      accumulator.sustainedCorrectCount += 1;
    }
  }

  for (const horizon of RAYALGO_SCORE_STUDY_HORIZONS) {
    const outcome = outcomes?.[horizon.key];
    if (!outcome || outcome.zeroWindow) {
      continue;
    }
    const bucket = accumulator.forwardByHorizon[horizon.key];
    bucket.signalCount += 1;
    if (outcome.guidanceCorrect) {
      bucket.guidanceCorrectCount += 1;
    }
    const excursionEdgeAtr = Number(outcome.excursionEdgeAtr);
    if (Number.isFinite(excursionEdgeAtr)) {
      bucket.excursionEdgeAtrSum += excursionEdgeAtr;
      bucket.excursionEdgeAtrCount += 1;
    }
    const closeReturnAtr = Number(outcome.closeReturnAtr);
    if (Number.isFinite(closeReturnAtr)) {
      bucket.closeReturnAtrSum += closeReturnAtr;
      bucket.closeReturnAtrCount += 1;
    }
    if (outcome.endedByContrarian) {
      bucket.contrarianStopCount += 1;
    }
  }

  for (const horizon of RAYALGO_SCORE_STUDY_TENURE_HORIZONS) {
    const outcome = tenureOutcomes?.[horizon.key];
    if (!outcome || outcome.zeroWindow) {
      continue;
    }
    const bucket = accumulator.tenureByHorizon[horizon.key];
    bucket.signalCount += 1;
    if (outcome.majorityCorrect) {
      bucket.majorityCorrectCount += 1;
    }
    const tenurePct = Number(outcome.tenurePct);
    if (Number.isFinite(tenurePct)) {
      bucket.tenurePctSum += tenurePct;
      bucket.tenurePctCount += 1;
    }
    const eligibleBars = Number(outcome.eligibleBars);
    if (Number.isFinite(eligibleBars)) {
      bucket.eligibleBarsSum += eligibleBars;
      bucket.eligibleBarsCount += 1;
    }
    if (outcome.endedByContrarian) {
      bucket.contrarianStopCount += 1;
    }
  }
}

function finalizeContrarianPolicyForwardSummary(accumulator = null) {
  const signalCount = Number(accumulator?.signalCount) || 0;
  return {
    signalCount,
    guidanceRatePct: signalCount
      ? round((Number(accumulator?.guidanceCorrectCount) || 0) / signalCount * 100, 1)
      : null,
    meanExcursionEdgeAtr: Number(accumulator?.excursionEdgeAtrCount) > 0
      ? round((Number(accumulator?.excursionEdgeAtrSum) || 0) / accumulator.excursionEdgeAtrCount, 3)
      : null,
    meanCloseReturnAtr: Number(accumulator?.closeReturnAtrCount) > 0
      ? round((Number(accumulator?.closeReturnAtrSum) || 0) / accumulator.closeReturnAtrCount, 3)
      : null,
    contrarianStopRatePct: signalCount
      ? round((Number(accumulator?.contrarianStopCount) || 0) / signalCount * 100, 1)
      : null,
  };
}

function finalizeContrarianPolicyTenureSummary(accumulator = null) {
  const signalCount = Number(accumulator?.signalCount) || 0;
  return {
    signalCount,
    majorityCorrectRatePct: signalCount
      ? round((Number(accumulator?.majorityCorrectCount) || 0) / signalCount * 100, 1)
      : null,
    meanTenurePct: Number(accumulator?.tenurePctCount) > 0
      ? round((Number(accumulator?.tenurePctSum) || 0) / accumulator.tenurePctCount, 1)
      : null,
    meanEligibleBars: Number(accumulator?.eligibleBarsCount) > 0
      ? round((Number(accumulator?.eligibleBarsSum) || 0) / accumulator.eligibleBarsCount, 2)
      : null,
    contrarianStopRatePct: signalCount
      ? round((Number(accumulator?.contrarianStopCount) || 0) / signalCount * 100, 1)
      : null,
  };
}

function finalizeContrarianPolicyDirection(accumulator = null) {
  const forwardByHorizon = Object.fromEntries(
    RAYALGO_SCORE_STUDY_HORIZONS.map((horizon) => [
      horizon.key,
      finalizeContrarianPolicyForwardSummary(accumulator?.forwardByHorizon?.[horizon.key]),
    ]),
  );
  const tenureByHorizon = Object.fromEntries(
    RAYALGO_SCORE_STUDY_TENURE_HORIZONS.map((horizon) => [
      horizon.key,
      finalizeContrarianPolicyTenureSummary(accumulator?.tenureByHorizon?.[horizon.key]),
    ]),
  );
  const fewCandleUsableCount = Number(accumulator?.fewCandleUsableCount) || 0;
  return {
    signalCount: Number(accumulator?.signalCount) || 0,
    meanPredictedEffectiveScore: Number(accumulator?.predictedEffectiveScoreCount) > 0
      ? round((Number(accumulator?.predictedEffectiveScoreSum) || 0) / accumulator.predictedEffectiveScoreCount, 3)
      : null,
    meanRealizedQualityScore: Number(accumulator?.realizedQualityScoreCount) > 0
      ? round((Number(accumulator?.realizedQualityScoreSum) || 0) / accumulator.realizedQualityScoreCount, 3)
      : null,
    meanFewCandleQualityScore: Number(accumulator?.fewCandleQualityScoreCount) > 0
      ? round((Number(accumulator?.fewCandleQualityScoreSum) || 0) / accumulator.fewCandleQualityScoreCount, 3)
      : null,
    fewCandleCorrectRatePct: fewCandleUsableCount
      ? round((Number(accumulator?.fewCandleCorrectCount) || 0) / fewCandleUsableCount * 100, 1)
      : null,
    sustainedCorrectRatePct: fewCandleUsableCount
      ? round((Number(accumulator?.sustainedCorrectCount) || 0) / fewCandleUsableCount * 100, 1)
      : null,
    meanForwardExcursionAtr: mean(Object.values(forwardByHorizon).map((summary) => summary?.meanExcursionEdgeAtr), 3),
    meanForwardExpectancyAtr: mean(Object.values(forwardByHorizon).map((summary) => summary?.meanCloseReturnAtr), 3),
    meanTenurePct: mean(Object.values(tenureByHorizon).map((summary) => summary?.meanTenurePct), 1),
    contrarianStopRatePct: mean(Object.values(tenureByHorizon).map((summary) => summary?.contrarianStopRatePct), 1),
    forwardByHorizon,
    tenureByHorizon,
  };
}

function buildContrarianPolicyObjective(summary = {}) {
  const fewCandleCorrectRatePct = Number(summary?.fewCandleCorrectRatePct) || 0;
  const sustainedCorrectRatePct = Number(summary?.sustainedCorrectRatePct) || 0;
  const meanRealizedQualityScore = Number(summary?.meanRealizedQualityScore) || 0;
  const meanForwardExcursionAtr = Number(summary?.meanForwardExcursionAtr) || 0;
  const meanForwardExpectancyAtr = Number(summary?.meanForwardExpectancyAtr) || 0;
  const meanTenurePct = Number(summary?.meanTenurePct) || 0;
  return round(
    (fewCandleCorrectRatePct * 0.45)
    + (sustainedCorrectRatePct * 0.2)
    + (meanRealizedQualityScore * 100 * 0.2)
    + (meanForwardExcursionAtr * 100 * 0.1)
    + (meanTenurePct * 0.03)
    + (meanForwardExpectancyAtr * 100 * 0.02),
    2,
  );
}

function buildContrarianPolicyComparison(timeframeStudies = [], overallRecords = [], {
  onProgress = null,
  shouldCancel = null,
  progressBasePct = 96,
  progressRangePct = 1,
} = {}) {
  const studiesByTimeframe = Object.fromEntries(
    (Array.isArray(timeframeStudies) ? timeframeStudies : []).map((study) => [study.timeframe, study]),
  );
  studiesByTimeframe.__contrarianLookup = buildContrarianLookup(timeframeStudies, "records");

  const totalPolicies = Math.max(CONTRARIAN_POLICY_CONFIGS.length, 1);
  const evaluatedConfigs = CONTRARIAN_POLICY_CONFIGS.map((policy, index) => {
    emitScoreStudyProgress(onProgress, shouldCancel, {
      stage: "Building summaries",
      detail: `Evaluating contrarian invalidation policies (${index + 1}/${totalPolicies}).`,
      pct: progressBasePct + Math.round(((index + 1) / totalPolicies) * progressRangePct),
    });
    const directionAccumulators = Object.fromEntries(
      RAYALGO_SCORE_STUDY_DIRECTIONS.map(({ key }) => [key, createContrarianPolicyDirectionAccumulator()]),
    );
    for (const record of Array.isArray(overallRecords) ? overallRecords : []) {
      const study = studiesByTimeframe?.[record?.timeframe];
      if (!study) {
        continue;
      }
      const contrarianLookup = studiesByTimeframe.__contrarianLookup || {};
      const contrarian = findFirstContrarianSignalForPolicy(record, study, contrarianLookup, policy);
      const policyRecord = {
        outcomes: {},
        tenureOutcomes: {},
      };
      for (const horizon of RAYALGO_SCORE_STUDY_HORIZONS) {
        const outcome = getOutcomeForHorizon({
          bars: study?.bars || [],
          atrSeries: study?.atrSeries || [],
          startIndex: record?.barIndex,
          direction: record?.direction,
          horizon,
          contrarian,
          barTimeMs: study?.barTimeMs || [],
          timeframeMinutes: study?.tfMinutes,
        });
        if (outcome) {
          policyRecord.outcomes[horizon.key] = outcome;
        }
      }
      for (const horizon of RAYALGO_SCORE_STUDY_TENURE_HORIZONS) {
        const outcome = getTenureOutcomeForHorizon({
          bars: study?.bars || [],
          barTimeMs: study?.barTimeMs || [],
          referenceClose: Number(record?.referenceClose) || 0,
          startIndex: record?.barIndex,
          direction: record?.direction,
          horizon,
          contrarian,
          timeframeMinutes: study?.tfMinutes,
        });
        if (outcome) {
          policyRecord.tenureOutcomes[horizon.key] = outcome;
        }
      }
      const realizedQuality = buildRealizedQualityScore(policyRecord);
      const fewCandleOutcome = buildFewCandleOutcome(policyRecord);
      const accumulationPayload = {
        record,
        outcomes: policyRecord.outcomes,
        tenureOutcomes: policyRecord.tenureOutcomes,
        realizedQualityScore: realizedQuality?.score ?? null,
        fewCandleOutcome,
      };
      accumulateContrarianPolicyDirection(directionAccumulators.combined, accumulationPayload);
      accumulateContrarianPolicyDirection(
        String(record?.direction || "").trim().toLowerCase() === "short"
          ? directionAccumulators.short
          : directionAccumulators.long,
        accumulationPayload,
      );
    }
    const directionSummaries = Object.fromEntries(
      RAYALGO_SCORE_STUDY_DIRECTIONS.map(({ key }) => {
        const summary = finalizeContrarianPolicyDirection(directionAccumulators[key]);
        return [key, {
          ...summary,
          objectiveScore: buildContrarianPolicyObjective(summary),
        }];
      }),
    );
    return {
      policyId: policy.id,
      family: policy.family,
      label: policy.label,
      scoreBasis: policy.scoreBasis,
      scope: policy.scope,
      minimumScore: policy.minimumScore,
      minimumDelta: policy.minimumDelta,
      precursorMinimumScore: Number.isFinite(Number(policy.minimumScore))
        ? clampUnit(Number(policy.minimumScore) + Number(policy.precursorMinBump || 0))
        : null,
      precursorMinimumDelta: Number.isFinite(Number(policy.minimumDelta))
        ? round(Math.max(0, Number(policy.minimumDelta) + Number(policy.precursorDeltaBump || 0)), 2)
        : null,
      directionSummaries,
    };
  });

  const families = Object.fromEntries(
    ["baseline", "active_min_only", "scoped_min_only", "scoped_min_margin"].map((familyKey) => {
      const familyConfigs = evaluatedConfigs.filter((config) => config.family === familyKey);
      const sorted = [...familyConfigs].sort((left, right) => {
        const scoreDelta = (Number(right?.directionSummaries?.combined?.objectiveScore) || 0) - (Number(left?.directionSummaries?.combined?.objectiveScore) || 0);
        if (Math.abs(scoreDelta) > 1e-9) return scoreDelta;
        return (Number(right?.directionSummaries?.combined?.meanRealizedQualityScore) || 0) - (Number(left?.directionSummaries?.combined?.meanRealizedQualityScore) || 0);
      });
      return [familyKey, {
        family: familyKey,
        configs: sorted,
        best: sorted[0] || null,
      }];
    }),
  );

  return {
    scoreBasis: CONTRARIAN_SCORE_BASIS,
    floorGrid: [...CONTRARIAN_MIN_SCORE_GRID],
    marginGrid: [...CONTRARIAN_MARGIN_GRID],
    precursorMinimumBump: CONTRARIAN_PRECURSOR_MIN_BUMP,
    precursorMarginBump: CONTRARIAN_PRECURSOR_MARGIN_BUMP,
    families,
    overallBestPolicy: [...evaluatedConfigs].sort((left, right) => (
      (Number(right?.directionSummaries?.combined?.objectiveScore) || 0) - (Number(left?.directionSummaries?.combined?.objectiveScore) || 0)
    ))[0] || null,
  };
}

function normalizeFeatureState(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "boolean") {
    return value ? "yes" : "no";
  }
  return String(value);
}

function bucketSmcAlignedCount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "0";
  if (numeric >= 3) return "3+";
  return String(Math.round(numeric));
}

function bucketVolRatio(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (numeric < 1) return "<1.0";
  if (numeric < 1.5) return "1.0-1.5";
  if (numeric < 2) return "1.5-2.0";
  return "2.0+";
}

function bucketRsi(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (numeric < 32) return "<32";
  if (numeric < 40) return "32-40";
  if (numeric < 60) return "40-60";
  if (numeric < 68) return "60-68";
  return "68+";
}

function bucketDistanceBps(value) {
  const numeric = Math.abs(Number(value));
  if (!Number.isFinite(numeric)) return null;
  if (numeric < 5) return "<5bps";
  if (numeric < 10) return "5-10bps";
  if (numeric < 20) return "10-20bps";
  return "20bps+";
}

function buildFeatureImpactDefinitions() {
  return [
    { key: "regime", label: "Regime", getState: (record) => normalizeFeatureState(record?.features?.regime) },
    { key: "regimeAligned", label: "Regime Aligned", getState: (record) => normalizeFeatureState(record?.features?.regimeAligned) },
    { key: "emaBiasAligned", label: "EMA Bias Aligned", getState: (record) => normalizeFeatureState(record?.features?.emaBiasAligned) },
    { key: "emaStackAligned", label: "EMA Stack Aligned", getState: (record) => normalizeFeatureState(record?.features?.emaStackAligned) },
    { key: "emaCrossAligned", label: "EMA Cross Aligned", getState: (record) => normalizeFeatureState(record?.features?.emaCrossAligned) },
    { key: "freshCross", label: "Fresh Cross", getState: (record) => normalizeFeatureState(record?.features?.freshCross) },
    { key: "recentCross", label: "Recent Cross", getState: (record) => normalizeFeatureState(record?.features?.recentCross) },
    { key: "nearSlowEma", label: "Near Slow EMA", getState: (record) => normalizeFeatureState(record?.features?.nearSlowEma) },
    { key: "chochAligned", label: "CHoCH Aligned", getState: (record) => normalizeFeatureState(record?.features?.chochAligned) },
    { key: "bosAligned", label: "BOS Aligned", getState: (record) => normalizeFeatureState(record?.features?.bosAligned) },
    { key: "obAligned", label: "Order Block Aligned", getState: (record) => normalizeFeatureState(record?.features?.obAligned) },
    { key: "sweepAligned", label: "Sweep Aligned", getState: (record) => normalizeFeatureState(record?.features?.sweepAligned) },
    { key: "fvgAligned", label: "FVG Aligned", getState: (record) => normalizeFeatureState(record?.features?.fvgAligned) },
    { key: "smcAlignedCount", label: "SMC Aligned Count", getState: (record) => normalizeFeatureState(bucketSmcAlignedCount(record?.features?.smcAlignedCount)) },
    { key: "trendAligned", label: "Trend Aligned", getState: (record) => normalizeFeatureState(record?.features?.trendAligned) },
    { key: "marketStructureAligned", label: "Market Structure Aligned", getState: (record) => normalizeFeatureState(record?.features?.marketStructureAligned) },
    { key: "rsiSupportive", label: "RSI Supportive", getState: (record) => normalizeFeatureState(record?.features?.rsiSupportive) },
    { key: "rsiExtended", label: "RSI Extended", getState: (record) => normalizeFeatureState(record?.features?.rsiExtended) },
    { key: "rsiBucket", label: "RSI Bucket", getState: (record) => normalizeFeatureState(bucketRsi(record?.features?.rsi)) },
    { key: "volSurge", label: "Volume Surge", getState: (record) => normalizeFeatureState(record?.features?.volSurge) },
    { key: "volRatioBucket", label: "Volume Ratio Bucket", getState: (record) => normalizeFeatureState(bucketVolRatio(record?.features?.volRatio)) },
    { key: "bandTrendAligned", label: "Band Trend Aligned", getState: (record) => normalizeFeatureState(record?.features?.bandTrendAligned) },
    { key: "bandRetestAligned", label: "Band Retest Aligned", getState: (record) => normalizeFeatureState(record?.features?.bandRetestAligned) },
    { key: "bandBasisAligned", label: "Band Basis Aligned", getState: (record) => normalizeFeatureState(record?.features?.bandBasisAligned) },
    { key: "opposingBandTrend", label: "Opposing Band Trend", getState: (record) => normalizeFeatureState(record?.features?.opposingBandTrend) },
    { key: "opposingBandRetest", label: "Opposing Band Retest", getState: (record) => normalizeFeatureState(record?.features?.opposingBandRetest) },
    { key: "bodyAligned", label: "Body Aligned", getState: (record) => normalizeFeatureState(record?.features?.bodyAligned) },
    { key: "macdAligned", label: "MACD Aligned", getState: (record) => normalizeFeatureState(record?.features?.macdAligned) },
    { key: "vwapPositionAligned", label: "VWAP Position Aligned", getState: (record) => normalizeFeatureState(record?.features?.vwapPositionAligned) },
    { key: "bbPositionAligned", label: "BB Position Aligned", getState: (record) => normalizeFeatureState(record?.features?.bbPositionAligned) },
    { key: "distanceToE21Bucket", label: "Distance To EMA21", getState: (record) => normalizeFeatureState(bucketDistanceBps(record?.features?.distanceToE21Bps)) },
    { key: "distanceToBandBasisBucket", label: "Distance To Band Basis", getState: (record) => normalizeFeatureState(bucketDistanceBps(record?.features?.distanceToBandBasisBps)) },
  ];
}

function buildFeatureStateMetrics(records = [], baselineRealizedQualityScore = null) {
  const forwardOutcomes = records
    .map((record) => record?.outcomes?.[RAYALGO_SCORE_STUDY_HEADLINE_HORIZON])
    .filter((outcome) => outcome && !outcome.zeroWindow);
  const tenureOutcomes = records
    .map((record) => record?.tenureOutcomes?.[RAYALGO_SCORE_STUDY_HEADLINE_HORIZON])
    .filter((outcome) => outcome && !outcome.zeroWindow);
  const fewCandle = summarizeFewCandleMetrics(records);
  const meanRealizedQualityScore = mean(records.map((record) => record?.realizedQualityScore), 3);
  return {
    count: records.length,
    lowConfidence: records.length < FEATURE_IMPACT_MIN_SAMPLE,
    meanPredictedRawScore: mean(records.map((record) => record?.rawScore), 3),
    meanPredictedFinalScore: mean(records.map((record) => record?.finalScore), 3),
    meanPredictedEffectiveScore: mean(records.map((record) => record?.effectiveScore), 3),
    meanRealizedQualityScore,
    realizedQualityLift: Number.isFinite(Number(baselineRealizedQualityScore)) && Number.isFinite(Number(meanRealizedQualityScore))
      ? round(meanRealizedQualityScore - baselineRealizedQualityScore, 3)
      : null,
    guidanceRatePct: forwardOutcomes.length
      ? round((forwardOutcomes.filter((outcome) => outcome.guidanceCorrect).length / forwardOutcomes.length) * 100, 1)
      : null,
    meanExcursionEdgeAtr: mean(forwardOutcomes.map((outcome) => outcome.excursionEdgeAtr), 3),
    meanCloseReturnAtr: mean(forwardOutcomes.map((outcome) => outcome.closeReturnAtr), 3),
    meanTenurePct: mean(tenureOutcomes.map((outcome) => outcome.tenurePct), 1),
    majorityCorrectRatePct: tenureOutcomes.length
      ? round((tenureOutcomes.filter((outcome) => outcome.majorityCorrect).length / tenureOutcomes.length) * 100, 1)
      : null,
    fewCandleCorrectRatePct: fewCandle.fewCandleCorrectRatePct,
    sustainedCorrectRatePct: fewCandle.sustainedCorrectRatePct,
    meanFewCandleQualityScore: fewCandle.meanFewCandleQualityScore,
  };
}

function buildFeatureImpactSummaries(records = []) {
  const usableRecords = (Array.isArray(records) ? records : []).filter((record) => record?.features);
  const baselineMeanRealizedQualityScore = mean(usableRecords.map((record) => record?.realizedQualityScore), 3);
  const featureGroups = buildFeatureImpactDefinitions().map((definition) => {
    const grouped = new Map();
    for (const record of usableRecords) {
      const state = definition.getState(record);
      if (state === null || state === undefined || state === "") {
        continue;
      }
      if (!grouped.has(state)) {
        grouped.set(state, []);
      }
      grouped.get(state).push(record);
    }
    const states = Array.from(grouped.entries()).map(([state, stateRecords]) => ({
      state,
      ...buildFeatureStateMetrics(stateRecords, baselineMeanRealizedQualityScore),
    })).sort((left, right) => {
      const liftDelta = (Number(right.realizedQualityLift) || 0) - (Number(left.realizedQualityLift) || 0);
      if (Math.abs(liftDelta) > 1e-9) {
        return liftDelta;
      }
      return (right.count || 0) - (left.count || 0);
    });
    return {
      featureKey: definition.key,
      label: definition.label,
      baselineMeanRealizedQualityScore,
      states,
    };
  }).filter((group) => group.states.length);

  const rankedStates = featureGroups.flatMap((group) => group.states.map((state) => ({
    featureKey: group.featureKey,
    label: group.label,
    ...state,
  })));
  const qualifiedStates = rankedStates.filter((state) => !state.lowConfidence);

  return {
    baselineMeanRealizedQualityScore,
    topPositiveStates: [...qualifiedStates]
      .sort((left, right) => (Number(right.realizedQualityLift) || 0) - (Number(left.realizedQualityLift) || 0))
      .slice(0, 8),
    topNegativeStates: [...qualifiedStates]
      .sort((left, right) => (Number(left.realizedQualityLift) || 0) - (Number(right.realizedQualityLift) || 0))
      .slice(0, 8),
    featureGroups,
  };
}

function quantile(values = [], ratio = 0.5, digits = 3) {
  const numeric = (Array.isArray(values) ? values : [])
    .filter((value) => Number.isFinite(Number(value)))
    .map(Number)
    .sort((left, right) => left - right);
  if (!numeric.length) {
    return null;
  }
  const clamped = Math.max(0, Math.min(1, Number(ratio) || 0));
  const position = (numeric.length - 1) * clamped;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = numeric[lowerIndex];
  const upper = numeric[upperIndex];
  if (!Number.isFinite(lower) || !Number.isFinite(upper)) {
    return null;
  }
  if (lowerIndex === upperIndex) {
    return round(lower, digits);
  }
  const interpolated = lower + (upper - lower) * (position - lowerIndex);
  return round(interpolated, digits);
}

function buildScoreDistribution(records = [], scoreKey = "finalScore") {
  const scores = (Array.isArray(records) ? records : [])
    .map((record) => Number(record?.[scoreKey]))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  if (!scores.length) {
    return {
      count: 0,
      min: null,
      p10: null,
      p25: null,
      p50: null,
      p75: null,
      p90: null,
      max: null,
      mean: null,
    };
  }
  return {
    count: scores.length,
    min: round(scores[0], 3),
    p10: quantile(scores, 0.1, 3),
    p25: quantile(scores, 0.25, 3),
    p50: quantile(scores, 0.5, 3),
    p75: quantile(scores, 0.75, 3),
    p90: quantile(scores, 0.9, 3),
    max: round(scores[scores.length - 1], 3),
    mean: mean(scores, 3),
  };
}

function buildBucketCoverage(rows = [], evaluation = null) {
  const populatedRows = (Array.isArray(rows) ? rows : []).filter((row) => (Number(row?.count) || 0) > 0);
  return {
    populatedBucketCount: populatedRows.length,
    qualifiedBucketCount: Number(evaluation?.qualifiedBucketCount) || 0,
    evaluationStatus: evaluation?.status || "insufficient",
    monotonicityPct: Number.isFinite(Number(evaluation?.monotonicityPct))
      ? round(evaluation.monotonicityPct, 1)
      : null,
    populatedBuckets: populatedRows,
  };
}

function buildEmptyBucketRow(bucket) {
  return {
    bucketKey: bucket.key,
    bucketLabel: bucket.label,
    lower: bucket.lower,
    upper: bucket.upper >= 1 ? 1 : bucket.upper,
    count: 0,
    lowConfidence: true,
    guidanceRatePct: null,
    meanExcursionEdgeBps: null,
    meanExcursionEdgeAtr: null,
    meanCloseReturnBps: null,
    meanCloseReturnAtr: null,
    meanMfeBps: null,
    meanMfeAtr: null,
    meanMaeBps: null,
    meanMaeAtr: null,
    meanScore: null,
  };
}

function buildBucketRows(records = [], scoreKey = "finalScore", horizonKey = RAYALGO_SCORE_STUDY_HEADLINE_HORIZON) {
  const rows = new Map(RAYALGO_SCORE_STUDY_BUCKETS.map((bucket) => [bucket.key, buildEmptyBucketRow(bucket)]));
  for (const record of Array.isArray(records) ? records : []) {
    const score = Number(record?.[scoreKey]);
    const outcome = record?.outcomes?.[horizonKey];
    if (!Number.isFinite(score) || !outcome || outcome.zeroWindow) {
      continue;
    }
    const tenureOutcome = record?.tenureOutcomes?.[horizonKey];
    const bucket = resolveBucket(score);
    const row = rows.get(bucket.key);
    row.count += 1;
    row._scores = row._scores || [];
    row._guidanceCorrect = row._guidanceCorrect || [];
    row._edgeBps = row._edgeBps || [];
    row._edgeAtr = row._edgeAtr || [];
    row._closeBps = row._closeBps || [];
    row._closeAtr = row._closeAtr || [];
    row._mfeBps = row._mfeBps || [];
    row._mfeAtr = row._mfeAtr || [];
    row._maeBps = row._maeBps || [];
    row._maeAtr = row._maeAtr || [];
    row._realizedQualityScores = row._realizedQualityScores || [];
    row._fewCandleCorrect = row._fewCandleCorrect || [];
    row._sustainedCorrect = row._sustainedCorrect || [];
    row._fewCandleQualityScores = row._fewCandleQualityScores || [];
    row._tenurePct = row._tenurePct || [];
    row._majorityCorrect = row._majorityCorrect || [];
    row._scores.push(score);
    row._guidanceCorrect.push(outcome.guidanceCorrect ? 1 : 0);
    row._edgeBps.push(outcome.excursionEdgeBps);
    if (Number.isFinite(Number(outcome.excursionEdgeAtr))) row._edgeAtr.push(outcome.excursionEdgeAtr);
    row._closeBps.push(outcome.closeReturnBps);
    if (Number.isFinite(Number(outcome.closeReturnAtr))) row._closeAtr.push(outcome.closeReturnAtr);
    row._mfeBps.push(outcome.mfeBps);
    if (Number.isFinite(Number(outcome.mfeAtr))) row._mfeAtr.push(outcome.mfeAtr);
    row._maeBps.push(outcome.maeBps);
    if (Number.isFinite(Number(outcome.maeAtr))) row._maeAtr.push(outcome.maeAtr);
    if (Number.isFinite(Number(record?.realizedQualityScore))) row._realizedQualityScores.push(record.realizedQualityScore);
    if (record?.fewCandleOutcome) {
      row._fewCandleCorrect.push(record.fewCandleOutcome.fewCandleCorrect ? 1 : 0);
      row._sustainedCorrect.push(record.fewCandleOutcome.sustainedCorrect ? 1 : 0);
      if (Number.isFinite(Number(record?.fewCandleOutcome?.score))) row._fewCandleQualityScores.push(record.fewCandleOutcome.score);
    }
    if (tenureOutcome && !tenureOutcome.zeroWindow) {
      if (Number.isFinite(Number(tenureOutcome.tenurePct))) row._tenurePct.push(tenureOutcome.tenurePct);
      row._majorityCorrect.push(tenureOutcome.majorityCorrect ? 1 : 0);
    }
  }

  return Array.from(rows.values()).map((row) => ({
    bucketKey: row.bucketKey,
    bucketLabel: row.bucketLabel,
    lower: row.lower,
    upper: row.upper,
    count: row.count,
    lowConfidence: row.count < MIN_BUCKET_SAMPLE,
    guidanceRatePct: row.count ? round((row._guidanceCorrect.reduce((sum, value) => sum + value, 0) / row.count) * 100, 1) : null,
    meanExcursionEdgeBps: mean(row._edgeBps, 2),
    meanExcursionEdgeAtr: mean(row._edgeAtr, 3),
    meanCloseReturnBps: mean(row._closeBps, 2),
    meanCloseReturnAtr: mean(row._closeAtr, 3),
    meanMfeBps: mean(row._mfeBps, 2),
    meanMfeAtr: mean(row._mfeAtr, 3),
    meanMaeBps: mean(row._maeBps, 2),
    meanMaeAtr: mean(row._maeAtr, 3),
    meanScore: mean(row._scores, 3),
    meanRealizedQualityScore: mean(row._realizedQualityScores, 3),
    meanStayedRightPct: mean(row._tenurePct, 1),
    majorityCorrectRatePct: row._majorityCorrect?.length
      ? round((row._majorityCorrect.reduce((sum, value) => sum + value, 0) / row._majorityCorrect.length) * 100, 1)
      : null,
    fewCandleCorrectRatePct: row._fewCandleCorrect?.length
      ? round((row._fewCandleCorrect.reduce((sum, value) => sum + value, 0) / row._fewCandleCorrect.length) * 100, 1)
      : null,
    sustainedCorrectRatePct: row._sustainedCorrect?.length
      ? round((row._sustainedCorrect.reduce((sum, value) => sum + value, 0) / row._sustainedCorrect.length) * 100, 1)
      : null,
    meanFewCandleQualityScore: mean(row._fewCandleQualityScores, 3),
  }));
}

function buildBucketEvaluation(rows = []) {
  const qualified = (Array.isArray(rows) ? rows : []).filter((row) => (row.count || 0) >= MIN_BUCKET_SAMPLE);
  if (qualified.length < 2) {
    return {
      status: "insufficient",
      qualifiedBucketCount: qualified.length,
      monotonicityPct: null,
      guidanceMonotonicityPct: null,
      edgeMonotonicityPct: null,
      qualityMonotonicityPct: null,
      topBottomGuidanceLiftPct: null,
      topBottomEdgeLift: null,
      topBottomCloseLift: null,
      topBottomStayedRightLiftPct: null,
      topBottomQualityLift: null,
      weightedMeanEdgeAtr: mean(qualified.map((row) => row.meanExcursionEdgeAtr), 3),
      weightedMeanCloseReturnAtr: mean(qualified.map((row) => row.meanCloseReturnAtr), 3),
      weightedMeanStayedRightPct: mean(qualified.map((row) => row.meanStayedRightPct), 1),
      weightedMeanRealizedQualityScore: mean(qualified.map((row) => row.meanRealizedQualityScore), 3),
    };
  }

  let monotonicGuidancePairs = 0;
  let monotonicEdgePairs = 0;
  let monotonicQualityPairs = 0;
  for (let index = 1; index < qualified.length; index += 1) {
    if ((Number(qualified[index].guidanceRatePct) || 0) >= (Number(qualified[index - 1].guidanceRatePct) || 0)) {
      monotonicGuidancePairs += 1;
    }
    if ((Number(qualified[index].meanExcursionEdgeAtr) || 0) >= (Number(qualified[index - 1].meanExcursionEdgeAtr) || 0)) {
      monotonicEdgePairs += 1;
    }
    if ((Number(qualified[index].meanRealizedQualityScore) || 0) >= (Number(qualified[index - 1].meanRealizedQualityScore) || 0)) {
      monotonicQualityPairs += 1;
    }
  }

  const pairCount = Math.max(qualified.length - 1, 1);
  const top = qualified[qualified.length - 1];
  const bottom = qualified[0];
  const weightedEdgeNumerator = qualified.reduce((sum, row) => sum + (Number(row.meanExcursionEdgeAtr) || 0) * row.count, 0);
  const weightedCloseNumerator = qualified.reduce((sum, row) => sum + (Number(row.meanCloseReturnAtr) || 0) * row.count, 0);
  const weightedStayedRightNumerator = qualified.reduce((sum, row) => sum + (Number(row.meanStayedRightPct) || 0) * row.count, 0);
  const weightedQualityNumerator = qualified.reduce((sum, row) => sum + (Number(row.meanRealizedQualityScore) || 0) * row.count, 0);
  const weightedEdgeDenominator = qualified.reduce((sum, row) => sum + row.count, 0);

  return {
    status: "ready",
    qualifiedBucketCount: qualified.length,
    monotonicityPct: round((((monotonicGuidancePairs + monotonicEdgePairs + monotonicQualityPairs) / (pairCount * 3)) * 100), 1),
    guidanceMonotonicityPct: round((monotonicGuidancePairs / pairCount) * 100, 1),
    edgeMonotonicityPct: round((monotonicEdgePairs / pairCount) * 100, 1),
    qualityMonotonicityPct: round((monotonicQualityPairs / pairCount) * 100, 1),
    topBottomGuidanceLiftPct: round((Number(top.guidanceRatePct) || 0) - (Number(bottom.guidanceRatePct) || 0), 1),
    topBottomEdgeLift: round((Number(top.meanExcursionEdgeAtr) || 0) - (Number(bottom.meanExcursionEdgeAtr) || 0), 3),
    topBottomCloseLift: round((Number(top.meanCloseReturnAtr) || 0) - (Number(bottom.meanCloseReturnAtr) || 0), 3),
    topBottomStayedRightLiftPct: round((Number(top.meanStayedRightPct) || 0) - (Number(bottom.meanStayedRightPct) || 0), 1),
    topBottomQualityLift: round((Number(top.meanRealizedQualityScore) || 0) - (Number(bottom.meanRealizedQualityScore) || 0), 3),
    weightedMeanEdgeAtr: weightedEdgeDenominator > 0 ? round(weightedEdgeNumerator / weightedEdgeDenominator, 3) : null,
    weightedMeanCloseReturnAtr: weightedEdgeDenominator > 0 ? round(weightedCloseNumerator / weightedEdgeDenominator, 3) : null,
    weightedMeanStayedRightPct: weightedEdgeDenominator > 0 ? round(weightedStayedRightNumerator / weightedEdgeDenominator, 1) : null,
    weightedMeanRealizedQualityScore: weightedEdgeDenominator > 0 ? round(weightedQualityNumerator / weightedEdgeDenominator, 3) : null,
  };
}

function aggregateScoreTypeEvaluations(evaluations = []) {
  const ready = (Array.isArray(evaluations) ? evaluations : []).filter((evaluation) => evaluation?.status === "ready");
  if (!ready.length) {
    return { status: "insufficient" };
  }
  return {
    status: "ready",
    qualifiedBucketCount: Math.min(...ready.map((evaluation) => Number(evaluation?.qualifiedBucketCount) || 0)),
    monotonicityPct: mean(ready.map((evaluation) => evaluation?.monotonicityPct), 1),
    guidanceMonotonicityPct: mean(ready.map((evaluation) => evaluation?.guidanceMonotonicityPct), 1),
    edgeMonotonicityPct: mean(ready.map((evaluation) => evaluation?.edgeMonotonicityPct), 1),
    qualityMonotonicityPct: mean(ready.map((evaluation) => evaluation?.qualityMonotonicityPct), 1),
    topBottomGuidanceLiftPct: mean(ready.map((evaluation) => evaluation?.topBottomGuidanceLiftPct), 1),
    topBottomEdgeLift: mean(ready.map((evaluation) => evaluation?.topBottomEdgeLift), 3),
    topBottomCloseLift: mean(ready.map((evaluation) => evaluation?.topBottomCloseLift), 3),
    topBottomStayedRightLiftPct: mean(ready.map((evaluation) => evaluation?.topBottomStayedRightLiftPct), 1),
    topBottomQualityLift: mean(ready.map((evaluation) => evaluation?.topBottomQualityLift), 3),
    weightedMeanEdgeAtr: mean(ready.map((evaluation) => evaluation?.weightedMeanEdgeAtr), 3),
    weightedMeanCloseReturnAtr: mean(ready.map((evaluation) => evaluation?.weightedMeanCloseReturnAtr), 3),
    weightedMeanStayedRightPct: mean(ready.map((evaluation) => evaluation?.weightedMeanStayedRightPct), 1),
    weightedMeanRealizedQualityScore: mean(ready.map((evaluation) => evaluation?.weightedMeanRealizedQualityScore), 3),
  };
}

function buildForwardPreferenceComparison(horizonSummaries = {}) {
  const rawEvaluation = aggregateScoreTypeEvaluations(
    FORWARD_PREFERENCE_HORIZONS.map((horizonKey) => horizonSummaries?.[horizonKey]?.raw?.evaluation),
  );
  const finalEvaluation = aggregateScoreTypeEvaluations(
    FORWARD_PREFERENCE_HORIZONS.map((horizonKey) => horizonSummaries?.[horizonKey]?.final?.evaluation),
  );
  return buildScoreTypeComparison(rawEvaluation, finalEvaluation);
}

function buildScoreTypeComparison(rawEvaluation, finalEvaluation) {
  if (rawEvaluation?.status !== "ready" && finalEvaluation?.status !== "ready") {
    return {
      winner: "tie",
      status: "insufficient",
      headline: "Not enough qualified score buckets to recommend a raw-vs-final switch yet.",
    };
  }

  const rawMonotonicity = Number(rawEvaluation?.monotonicityPct) || 0;
  const finalMonotonicity = Number(finalEvaluation?.monotonicityPct) || 0;
  const rawGuidanceLift = Number(rawEvaluation?.topBottomGuidanceLiftPct) || 0;
  const finalGuidanceLift = Number(finalEvaluation?.topBottomGuidanceLiftPct) || 0;
  const rawEdgeLift = Number(rawEvaluation?.topBottomEdgeLift) || 0;
  const finalEdgeLift = Number(finalEvaluation?.topBottomEdgeLift) || 0;
  const rawQualityMonotonicity = Number(rawEvaluation?.qualityMonotonicityPct) || 0;
  const finalQualityMonotonicity = Number(finalEvaluation?.qualityMonotonicityPct) || 0;
  const rawQualityLift = Number(rawEvaluation?.topBottomQualityLift) || 0;
  const finalQualityLift = Number(finalEvaluation?.topBottomQualityLift) || 0;

  const finalClearlyBetter = (
    finalMonotonicity - rawMonotonicity >= MATERIAL_MONOTONICITY_DELTA
    || finalGuidanceLift - rawGuidanceLift >= MATERIAL_HIT_DELTA
    || finalEdgeLift - rawEdgeLift >= MATERIAL_ATR_DELTA
    || finalQualityMonotonicity - rawQualityMonotonicity >= MATERIAL_MONOTONICITY_DELTA
    || finalQualityLift - rawQualityLift >= MATERIAL_REALIZED_QUALITY_DELTA
  );
  const rawClearlyBetter = (
    rawMonotonicity - finalMonotonicity >= MATERIAL_MONOTONICITY_DELTA
    || rawGuidanceLift - finalGuidanceLift >= MATERIAL_HIT_DELTA
    || rawEdgeLift - finalEdgeLift >= MATERIAL_ATR_DELTA
    || rawQualityMonotonicity - finalQualityMonotonicity >= MATERIAL_MONOTONICITY_DELTA
    || rawQualityLift - finalQualityLift >= MATERIAL_REALIZED_QUALITY_DELTA
  );

  if (finalClearlyBetter && !rawClearlyBetter) {
    return {
      winner: "final",
      status: "material",
      headline: "Final score ranks realized multi-horizon quality better than rawScore.",
    };
  }
  if (rawClearlyBetter && !finalClearlyBetter) {
    return {
      winner: "raw",
      status: "material",
      headline: "rawScore ranks realized multi-horizon quality better than final score.",
    };
  }
  return {
    winner: "tie",
    status: "neutral",
    headline: "rawScore and final score are directionally similar on realized multi-horizon quality.",
  };
}

function buildTenureBucketRows(records = [], scoreKey = "finalScore", horizonKey = RAYALGO_SCORE_STUDY_HEADLINE_HORIZON) {
  const rows = new Map(RAYALGO_SCORE_STUDY_BUCKETS.map((bucket) => [bucket.key, {
    ...buildEmptyBucketRow(bucket),
    zeroWindowCount: 0,
  }]));
  for (const record of Array.isArray(records) ? records : []) {
    const score = Number(record?.[scoreKey]);
    const outcome = record?.tenureOutcomes?.[horizonKey];
    if (!Number.isFinite(score) || !outcome) {
      continue;
    }
    const bucket = resolveBucket(score);
    const row = rows.get(bucket.key);
    if (outcome.zeroWindow) {
      row.zeroWindowCount = (row.zeroWindowCount || 0) + 1;
      continue;
    }
    row.count += 1;
    row._scores = row._scores || [];
    row._tenurePct = row._tenurePct || [];
    row._majority = row._majority || [];
    row._eligibleBars = row._eligibleBars || [];
    row._contrarianStops = row._contrarianStops || [];
    row._barsUntilContrarian = row._barsUntilContrarian || [];
    row._realizedQualityScores = row._realizedQualityScores || [];
    row._scores.push(score);
    row._tenurePct.push(outcome.tenurePct);
    row._majority.push(outcome.majorityCorrect ? 1 : 0);
    row._eligibleBars.push(outcome.eligibleBars);
    row._contrarianStops.push(outcome.endedByContrarian ? 1 : 0);
    if (Number.isFinite(Number(outcome.barsUntilContrarian))) {
      row._barsUntilContrarian.push(outcome.barsUntilContrarian);
    }
    if (Number.isFinite(Number(record?.realizedQualityScore))) row._realizedQualityScores.push(record.realizedQualityScore);
  }

  return Array.from(rows.values()).map((row) => ({
    bucketKey: row.bucketKey,
    bucketLabel: row.bucketLabel,
    lower: row.lower,
    upper: row.upper,
    count: row.count,
    zeroWindowCount: row.zeroWindowCount || 0,
    lowConfidence: row.count < MIN_BUCKET_SAMPLE,
    majorityCorrectRatePct: row.count ? round((row._majority.reduce((sum, value) => sum + value, 0) / row.count) * 100, 1) : null,
    meanTenurePct: mean(row._tenurePct, 1),
    meanEligibleBars: mean(row._eligibleBars, 2),
    contrarianStopRatePct: row.count ? round((row._contrarianStops.reduce((sum, value) => sum + value, 0) / row.count) * 100, 1) : null,
    meanBarsUntilContrarian: mean(row._barsUntilContrarian, 2),
    meanScore: mean(row._scores, 3),
    meanRealizedQualityScore: mean(row._realizedQualityScores, 3),
  }));
}

function buildTenureBucketEvaluation(rows = []) {
  const qualified = (Array.isArray(rows) ? rows : []).filter((row) => (row.count || 0) >= MIN_BUCKET_SAMPLE);
  if (qualified.length < 2) {
    return {
      status: "insufficient",
      qualifiedBucketCount: qualified.length,
      monotonicityPct: null,
      majorityMonotonicityPct: null,
      tenureMonotonicityPct: null,
      qualityMonotonicityPct: null,
      topBottomMajorityLiftPct: null,
      topBottomTenureLiftPct: null,
      topBottomQualityLift: null,
      weightedMeanTenurePct: mean(qualified.map((row) => row.meanTenurePct), 1),
      weightedMeanRealizedQualityScore: mean(qualified.map((row) => row.meanRealizedQualityScore), 3),
    };
  }

  let monotonicMajorityPairs = 0;
  let monotonicTenurePairs = 0;
  let monotonicQualityPairs = 0;
  for (let index = 1; index < qualified.length; index += 1) {
    if ((Number(qualified[index].majorityCorrectRatePct) || 0) >= (Number(qualified[index - 1].majorityCorrectRatePct) || 0)) {
      monotonicMajorityPairs += 1;
    }
    if ((Number(qualified[index].meanTenurePct) || 0) >= (Number(qualified[index - 1].meanTenurePct) || 0)) {
      monotonicTenurePairs += 1;
    }
    if ((Number(qualified[index].meanRealizedQualityScore) || 0) >= (Number(qualified[index - 1].meanRealizedQualityScore) || 0)) {
      monotonicQualityPairs += 1;
    }
  }

  const pairCount = Math.max(qualified.length - 1, 1);
  const top = qualified[qualified.length - 1];
  const bottom = qualified[0];
  const weightedTenureNumerator = qualified.reduce((sum, row) => sum + (Number(row.meanTenurePct) || 0) * row.count, 0);
  const weightedQualityNumerator = qualified.reduce((sum, row) => sum + (Number(row.meanRealizedQualityScore) || 0) * row.count, 0);
  const weightedTenureDenominator = qualified.reduce((sum, row) => sum + row.count, 0);

  return {
    status: "ready",
    qualifiedBucketCount: qualified.length,
    monotonicityPct: round((((monotonicMajorityPairs + monotonicTenurePairs + monotonicQualityPairs) / (pairCount * 3)) * 100), 1),
    majorityMonotonicityPct: round((monotonicMajorityPairs / pairCount) * 100, 1),
    tenureMonotonicityPct: round((monotonicTenurePairs / pairCount) * 100, 1),
    qualityMonotonicityPct: round((monotonicQualityPairs / pairCount) * 100, 1),
    topBottomMajorityLiftPct: round((Number(top.majorityCorrectRatePct) || 0) - (Number(bottom.majorityCorrectRatePct) || 0), 1),
    topBottomTenureLiftPct: round((Number(top.meanTenurePct) || 0) - (Number(bottom.meanTenurePct) || 0), 1),
    topBottomQualityLift: round((Number(top.meanRealizedQualityScore) || 0) - (Number(bottom.meanRealizedQualityScore) || 0), 3),
    weightedMeanTenurePct: weightedTenureDenominator > 0 ? round(weightedTenureNumerator / weightedTenureDenominator, 1) : null,
    weightedMeanRealizedQualityScore: weightedTenureDenominator > 0 ? round(weightedQualityNumerator / weightedTenureDenominator, 3) : null,
  };
}

function buildTenureScoreTypeComparison(rawEvaluation, finalEvaluation) {
  if (rawEvaluation?.status !== "ready" && finalEvaluation?.status !== "ready") {
    return {
      winner: "tie",
      status: "insufficient",
      headline: "Not enough qualified tenure buckets to recommend a raw-vs-final switch yet.",
    };
  }

  const rawMonotonicity = Number(rawEvaluation?.monotonicityPct) || 0;
  const finalMonotonicity = Number(finalEvaluation?.monotonicityPct) || 0;
  const rawMajorityLift = Number(rawEvaluation?.topBottomMajorityLiftPct) || 0;
  const finalMajorityLift = Number(finalEvaluation?.topBottomMajorityLiftPct) || 0;
  const rawTenureLift = Number(rawEvaluation?.topBottomTenureLiftPct) || 0;
  const finalTenureLift = Number(finalEvaluation?.topBottomTenureLiftPct) || 0;
  const rawQualityMonotonicity = Number(rawEvaluation?.qualityMonotonicityPct) || 0;
  const finalQualityMonotonicity = Number(finalEvaluation?.qualityMonotonicityPct) || 0;
  const rawQualityLift = Number(rawEvaluation?.topBottomQualityLift) || 0;
  const finalQualityLift = Number(finalEvaluation?.topBottomQualityLift) || 0;

  const finalClearlyBetter = (
    finalMonotonicity - rawMonotonicity >= MATERIAL_MONOTONICITY_DELTA
    || finalMajorityLift - rawMajorityLift >= MATERIAL_HIT_DELTA
    || finalTenureLift - rawTenureLift >= MATERIAL_ATR_DELTA * 100
    || finalQualityMonotonicity - rawQualityMonotonicity >= MATERIAL_MONOTONICITY_DELTA
    || finalQualityLift - rawQualityLift >= MATERIAL_REALIZED_QUALITY_DELTA
  );
  const rawClearlyBetter = (
    rawMonotonicity - finalMonotonicity >= MATERIAL_MONOTONICITY_DELTA
    || rawMajorityLift - finalMajorityLift >= MATERIAL_HIT_DELTA
    || rawTenureLift - finalTenureLift >= MATERIAL_ATR_DELTA * 100
    || rawQualityMonotonicity - finalQualityMonotonicity >= MATERIAL_MONOTONICITY_DELTA
    || rawQualityLift - finalQualityLift >= MATERIAL_REALIZED_QUALITY_DELTA
  );

  if (finalClearlyBetter && !rawClearlyBetter) {
    return {
      winner: "final",
      status: "material",
      headline: "Final score calibrates better than rawScore on realized quality and directional tenure.",
    };
  }
  if (rawClearlyBetter && !finalClearlyBetter) {
    return {
      winner: "raw",
      status: "material",
      headline: "rawScore calibrates better than final score on realized quality and directional tenure.",
    };
  }
  return {
    winner: "tie",
    status: "neutral",
    headline: "rawScore and final score are directionally similar on realized quality and directional tenure.",
  };
}

function summarizeThreshold(records = [], scoreKey = "finalScore", horizonKey = RAYALGO_SCORE_STUDY_HEADLINE_HORIZON, threshold = 0.6) {
  const below = [];
  const above = [];
  for (const record of Array.isArray(records) ? records : []) {
    const score = Number(record?.[scoreKey]);
    const outcome = record?.outcomes?.[horizonKey];
    if (!Number.isFinite(score) || !outcome) {
      continue;
    }
    if (score < threshold) {
      below.push(outcome);
    } else {
      above.push(outcome);
    }
  }
  const buildSummary = (outcomes = []) => ({
    count: outcomes.length,
    guidanceRatePct: outcomes.length ? round((outcomes.filter((outcome) => outcome.guidanceCorrect).length / outcomes.length) * 100, 1) : null,
    meanExcursionEdgeAtr: mean(outcomes.map((outcome) => outcome.excursionEdgeAtr), 3),
    meanCloseReturnAtr: mean(outcomes.map((outcome) => outcome.closeReturnAtr), 3),
  });
  return {
    threshold,
    below: buildSummary(below),
    above: buildSummary(above),
  };
}

function summarizeTenureThreshold(records = [], scoreKey = "finalScore", horizonKey = RAYALGO_SCORE_STUDY_HEADLINE_HORIZON, threshold = 0.6) {
  const below = [];
  const above = [];
  let belowZeroWindows = 0;
  let aboveZeroWindows = 0;
  for (const record of Array.isArray(records) ? records : []) {
    const score = Number(record?.[scoreKey]);
    const outcome = record?.tenureOutcomes?.[horizonKey];
    if (!Number.isFinite(score) || !outcome) {
      continue;
    }
    if (outcome.zeroWindow) {
      if (score < threshold) belowZeroWindows += 1;
      else aboveZeroWindows += 1;
      continue;
    }
    if (score < threshold) {
      below.push(outcome);
    } else {
      above.push(outcome);
    }
  }
  const buildSummary = (outcomes = [], zeroWindowCount = 0) => ({
    count: outcomes.length,
    zeroWindowCount,
    majorityCorrectRatePct: outcomes.length ? round((outcomes.filter((outcome) => outcome.majorityCorrect).length / outcomes.length) * 100, 1) : null,
    meanTenurePct: mean(outcomes.map((outcome) => outcome.tenurePct), 1),
    meanEligibleBars: mean(outcomes.map((outcome) => outcome.eligibleBars), 2),
    contrarianStopRatePct: outcomes.length ? round((outcomes.filter((outcome) => outcome.endedByContrarian).length / outcomes.length) * 100, 1) : null,
  });
  return {
    threshold,
    below: buildSummary(below, belowZeroWindows),
    above: buildSummary(above, aboveZeroWindows),
  };
}

function summarizeQualityThreshold(records = [], scoreKey = "finalScore", threshold = 0.55) {
  const usableRecords = (Array.isArray(records) ? records : []).filter((record) => (
    Number.isFinite(Number(record?.[scoreKey]))
    && Number.isFinite(Number(record?.realizedQualityScore))
  ));
  const below = [];
  const above = [];
  for (const record of usableRecords) {
    if (Number(record?.[scoreKey]) < threshold) {
      below.push(record);
    } else {
      above.push(record);
    }
  }

  const buildSummary = (subset = []) => {
    const forwardOutcomes = subset
      .map((record) => record?.outcomes?.[RAYALGO_SCORE_STUDY_HEADLINE_HORIZON])
      .filter((outcome) => outcome && !outcome.zeroWindow);
    const tenureOutcomes = subset
      .map((record) => record?.tenureOutcomes?.[RAYALGO_SCORE_STUDY_HEADLINE_HORIZON])
      .filter((outcome) => outcome && !outcome.zeroWindow);
    const fewCandle = summarizeFewCandleMetrics(subset);
    return {
      count: subset.length,
      coveragePct: usableRecords.length ? round((subset.length / usableRecords.length) * 100, 1) : null,
      meanPredictedScore: mean(subset.map((record) => record?.[scoreKey]), 3),
      meanPredictedFinalScore: mean(subset.map((record) => record?.finalScore), 3),
      meanPredictedRawScore: mean(subset.map((record) => record?.rawScore), 3),
      meanRealizedQualityScore: mean(subset.map((record) => record?.realizedQualityScore), 3),
      guidanceRatePct: forwardOutcomes.length
        ? round((forwardOutcomes.filter((outcome) => outcome.guidanceCorrect).length / forwardOutcomes.length) * 100, 1)
        : null,
      meanExcursionEdgeAtr: mean(forwardOutcomes.map((outcome) => outcome.excursionEdgeAtr), 3),
      meanCloseReturnAtr: mean(forwardOutcomes.map((outcome) => outcome.closeReturnAtr), 3),
      majorityCorrectRatePct: tenureOutcomes.length
        ? round((tenureOutcomes.filter((outcome) => outcome.majorityCorrect).length / tenureOutcomes.length) * 100, 1)
        : null,
      meanTenurePct: mean(tenureOutcomes.map((outcome) => outcome.tenurePct), 1),
      fewCandleCorrectRatePct: fewCandle.fewCandleCorrectRatePct,
      sustainedCorrectRatePct: fewCandle.sustainedCorrectRatePct,
      meanFewCandleQualityScore: fewCandle.meanFewCandleQualityScore,
    };
  };

  const baseline = buildSummary(usableRecords);
  const withLift = (summary) => ({
    ...summary,
    realizedQualityLift: Number.isFinite(Number(summary?.meanRealizedQualityScore)) && Number.isFinite(Number(baseline?.meanRealizedQualityScore))
      ? round(summary.meanRealizedQualityScore - baseline.meanRealizedQualityScore, 3)
      : null,
    guidanceLiftPct: Number.isFinite(Number(summary?.guidanceRatePct)) && Number.isFinite(Number(baseline?.guidanceRatePct))
      ? round(summary.guidanceRatePct - baseline.guidanceRatePct, 1)
      : null,
    excursionEdgeLiftAtr: Number.isFinite(Number(summary?.meanExcursionEdgeAtr)) && Number.isFinite(Number(baseline?.meanExcursionEdgeAtr))
      ? round(summary.meanExcursionEdgeAtr - baseline.meanExcursionEdgeAtr, 3)
      : null,
    tenureLiftPct: Number.isFinite(Number(summary?.meanTenurePct)) && Number.isFinite(Number(baseline?.meanTenurePct))
      ? round(summary.meanTenurePct - baseline.meanTenurePct, 1)
      : null,
  });

  return {
    scoreKey,
    threshold,
    baseline,
    below: withLift(buildSummary(below)),
    above: withLift(buildSummary(above)),
  };
}

function buildPrecisionCoverageFrontier(records = [], scoreKey = "finalScore") {
  const usableRecords = (Array.isArray(records) ? records : []).filter((record) => (
    Number.isFinite(Number(record?.[scoreKey]))
    && record?.fewCandleOutcome
  ));
  if (usableRecords.length < MIN_RECOMMENDATION_SAMPLE) {
    return {
      status: "insufficient",
      scoreKey,
      targetFewCandleCorrectRatePct: FEW_CANDLE_TARGET_RATE_PCT,
      headline: "Not enough scored signals to evaluate a few-candle precision frontier yet.",
      tiers: [],
      targetTier: null,
      bestFewCandleTier: null,
      bestSustainedTier: null,
    };
  }

  const ranked = [...usableRecords].sort((left, right) => {
    const scoreDelta = (Number(right?.[scoreKey]) || 0) - (Number(left?.[scoreKey]) || 0);
    if (Math.abs(scoreDelta) > 1e-9) {
      return scoreDelta;
    }
    return (Number(right?.realizedQualityScore) || 0) - (Number(left?.realizedQualityScore) || 0);
  });
  const tiers = SCORE_COVERAGE_FRONTIER_TIERS
    .map((tier) => {
      const subsetCount = Math.max(1, Math.round(ranked.length * tier.coverageRatio));
      const subset = ranked.slice(0, subsetCount);
      const thresholdScore = subset.length ? round(subset[subset.length - 1]?.[scoreKey], 3) : null;
      const forward3 = subset.map((record) => record?.outcomes?.[FEW_CANDLE_GUIDANCE_HORIZON]).filter((outcome) => outcome && !outcome.zeroWindow);
      const forward6 = subset.map((record) => record?.outcomes?.[SUSTAINED_GUIDANCE_HORIZON]).filter((outcome) => outcome && !outcome.zeroWindow);
      const fewCandle = summarizeFewCandleMetrics(subset);
      return {
        key: tier.key,
        label: tier.label,
        scoreKey,
        count: subset.length,
        coveragePct: round((subset.length / ranked.length) * 100, 1),
        thresholdScore,
        meanPredictedScore: mean(subset.map((record) => record?.[scoreKey]), 3),
        meanPredictedFinalScore: mean(subset.map((record) => record?.finalScore), 3),
        meanPredictedRawScore: mean(subset.map((record) => record?.rawScore), 3),
        meanRealizedQualityScore: mean(subset.map((record) => record?.realizedQualityScore), 3),
        guidance3xRatePct: forward3.length
          ? round((forward3.filter((outcome) => outcome.guidanceCorrect).length / forward3.length) * 100, 1)
          : null,
        guidance6xRatePct: forward6.length
          ? round((forward6.filter((outcome) => outcome.guidanceCorrect).length / forward6.length) * 100, 1)
          : null,
        meanExcursionEdgeAtr3x: mean(forward3.map((outcome) => outcome.excursionEdgeAtr), 3),
        meanExcursionEdgeAtr6x: mean(forward6.map((outcome) => outcome.excursionEdgeAtr), 3),
        fewCandleCorrectRatePct: fewCandle.fewCandleCorrectRatePct,
        sustainedCorrectRatePct: fewCandle.sustainedCorrectRatePct,
        meanFewCandleQualityScore: fewCandle.meanFewCandleQualityScore,
      };
    })
    .filter((tier) => tier.count >= MIN_RECOMMENDATION_SAMPLE);

  if (!tiers.length) {
    return {
      status: "insufficient",
      scoreKey,
      targetFewCandleCorrectRatePct: FEW_CANDLE_TARGET_RATE_PCT,
      headline: "Coverage tiers are too small to evaluate a few-candle precision frontier yet.",
      tiers: [],
      targetTier: null,
      bestFewCandleTier: null,
      bestSustainedTier: null,
    };
  }

  const targetTier = tiers
    .filter((tier) => (Number(tier?.fewCandleCorrectRatePct) || 0) >= FEW_CANDLE_TARGET_RATE_PCT)
    .sort((left, right) => {
      const coverageDelta = (Number(right.coveragePct) || 0) - (Number(left.coveragePct) || 0);
      if (Math.abs(coverageDelta) > 1e-9) {
        return coverageDelta;
      }
      return (Number(right.fewCandleCorrectRatePct) || 0) - (Number(left.fewCandleCorrectRatePct) || 0);
    })[0] || null;
  const bestFewCandleTier = [...tiers].sort((left, right) => {
    const correctDelta = (Number(right.fewCandleCorrectRatePct) || 0) - (Number(left.fewCandleCorrectRatePct) || 0);
    if (Math.abs(correctDelta) > 1e-9) {
      return correctDelta;
    }
    return (Number(right.coveragePct) || 0) - (Number(left.coveragePct) || 0);
  })[0] || null;
  const bestSustainedTier = [...tiers].sort((left, right) => {
    const correctDelta = (Number(right.sustainedCorrectRatePct) || 0) - (Number(left.sustainedCorrectRatePct) || 0);
    if (Math.abs(correctDelta) > 1e-9) {
      return correctDelta;
    }
    return (Number(right.coveragePct) || 0) - (Number(left.coveragePct) || 0);
  })[0] || null;

  return {
    status: targetTier ? "target_reached" : "observe_only",
    scoreKey,
    targetFewCandleCorrectRatePct: FEW_CANDLE_TARGET_RATE_PCT,
    headline: targetTier
      ? `${targetTier.label} reaches ${targetTier.fewCandleCorrectRatePct}% few-candle correctness at ${targetTier.coveragePct}% coverage.`
      : `No evaluated score tier reaches ${FEW_CANDLE_TARGET_RATE_PCT}% few-candle correctness yet.`,
    tiers,
    targetTier,
    bestFewCandleTier,
    bestSustainedTier,
  };
}

function summarizeValidationWindow(records = [], horizonKey = "3x") {
  const outcomes = (Array.isArray(records) ? records : [])
    .map((record) => record?.outcomes?.[horizonKey])
    .filter((outcome) => outcome && !outcome.zeroWindow);
  if (!outcomes.length) {
    return {
      signalCount: 0,
      guidanceRatePct: null,
      originHoldRatePct: null,
      adverseBreakRatePct: null,
      cleanHoldRatePct: null,
      contrarianInvalidationRatePct: null,
      meanExcursionEdgeAtr: null,
      meanCloseReturnAtr: null,
      meanMaeAtr: null,
    };
  }
  const originHoldCount = outcomes.filter((outcome) => Number(outcome?.maeBps) >= 0).length;
  const cleanHoldCount = outcomes.filter((outcome) => (
    outcome?.guidanceCorrect
    && Number(outcome?.maeBps) >= 0
    && outcome?.endedByContrarian !== true
  )).length;
  const contrarianInvalidationCount = outcomes.filter((outcome) => outcome?.endedByContrarian).length;
  return {
    signalCount: outcomes.length,
    guidanceRatePct: round((outcomes.filter((outcome) => outcome.guidanceCorrect).length / outcomes.length) * 100, 1),
    originHoldRatePct: round((originHoldCount / outcomes.length) * 100, 1),
    adverseBreakRatePct: round(((outcomes.length - originHoldCount) / outcomes.length) * 100, 1),
    cleanHoldRatePct: round((cleanHoldCount / outcomes.length) * 100, 1),
    contrarianInvalidationRatePct: round((contrarianInvalidationCount / outcomes.length) * 100, 1),
    meanExcursionEdgeAtr: mean(outcomes.map((outcome) => outcome.excursionEdgeAtr), 3),
    meanCloseReturnAtr: mean(outcomes.map((outcome) => outcome.closeReturnAtr), 3),
    meanMaeAtr: mean(outcomes.map((outcome) => outcome.maeAtr), 3),
  };
}

function summarizeValidationWindows(records = [], horizonKeys = ["3x", "6x", "12x"]) {
  return Object.fromEntries(
    (Array.isArray(horizonKeys) ? horizonKeys : []).map((horizonKey) => [horizonKey, summarizeValidationWindow(records, horizonKey)]),
  );
}

function summarizeForwardSuccessWindow(records = [], horizonKey = "24x") {
  const forwardOutcomes = (Array.isArray(records) ? records : [])
    .map((record) => record?.outcomes?.[horizonKey])
    .filter((outcome) => outcome && !outcome.zeroWindow);
  const tenureOutcomes = (Array.isArray(records) ? records : [])
    .map((record) => record?.tenureOutcomes?.[horizonKey])
    .filter((outcome) => outcome && !outcome.zeroWindow);
  if (!forwardOutcomes.length) {
    return {
      signalCount: 0,
      guidanceRatePct: null,
      meanExcursionEdgeAtr: null,
      meanCloseReturnAtr: null,
      meanMfeAtr: null,
      meanMaeAtr: null,
      majorityCorrectRatePct: null,
      meanTenurePct: null,
      contrarianInvalidationRatePct: null,
    };
  }
  return {
    signalCount: forwardOutcomes.length,
    guidanceRatePct: round((forwardOutcomes.filter((outcome) => outcome.guidanceCorrect).length / forwardOutcomes.length) * 100, 1),
    meanExcursionEdgeAtr: mean(forwardOutcomes.map((outcome) => outcome.excursionEdgeAtr), 3),
    meanCloseReturnAtr: mean(forwardOutcomes.map((outcome) => outcome.closeReturnAtr), 3),
    meanMfeAtr: mean(forwardOutcomes.map((outcome) => outcome.mfeAtr), 3),
    meanMaeAtr: mean(forwardOutcomes.map((outcome) => outcome.maeAtr), 3),
    majorityCorrectRatePct: tenureOutcomes.length
      ? round((tenureOutcomes.filter((outcome) => outcome.majorityCorrect).length / tenureOutcomes.length) * 100, 1)
      : null,
    meanTenurePct: mean(tenureOutcomes.map((outcome) => outcome.tenurePct), 1),
    contrarianInvalidationRatePct: round((forwardOutcomes.filter((outcome) => outcome.endedByContrarian).length / forwardOutcomes.length) * 100, 1),
  };
}

function summarizeForwardSuccessWindows(records = [], horizonKeys = ["24x", "48x", "72x", "96x", "120x"]) {
  return Object.fromEntries(
    (Array.isArray(horizonKeys) ? horizonKeys : []).map((horizonKey) => [horizonKey, summarizeForwardSuccessWindow(records, horizonKey)]),
  );
}

function buildTrustAuditThresholdRows(records = [], scoreKey = "finalScore", thresholds = [0.5, 0.55, 0.6, 0.65]) {
  const usableRecords = (Array.isArray(records) ? records : []).filter((record) => Number.isFinite(Number(record?.[scoreKey])));
  const baselineValidation = summarizeValidationWindows(usableRecords);
  const baselineFewCandle = summarizeFewCandleMetrics(usableRecords);
  const baselineRealizedQuality = mean(usableRecords.map((record) => record?.realizedQualityScore), 3);
  return thresholds.map((threshold) => {
    const subset = usableRecords.filter((record) => Number(record?.[scoreKey]) >= threshold);
    const fewCandle = summarizeFewCandleMetrics(subset);
    const validation = summarizeValidationWindows(subset);
    const realizedQuality = mean(subset.map((record) => record?.realizedQualityScore), 3);
    return {
      threshold,
      count: subset.length,
      coveragePct: usableRecords.length ? round((subset.length / usableRecords.length) * 100, 1) : null,
      meanPredictedScore: mean(subset.map((record) => record?.[scoreKey]), 3),
      meanRealizedQualityScore: realizedQuality,
      realizedQualityLift: Number.isFinite(realizedQuality) && Number.isFinite(baselineRealizedQuality)
        ? round(realizedQuality - baselineRealizedQuality, 3)
        : null,
      fewCandleCorrectRatePct: fewCandle.fewCandleCorrectRatePct,
      fewCandleCorrectLiftPct: Number.isFinite(Number(fewCandle?.fewCandleCorrectRatePct)) && Number.isFinite(Number(baselineFewCandle?.fewCandleCorrectRatePct))
        ? round(fewCandle.fewCandleCorrectRatePct - baselineFewCandle.fewCandleCorrectRatePct, 1)
        : null,
      sustainedCorrectRatePct: fewCandle.sustainedCorrectRatePct,
      sustainedCorrectLiftPct: Number.isFinite(Number(fewCandle?.sustainedCorrectRatePct)) && Number.isFinite(Number(baselineFewCandle?.sustainedCorrectRatePct))
        ? round(fewCandle.sustainedCorrectRatePct - baselineFewCandle.sustainedCorrectRatePct, 1)
        : null,
      validation,
      baselineValidation,
    };
  }).filter((row) => row.count >= MIN_RECOMMENDATION_SAMPLE);
}

function buildForwardSuccessThresholdRows(records = [], scoreKey = "finalScore", thresholds = [0.5, 0.55, 0.6, 0.65]) {
  const usableRecords = (Array.isArray(records) ? records : []).filter((record) => Number.isFinite(Number(record?.[scoreKey])));
  const baselineForward = summarizeForwardSuccessWindows(usableRecords);
  const baselineRealizedQuality = mean(usableRecords.map((record) => record?.realizedQualityScore), 3);
  return thresholds.map((threshold) => {
    const subset = usableRecords.filter((record) => Number(record?.[scoreKey]) >= threshold);
    const forwardSuccess = summarizeForwardSuccessWindows(subset);
    const realizedQuality = mean(subset.map((record) => record?.realizedQualityScore), 3);
    return {
      threshold,
      count: subset.length,
      coveragePct: usableRecords.length ? round((subset.length / usableRecords.length) * 100, 1) : null,
      meanPredictedScore: mean(subset.map((record) => record?.[scoreKey]), 3),
      meanRealizedQualityScore: realizedQuality,
      realizedQualityLift: Number.isFinite(realizedQuality) && Number.isFinite(baselineRealizedQuality)
        ? round(realizedQuality - baselineRealizedQuality, 3)
        : null,
      forwardSuccess,
      baselineForward,
    };
  }).filter((row) => row.count >= MIN_RECOMMENDATION_SAMPLE);
}

function findFeatureStateSummary(featureImpactSummaries = null, featureKey = "", state = "") {
  const group = (featureImpactSummaries?.featureGroups || []).find((entry) => entry?.featureKey === featureKey);
  if (!group) {
    return null;
  }
  return (group.states || []).find((entry) => String(entry?.state) === String(state)) || null;
}

function buildSimpleBaselineComparisons(featureImpactSummaries = null) {
  const requested = [
    { featureKey: "regimeAligned", state: "yes", label: "Regime aligned" },
    { featureKey: "recentCross", state: "no", label: "Recent cross = no" },
    { featureKey: "freshCross", state: "yes", label: "Fresh cross" },
    { featureKey: "distanceToE21Bucket", state: "<5bps", label: "Near EMA21 (<5bps)" },
    { featureKey: "distanceToBandBasisBucket", state: "<5bps", label: "Near band basis (<5bps)" },
  ];
  return requested
    .map((candidate) => {
      const hit = findFeatureStateSummary(featureImpactSummaries, candidate.featureKey, candidate.state);
      return hit ? { ...candidate, ...hit } : null;
    })
    .filter((entry) => entry && !entry.lowConfidence)
    .sort((left, right) => {
      const qualityDelta = (Number(right?.realizedQualityLift) || 0) - (Number(left?.realizedQualityLift) || 0);
      if (Math.abs(qualityDelta) > 1e-9) return qualityDelta;
      return (Number(right?.fewCandleCorrectRatePct) || 0) - (Number(left?.fewCandleCorrectRatePct) || 0);
    });
}

function buildTrustAuditBucketSummary(rows = []) {
  const qualified = (Array.isArray(rows) ? rows : []).filter((row) => (Number(row?.count) || 0) >= MIN_BUCKET_SAMPLE);
  if (!qualified.length) {
    return {
      qualifiedBucketCount: 0,
      topBucket: null,
      bottomBucket: null,
      topBottomFewCandleLiftPct: null,
      topBottomSustainedLiftPct: null,
      topBottomMaeLiftAtr: null,
    };
  }
  const topBucket = qualified[qualified.length - 1];
  const bottomBucket = qualified[0];
  return {
    qualifiedBucketCount: qualified.length,
    topBucket,
    bottomBucket,
    topBottomFewCandleLiftPct: round((Number(topBucket?.fewCandleCorrectRatePct) || 0) - (Number(bottomBucket?.fewCandleCorrectRatePct) || 0), 1),
    topBottomSustainedLiftPct: round((Number(topBucket?.sustainedCorrectRatePct) || 0) - (Number(bottomBucket?.sustainedCorrectRatePct) || 0), 1),
    topBottomMaeLiftAtr: round((Number(topBucket?.meanMaeAtr) || 0) - (Number(bottomBucket?.meanMaeAtr) || 0), 3),
  };
}

function buildEntryIntegrityVerdict({
  bucketEvaluation = null,
  bucketSummary = null,
  bestTier = null,
  bestThreshold = null,
} = {}) {
  const monotonicityPct = Number(bucketEvaluation?.monotonicityPct) || 0;
  const qualityLift = Number(bucketEvaluation?.topBottomQualityLift) || 0;
  const fewCandleLiftPct = Number(bucketSummary?.topBottomFewCandleLiftPct) || 0;
  const bestTierFewLift = Number(bestTier?.fewCandleCorrectLiftPct) || 0;
  const bestThresholdFewLift = Number(bestThreshold?.fewCandleCorrectLiftPct) || 0;
  const bestTierQualityLift = Number(bestTier?.realizedQualityLift) || 0;
  const bestThresholdQualityLift = Number(bestThreshold?.realizedQualityLift) || 0;

  if (
    monotonicityPct >= 75
    && qualityLift >= 0.06
    && (fewCandleLiftPct >= 8 || bestTierFewLift >= 8 || bestThresholdFewLift >= 8)
    && (bestTierQualityLift >= 0.04 || bestThresholdQualityLift >= 0.04)
  ) {
    return {
      status: "trustworthy",
      headline: "The score is showing strong calibration and meaningful early-validity separation.",
    };
  }
  if (
    monotonicityPct >= 60
    && qualityLift >= 0.03
    && (fewCandleLiftPct >= 3 || bestTierFewLift >= 3 || bestThresholdFewLift >= 3)
  ) {
    return {
      status: "promising_but_not_trusted",
      headline: "The score is directionally helpful, but the separation is still too weak to trust as a hard filter.",
    };
  }
  return {
    status: "not_trustworthy_yet",
      headline: "The score is not separating strong trend-change signals clearly enough yet.",
  };
}

function buildForwardSuccessVerdict({
  bucketEvaluation = null,
  bestTier = null,
  bestThreshold = null,
} = {}) {
  const monotonicityPct = Number(bucketEvaluation?.monotonicityPct) || 0;
  const qualityLift = Number(bucketEvaluation?.topBottomQualityLift) || 0;
  const edgeLift = Number(bucketEvaluation?.topBottomEdgeLift) || 0;
  const bestTierQualityLift = Number(bestTier?.realizedQualityLift) || 0;
  const bestThresholdQualityLift = Number(bestThreshold?.realizedQualityLift) || 0;
  if (
    monotonicityPct >= 70
    && qualityLift >= 0.05
    && edgeLift >= 0.12
    && (bestTierQualityLift >= 0.04 || bestThresholdQualityLift >= 0.04)
  ) {
    return {
      status: "trustworthy",
      headline: "The score is separating stronger forward opportunities well enough to trust.",
    };
  }
  if (
    monotonicityPct >= 55
    && qualityLift >= 0.02
    && edgeLift >= 0.05
  ) {
    return {
      status: "promising_but_not_trusted",
      headline: "The score shows some forward-opportunity ranking value, but not enough to trust yet.",
    };
  }
  return {
    status: "not_trustworthy_yet",
    headline: "The score is not separating stronger forward opportunities clearly enough yet.",
  };
}

function buildScoreTrustAudit(records = [], {
  preferredScoreKey = "finalScore",
  forwardStudy = null,
  featureImpactSummaries = null,
  precisionCoverageFrontier = null,
} = {}) {
  const usableRecords = Array.isArray(records) ? records : [];
  const bucketRows = forwardStudy?.bucketTables?.[preferredScoreKey === "rawScore" ? "raw" : preferredScoreKey === "effectiveScore" ? "effective" : "final"]?.rows
    || buildBucketRows(usableRecords, preferredScoreKey, RAYALGO_SCORE_STUDY_HEADLINE_HORIZON);
  const bucketEvaluation = forwardStudy?.bucketTables?.[preferredScoreKey === "rawScore" ? "raw" : preferredScoreKey === "effectiveScore" ? "effective" : "final"]?.evaluation
    || buildBucketEvaluation(bucketRows);
  const bucketSummary = buildTrustAuditBucketSummary(bucketRows);
  const entryIntegrity = {
    baseline: summarizeValidationWindows(usableRecords),
    thresholds: buildTrustAuditThresholdRows(usableRecords, preferredScoreKey),
    frontierTiers: (precisionCoverageFrontier?.tiers || []).map((tier) => {
      const summary = summarizeQualityThreshold(usableRecords, preferredScoreKey, tier?.thresholdScore);
      return {
        tierKey: tier?.key || null,
        label: tier?.label || null,
        thresholdScore: tier?.thresholdScore ?? null,
        coveragePct: tier?.coveragePct ?? null,
        meanRealizedQualityScore: tier?.meanRealizedQualityScore ?? null,
        realizedQualityLift: summary?.above?.realizedQualityLift ?? null,
        fewCandleCorrectRatePct: tier?.fewCandleCorrectRatePct ?? null,
        fewCandleCorrectLiftPct: summary?.above?.fewCandleCorrectRatePct != null && summary?.baseline?.fewCandleCorrectRatePct != null
          ? round(summary.above.fewCandleCorrectRatePct - summary.baseline.fewCandleCorrectRatePct, 1)
          : null,
        sustainedCorrectRatePct: tier?.sustainedCorrectRatePct ?? null,
        sustainedCorrectLiftPct: summary?.above?.sustainedCorrectRatePct != null && summary?.baseline?.sustainedCorrectRatePct != null
          ? round(summary.above.sustainedCorrectRatePct - summary.baseline.sustainedCorrectRatePct, 1)
          : null,
      };
    }),
  };
  const forwardSuccess = {
    baseline: summarizeForwardSuccessWindows(usableRecords),
    thresholds: buildForwardSuccessThresholdRows(usableRecords, preferredScoreKey),
    frontierTiers: (precisionCoverageFrontier?.tiers || []).map((tier) => {
      const summary = summarizeQualityThreshold(usableRecords, preferredScoreKey, tier?.thresholdScore);
      const subset = usableRecords.filter((record) => Number(record?.[preferredScoreKey]) >= Number(tier?.thresholdScore));
      return {
        tierKey: tier?.key || null,
        label: tier?.label || null,
        thresholdScore: tier?.thresholdScore ?? null,
        coveragePct: tier?.coveragePct ?? null,
        meanRealizedQualityScore: tier?.meanRealizedQualityScore ?? null,
        realizedQualityLift: summary?.above?.realizedQualityLift ?? null,
        windows: summarizeForwardSuccessWindows(subset),
      };
    }),
  };
  const longRecords = filterRecordsByDirection(usableRecords, "long");
  const shortRecords = filterRecordsByDirection(usableRecords, "short");
  const longValidation = summarizeValidationWindows(longRecords);
  const shortValidation = summarizeValidationWindows(shortRecords);
  const longForwardSuccess = summarizeForwardSuccessWindows(longRecords);
  const shortForwardSuccess = summarizeForwardSuccessWindows(shortRecords);
  const simpleBaselines = buildSimpleBaselineComparisons(featureImpactSummaries);
  const bestEntryTier = [...(entryIntegrity.frontierTiers || [])].sort((left, right) => {
    const fewDelta = (Number(right?.fewCandleCorrectLiftPct) || 0) - (Number(left?.fewCandleCorrectLiftPct) || 0);
    if (Math.abs(fewDelta) > 1e-9) return fewDelta;
    return (Number(right?.realizedQualityLift) || 0) - (Number(left?.realizedQualityLift) || 0);
  })[0] || null;
  const bestEntryThreshold = [...(entryIntegrity.thresholds || [])].sort((left, right) => {
    const fewDelta = (Number(right?.fewCandleCorrectLiftPct) || 0) - (Number(left?.fewCandleCorrectLiftPct) || 0);
    if (Math.abs(fewDelta) > 1e-9) return fewDelta;
    return (Number(right?.realizedQualityLift) || 0) - (Number(left?.realizedQualityLift) || 0);
  })[0] || null;
  const bestForwardTier = [...(forwardSuccess.frontierTiers || [])].sort((left, right) => {
    const qualityDelta = (Number(right?.realizedQualityLift) || 0) - (Number(left?.realizedQualityLift) || 0);
    if (Math.abs(qualityDelta) > 1e-9) return qualityDelta;
    return (Number(right?.windows?.["72x"]?.meanExcursionEdgeAtr) || 0) - (Number(left?.windows?.["72x"]?.meanExcursionEdgeAtr) || 0);
  })[0] || null;
  const bestForwardThreshold = [...(forwardSuccess.thresholds || [])].sort((left, right) => {
    const qualityDelta = (Number(right?.realizedQualityLift) || 0) - (Number(left?.realizedQualityLift) || 0);
    if (Math.abs(qualityDelta) > 1e-9) return qualityDelta;
    return (Number(right?.forwardSuccess?.["72x"]?.meanExcursionEdgeAtr) || 0) - (Number(left?.forwardSuccess?.["72x"]?.meanExcursionEdgeAtr) || 0);
  })[0] || null;
  const entryIntegrityVerdict = buildEntryIntegrityVerdict({
    bucketEvaluation,
    bucketSummary,
    bestTier: bestEntryTier,
    bestThreshold: bestEntryThreshold,
  });
  const forwardSuccessVerdict = buildForwardSuccessVerdict({
    bucketEvaluation,
    bestTier: bestForwardTier,
    bestThreshold: bestForwardThreshold,
  });
  const bestSimpleBaseline = simpleBaselines[0] || null;
  const scoreBeatsSimpleBaseline = Number(bestForwardTier?.realizedQualityLift) >= Number(bestSimpleBaseline?.realizedQualityLift);
  const combinedStatus = entryIntegrityVerdict.status === "trustworthy" && forwardSuccessVerdict.status === "trustworthy"
    ? "trustworthy"
    : entryIntegrityVerdict.status === "not_trustworthy_yet" && forwardSuccessVerdict.status === "not_trustworthy_yet"
      ? "not_trustworthy_yet"
      : "mixed";
  const combinedHeadline = combinedStatus === "trustworthy"
    ? "The score is trustworthy on both entry integrity and forward success."
    : combinedStatus === "mixed"
      ? "The score is useful on one evaluation track but not the other."
      : "The score is not trustworthy yet on either entry integrity or forward success.";

  return {
    status: combinedStatus,
    headline: combinedHeadline,
    preferredScoreKey,
    calibration: {
      bucketEvaluation,
      bucketSummary,
    },
    entryIntegrity: {
      status: entryIntegrityVerdict.status,
      headline: entryIntegrityVerdict.headline,
      baseline: entryIntegrity.baseline,
      thresholds: entryIntegrity.thresholds,
      frontierTiers: entryIntegrity.frontierTiers,
      bestTier: bestEntryTier,
      bestThreshold: bestEntryThreshold,
    },
    forwardSuccess: {
      status: forwardSuccessVerdict.status,
      headline: forwardSuccessVerdict.headline,
      baseline: forwardSuccess.baseline,
      thresholds: forwardSuccess.thresholds,
      frontierTiers: forwardSuccess.frontierTiers,
      bestTier: bestForwardTier,
      bestThreshold: bestForwardThreshold,
    },
    asymmetry: {
      longSignalCount: longRecords.length,
      shortSignalCount: shortRecords.length,
      longValidation,
      shortValidation,
      longForwardSuccess,
      shortForwardSuccess,
      longMinusShort: {
        realizedQualityScore: round(mean(longRecords.map((record) => record?.realizedQualityScore), 3) - mean(shortRecords.map((record) => record?.realizedQualityScore), 3), 3),
        fewCandleCorrectRatePct: round((Number(longValidation?.["3x"]?.cleanHoldRatePct) || 0) - (Number(shortValidation?.["3x"]?.cleanHoldRatePct) || 0), 1),
        guidanceRatePct: round((Number(longValidation?.["3x"]?.guidanceRatePct) || 0) - (Number(shortValidation?.["3x"]?.guidanceRatePct) || 0), 1),
        forward72xExcursionAtr: round((Number(longForwardSuccess?.["72x"]?.meanExcursionEdgeAtr) || 0) - (Number(shortForwardSuccess?.["72x"]?.meanExcursionEdgeAtr) || 0), 3),
      },
    },
    simpleBaselines: {
      bestSimpleBaseline,
      topSimpleBaselines: simpleBaselines.slice(0, 5),
      scoreBeatsSimpleBaseline,
    },
  };
}

function buildQualityFloorRecommendation(records = [], preferredScoreKey = "finalScore") {
  const usableRecords = (Array.isArray(records) ? records : []).filter((record) => (
    Number.isFinite(Number(record?.[preferredScoreKey]))
    && Number.isFinite(Number(record?.realizedQualityScore))
  ));
  if (usableRecords.length < MIN_RECOMMENDATION_SAMPLE * 2) {
    return {
      status: "insufficient",
      scoreKey: preferredScoreKey,
      floorScore: null,
      headline: "Not enough scored signals to recommend a trade floor yet.",
      baseline: summarizeQualityThreshold(usableRecords, preferredScoreKey, 0.5)?.baseline || null,
      candidates: [],
    };
  }

  const candidateMinimum = Math.max(
    MIN_RECOMMENDATION_SAMPLE,
    Math.round(usableRecords.length * (QUALITY_FLOOR_MIN_COVERAGE_PCT / 100)),
  );
  const candidateSummaries = QUALITY_FLOOR_THRESHOLDS
    .map((threshold) => summarizeQualityThreshold(usableRecords, preferredScoreKey, threshold))
    .filter((summary) => (summary?.above?.count || 0) >= candidateMinimum && (summary?.below?.count || 0) >= MIN_RECOMMENDATION_SAMPLE)
    .map((summary) => ({
      ...summary,
      compositeScore: round(
        ((Number(summary?.above?.realizedQualityLift) || 0) * 100)
        + ((Number(summary?.above?.excursionEdgeLiftAtr) || 0) * 40)
        + ((Number(summary?.above?.guidanceLiftPct) || 0) * 0.75)
        + ((Number(summary?.above?.coveragePct) || 0) * 0.1),
        2,
      ),
    }));

  if (!candidateSummaries.length) {
    return {
      status: "insufficient",
      scoreKey: preferredScoreKey,
      floorScore: null,
      headline: "No threshold has enough above-floor and below-floor coverage yet.",
      baseline: summarizeQualityThreshold(usableRecords, preferredScoreKey, 0.5)?.baseline || null,
      candidates: [],
    };
  }

  const rankedCandidates = [...candidateSummaries].sort((left, right) => {
    const compositeDelta = (Number(right.compositeScore) || 0) - (Number(left.compositeScore) || 0);
    if (Math.abs(compositeDelta) > 1e-9) {
      return compositeDelta;
    }
    return (Number(left.threshold) || 0) - (Number(right.threshold) || 0);
  });
  const best = rankedCandidates[0];
  const meaningful = (
    (Number(best?.above?.realizedQualityLift) || 0) >= MATERIAL_REALIZED_QUALITY_DELTA
    && (Number(best?.above?.meanRealizedQualityScore) || 0) >= QUALITY_FLOOR_GOOD_REALIZED_QUALITY
    && (Number(best?.above?.meanExcursionEdgeAtr) || 0) >= QUALITY_FLOOR_MIN_EDGE_ATR
    && (Number(best?.above?.guidanceRatePct) || 0) >= QUALITY_FLOOR_GOOD_GUIDANCE_PCT
  );

  return {
    status: meaningful ? "candidate_trade_floor" : "observe_only",
    scoreKey: preferredScoreKey,
    floorScore: meaningful ? best.threshold : null,
    headline: meaningful
      ? `Signals scoring ${best.threshold.toFixed(2)} or higher are the clearest current candidate trade floor.`
      : `Higher scores help, but no threshold is strong enough yet to become a trade floor.`,
    baseline: best?.baseline || null,
    bestCandidate: best,
    candidates: rankedCandidates,
  };
}

function buildRenderRecommendation(records = [], preferredScoreKey = "finalScore") {
  let chosen = null;
  for (const threshold of RENDER_FLOOR_THRESHOLDS) {
    const summary = summarizeThreshold(records, preferredScoreKey, RAYALGO_SCORE_STUDY_HEADLINE_HORIZON, threshold);
    if (
      (summary.below.count || 0) >= MIN_RECOMMENDATION_SAMPLE
      && (summary.above.count || 0) >= MIN_RECOMMENDATION_SAMPLE
      && (Number(summary.below.guidanceRatePct) || 0) < 48
      && (Number(summary.below.meanExcursionEdgeAtr) || 0) < -0.05
      && (Number(summary.above.meanExcursionEdgeAtr) || 0) > 0.04
    ) {
      chosen = summary;
    }
  }

  if (!chosen) {
    return {
      action: "keep_all_arrows",
      floorScore: null,
      headline: "No score floor is strong enough yet to justify de-emphasizing arrows.",
    };
  }

  const shouldHide = (Number(chosen.below.guidanceRatePct) || 0) < 45
    && (Number(chosen.below.meanExcursionEdgeAtr) || 0) < -0.12
    && (Number(chosen.above.guidanceRatePct) || 0) > 52;

  return {
    action: shouldHide ? "hide_below_floor" : "fade_below_floor",
    floorScore: chosen.threshold,
    headline: shouldHide
      ? `Signals below ${chosen.threshold.toFixed(2)} have weak excursion quality and too much adverse move, so they can be hidden by default.`
      : `Signals below ${chosen.threshold.toFixed(2)} have weak excursion quality and should be faded in the chart renderer.`,
    evidence: chosen,
  };
}

function buildTenureRenderRecommendation(records = [], preferredScoreKey = "finalScore") {
  let chosen = null;
  for (const threshold of RENDER_FLOOR_THRESHOLDS) {
    const summary = summarizeTenureThreshold(records, preferredScoreKey, RAYALGO_SCORE_STUDY_HEADLINE_HORIZON, threshold);
    if (
      (summary.below.count || 0) >= MIN_RECOMMENDATION_SAMPLE
      && (summary.above.count || 0) >= MIN_RECOMMENDATION_SAMPLE
      && (Number(summary.below.majorityCorrectRatePct) || 0) < TENURE_RENDER_BAD_MAJORITY_PCT
      && (Number(summary.below.meanTenurePct) || 0) < TENURE_RENDER_BAD_TENURE_PCT
      && (Number(summary.above.meanTenurePct) || 0) > TENURE_RENDER_GOOD_TENURE_PCT
    ) {
      chosen = summary;
    }
  }

  if (!chosen) {
    return {
      action: "keep_all_arrows",
      floorScore: null,
      headline: "No score floor is strong enough yet to justify de-emphasizing arrows on directional tenure.",
    };
  }

  const shouldHide = (Number(chosen.below.majorityCorrectRatePct) || 0) < TENURE_RENDER_HIDE_MAJORITY_PCT
    && (Number(chosen.below.meanTenurePct) || 0) < TENURE_RENDER_HIDE_TENURE_PCT
    && (Number(chosen.above.majorityCorrectRatePct) || 0) > TENURE_RENDER_GOOD_MAJOR_PCT;

  return {
    action: shouldHide ? "hide_below_floor" : "fade_below_floor",
    floorScore: chosen.threshold,
    headline: shouldHide
      ? `Signals below ${chosen.threshold.toFixed(2)} lose directional tenure quickly enough to hide by default.`
      : `Signals below ${chosen.threshold.toFixed(2)} lose directional tenure quickly enough to fade in the chart renderer.`,
    evidence: chosen,
  };
}

function filterRecordsByDirection(records = [], directionKey = "combined") {
  const normalizedDirection = String(directionKey || "combined").trim().toLowerCase();
  if (normalizedDirection !== "long" && normalizedDirection !== "short") {
    return Array.isArray(records) ? records : [];
  }
  return (Array.isArray(records) ? records : []).filter((record) => record?.direction === normalizedDirection);
}

function filterRecordsBySignalClass(records = [], signalClass = "trend_change") {
  const normalizedClass = String(signalClass || "trend_change").trim().toLowerCase();
  return (Array.isArray(records) ? records : []).filter((record) => record?.signalClass === normalizedClass);
}

function resolveSignalClass(event = null) {
  const explicit = String(event?.signalClass || "").trim().toLowerCase();
  if (explicit === "trend_change") {
    return "trend_change";
  }
  return "trend_change";
}

function buildRecord({
  event,
  timeframe,
  bars,
  barIndexByTs,
}) {
  const signalTs = String(event?.signalTs || event?.ts || "").trim();
  const startIndex = barIndexByTs.get(signalTs);
  if (!signalTs || !Number.isInteger(startIndex)) {
    return null;
  }
  const entryBar = bars[startIndex];
  const signalTimeMs = getBarTimeMs(entryBar);
  const referenceClose = Number(entryBar?.c) || 0;
  const signalClass = resolveSignalClass(event);
  const features = event?.meta?.features || null;
  return {
    timeframe,
    signalClass,
    signalTs,
    signalTimeMs,
    barIndex: startIndex,
    referenceClose,
    direction: String(event?.direction || "").trim().toLowerCase() === "short" ? "short" : "long",
    rawScore: clampUnit(event?.rawScore),
    finalScore: clampUnit(event?.score),
    effectiveScore: clampUnit(event?.effectiveScore ?? event?.meta?.scoring?.effectiveScore ?? event?.score),
    precursorBonus: round(event?.precursorBonus, 4) || 0,
    hasConflict: Boolean(event?.meta?.scoring?.precursorContext?.hasConflict),
    precursorLadderId: String(event?.precursorLadderId || event?.meta?.scoring?.precursorLadderId || "").trim() || null,
    scoringVersion: String(event?.scoringVersion || event?.meta?.scoring?.scoringVersion || "").trim() || null,
    displayText: String(event?.displayText || "").trim() || null,
    features,
    outcomes: {},
    tenureOutcomes: {},
    tenureStop: null,
    realizedQualityScore: null,
    realizedQuality: null,
  };
}

function buildForwardDirectionalSnapshot(directionRecords = [], {
  includeAdvancedDiagnostics = false,
} = {}) {
  const horizons = {};
  for (const horizon of RAYALGO_SCORE_STUDY_HORIZONS) {
    const rawRows = buildBucketRows(directionRecords, "rawScore", horizon.key);
    const finalRows = buildBucketRows(directionRecords, "finalScore", horizon.key);
    const effectiveRows = buildBucketRows(directionRecords, "effectiveScore", horizon.key);
    const rawEvaluation = buildBucketEvaluation(rawRows);
    const finalEvaluation = buildBucketEvaluation(finalRows);
    const effectiveEvaluation = buildBucketEvaluation(effectiveRows);
    const validatedSummary = summarizeValidatedQualitySnapshots(
      directionRecords.map((record) => buildValidatedQualityForHorizon(record, horizon.key)).filter(Boolean),
    );
    const overall = {
      signalCount: directionRecords.filter((record) => record.outcomes[horizon.key] && !record.outcomes[horizon.key]?.zeroWindow).length,
      zeroWindowCount: directionRecords.filter((record) => record?.outcomes?.[horizon.key]?.zeroWindow).length,
      guidanceRatePct: round((directionRecords.filter((record) => record.outcomes[horizon.key]?.guidanceCorrect).length / Math.max(directionRecords.filter((record) => record.outcomes[horizon.key] && !record.outcomes[horizon.key]?.zeroWindow).length, 1)) * 100, 1),
      meanValidatedQualityScore: validatedSummary.meanValidatedQualityScore,
      meanExcursionEdgeAtr: mean(directionRecords.map((record) => record.outcomes[horizon.key]?.excursionEdgeAtr), 3),
      meanExcursionEdgeBps: mean(directionRecords.map((record) => record.outcomes[horizon.key]?.excursionEdgeBps), 2),
      meanCloseReturnAtr: mean(directionRecords.map((record) => record.outcomes[horizon.key]?.closeReturnAtr), 3),
      meanCloseReturnBps: mean(directionRecords.map((record) => record.outcomes[horizon.key]?.closeReturnBps), 2),
      meanStayedRightPct: validatedSummary.meanStayedRightPct,
    };
    horizons[horizon.key] = {
      horizonKey: horizon.key,
      label: horizon.label,
      multiplier: horizon.multiplier,
      raw: {
        rows: rawRows,
        evaluation: rawEvaluation,
        overall,
      },
      final: {
        rows: finalRows,
        evaluation: finalEvaluation,
        overall,
      },
      effective: {
        rows: effectiveRows,
        evaluation: effectiveEvaluation,
        overall,
      },
      comparison: buildScoreTypeComparison(rawEvaluation, finalEvaluation),
    };
  }
  const headline = horizons[RAYALGO_SCORE_STUDY_HEADLINE_HORIZON] || null;
  const preferenceComparison = buildForwardPreferenceComparison(horizons);
  const preferredScoreType = preferenceComparison?.winner === "raw" ? "raw" : "final";
  const recommendations = buildRecommendations(preferenceComparison, directionRecords);
  const fewCandle = summarizeFewCandleMetrics(directionRecords);
  const predictedScoreSummary = buildPredictedScoreSummary(directionRecords, recommendations.preferredScoreType);
  const validatedOutcomeSummary = buildValidatedOutcomeSummary(directionRecords, fewCandle);
  const rankValiditySummary = buildRankValiditySummary({
    signalCount: directionRecords.length,
    preferredScoreType: recommendations.preferredScoreType,
    horizonSummaries: horizons,
    timeframeRows: [],
  });
  const precisionCoverageFrontier = includeAdvancedDiagnostics
    ? buildPrecisionCoverageFrontier(
      directionRecords,
      preferredScoreType === "raw" ? "rawScore" : "finalScore",
    )
    : null;
  const headlineBlocks = buildForwardHeadlineBlocks(horizons, recommendations.preferredScoreType);
  return {
    signalCount: directionRecords.length,
    preferredScoreType,
    predictedScoreSummary,
    validatedOutcomeSummary,
    rankValiditySummary,
    rawVsFinalComparison: preferenceComparison || headline?.comparison || null,
    renderRecommendation: buildRenderRecommendation(directionRecords, preferredScoreType === "raw" ? "rawScore" : "finalScore"),
    precisionCoverageFrontier,
    overallSummary: {
      totalSignals: directionRecords.length,
      preferredScoreType: recommendations.preferredScoreType,
      precursorEffect: recommendations.precursorEffect,
      renderAction: recommendations.renderAction,
      renderFloorScore: recommendations.renderFloorScore,
      headline: recommendations.headline,
      renderHeadline: recommendations.renderHeadline,
      headlineMeanPredictedRawScore: mean(directionRecords.map((record) => record.rawScore), 3),
      headlineMeanPredictedFinalScore: mean(directionRecords.map((record) => record.finalScore), 3),
      headlineMeanPredictedEffectiveScore: mean(directionRecords.map((record) => record.effectiveScore), 3),
      headlineMeanRealizedQualityScore: mean(directionRecords.map((record) => record.realizedQualityScore), 3),
      headlineValidatedQualityScore: validatedOutcomeSummary.validatedQualityScore,
      headlineMeanBestMoveAtr: validatedOutcomeSummary.bestMoveAtr,
      headlineMeanCloseResultAtr: validatedOutcomeSummary.closeResultAtr,
      headlineMeanDirectionCorrectPct: validatedOutcomeSummary.directionCorrectPct,
      headlineMeanStayedRightPct: validatedOutcomeSummary.stayedRightPct,
      headlineMeanFewCandleQualityScore: fewCandle.meanFewCandleQualityScore,
      headlineGuidanceRatePct: headline?.[recommendations.preferredScoreType]?.overall?.guidanceRatePct ?? null,
      headlineFewCandleCorrectRatePct: fewCandle.fewCandleCorrectRatePct,
      headlineSustainedCorrectRatePct: fewCandle.sustainedCorrectRatePct,
      headlineMeanExcursionEdgeAtr: headline?.[recommendations.preferredScoreType]?.overall?.meanExcursionEdgeAtr ?? null,
      headlineMeanExcursionEdgeBps: headline?.[recommendations.preferredScoreType]?.overall?.meanExcursionEdgeBps ?? null,
      headlineMeanCloseReturnAtr: headline?.[recommendations.preferredScoreType]?.overall?.meanCloseReturnAtr ?? null,
      headlineMeanCloseReturnBps: headline?.[recommendations.preferredScoreType]?.overall?.meanCloseReturnBps ?? null,
      headlineBlocks,
    },
    horizons,
  };
}

function buildTimeframeStudy({
  marketSymbol,
  timeframe,
  rawBars,
  rayalgoSettings,
  scoringPreferences,
}) {
  const minutes = timeframeToMinutes(timeframe);
  if (!Number.isFinite(minutes)) {
    return null;
  }
  const bars = aggregateBarsToMinutes(rawBars, minutes);
  if (bars.length < 120) {
    return {
      timeframe,
      tfMinutes: minutes,
      skipped: true,
      reason: "insufficient_bars",
      signalCount: 0,
      records: [],
      horizons: {},
    };
  }
  const scoringConfig = normalizeRayAlgoScoringConfig({
    ...(scoringPreferences || {}),
    marketSymbol,
    activeTimeframe: timeframe,
  });
  const regimes = detectRegimes(bars);
  const tape = buildSignalOverlayTape(bars, regimes, {
    strategy: "rayalgo",
    tfMin: minutes,
    executionBars: rawBars,
    signalTimeframe: timeframe,
    rayalgoSettings,
    rayalgoScoringConfig: scoringConfig,
  });
  const allSignalEvents = (Array.isArray(tape?.events) ? tape.events : [])
    .filter((event) => {
      if (String(event?.strategy || "").trim().toLowerCase() !== "rayalgo") {
        return false;
      }
      const eventType = String(event?.eventType || "").trim().toLowerCase();
      return eventType === "signal_fire";
    });
  const barIndexByTs = new Map(bars.map((bar, index) => [String(bar?.ts || "").trim(), index]));
  const barTimeMs = bars.map((bar) => getBarTimeMs(bar));
  const atrSeries = calcAtrSeries(
    bars,
    Math.max(1, Number(rayalgoSettings?.bands?.atrLength) || 14),
    Math.max(1, Number(rayalgoSettings?.bands?.atrSmoothing) || 14),
  );
  const allBuiltRecords = allSignalEvents
    .map((event) => buildRecord({ event, timeframe, bars, barIndexByTs }))
    .filter(Boolean);
  const records = allBuiltRecords.filter((record) => resolveSignalClass(record) === "trend_change");
  const signalClassRecords = (
    RAYALGO_SCORE_STUDY_SIGNAL_CLASSES.length === 1
    && RAYALGO_SCORE_STUDY_SIGNAL_CLASSES[0]?.key === "trend_change"
  )
    ? records
    : allBuiltRecords;
  return {
    timeframe,
    tfMinutes: minutes,
    skipped: false,
    signalCount: records.length,
    scoringConfig,
    scoringContext: tape?.events?.find((event) => event?.scoringVersion)?.meta?.scoring || null,
    bars,
    barTimeMs,
    atrSeries,
    records,
    signalClassRecords,
    directions: null,
    horizons: {},
    preferredScoreType: null,
    rawVsFinalComparison: null,
    renderRecommendation: null,
    overallSummary: null,
  };
}

function buildTimeframeHorizonWindowMinutes(usableStudies = []) {
  return Object.fromEntries(
    (Array.isArray(usableStudies) ? usableStudies : []).map((study) => {
      const tfMinutes = Number(study?.tfMinutes) || null;
      const buildWindowMap = (horizons = []) => Object.fromEntries(
        (Array.isArray(horizons) ? horizons : []).map((horizon) => [
          horizon.key,
          tfMinutes == null ? null : tfMinutes * Number(horizon.multiplier || 0),
        ]),
      );
      return [
        study.timeframe,
        {
          timeframeMinutes: tfMinutes,
          note: tfMinutes == null
            ? "Each horizon multiplier is measured in bars of the active timeframe."
            : `Each horizon multiplier is measured in ${tfMinutes}-minute bars of the active timeframe.`,
          forward: buildWindowMap(RAYALGO_SCORE_STUDY_HORIZONS),
          tenure: buildWindowMap(RAYALGO_SCORE_STUDY_TENURE_HORIZONS),
        },
      ];
    }),
  );
}

function flattenStudyRecords(timeframeStudies = []) {
  return timeframeStudies.flatMap((study) => Array.isArray(study?.records) ? study.records : []);
}

function flattenStudySignalClassRecords(timeframeStudies = []) {
  return timeframeStudies.flatMap((study) => Array.isArray(study?.signalClassRecords) ? study.signalClassRecords : []);
}

function buildContrarianLookup(timeframeStudies = [], recordKey = "records") {
  return Object.fromEntries(
    (Array.isArray(timeframeStudies) ? timeframeStudies : []).map((study) => {
      const records = (Array.isArray(study?.[recordKey]) ? study[recordKey] : [])
        .filter((record) => Number.isFinite(Number(record?.signalTimeMs)))
        .slice()
        .sort((left, right) => Number(left.signalTimeMs) - Number(right.signalTimeMs));
      const times = records.map((record) => Number(record.signalTimeMs));
      const nextLongFrom = Array(records.length + 1).fill(-1);
      const nextShortFrom = Array(records.length + 1).fill(-1);
      let nextLongIndex = -1;
      let nextShortIndex = -1;
      for (let index = records.length - 1; index >= 0; index -= 1) {
        if (records[index].direction === "long") {
          nextLongIndex = index;
        } else if (records[index].direction === "short") {
          nextShortIndex = index;
        }
        nextLongFrom[index] = nextLongIndex;
        nextShortFrom[index] = nextShortIndex;
      }
      return [
        study.timeframe,
        {
          records,
          times,
          nextLongFrom,
          nextShortFrom,
        },
      ];
    }),
  );
}

function findFirstContrarianSignal(record, study, contrarianLookup = {}) {
  return findFirstContrarianSignalForPolicy(record, study, contrarianLookup, CONTRARIAN_POLICY_CONFIGS[0]);
}

function buildContrarianHit(timeframe, candidate, scoreUsed, policy, isPrecursorFrame) {
  return {
    timeframe,
    signalTs: candidate.signalTs,
    timeMs: Number(candidate.signalTimeMs),
    scoreBasis: policy?.scoreBasis || CONTRARIAN_SCORE_BASIS,
    scoreUsed: Number.isFinite(Number(scoreUsed)) ? round(scoreUsed, 3) : null,
    policyId: policy?.id || null,
    policyFamily: policy?.family || null,
    isPrecursorFrame: Boolean(isPrecursorFrame),
  };
}

function contrarianCandidatePassesPolicy(record, study, candidate, timeframe, policy) {
  if (!record || !candidate || !policy) {
    return false;
  }
  const isPrecursorFrame = timeframe !== study?.timeframe;
  if (policy.activeOnly && isPrecursorFrame) {
    return false;
  }
  if (!policy.requireScoreGate) {
    return true;
  }
  const candidateScore = getRecordScoreByBasis(candidate, policy.scoreBasis);
  const currentScore = getRecordScoreByBasis(record, policy.scoreBasis);
  const requiredMinimum = clampUnit((Number(policy.minimumScore) || 0) + (isPrecursorFrame ? Number(policy.precursorMinBump || 0) : 0));
  if (!Number.isFinite(candidateScore) || candidateScore < requiredMinimum) {
    return false;
  }
  if (policy.requireMargin) {
    const requiredDelta = Math.max(0, (Number(policy.minimumDelta) || 0) + (isPrecursorFrame ? Number(policy.precursorDeltaBump || 0) : 0));
    if (!Number.isFinite(currentScore) || candidateScore < currentScore + requiredDelta) {
      return false;
    }
  }
  return true;
}

function findFirstContrarianSignalForPolicy(record, study, contrarianLookup = {}, policy = CONTRARIAN_POLICY_CONFIGS[0]) {
  const oppositeDirection = record?.direction === "short" ? "long" : "short";
  const scopeFrames = Array.from(new Set([
    study?.timeframe,
    ...((Array.isArray(study?.scoringConfig?.precursorFrames) ? study.scoringConfig.precursorFrames : [])),
  ].filter(Boolean)));
  let best = null;
  for (const timeframe of scopeFrames) {
    const lookup = contrarianLookup?.[timeframe];
    if (!lookup?.records?.length) {
      continue;
    }
    const insertIndex = upperBoundNumeric(lookup.times, Number(record?.signalTimeMs));
    const nextIndex = oppositeDirection === "long"
      ? lookup.nextLongFrom[insertIndex]
      : lookup.nextShortFrom[insertIndex];
    if (!Number.isInteger(nextIndex) || nextIndex < 0) {
      continue;
    }
    const candidate = lookup.records[nextIndex];
    if (!candidate) {
      continue;
    }
    if (!contrarianCandidatePassesPolicy(record, study, candidate, timeframe, policy)) {
      continue;
    }
    const candidateScore = getRecordScoreByBasis(candidate, policy?.scoreBasis);
    if (!best || Number(candidate.signalTimeMs) < Number(best.timeMs)) {
      best = buildContrarianHit(timeframe, candidate, candidateScore, policy, timeframe !== study?.timeframe);
    }
  }
  return best;
}

function buildTenureDirectionalSnapshot(directionRecords = []) {
  const horizons = {};
  for (const horizon of RAYALGO_SCORE_STUDY_TENURE_HORIZONS) {
    const rawRows = buildTenureBucketRows(directionRecords, "rawScore", horizon.key);
    const finalRows = buildTenureBucketRows(directionRecords, "finalScore", horizon.key);
    const effectiveRows = buildTenureBucketRows(directionRecords, "effectiveScore", horizon.key);
    const rawEvaluation = buildTenureBucketEvaluation(rawRows);
    const finalEvaluation = buildTenureBucketEvaluation(finalRows);
    const effectiveEvaluation = buildTenureBucketEvaluation(effectiveRows);
    const evaluableOutcomes = directionRecords
      .map((record) => record?.tenureOutcomes?.[horizon.key])
      .filter((outcome) => outcome && !outcome.zeroWindow);
    const overall = {
      signalCount: evaluableOutcomes.length,
      zeroWindowCount: directionRecords.filter((record) => record?.tenureOutcomes?.[horizon.key]?.zeroWindow).length,
      majorityCorrectRatePct: evaluableOutcomes.length
        ? round((evaluableOutcomes.filter((outcome) => outcome.majorityCorrect).length / evaluableOutcomes.length) * 100, 1)
        : null,
      meanTenurePct: mean(evaluableOutcomes.map((outcome) => outcome.tenurePct), 1),
      meanEligibleBars: mean(evaluableOutcomes.map((outcome) => outcome.eligibleBars), 2),
      contrarianStopRatePct: evaluableOutcomes.length
        ? round((evaluableOutcomes.filter((outcome) => outcome.endedByContrarian).length / evaluableOutcomes.length) * 100, 1)
        : null,
    };
    horizons[horizon.key] = {
      horizonKey: horizon.key,
      label: horizon.label,
      multiplier: horizon.multiplier,
      raw: {
        rows: rawRows,
        evaluation: rawEvaluation,
        overall,
      },
      final: {
        rows: finalRows,
        evaluation: finalEvaluation,
        overall,
      },
      effective: {
        rows: effectiveRows,
        evaluation: effectiveEvaluation,
        overall,
      },
      comparison: buildTenureScoreTypeComparison(rawEvaluation, finalEvaluation),
    };
  }

  const headline = horizons[RAYALGO_SCORE_STUDY_HEADLINE_HORIZON] || null;
  const preferredScoreType = headline?.comparison?.winner === "raw" ? "raw" : "final";
  const recommendations = buildTenureRecommendations(headline, directionRecords);
  return {
    signalCount: directionRecords.length,
    preferredScoreType,
    rawVsFinalComparison: headline?.comparison || null,
    renderRecommendation: buildTenureRenderRecommendation(directionRecords, preferredScoreType === "raw" ? "rawScore" : "finalScore"),
    overallSummary: {
      totalSignals: directionRecords.length,
      preferredScoreType: recommendations.preferredScoreType,
      precursorEffect: recommendations.precursorEffect,
      renderAction: recommendations.renderAction,
      renderFloorScore: recommendations.renderFloorScore,
      headline: recommendations.headline,
      renderHeadline: recommendations.renderHeadline,
      headlineMeanPredictedRawScore: mean(directionRecords.map((record) => record.rawScore), 3),
      headlineMeanPredictedFinalScore: mean(directionRecords.map((record) => record.finalScore), 3),
      headlineMeanPredictedEffectiveScore: mean(directionRecords.map((record) => record.effectiveScore), 3),
      headlineMeanRealizedQualityScore: mean(directionRecords.map((record) => record.realizedQualityScore), 3),
      headlineMajorityCorrectRatePct: headline?.[recommendations.preferredScoreType]?.overall?.majorityCorrectRatePct ?? null,
      headlineMeanTenurePct: headline?.[recommendations.preferredScoreType]?.overall?.meanTenurePct ?? null,
      headlineMeanEligibleBars: headline?.[recommendations.preferredScoreType]?.overall?.meanEligibleBars ?? null,
      headlineContrarianStopRatePct: headline?.[recommendations.preferredScoreType]?.overall?.contrarianStopRatePct ?? null,
    },
    horizons,
  };
}

function applyOutcomesToRecordSet(timeframeStudies = [], recordKey = "records", {
  onStudyProgress = null,
  shouldCancel = null,
} = {}) {
  const usableStudies = Array.isArray(timeframeStudies) ? timeframeStudies : [];
  throwIfScoreStudyCancelled(shouldCancel);
  const contrarianLookup = buildContrarianLookup(usableStudies, recordKey);
  for (let index = 0; index < usableStudies.length; index += 1) {
    throwIfScoreStudyCancelled(shouldCancel);
    const study = usableStudies[index];
    if (typeof onStudyProgress === "function") {
      onStudyProgress({
        timeframe: study?.timeframe || null,
        current: index + 1,
        total: usableStudies.length,
        recordKey,
      });
    }
    const bars = Array.isArray(study?.bars) ? study.bars : [];
    const barTimeMs = Array.isArray(study?.barTimeMs) ? study.barTimeMs : [];
    const records = Array.isArray(study?.[recordKey]) ? study[recordKey] : [];
    for (const record of records) {
      const contrarian = findFirstContrarianSignal(record, study, contrarianLookup);
      const outcomes = {};
      for (const horizon of RAYALGO_SCORE_STUDY_HORIZONS) {
        const outcome = getOutcomeForHorizon({
          bars,
          atrSeries: Array.isArray(study?.atrSeries) ? study.atrSeries : [],
          barTimeMs,
          startIndex: record?.barIndex,
          direction: record?.direction,
          horizon,
          contrarian,
          timeframeMinutes: study?.tfMinutes,
        });
        if (outcome) {
          outcomes[horizon.key] = outcome;
        }
      }
      record.outcomes = outcomes;
      record.tenureStop = contrarian;
      const tenureOutcomes = {};
      for (const horizon of RAYALGO_SCORE_STUDY_TENURE_HORIZONS) {
        const outcome = getTenureOutcomeForHorizon({
          bars,
          barTimeMs,
          referenceClose: Number(record?.referenceClose) || 0,
          startIndex: record?.barIndex,
          direction: record?.direction,
          horizon,
          contrarian,
          timeframeMinutes: study?.tfMinutes,
        });
        if (outcome) {
          tenureOutcomes[horizon.key] = outcome;
        }
      }
      record.tenureOutcomes = tenureOutcomes;
      record.realizedQuality = buildRealizedQualityScore(record);
      record.realizedQualityScore = record.realizedQuality?.score ?? null;
      record.fewCandleOutcome = buildFewCandleOutcome(record);
      record.fewCandleQualityScore = record.fewCandleOutcome?.score ?? null;
    }
  }
}

function applyForwardAndTenureOutcomesToStudies(timeframeStudies = [], {
  onProgress = null,
  shouldCancel = null,
  includeAdvancedDiagnostics = false,
} = {}) {
  const usableStudies = Array.isArray(timeframeStudies) ? timeframeStudies : [];
  const totalStudies = usableStudies.length;
  const hasDistinctSignalClassRecords = usableStudies.some((study) => (
    Array.isArray(study?.signalClassRecords)
    && Array.isArray(study?.records)
    && study.signalClassRecords !== study.records
  ));
  const emitStudyProgress = (basePct, rangePct, label) => ({ timeframe, current, total }) => {
    const safeTotal = Math.max(1, Number(total) || totalStudies || 1);
    const pct = basePct + Math.round((Math.max(0, Number(current) || 0) / safeTotal) * rangePct);
    emitScoreStudyProgress(onProgress, shouldCancel, {
      stage: label,
      detail: timeframe
        ? `${label} for ${timeframe} (${current}/${safeTotal}).`
        : label,
      pct,
      current,
      total: safeTotal,
      timeframe,
    });
  };

  applyOutcomesToRecordSet(usableStudies, "records", {
    shouldCancel,
    onStudyProgress: emitStudyProgress(42, 26, "Computing forward/tenure outcomes"),
  });
  if (hasDistinctSignalClassRecords) {
    applyOutcomesToRecordSet(usableStudies, "signalClassRecords", {
      shouldCancel,
      onStudyProgress: emitStudyProgress(68, 12, "Computing signal-class outcomes"),
    });
  }
  for (let index = 0; index < usableStudies.length; index += 1) {
    throwIfScoreStudyCancelled(shouldCancel);
    const study = usableStudies[index];
    emitScoreStudyProgress(onProgress, shouldCancel, {
      stage: "Summarizing timeframes",
      detail: study?.timeframe
        ? `Building rollups for ${study.timeframe} (${index + 1}/${Math.max(totalStudies, 1)}).`
        : "Building timeframe rollups.",
      pct: 80 + Math.round(((index + 1) / Math.max(totalStudies, 1)) * 10),
      current: index + 1,
      total: Math.max(totalStudies, 1),
      timeframe: study?.timeframe || null,
    });
    const records = Array.isArray(study?.records) ? study.records : [];
    const directions = Object.fromEntries(
      RAYALGO_SCORE_STUDY_DIRECTIONS.map(({ key }) => [
        key,
        buildForwardDirectionalSnapshot(filterRecordsByDirection(records, key), {
          includeAdvancedDiagnostics,
        }),
      ]),
    );
    const combinedForwardDirection = directions.combined || buildForwardDirectionalSnapshot(records, {
      includeAdvancedDiagnostics,
    });
    study.directions = directions;
    study.horizons = combinedForwardDirection.horizons;
    study.preferredScoreType = combinedForwardDirection.preferredScoreType;
    study.rawVsFinalComparison = combinedForwardDirection.rawVsFinalComparison;
    study.renderRecommendation = combinedForwardDirection.renderRecommendation;
    study.overallSummary = combinedForwardDirection.overallSummary;

    const tenureDirections = Object.fromEntries(
      RAYALGO_SCORE_STUDY_DIRECTIONS.map(({ key }) => [
        key,
        buildTenureDirectionalSnapshot(filterRecordsByDirection(records, key)),
      ]),
    );
    const combinedDirection = tenureDirections.combined || buildTenureDirectionalSnapshot(records);
    study.tenureDirections = tenureDirections;
    study.tenureHorizons = combinedDirection.horizons;
    study.tenurePreferredScoreType = combinedDirection.preferredScoreType;
    study.tenureRawVsFinalComparison = combinedDirection.rawVsFinalComparison;
    study.tenureRenderRecommendation = combinedDirection.renderRecommendation;
    study.tenureOverallSummary = combinedDirection.overallSummary;
  }
}

function buildOverallHorizonSummary(records = [], horizonKey = RAYALGO_SCORE_STUDY_HEADLINE_HORIZON) {
  const rawRows = buildBucketRows(records, "rawScore", horizonKey);
  const finalRows = buildBucketRows(records, "finalScore", horizonKey);
  const effectiveRows = buildBucketRows(records, "effectiveScore", horizonKey);
  const rawEvaluation = buildBucketEvaluation(rawRows);
  const finalEvaluation = buildBucketEvaluation(finalRows);
  const effectiveEvaluation = buildBucketEvaluation(effectiveRows);
  const outcomes = records.map((record) => record?.outcomes?.[horizonKey]).filter((outcome) => outcome && !outcome.zeroWindow);
  const tenureOutcomes = records.map((record) => record?.tenureOutcomes?.[horizonKey]).filter((outcome) => outcome && !outcome.zeroWindow);
  const validatedSummary = summarizeValidatedQualitySnapshots(
    records.map((record) => buildValidatedQualityForHorizon(record, horizonKey)).filter(Boolean),
  );
  const zeroWindowCount = records.filter((record) => record?.outcomes?.[horizonKey]?.zeroWindow).length;
  const overall = {
    signalCount: outcomes.length,
    zeroWindowCount,
    guidanceRatePct: outcomes.length
      ? round((outcomes.filter((outcome) => outcome.guidanceCorrect).length / outcomes.length) * 100, 1)
      : null,
    meanValidatedQualityScore: validatedSummary.meanValidatedQualityScore,
    meanExcursionEdgeAtr: mean(outcomes.map((outcome) => outcome.excursionEdgeAtr), 3),
    meanExcursionEdgeBps: mean(outcomes.map((outcome) => outcome.excursionEdgeBps), 2),
    meanCloseReturnAtr: mean(outcomes.map((outcome) => outcome.closeReturnAtr), 3),
    meanCloseReturnBps: mean(outcomes.map((outcome) => outcome.closeReturnBps), 2),
    meanStayedRightPct: validatedSummary.meanStayedRightPct,
    majorityCorrectRatePct: tenureOutcomes.length
      ? round((tenureOutcomes.filter((outcome) => outcome.majorityCorrect).length / tenureOutcomes.length) * 100, 1)
      : null,
    meanMfeAtr: mean(outcomes.map((outcome) => outcome.mfeAtr), 3),
    meanMfeBps: mean(outcomes.map((outcome) => outcome.mfeBps), 2),
    meanMaeAtr: mean(outcomes.map((outcome) => outcome.maeAtr), 3),
    meanMaeBps: mean(outcomes.map((outcome) => outcome.maeBps), 2),
    meanEffectiveBars: mean(outcomes.map((outcome) => outcome.effectiveBars), 2),
    meanRequestedClockMinutes: mean(outcomes.map((outcome) => getRequestedClockMinutes(outcome)), 2),
    meanEffectiveClockMinutes: mean(outcomes.map((outcome) => getEffectiveClockMinutes(outcome, "effectiveBars")), 2),
  };
  return {
    horizonKey,
    raw: {
      rows: rawRows,
      evaluation: rawEvaluation,
      overall,
    },
    final: {
      rows: finalRows,
      evaluation: finalEvaluation,
      overall,
    },
    effective: {
      rows: effectiveRows,
      evaluation: effectiveEvaluation,
      overall,
    },
    comparison: buildScoreTypeComparison(rawEvaluation, finalEvaluation),
  };
}

function buildTimeframeSummaryRows(timeframeStudies = [], directionKey = "combined") {
  return timeframeStudies.map((study) => {
    const directional = study?.directions?.[directionKey] || study;
    const headline = directional?.horizons?.[RAYALGO_SCORE_STUDY_HEADLINE_HORIZON] || null;
    const preferred = directional?.preferredScoreType === "raw" ? headline?.raw : headline?.final;
    const validatedOutcomeSummary = directional?.validatedOutcomeSummary || null;
    return {
      timeframe: study.timeframe,
      tfMinutes: study.tfMinutes,
      signalCount: directional?.signalCount ?? 0,
      preferredScoreType: directional?.preferredScoreType || "final",
      comparisonWinner: directional?.rawVsFinalComparison?.winner || headline?.comparison?.winner || "tie",
      meanValidatedQualityScore: validatedOutcomeSummary?.validatedQualityScore ?? preferred?.overall?.meanValidatedQualityScore ?? null,
      guidanceRatePct: validatedOutcomeSummary?.directionCorrectPct ?? preferred?.overall?.guidanceRatePct ?? null,
      meanExcursionEdgeAtr: validatedOutcomeSummary?.bestMoveAtr ?? preferred?.overall?.meanExcursionEdgeAtr ?? null,
      meanCloseReturnAtr: validatedOutcomeSummary?.closeResultAtr ?? preferred?.overall?.meanCloseReturnAtr ?? null,
      meanStayedRightPct: validatedOutcomeSummary?.stayedRightPct ?? preferred?.overall?.meanStayedRightPct ?? null,
      monotonicityPct: preferred?.evaluation?.monotonicityPct ?? null,
      topBottomGuidanceLiftPct: preferred?.evaluation?.topBottomGuidanceLiftPct ?? null,
      topBottomEdgeLift: preferred?.evaluation?.topBottomEdgeLift ?? null,
      renderAction: directional?.renderRecommendation?.action || "keep_all_arrows",
      renderFloorScore: directional?.renderRecommendation?.floorScore ?? null,
      lowConfidence: (directional?.signalCount || 0) < MIN_RECOMMENDATION_SAMPLE,
    };
  }).sort((left, right) => {
    const leftMinutes = Number(left.tfMinutes) || 0;
    const rightMinutes = Number(right.tfMinutes) || 0;
    return leftMinutes - rightMinutes;
  });
}

function buildTenureTimeframeSummaryRows(timeframeStudies = [], directionKey = "combined") {
  return timeframeStudies.map((study) => {
    const directional = study?.tenureDirections?.[directionKey] || study;
    const headline = directional?.horizons?.[RAYALGO_SCORE_STUDY_HEADLINE_HORIZON] || null;
    const preferred = directional?.preferredScoreType === "raw" ? headline?.raw : headline?.final;
    return {
      timeframe: study.timeframe,
      tfMinutes: study.tfMinutes,
      signalCount: directional?.signalCount ?? 0,
      preferredScoreType: directional?.preferredScoreType || "final",
      comparisonWinner: directional?.rawVsFinalComparison?.winner || headline?.comparison?.winner || "tie",
      majorityCorrectRatePct: preferred?.overall?.majorityCorrectRatePct ?? null,
      meanTenurePct: preferred?.overall?.meanTenurePct ?? null,
      meanEligibleBars: preferred?.overall?.meanEligibleBars ?? null,
      contrarianStopRatePct: preferred?.overall?.contrarianStopRatePct ?? null,
      monotonicityPct: preferred?.evaluation?.monotonicityPct ?? null,
      topBottomMajorityLiftPct: preferred?.evaluation?.topBottomMajorityLiftPct ?? null,
      topBottomTenureLiftPct: preferred?.evaluation?.topBottomTenureLiftPct ?? null,
      renderAction: directional?.renderRecommendation?.action || "keep_all_arrows",
      renderFloorScore: directional?.renderRecommendation?.floorScore ?? null,
      lowConfidence: (directional?.signalCount || 0) < MIN_RECOMMENDATION_SAMPLE,
    };
  }).sort((left, right) => {
    const leftMinutes = Number(left.tfMinutes) || 0;
    const rightMinutes = Number(right.tfMinutes) || 0;
    return leftMinutes - rightMinutes;
  });
}

function buildRecommendations(scoreTypeComparison, overallRecords) {
  const winner = scoreTypeComparison?.winner || "tie";
  const preferredScoreType = winner === "raw" ? "raw" : "final";
  const renderRecommendation = buildRenderRecommendation(
    overallRecords,
    preferredScoreType === "raw" ? "rawScore" : "finalScore",
  );
  const precursorEffect = winner === "final"
    ? "helpful"
    : winner === "raw"
      ? "harmful"
      : "neutral";

  return {
    preferredScoreType,
    scoreRendering: winner === "raw" ? "render_raw_numeric" : "render_final_numeric",
    bonusDisplayMode: "details_only",
    precursorEffect,
    renderAction: renderRecommendation.action,
    renderFloorScore: renderRecommendation.floorScore,
    headline: winner === "raw"
      ? "Switch the chart label to rawScore and keep precursor bonus in details only, because it tracks cleaner excursion better."
      : winner === "final"
        ? "Keep rendering final score numerically and keep precursor bonus in details only, because it tracks cleaner excursion better."
        : "Keep the current final-score label, but treat raw-vs-final as unresolved on excursion quality for now.",
    renderHeadline: renderRecommendation.headline,
  };
}

function buildTenureRecommendations(overallHeadline, overallRecords) {
  const winner = overallHeadline?.comparison?.winner || "tie";
  const preferredScoreType = winner === "raw" ? "raw" : "final";
  const renderRecommendation = buildTenureRenderRecommendation(
    overallRecords,
    preferredScoreType === "raw" ? "rawScore" : "finalScore",
  );
  const precursorEffect = winner === "final"
    ? "helpful"
    : winner === "raw"
      ? "harmful"
      : "neutral";

  return {
    preferredScoreType,
    scoreRendering: winner === "raw" ? "render_raw_numeric" : "render_final_numeric",
    bonusDisplayMode: "details_only",
    precursorEffect,
    renderAction: renderRecommendation.action,
    renderFloorScore: renderRecommendation.floorScore,
    headline: winner === "raw"
      ? "Switch the chart label to rawScore if directional tenure matters more than fixed-horizon expectancy."
      : winner === "final"
        ? "Keep rendering final score numerically; it tracks directional tenure better."
        : "Keep the current final-score label, but treat raw-vs-final as unresolved on directional tenure.",
    renderHeadline: renderRecommendation.headline,
  };
}

function buildOverallTenureHorizonSummary(records = [], horizonKey = RAYALGO_SCORE_STUDY_HEADLINE_HORIZON) {
  const rawRows = buildTenureBucketRows(records, "rawScore", horizonKey);
  const finalRows = buildTenureBucketRows(records, "finalScore", horizonKey);
  const effectiveRows = buildTenureBucketRows(records, "effectiveScore", horizonKey);
  const rawEvaluation = buildTenureBucketEvaluation(rawRows);
  const finalEvaluation = buildTenureBucketEvaluation(finalRows);
  const effectiveEvaluation = buildTenureBucketEvaluation(effectiveRows);
  const outcomes = records.map((record) => record?.tenureOutcomes?.[horizonKey]).filter((outcome) => outcome && !outcome.zeroWindow);
  const zeroWindowCount = records.filter((record) => record?.tenureOutcomes?.[horizonKey]?.zeroWindow).length;
  const overall = {
    signalCount: outcomes.length,
    zeroWindowCount,
    majorityCorrectRatePct: outcomes.length ? round((outcomes.filter((outcome) => outcome.majorityCorrect).length / outcomes.length) * 100, 1) : null,
    meanTenurePct: mean(outcomes.map((outcome) => outcome.tenurePct), 1),
    meanEligibleBars: mean(outcomes.map((outcome) => outcome.eligibleBars), 2),
    meanRequestedClockMinutes: mean(outcomes.map((outcome) => getRequestedClockMinutes(outcome)), 2),
    meanEligibleClockMinutes: mean(outcomes.map((outcome) => getEffectiveClockMinutes(outcome, "eligibleBars")), 2),
    contrarianStopRatePct: outcomes.length ? round((outcomes.filter((outcome) => outcome.endedByContrarian).length / outcomes.length) * 100, 1) : null,
  };
  return {
    horizonKey,
    raw: {
      rows: rawRows,
      evaluation: rawEvaluation,
      overall,
    },
    final: {
      rows: finalRows,
      evaluation: finalEvaluation,
      overall,
    },
    effective: {
      rows: effectiveRows,
      evaluation: effectiveEvaluation,
      overall,
    },
    comparison: buildTenureScoreTypeComparison(rawEvaluation, finalEvaluation),
  };
}

function buildForwardStudyMode(usableStudies = [], overallRecords = [], {
  includeAdvancedDiagnostics = false,
} = {}) {
  const directionSummaries = Object.fromEntries(
    RAYALGO_SCORE_STUDY_DIRECTIONS.map(({ key }) => {
      const directionRecords = filterRecordsByDirection(overallRecords, key);
      const horizonSummaries = Object.fromEntries(
        RAYALGO_SCORE_STUDY_HORIZONS.map((horizon) => [
          horizon.key,
          buildOverallHorizonSummary(directionRecords, horizon.key),
        ]),
      );
      const overallHeadline = horizonSummaries[RAYALGO_SCORE_STUDY_HEADLINE_HORIZON];
      const preferenceComparison = buildForwardPreferenceComparison(horizonSummaries);
      const recommendations = buildRecommendations(preferenceComparison, directionRecords);
      const preferredScoreKey = recommendations.preferredScoreType === "raw" ? "rawScore" : "finalScore";
      const fewCandle = summarizeFewCandleMetrics(directionRecords);
      const headlineBlocks = buildForwardHeadlineBlocks(horizonSummaries, recommendations.preferredScoreType);
      const predictedScoreSummary = buildPredictedScoreSummary(directionRecords, recommendations.preferredScoreType);
      const validatedOutcomeSummary = buildValidatedOutcomeSummary(directionRecords, fewCandle);
      const timeframeHorizonRows = buildDirectionTimeframeHorizonRows(usableStudies, key, {
        overallSummary: { totalSignals: directionRecords.length, preferredScoreType: recommendations.preferredScoreType },
        preferredScoreType: recommendations.preferredScoreType,
        horizonSummaries,
      });
      const rankValiditySummary = buildRankValiditySummary({
        signalCount: directionRecords.length,
        preferredScoreType: recommendations.preferredScoreType,
        horizonSummaries,
        timeframeRows: timeframeHorizonRows,
      });
      return [
        key,
        {
          featureImpactSummaries: includeAdvancedDiagnostics ? buildFeatureImpactSummaries(directionRecords) : null,
          qualityFloorRecommendation: includeAdvancedDiagnostics ? buildQualityFloorRecommendation(directionRecords, preferredScoreKey) : null,
          precisionCoverageFrontier: includeAdvancedDiagnostics ? buildPrecisionCoverageFrontier(directionRecords, preferredScoreKey) : null,
          predictedScoreSummary,
          validatedOutcomeSummary,
          rankValiditySummary,
          timeframeHorizonRows,
          overallSummary: {
            totalSignals: directionRecords.length,
            timeframesAnalyzed: usableStudies.filter((study) => (study?.directions?.[key]?.signalCount || 0) > 0).length,
            preferredScoreType: recommendations.preferredScoreType,
            precursorEffect: recommendations.precursorEffect,
            renderAction: recommendations.renderAction,
            renderFloorScore: recommendations.renderFloorScore,
            headline: recommendations.headline,
            renderHeadline: recommendations.renderHeadline,
            headlineMeanPredictedRawScore: mean(directionRecords.map((record) => record.rawScore), 3),
            headlineMeanPredictedFinalScore: mean(directionRecords.map((record) => record.finalScore), 3),
            headlineMeanPredictedEffectiveScore: mean(directionRecords.map((record) => record.effectiveScore), 3),
            headlineMeanRealizedQualityScore: mean(directionRecords.map((record) => record.realizedQualityScore), 3),
            headlineValidatedQualityScore: validatedOutcomeSummary.validatedQualityScore,
            headlineMeanBestMoveAtr: validatedOutcomeSummary.bestMoveAtr,
            headlineMeanCloseResultAtr: validatedOutcomeSummary.closeResultAtr,
            headlineMeanDirectionCorrectPct: validatedOutcomeSummary.directionCorrectPct,
            headlineMeanStayedRightPct: validatedOutcomeSummary.stayedRightPct,
            headlineMeanFewCandleQualityScore: fewCandle.meanFewCandleQualityScore,
            headlineGuidanceRatePct: overallHeadline?.[recommendations.preferredScoreType]?.overall?.guidanceRatePct ?? null,
            headlineFewCandleCorrectRatePct: fewCandle.fewCandleCorrectRatePct,
            headlineSustainedCorrectRatePct: fewCandle.sustainedCorrectRatePct,
            headlineMeanExcursionEdgeAtr: overallHeadline?.[recommendations.preferredScoreType]?.overall?.meanExcursionEdgeAtr ?? null,
            headlineMeanExcursionEdgeBps: overallHeadline?.[recommendations.preferredScoreType]?.overall?.meanExcursionEdgeBps ?? null,
            headlineMeanCloseReturnAtr: overallHeadline?.[recommendations.preferredScoreType]?.overall?.meanCloseReturnAtr ?? null,
            headlineMeanCloseReturnBps: overallHeadline?.[recommendations.preferredScoreType]?.overall?.meanCloseReturnBps ?? null,
            headlineMeanMfeAtr: overallHeadline?.[recommendations.preferredScoreType]?.overall?.meanMfeAtr ?? null,
            headlineMeanMfeBps: overallHeadline?.[recommendations.preferredScoreType]?.overall?.meanMfeBps ?? null,
            headlineMeanMaeAtr: overallHeadline?.[recommendations.preferredScoreType]?.overall?.meanMaeAtr ?? null,
            headlineMeanMaeBps: overallHeadline?.[recommendations.preferredScoreType]?.overall?.meanMaeBps ?? null,
            headlineMeanRequestedClockMinutes: overallHeadline?.[recommendations.preferredScoreType]?.overall?.meanRequestedClockMinutes ?? null,
            headlineMeanEffectiveClockMinutes: overallHeadline?.[recommendations.preferredScoreType]?.overall?.meanEffectiveClockMinutes ?? null,
            headlineBlocks,
          },
          rawVsFinalComparison: preferenceComparison || overallHeadline?.comparison || null,
          horizonSummaries,
          timeframeSummaries: buildTimeframeSummaryRows(usableStudies, key),
          recommendations,
        },
      ];
    }),
  );
  const combinedSummary = directionSummaries.combined;
  const scoreValidity = {
    predictedScore: combinedSummary?.predictedScoreSummary || null,
    validatedOutcome: combinedSummary?.validatedOutcomeSummary || null,
    rankValidity: combinedSummary?.rankValiditySummary || null,
    timeframeHorizonRows: combinedSummary?.timeframeHorizonRows || [],
    directions: Object.fromEntries(
      RAYALGO_SCORE_STUDY_DIRECTIONS.map(({ key }) => [
        key,
        {
          predictedScore: directionSummaries[key]?.predictedScoreSummary || null,
          validatedOutcome: directionSummaries[key]?.validatedOutcomeSummary || null,
          rankValidity: directionSummaries[key]?.rankValiditySummary || null,
          timeframeHorizonRows: directionSummaries[key]?.timeframeHorizonRows || [],
        },
      ]),
    ),
  };
  return {
    studyMode: "forward",
    label: "Excursion Until Conflict",
    headlineHorizon: RAYALGO_SCORE_STUDY_HEADLINE_HORIZON,
    horizons: RAYALGO_SCORE_STUDY_HORIZONS.map(({ key, label, multiplier }) => ({ key, label, multiplier })),
    directionSummaries,
    scoreValidity,
    overallSummary: combinedSummary?.overallSummary || null,
    precisionCoverageFrontier: combinedSummary?.precisionCoverageFrontier || null,
    rawVsFinalComparison: combinedSummary?.rawVsFinalComparison || null,
    horizonSummaries: combinedSummary?.horizonSummaries || {},
    timeframeSummaries: combinedSummary?.timeframeSummaries || [],
    bucketTables: includeAdvancedDiagnostics ? {
      overall: Object.fromEntries(
        RAYALGO_SCORE_STUDY_DIRECTIONS.map(({ key }) => [
          key,
          Object.fromEntries(
            RAYALGO_SCORE_STUDY_SCORE_TYPES.map((scoreType) => [
              scoreType,
              Object.fromEntries(
                RAYALGO_SCORE_STUDY_HORIZONS.map((horizon) => [
                  horizon.key,
                  directionSummaries[key]?.horizonSummaries?.[horizon.key]?.[scoreType]?.rows || [],
                ]),
              ),
            ]),
          ),
        ]),
      ),
      timeframes: Object.fromEntries(
        usableStudies.map((study) => [
          study.timeframe,
          Object.fromEntries(
            RAYALGO_SCORE_STUDY_DIRECTIONS.map(({ key }) => [
              key,
              Object.fromEntries(
                RAYALGO_SCORE_STUDY_SCORE_TYPES.map((scoreType) => [
                  scoreType,
                  Object.fromEntries(
                    RAYALGO_SCORE_STUDY_HORIZONS.map((horizon) => [
                      horizon.key,
                      study?.directions?.[key]?.horizons?.[horizon.key]?.[scoreType]?.rows || [],
                    ]),
                  ),
                ]),
              ),
            ]),
          ),
        ]),
      ),
    } : null,
    timeframeDetails: Object.fromEntries(
      usableStudies.map((study) => [
        study.timeframe,
        {
          timeframe: study.timeframe,
          tfMinutes: study.tfMinutes,
          signalCount: study.signalCount,
          signalClassSummaries: includeAdvancedDiagnostics ? buildSignalClassSummaries(study?.signalClassRecords || []) : null,
          preferredScoreType: study.preferredScoreType,
          renderRecommendation: study.renderRecommendation,
          horizons: study.horizons,
          directions: study.directions,
        },
      ]),
    ),
    recommendations: combinedSummary?.recommendations || null,
  };
}

function buildTenureStudyMode(usableStudies = [], overallRecords = [], {
  includeAdvancedDiagnostics = false,
} = {}) {
  const directionSummaries = Object.fromEntries(
    RAYALGO_SCORE_STUDY_DIRECTIONS.map(({ key }) => {
      const directionRecords = filterRecordsByDirection(overallRecords, key);
      const horizonSummaries = Object.fromEntries(
        RAYALGO_SCORE_STUDY_TENURE_HORIZONS.map((horizon) => [
          horizon.key,
          buildOverallTenureHorizonSummary(directionRecords, horizon.key),
        ]),
      );
      const overallHeadline = horizonSummaries[RAYALGO_SCORE_STUDY_HEADLINE_HORIZON];
      const recommendations = buildTenureRecommendations(overallHeadline, directionRecords);
      const preferredScoreKey = recommendations.preferredScoreType === "raw" ? "rawScore" : "finalScore";
      return [
        key,
        {
          featureImpactSummaries: includeAdvancedDiagnostics ? buildFeatureImpactSummaries(directionRecords) : null,
          qualityFloorRecommendation: includeAdvancedDiagnostics ? buildQualityFloorRecommendation(directionRecords, preferredScoreKey) : null,
          overallSummary: {
            totalSignals: directionRecords.length,
            timeframesAnalyzed: usableStudies.filter((study) => (study?.tenureDirections?.[key]?.signalCount || 0) > 0).length,
            preferredScoreType: recommendations.preferredScoreType,
            precursorEffect: recommendations.precursorEffect,
            renderAction: recommendations.renderAction,
            renderFloorScore: recommendations.renderFloorScore,
            headline: recommendations.headline,
            renderHeadline: recommendations.renderHeadline,
            headlineMeanPredictedRawScore: mean(directionRecords.map((record) => record.rawScore), 3),
            headlineMeanPredictedFinalScore: mean(directionRecords.map((record) => record.finalScore), 3),
            headlineMeanPredictedEffectiveScore: mean(directionRecords.map((record) => record.effectiveScore), 3),
            headlineMeanRealizedQualityScore: mean(directionRecords.map((record) => record.realizedQualityScore), 3),
            headlineMajorityCorrectRatePct: overallHeadline?.[recommendations.preferredScoreType]?.overall?.majorityCorrectRatePct ?? null,
            headlineMeanTenurePct: overallHeadline?.[recommendations.preferredScoreType]?.overall?.meanTenurePct ?? null,
            headlineMeanEligibleBars: overallHeadline?.[recommendations.preferredScoreType]?.overall?.meanEligibleBars ?? null,
            headlineMeanRequestedClockMinutes: overallHeadline?.[recommendations.preferredScoreType]?.overall?.meanRequestedClockMinutes ?? null,
            headlineMeanEligibleClockMinutes: overallHeadline?.[recommendations.preferredScoreType]?.overall?.meanEligibleClockMinutes ?? null,
            headlineContrarianStopRatePct: overallHeadline?.[recommendations.preferredScoreType]?.overall?.contrarianStopRatePct ?? null,
          },
          rawVsFinalComparison: overallHeadline?.comparison || null,
          horizonSummaries,
          timeframeSummaries: buildTenureTimeframeSummaryRows(usableStudies, key),
          recommendations,
        },
      ];
    }),
  );
  const combinedSummary = directionSummaries.combined;
  return {
    studyMode: "tenure",
    label: "Directional Tenure",
    headlineHorizon: RAYALGO_SCORE_STUDY_HEADLINE_HORIZON,
    horizons: RAYALGO_SCORE_STUDY_TENURE_HORIZONS.map(({ key, label, multiplier }) => ({ key, label, multiplier })),
    directionSummaries,
    overallSummary: combinedSummary?.overallSummary || null,
    rawVsFinalComparison: combinedSummary?.rawVsFinalComparison || null,
    horizonSummaries: combinedSummary?.horizonSummaries || {},
    timeframeSummaries: combinedSummary?.timeframeSummaries || [],
    bucketTables: includeAdvancedDiagnostics ? {
      overall: Object.fromEntries(
        RAYALGO_SCORE_STUDY_DIRECTIONS.map(({ key }) => [
          key,
          Object.fromEntries(
            RAYALGO_SCORE_STUDY_SCORE_TYPES.map((scoreType) => [
              scoreType,
              Object.fromEntries(
                RAYALGO_SCORE_STUDY_TENURE_HORIZONS.map((horizon) => [
                  horizon.key,
                  directionSummaries[key]?.horizonSummaries?.[horizon.key]?.[scoreType]?.rows || [],
                ]),
              ),
            ]),
          ),
        ]),
      ),
      timeframes: Object.fromEntries(
        usableStudies.map((study) => [
          study.timeframe,
          Object.fromEntries(
            RAYALGO_SCORE_STUDY_DIRECTIONS.map(({ key }) => [
              key,
              Object.fromEntries(
                RAYALGO_SCORE_STUDY_SCORE_TYPES.map((scoreType) => [
                  scoreType,
                  Object.fromEntries(
                    RAYALGO_SCORE_STUDY_TENURE_HORIZONS.map((horizon) => [
                      horizon.key,
                      study?.tenureDirections?.[key]?.horizons?.[horizon.key]?.[scoreType]?.rows || [],
                    ]),
                  ),
                ]),
              ),
            ]),
          ),
        ]),
      ),
    } : null,
    timeframeDetails: Object.fromEntries(
      usableStudies.map((study) => [
        study.timeframe,
        {
          timeframe: study.timeframe,
          tfMinutes: study.tfMinutes,
          signalCount: study.signalCount,
          signalClassSummaries: includeAdvancedDiagnostics ? buildSignalClassSummaries(study?.signalClassRecords || []) : null,
          preferredScoreType: study.tenurePreferredScoreType,
          renderRecommendation: study.tenureRenderRecommendation,
          horizons: study.tenureHorizons,
          directions: study.tenureDirections,
        },
      ]),
    ),
    recommendations: combinedSummary?.recommendations || null,
  };
}

function buildSignalClassDirectionalSummary(records = []) {
  const forwardHeadline = buildOverallHorizonSummary(records, RAYALGO_SCORE_STUDY_HEADLINE_HORIZON);
  const forwardPreferenceComparison = buildForwardPreferenceComparison(
    Object.fromEntries(
      RAYALGO_SCORE_STUDY_HORIZONS.map((horizon) => [horizon.key, buildOverallHorizonSummary(records, horizon.key)]),
    ),
  );
  const forwardRecommendations = buildRecommendations(forwardPreferenceComparison, records);
  const forwardHeadlineBlocks = buildForwardHeadlineBlocks(
    Object.fromEntries(
      RAYALGO_SCORE_STUDY_HORIZONS.map((horizon) => [horizon.key, buildOverallHorizonSummary(records, horizon.key)]),
    ),
    forwardRecommendations.preferredScoreType,
  );
  const tenureHeadline = buildOverallTenureHorizonSummary(records, RAYALGO_SCORE_STUDY_HEADLINE_HORIZON);
  const tenureRecommendations = buildTenureRecommendations(tenureHeadline, records);
  const preferredScoreKey = forwardRecommendations.preferredScoreType === "raw" ? "rawScore" : "finalScore";
  const fewCandle = summarizeFewCandleMetrics(records);
  const scoreTrustAudit = buildScoreTrustAudit(records, {
    preferredScoreKey,
    forwardStudy: null,
    featureImpactSummaries: buildFeatureImpactSummaries(records),
    precisionCoverageFrontier: buildPrecisionCoverageFrontier(records, preferredScoreKey),
  });
  return {
    totalSignals: records.length,
    featureImpactSummaries: buildFeatureImpactSummaries(records),
    qualityFloorRecommendation: buildQualityFloorRecommendation(records, preferredScoreKey),
    precisionCoverageFrontier: buildPrecisionCoverageFrontier(records, preferredScoreKey),
    scoreTrustAudit,
    scoreDistributions: {
      raw: buildScoreDistribution(records, "rawScore"),
      final: buildScoreDistribution(records, "finalScore"),
      effective: buildScoreDistribution(records, "effectiveScore"),
      realizedQuality: buildScoreDistribution(records, "realizedQualityScore"),
      fewCandleQuality: buildScoreDistribution(records, "fewCandleQualityScore"),
    },
    forward: {
      preferredScoreType: forwardRecommendations.preferredScoreType,
      precursorEffect: forwardRecommendations.precursorEffect,
      rawVsFinalComparison: forwardPreferenceComparison || forwardHeadline?.comparison || null,
      bucketCoverage: {
        raw: buildBucketCoverage(forwardHeadline?.raw?.rows || [], forwardHeadline?.raw?.evaluation || null),
        final: buildBucketCoverage(forwardHeadline?.final?.rows || [], forwardHeadline?.final?.evaluation || null),
        effective: buildBucketCoverage(forwardHeadline?.effective?.rows || [], forwardHeadline?.effective?.evaluation || null),
      },
      overallSummary: {
        headline: forwardRecommendations.headline,
        renderHeadline: forwardRecommendations.renderHeadline,
        renderAction: forwardRecommendations.renderAction,
        renderFloorScore: forwardRecommendations.renderFloorScore,
        headlineMeanPredictedRawScore: mean(records.map((record) => record.rawScore), 3),
        headlineMeanPredictedFinalScore: mean(records.map((record) => record.finalScore), 3),
        headlineMeanPredictedEffectiveScore: mean(records.map((record) => record.effectiveScore), 3),
        headlineMeanRealizedQualityScore: mean(records.map((record) => record.realizedQualityScore), 3),
        headlineMeanFewCandleQualityScore: fewCandle.meanFewCandleQualityScore,
        headlineGuidanceRatePct: forwardHeadline?.[forwardRecommendations.preferredScoreType]?.overall?.guidanceRatePct ?? null,
        headlineFewCandleCorrectRatePct: fewCandle.fewCandleCorrectRatePct,
        headlineSustainedCorrectRatePct: fewCandle.sustainedCorrectRatePct,
        headlineMeanExcursionEdgeAtr: forwardHeadline?.[forwardRecommendations.preferredScoreType]?.overall?.meanExcursionEdgeAtr ?? null,
        headlineMeanExcursionEdgeBps: forwardHeadline?.[forwardRecommendations.preferredScoreType]?.overall?.meanExcursionEdgeBps ?? null,
        headlineMeanCloseReturnAtr: forwardHeadline?.[forwardRecommendations.preferredScoreType]?.overall?.meanCloseReturnAtr ?? null,
        headlineMeanCloseReturnBps: forwardHeadline?.[forwardRecommendations.preferredScoreType]?.overall?.meanCloseReturnBps ?? null,
        headlineBlocks: forwardHeadlineBlocks,
      },
    },
    tenure: {
      preferredScoreType: tenureRecommendations.preferredScoreType,
      precursorEffect: tenureRecommendations.precursorEffect,
      rawVsFinalComparison: tenureHeadline?.comparison || null,
      bucketCoverage: {
        raw: buildBucketCoverage(tenureHeadline?.raw?.rows || [], tenureHeadline?.raw?.evaluation || null),
        final: buildBucketCoverage(tenureHeadline?.final?.rows || [], tenureHeadline?.final?.evaluation || null),
        effective: buildBucketCoverage(tenureHeadline?.effective?.rows || [], tenureHeadline?.effective?.evaluation || null),
      },
      overallSummary: {
        headline: tenureRecommendations.headline,
        renderHeadline: tenureRecommendations.renderHeadline,
        renderAction: tenureRecommendations.renderAction,
        renderFloorScore: tenureRecommendations.renderFloorScore,
        headlineMeanPredictedRawScore: mean(records.map((record) => record.rawScore), 3),
        headlineMeanPredictedFinalScore: mean(records.map((record) => record.finalScore), 3),
        headlineMeanPredictedEffectiveScore: mean(records.map((record) => record.effectiveScore), 3),
        headlineMeanRealizedQualityScore: mean(records.map((record) => record.realizedQualityScore), 3),
        headlineMajorityCorrectRatePct: tenureHeadline?.[tenureRecommendations.preferredScoreType]?.overall?.majorityCorrectRatePct ?? null,
        headlineMeanTenurePct: tenureHeadline?.[tenureRecommendations.preferredScoreType]?.overall?.meanTenurePct ?? null,
        headlineMeanEligibleBars: tenureHeadline?.[tenureRecommendations.preferredScoreType]?.overall?.meanEligibleBars ?? null,
        headlineContrarianStopRatePct: tenureHeadline?.[tenureRecommendations.preferredScoreType]?.overall?.contrarianStopRatePct ?? null,
      },
    },
  };
}

function buildSignalClassSummaries(records = []) {
  return Object.fromEntries(
    RAYALGO_SCORE_STUDY_SIGNAL_CLASSES.map(({ key, label }) => {
      const classRecords = filterRecordsBySignalClass(records, key);
      const directions = Object.fromEntries(
        RAYALGO_SCORE_STUDY_DIRECTIONS.map(({ key: directionKey }) => [
          directionKey,
          buildSignalClassDirectionalSummary(filterRecordsByDirection(classRecords, directionKey)),
        ]),
      );
      return [
        key,
        {
          signalClass: key,
          label,
          totalSignals: classRecords.length,
          featureImpactSummaries: buildFeatureImpactSummaries(classRecords),
          subtypeSummaries: null,
          directions,
        },
      ];
    }),
  );
}

export function buildRayAlgoScoreStudy({
  marketSymbol = "SPY",
  bars = [],
  rayalgoSettings = null,
  rayalgoScoringConfig = null,
  timeframes = SIGNAL_OVERLAY_TIMEFRAME_OPTIONS,
  onProgress = null,
  shouldCancel = null,
  includeAdvancedDiagnostics = false,
} = {}) {
  const rawBars = Array.isArray(bars) ? bars : [];
  if (rawBars.length < 180) {
    return {
      status: "error",
      error: "At least 180 spot bars are required for the RayAlgo score study.",
    };
  }

  const normalizedSettings = normalizeRayAlgoSettings(rayalgoSettings || {});
  const sourceBarMinutes = inferSourceBarMinutes(rawBars);
  const warnings = [];
  const requestedTimeframes = Array.isArray(timeframes) && timeframes.length
    ? timeframes
    : SIGNAL_OVERLAY_TIMEFRAME_OPTIONS;
  const supportedTimeframes = requestedTimeframes.filter((timeframe) => {
    const minutes = timeframeToMinutes(timeframe);
    return Number.isFinite(minutes) && (!Number.isFinite(sourceBarMinutes) || minutes >= sourceBarMinutes);
  });
  const skippedTimeframes = requestedTimeframes.filter((timeframe) => !supportedTimeframes.includes(timeframe));
  if (skippedTimeframes.length) {
    warnings.push(`Skipped ${skippedTimeframes.join(", ")} because the loaded spot history is coarser than those timeframes.`);
  }

  emitScoreStudyProgress(onProgress, shouldCancel, {
    stage: "Preparing analysis",
    detail: `Analyzing ${supportedTimeframes.length || 0} timeframe${supportedTimeframes.length === 1 ? "" : "s"} from ${rawBars.length.toLocaleString()} bars.`,
    pct: 8,
  });

  const timeframeStudies = [];
  supportedTimeframes.forEach((timeframe, index) => {
    emitScoreStudyProgress(onProgress, shouldCancel, {
      stage: "Analyzing timeframes",
      detail: `Analyzing ${timeframe} (${index + 1}/${Math.max(supportedTimeframes.length, 1)}).`,
      pct: 8 + Math.round(((index + 1) / Math.max(supportedTimeframes.length, 1)) * 28),
      current: index + 1,
      total: Math.max(supportedTimeframes.length, 1),
      timeframe,
    });
    const study = buildTimeframeStudy({
      marketSymbol,
      timeframe,
      rawBars,
      rayalgoSettings: normalizedSettings,
      scoringPreferences: rayalgoScoringConfig,
    });
    if (study) {
      timeframeStudies.push(study);
    }
  });
  const usableStudies = timeframeStudies.filter((study) => !study.skipped);
  if (!usableStudies.length) {
    return {
      status: "error",
      error: "No RayAlgo score-study timeframes had enough bars to analyze.",
      warnings,
    };
  }

  emitScoreStudyProgress(onProgress, shouldCancel, {
    stage: "Computing outcomes",
    detail: `Computing forward and tenure outcomes for ${usableStudies.length} usable timeframe${usableStudies.length === 1 ? "" : "s"}.`,
    pct: 40,
  });

  applyForwardAndTenureOutcomesToStudies(usableStudies, {
    onProgress,
    shouldCancel,
    includeAdvancedDiagnostics,
  });

  emitScoreStudyProgress(onProgress, shouldCancel, {
    stage: "Building summaries",
    detail: "Building forward summary diagnostics.",
    pct: 92,
  });
  const overallRecords = flattenStudyRecords(usableStudies);
  const overallSignalClassRecords = flattenStudySignalClassRecords(usableStudies);
  const forwardStudy = buildForwardStudyMode(usableStudies, overallRecords, { includeAdvancedDiagnostics });
  emitScoreStudyProgress(onProgress, shouldCancel, {
    stage: "Building summaries",
    detail: "Building tenure summary diagnostics.",
    pct: 93,
  });
  const tenureStudy = buildTenureStudyMode(usableStudies, overallRecords, { includeAdvancedDiagnostics });
  emitScoreStudyProgress(onProgress, shouldCancel, {
    stage: "Building summaries",
    detail: "Building signal-class and feature-impact diagnostics.",
    pct: 94,
  });
  const signalClassSummaries = includeAdvancedDiagnostics ? buildSignalClassSummaries(overallSignalClassRecords) : null;
  const featureImpactSummaries = includeAdvancedDiagnostics ? buildFeatureImpactSummaries(overallSignalClassRecords) : null;
  emitScoreStudyProgress(onProgress, shouldCancel, {
    stage: "Building summaries",
    detail: "Building contrarian invalidation diagnostics.",
    pct: 95,
  });
  const contrarianPolicyComparison = includeAdvancedDiagnostics ? buildContrarianPolicyComparison(usableStudies, overallRecords, {
    onProgress,
    shouldCancel,
    progressBasePct: 96,
    progressRangePct: 1,
  }) : null;
  emitScoreStudyProgress(onProgress, shouldCancel, {
    stage: "Building summaries",
    detail: "Building score floor, frontier, and trust diagnostics.",
    pct: 97,
  });
  const qualityFloorRecommendation = includeAdvancedDiagnostics ? buildQualityFloorRecommendation(
    overallRecords,
    forwardStudy?.overallSummary?.preferredScoreType === "raw" ? "rawScore" : "finalScore",
  ) : null;
  const firstBar = rawBars[0] || null;
  const lastBar = rawBars[rawBars.length - 1] || null;
  const precisionCoverageFrontier = includeAdvancedDiagnostics ? buildPrecisionCoverageFrontier(
    overallRecords,
    forwardStudy?.overallSummary?.preferredScoreType === "raw" ? "rawScore" : "finalScore",
  ) : null;
  const scoreTrustAudit = includeAdvancedDiagnostics ? buildScoreTrustAudit(overallRecords, {
    preferredScoreKey: forwardStudy?.overallSummary?.preferredScoreType === "raw" ? "rawScore" : "finalScore",
    forwardStudy,
    featureImpactSummaries,
    precisionCoverageFrontier,
  }) : null;

  emitScoreStudyProgress(onProgress, shouldCancel, {
    stage: "Packing result",
    detail: "Finalizing the score-study payload.",
    pct: 98,
  });

  return {
    status: "ready",
    metadata: {
      marketSymbol: String(marketSymbol || "SPY").toUpperCase(),
      signalCount: overallRecords.length,
      barCount: rawBars.length,
      sourceBarMinutes,
      barStartTs: firstBar?.ts || null,
      barEndTs: lastBar?.ts || null,
      requestedTimeframes,
      analyzedTimeframes: usableStudies.map((study) => study.timeframe),
      skippedTimeframes,
      signalClasses: RAYALGO_SCORE_STUDY_SIGNAL_CLASSES.map(({ key, label }) => ({ key, label })),
      signalClassCounts: Object.fromEntries(
        RAYALGO_SCORE_STUDY_SIGNAL_CLASSES.map(({ key }) => [
          key,
          filterRecordsBySignalClass(overallSignalClassRecords, key).length,
        ]),
      ),
      scoringVersion: overallRecords.find((record) => record.scoringVersion)?.scoringVersion || null,
      headlineHorizon: RAYALGO_SCORE_STUDY_HEADLINE_HORIZON,
      forwardHeadlineBlocks: FORWARD_HEADLINE_BLOCKS.map((block) => ({
        key: block.key,
        label: block.label,
        horizons: [...block.horizons],
      })),
      fewCandleDefinition: {
        guidanceHorizon: FEW_CANDLE_GUIDANCE_HORIZON,
        tenureHorizon: FEW_CANDLE_TENURE_HORIZON,
        minimumTenurePct: FEW_CANDLE_MIN_TENURE_PCT,
        sustainedGuidanceHorizon: SUSTAINED_GUIDANCE_HORIZON,
        sustainedTenureHorizon: SUSTAINED_TENURE_HORIZON,
        sustainedMinimumTenurePct: SUSTAINED_MIN_TENURE_PCT,
        targetFewCandleCorrectRatePct: FEW_CANDLE_TARGET_RATE_PCT,
        coverageTiersPct: SCORE_COVERAGE_FRONTIER_TIERS.map((tier) => round(tier.coverageRatio * 100, 1)),
      },
      validatedQualityDefinition: {
        scoreUnit: "0-1",
        horizons: [...REALIZED_QUALITY_SHARED_HORIZONS],
        components: RAYALGO_VALIDATED_QUALITY_COMPONENTS,
        note: "Higher is better. This is the blended realized outcome the predicted score is trying to rank before the trade plays out.",
      },
      validationLayers: {
        predictedScore: "rawScore / finalScore / effectiveScore are predictor outputs before the trade plays out.",
        validatedOutcome: "Validated quality is the blended realized outcome after the signal plays out.",
        diagnostics: "Best Move, Close Result, Direction Correct, Stayed Right, few-candle checks, and bucket/frontier views explain why the validated outcome is strong or weak.",
      },
      includeAdvancedDiagnostics,
      defaultStudyMode: RAYALGO_SCORE_STUDY_DEFAULT_MODE,
      studyModes: Object.fromEntries(
        RAYALGO_SCORE_STUDY_MODES.map(({ key, label }) => [
          key,
          {
            key,
            label,
            headlineHorizon: key === "tenure" ? RAYALGO_SCORE_STUDY_HEADLINE_HORIZON : RAYALGO_SCORE_STUDY_HEADLINE_HORIZON,
            horizons: (key === "tenure" ? RAYALGO_SCORE_STUDY_TENURE_HORIZONS : RAYALGO_SCORE_STUDY_HORIZONS)
              .map(({ key: horizonKey, label: horizonLabel, multiplier }) => ({
                key: horizonKey,
                label: horizonLabel,
                multiplier,
              })),
          },
        ]),
      ),
      horizonSemantics: {
        note: "Each horizon uses internal bars of the active timeframe. Example: 120x on 1m = 120 one-minute bars, while 120x on 2m = 120 two-minute bars (240 minutes).",
        timeframeWindowMinutes: buildTimeframeHorizonWindowMinutes(usableStudies),
      },
      bucketSampleFloor: MIN_BUCKET_SAMPLE,
      scoringPreferences: normalizeRayAlgoScoringPreferences(rayalgoScoringConfig || {}),
      scoringConfigPreview: normalizeRayAlgoScoringConfig({
        ...(rayalgoScoringConfig || {}),
        marketSymbol: String(marketSymbol || "SPY").toUpperCase(),
        activeTimeframe: usableStudies[0]?.timeframe || "5m",
      }),
      scoringConfigPreviewByTimeframe: Object.fromEntries(
        usableStudies.map((study) => [
          study.timeframe,
          normalizeRayAlgoScoringConfig({
            ...(rayalgoScoringConfig || {}),
            marketSymbol: String(marketSymbol || "SPY").toUpperCase(),
            activeTimeframe: study.timeframe,
          }),
        ]),
      ),
      contrarianPolicyComparison: contrarianPolicyComparison ? {
        scoreBasis: contrarianPolicyComparison.scoreBasis,
        floorGrid: contrarianPolicyComparison.floorGrid,
        marginGrid: contrarianPolicyComparison.marginGrid,
        precursorMinimumBump: contrarianPolicyComparison.precursorMinimumBump,
        precursorMarginBump: contrarianPolicyComparison.precursorMarginBump,
        families: Object.values(contrarianPolicyComparison.families || {}).map((family) => ({
          family: family.family,
          bestPolicyId: family.best?.policyId || null,
          configCount: Array.isArray(family.configs) ? family.configs.length : 0,
        })),
      } : null,
      scoreTrustAudit: scoreTrustAudit ? {
        status: scoreTrustAudit.status,
        headline: scoreTrustAudit.headline,
        preferredScoreKey: scoreTrustAudit.preferredScoreKey,
      } : null,
    },
    warnings,
    studyModes: {
      forward: {
        ...forwardStudy,
        contrarianPolicyComparison,
      },
      tenure: {
        ...tenureStudy,
        contrarianPolicyComparison,
      },
    },
    directionSummaries: forwardStudy.directionSummaries,
    scoreValidity: forwardStudy.scoreValidity,
    overallSummary: forwardStudy.overallSummary,
    rawVsFinalComparison: forwardStudy.rawVsFinalComparison,
    horizonSummaries: forwardStudy.horizonSummaries,
    timeframeSummaries: forwardStudy.timeframeSummaries,
    bucketTables: forwardStudy.bucketTables,
    timeframeDetails: forwardStudy.timeframeDetails,
    signalClassSummaries,
    featureImpactSummaries,
    contrarianPolicyComparison,
    qualityFloorRecommendation,
    precisionCoverageFrontier,
    scoreTrustAudit,
    recommendations: forwardStudy.recommendations,
  };
}
