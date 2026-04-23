import {
  defaultIndicatorRegistry,
  resolveIndicatorPlugins,
} from "./indicators";
import type {
  BuildChartModelInput,
  ChartBar,
  ChartBarRange,
  ChartBarStyle,
  ChartMarker,
  ChartModel,
  IndicatorPluginOutput,
  MarketBar,
} from "./types";

const timeframeToStepMs = (timeframe: string): number =>
  ({
    "1m": 60_000,
    "5m": 300_000,
    "15m": 900_000,
    "1h": 3_600_000,
    "1d": 86_400_000,
    "1D": 86_400_000,
  })[timeframe] || 300_000;

const resolveTimestampValueMs = (
  value: MarketBar["time"] | MarketBar["timestamp"],
): number | null => {
  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? Math.floor(value) : Math.floor(value * 1000);
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return null;
};

const resolveEpochMs = (bar: MarketBar): number | null => {
  const resolvedTime = resolveTimestampValueMs(bar.time);
  if (resolvedTime != null) {
    return resolvedTime;
  }

  const resolvedTimestamp = resolveTimestampValueMs(bar.timestamp);
  if (resolvedTimestamp != null) {
    return resolvedTimestamp;
  }

  if (typeof bar.ts === "string") {
    const parsed = Date.parse(bar.ts);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return null;
};

const resolveNumber = (...values: Array<number | undefined>): number | null => {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }

  return null;
};

const buildChartBars = (
  rawBars: MarketBar[],
  timeframe: string,
): { chartBars: ChartBar[]; chartBarRanges: ChartBarRange[] } => {
  const fallbackStepMs = timeframeToStepMs(timeframe);
  const normalizedBars = rawBars.reduce<Array<ChartBar & { startMs: number }>>(
    (bars, rawBar) => {
      const startMs = resolveEpochMs(rawBar);
      const open = resolveNumber(rawBar.o, rawBar.open);
      const high = resolveNumber(rawBar.h, rawBar.high);
      const low = resolveNumber(rawBar.l, rawBar.low);
      const close = resolveNumber(rawBar.c, rawBar.close);

      if (
        startMs == null ||
        open == null ||
        high == null ||
        low == null ||
        close == null
      ) {
        return bars;
      }

      const isoTimestamp = rawBar.ts || new Date(startMs).toISOString();
      bars.push({
        startMs,
        time: Math.floor(startMs / 1000),
        ts: isoTimestamp,
        date: rawBar.date || isoTimestamp.slice(0, 10),
        o: open,
        h: high,
        l: low,
        c: close,
        v: resolveNumber(rawBar.v, rawBar.volume) ?? 0,
        vwap: resolveNumber(rawBar.vwap) ?? undefined,
        sessionVwap: resolveNumber(rawBar.sessionVwap) ?? undefined,
        accumulatedVolume: resolveNumber(rawBar.accumulatedVolume) ?? undefined,
        averageTradeSize: resolveNumber(rawBar.averageTradeSize) ?? undefined,
        source: typeof rawBar.source === "string" ? rawBar.source : undefined,
      });
      return bars;
    },
    [],
  );

  const chartBars = normalizedBars.map(({ startMs: _startMs, ...bar }) => bar);
  const chartBarRanges = normalizedBars.map((bar, index) => {
    const nextBar = normalizedBars[index + 1];
    return {
      startMs: bar.startMs,
      endMs: nextBar?.startMs ?? bar.startMs + fallbackStepMs,
    };
  });

  return { chartBars, chartBarRanges };
};

const mergeBarStyles = (
  styleLayers: Array<Array<ChartBarStyle | null>>,
  length: number,
): Array<ChartBarStyle | null> => {
  const merged = new Array<ChartBarStyle | null>(length).fill(null);

  styleLayers.forEach((layer) => {
    layer.forEach((style, index) => {
      if (!style) {
        return;
      }

      merged[index] = {
        ...(merged[index] || {}),
        ...style,
      };
    });
  });

  return merged;
};

const applyBarStyles = (
  chartBars: ChartBar[],
  barStyles: Array<ChartBarStyle | null>,
): ChartBar[] =>
  chartBars.map((bar, index) => ({
    ...bar,
    ...(barStyles[index] || {}),
  }));

const buildStudyVisibilityMap = (
  studyKeys: string[],
): Record<string, boolean> =>
  studyKeys.reduce<Record<string, boolean>>((visibility, key) => {
    visibility[key] = true;
    return visibility;
  }, {});

const normalizeStudyPanes = (
  studySpecs: ChartModel["studySpecs"],
): ChartModel["studySpecs"] => {
  const lowerPaneMap = new Map<string, number>();
  let nextPaneIndex = 1;

  return studySpecs.map((spec) => {
    if (spec.paneIndex <= 0 && !spec.paneKey) {
      return spec;
    }

    const paneKey = spec.paneKey || `pane-${spec.paneIndex}`;
    if (!lowerPaneMap.has(paneKey)) {
      lowerPaneMap.set(paneKey, nextPaneIndex);
      nextPaneIndex += 1;
    }

    return {
      ...spec,
      paneIndex: lowerPaneMap.get(paneKey) || 1,
    };
  });
};

const resolveLowerPaneCount = (
  studySpecs: ChartModel["studySpecs"],
): number => {
  if (!studySpecs.length) {
    return 0;
  }

  return studySpecs.reduce(
    (maxPane, spec) => Math.max(maxPane, spec.paneIndex),
    0,
  );
};

const defaultVisibleBarsForTimeframe = (timeframe: string): number =>
  ({
    "1m": 720,
    "5m": 620,
    "15m": 520,
    "1h": 420,
    "1d": 260,
    "1D": 260,
  })[timeframe] || 360;

const buildDefaultVisibleRange = (
  chartBars: ChartBar[],
  timeframe: string,
): { from: number; to: number } | null => {
  if (!chartBars.length) {
    return null;
  }

  const to = chartBars.length - 1;
  const from = Math.max(0, to - defaultVisibleBarsForTimeframe(timeframe));
  return { from, to };
};

const normalizeMarkers = (
  markers: ChartMarker[],
  barCount: number,
): ChartMarker[] =>
  markers
    .filter((marker) => marker.barIndex >= 0 && marker.barIndex < barCount)
    .sort((left, right) => left.time - right.time);

export const buildResearchChartModel = (
  input: BuildChartModelInput,
): ChartModel => {
  const {
    bars,
    dailyBars,
    timeframe,
    selectedIndicators = [],
    indicatorSettings = {},
    indicatorMarkers = [],
    indicatorRegistry = defaultIndicatorRegistry,
  } = input;
  const { chartBars, chartBarRanges } = buildChartBars(bars, timeframe);
  const plugins = resolveIndicatorPlugins(
    selectedIndicators,
    indicatorRegistry,
  );
  const pluginOutputs = plugins.map((plugin) =>
    plugin.compute({
      chartBars,
      rawBars: bars,
      dailyBars,
      settings: indicatorSettings[plugin.id],
      timeframe,
      selectedIndicators,
    }),
  );
  const pluginStudySpecs = normalizeStudyPanes(
    pluginOutputs.flatMap((output) => output.studySpecs || []),
  );
  const pluginMarkers = pluginOutputs.flatMap((output) => output.markers || []);
  const pluginEvents = pluginOutputs.flatMap((output) => output.events || []);
  const pluginZones = pluginOutputs.flatMap((output) => output.zones || []);
  const pluginWindows = pluginOutputs.flatMap((output) => output.windows || []);
  const mergedBarStyles = mergeBarStyles(
    pluginOutputs.map(
      (output: IndicatorPluginOutput) => output.barStyleByIndex || [],
    ),
    chartBars.length,
  );
  const styledChartBars = applyBarStyles(chartBars, mergedBarStyles);
  const overviewMarkers = normalizeMarkers(
    [...indicatorMarkers, ...pluginMarkers],
    styledChartBars.length,
  );

  return {
    chartBars: styledChartBars,
    chartBarRanges,
    tradeOverlays: [],
    tradeMarkerGroups: {
      entryGroups: [],
      exitGroups: [],
      interactionGroups: [],
      timeToTradeIds: new Map(),
    },
    studySpecs: pluginStudySpecs,
    studyVisibility: buildStudyVisibilityMap(
      pluginStudySpecs.map((spec) => spec.key),
    ),
    studyLowerPaneCount: resolveLowerPaneCount(pluginStudySpecs),
    indicatorEvents: pluginEvents,
    indicatorZones: pluginZones,
    indicatorWindows: pluginWindows,
    indicatorMarkerPayload: {
      overviewMarkers,
      markersByTradeId: {},
      timeToTradeIds: new Map(),
    },
    activeTradeSelectionId: null,
    selectionFocus: null,
    defaultVisibleLogicalRange: buildDefaultVisibleRange(styledChartBars, timeframe),
  };
};
