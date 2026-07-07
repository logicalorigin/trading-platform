import {
  SIGNALS_TABLE_TIMEFRAMES,
  normalizeSignalsTicker,
} from "./signalsRowModel.js";
import {
  normalizeSignalStatus,
} from "./signalStateFreshness.js";

export const SIGNALS_MATRIX_HYDRATION_CHUNK_SIZE = null;
export const SIGNALS_MATRIX_HYDRATION_PRIORITY_CHUNK_SIZE = null;

const stateTimeframe = (state) => String(state?.timeframe || "").trim();
const hasHydratedMatrixState = (state, options = {}) =>
  Boolean(state && stateTimeframe(state) && isRenderableMatrixState(state, options));

const isRenderableMatrixState = (state, options = {}) => {
  const status = normalizeSignalStatus(state);
  if (options.refreshStale && status === "stale") {
    return false;
  }
  return Boolean(
    state?.active !== false &&
      (status === "ok" || status === "stale" || status === "idle") &&
      !state?.lastError &&
      (state?.latestBarAt || state?.currentSignalAt),
  );
};

const uniqueSymbols = (symbols = []) => {
  const seen = new Set();
  const result = [];
  (Array.isArray(symbols) ? symbols : []).forEach((symbol) => {
    const normalized = normalizeSignalsTicker(symbol);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    result.push(normalized);
  });
  return result;
};

export function buildSignalsHydrationManifest({
  currentSymbols = [],
  nextSymbols = [],
  reset = false,
} = {}) {
  const baseSymbols = reset ? [] : uniqueSymbols(currentSymbols);
  const seen = new Set(baseSymbols);
  const result = [...baseSymbols];
  uniqueSymbols(nextSymbols).forEach((symbol) => {
    if (seen.has(symbol)) return;
    seen.add(symbol);
    result.push(symbol);
  });
  return result;
}

export function buildSignalsPriorityHydrationSymbols({
  selectedSymbol = "",
  expandedSymbol = "",
  candidateSymbols = [],
  scopeSymbols = [],
} = {}) {
  const scopeSet = new Set(uniqueSymbols(scopeSymbols));
  const seen = new Set();
  const result = [];
  [
    selectedSymbol,
    expandedSymbol,
    ...(Array.isArray(candidateSymbols) ? candidateSymbols : []),
  ].forEach((symbol) => {
    const normalized = normalizeSignalsTicker(symbol);
    if (
      !normalized ||
      (scopeSet.size && !scopeSet.has(normalized)) ||
      seen.has(normalized)
    ) {
      return;
    }
    seen.add(normalized);
    result.push(normalized);
  });
  return result;
}

const buildComputedStatesBySymbol = (states = [], options = {}) => {
  const bySymbol = new Map();
  (Array.isArray(states) ? states : []).forEach((state) => {
    const symbol = normalizeSignalsTicker(state?.symbol);
    const timeframe = stateTimeframe(state);
    if (!symbol || !timeframe || !hasHydratedMatrixState(state, options)) return;
    const current = bySymbol.get(symbol) ?? new Map();
    current.set(timeframe, state);
    bySymbol.set(symbol, current);
  });
  return bySymbol;
};

const indexCellsBySymbol = (cells) => {
  const bySymbol = {};
  cells.forEach(({ symbol, timeframe }) => {
    if (!bySymbol[symbol]) {
      bySymbol[symbol] = [];
    }
    bySymbol[symbol].push(timeframe);
  });
  return bySymbol;
};

const normalizeRequestLimit = (value) => {
  if (value == null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(1, Math.floor(numeric));
};

export const prioritizeSignalMatrixTimeframes = (
  timeframes = SIGNALS_TABLE_TIMEFRAMES,
  priorityTimeframes = [],
) => {
  const allowed = new Set(SIGNALS_TABLE_TIMEFRAMES);
  const normalizedTimeframes = Array.from(
    new Set(
      (Array.isArray(timeframes) && timeframes.length
        ? timeframes
        : SIGNALS_TABLE_TIMEFRAMES
      )
        .map((timeframe) => String(timeframe || "").trim())
        .filter((timeframe) => allowed.has(timeframe)),
    ),
  );
  const scopedTimeframes = normalizedTimeframes.length
    ? normalizedTimeframes
    : [...SIGNALS_TABLE_TIMEFRAMES];
  const prioritySet = new Set(
    (Array.isArray(priorityTimeframes) ? priorityTimeframes : [])
      .map((timeframe) => String(timeframe || "").trim())
      .filter((timeframe) => scopedTimeframes.includes(timeframe)),
  );
  return [
    ...scopedTimeframes.filter((timeframe) => prioritySet.has(timeframe)),
    ...scopedTimeframes.filter((timeframe) => !prioritySet.has(timeframe)),
  ];
};

const selectRequestCellsForSymbols = ({
  symbols,
  missingCellsBySymbol,
  limit,
}) => {
  const selectedCells = [];
  const selectedSymbols = new Set();
  symbols.forEach((symbol) => {
    if (selectedSymbols.has(symbol)) return;
    if (limit != null && selectedSymbols.size >= limit) return;
    const cells = missingCellsBySymbol.get(symbol) || [];
    if (!cells.length) return;
    selectedSymbols.add(symbol);
    selectedCells.push(...cells);
  });
  return selectedCells;
};

export function buildSignalsMatrixHydrationPlan({
  symbols = [],
  prioritySymbols = [],
  currentStates = [],
  timeframes = SIGNALS_TABLE_TIMEFRAMES,
  refreshStale = false,
  chunkSize = SIGNALS_MATRIX_HYDRATION_CHUNK_SIZE,
  priorityChunkSize = SIGNALS_MATRIX_HYDRATION_PRIORITY_CHUNK_SIZE,
} = {}) {
  const requestedTimeframes = Array.from(
    new Set(
      (Array.isArray(timeframes) && timeframes.length
        ? timeframes
        : SIGNALS_TABLE_TIMEFRAMES
      )
        .map((timeframe) => String(timeframe || "").trim())
        .filter((timeframe) => SIGNALS_TABLE_TIMEFRAMES.includes(timeframe)),
    ),
  );
  const matrixTimeframes = requestedTimeframes.length
    ? requestedTimeframes
    : [...SIGNALS_TABLE_TIMEFRAMES];
  const normalizedScopeSymbols = uniqueSymbols(symbols);
  const normalizedSymbols = normalizedScopeSymbols.length
    ? normalizedScopeSymbols
    : uniqueSymbols(prioritySymbols);
  const scopeSymbolSet = new Set(normalizedSymbols);
  const normalizedPrioritySymbols = uniqueSymbols(prioritySymbols).filter(
    (symbol) => scopeSymbolSet.has(symbol),
  );
  const computedBySymbol = buildComputedStatesBySymbol(currentStates, {
    refreshStale,
  });
  const hydratedSymbols = [];
  const missingSymbols = [];
  const hydratedCells = [];
  const missingCells = [];
  const hydratedCellCountsByTimeframe = new Map(
    matrixTimeframes.map((timeframe) => [timeframe, 0]),
  );
  const missingCellCountsByTimeframe = new Map(
    matrixTimeframes.map((timeframe) => [timeframe, 0]),
  );
  const agedCellCountsByTimeframe = new Map(
    matrixTimeframes.map((timeframe) => [timeframe, 0]),
  );
  const hydratedTimeframesBySymbol = {};
  const missingCellsBySymbol = new Map();

  normalizedSymbols.forEach((symbol) => {
    const computedStates = computedBySymbol.get(symbol);
    const symbolHydratedCells = [];
    const symbolMissingCells = [];
    matrixTimeframes.forEach((timeframe) => {
      const cell = { symbol, timeframe };
      const computedState = computedStates?.get(timeframe);
      if (computedState) {
        symbolHydratedCells.push(cell);
        hydratedCells.push(cell);
        hydratedCellCountsByTimeframe.set(
          timeframe,
          (hydratedCellCountsByTimeframe.get(timeframe) || 0) + 1,
        );
        if (normalizeSignalStatus(computedState) === "stale") {
          agedCellCountsByTimeframe.set(
            timeframe,
            (agedCellCountsByTimeframe.get(timeframe) || 0) + 1,
          );
        }
        return;
      }
      symbolMissingCells.push(cell);
      missingCells.push(cell);
      missingCellCountsByTimeframe.set(
        timeframe,
        (missingCellCountsByTimeframe.get(timeframe) || 0) + 1,
      );
    });

    if (symbolHydratedCells.length) {
      hydratedTimeframesBySymbol[symbol] = symbolHydratedCells.map(
        (cell) => cell.timeframe,
      );
    }
    if (!symbolMissingCells.length) {
      hydratedSymbols.push(symbol);
      return;
    }
    missingCellsBySymbol.set(symbol, symbolMissingCells);
    missingSymbols.push(symbol);
  });

  const normalizedChunkSize = normalizeRequestLimit(chunkSize);
  const explicitPriorityChunkSize = normalizeRequestLimit(priorityChunkSize);
  const normalizedPriorityChunkSize =
    explicitPriorityChunkSize == null
      ? null
      : Math.max(normalizedChunkSize ?? 1, explicitPriorityChunkSize);
  const prioritySymbolSet = new Set(normalizedPrioritySymbols);
  const priorityMissingSymbols = normalizedPrioritySymbols.filter((symbol) =>
    missingCellsBySymbol.has(symbol),
  );
  const backgroundMissingSymbols = missingSymbols.filter((symbol) =>
    !prioritySymbolSet.has(symbol),
  );
  const requestLimit = priorityMissingSymbols.length
    ? (normalizedPriorityChunkSize ?? missingSymbols.length)
    : (normalizedChunkSize ?? missingSymbols.length);
  const requestSourceSymbols = priorityMissingSymbols.length
    ? priorityMissingSymbols
    : backgroundMissingSymbols;
  const requestCells = selectRequestCellsForSymbols({
    symbols: requestSourceSymbols,
    missingCellsBySymbol,
    limit: requestLimit,
  });
  const requestSymbols = uniqueSymbols(requestCells.map((cell) => cell.symbol));
  const requestTimeframes = [
    ...new Set(requestCells.map((cell) => cell.timeframe)),
  ];
  const requestCellCountsByTimeframe = requestCells.reduce((counts, cell) => {
    counts.set(cell.timeframe, (counts.get(cell.timeframe) || 0) + 1);
    return counts;
  }, new Map());
  const timeframeHydration = matrixTimeframes.map((timeframe) => {
    const hydrated = hydratedCellCountsByTimeframe.get(timeframe) || 0;
    const missing = missingCellCountsByTimeframe.get(timeframe) || 0;
    return {
      timeframe,
      hydrated,
      aged: agedCellCountsByTimeframe.get(timeframe) || 0,
      missing,
      requested: requestCellCountsByTimeframe.get(timeframe) || 0,
      total: hydrated + missing,
    };
  });

  return {
    symbols: normalizedSymbols,
    timeframes: matrixTimeframes,
    requestTimeframes,
    chunkSize: normalizedChunkSize,
    priorityChunkSize: normalizedPriorityChunkSize,
    hydratedSymbols,
    missingSymbols,
    hydratedCells,
    missingCells,
    requestCells,
    hydratedCellCount: hydratedCells.length,
    missingCellCount: missingCells.length,
    totalCellCount: normalizedSymbols.length * matrixTimeframes.length,
    timeframeHydration,
    hydratedTimeframesBySymbol,
    missingTimeframesBySymbol: indexCellsBySymbol(missingCells),
    priorityMissingSymbols,
    requestSymbols,
  };
}
