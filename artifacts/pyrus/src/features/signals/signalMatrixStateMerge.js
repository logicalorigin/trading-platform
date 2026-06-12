import { normalizeSignalStatus } from "./signalStateFreshness.js";

export const normalizeSignalMatrixSymbol = (symbol) =>
  symbol?.trim?.().toUpperCase?.() || "";

export const signalMatrixStateKey = (state) => {
  const symbol = normalizeSignalMatrixSymbol(state?.symbol);
  const timeframe = String(state?.timeframe || "").trim();
  return symbol && timeframe ? `${symbol}:${timeframe}` : "";
};

const timestampMs = (value) => {
  if (!value) return 0;
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const comparableFiniteNumberOrNull = (value) => {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const normalizeSignalDirection = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "buy" || normalized === "sell" ? normalized : "";
};

export const readSignalMatrixStateActivityMs = (state) =>
  Math.max(
    timestampMs(state?.currentSignalAt),
    timestampMs(state?.latestBarAt),
    timestampMs(state?.lastEvaluatedAt),
  );

export const isPendingSignalMatrixState = (state) => {
  const status = normalizeSignalStatus(state);
  return status === "pending" || status === "unknown";
};

const hasSignalDirection = (state) => {
  const direction = String(state?.currentSignalDirection || "").trim().toLowerCase();
  return direction === "buy" || direction === "sell";
};

const readDirectionalSignalMs = (state) =>
  hasSignalDirection(state) ? timestampMs(state?.currentSignalAt) : 0;

const signalMatrixStateRank = (state) => {
  if (!state) return 0;
  const status = normalizeSignalStatus(state);
  if (isPendingSignalMatrixState(state)) return 1;
  if (status === "error" || status === "unavailable" || state.lastError) return 2;
  if (hasSignalDirection(state)) return state.fresh ? 5 : 4;
  if (readSignalMatrixStateActivityMs(state) > 0) return 3;
  return 1;
};

const equivalentSignalMatrixCellState = (current, candidate) =>
  signalMatrixStateKey(current) === signalMatrixStateKey(candidate) &&
  normalizeSignalStatus(current) === normalizeSignalStatus(candidate) &&
  normalizeSignalDirection(current?.currentSignalDirection) ===
    normalizeSignalDirection(candidate?.currentSignalDirection) &&
  timestampMs(current?.currentSignalAt) === timestampMs(candidate?.currentSignalAt) &&
  timestampMs(current?.latestBarAt) === timestampMs(candidate?.latestBarAt) &&
  timestampMs(current?.lastEvaluatedAt) === timestampMs(candidate?.lastEvaluatedAt) &&
  comparableFiniteNumberOrNull(current?.currentSignalPrice) ===
    comparableFiniteNumberOrNull(candidate?.currentSignalPrice) &&
  comparableFiniteNumberOrNull(current?.barsSinceSignal) ===
    comparableFiniteNumberOrNull(candidate?.barsSinceSignal) &&
  Boolean(current?.fresh) === Boolean(candidate?.fresh) &&
  (current?.active !== false) === (candidate?.active !== false) &&
  String(current?.lastError || "") === String(candidate?.lastError || "") &&
  String(current?.actionBlocker || "") === String(candidate?.actionBlocker || "") &&
  Boolean(current?.actionEligible) === Boolean(candidate?.actionEligible) &&
  String(current?.sourceType || "") === String(candidate?.sourceType || "") &&
  String(current?.eventId || "") === String(candidate?.eventId || "") &&
  String(current?.displayHydrationSource || "") ===
    String(candidate?.displayHydrationSource || "");

// The backend is the sole author of signal state: it latches direction across
// directionless re-evaluations (in the evaluators, on the SSE wire, and in the
// DB), recomputes bar age gap-aware, and authors fresh/actionEligible. The
// merge here only picks the more authoritative copy of a cell — it never
// reconstructs or rewrites fields. Ordering mirrors the backend preserve rule:
// a real signal outranks bar-metadata recency (so a directionless or older
// copy can never displace a latched buy/sell), newer activity breaks
// same-signal ties, and an equivalent incoming state reuses the current
// object so equal SSE/REST updates do not churn React.
export const preferSignalMatrixCellState = (current, candidate) => {
  if (!current) return candidate || null;
  if (!candidate) return current;

  const currentPending = isPendingSignalMatrixState(current);
  const candidatePending = isPendingSignalMatrixState(candidate);
  if (currentPending !== candidatePending) {
    return currentPending ? candidate : current;
  }

  const currentSignalMs = readDirectionalSignalMs(current);
  const candidateSignalMs = readDirectionalSignalMs(candidate);
  if (candidateSignalMs !== currentSignalMs) {
    return candidateSignalMs > currentSignalMs ? candidate : current;
  }

  const currentActivity = readSignalMatrixStateActivityMs(current);
  const candidateActivity = readSignalMatrixStateActivityMs(candidate);
  if (candidateActivity !== currentActivity) {
    return candidateActivity > currentActivity ? candidate : current;
  }

  const currentRank = signalMatrixStateRank(current);
  const candidateRank = signalMatrixStateRank(candidate);
  if (candidateRank !== currentRank) {
    return candidateRank > currentRank ? candidate : current;
  }

  return equivalentSignalMatrixCellState(current, candidate) ? current : candidate;
};
