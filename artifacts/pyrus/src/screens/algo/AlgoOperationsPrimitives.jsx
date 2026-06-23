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
import {
  buildAlgoMetricFailurePoint,
  buildPipelineStageFailurePoint,
} from "../../features/platform/failurePointModel.js";
import { formatPct } from "./algoHelpers";

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
          {failurePoint ? (
            <FailurePointInlineIcon
              point={failurePoint}
              side="top"
              align="start"
              size={dense ? 10 : 11}
            />
          ) : null}
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

// Indicator KPI table: directions as rows (All / Buy / Sell), KPIs as columns.
// Pure, side-effect-free row builder kept exported for unit tests. Reads straight
// from buildSignalIndicatorMetrics output (overall fields + byDirection.{buy,sell}).
export const buildIndicatorKpiTableRows = (metrics) => {
  const root = metrics && typeof metrics === "object" ? metrics : {};
  const byDirection =
    root.byDirection && typeof root.byDirection === "object"
      ? root.byDirection
      : {};
  const pick = (source) => {
    const value = source && typeof source === "object" ? source : {};
    return {
      signalCount: Number.isFinite(value.signalCount) ? value.signalCount : 0,
      medianMovePercent: value.medianDirectionalMovePercent,
      avgMovePercent: value.avgDirectionalMovePercent,
      correctnessPercent: value.correctnessPercent,
      expectancyPercent: value.expectancyPercent,
      avgMfePercent: value.avgMfePercent,
      avgMaePercent: value.avgMaePercent,
    };
  };
  return [
    { key: "all", label: "All", ...pick(root) },
    { key: "buy", label: "Buy", ...pick(byDirection.buy) },
    { key: "sell", label: "Sell", ...pick(byDirection.sell) },
  ];
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

const INDICATOR_KPI_COLUMNS = [
  {
    key: "signals",
    label: "Signals",
    render: (row) => ({
      text: row.signalCount.toLocaleString(),
      color: CSS_COLOR.textSec,
    }),
  },
  {
    key: "medianMove",
    label: "Median Move",
    render: (row) => ({
      text: indicatorKpiPct(row.medianMovePercent, 2),
      color: indicatorKpiMoveColor(row.medianMovePercent),
    }),
  },
  {
    key: "avgMove",
    label: "Avg Move",
    render: (row) => ({
      text: indicatorKpiPct(row.avgMovePercent, 2),
      color: indicatorKpiMoveColor(row.avgMovePercent),
    }),
  },
  {
    key: "correctness",
    label: "Correct",
    render: (row) => ({
      text: indicatorKpiPct(row.correctnessPercent, 0),
      color: indicatorKpiCorrectnessColor(row.correctnessPercent),
    }),
  },
  {
    key: "expectancy",
    label: "Expect",
    render: (row) => ({
      text: indicatorKpiPct(row.expectancyPercent, 2),
      color: indicatorKpiMoveColor(row.expectancyPercent),
    }),
  },
  {
    key: "excursion",
    label: "Excursion",
    render: (row) => ({
      text: indicatorKpiExcursionText(row),
      color: CSS_COLOR.textSec,
    }),
  },
];

const indicatorKpiRowLabelTone = (key) =>
  key === "buy"
    ? CSS_COLOR.green
    : key === "sell"
      ? CSS_COLOR.red
      : CSS_COLOR.text;

// Indicator-signal KPIs as a compact table: rows = All / Buy / Sell, columns =
// Signals + the four KPIs. Same dense-table aesthetic as the STA table; values
// come from the live buildSignalIndicatorMetrics output (no fetch).
export const AlgoIndicatorKpiTable = ({
  metrics,
  algoIsPhone = false,
  algoIsPocketWidth = false,
  dense = false,
}) => {
  const rows = buildIndicatorKpiTableRows(metrics);
  const hasSignals = rows.some((row) => row.signalCount > 0);
  const compact = algoIsPhone && algoIsPocketWidth;
  const cellPad = sp(dense ? "2px 5px" : "3px 6px");
  const valueFontSize = fs(dense ? 10 : 11);
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
  const dataCellStyle = (color) => ({
    color,
    fontFamily: T.sans,
    fontSize: valueFontSize,
    fontWeight: 600,
    textAlign: "right",
    padding: cellPad,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    borderTop: `1px solid ${CSS_COLOR.borderLight}`,
  });
  return (
    <div
      data-testid="algo-indicator-kpi-table"
      style={{ minWidth: 0, overflowX: compact ? "auto" : "visible" }}
    >
      <div
        role="table"
        style={{
          display: "grid",
          gridTemplateColumns: `minmax(${dim(38)}px, max-content) repeat(${INDICATOR_KPI_COLUMNS.length}, minmax(0, 1fr))`,
          alignItems: "center",
          minWidth: compact ? dim(360) : 0,
        }}
      >
        <span
          role="columnheader"
          style={{ ...headCellStyle, textAlign: "left" }}
        />
        {INDICATOR_KPI_COLUMNS.map((column) => (
          <span key={column.key} role="columnheader" style={headCellStyle}>
            {column.label}
          </span>
        ))}
        {rows.map((row) => (
          <React.Fragment key={row.key}>
            <span
              role="rowheader"
              style={labelCellStyle(indicatorKpiRowLabelTone(row.key))}
            >
              {row.label}
            </span>
            {INDICATOR_KPI_COLUMNS.map((column) => {
              const { text, color } = column.render(row);
              return (
                <span key={column.key} role="cell" style={dataCellStyle(color)}>
                  {text}
                </span>
              );
            })}
          </React.Fragment>
        ))}
      </div>
      {!hasSignals ? (
        <div
          style={{
            color: CSS_COLOR.textDim,
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            padding: cellPad,
          }}
        >
          No signals yet
        </div>
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
