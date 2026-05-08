import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ChevronDown,
  Gauge,
  Power,
  RefreshCw,
} from "lucide-react";
import {
  Card,
  CardTitle,
  DataUnavailableState,
} from "../../components/platform/primitives.jsx";
import {
  fmtM,
  formatQuotePrice,
  formatRelativeTimeShort,
} from "../../lib/formatters";
import {
  T,
  dim,
  fs,
  sp,
} from "../../lib/uiTokens";
import {
  joinMotionClasses,
  motionRowStyle,
  motionVars,
} from "../../lib/motion";
import {
  SIGNAL_MONITOR_TIMEFRAMES,
  buildMarketActivityLanes,
  normalizeSignalMonitorTimeframe,
} from "../platform/marketActivityLaneModel";
import {
  isSignalMonitorDegradedProfile,
  isSignalMonitorRuntimeFallbackProfile,
} from "../platform/signalMonitorStatusModel";
import { AppTooltip } from "@/components/ui/tooltip";


export const UNUSUAL_THRESHOLD_OPTIONS = [
  { value: 1, label: "1× OI" },
  { value: 2, label: "2× OI" },
  { value: 3, label: "3× OI" },
  { value: 5, label: "5× OI" },
  { value: 10, label: "10× OI" },
];

const SIGNAL_TIMEFRAME_LABELS = {
  "1m": "1M",
  "5m": "5M",
  "15m": "15M",
  "1h": "1H",
  "1d": "1D",
};

const MarketActivityLaneSection = ({
  title,
  meta,
  controls,
  children,
  compact = false,
  testId,
  dataAttrs,
}) => (
  <section
    data-testid={testId}
    {...(dataAttrs || {})}
    style={{
      minWidth: 0,
      minHeight: 0,
      display: "flex",
      flexDirection: "column",
      borderTop: `1px solid ${T.border}`,
      paddingTop: sp(7),
    }}
  >
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: sp(8),
        marginBottom: sp(6),
        minWidth: 0,
        flexWrap: "wrap",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            color: T.text,
            fontFamily: T.display,
            fontSize: fs(compact ? 10 : 11),
            fontWeight: 400,
            lineHeight: 1.15,
          }}
        >
          {title}
        </div>
        {meta ? (
          <div
            style={{
              marginTop: 1,
              color: T.textDim,
              fontFamily: T.mono,
              fontSize: fs(8),
              fontWeight: 400,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {meta}
          </div>
        ) : null}
      </div>
      {controls ? (
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: sp(4),
            flexWrap: "wrap",
            minWidth: 0,
          }}
        >
          {controls}
        </div>
      ) : null}
    </div>
    {children}
  </section>
);

const SignalTimeframeTypeahead = ({ value, onChange }) => {
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const listboxIdRef = useRef(
    `signal-timeframe-listbox-${Math.random().toString(36).slice(2)}`,
  );
  const selected = normalizeSignalMonitorTimeframe(value);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(
    SIGNAL_TIMEFRAME_LABELS[selected] || selected,
  );
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!open) {
      setQuery(SIGNAL_TIMEFRAME_LABELS[selected] || selected.toUpperCase());
      setActiveIndex(0);
    }
  }, [open, selected]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return undefined;
    const handlePointerDown = (event) => {
      if (rootRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  const normalizedQuery = query.trim().toLowerCase();
  const options =
    !normalizedQuery || normalizedQuery === selected
      ? SIGNAL_MONITOR_TIMEFRAMES
      : SIGNAL_MONITOR_TIMEFRAMES.filter((timeframe) =>
          timeframe.toLowerCase().includes(normalizedQuery),
        );
  const visibleOptions = options.length ? options : SIGNAL_MONITOR_TIMEFRAMES;

  const commit = useCallback(
    (timeframe) => {
      const normalized = normalizeSignalMonitorTimeframe(timeframe);
      setOpen(false);
      setQuery(SIGNAL_TIMEFRAME_LABELS[normalized] || normalized.toUpperCase());
      onChange?.(normalized);
    },
    [onChange],
  );

  const handleKeyDown = useCallback(
    (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setOpen(true);
        setActiveIndex((current) =>
          Math.min(current + 1, visibleOptions.length - 1),
        );
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setOpen(true);
        setActiveIndex((current) => Math.max(current - 1, 0));
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        commit(visibleOptions[activeIndex] || selected);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
    },
    [activeIndex, commit, selected, visibleOptions],
  );

  return (
    <div
      ref={rootRef}
      style={{
        position: "relative",
        width: dim(56),
        minWidth: dim(56),
      }}
    >
      <input
        ref={inputRef}
        data-testid="market-signal-interval-input"
        role="combobox"
        aria-label="Signal monitor interval"
        aria-expanded={open}
        aria-controls={listboxIdRef.current}
        aria-autocomplete="list"
        aria-activedescendant={
          open ? `${listboxIdRef.current}-option-${activeIndex}` : undefined
        }
        value={query}
        onFocus={(event) => {
          setOpen(true);
          event.currentTarget.select();
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActiveIndex(0);
        }}
        onKeyDown={handleKeyDown}
        style={{
          width: "100%",
          background: T.bg2,
          border: `1px solid ${T.border}`,
          color: T.textSec,
          fontFamily: T.mono,
          fontSize: fs(8),
          fontWeight: 400,
          padding: sp("5px 18px 5px 6px"),
          borderRadius: 0,
          outline: "none",
          textTransform: "uppercase",
        }}
      />
      <ChevronDown
        aria-hidden="true"
        size={dim(11)}
        strokeWidth={2.4}
        style={{
          position: "absolute",
          right: 5,
          top: "50%",
          transform: "translateY(-50%)",
          color: T.textDim,
          pointerEvents: "none",
        }}
      />
      {open ? (
        <div
          id={listboxIdRef.current}
          role="listbox"
          style={{
            position: "absolute",
            zIndex: 100,
            left: 0,
            right: 0,
            top: "calc(100% + 3px)",
            background: T.bg2,
            border: `1px solid ${T.border}`,
            boxShadow: "0 14px 28px rgba(0,0,0,0.28)",
            maxHeight: dim(150),
            overflowY: "auto",
          }}
        >
          {visibleOptions.map((timeframe, index) => {
            const active = index === activeIndex;
            const selectedOption = timeframe === selected;
            return (
              <button
                key={timeframe}
                id={`${listboxIdRef.current}-option-${index}`}
                data-testid={`market-signal-interval-option-${timeframe}`}
                type="button"
                role="option"
                aria-selected={selectedOption}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => commit(timeframe)}
                style={{
                  width: "100%",
                  border: "none",
                  borderBottom: `1px solid ${T.border}55`,
                  background: active
                    ? T.bg3
                    : selectedOption
                      ? T.accentDim
                      : T.bg2,
                  color: selectedOption ? T.accent : T.textSec,
                  cursor: "pointer",
                  fontFamily: T.mono,
                  fontSize: fs(8),
                  fontWeight: 400,
                  padding: sp("5px 6px"),
                  textAlign: "left",
                }}
              >
                {SIGNAL_TIMEFRAME_LABELS[timeframe]}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};

const MarketLaneToolbar = ({ children }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: sp(4),
      minWidth: 0,
      marginBottom: sp(6),
      whiteSpace: "nowrap",
    }}
  >
    {children}
  </div>
);

const MarketIconToolButton = ({
  Icon,
  active = false,
  disabled = false,
  tone = T.accent,
  label,
  title,
  onClick,
}) => (
  <AppTooltip content={title || label}><button
    type="button"
    aria-label={label}
    onClick={onClick}
    disabled={disabled}
    style={{
      width: dim(28),
      height: dim(28),
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      flex: "0 0 auto",
      border: `1px solid ${active ? tone : T.border}`,
      background: active ? `${tone}16` : T.bg2,
      color: active ? tone : T.textDim,
      cursor: disabled ? "wait" : "pointer",
      opacity: disabled ? 0.78 : 1,
      borderRadius: 0,
      padding: 0,
    }}
  >
    <Icon size={dim(13)} strokeWidth={2.4} />
  </button></AppTooltip>
);

const MarketToolbarLabel = ({ Icon, label, tone = T.textDim }) => (
  <AppTooltip content={label}><span
    style={{
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: dim(28),
      height: dim(28),
      flex: "0 0 auto",
      border: `1px solid ${tone}36`,
      background: `${tone}10`,
      color: tone,
    }}
  >
    <Icon size={dim(13)} strokeWidth={2.4} />
  </span></AppTooltip>
);

const getNotificationLaneTone = (item) => {
  if (item.kind === "alert") {
    return item.tone === "profit"
      ? { label: "ALERT", color: T.green, background: `${T.green}12` }
      : { label: "RISK", color: T.red, background: `${T.red}12` };
  }
  if (item.kind === "calendar") {
    return { label: "CAL", color: T.amber, background: `${T.amber}12` };
  }
  return { label: "NEWS", color: T.accent, background: `${T.accent}12` };
};

const getSignalLaneTone = (item) =>
  item.direction === "sell"
    ? { label: "SELL", color: T.red, background: `${T.red}12` }
    : { label: "BUY", color: T.green, background: `${T.green}12` };

const MarketSignalRow = ({ item, index, maxItems, onClick }) => {
  const tone = getSignalLaneTone(item);
  return (
    <AppTooltip key={item.id} content={item.title}><button
      key={item.id}
      type="button"
      className={joinMotionClasses("ra-row-enter", "ra-interactive")}
      onClick={onClick}
      style={{
        ...motionRowStyle(index, maxItems, 100),
        ...motionVars({ accent: tone.color }),
        width: "100%",
        display: "grid",
        gridTemplateColumns: "auto minmax(0, 1fr) auto",
        alignItems: "center",
        gap: sp(6),
        minWidth: 0,
        padding: sp("6px 6px"),
        border: `1px solid ${tone.color}38`,
        borderLeft: `3px solid ${tone.color}`,
        background: tone.background,
        textAlign: "left",
        cursor: "pointer",
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = `${tone.color}1f`;
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = tone.background;
      }}
    >
      <span
        style={{
          color: tone.color,
          border: `1px solid ${tone.color}55`,
          background: `${tone.color}14`,
          fontFamily: T.mono,
          fontSize: fs(7),
          fontWeight: 400,
          letterSpacing: "0.04em",
          lineHeight: 1,
          padding: sp("3px 4px"),
          minWidth: dim(30),
          textAlign: "center",
        }}
      >
        {tone.label}
      </span>
      <span style={{ minWidth: 0 }}>
        <span
          style={{
            display: "block",
            color: T.text,
            fontFamily: T.sans,
            fontSize: fs(9),
            fontWeight: 400,
            lineHeight: 1.2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {item.symbol}
        </span>
        <span
          style={{
            display: "block",
            color: T.textSec,
            fontFamily: T.sans,
            fontSize: fs(8),
            lineHeight: 1.2,
            marginTop: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {item.detail}
        </span>
      </span>
      <span
        style={{
          color: T.textMuted,
          fontFamily: T.mono,
          fontSize: fs(7),
          fontWeight: 400,
          whiteSpace: "nowrap",
        }}
      >
        {item.meta}
      </span>
    </button></AppTooltip>
  );
};

const getUnusualLaneTone = (item) => {
  const right = String(item.raw?.cp || item.raw?.right || item.type || "")
    .trim()
    .toLowerCase();
  const text = [
    item.raw?.sentiment,
    item.raw?.bias,
    item.raw?.side,
    item.side,
    item.type,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const isBearish = /bear|sell|sold|bid|below/.test(text);
  const isBullish = /bull|buy|bought|ask|above/.test(text);
  const isPut = right === "p" || right === "put" || /put/.test(right);
  const isCall = right === "c" || right === "call" || /call/.test(right);
  const color =
    isBearish && !isBullish
      ? T.red
      : isBullish && !isBearish
        ? T.green
        : isPut
          ? T.red
          : isCall
            ? T.green
            : T.amber;
  return {
    label: isPut ? "PUT" : isCall ? "CALL" : "FLOW",
    color,
    background: `${color}12`,
  };
};

const MarketUnusualRow = ({ item, index, maxItems, onClick }) => {
  const tone = getUnusualLaneTone(item);
  return (
    <AppTooltip key={item.id} content={item.title}><button
      key={item.id}
      type="button"
      className={joinMotionClasses("ra-row-enter", "ra-interactive")}
      onClick={onClick}
      style={{
        ...motionRowStyle(index, maxItems, 100),
        ...motionVars({ accent: tone.color }),
        width: "100%",
        display: "grid",
        gridTemplateColumns: "auto minmax(0, 1fr) auto",
        alignItems: "center",
        gap: sp(6),
        minWidth: 0,
        padding: sp("6px 6px"),
        border: `1px solid ${tone.color}34`,
        borderLeft: `3px solid ${tone.color}`,
        background: tone.background,
        textAlign: "left",
        cursor: "pointer",
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = `${tone.color}1f`;
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = tone.background;
      }}
    >
      <span
        style={{
          color: tone.color,
          border: `1px solid ${tone.color}55`,
          background: `${tone.color}14`,
          fontFamily: T.mono,
          fontSize: fs(7),
          fontWeight: 400,
          letterSpacing: "0.04em",
          lineHeight: 1,
          padding: sp("3px 4px"),
          minWidth: dim(34),
          textAlign: "center",
        }}
      >
        {tone.label}
      </span>
      <span style={{ minWidth: 0 }}>
        <span
          style={{
            display: "block",
            color: T.text,
            fontFamily: T.sans,
            fontSize: fs(9),
            fontWeight: 400,
            lineHeight: 1.2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {item.title}
        </span>
        <span
          style={{
            display: "block",
            color: T.textSec,
            fontFamily: T.sans,
            fontSize: fs(8),
            lineHeight: 1.2,
            marginTop: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {item.detail}
        </span>
      </span>
      <span
        style={{
          color: T.textMuted,
          fontFamily: T.mono,
          fontSize: fs(7),
          fontWeight: 400,
          whiteSpace: "nowrap",
        }}
      >
        {item.meta}
      </span>
    </button></AppTooltip>
  );
};

const MarketNotificationRow = ({
  item,
  index,
  maxItems,
  onClick,
  cursor = "pointer",
}) => {
  const tone = getNotificationLaneTone(item);
  return (
    <AppTooltip key={item.id} content={item.title}><button
      key={item.id}
      type="button"
      className={joinMotionClasses("ra-row-enter", "ra-interactive")}
      onClick={onClick}
      style={{
        ...motionRowStyle(index, maxItems, 90),
        ...motionVars({ accent: tone.color }),
        width: "100%",
        display: "grid",
        gridTemplateColumns: "auto minmax(0, 1fr) auto",
        alignItems: "center",
        gap: sp(6),
        minWidth: 0,
        padding: sp("5px 6px"),
        border: `1px solid ${tone.color}33`,
        background: tone.background,
        textAlign: "left",
        cursor,
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = `${tone.color}1c`;
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = tone.background;
      }}
    >
      <span
        style={{
          color: tone.color,
          border: `1px solid ${tone.color}55`,
          background: `${tone.color}12`,
          fontFamily: T.mono,
          fontSize: fs(7),
          fontWeight: 400,
          letterSpacing: "0.04em",
          lineHeight: 1,
          padding: sp("3px 4px"),
          minWidth: dim(32),
          textAlign: "center",
        }}
      >
        {tone.label}
      </span>
      <span style={{ minWidth: 0 }}>
        <span
          style={{
            display: "block",
            color: T.text,
            fontFamily: T.sans,
            fontSize: fs(9),
            fontWeight: 400,
            lineHeight: 1.2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {item.title}
        </span>
        <span
          style={{
            display: "block",
            color: T.textSec,
            fontFamily: T.sans,
            fontSize: fs(8),
            lineHeight: 1.2,
            marginTop: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {item.detail || item.meta}
        </span>
      </span>
      <span
        style={{
          color: T.textMuted,
          fontFamily: T.mono,
          fontSize: fs(7),
          fontWeight: 400,
          whiteSpace: "nowrap",
        }}
      >
        {item.meta}
      </span>
    </button></AppTooltip>
  );
};

export const MarketActivityPanel = ({
  notifications = [],
  highlightedUnusualFlow = [],
  signalEvents = [],
  signalStates = [],
  signalMonitorProfile = null,
  signalMonitorPending = false,
  signalMonitorDegraded = false,
  watchlists = [],
  newsItems = [],
  calendarItems = [],
  onSymClick,
  onSignalAction,
  onScanNow,
  onToggleMonitor,
  onChangeMonitorTimeframe,
  onChangeMonitorWatchlist,
  unusualThreshold = 1,
  onChangeUnusualThreshold,
  appliedUnusualThreshold = null,
  appliedUnusualThresholdConsistent = true,
  flowStatus = "loading",
  flowProviderSummary = null,
  flowSnapshotSource = "shared-runtime",
}) => {
  const monitorTimeframe = normalizeSignalMonitorTimeframe(
    signalMonitorProfile?.timeframe,
  );
  const monitorDegraded = Boolean(
    signalMonitorDegraded || isSignalMonitorDegradedProfile(signalMonitorProfile),
  );
  const monitorRuntimeFallback = isSignalMonitorRuntimeFallbackProfile(
    signalMonitorProfile,
  );
  const lanes = useMemo(
    () =>
      buildMarketActivityLanes({
        notifications,
        highlightedUnusualFlow,
        signalEvents,
        signalStates,
        selectedTimeframe: monitorTimeframe,
        newsItems,
        calendarItems,
      }),
    [
      calendarItems,
      highlightedUnusualFlow,
      monitorTimeframe,
      newsItems,
      notifications,
      signalEvents,
      signalStates,
    ],
  );
  const freshSignalCount = signalStates.filter(
    (state) =>
      normalizeSignalMonitorTimeframe(state?.timeframe) === monitorTimeframe &&
      state?.fresh &&
      state?.status === "ok" &&
      (state?.currentSignalDirection === "buy" ||
        state?.currentSignalDirection === "sell"),
  ).length;
  const monitorMeta = signalMonitorPending
    ? "SCANNING"
    : monitorRuntimeFallback
      ? "RUNTIME"
    : monitorDegraded
      ? "DEGRADED"
    : signalMonitorProfile?.enabled
      ? `${freshSignalCount} FRESH`
      : "PAUSED";
  const monitorWatchlistId = signalMonitorProfile?.watchlistId || "";
  const monitorWatchlistKnown = watchlists.some(
    (watchlist) => watchlist.id === monitorWatchlistId,
  );
  const appliedThresholdLabel =
    Number.isFinite(appliedUnusualThreshold) && appliedUnusualThreshold > 0
      ? `${appliedUnusualThreshold % 1 === 0 ? appliedUnusualThreshold.toFixed(0) : appliedUnusualThreshold.toFixed(1)}× OI${appliedUnusualThresholdConsistent ? "" : "*"}`
      : null;
  const requestedThreshold = Number(unusualThreshold) || 1;
  const thresholdMatches =
    Number.isFinite(appliedUnusualThreshold) &&
    Math.abs(appliedUnusualThreshold - requestedThreshold) < 0.001 &&
    appliedUnusualThresholdConsistent;
  const flowProviders = Array.isArray(flowProviderSummary?.providers)
    ? flowProviderSummary.providers.filter(Boolean)
    : [];
  const firstSymbolSource = Object.values(
    flowProviderSummary?.sourcesBySymbol || {},
  )[0];
  const flowSourceProvider =
    flowProviders.includes("polygon") && flowProviders.includes("ibkr")
      ? "mixed"
      : flowProviders[0] || firstSymbolSource?.provider || "";
  const normalizedFlowSourceProvider =
    String(flowSourceProvider || "").trim().toUpperCase() || "NONE";
  const flowSourceLabel =
    flowProviderSummary?.label ||
    (flowStatus === "loading" ? "Loading flow" : "No IBKR flow");
  const flowSourceLive =
    normalizedFlowSourceProvider === "IBKR" &&
    !flowProviderSummary?.fallbackUsed &&
    flowStatus !== "offline";

  const renderEmptyLane = (title, detail) => (
    <DataUnavailableState title={title} detail={detail} />
  );

  const signalRows = lanes.signals.map((row) => ({
    ...row,
    title: `${row.directionLabel} · ${row.symbol}`,
    detail: `${row.timeframe} · ${formatQuotePrice(row.price)}`,
    meta: row.time ? formatRelativeTimeShort(row.time) : row.source.toUpperCase(),
    color: row.direction === "buy" ? T.green : T.red,
  }));
  const unusualRows = lanes.unusual.map((row) => {
    const scoreLabel =
      row.score > 0
        ? ` · ${row.score.toFixed(row.score >= 10 ? 0 : 1)}× OI`
        : "";
    return {
      ...row,
      title: `${row.symbol}${row.contract ? ` ${row.contract}` : ""}`,
      detail: `${row.side || "FLOW"} ${row.type || ""} · ${fmtM(row.premium)}${scoreLabel}`,
      meta: row.time ? formatRelativeTimeShort(row.time) : "now",
      color: T.amber,
    };
  });
  const notificationRows = lanes.notifications.map((row) => ({
    ...row,
    color:
      row.kind === "alert"
        ? row.tone === "profit"
          ? T.green
          : T.red
        : row.kind === "calendar"
          ? T.green
          : T.accent,
  }));
  const notificationTypeCounts = notificationRows.reduce(
    (counts, row) => {
      if (row.kind === "alert") counts.alerts += 1;
      if (row.kind === "news") counts.news += 1;
      if (row.kind === "calendar") counts.calendar += 1;
      return counts;
    },
    { alerts: 0, news: 0, calendar: 0 },
  );

  return (
    <Card
      data-testid="market-activity-panel-card"
      style={{
        padding: "7px 9px",
        height: "auto",
        maxHeight: "inherit",
        display: "flex",
        flexDirection: "column",
        overflowX: "hidden",
        overflowY: "auto",
      }}
    >
      <CardTitle
        right={
          <span
            style={{
              fontSize: fs(8),
              color: signalMonitorPending ? T.amber : T.textDim,
              fontFamily: T.sans,
              fontWeight: 400,
              letterSpacing: "0.08em",
            }}
          >
            {monitorMeta}
          </span>
        }
      >
        Activity & Notifications
      </CardTitle>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: sp(6),
          minHeight: 0,
          flex: "0 1 auto",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
            gap: sp(8),
            minHeight: 0,
            flex: "0 1 auto",
            alignItems: "start",
          }}
        >
          <MarketActivityLaneSection
            title="Signals"
            meta={`${SIGNAL_TIMEFRAME_LABELS[monitorTimeframe]} · ${signalRows.length} rows`}
            testId="market-activity-signals-lane"
          >
            <MarketLaneToolbar>
              <MarketIconToolButton
                Icon={Power}
                active={Boolean(signalMonitorProfile?.enabled && !monitorDegraded)}
                tone={
                  monitorRuntimeFallback
                    ? T.amber
                    : monitorDegraded
                    ? T.red
                    : signalMonitorProfile?.enabled
                      ? T.green
                      : T.textDim
                }
                label={
                  monitorRuntimeFallback
                    ? "Signal monitor runtime fallback"
                    : monitorDegraded
                    ? "Signal monitor degraded"
                    : "Toggle signal monitor"
                }
                onClick={onToggleMonitor}
              />
              <SignalTimeframeTypeahead
                value={monitorTimeframe}
                onChange={onChangeMonitorTimeframe}
              />
              <MarketIconToolButton
                Icon={RefreshCw}
                active={Boolean(signalMonitorPending)}
                disabled={signalMonitorPending}
                tone={signalMonitorPending ? T.amber : T.accent}
                label="Scan signal monitor now"
                onClick={onScanNow}
              />
              <select
                value={monitorWatchlistId}
                onChange={(event) =>
                  onChangeMonitorWatchlist?.(event.target.value || null)
                }
                disabled={!watchlists.length}
                aria-label="Signal monitor watchlist"
                style={{
                  minWidth: 0,
                  flex: "1 1 auto",
                  width: "100%",
                  background: T.bg2,
                  border: `1px solid ${T.border}`,
                  color: T.textSec,
                  fontFamily: T.mono,
                  fontSize: fs(8),
                  fontWeight: 400,
                  padding: sp("6px 5px"),
                  borderRadius: 0,
                  outline: "none",
                }}
              >
                <option value="">DEFAULT</option>
                {monitorWatchlistId && !monitorWatchlistKnown ? (
                  <option value={monitorWatchlistId}>CURRENT</option>
                ) : null}
                {watchlists.map((watchlist) => (
                  <option key={watchlist.id} value={watchlist.id}>
                    {watchlist.name || watchlist.id}
                  </option>
                ))}
              </select>
            </MarketLaneToolbar>
            {signalRows.length ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: sp(3),
                  overflowY: "auto",
                  minHeight: 0,
                  maxHeight: dim(230),
                }}
              >
                {signalRows.map((item, index) => (
                  <MarketSignalRow
                    key={item.id}
                    item={item}
                    index={index}
                    maxItems={signalRows.length}
                    onClick={() => onSignalAction?.(item.symbol, item.raw)}
                  />
                ))}
              </div>
            ) : (
              renderEmptyLane(
                "No signals for this interval",
                "Monitor results will appear here after the next scan.",
              )
            )}
          </MarketActivityLaneSection>

          <MarketActivityLaneSection
            title="Flow"
            meta={`${unusualRows.length} unusual rows · ${flowSourceLabel}`}
            testId="market-activity-flow-lane"
            dataAttrs={{
              "data-flow-snapshot-source": flowSnapshotSource,
              "data-flow-source-provider": normalizedFlowSourceProvider,
              "data-flow-source-live": flowSourceLive ? "true" : "false",
              "data-flow-fallback-used": flowProviderSummary?.fallbackUsed
                ? "true"
                : "false",
            }}
          >
            <MarketLaneToolbar>
              <MarketToolbarLabel
                Icon={Gauge}
                label="Flow threshold"
                tone={T.amber}
              />
              <AppTooltip content="Volume / open interest ratio at which a print is flagged as unusual."><select
                data-testid="market-flow-threshold-select"
                value={String(unusualThreshold)}
                onChange={(event) =>
                  onChangeUnusualThreshold?.(Number(event.target.value))
                }
                aria-label="Flow threshold"
                style={{
                  width: dim(76),
                  flex: "0 0 auto",
                  background: T.bg2,
                  border: `1px solid ${T.border}`,
                  color: T.textSec,
                  fontFamily: T.mono,
                  fontSize: fs(8),
                  fontWeight: 400,
                  padding: sp("6px 5px"),
                  borderRadius: 0,
                  outline: "none",
                }}
              >
                {UNUSUAL_THRESHOLD_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select></AppTooltip>
              {appliedThresholdLabel ? (
                <AppTooltip content={
                    thresholdMatches
                      ? "Server confirmed it applied your selected unusual-options threshold."
                      : appliedUnusualThresholdConsistent
                        ? "The live feed is using a different threshold than the one you selected."
                        : "Different symbols returned different applied thresholds; showing the most common one."
                  }><span
                  style={{
                    minWidth: 0,
                    flex: "1 1 auto",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    color: thresholdMatches ? T.textDim : T.amber,
                    fontFamily: T.mono,
                    fontSize: fs(8),
                    fontWeight: 400,
                    border: `1px solid ${(thresholdMatches ? T.textDim : T.amber)}40`,
                    background: `${thresholdMatches ? T.textDim : T.amber}12`,
                    padding: sp("6px 5px"),
                    borderRadius: 0,
                    whiteSpace: "nowrap",
                    textAlign: "center",
                  }}
                >
                  {appliedThresholdLabel}
                </span></AppTooltip>
              ) : null}
            </MarketLaneToolbar>
            {unusualRows.length ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: sp(3),
                  overflowY: "auto",
                  minHeight: 0,
                  maxHeight: dim(230),
                }}
              >
                {unusualRows.map((item, index) => (
                  <MarketUnusualRow
                    key={item.id}
                    item={item}
                    index={index}
                    maxItems={unusualRows.length}
                    onClick={() => onSymClick?.(item.symbol)}
                  />
                ))}
              </div>
            ) : (
              renderEmptyLane(
                "No unusual options",
                "Prints meeting the selected OI threshold will appear here.",
              )
            )}
          </MarketActivityLaneSection>
        </div>

        <MarketActivityLaneSection
          title="Notifications"
          meta={`${notificationRows.length} secondary items`}
          compact
          testId="market-activity-notifications-lane"
          controls={
            <>
              {[
                ["ALERT", notificationTypeCounts.alerts, T.red],
                ["NEWS", notificationTypeCounts.news, T.accent],
                ["CAL", notificationTypeCounts.calendar, T.amber],
              ].map(([label, count, color]) => (
                <span
                  key={label}
                  style={{
                    color,
                    border: `1px solid ${color}44`,
                    background: `${color}12`,
                    fontFamily: T.mono,
                    fontSize: fs(7),
                    fontWeight: 400,
                    lineHeight: 1,
                    padding: sp("3px 4px"),
                    whiteSpace: "nowrap",
                  }}
                >
                  {label} {count}
                </span>
              ))}
            </>
          }
        >
          {notificationRows.length ? (
            <div
              className="ra-scrollbar-hidden"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                gap: sp(4),
                overflowY: "auto",
                minHeight: 0,
                maxHeight: dim(116),
              }}
            >
              {notificationRows.map((item, index) => {
                const clickable =
                  Boolean(item.articleUrl) ||
                  (item.symbol && item.kind !== "news");
                return (
                  <MarketNotificationRow
                    key={item.id}
                    item={item}
                    index={index}
                    maxItems={notificationRows.length}
                    cursor={clickable ? "pointer" : "default"}
                    onClick={() => {
                      if (item.articleUrl && typeof window !== "undefined") {
                        window.open(
                          item.articleUrl,
                          "_blank",
                          "noopener,noreferrer",
                        );
                        return;
                      }
                      if (item.symbol && item.kind !== "news") {
                        onSymClick?.(item.symbol);
                      }
                    }}
                  />
                );
              })}
            </div>
          ) : (
            renderEmptyLane(
              "No notifications",
              "Portfolio alerts, headlines, and upcoming calendar events will appear here.",
            )
          )}
        </MarketActivityLaneSection>
      </div>
    </Card>
  );
};
