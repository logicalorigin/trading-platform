import { T, dim, sp, textSize } from "../../lib/uiTokens.jsx";

const Swatch = ({ color, label }) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: sp(3),
      color: T.textDim,
      fontFamily: T.sans,
      fontSize: textSize("caption"),
    }}
  >
    <span
      aria-hidden="true"
      style={{
        width: dim(10),
        height: dim(10),
        background: color,
        border: `1px solid ${T.border}`,
        display: "inline-block",
      }}
    />
    {label}
  </span>
);

const GradientStrip = ({ from, via, to }) => (
  <span
    aria-hidden="true"
    style={{
      width: dim(48),
      height: dim(8),
      background: `linear-gradient(90deg, ${from} 0%, ${via} 50%, ${to} 100%)`,
      border: `1px solid ${T.border}`,
      display: "inline-block",
      borderRadius: dim(2),
    }}
  />
);

export const HeatmapColorLegend = () => (
  <div
    data-testid="gex-heatmap-color-legend"
    style={{
      display: "flex",
      flexWrap: "wrap",
      alignItems: "center",
      gap: sp(8),
      padding: sp("4px 8px"),
      borderTop: `1px dashed ${T.border}`,
    }}
  >
    <Swatch color={T.red} label="Put-heavy" />
    <Swatch color={T.bg2} label="Neutral" />
    <Swatch color={T.green} label="Call-heavy" />
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: sp(3),
        color: T.textDim,
        fontFamily: T.sans,
        fontSize: textSize("caption"),
      }}
    >
      Magnitude
      <GradientStrip from={`${T.red}33`} via={T.bg2} to={`${T.green}cc`} />
    </span>
  </div>
);

export default HeatmapColorLegend;
