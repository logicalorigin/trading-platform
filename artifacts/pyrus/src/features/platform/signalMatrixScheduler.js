const DEFAULT_SIGNAL_MATRIX_TIMEFRAMES = Object.freeze(["2m", "5m", "15m"]);
const DEFAULT_REQUEST_SYMBOL_LIMIT = 3;
const WATCH_REQUEST_SYMBOL_LIMIT = 2;
const HIGH_REQUEST_SYMBOL_LIMIT = 1;
const CRITICAL_REQUEST_SYMBOL_LIMIT = 1;

const normalizeSymbol = (symbol) => symbol?.trim?.().toUpperCase?.() || "";

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

const symbolNeedsHydration = (symbol, hydrationMap, timeframes) => {
  const byTimeframe = hydrationMap.get(symbol) || {};
  return timeframes.some((timeframe) => !isHydratedState(byTimeframe[timeframe]));
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
} = {}) {
  const universe = uniqueSymbols(symbols);
  const startupProtected = Boolean(startupProtectionActive);
  const matrixTimeframes = normalizeTimeframes(timeframes);
  const hydrationMap = buildHydrationMap(currentStates);
  const universeSet = new Set(universe);
  const orderedPriority = uniqueSymbols(prioritySymbols).filter((symbol) =>
    universeSet.has(symbol),
  );
  const requestLimit =
    pressureLevel === "critical"
      ? CRITICAL_REQUEST_SYMBOL_LIMIT
      : pressureLevel === "high"
        ? HIGH_REQUEST_SYMBOL_LIMIT
        : pressureLevel === "watch"
          ? WATCH_REQUEST_SYMBOL_LIMIT
          : DEFAULT_REQUEST_SYMBOL_LIMIT;
  const needsHydration = (symbol) =>
    symbolNeedsHydration(symbol, hydrationMap, matrixTimeframes);
  const missingSymbols = universe.filter(needsHydration);
  const priorityBatch = startupProtected
    ? []
    : orderedPriority.filter(needsHydration).slice(0, requestLimit);
  const prioritySet = new Set(priorityBatch);
  const backgroundUniverse = universe.filter((symbol) => !prioritySet.has(symbol));
  const missingBackgroundUniverse = backgroundUniverse.filter(needsHydration);
  const rotationUniverse = missingBackgroundUniverse.length
    ? missingBackgroundUniverse
    : backgroundUniverse;
  const backgroundLimit = Math.max(
    0,
    requestLimit - priorityBatch.length,
  );
  const backgroundAllowed =
    !startupProtected &&
    Boolean(backgroundReady) &&
    pressureLevel !== "high" &&
    pressureLevel !== "critical";
  const background = backgroundAllowed
    ? rotateSymbols(rotationUniverse, cursor, backgroundLimit)
    : { symbols: [], nextCursor: cursor || 0 };
  const requestSymbols = uniqueSymbols([
    ...priorityBatch,
    ...background.symbols,
  ]);

  return {
    requestSymbols,
    prioritySymbols: priorityBatch,
    backgroundSymbols: background.symbols,
    nextCursor: background.nextCursor,
    backgroundReady: backgroundAllowed,
    backgroundPaused: !backgroundAllowed || backgroundLimit <= 0,
    startupProtectionActive: startupProtected,
    pressureLevel,
    coverage: {
      totalSymbols: universe.length,
      prioritySymbols: priorityBatch.length,
      backgroundSymbols: background.symbols.length,
      requestSymbols: requestSymbols.length,
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
