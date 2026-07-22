// Uncapped by design. Massive's documented WebSocket constraint is CONNECTION
// COUNT per asset class (default 1 — contact support to raise), while symbol/ticker
// subscriptions on a single connection are effectively unlimited for stocks (the only
// documented per-connection cap is 1,000 Options-Quote contracts). Pyrus already uses
// one shared Massive stocks socket, so a symbol cap here does NOTHING for the real
// connection limit and only starves visible watchlist rows of live quotes. This was
// deliberately set to null on 2026-06-04 ("frontend quote rotation defaults to
// uncapped"); a 64 cap re-introduced that artificial fanout reduction. Keep null.
const DEFAULT_BATCH_SIZE = null;
const DEFAULT_CYCLE_WINDOW_MS = 60_000;

const normalizeSymbol = (symbol) =>
  symbol?.trim?.().toUpperCase?.() || "";

const NON_LIVE_QUOTE_STATES = new Set([
  "frozen",
  "delayed",
  "delayed_frozen",
  "unavailable",
]);

const realtimeQuoteState = (quote) => {
  const transport = String(quote?.transport || "").toLowerCase();
  const freshness = String(quote?.freshness || "").toLowerCase();
  const marketDataMode = String(quote?.marketDataMode || "").toLowerCase();
  if (
    NON_LIVE_QUOTE_STATES.has(freshness) ||
    NON_LIVE_QUOTE_STATES.has(marketDataMode)
  ) {
    return "non-live";
  }
  if (
    freshness === "live" ||
    marketDataMode === "live" ||
    transport.includes("websocket") ||
    transport.includes("stream")
  ) {
    return "live";
  }
  return null;
};

export const WATCHLIST_QUOTE_STREAM_BATCH_SIZE = DEFAULT_BATCH_SIZE;
export const WATCHLIST_QUOTE_STREAM_ROTATION_MS = 4_000;
export const WATCHLIST_QUOTE_STREAM_CYCLE_WINDOW_MS = DEFAULT_CYCLE_WINDOW_MS;

export function reconcileRealtimeQuoteCoverage({
  deliveredAtBySymbol = new Map(),
  quotes = [],
  nowMs = Date.now(),
  maxAgeMs = WATCHLIST_QUOTE_STREAM_CYCLE_WINDOW_MS,
} = {}) {
  const next = new Map(deliveredAtBySymbol);
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const maxAge = Math.max(0, Number(maxAgeMs) || 0);

  (Array.isArray(quotes) ? quotes : []).forEach((quote) => {
    const symbol = normalizeSymbol(quote?.symbol);
    if (!symbol) return;
    const state = realtimeQuoteState(quote);
    if (state === "live") {
      next.set(symbol, now);
    } else if (state === "non-live") {
      next.delete(symbol);
    }
  });

  next.forEach((deliveredAt, symbol) => {
    if (!Number.isFinite(deliveredAt) || now - deliveredAt >= maxAge) {
      next.delete(symbol);
    }
  });
  return next;
}

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

export function resolveWatchlistQuoteStreamBatchSize({
  defaultBatchSize = DEFAULT_BATCH_SIZE,
  activeVisibleSymbolCount = 0,
} = {}) {
  const requestedCap = Number(defaultBatchSize);
  if (!Number.isFinite(requestedCap) || requestedCap <= 0) {
    return null;
  }

  const activeVisibleCount = Number(activeVisibleSymbolCount);
  const activeVisibleFloor =
    Number.isFinite(activeVisibleCount) && activeVisibleCount > 0
      ? Math.floor(activeVisibleCount)
      : 0;
  return Math.max(1, Math.floor(requestedCap), activeVisibleFloor);
}

export function splitRealtimeAwareRestQuoteSymbols({
  quoteSymbols = [],
  streamCoveredSymbols = [],
  activeVisibleSymbols = [],
  realtimeRequired = false,
} = {}) {
  const streamCoveredSet = new Set(uniqueNormalizedSymbols(streamCoveredSymbols));
  const activeVisibleSet = new Set(uniqueNormalizedSymbols(activeVisibleSymbols));
  const restQuoteSymbols = [];
  const missingRealtimeVisibleSymbols = [];

  uniqueNormalizedSymbols(quoteSymbols).forEach((symbol) => {
    if (streamCoveredSet.has(symbol)) {
      return;
    }
    if (realtimeRequired && activeVisibleSet.has(symbol)) {
      missingRealtimeVisibleSymbols.push(symbol);
    }
    restQuoteSymbols.push(symbol);
  });

  return {
    restQuoteSymbols,
    missingRealtimeVisibleSymbols,
  };
}

export function buildVisibleRealtimeCoverageDiagnostics({
  activeVisibleSymbols = [],
  streamCoveredSymbols = [],
  realtimeRequired = false,
  disabledReason = null,
} = {}) {
  const activeSymbols = uniqueNormalizedSymbols(activeVisibleSymbols);
  const streamCoveredSet = new Set(uniqueNormalizedSymbols(streamCoveredSymbols));
  const missingSymbols = activeSymbols.filter(
    (symbol) => !streamCoveredSet.has(symbol),
  );

  return {
    required: Boolean(realtimeRequired),
    complete: !realtimeRequired || missingSymbols.length === 0,
    activeSymbolCount: activeSymbols.length,
    coveredSymbolCount: activeSymbols.length - missingSymbols.length,
    missingSymbols,
    disabledReason,
  };
}

export function buildWatchlistQuoteRotationBatch({
  watchlistSymbols = [],
  rotationSymbols = watchlistSymbols,
  pinnedSymbols = [],
  cursor = 0,
  batchSize = DEFAULT_BATCH_SIZE,
} = {}) {
  const requestedCap = Number(batchSize);
  const capped = Number.isFinite(requestedCap) && requestedCap > 0;
  const cap = capped ? Math.max(1, Math.floor(requestedCap)) : null;
  const universe = uniqueNormalizedSymbols(rotationSymbols);
  const orderedPins = uniqueNormalizedSymbols(pinnedSymbols);
  const batch = capped ? orderedPins.slice(0, cap) : orderedPins.slice();
  const batchSet = new Set(batch);
  const pinOverflowSymbols = capped ? orderedPins.slice(cap) : [];
  const rotatingUniverse = universe.filter((symbol) => !batchSet.has(symbol));
  const rotatingSlots = capped ? Math.max(0, cap - batch.length) : rotatingUniverse.length;
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
    capped,
    nextCursor: rotatingUniverse.length
      ? (start + rotatingSymbols.length) % rotatingUniverse.length
      : 0,
    universeSize: universe.length,
  };
}

export function buildWatchlistQuoteRotationDiagnostics({
  batch = {},
  watchlistSymbols = [],
  rotationSymbols = watchlistSymbols,
  lastTouchedAtBySymbol = {},
  nowMs = Date.now(),
  cycleWindowMs = DEFAULT_CYCLE_WINDOW_MS,
  disabledReason = null,
} = {}) {
  const universe = uniqueNormalizedSymbols(rotationSymbols);
  const cutoff = Math.max(0, nowMs - Math.max(1, cycleWindowMs));
  const touchedSymbols = universe.filter((symbol) => {
    const touchedAt = Date.parse(String(lastTouchedAtBySymbol[symbol] || ""));
    return Number.isFinite(touchedAt) && touchedAt >= cutoff;
  });

  return {
    disabledReason,
    currentBatch: batch.symbols || [],
    batchSize: batch.batchSize ?? 0,
    batchCap: batch.batchCap ?? null,
    capped: batch.capped === true,
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
