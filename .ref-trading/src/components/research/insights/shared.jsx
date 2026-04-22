import React from "react";

export const F = "'IBM Plex Mono','Fira Code',monospace";
export const FS = "'IBM Plex Sans',-apple-system,sans-serif";
export const G = "#10b981";
export const R = "#ef4444";
export const B = "#4f46e5";
export const Y = "#f59e0b";
export const M = "#6b7280";
export const GRID = "#e5e7eb";
export const REF = "#d1d5db";
export const SH1 = "0 1px 2px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.06)";
export const SH2 = "0 2px 6px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04)";
export const CARD = "#ffffff";
export const BORDER = "#e8eaed";

export function InsightsTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: "#ffffffee",
        border: `1px solid ${BORDER}`,
        borderRadius: 6,
        padding: "5px 8px",
        fontSize: 14,
        fontFamily: FS,
        boxShadow: SH2,
        backdropFilter: "blur(8px)",
      }}
    >
      {payload.map((point, index) => (
        <div key={index} style={{ color: point.color || "#475569", lineHeight: 1.5 }}>
          <span style={{ fontWeight: 500 }}>{point.name}:</span>{" "}
          {typeof point.value === "number" ? point.value.toFixed(2) : point.value}
        </div>
      ))}
      {payload[0]?.payload?.ts && (
        <div
          style={{
            color: "#a1a5ab",
            fontSize: 12,
            marginTop: 2,
            borderTop: "1px solid #f0f1f3",
            paddingTop: 2,
          }}
        >
          {payload[0].payload.ts}
        </div>
      )}
    </div>
  );
}

export function regimeColor(regime) {
  return regime === "bull" ? G : regime === "bear" ? R : M;
}

