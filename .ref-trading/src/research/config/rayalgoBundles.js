import { resolveDefaultVisibleRangeForTimeframe } from "../chart/timeframeModel.js";
import { DEFAULT_CHART_TYPE, normalizeChartType } from "../chart/volumeChartType.js";
import { clampStrikeSlot } from "../options/strikeSelection.js";
import { DEFAULT_RAYALGO_SETTINGS, normalizeRayAlgoSettings } from "./rayalgoSettings.js";
import { normalizeRayAlgoScoringPreferences } from "../engine/rayalgoScoring.js";

export const RAYALGO_BUNDLE_TIER_ORDER = ["test", "experimental", "core"];
export const RAYALGO_BUNDLE_TIER_LABELS = {
  test: "Test",
  experimental: "Experimental",
  core: "Core",
};
export const RAYALGO_BUNDLE_DIRECTION_LABELS = {
  call: "Calls",
  put: "Puts",
};

const DEFAULT_INDICATOR_OVERLAYS = {
  signals: { visible: true, timeframe: "follow_chart", mode: "follow_chart" },
  shading: { visible: true, timeframe: "5m", mode: "until_opposite_signal" },
};
const DEFAULT_EVALUATION = {
  tier: "test",
  tierSuggestion: "test",
  trades: null,
  expectancyR: null,
  maxDrawdownPct: null,
  winRatePct: null,
  profitFactor: null,
  netReturnPct: null,
  avgHoldBars: null,
  holdoutExpectancyR: null,
  holdoutProfitFactor: null,
  holdoutMaxDrawdownPct: null,
  sessionBadges: [],
  regimeBadges: [],
  statusText: "Awaiting validation",
  experimentalEligible: false,
  coreEligible: false,
};
const DEFAULT_PLAYBOOK = {
  contractStyle: "ATM",
  dteLabel: "--",
  horizonLabel: "Session",
  sessionBias: "Any",
  windowLabel: "--",
  note: "",
};
const FAMILY_ORDER = {
  "1m scalp": 10,
  "2m scalp": 20,
  "5m core": 30,
  "15m swing": 40,
};

function normalizeText(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function normalizeTier(value) {
  const normalized = normalizeText(value).toLowerCase();
  return RAYALGO_BUNDLE_TIER_ORDER.includes(normalized) ? normalized : "test";
}

function normalizeDirection(value) {
  const normalized = normalizeText(value).toLowerCase();
  return normalized === "put" ? "put" : "call";
}

function normalizeMetric(value, precision = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return +numeric.toFixed(precision);
}

function normalizeWhole(value) {
  const numeric = Math.round(Number(value));
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const next = [];
  value.forEach((entry) => {
    const normalized = normalizeText(entry);
    if (!normalized || next.includes(normalized)) {
      return;
    }
    next.push(normalized);
  });
  return next;
}

function normalizeIndicatorOverlays(value = {}, chartTf = "5m") {
  const signals = value?.signals || {};
  const shading = value?.shading || {};
  const rawSignalTimeframe = normalizeText(signals.timeframe, DEFAULT_INDICATOR_OVERLAYS.signals.timeframe);
  const signalMode = normalizeText(signals.mode, rawSignalTimeframe === "follow_chart" ? "follow_chart" : "pinned").toLowerCase() === "pinned"
    ? "pinned"
    : "follow_chart";

  return {
    signals: {
      visible: signals.visible !== false,
      timeframe: signalMode === "pinned" && rawSignalTimeframe !== "follow_chart"
        ? rawSignalTimeframe
        : "follow_chart",
      mode: signalMode,
    },
    shading: {
      visible: shading.visible !== false,
      timeframe: normalizeText(shading.timeframe, chartTf),
      mode: "until_opposite_signal",
    },
  };
}

function normalizeChartWindowMode(value) {
  return normalizeText(value).toLowerCase() === "custom" ? "custom" : "default";
}

function normalizeChartSetup(chartSetup = {}) {
  const candleTf = normalizeText(chartSetup.candleTf, "5m");
  return {
    candleTf,
    optionCandleTf: normalizeText(chartSetup.optionCandleTf, candleTf),
    spotChartType: normalizeChartType(chartSetup.spotChartType, DEFAULT_CHART_TYPE),
    optionChartType: normalizeChartType(chartSetup.optionChartType, DEFAULT_CHART_TYPE),
    chartRange: normalizeText(chartSetup.chartRange, resolveDefaultVisibleRangeForTimeframe(candleTf, "1M")),
    chartWindowMode: normalizeChartWindowMode(chartSetup.chartWindowMode),
    indicatorOverlays: normalizeIndicatorOverlays(chartSetup.indicatorOverlays, candleTf),
  };
}

function normalizeBacktestSetup(backtestSetup = {}, direction = "call") {
  const strikeSlot = backtestSetup?.optionStrikeSlot;
  return {
    strategy: "rayalgo",
    direction: normalizeDirection(backtestSetup.direction || direction),
    executionFidelity: normalizeText(backtestSetup.executionFidelity, "sub_candle").toLowerCase() === "bar_close"
      ? "bar_close"
      : "sub_candle",
    dte: Math.max(0, Math.min(10, Math.round(Number(backtestSetup.dte) || 0))),
    optionStrikeSlot: strikeSlot == null ? null : clampStrikeSlot(strikeSlot),
    slPct: normalizeMetric(backtestSetup.slPct, 2),
    tpPct: normalizeMetric(backtestSetup.tpPct, 2),
    trailStartPct: normalizeMetric(backtestSetup.trailStartPct, 2),
    trailPct: normalizeMetric(backtestSetup.trailPct, 2),
    allowShorts: backtestSetup.allowShorts === true || normalizeDirection(backtestSetup.direction || direction) === "put",
    minConviction: normalizeMetric(backtestSetup.minConviction, 2),
    zombieBars: Math.max(1, Math.round(Number(backtestSetup.zombieBars) || 20)),
    regimeFilter: normalizeText(backtestSetup.regimeFilter, "none") || "none",
    rayalgoScoringConfig: normalizeRayAlgoScoringPreferences(
      backtestSetup.rayalgoScoringConfig || backtestSetup.scoringConfig || {},
    ),
  };
}

function normalizeEvaluation(evaluation = {}) {
  return {
    tier: normalizeTier(evaluation.tier),
    tierSuggestion: normalizeTier(evaluation.tierSuggestion),
    trades: normalizeWhole(evaluation.trades),
    expectancyR: normalizeMetric(evaluation.expectancyR, 2),
    maxDrawdownPct: normalizeMetric(evaluation.maxDrawdownPct, 1),
    winRatePct: normalizeMetric(evaluation.winRatePct, 1),
    profitFactor: normalizeMetric(evaluation.profitFactor, 2),
    netReturnPct: normalizeMetric(evaluation.netReturnPct, 1),
    avgHoldBars: normalizeMetric(evaluation.avgHoldBars, 1),
    holdoutExpectancyR: normalizeMetric(evaluation.holdoutExpectancyR, 2),
    holdoutProfitFactor: normalizeMetric(evaluation.holdoutProfitFactor, 2),
    holdoutMaxDrawdownPct: normalizeMetric(evaluation.holdoutMaxDrawdownPct, 1),
    sessionBadges: normalizeStringList(evaluation.sessionBadges),
    regimeBadges: normalizeStringList(evaluation.regimeBadges),
    statusText: normalizeText(evaluation.statusText, DEFAULT_EVALUATION.statusText),
    experimentalEligible: Boolean(evaluation.experimentalEligible),
    coreEligible: Boolean(evaluation.coreEligible),
  };
}

function normalizePlaybook(playbook = {}) {
  return {
    contractStyle: normalizeText(playbook.contractStyle, DEFAULT_PLAYBOOK.contractStyle),
    dteLabel: normalizeText(playbook.dteLabel, DEFAULT_PLAYBOOK.dteLabel),
    horizonLabel: normalizeText(playbook.horizonLabel, DEFAULT_PLAYBOOK.horizonLabel),
    sessionBias: normalizeText(playbook.sessionBias, DEFAULT_PLAYBOOK.sessionBias),
    windowLabel: normalizeText(playbook.windowLabel, DEFAULT_PLAYBOOK.windowLabel),
    note: normalizeText(playbook.note, DEFAULT_PLAYBOOK.note),
  };
}

export function normalizeRayAlgoBundle(bundle = {}, symbolFallback = "SPY") {
  const symbol = normalizeText(bundle.symbol, normalizeText(symbolFallback, "SPY")).toUpperCase();
  const direction = normalizeDirection(bundle.direction);
  const chartSetup = normalizeChartSetup(bundle.chartSetup || {});
  const backtestSetup = normalizeBacktestSetup(bundle.backtestSetup || {}, direction);
  const timeframeFamily = normalizeText(bundle.timeframeFamily, `${chartSetup.candleTf} ${direction === "put" ? "puts" : "calls"}`);
  const label = normalizeText(bundle.label, `${symbol} ${timeframeFamily}`);
  return {
    id: normalizeText(bundle.id, `${symbol.toLowerCase()}-${direction}-${timeframeFamily.replace(/\s+/g, "-")}`),
    label,
    symbol,
    direction,
    timeframeFamily,
    variantOf: normalizeText(bundle.variantOf, "") || null,
    rayalgoSettings: normalizeRayAlgoSettings(bundle.rayalgoSettings || DEFAULT_RAYALGO_SETTINGS),
    chartSetup,
    backtestSetup,
    evaluation: {
      ...DEFAULT_EVALUATION,
      ...normalizeEvaluation(bundle.evaluation || {}),
    },
    playbook: {
      ...DEFAULT_PLAYBOOK,
      ...normalizePlaybook(bundle.playbook || {}),
    },
    notes: normalizeStringList(bundle.notes),
  };
}

function buildSeedBundle({
  symbol = "SPY",
  id,
  label,
  direction = "call",
  timeframeFamily,
  rayalgoPatch = {},
  chartSetup = {},
  backtestSetup = {},
  evaluation = {},
  playbook = {},
  notes = [],
}) {
  return normalizeRayAlgoBundle({
    id,
    label,
    symbol,
    direction,
    timeframeFamily,
    rayalgoSettings: {
      ...DEFAULT_RAYALGO_SETTINGS,
      ...rayalgoPatch,
    },
    chartSetup,
    backtestSetup,
    evaluation,
    playbook,
    notes,
  }, symbol);
}

function buildDefaultBundlesForSymbol(symbol = "SPY") {
  const normalizedSymbol = normalizeText(symbol, "SPY").toUpperCase();
  return [
    buildSeedBundle({
      symbol: normalizedSymbol,
      id: `${normalizedSymbol.toLowerCase()}-call-2m-scalp`,
      label: `${normalizedSymbol} 2m Scalp Calls`,
      direction: "call",
      timeframeFamily: "2m scalp",
      rayalgoPatch: {
        marketStructure: { timeHorizon: 15, bosConfirmation: "close" },
        bands: { basisLength: 13, atrLength: 10, atrSmoothing: 10, volatilityMultiplier: 1.15 },
        confirmation: {
          adxLength: 14,
          volumeMaLength: 18,
          mtf1: "5m",
          mtf2: "15m",
          mtf3: "1h",
          requireMtf1: true,
          requireMtf2: false,
          requireMtf3: false,
          requireAdx: true,
          adxMin: 18,
          requireVolScoreRange: true,
          volScoreMin: 35,
          volScoreMax: 92,
          restrictToSelectedSessions: true,
          sessions: ["new_york_am"],
        },
      },
      chartSetup: {
        candleTf: "2m",
        optionCandleTf: "2m",
        chartRange: "1D",
        chartWindowMode: "default",
        indicatorOverlays: {
          signals: { visible: true, timeframe: "follow_chart", mode: "follow_chart" },
          shading: { visible: true, timeframe: "2m", mode: "until_opposite_signal" },
        },
      },
      backtestSetup: {
        direction: "call",
        executionFidelity: "sub_candle",
        dte: 0,
        optionStrikeSlot: 0,
        slPct: 0.18,
        tpPct: 0.45,
        trailStartPct: 0.10,
        trailPct: 0.12,
        allowShorts: false,
        minConviction: 0.46,
        zombieBars: 12,
        regimeFilter: "none",
      },
      evaluation: {
        tier: "test",
        sessionBadges: ["Open", "NY AM"],
        regimeBadges: ["Trend", "Momentum"],
      },
      playbook: {
        contractStyle: "ATM",
        dteLabel: "0-1D",
        horizonLabel: "Opening drive",
        sessionBias: "NY AM",
        windowLabel: "1D",
        note: "Fast directional bundle for early-session trend-change bursts.",
      },
      notes: ["Seed bundle", "Prioritize fast breaks with sub-candle execution."],
    }),
    buildSeedBundle({
      symbol: normalizedSymbol,
      id: `${normalizedSymbol.toLowerCase()}-put-2m-scalp`,
      label: `${normalizedSymbol} 2m Scalp Puts`,
      direction: "put",
      timeframeFamily: "2m scalp",
      rayalgoPatch: {
        marketStructure: { timeHorizon: 15, bosConfirmation: "wicks" },
        bands: { basisLength: 13, atrLength: 10, atrSmoothing: 10, volatilityMultiplier: 1.2 },
        confirmation: {
          adxLength: 14,
          volumeMaLength: 18,
          mtf1: "5m",
          mtf2: "15m",
          mtf3: "1h",
          requireMtf1: true,
          requireMtf2: true,
          requireMtf3: false,
          requireAdx: true,
          adxMin: 20,
          requireVolScoreRange: true,
          volScoreMin: 40,
          volScoreMax: 95,
          restrictToSelectedSessions: true,
          sessions: ["new_york_am", "new_york_pm"],
        },
      },
      chartSetup: {
        candleTf: "2m",
        optionCandleTf: "2m",
        chartRange: "1D",
        chartWindowMode: "default",
        indicatorOverlays: {
          signals: { visible: true, timeframe: "follow_chart", mode: "follow_chart" },
          shading: { visible: true, timeframe: "2m", mode: "until_opposite_signal" },
        },
      },
      backtestSetup: {
        direction: "put",
        executionFidelity: "sub_candle",
        dte: 0,
        optionStrikeSlot: 0,
        slPct: 0.16,
        tpPct: 0.42,
        trailStartPct: 0.08,
        trailPct: 0.10,
        allowShorts: true,
        minConviction: 0.47,
        zombieBars: 10,
        regimeFilter: "none",
      },
      evaluation: {
        tier: "test",
        sessionBadges: ["Open", "PM flush"],
        regimeBadges: ["Breakdown", "Trend"],
      },
      playbook: {
        contractStyle: "ATM",
        dteLabel: "0-1D",
        horizonLabel: "Fast downside",
        sessionBias: "Open / PM",
        windowLabel: "1D",
        note: "Use when downside momentum and tape pressure align quickly.",
      },
      notes: ["Seed bundle", "Short-duration downside bundle for fast breaks."],
    }),
    buildSeedBundle({
      symbol: normalizedSymbol,
      id: `${normalizedSymbol.toLowerCase()}-call-5m-core`,
      label: `${normalizedSymbol} 5m Core Calls`,
      direction: "call",
      timeframeFamily: "5m core",
      rayalgoPatch: {
        marketStructure: { timeHorizon: 10, bosConfirmation: "close" },
        bands: { basisLength: 21, atrLength: 14, atrSmoothing: 14, volatilityMultiplier: 1.5 },
        confirmation: {
          adxLength: 14,
          volumeMaLength: 20,
          mtf1: "15m",
          mtf2: "1h",
          mtf3: "4h",
          requireMtf1: true,
          requireMtf2: false,
          requireMtf3: false,
          requireAdx: true,
          adxMin: 20,
          requireVolScoreRange: true,
          volScoreMin: 25,
          volScoreMax: 88,
          restrictToSelectedSessions: true,
          sessions: ["new_york_am", "new_york_pm"],
        },
      },
      chartSetup: {
        candleTf: "5m",
        optionCandleTf: "5m",
        chartRange: "1W",
        chartWindowMode: "default",
        indicatorOverlays: {
          signals: { visible: true, timeframe: "follow_chart", mode: "follow_chart" },
          shading: { visible: true, timeframe: "5m", mode: "until_opposite_signal" },
        },
      },
      backtestSetup: {
        direction: "call",
        executionFidelity: "sub_candle",
        dte: 3,
        optionStrikeSlot: 0,
        slPct: 0.25,
        tpPct: 0.80,
        trailStartPct: 0.15,
        trailPct: 0.18,
        allowShorts: false,
        minConviction: 0.48,
        zombieBars: 24,
        regimeFilter: "not_bear",
      },
      evaluation: {
        tier: "test",
        sessionBadges: ["NY AM", "NY PM"],
        regimeBadges: ["Trend", "Expansion"],
      },
      playbook: {
        contractStyle: "ATM / slight ITM",
        dteLabel: "2-5D",
        horizonLabel: "Intraday core",
        sessionBias: "Main cash session",
        windowLabel: "1W",
        note: "Base directional bundle for sustained intraday follow-through after clean trend changes.",
      },
      notes: ["Seed bundle", "Primary starting point for broad RayAlgo testing."],
    }),
    buildSeedBundle({
      symbol: normalizedSymbol,
      id: `${normalizedSymbol.toLowerCase()}-put-5m-core`,
      label: `${normalizedSymbol} 5m Core Puts`,
      direction: "put",
      timeframeFamily: "5m core",
      rayalgoPatch: {
        marketStructure: { timeHorizon: 10, bosConfirmation: "wicks" },
        bands: { basisLength: 21, atrLength: 14, atrSmoothing: 14, volatilityMultiplier: 1.55 },
        confirmation: {
          adxLength: 14,
          volumeMaLength: 20,
          mtf1: "15m",
          mtf2: "1h",
          mtf3: "4h",
          requireMtf1: true,
          requireMtf2: true,
          requireMtf3: false,
          requireAdx: true,
          adxMin: 22,
          requireVolScoreRange: true,
          volScoreMin: 30,
          volScoreMax: 90,
          restrictToSelectedSessions: true,
          sessions: ["new_york_am", "new_york_pm"],
        },
      },
      chartSetup: {
        candleTf: "5m",
        optionCandleTf: "5m",
        chartRange: "1W",
        chartWindowMode: "default",
        indicatorOverlays: {
          signals: { visible: true, timeframe: "follow_chart", mode: "follow_chart" },
          shading: { visible: true, timeframe: "5m", mode: "until_opposite_signal" },
        },
      },
      backtestSetup: {
        direction: "put",
        executionFidelity: "sub_candle",
        dte: 2,
        optionStrikeSlot: 0,
        slPct: 0.22,
        tpPct: 0.72,
        trailStartPct: 0.12,
        trailPct: 0.16,
        allowShorts: true,
        minConviction: 0.49,
        zombieBars: 22,
        regimeFilter: "none",
      },
      evaluation: {
        tier: "test",
        sessionBadges: ["NY AM", "NY PM"],
        regimeBadges: ["Breakdown", "Expansion"],
      },
      playbook: {
        contractStyle: "ATM",
        dteLabel: "1-3D",
        horizonLabel: "Intraday downside",
        sessionBias: "Main cash session",
        windowLabel: "1W",
        note: "Core downside bundle for trend breaks and persistent sell pressure.",
      },
      notes: ["Seed bundle", "Use when downside alignment persists across the day."],
    }),
    buildSeedBundle({
      symbol: normalizedSymbol,
      id: `${normalizedSymbol.toLowerCase()}-call-15m-swing`,
      label: `${normalizedSymbol} 15m Swing Calls`,
      direction: "call",
      timeframeFamily: "15m swing",
      rayalgoPatch: {
        marketStructure: { timeHorizon: 8, bosConfirmation: "close" },
        bands: { basisLength: 34, atrLength: 21, atrSmoothing: 21, volatilityMultiplier: 2.1 },
        confirmation: {
          adxLength: 14,
          volumeMaLength: 24,
          mtf1: "1h",
          mtf2: "4h",
          mtf3: "D",
          requireMtf1: true,
          requireMtf2: true,
          requireMtf3: false,
          requireAdx: true,
          adxMin: 20,
          requireVolScoreRange: false,
          volScoreMin: 20,
          volScoreMax: 85,
          restrictToSelectedSessions: false,
          sessions: ["new_york_am", "new_york_pm"],
        },
      },
      chartSetup: {
        candleTf: "15m",
        optionCandleTf: "15m",
        chartRange: "2W",
        chartWindowMode: "default",
        indicatorOverlays: {
          signals: { visible: true, timeframe: "follow_chart", mode: "follow_chart" },
          shading: { visible: true, timeframe: "15m", mode: "until_opposite_signal" },
        },
      },
      backtestSetup: {
        direction: "call",
        executionFidelity: "bar_close",
        dte: 5,
        optionStrikeSlot: 0,
        slPct: 0.30,
        tpPct: 1.10,
        trailStartPct: 0.20,
        trailPct: 0.22,
        allowShorts: false,
        minConviction: 0.50,
        zombieBars: 32,
        regimeFilter: "not_bear",
      },
      evaluation: {
        tier: "test",
        sessionBadges: ["All day"],
        regimeBadges: ["Trend", "Higher-TF"],
      },
      playbook: {
        contractStyle: "ATM / slight ITM",
        dteLabel: "3-7D",
        horizonLabel: "Session swing",
        sessionBias: "All day",
        windowLabel: "2W",
        note: "Slower bundle for holding clean higher-timeframe trend changes across larger intraday swings.",
      },
      notes: ["Seed bundle", "Favor cleaner higher-timeframe alignment over fast entries."],
    }),
    buildSeedBundle({
      symbol: normalizedSymbol,
      id: `${normalizedSymbol.toLowerCase()}-put-15m-swing`,
      label: `${normalizedSymbol} 15m Swing Puts`,
      direction: "put",
      timeframeFamily: "15m swing",
      rayalgoPatch: {
        marketStructure: { timeHorizon: 8, bosConfirmation: "wicks" },
        bands: { basisLength: 34, atrLength: 21, atrSmoothing: 21, volatilityMultiplier: 2.15 },
        confirmation: {
          adxLength: 14,
          volumeMaLength: 24,
          mtf1: "1h",
          mtf2: "4h",
          mtf3: "D",
          requireMtf1: true,
          requireMtf2: true,
          requireMtf3: false,
          requireAdx: true,
          adxMin: 22,
          requireVolScoreRange: false,
          volScoreMin: 20,
          volScoreMax: 90,
          restrictToSelectedSessions: false,
          sessions: ["new_york_am", "new_york_pm"],
        },
      },
      chartSetup: {
        candleTf: "15m",
        optionCandleTf: "15m",
        chartRange: "2W",
        chartWindowMode: "default",
        indicatorOverlays: {
          signals: { visible: true, timeframe: "follow_chart", mode: "follow_chart" },
          shading: { visible: true, timeframe: "15m", mode: "until_opposite_signal" },
        },
      },
      backtestSetup: {
        direction: "put",
        executionFidelity: "bar_close",
        dte: 3,
        optionStrikeSlot: 0,
        slPct: 0.28,
        tpPct: 0.95,
        trailStartPct: 0.18,
        trailPct: 0.20,
        allowShorts: true,
        minConviction: 0.50,
        zombieBars: 28,
        regimeFilter: "none",
      },
      evaluation: {
        tier: "test",
        sessionBadges: ["All day"],
        regimeBadges: ["Breakdown", "Higher-TF"],
      },
      playbook: {
        contractStyle: "ATM",
        dteLabel: "2-5D",
        horizonLabel: "Session downside",
        sessionBias: "All day",
        windowLabel: "2W",
        note: "Use when downside structure persists beyond the opening move.",
      },
      notes: ["Seed bundle", "Slower downside bundle for larger directional swings after clean trend change."],
    }),
  ];
}

function sortBundles(left, right) {
  if (left.symbol !== right.symbol) {
    return left.symbol.localeCompare(right.symbol);
  }
  if (left.direction !== right.direction) {
    return left.direction === "call" ? -1 : 1;
  }
  const leftFamilyOrder = FAMILY_ORDER[left.timeframeFamily] || 999;
  const rightFamilyOrder = FAMILY_ORDER[right.timeframeFamily] || 999;
  if (leftFamilyOrder !== rightFamilyOrder) {
    return leftFamilyOrder - rightFamilyOrder;
  }
  const leftTierOrder = RAYALGO_BUNDLE_TIER_ORDER.indexOf(left.evaluation.tier);
  const rightTierOrder = RAYALGO_BUNDLE_TIER_ORDER.indexOf(right.evaluation.tier);
  if (leftTierOrder !== rightTierOrder) {
    return leftTierOrder - rightTierOrder;
  }
  return left.label.localeCompare(right.label);
}

export function buildDefaultRayAlgoBundleLibrary(symbol = "SPY") {
  return buildDefaultBundlesForSymbol(symbol).sort(sortBundles);
}

export function normalizeRayAlgoBundleLibrary(library = [], currentSymbol = "SPY") {
  const next = [];
  const seen = new Set();

  if (Array.isArray(library)) {
    library.forEach((entry) => {
      const normalized = normalizeRayAlgoBundle(entry, currentSymbol);
      if (!normalized.id || seen.has(normalized.id)) {
        return;
      }
      seen.add(normalized.id);
      next.push(normalized);
    });
  }

  buildDefaultBundlesForSymbol(currentSymbol).forEach((entry) => {
    if (seen.has(entry.id)) {
      return;
    }
    seen.add(entry.id);
    next.push(entry);
  });

  return next.sort(sortBundles);
}

export function buildRayAlgoBundleVariantLabel(parentLabel = "RayAlgo Bundle", library = []) {
  const normalizedParent = normalizeText(parentLabel, "RayAlgo Bundle");
  const taken = new Set((Array.isArray(library) ? library : []).map((entry) => normalizeText(entry?.label)));
  let attempt = 1;
  let candidate = `${normalizedParent} custom-${attempt}`;
  while (taken.has(candidate)) {
    attempt += 1;
    candidate = `${normalizedParent} custom-${attempt}`;
  }
  return candidate;
}
