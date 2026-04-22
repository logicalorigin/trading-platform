import React from "react";
import { B, BORDER, F, FS, G, M, R, Y } from "./shared.jsx";

function getStatusMeta(status) {
  if (status === "aggregate_changed") {
    return {
      label: "Aggregate changed",
      color: G,
      background: `${G}10`,
      border: `${G}33`,
    };
  }
  if (status === "trade_changed") {
    return {
      label: "Trade changed",
      color: B,
      background: `${B}10`,
      border: `${B}33`,
    };
  }
  if (status === "halt_collapsed") {
    return {
      label: "Halt collapsed",
      color: Y,
      background: `${Y}10`,
      border: `${Y}33`,
    };
  }
  if (status === "propagated_only") {
    return {
      label: "Propagated only",
      color: Y,
      background: `${Y}10`,
      border: `${Y}33`,
    };
  }
  return {
    label: "No change",
    color: M,
    background: "#f8fafc",
    border: "#e2e8f0",
  };
}

function formatSignedMoney(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return `${numeric >= 0 ? "+" : "-"}$${Math.abs(numeric).toFixed(0)}`;
}

function formatSignedCount(value, noun) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric === 0) {
    return null;
  }
  return `${numeric >= 0 ? "+" : ""}${numeric} ${noun}`;
}

function buildVariantSummary(variant) {
  const parts = [];
  if (variant.riskStopDelta?.bothHaltedSamePolicy) {
    parts.push("Both runs hit legacy halt");
  }
  if (variant.aggregateDelta?.deltas?.netPnl) {
    const pnlDelta = formatSignedMoney(variant.aggregateDelta.deltas.netPnl);
    if (pnlDelta) {
      parts.push(`${pnlDelta} P&L`);
    }
  }
  if (variant.aggregateDelta?.deltas?.tradeCount) {
    const tradeCountDelta = formatSignedCount(variant.aggregateDelta.deltas.tradeCount, "trades");
    if (tradeCountDelta) {
      parts.push(tradeCountDelta);
    }
  }
  if (variant.datasetDelta?.resolved) {
    const resolvedDelta = formatSignedCount(variant.datasetDelta.resolved, "resolved");
    if (resolvedDelta) {
      parts.push(resolvedDelta);
    }
  }
  if (variant.tradeDelta?.changedContractCount) {
    parts.push(`${variant.tradeDelta.changedContractCount} contract changes`);
  }
  if (variant.tradeDelta?.changedExitReasonCount) {
    parts.push(`${variant.tradeDelta.changedExitReasonCount} exit changes`);
  }
  if (variant.equityDelta?.maxAbsBalanceDelta) {
    parts.push(`$${Number(variant.equityDelta.maxAbsBalanceDelta).toFixed(0)} max equity delta`);
  }
  return parts.slice(0, 3).join(" · ") || "No downstream change detected.";
}

function buildCurrentRiskStopNote(riskStop) {
  if (!riskStop) {
    return null;
  }
  if (riskStop.policy === "disabled") {
    return "Research risk stop is disabled, so entry and exit changes can flow through the full run.";
  }
  if (riskStop.haltTriggered) {
    return `Legacy halt triggered${riskStop.triggerDate ? ` on ${riskStop.triggerDate}` : ""}.`;
  }
  return "Legacy risk halt is enabled for this run.";
}

function ActionButton({ onClick, disabled = false, children }) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        minHeight: 28,
        padding: "0 10px",
        borderRadius: 999,
        border: `1px solid ${disabled ? BORDER : `${B}40`}`,
        background: disabled ? "#f8fafc" : `${B}10`,
        color: disabled ? M : B,
        fontSize: 11.5,
        fontFamily: F,
        fontWeight: 700,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.7 : 1,
      }}
    >
      {children}
    </button>
  );
}

export default function ResearchInsightsInputImpactCard({
  inputImpact = null,
  onRun = null,
}) {
  if (!inputImpact) {
    return null;
  }

  if (inputImpact.status === "disabled") {
    return null;
  }

  if (inputImpact.status === "loading") {
    return (
      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "10px 12px", background: "#ffffff" }}>
        <div style={{ fontSize: 13, color: B, fontFamily: FS, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600, marginBottom: 4 }}>
          Input Impact
        </div>
        <div style={{ fontSize: 13, color: Y, fontFamily: F }}>
          Running diagnostic variants against the current Massive options-history baseline...
        </div>
      </div>
    );
  }

  if (inputImpact.status === "error") {
    return (
      <div style={{ border: `1px solid ${R}33`, borderRadius: 8, padding: "10px 12px", background: `${R}08` }}>
        <div style={{ fontSize: 13, color: R, fontFamily: FS, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600, marginBottom: 4 }}>
          Input Impact
        </div>
        <div style={{ fontSize: 13, color: "#7f1d1d", fontFamily: F }}>
          {inputImpact.error || "Failed to compute options-history input impact diagnostics."}
        </div>
        <div style={{ marginTop: 8 }}>
          <ActionButton onClick={onRun} disabled={!inputImpact.canRun || typeof onRun !== "function"}>
            Run Input Impact
          </ActionButton>
        </div>
      </div>
    );
  }

  if (!inputImpact.summary?.variants?.length || !inputImpact.isCurrent) {
    return (
      <div
        style={{
          border: `1px solid ${BORDER}`,
          borderRadius: 8,
          padding: "10px 12px",
          background: "#ffffff",
        }}
      >
        <div style={{ fontSize: 13, color: B, fontFamily: FS, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600, marginBottom: 4 }}>
          Input Impact
        </div>
        <div style={{ fontSize: 12, color: M, fontFamily: F, lineHeight: 1.45 }}>
          {inputImpact.canRun
            ? "Manual diagnostic. Runs a small set of variant replays against the current completed Massive options-history baseline."
            : inputImpact.blockedReason || "Run a synced options-history backtest before using this diagnostic."}
        </div>
        <div style={{ marginTop: 8 }}>
          <ActionButton onClick={onRun} disabled={!inputImpact.canRun || typeof onRun !== "function"}>
            Run Input Impact
          </ActionButton>
        </div>
      </div>
    );
  }

  const overallMeta = getStatusMeta(inputImpact.summary.status);
  const lastRunDelta = inputImpact.lastRunDelta || null;
  const lastRunMeta = lastRunDelta ? getStatusMeta(lastRunDelta.status) : null;
  const currentRiskStopNote = buildCurrentRiskStopNote(inputImpact.currentRiskStop);

  return (
    <div
      style={{
        border: `1px solid ${BORDER}`,
        borderRadius: 8,
        padding: "10px 12px",
        background: "#ffffff",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
        <div>
          <div style={{ fontSize: 13, color: B, fontFamily: FS, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>
            Input Impact
          </div>
          <div style={{ fontSize: 12, color: M, fontFamily: F, marginTop: 2 }}>
            {inputImpact.summary.headline}
          </div>
        </div>
        <div
          style={{
            whiteSpace: "nowrap",
            padding: "3px 8px",
            borderRadius: 999,
            border: `1px solid ${overallMeta.border}`,
            background: overallMeta.background,
            color: overallMeta.color,
            fontFamily: F,
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          {overallMeta.label}
        </div>
      </div>

      {currentRiskStopNote && (
        <div
          style={{
            marginBottom: 8,
            padding: "7px 9px",
            borderRadius: 8,
            border: `1px solid ${BORDER}`,
            background: "#f8fafc",
            fontSize: 12,
            color: "#334155",
            fontFamily: F,
          }}
        >
          {currentRiskStopNote}
        </div>
      )}

      {lastRunDelta && lastRunMeta && (
        <div
          style={{
            display: "grid",
            gap: 4,
            padding: "8px 10px",
            marginBottom: 8,
            borderRadius: 8,
            border: "1px solid " + lastRunMeta.border,
            background: lastRunMeta.background,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div style={{ fontSize: 12, color: "#111827", fontFamily: F, fontWeight: 700 }}>
              {lastRunDelta.label}
            </div>
            <div
              style={{
                whiteSpace: "nowrap",
                padding: "2px 7px",
                borderRadius: 999,
                border: "1px solid " + lastRunMeta.border,
                color: lastRunMeta.color,
                fontFamily: F,
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {lastRunMeta.label}
            </div>
          </div>
          <div style={{ fontSize: 11, color: M, fontFamily: F }}>
            {lastRunDelta.description}
          </div>
          <div style={{ fontSize: 12, color: "#334155", fontFamily: F }}>
            {buildVariantSummary(lastRunDelta)}
          </div>
        </div>
      )}

      <div style={{ display: "grid", gap: 6 }}>
        {inputImpact.summary.variants.map((variant) => {
          const statusMeta = getStatusMeta(variant.status);
          return (
            <div
              key={variant.key}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 180px) auto minmax(0, 1fr)",
                gap: 8,
                alignItems: "center",
                borderTop: `1px solid ${BORDER}`,
                paddingTop: 6,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, color: "#111827", fontFamily: F, fontWeight: 700 }}>
                  {variant.label}
                </div>
                <div style={{ fontSize: 11, color: M, fontFamily: F }}>
                  {variant.description}
                </div>
              </div>
              <div
                style={{
                  whiteSpace: "nowrap",
                  padding: "2px 7px",
                  borderRadius: 999,
                  border: `1px solid ${statusMeta.border}`,
                  background: statusMeta.background,
                  color: statusMeta.color,
                  fontFamily: F,
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                {statusMeta.label}
              </div>
              <div style={{ fontSize: 12, color: "#334155", fontFamily: F, minWidth: 0 }}>
                {buildVariantSummary(variant)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
