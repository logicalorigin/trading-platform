import { ChevronDown, ChevronRight, RadioTower, Settings } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BottomSheet } from "../../components/platform/BottomSheet.jsx";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { useViewport } from "../../lib/responsive";
import { FONT_WEIGHTS, MISSING_VALUE, RADII, T, dim, fs, sp, textSize } from "../../lib/uiTokens.jsx";
import {
  formatOptionContractLabel,
  formatQuotePrice,
  formatRelativeTimeShort,
} from "../../lib/formatters";
import { joinMotionClasses, motionRowStyle, motionVars } from "../../lib/motion.jsx";
import { _initialState, persistState } from "../../lib/workspaceState";
import {
  FLOW_BUILT_IN_PRESETS,
  FLOW_MIN_PREMIUM_OPTIONS,
  FLOW_TAPE_FILTER_OPTIONS,
  buildFlowTapePresetPatch,
  filterFlowTapeEvents,
  flowTapeFiltersAreActive,
  setFlowTapeFilterState,
  useFlowTapeFilterState,
} from "./flowFilterStore";
import {
  HEADER_BROADCAST_SPEED_PRESETS,
  buildHeaderSignalTapeItems,
  buildHeaderUnusualTapeItems,
  getHeaderBroadcastSpeedDurations,
  resolveHeaderBroadcastSpeedPreset,
} from "./headerBroadcastModel";
import {
  BROAD_MARKET_FLOW_STORE_KEY,
  setFlowScannerControlState,
  useFlowScannerControlState,
  useMarketFlowSnapshotForStoreKey,
} from "./marketFlowStore";
import { providerSummaryHasVisibleFlowDegradation } from "./flowSourceState.js";
import {
  buildSignalMonitorStatusSnapshot,
  isSignalMonitorRuntimeFallbackProfile,
} from "./signalMonitorStatusModel";
import { WATCHLIST_SIGNAL_TIMEFRAMES } from "./watchlistModel.js";
import {
  FLOW_SCANNER_CONFIG_LIMITS,
  FLOW_SCANNER_MODE,
  FLOW_SCANNER_SCOPE,
  normalizeFlowScannerConfig,
} from "./marketFlowScannerConfig";
import { useSignalMonitorSnapshot } from "./signalMonitorStore";
import { AppTooltip } from "@/components/ui/tooltip";


const fmtCompactCurrency = (value) => {
  if (value == null || Number.isNaN(value)) return MISSING_VALUE;
  if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (Math.abs(value) >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
};
const HeaderBroadcastSegment = ({
  item,
  duplicate = false,
  tone = T.textSec,
  accent = T.borderLight,
  children,
  onClick,
  title,
  compact = false,
}) => {
  const interactive = !duplicate && typeof onClick === "function";
  const Component = interactive ? "button" : "div";

  const segment = (
    <Component
      type={interactive ? "button" : undefined}
      aria-hidden={duplicate || undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? () => onClick(item) : undefined}
      className={interactive ? "ra-interactive" : undefined}
      style={{
        ...motionVars({ accent: tone }),
        display: "inline-flex",
        alignItems: "center",
        gap: sp(compact ? 5 : 6),
        height: dim(compact ? 22 : 24),
        minHeight: dim(compact ? 22 : 24),
        maxWidth: dim(compact ? 220 : 300),
        padding: sp(compact ? "0px 8px" : "0px 10px"),
        border: "none",
        borderRadius: dim(RADII.xs),
        background: `${tone}0d`,
        color: T.textSec,
        fontFamily: T.sans,
        fontSize: textSize(compact ? "caption" : "body"),
        fontWeight: FONT_WEIGHTS.medium,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        cursor: interactive ? "pointer" : "default",
      }}
    >
      {children}
    </Component>
  );

  return interactive ? (
    <AppTooltip content={title}>{segment}</AppTooltip>
  ) : (
    segment
  );
};

const headerSignalIntervalStateEqual = (left, right) =>
  left?.currentSignalDirection === right?.currentSignalDirection &&
  left?.currentSignalAt === right?.currentSignalAt &&
  left?.fresh === right?.fresh &&
  left?.barsSinceSignal === right?.barsSinceSignal &&
  left?.status === right?.status &&
  left?.lastError === right?.lastError;

const headerSignalIntervalStatesEqual = (left = {}, right = {}) =>
  WATCHLIST_SIGNAL_TIMEFRAMES.every((timeframe) =>
    headerSignalIntervalStateEqual(left?.[timeframe], right?.[timeframe]),
  );

const headerSignalTapeItemsEqual = (left = {}, right = {}) =>
  left.id === right.id &&
  left.symbol === right.symbol &&
  left.direction === right.direction &&
  left.directionLabel === right.directionLabel &&
  left.time === right.time &&
  left.price === right.price &&
  left.fresh === right.fresh &&
  left.timeframe === right.timeframe &&
  headerSignalIntervalStatesEqual(left.intervalStates, right.intervalStates);

const headerSignalTapeItemPropsEqual = (left, right) =>
  left.duplicate === right.duplicate &&
  left.compact === right.compact &&
  left.selectedTimeframe === right.selectedTimeframe &&
  left.onClick === right.onClick &&
  headerSignalTapeItemsEqual(left.item, right.item);

const HeaderSignalTapeItem = memo(function HeaderSignalTapeItem({
  item,
  duplicate = false,
  onClick,
  compact = false,
  selectedTimeframe = "5m",
}) {
  const isSell = item.direction === "sell";
  const tone = isSell ? T.red : T.green;
  const priceLabel =
    item.price != null && Number.isFinite(Number(item.price))
      ? formatQuotePrice(Number(item.price))
      : null;
  const title = `${item.symbol} ${item.directionLabel} ${item.timeframe || ""}`.trim();

  return (
    <HeaderBroadcastSegment
      item={item}
      duplicate={duplicate}
      tone={tone}
      accent={item.fresh ? tone : T.border}
      onClick={(selected) => onClick?.(selected.symbol, selected.raw)}
      title={title}
      compact={compact}
    >
      <span style={{ color: tone, fontWeight: FONT_WEIGHTS.regular }}>{item.directionLabel}</span>
      <span style={{ color: T.text }}>{item.symbol}</span>
      {item.timeframe ? (
        <span style={{ color: T.textSec, fontFamily: T.sans }}>
          {item.timeframe}
        </span>
      ) : null}
      {priceLabel ? (
        <span style={{ color: T.textSec, fontFamily: T.sans, fontVariantNumeric: "tabular-nums" }}>
          {priceLabel}
        </span>
      ) : null}
      <span style={{ color: T.textMuted, fontFamily: T.sans, fontVariantNumeric: "tabular-nums" }}>
        {formatRelativeTimeShort(item.time)}
      </span>
      <HeaderSignalIntervalContext
        statesByTimeframe={item.intervalStates}
        compact={compact}
        selectedTimeframe={selectedTimeframe}
      />
    </HeaderBroadcastSegment>
  );
}, headerSignalTapeItemPropsEqual);

const colorWithAlpha = (color, alpha) => {
  const match = /^#([0-9a-f]{6})$/i.exec(String(color || ""));
  if (!match) return color;
  const value = match[1];
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const normalizeSignalIntervalDirection = (state) => {
  const direction = String(
    state?.currentSignalDirection || state?.direction || "",
  ).toLowerCase();
  return direction === "buy" || direction === "sell" ? direction : "";
};

const resolveHeaderSignalTimeframe = (value) => {
  const normalized = String(value || "").trim();
  return WATCHLIST_SIGNAL_TIMEFRAMES.includes(normalized) ? normalized : "5m";
};

const HEADER_SIGNAL_CONTEXT_SLANT = 8;
const HEADER_SIGNAL_CONTEXT_VIEWBOX = "0 0 48 32";

const getHeaderSignalContextShapePoints = (timeframe) =>
  timeframe === "15m" ? "8,0 48,0 48,32 0,32" : "8,0 48,0 40,32 0,32";

const HeaderSignalContextDivider = () => (
  <svg
    aria-hidden="true"
    data-testid="header-signal-context-diagonal-divider"
    width="8"
    height="100%"
    viewBox="0 0 8 32"
    preserveAspectRatio="none"
    focusable="false"
    style={{
      position: "absolute",
      left: 0,
      top: 0,
      display: "block",
      width: dim(HEADER_SIGNAL_CONTEXT_SLANT),
      height: "100%",
      pointerEvents: "none",
      zIndex: 4,
    }}
  >
    <line
      x1="1"
      y1="32"
      x2="7"
      y2="0"
      stroke={colorWithAlpha(T.textSec, 0.36)}
      strokeWidth="1"
      vectorEffect="non-scaling-stroke"
    />
  </svg>
);

const HeaderSignalPelletChrome = ({ fill, selected, timeframe }) => {
  const points = getHeaderSignalContextShapePoints(timeframe);

  return (
    <svg
      aria-hidden="true"
      width="100%"
      height="100%"
      viewBox={HEADER_SIGNAL_CONTEXT_VIEWBOX}
      preserveAspectRatio="none"
      focusable="false"
      style={{
        position: "absolute",
        inset: 0,
        display: "block",
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 1,
      }}
    >
      <polygon points={points} fill={fill} stroke="none" />
      {selected ? (
        <polygon
          data-testid="header-signal-context-selected-outline"
          points={points}
          fill="none"
          stroke={T.amber}
          strokeWidth="1.6"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
    </svg>
  );
};

const HeaderSignalIntervalContext = ({
  statesByTimeframe = {},
  compact = false,
  selectedTimeframe = "5m",
}) => (
  <span
    data-testid="header-signal-interval-context"
    style={{
      display: "inline-flex",
      alignItems: "stretch",
      alignSelf: "stretch",
      height: "100%",
      gap: 0,
      marginRight: compact ? "-12px" : "-14px",
      overflow: "hidden",
      borderTopRightRadius: dim(RADII.pill),
      borderBottomRightRadius: dim(RADII.pill),
    }}
  >
    {WATCHLIST_SIGNAL_TIMEFRAMES.map((timeframe, index) => {
      const state = statesByTimeframe?.[timeframe];
      const direction = normalizeSignalIntervalDirection(state);
      const hasDirection = Boolean(direction);
      const pending = !state;
      const color =
        direction === "buy" ? T.green : direction === "sell" ? T.red : T.textMuted;
      const fresh = Boolean(state?.fresh);
      const status = state?.status || "unknown";
      const selected = timeframe === resolveHeaderSignalTimeframe(selectedTimeframe);
      const label = pending
        ? `${timeframe} pending`
        : hasDirection
          ? `${timeframe} ${direction.toUpperCase()} ${fresh ? "fresh" : "stale"} - ${state?.barsSinceSignal ?? MISSING_VALUE} bars`
          : `${timeframe} no signal - ${status}`;
      const pelletFill = hasDirection
        ? colorWithAlpha(color, fresh ? 0.24 : 0.18)
        : pending
          ? colorWithAlpha(T.textMuted, 0.08)
          : colorWithAlpha(T.textMuted, 0.1);
      const labelColor = hasDirection ? color : pending ? T.textDim : T.textSec;
      const width = timeframe === "15m" ? 54 : 44;

      return (
        <AppTooltip
          key={timeframe}
          content={state?.lastError ? `${label} - ${state.lastError}` : label}
        >
          <span
            data-testid={`header-signal-context-${timeframe}`}
            data-timeframe={timeframe}
            data-direction={pending ? "pending" : hasDirection ? direction : "none"}
            data-selected={selected ? "true" : "false"}
            aria-label={label}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              position: "relative",
              height: "100%",
              width: dim(width),
              minWidth: dim(width),
              marginLeft: index > 0 ? dim(-HEADER_SIGNAL_CONTEXT_SLANT) : 0,
              padding: 0,
              border: 0,
              background: "transparent",
              color: labelColor,
              opacity: pending ? 0.72 : hasDirection ? 1 : 0.82,
              boxShadow: "none",
              fontFamily: T.sans,
              fontSize: textSize(compact ? "body" : "paragraphMuted"),
              fontWeight: FONT_WEIGHTS.label,
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1,
              zIndex: selected ? 3 : 1,
            }}
          >
            <HeaderSignalPelletChrome
              fill={pelletFill}
              selected={selected}
              timeframe={timeframe}
            />
            {index > 0 ? <HeaderSignalContextDivider /> : null}
            <span style={{ position: "relative", zIndex: 5 }}>{timeframe}</span>
          </span>
        </AppTooltip>
      );
    })}
  </span>
);

const HeaderUnusualTapeItem = ({ item, duplicate = false, onClick, compact = false }) => {
  const isPut =
    item.right === "P" ||
    String(item.sentiment || "").toLowerCase() === "bearish";
  const tone = isPut ? T.red : T.green;
  const formattedContractLabel = formatOptionContractLabel(item, {
    includeSymbol: false,
    fallback: "",
  });
  const contractLabel =
    formattedContractLabel ||
    String(item.contract || "").replace(new RegExp(`^${item.symbol}\\s+`, "i"), "");
  const scoreLabel = item.score ? `${item.score.toFixed(1)}x` : null;
  const title = `${item.symbol} unusual ${contractLabel}`.trim();

  return (
    <HeaderBroadcastSegment
      item={item}
      duplicate={duplicate}
      tone={tone}
      accent={T.border}
      onClick={(selected) => onClick?.(selected.raw)}
      title={title}
      compact={compact}
    >
      <span style={{ color: T.text }}>{item.symbol}</span>
      {contractLabel ? (
        <span style={{ color: tone, fontFamily: T.sans, fontVariantNumeric: "tabular-nums" }}>{contractLabel}</span>
      ) : null}
      <span style={{ color: T.textSec, fontFamily: T.sans, fontVariantNumeric: "tabular-nums" }}>
        {fmtCompactCurrency(item.premium)}
      </span>
      {scoreLabel ? (
        <span style={{ color: T.amber, fontFamily: T.sans, fontVariantNumeric: "tabular-nums", fontWeight: FONT_WEIGHTS.medium }}>{scoreLabel}</span>
      ) : null}
      <span style={{ color: T.textMuted, fontFamily: T.sans, fontVariantNumeric: "tabular-nums" }}>
        {formatRelativeTimeShort(item.time)}
      </span>
    </HeaderBroadcastSegment>
  );
};

const HeaderLaneSettingsPopover = ({ children, testId, sheet = false }) => (
  <div
    data-testid={testId}
    style={sheet
      ? {
          padding: sp(10),
          overflowY: "auto",
          background: T.bg0,
          color: T.text,
          fontFamily: T.sans,
        }
      : {
          maxHeight: `calc(100vh - ${dim(24)}px)`,
          overflowY: "auto",
          color: T.text,
          fontFamily: T.sans,
        }}
  >
    {children}
  </div>
);

const useDebouncedSave = (commit, delay = 300) => {
  const [state, setState] = useState("idle");
  const timerRef = useRef(null);
  const savedTimerRef = useRef(null);
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  }, [commit]);
  const schedule = useCallback((payload) => {
    setState("pending");
    if (timerRef.current) clearTimeout(timerRef.current);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    timerRef.current = setTimeout(async () => {
      try {
        await commitRef.current?.(payload);
      } finally {
        setState("saved");
        savedTimerRef.current = setTimeout(() => setState("idle"), 1200);
      }
    }, delay);
  }, [delay]);
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
  }, []);
  return { state, schedule };
};

const HeaderLaneSavedChip = ({ state }) => {
  if (state === "idle") return null;
  const label = state === "pending" ? "Saving…" : "Saved";
  const tone = state === "pending" ? T.textDim : T.accent;
  return (
    <span
      data-testid="header-lane-saved-chip"
      data-state={state}
      style={{
        color: tone,
        fontFamily: T.sans,
        fontSize: textSize("caption"),
        fontWeight: FONT_WEIGHTS.regular,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
};

const HeaderLanePopoverSection = ({ title, saveState, testId, children }) => (
  <div data-testid={testId} style={{ display: "grid", gap: sp(3) }}>
    <div
      style={{
        marginTop: sp(8),
        marginBottom: sp(4),
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: sp(8),
        color: T.textMuted,
        fontFamily: T.sans,
        fontSize: textSize("caption"),
        fontWeight: FONT_WEIGHTS.medium,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
      }}
    >
      <span>{title}</span>
      {saveState != null ? <HeaderLaneSavedChip state={saveState} /> : null}
    </div>
    {children}
  </div>
);

const HeaderLaneAdvancedExpander = ({ open, onToggle, label, children, testId }) => (
  <div style={{ marginTop: sp(3) }}>
    <button
      type="button"
      data-testid={testId}
      data-state={open ? "expanded" : "collapsed"}
      aria-expanded={open}
      onClick={onToggle}
      className="ra-interactive"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: sp(5),
        padding: sp("3px 8px"),
        border: "none",
        borderRadius: dim(RADII.xs ?? RADII.sm),
        background: "transparent",
        color: open ? T.textSec : T.textMuted,
        cursor: "pointer",
        fontFamily: T.sans,
        fontSize: textSize("caption"),
        fontWeight: FONT_WEIGHTS.regular,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
      }}
    >
      {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
      <span>{label}</span>
    </button>
    {open ? (
      <div style={{ display: "grid", gap: sp(3), marginTop: sp(4) }}>{children}</div>
    ) : null}
  </div>
);

const HeaderLaneChipRow = ({ value, options, onChange, ariaLabel, testId }) => (
  <div
    role="group"
    aria-label={ariaLabel}
    data-testid={testId}
    style={{
      display: "grid",
      gridTemplateColumns: `repeat(${options.length}, 1fr)`,
      gap: sp(4),
    }}
  >
    {options.map((option) => {
      const active = String(value) === String(option.value);
      return (
        <button
          key={option.value}
          type="button"
          aria-pressed={active}
          data-testid={testId ? `${testId}-${option.value}` : undefined}
          className={joinMotionClasses("ra-interactive", active && "ra-focus-rail")}
          onClick={() => onChange(option.value)}
          style={{
            ...motionVars({ accent: T.accent }),
            minHeight: dim(22),
            border: `1px solid ${active ? T.accent : T.border}`,
            borderRadius: dim(RADII.sm),
            background: active ? `${T.accent}18` : T.bg1,
            color: active ? T.accent : T.textDim,
            cursor: "pointer",
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            fontWeight: FONT_WEIGHTS.regular,
            fontVariantNumeric: "tabular-nums",
            padding: 0,
          }}
        >
          {option.label}
        </button>
      );
    })}
  </div>
);

const HEADER_LANE_MIN_PREMIUM_PRESETS = [100_000, 500_000, 1_000_000, 5_000_000];
const HeaderLaneMinPremiumChips = ({ value, onChange, testId }) => (
  <div
    role="group"
    aria-label="Minimum premium presets"
    data-testid={testId}
    style={{
      display: "grid",
      gridTemplateColumns: `repeat(${HEADER_LANE_MIN_PREMIUM_PRESETS.length}, 1fr)`,
      gap: sp(4),
      marginBottom: sp(3),
    }}
  >
    {HEADER_LANE_MIN_PREMIUM_PRESETS.map((preset) => {
      const active = Number(value) === preset;
      return (
        <button
          key={preset}
          type="button"
          aria-pressed={active}
          data-testid={`${testId}-${preset}`}
          className={joinMotionClasses("ra-interactive", active && "ra-focus-rail")}
          onClick={() => onChange(preset)}
          style={{
            ...motionVars({ accent: T.accent }),
            minHeight: dim(22),
            border: `1px solid ${active ? T.accent : T.border}`,
            borderRadius: dim(RADII.sm),
            background: active ? `${T.accent}18` : T.bg1,
            color: active ? T.accent : T.textDim,
            cursor: "pointer",
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            fontWeight: FONT_WEIGHTS.regular,
            fontVariantNumeric: "tabular-nums",
            padding: 0,
          }}
        >
          {fmtCompactCurrency(preset).replace(".00", "").replace(".0", "")}
        </button>
      );
    })}
  </div>
);

const HeaderLaneSettingsTitle = ({ label, status, tone = T.textDim }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: sp(8),
      marginBottom: sp(4),
    }}
  >
    <span
      style={{
        color: T.textSec,
        fontFamily: T.sans,
        fontSize: textSize("caption"),
        fontWeight: FONT_WEIGHTS.regular,
      }}
    >
      {label}
    </span>
    <span
      style={{
        color: tone,
        fontFamily: T.sans,
        fontSize: textSize("body"),
        fontWeight: FONT_WEIGHTS.regular,
        whiteSpace: "nowrap",
      }}
    >
      {status}
    </span>
  </div>
);

const HeaderLaneInfoRow = ({ label, value, tone = T.textSec }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: sp(8),
      minHeight: dim(20),
      color: T.textDim,
      fontFamily: T.sans,
      fontSize: textSize("body"),
      fontWeight: FONT_WEIGHTS.regular,
    }}
  >
    <span>{label}</span>
    <span style={{ color: tone, textAlign: "right" }}>{value}</span>
  </div>
);

const HeaderLaneSectionLabel = ({ children }) => (
  <div
    style={{
      marginTop: sp(10),
      marginBottom: sp(6),
      color: T.textMuted,
      fontFamily: T.sans,
      fontSize: textSize("caption"),
      fontWeight: FONT_WEIGHTS.medium,
      letterSpacing: "0.04em",
      textTransform: "uppercase",
    }}
  >
    {children}
  </div>
);

const HeaderLaneSegmentedControl = ({ value, onChange }) => (
  <div
    role="group"
    aria-label="Header lane speed"
    style={{
      display: "grid",
      gridTemplateColumns: "repeat(3, 1fr)",
      gap: sp(4),
    }}
  >
    {Object.entries(HEADER_BROADCAST_SPEED_PRESETS).map(([preset, config]) => {
      const active = value === preset;
      return (
        <button
          key={preset}
          type="button"
          aria-pressed={active}
          data-testid={`header-lane-speed-${preset}`}
          className={joinMotionClasses("ra-interactive", active && "ra-focus-rail")}
          onClick={() => onChange(preset)}
          style={{
            ...motionVars({ accent: T.accent }),
            minHeight: dim(24),
            border: `1px solid ${active ? T.accent : T.border}`,
            background: active ? `${T.accent}18` : T.bg1,
            color: active ? T.accent : T.textDim,
            cursor: "pointer",
            fontFamily: T.sans,
            fontSize: textSize("body"),
            fontWeight: FONT_WEIGHTS.regular,
          }}
        >
          {config.label}
        </button>
      );
    })}
  </div>
);

const HeaderLaneToggleButton = ({
  active,
  disabled = false,
  onClick,
  children,
  testId,
  tone = T.accent,
}) => (
  <button
    type="button"
    data-testid={testId}
    aria-pressed={active}
    disabled={disabled}
    className={joinMotionClasses("ra-interactive", active && "ra-focus-rail")}
    onClick={onClick}
    style={{
      ...motionVars({ accent: tone }),
      width: "100%",
      minHeight: dim(24),
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: sp(5),
      border: `1px solid ${active ? tone : T.border}`,
      background: active ? `${tone}18` : T.bg1,
      color: disabled ? T.textMuted : active ? tone : T.textSec,
      cursor: disabled ? "default" : "pointer",
      fontFamily: T.sans,
      fontSize: textSize("caption"),
      fontWeight: FONT_WEIGHTS.regular,
    }}
  >
    <RadioTower size={dim(12)} strokeWidth={2.3} />
    {children}
  </button>
);

const headerLaneControlInputStyle = {
  width: "100%",
  minHeight: dim(24),
  background: T.bg1,
  border: `1px solid ${T.border}`,
  borderRadius: dim(RADII.sm),
  color: T.text,
  fontFamily: T.sans,
  fontSize: textSize("caption"),
  fontWeight: FONT_WEIGHTS.medium,
  fontVariantNumeric: "tabular-nums",
  padding: sp("3px 6px"),
  outline: "none",
};

const HeaderLaneControlRow = ({ label, children }) => (
  <label
    style={{
      display: "grid",
      gridTemplateColumns: `${dim(42)} minmax(0, 1fr)`,
      alignItems: "center",
      gap: sp(4),
      minHeight: dim(22),
      color: T.textDim,
      fontFamily: T.sans,
      fontSize: textSize("caption"),
      fontWeight: FONT_WEIGHTS.regular,
    }}
  >
    <span
      style={{
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
    {children}
  </label>
);

const HeaderLanePairRow = ({ children }) => (
  <div
    style={{
      display: "grid",
      gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
      gap: sp(6),
    }}
  >
    {children}
  </div>
);

const HeaderLaneSelectControl = ({ label, value, onChange, options, testId }) => (
  <HeaderLaneControlRow label={label}>
    <select
      data-testid={testId}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      style={headerLaneControlInputStyle}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  </HeaderLaneControlRow>
);

const HeaderLaneTextControl = ({ label, value, onChange, testId, placeholder }) => (
  <HeaderLaneControlRow label={label}>
    <input
      data-testid={testId}
      type="text"
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      style={headerLaneControlInputStyle}
    />
  </HeaderLaneControlRow>
);

const HeaderLaneNumberControl = ({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  testId,
  placeholder,
}) => (
  <HeaderLaneControlRow label={label}>
    <input
      data-testid={testId}
      type="number"
      min={min}
      max={max}
      step={step}
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      style={headerLaneControlInputStyle}
    />
  </HeaderLaneControlRow>
);

const buildHeaderFlowTapeFilters = (filters) => ({
  ...filters,
  symbol: null,
});

const HeaderBroadcastLane = ({
  label,
  items,
  emptyLabel,
  emptyTone = null,
  testId,
  action,
  children,
  durationSeconds = 34,
  settingsOpen = false,
  onToggleSettings,
  labelTrigger,
  compactSettings = false,
}) => {
  const shouldScroll = items.length >= 4;
  const renderedItems = shouldScroll ? [...items, ...items] : items;
  const defaultTrigger = (
    <button
      type="button"
      data-testid={`${testId}-settings-trigger`}
      aria-expanded={settingsOpen}
      aria-label={`${label} settings`}
      onClick={onToggleSettings}
      style={{
        width: "100%",
        height: "100%",
        minHeight: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: sp(compactSettings ? "0px 8px" : "0px 4px"),
        border: "none",
        background: settingsOpen ? `${T.accent}14` : "transparent",
        color: settingsOpen ? T.accent : T.textDim,
        cursor: "pointer",
        fontFamily: T.sans,
        fontSize: textSize("caption"),
        fontWeight: FONT_WEIGHTS.regular,
        whiteSpace: "nowrap",
      }}
    >
      {compactSettings ? <Settings size={14} strokeWidth={2} /> : label}
    </button>
  );

  return (
    <div
      data-testid={testId}
      className="ra-hairline-bottom"
      style={{
        display: "grid",
        gridTemplateColumns: compactSettings
          ? `${dim(26)}px minmax(0, 1fr) auto`
          : "56px minmax(0, 1fr) auto",
        alignItems: "center",
        minHeight: dim(compactSettings ? 18 : 20),
        minWidth: 0,
      }}
    >
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRight: `1px solid ${T.border}`,
        }}
      >
        {labelTrigger ?? defaultTrigger}
      </div>

      <div
        data-header-broadcast-viewport
        style={{
          minWidth: 0,
          overflowX: "hidden",
          overflowY: "hidden",
          padding: sp(compactSettings ? "1px 6px" : "1px 6px"),
        }}
      >
        {items.length ? (
          <div
            data-header-broadcast-track
            role="list"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: sp(compactSettings ? 8 : 6),
              minWidth: "max-content",
              animation: shouldScroll
                ? `headerBroadcastScroll ${durationSeconds}s linear infinite`
                : "none",
            }}
          >
            {renderedItems.map((item, index) => {
              const duplicate = index >= items.length;
              return (
                <span
                  key={`${item.id}-${index}`}
                  role={duplicate ? "presentation" : "listitem"}
                  className={duplicate ? undefined : "ra-row-enter"}
                  style={{
                    display: "inline-flex",
                    ...(duplicate ? null : motionRowStyle(index, 10, 90)),
                  }}
                >
                  {children(item, duplicate, compactSettings)}
                </span>
              );
            })}
          </div>
        ) : (
          <span
            role="status"
            aria-label={emptyLabel}
            title={emptyLabel}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: sp(4),
              height: dim(compactSettings ? 16 : 18),
              paddingLeft: sp(4),
            }}
          >
            <span
              style={{
                width: dim(compactSettings ? 8 : 7),
                height: dim(compactSettings ? 8 : 7),
                borderRadius: dim(RADII.pill),
                background: emptyTone || T.textMuted,
                boxShadow: emptyTone
                  ? `0 0 0 3px ${emptyTone}24`
                  : "none",
              }}
            />
            <span
              style={{
                color: emptyTone || T.textMuted,
                fontSize: textSize("caption"),
                fontWeight: FONT_WEIGHTS.medium,
                fontFamily: T.sans,
                whiteSpace: "nowrap",
              }}
            >
              {emptyLabel}
            </span>
          </span>
        )}
      </div>

      <div
        style={{
          height: "100%",
          minWidth: dim(compactSettings ? 28 : 22),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderLeft: `1px solid ${T.border}`,
        }}
      >
        {action}
      </div>
    </div>
  );
};

export const HeaderBroadcastScrollerStack = memo(({
  symbols = [],
  enabled = true,
  onSignalAction,
  onFlowAction,
  signalScanEnabled = false,
  signalScanPending = false,
  signalEvaluationPending = false,
  signalScanErrored = false,
  onToggleSignalScan,
  onChangeSignalMonitorTimeframe,
  onChangeSignalMonitorFreshWindowBars,
  onChangeSignalMonitorMaxSymbols,
  signalMatrixStates = [],
}) => {
  const rootRef = useRef(null);
  const viewport = useViewport();
  const isPhone = viewport.flags.isPhone;
  const signalSnapshot = useSignalMonitorSnapshot({
    subscribeToUpdates: enabled,
  });
  const flowScannerControl = useFlowScannerControlState({
    subscribe: enabled,
  });
  const broadFlowSnapshot = useMarketFlowSnapshotForStoreKey(
    BROAD_MARKET_FLOW_STORE_KEY,
    { subscribe: enabled },
  );
  const broadScanEnabled = Boolean(flowScannerControl.enabled);
  const broadScanOwnerActive = Boolean(flowScannerControl.ownerActive);
  const flowScannerConfig = flowScannerControl.config;
  const flowTapeFilters = useFlowTapeFilterState({
    subscribe: enabled,
  });
  const headerFlowTapeFilters = useMemo(
    () => buildHeaderFlowTapeFilters(flowTapeFilters),
    [flowTapeFilters],
  );
  const broadScanSnapshotActive = broadScanEnabled && broadScanOwnerActive;
  const broadScanSnapshotHasEvents = Boolean(
    broadFlowSnapshot.flowEvents?.length,
  );
  const broadScanSnapshotVisible = Boolean(
    broadScanSnapshotActive ||
      (broadScanEnabled &&
        (broadScanSnapshotHasEvents || broadFlowSnapshot.staleFlowEvents)),
  );
  const [openSettingsLane, setOpenSettingsLane] = useState(null);
  const [speedPreset, setSpeedPreset] = useState(() =>
    resolveHeaderBroadcastSpeedPreset(_initialState.headerBroadcastSpeedPreset),
  );
  const speedDurations = useMemo(
    () => getHeaderBroadcastSpeedDurations(speedPreset),
    [speedPreset],
  );
  const changeSpeedPreset = useCallback((nextPreset) => {
    const resolved = resolveHeaderBroadcastSpeedPreset(nextPreset);
    setSpeedPreset(resolved);
    persistState({ headerBroadcastSpeedPreset: resolved });
  }, []);
  useEffect(() => {
    const listener = (event) => {
      const nextPreset = event?.detail?.headerBroadcastSpeedPreset;
      if (!nextPreset) return;
      setSpeedPreset(resolveHeaderBroadcastSpeedPreset(nextPreset));
    };
    window.addEventListener("rayalgo:workspace-settings-updated", listener);
    return () => {
      window.removeEventListener("rayalgo:workspace-settings-updated", listener);
    };
  }, []);
  const changeFlowScannerConfig = useCallback((patch) => {
    setFlowScannerControlState({
      config: normalizeFlowScannerConfig({
        ...flowScannerConfig,
        ...patch,
        mode: FLOW_SCANNER_MODE.allWatchlistsPlusUniverse,
      }),
    });
  }, [flowScannerConfig]);
  const changeFlowTapeFilters = useCallback((patch) => {
    setFlowTapeFilterState({
      ...patch,
      activeFlowPresetId: null,
    });
  }, []);
  const changeFlowTapePreset = useCallback((presetId) => {
    setFlowTapeFilterState(buildFlowTapePresetPatch(presetId, flowTapeFilters));
  }, [flowTapeFilters]);
  const toggleBroadScan = useCallback(() => {
    setFlowScannerControlState({ enabled: !broadScanEnabled });
  }, [broadScanEnabled]);
  const [flowAdvancedOpen, setFlowAdvancedOpen] = useState(false);
  const [signalDraft, setSignalDraft] = useState({});
  const commitSignalProfileSetting = useCallback(
    ({ field, value }) => {
      if (field === "timeframe") onChangeSignalMonitorTimeframe?.(value);
      else if (field === "freshWindowBars") onChangeSignalMonitorFreshWindowBars?.(value);
      else if (field === "maxSymbols") onChangeSignalMonitorMaxSymbols?.(value);
      setSignalDraft((prev) => {
        if (!(field in prev)) return prev;
        const next = { ...prev };
        delete next[field];
        return next;
      });
    },
    [
      onChangeSignalMonitorTimeframe,
      onChangeSignalMonitorFreshWindowBars,
      onChangeSignalMonitorMaxSymbols,
    ],
  );
  const signalSave = useDebouncedSave(commitSignalProfileSetting, 400);
  const scheduleSignalProfileChange = useCallback(
    (field, value) => {
      setSignalDraft((prev) => ({ ...prev, [field]: value }));
      signalSave.schedule({ field, value });
    },
    [signalSave],
  );
  const [flowSaveState, setFlowSaveState] = useState("idle");
  const flowSaveTimerRef = useRef(null);
  const flashFlowSave = useCallback(() => {
    setFlowSaveState("saved");
    if (flowSaveTimerRef.current) clearTimeout(flowSaveTimerRef.current);
    flowSaveTimerRef.current = setTimeout(() => setFlowSaveState("idle"), 1200);
  }, []);
  useEffect(() => () => {
    if (flowSaveTimerRef.current) clearTimeout(flowSaveTimerRef.current);
  }, []);
  const scheduleFlowScannerChange = useCallback(
    (patch) => {
      changeFlowScannerConfig(patch);
      flashFlowSave();
    },
    [changeFlowScannerConfig, flashFlowSave],
  );
  const scheduleFlowTapeChange = useCallback(
    (patch) => {
      changeFlowTapeFilters(patch);
      flashFlowSave();
    },
    [changeFlowTapeFilters, flashFlowSave],
  );
  const scheduleFlowTapePreset = useCallback(
    (presetId) => {
      changeFlowTapePreset(presetId);
      flashFlowSave();
    },
    [changeFlowTapePreset, flashFlowSave],
  );
  const signalItems = useMemo(
    () => buildHeaderSignalTapeItems(signalSnapshot, { signalMatrixStates }),
    [signalMatrixStates, signalSnapshot],
  );
  const selectedSignalTimeframe = resolveHeaderSignalTimeframe(
    signalSnapshot?.profile?.timeframe,
  );
  const signalStatusSnapshot = useMemo(
    () =>
      buildSignalMonitorStatusSnapshot({
        profile: signalSnapshot?.profile,
        states: signalSnapshot?.states,
        universe: signalSnapshot?.universe,
      }),
    [signalSnapshot?.profile, signalSnapshot?.states, signalSnapshot?.universe],
  );
  const signalStateSummary = signalStatusSnapshot.stateSummary;
  const rawUnusualEvents = useMemo(
    () =>
      broadScanSnapshotVisible
        ? broadFlowSnapshot.flowEvents || []
        : [],
    [broadFlowSnapshot.flowEvents, broadScanSnapshotVisible],
  );
  const unusualEvents = useMemo(
    () =>
      rawUnusualEvents.length
        ? filterFlowTapeEvents(rawUnusualEvents, headerFlowTapeFilters)
        : [],
    [headerFlowTapeFilters, rawUnusualEvents],
  );
  const flowEventsFilteredOut = Boolean(
    rawUnusualEvents.length &&
      !unusualEvents.length &&
      flowTapeFiltersAreActive(headerFlowTapeFilters),
  );
  const unusualItems = useMemo(
    () => buildHeaderUnusualTapeItems(unusualEvents),
    [unusualEvents],
  );

  const signalBusy = Boolean(
    signalScanPending || signalEvaluationPending || signalSnapshot?.pending,
  );
  const signalRuntimeFallback = Boolean(
    isSignalMonitorRuntimeFallbackProfile(signalSnapshot?.profile),
  );
  const signalHasError = Boolean(
    !signalBusy &&
      (signalScanErrored || (signalSnapshot?.degraded && !signalRuntimeFallback)),
  );
  const signalDegraded = Boolean(
    !signalBusy && !signalHasError && signalSnapshot?.degraded,
  );
  const signalLastEvaluatedAt = signalStatusSnapshot.lastEvaluatedAt;
  const signalNoTrackedSymbols = Boolean(
    !signalBusy &&
      !signalHasError &&
      !signalDegraded &&
      signalScanEnabled &&
      signalLastEvaluatedAt &&
      signalStateSummary.total === 0,
  );
  const signalNoFreshSignals = Boolean(
    !signalBusy &&
      !signalHasError &&
      !signalDegraded &&
      signalScanEnabled &&
      signalStateSummary.total > 0 &&
      signalStateSummary.fresh === 0,
  );
  const signalEmptyLabel = signalHasError
    ? "SIGNALS ERROR"
    : signalDegraded
      ? "SIGNALS DEGRADED"
    : signalNoTrackedSymbols
      ? "NO SIGNAL DATA"
    : signalNoFreshSignals
      ? "NO FRESH SIGNALS"
    : signalBusy
      ? "SYNCING"
      : signalScanEnabled
        ? "NO SIGNALS"
        : "SIGNALS OFF";
  const flowStatus = unusualEvents.length
    ? "live"
    : rawUnusualEvents.length
      ? "live"
    : broadScanSnapshotVisible
      ? broadFlowSnapshot.flowStatus
      : broadScanEnabled
        ? "loading"
      : "empty";
  const flowProviderSummary = broadScanSnapshotVisible
    ? broadFlowSnapshot.providerSummary
    : null;
  const flowHasError =
    flowStatus === "offline" ||
    Boolean(flowProviderSummary?.erroredSource) ||
    Boolean(flowProviderSummary?.failures?.length);
  const flowDegraded =
    providerSummaryHasVisibleFlowDegradation(flowProviderSummary);
  const flowScanStale = Boolean(
    broadScanEnabled && !broadScanOwnerActive && broadScanSnapshotHasEvents,
  );
  const flowScanHasError = Boolean(broadScanOwnerActive && flowHasError);
  const flowScanDegraded = Boolean(
    broadScanOwnerActive && !flowScanHasError && flowDegraded,
  );
  const flowScanBusy = Boolean(
    broadScanOwnerActive &&
      !flowScanHasError &&
      !flowScanDegraded &&
      (flowStatus === "loading" || flowProviderSummary?.coverage?.isFetching),
  );
  const unusualEmptyLabel =
    flowStatus === "loading"
      ? "SYNCING"
      : flowHasError
        ? "FLOW OFFLINE"
        : flowDegraded
          ? "FLOW DEGRADED"
        : flowEventsFilteredOut
          ? "FLOW FILTERED"
        : unusualEvents.length
          ? "NO UNUSUAL FLOW"
          : "NO FLOW";

  // Status color semantics: green=active, accent=updating, amber=degraded, red=error.
  const flowScanTone = flowScanHasError
    ? T.red
    : flowScanDegraded
      ? T.amber
    : flowScanBusy
      ? T.accent
    : flowScanStale
      ? T.amber
      : broadScanSnapshotActive
        ? T.green
        : broadScanEnabled
          ? T.textMuted
          : T.textMuted;
  const flowScanStatusLabel = flowScanHasError
    ? "SCAN ERROR"
    : flowScanDegraded
      ? "DEGRADED"
    : flowScanBusy
      ? "SCANNING"
    : flowScanStale
      ? "STALE"
      : broadScanSnapshotActive
        ? "SCAN ON"
        : broadScanEnabled
          ? "SCAN IDLE"
        : "SCAN OFF";
  const broadToggleTitle = flowScanHasError
    ? "Flow scan degraded"
    : flowScanDegraded
      ? "Flow scan degraded"
    : flowScanBusy
      ? "Flow scan updating"
    : flowScanStale
      ? "Flow scan paused; showing last snapshot"
      : broadScanSnapshotActive
        ? "Flow scan active"
        : broadScanEnabled
          ? "Flow scan enabled"
        : "Start Flow scan";
  const signalScanTone = signalHasError
    ? T.red
    : signalDegraded
      ? T.amber
    : signalNoTrackedSymbols || signalNoFreshSignals
      ? T.amber
    : signalBusy
      ? T.accent
      : signalScanEnabled
        ? T.green
        : T.textMuted;
  const signalToggleTitle = signalHasError
    ? "Signal scan degraded"
    : signalDegraded
      ? "Signal scan running in runtime fallback"
    : signalNoTrackedSymbols
      ? "Signal scan has no tracked symbols"
    : signalNoFreshSignals
      ? "Signal scan has no fresh signals"
    : signalBusy
      ? "Signal scan updating"
      : signalScanEnabled
        ? "Signal scan active"
        : "Start signal scan";
  const signalStatusLabel = signalHasError
    ? "SCAN ERROR"
    : signalDegraded
      ? signalRuntimeFallback
        ? "RUNTIME"
        : "DEGRADED"
    : signalNoTrackedSymbols
      ? "NO DATA"
    : signalNoFreshSignals
      ? "NO FRESH"
    : signalScanPending
      ? "UPDATING"
      : signalEvaluationPending || signalSnapshot?.pending
        ? "SCANNING"
        : signalScanEnabled
        ? "SCAN ON"
        : "SCAN OFF";
  const signalUniverseLabel =
    signalStatusSnapshot.universeMode === "all_watchlists_plus_universe"
      ? "Watchlists + universe"
      : signalStatusSnapshot.universeMode === "all_watchlists"
        ? "All watchlists"
        : signalStatusSnapshot.universeMode === "selected_watchlist"
          ? "Selected watchlist"
          : MISSING_VALUE;
  const signalProfileTimeframe =
    signalDraft.timeframe ?? (signalSnapshot?.profile?.timeframe || "5m");
  const signalProfileFreshWindowBars =
    signalDraft.freshWindowBars ?? (signalSnapshot?.profile?.freshWindowBars ?? "");
  const signalProfileMaxSymbols =
    signalDraft.maxSymbols ??
    (signalStatusSnapshot.configuredMaxSymbols ??
      signalSnapshot?.profile?.maxSymbols ??
      "");
  const signalSettings = (
    <HeaderLaneSettingsPopover
      testId="header-signal-settings-popover"
      sheet={isPhone}
    >
      <HeaderLaneSettingsTitle
        label="SIGNALS"
        status={signalStatusLabel}
        tone={signalScanTone}
      />
      <HeaderLanePopoverSection
        title="Settings"
        saveState={signalSave.state}
        testId="header-signal-settings-section"
      >
        <HeaderLanePairRow>
          <HeaderLaneSegmentedControl
            value={speedPreset}
            onChange={changeSpeedPreset}
          />
          <HeaderLaneToggleButton
            active={signalScanEnabled}
            disabled={signalBusy || !onToggleSignalScan}
            onClick={onToggleSignalScan}
            testId="header-signal-scan-settings-toggle"
            tone={signalScanTone}
          >
            {signalScanEnabled ? "Signal Scan On" : "Signal Scan Off"}
          </HeaderLaneToggleButton>
        </HeaderLanePairRow>
        <HeaderLaneChipRow
          ariaLabel="Signal timeframe"
          value={signalProfileTimeframe}
          onChange={(value) => scheduleSignalProfileChange("timeframe", value)}
          testId="header-signal-settings-timeframe"
          options={[
            { value: "1m", label: "1m" },
            { value: "5m", label: "5m" },
            { value: "15m", label: "15m" },
            { value: "1h", label: "1h" },
            { value: "1d", label: "1d" },
          ]}
        />
        <HeaderLanePairRow>
          <HeaderLaneNumberControl
            label="Max"
            value={signalProfileMaxSymbols}
            min={1}
            max={250}
            onChange={(value) => scheduleSignalProfileChange("maxSymbols", value)}
            testId="header-signal-settings-max-symbols"
          />
          <HeaderLaneNumberControl
            label="Fresh"
            value={signalProfileFreshWindowBars}
            min={1}
            max={20}
            onChange={(value) => scheduleSignalProfileChange("freshWindowBars", value)}
            testId="header-signal-settings-fresh-window-bars"
          />
        </HeaderLanePairRow>
      </HeaderLanePopoverSection>
      <HeaderLanePopoverSection
        title="Status"
        testId="header-signal-status-section"
      >
        <HeaderLaneInfoRow label="Visible" value={signalItems.length} />
        <HeaderLaneInfoRow
          label="Tracked"
          value={
            signalStateSummary.total
              ? `${signalStateSummary.total} · ${signalStateSummary.fresh} fresh`
              : MISSING_VALUE
          }
          tone={
            signalNoTrackedSymbols || signalNoFreshSignals
              ? T.amber
              : T.textSec
          }
        />
        <HeaderLaneInfoRow
          label="Resolved"
          value={
            signalStatusSnapshot.resolvedSymbols == null
              ? MISSING_VALUE
              : signalStatusSnapshot.expansionSymbols
                ? `${signalStatusSnapshot.resolvedSymbols} (+${signalStatusSnapshot.expansionSymbols} expanded)`
                : `${signalStatusSnapshot.resolvedSymbols}`
          }
          tone={signalStatusSnapshot.shortfall ? T.amber : T.textSec}
        />
        <HeaderLaneInfoRow
          label="Universe"
          value={signalUniverseLabel}
          tone={signalStatusSnapshot.universeFallbackUsed ? T.amber : T.textSec}
        />
        <HeaderLaneInfoRow
          label="Last"
          value={
            signalLastEvaluatedAt
              ? formatRelativeTimeShort(signalLastEvaluatedAt)
              : MISSING_VALUE
          }
        />
      </HeaderLanePopoverSection>
    </HeaderLaneSettingsPopover>
  );
  const unusualCoverage = flowProviderSummary?.coverage || null;
  const unusualCurrentBatch = unusualCoverage?.currentBatch || [];
  const unusualLastScannedCount =
    unusualCoverage?.lastScannedAt && typeof unusualCoverage.lastScannedAt === "object"
      ? Object.keys(unusualCoverage.lastScannedAt).length
      : 0;
  const unusualScannedCount = Math.max(
    0,
    Math.round(
      Number.isFinite(unusualCoverage?.cycleScannedSymbols)
        ? unusualCoverage.cycleScannedSymbols
        : Number.isFinite(unusualCoverage?.scannedSymbols)
          ? unusualCoverage.scannedSymbols
          : unusualLastScannedCount,
    ),
  );
  const unusualTargetCount = Math.max(
    0,
    Math.round(
      Number.isFinite(unusualCoverage?.activeTargetSize)
        ? unusualCoverage.activeTargetSize
        : Number.isFinite(unusualCoverage?.totalSymbols)
          ? unusualCoverage.totalSymbols
          : Number.isFinite(unusualCoverage?.targetSize)
            ? unusualCoverage.targetSize
            : Number.isFinite(unusualCoverage?.selectedSymbols)
              ? unusualCoverage.selectedSymbols
              : flowScannerConfig.maxSymbols,
    ),
  );
  const unusualCoverageLabel = unusualCoverage
    ? unusualScannedCount > 0 || unusualTargetCount > 0
      ? `${unusualScannedCount}/${unusualTargetCount || unusualScannedCount}`
      : unusualCurrentBatch.length
        ? `warming ${unusualCurrentBatch.length}`
        : MISSING_VALUE
    : MISSING_VALUE;
  const unusualEventsLabel = flowEventsFilteredOut
    ? `${unusualItems.length}/${rawUnusualEvents.length}`
    : `${unusualItems.length}`;
  const unusualScanningNow = unusualCurrentBatch.length
    ? unusualCurrentBatch.slice(0, 4).join(" ")
    : MISSING_VALUE;
  const unusualBatchSize =
    unusualCoverage?.batchSize ?? flowScannerConfig.batchSize;
  const unusualConcurrency =
    unusualCoverage?.concurrency ?? flowScannerConfig.concurrency;
  const unusualLineDetail =
    Number.isFinite(unusualBatchSize) || Number.isFinite(unusualConcurrency)
      ? `${unusualBatchSize} batch / ${unusualConcurrency} conc`
      : MISSING_VALUE;
  const unusualSettings = (
    <HeaderLaneSettingsPopover
      testId="header-unusual-settings-popover"
      sheet={isPhone}
    >
      <HeaderLaneSettingsTitle
        label="FLOW"
        status={flowScanStatusLabel}
        tone={flowScanTone}
      />
      <HeaderLanePopoverSection
        title="Settings"
        saveState={flowSaveState}
        testId="header-unusual-settings-section"
      >
        <HeaderLanePairRow>
          <HeaderLaneSegmentedControl
            value={speedPreset}
            onChange={changeSpeedPreset}
          />
          <HeaderLaneToggleButton
            active={broadScanEnabled}
            onClick={toggleBroadScan}
            testId="header-unusual-settings-broad-toggle"
            tone={flowScanTone}
          >
            {broadScanEnabled ? (broadScanSnapshotActive ? "On" : "Idle") : "Off"}
          </HeaderLaneToggleButton>
        </HeaderLanePairRow>
        <HeaderLanePairRow>
          <HeaderLaneTextControl
            label="Include"
            value={flowTapeFilters.includeQuery}
            onChange={(value) => scheduleFlowTapeChange({ includeQuery: value })}
            testId="header-flow-filter-include"
            placeholder="SPY, QQQ"
          />
          <HeaderLaneTextControl
            label="Exclude"
            value={flowTapeFilters.excludeQuery}
            onChange={(value) => scheduleFlowTapeChange({ excludeQuery: value })}
            testId="header-flow-filter-exclude"
            placeholder="AAPL, TSLA"
          />
        </HeaderLanePairRow>
        <HeaderLanePairRow>
          <HeaderLaneSelectControl
            label="Flow"
            value={flowTapeFilters.filter}
            onChange={(value) => scheduleFlowTapeChange({ filter: value })}
            testId="header-flow-filter-type"
            options={FLOW_TAPE_FILTER_OPTIONS.map((option) => ({
              value: option.id,
              label: option.label,
            }))}
          />
          <HeaderLaneSelectControl
            label="MinPrm"
            value={String(flowTapeFilters.minPrem)}
            onChange={(value) => scheduleFlowTapeChange({ minPrem: Number(value) })}
            testId="header-flow-filter-min-premium"
            options={FLOW_MIN_PREMIUM_OPTIONS.map((option) => ({
              value: String(option.value),
              label: option.label,
            }))}
          />
        </HeaderLanePairRow>
        <HeaderLaneSelectControl
          label="Preset"
          value={flowTapeFilters.activeFlowPresetId || ""}
          onChange={scheduleFlowTapePreset}
          testId="header-flow-filter-preset"
          options={[
            { value: "", label: "None" },
            ...FLOW_BUILT_IN_PRESETS.map((preset) => ({
              value: preset.id,
              label: preset.label,
            })),
          ]}
        />
        <HeaderLaneSectionLabel>Scanner</HeaderLaneSectionLabel>
        <HeaderLanePairRow>
          <HeaderLaneSelectControl
            label="Scope"
            value={flowScannerConfig.scope}
            onChange={(value) => scheduleFlowScannerChange({ scope: value })}
            testId="header-flow-scan-scope"
            options={[
              { value: FLOW_SCANNER_SCOPE.unusual, label: "Unusual" },
              { value: FLOW_SCANNER_SCOPE.all, label: "All Flow" },
            ]}
          />
          <HeaderLaneNumberControl
            label="Symbols"
            value={flowScannerConfig.maxSymbols}
            min={FLOW_SCANNER_CONFIG_LIMITS.maxSymbols.min}
            max={FLOW_SCANNER_CONFIG_LIMITS.maxSymbols.max}
            onChange={(value) => scheduleFlowScannerChange({ maxSymbols: value })}
            testId="header-flow-scan-max-symbols"
          />
        </HeaderLanePairRow>
        <HeaderLaneMinPremiumChips
          value={flowScannerConfig.minPremium}
          onChange={(value) => scheduleFlowScannerChange({ minPremium: value })}
          testId="header-flow-scan-min-premium-chips"
        />
        <HeaderLaneAdvancedExpander
          open={flowAdvancedOpen}
          onToggle={() => setFlowAdvancedOpen((prev) => !prev)}
          label="Advanced"
          testId="header-flow-scan-advanced-toggle"
        >
          <HeaderLaneNumberControl
            label="Min $"
            value={flowScannerConfig.minPremium}
            min={FLOW_SCANNER_CONFIG_LIMITS.minPremium.min}
            max={FLOW_SCANNER_CONFIG_LIMITS.minPremium.max}
            step={5_000}
            onChange={(value) => scheduleFlowScannerChange({ minPremium: value })}
            testId="header-flow-scan-min-premium"
          />
          <HeaderLanePairRow>
            <HeaderLaneNumberControl
              label="Batch"
              value={flowScannerConfig.batchSize}
              min={FLOW_SCANNER_CONFIG_LIMITS.batchSize.min}
              max={FLOW_SCANNER_CONFIG_LIMITS.batchSize.max}
              onChange={(value) => scheduleFlowScannerChange({ batchSize: value })}
              testId="header-flow-scan-batch-size"
            />
            <HeaderLaneNumberControl
              label="Conc"
              value={flowScannerConfig.concurrency}
              min={FLOW_SCANNER_CONFIG_LIMITS.concurrency.min}
              max={FLOW_SCANNER_CONFIG_LIMITS.concurrency.max}
              onChange={(value) => scheduleFlowScannerChange({ concurrency: value })}
              testId="header-flow-scan-concurrency"
            />
          </HeaderLanePairRow>
          <HeaderLanePairRow>
            <HeaderLaneNumberControl
              label="Vol/OI"
              value={flowScannerConfig.unusualThreshold}
              min={FLOW_SCANNER_CONFIG_LIMITS.unusualThreshold.min}
              max={FLOW_SCANNER_CONFIG_LIMITS.unusualThreshold.max}
              step={0.1}
              onChange={(value) =>
                scheduleFlowScannerChange({ unusualThreshold: value })
              }
              testId="header-flow-scan-unusual-threshold"
            />
            <HeaderLaneNumberControl
              label="Max DTE"
              value={flowScannerConfig.maxDte}
              min={FLOW_SCANNER_CONFIG_LIMITS.maxDte.min}
              max={FLOW_SCANNER_CONFIG_LIMITS.maxDte.max}
              onChange={(value) =>
                scheduleFlowScannerChange({
                  maxDte: value === "" ? null : value,
                })
              }
              testId="header-flow-scan-max-dte"
              placeholder="Any"
            />
          </HeaderLanePairRow>
        </HeaderLaneAdvancedExpander>
      </HeaderLanePopoverSection>
      <HeaderLanePopoverSection
        title="Status"
        testId="header-unusual-status-section"
      >
        <HeaderLaneInfoRow
          label="Events"
          value={unusualEventsLabel}
          tone={flowEventsFilteredOut ? T.amber : T.textSec}
        />
        <HeaderLaneInfoRow
          label="Coverage"
          value={unusualCoverageLabel}
          tone={unusualScannedCount > 0 ? T.textSec : T.amber}
        />
        <HeaderLaneInfoRow
          label="Scanning"
          value={unusualScanningNow}
          tone={unusualCurrentBatch.length ? T.accent : T.textDim}
        />
        <HeaderLaneInfoRow
          label="Cycle"
          value={unusualLineDetail}
          tone={flowScanTone}
        />
        <HeaderLaneInfoRow
          label="Flow"
          value={flowStatus.toUpperCase()}
          tone={flowHasError ? T.red : flowStatus === "loading" ? T.accent : T.textSec}
        />
      </HeaderLanePopoverSection>
    </HeaderLaneSettingsPopover>
  );

  const signalTriggerActive = openSettingsLane === "signals";
  const unusualTriggerActive = openSettingsLane === "unusual";
  const buildLaneTriggerButton = ({ testId, ariaLabel, active, accentTone, content }) => (
    <button
      type="button"
      data-testid={testId}
      aria-label={ariaLabel}
      style={{
        width: "100%",
        height: "100%",
        minHeight: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: sp("0px 8px"),
        border: "none",
        background: active ? `${accentTone}14` : "transparent",
        color: active ? accentTone : T.textDim,
        cursor: "pointer",
        fontFamily: T.sans,
        fontSize: textSize("caption"),
        fontWeight: FONT_WEIGHTS.regular,
        whiteSpace: "nowrap",
      }}
    >
      {content}
    </button>
  );
  const popoverContentStyle = {
    width: dim(312),
    maxWidth: `min(${dim(340)}px, calc(100vw - ${dim(24)}px))`,
    padding: sp(8),
  };

  return (
    <div
      ref={rootRef}
      data-testid="header-broadcast-scrollers"
      className="ra-hairline-bottom"
      style={{
        flexShrink: 0,
        display: "grid",
        gridTemplateRows: "auto auto",
        minWidth: 0,
        background: T.bg0,
      }}
    >
      <Popover
        open={!isPhone && signalTriggerActive}
        onOpenChange={(next) => setOpenSettingsLane(next ? "signals" : null)}
      >
        <HeaderBroadcastLane
          label="SIGNALS"
          items={signalItems}
          emptyLabel={signalEmptyLabel}
          emptyTone={signalScanTone}
          testId="header-signal-tape"
          durationSeconds={speedDurations.signalDurationSeconds}
          compactSettings={isPhone}
          labelTrigger={
            <PopoverTrigger asChild>
              {buildLaneTriggerButton({
                testId: "header-signal-tape-settings-trigger",
                ariaLabel: "SIGNALS settings",
                active: signalTriggerActive,
                accentTone: T.accent,
                content: isPhone ? <Settings size={14} strokeWidth={2} /> : "SIGNALS",
              })}
            </PopoverTrigger>
          }
          action={
            <AppTooltip content={signalToggleTitle}><button
              type="button"
              data-testid="header-signal-scan-toggle"
              aria-label={signalToggleTitle}
              aria-pressed={signalScanEnabled}
              disabled={signalBusy || !onToggleSignalScan}
              onClick={onToggleSignalScan}
              style={{
                width: dim(isPhone ? 24 : 22),
                height: dim(isPhone ? 22 : 20),
                minHeight: dim(isPhone ? 22 : 20),
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                border: "none",
                borderRadius: dim(3),
                background: signalScanEnabled ? `${signalScanTone}18` : "transparent",
                color: signalScanTone,
                cursor: signalBusy ? "wait" : onToggleSignalScan ? "pointer" : "default",
              }}
            >
              <RadioTower size={14} strokeWidth={2.4} />
            </button></AppTooltip>
          }
        >
          {(item, duplicate, compact) => (
            <HeaderSignalTapeItem
              item={item}
              duplicate={duplicate}
              compact={compact}
              onClick={onSignalAction}
              selectedTimeframe={selectedSignalTimeframe}
            />
          )}
        </HeaderBroadcastLane>
        {!isPhone ? (
          <PopoverContent
            side="bottom"
            align="start"
            sideOffset={6}
            collisionPadding={12}
            style={popoverContentStyle}
          >
            {signalSettings}
          </PopoverContent>
        ) : null}
      </Popover>

      <Popover
        open={!isPhone && unusualTriggerActive}
        onOpenChange={(next) => setOpenSettingsLane(next ? "unusual" : null)}
      >
        <HeaderBroadcastLane
          label="FLOW"
          items={unusualItems}
          emptyLabel={unusualEmptyLabel}
          emptyTone={flowScanTone}
          testId="header-unusual-tape"
          durationSeconds={speedDurations.unusualDurationSeconds}
          compactSettings={isPhone}
          labelTrigger={
            <PopoverTrigger asChild>
              {buildLaneTriggerButton({
                testId: "header-unusual-tape-settings-trigger",
                ariaLabel: "FLOW settings",
                active: unusualTriggerActive,
                accentTone: T.accent,
                content: isPhone ? <Settings size={14} strokeWidth={2} /> : "FLOW",
              })}
            </PopoverTrigger>
          }
          action={
            <AppTooltip content={broadToggleTitle}><button
              type="button"
              data-testid="header-unusual-broad-toggle"
              aria-label={broadToggleTitle}
              aria-pressed={broadScanEnabled}
              onClick={toggleBroadScan}
              style={{
                width: dim(isPhone ? 24 : 22),
                height: dim(isPhone ? 22 : 20),
                minHeight: dim(isPhone ? 22 : 20),
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                border: "none",
                borderRadius: dim(3),
                background: broadScanEnabled ? `${flowScanTone}18` : "transparent",
                color: flowScanTone,
                cursor: "pointer",
              }}
            >
              <RadioTower size={14} strokeWidth={2.4} />
            </button></AppTooltip>
          }
        >
          {(item, duplicate, compact) => (
            <HeaderUnusualTapeItem
              item={item}
              duplicate={duplicate}
              compact={compact}
              onClick={onFlowAction}
            />
          )}
        </HeaderBroadcastLane>
        {!isPhone ? (
          <PopoverContent
            side="bottom"
            align="start"
            sideOffset={6}
            collisionPadding={12}
            style={popoverContentStyle}
          >
            {unusualSettings}
          </PopoverContent>
        ) : null}
      </Popover>

      <BottomSheet
        open={isPhone && openSettingsLane === "signals"}
        onClose={() => setOpenSettingsLane(null)}
        title="Signal Tape Settings"
        testId="header-signal-settings-sheet"
      >
        {signalSettings}
      </BottomSheet>
      <BottomSheet
        open={isPhone && openSettingsLane === "unusual"}
        onClose={() => setOpenSettingsLane(null)}
        title="Flow Tape Settings"
        testId="header-unusual-settings-sheet"
      >
        {unusualSettings}
      </BottomSheet>
    </div>
  );
});
