import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowDownCircle,
  ArrowUp,
  ArrowUpCircle,
  Ban,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  CircleEllipsis,
  CircleSlash,
  Clock,
  Info,
  LogIn,
  LogOut,
  MinusCircle,
  Settings,
  ShieldX,
  SkipForward,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BottomSheet } from "../../components/platform/BottomSheet.jsx";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { useViewport } from "../../lib/responsive";
import {
  classifyRequestHealth,
  requestHealthLabel,
  requestHealthTone,
} from "../../lib/requestHealthTone";
import { CSS_COLOR, cssColorMix, dim, FONT_WEIGHTS, fs, MISSING_VALUE, PYRUS_WORKSPACE_SETTINGS_EVENT, RADII, sp, T, textSize } from "../../lib/uiTokens.jsx";
import {
  formatOptionContractLabel,
  formatQuotePrice,
  formatRelativeTimeShort,
  signalBarsSinceTokens,
} from "../../lib/formatters";
import { joinMotionClasses, motionRowStyle, motionVars } from "../../lib/motion.jsx";
import { useDebouncedTextCommit } from "../../lib/useDebouncedTextCommit";
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
  buildHeaderAlgoTapeItems,
  buildHeaderSignalTapeItems,
  buildHeaderUnusualTapeItems,
  getHeaderBroadcastScrollDurationSeconds,
  resolveHeaderBroadcastSpeedPreset,
} from "./headerBroadcastModel";
import {
  BROAD_MARKET_FLOW_STORE_KEY,
  setFlowScannerControlState,
  useFlowScannerControlState,
  useMarketFlowSnapshotForStoreKey,
} from "./marketFlowStore";
import {
  providerSummaryHasMarketSessionQuiet,
  providerSummaryHasVisibleFlowDegradation,
} from "./flowSourceState.js";
import { buildSignalMonitorStatusSnapshot } from "./signalMonitorStatusModel";
import { WATCHLIST_SIGNAL_TIMEFRAMES } from "./watchlistModel.js";
import {
  FLOW_SCANNER_CONFIG_LIMITS,
  FLOW_SCANNER_MODE,
  FLOW_SCANNER_SCOPE,
  normalizeFlowScannerConfig,
} from "./marketFlowScannerConfig";
import { useSignalMonitorSnapshot } from "./signalMonitorStore";
import { IbkrStatusWave } from "./IbkrConnectionStatus";
import { canonicalizeStreamState, streamStateTokenVar } from "./streamSemantics";
import { getCurrentSignalDirection } from "../signals/signalStateFreshness.js";
import { toneForDirectionalIntent, toneForOptionSide } from "./semanticToneModel.js";
import { AppTooltip } from "@/components/ui/tooltip";

const HEADER_FLOW_LANE_ITEM_LIMIT = 32;

const fmtCompactCurrency = (value) => {
  if (value == null || Number.isNaN(value)) return MISSING_VALUE;
  if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (Math.abs(value) >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
};

const providerSummaryHasFlowState = (providerSummary) => {
  if (!providerSummary || typeof providerSummary !== "object") {
    return false;
  }
  const coverage = providerSummary.coverage || {};
  return Boolean(
    providerSummary.erroredSource ||
      providerSummary.errorMessage ||
      providerSummary.failures?.length ||
      Object.keys(providerSummary.sourcesBySymbol || {}).length ||
      coverage.degradedReason ||
      Number(coverage.totalSymbols) > 0 ||
      Number(coverage.activeTargetSize) > 0 ||
      Number(coverage.selectedSymbols) > 0,
  );
};
const HeaderBroadcastSegment = ({
  item,
  duplicate = false,
  tone = CSS_COLOR.textSec,
  accent = CSS_COLOR.borderLight,
  children,
  onClick,
  ariaLabel,
  compact = false,
  maxWidth,
  border,
  boxShadow,
  background,
}) => {
  const interactive = !duplicate && typeof onClick === "function";
  const Component = interactive ? "button" : "div";

  const segment = (
    <Component
      type={interactive ? "button" : undefined}
      aria-hidden={duplicate || undefined}
      aria-label={interactive && ariaLabel ? ariaLabel : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? () => onClick(item) : undefined}
      className={interactive ? "ra-interactive" : undefined}
      style={{
        ...motionVars({ accent: tone }),
        display: "inline-flex",
        alignItems: "center",
        gap: sp(compact ? 5 : 6),
        height: dim(compact ? 19 : 24),
        minHeight: dim(compact ? 19 : 24),
        minWidth: 0,
        maxWidth: dim(maxWidth ?? (compact ? 180 : 300)),
        padding: sp(compact ? "0px 7px" : "0px 10px"),
        boxSizing: "border-box",
        border: border ?? "none",
        borderRadius: dim(RADII.xs),
        background: background ?? `${cssColorMix(tone, 5)}`,
        boxShadow,
        color: CSS_COLOR.textSec,
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

  return segment;
};

const headerPillTextStyle = ({
  color = CSS_COLOR.textSec,
  maxWidth = null,
  shrink = true,
  weight = FONT_WEIGHTS.medium,
} = {}) => ({
  color,
  minWidth: 0,
  maxWidth: maxWidth == null ? undefined : dim(maxWidth),
  flexShrink: shrink ? 1 : 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontFamily: T.sans,
  fontWeight: weight,
  fontVariantNumeric: "tabular-nums",
});

const headerSignalIntervalStateEqual = (left, right) =>
  left?.currentSignalDirection === right?.currentSignalDirection &&
  // Direction renders trend-first (getCurrentSignalDirection prefers
  // trendDirection), so a pure trend flip must bust the memo or the dot keeps
  // showing the stale trend.
  left?.trendDirection === right?.trendDirection &&
  left?.indicatorSnapshot?.trendDirection ===
    right?.indicatorSnapshot?.trendDirection &&
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
  const isDirectional = item.direction === "buy" || item.direction === "sell";
  // A not-fresh directional broadcast recolors the arrow amber in its last-known
  // direction, matching the SignalDots / Signals-screen arrows. Fresh keeps the
  // broadcast scheme (buy = blue, sell = red).
  const stale = isDirectional && item.fresh === false;
  const tone = stale ? CSS_COLOR.amber : isSell ? CSS_COLOR.red : toneForDirectionalIntent(item.direction);
  const DirectionIcon = isSell ? ArrowDown : ArrowUp;
  const priceLabel =
    item.price != null && Number.isFinite(Number(item.price))
      ? formatQuotePrice(Number(item.price))
      : null;

  return (
    <HeaderBroadcastSegment
      item={item}
      duplicate={duplicate}
      tone={tone}
      accent={item.fresh ? tone : CSS_COLOR.border}
      onClick={(selected) => onClick?.(selected.symbol, selected.raw)}
      compact={compact}
    >
      <DirectionIcon
        size={compact ? 12 : 13}
        strokeWidth={2.4}
        color={tone}
        aria-hidden="true"
        style={{ flexShrink: 0 }}
      />
      <span style={headerPillTextStyle({ color: CSS_COLOR.text, maxWidth: compact ? 62 : 78 })}>
        {item.symbol}
      </span>
      {priceLabel ? (
        <span style={headerPillTextStyle({ color: CSS_COLOR.textSec, maxWidth: compact ? 48 : 58, shrink: false })}>
          {priceLabel}
        </span>
      ) : null}
      <span style={headerPillTextStyle({ color: CSS_COLOR.textMuted, maxWidth: compact ? 34 : 42, shrink: false })}>
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

const colorWithAlpha = (color, alpha) =>
  cssColorMix(color, Math.round(alpha * 100));

const normalizeSignalIntervalDirection = (state) => {
  return getCurrentSignalDirection(state);
};

const resolveHeaderSignalTimeframe = (value) => {
  const normalized = String(value || "").trim();
  return WATCHLIST_SIGNAL_TIMEFRAMES.includes(normalized) ? normalized : "5m";
};

const HEADER_SIGNAL_CONTEXT_SLANT = 5;
const HEADER_SIGNAL_CONTEXT_VIEWBOX = "0 0 48 32";

const getHeaderSignalContextShapePoints = (isLast) =>
  isLast ? "8,0 48,0 48,32 0,32" : "8,0 48,0 40,32 0,32";

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
      stroke={colorWithAlpha(CSS_COLOR.textSec, 0.36)}
      strokeWidth="1"
      vectorEffect="non-scaling-stroke"
    />
  </svg>
);

const HeaderSignalPelletChrome = ({ fill, selected, isLast }) => {
  const points = getHeaderSignalContextShapePoints(isLast);

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
          stroke={CSS_COLOR.amber}
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
      minWidth: 0,
      maxWidth: dim(124),
      flexShrink: 0,
      gap: 0,
      marginRight: compact ? "-7px" : "-10px",
      overflow: "hidden",
      borderTopRightRadius: dim(RADII.xs),
      borderBottomRightRadius: dim(RADII.xs),
    }}
  >
    {WATCHLIST_SIGNAL_TIMEFRAMES.map((timeframe, index) => {
      const isLast = index === WATCHLIST_SIGNAL_TIMEFRAMES.length - 1;
      const state = statesByTimeframe?.[timeframe];
      const status = state?.status || "unknown";
      const direction = normalizeSignalIntervalDirection(state);
      const hasDirection = Boolean(direction);
      const pending = !state || status === "pending";
      const color =
        direction === "buy" ? toneForDirectionalIntent(direction) : direction === "sell" ? CSS_COLOR.red : CSS_COLOR.textMuted;
      const fresh = Boolean(state?.fresh);
      const selected = timeframe === resolveHeaderSignalTimeframe(selectedTimeframe);
      const label = pending
        ? `${timeframe} pending`
        : hasDirection
          ? [
              `${timeframe} ${direction.toUpperCase()} ${fresh ? "fresh" : "aged"}`,
              ...signalBarsSinceTokens(state),
            ].join(" · ")
          : `${timeframe} no signal - ${status}`;
      const pelletFill = hasDirection
        ? colorWithAlpha(color, fresh ? 0.24 : 0.18)
        : pending
          ? colorWithAlpha(CSS_COLOR.textMuted, 0.08)
          : colorWithAlpha(CSS_COLOR.textMuted, 0.1);
      const labelColor = hasDirection ? color : pending ? CSS_COLOR.textDim : CSS_COLOR.textSec;
      const width = timeframe === "15m" ? 34 : 26;

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
              fontSize: textSize("caption"),
              fontWeight: FONT_WEIGHTS.medium,
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1,
              zIndex: selected ? 3 : 1,
            }}
          >
            <HeaderSignalPelletChrome
              fill={pelletFill}
              selected={selected}
              isLast={isLast}
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
  const tone = toneForOptionSide(item.right, toneForDirectionalIntent(item.sentiment));
  const SentimentIcon = isPut ? TrendingDown : TrendingUp;
  const formattedContractLabel = formatOptionContractLabel(item, {
    includeSymbol: false,
    fallback: "",
  });
  const contractLabel =
    formattedContractLabel ||
    String(item.contract || "").replace(new RegExp(`^${item.symbol}\\s+`, "i"), "");
  const scoreLabel = item.score ? `${item.score.toFixed(1)}x` : null;

  return (
    <HeaderBroadcastSegment
      item={item}
      duplicate={duplicate}
      tone={tone}
      accent={CSS_COLOR.border}
      onClick={(selected) => onClick?.(selected.raw)}
      compact={compact}
    >
      <SentimentIcon
        size={compact ? 12 : 13}
        strokeWidth={2.4}
        color={tone}
        aria-hidden="true"
        style={{ flexShrink: 0 }}
      />
      <span style={headerPillTextStyle({ color: CSS_COLOR.text, maxWidth: compact ? 58 : 72 })}>
        {item.symbol}
      </span>
      {contractLabel ? (
        <span style={headerPillTextStyle({ color: tone, maxWidth: compact ? 96 : 126 })}>
          {contractLabel}
        </span>
      ) : null}
      <span style={headerPillTextStyle({ color: CSS_COLOR.textSec, maxWidth: compact ? 56 : 68, shrink: false })}>
        {fmtCompactCurrency(item.premium)}
      </span>
      {scoreLabel ? (
        <span style={headerPillTextStyle({ color: CSS_COLOR.amber, maxWidth: compact ? 34 : 42, shrink: false })}>
          {scoreLabel}
        </span>
      ) : null}
      <span style={headerPillTextStyle({ color: CSS_COLOR.textMuted, maxWidth: compact ? 34 : 42, shrink: false })}>
        {item.ageLabel || formatRelativeTimeShort(item.time)}
      </span>
    </HeaderBroadcastSegment>
  );
};

const resolveAlgoTone = (toneKind) => {
  if (toneKind === "success") return CSS_COLOR.green;
  if (toneKind === "danger") return CSS_COLOR.red;
  if (toneKind === "warning") return CSS_COLOR.amber;
  if (toneKind === "accent") return CSS_COLOR.accent;
  return CSS_COLOR.textSec;
};

const ALGO_EVENT_ICONS = {
  entry: LogIn,
  exit: LogOut,
  skip: SkipForward,
  blocked: ShieldX,
  mark: Activity,
  config: SlidersHorizontal,
  deploy: Bot,
  algo: Bot,
};

const ALGO_CONTEXT_ICONS = {
  call: TrendingUp,
  put: TrendingDown,
  opened: CheckCircle2,
  profit_exit: ArrowUpCircle,
  loss_exit: ArrowDownCircle,
  flat_exit: MinusCircle,
  skipped: CircleSlash,
  blocked: ShieldX,
  rejected: Ban,
  cancelled: XCircle,
  working: Clock,
  partial_fill: CircleEllipsis,
  mark: Activity,
  config: SlidersHorizontal,
  deploy: Bot,
  money: CircleDollarSign,
  reason: AlertTriangle,
};

const HeaderAlgoContextIcon = ({ context, compact = false }) => {
  if (context.kind === "quantity" || context.kind === "dte") {
    return (
      <AppTooltip content={context.label}>
        <span
          aria-label={context.label}
          style={{
            display: "inline-flex",
            alignItems: "center",
            flexShrink: 0,
            color: context.kind === "dte" ? CSS_COLOR.textMuted : CSS_COLOR.textSec,
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            fontWeight: FONT_WEIGHTS.medium,
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1,
            whiteSpace: "nowrap",
          }}
        >
          {context.valueLabel || ""}
        </span>
      </AppTooltip>
    );
  }

  const tone = resolveAlgoTone(context.toneKind);
  const Icon = ALGO_CONTEXT_ICONS[context.iconKind] || Info;
  const hasValue = Boolean(context.valueLabel);
  const isContract = context.kind === "contract";
  const contextMaxWidth = isContract ? (compact ? 92 : 116) : (compact ? 62 : 84);
  const label = context.valueLabel
    ? `${context.label} ${context.valueLabel}`
    : context.label;

  return (
    <AppTooltip content={label}>
      <span
        aria-label={label}
        style={{
          display: "inline-flex",
          alignItems: "center",
          minWidth: 0,
          maxWidth: dim(contextMaxWidth),
          flexShrink: isContract || hasValue ? 1 : 0,
          gap: hasValue ? sp(2) : 0,
          color: tone,
          fontFamily: T.sans,
          fontSize: textSize("caption"),
          fontWeight: FONT_WEIGHTS.medium,
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1,
          whiteSpace: "nowrap",
          overflow: "hidden",
        }}
      >
        <Icon
          size={isContract ? (compact ? 12 : 13) : compact ? 11 : 12}
          strokeWidth={2.2}
          aria-hidden="true"
        />
        {hasValue ? (
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              minWidth: 0,
              maxWidth: dim(contextMaxWidth - (isContract ? 16 : 14)),
              whiteSpace: "nowrap",
            }}
          >
            {context.valueLabel}
          </span>
        ) : null}
      </span>
    </AppTooltip>
  );
};

const HeaderAlgoTradeMetricPill = ({
  context,
  compact = false,
  tooltipsEnabled = true,
}) => {
  const tone = resolveAlgoTone(context.toneKind);
  const metricTone = `color-mix(in srgb, ${tone} 80%, ${CSS_COLOR.text})`;

  return (
    <AppTooltip content={context.label} disabled={!tooltipsEnabled}>
      <span
        data-algo-trade-metric={context.metricLabel}
        aria-label={context.label}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: sp(2),
          height: dim(compact ? 15 : 18),
          flexShrink: 0,
          padding: sp(compact ? "0px 3px" : "0px 4px"),
          border: `1px solid ${cssColorMix(tone, 22)}`,
          borderRadius: dim(RADII.pill),
          background: cssColorMix(tone, 8),
          color: metricTone,
          fontFamily: T.sans,
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1,
          whiteSpace: "nowrap",
        }}
      >
        <span
          style={{
            color: CSS_COLOR.textSec,
            fontSize: textSize("micro"),
            fontWeight: FONT_WEIGHTS.label,
            letterSpacing: "0.02em",
          }}
        >
          {context.metricLabel}
        </span>
        <span
          style={{
            fontSize: textSize("caption"),
            fontWeight: FONT_WEIGHTS.label,
          }}
        >
          {context.valueLabel}
        </span>
      </span>
    </AppTooltip>
  );
};

const HeaderAlgoTapeItem = ({
  item,
  duplicate = false,
  onClick,
  compact = false,
}) => {
  const tone = resolveAlgoTone(item.toneKind);
  const Icon = ALGO_EVENT_ICONS[item.iconKind] || Info;
  const timeLabel = formatRelativeTimeShort(item.time);
  const contextLabels = (item.contextIcons || []).map(
    (context) => context.label,
  );
  const contextIcons = (item.contextIcons || []).filter(
    (context) => !context.metricLabel,
  );
  const tradeMetrics = (item.contextIcons || []).filter(
    (context) => context.metricLabel,
  );
  const title = [item.actionLabel, item.symbol, ...contextLabels, timeLabel]
    .filter(Boolean)
    .join(" ");

  return (
    <HeaderBroadcastSegment
      item={item}
      duplicate={duplicate}
      tone={tone}
      accent={CSS_COLOR.border}
      onClick={(selected) => onClick?.(selected.raw)}
      ariaLabel={title}
      compact={compact}
      maxWidth={compact ? 260 : 360}
    >
      <Icon
        size={compact ? 12 : 13}
        strokeWidth={2.4}
        color={tone}
        aria-hidden="true"
        style={{ flexShrink: 0 }}
      />
      <span
        style={headerPillTextStyle({
          color: tone,
          maxWidth: compact ? 78 : 104,
        })}
      >
        {item.actionLabel}
      </span>
      <span
        style={headerPillTextStyle({
          color: CSS_COLOR.text,
          maxWidth: compact ? 58 : 72,
          shrink: false,
        })}
      >
        {item.symbol}
      </span>
      {contextIcons.map((context) => (
        <HeaderAlgoContextIcon
          key={context.kind}
          context={context}
          compact={compact}
        />
      ))}
      <span
        style={headerPillTextStyle({
          color: CSS_COLOR.textMuted,
          maxWidth: compact ? 34 : 42,
          shrink: false,
        })}
      >
        {timeLabel}
      </span>
      {tradeMetrics.length ? (
        <span
          data-algo-trade-metrics
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: sp(2),
            minWidth: 0,
            marginLeft: "auto",
            flexShrink: 0,
          }}
        >
          {tradeMetrics.map((context) => (
            <HeaderAlgoTradeMetricPill
              key={context.kind}
              context={context}
              compact={compact}
              tooltipsEnabled={!duplicate}
            />
          ))}
        </span>
      ) : null}
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
          background: CSS_COLOR.bg0,
          color: CSS_COLOR.text,
          fontFamily: T.sans,
        }
      : {
          maxHeight: `calc(100vh - ${dim(24)}px)`,
          overflowY: "auto",
          color: CSS_COLOR.text,
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
  const tone = state === "pending" ? CSS_COLOR.textDim : CSS_COLOR.accent;
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
        color: CSS_COLOR.textMuted,
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
        color: open ? CSS_COLOR.textSec : CSS_COLOR.textMuted,
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
            ...motionVars({ accent: CSS_COLOR.accent }),
            minHeight: dim(22),
            border: `1px solid ${active ? CSS_COLOR.accent : CSS_COLOR.border}`,
            borderRadius: dim(RADII.sm),
            background: active ? `${cssColorMix(CSS_COLOR.accent, 9)}` : CSS_COLOR.bg1,
            color: active ? CSS_COLOR.accent : CSS_COLOR.textDim,
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
            ...motionVars({ accent: CSS_COLOR.accent }),
            minHeight: dim(22),
            border: `1px solid ${active ? CSS_COLOR.accent : CSS_COLOR.border}`,
            borderRadius: dim(RADII.sm),
            background: active ? `${cssColorMix(CSS_COLOR.accent, 9)}` : CSS_COLOR.bg1,
            color: active ? CSS_COLOR.accent : CSS_COLOR.textDim,
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

const HeaderLaneSettingsTitle = ({ label, status, tone = CSS_COLOR.textDim }) => (
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
        color: CSS_COLOR.textSec,
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

const HeaderLaneInfoRow = ({ label, value, tone = CSS_COLOR.textSec }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: sp(8),
      minHeight: dim(20),
      color: CSS_COLOR.textDim,
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
      color: CSS_COLOR.textMuted,
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
            ...motionVars({ accent: CSS_COLOR.accent }),
            minHeight: dim(24),
            border: `1px solid ${active ? CSS_COLOR.accent : CSS_COLOR.border}`,
            background: active ? `${cssColorMix(CSS_COLOR.accent, 9)}` : CSS_COLOR.bg1,
            color: active ? CSS_COLOR.accent : CSS_COLOR.textDim,
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

const resolveHeaderLaneWaveMotion = (status) => {
  const state = canonicalizeStreamState(status, "no-subscribers");
  if (state === "healthy") return "fast";
  if (state === "checking" || state === "capacity-limited" || state === "reconnecting") {
    return "slow";
  }
  return "flat";
};

const HeaderLaneWaveIcon = ({ status = "no-subscribers", dataTestId }) => {
  const state = canonicalizeStreamState(status, "no-subscribers");

  return (
    <IbkrStatusWave
      status={state}
      color={streamStateTokenVar(state)}
      wave={resolveHeaderLaneWaveMotion(state)}
      width={20}
      height={12}
      dataTestId={dataTestId}
    />
  );
};

const HeaderLaneToggleButton = ({
  active,
  disabled = false,
  onClick,
  children,
  testId,
  tone = CSS_COLOR.accent,
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
      border: `1px solid ${active ? tone : CSS_COLOR.border}`,
      background: active ? `${cssColorMix(tone, 9)}` : CSS_COLOR.bg1,
      color: disabled ? CSS_COLOR.textMuted : active ? tone : CSS_COLOR.textSec,
      cursor: disabled ? "default" : "pointer",
      fontFamily: T.sans,
      fontSize: textSize("caption"),
      fontWeight: FONT_WEIGHTS.regular,
    }}
  >
    {children}
  </button>
);

const headerLaneControlInputStyle = {
  width: "100%",
  minHeight: dim(24),
  background: CSS_COLOR.bg1,
  border: `1px solid ${CSS_COLOR.border}`,
  borderRadius: dim(RADII.sm),
  color: CSS_COLOR.text,
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
      color: CSS_COLOR.textDim,
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

const HeaderLaneTextControl = ({ label, value, onChange, testId, placeholder }) => {
  const { inputProps } = useDebouncedTextCommit({
    value,
    onCommit: onChange,
  });

  return (
    <HeaderLaneControlRow label={label}>
      <input
        data-testid={testId}
        type="text"
        {...inputProps}
        placeholder={placeholder}
        style={headerLaneControlInputStyle}
      />
    </HeaderLaneControlRow>
  );
};

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

// Keys only the fields that change a pill's rendered WIDTH, so the scroll
// animation is not torn down and restarted on every re-evaluation. Volatile,
// non-layout fields (time, fresh) are intentionally excluded — they recolor or
// relabel in place, and the ResizeObserver still re-measures on any real size
// change, so the marquee no longer jumps back to the start each tick.
const buildHeaderBroadcastLaneMeasureKey = (items = []) =>
  (items || [])
    .map((item) =>
      [
        item?.id,
        item?.symbol,
        item?.directionLabel,
        item?.actionLabel,
        item?.contract,
        item?.optionTicker,
        item?.premium,
        item?.score,
        item?.price,
        item?.ageLabel,
        item?.timeframe,
        ...(item?.contextIcons || []).map(
          (context) =>
            `${context?.kind || ""}:${context?.label || ""}:${
              context?.valueLabel || ""
            }`,
        ),
      ].join(":"),
    )
    .join("|");

const HeaderBroadcastLane = ({
  label,
  items,
  emptyLabel,
  emptyTone = null,
  testId,
  statusGlyph,
  children,
  speedPreset = "slow",
  settingsOpen = false,
  onToggleSettings,
  labelTrigger,
  compactSettings = false,
}) => {
  const shouldScroll = items.length >= 4;
  const renderedItems = shouldScroll ? [...items, ...items] : items;
  const measureKey = useMemo(
    () => buildHeaderBroadcastLaneMeasureKey(items),
    [items],
  );
  const trackRef = useRef(null);
  const [scrollDistancePx, setScrollDistancePx] = useState(0);
  const durationSeconds = useMemo(
    () =>
      getHeaderBroadcastScrollDurationSeconds(speedPreset, {
        scrollDistancePx,
      }),
    [scrollDistancePx, speedPreset],
  );
  const laneGridColumns = [
    compactSettings ? `${dim(44)}px` : "56px",
    statusGlyph ? `${dim(compactSettings ? 32 : 26)}px` : null,
    "minmax(0, 1fr)",
  ]
    .filter(Boolean)
    .join(" ");

  useEffect(() => {
    if (!shouldScroll) {
      setScrollDistancePx(0);
      return undefined;
    }

    const track = trackRef.current;
    if (!track) return undefined;

    let frame = 0;
    const measure = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const nextDistance = Math.round((track.scrollWidth || 0) / 2);
        setScrollDistancePx((current) =>
          current === nextDistance ? current : nextDistance,
        );
      });
    };

    measure();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => {
        if (frame) window.cancelAnimationFrame(frame);
        window.removeEventListener("resize", measure);
      };
    }

    const observer = new ResizeObserver(measure);
    observer.observe(track);
    window.addEventListener("resize", measure);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [compactSettings, measureKey, shouldScroll]);

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
        minHeight: compactSettings ? dim(44) : 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: sp(compactSettings ? "0px 8px" : "0px 4px"),
        border: "none",
        background: settingsOpen ? `${cssColorMix(CSS_COLOR.accent, 8)}` : "transparent",
        color: settingsOpen ? CSS_COLOR.accent : CSS_COLOR.textDim,
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
      className={compactSettings ? "ra-mobile-broadcast-lane" : "ra-hairline-bottom"}
      style={{
        display: "grid",
        gridTemplateColumns: laneGridColumns,
        alignItems: "center",
        minHeight: dim(compactSettings ? 44 : 20),
        minWidth: 0,
        border: compactSettings ? `1px solid ${CSS_COLOR.border}` : undefined,
        borderRadius: compactSettings ? dim(RADII.sm) : undefined,
        background: compactSettings ? CSS_COLOR.bg0 : undefined,
        overflow: compactSettings ? "hidden" : undefined,
      }}
    >
      <div
        style={{
          height: "100%",
          minHeight: compactSettings ? dim(44) : undefined,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRight: `1px solid ${CSS_COLOR.border}`,
        }}
      >
        {labelTrigger ?? defaultTrigger}
      </div>

      {statusGlyph ? (
        <div
          data-header-lane-status-glyph
          style={{
            height: "100%",
            minHeight: compactSettings ? dim(44) : undefined,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRight: `1px solid ${CSS_COLOR.border}`,
            pointerEvents: "none",
          }}
        >
          {statusGlyph}
        </div>
      ) : null}

      <div
        data-header-broadcast-viewport
        style={{
          minWidth: 0,
          overflowX: "hidden",
          overflowY: "hidden",
          padding: sp(compactSettings ? "1px 5px" : "1px 6px"),
        }}
      >
        {items.length ? (
          <div
            data-header-broadcast-track
            ref={trackRef}
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
                background: emptyTone || CSS_COLOR.textMuted,
                boxShadow: emptyTone
                  ? `0 0 0 3px ${cssColorMix(emptyTone, 14)}`
                  : "none",
              }}
            />
            <span
              style={{
                color: emptyTone || CSS_COLOR.textMuted,
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
    </div>
  );
};

export const HeaderBroadcastScrollerStack = memo(({
  symbols = [],
  enabled = true,
  onSignalAction,
  onFlowAction,
  onAlgoAction,
  algoEvents = [],
  signalScanEnabled = false,
  signalScanPending = false,
  signalEvaluationPending = false,
  signalScanErrored = false,
  onToggleSignalScan,
  onChangeSignalMonitorTimeframe,
  onChangeSignalMonitorFreshWindowBars,
  onChangeSignalMonitorMaxSymbols,
  signalMatrixStates = [],
  safeQaMode = false,
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
  const broadScanRuntimeActive = broadScanOwnerActive;
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
  const broadScanSnapshotHasProviderState = providerSummaryHasFlowState(
    broadFlowSnapshot.providerSummary,
  );
  const broadScanSnapshotVisible = Boolean(
    broadScanSnapshotActive ||
      (broadScanEnabled &&
        (broadScanSnapshotHasEvents ||
          broadFlowSnapshot.staleFlowEvents ||
          broadScanSnapshotHasProviderState)),
  );
  const [openSettingsLane, setOpenSettingsLane] = useState(null);
  const [speedPreset, setSpeedPreset] = useState(() =>
    resolveHeaderBroadcastSpeedPreset(_initialState.headerBroadcastSpeedPreset),
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
    window.addEventListener(PYRUS_WORKSPACE_SETTINGS_EVENT, listener);
    return () => {
      window.removeEventListener(PYRUS_WORKSPACE_SETTINGS_EVENT, listener);
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
      broadScanSnapshotVisible && broadFlowSnapshot.flowEvents?.length
        ? broadFlowSnapshot.flowEvents
        : [],
    [
      broadFlowSnapshot.flowEvents,
      broadScanSnapshotVisible,
    ],
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
  const flowHasRetainedEvents = rawUnusualEvents.length > 0;
  const unusualItems = useMemo(
    () =>
      buildHeaderUnusualTapeItems(unusualEvents, {
        maxItems: HEADER_FLOW_LANE_ITEM_LIMIT,
      }),
    [unusualEvents],
  );
  const algoItems = useMemo(
    () => buildHeaderAlgoTapeItems(algoEvents),
    [algoEvents],
  );

  const signalBusy = Boolean(
    signalScanPending || signalEvaluationPending || signalSnapshot?.pending,
  );
  const signalHasError = Boolean(
    !signalBusy &&
      (signalScanErrored ||
        // Matrix SSE repeatedly dead → hard transport failure (red).
        signalSnapshot?.transportError ||
        signalSnapshot?.degraded),
  );
  // Softer transport surfaces (amber): request pacing / 429 is retrying, and a
  // failed profile fetch means we cannot confirm the real state (never OFF).
  const signalRateLimited = Boolean(
    !signalBusy && !signalHasError && signalSnapshot?.rateLimited,
  );
  const signalStreamUncertain = Boolean(
    !signalBusy &&
      !signalHasError &&
      !signalRateLimited &&
      signalSnapshot?.streamErrored,
  );
  const signalLastEvaluatedAt = signalStatusSnapshot.lastEvaluatedAt;
  const signalNoTrackedSymbols = Boolean(
    !signalBusy &&
      !signalHasError &&
      signalScanEnabled &&
      signalLastEvaluatedAt &&
      signalStateSummary.total === 0,
  );
  const signalNoFreshSignals = Boolean(
    !signalBusy &&
      !signalHasError &&
      signalScanEnabled &&
      signalStateSummary.total > 0 &&
      signalStateSummary.fresh === 0,
  );
  const signalEmptyLabel = signalHasError
    ? "SIGNALS ERROR"
    : signalRateLimited
      ? "SIGNALS RATE LIMITED"
    : signalStreamUncertain
      ? "SIGNALS UNAVAILABLE"
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
    : flowHasRetainedEvents
      ? "live"
    : broadScanSnapshotVisible
      ? broadFlowSnapshot.flowStatus
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
  const flowSessionQuiet =
    providerSummaryHasMarketSessionQuiet(flowProviderSummary);
  const flowSessionQuietWithRetainedEvents = Boolean(
    flowSessionQuiet && flowHasRetainedEvents,
  );
  const flowCoverage = flowProviderSummary?.coverage || {};
  const flowScanCoverageActive = Boolean(
    broadScanEnabled &&
      !flowSessionQuiet &&
      (broadScanRuntimeActive ||
        flowCoverage.isFetching ||
        flowCoverage.isRotating ||
        (Array.isArray(flowCoverage.currentBatch) && flowCoverage.currentBatch.length > 0) ||
        Number(flowCoverage.cycleScannedSymbols || flowCoverage.scannedSymbols || 0) > 0 ||
        Number(
          flowCoverage.activeTargetSize ||
            flowCoverage.totalSymbols ||
            flowCoverage.targetSize ||
            flowCoverage.selectedSymbols ||
            0,
        ) > 0),
  );
  const flowScanStale = Boolean(
    broadScanEnabled && !broadScanRuntimeActive && broadScanSnapshotHasEvents,
  );
  const flowScanPaused = Boolean(
    broadScanEnabled &&
      !broadScanRuntimeActive &&
      !broadScanSnapshotVisible,
  );
  const flowScanHasError = Boolean(
    broadScanOwnerActive && flowHasError,
  );
  const flowScanDegraded = Boolean(
    broadScanRuntimeActive && !flowScanHasError && flowDegraded,
  );
  const flowScanBusy = Boolean(
    broadScanRuntimeActive &&
      !flowScanHasError &&
      !flowScanDegraded &&
      !flowSessionQuiet &&
      (flowStatus === "loading" ||
        flowProviderSummary?.coverage?.isFetching),
  );
  const unusualEmptyLabel =
    flowScanHasError || flowHasError
      ? "FLOW OFFLINE"
      : flowScanDegraded || flowDegraded
        ? "FLOW DEGRADED"
        : flowScanPaused
          ? "FLOW IDLE"
          : flowStatus === "loading"
            ? "SYNCING"
            : flowScanCoverageActive
              ? "FLOW SCANNING"
              : flowEventsFilteredOut
                ? "FLOW FILTERED"
                : flowSessionQuietWithRetainedEvents
                  ? "LAST FLOW"
                  : flowSessionQuiet
                    ? "NO FLOW"
                    : unusualEvents.length
                      ? "NO UNUSUAL FLOW"
                      : "NO FLOW";

  // Status color semantics: green=active, accent=updating, amber=degraded, red=error.
  const flowScanTone = flowScanHasError
    ? CSS_COLOR.red
    : flowScanDegraded
      ? CSS_COLOR.amber
    : flowScanBusy
      ? CSS_COLOR.accent
    : flowSessionQuietWithRetainedEvents
      ? CSS_COLOR.amber
    : flowScanStale
      ? CSS_COLOR.amber
      : flowScanPaused
        ? CSS_COLOR.textMuted
      : broadScanRuntimeActive
        ? CSS_COLOR.green
        : broadScanEnabled
          ? CSS_COLOR.textMuted
          : CSS_COLOR.textMuted;
  const flowScanStatusLabel = flowScanHasError
    ? "SCAN ERROR"
    : flowScanDegraded
      ? "DEGRADED"
    : flowScanBusy
      ? "SCANNING"
    : flowSessionQuietWithRetainedEvents
      ? "LAST FLOW"
    : flowSessionQuiet
      ? "QUIET"
    : flowScanStale
      ? "STALE"
      : flowScanPaused
        ? "IDLE"
      : broadScanRuntimeActive
        ? "SCAN ON"
        : broadScanEnabled
          ? "SCAN IDLE"
        : "SCAN OFF";
  const signalScanTone = signalHasError
    ? CSS_COLOR.red
    : signalRateLimited
      ? requestHealthTone(classifyRequestHealth({ rateLimited: true }))
    : signalStreamUncertain
      ? requestHealthTone(classifyRequestHealth({ degraded: true }))
    : signalNoTrackedSymbols || signalNoFreshSignals
      ? CSS_COLOR.amber
    : signalBusy
      ? CSS_COLOR.accent
      : signalScanEnabled
        ? CSS_COLOR.green
        : CSS_COLOR.textMuted;
  const signalWaveStatus = !onToggleSignalScan || signalHasError
    ? "offline"
    : signalRateLimited ||
        signalStreamUncertain ||
        signalNoTrackedSymbols ||
        signalNoFreshSignals
      ? "stale"
    : signalBusy
      ? "checking"
    : signalScanEnabled
      ? "healthy"
      : "no-subscribers";
  const signalStatusLabel = signalHasError
    ? "STREAM ERROR"
    : signalRateLimited
      ? `${requestHealthLabel("rateLimited")} — RETRYING`
    : signalStreamUncertain
      ? "STREAM UNCERTAIN"
    : signalNoTrackedSymbols
      ? "NO DATA"
    : signalNoFreshSignals
      ? "NO FRESH"
    : signalScanPending
      ? "UPDATING"
      : signalEvaluationPending || signalSnapshot?.pending
        ? "SYNCING"
        : signalScanEnabled
        ? "LIVE"
        : "OFF";
  const flowWaveStatus = flowScanHasError
    ? "offline"
    : flowScanDegraded || flowSessionQuietWithRetainedEvents || flowScanStale
      ? "stale"
    : flowScanBusy
      ? "checking"
    : flowSessionQuiet
      ? "market-closed"
    : broadScanRuntimeActive
      ? "healthy"
      : "no-subscribers";
  const signalUniverseLabel =
    signalStatusSnapshot.universeMode === "high_beta_500"
      ? "High Beta 500"
      : signalStatusSnapshot.universeMode === "all_watchlists_plus_universe"
      ? "Watchlist Sources + Candidate Set"
      : signalStatusSnapshot.universeMode === "all_watchlists"
        ? "All Watchlist Sources"
        : signalStatusSnapshot.universeMode === "selected_watchlist"
          ? "Selected Watchlist Source"
          : MISSING_VALUE;
  const signalProfileTimeframe =
    signalDraft.timeframe ?? (signalSnapshot?.profile?.timeframe || "5m");
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
      </HeaderLanePopoverSection>
      <HeaderLanePopoverSection
        title="Status"
        testId="header-signal-status-section"
      >
        <HeaderLaneInfoRow label="Visible" value={signalItems.length} />
        <HeaderLaneInfoRow
          label="Tracked"
          value={signalStateSummary.total || MISSING_VALUE}
          tone={
            signalNoTrackedSymbols || signalNoFreshSignals
              ? CSS_COLOR.amber
              : CSS_COLOR.textSec
          }
        />
        <HeaderLaneInfoRow
          label="Signal Source"
          value={signalUniverseLabel}
          tone={signalStatusSnapshot.universeFallbackUsed ? CSS_COLOR.amber : CSS_COLOR.textSec}
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
  const unusualCurrentBatch = flowSessionQuiet
    ? []
    : unusualCoverage?.currentBatch || [];
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
    : unusualEvents.length > unusualItems.length
      ? `${unusualItems.length}/${unusualEvents.length}`
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
            {broadScanEnabled ? (broadScanRuntimeActive ? "On" : "Idle") : "Off"}
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
          tone={flowEventsFilteredOut ? CSS_COLOR.amber : CSS_COLOR.textSec}
        />
        <HeaderLaneInfoRow
          label="Coverage"
          value={unusualCoverageLabel}
          tone={unusualScannedCount > 0 ? CSS_COLOR.textSec : CSS_COLOR.amber}
        />
        <HeaderLaneInfoRow
          label="Scanning"
          value={unusualScanningNow}
          tone={unusualCurrentBatch.length ? CSS_COLOR.accent : CSS_COLOR.textDim}
        />
        <HeaderLaneInfoRow
          label="Cycle"
          value={unusualLineDetail}
          tone={flowScanTone}
        />
        <HeaderLaneInfoRow
          label="Flow"
          value={flowStatus.toUpperCase()}
          tone={
            flowHasError
              ? CSS_COLOR.red
              : flowDegraded
                ? CSS_COLOR.amber
                : flowStatus === "loading"
                  ? CSS_COLOR.accent
                  : CSS_COLOR.textSec
          }
        />
      </HeaderLanePopoverSection>
    </HeaderLaneSettingsPopover>
  );

  const signalTriggerActive = openSettingsLane === "signals";
  const unusualTriggerActive = openSettingsLane === "unusual";
  const algoLaneTone = algoItems.length ? CSS_COLOR.accent : CSS_COLOR.textMuted;
  const algoWaveStatus = !enabled ? "checking" : onAlgoAction ? "healthy" : "no-subscribers";
  const algoEmptyLabel = enabled ? "NO ALGO EVENTS" : "ALGO SYNCING";
  const buildLaneTriggerButton = ({ testId, ariaLabel, active, accentTone, content }) => (
    <button
      type="button"
      data-testid={testId}
      aria-label={ariaLabel}
      style={{
        width: "100%",
        height: "100%",
        minHeight: isPhone ? dim(44) : 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: sp("0px 8px"),
        border: "none",
        background: active ? `${cssColorMix(accentTone, 8)}` : "transparent",
        color: active ? accentTone : CSS_COLOR.textDim,
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
      className={isPhone ? "ra-mobile-broadcast-stack" : "ra-hairline-bottom"}
      style={{
        flexShrink: 0,
        display: "grid",
        gridTemplateRows: "auto auto auto",
        gap: isPhone ? sp(3) : 0,
        minWidth: 0,
        padding: isPhone ? "0 7px 5px" : undefined,
        background: isPhone ? CSS_COLOR.bg1 : CSS_COLOR.bg0,
        boxShadow: isPhone ? `0 1px 0 ${CSS_COLOR.border}` : undefined,
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
          speedPreset={speedPreset}
          compactSettings={isPhone}
          labelTrigger={
            <PopoverTrigger asChild>
              {buildLaneTriggerButton({
                testId: "header-signal-tape-settings-trigger",
                ariaLabel: "SIGNALS settings",
                active: signalTriggerActive,
                accentTone: CSS_COLOR.accent,
                content: isPhone ? <Settings size={14} strokeWidth={2} /> : "SIGNALS",
              })}
            </PopoverTrigger>
          }
          statusGlyph={
            <HeaderLaneWaveIcon
              status={signalWaveStatus}
              dataTestId="header-signal-scan-wave"
            />
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
          speedPreset={speedPreset}
          compactSettings={isPhone}
          labelTrigger={
            <PopoverTrigger asChild>
              {buildLaneTriggerButton({
                testId: "header-unusual-tape-settings-trigger",
                ariaLabel: "FLOW settings",
                active: unusualTriggerActive,
                accentTone: CSS_COLOR.accent,
                content: isPhone ? <Settings size={14} strokeWidth={2} /> : "FLOW",
              })}
            </PopoverTrigger>
          }
          statusGlyph={
            <HeaderLaneWaveIcon
              status={flowWaveStatus}
              dataTestId="header-unusual-broad-wave"
            />
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

      <HeaderBroadcastLane
        label="ALGO"
        items={algoItems}
        emptyLabel={algoEmptyLabel}
        emptyTone={algoLaneTone}
        testId="header-algo-tape"
        speedPreset={speedPreset}
        compactSettings={isPhone}
        labelTrigger={
          <button
            type="button"
            data-testid="header-algo-tape-trigger"
            aria-label="Open ALGO"
            onClick={() => onAlgoAction?.()}
            style={{
              width: "100%",
              height: "100%",
              minHeight: 0,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: sp("0px 8px"),
              border: "none",
              background: "transparent",
              color: CSS_COLOR.textDim,
              cursor: onAlgoAction ? "pointer" : "default",
              fontFamily: T.sans,
              fontSize: textSize("caption"),
              fontWeight: FONT_WEIGHTS.regular,
              whiteSpace: "nowrap",
            }}
          >
            <Bot size={14} strokeWidth={2} />
          </button>
        }
        statusGlyph={
          <HeaderLaneWaveIcon
            status={algoWaveStatus}
            dataTestId="header-algo-wave"
          />
        }
      >
        {(item, duplicate, compact) => (
          <HeaderAlgoTapeItem
            item={item}
            duplicate={duplicate}
            compact={compact}
            onClick={onAlgoAction}
          />
        )}
      </HeaderBroadcastLane>

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
