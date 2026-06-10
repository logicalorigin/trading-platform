import React from "react";
import { CSS_COLOR, RADII, T, cssColorAlpha, dim, fs, sp, textSize } from "../../lib/uiTokens.jsx";
import {
  FailurePointInlineIcon,
  FailurePointTooltip,
} from "../../components/platform/FailurePointTooltip.jsx";
import {
  buildAlgoMetricFailurePoint,
  buildPipelineStageFailurePoint,
} from "../../features/platform/failurePointModel.js";

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
        gap: sp(dense ? 3 : 4),
        minWidth: 0,
        minHeight: dim(dense ? 30 : 34),
        padding: sp(dense ? "3px 5px" : "4px 6px"),
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
    const detail =
      phase.id === "signal-cycle"
        ? `${stageCounts.scan_universe || "0"} symbols -> ${stageCounts.signal_detected || "0"} received`
        : phase.id === "entry-path"
          ? `${stageCounts.action_mapped || "0"} actions -> ${stageCounts.contract_selected || "0"} contracts`
          : phase.id === "orders"
            ? `${stageCounts.order_shadow || stageCounts.shadow_order || "0"} planned orders`
            : `${stageCounts.position_managed || "0"} positions -> ${stageCounts.exit_close || "0"} exits`;
    return {
      id: phase.id,
      label: phase.label,
      count: countLabel(selectedStage),
      detail,
      status: pickPhaseStatus(phaseStages),
      stageIds: phase.stageIds,
      selectStageId: selectedStage?.id,
    };
  }).filter(Boolean);
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
        gridTemplateColumns: pocket
          ? "repeat(auto-fit, minmax(150px, 1fr))"
          : dense
            ? "repeat(auto-fit, minmax(108px, 1fr))"
            : "repeat(auto-fit, minmax(132px, 1fr))",
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
              minHeight: dim(grouped ? (dense ? 32 : 36) : dense ? 28 : 32),
              padding: sp(
                grouped
                  ? dense
                    ? "4px 6px"
                    : "5px 7px"
                  : dense
                    ? "4px 6px"
                    : "5px 7px",
              ),
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
