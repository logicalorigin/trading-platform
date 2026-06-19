import React from "react";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import {
  CSS_COLOR,
  cssColorMix,
  dim,
  FONT_WEIGHTS,
  fs,
  sp,
  T,
} from "../../../lib/uiTokens.jsx";

// Renders an MTF pattern's per-timeframe direction vector, e.g.
// "1m:sell|2m:sell|5m:sell|15m:buy", as a row of colored arrow cells. The
// SHAPE of the color run encodes confluence vs divergence pre-attentively
// (all-blue = confluence; three red + one blue = the "fade the fast TFs"
// divergence). Colors match the live SignalDots MTF matrix exactly
// (SignalDots.jsx:68-76): buy = blue, sell = red, none = muted, so a pattern
// reads the same here as in the watchlist/algo signal dots.

const NONE_TONE = cssColorMix(CSS_COLOR.textDim, 58);

const directionTone = (direction) =>
  direction === "buy"
    ? CSS_COLOR.blue
    : direction === "sell"
      ? CSS_COLOR.red
      : NONE_TONE;

// Net forward call (long/short/neutral): the same blue=bullish / red=bearish
// language, shown as a left rail so the call is unambiguous even on a mixed
// (divergent) vector.
const biasTone = (bias) =>
  bias === "long"
    ? CSS_COLOR.blue
    : bias === "short"
      ? CSS_COLOR.red
      : NONE_TONE;

const parsePatternKey = (patternKey) =>
  String(patternKey || "")
    .split("|")
    .filter(Boolean)
    .map((part) => {
      const [timeframe, direction] = part.split(":");
      return {
        timeframe,
        direction:
          direction === "buy" || direction === "sell" ? direction : "none",
      };
    });

const DirectionGlyph = ({ direction }) => {
  const Icon =
    direction === "buy" ? ArrowUp : direction === "sell" ? ArrowDown : Minus;
  return (
    <Icon
      size={dim(16)}
      strokeWidth={2.5}
      color={directionTone(direction)}
      aria-hidden="true"
      style={{ display: "block", flexShrink: 0 }}
    />
  );
};

export const PatternVector = ({
  patternKey,
  bias = null,
  showLabels = false,
  style = null,
}) => {
  const cells = parsePatternKey(patternKey);
  return (
    <span
      role="img"
      aria-label={String(patternKey || "")}
      style={{
        display: "inline-flex",
        alignItems: "stretch",
        gap: sp(3),
        ...(bias
          ? { paddingLeft: sp(4), borderLeft: `3px solid ${biasTone(bias)}` }
          : null),
        ...style,
      }}
    >
      {cells.map((cell, index) => (
        <span
          key={`${cell.timeframe}-${index}`}
          style={{
            display: "inline-flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: showLabels ? sp(1) : 0,
            minWidth: dim(16),
          }}
        >
          {showLabels ? (
            <span
              style={{
                fontFamily: T.sans,
                fontSize: fs(7),
                fontWeight: FONT_WEIGHTS.medium,
                color: CSS_COLOR.textMuted,
                lineHeight: 1,
              }}
            >
              {cell.timeframe}
            </span>
          ) : null}
          <DirectionGlyph direction={cell.direction} />
        </span>
      ))}
    </span>
  );
};

export default PatternVector;
