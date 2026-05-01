export const UNUSUAL_SCANNER_BATCH_SIZE = 30;
export const UNUSUAL_SCANNER_PER_SYMBOL_LIMIT = 25;
export const UNUSUAL_SCANNER_MAX_WATCHLIST = Number.POSITIVE_INFINITY;
export const UNUSUAL_SCANNER_INTERVAL_MS = 15_000;

export const FLOW_SCANNER_MODE = Object.freeze({
  watchlist: "watchlist",
  market: "market",
});

export const FLOW_SCANNER_SCOPE = Object.freeze({
  all: "all",
  unusual: "unusual",
});

export const FLOW_SCANNER_CONFIG_LIMITS = Object.freeze({
  maxSymbols: { min: 1, max: 2000 },
  batchSize: { min: 1, max: 250 },
  intervalMs: { min: 2_500, max: 120_000 },
  concurrency: { min: 1, max: 24 },
  limit: { min: 1, max: 1000 },
  unusualThreshold: { min: 0.1, max: 100 },
  minPremium: { min: 0, max: 50_000_000 },
  maxDte: { min: 0, max: 730 },
});

export const DEFAULT_FLOW_SCANNER_CONFIG = Object.freeze({
  mode: FLOW_SCANNER_MODE.market,
  scope: FLOW_SCANNER_SCOPE.unusual,
  maxSymbols: 500,
  batchSize: UNUSUAL_SCANNER_BATCH_SIZE,
  intervalMs: UNUSUAL_SCANNER_INTERVAL_MS,
  concurrency: 2,
  limit: UNUSUAL_SCANNER_PER_SYMBOL_LIMIT,
  unusualThreshold: 1,
  minPremium: 0,
  maxDte: null,
});

// Curated liquid-options pool used when the client does not receive a ranked
// backend universe. Watchlist symbols are still pinned ahead of this pool.
export const FLOW_SCANNER_MARKET_UNIVERSE_SYMBOLS = Object.freeze([
  "SPY", "QQQ", "IWM", "DIA", "TLT", "GLD", "SLV", "USO", "UNG", "VIXY",
  "XLK", "XLF", "XLE", "XLV", "XLY", "XLC", "XLI", "XLP", "XLB", "XLU",
  "XLRE", "SMH", "SOXX", "KRE", "XBI", "IBB", "HYG", "LQD", "ARKK", "TQQQ",
  "SQQQ", "UVXY", "AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "GOOG",
  "TSLA", "AMD", "AVGO", "NFLX", "ORCL", "CRM", "ADBE", "INTC", "QCOM",
  "MU", "ARM", "MRVL", "AMAT", "LRCX", "KLAC", "ASML", "TSM", "SHOP",
  "SNOW", "PLTR", "PANW", "CRWD", "NET", "DDOG", "MDB", "NOW", "ZS",
  "UBER", "ABNB", "DASH", "COIN", "HOOD", "MSTR", "MARA", "RIOT", "CLSK",
  "HUT", "IREN", "CIFR", "WULF", "JPM", "BAC", "WFC", "C", "GS", "MS",
  "SCHW", "AXP", "V", "MA", "PYPL", "SQ", "SOFI", "BX", "BLK", "KKR",
  "UNH", "LLY", "JNJ", "ABBV", "MRK", "PFE", "BMY", "GILD", "REGN", "VRTX",
  "ISRG", "TMO", "DHR", "HCA", "CVS", "CI", "ELV", "XOM", "CVX", "COP",
  "OXY", "SLB", "HAL", "MPC", "VLO", "EOG", "DVN", "FANG", "WMB", "LNG",
  "CAT", "DE", "BA", "GE", "RTX", "LMT", "NOC", "GD", "HON", "UPS", "FDX",
  "DAL", "UAL", "AAL", "CCL", "RCL", "NKE", "LULU", "SBUX", "MCD", "CMG",
  "WMT", "TGT", "COST", "HD", "LOW", "DIS", "ROKU", "WBD", "PARA", "GM",
  "F", "RIVN", "LCID", "NIO", "LI", "XPEV", "BABA", "PDD", "JD", "BIDU",
  "TME", "SE", "MELI", "VALE", "BHP", "RIO", "FCX", "NEM", "AA", "STLD",
  "CLF", "NUE", "MOS", "NTR", "CF", "ENPH", "FSLR", "SEDG", "NEE", "D",
  "T", "VZ", "TMUS", "IBM", "CSCO", "HPQ", "DELL", "SMCI", "VRT", "ETN",
  "CEG", "GEV", "OKTA", "TWLO", "PATH", "AI", "RBLX", "AFRM", "UPST",
  "DKNG", "PENN", "WYNN", "MGM", "CZR", "SPOT", "TTD", "PINS", "SNAP",
  "TGTX", "MRNA", "NVAX", "RIG", "CHWY", "W", "CVNA", "GME", "AMC",
]);

const normalizeSymbol = (symbol) =>
  String(symbol || "").trim().toUpperCase().replace(/\s+/g, "");

const uniqueSymbols = (symbols = []) => [
  ...new Set((symbols || []).map(normalizeSymbol).filter(Boolean)),
];

const clampNumber = (value, fallback, { min, max, integer = false }) => {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = integer ? Math.round(parsed) : parsed;
  return Math.min(max, Math.max(min, normalized));
};

const normalizeOptionalNumber = (value, { min, max }) => {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(parsed)) return null;
  return Math.min(max, Math.max(min, Math.round(parsed)));
};

export const normalizeFlowScannerConfig = (value = {}) => {
  const input = value && typeof value === "object" ? value : {};
  const mode =
    input.mode === "hybrid"
      ? FLOW_SCANNER_MODE.market
      : Object.values(FLOW_SCANNER_MODE).includes(input.mode)
        ? input.mode
        : DEFAULT_FLOW_SCANNER_CONFIG.mode;
  const scope = Object.values(FLOW_SCANNER_SCOPE).includes(input.scope)
    ? input.scope
    : DEFAULT_FLOW_SCANNER_CONFIG.scope;

  const maxSymbols = clampNumber(
    input.maxSymbols,
    DEFAULT_FLOW_SCANNER_CONFIG.maxSymbols,
    { ...FLOW_SCANNER_CONFIG_LIMITS.maxSymbols, integer: true },
  );
  const batchSize = clampNumber(
    input.batchSize,
    DEFAULT_FLOW_SCANNER_CONFIG.batchSize,
    { ...FLOW_SCANNER_CONFIG_LIMITS.batchSize, integer: true },
  );

  return {
    mode,
    scope,
    maxSymbols,
    batchSize: Math.min(batchSize, maxSymbols),
    intervalMs: clampNumber(
      input.intervalMs,
      DEFAULT_FLOW_SCANNER_CONFIG.intervalMs,
      { ...FLOW_SCANNER_CONFIG_LIMITS.intervalMs, integer: true },
    ),
    concurrency: clampNumber(
      input.concurrency,
      DEFAULT_FLOW_SCANNER_CONFIG.concurrency,
      { ...FLOW_SCANNER_CONFIG_LIMITS.concurrency, integer: true },
    ),
    limit: clampNumber(input.limit, DEFAULT_FLOW_SCANNER_CONFIG.limit, {
      ...FLOW_SCANNER_CONFIG_LIMITS.limit,
      integer: true,
    }),
    unusualThreshold: clampNumber(
      input.unusualThreshold,
      DEFAULT_FLOW_SCANNER_CONFIG.unusualThreshold,
      FLOW_SCANNER_CONFIG_LIMITS.unusualThreshold,
    ),
    minPremium: clampNumber(
      input.minPremium,
      DEFAULT_FLOW_SCANNER_CONFIG.minPremium,
      FLOW_SCANNER_CONFIG_LIMITS.minPremium,
    ),
    maxDte: normalizeOptionalNumber(
      input.maxDte,
      FLOW_SCANNER_CONFIG_LIMITS.maxDte,
    ),
  };
};

export const buildFlowScannerSymbols = ({
  watchlistSymbols = [],
  marketSymbols = FLOW_SCANNER_MARKET_UNIVERSE_SYMBOLS,
  config = DEFAULT_FLOW_SCANNER_CONFIG,
} = {}) => {
  const resolved = normalizeFlowScannerConfig(config);
  const watchlist = uniqueSymbols(watchlistSymbols);
  const market = uniqueSymbols(marketSymbols);
  const symbols =
    resolved.mode === FLOW_SCANNER_MODE.watchlist
      ? watchlist
      : [...watchlist, ...market];

  return uniqueSymbols(symbols).slice(0, resolved.maxSymbols);
};

export const filterFlowScannerEvents = (
  events = [],
  config = DEFAULT_FLOW_SCANNER_CONFIG,
) => {
  const resolved = normalizeFlowScannerConfig(config);
  return (events || []).filter((event) => {
    const premium = Number(event?.premium || 0);
    const dte = Number(event?.dte);
    const side = String(event?.side || "").toUpperCase();
    const type = String(event?.type || "").toUpperCase();
    const score = Number(event?.unusualScore);
    const matchesUnusualScope =
      Boolean(event?.isUnusual) ||
      (Number.isFinite(score) && score >= resolved.unusualThreshold) ||
      Boolean(event?.golden) ||
      type === "SWEEP" ||
      type === "BLOCK" ||
      premium >= 250_000 ||
      (side === "BUY" && premium >= 100_000) ||
      (Number.isFinite(dte) && dte <= 1 && premium >= 50_000);
    if (
      resolved.scope === FLOW_SCANNER_SCOPE.unusual &&
      !matchesUnusualScope
    ) {
      return false;
    }
    if (resolved.minPremium > 0 && premium < resolved.minPremium) {
      return false;
    }
    if (resolved.maxDte !== null) {
      const dte = Number(event?.dte);
      if (!Number.isFinite(dte) || dte > resolved.maxDte) {
        return false;
      }
    }
    return true;
  });
};

export const runFlowScannerBatch = async (
  items = [],
  concurrency = DEFAULT_FLOW_SCANNER_CONFIG.concurrency,
  mapper,
) => {
  const input = Array.isArray(items) ? items : [];
  const workerCount = Math.max(
    1,
    Math.min(Math.floor(concurrency || 1), input.length || 1),
  );
  const results = new Array(input.length);
  let cursor = 0;
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < input.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = {
          status: "fulfilled",
          value: await mapper(input[index], index),
        };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  });

  await Promise.all(workers);
  return results;
};
