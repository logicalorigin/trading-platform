import { memo, useId, useMemo } from "react";
import { FONT_WEIGHTS, RADII, T, dim, fs, sp, textSize } from "../../lib/uiTokens.jsx";
import {
  formatQuotePrice,
  formatSignedPercent,
  isFiniteNumber,
} from "../../lib/formatters";
import { useNumberTick } from "../../lib/numberTick.js";
import { useRuntimeTickerSnapshot } from "./runtimeTickerStore";
import { buildFallbackWatchlistItem } from "./runtimeMarketDataModel";
import { AppTooltip } from "@/components/ui/tooltip";


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
  const uid = useId().replace(/:/g, "");

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
  const [tailX, tailY] = plottedPoints[plottedPoints.length - 1];
  const gradientId = `raKpiSparkGrad-${uid}`;
  const glowId = `raKpiSparkGlow-${uid}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ display: "block" }}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lineColor} stopOpacity="0.32" />
          <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
        </linearGradient>
        <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} />
      <polyline
        points={points}
        fill="none"
        stroke={lineColor}
        strokeWidth="1.55"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle
        className="ra-sparkline-tail"
        cx={tailX}
        cy={tailY}
        r="1.6"
        fill={lineColor}
        filter={`url(#${glowId})`}
      />
    </svg>
  );
};

const HeaderKpiStripItem = memo(({ symbol, label, index, onSelect, compact = false, isFirst = false }) => {
  const fallback = useMemo(
    () => buildFallbackWatchlistItem(symbol, index, label),
    [index, label, symbol],
  );
  const snapshot = useRuntimeTickerSnapshot(symbol, fallback);
  const positive = isFiniteNumber(snapshot?.pct) ? snapshot.pct >= 0 : null;
  // 420ms tick — fast enough that streaming updates don't pile up, slow
  // enough that the human eye registers movement. Reduced-motion drops
  // straight to the target value (the hook handles that).
  const animatedPrice = useNumberTick(snapshot?.price, 420);
  const animatedPct = useNumberTick(snapshot?.pct, 420);

  return (
    <AppTooltip content={`${label} proxy · ${symbol}`}><button
      type="button"
      onClick={() => onSelect?.(symbol)}
      className="ra-header-kpi"
      style={{
        flex: compact ? "0 0 auto" : `1 1 ${dim(110)}px`,
        minWidth: dim(compact ? 90 : 108),
        minHeight: dim(compact ? 28 : 38),
        padding: sp(compact ? "2px 10px 2px 8px" : "4px 14px 4px 10px"),
        display: "flex",
        alignItems: "center",
        gap: sp(8),
        background: "transparent",
        border: "none",
        borderLeft: isFirst ? "none" : `1px solid ${T.borderLight}`,
        color: T.text,
        cursor: "pointer",
        transition: "background 0.18s ease, color 0.18s ease",
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = T.bg2;
        event.currentTarget.style.color = T.accent;
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = "transparent";
        event.currentTarget.style.color = T.text;
      }}
    >
      <span
        style={{
          minWidth: 0,
          flex: 1,
          textAlign: "left",
          display: "flex",
          flexDirection: "column",
          gap: sp(1),
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
              fontSize: textSize(compact ? "micro" : "caption"),
              color: T.textMuted,
              fontFamily: T.sans,
              fontWeight: FONT_WEIGHTS.medium,
              letterSpacing: "0.04em",
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
              fontSize: textSize("caption"),
              fontWeight: FONT_WEIGHTS.medium,
              color: T.textSec,
              fontFamily: T.sans,
              lineHeight: 1.1,
              letterSpacing: "0.04em",
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
              fontSize: textSize("paragraph"),
              fontWeight: FONT_WEIGHTS.label,
              fontFamily: T.sans,
              color: T.text,
              lineHeight: 1.15,
              whiteSpace: "nowrap",
              fontVariantNumeric: "tabular-nums",
              letterSpacing: "-0.01em",
            }}
          >
            {formatQuotePrice(animatedPrice ?? snapshot?.price)}
          </span>
          <span
            style={{
              display: "block",
              fontSize: textSize("body"),
              fontWeight: FONT_WEIGHTS.medium,
              fontFamily: T.sans,
              color:
                positive == null ? T.textDim : positive ? T.green : T.red,
              lineHeight: 1.15,
              whiteSpace: "nowrap",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {formatSignedPercent(animatedPct ?? snapshot?.pct)}
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
          width={44}
          height={18}
        />
      </span>
    </button></AppTooltip>
  );
});

export const HeaderKpiStrip = memo(({ onSelect, compact = false }) => (
  <div
    data-testid="platform-header-kpis"
    style={{
      display: "flex",
      alignItems: "stretch",
      gap: 0,
      minWidth: 0,
      width: "100%",
      background: T.bg1,
      border: `1px solid ${T.border}`,
      borderRadius: dim(RADII.sm),
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
        compact={compact}
        isFirst={index === 0}
      />
    ))}
  </div>
));
