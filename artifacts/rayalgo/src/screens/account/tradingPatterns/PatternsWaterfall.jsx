import { useMemo } from "react";
import { FONT_WEIGHTS, RADII, T, dim, sp, textSize } from "../../../lib/uiTokens.jsx";
import { formatAppDateTime } from "../../../lib/timeZone";
import {
  formatAccountSignedMoney,
  mutedLabelStyle,
  toneForValue,
} from "../accountUtils";
import { arrayValue } from "./patternsCommon";

const W = 600;
const H = 130;
const PAD_T = 8;
const PAD_B = 16;
const PAD_X = 6;

export const PatternsWaterfall = ({
  waterfall = [],
  currency,
  maskValues,
  onTradeSelect,
}) => {
  const rows = arrayValue(waterfall);
  const stats = useMemo(() => {
    if (!rows.length) return null;
    const perTradeAbsMax = rows.reduce(
      (acc, row) => (Math.abs(row.pnl) > acc ? Math.abs(row.pnl) : acc),
      0,
    );
    const cumulativeExtent = rows.reduce(
      (acc, row) => (Math.abs(row.cumulative) > acc ? Math.abs(row.cumulative) : acc),
      0,
    );
    return {
      perTradeAbsMax: perTradeAbsMax || 1,
      cumulativeExtent: cumulativeExtent || 1,
      totalPnl: rows[rows.length - 1].cumulative,
      firstAt: rows[0].closeInstant,
      lastAt: rows[rows.length - 1].closeInstant,
    };
  }, [rows]);

  if (!rows.length || !stats) return null;

  const chartW = W - PAD_X * 2;
  const chartH = H - PAD_T - PAD_B;
  const zeroY = PAD_T + chartH / 2;
  const colWidth = chartW / rows.length;

  const cumulativePath = rows
    .map((row, idx) => {
      const cx = PAD_X + colWidth * (idx + 0.5);
      const cy =
        zeroY -
        (row.cumulative / stats.cumulativeExtent) * (chartH / 2 - 2);
      return `${idx === 0 ? "M" : "L"}${cx.toFixed(1)},${cy.toFixed(1)}`;
    })
    .join(" ");

  return (
    <div
      style={{
        display: "grid",
        gap: sp(3),
        border: "none",
        borderRadius: dim(RADII.md),
        background: T.bg1,
        padding: sp("8px 10px"),
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: sp(4),
          flexWrap: "wrap",
        }}
      >
        <div style={mutedLabelStyle}>
          TRADE WATERFALL · LAST {rows.length} TRADES
        </div>
        <div
          style={{
            fontSize: textSize("label"),
            fontFamily: T.data,
            color: T.textDim,
          }}
        >
          cumulative{" "}
          <span
            style={{
              color: toneForValue(stats.totalPnl),
              fontWeight: FONT_WEIGHTS.regular,
            }}
          >
            {formatAccountSignedMoney(stats.totalPnl, currency, true, maskValues)}
          </span>
        </div>
      </div>
      <svg
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ display: "block" }}
      >
        <defs>
          <linearGradient id="raWfBarGreen" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={T.green} stopOpacity="0.95" />
            <stop offset="100%" stopColor={T.green} stopOpacity="0.55" />
          </linearGradient>
          <linearGradient id="raWfBarRed" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={T.red} stopOpacity="0.55" />
            <stop offset="100%" stopColor={T.red} stopOpacity="0.95" />
          </linearGradient>
          <filter id="raWfCumGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <line
          x1={PAD_X}
          x2={W - PAD_X}
          y1={zeroY}
          y2={zeroY}
          stroke={T.border}
          strokeWidth={0.5}
          strokeDasharray="2 2"
        />
        {rows.map((row, idx) => {
          const halfChart = chartH / 2 - 2;
          const magnitude = Math.abs(row.pnl);
          if (magnitude === 0) return null;
          const barHeight = Math.max(1.5, (magnitude / stats.perTradeAbsMax) * halfChart);
          const x = PAD_X + colWidth * idx + colWidth * 0.18;
          const w = Math.max(1.5, colWidth * 0.64);
          const positive = row.pnl >= 0;
          const gradientUrl = positive ? "url(#raWfBarGreen)" : "url(#raWfBarRed)";
          const y = positive ? zeroY - barHeight : zeroY;
          return (
            <g
              key={row.id || idx}
              onClick={
                onTradeSelect && row.id
                  ? () => onTradeSelect(row.id)
                  : undefined
              }
              style={{ cursor: onTradeSelect && row.id ? "pointer" : "default" }}
            >
              <title>
                {`${row.symbol || "?"} · ${formatAccountSignedMoney(row.pnl, currency, true, maskValues)} · cum ${formatAccountSignedMoney(row.cumulative, currency, true, maskValues)}`}
              </title>
              <rect
                x={x}
                y={y}
                width={w}
                height={barHeight}
                fill={gradientUrl}
                rx={1}
              />
            </g>
          );
        })}
        {cumulativePath ? (
          <path
            d={cumulativePath}
            fill="none"
            stroke={T.cyan}
            strokeWidth={1.4}
            opacity={0.95}
            filter="url(#raWfCumGlow)"
          />
        ) : null}
      </svg>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: sp(4),
          fontSize: textSize("tableHeader"),
          fontFamily: T.sans,
          color: T.textMuted,
        }}
      >
        <span style={{ fontFamily: T.data }}>
          {stats.firstAt ? formatAppDateTime(stats.firstAt).slice(0, 10) : "—"}
        </span>
        <span style={{ color: T.cyan }}>cumulative line</span>
        <span style={{ fontFamily: T.data }}>
          {stats.lastAt ? formatAppDateTime(stats.lastAt).slice(0, 10) : "—"}
        </span>
      </div>
    </div>
  );
};

export default PatternsWaterfall;
