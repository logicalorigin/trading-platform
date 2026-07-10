import { MISSING_VALUE } from "../../../lib/uiTokens.jsx";
import { FRESHNESS_BAR_DENOM, SCORE_COLD, SCORE_HOT } from "./thresholds.js";

const finiteNumber = (value) => {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const scoreState = (score) => {
  const value = finiteNumber(score);
  if (value == null) return MISSING_VALUE;
  if (value >= SCORE_HOT) return "hot";
  if (value < SCORE_COLD) return "cold";
  return "neutral";
};

export const freshnessTooltip = ({
  barsSince,
  denom = FRESHNESS_BAR_DENOM,
} = {}) => {
  const bars = finiteNumber(barsSince);
  if (bars == null) return "Freshness unavailable.";
  return `Signal fired ${Math.round(bars)} bars ago. Goes stale at ${denom} bars.`;
};

export const spreadTooltip = ({ spreadPct } = {}) => {
  const value = finiteNumber(spreadPct);
  return value == null
    ? "Spread unavailable."
    : `Spread ${(value * 100).toFixed(1)}%.`;
};

export const strategyTooltip = ({ label } = {}) =>
  label ? `Strategy: ${label}` : "Strategy unavailable.";

export const verdictTooltip = ({
  verdict,
  score,
  detail,
  freshness,
  blockers,
  spreadPct,
  confluence,
} = {}) => {
  const parts = [`Verdict: ${verdict || MISSING_VALUE}.`];
  const context = detail || freshness;
  if (context) {
    parts.push(String(context).trim().endsWith(".") ? context : `${context}.`);
  }
  const scoreValue = finiteNumber(score);
  if (scoreValue != null) {
    parts.push(`Score ${scoreValue.toFixed(1)} (${scoreState(scoreValue)}).`);
  }
  if (confluence) parts.push(confluence);
  const spread = spreadTooltip({ spreadPct });
  if (spread !== "Spread unavailable.") parts.push(spread);
  parts.push(blockers ? `Blocker: ${blockers}.` : "No blockers.");
  return parts.join(" ");
};
