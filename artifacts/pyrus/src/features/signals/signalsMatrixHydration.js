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
const NON_HYDRATED_MATRIX_STATUSES = new Set([
  "error",
  "unknown",
]);

const hasHydratedMatrixState = (state) =>
  Boolean(
    state &&
      stateTimeframe(state) &&
      state.active !== false &&
      !NON_HYDRATED_MATRIX_STATUSES.has(normalizeSignalStatus(state)) &&
      (state.latestBarAt ||
        state.currentSignalAt ||
        (normalizeSignalStatus(state) === "unavailable" &&
          (state.lastEvaluatedAt || state.lastError))),
  );

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

const buildComputedTimeframesBySymbol = (states = []) => {
  const bySymbol = new Map();
  (Array.isArray(states) ? states : []).forEach((state) => {
    const symbol = normalizeSignalsTicker(state?.symbol);
    const timeframe = stateTimeframe(state);
    if (!symbol || !timeframe || !hasHydratedMatrixState(state)) return;
    const current = bySymbol.get(symbol) ?? new Set();
    current.add(timeframe);
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
  const normalizedPrioritySymbols = uniqueSymbols(prioritySymbols);
  const normalizedSymbols = uniqueSymbols([
    ...normalizedPrioritySymbols,
    ...symbols,
  ]);
  const computedBySymbol = buildComputedTimeframesBySymbol(currentStates);
  const hydratedSymbols = [];
  const missingSymbols = [];
  const hydratedCells = [];
  const missingCells = [];
  const hydratedTimeframesBySymbol = {};
  const missingCellsBySymbol = new Map();

  normalizedSymbols.forEach((symbol) => {
    const computedTimeframes = computedBySymbol.get(symbol);
    const symbolHydratedCells = [];
    const symbolMissingCells = [];
    matrixTimeframes.forEach((timeframe) => {
      const cell = { symbol, timeframe };
      if (computedTimeframes?.has(timeframe)) {
        symbolHydratedCells.push(cell);
        hydratedCells.push(cell);
        return;
      }
      symbolMissingCells.push(cell);
      missingCells.push(cell);
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
  const priorityMissingSymbols = missingSymbols.filter((symbol) =>
    prioritySymbolSet.has(symbol),
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
    hydratedTimeframesBySymbol,
    missingTimeframesBySymbol: indexCellsBySymbol(missingCells),
    priorityMissingSymbols,
    requestSymbols,
  };
}
