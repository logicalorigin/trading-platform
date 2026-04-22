import React from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  B,
  BORDER,
  CARD,
  F,
  FS,
  G,
  GRID,
  M,
  REF,
  R,
  SH1,
  Y,
} from "./shared.jsx";
import {
  getRayAlgoScoreStudyPresetDefinition,
  listRayAlgoScoreStudyPresets,
  RAYALGO_SCORE_STUDY_SIGNAL_TIMEFRAMES,
  RAYALGO_SCORE_STUDY_PRESET_TRANCHE2_2M,
} from "../../../research/analysis/rayalgoScoreStudyPresets.js";
import { RAYALGO_VALIDATED_QUALITY_COMPONENTS } from "../../../research/analysis/rayalgoScoreStudy.js";
import {
  buildInlineScoreStudySummary,
  normalizeDirectionSummary,
  normalizeScoreStudyRunRecord,
} from "../../../research/analysis/rayalgoScoreStudyResearchModel.js";

const COVERAGE_TIER_OPTIONS = Object.freeze([
  { key: "all", label: "All" },
  { key: "top_50", label: "Top 50%" },
  { key: "top_25", label: "Top 25%" },
  { key: "top_10", label: "Top 10%" },
]);

const HORIZON_PLAYBACK_KEYS = Object.freeze(["3x", "6x", "12x", "24x", "48x", "72x", "96x", "120x"]);
const HORIZON_PLAYBACK_DIRECTIONS = Object.freeze([
  { key: "combined", label: "Combined" },
  { key: "long", label: "Long" },
  { key: "short", label: "Short" },
]);
const HORIZON_PLAYBACK_METRICS = Object.freeze([
  { key: "excursion_atr", label: "Best Move" },
  { key: "close_atr", label: "Close Result" },
  { key: "guidance_rate", label: "Direction Correct" },
]);
const HORIZON_PLAYBACK_RUN_COLORS = Object.freeze([B, "#0f766e", "#b45309"]);
const HORIZON_PLAYBACK_DIRECTION_STYLES = Object.freeze({
  combined: Object.freeze({ label: "Combined", strokeDasharray: undefined }),
  long: Object.freeze({ label: "Long", strokeDasharray: "6 3" }),
  short: Object.freeze({ label: "Short", strokeDasharray: "2 3" }),
});
const HORIZON_PLAYBACK_CHART_HEIGHT = 220;
const OPERATOR_PRESET_LABELS = Object.freeze({
  current_setup: "Current setup",
  tranche2_2m: "Baseline 2m",
  direction_rank_v1: "Direction rank",
  regime_rank_v1: "Regime rank",
  tranche3_split_floor: "Split cutoff",
  tranche3_hard_gated: "Hard gate",
});
const OPERATOR_PRESET_DESCRIPTIONS = Object.freeze({
  current_setup: "Use the active workbench scoring configuration.",
  tranche2_2m: "Reference 2-minute baseline used for comparisons.",
  direction_rank_v1: "Direction-aware ranking version.",
  regime_rank_v1: "Regime-aware ranking version.",
  tranche3_split_floor: "Soft cutoff version that de-emphasizes weaker signals.",
  tranche3_hard_gated: "Hard entry-gate version that blocks weaker signals.",
});
const SCORE_QUALITY_COMPONENTS = Object.freeze(
  (Array.isArray(RAYALGO_VALIDATED_QUALITY_COMPONENTS) ? RAYALGO_VALIDATED_QUALITY_COMPONENTS : []).map((component) => ({
    key: component.key,
    label: component.unit ? `${component.label} (${component.unit})` : component.label,
    weight: Math.round(Number(component.weight || 0) * 100),
    detail: component.description,
  })),
);
const RESEARCH_ONLY_DIAGNOSTICS = Object.freeze([
  {
    term: "ATR",
    detail: "Only the scale for a normal recent move. It is not the target.",
  },
  {
    term: "Monotonicity",
    detail: "A research check that higher scores really sort better than lower scores.",
  },
  {
    term: "Min / Delta Grid",
    detail: "Threshold sweeps for invalidation rules, not the main decision target.",
  },
  {
    term: "Tranche",
    detail: "An old internal version name. The operator view should treat it as just a version.",
  },
]);
const VALIDATED_QUALITY_SCORE_LABEL = "Validated Quality Score";
const VALIDATED_QUALITY_SCORE_HELP = "Blended realized outcome score from 0 to 1. Higher is better.";

function getOperatorPresetLabel(presetId = null, fallback = "") {
  return OPERATOR_PRESET_LABELS[String(presetId || "").trim()] || fallback || "--";
}

function getOperatorPresetDescription(presetId = null, fallback = "") {
  return OPERATOR_PRESET_DESCRIPTIONS[String(presetId || "").trim()] || fallback || "Preset description unavailable.";
}

function getScoreSourceLabel(scoreType = "final") {
  if (scoreType === "raw") {
    return "Base score";
  }
  if (scoreType === "effective") {
    return "Live score";
  }
  return "Adjusted score";
}

function getStudyModeLabel(mode = "forward") {
  if (mode === "tenure") {
    return "Stayed right";
  }
  return "Move quality";
}

function SectionCard({ title, subtitle = null, children }) {
  return (
    <div
      style={{
        border: `1px solid ${BORDER}`,
        borderRadius: 10,
        background: CARD,
        boxShadow: SH1,
        padding: "12px 14px",
        minWidth: 0,
      }}
    >
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 12, color: B, fontFamily: FS, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 700 }}>
          {title}
        </div>
        {subtitle ? <div style={{ marginTop: 4, fontSize: 12, color: M, fontFamily: F, lineHeight: 1.45 }}>{subtitle}</div> : null}
      </div>
      {children}
    </div>
  );
}

function WarningList({ warnings = [] }) {
  if (!warnings.length) {
    return null;
  }
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {warnings.map((warning) => (
        <div
          key={warning}
          style={{
            padding: "8px 10px",
            borderRadius: 8,
            border: `1px solid ${Y}33`,
            background: `${Y}10`,
            color: "#7c2d12",
            fontSize: 12,
            fontFamily: F,
            lineHeight: 1.45,
          }}
        >
          {warning}
        </div>
      ))}
    </div>
  );
}

function getStatusMeta(scoreStudy) {
  if (scoreStudy?.stale) {
    return { label: "Stale", color: Y, border: `${Y}33`, background: `${Y}10` };
  }
  if (scoreStudy?.status === "loading") {
    return { label: "Running", color: B, border: `${B}33`, background: `${B}10` };
  }
  if (scoreStudy?.status === "ready") {
    return { label: "Ready", color: G, border: `${G}33`, background: `${G}10` };
  }
  return { label: "Idle", color: M, border: BORDER, background: "#f8fafc" };
}

function summaryTone(value) {
  if (value === "helpful" || value === "final" || value === "keep_all_arrows") return G;
  if (value === "harmful" || value === "raw" || value === "hide_below_floor") return R;
  if (value === "fade_below_floor") return Y;
  return B;
}

function toFiniteNumber(value) {
  if (value == null) {
    return null;
  }
  if (typeof value === "string" && !value.trim()) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatSigned(value, digits = 2, suffix = "") {
  const numeric = toFiniteNumber(value);
  if (numeric == null) {
    return "--";
  }
  return `${numeric > 0 ? "+" : ""}${numeric.toFixed(digits)}${suffix}`;
}

function formatCount(value) {
  const numeric = toFiniteNumber(value);
  return numeric == null ? "--" : String(numeric);
}

function PillButton({ active = false, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        minHeight: 28,
        padding: "0 10px",
        borderRadius: 999,
        border: `1px solid ${active ? `${B}55` : BORDER}`,
        background: active ? `${B}10` : "#ffffff",
        color: active ? B : M,
        fontSize: 11.5,
        fontFamily: F,
        fontWeight: active ? 700 : 600,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function SummaryMetric({ label, value, tone = B, detail = null }) {
  return (
    <div style={{ padding: "10px 12px", borderRadius: 8, background: "#f8fafc", border: `1px solid ${BORDER}` }}>
      <div style={{ fontSize: 10, color: M, fontFamily: F, letterSpacing: "0.08em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ marginTop: 6, fontSize: 18, color: tone, fontFamily: F, fontWeight: 800, lineHeight: 1.1 }}>{value}</div>
      {detail ? <div style={{ marginTop: 5, fontSize: 11.5, color: M, fontFamily: F, lineHeight: 1.4 }}>{detail}</div> : null}
    </div>
  );
}

function ProcessStepCard({ step, title, tone = B, children }) {
  return (
    <div
      style={{
        display: "grid",
        gap: 8,
        padding: "12px 14px",
        borderRadius: 10,
        border: `1px solid ${BORDER}`,
        background: "#f8fafc",
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: 22,
            height: 22,
            borderRadius: 999,
            background: `${tone}14`,
            color: tone,
            fontSize: 11,
            fontFamily: F,
            fontWeight: 800,
          }}
        >
          {step}
        </span>
        <div style={{ fontSize: 12.5, color: "#0f172a", fontFamily: FS, fontWeight: 700 }}>{title}</div>
      </div>
      <div style={{ fontSize: 12.5, color: "#334155", fontFamily: F, lineHeight: 1.55 }}>
        {children}
      </div>
    </div>
  );
}

function getHorizonPlaybackMetricDefinition(metricKey = "excursion_atr") {
  return HORIZON_PLAYBACK_METRICS.find((metric) => metric.key === metricKey) || HORIZON_PLAYBACK_METRICS[0];
}

function getHorizonPlaybackMetricHelp(metricKey = "excursion_atr") {
  if (metricKey === "close_atr") {
    return "Close Result = average return when the horizon ends, scaled to a normal recent move. +1.0 is about one typical move.";
  }
  if (metricKey === "guidance_rate") {
    return "Direction Correct = percent of forward windows that finished in the signal's predicted direction.";
  }
  return "Best Move = average favorable move minus adverse move inside the horizon, scaled to a normal recent move.";
}

function resolveForwardStudyMode(result = null) {
  if (result?.studyModes?.forward) {
    return result.studyModes.forward;
  }
  if (!result) {
    return null;
  }
  return {
    directionSummaries: result.directionSummaries || {},
  };
}

function readHorizonPlaybackMetrics(run = null, directionKey = "combined", horizonKey = "3x") {
  const forwardStudy = resolveForwardStudyMode(run?.result || null);
  const directionSummary = forwardStudy?.directionSummaries?.[directionKey] || null;
  const overall = directionSummary?.horizonSummaries?.[horizonKey]?.final?.overall || null;
  if (!overall) {
    return null;
  }
  return {
    signalCount: Number.isFinite(Number(overall.signalCount)) ? Number(overall.signalCount) : null,
    guidanceRatePct: Number.isFinite(Number(overall.guidanceRatePct)) ? Number(overall.guidanceRatePct) : null,
    meanExcursionEdgeAtr: Number.isFinite(Number(overall.meanExcursionEdgeAtr)) ? Number(overall.meanExcursionEdgeAtr) : null,
    meanCloseReturnAtr: Number.isFinite(Number(overall.meanCloseReturnAtr)) ? Number(overall.meanCloseReturnAtr) : null,
    meanMfeAtr: Number.isFinite(Number(overall.meanMfeAtr)) ? Number(overall.meanMfeAtr) : null,
    meanMaeAtr: Number.isFinite(Number(overall.meanMaeAtr)) ? Number(overall.meanMaeAtr) : null,
  };
}

function hasAnyHorizonPlaybackData(run = null) {
  return HORIZON_PLAYBACK_DIRECTIONS.some((direction) => (
    HORIZON_PLAYBACK_KEYS.some((horizonKey) => readHorizonPlaybackMetrics(run, direction.key, horizonKey))
  ));
}

function getHorizonPlaybackMetricValue(metricKey = "excursion_atr", metrics = null) {
  if (!metrics) {
    return null;
  }
  if (metricKey === "close_atr") {
    return metrics.meanCloseReturnAtr;
  }
  if (metricKey === "guidance_rate") {
    return metrics.guidanceRatePct;
  }
  return metrics.meanExcursionEdgeAtr;
}

function formatHorizonPlaybackValue(metricKey = "excursion_atr", value = null, digits = null) {
  const numeric = toFiniteNumber(value);
  if (numeric == null) {
    return "--";
  }
  if (metricKey === "guidance_rate") {
    return `${numeric.toFixed(digits == null ? 1 : digits)}%`;
  }
  return formatSigned(numeric, digits == null ? 3 : digits);
}

function formatHorizonPlaybackAxisValue(metricKey = "excursion_atr", value = null) {
  const numeric = toFiniteNumber(value);
  if (numeric == null) {
    return "--";
  }
  if (metricKey === "guidance_rate") {
    return `${numeric.toFixed(0)}%`;
  }
  return numeric.toFixed(2);
}

function horizonPlaybackTone(metricKey = "excursion_atr", value = null) {
  if (metricKey === "guidance_rate") {
    return B;
  }
  const numeric = toFiniteNumber(value);
  if (numeric == null) {
    return M;
  }
  return numeric >= 0 ? G : R;
}

function formatHorizonPlaybackSecondary(metricKey = "excursion_atr", metrics = null) {
  if (!metrics) {
    return "No forward sample";
  }
  if (metricKey === "close_atr") {
    return `best move ${formatHorizonPlaybackValue("excursion_atr", metrics.meanExcursionEdgeAtr)} · direction correct ${formatHorizonPlaybackValue("guidance_rate", metrics.guidanceRatePct)}`;
  }
  if (metricKey === "guidance_rate") {
    return `best move ${formatHorizonPlaybackValue("excursion_atr", metrics.meanExcursionEdgeAtr)} · close result ${formatHorizonPlaybackValue("close_atr", metrics.meanCloseReturnAtr)}`;
  }
  return `close result ${formatHorizonPlaybackValue("close_atr", metrics.meanCloseReturnAtr)} · direction correct ${formatHorizonPlaybackValue("guidance_rate", metrics.guidanceRatePct)}`;
}

function buildHorizonPlaybackRows(runs = [], directionKey = "combined", metricKey = "excursion_atr") {
  return HORIZON_PLAYBACK_KEYS.map((horizonKey) => {
    const row = {
      horizonKey,
      runMetrics: {},
    };
    runs.forEach((run) => {
      if (!run?.runId) {
        return;
      }
      const metrics = readHorizonPlaybackMetrics(run, directionKey, horizonKey);
      if (!metrics) {
        return;
      }
      row.runMetrics[run.runId] = metrics;
      row[run.runId] = getHorizonPlaybackMetricValue(metricKey, metrics);
    });
    return row;
  });
}

function buildCombinedHorizonPlaybackRows(runs = [], directionKeys = [], metricKey = "excursion_atr") {
  return HORIZON_PLAYBACK_KEYS.map((horizonKey) => {
    const row = {
      horizonKey,
      runMetrics: {},
    };
    runs.forEach((run) => {
      if (!run?.runId) {
        return;
      }
      directionKeys.forEach((directionKey) => {
        const metrics = readHorizonPlaybackMetrics(run, directionKey, horizonKey);
        if (!metrics) {
          return;
        }
        const seriesKey = `${run.runId}::${directionKey}`;
        row.runMetrics[seriesKey] = metrics;
        row[seriesKey] = getHorizonPlaybackMetricValue(metricKey, metrics);
      });
    });
    return row;
  });
}

function ContrarianPolicyTable({ comparison = null, directionKey = "combined" }) {
  const families = Object.values(comparison?.families || {}).filter(Boolean);
  if (!families.length) {
    return null;
  }
  return (
    <div style={{ display: "grid", gap: 0 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "120px 88px 78px 78px 78px 78px 78px",
          gap: 8,
          paddingBottom: 6,
          borderBottom: `1px solid ${BORDER}`,
          fontSize: 10,
          color: "#94a3b8",
          fontFamily: F,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        <div>Policy</div>
        <div>Rule</div>
        <div>Quality</div>
        <div>Realized</div>
        <div>Early Check</div>
        <div>Best Move</div>
        <div>Stopped Early</div>
      </div>
      {families.map((family) => {
        const best = family.best || null;
        const summary = best?.directionSummaries?.[directionKey] || null;
        return (
          <div
            key={family.family}
            style={{
              display: "grid",
              gridTemplateColumns: "120px 88px 78px 78px 78px 78px 78px",
              gap: 8,
              alignItems: "center",
              padding: "8px 0",
              borderBottom: `1px solid ${BORDER}`,
              fontFamily: F,
            }}
          >
            <div style={{ fontSize: 12, color: "#111827", fontWeight: 700 }}>{family.family}</div>
            <div style={{ fontSize: 11.5, color: M }}>{best?.label || "--"}</div>
            <div style={{ fontSize: 12, color: B }}>{summary?.objectiveScore == null ? "--" : summary.objectiveScore.toFixed(2)}</div>
            <div style={{ fontSize: 12, color: B }}>{summary?.meanRealizedQualityScore == null ? "--" : summary.meanRealizedQualityScore.toFixed(3)}</div>
            <div style={{ fontSize: 12, color: Number(summary?.fewCandleCorrectRatePct) >= 50 ? G : R }}>
              {summary?.fewCandleCorrectRatePct == null ? "--" : `${summary.fewCandleCorrectRatePct.toFixed(1)}%`}
            </div>
            <div style={{ fontSize: 12, color: Number(summary?.meanForwardExcursionAtr) >= 0 ? G : R }}>
              {summary?.meanForwardExcursionAtr == null ? "--" : formatSigned(summary.meanForwardExcursionAtr, 3)}
            </div>
            <div style={{ fontSize: 12, color: B }}>
              {summary?.contrarianStopRatePct == null ? "--" : `${summary.contrarianStopRatePct.toFixed(1)}%`}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TimeframeMatrix({ rows = [], selectedTimeframe = "overall", onSelectTimeframe, studyMode = "forward" }) {
  if (!rows.length) {
    return null;
  }
  const isTenure = studyMode === "tenure";
  const templateColumns = isTenure
    ? "84px 58px 68px 82px 92px 84px 84px"
    : "84px 58px 68px 72px 72px 84px 76px";
  return (
    <div style={{ display: "grid", gap: 0 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: templateColumns,
          gap: 8,
          paddingBottom: 6,
          borderBottom: `1px solid ${BORDER}`,
          fontSize: 10,
          color: "#94a3b8",
          fontFamily: F,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        <div>Timeframe</div>
        <div>Signals</div>
        <div>Source</div>
        <div>{isTenure ? "Stayed Right" : "Direction Correct"}</div>
        <div>{isTenure ? "Stayed Right %" : "Close Result"}</div>
        <div>Order Reliability</div>
        <div>{isTenure ? "Stopped Early %" : "Visibility Cutoff"}</div>
      </div>
      {rows.map((row) => {
        const active = selectedTimeframe === row.timeframe;
        const primaryMetric = isTenure ? row.majorityCorrectRatePct : row.hitRatePct;
        const secondaryMetric = isTenure ? row.meanTenurePct : row.meanCloseReturnAtr;
        const trailingMetric = isTenure ? row.contrarianStopRatePct : row.renderFloorScore;
        const primaryNumeric = toFiniteNumber(primaryMetric);
        const secondaryNumeric = toFiniteNumber(secondaryMetric);
        return (
          <button
            key={row.timeframe}
            type="button"
            onClick={() => onSelectTimeframe?.(row.timeframe)}
            style={{
              display: "grid",
              gridTemplateColumns: templateColumns,
              gap: 8,
              alignItems: "center",
              textAlign: "left",
              padding: "8px 0",
              border: "none",
              borderBottom: `1px solid ${BORDER}`,
              background: active ? `${B}08` : "transparent",
              cursor: "pointer",
              fontFamily: F,
            }}
          >
            <div style={{ fontSize: 12, color: active ? B : "#111827", fontWeight: 700 }}>{row.timeframe}</div>
            <div style={{ fontSize: 12, color: M }}>{formatCount(row.signalCount)}</div>
            <div style={{ fontSize: 12, color: summaryTone(row.preferredScoreType), fontWeight: 700 }}>{row.preferredScoreType}</div>
            <div style={{ fontSize: 12, color: primaryNumeric == null ? M : (primaryNumeric >= 50 ? G : R) }}>{primaryMetric == null ? "--" : `${primaryMetric.toFixed(1)}%`}</div>
            <div style={{ fontSize: 12, color: isTenure ? B : (secondaryNumeric == null ? M : (secondaryNumeric >= 0 ? G : R)) }}>
              {isTenure
                ? (secondaryMetric == null ? "--" : `${secondaryMetric.toFixed(1)}%`)
                : formatSigned(secondaryMetric, 3)}
            </div>
            <div style={{ fontSize: 12, color: B }}>{row.monotonicityPct == null ? "--" : `${row.monotonicityPct.toFixed(0)}%`}</div>
            <div style={{ fontSize: 12, color: isTenure ? B : (row.renderFloorScore ? Y : M) }}>
              {isTenure
                ? (trailingMetric == null ? "--" : `${trailingMetric.toFixed(1)}%`)
                : (trailingMetric == null ? "--" : trailingMetric.toFixed(2))}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function BucketTable({ rows = [], studyMode = "forward" }) {
  if (!rows.length) {
    return null;
  }
  const isTenure = studyMode === "tenure";
  const templateColumns = isTenure
    ? "92px 54px 54px 84px 84px 78px 80px"
    : "92px 54px 68px 74px 74px 74px 74px";
  return (
    <div style={{ display: "grid", gap: 0 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: templateColumns,
          gap: 8,
          paddingBottom: 6,
          borderBottom: `1px solid ${BORDER}`,
          fontSize: 10,
          color: "#94a3b8",
          fontFamily: F,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        <div>Bucket</div>
        <div>Count</div>
        <div>{isTenure ? "No Window" : "Direction Correct"}</div>
        <div>{isTenure ? "Stayed Right" : "Close Result"}</div>
        <div>{isTenure ? "Stayed Right %" : "Close Result bps"}</div>
        <div>{isTenure ? "Eval Bars" : "Best Move"}</div>
        <div>{isTenure ? "Stopped Early %" : "Adverse Move"}</div>
      </div>
      {rows.map((row) => (
        <div
          key={row.bucketKey}
          style={{
            display: "grid",
            gridTemplateColumns: templateColumns,
            gap: 8,
            alignItems: "center",
            padding: "8px 0",
            borderBottom: `1px solid ${BORDER}`,
            fontFamily: F,
          }}
        >
          <div style={{ fontSize: 12, color: "#111827", fontWeight: 700 }}>
            {row.bucketLabel}
            {row.lowConfidence ? <span style={{ color: Y, fontWeight: 600 }}> *</span> : null}
          </div>
          <div style={{ fontSize: 12, color: M }}>{row.count}</div>
          {isTenure ? (
            <>
              <div style={{ fontSize: 12, color: M }}>{row.zeroWindowCount ?? 0}</div>
              <div style={{ fontSize: 12, color: Number(row.majorityCorrectRatePct) >= 50 ? G : R }}>
                {row.majorityCorrectRatePct == null ? "--" : `${row.majorityCorrectRatePct.toFixed(1)}%`}
              </div>
              <div style={{ fontSize: 12, color: B }}>
                {row.meanTenurePct == null ? "--" : `${row.meanTenurePct.toFixed(1)}%`}
              </div>
              <div style={{ fontSize: 12, color: M }}>
                {row.meanEligibleBars == null ? "--" : row.meanEligibleBars.toFixed(2)}
              </div>
              <div style={{ fontSize: 12, color: B }}>
                {row.contrarianStopRatePct == null ? "--" : `${row.contrarianStopRatePct.toFixed(1)}%`}
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 12, color: Number(row.hitRatePct) >= 50 ? G : R }}>
                {row.hitRatePct == null ? "--" : `${row.hitRatePct.toFixed(1)}%`}
              </div>
              <div style={{ fontSize: 12, color: Number(row.meanCloseReturnAtr) >= 0 ? G : R }}>
                {formatSigned(row.meanCloseReturnAtr, 3)}
              </div>
              <div style={{ fontSize: 12, color: Number(row.meanCloseReturnBps) >= 0 ? G : R }}>
                {formatSigned(row.meanCloseReturnBps, 1)}
              </div>
              <div style={{ fontSize: 12, color: G }}>{formatSigned(row.meanMfeAtr, 3)}</div>
              <div style={{ fontSize: 12, color: R }}>{formatSigned(row.meanMaeAtr, 3)}</div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function EmptyState({ title, body, actionLabel = "Run Study", onAction, disabled = false }) {
  return (
    <div
      style={{
        border: `1px dashed ${BORDER}`,
        borderRadius: 10,
        background: "#f8fafc",
        padding: "18px 20px",
        display: "grid",
        gap: 10,
        justifyItems: "start",
      }}
    >
      <div>
        <div style={{ fontSize: 14, color: "#111827", fontFamily: FS, fontWeight: 700 }}>{title}</div>
        <div style={{ marginTop: 4, fontSize: 12.5, color: M, fontFamily: F, lineHeight: 1.5 }}>{body}</div>
      </div>
      {onAction ? (
        <button
          type="button"
          onClick={onAction}
          disabled={disabled}
          style={{
            minHeight: 30,
            padding: "0 12px",
            borderRadius: 8,
            border: `1px solid ${disabled ? BORDER : `${B}44`}`,
            background: disabled ? "#e2e8f0" : `${B}10`,
            color: disabled ? M : B,
            fontSize: 12,
            fontFamily: F,
            fontWeight: 700,
            cursor: disabled ? "not-allowed" : "pointer",
          }}
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function ScoreStudyDeepDive({
  strategy = "rayalgo",
  scoreStudy = null,
  baselineResult = null,
  onRunScoreStudy,
  onQueueScoreStudy,
  selectedPresetId = null,
  hasBlockingServerJob = false,
  runtimeData = null,
}) {
  const result = scoreStudy?.result || null;
  const [selectedHorizon, setSelectedHorizon] = React.useState("3x");
  const [selectedScoreType, setSelectedScoreType] = React.useState("final");
  const [selectedDirection, setSelectedDirection] = React.useState("combined");
  const [selectedTimeframe, setSelectedTimeframe] = React.useState("overall");
  const [advancedDiagnosticsOpen, setAdvancedDiagnosticsOpen] = React.useState(false);
  const studyModes = React.useMemo(() => {
    if (result?.studyModes) {
      return result.studyModes;
    }
    if (!result) {
      return {};
    }
    return {
      forward: {
        studyMode: "forward",
        label: "Move Quality",
        headlineHorizon: result?.metadata?.headlineHorizon || "3x",
        horizons: (result?.metadata?.studyModes?.forward?.horizons || ["1x", "3x", "6x", "12x"]).map((entry) => (
          typeof entry === "string" ? { key: entry, label: entry } : entry
        )),
        directionSummaries: result.directionSummaries,
        overallSummary: result.overallSummary,
        rawVsFinalComparison: result.rawVsFinalComparison,
        horizonSummaries: result.horizonSummaries,
        timeframeSummaries: result.timeframeSummaries,
        bucketTables: result.bucketTables,
        timeframeDetails: result.timeframeDetails,
        recommendations: result.recommendations,
      },
    };
  }, [result]);
  const baselineStudyModes = React.useMemo(() => {
    if (baselineResult?.studyModes) {
      return baselineResult.studyModes;
    }
    if (!baselineResult) {
      return {};
    }
    return {
      forward: {
        studyMode: "forward",
        label: "Move Quality",
        headlineHorizon: baselineResult?.metadata?.headlineHorizon || "3x",
        horizons: (baselineResult?.metadata?.studyModes?.forward?.horizons || ["1x", "3x", "6x", "12x"]).map((entry) => (
          typeof entry === "string" ? { key: entry, label: entry } : entry
        )),
        directionSummaries: baselineResult.directionSummaries,
        overallSummary: baselineResult.overallSummary,
        rawVsFinalComparison: baselineResult.rawVsFinalComparison,
        horizonSummaries: baselineResult.horizonSummaries,
        timeframeSummaries: baselineResult.timeframeSummaries,
        bucketTables: baselineResult.bucketTables,
        timeframeDetails: baselineResult.timeframeDetails,
        recommendations: baselineResult.recommendations,
        scoreValidity: baselineResult.scoreValidity,
      },
    };
  }, [baselineResult]);
  const selectedPerformanceMetric = React.useMemo(
    () => getResearchPerformanceMetricDefinition("validated_quality"),
    [],
  );
  const selectedStudyMode = "forward";
  const activeStudy = studyModes?.[selectedStudyMode] || studyModes?.forward || null;
  const baselineActiveStudy = baselineStudyModes?.[selectedStudyMode] || baselineStudyModes?.forward || null;
  const availableHorizonKeys = React.useMemo(
    () => (Array.isArray(activeStudy?.horizons) ? activeStudy.horizons.map((entry) => entry.key).filter((key) => key !== "1x") : ["3x"]),
    [activeStudy],
  );
  const directionSummary = activeStudy?.directionSummaries?.[selectedDirection] || null;
  const availableTimeframes = React.useMemo(
    () => Object.values(activeStudy?.timeframeDetails || {})
      .filter((entry) => entry?.timeframe)
      .sort((left, right) => (Number(left?.tfMinutes) || 0) - (Number(right?.tfMinutes) || 0))
      .map((entry) => entry.timeframe),
    [activeStudy?.timeframeDetails],
  );
  const selectedDirectionLabel = selectedDirection === "long"
    ? "Buy"
    : selectedDirection === "short"
      ? "Sell"
      : "Both";
  const isTenureMode = selectedStudyMode === "tenure";

  React.useEffect(() => {
    if (selectedTimeframe === "overall") {
      return;
    }
    if (!availableTimeframes.includes(selectedTimeframe)) {
      setSelectedTimeframe(runtimeData?.rayalgoScoringContext?.activeTimeframe || "overall");
    }
  }, [availableTimeframes, runtimeData?.rayalgoScoringContext?.activeTimeframe, selectedTimeframe]);

  React.useEffect(() => {
    if (!availableHorizonKeys.includes(selectedHorizon)) {
      setSelectedHorizon(availableHorizonKeys[0] || "3x");
    }
  }, [availableHorizonKeys, selectedHorizon]);

  const normalizedStrategy = String(strategy || "").trim().toLowerCase();
  if (normalizedStrategy !== "rayalgo") {
    return (
      <EmptyState
        title="Scoring Research"
        body="This study only applies to RayAlgo because it evaluates raw signal_fire arrows and their score calibration."
      />
    );
  }

  if (scoreStudy?.status === "disabled") {
    return (
      <EmptyState
        title="Scoring Research"
        body={scoreStudy.error || "RayAlgo score study is disabled for the current setup."}
      />
    );
  }

  if (scoreStudy?.status === "error" && !result) {
    return (
      <EmptyState
        title="Scoring Research"
        body={scoreStudy.error || "Failed to run the RayAlgo score study."}
        actionLabel="Retry Study"
        onAction={onRunScoreStudy}
      />
    );
  }

  if (!result) {
    return (
      <EmptyState
        title="Scoring Research"
        body="Run a score study to see how 2m, 5m, and 15m signals actually performed from 3x through 120x."
        actionLabel="Run Study"
        onAction={onRunScoreStudy}
        disabled={scoreStudy?.status === "loading"}
      />
    );
  }

  const statusMeta = getStatusMeta(scoreStudy);
  const summary = directionSummary?.overallSummary || activeStudy?.overallSummary || result.overallSummary || {};
  const preferredScoreType = summary.preferredScoreType || "final";
  const contrarianPolicyComparison = activeStudy?.contrarianPolicyComparison || result?.contrarianPolicyComparison || null;
  const overallBestPolicy = contrarianPolicyComparison?.overallBestPolicy || null;
  const hasAdvancedDiagnostics = hasAdvancedDiagnosticsResult(result)
    || hasAdvancedDiagnosticsResult(activeStudy)
    || hasAdvancedDiagnosticsResult(directionSummary);
  const diagnosticsPresetId = selectedPresetId || "current_setup";
  const displayedRows = selectedTimeframe === "overall"
    ? activeStudy?.bucketTables?.overall?.[selectedDirection]?.[selectedScoreType]?.[selectedHorizon]
      || activeStudy?.bucketTables?.overall?.[selectedScoreType]?.[selectedHorizon]
      || []
    : activeStudy?.bucketTables?.timeframes?.[selectedTimeframe]?.[selectedDirection]?.[selectedScoreType]?.[selectedHorizon]
      || activeStudy?.bucketTables?.timeframes?.[selectedTimeframe]?.[selectedScoreType]?.[selectedHorizon]
      || [];
  const selectedTimeframeDetail = selectedTimeframe === "overall"
    ? null
    : activeStudy?.timeframeDetails?.[selectedTimeframe]?.directions?.[selectedDirection]
      || activeStudy?.timeframeDetails?.[selectedTimeframe]
      || null;
  const comparison = selectedTimeframe === "overall"
    ? directionSummary?.horizonSummaries?.[selectedHorizon]?.comparison
      || directionSummary?.rawVsFinalComparison
      || activeStudy?.horizonSummaries?.[selectedHorizon]?.comparison
      || activeStudy?.rawVsFinalComparison
    : selectedTimeframeDetail?.horizons?.[selectedHorizon]?.comparison || null;
  const scopeLabel = selectedTimeframe === "overall"
    ? "All timeframes"
    : `${selectedTimeframe} timeframe`;
  const performanceRows = React.useMemo(
    () => buildResearchTimeframePerformanceRows({
      study: activeStudy,
      baselineStudy: baselineActiveStudy,
      companionStudy: studyModes?.tenure || null,
      baselineCompanionStudy: baselineStudyModes?.tenure || null,
      directionKey: selectedDirection,
      scoreType: selectedScoreType,
      horizonKeys: availableHorizonKeys,
      metric: selectedPerformanceMetric,
    }),
    [activeStudy, availableHorizonKeys, baselineActiveStudy, baselineStudyModes?.tenure, selectedDirection, selectedPerformanceMetric, selectedScoreType, studyModes?.tenure],
  );
  const selectedPerformanceRow = React.useMemo(
    () => performanceRows.find((row) => row.timeframe === selectedTimeframe) || performanceRows[0] || null,
    [performanceRows, selectedTimeframe],
  );
  const hasBaselineResearch = React.useMemo(
    () => performanceRows.some((row) => Object.values(row?.cells || {}).some((cell) => Number.isFinite(Number(cell?.delta)))),
    [performanceRows],
  );
  const focusHorizonKeys = React.useMemo(
    () => buildResearchFocusHorizonKeys(availableHorizonKeys),
    [availableHorizonKeys],
  );
  const selectedTimeframeLabel = selectedPerformanceRow?.label === "All"
    ? "All signal timeframes"
    : `${selectedPerformanceRow?.label || "--"} signals`;

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <SectionCard
        title="Timeframe Research"
        subtitle={`${String(runtimeData?.marketSymbol || result?.metadata?.marketSymbol || "SPY").toUpperCase()} · ${selectedDirectionLabel.toLowerCase()} signals · validated outcomes by signal timeframe from 3x through 120x.`}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, color: "#111827", fontFamily: FS, fontWeight: 700 }}>
              {selectedPerformanceMetric.label}
            </div>
            <div style={{ marginTop: 4, fontSize: 12, color: M, fontFamily: F, lineHeight: 1.45 }}>
              {selectedPerformanceMetric.help} Rows are signal timeframes. Columns are horizons. {hasBaselineResearch ? "Cells show delta vs baseline first, then current and baseline values." : "Cells show current realized values only."}
            </div>
            {scoreStudy?.lastRunAt ? (
              <div style={{ marginTop: 4, fontSize: 11, color: "#94a3b8", fontFamily: F }}>
                Last run {scoreStudy.lastRunAt}
              </div>
            ) : null}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
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
            <button
              type="button"
              onClick={onRunScoreStudy}
              disabled={scoreStudy?.status === "loading"}
              style={{
                minHeight: 30,
                padding: "0 12px",
                borderRadius: 8,
                border: `1px solid ${scoreStudy?.status === "loading" ? BORDER : `${B}44`}`,
                background: scoreStudy?.status === "loading" ? "#e2e8f0" : `${B}10`,
                color: scoreStudy?.status === "loading" ? M : B,
                fontSize: 12,
                fontFamily: F,
                fontWeight: 700,
                cursor: scoreStudy?.status === "loading" ? "wait" : "pointer",
              }}
            >
              {scoreStudy?.status === "loading" ? "Running..." : scoreStudy?.stale ? "Refresh Study" : "Run Again"}
            </button>
          </div>
        </div>
      </SectionCard>

      <WarningList warnings={result?.warnings || []} />

      <SectionCard title="Timeframe x Horizon Performance" subtitle={`${selectedPerformanceMetric.label} across ${selectedDirectionLabel.toLowerCase()} signals from each signal timeframe.`}>
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            <div style={{ minWidth: 72, fontSize: 11, color: M, fontFamily: F, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>Direction</div>
            {[["combined", "Both"], ["long", "Buy"], ["short", "Sell"]].map(([directionKey, label]) => (
              <PillButton key={directionKey} active={selectedDirection === directionKey} onClick={() => setSelectedDirection(directionKey)}>
                {label}
              </PillButton>
            ))}
          </div>
          <div style={{ fontSize: 11.5, color: M, fontFamily: F, lineHeight: 1.5 }}>
            Click a timeframe row to focus it below. This matrix stays on the aggregated validated outcome score. Component metrics live in diagnostics, not here.
          </div>
          <TimeframePerformanceMatrix
            rows={performanceRows}
            horizons={availableHorizonKeys}
            metric={selectedPerformanceMetric}
            selectedTimeframe={selectedPerformanceRow?.timeframe || "overall"}
            onSelectTimeframe={setSelectedTimeframe}
          />
        </div>
      </SectionCard>

      <SectionCard title="Selected Timeframe" subtitle={`${selectedTimeframeLabel} · ${selectedPerformanceMetric.label} at key horizons.`}>
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
            {focusHorizonKeys.map((horizonKey) => {
              const cell = selectedPerformanceRow?.cells?.[horizonKey] || null;
              const displayValue = Number.isFinite(Number(cell?.delta)) ? cell.delta : cell?.value;
              const tone = Number.isFinite(Number(cell?.delta))
                ? researchPerformanceDeltaTone(cell?.delta)
                : researchPerformanceTone(selectedPerformanceMetric, displayValue);
              return (
                <SummaryMetric
                  key={`focus-${horizonKey}`}
                  label={horizonKey}
                  value={Number.isFinite(Number(cell?.delta))
                    ? formatResearchPerformanceDelta(selectedPerformanceMetric, cell?.delta)
                    : formatResearchPerformanceValue(selectedPerformanceMetric, cell?.value)}
                  tone={tone === M ? B : tone}
                  detail={Number.isFinite(Number(cell?.baselineValue))
                    ? `${formatResearchPerformanceValue(selectedPerformanceMetric, cell?.value)} now · ${formatResearchPerformanceValue(selectedPerformanceMetric, cell?.baselineValue)} base`
                    : cell?.signalCount
                      ? `${cell.signalCount} signals`
                      : "No data"}
                />
              );
            })}
            <SummaryMetric
              label="Sample Size"
              value={formatCount(selectedPerformanceRow?.signalCount)}
              tone={B}
              detail={`${selectedDirectionLabel} signals from ${selectedTimeframeLabel.toLowerCase()}.`}
            />
          </div>
          <div style={{ fontSize: 11.5, color: M, fontFamily: F, lineHeight: 1.5 }}>
            {selectedPerformanceMetric.key === "validated_quality"
              ? "Higher Validated Quality means the signal delivered a better blended realized outcome after the trade played out."
              : selectedPerformanceMetric.key === "stayed_right"
                ? "Higher Stayed Right means the move spent more of the horizon on the correct side of the entry."
                : "Positive ATR metrics mean the signal created or held favorable movement by that horizon."}
          </div>
        </div>
      </SectionCard>

      <details
        open={advancedDiagnosticsOpen}
        onToggle={(event) => setAdvancedDiagnosticsOpen(Boolean(event.currentTarget.open))}
        style={{ border: `1px solid ${BORDER}`, borderRadius: 10, background: "#ffffff", overflow: "hidden" }}
      >
        <summary style={{ cursor: "pointer", listStyle: "none", padding: "12px 14px", fontSize: 12.5, color: B, fontFamily: FS, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Advanced Diagnostics
        </summary>
        {advancedDiagnosticsOpen ? (
        <div style={{ padding: "0 14px 14px", display: "grid", gap: 10 }}>
          {!hasAdvancedDiagnostics ? (
            <SectionCard
              title="Diagnostics Mode"
              subtitle="This run was generated in lean mode, so the expensive bucket and invalidation diagnostics were skipped."
            >
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ fontSize: 12.5, color: M, fontFamily: F, lineHeight: 1.5 }}>
                  Re-run this version with deep diagnostics when you need bucket ordering, threshold sweeps, and internal score debugging. Keep the routine comparison path lean.
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => onRunScoreStudy?.({ mode: "local", presetId: diagnosticsPresetId, includeAdvancedDiagnostics: true })}
                    disabled={scoreStudy?.status === "loading"}
                    style={{
                      minHeight: 34,
                      padding: "0 12px",
                      borderRadius: 8,
                      border: `1px solid ${scoreStudy?.status === "loading" ? BORDER : `${G}44`}`,
                      background: scoreStudy?.status === "loading" ? "#e2e8f0" : `${G}12`,
                      color: scoreStudy?.status === "loading" ? M : G,
                      fontSize: 12,
                      fontFamily: F,
                      fontWeight: 700,
                      cursor: scoreStudy?.status === "loading" ? "wait" : "pointer",
                    }}
                  >
                    {scoreStudy?.status === "loading" ? "Running..." : "Run Quick With Diagnostics"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onQueueScoreStudy?.({ presetId: diagnosticsPresetId, includeAdvancedDiagnostics: true })}
                    disabled={hasBlockingServerJob}
                    style={{
                      minHeight: 34,
                      padding: "0 12px",
                      borderRadius: 8,
                      border: `1px solid ${hasBlockingServerJob ? BORDER : `${B}44`}`,
                      background: hasBlockingServerJob ? "#e2e8f0" : `${B}10`,
                      color: hasBlockingServerJob ? M : B,
                      fontSize: 12,
                      fontFamily: F,
                      fontWeight: 700,
                      cursor: hasBlockingServerJob ? "not-allowed" : "pointer",
                    }}
                  >
                    {hasBlockingServerJob ? "Server Run Active" : "Run Full History With Diagnostics"}
                  </button>
                </div>
              </div>
            </SectionCard>
          ) : null}
          {hasAdvancedDiagnostics ? (
          <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
            <SummaryMetric
              label="Display Source"
              value={getScoreSourceLabel(preferredScoreType)}
              tone={summaryTone(preferredScoreType)}
              detail="Preferred score source for bucket ordering in the diagnostics below."
            />
            <SummaryMetric
              label="Visibility Cutoff"
              value={summary.renderFloorScore == null ? "None" : summary.renderFloorScore.toFixed(2)}
              tone={summaryTone(summary.renderAction)}
              detail="Suggested cutoff for hiding or fading weaker arrows."
            />
            <SummaryMetric
              label="Internal Score"
              value={result?.metadata?.scoringConfigPreview?.scoringVersion || "--"}
              tone={B}
              detail="Internal scoring version id."
            />
            <SummaryMetric
              label="Internal Profile"
              value={result?.metadata?.scoringConfigPreview?.executionProfile || "--"}
              tone={B}
              detail="Internal execution profile id."
            />
          </div>

          <SectionCard title="Diagnostic Controls" subtitle="Use these only when you need to inspect bucket ordering or internal score behavior.">
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                <div style={{ minWidth: 72, fontSize: 11, color: M, fontFamily: F, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>Source</div>
                {["raw", "final"].map((scoreType) => (
                  <PillButton key={scoreType} active={selectedScoreType === scoreType} onClick={() => setSelectedScoreType(scoreType)}>
                    {getScoreSourceLabel(scoreType)}
                  </PillButton>
                ))}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                <div style={{ minWidth: 72, fontSize: 11, color: M, fontFamily: F, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>Horizon</div>
                {availableHorizonKeys.map((horizonKey) => (
                  <PillButton key={horizonKey} active={selectedHorizon === horizonKey} onClick={() => setSelectedHorizon(horizonKey)}>
                    {horizonKey}
                  </PillButton>
                ))}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                <div style={{ minWidth: 72, fontSize: 11, color: M, fontFamily: F, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>Scope</div>
                <PillButton active={selectedTimeframe === "overall"} onClick={() => setSelectedTimeframe("overall")}>
                  Overall
                </PillButton>
                {availableTimeframes.map((timeframe) => (
                  <PillButton key={timeframe} active={selectedTimeframe === timeframe} onClick={() => setSelectedTimeframe(timeframe)}>
                    {timeframe}
                  </PillButton>
                ))}
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Selected Slice" subtitle={`${scopeLabel} · ${selectedDirectionLabel.toLowerCase()} signals · ${getScoreSourceLabel(selectedScoreType).toLowerCase()} · ${selectedHorizon} ${isTenureMode ? "stayed-right checkpoint" : "move-quality window"}`}>
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
                <SummaryMetric
                  label="Better Source"
                  value={comparison?.winner || "--"}
                  tone={summaryTone(comparison?.winner)}
                  detail={comparison?.headline || "Base-vs-adjusted comparison at the selected horizon."}
                />
                <SummaryMetric
                  label="Score Order Reliability"
                  value={selectedTimeframe === "overall"
                    ? (directionSummary?.horizonSummaries?.[selectedHorizon]?.[selectedScoreType]?.evaluation?.monotonicityPct == null
                      ? "--"
                      : `${directionSummary.horizonSummaries[selectedHorizon][selectedScoreType].evaluation.monotonicityPct.toFixed(0)}%`)
                    : (selectedTimeframeDetail?.horizons?.[selectedHorizon]?.[selectedScoreType]?.evaluation?.monotonicityPct == null
                      ? "--"
                      : `${selectedTimeframeDetail.horizons[selectedHorizon][selectedScoreType].evaluation.monotonicityPct.toFixed(0)}%`)}
                  tone={B}
                  detail={isTenureMode
                    ? "Higher is better. Measures whether stronger score buckets stay correct for longer."
                    : "Higher is better. Measures whether stronger score buckets also produce better move quality."}
                />
                <SummaryMetric
                  label="Sample Size"
                  value={selectedTimeframe === "overall"
                    ? formatCount(directionSummary?.horizonSummaries?.[selectedHorizon]?.[selectedScoreType]?.overall?.signalCount)
                    : formatCount(selectedTimeframeDetail?.horizons?.[selectedHorizon]?.[selectedScoreType]?.overall?.signalCount)}
                  tone={B}
                  detail="Signals with enough data to evaluate at the selected horizon."
                />
              </div>
              <div style={{ fontSize: 11.5, color: M, fontFamily: F, lineHeight: 1.5 }}>
                * Asterisks mark low-confidence buckets that do not yet have enough sample size.
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Score Buckets" subtitle={`${scopeLabel} · ${selectedDirectionLabel.toLowerCase()} signals · ${getScoreSourceLabel(selectedScoreType).toLowerCase()} buckets at ${selectedHorizon} ${isTenureMode ? "stayed-right" : "move-quality"} readout.`}>
            <BucketTable rows={displayedRows} studyMode={selectedStudyMode} />
          </SectionCard>

          {contrarianPolicyComparison ? (
            <SectionCard
              title="Invalidation Rules"
              subtitle="Internal threshold sweep for when opposite-side signals count as a stop. Hidden here because it is not part of the main performance readout."
            >
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
                  <SummaryMetric
                    label="Best Rule"
                    value={overallBestPolicy?.label || "--"}
                    tone={B}
                    detail={overallBestPolicy?.policyId || "Top invalidation rule in this sweep."}
                  />
                  <SummaryMetric
                    label="Signal Strength Source"
                    value={getScoreSourceLabel(contrarianPolicyComparison?.scoreBasis === "rawScore" ? "raw" : contrarianPolicyComparison?.scoreBasis === "effectiveScore" ? "effective" : "final")}
                    tone={B}
                    detail="Which score source was used when testing stop rules."
                  />
                  <SummaryMetric
                    label="Minimum Thresholds"
                    value={(contrarianPolicyComparison?.floorGrid || []).join(" / ") || "--"}
                    tone={B}
                    detail="Score cutoffs tested in the sweep."
                  />
                  <SummaryMetric
                    label="Separation Thresholds"
                    value={(contrarianPolicyComparison?.marginGrid || []).join(" / ") || "--"}
                    tone={B}
                    detail="Score-gap cutoffs tested in the sweep."
                  />
                </div>
                <ContrarianPolicyTable comparison={contrarianPolicyComparison} directionKey={selectedDirection} />
              </div>
            </SectionCard>
          ) : null}
          </>
          ) : null}
        </div>
        ) : null}
      </details>
    </div>
  );
}

function formatDateTime(value) {
  const parsed = new Date(value || "");
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().replace("T", " ").replace(".000Z", "Z") : "--";
}

function formatDurationMs(durationMs = null) {
  const safeDurationMs = Number(durationMs);
  if (!Number.isFinite(safeDurationMs) || safeDurationMs < 0) {
    return "--";
  }
  const totalSeconds = Math.max(0, Math.round(safeDurationMs / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${seconds}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return `${hours}h ${remMinutes}m`;
}

function formatScoreStudyJobElapsed(job = null) {
  const startMs = Date.parse(job?.startedAt || job?.createdAt || "");
  const endMs = Date.parse(job?.finishedAt || job?.updatedAt || "") || Date.now();
  if (!Number.isFinite(startMs)) {
    return "--";
  }
  return formatDurationMs(Math.max(0, endMs - startMs));
}

function getScoreStudyJobStatusMeta(status = "") {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "completed") {
    return { label: "Completed", tone: G, border: `${G}33`, background: `${G}10` };
  }
  if (normalized === "cancelled") {
    return { label: "Cancelled", tone: Y, border: `${Y}33`, background: `${Y}12` };
  }
  if (normalized === "cancel_requested") {
    return { label: "Cancelling", tone: Y, border: `${Y}33`, background: `${Y}12` };
  }
  if (normalized === "failed") {
    return { label: "Failed", tone: R, border: `${R}33`, background: `${R}10` };
  }
  if (normalized === "queued") {
    return { label: "Queued", tone: B, border: `${B}33`, background: `${B}08` };
  }
  return { label: "Running", tone: B, border: `${B}33`, background: `${B}08` };
}

function resolveScoreStudyJobStepKey(job = null) {
  const stage = String(job?.progress?.stage || job?.status || "").trim().toLowerCase();
  if (["completed", "cancelled", "failed"].includes(stage)) {
    return "done";
  }
  if (stage === "persisting-run") {
    return "persist";
  }
  if ([
    "running-score-study",
    "preparing analysis",
    "analyzing timeframes",
    "computing outcomes",
    "computing forward/tenure outcomes",
    "computing signal-class outcomes",
    "summarizing timeframes",
    "building summaries",
    "packing result",
  ].includes(stage)) {
    return "analyze";
  }
  if (stage === "hydrating-bars") {
    return "hydrate";
  }
  return "queued";
}

function buildScoreStudyJobSteps(job = null) {
  const activeKey = resolveScoreStudyJobStepKey(job);
  const status = String(job?.status || "").trim().toLowerCase();
  const ordered = ["queued", "hydrate", "analyze", "persist", "done"];
  const labels = {
    queued: "Queued",
    hydrate: "Load bars",
    analyze: "Run study",
    persist: "Persist",
    done: status === "cancelled" ? "Cancelled" : status === "failed" ? "Failed" : "Done",
  };
  const activeIndex = ordered.indexOf(activeKey);
  return ordered.map((key, index) => {
    let stepStatus = "pending";
    if (index < activeIndex) {
      stepStatus = "complete";
    } else if (index === activeIndex) {
      stepStatus = status === "completed" || status === "cancelled" || status === "failed"
        ? "complete"
        : "active";
    }
    if (status === "cancel_requested" && index > activeIndex) {
      stepStatus = "pending";
    }
    return {
      key,
      label: labels[key],
      status: stepStatus,
    };
  });
}

function sourceTone(source = "") {
  const normalized = String(source || "").trim().toLowerCase();
  if (normalized === "server_job") return "primary";
  if (normalized === "local_ui") return "positive";
  if (normalized === "cli_import") return "warning";
  return "muted";
}

function sourceLabel(source = "") {
  const normalized = String(source || "").trim().toLowerCase();
  if (normalized === "server_job") return "Server";
  if (normalized === "local_ui") return "Quick Run";
  if (normalized === "cli_import") return "CLI Import";
  return "Unknown";
}

function validityTone(validityStatus = "") {
  const normalized = String(validityStatus || "").trim().toLowerCase();
  if (normalized === "valid") return "positive";
  if (normalized === "invalid") return "danger";
  if (normalized === "superseded") return "warning";
  return "muted";
}

function buildRunDirectionMetric(directionSummary = {}, coverageTierKey = "all") {
  const normalized = normalizeDirectionSummary(directionSummary);
  if (coverageTierKey === "all") {
    return {
      value: normalized.validatedQualityScore == null ? "--" : formatValidatedQualityScore(normalized.validatedQualityScore),
      tone: getRankValidityTone(normalized.rankValidity?.status),
      detail: `${formatCount(normalized.totalSignals)} signals · ${normalized.rankValidity?.verdict || "Need more evidence"}`,
    };
  }

  const tier = directionSummary?.frontierTiers?.[coverageTierKey] || null;
  if (!tier) {
    return {
      value: "--",
      tone: M,
      detail: "Frontier tier unavailable",
    };
  }

  return {
    value: tier.meanExcursionEdgeAtr3x == null ? "--" : formatSigned(tier.meanExcursionEdgeAtr3x, 3),
    tone: Number(tier.meanExcursionEdgeAtr3x) >= 0 ? G : R,
    detail: `${formatCount(tier.count)} signals · ${tier.fewCandleCorrectRatePct == null ? "--" : `${tier.fewCandleCorrectRatePct.toFixed(1)}%`} early check · ${tier.sustainedCorrectRatePct == null ? "--" : `${tier.sustainedCorrectRatePct.toFixed(1)}%`} stayed right · ${tier.thresholdScore == null ? "--" : `${tier.thresholdScore.toFixed(3)}+`} threshold`,
  };
}

function ComparisonRunCard({ run, active = false, onSelect, coverageTierKey = "all", coverageTierLabel = "All" }) {
  const combined = buildRunDirectionMetric(run?.summary?.directions?.combined || {}, coverageTierKey);
  const long = buildRunDirectionMetric(run?.summary?.directions?.long || {}, coverageTierKey);
  const short = buildRunDirectionMetric(run?.summary?.directions?.short || {}, coverageTierKey);
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        textAlign: "left",
        border: `1px solid ${active ? `${B}44` : BORDER}`,
        borderRadius: 10,
        background: active ? `${B}08` : "#ffffff",
        padding: "12px 14px",
        display: "grid",
        gap: 10,
        cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 13, fontFamily: FS, fontWeight: 700, color: "#0f172a" }}>{run?.presetLabel || "--"}</div>
          <div style={{ marginTop: 3, fontSize: 12, fontFamily: F, color: M }}>
            {run?.symbol || "--"} · {sourceLabel(run?.source)} · {formatDateTime(run?.completedAt)}
          </div>
          {coverageTierKey !== "all" ? (
            <div style={{ marginTop: 4, fontSize: 11, fontFamily: F, color: "#64748b" }}>
              {coverageTierLabel} frontier · sorted by 3x Best Move
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <span style={{
            display: "inline-flex",
            alignItems: "center",
            minHeight: 22,
            padding: "0 8px",
            borderRadius: 999,
            border: `1px solid ${sourceTone(run?.source) === "primary" ? `${B}33` : sourceTone(run?.source) === "positive" ? `${G}33` : `${Y}33`}`,
            background: sourceTone(run?.source) === "primary" ? `${B}12` : sourceTone(run?.source) === "positive" ? `${G}12` : `${Y}12`,
            color: sourceTone(run?.source) === "primary" ? B : sourceTone(run?.source) === "positive" ? G : Y,
            fontSize: 11,
            fontFamily: F,
            fontWeight: 700,
          }}>
            {sourceLabel(run?.source)}
          </span>
          <span style={{
            display: "inline-flex",
            alignItems: "center",
            minHeight: 22,
            padding: "0 8px",
            borderRadius: 999,
            border: `1px solid ${validityTone(run?.validityStatus) === "positive" ? `${G}33` : validityTone(run?.validityStatus) === "danger" ? `${R}33` : `${Y}33`}`,
            background: validityTone(run?.validityStatus) === "positive" ? `${G}12` : validityTone(run?.validityStatus) === "danger" ? `${R}10` : `${Y}12`,
            color: validityTone(run?.validityStatus) === "positive" ? G : validityTone(run?.validityStatus) === "danger" ? R : Y,
            fontSize: 11,
            fontFamily: F,
            fontWeight: 700,
          }}>
            {run?.validityStatus || "unverified"}
          </span>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
        <SummaryMetric
          label="Combined"
          value={combined.value}
          tone={combined.tone}
          detail={combined.detail}
        />
        <SummaryMetric
          label="Long"
          value={long.value}
          tone={long.tone}
          detail={long.detail}
        />
        <SummaryMetric
          label="Short"
          value={short.value}
          tone={short.tone}
          detail={short.detail}
        />
      </div>
    </button>
  );
}

function ScoreStudyMetricGuide() {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
        <SummaryMetric
          label={VALIDATED_QUALITY_SCORE_LABEL}
          value="0.612"
          tone={B}
          detail="Blended realized outcome score from 0 to 1. Higher is better."
        />
        <SummaryMetric
          label="Best Move (ATR)"
          value="+1.0"
          tone={G}
          detail="Favorable move minus adverse move inside the horizon, scaled to a normal recent move."
        />
        <SummaryMetric
          label="Close Result (ATR)"
          value="+1.0"
          tone={G}
          detail="Average close-to-close return at the horizon, scaled to a normal recent move."
        />
      </div>
      <div style={{ fontSize: 11.5, color: "#64748b", fontFamily: F, lineHeight: 1.45 }}>
        ATR metrics are normalized by a normal recent move size so different versions stay comparable. Rate metrics always show `%`, and blended quality always shows a `0-1` score.
      </div>
    </div>
  );
}

const RESEARCH_PERFORMANCE_METRICS = Object.freeze([
  {
    key: "validated_quality",
    label: VALIDATED_QUALITY_SCORE_LABEL,
    unit: "score",
    studyMode: "forward",
    help: "Blended realized outcome score from 0 to 1. Higher means better realized quality after the signal fired.",
  },
  {
    key: "best_move",
    label: "Best Move (ATR)",
    unit: "ATR",
    studyMode: "forward",
    help: "Favorable move opportunity by each horizon, normalized by ATR.",
  },
  {
    key: "close_result",
    label: "Close Result (ATR)",
    unit: "ATR",
    studyMode: "forward",
    help: "Horizon-end P/L by each horizon, normalized by ATR.",
  },
  {
    key: "direction_correct",
    label: "Direction Correct (%)",
    unit: "%",
    studyMode: "forward",
    help: "Percent of windows that mostly resolved in the predicted direction.",
  },
  {
    key: "stayed_right",
    label: "Stayed Right (%)",
    unit: "%",
    studyMode: "forward",
    help: "Percent of the horizon that price stayed on the correct side of entry.",
  },
]);

function getResearchPerformanceMetricDefinition(metricKey = "validated_quality") {
  return RESEARCH_PERFORMANCE_METRICS.find((metric) => metric.key === metricKey) || RESEARCH_PERFORMANCE_METRICS[0];
}

function formatResearchPerformanceValue(metric = null, value = null) {
  const resolvedMetric = typeof metric === "string" ? getResearchPerformanceMetricDefinition(metric) : metric;
  if (resolvedMetric?.key === "validated_quality") {
    return formatValidatedQualityScore(value);
  }
  if (resolvedMetric?.key === "direction_correct" || resolvedMetric?.key === "stayed_right") {
    return formatPercent(value, 0);
  }
  return formatSigned(value, 3);
}

function formatResearchPerformanceDelta(metric = null, value = null) {
  const resolvedMetric = typeof metric === "string" ? getResearchPerformanceMetricDefinition(metric) : metric;
  const numeric = toFiniteNumber(value);
  if (numeric == null) {
    return "--";
  }
  if (resolvedMetric?.key === "validated_quality") {
    return `${numeric > 0 ? "+" : ""}${numeric.toFixed(3)}`;
  }
  if (resolvedMetric?.key === "direction_correct" || resolvedMetric?.key === "stayed_right") {
    return `${numeric > 0 ? "+" : ""}${numeric.toFixed(0)} pts`;
  }
  return `${numeric > 0 ? "+" : ""}${numeric.toFixed(3)}`;
}

function researchPerformanceTone(metric = null, value = null) {
  const resolvedMetric = typeof metric === "string" ? getResearchPerformanceMetricDefinition(metric) : metric;
  const numeric = toFiniteNumber(value);
  if (numeric == null) {
    return M;
  }
  if (resolvedMetric?.key === "validated_quality") {
    if (numeric >= 0.58) return G;
    if (numeric < 0.45) return R;
    return B;
  }
  if (resolvedMetric?.key === "direction_correct" || resolvedMetric?.key === "stayed_right") {
    if (numeric >= 55) return G;
    if (numeric < 45) return R;
    return B;
  }
  if (numeric > 0) return G;
  if (numeric < 0) return R;
  return B;
}

function researchPerformanceDeltaTone(value = null) {
  const numeric = toFiniteNumber(value);
  if (numeric == null) {
    return M;
  }
  if (numeric > 0) return G;
  if (numeric < 0) return R;
  return B;
}

function roundResearchValue(value = null, digits = 3) {
  const numeric = toFiniteNumber(value);
  return numeric == null ? null : Number(numeric.toFixed(digits));
}

function normalizeResearchSignedUnit(value = null, cap = 2) {
  const numeric = toFiniteNumber(value);
  if (numeric == null) {
    return null;
  }
  const safeCap = Math.max(0.001, Number(cap) || 2);
  const normalized = Math.max(0, Math.min(1, 0.5 + (numeric / (safeCap * 2))));
  return roundResearchValue(normalized, 3);
}

function deriveValidatedQualityOverall(forwardOverall = null, tenureOverall = null) {
  if (!forwardOverall && !tenureOverall) {
    return null;
  }
  const bestMoveAtr = toFiniteNumber(forwardOverall?.bestMoveAtr ?? forwardOverall?.meanExcursionEdgeAtr);
  const closeResultAtr = toFiniteNumber(forwardOverall?.closeResultAtr ?? forwardOverall?.meanCloseReturnAtr);
  const directionCorrectPct = toFiniteNumber(forwardOverall?.directionCorrectPct ?? forwardOverall?.guidanceRatePct);
  const stayedRightPct = toFiniteNumber(
    tenureOverall?.stayedRightPct
      ?? tenureOverall?.meanStayedRightPct
      ?? tenureOverall?.meanTenurePct
      ?? forwardOverall?.stayedRightPct
      ?? forwardOverall?.meanStayedRightPct
      ?? forwardOverall?.meanTenurePct,
  );
  const normalizedByKey = {
    best_move_atr: normalizeResearchSignedUnit(bestMoveAtr, 2),
    close_result_atr: normalizeResearchSignedUnit(closeResultAtr, 2),
    direction_correct_pct: directionCorrectPct == null ? null : roundResearchValue(Math.max(0, Math.min(1, directionCorrectPct / 100)), 3),
    stayed_right_pct: stayedRightPct == null ? null : roundResearchValue(Math.max(0, Math.min(1, stayedRightPct / 100)), 3),
  };
  const weightedComponents = RAYALGO_VALIDATED_QUALITY_COMPONENTS
    .map((component) => ({
      ...component,
      normalizedScore: normalizedByKey[component.key] ?? null,
    }))
    .filter((component) => component.normalizedScore != null);
  const weightTotal = weightedComponents.reduce((sum, component) => sum + Number(component.weight || 0), 0);
  const meanValidatedQualityScore = weightTotal > 0
    ? roundResearchValue(
      weightedComponents.reduce((sum, component) => sum + (Number(component.normalizedScore || 0) * Number(component.weight || 0)), 0) / weightTotal,
      3,
    )
    : null;
  return {
    signalCount: Number(forwardOverall?.signalCount ?? tenureOverall?.signalCount) || 0,
    meanValidatedQualityScore,
    meanExcursionEdgeAtr: bestMoveAtr,
    meanCloseReturnAtr: closeResultAtr,
    guidanceRatePct: directionCorrectPct,
    meanStayedRightPct: stayedRightPct,
  };
}

function getResearchPerformanceValue(metric = null, overall = null) {
  const resolvedMetric = typeof metric === "string" ? getResearchPerformanceMetricDefinition(metric) : metric;
  if (!overall) {
    return null;
  }
  if (resolvedMetric?.key === "validated_quality") {
    return overall.validatedQualityScore ?? overall.meanValidatedQualityScore ?? null;
  }
  if (resolvedMetric?.key === "close_result") {
    return overall.closeResultAtr ?? overall.meanCloseReturnAtr ?? null;
  }
  if (resolvedMetric?.key === "direction_correct") {
    return overall.directionCorrectPct ?? overall.guidanceRatePct ?? null;
  }
  if (resolvedMetric?.key === "stayed_right") {
    return overall.stayedRightPct ?? overall.meanStayedRightPct ?? overall.meanTenurePct ?? null;
  }
  return overall.bestMoveAtr ?? overall.meanExcursionEdgeAtr ?? null;
}

function resolveResearchOverall({
  study = null,
  companionStudy = null,
  directionKey = "combined",
  timeframeKey = "overall",
  horizonKey = "3x",
  scoreType = "final",
} = {}) {
  const readOverall = (targetStudy = null) => {
    const preferredScoreType = timeframeKey === "overall"
      ? (targetStudy?.directionSummaries?.[directionKey]?.overallSummary?.preferredScoreType || targetStudy?.overallSummary?.preferredScoreType || "final")
      : (
        targetStudy?.timeframeDetails?.[timeframeKey]?.directions?.[directionKey]?.preferredScoreType
        || targetStudy?.timeframeDetails?.[timeframeKey]?.preferredScoreType
        || targetStudy?.directionSummaries?.[directionKey]?.overallSummary?.preferredScoreType
        || "final"
      );
    if (timeframeKey === "overall") {
      const horizon = targetStudy?.directionSummaries?.[directionKey]?.horizonSummaries?.[horizonKey]
        || targetStudy?.horizonSummaries?.[horizonKey]
        || null;
      return horizon?.[scoreType]?.overall
        || horizon?.[preferredScoreType]?.overall
        || horizon?.final?.overall
        || horizon?.raw?.overall
        || horizon?.effective?.overall
        || null;
    }
    const timeframeDetail = targetStudy?.timeframeDetails?.[timeframeKey]?.directions?.[directionKey]
      || targetStudy?.timeframeDetails?.[timeframeKey]
      || null;
    const horizon = timeframeDetail?.horizons?.[horizonKey] || null;
    return horizon?.[scoreType]?.overall
      || horizon?.[preferredScoreType]?.overall
      || horizon?.final?.overall
      || horizon?.raw?.overall
      || horizon?.effective?.overall
      || null;
  };

  const overall = readOverall(study);
  if (!overall) {
    return null;
  }
  const companionOverall = readOverall(companionStudy);
  const derivedOverall = deriveValidatedQualityOverall(overall, companionOverall);
  if (!derivedOverall) {
    return overall;
  }
  return {
    ...overall,
    meanValidatedQualityScore: overall.meanValidatedQualityScore ?? derivedOverall.meanValidatedQualityScore,
    meanExcursionEdgeAtr: overall.meanExcursionEdgeAtr ?? overall.bestMoveAtr ?? derivedOverall.meanExcursionEdgeAtr,
    meanCloseReturnAtr: overall.meanCloseReturnAtr ?? overall.closeResultAtr ?? derivedOverall.meanCloseReturnAtr,
    guidanceRatePct: overall.guidanceRatePct ?? overall.directionCorrectPct ?? derivedOverall.guidanceRatePct,
    meanStayedRightPct: overall.meanStayedRightPct ?? overall.meanTenurePct ?? derivedOverall.meanStayedRightPct,
  };
}

function resolveResearchValidityRows(study = null, directionKey = "combined") {
  return study?.scoreValidity?.directions?.[directionKey]?.timeframeHorizonRows
    || study?.directionSummaries?.[directionKey]?.timeframeHorizonRows
    || [];
}

function buildResearchTimeframePerformanceRows({
  study = null,
  baselineStudy = null,
  companionStudy = null,
  baselineCompanionStudy = null,
  directionKey = "combined",
  scoreType = "final",
  horizonKeys = [],
  metric = null,
} = {}) {
  const resolvedMetric = typeof metric === "string" ? getResearchPerformanceMetricDefinition(metric) : metric;
  const validityRows = resolveResearchValidityRows(study, directionKey);
  if (Array.isArray(validityRows) && validityRows.length) {
    const baselineByTimeframe = Object.fromEntries(
      resolveResearchValidityRows(baselineStudy, directionKey).map((row) => [row.timeframe, row]),
    );
    return validityRows.map((row) => {
      const baselineRow = baselineByTimeframe[row.timeframe] || null;
      return {
        key: row.timeframe,
        timeframe: row.timeframe,
        label: row.label || (row.timeframe === "overall" ? "All" : row.timeframe),
        signalCount: Number(row.signalCount) || 0,
        cells: Object.fromEntries((Array.isArray(horizonKeys) ? horizonKeys : []).map((horizonKey) => {
          const timeframeKey = row.timeframe === "overall" ? "overall" : row.timeframe;
          const currentCell = row?.cells?.[horizonKey] || null;
          const baselineCell = baselineRow?.cells?.[horizonKey] || null;
          const currentOverall = resolveResearchOverall({
            study,
            companionStudy,
            directionKey,
            timeframeKey,
            horizonKey,
            scoreType,
          });
          const baselineOverall = resolveResearchOverall({
            study: baselineStudy,
            companionStudy: baselineCompanionStudy,
            directionKey,
            timeframeKey,
            horizonKey,
            scoreType,
          });
          const value = getResearchPerformanceValue(resolvedMetric, currentCell) ?? getResearchPerformanceValue(resolvedMetric, currentOverall);
          const baselineValue = getResearchPerformanceValue(resolvedMetric, baselineCell) ?? getResearchPerformanceValue(resolvedMetric, baselineOverall);
          const currentNumeric = toFiniteNumber(value);
          const baselineNumeric = toFiniteNumber(baselineValue);
          return [horizonKey, {
            value,
            baselineValue,
            delta: currentNumeric != null && baselineNumeric != null ? currentNumeric - baselineNumeric : null,
            signalCount: Number(currentCell?.signalCount ?? currentOverall?.signalCount) || 0,
            baselineSignalCount: Number(baselineCell?.signalCount ?? baselineOverall?.signalCount) || 0,
          }];
        })),
      };
    });
  }

  const rows = [];
  const overallSignalCount = Number(study?.directionSummaries?.[directionKey]?.overallSummary?.totalSignals)
    || Number(study?.overallSummary?.totalSignals)
    || 0;
  rows.push({
    key: "overall",
    timeframe: "overall",
    label: "All",
    signalCount: overallSignalCount,
    cells: Object.fromEntries((Array.isArray(horizonKeys) ? horizonKeys : []).map((horizonKey) => {
      const overall = resolveResearchOverall({ study, companionStudy, directionKey, timeframeKey: "overall", horizonKey, scoreType });
      const baselineOverall = resolveResearchOverall({ study: baselineStudy, companionStudy: baselineCompanionStudy, directionKey, timeframeKey: "overall", horizonKey, scoreType });
      const value = getResearchPerformanceValue(resolvedMetric, overall);
      const baselineValue = getResearchPerformanceValue(resolvedMetric, baselineOverall);
      const currentNumeric = toFiniteNumber(value);
      const baselineNumeric = toFiniteNumber(baselineValue);
      return [horizonKey, {
        value,
        baselineValue,
        delta: currentNumeric != null && baselineNumeric != null ? currentNumeric - baselineNumeric : null,
        signalCount: Number(overall?.signalCount) || 0,
        baselineSignalCount: Number(baselineOverall?.signalCount) || 0,
      }];
    })),
  });

  RAYALGO_SCORE_STUDY_SIGNAL_TIMEFRAMES.forEach((timeframeKey) => {
    const entry = study?.timeframeDetails?.[timeframeKey] || null;
    const timeframeSignalCount = Number(entry?.directions?.[directionKey]?.signalCount)
      || Number(entry?.signalCount)
      || 0;
    rows.push({
      key: timeframeKey,
      timeframe: timeframeKey,
      label: timeframeKey,
      signalCount: timeframeSignalCount,
      cells: Object.fromEntries((Array.isArray(horizonKeys) ? horizonKeys : []).map((horizonKey) => {
        const overall = resolveResearchOverall({ study, companionStudy, directionKey, timeframeKey, horizonKey, scoreType });
        const baselineOverall = resolveResearchOverall({ study: baselineStudy, companionStudy: baselineCompanionStudy, directionKey, timeframeKey, horizonKey, scoreType });
        const value = getResearchPerformanceValue(resolvedMetric, overall);
        const baselineValue = getResearchPerformanceValue(resolvedMetric, baselineOverall);
        const currentNumeric = toFiniteNumber(value);
        const baselineNumeric = toFiniteNumber(baselineValue);
        return [horizonKey, {
          value,
          baselineValue,
          delta: currentNumeric != null && baselineNumeric != null ? currentNumeric - baselineNumeric : null,
          signalCount: Number(overall?.signalCount) || 0,
          baselineSignalCount: Number(baselineOverall?.signalCount) || 0,
        }];
      })),
    });
  });

  return rows;
}

function buildResearchFocusHorizonKeys(horizonKeys = []) {
  const preferred = ["3x", "24x", "120x"].filter((key) => horizonKeys.includes(key));
  if (preferred.length >= 3) {
    return preferred;
  }
  const fallback = [];
  if (horizonKeys[0]) fallback.push(horizonKeys[0]);
  if (horizonKeys[Math.floor(horizonKeys.length / 2)]) fallback.push(horizonKeys[Math.floor(horizonKeys.length / 2)]);
  if (horizonKeys[horizonKeys.length - 1]) fallback.push(horizonKeys[horizonKeys.length - 1]);
  return [...new Set([...preferred, ...fallback])];
}

function TimeframePerformanceMatrix({
  rows = [],
  horizons = [],
  metric = null,
  selectedTimeframe = "overall",
  onSelectTimeframe,
}) {
  if (!rows.length || !horizons.length) {
    return null;
  }
  const resolvedMetric = typeof metric === "string" ? getResearchPerformanceMetricDefinition(metric) : metric;
  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ minWidth: Math.max(820, 180 + (horizons.length * 86)), display: "grid", gap: 0 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `160px repeat(${horizons.length}, minmax(74px, 1fr))`,
            gap: 8,
            paddingBottom: 6,
            borderBottom: `1px solid ${BORDER}`,
            fontSize: 10,
            color: "#94a3b8",
            fontFamily: F,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          <div>Signal TF</div>
          {horizons.map((horizonKey) => (
            <div key={`head-${horizonKey}`}>{horizonKey}</div>
          ))}
        </div>
        {rows.map((row) => {
          const active = selectedTimeframe === row.timeframe;
          return (
            <div
              key={row.key}
              style={{
                display: "grid",
                gridTemplateColumns: `160px repeat(${horizons.length}, minmax(74px, 1fr))`,
                gap: 8,
                alignItems: "stretch",
                padding: "8px 0",
                borderBottom: `1px solid ${BORDER}`,
                background: active ? `${B}08` : "transparent",
              }}
            >
              <button
                type="button"
                onClick={() => onSelectTimeframe?.(row.timeframe)}
                style={{
                  border: "none",
                  background: "transparent",
                  textAlign: "left",
                  padding: 0,
                  cursor: "pointer",
                  fontFamily: F,
                }}
              >
                <div style={{ fontSize: 12.5, color: active ? B : "#0f172a", fontWeight: 700 }}>{row.label}</div>
                <div style={{ marginTop: 3, fontSize: 11, color: M }}>{formatCount(row.signalCount)} signals</div>
              </button>
              {horizons.map((horizonKey) => {
                const cell = row.cells?.[horizonKey] || null;
                const displayValue = Number.isFinite(Number(cell?.delta)) ? cell.delta : cell?.value;
                const tone = Number.isFinite(Number(cell?.delta))
                  ? researchPerformanceDeltaTone(cell?.delta)
                  : researchPerformanceTone(resolvedMetric, displayValue);
                const background = tone === G ? `${G}12` : tone === R ? `${R}10` : tone === B ? `${B}10` : "#f8fafc";
                return (
                  <div
                    key={`${row.key}-${horizonKey}`}
                    title={`${row.label} · ${horizonKey} · ${cell?.signalCount ? `${cell.signalCount} signals` : "No data"}${Number.isFinite(Number(cell?.baselineValue)) ? " · compared to baseline" : ""}`}
                    style={{
                      minHeight: 48,
                      padding: "6px 7px",
                      borderRadius: 8,
                      border: `1px solid ${active ? `${tone === M ? B : tone}22` : BORDER}`,
                      background,
                      display: "grid",
                      alignContent: "center",
                      justifyItems: "start",
                    }}
                  >
                    <div style={{ fontSize: 12, color: tone === M ? "#334155" : tone, fontFamily: F, fontWeight: 700 }}>
                      {Number.isFinite(Number(cell?.delta))
                        ? formatResearchPerformanceDelta(resolvedMetric, cell?.delta)
                        : formatResearchPerformanceValue(resolvedMetric, cell?.value)}
                    </div>
                    <div style={{ marginTop: 2, fontSize: 10.5, color: M, fontFamily: F }}>
                      {Number.isFinite(Number(cell?.baselineValue))
                        ? `${formatResearchPerformanceValue(resolvedMetric, cell?.value)} now · ${formatResearchPerformanceValue(resolvedMetric, cell?.baselineValue)} base`
                        : cell?.signalCount
                          ? `n ${cell.signalCount}`
                          : "No data"}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ActiveScoreStudyJobCard({ job = null, symbolFallback = "SPY", onCancel }) {
  if (!job?.jobId) {
    return null;
  }
  const statusMeta = getScoreStudyJobStatusMeta(job.status);
  const progressPct = Number.isFinite(Number(job?.progress?.pct))
    ? Math.max(0, Math.min(100, Number(job.progress.pct)))
    : null;
  const canCancel = ["queued", "running_background", "cancel_requested"].includes(String(job.status || ""));
  const stageLabel = String(job?.progress?.stage || "").trim() || (String(job.status || "").trim() || "running");
  const steps = buildScoreStudyJobSteps(job);
  const stageMeta = [
    job?.progress?.timeframe ? `tf ${job.progress.timeframe}` : null,
    Number.isFinite(Number(job?.progress?.current)) && Number.isFinite(Number(job?.progress?.total))
      ? `${job.progress.current}/${job.progress.total}`
      : null,
    Number.isFinite(Number(job?.progress?.barCount)) ? `${Number(job.progress.barCount).toLocaleString()} bars` : null,
    Number.isFinite(Number(job?.progress?.signalCount)) ? `${Number(job.progress.signalCount).toLocaleString()} signals` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div style={{ padding: "12px 14px", borderRadius: 10, border: `1px solid ${statusMeta.border}`, background: statusMeta.background, display: "grid", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "grid", gap: 5 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{
              display: "inline-flex",
              alignItems: "center",
              minHeight: 22,
              padding: "0 8px",
              borderRadius: 999,
              border: `1px solid ${statusMeta.border}`,
              background: "#ffffffaa",
              color: statusMeta.tone,
              fontSize: 11,
              fontFamily: F,
              fontWeight: 700,
            }}>
              {statusMeta.label}
            </span>
            <span style={{ fontSize: 12.5, fontFamily: F, fontWeight: 700, color: "#0f172a" }}>
              {job.status === "queued" ? "Server run waiting for worker" : job.status === "cancel_requested" ? "Server run stopping" : "Server run in progress"}
            </span>
          </div>
          <div style={{ fontSize: 12.5, fontFamily: F, color: "#0f172a" }}>
            {job?.progress?.detail || "The server worker is processing this full-history score study."}
          </div>
          <div style={{ fontSize: 11.5, fontFamily: F, color: "#64748b" }}>
            {job?.presetLabel || "--"} · {job?.symbol || symbolFallback || "--"} · updated {formatDateTime(job?.updatedAt || job?.createdAt)} · elapsed {formatScoreStudyJobElapsed(job)}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onCancel?.(job.jobId)}
          disabled={!canCancel || job.status === "cancel_requested"}
          style={{
            minHeight: 32,
            padding: "0 12px",
            borderRadius: 8,
            border: `1px solid ${job.status === "cancel_requested" ? BORDER : `${R}44`}`,
            background: job.status === "cancel_requested" ? "#f8fafc" : `${R}10`,
            color: job.status === "cancel_requested" ? M : R,
            fontSize: 12,
            fontFamily: F,
            fontWeight: 700,
            cursor: !canCancel || job.status === "cancel_requested" ? "not-allowed" : "pointer",
          }}
        >
          {job.status === "cancel_requested" ? "Cancelling..." : "Cancel Run"}
        </button>
      </div>

      <div style={{ display: "grid", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ fontSize: 11, color: "#64748b", fontFamily: F, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            {stageLabel.replace(/_/g, " ")}
          </div>
          <div style={{ fontSize: 11.5, color: "#334155", fontFamily: F }}>
            {progressPct == null ? "Live" : `${progressPct}%`}
          </div>
        </div>
        <div style={{ height: 8, borderRadius: 999, background: "#dbe7f3", overflow: "hidden" }}>
          <div
            style={{
              width: progressPct == null ? "35%" : `${progressPct}%`,
              height: "100%",
              borderRadius: 999,
              background: job.status === "cancel_requested"
                ? `linear-gradient(90deg, ${Y}aa, ${Y})`
                : `linear-gradient(90deg, ${B}bb, ${B})`,
            }}
          />
        </div>
        {stageMeta ? (
          <div style={{ fontSize: 11.5, color: "#64748b", fontFamily: F }}>
            {stageMeta}
          </div>
        ) : null}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 8 }}>
        {steps.map((step) => {
          const tone = step.status === "complete" ? G : step.status === "active" ? B : "#cbd5e1";
          return (
            <div key={step.key} style={{ display: "grid", gap: 5 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{
                  width: 10,
                  height: 10,
                  borderRadius: 999,
                  background: tone,
                  flex: "0 0 auto",
                }} />
                <span style={{ fontSize: 11.5, color: step.status === "pending" ? M : "#0f172a", fontFamily: F, fontWeight: step.status === "active" ? 700 : 600 }}>
                  {step.label}
                </span>
              </div>
              <div style={{ height: 4, borderRadius: 999, background: step.status === "pending" ? "#e2e8f0" : `${tone}33`, overflow: "hidden" }}>
                <div style={{
                  width: step.status === "complete" ? "100%" : step.status === "active" ? "55%" : "0%",
                  height: "100%",
                  borderRadius: 999,
                  background: tone,
                }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HorizonPlaybackTooltip({ active, payload, label, metricKey = "excursion_atr", seriesMetaByKey = {} }) {
  if (!active || !payload?.length) {
    return null;
  }
  const orderedPayload = [...payload].sort(
    (left, right) => (seriesMetaByKey[left.dataKey]?.order ?? 99) - (seriesMetaByKey[right.dataKey]?.order ?? 99),
  );
  return (
    <div
      style={{
        minWidth: 220,
        background: "#ffffffee",
        border: `1px solid ${BORDER}`,
        borderRadius: 8,
        padding: "8px 10px",
        fontFamily: F,
        boxShadow: SH1,
        backdropFilter: "blur(8px)",
        display: "grid",
        gap: 6,
      }}
    >
      <div style={{ fontSize: 10, color: "#94a3b8", letterSpacing: "0.08em", textTransform: "uppercase" }}>
        Horizon
      </div>
      <div style={{ marginTop: -2, fontSize: 13, color: "#111827", fontFamily: FS, fontWeight: 700 }}>{label}</div>
      {orderedPayload.map((entry, index) => {
        const runMeta = seriesMetaByKey[entry.dataKey] || {};
        const metrics = entry.payload?.runMetrics?.[entry.dataKey] || null;
        return (
          <div
            key={entry.dataKey}
            style={{
              display: "grid",
              gap: 3,
              paddingTop: index ? 6 : 0,
              borderTop: index ? `1px solid ${BORDER}` : "none",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: entry.color || runMeta.color || B, flex: "0 0 auto" }} />
                <span style={{ minWidth: 0, fontSize: 12.5, color: "#111827", fontFamily: FS, fontWeight: 700 }}>
                  {runMeta.label || entry.name || "Run"}
                </span>
              </div>
              <span style={{ fontSize: 12.5, color: horizonPlaybackTone(metricKey, entry.value), fontWeight: 700 }}>
                {formatHorizonPlaybackValue(metricKey, entry.value)}
              </span>
            </div>
            <div style={{ fontSize: 11.5, color: M, lineHeight: 1.4 }}>
              {formatHorizonPlaybackSecondary(metricKey, metrics)}
              {metrics?.signalCount != null ? ` · ${formatCount(metrics.signalCount)} signals` : ""}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function HorizonPlaybackPanel({
  title = "Horizon Playback",
  subtitle = null,
  rows = [],
  series = [],
  metricKey = "excursion_atr",
  seriesMetaByKey = {},
}) {
  const metric = getHorizonPlaybackMetricDefinition(metricKey);
  const hasAnyData = rows.some((row) => Object.keys(row.runMetrics || {}).length);
  const tableTemplateColumns = `88px repeat(${Math.max(series.length, 1)}, minmax(0, 1fr))`;

  return (
    <div
      style={{
        border: `1px solid ${BORDER}`,
        borderRadius: 10,
        background: "#fcfcfd",
        padding: "12px 14px",
        display: "grid",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 12, color: B, fontFamily: FS, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            {title}
          </div>
          <div style={{ marginTop: 4, fontSize: 11.5, color: M, fontFamily: F, lineHeight: 1.45 }}>
            {subtitle || `All signals only · final forward score · ${metric.label.toLowerCase()} across 3x-120x`}
          </div>
        </div>
        <div style={{ fontSize: 11, color: "#64748b", fontFamily: F }}>{getHorizonPlaybackMetricHelp(metricKey)}</div>
      </div>

      {!hasAnyData ? (
        <div style={{ minHeight: HORIZON_PLAYBACK_CHART_HEIGHT, display: "grid", placeItems: "center", color: M, fontFamily: F, fontSize: 12.5 }}>
          No forward horizon data is available for this direction.
        </div>
      ) : (
        <>
          <div style={{ height: HORIZON_PLAYBACK_CHART_HEIGHT, minHeight: HORIZON_PLAYBACK_CHART_HEIGHT }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="2 2" />
                <XAxis
                  dataKey="horizonKey"
                  tick={{ fill: "#9ca3af", fontSize: 12, fontFamily: F }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fill: "#9ca3af", fontSize: 12, fontFamily: F }}
                  tickLine={false}
                  axisLine={false}
                  width={metricKey === "guidance_rate" ? 52 : 64}
                  tickFormatter={(value) => formatHorizonPlaybackAxisValue(metricKey, value)}
                />
                <Tooltip content={<HorizonPlaybackTooltip metricKey={metricKey} seriesMetaByKey={seriesMetaByKey} />} />
                {metricKey !== "guidance_rate" ? <ReferenceLine y={0} stroke={REF} /> : null}
                {series.map((entry) => {
                  const runMeta = seriesMetaByKey[entry.key] || {};
                  return (
                    <Line
                      key={entry.key}
                      type="monotone"
                      dataKey={entry.key}
                      name={runMeta.label || entry.label || "Series"}
                      connectNulls={false}
                      stroke={runMeta.color || B}
                      strokeDasharray={runMeta.strokeDasharray}
                      strokeWidth={runMeta.order === 0 ? 2.6 : 2}
                      dot={{ r: 2, strokeWidth: 0, fill: runMeta.color || B }}
                      activeDot={{ r: 4 }}
                      isAnimationActive={false}
                    />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div style={{ display: "grid", gap: 0 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: tableTemplateColumns,
                gap: 8,
                paddingBottom: 6,
                borderBottom: `1px solid ${BORDER}`,
                fontSize: 10,
                color: "#94a3b8",
                fontFamily: F,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              <div>Horizon</div>
              {series.map((entry) => {
                const runMeta = seriesMetaByKey[entry.key] || {};
                return (
                  <div key={entry.key} style={{ minWidth: 0 }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 999, background: runMeta.color || B }} />
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {runMeta.label || entry.label || "Series"}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
            {rows.map((row) => (
              <div
                key={`playback-${row.horizonKey}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: tableTemplateColumns,
                  gap: 8,
                  alignItems: "start",
                  padding: "8px 0",
                  borderBottom: `1px solid ${BORDER}`,
                  fontFamily: F,
                }}
              >
                <div style={{ fontSize: 12, color: "#111827", fontWeight: 700 }}>{row.horizonKey}</div>
                {series.map((entry) => {
                  const metrics = row.runMetrics?.[entry.key] || null;
                  const value = getHorizonPlaybackMetricValue(metricKey, metrics);
                  return (
                    <div key={`${row.horizonKey}-${entry.key}`} style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: horizonPlaybackTone(metricKey, value), fontWeight: 700 }}>
                        {formatHorizonPlaybackValue(metricKey, value)}
                      </div>
                      <div style={{ marginTop: 3, fontSize: 10.5, color: M, lineHeight: 1.35 }}>
                        {metrics
                          ? `n ${formatCount(metrics.signalCount)} · ${formatHorizonPlaybackSecondary(metricKey, metrics)}`
                          : "No data"}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function formatPercent(value, digits = 1) {
  const numeric = toFiniteNumber(value);
  if (numeric == null) {
    return "--";
  }
  return `${numeric.toFixed(digits)}%`;
}

function getRankValidityTone(status = "") {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "working") return G;
  if (normalized === "mixed") return B;
  if (normalized === "not_working") return R;
  return Y;
}

function formatValidatedQualityScore(value = null) {
  const numeric = toFiniteNumber(value);
  if (numeric == null) {
    return "--";
  }
  return numeric.toFixed(3);
}

function hasAdvancedDiagnosticsResult(result = null) {
  if (!result || typeof result !== "object") {
    return false;
  }
  if (result?.metadata?.includeAdvancedDiagnostics) {
    return true;
  }
  return Boolean(
    result?.contrarianPolicyComparison
    || result?.qualityFloorRecommendation
    || result?.precisionCoverageFrontier
    || result?.scoreTrustAudit
    || result?.featureImpactSummaries
    || result?.signalClassSummaries,
  );
}

function buildEphemeralRunRecord({
  scoreStudy = null,
  selectedPresetId = null,
  presetLabelById = {},
  runtimeData = null,
} = {}) {
  if (!scoreStudy?.result) {
    return null;
  }
  const presetId = selectedPresetId || scoreStudy?.selectedPresetId || "current_setup";
  const presetLabel = presetLabelById[presetId] || getRayAlgoScoreStudyPresetDefinition(presetId).label;
  return {
    runId: "local-current",
    source: "local_ui",
    symbol: scoreStudy?.result?.metadata?.marketSymbol || runtimeData?.marketSymbol || "SPY",
    presetId,
    presetLabel,
    scoringVersion: scoreStudy?.result?.metadata?.scoringConfigPreview?.scoringVersion || null,
    executionProfile: scoreStudy?.result?.metadata?.scoringConfigPreview?.executionProfile || null,
    validityStatus: "valid",
    completedAt: scoreStudy?.lastRunAt || null,
    result: scoreStudy.result,
    summary: buildInlineScoreStudySummary(scoreStudy.result),
  };
}

function sortRunsNewestFirst(runs = []) {
  return [...runs].sort((left, right) => {
    const leftTs = Date.parse(left?.completedAt || left?.updatedAt || left?.createdAt || "") || 0;
    const rightTs = Date.parse(right?.completedAt || right?.updatedAt || right?.createdAt || "") || 0;
    return rightTs - leftTs;
  });
}

function resolveFocusedRunRecord({
  scoreStudy = null,
  selectedRunDetail = null,
  selectedPresetId = null,
  presetLabelById = {},
  runtimeData = null,
} = {}) {
  if (selectedRunDetail?.runId || selectedRunDetail?.result) {
    return normalizeScoreStudyRunRecord(selectedRunDetail);
  }
  const sortedRuns = sortRunsNewestFirst(Array.isArray(scoreStudy?.runs) ? scoreStudy.runs : []);
  const activeResultRun = scoreStudy?.result
    ? normalizeScoreStudyRunRecord({
      ...(sortedRuns.find((run) => run?.presetId === selectedPresetId) || {}),
      ...buildEphemeralRunRecord({
        scoreStudy,
        selectedPresetId,
        presetLabelById,
        runtimeData,
      }),
    })
    : null;
  if (scoreStudy?.selectedRunId) {
    const matchingRun = sortedRuns.find((run) => run?.runId === scoreStudy.selectedRunId);
    if (matchingRun) {
      return normalizeScoreStudyRunRecord(matchingRun);
    }
  }
  if (activeResultRun?.result) {
    return activeResultRun;
  }
  if (selectedPresetId) {
    const matchingPresetRun = sortedRuns.find((run) => (
      run?.presetId === selectedPresetId
      && String(run.validityStatus || "valid").trim().toLowerCase() !== "invalid"
    ));
    if (matchingPresetRun) {
      return normalizeScoreStudyRunRecord(matchingPresetRun);
    }
  }
  return normalizeScoreStudyRunRecord(buildEphemeralRunRecord({
    scoreStudy,
    selectedPresetId,
    presetLabelById,
    runtimeData,
  }));
}

function resolveBaselineRunRecord(runs = [], focusedRun = null, runDetailsById = {}) {
  const validRuns = sortRunsNewestFirst(runs).filter((run) => (
    run?.runId
    && run.runId !== focusedRun?.runId
    && String(run.validityStatus || "valid").trim().toLowerCase() !== "invalid"
  ));
  if (!validRuns.length) {
    return null;
  }
  const sameSymbolRuns = focusedRun?.symbol
    ? validRuns.filter((run) => String(run.symbol || "").trim().toUpperCase() === String(focusedRun.symbol || "").trim().toUpperCase())
    : validRuns;
  const scopedRuns = sameSymbolRuns.length ? sameSymbolRuns : validRuns;
  const baselineRun = scopedRuns.find((run) => run.presetId === RAYALGO_SCORE_STUDY_PRESET_TRANCHE2_2M) || scopedRuns[0] || null;
  if (!baselineRun?.runId) {
    return normalizeScoreStudyRunRecord(baselineRun);
  }
  const detailRun = runDetailsById?.[baselineRun.runId] || null;
  if (!detailRun) {
    return normalizeScoreStudyRunRecord(baselineRun);
  }
  return normalizeScoreStudyRunRecord({
    ...baselineRun,
    ...detailRun,
    summary: detailRun?.summary || baselineRun?.summary || null,
    result: detailRun?.result || baselineRun?.result || null,
  });
}

function formatBaselineDelta(value = null, baselineValue = null, digits = 3, suffix = "") {
  const numeric = toFiniteNumber(value);
  const baselineNumeric = toFiniteNumber(baselineValue);
  if (numeric == null || baselineNumeric == null) {
    return "No baseline";
  }
  const delta = numeric - baselineNumeric;
  return `${delta > 0 ? "+" : ""}${delta.toFixed(digits)}${suffix} vs baseline`;
}

function normalizeEdgeQuality(value = null) {
  const numeric = toFiniteNumber(value);
  if (numeric == null) {
    return null;
  }
  return Math.max(0, Math.min(1, 0.5 + (numeric / 4)));
}

function buildOperatorSummary(summary = null) {
  const normalized = normalizeDirectionSummary(summary);
  return {
    validatedQualityScore: normalized.validatedQualityScore,
    earlyCheckPct: normalized.earlyCheckPct,
    directionCorrectPct: normalized.directionCorrectPct,
    stayedRightPct: normalized.stayedRightPct,
    bestMoveAtr: normalized.bestMoveAtr,
    closeResultAtr: normalized.closeResultAtr,
    predictedScoreType: normalized.predictedScoreType,
    meanRawScore: normalized.meanRawScore,
    meanFinalScore: normalized.meanFinalScore,
    meanEffectiveScore: normalized.meanEffectiveScore,
    rankValidity: normalized.rankValidity,
    renderFloorScore: normalized.renderFloorScore,
    renderAction: normalized.renderAction,
    sampleSize: normalized.totalSignals,
  };
}

function formatScoreQuality(value = null) {
  return formatValidatedQualityScore(value);
}

function formatPointDelta(value = null, baselineValue = null) {
  const numeric = toFiniteNumber(value);
  const baselineNumeric = toFiniteNumber(baselineValue);
  if (numeric == null || baselineNumeric == null) {
    return "No baseline";
  }
  const delta = numeric - baselineNumeric;
  return `${delta > 0 ? "+" : ""}${delta.toFixed(0)} pts vs baseline`;
}

function resolveRenderRecommendation(summary = null) {
  const normalized = buildOperatorSummary(summary);
  if (!summary) {
    return "No visibility recommendation yet.";
  }
  if (normalized.renderAction === "hide_below_floor" && normalized.renderFloorScore != null) {
    return `Hide weak signals below ${normalized.renderFloorScore.toFixed(2)}.`;
  }
  if (normalized.renderAction === "fade_below_floor" && normalized.renderFloorScore != null) {
    return `Fade weak signals below ${normalized.renderFloorScore.toFixed(2)} instead of removing them.`;
  }
  if (normalized.renderAction === "keep_all_arrows") {
    return "Keep all arrows visible. The current floor is not helping.";
  }
  return "Keep testing before changing the visibility rule.";
}

function resolveDecisionSupport(summary = null, baselineSummary = null) {
  const operatorSummary = buildOperatorSummary(summary);
  const operatorBaseline = buildOperatorSummary(baselineSummary);
  const move = Number(operatorSummary.bestMoveAtr);
  const close = Number(operatorSummary.closeResultAtr);
  const quality = Number(operatorSummary.validatedQualityScore);
  const moveDelta = Number.isFinite(move) && Number.isFinite(Number(operatorBaseline.bestMoveAtr))
    ? move - Number(operatorBaseline.bestMoveAtr)
    : null;
  const closeDelta = Number.isFinite(close) && Number.isFinite(Number(operatorBaseline.closeResultAtr))
    ? close - Number(operatorBaseline.closeResultAtr)
    : null;
  const qualityDelta = Number.isFinite(quality) && Number.isFinite(Number(operatorBaseline.validatedQualityScore))
    ? quality - Number(operatorBaseline.validatedQualityScore)
    : null;
  const rankStatus = operatorSummary.rankValidity?.status || null;
  let verdict = operatorSummary.rankValidity?.verdict || "Need more evidence";
  let tone = getRankValidityTone(rankStatus);
  let detail = operatorSummary.rankValidity?.headline || "Use the rank-validity readout to judge whether higher predicted scores are actually separating better realized outcomes.";

  if (baselineSummary) {
    if (rankStatus === "working" && Number.isFinite(qualityDelta) && qualityDelta >= 0.02 && (!Number.isFinite(closeDelta) || closeDelta >= -0.02)) {
      verdict = "Promote candidate";
      tone = G;
      detail = "Rank validity is working, validated quality is ahead of baseline, and Close Result is not degrading materially.";
    } else if (rankStatus === "not_working" || (Number.isFinite(qualityDelta) && qualityDelta <= -0.02)) {
      verdict = "Do not promote";
      tone = R;
      detail = "Either the score rank is not separating outcomes or the validated outcome is behind baseline.";
    } else if (rankStatus === "mixed" || (Number.isFinite(qualityDelta) && qualityDelta > 0)) {
      verdict = "Keep testing";
      tone = B;
      detail = "There is some improvement, but the rank separation is not broad or stable enough to replace the baseline cleanly.";
    }
  }

  return {
    verdict,
    tone,
    detail,
    action: resolveRenderRecommendation(summary),
    deltas: {
      quality: qualityDelta,
      move: moveDelta,
      close: closeDelta,
    },
  };
}

function buildOperatorComparisonRows(summary = null, baselineSummary = null) {
  const current = buildOperatorSummary(summary);
  const baseline = buildOperatorSummary(baselineSummary);
  return [
    {
      key: "quality",
      label: VALIDATED_QUALITY_SCORE_LABEL,
      currentValue: current.validatedQualityScore,
      baselineValue: baseline.validatedQualityScore,
      formatter: formatScoreQuality,
    },
    {
      key: "move",
      label: "Best Move (ATR)",
      currentValue: current.bestMoveAtr,
      baselineValue: baseline.bestMoveAtr,
      formatter: (value) => formatSigned(value, 3),
    },
    {
      key: "close",
      label: "Close Result (ATR)",
      currentValue: current.closeResultAtr,
      baselineValue: baseline.closeResultAtr,
      formatter: (value) => formatSigned(value, 3),
    },
    {
      key: "direction",
      label: "Direction Correct (%)",
      currentValue: current.directionCorrectPct,
      baselineValue: baseline.directionCorrectPct,
      formatter: (value) => formatPercent(value, 0),
    },
    {
      key: "stayed",
      label: "Stayed Right (%)",
      currentValue: current.stayedRightPct,
      baselineValue: baseline.stayedRightPct,
      formatter: (value) => formatPercent(value, 0),
    },
    {
      key: "order",
      label: "Order Reliability (%)",
      currentValue: current.rankValidity?.orderReliabilityPct,
      baselineValue: baseline.rankValidity?.orderReliabilityPct,
      formatter: (value) => formatPercent(value, 0),
    },
  ];
}

function buildDirectionBreakdownRows(run = null, baselineRun = null) {
  return HORIZON_PLAYBACK_DIRECTIONS.map((direction) => ({
    key: direction.key,
    label: direction.label,
    current: normalizeDirectionSummary(run?.summary?.directions?.[direction.key] || null),
    baseline: normalizeDirectionSummary(baselineRun?.summary?.directions?.[direction.key] || null),
  }));
}

function OperatorComparisonPanel({
  summary = null,
  baselineSummary = null,
  currentLabel = "Selected",
  baselineLabel = "Baseline",
}) {
  const rows = buildOperatorComparisonRows(summary, baselineSummary);

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {rows.map((row) => {
        const currentValue = Number(row.currentValue);
        const baselineValue = Number(row.baselineValue);
        const maxValue = Math.max(Math.abs(currentValue) || 0, Math.abs(baselineValue) || 0, row.key === "quality" ? 1 : row.key === "move" || row.key === "close" ? 0.1 : 100);
        const currentWidth = Number.isFinite(currentValue) ? `${Math.max(8, (Math.abs(currentValue) / maxValue) * 100)}%` : "0%";
        const baselineWidth = Number.isFinite(baselineValue) ? `${Math.max(8, (Math.abs(baselineValue) / maxValue) * 100)}%` : "0%";

        return (
          <div key={row.key} style={{ display: "grid", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <div style={{ fontSize: 12.5, color: "#0f172a", fontFamily: FS, fontWeight: 700 }}>{row.label}</div>
              <div style={{ fontSize: 11.5, color: M, fontFamily: F }}>
                {row.key === "quality"
                  ? "Blended realized outcome score from 0 to 1."
                  : row.key === "move"
                    ? "Favorable move quality, normalized by ATR."
                    : row.key === "close"
                      ? "Horizon-end P/L, normalized by ATR."
                    : row.key === "direction"
                      ? "How often the move mostly went the predicted way."
                      : row.key === "stayed"
                        ? "How much of the horizon stayed on the correct side of entry."
                        : "How reliably higher predicted scores sort into better validated outcomes."}
              </div>
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ display: "grid", gridTemplateColumns: "92px minmax(0, 1fr) 80px", gap: 8, alignItems: "center" }}>
                <div style={{ fontSize: 11.5, color: "#334155", fontFamily: F, fontWeight: 700 }}>{currentLabel}</div>
                <div style={{ height: 10, borderRadius: 999, background: `${B}12`, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: currentWidth, borderRadius: 999, background: Number.isFinite(currentValue) && currentValue < 0 ? R : B }} />
                </div>
                <div style={{ fontSize: 11.5, color: Number.isFinite(currentValue) && currentValue < 0 ? R : B, fontFamily: F, fontWeight: 700, textAlign: "right" }}>
                  {row.formatter(row.currentValue)}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "92px minmax(0, 1fr) 80px", gap: 8, alignItems: "center" }}>
                <div style={{ fontSize: 11.5, color: "#334155", fontFamily: F, fontWeight: 700 }}>{baselineLabel}</div>
                <div style={{ height: 10, borderRadius: 999, background: "#e5e7eb", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: baselineWidth, borderRadius: 999, background: Number.isFinite(baselineValue) && baselineValue < 0 ? R : "#94a3b8" }} />
                </div>
                <div style={{ fontSize: 11.5, color: Number.isFinite(baselineValue) && baselineValue < 0 ? R : "#475569", fontFamily: F, fontWeight: 700, textAlign: "right" }}>
                  {row.formatter(row.baselineValue)}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SurfaceTabButton({ active = false, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        minHeight: 34,
        padding: "0 12px",
        borderRadius: 999,
        border: `1px solid ${active ? `${B}44` : BORDER}`,
        background: active ? `${B}10` : "#ffffff",
        color: active ? B : "#334155",
        fontSize: 12,
        fontFamily: F,
        fontWeight: 700,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function HistoryVerdictBadge({ summary = null, baselineSummary = null }) {
  const decision = resolveDecisionSupport(summary, baselineSummary);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        minHeight: 22,
        padding: "0 8px",
        borderRadius: 999,
        border: `1px solid ${decision.tone}33`,
        background: `${decision.tone}12`,
        color: decision.tone,
        fontSize: 11,
        fontFamily: F,
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      {decision.verdict}
    </span>
  );
}

function DirectionBreakdownChart({ rows = [], focusedLabel = "Selected", baselineLabel = "Baseline" }) {
  const maxValue = rows.reduce((largest, row) => {
    const currentValue = Math.abs(Number(row?.current?.validatedQualityScore) || 0);
    const baselineValue = Math.abs(Number(row?.baseline?.validatedQualityScore) || 0);
    return Math.max(largest, currentValue, baselineValue);
  }, 1);

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {rows.map((row) => {
        const currentValue = Number(row?.current?.validatedQualityScore);
        const baselineValue = Number(row?.baseline?.validatedQualityScore);
        const currentWidth = Number.isFinite(currentValue) ? `${Math.max(8, (Math.abs(currentValue) / maxValue) * 100)}%` : "0%";
        const baselineWidth = Number.isFinite(baselineValue) ? `${Math.max(8, (Math.abs(baselineValue) / maxValue) * 100)}%` : "0%";
        return (
          <div key={row.key} style={{ display: "grid", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <div style={{ fontSize: 12.5, color: "#0f172a", fontFamily: FS, fontWeight: 700 }}>{row.label}</div>
              <div style={{ fontSize: 11.5, color: M, fontFamily: F }}>
                {row.current?.directionCorrectPct == null ? "--" : `${row.current.directionCorrectPct.toFixed(1)}%`} direction correct · {row.current?.closeResultAtr == null ? "--" : formatSigned(row.current.closeResultAtr, 3)} ATR close result
              </div>
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ display: "grid", gridTemplateColumns: "88px minmax(0, 1fr) 72px", gap: 8, alignItems: "center" }}>
                <div style={{ fontSize: 11.5, color: "#334155", fontFamily: F, fontWeight: 700 }}>{focusedLabel}</div>
                <div style={{ height: 10, borderRadius: 999, background: `${B}12`, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: currentWidth, borderRadius: 999, background: Number.isFinite(currentValue) && currentValue < 0 ? R : B }} />
                </div>
                <div style={{ fontSize: 11.5, color: Number.isFinite(currentValue) && currentValue < 0 ? R : B, fontFamily: F, fontWeight: 700, textAlign: "right" }}>
                  {formatValidatedQualityScore(currentValue)}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "88px minmax(0, 1fr) 72px", gap: 8, alignItems: "center" }}>
                <div style={{ fontSize: 11.5, color: "#334155", fontFamily: F, fontWeight: 700 }}>{baselineLabel}</div>
                <div style={{ height: 10, borderRadius: 999, background: "#e5e7eb", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: baselineWidth, borderRadius: 999, background: Number.isFinite(baselineValue) && baselineValue < 0 ? R : "#94a3b8" }} />
                </div>
                <div style={{ fontSize: 11.5, color: Number.isFinite(baselineValue) && baselineValue < 0 ? R : "#475569", fontFamily: F, fontWeight: 700, textAlign: "right" }}>
                  {formatValidatedQualityScore(baselineValue)}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function ResearchInsightsScoreStudyTab({
  strategy = "rayalgo",
  scoreStudy = null,
  onRunScoreStudy,
  onQueueScoreStudy,
  onCancelScoreStudyJob,
  onRefreshScoreStudyCatalog,
  onSelectScoreStudyPreset,
  onSelectScoreStudyRun,
  onToggleCompareRun,
  onLoadScoreStudyRunDetail,
  onImportLocalArtifact,
  runtimeData = null,
}) {
  const normalizedStrategy = String(strategy || "").trim().toLowerCase();
  const presetOptions = React.useMemo(() => listRayAlgoScoreStudyPresets(), []);
  const operatorPresetOptions = React.useMemo(
    () => presetOptions.map((preset) => ({
      ...preset,
      operatorLabel: getOperatorPresetLabel(preset.id, preset.label),
      operatorDescription: getOperatorPresetDescription(preset.id, preset.description),
    })),
    [presetOptions],
  );
  const presetLabelById = React.useMemo(
    () => Object.fromEntries(presetOptions.map((preset) => [preset.id, preset.label])),
    [presetOptions],
  );
  const selectedPresetId = scoreStudy?.selectedPresetId || presetOptions[0]?.id || "current_setup";
  const selectedPresetDefinition = React.useMemo(
    () => operatorPresetOptions.find((preset) => preset.id === selectedPresetId) || {
      ...getRayAlgoScoreStudyPresetDefinition(selectedPresetId),
      operatorLabel: getOperatorPresetLabel(selectedPresetId, getRayAlgoScoreStudyPresetDefinition(selectedPresetId).label),
      operatorDescription: getOperatorPresetDescription(selectedPresetId, getRayAlgoScoreStudyPresetDefinition(selectedPresetId).description),
    },
    [operatorPresetOptions, selectedPresetId],
  );
  const selectedRunDetail = scoreStudy?.selectedRunDetail || null;
  const runs = Array.isArray(scoreStudy?.runs) ? scoreStudy.runs : [];
  const rawSelectedComparisonRuns = Array.isArray(scoreStudy?.selectedComparisonRuns) ? scoreStudy.selectedComparisonRuns : [];
  const [activeSurface, setActiveSurface] = React.useState("summary");
  const compareSurfaceActive = activeSurface === "compare";
  const [selectedCoverageTierKey, setSelectedCoverageTierKey] = React.useState("all");
  const [selectedPlaybackMetricKey, setSelectedPlaybackMetricKey] = React.useState("excursion_atr");
  const [visiblePlaybackDirectionKeys, setVisiblePlaybackDirectionKeys] = React.useState(
    () => HORIZON_PLAYBACK_DIRECTIONS.map((direction) => direction.key),
  );
  const [detailedPlaybackOpen, setDetailedPlaybackOpen] = React.useState(false);

  const selectedCoverageTier = React.useMemo(
    () => COVERAGE_TIER_OPTIONS.find((option) => option.key === selectedCoverageTierKey) || COVERAGE_TIER_OPTIONS[0],
    [selectedCoverageTierKey],
  );
  const selectedPlaybackMetric = React.useMemo(
    () => getHorizonPlaybackMetricDefinition(selectedPlaybackMetricKey),
    [selectedPlaybackMetricKey],
  );
  const selectedComparisonRuns = React.useMemo(
    () => rawSelectedComparisonRuns.map((run) => normalizeScoreStudyRunRecord(run)).filter(Boolean),
    [rawSelectedComparisonRuns],
  );
  const playbackRunMetaById = React.useMemo(() => (
    Object.fromEntries((compareSurfaceActive ? selectedComparisonRuns : []).map((run, index) => [
      run.runId,
      {
        order: index,
        color: HORIZON_PLAYBACK_RUN_COLORS[index % HORIZON_PLAYBACK_RUN_COLORS.length],
        label: run?.presetLabel || run?.scoringVersion || `Run ${index + 1}`,
      },
    ]))
  ), [compareSurfaceActive, selectedComparisonRuns]);
  const playbackLoadingLabels = React.useMemo(
    () => (compareSurfaceActive ? selectedComparisonRuns : [])
      .filter((run) => !run?.result && (run?.detailStatus === "loading" || run?.detailStatus === "idle"))
      .map((run) => playbackRunMetaById[run.runId]?.label || run?.presetLabel || "Run"),
    [compareSurfaceActive, playbackRunMetaById, selectedComparisonRuns],
  );
  const playbackWarnings = React.useMemo(
    () => (compareSurfaceActive ? selectedComparisonRuns : []).flatMap((run) => {
      const label = playbackRunMetaById[run.runId]?.label || run?.presetLabel || "Run";
      if (run?.detailError) {
        return [`${label}: ${run.detailError}`];
      }
      if (run?.result && !hasAnyHorizonPlaybackData(run)) {
        return [`${label}: forward 3x-120x detail is unavailable in this persisted run.`];
      }
      return [];
    }),
    [compareSurfaceActive, playbackRunMetaById, selectedComparisonRuns],
  );
  const playbackRenderableRuns = React.useMemo(
    () => (compareSurfaceActive ? selectedComparisonRuns : []).filter((run) => run?.result && hasAnyHorizonPlaybackData(run)),
    [compareSurfaceActive, selectedComparisonRuns],
  );
  const playbackVisibleDirections = React.useMemo(
    () => HORIZON_PLAYBACK_DIRECTIONS.filter((direction) => visiblePlaybackDirectionKeys.includes(direction.key)),
    [visiblePlaybackDirectionKeys],
  );
  const playbackSeries = React.useMemo(
    () => playbackRenderableRuns.flatMap((run, runIndex) => playbackVisibleDirections.map((direction, directionIndex) => ({
      key: `${run.runId}::${direction.key}`,
      label: `${run?.presetLabel || `Run ${runIndex + 1}`} · ${direction.label}`,
      order: runIndex * 10 + directionIndex,
      color: HORIZON_PLAYBACK_RUN_COLORS[runIndex % HORIZON_PLAYBACK_RUN_COLORS.length],
      strokeDasharray: HORIZON_PLAYBACK_DIRECTION_STYLES[direction.key]?.strokeDasharray,
    }))),
    [playbackRenderableRuns, playbackVisibleDirections],
  );
  const playbackSeriesMetaByKey = React.useMemo(
    () => Object.fromEntries(playbackSeries.map((entry) => [entry.key, entry])),
    [playbackSeries],
  );
  const playbackRows = React.useMemo(
    () => buildCombinedHorizonPlaybackRows(
      playbackRenderableRuns,
      playbackVisibleDirections.map((direction) => direction.key),
      selectedPlaybackMetricKey,
    ),
    [playbackRenderableRuns, playbackVisibleDirections, selectedPlaybackMetricKey],
  );
  const hasPlaybackData = React.useMemo(
    () => playbackRows.some((row) => Object.keys(row.runMetrics || {}).length),
    [playbackRows],
  );

  const selectedRunScoreStudyState = React.useMemo(() => {
    if (selectedRunDetail?.result) {
      return {
        status: "ready",
        error: null,
        result: selectedRunDetail.result,
        stale: false,
        lastRunAt: selectedRunDetail.completedAt || scoreStudy?.lastRunAt || null,
      };
    }
    return {
      status: scoreStudy?.selectedRunDetailStatus === "loading" ? "loading" : scoreStudy?.status || "idle",
      error: scoreStudy?.selectedRunDetailError || scoreStudy?.error || null,
      result: scoreStudy?.selectedRunId ? null : (scoreStudy?.result || null),
      stale: Boolean(scoreStudy?.stale),
      lastRunAt: scoreStudy?.lastRunAt || null,
    };
  }, [
    scoreStudy?.error,
    scoreStudy?.lastRunAt,
    scoreStudy?.result,
    scoreStudy?.selectedRunId,
    scoreStudy?.selectedRunDetailError,
    scoreStudy?.selectedRunDetailStatus,
    scoreStudy?.status,
    scoreStudy?.stale,
    selectedRunDetail,
  ]);

  const focusedRun = React.useMemo(() => resolveFocusedRunRecord({
    scoreStudy,
    selectedRunDetail,
    selectedPresetId,
    presetLabelById,
    runtimeData,
  }), [presetLabelById, runtimeData, scoreStudy, selectedPresetId, selectedRunDetail]);
  const baselineRun = React.useMemo(
    () => resolveBaselineRunRecord(runs, focusedRun, scoreStudy?.runDetailsById || {}),
    [focusedRun, runs, scoreStudy?.runDetailsById],
  );
  const baselineRunDetailStatus = React.useMemo(() => {
    const baselineRunId = String(baselineRun?.runId || "").trim();
    if (!baselineRunId) {
      return "idle";
    }
    if (baselineRun?.result) {
      return "ready";
    }
    return scoreStudy?.comparisonRunDetailStatusById?.[baselineRunId] || "idle";
  }, [baselineRun?.result, baselineRun?.runId, scoreStudy?.comparisonRunDetailStatusById]);
  const focusedRunLabel = React.useMemo(
    () => getOperatorPresetLabel(focusedRun?.presetId, focusedRun?.presetLabel),
    [focusedRun?.presetId, focusedRun?.presetLabel],
  );
  const baselineRunLabel = React.useMemo(
    () => getOperatorPresetLabel(baselineRun?.presetId, baselineRun?.presetLabel),
    [baselineRun?.presetId, baselineRun?.presetLabel],
  );
  const focusedCombinedSummary = focusedRun?.summary?.directions?.combined || null;
  const baselineCombinedSummary = baselineRun?.summary?.directions?.combined || null;
  const focusedOperatorSummary = React.useMemo(
    () => buildOperatorSummary(focusedCombinedSummary),
    [focusedCombinedSummary],
  );
  const baselineOperatorSummary = React.useMemo(
    () => buildOperatorSummary(baselineCombinedSummary),
    [baselineCombinedSummary],
  );
  const focusedRankValidityTone = React.useMemo(
    () => getRankValidityTone(focusedOperatorSummary.rankValidity?.status),
    [focusedOperatorSummary.rankValidity?.status],
  );
  const focusedEvaluatedTimeframes = Number(focusedOperatorSummary.rankValidity?.evaluatedTimeframeCount) || 0;
  const focusedWorkingTimeframes = Number(focusedOperatorSummary.rankValidity?.workingTimeframeCount) || 0;
  const decisionSupport = React.useMemo(
    () => resolveDecisionSupport(focusedCombinedSummary, baselineCombinedSummary),
    [baselineCombinedSummary, focusedCombinedSummary],
  );
  const directionBreakdownRows = React.useMemo(
    () => buildDirectionBreakdownRows(focusedRun, baselineRun),
    [baselineRun, focusedRun],
  );
  const sortedRuns = React.useMemo(
    () => sortRunsNewestFirst(runs).map((run) => normalizeScoreStudyRunRecord(run)).filter(Boolean),
    [runs],
  );
  const activeJob = scoreStudy?.activeJob?.jobId ? scoreStudy.activeJob : null;
  const hasBlockingServerJob = activeJob && ["queued", "running_background", "cancel_requested"].includes(String(activeJob.status || ""));
  const previousActiveJobIdRef = React.useRef(activeJob?.jobId || null);

  React.useEffect(() => {
    if (!focusedRun && activeSurface === "research") {
      setActiveSurface("summary");
    }
  }, [activeSurface, focusedRun]);

  React.useEffect(() => {
    const previousJobId = previousActiveJobIdRef.current;
    const currentJobId = activeJob?.jobId || null;
    if (previousJobId && !currentJobId && focusedRun) {
      setActiveSurface("summary");
    }
    previousActiveJobIdRef.current = currentJobId;
  }, [activeJob?.jobId, focusedRun]);

  React.useEffect(() => {
    if (
      activeSurface !== "research"
      || !onLoadScoreStudyRunDetail
      || !scoreStudy?.selectedRunId
      || selectedRunDetail?.result
      || scoreStudy?.selectedRunDetailStatus !== "idle"
    ) {
      return undefined;
    }
    void onLoadScoreStudyRunDetail(scoreStudy.selectedRunId, { purpose: "selected" });
    return undefined;
  }, [
    activeSurface,
    onLoadScoreStudyRunDetail,
    scoreStudy?.selectedRunDetailStatus,
    scoreStudy?.selectedRunId,
    selectedRunDetail?.result,
  ]);

  React.useEffect(() => {
    if (
      activeSurface !== "research"
      || !onLoadScoreStudyRunDetail
      || !baselineRun?.runId
      || baselineRun?.result
      || baselineRunDetailStatus !== "idle"
    ) {
      return undefined;
    }
    void onLoadScoreStudyRunDetail(baselineRun.runId, { purpose: "comparison" });
    return undefined;
  }, [
    activeSurface,
    baselineRun?.result,
    baselineRun?.runId,
    baselineRunDetailStatus,
    onLoadScoreStudyRunDetail,
  ]);

  React.useEffect(() => {
    if (activeSurface !== "compare" || !detailedPlaybackOpen || !onLoadScoreStudyRunDetail) {
      return undefined;
    }
    const runIdsToLoad = selectedComparisonRuns
      .filter((run) => run?.runId && !run?.result && run?.detailStatus === "idle")
      .map((run) => run.runId);
    if (!runIdsToLoad.length) {
      return undefined;
    }
    runIdsToLoad.forEach((runId) => {
      void onLoadScoreStudyRunDetail(runId, { purpose: "comparison" });
    });
    return undefined;
  }, [
    activeSurface,
    detailedPlaybackOpen,
    onLoadScoreStudyRunDetail,
    selectedComparisonRuns,
  ]);

  if (normalizedStrategy !== "rayalgo") {
    return (
      <EmptyState
        title="Score Tuning"
        body="This workbench is specific to RayAlgo because it compares raw signal_fire score calibration, gating, and forward follow-through."
      />
    );
  }

  if (scoreStudy?.availability?.status === "unavailable") {
    return (
      <SectionCard
        title="Score Tuning"
        subtitle="The score-tuning workbench is DB-backed and disabled until Postgres is configured."
      >
        <WarningList warnings={[scoreStudy?.availability?.error || "Score Tuning requires Postgres."]} />
      </SectionCard>
    );
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <SectionCard
        title="Score Tuning"
        subtitle="Predicted score, validated outcome, and rank validity in one operator-facing workflow. Full research remains available below."
      >
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <SurfaceTabButton active={activeSurface === "summary"} onClick={() => setActiveSurface("summary")}>Summary</SurfaceTabButton>
            <SurfaceTabButton active={activeSurface === "compare"} onClick={() => setActiveSurface("compare")}>Compare</SurfaceTabButton>
            <SurfaceTabButton active={activeSurface === "research"} onClick={() => setActiveSurface("research")}>Research</SurfaceTabButton>
            <SurfaceTabButton active={activeSurface === "artifacts"} onClick={() => setActiveSurface("artifacts")}>Artifacts</SurfaceTabButton>
          </div>
          <div style={{ fontSize: 12.5, color: M, fontFamily: F, lineHeight: 1.5 }}>
            {activeSurface === "summary"
              ? "Versions change the ranking recipe or gate. The main screen shows what changed, how the grade works, and why the version did or did not win."
              : activeSurface === "compare"
                ? "Compare saved versions against the baseline once the main grading logic is clear."
                : activeSurface === "research"
                  ? "Research keeps the internal diagnostics and threshold sweeps. They help debug the predictor, but they are not the primary decision surface."
                  : "Imports and local JSON artifacts stay isolated here instead of cluttering the main tuning flow."}
          </div>
        </div>
      </SectionCard>

      {activeSurface === "summary" ? (
        <>
          <SectionCard
            title="Run"
            subtitle="Choose the version you want to evaluate. Quick Run uses the local spot sample; Run Full History queues the full server job."
          >
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 320px) repeat(3, minmax(0, max-content))", gap: 8, alignItems: "end" }}>
                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ fontSize: 11, color: M, fontFamily: F, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>Version</span>
                  <select
                    value={selectedPresetId}
                    onChange={(event) => onSelectScoreStudyPreset?.(event.target.value)}
                    style={{
                      minHeight: 34,
                      borderRadius: 8,
                      border: `1px solid ${BORDER}`,
                      background: "#ffffff",
                      color: "#0f172a",
                      fontSize: 13,
                      fontFamily: F,
                      padding: "0 10px",
                    }}
                  >
                    {operatorPresetOptions.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.operatorLabel}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => onRunScoreStudy?.({ mode: "local", presetId: selectedPresetId })}
                  disabled={scoreStudy?.status === "loading"}
                  style={{
                    minHeight: 34,
                    padding: "0 12px",
                    borderRadius: 8,
                    border: `1px solid ${scoreStudy?.status === "loading" ? BORDER : `${G}44`}`,
                    background: scoreStudy?.status === "loading" ? "#e2e8f0" : `${G}12`,
                    color: scoreStudy?.status === "loading" ? M : G,
                    fontSize: 12,
                    fontFamily: F,
                    fontWeight: 700,
                    cursor: scoreStudy?.status === "loading" ? "wait" : "pointer",
                  }}
                >
                  {scoreStudy?.status === "loading" ? "Running..." : "Run Quick"}
                </button>
                <button
                  type="button"
                  onClick={() => onQueueScoreStudy?.({ presetId: selectedPresetId })}
                  disabled={hasBlockingServerJob}
                  style={{
                    minHeight: 34,
                    padding: "0 12px",
                    borderRadius: 8,
                    border: `1px solid ${hasBlockingServerJob ? BORDER : `${B}44`}`,
                    background: hasBlockingServerJob ? "#e2e8f0" : `${B}10`,
                    color: hasBlockingServerJob ? M : B,
                    fontSize: 12,
                    fontFamily: F,
                    fontWeight: 700,
                    cursor: hasBlockingServerJob ? "not-allowed" : "pointer",
                  }}
                >
                  {hasBlockingServerJob ? "Server Run Active" : "Run Full History"}
                </button>
                <button
                  type="button"
                  onClick={() => onRefreshScoreStudyCatalog?.()}
                  style={{
                    minHeight: 34,
                    padding: "0 12px",
                    borderRadius: 8,
                    border: `1px solid ${BORDER}`,
                    background: "#ffffff",
                    color: "#334155",
                    fontSize: 12,
                    fontFamily: F,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Refresh
                </button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 0.9fr)", gap: 8 }}>
                <SummaryMetric
                  label="Selected Version"
                  value={selectedPresetDefinition?.operatorLabel || "--"}
                  tone={B}
                  detail={selectedPresetDefinition?.operatorDescription || "Preset description unavailable."}
                />
                <SummaryMetric
                  label="Expected Output"
                  value={hasBlockingServerJob ? "Live Progress" : "Operator Summary"}
                  tone={hasBlockingServerJob ? B : G}
                  detail={hasBlockingServerJob
                    ? "This run updates here live and returns to the Summary view when it finishes."
                    : "A completed run updates the summary verdict and baseline comparison below."}
                />
              </div>

              {activeJob ? (
                <ActiveScoreStudyJobCard
                  job={activeJob}
                  symbolFallback={runtimeData?.marketSymbol || "--"}
                  onCancel={onCancelScoreStudyJob}
                />
              ) : null}

              {scoreStudy?.runsError ? <WarningList warnings={[scoreStudy.runsError]} /> : null}
            </div>
          </SectionCard>

          {!focusedRun ? (
            <EmptyState
              title="No summary yet"
              body="Run a version or open one from Compare to see what changed, how it is graded, and whether it beats the baseline."
            />
          ) : (
            <>
              <SectionCard
                title="How To Judge This Version"
                subtitle="Predicted score first, validated outcome second, rank validity last."
              >
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 8 }}>
                  <ProcessStepCard step="1" title="Version under test" tone={B}>
                    <div>
                      <strong>{focusedRunLabel}</strong> is the current candidate.
                    </div>
                    <div style={{ marginTop: 4 }}>
                      {getOperatorPresetDescription(focusedRun?.presetId, selectedPresetDefinition?.operatorDescription || focusedRun?.presetLabel)}
                    </div>
                    <div style={{ marginTop: 8 }}>
                      {baselineRun
                        ? <>It is judged against <strong>{baselineRunLabel}</strong>, the current reference version.</>
                        : "No reference version is loaded yet, so this run is being judged on its own quality only."}
                    </div>
                  </ProcessStepCard>

                  <ProcessStepCard step="2" title="Validated outcome" tone={G}>
                    <div>
                      We validate the predicted score against one blended realized outcome after the signal plays out.
                    </div>
                    <div style={{ marginTop: 6, display: "grid", gap: 4 }}>
                      {SCORE_QUALITY_COMPONENTS.map((component) => (
                        <div key={component.key}>
                          <strong>{component.label}</strong> ({component.weight}%): {component.detail}
                        </div>
                      ))}
                    </div>
                  </ProcessStepCard>

                  <ProcessStepCard step="3" title="What counts as working" tone={focusedRankValidityTone}>
                    <div>
                      Higher predicted scores must sort into better validated outcomes across the timeframe and horizon grid.
                    </div>
                    <div style={{ marginTop: 6 }}>
                      Promote only if <strong>{VALIDATED_QUALITY_SCORE_LABEL}</strong> improves, <strong>Close Result (ATR)</strong> does not materially worsen, and <strong>Order Reliability (%)</strong> stays healthy.
                    </div>
                  </ProcessStepCard>
                </div>
              </SectionCard>

              <SectionCard
                title="Current Decision"
                subtitle={`${focusedRunLabel} · ${focusedRun?.symbol || runtimeData?.marketSymbol || "--"} · ${sourceLabel(focusedRun?.source)}${focusedRun?.completedAt ? ` · ${formatDateTime(focusedRun.completedAt)}` : ""}`}
              >
                <div style={{ display: "grid", gap: 12 }}>
                  <div style={{ display: "grid", gap: 8, padding: "12px 14px", borderRadius: 10, border: `1px solid ${decisionSupport.tone}33`, background: `${decisionSupport.tone}10` }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                      <div style={{ fontSize: 14, color: "#0f172a", fontFamily: FS, fontWeight: 700 }}>{decisionSupport.verdict}</div>
                      <span style={{
                        display: "inline-flex",
                        alignItems: "center",
                        minHeight: 22,
                        padding: "0 8px",
                        borderRadius: 999,
                        border: `1px solid ${decisionSupport.tone}33`,
                        background: "#ffffffaa",
                        color: decisionSupport.tone,
                        fontSize: 11,
                        fontFamily: F,
                        fontWeight: 700,
                      }}>
                        {baselineRun ? `Compared to ${baselineRunLabel}` : "No baseline selected"}
                      </span>
                    </div>
                    <div style={{ fontSize: 12.5, color: "#334155", fontFamily: F, lineHeight: 1.55 }}>
                      {decisionSupport.detail} {decisionSupport.action}
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
                    <SummaryMetric
                      label={VALIDATED_QUALITY_SCORE_LABEL}
                      value={formatScoreQuality(focusedOperatorSummary.validatedQualityScore)}
                      tone={decisionSupport.tone}
                      detail={formatBaselineDelta(focusedOperatorSummary.validatedQualityScore, baselineOperatorSummary.validatedQualityScore, 3)}
                    />
                    <SummaryMetric
                      label="Predicted Score Basis"
                      value={getScoreSourceLabel(focusedOperatorSummary.predictedScoreType || "final")}
                      tone={B}
                      detail={focusedOperatorSummary.rankValidity?.headline || "The score source being tested as the ranker."}
                    />
                    <SummaryMetric
                      label="Order Reliability (%)"
                      value={formatPercent(focusedOperatorSummary.rankValidity?.orderReliabilityPct, 0)}
                      tone={focusedRankValidityTone}
                      detail={focusedOperatorSummary.rankValidity?.topBottomValidatedQualityLift == null
                        ? "Not enough ranked buckets yet."
                        : `${formatBaselineDelta(focusedOperatorSummary.rankValidity?.topBottomValidatedQualityLift, baselineOperatorSummary.rankValidity?.topBottomValidatedQualityLift, 3)} top-to-bottom validated-quality lift`}
                    />
                    <SummaryMetric
                      label="Best Move (ATR)"
                      value={formatSigned(focusedOperatorSummary.bestMoveAtr, 3)}
                      tone={Number(focusedOperatorSummary.bestMoveAtr) >= 0 ? G : R}
                      detail={`${SCORE_QUALITY_COMPONENTS.find((component) => component.key === "best_move_atr")?.weight || 35}% of validated outcome · ${formatBaselineDelta(focusedOperatorSummary.bestMoveAtr, baselineOperatorSummary.bestMoveAtr, 3)}`}
                    />
                    <SummaryMetric
                      label="Close Result (ATR)"
                      value={formatSigned(focusedOperatorSummary.closeResultAtr, 3)}
                      tone={Number(focusedOperatorSummary.closeResultAtr) >= 0 ? G : R}
                      detail={`${SCORE_QUALITY_COMPONENTS.find((component) => component.key === "close_result_atr")?.weight || 25}% of validated outcome · ${formatBaselineDelta(focusedOperatorSummary.closeResultAtr, baselineOperatorSummary.closeResultAtr, 3)}`}
                    />
                    <SummaryMetric
                      label="Direction Correct (%)"
                      value={formatPercent(focusedOperatorSummary.directionCorrectPct, 0)}
                      tone={B}
                      detail={`${SCORE_QUALITY_COMPONENTS.find((component) => component.key === "direction_correct_pct")?.weight || 15}% of validated outcome · ${formatPointDelta(focusedOperatorSummary.directionCorrectPct, baselineOperatorSummary.directionCorrectPct)}`}
                    />
                    <SummaryMetric
                      label="Stayed Right (%)"
                      value={formatPercent(focusedOperatorSummary.stayedRightPct, 0)}
                      tone={B}
                      detail={`${SCORE_QUALITY_COMPONENTS.find((component) => component.key === "stayed_right_pct")?.weight || 25}% of validated outcome · ${formatPointDelta(focusedOperatorSummary.stayedRightPct, baselineOperatorSummary.stayedRightPct)}`}
                    />
                    <SummaryMetric
                      label="Early Check"
                      value={formatPercent(focusedOperatorSummary.earlyCheckPct, 0)}
                      tone={B}
                      detail="Support metric only. Helpful for debugging, but not part of the validated outcome score."
                    />
                  </div>

                  <div style={{ fontSize: 12.5, color: M, fontFamily: F, lineHeight: 1.5 }}>
                    {formatCount(focusedOperatorSummary.sampleSize)} signals · {focusedOperatorSummary.rankValidity?.verdict || "Need more evidence"} · {focusedWorkingTimeframes}/{focusedEvaluatedTimeframes} timeframes working
                  </div>
                </div>
              </SectionCard>

                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.25fr) minmax(0, 0.9fr)", gap: 8 }}>
                <SectionCard
                  title="Baseline Check"
                  subtitle={baselineRun
                    ? `${focusedRunLabel} against ${baselineRunLabel} using predicted-score vs validated-outcome comparisons.`
                    : "A baseline will appear here once a comparable saved version exists."}
                >
                  {baselineRun ? (
                    <OperatorComparisonPanel
                      summary={focusedCombinedSummary}
                      baselineSummary={baselineCombinedSummary}
                      currentLabel={focusedRunLabel}
                      baselineLabel={baselineRunLabel}
                    />
                  ) : (
                    <EmptyState
                      title="No baseline loaded"
                      body="Open or import a reference version from Compare and it will show up here automatically."
                      actionLabel="Go To Compare"
                      onAction={() => setActiveSurface("compare")}
                    />
                  )}
                </SectionCard>

                <SectionCard title="Support Checks" subtitle="Useful diagnostics, but not the main promotion target.">
                  <div style={{ display: "grid", gap: 8 }}>
                    <SummaryMetric
                      label="Early Check"
                      value={formatPercent(focusedOperatorSummary.earlyCheckPct, 0)}
                      tone={B}
                      detail="Quick sanity check only. Helpful when a version starts strong early but does not hold up."
                    />
                    <SummaryMetric
                      label="Predicted Score Means"
                      value={focusedOperatorSummary.meanFinalScore == null ? "--" : focusedOperatorSummary.meanFinalScore.toFixed(3)}
                      tone={B}
                      detail={`Base ${focusedOperatorSummary.meanRawScore == null ? "--" : focusedOperatorSummary.meanRawScore.toFixed(3)} · adjusted ${focusedOperatorSummary.meanFinalScore == null ? "--" : focusedOperatorSummary.meanFinalScore.toFixed(3)} · live ${focusedOperatorSummary.meanEffectiveScore == null ? "--" : focusedOperatorSummary.meanEffectiveScore.toFixed(3)}`}
                    />
                    <SummaryMetric
                      label="Research"
                      value="Debugging"
                      tone={B}
                      detail="Use Research for internal diagnostics like ATR scaling, order reliability, visibility cutoffs, and invalidation rule sweeps."
                    />
                    <div style={{ display: "grid", gap: 6 }}>
                      {RESEARCH_ONLY_DIAGNOSTICS.map((item) => (
                        <div key={item.term} style={{ fontSize: 11.5, color: "#64748b", fontFamily: F, lineHeight: 1.45 }}>
                          <strong style={{ color: "#334155" }}>{item.term}</strong>: {item.detail}
                        </div>
                      ))}
                    </div>
                  </div>
                </SectionCard>
              </div>
            </>
          )}
        </>
      ) : null}

      {activeSurface === "compare" ? (
        <>
          <SectionCard
            title="Compare"
            subtitle={focusedRun
              ? `${focusedRunLabel}${baselineRun ? ` against ${baselineRunLabel}` : ""} with version switching and baseline-first comparison.`
              : "Open a saved version below to compare it against the baseline."}
          >
            {!focusedRun ? (
              <EmptyState
                title="No version selected"
                body="Open a version from the list below to compare it against the baseline."
              />
            ) : baselineRun ? (
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 1fr)", gap: 8 }}>
                <OperatorComparisonPanel
                  summary={focusedCombinedSummary}
                  baselineSummary={baselineCombinedSummary}
                  currentLabel={focusedRunLabel}
                  baselineLabel={baselineRunLabel}
                />
                <DirectionBreakdownChart
                  rows={directionBreakdownRows}
                  focusedLabel={focusedRunLabel}
                  baselineLabel={baselineRunLabel}
                />
              </div>
            ) : (
              <EmptyState
                title="No baseline available"
                body="Saved versions are available below, but there is not yet a comparable baseline for this symbol."
              />
            )}
          </SectionCard>

          <SectionCard
            title="Versions"
            subtitle="Open a saved version as the current candidate or mark saved versions for detailed playback."
          >
            {!sortedRuns.length ? (
              <EmptyState
                title="No saved versions yet"
                body="Run a quick study, queue a server run, or import a local artifact to populate saved versions."
              />
            ) : (
              <div style={{ display: "grid", gap: 0 }}>
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1.7fr) 118px 90px 132px 154px",
                  gap: 8,
                  paddingBottom: 6,
                  borderBottom: `1px solid ${BORDER}`,
                  fontSize: 10,
                  color: "#94a3b8",
                  fontFamily: F,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                }}>
                  <div>Version</div>
                  <div>Verdict</div>
                  <div>Main Grade</div>
                  <div>Completed</div>
                  <div>Actions</div>
                </div>
                {sortedRuns.map((run) => {
                  const combined = run?.summary?.directions?.combined || {};
                  const compareSelected = Array.isArray(scoreStudy?.selectedComparisonRunIds)
                    && scoreStudy.selectedComparisonRunIds.includes(run.runId);
                  const rowBaseline = resolveBaselineRunRecord(sortedRuns, run, scoreStudy?.runDetailsById || {});
                  const rowOperatorSummary = buildOperatorSummary(combined);
                  return (
                    <div
                      key={run.runId}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(0, 1.7fr) 118px 90px 132px 154px",
                        gap: 8,
                        alignItems: "center",
                        padding: "10px 0",
                        borderBottom: `1px solid ${BORDER}`,
                        fontFamily: F,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, color: run.runId === scoreStudy?.selectedRunId ? B : "#0f172a", fontWeight: 700 }}>
                          {getOperatorPresetLabel(run.presetId, run.presetLabel)}
                        </div>
                        <div style={{ marginTop: 3, fontSize: 11.5, color: M, lineHeight: 1.4, wordBreak: "break-word" }}>
                          {run.symbol || "--"} · {sourceLabel(run.source)}
                          {run.validityReason ? ` · ${run.validityReason}` : ""}
                        </div>
                      </div>
                      <div>
                        <HistoryVerdictBadge summary={combined} baselineSummary={rowBaseline?.summary?.directions?.combined || null} />
                      </div>
                      <div style={{ fontSize: 12, color: "#0f172a", fontWeight: 700 }}>
                        {formatScoreQuality(rowOperatorSummary.validatedQualityScore)}
                      </div>
                      <div style={{ fontSize: 11.5, color: M }}>{formatDateTime(run.completedAt)}</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          onClick={() => {
                            onSelectScoreStudyRun?.(run.runId);
                            setActiveSurface("summary");
                          }}
                          style={{
                            minHeight: 28,
                            padding: "0 10px",
                            borderRadius: 999,
                            border: `1px solid ${run.runId === scoreStudy?.selectedRunId ? `${B}44` : BORDER}`,
                            background: run.runId === scoreStudy?.selectedRunId ? `${B}10` : "#ffffff",
                            color: run.runId === scoreStudy?.selectedRunId ? B : "#334155",
                            fontSize: 11.5,
                            fontFamily: F,
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          Open
                        </button>
                        <button
                          type="button"
                          onClick={() => onToggleCompareRun?.(run.runId)}
                          disabled={run.validityStatus === "invalid"}
                          style={{
                            minHeight: 28,
                            padding: "0 10px",
                            borderRadius: 999,
                            border: `1px solid ${compareSelected ? `${G}44` : BORDER}`,
                            background: compareSelected ? `${G}10` : "#ffffff",
                            color: compareSelected ? G : "#334155",
                            fontSize: 11.5,
                            fontFamily: F,
                            fontWeight: 700,
                            cursor: run.validityStatus === "invalid" ? "not-allowed" : "pointer",
                            opacity: run.validityStatus === "invalid" ? 0.55 : 1,
                          }}
                        >
                          {compareSelected ? "Compared" : "Compare"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>

          <details
            open={detailedPlaybackOpen}
            onToggle={(event) => setDetailedPlaybackOpen(Boolean(event.currentTarget.open))}
            style={{ border: `1px solid ${BORDER}`, borderRadius: 10, background: "#ffffff", overflow: "hidden" }}
          >
            <summary style={{ cursor: "pointer", listStyle: "none", padding: "12px 14px", fontSize: 12.5, color: B, fontFamily: FS, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              Detailed Playback
            </summary>
            {detailedPlaybackOpen ? (
            <div style={{ padding: "0 14px 14px", display: "grid", gap: 10 }}>
              {selectedComparisonRuns.length ? (
                <SectionCard
                  title="Detailed Playback"
                  subtitle={selectedCoverageTierKey === "all"
                    ? "Use the saved versions you selected above to compare their move path over time."
                    : `${selectedCoverageTier.label} shows only the strongest slice of each selected version.`}
                >
                  <div style={{ display: "grid", gap: 10 }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                      <div style={{ minWidth: 72, fontSize: 11, color: M, fontFamily: F, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                        Coverage
                      </div>
                      {COVERAGE_TIER_OPTIONS.map((option) => (
                        <PillButton
                          key={option.key}
                          active={selectedCoverageTierKey === option.key}
                          onClick={() => setSelectedCoverageTierKey(option.key)}
                        >
                          {option.label}
                        </PillButton>
                      ))}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 8 }}>
                      {selectedComparisonRuns.map((run) => (
                        <ComparisonRunCard
                          key={run.runId}
                          run={run}
                          active={run.runId === scoreStudy?.selectedRunId}
                          onSelect={() => {
                            onSelectScoreStudyRun?.(run.runId);
                            setActiveSurface("summary");
                          }}
                          coverageTierKey={selectedCoverageTier.key}
                          coverageTierLabel={selectedCoverageTier.label}
                        />
                      ))}
                    </div>

                    <div style={{ display: "grid", gap: 10, paddingTop: 2, borderTop: `1px solid ${BORDER}` }}>
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                        <div>
                          <div style={{ fontSize: 12, color: B, fontFamily: FS, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                            Horizon Playback
                          </div>
                          <div style={{ marginTop: 4, fontSize: 11.5, color: M, fontFamily: F, lineHeight: 1.45 }}>
                            Compare how each selected version evolves from 3x through 120x.
                          </div>
                        </div>
                        <div style={{ display: "grid", gap: 8, justifyItems: "start" }}>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                            <div style={{ minWidth: 56, fontSize: 11, color: M, fontFamily: F, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                              Metric
                            </div>
                            {HORIZON_PLAYBACK_METRICS.map((metric) => (
                              <PillButton
                                key={metric.key}
                                active={selectedPlaybackMetricKey === metric.key}
                                onClick={() => setSelectedPlaybackMetricKey(metric.key)}
                              >
                                {metric.label}
                              </PillButton>
                            ))}
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                            {playbackRenderableRuns.map((run) => {
                              const runMeta = playbackRunMetaById[run.runId] || {};
                              return (
                                <div
                                  key={`legend-${run.runId}`}
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 6,
                                    minHeight: 24,
                                    padding: "0 9px",
                                    borderRadius: 999,
                                    border: `1px solid ${BORDER}`,
                                    background: "#ffffff",
                                    color: "#334155",
                                    fontSize: 11.5,
                                    fontFamily: F,
                                    fontWeight: 700,
                                  }}
                                >
                                  <span style={{ width: 8, height: 8, borderRadius: 999, background: runMeta.color || B }} />
                                  <span>{getOperatorPresetLabel(run.presetId, runMeta.label || run?.presetLabel || "Run")}</span>
                                </div>
                              );
                            })}
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                            <div style={{ minWidth: 56, fontSize: 11, color: M, fontFamily: F, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                              View
                            </div>
                            {HORIZON_PLAYBACK_DIRECTIONS.map((direction) => {
                              const active = visiblePlaybackDirectionKeys.includes(direction.key);
                              return (
                                <PillButton
                                  key={direction.key}
                                  active={active}
                                  onClick={() => setVisiblePlaybackDirectionKeys((previous) => {
                                    const next = previous.includes(direction.key)
                                      ? previous.filter((entry) => entry !== direction.key)
                                      : [...previous, direction.key];
                                    return next.length ? next : previous;
                                  })}
                                >
                                  {direction.label}
                                </PillButton>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      {playbackLoadingLabels.length ? (
                        <div style={{ fontSize: 11.5, color: M, fontFamily: F, lineHeight: 1.45 }}>
                          Loading saved detail for {playbackLoadingLabels.join(", ")}.
                        </div>
                      ) : null}

                      {playbackWarnings.length ? <WarningList warnings={playbackWarnings} /> : null}

                      {hasPlaybackData || playbackLoadingLabels.length ? (
                        <div style={{ display: "grid", gap: 10 }}>
                          <ScoreStudyMetricGuide />
                          <HorizonPlaybackPanel
                            title="Horizon Playback"
                            subtitle="Toggle Combined, Long, and Short in one chart. Solid lines are combined; dashed lines are directional slices of the same run."
                            rows={playbackRows}
                            series={playbackSeries}
                            metricKey={selectedPlaybackMetric.key}
                            seriesMetaByKey={playbackSeriesMetaByKey}
                          />
                        </div>
                      ) : (
                        <EmptyState
                          title="Playback unavailable"
                          body="Select saved versions with imported forward detail to compare 3x-120x performance in one place."
                        />
                      )}
                    </div>
                  </div>
                </SectionCard>
              ) : (
                <EmptyState
                  title="No compared versions selected"
                  body="Use Compare in the versions list above when you want side-by-side detailed playback."
                />
              )}
            </div>
            ) : null}
          </details>
        </>
      ) : null}

      {activeSurface === "research" ? (
        <>
          <SectionCard
            title="Research"
            subtitle="Full scoring research is retained here. Main labels stay plain-English, while internal version details remain available for traceability."
          >
            {!focusedRun ? (
              <EmptyState
                title="No version selected"
                body="Open a saved version from Compare or run a new one from Summary to unlock the full research surface."
              />
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
                <SummaryMetric
                  label="Version"
                  value={focusedRunLabel}
                  tone={B}
                  detail="Operator-facing version label."
                />
                <SummaryMetric
                  label="Internal Score"
                  value={focusedRun?.scoringVersion || "--"}
                  tone={B}
                  detail="Internal scoring version identifier."
                />
                <SummaryMetric
                  label="Internal Profile"
                  value={focusedRun?.executionProfile || "--"}
                  tone={B}
                  detail="Internal execution/profile identifier."
                />
                <SummaryMetric
                  label="Source"
                  value={sourceLabel(focusedRun?.source)}
                  tone={B}
                  detail={`${formatCount(focusedOperatorSummary.sampleSize)} signals in the selected run.`}
                />
              </div>
            )}
          </SectionCard>

          {scoreStudy?.selectedRunDetailStatus === "loading" && !selectedRunDetail?.result && scoreStudy?.selectedRunId ? (
            <SectionCard title="Research Detail" subtitle="Loading the saved research payload for the selected version.">
              <div style={{ fontSize: 12.5, fontFamily: F, color: M }}>
                Loading saved score-study detail...
              </div>
            </SectionCard>
          ) : selectedRunScoreStudyState.result ? (
            <ScoreStudyDeepDive
              strategy={strategy}
              scoreStudy={selectedRunScoreStudyState}
              baselineResult={baselineRun?.result || null}
              onRunScoreStudy={(options = {}) => onRunScoreStudy?.({ mode: "local", presetId: selectedPresetId, ...(options || {}) })}
              onQueueScoreStudy={onQueueScoreStudy}
              selectedPresetId={focusedRun?.presetId || selectedPresetId}
              hasBlockingServerJob={hasBlockingServerJob}
              runtimeData={runtimeData}
            />
          ) : (
            <EmptyState
              title="Research detail unavailable"
              body="Open a saved version or finish a quick run to unlock the full timeframe, bucket, and invalidation research views."
            />
          )}
        </>
      ) : null}

      {activeSurface === "artifacts" ? (
        <SectionCard
          title="Artifacts"
          subtitle="Workspace JSON exports from the CLI can be imported into the same saved history used by quick runs and server jobs."
        >
          {!Array.isArray(scoreStudy?.localArtifacts) || !scoreStudy.localArtifacts.length ? (
            <div style={{ fontSize: 12.5, color: M, fontFamily: F }}>
              No local `output/rayalgo-score-study` artifacts were found.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 0 }}>
              {scoreStudy.localArtifacts.map((artifact) => (
                  <div
                    key={artifact.relativePath}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 1.8fr) 110px 88px 96px 120px",
                      gap: 8,
                      alignItems: "center",
                      padding: "9px 0",
                      borderBottom: `1px solid ${BORDER}`,
                      fontFamily: F,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, color: "#0f172a", fontWeight: 700 }}>{artifact.fileName}</div>
                      <div style={{ marginTop: 3, fontSize: 11.5, color: M, lineHeight: 1.4, wordBreak: "break-word" }}>
                        {getOperatorPresetLabel(artifact.presetId, artifact.presetLabel) || "--"} · {artifact.symbol || "--"}
                        {artifact.validityReason ? ` · ${artifact.validityReason}` : ""}
                      </div>
                    </div>
                    <div style={{ fontSize: 11.5, color: B }}>{artifact.imported ? "Imported" : "Pending"}</div>
                    <div style={{ fontSize: 11.5, color: validityTone(artifact.validityStatus) === "positive" ? G : validityTone(artifact.validityStatus) === "danger" ? R : Y }}>
                      {artifact.validityStatus || "unverified"}
                    </div>
                    <div style={{ fontSize: 11.5, color: M }}>{formatDateTime(artifact.generatedAt)}</div>
                    <div>
                      <button
                        type="button"
                        onClick={() => onImportLocalArtifact?.(artifact.relativePath)}
                        disabled={artifact.imported}
                        style={{
                          minHeight: 28,
                          padding: "0 10px",
                          borderRadius: 999,
                          border: `1px solid ${artifact.imported ? BORDER : `${B}44`}`,
                          background: artifact.imported ? "#f8fafc" : `${B}10`,
                          color: artifact.imported ? M : B,
                          fontSize: 11.5,
                          fontFamily: F,
                          fontWeight: 700,
                          cursor: artifact.imported ? "not-allowed" : "pointer",
                        }}
                      >
                        {artifact.imported ? "Imported" : "Import"}
                      </button>
                    </div>
                  </div>
              ))}
            </div>
          )}
        </SectionCard>
      ) : null}
    </div>
  );
}
