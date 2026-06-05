import React from "react";
import {
  ShieldCheck,
} from "lucide-react";
import {
  CSS_COLOR,
  RADII,
  T,
  dim,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { FailurePointTooltip } from "../../components/platform/FailurePointTooltip.jsx";
import { buildFailurePointFromAlgoAttentionItem } from "../../features/platform/failurePointModel.js";

const SEVERITY_GLYPH = {
  warning: "⚠",
  info: "•",
};

const severityColor = (severity) => {
  if (severity === "warning") return CSS_COLOR.amber;
  return CSS_COLOR.cyan;
};

const cleanAttentionText = (value) => String(value || "").trim();

const formatAttentionStage = (value) =>
  cleanAttentionText(value)
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

const attentionInlineText = (item) => {
  const symbol = cleanAttentionText(item?.symbol);
  const stage = formatAttentionStage(item?.stage || item?.kindLabel);
  const detail = cleanAttentionText(
    item?.detail || item?.summary || item?.description || item?.action,
  );
  const title = cleanAttentionText(item?.title);
  const reason = [stage && stage !== "Attention" ? stage : "", detail]
    .filter(Boolean)
    .join(" - ");
  if (symbol) {
    return reason ? `${symbol} - ${reason}` : symbol;
  }
  return reason || title || "Attention";
};

export const OperationsAttentionStrip = ({
  items = [],
  maxInline = 3,
  embedded = false,
  showClearState = true,
}) => {
  const visible = items.slice(0, maxInline);
  const overflow = Math.max(0, items.length - maxInline);
  if (!visible.length && !showClearState) return null;

  return (
    <div
      data-testid="algo-operations-attention-strip"
      style={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: sp(embedded ? 4 : 6),
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
        Attention
      </span>
      {visible.length === 0 ? (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: sp(3),
            color: CSS_COLOR.green,
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
          const inlineText = attentionInlineText(item);
          const failurePoint = buildFailurePointFromAlgoAttentionItem(item);
          const itemNode = (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: sp(2),
                color: CSS_COLOR.textSec,
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
                {inlineText}
              </span>
            </span>
          );
          return (
            <FailurePointTooltip
              key={`${item.id || item.title || inlineText}`}
              point={failurePoint}
              side="top"
              align="start"
              compact
            >
              {itemNode}
            </FailurePointTooltip>
          );
        })
      )}
      {overflow > 0 ? (
        <span
          style={{
            color: CSS_COLOR.textDim,
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
