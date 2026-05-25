import React from "react";
import { ShieldCheck } from "lucide-react";
import {
  RADII,
  T,
  dim,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";

const SEVERITY_GLYPH = {
  critical: "⚠",
  warning: "⚠",
  info: "•",
};

const severityColor = (severity) => {
  if (severity === "critical") return T.red;
  if (severity === "warning") return T.amber;
  return T.cyan;
};

export const OperationsAttentionStrip = ({
  items = [],
  maxInline = 3,
  embedded = false,
}) => {
  const visible = items.slice(0, maxInline);
  const overflow = Math.max(0, items.length - maxInline);

  return (
    <div
      data-testid="algo-operations-attention-strip"
      style={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: sp(embedded ? 4 : 6),
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
        Attention
      </span>
      {visible.length === 0 ? (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: sp(3),
            color: T.green,
            fontFamily: T.sans,
            fontSize: embedded ? textSize("caption") : textSize("body"),
          }}
        >
          <ShieldCheck size={13} strokeWidth={1.8} aria-hidden="true" />
          All clear
        </span>
      ) : (
        visible.map((item) => {
          const tone = severityColor(item.severity);
          const glyph = SEVERITY_GLYPH[item.severity] || "•";
          const symbol = item.symbol ? `${item.symbol} ` : "";
          const detail = item.detail || item.description || item.title || "";
          return (
            <span
              key={`${item.id || item.title || symbol}${detail}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: sp(2),
                color: T.textSec,
                fontFamily: T.sans,
                fontSize: embedded ? textSize("caption") : textSize("body"),
                lineHeight: 1.3,
                minWidth: 0,
              }}
            >
              <span style={{ color: tone, fontWeight: 600 }}>{glyph}</span>
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: embedded ? "100%" : "320px",
                }}
              >
                {symbol}
                {detail}
              </span>
            </span>
          );
        })
      )}
      {overflow > 0 ? (
        <span
          style={{
            color: T.textDim,
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            fontStyle: "italic",
          }}
        >
          +{overflow} more
        </span>
      ) : null}
    </div>
  );
};

export default OperationsAttentionStrip;
