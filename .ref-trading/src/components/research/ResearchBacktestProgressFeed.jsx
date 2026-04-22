import React, { useEffect } from "react";
import { B, F, FS } from "./insights/shared.jsx";

function ensureProgressKeyframes() {
  const styleId = "bt-progress-keyframes";
  if (typeof document === "undefined" || document.getElementById(styleId)) {
    return;
  }
  const style = document.createElement("style");
  style.id = styleId;
  style.textContent = [
    "@keyframes bt-slide{0%{width:30%;margin-left:0}50%{width:50%;margin-left:25%}100%{width:30%;margin-left:70%}}",
    "@keyframes bt-check-in{0%{transform:scale(0);opacity:0}60%{transform:scale(1.3)}100%{transform:scale(1);opacity:1}}",
  ].join("");
  document.head.appendChild(style);
}

const MONO = "'SF Mono','Cascadia Code','Consolas',monospace";
const STEP_COLORS = { complete: "#16a34a", active: B, pending: "#cbd5e1" };
const STEP_ICONS = { complete: "\u2713", active: "\u25B6", pending: "\u25CB" };

function StepProgressBar({ pct, status }) {
  const isIndeterminate = pct === -1;
  const fillPct = Math.max(0, Math.min(100, pct || 0));
  const barBg = status === "complete" ? "#bbf7d0" : "#e2e8f0";
  const fillColor = status === "complete"
    ? "#16a34a"
    : `linear-gradient(90deg, ${B}, #60a5fa)`;
  return (
    <div style={{ flex: "1 1 0", height: 4, borderRadius: 2, background: barBg, overflow: "hidden", minWidth: 0 }}>
      {isIndeterminate ? (
        <div
          style={{
            height: "100%",
            borderRadius: 2,
            background: `linear-gradient(90deg, ${B}, #60a5fa)`,
            animation: "bt-slide 1.8s ease-in-out infinite",
          }}
        />
      ) : (
        <div
          style={{
            height: "100%",
            borderRadius: 2,
            background: fillColor,
            width: `${fillPct}%`,
            transition: "width 0.2s ease-out",
          }}
        />
      )}
    </div>
  );
}

function BacktestStepRow({ step }) {
  const color = STEP_COLORS[step.status] || STEP_COLORS.pending;
  const icon = STEP_ICONS[step.status] || STEP_ICONS.pending;
  const isActive = step.status === "active";
  const isComplete = step.status === "complete";
  const pctLabel = step.pct >= 0 ? `${Math.round(step.pct)}%` : null;
  const metrics = step.metrics || null;

  return (
    <div style={{ display: "grid", gap: 3 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, minHeight: 16 }}>
        <span
          key={`${step.label}-${step.status}`}
          style={{
            fontSize: 9,
            lineHeight: 1,
            width: 11,
            textAlign: "center",
            color,
            fontWeight: 700,
            flexShrink: 0,
            display: "inline-block",
            animation: isComplete ? "bt-check-in 0.35s ease-out both" : "none",
          }}
        >
          {icon}
        </span>
        <span
          style={{
            fontSize: 10.5,
            fontFamily: FS,
            fontWeight: 600,
            color: isActive ? "#0f172a" : step.status === "complete" ? "#16a34a" : "#94a3b8",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {step.label}
        </span>
        {isActive && step.detail ? (
          <span
            style={{
              fontSize: 10,
              fontFamily: MONO,
              fontWeight: 600,
              color: "#475569",
              whiteSpace: "nowrap",
              marginLeft: "auto",
              flexShrink: 0,
            }}
          >
            {step.detail}
          </span>
        ) : null}
        {isActive && pctLabel ? (
          <span
            style={{
              fontSize: 10,
              fontFamily: MONO,
              fontWeight: 700,
              color: B,
              whiteSpace: "nowrap",
              marginLeft: step.detail ? 0 : "auto",
              flexShrink: 0,
            }}
          >
            {pctLabel}
          </span>
        ) : null}
      </div>

      {step.status !== "pending" ? (
        <div style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 17 }}>
          <StepProgressBar pct={step.pct} status={step.status} />
        </div>
      ) : null}

      {isActive && metrics ? (
        <div
          style={{
            display: "flex",
            gap: 10,
            paddingLeft: 17,
            fontSize: 10,
            fontFamily: F,
            color: "#475569",
            lineHeight: 1.2,
            flexWrap: "wrap",
          }}
        >
          <span>{metrics.tradeCount || 0} trades</span>
          <span>{metrics.winCount || 0}W / {Math.max(0, (metrics.tradeCount || 0) - (metrics.winCount || 0))}L</span>
          <span>
            {(() => {
              const pnl = (Number(metrics.capital) || 0) - (Number(metrics.initialCapital) || 0);
              return (pnl >= 0 ? "+$" : "\u2212$") + Math.abs(pnl).toLocaleString(undefined, { maximumFractionDigits: 0 });
            })()}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export default function ResearchBacktestProgressFeed({ progress }) {
  useEffect(() => {
    ensureProgressKeyframes();
  }, []);

  if (!progress?.steps?.length) {
    return null;
  }

  return (
    <div
      style={{
        padding: "7px 8px 6px",
        borderRadius: 8,
        background: "linear-gradient(180deg, #f0f5ff 0%, #f8fafc 100%)",
        border: "1px solid #dbe2ea",
        display: "grid",
        gap: 5,
      }}
    >
      {progress.steps.map((step, index) => (
        <BacktestStepRow key={step.label || index} step={step} />
      ))}
    </div>
  );
}
