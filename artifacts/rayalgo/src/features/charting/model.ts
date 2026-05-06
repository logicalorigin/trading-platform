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
import { getChartTimeframeStepMs, normalizeChartTimeframe } from "./timeframes";

export type ResearchChartModelBuildState = {
  input: {
    bars: MarketBar[];
    dailyBars?: MarketBar[];
    timeframe: string;
    defaultVisibleBarCount?: number;
    selectedIndicators: string[];
    indicatorSettings: Record<string, Record<string, unknown>>;
    indicatorMarkers: ChartMarker[];
    indicatorRegistry: BuildChartModelInput["indicatorRegistry"];
  };
  plugins: ReturnType<typeof resolveIndicatorPlugins>;
  chartBars: ChartBar[];
  chartBarRanges: ChartBarRange[];
  pluginOutputs: IndicatorPluginOutput[];
  model: ChartModel;
};

const timeframeToStepMs = (timeframe: string): number =>
  getChartTimeframeStepMs(normalizeChartTimeframe(timeframe)) || 300_000;

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
  const normalizedByChartTime = rawBars.reduce<
    Map<number, ChartBar & { startMs: number; inputIndex: number }>
  >(
    (bars, rawBar, inputIndex) => {
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
      const chartTime = Math.floor(startMs / 1000);
      bars.set(chartTime, {
        startMs,
        inputIndex,
        time: chartTime,
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
        freshness:
          typeof rawBar.freshness === "string" ? rawBar.freshness : undefined,
        marketDataMode:
          typeof rawBar.marketDataMode === "string"
            ? rawBar.marketDataMode
            : undefined,
        dataUpdatedAt: rawBar.dataUpdatedAt ?? undefined,
        ageMs:
          typeof rawBar.ageMs === "number" && Number.isFinite(rawBar.ageMs)
            ? rawBar.ageMs
            : undefined,
        delayed: Boolean(rawBar.delayed),
      });
      return bars;
    },
    new Map(),
  );

  const normalizedBars = Array.from(normalizedByChartTime.values()).sort(
    (left, right) =>
      left.time - right.time || left.startMs - right.startMs || left.inputIndex - right.inputIndex,
  );
  const chartBars = normalizedBars.map(
    ({ startMs: _startMs, inputIndex: _inputIndex, ...bar }) => bar,
  );
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
    "5s": 720,
    "15s": 620,
    "30s": 560,
    "1m": 720,
    "2m": 680,
    "5m": 620,
    "15m": 520,
    "30m": 460,
    "1h": 420,
    "4h": 360,
    "1d": 260,
    "1D": 260,
  })[timeframe] || 360;

const buildDefaultVisibleRange = (
  chartBars: ChartBar[],
  timeframe: string,
  defaultVisibleBarCount?: number,
): { from: number; to: number } | null => {
  if (!chartBars.length) {
    return null;
  }

  const visibleBarCount =
    typeof defaultVisibleBarCount === "number" &&
    Number.isFinite(defaultVisibleBarCount) &&
    defaultVisibleBarCount > 0
      ? Math.ceil(defaultVisibleBarCount)
      : defaultVisibleBarsForTimeframe(timeframe);
  const to = chartBars.length - 1;
  const from = Math.max(0, to - visibleBarCount + 1);
  return { from, to };
};

const normalizeMarkers = (
  markers: ChartMarker[],
  barCount: number,
): ChartMarker[] =>
  markers
    .filter((marker) => marker.barIndex >= 0 && marker.barIndex < barCount)
    .sort((left, right) => left.time - right.time);

const shallowStringArrayEqual = (
  left: string[],
  right: string[],
): boolean => {
  if (left === right) {
    return true;
  }
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
};

const areMarketBarsEquivalent = (
  left: MarketBar | undefined,
  right: MarketBar | undefined,
): boolean => {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }

  return (
    resolveEpochMs(left) === resolveEpochMs(right) &&
    resolveNumber(left.o, left.open) === resolveNumber(right.o, right.open) &&
    resolveNumber(left.h, left.high) === resolveNumber(right.h, right.high) &&
    resolveNumber(left.l, left.low) === resolveNumber(right.l, right.low) &&
    resolveNumber(left.c, left.close) === resolveNumber(right.c, right.close) &&
    (resolveNumber(left.v, left.volume) ?? 0) ===
      (resolveNumber(right.v, right.volume) ?? 0) &&
    (left.source ?? null) === (right.source ?? null)
  );
};

type BarMutationMode =
  | "full"
  | "tail-patch"
  | "append"
  | "tail-patch-append"
  | "prepend";

const detectBarMutationMode = (
  previousBars: MarketBar[],
  nextBars: MarketBar[],
): BarMutationMode => {
  if (!previousBars.length || !nextBars.length) {
    return "full";
  }

  if (previousBars.length === nextBars.length) {
    if (previousBars.length === 1) {
      return areMarketBarsEquivalent(previousBars[0], nextBars[0])
        ? "full"
        : "tail-patch";
    }

    for (let index = 0; index < previousBars.length - 1; index += 1) {
      if (!areMarketBarsEquivalent(previousBars[index], nextBars[index])) {
        return "full";
      }
    }

    return areMarketBarsEquivalent(
      previousBars[previousBars.length - 1],
      nextBars[nextBars.length - 1],
    )
      ? "full"
      : "tail-patch";
  }

  if (nextBars.length === previousBars.length + 1) {
    for (let index = 0; index < previousBars.length; index += 1) {
      if (!areMarketBarsEquivalent(previousBars[index], nextBars[index])) {
        return "full";
      }
    }
    return "append";
  }

  if (nextBars.length > previousBars.length) {
    let matchesPreviousPrefix = true;
    for (let index = 0; index < previousBars.length; index += 1) {
      if (!areMarketBarsEquivalent(previousBars[index], nextBars[index])) {
        matchesPreviousPrefix = false;
        break;
      }
    }
    if (matchesPreviousPrefix) {
      return "append";
    }

    let matchesPatchableTailPrefix = true;
    for (let index = 0; index < previousBars.length - 1; index += 1) {
      if (!areMarketBarsEquivalent(previousBars[index], nextBars[index])) {
        matchesPatchableTailPrefix = false;
        break;
      }
    }
    const previousTailTime = resolveEpochMs(previousBars[previousBars.length - 1]);
    const nextTailTime = resolveEpochMs(nextBars[previousBars.length - 1]);
    if (
      matchesPatchableTailPrefix &&
      previousTailTime != null &&
      previousTailTime === nextTailTime &&
      !areMarketBarsEquivalent(
        previousBars[previousBars.length - 1],
        nextBars[previousBars.length - 1],
      )
    ) {
      return "tail-patch-append";
    }

    const offset = nextBars.length - previousBars.length;
    for (let index = 0; index < previousBars.length; index += 1) {
      if (!areMarketBarsEquivalent(previousBars[index], nextBars[index + offset])) {
        return "full";
      }
    }
    return "prepend";
  }

  return "full";
};

const canReusePreviousChartBars = (
  previousState: ResearchChartModelBuildState,
): boolean =>
  Array.isArray(previousState.chartBars) &&
  Array.isArray(previousState.chartBarRanges) &&
  previousState.chartBars.length === previousState.input.bars.length &&
  previousState.chartBarRanges.length === previousState.chartBars.length;

const rebuildChartBarsIncrementally = ({
  previousState,
  nextBars,
  timeframe,
  mutationMode,
}: {
  previousState: ResearchChartModelBuildState;
  nextBars: MarketBar[];
  timeframe: string;
  mutationMode: BarMutationMode;
}): { chartBars: ChartBar[]; chartBarRanges: ChartBarRange[] } | null => {
  if (!canReusePreviousChartBars(previousState)) {
    return null;
  }

  if (mutationMode === "tail-patch") {
    const builtTail = buildChartBars(nextBars.slice(-1), timeframe);
    const tailBar = builtTail.chartBars[0];
    const previousTail = previousState.chartBars[previousState.chartBars.length - 1];
    if (!tailBar || tailBar.time !== previousTail?.time) {
      return null;
    }

    return {
      chartBars: [...previousState.chartBars.slice(0, -1), tailBar],
      chartBarRanges: previousState.chartBarRanges.slice(),
    };
  }

  if (mutationMode !== "append" && mutationMode !== "tail-patch-append") {
    return null;
  }

  const replaceFromRawIndex =
    mutationMode === "tail-patch-append"
      ? previousState.input.bars.length - 1
      : previousState.input.bars.length;
  const appended = buildChartBars(nextBars.slice(replaceFromRawIndex), timeframe);
  if (!appended.chartBars.length) {
    return null;
  }

  const prefixBars = previousState.chartBars.slice(0, replaceFromRawIndex);
  const prefixRanges = previousState.chartBarRanges.slice(0, replaceFromRawIndex);
  const previousPrefixTail = prefixBars[prefixBars.length - 1];
  const firstAppended = appended.chartBars[0];
  if (previousPrefixTail && firstAppended.time <= previousPrefixTail.time) {
    return null;
  }

  for (let index = 1; index < appended.chartBars.length; index += 1) {
    if (appended.chartBars[index].time <= appended.chartBars[index - 1].time) {
      return null;
    }
  }

  if (prefixRanges.length) {
    const firstAppendedRange = appended.chartBarRanges[0];
    prefixRanges[prefixRanges.length - 1] = {
      ...prefixRanges[prefixRanges.length - 1],
      endMs: firstAppendedRange.startMs,
    };
  }

  return {
    chartBars: [...prefixBars, ...appended.chartBars],
    chartBarRanges: [...prefixRanges, ...appended.chartBarRanges],
  };
};

const buildChartModelFromPluginOutputs = ({
  chartBars,
  chartBarRanges,
  pluginOutputs,
  indicatorMarkers,
  timeframe,
  defaultVisibleBarCount,
}: {
  chartBars: ChartBar[];
  chartBarRanges: ChartBarRange[];
  pluginOutputs: IndicatorPluginOutput[];
  indicatorMarkers: ChartMarker[];
  timeframe: string;
  defaultVisibleBarCount?: number;
}): ChartModel => {
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
    defaultVisibleLogicalRange: buildDefaultVisibleRange(
      styledChartBars,
      timeframe,
      defaultVisibleBarCount,
    ),
  };
};

export const buildResearchChartModelIncremental = (
  input: BuildChartModelInput,
  previousState?: ResearchChartModelBuildState | null,
): {
  model: ChartModel;
  state: ResearchChartModelBuildState;
} => {
  const {
    bars,
    dailyBars,
    timeframe,
    defaultVisibleBarCount,
    selectedIndicators = [],
    indicatorSettings = {},
    indicatorMarkers = [],
    indicatorRegistry = defaultIndicatorRegistry,
  } = input;
  const barMutationMode =
    previousState && previousState.input.timeframe === timeframe
      ? detectBarMutationMode(previousState.input.bars, bars)
      : "full";
  const incrementalChartBars =
    previousState && previousState.input.timeframe === timeframe
      ? rebuildChartBarsIncrementally({
          previousState,
          nextBars: bars,
          timeframe,
          mutationMode: barMutationMode,
        })
      : null;
  const { chartBars, chartBarRanges } =
    incrementalChartBars ?? buildChartBars(bars, timeframe);
  const plugins = resolveIndicatorPlugins(
    selectedIndicators,
    indicatorRegistry,
  );
  const canReuseDeferredPluginOutputs = Boolean(
    previousState &&
      previousState.input.timeframe === timeframe &&
      previousState.input.defaultVisibleBarCount === defaultVisibleBarCount &&
      previousState.input.dailyBars === dailyBars &&
      previousState.input.indicatorSettings === indicatorSettings &&
      previousState.input.indicatorMarkers === indicatorMarkers &&
      previousState.input.indicatorRegistry === indicatorRegistry &&
      shallowStringArrayEqual(
        previousState.input.selectedIndicators,
        selectedIndicators,
      ) &&
      barMutationMode === "tail-patch" &&
      previousState.plugins.length === plugins.length &&
      previousState.plugins.every((plugin, index) => plugin.id === plugins[index]?.id),
  );

  const pluginOutputs = plugins.map((plugin, index) => {
    if (
      canReuseDeferredPluginOutputs &&
      plugin.liveUpdateMode === "defer-on-tail-patch"
    ) {
      return previousState?.pluginOutputs[index] || {};
    }

    return plugin.compute({
      chartBars,
      rawBars: bars,
      dailyBars,
      settings: indicatorSettings[plugin.id],
      timeframe,
      selectedIndicators,
    });
  });

  const model = buildChartModelFromPluginOutputs({
    chartBars,
    chartBarRanges,
    pluginOutputs,
    indicatorMarkers,
    timeframe,
    defaultVisibleBarCount,
  });

  return {
    model,
    state: {
      input: {
        bars,
        dailyBars,
        timeframe,
        defaultVisibleBarCount,
        selectedIndicators,
        indicatorSettings,
        indicatorMarkers,
        indicatorRegistry,
      },
      plugins,
      chartBars,
      chartBarRanges,
      pluginOutputs,
      model,
    },
  };
};

export const buildResearchChartModel = (
  input: BuildChartModelInput,
): ChartModel => buildResearchChartModelIncremental(input).model;
