import {
  CSS_COLOR,
  RADII,
  T,
  dim,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { ThresholdHistogram } from "../../components/platform/primitives.jsx";

export const TuningImpactRow = ({
  label,
  inputElement,
  count,
  total,
  sampleSymbols = [],
  emptyHint,
  tone,
  warningWhenNonZero = true,
  histogram,
}) => {
  const hasImpact = Number(count) > 0;
  const impactTone = !hasImpact
    ? CSS_COLOR.textDim
    : warningWhenNonZero
      ? tone || CSS_COLOR.amber
      : tone || CSS_COLOR.text;
  const impactSummary = hasImpact
    ? total != null
      ? `${count} / ${total}`
      : `${count}`
    : emptyHint || "no impact";
  return (
    <div
      data-testid={`algo-tuning-impact-${String(label).toLowerCase().replace(/\s+/g, "-")}`}
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(150px, 0.9fr) minmax(110px, 0.5fr) minmax(0, 1.4fr)",
        gap: sp(6),
        alignItems: "center",
        padding: sp("4px 8px"),
        background: CSS_COLOR.bg1,
        border: `1px solid ${CSS_COLOR.border}`,
        borderRadius: dim(RADII.sm),
        minWidth: 0,
      }}
    >
      <span
        style={{
          color: CSS_COLOR.text,
          fontFamily: T.sans,
          fontSize: textSize("body"),
          fontWeight: 500,
          letterSpacing: "0.01em",
        }}
      >
        {label}
      </span>
      <div style={{ display: "flex", alignItems: "center", minWidth: 0 }}>
        {inputElement}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: sp(1),
          minWidth: 0,
        }}
      >
        {histogram?.buckets?.length ? (
          <ThresholdHistogram
            buckets={histogram.buckets}
            thresholdPosition={histogram.thresholdPosition}
            width={96}
            height={16}
          />
        ) : null}
        <span
          style={{
            color: impactTone,
            fontFamily: T.sans,
            fontSize: textSize("body"),
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {impactSummary}
          {sampleSymbols.length > 0 && (
            <span style={{ color: CSS_COLOR.textDim, marginLeft: sp(6) }}>
              · {sampleSymbols.join(", ")}
            </span>
          )}
        </span>
      </div>
    </div>
  );
};

export default TuningImpactRow;
