import { CSS_COLOR, cssColorMix, RADII, T, dim, sp, textSize } from "../../lib/uiTokens.jsx";
import { toneForDirectionalIntent } from "../platform/semanticToneModel.js";

// Mirror the heatmap's directional tones (GexScreen GEX_BULLISH_TONE/GEX_BEARISH_TONE)
// so the legend encodes the same tones cellColor() paints: call-heavy = bullish (blue),
// put-heavy = bearish (red). Green is reserved for financial-gain/operational-health.
const CALL_HEAVY_TONE = toneForDirectionalIntent("bullish");
const PUT_HEAVY_TONE = toneForDirectionalIntent("bearish");

const Swatch = ({ color, label }) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: sp(3),
      color: CSS_COLOR.textDim,
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
        border: `1px solid ${CSS_COLOR.border}`,
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
      border: `1px solid ${CSS_COLOR.border}`,
      display: "inline-block",
      borderRadius: dim(RADII.xs),
    }}
  />
);

export const HeatmapColorLegend = ({ compact = false }) => (
  <div
    data-testid="gex-heatmap-color-legend"
    style={{
      display: "flex",
      flexWrap: "wrap",
      alignItems: "center",
      gap: compact ? sp(6) : sp(8),
      padding: compact ? 0 : sp("4px 8px"),
      borderTop: compact ? "none" : `1px dashed ${CSS_COLOR.border}`,
    }}
  >
    <Swatch color={PUT_HEAVY_TONE} label="Put-heavy" />
    {compact ? null : <Swatch color={CSS_COLOR.bg2} label="Neutral" />}
    <Swatch color={CALL_HEAVY_TONE} label="Call-heavy" />
    {compact ? null : (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: sp(3),
          color: CSS_COLOR.textDim,
          fontFamily: T.sans,
          fontSize: textSize("caption"),
        }}
      >
        Magnitude
        <GradientStrip from={`${cssColorMix(PUT_HEAVY_TONE, 20)}`} via={CSS_COLOR.bg2} to={`${cssColorMix(CALL_HEAVY_TONE, 80)}`} />
      </span>
    )}
  </div>
);

export default HeatmapColorLegend;
