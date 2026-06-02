const DEFAULT_SIGNAL_MATRIX_TIMEFRAMES = Object.freeze([
  "1m",
  "2m",
  "5m",
  "15m",
  "1h",
]);
const REQUEST_TASK_LIMIT_BY_PRESSURE = Object.freeze({
  normal: 25,
  watch: 25,
  high: 20,
  critical: 10,
});
const ACTIVE_SCREEN_REQUEST_TASK_LIMIT_BY_PRESSURE = Object.freeze({
  normal: 150,
  watch: 150,
  high: 60,
  critical: 10,
});
const ACTIVE_SCREEN_REQUEST_SYMBOL_LIMIT_BY_PRESSURE = Object.freeze({
  normal: 250,
  watch: 250,
  high: 250,
  critical: 8,
});
const BUSY_QUEUE_DELAY_MS_BY_PRESSURE = Object.freeze({
  normal: 0,
  watch: 2_500,
  high: 15_000,
  critical: 60_000,
});
const CATCHUP_DELAY_MS_BY_PRESSURE = Object.freeze({
  normal: 1_500,
  watch: 5_000,
  high: 15_000,
  critical: null,
});
const SIGNAL_MATRIX_TIMEFRAME_MS = Object.freeze({
  "1m": 60_000,
  "2m": 2 * 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
});
const TERMINAL_MATRIX_RETRY_MIN_MS = 5 * 60_000;
const TERMINAL_MATRIX_STATUSES = new Set(["error", "unavailable", "unknown"]);

const normalizeSymbol = (symbol) => symbol?.trim?.().toUpperCase?.() || "";

const normalizePressureLevel = (pressureLevel) =>
  Object.hasOwn(REQUEST_TASK_LIMIT_BY_PRESSURE, pressureLevel)
    ? pressureLevel
    : "normal";

export const resolveSignalMatrixActiveScreenRequestSymbolLimit = (
  pressureLevel,
) =>
  ACTIVE_SCREEN_REQUEST_SYMBOL_LIMIT_BY_PRESSURE[
    normalizePressureLevel(pressureLevel)
  ];

export const resolveSignalMatrixActiveScreenRequestTaskLimit = (
  pressureLevel,
) =>
  ACTIVE_SCREEN_REQUEST_TASK_LIMIT_BY_PRESSURE[
    normalizePressureLevel(pressureLevel)
  ];

export const resolveSignalMatrixBusyQueueDelayMs = (pressureLevel) =>
  BUSY_QUEUE_DELAY_MS_BY_PRESSURE[normalizePressureLevel(pressureLevel)];

export const resolveSignalMatrixCatchupDelayMs = (pressureLevel) =>
  CATCHUP_DELAY_MS_BY_PRESSURE[normalizePressureLevel(pressureLevel)];

const uniqueSymbols = (symbols = []) => {
  const seen = new Set();
  const result = [];
  symbols.forEach((symbol) => {
    const normalized = normalizeSymbol(symbol);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    result.push(normalized);
  });
  return result;
};

const applySymbolLimit = (symbols, limit) =>
  limit == null ? symbols : symbols.slice(0, limit);

export function buildSignalMatrixSymbolSets({
  selectedSymbol = null,
  visibleWatchlistSymbols = [],
  signalsScreenSymbols = [],
  signalsScreenPrioritySymbols = [],
  openPositionSymbols = [],
  signalMonitorSymbols = [],
  signalMonitorUniverseSymbols = [],
  watchlistSymbols = [],
  wideLimit = null,
  narrowLimit = null,
} = {}) {
  const selected = uniqueSymbols([selectedSymbol]);
  const visibleWatchlist = uniqueSymbols(visibleWatchlistSymbols);
  const signalsScreen = uniqueSymbols(signalsScreenSymbols);
  const signalsScreenPriority = uniqueSymbols(
    signalsScreenPrioritySymbols.length
      ? signalsScreenPrioritySymbols
      : signalsScreenSymbols,
  );
  const openPositions = uniqueSymbols(openPositionSymbols);
  const monitorSymbols = uniqueSymbols(signalMonitorSymbols);
  const monitorUniverseSymbols = uniqueSymbols([
    ...monitorSymbols,
    ...signalMonitorUniverseSymbols,
  ]);
  const watchlist = uniqueSymbols(watchlistSymbols);
  const watchlistSet = new Set(watchlist);
  const suggestedSignalSymbols = monitorSymbols.filter(
    (symbol) => !watchlistSet.has(symbol),
  );
  const signalsScreenActive =
    signalsScreen.length > 0 || signalsScreenPriority.length > 0;
  const resolvedWideLimit = signalsScreenActive ? null : wideLimit;
  const resolvedNarrowLimit = signalsScreenActive ? null : narrowLimit;
  const priorityBaseSymbols = signalsScreenActive
    ? [...selected, ...visibleWatchlist, ...signalsScreenPriority]
    : [
        ...selected,
        ...visibleWatchlist,
        ...signalsScreenPriority,
        ...suggestedSignalSymbols,
        ...openPositions,
        ...monitorSymbols,
      ];

  return {
    suggestedSignalSymbols,
    universeSymbols: applySymbolLimit(
      uniqueSymbols([
        ...selected,
        ...visibleWatchlist,
        ...signalsScreen,
        ...suggestedSignalSymbols,
        ...openPositions,
        ...monitorSymbols,
        ...monitorUniverseSymbols,
        ...watchlist,
      ]),
      resolvedWideLimit,
    ),
    prioritySymbols: applySymbolLimit(
      uniqueSymbols(priorityBaseSymbols),
      resolvedNarrowLimit,
    ),
  };
}

const readStateTimeMs = (state) =>
  Math.max(
    Date.parse(state?.lastEvaluatedAt || "") || 0,
    Date.parse(state?.latestBarAt || "") || 0,
    Date.parse(state?.currentSignalAt || "") || 0,
  );

const stateKey = (state) => {
  const symbol = normalizeSymbol(state?.symbol);
  const timeframe = String(state?.timeframe || "").trim();
  return symbol && timeframe ? `${symbol}:${timeframe}` : "";
};

const normalizeTimeframes = (timeframes = DEFAULT_SIGNAL_MATRIX_TIMEFRAMES) => {
  const allowed = new Set(DEFAULT_SIGNAL_MATRIX_TIMEFRAMES);
  const normalized = Array.isArray(timeframes)
    ? timeframes
        .map((timeframe) => String(timeframe || "").trim())
        .filter((timeframe) => allowed.has(timeframe))
    : [];
  const unique = [...new Set(normalized)];
  return unique.length ? unique : [...DEFAULT_SIGNAL_MATRIX_TIMEFRAMES];
};

const requestSymbolLimitFor = (taskLimit, timeframes) =>
  Math.max(
    1,
    Math.floor(
      Math.max(1, taskLimit) / Math.max(1, timeframes.length),
    ),
  );

const buildHydrationMap = (states = []) => {
  const bySymbol = new Map();
  states.forEach((state) => {
    const symbol = normalizeSymbol(state?.symbol);
    const timeframe = String(state?.timeframe || "").trim();
    if (!symbol || !timeframe) return;
    const byTimeframe = bySymbol.get(symbol) || {};
    const current = byTimeframe[timeframe];
    if (!current || readStateTimeMs(state) >= readStateTimeMs(current)) {
      byTimeframe[timeframe] = state;
      bySymbol.set(symbol, byTimeframe);
    }
  });
  return bySymbol;
};

const isHydratedState = (state) =>
  Boolean(state) &&
  (Boolean(
    state.latestBarAt && (state.status === "ok" || state.status === "stale"),
  ) ||
    Boolean(
      TERMINAL_MATRIX_STATUSES.has(String(state.status || "").toLowerCase()) &&
        (state.lastEvaluatedAt || state.lastError),
    ));

const stateNeedsRefresh = (state, timeframe, nowMs, pollMs) => {
  if (!isHydratedState(state)) {
    return true;
  }
  if (TERMINAL_MATRIX_STATUSES.has(String(state?.status || "").toLowerCase())) {
    if (!Number.isFinite(nowMs)) {
      return false;
    }
    const lastEvaluatedMs = Date.parse(state?.lastEvaluatedAt || "");
    if (!Number.isFinite(lastEvaluatedMs)) {
      return true;
    }
    const retryAfterMs = Math.max(
      TERMINAL_MATRIX_RETRY_MIN_MS,
      Number.isFinite(pollMs) && pollMs > 0 ? pollMs * 5 : 0,
    );
    return nowMs - lastEvaluatedMs > retryAfterMs;
  }
  if (!Number.isFinite(nowMs)) {
    return false;
  }
  const latestBarMs = Date.parse(state?.latestBarAt || "");
  if (!Number.isFinite(latestBarMs)) {
    return true;
  }
  const lastEvaluatedMs = Date.parse(state?.lastEvaluatedAt || "");
  const refreshAnchorMs = Math.max(
    latestBarMs,
    Number.isFinite(lastEvaluatedMs) ? lastEvaluatedMs : 0,
  );
  const timeframeMs = SIGNAL_MATRIX_TIMEFRAME_MS[timeframe] || 5 * 60_000;
  const staleAfterMs = Math.max(
    timeframeMs * 2,
    Number.isFinite(pollMs) && pollMs > 0 ? pollMs * 2 : 0,
    60_000,
  );
  return nowMs - refreshAnchorMs > staleAfterMs;
};

const symbolNeedsHydration = (
  symbol,
  hydrationMap,
  timeframes,
  options = {},
) => {
  const byTimeframe = hydrationMap.get(symbol) || {};
  return timeframes.some((timeframe) =>
    stateNeedsRefresh(
      byTimeframe[timeframe],
      timeframe,
      options.nowMs,
      options.pollMs,
    ),
  );
};

const rotateSymbols = (symbols, cursor, count) => {
  if (!symbols.length || count <= 0) {
    return { symbols: [], nextCursor: cursor || 0 };
  }

  const start = Math.max(0, cursor || 0) % symbols.length;
  const selected = [];
  for (let index = 0; index < Math.min(count, symbols.length); index += 1) {
    selected.push(symbols[(start + index) % symbols.length]);
  }
  return {
    symbols: selected,
    nextCursor: (start + selected.length) % symbols.length,
  };
};

export function buildSignalMatrixRequestPlan({
  symbols = [],
  prioritySymbols = [],
  currentStates = [],
  timeframes = DEFAULT_SIGNAL_MATRIX_TIMEFRAMES,
  pressureLevel = "normal",
  backgroundReady = false,
  startupProtectionActive = false,
  cursor = 0,
  pollMs = 0,
  nowMs = null,
  requestSymbolLimit = null,
  requestTaskLimit = null,
} = {}) {
  const universe = uniqueSymbols(symbols);
  const startupProtected = Boolean(startupProtectionActive);
  const matrixTimeframes = normalizeTimeframes(timeframes);
  const hydrationMap = buildHydrationMap(currentStates);
  const universeSet = new Set(universe);
  const orderedPriority = uniqueSymbols(prioritySymbols).filter((symbol) =>
    universeSet.has(symbol),
  );
  const normalizedPressureLevel = normalizePressureLevel(pressureLevel);
  const pressureRequestTaskLimit =
    REQUEST_TASK_LIMIT_BY_PRESSURE[normalizedPressureLevel];
  const explicitRequestTaskLimit =
    requestTaskLimit != null && Number.isFinite(Number(requestTaskLimit))
      ? Math.max(1, Math.floor(Number(requestTaskLimit)))
      : null;
  const resolvedRequestTaskLimit =
    explicitRequestTaskLimit ?? pressureRequestTaskLimit;
  const pressureRequestLimit = requestSymbolLimitFor(
    resolvedRequestTaskLimit,
    matrixTimeframes,
  );
  const explicitRequestLimit =
    requestSymbolLimit != null && Number.isFinite(Number(requestSymbolLimit))
      ? Math.max(1, Math.floor(Number(requestSymbolLimit)))
      : null;
  const requestLimit =
    explicitRequestLimit == null
      ? pressureRequestLimit
      : Math.min(pressureRequestLimit, explicitRequestLimit);
  const normalizedNowMs = Number.isFinite(nowMs) ? nowMs : null;
  const needsHydration = (symbol) =>
    symbolNeedsHydration(symbol, hydrationMap, matrixTimeframes, {
      nowMs: normalizedNowMs,
      pollMs,
    });
  const missingSymbols = universe.filter(needsHydration);
  const priorityCandidates = startupProtected
    ? []
    : orderedPriority.filter(needsHydration);
  const priorityRotation = rotateSymbols(
    priorityCandidates,
    cursor,
    requestLimit,
  );
  const priorityBatch = priorityRotation.symbols;
  const prioritySet = new Set(priorityBatch);
  const backgroundUniverse = universe.filter(
    (symbol) => !prioritySet.has(symbol),
  );
  const missingBackgroundUniverse = backgroundUniverse.filter(needsHydration);
  const backgroundLimit = Math.max(0, requestLimit - priorityBatch.length);
  const backgroundAllowed =
    !startupProtected &&
    Boolean(backgroundReady) &&
    normalizedPressureLevel !== "critical";
  const background = backgroundAllowed
    ? rotateSymbols(missingBackgroundUniverse, cursor, backgroundLimit)
    : { symbols: [], nextCursor: cursor || 0 };
  const nextCursor =
    priorityCandidates.length > requestLimit
      ? priorityRotation.nextCursor
      : background.nextCursor;
  const requestSymbols = uniqueSymbols([
    ...priorityBatch,
    ...background.symbols,
  ]);
  const requestedTaskCount = missingSymbols.length * matrixTimeframes.length;
  const queuedSymbols = Math.max(
    0,
    missingSymbols.length - requestSymbols.length,
  );
  const queuedTaskCount = queuedSymbols * matrixTimeframes.length;

  return {
    requestSymbols,
    prioritySymbols: priorityBatch,
    backgroundSymbols: background.symbols,
    timeframes: matrixTimeframes,
    nextCursor,
    backgroundReady: backgroundAllowed,
    backgroundPaused: !backgroundAllowed || backgroundLimit <= 0,
    startupProtectionActive: startupProtected,
    pressureLevel: normalizedPressureLevel,
    coverage: {
      totalSymbols: universe.length,
      prioritySymbols: priorityBatch.length,
      backgroundSymbols: background.symbols.length,
      requestSymbols: requestSymbols.length,
      requestSymbolLimit: requestLimit,
      requestTaskLimit: resolvedRequestTaskLimit,
      requestTaskCount: requestSymbols.length * matrixTimeframes.length,
      requestedTaskCount,
      queuedTaskCount,
      timeframes: matrixTimeframes.length,
      hydratedSymbols: Math.max(0, universe.length - missingSymbols.length),
      missingSymbols: missingSymbols.length,
      pendingSymbols: queuedSymbols,
      startupProtectionActive: startupProtected,
      estimatedFullCycleMs:
        pollMs > 0 && missingSymbols.length > 0 && requestSymbols.length > 0
          ? Math.ceil(missingSymbols.length / requestSymbols.length) * pollMs
          : null,
    },
  };
}

export function mergeSignalMatrixStates({
  currentStates = [],
  incomingStates = [],
  knownSymbols = [],
} = {}) {
  const knownSymbolSet = new Set(uniqueSymbols(knownSymbols));
  const merged = new Map();

  currentStates.forEach((state) => {
    const key = stateKey(state);
    const symbol = normalizeSymbol(state?.symbol);
    if (!key || (knownSymbolSet.size && !knownSymbolSet.has(symbol))) {
      return;
    }
    merged.set(key, state);
  });

  incomingStates.forEach((state) => {
    const key = stateKey(state);
    const symbol = normalizeSymbol(state?.symbol);
    if (!key || (knownSymbolSet.size && !knownSymbolSet.has(symbol))) {
      return;
    }
    const current = merged.get(key);
    if (!current || readStateTimeMs(state) >= readStateTimeMs(current)) {
      merged.set(key, state);
    }
  });

  return Array.from(merged.values()).sort((left, right) => {
    const leftSymbol = normalizeSymbol(left?.symbol);
    const rightSymbol = normalizeSymbol(right?.symbol);
    if (leftSymbol !== rightSymbol) {
      return leftSymbol.localeCompare(rightSymbol);
    }
    return String(left?.timeframe || "").localeCompare(
      String(right?.timeframe || ""),
    );
  });
}

export function signalMatrixStatesEqual(left = [], right = []) {
  if (left === right) return true;
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;
  return left.every((state, index) => state === right[index]);
}
