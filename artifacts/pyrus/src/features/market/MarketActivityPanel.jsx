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
  SeverityRail,
} from "../../components/platform/primitives.jsx";
import {
  fmtM,
  formatQuotePrice,
  formatRelativeTimeShort,
} from "../../lib/formatters";
import {
  ELEVATION,
  FONT_WEIGHTS,
  RADII,
  T,
  dim,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
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

const activityToneBackground = (tone) => `${tone}0d`;
const activityToneHoverBackground = (tone) => `${tone}12`;
const ACTIVITY_LANE_CHIP_MIN_WIDTH = 34;
const ACTIVITY_COMPACT_CHIP_MIN_WIDTH = 20;

const activityChipStyle = (tone, minWidth = 32) => ({
  minWidth: dim(minWidth),
  color: tone,
  border: `1px solid ${tone}40`,
  background: `${tone}0f`,
  borderRadius: dim(RADII.xs),
  fontFamily: T.sans,
  fontSize: textSize("caption"),
  fontWeight: FONT_WEIGHTS.medium,
  letterSpacing: 0,
  lineHeight: 1,
  padding: sp("3px 4px"),
  textAlign: "center",
  whiteSpace: "nowrap",
});

const compactActivityChipStyle = (tone) => ({
  ...activityChipStyle(tone, ACTIVITY_COMPACT_CHIP_MIN_WIDTH),
  padding: sp("3px 2px"),
  fontSize: textSize("micro"),
});

const activityRowStyle = (
  tone,
  index,
  maxItems,
  delay = 100,
  compactFrame = false,
) => ({
  ...motionRowStyle(index, maxItems, delay),
  ...motionVars({ accent: tone }),
  width: "100%",
  display: "grid",
  gridTemplateColumns: compactFrame
    ? "auto minmax(0, 1fr)"
    : "auto auto minmax(0, 1fr) auto",
  alignItems: "center",
  gap: sp(compactFrame ? 4 : 6),
  minWidth: 0,
  minHeight: dim(compactFrame ? 26 : 34),
  padding: sp(compactFrame ? "4px 4px" : "5px 6px"),
  border: `1px solid ${T.borderLight}`,
  borderRadius: dim(RADII.xs),
  background: T.bg1,
  textAlign: "left",
});

const compactControlStyle = (width = null, compactFrame = false) => ({
  minHeight: dim(compactFrame ? 22 : 26),
  width: width ? dim(width) : "100%",
  background: T.bg1,
  border: `1px solid ${T.borderLight}`,
  borderRadius: dim(RADII.xs),
  color: T.textSec,
  fontFamily: T.sans,
  fontSize: textSize("caption"),
  fontWeight: FONT_WEIGHTS.medium,
  padding: sp(compactFrame ? "2px 4px" : "4px 5px"),
  outline: "none",
});

const MarketActivityLaneSection = ({
  title,
  meta,
  controls,
  children,
  compact = false,
  compactFrame = false,
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
      borderTop: `1px solid ${T.borderLight}`,
      paddingTop: sp(compactFrame ? 4 : 6),
    }}
  >
    <div
      style={{
        display: "flex",
        alignItems: compactFrame ? "center" : "flex-start",
        justifyContent: "space-between",
        gap: sp(compactFrame ? 3 : 6),
        marginBottom: sp(compactFrame ? 3 : 5),
        minWidth: 0,
        flexWrap: compactFrame ? "nowrap" : "wrap",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            color: T.text,
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            fontWeight: FONT_WEIGHTS.medium,
            lineHeight: 1.15,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </div>
        {meta ? (
          <div
            style={{
              marginTop: sp(1),
              color: T.textDim,
              fontFamily: T.sans,
              fontSize: textSize("body"),
              fontWeight: FONT_WEIGHTS.medium,
              letterSpacing: 0,
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
            gap: sp(3),
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

const SignalTimeframeTypeahead = ({ value, onChange, compactFrame = false }) => {
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
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
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
        width: dim(compactFrame ? 40 : 56),
        minWidth: dim(compactFrame ? 40 : 56),
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
          background: T.bg1,
          border: `1px solid ${T.borderLight}`,
          color: T.textSec,
          fontFamily: T.sans,
          fontSize: textSize("caption"),
          fontWeight: FONT_WEIGHTS.medium,
          padding: sp(compactFrame ? "3px 14px 3px 5px" : "4px 18px 4px 7px"),
          borderRadius: dim(RADII.xs),
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
          right: compactFrame ? 3 : 5,
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
            top: "calc(100% + 4px)",
            background: T.bg1,
            border: `1px solid ${T.borderLight}`,
            borderRadius: dim(RADII.xs),
            boxShadow: ELEVATION.md,
            maxHeight: dim(200),
            overflowY: "auto",
            padding: sp(4),
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
                    ? T.accentHoverBg
                    : selectedOption
                      ? `${T.accent}12`
                      : "transparent",
                  color: selectedOption ? T.accent : T.textSec,
                  cursor: "pointer",
                  fontFamily: T.sans,
                  fontSize: textSize("body"),
                  fontWeight: FONT_WEIGHTS.medium,
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

const MarketLaneToolbar = ({ children, compactFrame = false }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: sp(compactFrame ? 2 : 3),
      minWidth: 0,
      marginBottom: sp(compactFrame ? 3 : 5),
      whiteSpace: "nowrap",
      flexWrap: compactFrame ? "wrap" : "nowrap",
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
  compactFrame = false,
}) => (
  <AppTooltip content={title || label}><button
    type="button"
    aria-label={label}
    onClick={onClick}
    disabled={disabled}
    style={{
      width: dim(compactFrame ? 22 : 28),
      height: dim(compactFrame ? 22 : 28),
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      flex: "0 0 auto",
      border: "none",
      background: active ? `${tone}12` : "transparent",
      color: active ? tone : T.textDim,
      cursor: disabled ? "wait" : "pointer",
      opacity: disabled ? 0.78 : 1,
      borderRadius: dim(RADII.xs),
      padding: 0,
      transition: "background 0.12s ease, color 0.12s ease",
    }}
    onMouseEnter={(event) => {
      if (disabled) return;
      event.currentTarget.style.background = active ? `${tone}18` : T.accentHoverBg;
      event.currentTarget.style.color = active ? tone : T.text;
    }}
    onMouseLeave={(event) => {
      event.currentTarget.style.background = active ? `${tone}12` : "transparent";
      event.currentTarget.style.color = active ? tone : T.textDim;
    }}
  >
    <Icon size={dim(compactFrame ? 11 : 13)} strokeWidth={2.4} />
  </button></AppTooltip>
);

const MarketToolbarLabel = ({ Icon, label, tone = T.textDim, compactFrame = false }) => (
  <AppTooltip content={label}><span
    style={{
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: dim(compactFrame ? 22 : 28),
      height: dim(compactFrame ? 22 : 28),
      flex: "0 0 auto",
      border: "none",
      borderRadius: dim(RADII.xs),
      background: `${tone}0f`,
      color: tone,
    }}
  >
    <Icon size={dim(compactFrame ? 11 : 13)} strokeWidth={2.4} />
  </span></AppTooltip>
);

const getNotificationLaneTone = (item) => {
  if (item.kind === "alert") {
    return item.tone === "profit"
      ? { label: "ALERT", color: T.green, background: activityToneBackground(T.green) }
      : { label: "RISK", color: T.red, background: activityToneBackground(T.red) };
  }
  if (item.kind === "calendar") {
    return { label: "CAL", color: T.amber, background: activityToneBackground(T.amber) };
  }
  return { label: "NEWS", color: T.accent, background: activityToneBackground(T.accent) };
};

const getSignalLaneTone = (item) =>
  item.direction === "sell"
    ? { label: "SELL", color: T.red, background: activityToneBackground(T.red) }
    : { label: "BUY", color: T.green, background: activityToneBackground(T.green) };

const CompactRowText = ({ children }) => (
  <span
    style={{
      minWidth: 0,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      color: T.text,
      fontFamily: T.sans,
      fontSize: textSize("caption"),
      fontWeight: FONT_WEIGHTS.medium,
      lineHeight: 1.1,
    }}
  >
    {children}
  </span>
);

const buildActivityTooltip = (item) =>
  [item.title, item.detail, item.meta].filter(Boolean).join(" · ");

const MarketSignalRow = ({ item, index, maxItems, onClick, compactFrame = false }) => {
  const tone = getSignalLaneTone(item);
  const compactLabel = item.direction === "sell" ? "S" : "B";
  return (
    <AppTooltip key={item.id} content={buildActivityTooltip(item)}><button
      key={item.id}
      type="button"
      className={joinMotionClasses("ra-row-enter", "ra-interactive")}
      onClick={onClick}
      style={{
        ...activityRowStyle(tone.color, index, maxItems, 100, compactFrame),
        cursor: "pointer",
        background: tone.background,
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = activityToneHoverBackground(tone.color);
        event.currentTarget.style.borderColor = `${tone.color}40`;
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = tone.background;
        event.currentTarget.style.borderColor = T.borderLight;
      }}
    >
      {compactFrame ? null : <SeverityRail tone={tone.color} />}
      <span
        style={{
          ...(compactFrame
            ? compactActivityChipStyle(tone.color)
            : activityChipStyle(tone.color, ACTIVITY_LANE_CHIP_MIN_WIDTH)),
        }}
      >
        {compactFrame ? compactLabel : tone.label}
      </span>
      {compactFrame ? (
        <CompactRowText>{item.symbol}</CompactRowText>
      ) : (
        <span style={{ minWidth: 0 }}>
        <span
          style={{
            display: "block",
            color: T.text,
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            fontWeight: FONT_WEIGHTS.medium,
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
            fontSize: textSize("body"),
            lineHeight: 1.2,
            marginTop: sp(1),
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {item.detail}
        </span>
      </span>
      )}
      {compactFrame ? null : (
      <span
        style={{
          color: T.textMuted,
          fontFamily: T.sans,
          fontSize: textSize("caption"),
          fontWeight: FONT_WEIGHTS.medium,
          whiteSpace: "nowrap",
        }}
      >
        {item.meta}
      </span>
      )}
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
    background: activityToneBackground(color),
  };
};

const MarketUnusualRow = ({ item, index, maxItems, onClick, compactFrame = false }) => {
  const tone = getUnusualLaneTone(item);
  const compactLabel =
    tone.label === "PUT" ? "P" : tone.label === "CALL" ? "C" : "F";
  return (
    <AppTooltip key={item.id} content={buildActivityTooltip(item)}><button
      key={item.id}
      type="button"
      className={joinMotionClasses("ra-row-enter", "ra-interactive")}
      onClick={onClick}
      style={{
        ...activityRowStyle(tone.color, index, maxItems, 100, compactFrame),
        cursor: "pointer",
        background: tone.background,
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = activityToneHoverBackground(tone.color);
        event.currentTarget.style.borderColor = `${tone.color}40`;
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = tone.background;
        event.currentTarget.style.borderColor = T.borderLight;
      }}
    >
      {compactFrame ? null : <SeverityRail tone={tone.color} />}
      <span
        style={{
          ...(compactFrame
            ? compactActivityChipStyle(tone.color)
            : activityChipStyle(tone.color, ACTIVITY_LANE_CHIP_MIN_WIDTH)),
        }}
      >
        {compactFrame ? compactLabel : tone.label}
      </span>
      {compactFrame ? (
        <CompactRowText>{item.symbol}</CompactRowText>
      ) : (
        <span style={{ minWidth: 0 }}>
        <span
          style={{
            display: "block",
            color: T.text,
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            fontWeight: FONT_WEIGHTS.medium,
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
            fontSize: textSize("body"),
            lineHeight: 1.2,
            marginTop: sp(1),
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {item.detail}
        </span>
      </span>
      )}
      {compactFrame ? null : (
      <span
        style={{
          color: T.textMuted,
          fontFamily: T.sans,
          fontSize: textSize("caption"),
          fontWeight: FONT_WEIGHTS.medium,
          whiteSpace: "nowrap",
        }}
      >
        {item.meta}
      </span>
      )}
    </button></AppTooltip>
  );
};

const MarketNotificationRow = ({
  item,
  index,
  maxItems,
  onClick,
  cursor = "pointer",
  compactFrame = false,
}) => {
  const tone = getNotificationLaneTone(item);
  const compactLabel =
    tone.label === "ALERT" ? "A" : tone.label === "RISK" ? "R" : tone.label[0];
  return (
    <AppTooltip key={item.id} content={buildActivityTooltip(item)}><button
      key={item.id}
      type="button"
      className={joinMotionClasses("ra-row-enter", "ra-interactive")}
      onClick={onClick}
      style={{
        ...activityRowStyle(tone.color, index, maxItems, 90, compactFrame),
        background: tone.background,
        cursor,
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = activityToneHoverBackground(tone.color);
        event.currentTarget.style.borderColor = `${tone.color}40`;
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = tone.background;
        event.currentTarget.style.borderColor = T.borderLight;
      }}
    >
      {compactFrame ? null : <SeverityRail tone={tone.color} />}
      <span
        style={{
          ...(compactFrame
            ? compactActivityChipStyle(tone.color)
            : activityChipStyle(tone.color, 32)),
        }}
      >
        {compactFrame ? compactLabel : tone.label}
      </span>
      {compactFrame ? (
        <CompactRowText>{item.title}</CompactRowText>
      ) : (
        <span style={{ minWidth: 0 }}>
        <span
          style={{
            display: "block",
            color: T.text,
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            fontWeight: FONT_WEIGHTS.medium,
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
            fontSize: textSize("body"),
            lineHeight: 1.2,
            marginTop: sp(1),
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {item.detail || item.meta}
        </span>
      </span>
      )}
      {compactFrame ? null : (
      <span
        style={{
          color: T.textMuted,
          fontFamily: T.sans,
          fontSize: textSize("caption"),
          fontWeight: FONT_WEIGHTS.medium,
          whiteSpace: "nowrap",
        }}
      >
        {item.meta}
      </span>
      )}
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
  onFlowAction,
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
  headerAccessory = null,
  compactFrame = false,
  stackLanes = false,
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
        padding: "6px 7px",
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
              display: "inline-flex",
              alignItems: "center",
              gap: sp(6),
              minWidth: 0,
            }}
          >
            <span
              style={{
                fontSize: textSize("body"),
                color: signalMonitorPending ? T.amber : T.textDim,
                fontFamily: T.sans,
                fontWeight: FONT_WEIGHTS.medium,
                letterSpacing: 0,
                whiteSpace: "nowrap",
              }}
            >
              {monitorMeta}
            </span>
            {headerAccessory}
          </span>
        }
      >
        {compactFrame ? "Activity" : "Activity & Notifications"}
      </CardTitle>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: sp(5),
          minHeight: 0,
          flex: "0 1 auto",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: stackLanes
              ? "minmax(0, 1fr)"
              : "minmax(0, 1fr) minmax(0, 1fr)",
            gap: sp(compactFrame ? 4 : 6),
            minHeight: 0,
            flex: "0 1 auto",
            alignItems: "start",
          }}
        >
          <MarketActivityLaneSection
            title={compactFrame ? "SIG" : "Signals"}
            meta={
              compactFrame
                ? `${SIGNAL_TIMEFRAME_LABELS[monitorTimeframe]}/${signalRows.length}`
                : `${SIGNAL_TIMEFRAME_LABELS[monitorTimeframe]} · ${signalRows.length} rows`
            }
            testId="market-activity-signals-lane"
            compactFrame={compactFrame}
          >
            <MarketLaneToolbar compactFrame={compactFrame}>
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
                compactFrame={compactFrame}
              />
              <SignalTimeframeTypeahead
                value={monitorTimeframe}
                onChange={onChangeMonitorTimeframe}
                compactFrame={compactFrame}
              />
              <MarketIconToolButton
                Icon={RefreshCw}
                active={Boolean(signalMonitorPending)}
                disabled={signalMonitorPending}
                tone={signalMonitorPending ? T.amber : T.accent}
                label="Scan signal monitor now"
                onClick={onScanNow}
                compactFrame={compactFrame}
              />
              {!compactFrame ? (
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
                    ...compactControlStyle(),
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
              ) : null}
            </MarketLaneToolbar>
            {compactFrame ? (
              <select
                value={monitorWatchlistId}
                onChange={(event) =>
                  onChangeMonitorWatchlist?.(event.target.value || null)
                }
                disabled={!watchlists.length}
                aria-label="Signal monitor watchlist"
                title="Signal monitor watchlist"
                style={{
                  marginBottom: sp(3),
                  ...compactControlStyle(null, true),
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
            ) : null}
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
                    compactFrame={compactFrame}
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
            meta={
              compactFrame
                ? `${unusualRows.length} · ${normalizedFlowSourceProvider}`
                : `${unusualRows.length} unusual rows · ${flowSourceLabel}`
            }
            testId="market-activity-flow-lane"
            compactFrame={compactFrame}
            dataAttrs={{
              "data-flow-snapshot-source": flowSnapshotSource,
              "data-flow-source-provider": normalizedFlowSourceProvider,
              "data-flow-source-live": flowSourceLive ? "true" : "false",
              "data-flow-fallback-used": flowProviderSummary?.fallbackUsed
                ? "true"
                : "false",
            }}
          >
            <MarketLaneToolbar compactFrame={compactFrame}>
              <MarketToolbarLabel
                Icon={Gauge}
                label="Flow threshold"
                tone={T.amber}
                compactFrame={compactFrame}
              />
              <AppTooltip content="Volume / open interest ratio at which a print is flagged as unusual."><select
                data-testid="market-flow-threshold-select"
                value={String(unusualThreshold)}
                onChange={(event) =>
                  onChangeUnusualThreshold?.(Number(event.target.value))
                }
                aria-label="Flow threshold"
                style={{
                  flex: "0 0 auto",
                  ...compactControlStyle(compactFrame ? 48 : 76, compactFrame),
                }}
              >
                {UNUSUAL_THRESHOLD_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select></AppTooltip>
              {appliedThresholdLabel && !compactFrame ? (
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
                    fontFamily: T.sans,
                    fontSize: textSize("body"),
                    fontWeight: FONT_WEIGHTS.medium,
                    border: `1px solid ${(thresholdMatches ? T.textDim : T.amber)}33`,
                    background: `${thresholdMatches ? T.textDim : T.amber}0f`,
                    padding: sp("4px 5px"),
                    borderRadius: dim(RADII.xs),
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
                    onClick={() =>
                      onFlowAction ? onFlowAction(item.raw) : onSymClick?.(item.symbol)
                    }
                    compactFrame={compactFrame}
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
          title={compactFrame ? "Notif" : "Notifications"}
          meta={
            compactFrame
              ? `${notificationRows.length}`
              : `${notificationRows.length} secondary items`
          }
          compact
          compactFrame={compactFrame}
          testId="market-activity-notifications-lane"
          controls={
            <>
              {[
                [compactFrame ? "A" : "ALERT", notificationTypeCounts.alerts, T.red],
                [compactFrame ? "N" : "NEWS", notificationTypeCounts.news, T.accent],
                [compactFrame ? "C" : "CAL", notificationTypeCounts.calendar, T.amber],
              ].map(([label, count, color]) => (
                <span
                  key={label}
                  style={{
                    color,
                    border: `1px solid ${color}33`,
                    background: `${color}0f`,
                    borderRadius: dim(RADII.xs),
                    fontFamily: T.sans,
                    fontSize: textSize("caption"),
                    fontWeight: FONT_WEIGHTS.medium,
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
                gridTemplateColumns: compactFrame
                  ? "minmax(0, 1fr)"
                  : `repeat(auto-fit, minmax(${dim(160)}px, 1fr))`,
                gap: sp(compactFrame ? 3 : 4),
                overflowY: "auto",
                minHeight: 0,
                maxHeight: dim(compactFrame ? 96 : 116),
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
                    compactFrame={compactFrame}
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
