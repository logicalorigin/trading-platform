import {
  Fragment,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { CSSProperties, ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  getGetBacktestRunChartQueryKey,
  getGetBacktestRunQueryKey,
  getGetBacktestStudyPreviewChartQueryKey,
  getListPineScriptsQueryKey,
  getListBacktestDraftStrategiesQueryKey,
  getListBacktestJobsQueryKey,
  getListBacktestRunsQueryKey,
  getListBacktestStrategiesQueryKey,
  getListBacktestStudiesQueryKey,
  getBars,
  useCancelBacktestJob,
  useCreatePineScript,
  useCreateBacktestRun,
  useCreateBacktestStudy,
  useCreateBacktestSweep,
  useGetBacktestRunChart,
  useGetBacktestRun,
  useGetBacktestStudyPreviewChart,
  useListBacktestDraftStrategies,
  useListBacktestJobs,
  useListBacktestRuns,
  useListBacktestStrategies,
  useListBacktestStudies,
  usePromoteBacktestRun,
  useUpdatePineScript,
} from "@workspace/api-client-react";
import type {
  BacktestComparisonBadge,
  BacktestDirectionMode,
  BacktestDraftStrategy,
  BacktestJobSummary,
  BacktestMetrics,
  BacktestOptimizerMode,
  BacktestParameterDefinition,
  BacktestRunSummary,
  BacktestStrategyCatalogItem,
  BacktestStudyRecord,
  BacktestTrade,
  BacktestTradeOverlay,
  BarTimeframe,
  PineScriptPaneType,
  PineScriptRecord,
  PineScriptStatus,
  Watchlist,
} from "@workspace/api-client-react";
import type { TradeThresholdSegment } from "../charting/types";
import { RayReplicaSettingsMenu } from "../charting/RayReplicaSettingsMenu";
import { ResearchChartFrame } from "../charting/ResearchChartFrame";
import {
  resolvePineScriptChartState,
  useIndicatorLibrary,
} from "../charting/pineScripts";
import {
  RAY_REPLICA_PINE_SCRIPT_KEY,
  resolveRayReplicaRuntimeSettings,
} from "../charting/rayReplicaPineAdapter";
import {
  buildBacktestChartModel,
  buildHydratedBacktestSpotChartModel,
  buildRunTradeSelectionId,
  formatComparisonBadgeValue,
  mergeStudyPreviewSeries,
} from "./charting";
import {
  formatDateInputValue,
  toEndOfDayIso,
  toStartOfDayIso,
} from "./backtestingDateRanges";
import { deriveSweepDimensions } from "./sweepDimensions";
import { useRuntimeWorkloadFlag } from "../platform/workloadStats";
import { useUserPreferences } from "../preferences/useUserPreferences";
import {
  formatAppDateTimeForPreferences,
  formatAppTimeForPreferences,
} from "../../lib/timeZone";
import { chartTooltipContentStyle } from "../../lib/tooltipStyles";
import { responsiveFlags, useElementSize } from "../../lib/responsive";
import type { UserPreferences } from "../preferences/userPreferenceModel";

type ThemeTokens = {
  bg0: string;
  bg1: string;
  bg2: string;
  bg3: string;
  bg4: string;
  border: string;
  borderLight: string;
  text: string;
  textSec: string;
  textDim: string;
  textMuted: string;
  accent: string;
  accentDim: string;
  green: string;
  greenBg: string;
  red: string;
  redBg: string;
  amber: string;
  amberBg: string;
  purple: string;
  cyan: string;
  mono: string;
  sans: string;
  display: string;
};

type ScaleHelpers = {
  fs: (value: number) => number;
  sp: (value: number | string) => number | string;
  dim: (value: number) => number;
};

type BacktestWorkspaceProps = {
  theme: ThemeTokens;
  scale: ScaleHelpers;
  watchlists: Watchlist[];
  defaultWatchlistId: string | null;
  isVisible?: boolean;
};

type AlgoDraftStrategiesPanelProps = {
  theme: ThemeTokens;
  scale: ScaleHelpers;
  isVisible?: boolean;
};

type BannerState = {
  kind: "success" | "error" | "info";
  title: string;
  detail: string;
} | null;

type BacktestDisplayMode = "spot" | "options";
type TradeOutcomeFilter = "all" | "winner" | "loser" | "breakeven";
type SummaryTradeLens =
  | "all"
  | "winners"
  | "losers"
  | "long"
  | "short"
  | "recent";
type TradeExplorerRow = BacktestTrade & {
  tradeSelectionId: string;
  outcome: Exclude<TradeOutcomeFilter, "all">;
  entryAtMs: number;
  exitAtMs: number;
};

type ScalarParameter = string | number | boolean;

const moneyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const newYorkSessionFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const TRADES_PER_PAGE = 15;
const DEFAULT_BACKTEST_INDICATORS = [
  RAY_REPLICA_PINE_SCRIPT_KEY,
  "ema-21",
  "vwap",
];
const SPOT_HISTORY_LOOKBACK_YEARS = 10;
const MAX_SPOT_HISTORY_REQUEST_BARS = 50_000;
const SPOT_HISTORY_REQUEST_HEADROOM_RATIO = 0.95;
const SPOT_HISTORY_INITIAL_FETCH_CONCURRENCY = 1;
const SPOT_HISTORY_EXPANDED_FETCH_CONCURRENCY = 1;
const SPOT_HISTORY_REFRESH_MS = 5 * 60_000;
const SPOT_HISTORY_INITIAL_STALE_MS = 10 * 60_000;
const SPOT_HISTORY_REQUEST_TIMEOUT_MS = 20_000;
const SPOT_HISTORY_REQUEST_PRIORITY_HEADER = "x-rayalgo-fetch-priority";
const SPOT_HISTORY_REQUEST_PRIORITY = 8;
const TRADING_DAYS_PER_YEAR = 252;
const CALENDAR_DAYS_PER_YEAR = 365;
const SPOT_HISTORY_MAX_REQUEST_WINDOW_DAYS: Partial<Record<BarTimeframe, number>> = {
  "1s": 7,
  "5s": 7,
  "15s": 7,
  "1m": 45,
  "5m": 180,
  "15m": CALENDAR_DAYS_PER_YEAR,
  "1h": CALENDAR_DAYS_PER_YEAR * 3,
  "1d": CALENDAR_DAYS_PER_YEAR * 15,
};
type SpotHistoryMode = "initial" | "expanded";

type SpotHistoryBarsResponse = {
  symbol: string;
  timeframe: string;
  bars: Array<{
    timestamp: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    source?: string | null;
    providerContractId?: string | null;
    outsideRth?: boolean;
    partial?: boolean;
  }>;
};

type AdvancedMetricsView = {
  sortinoRatio?: number | null;
  calmarRatio?: number | null;
  probabilisticSharpeRatio?: number | null;
  deflatedSharpeRatio?: number | null;
  monteCarlo?: {
    p05ReturnPercent?: number | null;
    probabilityOfLossPercent?: number | null;
  } | null;
};

type ValidationMetricsView = {
  trialCount?: number | null;
  oosWindowCount?: number | null;
  warnings?: string[] | null;
};

type DataQualityMetricsView = {
  sourcePolicy?: string | null;
  primarySource?: string | null;
  coveragePercent?: number | null;
  ibkrRecentCutoffMinutes?: number | null;
};

type BenchmarkMetricsView = {
  symbol: string;
  totalReturnPercent?: number | null;
  beta?: number | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asAdvancedMetrics(value: unknown): AdvancedMetricsView | null {
  return isRecord(value) ? (value as AdvancedMetricsView) : null;
}

function asValidationMetrics(value: unknown): ValidationMetricsView | null {
  return isRecord(value) ? (value as ValidationMetricsView) : null;
}

function asDataQualityMetrics(value: unknown): DataQualityMetricsView | null {
  return isRecord(value) ? (value as DataQualityMetricsView) : null;
}

function asBenchmarkMetrics(value: unknown): BenchmarkMetricsView[] {
  return Array.isArray(value) ? (value as BenchmarkMetricsView[]) : [];
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unexpected request failure.";
}

function formatCurrency(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "—";
  }

  return moneyFormatter.format(value);
}

function formatSignedCurrency(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "—";
  }

  const absolute = moneyFormatter.format(Math.abs(value));
  if (value > 0) {
    return `+${absolute}`;
  }

  if (value < 0) {
    return `-${absolute}`;
  }

  return absolute;
}

function formatPercent(value: number | null | undefined, digits = 1): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "—";
  }

  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(digits)}%`;
}

function formatNumber(value: number | null | undefined, digits = 2): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "—";
  }

  return value.toFixed(digits);
}

function formatBacktestOptionRight(value: unknown): string {
  return value === "call" ? "C" : value === "put" ? "P" : "—";
}

function formatBacktestOptionContract(
  contract: BacktestTrade["optionContract"] | null | undefined,
): string {
  if (!contract) {
    return "—";
  }

  return [
    contract.expirationDate,
    formatNumber(contract.strike),
    formatBacktestOptionRight(contract.right),
  ]
    .filter((part) => part !== "—")
    .join(" ");
}

function formatBacktestInstrumentLabel(trade: BacktestTrade): string {
  if (trade.instrumentType !== "option") {
    return trade.symbol;
  }

  return formatBacktestOptionContract(trade.optionContract);
}

function formatBacktestPricingLabel(trade: BacktestTrade): string {
  if (trade.instrumentType === "option") {
    return "Option history";
  }

  return "Shares";
}

function formatDateTime(
  value: string | null | undefined,
  preferences: UserPreferences,
): string {
  if (!value) {
    return "—";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "—";
  }

  return formatAppDateTimeForPreferences(
    parsed,
    preferences,
    {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    },
    "—",
  );
}

function formatHour(value: string | null | undefined, preferences: UserPreferences): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return formatAppTimeForPreferences(parsed, preferences, { hour: "numeric" }, "—");
}

function buildLookbackWindowIsoRange(years: number): {
  fromIso: string;
  toIso: string;
} {
  const to = new Date();
  const from = new Date(to);
  from.setUTCFullYear(from.getUTCFullYear() - years);
  from.setUTCHours(0, 0, 0, 0);
  to.setUTCHours(23, 59, 59, 999);

  return {
    fromIso: from.toISOString(),
    toIso: to.toISOString(),
  };
}

function buildLookbackWindowIsoRangeForCalendarDays(days: number): {
  fromIso: string;
  toIso: string;
} {
  const safeDays = Math.max(1, Math.floor(days));
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - safeDays);
  from.setUTCHours(0, 0, 0, 0);
  to.setUTCHours(23, 59, 59, 999);

  return {
    fromIso: from.toISOString(),
    toIso: to.toISOString(),
  };
}

function resolveInitialSpotHistoryLookbackDays(timeframe: BarTimeframe): number {
  switch (timeframe) {
    case "1s":
    case "5s":
    case "15s":
      return 5;
    case "1m":
      return 30;
    case "5m":
    case "15m":
    case "1h":
      return 90;
    case "1d":
      return CALENDAR_DAYS_PER_YEAR * 2;
    default:
      return 90;
  }
}

function buildSpotHistoryRange(
  timeframe: BarTimeframe,
  mode: SpotHistoryMode,
): { fromIso: string; toIso: string } {
  if (mode === "expanded") {
    return buildLookbackWindowIsoRange(SPOT_HISTORY_LOOKBACK_YEARS);
  }

  return buildLookbackWindowIsoRangeForCalendarDays(
    resolveInitialSpotHistoryLookbackDays(timeframe),
  );
}

function timeframeToMinutes(timeframe: BarTimeframe): number | null {
  switch (timeframe) {
    case "1s":
      return 1 / 60;
    case "5s":
      return 5 / 60;
    case "15s":
      return 15 / 60;
    case "1m":
      return 1;
    case "5m":
      return 5;
    case "15m":
      return 15;
    case "1h":
      return 60;
    case "1d":
      return 60 * 24;
    default:
      return null;
  }
}

function resolveSpotHistoryOutputBarsPerRequest(
  timeframe: BarTimeframe,
): number {
  switch (timeframe) {
    case "1s":
      return MAX_SPOT_HISTORY_REQUEST_BARS;
    case "5s":
      return Math.floor(MAX_SPOT_HISTORY_REQUEST_BARS / 5);
    case "15s":
      return Math.floor(MAX_SPOT_HISTORY_REQUEST_BARS / 15);
    case "1m":
      return MAX_SPOT_HISTORY_REQUEST_BARS;
    case "5m":
      return Math.floor(MAX_SPOT_HISTORY_REQUEST_BARS / 5);
    case "15m":
      return Math.floor(MAX_SPOT_HISTORY_REQUEST_BARS / 15);
    case "1h":
      return Math.floor(MAX_SPOT_HISTORY_REQUEST_BARS / 60);
    case "1d":
      return MAX_SPOT_HISTORY_REQUEST_BARS;
    default:
      return MAX_SPOT_HISTORY_REQUEST_BARS;
  }
}

function resolveSpotHistoryChunkDays(
  timeframe: BarTimeframe,
  outsideRth: boolean,
): number {
  const timeframeMinutes = timeframeToMinutes(timeframe);
  if (!timeframeMinutes || !Number.isFinite(timeframeMinutes)) {
    return CALENDAR_DAYS_PER_YEAR;
  }

  if (timeframe === "1d") {
    return CALENDAR_DAYS_PER_YEAR * SPOT_HISTORY_LOOKBACK_YEARS;
  }

  // The platform bars endpoint can still merge extended-hours intraday bars
  // from the delayed provider even when the caller intends to display regular
  // session only, so window sizing must respect the raw intraday density.
  const sessionMinutes = 16 * 60;
  const barsPerTradingDay = Math.max(
    1,
    Math.ceil(sessionMinutes / timeframeMinutes),
  );
  const maxOutputBars = Math.max(
    100,
    Math.floor(
      resolveSpotHistoryOutputBarsPerRequest(timeframe) *
        SPOT_HISTORY_REQUEST_HEADROOM_RATIO,
    ),
  );
  const maxTradingDays = Math.max(
    5,
    Math.floor(maxOutputBars / barsPerTradingDay),
  );

  const estimatedChunkDays = Math.max(
    7,
    Math.floor((maxTradingDays * CALENDAR_DAYS_PER_YEAR) / TRADING_DAYS_PER_YEAR),
  );
  const maxWindowDays = SPOT_HISTORY_MAX_REQUEST_WINDOW_DAYS[timeframe];
  return maxWindowDays
    ? Math.min(estimatedChunkDays, maxWindowDays)
    : estimatedChunkDays;
}

function buildSpotHistoryWindows(input: {
  fromIso: string;
  toIso: string;
  chunkDays: number;
}): Array<{ fromIso: string; toIso: string }> {
  const windows: Array<{ fromIso: string; toIso: string }> = [];
  const toMs = new Date(input.toIso).getTime();
  let cursorMs = new Date(input.fromIso).getTime();

  while (cursorMs <= toMs) {
    const nextBoundary = new Date(cursorMs);
    nextBoundary.setUTCDate(nextBoundary.getUTCDate() + input.chunkDays);
    const windowEndMs = Math.min(nextBoundary.getTime() - 1, toMs);

    windows.push({
      fromIso: new Date(cursorMs).toISOString(),
      toIso: new Date(windowEndMs).toISOString(),
    });

    cursorMs = windowEndMs + 1;
  }

  return windows;
}

async function fetchSpotHistoryBarsWindow(input: {
  symbol: string;
  timeframe: BarTimeframe;
  fromIso: string;
  toIso: string;
  limit: number;
  outsideRth?: boolean;
  source?: "trades" | "midpoint" | "bid_ask";
  signal?: AbortSignal;
}): Promise<SpotHistoryBarsResponse> {
  const response = await getBars(
    {
      symbol: input.symbol,
      timeframe: input.timeframe,
      from: input.fromIso,
      to: input.toIso,
      limit: input.limit,
      outsideRth: input.outsideRth,
      source: input.source,
      allowHistoricalSynthesis: true,
    },
    {
      headers: {
        [SPOT_HISTORY_REQUEST_PRIORITY_HEADER]: String(
          SPOT_HISTORY_REQUEST_PRIORITY,
        ),
      },
      signal: input.signal,
      timeoutMs: SPOT_HISTORY_REQUEST_TIMEOUT_MS,
    } as RequestInit,
  );

  return {
    symbol: response.symbol,
    timeframe: response.timeframe,
    bars: (response.bars ?? []).map((bar) => ({
      ...bar,
      timestamp: bar.timestamp,
      source: bar.source ?? null,
      providerContractId: bar.providerContractId ?? null,
    })),
  };
}

function isRegularSessionTimestamp(timestamp: string): boolean {
  const parts = newYorkSessionFormatter.formatToParts(new Date(timestamp));
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");

  if (weekday === "Sat" || weekday === "Sun") {
    return false;
  }

  const totalMinutes = hour * 60 + minute;
  return totalMinutes >= 570 && totalMinutes <= 960;
}

async function fetchSpotHistoryBars(input: {
  symbol: string;
  timeframe: BarTimeframe;
  fromIso: string;
  toIso: string;
  outsideRth?: boolean;
  source?: "trades" | "midpoint" | "bid_ask";
  concurrency?: number;
  signal?: AbortSignal;
}): Promise<SpotHistoryBarsResponse> {
  const outsideRth =
    typeof input.outsideRth === "boolean"
      ? input.outsideRth
      : input.timeframe !== "1d";
  const windows = buildSpotHistoryWindows({
    fromIso: input.fromIso,
    toIso: input.toIso,
    chunkDays: resolveSpotHistoryChunkDays(input.timeframe, outsideRth),
  });
  const responses: SpotHistoryBarsResponse[] = [];
  const concurrency = Math.max(1, Math.floor(input.concurrency ?? 1));
  for (
    let startIndex = 0;
    startIndex < windows.length;
    startIndex += concurrency
  ) {
    if (input.signal?.aborted) {
      throw input.signal.reason instanceof Error
        ? input.signal.reason
        : new DOMException("The operation was aborted.", "AbortError");
    }
    const nextResponses = await Promise.all(
      windows
        .slice(startIndex, startIndex + concurrency)
        .map((window) =>
          fetchSpotHistoryBarsWindow({
            symbol: input.symbol,
            timeframe: input.timeframe,
            fromIso: window.fromIso,
            toIso: window.toIso,
            limit: MAX_SPOT_HISTORY_REQUEST_BARS,
            outsideRth,
            source: input.source,
            signal: input.signal,
          }),
        ),
    );
    responses.push(...nextResponses);
  }

  const mergedBars = new Map<
    string,
    SpotHistoryBarsResponse["bars"][number]
  >();
  responses.forEach((response) => {
    response.bars.forEach((bar) => {
      mergedBars.set(bar.timestamp, bar);
    });
  });
  const mergedAndSortedBars = [...mergedBars.values()]
    .sort(
      (left, right) =>
        new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime(),
    )
    .filter((bar) => outsideRth || isRegularSessionTimestamp(bar.timestamp));

  return {
    symbol: input.symbol,
    timeframe: input.timeframe,
    bars: mergedAndSortedBars,
  };
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function parseSymbolList(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,\s]+/)
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
}

function parseDelimitedList(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,\n]+/)
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ];
}

function buildDefaultPineSourceCode(name = "New Pine Script"): string {
  const safeName = name.trim().replaceAll('"', "'") || "New Pine Script";
  return `//@version=5
indicator("${safeName}", overlay=true)

plot(close, title="Close", color=color.new(color.blue, 0), linewidth=2)
`;
}

function buildPineScriptKeyPreview(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 128);

  return normalized || "pine-script";
}

function scalarFromUnknown(
  value: unknown,
  fallback: ScalarParameter,
): ScalarParameter {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  return fallback;
}

function numberFromUnknown(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function stringFromUnknown(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function getStrategyKey(strategy: BacktestStrategyCatalogItem): string {
  return `${strategy.strategyId}:${strategy.version}`;
}

function defaultParametersForStrategy(
  strategy: BacktestStrategyCatalogItem,
): Record<string, ScalarParameter> {
  const defaults: Record<string, ScalarParameter> = {};

  strategy.parameterDefinitions.forEach((definition) => {
    const catalogDefault = strategy.defaultParameters?.[definition.key];
    defaults[definition.key] = scalarFromUnknown(
      catalogDefault,
      scalarFromUnknown(definition.defaultValue, ""),
    );
  });

  Object.entries(strategy.defaultParameters ?? {}).forEach(([key, value]) => {
    defaults[key] = scalarFromUnknown(value, "");
  });

  return defaults;
}

function coerceParameterInput(
  definition: BacktestParameterDefinition,
  rawValue: string,
): ScalarParameter {
  if (definition.type === "boolean") {
    return rawValue === "true";
  }

  if (definition.type === "integer") {
    return Math.round(Number(rawValue));
  }

  if (definition.type === "number") {
    return Number(rawValue);
  }

  return rawValue;
}

function parameterValueToInput(
  definition: BacktestParameterDefinition,
  value: ScalarParameter | undefined,
): string {
  const fallback = scalarFromUnknown(definition.defaultValue, "");
  const resolved = value ?? fallback;

  if (typeof resolved === "boolean") {
    return resolved ? "true" : "false";
  }

  return String(resolved);
}

function getStatusColor(status: string, theme: ThemeTokens): string {
  switch (status) {
    case "completed":
      return theme.green;
    case "running":
    case "preparing_data":
    case "aggregating":
      return theme.accent;
    case "cancel_requested":
      return theme.amber;
    case "failed":
    case "canceled":
      return theme.red;
    default:
      return theme.textDim;
  }
}

function getBannerColor(
  kind: NonNullable<BannerState>["kind"],
  theme: ThemeTokens,
): string {
  switch (kind) {
    case "success":
      return theme.green;
    case "error":
      return theme.red;
    default:
      return theme.accent;
  }
}

function metricFromDraft(
  draft: BacktestDraftStrategy,
  key: keyof BacktestMetrics,
): number | null {
  const config = isRecord(draft.config) ? draft.config : null;
  const metrics = config && isRecord(config.metrics) ? config.metrics : null;
  const value = metrics?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function draftStrategyId(draft: BacktestDraftStrategy): string {
  const config = isRecord(draft.config) ? draft.config : null;
  return stringFromUnknown(config?.strategyId) ?? "unknown";
}

function inputStyle(theme: ThemeTokens, scale: ScaleHelpers): CSSProperties {
  return {
    width: "100%",
    padding: scale.sp("8px 10px"),
    borderRadius: scale.dim(5),
    border: `1px solid ${theme.border}`,
    background: theme.bg0,
    color: theme.text,
    fontFamily: theme.mono,
    fontSize: scale.fs(10),
    outline: "none",
  };
}

function buttonStyle(
  theme: ThemeTokens,
  scale: ScaleHelpers,
  variant: "primary" | "secondary" | "danger" | "ghost" = "secondary",
): CSSProperties {
  const background =
    variant === "primary"
      ? theme.accent
      : variant === "danger"
        ? theme.red
        : variant === "ghost"
          ? "transparent"
          : theme.bg0;
  const color =
    variant === "secondary" || variant === "ghost" ? theme.textSec : "#ffffff";

  return {
    border:
      variant === "secondary" || variant === "ghost"
        ? `1px solid ${theme.border}`
        : "none",
    background,
    color,
    borderRadius: scale.dim(5),
    padding: scale.sp("6px 9px"),
    fontFamily: theme.sans,
    fontSize: scale.fs(10),
    fontWeight: 400,
    cursor: "pointer",
  };
}

function cardStyle(theme: ThemeTokens, scale: ScaleHelpers): CSSProperties {
  return {
    background: theme.bg2,
    border: `1px solid ${theme.border}`,
    borderRadius: scale.dim(6),
    padding: scale.sp("8px 10px"),
  };
}

function fieldLabelStyle(
  theme: ThemeTokens,
  scale: ScaleHelpers,
): CSSProperties {
  return {
    fontSize: scale.fs(9),
    fontWeight: 400,
    color: theme.textMuted,
    letterSpacing: "0.06em",
    marginBottom: scale.sp(4),
    textTransform: "uppercase",
  };
}

function SectionCard({
  title,
  theme,
  scale,
  right,
  children,
  style,
}: {
  title: string;
  theme: ThemeTokens;
  scale: ScaleHelpers;
  right?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div className="ra-panel-enter" style={{ ...cardStyle(theme, scale), ...style }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: scale.sp(8),
          marginBottom: scale.sp(10),
        }}
      >
        <div
          style={{
            fontSize: scale.fs(12),
            fontWeight: 400,
            fontFamily: theme.display,
            color: theme.text,
          }}
        >
          {title}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function StatusBadge({
  status,
  theme,
  scale,
}: {
  status: string;
  theme: ThemeTokens;
  scale: ScaleHelpers;
}) {
  const color = getStatusColor(status, theme);
  const activeStatus = ["queued", "running", "processing", "pending"].includes(
    status,
  );

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: scale.sp(4),
        padding: scale.sp("2px 8px"),
        borderRadius: scale.dim(999),
        border: `1px solid ${color}33`,
        background: `${color}18`,
        color,
        fontSize: scale.fs(9),
        fontWeight: 400,
        fontFamily: theme.mono,
        textTransform: "uppercase",
      }}
    >
      <span
        className={activeStatus ? "ra-status-pulse" : undefined}
        style={{
          width: scale.dim(6),
          height: scale.dim(6),
          borderRadius: "50%",
          background: color,
        }}
      />
      {status.replaceAll("_", " ")}
    </span>
  );
}

function MetricCard({
  label,
  value,
  accent,
  theme,
  scale,
}: {
  label: string;
  value: string;
  accent: string;
  theme: ThemeTokens;
  scale: ScaleHelpers;
}) {
  return (
    <div
      className="ra-panel-enter"
      style={{
        background: theme.bg0,
        border: `1px solid ${theme.border}`,
        borderRadius: scale.dim(5),
        padding: scale.sp("10px 12px"),
      }}
    >
      <div
        style={{
          fontSize: scale.fs(9),
          color: theme.textMuted,
          marginBottom: scale.sp(4),
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: scale.fs(16),
          fontWeight: 400,
          fontFamily: theme.mono,
          color: accent,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function DraftStrategiesList({
  drafts,
  theme,
  scale,
  compact = false,
  formatDateTimeLabel,
}: {
  drafts: BacktestDraftStrategy[];
  theme: ThemeTokens;
  scale: ScaleHelpers;
  compact?: boolean;
  formatDateTimeLabel: (value: string | null | undefined) => string;
}) {
  if (drafts.length === 0) {
    return (
      <div
        style={{
          border: `1px dashed ${theme.border}`,
          borderRadius: scale.dim(5),
          background: theme.bg0,
          padding: scale.sp("14px 12px"),
          color: theme.textDim,
          fontSize: scale.fs(10),
          textAlign: "center",
        }}
      >
        No promoted draft strategies yet.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: scale.sp(8) }}>
      {drafts.map((draft) => (
        <div
          key={draft.id}
          style={{
            background: theme.bg0,
            border: `1px solid ${theme.border}`,
            borderRadius: scale.dim(5),
            padding: scale.sp("10px 12px"),
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: scale.sp(8),
              marginBottom: scale.sp(6),
            }}
          >
            <div>
              <div
                style={{
                  fontSize: scale.fs(11),
                  fontWeight: 400,
                  color: theme.text,
                }}
              >
                {draft.name}
              </div>
              <div
                style={{
                  fontSize: scale.fs(9),
                  color: theme.textDim,
                  fontFamily: theme.mono,
                }}
              >
                {draftStrategyId(draft)} ·{" "}
                {draft.symbolUniverse.slice(0, 3).join(", ")}
                {draft.symbolUniverse.length > 3
                  ? ` +${draft.symbolUniverse.length - 3}`
                  : ""}
              </div>
            </div>
            <StatusBadge
              status={draft.enabled ? "enabled" : "draft"}
              theme={theme}
              scale={scale}
            />
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: compact
                ? "repeat(2, minmax(0, 1fr))"
                : "repeat(4, minmax(0, 1fr))",
              gap: scale.sp(6),
            }}
          >
            <MetricCard
              label="Return"
              value={formatPercent(
                metricFromDraft(draft, "totalReturnPercent"),
              )}
              accent={theme.green}
              theme={theme}
              scale={scale}
            />
            <MetricCard
              label="Sharpe"
              value={formatNumber(metricFromDraft(draft, "sharpeRatio"))}
              accent={theme.accent}
              theme={theme}
              scale={scale}
            />
            <MetricCard
              label="Max DD"
              value={formatPercent(
                metricFromDraft(draft, "maxDrawdownPercent"),
              )}
              accent={theme.red}
              theme={theme}
              scale={scale}
            />
            {!compact ? (
              <MetricCard
                label="Promoted"
                value={formatDateTimeLabel(draft.promotedAt)}
                accent={theme.text}
                theme={theme}
                scale={scale}
              />
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function comparisonBadgeAccent(
  badge: BacktestComparisonBadge,
  theme: ThemeTokens,
): string {
  if (badge.winner === "none" || badge.winner === "tie") {
    return theme.text;
  }

  if (badge.id === "drawdown") {
    return badge.winner === "latest" ? theme.green : theme.red;
  }

  return badge.winner === "latest" ? theme.green : theme.accent;
}

function tradeOverlayAccent(
  trade: { profitable?: boolean | null } | null | undefined,
  theme: ThemeTokens,
): string {
  if (!trade) {
    return theme.text;
  }

  return trade.profitable === false ? theme.red : theme.green;
}

function metricFromMetrics(
  metrics: BacktestMetrics | null | undefined,
  key: keyof BacktestMetrics,
): number | null {
  const value = metrics?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function resolveTradeOutcome(
  trade: Pick<BacktestTrade, "netPnl">,
): Exclude<TradeOutcomeFilter, "all"> {
  if (trade.netPnl > 0) {
    return "winner";
  }

  if (trade.netPnl < 0) {
    return "loser";
  }

  return "breakeven";
}

function parseDateInputToUtcMs(
  value: string,
  boundary: "start" | "end",
): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(
    `${value}T${boundary === "start" ? "00:00:00.000" : "23:59:59.999"}Z`,
  );
  return Number.isNaN(parsed) ? null : parsed;
}

export function AlgoDraftStrategiesPanel({
  theme,
  scale,
  isVisible = false,
}: AlgoDraftStrategiesPanelProps) {
  const { preferences: userPreferences } = useUserPreferences();
  const formatBacktestDateTime = useCallback(
    (value: string | null | undefined) => formatDateTime(value, userPreferences),
    [userPreferences],
  );
  useRuntimeWorkloadFlag("backtest:algo-drafts", isVisible, {
    kind: "poll",
    label: "Algo draft strategies",
    detail: "10s",
    priority: 8,
  });
  const draftsQuery = useListBacktestDraftStrategies({
    query: {
      queryKey: getListBacktestDraftStrategiesQueryKey(),
      enabled: Boolean(isVisible),
      staleTime: 5_000,
      refetchInterval: isVisible ? 10_000 : false,
    },
  });

  return (
    <div
      style={{
        background: theme.bg2,
        border: `1px solid ${theme.border}`,
        borderRadius: scale.dim(6),
        padding: scale.sp("12px 14px"),
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: scale.sp(8),
        }}
      >
        <div
          style={{
            fontSize: scale.fs(12),
            fontWeight: 400,
            fontFamily: theme.display,
            color: theme.text,
          }}
        >
          Promoted Drafts
        </div>
        <div
          style={{
            fontSize: scale.fs(9),
            color: theme.textDim,
            fontFamily: theme.mono,
          }}
        >
          {draftsQuery.data?.drafts?.length ?? 0} visible
        </div>
      </div>
      <DraftStrategiesList
        drafts={(draftsQuery.data?.drafts ?? []).slice(0, 3)}
        theme={theme}
        scale={scale}
        formatDateTimeLabel={formatBacktestDateTime}
        compact
      />
    </div>
  );
}


export function BacktestWorkspace({
  theme,
  scale,
  watchlists,
  defaultWatchlistId,
  isVisible = false,
}: BacktestWorkspaceProps) {
  const [backtestRootRef, backtestRootSize] = useElementSize();
  const { isPhone: backtestIsPhone, isNarrow: backtestIsNarrow } =
    responsiveFlags(backtestRootSize.width);
  const { preferences: userPreferences } = useUserPreferences();
  const formatBacktestDateTime = useCallback(
    (value: string | null | undefined) => formatDateTime(value, userPreferences),
    [userPreferences],
  );
  const formatBacktestHour = useCallback(
    (value: string | null | undefined) => formatHour(value, userPreferences),
    [userPreferences],
  );
  useRuntimeWorkloadFlag("backtest:workspace", isVisible, {
    kind: "poll",
    label: "Backtest workspace",
    detail: "5-15s",
    priority: 8,
  });
  const queryClient = useQueryClient();
  const strategiesQuery = useListBacktestStrategies({
    query: {
      queryKey: getListBacktestStrategiesQueryKey(),
      enabled: Boolean(isVisible),
      staleTime: 30_000,
    },
  });
  const studiesQuery = useListBacktestStudies({
    query: {
      queryKey: getListBacktestStudiesQueryKey(),
      enabled: Boolean(isVisible),
      staleTime: 5_000,
      refetchInterval: isVisible ? 15_000 : false,
    },
  });
  const draftsQuery = useListBacktestDraftStrategies({
    query: {
      queryKey: getListBacktestDraftStrategiesQueryKey(),
      enabled: Boolean(isVisible),
      staleTime: 5_000,
      refetchInterval: isVisible ? 10_000 : false,
    },
  });
  const {
    studies: indicatorLibraryStudies,
    indicatorRegistry,
    chartReadyPineScripts,
    pineScripts,
    pineScriptsQuery,
  } = useIndicatorLibrary();

  const [banner, setBanner] = useState<BannerState>(null);
  const [selectedStudyId, setSelectedStudyId] = useState("");
  const [selectedRunId, setSelectedRunId] = useState("");
  const [strategyKey, setStrategyKey] = useState("");
  const [studyName, setStudyName] = useState("SMA Crossover Study");
  const [universeMode, setUniverseMode] = useState<"watchlist" | "symbols">(
    "watchlist",
  );
  const [watchlistId, setWatchlistId] = useState(defaultWatchlistId ?? "");
  const [symbolsText, setSymbolsText] = useState("");
  const [timeframe, setTimeframe] = useState<BarTimeframe>("1d");
  const [directionMode, setDirectionMode] =
    useState<BacktestDirectionMode>("long_only");
  const [parameters, setParameters] = useState<Record<string, ScalarParameter>>(
    {},
  );
  const [startsOn, setStartsOn] = useState(formatDateInputValue(-365));
  const [endsOn, setEndsOn] = useState(formatDateInputValue(0));
  const [portfolioRules, setPortfolioRules] = useState({
    initialCapital: 25_000,
    positionSizePercent: 12,
    maxConcurrentPositions: 4,
    maxGrossExposurePercent: 100,
  });
  const [executionProfile, setExecutionProfile] = useState({
    commissionBps: 1,
    slippageBps: 3,
  });
  const [optimizerMode, setOptimizerMode] =
    useState<BacktestOptimizerMode>("grid");
  const [randomCandidateBudget, setRandomCandidateBudget] = useState(24);
  const [walkForwardTrainingMonths, setWalkForwardTrainingMonths] =
    useState(24);
  const [walkForwardTestMonths, setWalkForwardTestMonths] = useState(6);
  const [walkForwardStepMonths, setWalkForwardStepMonths] = useState(6);
  const [runNameDraft, setRunNameDraft] = useState("");
  const [selectedIndicators, setSelectedIndicators] = useState<string[]>(
    DEFAULT_BACKTEST_INDICATORS,
  );
  const [rayReplicaSettings, setRayReplicaSettings] = useState(() =>
    resolveRayReplicaRuntimeSettings(),
  );
  const [hasAutoEnabledRayAlgoOverlay, setHasAutoEnabledRayAlgoOverlay] =
    useState(false);
  const [summaryTradeLens, setSummaryTradeLens] =
    useState<SummaryTradeLens>("all");
  const [selectedRunChartSymbol, setSelectedRunChartSymbol] = useState("");
  const [spotHistoryMode, setSpotHistoryMode] =
    useState<SpotHistoryMode>("initial");
  const [selectedTradeSelectionId, setSelectedTradeSelectionId] = useState<
    string | null
  >(null);
  const [pendingTradeSelectionIds, setPendingTradeSelectionIds] = useState<
    string[]
  >([]);
  const [tradeSearchText, setTradeSearchText] = useState("");
  const [tradeSymbolFilter, setTradeSymbolFilter] = useState("all");
  const [tradeSideFilter, setTradeSideFilter] = useState<
    "all" | "long" | "short"
  >("all");
  const [tradeOutcomeFilter, setTradeOutcomeFilter] =
    useState<TradeOutcomeFilter>("all");
  const [tradeExitReasonFilter, setTradeExitReasonFilter] = useState("all");
  const [tradeDateFrom, setTradeDateFrom] = useState("");
  const [tradeDateTo, setTradeDateTo] = useState("");
  const [tradePage, setTradePage] = useState(1);
  const [promotionName, setPromotionName] = useState("");
  const [promotionNotes, setPromotionNotes] = useState("");
  const [editingPineScriptId, setEditingPineScriptId] = useState<string | null>(
    null,
  );
  const [pineScriptName, setPineScriptName] = useState("");
  const [pineScriptKey, setPineScriptKey] = useState("");
  const [pineScriptDescription, setPineScriptDescription] = useState("");
  const [pineScriptSourceCode, setPineScriptSourceCode] = useState(
    buildDefaultPineSourceCode(),
  );
  const [pineScriptStatus, setPineScriptStatus] =
    useState<PineScriptStatus>("draft");
  const [pineDefaultPaneType, setPineDefaultPaneType] =
    useState<PineScriptPaneType>("price");
  const [pineChartAccessEnabled, setPineChartAccessEnabled] = useState(true);
  const [pineNotes, setPineNotes] = useState("");
  const [pineTagsText, setPineTagsText] = useState("");
  const pineScriptKeyPreview = useMemo(
    () => buildPineScriptKeyPreview(pineScriptName),
    [pineScriptName],
  );

  const deferredSymbolsText = useDeferredValue(symbolsText);
  const parsedSymbols = useMemo(
    () => parseSymbolList(deferredSymbolsText),
    [deferredSymbolsText],
  );

  const studies = studiesQuery.data?.studies ?? [];
  const strategies = strategiesQuery.data?.strategies ?? [];
  const selectedStudy =
    studies.find((study) => study.id === selectedStudyId) ?? null;
  const selectedStrategy =
    strategies.find((strategy) => getStrategyKey(strategy) === strategyKey) ??
    null;
  const selectedStudyStrategy = selectedStudy
    ? (strategies.find(
        (strategy) =>
          strategy.strategyId === selectedStudy.strategyId &&
          strategy.version === selectedStudy.strategyVersion,
      ) ?? null)
    : null;

  const runsQuery = useListBacktestRuns(
    selectedStudyId ? { studyId: selectedStudyId } : undefined,
    {
      query: {
        queryKey: getListBacktestRunsQueryKey(
          selectedStudyId ? { studyId: selectedStudyId } : undefined,
        ),
        enabled: Boolean(isVisible && selectedStudyId),
        staleTime: 2_000,
        refetchInterval: isVisible ? 5_000 : false,
      },
    },
  );
  const jobsQuery = useListBacktestJobs({
    query: {
      queryKey: getListBacktestJobsQueryKey(),
      enabled: Boolean(isVisible),
      staleTime: 2_000,
      refetchInterval: isVisible ? 5_000 : false,
    },
  });
  const runDetailQuery = useGetBacktestRun(selectedRunId || "", {
    query: {
      queryKey: getGetBacktestRunQueryKey(selectedRunId || ""),
      enabled: Boolean(isVisible && selectedRunId),
      staleTime: 2_000,
      refetchInterval: isVisible ? 5_000 : false,
    },
  });
  const runChartQuery = useGetBacktestRunChart(
    selectedRunId || "",
    {
      symbol: selectedRunChartSymbol || undefined,
      selectedTradeId: selectedTradeSelectionId || undefined,
    },
    {
      query: {
        queryKey: getGetBacktestRunChartQueryKey(selectedRunId || "", {
          symbol: selectedRunChartSymbol || undefined,
          selectedTradeId: selectedTradeSelectionId || undefined,
        }),
        enabled: Boolean(isVisible && selectedRunId),
        staleTime: 2_000,
        refetchInterval: isVisible ? 5_000 : false,
      },
    },
  );
  const studyPreviewQuery = useGetBacktestStudyPreviewChart(
    selectedStudyId || "",
    {
      query: {
        queryKey: getGetBacktestStudyPreviewChartQueryKey(
          selectedStudyId || "",
        ),
        enabled: Boolean(isVisible && selectedStudyId),
        staleTime: 2_000,
        refetchInterval: isVisible ? 5_000 : false,
      },
    },
  );

  const createStudyMutation = useCreateBacktestStudy();
  const createRunMutation = useCreateBacktestRun();
  const createSweepMutation = useCreateBacktestSweep();
  const promoteRunMutation = usePromoteBacktestRun();
  const cancelJobMutation = useCancelBacktestJob();
  const createPineScriptMutation = useCreatePineScript();
  const updatePineScriptMutation = useUpdatePineScript();

  const runs = runsQuery.data?.runs ?? [];
  const jobs = jobsQuery.data?.jobs ?? [];
  const runDetail = runDetailQuery.data ?? null;
  const runChart = runChartQuery.data ?? null;
  const runChartModel = useMemo(
    () =>
      runChart
        ? buildBacktestChartModel(runChart, {
            selectedIndicators,
            indicatorSettings: {
              [RAY_REPLICA_PINE_SCRIPT_KEY]: rayReplicaSettings,
            },
            indicatorRegistry,
          })
        : null,
    [indicatorRegistry, rayReplicaSettings, runChart, selectedIndicators],
  );
  const previewChart = studyPreviewQuery.data ?? null;
  const derivedSweepDimensions = selectedStudy
    ? deriveSweepDimensions(selectedStudyStrategy, selectedStudy.parameters)
    : [];
  const activeJobs = jobs.filter((job) =>
    [
      "queued",
      "preparing_data",
      "running",
      "aggregating",
      "cancel_requested",
    ].includes(job.status),
  );
  const completedRuns = runs.filter((run) => run.status === "completed");
  const mergedPreviewSeries = useMemo(
    () =>
      previewChart
        ? mergeStudyPreviewSeries(
            previewChart.latestSeries,
            previewChart.bestSeries,
          )
        : [],
    [previewChart],
  );
  const activeTradeOverlay = useMemo(() => {
    if (!runChartModel) {
      return null;
    }

    return (
      runChartModel.tradeOverlays.find(
        (trade) =>
          trade.tradeSelectionId === runChartModel.activeTradeSelectionId,
      ) ?? null
    );
  }, [runChartModel]);
  const pendingTradeOptions = useMemo(() => {
    if (!runChart) {
      return [];
    }

    const overlaysById = new Map(
      runChart.tradeOverlays.map((trade) => [trade.tradeSelectionId, trade]),
    );

    return pendingTradeSelectionIds
      .map((tradeSelectionId) => overlaysById.get(tradeSelectionId))
      .filter((trade): trade is BacktestTradeOverlay => Boolean(trade));
  }, [pendingTradeSelectionIds, runChart]);
  const activeTradeSelectionId =
    runChart?.activeTradeSelectionId ?? selectedTradeSelectionId;
  const tradeRows = useMemo<TradeExplorerRow[]>(() => {
    if (!runDetail) {
      return [];
    }

    return runDetail.trades.map((trade) => ({
      ...trade,
      tradeSelectionId: buildRunTradeSelectionId(runDetail.run.id, trade),
      outcome: resolveTradeOutcome(trade),
      entryAtMs: Date.parse(trade.entryAt),
      exitAtMs: Date.parse(trade.exitAt),
    }));
  }, [runDetail]);
  const selectedTradeRecord = useMemo(() => {
    if (!activeTradeSelectionId) {
      return null;
    }

    return (
      tradeRows.find(
        (trade) => trade.tradeSelectionId === activeTradeSelectionId,
      ) ?? null
    );
  }, [activeTradeSelectionId, tradeRows]);
  const selectedTradeDiagnostics = selectedTradeRecord?.diagnostics ?? null;
  const selectedTradeExitConsequences =
    selectedTradeDiagnostics?.exitConsequences ?? null;
  const tradeSymbolOptions = useMemo(
    () => [...new Set(tradeRows.map((trade) => trade.symbol))].sort(),
    [tradeRows],
  );
  const tradeExitReasonOptions = useMemo(
    () => [...new Set(tradeRows.map((trade) => trade.exitReason))].sort(),
    [tradeRows],
  );
  const filteredTradeRows = useMemo(() => {
    const query = tradeSearchText.trim().toLowerCase();
    const minEntryAt = parseDateInputToUtcMs(tradeDateFrom, "start");
    const maxExitAt = parseDateInputToUtcMs(tradeDateTo, "end");

    return tradeRows.filter((trade) => {
      if (tradeSymbolFilter !== "all" && trade.symbol !== tradeSymbolFilter) {
        return false;
      }

      if (tradeSideFilter !== "all" && trade.side !== tradeSideFilter) {
        return false;
      }

      if (
        tradeOutcomeFilter !== "all" &&
        trade.outcome !== tradeOutcomeFilter
      ) {
        return false;
      }

      if (
        tradeExitReasonFilter !== "all" &&
        trade.exitReason !== tradeExitReasonFilter
      ) {
        return false;
      }

      if (minEntryAt != null && trade.entryAtMs < minEntryAt) {
        return false;
      }

      if (maxExitAt != null && trade.exitAtMs > maxExitAt) {
        return false;
      }

      if (!query) {
        return true;
      }

      const haystack = [
        trade.symbol,
        trade.underlying,
        trade.instrumentType,
        trade.pricingMode,
        trade.optionContract?.ticker,
        trade.optionContract?.underlying,
        trade.optionContract?.expirationDate,
        trade.optionContract?.strike,
        trade.optionContract?.right,
        trade.side,
        trade.exitReason,
        trade.tradeSelectionId,
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [
    tradeDateFrom,
    tradeDateTo,
    tradeExitReasonFilter,
    tradeOutcomeFilter,
    tradeRows,
    tradeSearchText,
    tradeSideFilter,
    tradeSymbolFilter,
  ]);
  const optionModeSupported =
    runChart?.chartPriceContext === "option" ||
    runChart?.tradeOverlays.some(
      (trade) =>
        trade.chartPriceContext === "option" ||
        trade.pricingMode === "options" ||
        trade.pricingMode === "option_history",
    ) ||
    false;
  const chartSymbolOptions = useMemo(
    () =>
      [
        ...new Set(
          (
            runChart?.availableSymbols ??
            runDetail?.study.symbols ??
            selectedStudy?.symbols ??
            []
          )
            .map((symbol) => symbol.toUpperCase())
            .filter(Boolean),
        ),
      ].sort(),
    [runChart?.availableSymbols, runDetail?.study.symbols, selectedStudy?.symbols],
  );
  const selectedChartSymbol =
    selectedRunChartSymbol || runChart?.selectedSymbol || chartSymbolOptions[0] || "";
  const selectedChartTimeframe = (runChart?.timeframe ??
    runDetail?.study.timeframe ??
    selectedStudy?.timeframe ??
    timeframe) as BarTimeframe;
  useEffect(() => {
    setSpotHistoryMode("initial");
  }, [selectedChartSymbol, selectedChartTimeframe]);
  const spotHistoryRange = useMemo(
    () => buildSpotHistoryRange(selectedChartTimeframe, spotHistoryMode),
    [selectedChartTimeframe, spotHistoryMode],
  );
  useEffect(() => {
    if (!isVisible) {
      void queryClient.cancelQueries({ queryKey: ["backtest-spot-history"] });
    }
  }, [isVisible, queryClient]);
  const spotHistoryQuery = useQuery({
    queryKey: [
      "backtest-spot-history",
      spotHistoryMode,
      selectedChartSymbol,
      selectedChartTimeframe,
      spotHistoryRange.fromIso,
      spotHistoryRange.toIso,
    ],
    enabled: Boolean(isVisible && selectedChartSymbol && selectedChartTimeframe),
    staleTime:
      spotHistoryMode === "expanded"
        ? SPOT_HISTORY_REFRESH_MS
        : SPOT_HISTORY_INITIAL_STALE_MS,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    retry: (failureCount, error) => !isAbortError(error) && failureCount < 1,
    queryFn: ({ signal }) =>
      fetchSpotHistoryBars({
        symbol: selectedChartSymbol,
        timeframe: selectedChartTimeframe,
        fromIso: spotHistoryRange.fromIso,
        toIso: spotHistoryRange.toIso,
        outsideRth: false,
        source: "trades",
        concurrency:
          spotHistoryMode === "expanded"
            ? SPOT_HISTORY_EXPANDED_FETCH_CONCURRENCY
            : SPOT_HISTORY_INITIAL_FETCH_CONCURRENCY,
        signal,
      }),
  });
  const spotChartModel = useMemo(
    () =>
      spotHistoryQuery.data?.bars?.length
        ? buildHydratedBacktestSpotChartModel({
            bars: spotHistoryQuery.data.bars.map((bar) => ({
              ...bar,
              source: bar.source ?? undefined,
            })),
            timeframe: selectedChartTimeframe,
            runChart,
            selectedIndicators,
            indicatorSettings: {
              [RAY_REPLICA_PINE_SCRIPT_KEY]: rayReplicaSettings,
            },
            indicatorRegistry,
          })
        : null,
    [
      indicatorRegistry,
      rayReplicaSettings,
      runChart,
      selectedChartTimeframe,
      selectedIndicators,
      spotHistoryQuery.data?.bars,
    ],
  );
  const optionChartHasRenderablePayload =
    optionModeSupported && runChart?.chartPriceContext === "option";
  const activeIndicatorCount = useMemo(
    () =>
      indicatorLibraryStudies.filter((study) =>
        selectedIndicators.includes(study.id),
      ).length,
    [indicatorLibraryStudies, selectedIndicators],
  );
  const pineScriptRows = useMemo(
    () =>
      pineScripts.map((script) => ({
        script,
        chartState: resolvePineScriptChartState(script),
      })),
    [pineScripts],
  );
  const editingPineScript = useMemo(
    () =>
      (editingPineScriptId
        ? pineScripts.find((script) => script.id === editingPineScriptId)
        : null) ?? null,
    [editingPineScriptId, pineScripts],
  );
  const pendingPineRuntimeCount = useMemo(
    () =>
      pineScriptRows.filter(
        ({ script, chartState }) =>
          script.status === "ready" &&
          script.chartAccessEnabled &&
          !chartState.runtimeAvailable,
      ).length,
    [pineScriptRows],
  );
  const activeBacktestStrategyId =
    runDetail?.study.strategyId ??
    selectedStudy?.strategyId ??
    selectedStrategy?.strategyId ??
    null;
  const spotHistorySourceLabel =
    spotHistoryQuery.data?.bars?.[spotHistoryQuery.data.bars.length - 1]
      ?.source ?? null;
  const spotHistoryBarCount = spotHistoryQuery.data?.bars?.length ?? 0;
  const spotHistoryAborted = isAbortError(spotHistoryQuery.error);
  const spotHistoryModeLabel =
    spotHistoryMode === "expanded"
      ? `${SPOT_HISTORY_LOOKBACK_YEARS}y full history`
      : `${resolveInitialSpotHistoryLookbackDays(selectedChartTimeframe)}d recent`;
  const spotHistoryStatusText = spotChartModel
    ? `Loaded ${spotHistoryBarCount} ${selectedChartTimeframe} bars for ${selectedChartSymbol || "selected symbol"}`
    : spotHistoryQuery.isError
      ? spotHistoryAborted
        ? "History loading canceled"
        : "Unable to load spot history"
      : spotHistoryMode === "expanded"
        ? "Loading full history"
        : "Loading recent chart history";
  const dominantExitReason = useMemo(() => {
    const counts = new Map<string, number>();
    tradeRows.forEach((trade) => {
      counts.set(trade.exitReason, (counts.get(trade.exitReason) ?? 0) + 1);
    });

    return [...counts.entries()].sort((left, right) => right[1] - left[1])[0];
  }, [tradeRows]);
  const exitReasonBreakdown = useMemo(() => {
    const counts = new Map<
      string,
      { reason: string; count: number; netPnl: number }
    >();

    filteredTradeRows.forEach((trade) => {
      const current = counts.get(trade.exitReason) ?? {
        reason: trade.exitReason,
        count: 0,
        netPnl: 0,
      };
      current.count += 1;
      current.netPnl += trade.netPnl;
      counts.set(trade.exitReason, current);
    });

    return [...counts.values()].sort(
      (left, right) => right.count - left.count || right.netPnl - left.netPnl,
    );
  }, [filteredTradeRows]);
  const symbolPerformance = useMemo(() => {
    const rows = new Map<
      string,
      { symbol: string; netPnl: number; tradeCount: number; winRate: number }
    >();

    filteredTradeRows.forEach((trade) => {
      const current = rows.get(trade.symbol) ?? {
        symbol: trade.symbol,
        netPnl: 0,
        tradeCount: 0,
        winRate: 0,
      };
      current.netPnl += trade.netPnl;
      current.tradeCount += 1;
      current.winRate += trade.outcome === "winner" ? 1 : 0;
      rows.set(trade.symbol, current);
    });

    return [...rows.values()]
      .map((entry) => ({
        ...entry,
        winRate:
          entry.tradeCount > 0 ? (entry.winRate / entry.tradeCount) * 100 : 0,
      }))
      .sort((left, right) => right.netPnl - left.netPnl)
      .slice(0, 8);
  }, [filteredTradeRows]);
  const bestTrade = tradeRows.reduce<TradeExplorerRow | null>(
    (best, trade) => (!best || trade.netPnl > best.netPnl ? trade : best),
    null,
  );
  const worstTrade = tradeRows.reduce<TradeExplorerRow | null>(
    (worst, trade) => (!worst || trade.netPnl < worst.netPnl ? trade : worst),
    null,
  );
  const longestHoldTrade = tradeRows.reduce<TradeExplorerRow | null>(
    (longest, trade) =>
      !longest || trade.barsHeld > longest.barsHeld ? trade : longest,
    null,
  );
  const latestTrade = tradeRows.reduce<TradeExplorerRow | null>(
    (latest, trade) =>
      !latest || trade.entryAtMs > latest.entryAtMs ? trade : latest,
    null,
  );
  const representativeTrades = useMemo(() => {
    const rows = [bestTrade, worstTrade, longestHoldTrade, latestTrade].filter(
      (trade): trade is TradeExplorerRow => Boolean(trade),
    );
    const seen = new Set<string>();
    return rows.filter((trade) => {
      if (seen.has(trade.tradeSelectionId)) {
        return false;
      }
      seen.add(trade.tradeSelectionId);
      return true;
    });
  }, [bestTrade, latestTrade, longestHoldTrade, worstTrade]);
  const biggestIssues = useMemo(() => {
    const rows: Array<{
      id: string;
      label: string;
      detail: string;
      tradeSelectionId: string;
      symbol: string;
    }> = [];

    if (worstTrade) {
      rows.push({
        id: `worst-${worstTrade.tradeSelectionId}`,
        label: "Worst Trade",
        detail: `${worstTrade.symbol} · ${formatCurrency(worstTrade.netPnl)}`,
        tradeSelectionId: worstTrade.tradeSelectionId,
        symbol: worstTrade.symbol,
      });
    }

    exitReasonBreakdown.slice(0, 3).forEach((issue) => {
      const sampleTrade = filteredTradeRows.find(
        (trade) => trade.exitReason === issue.reason,
      );
      if (!sampleTrade) {
        return;
      }

      rows.push({
        id: `reason-${issue.reason}`,
        label: issue.reason,
        detail: `${issue.count} trades · ${formatCurrency(issue.netPnl)}`,
        tradeSelectionId: sampleTrade.tradeSelectionId,
        symbol: sampleTrade.symbol,
      });
    });

    return rows.slice(0, 4);
  }, [exitReasonBreakdown, filteredTradeRows, worstTrade]);
  const summaryLensTrades = useMemo(() => {
    const rows =
      summaryTradeLens === "winners"
        ? tradeRows.filter((trade) => trade.outcome === "winner")
        : summaryTradeLens === "losers"
          ? tradeRows.filter((trade) => trade.outcome === "loser")
          : summaryTradeLens === "long"
            ? tradeRows.filter((trade) => trade.side === "long")
            : summaryTradeLens === "short"
              ? tradeRows.filter((trade) => trade.side === "short")
              : summaryTradeLens === "recent"
                ? [...tradeRows].sort(
                    (left, right) => right.entryAtMs - left.entryAtMs,
                  )
                : tradeRows;

    return rows.slice(0, 6);
  }, [summaryTradeLens, tradeRows]);
  const pnlByHour = useMemo(() => {
    const rows = new Map<
      string,
      { hour: string; netPnl: number; count: number }
    >();

    tradeRows.forEach((trade) => {
      const hour = formatBacktestHour(trade.entryAt);
      const current = rows.get(hour) ?? { hour, netPnl: 0, count: 0 };
      current.netPnl += trade.netPnl;
      current.count += 1;
      rows.set(hour, current);
    });

    return [...rows.values()].sort((left, right) => {
      const leftHour = Number.parseInt(left.hour, 10);
      const rightHour = Number.parseInt(right.hour, 10);
      return leftHour - rightHour;
    });
  }, [formatBacktestHour, tradeRows]);
  const holdProfile = useMemo(() => {
    const buckets = [
      { label: "1-2", min: 1, max: 2, count: 0 },
      { label: "3-5", min: 3, max: 5, count: 0 },
      { label: "6-10", min: 6, max: 10, count: 0 },
      { label: "11-20", min: 11, max: 20, count: 0 },
      { label: "21+", min: 21, max: Number.POSITIVE_INFINITY, count: 0 },
    ];

    filteredTradeRows.forEach((trade) => {
      const bucket = buckets.find(
        (entry) => trade.barsHeld >= entry.min && trade.barsHeld <= entry.max,
      );
      if (bucket) {
        bucket.count += 1;
      }
    });

    return buckets;
  }, [filteredTradeRows]);
  const tradeWaterfall = useMemo(
    () =>
      filteredTradeRows.slice(-40).map((trade, index) => ({
        label: `${index + 1}`,
        netPnl: trade.netPnl,
      })),
    [filteredTradeRows],
  );
  const pnlDistribution = useMemo(
    () =>
      [...filteredTradeRows]
        .sort((left, right) => left.netPnl - right.netPnl)
        .slice(0, 40)
        .map((trade, index) => ({
          bucket: `${index + 1}`,
          netPnl: trade.netPnl,
        })),
    [filteredTradeRows],
  );
  const runVsBestComparisons = useMemo(() => {
    const selectedMetrics = runDetail?.run.metrics ?? null;
    const bestMetrics = previewChart?.bestCompletedRun?.metrics ?? null;

    return [
      {
        id: "return",
        label: "Return",
        selected: metricFromMetrics(selectedMetrics, "totalReturnPercent"),
        best: metricFromMetrics(bestMetrics, "totalReturnPercent"),
        format: "percent" as const,
      },
      {
        id: "sharpe",
        label: "Sharpe",
        selected: metricFromMetrics(selectedMetrics, "sharpeRatio"),
        best: metricFromMetrics(bestMetrics, "sharpeRatio"),
        format: "number" as const,
      },
      {
        id: "drawdown",
        label: "Max DD",
        selected: metricFromMetrics(selectedMetrics, "maxDrawdownPercent"),
        best: metricFromMetrics(bestMetrics, "maxDrawdownPercent"),
        format: "percent" as const,
      },
      {
        id: "winrate",
        label: "Win Rate",
        selected: metricFromMetrics(selectedMetrics, "winRatePercent"),
        best: metricFromMetrics(bestMetrics, "winRatePercent"),
        format: "percent" as const,
      },
    ];
  }, [previewChart?.bestCompletedRun?.metrics, runDetail?.run.metrics]);
  const filteredTradeNetPnl = filteredTradeRows.reduce(
    (sum, trade) => sum + trade.netPnl,
    0,
  );
  const filteredTradeCommission = filteredTradeRows.reduce(
    (sum, trade) => sum + trade.commissionPaid,
    0,
  );
  const tradeExpectancy =
    tradeRows.length > 0
      ? tradeRows.reduce((sum, trade) => sum + trade.netPnl, 0) /
        tradeRows.length
      : null;
  const filteredTradeExpectancy =
    filteredTradeRows.length > 0
      ? filteredTradeNetPnl / filteredTradeRows.length
      : null;
  const filteredTradeAverageBarsHeld =
    filteredTradeRows.length > 0
      ? filteredTradeRows.reduce((sum, trade) => sum + trade.barsHeld, 0) /
        filteredTradeRows.length
      : null;
  const pageCount = Math.max(
    1,
    Math.ceil(filteredTradeRows.length / TRADES_PER_PAGE),
  );
  const paginatedTradeRows = filteredTradeRows.slice(
    (tradePage - 1) * TRADES_PER_PAGE,
    tradePage * TRADES_PER_PAGE,
  );
  const currentRunJobs = jobs.filter((job) => job.runId === selectedRunId);
  const latestRunJob = currentRunJobs[0] ?? null;
  const executionPhases = [
    {
      label: "Queued",
      active: runDetail?.run.status === "queued",
      complete: Boolean(
        runDetail &&
        runDetail.run.status !== "queued" &&
        runDetail.run.status !== "failed" &&
        runDetail.run.status !== "canceled",
      ),
    },
    {
      label: "Data Prep",
      active: runDetail?.run.status === "preparing_data",
      complete: ["running", "aggregating", "completed"].includes(
        runDetail?.run.status ?? "",
      ),
    },
    {
      label: "Running",
      active: runDetail?.run.status === "running",
      complete: ["aggregating", "completed"].includes(
        runDetail?.run.status ?? "",
      ),
    },
    {
      label: "Aggregating",
      active: runDetail?.run.status === "aggregating",
      complete: runDetail?.run.status === "completed",
    },
    {
      label: "Complete",
      active: runDetail?.run.status === "completed",
      complete: runDetail?.run.status === "completed",
    },
  ];
  const headlineMetrics =
    runDetail?.run.metrics ?? completedRuns[0]?.metrics ?? null;
  const advancedMetrics = asAdvancedMetrics(headlineMetrics?.advanced);
  const validationMetrics = asValidationMetrics(headlineMetrics?.validation);
  const dataQualityMetrics = asDataQualityMetrics(headlineMetrics?.dataQuality);
  const benchmarkMetrics = asBenchmarkMetrics(headlineMetrics?.benchmarks);
  const runWarnings = asStringArray(runDetail?.run.warnings);
  const validationWarnings = asStringArray(validationMetrics?.warnings);
  const trustWarnings = useMemo(
    () =>
      [...runWarnings, ...validationWarnings].filter(
        (warning, index, allWarnings) => allWarnings.indexOf(warning) === index,
      ),
    [runWarnings, validationWarnings],
  );

  useEffect(() => {
    if (hasAutoEnabledRayAlgoOverlay) {
      return;
    }

    if (activeBacktestStrategyId !== "ray_replica_signals") {
      return;
    }

    const hasChartReadyRayAlgo = chartReadyPineScripts.some(
      (script) => script.scriptKey === RAY_REPLICA_PINE_SCRIPT_KEY,
    );

    if (!hasChartReadyRayAlgo) {
      return;
    }

    setSelectedIndicators((current) =>
      current.includes(RAY_REPLICA_PINE_SCRIPT_KEY)
        ? current
        : [RAY_REPLICA_PINE_SCRIPT_KEY, ...current],
    );
    setHasAutoEnabledRayAlgoOverlay(true);
  }, [
    activeBacktestStrategyId,
    chartReadyPineScripts,
    hasAutoEnabledRayAlgoOverlay,
  ]);

  useEffect(() => {
    if (!watchlistId && defaultWatchlistId) {
      setWatchlistId(defaultWatchlistId);
      return;
    }

    if (!watchlistId && watchlists[0]?.id) {
      setWatchlistId(watchlists[0].id);
    }
  }, [defaultWatchlistId, watchlistId, watchlists]);

  useEffect(() => {
    if (strategies.length === 0 || strategyKey) {
      return;
    }

    const initialStrategy =
      strategies.find((strategy) => strategy.status === "runnable") ??
      strategies[0];
    if (!initialStrategy) {
      return;
    }

    setStrategyKey(getStrategyKey(initialStrategy));
    setParameters(defaultParametersForStrategy(initialStrategy));
    setTimeframe(initialStrategy.supportedTimeframes[0] ?? "1d");
    setDirectionMode(initialStrategy.directionMode);
    setStudyName(`${initialStrategy.label} Study`);
  }, [strategies, strategyKey]);

  useEffect(() => {
    if (studies.length === 0) {
      setSelectedStudyId("");
      return;
    }

    const hasSelection = studies.some((study) => study.id === selectedStudyId);
    if (!hasSelection) {
      setSelectedStudyId(studies[0].id);
    }
  }, [selectedStudyId, studies]);

  useEffect(() => {
    if (runs.length === 0) {
      setSelectedRunId("");
      return;
    }

    const hasSelection = runs.some((run) => run.id === selectedRunId);
    if (!hasSelection) {
      setSelectedRunId(runs[0].id);
    }
  }, [runs, selectedRunId]);

  useEffect(() => {
    setSelectedRunChartSymbol("");
    setSelectedTradeSelectionId(null);
    setPendingTradeSelectionIds([]);
    setTradePage(1);
    setSummaryTradeLens("all");
  }, [selectedRunId]);

  useEffect(() => {
    if (!selectedStudy) {
      return;
    }

    setRunNameDraft(`${selectedStudy.name} Run`);
  }, [selectedStudy?.id]);

  useEffect(() => {
    if (!runDetail?.run) {
      return;
    }

    setPromotionName(`${runDetail.run.name} Draft`);
  }, [runDetail?.run.id]);

  useEffect(() => {
    setTradePage(1);
  }, [
    selectedRunId,
    tradeDateFrom,
    tradeDateTo,
    tradeExitReasonFilter,
    tradeOutcomeFilter,
    tradeSearchText,
    tradeSideFilter,
    tradeSymbolFilter,
  ]);

  async function refreshBacktestQueries(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/api/backtests/studies"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/backtests/runs"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/backtests/jobs"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/backtests/drafts"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/backtests/sweeps"] }),
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey[0];
          return (
            typeof key === "string" &&
            (key.startsWith("/api/backtests/studies/") ||
              key.startsWith("/api/backtests/runs/"))
          );
        },
      }),
    ]);
  }

  async function refreshPineQueries(): Promise<void> {
    await queryClient.invalidateQueries({
      queryKey: getListPineScriptsQueryKey(),
    });
  }

  function resetPineEditor(): void {
    setEditingPineScriptId(null);
    setPineScriptName("");
    setPineScriptKey("");
    setPineScriptDescription("");
    setPineScriptSourceCode(buildDefaultPineSourceCode());
    setPineScriptStatus("draft");
    setPineDefaultPaneType("price");
    setPineChartAccessEnabled(true);
    setPineNotes("");
    setPineTagsText("");
  }

  function populatePineEditor(script: PineScriptRecord): void {
    setEditingPineScriptId(script.id);
    setPineScriptName(script.name);
    setPineScriptKey(script.scriptKey);
    setPineScriptDescription(script.description ?? "");
    setPineScriptSourceCode(script.sourceCode);
    setPineScriptStatus(script.status);
    setPineDefaultPaneType(script.defaultPaneType);
    setPineChartAccessEnabled(script.chartAccessEnabled);
    setPineNotes(script.notes ?? "");
    setPineTagsText(script.tags.join(", "));
  }

  function handleToggleIndicator(indicatorId: string): void {
    setSelectedIndicators((current) =>
      current.includes(indicatorId)
        ? current.filter((entry) => entry !== indicatorId)
        : [...current, indicatorId],
    );
  }

  function handleRunChartSymbolChange(nextSymbol: string): void {
    setSelectedRunChartSymbol(nextSymbol);
    setSelectedTradeSelectionId(null);
    setPendingTradeSelectionIds([]);
  }

  function handleTradeSelection(
    tradeSelectionId: string | null,
    symbol?: string | null,
  ): void {
    if (symbol) {
      setSelectedRunChartSymbol(symbol.toUpperCase());
    }

    setSelectedTradeSelectionId(tradeSelectionId);
    setPendingTradeSelectionIds([]);
  }

  function handleTradeMarkerSelection(tradeSelectionIds: string[]): void {
    if (tradeSelectionIds.length <= 1) {
      handleTradeSelection(tradeSelectionIds[0] ?? null);
      return;
    }

    setPendingTradeSelectionIds(tradeSelectionIds);
  }

  function applyStrategySelection(
    nextStrategy: BacktestStrategyCatalogItem,
  ): void {
    setStrategyKey(getStrategyKey(nextStrategy));
    setParameters(defaultParametersForStrategy(nextStrategy));
    setTimeframe(
      nextStrategy.supportedTimeframes.includes(timeframe)
        ? timeframe
        : (nextStrategy.supportedTimeframes[0] ?? "1d"),
    );
    setDirectionMode(nextStrategy.directionMode);
    setStudyName(`${nextStrategy.label} Study`);
  }

  async function handleSavePineScript(): Promise<void> {
    const trimmedName = pineScriptName.trim();
    const trimmedDescription = pineScriptDescription.trim();
    const trimmedKey = pineScriptKey.trim();
    const trimmedNotes = pineNotes.trim();
    const tags = parseDelimitedList(pineTagsText);

    if (!trimmedName) {
      setBanner({
        kind: "error",
        title: "Pine name required",
        detail:
          "Give the script a name before saving it into the shared chart library.",
      });
      return;
    }

    if (!pineScriptSourceCode.trim()) {
      setBanner({
        kind: "error",
        title: "Pine source required",
        detail: "Paste the Pine source before saving the script.",
      });
      return;
    }

    try {
      const savedScript = editingPineScriptId
        ? await updatePineScriptMutation.mutateAsync({
            scriptId: editingPineScriptId,
            data: {
              name: trimmedName,
              description: trimmedDescription || undefined,
              sourceCode: pineScriptSourceCode,
              status: pineScriptStatus,
              defaultPaneType: pineDefaultPaneType,
              chartAccessEnabled: pineChartAccessEnabled,
              notes: trimmedNotes || undefined,
              tags,
            },
          })
        : await createPineScriptMutation.mutateAsync({
            data: {
              scriptKey: trimmedKey || undefined,
              name: trimmedName,
              description: trimmedDescription || undefined,
              sourceCode: pineScriptSourceCode,
              status: pineScriptStatus,
              defaultPaneType: pineDefaultPaneType,
              chartAccessEnabled: pineChartAccessEnabled,
              notes: trimmedNotes || undefined,
              tags,
            },
          });

      populatePineEditor(savedScript);
      await refreshPineQueries();

      const chartState = resolvePineScriptChartState(savedScript);
      setBanner({
        kind: chartState.chartReady ? "success" : "info",
        title: editingPineScriptId
          ? "Pine script updated"
          : "Pine script saved",
        detail: chartState.chartReady
          ? `${savedScript.name} is available in shared chart indicator menus.`
          : `${savedScript.name} was saved. ${chartState.reason}`,
      });
    } catch (error) {
      setBanner({
        kind: "error",
        title: editingPineScriptId ? "Pine update failed" : "Pine save failed",
        detail: safeErrorMessage(error),
      });
    }
  }

  async function handleCreateStudy(): Promise<void> {
    if (!selectedStrategy) {
      setBanner({
        kind: "error",
        title: "Strategy required",
        detail: "Pick a backtest strategy before saving the study.",
      });
      return;
    }

    if (startsOn > endsOn) {
      setBanner({
        kind: "error",
        title: "Invalid study window",
        detail: "The end date must be on or after the start date.",
      });
      return;
    }

    if (universeMode === "symbols" && parsedSymbols.length === 0) {
      setBanner({
        kind: "error",
        title: "Universe required",
        detail: "Enter at least one ticker or choose a watchlist universe.",
      });
      return;
    }

    if (universeMode === "watchlist" && !watchlistId) {
      setBanner({
        kind: "error",
        title: "Watchlist required",
        detail: "Choose a watchlist before saving the study.",
      });
      return;
    }

    try {
      const startsAt = toStartOfDayIso(startsOn);
      const endsAt = toEndOfDayIso(endsOn);
      if (!startsAt || !endsAt) {
        setBanner({
          kind: "error",
          title: "Invalid date range",
          detail: "Choose valid start and end dates before saving the study.",
        });
        return;
      }

      const createdStudy = await createStudyMutation.mutateAsync({
        data: {
          name: studyName.trim(),
          strategyId: selectedStrategy.strategyId,
          strategyVersion: selectedStrategy.version,
          directionMode,
          watchlistId: universeMode === "watchlist" ? watchlistId : null,
          symbols: universeMode === "symbols" ? parsedSymbols : [],
          timeframe,
          startsAt,
          endsAt,
          parameters,
          portfolioRules,
          executionProfile,
          optimizerMode,
          optimizerConfig: {
            randomCandidateBudget,
            walkForwardTrainingMonths,
            walkForwardTestMonths,
            walkForwardStepMonths,
          },
        },
      });

      setSelectedStudyId(createdStudy.id);
      setBanner({
        kind: "success",
        title: "Study saved",
        detail: `${createdStudy.name} is ready for queued runs and sweeps.`,
      });
      await refreshBacktestQueries();
    } catch (error) {
      setBanner({
        kind: "error",
        title: "Study creation failed",
        detail: safeErrorMessage(error),
      });
    }
  }

  async function handleQueueRun(): Promise<void> {
    if (!selectedStudy) {
      return;
    }

    try {
      const createdRun = await createRunMutation.mutateAsync({
        data: {
          studyId: selectedStudy.id,
          name: runNameDraft.trim() || null,
          parameters: null,
        },
      });

      setSelectedRunId(createdRun.run.id);
      setBanner({
        kind: "success",
        title: "Run queued",
        detail: `${createdRun.run.name} is waiting for the worker.`,
      });
      await refreshBacktestQueries();
    } catch (error) {
      setBanner({
        kind: "error",
        title: "Run queue failed",
        detail: safeErrorMessage(error),
      });
    }
  }

  async function handleQueueSweep(): Promise<void> {
    if (!selectedStudy) {
      return;
    }

    if (derivedSweepDimensions.length === 0) {
      setBanner({
        kind: "error",
        title: "Sweep dimensions unavailable",
        detail:
          "The selected study does not expose enough parameter range to derive a sweep.",
      });
      return;
    }

    try {
      const optimizerConfig = isRecord(selectedStudy.optimizerConfig)
        ? selectedStudy.optimizerConfig
        : {};
      const createdSweep = await createSweepMutation.mutateAsync({
        data: {
          studyId: selectedStudy.id,
          mode: selectedStudy.optimizerMode,
          baseParameters: selectedStudy.parameters,
          dimensions: derivedSweepDimensions,
          randomCandidateBudget: numberFromUnknown(
            optimizerConfig.randomCandidateBudget,
            24,
          ),
          walkForwardTrainingMonths: numberFromUnknown(
            optimizerConfig.walkForwardTrainingMonths,
            24,
          ),
          walkForwardTestMonths: numberFromUnknown(
            optimizerConfig.walkForwardTestMonths,
            6,
          ),
          walkForwardStepMonths: numberFromUnknown(
            optimizerConfig.walkForwardStepMonths,
            6,
          ),
        },
      });

      setBanner({
        kind: "success",
        title: "Sweep queued",
        detail: `${createdSweep.mode} sweep accepted for ${selectedStudy.name}.`,
      });
      await refreshBacktestQueries();
    } catch (error) {
      setBanner({
        kind: "error",
        title: "Sweep queue failed",
        detail: safeErrorMessage(error),
      });
    }
  }

  async function handlePromoteRun(): Promise<void> {
    if (!runDetail || runDetail.run.status !== "completed") {
      return;
    }

    try {
      const draft = await promoteRunMutation.mutateAsync({
        runId: runDetail.run.id,
        data: {
          name: promotionName.trim(),
          notes: promotionNotes.trim() || null,
        },
      });

      setBanner({
        kind: "success",
        title: "Run promoted",
        detail: `${draft.name} is now visible in the Algo draft queue.`,
      });
      await refreshBacktestQueries();
    } catch (error) {
      setBanner({
        kind: "error",
        title: "Promotion failed",
        detail: safeErrorMessage(error),
      });
    }
  }

  async function handleCancelJob(jobId: string): Promise<void> {
    try {
      await cancelJobMutation.mutateAsync({ jobId });
      setBanner({
        kind: "info",
        title: "Cancellation requested",
        detail: "The worker will stop the job at the next safe checkpoint.",
      });
      await refreshBacktestQueries();
    } catch (error) {
      setBanner({
        kind: "error",
        title: "Cancel failed",
        detail: safeErrorMessage(error),
      });
    }
  }

  return (
    <div
      ref={backtestRootRef}
      data-testid="backtest-workspace"
      data-layout={backtestIsPhone ? "phone" : backtestIsNarrow ? "tablet" : "desktop"}
      style={{
        padding: scale.sp(backtestIsPhone ? 5 : 8),
        display: "flex",
        flexDirection: "column",
        gap: scale.sp(8),
        height: "100%",
        width: "100%",
        overflowY: "auto",
        minWidth: 0,
      }}
    >
      {banner ? (
        <div
          onClick={() => setBanner(null)}
          style={{
            ...cardStyle(theme, scale),
            border: "none",
            background: `${getBannerColor(banner.kind, theme)}12`,
            cursor: "pointer",
          }}
        >
          <div
            style={{
              fontSize: scale.fs(11),
              fontWeight: 400,
              color: theme.text,
            }}
          >
            {banner.title}
          </div>
          <div
            style={{
              fontSize: scale.fs(10),
              color: theme.textSec,
              marginTop: scale.sp(4),
            }}
          >
            {banner.detail}
          </div>
        </div>
      ) : null}

      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 8,
          paddingTop: scale.sp(4),
          background: `${theme.bg1}f2`,
          backdropFilter: "blur(10px)",
        }}
      >
        <div
          style={{
            ...cardStyle(theme, scale),
            background: theme.bg2,
            boxShadow: `0 10px 24px ${theme.bg0}33`,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: scale.sp(10),
              alignItems: "flex-start",
              flexWrap: "wrap",
              marginBottom: scale.sp(10),
            }}
          >
            <div>
              <div
                style={{
                  fontSize: scale.fs(13),
                  fontWeight: 400,
                  fontFamily: theme.display,
                  color: theme.text,
                }}
              >
                Research Workbench
              </div>
              <div
                style={{
                  marginTop: scale.sp(3),
                  fontSize: scale.fs(9),
                  color: theme.textDim,
                  fontFamily: theme.mono,
                }}
              >
                Configure research inputs at the top, inspect spot and options
                charts side by side, then work downward through summary,
                trades, diagnostics, and history.
              </div>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: scale.sp(8),
                flexWrap: "wrap",
              }}
            >
              {selectedStudyStrategy ? (
                <StatusBadge
                  status={selectedStudyStrategy.status}
                  theme={theme}
                  scale={scale}
                />
              ) : null}
              {runDetail ? (
                <StatusBadge
                  status={runDetail.run.status}
                  theme={theme}
                  scale={scale}
                />
              ) : null}
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: scale.sp(8),
              alignItems: "end",
            }}
          >
            <div>
              <div style={fieldLabelStyle(theme, scale)}>Study</div>
              <select
                value={selectedStudyId}
                onChange={(event) => setSelectedStudyId(event.target.value)}
                style={inputStyle(theme, scale)}
              >
                {studies.length === 0 ? (
                  <option value="">No studies available</option>
                ) : null}
                {studies.map((study) => (
                  <option key={study.id} value={study.id}>
                    {study.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div style={fieldLabelStyle(theme, scale)}>Run</div>
              <select
                value={selectedRunId}
                onChange={(event) => setSelectedRunId(event.target.value)}
                style={inputStyle(theme, scale)}
              >
                {runs.length === 0 ? (
                  <option value="">No runs queued</option>
                ) : null}
                {runs.map((run) => (
                  <option key={run.id} value={run.id}>
                    {run.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div style={fieldLabelStyle(theme, scale)}>Symbol</div>
              <select
                value={selectedChartSymbol}
                onChange={(event) => handleRunChartSymbolChange(event.target.value)}
                style={inputStyle(theme, scale)}
              >
                {chartSymbolOptions.length === 0 ? (
                  <option value="">No symbols available</option>
                ) : null}
                {chartSymbolOptions.map((symbol) => (
                  <option key={symbol} value={symbol}>
                    {symbol}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div style={fieldLabelStyle(theme, scale)}>Queue Run Name</div>
              <input
                value={runNameDraft}
                onChange={(event) => setRunNameDraft(event.target.value)}
                placeholder="Name this queued run"
                style={inputStyle(theme, scale)}
              />
            </div>
            <button
              type="button"
              onClick={() => void handleQueueRun()}
              disabled={
                !selectedStudy || selectedStudyStrategy?.status !== "runnable"
              }
              style={{
                ...buttonStyle(theme, scale, "primary"),
                opacity:
                  !selectedStudy || selectedStudyStrategy?.status !== "runnable"
                    ? 0.5
                    : 1,
              }}
            >
              Queue Run
            </button>
            <button
              type="button"
              onClick={() => void handleQueueSweep()}
              disabled={
                !selectedStudy || selectedStudyStrategy?.status !== "runnable"
              }
              style={{
                ...buttonStyle(theme, scale, "secondary"),
                opacity:
                  !selectedStudy || selectedStudyStrategy?.status !== "runnable"
                    ? 0.5
                    : 1,
              }}
            >
              Queue Sweep
            </button>
            <button
              type="button"
              onClick={() => void handlePromoteRun()}
              disabled={runDetail?.run.status !== "completed"}
              style={{
                ...buttonStyle(theme, scale, "ghost"),
                opacity: runDetail?.run.status !== "completed" ? 0.5 : 1,
              }}
            >
              Promote
            </button>
          </div>
        </div>
      </div>

      <SectionCard
        title="Backtest Inputs"
        theme={theme}
        scale={scale}
        right={
          <div
            style={{
              fontSize: scale.fs(9),
              color: theme.textDim,
              fontFamily: theme.mono,
            }}
          >
            study + execution
          </div>
        }
      >
        <details open>
          <summary
            style={{
              cursor: "pointer",
              fontSize: scale.fs(10),
              fontWeight: 400,
              color: theme.textSec,
            }}
          >
            Configure study, universe, timeframe, and execution inputs without
            losing the chart workspace below
          </summary>
          <div
            style={{
              marginTop: scale.sp(10),
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: scale.sp(8),
            }}
          >
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={fieldLabelStyle(theme, scale)}>Strategy</div>
              <select
                value={strategyKey}
                onChange={(event) => {
                  const nextStrategy = strategies.find(
                    (strategy) =>
                      getStrategyKey(strategy) === event.target.value,
                  );
                  if (nextStrategy) {
                    applyStrategySelection(nextStrategy);
                  }
                }}
                style={inputStyle(theme, scale)}
              >
                {strategies.map((strategy) => (
                  <option
                    key={getStrategyKey(strategy)}
                    value={getStrategyKey(strategy)}
                  >
                    {strategy.label} · v{strategy.version} · {strategy.status}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div style={fieldLabelStyle(theme, scale)}>Study Name</div>
              <input
                value={studyName}
                onChange={(event) => setStudyName(event.target.value)}
                style={inputStyle(theme, scale)}
              />
            </div>
            <div>
              <div style={fieldLabelStyle(theme, scale)}>Timeframe</div>
              <select
                value={timeframe}
                onChange={(event) =>
                  setTimeframe(event.target.value as BarTimeframe)
                }
                style={inputStyle(theme, scale)}
              >
                {(selectedStrategy?.supportedTimeframes ?? ["1d"]).map(
                  (value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ),
                )}
              </select>
            </div>
            <div>
              <div style={fieldLabelStyle(theme, scale)}>Direction</div>
              <select
                value={directionMode}
                onChange={(event) =>
                  setDirectionMode(event.target.value as BacktestDirectionMode)
                }
                style={inputStyle(theme, scale)}
              >
                <option value="long_only">long_only</option>
                <option value="long_short">long_short</option>
              </select>
            </div>
            <div>
              <div style={fieldLabelStyle(theme, scale)}>Start</div>
              <input
                type="date"
                value={startsOn}
                onChange={(event) => setStartsOn(event.target.value)}
                style={inputStyle(theme, scale)}
              />
            </div>
            <div>
              <div style={fieldLabelStyle(theme, scale)}>End</div>
              <input
                type="date"
                value={endsOn}
                onChange={(event) => setEndsOn(event.target.value)}
                style={inputStyle(theme, scale)}
              />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={fieldLabelStyle(theme, scale)}>Universe</div>
              <div
                style={{
                  display: "inline-flex",
                  border: `1px solid ${theme.border}`,
                  borderRadius: scale.dim(999),
                  padding: scale.sp(2),
                  background: theme.bg0,
                  marginBottom: scale.sp(8),
                }}
              >
                <button
                  type="button"
                  onClick={() => setUniverseMode("watchlist")}
                  style={buttonStyle(
                    theme,
                    scale,
                    universeMode === "watchlist" ? "primary" : "ghost",
                  )}
                >
                  Watchlist
                </button>
                <button
                  type="button"
                  onClick={() => setUniverseMode("symbols")}
                  style={buttonStyle(
                    theme,
                    scale,
                    universeMode === "symbols" ? "primary" : "ghost",
                  )}
                >
                  Symbols
                </button>
              </div>
              {universeMode === "watchlist" ? (
                <select
                  value={watchlistId}
                  onChange={(event) => setWatchlistId(event.target.value)}
                  style={inputStyle(theme, scale)}
                >
                  {watchlists.map((watchlist) => (
                    <option key={watchlist.id} value={watchlist.id}>
                      {watchlist.name}
                    </option>
                  ))}
                </select>
              ) : (
                <textarea
                  value={symbolsText}
                  onChange={(event) => setSymbolsText(event.target.value)}
                  rows={3}
                  placeholder="AAPL, MSFT, NVDA"
                  style={{ ...inputStyle(theme, scale), resize: "vertical" }}
                />
              )}
            </div>
            <div
              style={{
                gridColumn: "1 / -1",
                fontSize: scale.fs(9),
                color: theme.textDim,
              }}
            >
              Uses strategy defaults for the deep parameter set, portfolio
              rules, execution profile, and optimizer tuning. This keeps the
              main page analysis-first while still putting the critical inputs
              above the chart workspace.
            </div>
            <button
              type="button"
              onClick={() => void handleCreateStudy()}
              style={buttonStyle(theme, scale, "primary")}
            >
              Save Study
            </button>
          </div>
        </details>
      </SectionCard>

      <SectionCard
        title="Charts Workspace"
        theme={theme}
        scale={scale}
        right={
          <div
            style={{
              fontSize: scale.fs(9),
              color: theme.textDim,
              fontFamily: theme.mono,
            }}
          >
            {spotHistoryBarCount || runChart?.chartBars.length || 0} bars ·{" "}
            {runChart?.tradeOverlays.length ?? 0} overlays
          </div>
        }
      >
        <div style={{ display: "grid", gap: scale.sp(10) }}>
          <div
            style={{
              fontSize: scale.fs(10),
              color: theme.textSec,
              lineHeight: 1.5,
            }}
          >
            The spot chart is the primary visual truth surface. The options
            panel stays linked to the same selected trade and is reserved for
            option replay once contract-history payloads are available.
          </div>

          <div
            style={{
              ...cardStyle(theme, scale),
              background: theme.bg0,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: scale.sp(8),
              alignItems: "end",
            }}
          >
            <div>
              <div style={fieldLabelStyle(theme, scale)}>Focused Trade</div>
              <div
                style={{
                  ...inputStyle(theme, scale),
                  display: "flex",
                  alignItems: "center",
                }}
              >
                {selectedTradeRecord
                  ? `${selectedTradeRecord.symbol} · ${selectedTradeRecord.side}`
                  : activeTradeOverlay
                    ? `${activeTradeOverlay.symbol} · ${activeTradeOverlay.dir}`
                    : "No trade selected"}
              </div>
            </div>
            <div>
              <div style={fieldLabelStyle(theme, scale)}>Spot Status</div>
              <div
                style={{
                  ...inputStyle(theme, scale),
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span>
                  {spotHistoryStatusText}
                </span>
                <span
                  style={{
                    color: spotChartModel ? theme.green : theme.textDim,
                    fontWeight: 400,
                    fontFamily: theme.mono,
                  }}
                >
                  {spotHistorySourceLabel
                    ? spotHistorySourceLabel.toUpperCase()
                    : "SPOT"}
                </span>
              </div>
            </div>
            <div>
              <div style={fieldLabelStyle(theme, scale)}>Options Status</div>
              <div
                style={{
                  ...inputStyle(theme, scale),
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span>
                  {optionChartHasRenderablePayload
                    ? "Option replay payload ready"
                    : optionModeSupported
                      ? "Option-linked trades detected"
                      : "Awaiting option-history payload"}
                </span>
                <span
                  style={{
                    color: optionChartHasRenderablePayload
                      ? theme.green
                      : theme.amber,
                    fontWeight: 400,
                    fontFamily: theme.mono,
                  }}
                >
                  OPTIONS
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setSelectedTradeSelectionId(null);
                setPendingTradeSelectionIds([]);
              }}
              style={buttonStyle(theme, scale, "ghost")}
            >
              Clear Trade Focus
            </button>
            <button
              type="button"
              onClick={() => setSpotHistoryMode("expanded")}
              disabled={spotHistoryMode === "expanded" || spotHistoryQuery.isFetching}
              style={buttonStyle(
                theme,
                scale,
                spotHistoryMode === "expanded" ? "secondary" : "ghost",
              )}
            >
              {spotHistoryMode === "expanded"
                ? "Full History Selected"
                : "Load Full History"}
            </button>
          </div>

          <div
            style={{
              padding: scale.sp("10px 12px"),
              borderRadius: scale.dim(5),
              border: `1px solid ${theme.border}`,
              background: theme.bg1,
              display: "grid",
              gap: scale.sp(8),
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: scale.sp(8),
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <div>
                <div style={fieldLabelStyle(theme, scale)}>
                  Chart Indicators
                </div>
                <div
                  style={{
                    fontSize: scale.fs(10),
                    color: theme.textSec,
                  }}
                >
                  Built-ins and chart-ready Pine scripts use the same shared
                  indicator library across backtest and research charts.
                </div>
              </div>
              <div
                style={{
                  fontSize: scale.fs(9),
                  color: theme.textDim,
                  fontFamily: theme.mono,
                  display: "flex",
                  alignItems: "center",
                  gap: scale.sp(8),
                }}
              >
                <span>
                  {activeIndicatorCount} active · {chartReadyPineScripts.length} Pine ready
                </span>
                <RayReplicaSettingsMenu
                  theme={theme}
                  settings={rayReplicaSettings}
                  onChange={setRayReplicaSettings}
                  disabled={!selectedIndicators.includes(RAY_REPLICA_PINE_SCRIPT_KEY)}
                />
              </div>
            </div>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: scale.sp(6),
              }}
            >
              {indicatorLibraryStudies.map((study) => {
                const active = selectedIndicators.includes(study.id);
                return (
                  <button
                    key={study.id}
                    type="button"
                    onClick={() => handleToggleIndicator(study.id)}
                    style={{
                      ...buttonStyle(
                        theme,
                        scale,
                        active ? "primary" : "ghost",
                      ),
                      display: "inline-flex",
                      alignItems: "center",
                      gap: scale.sp(6),
                    }}
                  >
                    <span>{study.label}</span>
                    <span
                      style={{
                        fontSize: scale.fs(8),
                        fontFamily: theme.mono,
                        opacity: 0.8,
                      }}
                    >
                      {study.kind === "pine"
                        ? `PINE · ${study.paneType ?? "price"}`
                        : study.paneType === "lower"
                          ? "LOWER"
                          : "PRICE"}
                    </span>
                  </button>
                );
              })}
            </div>

            {pendingPineRuntimeCount > 0 ? (
              <div
                style={{
                  fontSize: scale.fs(9),
                  color: theme.textDim,
                }}
              >
                {pendingPineRuntimeCount} Pine script
                {pendingPineRuntimeCount === 1 ? "" : "s"} marked ready but
                still waiting on a JS runtime adapter before they can be
                toggled onto charts.
              </div>
            ) : null}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))",
              gap: scale.sp(10),
              alignItems: "start",
            }}
          >
            <div style={{ ...cardStyle(theme, scale), background: theme.bg0 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: scale.sp(8),
                  alignItems: "center",
                  marginBottom: scale.sp(8),
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: scale.fs(10),
                      fontWeight: 400,
                      color: theme.textSec,
                    }}
                  >
                    Spot Chart
                  </div>
                  <div
                    style={{
                      fontSize: scale.fs(9),
                      color: theme.textDim,
                      fontFamily: theme.mono,
                    }}
                  >
                    {selectedChartSymbol || "No symbol"} ·{" "}
                    {selectedChartTimeframe || "—"} · {spotHistoryModeLabel}
                  </div>
                </div>
                <div
                  style={{
                    fontSize: scale.fs(9),
                    color: theme.textDim,
                    fontFamily: theme.mono,
                  }}
                >
                  {runChart?.tradeOverlays.length ?? 0} trades on chart
                </div>
              </div>

              <div style={{ height: scale.dim(460) }}>
                {spotChartModel ? (
                  <ResearchChartFrame
                    dataTestId="backtest-spot-chart"
                    theme={theme}
                    themeKey="backtest-workspace-spot"
                    rangeIdentityKey={`backtest-spot:${selectedRunId}:${selectedChartSymbol}:${selectedChartTimeframe}`}
                    model={spotChartModel}
                    placement="backtest"
                    showLegend
                    style={{ height: "100%" }}
                    onTradeMarkerSelection={handleTradeMarkerSelection}
                    surfaceBottomOverlay={
                      pendingTradeOptions.length > 0 ? (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: scale.sp(8),
                            padding: scale.sp("8px 10px"),
                            background: `${theme.bg2}e6`,
                            borderTop: `1px solid ${theme.border}`,
                            flexWrap: "wrap",
                          }}
                        >
                          <span
                            style={{
                              fontSize: scale.fs(9),
                              color: theme.textMuted,
                              textTransform: "uppercase",
                              letterSpacing: "0.06em",
                            }}
                          >
                            Overlapping Trades
                          </span>
                          {pendingTradeOptions.map((trade) => (
                            <button
                              key={trade.tradeSelectionId}
                              type="button"
                              onClick={() =>
                                handleTradeSelection(trade.tradeSelectionId)
                              }
                              style={buttonStyle(theme, scale, "secondary")}
                            >
                              {trade.symbol} · {formatBacktestDateTime(trade.entryTs)} ·{" "}
                              {formatPercent(trade.pnlPercent ?? null)}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() => setPendingTradeSelectionIds([])}
                            style={buttonStyle(theme, scale, "ghost")}
                          >
                            Dismiss
                          </button>
                        </div>
                      ) : null
                    }
                    surfaceBottomOverlayHeight={
                      pendingTradeOptions.length > 0 ? scale.dim(64) : 0
                    }
                  />
                ) : spotHistoryQuery.isError && !spotHistoryAborted ? (
                  <div
                    style={{
                      height: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: theme.red,
                      fontSize: scale.fs(10),
                      textAlign: "center",
                      padding: scale.sp("0 20px"),
                    }}
                  >
                    {safeErrorMessage(spotHistoryQuery.error)}
                  </div>
                ) : (
                  <div
                    style={{
                      height: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: theme.textDim,
                      fontSize: scale.fs(10),
                      textAlign: "center",
                    }}
                  >
                    {spotHistoryStatusText} for{" "}
                    {selectedChartSymbol || "the selected symbol"}.
                  </div>
                )}
              </div>
            </div>

            <div style={{ ...cardStyle(theme, scale), background: theme.bg0 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: scale.sp(8),
                  alignItems: "center",
                  marginBottom: scale.sp(8),
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: scale.fs(10),
                      fontWeight: 400,
                      color: theme.textSec,
                    }}
                  >
                    Options Chart
                  </div>
                  <div
                    style={{
                      fontSize: scale.fs(9),
                      color: theme.textDim,
                      fontFamily: theme.mono,
                    }}
                  >
                    Linked to the current trade selection
                  </div>
                </div>
                <div
                  style={{
                    fontSize: scale.fs(9),
                    color: optionChartHasRenderablePayload
                      ? theme.green
                      : theme.amber,
                    fontFamily: theme.mono,
                    fontWeight: 400,
                  }}
                >
                  {optionChartHasRenderablePayload ? "READY" : "PENDING"}
                </div>
              </div>

              <div style={{ height: scale.dim(460) }}>
                {optionChartHasRenderablePayload && runChartModel ? (
                  <ResearchChartFrame
                    dataTestId="backtest-options-chart"
                    theme={theme}
                    themeKey="backtest-workspace-options"
                    rangeIdentityKey={`backtest-options:${selectedRunId}:${selectedChartSymbol}:${selectedChartTimeframe}`}
                    model={runChartModel}
                    placement="backtest"
                    showLegend
                    style={{ height: "100%" }}
                    onTradeMarkerSelection={handleTradeMarkerSelection}
                  />
                ) : (
                  <div
                    style={{
                      height: "100%",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "center",
                      gap: scale.sp(10),
                      padding: scale.sp("16px 18px"),
                      border: `1px dashed ${theme.border}`,
                      borderRadius: scale.dim(6),
                      background: theme.bg1,
                    }}
                  >
                    <div
                      style={{
                        fontSize: scale.fs(12),
                        fontWeight: 400,
                        color: theme.text,
                      }}
                    >
                      Option replay chart is reserved but not hydrated yet.
                    </div>
                    <div
                      style={{
                        fontSize: scale.fs(10),
                        color: theme.textSec,
                        lineHeight: 1.55,
                        maxWidth: scale.dim(560),
                      }}
                    >
                      {optionModeSupported
                        ? "Option-linked trade metadata exists, but the workbench does not have a dedicated contract-history chart payload mounted yet."
                        : "The current backtest run only exposes spot bars and share-aligned trade overlays. This panel will switch to contract replay once option-history payloads are available."}
                    </div>
                    {selectedTradeRecord || activeTradeOverlay ? (
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns:
                            "repeat(auto-fit, minmax(180px, 1fr))",
                          gap: scale.sp(8),
                        }}
                      >
                        <MetricCard
                          label="Selected Trade"
                          value={
                            selectedTradeRecord
                              ? formatBacktestInstrumentLabel(selectedTradeRecord)
                              : activeTradeOverlay?.symbol ??
                                "—"
                          }
                          accent={theme.text}
                          theme={theme}
                          scale={scale}
                        />
                        <MetricCard
                          label="Underlying"
                          value={
                            selectedTradeRecord?.underlying ??
                            selectedTradeRecord?.symbol ??
                            activeTradeOverlay?.symbol ??
                            "—"
                          }
                          accent={theme.text}
                          theme={theme}
                          scale={scale}
                        />
                        <MetricCard
                          label="Direction"
                          value={
                            selectedTradeRecord?.side ??
                            activeTradeOverlay?.dir ??
                            "—"
                          }
                          accent={theme.text}
                          theme={theme}
                          scale={scale}
                        />
                        <MetricCard
                          label="Entry / Exit"
                          value={`${formatNumber(selectedTradeRecord?.entryPrice ?? activeTradeOverlay?.entryPrice ?? null)} / ${formatNumber(selectedTradeRecord?.exitPrice ?? activeTradeOverlay?.exitPrice ?? null)}`}
                          accent={tradeOverlayAccent(activeTradeOverlay, theme)}
                          theme={theme}
                          scale={scale}
                        />
                        <MetricCard
                          label="Net PnL"
                          value={formatCurrency(
                            selectedTradeRecord?.netPnl ??
                              activeTradeOverlay?.pnl ??
                              null,
                          )}
                          accent={tradeOverlayAccent(activeTradeOverlay, theme)}
                          theme={theme}
                          scale={scale}
                        />
                      </div>
                    ) : (
                      <div
                        style={{
                          fontSize: scale.fs(9),
                          color: theme.textDim,
                        }}
                      >
                        Select a trade from the spot chart or the trades table
                        to prepare this option replay panel.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Summary" theme={theme} scale={scale}>
        {!runDetail ? (
          <div style={{ color: theme.textDim, fontSize: scale.fs(10) }}>
            Select a run to inspect the summary, pattern buckets, trade replay,
            and selected-trade forensics together.
          </div>
        ) : (
          <div style={{ display: "grid", gap: scale.sp(10) }}>
            <div
              style={{
                fontSize: scale.fs(10),
                color: theme.textSec,
                lineHeight: 1.5,
              }}
            >
              Backtest Summary combines the top-line readout, representative
              trades, and selected-trade forensics into one surface. Use the
              chart workspace above together with the quick-pick cards and
              trade lens here to drive focus.
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                gap: scale.sp(8),
              }}
            >
              <div style={{ ...cardStyle(theme, scale), background: theme.bg0 }}>
                <div
                  style={{
                    fontSize: scale.fs(10),
                    fontWeight: 400,
                    color: theme.textSec,
                    marginBottom: scale.sp(8),
                  }}
                >
                  Trust Report
                </div>
                <div style={{ display: "grid", gap: scale.sp(6) }}>
                  {[
                    [
                      "Source policy",
                      dataQualityMetrics?.sourcePolicy?.replaceAll("_", " ") ??
                        "—",
                    ],
                    [
                      "Primary source",
                      dataQualityMetrics?.primarySource ?? "—",
                    ],
                    [
                      "Coverage",
                      formatPercent(dataQualityMetrics?.coveragePercent, 1),
                    ],
                    [
                      "Recent cutoff",
                      typeof dataQualityMetrics?.ibkrRecentCutoffMinutes === "number"
                        ? `${dataQualityMetrics.ibkrRecentCutoffMinutes} min`
                        : "—",
                    ],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: scale.sp(8),
                        fontSize: scale.fs(9),
                      }}
                    >
                      <span style={{ color: theme.textMuted }}>{label}</span>
                      <span
                        style={{
                          color: theme.textSec,
                          fontFamily: theme.mono,
                          textAlign: "right",
                        }}
                      >
                        {value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ ...cardStyle(theme, scale), background: theme.bg0 }}>
                <div
                  style={{
                    fontSize: scale.fs(10),
                    fontWeight: 400,
                    color: theme.textSec,
                    marginBottom: scale.sp(8),
                  }}
                >
                  Validation
                </div>
                <div style={{ display: "grid", gap: scale.sp(6) }}>
                  {[
                    [
                      "Trials",
                      formatNumber(validationMetrics?.trialCount),
                    ],
                    [
                      "OOS windows",
                      formatNumber(validationMetrics?.oosWindowCount),
                    ],
                    [
                      "Deflated Sharpe",
                      formatNumber(advancedMetrics?.deflatedSharpeRatio),
                    ],
                    [
                      "PSR",
                      typeof advancedMetrics?.probabilisticSharpeRatio === "number"
                        ? formatPercent(
                            advancedMetrics.probabilisticSharpeRatio * 100,
                          )
                        : "—",
                    ],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: scale.sp(8),
                        fontSize: scale.fs(9),
                      }}
                    >
                      <span style={{ color: theme.textMuted }}>{label}</span>
                      <span style={{ color: theme.textSec, fontFamily: theme.mono }}>
                        {value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ ...cardStyle(theme, scale), background: theme.bg0 }}>
                <div
                  style={{
                    fontSize: scale.fs(10),
                    fontWeight: 400,
                    color: theme.textSec,
                    marginBottom: scale.sp(8),
                  }}
                >
                  Benchmarks
                </div>
                <div style={{ display: "grid", gap: scale.sp(6) }}>
                  {benchmarkMetrics.length === 0 ? (
                    <div style={{ color: theme.textDim, fontSize: scale.fs(9) }}>
                      Benchmark data is not available for this run.
                    </div>
                  ) : (
                    benchmarkMetrics.map((benchmark) => (
                      <div
                        key={benchmark.symbol}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "0.5fr 1fr 1fr",
                          gap: scale.sp(8),
                          fontSize: scale.fs(9),
                        }}
                      >
                        <span style={{ color: theme.text, fontWeight: 400 }}>
                          {benchmark.symbol}
                        </span>
                        <span style={{ color: theme.textSec }}>
                          {formatPercent(benchmark.totalReturnPercent)}
                        </span>
                        <span style={{ color: theme.textDim }}>
                          β {formatNumber(benchmark.beta)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {trustWarnings.length > 0 ? (
              <div
                style={{
                  ...cardStyle(theme, scale),
                  background: theme.bg0,
                  borderColor: theme.amber,
                }}
              >
                <div
                  style={{
                    fontSize: scale.fs(10),
                    fontWeight: 400,
                    color: theme.amber,
                    marginBottom: scale.sp(8),
                  }}
                >
                  Promotion Caveats
                </div>
                <div style={{ display: "grid", gap: scale.sp(6) }}>
                  {trustWarnings.slice(0, 5).map((warning) => (
                    <div
                      key={warning}
                      style={{
                        fontSize: scale.fs(9),
                        color: theme.textSec,
                        lineHeight: 1.4,
                      }}
                    >
                      {warning}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                gap: scale.sp(8),
              }}
            >
              <MetricCard
                label="Net PnL"
                value={formatCurrency(headlineMetrics?.netPnl ?? null)}
                accent={
                  (headlineMetrics?.netPnl ?? 0) >= 0 ? theme.green : theme.red
                }
                theme={theme}
                scale={scale}
              />
              <MetricCard
                label="ROI"
                value={formatPercent(
                  headlineMetrics?.totalReturnPercent ?? null,
                )}
                accent={
                  (headlineMetrics?.totalReturnPercent ?? 0) >= 0
                    ? theme.green
                    : theme.red
                }
                theme={theme}
                scale={scale}
              />
              <MetricCard
                label="Trade Count"
                value={String(headlineMetrics?.tradeCount ?? "—")}
                accent={theme.text}
                theme={theme}
                scale={scale}
              />
              <MetricCard
                label="Win Rate"
                value={formatPercent(headlineMetrics?.winRatePercent ?? null)}
                accent={theme.text}
                theme={theme}
                scale={scale}
              />
              <MetricCard
                label="Profit Factor"
                value={formatNumber(headlineMetrics?.profitFactor ?? null)}
                accent={theme.accent}
                theme={theme}
                scale={scale}
              />
              <MetricCard
                label="Expectancy"
                value={formatCurrency(tradeExpectancy)}
                accent={theme.text}
                theme={theme}
                scale={scale}
              />
              <MetricCard
                label="Average Hold"
                value={formatNumber(filteredTradeAverageBarsHeld)}
                accent={theme.text}
                theme={theme}
                scale={scale}
              />
              <MetricCard
                label="Fees"
                value={formatCurrency(filteredTradeCommission)}
                accent={theme.text}
                theme={theme}
                scale={scale}
              />
              <MetricCard
                label="Sortino"
                value={formatNumber(advancedMetrics?.sortinoRatio)}
                accent={theme.accent}
                theme={theme}
                scale={scale}
              />
              <MetricCard
                label="Calmar"
                value={formatNumber(advancedMetrics?.calmarRatio)}
                accent={theme.accent}
                theme={theme}
                scale={scale}
              />
              <MetricCard
                label="Monte Carlo P05"
                value={formatPercent(
                  advancedMetrics?.monteCarlo?.p05ReturnPercent,
                )}
                accent={theme.text}
                theme={theme}
                scale={scale}
              />
              <MetricCard
                label="Loss Risk"
                value={formatPercent(
                  advancedMetrics?.monteCarlo?.probabilityOfLossPercent,
                )}
                accent={theme.red}
                theme={theme}
                scale={scale}
              />
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: scale.sp(8),
              }}
            >
              {[
                {
                  label: "Run State",
                  value: runDetail.run.status.replaceAll("_", " "),
                },
                {
                  label: "Cost Model",
                  value: `Commission ${executionProfile.commissionBps}bps · Slippage ${executionProfile.slippageBps}bps`,
                },
                {
                  label: "Backtest Window",
                  value: `${formatBacktestDateTime(runDetail.study.startsAt)} → ${formatBacktestDateTime(runDetail.study.endsAt)}`,
                },
                {
                  label: "Coverage",
                  value: `${runDetail.datasets.length} cached datasets · ${runChart?.chartBars.length ?? 0} loaded bars`,
                },
                {
                  label: "Closed Trades",
                  value: `${tradeRows.length} recorded`,
                },
                {
                  label: "Dominant Exit",
                  value: dominantExitReason
                    ? `${dominantExitReason[0]} (${dominantExitReason[1]})`
                    : "—",
                },
                {
                  label: "Best Trade",
                  value: bestTrade
                    ? `${bestTrade.symbol} ${formatCurrency(bestTrade.netPnl)}`
                    : "—",
                },
                {
                  label: "Worst Trade",
                  value: worstTrade
                    ? `${worstTrade.symbol} ${formatCurrency(worstTrade.netPnl)}`
                    : "—",
                },
              ].map((row) => (
                <div
                  key={row.label}
                  style={{
                    ...cardStyle(theme, scale),
                    background: theme.bg0,
                    padding: scale.sp("10px 12px"),
                  }}
                >
                  <div
                    style={{
                      fontSize: scale.fs(8),
                      color: theme.textMuted,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      marginBottom: scale.sp(4),
                    }}
                  >
                    {row.label}
                  </div>
                  <div
                    style={{
                      fontSize: scale.fs(10),
                      color: theme.textSec,
                      fontFamily: theme.mono,
                    }}
                  >
                    {row.value}
                  </div>
                </div>
              ))}
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 0.95fr) minmax(0, 1.05fr)",
                gap: scale.sp(10),
                alignItems: "start",
              }}
            >
              <div style={{ display: "grid", gap: scale.sp(10) }}>
                <div
                  style={{ ...cardStyle(theme, scale), background: theme.bg0 }}
                >
                  <div
                    style={{
                      fontSize: scale.fs(10),
                      fontWeight: 400,
                      color: theme.textSec,
                      marginBottom: scale.sp(8),
                    }}
                  >
                    Representative Trades
                  </div>
                  <div style={{ display: "grid", gap: scale.sp(6) }}>
                    {representativeTrades.length === 0 ? (
                      <div
                        style={{ color: theme.textDim, fontSize: scale.fs(10) }}
                      >
                        Trade quick-picks appear once closed trades exist.
                      </div>
                    ) : (
                      representativeTrades.map((trade) => (
                        <button
                          key={trade.tradeSelectionId}
                          type="button"
                          onClick={() =>
                            handleTradeSelection(
                              trade.tradeSelectionId,
                              trade.symbol,
                            )
                          }
                          style={{
                            textAlign: "left",
                            border: `1px solid ${theme.border}`,
                            borderRadius: scale.dim(5),
                            background: theme.bg2,
                            padding: scale.sp("8px 10px"),
                            cursor: "pointer",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: scale.sp(8),
                            }}
                          >
                            <div>
                              <div
                                style={{
                                  fontSize: scale.fs(10),
                                  fontWeight: 400,
                                  color: theme.text,
                                }}
                              >
                                {trade.symbol} · {trade.side}
                              </div>
                              <div
                                style={{
                                  fontSize: scale.fs(8),
                                  color: theme.textDim,
                                  fontFamily: theme.mono,
                                }}
                              >
                                {formatBacktestDateTime(trade.entryAt)}
                              </div>
                            </div>
                            <div
                              style={{
                                fontSize: scale.fs(10),
                                fontWeight: 400,
                                color:
                                  trade.netPnl >= 0 ? theme.green : theme.red,
                                fontFamily: theme.mono,
                              }}
                            >
                              {formatCurrency(trade.netPnl)}
                            </div>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>

                <div
                  style={{ ...cardStyle(theme, scale), background: theme.bg0 }}
                >
                  <div
                    style={{
                      fontSize: scale.fs(10),
                      fontWeight: 400,
                      color: theme.textSec,
                      marginBottom: scale.sp(8),
                    }}
                  >
                    Biggest Issues
                  </div>
                  <div style={{ display: "grid", gap: scale.sp(6) }}>
                    {biggestIssues.length === 0 ? (
                      <div
                        style={{ color: theme.textDim, fontSize: scale.fs(10) }}
                      >
                        Issue cards will appear when exit reasons or outliers
                        are available.
                      </div>
                    ) : (
                      biggestIssues.map((issue) => (
                        <button
                          key={issue.id}
                          type="button"
                          onClick={() =>
                            handleTradeSelection(
                              issue.tradeSelectionId,
                              issue.symbol,
                            )
                          }
                          style={{
                            textAlign: "left",
                            border: `1px solid ${theme.border}`,
                            borderRadius: scale.dim(5),
                            background: theme.bg2,
                            padding: scale.sp("8px 10px"),
                            cursor: "pointer",
                          }}
                        >
                          <div
                            style={{
                              fontSize: scale.fs(9),
                              color: theme.textMuted,
                              textTransform: "uppercase",
                              letterSpacing: "0.06em",
                            }}
                          >
                            {issue.label}
                          </div>
                          <div
                            style={{
                              marginTop: scale.sp(4),
                              fontSize: scale.fs(10),
                              color: theme.textSec,
                              fontFamily: theme.mono,
                            }}
                          >
                            {issue.detail}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>

                <div
                  style={{ ...cardStyle(theme, scale), background: theme.bg0 }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: scale.sp(8),
                      marginBottom: scale.sp(8),
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    <div
                      style={{
                        fontSize: scale.fs(10),
                        fontWeight: 400,
                        color: theme.textSec,
                      }}
                    >
                      Trade Lens
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: scale.sp(6),
                      }}
                    >
                      {(
                        [
                          ["all", "All"],
                          ["winners", "Winners"],
                          ["losers", "Losers"],
                          ["long", "Long"],
                          ["short", "Short"],
                          ["recent", "Recent"],
                        ] as Array<[SummaryTradeLens, string]>
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setSummaryTradeLens(value)}
                          style={{
                            ...buttonStyle(
                              theme,
                              scale,
                              summaryTradeLens === value ? "primary" : "ghost",
                            ),
                            padding: scale.sp("5px 9px"),
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: "grid", gap: scale.sp(6) }}>
                    {summaryLensTrades.length === 0 ? (
                      <div
                        style={{ color: theme.textDim, fontSize: scale.fs(10) }}
                      >
                        No trades match the selected lens.
                      </div>
                    ) : (
                      summaryLensTrades.map((trade) => (
                        <button
                          key={trade.tradeSelectionId}
                          type="button"
                          onClick={() =>
                            handleTradeSelection(
                              trade.tradeSelectionId,
                              trade.symbol,
                            )
                          }
                          style={{
                            textAlign: "left",
                            border: `1px solid ${theme.border}`,
                            borderRadius: scale.dim(5),
                            background:
                              trade.tradeSelectionId === activeTradeSelectionId
                                ? theme.accentDim
                                : theme.bg2,
                            padding: scale.sp("8px 10px"),
                            cursor: "pointer",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: scale.sp(8),
                            }}
                          >
                            <div>
                              <div
                                style={{
                                  fontSize: scale.fs(10),
                                  fontWeight: 400,
                                  color: theme.text,
                                }}
                              >
                                {trade.symbol} · {trade.exitReason}
                              </div>
                              <div
                                style={{
                                  fontSize: scale.fs(8),
                                  color: theme.textDim,
                                  fontFamily: theme.mono,
                                }}
                              >
                                {formatBacktestDateTime(trade.entryAt)} →{" "}
                                {formatBacktestDateTime(trade.exitAt)}
                              </div>
                            </div>
                            <div
                              style={{
                                fontSize: scale.fs(10),
                                fontWeight: 400,
                                color:
                                  trade.netPnl >= 0 ? theme.green : theme.red,
                                fontFamily: theme.mono,
                              }}
                            >
                              {formatCurrency(trade.netPnl)}
                            </div>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div style={{ display: "grid", gap: scale.sp(10) }}>
                <div
                  style={{ ...cardStyle(theme, scale), background: theme.bg0 }}
                >
                  <div
                    style={{
                      fontSize: scale.fs(10),
                      fontWeight: 400,
                      color: theme.textSec,
                      marginBottom: scale.sp(8),
                    }}
                  >
                    P&amp;L By Hour
                  </div>
                  <div style={{ height: scale.dim(210) }}>
                    {pnlByHour.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={pnlByHour}
                          margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                        >
                          <CartesianGrid
                            stroke={theme.borderLight || theme.border}
                            strokeDasharray="0"
                            vertical={false}
                          />
                          <XAxis
                            axisLine={false}
                            tickLine={false}
                            dataKey="hour"
                            tick={{
                              fill: theme.textMuted,
                              fontSize: scale.fs(8),
                            }}
                          />
                          <YAxis
                            axisLine={false}
                            tickLine={false}
                            tick={{
                              fill: theme.textMuted,
                              fontSize: scale.fs(8),
                            }}
                            tickFormatter={(value: number) =>
                              `$${compactFormatter.format(value)}`
                            }
                          />
                          <Tooltip
                            contentStyle={chartTooltipContentStyle}
                          />
                          <Bar
                            dataKey="netPnl"
                            fill={theme.accent}
                            radius={[4, 4, 0, 0]}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div
                        style={{ color: theme.textDim, fontSize: scale.fs(10) }}
                      >
                        Hourly realized outcomes appear after trades are
                        recorded.
                      </div>
                    )}
                  </div>
                </div>

                <div
                  style={{ ...cardStyle(theme, scale), background: theme.bg0 }}
                >
                  <div
                    style={{
                      fontSize: scale.fs(10),
                      fontWeight: 400,
                      color: theme.textSec,
                      marginBottom: scale.sp(8),
                    }}
                  >
                    Selected Trade
                  </div>
                  {!selectedTradeRecord && !activeTradeOverlay ? (
                    <div
                      style={{ color: theme.textDim, fontSize: scale.fs(10) }}
                    >
                      Pick a representative trade, issue card, chart marker, or
                      trade row to inspect its forensic detail.
                    </div>
                  ) : (
                    <div style={{ display: "grid", gap: scale.sp(8) }}>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns:
                            "repeat(auto-fit, minmax(160px, 1fr))",
                          gap: scale.sp(8),
                        }}
                      >
                        <MetricCard
                          label="Direction"
                          value={
                            selectedTradeRecord?.side ??
                            activeTradeOverlay?.dir ??
                            "—"
                          }
                          accent={theme.text}
                          theme={theme}
                          scale={scale}
                        />
                        {selectedTradeRecord?.instrumentType === "option" ? (
                          <MetricCard
                            label="Contract"
                            value={formatBacktestInstrumentLabel(
                              selectedTradeRecord,
                            )}
                            accent={theme.text}
                            theme={theme}
                            scale={scale}
                          />
                        ) : null}
                        <MetricCard
                          label="Net / Gross"
                          value={`${formatCurrency(selectedTradeRecord?.netPnl ?? activeTradeOverlay?.pnl ?? null)} / ${formatCurrency(selectedTradeRecord?.grossPnl ?? null)}`}
                          accent={tradeOverlayAccent(activeTradeOverlay, theme)}
                          theme={theme}
                          scale={scale}
                        />
                        <MetricCard
                          label="Hold"
                          value={
                            selectedTradeDiagnostics
                              ? `${selectedTradeRecord?.barsHeld ?? "—"} bars · ${formatNumber(selectedTradeDiagnostics.holdMinutes, 0)}m`
                              : `${selectedTradeRecord?.barsHeld ?? "—"} bars`
                          }
                          accent={theme.text}
                          theme={theme}
                          scale={scale}
                        />
                        <MetricCard
                          label="MFE"
                          value={
                            selectedTradeDiagnostics
                              ? `${formatSignedCurrency(selectedTradeDiagnostics.maxFavorableDelta)} · ${formatPercent(selectedTradeDiagnostics.maxFavorablePercent)}`
                              : "—"
                          }
                          accent={
                            (selectedTradeDiagnostics?.maxFavorableDelta ?? 0) >
                            0
                              ? theme.green
                              : theme.text
                          }
                          theme={theme}
                          scale={scale}
                        />
                        <MetricCard
                          label="MAE"
                          value={
                            selectedTradeDiagnostics
                              ? `${formatSignedCurrency(selectedTradeDiagnostics.maxAdverseDelta)} · ${formatPercent(selectedTradeDiagnostics.maxAdversePercent)}`
                              : "—"
                          }
                          accent={
                            (selectedTradeDiagnostics?.maxAdverseDelta ?? 0) < 0
                              ? theme.red
                              : theme.text
                          }
                          theme={theme}
                          scale={scale}
                        />
                        <MetricCard
                          label="Fees"
                          value={formatCurrency(
                            selectedTradeRecord?.commissionPaid ?? null,
                          )}
                          accent={theme.text}
                          theme={theme}
                          scale={scale}
                        />
                      </div>
                      <div
                        style={{
                          border: `1px solid ${theme.border}`,
                          borderRadius: scale.dim(5),
                          padding: scale.sp("10px 12px"),
                          background: theme.bg2,
                          fontSize: scale.fs(9),
                          color: theme.textSec,
                          display: "grid",
                          gap: scale.sp(6),
                        }}
                      >
                        <div>
                          Instrument:{" "}
                          {selectedTradeRecord
                            ? `${formatBacktestPricingLabel(selectedTradeRecord)} · ${selectedTradeRecord.underlying ?? selectedTradeRecord.symbol}`
                            : activeTradeOverlay?.symbol ?? "—"}
                        </div>
                        {selectedTradeRecord?.instrumentType === "option" ? (
                          <div>
                            Contract:{" "}
                            {formatBacktestInstrumentLabel(selectedTradeRecord)}
                            {selectedTradeRecord.optionContract?.ticker
                              ? ` · ${selectedTradeRecord.optionContract.ticker}`
                              : ""}
                          </div>
                        ) : null}
                        <div>
                          Signal / Entry / Exit:{" "}
                          {formatBacktestDateTime(
                            selectedTradeRecord?.entryAt ??
                              activeTradeOverlay?.entryTs,
                          )}{" "}
                          →{" "}
                          {formatBacktestDateTime(
                            selectedTradeRecord?.exitAt ??
                              activeTradeOverlay?.exitTs ??
                              null,
                          )}
                        </div>
                        <div>
                          Exit detail:{" "}
                          {selectedTradeRecord?.exitReason ??
                            activeTradeOverlay?.er ??
                            "—"}
                        </div>
                        <div>
                          Entry / Exit price:{" "}
                          {formatNumber(
                            selectedTradeRecord?.entryPrice ??
                              activeTradeOverlay?.entryPrice ??
                              null,
                          )}{" "}
                          /{" "}
                          {formatNumber(
                            selectedTradeRecord?.exitPrice ??
                              activeTradeOverlay?.exitPrice ??
                              null,
                          )}
                        </div>
                        <div>
                          Quantity:{" "}
                          {numberFormatter.format(
                            selectedTradeRecord?.quantity ??
                              activeTradeOverlay?.qty ??
                              0,
                          )}
                        </div>
                        <div>
                          Best / Worst during hold:{" "}
                          {selectedTradeDiagnostics
                            ? `${formatNumber(selectedTradeDiagnostics.maxFavorablePrice)} @ ${formatBacktestDateTime(selectedTradeDiagnostics.maxFavorableAt)} / ${formatNumber(selectedTradeDiagnostics.maxAdversePrice)} @ ${formatBacktestDateTime(selectedTradeDiagnostics.maxAdverseAt)}`
                            : "—"}
                        </div>
                        <div>
                          Entry / Exit bars:{" "}
                          {selectedTradeDiagnostics
                            ? `${selectedTradeDiagnostics.entryBarIndex ?? "—"} / ${selectedTradeDiagnostics.exitBarIndex ?? "—"}`
                            : "—"}
                        </div>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns:
                            "repeat(auto-fit, minmax(260px, 1fr))",
                          gap: scale.sp(8),
                        }}
                      >
                        <div
                          style={{
                            border: `1px solid ${theme.border}`,
                            borderRadius: scale.dim(5),
                            padding: scale.sp("10px 12px"),
                            background: theme.bg2,
                          }}
                        >
                          <div
                            style={{
                              fontSize: scale.fs(9),
                              color: theme.textMuted,
                              textTransform: "uppercase",
                              letterSpacing: "0.06em",
                              marginBottom: scale.sp(6),
                            }}
                          >
                            Reason Trace
                          </div>
                          {selectedTradeDiagnostics?.reasonTrace.length ? (
                            <div style={{ display: "grid", gap: scale.sp(6) }}>
                              {selectedTradeDiagnostics.reasonTrace.map(
                                (step) => (
                                  <div
                                    key={step.id}
                                    style={{
                                      display: "grid",
                                      gridTemplateColumns:
                                        "minmax(0, 1fr) auto",
                                      gap: scale.sp(8),
                                      padding: scale.sp("8px 10px"),
                                      border: `1px solid ${theme.border}`,
                                      borderRadius: scale.dim(5),
                                      background: theme.bg0,
                                    }}
                                  >
                                    <div>
                                      <div
                                        style={{
                                          fontSize: scale.fs(9),
                                          fontWeight: 400,
                                          color: theme.text,
                                        }}
                                      >
                                        {step.label}
                                      </div>
                                      <div
                                        style={{
                                          fontSize: scale.fs(8),
                                          color: theme.textDim,
                                          fontFamily: theme.mono,
                                        }}
                                      >
                                        {formatBacktestDateTime(step.occurredAt)}
                                      </div>
                                    </div>
                                    <div style={{ textAlign: "right" }}>
                                      <div
                                        style={{
                                          fontSize: scale.fs(9),
                                          color: theme.text,
                                          fontFamily: theme.mono,
                                        }}
                                      >
                                        {formatNumber(step.price)}
                                      </div>
                                      <div
                                        style={{
                                          fontSize: scale.fs(8),
                                          color:
                                            step.emphasis === "positive"
                                              ? theme.green
                                              : step.emphasis === "negative"
                                                ? theme.red
                                                : theme.textDim,
                                          fontFamily: theme.mono,
                                        }}
                                      >
                                        {formatSignedCurrency(
                                          step.deltaFromEntry,
                                        )}{" "}
                                        ·{" "}
                                        {formatPercent(
                                          step.deltaPercentFromEntry,
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                ),
                              )}
                            </div>
                          ) : activeTradeOverlay?.thresholdPath?.segments
                              ?.length ? (
                            <div
                              style={{
                                display: "flex",
                                flexWrap: "wrap",
                                gap: scale.sp(6),
                              }}
                            >
                              {activeTradeOverlay.thresholdPath.segments.map(
                                (segment: TradeThresholdSegment) => (
                                  <span
                                    key={segment.id}
                                    style={{
                                      padding: scale.sp("4px 8px"),
                                      borderRadius: scale.dim(999),
                                      border: `1px solid ${theme.border}`,
                                      background: theme.bg0,
                                      fontSize: scale.fs(9),
                                      color: segment.hit
                                        ? theme.green
                                        : theme.textSec,
                                      fontFamily: theme.mono,
                                    }}
                                  >
                                    {segment.label ?? segment.kind}
                                  </span>
                                ),
                              )}
                            </div>
                          ) : (
                            <div
                              style={{
                                fontSize: scale.fs(9),
                                color: theme.textDim,
                                lineHeight: 1.5,
                              }}
                            >
                              The current trade does not have a resolved
                              entry-to-exit trace yet.
                            </div>
                          )}
                        </div>
                        <div
                          style={{
                            border: `1px solid ${theme.border}`,
                            borderRadius: scale.dim(5),
                            padding: scale.sp("10px 12px"),
                            background: theme.bg2,
                          }}
                        >
                          <div
                            style={{
                              fontSize: scale.fs(9),
                              color: theme.textMuted,
                              textTransform: "uppercase",
                              letterSpacing: "0.06em",
                              marginBottom: scale.sp(6),
                            }}
                          >
                            Exit Consequences
                          </div>
                          {selectedTradeExitConsequences ? (
                            <div style={{ display: "grid", gap: scale.sp(6) }}>
                              <div
                                style={{
                                  fontSize: scale.fs(9),
                                  color: theme.textDim,
                                }}
                              >
                                {selectedTradeExitConsequences.barsObserved} of{" "}
                                {selectedTradeExitConsequences.windowBars} bars
                                observed after exit.
                              </div>
                              <div
                                style={{
                                  padding: scale.sp("8px 10px"),
                                  border: `1px solid ${theme.border}`,
                                  borderRadius: scale.dim(5),
                                  background: theme.bg0,
                                }}
                              >
                                <div
                                  style={{
                                    fontSize: scale.fs(9),
                                    fontWeight: 400,
                                    color: theme.text,
                                  }}
                                >
                                  Best continuation
                                </div>
                                <div
                                  style={{
                                    fontSize: scale.fs(8),
                                    color: theme.green,
                                    fontFamily: theme.mono,
                                  }}
                                >
                                  {formatSignedCurrency(
                                    selectedTradeExitConsequences.bestDelta,
                                  )}{" "}
                                  ·{" "}
                                  {formatPercent(
                                    selectedTradeExitConsequences.bestPercent,
                                  )}
                                </div>
                                <div
                                  style={{
                                    fontSize: scale.fs(8),
                                    color: theme.textDim,
                                    fontFamily: theme.mono,
                                  }}
                                >
                                  {formatNumber(
                                    selectedTradeExitConsequences.bestPrice,
                                  )}{" "}
                                  @{" "}
                                  {formatBacktestDateTime(
                                    selectedTradeExitConsequences.bestOccurredAt,
                                  )}
                                </div>
                              </div>
                              <div
                                style={{
                                  padding: scale.sp("8px 10px"),
                                  border: `1px solid ${theme.border}`,
                                  borderRadius: scale.dim(5),
                                  background: theme.bg0,
                                }}
                              >
                                <div
                                  style={{
                                    fontSize: scale.fs(9),
                                    fontWeight: 400,
                                    color: theme.text,
                                  }}
                                >
                                  Worst follow-through
                                </div>
                                <div
                                  style={{
                                    fontSize: scale.fs(8),
                                    color:
                                      selectedTradeExitConsequences.worstDelta <
                                      0
                                        ? theme.red
                                        : theme.textDim,
                                    fontFamily: theme.mono,
                                  }}
                                >
                                  {formatSignedCurrency(
                                    selectedTradeExitConsequences.worstDelta,
                                  )}{" "}
                                  ·{" "}
                                  {formatPercent(
                                    selectedTradeExitConsequences.worstPercent,
                                  )}
                                </div>
                                <div
                                  style={{
                                    fontSize: scale.fs(8),
                                    color: theme.textDim,
                                    fontFamily: theme.mono,
                                  }}
                                >
                                  {formatNumber(
                                    selectedTradeExitConsequences.worstPrice,
                                  )}{" "}
                                  @{" "}
                                  {formatBacktestDateTime(
                                    selectedTradeExitConsequences.worstOccurredAt,
                                  )}
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div
                              style={{
                                fontSize: scale.fs(9),
                                color: theme.textDim,
                                lineHeight: 1.5,
                              }}
                            >
                              No post-exit continuation window is available for
                              this trade yet.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Trade Analysis" theme={theme} scale={scale}>
        {!runDetail ? (
          <div style={{ color: theme.textDim, fontSize: scale.fs(10) }}>
            Trade Analysis stays available once the run starts returning closed
            trades.
          </div>
        ) : (
          <div style={{ display: "grid", gap: scale.sp(10) }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                gap: scale.sp(8),
              }}
            >
              <MetricCard
                label="Net PnL"
                value={formatCurrency(filteredTradeNetPnl)}
                accent={filteredTradeNetPnl >= 0 ? theme.green : theme.red}
                theme={theme}
                scale={scale}
              />
              <MetricCard
                label="ROI"
                value={formatPercent(
                  metricFromMetrics(
                    runDetail.run.metrics,
                    "totalReturnPercent",
                  ),
                )}
                accent={theme.text}
                theme={theme}
                scale={scale}
              />
              <MetricCard
                label="Expectancy"
                value={formatCurrency(filteredTradeExpectancy)}
                accent={theme.text}
                theme={theme}
                scale={scale}
              />
              <MetricCard
                label="Average Hold"
                value={formatNumber(filteredTradeAverageBarsHeld)}
                accent={theme.text}
                theme={theme}
                scale={scale}
              />
              <MetricCard
                label="Best Trade"
                value={formatCurrency(bestTrade?.netPnl ?? null)}
                accent={theme.green}
                theme={theme}
                scale={scale}
              />
              <MetricCard
                label="Worst Trade"
                value={formatCurrency(worstTrade?.netPnl ?? null)}
                accent={theme.red}
                theme={theme}
                scale={scale}
              />
              <MetricCard
                label="Profit Factor"
                value={formatNumber(
                  metricFromMetrics(runDetail.run.metrics, "profitFactor"),
                )}
                accent={theme.accent}
                theme={theme}
                scale={scale}
              />
              <MetricCard
                label="Max Drawdown"
                value={formatPercent(
                  metricFromMetrics(
                    runDetail.run.metrics,
                    "maxDrawdownPercent",
                  ),
                )}
                accent={theme.red}
                theme={theme}
                scale={scale}
              />
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
                gap: scale.sp(10),
              }}
            >
              <div
                style={{ ...cardStyle(theme, scale), background: theme.bg0 }}
              >
                <div
                  style={{
                    fontSize: scale.fs(10),
                    fontWeight: 400,
                    color: theme.textSec,
                    marginBottom: scale.sp(8),
                  }}
                >
                  Trade Waterfall
                </div>
                <div style={{ height: scale.dim(220) }}>
                  {tradeWaterfall.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={tradeWaterfall}
                        margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                      >
                        <CartesianGrid
                          stroke={theme.borderLight || theme.border}
                          strokeDasharray="0"
                          vertical={false}
                        />
                        <XAxis
                          axisLine={false}
                          tickLine={false}
                          dataKey="label"
                          tick={{
                            fill: theme.textMuted,
                            fontSize: scale.fs(8),
                          }}
                        />
                        <YAxis
                          axisLine={false}
                          tickLine={false}
                          tick={{
                            fill: theme.textMuted,
                            fontSize: scale.fs(8),
                          }}
                          tickFormatter={(value: number) =>
                            `$${compactFormatter.format(value)}`
                          }
                        />
                        <Tooltip
                          contentStyle={chartTooltipContentStyle}
                        />
                        <Bar
                          dataKey="netPnl"
                          fill={theme.accent}
                          radius={[4, 4, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div
                      style={{ color: theme.textDim, fontSize: scale.fs(10) }}
                    >
                      Closed trades are required before the waterfall view can
                      populate.
                    </div>
                  )}
                </div>
              </div>

              <div
                style={{ ...cardStyle(theme, scale), background: theme.bg0 }}
              >
                <div
                  style={{
                    fontSize: scale.fs(10),
                    fontWeight: 400,
                    color: theme.textSec,
                    marginBottom: scale.sp(8),
                  }}
                >
                  P&amp;L Distribution
                </div>
                <div style={{ height: scale.dim(220) }}>
                  {pnlDistribution.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={pnlDistribution}
                        margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                      >
                        <CartesianGrid
                          stroke={theme.borderLight || theme.border}
                          strokeDasharray="0"
                          vertical={false}
                        />
                        <XAxis
                          axisLine={false}
                          tickLine={false}
                          dataKey="bucket"
                          tick={{
                            fill: theme.textMuted,
                            fontSize: scale.fs(8),
                          }}
                        />
                        <YAxis
                          axisLine={false}
                          tickLine={false}
                          tick={{
                            fill: theme.textMuted,
                            fontSize: scale.fs(8),
                          }}
                          tickFormatter={(value: number) =>
                            `$${compactFormatter.format(value)}`
                          }
                        />
                        <Tooltip
                          contentStyle={chartTooltipContentStyle}
                        />
                        <Bar
                          dataKey="netPnl"
                          fill={theme.green}
                          radius={[4, 4, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div
                      style={{ color: theme.textDim, fontSize: scale.fs(10) }}
                    >
                      Distribution charts populate after trades close.
                    </div>
                  )}
                </div>
              </div>

              <div
                style={{ ...cardStyle(theme, scale), background: theme.bg0 }}
              >
                <div
                  style={{
                    fontSize: scale.fs(10),
                    fontWeight: 400,
                    color: theme.textSec,
                    marginBottom: scale.sp(8),
                  }}
                >
                  Exit Reasons
                </div>
                <div style={{ height: scale.dim(220) }}>
                  {exitReasonBreakdown.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={exitReasonBreakdown.map((row) => ({
                          reason: row.reason,
                          count: row.count,
                        }))}
                        margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                      >
                        <CartesianGrid
                          stroke={theme.borderLight || theme.border}
                          strokeDasharray="0"
                          vertical={false}
                        />
                        <XAxis
                          axisLine={false}
                          tickLine={false}
                          dataKey="reason"
                          tick={{
                            fill: theme.textMuted,
                            fontSize: scale.fs(8),
                          }}
                          interval={0}
                          angle={-18}
                          textAnchor="end"
                          height={56}
                        />
                        <YAxis
                          axisLine={false}
                          tickLine={false}
                          tick={{
                            fill: theme.textMuted,
                            fontSize: scale.fs(8),
                          }}
                        />
                        <Tooltip
                          contentStyle={chartTooltipContentStyle}
                        />
                        <Bar
                          dataKey="count"
                          fill={theme.amber}
                          radius={[4, 4, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div
                      style={{ color: theme.textDim, fontSize: scale.fs(10) }}
                    >
                      Exit labels appear as trades close.
                    </div>
                  )}
                </div>
              </div>

              <div
                style={{ ...cardStyle(theme, scale), background: theme.bg0 }}
              >
                <div
                  style={{
                    fontSize: scale.fs(10),
                    fontWeight: 400,
                    color: theme.textSec,
                    marginBottom: scale.sp(8),
                  }}
                >
                  Hold Profile
                </div>
                <div style={{ height: scale.dim(220) }}>
                  {holdProfile.some((bucket) => bucket.count > 0) ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={holdProfile}
                        margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                      >
                        <CartesianGrid
                          stroke={theme.borderLight || theme.border}
                          strokeDasharray="0"
                          vertical={false}
                        />
                        <XAxis
                          axisLine={false}
                          tickLine={false}
                          dataKey="label"
                          tick={{
                            fill: theme.textMuted,
                            fontSize: scale.fs(8),
                          }}
                        />
                        <YAxis
                          axisLine={false}
                          tickLine={false}
                          tick={{
                            fill: theme.textMuted,
                            fontSize: scale.fs(8),
                          }}
                        />
                        <Tooltip
                          contentStyle={chartTooltipContentStyle}
                        />
                        <Bar
                          dataKey="count"
                          fill={theme.cyan}
                          radius={[4, 4, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div
                      style={{ color: theme.textDim, fontSize: scale.fs(10) }}
                    >
                      Hold buckets fill in as trades close.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Trades"
        theme={theme}
        scale={scale}
        right={
          <div
            style={{
              fontSize: scale.fs(9),
              color: theme.textDim,
              fontFamily: theme.mono,
            }}
          >
            page {tradePage} / {pageCount}
          </div>
        }
      >
        {!runDetail ? (
          <div style={{ color: theme.textDim, fontSize: scale.fs(10) }}>
            The trade ledger appears when the selected result contains executed
            trades.
          </div>
        ) : (
          <div style={{ display: "grid", gap: scale.sp(10) }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "minmax(200px, 1.2fr) repeat(4, minmax(140px, 0.8fr)) minmax(140px, 0.8fr) minmax(140px, 0.8fr) auto",
                gap: scale.sp(8),
                alignItems: "end",
              }}
            >
              <div>
                <div style={fieldLabelStyle(theme, scale)}>Search</div>
                <input
                  value={tradeSearchText}
                  onChange={(event) => setTradeSearchText(event.target.value)}
                  placeholder="Trade id, symbol, reason"
                  style={inputStyle(theme, scale)}
                />
              </div>
              <div>
                <div style={fieldLabelStyle(theme, scale)}>Symbol</div>
                <select
                  value={tradeSymbolFilter}
                  onChange={(event) => setTradeSymbolFilter(event.target.value)}
                  style={inputStyle(theme, scale)}
                >
                  <option value="all">All symbols</option>
                  {tradeSymbolOptions.map((symbol) => (
                    <option key={symbol} value={symbol}>
                      {symbol}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div style={fieldLabelStyle(theme, scale)}>Direction</div>
                <select
                  value={tradeSideFilter}
                  onChange={(event) =>
                    setTradeSideFilter(
                      event.target.value as "all" | "long" | "short",
                    )
                  }
                  style={inputStyle(theme, scale)}
                >
                  <option value="all">All</option>
                  <option value="long">Long</option>
                  <option value="short">Short</option>
                </select>
              </div>
              <div>
                <div style={fieldLabelStyle(theme, scale)}>Outcome</div>
                <select
                  value={tradeOutcomeFilter}
                  onChange={(event) =>
                    setTradeOutcomeFilter(
                      event.target.value as TradeOutcomeFilter,
                    )
                  }
                  style={inputStyle(theme, scale)}
                >
                  <option value="all">All</option>
                  <option value="winner">Winner</option>
                  <option value="loser">Loser</option>
                  <option value="breakeven">Breakeven</option>
                </select>
              </div>
              <div>
                <div style={fieldLabelStyle(theme, scale)}>Exit Reason</div>
                <select
                  value={tradeExitReasonFilter}
                  onChange={(event) =>
                    setTradeExitReasonFilter(event.target.value)
                  }
                  style={inputStyle(theme, scale)}
                >
                  <option value="all">All reasons</option>
                  {tradeExitReasonOptions.map((reason) => (
                    <option key={reason} value={reason}>
                      {reason}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div style={fieldLabelStyle(theme, scale)}>From</div>
                <input
                  type="date"
                  value={tradeDateFrom}
                  onChange={(event) => setTradeDateFrom(event.target.value)}
                  style={inputStyle(theme, scale)}
                />
              </div>
              <div>
                <div style={fieldLabelStyle(theme, scale)}>To</div>
                <input
                  type="date"
                  value={tradeDateTo}
                  onChange={(event) => setTradeDateTo(event.target.value)}
                  style={inputStyle(theme, scale)}
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  setTradeSearchText("");
                  setTradeSymbolFilter("all");
                  setTradeSideFilter("all");
                  setTradeOutcomeFilter("all");
                  setTradeExitReasonFilter("all");
                  setTradeDateFrom("");
                  setTradeDateTo("");
                }}
                style={buttonStyle(theme, scale, "ghost")}
              >
                Reset
              </button>
            </div>

            <div
              style={{
                border: `1px solid ${theme.border}`,
                borderRadius: scale.dim(5),
                overflow: "hidden",
                background: theme.bg0,
              }}
            >
              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    minWidth: scale.dim(980),
                  }}
                >
                  <thead>
                    <tr
                      style={{
                        background: theme.bg2,
                        color: theme.textMuted,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        fontSize: scale.fs(8),
                      }}
                    >
                      {[
                        "Index",
                        "Trade ID",
                        "Instrument",
                        "Entry",
                        "Direction",
                        "Entry Price",
                        "Qty",
                        "Exit Price",
                        "Fees",
                        "Bars Held",
                        "Exit Reason",
                        "Net P&L",
                      ].map((label) => (
                        <th
                          key={label}
                          style={{
                            textAlign: "left",
                            padding: scale.sp("10px 12px"),
                            borderBottom: `1px solid ${theme.border}`,
                          }}
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedTradeRows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={12}
                          style={{
                            padding: scale.sp("14px 12px"),
                            color: theme.textDim,
                            fontSize: scale.fs(10),
                          }}
                        >
                          No executed trades match the current filters.
                        </td>
                      </tr>
                    ) : (
                      paginatedTradeRows.map((trade, index) => {
                        const isSelected =
                          trade.tradeSelectionId === activeTradeSelectionId;

                        return (
                          <Fragment key={trade.tradeSelectionId}>
                            <tr
                              onClick={() =>
                                handleTradeSelection(
                                  trade.tradeSelectionId,
                                  trade.symbol,
                                )
                              }
                              style={{
                                cursor: "pointer",
                                background: isSelected
                                  ? theme.accentDim
                                  : "transparent",
                              }}
                            >
                              <td
                                style={{
                                  padding: scale.sp("10px 12px"),
                                  borderBottom: `1px solid ${theme.border}`,
                                  fontSize: scale.fs(9),
                                  color: theme.textSec,
                                  fontFamily: theme.mono,
                                }}
                              >
                                {(tradePage - 1) * TRADES_PER_PAGE + index + 1}
                              </td>
                              <td
                                style={{
                                  padding: scale.sp("10px 12px"),
                                  borderBottom: `1px solid ${theme.border}`,
                                  fontSize: scale.fs(9),
                                  color: theme.textSec,
                                  fontFamily: theme.mono,
                                }}
                              >
                                {trade.tradeSelectionId}
                              </td>
                              <td
                                style={{
                                  padding: scale.sp("10px 12px"),
                                  borderBottom: `1px solid ${theme.border}`,
                                  fontSize: scale.fs(9),
                                  color: theme.textSec,
                                  minWidth: scale.dim(150),
                                }}
                              >
                                <div
                                  style={{
                                    color: theme.text,
                                    fontWeight: 400,
                                  }}
                                >
                                  {trade.underlying ?? trade.symbol}
                                </div>
                                {trade.instrumentType === "option" ? (
                                  <div
                                    style={{
                                      marginTop: scale.sp(3),
                                      fontFamily: theme.mono,
                                      color: theme.textDim,
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    {formatBacktestInstrumentLabel(trade)}
                                  </div>
                                ) : null}
                              </td>
                              <td
                                style={{
                                  padding: scale.sp("10px 12px"),
                                  borderBottom: `1px solid ${theme.border}`,
                                  fontSize: scale.fs(9),
                                  color: theme.textSec,
                                  fontFamily: theme.mono,
                                }}
                              >
                                {formatBacktestDateTime(trade.entryAt)}
                              </td>
                              <td
                                style={{
                                  padding: scale.sp("10px 12px"),
                                  borderBottom: `1px solid ${theme.border}`,
                                  fontSize: scale.fs(9),
                                  color: theme.text,
                                  fontWeight: 400,
                                }}
                              >
                                {trade.side}
                              </td>
                              <td
                                style={{
                                  padding: scale.sp("10px 12px"),
                                  borderBottom: `1px solid ${theme.border}`,
                                  fontSize: scale.fs(9),
                                  color: theme.textSec,
                                }}
                              >
                                {formatNumber(trade.entryPrice)}
                              </td>
                              <td
                                style={{
                                  padding: scale.sp("10px 12px"),
                                  borderBottom: `1px solid ${theme.border}`,
                                  fontSize: scale.fs(9),
                                  color: theme.textSec,
                                }}
                              >
                                {numberFormatter.format(trade.quantity)}
                              </td>
                              <td
                                style={{
                                  padding: scale.sp("10px 12px"),
                                  borderBottom: `1px solid ${theme.border}`,
                                  fontSize: scale.fs(9),
                                  color: theme.textSec,
                                }}
                              >
                                {formatNumber(trade.exitPrice)}
                              </td>
                              <td
                                style={{
                                  padding: scale.sp("10px 12px"),
                                  borderBottom: `1px solid ${theme.border}`,
                                  fontSize: scale.fs(9),
                                  color: theme.textSec,
                                }}
                              >
                                {formatCurrency(trade.commissionPaid)}
                              </td>
                              <td
                                style={{
                                  padding: scale.sp("10px 12px"),
                                  borderBottom: `1px solid ${theme.border}`,
                                  fontSize: scale.fs(9),
                                  color: theme.textSec,
                                }}
                              >
                                {trade.barsHeld}
                              </td>
                              <td
                                style={{
                                  padding: scale.sp("10px 12px"),
                                  borderBottom: `1px solid ${theme.border}`,
                                  fontSize: scale.fs(9),
                                  color: theme.textSec,
                                }}
                              >
                                {trade.exitReason}
                              </td>
                              <td
                                style={{
                                  padding: scale.sp("10px 12px"),
                                  borderBottom: `1px solid ${theme.border}`,
                                  fontSize: scale.fs(10),
                                  fontWeight: 400,
                                  color:
                                    trade.netPnl >= 0 ? theme.green : theme.red,
                                  fontFamily: theme.mono,
                                }}
                              >
                                {formatCurrency(trade.netPnl)}
                              </td>
                            </tr>
                            {isSelected ? (
                              <tr>
                                <td
                                  colSpan={12}
                                  style={{
                                    padding: scale.sp("10px 12px"),
                                    borderBottom: `1px solid ${theme.border}`,
                                    background: theme.bg2,
                                  }}
                                >
                                  <div
                                    style={{
                                      display: "grid",
                                      gridTemplateColumns:
                                        "repeat(auto-fit, minmax(180px, 1fr))",
                                      gap: scale.sp(8),
                                      fontSize: scale.fs(9),
                                      color: theme.textSec,
                                    }}
                                  >
                                    <div>Symbol {trade.symbol}</div>
                                    {trade.instrumentType === "option" ? (
                                      <div>
                                        Contract{" "}
                                        {formatBacktestInstrumentLabel(trade)}
                                      </div>
                                    ) : null}
                                    <div>
                                      Pricing {formatBacktestPricingLabel(trade)}
                                    </div>
                                    <div>
                                      Gross P&L {formatCurrency(trade.grossPnl)}
                                    </div>
                                    <div>
                                      Net P&L %{" "}
                                      {formatPercent(trade.netPnlPercent)}
                                    </div>
                                    <div>Exit detail {trade.exitReason}</div>
                                    <div>
                                      Hold minutes{" "}
                                      {formatNumber(
                                        trade.diagnostics?.holdMinutes,
                                        0,
                                      )}
                                    </div>
                                    <div>
                                      MFE{" "}
                                      {formatSignedCurrency(
                                        trade.diagnostics?.maxFavorableDelta,
                                      )}{" "}
                                      /{" "}
                                      {formatPercent(
                                        trade.diagnostics?.maxFavorablePercent,
                                      )}
                                    </div>
                                    <div>
                                      MAE{" "}
                                      {formatSignedCurrency(
                                        trade.diagnostics?.maxAdverseDelta,
                                      )}{" "}
                                      /{" "}
                                      {formatPercent(
                                        trade.diagnostics?.maxAdversePercent,
                                      )}
                                    </div>
                                    <div>
                                      Post-exit best{" "}
                                      {formatSignedCurrency(
                                        trade.diagnostics?.exitConsequences
                                          ?.bestDelta,
                                      )}
                                    </div>
                                    <div>
                                      Risk path{" "}
                                      {trade.exitReason === "trailing_stop"
                                        ? "Trailing stop hit"
                                        : trade.exitReason === "stop_loss"
                                          ? "Stop loss hit"
                                          : trade.exitReason === "take_profit"
                                            ? "Take profit hit"
                                            : "Strategy exit"}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: scale.sp(8),
                alignItems: "center",
              }}
            >
              <div
                style={{
                  fontSize: scale.fs(9),
                  color: theme.textDim,
                  fontFamily: theme.mono,
                }}
              >
                {filteredTradeRows.length} total filtered trades
              </div>
              <div style={{ display: "flex", gap: scale.sp(6) }}>
                <button
                  type="button"
                  onClick={() =>
                    setTradePage((current) => Math.max(1, current - 1))
                  }
                  disabled={tradePage <= 1}
                  style={{
                    ...buttonStyle(theme, scale, "ghost"),
                    opacity: tradePage <= 1 ? 0.5 : 1,
                  }}
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setTradePage((current) => Math.min(pageCount, current + 1))
                  }
                  disabled={tradePage >= pageCount}
                  style={{
                    ...buttonStyle(theme, scale, "ghost"),
                    opacity: tradePage >= pageCount ? 0.5 : 1,
                  }}
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Logs" theme={theme} scale={scale}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) minmax(320px, 0.95fr)",
            gap: scale.sp(10),
            alignItems: "start",
          }}
        >
          <div style={{ display: "grid", gap: scale.sp(10) }}>
            <div style={{ ...cardStyle(theme, scale), background: theme.bg0 }}>
              <div
                style={{
                  fontSize: scale.fs(10),
                  fontWeight: 400,
                  color: theme.textSec,
                  marginBottom: scale.sp(8),
                }}
              >
                Execution Phases
              </div>
              <div style={{ display: "grid", gap: scale.sp(6) }}>
                {executionPhases.map((phase) => {
                  const color = phase.active
                    ? theme.accent
                    : phase.complete
                      ? theme.green
                      : theme.textDim;
                  return (
                    <div
                      key={phase.label}
                      className={phase.active ? "ra-focus-rail" : "ra-row-enter"}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: scale.sp(8),
                        padding: scale.sp("8px 10px"),
                        border: `1px solid ${theme.border}`,
                        borderRadius: scale.dim(5),
                        background: theme.bg2,
                      }}
                    >
                      <span
                        className={phase.active ? "ra-status-pulse" : undefined}
                        style={{
                          width: scale.dim(8),
                          height: scale.dim(8),
                          borderRadius: "50%",
                          background: color,
                        }}
                      />
                      <span
                        style={{
                          fontSize: scale.fs(10),
                          color: theme.text,
                          fontWeight: 400,
                        }}
                      >
                        {phase.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ ...cardStyle(theme, scale), background: theme.bg0 }}>
              <div
                style={{
                  fontSize: scale.fs(10),
                  fontWeight: 400,
                  color: theme.textSec,
                  marginBottom: scale.sp(8),
                }}
              >
                Skipped Reasons
              </div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: scale.sp(6),
                }}
              >
                <span
                  style={{
                    padding: scale.sp("4px 8px"),
                    borderRadius: scale.dim(999),
                    border: `1px solid ${theme.border}`,
                    background: theme.bg2,
                    fontSize: scale.fs(9),
                    color: theme.textDim,
                  }}
                >
                  Skip telemetry is not included in the current run payload.
                </span>
              </div>
            </div>
          </div>

          <div style={{ ...cardStyle(theme, scale), background: theme.bg0 }}>
            <div
              style={{
                fontSize: scale.fs(10),
                fontWeight: 400,
                color: theme.textSec,
                marginBottom: scale.sp(8),
              }}
            >
              Runtime Diagnostics
            </div>
            <div style={{ display: "grid", gap: scale.sp(6) }}>
              {[
                ["Backtest status", runDetail?.run.status ?? "idle"],
                ["Backtest job ID", latestRunJob?.id ?? "—"],
                [
                  "Backtest phase",
                  latestRunJob?.status ?? runDetail?.run.status ?? "—",
                ],
                ["Dataset label", selectedStudy?.name ?? "—"],
                [
                  "Spot source",
                  runDetail
                    ? `${runDetail.datasets.length} cached datasets`
                    : "—",
                ],
                ["Loaded bars", String(runChart?.chartBars.length ?? 0)],
                ["Selected symbol", runChart?.selectedSymbol ?? "—"],
                ["Trade overlays", String(runChart?.tradeOverlays.length ?? 0)],
              ].map(([label, value]) => (
                <div
                  key={label}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 0.9fr) minmax(0, 1.1fr)",
                    gap: scale.sp(8),
                    padding: scale.sp("8px 10px"),
                    border: `1px solid ${theme.border}`,
                    borderRadius: scale.dim(5),
                  }}
                >
                  <div
                    style={{
                      fontSize: scale.fs(9),
                      color: theme.textMuted,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                    }}
                  >
                    {label}
                  </div>
                  <div
                    style={{
                      fontSize: scale.fs(9),
                      color: theme.textSec,
                      fontFamily: theme.mono,
                    }}
                  >
                    {value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="History" theme={theme} scale={scale}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) minmax(320px, 0.95fr)",
            gap: scale.sp(10),
            alignItems: "start",
          }}
        >
          <div style={{ display: "grid", gap: scale.sp(10) }}>
            <div style={{ ...cardStyle(theme, scale), background: theme.bg0 }}>
              <div
                style={{
                  fontSize: scale.fs(10),
                  fontWeight: 400,
                  color: theme.textSec,
                  marginBottom: scale.sp(8),
                }}
              >
                Recent Persisted Results
              </div>
              <div style={{ display: "grid", gap: scale.sp(6) }}>
                {completedRuns.length === 0 ? (
                  <div style={{ color: theme.textDim, fontSize: scale.fs(10) }}>
                    Completed runs will appear here as persisted results become
                    available.
                  </div>
                ) : (
                  completedRuns.slice(0, 6).map((run) => (
                    <button
                      key={run.id}
                      type="button"
                      onClick={() => setSelectedRunId(run.id)}
                      style={{
                        textAlign: "left",
                        border: `1px solid ${run.id === selectedRunId ? theme.accent : theme.border}`,
                        background:
                          run.id === selectedRunId
                            ? theme.accentDim
                            : theme.bg2,
                        borderRadius: scale.dim(5),
                        padding: scale.sp("10px 12px"),
                        cursor: "pointer",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: scale.sp(8),
                          alignItems: "center",
                        }}
                      >
                        <div>
                          <div
                            style={{
                              fontSize: scale.fs(10),
                              fontWeight: 400,
                              color: theme.text,
                            }}
                          >
                            {run.name}
                          </div>
                          <div
                            style={{
                              fontSize: scale.fs(8),
                              color: theme.textDim,
                              fontFamily: theme.mono,
                            }}
                          >
                            {formatBacktestDateTime(run.finishedAt ?? run.createdAt)}
                          </div>
                        </div>
                        <StatusBadge
                          status={run.status}
                          theme={theme}
                          scale={scale}
                        />
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div style={{ ...cardStyle(theme, scale), background: theme.bg0 }}>
              <div
                style={{
                  fontSize: scale.fs(10),
                  fontWeight: 400,
                  color: theme.textSec,
                  marginBottom: scale.sp(8),
                }}
              >
                Recent Backtests
              </div>
              <div style={{ display: "grid", gap: scale.sp(6) }}>
                {runs.length === 0 ? (
                  <div style={{ color: theme.textDim, fontSize: scale.fs(10) }}>
                    No archived runs to compare yet.
                  </div>
                ) : (
                  runs.map((run) => (
                    <button
                      key={run.id}
                      type="button"
                      onClick={() => setSelectedRunId(run.id)}
                      style={{
                        textAlign: "left",
                        border: `1px solid ${run.id === selectedRunId ? theme.accent : theme.border}`,
                        background:
                          run.id === selectedRunId
                            ? theme.accentDim
                            : theme.bg2,
                        borderRadius: scale.dim(5),
                        padding: scale.sp("10px 12px"),
                        cursor: "pointer",
                      }}
                    >
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns:
                            "minmax(0, 1.3fr) repeat(4, minmax(0, 1fr))",
                          gap: scale.sp(8),
                          alignItems: "center",
                        }}
                      >
                        <div>
                          <div
                            style={{
                              fontSize: scale.fs(10),
                              fontWeight: 400,
                              color: theme.text,
                            }}
                          >
                            {run.name}
                          </div>
                          <div
                            style={{
                              fontSize: scale.fs(8),
                              color: theme.textDim,
                              fontFamily: theme.mono,
                            }}
                          >
                            {formatBacktestDateTime(run.startedAt ?? run.createdAt)}
                          </div>
                        </div>
                        <div
                          style={{
                            fontSize: scale.fs(9),
                            color: theme.textSec,
                          }}
                        >
                          Trades {run.metrics?.tradeCount ?? "—"}
                        </div>
                        <div
                          style={{
                            fontSize: scale.fs(9),
                            color: theme.textSec,
                          }}
                        >
                          ROI{" "}
                          {formatPercent(
                            run.metrics?.totalReturnPercent ?? null,
                          )}
                        </div>
                        <div
                          style={{
                            fontSize: scale.fs(9),
                            color: theme.textSec,
                          }}
                        >
                          Win{" "}
                          {formatPercent(run.metrics?.winRatePercent ?? null)}
                        </div>
                        <div
                          style={{
                            fontSize: scale.fs(9),
                            color: theme.textSec,
                          }}
                        >
                          PF {formatNumber(run.metrics?.profitFactor ?? null)}
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gap: scale.sp(10) }}>
            <div style={{ ...cardStyle(theme, scale), background: theme.bg0 }}>
              <div
                style={{
                  fontSize: scale.fs(10),
                  fontWeight: 400,
                  color: theme.textSec,
                  marginBottom: scale.sp(8),
                }}
              >
                Jobs And Reconnect
              </div>
              <div style={{ display: "grid", gap: scale.sp(6) }}>
                {jobs.length === 0 ? (
                  <div style={{ color: theme.textDim, fontSize: scale.fs(10) }}>
                    Recent backtest and optimizer jobs will appear here.
                  </div>
                ) : (
                  jobs.slice(0, 6).map((job) => (
                    <div
                      key={job.id}
                      style={{
                        border: `1px solid ${theme.border}`,
                        borderRadius: scale.dim(5),
                        padding: scale.sp("8px 10px"),
                        background: theme.bg2,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: scale.sp(8),
                          alignItems: "center",
                        }}
                      >
                        <div>
                          <div
                            style={{
                              fontSize: scale.fs(10),
                              fontWeight: 400,
                              color: theme.text,
                            }}
                          >
                            {job.kind}
                          </div>
                          <div
                            style={{
                              fontSize: scale.fs(8),
                              color: theme.textDim,
                              fontFamily: theme.mono,
                            }}
                          >
                            {formatBacktestDateTime(job.startedAt ?? job.createdAt)}
                          </div>
                        </div>
                        <StatusBadge
                          status={job.status}
                          theme={theme}
                          scale={scale}
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div style={{ ...cardStyle(theme, scale), background: theme.bg0 }}>
              <div
                style={{
                  fontSize: scale.fs(10),
                  fontWeight: 400,
                  color: theme.textSec,
                  marginBottom: scale.sp(8),
                }}
              >
                Optimizer Snapshots
              </div>
              <div style={{ color: theme.textDim, fontSize: scale.fs(10) }}>
                Optimizer history is not surfaced in this page yet. The section
                is reserved for archived batches, candidate comparisons, and
                apply/save actions once those payloads are available.
              </div>
            </div>

            <div style={{ ...cardStyle(theme, scale), background: theme.bg0 }}>
              <div
                style={{
                  fontSize: scale.fs(10),
                  fontWeight: 400,
                  color: theme.textSec,
                  marginBottom: scale.sp(8),
                }}
              >
                Promoted Drafts
              </div>
              <DraftStrategiesList
                drafts={(draftsQuery.data?.drafts ?? []).slice(0, 3)}
                theme={theme}
                scale={scale}
                formatDateTimeLabel={formatBacktestDateTime}
                compact
              />
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Pine Library"
        theme={theme}
        scale={scale}
        right={
          <div
            style={{
              fontSize: scale.fs(9),
              color: theme.textDim,
              fontFamily: theme.mono,
            }}
          >
            {pineScripts.length} stored · {chartReadyPineScripts.length} ready
          </div>
        }
      >
        <div style={{ display: "grid", gap: scale.sp(10) }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: scale.sp(8),
            }}
          >
            <MetricCard
              label="Stored"
              value={String(pineScripts.length)}
              accent={theme.text}
              theme={theme}
              scale={scale}
            />
            <MetricCard
              label="Chart Ready"
              value={String(chartReadyPineScripts.length)}
              accent={theme.green}
              theme={theme}
              scale={scale}
            />
            <MetricCard
              label="Adapter Pending"
              value={String(pendingPineRuntimeCount)}
              accent={theme.amber}
              theme={theme}
              scale={scale}
            />
          </div>

          <div
            style={{
              ...cardStyle(theme, scale),
              background: theme.bg0,
              display: "grid",
              gap: scale.sp(6),
            }}
          >
            <div
              style={{
                fontSize: scale.fs(10),
                color: theme.textSec,
              }}
            >
              Pine scripts saved here are global chart assets. They can be
              reused across the backtest page and the broader research chart
              surfaces once they are marked ready, chart access is enabled, and
              a matching JavaScript runtime adapter is registered.
            </div>
            <div
              style={{
                fontSize: scale.fs(9),
                color: theme.textDim,
              }}
            >
              This is storage and chart plumbing, not an in-browser Pine
              interpreter. The Pine source remains the source of truth, while
              the chart runtime stays in JavaScript.
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 0.9fr) minmax(0, 1.1fr)",
              gap: scale.sp(10),
              alignItems: "start",
            }}
          >
            <div style={{ display: "grid", gap: scale.sp(8) }}>
              <div
                style={{
                  fontSize: scale.fs(10),
                  fontWeight: 400,
                  color: theme.textSec,
                }}
              >
                Saved Scripts
              </div>
              {pineScriptsQuery.isFetching && pineScripts.length === 0 ? (
                <div
                  style={{
                    ...cardStyle(theme, scale),
                    background: theme.bg0,
                    color: theme.textDim,
                    fontSize: scale.fs(10),
                  }}
                >
                  Loading Pine scripts from the shared chart library.
                </div>
              ) : pineScriptRows.length === 0 ? (
                <div
                  style={{
                    ...cardStyle(theme, scale),
                    background: theme.bg0,
                    color: theme.textDim,
                    fontSize: scale.fs(10),
                  }}
                >
                  No Pine scripts saved yet. Create the first one here and
                  paste the source. Internal script keys are generated
                  automatically when you leave the override blank.
                </div>
              ) : (
                pineScriptRows.map(({ script, chartState }) => (
                  <div
                    key={script.id}
                    style={{
                      ...cardStyle(theme, scale),
                      background: theme.bg0,
                      borderColor:
                        editingPineScriptId === script.id
                          ? theme.accent
                          : theme.border,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        gap: scale.sp(8),
                        marginBottom: scale.sp(6),
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontSize: scale.fs(11),
                            fontWeight: 400,
                            color: theme.text,
                          }}
                        >
                          {script.name}
                        </div>
                        <div
                          style={{
                            fontSize: scale.fs(9),
                            color: theme.textDim,
                            fontFamily: theme.mono,
                          }}
                        >
                          {script.scriptKey} · {script.defaultPaneType} pane ·
                          updated {formatBacktestDateTime(script.updatedAt)}
                        </div>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: scale.sp(6),
                          flexWrap: "wrap",
                          justifyContent: "flex-end",
                        }}
                      >
                        <StatusBadge
                          status={script.status}
                          theme={theme}
                          scale={scale}
                        />
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            padding: scale.sp("2px 8px"),
                            borderRadius: scale.dim(999),
                            border: `1px solid ${
                              chartState.chartReady
                                ? `${theme.green}33`
                                : `${theme.amber}33`
                            }`,
                            background: chartState.chartReady
                              ? `${theme.green}14`
                              : `${theme.amber}14`,
                            color: chartState.chartReady
                              ? theme.green
                              : theme.amber,
                            fontSize: scale.fs(8),
                            fontWeight: 400,
                            fontFamily: theme.mono,
                            textTransform: "uppercase",
                          }}
                        >
                          {chartState.chartReady ? "chart ready" : "pending"}
                        </span>
                      </div>
                    </div>

                    {script.description ? (
                      <div
                        style={{
                          fontSize: scale.fs(10),
                          color: theme.textSec,
                          marginBottom: scale.sp(6),
                        }}
                      >
                        {script.description}
                      </div>
                    ) : null}

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                        gap: scale.sp(6),
                        marginBottom: scale.sp(6),
                      }}
                    >
                      {[
                        [
                          "Chart access",
                          script.chartAccessEnabled ? "enabled" : "disabled",
                        ],
                        [
                          "Runtime",
                          chartState.runtimeAvailable
                            ? "adapter registered"
                            : "awaiting adapter",
                        ],
                        [
                          "Tags",
                          script.tags.length > 0 ? script.tags.join(", ") : "—",
                        ],
                        ["Notes", script.notes?.trim() ? script.notes : "—"],
                      ].map(([label, value]) => (
                        <div
                          key={`${script.id}-${label}`}
                          style={{
                            border: `1px solid ${theme.border}`,
                            borderRadius: scale.dim(5),
                            padding: scale.sp("8px 10px"),
                            background: theme.bg1,
                          }}
                        >
                          <div style={fieldLabelStyle(theme, scale)}>
                            {label}
                          </div>
                          <div
                            style={{
                              fontSize: scale.fs(9),
                              color: theme.textSec,
                            }}
                          >
                            {value}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div
                      style={{
                        fontSize: scale.fs(9),
                        color: theme.textDim,
                        marginBottom: scale.sp(8),
                      }}
                    >
                      {chartState.reason}
                    </div>

                    {script.lastError ? (
                      <div
                        style={{
                          marginBottom: scale.sp(8),
                          border: `1px solid ${theme.red}33`,
                          borderRadius: scale.dim(5),
                          background: `${theme.redBg}66`,
                          padding: scale.sp("8px 10px"),
                        }}
                      >
                        <div style={fieldLabelStyle(theme, scale)}>
                          Last Runtime Error
                        </div>
                        <div
                          style={{
                            fontSize: scale.fs(9),
                            color: theme.textSec,
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          {script.lastError}
                        </div>
                      </div>
                    ) : null}

                    <div
                      style={{
                        display: "flex",
                        justifyContent: "flex-end",
                        gap: scale.sp(6),
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => populatePineEditor(script)}
                        style={buttonStyle(
                          theme,
                          scale,
                          editingPineScriptId === script.id
                            ? "primary"
                            : "secondary",
                        )}
                      >
                        {editingPineScriptId === script.id ? "Editing" : "Edit"}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div style={{ display: "grid", gap: scale.sp(8) }}>
              <div
                style={{
                  ...cardStyle(theme, scale),
                  background: theme.bg0,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: scale.sp(8),
                    marginBottom: scale.sp(8),
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: scale.fs(11),
                        fontWeight: 400,
                        color: theme.text,
                      }}
                    >
                      {editingPineScript
                        ? "Edit Pine Script"
                        : "Create Pine Script"}
                    </div>
                    <div
                      style={{
                        fontSize: scale.fs(9),
                        color: theme.textDim,
                        fontFamily: theme.mono,
                      }}
                    >
                      {editingPineScript
                        ? `${editingPineScript.scriptKey} · shared across charts`
                        : `shared chart asset · auto key ${pineScriptKeyPreview}`}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => resetPineEditor()}
                    style={buttonStyle(theme, scale, "ghost")}
                  >
                    New Draft
                  </button>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    gap: scale.sp(8),
                  }}
                >
                  <div>
                    <div style={fieldLabelStyle(theme, scale)}>Name</div>
                    <input
                      value={pineScriptName}
                      onChange={(event) =>
                        setPineScriptName(event.target.value)
                      }
                      placeholder="Portable EMA Ribbon"
                      style={inputStyle(theme, scale)}
                    />
                  </div>
                  {editingPineScript ? (
                    <div>
                      <div style={fieldLabelStyle(theme, scale)}>Script Key</div>
                      <div
                        style={{
                          ...inputStyle(theme, scale),
                          display: "flex",
                          alignItems: "center",
                          color: theme.textSec,
                          fontFamily: theme.mono,
                          opacity: 0.8,
                        }}
                      >
                        {pineScriptKey}
                      </div>
                      <div
                        style={{
                          marginTop: scale.sp(4),
                          fontSize: scale.fs(8),
                          color: theme.textDim,
                        }}
                      >
                        Stable keys are fixed after creation because runtime
                        adapters bind to this id.
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div style={fieldLabelStyle(theme, scale)}>
                        Script Key Override
                      </div>
                      <input
                        value={pineScriptKey}
                        onChange={(event) =>
                          setPineScriptKey(event.target.value)
                        }
                        placeholder={`auto: ${pineScriptKeyPreview}`}
                        style={inputStyle(theme, scale)}
                      />
                      <div
                        style={{
                          marginTop: scale.sp(4),
                          fontSize: scale.fs(8),
                          color: theme.textDim,
                        }}
                      >
                        Optional. Leave blank and the library will generate a
                        stable key from the script name.
                      </div>
                    </div>
                  )}
                  <div>
                    <div style={fieldLabelStyle(theme, scale)}>
                      Default Pane
                    </div>
                    <select
                      value={pineDefaultPaneType}
                      onChange={(event) =>
                        setPineDefaultPaneType(
                          event.target.value as PineScriptPaneType,
                        )
                      }
                      style={inputStyle(theme, scale)}
                    >
                      <option value="price">price</option>
                      <option value="lower">lower</option>
                    </select>
                  </div>
                  <div>
                    <div style={fieldLabelStyle(theme, scale)}>Status</div>
                    <select
                      value={pineScriptStatus}
                      onChange={(event) =>
                        setPineScriptStatus(
                          event.target.value as PineScriptStatus,
                        )
                      }
                      style={inputStyle(theme, scale)}
                    >
                      <option value="draft">draft</option>
                      <option value="ready">ready</option>
                      <option value="error">error</option>
                      <option value="archived">archived</option>
                    </select>
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <div style={fieldLabelStyle(theme, scale)}>Description</div>
                    <textarea
                      value={pineScriptDescription}
                      onChange={(event) =>
                        setPineScriptDescription(event.target.value)
                      }
                      rows={2}
                      placeholder="Explain what the script should show and how the chart should use it."
                      style={{
                        ...inputStyle(theme, scale),
                        resize: "vertical",
                      }}
                    />
                  </div>
                  <div>
                    <div style={fieldLabelStyle(theme, scale)}>
                      Chart Access
                    </div>
                    <select
                      value={pineChartAccessEnabled ? "enabled" : "disabled"}
                      onChange={(event) =>
                        setPineChartAccessEnabled(
                          event.target.value === "enabled",
                        )
                      }
                      style={inputStyle(theme, scale)}
                    >
                      <option value="enabled">enabled</option>
                      <option value="disabled">disabled</option>
                    </select>
                  </div>
                  <div>
                    <div style={fieldLabelStyle(theme, scale)}>Tags</div>
                    <input
                      value={pineTagsText}
                      onChange={(event) => setPineTagsText(event.target.value)}
                      placeholder="trend, ema, overlay"
                      style={inputStyle(theme, scale)}
                    />
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <div style={fieldLabelStyle(theme, scale)}>Notes</div>
                    <textarea
                      value={pineNotes}
                      onChange={(event) => setPineNotes(event.target.value)}
                      rows={3}
                      placeholder="Implementation notes, parity notes, or expected adapter details."
                      style={{
                        ...inputStyle(theme, scale),
                        resize: "vertical",
                      }}
                    />
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <div style={fieldLabelStyle(theme, scale)}>Pine Source</div>
                    <textarea
                      value={pineScriptSourceCode}
                      onChange={(event) =>
                        setPineScriptSourceCode(event.target.value)
                      }
                      rows={18}
                      spellCheck={false}
                      style={{
                        ...inputStyle(theme, scale),
                        resize: "vertical",
                        minHeight: scale.dim(320),
                        whiteSpace: "pre",
                      }}
                    />
                  </div>
                </div>

                {editingPineScript?.lastError ? (
                  <div
                    style={{
                      marginTop: scale.sp(8),
                      padding: scale.sp("8px 10px"),
                      borderRadius: scale.dim(5),
                      border: `1px solid ${theme.red}33`,
                      background: `${theme.redBg}66`,
                    }}
                  >
                    <div style={fieldLabelStyle(theme, scale)}>
                      Existing Runtime Error
                    </div>
                    <div
                      style={{
                        fontSize: scale.fs(9),
                        color: theme.textSec,
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {editingPineScript.lastError}
                    </div>
                  </div>
                ) : null}

                <div
                  style={{
                    marginTop: scale.sp(10),
                    display: "flex",
                    justifyContent: "space-between",
                    gap: scale.sp(8),
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <div
                    style={{
                      fontSize: scale.fs(9),
                      color: theme.textDim,
                      maxWidth: scale.dim(520),
                    }}
                  >
                    Saving here makes the script available to the shared chart
                    catalog. Rendering on charts still depends on a matching JS
                    adapter keyed by the stable script key.
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleSavePineScript()}
                    disabled={
                      createPineScriptMutation.isPending ||
                      updatePineScriptMutation.isPending
                    }
                    style={{
                      ...buttonStyle(theme, scale, "primary"),
                      opacity:
                        createPineScriptMutation.isPending ||
                        updatePineScriptMutation.isPending
                          ? 0.6
                          : 1,
                    }}
                  >
                    {editingPineScript
                      ? updatePineScriptMutation.isPending
                        ? "Saving Changes..."
                        : "Update Script"
                      : createPineScriptMutation.isPending
                        ? "Saving Script..."
                        : "Save Script"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </SectionCard>

    </div>
  );
}
