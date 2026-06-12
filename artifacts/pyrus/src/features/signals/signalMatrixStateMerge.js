import { normalizeSignalStatus } from "./signalStateFreshness.js";

const SIGNAL_EVENT_MATRIX_TIMEFRAMES = Object.freeze([
  "1m",
  "2m",
  "5m",
  "15m",
  "1h",
  "1d",
]);
const SIGNAL_MATRIX_TIMEFRAME_MS = Object.freeze({
  "1m": 60_000,
  "2m": 2 * 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "1d": 24 * 60 * 60_000,
});

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

const isoStringOrNull = (value) => {
  const time = timestampMs(value);
  return time > 0 ? new Date(time).toISOString() : null;
};

const newestIsoString = (...values) => {
  let newestMs = 0;
  values.forEach((value) => {
    const time = timestampMs(value);
    if (time > newestMs) newestMs = time;
  });
  return newestMs > 0 ? new Date(newestMs).toISOString() : null;
};

const finiteNumberOrNull = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
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

const normalizeSignalTimeframe = (value) => {
  const normalized = String(value || "").trim();
  return SIGNAL_EVENT_MATRIX_TIMEFRAMES.includes(normalized) ? normalized : "";
};

const signalMatrixBarsSinceSignal = ({
  timeframe,
  signalAt,
  latestBarAt,
  presentBarsSinceSignal = null,
} = {}) => {
  const presentBars = finiteNumberOrNull(presentBarsSinceSignal);
  const normalizedTimeframe = normalizeSignalTimeframe(timeframe);
  if (normalizedTimeframe === "1d") {
    return presentBars;
  }
  const signalMs = timestampMs(signalAt);
  const latestBarMs = timestampMs(latestBarAt);
  const timeframeMs = SIGNAL_MATRIX_TIMEFRAME_MS[normalizedTimeframe];
  if (!signalMs || !latestBarMs || !Number.isFinite(timeframeMs) || timeframeMs <= 0) {
    return presentBars;
  }
  const elapsedMs = latestBarMs - signalMs;
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    return presentBars;
  }
  return Math.max(presentBars ?? 0, Math.round(elapsedMs / timeframeMs));
};

const eventActivityMs = (event) =>
  Math.max(timestampMs(event?.signalAt), timestampMs(event?.emittedAt));

const eventSignalKey = (event) => {
  const symbol = normalizeSignalMatrixSymbol(event?.symbol);
  const timeframe = normalizeSignalTimeframe(event?.timeframe) || "5m";
  const direction = normalizeSignalDirection(event?.direction);
  const signalAt = isoStringOrNull(event?.signalAt);
  if (!symbol || !timeframe || !direction || !signalAt) return "";
  return [event?.profileId || "", symbol, timeframe, direction, signalAt].join("|");
};

export const canonicalSignalMonitorEventsForMatrixMerge = ({
  events = [],
  sourceStatus = "database",
} = {}) =>
  sourceStatus === "runtime-fallback"
    ? []
    : Array.isArray(events)
      ? events
      : [];

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

const mergeDirectionalStateWithMetadata = (directionalState, metadataState) => {
  if (!directionalState || !metadataState) return directionalState || null;
  if (
    readSignalMatrixStateActivityMs(metadataState) <=
    readSignalMatrixStateActivityMs(directionalState)
  ) {
    return directionalState;
  }
  const latestBarAt = metadataState.latestBarAt || directionalState.latestBarAt;
  return {
    ...metadataState,
    currentSignalDirection: directionalState.currentSignalDirection,
    currentSignalAt: directionalState.currentSignalAt,
    currentSignalPrice:
      directionalState.currentSignalPrice ?? metadataState.currentSignalPrice ?? null,
    barsSinceSignal: signalMatrixBarsSinceSignal({
      timeframe: metadataState.timeframe || directionalState.timeframe,
      signalAt: directionalState.currentSignalAt,
      latestBarAt,
      presentBarsSinceSignal:
        directionalState.barsSinceSignal ?? metadataState.barsSinceSignal,
    }),
    fresh: false,
    displayHydrationSource:
      directionalState.displayHydrationSource ||
      metadataState.displayHydrationSource,
  };
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

export const preferSignalMatrixCellState = (current, candidate) => {
  if (!current) return candidate || null;
  if (!candidate) return current;

  const currentPending = isPendingSignalMatrixState(current);
  const candidatePending = isPendingSignalMatrixState(candidate);
  if (currentPending !== candidatePending) {
    return currentPending ? candidate : current;
  }

  // Latch the cached signal: keep a buy/sell cell over a directionless update
  // (a re-evaluation with no new signal) even when that update is more recent.
  // A directional candidate always replaces a directionless current. The cached
  // direction only changes when a new signal arrives.
  const currentHasDirection = hasSignalDirection(current);
  const candidateHasDirection = hasSignalDirection(candidate);
  if (currentHasDirection !== candidateHasDirection) {
    return currentHasDirection
      ? mergeDirectionalStateWithMetadata(current, candidate)
      : mergeDirectionalStateWithMetadata(candidate, current);
  }

  if (currentHasDirection && candidateHasDirection) {
    const currentSignalAt = readDirectionalSignalMs(current);
    const candidateSignalAt = readDirectionalSignalMs(candidate);
    if (candidateSignalAt !== currentSignalAt) {
      return candidateSignalAt > currentSignalAt ? candidate : current;
    }
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

const hasDisplaySignalDirection = (state) =>
  Boolean(normalizeSignalDirection(state?.currentSignalDirection));

const existingCurrentSignalMs = (state) => {
  if (!state || state.active === false) return 0;
  const status = normalizeSignalStatus(state);
  if (status === "stale" || status === "pending" || status === "unknown") {
    return 0;
  }
  if (!hasDisplaySignalDirection(state)) return 0;
  return timestampMs(state.currentSignalAt);
};

const storedSignalMatrixStateForDisplay = (state) => {
  const direction = normalizeSignalDirection(state?.currentSignalDirection);
  if (
    !state ||
    normalizeSignalStatus(state) !== "stale" ||
    !direction ||
    !state.currentSignalAt ||
    state.active === false
  ) {
    return state || null;
  }

  return {
    ...state,
    currentSignalDirection: direction,
    status: "ok",
    fresh: false,
    actionEligible: false,
    displayHydrationSource:
      state.displayHydrationSource || "signal_monitor_stored_state",
  };
};

export const signalMonitorEventToMatrixState = (
  event,
  { currentState = null } = {},
) => {
  const symbol = normalizeSignalMatrixSymbol(event?.symbol);
  const timeframe = normalizeSignalTimeframe(event?.timeframe) || "5m";
  const direction = normalizeSignalDirection(event?.direction);
  const signalAt = isoStringOrNull(event?.signalAt);
  if (!symbol || !timeframe || !direction || !signalAt) {
    return null;
  }

  const payload =
    event?.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
      ? event.payload
      : {};
  const latestBarAt =
    newestIsoString(
      payload.latestBarAt,
      payload.signalBarAt,
      payload.latestBarAnchorAt,
      currentState?.latestBarAt,
      signalAt,
    ) || signalAt;
  const lastEvaluatedAt =
    newestIsoString(currentState?.lastEvaluatedAt, event?.emittedAt, latestBarAt) ||
    latestBarAt;
  const signalPrice =
    finiteNumberOrNull(event?.signalPrice) ??
    finiteNumberOrNull(event?.close) ??
    finiteNumberOrNull(currentState?.currentSignalPrice);
  const barsSinceSignal = signalMatrixBarsSinceSignal({
    timeframe,
    signalAt,
    latestBarAt,
    presentBarsSinceSignal: payload.barsSinceSignal ?? currentState?.barsSinceSignal,
  });

  return {
    ...(currentState || {}),
    id: event?.id
      ? `signal-event-overlay:${event.id}`
      : `signal-event-overlay:${symbol}:${timeframe}:${direction}:${signalAt}`,
    profileId: event?.profileId || currentState?.profileId || null,
    symbol,
    timeframe,
    status: "ok",
    active: true,
    currentSignalDirection: direction,
    currentSignalAt: signalAt,
    currentSignalPrice: signalPrice,
    latestBarAt,
    lastEvaluatedAt,
    barsSinceSignal,
    fresh: false,
    actionEligible: false,
    source: event?.source || currentState?.source || "pyrus-signals",
    sourceType: "signal_monitor_event",
    eventId: event?.id || null,
    displayHydrationSource: "signal_monitor_event",
  };
};

export const mergeSignalEventsIntoMatrixStates = ({
  states = [],
  events = [],
} = {}) => {
  const merged = new Map();
  (Array.isArray(states) ? states : []).forEach((state) => {
    const key = signalMatrixStateKey(state);
    const displayState = storedSignalMatrixStateForDisplay(state);
    if (key && displayState) merged.set(key, displayState);
  });

  const latestEvents = new Map();
  (Array.isArray(events) ? events : []).forEach((event) => {
    const key = eventSignalKey(event);
    if (!key) return;
    const current = latestEvents.get(key);
    if (!current || eventActivityMs(event) >= eventActivityMs(current)) {
      latestEvents.set(key, event);
    }
  });

  latestEvents.forEach((event) => {
    const symbol = normalizeSignalMatrixSymbol(event?.symbol);
    const timeframe = normalizeSignalTimeframe(event?.timeframe) || "5m";
    const key = symbol && timeframe ? `${symbol}:${timeframe}` : "";
    if (!key) return;

    const currentState = merged.get(key) || null;
    const eventSignalMs = timestampMs(event?.signalAt);
    const currentSignalMs = existingCurrentSignalMs(currentState);
    if (currentSignalMs > 0 && currentSignalMs >= eventSignalMs) {
      return;
    }

    const eventState = signalMonitorEventToMatrixState(event, { currentState });
    if (eventState) merged.set(key, eventState);
  });

  return Array.from(merged.values()).sort((left, right) => {
    const leftSymbol = normalizeSignalMatrixSymbol(left?.symbol);
    const rightSymbol = normalizeSignalMatrixSymbol(right?.symbol);
    if (leftSymbol !== rightSymbol) {
      return leftSymbol.localeCompare(rightSymbol);
    }
    return String(left?.timeframe || "").localeCompare(
      String(right?.timeframe || ""),
    );
  });
};
