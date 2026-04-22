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
import {
  BACKTEST_V2_RF_CALIBRATOR_SECTION,
  BACKTEST_V2_STAGE_DEFAULTS,
} from "../../../research/config/backtestV2StagingConfig.js";
import DraftNumberInput from "../../shared/DraftNumberInput.jsx";
import { B, BORDER, CARD, F, FS, G, GRID, InsightsTooltip, M, R, REF, SH1, Y } from "./shared.jsx";
import ResearchInsightsInputImpactCard from "./ResearchInsightsInputImpactCard.jsx";

const ANALYSIS_CHART_HEIGHT = 248;

function summarizeSkipReasons(skippedByReason = {}) {
  return Object.entries(skippedByReason || {})
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([reason, count]) => `${reason.replace(/_/g, " ")} ${count}`)
    .join(" · ");
}

function formatRuntimeCount(runtimeData = {}) {
  const loadedBars = Number(runtimeData.loadedBars);
  if (Number.isFinite(loadedBars) && loadedBars > 0) {
    return loadedBars;
  }
  const liveBarCount = Number(runtimeData.liveBarCount);
  return Number.isFinite(liveBarCount) && liveBarCount > 0 ? liveBarCount : 0;
}

function describeSpotSource(runtimeData = {}) {
  const count = formatRuntimeCount(runtimeData);
  if (runtimeData.dataError) {
    return runtimeData.dataError;
  }
  if (runtimeData.dataSource === "loading") {
    return runtimeData.hasLoadedSpotHistory ? "Refreshing real spot history." : "Loading real spot history.";
  }
  if (runtimeData.dataSource === "massive") {
    return `${count} bars from ${runtimeData.spotDataMeta?.source || "Massive vendor history"}${runtimeData.spotDataMeta?.stale ? " (cached/stale)" : ""}.`;
  }
  if (runtimeData.dataSource === "market") {
    return `${count} bars from ${runtimeData.spotDataMeta?.source || "broker market data"}${runtimeData.spotDataMeta?.stale ? " (cached/stale)" : ""}.`;
  }
  return "Real spot history is unavailable.";
}

function describeCredentialState(runtimeData = {}) {
  return runtimeData.replayCredentialsReady
    ? `${runtimeData.replayCredentialSource || "Massive"} credentials detected.`
    : "Massive option-history credentials are managed in Accounts.";
}

function describeExecutionFidelity(runtimeData = {}) {
  return runtimeData.executionFidelity === "sub_candle"
    ? "Signals run on the signal tape. Entries and exits execute on finer spot bars when available."
    : "Entries and exits execute at the signal-bar close only.";
}

function describeOptionsRun(runtimeData = {}) {
  if (runtimeData.replayRunError) {
    return runtimeData.replayRunError;
  }
  if (runtimeData.replayRunStatus === "loading") {
    return "Resolving Massive contracts and loading option history.";
  }
  if (runtimeData.replayDatasetSummary) {
    const summary = runtimeData.replayDatasetSummary;
    return `${summary.resolved} resolved · ${summary.skipped} skipped · ${summary.uniqueContracts} contracts cached${runtimeData.replaySampleLabel ? ` · ${runtimeData.replaySampleLabel}` : ""}`;
  }
  if (runtimeData.replayRunStatus === "ready") {
    return "Massive-backed options run is ready.";
  }
  if (runtimeData.replayRunStatus === "error") {
    return "Massive-backed options run failed.";
  }
  return "Options run status will appear here after the next execution.";
}

function describeBacktestWorkflow(runtimeData = {}) {
  if (runtimeData.runIsStale) {
    return "Results are from the last completed run. Inputs changed since then.";
  }
  if (runtimeData.hasQueuedRerun) {
    return "One rerun is queued behind the active backtest.";
  }
  if (runtimeData.replayRunStatus === "loading") {
    return "Running the current staged setup now.";
  }
  if (runtimeData.replayRunStatus === "ready") {
    return "Latest manual run is in sync with the current staged inputs.";
  }
  return "Press Run Backtest to execute the staged inputs.";
}

function describeRayAlgoScoring(runtimeData = {}) {
  const context = runtimeData.rayalgoScoringContext;
  if (!context) {
    return null;
  }
  const activeTimeframe = String(context.activeTimeframe || "").trim() || "--";
  const signalRole = String(context.signalRole || "").trim() || "actionable";
  const ladderId = String(context.precursorLadderId || "").trim() || "none";
  const authority = String(context.authority || "").trim() || "observe_only";
  const displayModePreference = String(context.displayModePreference || "").trim() || "auto";
  const displayScoreMode = String(context.displayScoreMode || context.displayMode || "").trim() || "";
  const dataStatus = String(context.dataStatus || "").trim() || "none";
  const labelMode = displayModePreference === "auto" && displayScoreMode
    ? `label auto->${displayScoreMode}`
    : `label ${displayScoreMode || displayModePreference}`;
  return `${activeTimeframe} · ${signalRole} · ${authority} · ${labelMode} · ladder ${ladderId} · data ${dataStatus}`;
}

function describeRayAlgoLatestSignal(runtimeData = {}) {
  const signal = runtimeData.rayalgoLatestSignal;
  if (!signal) {
    return null;
  }
  const ts = String(signal.ts || "").trim() || "--";
  const activeTimeframe = String(signal.activeTimeframe || "").trim() || "--";
  const signalRole = String(signal.signalRole || "").trim() || "actionable";
  const direction = signal.direction === "short" ? "short" : "long";
  const rawScore = Number.isFinite(Number(signal.rawScore)) ? Number(signal.rawScore).toFixed(2) : "--";
  const bonus = Number.isFinite(Number(signal.precursorBonus)) ? Number(signal.precursorBonus).toFixed(2) : "--";
  const score = Number.isFinite(Number(signal.score)) ? Number(signal.score).toFixed(2) : "--";
  const conflict = signal.hasConflict ? "conflict" : "clean";
  return `${ts} · ${activeTimeframe} ${signalRole} · ${direction} · raw ${rawScore} + ${bonus} = ${score} · ${conflict}`;
}

function getRayAlgoCompareStatusMeta(status) {
  if (status === "better") {
    return {
      label: "Improved",
      color: G,
      border: `${G}33`,
      background: `${G}10`,
    };
  }
  if (status === "worse") {
    return {
      label: "Worse",
      color: R,
      border: `${R}33`,
      background: `${R}10`,
    };
  }
  if (status === "mixed") {
    return {
      label: "Mixed",
      color: Y,
      border: `${Y}33`,
      background: `${Y}10`,
    };
  }
  if (status === "neutral") {
    return {
      label: "Matched",
      color: B,
      border: `${B}33`,
      background: `${B}10`,
    };
  }
  return {
    label: "Baseline",
    color: M,
    border: BORDER,
    background: "#f8fafc",
  };
}

function formatSignedDelta(value, { currency = false, precision = 2 } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "0";
  }
  if (numeric === 0) {
    return currency ? "$0" : "0";
  }
  const absolute = Math.abs(numeric).toFixed(precision).replace(/\.?0+$/, "");
  const prefix = numeric > 0 ? "+" : "-";
  return currency ? `${prefix}$${absolute}` : `${prefix}${absolute}`;
}

function formatCountDelta(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric === 0) {
    return "0";
  }
  return `${numeric > 0 ? "+" : ""}${numeric}`;
}

function getDeltaTone(value, { inverse = false } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric === 0) {
    return M;
  }
  if (inverse) {
    return numeric < 0 ? G : R;
  }
  return numeric > 0 ? G : R;
}

function CompareChip({ label, value, tone = M, detail = null }) {
  return (
    <div
      style={{
        minWidth: 0,
        padding: "8px 10px",
        borderRadius: 8,
        border: `1px solid ${BORDER}`,
        background: "#f8fafc",
      }}
    >
      <div style={{ fontSize: 10, color: "#94a3b8", fontFamily: F, letterSpacing: "0.08em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ marginTop: 4, fontSize: 14, color: tone, fontFamily: F, fontWeight: 700 }}>{value}</div>
      {detail ? (
        <div style={{ marginTop: 3, fontSize: 11, color: M, fontFamily: F, lineHeight: 1.35 }}>
          {detail}
        </div>
      ) : null}
    </div>
  );
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

function RayAlgoScoringCompareCard({ runtimeData = null, onRunComparison = null }) {
  const comparison = runtimeData?.rayalgoScoringComparison;
  if (!comparison || comparison.status === "disabled") {
    return null;
  }

  if (comparison.status === "loading") {
    return (
      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "10px 12px", background: "#ffffff" }}>
        <div style={{ fontSize: 13, color: B, fontFamily: FS, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600, marginBottom: 4 }}>
          RayAlgo Score Compare
        </div>
        <div style={{ fontSize: 13, color: Y, fontFamily: F }}>
          Replaying baseline `none · observe_only` against the current RayAlgo scoring mode...
        </div>
      </div>
    );
  }

  if (comparison.status === "error") {
    return (
      <div style={{ border: `1px solid ${R}33`, borderRadius: 8, padding: "10px 12px", background: `${R}08` }}>
        <div style={{ fontSize: 13, color: R, fontFamily: FS, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600, marginBottom: 4 }}>
          RayAlgo Score Compare
        </div>
        <div style={{ fontSize: 13, color: "#7f1d1d", fontFamily: F }}>
          {comparison.error || "Failed to compare the current RayAlgo scoring mode against the baseline."}
        </div>
        <div style={{ marginTop: 8 }}>
          <ActionButton onClick={onRunComparison} disabled={!comparison.canRun || typeof onRunComparison !== "function"}>
            Run Compare
          </ActionButton>
        </div>
      </div>
    );
  }

  const summary = comparison.summary;
  if (!summary || !comparison.isCurrent) {
    return (
      <div
        style={{
          border: `1px solid ${BORDER}`,
          borderRadius: 8,
          padding: "10px 12px",
          background: "#ffffff",
          boxShadow: SH1,
          display: "grid",
          gap: 8,
        }}
      >
        <div>
          <div style={{ fontSize: 13, color: B, fontFamily: FS, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>
            RayAlgo Score Compare
          </div>
          <div style={{ marginTop: 2, fontSize: 12, color: M, fontFamily: F, lineHeight: 1.45 }}>
            {comparison.canRun
              ? "Manual diagnostic. Replays baseline `none · observe_only` against the current synced RayAlgo scoring mode."
              : comparison.blockedReason || "Run a synced RayAlgo options-history backtest before comparing scoring modes."}
          </div>
        </div>
        <div>
          <ActionButton onClick={onRunComparison} disabled={!comparison.canRun || typeof onRunComparison !== "function"}>
            Run Compare
          </ActionButton>
        </div>
      </div>
    );
  }

  const statusMeta = getRayAlgoCompareStatusMeta(summary.status);
  return (
    <div
      style={{
        border: `1px solid ${BORDER}`,
        borderRadius: 8,
        padding: "10px 12px",
        background: "#ffffff",
        boxShadow: SH1,
        display: "grid",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, color: B, fontFamily: FS, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>
            RayAlgo Score Compare
          </div>
          <div style={{ marginTop: 2, fontSize: 12, color: M, fontFamily: F, lineHeight: 1.45 }}>
            {summary.headline}
          </div>
        </div>
        <div
          style={{
            whiteSpace: "nowrap",
            padding: "3px 8px",
            borderRadius: 999,
            border: `1px solid ${statusMeta.border}`,
            background: statusMeta.background,
            color: statusMeta.color,
            fontFamily: F,
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          {statusMeta.label}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
          gap: 6,
        }}
      >
        <RuntimeRow label="Current Mode" value={summary.currentModeLabel} tone={B} />
        <RuntimeRow label="Baseline Mode" value={summary.baselineModeLabel} tone={M} />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))",
          gap: 6,
        }}
      >
        <CompareChip
          label="PnL"
          value={formatSignedDelta(summary.delta?.pnl, { currency: true, precision: 0 })}
          tone={getDeltaTone(summary.delta?.pnl)}
          detail={`${summary.baselineMetrics?.pnl ?? 0} -> ${summary.currentMetrics?.pnl ?? 0}`}
        />
        <CompareChip
          label="PF"
          value={formatSignedDelta(summary.delta?.pf, { precision: 2 })}
          tone={getDeltaTone(summary.delta?.pf)}
          detail={`${summary.baselineMetrics?.pf ?? 0} -> ${summary.currentMetrics?.pf ?? 0}`}
        />
        <CompareChip
          label="DD"
          value={formatSignedDelta(summary.delta?.dd, { precision: 1 })}
          tone={getDeltaTone(summary.delta?.dd, { inverse: true })}
          detail={`${summary.baselineMetrics?.dd ?? 0}% -> ${summary.currentMetrics?.dd ?? 0}%`}
        />
        <CompareChip
          label="Trades"
          value={formatCountDelta(summary.delta?.tradeCount)}
          tone={getDeltaTone(summary.delta?.tradeCount)}
          detail={`${summary.baselineTradeCount} -> ${summary.currentTradeCount}`}
        />
        <CompareChip
          label="Signals"
          value={formatCountDelta(summary.delta?.signalCount)}
          tone={getDeltaTone(summary.delta?.signalCount)}
          detail={`${summary.baselineSignalCount} -> ${summary.currentSignalCount}`}
        />
      </div>

      <div style={{ fontSize: 11.5, color: "#64748b", fontFamily: F, lineHeight: 1.45 }}>
        {summary.matchingTrades
          ? "Trade signatures match the baseline run."
          : "Trade signatures drifted versus the baseline run."}
        {" · "}
        {summary.matchingMetrics
          ? "Aggregate metrics match."
          : "Aggregate metrics changed."}
      </div>
    </div>
  );
}

function getValueAtPath(state, path) {
  return String(path || "")
    .split(".")
    .filter(Boolean)
    .reduce((current, key) => (current == null ? current : current[key]), state);
}

function formatFieldValue(value) {
  if (typeof value !== "number") {
    return String(value ?? "");
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

function RuntimeRow({ label, value, tone = "#334155", spanFull = false }) {
  if (!value) {
    return null;
  }
  return (
    <div
      style={{
        gridColumn: spanFull ? "1 / -1" : undefined,
        padding: "8px 10px",
        borderRadius: 8,
        border: `1px solid ${BORDER}` ,
        background: "#f8fafc",
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 10, color: "#94a3b8", fontFamily: F, letterSpacing: "0.08em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ marginTop: 3, fontSize: 12, color: tone, fontFamily: F, lineHeight: 1.45, wordBreak: "break-word" }}>{value}</div>
    </div>
  );
}

function RuntimeDataCard({ runtimeData = {}, skippedByReason = {} }) {
  if (!runtimeData) {
    return null;
  }
  const skipSummary = summarizeSkipReasons(runtimeData.replaySkippedByReason || skippedByReason);
  const spotTone = runtimeData.dataError
    ? Y
    : runtimeData.dataSource === "loading"
      ? Y
      : runtimeData.dataSource === "massive" || runtimeData.dataSource === "market"
        ? G
        : M;
  const credentialTone = runtimeData.replayCredentialsReady ? G : M;
  const runTone = runtimeData.replayRunError ? R : runtimeData.replayRunStatus === "loading" ? Y : runtimeData.replayDatasetSummary ? G : M;
  const scoringTone = runtimeData.rayalgoScoringContext?.dataStatus === "degraded" ? Y : G;

  return (
    <div
      style={{
        border: `1px solid ${BORDER}` ,
        borderRadius: 8,
        padding: "10px 12px",
        background: CARD,
        boxShadow: SH1,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 13, color: B, fontFamily: F, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>
            Runtime &amp; Data
          </div>
          <div style={{ fontSize: 12, color: M, fontFamily: F, marginTop: 2 }}>
            {String(runtimeData.marketSymbol || "SPY").toUpperCase()} · real spot history + Massive options history
          </div>
        </div>
        {runtimeData.canOpenAccounts ? (
          <button
            type="button"
            onClick={() => runtimeData.onOpenAccounts?.()}
            style={{
              padding: "4px 8px",
              fontSize: 11,
              fontFamily: F,
              borderRadius: 6,
              border: `1px solid ${BORDER}` ,
              background: "#ffffff",
              color: "#475569",
              cursor: "pointer",
            }}
          >
            Accounts
          </button>
        ) : null}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6 }}>
        <RuntimeRow label="Spot History" value={describeSpotSource(runtimeData)} tone={spotTone} />
        <RuntimeRow label="Massive Options" value={describeCredentialState(runtimeData)} tone={credentialTone} />
        <RuntimeRow label="Execution" value={describeExecutionFidelity(runtimeData)} tone={runtimeData.executionFidelity === "sub_candle" ? G : M} />
        <RuntimeRow label="Backtest Flow" value={describeBacktestWorkflow(runtimeData)} tone={runtimeData.runIsStale ? B : (runtimeData.hasQueuedRerun || runtimeData.replayRunStatus === "loading" ? Y : G)} />
        <RuntimeRow label="Contract Selection" value={runtimeData.selectionSummaryLabel || "Awaiting contract selection settings."} />
        {describeRayAlgoScoring(runtimeData) ? (
          <RuntimeRow label="RayAlgo Scoring" value={describeRayAlgoScoring(runtimeData)} tone={scoringTone} spanFull />
        ) : null}
        {describeRayAlgoLatestSignal(runtimeData) ? (
          <RuntimeRow label="Latest Signal" value={describeRayAlgoLatestSignal(runtimeData)} tone={B} spanFull />
        ) : null}
        <RuntimeRow label="Options Run" value={describeOptionsRun(runtimeData)} tone={runTone} spanFull />
        {skipSummary ? <RuntimeRow label="Top Skips" value={skipSummary} spanFull /> : null}
      </div>
    </div>
  );
}

function RfCalibratorField({ field, value, changed, onChange }) {
  return (
    <label
      style={{
        display: "grid",
        gap: 5,
        padding: "8px 10px",
        borderRadius: 8,
        border: `1px solid ${changed ? "#fdba74" : BORDER}`,
        background: changed ? "#fffaf0" : "#f8fafc",
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 11, color: "#334155", fontFamily: FS, fontWeight: 700 }}>{field.label}</span>
        <span style={{ fontSize: 10, color: changed ? Y : "#94a3b8", fontFamily: F, fontWeight: 700 }}>
          {formatFieldValue(value)}
        </span>
      </div>
      <DraftNumberInput
        value={value}
        onCommit={onChange}
        min={field.min == null ? undefined : field.min}
        max={field.max == null ? undefined : field.max}
        step={field.step == null ? 1 : field.step}
        style={{
          width: "100%",
          minWidth: 0,
          height: 30,
          padding: "0 10px",
          borderRadius: 7,
          border: `1px solid ${changed ? "#fdba74" : "#dbe2ea"}`,
          background: "#ffffff",
          color: "#0f172a",
          fontSize: 12,
          fontFamily: F,
          outline: "none",
          boxSizing: "border-box",
        }}
      />
    </label>
  );
}

function RfCalibratorCard({ stagedConfigModel = null }) {
  const rfState = stagedConfigModel?.state?.rfCalibrator;
  if (!rfState) {
    return null;
  }

  const changedCount = BACKTEST_V2_RF_CALIBRATOR_SECTION.fields.reduce((count, field) => (
    Object.is(
      getValueAtPath(stagedConfigModel.state, field.path),
      getValueAtPath(BACKTEST_V2_STAGE_DEFAULTS, field.path),
    )
      ? count
      : count + 1
  ), 0);

  return (
    <div
      style={{
        border: `1px solid ${BORDER}`,
        borderRadius: 8,
        padding: "10px 12px 12px",
        background: CARD,
        boxShadow: SH1,
        display: "grid",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, color: B, fontFamily: F, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>
            {BACKTEST_V2_RF_CALIBRATOR_SECTION.title}
          </div>
          <div style={{ marginTop: 4, fontSize: 12, color: M, fontFamily: FS, lineHeight: 1.45 }}>
            Advanced model tuning moved out of the primary input rail. Symbol and ticker lookup stay in the chart header; this card is frontend-only staging for now.
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 6, flexShrink: 0 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              minHeight: 24,
              padding: "0 8px",
              borderRadius: 999,
              border: "1px solid #cbd5f5",
              background: "#eef2ff",
              color: B,
              fontSize: 10.5,
              fontFamily: FS,
              fontWeight: 700,
            }}
          >
            Advanced
          </span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              minHeight: 24,
              padding: "0 8px",
              borderRadius: 999,
              border: "1px solid #fed7aa",
              background: "#fff7ed",
              color: "#c2410c",
              fontSize: 10.5,
              fontFamily: FS,
              fontWeight: 700,
            }}
          >
            Staging only
          </span>
          <button
            type="button"
            onClick={() => stagedConfigModel.resetSection?.(BACKTEST_V2_RF_CALIBRATOR_SECTION.key)}
            style={{
              minHeight: 24,
              padding: "0 10px",
              borderRadius: 999,
              border: `1px solid ${changedCount > 0 ? "#fdba74" : "#dbe2ea"}`,
              background: changedCount > 0 ? "#fff7ed" : "#ffffff",
              color: changedCount > 0 ? "#c2410c" : M,
              fontSize: 10.5,
              fontFamily: FS,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {changedCount > 0 ? `Reset ${changedCount}` : "Reset"}
          </button>
        </div>
      </div>

      <div style={{ fontSize: 11.5, color: "#64748b", fontFamily: FS, lineHeight: 1.5 }}>
        {BACKTEST_V2_RF_CALIBRATOR_SECTION.subtitle}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 8,
        }}
      >
        {BACKTEST_V2_RF_CALIBRATOR_SECTION.fields.map((field) => {
          const value = getValueAtPath(stagedConfigModel.state, field.path);
          const changed = !Object.is(value, getValueAtPath(BACKTEST_V2_STAGE_DEFAULTS, field.path));
          return (
            <RfCalibratorField
              key={field.path}
              field={field}
              value={value}
              changed={changed}
              onChange={(nextValue) => stagedConfigModel.setField?.(field.path, nextValue)}
            />
          );
        })}
      </div>
    </div>
  );
}

export default function ResearchInsightsAnalysisTab({
  hourly,
  metrics = {},
  skippedTrades = [],
  skippedByReason = {},
  replayRunStatus = "idle",
  replayRunError = null,
  inputImpact = null,
  onRunInputImpact = null,
  onRunRayalgoScoringComparison = null,
  stagedConfigModel = null,
  runtimeData = null,
}) {
  const expectancyMetrics = {
    wr: Number(metrics.wr || 0),
    avgW: Number(metrics.avgW || 0),
    avgL: Number(metrics.avgL || 0),
    exp: Number(metrics.exp || 0),
    totalFees: Number(metrics.totalFees || 0),
    n: Number(metrics.n || 0),
    avgBars: Number(metrics.avgBars || 0),
    streak: Number(metrics.streak || 0),
  };

  return (
    <div style={{ display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", gap: 6, height: "100%" }}>
      <div style={{ display: "grid", gap: 6 }}>
        <RuntimeDataCard runtimeData={runtimeData} skippedByReason={skippedByReason} />
        <ResearchInsightsInputImpactCard inputImpact={inputImpact} onRun={onRunInputImpact} />
        <RayAlgoScoringCompareCard runtimeData={runtimeData} onRunComparison={onRunRayalgoScoringComparison} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(320px, 0.92fr)", gap: 6, minHeight: 0 }}>
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
            P&amp;L by Hour (ET)
          </div>
          <div style={{ height: ANALYSIS_CHART_HEIGHT, minHeight: ANALYSIS_CHART_HEIGHT }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hourly}>
                <CartesianGrid stroke={GRID} strokeDasharray="2 2" />
                <XAxis dataKey="hour" tick={{ fill: "#9ca3af", fontSize: 13, fontFamily: F }} tickLine={false} />
                <YAxis
                  tick={{ fill: "#9ca3af", fontSize: 13, fontFamily: F }}
                  tickFormatter={(value) => `$${value}`}
                  tickLine={false}
                />
                <ReferenceLine y={0} stroke={REF} />
                <Tooltip content={<InsightsTooltip />} />
                <Bar dataKey="pnl" name="P&L ($)" radius={[2, 2, 0, 0]}>
                  {hourly.map((entry, index) => (
                    <Cell key={index} fill={entry.pnl >= 0 ? G : R} fillOpacity={0.55} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateRows: "auto auto", gap: 6, alignContent: "start" }}>
          <div style={{ padding: "8px 0" }}>
            <div
              style={{
                fontSize: 13,
                color: B,
                fontFamily: F,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                marginBottom: 6,
                fontWeight: 600,
              }}
            >
              Expectancy
            </div>
            <div style={{ fontFamily: F, fontSize: 15, lineHeight: 2.2, color: M }}>
              <span style={{ color: "#111827" }}>E[trade]</span> ={" "}
              <span style={{ color: G }}>{(expectancyMetrics.wr / 100).toFixed(3)} x ${expectancyMetrics.avgW}</span> +{" "}
              <span style={{ color: R }}>{(1 - expectancyMetrics.wr / 100).toFixed(3)} x ${expectancyMetrics.avgL}</span>
              <br />={" "}
              <span
                style={{
                  color: expectancyMetrics.exp > 0 ? G : R,
                  fontWeight: 700,
                  fontSize: 24,
                }}
              >
                ${expectancyMetrics.exp}
              </span>{" "}
              <span style={{ fontSize: 14, color: "#9ca3af" }}>per trade</span>
              <br />
              <span style={{ fontSize: 13, color: "#f97316" }}>
                Fees: -${expectancyMetrics.totalFees} total ($
                {expectancyMetrics.n > 0 ? (expectancyMetrics.totalFees / expectancyMetrics.n).toFixed(1) : "0"}/trade)
              </span>
            </div>
            <div style={{ fontSize: 14, color: M, fontFamily: F, lineHeight: 2, marginTop: 4 }}>
              Avg hold: <span style={{ color: "#111827", fontWeight: 600 }}>{expectancyMetrics.avgBars}b</span> (
              {(expectancyMetrics.avgBars * 5 / 60).toFixed(1)}h) · Streak:{" "}
              <span style={{ color: expectancyMetrics.streak <= 4 ? Y : R, fontWeight: 600 }}>
                {expectancyMetrics.streak}
              </span>
            </div>
            <div style={{ fontSize: 13, color: "#6b7280", fontFamily: F, lineHeight: 1.7, marginTop: 8 }}>
              Options Run:{" "}
              <span style={{ color: replayRunError ? R : replayRunStatus === "loading" ? Y : "#111827", fontWeight: 600 }}>
                {replayRunError ? "error" : replayRunStatus}
              </span>
              {" · "}
              Filled <span style={{ color: "#111827", fontWeight: 600 }}>{expectancyMetrics.n}</span>
              {" · "}
              Skipped <span style={{ color: skippedTrades.length ? Y : "#111827", fontWeight: 600 }}>{skippedTrades.length}</span>
            </div>
          </div>
          <RfCalibratorCard stagedConfigModel={stagedConfigModel} />
        </div>
      </div>
    </div>
  );
}
