import { normalizeSignalStatus } from "../signals/signalStateFreshness.js";

const DEFAULT_SIGNAL_MATRIX_TIMEFRAMES = Object.freeze([
  "1m",
  "2m",
  "5m",
  "15m",
  "1h",
  "1d",
]);
const SIGNAL_MATRIX_PRESSURE_LEVELS = Object.freeze({
  normal: true,
  watch: true,
  high: true,
});
const SIGNAL_MATRIX_EXACT_CELL_LIMIT_BY_PRESSURE = Object.freeze({
  normal: 480,
  watch: 240,
  high: 120,
});
const REQUEST_TASK_LIMIT_BY_PRESSURE = Object.freeze({
  normal: 480,
  watch: 240,
  high: 120,
});
const ACTIVE_SCREEN_REQUEST_TASK_LIMIT_BY_PRESSURE = Object.freeze({
  normal: 480,
  watch: 240,
  high: 120,
});
const ACTIVE_SCREEN_REQUEST_SYMBOL_LIMIT_BY_PRESSURE = Object.freeze({
  normal: 500,
  watch: 500,
  high: 500,
});
const BUSY_QUEUE_DELAY_MS_BY_PRESSURE = Object.freeze({
  normal: 0,
  watch: 2_500,
  high: 15_000,
});
const CATCHUP_DELAY_MS_BY_PRESSURE = Object.freeze({
  normal: 1_500,
  watch: 5_000,
  high: 15_000,
});
const SIGNAL_MATRIX_TIMEFRAME_MS = Object.freeze({
  "1m": 60_000,
  "2m": 2 * 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "1d": 24 * 60 * 60_000,
});
const SIGNAL_MATRIX_CANDLE_REFRESH_GRACE_MS = 5_000;
const SIGNAL_MATRIX_CANDLE_REFRESH_MAX_GRACE_MS = 15_000;
const SIGNAL_MATRIX_RETRY_COOLDOWN_FALLBACK_MS = 15_000;
const NON_HYDRATED_MATRIX_STATUSES = new Set([
  "error",
  "pending",
  "unknown",
]);
const normalizeSymbol = (symbol) => symbol?.trim?.().toUpperCase?.() || "";

const normalizePressureLevel = (pressureLevel) =>
  Object.hasOwn(SIGNAL_MATRIX_PRESSURE_LEVELS, pressureLevel)
    ? pressureLevel
    : "normal";

export const resolveSignalMatrixExactCellLimit = (pressureLevel) =>
  SIGNAL_MATRIX_EXACT_CELL_LIMIT_BY_PRESSURE[
    normalizePressureLevel(pressureLevel)
  ];

export const resolveSignalMatrixActiveScreenRequestSymbolLimit = (
  pressureLevel,
) =>
  ACTIVE_SCREEN_REQUEST_SYMBOL_LIMIT_BY_PRESSURE[
    normalizePressureLevel(pressureLevel)
  ];

export const resolveSignalMatrixActiveScreenRequestTaskLimit = (
  pressureLevel,
) => {
  const normalizedPressureLevel = normalizePressureLevel(pressureLevel);
  return ACTIVE_SCREEN_REQUEST_TASK_LIMIT_BY_PRESSURE[normalizedPressureLevel];
};

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

const normalizeRequestLimit = (value) => {
  if (value == null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(1, Math.floor(numeric));
};

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
    ? [...signalsScreenPriority, ...selected, ...watchlistPriority]
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

const cellKey = (cell) => `${cell.symbol}:${cell.timeframe}`;
const isPendingSignalMatrixState = (state) =>
  normalizeSignalStatus(state) === "pending";

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

export function buildSignalMatrixPendingStates({
  requestCells = [],
  currentStates = [],
  evaluatedAt = new Date().toISOString(),
} = {}) {
  const existingKeys = new Set(
    (Array.isArray(currentStates) ? currentStates : [])
      .map(stateKey)
      .filter(Boolean),
  );
  const seenPendingKeys = new Set();
  return (Array.isArray(requestCells) ? requestCells : [])
    .map((cell) => {
      const symbol = normalizeSymbol(cell?.symbol);
      const timeframe = String(cell?.timeframe || "").trim();
      const key = symbol && timeframe ? `${symbol}:${timeframe}` : "";
      if (!key || existingKeys.has(key) || seenPendingKeys.has(key)) {
        return null;
      }
      seenPendingKeys.add(key);
      return {
        id: `signal-matrix-pending:${key}`,
        symbol,
        timeframe,
        currentSignalDirection: null,
        currentSignalAt: null,
        currentSignalPrice: null,
        latestBarAt: null,
        barsSinceSignal: null,
        fresh: false,
        status: "pending",
        active: true,
        lastEvaluatedAt: evaluatedAt,
        lastError: null,
      };
    })
    .filter(Boolean);
}

const isHydratedState = (state) =>
  Boolean(
    state &&
      state.active !== false &&
      !NON_HYDRATED_MATRIX_STATUSES.has(normalizeSignalStatus(state)) &&
      (state.latestBarAt ||
        state.currentSignalAt ||
        (normalizeSignalStatus(state) === "unavailable" &&
          (state.lastEvaluatedAt || state.lastError))),
  );

const isRecentlySettledUnavailableState = (state, timeframe, nowMs, pollMs) => {
  if (!state || normalizeSignalStatus(state) !== "unavailable") {
    return false;
  }
  const lastEvaluatedMs = Date.parse(state?.lastEvaluatedAt || "");
  if (!Number.isFinite(nowMs) || !Number.isFinite(lastEvaluatedMs)) {
    return Boolean(state.lastError);
  }
  const retryAfterMs = Math.max(
    Number.isFinite(pollMs) && pollMs > 0 ? pollMs * 2 : 0,
    5 * 60_000,
  );
  return nowMs - lastEvaluatedMs <= retryAfterMs;
};

const resolveCandleRefreshGraceMs = (pollMs) => {
  const pollGraceMs =
    Number.isFinite(pollMs) && pollMs > 0
      ? Math.ceil(pollMs / 3)
      : SIGNAL_MATRIX_CANDLE_REFRESH_GRACE_MS;
  return Math.max(
    SIGNAL_MATRIX_CANDLE_REFRESH_GRACE_MS,
    Math.min(pollGraceMs, SIGNAL_MATRIX_CANDLE_REFRESH_MAX_GRACE_MS),
  );
};

const stateNeedsRefresh = (state, timeframe, nowMs, pollMs) => {
  if (isRecentlySettledUnavailableState(state, timeframe, nowMs, pollMs)) {
    return false;
  }
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
  const timeframeMs = SIGNAL_MATRIX_TIMEFRAME_MS[timeframe] || 5 * 60_000;
  const nextExpectedBarMs = latestBarMs + timeframeMs;
  const lastEvaluatedMs = Date.parse(state?.lastEvaluatedAt || "");
  const graceMs = resolveCandleRefreshGraceMs(pollMs);
  const retryCooldownMs = Math.max(
    Number.isFinite(pollMs) && pollMs > 0
      ? pollMs
      : SIGNAL_MATRIX_RETRY_COOLDOWN_FALLBACK_MS,
    graceMs,
  );
  if (
    Number.isFinite(lastEvaluatedMs) &&
    lastEvaluatedMs >= nextExpectedBarMs &&
    nowMs - lastEvaluatedMs < retryCooldownMs
  ) {
    return false;
  }
  return nowMs >= nextExpectedBarMs + graceMs;
};

const missingTimeframesForSymbol = (
  symbol,
  hydrationMap,
  timeframes,
  options = {},
) => {
  const byTimeframe = hydrationMap.get(symbol) || {};
  return timeframes.filter((timeframe) =>
    stateNeedsRefresh(
      byTimeframe[timeframe],
      timeframe,
      options.nowMs,
      options.pollMs,
    ),
  );
};

const buildMissingTimeframesBySymbol = ({
  symbols,
  hydrationMap,
  timeframes,
  nowMs,
  pollMs,
}) => {
  const bySymbol = new Map();
  symbols.forEach((symbol) => {
    const missingTimeframes = missingTimeframesForSymbol(
      symbol,
      hydrationMap,
      timeframes,
      { nowMs, pollMs },
    );
    if (missingTimeframes.length) {
      bySymbol.set(symbol, missingTimeframes);
    }
  });
  return bySymbol;
};

const missingCellsForSymbols = (symbols, missingTimeframesBySymbol) =>
  symbols.flatMap((symbol) =>
    (missingTimeframesBySymbol.get(symbol) || []).map((timeframe) => ({
      symbol,
      timeframe,
    })),
  );

const uniqueCells = (cells = [], options = {}) => {
  const universeSet = options.universeSet || null;
  const timeframeSet = options.timeframeSet || null;
  const seen = new Set();
  const result = [];
  (Array.isArray(cells) ? cells : []).forEach((cell) => {
    const symbol = normalizeSymbol(cell?.symbol);
    const timeframe = String(cell?.timeframe || "").trim();
    if (
      !symbol ||
      !timeframe ||
      (universeSet && !universeSet.has(symbol)) ||
      (timeframeSet && !timeframeSet.has(timeframe))
    ) {
      return;
    }
    const key = `${symbol}:${timeframe}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push({ symbol, timeframe });
  });
  return result;
};

const selectExactCells = ({ cells, symbolLimit = null, cellLimit = null }) => {
  const selectedCells = [];
  const selectedSymbols = new Set();
  for (const cell of cells) {
    const introducesSymbol = !selectedSymbols.has(cell.symbol);
    if (
      symbolLimit != null &&
      introducesSymbol &&
      selectedSymbols.size >= symbolLimit
    ) {
      continue;
    }
    if (cellLimit != null && selectedCells.length >= cellLimit) {
      break;
    }
    selectedSymbols.add(cell.symbol);
    selectedCells.push(cell);
  }
  return selectedCells;
};

const selectMissingCellsForRotatedSymbols = ({
  symbols,
  cursor = 0,
  missingTimeframesBySymbol,
  cellLimit,
  symbolLimit,
}) => {
  if (!symbols.length || cellLimit <= 0 || symbolLimit <= 0) {
    return { symbols: [], cells: [], nextCursor: cursor || 0 };
  }

  const start = Math.max(0, cursor || 0) % symbols.length;
  const selectedSymbols = [];
  const cells = [];
  let inspected = 0;

  while (
    inspected < symbols.length &&
    cells.length < cellLimit &&
    selectedSymbols.length < symbolLimit
  ) {
    const symbol = symbols[(start + inspected) % symbols.length];
    inspected += 1;
    const missingTimeframes = missingTimeframesBySymbol.get(symbol) || [];
    if (!missingTimeframes.length) {
      continue;
    }

    let selectedForSymbol = false;
    for (const timeframe of missingTimeframes) {
      if (cells.length >= cellLimit) {
        break;
      }
      cells.push({ symbol, timeframe });
      selectedForSymbol = true;
    }
    if (selectedForSymbol) {
      selectedSymbols.push(symbol);
    }
  }

  return {
    symbols: selectedSymbols,
    cells,
    nextCursor: (start + inspected) % symbols.length,
  };
};

export function buildSignalMatrixExactRequestPlan({
  cells = [],
  symbols = [],
  prioritySymbols = [],
  timeframes = DEFAULT_SIGNAL_MATRIX_TIMEFRAMES,
  pressureLevel = "normal",
  backgroundReady = false,
  startupProtectionActive = false,
  requestSymbolLimit = null,
  requestTaskLimit = null,
  requestExactCellLimit = null,
} = {}) {
  const matrixTimeframes = normalizeTimeframes(timeframes);
  const timeframeSet = new Set(matrixTimeframes);
  const universeFromCells = uniqueSymbols(
    (Array.isArray(cells) ? cells : []).map((cell) => cell?.symbol),
  );
  const universe = uniqueSymbols(symbols).length
    ? uniqueSymbols(symbols)
    : universeFromCells;
  const universeSet = new Set(universe);
  const normalizedCells = uniqueCells(cells, { universeSet, timeframeSet });
  const explicitRequestLimit = normalizeRequestLimit(requestSymbolLimit);
  const explicitRequestTaskLimit = normalizeRequestLimit(requestTaskLimit);
  const explicitExactCellLimit = normalizeRequestLimit(requestExactCellLimit);
  const resolvedCellLimit =
    explicitExactCellLimit ?? explicitRequestTaskLimit ?? null;
  const selectedCells = selectExactCells({
    cells: normalizedCells,
    symbolLimit: explicitRequestLimit,
    cellLimit: resolvedCellLimit,
  });
  const requestSymbols = uniqueSymbols(selectedCells.map((cell) => cell.symbol));
  const requestedTimeframeSet = new Set(
    selectedCells.map((cell) => cell.timeframe),
  );
  const requestTimeframes = selectedCells.length
    ? matrixTimeframes.filter((timeframe) => requestedTimeframeSet.has(timeframe))
    : [];
  const selectedCellKeys = new Set(selectedCells.map(cellKey));
  const queuedTaskCount = normalizedCells.filter(
    (cell) => !selectedCellKeys.has(cellKey(cell)),
  ).length;
  const missingSymbols = uniqueSymbols(normalizedCells.map((cell) => cell.symbol));
  const queuedSymbols = missingSymbols.filter((symbol) =>
    normalizedCells.some(
      (cell) => cell.symbol === symbol && !selectedCellKeys.has(cellKey(cell)),
    ),
  ).length;
  const totalTaskCount = universe.length * matrixTimeframes.length;

  return {
    requestSymbols,
    prioritySymbols: uniqueSymbols(prioritySymbols).filter((symbol) =>
      universeSet.has(symbol),
    ),
    backgroundSymbols: [],
    timeframes: requestTimeframes,
    matrixTimeframes,
    requestCells: selectedCells,
    missingCells: normalizedCells,
    nextCursor: 0,
    backgroundReady: Boolean(backgroundReady),
    backgroundPaused: Boolean(startupProtectionActive),
    startupProtectionActive: Boolean(startupProtectionActive),
    pressureLevel: normalizePressureLevel(pressureLevel),
    coverage: {
      totalSymbols: universe.length,
      prioritySymbols: uniqueSymbols(prioritySymbols).filter((symbol) =>
        universeSet.has(symbol),
      ).length,
      backgroundSymbols: 0,
      requestSymbols: requestSymbols.length,
      selectedTimeframe: null,
      selectedTimeframes: requestTimeframes,
      baseRequestSymbolLimit: explicitRequestLimit ?? universe.length,
      timeframeSymbolLimit: null,
      effectiveRequestSymbolLimit: explicitRequestLimit ?? universe.length,
      requestSymbolLimit: explicitRequestLimit,
      exactCellLimit: explicitExactCellLimit,
      requestTaskLimit: resolvedCellLimit ?? normalizedCells.length,
      requestTaskCount: selectedCells.length,
      requestedTaskCount: normalizedCells.length,
      queuedTaskCount,
      timeframes: requestTimeframes.length,
      matrixTimeframes: matrixTimeframes.length,
      hydratedTaskCount: Math.max(0, totalTaskCount - normalizedCells.length),
      missingTaskCount: normalizedCells.length,
      pendingTaskCount: queuedTaskCount,
      hydratedSymbols: Math.max(0, universe.length - missingSymbols.length),
      missingSymbols: missingSymbols.length,
      pendingSymbols: queuedSymbols,
      startupProtectionActive: Boolean(startupProtectionActive),
      estimatedFullCycleMs: null,
      exactCellRequest: true,
    },
  };
}

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
  requestExactCellLimit = null,
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
  const explicitExactCellLimit = normalizeRequestLimit(requestExactCellLimit);
  const pressureExactCellLimit =
    explicitExactCellLimit ?? SIGNAL_MATRIX_EXACT_CELL_LIMIT_BY_PRESSURE[normalizedPressureLevel];
  const explicitRequestTaskLimit = normalizeRequestLimit(requestTaskLimit);
  const explicitRequestLimit = normalizeRequestLimit(requestSymbolLimit);
  const normalizedNowMs = Number.isFinite(nowMs) ? nowMs : null;
  const missingTimeframesBySymbol = buildMissingTimeframesBySymbol({
    symbols: universe,
    hydrationMap,
    timeframes: matrixTimeframes,
    nowMs: normalizedNowMs,
    pollMs,
  });
  const needsHydration = (symbol) =>
    Boolean(missingTimeframesBySymbol.get(symbol)?.length);
  const missingSymbols = universe.filter(needsHydration);
  const missingCells = missingCellsForSymbols(
    missingSymbols,
    missingTimeframesBySymbol,
  );
  const pressureRequestTaskLimit = REQUEST_TASK_LIMIT_BY_PRESSURE[normalizedPressureLevel];
  const resolvedRequestTaskLimit =
    explicitRequestTaskLimit ??
    pressureRequestTaskLimit ??
    pressureExactCellLimit ??
    missingCells.length;
  const taskBoundSymbolLimit =
    resolvedRequestTaskLimit > 0 && matrixTimeframes.length
      ? Math.max(1, Math.floor(resolvedRequestTaskLimit / matrixTimeframes.length))
      : universe.length;
  const baseRequestLimit = Math.min(
    explicitRequestLimit ?? taskBoundSymbolLimit,
    taskBoundSymbolLimit,
  );
  const selectionSymbolLimit = explicitRequestLimit ?? universe.length;
  const priorityCandidates = startupProtected
    ? []
    : orderedPriority.filter(needsHydration);
  const priorityCandidateSet = new Set(priorityCandidates);
  const backgroundUniverse = universe.filter(
    (symbol) => !priorityCandidateSet.has(symbol),
  );
  const missingBackgroundUniverse = backgroundUniverse.filter(needsHydration);
  const backgroundAllowed =
    !startupProtected &&
    Boolean(backgroundReady);
  const prioritySelection = selectMissingCellsForRotatedSymbols({
    symbols: priorityCandidates,
    cursor,
    missingTimeframesBySymbol,
    cellLimit: resolvedRequestTaskLimit,
    symbolLimit: selectionSymbolLimit,
  });
  const priorityBatch = prioritySelection.symbols;
  const prioritySet = new Set(priorityBatch);
  const backgroundCandidates = missingBackgroundUniverse.filter(
    (symbol) => !prioritySet.has(symbol),
  );
  const backgroundTaskLimit = Math.max(
    0,
    resolvedRequestTaskLimit - prioritySelection.cells.length,
  );
  const backgroundLimit = Math.max(0, selectionSymbolLimit - priorityBatch.length);
  const background = backgroundAllowed
    ? selectMissingCellsForRotatedSymbols({
        symbols: backgroundCandidates,
        cursor,
        missingTimeframesBySymbol,
        cellLimit: backgroundTaskLimit,
        symbolLimit: backgroundLimit,
      })
    : { symbols: [], cells: [], nextCursor: cursor || 0 };
  const nextCursor =
    priorityCandidates.length > priorityBatch.length
      ? prioritySelection.nextCursor
      : background.nextCursor;
  const requestCells = [...prioritySelection.cells, ...background.cells];
  const requestSymbols = uniqueSymbols(requestCells.map((cell) => cell.symbol));
  const requestedTimeframeSet = new Set(
    requestCells.map((cell) => cell.timeframe),
  );
  const requestTimeframes = requestCells.length
    ? matrixTimeframes.filter((timeframe) => requestedTimeframeSet.has(timeframe))
    : [];
  const selectedCellKeys = new Set(requestCells.map(cellKey));
  const requestedTaskCount = missingCells.length;
  const queuedTaskCount = missingCells.filter(
    (cell) => !selectedCellKeys.has(cellKey(cell)),
  ).length;
  const queuedSymbols = missingSymbols.filter((symbol) =>
    (missingTimeframesBySymbol.get(symbol) || []).some(
      (timeframe) => !selectedCellKeys.has(`${symbol}:${timeframe}`),
    ),
  ).length;
  const totalTaskCount = universe.length * matrixTimeframes.length;
  const hydratedTaskCount = Math.max(0, totalTaskCount - requestedTaskCount);

  return {
    requestSymbols,
    prioritySymbols: priorityBatch,
    backgroundSymbols: background.symbols,
    timeframes: requestTimeframes,
    matrixTimeframes,
    requestCells,
    missingCells,
    nextCursor,
    backgroundReady: backgroundAllowed,
    backgroundPaused: !backgroundAllowed || background.symbols.length === 0,
    startupProtectionActive: startupProtected,
    pressureLevel: normalizedPressureLevel,
    coverage: {
      totalSymbols: universe.length,
      prioritySymbols: priorityBatch.length,
      backgroundSymbols: background.symbols.length,
      requestSymbols: requestSymbols.length,
      selectedTimeframe:
        requestTimeframes.length === 1 ? requestTimeframes[0] : null,
      selectedTimeframes: requestTimeframes,
      baseRequestSymbolLimit: baseRequestLimit,
      timeframeSymbolLimit: null,
      effectiveRequestSymbolLimit: baseRequestLimit,
      requestSymbolLimit: baseRequestLimit,
      exactCellLimit: pressureExactCellLimit,
      requestTaskLimit: resolvedRequestTaskLimit,
      requestTaskCount: requestCells.length,
      requestedTaskCount,
      queuedTaskCount,
      timeframes: requestTimeframes.length,
      matrixTimeframes: matrixTimeframes.length,
      hydratedTaskCount,
      missingTaskCount: requestedTaskCount,
      pendingTaskCount: queuedTaskCount,
      hydratedSymbols: Math.max(0, universe.length - missingSymbols.length),
      missingSymbols: missingSymbols.length,
      pendingSymbols: queuedSymbols,
      startupProtectionActive: startupProtected,
      estimatedFullCycleMs:
        pollMs > 0 && requestedTaskCount > 0 && requestCells.length > 0
          ? Math.ceil(requestedTaskCount / requestCells.length) * pollMs
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
    if (
      !current ||
      (isPendingSignalMatrixState(current) && !isPendingSignalMatrixState(state)) ||
      readStateTimeMs(state) >= readStateTimeMs(current)
    ) {
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
