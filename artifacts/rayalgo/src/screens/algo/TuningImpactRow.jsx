import {
  RADII,
  T,
  dim,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";

export const TuningImpactRow = ({
  label,
  inputElement,
  count,
  total,
  sampleSymbols = [],
  emptyHint,
  tone,
  warningWhenNonZero = true,
}) => {
  const hasImpact = Number(count) > 0;
  const impactTone = !hasImpact
    ? T.textDim
    : warningWhenNonZero
      ? tone || T.amber
      : tone || T.text;
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
        gridTemplateColumns: "minmax(170px, 0.9fr) minmax(120px, 0.6fr) minmax(0, 1.5fr)",
        gap: sp(8),
        alignItems: "center",
        padding: sp("6px 10px"),
        background: T.bg1,
        border: `1px solid ${T.border}`,
        borderRadius: dim(RADII.sm),
        minWidth: 0,
      }}
    >
      <span
        style={{
          color: T.text,
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
          <span style={{ color: T.textDim, marginLeft: sp(6) }}>
            · {sampleSymbols.join(", ")}
          </span>
        )}
      </span>
    </div>
  );
};

export default TuningImpactRow;
