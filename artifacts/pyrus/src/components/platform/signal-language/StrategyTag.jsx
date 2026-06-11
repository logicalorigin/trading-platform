import React from "react";
import { AppTooltip } from "@/components/ui/tooltip";
import { formatEnumLabel } from "../../../lib/formatters";
import { CSS_COLOR, cssColorMix, dim, FONT_WEIGHTS, RADII, sp, T, textSize } from "../../../lib/uiTokens.jsx";
import { strategyTooltip } from "./tooltips.js";

const asRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const firstText = (...values) => {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
};

const strategyTone = (value) => {
  const text = String(value || "").toLowerCase();
  if (/mean|reversion|mr/.test(text)) return CSS_COLOR.cyan;
  if (/break|bos|choch/.test(text)) return CSS_COLOR.pink;
  if (/momentum|trend|mo/.test(text)) return CSS_COLOR.amber;
  if (/automation|signal/.test(text)) return CSS_COLOR.blue;
  return CSS_COLOR.textSec;
};

const labelToken = (label) => {
  const normalized = formatEnumLabel(label).replace(/[^a-z0-9 ]/gi, " ").trim();
  if (!normalized) return "";
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  }
  return normalized.slice(0, 2).toUpperCase();
};

export const StrategyTag = ({ candidate, signal }) => {
  const candidateRecord = asRecord(candidate);
  const signalRecord = asRecord(signal);
  const sourceLabel = firstText(
    candidateRecord.sourceType,
    candidateRecord.strategyLabel,
    candidateRecord.source,
    signalRecord.strategyLabel,
    signalRecord.timeframe,
  );
  if (!sourceLabel) return null;
  const token = labelToken(sourceLabel);
  if (!token) return null;
  const tone = strategyTone(sourceLabel);
  const fullLabel = formatEnumLabel(sourceLabel);
  const label = strategyTooltip({ label: fullLabel });

  return (
    <AppTooltip content={label}>
      <span
        data-testid="algo-strategy-tag"
        aria-label={label}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          height: dim(14),
          minWidth: dim(18),
          padding: sp("0 4px"),
          borderRadius: dim(RADII.sm),
          border: `1px solid ${cssColorMix(tone, 27)}`,
          background: cssColorMix(tone, 10),
          color: tone,
          fontFamily: T.mono,
          fontSize: textSize("caption"),
          fontWeight: FONT_WEIGHTS.medium,
          lineHeight: 1,
          whiteSpace: "nowrap",
        }}
      >
        {token}
      </span>
    </AppTooltip>
  );
};

export default StrategyTag;
