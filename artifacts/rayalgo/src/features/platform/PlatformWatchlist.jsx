import { useSearchUniverseTickers } from "@workspace/api-client-react";
import { ChevronDown, GripVertical, ListChecks, Plus, Search, SlidersHorizontal, X } from "lucide-react";
import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { BottomSheet } from "../../components/platform/BottomSheet.jsx";
import { SignalDots } from "../../components/platform/signal-language";
import { MicroSparkline } from "../../components/platform/primitives.jsx";
import { ELEVATION, FONT_WEIGHTS, MISSING_VALUE, RADII, T, dim, fs, sp, textSize } from "../../lib/uiTokens.jsx";
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
import { useNumberTick } from "../../lib/numberTick.js";
import { INDICES, MACRO_TICKERS, WATCHLIST } from "../market/marketReferenceData";
import { buildFallbackWatchlistItem } from "./runtimeMarketDataModel";
import { useRuntimeTickerSnapshot, useRuntimeTickerSnapshots } from "./runtimeTickerStore";
import { MarketIdentityMark } from "./marketIdentity";
import { useSignalMonitorStateForSymbol } from "./signalMonitorStore";
import { normalizeTickerSymbol } from "./tickerIdentity";
import {
  WATCHLIST_SORT_MODE,
  buildSignalMatrixBySymbol,
  buildWatchlistRows,
  countWatchlistSymbols,
  getBestWatchlistSignalState,
  sortWatchlistRows,
} from "./watchlistModel";
import { AppTooltip } from "@/components/ui/tooltip";


// MicroSparkline + extractSparklineValues are exported from
// components/platform/primitives.jsx — imported above.

const buildFallbackSparklineData = (symbol, priceValue, previousPrice) => {
  const pointCount = 32;
  const start = isFiniteNumber(previousPrice) ? previousPrice : priceValue * 0.997;
  const end = priceValue;
  const span = Math.max(Math.abs(end - start), Math.abs(end) * 0.0015, 0.01);
  const seed = String(symbol || "")
    .split("")
    .reduce((sum, char, index) => sum + char.charCodeAt(0) * (index + 1), 0);

  return Array.from({ length: pointCount }, (_, index) => {
    const t = index / (pointCount - 1);
    const trend = start + (end - start) * t;
    const wave =
      Math.sin(t * Math.PI * 3 + seed * 0.17) * span * 0.18 +
      Math.cos(t * Math.PI * 5 + seed * 0.11) * span * 0.08;

    return {
      i: index,
      v: index === 0 ? start : index === pointCount - 1 ? end : trend + wave,
    };
  });
};

const resolveSparklineData = (symbol, snapshot, fallback, priceValue) => {
  if (Array.isArray(snapshot?.sparkBars) && snapshot.sparkBars.length >= 2) {
    return snapshot.sparkBars;
  }
  if (Array.isArray(snapshot?.spark) && snapshot.spark.length >= 2) {
    return snapshot.spark;
  }
  if (Array.isArray(fallback?.sparkBars) && fallback.sparkBars.length >= 2) {
    return fallback.sparkBars;
  }
  if (Array.isArray(fallback?.spark) && fallback.spark.length >= 2) {
    return fallback.spark;
  }

  if (!isFiniteNumber(priceValue)) {
    return [];
  }

  const change = isFiniteNumber(snapshot?.chg)
    ? snapshot.chg
    : isFiniteNumber(snapshot?.change)
      ? snapshot.change
      : null;
  const percent = isFiniteNumber(snapshot?.pct)
    ? snapshot.pct
    : isFiniteNumber(snapshot?.changePercent)
      ? snapshot.changePercent
      : null;
  const previousPrice = isFiniteNumber(change)
    ? priceValue - change
    : isFiniteNumber(percent) && percent !== -100
      ? priceValue / (1 + percent / 100)
      : priceValue * 0.997;

  return buildFallbackSparklineData(symbol, priceValue, previousPrice);
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

const isWatchlistSignalDirection = (value) =>
  value === "buy" || value === "sell";

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
    busy = false,
    density = "default",
    selectionMode = false,
    selectedForRemoval = false,
  }) => {
    const fallback = useMemo(
      () =>
        buildFallbackWatchlistItem(item.sym, itemIndex, item.name || item.sym),
      [item.name, item.sym, itemIndex],
    );
    const snapshot = useRuntimeTickerSnapshot(item.sym, fallback);
    const signalState = useSignalMonitorStateForSymbol(item.sym);
    const bestSignalState = getBestWatchlistSignalState(
      signalStatesByTimeframe,
      signalState,
    );
    const rowSelectable = Boolean(item.canRemove && item.id);
    const selectedRow = selected === item.sym;
    const signalDirection = bestSignalState?.currentSignalDirection;
    const hasSignal =
      isWatchlistSignalDirection(signalDirection) &&
      bestSignalState?.status !== "error" &&
      bestSignalState?.status !== "unavailable";
    const signalColor = signalDirection === "buy" ? T.blue : T.red;
    const signalFresh = Boolean(bestSignalState?.fresh);
    const pctPositive = isFiniteNumber(snapshot?.pct) ? snapshot.pct >= 0 : null;
	    const priceValue = isFiniteNumber(snapshot?.price)
	      ? snapshot.price
	      : signalState?.currentSignalPrice;
	    const quotePriceForFlash = isFiniteNumber(snapshot?.price)
	      ? snapshot.price
	      : null;
	    const priceFlashClassName = useValueFlash(quotePriceForFlash);
	    // 380ms is shorter than the KPI strip's 420ms — watchlist updates
	    // arrive more often per row and a slightly faster tween keeps the
	    // animation from queueing into the next streaming tick.
	    const animatedPrice = useNumberTick(priceValue, 380);
	    const displayedPrice = animatedPrice ?? priceValue;
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
      ? `${T.accent}10`
      : dragOver
        ? `${T.accent}18`
        : selectedForRemoval
          ? `${T.accent}18`
        : selectedRow
          ? T.bg3
          : "transparent";
    const mobileDense = density === "mobile-dense";
    const sparklineData = resolveSparklineData(item.sym, snapshot, fallback, priceValue);
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
            selectedForRemoval ? T.accent : rowSelectable ? T.border : T.borderLight
          }`,
          background: selectedForRemoval ? T.accent : "transparent",
          color: selectedForRemoval ? T.onAccent : T.textMuted,
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
              borderLeft: `1.5px solid ${T.onAccent}`,
              borderBottom: `1.5px solid ${T.onAccent}`,
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
            pctPositive == null ? T.textMuted : pctPositive ? T.green : T.red,
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
              border: `1px solid ${signalFresh ? signalColor : `${signalColor}88`}`,
              background: signalFresh ? `${signalColor}24` : `${signalColor}14`,
              color: signalFresh ? signalColor : `${signalColor}d0`,
              cursor: "pointer",
              fontFamily: T.sans,
              fontSize: fs(7),
              fontWeight: FONT_WEIGHTS.medium,
              letterSpacing: "-0.005em",
              lineHeight: 1,
              padding: sp("2px 5px"),
              borderRadius: dim(RADII.pill),
              boxShadow: signalFresh ? `0 0 0 2px ${signalColor}20` : "none",
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
          fallbackState={signalState}
          onSelect={(state) => onSignalAction?.(item.sym, state)}
          style={{ minWidth: dim(34), gap: sp(3) }}
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
              accent: selectedRow
                ? T.accent
                : hasSignal
                  ? signalColor
                  : pctPositive == null
                    ? T.accent
                    : pctPositive
                      ? T.green
                      : T.red,
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
              selectedRow || dragOver ? `${T.accent}12` : rowBackground,
            color: T.text,
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
                color: T.text,
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
              style={{
                width: dim(40),
                height: dim(14),
                minWidth: dim(40),
                marginLeft: "auto",
                overflow: "hidden",
                flexShrink: 0,
              }}
            >
              <MicroSparkline
                data={sparklineData}
                positive={pctPositive}
                width={40}
                height={14}
                style={{ width: "100%", height: "100%" }}
              />
            </span>
            <span
              className={priceFlashClassName}
              style={{
                color: T.text,
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
            accent: selectedRow
              ? T.accent
              : hasSignal
                ? signalColor
                : pctPositive == null
                  ? T.accent
                  : pctPositive
                    ? T.green
                    : T.red,
          }),
          display: "grid",
          gridTemplateColumns: [
            selectionMode ? `${dim(20)}px` : null,
            "minmax(0,1fr)",
            item.monitoredOnly ? `${dim(26)}px` : null,
          ].filter(Boolean).join(" "),
          gap: sp(4),
          padding: sp("9px 6px"),
          cursor: selectionMode ? (rowSelectable ? "pointer" : "default") : "pointer",
          alignItems: "center",
          background:
            selectedRow || dragOver ? `${T.accent}12` : rowBackground,
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
                color: canDrag ? T.textSec : T.textMuted,
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
                  color: T.text,
                  letterSpacing: "-0.005em",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  padding: sp("1px 3px"),
                  borderRadius: dim(RADII.xs),
                }}
              >
                {item.sym}
              </span>
              {renderDayChange({ flex: "0 0 auto" })}
            </span>
            {renderSignalCluster({ justifySelf: "end" })}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(44px,92px) auto",
              alignItems: "center",
              justifyContent: "end",
              gap: sp(4),
              marginTop: sp(6),
              minWidth: 0,
            }}
          >
            <span
              data-testid="watchlist-row-sparkline"
              style={{
                width: "100%",
                minWidth: dim(44),
                maxWidth: dim(92),
                height: dim(22),
                overflow: "hidden",
              }}
            >
              <MicroSparkline
                data={sparklineData}
                positive={pctPositive}
                width={92}
                height={22}
                style={{ width: "100%", height: "100%" }}
              />
            </span>
            <span
              className={priceFlashClassName}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "flex-end",
                color: T.text,
                fontFamily: T.sans,
                fontSize: textSize("paragraphMuted"),
                fontVariantNumeric: "tabular-nums",
                fontWeight: FONT_WEIGHTS.regular,
                textAlign: "right",
                justifySelf: "end",
                padding: sp("1px 2px"),
                borderRadius: dim(RADII.xs),
                whiteSpace: "nowrap",
              }}
            >
              {formatQuotePrice(displayedPrice)}
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
                background: T.accent,
                color: T.onAccent,
                cursor: addActionDisabled ? "default" : "pointer",
                transition: "background 0.18s ease",
              }}
            >
              <Plus size={13} />
            </button>
          </AppTooltip>
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
  const [addQuery, setAddQuery] = useState("");
  const [sortMode, setSortMode] = useState(WATCHLIST_SORT_MODE.MANUAL);
  const [sortDirection, setSortDirection] = useState("desc");
  const [draggedItemId, setDraggedItemId] = useState(null);
  const [dragOverItemId, setDragOverItemId] = useState(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState(() => new Set());
  const deferredAddQuery = useDeferredValue(addQuery.trim());
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
  const snapshotsBySymbol = useRuntimeTickerSnapshots(itemSymbols);
  const signalStatesBySymbol = useMemo(
    () =>
      Object.fromEntries(
        (signalStates || [])
          .map((state) => [normalizeTickerSymbol(state?.symbol), state])
          .filter(([symbol]) => Boolean(symbol)),
      ),
    [signalStates],
  );
  const signalMatrixBySymbol = useMemo(
    () => buildSignalMatrixBySymbol(signalMatrixStates),
    [signalMatrixStates],
  );
  const addSymbolSearch = useSearchUniverseTickers(
    addMode && deferredAddQuery.length > 0
      ? {
          search: deferredAddQuery,
          markets: ["stocks", "etf", "indices", "futures", "fx", "crypto", "otc"],
          active: true,
          limit: 8,
        }
      : undefined,
    {
      query: {
        enabled: addMode && deferredAddQuery.length > 0,
        staleTime: 60_000,
        retry: false,
      },
    },
  );
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
        signalStatesBySymbol,
        signalMatrixBySymbol,
      }),
    [
      filtered,
      signalMatrixBySymbol,
      signalStatesBySymbol,
      snapshotsBySymbol,
      sortDirection,
      sortMode,
    ],
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
  const closeAddMode = ({ clearQuery = false } = {}) => {
    setAddMode(false);
    if (clearQuery) {
      setAddQuery("");
    }
  };
  const openManageSheet = () => {
    closeWatchlistMenu();
    setAddMode(true);
    setManageSheetOpen(true);
  };
  const closeManageSheet = () => {
    setManageSheetOpen(false);
    closeAddMode({ clearQuery: true });
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
    if (!nextOpen) {
      setAddQuery("");
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
  const toggleItemSelection = (itemId) => {
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
  };
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

  const handleAddQuickSymbol = (symbol) => {
    onAddSymbol?.(symbol, symbol);
    closeAddMode({ clearQuery: true });
  };

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

  const clearDragState = () => {
    setDraggedItemId(null);
    setDragOverItemId(null);
  };

  const handleDrop = (targetItemId) => {
    if (!draggedItemId || draggedItemId === targetItemId) {
      clearDragState();
      return;
    }
    onReorderSymbol?.(draggedItemId, targetItemId);
    clearDragState();
  };

  return (
    <div
      ref={rootRef}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: T.bg1,
        borderRight: `1px solid ${T.border}`,
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
              border: `1px solid ${T.border}`,
              color: T.text,
              cursor: "pointer",
              fontFamily: T.sans,
              fontSize: textSize("paragraphMuted"),
              fontWeight: FONT_WEIGHTS.medium,
              letterSpacing: "-0.005em",
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
            <ChevronDown size={15} style={{ color: T.textSec, flexShrink: 0 }} />
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
                background: T.bg1,
                border: `1px solid ${T.border}`,
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
                      watchlist.id === activeWatchlistId ? `${T.accent}12` : "transparent",
                    border: "none",
                    borderBottom: `1px solid ${T.border}20`,
                    color: T.text,
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
                        color: T.text,
                        letterSpacing: "-0.005em",
                      }}
                    >
                      {watchlist.name}
                    </span>
                    <span
                      style={{
                        display: "block",
                        fontSize: textSize("body"),
                        color: T.textMuted,
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
                        color: T.green,
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
              background: selectionMode ? `${T.accent}16` : "transparent",
              border: `1px solid ${selectionMode ? T.accent : T.border}`,
              color: selectionMode ? T.accent : T.textSec,
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
              border: `1px solid ${T.border}`,
              color: T.accent,
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
              color: T.textSec,
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
              background: activeWatchlist?.isDefault ? `${T.green}12` : "transparent",
              border: "none",
              color: activeWatchlist?.isDefault ? T.green : T.textSec,
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
              color: watchlists.length <= 1 ? T.textMuted : T.red,
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
              border: `1px solid ${T.border}`,
              borderRadius: dim(RADII.sm),
              background: `${T.accent}0f`,
            }}
          >
            <span
              data-testid="watchlist-selection-count"
              style={{
                minWidth: 0,
                color: T.textSec,
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
                border: `1px solid ${selectedRemovalCount ? T.red : T.border}`,
                borderRadius: dim(RADII.sm),
                background: selectedRemovalCount ? `${T.red}18` : "transparent",
                color: selectedRemovalCount ? T.red : T.textMuted,
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
                  background: active ? T.accent : "transparent",
                  border: "none",
                  color: active ? T.onAccent : T.textSec,
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
              border: `1px solid ${T.border}`,
              minWidth: 0,
            }}
          >
            <Search size={15} style={{ color: T.textSec, flexShrink: 0 }} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Filter..."
              style={{
                flex: 1,
                minWidth: 0,
                background: "transparent",
                border: "none",
                outline: "none",
                fontSize: textSize("paragraphMuted"),
                fontFamily: T.sans,
                color: T.text,
              }}
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
              border: `1px solid ${T.border}`,
              color: directionEnabled ? T.textSec : T.textMuted,
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
              border: `1px solid ${T.border}`,
              borderRadius: dim(RADII.sm),
              background: "transparent",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: sp(8),
                padding: sp("10px 12px"),
                borderBottom: `1px solid ${T.border}`,
              }}
            >
              <input
                value={addQuery}
                onChange={(event) => setAddQuery(event.target.value)}
                placeholder="Add symbol…"
                style={{
                  flex: 1,
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  fontSize: textSize("paragraphMuted"),
                  fontFamily: T.sans,
                  color: T.text,
                  letterSpacing: "-0.005em",
                }}
              />
              <AppTooltip content="Close add symbol"><button
                type="button"
                onClick={() => {
                  closeAddMode({ clearQuery: true });
                }}
                style={{
                  width: dim(28),
                  height: dim(28),
                  display: "grid",
                  placeItems: "center",
                  border: "none",
                  background: "transparent",
                  color: T.textSec,
                  cursor: "pointer",
                  borderRadius: dim(RADII.sm),
                }}
              >
                <X size={15} />
              </button></AppTooltip>
            </div>

            <div style={{ maxHeight: dim(220), overflowY: "auto" }}>
              {deferredAddQuery.length > 0
                ? (addSymbolSearch.data?.results || []).map((result) => (
                    <button
                      key={`${result.ticker}-${result.name}`}
                      type="button"
                      onClick={() => {
                        onAddSymbol?.(result.ticker, result.name || result.ticker, result);
                        closeAddMode({ clearQuery: true });
                      }}
                      style={{
                        width: "100%",
                        display: "grid",
                        gridTemplateColumns: `${dim(64)}px 1fr`,
                        gap: sp(10),
                        alignItems: "center",
                        padding: sp("10px 12px"),
                        background: "transparent",
                        border: "none",
                        borderBottom: `1px solid ${T.borderLight}`,
                        textAlign: "left",
                        cursor: "pointer",
                      }}
                    >
                      <span
                        style={{
                          fontSize: textSize("paragraphMuted"),
                          fontWeight: FONT_WEIGHTS.medium,
                          fontFamily: T.sans,
                          color: T.text,
                          letterSpacing: "-0.005em",
                        }}
                      >
                        {result.ticker}
                      </span>
                      <span
                        style={{
                          fontSize: textSize("body"),
                          color: T.textSec,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {result.name || result.primaryExchange || "Equity"}
                      </span>
                    </button>
                  ))
                : quickAddSymbols.map((symbol) => (
                    <button
                      key={symbol}
                      type="button"
                      onClick={() => handleAddQuickSymbol(symbol)}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: sp("10px 12px"),
                        background: "transparent",
                        border: "none",
                        borderBottom: `1px solid ${T.borderLight}`,
                        cursor: "pointer",
                        fontFamily: T.sans,
                        fontSize: textSize("paragraphMuted"),
                        fontWeight: FONT_WEIGHTS.medium,
                        color: T.text,
                      }}
                    >
                      <span>{symbol}</span>
                      <span
                        style={{
                          color: T.textMuted,
                          fontSize: textSize("caption"),
                          letterSpacing: "0.04em",
                          textTransform: "uppercase",
                          fontWeight: FONT_WEIGHTS.medium,
                        }}
                      >
                        Quick Add
                      </span>
                    </button>
                  ))}
              {addMode &&
              deferredAddQuery.length > 0 &&
              !addSymbolSearch.isPending &&
              !(addSymbolSearch.data?.results || []).length ? (
                <div
                  style={{
                    padding: sp("10px 8px"),
                    color: T.textDim,
                    fontSize: textSize("caption"),
                    fontFamily: T.sans,
                  }}
                >
                  No matching symbols.
                </div>
              ) : null}
            </div>
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
              onDragOver={(itemId) => {
                if (draggedItemId && draggedItemId !== itemId) {
                  setDragOverItemId(itemId);
                }
              }}
              onDrop={handleDrop}
              onDragEnd={clearDragState}
              onSelect={onSelect}
              onAddSymbol={onAddSymbol}
              onToggleSelection={toggleItemSelection}
              onSignalAction={onSignalAction}
              signalStatesByTimeframe={signalMatrixBySymbol[item.sym]}
              busy={busy}
              density={density}
              selectionMode={selectionMode}
              selectedForRemoval={Boolean(item.id && selectedItemIds.has(item.id))}
            />
          );
        })}
      </div>

      <div
        style={{
          padding: sp("10px 14px"),
          borderTop: `1px solid ${T.border}`,
          fontSize: textSize("body"),
          color: T.textMuted,
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
          style={{
            display: "flex",
            alignItems: "center",
            gap: sp(6),
            padding: sp("4px 10px"),
            border: "none",
            background: "transparent",
            color: T.accent,
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
            background: T.bg0,
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
                border: `1px solid ${T.border}`,
                borderRadius: dim(RADII.sm),
                background: T.bg1,
                color: T.accent,
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
                border: `1px solid ${T.border}`,
                borderRadius: dim(RADII.sm),
                background: T.bg1,
                color: T.textSec,
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
                border: `1px solid ${activeWatchlist?.isDefault ? T.green : T.border}`,
                borderRadius: dim(RADII.sm),
                background: activeWatchlist?.isDefault ? `${T.green}12` : T.bg1,
                color: activeWatchlist?.isDefault ? T.green : T.textSec,
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
                border: `1px solid ${T.border}`,
                borderRadius: dim(RADII.sm),
                background: T.bg1,
                color: watchlists.length <= 1 ? T.textMuted : T.red,
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
              border: `1px solid ${T.border}`,
              borderRadius: dim(RADII.md),
              background: T.bg1,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: sp(8),
                padding: sp("12px 14px"),
                borderBottom: `1px solid ${T.borderLight}`,
              }}
            >
              <Search size={15} style={{ color: T.textSec, flexShrink: 0 }} />
              <input
                value={addQuery}
                onChange={(event) => setAddQuery(event.target.value)}
                placeholder="Add symbol…"
                style={{
                  flex: 1,
                  minWidth: 0,
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  color: T.text,
                  fontFamily: T.sans,
                  fontSize: textSize("paragraphMuted"),
                  letterSpacing: "-0.005em",
                }}
              />
            </div>
            <div style={{ maxHeight: dim(280), overflowY: "auto" }}>
              {deferredAddQuery.length > 0
                ? (addSymbolSearch.data?.results || []).map((result) => (
                    <button
                      key={`${result.ticker}-${result.name}`}
                      type="button"
                      onClick={() => {
                        onAddSymbol?.(result.ticker, result.name || result.ticker, result);
                        closeManageSheet();
                      }}
                      style={{
                        width: "100%",
                        minHeight: dim(48),
                        display: "grid",
                        gridTemplateColumns: `${dim(72)}px minmax(0, 1fr)`,
                        gap: sp(10),
                        alignItems: "center",
                        padding: sp("0 14px"),
                        background: "transparent",
                        border: "none",
                        borderBottom: `1px solid ${T.borderLight}`,
                        color: T.text,
                        textAlign: "left",
                        cursor: "pointer",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: T.sans,
                          fontSize: textSize("paragraphMuted"),
                          fontWeight: FONT_WEIGHTS.medium,
                          letterSpacing: "-0.005em",
                        }}
                      >
                        {result.ticker}
                      </span>
                      <span
                        style={{
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          color: T.textSec,
                          fontSize: textSize("body"),
                        }}
                      >
                        {result.name || result.primaryExchange || "Equity"}
                      </span>
                    </button>
                  ))
                : quickAddSymbols.map((symbol) => (
                    <button
                      key={symbol}
                      type="button"
                      onClick={() => {
                        handleAddQuickSymbol(symbol);
                        closeManageSheet();
                      }}
                      style={{
                        width: "100%",
                        minHeight: dim(44),
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: sp("0 14px"),
                        background: "transparent",
                        border: "none",
                        borderBottom: `1px solid ${T.borderLight}`,
                        color: T.text,
                        cursor: "pointer",
                        fontFamily: T.sans,
                        fontSize: textSize("paragraphMuted"),
                        fontWeight: FONT_WEIGHTS.medium,
                      }}
                    >
                      <span>{symbol}</span>
                      <span
                        style={{
                          color: T.textMuted,
                          fontSize: textSize("caption"),
                          letterSpacing: "0.04em",
                          textTransform: "uppercase",
                          fontWeight: FONT_WEIGHTS.medium,
                        }}
                      >
                        Quick Add
                      </span>
                    </button>
                  ))}
              {deferredAddQuery.length > 0 &&
              !addSymbolSearch.isPending &&
              !(addSymbolSearch.data?.results || []).length ? (
                <div
                  style={{
                    padding: sp("12px 8px"),
                    color: T.textDim,
                    fontFamily: T.sans,
                    fontSize: textSize("caption"),
                  }}
                >
                  No matching symbols.
                </div>
              ) : null}
            </div>
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
      {...rest}
    />
  );
};

export const MemoWatchlistContainer = memo(WatchlistContainer);
