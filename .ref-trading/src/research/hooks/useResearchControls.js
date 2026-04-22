import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_RESEARCH_STRATEGY,
  EXIT_PRESETS,
  STRATEGY_PRESETS,
  getActiveExitPresetKey,
  normalizeResearchStrategy,
} from "../config/strategyPresets.js";
import {
  DEFAULT_RAYALGO_SETTINGS,
  DEFAULT_RAYALGO_WATCHER,
  mergeRayAlgoSettings,
  normalizeRayAlgoSettings,
} from "../config/rayalgoSettings.js";
import { normalizeRayAlgoScoringPreferences } from "../engine/rayalgoScoring.js";
import {
  buildDefaultRayAlgoBundleLibrary,
  buildRayAlgoBundleVariantLabel,
  RAYALGO_BUNDLE_TIER_ORDER,
  normalizeRayAlgoBundle,
  normalizeRayAlgoBundleLibrary,
} from "../config/rayalgoBundles.js";
import {
  createResearchOptimizerHistoryEntry,
  createResearchRunHistoryEntry,
  mergeResearchHistoryStores,
  normalizeResearchHistoryStore,
  normalizeResearchOptimizerHistory,
  normalizeResearchRunHistory,
} from "../history/researchHistory.js";
import { clampStrikeSlot } from "../options/strikeSelection.js";
import {
  DEFAULT_INDICATOR_SELECTIONS,
  normalizeIndicatorSelections,
} from "../chart/indicatorRegistry.js";
import {
  DEFAULT_RAYALGO_CANDLE_COLOR_MODE,
  normalizeRayalgoCandleColorMode,
} from "../chart/rayalgoCandleColorMode.js";
import {
  DEFAULT_CHART_TYPE,
  normalizeChartType,
} from "../chart/volumeChartType.js";
import { normalizeChartWindowMode, resolveDefaultVisibleRangeForTimeframe } from "../chart/timeframeModel.js";
import { resolveResearchStartupChartState } from "./researchStartupChartState.js";
import {
  applyLegacyTopRailFieldsToStageConfig,
  projectLegacyTopRailFieldsFromStageConfig,
} from "../config/backtestLegacyInputMapping.js";
import { cloneBacktestV2StageDefaults } from "../config/backtestV2StagingConfig.js";
import { normalizeBacktestV2StageConfig } from "../config/backtestV2RuntimeBridge.js";
import {
  getResearchHistory,
  saveResearchHistory,
} from "../../lib/brokerClient.js";

const RAYALGO_PREFS_KEY = "spy-engine-rayalgo-prefs";
const RESEARCH_HISTORY_KEY = "spy-engine-research-history-v1";
const DEFAULT_SESSION_BLOCKS = [true, true, true, true, true, false, false, false, false, false, true, true, false];
const DEFAULT_TRADE_DAYS = [true, true, true, true, true];
const DEFAULT_INDICATOR_OVERLAYS = {
  signals: { visible: true, timeframe: "follow_chart", mode: "follow_chart" },
  shading: { visible: true, timeframe: "5m", mode: "until_opposite_signal" },
};
const SESSION_PRESETS = {
  all: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  open: [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  am: [1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0],
  pm: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1],
  power: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1],
  lunch: [0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0],
};

function normalizeBooleanArray(value, fallback) {
  if (!Array.isArray(value) || value.length !== fallback.length) {
    return fallback;
  }
  return value.map(Boolean);
}

function booleanArraysEqual(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => Boolean(value) === Boolean(right[index]));
}

function normalizeIndicatorOverlays(value = {}) {
  const signals = value?.signals || {};
  const shading = value?.shading || {};
  const rawSignalTimeframe = String(signals.timeframe || DEFAULT_INDICATOR_OVERLAYS.signals.timeframe).trim() || DEFAULT_INDICATOR_OVERLAYS.signals.timeframe;
  const rawSignalMode = String(signals.mode || "").trim().toLowerCase();
  const shadingTimeframe = String(shading.timeframe || DEFAULT_INDICATOR_OVERLAYS.shading.timeframe).trim() || DEFAULT_INDICATOR_OVERLAYS.shading.timeframe;
  const signalMode = rawSignalMode === "pinned"
    ? "pinned"
    : "follow_chart";
  const signalTimeframe = signalMode === "pinned" && rawSignalTimeframe !== "follow_chart"
    ? rawSignalTimeframe
    : "follow_chart";
  return {
    signals: {
      visible: signals.visible !== false,
      timeframe: signalTimeframe,
      mode: signalMode,
    },
    shading: {
      visible: shading.visible !== false,
      timeframe: shadingTimeframe,
      mode: "until_opposite_signal",
    },
  };
}

function normalizeIndicatorSelectionState(value = []) {
  return normalizeIndicatorSelections(value);
}

function normalizeRayAlgoWatcher(value = {}) {
  return {
    autoRankAndPin: Boolean(value?.autoRankAndPin),
  };
}

function normalizeMarketSymbol(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized || "SPY";
}

function normalizeExecutionFidelity(value) {
  return String(value || "").trim().toLowerCase() === "bar_close" ? "bar_close" : "sub_candle";
}

function normalizeStoredTimeframe(value, fallback = "1m") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function normalizeRayalgoBundleTier(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return RAYALGO_BUNDLE_TIER_ORDER.includes(normalized) ? normalized : "test";
}

function updateNestedValue(target, path, value) {
  const keys = String(path || "").split(".").filter(Boolean);
  if (!keys.length) {
    return target;
  }
  const next = Array.isArray(target) ? [...target] : { ...(target || {}) };
  let cursor = next;
  let sourceCursor = target || {};
  for (let index = 0; index < keys.length - 1; index += 1) {
    const key = keys[index];
    const currentValue = sourceCursor?.[key];
    const branch = Array.isArray(currentValue) ? [...currentValue] : { ...(currentValue || {}) };
    cursor[key] = branch;
    cursor = branch;
    sourceCursor = currentValue || {};
  }
  cursor[keys[keys.length - 1]] = value;
  return next;
}

function resolveSetterValue(currentValue, nextValue) {
  return typeof nextValue === "function" ? nextValue(currentValue) : nextValue;
}

function buildResearchHistorySignature(store = {}) {
  const normalized = normalizeResearchHistoryStore(store);
  return JSON.stringify(normalized);
}

function normalizeSurfacePrefs(value = {}) {
  const next = {};
  const strategy = String(value?.strategy || "").trim();
  if (strategy) {
    next.strategy = normalizeResearchStrategy(strategy);
  }

  const marketSymbol = normalizeMarketSymbol(value?.marketSymbol);
  if (marketSymbol) {
    next.marketSymbol = marketSymbol;
  }

  if (Object.prototype.hasOwnProperty.call(value || {}, "executionFidelity")) {
    next.executionFidelity = normalizeExecutionFidelity(value?.executionFidelity);
  }

  if (Object.prototype.hasOwnProperty.call(value || {}, "optionCandleTf")) {
    next.optionCandleTf = normalizeStoredTimeframe(value?.optionCandleTf, "1m");
  }

  if (typeof value?.chartsLinked === "boolean") {
    next.chartsLinked = value.chartsLinked;
  }
  return next;
}

function buildRayAlgoBundleSnapshot({
  rayalgoSettings,
  rayalgoScoringConfig,
  candleTf,
  optionCandleTf,
  spotChartType,
  optionChartType,
  rayalgoCandleColorMode,
  chartRange,
  chartWindowMode,
  indicatorOverlays,
  executionFidelity,
  dte,
  optionStrikeSlot,
  slPct,
  tpPct,
  trailStartPct,
  trailPct,
  allowShorts,
  minConviction,
  zombieBars,
  regimeFilter,
}) {
  const normalizedTf = normalizeStoredTimeframe(candleTf, "auto");
  return {
    rayalgoSettings: normalizeRayAlgoSettings(rayalgoSettings),
    chartSetup: {
      candleTf: normalizedTf,
      optionCandleTf: normalizeStoredTimeframe(optionCandleTf, normalizedTf),
      spotChartType: normalizeChartType(spotChartType, DEFAULT_CHART_TYPE),
      optionChartType: normalizeChartType(optionChartType, DEFAULT_CHART_TYPE),
      rayalgoCandleColorMode: normalizeRayalgoCandleColorMode(
        rayalgoCandleColorMode,
        DEFAULT_RAYALGO_CANDLE_COLOR_MODE,
      ),
      chartRange: String(chartRange || "").trim() || resolveDefaultVisibleRangeForTimeframe(normalizedTf),
      chartWindowMode: normalizeChartWindowMode(chartWindowMode),
      indicatorOverlays: normalizeIndicatorOverlays(indicatorOverlays),
    },
    backtestSetup: {
      strategy: "rayalgo",
      direction: allowShorts ? "put" : "call",
      executionFidelity: normalizeExecutionFidelity(executionFidelity),
      dte: Math.max(0, Math.min(10, Math.round(Number(dte) || 0))),
      optionStrikeSlot: optionStrikeSlot == null ? null : clampStrikeSlot(optionStrikeSlot),
      slPct: Number.isFinite(Number(slPct)) ? Number(slPct) : 0.25,
      tpPct: Number.isFinite(Number(tpPct)) ? Number(tpPct) : 0.35,
      trailStartPct: Number.isFinite(Number(trailStartPct)) ? Number(trailStartPct) : 0.08,
      trailPct: Number.isFinite(Number(trailPct)) ? Number(trailPct) : 0.18,
      allowShorts: Boolean(allowShorts),
      minConviction: Number.isFinite(Number(minConviction)) ? Number(minConviction) : 0.48,
      zombieBars: Math.max(1, Math.round(Number(zombieBars) || 20)),
      regimeFilter: String(regimeFilter || "").trim() || "none",
      rayalgoScoringConfig: normalizeRayAlgoScoringPreferences(rayalgoScoringConfig || {}),
    },
  };
}

function buildRayAlgoBundleSnapshotKey(snapshot = null) {
  if (!snapshot) {
    return "";
  }
  return JSON.stringify({
    rayalgoSettings: normalizeRayAlgoSettings(snapshot.rayalgoSettings),
    chartSetup: {
      candleTf: normalizeStoredTimeframe(snapshot.chartSetup?.candleTf, "auto"),
      optionCandleTf: normalizeStoredTimeframe(snapshot.chartSetup?.optionCandleTf, normalizeStoredTimeframe(snapshot.chartSetup?.candleTf, "auto")),
      spotChartType: normalizeChartType(snapshot.chartSetup?.spotChartType, DEFAULT_CHART_TYPE),
      optionChartType: normalizeChartType(snapshot.chartSetup?.optionChartType, DEFAULT_CHART_TYPE),
      rayalgoCandleColorMode: normalizeRayalgoCandleColorMode(
        snapshot.chartSetup?.rayalgoCandleColorMode,
        DEFAULT_RAYALGO_CANDLE_COLOR_MODE,
      ),
      chartRange: String(snapshot.chartSetup?.chartRange || "").trim() || resolveDefaultVisibleRangeForTimeframe(snapshot.chartSetup?.candleTf || "auto"),
      chartWindowMode: normalizeChartWindowMode(snapshot.chartSetup?.chartWindowMode),
      indicatorOverlays: normalizeIndicatorOverlays(snapshot.chartSetup?.indicatorOverlays),
    },
    backtestSetup: {
      strategy: "rayalgo",
      direction: String(snapshot.backtestSetup?.direction || "").trim().toLowerCase() === "put" ? "put" : "call",
      executionFidelity: normalizeExecutionFidelity(snapshot.backtestSetup?.executionFidelity),
      dte: Math.max(0, Math.min(10, Math.round(Number(snapshot.backtestSetup?.dte) || 0))),
      optionStrikeSlot: snapshot.backtestSetup?.optionStrikeSlot == null ? null : clampStrikeSlot(snapshot.backtestSetup.optionStrikeSlot),
      slPct: Number.isFinite(Number(snapshot.backtestSetup?.slPct)) ? Number(snapshot.backtestSetup.slPct) : 0.25,
      tpPct: Number.isFinite(Number(snapshot.backtestSetup?.tpPct)) ? Number(snapshot.backtestSetup.tpPct) : 0.35,
      trailStartPct: Number.isFinite(Number(snapshot.backtestSetup?.trailStartPct)) ? Number(snapshot.backtestSetup.trailStartPct) : 0.08,
      trailPct: Number.isFinite(Number(snapshot.backtestSetup?.trailPct)) ? Number(snapshot.backtestSetup.trailPct) : 0.18,
      allowShorts: Boolean(snapshot.backtestSetup?.allowShorts),
      minConviction: Number.isFinite(Number(snapshot.backtestSetup?.minConviction)) ? Number(snapshot.backtestSetup.minConviction) : 0.48,
      zombieBars: Math.max(1, Math.round(Number(snapshot.backtestSetup?.zombieBars) || 20)),
      regimeFilter: String(snapshot.backtestSetup?.regimeFilter || "").trim() || "none",
      rayalgoScoringConfig: normalizeRayAlgoScoringPreferences(
        snapshot.backtestSetup?.rayalgoScoringConfig || snapshot.backtestSetup?.scoringConfig || {},
      ),
    },
  });
}

function buildRayAlgoBundleSnapshotFromResearchSetup(setup = {}) {
  const topRail = normalizeSurfacePrefs(setup?.topRail || {});
  const stagedProjection = projectLegacyTopRailFieldsFromStageConfig(setup?.rayalgo?.stagedConfigUi || null);
  const rayalgoPrefs = setup?.rayalgo || {};
  return buildRayAlgoBundleSnapshot({
    rayalgoSettings: rayalgoPrefs.rayalgoSettings || DEFAULT_RAYALGO_SETTINGS,
    rayalgoScoringConfig: rayalgoPrefs.scoringConfig || rayalgoPrefs.scoringContext || {},
    candleTf: rayalgoPrefs.candleTf || "auto",
    optionCandleTf: topRail.optionCandleTf || rayalgoPrefs.optionCandleTf || "1m",
    spotChartType: rayalgoPrefs.spotChartType || DEFAULT_CHART_TYPE,
    optionChartType: rayalgoPrefs.optionChartType || DEFAULT_CHART_TYPE,
    rayalgoCandleColorMode: normalizeRayalgoCandleColorMode(
      rayalgoPrefs.rayalgoCandleColorMode,
      DEFAULT_RAYALGO_CANDLE_COLOR_MODE,
    ),
    chartRange: rayalgoPrefs.chartRange || resolveDefaultVisibleRangeForTimeframe(rayalgoPrefs.candleTf || "auto"),
    chartWindowMode: rayalgoPrefs.chartWindowMode || "default",
    indicatorOverlays: rayalgoPrefs.indicatorOverlays || DEFAULT_INDICATOR_OVERLAYS,
    executionFidelity: topRail.executionFidelity || "sub_candle",
    dte: stagedProjection.dte,
    optionStrikeSlot: stagedProjection.optionStrikeSlot,
    slPct: stagedProjection.slPct,
    tpPct: stagedProjection.tpPct,
    trailStartPct: stagedProjection.trailStartPct,
    trailPct: stagedProjection.trailPct,
    allowShorts: stagedProjection.allowShorts,
    minConviction: stagedProjection.minConviction,
    zombieBars: stagedProjection.zombieBars,
    regimeFilter: stagedProjection.regimeFilter,
  });
}

export function useResearchControls() {
  const [marketSymbol, setMarketSymbol] = useState("SPY");
  const [executionMode, setExecutionMode] = useState("option_history");
  const [executionFidelity, setExecutionFidelity] = useState("sub_candle");
  const [strategy, setStrategy] = useState(DEFAULT_RESEARCH_STRATEGY);
  const [dte, setDte] = useState(5);
  const [optionStrikeSlot, setOptionStrikeSlot] = useState(null);
  const [iv, setIv] = useState(0.20);
  const [slPct, setSlPct] = useState(0.25);
  const [tpPct, setTpPct] = useState(0.35);
  const [trailStartPct, setTrailStartPct] = useState(0.08);
  const [trailPct, setTrailPct] = useState(0.18);
  const [zombieBars, setZombieBars] = useState(30);
  const [minConviction, setMinConviction] = useState(0.48);
  const [allowShorts, setAllowShorts] = useState(false);
  const [kellyFrac, setKellyFrac] = useState(0.25);
  const [regimeFilter, setRegimeFilter] = useState("not_bear");
  const [capital, setCapital] = useState(25000);
  const [maxPos, setMaxPos] = useState(4);
  const [sessionBlocks, setSessionBlocks] = useState(DEFAULT_SESSION_BLOCKS);
  const [tradeDays, setTradeDays] = useState(DEFAULT_TRADE_DAYS);
  const [regimeAdapt, setRegimeAdapt] = useState(true);
  const [commPerContract, setCommPerContract] = useState(0.65);
  const [slipBps, setSlipBps] = useState(150);
  const [indicatorSelectionsState, setIndicatorSelectionsState] = useState(DEFAULT_INDICATOR_SELECTIONS);
  const [indicatorOverlaysState, setIndicatorOverlaysState] = useState(DEFAULT_INDICATOR_OVERLAYS);
  const [chartRange, setChartRange] = useState(resolveDefaultVisibleRangeForTimeframe("auto"));
  const [chartWindowModeState, setChartWindowModeState] = useState("default");
  const [chartPresetVersion, setChartPresetVersion] = useState(0);
  const [candleTf, setCandleTf] = useState("auto");
  const [optionCandleTf, setOptionCandleTf] = useState("1m");
  const [spotChartType, setSpotChartTypeState] = useState(DEFAULT_CHART_TYPE);
  const [optionChartType, setOptionChartTypeState] = useState(DEFAULT_CHART_TYPE);
  const [rayalgoCandleColorModeState, setRayalgoCandleColorModeState] = useState(DEFAULT_RAYALGO_CANDLE_COLOR_MODE);
  const [chartsLinked, setChartsLinked] = useState(true);
  const [rayalgoSettingsState, setRayalgoSettingsState] = useState(DEFAULT_RAYALGO_SETTINGS);
  const [rayalgoScoringConfigState, setRayalgoScoringConfigState] = useState(() => normalizeRayAlgoScoringPreferences({}));
  const [rayalgoWatcherState, setRayalgoWatcherState] = useState(DEFAULT_RAYALGO_WATCHER);
  const [rayalgoBundleLibraryState, setRayalgoBundleLibraryState] = useState(() => buildDefaultRayAlgoBundleLibrary("SPY"));
  const [selectedRayalgoBundleIdState, setSelectedRayalgoBundleIdState] = useState(() => buildDefaultRayAlgoBundleLibrary("SPY")[0]?.id || null);
  const [researchRunHistoryState, setResearchRunHistoryState] = useState([]);
  const [optimizerHistoryState, setOptimizerHistoryState] = useState([]);
  const [stagedConfigUiState, setStagedConfigUiState] = useState(() => cloneBacktestV2StageDefaults());
  const stagedConfigUiRef = useRef(stagedConfigUiState);
  const [historySyncReady, setHistorySyncReady] = useState(false);
  const lastServerHistorySignatureRef = useRef("");

  const setIndicatorSelections = useCallback((nextValue) => {
    setIndicatorSelectionsState((previous) => normalizeIndicatorSelectionState(
      typeof nextValue === "function" ? nextValue(previous) : nextValue,
    ));
  }, []);

  const setIndicatorOverlays = useCallback((nextValue) => {
    setIndicatorOverlaysState((previous) => normalizeIndicatorOverlays(
      typeof nextValue === "function" ? nextValue(previous) : nextValue,
    ));
  }, []);
  const setSpotChartType = useCallback((nextValue) => {
    setSpotChartTypeState((previous) => normalizeChartType(resolveSetterValue(previous, nextValue), DEFAULT_CHART_TYPE));
  }, []);
  const setOptionChartType = useCallback((nextValue) => {
    setOptionChartTypeState((previous) => normalizeChartType(resolveSetterValue(previous, nextValue), DEFAULT_CHART_TYPE));
  }, []);
  const setRayalgoCandleColorMode = useCallback((nextValue) => {
    setRayalgoCandleColorModeState((previous) => normalizeRayalgoCandleColorMode(
      resolveSetterValue(previous, nextValue),
      DEFAULT_RAYALGO_CANDLE_COLOR_MODE,
    ));
  }, []);

  const setRayalgoScoringConfig = useCallback((nextValue) => {
    setRayalgoScoringConfigState((previous) => normalizeRayAlgoScoringPreferences(
      typeof nextValue === "function" ? nextValue(previous) : nextValue,
    ));
  }, []);
  const setRayalgoPrecursorLadderId = useCallback((nextValue) => {
    setRayalgoScoringConfigState((previous) => normalizeRayAlgoScoringPreferences({
      ...(previous || {}),
      precursorLadderId: nextValue,
    }));
  }, []);
  const setRayalgoScoringAuthority = useCallback((nextValue) => {
    setRayalgoScoringConfigState((previous) => normalizeRayAlgoScoringPreferences({
      ...(previous || {}),
      authority: nextValue,
    }));
  }, []);
  const setRayalgoScoringDisplayMode = useCallback((nextValue) => {
    setRayalgoScoringConfigState((previous) => normalizeRayAlgoScoringPreferences({
      ...(previous || {}),
      displayMode: nextValue,
    }));
  }, []);

  const setRayalgoSettings = useCallback((nextValue) => {
    setRayalgoSettingsState((previous) => normalizeRayAlgoSettings(
      typeof nextValue === "function" ? nextValue(previous) : nextValue,
    ));
  }, []);

  const setRayalgoWatcher = useCallback((nextValue) => {
    setRayalgoWatcherState((previous) => normalizeRayAlgoWatcher(
      typeof nextValue === "function" ? nextValue(previous) : nextValue,
    ));
  }, []);

  const setChartWindowMode = useCallback((nextValue) => {
    setChartWindowModeState((previous) => normalizeChartWindowMode(
      typeof nextValue === "function" ? nextValue(previous) : nextValue,
    ));
  }, []);

  const syncLegacyTopRailFromStageConfig = useCallback((nextStageConfig) => {
    const projection = projectLegacyTopRailFieldsFromStageConfig(nextStageConfig);
    if (Number.isFinite(Number(projection.capital))) {
      setCapital(Math.round(Number(projection.capital)));
    }
    if (Number.isFinite(Number(projection.kellyFrac))) {
      setKellyFrac(Number(projection.kellyFrac));
    }
    if (Number.isFinite(Number(projection.dte))) {
      setDte(Number(projection.dte));
    }
    if (Number.isFinite(Number(projection.slPct))) {
      setSlPct(Number(projection.slPct));
    }
    if (Number.isFinite(Number(projection.tpPct))) {
      setTpPct(Number(projection.tpPct));
    }
    if (Number.isFinite(Number(projection.trailStartPct))) {
      setTrailStartPct(Number(projection.trailStartPct));
    }
    if (Number.isFinite(Number(projection.trailPct))) {
      setTrailPct(Number(projection.trailPct));
    }
    if (Number.isFinite(Number(projection.zombieBars))) {
      setZombieBars(Math.round(Number(projection.zombieBars)));
    }
    if (Number.isFinite(Number(projection.minConviction))) {
      setMinConviction(Number(projection.minConviction));
    }
    if (projection.optionStrikeSlot === null || Number.isFinite(Number(projection.optionStrikeSlot))) {
      setOptionStrikeSlot(projection.optionStrikeSlot == null ? null : Number(projection.optionStrikeSlot));
    }
    if (typeof projection.allowShorts === "boolean") {
      setAllowShorts(Boolean(projection.allowShorts));
    }
    if (String(projection.regimeFilter || "").trim()) {
      setRegimeFilter(String(projection.regimeFilter));
    }
    if (typeof projection.regimeAdapt === "boolean") {
      setRegimeAdapt(Boolean(projection.regimeAdapt));
    }
    if (Number.isFinite(Number(projection.maxPos))) {
      setMaxPos(Math.round(Number(projection.maxPos)));
    }
    if (Array.isArray(projection.sessionBlocks) && projection.sessionBlocks.length === DEFAULT_SESSION_BLOCKS.length) {
      setSessionBlocks((previous) => booleanArraysEqual(previous, projection.sessionBlocks) ? previous : projection.sessionBlocks.map(Boolean));
    }
    if (Array.isArray(projection.tradeDays) && projection.tradeDays.length === DEFAULT_TRADE_DAYS.length) {
      setTradeDays((previous) => booleanArraysEqual(previous, projection.tradeDays) ? previous : projection.tradeDays.map(Boolean));
    }
    if (Number.isFinite(Number(projection.commPerContract))) {
      setCommPerContract(Number(projection.commPerContract));
    }
    if (Number.isFinite(Number(projection.slipBps))) {
      setSlipBps(Math.round(Number(projection.slipBps)));
    }
  }, []);

  useEffect(() => {
    stagedConfigUiRef.current = stagedConfigUiState;
  }, [stagedConfigUiState]);

  const commitStagedConfigUi = useCallback((nextStageConfig) => {
    const normalized = normalizeBacktestV2StageConfig(nextStageConfig);
    stagedConfigUiRef.current = normalized;
    setStagedConfigUiState(normalized);
    syncLegacyTopRailFromStageConfig(normalized);
    return normalized;
  }, [syncLegacyTopRailFromStageConfig]);

  const updateStagedConfigUi = useCallback((nextStageConfig) => {
    const previous = stagedConfigUiRef.current;
    const resolved = typeof nextStageConfig === "function"
      ? nextStageConfig(previous)
      : nextStageConfig;
    return commitStagedConfigUi(resolved);
  }, [commitStagedConfigUi]);

  const setStagedConfigUi = useCallback((nextStageConfig) => {
    return commitStagedConfigUi(nextStageConfig);
  }, [commitStagedConfigUi]);

  const applyLegacyTopRailCompatPatch = useCallback((legacyPatch = {}) => {
    updateStagedConfigUi((previous) => applyLegacyTopRailFieldsToStageConfig(previous, legacyPatch));
  }, [updateStagedConfigUi]);

  const setStagedConfigField = useCallback((path, value) => {
    updateStagedConfigUi((previous) => updateNestedValue(previous, path, value));
  }, [updateStagedConfigUi]);

  const resetStagedConfigSection = useCallback((sectionKey) => {
    const defaults = cloneBacktestV2StageDefaults();
    updateStagedConfigUi((previous) => ({
      ...previous,
      [sectionKey]: defaults[sectionKey],
    }));
  }, [updateStagedConfigUi]);

  const resetStagedConfigUi = useCallback(() => {
    setStagedConfigUi(cloneBacktestV2StageDefaults());
  }, [setStagedConfigUi]);

  const setDteCompat = useCallback((nextValue) => {
    const resolved = Math.max(0, Math.min(10, Math.round(Number(resolveSetterValue(dte, nextValue)) || 0)));
    applyLegacyTopRailCompatPatch({ dte: resolved });
  }, [applyLegacyTopRailCompatPatch, dte]);

  const setKellyFracCompat = useCallback((nextValue) => {
    const resolved = Number(resolveSetterValue(kellyFrac, nextValue));
    if (!Number.isFinite(resolved)) {
      return;
    }
    applyLegacyTopRailCompatPatch({ kellyFrac: resolved });
  }, [applyLegacyTopRailCompatPatch, kellyFrac]);

  const setCapitalCompat = useCallback((nextValue) => {
    const resolved = Math.round(Number(resolveSetterValue(capital, nextValue)));
    if (!Number.isFinite(resolved) || resolved <= 0) {
      return;
    }
    applyLegacyTopRailCompatPatch({ capital: resolved });
  }, [applyLegacyTopRailCompatPatch, capital]);

  const setOptionStrikeSlotCompat = useCallback((nextValue) => {
    const resolved = resolveSetterValue(optionStrikeSlot, nextValue);
    if (resolved == null || String(resolved).trim() === "") {
      applyLegacyTopRailCompatPatch({ optionStrikeSlot: null });
      return;
    }
    const numeric = Number(resolved);
    if (!Number.isFinite(numeric)) {
      return;
    }
    applyLegacyTopRailCompatPatch({ optionStrikeSlot: clampStrikeSlot(numeric) });
  }, [applyLegacyTopRailCompatPatch, optionStrikeSlot]);

  const setSlPctCompat = useCallback((nextValue) => {
    const resolved = Number(resolveSetterValue(slPct, nextValue));
    if (!Number.isFinite(resolved)) {
      return;
    }
    applyLegacyTopRailCompatPatch({ slPct: resolved });
  }, [applyLegacyTopRailCompatPatch, slPct]);

  const setTpPctCompat = useCallback((nextValue) => {
    const resolved = Number(resolveSetterValue(tpPct, nextValue));
    if (!Number.isFinite(resolved)) {
      return;
    }
    applyLegacyTopRailCompatPatch({ tpPct: resolved });
  }, [applyLegacyTopRailCompatPatch, tpPct]);

  const setTrailStartPctCompat = useCallback((nextValue) => {
    const resolved = Number(resolveSetterValue(trailStartPct, nextValue));
    if (!Number.isFinite(resolved)) {
      return;
    }
    applyLegacyTopRailCompatPatch({ trailStartPct: resolved });
  }, [applyLegacyTopRailCompatPatch, trailStartPct]);

  const setTrailPctCompat = useCallback((nextValue) => {
    const resolved = Number(resolveSetterValue(trailPct, nextValue));
    if (!Number.isFinite(resolved)) {
      return;
    }
    applyLegacyTopRailCompatPatch({ trailPct: resolved });
  }, [applyLegacyTopRailCompatPatch, trailPct]);

  const setZombieBarsCompat = useCallback((nextValue) => {
    const resolved = Math.max(1, Math.round(Number(resolveSetterValue(zombieBars, nextValue)) || 0));
    applyLegacyTopRailCompatPatch({ zombieBars: resolved });
  }, [applyLegacyTopRailCompatPatch, zombieBars]);

  const setMinConvictionCompat = useCallback((nextValue) => {
    const resolved = Number(resolveSetterValue(minConviction, nextValue));
    if (!Number.isFinite(resolved)) {
      return;
    }
    applyLegacyTopRailCompatPatch({ minConviction: resolved });
  }, [applyLegacyTopRailCompatPatch, minConviction]);

  const setAllowShortsCompat = useCallback((nextValue) => {
    applyLegacyTopRailCompatPatch({ allowShorts: Boolean(resolveSetterValue(allowShorts, nextValue)) });
  }, [allowShorts, applyLegacyTopRailCompatPatch]);

  const setRegimeFilterCompat = useCallback((nextValue) => {
    const resolved = String(resolveSetterValue(regimeFilter, nextValue) || "").trim() || "none";
    applyLegacyTopRailCompatPatch({ regimeFilter: resolved });
  }, [applyLegacyTopRailCompatPatch, regimeFilter]);

  const setMaxPosCompat = useCallback((nextValue) => {
    const resolved = Math.max(1, Math.round(Number(resolveSetterValue(maxPos, nextValue)) || 0));
    applyLegacyTopRailCompatPatch({ maxPos: resolved });
  }, [applyLegacyTopRailCompatPatch, maxPos]);

  const setSessionBlocksCompat = useCallback((nextValue) => {
    const resolved = normalizeBooleanArray(resolveSetterValue(sessionBlocks, nextValue), DEFAULT_SESSION_BLOCKS);
    applyLegacyTopRailCompatPatch({ sessionBlocks: resolved });
  }, [applyLegacyTopRailCompatPatch, sessionBlocks]);

  const setTradeDaysCompat = useCallback((nextValue) => {
    const resolved = normalizeBooleanArray(resolveSetterValue(tradeDays, nextValue), DEFAULT_TRADE_DAYS);
    applyLegacyTopRailCompatPatch({ tradeDays: resolved });
  }, [applyLegacyTopRailCompatPatch, tradeDays]);

  const setRegimeAdaptCompat = useCallback((nextValue) => {
    applyLegacyTopRailCompatPatch({ regimeAdapt: Boolean(resolveSetterValue(regimeAdapt, nextValue)) });
  }, [applyLegacyTopRailCompatPatch, regimeAdapt]);

  const setCommPerContractCompat = useCallback((nextValue) => {
    const resolved = Number(resolveSetterValue(commPerContract, nextValue));
    if (!Number.isFinite(resolved)) {
      return;
    }
    applyLegacyTopRailCompatPatch({ commPerContract: resolved });
  }, [applyLegacyTopRailCompatPatch, commPerContract]);

  const setSlipBpsCompat = useCallback((nextValue) => {
    const resolved = Math.max(0, Math.round(Number(resolveSetterValue(slipBps, nextValue)) || 0));
    applyLegacyTopRailCompatPatch({ slipBps: resolved });
  }, [applyLegacyTopRailCompatPatch, slipBps]);

  const bumpChartPresetVersion = useCallback(() => {
    setChartPresetVersion((previous) => previous + 1);
  }, []);

  const resetStartupChartState = useCallback(() => {
    const startupState = resolveResearchStartupChartState();
    setCandleTf(startupState.candleTf);
    setChartRange(startupState.chartRange);
    setChartWindowModeState(startupState.chartWindowMode);
    setSpotChartTypeState(startupState.spotChartType);
    setOptionChartTypeState(startupState.optionChartType);
    setRayalgoCandleColorModeState(startupState.rayalgoCandleColorMode);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadStoredState = async () => {
      try {
        const hasStorage = typeof window !== "undefined" && Boolean(window.storage);
        const [rayalgoResponse, historyResponse] = hasStorage
          ? await Promise.all([
            window.storage.get(RAYALGO_PREFS_KEY),
            window.storage.get(RESEARCH_HISTORY_KEY),
          ])
          : [null, null];
        if (cancelled) return;

        let storedRayalgoCandleColorMode = null;
        if (rayalgoResponse?.value) {
          const parsed = JSON.parse(rayalgoResponse.value);
          const surfacePrefs = normalizeSurfacePrefs(parsed);
          const storedMarketSymbol = surfacePrefs?.marketSymbol || marketSymbol;
          if (Object.prototype.hasOwnProperty.call(parsed || {}, "rayalgoCandleColorMode")) {
            storedRayalgoCandleColorMode = normalizeRayalgoCandleColorMode(
              parsed.rayalgoCandleColorMode,
              DEFAULT_RAYALGO_CANDLE_COLOR_MODE,
            );
          }
          if (surfacePrefs?.marketSymbol) {
            setMarketSymbol(surfacePrefs.marketSymbol);
          }
          if (surfacePrefs?.strategy) {
            setStrategy(surfacePrefs.strategy);
          }
          if (surfacePrefs?.executionFidelity) {
            setExecutionFidelity(surfacePrefs.executionFidelity);
          }
          if (surfacePrefs?.optionCandleTf) {
            setOptionCandleTf(surfacePrefs.optionCandleTf);
          }
          if (typeof surfacePrefs?.chartsLinked === "boolean") {
            setChartsLinked(surfacePrefs.chartsLinked);
          }
          if (parsed?.indicatorOverlays) {
            setIndicatorOverlaysState(normalizeIndicatorOverlays(parsed.indicatorOverlays));
          }
          if (parsed?.indicatorSelections || parsed?.tvStudies) {
            setIndicatorSelectionsState(normalizeIndicatorSelectionState(parsed.indicatorSelections || parsed.tvStudies));
          }
          if (parsed?.rayalgoSettings) {
            setRayalgoSettingsState(normalizeRayAlgoSettings(parsed.rayalgoSettings));
          }
          if (parsed?.rayalgoScoringConfig || parsed?.scoringConfig || parsed?.scoringContext) {
            setRayalgoScoringConfigState(normalizeRayAlgoScoringPreferences(
              parsed.rayalgoScoringConfig || parsed.scoringConfig || parsed.scoringContext,
            ));
          }
          if (parsed?.rayalgoWatcher) {
            setRayalgoWatcherState(normalizeRayAlgoWatcher(parsed.rayalgoWatcher));
          }
          if (parsed?.stagedConfigUi) {
            hasStoredStageConfig = true;
            setStagedConfigUi(parsed.stagedConfigUi);
          }
          if (Array.isArray(parsed?.rayalgoBundleLibrary)) {
            setRayalgoBundleLibraryState(normalizeRayAlgoBundleLibrary(parsed.rayalgoBundleLibrary, storedMarketSymbol));
          }
          if (parsed?.selectedRayalgoBundleId) {
            setSelectedRayalgoBundleIdState(String(parsed.selectedRayalgoBundleId).trim() || null);
          }
        }

        // Normal app entry starts from the global chart defaults. Saved runs,
        // setup snapshots, and explicit bundle applies can still override this.
        resetStartupChartState();
        if (storedRayalgoCandleColorMode) {
          setRayalgoCandleColorModeState(storedRayalgoCandleColorMode);
        }

        const localHistoryStore = historyResponse?.value
          ? normalizeResearchHistoryStore(JSON.parse(historyResponse.value))
          : normalizeResearchHistoryStore();
        let serverHistoryStore = normalizeResearchHistoryStore();

        try {
          serverHistoryStore = normalizeResearchHistoryStore(await getResearchHistory());
          lastServerHistorySignatureRef.current = buildResearchHistorySignature(serverHistoryStore);
        } catch {
          lastServerHistorySignatureRef.current = "";
        }
        if (cancelled) return;

        const mergedHistoryStore = mergeResearchHistoryStores(serverHistoryStore, localHistoryStore);
        setResearchRunHistoryState(mergedHistoryStore.runHistory);
        setOptimizerHistoryState(mergedHistoryStore.optimizerHistory);
        setHistorySyncReady(true);
      } catch {
        // Keep local defaults if storage is unavailable.
      } finally {
        setHistorySyncReady(true);
      }
    };
    loadStoredState();
    return () => {
      cancelled = true;
    };
  }, [marketSymbol, resetStartupChartState, setStagedConfigUi]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.storage) return undefined;
    const timerId = setTimeout(() => {
      try {
        window.storage.set(RAYALGO_PREFS_KEY, JSON.stringify({
          marketSymbol,
          strategy,
          executionFidelity,
          optionCandleTf,
          chartsLinked,
          candleTf,
          spotChartType,
          optionChartType,
          rayalgoCandleColorMode: rayalgoCandleColorModeState,
          chartRange,
          chartWindowMode: chartWindowModeState,
          indicatorSelections: indicatorSelectionsState,
          indicatorOverlays: indicatorOverlaysState,
          rayalgoSettings: rayalgoSettingsState,
          rayalgoScoringConfig: rayalgoScoringConfigState,
          rayalgoWatcher: rayalgoWatcherState,
          stagedConfigUi: stagedConfigUiState,
          rayalgoBundleLibrary: rayalgoBundleLibraryState,
          selectedRayalgoBundleId: selectedRayalgoBundleIdState,
        }));
      } catch {
        // Ignore storage write failures.
      }
    }, 500);
    return () => clearTimeout(timerId);
  }, [
    marketSymbol,
    strategy,
    executionFidelity,
    optionCandleTf,
    chartsLinked,
    candleTf,
    spotChartType,
    optionChartType,
    rayalgoCandleColorModeState,
    chartRange,
    chartWindowModeState,
    indicatorSelectionsState,
    indicatorOverlaysState,
    rayalgoSettingsState,
    rayalgoScoringConfigState,
    rayalgoWatcherState,
    stagedConfigUiState,
    rayalgoBundleLibraryState,
    selectedRayalgoBundleIdState,
  ]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.storage) return undefined;
    const timerId = setTimeout(() => {
      try {
        window.storage.set(RESEARCH_HISTORY_KEY, JSON.stringify({
          runHistory: normalizeResearchRunHistory(researchRunHistoryState),
          optimizerHistory: normalizeResearchOptimizerHistory(optimizerHistoryState),
        }));
      } catch {
        // Ignore storage write failures.
      }
    }, 500);
    return () => clearTimeout(timerId);
  }, [optimizerHistoryState, researchRunHistoryState]);

  useEffect(() => {
    if (!historySyncReady) {
      return undefined;
    }

    let cancelled = false;
    const nextHistoryStore = normalizeResearchHistoryStore({
      runHistory: researchRunHistoryState,
      optimizerHistory: optimizerHistoryState,
    });
    const nextSignature = buildResearchHistorySignature(nextHistoryStore);
    if (!nextSignature || nextSignature === lastServerHistorySignatureRef.current) {
      return undefined;
    }

    const timerId = setTimeout(() => {
      saveResearchHistory(nextHistoryStore)
        .then((savedHistoryStore) => {
          if (cancelled) {
            return;
          }
          lastServerHistorySignatureRef.current = buildResearchHistorySignature(savedHistoryStore);
        })
        .catch(() => {
          // Keep local history even if the server sync path is unavailable.
        });
    }, 700);

    return () => {
      cancelled = true;
      clearTimeout(timerId);
    };
  }, [historySyncReady, optimizerHistoryState, researchRunHistoryState]);

  const toggleBlock = useCallback((index) => {
    setSessionBlocksCompat((previous) => {
      const next = [...previous];
      next[index] = !next[index];
      return next;
    });
  }, [setSessionBlocksCompat]);

  const setSessionPreset = useCallback((presetKey) => {
    const nextPreset = SESSION_PRESETS[presetKey];
    if (!nextPreset) return;
    setSessionBlocksCompat(nextPreset.map(Boolean));
  }, [setSessionBlocksCompat]);

  const toggleDay = useCallback((index) => {
    setTradeDaysCompat((previous) => {
      const next = [...previous];
      next[index] = !next[index];
      return next;
    });
  }, [setTradeDaysCompat]);

  const applyExitPreset = useCallback((presetKey) => {
    const preset = EXIT_PRESETS[presetKey];
    if (!preset) return;
    applyLegacyTopRailCompatPatch({
      slPct: preset.sl,
      tpPct: preset.tp,
      trailStartPct: preset.ts,
      trailPct: preset.tr,
    });
  }, [applyLegacyTopRailCompatPatch]);

  const applyStrategyPreset = useCallback((strategyKey) => {
    const normalizedStrategy = normalizeResearchStrategy(strategyKey);
    const preset = STRATEGY_PRESETS[normalizedStrategy];
    if (!preset) return;
    const exitPreset = EXIT_PRESETS[preset.exit];
    applyLegacyTopRailCompatPatch({
      slPct: exitPreset?.sl,
      tpPct: exitPreset?.tp,
      trailStartPct: exitPreset?.ts,
      trailPct: exitPreset?.tr,
      minConviction: preset.mc,
      zombieBars: preset.zb,
      regimeFilter: preset.rf,
    });
  }, [applyLegacyTopRailCompatPatch]);

  const selectStrategy = useCallback((strategyKey) => {
    const normalizedStrategy = normalizeResearchStrategy(strategyKey);
    setStrategy(normalizedStrategy);
    applyStrategyPreset(normalizedStrategy);
  }, [applyStrategyPreset]);

  const applyOptimizerResult = useCallback((result) => {
    if (!result) return;
    const exitPreset = String(result.exit || "").trim()
      ? EXIT_PRESETS[String(result.exit).trim()]
      : null;
    const nextPatch = {};
    if (Number.isFinite(Number(result.dte))) {
      nextPatch.dte = Number(result.dte);
    }
    if (String(result.regime || "").trim()) {
      nextPatch.regimeFilter = result.regime;
    }
    if (exitPreset) {
      nextPatch.slPct = exitPreset.sl;
      nextPatch.tpPct = exitPreset.tp;
      nextPatch.trailStartPct = exitPreset.ts;
      nextPatch.trailPct = exitPreset.tr;
    }
    if (Object.keys(nextPatch).length) {
      applyLegacyTopRailCompatPatch(nextPatch);
    }
  }, [applyLegacyTopRailCompatPatch]);

  const activeExitPreset = useMemo(
    () => getActiveExitPresetKey(slPct, tpPct),
    [slPct, tpPct],
  );

  const indicatorSelections = useMemo(
    () => normalizeIndicatorSelectionState(indicatorSelectionsState),
    [indicatorSelectionsState],
  );
  const indicatorOverlays = useMemo(
    () => normalizeIndicatorOverlays(indicatorOverlaysState),
    [indicatorOverlaysState],
  );
  const rayalgoSettings = useMemo(
    () => normalizeRayAlgoSettings(rayalgoSettingsState),
    [rayalgoSettingsState],
  );
  const rayalgoScoringConfig = useMemo(
    () => normalizeRayAlgoScoringPreferences(rayalgoScoringConfigState),
    [rayalgoScoringConfigState],
  );
  const rayalgoWatcher = useMemo(
    () => normalizeRayAlgoWatcher(rayalgoWatcherState),
    [rayalgoWatcherState],
  );
  const chartWindowMode = useMemo(
    () => normalizeChartWindowMode(chartWindowModeState),
    [chartWindowModeState],
  );
  const rayalgoCandleColorMode = useMemo(
    () => normalizeRayalgoCandleColorMode(rayalgoCandleColorModeState, DEFAULT_RAYALGO_CANDLE_COLOR_MODE),
    [rayalgoCandleColorModeState],
  );
  const rayalgoBundleLibrary = useMemo(
    () => normalizeRayAlgoBundleLibrary(rayalgoBundleLibraryState, marketSymbol),
    [marketSymbol, rayalgoBundleLibraryState],
  );
  const researchRunHistory = useMemo(
    () => normalizeResearchRunHistory(researchRunHistoryState),
    [researchRunHistoryState],
  );
  const optimizerHistory = useMemo(
    () => normalizeResearchOptimizerHistory(optimizerHistoryState),
    [optimizerHistoryState],
  );
  const currentRayalgoBundles = useMemo(
    () => rayalgoBundleLibrary.filter((bundle) => bundle.symbol === normalizeMarketSymbol(marketSymbol)),
    [marketSymbol, rayalgoBundleLibrary],
  );
  const selectedRayalgoBundle = useMemo(
    () => currentRayalgoBundles.find((bundle) => bundle.id === selectedRayalgoBundleIdState) || currentRayalgoBundles[0] || null,
    [currentRayalgoBundles, selectedRayalgoBundleIdState],
  );
  const currentRayalgoBundleSnapshot = useMemo(() => buildRayAlgoBundleSnapshot({
    rayalgoSettings: rayalgoSettingsState,
    rayalgoScoringConfig,
    candleTf,
    optionCandleTf,
    spotChartType,
    optionChartType,
    rayalgoCandleColorMode,
    chartRange,
    chartWindowMode: chartWindowModeState,
    indicatorOverlays: indicatorOverlaysState,
    executionFidelity,
    dte,
    optionStrikeSlot,
    slPct,
    tpPct,
    trailStartPct,
    trailPct,
    allowShorts,
    minConviction,
    zombieBars,
    regimeFilter,
  }), [
    allowShorts,
    candleTf,
    chartRange,
    chartWindowModeState,
    dte,
    executionFidelity,
    indicatorOverlaysState,
    minConviction,
    optionChartType,
    optionCandleTf,
    rayalgoCandleColorMode,
    optionStrikeSlot,
    rayalgoSettingsState,
    rayalgoScoringConfig,
    regimeFilter,
    slPct,
    spotChartType,
    tpPct,
    trailPct,
    trailStartPct,
    zombieBars,
  ]);
  const selectedRayalgoBundleSnapshotKey = useMemo(
    () => buildRayAlgoBundleSnapshotKey(selectedRayalgoBundle ? {
      rayalgoSettings: selectedRayalgoBundle.rayalgoSettings,
      chartSetup: selectedRayalgoBundle.chartSetup,
      backtestSetup: selectedRayalgoBundle.backtestSetup,
    } : null),
    [selectedRayalgoBundle],
  );
  const currentRayalgoBundleSnapshotKey = useMemo(
    () => buildRayAlgoBundleSnapshotKey(currentRayalgoBundleSnapshot),
    [currentRayalgoBundleSnapshot],
  );
  const isSelectedRayalgoBundleCustom = Boolean(
    selectedRayalgoBundle
    && selectedRayalgoBundleSnapshotKey
    && selectedRayalgoBundleSnapshotKey !== currentRayalgoBundleSnapshotKey,
  );

  useEffect(() => {
    if (!currentRayalgoBundles.length) {
      return;
    }
    const hasSelectedBundle = currentRayalgoBundles.some((bundle) => bundle.id === selectedRayalgoBundleIdState);
    if (!hasSelectedBundle) {
      setSelectedRayalgoBundleIdState(currentRayalgoBundles[0].id);
    }
  }, [currentRayalgoBundles, selectedRayalgoBundleIdState]);

  const applyRayalgoBundle = useCallback((bundleOrId, options = {}) => {
    const scope = String(options?.scope || "full").trim().toLowerCase() === "rayalgo_only"
      ? "rayalgo_only"
      : "full";
    const candidate = typeof bundleOrId === "string"
      ? rayalgoBundleLibrary.find((entry) => entry.id === bundleOrId) || null
      : (bundleOrId ? normalizeRayAlgoBundle(bundleOrId, marketSymbol) : null);
    if (!candidate) {
      return null;
    }

    setSelectedRayalgoBundleIdState(candidate.id);
    setStrategy("rayalgo");
    setRayalgoSettingsState(normalizeRayAlgoSettings(candidate.rayalgoSettings));
    setRayalgoScoringConfigState(normalizeRayAlgoScoringPreferences(
      candidate.backtestSetup.rayalgoScoringConfig || candidate.backtestSetup.scoringConfig || {},
    ));

    if (scope !== "rayalgo_only") {
      setCandleTf(candidate.chartSetup.candleTf);
      setOptionCandleTf(candidate.chartSetup.optionCandleTf || candidate.chartSetup.candleTf);
      setSpotChartTypeState(normalizeChartType(candidate.chartSetup.spotChartType, DEFAULT_CHART_TYPE));
      setOptionChartTypeState(normalizeChartType(candidate.chartSetup.optionChartType, DEFAULT_CHART_TYPE));
      setRayalgoCandleColorModeState(normalizeRayalgoCandleColorMode(
        candidate.chartSetup.rayalgoCandleColorMode,
        DEFAULT_RAYALGO_CANDLE_COLOR_MODE,
      ));
      setChartRange(candidate.chartSetup.chartRange);
      setChartWindowModeState(normalizeChartWindowMode(candidate.chartSetup.chartWindowMode));
      setIndicatorOverlaysState(normalizeIndicatorOverlays(candidate.chartSetup.indicatorOverlays));
      setExecutionFidelity(candidate.backtestSetup.executionFidelity);
      applyLegacyTopRailCompatPatch({
        dte: candidate.backtestSetup.dte,
        optionStrikeSlot: candidate.backtestSetup.optionStrikeSlot,
        slPct: candidate.backtestSetup.slPct,
        tpPct: candidate.backtestSetup.tpPct,
        trailStartPct: candidate.backtestSetup.trailStartPct,
        trailPct: candidate.backtestSetup.trailPct,
        allowShorts: candidate.backtestSetup.allowShorts,
        minConviction: candidate.backtestSetup.minConviction,
        zombieBars: candidate.backtestSetup.zombieBars,
        regimeFilter: candidate.backtestSetup.regimeFilter,
      });
      bumpChartPresetVersion();
    }

    return candidate;
  }, [
    applyLegacyTopRailCompatPatch,
    bumpChartPresetVersion,
    marketSymbol,
    rayalgoBundleLibrary,
  ]);

  const revertSelectedRayalgoBundle = useCallback(() => {
    if (!selectedRayalgoBundle) {
      return null;
    }
    return applyRayalgoBundle(selectedRayalgoBundle, { scope: "full" });
  }, [applyRayalgoBundle, selectedRayalgoBundle]);

  const saveRayalgoBundleVariant = useCallback((options = {}) => {
    const setup = options?.setup || null;
    const symbol = normalizeMarketSymbol(setup?.topRail?.marketSymbol || options?.marketSymbol || marketSymbol);
    const configuredBundleId = String(
      options?.selectedBundleId
      || setup?.rayalgo?.selectedRayalgoBundleId
      || options?.selectedBundle?.id
      || "",
    ).trim() || null;
    const sourceBundleCandidate = options?.selectedBundle
      || rayalgoBundleLibrary.find((bundle) => bundle.id === configuredBundleId)
      || rayalgoBundleLibrary.find((bundle) => bundle.id === selectedRayalgoBundle?.id)
      || rayalgoBundleLibrary.find((bundle) => bundle.symbol === symbol)
      || currentRayalgoBundles[0]
      || null;
    const sourceBundle = sourceBundleCandidate
      ? normalizeRayAlgoBundle(sourceBundleCandidate, symbol)
      : null;
    const snapshot = setup
      ? buildRayAlgoBundleSnapshotFromResearchSetup(setup)
      : currentRayalgoBundleSnapshot;
    const direction = snapshot.backtestSetup.allowShorts ? "put" : "call";
    const nextBundle = normalizeRayAlgoBundle({
      id: `${(sourceBundle?.id || `${symbol.toLowerCase()}-${direction}-bundle`)}-variant-${Date.now().toString(36)}`,
      label: buildRayAlgoBundleVariantLabel(
        options?.label || sourceBundle?.label || `${symbol} RayAlgo`,
        rayalgoBundleLibrary,
      ),
      symbol,
      direction,
      timeframeFamily: options?.timeframeFamily || sourceBundle?.timeframeFamily || `${snapshot.chartSetup.candleTf} custom`,
      variantOf: sourceBundle?.id || null,
      rayalgoSettings: snapshot.rayalgoSettings,
      chartSetup: snapshot.chartSetup,
      backtestSetup: snapshot.backtestSetup,
      evaluation: {
        tier: "test",
        tierSuggestion: options?.evaluation?.tierSuggestion || sourceBundle?.evaluation?.tierSuggestion || "test",
        trades: options?.evaluation?.trades ?? null,
        expectancyR: options?.evaluation?.expectancyR ?? null,
        maxDrawdownPct: options?.evaluation?.maxDrawdownPct ?? null,
        winRatePct: options?.evaluation?.winRatePct ?? null,
        profitFactor: options?.evaluation?.profitFactor ?? null,
        netReturnPct: options?.evaluation?.netReturnPct ?? null,
        avgHoldBars: options?.evaluation?.avgHoldBars ?? null,
        holdoutExpectancyR: options?.evaluation?.holdoutExpectancyR ?? null,
        holdoutProfitFactor: options?.evaluation?.holdoutProfitFactor ?? null,
        holdoutMaxDrawdownPct: options?.evaluation?.holdoutMaxDrawdownPct ?? null,
        sessionBadges: options?.evaluation?.sessionBadges || sourceBundle?.evaluation?.sessionBadges || [],
        regimeBadges: options?.evaluation?.regimeBadges || sourceBundle?.evaluation?.regimeBadges || [],
        statusText: options?.evaluation?.statusText || options?.statusText || "Saved variant awaiting validation",
        experimentalEligible: Boolean(options?.evaluation?.experimentalEligible),
        coreEligible: Boolean(options?.evaluation?.coreEligible),
      },
      playbook: {
        contractStyle: options?.playbook?.contractStyle || sourceBundle?.playbook?.contractStyle || "ATM",
        dteLabel: options?.playbook?.dteLabel || `${snapshot.backtestSetup.dte}D`,
        horizonLabel: options?.playbook?.horizonLabel || sourceBundle?.playbook?.horizonLabel || "Custom",
        sessionBias: options?.playbook?.sessionBias || sourceBundle?.playbook?.sessionBias || "Any",
        windowLabel: options?.playbook?.windowLabel || snapshot.chartSetup.chartRange,
        note: options?.playbook?.note || options?.note || "Saved from the current RayAlgo, chart, and backtest state.",
      },
      notes: Array.isArray(options?.notes) && options.notes.length
        ? options.notes
        : ["Custom variant"],
    }, symbol);

    setRayalgoBundleLibraryState((previous) => normalizeRayAlgoBundleLibrary([
      ...(Array.isArray(previous) ? previous : []),
      nextBundle,
    ], symbol));
    if (symbol === marketSymbol) {
      setSelectedRayalgoBundleIdState(nextBundle.id);
    }
    return nextBundle;
  }, [
    currentRayalgoBundleSnapshot,
    currentRayalgoBundles,
    marketSymbol,
    rayalgoBundleLibrary,
    selectedRayalgoBundle?.id,
  ]);

  const updateRayalgoBundleEvaluation = useCallback((bundleId, evaluationPatch = {}) => {
    const normalizedBundleId = String(bundleId || "").trim();
    if (!normalizedBundleId) {
      return;
    }

    setRayalgoBundleLibraryState((previous) => {
      const normalizedLibrary = normalizeRayAlgoBundleLibrary(previous, marketSymbol);
      let didChange = false;
      const nextLibrary = normalizedLibrary.map((bundle) => {
        if (bundle.id !== normalizedBundleId) {
          return bundle;
        }
        const nextBundle = normalizeRayAlgoBundle({
          ...bundle,
          evaluation: {
            ...bundle.evaluation,
            ...evaluationPatch,
          },
        }, marketSymbol);
        if (JSON.stringify(nextBundle.evaluation) === JSON.stringify(bundle.evaluation)) {
          return bundle;
        }
        didChange = true;
        return nextBundle;
      });
      return didChange ? nextLibrary : previous;
    });
  }, [marketSymbol]);

  const appendResearchRunHistory = useCallback((entry = {}) => {
    const nextEntry = createResearchRunHistoryEntry(entry);
    setResearchRunHistoryState((previous) => {
      const normalized = normalizeResearchRunHistory(previous);
      if (normalized[0]?.signature === nextEntry.signature) {
        return previous;
      }
      return normalizeResearchRunHistory([
        nextEntry,
        ...normalized.filter((candidate) => candidate.id !== nextEntry.id),
      ]);
    });
    return nextEntry;
  }, []);

  const appendResearchOptimizerHistory = useCallback((entry = {}) => {
    const nextEntry = createResearchOptimizerHistoryEntry(entry);
    setOptimizerHistoryState((previous) => {
      const normalized = normalizeResearchOptimizerHistory(previous);
      if (normalized[0]?.signature === nextEntry.signature) {
        return previous;
      }
      return normalizeResearchOptimizerHistory([
        nextEntry,
        ...normalized.filter((candidate) => candidate.id !== nextEntry.id),
      ]);
    });
    return nextEntry;
  }, []);

  const clearResearchRunHistory = useCallback(() => {
    setResearchRunHistoryState([]);
  }, []);

  const clearResearchOptimizerHistory = useCallback(() => {
    setOptimizerHistoryState([]);
  }, []);

  const setRayalgoBundleTier = useCallback((bundleId, nextTier) => {
    const normalizedBundleId = String(bundleId || "").trim();
    if (!normalizedBundleId) {
      return {
        ok: false,
        reason: "Select a RayAlgo bundle first.",
      };
    }

    const targetTier = normalizeRayalgoBundleTier(nextTier);
    const currentBundle = rayalgoBundleLibrary.find((bundle) => bundle.id === normalizedBundleId) || null;
    if (!currentBundle) {
      return {
        ok: false,
        reason: "Bundle not found.",
      };
    }

    const currentTier = normalizeRayalgoBundleTier(currentBundle.evaluation?.tier);
    const currentRank = RAYALGO_BUNDLE_TIER_ORDER.indexOf(currentTier);
    const targetRank = RAYALGO_BUNDLE_TIER_ORDER.indexOf(targetTier);
    const movingUp = targetRank > currentRank;

    if (movingUp && targetTier === "experimental" && !currentBundle.evaluation?.experimentalEligible) {
      return {
        ok: false,
        reason: "Experimental needs 25 trades, positive holdout expectancy, PF > 1, and acceptable drawdown.",
      };
    }

    if (movingUp && targetTier === "core") {
      if (currentTier !== "experimental") {
        return {
          ok: false,
          reason: "Promote the bundle to Experimental before approving Core.",
        };
      }
      if (!currentBundle.evaluation?.coreEligible) {
        return {
          ok: false,
          reason: "Core needs 75 trades, the experimental gate, and drawdown within 25%.",
        };
      }
    }

    if (currentTier === targetTier) {
      return {
        ok: true,
        changed: false,
        bundle: currentBundle,
      };
    }

    const nextBundle = normalizeRayAlgoBundle({
      ...currentBundle,
      evaluation: {
        ...currentBundle.evaluation,
        tier: targetTier,
      },
    }, marketSymbol);

    setRayalgoBundleLibraryState((previous) => {
      const normalizedLibrary = normalizeRayAlgoBundleLibrary(previous, marketSymbol);
      let didChange = false;
      const nextLibrary = normalizedLibrary.map((bundle) => {
        if (bundle.id !== normalizedBundleId) {
          return bundle;
        }
        didChange = JSON.stringify(bundle.evaluation) !== JSON.stringify(nextBundle.evaluation);
        return nextBundle;
      });
      return didChange ? nextLibrary : previous;
    });

    return {
      ok: true,
      changed: true,
      bundle: nextBundle,
    };
  }, [marketSymbol, rayalgoBundleLibrary]);

  const applyResearchSetupSnapshot = useCallback((setup = {}) => {
    const topRailState = normalizeSurfacePrefs(setup?.topRail || {});
    const storedMarketSymbol = topRailState?.marketSymbol || marketSymbol;
    const parsedRayalgo = setup?.rayalgo || {};

    if (topRailState?.marketSymbol) {
      setMarketSymbol(topRailState.marketSymbol);
    }
    if (topRailState?.strategy) {
      setStrategy(topRailState.strategy);
    }
    if (topRailState?.executionFidelity) {
      setExecutionFidelity(topRailState.executionFidelity);
    }
    if (topRailState?.optionCandleTf) {
      setOptionCandleTf(topRailState.optionCandleTf);
    }
    if (typeof topRailState?.chartsLinked === "boolean") {
      setChartsLinked(topRailState.chartsLinked);
    }

    if (parsedRayalgo?.candleTf) {
      setCandleTf(String(parsedRayalgo.candleTf).trim() || "auto");
    }
    if (Object.prototype.hasOwnProperty.call(parsedRayalgo || {}, "spotChartType")) {
      setSpotChartTypeState(normalizeChartType(parsedRayalgo.spotChartType, DEFAULT_CHART_TYPE));
    }
    if (Object.prototype.hasOwnProperty.call(parsedRayalgo || {}, "optionChartType")) {
      setOptionChartTypeState(normalizeChartType(parsedRayalgo.optionChartType, DEFAULT_CHART_TYPE));
    }
    if (Object.prototype.hasOwnProperty.call(parsedRayalgo || {}, "rayalgoCandleColorMode")) {
      setRayalgoCandleColorModeState(normalizeRayalgoCandleColorMode(
        parsedRayalgo.rayalgoCandleColorMode,
        DEFAULT_RAYALGO_CANDLE_COLOR_MODE,
      ));
    }
    if (parsedRayalgo?.chartRange) {
      setChartRange(String(parsedRayalgo.chartRange).trim() || resolveDefaultVisibleRangeForTimeframe(parsedRayalgo?.candleTf || "auto"));
    }
    if (Object.prototype.hasOwnProperty.call(parsedRayalgo || {}, "chartWindowMode")) {
      setChartWindowModeState(normalizeChartWindowMode(parsedRayalgo.chartWindowMode));
    }
    if (parsedRayalgo?.indicatorOverlays) {
      setIndicatorOverlaysState(normalizeIndicatorOverlays(parsedRayalgo.indicatorOverlays));
    }
    if (parsedRayalgo?.indicatorSelections || parsedRayalgo?.tvStudies) {
      setIndicatorSelectionsState(normalizeIndicatorSelectionState(parsedRayalgo.indicatorSelections || parsedRayalgo.tvStudies));
    }
    if (parsedRayalgo?.rayalgoSettings) {
      setRayalgoSettingsState(normalizeRayAlgoSettings(parsedRayalgo.rayalgoSettings));
    }
    if (parsedRayalgo?.scoringConfig || parsedRayalgo?.rayalgoScoringConfig || parsedRayalgo?.scoringContext) {
      setRayalgoScoringConfigState(normalizeRayAlgoScoringPreferences(
        parsedRayalgo.scoringConfig || parsedRayalgo.rayalgoScoringConfig || parsedRayalgo.scoringContext,
      ));
    }
    if (parsedRayalgo?.rayalgoWatcher) {
      setRayalgoWatcherState(normalizeRayAlgoWatcher(parsedRayalgo.rayalgoWatcher));
    }
    if (parsedRayalgo?.stagedConfigUi) {
      setStagedConfigUi(parsedRayalgo.stagedConfigUi);
    } else {
      setStagedConfigUi(cloneBacktestV2StageDefaults());
    }
    if (parsedRayalgo?.selectedRayalgoBundleId) {
      const selectedId = String(parsedRayalgo.selectedRayalgoBundleId).trim() || null;
      const bundleExists = rayalgoBundleLibrary.some((bundle) => bundle.id === selectedId && bundle.symbol === normalizeMarketSymbol(storedMarketSymbol));
      setSelectedRayalgoBundleIdState(bundleExists ? selectedId : null);
    } else {
      setSelectedRayalgoBundleIdState(null);
    }
    bumpChartPresetVersion();
    return {
      ok: true,
      marketSymbol: storedMarketSymbol,
    };
  }, [bumpChartPresetVersion, marketSymbol, rayalgoBundleLibrary, setStagedConfigUi]);

  const saveOptimizerResultAsRayalgoBundle = useCallback((result, options = {}) => {
    const normalizedStrategy = normalizeResearchStrategy(result?.strategy || strategy);
    if (normalizedStrategy !== "rayalgo") {
      return {
        ok: false,
        reason: "Only RayAlgo optimizer candidates can be saved into the RayAlgo bundle library.",
      };
    }

    const setup = options?.setup || null;
    const baseSnapshot = setup
      ? buildRayAlgoBundleSnapshotFromResearchSetup(setup)
      : currentRayalgoBundleSnapshot;
    const symbol = normalizeMarketSymbol(setup?.topRail?.marketSymbol || marketSymbol);
    const configuredBundleId = String(setup?.rayalgo?.selectedRayalgoBundleId || "").trim() || null;
    const sourceBundle = rayalgoBundleLibrary.find((bundle) => bundle.id === configuredBundleId)
      || rayalgoBundleLibrary.find((bundle) => bundle.id === selectedRayalgoBundle?.id)
      || rayalgoBundleLibrary.find((bundle) => bundle.symbol === symbol)
      || null;
    const direction = baseSnapshot.backtestSetup.allowShorts ? "put" : "call";
    const timeframeFamily = sourceBundle?.timeframeFamily || `${baseSnapshot.chartSetup.candleTf} optimizer`;
    const resultEvaluation = result?.bundleEvaluation?.summary || null;
    const nextBundle = normalizeRayAlgoBundle({
      id: `${(sourceBundle?.id || `${symbol.toLowerCase()}-${direction}-optimizer`)}-opt-${Date.now().toString(36)}`,
      label: buildRayAlgoBundleVariantLabel(
        `${sourceBundle?.label || `${symbol} ${timeframeFamily}`} Opt ${Number.isFinite(Number(result?.dte)) ? `${Math.round(Number(result.dte))}D` : ""} ${String(result?.exit || "candidate").toUpperCase()}`.trim(),
        rayalgoBundleLibrary,
      ),
      symbol,
      direction,
      timeframeFamily,
      variantOf: sourceBundle?.id || null,
      rayalgoSettings: baseSnapshot.rayalgoSettings,
      chartSetup: baseSnapshot.chartSetup,
      backtestSetup: {
        ...baseSnapshot.backtestSetup,
        dte: Number.isFinite(Number(result?.dte)) ? Math.round(Number(result.dte)) : baseSnapshot.backtestSetup.dte,
        slPct: Number.isFinite(Number(result?.sl)) ? Number(result.sl) : baseSnapshot.backtestSetup.slPct,
        tpPct: Number.isFinite(Number(result?.tp)) ? Number(result.tp) : baseSnapshot.backtestSetup.tpPct,
        trailStartPct: Number.isFinite(Number(result?.trailStartPct)) ? Number(result.trailStartPct) : baseSnapshot.backtestSetup.trailStartPct,
        trailPct: Number.isFinite(Number(result?.trailPct)) ? Number(result.trailPct) : baseSnapshot.backtestSetup.trailPct,
        regimeFilter: String(result?.regime || baseSnapshot.backtestSetup.regimeFilter || "none").trim() || "none",
      },
      evaluation: {
        tier: "test",
        tierSuggestion: resultEvaluation?.tierSuggestion || "test",
        trades: resultEvaluation?.trades ?? result?.n ?? null,
        expectancyR: resultEvaluation?.expectancyR ?? null,
        maxDrawdownPct: resultEvaluation?.maxDrawdownPct ?? result?.dd ?? null,
        winRatePct: resultEvaluation?.winRatePct ?? result?.wr ?? null,
        profitFactor: resultEvaluation?.profitFactor ?? result?.pf ?? null,
        netReturnPct: resultEvaluation?.netReturnPct ?? result?.roi ?? null,
        avgHoldBars: resultEvaluation?.avgHoldBars ?? null,
        holdoutExpectancyR: resultEvaluation?.holdoutExpectancyR ?? null,
        holdoutProfitFactor: resultEvaluation?.holdoutProfitFactor ?? null,
        holdoutMaxDrawdownPct: resultEvaluation?.holdoutMaxDrawdownPct ?? null,
        sessionBadges: resultEvaluation?.sessionBadges || [],
        regimeBadges: resultEvaluation?.regimeBadges || [],
        statusText: resultEvaluation?.statusText || `Optimizer candidate · ${String(result?.exit || "setup").toUpperCase()} · ${Number.isFinite(Number(result?.dte)) ? `${Math.round(Number(result.dte))}D` : "Current DTE"}`,
        experimentalEligible: Boolean(resultEvaluation?.experimentalEligible),
        coreEligible: Boolean(resultEvaluation?.coreEligible),
      },
      playbook: {
        contractStyle: sourceBundle?.playbook?.contractStyle || "ATM",
        dteLabel: Number.isFinite(Number(result?.dte)) ? `${Math.round(Number(result.dte))}D` : (sourceBundle?.playbook?.dteLabel || "--"),
        horizonLabel: sourceBundle?.playbook?.horizonLabel || "Optimizer",
        sessionBias: sourceBundle?.playbook?.sessionBias || "Any",
        windowLabel: baseSnapshot.chartSetup.chartRange,
        note: `Optimizer candidate saved from ${String(result?.exit || "current").toUpperCase()} with ${Number.isFinite(Number(result?.dte)) ? `${Math.round(Number(result.dte))}D` : "current DTE"} settings.`,
      },
      notes: [
        "Optimizer candidate",
        String(result?.exit || "").trim() ? `Exit ${String(result.exit).toUpperCase()}` : "",
        Number.isFinite(Number(result?.score)) ? `Score ${Number(result.score).toFixed(4)}` : "",
      ].filter(Boolean),
    }, symbol);

    setRayalgoBundleLibraryState((previous) => normalizeRayAlgoBundleLibrary([
      ...(Array.isArray(previous) ? previous : []),
      nextBundle,
    ], symbol));
    setSelectedRayalgoBundleIdState(nextBundle.id);
    return {
      ok: true,
      bundle: nextBundle,
    };
  }, [
    currentRayalgoBundleSnapshot,
    marketSymbol,
    rayalgoBundleLibrary,
    selectedRayalgoBundle?.id,
    strategy,
  ]);

  return {
    marketSymbol,
    setMarketSymbol,
    executionMode,
    setExecutionMode,
    executionFidelity,
    setExecutionFidelity,
    strategy,
    dte,
    setDte: setDteCompat,
    optionStrikeSlot,
    setOptionStrikeSlot: setOptionStrikeSlotCompat,
    iv,
    setIv,
    slPct,
    setSlPct: setSlPctCompat,
    tpPct,
    setTpPct: setTpPctCompat,
    trailStartPct,
    setTrailStartPct: setTrailStartPctCompat,
    trailPct,
    setTrailPct: setTrailPctCompat,
    zombieBars,
    setZombieBars: setZombieBarsCompat,
    minConviction,
    setMinConviction: setMinConvictionCompat,
    allowShorts,
    setAllowShorts: setAllowShortsCompat,
    kellyFrac,
    setKellyFrac: setKellyFracCompat,
    regimeFilter,
    setRegimeFilter: setRegimeFilterCompat,
    capital,
    setCapital: setCapitalCompat,
    maxPos,
    setMaxPos: setMaxPosCompat,
    sessionBlocks,
    toggleBlock,
    setSessionPreset,
    tradeDays,
    toggleDay,
    regimeAdapt,
    setRegimeAdapt: setRegimeAdaptCompat,
    commPerContract,
    setCommPerContract: setCommPerContractCompat,
    slipBps,
    setSlipBps: setSlipBpsCompat,
    indicatorSelections,
    setIndicatorSelections,
    indicatorOverlays,
    setIndicatorOverlays,
    chartRange,
    setChartRange,
    chartWindowMode,
    setChartWindowMode,
    chartPresetVersion,
    bumpChartPresetVersion,
    candleTf,
    setCandleTf,
    optionCandleTf,
    setOptionCandleTf,
    spotChartType,
    setSpotChartType,
    optionChartType,
    setOptionChartType,
    rayalgoCandleColorMode,
    setRayalgoCandleColorMode,
    chartsLinked,
    setChartsLinked,
    rayalgoSettings,
    setRayalgoSettings,
    mergeRayalgoSettings: (patch) => setRayalgoSettings((previous) => mergeRayAlgoSettings(previous, patch)),
    rayalgoScoringConfig,
    setRayalgoScoringConfig,
    setRayalgoPrecursorLadderId,
    setRayalgoScoringAuthority,
    setRayalgoScoringDisplayMode,
    rayalgoWatcher,
    setRayalgoWatcher,
    rayalgoBundleLibrary,
    researchRunHistory,
    optimizerHistory,
    stagedConfigUiState,
    setStagedConfigField,
    resetStagedConfigSection,
    resetStagedConfigUi,
    currentRayalgoBundles,
    selectedRayalgoBundle,
    setSelectedRayalgoBundleId: setSelectedRayalgoBundleIdState,
    isSelectedRayalgoBundleCustom,
    applyRayalgoBundle,
    revertSelectedRayalgoBundle,
    saveRayalgoBundleVariant,
    updateRayalgoBundleEvaluation,
    setRayalgoBundleTier,
    appendResearchRunHistory,
    appendResearchOptimizerHistory,
    clearResearchRunHistory,
    clearResearchOptimizerHistory,
    applyResearchSetupSnapshot,
    saveOptimizerResultAsRayalgoBundle,
    activeExitPreset,
    applyExitPreset,
    selectStrategy,
    applyOptimizerResult,
    exitPresets: EXIT_PRESETS,
    strategyPresets: STRATEGY_PRESETS,
  };
}
