import {
  ChevronDown,
  GripVertical,
  ListChecks,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  Suspense,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { BottomSheet } from "../../components/platform/BottomSheet.jsx";
import { SignalDots } from "../../components/platform/signal-language";
import {
  MicroSparkline,
  extractSparklinePoints,
} from "../../components/platform/primitives.jsx";
import { CSS_COLOR, cssColorMix, dim, ELEVATION, FONT_WEIGHTS, fs, MISSING_VALUE, RADII, sp, T, textSize } from "../../lib/uiTokens.jsx";
import {
  formatQuotePrice,
  formatSignedPercent,
  isFiniteNumber,
} from "../../lib/formatters";
import {
  joinMotionClasses,
  motionRowStyle,
  motionVars,
  useValueFlash,
} from "../../lib/motion.jsx";
import { useDebouncedTextCommit } from "../../lib/useDebouncedTextCommit";
import { INDICES, MACRO_TICKERS, WATCHLIST } from "../market/marketReferenceData";
import {
  SIGNALS_ROW_STATUS,
} from "../signals/signalsRowModel.js";
import {
  EMPTY_SIGNAL_EVENTS,
  buildSignalEventsBySymbol,
  buildSignalSparklinePointColors,
  defaultSignalSparklineColorForDirection,
  isSignalSparklineDirection,
  resolveSignalSparklineFallbackColor,
} from "../signals/signalSparklineModel.js";
import { buildFallbackWatchlistItem } from "./runtimeMarketDataModel";
import { resolveExtendedHoursQuoteDisplay } from "./extendedHoursQuote";
import { useRuntimeTickerSnapshot, useRuntimeTickerSnapshots } from "./runtimeTickerStore";
import { useAlgoStaExecutionTimeframe } from "./algoStaExecutionTimeframeStore";
import { MarketIdentityMark } from "./marketIdentity";
import {
  TABLE_SPARKLINE_COMPACT_HEIGHT,
  TABLE_SPARKLINE_COMPACT_WIDTH,
  TABLE_SPARKLINE_HEIGHT,
  TABLE_SPARKLINE_WIDTH,
} from "./sparklineConfig";
import {
  WATCHLIST_SORT_MODE,
  buildSignalMatrixBySymbol,
  buildWatchlistRows,
  countWatchlistSymbols,
  getBestWatchlistSignalState,
  sortWatchlistRows,
} from "./watchlistModel";
import { AppTooltip } from "@/components/ui/tooltip";
import {
  LazyWatchlistTickerSearch,
  preloadWatchlistTickerSearch,
} from "./tickerSearch/chartTickerSearchLoader.js";

const WatchlistTickerSearchFallback = () => (
  <div
    data-testid="watchlist-ticker-search-loading"
    aria-live="polite"
    style={{
      minHeight: dim(220),
      display: "grid",
      gap: sp(8),
      padding: sp(12),
      background: CSS_COLOR.bg1,
      border: `1px solid ${CSS_COLOR.border}`,
      borderRadius: dim(RADII.sm),
    }}
  >
    <div
      style={{
        color: CSS_COLOR.textMuted,
        fontFamily: T.sans,
        fontSize: textSize("caption"),
        letterSpacing: "0.04em",
        textTransform: "uppercase",
      }}
    >
      Loading search
    </div>
    {[0, 1, 2].map((index) => (
      <div
        key={index}
        className="ra-skeleton-shimmer"
        style={{
          height: dim(34),
          width: `${92 - index * 8}%`,
          borderRadius: dim(RADII.xs),
        }}
      />
    ))}
  </div>
);

const formatSignedQuoteMove = (value) =>
  isFiniteNumber(value)
    ? `${value >= 0 ? "+" : "-"}${formatQuotePrice(Math.abs(value))}`
    : MISSING_VALUE;

// MicroSparkline + extractSparklineValues are exported from
// components/platform/primitives.jsx — imported above.

const WatchlistFilterInput = memo(({ value, onCommit }) => {
  const { inputProps } = useDebouncedTextCommit({
    value,
    onCommit,
  });

  return (
    <input
      {...inputProps}
      placeholder="Filter..."
      style={{
        flex: 1,
        minWidth: 0,
        background: "transparent",
        border: "none",
        outline: "none",
        fontSize: textSize("paragraphMuted"),
        fontFamily: T.sans,
        color: CSS_COLOR.text,
      }}
    />
  );
});

WatchlistFilterInput.displayName = "WatchlistFilterInput";

export const resolveWatchlistSparklineData = (snapshot, fallback) => {
  if (extractSparklinePoints(snapshot?.sparkBars).length >= 2) {
    return {
      data: snapshot.sparkBars,
      source: "snapshot-spark-bars",
    };
  }
  if (extractSparklinePoints(snapshot?.spark).length >= 2) {
    return {
      data: snapshot.spark,
      source: "snapshot-spark",
    };
  }
  if (extractSparklinePoints(fallback?.sparkBars).length >= 2) {
    return {
      data: fallback.sparkBars,
      source: "fallback-spark-bars",
    };
  }
  if (extractSparklinePoints(fallback?.spark).length >= 2) {
    return {
      data: fallback.spark,
      source: "fallback-spark",
    };
  }
  return {
    data: [],
    source: "empty",
  };
};
const WATCHLIST_SORT_OPTIONS = [
  { id: WATCHLIST_SORT_MODE.MANUAL, label: "Manual" },
  { id: WATCHLIST_SORT_MODE.SIGNAL, label: "Signal" },
  { id: WATCHLIST_SORT_MODE.PERCENT, label: "% Chg" },
  { id: WATCHLIST_SORT_MODE.ALPHA, label: "A-Z" },
];

const WATCHLIST_DIRECTION_SORTS = new Set([
  WATCHLIST_SORT_MODE.PERCENT,
  WATCHLIST_SORT_MODE.ALPHA,
]);

// Sort modes whose ROW ORDER depends on live quote snapshots (watchlistModel sorts
// on .pct / .volume). Only in these does the parent watchlist need to subscribe to
// every symbol's quote stream. In MANUAL/SIGNAL/ALPHA the order is fixed regardless of
// price, so subscribing the whole list here would re-render the entire watchlist on
// every ~100ms quote-tick flush for nothing — starving the main-thread SMIL status wave
// (the diagnostic canary). Individual rows keep their own per-symbol subscription, so
// prices still update live in every mode; only the wasteful parent-level subscription
// is gated.
const WATCHLIST_SNAPSHOT_SORTS = new Set([
  WATCHLIST_SORT_MODE.PERCENT,
  WATCHLIST_SORT_MODE.VOLUME,
]);
// Stable empty-symbols reference so the gated-off subscription keeps a constant input
// (a fresh [] each render would churn useRuntimeTickerSnapshots' internal memo).
const EMPTY_WATCHLIST_SYMBOLS = [];

// Hoisted so the row sparkline's fill style is a stable reference — an inline object
// literal here defeats MicroSparkline's memo and rebuilds its SVG on every row render.
const SPARKLINE_FILL_STYLE = { width: "100%", height: "100%" };

const isWatchlistSignalDirection = isSignalSparklineDirection;

const SIGNALS_PAGE_ACTIVE_STATUSES = new Set([
  SIGNALS_ROW_STATUS.activeFresh,
  SIGNALS_ROW_STATUS.activeStale,
]);

const signalColorForDirection = defaultSignalSparklineColorForDirection;

const WatchlistRow = memo(
  ({
    item,
    itemIndex,
    selected,
    canDrag,
    dragging,
    dragOver,
    onDragStart,
    onDragOver,
    onDrop,
    onDragEnd,
    onSelect,
    onAddSymbol,
    onToggleSelection,
    onSignalAction,
    signalStatesByTimeframe = {},
    signalEvents = EMPTY_SIGNAL_EVENTS,
    executionTimeframe = null,
    busy = false,
    density = "default",
    selectionMode = false,
    selectedForRemoval = false,
    reserveAddColumn = false,
  }) => {
    const fallback = useMemo(
      () =>
        buildFallbackWatchlistItem(item.sym, itemIndex, item.name || item.sym),
      [item.name, item.sym, itemIndex],
    );
    const snapshot = useRuntimeTickerSnapshot(item.sym, fallback);
    const bestSignalState = getBestWatchlistSignalState(signalStatesByTimeframe);
    const rowSelectable = Boolean(item.canRemove && item.id);
    const selectedRow = selected === item.sym;
    const signalDirection = bestSignalState?.currentSignalDirection;
    const hasSignal =
      isWatchlistSignalDirection(signalDirection) &&
      bestSignalState?.status !== "error" &&
      bestSignalState?.status !== "unavailable";
    const signalColor = signalDirection === "buy" ? CSS_COLOR.blue : CSS_COLOR.red;
    // Sparkline color follows the traded (execution) signal so the watchlist
    // matches the STA table. Use the execution-timeframe state for the latched
    // single-color fallback; without an execution timeframe, keep the legacy
    // "freshest signal across timeframes" behavior.
    const sparklineSignalState = executionTimeframe
      ? signalStatesByTimeframe?.[executionTimeframe] || null
      : bestSignalState;
    const sparklineRow = useMemo(() => {
      const currentDirection = sparklineSignalState?.currentSignalDirection;
      if (
        !isWatchlistSignalDirection(currentDirection) ||
        sparklineSignalState?.status === "error" ||
        sparklineSignalState?.status === "unavailable"
      ) {
        return null;
      }
      return {
        direction: currentDirection,
        currentSignalAt: sparklineSignalState?.currentSignalAt || null,
        profileTimeframe: sparklineSignalState?.timeframe || "",
        status: sparklineSignalState?.fresh
          ? SIGNALS_ROW_STATUS.activeFresh
          : SIGNALS_ROW_STATUS.activeStale,
      };
    }, [
      sparklineSignalState?.currentSignalAt,
      sparklineSignalState?.currentSignalDirection,
      sparklineSignalState?.fresh,
      sparklineSignalState?.status,
      sparklineSignalState?.timeframe,
    ]);
    const sparklineSignalDirection = sparklineRow?.direction;
    const sparklineSignalColor =
      SIGNALS_PAGE_ACTIVE_STATUSES.has(sparklineRow?.status) &&
      isWatchlistSignalDirection(sparklineSignalDirection)
        ? signalColorForDirection(sparklineSignalDirection)
        : null;
    const signalFresh = Boolean(bestSignalState?.fresh);
    const pctPositive = isFiniteNumber(snapshot?.pct) ? snapshot.pct >= 0 : null;
    const extendedHoursDisplay = resolveExtendedHoursQuoteDisplay({
      quote: snapshot,
      now: Date.now(),
    });
    // Visible extended-hours line (pre/after-market): a third line under the price
    // showing session label + extended-hours price + move, tone-colored and dimmed
    // when delayed/stale. (Restores the styling 5b68e05 had moved to hover-only.)
    const extendedHoursPositive =
      extendedHoursDisplay?.tone === "positive"
        ? true
        : extendedHoursDisplay?.tone === "negative"
          ? false
          : null;
    const priceValue = isFiniteNumber(snapshot?.price) ? snapshot.price : null;
    const quotePriceForFlash = isFiniteNumber(snapshot?.price)
      ? snapshot.price
      : null;
    const priceFlashClassName = useValueFlash(quotePriceForFlash);
    const displayedPrice = priceValue;
    const displayName = item.name || snapshot?.name || fallback.name || item.sym;
    const identityItem = {
      ticker: item.sym,
      name: displayName,
      market: item.market,
      countryCode: item.countryCode,
      exchangeCountryCode: item.exchangeCountryCode,
      sector: item.sector,
      industry: item.industry,
      logoUrl: item.logoUrl,
    };
    const addActionDisabled = busy;
    const rowBackground = dragging
      ? `${cssColorMix(CSS_COLOR.accent, 6)}`
      : dragOver
        ? `${cssColorMix(CSS_COLOR.accent, 9)}`
        : selectedForRemoval
          ? `${cssColorMix(CSS_COLOR.accent, 9)}`
          : "transparent";
    const mobileDense = density === "mobile-dense";
    const sparklineResolved = resolveWatchlistSparklineData(snapshot, fallback);
    const sparklineData = sparklineResolved.data;
    const sparklinePoints = useMemo(
      () => extractSparklinePoints(sparklineData),
      [sparklineData],
    );
    const sparklinePointTimestampCount = sparklinePoints.filter(
      (point) => point.ms != null,
    ).length;
    const sparklinePointColors = useMemo(
      () =>
        buildSignalSparklinePointColors({
          points: sparklinePoints,
          row: sparklineRow,
          signalEvents,
          colorTimeframe: executionTimeframe,
        }),
      [executionTimeframe, signalEvents, sparklineRow, sparklinePoints],
    );
    const sparklineUsesSignalTimeline = Array.isArray(sparklinePointColors);
    // Per-row signal hydration: the signal engine has demonstrably evaluated
    // THIS symbol (an event, or a matrix state carrying evaluation timing).
    // App-level evidence isn't enough — during boot the matrix streams in
    // symbol by symbol, and a row must not flash MicroSparkline's financial
    // green/red default (the launch "old green style") while its own signal
    // state is still unknown.
    const rowSignalStateHydrated =
      signalEvents.length > 0 ||
      Object.values(signalStatesByTimeframe || {}).some((state) =>
        Boolean(
          state &&
            (state.latestBarAt || state.currentSignalAt || state.lastEvaluatedAt),
        ),
      );
    const sparklineColor = sparklineUsesSignalTimeline
      ? null
      : resolveSignalSparklineFallbackColor({
          signalColor: sparklineSignalColor,
          signalStateHydrated: rowSignalStateHydrated,
        });
    const sparklineSignalMode = sparklineUsesSignalTimeline
      ? "timeline"
      : sparklineSignalColor
        ? "current"
        : rowSignalStateHydrated
          ? "price"
          : "pending";
    const handleRowClick = () => {
      if (selectionMode) {
        if (rowSelectable) {
          onToggleSelection?.(item.id);
        }
        return;
      }
      onSelect?.(item.sym);
    };
    const renderSelectionControl = () => (
      <button
        type="button"
        role="checkbox"
        data-testid="watchlist-row-select"
        aria-checked={selectedForRemoval ? "true" : "false"}
        aria-label={
          rowSelectable
            ? `${selectedForRemoval ? "Deselect" : "Select"} ${item.sym}`
            : `${item.sym} cannot be selected for removal`
        }
        disabled={!rowSelectable || busy}
        onClick={(event) => {
          event.stopPropagation();
          if (rowSelectable) {
            onToggleSelection?.(item.id);
          }
        }}
        style={{
          width: dim(18),
          height: dim(18),
          display: "grid",
          placeItems: "center",
          borderRadius: dim(RADII.xs),
          border: `1px solid ${
            selectedForRemoval ? CSS_COLOR.accent : rowSelectable ? CSS_COLOR.border : CSS_COLOR.borderLight
          }`,
          background: selectedForRemoval ? CSS_COLOR.accent : "transparent",
          color: selectedForRemoval ? CSS_COLOR.onAccent : CSS_COLOR.textMuted,
          cursor: rowSelectable && !busy ? "pointer" : "default",
          padding: 0,
          flexShrink: 0,
          opacity: rowSelectable ? 1 : 0.42,
          fontFamily: T.sans,
          fontSize: fs(11),
          fontWeight: FONT_WEIGHTS.medium,
          lineHeight: 1,
        }}
      >
        {selectedForRemoval ? (
          <span
            aria-hidden="true"
            style={{
              width: dim(7),
              height: dim(4),
              borderLeft: `1.5px solid ${CSS_COLOR.onAccent}`,
              borderBottom: `1.5px solid ${CSS_COLOR.onAccent}`,
              transform: "rotate(-45deg)",
              marginTop: dim(-1),
            }}
          />
        ) : null}
      </button>
    );
    const renderDayChange = (style = null) => (
      <span
        data-testid="watchlist-day-change"
        style={{
          color:
            pctPositive == null ? CSS_COLOR.textMuted : pctPositive ? CSS_COLOR.green : CSS_COLOR.red,
          fontFamily: T.sans,
          fontSize: textSize("body"),
          fontVariantNumeric: "tabular-nums",
          fontWeight: FONT_WEIGHTS.medium,
          lineHeight: 1,
          whiteSpace: "nowrap",
          ...style,
        }}
      >
        {formatSignedPercent(snapshot?.pct)}
      </span>
    );
    const renderExtendedHoursBadge = () =>
      extendedHoursDisplay ? (
        <span
          data-testid="watchlist-extended-hours"
          title={`${extendedHoursDisplay.sessionLabel} move from regular close`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: sp(4),
            maxWidth: "100%",
            color:
              extendedHoursPositive == null
                ? CSS_COLOR.textMuted
                : extendedHoursPositive
                  ? CSS_COLOR.green
                  : CSS_COLOR.red,
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            fontVariantNumeric: "tabular-nums",
            fontWeight: FONT_WEIGHTS.medium,
            lineHeight: 1,
            opacity:
              extendedHoursDisplay.delayed ||
              extendedHoursDisplay.freshness === "stale"
                ? 0.72
                : 1,
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ color: CSS_COLOR.textMuted }}>
            {extendedHoursDisplay.sessionLabel}
          </span>
          <span>{formatQuotePrice(extendedHoursDisplay.price)}</span>
          <span>
            {formatSignedQuoteMove(extendedHoursDisplay.change)} (
            {formatSignedPercent(extendedHoursDisplay.changePercent)})
          </span>
        </span>
      ) : null;
    const renderSignalPill = () =>
      hasSignal ? (
        <AppTooltip
          content={`${signalDirection.toUpperCase()} ${signalFresh ? "fresh" : "stale"} signal - ${bestSignalState?.timeframe || "monitor"} - ${bestSignalState?.barsSinceSignal ?? MISSING_VALUE} bars`}
        >
          <button
            type="button"
            data-testid="watchlist-signal-pill"
            data-fresh={signalFresh ? "true" : "false"}
            className={signalFresh ? "ra-status-pulse" : "ra-interactive"}
            onClick={(event) => {
              event.stopPropagation();
              onSignalAction?.(item.sym, bestSignalState);
            }}
            style={{
              border: `1px solid ${signalFresh ? signalColor : `${cssColorMix(signalColor, 53)}`}`,
              background: signalFresh ? `${cssColorMix(signalColor, 14)}` : `${cssColorMix(signalColor, 8)}`,
              color: signalFresh ? signalColor : `${cssColorMix(signalColor, 82)}`,
              cursor: "pointer",
              fontFamily: T.sans,
              fontSize: fs(7),
              fontWeight: FONT_WEIGHTS.medium,
              letterSpacing: 0,
              lineHeight: 1,
              padding: sp("2px 5px"),
              borderRadius: dim(RADII.pill),
              boxShadow: signalFresh ? `0 0 0 2px ${cssColorMix(signalColor, 13)}` : "none",
              whiteSpace: "nowrap",
            }}
          >
            {signalDirection.toUpperCase()}
          </button>
        </AppTooltip>
      ) : null;
    const renderSignalCluster = (style = null) => (
      <span
        data-testid="watchlist-signal-cluster"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: sp(4),
          minWidth: 0,
          ...style,
        }}
      >
        <SignalDots
          statesByTimeframe={signalStatesByTimeframe}
          onSelect={(state) => onSignalAction?.(item.sym, state)}
          style={{ minWidth: dim(52), gap: sp(3) }}
        />
        {renderSignalPill()}
      </span>
    );

    if (mobileDense) {
      return (
        <div
          data-testid="watchlist-row"
          data-symbol={item.sym}
          data-source={item.source}
          className={joinMotionClasses(
            "ra-row-enter",
            "ra-interactive",
            selectedRow && "ra-focus-rail",
          )}
          onClick={handleRowClick}
          style={{
            ...motionRowStyle(itemIndex, 7, 140),
            ...motionVars({
              // Match the desktop row: accent follows P&L (green/red); buy/sell
              // direction stays on the signal pill/dots per DESIGN.md.
              accent: selectedRow
                ? CSS_COLOR.accent
                : pctPositive == null
                  ? CSS_COLOR.accent
                  : pctPositive
                    ? CSS_COLOR.green
                    : CSS_COLOR.red,
            }),
            width: "100%",
            height: 44,
            minHeight: 44,
            display: "flex",
            flexDirection: "column",
            gap: 2,
            padding: "4px 8px",
            border: "none",
            background:
              selectedRow || dragOver ? `${cssColorMix(CSS_COLOR.accent, 7)}` : rowBackground,
            color: CSS_COLOR.text,
            cursor: selectionMode ? (rowSelectable ? "pointer" : "default") : "pointer",
            textAlign: "left",
            fontFamily: T.sans,
            opacity: dragging ? 0.55 : 1,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              minWidth: 0,
              lineHeight: 1,
            }}
          >
            {selectionMode ? renderSelectionControl() : null}
            <MarketIdentityMark item={identityItem} size={18} showCountryBadge={false} />
            <span
              data-testid="watchlist-row-symbol"
              className={priceFlashClassName}
              style={{
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                color: CSS_COLOR.text,
                fontFamily: T.sans,
                fontSize: textSize("body"),
                fontWeight: FONT_WEIGHTS.medium,
                lineHeight: 1,
              }}
            >
              {item.sym}
            </span>
            {renderDayChange()}
            {renderSignalCluster({ marginLeft: "auto", flexShrink: 0 })}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              minWidth: 0,
              lineHeight: 1,
            }}
          >
            <span
              data-testid="watchlist-mobile-sparkline"
              data-sparkline-signal-mode={sparklineSignalMode}
              data-sparkline-signal-events={signalEvents.length}
              data-sparkline-signal-direction={sparklineSignalDirection || undefined}
              data-sparkline-source={sparklineResolved.source}
              data-sparkline-points={sparklinePoints.length}
              data-sparkline-point-timestamps={sparklinePointTimestampCount}
              style={{
                width: dim(TABLE_SPARKLINE_COMPACT_WIDTH),
                height: dim(TABLE_SPARKLINE_COMPACT_HEIGHT),
                minWidth: dim(TABLE_SPARKLINE_COMPACT_WIDTH),
                marginLeft: "auto",
                overflow: "hidden",
                flexShrink: 0,
              }}
            >
              <MicroSparkline
                data={sparklineData}
                positive={pctPositive}
                color={sparklineColor}
                pointColors={sparklinePointColors}
                width={TABLE_SPARKLINE_COMPACT_WIDTH}
                height={TABLE_SPARKLINE_COMPACT_HEIGHT}
                style={SPARKLINE_FILL_STYLE}
              />
            </span>
            <span
              className={priceFlashClassName}
              style={{
                color: CSS_COLOR.text,
                fontFamily: T.sans,
                fontSize: textSize("body"),
                fontVariantNumeric: "tabular-nums",
                fontWeight: FONT_WEIGHTS.medium,
                lineHeight: 1,
                whiteSpace: "nowrap",
              }}
            >
              {formatQuotePrice(displayedPrice)}
            </span>
          </div>
        </div>
      );
    }

    return (
      <div
        data-testid="watchlist-row"
        data-symbol={item.sym}
        data-source={item.source}
        className={joinMotionClasses(
          "ra-row-enter",
          "ra-interactive",
          selectedRow && "ra-focus-rail",
        )}
        draggable={canDrag}
        aria-grabbed={dragging ? "true" : "false"}
        onDragStart={(event) => {
          if (!canDrag || !item.id) return;
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", item.id);
          onDragStart?.(item.id);
        }}
        onDragOver={(event) => {
          if (!canDrag || !item.id) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          onDragOver?.(item.id);
        }}
        onDrop={(event) => {
          if (!canDrag || !item.id) return;
          event.preventDefault();
          onDrop?.(item.id);
        }}
        onDragEnd={onDragEnd}
        onClick={handleRowClick}
        style={{
          ...motionRowStyle(itemIndex, 7, 140),
          ...motionVars({
            // Row hover/focus accent follows financial outcome (green/red) per
            // DESIGN.md. Directional buy/sell (blue/red) stays on the signal
            // pill and dots so the two color languages never collide on one
            // element or read differently from one row to the next.
            accent: selectedRow
              ? CSS_COLOR.accent
              : pctPositive == null
                ? CSS_COLOR.accent
                : pctPositive
                  ? CSS_COLOR.green
                  : CSS_COLOR.red,
          }),
          display: "grid",
          gridTemplateColumns: [
            selectionMode ? `${dim(20)}px` : null,
            "minmax(0,1fr)",
            reserveAddColumn ? `${dim(26)}px` : null,
          ].filter(Boolean).join(" "),
          gap: sp(4),
          padding: sp("9px 6px"),
          cursor: selectionMode ? (rowSelectable ? "pointer" : "default") : "pointer",
          alignItems: "center",
          background:
            selectedRow || dragOver ? `${cssColorMix(CSS_COLOR.accent, 7)}` : rowBackground,
          opacity: dragging ? 0.55 : 1,
        }}
      >
        {selectionMode ? renderSelectionControl() : null}
        <div style={{ minWidth: 0, overflow: "hidden" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "16px 18px minmax(0,1fr) auto",
              alignItems: "center",
              gap: sp(3),
              minWidth: 0,
            }}
          >
            <GripVertical
              size={14}
              strokeWidth={2}
              style={{
                color: canDrag ? CSS_COLOR.textSec : CSS_COLOR.textMuted,
                opacity: canDrag ? 1 : 0.35,
                cursor: canDrag ? "grab" : "default",
              }}
            />
            <MarketIdentityMark item={identityItem} size={18} showCountryBadge={false} />
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: sp(3),
                gridColumn: "3 / 4",
                minWidth: 0,
                overflow: "hidden",
              }}
            >
              <span
                data-testid="watchlist-row-symbol"
                className={priceFlashClassName}
                style={{
                  minWidth: 0,
                  flex: "0 0 auto",
                  fontSize: textSize("paragraph"),
                  fontWeight: FONT_WEIGHTS.medium,
                  fontFamily: T.sans,
                  color: CSS_COLOR.text,
                  letterSpacing: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  padding: sp("1px 3px"),
                  borderRadius: dim(RADII.xs),
                }}
              >
                {item.sym}
              </span>
            </span>
            {renderSignalCluster({ justifySelf: "end" })}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "max-content auto",
              alignItems: "center",
              justifyContent: "end",
              gap: sp(4),
              marginTop: sp(6),
              minWidth: 0,
            }}
          >
            <span
              data-testid="watchlist-row-sparkline"
              data-sparkline-signal-mode={sparklineSignalMode}
              data-sparkline-signal-events={signalEvents.length}
              data-sparkline-signal-direction={sparklineSignalDirection || undefined}
              data-sparkline-source={sparklineResolved.source}
              data-sparkline-points={sparklinePoints.length}
              data-sparkline-point-timestamps={sparklinePointTimestampCount}
              style={{
                width: dim(TABLE_SPARKLINE_WIDTH),
                minWidth: dim(TABLE_SPARKLINE_WIDTH),
                height: dim(TABLE_SPARKLINE_HEIGHT),
                overflow: "hidden",
              }}
            >
              <MicroSparkline
                data={sparklineData}
                positive={pctPositive}
                color={sparklineColor}
                pointColors={sparklinePointColors}
                width={TABLE_SPARKLINE_WIDTH}
                height={TABLE_SPARKLINE_HEIGHT}
                style={SPARKLINE_FILL_STYLE}
              />
            </span>
            <span
              style={{
                alignItems: "flex-end",
                display: "inline-flex",
                flexDirection: "column",
                gap: sp(3),
                justifyContent: "center",
                justifySelf: "end",
                minWidth: 0,
              }}
            >
              <span
                data-testid="watchlist-row-price"
                className={priceFlashClassName}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  color: CSS_COLOR.text,
                  fontFamily: T.sans,
                  fontSize: textSize("paragraphMuted"),
                  fontVariantNumeric: "tabular-nums",
                  fontWeight: FONT_WEIGHTS.medium,
                  textAlign: "right",
                  padding: sp("1px 2px"),
                  borderRadius: dim(RADII.xs),
                  whiteSpace: "nowrap",
                }}
              >
                {formatQuotePrice(displayedPrice)}
              </span>
              {renderDayChange({
                fontSize: textSize("caption"),
                justifySelf: "end",
              })}
              {renderExtendedHoursBadge()}
            </span>
          </div>
        </div>
        {item.monitoredOnly ? (
          <AppTooltip content={`Add ${item.sym} to watchlist`}>
            <button
              type="button"
              data-testid="watchlist-add-symbol"
              className="ra-interactive"
              onClick={(event) => {
                event.stopPropagation();
                onAddSymbol?.(item.sym, displayName, item);
              }}
              disabled={addActionDisabled}
              style={{
                width: dim(26),
                height: dim(26),
                justifySelf: "end",
                display: "grid",
                placeItems: "center",
                border: "none",
                borderRadius: dim(RADII.sm),
                background: CSS_COLOR.accent,
                color: CSS_COLOR.onAccent,
                cursor: addActionDisabled ? "default" : "pointer",
                transition: "background var(--ra-motion-standard) ease",
              }}
            >
              <Plus size={13} />
            </button>
          </AppTooltip>
        ) : reserveAddColumn ? (
          // Keep the add-button column reserved on non-monitored rows so prices
          // and sparklines stay vertically aligned down a mixed list.
          <span aria-hidden="true" style={{ width: dim(26), justifySelf: "end" }} />
        ) : null}
      </div>
    );
  },
);

export const Watchlist = ({
  watchlists = [],
  activeWatchlistId = null,
  items = [],
  selected,
  signalStates = [],
  signalMatrixStates = [],
  signalProfile = null,
  signalEvents = [],
  onSelect,
  onSelectWatchlist,
  onCreateWatchlist,
  onRenameWatchlist,
  onDeleteWatchlist,
  onSetDefaultWatchlist,
  onAddSymbol,
  onReorderSymbol,
  onRemoveSymbol,
  onSignalAction,
  busy = false,
  density = "default",
  headerAccessory = null,
}) => {
  const rootRef = useRef(null);
  const [search, setSearch] = useState("");
  const [watchlistMenuOpen, setWatchlistMenuOpen] = useState(false);
  const [manageSheetOpen, setManageSheetOpen] = useState(false);
  const [addMode, setAddMode] = useState(false);
  const [sortMode, setSortMode] = useState(WATCHLIST_SORT_MODE.MANUAL);
  const [sortDirection, setSortDirection] = useState("desc");
  const [draggedItemId, setDraggedItemId] = useState(null);
  const [dragOverItemId, setDragOverItemId] = useState(null);
  // Mirror of draggedItemId so the drag callbacks below can read the live value without
  // listing draggedItemId as a dependency — that would hand WatchlistRow a fresh callback
  // reference on every drag tick and defeat its memo(), reintroducing full-list reconciles.
  const draggedItemIdRef = useRef(null);
  draggedItemIdRef.current = draggedItemId;
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState(() => new Set());
  const effectiveSignalEvents =
    Array.isArray(signalEvents) && signalEvents.length
      ? signalEvents
      : EMPTY_SIGNAL_EVENTS;
  const activeWatchlist =
    activeWatchlistId != null
      ? watchlists.find((watchlist) => watchlist.id === activeWatchlistId) ||
        null
      : watchlists[0] || null;
  const activeSymbols = useMemo(
    () =>
      new Set(
        items
          .filter((item) => !item.monitoredOnly)
          .map((item) => item.sym)
          .filter(Boolean),
      ),
    [items],
  );
  const quickAddSymbols = useMemo(
    () =>
      [...new Set([...WATCHLIST, ...INDICES, ...MACRO_TICKERS].map((item) => item.sym))]
        .filter((symbol) => !activeSymbols.has(symbol))
        .slice(0, 8),
    [activeSymbols],
  );
  const itemSymbols = useMemo(
    () => items.map((item) => item.sym).filter(Boolean),
    [items],
  );
  const signalEventsBySymbol = useMemo(
    () => buildSignalEventsBySymbol(effectiveSignalEvents),
    [effectiveSignalEvents],
  );
  // Only subscribe the parent to every symbol's quotes when the active sort actually
  // orders by a live snapshot field. Otherwise this would re-render the whole watchlist
  // ~10x/sec and starve the status-wave canary (see WATCHLIST_SNAPSHOT_SORTS).
  const snapshotsBySymbol = useRuntimeTickerSnapshots(
    WATCHLIST_SNAPSHOT_SORTS.has(sortMode) ? itemSymbols : EMPTY_WATCHLIST_SYMBOLS,
  );
  const signalMatrixBySymbol = useMemo(
    () => buildSignalMatrixBySymbol(signalMatrixStates),
    [signalMatrixStates],
  );
  // The traded (execution) timeframe: prefer the Algo Control Panel's PUBLISHED
  // exec selection so the watchlist sparkline recolors when the user changes it,
  // falling back to the active signal monitor profile's timeframe when nothing is
  // published. Sparklines color by THIS timeframe's signal so the watchlist
  // matches the STA table / exec selection.
  const publishedExecutionTimeframe = useAlgoStaExecutionTimeframe();
  const watchlistExecutionTimeframe =
    String(publishedExecutionTimeframe || signalProfile?.timeframe || "").trim() ||
    null;
  const filtered = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) return items;
    return items.filter(
      (item) =>
        item.sym.toLowerCase().includes(normalizedSearch) ||
        (item.name || "").toLowerCase().includes(normalizedSearch),
    );
  }, [items, search]);
  const sorted = useMemo(
    () =>
      sortWatchlistRows(filtered, {
        mode: sortMode,
        direction: sortDirection,
        snapshotsBySymbol,
        signalMatrixBySymbol,
      }),
    [
      filtered,
      signalMatrixBySymbol,
      snapshotsBySymbol,
      sortDirection,
      sortMode,
    ],
  );
  // Reserve the trailing add-button column on every row only when the list
  // actually contains monitored-only rows, so a mixed list stays aligned
  // without padding an all-watchlist list with dead space.
  const reserveAddColumn = useMemo(
    () => sorted.some((item) => item.monitoredOnly),
    [sorted],
  );
  const itemOrder = useMemo(
    () => new Map(items.map((item, index) => [item.key || item.id || item.sym, index])),
    [items],
  );
  const monitoredOnlyCount = useMemo(
    () => items.filter((item) => item.monitoredOnly).length,
    [items],
  );
  const removableItems = useMemo(
    () => items.filter((item) => item.canRemove && item.id),
    [items],
  );
  const removableItemIds = useMemo(
    () => new Set(removableItems.map((item) => item.id)),
    [removableItems],
  );
  const selectedRemovableItems = useMemo(
    () => removableItems.filter((item) => selectedItemIds.has(item.id)),
    [removableItems, selectedItemIds],
  );
  const selectedRemovalCount = selectedRemovableItems.length;
  const directionEnabled = WATCHLIST_DIRECTION_SORTS.has(sortMode);
  const mobileDense = density === "mobile-dense";
  const closeWatchlistMenu = () => setWatchlistMenuOpen(false);
  const closeAddMode = () => setAddMode(false);
  const openManageSheet = () => {
    closeWatchlistMenu();
    preloadWatchlistTickerSearch();
    setAddMode(true);
    setManageSheetOpen(true);
  };
  const closeManageSheet = () => {
    setManageSheetOpen(false);
    closeAddMode();
  };
  const toggleWatchlistMenu = () => {
    const nextOpen = !watchlistMenuOpen;
    if (nextOpen) {
      closeAddMode();
    }
    setWatchlistMenuOpen(nextOpen);
  };
  const toggleAddMode = () => {
    const nextOpen = !addMode;
    closeWatchlistMenu();
    if (nextOpen) {
      preloadWatchlistTickerSearch();
    }
    setAddMode(nextOpen);
  };
  const startSelectionMode = () => {
    closeWatchlistMenu();
    closeAddMode();
    setDraggedItemId(null);
    setDragOverItemId(null);
    setSelectedItemIds(new Set());
    setSelectionMode(true);
  };
  const cancelSelectionMode = () => {
    setSelectionMode(false);
    setSelectedItemIds(new Set());
  };
  const toggleSelectionMode = () => {
    if (selectionMode) {
      cancelSelectionMode();
      return;
    }
    startSelectionMode();
  };
  const toggleItemSelection = useCallback(
    (itemId) => {
      if (!removableItemIds.has(itemId)) {
        return;
      }
      setSelectedItemIds((current) => {
        const next = new Set(current);
        if (next.has(itemId)) {
          next.delete(itemId);
        } else {
          next.add(itemId);
        }
        return next;
      });
    },
    [removableItemIds],
  );
  const handleRemoveSelected = () => {
    if (!selectedRemovableItems.length || busy) {
      return;
    }
    selectedRemovableItems.forEach((item) => {
      onRemoveSymbol?.(item.id, item.sym);
    });
    cancelSelectionMode();
  };

  useEffect(() => {
    if (
      typeof document === "undefined" ||
      manageSheetOpen ||
      (!watchlistMenuOpen && !addMode)
    ) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (rootRef.current?.contains(event.target)) {
        return;
      }
      closeWatchlistMenu();
      closeAddMode();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [addMode, watchlistMenuOpen]);

  useEffect(() => {
    setSelectedItemIds((current) => {
      const next = new Set(
        [...current].filter((itemId) => removableItemIds.has(itemId)),
      );
      if (next.size === current.size) {
        return current;
      }
      return next;
    });
  }, [removableItemIds]);

  const handleCreateWatchlist = () => {
    const nextName = window.prompt("New watchlist name");
    if (!nextName?.trim()) {
      return;
    }
    onCreateWatchlist?.(nextName.trim());
  };

  const handleRenameWatchlist = () => {
    if (!activeWatchlist) {
      return;
    }
    const nextName = window.prompt("Rename watchlist", activeWatchlist.name);
    if (!nextName?.trim() || nextName.trim() === activeWatchlist.name) {
      return;
    }
    onRenameWatchlist?.(activeWatchlist.id, nextName.trim());
  };

  const handleDeleteWatchlist = () => {
    if (!activeWatchlist) {
      return;
    }
    const confirmed = window.confirm(
      `Delete watchlist "${activeWatchlist.name}"?`,
    );
    if (!confirmed) {
      return;
    }
    onDeleteWatchlist?.(activeWatchlist.id);
  };

  const handleSelectTickerSearchResult = (result, close = closeAddMode) => {
    const ticker = result?.ticker;
    if (!ticker) {
      return;
    }
    onAddSymbol?.(ticker, result.name || ticker, result);
    close();
  };
  const renderWatchlistTickerSearch = (close = closeAddMode) => (
    <Suspense fallback={<WatchlistTickerSearchFallback />}>
      <LazyWatchlistTickerSearch
        open
        ticker={selected || quickAddSymbols[0] || "SPY"}
        recentTickerRows={[]}
        embedded
        onClose={close}
        onSelectTicker={(result) => handleSelectTickerSearchResult(result, close)}
      />
    </Suspense>
  );

  const handleSelectSortMode = (nextMode) => {
    setSortMode(nextMode);
    if (nextMode === WATCHLIST_SORT_MODE.ALPHA) {
      setSortDirection("asc");
    } else if (nextMode === WATCHLIST_SORT_MODE.PERCENT) {
      setSortDirection("desc");
    }
    setDraggedItemId(null);
    setDragOverItemId(null);
  };

  const clearDragState = useCallback(() => {
    setDraggedItemId(null);
    setDragOverItemId(null);
  }, []);

  const handleDrop = useCallback(
    (targetItemId) => {
      const dragged = draggedItemIdRef.current;
      if (!dragged || dragged === targetItemId) {
        clearDragState();
        return;
      }
      onReorderSymbol?.(dragged, targetItemId);
      clearDragState();
    },
    [clearDragState, onReorderSymbol],
  );

  // Stable drag-over handler (replaces a per-render inline arrow at the row site) so
  // WatchlistRow's memo() can bail out; reads the dragged id from the mirror ref.
  const handleDragOver = useCallback((itemId) => {
    const dragged = draggedItemIdRef.current;
    if (dragged && dragged !== itemId) {
      setDragOverItemId(itemId);
    }
  }, []);

  return (
    <div
      ref={rootRef}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: CSS_COLOR.bg1,
        borderRight: `1px solid ${CSS_COLOR.border}`,
        position: "relative",
      }}
    >
        <div
          className="ra-hairline-bottom"
          style={{
          padding: sp("12px 14px"),
          display: "flex",
          flexDirection: "column",
          gap: sp(8),
        }}
      >
        <div
          style={{ display: "flex", alignItems: "center", gap: sp(8), position: "relative" }}
        >
          <button
            type="button"
            data-testid="watchlist-menu-trigger"
            aria-expanded={watchlistMenuOpen ? "true" : "false"}
            onClick={toggleWatchlistMenu}
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: sp(8),
              padding: sp("8px 12px"),
              borderRadius: dim(RADII.sm),
              background: "transparent",
              border: `1px solid ${CSS_COLOR.border}`,
              color: CSS_COLOR.text,
              cursor: "pointer",
              fontFamily: T.sans,
              fontSize: textSize("paragraphMuted"),
              fontWeight: FONT_WEIGHTS.medium,
              letterSpacing: 0,
            }}
            className="ra-interactive"
          >
            <span
              style={{
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {activeWatchlist?.name || "Watchlists"}
            </span>
            <ChevronDown size={15} style={{ color: CSS_COLOR.textSec, flexShrink: 0 }} />
          </button>
          {watchlistMenuOpen ? (
            <div
              data-testid="watchlist-menu"
              style={{
                position: "absolute",
                top: "calc(100% + 4px)",
                left: 0,
                right: 0,
                zIndex: 20,
                background: CSS_COLOR.bg1,
                border: `1px solid ${CSS_COLOR.border}`,
                borderRadius: dim(RADII.sm),
                boxShadow: ELEVATION.lg,
                overflow: "hidden",
              }}
            >
              {watchlists.map((watchlist) => (
                <button
                  key={watchlist.id}
                  type="button"
                  onClick={() => {
                    onSelectWatchlist?.(watchlist.id);
                    closeWatchlistMenu();
                  }}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: sp(8),
                    padding: sp("8px 10px"),
                    background:
                      watchlist.id === activeWatchlistId ? `${cssColorMix(CSS_COLOR.accent, 7)}` : "transparent",
                    border: "none",
                    borderBottom: `1px solid ${cssColorMix(CSS_COLOR.border, 13)}`,
                    color: CSS_COLOR.text,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span style={{ minWidth: 0 }}>
                    <span
                      style={{
                        display: "block",
                        fontSize: textSize("paragraphMuted"),
                        fontWeight: FONT_WEIGHTS.medium,
                        fontFamily: T.sans,
                        color: CSS_COLOR.text,
                        letterSpacing: 0,
                      }}
                    >
                      {watchlist.name}
                    </span>
                    <span
                      style={{
                        display: "block",
                        fontSize: textSize("body"),
                        color: CSS_COLOR.textMuted,
                        fontFamily: T.sans,
                        marginTop: sp(2),
                      }}
                    >
                      {countWatchlistSymbols(watchlist)} symbols
                    </span>
                  </span>
                  {watchlist.isDefault ? (
                    <span
                      style={{
                        color: CSS_COLOR.green,
                        fontSize: textSize("caption"),
                        fontFamily: T.sans,
                        fontWeight: FONT_WEIGHTS.medium,
                        letterSpacing: "0.04em",
                        textTransform: "uppercase",
                      }}
                    >
                      Default
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            data-testid="watchlist-select-toggle"
            aria-pressed={selectionMode ? "true" : "false"}
            aria-label={selectionMode ? "Done selecting watchlist rows" : "Select watchlist rows"}
            onClick={toggleSelectionMode}
            disabled={!removableItems.length || busy}
            style={{
              minWidth: dim(selectionMode || mobileDense ? 54 : 32),
              height: dim(32),
              display: "grid",
              placeItems: "center",
              borderRadius: dim(RADII.sm),
              background: selectionMode ? `${cssColorMix(CSS_COLOR.accent, 9)}` : "transparent",
              border: `1px solid ${selectionMode ? CSS_COLOR.accent : CSS_COLOR.border}`,
              color: selectionMode ? CSS_COLOR.accent : CSS_COLOR.textSec,
              cursor: removableItems.length && !busy ? "pointer" : "default",
              fontFamily: T.sans,
              fontSize: textSize("caption"),
              fontWeight: FONT_WEIGHTS.medium,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              whiteSpace: "nowrap",
              opacity: removableItems.length ? 1 : 0.5,
            }}
            className="ra-interactive"
          >
            {selectionMode ? (
              "Done"
            ) : mobileDense ? (
              "Select"
            ) : (
              <ListChecks size={15} strokeWidth={1.9} />
            )}
          </button>
          <AppTooltip content={mobileDense ? "Manage watchlist" : "New watchlist"}><button
            type="button"
            data-testid={
              mobileDense ? "watchlist-manage-toggle" : "watchlist-create-watchlist"
            }
            onClick={mobileDense ? openManageSheet : handleCreateWatchlist}
            style={{
              width: dim(32),
              height: dim(32),
              display: "grid",
              placeItems: "center",
              borderRadius: dim(RADII.sm),
              background: "transparent",
              border: `1px solid ${CSS_COLOR.border}`,
              color: CSS_COLOR.accent,
              cursor: "pointer",
            }}
            className="ra-interactive"
          >
            {mobileDense ? <SlidersHorizontal size={16} /> : <Plus size={16} />}
          </button></AppTooltip>
          {headerAccessory ? (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              {headerAccessory}
            </span>
          ) : null}
        </div>

        {!mobileDense ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: sp(6) }}>
          <button
            type="button"
            onClick={handleRenameWatchlist}
            disabled={!activeWatchlist || busy}
            style={{
              padding: sp("6px 8px"),
              borderRadius: dim(RADII.sm),
              background: "transparent",
              border: "none",
              color: CSS_COLOR.textSec,
              cursor: activeWatchlist && !busy ? "pointer" : "default",
              fontFamily: T.sans,
              fontSize: textSize("caption"),
              fontWeight: FONT_WEIGHTS.medium,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            Rename
          </button>
          <button
            type="button"
            onClick={() => activeWatchlist && onSetDefaultWatchlist?.(activeWatchlist.id)}
            disabled={!activeWatchlist || activeWatchlist.isDefault || busy}
            style={{
              padding: sp("6px 8px"),
              borderRadius: dim(RADII.sm),
              background: activeWatchlist?.isDefault ? `${cssColorMix(CSS_COLOR.green, 7)}` : "transparent",
              border: "none",
              color: activeWatchlist?.isDefault ? CSS_COLOR.green : CSS_COLOR.textSec,
              cursor:
                activeWatchlist && !activeWatchlist.isDefault && !busy
                  ? "pointer"
                  : "default",
              fontFamily: T.sans,
              fontSize: textSize("caption"),
              fontWeight: FONT_WEIGHTS.medium,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            Default
          </button>
          <button
            type="button"
            onClick={handleDeleteWatchlist}
            disabled={!activeWatchlist || watchlists.length <= 1 || busy}
            style={{
              padding: sp("6px 8px"),
              borderRadius: dim(RADII.sm),
              background: "transparent",
              border: "none",
              color: watchlists.length <= 1 ? CSS_COLOR.textMuted : CSS_COLOR.red,
              cursor:
                activeWatchlist && watchlists.length > 1 && !busy
                  ? "pointer"
                  : "default",
              fontFamily: T.sans,
              fontSize: textSize("caption"),
              fontWeight: FONT_WEIGHTS.medium,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            Delete
          </button>
        </div>
        ) : null}

        {selectionMode ? (
          <div
            data-testid="watchlist-selection-toolbar"
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) auto",
              alignItems: "center",
              gap: sp(8),
              padding: sp("6px 8px"),
              border: `1px solid ${CSS_COLOR.border}`,
              borderRadius: dim(RADII.sm),
              background: `${cssColorMix(CSS_COLOR.accent, 6)}`,
            }}
          >
            <span
              data-testid="watchlist-selection-count"
              style={{
                minWidth: 0,
                color: CSS_COLOR.textSec,
                fontFamily: T.sans,
                fontSize: textSize("caption"),
                fontVariantNumeric: "tabular-nums",
                fontWeight: FONT_WEIGHTS.medium,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                whiteSpace: "nowrap",
              }}
            >
              {selectedRemovalCount} selected
            </span>
            <button
              type="button"
              data-testid="watchlist-remove-selected"
              onClick={handleRemoveSelected}
              disabled={!selectedRemovalCount || busy}
              style={{
                minHeight: dim(26),
                padding: sp("4px 9px"),
                border: `1px solid ${selectedRemovalCount ? CSS_COLOR.red : CSS_COLOR.border}`,
                borderRadius: dim(RADII.sm),
                background: selectedRemovalCount ? `${cssColorMix(CSS_COLOR.red, 9)}` : "transparent",
                color: selectedRemovalCount ? CSS_COLOR.red : CSS_COLOR.textMuted,
                cursor: selectedRemovalCount && !busy ? "pointer" : "default",
                fontFamily: T.sans,
                fontSize: textSize("caption"),
                fontWeight: FONT_WEIGHTS.medium,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
              }}
            >
              Remove
            </button>
          </div>
        ) : null}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: sp(4),
            minWidth: 0,
          }}
        >
          {WATCHLIST_SORT_OPTIONS.map((option) => {
            const active = sortMode === option.id;
            return (
              <AppTooltip key={option.id} content={`Sort by ${option.label}`}><button
                key={option.id}
                type="button"
                data-testid={`watchlist-sort-${option.id}`}
                onClick={() => handleSelectSortMode(option.id)}
                style={{
                  padding: sp("6px 4px"),
                  borderRadius: dim(RADII.sm),
                  background: active ? CSS_COLOR.accent : "transparent",
                  border: "none",
                  color: active ? CSS_COLOR.onAccent : CSS_COLOR.textSec,
                  cursor: "pointer",
                  fontFamily: T.sans,
                  fontSize: textSize("caption"),
                  fontWeight: active ? FONT_WEIGHTS.medium : FONT_WEIGHTS.regular,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  whiteSpace: "nowrap",
                }}
              >
                {option.label}
              </button></AppTooltip>
            );
          })}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: sp(8) }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: sp(8),
              padding: sp("8px 12px"),
              borderRadius: dim(RADII.sm),
              background: "transparent",
              border: `1px solid ${CSS_COLOR.border}`,
              minWidth: 0,
            }}
          >
            <Search size={15} style={{ color: CSS_COLOR.textSec, flexShrink: 0 }} />
            <WatchlistFilterInput
              value={search}
              onCommit={setSearch}
            />
          </div>
          <AppTooltip content={directionEnabled ? "Toggle sort direction" : "Sort direction unavailable"}><button
            type="button"
            onClick={() =>
              directionEnabled &&
              setSortDirection((current) => (current === "desc" ? "asc" : "desc"))
            }
            disabled={!directionEnabled}
            style={{
              width: dim(48),
              borderRadius: dim(RADII.sm),
              background: "transparent",
              border: `1px solid ${CSS_COLOR.border}`,
              color: directionEnabled ? CSS_COLOR.textSec : CSS_COLOR.textMuted,
              cursor: directionEnabled ? "pointer" : "default",
              fontFamily: T.sans,
              fontSize: textSize("caption"),
              fontWeight: FONT_WEIGHTS.medium,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            {sortDirection === "desc" ? "Desc" : "Asc"}
          </button></AppTooltip>
        </div>

        {!mobileDense && addMode ? (
          <div
            data-testid="watchlist-add-panel"
            style={{
              border: `1px solid ${CSS_COLOR.border}`,
              borderRadius: dim(RADII.sm),
              background: "transparent",
              overflow: "hidden",
            }}
          >
            {renderWatchlistTickerSearch(closeAddMode)}
          </div>
        ) : null}
      </div>

      <div className="ra-scroll-fade-y" style={{ flex: 1, overflowY: "auto" }}>
        {sorted.map((item) => {
          const itemKey = item.key || item.id || item.sym;
          const canDrag =
            sortMode === WATCHLIST_SORT_MODE.MANUAL &&
            Boolean(item.canReorder && item.id) &&
            !selectionMode &&
            !busy;
          return (
            <WatchlistRow
              key={itemKey}
              item={item}
              itemIndex={itemOrder.get(itemKey) ?? -1}
              selected={selected}
              canDrag={canDrag}
              dragging={Boolean(item.id && item.id === draggedItemId)}
              dragOver={Boolean(item.id && item.id === dragOverItemId)}
              onDragStart={setDraggedItemId}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onDragEnd={clearDragState}
              onSelect={onSelect}
              onAddSymbol={onAddSymbol}
              onToggleSelection={toggleItemSelection}
              onSignalAction={onSignalAction}
              signalStatesByTimeframe={signalMatrixBySymbol[item.sym]}
              signalEvents={signalEventsBySymbol.get(item.sym) || EMPTY_SIGNAL_EVENTS}
              executionTimeframe={watchlistExecutionTimeframe}
              busy={busy}
              density={density}
              selectionMode={selectionMode}
              selectedForRemoval={Boolean(item.id && selectedItemIds.has(item.id))}
              reserveAddColumn={reserveAddColumn}
            />
          );
        })}
      </div>

      <div
        style={{
          padding: sp("10px 14px"),
          borderTop: `1px solid ${CSS_COLOR.border}`,
          fontSize: textSize("body"),
          color: CSS_COLOR.textMuted,
          fontFamily: T.sans,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: sp(10),
        }}
      >
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          {sorted.length} shown
          {monitoredOnlyCount ? ` · ${monitoredOnlyCount} monitored` : ""}
        </span>
        <button
          type="button"
          data-testid="watchlist-add-toggle"
          onClick={mobileDense ? openManageSheet : toggleAddMode}
          onPointerEnter={preloadWatchlistTickerSearch}
          onPointerDownCapture={preloadWatchlistTickerSearch}
          onFocus={preloadWatchlistTickerSearch}
          style={{
            display: "flex",
            alignItems: "center",
            gap: sp(6),
            padding: sp("4px 10px"),
            border: "none",
            background: "transparent",
            color: CSS_COLOR.accent,
            cursor: "pointer",
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            fontWeight: FONT_WEIGHTS.medium,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            borderRadius: dim(RADII.sm),
          }}
        >
          {mobileDense ? (
            <SlidersHorizontal size={14} />
          ) : addMode ? (
            <X size={14} />
          ) : (
            <Plus size={14} />
          )}
          {mobileDense ? "Manage" : addMode ? "Close" : "Add"}
        </button>
      </div>
      <BottomSheet
        open={mobileDense && manageSheetOpen}
        onClose={closeManageSheet}
        title="Manage Watchlist"
        testId="watchlist-manage-sheet"
        maxHeight="82dvh"
      >
        <div
          style={{
            display: "grid",
            gap: sp(10),
            padding: sp("10px 10px max(14px, env(safe-area-inset-bottom))"),
            background: CSS_COLOR.bg0,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: sp(8),
            }}
          >
            <button
              type="button"
              onClick={handleCreateWatchlist}
              disabled={busy}
              style={{
                minHeight: dim(42),
                border: `1px solid ${CSS_COLOR.border}`,
                borderRadius: dim(RADII.sm),
                background: CSS_COLOR.bg1,
                color: CSS_COLOR.accent,
                fontFamily: T.sans,
                fontSize: textSize("caption"),
                fontWeight: FONT_WEIGHTS.medium,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                cursor: busy ? "default" : "pointer",
              }}
            >
              New
            </button>
            <button
              type="button"
              onClick={handleRenameWatchlist}
              disabled={!activeWatchlist || busy}
              style={{
                minHeight: dim(42),
                border: `1px solid ${CSS_COLOR.border}`,
                borderRadius: dim(RADII.sm),
                background: CSS_COLOR.bg1,
                color: CSS_COLOR.textSec,
                fontFamily: T.sans,
                fontSize: textSize("caption"),
                fontWeight: FONT_WEIGHTS.medium,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                cursor: activeWatchlist && !busy ? "pointer" : "default",
              }}
            >
              Rename
            </button>
            <button
              type="button"
              onClick={() => activeWatchlist && onSetDefaultWatchlist?.(activeWatchlist.id)}
              disabled={!activeWatchlist || activeWatchlist.isDefault || busy}
              style={{
                minHeight: dim(42),
                border: `1px solid ${activeWatchlist?.isDefault ? CSS_COLOR.green : CSS_COLOR.border}`,
                borderRadius: dim(RADII.sm),
                background: activeWatchlist?.isDefault ? `${cssColorMix(CSS_COLOR.green, 7)}` : CSS_COLOR.bg1,
                color: activeWatchlist?.isDefault ? CSS_COLOR.green : CSS_COLOR.textSec,
                fontFamily: T.sans,
                fontSize: textSize("caption"),
                fontWeight: FONT_WEIGHTS.medium,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                cursor:
                  activeWatchlist && !activeWatchlist.isDefault && !busy
                    ? "pointer"
                    : "default",
              }}
            >
              Default
            </button>
            <button
              type="button"
              onClick={handleDeleteWatchlist}
              disabled={!activeWatchlist || watchlists.length <= 1 || busy}
              style={{
                minHeight: dim(42),
                border: `1px solid ${CSS_COLOR.border}`,
                borderRadius: dim(RADII.sm),
                background: CSS_COLOR.bg1,
                color: watchlists.length <= 1 ? CSS_COLOR.textMuted : CSS_COLOR.red,
                fontFamily: T.sans,
                fontSize: textSize("caption"),
                fontWeight: FONT_WEIGHTS.medium,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                cursor:
                  activeWatchlist && watchlists.length > 1 && !busy
                    ? "pointer"
                    : "default",
              }}
            >
              Delete
            </button>
          </div>

          <div
            data-testid="watchlist-manage-add-panel"
            style={{
              border: `1px solid ${CSS_COLOR.border}`,
              borderRadius: dim(RADII.md),
              background: CSS_COLOR.bg1,
              overflow: "hidden",
            }}
          >
            {renderWatchlistTickerSearch(closeManageSheet)}
          </div>
        </div>
      </BottomSheet>
    </div>
  );
};

const WatchlistContainer = ({
  activeWatchlist,
  watchlistSymbols,
  signalStates = [],
  signalMatrixStates = [],
  signalProfile = null,
  signalEvents = [],
  ...rest
}) => {
  const items = useMemo(() => {
    return buildWatchlistRows({
      activeWatchlist,
      fallbackSymbols: watchlistSymbols,
      signalStates,
    }).map((item, index) => {
      const fallback = buildFallbackWatchlistItem(
        item.sym,
        index,
        item.name || item.sym,
      );
      return {
        ...item,
        name: item.name || fallback.name || item.sym,
      };
    });
  }, [activeWatchlist, signalStates, watchlistSymbols]);
  return (
    <Watchlist
      activeWatchlistId={activeWatchlist?.id || null}
      items={items}
      signalStates={signalStates}
      signalMatrixStates={signalMatrixStates}
      signalProfile={signalProfile}
      signalEvents={signalEvents}
      {...rest}
    />
  );
};

export const MemoWatchlistContainer = memo(WatchlistContainer);
