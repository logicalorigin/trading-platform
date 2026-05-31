import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  useGetSignalMonitorProfile,
  useGetSignalMonitorState,
  useListSignalMonitorEvents,
} from "@workspace/api-client-react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Clock3,
  ExternalLink,
  ListFilter,
  Power,
  RefreshCw,
  ScanLine,
  Search,
} from "lucide-react";
import { DenseVirtualTable } from "../components/platform/DenseVirtualTable.jsx";
import {
  Badge,
  Card,
  DataUnavailableState,
  StatusPill,
} from "../components/platform/primitives.jsx";
import { SignalDots } from "../components/platform/signal-language";
import { AppTooltip } from "@/components/ui/tooltip";
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
import { useViewport } from "../lib/responsive";
import {
  SIGNALS_ROW_STATUS,
  SIGNALS_TABLE_TIMEFRAMES,
  buildSignalsRows,
  filterSignalsRows,
  sortSignalsRows,
  summarizeSignalsRows,
} from "../features/signals/signalsRowModel.js";

const SIGNALS_EVENT_LIMIT = 250;
const SIGNAL_STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: SIGNALS_ROW_STATUS.activeFresh, label: "Fresh" },
  { value: SIGNALS_ROW_STATUS.activeStale, label: "Stale" },
  { value: SIGNALS_ROW_STATUS.problem, label: "Attention" },
  { value: SIGNALS_ROW_STATUS.skipped, label: "Skipped" },
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
const SIGNAL_TIMEFRAME_OPTIONS = ["1m", "5m", "15m", "1h", "1d"];

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

const formatBars = (value) =>
  Number.isFinite(Number(value)) ? `${Number(value)} bars` : MISSING_VALUE;

const formatCount = (value) => new Intl.NumberFormat("en-US").format(value || 0);

const getActiveWatchlistId = (profile, defaultWatchlist) =>
  profile?.watchlistId || defaultWatchlist?.id || "";

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

function NumberField({ label, value, min, max, onCommit }) {
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
    const clamped = Math.max(min, Math.min(max, Math.round(numeric)));
    setDraft(clamped);
    onCommit?.(clamped);
  }, [draft, max, min, onCommit, value]);

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

function MetricTile({ label, value, tone = CSS_COLOR.text }) {
  return (
    <div
      style={{
        display: "grid",
        gap: sp(2),
        minWidth: dim(86),
        padding: sp("7px 9px"),
        border: `1px solid ${CSS_COLOR.border}`,
        borderRadius: dim(RADII.sm),
        background: CSS_COLOR.bg1,
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
        {label}
      </span>
      <span
        style={{
          color: tone,
          fontSize: fs(17),
          fontWeight: FONT_WEIGHTS.medium,
          lineHeight: 1,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
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

function SignalsDetailPanel({ row, onJumpToTrade }) {
  if (!row) {
    return (
      <Card
        data-testid="signals-detail-empty"
        style={{
          height: "100%",
          minHeight: dim(280),
          display: "grid",
          placeItems: "center",
        }}
      >
        <DataUnavailableState
          title="No ticker selected"
          detail="Signal detail is empty."
          minHeight={160}
        />
      </Card>
    );
  }
  const statusTone = toneForStatus(row.status);
  const latestEvent = row.latestEvent;
  const matrixEntries = SIGNALS_TABLE_TIMEFRAMES.map((timeframe) => ({
    timeframe,
    state: row.matrixStatesByTimeframe?.[timeframe] || null,
  }));

  return (
    <Card
      data-testid="signals-detail-panel"
      style={{
        height: "100%",
        minHeight: dim(280),
        display: "grid",
        alignContent: "start",
        gap: sp(12),
        padding: sp(12),
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: sp(10) }}>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              color: CSS_COLOR.textMuted,
              fontSize: fs(10),
              fontWeight: FONT_WEIGHTS.label,
              letterSpacing: 0,
              textTransform: "uppercase",
            }}
          >
            Signal detail
          </div>
          <h2
            style={{
              margin: 0,
              color: CSS_COLOR.text,
              fontSize: fs(24),
              fontWeight: FONT_WEIGHTS.medium,
              letterSpacing: 0,
              lineHeight: 1.05,
            }}
          >
            {row.symbol}
          </h2>
        </div>
        <Badge color={statusTone}>{row.statusLabel}</Badge>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: sp(8) }}>
        <DetailStat label="Direction" value={row.direction || "none"} tone={toneForDirection(row.direction)} />
        <DetailStat label="Bars" value={formatBars(row.barsSinceSignal)} />
        <DetailStat label="Signal" value={formatTime(row.currentSignalAt)} />
        <DetailStat label="Price" value={formatQuotePrice(row.currentSignalPrice)} />
      </div>

      <div style={{ display: "grid", gap: sp(8) }}>
        <SectionLabel>Matrix</SectionLabel>
        <div style={{ display: "grid", gap: sp(6) }}>
          {matrixEntries.map(({ timeframe, state }) => (
            <div
              key={timeframe}
              style={{
                display: "grid",
                gridTemplateColumns: "44px 1fr auto",
                gap: sp(8),
                alignItems: "center",
                minHeight: dim(28),
                color: CSS_COLOR.textSec,
                fontSize: textSize("body"),
              }}
            >
              <span style={{ color: CSS_COLOR.textMuted, fontWeight: FONT_WEIGHTS.label }}>
                {timeframe}
              </span>
              <DirectionBadge direction={state?.currentSignalDirection} />
              <span style={{ color: CSS_COLOR.textDim }}>
                {state ? formatBars(state.barsSinceSignal) : MISSING_VALUE}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gap: sp(8) }}>
        <SectionLabel>Coverage</SectionLabel>
        <div style={{ color: CSS_COLOR.textSec, fontSize: textSize("body"), lineHeight: 1.35 }}>
          {row.coverageReason}
        </div>
        {row.watchlistLabels.length ? (
          <div style={{ display: "flex", gap: sp(6), flexWrap: "wrap" }}>
            {row.watchlistLabels.map((label) => (
              <Badge key={label} color={CSS_COLOR.textDim} variant="outline">
                {label}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>

      {latestEvent ? (
        <div style={{ display: "grid", gap: sp(8) }}>
          <SectionLabel>Latest Event</SectionLabel>
          <div
            style={{
              display: "grid",
              gap: sp(4),
              color: CSS_COLOR.textSec,
              fontSize: textSize("body"),
            }}
          >
            <span>{`${String(latestEvent.direction || "").toUpperCase()} ${latestEvent.timeframe || ""}`}</span>
            <span style={{ color: CSS_COLOR.textDim }}>
              {formatTime(latestEvent.emittedAt || latestEvent.signalAt)}
            </span>
          </div>
        </div>
      ) : null}

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
          <AlertTriangle size={16} strokeWidth={2} aria-hidden="true" />
          <span>{row.lastError}</span>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => onJumpToTrade?.(row.symbol)}
        style={{ ...textButtonStyle, width: "100%", marginTop: sp(4) }}
      >
        <ExternalLink size={15} strokeWidth={2} aria-hidden="true" />
        Trade
      </button>
    </Card>
  );
}

function DetailStat({ label, value, tone = CSS_COLOR.text }) {
  return (
    <div
      style={{
        minWidth: 0,
        border: `1px solid ${CSS_COLOR.border}`,
        borderRadius: dim(RADII.sm),
        padding: sp("8px 9px"),
        background: CSS_COLOR.bg2,
      }}
    >
      <div
        style={{
          color: CSS_COLOR.textMuted,
          fontSize: fs(10),
          fontWeight: FONT_WEIGHTS.label,
          letterSpacing: 0,
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div
        style={{
          ...cellTextStyle,
          color: tone,
          fontSize: textSize("bodyStrong"),
          fontWeight: FONT_WEIGHTS.medium,
          marginTop: sp(3),
        }}
      >
        {value || MISSING_VALUE}
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
}) {
  const viewport = useViewport();
  const compact = viewport.width > 0 && viewport.width < 980;
  const phone = viewport.width > 0 && viewport.width < 720;
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [directionFilter, setDirectionFilter] = useState("all");
  const [sortKey, setSortKey] = useState("priority");
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const active = isVisible !== false;
  const signalMonitorParams = useMemo(() => ({ environment }), [environment]);
  const signalMonitorEventsParams = useMemo(
    () => ({ environment, limit: SIGNALS_EVENT_LIMIT }),
    [environment],
  );
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
      enabled: active,
      staleTime: 10_000,
      refetchInterval: active ? 15_000 : false,
      retry: false,
    },
  });
  const profile = stateQuery.data?.profile || profileQuery.data || null;
  const stateResponse = useMemo(
    () =>
      stateQuery.data || {
        profile,
        states: [],
        universeSymbols: signalMonitorSymbols,
        skippedSymbols: [],
        universe: null,
      },
    [profile, signalMonitorSymbols, stateQuery.data],
  );
  const rows = useMemo(
    () =>
      buildSignalsRows({
        stateResponse,
        matrixStates: signalMatrixStates,
        events: eventsQuery.data?.events || [],
        watchlists,
      }),
    [eventsQuery.data?.events, signalMatrixStates, stateResponse, watchlists],
  );
  const filteredRows = useMemo(
    () =>
      sortSignalsRows(
        filterSignalsRows(rows, {
          query,
          status: statusFilter,
          direction: directionFilter,
        }),
        { sortKey },
      ),
    [directionFilter, query, rows, sortKey, statusFilter],
  );
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
    if (!selectedSymbol && filteredRows[0]?.symbol) {
      setSelectedSymbol(filteredRows[0].symbol);
    }
  }, [filteredRows, selectedSymbol]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    Promise.allSettled([
      profileQuery.refetch(),
      stateQuery.refetch(),
      eventsQuery.refetch(),
    ]).finally(() => setRefreshing(false));
  }, [eventsQuery, profileQuery, stateQuery]);

  const handleRowSelect = useCallback(
    (row) => {
      setSelectedSymbol(row.symbol);
      onSelectSymbol?.(row.symbol);
    },
    [onSelectSymbol],
  );

  const columns = useMemo(
    () => [
      {
        id: "symbol",
        header: "Ticker",
        meta: { width: phone ? "minmax(76px, 1fr)" : "minmax(128px, 1.05fr)" },
        cell: ({ row }) => {
          const item = row.original;
          return (
            <button
              type="button"
              onClick={() => handleRowSelect(item)}
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
                  ...cellTextStyle,
                  maxWidth: "100%",
                  fontWeight: FONT_WEIGHTS.label,
                  letterSpacing: 0,
                }}
              >
                {item.symbol}
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
        id: "matrix",
        header: "Matrix",
        meta: { width: phone ? "68px" : "100px" },
        cell: ({ row }) => (
          <SignalDots
            statesByTimeframe={row.original.matrixStatesByTimeframe}
            timeframes={SIGNALS_TABLE_TIMEFRAMES}
            testId="signals-row-dots"
          />
        ),
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
    ].filter(Boolean),
    [handleRowSelect, onJumpToTrade, phone],
  );

  const loading = stateQuery.isLoading || profileQuery.isLoading;
  const errored = stateQuery.isError || profileQuery.isError || eventsQuery.isError;
  const cacheTone =
    stateQuery.data?.cacheStatus === "hit"
      ? CSS_COLOR.green
      : stateQuery.data?.cacheStatus === "stale"
        ? CSS_COLOR.amber
        : CSS_COLOR.textDim;
  const minTableWidth = phone ? "100%" : dim(900);
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
          <MetricTile label="Tracked" value={formatCount(summary.total)} />
          <MetricTile label="Fresh" value={formatCount(summary.fresh)} tone={CSS_COLOR.green} />
          <MetricTile label="Buy" value={formatCount(summary.buy)} tone={CSS_COLOR.blue} />
          <MetricTile label="Sell" value={formatCount(summary.sell)} tone={CSS_COLOR.red} />
          <MetricTile label="Attention" value={formatCount(summary.problem)} tone={CSS_COLOR.amber} />
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
            onChange={setSortKey}
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
            <AppTooltip content={profile?.enabled ? "Turn monitor off" : "Turn monitor on"}>
              <button
                type="button"
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
              <button type="button" onClick={onScanNow} style={iconButtonStyle}>
                <ScanLine size={15} strokeWidth={2} aria-hidden="true" />
              </button>
            </AppTooltip>
            <AppTooltip content="Refresh">
              <button
                type="button"
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
      </header>

      <div
        style={{
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: compact ? "minmax(0, 1fr)" : "minmax(0, 1fr) minmax(280px, 340px)",
          gap: sp(10),
        }}
      >
        <Card
          noPad
          data-testid="signals-table-card"
          style={{
            minHeight: 0,
            display: "grid",
            gridTemplateRows: "minmax(0, 1fr)",
          }}
        >
          {errored ? (
            <DataUnavailableState
              title="Signals unavailable"
              detail={
                stateQuery.error?.message ||
                profileQuery.error?.message ||
                eventsQuery.error?.message ||
                "Signal monitor data could not be loaded."
              }
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
              columns={columns}
              data={filteredRows}
              getRowId={(row) => row.id}
              rowHeight={42}
              minWidth={minTableWidth}
              rowTestId="signals-table-row"
              headerStyle={{
                minWidth: minTableWidth,
                minHeight: dim(34),
                alignItems: "center",
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
                const tone = toneForStatus(row.status);
                return {
                  onClick: () => handleRowSelect(row),
                  "aria-selected": activeRow ? "true" : "false",
                  style: {
                    minWidth: minTableWidth,
                    alignItems: "center",
                    padding: sp("0 10px"),
                    borderBottom: `1px solid ${CSS_COLOR.border}`,
                    background: activeRow
                      ? cssColorMix(tone, 10)
                      : row.fresh
                        ? cssColorMix(tone, 5)
                        : "transparent",
                    cursor: "pointer",
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

        {compact ? null : (
          <SignalsDetailPanel row={selectedRow} onJumpToTrade={onJumpToTrade} />
        )}
      </div>

      {compact && selectedRow ? (
        <div style={{ display: phone ? "none" : "block" }}>
          <SignalsDetailPanel row={selectedRow} onJumpToTrade={onJumpToTrade} />
        </div>
      ) : null}
    </section>
  );
}
