import React from "react";

export const F = "'IBM Plex Mono','Fira Code',monospace";
export const FS = "'IBM Plex Sans',-apple-system,sans-serif";
export const B = "#4f46e5";
export const Y = "#f59e0b";
export const BORDER = "#e8eaed";

export function normalizeSymbolInput(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z.]/g, "")
    .slice(0, 10);
}

export function SectionTitle({ children, dense = false, rail = false }) {
  const compact = dense || rail;
  return (
    <div
      style={{
        fontSize: rail ? 10 : compact ? 11 : 13,
        color: "#9ca3af",
        fontFamily: FS,
        letterSpacing: rail ? "0.09em" : compact ? "0.06em" : "0.08em",
        textTransform: "uppercase",
        fontWeight: 600,
        marginBottom: rail ? 2 : compact ? 3 : 4,
        marginTop: compact ? 0 : 2,
        lineHeight: 1.2,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </div>
  );
}

export function Pill({ active, onClick, children, color, sm, dense = false, rail = false, style = null }) {
  const compact = dense || sm || rail;
  const activeBorder = color || (B + "55");
  return (
    <button
      onClick={onClick}
      style={{
        padding: rail ? "1px 7px" : compact ? "2px 6px" : "4px 10px",
        fontSize: rail ? 9.5 : compact ? 10 : 12,
        fontFamily: FS,
        fontWeight: active ? 600 : 450,
        background: active ? (color || B) + "0d" : "transparent",
        border: "1px solid " + (active ? activeBorder : "#dde0e4"),
        borderRadius: rail ? 999 : compact ? 5 : 6,
        color: active ? color || B : "#8b8f96",
        cursor: "pointer",
        lineHeight: rail ? 1.45 : dense ? 1.15 : 1.3,
        transition: "all 0.15s ease",
        letterSpacing: "0.01em",
        whiteSpace: "nowrap",
        ...(style || {}),
      }}
    >
      {children}
    </button>
  );
}

export function SliderControl({ label, value, min, max, step, onChange, fmt, hint, dense = false, rail = false }) {
  const compact = dense || rail;
  return (
    <div style={{ marginBottom: rail ? 2 : compact ? 4 : 5 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 8,
          marginBottom: compact ? 0 : 1,
        }}
      >
        <span style={{ fontSize: rail ? 11 : compact ? 12 : 14, color: "#6b7280", fontFamily: FS, fontWeight: 500, lineHeight: 1.2, minWidth: 0 }}>
          {label}
          {hint ? <span style={{ fontSize: rail ? 9 : compact ? 10 : 12, color: "#a1a5ab", marginLeft: 4 }}>{hint}</span> : null}
        </span>
        <span
          style={{
            fontSize: rail ? 11 : compact ? 12 : 14,
            color: "#1e293b",
            fontFamily: F,
            fontWeight: 600,
            background: "#f1f3f5",
            padding: compact ? "1px 4px" : "1px 5px",
            borderRadius: 3,
            lineHeight: compact ? 1.2 : 1.25,
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {fmt ? fmt(value) : value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(+event.target.value)}
        style={{
          width: "100%",
          accentColor: B,
          height: compact ? 2 : 3,
          cursor: "pointer",
          margin: compact ? "1px 0" : "2px 0",
          opacity: 0.85,
        }}
      />
    </div>
  );
}
