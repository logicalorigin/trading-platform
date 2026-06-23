import { AppTooltip } from "@/components/ui/tooltip";
import {
  CSS_COLOR,
  FONT_WEIGHTS,
  RADII,
  T,
  cssColorMix,
  dim,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import {
  ALGO_TIMEFRAME_OPTIONS,
  buildAlgoExecutionTimeframePatch,
  buildAlgoMtfTimeframeTogglePatch,
  normalizeAlgoAlignedMtfTimeframes,
  normalizeAlgoExecutionTimeframe,
  normalizeAlgoMtfRequiredCount,
} from "./algoTimeframeControls";

const arraysEqual = (left, right) =>
  left.length === right.length && left.every((item, index) => item === right[index]);

const controlLabelStyle = {
  color: CSS_COLOR.textMuted,
  fontFamily: T.data,
  fontSize: textSize("micro"),
  fontWeight: FONT_WEIGHTS.label,
  letterSpacing: 0,
  lineHeight: 1,
  minWidth: dim(34),
};

const frameButtonStyle = ({ selected, dirty, disabled }) => ({
  height: dim(26),
  width: "100%",
  minWidth: 0,
  boxSizing: "border-box",
  border: `1px solid ${
    selected
      ? dirty
        ? CSS_COLOR.amber
        : CSS_COLOR.accent
      : CSS_COLOR.border
  }`,
  borderRadius: RADII.xs,
  background: selected
    ? cssColorMix(dirty ? CSS_COLOR.amber : CSS_COLOR.accent, 15)
    : CSS_COLOR.bg1,
  color: selected ? CSS_COLOR.text : CSS_COLOR.textSec,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: T.data,
  fontSize: textSize("caption"),
  fontWeight: selected ? FONT_WEIGHTS.emphasis : FONT_WEIGHTS.label,
  lineHeight: 1,
  cursor: disabled ? "not-allowed" : "pointer",
  padding: sp("0 4px"),
  opacity: disabled ? 0.58 : 1,
  overflow: "hidden",
  textOverflow: "clip",
  whiteSpace: "nowrap",
});

const TimeframeButton = ({
  timeframe,
  selected,
  dirty,
  disabled,
  ariaLabel,
  testId,
  onClick,
}) => (
  <AppTooltip content={ariaLabel}>
    <button
      type="button"
      data-testid={testId}
      aria-label={ariaLabel}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      style={frameButtonStyle({ selected, dirty, disabled })}
    >
      {timeframe}
    </button>
  </AppTooltip>
);

const TimeframeRow = ({ label, children }) => (
  <div
    data-algo-timeframe-row={label.toLowerCase()}
    style={{
      display: "grid",
      gridTemplateColumns: "38px minmax(0, 1fr)",
      alignItems: "center",
      gap: sp(6),
      minWidth: 0,
    }}
  >
    <span style={controlLabelStyle}>{label}</span>
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${ALGO_TIMEFRAME_OPTIONS.length}, minmax(0, 1fr))`,
        gap: sp(3),
        minWidth: 0,
        width: "100%",
      }}
    >
      {children}
    </div>
  </div>
);

export const AlgoTimeframeControlBand = ({
  profileDraft,
  profileBaseline,
  strategySettingsDraft,
  strategyBaseline,
  patchProfileDraftPath,
  patchStrategySettingsPath,
  disabled = false,
}) => {
  const executionTimeframe = normalizeAlgoExecutionTimeframe(
    strategySettingsDraft?.signalTimeframe,
  );
  const baselineExecutionTimeframe = normalizeAlgoExecutionTimeframe(
    strategyBaseline?.signalTimeframe,
    executionTimeframe,
  );
  const mtfAlignment = profileDraft?.entryGate?.mtfAlignment || {};
  const baselineMtfAlignment = profileBaseline?.entryGate?.mtfAlignment || {};
  const mtfTimeframes = normalizeAlgoAlignedMtfTimeframes(
    mtfAlignment.timeframes,
    executionTimeframe,
  );
  const baselineMtfTimeframes = normalizeAlgoAlignedMtfTimeframes(
    baselineMtfAlignment.timeframes,
    baselineExecutionTimeframe,
    mtfTimeframes,
  );
  const mtfRequiredCount = normalizeAlgoMtfRequiredCount(
    mtfAlignment.requiredCount,
    mtfTimeframes,
  );
  const baselineMtfRequiredCount = normalizeAlgoMtfRequiredCount(
    baselineMtfAlignment.requiredCount,
    baselineMtfTimeframes,
    mtfRequiredCount,
  );
  const executionDirty = executionTimeframe !== baselineExecutionTimeframe;
  const mtfDirty =
    !arraysEqual(mtfTimeframes, baselineMtfTimeframes) ||
    mtfRequiredCount !== baselineMtfRequiredCount;
  const dirty = executionDirty || mtfDirty;
  const statusColor = dirty ? CSS_COLOR.amber : CSS_COLOR.textMuted;

  const patchExecutionTimeframe = (timeframe) => {
    if (disabled) return;
    const patch = buildAlgoExecutionTimeframePatch(
      timeframe,
      executionTimeframe,
      mtfTimeframes,
      mtfRequiredCount,
    );
    patchStrategySettingsPath?.("signalTimeframe", patch.signalTimeframe);
    if (patch.timeframes) {
      patchProfileDraftPath?.("entryGate.mtfAlignment.timeframes", patch.timeframes);
      patchProfileDraftPath?.("entryGate.mtfAlignment.preset", patch.preset);
      patchProfileDraftPath?.(
        "entryGate.mtfAlignment.requiredCount",
        patch.requiredCount,
      );
    }
  };

  const patchMtfTimeframe = (timeframe) => {
    if (disabled) return;
    const patch = buildAlgoMtfTimeframeTogglePatch({
      selectedTimeframes: mtfTimeframes,
      timeframe,
      executionTimeframe,
      requiredCount: mtfRequiredCount,
    });
    patchProfileDraftPath?.("entryGate.mtfAlignment.timeframes", patch.timeframes);
    patchProfileDraftPath?.("entryGate.mtfAlignment.preset", patch.preset);
    patchProfileDraftPath?.(
      "entryGate.mtfAlignment.requiredCount",
      patch.requiredCount,
    );
  };

  return (
    <section
      data-testid="algo-timeframe-control-band"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: sp(7),
        padding: `${sp(9)}px ${sp(10)}px`,
        background: CSS_COLOR.bg2,
        borderBottom: `1px solid ${CSS_COLOR.border}`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: sp(8),
          minWidth: 0,
        }}
      >
        <span
          style={{
            color: CSS_COLOR.textSec,
            fontFamily: T.data,
            fontSize: textSize("label"),
            fontWeight: FONT_WEIGHTS.label,
            lineHeight: 1,
          }}
        >
          SIGNAL FRAMES
        </span>
        <span
          data-testid="algo-timeframe-control-summary"
          style={{
            color: statusColor,
            border: `1px solid ${cssColorMix(statusColor, dirty ? 42 : 28)}`,
            borderRadius: RADII.xs,
            padding: `${sp(2)}px ${sp(5)}px`,
            fontFamily: T.data,
            fontSize: textSize("label"),
            fontWeight: FONT_WEIGHTS.emphasis,
            lineHeight: 1,
            whiteSpace: "nowrap",
          }}
        >
          {executionTimeframe} | {mtfRequiredCount}/{mtfTimeframes.length}
        </span>
      </div>
      <TimeframeRow label="EXEC">
        {ALGO_TIMEFRAME_OPTIONS.map((timeframe) => (
          <TimeframeButton
            key={`execution-${timeframe}`}
            timeframe={timeframe}
            selected={executionTimeframe === timeframe}
            dirty={executionDirty}
            disabled={disabled}
            ariaLabel={`Set execution frame to ${timeframe}`}
            testId={`algo-timeframe-execution-${timeframe}`}
            onClick={() => patchExecutionTimeframe(timeframe)}
          />
        ))}
      </TimeframeRow>
      <TimeframeRow label="MTF">
        {ALGO_TIMEFRAME_OPTIONS.map((timeframe) => {
          const selected = mtfTimeframes.includes(timeframe);
          const locked = selected && timeframe === executionTimeframe;
          return (
            <TimeframeButton
              key={`mtf-${timeframe}`}
              timeframe={timeframe}
              selected={selected}
              dirty={mtfDirty}
              disabled={disabled || locked}
              ariaLabel={
                locked
                  ? `${timeframe} is the execution frame and stays selected`
                  : `${selected ? "Remove" : "Add"} ${timeframe} MTF frame`
              }
              testId={`algo-timeframe-mtf-${timeframe}`}
              onClick={() => patchMtfTimeframe(timeframe)}
            />
          );
        })}
      </TimeframeRow>
    </section>
  );
};

export default AlgoTimeframeControlBand;
