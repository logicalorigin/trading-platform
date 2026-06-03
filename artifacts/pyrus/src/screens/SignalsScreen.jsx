import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  useGetBars,
  useGetSignalMonitorProfile,
  useGetSignalMonitorState,
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
  Star,
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
  StatusPill,
} from "../components/platform/primitives.jsx";
import { AppTooltip } from "@/components/ui/tooltip";
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
import { useViewport } from "../lib/responsive";
import { _initialState, persistState } from "../lib/workspaceState";
import {
  SIGNALS_ROW_STATUS,
  SIGNALS_TABLE_TIMEFRAMES,
  buildSignalsRows,
  filterSignalsRows,
  sortSignalsRows,
  summarizeSignalsRows,
} from "../features/signals/signalsRowModel.js";
import {
  buildSignalsMatrixHydrationPlan,
} from "../features/signals/signalsMatrixHydration.js";
import {
  getCurrentSignalDirection,
  isProblemSignalState,
  isSignalStateCurrent,
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
  { value: "latest", label: "Latest" },
  { value: "bars", label: "Bars" },
  { value: "symbol", label: "Symbol" },
];

const isHydratedSignalMatrixState = (state) =>
  Boolean(
    state &&
      !["error", "unavailable", "unknown"].includes(
        normalizeSignalStatus(state),
      ) &&
      (state.latestBarAt || state.currentSignalAt),
  );
const SIGNAL_TIMEFRAME_OPTIONS = ["1m", "5m", "15m", "1h", "1d"];
const SIGNALS_COLUMN_IDS = [
  "symbol",
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
const SIGNALS_SORT_KEYS_BY_COLUMN_ID = {
  action: "symbol",
  age: "age",
  bars: "bars",
  coverage: "coverage",
  latest: "latest",
  mtf: "mtf",
  price: "price",
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

const toneForDirection = (direction) =>
  direction === "buy"
    ? CSS_COLOR.blue
    : direction === "sell"
      ? CSS_COLOR.red
      : CSS_COLOR.textDim;

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

const getActiveWatchlistId = (profile, defaultWatchlist) =>
  profile?.watchlistId || defaultWatchlist?.id || "";

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

function DirectionBadge({ direction }) {
  const tone = toneForDirection(direction);
  const Icon = direction === "sell" ? ArrowDown : direction === "buy" ? ArrowUp : Clock3;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: sp(5),
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

function MetricTile({
  label,
  value,
  tone = CSS_COLOR.text,
  subtitle = "",
  ratio = null,
}) {
  const ratioValue = Number(ratio);
  const hasRatio = Number.isFinite(ratioValue);
  const boundedRatio = hasRatio ? Math.max(0, Math.min(1, ratioValue)) : 0;
  return (
    <div
      style={{
        display: "grid",
        alignContent: "space-between",
        gap: sp(6),
        minWidth: dim(104),
        minHeight: dim(58),
        padding: sp("8px 10px"),
        border: `1px solid ${CSS_COLOR.border}`,
        borderRadius: dim(RADII.sm),
        background: CSS_COLOR.bg1,
        boxShadow: `inset 0 1px 0 ${cssColorMix(CSS_COLOR.text, 9)}`,
      }}
    >
      <div style={{ display: "grid", gap: sp(3), minWidth: 0 }}>
        <span
          style={{
            color: CSS_COLOR.textMuted,
            fontSize: fs(10),
            fontWeight: FONT_WEIGHTS.label,
            letterSpacing: 0,
            textTransform: "uppercase",
          }}
        >
          {label}
        </span>
        <span
          style={{
            color: tone,
            fontSize: fs(19),
            fontWeight: FONT_WEIGHTS.medium,
            lineHeight: 1,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {value}
        </span>
      </div>
      {subtitle || hasRatio ? (
        <div style={{ display: "grid", gap: sp(4), minWidth: 0 }}>
          {hasRatio ? (
            <span
              aria-hidden="true"
              style={{
                height: dim(3),
                borderRadius: dim(RADII.pill),
                background: CSS_COLOR.bg3,
                overflow: "hidden",
              }}
            >
              <span
                style={{
                  display: "block",
                  width: `${Math.round(boundedRatio * 100)}%`,
                  height: "100%",
                  borderRadius: dim(RADII.pill),
                  background: tone,
                }}
              />
            </span>
          ) : null}
          {subtitle ? (
            <span
              style={{
                ...cellTextStyle,
                color: CSS_COLOR.textDim,
                fontSize: textSize("caption"),
              }}
            >
              {subtitle}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function StatusCell({ row }) {
  const tone = toneForStatus(row.status);
  return (
    <span style={{ display: "inline-flex", minWidth: 0, alignItems: "center", gap: sp(8) }}>
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
    </span>
  );
}

function CoverageCell({ row }) {
  const tone = toneForStatus(row.status);
  return (
    <span style={{ display: "inline-flex", minWidth: 0, alignItems: "center", gap: sp(6) }}>
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
    </span>
  );
}

function CompactIntervalCell({ timeframe, state }) {
  const hydrated = isHydratedSignalMatrixState(state);
  const problem = isProblemSignalState(state);
  const direction = hydrated ? getCurrentSignalDirection(state) : "";
  const tone = problem ? CSS_COLOR.red : toneForDirection(direction);
  const intervalAge = hydrated
    ? formatTime(state.currentSignalAt || state.latestBarAt || state.lastEvaluatedAt)
    : MISSING_VALUE;
  const Icon = problem
    ? AlertTriangle
    : direction === "sell"
      ? ArrowDown
      : direction === "buy"
        ? ArrowUp
        : Clock3;
  const content = hydrated
    ? `${timeframe} ${direction || "none"} · ${formatBars(state.barsSinceSignal)} · ${intervalAge}`
    : state?.lastError
      ? `${timeframe} ${state.status || "error"} · ${state.lastError}`
      : `${timeframe} not hydrated`;
  return (
    <AppTooltip content={content}>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: sp(4),
          width: "100%",
          minWidth: 0,
          color: tone,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <Icon size={13} strokeWidth={2} aria-hidden="true" />
        <span
          style={{
            minWidth: 0,
            display: "grid",
            justifyItems: "end",
            gap: 0,
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
            {hydrated ? formatCompactBars(state.barsSinceSignal) : problem ? "Err" : MISSING_VALUE}
          </span>
          <span
            data-testid={`signals-${timeframe}-age`}
            style={{
              ...cellTextStyle,
              color: CSS_COLOR.textDim,
              fontSize: fs(9),
            }}
          >
            {hydrated ? intervalAge : ""}
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
          gap: sp(5),
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
          display: "grid",
          gap: sp(1),
          minWidth: 0,
          color: tone,
          lineHeight: 1.1,
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: sp(5),
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
  onPatch,
  onApply,
  onReset,
}) {
  if (!draft) return null;
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
      <span
        title={String(value || MISSING_VALUE)}
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
  const watchlists = row.watchlistLabels || [];

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
          {watchlists.length ? (
            watchlists.map((label) => (
              <Badge key={label} color={CSS_COLOR.textDim} variant="outline">
                {label}
              </Badge>
            ))
          ) : (
            <Badge color={CSS_COLOR.textDim} variant="outline">
              No watchlist
            </Badge>
          )}
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
  total,
  visibleCount,
}) {
  const hasUniverse = total > 0;
  const ratio = hasUniverse ? hydrated / total : 0;
  const boundedRatio = Math.max(0, Math.min(1, ratio));
  const complete = hasUniverse && missing === 0;
  const tone = !hasUniverse ? CSS_COLOR.textDim : complete ? CSS_COLOR.green : CSS_COLOR.amber;
  const status = !hasUniverse
    ? "Hydration idle"
    : complete
      ? "Fully hydrated"
      : `Hydrating ${missing} remaining`;

  return (
    <div
      data-testid="signals-hydration-strip"
      style={{
        display: "grid",
        gridTemplateColumns: phone ? "1fr" : "minmax(170px, auto) minmax(160px, 1fr) auto",
        gap: phone ? sp(6) : sp(10),
        alignItems: "center",
        minWidth: 0,
        padding: sp("8px 10px"),
        borderBottom: `1px solid ${CSS_COLOR.border}`,
        background: CSS_COLOR.bg1,
      }}
    >
      <div style={{ display: "grid", gap: sp(2), minWidth: 0 }}>
        <span
          style={{
            ...cellTextStyle,
            color: tone,
            fontSize: textSize("bodyStrong"),
            fontWeight: FONT_WEIGHTS.medium,
          }}
        >
          {status}
        </span>
        <span
          style={{
            ...cellTextStyle,
            color: CSS_COLOR.textDim,
            fontSize: textSize("caption"),
          }}
        >
          {hasUniverse
            ? `${hydrated}/${total} symbols · ${visibleCount} visible prioritized`
            : "Waiting for monitor universe"}
        </span>
      </div>
      <span
        aria-label={hasUniverse ? `${Math.round(boundedRatio * 100)} percent hydrated` : "No hydration progress"}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(boundedRatio * 100)}
        style={{
          height: dim(7),
          borderRadius: dim(RADII.pill),
          background: CSS_COLOR.bg3,
          overflow: "hidden",
          boxShadow: `inset 0 0 0 1px ${CSS_COLOR.border}`,
        }}
      >
        <span
          style={{
            display: "block",
            width: `${Math.round(boundedRatio * 100)}%`,
            height: "100%",
            borderRadius: dim(RADII.pill),
            background: tone,
            transition: "width 180ms ease-out, background-color 180ms ease-out",
          }}
        />
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
        {hasUniverse ? `${Math.round(boundedRatio * 100)}%` : "idle"}
      </span>
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
  const matrixEntries = SIGNALS_TABLE_TIMEFRAMES.map((timeframe) => ({
    timeframe,
    state: row.matrixStatesByTimeframe?.[timeframe] || null,
  }));

  return (
    <div
      data-testid="signals-row-drilldown"
      style={{
        height: "100%",
        minWidth: 0,
        display: "grid",
        overflow: "hidden",
        background: cssColorMix(statusTone, 5),
        borderTop: `1px solid ${cssColorMix(statusTone, 32)}`,
        borderBottom: `1px solid ${CSS_COLOR.border}`,
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
  defaultWatchlist = null,
  signalMonitorSymbols = [],
  signalMonitorEvents = [],
  signalMonitorEventsLoaded = false,
  signalMatrixStates = [],
  isVisible = true,
  onReadinessChange,
  onSelectSymbol,
  onJumpToTrade,
  onScanNow,
  onToggleMonitor,
  onChangeMonitorTimeframe,
  onChangeMonitorWatchlist,
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
  const [sortKey, setSortKey] = useState("priority");
  const [sortDirection, setSortDirection] = useState("asc");
  const [columnOrder, setColumnOrder] = useState(() =>
    normalizeColumnOrder(_initialState.signalsColumnOrder, SIGNALS_COLUMN_IDS),
  );
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [expandedSymbol, setExpandedSymbol] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [visibleHydrationSymbols, setVisibleHydrationSymbols] = useState([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState(() =>
    resolvePyrusSignalsRuntimeSettings(DEFAULT_PYRUS_SIGNALS_SETTINGS),
  );
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsApplying, setSettingsApplying] = useState(false);
  const syncedSettingsSignatureRef = useRef("");
  const active = isVisible !== false;
  const signalMonitorParams = useMemo(() => ({ environment }), [environment]);
  const signalMonitorEventsParams = useMemo(
    () => ({ environment, limit: SIGNALS_EVENT_LIMIT }),
    [environment],
  );
  const providedSignalMonitorEvents = useMemo(
    () => (Array.isArray(signalMonitorEvents) ? signalMonitorEvents : []),
    [signalMonitorEvents],
  );
  const hasProvidedSignalMonitorEvents = Boolean(
    signalMonitorEventsLoaded || providedSignalMonitorEvents.length,
  );
  const eventsQueryEnabled = Boolean(active && !hasProvidedSignalMonitorEvents);
  const profileQuery = useGetSignalMonitorProfile(signalMonitorParams, {
    query: {
      enabled: active,
      staleTime: 15_000,
      retry: false,
    },
  });
  const stateQuery = useGetSignalMonitorState(signalMonitorParams, {
    query: {
      enabled: active,
      staleTime: 10_000,
      refetchInterval: active ? 15_000 : false,
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
  const profile = stateQuery.data?.profile || profileQuery.data || null;
  const profileIndicatorSettings = useMemo(
    () => resolvePyrusSignalsRuntimeSettings(profile?.pyrusSignalsSettings || {}),
    [profile?.pyrusSignalsSettings],
  );
  const profileIndicatorSettingsSignature = useMemo(
    () => settingsSignature(profileIndicatorSettings),
    [profileIndicatorSettings],
  );
  const stateResponse = useMemo(
    () => {
      if (stateQuery.data) {
        return {
          ...stateQuery.data,
          universeSymbols: stateQuery.data.universeSymbols?.length
            ? stateQuery.data.universeSymbols
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
    [profile, signalMonitorSymbols, stateQuery.data],
  );
  const signalsHydrationUniverseSymbols = useMemo(
    () =>
      stateResponse.universeSymbols?.length
        ? stateResponse.universeSymbols
        : signalMonitorSymbols,
    [signalMonitorSymbols, stateResponse.universeSymbols],
  );
  const rows = useMemo(
    () =>
      buildSignalsRows({
        stateResponse,
        matrixStates: signalMatrixStates,
        events: hasProvidedSignalMonitorEvents
          ? providedSignalMonitorEvents.slice(0, SIGNALS_EVENT_LIMIT)
          : eventsQuery.data?.events || [],
        watchlists,
      }),
    [
      eventsQuery.data?.events,
      hasProvidedSignalMonitorEvents,
      providedSignalMonitorEvents,
      signalMatrixStates,
      stateResponse,
      watchlists,
    ],
  );
  const filteredRows = useMemo(
    () =>
      sortSignalsRows(
        filterSignalsRows(rows, {
          query,
          status: statusFilter,
          direction: directionFilter,
        }),
        { sortKey, direction: sortDirection },
      ),
    [directionFilter, query, rows, sortDirection, sortKey, statusFilter],
  );
  useEffect(() => {
    persistState({
      signalsColumnOrder: normalizeColumnOrder(columnOrder, SIGNALS_COLUMN_IDS),
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
      const seen = new Set();
      const symbols = [];
      [...visibleHydrationSymbols, ...filteredRows.map((row) => row.symbol)]
        .filter(Boolean)
        .forEach((symbol) => {
          if (seen.has(symbol)) return;
          seen.add(symbol);
          symbols.push(symbol);
        });
      return symbols;
    },
    [filteredRows, visibleHydrationSymbols],
  );
  const matrixHydrationPlan = useMemo(
    () =>
      buildSignalsMatrixHydrationPlan({
        symbols: signalsHydrationUniverseSymbols,
        prioritySymbols: priorityHydrationSymbols,
        currentStates: [
          ...signalMatrixStates,
          ...(stateResponse?.states || []),
        ],
        timeframes: SIGNALS_TABLE_TIMEFRAMES,
      }),
    [
      priorityHydrationSymbols,
      signalMatrixStates,
      signalsHydrationUniverseSymbols,
      stateResponse?.states,
    ],
  );
  const matrixHydrationRequestKey = useMemo(
    () =>
      matrixHydrationPlan.requestCells
        .map((cell) => `${cell.symbol}:${cell.timeframe}`)
        .join(","),
    [matrixHydrationPlan.requestCells],
  );
  const matrixHydrationRequestTimeframes =
    matrixHydrationPlan.timeframes;
  const summary = useMemo(() => summarizeSignalsRows(rows), [rows]);
  const selectedRow = useMemo(
    () =>
      filteredRows.find((row) => row.symbol === selectedSymbol) ||
      rows.find((row) => row.symbol === selectedSymbol) ||
      filteredRows[0] ||
      null,
    [filteredRows, rows, selectedSymbol],
  );
  const watchlistOptions = useMemo(
    () => [
      { value: "", label: "Default" },
      ...watchlists.map((watchlist) => ({
        value: watchlist.id || "",
        label: watchlist.name || watchlist.id || "Watchlist",
      })),
    ],
    [watchlists],
  );

  useEffect(() => {
    onReadinessChange?.({
      criticalReady: Boolean(active),
      derivedReady: Boolean(active),
      backgroundAllowed: Boolean(active),
    });
  }, [active, onReadinessChange]);

  useEffect(() => {
    if (
      !active ||
      !visibleHydrationSymbols.length ||
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
      reason: "signals-screen",
    });
  }, [
    active,
    visibleHydrationSymbols.length,
    matrixHydrationPlan.missingCellCount,
    matrixHydrationPlan.missingSymbols,
    matrixHydrationPlan.missingTimeframesBySymbol,
    matrixHydrationPlan.requestCells,
    matrixHydrationPlan.requestSymbols,
    matrixHydrationPlan.symbols.length,
    matrixHydrationPlan.symbols,
    matrixHydrationRequestTimeframes,
    matrixHydrationRequestKey,
    onRequestSignalMatrixHydration,
  ]);

  const handleVisibleRowsChange = useCallback((visibleRows = []) => {
    const nextSymbols = visibleRows
      .map((row) => row?.symbol)
      .filter(Boolean);
    setVisibleHydrationSymbols((current) => {
      if (
        current.length === nextSymbols.length &&
        current.every((symbol, index) => symbol === nextSymbols[index])
      ) {
        return current;
      }
      return nextSymbols;
    });
  }, []);

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
      reason: "signals-refresh",
      force: true,
    });
    Promise.allSettled([
      profileQuery.refetch(),
      stateQuery.refetch(),
      eventsQuery.refetch(),
    ]).finally(() => setRefreshing(false));
  }, [
    eventsQuery,
    matrixHydrationPlan.missingSymbols,
    matrixHydrationPlan.missingTimeframesBySymbol,
    matrixHydrationPlan.requestCells,
    matrixHydrationPlan.requestSymbols,
    matrixHydrationPlan.symbols,
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

  const baseColumns = useMemo(
    () => [
      {
        id: "symbol",
        header: "Ticker",
        meta: { width: phone ? "minmax(76px, 1fr)" : "minmax(128px, 1.05fr)" },
        cell: ({ row }) => {
          const item = row.original;
          const watchlisted = item.watchlistLabels.length > 0;
          const expanded = item.symbol === expandedSymbol;
          const watchlistTitle = watchlisted
            ? `In watchlist: ${item.watchlistLabels.join(", ")}`
            : "";
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
                display: "grid",
                gap: sp(1),
                justifyItems: "start",
                border: "none",
                background: "transparent",
                color: CSS_COLOR.text,
                cursor: "pointer",
                fontFamily: T.sans,
                padding: 0,
                textAlign: "left",
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: sp(4),
                  maxWidth: "100%",
                  width: "100%",
                  minWidth: 0,
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
                {watchlisted ? (
                  <Star
                    size={12}
                    strokeWidth={2}
                    fill="currentColor"
                    aria-hidden="true"
                    title={watchlistTitle}
                    style={{
                      color: CSS_COLOR.amber,
                      flex: "0 0 auto",
                    }}
                  />
                ) : null}
                <span
                  style={{
                    ...cellTextStyle,
                    maxWidth: "100%",
                    fontWeight: FONT_WEIGHTS.label,
                    letterSpacing: 0,
                  }}
                >
                  {item.symbol}
                </span>
              </span>
              <span
                style={{
                  ...cellTextStyle,
                  maxWidth: "100%",
                  color: CSS_COLOR.textDim,
                  fontSize: fs(10),
                }}
              >
                {item.watchlistLabels[0] || `Rank ${item.universeRank}`}
              </span>
            </button>
          );
        },
      },
      {
        id: "signal",
        header: "Signal",
        meta: { width: phone ? "minmax(104px, 1.25fr)" : "minmax(150px, 1.2fr)" },
        cell: ({ row }) => <StatusCell row={row.original} />,
      },
      {
        id: "stack",
        header: "Stack",
        meta: { width: phone ? "64px" : "82px" },
        cell: ({ row }) => <StackCell row={row.original} />,
      },
      {
        id: "verdict",
        header: "Verdict",
        meta: { width: phone ? "86px" : "112px" },
        cell: ({ row }) => <MatrixVerdictCell row={row.original} />,
      },
      ...SIGNALS_TABLE_TIMEFRAMES.map((timeframe) => ({
        id: `tf-${timeframe}`,
        header: timeframe,
        meta: { width: phone ? "60px" : "76px", align: "right" },
        cell: ({ row }) => (
          <CompactIntervalCell
            timeframe={timeframe}
            state={row.original.matrixStatesByTimeframe?.[timeframe] || null}
          />
        ),
      })),
      {
        id: "trend",
        header: "Trend",
        meta: { width: phone ? "62px" : "72px" },
        cell: ({ row }) => <TrendCell row={row.original} />,
      },
      phone
        ? null
        : {
        id: "strength",
        header: "Str",
        meta: { width: "62px" },
        cell: ({ row }) => (
          <span style={{ ...cellTextStyle, color: CSS_COLOR.textSec }}>
            {row.original.dashboardSummary?.strength || MISSING_VALUE}
          </span>
        ),
      },
      phone
        ? null
        : {
        id: "age",
        header: "Age",
        meta: { width: "72px", align: "right" },
        cell: ({ row }) => (
          <span style={{ color: CSS_COLOR.textSec, fontVariantNumeric: "tabular-nums" }}>
            {formatAge(row.original.dashboardSummary)}
          </span>
        ),
      },
      phone
        ? null
        : {
        id: "vol",
        header: "Vol",
        meta: { width: "56px", align: "right" },
        cell: ({ row }) => (
          <span style={{ color: CSS_COLOR.textSec, fontVariantNumeric: "tabular-nums" }}>
            {formatMetric(row.original.dashboardSummary?.volatilityScore)}
          </span>
        ),
      },
      phone
        ? null
        : {
        id: "mtf",
        header: "MTF",
        meta: { width: "62px", align: "right" },
        cell: ({ row }) => <MtfCell row={row.original} />,
      },
      {
        id: "bars",
        header: "Bars",
        meta: { width: phone ? "56px" : "82px", align: "right" },
        cell: ({ row }) => (
          <span style={{ color: CSS_COLOR.textSec, fontVariantNumeric: "tabular-nums" }}>
            {formatBars(row.original.barsSinceSignal)}
          </span>
        ),
      },
      phone
        ? null
        : {
        id: "price",
        header: "Price",
        meta: { width: "96px", align: "right" },
        cell: ({ row }) => (
          <span style={{ color: CSS_COLOR.textSec, fontVariantNumeric: "tabular-nums" }}>
            {formatQuotePrice(row.original.currentSignalPrice)}
          </span>
        ),
      },
      phone
        ? null
        : {
        id: "latest",
        header: "Latest",
        meta: { width: "104px" },
        cell: ({ row }) => (
          <span style={{ ...cellTextStyle, color: CSS_COLOR.textDim }}>
            {formatTime(row.original.currentSignalAt || row.original.lastEvaluatedAt)}
          </span>
        ),
      },
      phone
        ? null
        : {
        id: "coverage",
        header: "Coverage",
        meta: { width: "minmax(170px, 1.35fr)" },
        cell: ({ row }) => <CoverageCell row={row.original} />,
      },
      {
        id: "action",
        header: "",
        meta: { width: phone ? "36px" : "70px", align: "right" },
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
    [expandedSymbol, handleRowSelect, onJumpToTrade, phone],
  );
  const columns = useMemo(
    () => orderColumnsById(baseColumns, columnOrder),
    [baseColumns, columnOrder],
  );

  const loading = stateQuery.isLoading || profileQuery.isLoading;
  const errored = stateQuery.isError || profileQuery.isError || eventsQuery.isError;
  const signalsErrorCopy = useMemo(
    () =>
      describeUserFacingRuntimeError(
        stateQuery.error || profileQuery.error || eventsQuery.error,
        {
          title: "Signals unavailable",
          detail: "Signal monitor data could not be loaded.",
          rateLimitedTitle: "Signals request delayed",
          safeQaTitle: "Signals data paused",
        },
      ),
    [eventsQuery.error, profileQuery.error, stateQuery.error],
  );
  const cacheTone =
    stateQuery.data?.cacheStatus === "hit"
      ? CSS_COLOR.green
      : stateQuery.data?.cacheStatus === "stale"
        ? CSS_COLOR.amber
        : CSS_COLOR.textDim;
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
  const activeSignalCount = Math.max(1, summary.active || 0);
  const trackedCount = Math.max(1, summary.total || 0);
  const minTableWidth = phone ? dim(980) : dim(1320);
  const activeWatchlistId = getActiveWatchlistId(profile, defaultWatchlist);

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
        gridTemplateRows: "auto minmax(0, 1fr)",
        gap: sp(10),
        padding: phone ? sp(10) : sp(14),
        background: CSS_COLOR.bg0,
        color: CSS_COLOR.text,
        fontFamily: T.sans,
        overflow: "hidden",
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
            {stateQuery.data?.cacheStatus ? (
              <StatusPill color={cacheTone} variant="outline">
                {stateQuery.data.cacheStatus}
              </StatusPill>
            ) : null}
            <StatusPill color={matrixHydrationTone} variant="outline">
              {matrixHydrationLabel}
            </StatusPill>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: sp(8),
            flexWrap: "wrap",
            alignItems: "stretch",
          }}
        >
          <MetricTile
            label="Tracked"
            value={formatCount(summary.total)}
            subtitle={`${formatCount(summary.active)} active`}
            ratio={summary.active / trackedCount}
          />
          <MetricTile
            label="Fresh"
            value={formatCount(summary.fresh)}
            tone={CSS_COLOR.green}
            subtitle={`${formatCount(summary.pending)} pending`}
            ratio={summary.fresh / activeSignalCount}
          />
          <MetricTile
            label="Buy"
            value={formatCount(summary.buy)}
            tone={CSS_COLOR.blue}
            subtitle="long bias"
            ratio={summary.buy / activeSignalCount}
          />
          <MetricTile
            label="Sell"
            value={formatCount(summary.sell)}
            tone={CSS_COLOR.red}
            subtitle="short bias"
            ratio={summary.sell / activeSignalCount}
          />
          <MetricTile
            label="Attention"
            value={formatCount(summary.problem)}
            tone={CSS_COLOR.amber}
            subtitle={`${formatCount(summary.skipped)} scan pending`}
            ratio={summary.problem / trackedCount}
          />
        </div>

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
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Ticker"
                style={{
                  ...selectStyle,
                  width: "100%",
                  paddingLeft: dim(30),
                }}
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
            label="Watchlist"
            value={activeWatchlistId}
            options={watchlistOptions}
            onChange={onChangeMonitorWatchlist}
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
            max={250}
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
            onPatch={patchSettingsDraft}
            onApply={applySettingsDraft}
            onReset={resetSettingsDraft}
          />
        ) : null}
      </header>

      <div
        style={{
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr)",
          gap: sp(10),
        }}
      >
        <Card
          noPad
          data-testid="signals-table-card"
          style={{
            minHeight: 0,
            display: "grid",
            gridTemplateRows: "auto minmax(0, 1fr)",
            overflow: "hidden",
          }}
        >
          <SignalsHydrationStrip
            hydrated={matrixHydrationHydrated}
            missing={matrixHydrationMissing}
            phone={phone}
            total={matrixHydrationTotal}
            visibleCount={visibleHydrationSymbols.length}
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
              minHeight={240}
              fill
            />
          ) : (
            <DenseVirtualTable
              columnOrder={columns.map((column) => column.id)}
              columns={columns}
              data={filteredRows}
              getRowId={(row) => row.id}
              lockedColumnIds={SIGNALS_LOCKED_COLUMN_IDS}
              rowHeight={phone ? 46 : 42}
              rowDetailHeight={phone ? 820 : compact ? 720 : 650}
              rowDetailTestId="signals-table-row-drilldown"
              minWidth={minTableWidth}
              onColumnOrderChange={handleSignalsColumnOrderChange}
              onSortChange={handleSignalsSortChange}
              onVisibleRowsChange={handleVisibleRowsChange}
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
                columnGap: sp(6),
                padding: sp("0 10px"),
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
                    columnGap: sp(6),
                    padding: sp("0 10px"),
                    borderBottom: `1px solid ${
                      expandedRow ? cssColorMix(tone, 42) : CSS_COLOR.border
                    }`,
                    background: expandedRow
                      ? cssColorMix(tone, 12)
                      : activeRow
                        ? cssColorMix(tone, 8)
                        : row.fresh
                          ? cssColorMix(tone, 5)
                          : "transparent",
                    cursor: "pointer",
                    transition: "background-color 160ms ease-out, border-color 160ms ease-out",
                  },
                };
              }}
              getCellProps={() => ({
                style: {
                  padding: sp("0 6px"),
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
          )}
        </Card>
      </div>
    </section>
  );
}
