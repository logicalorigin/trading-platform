import { useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import {
  AreaSeries,
  BarSeries,
  BaselineSeries,
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  PriceScaleMode,
} from "lightweight-charts";
import type { ChartModel, IndicatorWindow, IndicatorZone, StudySpec } from "./types";

type ResearchChartTheme = {
  bg2: string;
  bg3: string;
  bg4: string;
  border: string;
  text: string;
  textMuted: string;
  green: string;
  red: string;
  amber: string;
  accent?: string;
  mono: string;
};

type HoverBar = {
  index: number;
  time: number;
  ts: string;
  date: string;
  volume: number;
  accumulatedVolume?: number | null;
  vwap?: number | null;
  sessionVwap?: number | null;
  averageTradeSize?: number | null;
  source?: string | null;
  previousClose: number | null;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type BaseSeriesType = "candles" | "bars" | "line" | "area" | "baseline";
export type ScaleMode = "linear" | "log" | "percentage" | "indexed";

type DrawMode = "horizontal" | "vertical" | "box";

type ResearchDrawing = {
  type?: DrawMode;
  price?: number;
  time?: number;
  fromTime?: number;
  toTime?: number;
  top?: number;
  bottom?: number;
};

type OverlayShape = {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  fill: string;
  border: string;
  label?: string;
};

export type ChartSurfaceControls = {
  baseSeriesType: BaseSeriesType;
  setBaseSeriesType: (next: BaseSeriesType) => void;
  showVolume: boolean;
  setShowVolume: (next: boolean | ((value: boolean) => boolean)) => void;
  scaleMode: ScaleMode;
  setScaleMode: (next: ScaleMode | ((value: ScaleMode) => ScaleMode)) => void;
  crosshairMode: "magnet" | "free";
  setCrosshairMode: (next: "magnet" | "free" | ((value: "magnet" | "free") => "magnet" | "free")) => void;
  showPriceLine: boolean;
  setShowPriceLine: (next: boolean | ((value: boolean) => boolean)) => void;
  showGrid: boolean;
  setShowGrid: (next: boolean | ((value: boolean) => boolean)) => void;
  showTimeScale: boolean;
  setShowTimeScale: (next: boolean | ((value: boolean) => boolean)) => void;
  autoScale: boolean;
  setAutoScale: (next: boolean | ((value: boolean) => boolean)) => void;
  invertScale: boolean;
  setInvertScale: (next: boolean | ((value: boolean) => boolean)) => void;
  cycleScaleMode: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  panLeft: () => void;
  panRight: () => void;
  reset: () => void;
  fit: () => void;
  realtime: () => void;
};

export type OverlayContent =
  | ReactNode
  | ((controls: ChartSurfaceControls) => ReactNode);

type ResearchChartSurfaceProps = {
  model: ChartModel;
  theme: ResearchChartTheme;
  themeKey: string;
  dataTestId?: string;
  compact?: boolean;
  showToolbar?: boolean;
  showLegend?: boolean;
  hideTimeScale?: boolean;
  showRightPriceScale?: boolean;
  enableInteractions?: boolean;
  showAttributionLogo?: boolean;
  hideCrosshair?: boolean;
  topOverlay?: OverlayContent;
  bottomOverlay?: OverlayContent;
  topOverlayHeight?: number;
  bottomOverlayHeight?: number;
  defaultBaseSeriesType?: BaseSeriesType;
  defaultShowVolume?: boolean;
  defaultShowPriceLine?: boolean;
  defaultScaleMode?: ScaleMode;
  drawings?: ResearchDrawing[];
  referenceLines?: Array<{
    price: number;
    color?: string;
    title?: string;
    lineWidth?: number;
    axisLabelVisible?: boolean;
  }>;
  drawMode?: DrawMode | null;
  onAddDrawing?: (drawing: ResearchDrawing) => void;
  onAddHorizontalLevel?: (price: number) => void;
};

type StudyRegistryEntry = {
  paneIndex: number;
  seriesType: StudySpec["seriesType"];
  series: any;
};

const withAlpha = (color: string, alpha: string): string => (
  /^#[0-9a-fA-F]{6}$/.test(color)
    ? `${color}${alpha}`
    : color
);

const buildChartOptions = (
  theme: ResearchChartTheme,
  {
    compact = false,
    hideTimeScale = false,
    showRightPriceScale = true,
    enableInteractions = true,
    showAttributionLogo = false,
  }: {
    compact?: boolean;
    hideTimeScale?: boolean;
    showRightPriceScale?: boolean;
    enableInteractions?: boolean;
    showAttributionLogo?: boolean;
  },
) => ({
  autoSize: true,
  layout: {
    background: { type: ColorType.Solid, color: theme.bg2 },
    textColor: theme.textMuted,
    fontFamily: theme.mono,
    attributionLogo: showAttributionLogo,
  },
  grid: {
    vertLines: { color: withAlpha(theme.border, "30"), visible: true },
    horzLines: { color: withAlpha(theme.border, "50"), visible: true },
  },
  crosshair: {
    mode: CrosshairMode.MagnetOHLC,
    vertLine: {
      color: withAlpha(theme.textMuted, "90"),
      width: 1,
      style: LineStyle.Dashed,
      visible: true,
      labelVisible: true,
    },
    horzLine: {
      color: withAlpha(theme.textMuted, "90"),
      width: 1,
      style: LineStyle.Dashed,
      visible: true,
      labelVisible: true,
    },
  },
  rightPriceScale: {
    borderColor: theme.border,
    textColor: theme.textMuted,
    visible: showRightPriceScale,
    borderVisible: showRightPriceScale,
    ticksVisible: showRightPriceScale && !compact,
  },
  leftPriceScale: {
    visible: false,
    borderColor: theme.border,
  },
  timeScale: {
    borderColor: theme.border,
    visible: !hideTimeScale,
    timeVisible: !hideTimeScale,
    secondsVisible: false,
    ticksVisible: !compact && !hideTimeScale,
    minBarSpacing: compact ? 1 : 6,
  },
  handleScroll: enableInteractions,
  handleScale: enableInteractions,
});

const SERIES_TYPE_MAP = {
  line: LineSeries,
  histogram: HistogramSeries,
} satisfies Record<StudySpec["seriesType"], typeof LineSeries | typeof HistogramSeries>;

const formatCompactNumber = (value: number): string => {
  if (!Number.isFinite(value)) {
    return "0";
  }

  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: value >= 1_000_000 ? 2 : 1,
  }).format(value);
};

const formatLegendTimestamp = (value: string): string => {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/New_York",
  }).format(new Date(parsed));
};

const formatLegendNumber = (value: number | null | undefined, digits = 2): string => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "—";
  }

  return value.toFixed(digits);
};

const countValueDecimals = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const text = value.toString().toLowerCase();
  if (text.includes("e-")) {
    const [, exponentText = "0"] = text.split("e-");
    return Number.parseInt(exponentText, 10) || 0;
  }

  const [, decimals = ""] = text.split(".");
  return decimals.replace(/0+$/, "").length;
};

const resolvePricePrecision = (bars: ChartModel["chartBars"]): number => {
  const maxDecimals = bars.reduce((result, bar) => Math.max(
    result,
    countValueDecimals(bar.o),
    countValueDecimals(bar.h),
    countValueDecimals(bar.l),
    countValueDecimals(bar.c),
    countValueDecimals(bar.vwap ?? Number.NaN),
    countValueDecimals(bar.sessionVwap ?? Number.NaN),
  ), 0);

  return Math.min(4, Math.max(2, maxDecimals));
};

const numbersClose = (left: number, right: number, epsilon = 0.5): boolean => (
  Math.abs(left - right) <= epsilon
);

const overlayShapesEqual = (left: OverlayShape[], right: OverlayShape[]): boolean => {
  if (left === right) {
    return true;
  }

  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftShape = left[index];
    const rightShape = right[index];

    if (
      leftShape.id !== rightShape.id ||
      leftShape.fill !== rightShape.fill ||
      leftShape.border !== rightShape.border ||
      leftShape.label !== rightShape.label ||
      !numbersClose(leftShape.left, rightShape.left) ||
      !numbersClose(leftShape.top, rightShape.top) ||
      !numbersClose(leftShape.width, rightShape.width) ||
      !numbersClose(leftShape.height, rightShape.height)
    ) {
      return false;
    }
  }

  return true;
};

const parseIsoTimeSeconds = (value: string): number | null => {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return null;
  }

  return Math.floor(parsed / 1000);
};

const resolveBarSpacing = (chart: any, model: ChartModel): number => {
  const sample = model.chartBars.slice(-40);
  const diffs: number[] = [];

  for (let index = 1; index < sample.length; index += 1) {
    const left = chart.timeScale().timeToCoordinate(sample[index - 1]?.time);
    const right = chart.timeScale().timeToCoordinate(sample[index]?.time);
    if (typeof left === "number" && typeof right === "number") {
      diffs.push(Math.abs(right - left));
    }
  }

  if (!diffs.length) {
    return 8;
  }

  return Math.max(2, diffs.reduce((sum, value) => sum + value, 0) / diffs.length);
};

const buildWindowOverlays = (
  chart: any,
  model: ChartModel,
  theme: ResearchChartTheme,
  viewportHeight: number,
): OverlayShape[] => {
  const barSpacing = resolveBarSpacing(chart, model);

  return model.indicatorWindows.reduce<OverlayShape[]>((result, indicatorWindow: IndicatorWindow) => {
    const startTime = indicatorWindow.startBarIndex != null
      ? model.chartBars[indicatorWindow.startBarIndex]?.time ?? null
      : parseIsoTimeSeconds(indicatorWindow.startTs);
    const endTime = indicatorWindow.endBarIndex != null
      ? model.chartBars[indicatorWindow.endBarIndex]?.time ?? null
      : parseIsoTimeSeconds(indicatorWindow.endTs);
    const left = startTime != null ? chart.timeScale().timeToCoordinate(startTime) : null;
    const rightBase = endTime != null ? chart.timeScale().timeToCoordinate(endTime) : null;

    if (typeof left !== "number") {
      return result;
    }

    const right = typeof rightBase === "number" ? rightBase + barSpacing : left + barSpacing;
    const tone = indicatorWindow.tone || (indicatorWindow.direction === "short" ? "bearish" : "bullish");
    const fill = tone === "bearish"
      ? withAlpha(theme.red, "12")
      : tone === "neutral"
        ? withAlpha(theme.textMuted, "10")
        : withAlpha(theme.green, "12");
    const border = tone === "bearish"
      ? withAlpha(theme.red, "45")
      : tone === "neutral"
        ? withAlpha(theme.textMuted, "38")
        : withAlpha(theme.green, "45");

    result.push({
      id: indicatorWindow.id,
      left: Math.min(left, right),
      top: 0,
      width: Math.max(2, Math.abs(right - left)),
      height: Math.max(0, viewportHeight),
      fill,
      border,
      label: indicatorWindow.meta?.label as string | undefined,
    });
    return result;
  }, []);
};

const buildZoneOverlays = (
  chart: any,
  series: any,
  model: ChartModel,
  theme: ResearchChartTheme,
): OverlayShape[] => {
  const barSpacing = resolveBarSpacing(chart, model);

  return model.indicatorZones.reduce<OverlayShape[]>((result, zone: IndicatorZone) => {
    const startTime = zone.startBarIndex != null
      ? model.chartBars[zone.startBarIndex]?.time ?? null
      : parseIsoTimeSeconds(zone.startTs);
    const endTime = zone.endBarIndex != null
      ? model.chartBars[zone.endBarIndex]?.time ?? null
      : parseIsoTimeSeconds(zone.endTs);
    const left = startTime != null ? chart.timeScale().timeToCoordinate(startTime) : null;
    const rightBase = endTime != null ? chart.timeScale().timeToCoordinate(endTime) : null;
    const top = series.priceToCoordinate?.(zone.top);
    const bottom = series.priceToCoordinate?.(zone.bottom);

    if (
      typeof left !== "number" ||
      typeof top !== "number" ||
      typeof bottom !== "number"
    ) {
      return result;
    }

    const right = typeof rightBase === "number" ? rightBase + barSpacing : left + barSpacing;
    const fill = zone.direction === "short"
      ? withAlpha(theme.red, "1c")
      : withAlpha(theme.green, "1c");
    const border = zone.direction === "short"
      ? withAlpha(theme.red, "70")
      : withAlpha(theme.green, "70");

    result.push({
      id: zone.id,
      left: Math.min(left, right),
      top: Math.min(top, bottom),
      width: Math.max(2, Math.abs(right - left)),
      height: Math.max(2, Math.abs(bottom - top)),
      fill,
      border,
      label: zone.label || zone.zoneType,
    });
    return result;
  }, []);
};

const buildVerticalDrawingOverlays = (
  chart: any,
  drawings: ResearchDrawing[],
  theme: ResearchChartTheme,
): OverlayShape[] => (
  drawings.reduce<OverlayShape[]>((result, drawing, index) => {
    if (drawing.type !== "vertical" || typeof drawing.time !== "number") {
      return result;
    }

    const x = chart.timeScale().timeToCoordinate(drawing.time);
    if (typeof x !== "number") {
      return result;
    }

    result.push({
      id: `vertical-${index}-${drawing.time}`,
      left: x,
      top: 0,
      width: 1,
      height: 0,
      fill: withAlpha(theme.amber, "00"),
      border: theme.amber,
      label: "V",
    });
    return result;
  }, [])
);

const buildBoxDrawingOverlays = (
  chart: any,
  series: any,
  drawings: ResearchDrawing[],
  theme: ResearchChartTheme,
): OverlayShape[] => (
  drawings.reduce<OverlayShape[]>((result, drawing, index) => {
    if (
      drawing.type !== "box" ||
      typeof drawing.fromTime !== "number" ||
      typeof drawing.toTime !== "number" ||
      typeof drawing.top !== "number" ||
      typeof drawing.bottom !== "number"
    ) {
      return result;
    }

    const leftCoordinate = chart.timeScale().timeToCoordinate(drawing.fromTime);
    const rightCoordinate = chart.timeScale().timeToCoordinate(drawing.toTime);
    const topCoordinate = series.priceToCoordinate?.(drawing.top);
    const bottomCoordinate = series.priceToCoordinate?.(drawing.bottom);

    if (
      typeof leftCoordinate !== "number" ||
      typeof rightCoordinate !== "number" ||
      typeof topCoordinate !== "number" ||
      typeof bottomCoordinate !== "number"
    ) {
      return result;
    }

    result.push({
      id: `box-${index}-${drawing.fromTime}-${drawing.toTime}`,
      left: Math.min(leftCoordinate, rightCoordinate),
      top: Math.min(topCoordinate, bottomCoordinate),
      width: Math.max(2, Math.abs(rightCoordinate - leftCoordinate)),
      height: Math.max(2, Math.abs(bottomCoordinate - topCoordinate)),
      fill: withAlpha(theme.amber, "16"),
      border: withAlpha(theme.amber, "a8"),
      label: "BOX",
    });
    return result;
  }, [])
);

const syncStudySeries = (
  chart: any,
  registry: Record<string, StudyRegistryEntry>,
  specs: StudySpec[],
): Record<string, StudyRegistryEntry> => {
  const nextRegistry = { ...registry };
  const nextKeys = new Set(specs.map((spec) => spec.key));

  specs.forEach((spec) => {
    const existing = nextRegistry[spec.key];
    const SeriesCtor = SERIES_TYPE_MAP[spec.seriesType];
    const seriesData = spec.data.map((point) => (
      point.color
        ? { time: point.time, value: point.value, color: point.color }
        : { time: point.time, value: point.value }
    ));

    if (
      !existing ||
      existing.paneIndex !== spec.paneIndex ||
      existing.seriesType !== spec.seriesType
    ) {
      if (existing) {
        chart.removeSeries(existing.series);
      }

      const series = chart.addSeries(SeriesCtor, spec.options, spec.paneIndex);
      series.setData(seriesData);

      nextRegistry[spec.key] = {
        series,
        paneIndex: spec.paneIndex,
        seriesType: spec.seriesType,
      };
      return;
    }

    existing.series.applyOptions(spec.options);
    existing.series.setData(seriesData);
  });

  Object.keys(nextRegistry).forEach((key) => {
    if (nextKeys.has(key)) {
      return;
    }

    chart.removeSeries(nextRegistry[key].series);
    delete nextRegistry[key];
  });

  return nextRegistry;
};

export const ResearchChartSurface = ({
  model,
  theme,
  themeKey,
  dataTestId,
  compact = false,
  showToolbar = true,
  showLegend = true,
  hideTimeScale = false,
  showRightPriceScale = true,
  enableInteractions = true,
  showAttributionLogo = false,
  hideCrosshair = false,
  topOverlay = null,
  bottomOverlay = null,
  topOverlayHeight = 0,
  bottomOverlayHeight = 0,
  defaultBaseSeriesType = "candles",
  defaultShowVolume = true,
  defaultShowPriceLine = true,
  defaultScaleMode = "linear",
  drawings = [],
  referenceLines = [],
  drawMode = null,
  onAddDrawing,
  onAddHorizontalLevel,
}: ResearchChartSurfaceProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<any>(null);
  const candleSeriesRef = useRef<any>(null);
  const barSeriesRef = useRef<any>(null);
  const lineSeriesRef = useRef<any>(null);
  const areaSeriesRef = useRef<any>(null);
  const baselineSeriesRef = useRef<any>(null);
  const volumeSeriesRef = useRef<any>(null);
  const markerApisRef = useRef<any[]>([]);
  const studyRegistryRef = useRef<Record<string, StudyRegistryEntry>>({});
  const visibleLogicalRangeRef = useRef<any>(null);
  const initializedRangeRef = useRef(false);
  const drawingLinesRef = useRef<Record<BaseSeriesType, any[]>>({
    candles: [],
    bars: [],
    line: [],
    area: [],
    baseline: [],
  });
  const activePriceSeriesRef = useRef<any>(null);
  const barLookupRef = useRef<Map<number, HoverBar>>(new Map());
  const interactionRef = useRef({
    drawMode,
    onAddDrawing,
    onAddHorizontalLevel,
  });
  const [hoverBar, setHoverBar] = useState<HoverBar | null>(null);
  const [chartError, setChartError] = useState<string | null>(null);
  const [baseSeriesType, setBaseSeriesType] = useState<BaseSeriesType>(defaultBaseSeriesType);
  const [showVolume, setShowVolume] = useState(defaultShowVolume);
  const [scaleMode, setScaleMode] = useState<ScaleMode>(defaultScaleMode);
  const [crosshairMode, setCrosshairMode] = useState<"magnet" | "free">("magnet");
  const [showPriceLine, setShowPriceLine] = useState(defaultShowPriceLine);
  const [showGrid, setShowGrid] = useState(true);
  const [showTimeScaleState, setShowTimeScaleState] = useState(!hideTimeScale);
  const [autoScale, setAutoScale] = useState(true);
  const [invertScale, setInvertScale] = useState(false);
  const [overlayRevision, setOverlayRevision] = useState(0);
  const [windowOverlays, setWindowOverlays] = useState<OverlayShape[]>([]);
  const [zoneOverlays, setZoneOverlays] = useState<OverlayShape[]>([]);
  const [verticalDrawingOverlays, setVerticalDrawingOverlays] = useState<OverlayShape[]>([]);
  const [boxDrawingOverlays, setBoxDrawingOverlays] = useState<OverlayShape[]>([]);
  const [pendingBoxAnchor, setPendingBoxAnchor] = useState<{ time: number; price: number } | null>(null);
  const syncOverlayState = (
    setter: Dispatch<SetStateAction<OverlayShape[]>>,
    next: OverlayShape[],
  ) => {
    setter((current) => (overlayShapesEqual(current, next) ? current : next));
  };

  useEffect(() => {
    interactionRef.current = {
      drawMode,
      onAddDrawing,
      onAddHorizontalLevel,
    };
  }, [drawMode, onAddDrawing, onAddHorizontalLevel]);

  useEffect(() => {
    if (drawMode !== "box") {
      setPendingBoxAnchor(null);
    }
  }, [drawMode]);

  useEffect(() => {
    if (hideTimeScale) {
      setShowTimeScaleState(false);
    }
  }, [hideTimeScale]);

  useEffect(() => {
    barLookupRef.current = new Map(
      model.chartBars.map((bar, index) => [
        bar.time,
        {
          index,
          time: bar.time,
          ts: bar.ts,
          date: bar.date,
          volume: bar.v,
          accumulatedVolume: bar.accumulatedVolume ?? null,
          vwap: bar.vwap ?? null,
          sessionVwap: bar.sessionVwap ?? null,
          averageTradeSize: bar.averageTradeSize ?? null,
          source: bar.source ?? null,
          previousClose: index > 0 ? model.chartBars[index - 1]?.c ?? null : null,
          open: bar.o,
          high: bar.h,
          low: bar.l,
          close: bar.c,
        },
      ]),
    );
  }, [model.chartBars]);

  useEffect(() => {
    activePriceSeriesRef.current = (
      {
        candles: candleSeriesRef.current,
        bars: barSeriesRef.current,
        line: lineSeriesRef.current,
        area: areaSeriesRef.current,
        baseline: baselineSeriesRef.current,
      } satisfies Record<BaseSeriesType, any>
    )[baseSeriesType] || candleSeriesRef.current;
  }, [baseSeriesType]);

  useLayoutEffect(() => {
    if (!containerRef.current || !model.chartBars.length) {
      return undefined;
    }

    let chart: any = null;
    let handleVisibleRangeChange: ((range: any) => void) | null = null;
    let handleCrosshairMove: ((param: any) => void) | null = null;
    let handleClick: ((param: any) => void) | null = null;

    try {
      setChartError(null);
      chart = createChart(
        containerRef.current,
        buildChartOptions(theme, {
          compact,
          hideTimeScale,
          showRightPriceScale,
          enableInteractions,
          showAttributionLogo,
        }) as any,
      );
      chart.applyOptions({
        crosshair: {
          mode: hideCrosshair ? CrosshairMode.Hidden : CrosshairMode.MagnetOHLC,
          vertLine: {
            visible: !hideCrosshair,
            labelVisible: !hideCrosshair,
          },
          horzLine: {
            visible: !hideCrosshair,
            labelVisible: !hideCrosshair,
          },
        },
      });

      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: theme.green,
        downColor: theme.red,
        wickUpColor: theme.green,
        wickDownColor: theme.red,
        borderVisible: false,
        priceLineVisible: true,
        lastValueVisible: true,
      });
      const barSeries = chart.addSeries(BarSeries, {
        upColor: theme.green,
        downColor: theme.red,
        thinBars: false,
        openVisible: true,
        priceLineVisible: true,
        lastValueVisible: true,
        visible: false,
      });
      const lineSeries = chart.addSeries(LineSeries, {
        color: theme.accent || theme.text,
        lineWidth: 2,
        priceLineVisible: true,
        lastValueVisible: true,
        crosshairMarkerVisible: false,
        visible: false,
      });
      const areaSeries = chart.addSeries(AreaSeries, {
        lineColor: theme.accent || theme.text,
        topColor: withAlpha(theme.accent || theme.text, "30"),
        bottomColor: withAlpha(theme.accent || theme.text, "05"),
        lineWidth: 2,
        priceLineVisible: true,
        lastValueVisible: true,
        crosshairMarkerVisible: false,
        visible: false,
      });
      const baselineSeries = chart.addSeries(BaselineSeries, {
        baseValue: { type: "price", price: model.chartBars[0]?.o ?? 0 },
        topLineColor: theme.green,
        topFillColor1: withAlpha(theme.green, "2f"),
        topFillColor2: withAlpha(theme.green, "08"),
        bottomLineColor: theme.red,
        bottomFillColor1: withAlpha(theme.red, "08"),
        bottomFillColor2: withAlpha(theme.red, "2f"),
        lineWidth: 2,
        priceLineVisible: true,
        lastValueVisible: true,
        crosshairMarkerVisible: false,
        visible: false,
      });
      const volumeSeries = chart.addSeries(HistogramSeries, {
        priceScaleId: "",
        priceFormat: { type: "volume" },
        priceLineVisible: false,
        lastValueVisible: false,
      });

      volumeSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.78, bottom: 0 },
      });

      markerApisRef.current = [
        createSeriesMarkers(candleSeries, []),
        createSeriesMarkers(barSeries, []),
        createSeriesMarkers(lineSeries, []),
        createSeriesMarkers(areaSeries, []),
        createSeriesMarkers(baselineSeries, []),
      ];
      chartRef.current = chart;
      candleSeriesRef.current = candleSeries;
      barSeriesRef.current = barSeries;
      lineSeriesRef.current = lineSeries;
      areaSeriesRef.current = areaSeries;
      baselineSeriesRef.current = baselineSeries;
      volumeSeriesRef.current = volumeSeries;
      activePriceSeriesRef.current = candleSeries;

      handleVisibleRangeChange = (range: any) => {
        visibleLogicalRangeRef.current = range;
        setOverlayRevision((value) => value + 1);
      };
      handleCrosshairMove = (param: any) => {
        const rawTime = param?.time;
        const time = typeof rawTime === "number" ? rawTime : null;
        if (time == null) {
          setHoverBar(null);
          return;
        }

        const bar = barLookupRef.current.get(time);
        setHoverBar(bar || null);
      };
      handleClick = (param: any) => {
        if (!interactionRef.current.drawMode || !param?.point) {
          return;
        }

        const timeValue = chart.timeScale().coordinateToTime(param.point.x);
        const price = activePriceSeriesRef.current?.coordinateToPrice?.(param.point.y);
        const resolvedTime = typeof timeValue === "number" ? timeValue : null;
        const resolvedPrice = typeof price === "number" && Number.isFinite(price) ? price : null;

        if (interactionRef.current.drawMode === "horizontal") {
          if (resolvedPrice == null) {
            return;
          }

          if (typeof interactionRef.current.onAddDrawing === "function") {
            interactionRef.current.onAddDrawing({
              type: "horizontal",
              price: resolvedPrice,
            });
          } else if (typeof interactionRef.current.onAddHorizontalLevel === "function") {
            interactionRef.current.onAddHorizontalLevel(resolvedPrice);
          }
          return;
        }

        if (interactionRef.current.drawMode === "vertical") {
          if (resolvedTime == null) {
            return;
          }

          interactionRef.current.onAddDrawing?.({
            type: "vertical",
            time: resolvedTime,
          });
          return;
        }

        if (interactionRef.current.drawMode === "box") {
          if (resolvedTime == null || resolvedPrice == null || typeof interactionRef.current.onAddDrawing !== "function") {
            return;
          }

          setPendingBoxAnchor((anchor) => {
            if (!anchor) {
              return {
                time: resolvedTime,
                price: resolvedPrice,
              };
            }

            interactionRef.current.onAddDrawing?.({
              type: "box",
              fromTime: Math.min(anchor.time, resolvedTime),
              toTime: Math.max(anchor.time, resolvedTime),
              top: Math.max(anchor.price, resolvedPrice),
              bottom: Math.min(anchor.price, resolvedPrice),
            });
            return null;
          });
        }
      };

      chart.timeScale().subscribeVisibleLogicalRangeChange(handleVisibleRangeChange);
      chart.subscribeCrosshairMove(handleCrosshairMove);
      chart.subscribeClick(handleClick);
    } catch (error) {
      setChartError(error instanceof Error ? error.message : "chart unavailable");
      if (chart) {
        chart.remove();
      }
      chart = null;
    }

    return () => {
      if (chart && handleVisibleRangeChange) {
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleVisibleRangeChange);
      }
      if (chart && handleCrosshairMove) {
        chart.unsubscribeCrosshairMove(handleCrosshairMove);
      }
      if (chart && handleClick) {
        chart.unsubscribeClick(handleClick);
      }
      if (chart) {
        chart.remove();
      }

      chartRef.current = null;
      candleSeriesRef.current = null;
      barSeriesRef.current = null;
      lineSeriesRef.current = null;
      areaSeriesRef.current = null;
      baselineSeriesRef.current = null;
      volumeSeriesRef.current = null;
      markerApisRef.current = [];
      studyRegistryRef.current = {};
      drawingLinesRef.current = {
        candles: [],
        bars: [],
        line: [],
        area: [],
        baseline: [],
      };
      activePriceSeriesRef.current = null;
      visibleLogicalRangeRef.current = null;
      initializedRangeRef.current = false;
      setWindowOverlays([]);
      setZoneOverlays([]);
      setVerticalDrawingOverlays([]);
      setBoxDrawingOverlays([]);
      setPendingBoxAnchor(null);
    };
  }, [
    compact,
    enableInteractions,
    hideTimeScale,
    hideCrosshair,
    model.chartBars.length,
    showAttributionLogo,
    showRightPriceScale,
    theme,
    themeKey,
  ]);

  useLayoutEffect(() => {
    if (
      !chartRef.current ||
      !candleSeriesRef.current ||
      !barSeriesRef.current ||
      !lineSeriesRef.current ||
      !areaSeriesRef.current ||
      !baselineSeriesRef.current ||
      !volumeSeriesRef.current
    ) {
      return;
    }

    const candleSeries = candleSeriesRef.current;
    const barSeries = barSeriesRef.current;
    const lineSeries = lineSeriesRef.current;
    const areaSeries = areaSeriesRef.current;
    const baselineSeries = baselineSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    const pricePrecision = resolvePricePrecision(model.chartBars);
    const priceFormat = {
      type: "price",
      precision: pricePrecision,
      minMove: 1 / (10 ** pricePrecision),
    } as const;
    const closeSeriesData = model.chartBars.map((bar) => ({
      time: bar.time,
      value: bar.c,
    }));

    candleSeries.setData(model.chartBars.map((bar) => ({
      time: bar.time,
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      color: bar.color,
      borderColor: bar.borderColor,
      wickColor: bar.wickColor,
    })));
    barSeries.setData(model.chartBars.map((bar) => ({
      time: bar.time,
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
    })));
    lineSeries.setData(closeSeriesData);
    areaSeries.setData(closeSeriesData);
    baselineSeries.setData(closeSeriesData);
    volumeSeries.setData(showVolume ? model.chartBars.map((bar) => ({
      time: bar.time,
      value: bar.v,
      color: bar.c >= bar.o
        ? withAlpha(theme.green, "55")
        : withAlpha(theme.red, "55"),
    })) : []);

    const effectivePriceLineVisibility = showPriceLine && showRightPriceScale;

    candleSeries.applyOptions({ visible: baseSeriesType === "candles" });
    barSeries.applyOptions({ visible: baseSeriesType === "bars" });
    lineSeries.applyOptions({
      visible: baseSeriesType === "line",
      color: theme.accent || theme.text,
      priceFormat,
      priceLineVisible: effectivePriceLineVisibility,
      lastValueVisible: effectivePriceLineVisibility,
    });
    areaSeries.applyOptions({
      visible: baseSeriesType === "area",
      lineColor: theme.accent || theme.text,
      topColor: withAlpha(theme.accent || theme.text, "30"),
      bottomColor: withAlpha(theme.accent || theme.text, "05"),
      priceFormat,
      priceLineVisible: effectivePriceLineVisibility,
      lastValueVisible: effectivePriceLineVisibility,
    });
    baselineSeries.applyOptions({
      visible: baseSeriesType === "baseline",
      baseValue: { type: "price", price: model.chartBars[0]?.o ?? 0 },
      topLineColor: theme.green,
      topFillColor1: withAlpha(theme.green, "2f"),
      topFillColor2: withAlpha(theme.green, "08"),
      bottomLineColor: theme.red,
      bottomFillColor1: withAlpha(theme.red, "08"),
      bottomFillColor2: withAlpha(theme.red, "2f"),
      priceFormat,
      priceLineVisible: effectivePriceLineVisibility,
      lastValueVisible: effectivePriceLineVisibility,
    });
    candleSeries.applyOptions({
      visible: baseSeriesType === "candles",
      priceFormat,
      priceLineVisible: effectivePriceLineVisibility,
      lastValueVisible: effectivePriceLineVisibility,
    });
    barSeries.applyOptions({
      visible: baseSeriesType === "bars",
      priceFormat,
      priceLineVisible: effectivePriceLineVisibility,
      lastValueVisible: effectivePriceLineVisibility,
    });
    volumeSeries.applyOptions({ visible: showVolume });
    chartRef.current.priceScale("right").applyOptions({
      autoScale,
      invertScale,
      visible: showRightPriceScale,
      borderVisible: showRightPriceScale,
      ticksVisible: showRightPriceScale && !compact,
      textColor: theme.textMuted,
      mode: scaleMode === "log"
        ? PriceScaleMode.Logarithmic
        : scaleMode === "indexed"
          ? PriceScaleMode.IndexedTo100
        : scaleMode === "percentage"
          ? PriceScaleMode.Percentage
          : PriceScaleMode.Normal,
    });
    chartRef.current.applyOptions({
      grid: {
        vertLines: { color: withAlpha(theme.border, "30"), visible: showGrid },
        horzLines: { color: withAlpha(theme.border, "50"), visible: showGrid },
      },
      crosshair: {
        mode: hideCrosshair
          ? CrosshairMode.Hidden
          : crosshairMode === "free"
            ? CrosshairMode.Normal
            : CrosshairMode.MagnetOHLC,
        vertLine: {
          color: withAlpha(theme.textMuted, "90"),
          width: 1,
          style: LineStyle.Dashed,
          visible: !hideCrosshair,
          labelVisible: !hideCrosshair,
        },
        horzLine: {
          color: withAlpha(theme.textMuted, "90"),
          width: 1,
          style: LineStyle.Dashed,
          visible: !hideCrosshair,
          labelVisible: !hideCrosshair,
        },
      },
      handleScroll: enableInteractions,
      handleScale: enableInteractions,
      timeScale: {
        borderColor: theme.border,
        visible: !hideTimeScale && showTimeScaleState,
        timeVisible: !hideTimeScale && showTimeScaleState,
        secondsVisible: false,
        ticksVisible: !compact && !hideTimeScale && showTimeScaleState,
        minBarSpacing: compact ? 1 : 6,
      },
    });
    activePriceSeriesRef.current = (
      {
        candles: candleSeries,
        bars: barSeries,
        line: lineSeries,
        area: areaSeries,
        baseline: baselineSeries,
      } satisfies Record<BaseSeriesType, any>
    )[baseSeriesType] || candleSeries;

    if (visibleLogicalRangeRef.current) {
      chartRef.current.timeScale().setVisibleLogicalRange(visibleLogicalRangeRef.current);
      return;
    }

    if (!initializedRangeRef.current && model.defaultVisibleLogicalRange) {
      chartRef.current.timeScale().setVisibleLogicalRange(model.defaultVisibleLogicalRange);
      initializedRangeRef.current = true;
      return;
    }

    chartRef.current.timeScale().fitContent();
    initializedRangeRef.current = true;
  }, [
    baseSeriesType,
    crosshairMode,
    model.chartBars,
    model.defaultVisibleLogicalRange,
    scaleMode,
    autoScale,
    invertScale,
    enableInteractions,
    hideCrosshair,
    showVolume,
    showGrid,
    showPriceLine,
    showRightPriceScale,
    showTimeScaleState,
    compact,
    hideTimeScale,
    theme.border,
    theme.accent,
    theme.green,
    theme.red,
    theme.text,
    theme.textMuted,
  ]);

  useLayoutEffect(() => {
    if (!chartRef.current) {
      return;
    }

    studyRegistryRef.current = syncStudySeries(
      chartRef.current,
      studyRegistryRef.current,
      model.studySpecs,
    );
  }, [model.studySpecs]);

  useLayoutEffect(() => {
    if (!markerApisRef.current.length) {
      return;
    }

    const markers = model.indicatorMarkerPayload.overviewMarkers.map((marker) => ({
      time: marker.time,
      position: marker.position,
      shape: marker.shape,
      color: marker.color,
      text: marker.text,
      size: marker.size,
    }));
    markerApisRef.current.forEach((markerApi) => markerApi.setMarkers(markers));
  }, [model.indicatorMarkerPayload]);

  useLayoutEffect(() => {
    if (
      !candleSeriesRef.current ||
      !barSeriesRef.current ||
      !lineSeriesRef.current ||
      !areaSeriesRef.current ||
      !baselineSeriesRef.current
    ) {
      return;
    }

    const priceSeriesByType = {
      candles: candleSeriesRef.current,
      bars: barSeriesRef.current,
      line: lineSeriesRef.current,
      area: areaSeriesRef.current,
      baseline: baselineSeriesRef.current,
    } satisfies Record<BaseSeriesType, any>;

    (Object.keys(priceSeriesByType) as BaseSeriesType[]).forEach((seriesType) => {
      drawingLinesRef.current[seriesType].forEach((line) => priceSeriesByType[seriesType].removePriceLine(line));
      drawingLinesRef.current[seriesType] = [];
    });

    const addPriceLine = (lineConfig: any) => {
      (Object.keys(priceSeriesByType) as BaseSeriesType[]).forEach((seriesType) => {
        drawingLinesRef.current[seriesType].push(priceSeriesByType[seriesType].createPriceLine(lineConfig));
      });
    };

    const sessionOpen = model.chartBars[0]?.o;
    if (typeof sessionOpen === "number" && Number.isFinite(sessionOpen)) {
      const sessionLine = {
        price: sessionOpen,
        color: withAlpha(theme.textMuted, "b0"),
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: false,
        title: "",
      };
      addPriceLine(sessionLine);
    }

    drawings
      .filter((drawing) => drawing?.type === "horizontal" && Number.isFinite(drawing?.price))
      .forEach((drawing) => {
        const drawingLine = {
          price: Number(drawing.price),
          color: theme.amber,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "L",
      };
        addPriceLine(drawingLine);
      });

    referenceLines
      .filter((line) => typeof line?.price === "number" && Number.isFinite(line.price))
      .forEach((line) => {
        const referenceLine = {
          price: line.price,
          color: line.color || theme.amber,
          lineWidth: line.lineWidth ?? 2,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: line.axisLabelVisible ?? true,
          title: line.title || "",
        };
        addPriceLine(referenceLine);
      });
  }, [drawings, model.chartBars, referenceLines, theme.amber, theme.textMuted]);

  useLayoutEffect(() => {
    if (!chartRef.current || !activePriceSeriesRef.current || !containerRef.current) {
      syncOverlayState(setWindowOverlays, []);
      syncOverlayState(setZoneOverlays, []);
      syncOverlayState(setVerticalDrawingOverlays, []);
      syncOverlayState(setBoxDrawingOverlays, []);
      return;
    }

    const viewportHeight = containerRef.current.clientHeight;
    syncOverlayState(
      setWindowOverlays,
      buildWindowOverlays(chartRef.current, model, theme, viewportHeight),
    );
    syncOverlayState(
      setZoneOverlays,
      buildZoneOverlays(chartRef.current, activePriceSeriesRef.current, model, theme),
    );
    syncOverlayState(
      setVerticalDrawingOverlays,
      buildVerticalDrawingOverlays(chartRef.current, drawings, theme),
    );
    syncOverlayState(
      setBoxDrawingOverlays,
      buildBoxDrawingOverlays(chartRef.current, activePriceSeriesRef.current, drawings, theme),
    );
  }, [
    baseSeriesType,
    drawings,
    model.chartBars,
    model.indicatorWindows,
    model.indicatorZones,
    overlayRevision,
    scaleMode,
    showVolume,
    theme.amber,
    theme.green,
    theme.red,
    theme.text,
    theme.textMuted,
  ]);

  const displayBar = hoverBar || (() => {
    const lastBar = model.chartBars[model.chartBars.length - 1];
    if (!lastBar) {
      return null;
    }

    return {
      index: model.chartBars.length - 1,
      time: lastBar.time,
      ts: lastBar.ts,
      date: lastBar.date,
      volume: lastBar.v,
      accumulatedVolume: lastBar.accumulatedVolume ?? null,
      vwap: lastBar.vwap ?? null,
      sessionVwap: lastBar.sessionVwap ?? null,
      averageTradeSize: lastBar.averageTradeSize ?? null,
      source: lastBar.source ?? null,
      previousClose: model.chartBars.length > 1 ? model.chartBars[model.chartBars.length - 2]?.c ?? null : null,
      open: lastBar.o,
      high: lastBar.h,
      low: lastBar.l,
      close: lastBar.c,
    };
  })();
  const displayDeltaBase = displayBar?.previousClose ?? displayBar?.open ?? null;
  const displayDelta = displayBar && displayDeltaBase != null
    ? displayBar.close - displayDeltaBase
    : null;
  const displayDeltaValue = typeof displayDelta === "number" ? displayDelta : null;
  const displayDeltaPct = displayBar && displayDeltaBase != null && displayDeltaBase !== 0
    ? ((displayDeltaValue ?? 0) / displayDeltaBase) * 100
    : null;
  const displayGap = displayBar && displayBar.previousClose != null
    ? displayBar.open - displayBar.previousClose
    : null;
  const displayGapPct = displayBar && displayBar.previousClose != null && displayBar.previousClose !== 0
    ? ((displayGap ?? 0) / displayBar.previousClose) * 100
    : null;
  const displayRange = displayBar ? displayBar.high - displayBar.low : null;
  const displayRangePct = displayBar && displayDeltaBase != null && displayDeltaBase !== 0 && displayRange != null
    ? (displayRange / displayDeltaBase) * 100
    : null;
  const displayBody = displayBar ? displayBar.close - displayBar.open : null;
  const upperWick = displayBar ? displayBar.high - Math.max(displayBar.open, displayBar.close) : null;
  const lowerWick = displayBar ? Math.min(displayBar.open, displayBar.close) - displayBar.low : null;
  const hl2 = displayBar ? (displayBar.high + displayBar.low) / 2 : null;
  const hlc3 = displayBar ? (displayBar.high + displayBar.low + displayBar.close) / 3 : null;
  const ohlc4 = displayBar ? (displayBar.open + displayBar.high + displayBar.low + displayBar.close) / 4 : null;
  const pricePrecision = resolvePricePrecision(model.chartBars);
  const formatPrice = (value: number | null | undefined): string => (
    typeof value === "number" && Number.isFinite(value)
      ? value.toFixed(pricePrecision)
      : "—"
  );
  const deltaColor = (displayDeltaValue ?? 0) >= 0 ? theme.green : theme.red;
  const setAdjustedVisibleRange = (nextRange: { from: number; to: number } | null) => {
    if (!chartRef.current || !nextRange) {
      return;
    }

    chartRef.current.timeScale().setVisibleLogicalRange(nextRange);
    visibleLogicalRangeRef.current = nextRange;
    setOverlayRevision((value) => value + 1);
  };
  const zoomVisibleRange = (factor: number) => {
    const currentRange = visibleLogicalRangeRef.current || chartRef.current?.timeScale?.().getVisibleLogicalRange?.();
    if (!currentRange) {
      return;
    }

    const center = (currentRange.from + currentRange.to) / 2;
    const halfRange = Math.max(4, ((currentRange.to - currentRange.from) / 2) * factor);
    setAdjustedVisibleRange({
      from: center - halfRange,
      to: center + halfRange,
    });
  };
  const panVisibleRange = (barsDelta: number) => {
    const currentRange = visibleLogicalRangeRef.current || chartRef.current?.timeScale?.().getVisibleLogicalRange?.();
    if (!currentRange) {
      return;
    }

    setAdjustedVisibleRange({
      from: currentRange.from + barsDelta,
      to: currentRange.to + barsDelta,
    });
  };
  const cycleScaleMode = () => {
    setScaleMode((value) => (
      value === "linear"
        ? "log"
        : value === "log"
          ? "percentage"
          : value === "percentage"
            ? "indexed"
            : "linear"
    ));
  };
  const resetVisibleRange = () => chartRef.current?.timeScale?.().resetTimeScale?.();
  const fitVisibleRange = () => chartRef.current?.timeScale?.().fitContent?.();
  const scrollToRealtime = () => chartRef.current?.timeScale?.().scrollToRealTime?.();
  const surfaceControls = useMemo<ChartSurfaceControls>(() => ({
    baseSeriesType,
    setBaseSeriesType,
    showVolume,
    setShowVolume,
    scaleMode,
    setScaleMode,
    crosshairMode,
    setCrosshairMode,
    showPriceLine,
    setShowPriceLine,
    showGrid,
    setShowGrid,
    showTimeScale: showTimeScaleState,
    setShowTimeScale: setShowTimeScaleState,
    autoScale,
    setAutoScale,
    invertScale,
    setInvertScale,
    cycleScaleMode,
    zoomIn: () => zoomVisibleRange(0.8),
    zoomOut: () => zoomVisibleRange(1.25),
    panLeft: () => panVisibleRange(-12),
    panRight: () => panVisibleRange(12),
    reset: resetVisibleRange,
    fit: fitVisibleRange,
    realtime: scrollToRealtime,
  }), [
    autoScale,
    baseSeriesType,
    crosshairMode,
    invertScale,
    scaleMode,
    showGrid,
    showPriceLine,
    showTimeScaleState,
    showVolume,
  ]);
  const resolvedTopOverlay = typeof topOverlay === "function"
    ? topOverlay(surfaceControls)
    : topOverlay;
  const resolvedBottomOverlay = typeof bottomOverlay === "function"
    ? bottomOverlay(surfaceControls)
    : bottomOverlay;

  if (!model.chartBars.length) {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: `1px dashed ${theme.border}`,
          borderRadius: 6,
          color: theme.textMuted,
          fontFamily: theme.mono,
          fontSize: 11,
          background: withAlpha(theme.bg3, "80"),
        }}
      >
        no live chart data
      </div>
    );
  }

  return (
    <div data-testid={dataTestId} style={{ width: "100%", height: "100%", position: "relative" }}>
      {resolvedTopOverlay ? (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 4,
            pointerEvents: "auto",
          }}
        >
          {resolvedTopOverlay}
        </div>
      ) : null}
      {showToolbar && (
        <div
          data-testid={dataTestId ? `${dataTestId}-toolbar` : undefined}
          style={{
            position: "absolute",
            top: 6 + topOverlayHeight,
            right: 8,
            zIndex: 3,
            display: "flex",
            gap: 4,
            rowGap: 4,
            flexWrap: "wrap",
            justifyContent: "flex-end",
            maxWidth: "calc(100% - 16px)",
          }}
        >
          {[
            { key: "candles", label: "CND", active: baseSeriesType === "candles", onClick: () => setBaseSeriesType("candles") },
            { key: "bars", label: "BAR", active: baseSeriesType === "bars", onClick: () => setBaseSeriesType("bars") },
            { key: "line", label: "LINE", active: baseSeriesType === "line", onClick: () => setBaseSeriesType("line") },
            { key: "area", label: "AREA", active: baseSeriesType === "area", onClick: () => setBaseSeriesType("area") },
            { key: "baseline", label: "BASE", active: baseSeriesType === "baseline", onClick: () => setBaseSeriesType("baseline") },
            { key: "volume", label: "VOL", active: showVolume, onClick: () => setShowVolume((value) => !value) },
            {
              key: "scale",
              label: scaleMode === "log"
                ? "LOG"
                : scaleMode === "percentage"
                  ? "%"
                  : scaleMode === "indexed"
                    ? "100"
                    : "LIN",
              active: scaleMode !== "linear",
              onClick: cycleScaleMode,
            },
            {
              key: "crosshair",
              label: crosshairMode === "free" ? "FREE" : "MAG",
              active: crosshairMode === "free",
              onClick: () => setCrosshairMode((value) => value === "free" ? "magnet" : "free"),
            },
            { key: "grid", label: "GRID", active: showGrid, onClick: () => setShowGrid((value) => !value) },
            { key: "auto-scale", label: "AUTO", active: autoScale, onClick: () => setAutoScale((value) => !value) },
            { key: "invert-scale", label: "INV", active: invertScale, onClick: () => setInvertScale((value) => !value) },
            { key: "time-axis", label: "TIME", active: showTimeScaleState, onClick: () => setShowTimeScaleState((value) => !value) },
            { key: "price-line", label: "PL", active: showPriceLine, onClick: () => setShowPriceLine((value) => !value) },
            { key: "zoom-in", label: "+", active: false, onClick: surfaceControls.zoomIn },
            { key: "zoom-out", label: "−", active: false, onClick: surfaceControls.zoomOut },
            { key: "pan-left", label: "←", active: false, onClick: surfaceControls.panLeft },
            { key: "pan-right", label: "→", active: false, onClick: surfaceControls.panRight },
            { key: "reset", label: "RST", active: false, onClick: surfaceControls.reset },
            { key: "fit", label: "FIT", active: false, onClick: surfaceControls.fit },
            { key: "realtime", label: "RT", active: false, onClick: surfaceControls.realtime },
          ].map((control) => (
            <button
              key={control.key}
              type="button"
              aria-pressed={control.active}
              onClick={control.onClick}
              style={{
                border: `1px solid ${control.active ? withAlpha(theme.accent || theme.text, "aa") : theme.border}`,
                background: control.active ? withAlpha(theme.accent || theme.text, "18") : withAlpha(theme.bg4, "f0"),
                color: control.active ? (theme.accent || theme.text) : theme.textMuted,
                borderRadius: 4,
                padding: "2px 7px",
                fontSize: 10,
                fontFamily: theme.mono,
                cursor: "pointer",
              }}
            >
              {control.label}
            </button>
          ))}
        </div>
      )}
      {chartError ? (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: `1px dashed ${theme.border}`,
            borderRadius: 6,
            color: theme.textMuted,
            fontFamily: theme.mono,
            fontSize: 11,
            background: withAlpha(theme.bg3, "80"),
          }}
        >
          {chartError}
        </div>
      ) : (
        <>
          <div
            ref={containerRef}
            style={{ width: "100%", height: "100%", cursor: drawMode ? "crosshair" : "default" }}
          />
          {(windowOverlays.length || zoneOverlays.length || verticalDrawingOverlays.length || boxDrawingOverlays.length || pendingBoxAnchor) ? (
            <div
              style={{
                position: "absolute",
                inset: 0,
                pointerEvents: "none",
                overflow: "hidden",
              }}
            >
              {windowOverlays.map((overlay) => (
                <div
                  key={`window-${overlay.id}`}
                  style={{
                    position: "absolute",
                    left: overlay.left,
                    top: overlay.top,
                    width: overlay.width,
                    height: overlay.height,
                    background: overlay.fill,
                    borderLeft: `1px solid ${overlay.border}`,
                    borderRight: `1px solid ${overlay.border}`,
                  }}
                />
              ))}
              {verticalDrawingOverlays.map((overlay) => (
                <div
                  key={`vertical-${overlay.id}`}
                  style={{
                    position: "absolute",
                    left: overlay.left,
                    top: 0,
                    width: 1,
                    height: "100%",
                    background: overlay.border,
                    opacity: 0.85,
                  }}
                />
              ))}
              {zoneOverlays.map((overlay) => (
                <div
                  key={`zone-${overlay.id}`}
                  style={{
                    position: "absolute",
                    left: overlay.left,
                    top: overlay.top,
                    width: overlay.width,
                    height: overlay.height,
                    background: overlay.fill,
                    border: `1px solid ${overlay.border}`,
                    borderRadius: 4,
                    boxShadow: `inset 0 0 0 1px ${withAlpha(overlay.border, "38")}`,
                    overflow: "hidden",
                  }}
                >
                  {overlay.label ? (
                    <div
                      style={{
                        position: "absolute",
                        top: 2,
                        left: 4,
                        fontSize: 9,
                        fontFamily: theme.mono,
                        color: theme.text,
                        opacity: 0.85,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {overlay.label}
                    </div>
                  ) : null}
                </div>
              ))}
              {boxDrawingOverlays.map((overlay) => (
                <div
                  key={`drawing-box-${overlay.id}`}
                  style={{
                    position: "absolute",
                    left: overlay.left,
                    top: overlay.top,
                    width: overlay.width,
                    height: overlay.height,
                    background: overlay.fill,
                    border: `1px dashed ${overlay.border}`,
                    borderRadius: 4,
                    overflow: "hidden",
                  }}
                >
                  {overlay.label ? (
                    <div
                      style={{
                        position: "absolute",
                        top: 2,
                        left: 4,
                        fontSize: 9,
                        fontFamily: theme.mono,
                        color: theme.amber,
                        opacity: 0.9,
                      }}
                    >
                      {overlay.label}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}
      {showLegend && displayBar && (
        <div
          data-testid={dataTestId ? `${dataTestId}-legend` : undefined}
          style={{
            position: "absolute",
            top: 6 + topOverlayHeight,
            left: 8,
            background: withAlpha(theme.bg4, "f0"),
            border: `1px solid ${theme.border}`,
            borderRadius: 4,
            padding: "4px 8px",
            fontSize: 11,
            fontFamily: theme.mono,
            color: theme.text,
            display: "flex",
            flexDirection: "column",
            gap: 4,
            pointerEvents: "none",
          }}
        >
          <div style={{ display: "flex", gap: 10, color: theme.textMuted }}>
            <span>{formatLegendTimestamp(displayBar.ts)}</span>
            <span>#{displayBar.index + 1}</span>
            <span>V {formatCompactNumber(displayBar.volume)}</span>
            {displayBar.source ? <span>{displayBar.source === "massive-delayed-stream-derived" ? "STREAM" : "REST"}</span> : null}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <span>O <span>{formatPrice(displayBar.open)}</span></span>
            <span>H <span style={{ color: theme.green }}>{formatPrice(displayBar.high)}</span></span>
            <span>L <span style={{ color: theme.red }}>{formatPrice(displayBar.low)}</span></span>
            <span>C <span style={{ fontWeight: 700 }}>{formatPrice(displayBar.close)}</span></span>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <span>Δ <span style={{ color: deltaColor }}>{displayDeltaValue != null ? `${displayDeltaValue >= 0 ? "+" : ""}${displayDeltaValue.toFixed(pricePrecision)}` : "—"}</span></span>
            <span>% <span style={{ color: deltaColor }}>{displayDeltaPct != null ? `${displayDeltaPct >= 0 ? "+" : ""}${displayDeltaPct.toFixed(2)}%` : "—"}</span></span>
            <span>Gap <span style={{ color: (displayGap ?? 0) >= 0 ? theme.green : theme.red }}>{displayGap != null ? `${displayGap >= 0 ? "+" : ""}${displayGap.toFixed(pricePrecision)}` : "—"}</span></span>
            <span>R <span>{displayRange != null ? displayRange.toFixed(pricePrecision) : "—"}</span></span>
            <span>B <span style={{ color: (displayBody ?? 0) >= 0 ? theme.green : theme.red }}>{displayBody != null ? `${displayBody >= 0 ? "+" : ""}${displayBody.toFixed(pricePrecision)}` : "—"}</span></span>
          </div>
          <div style={{ display: "flex", gap: 10, color: theme.textMuted }}>
            <span>Gap% <span>{displayGapPct != null ? `${displayGapPct >= 0 ? "+" : ""}${displayGapPct.toFixed(2)}%` : "—"}</span></span>
            <span>R% <span>{displayRangePct != null ? `${displayRangePct.toFixed(2)}%` : "—"}</span></span>
            <span>UW <span>{upperWick != null ? upperWick.toFixed(pricePrecision) : "—"}</span></span>
            <span>LW <span>{lowerWick != null ? lowerWick.toFixed(pricePrecision) : "—"}</span></span>
            <span>HL2 <span>{formatPrice(hl2)}</span></span>
            <span>HLC3 <span>{formatPrice(hlc3)}</span></span>
            <span>OHLC4 <span>{formatPrice(ohlc4)}</span></span>
          </div>
          {(displayBar.vwap != null || displayBar.sessionVwap != null || displayBar.accumulatedVolume != null || displayBar.averageTradeSize != null) && (
            <div style={{ display: "flex", gap: 10 }}>
              <span>VWAP <span>{formatPrice(displayBar.vwap)}</span></span>
              <span>SVWAP <span>{formatPrice(displayBar.sessionVwap)}</span></span>
              <span>AV <span>{displayBar.accumulatedVolume != null ? formatCompactNumber(displayBar.accumulatedVolume) : "—"}</span></span>
              <span>ASZ <span>{formatLegendNumber(displayBar.averageTradeSize, 0)}</span></span>
            </div>
          )}
        </div>
      )}
      {resolvedBottomOverlay ? (
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 4,
            pointerEvents: "auto",
          }}
        >
          {resolvedBottomOverlay}
        </div>
      ) : null}
      {drawMode && (
        <div
          style={{
            position: "absolute",
            top: 34 + topOverlayHeight,
            right: 8,
            background: withAlpha(theme.amber, "18"),
            border: `1px solid ${withAlpha(theme.amber, "66")}`,
            borderRadius: 4,
            padding: "3px 8px",
            fontSize: 11,
            fontFamily: theme.mono,
            color: theme.amber,
            pointerEvents: "none",
          }}
        >
          {drawMode === "horizontal"
            ? "click chart to place level"
            : drawMode === "vertical"
              ? "click chart to place vertical marker"
              : pendingBoxAnchor
                ? "click opposite corner to finish box"
                : "click first corner to start box"}
        </div>
      )}
    </div>
  );
};
