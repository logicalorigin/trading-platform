import React from "react";
import { B, BORDER, CARD, F, FS, G, M, R, SH1, Y } from "./shared.jsx";
import ResearchInsightsAnalysisTab from "./ResearchInsightsAnalysisTab.jsx";
import ResearchInsightsHistoryTab from "./ResearchInsightsHistoryTab.jsx";
import ResearchInsightsLiveRunStrip from "./ResearchInsightsLiveRunStrip.jsx";
import ResearchInsightsLogTab from "./ResearchInsightsLogTab.jsx";
import ResearchInsightsOptimizeTab from "./ResearchInsightsOptimizeTab.jsx";
import ResearchInsightsRecommendationTab from "./ResearchInsightsRecommendationTab.jsx";
import ResearchInsightsScoreStudyTab from "./ResearchInsightsScoreStudyTab.jsx";
import ResearchInsightsWaterfallTab from "./ResearchInsightsWaterfallTab.jsx";

const TAB_ITEMS = [
  ["overview", "Overview"],
  ["performance", "Performance"],
  ["score_testing", "Score Tuning"],
  ["trades", "Trades"],
  ["logs", "Logs"],
  ["history", "History"],
  ["optimize", "Optimize"],
];

function StatusBadge({ children, tone = "muted" }) {
  const palette = tone === "positive"
    ? { background: `${G}12`, border: `${G}33`, color: G }
    : tone === "warning"
      ? { background: `${Y}12`, border: `${Y}33`, color: Y }
      : tone === "danger"
        ? { background: `${R}10`, border: `${R}33`, color: R }
        : tone === "primary"
          ? { background: `${B}12`, border: `${B}33`, color: B }
          : { background: "#f8fafc", border: "#dbe2ea", color: "#64748b" };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        minHeight: 22,
        padding: "0 8px",
        borderRadius: 999,
        border: `1px solid ${palette.border}`,
        background: palette.background,
        color: palette.color,
        fontSize: 11,
        fontFamily: F,
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function formatCount(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toLocaleString() : "--";
}

function formatDuration(startedAt, finishedAt = null) {
  const startMs = Date.parse(startedAt || "");
  const endMs = Date.parse(finishedAt || "") || Date.now();
  if (!Number.isFinite(startMs)) {
    return "--";
  }
  const totalSeconds = Math.max(0, Math.round((endMs - startMs) / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function resolveResultHeader(displayedResultRecord, runIsStale) {
  if (!displayedResultRecord) {
    return null;
  }
  const mode = displayedResultRecord.mode === "background" ? "Background result" : "Interactive result";
  const metrics = displayedResultRecord.metrics || {};
  const counts = displayedResultRecord.replayMeta?.replayDatasetSummary || displayedResultRecord.replayDatasetSummary || null;
  return {
    title: mode,
    subtitle: displayedResultRecord.resultMeta?.selectionSummaryLabel
      || displayedResultRecord.replayMeta?.selectionSummaryLabel
      || "Latest completed backtest result",
    chips: [
      { label: displayedResultRecord.origin === "history" ? "History" : displayedResultRecord.origin === "bookmark" ? "Bookmark" : displayedResultRecord.origin === "job" ? "Reconnected" : "Latest", tone: "primary" },
      { label: `${formatCount(metrics.n)} trades`, tone: "muted" },
      { label: Number.isFinite(Number(metrics.roi)) ? `${metrics.roi >= 0 ? "+" : ""}${metrics.roi}% ROI` : "ROI --", tone: Number(metrics.roi) >= 0 ? "positive" : "danger" },
      counts ? { label: `${formatCount(counts.resolved)} resolved / ${formatCount(counts.candidates)} candidates`, tone: "muted" } : null,
      runIsStale ? { label: "Stale inputs", tone: "warning" } : null,
    ].filter(Boolean),
  };
}

function resolveExecutionBanner({
  replayRunStatus,
  replayRunError,
  activeBacktestJob,
  activeOptimizerJob,
  backtestProgress,
  liveRunState,
}) {
  if (replayRunError) {
    return {
      title: "Run failed",
      detail: replayRunError,
      tone: "danger",
      meta: null,
    };
  }
  if (activeBacktestJob?.jobId) {
    return {
      title: activeBacktestJob.status === "queued"
        ? "Server backtest queued"
        : activeBacktestJob.status === "cancel_requested"
          ? "Server backtest cancelling"
          : "Server backtest running",
      detail: activeBacktestJob.progress?.detail || "This backtest is running server-side and will reconnect automatically.",
      tone: "primary",
      meta: `${activeBacktestJob.progress?.stage || "running"} · ${formatDuration(activeBacktestJob.startedAt || activeBacktestJob.createdAt, activeBacktestJob.finishedAt)}`,
    };
  }
  if (activeOptimizerJob?.jobId && ["queued", "running_background", "running_interactive"].includes(String(activeOptimizerJob.status || ""))) {
    return {
      title: activeOptimizerJob.status === "queued" ? "Optimizer queued" : "Optimizer running in background",
      detail: activeOptimizerJob.progress?.detail || "The shortlist is running server-side.",
      tone: "warning",
      meta: `${activeOptimizerJob.progress?.stage || "running"} · ${formatDuration(activeOptimizerJob.startedAt || activeOptimizerJob.createdAt, activeOptimizerJob.finishedAt)}`,
    };
  }
  if (replayRunStatus === "loading") {
    const activeStep = backtestProgress?.steps?.find((step) => step.status === "active");
    return {
      title: "Interactive backtest running",
      detail: activeStep?.detail || liveRunState?.statusText || "Resolving contracts and replaying the staged inputs.",
      tone: "warning",
      meta: activeStep?.label || liveRunState?.stage || null,
    };
  }
  return null;
}

function ResearchInsightsLogsPanel({
  replayRunStatus,
  replayRunError,
  backtestProgress,
  liveRunState,
  activeBacktestJob,
  activeOptimizerJob,
  runtimeData,
  skippedByReason,
}) {
  const progressSteps = Array.isArray(backtestProgress?.steps) ? backtestProgress.steps : [];
  const runtimeRows = [
    ["Backtest status", replayRunError || replayRunStatus || "--"],
    ["Backtest job", activeBacktestJob?.jobId || "--"],
    ["Backtest phase", activeBacktestJob?.progress?.stage || liveRunState?.stage || "--"],
    ["Optimizer job", activeOptimizerJob?.jobId || "--"],
    ["Optimizer phase", activeOptimizerJob?.progress?.stage || "--"],
    ["Dataset", runtimeData?.replaySampleLabel || runtimeData?.selectionSummaryLabel || "--"],
    ["Spot source", runtimeData?.dataSource || "--"],
    ["Loaded bars", formatCount(runtimeData?.loadedBars)],
  ];

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "minmax(0, 1.3fr) minmax(0, 1fr)" }}>
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, background: "#fbfdff", padding: "10px 12px" }}>
          <div style={{ fontSize: 11, fontFamily: FS, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: B }}>Execution Phases</div>
          <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
            {!progressSteps.length ? (
              <div style={{ fontSize: 13, fontFamily: F, color: M }}>
                Run progress and heartbeat details will appear here once a backtest or optimizer is active.
              </div>
            ) : progressSteps.map((step) => (
              <div key={step.label} style={{ display: "grid", gap: 3 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontSize: 13, fontFamily: F, fontWeight: 700, color: "#0f172a" }}>{step.label}</div>
                  <StatusBadge tone={step.status === "complete" ? "positive" : step.status === "active" ? "warning" : "muted"}>
                    {step.status}
                  </StatusBadge>
                </div>
                <div style={{ fontSize: 12, fontFamily: F, color: "#64748b" }}>
                  {step.detail || (step.pct >= 0 ? `${step.pct}%` : "Waiting for progress heartbeat")}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, background: "#ffffff", padding: "10px 12px" }}>
          <div style={{ fontSize: 11, fontFamily: FS, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: B }}>Runtime Diagnostics</div>
          <div style={{ marginTop: 8, display: "grid", gap: 7 }}>
            {runtimeRows.map(([label, value]) => (
              <div key={label} style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: 8 }}>
                <div style={{ fontSize: 11, fontFamily: F, color: "#94a3b8", textTransform: "uppercase" }}>{label}</div>
                <div style={{ fontSize: 12, fontFamily: F, color: "#334155", wordBreak: "break-word" }}>{value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, background: "#ffffff", padding: "10px 12px" }}>
        <div style={{ fontSize: 11, fontFamily: FS, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: B }}>Skipped Reasons</div>
        <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {Object.keys(skippedByReason || {}).length ? Object.entries(skippedByReason).map(([reason, count]) => (
            <StatusBadge key={reason} tone="muted">{reason.replace(/_/g, " ")} · {count}</StatusBadge>
          )) : (
            <div style={{ fontSize: 13, fontFamily: F, color: M }}>No skipped-trade diagnostics recorded for the current result.</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ResearchInsightsTabPanel({
  bottomTab,
  onSelectTab,
  onRunOptimize,
  optRunning,
  optError,
  metrics,
  tradePnls,
  pnlDist,
  hourly,
  recoMatrix,
  recoComputing,
  recoError,
  onComputeReco,
  tfMin,
  strategy,
  onSelectStrategy,
  strategyPresets,
  strategyLabel,
  barsLength,
  dataSource,
  spotDataMeta,
  trades,
  skippedTrades,
  skippedByReason,
  replayRunStatus,
  replayRunError,
  backtestProgress,
  liveRunState,
  activeBacktestJob,
  activeOptimizerJob,
  displayedResultRecord,
  recentBacktestJobs,
  recentBacktestResults,
  recentOptimizerJobs,
  inputImpact,
  onRunInputImpact,
  rayalgoScoreStudy,
  onRunRayalgoScoringComparison,
  onRunRayalgoScoreStudy,
  onQueueRayalgoScoreStudy,
  onCancelRayalgoScoreStudy,
  onRefreshRayalgoScoreStudyCatalog,
  onSelectRayalgoScoreStudyPreset,
  onSelectRayalgoScoreStudyRun,
  onToggleRayalgoScoreStudyComparisonRun,
  onLoadRayalgoScoreStudyRunDetail,
  onImportRayalgoScoreStudyLocalArtifact,
  stagedConfigModel,
  runtimeData,
  logPage,
  setLogPage,
  selectedTradeId,
  onSelectTrade,
  optResults,
  onApplyOpt,
  onSaveOptBundle,
  onSaveHistoryBundle,
  onPromoteBundle,
  runHistory,
  optimizerHistory,
  rayalgoBundles,
  currentSetupSnapshot,
  currentBundleContext,
  onLoadHistoryRun,
  onOpenStoredResult,
  onApplyHistoryOptimizer,
  onClearRunHistory,
  onClearOptimizerHistory,
}) {
  const executionBanner = resolveExecutionBanner({
    replayRunStatus,
    replayRunError,
    activeBacktestJob,
    activeOptimizerJob,
    backtestProgress,
    liveRunState,
  });
  const resultHeader = resolveResultHeader(displayedResultRecord, runtimeData?.runIsStale);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", flexShrink: 0, height: 28, gap: 0, marginBottom: 4 }}>
        {TAB_ITEMS.map(([key, label]) => (
          <button
            key={key}
            onClick={() => onSelectTab(key)}
            style={{
              padding: "0 10px",
              fontSize: 13,
              fontFamily: FS,
              fontWeight: bottomTab === key ? 600 : 400,
              background: "transparent",
              border: "none",
              borderBottom: bottomTab === key ? `2px solid ${B}` : "2px solid transparent",
              color: bottomTab === key ? "#1e293b" : "#a1a5ab",
              cursor: "pointer",
              height: 28,
              display: "flex",
              alignItems: "center",
              transition: "all 0.12s",
            }}
          >
            {label}
          </button>
        ))}
        <button
          onClick={onRunOptimize}
          disabled={optRunning}
          style={{
            marginLeft: "auto",
            padding: "2px 8px",
            fontSize: 12,
            fontFamily: FS,
            background: optRunning ? "#fffbeb" : `${B}08`,
            border: `1px solid ${optRunning ? `${Y}66` : `${B}33`}`,
            borderRadius: 4,
            color: optRunning ? Y : B,
            cursor: optRunning ? "wait" : "pointer",
            fontWeight: 600,
            transition: "all 0.15s",
          }}
          title={optError || undefined}
        >
          {optRunning ? "Running..." : "Optimize"}
        </button>
      </div>

      <ResearchInsightsLiveRunStrip
        runStatus={replayRunStatus}
        backtestProgress={backtestProgress}
        liveRunState={liveRunState}
      />

      {executionBanner ? (
        <div style={{ marginBottom: 6, border: `1px solid ${executionBanner.tone === "danger" ? `${R}33` : executionBanner.tone === "warning" ? `${Y}33` : `${B}33`}`, borderRadius: 10, background: executionBanner.tone === "danger" ? `${R}08` : executionBanner.tone === "warning" ? `${Y}08` : `${B}08`, padding: "10px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <div style={{ fontSize: 13, fontFamily: F, fontWeight: 700, color: "#0f172a" }}>{executionBanner.title}</div>
            {executionBanner.meta ? <StatusBadge tone={executionBanner.tone === "warning" ? "warning" : executionBanner.tone === "danger" ? "danger" : "primary"}>{executionBanner.meta}</StatusBadge> : null}
          </div>
          <div style={{ marginTop: 4, fontSize: 12.5, fontFamily: F, color: "#475569", lineHeight: 1.45 }}>
            {executionBanner.detail}
          </div>
        </div>
      ) : null}

      {resultHeader ? (
        <div style={{ marginBottom: 6, border: `1px solid ${BORDER}`, borderRadius: 10, background: "#fbfdff", padding: "10px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 12, fontFamily: F, fontWeight: 700, color: "#0f172a" }}>{resultHeader.title}</div>
              <div style={{ marginTop: 3, fontSize: 12, fontFamily: F, color: "#64748b" }}>{resultHeader.subtitle}</div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {resultHeader.chips.map((chip) => (
                <StatusBadge key={chip.label} tone={chip.tone}>{chip.label}</StatusBadge>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <div
        style={{
          background: CARD,
          border: `1px solid ${BORDER}`,
          borderRadius: 8,
          padding: "8px 10px",
          overflow: "visible",
          boxShadow: SH1,
        }}
      >
        {bottomTab === "overview" && (
          <div style={{ display: "grid", gap: 12 }}>
            <ResearchInsightsAnalysisTab
              hourly={hourly}
              metrics={metrics}
              skippedTrades={skippedTrades}
              skippedByReason={skippedByReason}
              replayRunStatus={replayRunStatus}
              replayRunError={replayRunError}
              inputImpact={inputImpact}
              onRunInputImpact={onRunInputImpact}
              onRunRayalgoScoringComparison={onRunRayalgoScoringComparison}
              stagedConfigModel={stagedConfigModel}
              runtimeData={runtimeData}
            />
            <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 10 }}>
              <ResearchInsightsRecommendationTab
                recoMatrix={recoMatrix}
                recoComputing={recoComputing}
                errorMessage={recoError}
                onComputeReco={onComputeReco}
                tfMin={tfMin}
                strategy={strategy}
                onSelectStrategy={onSelectStrategy}
                strategyPresets={strategyPresets}
                strategyLabel={strategyLabel}
                barsLength={barsLength}
                dataSource={dataSource}
                spotDataMeta={spotDataMeta}
              />
            </div>
          </div>
        )}
        {bottomTab === "performance" && (
          <ResearchInsightsWaterfallTab tradePnls={tradePnls} pnlDist={pnlDist} isRunning={replayRunStatus === "loading"} />
        )}
        {bottomTab === "score_testing" && (
          <ResearchInsightsScoreStudyTab
            strategy={strategy}
            scoreStudy={rayalgoScoreStudy}
            onRunScoreStudy={onRunRayalgoScoreStudy}
            onQueueScoreStudy={onQueueRayalgoScoreStudy}
            onCancelScoreStudyJob={onCancelRayalgoScoreStudy}
            onRefreshScoreStudyCatalog={onRefreshRayalgoScoreStudyCatalog}
            onSelectScoreStudyPreset={onSelectRayalgoScoreStudyPreset}
            onSelectScoreStudyRun={onSelectRayalgoScoreStudyRun}
            onToggleCompareRun={onToggleRayalgoScoreStudyComparisonRun}
            onLoadScoreStudyRunDetail={onLoadRayalgoScoreStudyRunDetail}
            onImportLocalArtifact={onImportRayalgoScoreStudyLocalArtifact}
            runtimeData={runtimeData}
          />
        )}
        {bottomTab === "trades" && (
          <ResearchInsightsLogTab
            trades={trades}
            skippedTrades={skippedTrades}
            logPage={logPage}
            setLogPage={setLogPage}
            selectedTradeId={selectedTradeId}
            onSelectTrade={replayRunStatus === "ready" ? onSelectTrade : null}
            isRunning={replayRunStatus === "loading"}
          />
        )}
        {bottomTab === "logs" && (
          <ResearchInsightsLogsPanel
            replayRunStatus={replayRunStatus}
            replayRunError={replayRunError}
            backtestProgress={backtestProgress}
            liveRunState={liveRunState}
            activeBacktestJob={activeBacktestJob}
            activeOptimizerJob={activeOptimizerJob}
            runtimeData={runtimeData}
            skippedByReason={skippedByReason}
          />
        )}
        {bottomTab === "optimize" && (
          <ResearchInsightsOptimizeTab
            optResults={optResults}
            onRunOptimize={onRunOptimize}
            optRunning={optRunning}
            errorMessage={optError}
            strategyLabel={strategyLabel}
            onApplyOpt={onApplyOpt}
            onSaveOptBundle={onSaveOptBundle}
            activeOptimizerJob={activeOptimizerJob}
          />
        )}
        {bottomTab === "history" && (
          <ResearchInsightsHistoryTab
            runHistory={runHistory}
            optimizerHistory={optimizerHistory}
            recentResults={recentBacktestResults}
            recentBacktestJobs={recentBacktestJobs}
            recentOptimizerJobs={recentOptimizerJobs}
            rayalgoBundles={rayalgoBundles}
            currentSetupSnapshot={currentSetupSnapshot}
            currentBundleContext={currentBundleContext}
            onLoadHistoryRun={onLoadHistoryRun}
            onOpenStoredResult={onOpenStoredResult}
            onApplyHistoryOptimizer={onApplyHistoryOptimizer}
            onSaveOptBundle={onSaveOptBundle}
            onSaveHistoryBundle={onSaveHistoryBundle}
            onPromoteBundle={onPromoteBundle}
            onClearRunHistory={onClearRunHistory}
            onClearOptimizerHistory={onClearOptimizerHistory}
            strategyLabel={strategyLabel}
          />
        )}
      </div>
    </>
  );
}
