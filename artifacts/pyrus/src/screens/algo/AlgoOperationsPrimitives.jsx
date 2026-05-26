import React from "react";
import { CSS_COLOR, RADII, T, cssColorAlpha, dim, fs, sp, textSize } from "../../lib/uiTokens.jsx";

const overviewSeverityBackground = (severity) => {
  if (severity === "critical") return CSS_COLOR.redBg;
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
}) => {
  const iconTone =
    severity === "critical"
      ? CSS_COLOR.red
      : severity === "warning"
        ? CSS_COLOR.amber
        : tone || CSS_COLOR.textSec;
  return (
    <div
      title={`${label}: ${value}${detail ? ` · ${detail}` : ""}`}
      style={{
        display: "grid",
        gridTemplateColumns: Icon
          ? `${dim(18)}px minmax(0, 1fr)`
          : "minmax(0, 1fr)",
        alignItems: "center",
        gap: sp(6),
        minWidth: 0,
        minHeight: dim(42),
        padding: sp("6px 8px"),
        borderRadius: dim(RADII.xs),
        background: overviewSeverityBackground(severity),
      }}
    >
      {Icon ? (
        <Icon
          size={14}
          strokeWidth={1.8}
          aria-hidden="true"
          style={{ color: iconTone }}
        />
      ) : null}
      <div style={{ minWidth: 0, display: "grid", gap: sp(1) }}>
        <span
          style={{
            color: CSS_COLOR.textMuted,
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
        <span
          style={{
            color: tone || CSS_COLOR.text,
            fontFamily: T.sans,
            fontSize: fs(12),
            fontWeight: 600,
            lineHeight: 1.15,
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
};

export const algoPipelineTone = (status) => {
  if (status === "healthy") return CSS_COLOR.green;
  if (status === "running") return CSS_COLOR.cyan;
  if (status === "attention" || status === "stale") return CSS_COLOR.amber;
  if (status === "blocked") return CSS_COLOR.red;
  return CSS_COLOR.textDim;
};

const PIPELINE_LABEL_OVERRIDES = {
  scan_universe: "Signal Symbols",
  signal_detected: "Signals",
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

export const AlgoPipelineOverview = ({
  stages,
  selectedStageId,
  onSelectStage,
  labelOverrides,
  pocket = false,
  dense = false,
}) => {
  if (!Array.isArray(stages) || stages.length === 0) return null;
  return (
    <div
      data-testid="algo-operations-pipeline-strip"
      style={{
        display: "grid",
        gridTemplateColumns: pocket
          ? "repeat(2, minmax(0, 1fr))"
          : dense
            ? "repeat(auto-fit, minmax(86px, 1fr))"
            : "repeat(auto-fit, minmax(96px, 1fr))",
        gap: sp(4),
        minWidth: 0,
      }}
    >
      {stages.map((stage, index) => {
        const selected = selectedStageId === stage.id;
        const tone = algoPipelineTone(stage.status);
        const nextStage = stages[index + 1];
        const stageCount = Number(stage.count);
        const drop = nextStage ? stageCount - Number(nextStage.count) : 0;
        const leak =
          Number.isFinite(drop) && drop > 0 ? `-${drop.toLocaleString()}` : null;
        const countLabel = Number.isFinite(stageCount)
          ? stageCount.toLocaleString()
          : "—";
        const alarmStatus =
          stage.status === "blocked" ||
          stage.status === "attention" ||
          stage.status === "stale";
        return (
          <button
            key={stage.id}
            type="button"
            onClick={() => onSelectStage?.(stage.id)}
            data-testid={`algo-pipeline-stage-${stage.id}`}
            title={`${stage.label}: ${countLabel}${leak ? ` · ${leak} to next` : ""}`}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) auto",
              alignItems: "center",
              gap: sp(5),
              minWidth: 0,
              minHeight: dim(dense ? 30 : 34),
              padding: sp(dense ? "5px 7px" : "6px 8px"),
              border: `1px solid ${selected ? tone : CSS_COLOR.border}`,
              borderRadius: dim(RADII.xs),
              background: selected ? cssColorAlpha(tone, "18") : CSS_COLOR.bg1,
              cursor: onSelectStage ? "pointer" : "default",
              textAlign: "left",
            }}
          >
            <span
              style={{
                color: selected || alarmStatus ? tone : CSS_COLOR.textMuted,
                fontFamily: T.sans,
                fontSize: textSize("caption"),
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
                fontSize: fs(12),
                fontWeight: 600,
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap",
              }}
            >
              {countLabel}
            </span>
          </button>
        );
      })}
    </div>
  );
};
