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

const isSignalDirection = (value) => value === "buy" || value === "sell";

const getFallbackSignalForTimeframe = (fallbackState, timeframe) => {
  if (!fallbackState) return null;
  const fallbackTimeframe = String(fallbackState.timeframe || "5m").trim();
  if (fallbackTimeframe !== timeframe) return null;
  return fallbackState;
};

export const SignalDots = ({
  statesByTimeframe = {},
  fallbackState = null,
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
      const state =
        statesByTimeframe?.[timeframe] ||
        getFallbackSignalForTimeframe(fallbackState, timeframe);
      const direction = String(state?.currentSignalDirection || "").toLowerCase();
      const hasDirection = isSignalDirection(direction);
      const color =
        direction === "buy" ? T.blue : direction === "sell" ? T.red : T.textMuted;
      const fresh = Boolean(state?.fresh);
      const status = state?.status || "unknown";
      const label = hasDirection
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
          ? `1px solid ${hasDirection ? `${color}80` : T.borderLight}`
          : `1px solid ${hasDirection ? color : `${T.textDim}95`}`,
        background: hasDirection
          ? showLabels
            ? `${color}18`
            : color
          : showLabels
            ? "transparent"
            : `${T.textDim}18`,
        color: hasDirection ? color : T.textMuted,
        fontFamily: T.sans,
        fontSize: fs(7),
        fontWeight: FONT_WEIGHTS.medium,
        lineHeight: 1,
        letterSpacing: 0,
        opacity: hasDirection ? (fresh ? 1 : 0.76) : 0.88,
        boxShadow:
          hasDirection && fresh && !showLabels
            ? `0 0 0 2px ${color}20`
            : "none",
        cursor: hasDirection && onSelect ? "pointer" : "default",
        padding: showLabels ? sp("0 3px") : 0,
      };

      const triggerProps = {
        "data-testid": `watchlist-signal-dot-${timeframe}`,
        "data-timeframe": timeframe,
        "data-direction": hasDirection ? direction : "none",
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
