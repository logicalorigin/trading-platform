import {
  SIGNALS_TABLE_TIMEFRAMES,
  normalizeSignalsTicker,
} from "./signalsRowModel.js";

export const SIGNALS_MATRIX_HYDRATION_CHUNK_SIZE = null;
export const SIGNALS_MATRIX_HYDRATION_PRIORITY_CHUNK_SIZE = null;

const stateTimeframe = (state) => String(state?.timeframe || "").trim();

const hasComputedMatrixState = (state) =>
  Boolean(
    state &&
      stateTimeframe(state) &&
      (
        state.latestBarAt ||
        state.lastEvaluatedAt ||
        state.currentSignalAt ||
        state.lastError ||
        ["error", "unavailable", "unknown"].includes(
          String(state.status || "").toLowerCase(),
        )
      ),
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
    if (!symbol || !timeframe || !hasComputedMatrixState(state)) return;
    const current = bySymbol.get(symbol) ?? new Set();
    current.add(timeframe);
    bySymbol.set(symbol, current);
  });
  return bySymbol;
};

const normalizeRequestLimit = (value) => {
  if (value == null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(1, Math.floor(numeric));
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

  normalizedSymbols.forEach((symbol) => {
    const computedTimeframes = computedBySymbol.get(symbol);
    if (
      computedTimeframes &&
      matrixTimeframes.every((timeframe) => computedTimeframes.has(timeframe))
    ) {
      hydratedSymbols.push(symbol);
      return;
    }
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

  return {
    symbols: normalizedSymbols,
    timeframes: matrixTimeframes,
    chunkSize: normalizedChunkSize,
    priorityChunkSize: normalizedPriorityChunkSize,
    hydratedSymbols,
    missingSymbols,
    priorityMissingSymbols,
    requestSymbols: [
      ...priorityMissingSymbols,
      ...backgroundMissingSymbols,
    ].slice(0, requestLimit),
  };
}
