import {
  CheckCircle2,
  CircleDashed,
  Filter,
  ScanLine,
  ShieldCheck,
  SlidersHorizontal,
  Target,
} from "lucide-react";
import { CSS_COLOR, RADII, T, cssColorAlpha, dim, fs, sp, textSize } from "../../lib/uiTokens.jsx";
import { formatEnumLabel } from "../../lib/formatters";

const stageColor = (status) => {
  if (status === "healthy") return CSS_COLOR.green;
  if (status === "running") return CSS_COLOR.cyan;
  if (status === "attention" || status === "stale") return CSS_COLOR.amber;
  if (status === "blocked") return CSS_COLOR.red;
  return CSS_COLOR.textDim;
};

const STAGE_ICONS = {
  scan: ScanLine,
  signal: ScanLine,
  gate: ShieldCheck,
  contract: Filter,
  chain: Filter,
  mark: Target,
  pricing: SlidersHorizontal,
  stage: SlidersHorizontal,
  shadow: CheckCircle2,
  fire: CheckCircle2,
  exit: CheckCircle2,
};

const resolveIcon = (stage) => {
  const idKey = String(stage?.id || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  if (idKey && STAGE_ICONS[idKey]) return STAGE_ICONS[idKey];
  const labelKey = String(stage?.label || "")
    .toLowerCase()
    .split(/\s+/)[0]
    ?.replace(/[^a-z]/g, "");
  if (labelKey && STAGE_ICONS[labelKey]) return STAGE_ICONS[labelKey];
  return CircleDashed;
};

const Arrow = ({ tone, leak, narrow }) => {
  return (
    <div
      aria-hidden="true"
      style={{
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: sp(2),
        minWidth: dim(narrow ? 24 : 32),
        color: tone,
      }}
    >
      <div
        style={{
          height: 1,
          background: tone,
          width: "100%",
          opacity: 0.6,
        }}
      />
      {leak ? (
        <div
          style={{
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            color: tone,
            letterSpacing: "0.04em",
            whiteSpace: "nowrap",
          }}
        >
          {leak}
        </div>
      ) : null}
    </div>
  );
};

const StageNode = ({ stage, selected, onSelect, narrow }) => {
  const color = stageColor(stage.status);
  const Icon = resolveIcon(stage);
  const alarmStatus =
    stage.status === "blocked" ||
    stage.status === "attention" ||
    stage.status === "stale";
  return (
    <button
      type="button"
      onClick={() => onSelect?.(stage.id)}
      data-testid={`algo-pipeline-stage-${stage.id}`}
      style={{
        flexShrink: 0,
        flexGrow: 1,
        textAlign: "left",
        display: "grid",
        gridTemplateColumns: "auto minmax(0, 1fr)",
        alignItems: "center",
        gap: sp(7),
        padding: sp(narrow ? "8px 9px" : "10px 12px"),
        minWidth: dim(narrow ? 110 : 132),
        border: `1px solid ${selected ? color : CSS_COLOR.border}`,
        borderRadius: dim(RADII.md),
        background: selected
          ? cssColorAlpha(color, "28")
          : `linear-gradient(180deg, ${CSS_COLOR.bg2} 0%, ${CSS_COLOR.bg1} 100%)`,
        cursor: "pointer",
        transition: "all 0.18s",
      }}
    >
      <div
        style={{
          width: dim(narrow ? 26 : 32),
          height: dim(narrow ? 26 : 32),
          borderRadius: dim(RADII.pill),
          background: alarmStatus ? cssColorAlpha(color, "24") : cssColorAlpha(color, "14"),
          color,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Icon size={narrow ? 12 : 14} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            color: CSS_COLOR.textSec,
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {stage.label}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: sp(5),
            minWidth: 0,
          }}
        >
          <span
            style={{
              color: alarmStatus ? color : CSS_COLOR.text,
              fontFamily: T.sans,
              fontSize: fs(narrow ? 14 : 16),
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1.1,
            }}
          >
            {stage.count}
          </span>
          {alarmStatus ? (
            <span
              style={{
                color,
                fontFamily: T.sans,
                fontSize: textSize("caption"),
                letterSpacing: "0.04em",
                textTransform: "uppercase",
              }}
            >
              {formatEnumLabel(stage.status)}
            </span>
          ) : null}
        </div>
      </div>
    </button>
  );
};

export const PipelineStrip = ({
  stages,
  selectedStageId,
  onSelectStage,
  narrow = false,
}) => {
  if (!Array.isArray(stages) || stages.length === 0) {
    return null;
  }
  if (narrow) {
    return (
      <div
        data-testid="algo-pipeline-strip"
        className="ra-hide-scrollbar"
        style={{
          display: "flex",
          alignItems: "stretch",
          gap: 0,
          overflowX: "auto",
          border: `1px solid ${CSS_COLOR.border}`,
          borderRadius: dim(RADII.sm),
          background: CSS_COLOR.bg1,
        }}
      >
        {stages.map((stage, index) => {
          const color = stageColor(stage.status);
          const Icon = resolveIcon(stage);
          const selected = selectedStageId === stage.id;
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
              style={{
                flex: "0 0 auto",
                display: "inline-flex",
                alignItems: "center",
                gap: sp(4),
                padding: sp("6px 9px"),
                border: "none",
                borderLeft: index === 0 ? "none" : `1px solid ${CSS_COLOR.border}`,
                background: selected ? cssColorAlpha(color, "28") : "transparent",
                color: alarmStatus ? color : CSS_COLOR.textSec,
                cursor: "pointer",
                fontFamily: T.sans,
                fontSize: fs(11),
                lineHeight: 1.1,
                whiteSpace: "nowrap",
              }}
            >
              <Icon size={11} color={color} />
              <span
                style={{
                  color: CSS_COLOR.textMuted,
                  fontSize: textSize("caption"),
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                }}
              >
                {stage.label}
              </span>
              <span
                style={{
                  color: alarmStatus ? color : CSS_COLOR.text,
                  fontVariantNumeric: "tabular-nums",
                  fontWeight: 600,
                }}
              >
                {stage.count}
              </span>
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <div
      data-testid="algo-pipeline-strip"
      style={{
        display: "flex",
        alignItems: "stretch",
        gap: sp(2),
        overflowX: "auto",
        scrollbarWidth: "none",
        msOverflowStyle: "none",
        paddingBottom: sp(4),
      }}
    >
      {stages.map((stage, index) => {
        const nextStage = stages[index + 1];
        let leak = null;
        if (nextStage) {
          const drop = Number(stage.count) - Number(nextStage.count);
          if (Number.isFinite(drop) && drop > 0) {
            leak = `−${drop}`;
          }
        }
        const arrowTone = stageColor(stage.status);
        return (
          <div
            key={stage.id}
            style={{
              display: "flex",
              alignItems: "stretch",
              minWidth: 0,
              flexGrow: 1,
            }}
          >
            <StageNode
              stage={stage}
              selected={selectedStageId === stage.id}
              onSelect={onSelectStage}
            />
            {nextStage ? <Arrow tone={arrowTone} leak={leak} /> : null}
          </div>
        );
      })}
    </div>
  );
};
