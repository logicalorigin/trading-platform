import { CSS_COLOR } from "../../lib/uiTokens.jsx";

const normalizeToken = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");

const BLUE_DIRECTION_TOKENS = new Set([
  "ask",
  "ask-call",
  "ask-calls",
  "buy",
  "buyer",
  "buying",
  "bull",
  "bullish",
  "call",
  "calls",
  "call-side",
  "inflow",
  "long",
  "positive-pressure",
]);

const RED_DIRECTION_TOKENS = new Set([
  "ask-put",
  "ask-puts",
  "bear",
  "bearish",
  "bid-put",
  "bid-puts",
  "outflow",
  "put",
  "puts",
  "put-side",
  "sell",
  "seller",
  "selling",
  "short",
  "negative-pressure",
]);

const GREEN_OPERATION_TOKENS = new Set([
  "active",
  "clear",
  "configured",
  "connected",
  "fresh",
  "healthy",
  "live",
  "normal",
  "ok",
  "ready",
  "reachable",
  "synced",
  "success",
]);

const AMBER_OPERATION_TOKENS = new Set([
  "attention",
  "capacity-limited",
  "checking",
  "degraded",
  "delayed",
  "limited",
  "loading",
  "market-closed",
  "missing",
  "no-subscribers",
  "not-configured",
  "pending",
  "queued",
  "quiet",
  "reconnecting",
  "refreshing",
  "stale",
  "stale-cache",
  "standby",
  "unconfigured",
  "warning",
]);

const RED_OPERATION_TOKENS = new Set([
  "blocked",
  "critical",
  "down",
  "error",
  "failed",
  "login-required",
  "offline",
  "rejected",
  "unavailable",
]);

const AMBER_RISK_TOKENS = new Set([
  "attention",
  "elevated",
  "high",
  "watch",
  "warning",
]);

const RED_RISK_TOKENS = new Set([
  "blocked",
  "critical",
  "danger",
  "error",
  "failed",
  "loss",
  "severe",
]);

export const SEMANTIC_TONE = Object.freeze({
  directionBuy: CSS_COLOR.blue,
  directionSell: CSS_COLOR.red,
  financialPositive: CSS_COLOR.green,
  financialNegative: CSS_COLOR.red,
  operationalGood: CSS_COLOR.green,
  operationalAttention: CSS_COLOR.amber,
  operationalBad: CSS_COLOR.red,
  neutral: CSS_COLOR.textDim,
});

export const toneForDirectionalIntent = (
  value,
  fallback = SEMANTIC_TONE.neutral,
) => {
  const token = normalizeToken(value);
  if (BLUE_DIRECTION_TOKENS.has(token)) return SEMANTIC_TONE.directionBuy;
  if (RED_DIRECTION_TOKENS.has(token)) return SEMANTIC_TONE.directionSell;
  return fallback;
};

export const toneForOptionSide = (side, fallback = SEMANTIC_TONE.neutral) => {
  const token = normalizeToken(side);
  if (token === "c") return SEMANTIC_TONE.directionBuy;
  if (token === "p") return SEMANTIC_TONE.directionSell;
  return toneForDirectionalIntent(token, fallback);
};

export const toneForFinancialDelta = (
  value,
  fallback = SEMANTIC_TONE.neutral,
) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric === 0) return fallback;
  return numeric > 0
    ? SEMANTIC_TONE.financialPositive
    : SEMANTIC_TONE.financialNegative;
};

export const toneForOperationalState = (
  value,
  fallback = SEMANTIC_TONE.neutral,
) => {
  const token = normalizeToken(value);
  if (GREEN_OPERATION_TOKENS.has(token)) return SEMANTIC_TONE.operationalGood;
  if (AMBER_OPERATION_TOKENS.has(token)) {
    return SEMANTIC_TONE.operationalAttention;
  }
  if (RED_OPERATION_TOKENS.has(token)) return SEMANTIC_TONE.operationalBad;
  return fallback;
};

export const toneForRiskState = (value, fallback = SEMANTIC_TONE.neutral) => {
  const token = normalizeToken(value);
  if (token === "normal" || token === "safe" || token === "low") {
    return SEMANTIC_TONE.operationalGood;
  }
  if (AMBER_RISK_TOKENS.has(token)) return SEMANTIC_TONE.operationalAttention;
  if (RED_RISK_TOKENS.has(token)) return SEMANTIC_TONE.operationalBad;
  return fallback;
};
