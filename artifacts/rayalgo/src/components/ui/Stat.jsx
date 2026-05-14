import { T, dim, sp, textSize } from "../../lib/uiTokens.jsx";

const SIZES = {
  sm: { label: "caption", value: "paragraphMuted", pad: "2px 0", gap: 2 },
  md: { label: "caption", value: "paragraph", pad: "3px 0", gap: 3 },
  lg: { label: "paragraphMuted", value: "displaySmall", pad: "4px 0", gap: 4 },
  hero: { label: "paragraphMuted", value: "displayLarge", pad: "4px 0", gap: 5 },
};

/**
 * Stat — the canonical "label + value (+ delta)" cell.
 * Borderless by default; sits on the parent surface. Use inside a `<Card>` grid.
 *
 * Props:
 *   label    string                 small uppercase mono-ish label above value
 *   value    string|number|node     the headline value
 *   detail   string|node            optional muted detail/sublabel below value
 *   tone     hex                    optional value tint (gain/loss/warn)
 *   align    "left"|"right"|"center"
 *   size     "sm"|"md"|"lg"|"hero"
 */
export const Stat = ({
  label,
  value,
  detail,
  tone,
  align = "left",
  size = "md",
  dataTestId,
  style,
}) => {
  const dims = SIZES[size] || SIZES.md;
  const valueColor = tone || T.text;
  const justify =
    align === "right"
      ? "flex-end"
      : align === "center"
        ? "center"
        : "flex-start";
  return (
    <div
      data-testid={dataTestId}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: justify,
        gap: sp(dims.gap),
        padding: sp(dims.pad),
        minWidth: 0,
        ...style,
      }}
    >
      {label ? (
        <div
          style={{
            color: T.textMuted,
            fontFamily: T.sans,
            fontSize: textSize(dims.label),
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            fontWeight: 500,
            lineHeight: 1.2,
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </div>
      ) : null}
      <div
        style={{
          color: valueColor,
          fontFamily: T.sans,
          fontSize: textSize(dims.value),
          fontVariantNumeric: "tabular-nums",
          fontWeight:
            size === "hero" || size === "lg" ? 600 : 500,
          letterSpacing: size === "hero" ? "-0.02em" : "-0.01em",
          lineHeight: 1.1,
          textAlign: align,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          maxWidth: "100%",
        }}
      >
        {value}
      </div>
      {detail ? (
        <div
          style={{
            color: T.textDim,
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            lineHeight: 1.3,
            letterSpacing: "0.01em",
            textAlign: align,
            maxWidth: "100%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {detail}
        </div>
      ) : null}
    </div>
  );
};
