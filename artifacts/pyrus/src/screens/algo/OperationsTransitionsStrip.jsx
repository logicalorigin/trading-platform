import React from "react";
import { Clock } from "lucide-react";
import {
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
    if (transition.nextState === "fresh") return T.green;
    if (transition.nextState === "stale") return T.amber;
    if (transition.nextState === "unavailable") return T.textDim;
    if (transition.nextState === "error") return T.red;
    return T.text;
  }
  if (transition?.eventType?.endsWith("_blocked")) return T.amber;
  if (transition?.eventType?.endsWith("_skipped")) return T.textDim;
  if (transition?.eventType?.endsWith("_entry")) return T.green;
  if (transition?.eventType?.endsWith("_exit")) return T.cyan;
  return T.text;
};

export const OperationsTransitionsStrip = ({
  transitions = [],
  maxInline = 5,
  embedded = false,
}) => {
  const visible = transitions.slice(0, maxInline);
  return (
    <div
      data-testid="algo-operations-transitions-strip"
      style={{
        display: "flex",
        alignItems: "center",
        gap: sp(embedded ? 4 : 6),
        flexWrap: "wrap",
        rowGap: sp(2),
        background: embedded ? "transparent" : T.bg1,
        border: embedded ? "none" : `1px solid ${T.border}`,
        borderRadius: embedded ? 0 : dim(RADII.md),
        padding: embedded ? sp("2px 6px") : sp("6px 10px"),
        minWidth: 0,
        minHeight: embedded ? dim(24) : "auto",
      }}
    >
      <span
        style={{
          color: T.textMuted,
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
            color: T.textDim,
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
                color: T.textSec,
                fontFamily: T.sans,
                fontSize: embedded ? textSize("caption") : textSize("body"),
                lineHeight: 1.3,
                minWidth: 0,
              }}
            >
              <span
                style={{
                  color: T.textDim,
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
