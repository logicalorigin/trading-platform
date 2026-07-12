import React from "react";
import {
  CSS_COLOR,
  FONT_WEIGHTS,
  RADII,
  T,
  cssColorAlpha,
  dim,
  fs,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import {
  FailurePointInlineIcon,
  FailurePointTooltip,
} from "../../components/platform/FailurePointTooltip.jsx";
import { DataUnavailableState } from "../../components/platform/primitives.jsx";
import {
  buildAlgoMetricFailurePoint,
  buildPipelineStageFailurePoint,
} from "../../features/platform/failurePointModel.js";
import { toneForDirectionalIntent } from "../../features/platform/semanticToneModel.js";
import { SIGNAL_SCORE_RANGE_BUCKETS, formatPct } from "./algoHelpers";

const overviewSeverityBackground = (severity) => {
  if (severity === "warning") return CSS_COLOR.amberBg;
  return "transparent";
};

export const AlgoOverviewMetric = ({
  label,
  value,
  detail,
  tone,
  icon: Icon,
  severity,
  dense = false,
}) => {
  const iconTone =
    severity === "warning"
      ? CSS_COLOR.amber
      : tone || CSS_COLOR.textSec;
  const failurePoint =
    severity === "warning"
      ? buildAlgoMetricFailurePoint({
          label,
          value,
          detail,
          severity,
          nextAction: "Review this metric against the current Signal Options profile.",
        })
      : null;
  const metricBody = (
    <div
      tabIndex={failurePoint ? 0 : undefined}
      style={{
        display: "grid",
        gridTemplateColumns: Icon
          ? `${dim(16)}px minmax(0, 1fr)`
          : "minmax(0, 1fr)",
        alignItems: "center",
        gap: sp(dense ? 2 : 3),
        minWidth: 0,
        minHeight: dim(dense ? 28 : 32),
        padding: sp(dense ? "2px 4px" : "3px 5px"),
        borderRadius: dim(RADII.xs),
        background: overviewSeverityBackground(severity),
      }}
    >
      {Icon ? (
        <Icon
          size={dense ? 13 : 14}
          strokeWidth={1.8}
          aria-hidden="true"
          style={{ color: iconTone }}
        />
      ) : null}
      <div style={{ minWidth: 0, display: "grid", gap: sp(1) }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: sp(3),
            color: CSS_COLOR.textMuted,
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            lineHeight: 1.05,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
            {label}
          </span>
        </span>
        <span
          style={{
            color: tone || CSS_COLOR.text,
            fontFamily: T.sans,
            fontSize: fs(dense ? 10 : 11),
            fontWeight: 600,
            lineHeight: 1.08,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {value}
        </span>
        {detail ? (
          <span
            style={{
              color: CSS_COLOR.textDim,
              fontFamily: T.sans,
              fontSize: textSize("caption"),
              lineHeight: 1.05,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {detail}
          </span>
        ) : null}
      </div>
    </div>
  );
  return failurePoint ? (
    <FailurePointTooltip point={failurePoint} side="top" align="start">
      {metricBody}
    </FailurePointTooltip>
  ) : (
    metricBody
  );
};

const DEFAULT_SCORE_DISPLAY_THRESHOLD = 60;

const normalizeScoreDisplayThreshold = (threshold) => {
  const value = Number(threshold);
  if (!Number.isFinite(value)) return DEFAULT_SCORE_DISPLAY_THRESHOLD;
  return Math.max(0, Math.min(90, Math.floor(value / 10) * 10));
};

const indicatorKpiScoreTone = (bucket) => {
  if (bucket?.key === "unknown") return CSS_COLOR.textMuted;
  const min = Number(bucket?.min);
  if (Number.isFinite(min) && min >= 60) return CSS_COLOR.green;
  if (Number.isFinite(min) && min >= 40) return CSS_COLOR.amber;
  return CSS_COLOR.red;
};

const pickIndicatorMetrics = (source) => {
  const value = source && typeof source === "object" ? source : {};
  return {
    signalCount: Number.isFinite(value.signalCount) ? value.signalCount : 0,
    medianMovePercent:
      value.medianDirectionalMovePercent ?? value.medianMovePercent,
    avgMovePercent: value.avgDirectionalMovePercent ?? value.avgMovePercent,
    correctnessPercent: value.correctnessPercent,
    expectancyPercent: value.expectancyPercent,
    avgMfePercent: value.avgMfePercent,
    avgMaePercent: value.avgMaePercent,
    moveTimeline: Array.isArray(value.moveTimeline) ? value.moveTimeline : [],
  };
};

const pickScoreBucketDirectionMetrics = (source) => {
  const byDirection =
    source?.byDirection && typeof source.byDirection === "object"
      ? source.byDirection
      : {};
  return {
    buy: pickIndicatorMetrics(byDirection.buy),
    sell: pickIndicatorMetrics(byDirection.sell),
  };
};

// Indicator KPI direction rows: All / Buy / Sell. Score calibration is folded
// into the same rendered table as bucket subcolumns under each metric group.
export const buildIndicatorKpiTableRows = (metrics) => {
  const root = metrics && typeof metrics === "object" ? metrics : {};
  const byDirection =
    root.byDirection && typeof root.byDirection === "object"
      ? root.byDirection
      : {};
  return [
    { key: "all", label: "All", group: "direction", ...pickIndicatorMetrics(root) },
    {
      key: "buy",
      label: "Buy",
      group: "direction",
      ...pickIndicatorMetrics(byDirection.buy),
    },
    {
      key: "sell",
      label: "Sell",
      group: "direction",
      ...pickIndicatorMetrics(byDirection.sell),
    },
  ];
};

const SCORE_AUDIT_MATRIX_ROWS = [
  { key: "signals", label: "Signals" },
  { key: "medianMove", label: "Median Move" },
  { key: "avgMove", label: "Avg Move" },
  { key: "correctness", label: "Correct" },
  { key: "expectancy", label: "Expect" },
  { key: "excursion", label: "Excursion" },
  { key: "path", label: "Path" },
];

export const buildScoreBucketAuditMatrix = (
  metrics,
) => {
  const root = metrics && typeof metrics === "object" ? metrics : {};
  const scoreBucketRecords = Array.isArray(root.scoreBuckets)
    ? root.scoreBuckets
    : null;
  if (scoreBucketRecords) {
    const scoreBucketByKey = new Map(
      scoreBucketRecords
        .filter((bucket) => bucket && typeof bucket === "object")
        .map((bucket) => [bucket.key, bucket]),
    );
    const mergedBuckets = SIGNAL_SCORE_RANGE_BUCKETS.map((baseBucket) => {
      const bucket = scoreBucketByKey.get(baseBucket.key) ?? baseBucket;
      return {
        key: baseBucket.key,
        label: baseBucket.label,
        tone: indicatorKpiScoreTone(baseBucket),
        ...pickIndicatorMetrics(bucket),
        byDirection: pickScoreBucketDirectionMetrics(bucket),
        min: baseBucket.min,
        max: baseBucket.max,
      };
    });
    const buckets = [...mergedBuckets];
    const unknownBucket = scoreBucketByKey.get("unknown");
    const unknownPicked = pickIndicatorMetrics(unknownBucket);
    if (unknownPicked.signalCount > 0) {
      buckets.push({
        key: "unknown",
        label: "Unknown",
        tone: CSS_COLOR.textMuted,
        ...unknownPicked,
        byDirection: pickScoreBucketDirectionMetrics(unknownBucket),
      });
    }
    return { buckets, rows: SCORE_AUDIT_MATRIX_ROWS };
  }
  const byScoreBucket =
    root.byScoreBucket && typeof root.byScoreBucket === "object"
      ? root.byScoreBucket
      : {};
  const legacyBuckets = [
    { key: "high", bucket: "high", label: "High", tone: CSS_COLOR.green },
    {
      key: "standard",
      bucket: "standard",
      label: "Standard",
      tone: CSS_COLOR.amber,
    },
    { key: "low", bucket: "low", label: "Low", tone: CSS_COLOR.red },
    {
      key: "unknown",
      bucket: "unknown",
      label: "Unknown",
      tone: CSS_COLOR.textMuted,
    },
  ];
  const buckets = legacyBuckets
    .map(({ key, bucket, label, tone }) => ({
      key,
      label,
      tone,
      ...pickIndicatorMetrics(byScoreBucket[bucket]),
      byDirection: pickScoreBucketDirectionMetrics(byScoreBucket[bucket]),
    }))
    .filter((bucket) => bucket.key !== "unknown" || bucket.signalCount > 0);
  return { buckets, rows: SCORE_AUDIT_MATRIX_ROWS };
};

const SCORE_CALIBRATION_STATE_LABELS = {
  calibrated: "Calibrated",
  needs_more_data: "Needs more data",
  uncalibrated: "Uncalibrated",
};

const SCORE_CALIBRATION_REASON_LABELS = {
  min_observation_count: "sample",
  min_populated_bucket_count: "buckets",
  min_top_bucket_signal_count: "top band",
  min_lower_baseline_signal_count: "baseline",
  min_alignment_score: "alignment",
  coverage_degraded: "coverage",
};

const formatScoreModelKey = (modelKey) =>
  String(modelKey)
    .split("-")
    .map((part) => part.toUpperCase())
    .join(" ");

export const buildScoreCalibrationSummary = (metrics) => {
  const calibration = metrics?.scoreModelComparisons?.calibration;
  if (!calibration || typeof calibration !== "object") return null;
  const state = String(calibration.state || "");
  if (!SCORE_CALIBRATION_STATE_LABELS[state]) return null;
  const recommendedModelKey =
    typeof calibration.recommendedModelKey === "string"
      ? calibration.recommendedModelKey
      : null;
  const candidateModelKey =
    typeof calibration.candidateModelKey === "string"
      ? calibration.candidateModelKey
      : null;
  const modelKey = recommendedModelKey ?? candidateModelKey;
  const reasons = Array.isArray(calibration.reasons)
    ? calibration.reasons.filter((reason) => typeof reason === "string")
    : [];
  const reasonLabels = reasons.map(
    (reason) => SCORE_CALIBRATION_REASON_LABELS[reason] ?? reason,
  );
  const suffix =
    state === "calibrated" && modelKey
      ? formatScoreModelKey(modelKey)
      : reasonLabels.length
        ? reasonLabels.join(", ")
        : modelKey
          ? formatScoreModelKey(modelKey)
          : "";
  return {
    state,
    label: SCORE_CALIBRATION_STATE_LABELS[state],
    modelKey,
    supportedModelCount: Number.isFinite(calibration.supportedModelCount)
      ? calibration.supportedModelCount
      : 0,
    reasons,
    reasonLabels,
    text: suffix
      ? `${SCORE_CALIBRATION_STATE_LABELS[state]}: ${suffix}`
      : SCORE_CALIBRATION_STATE_LABELS[state],
    tone:
      state === "calibrated"
        ? CSS_COLOR.green
        : state === "uncalibrated"
          ? CSS_COLOR.red
          : CSS_COLOR.amber,
  };
};

const INDICATOR_KPI_PLACEHOLDER = "—";

const indicatorKpiPct = (value, digits) =>
  Number.isFinite(value) ? formatPct(value, digits) : INDICATOR_KPI_PLACEHOLDER;

const indicatorKpiMoveColor = (value) =>
  Number.isFinite(value) && value > 0
    ? CSS_COLOR.green
    : Number.isFinite(value) && value < 0
      ? CSS_COLOR.red
      : CSS_COLOR.text;

const indicatorKpiCorrectnessColor = (value) =>
  Number.isFinite(value) && value >= 50 ? CSS_COLOR.green : CSS_COLOR.textSec;

const indicatorKpiExcursionText = (row) =>
  Number.isFinite(row.avgMfePercent) || Number.isFinite(row.avgMaePercent)
    ? `${Number.isFinite(row.avgMfePercent) ? row.avgMfePercent.toFixed(1) : INDICATOR_KPI_PLACEHOLDER} / ${Number.isFinite(row.avgMaePercent) ? row.avgMaePercent.toFixed(1) : INDICATOR_KPI_PLACEHOLDER}`
    : INDICATOR_KPI_PLACEHOLDER;

const indicatorKpiCountText = (row) => {
  const count = Math.max(0, Number(row?.signalCount) || 0);
  return count.toLocaleString();
};

// The signal-quality KPIs as table columns (rows = All/Buy/Sell, then each score
// bucket nested underneath). Values come from the live buildSignalIndicatorMetrics
// output — same aggregates the previous metric table showed.
const INDICATOR_KPI_METRIC_COLUMNS = [
  {
    key: "signals",
    label: "Signals",
    render: (row) => ({
      text: indicatorKpiCountText(row),
      color: CSS_COLOR.textSec,
    }),
  },
  {
    key: "medianMove",
    label: "Median",
    render: (row) => ({
      text: indicatorKpiPct(row?.medianMovePercent, 2),
      color: indicatorKpiMoveColor(row?.medianMovePercent),
    }),
  },
  {
    key: "avgMove",
    label: "Avg Move",
    render: (row) => ({
      text: indicatorKpiPct(row?.avgMovePercent, 2),
      color: indicatorKpiMoveColor(row?.avgMovePercent),
    }),
  },
  {
    key: "correctness",
    label: "Correct",
    render: (row) => ({
      text: indicatorKpiPct(row?.correctnessPercent, 0),
      color: indicatorKpiCorrectnessColor(row?.correctnessPercent),
    }),
  },
  {
    key: "excursion",
    label: "Excursion",
    render: (row) => ({
      text: row ? indicatorKpiExcursionText(row) : INDICATOR_KPI_PLACEHOLDER,
      color: CSS_COLOR.textSec,
    }),
  },
];

const SCORE_BUCKET_BREAKDOWN_ROWS = [
  { key: "all", label: "All" },
  { key: "buy", label: "Buy" },
  { key: "sell", label: "Sell" },
];

const buildScoreBucketBreakdownRows = (buckets) =>
  SCORE_BUCKET_BREAKDOWN_ROWS.map((row) => ({
    ...row,
    buckets: (Array.isArray(buckets) ? buckets : []).map((bucket) => {
      const source =
        row.key === "all" ? bucket : bucket?.byDirection?.[row.key];
      return {
        key: bucket.key,
        label: bucket.label,
        tone: bucket.tone,
        min: bucket.min,
        max: bucket.max,
        ...pickIndicatorMetrics(source),
      };
    }),
  }));

export const buildScoreOutcomeGroupedTable = (
  metrics,
  { scoreDisplayThreshold = null } = {},
) => {
  const rows = buildIndicatorKpiTableRows(metrics);
  const scoreMatrix = buildScoreBucketAuditMatrix(metrics);
  // Range buckets carry a numeric `min`; the legacy high/standard/low shape does
  // not. Only apply the score-range filter when real range buckets are present,
  // so the legacy fallback keeps rendering in full.
  const hasRangeBuckets = scoreMatrix.buckets.some((bucket) =>
    Number.isFinite(Number(bucket.min)),
  );
  const threshold =
    scoreDisplayThreshold == null || !hasRangeBuckets
      ? null
      : normalizeScoreDisplayThreshold(scoreDisplayThreshold);
  const visibleBuckets =
    threshold == null
      ? scoreMatrix.buckets
      : scoreMatrix.buckets.filter(
          (bucket) => Number(bucket.min) >= threshold,
        );
  return {
    rows,
    scoreBuckets: visibleBuckets,
    bucketBreakdownRows: buildScoreBucketBreakdownRows(visibleBuckets),
    scoreSubcolumnCount: visibleBuckets.length,
  };
};

const indicatorKpiRowLabelTone = (key) =>
  key === "buy"
    ? toneForDirectionalIntent("buy")
    : key === "sell"
      ? toneForDirectionalIntent("sell")
      : CSS_COLOR.text;

// Indicator-signal KPIs as a compact table: score buckets are columns and
// All / Buy / Sell signal groups are rows. Values come from the live
// buildSignalIndicatorMetrics output (no fetch).
export const AlgoIndicatorKpiTable = ({
  metrics,
  algoIsPhone = false,
  algoIsPocketWidth = false,
  dense = false,
}) => {
  const [showAllScoreBuckets, setShowAllScoreBuckets] = React.useState(false);
  const groupedTable = buildScoreOutcomeGroupedTable(metrics, {
    scoreDisplayThreshold: showAllScoreBuckets
      ? null
      : DEFAULT_SCORE_DISPLAY_THRESHOLD,
  });
  const scoreCalibrationSummary = buildScoreCalibrationSummary(metrics);
  const hasSignals =
    groupedTable.rows.some((row) => row.signalCount > 0) ||
    groupedTable.bucketBreakdownRows.some((row) =>
      row.buckets.some((bucket) => bucket.signalCount > 0),
    );
  const compact = algoIsPhone && algoIsPocketWidth;
  const cellPad = sp(dense ? "2px 4px" : "3px 5px");
  const valueFontSize = fs(dense ? 9 : 10);
  const emptyScoreBucket = {
    key: "empty",
    label: INDICATOR_KPI_PLACEHOLDER,
    tone: CSS_COLOR.textMuted,
    signalCount: 0,
  };
  const scoreBreakdownRowsForRender = groupedTable.scoreBuckets.length
    ? groupedTable.bucketBreakdownRows
    : buildScoreBucketBreakdownRows([emptyScoreBucket]);
  const summaryRowByKey = new Map(
    groupedTable.rows.map((row) => [row.key, row]),
  );
  const bucketColumns = groupedTable.scoreBuckets.length
    ? groupedTable.scoreBuckets
    : [emptyScoreBucket];
  // Each KPI metric spans an "All" (all-scores aggregate) sub-column followed by
  // one sub-column per visible score bucket.
  const scoreSubColumns = [
    { key: "all", label: "All", aggregate: true },
    ...bucketColumns.map((bucket) => ({
      key: bucket.key,
      label: bucket.key === "empty" ? INDICATOR_KPI_PLACEHOLDER : bucket.label,
      tone: bucket.tone,
    })),
  ];
  const headCellStyle = {
    color: CSS_COLOR.textMuted,
    fontFamily: T.sans,
    fontSize: textSize("caption"),
    fontWeight: FONT_WEIGHTS.medium,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    textAlign: "right",
    padding: cellPad,
    whiteSpace: "nowrap",
  };
  const labelCellStyle = (tone) => ({
    color: tone,
    fontFamily: T.sans,
    fontSize: valueFontSize,
    fontWeight: FONT_WEIGHTS.label,
    textAlign: "left",
    padding: cellPad,
    whiteSpace: "nowrap",
    borderTop: `1px solid ${CSS_COLOR.borderLight}`,
  });
  const metricCellStyle = {
    color: CSS_COLOR.textSec,
    fontFamily: T.sans,
    fontSize: valueFontSize,
    fontWeight: 600,
    textAlign: "right",
    padding: cellPad,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    borderTop: `1px solid ${CSS_COLOR.borderLight}`,
    fontVariantNumeric: "tabular-nums",
  };
  return (
    <div
      data-testid="algo-indicator-kpi-table"
      style={{ minWidth: 0, overflowX: "auto" }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          padding: sp(dense ? "0 0 2px" : "0 0 3px"),
        }}
      >
        <button
          type="button"
          data-testid="algo-kpi-score-range-toggle"
          aria-pressed={showAllScoreBuckets}
          onClick={() => setShowAllScoreBuckets((value) => !value)}
          style={{
            appearance: "none",
            background: "transparent",
            border: `1px solid ${CSS_COLOR.border}`,
            borderRadius: dim(RADII.xs),
            color: CSS_COLOR.textMuted,
            cursor: "pointer",
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            fontWeight: FONT_WEIGHTS.medium,
            letterSpacing: "0.04em",
            lineHeight: 1.1,
            padding: sp("2px 6px"),
            textTransform: "uppercase",
            whiteSpace: "nowrap",
          }}
        >
          {showAllScoreBuckets ? "Show 60-100" : "Show all scores"}
        </button>
      </div>
      {scoreCalibrationSummary ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: sp(2),
            justifyContent: "flex-end",
            padding: sp(dense ? "0 0 3px" : "0 0 5px"),
          }}
        >
          <span
            data-testid="algo-score-calibration-summary"
            style={{
              color: scoreCalibrationSummary.tone,
              fontFamily: T.sans,
              fontSize: textSize("caption"),
              fontWeight: FONT_WEIGHTS.medium,
              letterSpacing: 0,
              lineHeight: 1.1,
              textTransform: "none",
              whiteSpace: compact ? "normal" : "nowrap",
            }}
          >
            {scoreCalibrationSummary.text}
          </span>
        </div>
      ) : null}
      <table
        data-testid="algo-indicator-kpi-metric-table"
        style={{
          borderCollapse: "collapse",
          marginTop: sp(dense ? 2 : 4),
          width: "100%",
        }}
      >
        <colgroup>
          <col style={{ width: dim(compact ? 46 : dense ? 54 : 62) }} />
          {INDICATOR_KPI_METRIC_COLUMNS.map((column) =>
            scoreSubColumns.map((sub) => (
              <col key={`${column.key}-${sub.key}`} />
            )),
          )}
        </colgroup>
        <thead>
          <tr>
            <th
              scope="col"
              rowSpan={2}
              style={{
                ...headCellStyle,
                borderBottom: `1px solid ${CSS_COLOR.borderLight}`,
                borderTop: `1px solid ${CSS_COLOR.border}`,
                textAlign: "left",
                verticalAlign: "bottom",
              }}
            >
              Signal
            </th>
            {INDICATOR_KPI_METRIC_COLUMNS.map((column, columnIndex) => (
              <th
                key={column.key}
                scope="colgroup"
                colSpan={scoreSubColumns.length}
                title={column.label}
                style={{
                  ...headCellStyle,
                  textAlign: "center",
                  borderTop: `1px solid ${CSS_COLOR.border}`,
                  borderBottom: `1px solid ${CSS_COLOR.borderLight}`,
                  borderLeft:
                    columnIndex > 0
                      ? `1px solid ${CSS_COLOR.border}`
                      : undefined,
                  padding: sp(dense ? "2px 3px" : "3px 4px"),
                }}
              >
                {column.label}
              </th>
            ))}
          </tr>
          <tr>
            {INDICATOR_KPI_METRIC_COLUMNS.map((column, columnIndex) =>
              scoreSubColumns.map((sub, subIndex) => (
                <th
                  key={`${column.key}-${sub.key}`}
                  scope="col"
                  title={`${column.label} · ${sub.label}`}
                  style={{
                    ...headCellStyle,
                    color: sub.aggregate
                      ? CSS_COLOR.textSec
                      : sub.tone || CSS_COLOR.textMuted,
                    borderBottom: `1px solid ${CSS_COLOR.borderLight}`,
                    borderLeft:
                      subIndex === 0 && columnIndex > 0
                        ? `1px solid ${CSS_COLOR.border}`
                        : undefined,
                    padding: sp(dense ? "1px 3px" : "2px 4px"),
                  }}
                >
                  {sub.label}
                </th>
              )),
            )}
          </tr>
        </thead>
        <tbody>
          {scoreBreakdownRowsForRender.map((row) => {
            const summaryRow = summaryRowByKey.get(row.key) ?? { key: row.key };
            const sourceBySubKey = new Map([
              ["all", summaryRow],
              ...row.buckets.map((bucket) => [bucket.key, bucket]),
            ]);
            return (
              <tr key={row.key} data-testid={`algo-kpi-row-${row.key}`}>
                <th
                  scope="row"
                  style={{
                    ...labelCellStyle(indicatorKpiRowLabelTone(row.key)),
                    padding: sp(dense ? "2px 3px" : "3px 4px"),
                  }}
                >
                  {row.label}
                </th>
                {INDICATOR_KPI_METRIC_COLUMNS.map((column, columnIndex) =>
                  scoreSubColumns.map((sub, subIndex) => {
                    const cell = column.render(sourceBySubKey.get(sub.key));
                    return (
                      <td
                        key={`${column.key}-${sub.key}`}
                        data-testid={`algo-kpi-cell-${row.key}-${column.key}-${sub.key}`}
                        style={{
                          ...metricCellStyle,
                          color: cell.color,
                          borderLeft:
                            subIndex === 0 && columnIndex > 0
                              ? `1px solid ${CSS_COLOR.border}`
                              : undefined,
                        }}
                      >
                        {cell.text}
                      </td>
                    );
                  }),
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {!hasSignals ? (
        <DataUnavailableState
          title="No signals yet"
          detail="Indicator KPIs populate once the Signal Options engine records scored signals."
        />
      ) : null}
    </div>
  );
};

export const algoPipelineTone = (status) => {
  if (status === "healthy") return CSS_COLOR.green;
  if (status === "running") return CSS_COLOR.cyan;
  if (status === "attention" || status === "stale") return CSS_COLOR.amber;
  if (status === "blocked") return CSS_COLOR.red;
  return CSS_COLOR.textDim;
};

const PIPELINE_LABEL_OVERRIDES = {
  scan_universe: "Universe",
  signal_detected: "Received",
  action_mapped: "Action",
  contract_selected: "Contract",
  liquidity_risk_gate: "Gate",
  order_shadow: "Orders",
  shadow_order: "Orders",
  position_managed: "Positions",
  exit_close: "Exits",
};

export const shortAlgoPipelineLabel = (stage, labelOverrides = null) =>
  labelOverrides?.[stage?.id] ||
  PIPELINE_LABEL_OVERRIDES[stage?.id] ||
  String(stage?.label || "Stage")
    .replace(/\bLiquidity\/Risk\b/i, "Risk")
    .replace(/\bSelected\b/i, "")
    .trim();

const PIPELINE_PHASES = [
  {
    id: "signal-cycle",
    label: "Signal Cycle",
    stageIds: ["scan_universe", "signal_detected"],
  },
  {
    id: "entry-path",
    label: "Entry Path",
    stageIds: ["action_mapped", "contract_selected", "liquidity_risk_gate"],
  },
  {
    id: "orders",
    label: "Orders",
    stageIds: ["order_shadow", "shadow_order"],
  },
  {
    id: "management",
    label: "Management",
    stageIds: ["position_managed", "exit_close"],
  },
];

const PIPELINE_PHASE_COUNT_STAGE_ID = {
  "signal-cycle": "signal_detected",
  "entry-path": "contract_selected",
  orders: "order_shadow",
  management: "position_managed",
};

const STAGE_PRIORITY = {
  blocked: 5,
  attention: 4,
  stale: 3,
  running: 2,
  healthy: 1,
};

const countLabel = (stage) => {
  const count = Number(stage?.count);
  return Number.isFinite(count) ? count.toLocaleString() : "0";
};

const pickPhaseStatus = (phaseStages) =>
  phaseStages.reduce((status, stage) => {
    const currentRank = STAGE_PRIORITY[status] || 0;
    const nextRank = STAGE_PRIORITY[stage?.status] || 0;
    return nextRank > currentRank ? stage.status : status;
  }, "healthy");

const pickPhaseStage = (phaseStages) =>
  phaseStages.find((stage) =>
    ["blocked", "attention", "stale", "running"].includes(stage?.status),
  ) ||
  phaseStages[phaseStages.length - 1] ||
  phaseStages[0];

export const buildAlgoPipelinePhases = (stages = []) => {
  const stageById = new Map((stages || []).map((stage) => [stage?.id, stage]));
  return PIPELINE_PHASES.map((phase) => {
    const phaseStages = phase.stageIds
      .map((id) => stageById.get(id))
      .filter(Boolean);
    if (!phaseStages.length) return null;
    const selectedStage = pickPhaseStage(phaseStages);
    const stageCounts = Object.fromEntries(
      phaseStages.map((stage) => [stage.id, countLabel(stage)]),
    );
    const countStage =
      stageById.get(PIPELINE_PHASE_COUNT_STAGE_ID[phase.id]) || selectedStage;
    const detail =
      phase.id === "signal-cycle"
        ? `${stageCounts.scan_universe || "0"} symbols -> ${stageCounts.signal_detected || "0"} STA rows`
        : phase.id === "entry-path"
          ? `${stageCounts.action_mapped || "0"} actions -> ${stageCounts.contract_selected || "0"} contracts`
          : phase.id === "orders"
            ? `${stageCounts.order_shadow || stageCounts.shadow_order || "0"} planned orders`
            : `${stageCounts.position_managed || "0"} positions -> ${stageCounts.exit_close || "0"} exits`;
    return {
      id: phase.id,
      label: phase.label,
      count: countLabel(countStage),
      detail,
      status: pickPhaseStatus(phaseStages),
      stageIds: phase.stageIds,
      selectStageId: selectedStage?.id,
    };
  }).filter(Boolean);
};

export const resolveAlgoPipelineGridTemplate = ({
  pocket = false,
  dense = false,
} = {}) => {
  if (pocket) {
    return "repeat(auto-fit, minmax(150px, 1fr))";
  }
  return dense
    ? "repeat(auto-fit, minmax(104px, max-content))"
    : "repeat(auto-fit, minmax(120px, max-content))";
};

export const AlgoPipelineOverview = ({
  stages,
  selectedStageId,
  onSelectStage,
  labelOverrides,
  pocket = false,
  dense = false,
  grouped = false,
}) => {
  if (!Array.isArray(stages) || stages.length === 0) return null;
  const visibleStages = grouped ? buildAlgoPipelinePhases(stages) : stages;
  return (
    <div
      data-testid="algo-operations-pipeline-strip"
      data-algo-pocket-grid={pocket ? "pipeline" : undefined}
      style={{
        display: "grid",
        gridTemplateColumns: resolveAlgoPipelineGridTemplate({
          pocket,
          dense,
        }),
        justifyContent: pocket ? undefined : "start",
        gap: sp(3),
        minWidth: 0,
      }}
    >
      {visibleStages.map((stage, index) => {
        const selected = grouped
          ? stage.stageIds?.includes(selectedStageId)
          : selectedStageId === stage.id;
        const tone = algoPipelineTone(stage.status);
        const nextStage = visibleStages[index + 1];
        const stageCount = Number(stage.count);
        const drop = nextStage ? stageCount - Number(nextStage.count) : 0;
        const leak =
          !grouped && Number.isFinite(drop) && drop > 0
            ? `-${drop.toLocaleString()}`
            : null;
        const countLabel = Number.isFinite(stageCount)
          ? stageCount.toLocaleString()
          : stage.count || "—";
        const alarmStatus =
          stage.status === "blocked" ||
          stage.status === "attention" ||
          stage.status === "stale";
        const failurePoint = alarmStatus
          ? buildPipelineStageFailurePoint({ stage, leak })
          : null;
        return (
          <button
            key={stage.id}
            type="button"
            onClick={() => onSelectStage?.(stage.selectStageId || stage.id)}
            data-testid={`algo-pipeline-stage-${stage.id}`}
            style={{
              display: "grid",
              gridTemplateColumns: grouped
                ? "minmax(0, 1fr)"
                : "minmax(0, 1fr) auto auto",
              alignItems: "center",
              gap: sp(grouped ? 1 : 4),
              minWidth: 0,
              minHeight: dim(grouped ? (dense ? 30 : 34) : dense ? 26 : 30),
              padding: sp(dense ? "3px 5px" : "4px 6px"),
              border: `1px solid ${selected ? tone : CSS_COLOR.border}`,
              borderRadius: dim(RADII.xs),
              background: selected ? cssColorAlpha(tone, "18") : CSS_COLOR.bg1,
              cursor: onSelectStage ? "pointer" : "default",
              textAlign: "left",
            }}
          >
            {grouped ? (
              <>
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: sp(4),
                    minWidth: 0,
                  }}
                >
                  <span
                    style={{
                      color: selected || alarmStatus ? tone : CSS_COLOR.textMuted,
                      fontFamily: T.sans,
                      fontSize: textSize("caption"),
                      lineHeight: 1.05,
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {stage.label}
                  </span>
                  <span
                    style={{
                      color: alarmStatus ? tone : CSS_COLOR.text,
                      fontFamily: T.sans,
                      fontSize: fs(11),
                      fontWeight: 600,
                      lineHeight: 1.05,
                      fontVariantNumeric: "tabular-nums",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {countLabel}
                  </span>
                  {failurePoint ? (
                    <FailurePointInlineIcon
                      point={failurePoint}
                      side="top"
                      align="center"
                      size={11}
                      focusable={false}
                    />
                  ) : null}
                </span>
                <span
                  style={{
                    color: CSS_COLOR.textDim,
                    fontFamily: T.sans,
                    fontSize: textSize("caption"),
                    lineHeight: 1.05,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {stage.detail}
                </span>
              </>
            ) : (
              <>
                <span
                  style={{
                    color: selected || alarmStatus ? tone : CSS_COLOR.textMuted,
                    fontFamily: T.sans,
                    fontSize: textSize("caption"),
                    lineHeight: 1.05,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {shortAlgoPipelineLabel(stage, labelOverrides)}
                </span>
                <span
                  style={{
                    color: alarmStatus ? tone : CSS_COLOR.text,
                    fontFamily: T.sans,
                    fontSize: fs(11),
                    fontWeight: 600,
                    lineHeight: 1.05,
                    fontVariantNumeric: "tabular-nums",
                    whiteSpace: "nowrap",
                  }}
                >
                  {countLabel}
                </span>
                {failurePoint ? (
                  <FailurePointInlineIcon
                    point={failurePoint}
                    side="top"
                    align="center"
                    size={11}
                    focusable={false}
                  />
                ) : null}
              </>
            )}
          </button>
        );
      })}
    </div>
  );
};
