import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  useGetBars,
  useGetResearchStatus,
  useGetSignalMonitorProfile,
  useGetSignalMonitorState,
  useListSignalMonitorBreadthHistory,
  useListSignalMonitorEvents,
} from "@workspace/api-client-react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Clock3,
  ExternalLink,
  ListFilter,
  Power,
  RefreshCw,
  ScanLine,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { DenseVirtualTable } from "../components/platform/DenseVirtualTable.jsx";
import {
  normalizeColumnOrder,
  orderColumnsById,
  reorderColumnOrder,
} from "../components/platform/tableColumnInteractions.js";
import {
  Badge,
  Card,
  DataUnavailableState,
  MicroSparkline,
  StatusPill,
  extractSparklinePoints,
} from "../components/platform/primitives.jsx";
import { AppTooltip } from "@/components/ui/tooltip";
import { DataIssueInlineIcon } from "../components/platform/DataIssueInlineIcon.jsx";
import { collectDataIssuesFromRecord } from "../features/platform/dataIssueModel.js";
import {
  DEFAULT_PYRUS_SIGNALS_SETTINGS,
  PYRUS_SIGNALS_BOS_CONFIRMATION_OPTIONS,
  PYRUS_SIGNALS_MTF_OPTIONS,
  PYRUS_SIGNALS_SESSION_OPTIONS,
  resolvePyrusSignalsRuntimeSettings,
} from "../features/charting/pyrusSignalsPineAdapter";
import { describeUserFacingRuntimeError } from "../features/platform/userFacingRuntimeError.js";
import {
  BARS_QUERY_DEFAULTS,
  BARS_REQUEST_PRIORITY,
  buildBarsRequestOptions,
} from "../features/platform/queryDefaults";
import { markRouteDataTiming } from "../features/platform/performanceMetrics";
import {
  SPARKLINE_RENDER_POINT_LIMIT,
  TABLE_SPARKLINE_HEIGHT,
  TABLE_SPARKLINE_WIDTH,
  buildDetailedFallbackSparklineData,
} from "../features/platform/sparklineConfig";
import {
  CSS_COLOR,
  FONT_WEIGHTS,
  MISSING_VALUE,
  RADII,
  T,
  cssColorMix,
  dim,
  fs,
  sp,
  textSize,
} from "../lib/uiTokens.jsx";
import {
  formatQuotePrice,
  formatRelativeTimeShort,
} from "../lib/formatters";
import { formatAppTime } from "../lib/timeZone";
import { useDebouncedTextCommit } from "../lib/useDebouncedTextCommit";
import { useViewport } from "../lib/responsive";
import { _initialState, persistState } from "../lib/workspaceState";
import {
  SIGNALS_ROW_STATUS,
  SIGNALS_TABLE_TIMEFRAMES,
  buildSignalsRows,
  filterSignalsRows,
  normalizeSignalsTicker,
  normalizeSignalsBreadthHistory,
  resolveSignalDirectionFlipStates,
  sortSignalsRows,
  summarizeSignalsNetBias,
  summarizeSignalsRows,
  summarizeSignalsTimeframeDirections,
} from "../features/signals/signalsRowModel.js";
import {
  buildSignalsHydrationManifest,
  buildSignalsMatrixHydrationPlan,
  buildSignalsPriorityHydrationSymbols,
} from "../features/signals/signalsMatrixHydration.js";
import {
  EMPTY_SIGNAL_EVENTS,
  buildSignalEventsBySymbol,
  buildSignalSparklinePointColors,
  defaultSignalSparklineColorForDirection,
  isSignalSparklineDirection,
} from "../features/signals/signalSparklineModel.js";
import {
  getCurrentSignalDirection,
  isProblemSignalState,
  normalizeSignalStatus,
} from "../features/signals/signalStateFreshness.js";

const SIGNALS_EVENT_LIMIT = 250;
const SIGNAL_STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: SIGNALS_ROW_STATUS.activeFresh, label: "Fresh" },
  { value: SIGNALS_ROW_STATUS.activeStale, label: "Aged" },
  { value: SIGNALS_ROW_STATUS.problem, label: "Attention" },
  { value: SIGNALS_ROW_STATUS.skipped, label: "Scan pending" },
  { value: SIGNALS_ROW_STATUS.pending, label: "Pending" },
  { value: SIGNALS_ROW_STATUS.neutral, label: "Neutral" },
];
const DIRECTION_FILTERS = [
  { value: "all", label: "Both" },
  { value: "buy", label: "Buy" },
  { value: "sell", label: "Sell" },
];
const SORT_OPTIONS = [
  { value: "priority", label: "Priority" },
  { value: "rank", label: "Rank" },
  { value: "latest", label: "Latest" },
  { value: "bars", label: "Bars" },
  { value: "symbol", label: "Symbol" },
];
const SIGNALS_BREADTH_HISTORY_RANGE_OPTIONS = Object.freeze([
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
]);

const isHydratedSignalMatrixState = (state) =>
  Boolean(state && isRenderableSignalMatrixState(state));
const isRenderableSignalMatrixState = (state) => {
  const status = normalizeSignalStatus(state);
  return Boolean(
    state?.active !== false &&
      (status === "ok" || status === "stale") &&
      !state?.lastError &&
      (state?.latestBarAt || state?.currentSignalAt),
  );
};
const toHydrationCount = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
};
const SIGNAL_TIMEFRAME_OPTIONS = ["1m", "2m", "5m", "15m", "1h", "1d"];
const SIGNAL_MONITOR_MAX_SYMBOLS_LIMIT = 500;
const SIGNAL_MONITOR_UNIVERSE_SCOPE_KEY = "__signalMonitorUniverseScope";
const SIGNAL_MONITOR_UNIVERSE_SCOPE_OPTIONS = Object.freeze([
  { value: "selected_watchlist", label: "Selected Source" },
  { value: "all_watchlists", label: "Saved Sources" },
  { value: "all_watchlists_plus_universe", label: "Universe" },
  { value: "high_beta_500", label: "High Beta 500" },
]);
const SIGNAL_MONITOR_UNIVERSE_SCOPE_VALUES = new Set(
  SIGNAL_MONITOR_UNIVERSE_SCOPE_OPTIONS.map((option) => option.value),
);
const describeHighBetaUniverseAvailability = (status) => {
  if (!status) {
    return {
      label: "checking",
      tone: CSS_COLOR.textDim,
    };
  }
  const accepted =
    typeof status.lastAcceptedCount === "number"
      ? `${status.lastAcceptedCount}/${status.limit || SIGNAL_MONITOR_MAX_SYMBOLS_LIMIT}`
      : MISSING_VALUE;
  if (status.available) {
    return {
      label:
        status.cacheStatus === "stale_cache"
          ? `cached ${accepted}`
          : `ready ${accepted}`,
      tone:
        status.cacheStatus === "stale_cache"
          ? CSS_COLOR.amber
          : CSS_COLOR.green,
    };
  }
  return {
    label: status.unavailableCode || "unavailable",
    tone: CSS_COLOR.amber,
  };
};
const resolveSignalMonitorUniverseScope = (settings) => {
  const raw = settings?.[SIGNAL_MONITOR_UNIVERSE_SCOPE_KEY];
  return SIGNAL_MONITOR_UNIVERSE_SCOPE_VALUES.has(raw)
    ? raw
    : "all_watchlists_plus_universe";
};
const resolveSignalMonitorSettingsDraft = (settings) => ({
  ...resolvePyrusSignalsRuntimeSettings(settings || {}),
  [SIGNAL_MONITOR_UNIVERSE_SCOPE_KEY]:
    resolveSignalMonitorUniverseScope(settings),
});
const SIGNALS_COLUMN_IDS = [
  "symbol",
  "rank",
  "signal",
  "stack",
  "verdict",
  ...SIGNALS_TABLE_TIMEFRAMES.map((timeframe) => `tf-${timeframe}`),
  "trend",
  "strength",
  "age",
  "vol",
  "mtf",
  "bars",
  "price",
  "latest",
  "coverage",
  "action",
];
const SIGNALS_LOCKED_COLUMN_IDS = ["symbol", "action"];
const normalizeSignalsColumnOrder = (value) => {
  const normalized = normalizeColumnOrder(value, SIGNALS_COLUMN_IDS);
  const requested = Array.isArray(value) ? value : [];
  if (requested.includes("rank")) {
    return normalized;
  }
  const withoutRank = normalized.filter((columnId) => columnId !== "rank");
  const symbolIndex = withoutRank.indexOf("symbol");
  const insertIndex = symbolIndex >= 0 ? symbolIndex + 1 : 0;
  return [
    ...withoutRank.slice(0, insertIndex),
    "rank",
    ...withoutRank.slice(insertIndex),
  ];
};
const SIGNALS_SORT_KEYS_BY_COLUMN_ID = {
  age: "age",
  bars: "bars",
  coverage: "coverage",
  latest: "latest",
  mtf: "mtf",
  price: "price",
  rank: "rank",
  signal: "signal",
  stack: "stack",
  strength: "strength",
  symbol: "symbol",
  ...Object.fromEntries(
    SIGNALS_TABLE_TIMEFRAMES.map((timeframe) => [
      `tf-${timeframe}`,
      `tf-${timeframe}`,
    ]),
  ),
  trend: "trend",
  verdict: "verdict",
  vol: "vol",
};
const SIGNAL_DRILLDOWN_CHART_LIMIT = 160;
const SIGNAL_DRILLDOWN_CHART_TIMEFRAMES = new Set([
  "1m",
  "2m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d",
]);
const EMPTY_SIGNAL_SPARKLINE_BARS = Object.freeze({});
const EMPTY_SIGNAL_SPARKLINE_POINTS = Object.freeze({});
const SIGNALS_TABLE_SPARKLINE_HISTORY_TIMEFRAME = "1m";
const SIGNALS_TABLE_SPARKLINE_HISTORY_LIMIT = 240;
const SIGNALS_TABLE_SPARKLINE_BATCH_SIZE = 8;
const SIGNALS_TABLE_SPARKLINE_BATCH_CONCURRENCY = 1;
const SIGNALS_TABLE_SPARKLINE_FETCH_ROW_LIMIT = 64;
const SIGNALS_MATRIX_INITIAL_HYDRATION_SYMBOL_LIMIT = 32;
const SIGNALS_MATRIX_FULL_HYDRATION_IDLE_TIMEOUT_MS = 1_500;
const SIGNALS_TABLE_FALLBACK_SPARKLINE_POINTS = 18;
const SIGNALS_TABLE_MIN_HEIGHT_DESKTOP = 680;
const SIGNALS_TABLE_MIN_HEIGHT_COMPACT = 620;
const SIGNALS_TABLE_MIN_HEIGHT_PHONE = 560;
const SIGNALS_TABLE_SPARKLINE_REQUEST_OPTIONS = buildBarsRequestOptions(
  BARS_REQUEST_PRIORITY.visible,
  "signals-table-sparkline",
);

const readSignalsRouteDataTimingNow = () =>
  typeof performance !== "undefined" &&
  typeof performance.now === "function"
    ? performance.now()
    : Date.now();

const scheduleSignalsIdleWork = (
  callback,
  timeout = SIGNALS_MATRIX_FULL_HYDRATION_IDLE_TIMEOUT_MS,
) => {
  if (typeof window === "undefined") {
    return () => {};
  }
  if (typeof window.requestIdleCallback === "function") {
    const idleId = window.requestIdleCallback(callback, { timeout });
    return () => window.cancelIdleCallback?.(idleId);
  }
  const timerId = window.setTimeout(callback, Math.min(timeout, 240));
  return () => window.clearTimeout(timerId);
};

const signalSparklineRowKey = (symbol) =>
  String(symbol || "").trim().toUpperCase();

const barCloseValue = (bar) => {
  const close = Number(bar?.close ?? bar?.c);
  return Number.isFinite(close) ? close : null;
};

const thinBarsForSignalsTableSparkline = (bars) => {
  const validBars = Array.isArray(bars)
    ? bars.filter((bar) => barCloseValue(bar) != null)
    : [];
  if (validBars.length <= SPARKLINE_RENDER_POINT_LIMIT) {
    return validBars;
  }

  const lastIndex = validBars.length - 1;
  return Array.from({ length: SPARKLINE_RENDER_POINT_LIMIT }, (_, index) => {
    const sourceIndex = Math.round(
      (index * lastIndex) / (SPARKLINE_RENDER_POINT_LIMIT - 1),
    );
    return validBars[sourceIndex];
  });
};

const chunkSignalSparklineRows = (rows, chunkSize) => {
  const chunks = [];
  for (let index = 0; index < rows.length; index += chunkSize) {
    chunks.push(rows.slice(index, index + chunkSize));
  }
  return chunks;
};

const fetchSignalSparklineBarsBatch = async (rows, signal) => {
  const headers = new Headers(SIGNALS_TABLE_SPARKLINE_REQUEST_OPTIONS.headers);
  headers.set("content-type", "application/json");
  const response = await fetch("/api/bars/batch", {
    ...SIGNALS_TABLE_SPARKLINE_REQUEST_OPTIONS,
    method: "POST",
    signal,
    headers,
    body: JSON.stringify({
      requests: rows.map((row) => ({
        key: row.key,
        symbol: row.symbol,
        timeframe: SIGNALS_TABLE_SPARKLINE_HISTORY_TIMEFRAME,
        limit: SIGNALS_TABLE_SPARKLINE_HISTORY_LIMIT,
        outsideRth: true,
        source: "trades",
        brokerRecentWindowMinutes: 0,
        responseShape: "sparkline",
        sparklinePointLimit: SPARKLINE_RENDER_POINT_LIMIT,
      })),
    }),
  });
  if (!response.ok) {
    throw new Error(`Bars batch request failed with ${response.status}`);
  }
  const payload = await response.json();
  return Array.isArray(payload?.items) ? payload.items : [];
};

const signalSparklineFallbackPrice = (state, fallbackPrice) => {
  const currentSignalPrice = Number(state?.currentSignalPrice);
  if (Number.isFinite(currentSignalPrice) && currentSignalPrice > 0) {
    return currentSignalPrice;
  }
  const close = Number(state?.close);
  if (Number.isFinite(close) && close > 0) {
    return close;
  }
  const rowFallbackPrice = Number(fallbackPrice);
  return Number.isFinite(rowFallbackPrice) && rowFallbackPrice > 0
    ? rowFallbackPrice
    : null;
};

const signalRowSparklineFallbackPrice = (row) => {
  for (const value of [
    row?.currentSignalPrice,
    row?.latestEvent?.signalPrice,
    row?.latestEvent?.close,
    row?.primaryState?.currentSignalPrice,
  ]) {
    const price = Number(value);
    if (Number.isFinite(price) && price > 0) {
      return price;
    }
  }
  return null;
};

const signalSparklineSyntheticFallbackPrice = (symbol) => {
  const normalizedSymbol = String(symbol || "SIGNAL").trim().toUpperCase();
  let hash = 0;
  for (let index = 0; index < normalizedSymbol.length; index += 1) {
    hash = (hash * 31 + normalizedSymbol.charCodeAt(index)) % 10_000;
  }
  return 50 + (hash % 250);
};

const buildSignalsTableFallbackSparklineData = ({
  symbol,
  state,
  direction,
  fallbackPrice,
}) => {
  const current =
    signalSparklineFallbackPrice(state, fallbackPrice) ??
    signalSparklineSyntheticFallbackPrice(symbol);
  if (current == null) {
    return [];
  }
  const previous =
    direction === "sell"
      ? current * 1.0025
      : direction === "buy"
        ? current * 0.9975
        : current * 0.999;
  return buildDetailedFallbackSparklineData({
    symbol,
    current,
    previous,
    pointCount: SIGNALS_TABLE_FALLBACK_SPARKLINE_POINTS,
  });
};

const toneForDirection = (direction) =>
  direction === "buy"
    ? CSS_COLOR.blue
    : direction === "sell"
      ? CSS_COLOR.red
      : CSS_COLOR.textDim;

const latestSignalSparklineEventDirection = (signalEvents) => {
  const events = Array.isArray(signalEvents) ? signalEvents : EMPTY_SIGNAL_EVENTS;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const direction = String(events[index]?.direction || "").toLowerCase();
    if (isSignalSparklineDirection(direction)) {
      return direction;
    }
  }
  return "";
};

const signalSparklineDirectionOrFallback = (...directions) => {
  for (const direction of directions) {
    const normalizedDirection = String(direction || "").toLowerCase();
    if (isSignalSparklineDirection(normalizedDirection)) {
      return normalizedDirection;
    }
  }
  return "buy";
};

const toneForStatus = (status) => {
  switch (status) {
    case SIGNALS_ROW_STATUS.activeFresh:
      return CSS_COLOR.green;
    case SIGNALS_ROW_STATUS.activeStale:
      return CSS_COLOR.amber;
    case SIGNALS_ROW_STATUS.problem:
      return CSS_COLOR.red;
    case SIGNALS_ROW_STATUS.skipped:
      return CSS_COLOR.cyan;
    case SIGNALS_ROW_STATUS.pending:
      return CSS_COLOR.textDim;
    default:
      return CSS_COLOR.textMuted;
  }
};

const toneForTrend = (trendDirection) =>
  trendDirection === "bullish"
    ? CSS_COLOR.blue
    : trendDirection === "bearish"
      ? CSS_COLOR.red
      : CSS_COLOR.textDim;

const toneForMatrixReadiness = (readiness) => {
  switch (readiness) {
    case "ready":
      return CSS_COLOR.green;
    case "watch":
      return CSS_COLOR.blue;
    case "wait":
      return CSS_COLOR.amber;
    case "avoid":
      return CSS_COLOR.red;
    default:
      return CSS_COLOR.textDim;
  }
};

const selectStyle = {
  minHeight: dim(30),
  border: `1px solid ${CSS_COLOR.border}`,
  borderRadius: dim(RADII.sm),
  background: CSS_COLOR.bg1,
  color: CSS_COLOR.text,
  fontFamily: T.sans,
  fontSize: textSize("body"),
  padding: sp("0 8px"),
};

const iconButtonStyle = {
  minWidth: dim(32),
  height: dim(30),
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  border: `1px solid ${CSS_COLOR.border}`,
  borderRadius: dim(RADII.sm),
  background: CSS_COLOR.bg1,
  color: CSS_COLOR.textSec,
  cursor: "pointer",
};

const textButtonStyle = {
  minHeight: dim(30),
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: sp(6),
  border: `1px solid ${CSS_COLOR.border}`,
  borderRadius: dim(RADII.sm),
  background: CSS_COLOR.bg1,
  color: CSS_COLOR.text,
  cursor: "pointer",
  fontFamily: T.sans,
  fontSize: textSize("bodyStrong"),
  fontWeight: FONT_WEIGHTS.medium,
  padding: sp("0 10px"),
};

const cellTextStyle = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const formatTime = (value) => (value ? formatRelativeTimeShort(value) : MISSING_VALUE);

const formatClockTime = (value) => (value ? formatAppTime(value) : MISSING_VALUE);

const formatSince = (value) => {
  const relative = formatTime(value);
  return relative !== MISSING_VALUE ? `${relative} since` : MISSING_VALUE;
};

const formatBars = (value) =>
  Number.isFinite(Number(value)) ? `${Number(value)} bars` : MISSING_VALUE;

const formatCompactBars = (value) =>
  Number.isFinite(Number(value)) ? `${Number(value)}b` : MISSING_VALUE;

const formatMetric = (value, digits = 0) =>
  Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : MISSING_VALUE;

const formatTrend = (value) =>
  value === "bullish" ? "Bull" : value === "bearish" ? "Bear" : MISSING_VALUE;

const formatAge = (dashboardSummary) => {
  if (!dashboardSummary) return MISSING_VALUE;
  const bars = Number(dashboardSummary.trendAgeBars);
  if (!Number.isFinite(bars)) return MISSING_VALUE;
  const bucket = dashboardSummary.trendAgeBucket
    ? `${dashboardSummary.trendAgeBucket} `
    : "";
  return `${bucket}${bars}b`;
};

const formatCount = (value) => new Intl.NumberFormat("en-US").format(value || 0);

const formatCompactPrice = (value) =>
  Number.isFinite(Number(value)) ? formatQuotePrice(Number(value)) : MISSING_VALUE;

const formatPercent = (value, digits = 1) =>
  Number.isFinite(Number(value)) ? `${Number(value).toFixed(digits)}%` : MISSING_VALUE;

const formatEnumLabel = (value) =>
  String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase()) || MISSING_VALUE;

const formatScore = (value) =>
  Number.isFinite(Number(value)) ? `${Math.round(Number(value))}%` : MISSING_VALUE;

const formatFilterValue = (value) => {
  if (typeof value === "boolean") return value ? "pass" : "block";
  if (Number.isFinite(Number(value))) return formatMetric(value, 2);
  if (Array.isArray(value)) return value.map(formatFilterValue).join("/");
  return String(value ?? MISSING_VALUE);
};

const timestampMs = (value) => {
  const ms = Date.parse(value || "");
  return Number.isFinite(ms) ? ms : null;
};

const resolveSignalChartTimeframe = (row) => {
  const candidates = [
    row?.profileTimeframe,
    row?.primaryState?.timeframe,
    row?.latestEvent?.timeframe,
    "5m",
  ];
  return candidates.find((timeframe) =>
    SIGNAL_DRILLDOWN_CHART_TIMEFRAMES.has(String(timeframe || "")),
  ) || "5m";
};

const resolveSignalSourceLabel = (row) => {
  if (row?.primaryState) return "Primary monitor";
  if (row?.activeTimeframeCount) return "Matrix bars";
  if (row?.latestEvent) return "Latest event";
  return "Pending scan";
};

const resolveActionabilityLabel = (row) => {
  if (row?.problem) return "Blocked by monitor issue";
  if (row?.pending) return "Waiting on computation";
  if (!row?.direction) return "No active signal";
  if (row?.fresh) return `${String(row.direction).toUpperCase()} is fresh`;
  return `${String(row.direction).toUpperCase()} is aged`;
};

const getSignalDrilldownId = (symbol) =>
  `signals-row-drilldown-${String(symbol || "ticker").replace(/[^A-Za-z0-9_-]/g, "-")}`;

const isNestedInteractiveTarget = (event) => {
  const interactive = event.target?.closest?.(
    "button,a,input,select,textarea,[role='button'],[role='menuitem']",
  );
  return Boolean(interactive && interactive !== event.currentTarget);
};

const settingsSignature = (settings) => JSON.stringify(settings || {});

function FieldSelect({ label, value, options, onChange, style }) {
  return (
    <label
      style={{
        display: "inline-grid",
        gap: sp(4),
        color: CSS_COLOR.textMuted,
        fontSize: fs(10),
        fontWeight: FONT_WEIGHTS.label,
        letterSpacing: 0,
        textTransform: "uppercase",
        ...style,
      }}
    >
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        style={selectStyle}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function NumberField({ label, value, min, max, step = 1, round = true, onCommit }) {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);
  const commit = useCallback(() => {
    const numeric = Number(draft);
    if (!Number.isFinite(numeric)) {
      setDraft(value ?? "");
      return;
    }
    const resolved = round ? Math.round(numeric) : numeric;
    const clamped = Math.max(min, Math.min(max, resolved));
    setDraft(clamped);
    onCommit?.(clamped);
  }, [draft, max, min, onCommit, round, value]);

  return (
    <label
      style={{
        display: "inline-grid",
        gap: sp(4),
        color: CSS_COLOR.textMuted,
        fontSize: fs(10),
        fontWeight: FONT_WEIGHTS.label,
        letterSpacing: 0,
        textTransform: "uppercase",
        width: dim(92),
      }}
    >
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
        style={{
          ...selectStyle,
          width: "100%",
          fontVariantNumeric: "tabular-nums",
        }}
                />
    </label>
  );
}

function SignalsTickerSearchInput({ value, onCommit, style }) {
  const { inputProps } = useDebouncedTextCommit({
    value,
    onCommit,
  });

  return (
    <input
      {...inputProps}
      placeholder="Ticker"
      style={{
        ...style,
        width: "100%",
        paddingLeft: dim(30),
      }}
    />
  );
}

function DirectionBadge({ direction }) {
  const tone = toneForDirection(direction);
  const Icon = direction === "sell" ? ArrowDown : direction === "buy" ? ArrowUp : Clock3;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: sp(3),
        color: tone,
        fontSize: textSize("captionStrong"),
        fontWeight: FONT_WEIGHTS.label,
        letterSpacing: 0,
        textTransform: "uppercase",
      }}
    >
      <Icon size={13} strokeWidth={2} aria-hidden="true" />
      {direction || "none"}
    </span>
  );
}

function SignalsOverviewMetric({
  detail = "",
  label,
  tone = CSS_COLOR.text,
  value,
}) {
  return (
    <div
      style={{
        display: "grid",
        gap: sp(3),
        minWidth: 0,
        padding: sp("5px 7px"),
        borderRadius: dim(RADII.xs),
        background: CSS_COLOR.bg2,
        boxShadow: `inset 0 0 0 1px ${CSS_COLOR.borderLight}`,
      }}
    >
      <span
        style={{
          color: CSS_COLOR.textMuted,
          fontSize: fs(9),
          fontWeight: FONT_WEIGHTS.label,
          letterSpacing: 0,
          textTransform: "uppercase",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <span
        style={{
          color: tone,
          fontSize: fs(15),
          fontWeight: FONT_WEIGHTS.medium,
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </span>
      <span
        style={{
          ...cellTextStyle,
          color: CSS_COLOR.textDim,
          fontSize: fs(9),
        }}
      >
        {detail || MISSING_VALUE}
      </span>
    </div>
  );
}

function TimeframeSignalGroupedBars({
  summaries = [],
  phone = false,
  compact = false,
}) {
  const items = Array.isArray(summaries) ? summaries : [];
  if (!items.length) {
    return null;
  }
  const maxCount = Math.max(
    1,
    ...items.flatMap((item) => [
      Math.max(0, Number(item.buy) || 0),
      Math.max(0, Number(item.sell) || 0),
    ]),
  );
  const gridTemplateColumns = phone
    ? "1fr"
    : compact
      ? "repeat(2, minmax(0, 1fr))"
      : "repeat(3, minmax(0, 1fr))";

  return (
    <div
      data-testid="signals-timeframe-kpi-strip"
      aria-label="Buy and sell signals by timeframe"
      style={{
        display: "grid",
        gridTemplateColumns,
        gap: sp(6),
        minWidth: 0,
      }}
    >
      {items.map((item) => {
        const buy = Math.max(0, Number(item.buy) || 0);
        const sell = Math.max(0, Number(item.sell) || 0);
        const buyRatio = buy / maxCount;
        const sellRatio = sell / maxCount;
        const tone =
          item.direction === "buy"
            ? CSS_COLOR.blue
            : item.direction === "sell"
              ? CSS_COLOR.red
              : CSS_COLOR.textMuted;
        return (
          <AppTooltip
            key={item.timeframe}
            content={`${item.timeframe}: ${formatCount(buy)} buy, ${formatCount(sell)} sell, ${formatCount(item.fresh)} fresh`}
          >
            <div
              data-testid={`signals-timeframe-kpi-${item.timeframe}`}
              data-buy-count={buy}
              data-sell-count={sell}
              style={{
                display: "grid",
                gap: sp(4),
                minWidth: 0,
                minHeight: dim(48),
                padding: sp("6px 8px"),
                border: `1px solid ${CSS_COLOR.borderLight}`,
                borderRadius: dim(RADII.xs),
                background: CSS_COLOR.bg2,
              }}
            >
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: sp(6),
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    color: CSS_COLOR.textMuted,
                    fontSize: fs(9),
                    fontWeight: FONT_WEIGHTS.label,
                    letterSpacing: 0,
                    textTransform: "uppercase",
                  }}
                >
                  {item.timeframe}
                </span>
                <span
                  style={{
                    color: tone,
                    fontSize: fs(11),
                    fontWeight: FONT_WEIGHTS.medium,
                    fontVariantNumeric: "tabular-nums",
                    whiteSpace: "nowrap",
                  }}
                >
                  {formatCount(buy)}/{formatCount(sell)}
                </span>
              </span>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: sp(5),
                  minWidth: 0,
                }}
              >
                {[
                  ["B", buy, buyRatio, CSS_COLOR.blue],
                  ["S", sell, sellRatio, CSS_COLOR.red],
                ].map(([label, count, ratio, color]) => (
                  <span
                    key={label}
                    style={{
                      display: "grid",
                      gap: sp(3),
                      minWidth: 0,
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        height: dim(5),
                        borderRadius: dim(RADII.pill),
                        background: CSS_COLOR.bg3,
                        overflow: "hidden",
                      }}
                    >
                      <span
                        style={{
                          display: "block",
                          width: `${Math.round(ratio * 100)}%`,
                          minWidth: count ? dim(2) : 0,
                          height: "100%",
                          borderRadius: dim(RADII.pill),
                          background: color,
                        }}
                      />
                    </span>
                    <span
                      style={{
                        color,
                        fontSize: fs(9),
                        fontVariantNumeric: "tabular-nums",
                        fontWeight: FONT_WEIGHTS.label,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {label} {formatCount(count)}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          </AppTooltip>
        );
      })}
    </div>
  );
}

function CompactSignalBreadthPanel({
  history,
  range,
  onRangeChange,
  loading = false,
  error = null,
  phone = false,
}) {
  const chartWidth = 240;
  const chartHeight = 44;
  const centerY = Math.round(chartHeight / 2);
  const points = Array.isArray(history?.points) ? history.points : [];
  const maxMagnitude = Math.max(1, history?.maxTotal || history?.maxAbsNet || 0);
  const usableHeight = centerY - 5;
  const step = points.length > 1 ? chartWidth / (points.length - 1) : chartWidth;
  const barWidth = Math.max(1, Math.min(5, step * 0.5));
  const statusLabel = error
    ? "History unavailable"
    : loading
      ? "Loading"
      : history?.empty
        ? "No signals"
        : `${formatCount(history?.buyTotal)} buy / ${formatCount(history?.sellTotal)} sell`;
  const netTone = toneForDirection(history?.direction);
  const netLabel =
    history?.direction === "buy"
      ? `Buy +${formatCount(Math.abs(history.net))}`
      : history?.direction === "sell"
        ? `Sell +${formatCount(Math.abs(history.net))}`
        : history?.total
          ? "Balanced"
          : "Flat";

  return (
    <div
      data-testid="signals-breadth-history-strip"
      aria-label="Aggregate buy and sell signal breadth history"
      style={{
        display: "grid",
        gap: sp(6),
        alignContent: "stretch",
        minWidth: 0,
        height: "100%",
        padding: sp(8),
        border: `1px solid ${CSS_COLOR.borderLight}`,
        borderRadius: dim(RADII.xs),
        background: CSS_COLOR.bg2,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: sp(6),
          minWidth: 0,
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "baseline", gap: sp(6), minWidth: 0 }}>
          <span
            style={{
              color: CSS_COLOR.textMuted,
              fontSize: fs(9),
              fontWeight: FONT_WEIGHTS.label,
              letterSpacing: 0,
              textTransform: "uppercase",
            }}
          >
            Breadth
          </span>
          <span
            data-testid="signals-breadth-net"
            style={{
              color: netTone,
              fontSize: fs(13),
              fontWeight: FONT_WEIGHTS.medium,
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
            }}
          >
            {netLabel}
          </span>
        </span>
        <div
          role="group"
          aria-label="Signals breadth history range"
          style={{
            display: "inline-grid",
            gridTemplateColumns: "repeat(2, minmax(42px, 1fr))",
            alignItems: "center",
            gap: sp(3),
            minWidth: 0,
          }}
        >
          {SIGNALS_BREADTH_HISTORY_RANGE_OPTIONS.map((option) => {
            const selected = option.value === range;
            return (
              <button
                key={option.value}
                type="button"
                data-testid={
                  option.value === "day"
                    ? "signals-breadth-range-day"
                    : "signals-breadth-range-week"
                }
                aria-pressed={selected ? "true" : "false"}
                onClick={() => onRangeChange?.(option.value)}
                style={{
                  minHeight: dim(24),
                  border: `1px solid ${selected ? CSS_COLOR.accent : CSS_COLOR.borderLight}`,
                  borderRadius: dim(RADII.xs),
                  background: selected ? cssColorMix(CSS_COLOR.accent, 12) : CSS_COLOR.bg1,
                  color: selected ? CSS_COLOR.text : CSS_COLOR.textSec,
                  fontSize: fs(10),
                  fontWeight: FONT_WEIGHTS.medium,
                  fontFamily: T.sans,
                  cursor: "pointer",
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: sp(8),
          minWidth: 0,
          color: CSS_COLOR.textDim,
          fontSize: fs(10),
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <span style={{ color: CSS_COLOR.blue }}>B {formatCount(history?.buyTotal || 0)}</span>
        <span style={{ ...cellTextStyle, color: CSS_COLOR.textDim, textAlign: "center" }}>
          {statusLabel}
        </span>
        <span style={{ color: CSS_COLOR.red }}>S {formatCount(history?.sellTotal || 0)}</span>
      </div>
      <svg
        data-testid="signals-breadth-history-chart"
        role="img"
        aria-label={`Signals breadth history ${statusLabel}`}
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        preserveAspectRatio="none"
        style={{
          width: "100%",
          height: dim(phone ? 44 : 50),
          display: "block",
          overflow: "visible",
        }}
      >
        <line
          x1="0"
          x2={chartWidth}
          y1={centerY}
          y2={centerY}
          stroke={CSS_COLOR.border}
          strokeWidth="1"
        />
        {points.map((point, index) => {
          const x = points.length > 1 ? index * step : chartWidth / 2;
          const buyHeight = Math.round((point.buy / maxMagnitude) * usableHeight);
          const sellHeight = Math.round((point.sell / maxMagnitude) * usableHeight);
          return (
            <g key={`${point.at}-${index}`}>
              {buyHeight ? (
                <rect
                  x={x - barWidth / 2}
                  y={centerY - buyHeight}
                  width={barWidth}
                  height={buyHeight}
                  rx="0.8"
                  fill={CSS_COLOR.blue}
                  opacity="0.8"
                />
              ) : null}
              {sellHeight ? (
                <rect
                  x={x - barWidth / 2}
                  y={centerY}
                  width={barWidth}
                  height={sellHeight}
                  rx="0.8"
                  fill={CSS_COLOR.red}
                  opacity="0.8"
                />
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function SignalsOverviewPanel({
  breadthHistory,
  breadthHistoryError,
  breadthHistoryLoading,
  breadthHistoryRange,
  compact = false,
  netBias,
  onBreadthHistoryRangeChange,
  phone = false,
  summary,
  timeframeSummaries,
}) {
  const active = Math.max(0, summary?.active || 0);
  const total = Math.max(0, summary?.total || 0);
  const fresh = Math.max(0, summary?.fresh || 0);
  const aged = Math.max(0, active - fresh);
  const metrics = [
    {
      label: "Tracked",
      value: formatCount(total),
      detail: `${formatCount(active)} active`,
      tone: CSS_COLOR.text,
    },
    {
      label: "Fresh",
      value: formatCount(fresh),
      detail: `${formatCount(aged)} aged`,
      tone: CSS_COLOR.green,
    },
    {
      label: "Buy",
      value: formatCount(summary?.buy || 0),
      detail: "long bias",
      tone: CSS_COLOR.blue,
    },
    {
      label: "Sell",
      value: formatCount(summary?.sell || 0),
      detail: "short bias",
      tone: CSS_COLOR.red,
    },
    {
      label: "Net",
      value: netBias?.label || "No signals",
      detail: `B ${formatCount(netBias?.buy || 0)} / S ${formatCount(netBias?.sell || 0)}`,
      tone: toneForDirection(netBias?.direction),
    },
    {
      label: "Attention",
      value: formatCount(summary?.problem || 0),
      detail: `${formatCount(summary?.skipped || 0)} pending`,
      tone: CSS_COLOR.amber,
    },
  ];
  return (
    <div
      data-testid="signals-overview-panel"
      style={{
        display: "grid",
        gap: sp(8),
        minWidth: 0,
        padding: sp(10),
        border: `1px solid ${CSS_COLOR.border}`,
        borderRadius: dim(RADII.sm),
        background: CSS_COLOR.bg1,
        boxShadow: `inset 0 1px 0 ${cssColorMix(CSS_COLOR.text, 8)}`,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: phone
            ? "repeat(2, minmax(0, 1fr))"
            : "repeat(6, minmax(0, 1fr))",
          gap: sp(6),
          minWidth: 0,
        }}
      >
        {metrics.map((metric) => (
          <SignalsOverviewMetric key={metric.label} {...metric} />
        ))}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: phone || compact
            ? "1fr"
            : "minmax(0, 1.55fr) minmax(260px, 0.72fr)",
          gap: sp(8),
          minWidth: 0,
          alignItems: "stretch",
        }}
      >
        <TimeframeSignalGroupedBars
          summaries={timeframeSummaries}
          phone={phone}
          compact={compact}
        />
        <CompactSignalBreadthPanel
          history={breadthHistory}
          range={breadthHistoryRange}
          onRangeChange={onBreadthHistoryRangeChange}
          loading={breadthHistoryLoading}
          error={breadthHistoryError}
          phone={phone}
        />
      </div>
    </div>
  );
}
function StatusCell({ row }) {
  const tone = toneForStatus(row.status);
  const issues = collectDataIssuesFromRecord(
    {
      status:
        row.status === SIGNALS_ROW_STATUS.problem
          ? row.lastError
            ? "error"
            : "unavailable"
          : row.status === SIGNALS_ROW_STATUS.activeStale
            ? "stale"
            : row.status,
      lastError: row.lastError,
      reason: row.coverageReason,
      lastEvaluatedAt: row.lastEvaluatedAt,
    },
    {
      valueLabel: `${row.symbol || "Signal"} monitor state`,
      source: "signals monitor",
      nextAction:
        "Review the row detail or rerun the signal scan before relying on this signal state.",
    },
  );
  return (
    <span style={{ display: "inline-flex", minWidth: 0, alignItems: "center", gap: sp(4) }}>
      <DirectionBadge direction={row.direction} />
      <span
        style={{
          ...cellTextStyle,
          color: tone,
          fontSize: textSize("captionStrong"),
          fontWeight: FONT_WEIGHTS.medium,
        }}
      >
        {row.statusLabel}
      </span>
      <DataIssueInlineIcon issues={issues} side="bottom" align="center" />
    </span>
  );
}

function CoverageCell({ row }) {
  const tone = toneForStatus(row.status);
  const issues = collectDataIssuesFromRecord(
    {
      status:
        row.status === SIGNALS_ROW_STATUS.problem
          ? "unavailable"
          : row.status === SIGNALS_ROW_STATUS.activeStale
            ? "stale"
            : row.status,
      reason: row.coverageReason,
      lastError: row.lastError,
      lastEvaluatedAt: row.lastEvaluatedAt,
    },
    {
      valueLabel: `${row.symbol || "Signal"} coverage`,
      source: "signals monitor",
      nextAction:
        "Treat this signal as incomplete until coverage refreshes or the monitor explains the row state.",
    },
  );
  return (
    <span style={{ display: "inline-flex", minWidth: 0, alignItems: "center", gap: sp(4) }}>
      <span
        aria-hidden="true"
        style={{
          width: dim(7),
          height: dim(7),
          borderRadius: dim(RADII.pill),
          background: tone,
          flex: "0 0 auto",
        }}
      />
      <span style={{ ...cellTextStyle, color: CSS_COLOR.textSec }}>
        {row.coverageReason || MISSING_VALUE}
      </span>
      <DataIssueInlineIcon issues={issues} side="bottom" align="center" />
    </span>
  );
}

function CompactIntervalCell({
  symbol,
  timeframe,
  state,
  rowDirection = "",
  fallbackPrice = null,
  sparklineData = [],
  sparklinePoints: sourceSparklinePoints = null,
  signalEvents = EMPTY_SIGNAL_EVENTS,
}) {
  const status = normalizeSignalStatus(state);
  const pending = status === "pending";
  const stale = status === "stale";
  const hydrated = isHydratedSignalMatrixState(state);
  const hasSignalTiming = Boolean(
    state?.currentSignalAt || state?.latestBarAt || state?.lastEvaluatedAt,
  );
  const problem = !pending && !stale && isProblemSignalState(state);
  const direction = hydrated && !problem ? getCurrentSignalDirection(state) : "";
  const sparklineFallbackDirection = signalSparklineDirectionOrFallback(
    direction,
    rowDirection,
    latestSignalSparklineEventDirection(signalEvents),
  );
  const tone = problem ? CSS_COLOR.red : toneForDirection(direction);
  const fallbackSparklineData = useMemo(
    () =>
      buildSignalsTableFallbackSparklineData({
        symbol,
        state,
        direction: direction || sparklineFallbackDirection,
        fallbackPrice,
      }),
    [direction, fallbackPrice, sparklineFallbackDirection, state, symbol],
  );
  const displaySparklineData =
    Array.isArray(sparklineData) && sparklineData.length >= 2
      ? sparklineData
      : fallbackSparklineData;
  const usesFetchedSparklineData =
    Array.isArray(sparklineData) && sparklineData.length >= 2;
  const sparklineSource =
    usesFetchedSparklineData
      ? "bars"
      : fallbackSparklineData.length >= 2
        ? "fallback"
        : "empty";
  const sparklinePoints = useMemo(
    () =>
      usesFetchedSparklineData && Array.isArray(sourceSparklinePoints)
        ? sourceSparklinePoints
        : extractSparklinePoints(displaySparklineData),
    [displaySparklineData, sourceSparklinePoints, usesFetchedSparklineData],
  );
  const sparklinePointColors = useMemo(
    () =>
      buildSignalSparklinePointColors({
        points: sparklinePoints,
        row: {
          timeframe,
          direction,
          currentSignalAt: state?.currentSignalAt || null,
          status:
            hydrated && direction
              ? state?.fresh
                ? SIGNALS_ROW_STATUS.activeFresh
                : SIGNALS_ROW_STATUS.activeStale
              : normalizeSignalStatus(state),
        },
        signalEvents,
      }),
    [
      direction,
      hydrated,
      signalEvents,
      sparklinePoints,
      state?.currentSignalAt,
      state?.fresh,
      state?.status,
      timeframe,
    ],
  );
  const sparklineUsesSignalTimeline = Array.isArray(sparklinePointColors);
  const sparklineSignalColor = defaultSignalSparklineColorForDirection(
    sparklineFallbackDirection,
  );
  const sparklineColor = sparklineUsesSignalTimeline
    ? null
    : sparklineSignalColor;
  const sparklineSignalMode = sparklineUsesSignalTimeline
    ? "timeline"
    : direction
      ? "current"
      : "fallback";
  const issues = collectDataIssuesFromRecord(
    {
      status: problem
        ? state?.lastError
          ? "error"
          : state?.status || "unavailable"
        : normalizeSignalStatus(state) === "stale"
          ? "stale"
          : status,
      lastError: stale ? null : state?.lastError,
      lastEvaluatedAt: state?.lastEvaluatedAt,
      latestBarAt: state?.latestBarAt,
    },
    {
      valueLabel: `${timeframe} signal cell`,
      source: "signal matrix",
      nextAction:
        "Open the signal drilldown before trusting this interval's direction.",
    },
  );
  const intervalAge = hasSignalTiming
    ? formatTime(state.currentSignalAt || state.latestBarAt || state.lastEvaluatedAt)
    : MISSING_VALUE;
  const Icon = problem
    ? AlertTriangle
    : direction === "sell"
      ? ArrowDown
      : direction === "buy"
        ? ArrowUp
        : Clock3;
  const content = problem
    ? `${timeframe} ${state.status || "error"} · ${state.lastError}`
    : pending
      ? `${timeframe} pending`
      : stale
        ? `${timeframe} aged · ${intervalAge} · ${sparklinePoints.length || 0} bars`
        : hydrated
          ? `${timeframe} ${direction || "none"} · ${formatBars(state.barsSinceSignal)} · ${intervalAge} · ${sparklinePoints.length || 0} bars`
          : `${timeframe} not hydrated`;
  return (
    <AppTooltip content={content}>
      <span
        style={{
          display: "grid",
          gap: sp(1),
          width: "100%",
          minWidth: 0,
          color: tone,
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1,
        }}
      >
        <span
          data-testid={`signals-${timeframe}-sparkline`}
          data-sparkline-signal-mode={sparklineSignalMode}
          data-sparkline-source={sparklineSource}
          data-sparkline-signal-direction={direction || sparklineFallbackDirection}
          data-sparkline-points={sparklinePoints.length}
          style={{
            width: dim(TABLE_SPARKLINE_WIDTH),
            minWidth: dim(TABLE_SPARKLINE_WIDTH),
            height: dim(TABLE_SPARKLINE_HEIGHT),
            justifySelf: "end",
            overflow: "hidden",
            borderRadius: dim(RADII.xs),
          }}
        >
          {sparklinePoints.length >= 2 ? (
            <MicroSparkline
              data={displaySparklineData}
              points={sparklinePoints}
              color={sparklineColor}
              pointColors={sparklinePointColors}
              width={TABLE_SPARKLINE_WIDTH}
              height={TABLE_SPARKLINE_HEIGHT}
              className="ra-sparkline"
              ariaHidden
              style={{ width: "100%", height: "100%" }}
            />
          ) : (
            <span
              aria-hidden="true"
              style={{
                display: "block",
                width: "100%",
                height: "100%",
                borderRadius: dim(RADII.xs),
                boxShadow: `inset 0 -1px 0 ${cssColorMix(CSS_COLOR.textMuted, 24)}`,
                background: cssColorMix(CSS_COLOR.textMuted, 7),
                opacity: hydrated || stale ? 0.75 : 0.35,
              }}
            />
          )}
        </span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: sp(3),
            width: "100%",
            minWidth: 0,
          }}
        >
          <Icon size={13} strokeWidth={2} aria-hidden="true" />
          <DataIssueInlineIcon issues={issues} side="bottom" align="center" />
          <span
            style={{
              minWidth: 0,
              display: "inline-flex",
              alignItems: "baseline",
              gap: sp(3),
              lineHeight: 1.02,
            }}
          >
            <span
              style={{
                ...cellTextStyle,
                color: hydrated && state?.fresh
                  ? tone
                  : problem
                    ? tone
                    : CSS_COLOR.textDim,
                fontSize: textSize("captionStrong"),
              }}
            >
              {problem
                ? "Err"
                : pending
                  ? "Wait"
                  : stale
                    ? "Aged"
                    : hydrated
                      ? formatCompactBars(state.barsSinceSignal)
                      : MISSING_VALUE}
            </span>
            <span
              data-testid={`signals-${timeframe}-age`}
              style={{
                ...cellTextStyle,
                color: CSS_COLOR.textDim,
                fontSize: fs(9),
              }}
            >
              {hasSignalTiming ? intervalAge : pending ? "queued" : ""}
            </span>
          </span>
        </span>
      </span>
    </AppTooltip>
  );
}

function StackCell({ row }) {
  const stack = row.stackSummary || {};
  const tone =
    stack.direction === "mixed"
      ? CSS_COLOR.amber
      : toneForDirection(stack.direction);
  return (
    <AppTooltip
      content={`${stack.buyCount || 0} buy, ${stack.sellCount || 0} sell, ${stack.freshCount || 0} fresh across ${stack.totalCount || SIGNALS_TABLE_TIMEFRAMES.length} intervals`}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: sp(3),
          color: tone,
          fontSize: textSize("captionStrong"),
          fontWeight: FONT_WEIGHTS.label,
          fontVariantNumeric: "tabular-nums",
          textTransform: "uppercase",
        }}
      >
        {stack.direction === "mixed" ? "Mix" : stack.direction || "None"}
        <span style={{ color: CSS_COLOR.textDim }}>
          {stack.label || `0/${SIGNALS_TABLE_TIMEFRAMES.length}`}
        </span>
      </span>
    </AppTooltip>
  );
}

function TrendCell({ row }) {
  const dashboard = row.dashboardSummary || {};
  return (
    <AppTooltip
      content={`Dashboard ${dashboard.timeframe || "matrix"} trend ${formatTrend(dashboard.trendDirection)}`}
    >
      <span
        style={{
          ...cellTextStyle,
          color: toneForTrend(dashboard.trendDirection),
          fontSize: textSize("captionStrong"),
          fontWeight: FONT_WEIGHTS.label,
        }}
      >
        {formatTrend(dashboard.trendDirection)}
      </span>
    </AppTooltip>
  );
}

function MtfCell({ row }) {
  const mtf = row.dashboardSummary?.mtf || [];
  const required = mtf.filter((entry) => entry.required);
  const passCount = required.filter((entry) => entry.pass).length;
  const label = required.length ? `${passCount}/${required.length}` : "off";
  return (
    <AppTooltip
      content={
        mtf.length
          ? mtf
              .map((entry) => `${entry.timeframe} ${entry.direction || "none"}${entry.required ? entry.pass ? " pass" : " block" : ""}`)
              .join(" · ")
          : "No MTF dashboard data"
      }
    >
      <span style={{ ...cellTextStyle, color: CSS_COLOR.textSec }}>
        {label}
      </span>
    </AppTooltip>
  );
}

function MatrixVerdictCell({ row }) {
  const verdict = row.matrixVerdict || {};
  const tone = toneForMatrixReadiness(verdict.tradeReadiness);
  const reasons = Array.isArray(verdict.reasonCodes) ? verdict.reasonCodes : [];
  const content = [
    verdict.label || "Matrix pending",
    verdict.detail,
    reasons.length ? reasons.map(formatEnumLabel).join(" · ") : null,
  ].filter(Boolean).join(" · ");
  return (
    <AppTooltip content={content || "Signal matrix verdict unavailable"}>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: sp(3),
          minWidth: 0,
          color: tone,
          lineHeight: 1.1,
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: sp(3),
            minWidth: 0,
            fontSize: textSize("captionStrong"),
            fontWeight: FONT_WEIGHTS.label,
            textTransform: "uppercase",
          }}
        >
          <ScanLine size={13} strokeWidth={2} aria-hidden="true" />
          <span style={cellTextStyle}>
            {formatEnumLabel(verdict.tradeReadiness)}
          </span>
          <span style={{ color: CSS_COLOR.textDim }}>
            {formatScore(verdict.readinessScore)}
          </span>
        </span>
        <span
          style={{
            ...cellTextStyle,
            color: CSS_COLOR.textMuted,
            fontSize: fs(10),
            fontWeight: FONT_WEIGHTS.medium,
          }}
        >
          {formatEnumLabel(verdict.regime)}
        </span>
      </span>
    </AppTooltip>
  );
}

function MatrixVerdictSummary({ row }) {
  const verdict = row.matrixVerdict || {};
  const tone = toneForMatrixReadiness(verdict.tradeReadiness);
  const reasons = Array.isArray(verdict.reasonCodes) ? verdict.reasonCodes : [];

  return (
    <div style={{ display: "grid", gap: sp(8), minWidth: 0 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: sp(8) }}>
        <SignalDenseFact
          variant="tile"
          label="Verdict"
          value={verdict.label || "Matrix pending"}
          tone={tone}
        />
        <SignalDenseFact
          variant="tile"
          label="Risk"
          value={formatEnumLabel(verdict.riskPosture)}
          tone={verdict.riskPosture === "normal" ? CSS_COLOR.green : tone}
        />
        <SignalDenseFact
          variant="tile"
          label="Align"
          value={formatScore(verdict.alignmentScore)}
          tone={tone}
        />
        <SignalDenseFact
          variant="tile"
          label="Fresh"
          value={formatScore(verdict.freshnessScore)}
          tone={verdict.freshnessScore >= 60 ? CSS_COLOR.green : CSS_COLOR.amber}
        />
      </div>
      {reasons.length ? (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: sp(5),
            minWidth: 0,
          }}
        >
          {reasons.slice(0, 5).map((reason) => (
            <span
              key={reason}
              style={{
                minHeight: dim(20),
                display: "inline-flex",
                alignItems: "center",
                padding: sp("0 7px"),
                border: `1px solid ${cssColorMix(tone, 38)}`,
                borderRadius: dim(RADII.pill),
                background: cssColorMix(tone, 9),
                color: CSS_COLOR.textSec,
                fontSize: fs(10),
                fontWeight: FONT_WEIGHTS.label,
                textTransform: "uppercase",
                whiteSpace: "nowrap",
              }}
            >
              {formatEnumLabel(reason)}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ToggleControl({ label, checked, onChange }) {
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: sp(6),
        minHeight: dim(30),
        color: CSS_COLOR.textSec,
        fontSize: textSize("body"),
      }}
    >
      <input
        type="checkbox"
        checked={Boolean(checked)}
        onChange={(event) => onChange?.(event.target.checked)}
        style={{ width: dim(14), height: dim(14), accentColor: CSS_COLOR.accent }}
      />
      <span>{label}</span>
    </label>
  );
}

function SettingsGroup({ title, children }) {
  return (
    <div style={{ display: "grid", gap: sp(8), alignContent: "start" }}>
      <SectionLabel>{title}</SectionLabel>
      <div style={{ display: "flex", gap: sp(8), alignItems: "end", flexWrap: "wrap" }}>
        {children}
      </div>
    </div>
  );
}

function OperationalSettingsPanel({
  applying,
  draft,
  dirty,
  highBetaUniverseStatus,
  onPatch,
  onApply,
  onReset,
}) {
  if (!draft) return null;
  const highBetaUniverse = describeHighBetaUniverseAvailability(
    highBetaUniverseStatus,
  );
  const highBetaSelected =
    draft[SIGNAL_MONITOR_UNIVERSE_SCOPE_KEY] === "high_beta_500";
  return (
    <Card
      data-testid="signals-indicator-controls"
      aria-busy={applying ? "true" : "false"}
      style={{
        display: "grid",
        gap: sp(12),
        padding: sp(12),
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: sp(10),
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "grid", gap: sp(2), minWidth: 0 }}>
          <SectionLabel>Indicator Controls</SectionLabel>
          {applying || dirty ? (
            <span
              style={{
                color: applying ? CSS_COLOR.accent : CSS_COLOR.amber,
                fontSize: textSize("body"),
              }}
            >
              {applying ? "Applying" : "Unsaved changes"}
            </span>
          ) : null}
        </div>
        <div style={{ display: "inline-flex", gap: sp(6), alignItems: "center" }}>
          <button
            type="button"
            onClick={onReset}
            disabled={applying}
            style={{
              ...textButtonStyle,
              color: applying ? CSS_COLOR.textDim : textButtonStyle.color,
              cursor: applying ? "default" : "pointer",
            }}
          >
            Reset Draft
          </button>
          <button
            type="button"
            onClick={onApply}
            disabled={!dirty || applying}
            style={{
              ...textButtonStyle,
              color: dirty && !applying ? CSS_COLOR.green : CSS_COLOR.textDim,
              cursor: dirty && !applying ? "pointer" : "default",
            }}
          >
            Apply and Scan
          </button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
          gap: sp(12),
        }}
      >
        <SettingsGroup title="Structure">
          <FieldSelect
            label="Universe"
            value={draft[SIGNAL_MONITOR_UNIVERSE_SCOPE_KEY]}
            options={SIGNAL_MONITOR_UNIVERSE_SCOPE_OPTIONS}
            onChange={(value) =>
              onPatch({ [SIGNAL_MONITOR_UNIVERSE_SCOPE_KEY]: value })
            }
          />
          {highBetaSelected ? (
            <StatusPill color={highBetaUniverse.tone} variant="outline">
              {highBetaUniverse.label}
            </StatusPill>
          ) : null}
          <NumberField label="Horizon" value={draft.timeHorizon} min={2} max={40} onCommit={(value) => onPatch({ timeHorizon: value })} />
          <FieldSelect
            label="BOS"
            value={draft.bosConfirmation}
            options={PYRUS_SIGNALS_BOS_CONFIRMATION_OPTIONS.map((value) => ({
              value,
              label: value,
            }))}
            onChange={(value) => onPatch({ bosConfirmation: value })}
          />
          <NumberField label="CHOCH ATR" value={draft.chochAtrBuffer} min={0} max={20} step={0.05} round={false} onCommit={(value) => onPatch({ chochAtrBuffer: value })} />
          <NumberField label="Body ATR" value={draft.chochBodyExpansionAtr} min={0} max={20} step={0.05} round={false} onCommit={(value) => onPatch({ chochBodyExpansionAtr: value })} />
          <NumberField label="Vol Gate" value={draft.chochVolumeGate} min={0} max={20} step={0.05} round={false} onCommit={(value) => onPatch({ chochVolumeGate: value })} />
        </SettingsGroup>

        <SettingsGroup title="Bands">
          <NumberField label="Basis" value={draft.basisLength} min={1} max={240} onCommit={(value) => onPatch({ basisLength: value })} />
          <NumberField label="ATR Len" value={draft.atrLength} min={1} max={100} onCommit={(value) => onPatch({ atrLength: value })} />
          <NumberField label="ATR Smooth" value={draft.atrSmoothing} min={1} max={200} onCommit={(value) => onPatch({ atrSmoothing: value })} />
          <NumberField label="Vol Mult" value={draft.volatilityMultiplier} min={0.1} max={10} step={0.1} round={false} onCommit={(value) => onPatch({ volatilityMultiplier: value })} />
        </SettingsGroup>

        <SettingsGroup title="Confirmation">
          <ToggleControl label="Filters" checked={draft.signalFiltersEnabled} onChange={(value) => onPatch({ signalFiltersEnabled: value })} />
          {[1, 2, 3].map((slot) => {
            const mtfKey = `mtf${slot}`;
            const requireKey = `requireMtf${slot}`;
            return (
              <span key={slot} style={{ display: "inline-flex", gap: sp(6), alignItems: "end" }}>
                <FieldSelect
                  label={`MTF ${slot}`}
                  value={draft[mtfKey]}
                  options={PYRUS_SIGNALS_MTF_OPTIONS.map((value) => ({ value, label: value }))}
                  onChange={(value) => onPatch({ [mtfKey]: value })}
                />
                <ToggleControl
                  label="Req"
                  checked={draft[requireKey]}
                  onChange={(value) => onPatch({ [requireKey]: value })}
                />
              </span>
            );
          })}
          <ToggleControl label="ADX" checked={draft.requireAdx} onChange={(value) => onPatch({ requireAdx: value })} />
          <NumberField label="ADX Min" value={draft.adxMin} min={1} max={100} onCommit={(value) => onPatch({ adxMin: value })} />
          <ToggleControl label="Vol Range" checked={draft.requireVolScoreRange} onChange={(value) => onPatch({ requireVolScoreRange: value })} />
          <NumberField label="Vol Min" value={draft.volScoreMin} min={0} max={10} onCommit={(value) => onPatch({ volScoreMin: value })} />
          <NumberField label="Vol Max" value={draft.volScoreMax} min={0} max={10} onCommit={(value) => onPatch({ volScoreMax: value })} />
          <ToggleControl label="Sessions" checked={draft.restrictToSelectedSessions} onChange={(value) => onPatch({ restrictToSelectedSessions: value })} />
          {PYRUS_SIGNALS_SESSION_OPTIONS.map((option) => (
            <ToggleControl
              key={option.value}
              label={option.label}
              checked={(draft.sessions || []).includes(option.value)}
              onChange={(checked) => {
                const current = Array.isArray(draft.sessions) ? draft.sessions : [];
                onPatch({
                  sessions: checked
                    ? [...new Set([...current, option.value])]
                    : current.filter((value) => value !== option.value),
                });
              }}
            />
          ))}
        </SettingsGroup>

        <SettingsGroup title="Risk And Alerts">
          <NumberField label="Offset" value={draft.signalOffsetAtr} min={0} max={20} step={0.1} round={false} onCommit={(value) => onPatch({ signalOffsetAtr: value })} />
          <NumberField label="TP1 R" value={draft.tp1Rr} min={0} max={10} step={0.1} round={false} onCommit={(value) => onPatch({ tp1Rr: value })} />
          <NumberField label="TP2 R" value={draft.tp2Rr} min={0} max={10} step={0.1} round={false} onCommit={(value) => onPatch({ tp2Rr: value })} />
          <NumberField label="TP3 R" value={draft.tp3Rr} min={0} max={10} step={0.1} round={false} onCommit={(value) => onPatch({ tp3Rr: value })} />
          <ToggleControl label="Bar Close" checked={draft.waitForBarClose} onChange={(value) => onPatch({ waitForBarClose: value })} />
        </SettingsGroup>
      </div>
    </Card>
  );
}

function SignalDenseFact({
  label,
  value,
  tone = CSS_COLOR.text,
  align = "start",
  variant = "divider",
}) {
  const tile = variant === "tile";
  return (
    <div
      style={{
        minWidth: 0,
        display: "grid",
        alignContent: "center",
        gap: sp(2),
        padding: tile ? sp("7px 8px") : sp("6px 8px"),
        border: tile ? `1px solid ${CSS_COLOR.border}` : "none",
        borderLeft: tile ? `1px solid ${CSS_COLOR.border}` : `1px solid ${CSS_COLOR.border}`,
        borderRadius: tile ? dim(RADII.xs) : 0,
        background: tile ? CSS_COLOR.bg2 : "transparent",
        textAlign: align,
      }}
    >
      <span
        style={{
          color: CSS_COLOR.textMuted,
          fontSize: fs(10),
          fontWeight: FONT_WEIGHTS.label,
          letterSpacing: 0,
          textTransform: "uppercase",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <AppTooltip content={String(value || MISSING_VALUE)}>
        <span
          style={{
            ...cellTextStyle,
            color: tone,
            fontSize: textSize("bodyStrong"),
            fontWeight: FONT_WEIGHTS.medium,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {value || MISSING_VALUE}
        </span>
      </AppTooltip>
    </div>
  );
}

function SignalDenseSection({ title, action, children, testId, style }) {
  return (
    <section
      data-testid={testId}
      style={{
        minWidth: 0,
        display: "grid",
        alignContent: "start",
        gap: sp(8),
        border: `1px solid ${CSS_COLOR.border}`,
        borderRadius: dim(RADII.sm),
        background: CSS_COLOR.bg1,
        padding: sp(10),
        boxShadow: `inset 0 1px 0 ${cssColorMix(CSS_COLOR.text, 8)}`,
        ...style,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: sp(8),
          minWidth: 0,
        }}
      >
        <SectionLabel>{title}</SectionLabel>
        {action ? (
          <span
            style={{
              ...cellTextStyle,
              color: CSS_COLOR.textDim,
              fontSize: textSize("caption"),
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {action}
          </span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function SignalContextChart({ row, barsQuery, timeframe }) {
  const statusTone = toneForStatus(row.status);
  const directionTone = toneForDirection(row.direction);
  const bars = Array.isArray(barsQuery.data?.bars) ? barsQuery.data.bars : [];
  const chartWidth = 720;
  const chartHeight = 218;
  const padLeft = 44;
  const padRight = 18;
  const padTop = 18;
  const padBottom = 42;
  const plotWidth = chartWidth - padLeft - padRight;
  const priceHeight = chartHeight - padTop - padBottom - 32;
  const volumeTop = padTop + priceHeight + 14;
  const volumeHeight = 20;
  const drawableBars = bars
    .map((bar) => ({
      close: Number(bar?.close),
      high: Number(bar?.high),
      low: Number(bar?.low),
      open: Number(bar?.open),
      timestamp: bar?.timestamp,
      volume: Number(bar?.volume),
      ms: timestampMs(bar?.timestamp),
    }))
    .filter((bar) =>
      Number.isFinite(bar.close) &&
      Number.isFinite(bar.high) &&
      Number.isFinite(bar.low) &&
      Number.isFinite(bar.ms),
    );
  const minPrice = Math.min(
    ...drawableBars.map((bar) => Math.min(bar.low, bar.close, bar.open || bar.close)),
  );
  const maxPrice = Math.max(
    ...drawableBars.map((bar) => Math.max(bar.high, bar.close, bar.open || bar.close)),
  );
  const priceRange = Number.isFinite(maxPrice - minPrice) && maxPrice !== minPrice
    ? maxPrice - minPrice
    : 1;
  const maxVolume = Math.max(1, ...drawableBars.map((bar) => bar.volume || 0));
  const plotY = (price) =>
    padTop + priceHeight - ((Number(price) - minPrice) / priceRange) * priceHeight;
  const plotX = (index) =>
    padLeft +
    (drawableBars.length <= 1 ? 0 : (index * plotWidth) / (drawableBars.length - 1));
  const closeLine = drawableBars
    .map((bar, index) => `${plotX(index).toFixed(2)},${plotY(bar.close).toFixed(2)}`)
    .join(" ");
  const areaPoints = closeLine && drawableBars.length
    ? `${plotX(0).toFixed(2)},${(volumeTop + volumeHeight).toFixed(2)} ${closeLine} ${plotX(drawableBars.length - 1).toFixed(2)},${(volumeTop + volumeHeight).toFixed(2)}`
    : "";
  const signalMs = timestampMs(row.currentSignalAt);
  const lastBar = drawableBars.at(-1);
  const firstBar = drawableBars[0];
  const signalInsideWindow =
    signalMs != null &&
    firstBar?.ms != null &&
    lastBar?.ms != null &&
    signalMs >= firstBar.ms &&
    signalMs <= lastBar.ms;
  const signalIndex =
    !signalInsideWindow
      ? -1
      : drawableBars.reduce(
          (best, bar, index) => {
            const distance = Math.abs(bar.ms - signalMs);
            return distance < best.distance ? { distance, index } : best;
          },
          { distance: Number.POSITIVE_INFINITY, index: -1 },
        ).index;
  const signalX = signalIndex >= 0 ? plotX(signalIndex) : null;
  const signalY = Number.isFinite(Number(row.currentSignalPrice))
    ? plotY(Number(row.currentSignalPrice))
    : signalIndex >= 0
      ? plotY(drawableBars[signalIndex].close)
      : null;
  const delta = lastBar && firstBar ? lastBar.close - firstBar.close : null;
  const deltaPct = lastBar && firstBar && firstBar.close
    ? (delta / firstBar.close) * 100
    : null;
  const deltaTone = Number(delta) > 0 ? CSS_COLOR.green : Number(delta) < 0 ? CSS_COLOR.red : CSS_COLOR.textDim;
  const signalClockTime = formatClockTime(row.currentSignalAt);
  const signalSince = formatSince(row.currentSignalAt);
  const signalMarkerLabel = [
    String(row.direction || "signal").toUpperCase(),
    signalClockTime !== MISSING_VALUE ? signalClockTime : null,
  ].filter(Boolean).join(" ");
  const chartState = barsQuery.isLoading
    ? "Loading bars"
    : barsQuery.isError
      ? "Bars unavailable"
      : drawableBars.length < 2
        ? "No chart bars"
        : null;

  return (
    <SignalDenseSection
      title="Price Context"
      action={`${timeframe} · ${drawableBars.length || 0} bars`}
      testId="signals-drilldown-price-chart"
      style={{ minHeight: dim(286) }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))",
          gap: sp(6),
        }}
      >
        <SignalDenseFact variant="tile" label="Signal Time" value={signalClockTime} tone={directionTone} />
        <SignalDenseFact variant="tile" label="Since" value={signalSince} tone={directionTone} />
        <SignalDenseFact variant="tile" label="Last" value={formatCompactPrice(lastBar?.close)} />
        <SignalDenseFact variant="tile" label="Window" value={formatPercent(deltaPct)} tone={deltaTone} />
        <SignalDenseFact variant="tile" label="Source" value={formatEnumLabel(barsQuery.data?.historySource)} />
        <SignalDenseFact variant="tile" label="Mode" value={formatEnumLabel(barsQuery.data?.marketDataMode)} />
      </div>
      <div
        style={{
          position: "relative",
          minHeight: dim(210),
          border: `1px solid ${CSS_COLOR.border}`,
          borderRadius: dim(RADII.sm),
          background: CSS_COLOR.bg0,
          overflow: "hidden",
        }}
      >
        {chartState ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              color: barsQuery.isError ? CSS_COLOR.red : CSS_COLOR.textDim,
              fontSize: textSize("bodyStrong"),
              fontWeight: FONT_WEIGHTS.medium,
            }}
          >
            {chartState}
          </div>
        ) : null}
        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          role="img"
          aria-label={`${row.symbol} ${timeframe} price chart`}
          style={{
            width: "100%",
            height: "100%",
            minHeight: dim(210),
            display: "block",
            opacity: chartState ? 0.3 : 1,
          }}
        >
          {[0, 0.5, 1].map((step) => {
            const y = padTop + step * priceHeight;
            const price = maxPrice - step * priceRange;
            return (
              <g key={step}>
                <line
                  x1={padLeft}
                  x2={chartWidth - padRight}
                  y1={y}
                  y2={y}
                  stroke={CSS_COLOR.border}
                  strokeWidth="1"
                />
                <text
                  x={padLeft - 8}
                  y={y + 4}
                  textAnchor="end"
                  fill={CSS_COLOR.textMuted}
                  fontSize="10"
                  fontWeight="600"
                >
                  {formatCompactPrice(price)}
                </text>
              </g>
            );
          })}
          {areaPoints ? (
            <polygon
              points={areaPoints}
              fill={cssColorMix(directionTone || statusTone, 14)}
            />
          ) : null}
          {drawableBars.map((bar, index) => {
            const x = plotX(index);
            const barWidth = Math.max(1.6, plotWidth / Math.max(drawableBars.length, 1) - 1);
            const volumeHeightResolved = ((bar.volume || 0) / maxVolume) * volumeHeight;
            return (
              <rect
                key={`${bar.timestamp}-${index}`}
                x={x - barWidth / 2}
                y={volumeTop + volumeHeight - volumeHeightResolved}
                width={barWidth}
                height={Math.max(1, volumeHeightResolved)}
                rx="1"
                fill={cssColorMix(bar.close >= bar.open ? CSS_COLOR.green : CSS_COLOR.red, 45)}
              />
            );
          })}
          {closeLine ? (
            <polyline
              points={closeLine}
              fill="none"
              stroke={directionTone || statusTone}
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}
          {signalX != null && signalY != null ? (
            <g>
              <line
                x1={padLeft}
                x2={chartWidth - padRight}
                y1={signalY}
                y2={signalY}
                stroke={cssColorMix(directionTone, 44)}
                strokeWidth="1"
                strokeDasharray="2 5"
              />
              <line
                x1={signalX}
                x2={signalX}
                y1={padTop}
                y2={volumeTop + volumeHeight}
                stroke={cssColorMix(statusTone, 62)}
                strokeWidth="1.5"
                strokeDasharray="4 4"
              />
              <circle
                cx={signalX}
                cy={signalY}
                r="5"
                fill={CSS_COLOR.bg0}
                stroke={directionTone}
                strokeWidth="2.5"
              />
              <text
                x={Math.min(chartWidth - padRight - 30, signalX + 8)}
                y={Math.max(16, signalY - 8)}
                fill={directionTone}
                fontSize="11"
                fontWeight="700"
              >
                <tspan x={Math.min(chartWidth - padRight - 78, signalX + 8)}>
                  {signalMarkerLabel}
                </tspan>
                <tspan
                  x={Math.min(chartWidth - padRight - 78, signalX + 8)}
                  dy="13"
                  fill={CSS_COLOR.textMuted}
                  fontSize="10"
                  fontWeight="600"
                >
                  {signalSince}
                </tspan>
              </text>
            </g>
          ) : null}
          <text
            x={padLeft}
            y={chartHeight - 10}
            fill={CSS_COLOR.textMuted}
            fontSize="10"
            fontWeight="600"
          >
            {formatTime(firstBar?.timestamp)}
          </text>
          <text
            x={chartWidth - padRight}
            y={chartHeight - 10}
            textAnchor="end"
            fill={CSS_COLOR.textMuted}
            fontSize="10"
            fontWeight="600"
          >
            {formatTime(lastBar?.timestamp)}
          </text>
        </svg>
      </div>
    </SignalDenseSection>
  );
}

function SignalThesisRail({ row }) {
  const statusTone = toneForStatus(row.status);
  const trendTone = toneForTrend(row.dashboardSummary?.trendDirection);
  const latestEvent = row.latestEvent;

  return (
    <SignalDenseSection
      title="Decision Thesis"
      action={resolveSignalSourceLabel(row)}
      testId="signals-drilldown-thesis"
    >
      <div
        style={{
          display: "grid",
          gap: sp(8),
          color: CSS_COLOR.textSec,
          fontSize: textSize("body"),
          lineHeight: 1.3,
        }}
      >
        <div
          style={{
            display: "grid",
            gap: sp(5),
            paddingBottom: sp(8),
            borderBottom: `1px solid ${CSS_COLOR.border}`,
          }}
        >
          <span style={{ color: statusTone, fontSize: fs(18), fontWeight: FONT_WEIGHTS.medium }}>
            {resolveActionabilityLabel(row)}
          </span>
          <span>{row.coverageReason}</span>
        </div>
        <MatrixVerdictSummary row={row} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: sp(8) }}>
          <SignalDenseFact
            variant="tile"
            label="Trend"
            value={formatTrend(row.dashboardSummary?.trendDirection)}
            tone={trendTone}
          />
          <SignalDenseFact
            variant="tile"
            label="Strength"
            value={
              row.dashboardSummary?.strength
                ? `${formatEnumLabel(row.dashboardSummary.strength)} · ADX ${formatMetric(row.dashboardSummary.adx, 1)}`
                : MISSING_VALUE
            }
          />
          <SignalDenseFact variant="tile" label="Age" value={formatAge(row.dashboardSummary)} />
          <SignalDenseFact
            variant="tile"
            label="Vol"
            value={
              row.dashboardSummary?.volatilityScore != null
                ? `${formatMetric(row.dashboardSummary.volatilityScore)}/10`
                : MISSING_VALUE
            }
          />
        </div>
        {latestEvent ? (
          <div
            style={{
              display: "grid",
              gap: sp(3),
              paddingTop: sp(8),
              borderTop: `1px solid ${CSS_COLOR.border}`,
            }}
          >
            <span style={{ color: CSS_COLOR.textMuted, fontSize: fs(10), fontWeight: FONT_WEIGHTS.label, textTransform: "uppercase" }}>
              Latest Event
            </span>
            <span style={{ color: toneForDirection(latestEvent.direction), fontWeight: FONT_WEIGHTS.medium }}>
              {`${String(latestEvent.direction || "none").toUpperCase()} · ${latestEvent.timeframe || MISSING_VALUE}`}
            </span>
            <span style={{ color: CSS_COLOR.textDim }}>
              {formatTime(latestEvent.emittedAt || latestEvent.signalAt)}
            </span>
          </div>
        ) : null}
      </div>
    </SignalDenseSection>
  );
}

function SignalIntervalMatrix({ matrixEntries }) {
  return (
    <SignalDenseSection
      title="Interval Matrix"
      action="freshness by scan"
      testId="signals-drilldown-interval-matrix"
    >
      <div style={{ display: "grid", gap: sp(5) }}>
        {matrixEntries.map(({ timeframe, state }) => {
          const direction = getCurrentSignalDirection(state);
          const tone = toneForDirection(direction);
          const fresh = Boolean(state?.fresh);
          return (
            <div
              key={timeframe}
              style={{
                display: "grid",
                gridTemplateColumns: "42px minmax(74px, 1fr) 64px 72px",
                gap: sp(8),
                alignItems: "center",
                minHeight: dim(30),
                color: CSS_COLOR.textSec,
                fontSize: textSize("captionStrong"),
                fontVariantNumeric: "tabular-nums",
              }}
            >
              <span style={{ color: CSS_COLOR.textMuted, fontWeight: FONT_WEIGHTS.label }}>
                {timeframe}
              </span>
              <DirectionBadge direction={direction} />
              <span style={{ color: state ? CSS_COLOR.textSec : CSS_COLOR.textMuted }}>
                {state ? formatCompactBars(state.barsSinceSignal) : MISSING_VALUE}
              </span>
              <span
                style={{
                  justifySelf: "end",
                  color: !state ? CSS_COLOR.textMuted : fresh ? CSS_COLOR.green : CSS_COLOR.amber,
                  fontWeight: FONT_WEIGHTS.label,
                  textTransform: "uppercase",
                }}
              >
                {!state ? "empty" : fresh ? "fresh" : "aged"}
              </span>
              <span
                aria-hidden="true"
                style={{
                  gridColumn: "1 / -1",
                  height: dim(3),
                  borderRadius: dim(RADII.pill),
                  background: state
                    ? `linear-gradient(90deg, ${cssColorMix(tone, 72)}, ${CSS_COLOR.bg3})`
                    : CSS_COLOR.bg3,
                }}
              />
            </div>
          );
        })}
      </div>
    </SignalDenseSection>
  );
}

function SignalGateMatrix({ row }) {
  const mtfRows = Array.isArray(row.dashboardSummary?.mtf)
    ? row.dashboardSummary.mtf
    : [];
  const filterEntries = Object.entries(row.dashboardSummary?.filterState || {})
    .filter(([, value]) => value !== undefined && value !== null)
    .slice(0, 6);
  const hasRows = mtfRows.length || filterEntries.length;

  return (
    <SignalDenseSection
      title="Gate Matrix"
      action={row.dashboardSummary?.timeframe || row.profileTimeframe || "runtime"}
      testId="signals-drilldown-gate-matrix"
    >
      {hasRows ? (
        <div style={{ display: "grid", gap: sp(6) }}>
          {mtfRows.map((entry) => (
            <div
              key={`${entry.timeframe}-${entry.required}-${entry.direction}`}
              style={{
                display: "grid",
                gridTemplateColumns: "42px 1fr 54px",
                gap: sp(8),
                alignItems: "center",
                minHeight: dim(28),
                color: CSS_COLOR.textSec,
                fontSize: textSize("captionStrong"),
              }}
            >
              <span style={{ color: CSS_COLOR.textMuted, fontWeight: FONT_WEIGHTS.label }}>
                {entry.timeframe}
              </span>
              <span style={{ color: toneForTrend(entry.direction), fontWeight: FONT_WEIGHTS.medium }}>
                {formatTrend(entry.direction)}
              </span>
              <span
                style={{
                  justifySelf: "end",
                  color: entry.required && !entry.pass ? CSS_COLOR.red : entry.pass ? CSS_COLOR.green : CSS_COLOR.textDim,
                  fontWeight: FONT_WEIGHTS.label,
                  textTransform: "uppercase",
                }}
              >
                {entry.required ? (entry.pass ? "pass" : "block") : "watch"}
              </span>
            </div>
          ))}
          {filterEntries.map(([key, value]) => {
            const failing = typeof value === "boolean" && !value;
            return (
              <div
                key={key}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(78px, 1fr) auto",
                  gap: sp(8),
                  alignItems: "center",
                  color: CSS_COLOR.textSec,
                  fontSize: textSize("captionStrong"),
                }}
              >
                <span style={{ ...cellTextStyle, color: CSS_COLOR.textMuted }}>
                  {formatEnumLabel(key)}
                </span>
                <span
                  style={{
                    color: failing ? CSS_COLOR.red : CSS_COLOR.textSec,
                    fontVariantNumeric: "tabular-nums",
                    fontWeight: FONT_WEIGHTS.medium,
                  }}
                >
                  {formatFilterValue(value)}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ color: CSS_COLOR.textDim, fontSize: textSize("body"), lineHeight: 1.35 }}>
          No dashboard gates are attached to this row yet.
        </div>
      )}
    </SignalDenseSection>
  );
}

function SignalProvenanceStrip({ row, onJumpToTrade, phone }) {
  const statusTone = toneForStatus(row.status);

  return (
    <div
      data-testid="signals-drilldown-provenance"
      style={{
        display: "grid",
        gridTemplateColumns: phone ? "1fr" : "minmax(0, 1fr) auto",
        gap: sp(10),
        alignItems: "center",
        minWidth: 0,
        border: `1px solid ${CSS_COLOR.border}`,
        borderRadius: dim(RADII.sm),
        background: CSS_COLOR.bg1,
        padding: sp(10),
      }}
    >
      <div style={{ display: "grid", gap: sp(6), minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            gap: sp(6),
            flexWrap: "wrap",
            minWidth: 0,
          }}
        >
          <Badge color={statusTone}>{row.statusLabel}</Badge>
          <Badge color={CSS_COLOR.textDim} variant="outline">
            {resolveSignalSourceLabel(row)}
          </Badge>
          <Badge color={CSS_COLOR.textDim} variant="outline">
            Rank {formatCount(row.universeRank)}
          </Badge>
        </div>
        {row.lastError ? (
          <div
            style={{
              display: "flex",
              gap: sp(8),
              alignItems: "flex-start",
              color: CSS_COLOR.red,
              fontSize: textSize("body"),
              lineHeight: 1.35,
            }}
          >
            <AlertTriangle size={15} strokeWidth={2} aria-hidden="true" />
            <span>{row.lastError}</span>
          </div>
        ) : (
          <div style={{ color: CSS_COLOR.textDim, fontSize: textSize("body") }}>
            {row.coverageReason}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => onJumpToTrade?.(row.symbol)}
        style={{
          ...textButtonStyle,
          justifySelf: phone ? "stretch" : "end",
          minWidth: dim(116),
        }}
      >
        <ExternalLink size={15} strokeWidth={2} aria-hidden="true" />
        Trade
      </button>
    </div>
  );
}

function SignalsHydrationStrip({
  active,
  hydrated,
  missing,
  phone,
  priorityCount,
  timeframeHydration = [],
  total,
}) {
  const hasUniverse = total > 0;
  const ratio = hasUniverse ? hydrated / total : 0;
  const boundedRatio = Math.max(0, Math.min(1, ratio));
  const activeCount = hasUniverse ? Math.min(missing, toHydrationCount(active)) : 0;
  const complete = hasUniverse && missing === 0;
  const hydratedPercent = !hasUniverse
    ? 0
    : complete
      ? 100
      : Math.min(99, Math.floor(boundedRatio * 100));
  const tone = !hasUniverse ? CSS_COLOR.textDim : complete ? CSS_COLOR.green : CSS_COLOR.amber;
  const status = !hasUniverse
    ? "Hydration idle"
    : complete
      ? "Fully hydrated"
      : activeCount
        ? `Hydrating ${activeCount} active, ${missing} remaining`
        : `Hydrating ${missing} cells remaining`;
  const inlineStatus = !hasUniverse
    ? "Hydration idle"
    : complete
      ? "Fully hydrated"
      : activeCount
        ? `Hydrating ${missing} remaining · ${activeCount} active`
        : `Hydrating ${missing} remaining`;
  const timeframeRows = Array.isArray(timeframeHydration)
    ? timeframeHydration.filter((item) => item?.timeframe)
    : [];

  return (
    <div
      data-testid="signals-hydration-strip"
      style={{
        display: "grid",
        gap: sp(6),
        minWidth: 0,
        padding: sp("8px 10px"),
        borderBottom: `1px solid ${CSS_COLOR.border}`,
        background: CSS_COLOR.bg1,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "inline-flex",
          alignItems: "baseline",
          gap: sp(7),
          flexWrap: "wrap",
          minWidth: 0,
        }}
      >
        <span
          style={{
            ...cellTextStyle,
            color: tone,
            fontSize: textSize("bodyStrong"),
            fontWeight: FONT_WEIGHTS.medium,
            maxWidth: phone ? "none" : dim(240),
            whiteSpace: "nowrap",
          }}
        >
          {inlineStatus}
        </span>
        <span
          style={{
            ...cellTextStyle,
            color: CSS_COLOR.textDim,
            fontSize: textSize("caption"),
            whiteSpace: "nowrap",
          }}
        >
          {hasUniverse
            ? `${hydrated}/${total} cells · ${priorityCount} priority symbols`
            : "Waiting for monitor universe"}
        </span>
        <span
          style={{
            color: CSS_COLOR.textMuted,
            fontSize: textSize("captionStrong"),
            fontVariantNumeric: "tabular-nums",
            fontWeight: FONT_WEIGHTS.label,
            textTransform: "uppercase",
            whiteSpace: "nowrap",
          }}
        >
          {hasUniverse ? `${hydratedPercent}%` : "idle"}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: sp(6),
          flexWrap: "wrap",
          minWidth: 0,
        }}
      >
        {(timeframeRows.length
          ? timeframeRows
          : SIGNALS_TABLE_TIMEFRAMES.map((timeframe) => ({
              timeframe,
              hydrated: 0,
              missing: 0,
              requested: 0,
              aged: 0,
              total: 0,
            }))
        ).map((item) => {
          const frameTotal = toHydrationCount(item.total);
          const frameHydrated = Math.min(frameTotal, toHydrationCount(item.hydrated));
          const frameAged = Math.min(frameHydrated, toHydrationCount(item.aged));
          const frameMissing = Math.max(0, frameTotal - frameHydrated);
          const frameComplete = frameTotal > 0 && frameHydrated >= frameTotal;
          const framePercent = frameTotal
            ? frameComplete
              ? 100
              : Math.min(99, Math.floor((frameHydrated / frameTotal) * 100))
            : 0;
          const frameTone = !frameTotal
            ? CSS_COLOR.textDim
            : frameComplete
              ? CSS_COLOR.green
              : CSS_COLOR.amber;
          const frameSubLabel = [
            frameMissing ? `${frameMissing} missing` : "",
            frameAged ? `${frameAged} aged` : "",
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <span
              key={item.timeframe}
              data-testid={`signals-hydration-${item.timeframe}`}
              role="meter"
              aria-label={`${item.timeframe} ${framePercent} percent hydrated; ${frameHydrated} of ${frameTotal || 0} cells; ${frameMissing} missing; ${frameAged} aged`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={framePercent}
              title={`${item.timeframe}: ${frameHydrated}/${frameTotal || 0} hydrated, ${frameMissing} missing, ${frameAged} aged`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: sp(4),
                minWidth: 0,
                color: CSS_COLOR.textDim,
                fontSize: fs(9),
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap",
              }}
            >
              <span
                style={{
                  color: CSS_COLOR.textMuted,
                  fontWeight: FONT_WEIGHTS.label,
                  textTransform: "uppercase",
                }}
              >
                {String(item.timeframe).toUpperCase()}
              </span>
              <span
                style={{
                  color: frameTone,
                  fontWeight: FONT_WEIGHTS.label,
                }}
              >
                {frameTotal ? `${frameHydrated}/${frameTotal}` : "idle"}
              </span>
              {frameSubLabel ? (
                <span
                  style={{
                    ...cellTextStyle,
                    color: frameMissing ? CSS_COLOR.amber : CSS_COLOR.textDim,
                    fontSize: fs(9),
                  }}
                >
                  {frameSubLabel}
                </span>
              ) : null}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function SignalsRowDrilldown({ row, onJumpToTrade, phone }) {
  const rowSymbol = row?.symbol || "";
  const chartTimeframe = resolveSignalChartTimeframe(row);
  const barsQuery = useGetBars(
    {
      symbol: rowSymbol || "SPY",
      timeframe: chartTimeframe,
      limit: SIGNAL_DRILLDOWN_CHART_LIMIT,
      outsideRth: true,
      source: "trades",
      allowHistoricalSynthesis: true,
      brokerRecentWindowMinutes: chartTimeframe === "1d" ? undefined : 390,
    },
    {
        query: {
          ...BARS_QUERY_DEFAULTS,
          enabled: Boolean(rowSymbol),
          retry: false,
          staleTime: 60_000,
          refetchOnMount: false,
          refetchOnWindowFocus: false,
        },
      request: buildBarsRequestOptions(
        BARS_REQUEST_PRIORITY.visible,
        "signals-row-chart",
      ),
    },
  );

  if (!row) {
    return null;
  }

  const statusTone = toneForStatus(row.status);
  const directionTone = toneForDirection(row.direction);
  const directionRailTone =
    row.direction === "buy" || row.direction === "sell"
      ? `inset 3px 0 0 ${directionTone}`
      : "inset 3px 0 0 transparent";
  const matrixEntries = SIGNALS_TABLE_TIMEFRAMES.map((timeframe) => ({
    timeframe,
    state: row.matrixStatesByTimeframe?.[timeframe] || null,
  }));

  return (
    <div
      data-testid="signals-row-drilldown"
      data-signal-direction={row.direction || "none"}
      style={{
        height: "100%",
        minWidth: 0,
        display: "grid",
        overflow: "hidden",
        background: cssColorMix(statusTone, 5),
        borderTop: `1px solid ${cssColorMix(statusTone, 32)}`,
        borderBottom: `1px solid ${CSS_COLOR.border}`,
        boxShadow: directionRailTone,
      }}
    >
      <div
        style={{
          minWidth: 0,
          overflow: "auto",
          display: "grid",
          alignContent: "start",
          gap: sp(10),
          padding: phone ? sp(10) : sp("10px 12px 12px"),
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: phone ? "1fr" : "minmax(132px, 0.8fr) repeat(6, minmax(82px, 1fr))",
            minWidth: 0,
            border: `1px solid ${CSS_COLOR.border}`,
            borderRadius: dim(RADII.sm),
            background: CSS_COLOR.bg1,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              minWidth: 0,
              display: "grid",
              alignContent: "center",
              gap: sp(4),
              padding: sp("8px 10px"),
            }}
          >
            <span
              style={{
                color: CSS_COLOR.textMuted,
                fontSize: fs(10),
                fontWeight: FONT_WEIGHTS.label,
                letterSpacing: 0,
                textTransform: "uppercase",
              }}
            >
              Signal drilldown
            </span>
            <span
              style={{
                ...cellTextStyle,
                color: CSS_COLOR.text,
                fontSize: fs(phone ? 20 : 24),
                fontWeight: FONT_WEIGHTS.medium,
                lineHeight: 1,
              }}
            >
              {row.symbol}
            </span>
          </div>
          <SignalDenseFact label="Side" value={row.direction || "none"} tone={toneForDirection(row.direction)} />
          <SignalDenseFact label="Bars" value={formatBars(row.barsSinceSignal)} />
          <SignalDenseFact label="Signal" value={formatTime(row.currentSignalAt)} />
          <SignalDenseFact label="Price" value={formatCompactPrice(row.currentSignalPrice)} />
          <SignalDenseFact label="Latest Bar" value={formatTime(row.latestBarAt)} />
          <SignalDenseFact label="Evaluated" value={formatTime(row.lastEvaluatedAt)} />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: phone
              ? "1fr"
              : "minmax(410px, 1.35fr) minmax(250px, 0.82fr) minmax(280px, 0.95fr)",
            gap: sp(10),
            minWidth: 0,
            alignItems: "start",
          }}
        >
          <SignalContextChart row={row} barsQuery={barsQuery} timeframe={chartTimeframe} />
          <div style={{ display: "grid", gap: sp(10), minWidth: 0 }}>
            <SignalThesisRail row={row} />
            <SignalProvenanceStrip row={row} onJumpToTrade={onJumpToTrade} phone={phone} />
          </div>
          <div style={{ display: "grid", gap: sp(10), minWidth: 0 }}>
            <SignalIntervalMatrix matrixEntries={matrixEntries} />
            <SignalGateMatrix row={row} />
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div
      style={{
        color: CSS_COLOR.textMuted,
        fontSize: fs(10),
        fontWeight: FONT_WEIGHTS.label,
        letterSpacing: 0,
        textTransform: "uppercase",
      }}
    >
      {children}
    </div>
  );
}

export default function SignalsScreen({
  environment = "paper",
  watchlists = [],
  signalMonitorSymbols = [],
  signalMonitorProfile = null,
  signalMonitorProfileLoading = false,
  signalMonitorProfileError = null,
  signalMonitorState = null,
  signalMonitorStateLoaded = false,
  signalMonitorStateLoading = false,
  signalMonitorStateError = null,
  signalMonitorDataManagedByPlatform = false,
  signalMonitorEvents = [],
  signalMonitorEventsLoaded = false,
  signalMatrixStates = [],
  signalMatrixCoverage = null,
  isVisible = true,
  safeQaMode = false,
  onReadinessChange,
  onSelectSymbol,
  onJumpToTrade,
  onScanNow,
  onToggleMonitor,
  onChangeMonitorTimeframe,
  onChangeMonitorFreshWindowBars,
  onChangeMonitorMaxSymbols,
  onApplyPyrusSignalsSettings,
  onRequestSignalMatrixHydration,
}) {
  const viewport = useViewport();
  const compact = viewport.width > 0 && viewport.width < 980;
  const phone = viewport.width > 0 && viewport.width < 720;
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [directionFilter, setDirectionFilter] = useState("all");
  const [breadthHistoryRange, setBreadthHistoryRange] = useState("day");
  const [sortKey, setSortKey] = useState("priority");
  const [sortDirection, setSortDirection] = useState("asc");
  const [columnOrder, setColumnOrder] = useState(() =>
    normalizeSignalsColumnOrder(_initialState.signalsColumnOrder),
  );
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [expandedSymbol, setExpandedSymbol] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [matrixHydrationFullRequestReady, setMatrixHydrationFullRequestReady] =
    useState(false);
  const [signalSparklineBarsBySymbol, setSignalSparklineBarsBySymbol] = useState(
    EMPTY_SIGNAL_SPARKLINE_BARS,
  );
  const signalSparklineBarsBySymbolRef = useRef(EMPTY_SIGNAL_SPARKLINE_BARS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState(() =>
    resolveSignalMonitorSettingsDraft(DEFAULT_PYRUS_SIGNALS_SETTINGS),
  );
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsApplying, setSettingsApplying] = useState(false);
  const syncedSettingsSignatureRef = useRef("");
  const previousSignalDirectionsRef = useRef({});
  const [flippedSignalSymbols, setFlippedSignalSymbols] = useState(() => new Set());
  const active = isVisible !== false;
  const signalsTimingStagesRef = useRef(new Set());
  const signalsRouteDataStageDetailsRef = useRef(new Map());
  const signalsHydrationManifestScopeRef = useRef(environment);
  const [signalsHydrationManifestSymbols, setSignalsHydrationManifestSymbols] =
    useState([]);
  const markSignalsRouteDataTiming = useCallback((stage, detail = {}) => {
    if (signalsTimingStagesRef.current.has(stage)) {
      return;
    }
    signalsTimingStagesRef.current.add(stage);
    markRouteDataTiming("signals", stage, detail);
  }, []);
  const captureSignalsRouteDataStage = useCallback(
    (stage, compute, buildDetail = () => ({})) => {
      const startedAt = readSignalsRouteDataTimingNow();
      const value = compute();
      const computeMs = Math.max(
        0,
        Math.round(readSignalsRouteDataTimingNow() - startedAt),
      );
      signalsRouteDataStageDetailsRef.current.set(stage, {
        computeMs,
        ...buildDetail(value),
      });
      return value;
    },
    [],
  );
  const signalMonitorParams = useMemo(() => ({ environment }), [environment]);
  const signalMonitorBreadthHistoryParams = useMemo(
    () => ({ environment, range: breadthHistoryRange }),
    [breadthHistoryRange, environment],
  );
  const signalMonitorEventsParams = useMemo(
    () => ({ environment, limit: SIGNALS_EVENT_LIMIT }),
    [environment],
  );
  const providedSignalMonitorEvents = useMemo(
    () => (Array.isArray(signalMonitorEvents) ? signalMonitorEvents : []),
    [signalMonitorEvents],
  );
  const platformManagedSignalData = Boolean(signalMonitorDataManagedByPlatform);
  const hasProvidedSignalMonitorEvents = Boolean(
    platformManagedSignalData ||
      signalMonitorEventsLoaded ||
      providedSignalMonitorEvents.length,
  );
  const eventsQueryEnabled = Boolean(active && !hasProvidedSignalMonitorEvents);
  const profileQuery = useGetSignalMonitorProfile(signalMonitorParams, {
    query: {
      enabled: active && !platformManagedSignalData,
      staleTime: 15_000,
      retry: false,
    },
  });
  const stateQuery = useGetSignalMonitorState(signalMonitorParams, {
    query: {
      enabled: active && !platformManagedSignalData,
      staleTime: 10_000,
      refetchInterval: active && !platformManagedSignalData ? 15_000 : false,
      retry: false,
    },
  });
  const eventsQuery = useListSignalMonitorEvents(signalMonitorEventsParams, {
    query: {
      enabled: eventsQueryEnabled,
      staleTime: 10_000,
      refetchInterval: eventsQueryEnabled ? 15_000 : false,
      retry: false,
    },
  });
  const breadthHistoryQuery = useListSignalMonitorBreadthHistory(
    signalMonitorBreadthHistoryParams,
    {
      query: {
        enabled: active,
        staleTime: 15_000,
        refetchInterval: active ? 30_000 : false,
        retry: false,
      },
    },
  );
  const researchStatusQuery = useGetResearchStatus({
    query: {
      enabled: active && settingsOpen,
      staleTime: 30_000,
      retry: false,
    },
  });
  const effectiveStateData = platformManagedSignalData
    ? signalMonitorState
    : stateQuery.data;
  const effectiveStateFetched = platformManagedSignalData
    ? signalMonitorStateLoaded
    : stateQuery.isFetched;
  const effectiveStateLoading = platformManagedSignalData
    ? signalMonitorStateLoading
    : stateQuery.isLoading;
  const effectiveStateError = platformManagedSignalData
    ? signalMonitorStateError
    : stateQuery.error;
  const effectiveStateIsError = Boolean(effectiveStateError) || (
    !platformManagedSignalData && stateQuery.isError
  );
  const effectiveProfileData = platformManagedSignalData
    ? signalMonitorProfile
    : profileQuery.data;
  const effectiveProfileLoading = platformManagedSignalData
    ? signalMonitorProfileLoading
    : profileQuery.isLoading;
  const effectiveProfileError = platformManagedSignalData
    ? signalMonitorProfileError
    : profileQuery.error;
  const effectiveProfileIsError = Boolean(effectiveProfileError) || (
    !platformManagedSignalData && profileQuery.isError
  );
  const profile = effectiveStateData?.profile || effectiveProfileData || null;
  const profileIndicatorSettings = useMemo(
    () => resolveSignalMonitorSettingsDraft(profile?.pyrusSignalsSettings || {}),
    [profile?.pyrusSignalsSettings],
  );
  const profileIndicatorSettingsSignature = useMemo(
    () => settingsSignature(profileIndicatorSettings),
    [profileIndicatorSettings],
  );
  const stateResponse = useMemo(
    () =>
      captureSignalsRouteDataStage(
        "state-response-ready",
        () => {
          if (effectiveStateData) {
            return {
              ...effectiveStateData,
              universeSymbols: effectiveStateData.universeSymbols?.length
                ? effectiveStateData.universeSymbols
                : signalMonitorSymbols,
            };
          }
          return {
            profile,
            states: [],
            universeSymbols: signalMonitorSymbols,
            skippedSymbols: [],
            universe: null,
          };
        },
        (value) => ({
          source: effectiveStateData
            ? platformManagedSignalData
              ? "platform"
              : "query"
            : "fallback",
          states: Array.isArray(value?.states) ? value.states.length : 0,
          universeSymbols: Array.isArray(value?.universeSymbols)
            ? value.universeSymbols.length
            : 0,
          skippedSymbols: Array.isArray(value?.skippedSymbols)
            ? value.skippedSymbols.length
            : 0,
        }),
      ),
    [
      captureSignalsRouteDataStage,
      effectiveStateData,
      profile,
      platformManagedSignalData,
      signalMonitorSymbols,
    ],
  );
  const stateResponseReady = Boolean(
    effectiveStateData ||
      effectiveStateFetched ||
      !effectiveStateLoading ||
      signalMonitorSymbols.length ||
      signalMatrixStates.length,
  );
  useEffect(() => {
    if (!active || !stateResponseReady) {
      return;
    }
    markSignalsRouteDataTiming("state-response-ready", {
      ...(signalsRouteDataStageDetailsRef.current.get("state-response-ready") || {}),
      states: Array.isArray(stateResponse.states)
        ? stateResponse.states.length
        : 0,
      universeSymbols: Array.isArray(stateResponse.universeSymbols)
        ? stateResponse.universeSymbols.length
        : 0,
    });
  }, [
    active,
    markSignalsRouteDataTiming,
    stateResponse.states,
    stateResponse.universeSymbols,
    stateResponseReady,
  ]);
  const signalsHydrationSourceUniverseSymbols = useMemo(
    () =>
      stateResponse.universeSymbols?.length
        ? stateResponse.universeSymbols
        : signalMonitorSymbols,
    [signalMonitorSymbols, stateResponse.universeSymbols],
  );
  useEffect(() => {
    if (!active) {
      return;
    }
    setSignalsHydrationManifestSymbols((currentSymbols) => {
      const reset =
        signalsHydrationManifestScopeRef.current !== environment;
      signalsHydrationManifestScopeRef.current = environment;
      const nextSymbols = buildSignalsHydrationManifest({
        currentSymbols,
        nextSymbols: signalsHydrationSourceUniverseSymbols,
        reset,
      });
      if (
        nextSymbols.length === currentSymbols.length &&
        nextSymbols.every((symbol, index) => symbol === currentSymbols[index])
      ) {
        return currentSymbols;
      }
      return nextSymbols;
    });
  }, [
    active,
    environment,
    signalsHydrationSourceUniverseSymbols,
  ]);
  const signalsHydrationUniverseSymbols = signalsHydrationManifestSymbols.length
    ? signalsHydrationManifestSymbols
    : signalsHydrationSourceUniverseSymbols;
  const signalEventsForRows = useMemo(
    () =>
      hasProvidedSignalMonitorEvents
        ? providedSignalMonitorEvents.slice(0, SIGNALS_EVENT_LIMIT)
        : eventsQuery.data?.events || [],
    [
      eventsQuery.data?.events,
      hasProvidedSignalMonitorEvents,
      providedSignalMonitorEvents,
    ],
  );
  const signalEventsBySymbol = useMemo(
    () =>
      captureSignalsRouteDataStage(
        "events-by-symbol-ready",
        () => buildSignalEventsBySymbol(signalEventsForRows),
        (value) => ({
          events: signalEventsForRows.length,
          source: hasProvidedSignalMonitorEvents
            ? "provided"
            : eventsQuery.data
              ? "query"
              : "fallback",
          symbols: value?.size || 0,
        }),
      ),
    [
      captureSignalsRouteDataStage,
      eventsQuery.data,
      hasProvidedSignalMonitorEvents,
      signalEventsForRows,
    ],
  );
  const signalEventsReady = Boolean(
    hasProvidedSignalMonitorEvents ||
      !eventsQueryEnabled ||
      eventsQuery.data ||
      eventsQuery.isFetched ||
      !eventsQuery.isLoading,
  );
  useEffect(() => {
    if (!active || !signalEventsReady) {
      return;
    }
    markSignalsRouteDataTiming("events-by-symbol-ready", {
      ...(signalsRouteDataStageDetailsRef.current.get("events-by-symbol-ready") || {}),
      events: signalEventsForRows.length,
      symbols: signalEventsBySymbol.size || 0,
    });
  }, [
    active,
    markSignalsRouteDataTiming,
    signalEventsBySymbol,
    signalEventsForRows.length,
    signalEventsReady,
  ]);
  const rows = useMemo(
    () =>
      captureSignalsRouteDataStage(
        "rows-built",
        () =>
          buildSignalsRows({
            stateResponse,
            matrixStates: signalMatrixStates,
            events: signalEventsForRows,
            watchlists,
          }),
        (value) => ({
          events: signalEventsForRows.length,
          matrixStates: signalMatrixStates.length,
          rows: value.length,
          states: Array.isArray(stateResponse?.states)
            ? stateResponse.states.length
            : 0,
          watchlists: watchlists.length,
        }),
      ),
    [
      captureSignalsRouteDataStage,
      signalEventsForRows,
      signalMatrixStates,
      stateResponse,
      watchlists,
    ],
  );
  const signalsRowsReady = Boolean(stateResponseReady && signalEventsReady);
  useEffect(() => {
    if (!active || !signalsRowsReady) {
      return;
    }
    markSignalsRouteDataTiming("rows-built", {
      ...(signalsRouteDataStageDetailsRef.current.get("rows-built") || {}),
      rows: rows.length,
    });
  }, [
    active,
    markSignalsRouteDataTiming,
    rows.length,
    signalsRowsReady,
  ]);
  useEffect(() => {
    if (!active || !signalsRowsReady) {
      return;
    }
    const flipState = resolveSignalDirectionFlipStates(
      rows,
      previousSignalDirectionsRef.current,
    );
    previousSignalDirectionsRef.current = flipState.nextDirectionsBySymbol;
    setFlippedSignalSymbols((current) => {
      if (
        current.size === flipState.flippedSymbols.size &&
        Array.from(current).every((symbol) => flipState.flippedSymbols.has(symbol))
      ) {
        return current;
      }
      return flipState.flippedSymbols;
    });
  }, [active, rows, signalsRowsReady]);
  useEffect(() => {
    if (!flippedSignalSymbols.size) {
      return undefined;
    }
    const timeout = window.setTimeout(() => {
      setFlippedSignalSymbols(new Set());
    }, 1400);
    return () => window.clearTimeout(timeout);
  }, [flippedSignalSymbols]);
  const filteredRows = useMemo(
    () =>
      captureSignalsRouteDataStage(
        "rows-filtered-sorted",
        () =>
          sortSignalsRows(
            filterSignalsRows(rows, {
              query,
              status: statusFilter,
              direction: directionFilter,
            }),
            { sortKey, direction: sortDirection },
          ),
        (value) => ({
          direction: sortDirection,
          directionFilter,
          queryActive: Boolean(query.trim()),
          rows: value.length,
          sortKey,
          sourceRows: rows.length,
          statusFilter,
        }),
      ),
    [
      captureSignalsRouteDataStage,
      directionFilter,
      query,
      rows,
      sortDirection,
      sortKey,
      statusFilter,
    ],
  );
  useEffect(() => {
    if (!active || !signalsRowsReady) {
      return;
    }
    markSignalsRouteDataTiming("rows-filtered-sorted", {
      ...(signalsRouteDataStageDetailsRef.current.get("rows-filtered-sorted") || {}),
      rows: filteredRows.length,
      sourceRows: rows.length,
    });
  }, [
    active,
    filteredRows.length,
    markSignalsRouteDataTiming,
    rows.length,
    signalsRowsReady,
  ]);
  useEffect(() => {
    if (!active || !signalsRowsReady || !filteredRows.length) {
      setMatrixHydrationFullRequestReady(false);
      return undefined;
    }
    setMatrixHydrationFullRequestReady(false);
    return scheduleSignalsIdleWork(() => {
      setMatrixHydrationFullRequestReady(true);
    });
  }, [
    active,
    directionFilter,
    filteredRows.length,
    query,
    signalsRowsReady,
    sortDirection,
    sortKey,
    statusFilter,
  ]);
  const signalSparklineRows = useMemo(
    () =>
      captureSignalsRouteDataStage(
        "sparkline-rows-planned",
        () => {
          const sparklineSourceRows = filteredRows.slice(
            0,
            SIGNALS_TABLE_SPARKLINE_FETCH_ROW_LIMIT,
          );
          const rowSparklines = sparklineSourceRows
            .map((row) => ({
              key: signalSparklineRowKey(row.symbol),
              symbol: row.symbol,
            }))
            .filter((rowSparkline) => rowSparkline.key);
          return Array.from(
            new Map(
              rowSparklines.map((rowSparkline) => [
                rowSparkline.key,
                rowSparkline,
              ]),
            ).values(),
          );
        },
        (value) => ({
          sparklineRows: value.length,
          sourceRows: filteredRows.length,
          fetchRowLimit: SIGNALS_TABLE_SPARKLINE_FETCH_ROW_LIMIT,
          timeframe: SIGNALS_TABLE_SPARKLINE_HISTORY_TIMEFRAME,
        }),
      ),
    [captureSignalsRouteDataStage, filteredRows],
  );
  useEffect(() => {
    if (!active || !signalsRowsReady) {
      return;
    }
    markSignalsRouteDataTiming("sparkline-rows-planned", {
      ...(signalsRouteDataStageDetailsRef.current.get("sparkline-rows-planned") || {}),
      sparklineRows: signalSparklineRows.length,
      rows: filteredRows.length,
    });
  }, [
    active,
    filteredRows.length,
    markSignalsRouteDataTiming,
    signalSparklineRows.length,
    signalsRowsReady,
  ]);
  const signalSparklineRowsKey = useMemo(
    () => signalSparklineRows.map((row) => row.key).join(","),
    [signalSparklineRows],
  );
  const signalSparklineFetchReady = Boolean(
    active &&
      !effectiveStateLoading &&
      !effectiveProfileLoading &&
      signalSparklineRows.length,
  );
  useEffect(() => {
    signalSparklineBarsBySymbolRef.current = signalSparklineBarsBySymbol;
  }, [signalSparklineBarsBySymbol]);
  useEffect(() => {
    if (!signalSparklineFetchReady) {
      setSignalSparklineBarsBySymbol(EMPTY_SIGNAL_SPARKLINE_BARS);
      return undefined;
    }

    const controller = new AbortController();
    const activeKeys = new Set(signalSparklineRows.map((row) => row.key));
    const currentCache = signalSparklineBarsBySymbolRef.current || EMPTY_SIGNAL_SPARKLINE_BARS;
    const rowsNeedingFetch = signalSparklineRows.filter(
      (row) => !Object.prototype.hasOwnProperty.call(currentCache, row.key),
    );
    const batches = chunkSignalSparklineRows(
      rowsNeedingFetch,
      SIGNALS_TABLE_SPARKLINE_BATCH_SIZE,
    );
    let cancelled = false;
    let nextBatchIndex = 0;

    setSignalSparklineBarsBySymbol((current) => {
      const entries = Object.entries(current).filter(([key]) =>
        activeKeys.has(key),
      );
      const next = entries.length ? Object.fromEntries(entries) : {};
      rowsNeedingFetch.forEach((row) => {
        if (!Object.prototype.hasOwnProperty.call(next, row.key)) {
          next[row.key] = [];
        }
      });
      const nextCache = Object.keys(next).length
        ? next
        : EMPTY_SIGNAL_SPARKLINE_BARS;
      signalSparklineBarsBySymbolRef.current = nextCache;
      return nextCache;
    });

    if (!rowsNeedingFetch.length) {
      return undefined;
    }

    const runBatchWorker = async () => {
      while (!cancelled && !controller.signal.aborted && nextBatchIndex < batches.length) {
        const batchIndex = nextBatchIndex;
        nextBatchIndex += 1;
        const batch = batches[batchIndex];
        try {
          const items = await fetchSignalSparklineBarsBatch(
            batch,
            controller.signal,
          );
          if (cancelled || controller.signal.aborted) {
            return;
          }
          setSignalSparklineBarsBySymbol((current) => {
            const next = { ...current };
            items.forEach((item) => {
              if (!activeKeys.has(item?.key)) return;
              next[item.key] =
                item?.status === "fulfilled"
                  ? thinBarsForSignalsTableSparkline(item.bars || [])
                  : [];
            });
            return next;
          });
        } catch {
          if (cancelled || controller.signal.aborted) {
            return;
          }
          setSignalSparklineBarsBySymbol((current) => {
            const next = { ...current };
            batch.forEach((row) => {
              next[row.key] = [];
            });
            return next;
          });
        }
      }
    };

    const workerCount = Math.max(
      1,
      Math.min(SIGNALS_TABLE_SPARKLINE_BATCH_CONCURRENCY, batches.length),
    );
    void Promise.allSettled(
      Array.from({ length: workerCount }, runBatchWorker),
    );

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    signalSparklineFetchReady,
    signalSparklineRowsKey,
  ]);
  const signalSparklinePointsBySymbol = useMemo(() => {
    const entries = Object.entries(signalSparklineBarsBySymbol)
      .map(([symbolKey, bars]) => [
        symbolKey,
        extractSparklinePoints(bars),
      ])
      .filter(([, points]) => points.length >= 2);
    return entries.length
      ? Object.fromEntries(entries)
      : EMPTY_SIGNAL_SPARKLINE_POINTS;
  }, [signalSparklineBarsBySymbol]);
  useEffect(() => {
    persistState({
      signalsColumnOrder: normalizeSignalsColumnOrder(columnOrder),
    });
  }, [columnOrder]);
  const handleSignalsSortChange = useCallback(
    (nextSortKey) => {
      setSortKey((currentSortKey) => {
        if (currentSortKey === nextSortKey) {
          setSortDirection((currentDirection) =>
            currentDirection === "asc" ? "desc" : "asc",
          );
          return currentSortKey;
        }
        setSortDirection("asc");
        return nextSortKey;
      });
    },
    [],
  );
  const handleSignalsColumnOrderChange = useCallback(
    (_nextColumnIds, meta = {}) => {
      setColumnOrder((current) =>
        reorderColumnOrder(
          current,
          meta.activeColumnId,
          meta.overColumnId,
          {
            fallbackColumnIds: SIGNALS_COLUMN_IDS,
            lockedColumnIds: SIGNALS_LOCKED_COLUMN_IDS,
            validColumnIds: SIGNALS_COLUMN_IDS,
          },
        ),
      );
    },
    [],
  );
  const priorityHydrationSymbols = useMemo(
    () => {
      const candidateSymbols = [
        selectedSymbol,
        expandedSymbol,
        ...filteredRows
          .slice(0, SIGNALS_MATRIX_INITIAL_HYDRATION_SYMBOL_LIMIT)
          .map((row) => row.symbol),
      ];
      return buildSignalsPriorityHydrationSymbols({
        selectedSymbol,
        expandedSymbol,
        candidateSymbols,
        scopeSymbols: signalsHydrationUniverseSymbols,
      });
    },
    [
      expandedSymbol,
      filteredRows,
      selectedSymbol,
      signalsHydrationUniverseSymbols,
    ],
  );
  const matrixHydrationSymbolChunkLimit =
    SIGNALS_MATRIX_INITIAL_HYDRATION_SYMBOL_LIMIT;
  const matrixHydrationPlan = useMemo(
    () =>
      captureSignalsRouteDataStage(
        "matrix-hydration-plan-ready",
        () =>
          buildSignalsMatrixHydrationPlan({
            symbols: signalsHydrationUniverseSymbols,
            prioritySymbols: priorityHydrationSymbols,
            currentStates: [
              ...signalMatrixStates,
              ...(stateResponse?.states || []),
            ],
            timeframes: SIGNALS_TABLE_TIMEFRAMES,
            chunkSize: matrixHydrationSymbolChunkLimit,
            priorityChunkSize: matrixHydrationSymbolChunkLimit,
          }),
        (value) => ({
          deferred: !matrixHydrationFullRequestReady,
          hydratedCells: value.hydratedCellCount,
          missingCells: value.missingCellCount,
          prioritySymbols: priorityHydrationSymbols.length,
          requestCells: value.requestCells.length,
          requestSymbols: value.requestSymbols.length,
          symbols: value.symbols.length,
          totalCells: value.totalCellCount,
        }),
      ),
    [
      captureSignalsRouteDataStage,
      matrixHydrationFullRequestReady,
      matrixHydrationSymbolChunkLimit,
      priorityHydrationSymbols,
      signalMatrixStates,
      signalsHydrationUniverseSymbols,
      stateResponse?.states,
    ],
  );
  useEffect(() => {
    if (!active || !stateResponseReady) {
      return;
    }
    markSignalsRouteDataTiming("matrix-hydration-plan-ready", {
      ...(signalsRouteDataStageDetailsRef.current.get("matrix-hydration-plan-ready") || {}),
      deferred: !matrixHydrationFullRequestReady,
      missingCells: matrixHydrationPlan.missingCellCount,
      requestCells: matrixHydrationPlan.requestCells.length,
      symbols: matrixHydrationPlan.symbols.length,
    });
  }, [
    active,
    markSignalsRouteDataTiming,
    matrixHydrationFullRequestReady,
    matrixHydrationPlan.missingCellCount,
    matrixHydrationPlan.requestCells.length,
    matrixHydrationPlan.symbols.length,
    stateResponseReady,
  ]);
  const matrixHydrationRequestKey = useMemo(
    () =>
      matrixHydrationPlan.requestCells
        .map((cell) => `${cell.symbol}:${cell.timeframe}`)
        .join(","),
    [matrixHydrationPlan.requestCells],
  );
  const matrixHydrationRequestTimeframes =
    matrixHydrationPlan.timeframes;
  const matrixHydrationRequestMaterializesPending =
    matrixHydrationPlan.priorityMissingSymbols.length > 0;
  const summary = useMemo(() => summarizeSignalsRows(rows), [rows]);
  const netBias = useMemo(() => summarizeSignalsNetBias(rows), [rows]);
  const timeframeSignalSummary = useMemo(
    () => summarizeSignalsTimeframeDirections(rows),
    [rows],
  );
  const breadthHistory = useMemo(
    () => normalizeSignalsBreadthHistory(breadthHistoryQuery.data),
    [breadthHistoryQuery.data],
  );
  const selectedRow = useMemo(
    () =>
      filteredRows.find((row) => row.symbol === selectedSymbol) ||
      rows.find((row) => row.symbol === selectedSymbol) ||
      filteredRows[0] ||
      null,
    [filteredRows, rows, selectedSymbol],
  );
  useEffect(() => {
    onReadinessChange?.({
      primaryReady: Boolean(active),
      derivedReady: Boolean(active),
      backgroundAllowed: Boolean(active),
    });
  }, [active, onReadinessChange]);

  useEffect(() => {
    if (
      !active ||
      !matrixHydrationPlan.symbols.length ||
      !matrixHydrationPlan.missingCellCount
    ) {
      return;
    }

    onRequestSignalMatrixHydration?.({
      symbols: matrixHydrationPlan.symbols,
      prioritySymbols: matrixHydrationPlan.requestSymbols,
      missingSymbols: matrixHydrationPlan.missingSymbols,
      missingTimeframesBySymbol: matrixHydrationPlan.missingTimeframesBySymbol,
      requestSymbols: matrixHydrationPlan.requestSymbols,
      requestCells: matrixHydrationPlan.requestCells,
      timeframes: matrixHydrationRequestTimeframes,
      materializePendingCells: matrixHydrationRequestMaterializesPending,
      reason: matrixHydrationFullRequestReady
        ? "signals-screen"
        : "signals-screen-initial",
    });
  }, [
    active,
    matrixHydrationFullRequestReady,
    matrixHydrationPlan.missingCellCount,
    matrixHydrationPlan.missingSymbols,
    matrixHydrationPlan.missingTimeframesBySymbol,
    matrixHydrationPlan.requestCells,
    matrixHydrationPlan.requestSymbols,
    matrixHydrationPlan.symbols.length,
    matrixHydrationPlan.symbols,
    matrixHydrationRequestMaterializesPending,
    matrixHydrationRequestTimeframes,
    matrixHydrationRequestKey,
    onRequestSignalMatrixHydration,
  ]);

  useEffect(() => {
    if (!selectedSymbol && filteredRows[0]?.symbol) {
      setSelectedSymbol(filteredRows[0].symbol);
    }
  }, [filteredRows, selectedSymbol]);

  useEffect(() => {
    if (
      expandedSymbol &&
      !filteredRows.some((row) => row.symbol === expandedSymbol)
    ) {
      setExpandedSymbol("");
    }
  }, [expandedSymbol, filteredRows]);

  useEffect(() => {
    if (settingsDirty || settingsApplying) return;
    if (syncedSettingsSignatureRef.current === profileIndicatorSettingsSignature) {
      return;
    }
    setSettingsDraft(profileIndicatorSettings);
    syncedSettingsSignatureRef.current = profileIndicatorSettingsSignature;
  }, [
    profileIndicatorSettings,
    profileIndicatorSettingsSignature,
    settingsApplying,
    settingsDirty,
  ]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    onRequestSignalMatrixHydration?.({
      symbols: matrixHydrationPlan.symbols,
      prioritySymbols: matrixHydrationPlan.requestSymbols,
      missingSymbols: matrixHydrationPlan.missingSymbols,
      missingTimeframesBySymbol: matrixHydrationPlan.missingTimeframesBySymbol,
      requestSymbols: matrixHydrationPlan.requestSymbols,
      requestCells: matrixHydrationPlan.requestCells,
      timeframes: matrixHydrationRequestTimeframes,
      materializePendingCells: matrixHydrationRequestMaterializesPending,
      reason: "signals-refresh",
      force: true,
    });
    Promise.allSettled([
      breadthHistoryQuery.refetch(),
      profileQuery.refetch(),
      stateQuery.refetch(),
      eventsQuery.refetch(),
    ]).finally(() => setRefreshing(false));
  }, [
    breadthHistoryQuery,
    eventsQuery,
    matrixHydrationPlan.missingSymbols,
    matrixHydrationPlan.missingTimeframesBySymbol,
    matrixHydrationPlan.requestCells,
    matrixHydrationPlan.requestSymbols,
    matrixHydrationPlan.symbols,
    matrixHydrationRequestMaterializesPending,
    matrixHydrationRequestTimeframes,
    onRequestSignalMatrixHydration,
    profileQuery,
    stateQuery,
  ]);

  const handleRowSelect = useCallback(
    (row) => {
      setSelectedSymbol(row.symbol);
      setExpandedSymbol((current) =>
        current === row.symbol ? "" : row.symbol,
      );
      onSelectSymbol?.(row.symbol);
    },
    [onSelectSymbol],
  );

  const handleRowKeyDown = useCallback(
    (event, row) => {
      if (
        isNestedInteractiveTarget(event) ||
        (event.key !== "Enter" && event.key !== " ")
      ) {
        return;
      }
      event.preventDefault();
      handleRowSelect(row);
    },
    [handleRowSelect],
  );

  const patchSettingsDraft = useCallback((patch) => {
    setSettingsDraft((current) => ({
      ...current,
      ...patch,
    }));
    setSettingsDirty(true);
  }, []);

  const resetSettingsDraft = useCallback(() => {
    setSettingsDraft(profileIndicatorSettings);
    syncedSettingsSignatureRef.current = profileIndicatorSettingsSignature;
    setSettingsDirty(false);
  }, [profileIndicatorSettings, profileIndicatorSettingsSignature]);

  const applySettingsDraft = useCallback(async () => {
    setSettingsApplying(true);
    try {
      await onApplyPyrusSignalsSettings?.(settingsDraft);
      setSettingsDirty(false);
    } catch {
      setSettingsDirty(true);
    } finally {
      setSettingsApplying(false);
    }
  }, [onApplyPyrusSignalsSettings, settingsDraft]);
  const handleMonitorUniverseChange = useCallback(
    async (value) => {
      const nextSettings = {
        ...settingsDraft,
        [SIGNAL_MONITOR_UNIVERSE_SCOPE_KEY]: value,
      };
      setSettingsDraft(nextSettings);
      setSettingsApplying(true);
      try {
        await onApplyPyrusSignalsSettings?.(nextSettings);
        setSettingsDirty(false);
      } catch {
        setSettingsDirty(true);
      } finally {
        setSettingsApplying(false);
      }
    },
    [onApplyPyrusSignalsSettings, settingsDraft],
  );

  const baseColumns = useMemo(
    () => [
      {
        id: "symbol",
        header: "Ticker",
        meta: { width: phone ? "minmax(72px, 0.9fr)" : "minmax(96px, 0.85fr)" },
        cell: ({ row }) => {
          const item = row.original;
          const expanded = item.symbol === expandedSymbol;
          return (
            <button
              type="button"
              aria-expanded={expanded ? "true" : "false"}
              aria-controls={getSignalDrilldownId(item.symbol)}
              onClick={(event) => {
                event.stopPropagation();
                handleRowSelect(item);
              }}
              style={{
                width: "100%",
                minWidth: 0,
                display: "inline-flex",
                alignItems: "center",
                gap: sp(3),
                border: "none",
                background: "transparent",
                color: CSS_COLOR.text,
                cursor: "pointer",
                fontFamily: T.sans,
                padding: 0,
                textAlign: "left",
              }}
            >
              <ChevronDown
                size={13}
                strokeWidth={2}
                aria-hidden="true"
                style={{
                  color: expanded ? toneForStatus(item.status) : CSS_COLOR.textDim,
                  flex: "0 0 auto",
                  transform: expanded ? "rotate(0deg)" : "rotate(-90deg)",
                  transition: "transform 160ms ease-out, color 160ms ease-out",
                }}
              />
              <span
                style={{
                  ...cellTextStyle,
                  flex: "0 1 auto",
                  fontWeight: FONT_WEIGHTS.label,
                  letterSpacing: 0,
                }}
              >
                {item.symbol}
              </span>
            </button>
          );
        },
      },
      {
        id: "rank",
        header: "Rank",
        meta: { width: phone ? "58px" : "64px", align: "right" },
        cell: ({ row }) => (
          <span style={{ color: CSS_COLOR.textSec, fontVariantNumeric: "tabular-nums" }}>
            {formatCount(row.original.universeRank)}
          </span>
        ),
      },
      {
        id: "signal",
        header: "Signal",
        meta: { width: phone ? "minmax(96px, 1fr)" : "minmax(118px, 0.95fr)" },
        cell: ({ row }) => <StatusCell row={row.original} />,
      },
      {
        id: "stack",
        header: "Stack",
        meta: { width: phone ? "58px" : "64px" },
        cell: ({ row }) => <StackCell row={row.original} />,
      },
      {
        id: "verdict",
        header: "Verdict",
        meta: { width: phone ? "78px" : "84px" },
        cell: ({ row }) => <MatrixVerdictCell row={row.original} />,
      },
      ...SIGNALS_TABLE_TIMEFRAMES.map((timeframe) => ({
        id: `tf-${timeframe}`,
        header: timeframe,
        meta: { width: phone ? "70px" : "76px", align: "right" },
        cell: ({ row }) => {
          const symbolKey = signalSparklineRowKey(row.original.symbol);
          return (
            <CompactIntervalCell
              symbol={row.original.symbol}
              timeframe={timeframe}
              state={row.original.matrixStatesByTimeframe?.[timeframe] || null}
              rowDirection={row.original.direction}
              fallbackPrice={signalRowSparklineFallbackPrice(row.original)}
              sparklineData={signalSparklineBarsBySymbol[symbolKey] || []}
              sparklinePoints={signalSparklinePointsBySymbol[symbolKey] || null}
              signalEvents={
                signalEventsBySymbol.get(symbolKey) || EMPTY_SIGNAL_EVENTS
              }
            />
          );
        },
      })),
      {
        id: "trend",
        header: "Trend",
        meta: { width: phone ? "56px" : "58px" },
        cell: ({ row }) => <TrendCell row={row.original} />,
      },
      compact
        ? null
        : {
            id: "strength",
            header: "Str",
            meta: { width: "50px" },
            cell: ({ row }) => (
              <span style={{ ...cellTextStyle, color: CSS_COLOR.textSec }}>
                {row.original.dashboardSummary?.strength || MISSING_VALUE}
              </span>
            ),
          },
      compact
        ? null
        : {
            id: "age",
            header: "Age",
            meta: { width: "54px", align: "right" },
            cell: ({ row }) => (
              <span
                style={{
                  color: CSS_COLOR.textSec,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {formatAge(row.original.dashboardSummary)}
              </span>
            ),
          },
      compact
        ? null
        : {
            id: "vol",
            header: "Vol",
            meta: { width: "44px", align: "right" },
            cell: ({ row }) => (
              <span
                style={{
                  color: CSS_COLOR.textSec,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {formatMetric(row.original.dashboardSummary?.volatilityScore)}
              </span>
            ),
          },
      compact
        ? null
        : {
            id: "mtf",
            header: "MTF",
            meta: { width: "50px", align: "right" },
            cell: ({ row }) => <MtfCell row={row.original} />,
          },
      {
        id: "bars",
        header: "Bars",
        meta: { width: phone ? "50px" : "58px", align: "right" },
        cell: ({ row }) => (
          <span style={{ color: CSS_COLOR.textSec, fontVariantNumeric: "tabular-nums" }}>
            {formatBars(row.original.barsSinceSignal)}
          </span>
        ),
      },
      compact
        ? null
        : {
            id: "price",
            header: "Price",
            meta: { width: "78px", align: "right" },
            cell: ({ row }) => (
              <span
                style={{
                  color: CSS_COLOR.textSec,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {formatQuotePrice(row.original.currentSignalPrice)}
              </span>
            ),
          },
      compact
        ? null
        : {
            id: "latest",
            header: "Latest",
            meta: { width: "76px" },
            cell: ({ row }) => (
              <span style={{ ...cellTextStyle, color: CSS_COLOR.textDim }}>
                {formatTime(
                  row.original.currentSignalAt || row.original.lastEvaluatedAt,
                )}
              </span>
            ),
          },
      compact
        ? null
        : {
            id: "coverage",
            header: "Coverage",
            meta: { width: "minmax(100px, 1fr)" },
            cell: ({ row }) => <CoverageCell row={row.original} />,
          },
      {
        id: "action",
        header: "",
        meta: { width: phone ? "34px" : "38px", align: "right" },
        cell: ({ row }) => (
          <AppTooltip content={`Open ${row.original.symbol} in Trade`}>
            <button
              type="button"
              aria-label={`Open ${row.original.symbol} in Trade`}
              onClick={(event) => {
                event.stopPropagation();
                onJumpToTrade?.(row.original.symbol);
              }}
              style={{
                ...iconButtonStyle,
                minWidth: dim(30),
                height: dim(26),
                color: CSS_COLOR.textSec,
              }}
            >
              <ExternalLink size={14} strokeWidth={2} aria-hidden="true" />
            </button>
          </AppTooltip>
        ),
      },
    ].filter(Boolean).map((column) => {
      const columnSortKey = SIGNALS_SORT_KEYS_BY_COLUMN_ID[column.id];
      const label = typeof column.header === "string" ? column.header : column.id;
      return {
        ...column,
        meta: {
          ...column.meta,
          label,
          reorderLocked: SIGNALS_LOCKED_COLUMN_IDS.includes(column.id),
          sortable: Boolean(columnSortKey),
          sortKey: columnSortKey,
          sortTitle: columnSortKey ? `Sort by ${label}` : undefined,
        },
      };
    }),
    [
      expandedSymbol,
      handleRowSelect,
      onJumpToTrade,
      compact,
      phone,
      signalEventsBySymbol,
      signalSparklineBarsBySymbol,
      signalSparklinePointsBySymbol,
    ],
  );
  const columns = useMemo(
    () =>
      captureSignalsRouteDataStage(
        "columns-ready",
        () => orderColumnsById(baseColumns, columnOrder),
        (value) => ({
          baseColumns: baseColumns.length,
          columns: value.length,
          phone,
        }),
      ),
    [baseColumns, captureSignalsRouteDataStage, columnOrder, phone],
  );
  useEffect(() => {
    if (!active || !columns.length) {
      return;
    }
    markSignalsRouteDataTiming("columns-ready", {
      ...(signalsRouteDataStageDetailsRef.current.get("columns-ready") || {}),
      columns: columns.length,
    });
  }, [
    active,
    columns.length,
    markSignalsRouteDataTiming,
  ]);

  const loading = effectiveStateLoading || (!profile && effectiveProfileLoading);
  const errored =
    effectiveStateIsError || effectiveProfileIsError || eventsQuery.isError;
  useEffect(() => {
    if (!active || loading || errored) {
      return;
    }
    markSignalsRouteDataTiming("table-ready", {
      columns: columns.length,
      filteredRows: filteredRows.length,
      rows: rows.length,
    });
  }, [
    active,
    columns.length,
    errored,
    filteredRows.length,
    loading,
    markSignalsRouteDataTiming,
    rows.length,
  ]);
  const signalsErrorCopy = useMemo(
    () =>
      describeUserFacingRuntimeError(
        effectiveStateError || effectiveProfileError || eventsQuery.error,
        {
          title: "Signals unavailable",
          detail: "Signal monitor data could not be loaded.",
          rateLimitedTitle: "Signals request delayed",
          safeQaTitle: "Signals data paused",
        },
      ),
    [
      effectiveProfileError,
      effectiveStateError,
      eventsQuery.error,
    ],
  );
  const cacheTone =
    effectiveStateData?.cacheStatus === "hit"
      ? CSS_COLOR.green
      : effectiveStateData?.cacheStatus === "stale"
        ? CSS_COLOR.amber
        : CSS_COLOR.textDim;
  const cacheIssues = collectDataIssuesFromRecord(
    {
      cacheStatus: effectiveStateData?.cacheStatus,
      status: effectiveStateData?.cacheStatus === "stale" ? "stale" : "ok",
      updatedAt:
        effectiveStateData?.updatedAt || effectiveStateData?.lastEvaluatedAt,
    },
    {
      valueLabel: "Signals cache",
      source: "signals monitor",
      nextAction:
        "Refresh or wait for the next monitor scan before treating cached signal data as current.",
    },
  );
  const matrixHydrationTotal = matrixHydrationPlan.totalCellCount;
  const matrixHydrationHydrated = matrixHydrationPlan.hydratedCellCount;
  const matrixHydrationMissing = matrixHydrationPlan.missingCellCount;
  const matrixHydrationActive = Math.min(
    matrixHydrationMissing,
    Math.max(
      toHydrationCount(signalMatrixCoverage?.optimisticPendingCellCount),
      toHydrationCount(signalMatrixCoverage?.pendingCellCount),
    ),
  );
  const matrixHydrationTone =
    matrixHydrationTotal > 0 && matrixHydrationMissing === 0
      ? CSS_COLOR.green
      : CSS_COLOR.amber;
  const matrixHydrationLabel = matrixHydrationTotal
    ? `Intervals ${matrixHydrationHydrated}/${matrixHydrationTotal}`
    : "Intervals idle";
  const minTableWidth = phone ? dim(900) : compact ? dim(1040) : dim(1360);
  const minTableHeight = phone
    ? SIGNALS_TABLE_MIN_HEIGHT_PHONE
    : compact
      ? SIGNALS_TABLE_MIN_HEIGHT_COMPACT
    : SIGNALS_TABLE_MIN_HEIGHT_DESKTOP;
  if (!active) {
    return null;
  }

  return (
    <section
      data-testid="signals-screen"
      style={{
        height: "100%",
        minHeight: 0,
        display: "grid",
        gridTemplateRows: `auto minmax(${dim(minTableHeight)}, 1fr)`,
        gap: sp(10),
        padding: phone ? sp(10) : sp(14),
        background: CSS_COLOR.bg0,
        color: CSS_COLOR.text,
        fontFamily: T.sans,
        overflowX: "hidden",
        overflowY: "auto",
        WebkitOverflowScrolling: "touch",
      }}
    >
      <header
        style={{
          display: "grid",
          gap: sp(10),
          minWidth: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: sp(12),
            flexWrap: "wrap",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                color: CSS_COLOR.textMuted,
                fontSize: fs(11),
                fontWeight: FONT_WEIGHTS.label,
                letterSpacing: 0,
                textTransform: "uppercase",
              }}
            >
              Pyrus Signals
            </div>
            <h1
              style={{
                margin: 0,
                color: CSS_COLOR.text,
                fontSize: phone ? fs(26) : fs(32),
                fontWeight: FONT_WEIGHTS.medium,
                letterSpacing: 0,
                lineHeight: 1.05,
              }}
            >
              Signals
            </h1>
          </div>
          <div style={{ display: "flex", gap: sp(8), alignItems: "center", flexWrap: "wrap" }}>
            <StatusPill
              color={profile?.enabled ? CSS_COLOR.green : CSS_COLOR.textDim}
              variant="outline"
            >
              {profile?.enabled ? "Monitor on" : "Monitor off"}
            </StatusPill>
            {effectiveStateData?.cacheStatus ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: sp(4) }}>
                <StatusPill color={cacheTone} variant="outline">
                  {effectiveStateData.cacheStatus}
                </StatusPill>
                <DataIssueInlineIcon issues={cacheIssues} side="bottom" align="center" />
              </span>
            ) : null}
            <StatusPill color={matrixHydrationTone} variant="outline">
              {matrixHydrationLabel}
            </StatusPill>
          </div>
        </div>

        <SignalsOverviewPanel
          breadthHistory={breadthHistory}
          breadthHistoryError={breadthHistoryQuery.error}
          breadthHistoryLoading={breadthHistoryQuery.isLoading}
          breadthHistoryRange={breadthHistoryRange}
          compact={compact}
          netBias={netBias}
          onBreadthHistoryRangeChange={setBreadthHistoryRange}
          phone={phone}
          summary={summary}
          timeframeSummaries={timeframeSignalSummary}
        />

        <Card
          data-testid="signals-toolbar"
          style={{
            display: "flex",
            gap: sp(8),
            alignItems: "end",
            flexWrap: "wrap",
            padding: sp(10),
          }}
        >
          <label
            style={{
              display: "inline-grid",
              gap: sp(4),
              minWidth: compact ? "100%" : dim(210),
              color: CSS_COLOR.textMuted,
              fontSize: fs(10),
              fontWeight: FONT_WEIGHTS.label,
              letterSpacing: 0,
              textTransform: "uppercase",
            }}
          >
            <span>Search</span>
            <span style={{ position: "relative", display: "block" }}>
              <Search
                size={14}
                strokeWidth={2}
                aria-hidden="true"
                style={{
                  position: "absolute",
                  left: dim(9),
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: CSS_COLOR.textMuted,
                }}
              />
              <SignalsTickerSearchInput
                value={query}
                onCommit={setQuery}
                style={selectStyle}
              />
            </span>
          </label>

          <FieldSelect
            label="Status"
            value={statusFilter}
            options={SIGNAL_STATUS_FILTERS}
            onChange={setStatusFilter}
          />
          <FieldSelect
            label="Side"
            value={directionFilter}
            options={DIRECTION_FILTERS}
            onChange={setDirectionFilter}
          />
          <FieldSelect
            label="Sort"
            value={sortKey}
            options={SORT_OPTIONS}
            onChange={handleSignalsSortChange}
          />
          <FieldSelect
            label="Timeframe"
            value={profile?.timeframe || "5m"}
            options={SIGNAL_TIMEFRAME_OPTIONS.map((timeframe) => ({
              value: timeframe,
              label: timeframe,
            }))}
            onChange={onChangeMonitorTimeframe}
          />
          <FieldSelect
            label="Universe"
            value={settingsDraft[SIGNAL_MONITOR_UNIVERSE_SCOPE_KEY]}
            options={SIGNAL_MONITOR_UNIVERSE_SCOPE_OPTIONS}
            onChange={handleMonitorUniverseChange}
            style={{ minWidth: dim(144) }}
          />
          <NumberField
            label="Fresh"
            value={profile?.freshWindowBars ?? 3}
            min={1}
            max={20}
            onCommit={onChangeMonitorFreshWindowBars}
          />
          <NumberField
            label="Limit"
            value={profile?.maxSymbols ?? 50}
            min={1}
            max={SIGNAL_MONITOR_MAX_SYMBOLS_LIMIT}
            onCommit={onChangeMonitorMaxSymbols}
          />
          <div style={{ display: "inline-flex", gap: sp(6), alignItems: "end" }}>
            <AppTooltip content="Indicator controls">
              <button
                type="button"
                aria-label="Toggle indicator controls"
                aria-expanded={settingsOpen ? "true" : "false"}
                onClick={() => setSettingsOpen((current) => !current)}
                style={{
                  ...iconButtonStyle,
                  color: settingsOpen ? CSS_COLOR.accent : CSS_COLOR.textSec,
                }}
              >
                <SlidersHorizontal size={15} strokeWidth={2} aria-hidden="true" />
              </button>
            </AppTooltip>
            <AppTooltip content={profile?.enabled ? "Turn monitor off" : "Turn monitor on"}>
              <button
                type="button"
                aria-label={profile?.enabled ? "Turn monitor off" : "Turn monitor on"}
                onClick={onToggleMonitor}
                style={{
                  ...iconButtonStyle,
                  color: profile?.enabled ? CSS_COLOR.green : CSS_COLOR.textDim,
                }}
              >
                <Power size={15} strokeWidth={2} aria-hidden="true" />
              </button>
            </AppTooltip>
            <AppTooltip content="Run scan">
              <button
                type="button"
                aria-label="Run signal scan"
                onClick={onScanNow}
                style={iconButtonStyle}
              >
                <ScanLine size={15} strokeWidth={2} aria-hidden="true" />
              </button>
            </AppTooltip>
            <AppTooltip content="Refresh">
              <button
                type="button"
                aria-label="Refresh signals"
                onClick={handleRefresh}
                style={{
                  ...iconButtonStyle,
                  color: refreshing ? CSS_COLOR.accent : CSS_COLOR.textSec,
                }}
              >
                <RefreshCw size={15} strokeWidth={2} aria-hidden="true" />
              </button>
            </AppTooltip>
          </div>
        </Card>
        {settingsOpen ? (
          <OperationalSettingsPanel
            applying={settingsApplying}
            draft={settingsDraft}
            dirty={settingsDirty}
            highBetaUniverseStatus={
              researchStatusQuery.data?.highBetaUniverse || null
            }
            onPatch={patchSettingsDraft}
            onApply={applySettingsDraft}
            onReset={resetSettingsDraft}
          />
        ) : null}
      </header>

      <div
        style={{
          minHeight: dim(minTableHeight),
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr)",
          gap: sp(10),
        }}
      >
        <Card
          noPad
          data-testid="signals-table-card"
          style={{
            minHeight: dim(minTableHeight),
            display: "grid",
            gridTemplateRows: "auto minmax(0, 1fr)",
            overflow: "hidden",
          }}
        >
          <SignalsHydrationStrip
            active={matrixHydrationActive}
            hydrated={matrixHydrationHydrated}
            missing={matrixHydrationMissing}
            phone={phone}
            priorityCount={priorityHydrationSymbols.length}
            timeframeHydration={matrixHydrationPlan.timeframeHydration}
            total={matrixHydrationTotal}
          />
          {errored ? (
            <DataUnavailableState
              title={signalsErrorCopy.title}
              detail={signalsErrorCopy.detail}
              variant="error"
              icon={<AlertTriangle size={22} strokeWidth={2} />}
              minHeight={240}
              fill
            />
          ) : loading ? (
            <DataUnavailableState
              title="Loading signals"
              detail="Fetching signal monitor state."
              loading
              loadingEndpoint="/api/signal-monitor/state"
              minHeight={240}
              fill
            />
          ) : (
            <div
              data-testid="signals-table-scroll-shell"
              style={{
                minWidth: 0,
                minHeight: 0,
                height: "100%",
                overflowX: "auto",
                overflowY: "hidden",
                WebkitOverflowScrolling: "touch",
              }}
            >
              <DenseVirtualTable
                columnOrder={columns.map((column) => column.id)}
                columns={columns}
                data={filteredRows}
                getRowId={(row) => row.id}
                lockedColumnIds={SIGNALS_LOCKED_COLUMN_IDS}
                rowHeight={phone ? 58 : 56}
                rowDetailHeight={phone ? 820 : compact ? 720 : 650}
                rowDetailTestId="signals-table-row-drilldown"
                minWidth={minTableWidth}
                onColumnOrderChange={handleSignalsColumnOrderChange}
                onSortChange={handleSignalsSortChange}
                isRowExpanded={(row) => row.symbol === expandedSymbol}
                renderRowDetail={(row) => (
                  <SignalsRowDrilldown
                    row={row}
                    onJumpToTrade={onJumpToTrade}
                    phone={phone}
                  />
                )}
                getRowDetailProps={(row) => ({
                  id: getSignalDrilldownId(row.symbol),
                  role: "region",
                  "aria-label": `${row.symbol} signal detail`,
                  style: {
                    minWidth: minTableWidth,
                    borderBottom: `1px solid ${CSS_COLOR.border}`,
                  },
                })}
                rowTestId="signals-table-row"
                sortState={{ id: sortKey, direction: sortDirection }}
                headerStyle={{
                  minWidth: minTableWidth,
                  minHeight: dim(34),
                  alignItems: "center",
                  columnGap: sp(2),
                  padding: sp("0 4px"),
                  borderBottom: `1px solid ${CSS_COLOR.border}`,
                  background: CSS_COLOR.bg2,
                  color: CSS_COLOR.textMuted,
                  fontSize: fs(10),
                  fontWeight: FONT_WEIGHTS.label,
                  letterSpacing: 0,
                  textTransform: "uppercase",
                }}
                getRowProps={(row) => {
                  const activeRow = row.symbol === selectedRow?.symbol;
                  const expandedRow = row.symbol === expandedSymbol;
                  const tone = toneForStatus(row.status);
                  const directionTone = toneForDirection(row.direction);
                  const directionRailTone =
                    row.direction === "buy" || row.direction === "sell"
                      ? `inset 3px 0 0 ${directionTone}`
                      : "inset 3px 0 0 transparent";
                  const flippedRow = flippedSignalSymbols.has(row.symbol);
                  return {
                    role: "button",
                    tabIndex: 0,
                    onClick: (event) => {
                      if (isNestedInteractiveTarget(event)) return;
                      handleRowSelect(row);
                    },
                    onKeyDown: (event) => handleRowKeyDown(event, row),
                    "aria-controls": getSignalDrilldownId(row.symbol),
                    "aria-expanded": expandedRow ? "true" : "false",
                    "aria-selected": activeRow ? "true" : "false",
                    "data-signal-direction": row.direction || "none",
                    "data-signal-flipped": flippedRow ? "true" : "false",
                    "data-matrix-hydrated-count": SIGNALS_TABLE_TIMEFRAMES.filter(
                      (timeframe) =>
                        isHydratedSignalMatrixState(
                          row.matrixStatesByTimeframe?.[timeframe],
                        ),
                    ).length,
                    "data-symbol": row.symbol,
                    style: {
                      minWidth: minTableWidth,
                      alignItems: "center",
                      columnGap: sp(2),
                      padding: sp("0 4px"),
                      borderBottom: `1px solid ${
                        expandedRow ? cssColorMix(tone, 42) : CSS_COLOR.border
                      }`,
                      background: expandedRow
                        ? cssColorMix(tone, 12)
                        : flippedRow
                          ? cssColorMix(directionTone, 14)
                          : activeRow
                            ? cssColorMix(tone, 8)
                            : row.fresh
                              ? cssColorMix(tone, 5)
                              : "transparent",
                      boxShadow: directionRailTone,
                      cursor: "pointer",
                      transition: "background-color 160ms ease-out, border-color 160ms ease-out, box-shadow 160ms ease-out",
                    },
                  };
                }}
                getCellProps={() => ({
                  style: {
                    padding: sp("0 2px"),
                    fontSize: textSize("body"),
                  },
                })}
                emptyState={
                  <DataUnavailableState
                    title="No matching signals"
                    detail="No tracked ticker matches the current filters."
                    icon={<ListFilter size={22} strokeWidth={2} />}
                    minHeight={220}
                    fill
                  />
                }
              />
            </div>
          )}
        </Card>
      </div>
    </section>
  );
}
