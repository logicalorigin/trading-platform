import {
  preferSignalMatrixCellState,
  signalMatrixStateKey,
} from "../signals/signalMatrixStateMerge.js";

const DEFAULT_SIGNAL_MATRIX_TIMEFRAMES = Object.freeze([
  "1m",
  "2m",
  "5m",
  "15m",
  "1h",
  "1d",
]);
const SIGNAL_MATRIX_REQUEST_TASK_LIMIT = 240;
const normalizeSymbol = (symbol) => symbol?.trim?.().toUpperCase?.() || "";

export const resolveSignalMatrixExactCellLimit = (_pressureLevel) =>
  SIGNAL_MATRIX_REQUEST_TASK_LIMIT;

export const resolveSignalMatrixActiveScreenRequestSymbolLimit = (
  _pressureLevel,
) => null;

export const resolveSignalMatrixActiveScreenRequestTaskLimit = (
  _pressureLevel,
) => SIGNAL_MATRIX_REQUEST_TASK_LIMIT;

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
  watchlistPrioritySymbols = [],
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
  const watchlistPriority = uniqueSymbols(watchlistPrioritySymbols);
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
    ? [
        ...signalsScreenPriority,
        ...selected,
        ...watchlistPriority,
        ...openPositions,
      ]
    : [
        ...selected,
        ...watchlistPriority,
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
        ...watchlistPriority,
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

const stateKey = signalMatrixStateKey;

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

export function buildSignalMatrixStoredStateBootstrapRequest({
  symbols = [],
  currentStates = [],
  timeframes = DEFAULT_SIGNAL_MATRIX_TIMEFRAMES,
  lastBootstrapKey = null,
} = {}) {
  const universe = uniqueSymbols(symbols);
  const matrixTimeframes = normalizeTimeframes(timeframes);
  if (!universe.length || !matrixTimeframes.length) {
    return null;
  }

  const key = `${[...universe].sort().join(",")}|${matrixTimeframes.join(",")}`;
  if (key === lastBootstrapKey) {
    return null;
  }

  const requestedStateKeys = new Set(
    universe.flatMap((symbol) =>
      matrixTimeframes.map((timeframe) => `${symbol}:${timeframe}`),
    ),
  );
  const presentStateKeys = new Set();
  (Array.isArray(currentStates) ? currentStates : []).forEach((state) => {
    const key = stateKey(state);
    if (requestedStateKeys.has(key)) {
      presentStateKeys.add(key);
    }
  });

  const totalTaskCount = requestedStateKeys.size;
  const hydratedTaskCount = presentStateKeys.size;
  if (hydratedTaskCount >= totalTaskCount) {
    return null;
  }
  const hydratedSymbols = universe.filter((symbol) =>
    matrixTimeframes.every((timeframe) =>
      presentStateKeys.has(`${symbol}:${timeframe}`),
    ),
  ).length;

  return {
    key,
    symbols: universe,
    timeframes: matrixTimeframes,
    coverage: {
      totalSymbols: universe.length,
      requestSymbols: universe.length,
      prioritySymbols: universe.length,
      backgroundSymbols: 0,
      requestTaskCount: totalTaskCount,
      requestedTaskCount: totalTaskCount,
      totalTaskCount,
      hydratedTaskCount,
      missingTaskCount: totalTaskCount - hydratedTaskCount,
      pendingTaskCount: 0,
      queuedTaskCount: 0,
      hydratedSymbols,
      missingSymbols: universe.length - hydratedSymbols,
      pendingSymbols: 0,
      timeframes: matrixTimeframes.length,
      matrixTimeframes: matrixTimeframes.length,
      selectedTimeframe: null,
      selectedTimeframes: matrixTimeframes,
      storedStateBootstrap: true,
    },
  };
}

export function mergeSignalMatrixStates({
  currentStates = [],
  incomingStates = [],
  knownSymbols = [],
} = {}) {
  const knownSymbolSet = new Set(uniqueSymbols(knownSymbols));
  const nextStates = [];
  const indexByKey = new Map();
  let canonicalOrder = true;
  let changed = false;
  let previousState = null;

  const compareStates = (left, right) => {
    const leftSymbol = normalizeSymbol(left?.symbol);
    const rightSymbol = normalizeSymbol(right?.symbol);
    if (leftSymbol !== rightSymbol) {
      return leftSymbol.localeCompare(rightSymbol);
    }
    return String(left?.timeframe || "").localeCompare(
      String(right?.timeframe || ""),
    );
  };

  currentStates.forEach((state) => {
    const key = stateKey(state);
    const symbol = normalizeSymbol(state?.symbol);
    if (!key || (knownSymbolSet.size && !knownSymbolSet.has(symbol))) {
      changed = true;
      return;
    }
    const existingIndex = indexByKey.get(key);
    if (existingIndex != null) {
      nextStates[existingIndex] = state;
      changed = true;
      return;
    }
    if (previousState && compareStates(previousState, state) > 0) {
      canonicalOrder = false;
    }
    indexByKey.set(key, nextStates.length);
    nextStates.push(state);
    previousState = state;
  });

  incomingStates.forEach((state) => {
    const key = stateKey(state);
    const symbol = normalizeSymbol(state?.symbol);
    if (!key || (knownSymbolSet.size && !knownSymbolSet.has(symbol))) {
      return;
    }
    const currentIndex = indexByKey.get(key);
    const current =
      currentIndex == null ? null : nextStates[currentIndex];
    const preferred = preferSignalMatrixCellState(current, state);
    if (!preferred || preferred === current) return;
    changed = true;
    if (currentIndex == null) {
      canonicalOrder = false;
      indexByKey.set(key, nextStates.length);
      nextStates.push(preferred);
      return;
    }
    nextStates[currentIndex] = preferred;
  });

  if (!canonicalOrder) {
    nextStates.sort(compareStates);
  }

  return !changed && canonicalOrder
    ? currentStates
    : signalMatrixStatesEqual(currentStates, nextStates)
      ? currentStates
      : nextStates;
}

export function mergeSignalMatrixStreamSnapshot({
  currentSnapshot = {},
  incomingStates = [],
  kind = "state-delta",
  coverage = null,
  skippedSymbols = null,
  truncated = null,
  knownSymbols = [],
} = {}) {
  const currentStates = Array.isArray(currentSnapshot.states)
    ? currentSnapshot.states
    : [];
  const states = Array.isArray(incomingStates) ? incomingStates : [];
  const nextMetadata = {
    coverage: coverage ?? currentSnapshot.coverage ?? null,
    skippedSymbols: skippedSymbols ?? currentSnapshot.skippedSymbols ?? [],
    truncated: truncated ?? currentSnapshot.truncated ?? false,
  };

  if (!states.length) {
    if (kind !== "bootstrap") {
      return currentSnapshot;
    }
    return {
      ...currentSnapshot,
      states,
      ...nextMetadata,
    };
  }

  const nextStates = mergeSignalMatrixStates({
    currentStates,
    incomingStates: states,
    knownSymbols,
  });
  if (
    signalMatrixStatesEqual(currentStates, nextStates) &&
    (
      currentSnapshot.coverage === coverage ||
      (!coverage && skippedSymbols === null && truncated === null)
    )
  ) {
    return currentSnapshot;
  }

  return {
    ...currentSnapshot,
    states: nextStates,
    ...nextMetadata,
  };
}

export function signalMatrixStatesEqual(left = [], right = []) {
  if (left === right) return true;
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;
  return left.every((state, index) => state === right[index]);
}
