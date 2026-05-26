const DEFAULT_BATCH_SIZE = 40;
const DEFAULT_CYCLE_WINDOW_MS = 60_000;

const normalizeSymbol = (symbol) =>
  symbol?.trim?.().toUpperCase?.() || "";

export const WATCHLIST_QUOTE_STREAM_BATCH_SIZE = DEFAULT_BATCH_SIZE;
export const WATCHLIST_QUOTE_STREAM_ROTATION_MS = 4_000;
export const WATCHLIST_QUOTE_STREAM_CYCLE_WINDOW_MS = DEFAULT_CYCLE_WINDOW_MS;

export const uniqueNormalizedSymbols = (symbols = []) => {
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

export function buildWatchlistQuoteRotationBatch({
  watchlistSymbols = [],
  pinnedSymbols = [],
  cursor = 0,
  batchSize = DEFAULT_BATCH_SIZE,
} = {}) {
  const cap = Math.max(1, Math.floor(Number(batchSize) || DEFAULT_BATCH_SIZE));
  const universe = uniqueNormalizedSymbols(watchlistSymbols);
  const orderedPins = uniqueNormalizedSymbols(pinnedSymbols);
  const batch = orderedPins.slice(0, cap);
  const batchSet = new Set(batch);
  const pinOverflowSymbols = orderedPins.slice(cap);
  const rotatingUniverse = universe.filter((symbol) => !batchSet.has(symbol));
  const rotatingSlots = Math.max(0, cap - batch.length);
  const start = rotatingUniverse.length
    ? Math.max(0, Math.floor(Number(cursor) || 0)) % rotatingUniverse.length
    : 0;
  const rotatingSymbols = [];

  for (
    let index = 0;
    index < Math.min(rotatingSlots, rotatingUniverse.length);
    index += 1
  ) {
    rotatingSymbols.push(rotatingUniverse[(start + index) % rotatingUniverse.length]);
  }
  rotatingSymbols.forEach((symbol) => {
    if (!batchSet.has(symbol)) {
      batchSet.add(symbol);
      batch.push(symbol);
    }
  });

  return {
    symbols: batch,
    pinnedSymbols: batch.filter((symbol) => orderedPins.includes(symbol)),
    pinOverflowSymbols,
    rotatingSymbols,
    rotatingUniverseSize: rotatingUniverse.length,
    batchSize: batch.length,
    batchCap: cap,
    nextCursor: rotatingUniverse.length
      ? (start + rotatingSymbols.length) % rotatingUniverse.length
      : 0,
    universeSize: universe.length,
  };
}

export function buildWatchlistQuoteRotationDiagnostics({
  batch = {},
  watchlistSymbols = [],
  lastTouchedAtBySymbol = {},
  nowMs = Date.now(),
  cycleWindowMs = DEFAULT_CYCLE_WINDOW_MS,
  disabledReason = null,
} = {}) {
  const universe = uniqueNormalizedSymbols(watchlistSymbols);
  const cutoff = Math.max(0, nowMs - Math.max(1, cycleWindowMs));
  const touchedSymbols = universe.filter((symbol) => {
    const touchedAt = Date.parse(String(lastTouchedAtBySymbol[symbol] || ""));
    return Number.isFinite(touchedAt) && touchedAt >= cutoff;
  });

  return {
    disabledReason,
    currentBatch: batch.symbols || [],
    batchSize: batch.batchSize ?? 0,
    batchCap: batch.batchCap ?? DEFAULT_BATCH_SIZE,
    pinnedSymbols: batch.pinnedSymbols || [],
    pinOverflowSymbols: batch.pinOverflowSymbols || [],
    rotatingSymbols: batch.rotatingSymbols || [],
    rotatingUniverseSize: batch.rotatingUniverseSize ?? 0,
    universeSize: universe.length,
    cycleWindowMs,
    cycleCoverageCount: touchedSymbols.length,
    cycleCoveragePct: universe.length
      ? Math.round((touchedSymbols.length / universe.length) * 1000) / 10
      : 100,
    lastTouchedAtBySymbol,
  };
}
