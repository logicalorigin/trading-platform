import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { useDenseVirtualRows } from "../../components/platform/DenseVirtualTable.jsx";
import { ContainerLoadingStatus } from "../../components/platform/ContainerLoadingStatus.jsx";
import { Select } from "../../components/platform/primitives.jsx";
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
import { toneForOptionSide } from "../platform/semanticToneModel.js";
import {
  getStoredOptionQuoteSnapshot,
  useStoredOptionQuoteSnapshotVersion,
} from "../platform/live-streams";
import { patchOptionChainRowWithQuoteGetter } from "./optionChainRows";
import {
  buildOptionChainRowsIdentitySignature,
  buildOptionChainVirtualEntries,
  mergeVisibleOptionChainRows,
  resolveOptionChainScrollIndex,
} from "./optionChainVirtualRows";
import { MarketIdentityInline } from "../platform/marketIdentity";
import {
  CSS_COLOR,
  cssColorMix,
  FONT_WEIGHTS,
  MISSING_VALUE,
  RADII,
  T,
  dim,
  fs,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import {
  joinMotionClasses,
  motionRowStyle,
  motionVars,
  useValueFlash,
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

const rgba = (color, alpha) =>
  color ? cssColorMix(color, alpha * 100) : "transparent";

const normalizeLogValue = (value, maxValue) => {
  if (!isFiniteNumber(value) || value <= 0 || maxValue <= 0) {
    return 0;
  }
  return Math.log1p(value) / Math.log1p(maxValue);
};

export const buildHeatmapModel = (chain) => {
  const maxima = chain.reduce(
    (next, row) => ({
      cVol: Math.max(next.cVol, row.cVol || 0),
      pVol: Math.max(next.pVol, row.pVol || 0),
      cOi: Math.max(next.cOi, row.cOi || 0),
      pOi: Math.max(next.pOi, row.pOi || 0),
    }),
    {
      cVol: 0,
      pVol: 0,
      cOi: 0,
      pOi: 0,
    },
  );

  return {
    intensity(row, side, key) {
      const prefix = side === "C" ? "c" : "p";
      const metricKey =
        key === `${prefix}Oi` || key === `${prefix}Vol`
          ? key
          : `${prefix}Vol`;
      return normalizeLogValue(
        row[metricKey],
        maxima[metricKey],
      );
    },
  };
};

const ChainStatePanel = ({
  title,
  detail,
  loading = false,
  actionLabel = null,
  loadingWaitItems = null,
  onAction = null,
  tone = CSS_COLOR.textSec,
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
      color: CSS_COLOR.textDim,
      fontFamily: T.sans,
      background: CSS_COLOR.bg0,
      border: `1px dashed ${CSS_COLOR.border}`,
      borderRadius: dim(RADII.xs),
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
          borderRadius: dim(RADII.pill),
          border: `2px solid ${CSS_COLOR.border}`,
          borderTopColor: CSS_COLOR.accent,
          animation: "tradeChainSpin 900ms linear infinite",
          flexShrink: 0,
        }}
      />
    ) : null}
    <span style={{ display: "flex", flexDirection: "column", gap: sp(2) }}>
      <span
        style={{
          fontSize: fs(10),
          fontWeight: FONT_WEIGHTS.regular,
          color: tone,
        }}
      >
        {title}
      </span>
      <span style={{ fontSize: textSize("caption"), fontFamily: T.sans }}>{detail}</span>
      {loading ? (
        <ContainerLoadingStatus
          items={
            loadingWaitItems || [
              {
                id: `${title}:wait`,
                label: title,
                status: "loading",
                detail,
                endpoint: "/api/options/chains",
              },
            ]
          }
          testId="trade-chain-loading-waits"
        />
      ) : null}
    </span>
    {actionLabel && onAction ? (
      <button
        type="button"
        onClick={onAction}
        style={{
          border: `1px solid ${CSS_COLOR.border}`,
          background: CSS_COLOR.bg1,
          color: CSS_COLOR.textSec,
          borderRadius: dim(RADII.xs),
          padding: sp("4px 8px"),
          fontSize: textSize("caption"),
          fontFamily: T.sans,
          fontWeight: FONT_WEIGHTS.regular,
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
        borderRadius: dim(RADII.pill),
        border: `2px solid ${CSS_COLOR.border}`,
        borderTopColor: CSS_COLOR.amber,
        animation: "tradeChainSpin 900ms linear infinite",
        flexShrink: 0,
      }}
    />
  </>
);

const ChainSideHeader = forwardRef(function ChainSideHeader({
  side,
  columns,
  onHorizontalScroll,
}, scrollRef) {
  const gridTemplateColumns = buildColumnGrid(columns);
  const sideMinWidth = getSideMinWidth(columns);

  return (
    <div
      ref={scrollRef}
      onScroll={onHorizontalScroll}
      style={{ minWidth: 0, overflowX: "auto", overflowY: "hidden" }}
    >
      <div
        style={{
          minWidth: dim(sideMinWidth),
          display: "grid",
          gridTemplateColumns,
          height: dim(HEADER_HEIGHT),
          alignItems: "center",
          background: CSS_COLOR.bg1,
          borderBottom: `1px solid ${CSS_COLOR.border}`,
        }}
      >
        {columns.map((column) => (
          <AppTooltip key={column.key} content={column.label}><span
            key={column.key}
            style={{
              padding: sp("0 6px"),
              color: CSS_COLOR.textSec,
              fontSize: fs(8),
              fontWeight: FONT_WEIGHTS.regular,
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
    </div>
  );
});

// Item 13, D4 — one option-chain quote cell. Extracted so the per-cell tick
// flash hook runs per component (not in the parent map callback). Only the
// price columns (bid/ask/last) flash — the highest-signal live values — so a
// full row is at most 3 active flash hooks per side.
const ChainCell = ({
  row,
  column,
  held,
  side,
  sideColor,
  staleSide,
  cellHeatAlpha,
  sideFreshness,
}) => {
  const flashValue = column.type === "price" ? row[column.key] : null;
  const flash = useValueFlash(flashValue, {
    enabled: isFiniteNumber(flashValue),
  });
  return (
    <AppTooltip
      content={`${column.label} / ${formatFreshnessLabel(sideFreshness)}`}
    >
      <span
        className={flash ? `${flash} ra-value-flash--quick` : undefined}
        style={{
          padding: sp("0 6px"),
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: side === "C" ? "flex-end" : "flex-start",
          background:
            cellHeatAlpha > 0 ? rgba(sideColor, cellHeatAlpha) : "transparent",
          color: staleSide
            ? CSS_COLOR.textDim
            : column.type === "volume"
              ? CSS_COLOR.textSec
              : column.type === "price"
                ? sideColor
                : held && column.heldAware
                  ? CSS_COLOR.amber
                  : CSS_COLOR.textSec,
          opacity: staleSide ? 0.72 : 1,
          fontSize: textSize("caption"),
          fontWeight: FONT_WEIGHTS.regular,
          fontFamily: T.sans,
          textAlign: side === "C" ? "right" : "left",
          whiteSpace: "nowrap",
        }}
      >
        {formatCellValue(row, column, held)}
      </span>
    </AppTooltip>
  );
};

const ChainSideRows = forwardRef(function ChainSideRows({
  side,
  entries,
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
  const sideColor = toneForOptionSide(side, CSS_COLOR.textDim);
  const gridTemplateColumns = buildColumnGrid(columns);
  const sideMinWidth = getSideMinWidth(columns);

  return (
    <div
      ref={scrollRef}
      onScroll={onHorizontalScroll}
      style={{ minWidth: 0, overflowX: "auto", overflowY: "visible" }}
    >
      <div style={{ minWidth: dim(sideMinWidth) }}>
        {topPadding > 0 ? (
          <div aria-hidden="true" style={{ height: dim(topPadding) }} />
        ) : null}
        {entries.map(({ row }, rowIndex) => {
          const held = heldContracts.some(
            (holding) => holding.strike === row.k && holding.cp === side,
          );
          const selectedSide =
            selected?.strike === row.k && selected?.cp === side;
          const isAtmRow = isFiniteNumber(atmStrike)
            ? row.k === atmStrike
            : row.isAtm;
          const rowBackground = selectedSide
            ? rgba(sideColor, 0.22)
            : isAtmRow
                ? rgba(CSS_COLOR.amber, 0.08)
                : "transparent";
          const sideFreshness = getRowSideFreshness(row, side);
          const staleSide =
            sideFreshness === "metadata" ||
            sideFreshness === "unavailable" ||
            sideFreshness === "stale";
          const rowShadows = [
            selectedSide
              ? `inset ${side === "C" ? -2 : 2}px 0 0 ${sideColor}`
              : null,
            held ? `inset 0 0 0 1px ${cssColorMix(CSS_COLOR.amber, 33)}` : null,
          ].filter(Boolean);

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
                  accent: selectedSide ? sideColor : isAtmRow ? CSS_COLOR.amber : sideColor,
                }),
                display: "grid",
                gridTemplateColumns,
                height: dim(ROW_HEIGHT),
                alignItems: "center",
                cursor: "pointer",
                background: rowBackground,
                borderBottom: `1px solid ${cssColorMix(CSS_COLOR.border, 7)}`,
                boxShadow: rowShadows.length ? rowShadows.join(", ") : "none",
              }}
            >
              {columns.map((column) => {
                const cellHeatIntensity =
                  heatmapEnabled && column.type === "volume"
                    ? heatmapModel.intensity(row, side, column.key)
                    : 0;
                const cellHeatAlpha =
                  cellHeatIntensity > 0 ? 0.04 + cellHeatIntensity * 0.24 : 0;
                return (
                  <ChainCell
                    key={column.key}
                    row={row}
                    column={column}
                    held={held}
                    side={side}
                    sideColor={sideColor}
                    staleSide={staleSide}
                    cellHeatAlpha={cellHeatAlpha}
                    sideFreshness={sideFreshness}
                  />
                );
              })}
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

const StrikeHeader = () => (
  <div
    style={{
      width: dim(STRIKE_WIDTH),
      height: dim(HEADER_HEIGHT),
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      borderLeft: `1px solid ${CSS_COLOR.borderLight}`,
      borderRight: `1px solid ${CSS_COLOR.borderLight}`,
      borderBottom: `1px solid ${CSS_COLOR.border}`,
      background: CSS_COLOR.bg1,
      color: CSS_COLOR.textSec,
      fontSize: fs(8),
      fontFamily: T.sans,
      fontWeight: FONT_WEIGHTS.regular,
    }}
  >
    Strike
  </div>
);

const StrikeRows = ({
  entries,
  atmStrike,
  topPadding = 0,
  bottomPadding = 0,
}) => (
  <div
    style={{
      width: dim(STRIKE_WIDTH),
      borderLeft: `1px solid ${CSS_COLOR.borderLight}`,
      borderRight: `1px solid ${CSS_COLOR.borderLight}`,
      background: CSS_COLOR.bg1,
      flexShrink: 0,
    }}
  >
    {topPadding > 0 ? (
      <div aria-hidden="true" style={{ height: dim(topPadding) }} />
    ) : null}
    {entries.map(({ row }) => {
      const isAtmRow = isFiniteNumber(atmStrike)
        ? row.k === atmStrike
        : row.isAtm;
      return (
        <div
          key={`strike:${row.k}`}
          style={{
            height: dim(ROW_HEIGHT),
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderBottom: `1px solid ${cssColorMix(CSS_COLOR.border, 7)}`,
            background: isAtmRow ? rgba(CSS_COLOR.amber, 0.16) : "transparent",
            color: isAtmRow ? CSS_COLOR.amber : CSS_COLOR.text,
            fontFamily: T.sans,
            fontSize: fs(10),
            fontWeight: FONT_WEIGHTS.regular,
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
  const callHeaderScrollRef = useRef(null);
  const callSideScrollRef = useRef(null);
  const putHeaderScrollRef = useRef(null);
  const putSideScrollRef = useRef(null);
  const syncingSideScrollRef = useRef(false);
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
  const syncHorizontalScroll = useCallback((sourceKey) => {
    if (syncingSideScrollRef.current) {
      return;
    }

    const scrollRefs = {
      callBody: callSideScrollRef,
      callHeader: callHeaderScrollRef,
      putBody: putSideScrollRef,
      putHeader: putHeaderScrollRef,
    };
    const source = scrollRefs[sourceKey]?.current;
    if (!source) {
      return;
    }

    const sourceMax = Math.max(0, source.scrollWidth - source.clientWidth);
    const scrollRatio = sourceMax > 0 ? source.scrollLeft / sourceMax : 0;
    syncingSideScrollRef.current = true;
    Object.entries(scrollRefs).forEach(([key, ref]) => {
      const target = ref.current;
      if (!target || key === sourceKey) {
        return;
      }
      const targetMax = Math.max(0, target.scrollWidth - target.clientWidth);
      const nextScrollLeft = scrollRatio * targetMax;
      if (Math.abs(target.scrollLeft - nextScrollLeft) >= 1) {
        target.scrollLeft = nextScrollLeft;
      }
    });
    const clearSyncFlag = () => {
      syncingSideScrollRef.current = false;
    };
    if (typeof window !== "undefined" && window.requestAnimationFrame) {
      window.requestAnimationFrame(clearSyncFlag);
    } else {
      clearSyncFlag();
    }
  }, []);
  const handleCallHeaderHorizontalScroll = useCallback(
    () => syncHorizontalScroll("callHeader"),
    [syncHorizontalScroll],
  );
  const handleCallHorizontalScroll = useCallback(
    () => syncHorizontalScroll("callBody"),
    [syncHorizontalScroll],
  );
  const handlePutHeaderHorizontalScroll = useCallback(
    () => syncHorizontalScroll("putHeader"),
    [syncHorizontalScroll],
  );
  const handlePutHorizontalScroll = useCallback(
    () => syncHorizontalScroll("putBody"),
    [syncHorizontalScroll],
  );
  const selectedCenterStrike = contract.strike ?? atmStrike;
  const selectedScrollIndex = resolveOptionChainScrollIndex(
    chain,
    selectedCenterStrike,
    atmStrike,
  );
  const {
    scrollRef,
    totalSize: virtualRowsHeight,
    virtualItems,
  } = useDenseVirtualRows({
    count: chain.length,
    overscan: VIRTUAL_OVERSCAN_ROWS,
    rowHeight: ROW_HEIGHT,
    scrollAlign: "center",
    scrollKey: `${ticker || ""}:${expInfo?.value || ""}:${selectedCenterStrike ?? ""}:${atmStrike ?? ""}:${chain.length}`,
    scrollToIndex: selectedScrollIndex,
  });
  const virtualEntries = buildOptionChainVirtualEntries(chain, virtualItems);
  const visibleChain = virtualEntries.map(({ row }) => row);
  const selectedChainRowBase =
    chain.find((row) => row.k === contract?.strike) ||
    chain.find((row) => row.isAtm) ||
    null;
  const visibleRowsForQuotes = mergeVisibleOptionChainRows(
    visibleChain,
    selectedChainRowBase,
  );
  const visibleQuoteProviderContractIds = useMemo(
    () =>
      visibleRowsForQuotes
        .flatMap((row) => [
          row.cContract?.providerContractId,
          row.pContract?.providerContractId,
        ])
        .filter(Boolean),
    [visibleRowsForQuotes],
  );
  const visibleQuoteVersion = useStoredOptionQuoteSnapshotVersion(
    visibleQuoteProviderContractIds,
  );
  const liveVisibleChain = useMemo(
    () =>
      virtualEntries.map(({ index, row, virtualItem }) => ({
        index,
        row: patchOptionChainRowWithQuoteGetter(row, getStoredOptionQuoteSnapshot),
        virtualItem,
      })),
    [virtualEntries, visibleQuoteVersion],
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
  const visibleRowsForQuotesSignature =
    buildOptionChainRowsIdentitySignature(visibleRowsForQuotes);
  useEffect(() => {
    onVisibleRowsChange?.(visibleRowsForQuotes);
  }, [onVisibleRowsChange, visibleRowsForQuotesSignature]);
  const firstVirtualRow = virtualItems[0];
  const lastVirtualRow = virtualItems[virtualItems.length - 1];
  const topPadding = firstVirtualRow?.start ?? 0;
  const bottomPadding = Math.max(
    0,
    virtualRowsHeight - (lastVirtualRow?.end ?? 0),
  );
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
  let statusColor = CSS_COLOR.textDim;
  if (isResolvedExpirationRefreshing && isResolvedExpirationStale) {
    statusLabel = "refreshing stale";
    statusColor = CSS_COLOR.amber;
  } else if (isResolvedExpirationRefreshing) {
    statusLabel = "refreshing";
    statusColor = CSS_COLOR.amber;
  } else if (isResolvedExpirationStale) {
    statusLabel = "stale chain";
    statusColor = CSS_COLOR.amber;
  } else if (
    chain.length &&
    selectedDataFreshness &&
    selectedDataFreshness !== "live"
  ) {
    statusLabel = `${formatFreshnessLabel(selectedDataFreshness)} data`;
    statusColor =
      selectedDataFreshness === "metadata" ||
      selectedDataFreshness === "unavailable"
        ? CSS_COLOR.textDim
        : CSS_COLOR.amber;
  } else if (resolvedChainStatus === "live") {
    statusLabel = "live";
    statusColor = CSS_COLOR.accent;
  } else if (selectedExpirationStatus === "failed") {
    statusLabel = "selected failed";
    statusColor = CSS_COLOR.red;
  } else if (showLoading) {
    statusLabel = "loading selected";
    statusColor = CSS_COLOR.amber;
  } else if (selectedExpirationStatus === "empty") {
    statusLabel = "selected empty";
  } else if (selectedExpirationStatus === "queued") {
    statusLabel = "queued selected";
    statusColor = CSS_COLOR.amber;
  }
  const emptyChainState = (() => {
    if (showLoading) {
      return {
        title: "Loading option chain",
        detail: selectedExpirationStatus === "loading"
          ? "selected expiration"
          : progressDetail,
        loading: true,
        tone: CSS_COLOR.amber,
      };
    }
    if (selectedExpirationStatus === "queued") {
      return {
        title: "Queued option chain",
        detail: progressDetail,
        loading: true,
        tone: CSS_COLOR.amber,
      };
    }
    if (selectedExpirationStatus === "failed") {
      return {
        title: "Option chain failed",
        detail: "Retry this expiration or choose another expiration.",
        actionLabel: onRetryExpiration ? "Retry" : null,
        onAction: onRetryExpiration ? () => onRetryExpiration(expInfo) : null,
        tone: CSS_COLOR.red,
      };
    }
    if (selectedExpirationStatus === "empty") {
      return {
        title: "No contracts returned",
        detail: "The provider returned no contracts for this expiration.",
        actionLabel: onRetryExpiration ? "Retry" : null,
        onAction: onRetryExpiration ? () => onRetryExpiration(expInfo) : null,
        tone: CSS_COLOR.textSec,
      };
    }
    return {
      title: "No live option chain",
      detail: `The ${ticker} chain is waiting for quotes and greeks.`,
      tone: CSS_COLOR.textSec,
    };
  })();

  return (
    <div
      data-testid="trade-options-chain-panel"
      className="ra-panel-enter"
      style={{
        background: CSS_COLOR.bg1,
        border: `1px solid ${CSS_COLOR.border}`,
        borderRadius: dim(RADII.md),
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        height: "100%",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: sp("6px 10px"),
          borderBottom: `1px solid ${CSS_COLOR.border}`,
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
            fontWeight: FONT_WEIGHTS.regular,
            fontFamily: T.sans,
            color: CSS_COLOR.textSec,
          }}
        >
          OPTIONS CHAIN
        </span>
        <Select
          value={expInfo.value}
          onChange={(next) => {
            if (next) {
              onChangeExp(next);
            }
          }}
          options={fallbackExpirationOptions.map((expiration) => ({
            value: expiration.value,
            label: `${expiration.label} / ${expiration.dte}d`,
          }))}
          disabled={!hasExpirationOptions}
        />
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: sp(4),
            fontSize: textSize("caption"),
            color: heatmapEnabled ? CSS_COLOR.amber : CSS_COLOR.textDim,
            fontFamily: T.sans,
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
        <Select
          ariaLabel="Option chain strike coverage"
          value={String(chainCoverageValue)}
          onChange={(next) => onChangeChainCoverage?.(next)}
          options={chainCoverageOptions.map((option) => ({
            value: String(option),
            label: option === "all" ? "All strikes" : `${option} each side`,
          }))}
        />
        <span style={{ flex: 1 }} />
        {isResolvedExpirationRefreshing ? <ChainRefreshSpinner /> : null}
        <span style={{ fontSize: textSize("caption"), fontFamily: T.sans, color: CSS_COLOR.textDim }}>
          IMP{" "}
          <span style={{ color: impMove != null ? CSS_COLOR.cyan : CSS_COLOR.textDim, fontWeight: FONT_WEIGHTS.regular }}>
            {impMove != null ? `+/-$${impMove.toFixed(2)}` : MISSING_VALUE}
          </span>{" "}
          {impPct != null ? `(${impPct.toFixed(2)}%)` : ""}
        </span>
        <span style={{ fontSize: textSize("caption"), fontFamily: T.sans, color: CSS_COLOR.textDim }}>
          ATM{" "}
          <span style={{ color: CSS_COLOR.accent, fontWeight: FONT_WEIGHTS.regular }}>
            {atmStrike ?? getAtmStrikeFromPrice(info?.price) ?? MISSING_VALUE}
          </span>
        </span>
        <span
          className={isResolvedExpirationRefreshing || showLoading ? "ra-status-pulse" : undefined}
          style={{
            fontSize: fs(8),
            color: statusColor,
            fontFamily: T.sans,
            fontWeight: FONT_WEIGHTS.regular,
          }}
        >
          {statusLabel}
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        {chain.length ? (
          <div
            style={{
              height: "100%",
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              fontFamily: T.sans,
              fontSize: textSize("caption"),
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `minmax(0, 1fr) ${dim(STRIKE_WIDTH)}px minmax(0, 1fr)`,
                flexShrink: 0,
              }}
            >
              <ChainSideHeader
                ref={callHeaderScrollRef}
                side="C"
                columns={CALL_COLUMNS}
                onHorizontalScroll={handleCallHeaderHorizontalScroll}
              />
              <StrikeHeader />
              <ChainSideHeader
                ref={putHeaderScrollRef}
                side="P"
                columns={PUT_COLUMNS}
                onHorizontalScroll={handlePutHeaderHorizontalScroll}
              />
            </div>
            <div
              ref={scrollRef}
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: "auto",
                overflowX: "hidden",
                display: "grid",
                gridTemplateColumns: `minmax(0, 1fr) ${dim(STRIKE_WIDTH)}px minmax(0, 1fr)`,
              }}
            >
              <ChainSideRows
                ref={callSideScrollRef}
                side="C"
                entries={liveVisibleChain}
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
              <StrikeRows
                entries={liveVisibleChain}
                atmStrike={atmStrike}
                topPadding={topPadding}
                bottomPadding={bottomPadding}
              />
              <ChainSideRows
                ref={putSideScrollRef}
                side="P"
                entries={liveVisibleChain}
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
          </div>
        ) : (
          <ChainStatePanel {...emptyChainState} />
        )}
      </div>
    </div>
  );
};

export default TradeChainPanel;
