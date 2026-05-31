import React from "react";
import { AppTooltip } from "@/components/ui/tooltip";
import {
  FONT_WEIGHTS,
  MISSING_VALUE,
  RADII,
  T,
  dim,
  fs,
  sp,
} from "../../../lib/uiTokens.jsx";
import { SIGNAL_TIMEFRAMES } from "./thresholds.js";

const CSS_COLOR = {
  blue: "var(--ra-blue-500)",
  red: "var(--ra-red-500)",
  borderLight: "var(--ra-border-light)",
  textDim: "var(--ra-text-dim)",
  textMuted: "var(--ra-text-muted)",
};

const cssColorMix = (color, percent) =>
  `color-mix(in srgb, ${color} ${percent}%, transparent)`;

const isSignalDirection = (value) => value === "buy" || value === "sell";

export const SignalDots = ({
  statesByTimeframe = {},
  onSelect,
  timeframes = SIGNAL_TIMEFRAMES,
  showLabels = false,
  testId = "watchlist-signal-dots",
  style = null,
}) => (
  <span
    data-testid={testId}
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: sp(3),
      minWidth: dim(34),
      ...style,
    }}
  >
    {timeframes.map((timeframe) => {
      const state = statesByTimeframe?.[timeframe];
      const direction = String(state?.currentSignalDirection || "").toLowerCase();
      const hasDirection = isSignalDirection(direction);
      const pending = !state;
      const color =
        direction === "buy"
          ? CSS_COLOR.blue
          : direction === "sell"
            ? CSS_COLOR.red
            : CSS_COLOR.textMuted;
      const fresh = Boolean(state?.fresh);
      const status = state?.status || "unknown";
      const label = pending
        ? `${timeframe} pending`
        : hasDirection
          ? `${timeframe} ${direction.toUpperCase()} ${fresh ? "fresh" : "stale"} - ${state?.barsSinceSignal ?? MISSING_VALUE} bars`
          : `${timeframe} no signal - ${status}`;
      const dotStyle = {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: showLabels ? "auto" : dim(8),
        minWidth: showLabels ? dim(18) : dim(8),
        height: showLabels ? dim(14) : dim(8),
        borderRadius: showLabels ? dim(RADII.pill) : "50%",
        border: showLabels
          ? `1px solid ${
              hasDirection ? cssColorMix(color, 50) : CSS_COLOR.borderLight
            }`
          : `1px solid ${hasDirection ? color : cssColorMix(CSS_COLOR.textDim, 58)}`,
        background: hasDirection
          ? showLabels
            ? cssColorMix(color, 10)
            : color
          : showLabels
            ? "transparent"
            : cssColorMix(CSS_COLOR.textDim, 10),
        color: hasDirection ? color : CSS_COLOR.textMuted,
        fontFamily: T.sans,
        fontSize: fs(7),
        fontWeight: FONT_WEIGHTS.medium,
        lineHeight: 1,
        letterSpacing: 0,
        opacity: pending ? 0.72 : hasDirection ? (fresh ? 1 : 0.76) : 0.88,
        boxShadow:
          hasDirection && fresh && !showLabels
            ? `0 0 0 2px ${cssColorMix(color, 13)}`
            : "none",
        cursor: hasDirection && onSelect ? "pointer" : "default",
        padding: showLabels ? sp("0 3px") : 0,
      };

      const triggerProps = {
        "data-testid": `watchlist-signal-dot-${timeframe}`,
        "data-timeframe": timeframe,
        "data-direction": pending ? "pending" : hasDirection ? direction : "none",
        className: [
          "ra-signal-dot",
          hasDirection ? "ra-signal-dot-active" : null,
          hasDirection && fresh ? "ra-signal-dot-fresh" : null,
          pending ? "ra-signal-dot-pending" : null,
        ]
          .filter(Boolean)
          .join(" "),
        "aria-label": label,
        style: dotStyle,
      };

      return (
        <AppTooltip
          key={timeframe}
          content={state?.lastError ? `${label} - ${state.lastError}` : label}
        >
          {onSelect ? (
            <button
              type="button"
              {...triggerProps}
              onClick={(event) => {
                event.stopPropagation();
                if (hasDirection) {
                  onSelect(state);
                }
              }}
            >
              {showLabels ? timeframe : null}
            </button>
          ) : (
            <span {...triggerProps}>{showLabels ? timeframe : null}</span>
          )}
        </AppTooltip>
      );
    })}
  </span>
);

export default SignalDots;
