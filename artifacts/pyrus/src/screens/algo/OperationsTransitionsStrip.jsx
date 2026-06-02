import React from "react";
import {
  Clock,
} from "lucide-react";
import {
  CSS_COLOR,
  RADII,
  T,
  dim,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { formatEnumLabel } from "../../lib/formatters";

const formatHms = (timeMs) => {
  if (!timeMs) return "";
  const date = new Date(timeMs);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
};

const transitionLabel = (transition) => {
  if (transition?.kind === "signal") {
    const symbol = transition.symbol || "?";
    return `${symbol} signal → ${transition.nextState}`;
  }
  if (transition?.kind === "event") {
    const eventType = formatEnumLabel(transition.eventType || "event");
    return transition.symbol
      ? `${transition.symbol} ${eventType}`
      : eventType;
  }
  return "—";
};

const transitionTone = (transition) => {
  if (transition?.kind === "signal") {
    if (transition.nextState === "fresh") return CSS_COLOR.green;
    if (transition.nextState === "stale") return CSS_COLOR.amber;
    if (transition.nextState === "unavailable") return CSS_COLOR.textDim;
    if (transition.nextState === "error") return CSS_COLOR.red;
    return CSS_COLOR.text;
  }
  if (transition?.eventType?.endsWith("_blocked")) return CSS_COLOR.amber;
  if (transition?.eventType?.endsWith("_skipped")) return CSS_COLOR.textDim;
  if (transition?.eventType?.endsWith("_entry")) return CSS_COLOR.green;
  if (transition?.eventType?.endsWith("_exit")) return CSS_COLOR.cyan;
  return CSS_COLOR.text;
};

export const OperationsTransitionsStrip = ({
  transitions = [],
  maxInline = 5,
  embedded = false,
  showEmptyState = true,
}) => {
  const visible = transitions.slice(0, maxInline);
  if (!visible.length && !showEmptyState) return null;
  return (
    <div
      data-testid="algo-operations-transitions-strip"
      style={{
        display: "flex",
        alignItems: "center",
        gap: sp(embedded ? 4 : 6),
        flexWrap: "wrap",
        rowGap: sp(2),
        background: embedded ? "transparent" : CSS_COLOR.bg1,
        border: embedded ? "none" : `1px solid ${CSS_COLOR.border}`,
        borderRadius: embedded ? 0 : dim(RADII.md),
        padding: embedded ? sp("2px 6px") : sp("6px 10px"),
        minWidth: 0,
        minHeight: embedded ? dim(24) : "auto",
      }}
    >
      <span
        style={{
          color: CSS_COLOR.textMuted,
          fontFamily: T.sans,
          fontSize: textSize("caption"),
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          flex: "0 0 auto",
        }}
      >
        Last 60s
      </span>
      {visible.length === 0 ? (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: sp(3),
            color: CSS_COLOR.textDim,
            fontFamily: T.sans,
            fontSize: embedded ? textSize("caption") : textSize("body"),
            fontStyle: "italic",
          }}
        >
          <Clock size={13} strokeWidth={1.8} aria-hidden="true" />
          Awaiting next scan
        </span>
      ) : (
        visible.map((transition) => {
          const tone = transitionTone(transition);
          return (
            <span
              key={transition.id}
              style={{
                display: "inline-flex",
                alignItems: "baseline",
                gap: sp(3),
                color: CSS_COLOR.textSec,
                fontFamily: T.sans,
                fontSize: embedded ? textSize("caption") : textSize("body"),
                lineHeight: 1.3,
                minWidth: 0,
              }}
            >
              <span
                style={{
                  color: CSS_COLOR.textDim,
                  fontFamily: T.sans,
                  fontSize: textSize("caption"),
                }}
              >
                {formatHms(transition.timeMs)}
              </span>
              <span
                style={{
                  color: tone,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: embedded ? "100%" : "260px",
                }}
              >
                {transitionLabel(transition)}
              </span>
            </span>
          );
        })
      )}
    </div>
  );
};

export default OperationsTransitionsStrip;
