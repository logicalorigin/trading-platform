import React from "react";
import { AppTooltip } from "@/components/ui/tooltip";
import { CSS_COLOR, cssColorMix, dim, FONT_WEIGHTS, fs, MISSING_VALUE, RADII, sp, T } from "../../../lib/uiTokens.jsx";
import {
  getCurrentSignalDirection,
  normalizeSignalDirection,
  normalizeSignalStatus,
} from "../../../features/signals/signalStateFreshness.js";
import { SIGNAL_TIMEFRAMES } from "./thresholds.js";

const NON_HYDRATED_SIGNAL_DOT_STATUSES = new Set(["pending", "unknown"]);

const asRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const hasSignalDotHydrationMarker = (state) =>
  Boolean(
    state.latestBarAt ||
      state.currentSignalAt ||
      state.lastEvaluatedAt ||
      state.lastError,
  );

export const resolveSignalDotHydrationMeta = (state) => {
  const record = asRecord(state);
  const hasState = Object.keys(record).length > 0;
  const status = hasState ? normalizeSignalStatus(record) : "unknown";
  const pending = !hasState || status === "pending";
  const storedDirection = normalizeSignalDirection(record.currentSignalDirection);
  const stale =
    status === "stale" ||
    Boolean(storedDirection && record.fresh === false);
  const unhydrated = Boolean(
    !hasState ||
      record.active === false ||
      NON_HYDRATED_SIGNAL_DOT_STATUSES.has(status) ||
      !hasSignalDotHydrationMarker(record),
  );
  const hydrationState = unhydrated ? "unhydrated" : stale ? "stale" : "hydrated";
  return {
    status,
    pending,
    stale,
    unhydrated,
    attention: unhydrated || stale,
    hydrationState,
  };
};

const isSignalDirection = (value) => value === "buy" || value === "sell";

const formatSignalDotAttentionLabel = (value) =>
  value === "unhydrated" ? "needs hydration" : value;

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
      minWidth: dim(52),
      ...style,
    }}
  >
    {timeframes.map((timeframe) => {
      const state = statesByTimeframe?.[timeframe];
      const hydrationMeta = resolveSignalDotHydrationMeta(state);
      const status = hydrationMeta.status;
      const direction = getCurrentSignalDirection(state);
      const hasDirection = isSignalDirection(direction);
      const pending = hydrationMeta.pending;
      const color =
        direction === "buy"
          ? CSS_COLOR.blue
          : direction === "sell"
            ? CSS_COLOR.red
            : CSS_COLOR.textMuted;
      const fresh = Boolean(state?.fresh);
      const label = pending
        ? `${timeframe} pending`
        : hasDirection
          ? `${timeframe} ${direction.toUpperCase()} ${
              fresh ? "fresh" : "aged"
            } - ${state?.barsSinceSignal ?? MISSING_VALUE} bars`
          : `${timeframe} no signal - ${status}`;
      const attentionLabel = hydrationMeta.unhydrated
        ? "unhydrated"
        : hydrationMeta.stale
          ? "stale"
          : "";
      const freshGlow =
        hasDirection && fresh && !showLabels
          ? `0 0 0 2px ${cssColorMix(color, 13)}`
          : null;
      const dotBorder = hydrationMeta.attention
        ? `2px solid ${CSS_COLOR.amber}`
        : showLabels
          ? `1px solid ${
              hasDirection ? cssColorMix(color, 50) : CSS_COLOR.borderLight
            }`
          : `1px solid ${hasDirection ? color : cssColorMix(CSS_COLOR.textDim, 58)}`;
      const dotStyle = {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        boxSizing: "border-box",
        width: showLabels ? "auto" : dim(8),
        minWidth: showLabels ? dim(18) : dim(8),
        height: showLabels ? dim(14) : dim(8),
        borderRadius: showLabels ? dim(RADII.pill) : "50%",
        border: dotBorder,
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
        boxShadow: freshGlow || "none",
        cursor: hasDirection && onSelect ? "pointer" : "default",
        padding: showLabels ? sp("0 3px") : 0,
      };

      const triggerProps = {
        "data-testid": `watchlist-signal-dot-${timeframe}`,
        "data-timeframe": timeframe,
        "data-direction": pending ? "pending" : hasDirection ? direction : "none",
        "data-hydration-state": hydrationMeta.hydrationState,
        "data-signal-attention": hydrationMeta.attention ? attentionLabel : undefined,
        className: [
          "ra-signal-dot",
          hasDirection ? "ra-signal-dot-active" : null,
          hasDirection && fresh ? "ra-signal-dot-fresh" : null,
          pending ? "ra-signal-dot-pending" : null,
          hydrationMeta.attention ? "ra-signal-dot-attention" : null,
          hydrationMeta.stale ? "ra-signal-dot-stale" : null,
          hydrationMeta.unhydrated ? "ra-signal-dot-unhydrated" : null,
        ]
          .filter(Boolean)
          .join(" "),
        "aria-label": attentionLabel ? `${label} - ${attentionLabel}` : label,
        style: dotStyle,
      };

      return (
        <AppTooltip
          key={timeframe}
          content={[
            label,
            attentionLabel ? formatSignalDotAttentionLabel(attentionLabel) : null,
            state?.lastError || null,
          ]
            .filter(Boolean)
            .join(" - ")}
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
