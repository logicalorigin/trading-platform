import {
  getCurrentSignalDirection,
  hasCurrentSignalDirection,
  isCurrentFreshSignalState,
  isIdleSignalState,
  isProblemSignalState,
  isSignalStateCurrent,
  isStaleSignalState,
  normalizeSignalDirection,
  normalizeSignalStatus,
  normalizeTrendSignalDirection,
} from "./signalStateFreshness.js";
import { preferSignalMatrixCellState } from "./signalMatrixStateMerge.js";

export const SIGNALS_TABLE_TIMEFRAMES = Object.freeze([
  "1m",
  "2m",
  "5m",
  "15m",
  "1h",
  "1d",
]);

export const SIGNALS_ROW_STATUS = Object.freeze({
  activeFresh: "active-fresh",
  activeIdle: "active-idle",
  activeStale: "active-stale",
  problem: "problem",
  skipped: "skipped",
  pending: "pending",
  neutral: "neutral",
});

const IDLE_STATUSES = new Set(["idle"]);
const STALE_STATUSES = new Set(["stale"]);
const STATUS_SORT_WEIGHT = Object.freeze({
  [SIGNALS_ROW_STATUS.activeFresh]: 0,
  [SIGNALS_ROW_STATUS.activeIdle]: 1,
  [SIGNALS_ROW_STATUS.activeStale]: 2,
  [SIGNALS_ROW_STATUS.problem]: 3,
  [SIGNALS_ROW_STATUS.skipped]: 4,
  [SIGNALS_ROW_STATUS.pending]: 5,
  [SIGNALS_ROW_STATUS.neutral]: 6,
});

const DIRECTION_SORT_WEIGHT = Object.freeze({
  buy: 0,
  sell: 1,
});

const SIGNAL_MATRIX_TIMEFRAME_WEIGHTS = Object.freeze({
  "1m": 8,
  "2m": 10,
  "5m": 25,
  "15m": 22,
  "1h": 20,
  "1d": 15,
});
const SIGNAL_MATRIX_TOTAL_WEIGHT = SIGNALS_TABLE_TIMEFRAMES.reduce(
  (sum, timeframe) => sum + (SIGNAL_MATRIX_TIMEFRAME_WEIGHTS[timeframe] || 0),
  0,
);

const normalizeSignalMatrixTimeframes = (timeframes = SIGNALS_TABLE_TIMEFRAMES) => {
  const normalized = Array.from(
    new Set(
      (Array.isArray(timeframes) && timeframes.length
        ? timeframes
        : SIGNALS_TABLE_TIMEFRAMES
      )
        .map((timeframe) => String(timeframe || "").trim())
        .filter((timeframe) => SIGNALS_TABLE_TIMEFRAMES.includes(timeframe)),
    ),
  );
  return normalized.length ? normalized : [...SIGNALS_TABLE_TIMEFRAMES];
};

const signalMatrixTotalWeight = (timeframes = SIGNALS_TABLE_TIMEFRAMES) => {
  const total = normalizeSignalMatrixTimeframes(timeframes).reduce(
    (sum, timeframe) => sum + (SIGNAL_MATRIX_TIMEFRAME_WEIGHTS[timeframe] || 0),
    0,
  );
  return total || SIGNAL_MATRIX_TOTAL_WEIGHT;
};
const SIGNAL_MATRIX_LOWER_TIMEFRAMES = Object.freeze(["1m", "2m"]);
const SIGNAL_MATRIX_HIGHER_TIMEFRAMES = Object.freeze(["15m", "1h", "1d"]);
const SIGNAL_MATRIX_EXECUTION_TIMEFRAME = "5m";

export const normalizeSignalsTicker = (value) =>
  String(value || "").trim().toUpperCase();

const timestampMs = (value) => {
  if (!value) return 0;
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const stateActivityMs = (state) =>
  Math.max(
    timestampMs(state?.currentSignalAt),
    timestampMs(state?.lastEvaluatedAt),
    timestampMs(state?.latestBarAt),
  );

const finiteNumberOrNull = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const compareText = (left, right, multiplier) =>
  multiplier * String(left || "").localeCompare(String(right || ""));

const compareNumberAsc = (left, right, multiplier) => {
  const leftNumber = finiteNumberOrNull(left);
  const rightNumber = finiteNumberOrNull(right);
  if (leftNumber == null && rightNumber == null) return 0;
  if (leftNumber == null) return 1;
  if (rightNumber == null) return -1;
  return multiplier * (leftNumber - rightNumber);
};

const compareNumberDesc = (left, right, multiplier) => {
  const leftNumber = finiteNumberOrNull(left);
  const rightNumber = finiteNumberOrNull(right);
  if (leftNumber == null && rightNumber == null) return 0;
  if (leftNumber == null) return 1;
  if (rightNumber == null) return -1;
  return multiplier * (rightNumber - leftNumber);
};

const strengthSortValue = (value) => {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "strong") return 3;
  if (normalized === "moderate") return 2;
  if (normalized === "weak") return 1;
  return null;
};

const mtfPassCount = (row) =>
  (Array.isArray(row?.dashboardSummary?.mtf) ? row.dashboardSummary.mtf : [])
    .filter((entry) => entry?.pass === true).length;

const matrixSortState = (row, timeframe) =>
  row?.matrixStatesByTimeframe?.[timeframe] || null;

const eventActivityMs = (event) =>
  Math.max(timestampMs(event?.emittedAt), timestampMs(event?.signalAt));

// Signal-fire recency: when the signal actually fired, ignoring bar/eval churn.
// "Most recent" ordering must rank by this, NOT stateActivityMs (which folds in
// latestBarAt/lastEvaluatedAt and lets a constantly-ticking but stale symbol,
// e.g. SPY, outrank a fresher signal, e.g. AES).
const stateSignalMs = (state) => timestampMs(state?.currentSignalAt);
const eventSignalMs = (event) => timestampMs(event?.signalAt);

const preferLatestState = (left, right) => {
  if (!left) return right || null;
  if (!right) return left;
  const leftHasSignal = hasCurrentSignalDirection(left);
  const rightHasSignal = hasCurrentSignalDirection(right);
  if (leftHasSignal !== rightHasSignal) {
    return leftHasSignal ? left : right;
  }
  if (leftHasSignal && rightHasSignal) {
    const leftSignalAt = stateSignalMs(left);
    const rightSignalAt = stateSignalMs(right);
    if (rightSignalAt !== leftSignalAt) {
      return rightSignalAt > leftSignalAt ? right : left;
    }
  }
  return stateActivityMs(right) >= stateActivityMs(left) ? right : left;
};

const preferLatestEvent = (left, right) => {
  if (!left) return right || null;
  if (!right) return left;
  return eventActivityMs(right) >= eventActivityMs(left) ? right : left;
};

const buildWatchlistMembership = (watchlists = []) => {
  const bySymbol = new Map();
  (Array.isArray(watchlists) ? watchlists : []).forEach((watchlist) => {
    const listName = watchlist?.name || watchlist?.label || watchlist?.id || "Watchlist";
    const listId = watchlist?.id || listName;
    const sourceItems = Array.isArray(watchlist?.items) && watchlist.items.length
      ? watchlist.items
      : Array.isArray(watchlist?.symbols)
        ? watchlist.symbols
        : [];
    sourceItems.forEach((item) => {
      const symbol = normalizeSignalsTicker(
        typeof item === "string" ? item : item?.sym || item?.symbol || item?.ticker,
      );
      if (!symbol) return;
      const entry = bySymbol.get(symbol) || {
        watchlistIds: [],
        watchlistLabels: [],
      };
      if (!entry.watchlistIds.includes(listId)) {
        entry.watchlistIds.push(listId);
      }
      if (!entry.watchlistLabels.includes(listName)) {
        entry.watchlistLabels.push(listName);
      }
      bySymbol.set(symbol, entry);
    });
  });
  return bySymbol;
};

const buildPrimaryStateMap = (states = [], preferredTimeframe = null) => {
  const bySymbol = new Map();
  const fallbackBySymbol = new Map();
  (Array.isArray(states) ? states : []).forEach((state) => {
    const symbol = normalizeSignalsTicker(state?.symbol);
    if (!symbol) return;
    fallbackBySymbol.set(
      symbol,
      preferLatestState(fallbackBySymbol.get(symbol), state),
    );
    if (
      preferredTimeframe &&
      String(state?.timeframe || "").trim() !== preferredTimeframe
    ) {
      return;
    }
    bySymbol.set(symbol, preferLatestState(bySymbol.get(symbol), state));
  });
  fallbackBySymbol.forEach((state, symbol) => {
    if (!bySymbol.has(symbol)) {
      bySymbol.set(symbol, state);
    }
  });
  return bySymbol;
};

export const buildSignalMatrixStatesBySymbol = (states = []) => {
  const bySymbol = new Map();
  (Array.isArray(states) ? states : []).forEach((state) => {
    const symbol = normalizeSignalsTicker(state?.symbol);
    const timeframe = String(state?.timeframe || "").trim();
    if (!symbol || !timeframe) return;
    const current = bySymbol.get(symbol) || {};
    current[timeframe] = preferSignalMatrixCellState(current[timeframe], state);
    bySymbol.set(symbol, current);
  });
  return bySymbol;
};

const buildLatestEventsBySymbol = (events = []) => {
  const bySymbol = new Map();
  (Array.isArray(events) ? events : []).forEach((event) => {
    const symbol = normalizeSignalsTicker(event?.symbol);
    if (!symbol) return;
    bySymbol.set(symbol, preferLatestEvent(bySymbol.get(symbol), event));
  });
  return bySymbol;
};

const addSymbolOnce = (symbols, seen, value) => {
  const symbol = normalizeSignalsTicker(value);
  if (!symbol || seen.has(symbol)) return;
  seen.add(symbol);
  symbols.push(symbol);
};

const buildTrackedSymbols = ({
  universeSymbols,
  skippedSymbols,
  states,
  matrixStates,
  events,
}) => {
  const seen = new Set();
  const symbols = [];
  (Array.isArray(universeSymbols) ? universeSymbols : []).forEach((symbol) =>
    addSymbolOnce(symbols, seen, symbol),
  );
  (Array.isArray(skippedSymbols) ? skippedSymbols : []).forEach((symbol) =>
    addSymbolOnce(symbols, seen, symbol),
  );
  (Array.isArray(states) ? states : []).forEach((state) =>
    addSymbolOnce(symbols, seen, state?.symbol),
  );
  (Array.isArray(matrixStates) ? matrixStates : []).forEach((state) =>
    addSymbolOnce(symbols, seen, state?.symbol),
  );
  (Array.isArray(events) ? events : []).forEach((event) =>
    addSymbolOnce(symbols, seen, event?.symbol),
  );
  return symbols;
};

const resolveDirection = ({ primaryState, matrixStatesByTimeframe }) => {
  const primaryDirection = getCurrentSignalDirection(primaryState);
  if (primaryDirection) {
    return primaryDirection;
  }
  const matrixDirection = SIGNALS_TABLE_TIMEFRAMES
    .map((timeframe) =>
      getCurrentSignalDirection(matrixStatesByTimeframe?.[timeframe]),
    )
    .find(Boolean);
  return matrixDirection || null;
};

const normalizeIndicatorDirection = (value) => {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "bullish") return "buy";
  if (normalized === "bearish") return "sell";
  return null;
};

const resolveDashboardSnapshot = ({ matrixStatesByTimeframe, profileTimeframe }) => {
  const preferredTimeframes = [
    profileTimeframe,
    "15m",
    "5m",
    ...SIGNALS_TABLE_TIMEFRAMES,
  ].filter(Boolean);
  const seen = new Set();
  for (const timeframe of preferredTimeframes) {
    if (seen.has(timeframe)) continue;
    seen.add(timeframe);
    const state = matrixStatesByTimeframe?.[timeframe];
    if (!isSignalStateCurrent(state)) continue;
    const snapshot = state?.indicatorSnapshot;
    if (snapshot) return { timeframe, snapshot };
  }
  return { timeframe: null, snapshot: null };
};

const resolveStackSummary = (matrixStatesByTimeframe = {}) => {
  const states = SIGNALS_TABLE_TIMEFRAMES.map((timeframe) => ({
    timeframe,
    state: matrixStatesByTimeframe[timeframe] || null,
  }));
  const buyCount = states.filter(
    ({ state }) => getCurrentSignalDirection(state) === "buy",
  ).length;
  const sellCount = states.filter(
    ({ state }) => getCurrentSignalDirection(state) === "sell",
  ).length;
  const freshCount = states.filter(({ state }) =>
    isCurrentFreshSignalState(state),
  ).length;
  const activeCount = buyCount + sellCount;
  const direction =
    buyCount > sellCount
      ? "buy"
      : sellCount > buyCount
        ? "sell"
        : activeCount
          ? "mixed"
          : null;
  return {
    direction,
    buyCount,
    sellCount,
    activeCount,
    freshCount,
    totalCount: SIGNALS_TABLE_TIMEFRAMES.length,
    label: activeCount
      ? `${Math.max(buyCount, sellCount)}/${SIGNALS_TABLE_TIMEFRAMES.length}`
      : `0/${SIGNALS_TABLE_TIMEFRAMES.length}`,
  };
};

const resolveDashboardSummary = (snapshotEntry) => {
  const snapshot = snapshotEntry?.snapshot || null;
  if (!snapshot) {
    return {
      timeframe: null,
      trendDirection: null,
      signalDirection: null,
      trendAgeBars: null,
      trendAgeBucket: null,
      strength: null,
      adx: null,
      volatilityScore: null,
      mtf: [],
      filterState: null,
    };
  }
  return {
    timeframe: snapshotEntry.timeframe || null,
    trendDirection: snapshot.trendDirection || null,
    signalDirection: normalizeIndicatorDirection(snapshot.trendDirection),
    trendAgeBars: Number.isFinite(Number(snapshot.trendAgeBars))
      ? Number(snapshot.trendAgeBars)
      : null,
    trendAgeBucket: snapshot.trendAgeBucket || null,
    strength: snapshot.strength || null,
    adx: Number.isFinite(Number(snapshot.adx)) ? Number(snapshot.adx) : null,
    volatilityScore: Number.isFinite(Number(snapshot.volatilityScore))
      ? Number(snapshot.volatilityScore)
      : null,
    mtf: Array.isArray(snapshot.mtf) ? snapshot.mtf : [],
    filterState: snapshot.filterState || null,
  };
};

const clampScore = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, Math.round(numeric)));
};

const uniqueReasonCodes = (reasonCodes) =>
  Array.from(new Set(reasonCodes.filter(Boolean)));

const hasComputedMatrixState = (state) =>
  Boolean(
    state &&
      isSignalStateCurrent(state) &&
      (state.latestBarAt || state.currentSignalAt),
  );

const preferPrimaryMatrixFallback = (currentState, primaryState) => {
  const primaryComputed = hasComputedMatrixState(primaryState);
  if (!primaryComputed) return currentState || null;
  const currentComputed = hasComputedMatrixState(currentState);
  if (!currentComputed) return primaryState;
  return preferLatestState(currentState, primaryState) === primaryState
    ? primaryState
    : currentState;
};

export const signalPrimaryStateForMatrix = (signal) => ({
  symbol: signal?.symbol,
  timeframe: signal?.timeframe,
  trendDirection: signal?.trendDirection ?? null,
  currentSignalDirection: signal?.currentSignalDirection || signal?.direction,
  currentSignalAt: signal?.currentSignalAt || signal?.signalAt,
  currentSignalPrice: signal?.currentSignalPrice ?? signal?.price ?? null,
  currentSignalClose: signal?.currentSignalClose ?? signal?.close ?? null,
  currentSignalMfePercent: signal?.currentSignalMfePercent ?? null,
  currentSignalMaePercent: signal?.currentSignalMaePercent ?? null,
  latestBarAt: signal?.latestBarAt || signal?.signalAt || null,
  barsSinceSignal: signal?.barsSinceSignal,
  fresh: signal?.fresh,
  status: signal?.status || "ok",
  active: signal?.active ?? true,
  lastEvaluatedAt: signal?.lastEvaluatedAt || signal?.signalAt || null,
});

export const hydrateSignalMatrixProfileTimeframe = ({
  matrixStatesByTimeframe,
  primaryState,
  profileTimeframe,
  includePrimaryFallback = true,
}) => {
  if (!includePrimaryFallback) {
    return matrixStatesByTimeframe || {};
  }
  const timeframe = String(primaryState?.timeframe || profileTimeframe || "").trim();
  if (!SIGNALS_TABLE_TIMEFRAMES.includes(timeframe)) {
    return matrixStatesByTimeframe || {};
  }
  const currentState = matrixStatesByTimeframe?.[timeframe] || null;
  const nextState = preferPrimaryMatrixFallback(currentState, primaryState);
  if (nextState === currentState) {
    return matrixStatesByTimeframe || {};
  }
  return {
    ...(matrixStatesByTimeframe || {}),
    [timeframe]: nextState,
  };
};

const oppositeDirection = (direction) =>
  direction === "buy" ? "sell" : direction === "sell" ? "buy" : null;

const weightedDirection = (entries, direction) =>
  entries
    .filter((entry) => entry.direction === direction)
    .reduce((sum, entry) => sum + entry.weight, 0);

const entryForTimeframe = (entries, timeframe) =>
  entries.find((entry) => entry.timeframe === timeframe) || null;

const directionFromWeightedEntries = (entries, fallbackDirection = null) => {
  const buyWeight = weightedDirection(entries, "buy");
  const sellWeight = weightedDirection(entries, "sell");
  if (buyWeight > sellWeight) return "buy";
  if (sellWeight > buyWeight) return "sell";
  return buyWeight || sellWeight ? fallbackDirection : null;
};

const buildSignalMatrixVerdictLabel = ({
  direction,
  tradeReadiness,
  regime,
}) => {
  const readinessLabel = {
    ready: "Ready",
    watch: "Watch",
    wait: "Wait",
    avoid: "Avoid",
  }[tradeReadiness] || "Wait";
  if (!direction) return readinessLabel;
  const directionLabel = direction === "buy" ? "Buy" : "Sell";
  const regimeLabel = {
    bull_trend: "trend",
    bear_trend: "trend",
    pullback: "pullback",
    reversal_attempt: "reversal",
    mixed: "mixed",
    no_data: "pending",
  }[regime] || "signal";
  return `${readinessLabel} ${directionLabel} ${regimeLabel}`;
};

const getMtfGateSignalDirection = (state) => {
  if (!state || state.active === false) return "";
  // Gate on the cell's CURRENT trend (bullish/bearish), mirroring the backend
  // entry gate. The backend re-evaluates trendDirection every bar and trades on
  // it (getTrendDirectionsForSymbol -> evaluateSignalOptionsEntryGate), whereas
  // currentSignalDirection is a sparse crossover that latches stale values. The
  // top-level trendDirection is authored on both transports (REST symbol state
  // and the matrix stream's wire boundary); fall back to the indicator snapshot
  // for stream cells that predate the top-level field.
  return normalizeTrendSignalDirection(
    state.trendDirection ?? state.indicatorSnapshot?.trendDirection,
  );
};

// Frontend mirror of the backend signal-options MTF entry gate
// (signal-options-automation.ts evaluateSignalOptionsEntryGate). For the
// CONFIGURED MTF timeframes, count how many frames' CURRENT trend agrees with
// the signal direction, using the same trendDirection source the backend entry
// gate trades on. A frame with no current trend is neutral and cannot satisfy
// the selected-frame confluence contract (consistent with the backend's
// trendDirectionToSignalDirection(null)). Aligned when matches >= requiredCount,
// matching the gate that actually decides entries.
export const resolveConfiguredMtfAlignment = ({
  matrixStatesByTimeframe = {},
  signalDirection = null,
  timeframes = [],
  requiredCount = null,
  enabled = true,
} = {}) => {
  const direction = normalizeSignalDirection(signalDirection);
  const frames = Array.isArray(timeframes)
    ? timeframes.map((timeframe) => String(timeframe || "").trim()).filter(Boolean)
    : [];
  if (enabled === false || !frames.length || !direction) {
    return {
      applicable: false,
      aligned: true,
      direction: direction || null,
      matches: 0,
      opposing: 0,
      neutral: frames.length,
      total: frames.length,
      required: 0,
      opposingTimeframes: [],
    };
  }
  const required = Math.min(
    frames.length,
    Math.max(1, Math.round(Number(requiredCount) || 2)),
  );
  let matches = 0;
  let opposing = 0;
  let neutral = 0;
  const opposingTimeframes = [];
  for (const timeframe of frames) {
    const tfDirection = getMtfGateSignalDirection(
      matrixStatesByTimeframe?.[timeframe],
    );
    if (!tfDirection) {
      neutral += 1;
    } else if (tfDirection === direction) {
      matches += 1;
    } else {
      opposing += 1;
      opposingTimeframes.push(timeframe);
    }
  }
  return {
    applicable: true,
    aligned: matches >= required,
    direction,
    matches,
    opposing,
    neutral,
    total: frames.length,
    required,
    opposingTimeframes,
  };
};

export const resolveSignalMatrixVerdict = ({
  primaryState = null,
  matrixStatesByTimeframe = {},
  dashboardSummary = null,
  profileTimeframe = null,
  timeframes = SIGNALS_TABLE_TIMEFRAMES,
  includePrimaryFallback = true,
} = {}) => {
  const matrixTimeframes = normalizeSignalMatrixTimeframes(timeframes);
  const totalWeight = signalMatrixTotalWeight(matrixTimeframes);
  const hydratedMatrixStatesByTimeframe = hydrateSignalMatrixProfileTimeframe({
    matrixStatesByTimeframe,
    primaryState,
    profileTimeframe,
    includePrimaryFallback,
  });
  const entries = matrixTimeframes.map((timeframe) => {
    const state = hydratedMatrixStatesByTimeframe?.[timeframe] || null;
    const direction = getCurrentSignalDirection(state) || null;
    const current = isSignalStateCurrent(state);
    const problem = isProblemSignalState(state);
    return {
      timeframe,
      state,
      direction,
      current,
      problem,
      computed: hasComputedMatrixState(state),
      fresh: isCurrentFreshSignalState(state),
      weight: SIGNAL_MATRIX_TIMEFRAME_WEIGHTS[timeframe] || 0,
    };
  });
  const reasonCodes = [];
  const primaryDirection = getCurrentSignalDirection(primaryState) || null;
  const currentComputedEntries = entries.filter(
    (entry) => entry.current && entry.computed && !entry.problem,
  );
  const activeEntries = entries.filter(
    (entry) => entry.current && entry.direction && !entry.problem,
  );
  const hasProblem = entries.some((entry) => entry.problem);
  const activeWeight = activeEntries.reduce((sum, entry) => sum + entry.weight, 0);
  const freshWeight = activeEntries
    .filter((entry) => entry.fresh)
    .reduce((sum, entry) => sum + entry.weight, 0);
  const freshnessScore = clampScore(
    totalWeight ? (freshWeight / totalWeight) * 100 : 0,
  );
  const requiredCurrentEntryCount = Math.min(2, matrixTimeframes.length);

  if (
    currentComputedEntries.length < requiredCurrentEntryCount ||
    activeEntries.length === 0
  ) {
    const verdict = {
      direction: null,
      regime: "no_data",
      transition: "pending",
      alignmentScore: 0,
      freshnessScore,
      readinessScore: 0,
      tradeReadiness: "avoid",
      riskPosture: "exit_watch",
      reasonCodes: uniqueReasonCodes([
        "insufficient_matrix_data",
        hasProblem ? "matrix_problem" : null,
      ]),
    };
    return {
      ...verdict,
      label: buildSignalMatrixVerdictLabel(verdict),
      detail: "Signal matrix needs at least two current intervals before it can explain a bias.",
    };
  }

  const buyWeight = weightedDirection(activeEntries, "buy");
  const sellWeight = weightedDirection(activeEntries, "sell");
  const executionEntry = entryForTimeframe(entries, SIGNAL_MATRIX_EXECUTION_TIMEFRAME);
  const profileEntry = profileTimeframe
    ? entryForTimeframe(entries, profileTimeframe)
    : null;
  const fallbackDirection =
    executionEntry?.direction ||
    profileEntry?.direction ||
    primaryDirection ||
    dashboardSummary?.signalDirection ||
    null;
  const direction = directionFromWeightedEntries(activeEntries, fallbackDirection);
  const opposingDirection = oppositeDirection(direction);
  const dominantWeight = direction === "buy" ? buyWeight : direction === "sell" ? sellWeight : 0;
  const opposingWeight = opposingDirection
    ? weightedDirection(activeEntries, opposingDirection)
    : 0;
  const alignmentScore = clampScore(
    totalWeight
      ? (dominantWeight / totalWeight) * 100
      : 0,
  );
  const lowerEntries = activeEntries.filter((entry) =>
    SIGNAL_MATRIX_LOWER_TIMEFRAMES.includes(entry.timeframe),
  );
  const higherEntries = activeEntries.filter((entry) =>
    SIGNAL_MATRIX_HIGHER_TIMEFRAMES.includes(entry.timeframe),
  );
  const higherBias = directionFromWeightedEntries(higherEntries, null);
  const lowerBias = directionFromWeightedEntries(lowerEntries, null);
  const fiveMinuteAligned = Boolean(
    direction && executionEntry?.direction === direction,
  );
  const profileAligned = Boolean(direction && profileEntry?.direction === direction);
  const higherAlignedCount = higherEntries.filter(
    (entry) => entry.direction === direction,
  ).length;
  const higherOpposingCount = higherEntries.filter(
    (entry) => entry.direction === opposingDirection,
  ).length;
  const lowerAlignedCount = lowerEntries.filter(
    (entry) => entry.direction === direction,
  ).length;
  const lowerOpposingCount = lowerEntries.filter(
    (entry) => entry.direction === opposingDirection,
  ).length;
  const dashboardMtfBlocked = (dashboardSummary?.mtf || []).some(
    (entry) => entry?.required && entry.pass === false,
  );
  const confirmationEntryCount = Math.min(4, matrixTimeframes.length);
  const higherConfirmationCount = Math.min(2, higherEntries.length);

  let regime = "mixed";
  if (!direction || buyWeight === sellWeight) {
    regime = "mixed";
  } else if (
    higherBias &&
    higherBias !== direction &&
    fiveMinuteAligned &&
    lowerAlignedCount > 0
  ) {
    regime = "reversal_attempt";
  } else if (
    higherBias === direction &&
    fiveMinuteAligned &&
    lowerOpposingCount > 0
  ) {
    regime = "pullback";
  } else if (direction === "buy" && fiveMinuteAligned && higherAlignedCount > 0) {
    regime = "bull_trend";
  } else if (direction === "sell" && fiveMinuteAligned && higherAlignedCount > 0) {
    regime = "bear_trend";
  } else if (opposingWeight > 0 || higherOpposingCount > 0) {
    regime = "mixed";
  } else {
    regime = direction === "buy" ? "bull_trend" : "bear_trend";
  }

  const confirmed = Boolean(
    direction &&
      regime !== "mixed" &&
      regime !== "reversal_attempt" &&
      opposingWeight === 0 &&
      (activeEntries.length >= confirmationEntryCount ||
        (fiveMinuteAligned &&
          higherConfirmationCount > 0 &&
          higherAlignedCount >= higherConfirmationCount)),
  );
  let transition = "building";
  if (regime === "mixed") {
    transition = "conflicted";
  } else if (confirmed) {
    transition = "confirmed";
  } else if (regime === "pullback") {
    transition = "fading";
  } else if (
    higherBias === direction &&
    (lowerBias === opposingDirection || lowerOpposingCount > 0)
  ) {
    transition = "fading";
  }

  if (confirmed) reasonCodes.push("matrix_confirmed");
  if (fiveMinuteAligned || profileAligned) reasonCodes.push("execution_frame_aligned");
  if (higherAlignedCount > 0) reasonCodes.push("higher_timeframe_aligned");
  if (regime === "pullback" || (higherBias === direction && lowerOpposingCount > 0)) {
    reasonCodes.push("lower_frame_pullback");
  }
  if (regime === "reversal_attempt") reasonCodes.push("reversal_attempt");
  if (regime === "mixed" || buyWeight === sellWeight) reasonCodes.push("mixed_timeframes");
  if (freshnessScore < 60) reasonCodes.push("freshness_weak");
  if (dashboardMtfBlocked) reasonCodes.push("dashboard_mtf_block");
  if (hasProblem) reasonCodes.push("matrix_problem");

  const confirmationScore =
    transition === "confirmed"
      ? 100
      : transition === "building"
        ? 65
        : transition === "fading"
          ? 45
          : 20;
  const structuralPenalty =
    (fiveMinuteAligned ? 0 : 10) +
    (dashboardMtfBlocked ? 10 : 0) +
    (hasProblem ? 15 : 0) +
    (regime === "pullback" ? 15 : 0);
  const readinessScore = clampScore(
    alignmentScore * 0.5 +
      freshnessScore * 0.25 +
      confirmationScore * 0.25 -
      structuralPenalty,
  );

  let tradeReadiness = "wait";
  if (
    regime === "mixed" ||
    transition === "conflicted" ||
    hasProblem ||
    freshnessScore < 30
  ) {
    tradeReadiness = "avoid";
  } else if (regime === "pullback" || transition === "fading") {
    tradeReadiness = "wait";
  } else if (
    readinessScore >= 75 &&
    (transition === "confirmed" || transition === "building") &&
    fiveMinuteAligned &&
    higherAlignedCount > 0
  ) {
    tradeReadiness = "ready";
  } else if (readinessScore >= 50 && transition === "building") {
    tradeReadiness = "watch";
  }

  let riskPosture = "normal";
  if (tradeReadiness === "avoid" || transition === "conflicted") {
    riskPosture = "exit_watch";
  } else if (
    regime === "pullback" ||
    regime === "reversal_attempt" ||
    transition === "fading" ||
    higherOpposingCount > 0 ||
    lowerOpposingCount > 0
  ) {
    riskPosture = "tighten";
  }

  const verdict = {
    direction,
    regime,
    transition,
    alignmentScore,
    freshnessScore,
    readinessScore,
    tradeReadiness,
    riskPosture,
    reasonCodes: uniqueReasonCodes(reasonCodes),
  };
  return {
    ...verdict,
    label: buildSignalMatrixVerdictLabel(verdict),
    detail: [
      `${alignmentScore}% aligned`,
      `${freshnessScore}% fresh`,
      `${readinessScore}% ready`,
    ].join(" · "),
  };
};

const resolveMatrixStatus = (matrixStatesByTimeframe = {}) => {
  const states = Object.values(matrixStatesByTimeframe || {});
  const hasProblem = states.some(
    (state) => isProblemSignalState(state) && !isStaleSignalState(state),
  );
  const hasIdle = states.some(isIdleSignalState);
  const hasStale = states.some(isStaleSignalState);
  const hasFresh = states.some(isCurrentFreshSignalState);
  const hasComputed = states.some((state) =>
    Boolean(
      (isSignalStateCurrent(state) ||
        isIdleSignalState(state) ||
        isStaleSignalState(state)) &&
        (state?.latestBarAt || state?.currentSignalAt),
    ),
  );
  const hasCurrentComputed = states.some((state) =>
    Boolean(
      isSignalStateCurrent(state) && (state?.latestBarAt || state?.currentSignalAt),
    ),
  );

  return {
    hasProblem,
    hasIdle,
    hasStale,
    hasFresh,
    hasComputed,
    hasCurrentComputed,
  };
};

const resolveRowStatus = ({
  primaryState,
  matrixStatus,
  direction,
  skipped,
}) => {
  const status = normalizeSignalStatus(primaryState);
  const primaryIdle = IDLE_STATUSES.has(status);
  const primaryStale = STALE_STATUSES.has(status);
  const hasProblem = isProblemSignalState(primaryState) && !primaryStale;

  if (hasProblem || (!primaryState && matrixStatus?.hasProblem)) {
    return SIGNALS_ROW_STATUS.problem;
  }
  if (!primaryState) {
    if (direction) {
      if (matrixStatus?.hasFresh) return SIGNALS_ROW_STATUS.activeFresh;
      if (matrixStatus?.hasIdle && !matrixStatus?.hasCurrentComputed) {
        return SIGNALS_ROW_STATUS.activeIdle;
      }
      return SIGNALS_ROW_STATUS.activeStale;
    }
    if (skipped) {
      return SIGNALS_ROW_STATUS.skipped;
    }
    return SIGNALS_ROW_STATUS.pending;
  }
  if (direction && isSignalStateCurrent(primaryState)) {
    return primaryState.fresh
      ? SIGNALS_ROW_STATUS.activeFresh
      : SIGNALS_ROW_STATUS.activeStale;
  }
  if (primaryIdle) {
    return direction
      ? SIGNALS_ROW_STATUS.activeIdle
      : SIGNALS_ROW_STATUS.neutral;
  }
  if (primaryStale) {
    return direction
      ? SIGNALS_ROW_STATUS.activeStale
      : SIGNALS_ROW_STATUS.neutral;
  }
  return SIGNALS_ROW_STATUS.neutral;
};

const statusLabelFor = (status) => {
  switch (status) {
    case SIGNALS_ROW_STATUS.activeFresh:
      return "Fresh signal";
    case SIGNALS_ROW_STATUS.activeIdle:
      return "Market idle";
    case SIGNALS_ROW_STATUS.activeStale:
      return "Aged signal";
    case SIGNALS_ROW_STATUS.problem:
      return "Needs attention";
    case SIGNALS_ROW_STATUS.skipped:
      return "Scan pending";
    case SIGNALS_ROW_STATUS.pending:
      return "Computing";
    default:
      return "No signal";
  }
};

const coverageReasonFor = ({
  rowStatus,
  primaryState,
  skipped,
  matrixStatus,
}) => {
  if (primaryState && normalizeSignalStatus(primaryState) === "idle") {
    return "No recent market print; last signal retained";
  }
  if (primaryState && normalizeSignalStatus(primaryState) === "stale") {
    return "Stored monitor state is aged; waiting for current market bars";
  }
  if (primaryState?.lastError) return primaryState.lastError;
  if (rowStatus === SIGNALS_ROW_STATUS.problem) return "Signal computation unavailable";
  if (matrixStatus?.hasStale && !matrixStatus?.hasCurrentComputed) {
    return "Waiting for current market bars";
  }
  if (matrixStatus?.hasIdle && !matrixStatus?.hasCurrentComputed) {
    return "No recent market print; last signal retained";
  }
  if (!primaryState && matrixStatus?.hasComputed) {
    return "Computed from market bars; primary monitor scan pending";
  }
  if (!primaryState && skipped) {
    return "Primary monitor scan pending";
  }
  if (primaryState && skipped) {
    return "Stored primary state present; interval matrix hydrates from market bars";
  }
  if (!primaryState) return "Waiting for market-data signal computation";
  return "Primary state stored; intervals hydrate from market bars";
};

export const buildSignalsRows = ({
  stateResponse,
  matrixStates = [],
  events = [],
  watchlists = [],
} = {}) => {
  const states = stateResponse?.states || [];
  const universeSymbols = stateResponse?.universeSymbols || [];
  const skippedSymbols = new Set(
    (Array.isArray(stateResponse?.skippedSymbols) ? stateResponse.skippedSymbols : [])
      .map(normalizeSignalsTicker)
      .filter(Boolean),
  );
  const responseProfileTimeframe = String(
    stateResponse?.profile?.timeframe || "",
  ).trim();
  const primaryStatesBySymbol = buildPrimaryStateMap(
    states,
    SIGNALS_TABLE_TIMEFRAMES.includes(responseProfileTimeframe)
      ? responseProfileTimeframe
      : null,
  );
  const matrixStatesBySymbol = buildSignalMatrixStatesBySymbol([
    ...matrixStates,
    ...states,
  ]);
  const latestEventsBySymbol = buildLatestEventsBySymbol(events);
  const watchlistMembership = buildWatchlistMembership(watchlists);
  const trackedSymbols = buildTrackedSymbols({
    universeSymbols,
    skippedSymbols: stateResponse?.skippedSymbols,
    states,
    matrixStates,
    events,
  });

  return sortSignalsRows(
    trackedSymbols.map((symbol, index) => {
      const primaryState = primaryStatesBySymbol.get(symbol) || null;
      const profileTimeframe = stateResponse?.profile?.timeframe || primaryState?.timeframe || null;
      const matrixStatesByTimeframe = hydrateSignalMatrixProfileTimeframe({
        matrixStatesByTimeframe: matrixStatesBySymbol.get(symbol) || {},
        primaryState,
        profileTimeframe,
      });
      const matrixStatus = resolveMatrixStatus(matrixStatesByTimeframe);
      const stackSummary = resolveStackSummary(matrixStatesByTimeframe);
      const dashboardSummary = resolveDashboardSummary(
        resolveDashboardSnapshot({
          matrixStatesByTimeframe,
          profileTimeframe,
        }),
      );
      const matrixVerdict = resolveSignalMatrixVerdict({
        primaryState,
        matrixStatesByTimeframe,
        dashboardSummary,
        profileTimeframe,
      });
      const latestEvent = latestEventsBySymbol.get(symbol) || null;
      // Every tracked symbol has a current trend (bullish/bearish). The crossover
      // (resolveDirection) is a sparse EVENT and is null when none is in window —
      // so fall back to the indicator's current trend so the row shows buy/sell
      // instead of a blank. Freshness and the backend `actionEligible` gate stay
      // crossover-driven (a trend-only row is shown but is NOT auto-tradeable —
      // actionEligible requires a signalAt, which a trend-only row lacks).
      const direction =
        resolveDirection({
          primaryState,
          matrixStatesByTimeframe,
        }) ||
        dashboardSummary?.signalDirection ||
        null;
      const currentPrimaryState = isSignalStateCurrent(primaryState)
        ? primaryState
        : null;
      const currentMatrixSignalState = Object.values(matrixStatesByTimeframe)
        .filter(hasCurrentSignalDirection)
        .reduce((latest, state) => preferLatestState(latest, state), null);
      const skipped = skippedSymbols.has(symbol);
      const rowStatus = resolveRowStatus({
        primaryState,
        matrixStatus,
        direction,
        skipped,
      });
      const activeTimeframes = SIGNALS_TABLE_TIMEFRAMES.filter((timeframe) => {
        const matrixState = matrixStatesByTimeframe[timeframe];
        return hasCurrentSignalDirection(matrixState);
      });
      const freshTimeframes = activeTimeframes.filter(
        (timeframe) => isCurrentFreshSignalState(matrixStatesByTimeframe[timeframe]),
      );
      const activityMs = Math.max(
        stateActivityMs(primaryState),
        eventActivityMs(latestEvent),
        ...Object.values(matrixStatesByTimeframe).map(stateActivityMs),
      );
      const displaySignalAt =
        currentPrimaryState?.currentSignalAt ||
        currentMatrixSignalState?.currentSignalAt ||
        latestEvent?.signalAt ||
        null;
      const displaySignalPrice =
        typeof currentPrimaryState?.currentSignalPrice === "number"
          ? currentPrimaryState.currentSignalPrice
          : typeof currentMatrixSignalState?.currentSignalPrice === "number"
            ? currentMatrixSignalState.currentSignalPrice
            : typeof latestEvent?.signalPrice === "number"
              ? latestEvent.signalPrice
              : typeof latestEvent?.close === "number"
                ? latestEvent.close
                : null;
      const signalActivityMs = timestampMs(displaySignalAt);
      const membership = watchlistMembership.get(symbol) || {
        watchlistIds: [],
        watchlistLabels: [],
      };

      return {
        id: `signal-${symbol}`,
        symbol,
        universeRank: index + 1,
        profileTimeframe,
        primaryState,
        matrixStatesByTimeframe,
        stackSummary,
        dashboardSummary,
        matrixVerdict,
        latestEvent,
        watchlistIds: membership.watchlistIds,
        watchlistLabels: membership.watchlistLabels,
        direction,
        status: rowStatus,
        statusLabel: statusLabelFor(rowStatus),
        statusWeight: STATUS_SORT_WEIGHT[rowStatus] ?? 99,
        coverageReason: coverageReasonFor({
          rowStatus,
          primaryState,
          skipped,
          matrixStatus,
        }),
        skipped,
        pending: rowStatus === SIGNALS_ROW_STATUS.pending,
        problem: rowStatus === SIGNALS_ROW_STATUS.problem,
        fresh: Boolean(isCurrentFreshSignalState(primaryState) || matrixStatus.hasFresh),
        active: Boolean(primaryState?.active),
        activeTimeframes,
        freshTimeframes,
        activeTimeframeCount: activeTimeframes.length,
        freshTimeframeCount: freshTimeframes.length,
        barsSinceSignal: Number.isFinite(Number(currentPrimaryState?.barsSinceSignal))
          ? Number(currentPrimaryState.barsSinceSignal)
          : Number.isFinite(Number(currentMatrixSignalState?.barsSinceSignal))
            ? Number(currentMatrixSignalState.barsSinceSignal)
            : null,
        currentSignalAt: displaySignalAt,
        currentSignalPrice: displaySignalPrice,
        currentSignalClose:
          currentPrimaryState?.currentSignalClose ??
          currentMatrixSignalState?.currentSignalClose ??
          latestEvent?.close ??
          null,
        currentSignalMfePercent:
          currentPrimaryState?.currentSignalMfePercent ??
          currentMatrixSignalState?.currentSignalMfePercent ??
          null,
        currentSignalMaePercent:
          currentPrimaryState?.currentSignalMaePercent ??
          currentMatrixSignalState?.currentSignalMaePercent ??
          null,
        latestBarAt:
          primaryState?.latestBarAt ||
          Object.values(matrixStatesByTimeframe)
            .map((state) => state?.latestBarAt)
            .filter(Boolean)
            .sort()
            .at(-1) ||
          null,
        lastEvaluatedAt:
          primaryState?.lastEvaluatedAt ||
          Object.values(matrixStatesByTimeframe)
            .map((state) => state?.lastEvaluatedAt)
            .filter(Boolean)
            .sort()
            .at(-1) ||
          null,
        lastError:
          primaryState?.lastError ||
          Object.values(matrixStatesByTimeframe).find((state) => state?.lastError)
            ?.lastError ||
          null,
        activityMs,
        signalActivityMs,
      };
    }),
  );
};

export const sortSignalsRows = (
  rows = [],
  { sortKey = "priority", direction = "asc" } = {},
) => {
  const multiplier = direction === "desc" ? -1 : 1;
  const sorted = [...(Array.isArray(rows) ? rows : [])];
  const fallbackCompare = (left, right) => {
    const statusDelta = (left.statusWeight ?? 99) - (right.statusWeight ?? 99);
    if (statusDelta) return statusDelta;
    const directionDelta =
      (DIRECTION_SORT_WEIGHT[left.direction] ?? 9) -
      (DIRECTION_SORT_WEIGHT[right.direction] ?? 9);
    if (directionDelta) return directionDelta;
    const latestDelta =
      (right.signalActivityMs || 0) - (left.signalActivityMs || 0);
    if (latestDelta) return latestDelta;
    return (
      (left.universeRank ?? Number.POSITIVE_INFINITY) -
        (right.universeRank ?? Number.POSITIVE_INFINITY) ||
      left.symbol.localeCompare(right.symbol)
    );
  };
  sorted.sort((left, right) => {
    if (sortKey === "symbol") {
      return multiplier * left.symbol.localeCompare(right.symbol);
    }
    if (sortKey === "rank") {
      return (
        compareNumberAsc(left.universeRank, right.universeRank, multiplier) ||
        fallbackCompare(left, right)
      );
    }
    if (sortKey === "signal" || sortKey === "priority") {
      return fallbackCompare(left, right);
    }
    if (sortKey === "stack") {
      return (
        compareNumberDesc(
          left.stackSummary?.activeCount,
          right.stackSummary?.activeCount,
          multiplier,
        ) ||
        compareNumberDesc(
          left.stackSummary?.freshCount,
          right.stackSummary?.freshCount,
          multiplier,
        ) ||
        fallbackCompare(left, right)
      );
    }
    if (sortKey === "verdict") {
      return (
        compareNumberDesc(
          left.matrixVerdict?.readinessScore,
          right.matrixVerdict?.readinessScore,
          multiplier,
        ) ||
        compareText(left.matrixVerdict?.regime, right.matrixVerdict?.regime, multiplier) ||
        fallbackCompare(left, right)
      );
    }
    if (String(sortKey || "").startsWith("tf-")) {
      const timeframe = String(sortKey).slice(3);
      const leftState = matrixSortState(left, timeframe);
      const rightState = matrixSortState(right, timeframe);
      const leftComputed = hasComputedMatrixState(leftState) ? 1 : 0;
      const rightComputed = hasComputedMatrixState(rightState) ? 1 : 0;
      const computedDelta = rightComputed - leftComputed;
      return (
        computedDelta ||
        // Rank by signal-fire recency (currentSignalAt), NOT stateActivityMs:
        // every live lane ticks lastEvaluatedAt/latestBarAt to ~now, so
        // stateActivityMs lets a constantly-updating but STALE-signal lane (e.g.
        // FENC, 34 bars old) outrank a freshly-fired one (e.g. FCPT/TSM). A
        // timeframe-column sort must order by when that timeframe's signal
        // actually fired — see the stateSignalMs note above. No-signal cells get
        // signalMs=0 and fall to the bottom.
        compareNumberDesc(
          stateSignalMs(leftState),
          stateSignalMs(rightState),
          multiplier,
        ) ||
        compareNumberAsc(
          leftState?.barsSinceSignal,
          rightState?.barsSinceSignal,
          multiplier,
        ) ||
        compareText(
          getCurrentSignalDirection(leftState),
          getCurrentSignalDirection(rightState),
          multiplier,
        ) ||
        fallbackCompare(left, right)
      );
    }
    if (sortKey === "trend") {
      return (
        compareText(
          left.dashboardSummary?.trendDirection,
          right.dashboardSummary?.trendDirection,
          multiplier,
        ) || fallbackCompare(left, right)
      );
    }
    if (sortKey === "strength") {
      return (
        compareNumberDesc(
          strengthSortValue(left.dashboardSummary?.strength),
          strengthSortValue(right.dashboardSummary?.strength),
          multiplier,
        ) || fallbackCompare(left, right)
      );
    }
    if (sortKey === "age") {
      return (
        compareNumberAsc(
          left.dashboardSummary?.trendAgeBars,
          right.dashboardSummary?.trendAgeBars,
          multiplier,
        ) || fallbackCompare(left, right)
      );
    }
    if (sortKey === "vol") {
      return (
        compareNumberDesc(
          left.dashboardSummary?.volatilityScore,
          right.dashboardSummary?.volatilityScore,
          multiplier,
        ) || fallbackCompare(left, right)
      );
    }
    if (sortKey === "mtf") {
      return (
        compareNumberDesc(mtfPassCount(left), mtfPassCount(right), multiplier) ||
        fallbackCompare(left, right)
      );
    }
    if (sortKey === "bars") {
      return (
        compareNumberAsc(left.barsSinceSignal, right.barsSinceSignal, multiplier) ||
        fallbackCompare(left, right)
      );
    }
    if (sortKey === "price") {
      return (
        compareNumberAsc(
          left.currentSignalPrice,
          right.currentSignalPrice,
          multiplier,
        ) || fallbackCompare(left, right)
      );
    }
    if (sortKey === "latest") {
      return (
        multiplier *
        ((right.signalActivityMs || 0) - (left.signalActivityMs || 0))
      );
    }
    if (sortKey === "coverage") {
      return (
        compareText(left.coverageReason, right.coverageReason, multiplier) ||
        fallbackCompare(left, right)
      );
    }
    return fallbackCompare(left, right);
  });
  return sorted;
};

export const filterSignalsRows = (
  rows = [],
  { query = "", status = "all", direction = "all" } = {},
) => {
  const normalizedQuery = normalizeSignalsTicker(query);
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (normalizedQuery && !row.symbol.includes(normalizedQuery)) {
      return false;
    }
    if (status !== "all" && row.status !== status) {
      return false;
    }
    if (direction !== "all" && row.direction !== direction) {
      return false;
    }
    return true;
  });
};

export const summarizeSignalsRows = (rows = []) => {
  const summary = {
    total: 0,
    fresh: 0,
    active: 0,
    buy: 0,
    sell: 0,
    problem: 0,
    skipped: 0,
    pending: 0,
  };
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    summary.total += 1;
    if (row.fresh) summary.fresh += 1;
    if (row.direction === "buy" || row.direction === "sell") {
      summary.active += 1;
    }
    if (row.direction === "buy") summary.buy += 1;
    if (row.direction === "sell") summary.sell += 1;
    if (row.problem) summary.problem += 1;
    if (row.status === SIGNALS_ROW_STATUS.skipped) summary.skipped += 1;
    if (row.pending) summary.pending += 1;
  });
  return summary;
};

export const summarizeSignalsNetBias = (rows = []) => {
  const summary = summarizeSignalsRows(rows);
  const buy = summary.buy;
  const sell = summary.sell;
  const total = buy + sell;
  const net = buy - sell;
  const direction =
    net > 0 ? "buy" : net < 0 ? "sell" : total ? "mixed" : null;
  const strength = total ? Math.abs(net) / total : 0;
  const label =
    direction === "buy"
      ? `Buy +${net}`
      : direction === "sell"
        ? `Sell +${Math.abs(net)}`
        : total
          ? "Balanced"
          : "No signals";
  return {
    buy,
    sell,
    total,
    net,
    direction,
    strength,
    label,
  };
};

export const SIGNALS_BREADTH_HISTORY_RANGES = Object.freeze([
  "hour",
  "day",
  "week",
  "month",
]);

const normalizeBreadthHistoryRange = (value) => {
  const normalized = String(value || "").trim();
  return SIGNALS_BREADTH_HISTORY_RANGES.includes(normalized) ? normalized : "day";
};

const normalizeBreadthPoints = (rawPoints) =>
  (Array.isArray(rawPoints) ? rawPoints : [])
    .map((point) => {
      const at = isoTimestampOrNull(point?.at);
      if (!at) return null;
      const buy = normalizedBreadthCount(point?.buy);
      const sell = normalizedBreadthCount(point?.sell);
      const total = normalizedBreadthCount(point?.total ?? buy + sell);
      const netValue = Number(point?.net);
      const net = Number.isFinite(netValue) ? Math.round(netValue) : buy - sell;
      return { at, buy, sell, net, total };
    })
    .filter(Boolean);

const isoTimestampOrNull = (value) => {
  const ms = timestampMs(value);
  return ms ? new Date(ms).toISOString() : null;
};

const normalizedBreadthCount = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
};

export const normalizeSignalsBreadthHistory = (history = null) => {
  const points = normalizeBreadthPoints(history?.points);
  const buyTotal = points.reduce((sum, point) => sum + point.buy, 0);
  const sellTotal = points.reduce((sum, point) => sum + point.sell, 0);
  const net = buyTotal - sellTotal;
  const total = buyTotal + sellTotal;
  const pointsByTimeframe = {};
  (Array.isArray(history?.timeframes) ? history.timeframes : []).forEach((series) => {
    const timeframe = String(series?.timeframe || "").trim().toLowerCase();
    if (!timeframe) return;
    pointsByTimeframe[timeframe] = normalizeBreadthPoints(series?.points);
  });
  return {
    range: normalizeBreadthHistoryRange(history?.range),
    from: isoTimestampOrNull(history?.from),
    to: isoTimestampOrNull(history?.to),
    generatedAt: isoTimestampOrNull(history?.generatedAt),
    bucketMinutes: normalizedBreadthCount(history?.bucketMinutes),
    points,
    pointsByTimeframe,
    buyTotal,
    sellTotal,
    total,
    net,
    maxTotal: points.reduce((max, point) => Math.max(max, point.total), 0),
    maxAbsNet: points.reduce((max, point) => Math.max(max, Math.abs(point.net)), 0),
    direction: net > 0 ? "buy" : net < 0 ? "sell" : total ? "mixed" : null,
    empty: total === 0,
  };
};

export const resolveSignalDirectionFlipStates = (
  rows = [],
  previousDirectionsBySymbol = {},
) => {
  const nextDirectionsBySymbol = {};
  const flippedSymbols = new Set();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const symbol = normalizeSignalsTicker(row?.symbol);
    if (!symbol) return;
    const direction =
      row?.direction === "buy" || row?.direction === "sell"
        ? row.direction
        : "";
    const previous = previousDirectionsBySymbol?.[symbol] || "";
    if (previous && direction && previous !== direction) {
      flippedSymbols.add(symbol);
    }
    nextDirectionsBySymbol[symbol] = direction;
  });
  return {
    nextDirectionsBySymbol,
    flippedSymbols,
  };
};

export const summarizeSignalsTimeframeDirections = (
  rows = [],
  timeframes = SIGNALS_TABLE_TIMEFRAMES,
) => {
  const summaries = (Array.isArray(timeframes) ? timeframes : SIGNALS_TABLE_TIMEFRAMES)
    .map((timeframe) => ({
      timeframe,
      buy: 0,
      sell: 0,
      total: 0,
      fresh: 0,
      direction: null,
    }));

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    summaries.forEach((summary) => {
      const state = row?.matrixStatesByTimeframe?.[summary.timeframe] || null;
      const direction = getCurrentSignalDirection(state);
      if (direction !== "buy" && direction !== "sell") {
        return;
      }
      summary[direction] += 1;
      summary.total += 1;
      if (isCurrentFreshSignalState(state)) {
        summary.fresh += 1;
      }
    });
  });

  summaries.forEach((summary) => {
    summary.direction =
      summary.buy > summary.sell
        ? "buy"
        : summary.sell > summary.buy
          ? "sell"
          : summary.total
            ? "mixed"
            : null;
  });

  return summaries;
};
