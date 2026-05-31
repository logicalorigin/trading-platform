export const SIGNALS_TABLE_TIMEFRAMES = Object.freeze(["2m", "5m", "15m"]);

export const SIGNALS_ROW_STATUS = Object.freeze({
  activeFresh: "active-fresh",
  activeStale: "active-stale",
  problem: "problem",
  skipped: "skipped",
  pending: "pending",
  neutral: "neutral",
});

const PROBLEM_STATUSES = new Set(["error", "unavailable"]);
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
    (Array.isArray(watchlist?.items) ? watchlist.items : []).forEach((item) => {
      const symbol = normalizeSignalsTicker(item?.sym || item?.symbol || item?.ticker);
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

const resolveDirection = ({ primaryState, latestEvent, matrixStatesByTimeframe }) => {
  const primaryDirection = String(primaryState?.currentSignalDirection || "").toLowerCase();
  if (primaryDirection === "buy" || primaryDirection === "sell") {
    return primaryDirection;
  }
  const eventDirection = String(latestEvent?.direction || "").toLowerCase();
  if (eventDirection === "buy" || eventDirection === "sell") {
    return eventDirection;
  }
  const matrixDirection = SIGNALS_TABLE_TIMEFRAMES
    .map((timeframe) =>
      String(matrixStatesByTimeframe?.[timeframe]?.currentSignalDirection || "").toLowerCase(),
    )
    .find((direction) => direction === "buy" || direction === "sell");
  return matrixDirection || null;
};

const resolveRowStatus = ({ primaryState, skipped, direction }) => {
  const status = String(primaryState?.status || "").toLowerCase();
  const hasProblem = Boolean(primaryState?.lastError || PROBLEM_STATUSES.has(status));

  if (hasProblem) {
    return SIGNALS_ROW_STATUS.problem;
  }
  if (skipped) {
    return SIGNALS_ROW_STATUS.skipped;
  }
  if (!primaryState) {
    return SIGNALS_ROW_STATUS.pending;
  }
  if (direction && (status === "ok" || STALE_STATUSES.has(status))) {
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
      return "Stale signal";
    case SIGNALS_ROW_STATUS.problem:
      return "Needs attention";
    case SIGNALS_ROW_STATUS.skipped:
      return "Skipped";
    case SIGNALS_ROW_STATUS.pending:
      return "Awaiting scan";
    default:
      return "No signal";
  }
};

const coverageReasonFor = ({ rowStatus, primaryState, skipped }) => {
  if (primaryState?.lastError) return primaryState.lastError;
  if (rowStatus === SIGNALS_ROW_STATUS.problem) {
    return primaryState?.status === "stale" ? "State is stale" : "State unavailable";
  }
  if (skipped) return "Outside current monitor scan cap";
  if (!primaryState) return "Tracked but no state has been stored yet";
  return "Covered by signal monitor";
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
      const latestEvent = latestEventsBySymbol.get(symbol) || null;
      const direction = resolveDirection({
        primaryState,
        latestEvent,
        matrixStatesByTimeframe,
      });
      const skipped = skippedSymbols.has(symbol);
      const rowStatus = resolveRowStatus({ primaryState, skipped, direction });
      const activeTimeframes = SIGNALS_TABLE_TIMEFRAMES.filter((timeframe) => {
        const matrixState = matrixStatesByTimeframe[timeframe];
        const matrixDirection = String(
          matrixState?.currentSignalDirection || "",
        ).toLowerCase();
        return matrixDirection === "buy" || matrixDirection === "sell";
      });
      const freshTimeframes = activeTimeframes.filter(
        (timeframe) => matrixStatesByTimeframe[timeframe]?.fresh,
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
        profileTimeframe: stateResponse?.profile?.timeframe || primaryState?.timeframe || null,
        primaryState,
        matrixStatesByTimeframe,
        latestEvent,
        watchlistIds: membership.watchlistIds,
        watchlistLabels: membership.watchlistLabels,
        direction,
        status: rowStatus,
        statusLabel: statusLabelFor(rowStatus),
        statusWeight: STATUS_SORT_WEIGHT[rowStatus] ?? 99,
        coverageReason: coverageReasonFor({ rowStatus, primaryState, skipped }),
        skipped,
        pending: rowStatus === SIGNALS_ROW_STATUS.pending,
        problem: rowStatus === SIGNALS_ROW_STATUS.problem,
        fresh: Boolean(primaryState?.fresh),
        active: Boolean(primaryState?.active),
        activeTimeframes,
        freshTimeframes,
        activeTimeframeCount: activeTimeframes.length,
        freshTimeframeCount: freshTimeframes.length,
        barsSinceSignal: Number.isFinite(Number(primaryState?.barsSinceSignal))
          ? Number(primaryState.barsSinceSignal)
          : null,
        currentSignalAt: primaryState?.currentSignalAt || latestEvent?.signalAt || null,
        currentSignalPrice:
          typeof primaryState?.currentSignalPrice === "number"
            ? primaryState.currentSignalPrice
            : latestEvent?.signalPrice ?? latestEvent?.close ?? null,
        latestBarAt: primaryState?.latestBarAt || null,
        lastEvaluatedAt: primaryState?.lastEvaluatedAt || null,
        lastError: primaryState?.lastError || null,
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
    if (row.skipped) summary.skipped += 1;
    if (row.pending) summary.pending += 1;
  });
  return summary;
};
