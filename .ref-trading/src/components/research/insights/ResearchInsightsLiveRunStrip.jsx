import React from "react";
import ResearchBacktestProgressFeed from "../ResearchBacktestProgressFeed.jsx";
import { B, F, FS, G, M, R, SH1, Y } from "./shared.jsx";

function formatSignedCurrency(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  const prefix = numeric >= 0 ? "+$" : "-$";
  return `${prefix}${Math.abs(numeric).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function StatBadge({ label, value, tone = M }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        minHeight: 24,
        padding: "0 8px",
        borderRadius: 999,
        background: "#f8fafc",
        border: "1px solid #dbe2ea",
        fontFamily: FS,
        fontSize: 11,
        color: tone,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ color: "#94a3b8", fontWeight: 600 }}>{label}</span>
      <span style={{ color: tone, fontWeight: 700 }}>{value}</span>
    </span>
  );
}

function resolveProgressDetail(progress, liveRunState) {
  if (liveRunState?.statusText) {
    return liveRunState.statusText;
  }
  const activeStep = progress?.steps?.find((step) => step.status === "active");
  if (!activeStep) {
    return "Backtest is running.";
  }
  return activeStep.detail ? `${activeStep.label} · ${activeStep.detail}` : activeStep.label;
}

export default function ResearchInsightsLiveRunStrip({
  runStatus,
  backtestProgress,
  liveRunState,
}) {
  if (runStatus !== "loading") {
    return null;
  }

  const tradeCount = Math.max(0, Number(liveRunState?.tradeCount) || (Array.isArray(liveRunState?.trades) ? liveRunState.trades.length : 0));
  const winCount = Math.max(0, Number(liveRunState?.winCount) || 0);
  const lossCount = Math.max(0, tradeCount - winCount);
  const capital = Number.isFinite(Number(liveRunState?.capital)) ? Number(liveRunState.capital) : null;
  const initialCapital = Number.isFinite(Number(liveRunState?.initialCapital)) ? Number(liveRunState.initialCapital) : null;
  const runningPnl = capital != null && initialCapital != null ? capital - initialCapital : null;
  const replayResolution = liveRunState?.replayResolution || liveRunState?.replayDatasetSummary || null;
  const detail = resolveProgressDetail(backtestProgress, liveRunState);

  return (
    <div
      style={{
        marginBottom: 8,
        padding: "9px 10px",
        borderRadius: 8,
        border: "1px solid #dbe2ea",
        background: "linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)",
        boxShadow: SH1,
        display: "grid",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            minHeight: 20,
            padding: "0 8px",
            borderRadius: 999,
            background: `${B}10`,
            border: `1px solid ${B}22`,
            color: B,
            fontFamily: FS,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          Live Backtest
        </span>
        <div style={{ minWidth: 0, fontFamily: F, fontSize: 12, color: "#334155", lineHeight: 1.45 }}>
          {detail}
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <StatBadge label="Trades" value={tradeCount} tone={B} />
        <StatBadge label="W/L" value={`${winCount}/${lossCount}`} tone={winCount >= lossCount ? G : Y} />
        {runningPnl != null ? (
          <StatBadge label="Running P&L" value={formatSignedCurrency(runningPnl)} tone={runningPnl >= 0 ? G : R} />
        ) : null}
        {replayResolution?.candidates ? (
          <StatBadge
            label="Processed"
            value={`${replayResolution.processed || 0}/${replayResolution.candidates}`}
            tone={B}
          />
        ) : null}
        {replayResolution?.resolved ? (
          <StatBadge label="Resolved" value={replayResolution.resolved} tone={B} />
        ) : null}
        {replayResolution?.skipped ? (
          <StatBadge label="Skipped" value={replayResolution.skipped} tone={Y} />
        ) : null}
        {replayResolution?.inFlight ? (
          <StatBadge label="Active" value={replayResolution.inFlight} tone={M} />
        ) : null}
        {replayResolution?.uniqueContracts ? (
          <StatBadge label="Tickers" value={replayResolution.uniqueContracts} tone={M} />
        ) : null}
      </div>

      {backtestProgress ? <ResearchBacktestProgressFeed progress={backtestProgress} /> : null}
    </div>
  );
}
