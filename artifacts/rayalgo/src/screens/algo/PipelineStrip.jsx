import {
  CheckCircle2,
  CircleDashed,
  Filter,
  Radar,
  ShieldCheck,
  SlidersHorizontal,
  Target,
} from "lucide-react";
import { T, dim, fs, sp } from "../../lib/uiTokens.jsx";
import { formatEnumLabel } from "../../lib/formatters";

const stageColor = (status) => {
  if (status === "healthy") return T.green;
  if (status === "running") return T.cyan;
  if (status === "attention" || status === "stale") return T.amber;
  if (status === "blocked") return T.red;
  return T.textDim;
};

const STAGE_ICONS = {
  scan: Radar,
  signal: Radar,
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
            fontSize: fs(7),
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
        border: `1px solid ${selected ? color : T.border}`,
        borderRadius: dim(8),
        background: selected
          ? `${color}14`
          : `linear-gradient(180deg, ${T.bg2} 0%, ${T.bg1} 100%)`,
        cursor: "pointer",
        transition: "all 0.18s",
      }}
    >
      <div
        style={{
          width: dim(narrow ? 26 : 32),
          height: dim(narrow ? 26 : 32),
          borderRadius: "50%",
          background: alarmStatus ? `${color}24` : `${color}14`,
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
            color: T.textSec,
            fontFamily: T.sans,
            fontSize: fs(7),
            letterSpacing: "0.08em",
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
              color: alarmStatus ? color : T.text,
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
                fontSize: fs(7),
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
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: sp(6),
        }}
      >
        {stages.map((stage) => (
          <StageNode
            key={stage.id}
            stage={stage}
            selected={selectedStageId === stage.id}
            onSelect={onSelectStage}
            narrow
          />
        ))}
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
