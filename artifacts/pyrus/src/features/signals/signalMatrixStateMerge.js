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

const signalMatrixStateRank = (state) => {
  if (!state) return 0;
  const status = normalizeSignalStatus(state);
  if (isPendingSignalMatrixState(state)) return 1;
  if (status === "error" || status === "unavailable" || state.lastError) return 2;
  if (hasSignalDirection(state)) return state.fresh ? 5 : 4;
  if (readSignalMatrixStateActivityMs(state) > 0) return 3;
  return 1;
};

export const preferSignalMatrixCellState = (current, candidate) => {
  if (!current) return candidate || null;
  if (!candidate) return current;

  const currentPending = isPendingSignalMatrixState(current);
  const candidatePending = isPendingSignalMatrixState(candidate);
  if (currentPending !== candidatePending) {
    return currentPending ? candidate : current;
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

  return candidate;
};
