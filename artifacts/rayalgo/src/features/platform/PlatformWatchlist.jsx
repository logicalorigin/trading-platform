import { useSearchUniverseTickers } from "@workspace/api-client-react";
import { ChevronDown, GripVertical, Plus, Search, SlidersHorizontal, Trash2, X } from "lucide-react";
import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { BottomSheet } from "../../components/platform/BottomSheet.jsx";
import { MISSING_VALUE, RADII, T, dim, fs, sp } from "../../lib/uiTokens";
import {
  fmtCompactNumber,
  formatQuotePrice,
  formatRelativeTimeShort,
  formatSignedPercent,
  isFiniteNumber,
} from "../../lib/formatters";
import {
  joinMotionClasses,
  motionRowStyle,
  motionVars,
  useValueFlash,
} from "../../lib/motion.jsx";
import { INDICES, MACRO_TICKERS, WATCHLIST } from "../market/marketReferenceData";
import { buildFallbackWatchlistItem } from "./runtimeMarketDataModel";
import { useRuntimeTickerSnapshot, useRuntimeTickerSnapshots } from "./runtimeTickerStore";
import { MarketIdentityChips, MarketIdentityMark } from "./marketIdentity";
import { useSignalMonitorStateForSymbol } from "./signalMonitorStore";
import { normalizeTickerSymbol } from "./tickerIdentity";
import {
  WATCHLIST_SORT_MODE,
  WATCHLIST_SIGNAL_TIMEFRAMES,
  buildSignalMatrixBySymbol,
  buildWatchlistRows,
  countWatchlistSymbols,
  getBestWatchlistSignalState,
  sortWatchlistRows,
} from "./watchlistModel";
import { AppTooltip } from "@/components/ui/tooltip";


const extractSparklineValues = (data = []) =>
  (Array.isArray(data) ? data : [])
    .map((point) => {
      if (typeof point === "number" && Number.isFinite(point)) {
        return point;
      }
      if (typeof point?.close === "number" && Number.isFinite(point.close)) {
        return point.close;
      }
      if (typeof point?.c === "number" && Number.isFinite(point.c)) {
        return point.c;
      }
      if (typeof point?.v === "number" && Number.isFinite(point.v)) {
        return point.v;
      }
      return null;
    })
    .filter((value) => Number.isFinite(value));

const MicroSparkline = ({ data = [], positive = null, width = 64, height = 24 }) => {
  const values = useMemo(() => extractSparklineValues(data), [data]);

  if (values.length < 2) {
    return null;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = width / Math.max(values.length - 1, 1);
  const inferredPositive = values[values.length - 1] >= values[0];
  const resolvedPositive =
    typeof positive === "boolean" ? positive : inferredPositive;
  const lineColor = resolvedPositive ? T.green : T.red;
  const plottedPoints = values.map((value, index) => {
    const x = index * step;
    const y = height - ((value - min) / range) * Math.max(height - 2, 1) - 1;
    return [x.toFixed(2), y.toFixed(2)];
  });
  const points = plottedPoints.map(([x, y]) => `${x},${y}`).join(" ");
  const areaPath = `M ${plottedPoints
    .map(([x, y], index) => `${index === 0 ? "" : "L "}${x},${y}`)
    .join(" ")} L ${width},${height} L 0,${height} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ display: "block" }}
    >
      <path d={areaPath} fill={`${lineColor}1f`} />
      <polyline
        points={points}
        fill="none"
        stroke={lineColor}
        strokeWidth="1.55"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
};

const fmtQuoteVolume = (value) =>
  value == null || Number.isNaN(value) ? MISSING_VALUE : fmtCompactNumber(value);

const formatSignedPrice = (value, digits = 2) => {
  if (!isFiniteNumber(value)) return MISSING_VALUE;
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(digits)}`;
};
const WATCHLIST_SORT_OPTIONS = [
  { id: WATCHLIST_SORT_MODE.MANUAL, label: "Manual" },
  { id: WATCHLIST_SORT_MODE.SIGNAL, label: "Signal" },
  { id: WATCHLIST_SORT_MODE.PERCENT, label: "% Chg" },
  { id: WATCHLIST_SORT_MODE.VOLUME, label: "Volume" },
  { id: WATCHLIST_SORT_MODE.ALPHA, label: "A-Z" },
];

const WATCHLIST_DIRECTION_SORTS = new Set([
  WATCHLIST_SORT_MODE.PERCENT,
  WATCHLIST_SORT_MODE.VOLUME,
  WATCHLIST_SORT_MODE.ALPHA,
]);

const isWatchlistSignalDirection = (value) =>
  value === "buy" || value === "sell";

const getFallbackSignalForTimeframe = (fallbackState, timeframe) => {
  if (!fallbackState || fallbackState.timeframe !== timeframe) return null;
  return fallbackState;
};

const WatchlistSignalDots = ({ statesByTimeframe = {}, fallbackState = null, onSelect }) => (
  <span
    data-testid="watchlist-signal-dots"
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: sp(3),
      minWidth: dim(34),
    }}
  >
    {WATCHLIST_SIGNAL_TIMEFRAMES.map((timeframe) => {
      const state =
        statesByTimeframe?.[timeframe] ||
        getFallbackSignalForTimeframe(fallbackState, timeframe);
      const direction = state?.currentSignalDirection;
      const hasDirection = isWatchlistSignalDirection(direction);
      const color = direction === "buy" ? T.blue : direction === "sell" ? T.red : T.textMuted;
      const fresh = Boolean(state?.fresh);
      const status = state?.status || "unknown";
      const label = hasDirection
        ? `${timeframe} ${direction.toUpperCase()} ${fresh ? "fresh" : "stale"} - ${state?.barsSinceSignal ?? MISSING_VALUE} bars`
        : `${timeframe} no signal - ${status}`;

      return (
        <AppTooltip key={timeframe} content={state?.lastError ? `${label} - ${state.lastError}` : label}><button
          key={timeframe}
          type="button"
          data-testid={`watchlist-signal-dot-${timeframe}`}
          data-timeframe={timeframe}
          data-direction={hasDirection ? direction : "none"}
          aria-label={label}
          onClick={(event) => {
            event.stopPropagation();
            if (hasDirection) {
              onSelect?.(state);
            }
          }}
          style={{
            width: dim(7),
            height: dim(7),
            borderRadius: "50%",
            border: `1px solid ${hasDirection ? color : T.borderLight}`,
            background: hasDirection ? color : "transparent",
            opacity: hasDirection ? (fresh ? 1 : 0.42) : 0.55,
            boxShadow: hasDirection && fresh ? `0 0 0 2px ${color}20` : "none",
            cursor: hasDirection ? "pointer" : "default",
            padding: 0,
          }}
        /></AppTooltip>
      );
    })}
  </span>
);

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
    onRemoveSymbol,
    onSignalAction,
    signalStatesByTimeframe = {},
    busy = false,
    density = "default",
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
	    const displayName = item.name || snapshot?.name || fallback.name || item.sym;
    const quoteAge = formatRelativeTimeShort(
      snapshot?.updatedAt ||
        signalState?.latestBarAt ||
        signalState?.lastEvaluatedAt,
    );
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
    const activeActionDisabled = busy || !item.canRemove || !item.id;
    const rowBackground = dragging
      ? `${T.accent}10`
      : dragOver
        ? `${T.accent}18`
        : selectedRow
          ? T.bg3
          : "transparent";
    const mobileDense = density === "mobile-dense";

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
          onClick={() => onSelect?.(item.sym)}
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
            minHeight: dim(44),
            display: "grid",
            gridTemplateColumns: `minmax(${dim(58)}px, 0.9fr) minmax(${dim(64)}px, 1fr) ${dim(54)}px ${dim(38)}px ${dim(48)}px`,
            alignItems: "center",
            gap: sp(4),
            padding: sp("6px 10px"),
            border: "none",
            borderBottom: `1px solid ${T.borderLight}`,
            background:
              selectedRow || dragOver ? `${T.accent}12` : rowBackground,
            color: T.text,
            cursor: "pointer",
            textAlign: "left",
            fontFamily: T.sans,
            opacity: dragging ? 0.55 : 1,
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: sp(4),
              minWidth: 0,
            }}
          >
            <MarketIdentityMark item={identityItem} size={14} />
            <span
              className={priceFlashClassName}
              style={{
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                color: T.text,
                fontFamily: T.sans,
                fontSize: fs(11),
              }}
            >
              {item.sym}
            </span>
          </span>
          <span
            className={priceFlashClassName}
            style={{
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              color: T.text,
              fontFamily: T.sans,
              fontSize: fs(11),
              textAlign: "right",
            }}
          >
            {formatQuotePrice(priceValue)}
          </span>
          <span
            style={{
              color:
                pctPositive == null ? T.textMuted : pctPositive ? T.green : T.red,
              fontFamily: T.sans,
              fontSize: fs(10),
              textAlign: "right",
              whiteSpace: "nowrap",
            }}
          >
            {formatSignedPercent(snapshot?.pct)}
          </span>
          <WatchlistSignalDots
            statesByTimeframe={signalStatesByTimeframe}
            fallbackState={signalState}
            onSelect={(state) => onSignalAction?.(item.sym, state)}
          />
          <span
            style={{
              color: T.textMuted,
              fontFamily: T.sans,
              fontSize: fs(8),
              textAlign: "right",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {fmtQuoteVolume(snapshot?.volume)}
          </span>
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
        onClick={() => onSelect?.(item.sym)}
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
          gridTemplateColumns: `minmax(0,1fr) ${dim(54)}px`,
          gap: sp(6),
          padding: sp("8px 12px"),
          cursor: "pointer",
          alignItems: "center",
          background:
            selectedRow || dragOver ? `${T.accent}12` : rowBackground,
          borderBottom: `1px solid ${T.borderLight}`,
          opacity: dragging ? 0.55 : 1,
          transition: "background 0.18s ease, opacity 0.12s ease",
        }}
        onMouseEnter={(event) => {
          if (!selectedRow && !dragOver) event.currentTarget.style.background = T.bg2;
        }}
        onMouseLeave={(event) => {
          if (!selectedRow && !dragOver) event.currentTarget.style.background = "transparent";
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "16px 18px minmax(42px, auto) auto auto auto minmax(0, 1fr)",
              alignItems: "center",
              gap: sp(4),
              minWidth: 0,
            }}
          >
            <GripVertical
              size={13}
              strokeWidth={2}
              style={{
                color: canDrag ? T.textDim : T.textMuted,
                opacity: canDrag ? 1 : 0.35,
                cursor: canDrag ? "grab" : "default",
              }}
            />
            <MarketIdentityMark item={identityItem} size={16} />
	            <span
	              className={priceFlashClassName}
	              style={{
	                display: "inline-flex",
	                alignItems: "center",
	                fontSize: fs(12),
	                fontWeight: 400,
	                fontFamily: T.sans,
	                color: T.text,
	                overflow: "hidden",
	                textOverflow: "ellipsis",
	                whiteSpace: "nowrap",
	                padding: sp("1px 3px"),
	                borderRadius: dim(3),
	              }}
	            >
	              {item.sym}
	            </span>
            {item.monitoredOnly ? (
              <AppTooltip content="Signal-monitor symbol"><span
                style={{
                  border: "none",
                  color: T.textDim,
                  fontFamily: T.sans,
                  fontSize: fs(7),
                  fontWeight: 400,
                  lineHeight: 1,
                  padding: sp("2px 3px"),
                }}
              >
                MON
              </span></AppTooltip>
            ) : null}
            <WatchlistSignalDots
              statesByTimeframe={signalStatesByTimeframe}
              fallbackState={signalState}
              onSelect={(state) => onSignalAction?.(item.sym, state)}
            />
            {hasSignal ? (
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
                    border: `1px solid ${signalFresh ? signalColor : `${signalColor}66`}`,
                    background: signalFresh ? `${signalColor}1f` : `${signalColor}0f`,
                    color: signalFresh ? signalColor : `${signalColor}bb`,
                    cursor: "pointer",
                    fontFamily: T.sans,
                    fontSize: fs(7),
                    fontWeight: 400,
                    letterSpacing: "0.06em",
                    lineHeight: 1,
                    padding: sp("2px 3px"),
                    borderRadius: RADII.none,
                  }}
                >
                  {signalDirection.toUpperCase()}
                </button>
              </AppTooltip>
            ) : null}
	            <span
	              className={priceFlashClassName}
	              style={{
	                display: "inline-flex",
	                alignItems: "center",
	                justifyContent: "flex-end",
	                color: T.text,
	                fontFamily: T.sans,
	                fontSize: fs(11),
	                fontWeight: 400,
	                textAlign: "right",
	                justifySelf: "end",
	                minWidth: dim(52),
	                padding: sp("1px 3px"),
	                borderRadius: dim(3),
	              }}
	            >
              {formatQuotePrice(priceValue)}
            </span>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0,1fr) auto auto auto auto",
              alignItems: "center",
              gap: sp(5),
              marginTop: sp(3),
              minWidth: 0,
            }}
          >
            <AppTooltip content={displayName}><span
              style={{
                fontSize: fs(9),
                color: T.textDim,
                fontFamily: T.sans,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {displayName}
            </span></AppTooltip>
            <MarketIdentityChips
              item={identityItem}
              compact
              maxChips={2}
              showExchange={false}
              showMarket
              showSector={false}
            />
            <span
              style={{
                fontSize: fs(9),
                color:
                  pctPositive == null ? T.textMuted : pctPositive ? T.green : T.red,
                fontFamily: T.sans,
                fontWeight: 400,
                whiteSpace: "nowrap",
              }}
            >
              {formatSignedPrice(snapshot?.chg, 2)}
            </span>
            <span
              style={{
                fontSize: fs(9),
                color:
                  pctPositive == null ? T.textMuted : pctPositive ? T.green : T.red,
                fontFamily: T.sans,
                fontWeight: 400,
                whiteSpace: "nowrap",
              }}
            >
              {formatSignedPercent(snapshot?.pct)}
            </span>
            <AppTooltip content="Last quote update"><span
              style={{
                fontSize: fs(8),
                color: T.textMuted,
                fontFamily: T.sans,
                whiteSpace: "nowrap",
              }}
            >
              {quoteAge}
            </span></AppTooltip>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: sp(8),
              marginTop: sp(3),
            }}
          >
            <AppTooltip content="Volume"><span
              style={{
                color: T.textMuted,
                fontFamily: T.sans,
                fontSize: fs(8),
                whiteSpace: "nowrap",
              }}
            >
              Vol {fmtQuoteVolume(snapshot?.volume)}
            </span></AppTooltip>
            <MicroSparkline
              data={
                snapshot?.sparkBars?.length
                  ? snapshot.sparkBars
                  : snapshot?.spark || fallback.spark
              }
              positive={pctPositive}
              width={70}
              height={15}
            />
          </div>
        </div>
        <AppTooltip content={
            item.monitoredOnly
              ? `Add ${item.sym} to watchlist`
              : item.canRemove
                ? `Remove ${item.sym}`
                : `${item.sym} cannot be removed from this source`
          }><button
          type="button"
          data-testid={
            item.monitoredOnly ? "watchlist-add-symbol" : "watchlist-remove-symbol"
          }
          className="ra-interactive"
          onClick={(event) => {
            event.stopPropagation();
            if (item.monitoredOnly) {
              onAddSymbol?.(item.sym, displayName, item);
              return;
            }
            if (!activeActionDisabled) {
              onRemoveSymbol?.(item.id, item.sym);
            }
          }}
          disabled={item.monitoredOnly ? busy : activeActionDisabled}
          style={{
            width: dim(28),
            height: dim(28),
            justifySelf: "end",
            display: "grid",
            placeItems: "center",
            border: "none",
            borderRadius: RADII.none,
            background: item.monitoredOnly ? `${T.accent}10` : "transparent",
            color: item.monitoredOnly
              ? T.accent
              : activeActionDisabled
                ? T.textMuted
                : T.textDim,
            cursor:
              (item.monitoredOnly && !busy) || !activeActionDisabled
                ? "pointer"
                : "default",
          }}
        >
          {item.monitoredOnly ? <Plus size={14} /> : <Trash2 size={13} />}
        </button></AppTooltip>
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
    } else if (nextMode === WATCHLIST_SORT_MODE.PERCENT || nextMode === WATCHLIST_SORT_MODE.VOLUME) {
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
          style={{
          padding: sp("6px 7px"),
          borderBottom: `1px solid ${T.border}`,
          display: "flex",
          flexDirection: "column",
          gap: sp(4),
        }}
      >
        <div
          style={{ display: "flex", alignItems: "center", gap: sp(6), position: "relative" }}
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
              gap: sp(6),
              padding: sp("4px 7px"),
              borderRadius: RADII.none,
              background: T.bg2,
              border: "none",
              color: T.text,
              cursor: "pointer",
              fontFamily: T.sans,
              fontSize: fs(10),
              fontWeight: 400,
            }}
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
            <ChevronDown size={13} style={{ color: T.textDim, flexShrink: 0 }} />
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
                background: T.bg2,
                border: "none",
                borderRadius: RADII.none,
                boxShadow: "0 10px 24px rgba(0,0,0,0.3)",
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
                      watchlist.id === activeWatchlistId ? T.bg3 : "transparent",
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
                        fontSize: fs(10),
                        fontWeight: 400,
                        fontFamily: T.sans,
                        color: T.text,
                      }}
                    >
                      {watchlist.name}
                    </span>
                    <span
                      style={{
                        display: "block",
                        fontSize: fs(8),
                        color: T.textDim,
                        fontFamily: T.sans,
                        marginTop: sp(1),
                      }}
                    >
                      {countWatchlistSymbols(watchlist)} symbols
                    </span>
                  </span>
                  {watchlist.isDefault ? (
                    <span
                      style={{
                        color: T.green,
                        fontSize: fs(8),
                        fontFamily: T.sans,
                        fontWeight: 400,
                      }}
                    >
                      DEFAULT
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
          <AppTooltip content={mobileDense ? "Manage watchlist" : "New watchlist"}><button
            type="button"
            data-testid={mobileDense ? "watchlist-manage-toggle" : undefined}
            onClick={mobileDense ? openManageSheet : handleCreateWatchlist}
            style={{
              width: dim(26),
              height: dim(26),
              display: "grid",
              placeItems: "center",
              borderRadius: RADII.none,
              background: T.bg2,
              border: "none",
              color: T.accent,
              cursor: "pointer",
            }}
          >
            {mobileDense ? <SlidersHorizontal size={14} /> : <Plus size={14} />}
          </button></AppTooltip>
        </div>

        {!mobileDense ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: sp(3) }}>
          <button
            type="button"
            onClick={handleRenameWatchlist}
            disabled={!activeWatchlist || busy}
            style={{
              padding: sp("3px 4px"),
              borderRadius: RADII.none,
              background: "transparent",
              border: "none",
              color: T.textDim,
              cursor: activeWatchlist && !busy ? "pointer" : "default",
              fontFamily: T.sans,
              fontSize: fs(8),
              fontWeight: 400,
            }}
          >
            RENAME
          </button>
          <button
            type="button"
            onClick={() => activeWatchlist && onSetDefaultWatchlist?.(activeWatchlist.id)}
            disabled={!activeWatchlist || activeWatchlist.isDefault || busy}
            style={{
              padding: sp("3px 4px"),
              borderRadius: RADII.none,
              background: activeWatchlist?.isDefault ? `${T.green}12` : "transparent",
              border: "none",
              color: activeWatchlist?.isDefault ? T.green : T.textDim,
              cursor:
                activeWatchlist && !activeWatchlist.isDefault && !busy
                  ? "pointer"
                  : "default",
              fontFamily: T.sans,
              fontSize: fs(8),
              fontWeight: 400,
            }}
          >
            {activeWatchlist?.isDefault ? "DEFAULT" : "DEFAULT"}
          </button>
          <button
            type="button"
            onClick={handleDeleteWatchlist}
            disabled={!activeWatchlist || watchlists.length <= 1 || busy}
            style={{
              padding: sp("3px 4px"),
              borderRadius: RADII.none,
              background: "transparent",
              border: "none",
              color: watchlists.length <= 1 ? T.textMuted : T.red,
              cursor:
                activeWatchlist && watchlists.length > 1 && !busy
                  ? "pointer"
                  : "default",
              fontFamily: T.sans,
              fontSize: fs(8),
              fontWeight: 400,
            }}
          >
            DELETE
          </button>
        </div>
        ) : null}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
            gap: sp(2),
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
                  padding: sp("3px 2px"),
                  borderRadius: RADII.none,
                  background: active ? T.bg3 : "transparent",
                  border: `1px solid ${active ? T.accent : T.border}`,
                  color: active ? T.text : T.textMuted,
                  cursor: "pointer",
                  fontFamily: T.sans,
                  fontSize: fs(7),
                  fontWeight: 400,
                  whiteSpace: "nowrap",
                }}
              >
                {option.label}
              </button></AppTooltip>
            );
          })}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: sp(5) }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: sp(6),
              padding: sp("4px 7px"),
              borderRadius: RADII.none,
              background: T.bg2,
              border: "none",
              minWidth: 0,
            }}
          >
            <Search size={13} style={{ color: T.textDim, flexShrink: 0 }} />
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
                fontSize: fs(10),
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
              width: dim(44),
              borderRadius: RADII.none,
              background: directionEnabled ? T.bg2 : "transparent",
              border: "none",
              color: directionEnabled ? T.textDim : T.textMuted,
              cursor: directionEnabled ? "pointer" : "default",
              fontFamily: T.sans,
              fontSize: fs(8),
              fontWeight: 400,
            }}
          >
            {sortDirection === "desc" ? "DESC" : "ASC"}
          </button></AppTooltip>
        </div>

        {!mobileDense && addMode ? (
          <div
            data-testid="watchlist-add-panel"
            style={{
              border: "none",
              borderRadius: RADII.none,
              background: T.bg2,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: sp(6),
                padding: sp("6px 8px"),
                borderBottom: `1px solid ${T.border}`,
              }}
            >
              <input
                value={addQuery}
                onChange={(event) => setAddQuery(event.target.value)}
                placeholder="Add symbol..."
                style={{
                  flex: 1,
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  fontSize: fs(10),
                  fontFamily: T.sans,
                  color: T.text,
                }}
              />
              <AppTooltip content="Close add symbol"><button
                type="button"
                onClick={() => {
                  closeAddMode({ clearQuery: true });
                }}
                style={{
                  width: dim(22),
                  height: dim(22),
                  display: "grid",
                  placeItems: "center",
                  border: "none",
                  background: "transparent",
                  color: T.textDim,
                  cursor: "pointer",
                }}
              >
                <X size={13} />
              </button></AppTooltip>
            </div>

            <div style={{ maxHeight: dim(180), overflowY: "auto" }}>
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
                        gridTemplateColumns: `${dim(56)}px 1fr`,
                        gap: sp(8),
                        alignItems: "center",
                        padding: sp("7px 8px"),
                        background: "transparent",
                        border: "none",
                        borderBottom: `1px solid ${T.border}20`,
                        textAlign: "left",
                        cursor: "pointer",
                      }}
                    >
                      <span
                        style={{
                          fontSize: fs(10),
                          fontWeight: 400,
                          fontFamily: T.sans,
                          color: T.text,
                        }}
                      >
                        {result.ticker}
                      </span>
                      <span
                        style={{
                          fontSize: fs(9),
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
                        padding: sp("7px 8px"),
                        background: "transparent",
                        border: "none",
                        borderBottom: `1px solid ${T.border}20`,
                        cursor: "pointer",
                        fontFamily: T.sans,
                        fontSize: fs(10),
                        color: T.text,
                      }}
                    >
                      <span>{symbol}</span>
                      <span style={{ color: T.textMuted }}>QUICK ADD</span>
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
                    fontSize: fs(9),
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

      <div style={{ flex: 1, overflowY: "auto" }}>
        {sorted.map((item) => {
          const itemKey = item.key || item.id || item.sym;
          const canDrag =
            sortMode === WATCHLIST_SORT_MODE.MANUAL &&
            Boolean(item.canReorder && item.id) &&
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
              onRemoveSymbol={onRemoveSymbol}
              onSignalAction={onSignalAction}
              signalStatesByTimeframe={signalMatrixBySymbol[item.sym]}
              busy={busy}
              density={density}
            />
          );
        })}
      </div>

      <div
        style={{
          padding: sp("6px 9px"),
          borderTop: `1px solid ${T.border}`,
          fontSize: fs(9),
          color: T.textMuted,
          fontFamily: T.sans,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: sp(8),
        }}
      >
        <span>
          {sorted.length} shown
          {monitoredOnlyCount ? ` / ${monitoredOnlyCount} monitored` : ""}
        </span>
        <button
          type="button"
          data-testid="watchlist-add-toggle"
          onClick={mobileDense ? openManageSheet : toggleAddMode}
          style={{
            display: "flex",
            alignItems: "center",
            gap: sp(4),
            border: "none",
            background: "transparent",
            color: T.accent,
            cursor: "pointer",
            fontFamily: T.sans,
            fontSize: fs(9),
            fontWeight: 400,
          }}
        >
          {mobileDense ? (
            <SlidersHorizontal size={12} />
          ) : addMode ? (
            <X size={12} />
          ) : (
            <Plus size={12} />
          )}
          {mobileDense ? "MANAGE" : addMode ? "CLOSE" : "ADD"}
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
              gap: sp(5),
            }}
          >
            <button
              type="button"
              onClick={handleCreateWatchlist}
              disabled={busy}
              style={{
                minHeight: dim(38),
                border: "none",
                background: T.bg1,
                color: T.accent,
                fontFamily: T.sans,
                fontSize: fs(9),
                cursor: busy ? "default" : "pointer",
              }}
            >
              NEW
            </button>
            <button
              type="button"
              onClick={handleRenameWatchlist}
              disabled={!activeWatchlist || busy}
              style={{
                minHeight: dim(38),
                border: "none",
                background: T.bg1,
                color: T.textSec,
                fontFamily: T.sans,
                fontSize: fs(9),
                cursor: activeWatchlist && !busy ? "pointer" : "default",
              }}
            >
              RENAME
            </button>
            <button
              type="button"
              onClick={() => activeWatchlist && onSetDefaultWatchlist?.(activeWatchlist.id)}
              disabled={!activeWatchlist || activeWatchlist.isDefault || busy}
              style={{
                minHeight: dim(38),
                border: "none",
                background: activeWatchlist?.isDefault ? `${T.green}12` : T.bg1,
                color: activeWatchlist?.isDefault ? T.green : T.textSec,
                fontFamily: T.sans,
                fontSize: fs(9),
                cursor:
                  activeWatchlist && !activeWatchlist.isDefault && !busy
                    ? "pointer"
                    : "default",
              }}
            >
              DEFAULT
            </button>
            <button
              type="button"
              onClick={handleDeleteWatchlist}
              disabled={!activeWatchlist || watchlists.length <= 1 || busy}
              style={{
                minHeight: dim(38),
                border: "none",
                background: T.bg1,
                color: watchlists.length <= 1 ? T.textMuted : T.red,
                fontFamily: T.sans,
                fontSize: fs(9),
                cursor:
                  activeWatchlist && watchlists.length > 1 && !busy
                    ? "pointer"
                    : "default",
              }}
            >
              DELETE
            </button>
          </div>

          <div
            data-testid="watchlist-manage-add-panel"
            style={{
              border: "none",
              background: T.bg1,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: sp(6),
                padding: sp("7px 8px"),
                borderBottom: `1px solid ${T.border}`,
              }}
            >
              <Search size={13} style={{ color: T.textDim, flexShrink: 0 }} />
              <input
                value={addQuery}
                onChange={(event) => setAddQuery(event.target.value)}
                placeholder="Add symbol..."
                style={{
                  flex: 1,
                  minWidth: 0,
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  color: T.text,
                  fontFamily: T.sans,
                  fontSize: fs(11),
                }}
              />
            </div>
            <div style={{ maxHeight: dim(230), overflowY: "auto" }}>
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
                        minHeight: dim(38),
                        display: "grid",
                        gridTemplateColumns: `${dim(64)}px minmax(0, 1fr)`,
                        gap: sp(8),
                        alignItems: "center",
                        padding: sp("0 8px"),
                        background: "transparent",
                        border: "none",
                        borderBottom: `1px solid ${T.border}20`,
                        color: T.text,
                        textAlign: "left",
                        cursor: "pointer",
                      }}
                    >
                      <span style={{ fontFamily: T.sans, fontSize: fs(11) }}>
                        {result.ticker}
                      </span>
                      <span
                        style={{
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          color: T.textDim,
                          fontSize: fs(9),
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
                        minHeight: dim(36),
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: sp("0 8px"),
                        background: "transparent",
                        border: "none",
                        borderBottom: `1px solid ${T.border}20`,
                        color: T.text,
                        cursor: "pointer",
                        fontFamily: T.sans,
                        fontSize: fs(10),
                      }}
                    >
                      <span>{symbol}</span>
                      <span style={{ color: T.textMuted }}>QUICK ADD</span>
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
                    fontSize: fs(9),
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
