import type {
  BacktestChartMarker,
  BacktestComparisonBadge,
  BacktestEquitySeriesPoint,
  BacktestIndicatorMarkerPayload,
  BacktestRunChart,
  BacktestTrade,
  BacktestTradeMarkerGroup,
  BacktestTradeOverlay,
  BacktestTradeThresholdSegment,
} from "@workspace/api-client-react";
import { buildResearchChartModel } from "../charting/model";
import type {
  ChartMarker,
  ChartModel,
  IndicatorEvent,
  IndicatorRegistry,
  IndicatorWindow,
  IndicatorZone,
  MarketBar,
  TradeMarkerGroup,
  TradeOverlay,
} from "../charting/types";

function buildTimeToTradeIdsMap(
  entries: Array<{ time: string; tradeSelectionIds: string[] }>,
): Map<string, string[]> {
  return new Map(entries.map((entry) => [entry.time, entry.tradeSelectionIds]));
}

function toChartMarker(marker: BacktestChartMarker): ChartMarker {
  return {
    ...marker,
    text: marker.text ?? undefined,
    size: marker.size ?? undefined,
  };
}

function toTradeThresholdSegment(segment: BacktestTradeThresholdSegment) {
  return {
    ...segment,
    hit: segment.hit ?? undefined,
    label: segment.label ?? undefined,
  };
}

function toTradeOverlay(overlay: BacktestTradeOverlay): TradeOverlay {
  return {
    ...overlay,
    exitTs: overlay.exitTs ?? undefined,
    pnl: overlay.pnl ?? undefined,
    pnlPercent: overlay.pnlPercent ?? undefined,
    er: overlay.er ?? undefined,
    profitable: overlay.profitable ?? undefined,
    pricingMode: overlay.pricingMode ?? undefined,
    entryPrice: overlay.entryPrice ?? undefined,
    exitPrice: overlay.exitPrice ?? undefined,
    oe: overlay.oe ?? undefined,
    ep: overlay.ep ?? undefined,
    exitFill: overlay.exitFill ?? undefined,
    entrySpotPrice: overlay.entrySpotPrice ?? undefined,
    exitSpotPrice: overlay.exitSpotPrice ?? undefined,
    entryBasePrice: overlay.entryBasePrice ?? undefined,
    exitBasePrice: overlay.exitBasePrice ?? undefined,
    stopLossPrice: overlay.stopLossPrice ?? undefined,
    takeProfitPrice: overlay.takeProfitPrice ?? undefined,
    trailActivationPrice: overlay.trailActivationPrice ?? undefined,
    lastTrailStopPrice: overlay.lastTrailStopPrice ?? undefined,
    exitTriggerPrice: overlay.exitTriggerPrice ?? undefined,
    thresholdPath: overlay.thresholdPath
      ? {
          segments: overlay.thresholdPath.segments.map(toTradeThresholdSegment),
        }
      : undefined,
  };
}

function toTradeMarkerGroup(group: BacktestTradeMarkerGroup): TradeMarkerGroup {
  return {
    ...group,
    profitable: group.profitable ?? undefined,
    label: group.label ?? undefined,
  };
}

function toIndicatorEvent(
  event: BacktestRunChart["indicatorEvents"][number],
): IndicatorEvent {
  return {
    ...event,
    time: event.time ?? undefined,
    barIndex: event.barIndex ?? undefined,
    direction: event.direction ?? undefined,
    label: event.label ?? undefined,
    conviction: event.conviction ?? undefined,
  };
}

function toIndicatorZone(
  zone: BacktestRunChart["indicatorZones"][number],
): IndicatorZone {
  return {
    ...zone,
    direction: zone.direction ?? undefined,
    startBarIndex: zone.startBarIndex ?? undefined,
    endBarIndex: zone.endBarIndex ?? undefined,
    label: zone.label ?? undefined,
  };
}

function toIndicatorWindow(
  window: BacktestRunChart["indicatorWindows"][number],
): IndicatorWindow {
  return {
    ...window,
    startBarIndex: window.startBarIndex ?? undefined,
    endBarIndex: window.endBarIndex ?? undefined,
    tone: window.tone ?? undefined,
    conviction: window.conviction ?? undefined,
  };
}

function buildIndicatorMarkerPayload(
  payload: BacktestIndicatorMarkerPayload,
): ChartModel["indicatorMarkerPayload"] {
  return {
    overviewMarkers: payload.overviewMarkers.map(toChartMarker),
    markersByTradeId: Object.fromEntries(
      Object.entries(payload.markersByTradeId).map(([tradeId, markers]) => [
        tradeId,
        markers.map(toChartMarker),
      ]),
    ),
    timeToTradeIds: buildTimeToTradeIdsMap(payload.timeToTradeIds),
  };
}

function resolveBarIndex(
  timestamp: string | null | undefined,
  chartBarRanges: ChartModel["chartBarRanges"],
): number | null {
  if (!timestamp) {
    return null;
  }

  const timestampMs = Date.parse(timestamp);
  if (Number.isNaN(timestampMs)) {
    return null;
  }

  for (let index = 0; index < chartBarRanges.length; index += 1) {
    const range = chartBarRanges[index];
    if (timestampMs >= range.startMs && timestampMs < range.endMs) {
      return index;
    }
  }

  const lastRange = chartBarRanges[chartBarRanges.length - 1];
  if (lastRange && timestampMs === lastRange.endMs) {
    return chartBarRanges.length - 1;
  }

  return null;
}

function buildFocusedTradeVisibleRange(
  entryBarIndex: number | null,
  exitBarIndex: number | null,
  barCount: number,
): { from: number; to: number } | null {
  if (barCount <= 0) {
    return null;
  }

  const anchorFrom = entryBarIndex ?? exitBarIndex;
  const anchorTo = exitBarIndex ?? entryBarIndex;
  if (anchorFrom == null || anchorTo == null) {
    return null;
  }

  return {
    from: Math.max(0, Math.min(anchorFrom, anchorTo) - 20),
    to: Math.min(barCount - 1, Math.max(anchorFrom, anchorTo) + 20),
  };
}

function buildTradeMarkerGroups(
  chartBars: ChartModel["chartBars"],
  tradeOverlays: TradeOverlay[],
): ChartModel["tradeMarkerGroups"] {
  const entryGroups = new Map<
    string,
    {
      id: string;
      kind: "entry";
      time: number;
      dir: "long" | "short";
      profitable?: boolean;
      barIndex: number | null;
      tradeSelectionIds: string[];
      label?: string;
    }
  >();
  const exitGroups = new Map<
    string,
    {
      id: string;
      kind: "exit";
      time: number;
      dir: "long" | "short";
      profitable?: boolean;
      barIndex: number | null;
      tradeSelectionIds: string[];
      label?: string;
    }
  >();
  const timeToTradeIds = new Map<string, Set<string>>();

  tradeOverlays.forEach((overlay) => {
    if (overlay.entryBarIndex != null) {
      const entryTime = chartBars[overlay.entryBarIndex]?.time;
      if (typeof entryTime === "number") {
        const key = `${overlay.entryBarIndex}:${overlay.dir}`;
        const existing = entryGroups.get(key) ?? {
          id: `entry-${key}`,
          kind: "entry" as const,
          time: entryTime,
          dir: overlay.dir,
          barIndex: overlay.entryBarIndex,
          tradeSelectionIds: [],
        };
        existing.tradeSelectionIds.push(overlay.tradeSelectionId);
        entryGroups.set(key, existing);

        const idsAtTime = timeToTradeIds.get(String(entryTime)) ?? new Set<string>();
        idsAtTime.add(overlay.tradeSelectionId);
        timeToTradeIds.set(String(entryTime), idsAtTime);
      }
    }

    if (overlay.exitBarIndex != null) {
      const exitTime = chartBars[overlay.exitBarIndex]?.time;
      if (typeof exitTime === "number") {
        const key = `${overlay.exitBarIndex}:${overlay.dir}:${overlay.profitable ? "win" : "loss"}`;
        const existing = exitGroups.get(key) ?? {
          id: `exit-${key}`,
          kind: "exit" as const,
          time: exitTime,
          dir: overlay.dir,
          profitable: overlay.profitable ?? undefined,
          barIndex: overlay.exitBarIndex,
          tradeSelectionIds: [],
        };
        existing.tradeSelectionIds.push(overlay.tradeSelectionId);
        exitGroups.set(key, existing);

        const idsAtTime = timeToTradeIds.get(String(exitTime)) ?? new Set<string>();
        idsAtTime.add(overlay.tradeSelectionId);
        timeToTradeIds.set(String(exitTime), idsAtTime);
      }
    }
  });

  const normalizeGroup = <
    T extends {
      tradeSelectionIds: string[];
      label?: string;
      time: number;
    },
  >(
    group: T,
  ): T => ({
    ...group,
    label:
      group.tradeSelectionIds.length > 1
        ? String(group.tradeSelectionIds.length)
        : undefined,
  });

  const normalizedEntryGroups = [...entryGroups.values()]
    .map(normalizeGroup)
    .sort((left, right) => left.time - right.time);
  const normalizedExitGroups = [...exitGroups.values()]
    .map(normalizeGroup)
    .sort((left, right) => left.time - right.time);

  return {
    entryGroups: normalizedEntryGroups,
    exitGroups: normalizedExitGroups,
    interactionGroups: [...normalizedEntryGroups, ...normalizedExitGroups].sort(
      (left, right) => left.time - right.time,
    ),
    timeToTradeIds: new Map(
      [...timeToTradeIds.entries()].map(([time, ids]) => [time, [...ids]]),
    ),
  };
}

export function buildBacktestChartModel(
  payload: BacktestRunChart,
  options: {
    selectedIndicators?: string[];
    indicatorRegistry?: IndicatorRegistry;
  } = {},
): ChartModel {
  const indicatorModel = buildResearchChartModel({
    bars: payload.chartBars,
    timeframe: payload.timeframe,
    selectedIndicators: options.selectedIndicators ?? [],
    indicatorRegistry: options.indicatorRegistry,
  });
  const payloadIndicatorMarkerPayload = buildIndicatorMarkerPayload(
    payload.indicatorMarkerPayload,
  );

  return {
    chartBars: indicatorModel.chartBars,
    chartBarRanges: payload.chartBarRanges,
    tradeOverlays: payload.tradeOverlays.map(toTradeOverlay),
    tradeMarkerGroups: {
      entryGroups:
        payload.tradeMarkerGroups.entryGroups.map(toTradeMarkerGroup),
      exitGroups: payload.tradeMarkerGroups.exitGroups.map(toTradeMarkerGroup),
      interactionGroups:
        payload.tradeMarkerGroups.interactionGroups.map(toTradeMarkerGroup),
      timeToTradeIds: buildTimeToTradeIdsMap(
        payload.tradeMarkerGroups.timeToTradeIds,
      ),
    },
    studySpecs: indicatorModel.studySpecs,
    studyVisibility: indicatorModel.studyVisibility,
    studyLowerPaneCount: indicatorModel.studyLowerPaneCount,
    indicatorEvents: [
      ...payload.indicatorEvents.map(toIndicatorEvent),
      ...indicatorModel.indicatorEvents,
    ],
    indicatorZones: [
      ...payload.indicatorZones.map(toIndicatorZone),
      ...indicatorModel.indicatorZones,
    ],
    indicatorWindows: [
      ...payload.indicatorWindows.map(toIndicatorWindow),
      ...indicatorModel.indicatorWindows,
    ],
    indicatorMarkerPayload: {
      overviewMarkers: [
        ...payloadIndicatorMarkerPayload.overviewMarkers,
        ...indicatorModel.indicatorMarkerPayload.overviewMarkers,
      ],
      markersByTradeId: payloadIndicatorMarkerPayload.markersByTradeId,
      timeToTradeIds: payloadIndicatorMarkerPayload.timeToTradeIds,
    },
    activeTradeSelectionId: payload.activeTradeSelectionId,
    selectionFocus: payload.selectionFocus,
    defaultVisibleLogicalRange: payload.defaultVisibleLogicalRange,
  };
}

export function buildHydratedBacktestSpotChartModel(
  input: {
    bars: MarketBar[];
    timeframe: string;
    runChart: BacktestRunChart | null;
    selectedIndicators?: string[];
    indicatorRegistry?: IndicatorRegistry;
  },
): ChartModel {
  const baseModel = buildResearchChartModel({
    bars: input.bars,
    timeframe: input.timeframe,
    selectedIndicators: input.selectedIndicators ?? [],
    indicatorRegistry: input.indicatorRegistry,
  });

  if (!input.runChart) {
    return baseModel;
  }

  const tradeOverlays = input.runChart.tradeOverlays
    .map(toTradeOverlay)
    .map((overlay) => ({
      ...overlay,
      entryBarIndex: resolveBarIndex(overlay.entryTs, baseModel.chartBarRanges),
      exitBarIndex: resolveBarIndex(
        overlay.exitTs ?? undefined,
        baseModel.chartBarRanges,
      ),
    }))
    .filter(
      (overlay) =>
        overlay.entryBarIndex != null || overlay.exitBarIndex != null,
    );
  const activeTradeSelectionId = tradeOverlays.some(
    (trade) => trade.tradeSelectionId === input.runChart?.activeTradeSelectionId,
  )
    ? (input.runChart.activeTradeSelectionId ?? null)
    : null;
  const activeTrade =
    tradeOverlays.find(
      (trade) => trade.tradeSelectionId === activeTradeSelectionId,
    ) ?? null;
  const focusedVisibleRange = activeTrade
    ? buildFocusedTradeVisibleRange(
        activeTrade.entryBarIndex,
        activeTrade.exitBarIndex,
        baseModel.chartBars.length,
      )
    : null;
  const selectionFocus =
    activeTradeSelectionId && focusedVisibleRange
      ? {
          token:
            Math.abs(
              Date.parse(activeTrade?.entryTs ?? "") +
                (focusedVisibleRange.from ?? 0) +
                (focusedVisibleRange.to ?? 0),
            ) || 1,
          tradeSelectionId: activeTradeSelectionId,
          visibleLogicalRange: focusedVisibleRange,
        }
      : null;

  return {
    ...baseModel,
    tradeOverlays,
    tradeMarkerGroups: buildTradeMarkerGroups(baseModel.chartBars, tradeOverlays),
    activeTradeSelectionId,
    selectionFocus,
    defaultVisibleLogicalRange:
      focusedVisibleRange ?? baseModel.defaultVisibleLogicalRange,
  };
}

export function buildRunTradeSelectionId(
  runId: string,
  trade: Pick<BacktestTrade, "symbol" | "entryAt"> &
    Partial<Pick<BacktestTrade, "tradeSelectionId">>,
): string {
  if (trade.tradeSelectionId) {
    return trade.tradeSelectionId;
  }

  return `${runId}:${trade.symbol.toUpperCase()}:${trade.entryAt}`;
}

export function mergeStudyPreviewSeries(
  latestSeries: BacktestEquitySeriesPoint[],
  bestSeries: BacktestEquitySeriesPoint[],
): Array<{
  occurredAt: string;
  latestEquity?: number;
  bestEquity?: number;
}> {
  const rows = new Map<
    string,
    {
      occurredAt: string;
      latestEquity?: number;
      bestEquity?: number;
    }
  >();

  latestSeries.forEach((point) => {
    const row = rows.get(point.occurredAt) ?? { occurredAt: point.occurredAt };
    row.latestEquity = point.equity;
    rows.set(point.occurredAt, row);
  });
  bestSeries.forEach((point) => {
    const row = rows.get(point.occurredAt) ?? { occurredAt: point.occurredAt };
    row.bestEquity = point.equity;
    rows.set(point.occurredAt, row);
  });

  return [...rows.values()].sort(
    (left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt),
  );
}

export function formatComparisonBadgeValue(
  badge: BacktestComparisonBadge,
  value: number | null,
): string {
  if (value == null || !Number.isFinite(value)) {
    return "—";
  }

  if (badge.format === "currency") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(value);
  }

  if (badge.format === "percent") {
    const prefix = value > 0 ? "+" : "";
    return `${prefix}${value.toFixed(1)}%`;
  }

  if (badge.format === "integer") {
    return new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 0,
    }).format(value);
  }

  return value.toFixed(2);
}
