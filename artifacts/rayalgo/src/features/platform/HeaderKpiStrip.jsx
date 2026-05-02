import { memo, useMemo } from "react";
import { T, dim, fs, sp } from "../../lib/uiTokens";
import {
  formatQuotePrice,
  formatSignedPercent,
  isFiniteNumber,
} from "../../lib/formatters";
import { useRuntimeTickerSnapshot } from "./runtimeTickerStore";
import { buildFallbackWatchlistItem } from "./runtimeMarketDataModel";

const HEADER_KPI_CONFIG = [
  { symbol: "VIXY", label: "Volatility" },
  { symbol: "IEF", label: "Treasuries" },
  { symbol: "UUP", label: "Dollar" },
  { symbol: "GLD", label: "Gold" },
  { symbol: "USO", label: "Crude" },
];

export const HEADER_KPI_SYMBOLS = HEADER_KPI_CONFIG.map((item) => item.symbol);

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

const MicroSparkline = ({
  data = [],
  positive = null,
  width = 64,
  height = 24,
}) => {
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

const HeaderKpiStripItem = memo(({ symbol, label, index, onSelect }) => {
  const fallback = useMemo(
    () => buildFallbackWatchlistItem(symbol, index, label),
    [index, label, symbol],
  );
  const snapshot = useRuntimeTickerSnapshot(symbol, fallback);
  const positive = isFiniteNumber(snapshot?.pct) ? snapshot.pct >= 0 : null;

  return (
    <button
      type="button"
      onClick={() => onSelect?.(symbol)}
      title={`${label} proxy · ${symbol}`}
      style={{
        flex: "1 1 68px",
        minWidth: dim(64),
        minHeight: dim(32),
        padding: sp("3px 6px"),
        display: "flex",
        alignItems: "center",
        gap: sp(5),
        background: T.bg1,
        border: `1px solid ${T.border}`,
        borderRadius: 0,
        color: T.text,
        cursor: "pointer",
        transition: "background 0.12s ease, color 0.12s ease",
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = `${T.bg3}80`;
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = "transparent";
      }}
    >
      <span
        style={{
          minWidth: 0,
          flex: 1,
          textAlign: "left",
          display: "flex",
          flexDirection: "column",
          gap: 0,
        }}
      >
        <span
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: sp(6),
            minWidth: 0,
          }}
        >
          <span
            style={{
              display: "block",
              fontSize: fs(7),
              color: T.textMuted,
              fontFamily: T.sans,
              fontWeight: 700,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {label}
          </span>
          <span
            style={{
              display: "block",
              fontSize: fs(7),
              fontWeight: 600,
              color: T.textMuted,
              fontFamily: T.sans,
              lineHeight: 1.1,
              letterSpacing: "0.05em",
              flexShrink: 0,
            }}
          >
            {symbol}
          </span>
        </span>
        <span
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: sp(6),
            minWidth: 0,
          }}
        >
          <span
            style={{
              display: "block",
              fontSize: fs(10),
              fontWeight: 700,
              fontFamily: T.sans,
              color: T.text,
              lineHeight: 1.1,
              whiteSpace: "nowrap",
            }}
          >
            {formatQuotePrice(snapshot?.price)}
          </span>
          <span
            style={{
              display: "block",
              fontSize: fs(8),
              fontWeight: 700,
              fontFamily: T.sans,
              color:
                positive == null ? T.textDim : positive ? T.green : T.red,
              lineHeight: 1.1,
              whiteSpace: "nowrap",
            }}
          >
            {formatSignedPercent(snapshot?.pct)}
          </span>
        </span>
      </span>
      <span style={{ display: "block", flexShrink: 0 }}>
        <MicroSparkline
          data={
            snapshot?.sparkBars?.length
              ? snapshot.sparkBars
              : snapshot?.spark || fallback.spark
          }
          positive={positive}
          width={34}
          height={13}
        />
      </span>
    </button>
  );
});

export const HeaderKpiStrip = memo(({ onSelect }) => (
  <div
    data-testid="platform-header-kpis"
    style={{
      display: "flex",
      alignItems: "stretch",
      gap: sp(3),
      minWidth: 0,
      width: "100%",
      overflow: "hidden",
    }}
  >
    {HEADER_KPI_CONFIG.map(({ symbol, label }, index) => (
      <HeaderKpiStripItem
        key={symbol}
        symbol={symbol}
        label={label}
        index={index}
        onSelect={onSelect}
      />
    ))}
  </div>
));
