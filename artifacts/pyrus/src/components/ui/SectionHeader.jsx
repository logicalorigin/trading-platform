import { T, sp, textSize } from "../../lib/uiTokens.jsx";

const CSS_COLOR = {
  text: "var(--ra-text-primary)",
  textDim: "var(--ra-text-dim)",
};

/**
 * SectionHeader — the canonical in-card section title.
 * For top-of-card titles use CardTitle; for sub-section titles inside a card use this.
 */
export const SectionHeader = ({
  title,
  subtitle,
  right,
  size = "md",
  spacing = "md",
  dataTestId,
}) => {
  const titleSize =
    size === "lg"
      ? "displayMedium"
      : size === "sm"
        ? "paragraph"
        : "displaySmall";
  const titleWeight = size === "sm" ? 500 : 600;
  const titleTrack = size === "sm" ? "0em" : "-0.01em";
  const marginBottom =
    spacing === "none" ? 0 : spacing === "lg" ? sp(14) : sp(8);

  return (
    <div
      data-testid={dataTestId}
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: sp(10),
        marginBottom,
        minWidth: 0,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            color: CSS_COLOR.text,
            fontFamily: T.sans,
            fontSize: textSize(titleSize),
            fontWeight: titleWeight,
            letterSpacing: titleTrack,
            lineHeight: 1.2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </div>
        {subtitle ? (
          <div
            style={{
              marginTop: sp(2),
              color: CSS_COLOR.textDim,
              fontFamily: T.sans,
              fontSize: textSize("caption"),
              lineHeight: 1.35,
            }}
          >
            {subtitle}
          </div>
        ) : null}
      </div>
      {right ? <div style={{ flexShrink: 0 }}>{right}</div> : null}
    </div>
  );
};
