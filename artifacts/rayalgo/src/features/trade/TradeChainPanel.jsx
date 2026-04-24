import { useMemo } from "react";
import {
  daysToExpiration,
  ensureTradeTickerInfo,
  fmtCompactNumber,
  getAtmStrikeFromPrice,
  isFiniteNumber,
  useRuntimeTickerSnapshot,
} from "../../RayAlgoPlatform";
import {
  resolveTradeOptionChainSnapshot,
  useTradeOptionChainSnapshot,
} from "../platform/tradeOptionChainStore";
import {
  MISSING_VALUE,
  T,
  dim,
  fs,
  sp,
} from "../../lib/uiTokens";

const ROW_HEIGHT = 24;
const HEADER_HEIGHT = 28;
const STRIKE_WIDTH = 78;

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

const buildHeatmapModel = (chain, atmStrike) => {
  const maxDistance = Math.max(
    1,
    ...chain.map((row) =>
      isFiniteNumber(atmStrike) ? Math.abs(row.k - atmStrike) : 1,
    ),
  );
  const maxima = chain.reduce(
    (next, row) => ({
      cVol: Math.max(next.cVol, row.cVol || 0),
      cOi: Math.max(next.cOi, row.cOi || 0),
      cPrem: Math.max(next.cPrem, row.cPrem || 0),
      pVol: Math.max(next.pVol, row.pVol || 0),
      pOi: Math.max(next.pOi, row.pOi || 0),
      pPrem: Math.max(next.pPrem, row.pPrem || 0),
    }),
    {
      cVol: 0,
      cOi: 0,
      cPrem: 0,
      pVol: 0,
      pOi: 0,
      pPrem: 0,
    },
  );

  return {
    intensity(row, side) {
      const prefix = side === "C" ? "c" : "p";
      const volume = normalizeLogValue(row[`${prefix}Vol`], maxima[`${prefix}Vol`]);
      const openInterest = normalizeLogValue(
        row[`${prefix}Oi`],
        maxima[`${prefix}Oi`],
      );
      const premium = normalizeLogValue(
        row[`${prefix}Prem`],
        maxima[`${prefix}Prem`],
      );
      const atmProximity = isFiniteNumber(atmStrike)
        ? 1 - Math.min(Math.abs(row.k - atmStrike) / maxDistance, 1)
        : row.isAtm
          ? 1
          : 0;

      return Math.max(
        0,
        Math.min(
          1,
          0.35 * volume +
            0.25 * openInterest +
            0.25 * premium +
            0.15 * atmProximity,
        ),
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

const ChainSide = ({
  side,
  chain,
  columns,
  selected,
  heldContracts,
  heatmapEnabled,
  heatmapModel,
  atmStrike,
  onSelect,
}) => {
  const sideColor = side === "C" ? T.green : T.red;
  const gridTemplateColumns = buildColumnGrid(columns);
  const sideMinWidth = getSideMinWidth(columns);

  return (
    <div style={{ minWidth: 0, overflowX: "auto", overflowY: "visible" }}>
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
          }}
        >
          {columns.map((column) => (
            <span
              key={column.key}
              title={column.label}
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
            </span>
          ))}
        </div>
        {chain.map((row) => {
          const held = heldContracts.some(
            (holding) => holding.strike === row.k && holding.cp === side,
          );
          const selectedSide =
            selected?.strike === row.k && selected?.cp === side;
          const isAtmRow = isFiniteNumber(atmStrike)
            ? row.k === atmStrike
            : row.isAtm;
          const heatAlpha = heatmapEnabled
            ? 0.05 + heatmapModel.intensity(row, side) * 0.28
            : 0;
          const rowBackground = selectedSide
            ? rgba(sideColor, 0.22)
            : heatmapEnabled
              ? rgba(sideColor, heatAlpha)
              : isAtmRow
                ? rgba(T.amber, 0.08)
                : "transparent";

          return (
            <div
              key={`${side}:${row.k}`}
              onClick={() => onSelect(row.k, side)}
              style={{
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
                <span
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
                </span>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const StrikeColumn = ({ chain, atmStrike }) => (
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
}) => {
  const fallback = useMemo(
    () => ensureTradeTickerInfo(ticker, ticker),
    [ticker],
  );
  const info = useRuntimeTickerSnapshot(ticker, fallback);
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
  } = resolveTradeOptionChainSnapshot(chainSnapshot, contract.exp);
  const expirationOptions = expirations.length
    ? expirations
    : snapshotExpirationOptions;
  const chain = chainRows.length ? chainRows : snapshotChainRows;
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
    fallbackExpirationOptions.find((option) => option.value === contract.exp) ||
    resolvedExpiration ||
    fallbackExpirationOptions[0] || {
      value: contract.exp,
      label: contract.exp,
      dte: daysToExpiration(contract.exp),
    };
  const heldForExpiration = heldContracts.filter(
    (holding) => holding.exp === expInfo?.value,
  );
  const heatmapModel = useMemo(
    () => buildHeatmapModel(chain, atmStrike),
    [atmStrike, chain],
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
  const showLoading =
    !chain.length &&
    (selectedExpirationStatus === "loading" ||
      isResolvedExpirationLoading ||
      (selectedExpirationStatus === "empty" &&
        resolvedChainStatus === "loading" &&
        completedExpirationCount === 0));
  let statusLabel = progressDetail;
  let statusColor = T.textDim;
  if (resolvedChainStatus === "live") {
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
        <span style={{ flex: 1 }} />
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
            style={{
              height: "100%",
              overflowY: "auto",
              overflowX: "hidden",
              display: "grid",
              gridTemplateColumns: `minmax(0, 1fr) ${dim(STRIKE_WIDTH)}px minmax(0, 1fr)`,
              fontFamily: T.mono,
              fontSize: fs(9),
            }}
          >
            <ChainSide
              side="C"
              chain={chain}
              columns={CALL_COLUMNS}
              selected={{ strike: contract.strike, cp: contract.cp }}
              heldContracts={heldForExpiration}
              heatmapEnabled={heatmapEnabled}
              heatmapModel={heatmapModel}
              atmStrike={atmStrike}
              onSelect={onSelectContract}
            />
            <StrikeColumn chain={chain} atmStrike={atmStrike} />
            <ChainSide
              side="P"
              chain={chain}
              columns={PUT_COLUMNS}
              selected={{ strike: contract.strike, cp: contract.cp }}
              heldContracts={heldForExpiration}
              heatmapEnabled={heatmapEnabled}
              heatmapModel={heatmapModel}
              atmStrike={atmStrike}
              onSelect={onSelectContract}
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
