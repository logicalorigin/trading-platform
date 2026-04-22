import React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { B, F, G, GRID, InsightsTooltip, R, REF } from "./shared.jsx";

const WATERFALL_CHART_HEIGHT = 248;

export default function ResearchInsightsWaterfallTab({
  tradePnls,
  pnlDist,
  isRunning = false,
}) {
  if (!tradePnls.length && !pnlDist.length) {
    return (
      <div
        style={{
          minHeight: WATERFALL_CHART_HEIGHT,
          display: "grid",
          placeItems: "center",
          textAlign: "center",
          color: "#64748b",
          fontFamily: F,
          fontSize: 15,
          padding: 16,
        }}
      >
        {isRunning
          ? "Backtest is running. P&L charts will populate as trades close."
          : "No closed trades to chart for this run."}
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, minHeight: 0 }}>
      <div style={{ display: "grid", gridTemplateRows: "auto auto", gap: 6, alignContent: "start" }}>
        <div
          style={{
            fontSize: 13,
            color: B,
            fontFamily: F,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            marginBottom: 2,
            fontWeight: 600,
          }}
        >
          Trade Waterfall
        </div>
        <div style={{ height: WATERFALL_CHART_HEIGHT, minHeight: WATERFALL_CHART_HEIGHT }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={tradePnls}>
              <CartesianGrid stroke={GRID} strokeDasharray="2 2" />
              <XAxis dataKey="i" tick={{ fill: "#9ca3af", fontSize: 12, fontFamily: F }} tickLine={false} />
              <YAxis
                tick={{ fill: "#9ca3af", fontSize: 13, fontFamily: F }}
                tickFormatter={(value) => `$${value}`}
                tickLine={false}
              />
              <Tooltip content={<InsightsTooltip />} />
              <ReferenceLine y={0} stroke={REF} />
              <Bar dataKey="pnl" name="P&L ($)" radius={[1, 1, 0, 0]}>
                {tradePnls.map((entry, index) => (
                  <Cell key={index} fill={entry.pnl >= 0 ? G : R} fillOpacity={0.6} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateRows: "auto auto", gap: 6, alignContent: "start" }}>
        <div
          style={{
            fontSize: 13,
            color: B,
            fontFamily: F,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            marginBottom: 2,
            fontWeight: 600,
          }}
        >
          Distribution
        </div>
        <div style={{ height: WATERFALL_CHART_HEIGHT, minHeight: WATERFALL_CHART_HEIGHT }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={pnlDist}>
              <CartesianGrid stroke={GRID} strokeDasharray="2 2" />
              <XAxis
                dataKey="range"
                tick={{ fill: "#9ca3af", fontSize: 12, fontFamily: F }}
                tickFormatter={(value) => `$${value}`}
                tickLine={false}
              />
              <YAxis tick={{ fill: "#9ca3af", fontSize: 13, fontFamily: F }} tickLine={false} />
              <Tooltip content={<InsightsTooltip />} />
              <ReferenceLine x={0} stroke={REF} />
              <Bar dataKey="count" name="Trades" radius={[1, 1, 0, 0]}>
                {pnlDist.map((entry, index) => (
                  <Cell key={index} fill={entry.range >= 0 ? G : R} fillOpacity={0.5} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
