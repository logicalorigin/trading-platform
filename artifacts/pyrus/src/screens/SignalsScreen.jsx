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
  Bell,
  ChevronDown,
  Clock3,
  ExternalLink,
  ListFilter,
  Power,
  Radar,
  RefreshCw,
  ScanLine,
  Scale,
  Search,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
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
  Select,
  Skeleton,
  StatTile,
  StatusPill,
  TextField,
  extractSparklinePoints,
  surfaceStyle,
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
  TABLE_SPARKLINE_HEIGHT,
  TABLE_SPARKLINE_WIDTH,
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
import {
  classifyRequestHealth,
  requestHealthTone,
} from "../lib/requestHealthTone";
import { _initialState, persistState } from "../lib/workspaceState";
import {
  SIGNALS_ROW_STATUS,
  SIGNALS_TABLE_TIMEFRAMES,
  buildSignalsRows,
  filterSignalsRows,
  normalizeSignalsTicker,
  normalizeSignalsBreadthHistory,
  SIGNALS_BREADTH_HISTORY_RANGES,
  resolveSignalDirectionFlipStates,
  sortSignalsRows,
  summarizeSignalsNetBias,
  summarizeSignalsRows,
  summarizeSignalsTimeframeDirections,
} from "../features/signals/signalsRowModel.js";
import {
  boundSignalsRowsToUniverse,
  buildSignalsSourceScopeKey,
  signalsFiltersActive,
} from "../features/signals/signalsScope.js";
import {
  buildSignalsHydrationManifest,
  buildSignalsMatrixHydrationPlan,
} from "../features/signals/signalsMatrixHydration.js";
import {
  EMPTY_SIGNAL_EVENTS,
  buildSignalEventsBySymbol,
  buildSignalSparklinePointColors,
  defaultSignalSparklineColorForDirection,
  isSignalSparklineDirection,
  resolveSignalSparklineFallbackColor,
} from "../features/signals/signalSparklineModel.js";
import {
  getCurrentSignalDirection,
  isProblemSignalState,
  normalizeSignalStatus,
} from "../features/signals/signalStateFreshness.js";
import { useRuntimeTickerSnapshots } from "../features/platform/runtimeTickerStore";

const SIGNALS_EVENT_LIMIT = 250;
const SIGNAL_STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: SIGNALS_ROW_STATUS.activeFresh, label: "Fresh" },
  { value: SIGNALS_ROW_STATUS.activeIdle, label: "Idle" },
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

const isHydratedSignalMatrixState = (state) =>
  Boolean(state && isRenderableSignalMatrixState(state));
const isRenderableSignalMatrixState = (state) => {
  const status = normalizeSignalStatus(state);
  return Boolean(
    state?.active !== false &&
      (status === "ok" || status === "idle" || status === "stale") &&
      !state?.lastError &&
      (state?.latestBarAt || state?.currentSignalAt),
  );
};
const toHydrationCount = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
};
const SIGNAL_TIMEFRAME_OPTIONS = ["1m", "2m", "5m", "15m", "1h", "1d"];
// Mirror of the backend + PlatformApp SIGNAL_MONITOR_MAX_SYMBOLS_LIMIT; caps the "Limit"
// NumberField max. Raised 500 -> 2000 in lockstep with the backend cap.
const SIGNAL_MONITOR_MAX_SYMBOLS_LIMIT = 2000;
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
const EMPTY_SPARKLINE_SERIES = Object.freeze([]);
const SPARKLINE_FILL_STYLE = Object.freeze({ width: "100%", height: "100%" });
const SIGNALS_TABLE_MIN_HEIGHT_DESKTOP = 680;
const SIGNALS_TABLE_MIN_HEIGHT_COMPACT = 620;
const SIGNALS_TABLE_MIN_HEIGHT_PHONE = 560;

const readSignalsRouteDataTimingNow = () =>
  typeof performance !== "undefined" &&
  typeof performance.now === "function"
    ? performance.now()
    : Date.now();

// One shared 1m series per symbol drives every timeframe column's sparkline; the
// per-column signal coloring (not the underlying price line) is what differs, so
// a symbol-level cache key is all we fetch and store.
const signalSparklineRowKey = (symbol) =>
  String(symbol || "").trim().toUpperCase();

const hasDrawableSparkline = (bars) => extractSparklinePoints(bars).length >= 2;

const resolveRuntimeSignalSparklineBars = (snapshot) => {
  if (hasDrawableSparkline(snapshot?.sparkBars)) {
    return snapshot.sparkBars;
  }
  if (hasDrawableSparkline(snapshot?.spark)) {
    return snapshot.spark;
  }
  return EMPTY_SPARKLINE_SERIES;
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
    case SIGNALS_ROW_STATUS.activeIdle:
      return CSS_COLOR.cyan;
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
      return CSS_COLOR.amber;
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
  return <Select label={label} value={value} options={options} onChange={onChange} style={style} />;
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

function SignalsTickerSearchInput({ value, onCommit, compact = false }) {
  const { inputProps } = useDebouncedTextCommit({
    value,
    onCommit,
  });
  const { value: fieldValue, onChange, ...restInputProps } = inputProps;

  return (
    <TextField
      label="Search"
      placeholder="Ticker"
      value={fieldValue}
      onChange={onChange}
      leadingIcon={<Search size={14} strokeWidth={2} aria-hidden="true" />}
      inputProps={restInputProps}
      style={{ minWidth: compact ? "100%" : dim(210) }}
    />
  );
}

function DirectionBadge({ direction, stale = false }) {
  // A directional badge whose signal is not currently fresh (stale / aged /
  // idle with a latched direction) recolors the whole arrow amber in its
  // last-known direction, matching the SignalDots MTF matrix. Direction
  // otherwise drives the color (buy = blue, sell = red).
  const isDirectional = direction === "buy" || direction === "sell";
  const tone = stale && isDirectional ? CSS_COLOR.amber : toneForDirection(direction);
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

// Horizontal proportion bar (active/inactive, fresh/aged …). Segments sit on a
// muted track so a zero-width segment simply doesn't paint.
function SignalsSplitBar({ segments = [] }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: "100%",
        maxWidth: dim(96),
        height: dim(6),
        borderRadius: dim(RADII.pill),
        overflow: "hidden",
        display: "flex",
        background: CSS_COLOR.bg3,
      }}
    >
      {segments.map((segment, index) =>
        segment.pct > 0 ? (
          <span
            key={index}
            style={{
              width: `${segment.pct}%`,
              height: "100%",
              background: segment.color,
            }}
          />
        ) : null,
      )}
    </span>
  );
}

// Attention readout: one dot per item, high-severity first, capped with a +N
// overflow so a large backlog never blows out the card width.
function SignalsAttentionDots({ high = 0, medium = 0, max = 8 }) {
  const dots = [
    ...Array(Math.max(0, high)).fill(CSS_COLOR.red),
    ...Array(Math.max(0, medium)).fill(CSS_COLOR.amber),
  ];
  if (!dots.length) {
    return (
      <span style={{ color: CSS_COLOR.textDim, fontSize: fs(9), whiteSpace: "nowrap" }}>
        clear
      </span>
    );
  }
  const shown = dots.slice(0, max);
  const overflow = dots.length - shown.length;
  return (
    <span style={{ display: "flex", alignItems: "center", gap: sp(4), minWidth: 0 }}>
      {shown.map((color, index) => (
        <span
          key={index}
          style={{
            width: dim(7),
            height: dim(7),
            borderRadius: "50%",
            background: color,
            flexShrink: 0,
          }}
        />
      ))}
      {overflow > 0 ? (
        <span
          style={{
            color: CSS_COLOR.textMuted,
            fontSize: fs(9),
            fontVariantNumeric: "tabular-nums",
            fontWeight: FONT_WEIGHTS.label,
          }}
        >
          +{formatCount(overflow)}
        </span>
      ) : null}
    </span>
  );
}

function SignalsOverviewMetric({
  icon: Icon = null,
  label,
  tone = CSS_COLOR.text,
  tooltip = null,
  value,
  viz = null,
}) {
  const card = (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: sp(6),
        minWidth: 0,
        padding: sp("8px 10px"),
        borderRadius: dim(RADII.sm),
        background: CSS_COLOR.bg2,
        boxShadow: `inset 0 0 0 1px ${CSS_COLOR.borderLight}`,
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: sp(5), minWidth: 0 }}>
        {Icon ? (
          <Icon
            size={dim(12)}
            strokeWidth={2}
            color={CSS_COLOR.textMuted}
            aria-hidden="true"
            style={{ flexShrink: 0 }}
          />
        ) : null}
        <span
          style={{
            color: CSS_COLOR.textMuted,
            fontSize: fs(9),
            fontWeight: FONT_WEIGHTS.label,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            ...cellTextStyle,
          }}
        >
          {label}
        </span>
      </span>
      <span
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: sp(8),
          minWidth: 0,
        }}
      >
        <span
          style={{
            color: tone,
            fontSize: fs(22),
            fontWeight: FONT_WEIGHTS.medium,
            fontVariantNumeric: "tabular-nums",
            lineHeight: 0.95,
            letterSpacing: "-0.01em",
            whiteSpace: "nowrap",
          }}
        >
          {value}
        </span>
        {viz ? (
          <span
            style={{
              flex: 1,
              minWidth: 0,
              height: dim(22),
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "flex-end",
            }}
          >
            {viz}
          </span>
        ) : null}
      </span>
    </div>
  );
  return tooltip ? <AppTooltip content={tooltip}>{card}</AppTooltip> : card;
}

function TimeframeSignalGroupedBars({
  summaries = [],
  pointsByTimeframe = null,
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
  // One shared ceiling across every card's history sparkline so a low-volume
  // timeframe reads as quieter than a busy one instead of each card self-scaling.
  const sparklineSeriesMax = Object.values(pointsByTimeframe || {}).reduce(
    (max, series) =>
      Array.isArray(series)
        ? series.reduce(
            (acc, point) =>
              Math.max(
                acc,
                Math.max(0, Number(point?.buy) || 0),
                Math.max(0, Number(point?.sell) || 0),
              ),
            max,
          )
        : max,
    0,
  );
  const columns = phone ? 2 : compact ? 3 : 6;

  return (
    <div
      data-testid="signals-timeframe-kpi-strip"
      aria-label="Buy and sell signals by timeframe"
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: sp(6),
        minWidth: 0,
      }}
    >
      {items.map((item) => {
        const buy = Math.max(0, Number(item.buy) || 0);
        const sell = Math.max(0, Number(item.sell) || 0);
        const total = buy + sell;
        const net = buy - sell;
        const idle = total === 0;
        const share = total ? Math.round((buy / total) * 100) : 0;
        const timeframe = String(item.timeframe || "").toUpperCase();
        const netTone =
          net > 0 ? CSS_COLOR.blue : net < 0 ? CSS_COLOR.red : CSS_COLOR.textMuted;
        const timeframeKey = String(item.timeframe || "").toLowerCase();
        const timeframeSeries = Array.isArray(pointsByTimeframe?.[timeframeKey])
          ? pointsByTimeframe[timeframeKey]
          : [];
        const hasTimeframeSpark =
          timeframeSeries.length >= 2 &&
          timeframeSeries.some(
            (point) => (Number(point.buy) || 0) > 0 || (Number(point.sell) || 0) > 0,
          );
        const peakBuy = hasTimeframeSpark
          ? Math.max(0, ...timeframeSeries.map((point) => Number(point.buy) || 0))
          : 0;
        const peakSell = hasTimeframeSpark
          ? Math.max(0, ...timeframeSeries.map((point) => Number(point.sell) || 0))
          : 0;
        const tooltipContent = hasTimeframeSpark
          ? `${timeframe}: ${formatCount(buy)} buy, ${formatCount(sell)} sell, ${formatCount(item.fresh || 0)} fresh · range peak ${formatCount(peakBuy)} buy / ${formatCount(peakSell)} sell`
          : `${timeframe}: ${formatCount(buy)} buy, ${formatCount(sell)} sell, ${formatCount(item.fresh || 0)} fresh`;
        return (
          <AppTooltip key={item.timeframe} content={tooltipContent}>
            <div
              data-testid={`signals-timeframe-kpi-${item.timeframe}`}
              data-buy-count={buy}
              data-sell-count={sell}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: sp(5),
                minWidth: 0,
                padding: sp("7px 8px"),
                border: `1px solid ${CSS_COLOR.borderLight}`,
                borderRadius: dim(RADII.sm),
                background: CSS_COLOR.bg2,
              }}
            >
              {/* header — timeframe + net badge */}
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: sp(4),
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    color: CSS_COLOR.text,
                    fontSize: fs(11),
                    fontWeight: FONT_WEIGHTS.emphasis,
                    letterSpacing: "0.02em",
                  }}
                >
                  {timeframe}
                </span>
                <span
                  style={{
                    color: netTone,
                    fontSize: fs(10),
                    fontWeight: FONT_WEIGHTS.medium,
                    fontVariantNumeric: "tabular-nums",
                    padding: sp("1px 5px"),
                    borderRadius: dim(RADII.xs),
                    background: CSS_COLOR.bg1,
                    border: `1px solid ${CSS_COLOR.borderLight}`,
                    whiteSpace: "nowrap",
                  }}
                >
                  {idle ? "0" : `${net > 0 ? "+" : ""}${formatCount(net)}`}
                </span>
              </span>
              {/* paired buy/sell bars */}
              <div
                aria-hidden="true"
                style={{
                  height: dim(46),
                  display: "flex",
                  alignItems: idle ? "center" : "flex-end",
                  justifyContent: "center",
                  gap: sp(8),
                }}
              >
                {idle ? (
                  <span style={{ fontSize: fs(9), color: CSS_COLOR.textDim }}>idle</span>
                ) : (
                  [
                    ["b", buy, CSS_COLOR.blue],
                    ["s", sell, CSS_COLOR.red],
                  ].map(([key, count, color]) => {
                    const height = Math.round((count / maxCount) * 100);
                    return (
                      <span
                        key={key}
                        style={{
                          flex: 1,
                          maxWidth: dim(34),
                          height: "100%",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "flex-end",
                          gap: sp(2),
                        }}
                      >
                        <span
                          style={{
                            fontSize: fs(9),
                            fontWeight: FONT_WEIGHTS.label,
                            color,
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {formatCount(count)}
                        </span>
                        <span
                          style={{
                            width: "100%",
                            height: "100%",
                            display: "flex",
                            alignItems: "flex-end",
                          }}
                        >
                          <span
                            style={{
                              width: "100%",
                              height: `${Math.max(count ? 6 : 0, height)}%`,
                              background: color,
                              borderRadius: `${dim(RADII.xs)}px ${dim(RADII.xs)}px 0 0`,
                            }}
                          />
                        </span>
                      </span>
                    );
                  })
                )}
              </div>
              {/* buy-share bar */}
              <div style={{ display: "flex", flexDirection: "column", gap: sp(3) }}>
                <span
                  aria-hidden="true"
                  style={{
                    height: dim(5),
                    borderRadius: dim(RADII.pill),
                    overflow: "hidden",
                    display: "flex",
                    background: idle ? CSS_COLOR.bg3 : CSS_COLOR.red,
                  }}
                >
                  {idle ? null : (
                    <span style={{ width: `${share}%`, height: "100%", background: CSS_COLOR.blue }} />
                  )}
                </span>
                <span
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: sp(4),
                    fontSize: fs(9),
                    fontVariantNumeric: "tabular-nums",
                    fontWeight: FONT_WEIGHTS.label,
                  }}
                >
                  <span style={{ color: CSS_COLOR.blue }}>B {formatCount(buy)}</span>
                  <span style={{ color: CSS_COLOR.textMuted }}>
                    {idle ? MISSING_VALUE : `${share}%`}
                  </span>
                  <span style={{ color: CSS_COLOR.red }}>S {formatCount(sell)}</span>
                </span>
              </div>
              {/* buy/sell signal counts over the selected range */}
              {hasTimeframeSpark ? (
                <div style={{ height: dim(20), minWidth: 0 }}>
                  <BuySellSparkline
                    points={timeframeSeries}
                    height={20}
                    scaleMax={sparklineSeriesMax}
                    ariaLabel={`${timeframe} buy and sell signals over time`}
                  />
                </div>
              ) : null}
            </div>
          </AppTooltip>
        );
      })}
    </div>
  );
}

// Floor for the buy/sell sparkline's vertical scale so a window with only a
// signal or two renders as a low, honest line instead of a full-height spike.
const SIGNALS_BREADTH_SPARKLINE_MIN_SCALE = 4;

// Two-line sparkline: buy (blue) and sell (red) signal counts over time. Both
// lines share one scale so their relative height reads directly. Returns null
// when there isn't enough varying data to plot.
function BuySellSparkline({
  points = [],
  showArea = false,
  ariaLabel = null,
  testId = null,
  height = 60,
  scaleMax = null,
  minScale = SIGNALS_BREADTH_SPARKLINE_MIN_SCALE,
}) {
  const series = Array.isArray(points) ? points : [];
  const buySeries = series.map((point) => Math.max(0, Number(point.buy) || 0));
  const sellSeries = series.map((point) => Math.max(0, Number(point.sell) || 0));
  const hasData =
    series.length >= 2 && (buySeries.some((v) => v > 0) || sellSeries.some((v) => v > 0));
  if (!hasData) {
    return null;
  }
  // Prefer a caller-supplied shared ceiling so sibling cards stay comparable;
  // otherwise scale to this series. The minScale floor keeps a lone signal from
  // filling the chart (a 1-vs-0 window shouldn't look like a cliff).
  const seriesMax = Math.max(...buySeries, ...sellSeries);
  const sharedMax = Number.isFinite(scaleMax) && scaleMax > 0 ? scaleMax : seriesMax;
  const maxMagnitude = Math.max(minScale, sharedMax);
  const count = series.length;
  // viewBox height tracks the rendered box so vertical units stay truthful
  // (preserveAspectRatio="none" only stretches the time axis).
  const viewHeight = Math.max(12, Math.round(Number(height) || 60));
  const baseY = viewHeight - 3;
  const usable = Math.max(1, baseY - 4);
  const toX = (index) => (count > 1 ? (index / (count - 1)) * 100 : 50);
  const toY = (value) => baseY - Math.min(1, value / maxMagnitude) * usable;
  const linePoints = (arr) =>
    arr.map((value, index) => `${toX(index).toFixed(1)},${toY(value).toFixed(1)}`).join(" ");
  const areaPath = (arr) =>
    `M0,${baseY} ` +
    arr.map((value, index) => `L${toX(index).toFixed(1)},${toY(value).toFixed(1)}`).join(" ") +
    ` L100,${baseY} Z`;
  return (
    <svg
      data-testid={testId || undefined}
      role="img"
      aria-label={ariaLabel || undefined}
      viewBox={`0 0 100 ${viewHeight}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height: "100%", display: "block", overflow: "visible" }}
    >
      {showArea ? (
        <>
          <defs>
            <linearGradient id="raSignalsBreadthBuy" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CSS_COLOR.blue} stopOpacity="0.28" />
              <stop offset="100%" stopColor={CSS_COLOR.blue} stopOpacity="0" />
            </linearGradient>
            <linearGradient id="raSignalsBreadthSell" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CSS_COLOR.red} stopOpacity="0.20" />
              <stop offset="100%" stopColor={CSS_COLOR.red} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath(sellSeries)} fill="url(#raSignalsBreadthSell)" />
          <path d={areaPath(buySeries)} fill="url(#raSignalsBreadthBuy)" />
        </>
      ) : null}
      <polyline
        points={linePoints(sellSeries)}
        fill="none"
        stroke={CSS_COLOR.red}
        strokeWidth={showArea ? "1.4" : "1.3"}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <polyline
        points={linePoints(buySeries)}
        fill="none"
        stroke={CSS_COLOR.blue}
        strokeWidth={showArea ? "1.7" : "1.5"}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function SignalsBreadthTotal({ value, tone, label }) {
  return (
    <div
      style={{
        flexShrink: 0,
        width: dim(76),
        height: dim(76),
        borderRadius: "50%",
        border: `2px solid ${tone}`,
        background: CSS_COLOR.bg1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: sp(2),
        padding: sp(4),
      }}
    >
      <span
        style={{
          color: tone,
          fontSize: fs(19),
          fontWeight: FONT_WEIGHTS.medium,
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1,
        }}
      >
        {formatCount(value)}
      </span>
      <span
        style={{
          fontSize: fs(7),
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: CSS_COLOR.textMuted,
          textAlign: "center",
          lineHeight: 1.2,
        }}
      >
        {label}
      </span>
    </div>
  );
}

const SIGNALS_BREADTH_RANGE_LABELS = {
  hour: "1H",
  day: "1D",
  week: "1W",
  month: "1M",
};

// Rings show the current (last-available) advancing/declining counts; the
// center plots how buy/sell signals have changed over the selected range.
function CompactSignalBreadthPanel({
  buy = 0,
  sell = 0,
  neutral = 0,
  netBias = null,
  points = [],
  range = "day",
  onRangeChange,
  phone = false,
}) {
  const advancing = Math.max(0, Number(buy) || 0);
  const declining = Math.max(0, Number(sell) || 0);
  const flat = Math.max(0, Number(neutral) || 0);
  const activeBuySell = advancing + declining;
  const advancingPct = activeBuySell ? Math.round((advancing / activeBuySell) * 100) : 0;
  const net = Number.isFinite(netBias?.net) ? netBias.net : advancing - declining;
  const direction = net > 0 ? "buy" : net < 0 ? "sell" : null;
  const netTone = toneForDirection(direction);
  const netLabel =
    direction === "buy"
      ? `Buy +${formatCount(Math.abs(net))}`
      : direction === "sell"
        ? `Sell +${formatCount(Math.abs(net))}`
        : activeBuySell
          ? "Balanced"
          : "Flat";

  const series = Array.isArray(points) ? points : [];
  const hasSeries =
    series.length >= 2 &&
    series.some((point) => (Number(point.buy) || 0) > 0 || (Number(point.sell) || 0) > 0);
  const peakBuy = hasSeries
    ? Math.max(0, ...series.map((point) => Number(point.buy) || 0))
    : 0;
  const peakSell = hasSeries
    ? Math.max(0, ...series.map((point) => Number(point.sell) || 0))
    : 0;
  const rangeLabel = SIGNALS_BREADTH_RANGE_LABELS[range] || "range";

  return (
    <div
      data-testid="signals-breadth-history-strip"
      aria-label="Market breadth — advancing versus declining signals over time"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: sp(8),
        minWidth: 0,
        padding: sp("10px 12px"),
        border: `1px solid ${CSS_COLOR.borderLight}`,
        borderRadius: dim(RADII.sm),
        background: CSS_COLOR.bg2,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: sp(8),
          flexWrap: "wrap",
          minWidth: 0,
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "baseline", gap: sp(8), minWidth: 0 }}>
          <span
            style={{
              color: CSS_COLOR.text,
              fontSize: fs(12),
              fontWeight: FONT_WEIGHTS.medium,
              whiteSpace: "nowrap",
            }}
          >
            Overall market breadth
          </span>
          <span
            data-testid="signals-breadth-net"
            style={{
              color: netTone,
              fontSize: fs(11),
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
          aria-label="Breadth history range"
          style={{ display: "inline-flex", gap: sp(2), minWidth: 0 }}
        >
          {SIGNALS_BREADTH_HISTORY_RANGES.map((option) => {
            const selected = option === range;
            return (
              <button
                key={option}
                type="button"
                data-testid={`signals-breadth-range-${option}`}
                aria-pressed={selected ? "true" : "false"}
                onClick={() => onRangeChange?.(option)}
                style={{
                  minWidth: dim(phone ? 44 : 30),
                  minHeight: dim(phone ? 44 : 22),
                  padding: sp("2px 7px"),
                  border: `1px solid ${selected ? CSS_COLOR.accent : CSS_COLOR.borderLight}`,
                  borderRadius: dim(RADII.xs),
                  background: selected ? cssColorMix(CSS_COLOR.accent, 12) : CSS_COLOR.bg1,
                  color: selected ? CSS_COLOR.text : CSS_COLOR.textSec,
                  fontSize: fs(10),
                  fontWeight: FONT_WEIGHTS.medium,
                  fontFamily: T.sans,
                  fontVariantNumeric: "tabular-nums",
                  cursor: "pointer",
                }}
              >
                {SIGNALS_BREADTH_RANGE_LABELS[option] || option}
              </button>
            );
          })}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: sp(phone ? 10 : 18),
          flexDirection: phone ? "column" : "row",
          minWidth: 0,
        }}
      >
        <SignalsBreadthTotal value={advancing} tone={CSS_COLOR.blue} label="Advancing (B)" />
        <div
          style={{
            flex: 1,
            minWidth: 0,
            width: phone ? "100%" : undefined,
            display: "flex",
            flexDirection: "column",
            gap: sp(5),
          }}
        >
          <div
            style={{
              height: dim(phone ? 52 : 60),
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: 0,
            }}
          >
            {hasSeries ? (
              <BuySellSparkline
                points={series}
                showArea
                height={phone ? 52 : 60}
                testId="signals-breadth-history-chart"
                ariaLabel={`Buy and sell signal breadth over the last ${rangeLabel}`}
              />
            ) : (
              <span
                style={{
                  ...cellTextStyle,
                  color: CSS_COLOR.textDim,
                  fontSize: fs(10),
                  textAlign: "center",
                }}
              >
                {`No breadth history for the last ${rangeLabel}`}
              </span>
            )}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: sp(8),
              fontSize: fs(10),
              fontVariantNumeric: "tabular-nums",
              fontWeight: FONT_WEIGHTS.medium,
            }}
          >
            <span style={{ color: CSS_COLOR.blue, display: "inline-flex", alignItems: "center", gap: sp(4) }}>
              <i style={{ width: dim(11), height: dim(2), borderRadius: dim(RADII.pill), background: CSS_COLOR.blue, display: "block" }} />
              buys{hasSeries ? ` · peak ${formatCount(peakBuy)}` : ""}
            </span>
            <span style={{ color: CSS_COLOR.textMuted }}>
              {activeBuySell ? `${advancingPct}% advancing now` : "No signals"}
              {flat ? ` · ${formatCount(flat)} neutral` : ""}
            </span>
            <span style={{ color: CSS_COLOR.red, display: "inline-flex", alignItems: "center", gap: sp(4) }}>
              <i style={{ width: dim(11), height: dim(2), borderRadius: dim(RADII.pill), background: CSS_COLOR.red, display: "block" }} />
              sells{hasSeries ? ` · peak ${formatCount(peakSell)}` : ""}
            </span>
          </div>
        </div>
        <SignalsBreadthTotal value={declining} tone={CSS_COLOR.red} label="Declining (S)" />
      </div>
    </div>
  );
}

function SignalsOverviewPanel({
  breadthHistory = null,
  breadthHistoryRange = "day",
  onBreadthHistoryRangeChange,
  compact = false,
  netBias,
  phone = false,
  summary,
  timeframeSummaries,
  monitorEnabled = false,
  stale = false,
}) {
  const active = Math.max(0, summary?.active || 0);
  const total = Math.max(0, summary?.total || 0);
  const inactive = Math.max(0, total - active);
  const fresh = Math.max(0, summary?.fresh || 0);
  const aged = Math.max(0, active - fresh);
  const buy = Math.max(0, summary?.buy || 0);
  const sell = Math.max(0, summary?.sell || 0);
  const net = Number.isFinite(netBias?.net) ? netBias.net : buy - sell;
  const problem = Math.max(0, summary?.problem || 0);
  const pending = Math.max(0, summary?.pending || 0);
  const netTone =
    net > 0 ? CSS_COLOR.blue : net < 0 ? CSS_COLOR.red : CSS_COLOR.textDim;
  const attentionTone = problem
    ? CSS_COLOR.red
    : pending
      ? CSS_COLOR.amber
      : CSS_COLOR.textDim;

  // Fresh coverage is only "live" (green) when the monitor is on, data is not
  // stale, and there is at least one fresh signal; otherwise it reads amber
  // (stale/degraded) or neutral (monitor off / no fresh coverage).
  const freshTone = requestHealthTone(
    classifyRequestHealth({
      off: !monitorEnabled,
      stale: monitorEnabled && stale,
      empty: monitorEnabled && !stale && fresh === 0,
    }),
  );

  // Breadth is a point-in-time aggregate (not a tracked time series), so the
  // Buy/Sell/Net cards visualize current proportions rather than a trend line.
  const activeBuySell = buy + sell;

  const metrics = [
    {
      key: "tracked",
      icon: Radar,
      label: "Tracked",
      value: formatCount(total),
      tone: CSS_COLOR.text,
      tooltip: `${formatCount(active)} active · ${formatCount(inactive)} idle`,
      viz: (
        <SignalsSplitBar
          segments={[
            { pct: total ? (active / total) * 100 : 0, color: CSS_COLOR.accent },
            { pct: total ? (inactive / total) * 100 : 0, color: CSS_COLOR.textMuted },
          ]}
        />
      ),
    },
    {
      key: "fresh",
      icon: Clock3,
      label: "Fresh",
      value: formatCount(fresh),
      tone: freshTone,
      tooltip: `${formatCount(fresh)} fresh · ${formatCount(aged)} aged`,
      viz: (
        <SignalsSplitBar
          segments={[{ pct: total ? (fresh / total) * 100 : 0, color: freshTone }]}
        />
      ),
    },
    {
      key: "buy",
      icon: TrendingUp,
      label: "Buy",
      value: formatCount(buy),
      tone: CSS_COLOR.blue,
      tooltip: `${formatCount(buy)} of ${formatCount(total)} symbols on a buy signal`,
      viz: (
        <SignalsSplitBar
          segments={[{ pct: total ? (buy / total) * 100 : 0, color: CSS_COLOR.blue }]}
        />
      ),
    },
    {
      key: "sell",
      icon: TrendingDown,
      label: "Sell",
      value: formatCount(sell),
      tone: CSS_COLOR.red,
      tooltip: `${formatCount(sell)} of ${formatCount(total)} symbols on a sell signal`,
      viz: (
        <SignalsSplitBar
          segments={[{ pct: total ? (sell / total) * 100 : 0, color: CSS_COLOR.red }]}
        />
      ),
    },
    {
      key: "net",
      icon: Scale,
      label: "Net",
      value: `${net > 0 ? "+" : ""}${formatCount(net)}`,
      tone: netTone,
      tooltip: netBias?.label || "Net buy/sell bias",
      viz: (
        <SignalsSplitBar
          segments={[
            { pct: activeBuySell ? (buy / activeBuySell) * 100 : 0, color: CSS_COLOR.blue },
            { pct: activeBuySell ? (sell / activeBuySell) * 100 : 0, color: CSS_COLOR.red },
          ]}
        />
      ),
    },
    {
      key: "attention",
      icon: Bell,
      label: "Attention",
      value: formatCount(problem + pending),
      tone: attentionTone,
      tooltip: `${formatCount(problem)} need attention · ${formatCount(pending)} pending`,
      viz: <SignalsAttentionDots high={problem} medium={pending} />,
    },
  ];
  return (
    <div
      data-testid="signals-overview-panel"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: sp(7),
        minWidth: 0,
        padding: sp(10),
        ...surfaceStyle({ radius: RADII.sm }),
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: phone
            ? "repeat(3, minmax(0, 1fr))"
            : "repeat(6, minmax(0, 1fr))",
          gap: sp(6),
          minWidth: 0,
        }}
      >
        {metrics.map(({ key, ...metricProps }) => (
          // Destructure key out of the spread so React doesn't warn about a key
          // prop being spread into JSX.
          <SignalsOverviewMetric key={key} {...metricProps} />
        ))}
      </div>
      <TimeframeSignalGroupedBars
        summaries={timeframeSummaries}
        pointsByTimeframe={breadthHistory?.pointsByTimeframe}
        phone={phone}
        compact={compact}
      />
      <CompactSignalBreadthPanel
        buy={buy}
        sell={sell}
        neutral={Math.max(0, total - active)}
        netBias={netBias}
        points={breadthHistory?.points}
        range={breadthHistoryRange}
        onRangeChange={onBreadthHistoryRangeChange}
        phone={phone}
      />
    </div>
  );
}
function StatusCell({ row }) {
  const tone = toneForStatus(row.status);
  const issueStatus =
    row.status === SIGNALS_ROW_STATUS.problem
      ? row.lastError
        ? "error"
        : "unavailable"
      : null;
  const issues = issueStatus
    ? collectDataIssuesFromRecord(
        {
          status: issueStatus,
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
      )
    : [];
  return (
    <span style={{ display: "inline-flex", minWidth: 0, alignItems: "center", gap: sp(4) }}>
      <DirectionBadge direction={row.direction} stale={row.fresh === false} />
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
  const issueStatus =
    row.status === SIGNALS_ROW_STATUS.problem ? "unavailable" : null;
  const issues = issueStatus
    ? collectDataIssuesFromRecord(
        {
          status: issueStatus,
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
      )
    : [];
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
  sparklineData = [],
  sparklinePoints: sourceSparklinePoints = null,
  signalEvents = EMPTY_SIGNAL_EVENTS,
  loading = false,
  failed = false,
}) {
  const status = normalizeSignalStatus(state);
  const pending = status === "pending";
  const idle = status === "idle";
  const stale = status === "stale";
  const hydrated = isHydratedSignalMatrixState(state);
  const hasSignalTiming = Boolean(
    state?.currentSignalAt || state?.latestBarAt || state?.lastEvaluatedAt,
  );
  const problem = !pending && !idle && !stale && isProblemSignalState(state);
  const direction = hydrated && !problem ? getCurrentSignalDirection(state) : "";
  const sparklineFallbackDirection = signalSparklineDirectionOrFallback(
    direction,
    rowDirection,
    latestSignalSparklineEventDirection(signalEvents),
  );
  const tone = problem ? CSS_COLOR.red : toneForDirection(direction);
  const usesFetchedSparklineData =
    Array.isArray(sparklineData) && sparklineData.length >= 2;
  // When real bars aren't available we render a neutral placeholder (never a
  // synthetic line) — honest "empty"/"failed" instead of fabricated data.
  const displaySparklineData = usesFetchedSparklineData
    ? sparklineData
    : EMPTY_SPARKLINE_SERIES;
  const sparklineSource = usesFetchedSparklineData
    ? "bars"
    : loading
      ? "loading"
      : failed
        ? "failed"
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
              ? idle
                ? SIGNALS_ROW_STATUS.activeIdle
                : state?.fresh
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
  // Until this cell's matrix state hydrates, hold the sparkline on the muted
  // pending stroke instead of MicroSparkline's financial green/red default —
  // signal cells must never fabricate a green/red trend reading.
  const sparklineColor = sparklineUsesSignalTimeline
    ? null
    : resolveSignalSparklineFallbackColor({
        signalColor: sparklineSignalColor,
        signalStateHydrated: hydrated,
      });
  const sparklineSignalMode = sparklineUsesSignalTimeline
    ? "timeline"
    : direction
      ? "current"
      : sparklineSignalColor || hydrated
        ? "fallback"
        : "pending";
  const issueStatus = problem
    ? state?.lastError
      ? "error"
      : state?.status || "unavailable"
    : null;
  const issues = issueStatus
    ? collectDataIssuesFromRecord(
        {
          status: issueStatus,
          lastError: idle || stale ? null : state?.lastError,
          lastEvaluatedAt: state?.lastEvaluatedAt,
          latestBarAt: state?.latestBarAt,
        },
        {
          valueLabel: `${timeframe} signal cell`,
          source: "signal matrix",
          nextAction:
            "Open the signal drilldown before trusting this interval's direction.",
        },
      )
    : [];
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
      : idle
        ? `${timeframe} market idle · ${intervalAge}`
      : stale
        ? `${timeframe} aged · ${intervalAge}`
        : hydrated
          ? `${timeframe} ${direction || "none"} · ${formatBars(state.barsSinceSignal)} · ${intervalAge}`
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
              style={SPARKLINE_FILL_STYLE}
            />
          ) : (
            <span
              aria-hidden="true"
              style={{
                display: "block",
                width: "100%",
                height: "100%",
                borderRadius: dim(RADII.xs),
                boxShadow: `inset 0 -1px 0 ${cssColorMix(failed ? CSS_COLOR.amber : CSS_COLOR.textMuted, 24)}`,
                background: cssColorMix(failed ? CSS_COLOR.amber : CSS_COLOR.textMuted, 7),
                opacity: failed ? 0.6 : hydrated || stale ? 0.75 : 0.35,
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
            <Badge key={reason} color={tone}>
              {formatEnumLabel(reason)}
            </Badge>
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
  if (tile) {
    return (
      <StatTile
        label={label}
        value={value || MISSING_VALUE}
        tone={tone}
        align={align === "center" ? "center" : "start"}
        minWidth={0}
        title={String(value || MISSING_VALUE)}
        style={{
          padding: sp("7px 8px"),
          border: `1px solid ${CSS_COLOR.border}`,
          borderRadius: dim(RADII.xs),
          background: CSS_COLOR.bg2,
        }}
      />
    );
  }
  return (
    <div
      style={{
        minWidth: 0,
        display: "grid",
        alignContent: "center",
        gap: sp(2),
        padding: sp("6px 8px"),
        borderLeft: `1px solid ${CSS_COLOR.border}`,
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
        ...surfaceStyle({ radius: RADII.sm }),
        padding: sp(10),
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
              <DirectionBadge direction={direction} stale={Boolean(state) && !fresh} />
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
        ...surfaceStyle({ radius: RADII.sm }),
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
  hydrated,
  missing,
  phone,
  timeframeHydration = [],
  total,
}) {
  const hasUniverse = total > 0;
  const ratio = hasUniverse ? hydrated / total : 0;
  const boundedRatio = Math.max(0, Math.min(1, ratio));
  const complete = hasUniverse && missing === 0;
  const hydratedPercent = !hasUniverse
    ? 0
    : complete
      ? 100
      : Math.min(99, Math.floor(boundedRatio * 100));
  const tone = !hasUniverse ? CSS_COLOR.textDim : complete ? CSS_COLOR.green : CSS_COLOR.amber;
  const inlineStatus = !hasUniverse
    ? "Signal matrix idle"
    : complete
      ? "Signal matrix current"
      : `${missing} outside freshness`;
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
            ? `${hydrated}/${total} cells covered`
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
            ...surfaceStyle({ radius: RADII.sm }),
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
  environment = "shadow",
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
  signalMatrixUniverse = null,
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
  const signalsHydrationManifestScopeRef = useRef(null);
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
            : platformManagedSignalData
              ? "platform-seed"
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
    // Scope = environment + the authoritative universe. When it changes, reset
    // the hydration manifest AND the current selection so symbols/counts from a
    // previous source/universe don't linger. (Epicurus Signals audit.)
    const scopeKey = buildSignalsSourceScopeKey({
      environment,
      universeSymbols: signalsHydrationSourceUniverseSymbols,
    });
    const reset = signalsHydrationManifestScopeRef.current !== scopeKey;
    signalsHydrationManifestScopeRef.current = scopeKey;
    if (reset) {
      setSelectedSymbol("");
    }
    setSignalsHydrationManifestSymbols((currentSymbols) => {
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
          // Bound to the authoritative universe so symbols from a previous
          // source/universe don't linger (pass-through while it's unavailable).
          boundSignalsRowsToUniverse(
            buildSignalsRows({
              stateResponse,
              matrixStates: signalMatrixStates,
              events: signalEventsForRows,
              watchlists,
            }),
            signalsHydrationSourceUniverseSymbols,
          ),
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
      signalsHydrationSourceUniverseSymbols,
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
  const signalSparklineRows = useMemo(
    () =>
      captureSignalsRouteDataStage(
        "sparkline-rows-planned",
        () => {
          const rowSparklines = filteredRows
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
          source: "runtime-ticker-stream",
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
  const signalSparklineSymbols = useMemo(
    () => signalSparklineRows.map((row) => row.key),
    [signalSparklineRows],
  );
  const signalSparklineRuntimeSnapshots = useRuntimeTickerSnapshots(
    active ? signalSparklineSymbols : [],
  );
  const signalSparklineBarsBySymbol = useMemo(() => {
    const entries = signalSparklineSymbols
      .map((symbolKey) => {
        const bars = resolveRuntimeSignalSparklineBars(
          signalSparklineRuntimeSnapshots[symbolKey],
        );
        return hasDrawableSparkline(bars) ? [symbolKey, bars] : null;
      })
      .filter(Boolean);
    return entries.length
      ? Object.fromEntries(entries)
      : EMPTY_SIGNAL_SPARKLINE_BARS;
  }, [
    signalSparklineRuntimeSnapshots,
    signalSparklineSymbols,
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
  const matrixHydrationPlan = useMemo(
    () =>
      captureSignalsRouteDataStage(
        "matrix-coverage-ready",
        () =>
          buildSignalsMatrixHydrationPlan({
            symbols: signalsHydrationUniverseSymbols,
            currentStates: [
              ...signalMatrixStates,
              ...(stateResponse?.states || []),
            ],
            timeframes: SIGNALS_TABLE_TIMEFRAMES,
          }),
        (value) => ({
          hydratedCells: value.hydratedCellCount,
          missingCells: value.missingCellCount,
          symbols: value.symbols.length,
          totalCells: value.totalCellCount,
        }),
      ),
    [
      captureSignalsRouteDataStage,
      signalMatrixStates,
      signalsHydrationUniverseSymbols,
      stateResponse?.states,
    ],
  );
  useEffect(() => {
    if (!active || !stateResponseReady) {
      return;
    }
    markSignalsRouteDataTiming("matrix-coverage-ready", {
      ...(signalsRouteDataStageDetailsRef.current.get("matrix-coverage-ready") || {}),
      missingCells: matrixHydrationPlan.missingCellCount,
      symbols: matrixHydrationPlan.symbols.length,
    });
  }, [
    active,
    markSignalsRouteDataTiming,
    matrixHydrationPlan.missingCellCount,
    matrixHydrationPlan.symbols.length,
    stateResponseReady,
  ]);
  // Overview metrics match the visible table: derive from filtered rows whenever
  // a search/status/direction filter is active, else from all rows. (Option A.)
  const overviewMetricRows = signalsFiltersActive({
    query,
    statusFilter,
    directionFilter,
  })
    ? filteredRows
    : rows;
  const summary = useMemo(
    () => summarizeSignalsRows(overviewMetricRows),
    [overviewMetricRows],
  );
  const displaySummary = useMemo(() => {
    if (
      signalsFiltersActive({ query, statusFilter, directionFilter }) ||
      !signalMonitorDataManagedByPlatform
    ) {
      return summary;
    }
    const trackedTotal = Math.max(
      summary.total || 0,
      Number(signalMatrixUniverse?.resolvedSymbols) || 0,
      Number(signalMatrixCoverage?.activeScopeSymbols) || 0,
      Number(signalMonitorProfile?.maxSymbols) || 0,
    );
    return trackedTotal > summary.total
      ? { ...summary, total: trackedTotal }
      : summary;
  }, [
    directionFilter,
    query,
    signalMatrixCoverage?.activeScopeSymbols,
    signalMatrixUniverse?.resolvedSymbols,
    signalMonitorDataManagedByPlatform,
    signalMonitorProfile?.maxSymbols,
    statusFilter,
    summary,
  ]);
  const netBias = useMemo(
    () => summarizeSignalsNetBias(overviewMetricRows),
    [overviewMetricRows],
  );
  const timeframeSignalSummary = useMemo(
    () => summarizeSignalsTimeframeDirections(overviewMetricRows),
    [overviewMetricRows],
  );
  const breadthHistory = useMemo(
    () => normalizeSignalsBreadthHistory(breadthHistoryQuery.data),
    [breadthHistoryQuery.data],
  );
  const selectedRow = useMemo(
    () =>
      // Only from the VISIBLE (filtered) rows -- never resolve a selection to a
      // row that search/filters have hidden; fall back to the first visible row.
      filteredRows.find((row) => row.symbol === selectedSymbol) ||
      filteredRows[0] ||
      null,
    [filteredRows, selectedSymbol],
  );
  useEffect(() => {
    onReadinessChange?.({
      contentReady: Boolean(active),
      primaryReady: Boolean(active),
      derivedReady: Boolean(active),
      backgroundAllowed: Boolean(active),
    });
  }, [active, onReadinessChange]);

  useEffect(() => {
    if (!filteredRows.length) {
      return;
    }
    // Re-pick the first visible row when nothing is selected OR the current
    // selection has been filtered/searched out of view (no stale hidden selection).
    const selectionVisible =
      selectedSymbol &&
      filteredRows.some((row) => row.symbol === selectedSymbol);
    if (!selectionVisible) {
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
    const refreshTasks = [
      breadthHistoryQuery.refetch(),
      eventsQuery.refetch(),
    ];
    if (!platformManagedSignalData) {
      refreshTasks.push(
        profileQuery.refetch(),
        stateQuery.refetch(),
      );
    }
    Promise.allSettled(refreshTasks).finally(() => setRefreshing(false));
  }, [
    breadthHistoryQuery,
    eventsQuery,
    platformManagedSignalData,
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
        meta: { width: phone ? "72px" : "96px" },
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
                  transition: "transform var(--ra-motion-fast) ease-out, color var(--ra-motion-fast) ease-out",
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
        meta: { width: phone ? "96px" : "118px" },
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
          const barsValue = signalSparklineBarsBySymbol[symbolKey];
          return (
            <CompactIntervalCell
              symbol={row.original.symbol}
              timeframe={timeframe}
              state={row.original.matrixStatesByTimeframe?.[timeframe] || null}
              rowDirection={row.original.direction}
              sparklineData={Array.isArray(barsValue) ? barsValue : EMPTY_SPARKLINE_SERIES}
              sparklinePoints={signalSparklinePointsBySymbol[symbolKey] || null}
              loading={false}
              failed={false}
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
            meta: { width: "100px" },
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

  // The signals matrix (pushed/stored states) is the source of truth for this
  // table. A transient profile/events/state read error must NOT blank a table
  // that still has signal data to show — the KPI strip already renders from the
  // same states, so the table must too. Only surface "Signals unavailable" when
  // we genuinely have no signal data AND a read failed.
  const hasSignalData =
    rows.length > 0 ||
    (Array.isArray(stateResponse.states) && stateResponse.states.length > 0) ||
    (Array.isArray(signalMatrixStates) && signalMatrixStates.length > 0);
  // For the same reason, never hold the table behind a loading spinner once the
  // matrix already has signal data. Wait only when there is genuinely nothing to
  // show yet — e.g. the profile read is still settling the saved column setup,
  // which hydrates a tick later without blocking the matrix itself.
  const loading =
    !hasSignalData &&
    ((!stateResponseReady && effectiveStateLoading) ||
      (!profile && effectiveProfileLoading));
  const errored =
    !hasSignalData &&
    (effectiveStateIsError || effectiveProfileIsError || eventsQuery.isError);
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
  const matrixHydrationTone =
    matrixHydrationTotal > 0 && matrixHydrationMissing === 0
      ? CSS_COLOR.green
      : CSS_COLOR.amber;
  const matrixHydrationLabel = matrixHydrationTotal
    ? `Intervals ${matrixHydrationHydrated}/${matrixHydrationTotal}`
    : "Intervals idle";
  const minTableWidth = phone ? dim(900) : compact ? dim(1040) : dim(1360);
  // Stable identities for the virtual-table callbacks. Inline arrows here would
  // change every render, rebuilding the table's virtualRows/row model and
  // re-deriving react-table on every live tick.
  const getSignalRowId = useCallback((row) => row.id, []);
  const isSignalRowExpanded = useCallback(
    (row) => row.symbol === expandedSymbol,
    [expandedSymbol],
  );
  const renderSignalRowDetail = useCallback(
    (row) => (
      <SignalsRowDrilldown row={row} onJumpToTrade={onJumpToTrade} phone={phone} />
    ),
    [onJumpToTrade, phone],
  );
  const getSignalRowDetailProps = useCallback(
    (row) => ({
      id: getSignalDrilldownId(row.symbol),
      role: "region",
      "aria-label": `${row.symbol} signal detail`,
      style: {
        minWidth: minTableWidth,
        borderBottom: `1px solid ${CSS_COLOR.border}`,
      },
    }),
    [minTableWidth],
  );
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
          breadthHistoryRange={breadthHistoryRange}
          onBreadthHistoryRangeChange={setBreadthHistoryRange}
          compact={compact}
          netBias={netBias}
          phone={phone}
          summary={displaySummary}
          timeframeSummaries={timeframeSignalSummary}
          monitorEnabled={Boolean(profile?.enabled)}
          stale={effectiveStateData?.cacheStatus === "stale"}
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
          <SignalsTickerSearchInput
            value={query}
            onCommit={setQuery}
            compact={compact}
          />

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
            hydrated={matrixHydrationHydrated}
            missing={matrixHydrationMissing}
            phone={phone}
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
            <div
              data-testid="signals-table-loading-skeleton"
              aria-hidden="true"
              style={{
                minHeight: 0,
                height: "100%",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }}
            >
              {Array.from({ length: 8 }).map((_, index) => (
                <div
                  key={index}
                  style={{
                    height: dim(phone ? 58 : 56),
                    flex: "none",
                    display: "flex",
                    alignItems: "center",
                    padding: sp("0 6px"),
                    borderBottom: `1px solid ${CSS_COLOR.border}`,
                  }}
                >
                  <Skeleton width="100%" height={dim(14)} radius={RADII.xs} />
                </div>
              ))}
            </div>
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
                getRowId={getSignalRowId}
                lockedColumnIds={SIGNALS_LOCKED_COLUMN_IDS}
                rowHeight={phone ? 58 : 56}
                rowDetailHeight={phone ? 820 : compact ? 720 : 650}
                rowDetailTestId="signals-table-row-drilldown"
                minWidth={minTableWidth}
                onColumnOrderChange={handleSignalsColumnOrderChange}
                onSortChange={handleSignalsSortChange}
                isRowExpanded={isSignalRowExpanded}
                renderRowDetail={renderSignalRowDetail}
                getRowDetailProps={getSignalRowDetailProps}
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
                      transition: "background-color var(--ra-motion-fast) ease-out, border-color var(--ra-motion-fast) ease-out, box-shadow var(--ra-motion-fast) ease-out",
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
                    standby
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
