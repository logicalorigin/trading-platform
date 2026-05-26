const DEFAULT_PRIORITY_BATCH_SIZE = 8;
const DEFAULT_BACKGROUND_BATCH_SIZE = 12;
const DEFAULT_REQUEST_SYMBOL_LIMIT = 16;
const PRESSURE_PRIORITY_BATCH_SIZE = 4;
const PRESSURE_BACKGROUND_BATCH_SIZE = 6;
const PRESSURE_REQUEST_SYMBOL_LIMIT = 12;
const HIGH_REQUEST_SYMBOL_LIMIT = 12;
const CRITICAL_REQUEST_SYMBOL_LIMIT = 8;

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
  pressureLevel = "normal",
  backgroundReady = false,
  cursor = 0,
} = {}) {
  const universe = uniqueSymbols(symbols);
  const universeSet = new Set(universe);
  const orderedPriority = uniqueSymbols(prioritySymbols).filter((symbol) =>
    universeSet.has(symbol),
  );
  const pressureActive =
    pressureLevel === "watch" ||
    pressureLevel === "high" ||
    pressureLevel === "critical";
  const priorityLimit = pressureActive
    ? PRESSURE_PRIORITY_BATCH_SIZE
    : DEFAULT_PRIORITY_BATCH_SIZE;
  const requestLimit =
    pressureLevel === "critical"
      ? CRITICAL_REQUEST_SYMBOL_LIMIT
      : pressureLevel === "high"
        ? HIGH_REQUEST_SYMBOL_LIMIT
        : pressureLevel === "watch"
          ? PRESSURE_REQUEST_SYMBOL_LIMIT
          : DEFAULT_REQUEST_SYMBOL_LIMIT;
  const rawBackgroundLimit =
    pressureActive
        ? PRESSURE_BACKGROUND_BATCH_SIZE
        : DEFAULT_BACKGROUND_BATCH_SIZE;
  const priorityBatch = (orderedPriority.length ? orderedPriority : universe)
    .slice(0, Math.min(priorityLimit, requestLimit));
  const prioritySet = new Set(priorityBatch);
  const backgroundUniverse = universe.filter((symbol) => !prioritySet.has(symbol));
  const backgroundLimit = Math.max(
    0,
    Math.min(rawBackgroundLimit, requestLimit - priorityBatch.length),
  );
  const background = backgroundReady
    ? rotateSymbols(backgroundUniverse, cursor, backgroundLimit)
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
    backgroundReady: Boolean(backgroundReady),
    backgroundPaused: !backgroundReady || backgroundLimit <= 0,
    pressureLevel,
    coverage: {
      totalSymbols: universe.length,
      prioritySymbols: priorityBatch.length,
      backgroundSymbols: background.symbols.length,
      requestSymbols: requestSymbols.length,
      pendingSymbols: Math.max(0, universe.length - requestSymbols.length),
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
