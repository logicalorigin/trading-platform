const DEFAULT_SIGNAL_MATRIX_TIMEFRAMES = Object.freeze(["2m", "5m", "15m"]);
const REQUEST_SYMBOL_LIMIT_BY_PRESSURE = Object.freeze({
  normal: 24,
  watch: 18,
  high: 12,
  critical: 6,
});
const SIGNAL_MATRIX_TIMEFRAME_MS = Object.freeze({
  "2m": 2 * 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
});

const normalizeSymbol = (symbol) => symbol?.trim?.().toUpperCase?.() || "";

const normalizePressureLevel = (pressureLevel) =>
  Object.hasOwn(REQUEST_SYMBOL_LIMIT_BY_PRESSURE, pressureLevel)
    ? pressureLevel
    : "normal";

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
  openPositionSymbols = [],
  signalMonitorSymbols = [],
  watchlistSymbols = [],
  wideLimit = null,
  narrowLimit = null,
} = {}) {
  const selected = uniqueSymbols([selectedSymbol]);
  const visibleWatchlist = uniqueSymbols(visibleWatchlistSymbols);
  const openPositions = uniqueSymbols(openPositionSymbols);
  const monitorSymbols = uniqueSymbols(signalMonitorSymbols);
  const watchlist = uniqueSymbols(watchlistSymbols);
  const watchlistSet = new Set(watchlist);
  const suggestedSignalSymbols = monitorSymbols.filter(
    (symbol) => !watchlistSet.has(symbol),
  );

  return {
    suggestedSignalSymbols,
    universeSymbols: applySymbolLimit(
      uniqueSymbols([
        ...selected,
        ...visibleWatchlist,
        ...suggestedSignalSymbols,
        ...openPositions,
        ...monitorSymbols,
        ...watchlist,
      ]),
      wideLimit,
    ),
    prioritySymbols: applySymbolLimit(
      uniqueSymbols([
        ...selected,
        ...visibleWatchlist,
        ...suggestedSignalSymbols,
        ...openPositions,
        ...monitorSymbols,
      ]),
      narrowLimit,
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
  Boolean(
    state &&
      state.latestBarAt &&
      (state.status === "ok" || state.status === "stale"),
  );

const stateNeedsRefresh = (state, timeframe, nowMs, pollMs) => {
  if (!isHydratedState(state)) {
    return true;
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

const symbolNeedsHydration = (symbol, hydrationMap, timeframes, options = {}) => {
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
  const requestLimit = REQUEST_SYMBOL_LIMIT_BY_PRESSURE[normalizedPressureLevel];
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
  const backgroundUniverse = universe.filter((symbol) => !prioritySet.has(symbol));
  const missingBackgroundUniverse = backgroundUniverse.filter(needsHydration);
  const backgroundLimit = Math.max(
    0,
    requestLimit - priorityBatch.length,
  );
  const backgroundAllowed =
    !startupProtected &&
    Boolean(backgroundReady) &&
    normalizedPressureLevel !== "high" &&
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

  return {
    requestSymbols,
    prioritySymbols: priorityBatch,
    backgroundSymbols: background.symbols,
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
      hydratedSymbols: Math.max(0, universe.length - missingSymbols.length),
      missingSymbols: missingSymbols.length,
      pendingSymbols: missingSymbols.length,
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
