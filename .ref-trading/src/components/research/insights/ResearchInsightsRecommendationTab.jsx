import React, { useMemo } from "react";
import {
  RECOMMENDATION_DISPLAY_STRATEGIES,
  REGIME_OPTIONS,
  STRATEGY_ROLE_LABELS,
} from "../../../research/config/strategyPresets.js";
import { B, F, FS, G, R, regimeColor } from "./shared.jsx";

export default function ResearchInsightsRecommendationTab({
  recoMatrix,
  recoComputing,
  errorMessage = null,
  onComputeReco,
  tfMin,
  strategy,
  onSelectStrategy,
  strategyPresets,
  strategyLabel,
  barsLength,
  dataSource,
  spotDataMeta,
}) {
  const recoSourceNote = useMemo(() => {
    if (dataSource === "massive") {
      const sourceLabel = spotDataMeta?.source || "Massive vendor history";
      return `Computed on ${sourceLabel}${spotDataMeta?.stale ? " (cached/stale)" : ""} with ${barsLength} bars. Rankings reflect the loaded real-market history plus Massive option history. Click any row to load that strategy with its matching preset.`;
    }
    if (dataSource === "market") {
      const sourceLabel = spotDataMeta?.source || "broker-backed market history";
      return `Computed on ${sourceLabel}${spotDataMeta?.stale ? " (cached/stale)" : ""} with ${barsLength} bars. Rankings reflect the loaded market history plus Massive option history. Click any row to load that strategy with its matching preset.`;
    }
    return `Computed on incomplete spot history with ${barsLength} bars. Treat the rankings as provisional until real spot bars are loaded. Click any row to load that strategy with its matching preset.`;
  }, [barsLength, dataSource, spotDataMeta]);

  if (!recoMatrix) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6, height: "100%", justifyContent: "center" }}>
        <div style={{ textAlign: "center", padding: 20 }}>
          {errorMessage ? (
            <div style={{ fontSize: 13, color: "#b91c1c", fontFamily: F, marginBottom: 10 }}>
              {errorMessage}
            </div>
          ) : null}
          <button
            onClick={onComputeReco}
            disabled={recoComputing}
            style={{
              padding: "8px 20px",
              fontSize: 15,
              fontFamily: F,
              background: recoComputing ? "#c7d2fe" : B,
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: recoComputing ? "wait" : "pointer",
              fontWeight: 600,
            }}
          >
            {recoComputing ? "Running real-data recommendations..." : "Compute Real-Data Recommendations"}
          </button>
          <div style={{ fontSize: 13, color: "#9ca3af", fontFamily: F, marginTop: 6 }}>
            Runs each strategy preset on the loaded spot history and Massive option history.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, height: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div
          style={{
            fontSize: 13,
            color: B,
            fontFamily: F,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            fontWeight: 700,
          }}
        >
          Strategy x Regime Expectancy Matrix{" "}
          <span style={{ color: "#9ca3af", fontWeight: 400, letterSpacing: 0, textTransform: "none" }}>
            (per trade, after fees · {tfMin}m bars · adapt on)
          </span>
        </div>
        <button
          onClick={onComputeReco}
          disabled={recoComputing}
          style={{
            fontSize: 12,
            fontFamily: F,
            background: `${B}10`,
            border: `1px solid ${B}40`,
            borderRadius: 3,
            padding: "2px 6px",
            color: B,
            cursor: recoComputing ? "wait" : "pointer",
            opacity: recoComputing ? 0.7 : 1,
          }}
        >
          {recoComputing ? "Running..." : "Re-run"}
        </button>
      </div>
      {errorMessage ? (
        <div style={{ fontSize: 12, color: "#b91c1c", fontFamily: F, marginBottom: 2 }}>
          {errorMessage}
        </div>
      ) : null}
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: F, fontSize: 14 }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #e5e7eb" }}>
            <th style={{ padding: "4px 6px", textAlign: "left", color: "#9ca3af", fontSize: 12, fontWeight: 600, textTransform: "uppercase" }}>Strategy</th>
            <th style={{ padding: "4px 6px", textAlign: "left", color: "#9ca3af", fontSize: 12, fontWeight: 600, textTransform: "uppercase", minWidth: 60 }}>Preset</th>
            {REGIME_OPTIONS.map((regime) => (
              <th
                key={regime}
                style={{ padding: "4px 10px", textAlign: "center", minWidth: 110, borderLeft: "1px solid #f3f4f6" }}
              >
                <div
                  style={{
                    color: regimeColor(regime),
                    fontWeight: 700,
                    fontSize: 13,
                    textTransform: "uppercase",
                    fontFamily: FS,
                  }}
                >
                  {regime === "range" ? "Range Bound" : regime}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {RECOMMENDATION_DISPLAY_STRATEGIES.map((strategyKey) => {
            const preset = strategyPresets[strategyKey];
            return (
              <tr
                key={strategyKey}
                style={{
                  borderBottom: "1px solid #f3f4f6",
                  background: strategy === strategyKey ? "#f0f9ff" : "transparent",
                  cursor: "pointer",
                }}
                onClick={() => onSelectStrategy(strategyKey)}
              >
                <td style={{ padding: "5px 6px" }}>
                  <span style={{ fontWeight: 600, color: strategy === strategyKey ? B : "#1f2937" }}>
                    {strategyLabel(strategyKey)}
                  </span>
                  <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 1 }}>
                    {STRATEGY_ROLE_LABELS[strategyKey]}
                  </div>
                </td>
                <td style={{ padding: "5px 6px", fontSize: 12, color: "#6b7280" }}>
                  {preset.dte}D · {preset.exit} · {(preset.mc * 100).toFixed(0)}%
                </td>
                {REGIME_OPTIONS.map((regime) => {
                  const cell = recoMatrix[strategyKey]?.[regime];
                  if (!cell || cell.n < 1) {
                    return (
                      <td
                        key={regime}
                        style={{
                          padding: "5px 10px",
                          textAlign: "center",
                          borderLeft: "1px solid #f3f4f6",
                          color: "#d1d5db",
                          fontSize: 13,
                        }}
                      >
                        -
                      </td>
                    );
                  }
                  const isTop = cell.rank === 1;
                  const isBad = cell.exp < 0;
                  return (
                    <td
                      key={regime}
                      style={{
                        padding: "5px 10px",
                        textAlign: "center",
                        borderLeft: "1px solid #f3f4f6",
                        background: isTop ? "#f0fdf4" : isBad ? "#fef2f2" : "transparent",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                        {isTop && <span style={{ fontSize: 13 }}>#1</span>}
                        <span
                          style={{
                            fontSize: 17,
                            fontWeight: 700,
                            color: cell.exp >= 0 ? G : R,
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          ${cell.exp}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: "#9ca3af", fontVariantNumeric: "tabular-nums" }}>
                        {cell.n}x · <span style={{ color: cell.wr >= 50 ? G : R }}>{cell.wr}%</span> ·{" "}
                        <span style={{ color: cell.pnl >= 0 ? G : R }}>
                          {cell.pnl >= 0 ? "+" : ""}${cell.pnl}
                        </span>
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginTop: 2 }}>
        {REGIME_OPTIONS.map((regime) => {
          const ranked = RECOMMENDATION_DISPLAY_STRATEGIES
            .filter((strategyKey) => recoMatrix[strategyKey]?.[regime]?.n >= 3 && recoMatrix[strategyKey][regime].exp > 0)
            .sort((left, right) => recoMatrix[right][regime].exp - recoMatrix[left][regime].exp);
          return (
            <div
              key={regime}
              style={{
                background: "#f9fafb",
                borderRadius: 6,
                padding: "6px 8px",
                borderTop: `3px solid ${regimeColor(regime)}`,
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: regimeColor(regime),
                  fontFamily: F,
                  textTransform: "uppercase",
                  marginBottom: 3,
                }}
              >
                {regime === "range" ? "Range Bound" : regime} playbook
              </div>
              {ranked.length === 0 ? (
                <div style={{ fontSize: 13, color: "#9ca3af", fontFamily: F }}>
                  No profitable strategies (need more data)
                </div>
              ) : (
                ranked.slice(0, 3).map((strategyKey, index) => {
                  const cell = recoMatrix[strategyKey][regime];
                  return (
                    <div
                      key={strategyKey}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        padding: "2px 0",
                        borderBottom: index < ranked.length - 1 ? "1px solid #e5e7eb" : "none",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: index === 0 ? G : index === 1 ? B : "#6b7280",
                          width: 14,
                          fontFamily: F,
                        }}
                      >
                        {index + 1}.
                      </span>
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: "#1f2937",
                          fontFamily: F,
                          flex: 1,
                          cursor: "pointer",
                        }}
                        onClick={() => onSelectStrategy(strategyKey)}
                      >
                        {strategyLabel(strategyKey)}
                      </span>
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: G,
                          fontFamily: F,
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        ${cell.exp}/t
                      </span>
                      <span style={{ fontSize: 12, color: "#9ca3af", fontFamily: F }}>
                        {cell.wr}%
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 12, color: "#9ca3af", fontFamily: F, marginTop: 2 }}>
        {recoSourceNote}
      </div>
    </div>
  );
}
