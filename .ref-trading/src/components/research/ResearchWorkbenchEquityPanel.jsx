import React, { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { B, BORDER, CARD, F, FS, G, GRID, InsightsTooltip, R, REF, SH1 } from "./insights/shared.jsx";

function formatMoney(value, digits = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "--";
  }
  return (numeric >= 0 ? "+" : "-") + "$" + Math.abs(numeric).toFixed(digits);
}

function formatPct(value, digits = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "--";
  }
  return (numeric >= 0 ? "+" : "") + numeric.toFixed(digits) + "%";
}

function CompactMetric({ label, value, tone = "neutral", compact = false }) {
  const color = tone === "positive" ? G : tone === "negative" ? R : tone === "accent" ? B : "#0f172a";
  return (
    <div
      style={{
        border: "1px solid #e2e8f0",
        borderRadius: 999,
        padding: compact ? "3px 7px" : "4px 8px",
        background: "#fbfdff",
        minWidth: 0,
      }}
    >
      <span style={{ fontSize: compact ? 8 : 9, fontFamily: FS, letterSpacing: "0.06em", textTransform: "uppercase", color: "#94a3b8", marginRight: 6 }}>
        {label}
      </span>
      <span style={{ fontSize: compact ? 10 : 11, fontFamily: F, fontWeight: 700, color, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
        {value}
      </span>
    </div>
  );
}

export default function ResearchWorkbenchEquityPanel({
  capital,
  metrics,
  merged,
  eqDomain,
  snap,
  onPinSnap,
  onClearSnap,
  skippedTrades,
  compact = false,
}) {
  const pos = Number(metrics?.pnl) >= 0;
  const compactChartHeight = 136;
  const equitySeries = useMemo(
    () => (Array.isArray(merged) ? merged : []).filter((_, index, list) => index % Math.ceil(Math.max(list.length, 1) / (compact ? 240 : 600)) === 0 || index === list.length - 1),
    [compact, merged],
  );
  const headerMetrics = compact
    ? [
        { label: "Net", value: formatMoney(metrics?.pnl, 0), tone: Number(metrics?.pnl) >= 0 ? "positive" : "negative" },
        { label: "ROI", value: formatPct(metrics?.roi), tone: Number(metrics?.roi) >= 0 ? "positive" : "negative" },
        { label: "Trades", value: Number.isFinite(Number(metrics?.n)) ? String(Number(metrics.n)) : "--" },
        { label: "Win", value: formatPct(metrics?.wr, 0), tone: Number(metrics?.wr) >= 50 ? "positive" : "negative" },
        { label: "Max DD", value: formatPct(metrics?.dd), tone: Number(metrics?.dd) > 10 ? "negative" : "accent" },
      ]
    : [
        { label: "Net", value: formatMoney(metrics?.pnl, 0), tone: Number(metrics?.pnl) >= 0 ? "positive" : "negative" },
        { label: "ROI", value: formatPct(metrics?.roi), tone: Number(metrics?.roi) >= 0 ? "positive" : "negative" },
        { label: "Trades", value: Number.isFinite(Number(metrics?.n)) ? String(Number(metrics.n)) : "--" },
        { label: "Win", value: formatPct(metrics?.wr, 0), tone: Number(metrics?.wr) >= 50 ? "positive" : "negative" },
        { label: "Sharpe", value: Number.isFinite(Number(metrics?.sharpe)) ? Number(metrics.sharpe).toFixed(2) : "--", tone: Number(metrics?.sharpe) > 0 ? "accent" : "neutral" },
        { label: "Max DD", value: formatPct(metrics?.dd), tone: Number(metrics?.dd) > 10 ? "negative" : "accent" },
        { label: "Avg Bars", value: Number.isFinite(Number(metrics?.avgBars)) ? Number(metrics.avgBars).toFixed(0) : "--" },
        { label: "Skipped", value: Array.isArray(skippedTrades) ? String(skippedTrades.length) : "0", tone: Array.isArray(skippedTrades) && skippedTrades.length ? "accent" : "neutral" },
      ];
  const gradientId = compact ? "workbench-equity-gradient-compact" : "workbench-equity-gradient";

  return (
    <div
      style={{
        background: CARD,
        border: "1px solid " + BORDER,
        borderRadius: compact ? 10 : 8,
        padding: compact ? "7px 8px 8px" : "8px 10px 10px",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        overflow: "hidden",
        boxShadow: SH1,
        height: compact ? "auto" : "100%",
        width: "100%",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: compact ? 5 : 6, marginBottom: compact ? 6 : 8 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div>
            <div style={{ fontSize: compact ? 9 : 10, fontFamily: FS, letterSpacing: "0.08em", textTransform: "uppercase", color: "#94a3b8" }}>{compact ? "Equity" : "Equity Curve"}</div>
            <div style={{ fontSize: compact ? 12 : 13, fontFamily: F, fontWeight: 700, color: "#0f172a" }}>{compact ? "Balance path" : "Strategy balance path"}</div>
          </div>
          {!snap ? (
            <button
              onClick={onPinSnap}
              style={{
                fontSize: compact ? 10 : 11,
                fontFamily: F,
                background: "transparent",
                border: "1px solid " + BORDER,
                borderRadius: 999,
                padding: compact ? "2px 7px" : "2px 7px",
                color: "#94a3b8",
                cursor: "pointer",
                fontWeight: 500,
              }}
            >
              Pin
            </button>
          ) : (
            <button
              onClick={onClearSnap}
              style={{
                fontSize: compact ? 10 : 11,
                fontFamily: F,
                background: R + "08",
                border: "1px solid " + R + "33",
                borderRadius: 999,
                padding: compact ? "2px 7px" : "2px 7px",
                color: R,
                cursor: "pointer",
                fontWeight: 500,
              }}
            >
              Unpin
            </button>
          )}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: compact ? 5 : 6 }}>
          {headerMetrics.map((metric) => (
            <CompactMetric key={metric.label} label={metric.label} value={metric.value} tone={metric.tone} compact={compact} />
          ))}
        </div>
      </div>

      <div
        style={
          compact
            ? { height: compactChartHeight, minHeight: compactChartHeight }
            : { flex: 1, minHeight: 0 }
        }
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={equitySeries} margin={compact ? { top: 2, right: 2, bottom: 0, left: -4 } : { top: 2, right: 4, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={pos ? G : R} stopOpacity={compact ? 0.16 : 0.12} />
                <stop offset="100%" stopColor={pos ? G : R} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={GRID} strokeDasharray="2 2" />
            {compact ? null : (
              <XAxis dataKey="i" tick={{ fill: "#94a3b8", fontSize: 11, fontFamily: F }} tickLine={false} axisLine={false} />
            )}
            <YAxis
              tick={{ fill: "#94a3b8", fontSize: compact ? 10 : 11, fontFamily: F }}
              tickFormatter={(value) => "$" + (value / 1000).toFixed(1) + "k"}
              domain={eqDomain}
              tickLine={false}
              axisLine={false}
              width={compact ? 34 : 40}
            />
            <Tooltip content={<InsightsTooltip />} />
            <ReferenceLine y={capital} stroke={REF} strokeDasharray="3 3" />
            {snap ? (
              <Area type="monotone" dataKey="snap" stroke="#c4b5fd" fill="none" strokeWidth={compact ? 1 : 1.2} strokeDasharray="4 3" dot={false} name={"Pin: " + snap.lbl} />
            ) : null}
            <Area type="monotone" dataKey="bal" stroke={pos ? G : R} fill={"url(#" + gradientId + ")"} strokeWidth={compact ? 1.35 : 1.5} dot={false} name="Equity ($)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
