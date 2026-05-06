import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ensureTradeTickerInfo,
  useRuntimeTickerSnapshot,
} from "../platform/runtimeTickerStore";
import {
  daysToExpiration,
  fmtCompactNumber,
  getAtmStrikeFromPrice,
  isFiniteNumber,
} from "../../lib/formatters";
import {
  resolveTradeOptionChainSnapshot,
  useTradeOptionChainSnapshot,
} from "../platform/tradeOptionChainStore";
import {
  getStoredOptionQuoteSnapshot,
  useStoredOptionQuoteSnapshotVersion,
} from "../platform/live-streams";
import { patchOptionChainRowWithQuoteGetter } from "./optionChainRows";
import { MarketIdentityInline } from "../platform/marketIdentity";
import {
  MISSING_VALUE,
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
import { AppTooltip } from "@/components/ui/tooltip";


const ROW_HEIGHT = 24;
const HEADER_HEIGHT = 28;
const STRIKE_WIDTH = 78;
const VIRTUAL_OVERSCAN_ROWS = 12;

const CALL_COLUMNS = [
  { key: "cBid", label: "Call Bid", type: "price", width: 92 },
  { key: "cAsk", label: "Call Ask", type: "price", width: 92 },
  { key: "cPrem", label: "Call Last", type: "price", heldAware: true, width: 96 },
  { key: "cVol", label: "Call Volume", type: "volume", width: 118 },
  { key: "cOi", label: "Call Open Interest", type: "volume", width: 154 },
  { key: "cIv", label: "Call IV", type: "iv", width: 84 },
  { key: "cDelta", label: "Call Delta", type: "delta", width: 98 },
  { key: "cGamma", label: "Call Gamma", type: "greek", width: 104 },
  { key: "cTheta", label: "Call Theta", type: "greek", width: 102 },
  { key: "cVega", label: "Call Vega", type: "greek", width: 96 },
];

const PUT_COLUMNS = [
  { key: "pBid", label: "Put Bid", type: "price", width: 88 },
  { key: "pAsk", label: "Put Ask", type: "price", width: 88 },
  { key: "pPrem", label: "Put Last", type: "price", heldAware: true, width: 92 },
  { key: "pVol", label: "Put Volume", type: "volume", width: 112 },
  { key: "pOi", label: "Put Open Interest", type: "volume", width: 148 },
  { key: "pIv", label: "Put IV", type: "iv", width: 80 },
  { key: "pDelta", label: "Put Delta", type: "delta", width: 92 },
  { key: "pGamma", label: "Put Gamma", type: "greek", width: 100 },
  { key: "pTheta", label: "Put Theta", type: "greek", width: 98 },
  { key: "pVega", label: "Put Vega", type: "greek", width: 92 },
];

const buildColumnGrid = (columns) =>
  columns
    .map((column) => `minmax(${dim(column.width || 96)}px, 1fr)`)
    .join(" ");

const getSideMinWidth = (columns) =>
  columns.reduce((total, column) => total + (column.width || 96), 0);

const formatPrice = (value, held = false) => {
  if (!isFiniteNumber(value)) {
    return MISSING_VALUE;
  }
  return `${held ? "H " : ""}${value.toFixed(2)}`;
};

const formatGreek = (value) =>
  isFiniteNumber(value) ? value.toFixed(3) : MISSING_VALUE;

const formatDelta = (value) =>
  isFiniteNumber(value) ? value.toFixed(2) : MISSING_VALUE;

const formatIv = (value) =>
  isFiniteNumber(value) ? `${(value * 100).toFixed(1)}%` : MISSING_VALUE;

const formatCellValue = (row, column, held) => {
  const value = row[column.key];
  if (column.type === "price") {
    return formatPrice(value, held && column.heldAware);
  }
  if (column.type === "volume") {
    return fmtCompactNumber(value);
  }
  if (column.type === "iv") {
    return formatIv(value);
  }
  if (column.type === "delta") {
    return formatDelta(value);
  }
  return formatGreek(value);
};

const normalizeFreshness = (value, fallback = "metadata") => {
  if (
    value === "live" ||
    value === "delayed" ||
    value === "frozen" ||
    value === "delayed_frozen" ||
    value === "stale" ||
    value === "metadata" ||
    value === "unavailable" ||
    value === "pending"
  ) {
    return value;
  }
  return fallback;
};

const formatFreshnessLabel = (value) => {
  const freshness = normalizeFreshness(value, "unavailable");
  return freshness === "delayed_frozen"
    ? "delayed frozen"
    : freshness;
};

const getRowSideFreshness = (row, side) =>
  normalizeFreshness(row?.[side === "C" ? "cFreshness" : "pFreshness"]);

const doesExpirationOptionMatchValue = (option, value) =>
  Boolean(
    value &&
      option &&
      (option.value === value ||
        option.chainKey === value ||
        option.isoDate === value ||
        option.legacyValue === value ||
        option.label === value),
  );

const hexToRgb = (value) => {
  const normalized = String(value || "").replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return null;
  }
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
};

const rgba = (hex, alpha) => {
  const rgb = hexToRgb(hex);
  if (!rgb) {
    return "transparent";
  }
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
};

const normalizeLogValue = (value, maxValue) => {
  if (!isFiniteNumber(value) || value <= 0 || maxValue <= 0) {
    return 0;
  }
  return Math.log1p(value) / Math.log1p(maxValue);
};

export const buildHeatmapModel = (chain) => {
  const maxima = chain.reduce(
    (next, row) => ({
      cPrem: Math.max(next.cPrem, row.cPrem || 0),
      pPrem: Math.max(next.pPrem, row.pPrem || 0),
    }),
    {
      cPrem: 0,
      pPrem: 0,
    },
  );

  return {
    intensity(row, side) {
      const prefix = side === "C" ? "c" : "p";
      return normalizeLogValue(
        row[`${prefix}Prem`],
        maxima[`${prefix}Prem`],
      );
    },
  };
};

const ChainStatePanel = ({
  title,
  detail,
  loading = false,
  actionLabel = null,
  onAction = null,
  tone = T.textSec,
}) => (
  <div
    className={loading ? "ra-scan-sweep" : "ra-panel-enter"}
    style={{
      width: "100%",
      height: "100%",
      minHeight: dim(120),
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: sp(10),
      color: T.textDim,
      fontFamily: T.sans,
      background: T.bg0,
      border: `1px dashed ${T.border}`,
      borderRadius: dim(4),
    }}
  >
    <style>
      {"@keyframes tradeChainSpin { to { transform: rotate(360deg); } }"}
    </style>
    {loading ? (
      <span
        data-testid="loading-spinner"
        role="status"
        aria-label="Loading"
        style={{
          width: dim(18),
          height: dim(18),
          borderRadius: "50%",
          border: `2px solid ${T.border}`,
          borderTopColor: T.accent,
          animation: "tradeChainSpin 900ms linear infinite",
          flexShrink: 0,
        }}
      />
    ) : null}
    <span style={{ display: "flex", flexDirection: "column", gap: sp(2) }}>
      <span
        style={{
          fontSize: fs(10),
          fontWeight: 700,
          color: tone,
        }}
      >
        {title}
      </span>
      <span style={{ fontSize: fs(9), fontFamily: T.mono }}>{detail}</span>
    </span>
    {actionLabel && onAction ? (
      <button
        type="button"
        onClick={onAction}
        style={{
          border: `1px solid ${T.border}`,
          background: T.bg3,
          color: T.textSec,
          borderRadius: dim(4),
          padding: sp("4px 8px"),
          fontSize: fs(9),
          fontFamily: T.mono,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        {actionLabel}
      </button>
    ) : null}
  </div>
);

const ChainRefreshSpinner = () => (
  <>
    <style>
      {"@keyframes tradeChainSpin { to { transform: rotate(360deg); } }"}
    </style>
    <span
      data-testid="chain-refreshing-spinner"
      role="status"
      aria-label="Refreshing option chain"
      className="ra-status-pulse"
      style={{
        width: dim(12),
        height: dim(12),
        borderRadius: "50%",
        border: `2px solid ${T.border}`,
        borderTopColor: T.amber,
        animation: "tradeChainSpin 900ms linear infinite",
        flexShrink: 0,
      }}
    />
  </>
);

const ChainSide = forwardRef(function ChainSide({
  side,
  chain,
  columns,
  selected,
  heldContracts,
  heatmapEnabled,
  heatmapModel,
  atmStrike,
  onSelect,
  onHorizontalScroll,
  topPadding = 0,
  bottomPadding = 0,
}, scrollRef) {
  const sideColor = side === "C" ? T.green : T.red;
  const gridTemplateColumns = buildColumnGrid(columns);
  const sideMinWidth = getSideMinWidth(columns);

  return (
    <div
      ref={scrollRef}
      onScroll={onHorizontalScroll}
      style={{ minWidth: 0, overflowX: "auto", overflowY: "visible" }}
    >
      <div style={{ minWidth: dim(sideMinWidth) }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns,
            minHeight: dim(HEADER_HEIGHT),
            alignItems: "center",
            position: "sticky",
            top: 0,
            zIndex: 2,
            background: T.bg2,
            borderBottom: `1px solid ${T.border}`,
            boxShadow: `0 1px 0 ${T.border}`,
          }}
        >
          {columns.map((column) => (
            <AppTooltip key={column.key} content={column.label}><span
              key={column.key}
              style={{
                padding: sp("0 6px"),
                color: T.textMuted,
                fontSize: fs(8),
                fontWeight: 700,
                fontFamily: T.sans,
                textAlign: side === "C" ? "right" : "left",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {column.label}
            </span></AppTooltip>
          ))}
        </div>
        {topPadding > 0 ? (
          <div aria-hidden="true" style={{ height: dim(topPadding) }} />
        ) : null}
        {chain.map((row, rowIndex) => {
          const held = heldContracts.some(
            (holding) => holding.strike === row.k && holding.cp === side,
          );
          const selectedSide =
            selected?.strike === row.k && selected?.cp === side;
          const isAtmRow = isFiniteNumber(atmStrike)
            ? row.k === atmStrike
            : row.isAtm;
          const heatIntensity = heatmapEnabled
            ? heatmapModel.intensity(row, side)
            : 0;
          const heatAlpha = heatIntensity > 0 ? 0.04 + heatIntensity * 0.30 : 0;
          const rowBackground = selectedSide
            ? rgba(sideColor, 0.22)
            : heatmapEnabled && heatAlpha > 0
              ? rgba(sideColor, heatAlpha)
              : isAtmRow
                ? rgba(T.amber, 0.08)
                : "transparent";

          return (
            <div
              key={`${side}:${row.k}`}
              className={joinMotionClasses(
                "ra-row-enter",
                "ra-interactive",
                (selectedSide || isAtmRow) && "ra-focus-rail",
              )}
              onClick={() => onSelect(row.k, side)}
              style={{
                ...motionRowStyle(rowIndex, 5, 90),
                ...motionVars({
                  accent: selectedSide ? sideColor : isAtmRow ? T.amber : sideColor,
                }),
                display: "grid",
                gridTemplateColumns,
                minHeight: dim(ROW_HEIGHT),
                alignItems: "center",
                cursor: "pointer",
                background: rowBackground,
                borderBottom: `1px solid ${T.border}12`,
                boxShadow: held ? `inset 0 0 0 1px ${T.amber}55` : "none",
              }}
            >
              {columns.map((column) => (
                <AppTooltip key={column.key} content={`${column.label} / ${formatFreshnessLabel(
                    getRowSideFreshness(row, side),
                  )}`}><span
                  key={column.key}
                  style={{
                    padding: sp("0 6px"),
                    color:
                      column.type === "price"
                        ? sideColor
                        : held && column.heldAware
                          ? T.amber
                          : T.textSec,
                    fontSize: fs(9),
                    fontWeight:
                      selectedSide || column.type === "price" ? 700 : 500,
                    fontFamily: T.mono,
                    textAlign: side === "C" ? "right" : "left",
                    whiteSpace: "nowrap",
                  }}
                >
                  {formatCellValue(row, column, held)}
                </span></AppTooltip>
              ))}
            </div>
          );
        })}
        {bottomPadding > 0 ? (
          <div aria-hidden="true" style={{ height: dim(bottomPadding) }} />
        ) : null}
      </div>
    </div>
  );
});

const StrikeColumn = ({
  chain,
  atmStrike,
  topPadding = 0,
  bottomPadding = 0,
}) => (
  <div
    style={{
      width: dim(STRIKE_WIDTH),
      borderLeft: `1px solid ${T.border}`,
      borderRight: `1px solid ${T.border}`,
      background: T.bg1,
      flexShrink: 0,
    }}
  >
    <div
      style={{
        minHeight: dim(HEADER_HEIGHT),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "sticky",
        top: 0,
        zIndex: 3,
        background: T.bg2,
        borderBottom: `1px solid ${T.border}`,
        color: T.textMuted,
        fontSize: fs(8),
        fontFamily: T.sans,
        fontWeight: 800,
      }}
    >
      Strike
    </div>
    {topPadding > 0 ? (
      <div aria-hidden="true" style={{ height: dim(topPadding) }} />
    ) : null}
    {chain.map((row) => {
      const isAtmRow = isFiniteNumber(atmStrike)
        ? row.k === atmStrike
        : row.isAtm;
      return (
        <div
          key={`strike:${row.k}`}
          style={{
            minHeight: dim(ROW_HEIGHT),
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderBottom: `1px solid ${T.border}12`,
            background: isAtmRow ? rgba(T.amber, 0.16) : "transparent",
            color: isAtmRow ? T.amber : T.text,
            fontFamily: T.mono,
            fontSize: fs(10),
            fontWeight: 800,
          }}
        >
          {row.k}
        </div>
      );
    })}
    {bottomPadding > 0 ? (
      <div aria-hidden="true" style={{ height: dim(bottomPadding) }} />
    ) : null}
  </div>
);

export const TradeChainPanel = ({
  ticker,
  contract,
  chainRows = [],
  expirations = [],
  onSelectContract,
  onChangeExp,
  onRetryExpiration,
  heldContracts = [],
  chainStatus = "empty",
  heatmapEnabled = false,
  onToggleHeatmap,
  chainCoverageValue = 5,
  chainCoverageOptions = [5, 10, 15, 20, "all"],
  onChangeChainCoverage,
  onVisibleRowsChange,
}) => {
  const fallback = useMemo(
    () => ensureTradeTickerInfo(ticker, ticker),
    [ticker],
  );
  const info = useRuntimeTickerSnapshot(ticker, fallback);
  const identityItem = useMemo(
    () => ({ ticker, name: info?.name || ticker }),
    [info?.name, ticker],
  );
  const chainSnapshot = useTradeOptionChainSnapshot(ticker);
  const {
    expirationOptions: snapshotExpirationOptions,
    resolvedExpiration,
    chainRows: snapshotChainRows,
    chainStatus: snapshotChainStatus,
    loadedExpirationCount,
    completedExpirationCount,
    emptyExpirationCount,
    failedExpirationCount,
    totalExpirationCount,
    resolvedExpirationStatus,
    isResolvedExpirationLoading,
    isResolvedExpirationRefreshing,
    isResolvedExpirationStale,
  } = resolveTradeOptionChainSnapshot(chainSnapshot, contract.exp);
  const expirationOptions = expirations.length
    ? expirations
    : snapshotExpirationOptions;
  const chain = chainRows.length ? chainRows : snapshotChainRows;
  const scrollRef = useRef(null);
  const callSideScrollRef = useRef(null);
  const putSideScrollRef = useRef(null);
  const syncingSideScrollRef = useRef(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const resolvedChainStatus =
    chainRows.length || chainStatus !== "empty" ? chainStatus : snapshotChainStatus;
  const atmStrike = useMemo(() => {
    if (!chain.length) {
      return null;
    }

    if (isFiniteNumber(info?.price)) {
      return chain.reduce(
        (closest, row) =>
          Math.abs(row.k - info.price) < Math.abs(closest - info.price)
            ? row.k
            : closest,
        chain[0].k,
      );
    }

    return chain.find((row) => row.isAtm)?.k ?? chain[0].k;
  }, [chain, info?.price]);
  const hasExpirationOptions = expirationOptions.length > 0;
  const fallbackExpirationOptions = hasExpirationOptions
    ? expirationOptions
    : [
        {
          value: "",
          label: resolvedChainStatus === "loading" ? "Loading" : "No expirations",
          dte: 0,
        },
      ];
  const expInfo =
    fallbackExpirationOptions.find((option) =>
      doesExpirationOptionMatchValue(option, contract.exp),
    ) ||
    resolvedExpiration ||
    fallbackExpirationOptions[0] || {
      value: contract.exp,
      label: contract.exp,
      dte: daysToExpiration(contract.exp),
    };
  const heldForExpiration = heldContracts.filter(
    (holding) => doesExpirationOptionMatchValue(expInfo, holding.exp),
  );
  const heatmapModel = useMemo(
    () => buildHeatmapModel(chain),
    [chain],
  );
  const syncSideHorizontalScroll = useCallback((sourceSide) => {
    if (syncingSideScrollRef.current) {
      return;
    }

    const source =
      sourceSide === "C" ? callSideScrollRef.current : putSideScrollRef.current;
    const target =
      sourceSide === "C" ? putSideScrollRef.current : callSideScrollRef.current;
    if (!source || !target) {
      return;
    }

    const sourceMax = Math.max(0, source.scrollWidth - source.clientWidth);
    const targetMax = Math.max(0, target.scrollWidth - target.clientWidth);
    const nextScrollLeft =
      sourceMax > 0 ? (source.scrollLeft / sourceMax) * targetMax : 0;
    if (Math.abs(target.scrollLeft - nextScrollLeft) < 1) {
      return;
    }

    syncingSideScrollRef.current = true;
    target.scrollLeft = nextScrollLeft;
    const clearSyncFlag = () => {
      syncingSideScrollRef.current = false;
    };
    if (typeof window !== "undefined" && window.requestAnimationFrame) {
      window.requestAnimationFrame(clearSyncFlag);
    } else {
      clearSyncFlag();
    }
  }, []);
  const handleCallHorizontalScroll = useCallback(
    () => syncSideHorizontalScroll("C"),
    [syncSideHorizontalScroll],
  );
  const handlePutHorizontalScroll = useCallback(
    () => syncSideHorizontalScroll("P"),
    [syncSideHorizontalScroll],
  );
  const selectedCenterStrike = contract.strike ?? atmStrike;
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !chain.length) {
      return;
    }

    const updateViewportHeight = () => {
      setViewportHeight(element.clientHeight || 0);
    };
    updateViewportHeight();

    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(updateViewportHeight);
      observer.observe(element);
      return () => observer.disconnect();
    }

    if (typeof window !== "undefined") {
      window.addEventListener("resize", updateViewportHeight);
      return () => window.removeEventListener("resize", updateViewportHeight);
    }
    return undefined;
  }, [chain.length]);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !chain.length) {
      return;
    }

    const selectedIndex = chain.findIndex((row) => row.k === selectedCenterStrike);
    const atmIndex = chain.findIndex((row) =>
      isFiniteNumber(atmStrike) ? row.k === atmStrike : row.isAtm,
    );
    const targetIndex = selectedIndex >= 0 ? selectedIndex : atmIndex;
    if (targetIndex < 0) {
      return;
    }

    const rowTop = HEADER_HEIGHT + targetIndex * ROW_HEIGHT;
    const rowBottom = rowTop + ROW_HEIGHT;
    const visibleTop = element.scrollTop;
    const visibleBottom = visibleTop + element.clientHeight;
    if (rowTop >= visibleTop && rowBottom <= visibleBottom) {
      return;
    }

    element.scrollTop = Math.max(
      0,
      rowTop - Math.max(ROW_HEIGHT * 6, (element.clientHeight - ROW_HEIGHT) / 2),
    );
    setScrollTop(element.scrollTop);
  }, [atmStrike, chain.length, expInfo?.value, selectedCenterStrike]);
  const rowScrollTop = Math.max(0, scrollTop - HEADER_HEIGHT);
  const visibleStartIndex = Math.max(
    0,
    Math.floor(rowScrollTop / ROW_HEIGHT) - VIRTUAL_OVERSCAN_ROWS,
  );
  const visibleRowCount = Math.max(
    1,
    Math.ceil(Math.max(0, viewportHeight - HEADER_HEIGHT) / ROW_HEIGHT) +
      VIRTUAL_OVERSCAN_ROWS * 2,
  );
  const visibleEndIndex = Math.min(
    chain.length,
    visibleStartIndex + visibleRowCount,
  );
  const visibleChain = chain.slice(visibleStartIndex, visibleEndIndex);
  const selectedChainRowBase =
    chain.find((row) => row.k === contract?.strike) ||
    chain.find((row) => row.isAtm) ||
    null;
  const visibleQuoteProviderContractIds = useMemo(
    () =>
      visibleChain
        .flatMap((row) => [
          row.cContract?.providerContractId,
          row.pContract?.providerContractId,
          selectedChainRowBase?.cContract?.providerContractId,
          selectedChainRowBase?.pContract?.providerContractId,
        ])
        .filter(Boolean),
    [selectedChainRowBase, visibleChain],
  );
  const visibleQuoteVersion = useStoredOptionQuoteSnapshotVersion(
    visibleQuoteProviderContractIds,
  );
  const liveVisibleChain = useMemo(
    () =>
      visibleChain.map((row) =>
        patchOptionChainRowWithQuoteGetter(row, getStoredOptionQuoteSnapshot),
      ),
    [visibleChain, visibleQuoteVersion],
  );
  const selectedChainRow = useMemo(
    () =>
      selectedChainRowBase
        ? patchOptionChainRowWithQuoteGetter(
            selectedChainRowBase,
            getStoredOptionQuoteSnapshot,
          )
        : null,
    [selectedChainRowBase, visibleQuoteVersion],
  );
  useEffect(() => {
    onVisibleRowsChange?.(visibleChain);
  }, [onVisibleRowsChange, visibleChain]);
  const topPadding = visibleStartIndex * ROW_HEIGHT;
  const bottomPadding = Math.max(0, (chain.length - visibleEndIndex) * ROW_HEIGHT);
  const atmRow =
    chain.find((row) => row.k === atmStrike) ||
    chain.find((row) => row.isAtm);
  const impMove =
    atmRow && isFiniteNumber(atmRow.cPrem) && isFiniteNumber(atmRow.pPrem)
      ? (atmRow.cPrem + atmRow.pPrem) * 0.85
      : null;
  const impPct =
    impMove != null && isFiniteNumber(info?.price) && info.price > 0
      ? (impMove / info.price) * 100
      : null;
  const progressDetail =
    totalExpirationCount > 0
      ? [
          `${completedExpirationCount}/${totalExpirationCount} done`,
          `${loadedExpirationCount} loaded`,
          emptyExpirationCount ? `${emptyExpirationCount} empty` : null,
          failedExpirationCount ? `${failedExpirationCount} failed` : null,
        ]
          .filter(Boolean)
          .join(" / ")
      : "waiting for expirations";
  const selectedExpirationStatus = chain.length
    ? "loaded"
    : resolvedExpirationStatus || "empty";
  const selectedDataFreshness = getRowSideFreshness(
    selectedChainRow,
    contract?.cp === "P" ? "P" : "C",
  );
  const showLoading =
    !chain.length &&
    (selectedExpirationStatus === "loading" ||
      isResolvedExpirationLoading ||
      (selectedExpirationStatus === "empty" &&
        resolvedChainStatus === "loading" &&
        completedExpirationCount === 0));
  let statusLabel = progressDetail;
  let statusColor = T.textDim;
  if (isResolvedExpirationRefreshing && isResolvedExpirationStale) {
    statusLabel = "refreshing stale";
    statusColor = T.amber;
  } else if (isResolvedExpirationRefreshing) {
    statusLabel = "refreshing";
    statusColor = T.amber;
  } else if (isResolvedExpirationStale) {
    statusLabel = "stale chain";
    statusColor = T.amber;
  } else if (
    chain.length &&
    selectedDataFreshness &&
    selectedDataFreshness !== "live"
  ) {
    statusLabel = `${formatFreshnessLabel(selectedDataFreshness)} data`;
    statusColor =
      selectedDataFreshness === "metadata" ||
      selectedDataFreshness === "unavailable"
        ? T.textDim
        : T.amber;
  } else if (resolvedChainStatus === "live") {
    statusLabel = "live";
    statusColor = T.accent;
  } else if (selectedExpirationStatus === "failed") {
    statusLabel = "selected failed";
    statusColor = T.red;
  } else if (showLoading) {
    statusLabel = "loading selected";
    statusColor = T.amber;
  } else if (selectedExpirationStatus === "empty") {
    statusLabel = "selected empty";
  } else if (selectedExpirationStatus === "queued") {
    statusLabel = "queued selected";
    statusColor = T.amber;
  }
  const emptyChainState = (() => {
    if (showLoading) {
      return {
        title: "Loading option chain",
        detail: selectedExpirationStatus === "loading"
          ? "selected expiration"
          : progressDetail,
        loading: true,
        tone: T.amber,
      };
    }
    if (selectedExpirationStatus === "queued") {
      return {
        title: "Queued option chain",
        detail: progressDetail,
        loading: true,
        tone: T.amber,
      };
    }
    if (selectedExpirationStatus === "failed") {
      return {
        title: "Option chain failed",
        detail: "Retry this expiration or choose another expiration.",
        actionLabel: onRetryExpiration ? "Retry" : null,
        onAction: onRetryExpiration ? () => onRetryExpiration(expInfo) : null,
        tone: T.red,
      };
    }
    if (selectedExpirationStatus === "empty") {
      return {
        title: "No contracts returned",
        detail: "The provider returned no contracts for this expiration.",
        actionLabel: onRetryExpiration ? "Retry" : null,
        onAction: onRetryExpiration ? () => onRetryExpiration(expInfo) : null,
        tone: T.textSec,
      };
    }
    return {
      title: "No live option chain",
      detail: `The ${ticker} chain is waiting for quotes and greeks.`,
      tone: T.textSec,
    };
  })();

  return (
    <div
      data-testid="trade-options-chain-panel"
      className="ra-panel-enter"
      style={{
        background: T.bg2,
        border: `1px solid ${T.border}`,
        borderRadius: dim(6),
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        height: "100%",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: sp("6px 10px"),
          borderBottom: `1px solid ${T.border}`,
          gap: sp(8),
          flexShrink: 0,
        }}
      >
        <MarketIdentityInline
          item={identityItem}
          size={16}
          showChips={false}
          style={{ minWidth: 0 }}
        />
        <span
          style={{
            fontSize: fs(10),
            fontWeight: 700,
            fontFamily: T.display,
            color: T.textSec,
          }}
        >
          OPTIONS CHAIN
        </span>
        <select
          value={expInfo.value}
          onChange={(event) => {
            if (event.target.value) {
              onChangeExp(event.target.value);
            }
          }}
          disabled={!hasExpirationOptions}
          style={{
            background: T.bg3,
            border: `1px solid ${T.border}`,
            color: hasExpirationOptions ? T.text : T.textDim,
            fontSize: fs(9),
            fontFamily: T.mono,
            fontWeight: 600,
            cursor: hasExpirationOptions ? "pointer" : "default",
            padding: sp("2px 6px"),
            borderRadius: dim(3),
            outline: "none",
          }}
        >
          {fallbackExpirationOptions.map((expiration) => (
            <option key={expiration.value} value={expiration.value}>
              {expiration.label} / {expiration.dte}d
            </option>
          ))}
        </select>
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: sp(4),
            fontSize: fs(9),
            color: heatmapEnabled ? T.amber : T.textDim,
            fontFamily: T.mono,
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={heatmapEnabled}
            onChange={onToggleHeatmap}
            style={{ width: dim(12), height: dim(12), margin: 0 }}
          />
          Heatmap
        </label>
        <select
          aria-label="Option chain strike coverage"
          value={String(chainCoverageValue)}
          onChange={(event) => onChangeChainCoverage?.(event.target.value)}
          style={{
            background: T.bg3,
            border: `1px solid ${T.border}`,
            color: T.textSec,
            fontSize: fs(9),
            fontFamily: T.mono,
            fontWeight: 700,
            cursor: onChangeChainCoverage ? "pointer" : "default",
            padding: sp("2px 6px"),
            borderRadius: dim(3),
            outline: "none",
          }}
        >
          {chainCoverageOptions.map((option) => (
            <option key={String(option)} value={String(option)}>
              {option === "all" ? "All strikes" : `${option} each side`}
            </option>
          ))}
        </select>
        <span style={{ flex: 1 }} />
        {isResolvedExpirationRefreshing ? <ChainRefreshSpinner /> : null}
        <span style={{ fontSize: fs(9), fontFamily: T.mono, color: T.textDim }}>
          IMP{" "}
          <span style={{ color: impMove != null ? T.cyan : T.textDim, fontWeight: 700 }}>
            {impMove != null ? `+/-$${impMove.toFixed(2)}` : MISSING_VALUE}
          </span>{" "}
          {impPct != null ? `(${impPct.toFixed(2)}%)` : ""}
        </span>
        <span style={{ fontSize: fs(9), fontFamily: T.mono, color: T.textDim }}>
          ATM{" "}
          <span style={{ color: T.accent, fontWeight: 700 }}>
            {atmStrike ?? getAtmStrikeFromPrice(info?.price) ?? MISSING_VALUE}
          </span>
        </span>
        <span
          className={isResolvedExpirationRefreshing || showLoading ? "ra-status-pulse" : undefined}
          style={{
            fontSize: fs(8),
            color: statusColor,
            fontFamily: T.mono,
            fontWeight: 700,
          }}
        >
          {statusLabel}
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        {chain.length ? (
          <div
            ref={scrollRef}
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
            style={{
              height: "100%",
              overflowY: "auto",
              overflowX: "hidden",
              position: "relative",
              display: "grid",
              gridTemplateColumns: `minmax(0, 1fr) ${dim(STRIKE_WIDTH)}px minmax(0, 1fr)`,
              fontFamily: T.mono,
              fontSize: fs(9),
            }}
          >
            <ChainSide
              ref={callSideScrollRef}
              side="C"
              chain={liveVisibleChain}
              columns={CALL_COLUMNS}
              selected={{ strike: contract.strike, cp: contract.cp }}
              heldContracts={heldForExpiration}
              heatmapEnabled={heatmapEnabled}
              heatmapModel={heatmapModel}
              atmStrike={atmStrike}
              onSelect={onSelectContract}
              onHorizontalScroll={handleCallHorizontalScroll}
              topPadding={topPadding}
              bottomPadding={bottomPadding}
            />
            <StrikeColumn
              chain={liveVisibleChain}
              atmStrike={atmStrike}
              topPadding={topPadding}
              bottomPadding={bottomPadding}
            />
            <ChainSide
              ref={putSideScrollRef}
              side="P"
              chain={liveVisibleChain}
              columns={PUT_COLUMNS}
              selected={{ strike: contract.strike, cp: contract.cp }}
              heldContracts={heldForExpiration}
              heatmapEnabled={heatmapEnabled}
              heatmapModel={heatmapModel}
              atmStrike={atmStrike}
              onSelect={onSelectContract}
              onHorizontalScroll={handlePutHorizontalScroll}
              topPadding={topPadding}
              bottomPadding={bottomPadding}
            />
          </div>
        ) : (
          <ChainStatePanel {...emptyChainState} />
        )}
      </div>
    </div>
  );
};

export default TradeChainPanel;
