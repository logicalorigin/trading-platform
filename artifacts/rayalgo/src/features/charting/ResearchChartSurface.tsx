import {
  useEffect,
  useLayoutEffect,
  useCallback,
  useDeferredValue,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type SetStateAction,
  type WheelEvent,
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
import { Copy } from "lucide-react";
import type {
  ChartModel,
  IndicatorWindow,
  IndicatorZone,
  StudySpec,
} from "./types";
import type { ChartEvent, FlowChartEventConversion } from "./chartEvents";
import {
  buildFlowChartBuckets,
  buildFlowTooltipModel,
  summarizeFlowChartBucketPlacement,
  type FlowChartBucket,
  type FlowTooltipModel,
} from "./flowChartEvents";
import { registerChart, unregisterChart } from "./chartLifecycle";
import {
  buildUsEquityExtendedSessionWindows,
  countUsEquityMarketSessionBars,
  resolveUsEquityMarketSession,
} from "./marketSession";
import {
  HISTOGRAM_VALUE_DISPLAY_CAP,
  sanitizeHistogramPoint,
} from "./histogramSafety";
import {
  MAX_CHART_FUTURE_EXPANSION_BARS,
  formatPreferenceDateTime,
  resolvePreferenceTimeZone,
  type UserPreferences,
} from "../preferences/userPreferenceModel";
import { useUserPreferences } from "../preferences/useUserPreferences";
import { TYPE_CSS_VAR, TYPE_PX } from "../../lib/typography";
import { AppTooltip } from "@/components/ui/tooltip";
import {
  recordChartHydrationCounter,
  recordChartHydrationMetric,
  type ChartHydrationCounterKey,
} from "./chartHydrationStats";

export const RESEARCH_CHART_SURFACE_MODULE_VERSION =
  "ResearchChartSurface@20260508-flow-normalized-v1";

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
  blue?: string;
  cyan?: string;
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
export type VisibleLogicalRange = {
  from: number;
  to: number;
};

export const normalizeVisibleLogicalRange = (
  range: unknown,
): VisibleLogicalRange | null => {
  if (!range || typeof range !== "object") {
    return null;
  }

  const record = range as { from?: unknown; to?: unknown };
  if (!Number.isFinite(record.from) || !Number.isFinite(record.to)) {
    return null;
  }

  return {
    from: record.from as number,
    to: record.to as number,
  };
};

export const buildVisibleRangeSignature = (
  range: VisibleLogicalRange | null | undefined,
): string => {
  const visibleRange = normalizeVisibleLogicalRange(range);
  return visibleRange ? `${visibleRange.from}:${visibleRange.to}` : "none";
};

const visibleLogicalRangesClose = (
  left: VisibleLogicalRange | null | undefined,
  right: VisibleLogicalRange | null | undefined,
  tolerance = 0.001,
): boolean => {
  const normalizedLeft = normalizeVisibleLogicalRange(left);
  const normalizedRight = normalizeVisibleLogicalRange(right);
  if (!normalizedLeft || !normalizedRight) {
    return normalizedLeft === normalizedRight;
  }
  return (
    Math.abs(normalizedLeft.from - normalizedRight.from) <= tolerance &&
    Math.abs(normalizedLeft.to - normalizedRight.to) <= tolerance
  );
};

export const resolveVisibleRangePublishDecision = ({
  lastSignature,
  visibleRange,
}: {
  lastSignature: string | null;
  visibleRange: VisibleLogicalRange | null | undefined;
}): {
  signature: string;
  shouldPublish: boolean;
} => {
  const signature = buildVisibleRangeSignature(visibleRange);
  return {
    signature,
    shouldPublish: lastSignature !== signature,
  };
};

export const shouldPreserveUserViewportRange = ({
  source,
  activeUserTouchedViewport,
  hasRecentProgrammaticIntent,
  currentUserRange,
  nextRange,
}: {
  source: "programmatic" | "user";
  activeUserTouchedViewport: boolean;
  hasRecentProgrammaticIntent: boolean;
  currentUserRange: VisibleLogicalRange | null | undefined;
  nextRange: VisibleLogicalRange | null | undefined;
}): boolean => {
  if (
    source !== "programmatic" ||
    !activeUserTouchedViewport ||
    hasRecentProgrammaticIntent
  ) {
    return false;
  }

  const currentRange = resolveViewportVisibleLogicalRange(currentUserRange);
  const incomingRange = resolveViewportVisibleLogicalRange(nextRange);
  return Boolean(
    currentRange &&
      incomingRange &&
      buildVisibleRangeSignature(currentRange) !==
        buildVisibleRangeSignature(incomingRange),
  );
};

export const resolveVisibleRangeChangeSource = ({
  initialized,
  nextSignature,
  programmaticSignature,
  hasRecentProgrammaticIntent = false,
  hasRecentUserViewportIntent = false,
}: {
  initialized: boolean;
  nextSignature: string;
  programmaticSignature: string | null;
  hasRecentProgrammaticIntent?: boolean;
  hasRecentUserViewportIntent?: boolean;
}): "programmatic" | "user" => {
  if (hasRecentUserViewportIntent) {
    return "user";
  }

  if (
    (programmaticSignature === nextSignature &&
      (hasRecentProgrammaticIntent || !initialized)) ||
    hasRecentProgrammaticIntent
  ) {
    return "programmatic";
  }

  return "programmatic";
};

export const resolvePrependedVisibleLogicalRange = ({
  visibleRange,
  prependCount,
}: {
  visibleRange: VisibleLogicalRange | null | undefined;
  prependCount: number;
}): VisibleLogicalRange | null => {
  const range = normalizeVisibleLogicalRange(visibleRange);
  if (!range || !Number.isFinite(prependCount) || prependCount <= 0) {
    return null;
  }

  return {
    from: range.from + prependCount,
    to: range.to + prependCount,
  };
};

type ChartScalePreferences = {
  scaleMode?: ScaleMode;
  autoScale?: boolean;
  invertScale?: boolean;
};

export type ChartViewportSnapshot = {
  identityKey: string;
  viewportLayoutKey?: string | null;
  visibleLogicalRange: VisibleLogicalRange | null;
  userTouched: boolean;
  realtimeFollow: boolean;
  scaleMode: ScaleMode;
  autoScale: boolean;
  invertScale: boolean;
  updatedAt: number;
};

const STORED_CHART_VIEWPORT_SNAPSHOT_LIMIT = 96;
const STORED_CHART_VIEWPORT_LAYOUT_SEPARATOR = "::viewport-layout::";
const storedChartViewportSnapshots = new Map<string, ChartViewportSnapshot>();

const normalizeChartViewportLayoutKey = (
  value?: string | null,
): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const buildStoredChartViewportSnapshotKey = (
  identityKey: string,
  viewportLayoutKey?: string | null,
): string => {
  const normalizedLayoutKey = normalizeChartViewportLayoutKey(viewportLayoutKey);
  return normalizedLayoutKey
    ? `${identityKey}${STORED_CHART_VIEWPORT_LAYOUT_SEPARATOR}${normalizedLayoutKey}`
    : identityKey;
};

const chartViewportSnapshotMatchesContext = (
  snapshot: ChartViewportSnapshot | null | undefined,
  identityKey: string | null,
  viewportLayoutKey?: string | null,
): snapshot is ChartViewportSnapshot => {
  if (!identityKey || snapshot?.identityKey !== identityKey) {
    return false;
  }

  const expectedLayoutKey = normalizeChartViewportLayoutKey(viewportLayoutKey);
  const snapshotLayoutKey = normalizeChartViewportLayoutKey(
    snapshot.viewportLayoutKey,
  );
  return expectedLayoutKey
    ? snapshotLayoutKey === expectedLayoutKey
    : snapshotLayoutKey === null;
};

export const readStoredChartViewportSnapshot = (
  identityKey?: string | null,
  viewportLayoutKey?: string | null,
): ChartViewportSnapshot | null => {
  if (!identityKey) {
    return null;
  }

  return (
    storedChartViewportSnapshots.get(
      buildStoredChartViewportSnapshotKey(identityKey, viewportLayoutKey),
    ) ?? null
  );
};

export const writeStoredChartViewportSnapshot = (
  snapshot: ChartViewportSnapshot | null | undefined,
): void => {
  if (!snapshot?.identityKey) {
    return;
  }

  const storageKey = buildStoredChartViewportSnapshotKey(
    snapshot.identityKey,
    snapshot.viewportLayoutKey,
  );
  storedChartViewportSnapshots.delete(storageKey);
  storedChartViewportSnapshots.set(storageKey, snapshot);

  while (storedChartViewportSnapshots.size > STORED_CHART_VIEWPORT_SNAPSHOT_LIMIT) {
    const oldestKey = storedChartViewportSnapshots.keys().next().value;
    if (!oldestKey) {
      break;
    }
    storedChartViewportSnapshots.delete(oldestKey);
  }
};

export const clearStoredChartViewportSnapshot = (
  identityKey?: string | null,
  viewportLayoutKey?: string | null,
): void => {
  if (!identityKey) {
    return;
  }

  const normalizedLayoutKey = normalizeChartViewportLayoutKey(viewportLayoutKey);
  if (normalizedLayoutKey) {
    storedChartViewportSnapshots.delete(
      buildStoredChartViewportSnapshotKey(identityKey, normalizedLayoutKey),
    );
    return;
  }

  storedChartViewportSnapshots.delete(identityKey);
  const prefix = `${identityKey}${STORED_CHART_VIEWPORT_LAYOUT_SEPARATOR}`;
  Array.from(storedChartViewportSnapshots.keys()).forEach((key) => {
    if (key.startsWith(prefix)) {
      storedChartViewportSnapshots.delete(key);
    }
  });
};

export const resolveEffectiveChartViewportSnapshot = ({
  identityKey,
  viewportLayoutKey,
  viewportSnapshot,
  useStoredFallback,
}: {
  identityKey: string | null;
  viewportLayoutKey?: string | null;
  viewportSnapshot?: ChartViewportSnapshot | null;
  useStoredFallback: boolean;
}): ChartViewportSnapshot | null => {
  if (
    chartViewportSnapshotMatchesContext(
      viewportSnapshot,
      identityKey,
      viewportLayoutKey,
    )
  ) {
    return viewportSnapshot;
  }

  return useStoredFallback
    ? readStoredChartViewportSnapshot(identityKey, viewportLayoutKey)
    : null;
};

export type ChartLegendOhlcvMeta = {
  open?: number | null;
  high?: number | null;
  low?: number | null;
  close?: number | null;
  volume?: number | null;
  vwap?: number | null;
  sessionVwap?: number | null;
  accumulatedVolume?: number | null;
  averageTradeSize?: number | null;
  timestamp?: string | null;
  sourceLabel?: string | null;
};

export type ChartLegendStudyOption = {
  id: string;
  label: string;
};

export type ChartLegendMetadata = {
  symbol?: string | null;
  name?: string | null;
  timeframe?: string | null;
  statusLabel?: string | null;
  statusTone?: "good" | "warn" | "bad" | "neutral" | "muted" | "info";
  priceLabel?: string | null;
  price?: number | null;
  changePercent?: number | null;
  meta?: ChartLegendOhlcvMeta | null;
  studies?: ChartLegendStudyOption[];
  selectedStudies?: string[];
};

const CHART_SCALE_PREFS_STORAGE_PREFIX = "rayalgo:chart-scale-prefs:";

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
  labelSize?: "tiny" | "small" | "normal";
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

type ChartEventOverlay = {
  id: string;
  left: number;
  top: number;
  label: string;
  title: string;
  eventType?: string;
  source?: string;
  severity?: string;
  symbol?: string;
  tone: "bullish" | "bearish" | "neutral";
  placement: "bar" | "timescale";
  count?: number;
  flowSourceBasis?: string;
  flowBucket?: FlowChartBucket;
  tooltip?: FlowTooltipModel;
};

type FlowVolumeOverlay = {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  title: string;
  tone: "bullish" | "bearish" | "neutral";
  flowSourceBasis: string;
  segments: Array<{
    tone: "bullish" | "bearish" | "neutral";
    ratio: number;
    premium: number;
  }>;
  flowBucket: FlowChartBucket;
  tooltip: FlowTooltipModel;
};

type FlowTooltipState = {
  id: string;
  left: number;
  top: number;
  model: FlowTooltipModel;
};

const resolveFlowToneColor = (
  tone: ChartEventOverlay["tone"],
  theme: ResearchChartTheme,
): string =>
  tone === "bullish" ? theme.green : tone === "bearish" ? theme.red : theme.amber;

const resolveChartEventToneColor = (
  overlay: ChartEventOverlay,
  theme: ResearchChartTheme,
): string => {
  if (overlay.eventType === "unusual_flow") {
    return resolveFlowToneColor(overlay.tone, theme);
  }

  if (overlay.tone === "bullish") return theme.green;
  if (overlay.tone === "bearish") return theme.red;
  if (overlay.placement === "timescale") return theme.amber;
  return theme.accent || theme.text;
};

const FLOW_TOOLTIP_WIDTH = 248;
const FLOW_TOOLTIP_ESTIMATED_HEIGHT = 232;
const FLOW_TOOLTIP_HIDE_DELAY_MS = 120;

type FlowTooltipStatCell = {
  label: string;
  value: string;
  required?: boolean;
};

const flowTooltipHasValue = (value: string | number | null | undefined): boolean => {
  const normalized = String(value ?? "").trim().toLowerCase();
  return Boolean(normalized && normalized !== "n/a" && normalized !== "nan");
};

const buildFlowTooltipStatCells = (
  model: FlowTooltipModel,
): FlowTooltipStatCell[] =>
  [
    { label: "Prem", value: model.premium, required: true },
    { label: "Events", value: String(model.eventCount), required: true },
    { label: "Contracts", value: model.contracts, required: true },
    { label: "OI", value: model.openInterest },
    { label: "C/P", value: model.callPutMix, required: true },
    { label: "Bias", value: model.sentiment, required: true },
    { label: "Basis", value: model.biasBasis },
    { label: "Side", value: model.side },
    { label: "Conf", value: model.sideConfidence },
    { label: "DTE", value: model.dte },
    { label: "IV", value: model.iv },
    { label: "Delta", value: model.delta },
    { label: "Score", value: model.unusualScore },
    { label: "Fill", value: model.price },
    { label: "Bid/Ask", value: model.bidAsk },
    { label: "Mny", value: model.moneyness },
    { label: "Dist", value: model.distance },
  ].filter((cell) => cell.required || flowTooltipHasValue(cell.value));

const FLOW_TOOLTIP_SCALAR_KEYS: Array<Exclude<keyof FlowTooltipModel, "tags">> = [
  "title",
  "summary",
  "tone",
  "premium",
  "contracts",
  "callPutMix",
  "flowMix",
  "callPercent",
  "putPercent",
  "bullishPercent",
  "bearishPercent",
  "neutralPercent",
  "topContract",
  "copyLabel",
  "sourceLabel",
  "timeBasis",
  "side",
  "biasBasis",
  "sideConfidence",
  "price",
  "bidAsk",
  "openInterest",
  "dte",
  "iv",
  "delta",
  "unusualScore",
  "moneyness",
  "distance",
  "sentiment",
  "intensity",
  "eventCount",
];

export type ChartLegendStudyItem = {
  id: string;
  label: string;
  colors: string[];
  values: number[];
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
const VOLUME_SCALE_TOP_MARGIN = 0.78;

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

export type IndicatorDashboardStripTier = "micro" | "compact" | "full";

export const resolveDashboardStripTier = (
  plotWidth: number,
  compact: boolean,
): IndicatorDashboardStripTier => {
  if (Number.isFinite(plotWidth) && plotWidth > 0) {
    if (plotWidth <= 360) {
      return "micro";
    }
    if (plotWidth <= 520) {
      return "compact";
    }
    return "full";
  }

  return compact ? "micro" : "full";
};

function resolveDashboardDensity(
  size: IndicatorDashboardOverlay["size"],
  compact: boolean,
  tier: IndicatorDashboardStripTier,
) {
  if (tier === "micro") {
    return {
      maxWidth: "calc(100% - 16px)",
      height: 20,
      padding: "2px 5px",
      segmentPadding: "0",
      titleSize: 8,
      subtitleSize: 8,
      bodySize: 8,
      detailSize: 8,
      gap: 4,
      segmentMaxWidth: 52,
    };
  }

  if (tier === "compact") {
    return {
      maxWidth: "calc(100% - 18px)",
      height: 22,
      padding: "3px 6px",
      segmentPadding: "0 1px",
      titleSize: 8,
      subtitleSize: 8,
      bodySize: 8,
      detailSize: 8,
      gap: 5,
      segmentMaxWidth: 96,
    };
  }

  if (compact) {
    return {
      maxWidth: "calc(100% - 16px)",
      height: 22,
      padding: "3px 6px",
      segmentPadding: "0 1px",
      titleSize: 8,
      subtitleSize: 7,
      bodySize: 8,
      detailSize: 7,
      gap: 5,
      segmentMaxWidth: 104,
    };
  }

  if (size === "expanded" || size === "large" || size === "normal") {
    return {
      maxWidth: "min(860px, calc(100% - 24px))",
      height: 26,
      padding: "4px 7px",
      segmentPadding: "0 2px",
      titleSize: 10,
      subtitleSize: 9,
      bodySize: 10,
      detailSize: 9,
      gap: 7,
      segmentMaxWidth: 160,
    };
  }

  return {
    maxWidth: "min(760px, calc(100% - 24px))",
    height: 24,
    padding: "3px 6px",
    segmentPadding: "0 2px",
    titleSize: 8,
    subtitleSize: 7,
    bodySize: 8,
    detailSize: 7,
    gap: 6,
    segmentMaxWidth: 132,
  };
}

export type IndicatorDashboardStripSegment = {
  key: string;
  kind: "title" | "subtitle" | "trend" | "row" | "mtf";
  label?: string;
  value: string;
  color?: string;
  detail?: string;
  title?: string;
};

const normalizeDashboardStripText = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const formatDashboardTitle = (value: string): string => {
  const normalized = value.replace(/\s+dashboard$/i, "").trim();
  if (/^rayalgo$/i.test(normalized)) {
    return "RayAlgo";
  }
  if (/^rayreplica$/i.test(normalized)) {
    return "RayReplica";
  }
  return normalized || value;
};

const formatDashboardTimeframeLabel = (value: string): string => {
  const normalized = value.replace(/\s+trend$/i, "").trim();
  const upper = normalized.toUpperCase();
  const minuteMatch = upper.match(/^(\d+)M$/);
  if (minuteMatch) {
    return `${minuteMatch[1]}m`;
  }
  const hourMatch = upper.match(/^H(\d+)$/);
  if (hourMatch) {
    return `${hourMatch[1]}h`;
  }
  const trailingHourMatch = upper.match(/^(\d+)H$/);
  if (trailingHourMatch) {
    return `${trailingHourMatch[1]}h`;
  }
  const dayMatch = upper.match(/^D(\d*)$/);
  if (dayMatch) {
    return `${dayMatch[1] || "1"}d`;
  }
  const trailingDayMatch = upper.match(/^(\d+)D$/);
  if (trailingDayMatch) {
    return `${trailingDayMatch[1]}d`;
  }
  const weekMatch = upper.match(/^W(\d*)$/);
  if (weekMatch) {
    return `${weekMatch[1] || "1"}w`;
  }
  const trailingWeekMatch = upper.match(/^(\d+)W$/);
  if (trailingWeekMatch) {
    return `${trailingWeekMatch[1]}w`;
  }
  return normalized || value;
};

const compactTrendValue = (value: string): string => {
  const normalized = value.trim().toUpperCase();
  if (normalized === "BULLISH" || normalized === "BULL") {
    return "BULL";
  }
  if (normalized === "BEARISH" || normalized === "BEAR") {
    return "BEAR";
  }
  return normalized || value;
};

const compactDirectionValue = (value: string): string => {
  const normalized = compactTrendValue(value);
  if (normalized === "BULL") {
    return "B";
  }
  if (normalized === "BEAR") {
    return "S";
  }
  return normalized.slice(0, 1) || value.slice(0, 1).toUpperCase();
};

const compactStrengthValue = (value: string): string => {
  const normalized = value.trim().toUpperCase();
  if (normalized === "STRONG") {
    return "STR";
  }
  if (normalized === "WEAK") {
    return "WEAK";
  }
  return normalized || value;
};

const compactTrendAgeValue = (value: string): string => {
  const match = value.trim().match(/^([a-z]+)\s*\((\d+)\)/i);
  if (!match) {
    return value.trim().toUpperCase();
  }

  return `${match[1].charAt(0).toUpperCase()}${match[2]}`;
};

const compactVolatilityValue = (value: string): string => {
  const match = value.trim().match(/^([^/]+)\s*\/\s*10$/);
  if (!match) {
    return value.trim().toUpperCase();
  }

  return `V${match[1].trim() || "--"}`;
};

const compactSessionValue = (value: string): string => {
  const normalized = value.trim().toLowerCase();
  const upper = value.trim().toUpperCase();
  if (upper === "PRE" || upper === "RTH" || upper === "AFT" || upper === "CLSD") {
    return upper;
  }
  if (normalized === "new york") {
    return "NY";
  }
  if (normalized === "london") {
    return "LDN";
  }
  if (normalized === "tokyo") {
    return "TKY";
  }
  if (normalized === "sydney") {
    return "SYD";
  }
  if (normalized === "closed") {
    return "CLSD";
  }

  const initials = value
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
  return initials || value.trim().slice(0, 4).toUpperCase();
};

const formatDashboardRowForTier = (
  row: { label: string; value: string; color?: string; detail?: string },
  tier: IndicatorDashboardStripTier,
) => {
  const label = normalizeDashboardStripText(row.label);
  const value = normalizeDashboardStripText(row.value);
  const detail = normalizeDashboardStripText(row.detail);
  const upperLabel = label.toUpperCase();

  if (upperLabel === "STRENGTH") {
    return {
      label: "",
      value:
        tier === "full"
          ? value.trim().toUpperCase()
          : compactStrengthValue(value),
      detail: "",
    };
  }

  if (upperLabel === "TREND AGE") {
    return {
      label: "",
      value: compactTrendAgeValue(value),
      detail: "",
    };
  }

  if (upperLabel === "VOLATILITY") {
    return {
      label: "",
      value: compactVolatilityValue(value),
      detail: "",
    };
  }

  if (upperLabel === "SESSION") {
    return {
      label: "",
      value: compactSessionValue(value),
      detail: "",
    };
  }

  return {
    label: tier === "micro" ? "" : label,
    value,
    detail: tier === "full" ? detail : "",
  };
};

export const buildIndicatorDashboardStripSegments = (dashboard: {
  id: string;
  title: string;
  subtitle?: string;
  trendLabel: string;
  trendValue: string;
  trendColor: string;
  rows: Array<{ label: string; value: string; color?: string; detail?: string }>;
  mtf: Array<{ label: string; value: string; color: string; detail?: string }>;
}, tier: IndicatorDashboardStripTier = "full"): IndicatorDashboardStripSegment[] => {
  const segments: IndicatorDashboardStripSegment[] = [];
  const title = normalizeDashboardStripText(dashboard.title);
  const trendLabel = normalizeDashboardStripText(dashboard.trendLabel);
  const trendValue = normalizeDashboardStripText(dashboard.trendValue);
  const shortTrendValue = compactTrendValue(trendValue);

  if (title) {
    segments.push({
      key: `${dashboard.id}-title`,
      kind: "title",
      value: tier === "full" ? formatDashboardTitle(title) : "RA",
      title,
    });
  }

  if (trendLabel || trendValue) {
    const formattedTrendLabel = formatDashboardTimeframeLabel(trendLabel);
    segments.push({
      key: `${dashboard.id}-trend`,
      kind: "trend",
      label: formattedTrendLabel,
      value: shortTrendValue,
      color: dashboard.trendColor,
      title: [trendLabel, trendValue].filter(Boolean).join(" "),
    });
  }

  dashboard.rows.forEach((row, index) => {
    const rawLabel = normalizeDashboardStripText(row.label);
    if (tier === "micro" && rawLabel.toUpperCase() !== "SESSION") {
      return;
    }
    const formatted = formatDashboardRowForTier(row, tier);
    const label = formatted.label;
    const value = formatted.value;
    const detail = formatted.detail;
    const fullTitle = [
      normalizeDashboardStripText(row.label),
      normalizeDashboardStripText(row.value),
      normalizeDashboardStripText(row.detail),
    ]
      .filter(Boolean)
      .join(" ");
    if (!label && !value && !detail) {
      return;
    }
    segments.push({
      key: `${dashboard.id}-row-${index}-${label || value || "item"}`,
      kind: "row",
      label,
      value,
      color: row.color,
      detail,
      title: fullTitle,
    });
  });

  dashboard.mtf.forEach((item, index) => {
    const label = formatDashboardTimeframeLabel(
      normalizeDashboardStripText(item.label),
    );
    const value = normalizeDashboardStripText(item.value);
    const detail = normalizeDashboardStripText(item.detail);
    const formattedValue = compactDirectionValue(value);
    const formattedLabel = label;
    if (!formattedLabel && !formattedValue && !detail) {
      return;
    }
    segments.push({
      key: `${dashboard.id}-mtf-${index}-${label || value || "item"}`,
      kind: "mtf",
      label: formattedLabel,
      value: formattedValue,
      color: item.color,
      detail: tier === "full" ? detail : "",
      title: [label, value, detail].filter(Boolean).join(" "),
    });
  });

  return segments;
};

export const resolveDashboardStripAnchorStyle = (
  compact: boolean,
  bottomOffset = 0,
  leftOffset = 0,
) => ({
  left: leftOffset + (compact ? 4 : 8),
  right: compact ? 4 : 8,
  bottom: bottomOffset + (compact ? 2 : 3),
});

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
  uiStateKey?: string;
  rangeIdentityKey?: string | null;
  viewportLayoutKey?: string | null;
  dataTestId?: string;
  compact?: boolean;
  showToolbar?: boolean;
  showLegend?: boolean;
  legend?: ChartLegendMetadata | null;
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
  chartEvents?: ChartEvent[];
  chartFlowDiagnostics?: FlowChartEventConversion | null;
  latestQuotePrice?: number | null;
  latestQuoteUpdatedAt?: string | Date | number | null;
  emptyState?: {
    title?: string | null;
    detail?: string | null;
    eyebrow?: string | null;
  } | null;
  drawMode?: DrawMode | null;
  onAddDrawing?: (drawing: ResearchDrawing) => void;
  onAddHorizontalLevel?: (price: number) => void;
  onTradeMarkerSelection?: (tradeSelectionIds: string[]) => void;
  onVisibleLogicalRangeChange?: (range: VisibleLogicalRange | null) => void;
  viewportSnapshot?: ChartViewportSnapshot | null;
  externalViewportUserTouched?: boolean;
  onViewportSnapshotChange?: (snapshot: ChartViewportSnapshot) => void;
  persistScalePrefs?: boolean;
};

const EMPTY_DRAWINGS: ResearchDrawing[] = [];
const EMPTY_REFERENCE_LINES: Array<{
  price: number;
  color?: string;
  title?: string;
  lineWidth?: number;
  axisLabelVisible?: boolean;
}> = [];
const EMPTY_CHART_EVENTS: ChartEvent[] = [];
const EMPTY_LEGEND_STUDIES: ChartLegendStudyOption[] = [];
const EMPTY_SELECTED_LEGEND_STUDIES: string[] = [];

export const resolveVisibleChartEvents = ({
  chartEvents = EMPTY_CHART_EVENTS,
  showExecutionMarkers: _showExecutionMarkers = true,
}: {
  chartEvents?: ChartEvent[] | null;
  showExecutionMarkers?: boolean;
} = {}): ChartEvent[] =>
  Array.isArray(chartEvents) ? chartEvents : EMPTY_CHART_EVENTS;

type StudyRegistryEntry = {
  paneIndex: number;
  seriesType: StudySpec["seriesType"];
  series: any;
  data: Array<Record<string, unknown>>;
};

const resolveSeriesTimeComparable = (time: unknown): number | string | null => {
  if (typeof time === "number" && Number.isFinite(time)) {
    return time;
  }
  if (typeof time === "string" && time.trim()) {
    return time;
  }
  if (!time || typeof time !== "object") {
    return null;
  }

  const record = time as Record<string, unknown>;
  const year = record.year;
  const month = record.month;
  const day = record.day;
  if (
    Number.isInteger(year) &&
    Number.isInteger(month) &&
    Number.isInteger(day)
  ) {
    return `${String(year).padStart(4, "0")}-${String(month).padStart(
      2,
      "0",
    )}-${String(day).padStart(2, "0")}`;
  }

  try {
    return JSON.stringify(record);
  } catch (_error) {
    return null;
  }
};

const seriesTimesEqual = (left: unknown, right: unknown): boolean => {
  if (left === right) {
    return true;
  }

  const leftComparable = resolveSeriesTimeComparable(left);
  const rightComparable = resolveSeriesTimeComparable(right);
  return (
    leftComparable !== null &&
    rightComparable !== null &&
    leftComparable === rightComparable
  );
};

const compareSeriesTimes = (left: unknown, right: unknown): number | null => {
  const leftComparable = resolveSeriesTimeComparable(left);
  const rightComparable = resolveSeriesTimeComparable(right);
  if (leftComparable === null || rightComparable === null) {
    return null;
  }
  if (
    typeof leftComparable === "number" &&
    typeof rightComparable === "number"
  ) {
    return leftComparable - rightComparable;
  }

  return String(leftComparable).localeCompare(String(rightComparable));
};

const seriesDataPointsEqual = (
  left: Record<string, unknown> | undefined,
  right: Record<string, unknown> | undefined,
): boolean => {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }

  const keys = new Set([
    ...Object.keys(left),
    ...Object.keys(right),
  ]);
  for (const key of keys) {
    if (key === "time") {
      if (!seriesTimesEqual(left[key], right[key])) {
        return false;
      }
      continue;
    }
    if (left[key] !== right[key]) {
      return false;
    }
  }

  return true;
};

type SeriesTailUpdateMode = "noop" | "patch" | "append" | "reset";
type SeriesTailResetReason =
  | "empty-next"
  | "initial-load"
  | "time-sequence-changed"
  | "interior-point-changed"
  | "tail-whitespace-shape-changed"
  | "non-increasing-append-time"
  | "shorter-series"
  | "tail-update-rejected";

type SeriesTailUpdatePlan = {
  mode: SeriesTailUpdateMode;
  startIndex: number;
  resetReason?: SeriesTailResetReason;
};

type SeriesSyncModeReporter = (
  mode: "patch" | "append" | "reset",
  delta: number,
  detail?: {
    seriesName?: string;
    resetReason?: SeriesTailResetReason;
  },
) => void;

const buildSeriesResetPlan = (
  resetReason: SeriesTailResetReason,
): SeriesTailUpdatePlan => ({
  mode: "reset",
  startIndex: 0,
  resetReason,
});

const buildSeriesTailUpdatePlan = (
  previous: Array<Record<string, unknown>>,
  next: Array<Record<string, unknown>>,
): SeriesTailUpdatePlan => {
  if (previous === next) {
    return { mode: "noop", startIndex: next.length };
  }

  if (!next.length) {
    return previous.length
      ? buildSeriesResetPlan("empty-next")
      : { mode: "noop", startIndex: 0 };
  }

  if (!previous.length) {
    return buildSeriesResetPlan("initial-load");
  }

  if (next.length === previous.length) {
    let tailChanged = false;
    for (let index = 0; index < previous.length; index += 1) {
      if (!seriesTimesEqual(previous[index]?.time, next[index]?.time)) {
        return buildSeriesResetPlan("time-sequence-changed");
      }
      if (!seriesDataPointsEqual(previous[index], next[index])) {
        if (index !== previous.length - 1) {
          return buildSeriesResetPlan("interior-point-changed");
        }
        tailChanged = true;
      }
    }

    return tailChanged
      ? { mode: "patch", startIndex: previous.length - 1 }
      : { mode: "noop", startIndex: next.length };
  }

  if (next.length > previous.length) {
    let startIndex = previous.length;
    for (let index = 0; index < previous.length; index += 1) {
      if (seriesDataPointsEqual(previous[index], next[index])) {
        continue;
      }

      if (
        index === previous.length - 1 &&
        seriesTimesEqual(previous[index]?.time, next[index]?.time)
      ) {
        startIndex = index;
        continue;
      }

      return buildSeriesResetPlan(
        seriesTimesEqual(previous[index]?.time, next[index]?.time)
          ? "interior-point-changed"
          : "time-sequence-changed",
      );
    }

    if (startIndex === previous.length - 1) {
      const tailWhitespaceChanged =
        Object.prototype.hasOwnProperty.call(previous[startIndex], "value") !==
        Object.prototype.hasOwnProperty.call(next[startIndex], "value");
      if (tailWhitespaceChanged) {
        return buildSeriesResetPlan("tail-whitespace-shape-changed");
      }
    }

    for (
      let index = Math.max(previous.length, startIndex + 1);
      index < next.length;
      index += 1
    ) {
      const timeComparison = compareSeriesTimes(
        next[index]?.time,
        next[index - 1]?.time,
      );
      if (timeComparison === null || timeComparison <= 0) {
        return buildSeriesResetPlan("non-increasing-append-time");
      }
    }

    if (startIndex === previous.length) {
      const tailTimeComparison = compareSeriesTimes(
        next[startIndex]?.time,
        previous[previous.length - 1]?.time,
      );
      if (tailTimeComparison === null || tailTimeComparison <= 0) {
        return buildSeriesResetPlan("non-increasing-append-time");
      }
    }

    return { mode: "append", startIndex };
  }

  return buildSeriesResetPlan("shorter-series");
};

export const resolveSeriesTailUpdateMode = (
  previous: Array<Record<string, unknown>>,
  next: Array<Record<string, unknown>>,
): SeriesTailUpdateMode => {
  return buildSeriesTailUpdatePlan(previous, next).mode;
};

export const resolveSeriesTailUpdateResetReason = (
  previous: Array<Record<string, unknown>>,
  next: Array<Record<string, unknown>>,
): SeriesTailResetReason | null => {
  return buildSeriesTailUpdatePlan(previous, next).resetReason ?? null;
};

const canUpdateSeriesTail = (
  previousPoint: Record<string, unknown> | undefined,
  nextPoint: Record<string, unknown> | undefined,
  updateMode: "patch" | "append",
): boolean => {
  if (!nextPoint) {
    return false;
  }
  if (updateMode === "patch") {
    return seriesTimesEqual(previousPoint?.time, nextPoint.time);
  }

  const tailTimeComparison = compareSeriesTimes(
    nextPoint.time,
    previousPoint?.time,
  );
  return tailTimeComparison !== null && tailTimeComparison > 0;
};

export const resolveVisibleRangeSyncAction = ({
  hasStoredRange,
  hasDefaultRange,
  initialized,
  pendingStoredRangeSync,
}: {
  hasStoredRange: boolean;
  hasDefaultRange: boolean;
  initialized: boolean;
  pendingStoredRangeSync: boolean;
}): "stored" | "default" | "fit" | "noop" => {
  if (hasStoredRange && (pendingStoredRangeSync || !initialized)) {
    return "stored";
  }

  if (!initialized && hasDefaultRange) {
    return "default";
  }

  if (!initialized) {
    return "fit";
  }

  return "noop";
};

export const DEFAULT_REALTIME_FOLLOW_TOLERANCE = 3;
const USER_VIEWPORT_INTENT_WINDOW_MS = 750;
const LOCAL_VIEWPORT_TOUCH_SYNC_GRACE_MS = 15_000;
const PROGRAMMATIC_VIEWPORT_INTENT_WINDOW_MS = 750;
const PLOT_RESIZE_VIEWPORT_INTENT_WINDOW_MS = 500;
const CHART_PLOT_PAN_MOVE_TOLERANCE = 6;

type ChartPlotPanState = {
  pointerId: number;
  startX: number;
  startY: number;
  startRange: VisibleLogicalRange;
  plotWidth: number;
  active: boolean;
};

export const isPointInsideRect = ({
  x,
  y,
  rect,
}: {
  x: number;
  y: number;
  rect: Pick<DOMRect, "left" | "right" | "top" | "bottom">;
}): boolean =>
  x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

export const isPointInsideRightPriceScale = ({
  x,
  y,
  rect,
  priceScaleWidth,
}: {
  x: number;
  y: number;
  rect: Pick<DOMRect, "left" | "right" | "top" | "bottom">;
  priceScaleWidth: number;
}): boolean =>
  priceScaleWidth > 0 &&
  x >= rect.right - priceScaleWidth &&
  x <= rect.right &&
  y >= rect.top &&
  y <= rect.bottom;

const isChartControlEventTarget = (target: EventTarget | null): boolean =>
  typeof Element !== "undefined" &&
  target instanceof Element &&
  Boolean(
    target.closest(
      "[data-chart-control-root], [data-radix-popper-content-wrapper]",
    ),
  );

export const resolveChartPlotPanStart = ({
  pointerId,
  startX,
  startY,
  currentRange,
  plotWidth,
  enabled,
  drawMode,
  button,
  insidePlot,
  insideRightPriceScale,
}: {
  pointerId: number;
  startX: number;
  startY: number;
  currentRange: VisibleLogicalRange | null | undefined;
  plotWidth: number;
  enabled: boolean;
  drawMode: DrawMode | null | undefined;
  button: number;
  insidePlot: boolean;
  insideRightPriceScale: boolean;
}): ChartPlotPanState | null => {
  if (
    !enabled ||
    drawMode ||
    button !== 0 ||
    !insidePlot ||
    insideRightPriceScale
  ) {
    return null;
  }

  const startRange = resolveViewportVisibleLogicalRange(currentRange);
  if (!startRange) {
    return null;
  }

  return {
    pointerId,
    startX,
    startY,
    startRange,
    plotWidth: Math.max(1, plotWidth),
    active: false,
  };
};

export const resolveChartPlotPanRange = ({
  pan,
  clientX,
  clientY,
  moveTolerance = CHART_PLOT_PAN_MOVE_TOLERANCE,
}: {
  pan: ChartPlotPanState | null | undefined;
  clientX: number;
  clientY: number;
  moveTolerance?: number;
}): { pan: ChartPlotPanState; visibleRange: VisibleLogicalRange } | null => {
  if (!pan) {
    return null;
  }

  const deltaX = clientX - pan.startX;
  const deltaY = clientY - pan.startY;
  if (!pan.active && Math.hypot(deltaX, deltaY) <= moveTolerance) {
    return null;
  }

  const span = Math.max(1, pan.startRange.to - pan.startRange.from);
  const barsDelta = -(deltaX / Math.max(1, pan.plotWidth)) * span;
  return {
    pan: {
      ...pan,
      active: true,
    },
    visibleRange: {
      from: pan.startRange.from + barsDelta,
      to: pan.startRange.to + barsDelta,
    },
  };
};

export const resolveZoomedVisibleRange = ({
  currentRange,
  factor,
  minimumHalfRange = 4,
}: {
  currentRange: VisibleLogicalRange | null | undefined;
  factor: number;
  minimumHalfRange?: number;
}): VisibleLogicalRange | null => {
  const range = resolveViewportVisibleLogicalRange(currentRange);
  if (!range || !Number.isFinite(factor) || factor <= 0) {
    return null;
  }

  const center = (range.from + range.to) / 2;
  const halfRange = Math.max(
    minimumHalfRange,
    ((range.to - range.from) / 2) * factor,
  );
  return {
    from: center - halfRange,
    to: center + halfRange,
  };
};

export const isVisibleRangeNearRealtime = ({
  visibleRange,
  barCount,
  tolerance = DEFAULT_REALTIME_FOLLOW_TOLERANCE,
}: {
  visibleRange: VisibleLogicalRange | null | undefined;
  barCount: number;
  tolerance?: number;
}): boolean => {
  if (
    !visibleRange ||
    !Number.isFinite(visibleRange.to) ||
    !Number.isFinite(barCount) ||
    barCount <= 0
  ) {
    return false;
  }

  return visibleRange.to >= barCount - 1 - Math.max(0, tolerance);
};

export const resolveVisibleRangePublishState = ({
  range,
  barCount,
  source = "programmatic",
}: {
  range: unknown;
  barCount: number;
  source?: "programmatic" | "user";
}): {
  visibleRange: VisibleLogicalRange | null;
  realtimeFollow: boolean;
} => {
  const visibleRange = normalizeVisibleLogicalRange(range);
  return {
    visibleRange,
    realtimeFollow:
      source === "user"
        ? false
        : isVisibleRangeNearRealtime({
            visibleRange,
            barCount,
          }),
  };
};

export const clampVisibleLogicalRangeToBarCount = (
  visibleRange: VisibleLogicalRange | null | undefined,
  barCount: number,
): VisibleLogicalRange | null => {
  if (
    !visibleRange ||
    !Number.isFinite(visibleRange.from) ||
    !Number.isFinite(visibleRange.to) ||
    !Number.isFinite(barCount) ||
    barCount <= 0
  ) {
    return null;
  }

  const from = Math.min(visibleRange.from, visibleRange.to);
  const to = Math.max(visibleRange.from, visibleRange.to);
  if (to < 0 || from > barCount - 1) {
    return null;
  }

  return {
    from: Math.max(0, from),
    to: Math.min(barCount - 1, to),
  };
};

export const resolveViewportVisibleLogicalRange = (
  visibleRange: VisibleLogicalRange | null | undefined,
): VisibleLogicalRange | null => {
  const normalizedRange = normalizeVisibleLogicalRange(visibleRange);
  if (!normalizedRange) {
    return null;
  }

  return {
    from: Math.min(normalizedRange.from, normalizedRange.to),
    to: Math.max(normalizedRange.from, normalizedRange.to),
  };
};

export const resolveViewportRestoreState = ({
  identityKey,
  viewportLayoutKey,
  viewportSnapshot,
  storedScalePrefs = {},
  defaultScaleMode,
  barCount: _barCount,
}: {
  identityKey: string | null;
  viewportLayoutKey?: string | null;
  viewportSnapshot?: ChartViewportSnapshot | null;
  storedScalePrefs?: ChartScalePreferences;
  defaultScaleMode: ScaleMode;
  barCount: number;
}): {
  matchingSnapshot: ChartViewportSnapshot | null;
  visibleLogicalRange: VisibleLogicalRange | null;
  realtimeFollow: boolean;
  autoHydration: boolean;
  scaleMode: ScaleMode;
  autoScale: boolean;
  invertScale: boolean;
} => {
  const matchingSnapshot = chartViewportSnapshotMatchesContext(
    viewportSnapshot,
    identityKey,
    viewportLayoutKey,
  )
    ? viewportSnapshot
    : null;
  const visibleLogicalRange =
    matchingSnapshot?.userTouched
      ? resolveViewportVisibleLogicalRange(matchingSnapshot.visibleLogicalRange)
      : null;

  return {
    matchingSnapshot,
    visibleLogicalRange,
    realtimeFollow: matchingSnapshot?.userTouched
      ? false
      : matchingSnapshot?.realtimeFollow ?? true,
    autoHydration: !visibleLogicalRange,
    scaleMode:
      matchingSnapshot?.scaleMode ??
      storedScalePrefs.scaleMode ??
      defaultScaleMode,
    autoScale: matchingSnapshot?.autoScale ?? storedScalePrefs.autoScale ?? true,
    invertScale:
      matchingSnapshot?.invertScale ?? storedScalePrefs.invertScale ?? false,
  };
};

export const resolveAutoHydrationVisibleRange = ({
  barCount,
  defaultVisibleRange,
}: {
  barCount: number;
  defaultVisibleRange: VisibleLogicalRange | null | undefined;
}): VisibleLogicalRange | null => {
  const visibleRange = normalizeVisibleLogicalRange(defaultVisibleRange);
  if (
    !visibleRange ||
    !Number.isFinite(barCount) ||
    barCount <= 0 ||
    visibleRange.to < visibleRange.from
  ) {
    return null;
  }

  const to = Math.max(0, Math.floor(barCount) - 1);
  const span = Math.max(0, visibleRange.to - visibleRange.from);
  return {
    from: Math.max(0, to - span),
    to,
  };
};

export const shouldAutoFollowLatestBars = ({
  realtimeFollow,
  visibleRange,
  previousBarCount,
  nextBarCount,
  tolerance = DEFAULT_REALTIME_FOLLOW_TOLERANCE,
}: {
  realtimeFollow: boolean;
  visibleRange: VisibleLogicalRange | null | undefined;
  previousBarCount: number;
  nextBarCount: number;
  tolerance?: number;
}): boolean =>
  Boolean(
    realtimeFollow &&
      nextBarCount >= previousBarCount &&
      isVisibleRangeNearRealtime({
        visibleRange,
        barCount: Math.max(previousBarCount, 1),
        tolerance,
      }),
  );

export const shouldApplyProgrammaticRangeSync = ({
  interactionActive,
  realtimeFollow: _realtimeFollow,
  followLatestBars: _followLatestBars,
}: {
  interactionActive: boolean;
  realtimeFollow: boolean;
  followLatestBars?: boolean;
}): boolean => {
  return !interactionActive;
};

export const sanitizeStoredChartScalePrefs = (
  value: unknown,
): ChartScalePreferences => {
  if (!value || typeof value !== "object") {
    return {};
  }

  const record = value as Record<string, unknown>;
  const next: ChartScalePreferences = {};
  if (
    record.scaleMode === "linear" ||
    record.scaleMode === "log" ||
    record.scaleMode === "percentage" ||
    record.scaleMode === "indexed"
  ) {
    next.scaleMode = record.scaleMode;
  }
  if (typeof record.autoScale === "boolean") {
    next.autoScale = record.autoScale;
  }
  if (typeof record.invertScale === "boolean") {
    next.invertScale = record.invertScale;
  }

  return next;
};

const buildChartScalePrefsStorageKey = (
  uiStateKey?: string | null,
): string | null =>
  uiStateKey ? `${CHART_SCALE_PREFS_STORAGE_PREFIX}${uiStateKey}` : null;

const readStoredChartScalePrefs = (
  uiStateKey?: string | null,
): ChartScalePreferences => {
  if (typeof window === "undefined") {
    return {};
  }

  const storageKey = buildChartScalePrefsStorageKey(uiStateKey);
  if (!storageKey) {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return {};
    }

    return sanitizeStoredChartScalePrefs(JSON.parse(raw));
  } catch (_error) {
    return {};
  }
};

const writeStoredChartScalePrefs = (
  uiStateKey?: string | null,
  prefs?: ChartScalePreferences,
): void => {
  if (typeof window === "undefined") {
    return;
  }

  const storageKey = buildChartScalePrefsStorageKey(uiStateKey);
  if (!storageKey || !prefs) {
    return;
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(prefs));
  } catch (_error) {}
};

const syncSeriesData = (
  series: any,
  previous: Array<Record<string, unknown>>,
  next: Array<Record<string, unknown>>,
  instrumentationScope?: string | null,
  reportMode?: SeriesSyncModeReporter,
  seriesName = "series",
): Array<Record<string, unknown>> => {
  const updatePlan = buildSeriesTailUpdatePlan(previous, next);
  let resetReason = updatePlan.resetReason;

  if (updatePlan.mode === "noop") {
    return previous;
  }

  if (updatePlan.mode === "patch" || updatePlan.mode === "append") {
    try {
      for (let index = updatePlan.startIndex; index < next.length; index += 1) {
        const nextPoint = next[index];
        const previousPoint =
          index < previous.length ? previous[index] : next[index - 1];
        const pointUpdateMode = index < previous.length ? "patch" : "append";
        const tailWhitespaceChanged =
          Boolean(previousPoint) &&
          Boolean(nextPoint) &&
          Object.prototype.hasOwnProperty.call(previousPoint, "value") !==
            Object.prototype.hasOwnProperty.call(nextPoint, "value");

        if (
          !nextPoint ||
          tailWhitespaceChanged ||
          !canUpdateSeriesTail(previousPoint, nextPoint, pointUpdateMode)
        ) {
          resetReason = tailWhitespaceChanged
            ? "tail-whitespace-shape-changed"
            : "tail-update-rejected";
          throw new Error("Series tail update is not applicable.");
        }

        series.update(nextPoint);
      }
      recordChartHydrationCounter(
        updatePlan.mode === "patch" ? "seriesTailPatch" : "seriesTailAppend",
        instrumentationScope,
        Math.max(1, next.length - updatePlan.startIndex),
      );
      reportMode?.(
        updatePlan.mode,
        Math.max(1, next.length - updatePlan.startIndex),
      );
      return next;
    } catch (_error) {
      // Timeframe changes and provider backfills can replace the visible time
      // sequence while preserving array length. Lightweight Charts rejects
      // non-tail updates, so recover with a full reset instead of surfacing a
      // runtime overlay.
    }
  }

  recordChartHydrationCounter("seriesFullReset", instrumentationScope);
  reportMode?.("reset", next.length, {
    seriesName,
    resetReason: resetReason ?? "tail-update-rejected",
  });
  series.setData(next);
  return next;
};

const nowMs = (): number =>
  typeof performance !== "undefined" && Number.isFinite(performance.now())
    ? performance.now()
    : Date.now();

const hoverBarsEqual = (
  left: HoverBar | null,
  right: HoverBar | null,
): boolean => (
  left === right ||
  Boolean(
    left &&
      right &&
      left.index === right.index &&
      left.time === right.time &&
      left.volume === right.volume &&
      left.accumulatedVolume === right.accumulatedVolume &&
      left.vwap === right.vwap &&
      left.sessionVwap === right.sessionVwap &&
      left.averageTradeSize === right.averageTradeSize &&
      left.source === right.source &&
      left.previousClose === right.previousClose &&
      left.open === right.open &&
      left.high === right.high &&
      left.low === right.low &&
      left.close === right.close
  )
);

export const expandStudySpecsForRender = (specs: StudySpec[]): StudySpec[] =>
  specs.flatMap((spec) => {
    if (spec.renderMode !== "line_breaks" || spec.seriesType !== "line") {
      return [spec];
    }

    const segments: StudySpec[] = [];
    let segmentIndex = 0;
    let currentSegment: typeof spec.data = [];
    const flushSegment = () => {
      if (!currentSegment.length) {
        return;
      }

      segments.push({
        ...spec,
        key: `${spec.key}::segment:${segmentIndex}`,
        data: currentSegment,
      });
      segmentIndex += 1;
      currentSegment = [];
    };

    spec.data.forEach((point) => {
      if (Number.isFinite(point.value)) {
        currentSegment.push(point);
        return;
      }

      flushSegment();
    });
    flushSegment();

    return segments;
  });

const withAlpha = (color: string, alpha: string): string =>
  /^#[0-9a-fA-F]{6}$/.test(color) ? `${color}${alpha}` : color;

const resolvePriceScaleModeOption = (scaleMode: ScaleMode): PriceScaleMode =>
  scaleMode === "log"
    ? PriceScaleMode.Logarithmic
    : scaleMode === "indexed"
      ? PriceScaleMode.IndexedTo100
      : scaleMode === "percentage"
        ? PriceScaleMode.Percentage
        : PriceScaleMode.Normal;

const resolveMinBarSpacing = (compact: boolean): number =>
  compact ? 0.35 : 1.1;

const resolvePreferenceScaleMode = (
  value: UserPreferences["chart"]["priceScaleMode"] | undefined,
  fallback: ScaleMode = "linear",
): ScaleMode =>
  value === "log"
    ? "log"
    : value === "percent"
      ? "percentage"
      : value === "indexed"
        ? "indexed"
        : fallback;

export const resolvePreferenceRightOffset = (
  bars: number,
  compact: boolean,
): number => {
  const normalized = Number.isFinite(Number(bars))
    ? Math.max(0, Math.min(MAX_CHART_FUTURE_EXPANSION_BARS, Number(bars)))
    : 0;
  return compact ? Math.min(4, normalized) : normalized;
};

const chartTimeToDate = (value: unknown): Date | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value * 1000);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : new Date(parsed);
  }
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as { year?: unknown; month?: unknown; day?: unknown };
  const year = Number(record.year);
  const month = Number(record.month);
  const day = Number(record.day);
  if (
    Number.isInteger(year) &&
    Number.isInteger(month) &&
    Number.isInteger(day)
  ) {
    return new Date(Date.UTC(year, month - 1, day, 12));
  }
  return null;
};

const resolveDateLikeMs = (value: unknown): number | null => {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? Math.floor(value) : Math.floor(value * 1000);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
};

const resolvePreferenceHourCycle = (
  preferences: UserPreferences,
): Intl.DateTimeFormatOptions["hourCycle"] | undefined =>
  preferences.time.hourCycle === "auto" ? undefined : preferences.time.hourCycle;

const formatChartAxisTimestamp = (
  value: unknown,
  preferences: UserPreferences,
  fallback = "",
): string => {
  const date = chartTimeToDate(value);
  if (!date) return fallback;
  return formatPreferenceDateTime(date, {
    preferences,
    context: "chart",
    includeDate: true,
    includeTime: true,
    monthStyle: "short",
    dayStyle: "numeric",
    fallback,
  });
};

const isCalendarTickMark = (tickMarkType: unknown): boolean => {
  if (typeof tickMarkType === "number") {
    return tickMarkType <= 2;
  }
  const normalized = String(tickMarkType || "").toLowerCase();
  return (
    normalized.includes("year") ||
    normalized.includes("month") ||
    normalized.includes("day")
  );
};

const isMonthTickMark = (tickMarkType: unknown): boolean => {
  if (tickMarkType === 1) {
    return true;
  }
  return String(tickMarkType || "").toLowerCase().includes("month");
};

const isYearTickMark = (tickMarkType: unknown): boolean => {
  if (tickMarkType === 0) {
    return true;
  }
  return String(tickMarkType || "").toLowerCase().includes("year");
};

const formatChartTickMark = (
  value: unknown,
  tickMarkType: unknown,
  _locale: string | undefined,
  preferences: UserPreferences,
): string => {
  const date = chartTimeToDate(value);
  if (!date) return "";
  const hourCycle = resolvePreferenceHourCycle(preferences);
  const timeZone = resolvePreferenceTimeZone(preferences, "chart");
  const common: Intl.DateTimeFormatOptions = {
    timeZone,
    ...(hourCycle ? { hourCycle } : {}),
  };

  if (isYearTickMark(tickMarkType)) {
    return new Intl.DateTimeFormat("en-US", {
      ...common,
      year: "numeric",
    }).format(date);
  }
  if (isMonthTickMark(tickMarkType)) {
    return new Intl.DateTimeFormat("en-US", {
      ...common,
      month: "short",
      year: "2-digit",
    }).format(date);
  }
  if (isCalendarTickMark(tickMarkType)) {
    return new Intl.DateTimeFormat("en-US", {
      ...common,
      month: preferences.time.dateFormat === "ymd" ? "2-digit" : "short",
      day: "numeric",
    }).format(date);
  }
  return new Intl.DateTimeFormat("en-US", {
    ...common,
    hour: "2-digit",
    minute: "2-digit",
    ...(preferences.time.showSeconds ? { second: "2-digit" } : {}),
  }).format(date);
};

const buildChartOptions = (
  theme: ResearchChartTheme,
  {
    compact = false,
    hideTimeScale = false,
    showTimeScale = true,
    showRightPriceScale = true,
    scaleMode = "linear",
    autoScale = true,
    invertScale = false,
    enableInteractions = true,
    showAttributionLogo = false,
    showGrid = true,
    secondsVisible = false,
    rightOffset,
    preferences,
  }: {
    compact?: boolean;
    hideTimeScale?: boolean;
    showTimeScale?: boolean;
    showRightPriceScale?: boolean;
    scaleMode?: ScaleMode;
    autoScale?: boolean;
    invertScale?: boolean;
    enableInteractions?: boolean;
    showAttributionLogo?: boolean;
    showGrid?: boolean;
    secondsVisible?: boolean;
    rightOffset?: number;
    preferences: UserPreferences;
  },
) => ({
  autoSize: false,
  layout: {
    background: { type: ColorType.Solid, color: theme.bg2 },
    textColor: theme.textMuted,
    fontFamily: theme.mono,
    fontSize: compact ? TYPE_PX.label : TYPE_PX.bodyStrong,
    attributionLogo: showAttributionLogo,
  },
  localization: {
    timeFormatter: (value: unknown) =>
      formatChartAxisTimestamp(value, preferences, ""),
  },
  grid: {
    vertLines: { color: withAlpha(theme.border, "30"), visible: showGrid },
    horzLines: { color: withAlpha(theme.border, "50"), visible: showGrid },
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
    autoScale,
    invertScale,
    mode: resolvePriceScaleModeOption(scaleMode),
  },
  leftPriceScale: {
    visible: false,
    borderColor: theme.border,
  },
  timeScale: {
    borderColor: theme.border,
    borderVisible: !hideTimeScale && showTimeScale,
    visible: !hideTimeScale && showTimeScale,
    timeVisible: !hideTimeScale && showTimeScale,
    secondsVisible,
    ticksVisible: !hideTimeScale && showTimeScale,
    rightOffset: rightOffset ?? (compact ? 1 : 6),
    rightBarStaysOnScroll: false,
    lockVisibleTimeRangeOnResize: true,
    minBarSpacing: resolveMinBarSpacing(compact),
    tickMarkFormatter: (
      value: unknown,
      tickMarkType: unknown,
      locale: string | undefined,
    ) => formatChartTickMark(value, tickMarkType, locale, preferences),
  },
  handleScroll: enableInteractions
    ? {
        mouseWheel: true,
        pressedMouseMove: false,
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

const specBelongsToLegendStudy = (specKey: string, studyId: string): boolean =>
  specKey === studyId || specKey.startsWith(`${studyId}-`);

const isGuideStudySpec = (spec: StudySpec): boolean =>
  /(?:^|-)guide-|(?:^|-)zero$/.test(spec.key);

const resolveStudySpecColor = (spec: StudySpec): string | null => {
  const optionColor = spec.options?.color;
  if (typeof optionColor === "string" && optionColor.trim()) {
    return optionColor;
  }

  const pointColor = spec.data.find(
    (point) => typeof point.color === "string" && point.color.trim(),
  )?.color;
  return typeof pointColor === "string" && pointColor.trim()
    ? pointColor
    : null;
};

const resolveStudySpecValueAtTime = (
  spec: StudySpec,
  time: number | null | undefined,
): number | null => {
  if (typeof time !== "number" || !Number.isFinite(time)) {
    return null;
  }

  const point = spec.data.find(
    (item) =>
      item.time === time &&
      typeof item.value === "number" &&
      Number.isFinite(item.value),
  );

  return typeof point?.value === "number" && Number.isFinite(point.value)
    ? point.value
    : null;
};

export const buildChartLegendStudyItems = ({
  studySpecs,
  studies = [],
  selectedStudies = [],
  time,
  fallbackColor,
}: {
  studySpecs: StudySpec[];
  studies?: ChartLegendStudyOption[];
  selectedStudies?: string[];
  time: number | null | undefined;
  fallbackColor: string;
}): ChartLegendStudyItem[] => {
  const studyLabelById = new Map(studies.map((study) => [study.id, study.label]));

  return selectedStudies.reduce<ChartLegendStudyItem[]>((items, studyId) => {
    const visibleSpecs = studySpecs.filter(
      (spec) =>
        specBelongsToLegendStudy(spec.key, studyId) &&
        !isGuideStudySpec(spec) &&
        spec.options?.visible !== false &&
        spec.data.length > 0,
    );
    if (!visibleSpecs.length) {
      return items;
    }

    const colors = Array.from(
      new Set(
        visibleSpecs
          .map(resolveStudySpecColor)
          .filter((value): value is string => Boolean(value)),
      ),
    );
    const values = Array.from(
      new Set(
        visibleSpecs
          .map((spec) => resolveStudySpecValueAtTime(spec, time))
          .filter((value): value is number => typeof value === "number"),
      ),
    );

    items.push({
      id: studyId,
      label: studyLabelById.get(studyId) || studyId,
      colors: colors.length ? colors : [fallbackColor],
      values,
    });
    return items;
  }, []);
};

const formatCompactNumber = (value: number): string => {
  if (!Number.isFinite(value)) {
    return "0";
  }

  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: value >= 1_000_000 ? 2 : 1,
  }).format(value);
};

const formatLegendTimestamp = (
  value: string,
  preferences: UserPreferences,
): string =>
  formatPreferenceDateTime(value, {
    preferences,
    context: "chart",
    monthStyle: "2-digit",
    dayStyle: "2-digit",
    fallback: value,
  });

const formatLegendNumber = (
  value: number | null | undefined,
  digits = 2,
): string => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "—";
  }

  return value.toFixed(digits);
};

const formatLegendSignedNumber = (
  value: number | null | undefined,
  digits = 2,
): string => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "—";
  }

  const formatted = formatChartPriceAxisValue(Math.abs(value), digits);
  if (formatted === "0") {
    return "+0";
  }

  return `${value >= 0 ? "+" : "-"}${formatted}`;
};

const formatLegendPercent = (value: number | null | undefined): string => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "—";
  }

  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
};

const formatLegendStudyValue = (value: number): string => {
  const digits = Math.min(4, Math.max(2, countValueDecimals(value)));
  return formatLegendNumber(value, digits);
};

const formatLegendSourceLabel = (
  source: string | null | undefined,
  fallback?: string | null,
): string | null => {
  if (source === "ibkr-websocket-derived") {
    return "STREAM";
  }
  if (source === "polygon-delayed-websocket") {
    return "DELAYED STREAM";
  }
  if (source === "ibkr+massive-gap-fill") {
    return "IBKR + GAP";
  }
  if (source === "ibkr-history") {
    return "IBKR";
  }
  if (source) {
    return fallback || "REST";
  }

  return fallback || null;
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

export const formatChartPriceAxisValue = (
  value: number | null | undefined,
  precision = 2,
): string => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "—";
  }

  const safePrecision = Math.max(0, Math.min(8, Math.floor(precision)));
  const rounded = Number(value.toFixed(safePrecision));
  if (Object.is(rounded, -0)) {
    return safePrecision >= 2 ? "0.00" : "0";
  }

  const fixed = rounded.toFixed(safePrecision);
  const [integer, fraction = ""] = fixed.split(".");
  if (!fraction) {
    return fixed;
  }

  const minDigits = Math.min(2, safePrecision);
  const trimmedFraction = fraction.replace(/0+$/, "");
  const displayFraction =
    trimmedFraction.length < minDigits
      ? fraction.slice(0, minDigits)
      : trimmedFraction;

  return displayFraction ? `${integer}.${displayFraction}` : integer;
};

export const resolvePricePrecision = (bars: ChartModel["chartBars"]): number => {
  const maxDecimals = bars.reduce(
    (result, bar) =>
      Math.max(
        result,
        countValueDecimals(bar.o),
        countValueDecimals(bar.h),
        countValueDecimals(bar.l),
        countValueDecimals(bar.c),
      ),
    0,
  );

  return Math.min(4, Math.max(2, maxDecimals));
};

const buildChartPriceFormat = (pricePrecision: number) =>
  ({
    type: "custom",
    minMove: 1 / 10 ** pricePrecision,
    formatter: (value: number) =>
      formatChartPriceAxisValue(value, pricePrecision),
    tickmarksFormatter: (values: number[]) =>
      values.map((value) => formatChartPriceAxisValue(value, pricePrecision)),
  }) as const;

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
      leftShape.labelSize !== rightShape.labelSize ||
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

const flowTooltipModelsEqual = (
  left: FlowTooltipModel | undefined,
  right: FlowTooltipModel | undefined,
): boolean =>
  left === right ||
  Boolean(
    left &&
      right &&
      FLOW_TOOLTIP_SCALAR_KEYS.every((key) => left[key] === right[key]) &&
      stringArraysEqual(left.tags, right.tags),
  );

const chartEventOverlaysEqual = (
  left: ChartEventOverlay[],
  right: ChartEventOverlay[],
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
      current.label !== next.label ||
      current.title !== next.title ||
      current.eventType !== next.eventType ||
      current.source !== next.source ||
      current.severity !== next.severity ||
      current.symbol !== next.symbol ||
      current.tone !== next.tone ||
      current.placement !== next.placement ||
      current.count !== next.count ||
      current.flowBucket !== next.flowBucket ||
      !numbersClose(current.left, next.left) ||
      !numbersClose(current.top, next.top) ||
      !flowTooltipModelsEqual(current.tooltip, next.tooltip)
    ) {
      return false;
    }
  }
  return true;
};

const flowVolumeOverlaysEqual = (
  left: FlowVolumeOverlay[],
  right: FlowVolumeOverlay[],
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
    const segmentsEqual =
      current.segments.length === next.segments.length &&
      current.segments.every((segment, segmentIndex) => {
        const nextSegment = next.segments[segmentIndex];
        return (
          nextSegment &&
          segment.tone === nextSegment.tone &&
          numbersClose(segment.ratio, nextSegment.ratio) &&
          numbersClose(segment.premium, nextSegment.premium)
        );
      });
    if (
      current.id !== next.id ||
      current.title !== next.title ||
      current.tone !== next.tone ||
      !segmentsEqual ||
      current.flowBucket !== next.flowBucket ||
      !numbersClose(current.left, next.left) ||
      !numbersClose(current.top, next.top) ||
      !numbersClose(current.width, next.width) ||
      !numbersClose(current.height, next.height) ||
      !flowTooltipModelsEqual(current.tooltip, next.tooltip)
    ) {
      return false;
    }
  }
  return true;
};

const resolveOverlayLabelFontSize = (
  labelSize: OverlayShape["labelSize"],
): number =>
  labelSize === "tiny" ? 8 : labelSize === "normal" ? 10 : 9;

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

export const isOverlayAnchorVisibleOnAxis = (
  value: number,
  halfSize: number,
  viewportSize: number,
): boolean =>
  Number.isFinite(value) &&
  viewportSize > 0 &&
  value + halfSize >= 0 &&
  value - halfSize <= viewportSize;

export const clampOverlayRectPosition = ({
  left,
  top,
  width,
  height,
  viewportWidth,
  viewportHeight,
}: {
  left: number;
  top: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
}): { left: number; top: number } => ({
  left: clampCoordinate(left, 0, Math.max(0, viewportWidth - width)),
  top: clampCoordinate(top, 0, Math.max(0, viewportHeight - height)),
});

const resolveChartDrawableWidth = (chart: any, fallbackWidth: number): number => {
  const timeScaleWidth = chart?.timeScale?.()?.width?.();
  if (!Number.isFinite(timeScaleWidth) || timeScaleWidth <= 0) {
    return Math.max(0, fallbackWidth);
  }

  return Math.max(0, Math.min(fallbackWidth, timeScaleWidth));
};

const resolveChartDrawableHeight = (chart: any, fallbackHeight: number): number => {
  const timeScaleHeight = chart?.timeScale?.()?.height?.();
  if (!Number.isFinite(timeScaleHeight) || timeScaleHeight < 0) {
    return Math.max(0, fallbackHeight);
  }

  return Math.max(0, fallbackHeight - timeScaleHeight);
};

const isCoordinateWithinViewport = (
  value: number,
  viewportSize: number,
  padding = 0,
): boolean =>
  Number.isFinite(value) && value >= -padding && value <= viewportSize + padding;

const doesRectIntersectViewport = (
  left: number,
  top: number,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
): boolean =>
  Number.isFinite(left) &&
  Number.isFinite(top) &&
  Number.isFinite(width) &&
  Number.isFinite(height) &&
  left + width >= 0 &&
  left <= viewportWidth &&
  top + height >= 0 &&
  top <= viewportHeight;

const isMarkerVisibleInLogicalRange = (
  marker: { barIndex: number },
  visibleLogicalRange: { from: number; to: number } | null,
  barCount: number,
  padding = 1,
): boolean => {
  if (
    !visibleLogicalRange ||
    !Number.isFinite(visibleLogicalRange.from) ||
    !Number.isFinite(visibleLogicalRange.to)
  ) {
    return true;
  }

  const from = Math.max(0, Math.floor(visibleLogicalRange.from) - padding);
  const to = Math.min(barCount - 1, Math.ceil(visibleLogicalRange.to) + padding);
  return marker.barIndex >= from && marker.barIndex <= to;
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
  extraWindows: IndicatorWindow[] = [],
): OverlayShape[] => {
  const barSpacing = resolveBarSpacing(chart, model);
  const indicatorWindows = extraWindows.length
    ? [...extraWindows, ...model.indicatorWindows]
    : model.indicatorWindows;

  return indicatorWindows.reduce<OverlayShape[]>(
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
      const meta = indicatorWindow.meta ?? {};
      const marketSessionKey = meta.marketSessionKey as string | undefined;
      const marketSessionFill =
        marketSessionKey === "pre"
          ? withAlpha(theme.blue || theme.cyan || theme.accent || theme.textMuted, "16")
          : marketSessionKey === "after"
            ? withAlpha(theme.amber, "18")
            : null;
      const marketSessionBorder =
        marketSessionKey === "pre"
          ? withAlpha(theme.blue || theme.cyan || theme.accent || theme.textMuted, "32")
          : marketSessionKey === "after"
            ? withAlpha(theme.amber, "38")
            : null;
      const fill =
        (meta.fillColor as string | undefined) ||
        marketSessionFill ||
        (tone === "bearish"
          ? withAlpha(theme.red, "12")
          : tone === "neutral"
            ? withAlpha(theme.textMuted, "10")
            : withAlpha(theme.green, "12"));
      const border =
        (meta.borderColor as string | undefined) ||
        marketSessionBorder ||
        (tone === "bearish"
          ? withAlpha(theme.red, "45")
          : tone === "neutral"
            ? withAlpha(theme.textMuted, "38")
            : withAlpha(theme.green, "45"));
      const isBackground =
        (meta.style as string | undefined) === "background";

      result.push({
        id: indicatorWindow.id,
        dataTestId:
          (meta.dataTestId as string | undefined) ||
          buildRayReplicaOverlayTestId(
            indicatorWindow.strategy,
            "window",
            indicatorWindow.tone || indicatorWindow.direction,
          ),
        left: xSpan.start,
        top: 0,
        width: xSpan.size,
        height: Math.max(0, viewportHeight),
        fill,
        border:
          isBackground && !marketSessionBorder ? "transparent" : border,
        borderVisible: isBackground ? Boolean(marketSessionBorder) : true,
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
          labelSize:
            meta.labelSize === "tiny" ||
            meta.labelSize === "small" ||
            meta.labelSize === "normal"
              ? meta.labelSize
              : "small",
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
        labelSize:
          meta.labelSize === "tiny" ||
          meta.labelSize === "small" ||
          meta.labelSize === "normal"
            ? meta.labelSize
            : "small",
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

    if (
      !doesRectIntersectViewport(
        left,
        top,
        size,
        size,
        viewportWidth,
        viewportHeight,
      )
    ) {
      return result;
    }

    const clampedPosition = clampOverlayRectPosition({
      left,
      top,
      width: size,
      height: size,
      viewportWidth,
      viewportHeight,
    });

    result.push({
      id: group.id,
      left: clampedPosition.left,
      top: clampedPosition.top,
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

const buildChartEventOverlays = (
  chart: any,
  series: any,
  model: ChartModel,
  events: ChartEvent[],
  viewportWidth: number,
  viewportHeight: number,
): ChartEventOverlay[] => {
  if (!chart || !series || !events.length || !viewportWidth || !viewportHeight) {
    return [];
  }

  const barByTime = new Map(model.chartBars.map((bar) => [bar.time, bar]));
  return events.reduce<ChartEventOverlay[]>((result, event) => {
    const parsed = Date.parse(event.time);
    if (!Number.isFinite(parsed)) {
      return result;
    }

    const time = Math.floor(parsed / 1000);
    const x = chart.timeScale().timeToCoordinate(time);
    const size = event.placement === "timescale" ? 18 : 22;
    if (!isOverlayAnchorVisibleOnAxis(Number(x), size / 2, viewportWidth)) {
      return result;
    }

    const bar = barByTime.get(time);
    const label = event.label || (event.eventType === "earnings" ? "E" : "F");
    const anchorTop =
      event.placement === "timescale"
        ? viewportHeight - size / 2
        : Number.isFinite(bar?.h)
          ? (series.priceToCoordinate?.(bar?.h) ?? 24) - size
          : size / 2;
    const left = clampVisualAnchor(x, size / 2, viewportWidth);
    const top = clampVisualAnchor(anchorTop, size / 2, viewportHeight);

    if (!doesRectIntersectViewport(left - size / 2, top - size / 2, size, size, viewportWidth, viewportHeight)) {
      return result;
    }

    result.push({
      id: event.id,
      left,
      top,
      label,
      title: event.summary || label,
      eventType: event.eventType,
      source: event.source,
      severity: event.severity,
      symbol: event.symbol,
      tone: event.bias,
      placement: event.placement,
    });
    return result;
  }, []);
};

const buildFlowBucketSlotOffsetMap = (
  buckets: FlowChartBucket[],
): Map<string, number> => {
  const byBarIndex = new Map<number, FlowChartBucket[]>();
  buckets.forEach((bucket) => {
    const current = byBarIndex.get(bucket.barIndex) || [];
    current.push(bucket);
    byBarIndex.set(bucket.barIndex, current);
  });

  const offsets = new Map<string, number>();
  byBarIndex.forEach((barBuckets) => {
    const sorted = [...barBuckets].sort((left, right) =>
      left.sourceBasis.localeCompare(right.sourceBasis),
    );
    const center = (sorted.length - 1) / 2;
    sorted.forEach((bucket, index) => {
      offsets.set(bucket.id, index - center);
    });
  });
  return offsets;
};

const buildFlowChartEventOverlays = (
  chart: any,
  series: any,
  model: ChartModel,
  buckets: FlowChartBucket[],
  viewportWidth: number,
  viewportHeight: number,
): ChartEventOverlay[] => {
  if (!chart || !series || !buckets.length || !viewportWidth || !viewportHeight) {
    return [];
  }

  const slotOffsetByBucketId = buildFlowBucketSlotOffsetMap(buckets);
  return buckets.reduce<ChartEventOverlay[]>((result, bucket) => {
    const rawX = chart.timeScale().timeToCoordinate(bucket.time);
    const size = 24;
    const x =
      Number(rawX) + (slotOffsetByBucketId.get(bucket.id) ?? 0) * 18;
    if (!isOverlayAnchorVisibleOnAxis(Number(x), size / 2, viewportWidth)) {
      return result;
    }

    const bar = model.chartBars[bucket.barIndex];
    const anchorTop = Number.isFinite(bar?.h)
      ? (series.priceToCoordinate?.(bar?.h) ?? 24) - size
      : size / 2;
    const left = clampVisualAnchor(x, size / 2, viewportWidth);
    const top = clampVisualAnchor(anchorTop, size / 2, viewportHeight);

    if (
      !doesRectIntersectViewport(
        left - size / 2,
        top - size / 2,
        size,
        size,
        viewportWidth,
        viewportHeight,
      )
    ) {
      return result;
    }

    const tooltip = buildFlowTooltipModel(bucket);
    const right = String(
      bucket.topEvent.metadata?.cp || bucket.topEvent.metadata?.right || "",
    )
      .trim()
      .toUpperCase()
      .slice(0, 1);
    const label =
      bucket.sourceBasis === "snapshot_activity"
        ? "S"
        : bucket.count > 1
          ? String(Math.min(bucket.count, 9))
          : right || "F";

    result.push({
      id: bucket.id,
      left,
      top,
      label,
      title: `${tooltip.title}: ${tooltip.summary}`,
      eventType: bucket.topEvent.eventType,
      source: bucket.topEvent.source,
      severity: bucket.severity,
      symbol: bucket.topEvent.symbol,
      tone: bucket.bias,
      placement: "bar",
      count: bucket.count,
      flowSourceBasis: bucket.sourceBasis,
      flowBucket: bucket,
      tooltip,
    });
    return result;
  }, []);
};

const estimateBarOverlayWidth = (
  chart: any,
  bars: ChartModel["chartBars"],
  index: number,
): number => {
  const currentX = chart.timeScale().timeToCoordinate(bars[index]?.time);
  const previousX =
    index > 0 ? chart.timeScale().timeToCoordinate(bars[index - 1]?.time) : null;
  const nextX =
    index < bars.length - 1
      ? chart.timeScale().timeToCoordinate(bars[index + 1]?.time)
      : null;
  const distances = [previousX, nextX]
    .map((x) =>
      Number.isFinite(x) && Number.isFinite(currentX)
        ? Math.abs(Number(x) - Number(currentX))
        : null,
    )
    .filter((value): value is number => typeof value === "number" && value > 0);
  const width = distances.length ? Math.min(...distances) * 0.62 : 6;
  return clampCoordinate(width, 3, 14);
};

const buildFlowVolumeOverlays = (
  chart: any,
  model: ChartModel,
  buckets: FlowChartBucket[],
  viewportWidth: number,
  viewportHeight: number,
): FlowVolumeOverlay[] => {
  if (!chart || !buckets.length || !viewportWidth || !viewportHeight) {
    return [];
  }

  const volumeTop = viewportHeight * VOLUME_SCALE_TOP_MARGIN;
  const volumeHeight = Math.max(18, viewportHeight - volumeTop);
  const volumeBottom = viewportHeight - 1;
  const slotOffsetByBucketId = buildFlowBucketSlotOffsetMap(buckets);

  return buckets.reduce<FlowVolumeOverlay[]>((result, bucket) => {
    const rawX = chart.timeScale().timeToCoordinate(bucket.time);
    if (!Number.isFinite(rawX)) {
      return result;
    }

    const width = estimateBarOverlayWidth(chart, model.chartBars, bucket.barIndex);
    const x =
      Number(rawX) +
      (slotOffsetByBucketId.get(bucket.id) ?? 0) * Math.max(width + 2, 7);
    const height = clampCoordinate(
      volumeHeight * bucket.volumeSegmentRatio,
      4,
      Math.max(4, volumeHeight * 0.58),
    );
    const left = Number(x) - width / 2;
    const top = volumeBottom - height;

    if (!doesRectIntersectViewport(left, top, width, height, viewportWidth, viewportHeight)) {
      return result;
    }

    const tooltip = buildFlowTooltipModel(bucket);
    const segments = [
      {
        tone: "bullish" as const,
        ratio: bucket.bullishShare,
        premium: bucket.bullishPremium,
      },
      {
        tone: "bearish" as const,
        ratio: bucket.bearishShare,
        premium: bucket.bearishPremium,
      },
      {
        tone: "neutral" as const,
        ratio: bucket.neutralShare,
        premium: bucket.neutralPremium,
      },
    ].filter((segment) => segment.ratio > 0.005);
    result.push({
      id: `flow-volume:${bucket.id}`,
      left,
      top,
      width,
      height,
      title: `${tooltip.title}: ${tooltip.summary}`,
      tone: bucket.bias,
      flowSourceBasis: bucket.sourceBasis,
      segments: segments.length
        ? segments
        : [{ tone: "neutral", ratio: 1, premium: bucket.totalPremium }],
      flowBucket: bucket,
      tooltip,
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
  const hasVisibleEntryBadge =
    hasEntryBadge &&
    isCoordinateWithinViewport(
      resolvedEntryAnchorX,
      viewportWidth,
      entryBadgeWidth / 2,
    ) &&
    isCoordinateWithinViewport(
      resolvedEntryBadgeTop,
      viewportHeight,
      tradeBadgeHeight / 2,
    );
  const hasVisibleExitBadge =
    hasExitBadge &&
    isCoordinateWithinViewport(
      resolvedExitAnchorX,
      viewportWidth,
      exitBadgeWidth / 2,
    ) &&
    isCoordinateWithinViewport(
      resolvedExitBadgeTop,
      viewportHeight,
      tradeBadgeHeight / 2,
    );
  const entryBadge = hasEntryBadge
    ? hasVisibleEntryBadge
      ? {
        id: `${activeTrade.tradeSelectionId}-entry`,
        left: resolvedEntryAnchorX,
        top: resolvedEntryBadgeTop,
        text: entryText,
        color: withAlpha(theme.amber, "20"),
        borderColor: theme.amber,
      }
      : null
    : null;
  const exitBadge = hasExitBadge
    ? hasVisibleExitBadge
      ? {
        id: `${activeTrade.tradeSelectionId}-exit`,
        left: resolvedExitAnchorX,
        top: resolvedExitBadgeTop,
        text: exitText,
        color: profitable
          ? withAlpha(theme.green, "20")
          : withAlpha(theme.red, "20"),
        borderColor: profitable ? theme.green : theme.red,
      }
      : null
    : null;
  const connector =
    Number.isFinite(entryAnchorX) &&
    Number.isFinite(entryAnchorY) &&
    Number.isFinite(exitAnchorX) &&
    Number.isFinite(exitAnchorY) &&
    exitAnchorX >= entryAnchorX &&
    doesRectIntersectViewport(
      Math.min(entryAnchorX, exitAnchorX),
      Math.min(entryAnchorY, exitAnchorY),
      Math.max(1, Math.abs(exitAnchorX - entryAnchorX)),
      Math.max(1, Math.abs(exitAnchorY - entryAnchorY)),
      viewportWidth,
      viewportHeight,
    )
      ? {
          color: profitable ? theme.green : theme.red,
          x1: entryAnchorX,
          y1: entryAnchorY,
          x2: exitAnchorX,
          y2: exitAnchorY,
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
      const badgeTop = y;

      const rectTop =
        placement === "above"
          ? badgeTop - (badgeHeight + 8)
          : placement === "below"
            ? badgeTop + 8
            : badgeTop - badgeHeight / 2;
      const rectHeight = badgeClearance + 8;

      if (
        !doesRectIntersectViewport(
          x - estimatedWidth / 2,
          rectTop,
          estimatedWidth,
          rectHeight,
          viewportWidth,
          viewportHeight,
        )
      ) {
        return;
      }

      const clampedPosition = clampOverlayRectPosition({
        left: x - estimatedWidth / 2,
        top: rectTop,
        width: estimatedWidth,
        height: rectHeight,
        viewportWidth,
        viewportHeight,
      });
      const clampedLeft = clampedPosition.left + estimatedWidth / 2;
      const clampedTop =
        placement === "above"
          ? clampedPosition.top + badgeHeight + 8
          : placement === "below"
            ? clampedPosition.top - 8
            : clampedPosition.top + badgeHeight / 2;

      badges.push({
        id: event.id,
        dataTestId:
          (meta.dataTestId as string | undefined) ||
          buildRayReplicaOverlayTestId(event.strategy, "badge", event.eventType),
        left: clampedLeft,
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

      if (
        !doesRectIntersectViewport(
          x - visualRadius,
          y - visualRadius,
          visualRadius * 2,
          visualRadius * 2,
          viewportWidth,
          viewportHeight,
        )
      ) {
        return;
      }

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
  instrumentationScope?: string | null,
): Record<string, StudyRegistryEntry> => {
  const nextRegistry = { ...registry };
  const renderSpecs = expandStudySpecsForRender(specs);
  const nextKeys = new Set(renderSpecs.map((spec) => spec.key));

  renderSpecs.forEach((spec) => {
    const existing = nextRegistry[spec.key];
    const SeriesCtor = SERIES_TYPE_MAP[spec.seriesType];
    const seriesData = spec.data.map((point) => {
      if (!Number.isFinite(point.value)) {
        return { time: point.time };
      }
      // Histogram series will throw an assertion error and crash the entire
      // chart if any value exceeds the lightweight-charts magnitude cap.
      if (
        spec.seriesType === "histogram" &&
        Math.abs(point.value as number) > HISTOGRAM_VALUE_DISPLAY_CAP
      ) {
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
        data: seriesData,
      };
      return;
    }

    existing.series.applyOptions(spec.options);
    existing.data = syncSeriesData(
      existing.series,
      existing.data || [],
      seriesData,
      instrumentationScope,
    );
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

const applyChartPaneStretchFactors = (
  chart: any,
  {
    compact,
    lowerPaneCount,
  }: {
    compact: boolean;
    lowerPaneCount: number;
  },
) => {
  const panes = typeof chart?.panes === "function" ? chart.panes() : [];
  if (!Array.isArray(panes) || panes.length <= 1) {
    return;
  }

  const pricePaneStretch = compact ? 3.2 : 4.6;
  const lowerPaneStretch = compact ? 0.85 : 1.15;
  panes.forEach((pane: any, index: number) => {
    const stretch =
      index === 0
        ? pricePaneStretch
        : lowerPaneCount > 1
          ? lowerPaneStretch
          : compact
            ? 1
            : 1.25;
    pane?.setStretchFactor?.(stretch);
  });
};

export const ResearchChartSurface = ({
  model,
  theme,
  themeKey,
  uiStateKey,
  rangeIdentityKey = null,
  viewportLayoutKey = null,
  dataTestId,
  compact = false,
  showToolbar = true,
  showLegend = true,
  legend = null,
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
  chartEvents = EMPTY_CHART_EVENTS,
  chartFlowDiagnostics = null,
  latestQuotePrice = null,
  latestQuoteUpdatedAt = null,
  emptyState = null,
  drawMode = null,
  onAddDrawing,
  onAddHorizontalLevel,
  onTradeMarkerSelection,
  onVisibleLogicalRangeChange,
  viewportSnapshot = null,
  externalViewportUserTouched = false,
  onViewportSnapshotChange,
  persistScalePrefs = true,
}: ResearchChartSurfaceProps) => {
  const { preferences: userPreferences } = useUserPreferences();
  const persistLocalChartState =
    persistScalePrefs && userPreferences.privacy.persistChartViewports;
  const keepStoredChartViewport =
    persistLocalChartState && userPreferences.chart.keepTimeZoom;
  const viewportSnapshotControlled =
    typeof onViewportSnapshotChange === "function";
  const normalizedViewportLayoutKey =
    normalizeChartViewportLayoutKey(viewportLayoutKey);
  const effectiveViewportSnapshot = resolveEffectiveChartViewportSnapshot({
    identityKey: rangeIdentityKey ?? null,
    viewportLayoutKey: normalizedViewportLayoutKey,
    viewportSnapshot,
    useStoredFallback: !viewportSnapshotControlled && keepStoredChartViewport,
  });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<any>(null);
  const surfaceDiagnosticsRef = useRef({
    chartInstanceCreates: 0,
    chartInstanceDisposes: 0,
    seriesTailPatches: 0,
    seriesTailAppends: 0,
    seriesFullResets: 0,
    markerSetCalls: 0,
    lastSeriesResetReason: "",
    viewportDefaultRangeApplies: 0,
    viewportUserRangePreserves: 0,
    viewportRealtimeFollowApplies: 0,
    viewportPrependRangeAdjusts: 0,
    viewportSkippedResets: 0,
  });
  const candleSeriesRef = useRef<any>(null);
  const barSeriesRef = useRef<any>(null);
  const lineSeriesRef = useRef<any>(null);
  const areaSeriesRef = useRef<any>(null);
  const baselineSeriesRef = useRef<any>(null);
  const volumeSeriesRef = useRef<any>(null);
  const baseSeriesDataRef = useRef<{
    candles: Array<Record<string, unknown>>;
    bars: Array<Record<string, unknown>>;
    line: Array<Record<string, unknown>>;
    area: Array<Record<string, unknown>>;
    baseline: Array<Record<string, unknown>>;
    volume: Array<Record<string, unknown>>;
  }>({
    candles: [],
    bars: [],
    line: [],
    area: [],
    baseline: [],
    volume: [],
  });
  const markerApisRef = useRef<any[]>([]);
  const markerSignatureRef = useRef<string | null>(null);
  const studyRegistryRef = useRef<Record<string, StudyRegistryEntry>>({});
  const visibleLogicalRangeRef = useRef<any>(null);
  const realtimeFollowRef = useRef(true);
  const chartBarCountRef = useRef(model.chartBars.length);
  const rangeIdentityKeyRef = useRef<string | null>(null);
  const viewportLayoutKeyRef = useRef<string | null>(null);
  const lastPublishedVisibleRangeSignatureRef = useRef<string | null>(null);
  const programmaticVisibleRangeSignatureRef = useRef<string | null>(null);
  const lastProgrammaticViewportIntentAtRef = useRef(0);
  const autoHydrationViewportRef = useRef(true);
  const previousFirstChartBarTimeRef = useRef<number | null>(null);
  const initializedRangeRef = useRef(false);
  const pendingStoredRangeSyncRef = useRef(true);
  const lastUserVisibleRangeRef = useRef<VisibleLogicalRange | null>(null);
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
  const scalePrefsRef = useRef({
    scaleMode: defaultScaleMode,
    autoScale: true,
    invertScale: false,
  });
  const interactionRef = useRef({
    drawMode,
    onAddDrawing,
    onAddHorizontalLevel,
  });
  const visibleRangeChangeRef = useRef(onVisibleLogicalRangeChange);
  const viewportSnapshotChangeRef = useRef(onViewportSnapshotChange);
  const lastUserViewportIntentAtRef = useRef(0);
  const lastWheelViewportIntentAtRef = useRef(0);
  const viewportPointerActiveRef = useRef(false);
  const lastPlotViewportIntentAtRef = useRef(0);
  const lastPlotResizeAtRef = useRef(0);
  const plotPanRef = useRef<ChartPlotPanState | null>(null);
  const nativePlotDragRef = useRef<{
    pointerId: number | null;
    x: number;
    y: number;
  } | null>(null);
  const lastPlotPanVisibleRangeRef = useRef<VisibleLogicalRange | null>(null);
  const plotPanWindowCleanupRef = useRef<(() => void) | null>(null);
  const plotMousePanWindowCleanupRef = useRef<(() => void) | null>(null);
  const lastLocalUserViewportAtRef = useRef(0);
  const initialChartPreferencesRef = useRef<UserPreferences["chart"] | null>(
    null,
  );
  if (initialChartPreferencesRef.current === null) {
    initialChartPreferencesRef.current = userPreferences.chart;
  }
  const initialChartPreferences = initialChartPreferencesRef.current;
  const deferredModel = useDeferredValue(model);
  const extendedSessionWindows = useMemo(
    () =>
      userPreferences.chart.extendedHours
        ? buildUsEquityExtendedSessionWindows(deferredModel.chartBars)
        : [],
    [deferredModel.chartBars, userPreferences.chart.extendedHours],
  );
  const marketSessionBarCounts = useMemo(
    () => countUsEquityMarketSessionBars(model.chartBars),
    [model.chartBars],
  );
  const hydrationScopeKey = uiStateKey || rangeIdentityKey || null;
  const writeSurfaceDiagnosticsAttributes = () => {
    const root = rootRef.current;
    if (!root) {
      return;
    }
    const diagnostics = surfaceDiagnosticsRef.current;
    root.dataset.chartInstanceCreateCount = String(
      diagnostics.chartInstanceCreates,
    );
    root.dataset.chartInstanceDisposeCount = String(
      diagnostics.chartInstanceDisposes,
    );
    root.dataset.chartSeriesTailPatchCount = String(
      diagnostics.seriesTailPatches,
    );
    root.dataset.chartSeriesTailAppendCount = String(
      diagnostics.seriesTailAppends,
    );
    root.dataset.chartSeriesFullResetCount = String(
      diagnostics.seriesFullResets,
    );
    root.dataset.chartSeriesLastResetReason =
      diagnostics.lastSeriesResetReason || "";
    root.dataset.chartMarkerSetCount = String(diagnostics.markerSetCalls);
    root.dataset.chartViewportDefaultRangeApplyCount = String(
      diagnostics.viewportDefaultRangeApplies,
    );
    root.dataset.chartViewportUserRangePreserveCount = String(
      diagnostics.viewportUserRangePreserves,
    );
    root.dataset.chartViewportRealtimeFollowCount = String(
      diagnostics.viewportRealtimeFollowApplies,
    );
    root.dataset.chartViewportPrependRangeAdjustCount = String(
      diagnostics.viewportPrependRangeAdjusts,
    );
    root.dataset.chartViewportSkippedResetCount = String(
      diagnostics.viewportSkippedResets,
    );
  };
  const recordViewportDiagnostic = (
    key:
      | "viewportDefaultRangeApplies"
      | "viewportUserRangePreserves"
      | "viewportRealtimeFollowApplies"
      | "viewportPrependRangeAdjusts"
      | "viewportSkippedResets",
    counter: ChartHydrationCounterKey,
  ) => {
    surfaceDiagnosticsRef.current[key] += 1;
    recordChartHydrationCounter(counter, hydrationScopeKey);
    writeSurfaceDiagnosticsAttributes();
  };
  const hasChartBars = model.chartBars.length > 0;
  const [hoverBar, setHoverBar] = useState<HoverBar | null>(null);
  const [chartError, setChartError] = useState<string | null>(null);
  const [baseSeriesType, setBaseSeriesType] = useState<BaseSeriesType>(
    defaultBaseSeriesType,
  );
  const [showVolume, setShowVolume] = useState(
    defaultShowVolume && initialChartPreferences.showVolume,
  );
  const [scaleMode, setScaleMode] = useState<ScaleMode>(
    () =>
      effectiveViewportSnapshot?.scaleMode ??
      (persistLocalChartState
        ? readStoredChartScalePrefs(uiStateKey).scaleMode
        : undefined) ??
      resolvePreferenceScaleMode(initialChartPreferences.priceScaleMode, defaultScaleMode),
  );
  const [crosshairMode, setCrosshairMode] = useState<"magnet" | "free">(
    initialChartPreferences.crosshairMode,
  );
  const [showPriceLine, setShowPriceLine] = useState(defaultShowPriceLine);
  const [showGrid, setShowGrid] = useState(initialChartPreferences.showGrid);
  const [showTimeScaleState, setShowTimeScaleState] = useState(
    !hideTimeScale && initialChartPreferences.showTimeScale,
  );
  const [autoScale, setAutoScale] = useState(
    () =>
      effectiveViewportSnapshot?.autoScale ??
      (persistLocalChartState
        ? readStoredChartScalePrefs(uiStateKey).autoScale
        : undefined) ??
      true,
  );
  const [invertScale, setInvertScale] = useState(
    () =>
      effectiveViewportSnapshot?.invertScale ??
      (persistLocalChartState
        ? readStoredChartScalePrefs(uiStateKey).invertScale
        : undefined) ??
      false,
  );
  scalePrefsRef.current = {
    scaleMode,
    autoScale,
    invertScale,
  };
  useEffect(() => {
    const chartPreferences = userPreferences.chart;
    setShowVolume(defaultShowVolume && chartPreferences.showVolume);
    setShowGrid(chartPreferences.showGrid);
    setShowTimeScaleState(!hideTimeScale && chartPreferences.showTimeScale);
    setCrosshairMode(chartPreferences.crosshairMode);
    setScaleMode(resolvePreferenceScaleMode(chartPreferences.priceScaleMode, defaultScaleMode));
  }, [
    defaultScaleMode,
    defaultShowVolume,
    hideTimeScale,
    userPreferences.chart.crosshairMode,
    userPreferences.chart.priceScaleMode,
    userPreferences.chart.showGrid,
    userPreferences.chart.showTimeScale,
    userPreferences.chart.showVolume,
  ]);
  const [overlayRevision, setOverlayRevision] = useState(0);
  const [windowOverlays, setWindowOverlays] = useState<OverlayShape[]>([]);
  const [zoneOverlays, setZoneOverlays] = useState<OverlayShape[]>([]);
  const [verticalDrawingOverlays, setVerticalDrawingOverlays] = useState<
    OverlayShape[]
  >([]);
  const chartTimeScaleRightOffset = resolvePreferenceRightOffset(
    userPreferences.chart.futureExpansionBars,
    compact,
  );
  const visibleChartEvents = resolveVisibleChartEvents({
    chartEvents,
    showExecutionMarkers: userPreferences.trading.showExecutionMarkers,
  });
  const flowChartModel = model.chartBars.length ? model : deferredModel;
  const flowChartBuckets = useMemo(
    () => buildFlowChartBuckets(visibleChartEvents, flowChartModel),
    [visibleChartEvents, flowChartModel],
  );
  const flowChartBucketDiagnostics = useMemo(
    () => summarizeFlowChartBucketPlacement(visibleChartEvents, flowChartModel),
    [visibleChartEvents, flowChartModel],
  );
  const showTradePositionOverlays = userPreferences.trading.showPositionLines;
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
  const [chartEventOverlays, setChartEventOverlays] = useState<
    ChartEventOverlay[]
  >([]);
  const [flowVolumeOverlays, setFlowVolumeOverlays] = useState<
    FlowVolumeOverlay[]
  >([]);
  const [flowTooltip, setFlowTooltip] = useState<FlowTooltipState | null>(null);
  const flowTooltipHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [indicatorDashboardOverlay, setIndicatorDashboardOverlay] =
    useState<IndicatorDashboardOverlay | null>(null);
  const [dashboardSessionNowMs, setDashboardSessionNowMs] = useState(() =>
    Date.now(),
  );
  const dashboardMarketSession = resolveUsEquityMarketSession(
    dashboardSessionNowMs,
  );
  const effectiveShowGrid = showGrid;
  useEffect(
    () => () => {
      if (flowTooltipHideTimerRef.current !== null) {
        clearTimeout(flowTooltipHideTimerRef.current);
        flowTooltipHideTimerRef.current = null;
      }
    },
    [],
  );
  const [tradeThresholdOverlays, setTradeThresholdOverlays] = useState<
    TradeThresholdOverlay[]
  >([]);
  const [viewportUserTouched, setViewportUserTouched] = useState(
    Boolean(effectiveViewportSnapshot?.userTouched),
  );
  const viewportUserTouchedRef = useRef(
    Boolean(effectiveViewportSnapshot?.userTouched),
  );
  const syncViewportUserTouched = useCallback(
    (nextTouched: boolean, options: { force?: boolean } = {}) => {
      if (
        !options.force &&
        !nextTouched &&
        viewportUserTouchedRef.current &&
        Date.now() - lastLocalUserViewportAtRef.current <=
          LOCAL_VIEWPORT_TOUCH_SYNC_GRACE_MS
      ) {
        setViewportUserTouched(true);
        return;
      }
      viewportUserTouchedRef.current = nextTouched;
      setViewportUserTouched(nextTouched);
    },
    [],
  );
  const markViewportUserTouched = useCallback(() => {
    viewportUserTouchedRef.current = true;
    lastLocalUserViewportAtRef.current = Date.now();
    setViewportUserTouched(true);
  }, []);
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
  const syncChartEventOverlaysState = (next: ChartEventOverlay[]) => {
    setChartEventOverlays((current) =>
      chartEventOverlaysEqual(current, next) ? current : next,
    );
  };
  const syncFlowVolumeOverlaysState = (next: FlowVolumeOverlay[]) => {
    setFlowVolumeOverlays((current) =>
      flowVolumeOverlaysEqual(current, next) ? current : next,
    );
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
  const isViewportInteractionActive = useCallback(() => {
    const now = Date.now();
    return Boolean(
      viewportPointerActiveRef.current ||
        plotPanRef.current ||
        now - lastWheelViewportIntentAtRef.current <=
          USER_VIEWPORT_INTENT_WINDOW_MS ||
        now - lastPlotViewportIntentAtRef.current <=
          USER_VIEWPORT_INTENT_WINDOW_MS ||
        now - lastUserViewportIntentAtRef.current <=
          USER_VIEWPORT_INTENT_WINDOW_MS,
    );
  }, []);

  useEffect(() => {
    setDashboardSessionNowMs(Date.now());
    const interval = setInterval(() => {
      setDashboardSessionNowMs(Date.now());
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    interactionRef.current = {
      drawMode,
      onAddDrawing,
      onAddHorizontalLevel,
    };
  }, [drawMode, onAddDrawing, onAddHorizontalLevel]);

  useEffect(
    () => () => {
      plotPanWindowCleanupRef.current?.();
      plotPanWindowCleanupRef.current = null;
      plotMousePanWindowCleanupRef.current?.();
      plotMousePanWindowCleanupRef.current = null;
    },
    [],
  );

  useEffect(() => {
    visibleRangeChangeRef.current = onVisibleLogicalRangeChange;
  }, [onVisibleLogicalRangeChange]);

  useEffect(() => {
    viewportSnapshotChangeRef.current = onViewportSnapshotChange;
  }, [onViewportSnapshotChange]);

  useEffect(() => {
    chartBarCountRef.current = model.chartBars.length;
  }, [model.chartBars.length]);

  useEffect(() => {
    scalePrefsRef.current = {
      scaleMode,
      autoScale,
      invertScale,
    };
  }, [autoScale, invertScale, scaleMode]);

  const buildViewportSnapshot = useCallback(
    ({
      visibleRange,
      userTouched,
      realtimeFollow,
    }: {
      visibleRange: VisibleLogicalRange | null;
      userTouched: boolean;
      realtimeFollow: boolean;
    }): ChartViewportSnapshot | null => {
      const identityKey = rangeIdentityKeyRef.current;
      if (!identityKey) return null;
      return {
        identityKey,
        viewportLayoutKey: viewportLayoutKeyRef.current,
        visibleLogicalRange: visibleRange,
        userTouched,
        realtimeFollow,
        scaleMode: scalePrefsRef.current.scaleMode,
        autoScale: scalePrefsRef.current.autoScale,
        invertScale: scalePrefsRef.current.invertScale,
        updatedAt: Date.now(),
      };
    },
    [],
  );

  const publishViewportSnapshot = useCallback(
    (snapshot: ChartViewportSnapshot | null) => {
      if (snapshot) {
        if (viewportSnapshotChangeRef.current) {
          viewportSnapshotChangeRef.current(snapshot);
        } else if (keepStoredChartViewport) {
          writeStoredChartViewportSnapshot(snapshot);
        }
      }
    },
    [keepStoredChartViewport],
  );

  const clearUserViewportIntent = useCallback(() => {
    lastUserViewportIntentAtRef.current = 0;
    lastWheelViewportIntentAtRef.current = 0;
    viewportPointerActiveRef.current = false;
  }, []);

  const markUserViewportIntent = useCallback(
    (
      target: EventTarget | null,
      mode: "pointer" | "wheel",
      point?: { clientX: number; clientY: number },
    ) => {
      const container = containerRef.current;
      if (!container) {
        return false;
      }
      const targetInside =
        target instanceof Node && container.contains(target);
      const rect = container.getBoundingClientRect();
      const pointInside =
        point &&
        point.clientX >= rect.left &&
        point.clientX <= rect.right &&
        point.clientY >= rect.top &&
        point.clientY <= rect.bottom;
      if (!targetInside && !pointInside) {
        return false;
      }

      const now = Date.now();
      lastUserViewportIntentAtRef.current = now;
      lastLocalUserViewportAtRef.current = now;
      autoHydrationViewportRef.current = false;
      realtimeFollowRef.current = false;
      programmaticVisibleRangeSignatureRef.current = null;
      viewportUserTouchedRef.current = true;
      setViewportUserTouched((current) => (current ? current : true));
      if (mode === "pointer") {
        viewportPointerActiveRef.current = true;
      } else if (mode === "wheel") {
        lastWheelViewportIntentAtRef.current = now;
      }
      return true;
    },
    [],
  );

  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return undefined;
    }

    const handleNativeWheel = (event: globalThis.WheelEvent) => {
      markUserViewportIntent(event.target, "wheel", {
        clientX: event.clientX,
        clientY: event.clientY,
      });
    };
    const handleNativePointerDown = (event: globalThis.PointerEvent) => {
      markUserViewportIntent(event.target, "pointer", {
        clientX: event.clientX,
        clientY: event.clientY,
      });
    };

    root.addEventListener("wheel", handleNativeWheel, {
      capture: true,
      passive: true,
    });
    root.addEventListener("pointerdown", handleNativePointerDown, true);
    return () => {
      root.removeEventListener("wheel", handleNativeWheel, true);
      root.removeEventListener("pointerdown", handleNativePointerDown, true);
    };
  }, [markUserViewportIntent]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !hasChartBars) {
      return undefined;
    }

    const isInsidePanArea = (
      event: globalThis.PointerEvent | globalThis.MouseEvent,
    ) => {
      if (!enableInteractions || drawMode || event.button !== 0) {
        return false;
      }
      const rect = container.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      ) {
        return false;
      }
      const priceScaleWidth =
        chartRef.current?.priceScale?.("right", 0)?.width?.() || 0;
      return !isPointInsideRightPriceScale({
        x: event.clientX,
        y: event.clientY,
        rect,
        priceScaleWidth,
      });
    };

    const markDragIntent = () => {
      const now = Date.now();
      lastPlotViewportIntentAtRef.current = now;
      lastUserViewportIntentAtRef.current = now;
    };

    const handlePointerDown = (event: globalThis.PointerEvent) => {
      if (!isInsidePanArea(event)) {
        nativePlotDragRef.current = null;
        return;
      }
      nativePlotDragRef.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      };
    };
    const handleMouseDown = (event: globalThis.MouseEvent) => {
      if (!isInsidePanArea(event)) {
        nativePlotDragRef.current = null;
        return;
      }
      if (nativePlotDragRef.current?.pointerId != null) {
        return;
      }
      nativePlotDragRef.current = {
        pointerId: null,
        x: event.clientX,
        y: event.clientY,
      };
    };
    const handlePointerMove = (event: globalThis.PointerEvent) => {
      const pending = nativePlotDragRef.current;
      if (
        !pending ||
        pending.pointerId !== event.pointerId ||
        (event.buttons & 1) !== 1
      ) {
        return;
      }
      if (
        Math.hypot(event.clientX - pending.x, event.clientY - pending.y) >
        CHART_PLOT_PAN_MOVE_TOLERANCE
      ) {
        markDragIntent();
      }
    };
    const handleMouseMove = (event: globalThis.MouseEvent) => {
      const pending = nativePlotDragRef.current;
      if (!pending || (event.buttons & 1) !== 1) {
        return;
      }
      if (
        Math.hypot(event.clientX - pending.x, event.clientY - pending.y) >
        CHART_PLOT_PAN_MOVE_TOLERANCE
      ) {
        markDragIntent();
      }
    };
    const clearNativePlotDrag = () => {
      nativePlotDragRef.current = null;
    };

    container.addEventListener("pointerdown", handlePointerDown, true);
    container.addEventListener("mousedown", handleMouseDown, true);
    container.addEventListener("pointermove", handlePointerMove, true);
    container.addEventListener("mousemove", handleMouseMove, true);
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("mousedown", handleMouseDown, true);
    window.addEventListener("pointermove", handlePointerMove, true);
    window.addEventListener("mousemove", handleMouseMove, true);
    window.addEventListener("pointerup", clearNativePlotDrag, true);
    window.addEventListener("pointercancel", clearNativePlotDrag, true);
    window.addEventListener("mouseup", clearNativePlotDrag, true);
    return () => {
      container.removeEventListener("pointerdown", handlePointerDown, true);
      container.removeEventListener("mousedown", handleMouseDown, true);
      container.removeEventListener("pointermove", handlePointerMove, true);
      container.removeEventListener("mousemove", handleMouseMove, true);
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("mousedown", handleMouseDown, true);
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("mousemove", handleMouseMove, true);
      window.removeEventListener("pointerup", clearNativePlotDrag, true);
      window.removeEventListener("pointercancel", clearNativePlotDrag, true);
      window.removeEventListener("mouseup", clearNativePlotDrag, true);
    };
  }, [drawMode, enableInteractions, hasChartBars, markViewportUserTouched]);

  const markProgrammaticViewportIntent = useCallback(
    (signature: string | null = null) => {
      programmaticVisibleRangeSignatureRef.current = signature;
      lastProgrammaticViewportIntentAtRef.current = Date.now();
    },
    [],
  );

  const hasRecentProgrammaticViewportIntent = useCallback(
    () =>
      Date.now() - lastProgrammaticViewportIntentAtRef.current <=
      PROGRAMMATIC_VIEWPORT_INTENT_WINDOW_MS,
    [],
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const handleWindowPointerDown = (event: globalThis.PointerEvent) => {
      const container = containerRef.current;
      if (
        container &&
        event.target instanceof Node &&
        container.contains(event.target)
      ) {
        return;
      }
      clearUserViewportIntent();
    };
    const clearPointerActive = () => {
      viewportPointerActiveRef.current = false;
    };

    window.addEventListener("pointerdown", handleWindowPointerDown, true);
    window.addEventListener("pointerup", clearPointerActive, true);
    window.addEventListener("pointercancel", clearPointerActive, true);
    window.addEventListener("blur", clearUserViewportIntent);
    return () => {
      window.removeEventListener("pointerdown", handleWindowPointerDown, true);
      window.removeEventListener("pointerup", clearPointerActive, true);
      window.removeEventListener("pointercancel", clearPointerActive, true);
      window.removeEventListener("blur", clearUserViewportIntent);
    };
  }, [clearUserViewportIntent]);

  const publishVisibleLogicalRange = useCallback(
    (
      range: unknown,
      options: {
        markInitialized?: boolean;
        source?: "programmatic" | "user";
      } = {},
    ): VisibleLogicalRange | null => {
      const source = options.source || "user";
      const publishState = resolveVisibleRangePublishState({
        range,
        barCount: chartBarCountRef.current,
        source,
      });
      const visibleRange = publishState.visibleRange;
      const activeUserTouchedViewport = Boolean(
        viewportUserTouchedRef.current ||
          viewportUserTouched ||
          externalViewportUserTouched ||
          (effectiveViewportSnapshot?.identityKey ===
            rangeIdentityKeyRef.current &&
            effectiveViewportSnapshot.userTouched),
      );
      const realtimeFollow = activeUserTouchedViewport
        ? false
        : publishState.realtimeFollow;
      const previousSignature = buildVisibleRangeSignature(
        visibleLogicalRangeRef.current,
      );
      const { signature, shouldPublish } = resolveVisibleRangePublishDecision({
        lastSignature: lastPublishedVisibleRangeSignatureRef.current,
        visibleRange,
      });
      const hasRecentProgrammaticIntent = hasRecentProgrammaticViewportIntent();
      const hasMatchingProgrammaticIntent =
        hasRecentProgrammaticIntent &&
        programmaticVisibleRangeSignatureRef.current === signature;
      const lockedUserRange =
        activeUserTouchedViewport
          ? resolveViewportVisibleLogicalRange(lastUserVisibleRangeRef.current) ||
            resolveViewportVisibleLogicalRange(visibleLogicalRangeRef.current)
          : null;
      if (
        shouldPreserveUserViewportRange({
          source,
          activeUserTouchedViewport,
          hasRecentProgrammaticIntent: hasMatchingProgrammaticIntent,
          currentUserRange: lockedUserRange,
          nextRange: visibleRange,
        }) &&
        lockedUserRange
      ) {
        const lockedSignature = buildVisibleRangeSignature(lockedUserRange);
        visibleLogicalRangeRef.current = lockedUserRange;
        lastPublishedVisibleRangeSignatureRef.current = lockedSignature;
        markProgrammaticViewportIntent(lockedSignature);
        chartRef.current?.timeScale?.().setVisibleLogicalRange?.(lockedUserRange);
        recordViewportDiagnostic(
          "viewportUserRangePreserves",
          "visibleRangeUserPreserved",
        );
        return lockedUserRange;
      }
      const recentLocalUserViewport =
        Date.now() - lastLocalUserViewportAtRef.current <=
        LOCAL_VIEWPORT_TOUCH_SYNC_GRACE_MS;
      if (
        source === "programmatic" &&
        recentLocalUserViewport &&
        !hasMatchingProgrammaticIntent &&
        visibleLogicalRangeRef.current &&
        buildVisibleRangeSignature(visibleLogicalRangeRef.current) !== signature
      ) {
        return normalizeVisibleLogicalRange(visibleLogicalRangeRef.current);
      }

      visibleLogicalRangeRef.current = visibleRange;
      realtimeFollowRef.current = realtimeFollow;
      if (options.markInitialized) {
        initializedRangeRef.current = true;
        pendingStoredRangeSyncRef.current = false;
      }
      if (source === "user") {
        autoHydrationViewportRef.current = false;
        programmaticVisibleRangeSignatureRef.current = null;
        lastProgrammaticViewportIntentAtRef.current = 0;
        lastUserVisibleRangeRef.current = visibleRange;
        markViewportUserTouched();
      }
      if (source === "programmatic") {
        lastPublishedVisibleRangeSignatureRef.current = signature;
      } else if (shouldPublish || source === "user") {
        lastPublishedVisibleRangeSignatureRef.current = signature;
        visibleRangeChangeRef.current?.(visibleRange);
        publishViewportSnapshot(
          buildViewportSnapshot({
            visibleRange,
            userTouched: true,
            realtimeFollow,
          }),
        );
      }
      if (
        previousSignature !== signature ||
        source === "user"
      ) {
        setOverlayRevision((value) => value + 1);
      }
      return visibleRange;
    },
    [
      buildViewportSnapshot,
      effectiveViewportSnapshot?.identityKey,
      effectiveViewportSnapshot?.userTouched,
      externalViewportUserTouched,
      hasRecentProgrammaticViewportIntent,
      markProgrammaticViewportIntent,
      markViewportUserTouched,
      publishViewportSnapshot,
      viewportUserTouched,
    ],
  );

  const setProgrammaticVisibleLogicalRange = useCallback(
    (
      nextRange: VisibleLogicalRange | null | undefined,
      options: {
        markInitialized?: boolean;
        markProgrammaticIntent?: boolean;
        respectRecentUserRange?: boolean;
      } = {},
    ): VisibleLogicalRange | null => {
      const requestedRange = normalizeVisibleLogicalRange(nextRange);
      const recentLocalUserViewport =
        Date.now() - lastLocalUserViewportAtRef.current <=
        LOCAL_VIEWPORT_TOUCH_SYNC_GRACE_MS;
      const recentUserRange =
        options.respectRecentUserRange === false || !recentLocalUserViewport
          ? null
          : normalizeVisibleLogicalRange(lastUserVisibleRangeRef.current);
      const visibleRange = recentUserRange || requestedRange;
      if (!chartRef.current || !visibleRange) {
        return null;
      }

      if (options.markProgrammaticIntent !== false) {
        markProgrammaticViewportIntent(buildVisibleRangeSignature(visibleRange));
      }
      chartRef.current.timeScale().setVisibleLogicalRange(visibleRange);
      return publishVisibleLogicalRange(visibleRange, {
        ...options,
        source: "programmatic",
      });
    },
    [markProgrammaticViewportIntent, publishVisibleLogicalRange],
  );

  useEffect(() => {
    if (
      !effectiveViewportSnapshot ||
      effectiveViewportSnapshot.identityKey !== rangeIdentityKeyRef.current
    ) {
      return;
    }
    setScaleMode(effectiveViewportSnapshot.scaleMode);
    setAutoScale(effectiveViewportSnapshot.autoScale);
    setInvertScale(effectiveViewportSnapshot.invertScale);
    if (effectiveViewportSnapshot.userTouched) {
      realtimeFollowRef.current = false;
      autoHydrationViewportRef.current = false;
    } else {
      realtimeFollowRef.current = effectiveViewportSnapshot.realtimeFollow;
    }
    syncViewportUserTouched(Boolean(effectiveViewportSnapshot.userTouched));
  }, [
    effectiveViewportSnapshot?.autoScale,
    effectiveViewportSnapshot?.identityKey,
    effectiveViewportSnapshot?.invertScale,
    effectiveViewportSnapshot?.realtimeFollow,
    effectiveViewportSnapshot?.scaleMode,
    effectiveViewportSnapshot?.userTouched,
    syncViewportUserTouched,
  ]);

  useEffect(() => {
    syncViewportUserTouched(Boolean(effectiveViewportSnapshot?.userTouched));
  }, [
    rangeIdentityKey,
    normalizedViewportLayoutKey,
    effectiveViewportSnapshot?.identityKey,
    syncViewportUserTouched,
  ]);

  useEffect(() => {
    if (!rangeIdentityKeyRef.current) {
      return;
    }
    publishViewportSnapshot(
      buildViewportSnapshot({
        visibleRange: normalizeVisibleLogicalRange(visibleLogicalRangeRef.current),
        userTouched: Boolean(
          viewportUserTouchedRef.current ||
            viewportUserTouched ||
            (effectiveViewportSnapshot?.identityKey ===
              rangeIdentityKeyRef.current &&
              effectiveViewportSnapshot.userTouched)
        ),
        realtimeFollow:
          viewportUserTouchedRef.current ||
          viewportUserTouched ||
          (effectiveViewportSnapshot?.identityKey ===
            rangeIdentityKeyRef.current &&
            effectiveViewportSnapshot.userTouched)
            ? false
            : realtimeFollowRef.current,
      }),
    );
  }, [
    autoScale,
    buildViewportSnapshot,
    invertScale,
    publishViewportSnapshot,
    rangeIdentityKey,
    scaleMode,
    effectiveViewportSnapshot?.identityKey,
    effectiveViewportSnapshot?.userTouched,
    viewportUserTouched,
  ]);

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
    if (!persistLocalChartState) {
      return;
    }
    writeStoredChartScalePrefs(uiStateKey, {
      scaleMode,
      autoScale,
      invertScale,
    });
  }, [persistLocalChartState, uiStateKey, scaleMode, autoScale, invertScale]);

  useLayoutEffect(() => {
    const nextRangeIdentityKey = rangeIdentityKey ?? null;
    const nextViewportLayoutKey = normalizedViewportLayoutKey;
    if (
      rangeIdentityKeyRef.current === nextRangeIdentityKey &&
      viewportLayoutKeyRef.current === nextViewportLayoutKey
    ) {
      return;
    }

    const restoreState = resolveViewportRestoreState({
      identityKey: nextRangeIdentityKey,
      viewportLayoutKey: nextViewportLayoutKey,
      viewportSnapshot: effectiveViewportSnapshot,
      storedScalePrefs: persistLocalChartState
        ? readStoredChartScalePrefs(uiStateKey)
        : {},
      defaultScaleMode,
      barCount: model.chartBars.length,
    });
    const matchingStoredRange = restoreState.visibleLogicalRange;

    rangeIdentityKeyRef.current = nextRangeIdentityKey;
    viewportLayoutKeyRef.current = nextViewportLayoutKey;
    visibleLogicalRangeRef.current = matchingStoredRange;
    realtimeFollowRef.current = restoreState.realtimeFollow;
    lastPublishedVisibleRangeSignatureRef.current = null;
    lastUserVisibleRangeRef.current = null;
    programmaticVisibleRangeSignatureRef.current = null;
    lastProgrammaticViewportIntentAtRef.current = 0;
    clearUserViewportIntent();
    autoHydrationViewportRef.current = restoreState.autoHydration;
    syncViewportUserTouched(Boolean(restoreState.matchingSnapshot?.userTouched), {
      force: true,
    });
    initializedRangeRef.current = false;
    pendingStoredRangeSyncRef.current = true;
    previousFirstChartBarTimeRef.current = model.chartBars[0]?.time ?? null;
    lastSelectionFocusTokenRef.current = null;
    setScaleMode(restoreState.scaleMode);
    setAutoScale(restoreState.autoScale);
    setInvertScale(restoreState.invertScale);

    if (!chartRef.current || !hasChartBars) {
      return;
    }

    chartRef.current
      .priceScale?.("right", 0)
      ?.setAutoScale?.(restoreState.autoScale);
    if (matchingStoredRange) {
      setProgrammaticVisibleLogicalRange(matchingStoredRange, {
        markInitialized: true,
        markProgrammaticIntent: !restoreState.matchingSnapshot?.userTouched,
      });
    } else if (model.defaultVisibleLogicalRange) {
      recordViewportDiagnostic(
        "viewportDefaultRangeApplies",
        "visibleRangeDefaultApplied",
      );
      setProgrammaticVisibleLogicalRange(model.defaultVisibleLogicalRange, {
        markInitialized: true,
      });
    } else {
      markProgrammaticViewportIntent();
      chartRef.current.timeScale().fitContent();
      initializedRangeRef.current = true;
      pendingStoredRangeSyncRef.current = false;
      setOverlayRevision((value) => value + 1);
    }
  }, [
    hasChartBars,
    clearUserViewportIntent,
    defaultScaleMode,
    markProgrammaticViewportIntent,
    model.chartBars,
    model.defaultVisibleLogicalRange,
    persistLocalChartState,
    rangeIdentityKey,
    normalizedViewportLayoutKey,
    setProgrammaticVisibleLogicalRange,
    syncViewportUserTouched,
    uiStateKey,
    effectiveViewportSnapshot,
  ]);

  useLayoutEffect(() => {
    const nextFirstChartBarTime = model.chartBars[0]?.time ?? null;
    const previousFirstChartBarTime = previousFirstChartBarTimeRef.current;

    if (
      visibleLogicalRangeRef.current &&
      previousFirstChartBarTime != null &&
      nextFirstChartBarTime != null &&
      nextFirstChartBarTime < previousFirstChartBarTime
    ) {
      const prependCount = model.chartBars.findIndex(
        (bar) => bar.time === previousFirstChartBarTime,
      );

      if (prependCount > 0) {
        const adjustedVisibleRange = resolvePrependedVisibleLogicalRange({
          visibleRange: visibleLogicalRangeRef.current,
          prependCount,
        });
        if (!adjustedVisibleRange) {
          previousFirstChartBarTimeRef.current = nextFirstChartBarTime;
          return;
        }
        visibleLogicalRangeRef.current = adjustedVisibleRange;
        pendingStoredRangeSyncRef.current = true;
        recordViewportDiagnostic(
          "viewportPrependRangeAdjusts",
          "visibleRangePrependAdjusted",
        );
        visibleRangeChangeRef.current?.(adjustedVisibleRange);
        publishViewportSnapshot(
          buildViewportSnapshot({
            visibleRange: adjustedVisibleRange,
            userTouched: Boolean(
              viewportUserTouchedRef.current ||
                viewportUserTouched ||
                (effectiveViewportSnapshot?.identityKey ===
                  rangeIdentityKeyRef.current &&
                  effectiveViewportSnapshot.userTouched),
            ),
            realtimeFollow:
              viewportUserTouchedRef.current ||
              viewportUserTouched ||
              (effectiveViewportSnapshot?.identityKey ===
                rangeIdentityKeyRef.current &&
                effectiveViewportSnapshot.userTouched)
                ? false
                : realtimeFollowRef.current,
          }),
        );
        setOverlayRevision((value) => value + 1);
      }
    }

    previousFirstChartBarTimeRef.current = nextFirstChartBarTime;
  }, [
    buildViewportSnapshot,
    effectiveViewportSnapshot?.identityKey,
    effectiveViewportSnapshot?.userTouched,
    model.chartBars,
    publishViewportSnapshot,
    viewportUserTouched,
  ]);

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
    if (!containerRef.current || !hasChartBars) {
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
          showTimeScale: showTimeScaleState,
          showRightPriceScale,
          scaleMode,
          autoScale,
          invertScale,
          enableInteractions,
          showAttributionLogo,
          showGrid: effectiveShowGrid,
          secondsVisible: userPreferences.time.showSeconds,
          rightOffset: chartTimeScaleRightOffset,
          preferences: userPreferences,
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
        scaleMargins: { top: VOLUME_SCALE_TOP_MARGIN, bottom: 0 },
      });

      markerApisRef.current = [
        createSeriesMarkers(candleSeries, []),
        createSeriesMarkers(barSeries, []),
        createSeriesMarkers(lineSeries, []),
        createSeriesMarkers(areaSeries, []),
        createSeriesMarkers(baselineSeries, []),
      ];
      markerSignatureRef.current = null;
      chartRef.current = chart;
      surfaceDiagnosticsRef.current.chartInstanceCreates += 1;
      recordChartHydrationCounter("chartInstanceCreate", hydrationScopeKey);
      writeSurfaceDiagnosticsAttributes();
      candleSeriesRef.current = candleSeries;
      barSeriesRef.current = barSeries;
      lineSeriesRef.current = lineSeries;
      areaSeriesRef.current = areaSeries;
      baselineSeriesRef.current = baselineSeries;
      volumeSeriesRef.current = volumeSeries;
      activePriceSeriesRef.current = candleSeries;

      handleVisibleRangeChange = (range: any) => {
        const normalizedRange = normalizeVisibleLogicalRange(range);
        const activePlotPanRange =
          (plotPanRef.current?.active ||
            Date.now() - lastPlotViewportIntentAtRef.current <=
              USER_VIEWPORT_INTENT_WINDOW_MS)
            ? lastPlotPanVisibleRangeRef.current
            : null;
        if (activePlotPanRange) {
          if (
            !normalizedRange ||
            !visibleLogicalRangesClose(normalizedRange, activePlotPanRange, 0.01)
          ) {
            return;
          }
        }
        const signature = buildVisibleRangeSignature(normalizedRange);
        const resizeIntent =
          !viewportPointerActiveRef.current &&
          Date.now() - lastPlotResizeAtRef.current <=
            PLOT_RESIZE_VIEWPORT_INTENT_WINDOW_MS;
        const wheelIntent =
          Date.now() - lastWheelViewportIntentAtRef.current <=
          USER_VIEWPORT_INTENT_WINDOW_MS;
        const userIntent =
          (viewportPointerActiveRef.current ||
            Boolean(plotPanRef.current) ||
            wheelIntent) &&
          !resizeIntent;
        const source = resolveVisibleRangeChangeSource({
          initialized: initializedRangeRef.current,
          nextSignature: signature,
          programmaticSignature: programmaticVisibleRangeSignatureRef.current,
          hasRecentProgrammaticIntent: hasRecentProgrammaticViewportIntent(),
          hasRecentUserViewportIntent: userIntent,
        });
        publishVisibleLogicalRange(range, { source });
      };
      handleCrosshairMove = (param: any) => {
        const rawTime = param?.time;
        const time = typeof rawTime === "number" ? rawTime : null;
        if (time == null) {
          setHoverBar((current) => (current === null ? current : null));
          return;
        }

        const bar = barLookupRef.current.get(time);
        setHoverBar((current) =>
          hoverBarsEqual(current, bar || null) ? current : bar || null,
        );
      };
      handleClick = (param: any) => {
        if (!interactionRef.current.drawMode || !param?.point) {
          return;
        }

        autoHydrationViewportRef.current = false;
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
      if (chart) {
        surfaceDiagnosticsRef.current.chartInstanceDisposes += 1;
        recordChartHydrationCounter("chartInstanceDispose", hydrationScopeKey);
        writeSurfaceDiagnosticsAttributes();
      }
      chart = null;

      chartRef.current = null;
      candleSeriesRef.current = null;
      barSeriesRef.current = null;
      lineSeriesRef.current = null;
      areaSeriesRef.current = null;
      baselineSeriesRef.current = null;
      volumeSeriesRef.current = null;
      baseSeriesDataRef.current = {
        candles: [],
        bars: [],
        line: [],
        area: [],
        baseline: [],
        volume: [],
      };
      markerApisRef.current = [];
      markerSignatureRef.current = null;
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
      realtimeFollowRef.current = true;
      programmaticVisibleRangeSignatureRef.current = null;
      lastProgrammaticViewportIntentAtRef.current = 0;
      initializedRangeRef.current = false;
      pendingStoredRangeSyncRef.current = true;
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
    hasChartBars,
    hideTimeScale,
    hideCrosshair,
    showAttributionLogo,
    showRightPriceScale,
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
    const seriesSyncStartedAt = nowMs();
    const pricePrecision = resolvePricePrecision(model.chartBars);
    const priceFormat = buildChartPriceFormat(pricePrecision);
    const candleSeriesData = model.chartBars.map((bar) => ({
      time: bar.time,
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      color: bar.color ?? (bar.c === bar.o ? theme.textMuted : undefined),
      borderColor: bar.borderColor,
      wickColor: bar.wickColor ?? (bar.c === bar.o ? theme.textMuted : undefined),
    }));
    const barSeriesData = model.chartBars.map((bar) => ({
      time: bar.time,
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
    }));
    const closeSeriesData = model.chartBars.map((bar) => ({
      time: bar.time,
      value: bar.c,
    }));
    const volumeSeriesData = showVolume
      ? model.chartBars.map((bar) =>
          sanitizeHistogramPoint({
            time: bar.time,
            value: bar.v,
            color:
              bar.c > bar.o
                ? withAlpha(theme.green, "55")
                : bar.c < bar.o
                  ? withAlpha(theme.red, "55")
                  : withAlpha(theme.textMuted, "55"),
          }),
        )
      : [];
    const previousBarCount = baseSeriesDataRef.current.candles.length;
    const nextBarCount = candleSeriesData.length;
    const rawVisibleRangeBeforeDataSync =
      visibleLogicalRangeRef.current ||
      chartRef.current.timeScale().getVisibleLogicalRange?.() ||
      null;
    const visibleRangeBeforeDataSync = resolveViewportVisibleLogicalRange(
      rawVisibleRangeBeforeDataSync,
    );
    if (rawVisibleRangeBeforeDataSync && !visibleRangeBeforeDataSync) {
      visibleLogicalRangeRef.current = null;
    }
    const userViewportTouched = Boolean(
      externalViewportUserTouched ||
        viewportUserTouchedRef.current ||
        viewportUserTouched ||
        (effectiveViewportSnapshot?.identityKey ===
          rangeIdentityKeyRef.current &&
          effectiveViewportSnapshot.userTouched),
    );
    if (userViewportTouched) {
      autoHydrationViewportRef.current = false;
    }
    const shouldFollowLatestBars = shouldAutoFollowLatestBars({
      realtimeFollow: !userViewportTouched && realtimeFollowRef.current,
      visibleRange: visibleRangeBeforeDataSync,
      previousBarCount,
      nextBarCount,
    });
    const autoHydrationVisibleRange =
      autoHydrationViewportRef.current && !userViewportTouched
        ? resolveAutoHydrationVisibleRange({
            barCount: nextBarCount,
            defaultVisibleRange: model.defaultVisibleLogicalRange,
          })
        : null;
    const interactionActive = isViewportInteractionActive();
    const canApplyProgrammaticRangeSync = shouldApplyProgrammaticRangeSync({
      interactionActive,
      realtimeFollow: realtimeFollowRef.current,
      followLatestBars: shouldFollowLatestBars,
    });
    let seriesFullResetDuringSync = false;
    const reportSeriesSyncMode: SeriesSyncModeReporter = (mode, delta, detail) => {
      if (mode === "patch") {
        surfaceDiagnosticsRef.current.seriesTailPatches += delta;
      } else if (mode === "append") {
        surfaceDiagnosticsRef.current.seriesTailAppends += delta;
      } else {
        seriesFullResetDuringSync = true;
        surfaceDiagnosticsRef.current.seriesFullResets += 1;
        surfaceDiagnosticsRef.current.lastSeriesResetReason = [
          detail?.seriesName || "series",
          detail?.resetReason || "unknown",
        ].join(":");
      }
      writeSurfaceDiagnosticsAttributes();
    };

    baseSeriesDataRef.current.candles = syncSeriesData(
      candleSeries,
      baseSeriesDataRef.current.candles,
      candleSeriesData,
      hydrationScopeKey,
      reportSeriesSyncMode,
      "candles",
    );
    baseSeriesDataRef.current.bars = syncSeriesData(
      barSeries,
      baseSeriesDataRef.current.bars,
      barSeriesData,
      hydrationScopeKey,
      reportSeriesSyncMode,
      "bars",
    );
    baseSeriesDataRef.current.line = syncSeriesData(
      lineSeries,
      baseSeriesDataRef.current.line,
      closeSeriesData,
      hydrationScopeKey,
      reportSeriesSyncMode,
      "line",
    );
    baseSeriesDataRef.current.area = syncSeriesData(
      areaSeries,
      baseSeriesDataRef.current.area,
      closeSeriesData,
      hydrationScopeKey,
      reportSeriesSyncMode,
      "area",
    );
    baseSeriesDataRef.current.baseline = syncSeriesData(
      baselineSeries,
      baseSeriesDataRef.current.baseline,
      closeSeriesData,
      hydrationScopeKey,
      reportSeriesSyncMode,
      "baseline",
    );
    baseSeriesDataRef.current.volume = syncSeriesData(
      volumeSeries,
      baseSeriesDataRef.current.volume,
      volumeSeriesData,
      hydrationScopeKey,
      reportSeriesSyncMode,
      "volume",
    );
    if (
      userViewportTouched &&
      !seriesFullResetDuringSync &&
      initializedRangeRef.current &&
      visibleRangeBeforeDataSync &&
      !interactionActive
    ) {
      const visibleRangeAfterDataSync = resolveViewportVisibleLogicalRange(
        chartRef.current.timeScale().getVisibleLogicalRange?.(),
      );
      if (
        !visibleLogicalRangesClose(
          visibleRangeAfterDataSync,
          visibleRangeBeforeDataSync,
          0.01,
        )
      ) {
        recordViewportDiagnostic(
          "viewportUserRangePreserves",
          "visibleRangeUserPreserved",
        );
        setProgrammaticVisibleLogicalRange(visibleRangeBeforeDataSync, {
          markProgrammaticIntent: true,
        });
      }
    }
    const shouldRestoreRangeAfterFullReset = Boolean(
      seriesFullResetDuringSync &&
        initializedRangeRef.current &&
        visibleRangeBeforeDataSync &&
        Number.isFinite(visibleRangeBeforeDataSync.from) &&
        Number.isFinite(visibleRangeBeforeDataSync.to),
    );
    const wantedProgrammaticRangeSync = Boolean(
      autoHydrationVisibleRange ||
        shouldFollowLatestBars ||
        shouldRestoreRangeAfterFullReset ||
        (!userViewportTouched &&
          initializedRangeRef.current &&
          !visibleRangeBeforeDataSync &&
          model.defaultVisibleLogicalRange &&
          nextBarCount > 0),
    );
    if (autoHydrationVisibleRange && canApplyProgrammaticRangeSync) {
      recordViewportDiagnostic(
        "viewportDefaultRangeApplies",
        "visibleRangeDefaultApplied",
      );
      setProgrammaticVisibleLogicalRange(autoHydrationVisibleRange, {
        markInitialized: true,
      });
    } else if (shouldFollowLatestBars && canApplyProgrammaticRangeSync) {
      recordViewportDiagnostic(
        "viewportRealtimeFollowApplies",
        "visibleRangeRealtimeFollow",
      );
      markProgrammaticViewportIntent();
      chartRef.current.timeScale().scrollToRealTime?.();
    } else if (canApplyProgrammaticRangeSync && shouldRestoreRangeAfterFullReset) {
      recordViewportDiagnostic(
        "viewportUserRangePreserves",
        "visibleRangeUserPreserved",
      );
      setProgrammaticVisibleLogicalRange(visibleRangeBeforeDataSync, {
        markProgrammaticIntent: false,
      });
    } else if (
      canApplyProgrammaticRangeSync &&
      !userViewportTouched &&
      initializedRangeRef.current &&
      !visibleRangeBeforeDataSync &&
      model.defaultVisibleLogicalRange &&
      nextBarCount > 0
    ) {
      recordViewportDiagnostic(
        "viewportDefaultRangeApplies",
        "visibleRangeDefaultApplied",
      );
      setProgrammaticVisibleLogicalRange(model.defaultVisibleLogicalRange);
    } else if (wantedProgrammaticRangeSync && !canApplyProgrammaticRangeSync) {
      recordViewportDiagnostic(
        "viewportSkippedResets",
        "visibleRangeResetSkipped",
      );
      recordChartHydrationCounter(
        "visibleRangeSyncDeferred",
        hydrationScopeKey,
      );
    }

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
    chartRef.current.priceScale("right", 0).applyOptions({
      autoScale,
      invertScale,
      visible: showRightPriceScale,
      borderVisible: showRightPriceScale,
      ticksVisible: showRightPriceScale,
      minimumWidth: compact ? 34 : 50,
      textColor: theme.textMuted,
      mode: resolvePriceScaleModeOption(scaleMode),
    });
    chartRef.current.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: theme.bg2 },
        textColor: theme.textMuted,
        fontFamily: theme.mono,
        fontSize: compact ? TYPE_PX.label : TYPE_PX.bodyStrong,
      },
      localization: {
        timeFormatter: (value: unknown) =>
          formatChartAxisTimestamp(value, userPreferences, ""),
      },
      grid: {
        vertLines: {
          color: withAlpha(theme.border, "30"),
          visible: effectiveShowGrid,
        },
        horzLines: {
          color: withAlpha(theme.border, "50"),
          visible: effectiveShowGrid,
        },
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
            pressedMouseMove: false,
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
        secondsVisible: userPreferences.time.showSeconds,
        ticksVisible: !hideTimeScale && showTimeScaleState,
        rightOffset: chartTimeScaleRightOffset,
        rightBarStaysOnScroll: false,
        lockVisibleTimeRangeOnResize: true,
        minBarSpacing: resolveMinBarSpacing(compact),
        tickMarkFormatter: (
          value: unknown,
          tickMarkType: unknown,
          locale: string | undefined,
        ) => formatChartTickMark(value, tickMarkType, locale, userPreferences),
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
    recordChartHydrationMetric(
      "seriesSyncMs",
      nowMs() - seriesSyncStartedAt,
      hydrationScopeKey,
    );
  }, [
    baseSeriesType,
    crosshairMode,
    model.chartBars,
    scaleMode,
    autoScale,
    invertScale,
    enableInteractions,
    hideCrosshair,
    showVolume,
    effectiveShowGrid,
    showPriceLine,
    showRightPriceScale,
    showTimeScaleState,
    chartTimeScaleRightOffset,
    compact,
    effectiveViewportSnapshot?.identityKey,
    effectiveViewportSnapshot?.userTouched,
    externalViewportUserTouched,
    hideTimeScale,
    userPreferences,
    viewportUserTouched,
    theme.border,
    theme.accent,
    theme.green,
    theme.red,
    theme.text,
    theme.textMuted,
    model.defaultVisibleLogicalRange,
    hydrationScopeKey,
    isViewportInteractionActive,
    markProgrammaticViewportIntent,
    setProgrammaticVisibleLogicalRange,
  ]);

  useLayoutEffect(() => {
    if (!chartRef.current || !hasChartBars) {
      return;
    }

    const storedVisibleRange = resolveViewportVisibleLogicalRange(
      visibleLogicalRangeRef.current,
    );
    if (visibleLogicalRangeRef.current && !storedVisibleRange) {
      visibleLogicalRangeRef.current = null;
    }

    const action = resolveVisibleRangeSyncAction({
      hasStoredRange: Boolean(storedVisibleRange),
      hasDefaultRange: Boolean(model.defaultVisibleLogicalRange),
      initialized: initializedRangeRef.current,
      pendingStoredRangeSync: pendingStoredRangeSyncRef.current,
    });
    const userViewportTouched = Boolean(
      externalViewportUserTouched ||
        viewportUserTouchedRef.current ||
        viewportUserTouched ||
        (effectiveViewportSnapshot?.identityKey ===
          rangeIdentityKeyRef.current &&
          effectiveViewportSnapshot.userTouched),
    );

    if (action === "noop") {
      return;
    }

    if (action === "stored" && storedVisibleRange) {
      setProgrammaticVisibleLogicalRange(storedVisibleRange);
    } else if (
      action === "default" &&
      model.defaultVisibleLogicalRange &&
      !userViewportTouched
    ) {
      const nextDefaultRange = autoHydrationViewportRef.current
        ? resolveAutoHydrationVisibleRange({
            barCount: model.chartBars.length,
            defaultVisibleRange: model.defaultVisibleLogicalRange,
          })
        : model.defaultVisibleLogicalRange;
      recordViewportDiagnostic(
        "viewportDefaultRangeApplies",
        "visibleRangeDefaultApplied",
      );
      setProgrammaticVisibleLogicalRange(nextDefaultRange);
    } else if (action === "fit") {
      markProgrammaticViewportIntent();
      chartRef.current.timeScale().fitContent();
    }

    initializedRangeRef.current = true;
    pendingStoredRangeSyncRef.current = false;
  }, [
    hasChartBars,
    model.chartBars.length,
    model.chartBars[0]?.time,
    model.defaultVisibleLogicalRange,
    effectiveViewportSnapshot?.identityKey,
    effectiveViewportSnapshot?.userTouched,
    externalViewportUserTouched,
    markProgrammaticViewportIntent,
    setProgrammaticVisibleLogicalRange,
    viewportUserTouched,
  ]);

  useLayoutEffect(() => {
    if (
      !chartRef.current ||
      !model.selectionFocus?.visibleLogicalRange ||
      model.selectionFocus.token === lastSelectionFocusTokenRef.current
    ) {
      return;
    }

    autoHydrationViewportRef.current = false;
    setProgrammaticVisibleLogicalRange(model.selectionFocus.visibleLogicalRange, {
      respectRecentUserRange: false,
    });
    initializedRangeRef.current = true;
    pendingStoredRangeSyncRef.current = false;
    lastSelectionFocusTokenRef.current = model.selectionFocus.token;
    setOverlayRevision((value) => value + 1);
  }, [model.selectionFocus, setProgrammaticVisibleLogicalRange]);

  useLayoutEffect(() => {
    if (!chartRef.current) {
      return;
    }

    studyRegistryRef.current = syncStudySeries(
      chartRef.current,
      studyRegistryRef.current,
      deferredModel.studySpecs,
      hydrationScopeKey,
    );
    applyChartPaneStretchFactors(chartRef.current, {
      compact,
      lowerPaneCount: deferredModel.studyLowerPaneCount,
    });
    setOverlayRevision((value) => value + 1);
  }, [
    compact,
    deferredModel.studyLowerPaneCount,
    deferredModel.studySpecs,
    hydrationScopeKey,
  ]);

  useLayoutEffect(() => {
    if (!markerApisRef.current.length) {
      return;
    }

    const visibleLogicalRange = visibleLogicalRangeRef.current;
    const chart = chartRef.current;
    const markers = [
      ...deferredModel.indicatorMarkerPayload.overviewMarkers,
      ...buildTradeMarkers(deferredModel, theme),
    ]
      .filter((marker) =>
        isMarkerVisibleInLogicalRange(
          marker,
          visibleLogicalRange,
          deferredModel.chartBars.length,
        ),
      )
      .filter((marker) => {
        if (!chart || !plotSize.width || !plotSize.height) {
          return true;
        }

        const x = chart.timeScale().timeToCoordinate(marker.time);
        if (!Number.isFinite(x)) {
          return false;
        }

        const drawableWidth = resolveChartDrawableWidth(chart, plotSize.width);
        const textWidth = marker.text
          ? estimateMonoTextWidth(marker.text, compact ? 8 : 10, 2)
          : 0;
        const rightPadding = Math.max(24, textWidth + 16);

        return x >= 14 && x <= drawableWidth - rightPadding;
      })
      .map((marker) => ({
        time: marker.time,
        position: marker.position,
        shape: marker.shape,
        color: marker.color,
        text: marker.text,
        size: marker.size,
      }));
    const markerSignature = JSON.stringify(markers);
    if (markerSignatureRef.current === markerSignature) {
      return;
    }
    markerSignatureRef.current = markerSignature;
    markerApisRef.current.forEach((markerApi) => markerApi.setMarkers(markers));
    surfaceDiagnosticsRef.current.markerSetCalls += 1;
    writeSurfaceDiagnosticsAttributes();
  }, [
    deferredModel.chartBars.length,
    deferredModel.indicatorMarkerPayload,
    deferredModel.tradeMarkerGroups,
    compact,
    overlayRevision,
    plotSize.height,
    plotSize.width,
    theme,
  ]);

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
  }, [
    drawings,
    referenceLines,
    theme.amber,
  ]);

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
      syncChartEventOverlaysState([]);
      syncFlowVolumeOverlaysState([]);
      setFlowTooltip(null);
      syncIndicatorDashboardOverlayState(null);
      syncTradeThresholdOverlaysState([]);
      syncSelectedTradeConnectorState(null);
      syncSelectedTradeEntryBadgeState(null);
      syncSelectedTradeExitBadgeState(null);
      return;
    }

    const overlaySyncStartedAt = nowMs();
    const viewportWidth = resolveChartDrawableWidth(
      chartRef.current,
      containerRef.current.clientWidth,
    );
    const viewportHeight = resolveChartDrawableHeight(
      chartRef.current,
      containerRef.current.clientHeight,
    );
    syncOverlayState(
      setWindowOverlays,
      buildWindowOverlays(
        chartRef.current,
        deferredModel,
        theme,
        viewportWidth,
        viewportHeight,
        extendedSessionWindows,
      ),
    );
    syncOverlayState(
      setZoneOverlays,
      buildZoneOverlays(
        chartRef.current,
        activePriceSeriesRef.current,
        deferredModel,
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
      showTradePositionOverlays
        ? buildTradeMarkerTargets(
            chartRef.current,
            activePriceSeriesRef.current,
            deferredModel,
            theme,
            viewportWidth,
            viewportHeight,
          )
        : [],
    );
    const indicatorEventOverlays = buildIndicatorEventOverlays(
      chartRef.current,
      activePriceSeriesRef.current,
      deferredModel,
      viewportWidth,
      viewportHeight,
    );
    syncIndicatorBadgeOverlaysState(indicatorEventOverlays.badges);
    syncIndicatorDotOverlaysState(indicatorEventOverlays.dots);
    const nonFlowChartEvents = visibleChartEvents.filter(
      (event) => event.eventType !== "unusual_flow",
    );
    syncChartEventOverlaysState([
      ...buildChartEventOverlays(
        chartRef.current,
        activePriceSeriesRef.current,
        deferredModel,
        nonFlowChartEvents,
        viewportWidth,
        viewportHeight,
      ),
      ...buildFlowChartEventOverlays(
        chartRef.current,
        activePriceSeriesRef.current,
        flowChartModel,
        flowChartBuckets,
        viewportWidth,
        viewportHeight,
      ),
    ]);
    syncFlowVolumeOverlaysState(
      buildFlowVolumeOverlays(
        chartRef.current,
        flowChartModel,
        flowChartBuckets,
        viewportWidth,
        viewportHeight,
      ),
    );
    syncIndicatorDashboardOverlayState(indicatorEventOverlays.dashboard);
    const selectedTradeOverlays = showTradePositionOverlays
      ? buildSelectedTradeOverlays(
          chartRef.current,
          activePriceSeriesRef.current,
          deferredModel,
          theme,
          viewportWidth,
          viewportHeight,
        )
      : {
          entryBadge: null,
          exitBadge: null,
          connector: null,
          thresholdSegments: [],
        };
    syncTradeThresholdOverlaysState(selectedTradeOverlays.thresholdSegments);
    syncSelectedTradeConnectorState(selectedTradeOverlays.connector);
    syncSelectedTradeEntryBadgeState(selectedTradeOverlays.entryBadge);
    syncSelectedTradeExitBadgeState(selectedTradeOverlays.exitBadge);
    recordChartHydrationMetric(
      "deferredOverlayMs",
      nowMs() - overlaySyncStartedAt,
      hydrationScopeKey,
    );
  }, [
    baseSeriesType,
    drawings,
    flowChartBuckets,
    flowChartModel,
    deferredModel.chartBars,
    deferredModel.activeTradeSelectionId,
    deferredModel.indicatorEvents,
    deferredModel.tradeMarkerGroups,
    deferredModel.tradeOverlays,
    deferredModel.indicatorWindows,
    deferredModel.indicatorZones,
    extendedSessionWindows,
    hydrationScopeKey,
    overlayRevision,
    plotSize.height,
    plotSize.width,
    rootWidth,
    scaleMode,
    showTradePositionOverlays,
    visibleChartEvents,
    theme.accent,
    theme.amber,
    theme.blue,
    theme.cyan,
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

        setPlotSize((current) => {
          if (current.width === nextWidth && current.height === nextHeight) {
            return current;
          }

          lastPlotResizeAtRef.current = Date.now();
          return { width: nextWidth, height: nextHeight };
        });
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
  useLayoutEffect(() => {
    if (
      !chartRef.current ||
      !effectiveViewportSnapshot?.userTouched ||
      effectiveViewportSnapshot.identityKey !== rangeIdentityKeyRef.current ||
      viewportPointerActiveRef.current ||
      plotPanRef.current ||
      ((effectiveViewportSnapshot.updatedAt || 0) <
        lastLocalUserViewportAtRef.current)
    ) {
      return;
    }

    const snapshotRange = resolveViewportVisibleLogicalRange(
      effectiveViewportSnapshot.visibleLogicalRange,
    );
    if (!snapshotRange) {
      return;
    }

    const currentRange = resolveViewportVisibleLogicalRange(
      chartRef.current.timeScale().getVisibleLogicalRange?.() ||
        visibleLogicalRangeRef.current,
    );
    if (
      buildVisibleRangeSignature(currentRange) ===
      buildVisibleRangeSignature(snapshotRange)
    ) {
      return;
    }

    setProgrammaticVisibleLogicalRange(snapshotRange, {
      markInitialized: true,
      markProgrammaticIntent: !effectiveViewportSnapshot.userTouched,
    });
  }, [
    effectiveViewportSnapshot?.identityKey,
    effectiveViewportSnapshot?.updatedAt,
    effectiveViewportSnapshot?.userTouched,
    effectiveViewportSnapshot?.visibleLogicalRange?.from,
    effectiveViewportSnapshot?.visibleLogicalRange?.to,
    plotSize.height,
    plotSize.width,
    setProgrammaticVisibleLogicalRange,
  ]);
  useLayoutEffect(() => {
    if (!chartRef.current || !plotSize.width || !plotSize.height) {
      return;
    }

    chartRef.current.resize?.(plotSize.width, plotSize.height);
    if (autoScale && showRightPriceScale) {
      chartRef.current.priceScale?.("right", 0)?.setAutoScale?.(true);
    }

    const userViewportTouched = Boolean(
      externalViewportUserTouched ||
        viewportUserTouchedRef.current ||
        viewportUserTouched ||
        (effectiveViewportSnapshot?.identityKey ===
          rangeIdentityKeyRef.current &&
          effectiveViewportSnapshot.userTouched),
    );
    if (
      !userViewportTouched &&
      autoHydrationViewportRef.current &&
      model.defaultVisibleLogicalRange &&
      model.chartBars.length > 0 &&
      !isViewportInteractionActive()
    ) {
      recordViewportDiagnostic(
        "viewportDefaultRangeApplies",
        "visibleRangeDefaultApplied",
      );
      setProgrammaticVisibleLogicalRange(
        resolveAutoHydrationVisibleRange({
          barCount: model.chartBars.length,
          defaultVisibleRange: model.defaultVisibleLogicalRange,
        }) || model.defaultVisibleLogicalRange,
        { markInitialized: true },
      );
    }
  }, [
    autoScale,
    effectiveViewportSnapshot?.identityKey,
    effectiveViewportSnapshot?.userTouched,
    externalViewportUserTouched,
    isViewportInteractionActive,
    model.chartBars.length,
    model.defaultVisibleLogicalRange,
    plotSize.height,
    plotSize.width,
    setProgrammaticVisibleLogicalRange,
    showRightPriceScale,
    viewportUserTouched,
  ]);
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
    formatChartPriceAxisValue(value, pricePrecision);
  const deltaColor = (displayDeltaValue ?? 0) >= 0 ? theme.green : theme.red;
  const legendStudies = legend?.studies || EMPTY_LEGEND_STUDIES;
  const selectedLegendStudies =
    legend?.selectedStudies || EMPTY_SELECTED_LEGEND_STUDIES;
  const legendStudyItems = useMemo(
    () =>
      buildChartLegendStudyItems({
        studySpecs: deferredModel.studySpecs,
        studies: legendStudies,
        selectedStudies: selectedLegendStudies,
        time: displayBar?.time,
        fallbackColor: theme.accent || theme.text,
      }),
    [
      displayBar?.time,
      legendStudies,
      deferredModel.studySpecs,
      selectedLegendStudies,
      theme.accent,
      theme.text,
    ],
  );
  const legendSourceLabel = formatLegendSourceLabel(
    displayBar?.source,
    legend?.meta?.sourceLabel,
  );
  const legendStatusColor =
    legend?.statusTone === "good"
      ? theme.green
      : legend?.statusTone === "warn"
        ? theme.amber
        : legend?.statusTone === "bad"
          ? theme.red
          : legend?.statusTone === "neutral" || legend?.statusTone === "info"
            ? (theme.accent || theme.text)
            : legend?.statusLabel && /live|open|stream|massive|ibkr/i.test(legend.statusLabel)
              ? theme.green
              : theme.textMuted;
  const emptyStateEyebrow = emptyState?.eyebrow || "Chart feed";
  const emptyStateTitle =
    emptyState?.title ||
    legend?.statusLabel ||
    legendSourceLabel ||
    "Chart data unavailable";
  const emptyStateDetail =
    emptyState?.detail ||
    (legend?.symbol
      ? `${legend.symbol} ${legend?.timeframe || ""} bars are not hydrated yet. Controls remain available while the feed reconnects or the symbol changes.`
      : "Chart bars are not hydrated yet. Controls remain available while the feed reconnects or the symbol changes.");
  const legendDetailMode = userPreferences.chart.statusLineDetail;
  const legendMinimal = legendDetailMode === "minimal";
  const legendCompactMode = compact || legendDetailMode === "compact";
  const legendName = legendCompactMode || legendMinimal ? null : legend?.name;
  const legendDeltaPct = displayDeltaPct ?? legend?.changePercent ?? null;
  const legendShowOhlc = userPreferences.chart.showOhlc && !legendMinimal;
  const legendShowVolume = userPreferences.chart.showVolume && !legendMinimal;
  const legendShowStudies =
    userPreferences.chart.showIndicatorValues && !legendMinimal;
  const setAdjustedVisibleRange = (
    nextRange: { from: number; to: number } | null,
  ) => {
    if (!chartRef.current || !nextRange) {
      return;
    }

    autoHydrationViewportRef.current = false;
    programmaticVisibleRangeSignatureRef.current = null;
    chartRef.current.timeScale().setVisibleLogicalRange(nextRange);
    publishVisibleLogicalRange(nextRange, {
      markInitialized: true,
      source: "user",
    });
  };
  const zoomVisibleRange = (factor: number) => {
    const currentRange =
      visibleLogicalRangeRef.current ||
      chartRef.current?.timeScale?.().getVisibleLogicalRange?.();
    setAdjustedVisibleRange(resolveZoomedVisibleRange({ currentRange, factor }));
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
  const clearFlowTooltipHideTimer = useCallback(() => {
    if (flowTooltipHideTimerRef.current !== null) {
      clearTimeout(flowTooltipHideTimerRef.current);
      flowTooltipHideTimerRef.current = null;
    }
  }, []);
  const showFlowTooltip = useCallback(
    ({
      id,
      left,
      top,
      model: tooltipModel,
    }: {
      id: string;
      left: number;
      top: number;
      model: FlowTooltipModel;
    }) => {
      clearFlowTooltipHideTimer();
      setFlowTooltip({
        id,
        left: clampCoordinate(
          left + 10,
          8,
          Math.max(8, plotSize.width - FLOW_TOOLTIP_WIDTH - 12),
        ),
        top: clampCoordinate(
          top - 10,
          8,
          Math.max(8, plotSize.height - FLOW_TOOLTIP_ESTIMATED_HEIGHT),
        ),
        model: tooltipModel,
      });
    },
    [clearFlowTooltipHideTimer, plotSize.height, plotSize.width],
  );
  const scheduleHideFlowTooltip = useCallback(
    (id: string) => {
      clearFlowTooltipHideTimer();
      flowTooltipHideTimerRef.current = setTimeout(() => {
        flowTooltipHideTimerRef.current = null;
        setFlowTooltip((current) => (current?.id === id ? null : current));
      }, FLOW_TOOLTIP_HIDE_DELAY_MS);
    },
    [clearFlowTooltipHideTimer],
  );
  const scheduleCurrentFlowTooltipHide = useCallback(() => {
    const currentId = flowTooltip?.id;
    if (currentId) {
      scheduleHideFlowTooltip(currentId);
    }
  }, [flowTooltip?.id, scheduleHideFlowTooltip]);
  const copyFlowContract = useCallback((contract: string) => {
    if (!contract || typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }
    void navigator.clipboard.writeText(contract);
  }, []);
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
  const clearRememberedViewport = (nextVisibleRange: VisibleLogicalRange | null = null) => {
    lastUserVisibleRangeRef.current = null;
    syncViewportUserTouched(false, { force: true });
    publishViewportSnapshot(
      buildViewportSnapshot({
        visibleRange: nextVisibleRange,
        userTouched: false,
        realtimeFollow: true,
      }),
    );
  };
  const resetVisibleRange = () => {
    const nextDefaultRange = resolveAutoHydrationVisibleRange({
      barCount: model.chartBars.length,
      defaultVisibleRange: model.defaultVisibleLogicalRange,
    });
    autoHydrationViewportRef.current = true;
    realtimeFollowRef.current = true;
    visibleLogicalRangeRef.current = nextDefaultRange;
    pendingStoredRangeSyncRef.current = true;
    setAutoScale(true);
    chartRef.current?.priceScale?.("right", 0)?.setAutoScale?.(true);
    if (nextDefaultRange) {
      setProgrammaticVisibleLogicalRange(nextDefaultRange, {
        markInitialized: true,
        respectRecentUserRange: false,
      });
    } else {
      markProgrammaticViewportIntent();
      chartRef.current?.timeScale?.().resetTimeScale?.();
    }
    clearRememberedViewport(nextDefaultRange);
  };
  const fitVisibleRange = () => {
    autoHydrationViewportRef.current = false;
    realtimeFollowRef.current = false;
    programmaticVisibleRangeSignatureRef.current = null;
    markProgrammaticViewportIntent();
    chartRef.current?.timeScale?.().fitContent?.();
  };
  const scrollToRealtime = () => {
    autoHydrationViewportRef.current = true;
    realtimeFollowRef.current = true;
    visibleLogicalRangeRef.current = null;
    pendingStoredRangeSyncRef.current = true;
    markProgrammaticViewportIntent();
    chartRef.current?.timeScale?.().scrollToRealTime?.();
    clearRememberedViewport(null);
  };
  const handleRootWheelCapture = (event: WheelEvent<HTMLDivElement>) => {
    markUserViewportIntent(event.target, "wheel", {
      clientX: event.clientX,
      clientY: event.clientY,
    });
  };
  const handleRootClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (isChartControlEventTarget(event.target)) {
      return;
    }
    if (
      Date.now() - lastPlotViewportIntentAtRef.current <=
      USER_VIEWPORT_INTENT_WINDOW_MS
    ) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  const markPlotViewportDragIntent = (
    event: MouseEvent<HTMLDivElement> | PointerEvent<HTMLDivElement>,
  ) => {
    if (
      isChartControlEventTarget(event.target) ||
      !enableInteractions ||
      drawMode ||
      (event.buttons & 1) !== 1
    ) {
      return false;
    }

    const container = containerRef.current;
    if (!container || !chartRef.current) {
      return false;
    }

    const rect = container.getBoundingClientRect();
    const insidePlot = isPointInsideRect({
      x: event.clientX,
      y: event.clientY,
      rect,
    });
    if (!insidePlot) {
      return false;
    }

    const priceScaleWidth =
      chartRef.current.priceScale?.("right", 0)?.width?.() || 0;
    const insideRightPriceScale = isPointInsideRightPriceScale({
      x: event.clientX,
      y: event.clientY,
      rect,
      priceScaleWidth,
    });
    if (insideRightPriceScale) {
      return false;
    }

    const now = Date.now();
    lastPlotViewportIntentAtRef.current = now;
    lastUserViewportIntentAtRef.current = now;
    return true;
  };
  const movePlotPanToPoint = (
    clientX: number,
    clientY: number,
    event?: { preventDefault?: () => void; stopPropagation?: () => void },
  ) => {
    const pan = plotPanRef.current;
    if (!pan) {
      return false;
    }

    const next = resolveChartPlotPanRange({
      pan,
      clientX,
      clientY,
    });
    if (!next) {
      return false;
    }

    plotPanRef.current = next.pan;
    lastPlotPanVisibleRangeRef.current = next.visibleRange;
    lastPlotViewportIntentAtRef.current = Date.now();
    event?.preventDefault?.();
    event?.stopPropagation?.();
    setAdjustedVisibleRange(next.visibleRange);
    return true;
  };
  const reapplyFinalPlotPanRange = () => {
    const finalRange = lastPlotPanVisibleRangeRef.current;
    if (!finalRange || typeof window === "undefined") {
      return;
    }
    const finalSignature = buildVisibleRangeSignature(finalRange);
    const reapply = () => {
      const userSignature = lastUserVisibleRangeRef.current
        ? buildVisibleRangeSignature(lastUserVisibleRangeRef.current)
        : null;
      if (userSignature && userSignature !== finalSignature) {
        return;
      }
      setAdjustedVisibleRange(finalRange);
    };
    window.requestAnimationFrame(reapply);
    window.setTimeout(reapply, 120);
    window.setTimeout(reapply, 300);
  };
  const cleanupPlotPanWindowListeners = () => {
    plotPanWindowCleanupRef.current?.();
    plotPanWindowCleanupRef.current = null;
  };
  const cleanupPlotMousePanWindowListeners = () => {
    plotMousePanWindowCleanupRef.current?.();
    plotMousePanWindowCleanupRef.current = null;
  };
  const handleRootPointerDownCapture = (
    event: PointerEvent<HTMLDivElement>,
  ) => {
    if (isChartControlEventTarget(event.target)) {
      return;
    }

    markUserViewportIntent(event.target, "pointer", {
      clientX: event.clientX,
      clientY: event.clientY,
    });

    plotPanRef.current = null;
    lastPlotPanVisibleRangeRef.current = null;
    cleanupPlotPanWindowListeners();

    const container = containerRef.current;
    if (!container || !chartRef.current) {
      return;
    }

    const rect = container.getBoundingClientRect();
    const isInsidePlot = isPointInsideRect({
      x: event.clientX,
      y: event.clientY,
      rect,
    });
    if (!isInsidePlot) {
      return;
    }

    const priceScale = chartRef.current.priceScale?.("right", 0);
    const priceScaleWidth = priceScale?.width?.() || 0;
    const isInsidePriceScale = isPointInsideRightPriceScale({
      x: event.clientX,
      y: event.clientY,
      rect,
      priceScaleWidth,
    });
    if (
      event.button === 0 &&
      enableInteractions &&
      !drawMode &&
      !isInsidePriceScale
    ) {
      lastPlotViewportIntentAtRef.current = Date.now();
    }
    const currentRange =
      visibleLogicalRangeRef.current ||
      chartRef.current.timeScale?.().getVisibleLogicalRange?.() ||
      model.defaultVisibleLogicalRange;
    plotPanRef.current = resolveChartPlotPanStart({
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      currentRange,
      plotWidth: rect.width - Math.max(0, priceScaleWidth),
      enabled: enableInteractions,
      drawMode,
      button: event.button,
      insidePlot: isInsidePlot,
      insideRightPriceScale: isInsidePriceScale,
    });
    if (plotPanRef.current) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (plotPanRef.current && event.currentTarget.setPointerCapture) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch (_error) {}
    }
    if (plotPanRef.current && typeof window !== "undefined") {
      const pointerId = event.pointerId;
      const handleWindowPointerMove = (moveEvent: globalThis.PointerEvent) => {
        if (plotPanRef.current?.pointerId !== pointerId) {
          return;
        }
        movePlotPanToPoint(moveEvent.clientX, moveEvent.clientY, moveEvent);
      };
      const handleWindowPointerEnd = (endEvent: globalThis.PointerEvent) => {
        if (plotPanRef.current?.pointerId === pointerId && plotPanRef.current.active) {
          endEvent.preventDefault();
          endEvent.stopPropagation();
          reapplyFinalPlotPanRange();
        }
        plotPanRef.current = null;
        cleanupPlotPanWindowListeners();
      };
      window.addEventListener("pointermove", handleWindowPointerMove, true);
      window.addEventListener("pointerup", handleWindowPointerEnd, true);
      window.addEventListener("pointercancel", handleWindowPointerEnd, true);
      plotPanWindowCleanupRef.current = () => {
        window.removeEventListener("pointermove", handleWindowPointerMove, true);
        window.removeEventListener("pointerup", handleWindowPointerEnd, true);
        window.removeEventListener("pointercancel", handleWindowPointerEnd, true);
      };
    }

    if (!autoScale || !showRightPriceScale || !isInsidePriceScale) {
      return;
    }

    realtimeFollowRef.current = false;
    priceScale?.setAutoScale?.(false);
    setAutoScale(false);
  };
  const handleRootPointerMoveCapture = (
    event: PointerEvent<HTMLDivElement>,
  ) => {
    markPlotViewportDragIntent(event);
    const pan = plotPanRef.current;
    if (!pan || pan.pointerId !== event.pointerId) {
      return;
    }

    movePlotPanToPoint(event.clientX, event.clientY, event);
  };
  const handleRootPointerUpCapture = (
    event: PointerEvent<HTMLDivElement>,
  ) => {
    if (plotPanRef.current?.pointerId === event.pointerId) {
      if (plotPanRef.current.active) {
        event.preventDefault();
        event.stopPropagation();
        reapplyFinalPlotPanRange();
      }
      if (event.currentTarget.releasePointerCapture) {
        try {
          event.currentTarget.releasePointerCapture(event.pointerId);
        } catch (_error) {}
      }
      plotPanRef.current = null;
      cleanupPlotPanWindowListeners();
    }
  };
  const handleRootPointerCancelCapture = (
    event: PointerEvent<HTMLDivElement>,
  ) => {
    if (plotPanRef.current?.pointerId === event.pointerId) {
      if (event.currentTarget.releasePointerCapture) {
        try {
          event.currentTarget.releasePointerCapture(event.pointerId);
        } catch (_error) {}
      }
      plotPanRef.current = null;
      cleanupPlotPanWindowListeners();
    }
  };
  const beginMousePlotPan = (event: MouseEvent<HTMLDivElement>) => {
    if (isChartControlEventTarget(event.target)) {
      return;
    }

    markUserViewportIntent(event.target, "pointer", {
      clientX: event.clientX,
      clientY: event.clientY,
    });

    cleanupPlotMousePanWindowListeners();
    lastPlotPanVisibleRangeRef.current = null;
    if (plotPanRef.current || !chartRef.current) {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    const rect = container.getBoundingClientRect();
    const priceScaleWidth =
      chartRef.current.priceScale?.("right", 0)?.width?.() || 0;
    const insidePlot = isPointInsideRect({
      x: event.clientX,
      y: event.clientY,
      rect,
    });
    const insideRightPriceScale = isPointInsideRightPriceScale({
      x: event.clientX,
      y: event.clientY,
      rect,
      priceScaleWidth,
    });
    if (
      event.button === 0 &&
      enableInteractions &&
      !drawMode &&
      !insideRightPriceScale
    ) {
      lastPlotViewportIntentAtRef.current = Date.now();
    }
    const currentRange =
      visibleLogicalRangeRef.current ||
      chartRef.current.timeScale?.().getVisibleLogicalRange?.() ||
      model.defaultVisibleLogicalRange;

    plotPanRef.current = resolveChartPlotPanStart({
      pointerId: -1,
      startX: event.clientX,
      startY: event.clientY,
      currentRange,
      plotWidth: rect.width - Math.max(0, priceScaleWidth),
      enabled: enableInteractions,
      drawMode,
      button: event.button,
      insidePlot,
      insideRightPriceScale,
    });
    if (plotPanRef.current) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (plotPanRef.current && typeof window !== "undefined") {
      const handleWindowMouseMove = (moveEvent: globalThis.MouseEvent) => {
        if (plotPanRef.current?.pointerId !== -1) {
          return;
        }
        movePlotPanToPoint(moveEvent.clientX, moveEvent.clientY, moveEvent);
      };
      const handleWindowMouseEnd = (endEvent: globalThis.MouseEvent) => {
        if (plotPanRef.current?.pointerId === -1 && plotPanRef.current.active) {
          endEvent.preventDefault();
          endEvent.stopPropagation();
          reapplyFinalPlotPanRange();
        }
        plotPanRef.current = null;
        cleanupPlotMousePanWindowListeners();
      };
      window.addEventListener("mousemove", handleWindowMouseMove, true);
      window.addEventListener("mouseup", handleWindowMouseEnd, true);
      plotMousePanWindowCleanupRef.current = () => {
        window.removeEventListener("mousemove", handleWindowMouseMove, true);
        window.removeEventListener("mouseup", handleWindowMouseEnd, true);
      };
    }
  };
  const moveMousePlotPan = (event: MouseEvent<HTMLDivElement>) => {
    markPlotViewportDragIntent(event);
    const pan = plotPanRef.current;
    if (!pan || (event.buttons & 1) !== 1) {
      return;
    }

    const next = resolveChartPlotPanRange({
      pan,
      clientX: event.clientX,
      clientY: event.clientY,
    });
    if (!next) {
      return;
    }

    plotPanRef.current = next.pan;
    lastPlotPanVisibleRangeRef.current = next.visibleRange;
    lastPlotViewportIntentAtRef.current = Date.now();
    event.preventDefault();
    event.stopPropagation();
    setAdjustedVisibleRange(next.visibleRange);
  };
  const endMousePlotPan = (event: MouseEvent<HTMLDivElement>) => {
    if (!plotPanRef.current) {
      return;
    }
    if (plotPanRef.current.active) {
      event.preventDefault();
      event.stopPropagation();
      reapplyFinalPlotPanRange();
    }
    plotPanRef.current = null;
    cleanupPlotPanWindowListeners();
    cleanupPlotMousePanWindowListeners();
  };
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
  const isNarrowFrame = rootWidth > 0 && rootWidth < 920;
  const chromeGap = isNarrowFrame ? 6 : 8;
  const topChromeBase = topOverlayHeight + 6;
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
  const chartInsetTop = 0;
  const chartInsetLeft = resolvedLeftOverlay ? leftOverlayWidth : 0;
  const drawablePlotWidth = resolveChartDrawableWidth(
    chartRef.current,
    plotSize.width,
  );
  const drawablePlotHeight = resolveChartDrawableHeight(
    chartRef.current,
    plotSize.height,
  );
  const dashboardOverlayForDisplay = indicatorDashboardOverlay &&
    userPreferences.chart.rayAlgoDashboard !== "hidden"
    ? {
        ...indicatorDashboardOverlay,
        rows: (() => {
          let hasSessionRow = false;
          const rows = indicatorDashboardOverlay.rows.map((row) => {
            if (normalizeDashboardStripText(row.label).toUpperCase() !== "SESSION") {
              return row;
            }
            hasSessionRow = true;
            return {
              ...row,
              value: dashboardMarketSession.label,
              detail: dashboardMarketSession.title,
              color: dashboardMarketSession.open ? theme.green : theme.textMuted,
            };
          });
          return hasSessionRow
            ? rows
            : [
                ...rows,
                {
                  label: "SESSION",
                  value: dashboardMarketSession.label,
                  detail: dashboardMarketSession.title,
                  color: dashboardMarketSession.open ? theme.green : theme.textMuted,
                },
              ];
        })(),
      }
    : null;
  const dashboardTier = dashboardOverlayForDisplay
    ? userPreferences.chart.rayAlgoDashboard === "full"
      ? "full"
      : userPreferences.chart.rayAlgoDashboard === "compact"
        ? "compact"
        : resolveDashboardStripTier(plotSize.width, compact)
    : "full";
  const dashboardDensity = dashboardOverlayForDisplay
    ? resolveDashboardDensity(
        dashboardOverlayForDisplay.size,
        compact,
        dashboardTier,
      )
    : null;
  const dashboardSegments = dashboardOverlayForDisplay
    ? buildIndicatorDashboardStripSegments(
        dashboardOverlayForDisplay,
        dashboardTier,
      )
    : [];
  const dashboardStripGap = dashboardOverlayForDisplay ? (compact ? 2 : 3) : 0;
  const dashboardStripReservedHeight = dashboardDensity
    ? dashboardDensity.height + dashboardStripGap
    : 0;
  const dashboardBottomOffset =
    dashboardOverlayForDisplay && resolvedBottomOverlay ? bottomOverlayHeight : 0;
  const chartInsetBottom = dashboardStripReservedHeight + dashboardBottomOffset;
  const leftOverlayInsetTop = resolvedTopOverlay ? topOverlayHeight : 0;
  const leftOverlayInsetBottom =
    chartInsetBottom || (resolvedBottomOverlay ? bottomOverlayHeight : 0);
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
  const activeViewportSnapshot = chartViewportSnapshotMatchesContext(
    effectiveViewportSnapshot,
    rangeIdentityKey ?? null,
    normalizedViewportLayoutKey,
  )
    ? effectiveViewportSnapshot
    : null;
  const activeViewportRangeSignature = buildVisibleRangeSignature(
    visibleLogicalRangeRef.current ?? activeViewportSnapshot?.visibleLogicalRange,
  );
  const latestRenderedBar =
    model.chartBars.length > 0
      ? model.chartBars[model.chartBars.length - 1]
      : null;
  const latestQuoteUpdatedAtMs = resolveDateLikeMs(latestQuoteUpdatedAt);
  const latestQuoteAgeMs =
    latestQuoteUpdatedAtMs != null
      ? Math.max(0, Date.now() - latestQuoteUpdatedAtMs)
      : null;
  const watchlistChartPriceDelta =
    Number.isFinite(latestQuotePrice) && Number.isFinite(latestRenderedBar?.c)
      ? Number((Number(latestRenderedBar?.c) - Number(latestQuotePrice)).toFixed(6))
      : null;
  const flowChartEventCount = visibleChartEvents.filter(
    (event) => event.eventType === "unusual_flow",
  ).length;
  const rawFlowInputCount =
    chartFlowDiagnostics?.rawInputCount ?? flowChartEventCount;
  const convertedFlowEventCount =
    chartFlowDiagnostics?.convertedEventCount ?? flowChartEventCount;
  const conversionInvalidTimeDropCount =
    chartFlowDiagnostics?.droppedInvalidTimeCount ?? 0;
  const conversionSymbolDropCount = chartFlowDiagnostics?.droppedSymbolCount ?? 0;
  const uniqueFlowEventCount =
    flowChartBucketDiagnostics.uniqueFlowEventCount ?? flowChartEventCount;
  const confirmedTradeFlowEventCount =
    flowChartBucketDiagnostics.confirmedTradeFlowEventCount ?? 0;
  const snapshotActivityFlowEventCount =
    flowChartBucketDiagnostics.snapshotActivityFlowEventCount ?? 0;
  const otherFlowEventCount = flowChartBucketDiagnostics.otherFlowEventCount ?? 0;
  const duplicateFlowEventDropCount =
    flowChartBucketDiagnostics.droppedDuplicateFlowEventCount ?? 0;
  const renderedFlowMarkerCount = chartEventOverlays.filter(
    (overlay) => overlay.eventType === "unusual_flow",
  ).length;
  const chartFlowHydrationState =
    flowChartEventCount <= 0
      ? rawFlowInputCount > 0
        ? "conversion-empty"
        : "empty"
      : flowChartBucketDiagnostics.bucketedEventCount <= 0
        ? "outside-loaded-bars"
        : flowChartBucketDiagnostics.bucketedEventCount < uniqueFlowEventCount
          ? "partial"
          : "hydrated";
  const extendedSessionBarCount =
    marketSessionBarCounts.pre + marketSessionBarCounts.after;
  const surfaceDiagnostics = surfaceDiagnosticsRef.current;

  return (
    <div
      ref={rootRef}
      data-testid={dataTestId}
      data-chart-surface-module-version={RESEARCH_CHART_SURFACE_MODULE_VERSION}
      data-chart-surface-module-source="ResearchChartSurface.tsx"
      data-chart-range-identity={rangeIdentityKey || undefined}
      data-chart-viewport-layout={normalizedViewportLayoutKey || undefined}
      data-chart-viewport-user-touched={
        activeViewportSnapshot?.userTouched ||
        externalViewportUserTouched ||
        viewportUserTouched ||
        viewportUserTouchedRef.current
          ? "true"
          : "false"
      }
      data-chart-visible-logical-range={activeViewportRangeSignature}
      data-chart-rendered-bar-count={model.chartBars.length}
      data-chart-latest-source={latestRenderedBar?.source || ""}
      data-chart-latest-freshness={latestRenderedBar?.freshness || ""}
      data-chart-latest-market-data-mode={latestRenderedBar?.marketDataMode || ""}
      data-chart-latest-delayed={latestRenderedBar?.delayed ? "true" : "false"}
      data-chart-latest-quote-age-ms={latestQuoteAgeMs ?? ""}
      data-chart-watchlist-price-delta={watchlistChartPriceDelta ?? ""}
      data-chart-events-count={visibleChartEvents.length}
      data-chart-flow-raw-input-count={rawFlowInputCount}
      data-chart-flow-converted-count={convertedFlowEventCount}
      data-chart-flow-events-count={flowChartEventCount}
      data-chart-flow-unique-event-count={uniqueFlowEventCount}
      data-chart-flow-confirmed-event-count={confirmedTradeFlowEventCount}
      data-chart-flow-snapshot-event-count={snapshotActivityFlowEventCount}
      data-chart-flow-other-event-count={otherFlowEventCount}
      data-chart-flow-duplicate-drop-count={duplicateFlowEventDropCount}
      data-chart-flow-hydration-state={chartFlowHydrationState}
      data-chart-flow-bucket-count={flowChartBuckets.length}
      data-chart-flow-bucketed-event-count={
        flowChartBucketDiagnostics.bucketedEventCount
      }
      data-chart-flow-bucketed-confirmed-event-count={
        flowChartBucketDiagnostics.bucketedConfirmedTradeEventCount
      }
      data-chart-flow-bucketed-snapshot-event-count={
        flowChartBucketDiagnostics.bucketedSnapshotActivityEventCount
      }
      data-chart-flow-bucketed-other-event-count={
        flowChartBucketDiagnostics.bucketedOtherEventCount
      }
      data-chart-flow-marker-count={renderedFlowMarkerCount}
      data-chart-flow-volume-count={flowVolumeOverlays.length}
      data-chart-regular-volume-enabled={showVolume ? "true" : "false"}
      data-chart-flow-invalid-time-drop-count={
        conversionInvalidTimeDropCount +
        flowChartBucketDiagnostics.droppedInvalidTimeCount
      }
      data-chart-flow-symbol-drop-count={conversionSymbolDropCount}
      data-chart-flow-outside-bar-drop-count={
        flowChartBucketDiagnostics.droppedOutsideBarCount
      }
      data-chart-extended-session-enabled={
        userPreferences.chart.extendedHours ? "true" : "false"
      }
      data-chart-extended-session-window-count={extendedSessionWindows.length}
      data-chart-extended-session-bar-count={extendedSessionBarCount}
      data-chart-pre-bar-count={marketSessionBarCounts.pre}
      data-chart-rth-bar-count={marketSessionBarCounts.rth}
      data-chart-after-bar-count={marketSessionBarCounts.after}
      data-chart-realtime-follow={realtimeFollowRef.current ? "true" : "false"}
      data-chart-auto-hydration={autoHydrationViewportRef.current ? "true" : "false"}
      data-chart-instance-create-count={surfaceDiagnostics.chartInstanceCreates}
      data-chart-instance-dispose-count={surfaceDiagnostics.chartInstanceDisposes}
      data-chart-series-tail-patch-count={surfaceDiagnostics.seriesTailPatches}
      data-chart-series-tail-append-count={surfaceDiagnostics.seriesTailAppends}
      data-chart-series-full-reset-count={surfaceDiagnostics.seriesFullResets}
      data-chart-series-last-reset-reason={
        surfaceDiagnostics.lastSeriesResetReason
      }
      data-chart-marker-set-count={surfaceDiagnostics.markerSetCalls}
      data-chart-viewport-default-range-apply-count={
        surfaceDiagnostics.viewportDefaultRangeApplies
      }
      data-chart-viewport-user-range-preserve-count={
        surfaceDiagnostics.viewportUserRangePreserves
      }
      data-chart-viewport-realtime-follow-count={
        surfaceDiagnostics.viewportRealtimeFollowApplies
      }
      data-chart-viewport-prepend-range-adjust-count={
        surfaceDiagnostics.viewportPrependRangeAdjusts
      }
      data-chart-viewport-skipped-reset-count={
        surfaceDiagnostics.viewportSkippedResets
      }
      onPointerDownCapture={handleRootPointerDownCapture}
      onPointerMoveCapture={handleRootPointerMoveCapture}
      onPointerUpCapture={handleRootPointerUpCapture}
      onPointerCancelCapture={handleRootPointerCancelCapture}
      onPointerLeave={scheduleCurrentFlowTooltipHide}
      onMouseDownCapture={beginMousePlotPan}
      onMouseMoveCapture={moveMousePlotPan}
      onMouseUpCapture={endMousePlotPan}
      onMouseLeave={endMousePlotPan}
      onWheelCapture={handleRootWheelCapture}
      onClickCapture={handleRootClickCapture}
      style={{
        width: isFullscreen ? "100vw" : "100%",
        height: isFullscreen ? "100vh" : "100%",
        position: isFullscreen ? "fixed" : "relative",
        inset: isFullscreen ? 0 : undefined,
        zIndex: isFullscreen ? 160 : undefined,
        overflow: "hidden",
        background: theme.bg2,
        touchAction: drawMode ? "none" : "pan-y",
      }}
    >
      {resolvedTopOverlay ? (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 20,
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
            top: leftOverlayInsetTop,
            left: 0,
            bottom: leftOverlayInsetBottom,
            width: leftOverlayWidth,
            zIndex: 20,
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
            zIndex: 21,
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
                  fontSize: TYPE_CSS_VAR.label,
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
                      fontSize: TYPE_CSS_VAR.body,
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
            fontSize: TYPE_CSS_VAR.bodyStrong,
            background: withAlpha(theme.bg3, "80"),
          }}
        >
          {chartError}
        </div>
      ) : hasChartBars ? (
        <>
          <div
            ref={containerRef}
            data-chart-plot-root
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
          tradeThresholdOverlays.length ||
          flowVolumeOverlays.length ||
          chartEventOverlays.length ||
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
                width: drawablePlotWidth || "100%",
                height: drawablePlotHeight || "100%",
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
                          fontSize: resolveOverlayLabelFontSize(
                            overlay.labelSize,
                          ),
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
                          fontSize: resolveOverlayLabelFontSize(
                            overlay.labelSize,
                          ),
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
                        fontSize: TYPE_CSS_VAR.label,
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
                        fontSize: TYPE_CSS_VAR.label,
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
              {flowVolumeOverlays.map((overlay) => {
                const toneColor = resolveFlowToneColor(overlay.tone, theme);
                let segmentBottom = 0;
                const segmentNodes = overlay.segments.map((segment) => {
                  const segmentColor = resolveFlowToneColor(segment.tone, theme);
                  const heightPercent = Math.max(
                    0,
                    Math.min(100 - segmentBottom, segment.ratio * 100),
                  );
                  const node = (
                    <div
                      key={`${overlay.id}:${segment.tone}`}
                      data-chart-flow-volume-segment={segment.tone}
                      data-chart-flow-volume-basis={overlay.flowSourceBasis}
                      style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        bottom: `${segmentBottom}%`,
                        height: `${heightPercent}%`,
                        background: withAlpha(segmentColor, "d8"),
                      }}
                    />
                  );
                  segmentBottom += heightPercent;
                  return node;
                });
                return (
                  <div
                    key={overlay.id}
                    aria-label={overlay.title}
                    data-testid={
                      dataTestId ? `${dataTestId}-flow-volume` : undefined
                    }
                    onPointerEnter={() =>
                      showFlowTooltip({
                        id: overlay.id,
                        left: overlay.left + overlay.width,
                        top: overlay.top,
                        model: overlay.tooltip,
                      })
                    }
                    onPointerLeave={() => scheduleHideFlowTooltip(overlay.id)}
                    onFocus={() =>
                      showFlowTooltip({
                        id: overlay.id,
                        left: overlay.left + overlay.width,
                        top: overlay.top,
                        model: overlay.tooltip,
                      })
                    }
                    onBlur={() => scheduleHideFlowTooltip(overlay.id)}
                    tabIndex={0}
                    style={{
                      position: "absolute",
                      left: overlay.left,
                      top: overlay.top,
                      width: overlay.width,
                      height: overlay.height,
                      minWidth: 3,
                      minHeight: 4,
                      borderRadius: 2,
                      background: withAlpha(toneColor, "1f"),
                      border: `1px solid ${withAlpha(toneColor, "a8")}`,
                      boxSizing: "border-box",
                      boxShadow: `0 0 0 1px ${withAlpha(theme.bg4, "aa")}`,
                      overflow: "hidden",
                      pointerEvents: "auto",
                      cursor: "help",
                    }}
                  >
                    {segmentNodes}
                  </div>
                );
              })}
              {chartEventOverlays.map((overlay) => {
                const color = resolveChartEventToneColor(overlay, theme);
                return (
                  <AppTooltip key={`chart-event-${overlay.id}`} content={overlay.title}><div
                    key={`chart-event-${overlay.id}`}
                    aria-label={overlay.title}
                    data-testid={
                      dataTestId ? `${dataTestId}-chart-event` : undefined
                    }
                    data-chart-event-type={overlay.eventType || undefined}
                    data-chart-event-source={overlay.source || undefined}
                    data-chart-event-severity={overlay.severity || undefined}
                    data-chart-event-symbol={overlay.symbol || undefined}
                    data-chart-event-tone={overlay.tone}
                    data-chart-flow-marker-tone={
                      overlay.eventType === "unusual_flow" ? overlay.tone : undefined
                    }
                    data-chart-flow-marker-basis={
                      overlay.eventType === "unusual_flow"
                        ? overlay.flowSourceBasis
                        : undefined
                    }
                    onPointerEnter={
                      overlay.tooltip
                        ? () =>
                            showFlowTooltip({
                              id: overlay.id,
                              left: overlay.left,
                              top: overlay.top,
                              model: overlay.tooltip as FlowTooltipModel,
                            })
                        : undefined
                    }
                    onPointerLeave={
                      overlay.tooltip
                        ? () => scheduleHideFlowTooltip(overlay.id)
                        : undefined
                    }
                    onFocus={
                      overlay.tooltip
                        ? () =>
                            showFlowTooltip({
                              id: overlay.id,
                              left: overlay.left,
                              top: overlay.top,
                              model: overlay.tooltip as FlowTooltipModel,
                            })
                        : undefined
                    }
                    onBlur={
                      overlay.tooltip
                        ? () => scheduleHideFlowTooltip(overlay.id)
                        : undefined
                    }
                    tabIndex={overlay.tooltip ? 0 : undefined}
                    style={{
                      position: "absolute",
                      left: overlay.left,
                      top: overlay.top,
                      width: overlay.placement === "timescale" ? 18 : 22,
                      height: overlay.placement === "timescale" ? 18 : 22,
                      transform: "translate(-50%, -50%)",
                      borderRadius: 999,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      boxSizing: "border-box",
                      background: withAlpha(color, "22"),
                      border: `1px solid ${withAlpha(color, "dd")}`,
                      color,
                      fontFamily: theme.mono,
                      fontSize: TYPE_CSS_VAR.label,
                      fontWeight: 400,
                      lineHeight: 1,
                      boxShadow: `0 0 0 1px ${withAlpha(theme.bg4, "cc")}`,
                      pointerEvents: "auto",
                      cursor: overlay.tooltip ? "help" : "default",
                    }}
                  >
                    {overlay.label.slice(0, overlay.placement === "timescale" ? 2 : 4)}
                  </div></AppTooltip>
                );
              })}
              {flowTooltip
                ? (() => {
                    const model = flowTooltip.model;
                    const toneColor = resolveFlowToneColor(model.tone, theme);
                    const statCells = buildFlowTooltipStatCells(model);
                    const mixSegments = [
                      {
                        key: "bull",
                        label: `Bull ${model.bullishPercent}%`,
                        percent: model.bullishPercent,
                        color: theme.green,
                      },
                      {
                        key: "bear",
                        label: `Bear ${model.bearishPercent}%`,
                        percent: model.bearishPercent,
                        color: theme.red,
                      },
                      {
                        key: "mix",
                        label: `Mix ${model.neutralPercent}%`,
                        percent: model.neutralPercent,
                        color: theme.amber,
                      },
                    ];
                    const copyLabel = flowTooltipHasValue(model.copyLabel)
                      ? model.copyLabel
                      : model.topContract;
                    const sourceText = [model.sourceLabel, model.timeBasis]
                      .filter(Boolean)
                      .join(" · ");

                    return (
                      <div
                        data-testid={
                          dataTestId ? `${dataTestId}-flow-tooltip` : undefined
                        }
                        data-chart-flow-tooltip-compact="true"
                        onPointerEnter={clearFlowTooltipHideTimer}
                        onPointerLeave={() => scheduleHideFlowTooltip(flowTooltip.id)}
                        onFocus={clearFlowTooltipHideTimer}
                        onBlur={(event) => {
                          const nextTarget = event.relatedTarget;
                          if (
                            nextTarget instanceof Node &&
                            event.currentTarget.contains(nextTarget)
                          ) {
                            return;
                          }
                          scheduleHideFlowTooltip(flowTooltip.id);
                        }}
                        style={{
                          position: "absolute",
                          left: flowTooltip.left,
                          top: flowTooltip.top,
                          width: FLOW_TOOLTIP_WIDTH,
                          maxWidth: "calc(100% - 16px)",
                          borderRadius: 6,
                          padding: 8,
                          boxSizing: "border-box",
                          background: "var(--ra-tooltip-bg)",
                          border: "1px solid var(--ra-tooltip-border)",
                          boxShadow: "var(--ra-tooltip-shadow)",
                          color: "var(--ra-tooltip-text)",
                          fontFamily: "var(--ra-font-sans)",
                          pointerEvents: "auto",
                          overflowY: "auto",
                          maxHeight: "calc(100% - 16px)",
                          zIndex: 8,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 8,
                            alignItems: "baseline",
                            marginBottom: 5,
                            minWidth: 0,
                          }}
                        >
                          <div
                            style={{
                              minWidth: 0,
                              fontSize: TYPE_CSS_VAR.bodyStrong,
                              fontWeight: 400,
                              lineHeight: 1.1,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {model.title}
                          </div>
                          <div
                            style={{
                              fontSize: TYPE_CSS_VAR.bodyStrong,
                              fontFamily: theme.mono,
                              color: toneColor,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {model.premium}
                          </div>
                        </div>

                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            marginBottom: 6,
                            minWidth: 0,
                          }}
                        >
                          <div
                            data-chart-flow-tooltip-contract="true"
                            title={model.topContract}
                            style={{
                              flex: 1,
                              minWidth: 0,
                              color: theme.text,
                              fontFamily: theme.mono,
                              fontSize: TYPE_CSS_VAR.body,
                              lineHeight: 1.2,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {model.topContract}
                          </div>
                          {flowTooltipHasValue(copyLabel) ? (
                            <button
                              type="button"
                              aria-label={`Copy ${copyLabel}`}
                              onClick={() => copyFlowContract(copyLabel)}
                              style={{
                                width: 18,
                                height: 18,
                                minWidth: 18,
                                border: `1px solid ${withAlpha(theme.border, "a0")}`,
                                background: withAlpha(theme.bg4, "cc"),
                                color: theme.text,
                                borderRadius: 5,
                                padding: 0,
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                cursor: "pointer",
                              }}
                            >
                              <Copy size={11} strokeWidth={1.8} />
                            </button>
                          ) : null}
                        </div>

                        <div
                          data-chart-flow-tooltip-mix-strip="true"
                          title={model.flowMix}
                          style={{
                            height: 7,
                            display: "flex",
                            overflow: "hidden",
                            borderRadius: 999,
                            border: `1px solid ${withAlpha(theme.border, "80")}`,
                            background: withAlpha(theme.bg4, "80"),
                            marginBottom: 3,
                          }}
                        >
                          {mixSegments.map((segment) => (
                            <div
                              key={segment.key}
                              title={segment.label}
                              style={{
                                width: `${segment.percent}%`,
                                minWidth: segment.percent > 0 ? 3 : 0,
                                background: withAlpha(segment.color, "d8"),
                              }}
                            />
                          ))}
                        </div>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 6,
                            marginBottom: 6,
                            color: theme.textMuted,
                            fontFamily: theme.mono,
                            fontSize: TYPE_CSS_VAR.label,
                            lineHeight: 1.1,
                          }}
                        >
                          <span>B {model.bullishPercent}%</span>
                          <span>R {model.bearishPercent}%</span>
                          <span>M {model.neutralPercent}%</span>
                        </div>

                        <div
                          data-chart-flow-tooltip-stat-grid="true"
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                            gap: "3px 5px",
                            fontSize: TYPE_CSS_VAR.body,
                            lineHeight: 1.15,
                          }}
                        >
                          {statCells.map((cell) => (
                            <div
                              key={`${cell.label}:${cell.value}`}
                              style={{
                                minWidth: 0,
                                display: "flex",
                                alignItems: "baseline",
                                justifyContent: "space-between",
                                gap: 4,
                                padding: "2px 4px",
                                borderRadius: 4,
                                background: withAlpha(theme.bg4, "55"),
                              }}
                            >
                              <span
                                style={{
                                  color: theme.textMuted,
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {cell.label}
                              </span>
                              <span
                                style={{
                                  minWidth: 0,
                                  color:
                                    cell.label === "Bias" ? toneColor : theme.text,
                                  fontFamily: theme.mono,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                  textAlign: "right",
                                }}
                              >
                                {cell.value}
                              </span>
                            </div>
                          ))}
                        </div>

                        <div
                          style={{
                            marginTop: 6,
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                            flexWrap: "wrap",
                            color: theme.textMuted,
                            fontSize: TYPE_CSS_VAR.label,
                            lineHeight: 1.15,
                          }}
                        >
                          <span
                            style={{
                              fontFamily: theme.mono,
                              color: theme.textMuted,
                              textTransform: "uppercase",
                            }}
                          >
                            {sourceText}
                          </span>
                          <span
                            style={{
                              fontFamily: theme.mono,
                              color: toneColor,
                            }}
                          >
                            {model.intensity}
                          </span>
                          {model.tags.map((tag) => (
                            <span
                              key={tag}
                              style={{
                                fontFamily: theme.mono,
                                color: theme.text,
                                padding: "1px 4px",
                                borderRadius: 999,
                                border: `1px solid ${withAlpha(theme.border, "80")}`,
                                background: withAlpha(theme.bg4, "80"),
                                textTransform: "uppercase",
                              }}
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })()
                : null}
              {indicatorBadgeOverlays.map((overlay) => {
                const isSignal = overlay.variant === "signal";
                const isTriangle = overlay.variant === "triangle";
                const isStructure = overlay.variant === "structure";
                const isSwing = overlay.variant === "swing";
                const swingTextColor =
                  overlay.text === "HH" || overlay.text === "LH"
                    ? theme.red
                    : overlay.text === "HL" || overlay.text === "LL"
                      ? theme.green
                      : overlay.textColor;
                const placementTransform =
                  overlay.placement === "above"
                    ? "translate(-50%, calc(-100% - 8px))"
                    : overlay.placement === "below"
                      ? "translate(-50%, 8px)"
                      : "translate(-50%, -50%)";
                const arrowElement =
                  !isSwing && overlay.arrow === "up" ? (
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
                  ) : !isSwing && overlay.arrow === "down" ? (
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
                          isSwing
                            ? "0"
                            : isSignal
                            ? "4px 10px"
                            : isTriangle
                              ? "0"
                              : isStructure
                                ? "2px 7px"
                                : "2px 8px",
                        borderRadius: isSwing ? 0 : isSignal ? 999 : 8,
                        border: isSwing || isTriangle
                          ? "none"
                          : `1px solid ${overlay.borderColor}`,
                        background:
                          isSwing || isTriangle ? "transparent" : overlay.background,
                        color: isSwing
                          ? swingTextColor
                          : isTriangle
                            ? overlay.background
                            : overlay.textColor,
                        fontSize: isTriangle ? TYPE_CSS_VAR.bodyStrong : isSignal || isSwing ? TYPE_CSS_VAR.body : TYPE_CSS_VAR.label,
                        fontFamily: theme.mono,
                        fontWeight: 400,
                        whiteSpace: "nowrap",
                        boxShadow: isSwing || isTriangle
                          ? "none"
                          : `0 4px 12px ${withAlpha(theme.bg4, "88")}`,
                        letterSpacing:
                          isSignal || isStructure || isSwing ? "0.04em" : "normal",
                      }}
                    >
                      {overlay.text}
                      {arrowElement}
                    </div>
                  </div>
                );
              })}
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
                      fontSize: TYPE_CSS_VAR.body,
                      fontFamily: theme.mono,
                      fontWeight: 400,
                      whiteSpace: "nowrap",
                      boxShadow: `0 4px 12px ${withAlpha(theme.bg4, "88")}`,
                    }}
                  >
                    {badge.text}
                  </div>
                ))}
              {tradeMarkerTargets.map((target) => (
                <AppTooltip key={`trade-target-${target.id}`} content={
                    target.tradeSelectionIds.length > 1
                      ? `${target.tradeSelectionIds.length} overlapping trades`
                      : "Select trade"
                  }><button
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
                    fontSize: TYPE_CSS_VAR.body,
                    fontFamily: theme.mono,
                    fontWeight: 400,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    pointerEvents: "auto",
                    cursor: "pointer",
                    boxShadow: `0 0 0 1px ${withAlpha(theme.bg4, "cc")}`,
                  }}
                >
                  {target.label ?? "•"}
                </button></AppTooltip>
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
                fontSize: TYPE_CSS_VAR.label,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
              }}
            >
              {emptyStateEyebrow}
            </div>
            <div
              style={{
                color: theme.text,
                fontFamily: theme.mono,
                fontSize: TYPE_CSS_VAR.bodyStrong,
                lineHeight: 1.5,
              }}
            >
              {emptyStateTitle}
            </div>
            <div
              style={{
                marginTop: 6,
                color: theme.textMuted,
                fontFamily: theme.mono,
                fontSize: TYPE_CSS_VAR.body,
                lineHeight: 1.5,
              }}
            >
              {emptyStateDetail}
            </div>
          </div>
        </div>
      )}
      {dashboardOverlayForDisplay && dashboardDensity ? (
        <div
          data-testid={dashboardOverlayForDisplay.dataTestId}
          data-dashboard-strip-tier={dashboardTier}
          data-dashboard-strip-placement="below-time-axis"
          aria-label={`${dashboardOverlayForDisplay.title} strip`}
          style={{
            position: "absolute",
            ...resolveDashboardStripAnchorStyle(
              compact,
              bottomOverlayHeight,
              chartInsetLeft,
            ),
            height: dashboardDensity.height,
            maxWidth: dashboardDensity.maxWidth,
            padding: dashboardDensity.padding,
            background: withAlpha("#05070a", "d9"),
            border: `1px solid ${withAlpha("#9ca3af", "66")}`,
            borderRadius: 0,
            boxSizing: "border-box",
            color: "#ffffff",
            boxShadow: "none",
            zIndex: 19,
            display: "flex",
            flexWrap: "nowrap",
            alignItems: "center",
            gap: dashboardDensity.gap,
            overflow: "hidden",
            fontFamily: theme.mono,
            lineHeight: 1,
            pointerEvents: "auto",
          }}
        >
          {dashboardSegments.map((segment, index) => {
            const isTitle = segment.kind === "title";
            const isSubtitle = segment.kind === "subtitle";
            const segmentColor = segment.color || "#ffffff";
            return (
              <AppTooltip key={segment.key} content={
                  segment.title ||
                  [segment.label, segment.value, segment.detail]
                    .filter(Boolean)
                    .join(" ")
                }><div
                key={segment.key}
                style={{
                  minWidth: 0,
                  maxWidth: dashboardDensity.segmentMaxWidth,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: dashboardTier === "micro" ? 2 : 3,
                  padding: dashboardDensity.segmentPadding,
                  ...(index > 0 ? { paddingLeft: dashboardDensity.gap } : {}),
                  boxSizing: "border-box",
                  background:
                    dashboardTier === "micro"
                      ? "transparent"
                      : isTitle
                        ? withAlpha("#6b7280", "54")
                        : "transparent",
                  border: "none",
                  borderLeft:
                    index > 0
                      ? `1px solid ${withAlpha("#9ca3af", "4d")}`
                      : "none",
                  color: "#ffffff",
                  fontSize: isTitle
                    ? dashboardDensity.titleSize
                    : isSubtitle
                      ? dashboardDensity.subtitleSize
                      : dashboardDensity.bodySize,
                  fontWeight: 400,
                  lineHeight: 1,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  letterSpacing: 0,
                  flexShrink: dashboardTier === "micro" ? 0 : 1,
                }}
              >
                {segment.label ? (
                  <span
                    style={{
                      flexShrink: 0,
                      color: "#9ca3af",
                      fontWeight: 400,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {segment.label}
                  </span>
                ) : null}
                <span
                  style={{
                    minWidth: 0,
                    color: isSubtitle ? "#cbd5e1" : segmentColor,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {segment.value}
                </span>
                {segment.detail ? (
                  <span
                    style={{
                      minWidth: 0,
                      color: "#6b7280",
                      fontSize: dashboardDensity.detailSize,
                      fontWeight: 400,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {segment.detail}
                  </span>
                ) : null}
              </div></AppTooltip>
            );
          })}
        </div>
      ) : null}
      {showLegend && displayBar && (
        <div
          ref={legendRef}
          data-testid={dataTestId ? `${dataTestId}-legend` : undefined}
          style={{
            position: "absolute",
            top: topChromeBase + toolbarOffset,
            left: 8 + chartInsetLeft,
            right: 12,
            zIndex: 18,
            fontSize: compact ? TYPE_CSS_VAR.body : TYPE_CSS_VAR.bodyStrong,
            fontFamily: theme.mono,
            color: theme.textMuted,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: compact ? 2 : 3,
            pointerEvents: "none",
            lineHeight: 1.18,
            textShadow: `0 1px 2px ${withAlpha(theme.bg4, "e6")}`,
            maxWidth: `calc(100% - ${chartInsetLeft + 16}px)`,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: compact ? 5 : 7,
              flexWrap: "wrap",
              color: theme.textMuted,
              whiteSpace: "normal",
            }}
          >
            {legend?.symbol ? (
              <span style={{ color: theme.text, fontWeight: 400 }}>
                {legend.symbol}
              </span>
            ) : null}
            {legendName ? (
              <span style={{ color: theme.textMuted }}>{legendName}</span>
            ) : null}
            {legend?.timeframe ? (
              <span style={{ color: theme.textMuted }}>{legend.timeframe}</span>
            ) : null}
            {legend?.statusLabel ? (
              <span style={{ color: legendStatusColor }}>{legend.statusLabel}</span>
            ) : null}
            <span style={{ color: theme.textMuted }}>
              {formatLegendTimestamp(displayBar.ts, userPreferences)}
            </span>
          </div>
          {legendShowOhlc ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: legendCompactMode ? 6 : 8,
                flexWrap: "wrap",
                color: theme.textMuted,
                whiteSpace: "normal",
              }}
            >
              <span>
                O <span style={{ color: theme.text }}>{formatPrice(displayBar.open)}</span>
              </span>
              <span>
                H <span style={{ color: theme.green }}>{formatPrice(displayBar.high)}</span>
              </span>
              <span>
                L <span style={{ color: theme.red }}>{formatPrice(displayBar.low)}</span>
              </span>
              <span>
                C{" "}
                <span style={{ color: theme.text }}>
                  {formatPrice(displayBar.close)}
                </span>
              </span>
              <span style={{ color: deltaColor }}>
                {formatLegendSignedNumber(displayDeltaValue, pricePrecision)}
              </span>
              <span style={{ color: deltaColor }}>
                {formatLegendPercent(legendDeltaPct)}
              </span>
              {legendShowVolume ? (
                <span>
                  Vol{" "}
                  <span style={{ color: theme.text }}>
                    {formatCompactNumber(displayBar.volume)}
                  </span>
                </span>
              ) : null}
              {!legendCompactMode && displayBar.vwap != null ? (
                <span>
                  VWAP <span style={{ color: theme.text }}>{formatPrice(displayBar.vwap)}</span>
                </span>
              ) : null}
              {!legendCompactMode && displayBar.sessionVwap != null ? (
                <span>
                  SVWAP{" "}
                  <span style={{ color: theme.text }}>
                    {formatPrice(displayBar.sessionVwap)}
                  </span>
                </span>
              ) : null}
              {!legendCompactMode && displayBar.accumulatedVolume != null ? (
                <span>
                  AV{" "}
                  <span style={{ color: theme.text }}>
                    {formatCompactNumber(displayBar.accumulatedVolume)}
                  </span>
                </span>
              ) : null}
              {!legendCompactMode && displayBar.averageTradeSize != null ? (
                <span>
                  ASZ{" "}
                  <span style={{ color: theme.text }}>
                    {formatLegendNumber(displayBar.averageTradeSize, 0)}
                  </span>
                </span>
              ) : null}
              {!legendCompactMode && legendSourceLabel ? (
                <span style={{ color: theme.textMuted }}>{legendSourceLabel}</span>
              ) : null}
            </div>
          ) : null}
          {legendShowStudies
            ? legendStudyItems.map((study) => (
                <div
                  key={`legend-study-${study.id}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: compact ? 5 : 7,
                    flexWrap: "wrap",
                    color: theme.textMuted,
                    whiteSpace: "normal",
                  }}
                >
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 3,
                    }}
                  >
                    {study.colors.slice(0, compact ? 2 : 4).map((color, index) => (
                      <span
                        key={`${study.id}-${color}-${index}`}
                        style={{
                          width: compact ? 6 : 7,
                          height: compact ? 6 : 7,
                          borderRadius: 999,
                          background: color,
                          boxShadow: `0 0 0 1px ${withAlpha(theme.bg4, "cc")}`,
                        }}
                      />
                    ))}
                  </span>
                  <span style={{ color: theme.textMuted }}>{study.label}</span>
                  {study.values.slice(0, compact ? 1 : 3).map((value, index) => (
                    <span
                      key={`${study.id}-value-${index}`}
                      style={{ color: theme.text }}
                    >
                      {formatLegendStudyValue(value)}
                    </span>
                  ))}
                </div>
              ))
            : null}
        </div>
      )}
      {resolvedBottomOverlay ? (
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 20,
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
            zIndex: 22,
            background: withAlpha(theme.amber, "18"),
            border: `1px solid ${withAlpha(theme.amber, "66")}`,
            borderRadius: 4,
            padding: "3px 8px",
            fontSize: TYPE_CSS_VAR.bodyStrong,
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
