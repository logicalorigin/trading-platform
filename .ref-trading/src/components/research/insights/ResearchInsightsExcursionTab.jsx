import React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { B, BORDER, CARD, F, FS, G, GRID, M, R, REF, SH1, Y } from "./shared.jsx";

const TAB_CHART_HEIGHT = 280;
const OVERVIEW_CHART_HEIGHT = 216;

function SectionCard({ title, subtitle = null, children, compact = false }) {
  return (
    <div
      style={{
        border: `1px solid ${BORDER}`,
        borderRadius: 10,
        background: CARD,
        boxShadow: SH1,
        padding: compact ? "10px 12px" : "12px 14px",
        minWidth: 0,
      }}
    >
      <div style={{ marginBottom: compact ? 8 : 10 }}>
        <div style={{ fontSize: 12, color: B, fontFamily: FS, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 700 }}>
          {title}
        </div>
        {subtitle ? <div style={{ marginTop: 4, fontSize: 12, color: M, fontFamily: F, lineHeight: 1.45 }}>{subtitle}</div> : null}
      </div>
      {children}
    </div>
  );
}

function WarningList({ warnings = [] }) {
  if (!warnings.length) {
    return null;
  }
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {warnings.map((warning) => (
        <div
          key={warning}
          style={{
            padding: "8px 10px",
            borderRadius: 8,
            border: `1px solid ${Y}33`,
            background: `${Y}10`,
            color: "#7c2d12",
            fontSize: 12,
            fontFamily: F,
            lineHeight: 1.45,
          }}
        >
          {warning}
        </div>
      ))}
    </div>
  );
}

function ExcursionTooltip({ active, payload }) {
  if (!active || !payload?.length) {
    return null;
  }
  const point = payload[0]?.payload;
  if (!point) {
    return null;
  }
  return (
    <div
      style={{
        background: "#ffffffee",
        border: `1px solid ${BORDER}`,
        borderRadius: 8,
        padding: "8px 10px",
        fontFamily: F,
        fontSize: 12,
        boxShadow: SH1,
      }}
    >
      <div style={{ color: "#111827", fontWeight: 700, marginBottom: 4 }}>{point.exitLabel}</div>
      <div style={{ color: M }}>MFE {point.mfePct.toFixed(2)}%</div>
      <div style={{ color: M }}>MAE {point.maePct.toFixed(2)}%</div>
      <div style={{ color: point.pnlPct >= 0 ? G : R }}>Final {point.pnlPct.toFixed(2)}%</div>
      {Number.isFinite(Number(point.capturePct)) ? <div style={{ color: B }}>Capture {point.capturePct.toFixed(1)}%</div> : null}
    </div>
  );
}

function ExitReasonPerformanceTable({ exitBreakdown = [] }) {
  return (
    <div style={{ display: "grid", gap: 0 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.25fr) repeat(6, minmax(52px, 0.6fr))",
          gap: 8,
          paddingBottom: 6,
          borderBottom: `1px solid ${BORDER}`,
          fontSize: 10,
          color: "#94a3b8",
          fontFamily: F,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        <div>Exit</div>
        <div>Trades</div>
        <div>P&L</div>
        <div>MFE</div>
        <div>MAE</div>
        <div>Cap</div>
        <div>Give</div>
      </div>
      {exitBreakdown.map((entry) => (
        <div
          key={entry.key}
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.25fr) repeat(6, minmax(52px, 0.6fr))",
            gap: 8,
            alignItems: "center",
            padding: "8px 0",
            borderBottom: `1px solid ${BORDER}`,
            fontFamily: F,
            minWidth: 0,
          }}
        >
          <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 10, height: 10, borderRadius: 3, background: entry.color, flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, color: "#111827", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {entry.label}
              </div>
            </div>
          </div>
          <div style={{ fontSize: 12, color: M }}>{entry.count}</div>
          <div style={{ fontSize: 12, color: entry.avgPnlPct >= 0 ? G : R, fontWeight: 700 }}>
            {entry.avgPnlPct >= 0 ? "+" : ""}{entry.avgPnlPct.toFixed(1)}%
          </div>
          <div style={{ fontSize: 12, color: G }}>{entry.avgMfePct.toFixed(1)}%</div>
          <div style={{ fontSize: 12, color: R }}>{entry.avgMaePct.toFixed(1)}%</div>
          <div style={{ fontSize: 12, color: B }}>
            {entry.avgCapturePct == null ? "--" : `${entry.avgCapturePct.toFixed(0)}%`}
          </div>
          <div style={{ fontSize: 12, color: Y }}>
            {entry.avgGiveBackPct == null ? "--" : `${entry.avgGiveBackPct.toFixed(0)}%`}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ResearchInsightsExcursionTab({
  excursionAnalytics = null,
  showWarnings = true,
  layout = "tab",
}) {
  const scatter = excursionAnalytics?.scatter || { mfeVsPnl: [], maeVsPnl: [] };
  const exitBreakdown = excursionAnalytics?.exitBreakdown || [];
  const warnings = excursionAnalytics?.warnings || [];
  const compact = layout === "overview";
  const chartHeight = compact ? OVERVIEW_CHART_HEIGHT : TAB_CHART_HEIGHT;
  const rowGap = compact ? 8 : 10;
  const scatterSubtitleMfe = compact
    ? "Gap below the diagonal is profit given back after peak excursion."
    : "Distance below the diagonal is profit given back after peak excursion.";
  const scatterSubtitleMae = compact
    ? "Deep red-zone trades are the strongest stop-loss evidence."
    : "The trades deep in the red zone are the strongest stop-loss evidence.";

  return (
    <div style={{ display: "grid", gap: rowGap }}>
      {showWarnings ? <WarningList warnings={warnings.slice(0, 2)} /> : null}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 8 }}>
        <SectionCard title="MFE vs Final P&L" subtitle={scatterSubtitleMfe} compact={compact}>
          <div style={{ height: chartHeight }}>
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 6, right: 10, bottom: 8, left: 0 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="2 2" />
                <XAxis dataKey="mfePct" tick={{ fill: "#9ca3af", fontSize: 12, fontFamily: F }} tickLine={false} unit="%" />
                <YAxis dataKey="pnlPct" tick={{ fill: "#9ca3af", fontSize: 12, fontFamily: F }} tickLine={false} unit="%" />
                <ReferenceLine y={0} stroke={REF} />
                <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 100, y: 100 }]} stroke={G} strokeDasharray="5 4" strokeOpacity={0.35} />
                <Tooltip content={<ExcursionTooltip />} />
                {exitBreakdown.map((exitGroup) => (
                  <Scatter
                    key={exitGroup.key}
                    name={exitGroup.label}
                    data={scatter.mfeVsPnl.filter((point) => point.exitReason === exitGroup.key)}
                    fill={exitGroup.color}
                    fillOpacity={0.72}
                  />
                ))}
                <Legend wrapperStyle={{ fontSize: 11, fontFamily: F }} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard title="MAE vs Final P&L" subtitle={scatterSubtitleMae} compact={compact}>
          <div style={{ height: chartHeight }}>
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 6, right: 10, bottom: 8, left: 0 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="2 2" />
                <XAxis dataKey="maePct" tick={{ fill: "#9ca3af", fontSize: 12, fontFamily: F }} tickLine={false} unit="%" />
                <YAxis dataKey="pnlPct" tick={{ fill: "#9ca3af", fontSize: 12, fontFamily: F }} tickLine={false} unit="%" />
                <ReferenceLine y={0} stroke={REF} />
                <Tooltip content={<ExcursionTooltip />} />
                {exitBreakdown.map((exitGroup) => (
                  <Scatter
                    key={exitGroup.key}
                    name={exitGroup.label}
                    data={scatter.maeVsPnl.filter((point) => point.exitReason === exitGroup.key)}
                    fill={exitGroup.color}
                    fillOpacity={0.72}
                  />
                ))}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.15fr) minmax(0, 0.85fr)", gap: 8 }}>
        <SectionCard title="Exit Reason Performance" subtitle="Compact exit-quality matrix across realized return and excursion retention." compact={compact}>
          <ExitReasonPerformanceTable exitBreakdown={exitBreakdown} />
        </SectionCard>

        <SectionCard title="Capture Efficiency" subtitle="Average percent of peak excursion retained at exit." compact={compact}>
          <div style={{ height: chartHeight }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={exitBreakdown} layout="vertical" margin={{ left: 8 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="2 2" />
                <XAxis type="number" domain={[0, 100]} tick={{ fill: "#9ca3af", fontSize: 12, fontFamily: F }} tickLine={false} unit="%" />
                <YAxis type="category" dataKey="label" width={96} tick={{ fill: "#9ca3af", fontSize: 11, fontFamily: F }} tickLine={false} />
                <ReferenceLine x={50} stroke={REF} strokeDasharray="4 4" />
                <Tooltip formatter={(value) => `${Number(value).toFixed(1)}%`} />
                <Bar dataKey="avgCapturePct" radius={[0, 4, 4, 0]}>
                  {exitBreakdown.map((entry) => (
                    <Cell key={entry.key} fill={entry.color} fillOpacity={0.8} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div
            style={{
              marginTop: compact ? 8 : 10,
              padding: compact ? "8px 10px" : "10px 12px",
              borderRadius: 8,
              border: `1px solid ${BORDER}`,
              background: "#f8fafc",
              fontFamily: F,
              fontSize: 12,
              color: "#334155",
              lineHeight: 1.45,
            }}
          >
            Large gaps between average MFE and realized return highlight where the Exit Governor is still giving gains back.
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
