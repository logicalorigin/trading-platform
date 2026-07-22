import React from "react";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { AppTooltip } from "@/components/ui/tooltip";
import { CSS_COLOR, cssColorMix, dim, FONT_WEIGHTS, fs, sp, T } from "../../../lib/uiTokens.jsx";
import {
  getCurrentSignalDirection,
  normalizeSignalDirection,
  normalizeSignalStatus,
} from "../../../features/signals/signalStateFreshness.js";
import { signalBarsSinceTokens } from "../../../lib/formatters";
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
  // "stale" is reserved for MISSING signals — a lane that stopped producing the
  // bars it should (backend status="stale"). A present-but-old signal is "aged",
  // NOT stale: it keeps its directional (blue=buy / red=sell) arrow, only dimmed
  // by opacity, and is never recolored amber (amber = stale/missing only).
  const stale = status === "stale";
  const aged = !stale && Boolean(storedDirection && record.fresh === false);
  const unhydrated = Boolean(
    !hasState ||
      record.active === false ||
      NON_HYDRATED_SIGNAL_DOT_STATUSES.has(status) ||
      !hasSignalDotHydrationMarker(record),
  );
  const hydrationState = unhydrated
    ? "unhydrated"
    : stale
      ? "stale"
      : aged
        ? "aged"
        : "hydrated";
  return {
    status,
    pending,
    stale,
    aged,
    unhydrated,
    // Aged is a normal dimmed directional arrow, NOT an attention state — only
    // unhydrated / stale (missing) draw the amber attention treatment.
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
  // Any directional cell whose signal is not currently fresh — stale ("should
  // have updated but didn't"), aged (status ok but fresh=false), or idle with a
  // latched direction — recolors the WHOLE arrow amber in its last-known
  // direction and drops the separate accent dot. `hydrationMeta.stale` is
  // exactly that "directional + not-fresh" attention condition, so the amber
  // arrow now appears wherever the staleness dot used to. Only non-directional
  // attention (pending / unhydrated dashes) keeps a dot.
  const staleDirectional = hasDirection && hydrationMeta.stale;
  // Direction otherwise drives the arrow color: buy = blue, sell = red, no
  // signal = muted. Non-stale attention (pending/unhydrated) is conveyed
  // separately by an amber accent dot and never recolors the arrow.
  const tone = staleDirectional
    ? CSS_COLOR.amber
    : direction === "buy"
      ? CSS_COLOR.blue
      : direction === "sell"
        ? CSS_COLOR.red
        : cssColorMix(CSS_COLOR.textDim, 58);
  const opacity = pending ? 0.72 : hasDirection ? (fresh ? 1 : 0.76) : 0.88;
  return { kind, tone, attention, pending, fresh, opacity, staleDirectional };
};

// Direction is carried by the arrow shape (lucide ArrowUp = buy, ArrowDown =
// sell — the straight arrows from the header signal-tape lane pills); a flat
// dash marks cells with no signal. The arrow renders larger than its 8px
// column slot and overflows into the inter-column gaps — `flexShrink: 0` on the
// icon (below) is required, otherwise the flex slot squishes the SVG back down
// to ~8px and the size has no effect. Sized via dim() so it tracks the UI
// scale. Stale directional cells render the whole arrow amber (no dot);
// non-stale attention (pending/unhydrated) shows a small amber accent dot.
const SIGNAL_DOT_GLYPH_SIZE = 16;
const SIGNAL_DOT_GLYPH_STROKE = 2.5;

const SignalDotGlyph = ({ kind, tone, fresh, attention, staleDirectional }) => {
  const Icon = kind === "buy" ? ArrowUp : kind === "sell" ? ArrowDown : Minus;
  // Stale directional cells already read the whole arrow in amber, so the
  // separate amber accent dot would be redundant — drop it. Non-stale
  // attention (pending/unhydrated neutral markers) still shows the dot.
  const showAttentionDot = attention && !staleDirectional;
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
      {showAttentionDot ? (
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

const SignalDotsComponent = ({
  statesByTimeframe = {},
  onSelect,
  timeframes = SIGNAL_TIMEFRAMES,
  showLabels = false,
  testId = "watchlist-signal-dots",
  interactiveTargetSize = 24,
  style = null,
}) => {
  const resolvedInteractiveTargetSize =
    Number.isFinite(interactiveTargetSize) && interactiveTargetSize >= 24
      ? interactiveTargetSize
      : 24;

  return (
    <span
    data-testid={testId}
    style={{
      display: "inline-flex",
      alignItems: showLabels ? "flex-start" : "center",
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
      const fresh = Boolean(state?.fresh);
      // Bars-since only exists for a discrete crossover; a trend-derived arrow has
      // none, so signalBarsSinceTokens omits it and surfaces the time-since instead.
      const label = pending
        ? `${timeframe} pending`
        : hasDirection
          ? [
              `${timeframe} ${direction.toUpperCase()} ${fresh ? "fresh" : "aged"}`,
              ...signalBarsSinceTokens(state),
            ].join(" · ")
          : `${timeframe} no signal - ${status}`;
      const attentionLabel = hydrationMeta.unhydrated
        ? "unhydrated"
        : hydrationMeta.stale
          ? "stale"
          : "";
      const glyph = resolveSignalDotGlyph(state);
      const interactive = Boolean(onSelect && hasDirection);
      const glyphWrapperStyle = {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        boxSizing: "border-box",
        width: dim(interactive ? resolvedInteractiveTargetSize : 8),
        height: dim(interactive ? resolvedInteractiveTargetSize : 8),
        minWidth: dim(interactive ? resolvedInteractiveTargetSize : 8),
        minHeight: dim(interactive ? resolvedInteractiveTargetSize : 8),
        border: "none",
        background: "transparent",
        color: glyph.tone,
        opacity: glyph.opacity,
        cursor: hasDirection && onSelect ? "pointer" : "default",
        padding: 0,
      };
      const labelledWrapperStyle = {
        ...glyphWrapperStyle,
        flexDirection: "column",
        width: dim(interactive ? resolvedInteractiveTargetSize : 14),
        minWidth: dim(interactive ? resolvedInteractiveTargetSize : 14),
        height: dim(interactive ? resolvedInteractiveTargetSize : 24),
        minHeight: dim(interactive ? resolvedInteractiveTargetSize : 24),
        gap: 0,
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
        role: interactive ? undefined : "img",
        style: showLabels ? labelledWrapperStyle : glyphWrapperStyle,
      };

      const glyphChild = (
        <>
          <span
            aria-hidden="true"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "100%",
              height: showLabels ? dim(16) : "100%",
              minHeight: 0,
            }}
          >
            <SignalDotGlyph
              kind={glyph.kind}
              tone={glyph.tone}
              fresh={glyph.fresh}
              attention={glyph.attention}
              staleDirectional={glyph.staleDirectional}
            />
          </span>
          {showLabels ? (
            <span
              data-testid={`watchlist-signal-dot-${timeframe}-label`}
              aria-hidden="true"
              style={{
                color: CSS_COLOR.textMuted,
                fontFamily: T.sans,
                fontSize: fs(7),
                fontWeight: FONT_WEIGHTS.medium,
                fontVariantNumeric: "tabular-nums",
                lineHeight: 1,
                letterSpacing: 0,
              }}
            >
              {timeframe}
            </span>
          ) : null}
        </>
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
          {interactive ? (
            <button
              type="button"
              {...triggerProps}
              onClick={(event) => {
                event.stopPropagation();
                onSelect(state);
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
};

export const SignalDots = React.memo(SignalDotsComponent);

export default SignalDots;
