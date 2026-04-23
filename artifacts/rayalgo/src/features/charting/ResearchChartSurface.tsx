import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
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
import type {
  ChartModel,
  IndicatorWindow,
  IndicatorZone,
  StudySpec,
} from "./types";
import { registerChart, unregisterChart } from "./chartLifecycle";

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
  dataTestId?: string;
  left: number;
  top: number;
  width: number;
  height: number;
  fill: string;
  border: string;
  label?: string;
  kind?: "box" | "line";
  borderStyle?: "solid" | "dashed" | "dotted";
  borderWidth?: number;
  borderVisible?: boolean;
  labelPosition?: "top-left" | "center" | "right";
  labelOffsetX?: number;
  labelColor?: string;
  labelFill?: string;
  labelBorder?: string;
  labelVariant?: "plain" | "pill";
  radius?: number;
  opacity?: number;
};

type TradeMarkerTarget = {
  id: string;
  left: number;
  top: number;
  size: number;
  label?: string;
  color: string;
  borderColor: string;
  kind: "entry" | "exit";
  tradeSelectionIds: string[];
};

type TradeBadgeOverlay = {
  id: string;
  left: number;
  top: number;
  text: string;
  color: string;
  borderColor: string;
};

type IndicatorBadgeOverlay = {
  id: string;
  dataTestId?: string;
  left: number;
  top: number;
  text: string;
  background: string;
  borderColor: string;
  textColor: string;
  placement: "above" | "below" | "center";
  arrow?: "up" | "down";
  variant: "signal" | "swing" | "structure" | "triangle";
};

type IndicatorDotOverlay = {
  id: string;
  dataTestId?: string;
  left: number;
  top: number;
  size: number;
  color: string;
  borderColor: string;
};

type IndicatorDashboardOverlay = {
  id: string;
  dataTestId?: string;
  position: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  size: "compact" | "expanded" | "tiny" | "small" | "normal" | "large";
  title: string;
  subtitle?: string;
  trendLabel: string;
  trendValue: string;
  trendColor: string;
  rows: Array<{ label: string; value: string; color?: string; detail?: string }>;
  mtf: Array<{ label: string; value: string; color: string; detail?: string }>;
};

const RAY_REPLICA_STRATEGY_KEY = "rayalgo-replica-smc-pro-v3";

const toDataTestIdSegment = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "item";

const buildRayReplicaOverlayTestId = (
  strategy: string | undefined,
  category: string,
  value: string,
): string | undefined =>
  strategy === RAY_REPLICA_STRATEGY_KEY
    ? `rayreplica-${category}-${toDataTestIdSegment(value)}`
    : undefined;

function resolveDashboardDensity(
  size: IndicatorDashboardOverlay["size"],
  compact: boolean,
) {
  if (compact) {
    return {
      width: 184,
      padding: "8px 9px 7px",
      titleSize: 8,
      subtitleSize: 7,
      bodySize: 8,
      detailSize: 7,
    };
  }

  if (size === "expanded" || size === "large" || size === "normal") {
    return {
      width: 236,
      padding: "11px 12px 10px",
      titleSize: 10,
      subtitleSize: 9,
      bodySize: 10,
      detailSize: 9,
    };
  }

  return {
    width: 192,
    padding: "8px 9px 7px",
    titleSize: 8,
    subtitleSize: 7,
    bodySize: 8,
    detailSize: 7,
  };
}

type TradeThresholdOverlay = {
  id: string;
  left: number;
  top: number;
  width: number;
  style: "solid" | "dashed" | "dotted";
  color: string;
  label?: string;
};

type TradeConnectorOverlay = {
  color: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type ChartSurfaceControls = {
  baseSeriesType: BaseSeriesType;
  setBaseSeriesType: (next: BaseSeriesType) => void;
  activeBar: HoverBar | null;
  showVolume: boolean;
  setShowVolume: (next: boolean | ((value: boolean) => boolean)) => void;
  scaleMode: ScaleMode;
  setScaleMode: (next: ScaleMode | ((value: ScaleMode) => ScaleMode)) => void;
  crosshairMode: "magnet" | "free";
  setCrosshairMode: (
    next: "magnet" | "free" | ((value: "magnet" | "free") => "magnet" | "free"),
  ) => void;
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
  takeSnapshot: () => void;
  toggleFullscreen: () => void;
  isFullscreen: boolean;
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
  leftOverlay?: OverlayContent;
  bottomOverlay?: OverlayContent;
  topOverlayHeight?: number;
  leftOverlayWidth?: number;
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
  onTradeMarkerSelection?: (tradeSelectionIds: string[]) => void;
};

const EMPTY_DRAWINGS: ResearchDrawing[] = [];
const EMPTY_REFERENCE_LINES: Array<{
  price: number;
  color?: string;
  title?: string;
  lineWidth?: number;
  axisLabelVisible?: boolean;
}> = [];

type StudyRegistryEntry = {
  paneIndex: number;
  seriesType: StudySpec["seriesType"];
  series: any;
};

const withAlpha = (color: string, alpha: string): string =>
  /^#[0-9a-fA-F]{6}$/.test(color) ? `${color}${alpha}` : color;

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
    fontSize: compact ? 8 : 11,
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
      labelBackgroundColor: withAlpha(theme.bg3, "f0"),
    },
    horzLine: {
      color: withAlpha(theme.textMuted, "90"),
      width: 1,
      style: LineStyle.Dashed,
      visible: true,
      labelVisible: true,
      labelBackgroundColor: withAlpha(theme.bg3, "f0"),
    },
  },
  rightPriceScale: {
    borderColor: theme.border,
    textColor: theme.textMuted,
    visible: showRightPriceScale,
    borderVisible: showRightPriceScale,
    ticksVisible: showRightPriceScale,
    minimumWidth: compact ? 34 : 50,
  },
  leftPriceScale: {
    visible: false,
    borderColor: theme.border,
  },
  timeScale: {
    borderColor: theme.border,
    borderVisible: !hideTimeScale,
    visible: !hideTimeScale,
    timeVisible: !hideTimeScale,
    secondsVisible: false,
    ticksVisible: !hideTimeScale,
    rightOffset: compact ? 1 : 6,
    rightBarStaysOnScroll: true,
    lockVisibleTimeRangeOnResize: true,
    minBarSpacing: compact ? 0.6 : 5,
  },
  handleScroll: enableInteractions
    ? {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      }
    : false,
  handleScale: enableInteractions
    ? {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: {
          time: true,
          price: true,
        },
        axisDoubleClickReset: {
          time: true,
          price: true,
        },
      }
    : false,
});

const SERIES_TYPE_MAP = {
  line: LineSeries,
  histogram: HistogramSeries,
} satisfies Record<
  StudySpec["seriesType"],
  typeof LineSeries | typeof HistogramSeries
>;

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

const formatLegendNumber = (
  value: number | null | undefined,
  digits = 2,
): string => {
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
  const maxDecimals = bars.reduce(
    (result, bar) =>
      Math.max(
        result,
        countValueDecimals(bar.o),
        countValueDecimals(bar.h),
        countValueDecimals(bar.l),
        countValueDecimals(bar.c),
        countValueDecimals(bar.vwap ?? Number.NaN),
        countValueDecimals(bar.sessionVwap ?? Number.NaN),
      ),
    0,
  );

  return Math.min(4, Math.max(2, maxDecimals));
};

const numbersClose = (left: number, right: number, epsilon = 0.5): boolean =>
  Number.isFinite(left) &&
  Number.isFinite(right) &&
  Math.abs(left - right) <= epsilon;

const overlayShapesEqual = (
  left: OverlayShape[],
  right: OverlayShape[],
): boolean => {
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
      leftShape.kind !== rightShape.kind ||
      leftShape.fill !== rightShape.fill ||
      leftShape.border !== rightShape.border ||
      leftShape.borderStyle !== rightShape.borderStyle ||
      leftShape.borderWidth !== rightShape.borderWidth ||
      leftShape.borderVisible !== rightShape.borderVisible ||
      leftShape.label !== rightShape.label ||
      leftShape.labelPosition !== rightShape.labelPosition ||
      leftShape.labelOffsetX !== rightShape.labelOffsetX ||
      leftShape.labelColor !== rightShape.labelColor ||
      leftShape.labelFill !== rightShape.labelFill ||
      leftShape.labelBorder !== rightShape.labelBorder ||
      leftShape.labelVariant !== rightShape.labelVariant ||
      leftShape.radius !== rightShape.radius ||
      leftShape.opacity !== rightShape.opacity ||
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

const stringArraysEqual = (left: string[], right: string[]): boolean => {
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

const tradeMarkerTargetsEqual = (
  left: TradeMarkerTarget[],
  right: TradeMarkerTarget[],
): boolean => {
  if (left === right) {
    return true;
  }

  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftTarget = left[index];
    const rightTarget = right[index];

    if (
      leftTarget.id !== rightTarget.id ||
      leftTarget.label !== rightTarget.label ||
      leftTarget.color !== rightTarget.color ||
      leftTarget.borderColor !== rightTarget.borderColor ||
      leftTarget.kind !== rightTarget.kind ||
      !numbersClose(leftTarget.left, rightTarget.left) ||
      !numbersClose(leftTarget.top, rightTarget.top) ||
      !numbersClose(leftTarget.size, rightTarget.size) ||
      !stringArraysEqual(
        leftTarget.tradeSelectionIds,
        rightTarget.tradeSelectionIds,
      )
    ) {
      return false;
    }
  }

  return true;
};

const tradeThresholdOverlaysEqual = (
  left: TradeThresholdOverlay[],
  right: TradeThresholdOverlay[],
): boolean => {
  if (left === right) {
    return true;
  }

  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftOverlay = left[index];
    const rightOverlay = right[index];

    if (
      leftOverlay.id !== rightOverlay.id ||
      leftOverlay.style !== rightOverlay.style ||
      leftOverlay.color !== rightOverlay.color ||
      leftOverlay.label !== rightOverlay.label ||
      !numbersClose(leftOverlay.left, rightOverlay.left) ||
      !numbersClose(leftOverlay.top, rightOverlay.top) ||
      !numbersClose(leftOverlay.width, rightOverlay.width)
    ) {
      return false;
    }
  }

  return true;
};

const indicatorBadgeOverlaysEqual = (
  left: IndicatorBadgeOverlay[],
  right: IndicatorBadgeOverlay[],
): boolean => {
  if (left === right) {
    return true;
  }

  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const current = left[index];
    const next = right[index];
    if (
      current.id !== next.id ||
      current.text !== next.text ||
      current.background !== next.background ||
      current.borderColor !== next.borderColor ||
      current.textColor !== next.textColor ||
      current.placement !== next.placement ||
      current.arrow !== next.arrow ||
      current.variant !== next.variant ||
      !numbersClose(current.left, next.left) ||
      !numbersClose(current.top, next.top)
    ) {
      return false;
    }
  }

  return true;
};

const indicatorDotOverlaysEqual = (
  left: IndicatorDotOverlay[],
  right: IndicatorDotOverlay[],
): boolean => {
  if (left === right) {
    return true;
  }

  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const current = left[index];
    const next = right[index];
    if (
      current.id !== next.id ||
      current.color !== next.color ||
      current.borderColor !== next.borderColor ||
      !numbersClose(current.left, next.left) ||
      !numbersClose(current.top, next.top) ||
      !numbersClose(current.size, next.size)
    ) {
      return false;
    }
  }

  return true;
};

const indicatorDashboardOverlaysEqual = (
  left: IndicatorDashboardOverlay | null,
  right: IndicatorDashboardOverlay | null,
): boolean => {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return JSON.stringify(left) === JSON.stringify(right);
};

const tradeBadgeOverlaysEqual = (
  left: TradeBadgeOverlay | null,
  right: TradeBadgeOverlay | null,
): boolean => {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return (
    left.id === right.id &&
    left.text === right.text &&
    left.color === right.color &&
    left.borderColor === right.borderColor &&
    numbersClose(left.left, right.left) &&
    numbersClose(left.top, right.top)
  );
};

const tradeConnectorOverlaysEqual = (
  left: TradeConnectorOverlay | null,
  right: TradeConnectorOverlay | null,
): boolean => {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return (
    left.color === right.color &&
    numbersClose(left.x1, right.x1) &&
    numbersClose(left.y1, right.y1) &&
    numbersClose(left.x2, right.x2) &&
    numbersClose(left.y2, right.y2)
  );
};

const parseIsoTimeSeconds = (value: string): number | null => {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return null;
  }

  return Math.floor(parsed / 1000);
};

const resolveOverlayBorderStyle = (
  value: unknown,
): "solid" | "dashed" | "dotted" => {
  if (value === "dashed" || value === "dotted") {
    return value;
  }

  return "solid";
};

const resolveOverlayLabelPosition = (
  value: unknown,
): "top-left" | "center" | "right" => {
  if (value === "center" || value === "right") {
    return value;
  }

  return "top-left";
};

const resolveFiniteMetaNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const clampCoordinate = (value: number, min: number, max: number): number => {
  if (max < min) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
};

const clampVisualAnchor = (
  value: number,
  halfSize: number,
  viewportSize: number,
): number => {
  if (viewportSize <= halfSize * 2) {
    return viewportSize / 2;
  }

  return clampCoordinate(value, halfSize, viewportSize - halfSize);
};

const clipSpanToViewport = (
  start: number,
  end: number,
  viewportSize: number,
  minimumSize = 1,
): { start: number; size: number } | null => {
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    !Number.isFinite(viewportSize) ||
    viewportSize <= 0
  ) {
    return null;
  }

  const rawStart = Math.min(start, end);
  const rawEnd = Math.max(start, end);

  if (rawEnd < 0 || rawStart > viewportSize) {
    return null;
  }

  const clippedStart = clampCoordinate(rawStart, 0, viewportSize);
  const clippedEnd = clampCoordinate(rawEnd, 0, viewportSize);
  const size = Math.min(
    viewportSize,
    Math.max(minimumSize, clippedEnd - clippedStart),
  );
  const adjustedStart = clampCoordinate(clippedStart, 0, viewportSize - size);

  return { start: adjustedStart, size };
};

const clipRectToViewport = ({
  left,
  right,
  top,
  bottom,
  viewportWidth,
  viewportHeight,
  minimumWidth = 2,
  minimumHeight = 2,
}: {
  left: number;
  right: number;
  top: number;
  bottom: number;
  viewportWidth: number;
  viewportHeight: number;
  minimumWidth?: number;
  minimumHeight?: number;
}): { left: number; top: number; width: number; height: number } | null => {
  const xSpan = clipSpanToViewport(left, right, viewportWidth, minimumWidth);
  const ySpan = clipSpanToViewport(top, bottom, viewportHeight, minimumHeight);

  if (!xSpan || !ySpan) {
    return null;
  }

  return {
    left: xSpan.start,
    top: ySpan.start,
    width: xSpan.size,
    height: ySpan.size,
  };
};

const estimateMonoTextWidth = (
  text: string,
  fontSize: number,
  horizontalPadding: number,
): number => text.length * fontSize * 0.68 + horizontalPadding * 2 + 2;

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

  return Math.max(
    2,
    diffs.reduce((sum, value) => sum + value, 0) / diffs.length,
  );
};

const buildWindowOverlays = (
  chart: any,
  model: ChartModel,
  theme: ResearchChartTheme,
  viewportWidth: number,
  viewportHeight: number,
): OverlayShape[] => {
  const barSpacing = resolveBarSpacing(chart, model);

  return model.indicatorWindows.reduce<OverlayShape[]>(
    (result, indicatorWindow: IndicatorWindow) => {
      const startTime =
        indicatorWindow.startBarIndex != null
          ? (model.chartBars[indicatorWindow.startBarIndex]?.time ?? null)
          : parseIsoTimeSeconds(indicatorWindow.startTs);
      const endTime =
        indicatorWindow.endBarIndex != null
          ? (model.chartBars[indicatorWindow.endBarIndex]?.time ?? null)
          : parseIsoTimeSeconds(indicatorWindow.endTs);
      const left =
        startTime != null
          ? chart.timeScale().timeToCoordinate(startTime)
          : null;
      const rightBase =
        endTime != null ? chart.timeScale().timeToCoordinate(endTime) : null;

      if (!Number.isFinite(left)) {
        return result;
      }

      const right =
        typeof rightBase === "number"
          ? rightBase + barSpacing
          : left + barSpacing;
      const xSpan = clipSpanToViewport(left, right, viewportWidth, 2);

      if (!xSpan) {
        return result;
      }

      const tone =
        indicatorWindow.tone ||
        (indicatorWindow.direction === "short" ? "bearish" : "bullish");
      const fill =
        tone === "bearish"
          ? withAlpha(theme.red, "12")
          : tone === "neutral"
            ? withAlpha(theme.textMuted, "10")
            : withAlpha(theme.green, "12");
      const border =
        tone === "bearish"
          ? withAlpha(theme.red, "45")
          : tone === "neutral"
            ? withAlpha(theme.textMuted, "38")
            : withAlpha(theme.green, "45");
      const isBackground =
        (indicatorWindow.meta?.style as string | undefined) === "background";

      result.push({
        id: indicatorWindow.id,
        dataTestId: buildRayReplicaOverlayTestId(
          indicatorWindow.strategy,
          "window",
          indicatorWindow.tone || indicatorWindow.direction,
        ),
        left: xSpan.start,
        top: 0,
        width: xSpan.size,
        height: Math.max(0, viewportHeight),
        fill,
        border: isBackground ? "transparent" : border,
        borderVisible: !isBackground,
        label: isBackground
          ? undefined
          : (indicatorWindow.meta?.label as string | undefined),
      });
      return result;
    },
    [],
  );
};

const buildZoneOverlays = (
  chart: any,
  series: any,
  model: ChartModel,
  theme: ResearchChartTheme,
  viewportWidth: number,
  viewportHeight: number,
): OverlayShape[] => {
  const barSpacing = resolveBarSpacing(chart, model);

  return model.indicatorZones.reduce<OverlayShape[]>(
    (result, zone: IndicatorZone) => {
      const startTime =
        zone.startBarIndex != null
          ? (model.chartBars[zone.startBarIndex]?.time ?? null)
          : parseIsoTimeSeconds(zone.startTs);
      const endTime =
        zone.endBarIndex != null
          ? (model.chartBars[zone.endBarIndex]?.time ?? null)
          : parseIsoTimeSeconds(zone.endTs);
      const left =
        startTime != null
          ? chart.timeScale().timeToCoordinate(startTime)
          : null;
      const rightBase =
        endTime != null ? chart.timeScale().timeToCoordinate(endTime) : null;
      const top = series.priceToCoordinate?.(zone.top);
      const bottom = series.priceToCoordinate?.(zone.bottom);
      const meta = zone.meta ?? {};

      if (
        !Number.isFinite(left) ||
        !Number.isFinite(top) ||
        !Number.isFinite(bottom)
      ) {
        return result;
      }

      const extendBars = resolveFiniteMetaNumber(meta.extendBars, 0);
      const right =
        typeof rightBase === "number"
          ? rightBase + barSpacing * (1 + Math.max(0, extendBars))
          : left + barSpacing * (1 + Math.max(0, extendBars));
      const defaultFill =
        zone.direction === "short"
          ? withAlpha(theme.red, "1c")
          : withAlpha(theme.green, "1c");
      const defaultBorder =
        zone.direction === "short"
          ? withAlpha(theme.red, "70")
          : withAlpha(theme.green, "70");
      const style = meta.style as string | undefined;
      const border = (meta.borderColor as string | undefined) || defaultBorder;
      const fill = (meta.fillColor as string | undefined) || defaultFill;
      const label = typeof zone.label === "string" ? zone.label : undefined;
      const isFillBand = style === "fill-band";

      if (style === "line-overlay") {
        const xSpan = clipSpanToViewport(left, right, viewportWidth, 2);
        const rawLineTop = (top + bottom) / 2;

        if (!xSpan || rawLineTop < 0 || rawLineTop > viewportHeight) {
          return result;
        }

        const lineTop = clampCoordinate(
          rawLineTop,
          1,
          Math.max(1, viewportHeight - 1),
        );

        result.push({
          id: zone.id,
          dataTestId: buildRayReplicaOverlayTestId(
            zone.strategy,
            "zone",
            zone.zoneType || "line",
          ),
          kind: "line",
          left: xSpan.start,
          top: lineTop,
          width: xSpan.size,
          height: 0,
          fill: "transparent",
          border: (meta.lineColor as string | undefined) || border,
          borderStyle: resolveOverlayBorderStyle(meta.lineStyle),
          borderWidth: resolveFiniteMetaNumber(meta.borderWidth, 1),
          borderVisible: true,
          label,
          labelPosition: resolveOverlayLabelPosition(meta.labelPosition),
          labelOffsetX:
            resolveFiniteMetaNumber(meta.labelOffsetBars, 0) * barSpacing,
          labelColor: (meta.labelColor as string | undefined) || "#ffffff",
          labelFill:
            (meta.labelFillColor as string | undefined) ||
            withAlpha(
              ((meta.lineColor as string | undefined) || border) as string,
              "70",
            ),
          labelBorder:
            (meta.labelBorderColor as string | undefined) ||
            withAlpha(
              ((meta.lineColor as string | undefined) || border) as string,
              "90",
            ),
          labelVariant:
            meta.labelVariant === "plain" ? "plain" : "pill",
          opacity: 0.95,
        });
        return result;
      }

      const rawLeft = isFillBand
        ? Math.min(left, right) - barSpacing / 2
        : Math.min(left, right);
      const rawRight = isFillBand
        ? Math.max(left, right) + barSpacing / 2 + 1
        : Math.max(left, right);
      const rawTop = isFillBand
        ? Math.min(top, bottom) - 0.5
        : Math.min(top, bottom);
      const rawBottom = isFillBand
        ? Math.max(top, bottom) + 0.5
        : Math.max(top, bottom);
      const clippedRect = clipRectToViewport({
        left: rawLeft,
        right: rawRight,
        top: rawTop,
        bottom: rawBottom,
        viewportWidth,
        viewportHeight,
      });

      if (!clippedRect) {
        return result;
      }

      result.push({
        id: zone.id,
        dataTestId: buildRayReplicaOverlayTestId(
          zone.strategy,
          "zone",
          zone.zoneType || "box",
        ),
        kind: "box",
        left: clippedRect.left,
        top: clippedRect.top,
        width: clippedRect.width,
        height: clippedRect.height,
        fill,
        border,
        borderStyle: resolveOverlayBorderStyle(meta.lineStyle),
        borderWidth: resolveFiniteMetaNumber(meta.borderWidth, 1),
        borderVisible: isFillBand ? false : meta.borderVisible !== false,
        label,
        labelPosition: resolveOverlayLabelPosition(meta.labelPosition),
        labelColor: (meta.labelColor as string | undefined) || theme.text,
        labelFill: (meta.labelFillColor as string | undefined),
        labelBorder: (meta.labelBorderColor as string | undefined),
        labelVariant:
          meta.labelVariant === "plain" ? "plain" : "pill",
        radius: resolveFiniteMetaNumber(meta.radius, isFillBand ? 0 : 4),
        opacity: resolveFiniteMetaNumber(meta.opacity, isFillBand ? 0.92 : 1),
      });
      return result;
    },
    [],
  );
};

const buildVerticalDrawingOverlays = (
  chart: any,
  drawings: ResearchDrawing[],
  theme: ResearchChartTheme,
  viewportWidth: number,
): OverlayShape[] =>
  drawings.reduce<OverlayShape[]>((result, drawing, index) => {
    if (drawing.type !== "vertical" || typeof drawing.time !== "number") {
      return result;
    }

    const x = chart.timeScale().timeToCoordinate(drawing.time);
    if (!Number.isFinite(x)) {
      return result;
    }

    const clippedX = clampCoordinate(x, 0, Math.max(0, viewportWidth - 1));

    result.push({
      id: `vertical-${index}-${drawing.time}`,
      left: clippedX,
      top: 0,
      width: 1,
      height: 0,
      fill: withAlpha(theme.amber, "00"),
      border: theme.amber,
      label: "V",
    });
    return result;
  }, []);

const buildBoxDrawingOverlays = (
  chart: any,
  series: any,
  drawings: ResearchDrawing[],
  theme: ResearchChartTheme,
  viewportWidth: number,
  viewportHeight: number,
): OverlayShape[] =>
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
      !Number.isFinite(leftCoordinate) ||
      !Number.isFinite(rightCoordinate) ||
      !Number.isFinite(topCoordinate) ||
      !Number.isFinite(bottomCoordinate)
    ) {
      return result;
    }

    const clippedRect = clipRectToViewport({
      left: leftCoordinate,
      right: rightCoordinate,
      top: topCoordinate,
      bottom: bottomCoordinate,
      viewportWidth,
      viewportHeight,
    });

    if (!clippedRect) {
      return result;
    }

    result.push({
      id: `box-${index}-${drawing.fromTime}-${drawing.toTime}`,
      left: clippedRect.left,
      top: clippedRect.top,
      width: clippedRect.width,
      height: clippedRect.height,
      fill: withAlpha(theme.amber, "16"),
      border: withAlpha(theme.amber, "a8"),
      label: "BOX",
    });
    return result;
  }, []);

const buildTradeMarkers = (model: ChartModel, theme: ResearchChartTheme) => {
  const entryMarkers = model.tradeMarkerGroups.entryGroups
    .filter((group) => group.barIndex != null)
    .map((group) => ({
      id: group.id,
      time: group.time,
      barIndex: group.barIndex ?? 0,
      position: group.dir === "long" ? "belowBar" : "aboveBar",
      shape: group.dir === "long" ? "arrowUp" : "arrowDown",
      color: group.dir === "long" ? theme.green : theme.red,
      text: group.label,
      size: group.tradeSelectionIds.length > 1 ? 1 : undefined,
    }));
  const exitMarkers = model.tradeMarkerGroups.exitGroups
    .filter((group) => group.barIndex != null)
    .map((group) => ({
      id: group.id,
      time: group.time,
      barIndex: group.barIndex ?? 0,
      position: group.dir === "long" ? "aboveBar" : "belowBar",
      shape: "square" as const,
      color: group.profitable === false ? theme.red : theme.green,
      text: group.label,
      size: group.tradeSelectionIds.length > 1 ? 1 : undefined,
    }));

  return [...entryMarkers, ...exitMarkers].sort(
    (left, right) => left.time - right.time,
  );
};

const buildTradeMarkerTargets = (
  chart: any,
  series: any,
  model: ChartModel,
  theme: ResearchChartTheme,
  viewportWidth: number,
  viewportHeight: number,
): TradeMarkerTarget[] => {
  const groups = [
    ...model.tradeMarkerGroups.entryGroups,
    ...model.tradeMarkerGroups.exitGroups,
  ];

  return groups.reduce<TradeMarkerTarget[]>((result, group) => {
    if (group.barIndex == null) {
      return result;
    }

    const bar = model.chartBars[group.barIndex];
    if (!bar) {
      return result;
    }

    const x = chart.timeScale().timeToCoordinate(bar.time);
    const priceValue =
      group.kind === "entry"
        ? group.dir === "long"
          ? bar.l
          : bar.h
        : group.dir === "long"
          ? bar.h
          : bar.l;
    const yBase = series.priceToCoordinate?.(priceValue);

    if (!Number.isFinite(x) || !Number.isFinite(yBase)) {
      return result;
    }

    const size = group.tradeSelectionIds.length > 1 ? 28 : 24;
    const top =
      group.kind === "entry"
        ? group.dir === "long"
          ? yBase + 12
          : yBase - size - 12
        : group.dir === "long"
          ? yBase - size - 12
          : yBase + 12;
    const left = x - size / 2;

    result.push({
      id: group.id,
      left: clampCoordinate(left, 0, Math.max(0, viewportWidth - size)),
      top: clampCoordinate(top, 0, Math.max(0, viewportHeight - size)),
      size,
      label: group.label,
      color:
        group.kind === "entry"
          ? group.dir === "long"
            ? withAlpha(theme.green, "22")
            : withAlpha(theme.red, "22")
          : group.profitable === false
            ? withAlpha(theme.red, "22")
            : withAlpha(theme.green, "22"),
      borderColor:
        group.kind === "entry"
          ? group.dir === "long"
            ? theme.green
            : theme.red
          : group.profitable === false
            ? theme.red
            : theme.green,
      kind: group.kind,
      tradeSelectionIds: group.tradeSelectionIds,
    });
    return result;
  }, []);
};

const buildSelectedTradeOverlays = (
  chart: any,
  series: any,
  model: ChartModel,
  theme: ResearchChartTheme,
  viewportWidth: number,
  viewportHeight: number,
): {
  entryBadge: TradeBadgeOverlay | null;
  exitBadge: TradeBadgeOverlay | null;
  connector: TradeConnectorOverlay | null;
  thresholdSegments: TradeThresholdOverlay[];
} => {
  const activeTrade = model.tradeOverlays.find(
    (trade) => trade.tradeSelectionId === model.activeTradeSelectionId,
  );

  if (!activeTrade) {
    return {
      entryBadge: null,
      exitBadge: null,
      connector: null,
      thresholdSegments: [],
    };
  }

  const entryBar =
    activeTrade.entryBarIndex != null
      ? model.chartBars[activeTrade.entryBarIndex]
      : null;
  const exitBar =
    activeTrade.exitBarIndex != null
      ? model.chartBars[activeTrade.exitBarIndex]
      : null;
  const entryAnchorX = entryBar
    ? chart.timeScale().timeToCoordinate(entryBar.time)
    : null;
  const exitAnchorX = exitBar
    ? chart.timeScale().timeToCoordinate(exitBar.time)
    : null;
  const entryAnchorY =
    typeof activeTrade.entryPrice === "number"
      ? series.priceToCoordinate?.(activeTrade.entryPrice)
      : null;
  const exitAnchorY =
    typeof activeTrade.exitPrice === "number"
      ? series.priceToCoordinate?.(activeTrade.exitPrice)
      : null;
  const badgeOffset = 28;
  const entryBadgeTop =
    activeTrade.dir === "long"
      ? typeof entryAnchorY === "number"
        ? entryAnchorY + badgeOffset
        : null
      : typeof entryAnchorY === "number"
        ? entryAnchorY - badgeOffset
        : null;
  const exitBadgeTop =
    activeTrade.dir === "long"
      ? typeof exitAnchorY === "number"
        ? exitAnchorY - badgeOffset
        : null
      : typeof exitAnchorY === "number"
        ? exitAnchorY + badgeOffset
        : null;
  const profitable = activeTrade.profitable !== false;
  const hasEntryBadge =
    typeof entryAnchorX === "number" && typeof entryBadgeTop === "number";
  const hasExitBadge =
    typeof exitAnchorX === "number" && typeof exitBadgeTop === "number";
  const resolvedEntryAnchorX = hasEntryBadge ? entryAnchorX : 0;
  const resolvedEntryBadgeTop = hasEntryBadge ? entryBadgeTop : 0;
  const resolvedExitAnchorX = hasExitBadge ? exitAnchorX : 0;
  const resolvedExitBadgeTop = hasExitBadge ? exitBadgeTop : 0;
  const entryText = `ENTRY ${typeof activeTrade.entryPrice === "number" ? activeTrade.entryPrice.toFixed(2) : "—"}`;
  const exitText = `EXIT ${typeof activeTrade.exitPrice === "number" ? activeTrade.exitPrice.toFixed(2) : "—"}`;
  const entryBadgeWidth = estimateMonoTextWidth(entryText, 10, 7);
  const exitBadgeWidth = estimateMonoTextWidth(exitText, 10, 7);
  const tradeBadgeHeight = 24;
  const entryBadge = hasEntryBadge
    ? {
        id: `${activeTrade.tradeSelectionId}-entry`,
        left: clampVisualAnchor(
          resolvedEntryAnchorX,
          entryBadgeWidth / 2,
          viewportWidth,
        ),
        top: clampVisualAnchor(
          resolvedEntryBadgeTop,
          tradeBadgeHeight / 2,
          viewportHeight,
        ),
        text: entryText,
        color: withAlpha(theme.amber, "20"),
        borderColor: theme.amber,
      }
    : null;
  const exitBadge = hasExitBadge
    ? {
        id: `${activeTrade.tradeSelectionId}-exit`,
        left: clampVisualAnchor(
          resolvedExitAnchorX,
          exitBadgeWidth / 2,
          viewportWidth,
        ),
        top: clampVisualAnchor(
          resolvedExitBadgeTop,
          tradeBadgeHeight / 2,
          viewportHeight,
        ),
        text: exitText,
        color: profitable
          ? withAlpha(theme.green, "20")
          : withAlpha(theme.red, "20"),
        borderColor: profitable ? theme.green : theme.red,
      }
    : null;
  const connector =
    Number.isFinite(entryAnchorX) &&
    Number.isFinite(entryAnchorY) &&
    Number.isFinite(exitAnchorX) &&
    Number.isFinite(exitAnchorY) &&
    exitAnchorX >= entryAnchorX
      ? {
          color: profitable ? theme.green : theme.red,
          x1: clampCoordinate(entryAnchorX, 0, viewportWidth),
          y1: clampCoordinate(entryAnchorY, 0, viewportHeight),
          x2: clampCoordinate(exitAnchorX, 0, viewportWidth),
          y2: clampCoordinate(exitAnchorY, 0, viewportHeight),
        }
      : null;
  const thresholdSegments =
    activeTrade.thresholdPath?.segments.reduce<TradeThresholdOverlay[]>(
      (result, segment) => {
        const startBar = model.chartBars[segment.startBarIndex];
        const endBar = model.chartBars[segment.endBarIndex];
        const left = startBar
          ? chart.timeScale().timeToCoordinate(startBar.time)
          : null;
        const right = endBar
          ? chart.timeScale().timeToCoordinate(endBar.time)
          : null;
        const top = series.priceToCoordinate?.(segment.value);

        if (
          !Number.isFinite(left) ||
          !Number.isFinite(right) ||
          !Number.isFinite(top)
        ) {
          return result;
        }

        const xSpan = clipSpanToViewport(left, right, viewportWidth, 2);

        if (!xSpan || top < 0 || top > viewportHeight) {
          return result;
        }

        const color =
          segment.kind === "take_profit"
            ? theme.green
            : segment.kind === "stop_loss" || segment.kind === "trail_stop"
              ? theme.red
              : theme.amber;

        result.push({
          id: segment.id,
          left: xSpan.start,
          top: clampCoordinate(top, 1, Math.max(1, viewportHeight - 1)),
          width: xSpan.size,
          style: segment.style,
          color,
          label: segment.label,
        });

        return result;
      },
      [],
    ) ?? [];

  return {
    entryBadge,
    exitBadge,
    connector,
    thresholdSegments,
  };
};

const buildIndicatorEventOverlays = (
  chart: any,
  series: any,
  model: ChartModel,
  viewportWidth: number,
  viewportHeight: number,
): {
  badges: IndicatorBadgeOverlay[];
  dots: IndicatorDotOverlay[];
  dashboard: IndicatorDashboardOverlay | null;
} => {
  const badges: IndicatorBadgeOverlay[] = [];
  const dots: IndicatorDotOverlay[] = [];
  let dashboard: IndicatorDashboardOverlay | null = null;

  model.indicatorEvents.forEach((event) => {
    const meta = event.meta ?? {};
    const overlay = meta.overlay;

    if (overlay === "dashboard") {
      dashboard = {
        id: event.id,
        dataTestId:
          (meta.dataTestId as string | undefined) ||
          buildRayReplicaOverlayTestId(event.strategy, "dashboard", "panel"),
        position:
          (meta.position as IndicatorDashboardOverlay["position"] | undefined) ||
          "bottom-right",
        size:
          (meta.size as IndicatorDashboardOverlay["size"] | undefined) ||
          "small",
        title: (meta.title as string | undefined) || "RAYREPLICA DASHBOARD",
        subtitle: (meta.subtitle as string | undefined) || undefined,
        trendLabel: (meta.trendLabel as string | undefined) || "TREND",
        trendValue: (meta.trendValue as string | undefined) || "—",
        trendColor: (meta.trendColor as string | undefined) || "#ffffff",
        rows: Array.isArray(meta.rows)
          ? (meta.rows as IndicatorDashboardOverlay["rows"])
          : [],
        mtf: Array.isArray(meta.mtf)
          ? (meta.mtf as IndicatorDashboardOverlay["mtf"])
          : [],
      };
      return;
    }

    if (typeof event.barIndex !== "number") {
      return;
    }

    const bar = model.chartBars[event.barIndex];
    if (!bar) {
      return;
    }

    const x = chart.timeScale().timeToCoordinate(bar.time);
    const price =
      typeof meta.price === "number" && Number.isFinite(meta.price)
        ? meta.price
        : overlay === "badge"
          ? event.direction === "short"
            ? bar.h
            : bar.l
          : null;
    const y = typeof price === "number" ? series.priceToCoordinate?.(price) : null;

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return;
    }

    if (overlay === "badge") {
      const variant =
        (meta.variant as IndicatorBadgeOverlay["variant"] | undefined) ||
        "signal";
      const placement =
        (meta.placement as IndicatorBadgeOverlay["placement"] | undefined) ||
        "center";
      const text = event.label || "";
      const isSignal = variant === "signal";
      const isTriangle = variant === "triangle";
      const isStructure = variant === "structure";
      const fontSize = isSignal ? 10 : isTriangle ? 12 : 9;
      const horizontalPadding = isSignal
        ? 10
        : isTriangle
          ? 0
          : isStructure
            ? 7
            : 8;
      const estimatedWidth = estimateMonoTextWidth(
        text,
        fontSize,
        horizontalPadding,
      );
      const badgeHeight = isSignal ? 24 : isTriangle ? 16 : 18;
      const arrowClearance = meta.arrow ? 6 : 0;
      const badgeClearance = badgeHeight + arrowClearance;
      const clampedTop =
        placement === "above"
          ? clampCoordinate(y, badgeClearance + 8, viewportHeight)
          : placement === "below"
            ? clampCoordinate(y, 0, Math.max(0, viewportHeight - badgeClearance - 8))
            : clampVisualAnchor(y, badgeClearance / 2, viewportHeight);

      badges.push({
        id: event.id,
        dataTestId:
          (meta.dataTestId as string | undefined) ||
          buildRayReplicaOverlayTestId(event.strategy, "badge", event.eventType),
        left: clampVisualAnchor(x, estimatedWidth / 2, viewportWidth),
        top: clampedTop,
        text,
        background: (meta.background as string | undefined) || "#111827",
        borderColor: (meta.borderColor as string | undefined) || "#9ca3af",
        textColor: (meta.textColor as string | undefined) || "#ffffff",
        placement,
        arrow: meta.arrow as IndicatorBadgeOverlay["arrow"] | undefined,
        variant,
      });
      return;
    }

    if (overlay === "dot") {
      const size =
        typeof meta.size === "number" && Number.isFinite(meta.size)
          ? meta.size
          : 8;
      const visualRadius = size / 2 + 2;
      dots.push({
        id: event.id,
        dataTestId:
          (meta.dataTestId as string | undefined) ||
          buildRayReplicaOverlayTestId(event.strategy, "dot", event.eventType),
        left: clampVisualAnchor(x, visualRadius, viewportWidth),
        top: clampVisualAnchor(y, visualRadius, viewportHeight),
        size,
        color: (meta.color as string | undefined) || "#ffffff",
        borderColor: (meta.borderColor as string | undefined) || "#ffffff",
      });
    }
  });

  return { badges, dots, dashboard };
};

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
    const seriesData = spec.data.map((point) => {
      if (!Number.isFinite(point.value)) {
        return { time: point.time };
      }

      return point.color
        ? { time: point.time, value: point.value, color: point.color }
        : { time: point.time, value: point.value };
    });

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
  leftOverlay = null,
  bottomOverlay = null,
  topOverlayHeight = 0,
  leftOverlayWidth = 0,
  bottomOverlayHeight = 0,
  defaultBaseSeriesType = "candles",
  defaultShowVolume = true,
  defaultShowPriceLine = true,
  defaultScaleMode = "linear",
  drawings = EMPTY_DRAWINGS,
  referenceLines = EMPTY_REFERENCE_LINES,
  drawMode = null,
  onAddDrawing,
  onAddHorizontalLevel,
  onTradeMarkerSelection,
}: ResearchChartSurfaceProps) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
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
  const lastSelectionFocusTokenRef = useRef<number | null>(null);
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
  const [baseSeriesType, setBaseSeriesType] = useState<BaseSeriesType>(
    defaultBaseSeriesType,
  );
  const [showVolume, setShowVolume] = useState(defaultShowVolume);
  const [scaleMode, setScaleMode] = useState<ScaleMode>(defaultScaleMode);
  const [crosshairMode, setCrosshairMode] = useState<"magnet" | "free">(
    "magnet",
  );
  const [showPriceLine, setShowPriceLine] = useState(defaultShowPriceLine);
  const [showGrid, setShowGrid] = useState(true);
  const [showTimeScaleState, setShowTimeScaleState] = useState(!hideTimeScale);
  const [autoScale, setAutoScale] = useState(true);
  const [invertScale, setInvertScale] = useState(false);
  const [overlayRevision, setOverlayRevision] = useState(0);
  const [windowOverlays, setWindowOverlays] = useState<OverlayShape[]>([]);
  const [zoneOverlays, setZoneOverlays] = useState<OverlayShape[]>([]);
  const [verticalDrawingOverlays, setVerticalDrawingOverlays] = useState<
    OverlayShape[]
  >([]);
  const [boxDrawingOverlays, setBoxDrawingOverlays] = useState<OverlayShape[]>(
    [],
  );
  const [tradeMarkerTargets, setTradeMarkerTargets] = useState<
    TradeMarkerTarget[]
  >([]);
  const [indicatorBadgeOverlays, setIndicatorBadgeOverlays] = useState<
    IndicatorBadgeOverlay[]
  >([]);
  const [indicatorDotOverlays, setIndicatorDotOverlays] = useState<
    IndicatorDotOverlay[]
  >([]);
  const [indicatorDashboardOverlay, setIndicatorDashboardOverlay] =
    useState<IndicatorDashboardOverlay | null>(null);
  const [tradeThresholdOverlays, setTradeThresholdOverlays] = useState<
    TradeThresholdOverlay[]
  >([]);
  const [selectedTradeConnector, setSelectedTradeConnector] =
    useState<TradeConnectorOverlay | null>(null);
  const [selectedTradeEntryBadge, setSelectedTradeEntryBadge] =
    useState<TradeBadgeOverlay | null>(null);
  const [selectedTradeExitBadge, setSelectedTradeExitBadge] =
    useState<TradeBadgeOverlay | null>(null);
  const [pendingBoxAnchor, setPendingBoxAnchor] = useState<{
    time: number;
    price: number;
  } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const legendRef = useRef<HTMLDivElement | null>(null);
  const drawModeHintRef = useRef<HTMLDivElement | null>(null);
  const [rootWidth, setRootWidth] = useState(0);
  const [plotSize, setPlotSize] = useState({ width: 0, height: 0 });
  const [toolbarHeight, setToolbarHeight] = useState(0);
  const [legendHeight, setLegendHeight] = useState(0);
  const [drawModeHintHeight, setDrawModeHintHeight] = useState(0);
  const syncOverlayState = (
    setter: Dispatch<SetStateAction<OverlayShape[]>>,
    next: OverlayShape[],
  ) => {
    setter((current) => (overlayShapesEqual(current, next) ? current : next));
  };
  const syncTradeMarkerTargetsState = (next: TradeMarkerTarget[]) => {
    setTradeMarkerTargets((current) =>
      tradeMarkerTargetsEqual(current, next) ? current : next,
    );
  };
  const syncIndicatorBadgeOverlaysState = (next: IndicatorBadgeOverlay[]) => {
    setIndicatorBadgeOverlays((current) =>
      indicatorBadgeOverlaysEqual(current, next) ? current : next,
    );
  };
  const syncIndicatorDotOverlaysState = (next: IndicatorDotOverlay[]) => {
    setIndicatorDotOverlays((current) =>
      indicatorDotOverlaysEqual(current, next) ? current : next,
    );
  };
  const syncIndicatorDashboardOverlayState = (
    next: IndicatorDashboardOverlay | null,
  ) => {
    setIndicatorDashboardOverlay((current) =>
      indicatorDashboardOverlaysEqual(current, next) ? current : next,
    );
  };
  const syncTradeThresholdOverlaysState = (next: TradeThresholdOverlay[]) => {
    setTradeThresholdOverlays((current) =>
      tradeThresholdOverlaysEqual(current, next) ? current : next,
    );
  };
  const syncSelectedTradeConnectorState = (
    next: TradeConnectorOverlay | null,
  ) => {
    setSelectedTradeConnector((current) =>
      tradeConnectorOverlaysEqual(current, next) ? current : next,
    );
  };
  const syncSelectedTradeEntryBadgeState = (next: TradeBadgeOverlay | null) => {
    setSelectedTradeEntryBadge((current) =>
      tradeBadgeOverlaysEqual(current, next) ? current : next,
    );
  };
  const syncSelectedTradeExitBadgeState = (next: TradeBadgeOverlay | null) => {
    setSelectedTradeExitBadge((current) =>
      tradeBadgeOverlaysEqual(current, next) ? current : next,
    );
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
    if (!isFullscreen || typeof document === "undefined") {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsFullscreen(false);
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isFullscreen]);

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
          previousClose:
            index > 0 ? (model.chartBars[index - 1]?.c ?? null) : null,
          open: bar.o,
          high: bar.h,
          low: bar.l,
          close: bar.c,
        },
      ]),
    );
  }, [model.chartBars]);

  useEffect(() => {
    activePriceSeriesRef.current =
      (
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
      registerChart(chart);
      chart.applyOptions({
        crosshair: {
          mode: hideCrosshair ? CrosshairMode.Hidden : CrosshairMode.MagnetOHLC,
          vertLine: {
            visible: !hideCrosshair,
            labelVisible: !hideCrosshair,
            labelBackgroundColor: withAlpha(theme.bg3, "f0"),
          },
          horzLine: {
            visible: !hideCrosshair,
            labelVisible: !hideCrosshair,
            labelBackgroundColor: withAlpha(theme.bg3, "f0"),
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
        const price = activePriceSeriesRef.current?.coordinateToPrice?.(
          param.point.y,
        );
        const resolvedTime = typeof timeValue === "number" ? timeValue : null;
        const resolvedPrice =
          typeof price === "number" && Number.isFinite(price) ? price : null;

        if (interactionRef.current.drawMode === "horizontal") {
          if (resolvedPrice == null) {
            return;
          }

          if (typeof interactionRef.current.onAddDrawing === "function") {
            interactionRef.current.onAddDrawing({
              type: "horizontal",
              price: resolvedPrice,
            });
          } else if (
            typeof interactionRef.current.onAddHorizontalLevel === "function"
          ) {
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
          if (
            resolvedTime == null ||
            resolvedPrice == null ||
            typeof interactionRef.current.onAddDrawing !== "function"
          ) {
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

      chart
        .timeScale()
        .subscribeVisibleLogicalRangeChange(handleVisibleRangeChange);
      chart.subscribeCrosshairMove(handleCrosshairMove);
      chart.subscribeClick(handleClick);
    } catch (error) {
      setChartError(
        error instanceof Error ? error.message : "chart unavailable",
      );
      unregisterChart(chart);
      chart = null;
    }

    return () => {
      if (chart && handleVisibleRangeChange) {
        try {
          chart
            .timeScale()
            .unsubscribeVisibleLogicalRangeChange(handleVisibleRangeChange);
        } catch (_e) {}
      }
      if (chart && handleCrosshairMove) {
        try { chart.unsubscribeCrosshairMove(handleCrosshairMove); } catch (_e) {}
      }
      if (chart && handleClick) {
        try { chart.unsubscribeClick(handleClick); } catch (_e) {}
      }
      unregisterChart(chart);
      chart = null;

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
      lastSelectionFocusTokenRef.current = null;
      setWindowOverlays([]);
      setZoneOverlays([]);
      setVerticalDrawingOverlays([]);
      setBoxDrawingOverlays([]);
      syncTradeMarkerTargetsState([]);
      syncTradeThresholdOverlaysState([]);
      syncSelectedTradeConnectorState(null);
      syncSelectedTradeEntryBadgeState(null);
      syncSelectedTradeExitBadgeState(null);
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
      minMove: 1 / 10 ** pricePrecision,
    } as const;
    const closeSeriesData = model.chartBars.map((bar) => ({
      time: bar.time,
      value: bar.c,
    }));

    candleSeries.setData(
      model.chartBars.map((bar) => ({
        time: bar.time,
        open: bar.o,
        high: bar.h,
        low: bar.l,
        close: bar.c,
        color: bar.color,
        borderColor: bar.borderColor,
        wickColor: bar.wickColor,
      })),
    );
    barSeries.setData(
      model.chartBars.map((bar) => ({
        time: bar.time,
        open: bar.o,
        high: bar.h,
        low: bar.l,
        close: bar.c,
      })),
    );
    lineSeries.setData(closeSeriesData);
    areaSeries.setData(closeSeriesData);
    baselineSeries.setData(closeSeriesData);
    volumeSeries.setData(
      showVolume
        ? model.chartBars.map((bar) => ({
            time: bar.time,
            value: bar.v,
            color:
              bar.c >= bar.o
                ? withAlpha(theme.green, "55")
                : withAlpha(theme.red, "55"),
          }))
        : [],
    );

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
      ticksVisible: showRightPriceScale,
      minimumWidth: compact ? 34 : 50,
      textColor: theme.textMuted,
      mode:
        scaleMode === "log"
          ? PriceScaleMode.Logarithmic
          : scaleMode === "indexed"
            ? PriceScaleMode.IndexedTo100
            : scaleMode === "percentage"
              ? PriceScaleMode.Percentage
              : PriceScaleMode.Normal,
    });
    chartRef.current.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: theme.bg2 },
        textColor: theme.textMuted,
        fontFamily: theme.mono,
        fontSize: compact ? 8 : 11,
      },
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
          labelBackgroundColor: withAlpha(theme.bg3, "f0"),
        },
        horzLine: {
          color: withAlpha(theme.textMuted, "90"),
          width: 1,
          style: LineStyle.Dashed,
          visible: !hideCrosshair,
          labelVisible: !hideCrosshair,
          labelBackgroundColor: withAlpha(theme.bg3, "f0"),
        },
      },
      handleScroll: enableInteractions
        ? {
            mouseWheel: true,
            pressedMouseMove: true,
            horzTouchDrag: true,
            vertTouchDrag: true,
          }
        : false,
      handleScale: enableInteractions
        ? {
            mouseWheel: true,
            pinch: true,
            axisPressedMouseMove: {
              time: true,
              price: true,
            },
            axisDoubleClickReset: {
              time: true,
              price: true,
            },
          }
        : false,
      timeScale: {
        borderColor: theme.border,
        borderVisible: !hideTimeScale && showTimeScaleState,
        visible: !hideTimeScale && showTimeScaleState,
        timeVisible: !hideTimeScale && showTimeScaleState,
        secondsVisible: false,
        ticksVisible: !hideTimeScale && showTimeScaleState,
        rightOffset: compact ? 1 : 6,
        rightBarStaysOnScroll: true,
        lockVisibleTimeRangeOnResize: true,
        minBarSpacing: compact ? 0.35 : 1.1,
      },
    });
    activePriceSeriesRef.current =
      (
        {
          candles: candleSeries,
          bars: barSeries,
          line: lineSeries,
          area: areaSeries,
          baseline: baselineSeries,
        } satisfies Record<BaseSeriesType, any>
      )[baseSeriesType] || candleSeries;

    if (visibleLogicalRangeRef.current) {
      chartRef.current
        .timeScale()
        .setVisibleLogicalRange(visibleLogicalRangeRef.current);
      return;
    }

    if (!initializedRangeRef.current && model.defaultVisibleLogicalRange) {
      chartRef.current
        .timeScale()
        .setVisibleLogicalRange(model.defaultVisibleLogicalRange);
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
    if (
      !chartRef.current ||
      !model.selectionFocus?.visibleLogicalRange ||
      model.selectionFocus.token === lastSelectionFocusTokenRef.current
    ) {
      return;
    }

    chartRef.current
      .timeScale()
      .setVisibleLogicalRange(model.selectionFocus.visibleLogicalRange);
    visibleLogicalRangeRef.current = model.selectionFocus.visibleLogicalRange;
    initializedRangeRef.current = true;
    lastSelectionFocusTokenRef.current = model.selectionFocus.token;
    setOverlayRevision((value) => value + 1);
  }, [model.selectionFocus]);

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

    const markers = [
      ...model.indicatorMarkerPayload.overviewMarkers,
      ...buildTradeMarkers(model, theme),
    ].map((marker) => ({
      time: marker.time,
      position: marker.position,
      shape: marker.shape,
      color: marker.color,
      text: marker.text,
      size: marker.size,
    }));
    markerApisRef.current.forEach((markerApi) => markerApi.setMarkers(markers));
  }, [model.indicatorMarkerPayload, model.tradeMarkerGroups, theme]);

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

    (Object.keys(priceSeriesByType) as BaseSeriesType[]).forEach(
      (seriesType) => {
        drawingLinesRef.current[seriesType].forEach((line) =>
          priceSeriesByType[seriesType].removePriceLine(line),
        );
        drawingLinesRef.current[seriesType] = [];
      },
    );

    const addPriceLine = (lineConfig: any) => {
      (Object.keys(priceSeriesByType) as BaseSeriesType[]).forEach(
        (seriesType) => {
          drawingLinesRef.current[seriesType].push(
            priceSeriesByType[seriesType].createPriceLine(lineConfig),
          );
        },
      );
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
      .filter(
        (drawing) =>
          drawing?.type === "horizontal" && Number.isFinite(drawing?.price),
      )
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
      .filter(
        (line) =>
          typeof line?.price === "number" && Number.isFinite(line.price),
      )
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
    if (
      !chartRef.current ||
      !activePriceSeriesRef.current ||
      !containerRef.current
    ) {
      syncOverlayState(setWindowOverlays, []);
      syncOverlayState(setZoneOverlays, []);
      syncOverlayState(setVerticalDrawingOverlays, []);
      syncOverlayState(setBoxDrawingOverlays, []);
      syncTradeMarkerTargetsState([]);
      syncIndicatorBadgeOverlaysState([]);
      syncIndicatorDotOverlaysState([]);
      syncIndicatorDashboardOverlayState(null);
      syncTradeThresholdOverlaysState([]);
      syncSelectedTradeConnectorState(null);
      syncSelectedTradeEntryBadgeState(null);
      syncSelectedTradeExitBadgeState(null);
      return;
    }

    const viewportHeight = containerRef.current.clientHeight;
    const viewportWidth = containerRef.current.clientWidth;
    syncOverlayState(
      setWindowOverlays,
      buildWindowOverlays(
        chartRef.current,
        model,
        theme,
        viewportWidth,
        viewportHeight,
      ),
    );
    syncOverlayState(
      setZoneOverlays,
      buildZoneOverlays(
        chartRef.current,
        activePriceSeriesRef.current,
        model,
        theme,
        viewportWidth,
        viewportHeight,
      ),
    );
    syncOverlayState(
      setVerticalDrawingOverlays,
      buildVerticalDrawingOverlays(
        chartRef.current,
        drawings,
        theme,
        viewportWidth,
      ),
    );
    syncOverlayState(
      setBoxDrawingOverlays,
      buildBoxDrawingOverlays(
        chartRef.current,
        activePriceSeriesRef.current,
        drawings,
        theme,
        viewportWidth,
        viewportHeight,
      ),
    );
    syncTradeMarkerTargetsState(
      buildTradeMarkerTargets(
        chartRef.current,
        activePriceSeriesRef.current,
        model,
        theme,
        viewportWidth,
        viewportHeight,
      ),
    );
    const indicatorEventOverlays = buildIndicatorEventOverlays(
      chartRef.current,
      activePriceSeriesRef.current,
      model,
      viewportWidth,
      viewportHeight,
    );
    syncIndicatorBadgeOverlaysState(indicatorEventOverlays.badges);
    syncIndicatorDotOverlaysState(indicatorEventOverlays.dots);
    syncIndicatorDashboardOverlayState(indicatorEventOverlays.dashboard);
    const selectedTradeOverlays = buildSelectedTradeOverlays(
      chartRef.current,
      activePriceSeriesRef.current,
      model,
      theme,
      viewportWidth,
      viewportHeight,
    );
    syncTradeThresholdOverlaysState(selectedTradeOverlays.thresholdSegments);
    syncSelectedTradeConnectorState(selectedTradeOverlays.connector);
    syncSelectedTradeEntryBadgeState(selectedTradeOverlays.entryBadge);
    syncSelectedTradeExitBadgeState(selectedTradeOverlays.exitBadge);
  }, [
    baseSeriesType,
    drawings,
    model.chartBars,
    model.activeTradeSelectionId,
    model.indicatorEvents,
    model.tradeMarkerGroups,
    model.tradeOverlays,
    model.indicatorWindows,
    model.indicatorZones,
    overlayRevision,
    plotSize.height,
    plotSize.width,
    rootWidth,
    scaleMode,
    showVolume,
    theme.amber,
    theme.green,
    theme.red,
    theme.text,
    theme.textMuted,
  ]);

  const displayBar =
    hoverBar ||
    (() => {
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
        previousClose:
          model.chartBars.length > 1
            ? (model.chartBars[model.chartBars.length - 2]?.c ?? null)
            : null,
        open: lastBar.o,
        high: lastBar.h,
        low: lastBar.l,
        close: lastBar.c,
      };
    })();
  useLayoutEffect(() => {
    if (typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const observers: ResizeObserver[] = [];
    const watchHeight = (
      element: HTMLElement | null,
      setter: Dispatch<SetStateAction<number>>,
    ) => {
      if (!element) {
        setter(0);
        return;
      }

      const update = () => {
        setter(Math.ceil(element.getBoundingClientRect().height));
      };
      update();

      const observer = new ResizeObserver(() => {
        update();
      });
      observer.observe(element);
      observers.push(observer);
    };

    const rootElement = rootRef.current;
    if (rootElement) {
      const updateRootWidth = () => {
        setRootWidth(Math.ceil(rootElement.getBoundingClientRect().width));
      };
      updateRootWidth();

      const observer = new ResizeObserver(() => {
        updateRootWidth();
      });
      observer.observe(rootElement);
      observers.push(observer);
    } else {
      setRootWidth(0);
    }

    watchHeight(toolbarRef.current, setToolbarHeight);
    watchHeight(legendRef.current, setLegendHeight);
    watchHeight(drawModeHintRef.current, setDrawModeHintHeight);

    const plotElement = containerRef.current;
    if (plotElement) {
      const updatePlotSize = () => {
        const rect = plotElement.getBoundingClientRect();
        const nextWidth = Math.ceil(rect.width);
        const nextHeight = Math.ceil(rect.height);

        setPlotSize((current) =>
          current.width === nextWidth && current.height === nextHeight
            ? current
            : { width: nextWidth, height: nextHeight },
        );
      };
      updatePlotSize();

      const observer = new ResizeObserver(() => {
        updatePlotSize();
      });
      observer.observe(plotElement);
      observers.push(observer);
    } else {
      setPlotSize({ width: 0, height: 0 });
    }

    return () => {
      observers.forEach((observer) => observer.disconnect());
    };
  }, [showToolbar, showLegend, Boolean(displayBar), drawMode]);
  const displayDeltaBase =
    displayBar?.previousClose ?? displayBar?.open ?? null;
  const displayDelta =
    displayBar && displayDeltaBase != null
      ? displayBar.close - displayDeltaBase
      : null;
  const displayDeltaValue =
    typeof displayDelta === "number" ? displayDelta : null;
  const displayDeltaPct =
    displayBar && displayDeltaBase != null && displayDeltaBase !== 0
      ? ((displayDeltaValue ?? 0) / displayDeltaBase) * 100
      : null;
  const displayGap =
    displayBar && displayBar.previousClose != null
      ? displayBar.open - displayBar.previousClose
      : null;
  const displayGapPct =
    displayBar &&
    displayBar.previousClose != null &&
    displayBar.previousClose !== 0
      ? ((displayGap ?? 0) / displayBar.previousClose) * 100
      : null;
  const displayRange = displayBar ? displayBar.high - displayBar.low : null;
  const displayRangePct =
    displayBar &&
    displayDeltaBase != null &&
    displayDeltaBase !== 0 &&
    displayRange != null
      ? (displayRange / displayDeltaBase) * 100
      : null;
  const displayBody = displayBar ? displayBar.close - displayBar.open : null;
  const upperWick = displayBar
    ? displayBar.high - Math.max(displayBar.open, displayBar.close)
    : null;
  const lowerWick = displayBar
    ? Math.min(displayBar.open, displayBar.close) - displayBar.low
    : null;
  const hl2 = displayBar ? (displayBar.high + displayBar.low) / 2 : null;
  const hlc3 = displayBar
    ? (displayBar.high + displayBar.low + displayBar.close) / 3
    : null;
  const ohlc4 = displayBar
    ? (displayBar.open + displayBar.high + displayBar.low + displayBar.close) /
      4
    : null;
  const pricePrecision = resolvePricePrecision(model.chartBars);
  const formatPrice = (value: number | null | undefined): string =>
    typeof value === "number" && Number.isFinite(value)
      ? value.toFixed(pricePrecision)
      : "—";
  const deltaColor = (displayDeltaValue ?? 0) >= 0 ? theme.green : theme.red;
  const setAdjustedVisibleRange = (
    nextRange: { from: number; to: number } | null,
  ) => {
    if (!chartRef.current || !nextRange) {
      return;
    }

    chartRef.current.timeScale().setVisibleLogicalRange(nextRange);
    visibleLogicalRangeRef.current = nextRange;
    setOverlayRevision((value) => value + 1);
  };
  const zoomVisibleRange = (factor: number) => {
    const currentRange =
      visibleLogicalRangeRef.current ||
      chartRef.current?.timeScale?.().getVisibleLogicalRange?.();
    if (!currentRange) {
      return;
    }

    const center = (currentRange.from + currentRange.to) / 2;
    const halfRange = Math.max(
      4,
      ((currentRange.to - currentRange.from) / 2) * factor,
    );
    setAdjustedVisibleRange({
      from: center - halfRange,
      to: center + halfRange,
    });
  };
  const panVisibleRange = (barsDelta: number) => {
    const currentRange =
      visibleLogicalRangeRef.current ||
      chartRef.current?.timeScale?.().getVisibleLogicalRange?.();
    if (!currentRange) {
      return;
    }

    setAdjustedVisibleRange({
      from: currentRange.from + barsDelta,
      to: currentRange.to + barsDelta,
    });
  };
  const cycleScaleMode = () => {
    setScaleMode((value) =>
      value === "linear"
        ? "log"
        : value === "log"
          ? "percentage"
          : value === "percentage"
            ? "indexed"
            : "linear",
    );
  };
  const resetVisibleRange = () =>
    chartRef.current?.timeScale?.().resetTimeScale?.();
  const fitVisibleRange = () => chartRef.current?.timeScale?.().fitContent?.();
  const scrollToRealtime = () =>
    chartRef.current?.timeScale?.().scrollToRealTime?.();
  const takeSnapshot = () => {
    const canvas = chartRef.current?.takeScreenshot?.(true, !hideCrosshair);
    if (!(canvas instanceof HTMLCanvasElement)) {
      return;
    }

    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = "chart-snapshot.png";
    link.click();
  };
  const toggleFullscreen = () => {
    setIsFullscreen((current) => !current);
  };
  const surfaceControls = useMemo<ChartSurfaceControls>(
    () => ({
      baseSeriesType,
      setBaseSeriesType,
      activeBar: displayBar,
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
      takeSnapshot,
      toggleFullscreen,
      isFullscreen,
    }),
    [
      autoScale,
      baseSeriesType,
      crosshairMode,
      displayBar,
      hideCrosshair,
      invertScale,
      isFullscreen,
      scaleMode,
      showGrid,
      showPriceLine,
      showTimeScaleState,
      showVolume,
    ],
  );
  const resolvedTopOverlay =
    typeof topOverlay === "function" ? topOverlay(surfaceControls) : topOverlay;
  const resolvedLeftOverlay =
    typeof leftOverlay === "function"
      ? leftOverlay(surfaceControls)
      : leftOverlay;
  const resolvedBottomOverlay =
    typeof bottomOverlay === "function"
      ? bottomOverlay(surfaceControls)
      : bottomOverlay;
  const chartInsetTop = topOverlayHeight;
  const chartInsetLeft = resolvedLeftOverlay ? leftOverlayWidth : 0;
  const chartInsetBottom = bottomOverlayHeight;
  const hasChartBars = model.chartBars.length > 0;
  const isNarrowFrame = rootWidth > 0 && rootWidth < 920;
  const chromeGap = isNarrowFrame ? 6 : 8;
  const topChromeBase = 6 + chartInsetTop;
  const effectiveToolbarHeight =
    showToolbar && toolbarHeight > 0
      ? toolbarHeight
      : showToolbar
        ? isNarrowFrame
          ? 84
          : 42
        : 0;
  const toolbarOffset = showToolbar ? effectiveToolbarHeight + chromeGap : 0;
  const effectiveLegendHeight =
    showLegend && displayBar && legendHeight > 0
      ? legendHeight
      : showLegend && displayBar
        ? isNarrowFrame
          ? 56
          : 30
        : 0;
  const legendOffset =
    showLegend && displayBar ? effectiveLegendHeight + chromeGap : 0;
  const effectiveDrawModeHintHeight =
    drawMode && drawModeHintHeight > 0 ? drawModeHintHeight : drawMode ? 30 : 0;
  const topChromeClearance =
    12 +
    toolbarOffset +
    legendOffset +
    (drawMode ? effectiveDrawModeHintHeight + chromeGap : 0);
  const toolbarGroups = [
    {
      key: "display",
      label: "display",
      controls: [
        {
          key: "candles",
          label: "Candles",
          active: baseSeriesType === "candles",
          onClick: () => setBaseSeriesType("candles"),
        },
        {
          key: "bars",
          label: "Bars",
          active: baseSeriesType === "bars",
          onClick: () => setBaseSeriesType("bars"),
        },
        {
          key: "line",
          label: "Line",
          active: baseSeriesType === "line",
          onClick: () => setBaseSeriesType("line"),
        },
        {
          key: "area",
          label: "Area",
          active: baseSeriesType === "area",
          onClick: () => setBaseSeriesType("area"),
        },
        {
          key: "baseline",
          label: "Baseline",
          active: baseSeriesType === "baseline",
          onClick: () => setBaseSeriesType("baseline"),
        },
      ],
    },
    {
      key: "overlay",
      label: "overlay",
      controls: [
        {
          key: "volume",
          label: "Volume",
          active: showVolume,
          onClick: () => setShowVolume((value) => !value),
        },
        {
          key: "grid",
          label: "Grid",
          active: showGrid,
          onClick: () => setShowGrid((value) => !value),
        },
        {
          key: "time-axis",
          label: "Time",
          active: showTimeScaleState,
          onClick: () => setShowTimeScaleState((value) => !value),
        },
        {
          key: "price-line",
          label: "Price",
          active: showPriceLine,
          onClick: () => setShowPriceLine((value) => !value),
        },
      ],
    },
    {
      key: "scale",
      label: "scale",
      controls: [
        {
          key: "scale",
          label:
            scaleMode === "log"
              ? "Log"
              : scaleMode === "percentage"
                ? "Percent"
                : scaleMode === "indexed"
                  ? "Base 100"
                  : "Linear",
          active: scaleMode !== "linear",
          onClick: cycleScaleMode,
        },
        {
          key: "crosshair",
          label: crosshairMode === "free" ? "Free" : "Magnet",
          active: crosshairMode === "free",
          onClick: () =>
            setCrosshairMode((value) => (value === "free" ? "magnet" : "free")),
        },
        {
          key: "auto-scale",
          label: "Auto",
          active: autoScale,
          onClick: () => setAutoScale((value) => !value),
        },
        {
          key: "invert-scale",
          label: "Invert",
          active: invertScale,
          onClick: () => setInvertScale((value) => !value),
        },
      ],
    },
    {
      key: "nav",
      label: "nav",
      controls: [
        {
          key: "pan-left",
          label: "Left",
          active: false,
          onClick: surfaceControls.panLeft,
        },
        {
          key: "pan-right",
          label: "Right",
          active: false,
          onClick: surfaceControls.panRight,
        },
        {
          key: "reset",
          label: "Reset",
          active: false,
          onClick: surfaceControls.reset,
        },
        {
          key: "fit",
          label: "Fit",
          active: false,
          onClick: surfaceControls.fit,
        },
        {
          key: "realtime",
          label: "Live",
          active: false,
          onClick: surfaceControls.realtime,
        },
      ],
    },
  ];

  return (
    <div
      ref={rootRef}
      data-testid={dataTestId}
      style={{
        width: isFullscreen ? "100vw" : "100%",
        height: isFullscreen ? "100vh" : "100%",
        position: isFullscreen ? "fixed" : "relative",
        inset: isFullscreen ? 0 : undefined,
        zIndex: isFullscreen ? 160 : undefined,
        overflow: "hidden",
        background: theme.bg2,
      }}
    >
      {resolvedTopOverlay ? (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 5,
            pointerEvents: "auto",
          }}
        >
          {resolvedTopOverlay}
        </div>
      ) : null}
      {resolvedLeftOverlay ? (
        <div
          style={{
            position: "absolute",
            top: chartInsetTop,
            left: 0,
            bottom: chartInsetBottom,
            width: leftOverlayWidth,
            zIndex: 5,
            pointerEvents: "auto",
          }}
        >
          {resolvedLeftOverlay}
        </div>
      ) : null}
      {showToolbar && (
        <div
          ref={toolbarRef}
          data-testid={dataTestId ? `${dataTestId}-toolbar` : undefined}
          style={{
            position: "absolute",
            top: topChromeBase,
            left: chartInsetLeft + 8,
            right: 8,
            zIndex: 6,
            display: "flex",
            gap: 8,
            rowGap: 8,
            flexWrap: "wrap",
            justifyContent: isNarrowFrame ? "flex-start" : "flex-end",
            maxWidth: `calc(100% - ${chartInsetLeft + 16}px)`,
          }}
        >
          {toolbarGroups.map((group) => (
            <div
              key={group.key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "5px 7px",
                border: `1px solid ${withAlpha(theme.border, "b8")}`,
                background: withAlpha(theme.bg2, "dc"),
                backdropFilter: "blur(14px)",
                boxShadow: `0 12px 28px ${withAlpha(theme.bg4, "52")}`,
                maxWidth: isNarrowFrame ? "100%" : undefined,
              }}
            >
              <div
                style={{
                  paddingRight: 2,
                  color: withAlpha(theme.textMuted, "8c"),
                  fontSize: 9,
                  fontFamily: theme.mono,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  whiteSpace: "nowrap",
                }}
              >
                {group.label}
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 4,
                  flexWrap: "wrap",
                  justifyContent: isNarrowFrame ? "flex-start" : "flex-end",
                }}
              >
                {group.controls.map((control) => (
                  <button
                    key={control.key}
                    type="button"
                    aria-pressed={control.active}
                    onClick={control.onClick}
                    style={{
                      border: `1px solid ${control.active ? withAlpha(theme.accent || theme.text, "88") : withAlpha(theme.border, "70")}`,
                      background: control.active
                        ? `linear-gradient(180deg, ${withAlpha(theme.accent || theme.text, "20")} 0%, ${withAlpha(theme.accent || theme.text, "10")} 100%)`
                        : withAlpha(theme.bg4, "d8"),
                      color: control.active
                        ? theme.text
                        : withAlpha(theme.textMuted, "d2"),
                      borderRadius: 999,
                      padding: "4px 10px",
                      fontSize: 10,
                      lineHeight: 1,
                      fontFamily: theme.mono,
                      letterSpacing: "0.03em",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                      boxShadow: control.active
                        ? `inset 0 0 0 1px ${withAlpha(theme.accent || theme.text, "18")}`
                        : "none",
                    }}
                  >
                    {control.label}
                  </button>
                ))}
              </div>
            </div>
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
      ) : hasChartBars ? (
        <>
          <div
            ref={containerRef}
            data-testid={dataTestId ? `${dataTestId}-plot` : undefined}
            style={{
              position: "absolute",
              top: chartInsetTop,
              left: chartInsetLeft,
              right: 0,
              bottom: chartInsetBottom,
              cursor: drawMode ? "crosshair" : "default",
            }}
          />
          {windowOverlays.length ||
          zoneOverlays.length ||
          verticalDrawingOverlays.length ||
          boxDrawingOverlays.length ||
          indicatorBadgeOverlays.length ||
          indicatorDotOverlays.length ||
          indicatorDashboardOverlay ||
          tradeThresholdOverlays.length ||
          tradeMarkerTargets.length ||
          selectedTradeConnector ||
          selectedTradeEntryBadge ||
          selectedTradeExitBadge ||
          pendingBoxAnchor ? (
            <div
              data-testid={dataTestId ? `${dataTestId}-overlay-layer` : undefined}
              style={{
                position: "absolute",
                top: chartInsetTop,
                left: chartInsetLeft,
                right: 0,
                bottom: chartInsetBottom,
                pointerEvents: "none",
                overflow: "hidden",
                zIndex: 5,
              }}
            >
              {windowOverlays.map((overlay) => (
                <div
                  key={`window-${overlay.id}`}
                  data-testid={overlay.dataTestId}
                  style={{
                    position: "absolute",
                    left: overlay.left,
                    top: overlay.top,
                    width: overlay.width,
                    height: overlay.height,
                    background: overlay.fill,
                    boxSizing: "border-box",
                    borderLeft:
                      overlay.borderVisible === false
                        ? "none"
                        : `${overlay.borderWidth ?? 1}px solid ${overlay.border}`,
                    borderRight:
                      overlay.borderVisible === false
                        ? "none"
                        : `${overlay.borderWidth ?? 1}px solid ${overlay.border}`,
                    opacity: overlay.opacity ?? 1,
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
                overlay.kind === "line" ? (
                  <div
                    key={`zone-${overlay.id}`}
                    data-testid={overlay.dataTestId}
                    style={{
                      position: "absolute",
                      left: overlay.left,
                      top: overlay.top,
                      width: overlay.width,
                      height: 0,
                      borderTop: `${overlay.borderWidth ?? 1}px ${overlay.borderStyle ?? "solid"} ${overlay.border}`,
                      opacity: overlay.opacity ?? 0.95,
                      overflow: "visible",
                    }}
                  >
                    {overlay.label ? (
                      <div
                        style={{
                          position: "absolute",
                          left:
                            overlay.labelPosition === "center"
                              ? "50%"
                              : overlay.labelPosition === "right"
                                ? overlay.width + (overlay.labelOffsetX ?? 0)
                                : 4,
                          top: overlay.labelPosition === "top-left" ? -14 : 0,
                          transform:
                            overlay.labelPosition === "center"
                              ? "translate(-50%, -50%)"
                              : overlay.labelPosition === "right"
                                ? "translate(0, -50%)"
                                : "none",
                          padding:
                            overlay.labelVariant === "plain" ? 0 : "1px 6px",
                          borderRadius: overlay.labelVariant === "plain" ? 0 : 999,
                          border:
                            overlay.labelVariant === "plain"
                              ? "none"
                              : `1px solid ${overlay.labelBorder || overlay.border}`,
                          background:
                            overlay.labelVariant === "plain"
                              ? "transparent"
                              : overlay.labelFill || withAlpha(theme.bg4, "e6"),
                          fontSize: 9,
                          fontFamily: theme.mono,
                          color: overlay.labelColor || "#ffffff",
                          whiteSpace: "nowrap",
                          lineHeight: 1.35,
                        }}
                      >
                        {overlay.label}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div
                    key={`zone-${overlay.id}`}
                    data-testid={overlay.dataTestId}
                    style={{
                      position: "absolute",
                      left: overlay.left,
                      top: overlay.top,
                      width: overlay.width,
                      height: overlay.height,
                      background: overlay.fill,
                      boxSizing: "border-box",
                      border:
                        overlay.borderVisible === false
                          ? "none"
                          : `${overlay.borderWidth ?? 1}px ${overlay.borderStyle ?? "solid"} ${overlay.border}`,
                      borderRadius: overlay.radius ?? 4,
                      boxShadow:
                        overlay.borderVisible === false
                          ? "none"
                          : `inset 0 0 0 1px ${withAlpha(overlay.border, "38")}`,
                      overflow: "visible",
                      opacity: overlay.opacity ?? 1,
                    }}
                  >
                    {overlay.label ? (
                      <div
                        style={{
                          position: "absolute",
                          top: overlay.labelPosition === "center" ? "50%" : 2,
                          left: overlay.labelPosition === "center" ? "50%" : 4,
                          transform:
                            overlay.labelPosition === "center"
                              ? "translate(-50%, -50%)"
                              : "none",
                          padding:
                            overlay.labelVariant === "plain" ? 0 : "1px 6px",
                          borderRadius: overlay.labelVariant === "plain" ? 0 : 999,
                          border:
                            overlay.labelVariant === "plain"
                              ? "none"
                              : `1px solid ${overlay.labelBorder || withAlpha(overlay.border, "70")}`,
                          background:
                            overlay.labelVariant === "plain"
                              ? "transparent"
                              : overlay.labelFill || withAlpha(theme.bg4, "e6"),
                          fontSize: 9,
                          fontFamily: theme.mono,
                          color: overlay.labelColor || theme.text,
                          opacity: 0.92,
                          whiteSpace: "nowrap",
                          textAlign:
                            overlay.labelPosition === "center" ? "center" : "left",
                        }}
                      >
                        {overlay.label}
                      </div>
                    ) : null}
                  </div>
                )
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
                    boxSizing: "border-box",
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
              {tradeThresholdOverlays.map((overlay) => (
                <div
                  key={`trade-threshold-${overlay.id}`}
                  style={{
                    position: "absolute",
                    left: overlay.left,
                    top: overlay.top,
                    width: overlay.width,
                    borderTop: `2px ${overlay.style} ${overlay.color}`,
                    opacity: 0.92,
                  }}
                >
                  {overlay.label ? (
                    <div
                      style={{
                        position: "absolute",
                        top: -14,
                        left: 0,
                        fontSize: 9,
                        fontFamily: theme.mono,
                        color: overlay.color,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {overlay.label}
                    </div>
                  ) : null}
                </div>
              ))}
              {indicatorDotOverlays.map((overlay) => (
                <div
                  key={`indicator-dot-${overlay.id}`}
                  data-testid={overlay.dataTestId}
                  style={{
                    position: "absolute",
                    left: overlay.left,
                    top: overlay.top,
                    width: overlay.size,
                    height: overlay.size,
                    transform: "translate(-50%, -50%)",
                    borderRadius: 999,
                    boxSizing: "border-box",
                    background: overlay.color,
                    border: `1px solid ${overlay.borderColor}`,
                    boxShadow: `0 0 0 1px ${withAlpha(theme.bg4, "cc")}`,
                  }}
                />
              ))}
              {indicatorBadgeOverlays.map((overlay) => {
                const isSignal = overlay.variant === "signal";
                const isTriangle = overlay.variant === "triangle";
                const isStructure = overlay.variant === "structure";
                const placementTransform =
                  overlay.placement === "above"
                    ? "translate(-50%, calc(-100% - 8px))"
                    : overlay.placement === "below"
                      ? "translate(-50%, 8px)"
                      : "translate(-50%, -50%)";
                const arrowElement =
                  overlay.arrow === "up" ? (
                    <div
                      style={{
                        position: "absolute",
                        top: -6,
                        left: "50%",
                        transform: "translateX(-50%)",
                        width: 0,
                        height: 0,
                        borderLeft: "6px solid transparent",
                        borderRight: "6px solid transparent",
                        borderBottom: `6px solid ${overlay.background}`,
                      }}
                    />
                  ) : overlay.arrow === "down" ? (
                    <div
                      style={{
                        position: "absolute",
                        bottom: -6,
                        left: "50%",
                        transform: "translateX(-50%)",
                        width: 0,
                        height: 0,
                        borderLeft: "6px solid transparent",
                        borderRight: "6px solid transparent",
                        borderTop: `6px solid ${overlay.background}`,
                      }}
                    />
                  ) : null;
                return (
                  <div
                    key={`indicator-badge-${overlay.id}`}
                    data-testid={overlay.dataTestId}
                    style={{
                      position: "absolute",
                      left: overlay.left,
                      top: overlay.top,
                      transform: placementTransform,
                      overflow: "visible",
                    }}
                  >
                    <div
                      style={{
                        position: "relative",
                        padding:
                          isSignal
                            ? "4px 10px"
                            : isTriangle
                              ? "0"
                              : isStructure
                                ? "2px 7px"
                                : "2px 8px",
                        borderRadius: isSignal ? 999 : 8,
                        border: isTriangle
                          ? "none"
                          : `1px solid ${overlay.borderColor}`,
                        background: isTriangle ? "transparent" : overlay.background,
                        color: isTriangle ? overlay.background : overlay.textColor,
                        fontSize: isSignal ? 10 : isTriangle ? 12 : 9,
                        fontFamily: theme.mono,
                        fontWeight: 700,
                        whiteSpace: "nowrap",
                        boxShadow: isTriangle
                          ? "none"
                          : `0 4px 12px ${withAlpha(theme.bg4, "88")}`,
                        letterSpacing:
                          isSignal || isStructure ? "0.04em" : "normal",
                      }}
                    >
                      {overlay.text}
                      {arrowElement}
                    </div>
                  </div>
                );
              })}
              {indicatorDashboardOverlay ? (
                <div
                  data-testid={indicatorDashboardOverlay.dataTestId}
                  style={{
                    position: "absolute",
                    ...(indicatorDashboardOverlay.position.includes("top")
                      ? { top: topChromeClearance }
                      : { bottom: compact ? 42 : 36 }),
                    ...(indicatorDashboardOverlay.position.includes("left")
                      ? { left: 12 }
                      : { right: compact ? 54 : 62 }),
                    ...(() => {
                      const density = resolveDashboardDensity(
                        indicatorDashboardOverlay.size,
                        compact,
                      );

                      return {
                        width: density.width,
                        padding: density.padding,
                      };
                    })(),
                    background: withAlpha("#000000", "b3"),
                    border: `1px solid ${withAlpha("#9ca3af", "66")}`,
                    borderRadius: 0,
                    boxSizing: "border-box",
                    color: "#ffffff",
                    boxShadow: "none",
                    maxWidth: indicatorDashboardOverlay.position.includes("left")
                      ? "calc(100% - 24px)"
                      : `calc(100% - ${(compact ? 54 : 62) + 12}px)`,
                    zIndex: 6,
                  }}
                >
                  <div
                    style={{
                      marginBottom: 6,
                      padding: "2px 6px",
                      borderRadius: 0,
                      background: withAlpha("#6b7280", "80"),
                      fontSize: resolveDashboardDensity(
                        indicatorDashboardOverlay.size,
                        compact,
                      ).titleSize,
                      fontFamily: theme.mono,
                      fontWeight: 700,
                      textAlign: "center",
                      letterSpacing: "0.04em",
                    }}
                  >
                    {indicatorDashboardOverlay.title}
                  </div>
                  {indicatorDashboardOverlay.subtitle ? (
                    <div
                      style={{
                        marginBottom: 8,
                        color: "#9ca3af",
                        fontFamily: theme.mono,
                        fontSize: resolveDashboardDensity(
                          indicatorDashboardOverlay.size,
                          compact,
                        ).subtitleSize,
                        lineHeight: 1.35,
                        letterSpacing: "0.02em",
                      }}
                    >
                      {indicatorDashboardOverlay.subtitle}
                    </div>
                  ) : null}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr auto",
                      rowGap: 3,
                      columnGap: 8,
                      fontSize: resolveDashboardDensity(
                        indicatorDashboardOverlay.size,
                        compact,
                      ).bodySize,
                      fontFamily: theme.mono,
                    }}
                  >
                    <div style={{ color: "#9ca3af" }}>
                      {indicatorDashboardOverlay.trendLabel}
                    </div>
                    <div style={{ color: indicatorDashboardOverlay.trendColor }}>
                      {indicatorDashboardOverlay.trendValue}
                    </div>
                    {indicatorDashboardOverlay.rows.map((row) => (
                      <div
                        key={`${indicatorDashboardOverlay.id}-${row.label}`}
                        style={{ display: "contents" }}
                      >
                        <div style={{ color: "#9ca3af" }}>{row.label}</div>
                        <div style={{ color: row.color || "#ffffff" }}>
                          {row.value}
                        </div>
                        {row.detail ? (
                          <div
                            style={{
                              gridColumn: "1 / -1",
                              color: "#6b7280",
                              fontSize: resolveDashboardDensity(
                                indicatorDashboardOverlay.size,
                                compact,
                              ).detailSize,
                              lineHeight: 1.3,
                              marginTop: -1,
                              marginBottom: 2,
                            }}
                          >
                            {row.detail}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  {indicatorDashboardOverlay.mtf.length ? (
                    <div
                      style={{
                        marginTop: 8,
                        display: "grid",
                        gridTemplateColumns: `repeat(${indicatorDashboardOverlay.mtf.length}, 1fr)`,
                        gap: 6,
                        textAlign: "center",
                        fontFamily: theme.mono,
                        fontSize: resolveDashboardDensity(
                          indicatorDashboardOverlay.size,
                          compact,
                        ).bodySize,
                      }}
                    >
                      {indicatorDashboardOverlay.mtf.map((item) => (
                        <div key={`${indicatorDashboardOverlay.id}-${item.label}`}>
                          <div style={{ color: "#9ca3af" }}>{item.label}</div>
                          <div style={{ color: item.color }}>{item.value}</div>
                          {item.detail ? (
                            <div
                              style={{
                                color: "#6b7280",
                                fontSize: resolveDashboardDensity(
                                  indicatorDashboardOverlay.size,
                                  compact,
                                ).detailSize,
                                marginTop: 1,
                              }}
                            >
                              {item.detail}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {selectedTradeConnector ? (
                <svg
                  width="100%"
                  height="100%"
                  style={{
                    position: "absolute",
                    inset: 0,
                    overflow: "hidden",
                  }}
                >
                  <line
                    x1={selectedTradeConnector.x1}
                    y1={selectedTradeConnector.y1}
                    x2={selectedTradeConnector.x2}
                    y2={selectedTradeConnector.y2}
                    stroke={selectedTradeConnector.color}
                    strokeWidth="2"
                    strokeDasharray="4 3"
                    opacity="0.9"
                  />
                </svg>
              ) : null}
              {[selectedTradeEntryBadge, selectedTradeExitBadge]
                .filter((badge): badge is TradeBadgeOverlay => Boolean(badge))
                .map((badge) => (
                  <div
                    key={`trade-badge-${badge.id}`}
                    style={{
                      position: "absolute",
                      left: badge.left,
                      top: badge.top,
                      transform: "translate(-50%, -50%)",
                      padding: "3px 7px",
                      borderRadius: 4,
                      border: `1px solid ${badge.borderColor}`,
                      background: badge.color,
                      color: theme.text,
                      fontSize: 10,
                      fontFamily: theme.mono,
                      fontWeight: 700,
                      whiteSpace: "nowrap",
                      boxShadow: `0 4px 12px ${withAlpha(theme.bg4, "88")}`,
                    }}
                  >
                    {badge.text}
                  </div>
                ))}
              {tradeMarkerTargets.map((target) => (
                <button
                  key={`trade-target-${target.id}`}
                  type="button"
                  onClick={() =>
                    onTradeMarkerSelection?.(target.tradeSelectionIds)
                  }
                  style={{
                    position: "absolute",
                    left: target.left,
                    top: target.top,
                    width: target.size,
                    height: target.size,
                    borderRadius: 999,
                    boxSizing: "border-box",
                    border: `1px solid ${target.borderColor}`,
                    background: target.color,
                    color: target.borderColor,
                    fontSize: 10,
                    fontFamily: theme.mono,
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    pointerEvents: "auto",
                    cursor: "pointer",
                    boxShadow: `0 0 0 1px ${withAlpha(theme.bg4, "cc")}`,
                  }}
                  title={
                    target.tradeSelectionIds.length > 1
                      ? `${target.tradeSelectionIds.length} overlapping trades`
                      : "Select trade"
                  }
                >
                  {target.label ?? "•"}
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <div
          style={{
            position: "absolute",
            top: chartInsetTop,
            left: chartInsetLeft,
            right: 0,
            bottom: chartInsetBottom,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0) 100%)",
          }}
        >
          <div
            style={{
              minWidth: 220,
              maxWidth: 360,
              padding: "16px 18px",
              border: `1px solid ${withAlpha(theme.border, "b8")}`,
              background: withAlpha(theme.bg2, "de"),
              backdropFilter: "blur(14px)",
              boxShadow: `0 18px 42px ${withAlpha(theme.bg4, "48")}`,
            }}
          >
            <div
              style={{
                marginBottom: 8,
                color: withAlpha(theme.textMuted, "8c"),
                fontFamily: theme.mono,
                fontSize: 9,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
              }}
            >
              Chart feed
            </div>
            <div
              style={{
                color: theme.text,
                fontFamily: theme.mono,
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              No live chart data available.
            </div>
            <div
              style={{
                marginTop: 6,
                color: theme.textMuted,
                fontFamily: theme.mono,
                fontSize: 10,
                lineHeight: 1.5,
              }}
            >
              Chart controls remain available while the stream reconnects or a
              symbol is selected.
            </div>
          </div>
        </div>
      )}
      {showLegend && displayBar && (
        <div
          ref={legendRef}
          data-testid={dataTestId ? `${dataTestId}-legend` : undefined}
          style={{
            position: "absolute",
            top: topChromeBase + toolbarOffset,
            left: 8 + chartInsetLeft,
            right: 12,
            background: withAlpha(theme.bg2, "d6"),
            border: `1px solid ${withAlpha(theme.border, "9c")}`,
            padding: "5px 8px",
            fontSize: 10,
            fontFamily: theme.mono,
            color: theme.textMuted,
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            pointerEvents: "none",
            backdropFilter: "blur(12px)",
            boxShadow: `0 10px 24px ${withAlpha(theme.bg4, "34")}`,
          }}
        >
          <span>{formatLegendTimestamp(displayBar.ts)}</span>
          <span>
            O{" "}
            <span style={{ color: theme.text }}>
              {formatPrice(displayBar.open)}
            </span>
          </span>
          <span>
            H{" "}
            <span style={{ color: theme.green }}>
              {formatPrice(displayBar.high)}
            </span>
          </span>
          <span>
            L{" "}
            <span style={{ color: theme.red }}>
              {formatPrice(displayBar.low)}
            </span>
          </span>
          <span>
            C{" "}
            <span style={{ color: theme.text, fontWeight: 700 }}>
              {formatPrice(displayBar.close)}
            </span>
          </span>
          <span>
            Δ{" "}
            <span style={{ color: deltaColor }}>
              {displayDeltaValue != null
                ? `${displayDeltaValue >= 0 ? "+" : ""}${displayDeltaValue.toFixed(pricePrecision)}`
                : "—"}
            </span>
          </span>
          <span>
            %{" "}
            <span style={{ color: deltaColor }}>
              {displayDeltaPct != null
                ? `${displayDeltaPct >= 0 ? "+" : ""}${displayDeltaPct.toFixed(2)}%`
                : "—"}
            </span>
          </span>
          <span>
            V{" "}
            <span style={{ color: theme.text }}>
              {formatCompactNumber(displayBar.volume)}
            </span>
          </span>
          {displayBar.vwap != null ? (
            <span>
              VWAP{" "}
              <span style={{ color: theme.text }}>
                {formatPrice(displayBar.vwap)}
              </span>
            </span>
          ) : null}
          {displayBar.sessionVwap != null ? (
            <span>
              SVWAP{" "}
              <span style={{ color: theme.text }}>
                {formatPrice(displayBar.sessionVwap)}
              </span>
            </span>
          ) : null}
          {displayBar.accumulatedVolume != null ? (
            <span>
              AV{" "}
              <span style={{ color: theme.text }}>
                {formatCompactNumber(displayBar.accumulatedVolume)}
              </span>
            </span>
          ) : null}
          {displayBar.averageTradeSize != null ? (
            <span>
              ASZ{" "}
              <span style={{ color: theme.text }}>
                {formatLegendNumber(displayBar.averageTradeSize, 0)}
              </span>
            </span>
          ) : null}
          {displayBar.source ? (
            <span>
              {displayBar.source === "ibkr-websocket-derived"
                ? "STREAM"
                : displayBar.source === "ibkr+massive-gap-fill"
                  ? "IBKR + GAP"
                  : displayBar.source === "ibkr-history"
                    ? "IBKR"
                    : "REST"}
            </span>
          ) : null}
        </div>
      )}
      {resolvedBottomOverlay ? (
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 5,
            pointerEvents: "auto",
          }}
        >
          {resolvedBottomOverlay}
        </div>
      ) : null}
      {drawMode && (
        <div
          ref={drawModeHintRef}
          style={{
            position: "absolute",
            top: topChromeBase + toolbarOffset + legendOffset,
            right: 8,
            zIndex: 7,
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
