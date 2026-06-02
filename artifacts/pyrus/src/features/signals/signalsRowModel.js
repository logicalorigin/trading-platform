import {
  getCurrentSignalDirection,
  hasCurrentSignalDirection,
  isCurrentFreshSignalState,
  isProblemSignalState,
  isSignalStateCurrent,
  isStaleSignalState,
  normalizeSignalStatus,
} from "./signalStateFreshness.js";

export const SIGNALS_TABLE_TIMEFRAMES = Object.freeze(["1m", "2m", "5m", "15m", "1h"]);

export const SIGNALS_ROW_STATUS = Object.freeze({
  activeFresh: "active-fresh",
  activeStale: "active-stale",
  problem: "problem",
  skipped: "skipped",
  pending: "pending",
  neutral: "neutral",
});

const STALE_STATUSES = new Set(["stale"]);
const STATUS_SORT_WEIGHT = Object.freeze({
  [SIGNALS_ROW_STATUS.activeFresh]: 0,
  [SIGNALS_ROW_STATUS.activeStale]: 1,
  [SIGNALS_ROW_STATUS.problem]: 2,
  [SIGNALS_ROW_STATUS.skipped]: 3,
  [SIGNALS_ROW_STATUS.pending]: 4,
  [SIGNALS_ROW_STATUS.neutral]: 5,
});

const DIRECTION_SORT_WEIGHT = Object.freeze({
  buy: 0,
  sell: 1,
});

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

const eventActivityMs = (event) =>
  Math.max(timestampMs(event?.emittedAt), timestampMs(event?.signalAt));

const preferLatestState = (left, right) => {
  if (!left) return right || null;
  if (!right) return left;
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

const buildPrimaryStateMap = (states = []) => {
  const bySymbol = new Map();
  (Array.isArray(states) ? states : []).forEach((state) => {
    const symbol = normalizeSignalsTicker(state?.symbol);
    if (!symbol) return;
    bySymbol.set(symbol, preferLatestState(bySymbol.get(symbol), state));
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
    current[timeframe] = preferLatestState(current[timeframe], state);
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
  states,
  matrixStates,
  events,
}) => {
  const seen = new Set();
  const symbols = [];
  (Array.isArray(universeSymbols) ? universeSymbols : []).forEach((symbol) =>
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
      : "0/5",
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

const resolveMatrixStatus = (matrixStatesByTimeframe = {}) => {
  const states = Object.values(matrixStatesByTimeframe || {});
  const hasProblem = states.some(isProblemSignalState);
  const hasStale = states.some(isStaleSignalState);
  const hasFresh = states.some(isCurrentFreshSignalState);
  const hasComputed = states.some((state) =>
    Boolean(
      state?.latestBarAt ||
        state?.lastEvaluatedAt ||
        state?.currentSignalAt ||
        state?.lastError,
    ),
  );
  const hasCurrentComputed = states.some((state) =>
    Boolean(
      isSignalStateCurrent(state) && (state?.latestBarAt || state?.lastEvaluatedAt),
    ),
  );

  return { hasProblem, hasStale, hasFresh, hasComputed, hasCurrentComputed };
};

const resolveRowStatus = ({
  primaryState,
  matrixStatus,
  direction,
}) => {
  const status = normalizeSignalStatus(primaryState);
  const hasProblem = isProblemSignalState(primaryState);

  if (hasProblem || (!primaryState && matrixStatus?.hasProblem)) {
    return SIGNALS_ROW_STATUS.problem;
  }
  if (!primaryState) {
    if (direction) {
      return matrixStatus?.hasFresh
        ? SIGNALS_ROW_STATUS.activeFresh
        : SIGNALS_ROW_STATUS.activeStale;
    }
    return SIGNALS_ROW_STATUS.pending;
  }
  if (direction && isSignalStateCurrent(primaryState)) {
    return primaryState.fresh
      ? SIGNALS_ROW_STATUS.activeFresh
      : SIGNALS_ROW_STATUS.activeStale;
  }
  if (STALE_STATUSES.has(status)) {
    return SIGNALS_ROW_STATUS.problem;
  }
  return SIGNALS_ROW_STATUS.neutral;
};

const statusLabelFor = (status) => {
  switch (status) {
    case SIGNALS_ROW_STATUS.activeFresh:
      return "Fresh signal";
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
  if (primaryState?.lastError) return primaryState.lastError;
  if (rowStatus === SIGNALS_ROW_STATUS.problem) {
    return primaryState?.status === "stale" ? "Waiting for current monitor state" : "Signal computation unavailable";
  }
  if (matrixStatus?.hasStale && !matrixStatus?.hasCurrentComputed) {
    return "Waiting for current market bars";
  }
  if (!primaryState && matrixStatus?.hasComputed) {
    return "Computed from market bars; primary monitor scan pending";
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
  const primaryStatesBySymbol = buildPrimaryStateMap(states);
  const matrixStatesBySymbol = buildSignalMatrixStatesBySymbol(matrixStates);
  const latestEventsBySymbol = buildLatestEventsBySymbol(events);
  const watchlistMembership = buildWatchlistMembership(watchlists);
  const trackedSymbols = buildTrackedSymbols({
    universeSymbols,
    states,
    matrixStates,
    events,
  });

  return sortSignalsRows(
    trackedSymbols.map((symbol, index) => {
      const primaryState = primaryStatesBySymbol.get(symbol) || null;
      const matrixStatesByTimeframe = matrixStatesBySymbol.get(symbol) || {};
      const matrixStatus = resolveMatrixStatus(matrixStatesByTimeframe);
      const profileTimeframe = stateResponse?.profile?.timeframe || primaryState?.timeframe || null;
      const stackSummary = resolveStackSummary(matrixStatesByTimeframe);
      const dashboardSummary = resolveDashboardSummary(
        resolveDashboardSnapshot({
          matrixStatesByTimeframe,
          profileTimeframe,
        }),
      );
      const latestEvent = latestEventsBySymbol.get(symbol) || null;
      const direction = resolveDirection({
        primaryState,
        matrixStatesByTimeframe,
      });
      const currentPrimaryState = isSignalStateCurrent(primaryState)
        ? primaryState
        : null;
      const currentMatrixSignalState = Object.values(matrixStatesByTimeframe)
        .filter(hasCurrentSignalDirection)
        .reduce((latest, state) => preferLatestState(latest, state), null);
      const skipped = skippedSymbols.has(symbol);
      const rowStatus = resolveRowStatus({ primaryState, matrixStatus, direction });
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
        currentSignalAt:
          currentPrimaryState?.currentSignalAt ||
          currentMatrixSignalState?.currentSignalAt ||
          null,
        currentSignalPrice:
          typeof currentPrimaryState?.currentSignalPrice === "number"
            ? currentPrimaryState.currentSignalPrice
            : typeof currentMatrixSignalState?.currentSignalPrice === "number"
              ? currentMatrixSignalState.currentSignalPrice
              : null,
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
  sorted.sort((left, right) => {
    if (sortKey === "symbol") {
      return multiplier * left.symbol.localeCompare(right.symbol);
    }
    if (sortKey === "bars") {
      const leftBars = left.barsSinceSignal ?? Number.POSITIVE_INFINITY;
      const rightBars = right.barsSinceSignal ?? Number.POSITIVE_INFINITY;
      return multiplier * (leftBars - rightBars || left.symbol.localeCompare(right.symbol));
    }
    if (sortKey === "latest") {
      return multiplier * ((right.activityMs || 0) - (left.activityMs || 0));
    }

    const statusDelta = (left.statusWeight ?? 99) - (right.statusWeight ?? 99);
    if (statusDelta) return statusDelta;
    const directionDelta =
      (DIRECTION_SORT_WEIGHT[left.direction] ?? 9) -
      (DIRECTION_SORT_WEIGHT[right.direction] ?? 9);
    if (directionDelta) return directionDelta;
    const latestDelta = (right.activityMs || 0) - (left.activityMs || 0);
    if (latestDelta) return latestDelta;
    return (
      (left.universeRank ?? Number.POSITIVE_INFINITY) -
        (right.universeRank ?? Number.POSITIVE_INFINITY) ||
      left.symbol.localeCompare(right.symbol)
    );
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
