import React, { useEffect, useState } from "react";
import ResearchBacktestProgressFeed from "./ResearchBacktestProgressFeed.jsx";
import ResearchWorkbenchConfigStagingPanel from "./ResearchWorkbenchConfigStagingPanel.jsx";
import ResearchWorkbenchEquityPanel from "./ResearchWorkbenchEquityPanel.jsx";
import { G, M, R } from "./insights/shared.jsx";
import { B, F, FS } from "./sidebar/shared.jsx";

function useViewportWidth() {
  const [viewportWidth, setViewportWidth] = useState(() => (
    typeof window === "undefined" ? 1440 : window.innerWidth
  ));

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }
    const handleResize = () => {
      setViewportWidth(window.innerWidth);
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return viewportWidth;
}

function ValueBadge({ children, muted = false, compact = false }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        minHeight: compact ? 20 : 24,
        padding: compact ? "0 6px" : "0 8px",
        borderRadius: 999,
        background: muted ? "#f8fafc" : "#eff6ff",
        border: "1px solid " + (muted ? "#e2e8f0" : "#bfdbfe"),
        color: muted ? "#64748b" : "#1d4ed8",
        fontSize: compact ? 9.5 : 11,
        fontFamily: F,
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function ActionStripButton({ children, onClick, disabled = false, tone = "default", title = null }) {
  const palette = tone === "primary"
    ? { background: B, border: `${B}55`, color: "#ffffff" }
    : { background: "#ffffff", border: "#dbe2ea", color: "#475569" };
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={title || undefined}
      style={{
        minHeight: 34,
        padding: "0 12px",
        borderRadius: 10,
        border: `1px solid ${palette.border}`,
        background: palette.background,
        color: palette.color,
        fontSize: 12,
        fontFamily: FS,
        fontWeight: 700,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.46 : 1,
        transition: "opacity 0.12s ease, background 0.12s ease, border-color 0.12s ease",
      }}
    >
      {children}
    </button>
  );
}

function resolveRunStatusMeta(runModel = {}) {
  if (runModel?.runError) {
    return { tone: R, label: "Run failed", detail: runModel.runError };
  }
  if (runModel?.activeJob?.jobId && ["queued", "running_background", "cancel_requested"].includes(String(runModel?.activeJob?.status || ""))) {
    return {
      tone: B,
      label: runModel?.activeJob?.status === "queued" ? "Queued" : runModel?.activeJob?.status === "cancel_requested" ? "Cancelling" : "Background run",
      detail: runModel?.activeJob?.progress?.detail || "This backtest is running server-side and will reconnect automatically.",
    };
  }
  if (runModel?.hasQueuedRerun) {
    return { tone: R, label: "Rerun queued", detail: "One rerun will start after the active backtest finishes." };
  }
  if (runModel?.runStatus === "loading") {
    const activeStep = runModel?.backtestProgress?.steps?.find((s) => s.status === "active");
    const detail = activeStep
      ? (activeStep.detail ? `Processing ${activeStep.detail}` : activeStep.label)
      : "Resolving contracts and replaying the current staged inputs.";
    return { tone: R, label: "Running", detail };
  }
  if (runModel?.runDisabledReason) {
    return { tone: B, label: "Waiting for data", detail: runModel.runDisabledReason };
  }
  if (runModel?.runIsStale) {
    return { tone: B, label: "Results stale", detail: "Inputs changed after the last completed run. Press Run Backtest to refresh." };
  }
  if (runModel?.canSaveRun) {
    return { tone: G, label: "Run ready", detail: "The latest completed run can be saved to history." };
  }
  return { tone: M, label: "Manual mode", detail: "Backtests now run only when you press Run Backtest." };
}

function ResearchWorkbenchRunCard({ runModel = null }) {
  const [notice, setNotice] = useState(null);
  const statusMeta = resolveRunStatusMeta(runModel);
  const runLabel = runModel?.runStatus === "loading"
    ? (runModel?.hasQueuedRerun ? "Rerun Queued" : "Queue Rerun")
    : "Run Backtest";
  const hasCancelableJob = Boolean(runModel?.activeJob?.jobId)
    && ["queued", "running_background", "running_interactive", "cancel_requested"].includes(String(runModel?.activeJob?.status || ""));
  const runDisabled = Boolean(runModel?.runDisabled) || (runModel?.runStatus === "loading" && runModel?.hasQueuedRerun);

  useEffect(() => {
    if (!notice) {
      return undefined;
    }
    const timerId = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timerId);
  }, [notice]);

  return (
    <div
      style={{
        border: "1px solid #dbe2ea",
        borderRadius: 12,
        background: "linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)",
        padding: "10px 11px",
        display: "grid",
        gap: 8,
        boxShadow: "0 1px 4px rgba(15,23,42,0.04)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div>
          <div style={{ fontSize: 10, fontFamily: FS, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Backtest Actions
          </div>
          <div style={{ marginTop: 2, fontSize: 13, fontFamily: F, fontWeight: 700, color: "#0f172a" }}>
            Explicit run and save
          </div>
        </div>
        <ValueBadge compact muted={statusMeta.tone === M}>{statusMeta.label}</ValueBadge>
      </div>

      <div style={{ fontSize: 11.5, fontFamily: F, color: statusMeta.tone, lineHeight: 1.45 }}>
        {statusMeta.detail}
      </div>

      {runModel?.backtestProgress ? <ResearchBacktestProgressFeed progress={runModel.backtestProgress} /> : null}

      <div style={{ display: "grid", gridTemplateColumns: hasCancelableJob ? "repeat(3, minmax(0, 1fr))" : "repeat(2, minmax(0, 1fr))", gap: 6 }}>
        <ActionStripButton
          tone="primary"
          disabled={runDisabled}
          title={runModel?.runDisabledReason || null}
          onClick={() => {
            const result = runModel?.onRunBacktest?.();
            if (result?.queued) {
              setNotice("Queued one rerun after the active backtest.");
            }
          }}
        >
          {runLabel}
        </ActionStripButton>
        {hasCancelableJob ? (
          <ActionStripButton
            disabled={runModel?.activeJob?.status === "cancel_requested"}
            onClick={() => {
              runModel?.onCancelBacktest?.(runModel?.activeJob?.jobId);
            }}
          >
            {runModel?.activeJob?.status === "cancel_requested" ? "Cancelling..." : "Cancel Run"}
          </ActionStripButton>
        ) : null}
        <ActionStripButton
          disabled={!runModel?.canSaveRun}
          onClick={() => {
            const result = runModel?.onSaveRun?.();
            setNotice(result?.ok ? "Saved run to history." : (result?.reason || "Save blocked."));
          }}
        >
          Save Run
        </ActionStripButton>
      </div>

      {notice ? (
        <div style={{ fontSize: 11, fontFamily: F, color: notice.includes("blocked") || notice.includes("failed") ? R : B, lineHeight: 1.4 }}>
          {notice}
        </div>
      ) : null}
    </div>
  );
}

export default function ResearchWorkbenchTopControls({
  equityModel,
  stagedConfigModel,
  runModel,
}) {
  const viewportWidth = useViewportWidth();
  const stackTopRail = viewportWidth < 1340;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "flex-start",
        gap: 8,
        paddingBottom: 4,
      }}
    >
      <div
        style={{
          minWidth: 0,
          display: "grid",
          gap: 8,
          alignItems: "start",
          flex: stackTopRail ? "1 1 100%" : "999 1 880px",
          order: 1,
        }}
      >
        <ResearchWorkbenchConfigStagingPanel stagedConfigModel={stagedConfigModel} />
      </div>

      <div
        style={{
          minHeight: 0,
          display: "flex",
          minWidth: 0,
          flex: stackTopRail ? "1 1 100%" : "0 0 304px",
          width: stackTopRail ? "100%" : 304,
          alignSelf: "flex-start",
          order: 2,
        }}
      >
        <div style={{ width: "100%", display: "grid", gap: 8 }}>
          <ResearchWorkbenchRunCard runModel={runModel} />
          <ResearchWorkbenchEquityPanel {...equityModel} compact />
        </div>
      </div>
    </div>
  );
}
