import React from "react";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
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

// Resolve the glyph treatment for a single timeframe cell. Pure so the
// shape/color/state decision can be unit-tested without a DOM. Direction is
// carried by the glyph shape (up = buy, down = sell); color stays blue/red,
// and the existing freshness/attention/pending state cues are preserved.
export const resolveSignalDotGlyph = (state) => {
  const hydrationMeta = resolveSignalDotHydrationMeta(state);
  const direction = getCurrentSignalDirection(state);
  const hasDirection = isSignalDirection(direction);
  const attention = hydrationMeta.attention;
  const pending = hydrationMeta.pending;
  const fresh = hasDirection && Boolean(state?.fresh);
  const kind = hasDirection ? direction : "neutral";
  // Direction always drives the arrow color: buy = blue, sell = red, no signal
  // = muted. Staleness/attention is conveyed separately (dimming + an amber
  // accent dot) and never recolors the arrow, so a buy always reads blue.
  const tone =
    direction === "buy"
      ? CSS_COLOR.blue
      : direction === "sell"
        ? CSS_COLOR.red
        : cssColorMix(CSS_COLOR.textDim, 58);
  const opacity = pending ? 0.72 : hasDirection ? (fresh ? 1 : 0.76) : 0.88;
  return { kind, tone, attention, pending, fresh, opacity };
};

// Direction is carried by the arrow shape (lucide ArrowUp = buy, ArrowDown =
// sell — the straight arrows from the header signal-tape lane pills); a flat
// dash marks cells with no signal. The arrow renders larger than its 8px
// column slot and overflows into the inter-column gaps — `flexShrink: 0` on the
// icon (below) is required, otherwise the flex slot squishes the SVG back down
// to ~8px and the size has no effect. Sized via dim() so it tracks the UI
// scale. Attention (stale/unhydrated) shows as a small amber accent dot.
const SIGNAL_DOT_GLYPH_SIZE = 14;
const SIGNAL_DOT_GLYPH_STROKE = 2.5;

const SignalDotGlyph = ({ kind, tone, fresh, attention }) => {
  const Icon = kind === "buy" ? ArrowUp : kind === "sell" ? ArrowDown : Minus;
  return (
    <span
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        lineHeight: 0,
      }}
    >
      <Icon
        size={dim(SIGNAL_DOT_GLYPH_SIZE)}
        strokeWidth={SIGNAL_DOT_GLYPH_STROKE}
        color={tone}
        aria-hidden="true"
        style={{
          display: "block",
          flexShrink: 0,
          filter: fresh
            ? `drop-shadow(0 0 1.4px ${cssColorMix(tone, 45)})`
            : "none",
        }}
      />
      {attention ? (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            width: dim(3),
            height: dim(3),
            borderRadius: "50%",
            background: CSS_COLOR.amber,
          }}
        />
      ) : null}
    </span>
  );
};

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
      const glyph = resolveSignalDotGlyph(state);
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
        boxShadow: "none",
        cursor: hasDirection && onSelect ? "pointer" : "default",
        padding: showLabels ? sp("0 3px") : 0,
      };

      // Glyph mode (the only mode any consumer uses): the wrapper is just a
      // transparent, centered slot that holds the SVG glyph and keeps the
      // click/tooltip/animation behaviour. The pill `dotStyle` above is kept
      // for the unused showLabels path.
      const glyphWrapperStyle = {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        boxSizing: "border-box",
        width: dim(8),
        height: dim(8),
        minWidth: dim(8),
        border: "none",
        background: "transparent",
        color: glyph.tone,
        opacity: glyph.opacity,
        cursor: hasDirection && onSelect ? "pointer" : "default",
        padding: 0,
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
        style: showLabels ? dotStyle : glyphWrapperStyle,
      };

      const glyphChild = showLabels ? (
        timeframe
      ) : (
        <SignalDotGlyph
          kind={glyph.kind}
          tone={glyph.tone}
          fresh={glyph.fresh}
          attention={glyph.attention}
        />
      );

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
              {glyphChild}
            </button>
          ) : (
            <span {...triggerProps}>{glyphChild}</span>
          )}
        </AppTooltip>
      );
    })}
  </span>
);

export default SignalDots;
