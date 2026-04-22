import {
  buildChartSeriesModel,
  buildIndicatorOverlayModel,
  buildTradeOverlayModel,
} from "./displayModel.js";
import { buildIndicatorMarkerPayload } from "./indicatorMarkerModel.js";
import { buildStudyModel } from "./studyModel.js";
import {
  DEFAULT_RESEARCH_STRATEGY,
  normalizeResearchStrategy,
} from "../config/strategyPresets.js";
import { buildTradeMarkerGroups } from "./tradeMarkerModel.js";
import {
  filterIndicatorEventsByStrategy,
  filterIndicatorWindowsByStrategy,
  filterIndicatorZonesByStrategy,
  filterOverlayGroupsByStrategy,
  filterTradeOverlaysByStrategy,
} from "./researchChartOverlayFilters.js";

function nowMs() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function resolveLatestIndicatorWindowDirection(indicatorWindows = []) {
  const latestWindow = (Array.isArray(indicatorWindows) ? indicatorWindows : [])
    .filter((indicatorWindow) => indicatorWindow?.direction === "long" || indicatorWindow?.direction === "short")
    .slice()
    .sort((left, right) => {
      const leftEnd = Number(left?.endBarIndex);
      const rightEnd = Number(right?.endBarIndex);
      if (Number.isFinite(leftEnd) || Number.isFinite(rightEnd)) {
        return (Number.isFinite(rightEnd) ? rightEnd : -1) - (Number.isFinite(leftEnd) ? leftEnd : -1);
      }
      return String(right?.endTs || right?.startTs || "").localeCompare(String(left?.endTs || left?.startTs || ""));
    })[0] || null;
  return latestWindow?.direction === "short" ? "short" : latestWindow?.direction === "long" ? "long" : null;
}

export function buildResearchChartModel({
  bars = [],
  dailyBars = [],
  chartRange = "3M",
  chartWindowMode = "default",
  effectiveTf = "D",
  tfMin = 5,
  strategy = DEFAULT_RESEARCH_STRATEGY,
  executionMode = null,
  chartPriceContext = "spot",
  trades = [],
  indicatorOverlayTape = null,
  indicatorWindowTape = null,
  indicatorSelections = [],
  rayalgoSettings = null,
} = {}) {
  const normalizedStrategy = normalizeResearchStrategy(strategy);

  const seriesStart = nowMs();
  const {
    chartBars,
    chartBarRanges,
    defaultVisibleLogicalRange,
  } = buildChartSeriesModel({
    bars,
    dailyBars,
    chartRange,
    chartWindowMode,
    effectiveTf,
    tfMin,
  });
  const seriesMs = nowMs() - seriesStart;

  const tradeStart = nowMs();
  const {
    tradeOverlays,
    entriesByBarIndex,
    exitsByBarIndex,
    tradeResolutionStats,
    overlayFallbackCount,
  } = buildTradeOverlayModel({
    chartBars,
    chartBarRanges,
    trades,
    pricingMode: executionMode,
    chartPriceContext,
  });
  const tradeMs = nowMs() - tradeStart;

  const indicatorStart = nowMs();
  const resolvedIndicatorOverlayTape = {
    events: Array.isArray(indicatorOverlayTape?.events) ? indicatorOverlayTape.events : [],
    zones: Array.isArray(indicatorOverlayTape?.zones) ? indicatorOverlayTape.zones : [],
    windows: Array.isArray(indicatorWindowTape?.windows)
      ? indicatorWindowTape.windows
      : (Array.isArray(indicatorOverlayTape?.windows) ? indicatorOverlayTape.windows : []),
  };
  const {
    indicatorEvents,
    indicatorZones,
    indicatorWindows,
    indicatorOverlayFallbackCount,
  } = buildIndicatorOverlayModel({
    chartBarRanges,
    indicatorOverlayTape: resolvedIndicatorOverlayTape,
    trades,
  });
  const indicatorMs = nowMs() - indicatorStart;

  const filteredIndicatorEvents = filterIndicatorEventsByStrategy(indicatorEvents, normalizedStrategy);
  const filteredIndicatorZones = filterIndicatorZonesByStrategy(indicatorZones, normalizedStrategy);
  const filteredIndicatorWindows = filterIndicatorWindowsByStrategy(indicatorWindows, normalizedStrategy);
  const filteredTradeOverlays = filterTradeOverlaysByStrategy(tradeOverlays, normalizedStrategy);
  const rayalgoTrendDirection = normalizedStrategy === "rayalgo"
    ? resolveLatestIndicatorWindowDirection(filteredIndicatorWindows)
    : null;

  const studyStart = nowMs();
  const {
    studyVisibility,
    studySpecs,
    smcMarkers,
    lowerPaneCount,
  } = buildStudyModel({
    chartBars,
    indicatorSelections,
    strategy: normalizedStrategy,
    rayalgoSettings,
    rayalgoTrendDirection,
  });
  const studyMs = nowMs() - studyStart;
  const tradeMarkerGroups = buildTradeMarkerGroups(chartBars, filteredTradeOverlays);
  const indicatorMarkerPayload = buildIndicatorMarkerPayload(chartBars, filteredIndicatorEvents);

  return {
    effectiveTf,
    chartBars,
    chartBarRanges,
    defaultVisibleLogicalRange,
    tradeOverlays: filteredTradeOverlays,
    entriesByBarIndex: filterOverlayGroupsByStrategy(entriesByBarIndex, normalizedStrategy),
    exitsByBarIndex: filterOverlayGroupsByStrategy(exitsByBarIndex, normalizedStrategy),
    tradeResolutionStats,
    overlayFallbackCount,
    indicatorEvents: filteredIndicatorEvents,
    indicatorZones: filteredIndicatorZones,
    indicatorWindows: filteredIndicatorWindows,
    indicatorOverlayFallbackCount,
    indicatorMarkerPayload,
    studyVisibility,
    studySpecs,
    smcMarkers,
    lowerPaneCount,
    tradeMarkerGroups,
    debugPerf: {
      seriesMs,
      tradeMs,
      indicatorMs,
      studyMs,
      totalMs: seriesMs + tradeMs + indicatorMs + studyMs,
      chartBars: chartBars.length,
      tradeOverlays: filteredTradeOverlays.length,
      indicatorEvents: filteredIndicatorEvents.length,
      indicatorWindows: filteredIndicatorWindows.length,
    },
  };
}
