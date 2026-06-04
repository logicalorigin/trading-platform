import React from "react";
import { AppTooltip } from "@/components/ui/tooltip";
import { MISSING_VALUE, cssColorAlpha, dim } from "../../../lib/uiTokens.jsx";
import { freshnessTooltip } from "./tooltips.js";
import { getTone } from "./tones.js";

const clampRatio = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
};

export const directionGlyphTone = (direction, tone) => {
  if (tone) return tone;
  if (direction === "buy") return getTone("buy");
  if (direction === "sell") return getTone("sell");
  return getTone("dim");
};

export const BigDirectionGlyph = ({
  direction = null,
  freshnessRatio = 0,
  freshnessBars,
  tone = null,
  size = 22,
  className,
  style,
  title,
}) => {
  const normalizedDirection =
    direction === "buy" || direction === "sell" ? direction : null;
  const color = directionGlyphTone(normalizedDirection, tone);
  const numericSize = Number(size) || 22;
  const center = numericSize / 2;
  const radius = Math.max(1, center - 1.25);
  const circumference = 2 * Math.PI * radius;
  const freshness = clampRatio(freshnessRatio);
  const freshnessLabel =
    freshnessBars != null
      ? freshnessTooltip({ barsSince: freshnessBars })
      : freshness > 0
        ? "Fresh signal."
        : "Freshness unavailable.";
  const label =
    title ||
    `${normalizedDirection ? normalizedDirection.toUpperCase() : MISSING_VALUE} signal. ${freshnessLabel}`;
  const trianglePath =
    normalizedDirection === "sell"
      ? `M ${center} ${numericSize * 0.78} L ${numericSize * 0.8} ${numericSize * 0.28} L ${numericSize * 0.2} ${numericSize * 0.28} Z`
      : `M ${center} ${numericSize * 0.22} L ${numericSize * 0.8} ${numericSize * 0.72} L ${numericSize * 0.2} ${numericSize * 0.72} Z`;

  return (
    <AppTooltip content={label}>
      <span
        className={className}
        aria-label={label}
        style={{
          display: "inline-grid",
          placeItems: "center",
          width: dim(numericSize),
          height: dim(numericSize),
          flex: `0 0 ${dim(numericSize)}`,
          color,
          ...style,
        }}
      >
        <svg
          width={numericSize}
          height={numericSize}
          viewBox={`0 0 ${numericSize} ${numericSize}`}
          aria-hidden="true"
          focusable="false"
          style={{ display: "block", overflow: "visible" }}
        >
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill={cssColorAlpha(color, "12")}
            stroke={cssColorAlpha(color, "66")}
            strokeWidth="1.5"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - freshness)}
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 260ms ease" }}
          />
          {normalizedDirection ? (
            <path d={trianglePath} fill={color} />
          ) : (
            <line
              x1={numericSize * 0.32}
              y1={center}
              x2={numericSize * 0.68}
              y2={center}
              stroke={color}
              strokeWidth="2"
              strokeLinecap="round"
            />
          )}
        </svg>
      </span>
    </AppTooltip>
  );
};

export default BigDirectionGlyph;
