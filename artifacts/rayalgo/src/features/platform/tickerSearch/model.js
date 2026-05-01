const FX_CURRENCY_CODES = new Set([
  "AUD",
  "BRL",
  "CAD",
  "CHF",
  "CNH",
  "CNY",
  "CZK",
  "DKK",
  "EUR",
  "GBP",
  "HKD",
  "HUF",
  "ILS",
  "INR",
  "JPY",
  "KRW",
  "MXN",
  "NOK",
  "NZD",
  "PLN",
  "SEK",
  "SGD",
  "TRY",
  "USD",
  "ZAR",
]);

const INDEX_HINTS = new Set([
  "DJI",
  "DOW",
  "MID",
  "NDX",
  "NYA",
  "OEX",
  "RUA",
  "RUT",
  "RVX",
  "SKEW",
  "SOX",
  "SPX",
  "VIX",
  "VXN",
  "XAU",
]);

const CRYPTO_HINTS = new Set([
  "AAVE",
  "ADA",
  "ATOM",
  "AVAX",
  "BCH",
  "BTC",
  "DOGE",
  "DOT",
  "ETC",
  "ETH",
  "LINK",
  "LTC",
  "MATIC",
  "SHIB",
  "SOL",
  "UNI",
  "XLM",
  "XRP",
]);

const FUTURES_HINTS = new Set([
  "6A",
  "6B",
  "6C",
  "6E",
  "6J",
  "6N",
  "6S",
  "CL",
  "ES",
  "GC",
  "GF",
  "HE",
  "HG",
  "HO",
  "KE",
  "LE",
  "M2K",
  "M6E",
  "MCL",
  "MES",
  "MGC",
  "MNQ",
  "MYM",
  "NG",
  "NQ",
  "PA",
  "PL",
  "RB",
  "RTY",
  "SI",
  "UB",
  "YM",
  "ZB",
  "ZC",
  "ZF",
  "ZL",
  "ZM",
  "ZN",
  "ZS",
  "ZT",
  "ZW",
]);

const DEFAULT_SYMBOL_NAMES = {
  AAPL: "Apple Inc.",
  AMD: "Advanced Micro Devices Inc.",
  DIA: "SPDR Dow Jones Industrial Average ETF",
  ES: "E-mini S&P 500 futures",
  ETH: "Ethereum",
  EUR: "Euro / U.S. Dollar",
  IWM: "iShares Russell 2000 ETF",
  MSFT: "Microsoft Corp.",
  NDX: "Nasdaq 100 Index",
  NQ: "E-mini Nasdaq 100 futures",
  NVDA: "NVIDIA Corp.",
  QQQ: "Invesco QQQ Trust",
  RTY: "E-mini Russell 2000 futures",
  SPX: "S&P 500 Index",
  SPY: "SPDR S&P 500 ETF",
  TSLA: "Tesla Inc.",
  VIX: "Cboe Volatility Index",
  YM: "E-mini Dow futures",
};

const RELATED_SYMBOLS = {
  SPY: ["QQQ", "IWM", "DIA", "SPX", "VIX"],
  QQQ: ["SPY", "IWM", "NDX", "VIX"],
  IWM: ["SPY", "QQQ", "DIA", "VIX"],
  DIA: ["SPY", "QQQ", "IWM"],
  SPX: ["SPY", "QQQ", "VIX", "ES"],
  NDX: ["QQQ", "SPY", "NQ", "VIX"],
  VIX: ["SPX", "SPY", "QQQ"],
  BTC: ["ETH"],
  ETH: ["BTC"],
  ES: ["NQ", "YM", "RTY", "SPY"],
  NQ: ["ES", "YM", "RTY", "QQQ"],
  YM: ["ES", "NQ", "RTY", "DIA"],
  RTY: ["ES", "NQ", "YM", "IWM"],
  EUR: ["GBP", "JPY", "CHF", "CAD"],
};

const REASON_ORDER = [
  "Exact",
  "Index",
  "FX",
  "Future",
  "Crypto",
  "Current",
  "Favorite",
  "Recent",
  "Watchlist",
  "Signal",
  "Flow",
  "Related",
  "Popular",
];

const GROUP_ORDER = [
  "Suggested",
  "Continue",
  "Favorites",
  "Recent",
  "Watchlist",
  "Signals",
  "Flow",
  "Related",
  "Popular today",
];

const MARKET_LABELS = {
  crypto: "Crypto",
  etf: "ETF",
  futures: "Futures",
  fx: "FX",
  indices: "Index",
  otc: "OTC",
  stocks: "Stock",
};

const compactSymbol = (value) =>
  String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/^[\s$^]+/, "")
    .replace(/^X:/, "")
    .replace(/[\s./-]+/g, "");

const isFxPair = (value) =>
  /^[A-Z]{6}$/.test(value) &&
  FX_CURRENCY_CODES.has(value.slice(0, 3)) &&
  FX_CURRENCY_CODES.has(value.slice(3));

const normalizeReasonList = (reasons) =>
  Array.from(new Set((reasons || []).filter(Boolean))).sort((left, right) => {
    const leftIndex = REASON_ORDER.indexOf(left);
    const rightIndex = REASON_ORDER.indexOf(right);
    return (leftIndex === -1 ? 999 : leftIndex) - (rightIndex === -1 ? 999 : rightIndex);
  });

export const normalizeTickerSearchSymbol = (value) => {
  const raw = String(value ?? "").trim().toUpperCase().replace(/^[\s$^]+/, "");
  if (!raw) return "";

  const compact = compactSymbol(raw);
  if (isFxPair(compact)) return compact;

  const shareClass = /^([A-Z]{1,5})[ .\/-]([A-Z]{1,2})$/.exec(raw);
  if (shareClass) return `${shareClass[1]}.${shareClass[2]}`;

  return raw.replace(/\s+/g, "");
};

export const resolveTickerSearchIntent = (query) => {
  const raw = String(query ?? "").trim().toUpperCase().replace(/^[\s$^]+/, "");
  if (!raw) return null;

  const compact = compactSymbol(raw);
  if (!compact) return null;

  if (isFxPair(compact)) {
    const base = compact.slice(0, 3);
    const quote = compact.slice(3);
    return {
      symbol: base,
      displaySymbol: `${base}${quote}`,
      market: "fx",
      name: `${base}/${quote} currency pair`,
      reasons: ["Exact", "FX"],
      resolutionQuery: base,
    };
  }

  if (FX_CURRENCY_CODES.has(compact)) {
    return {
      symbol: compact,
      displaySymbol: compact,
      market: "fx",
      name: `${compact} currency`,
      reasons: ["FX"],
      resolutionQuery: compact,
    };
  }

  const cryptoBase = compact.endsWith("USD") ? compact.slice(0, -3) : compact;
  if (CRYPTO_HINTS.has(cryptoBase)) {
    return {
      symbol: cryptoBase,
      displaySymbol: cryptoBase,
      market: "crypto",
      name: DEFAULT_SYMBOL_NAMES[cryptoBase] || `${cryptoBase} crypto`,
      reasons: ["Exact", "Crypto"],
      resolutionQuery: cryptoBase,
    };
  }

  if (INDEX_HINTS.has(compact)) {
    return {
      symbol: compact,
      displaySymbol: compact,
      market: "indices",
      name: DEFAULT_SYMBOL_NAMES[compact] || `${compact} index`,
      reasons: ["Exact", "Index"],
      resolutionQuery: compact,
    };
  }

  if (FUTURES_HINTS.has(compact)) {
    return {
      symbol: compact,
      displaySymbol: compact,
      market: "futures",
      name: DEFAULT_SYMBOL_NAMES[compact] || `${compact} futures`,
      reasons: ["Exact", "Future"],
      resolutionQuery: compact,
    };
  }

  const shareClass = /^([A-Z]{1,5})[ .\/-]([A-Z]{1,2})$/.exec(raw);
  if (shareClass) {
    const symbol = `${shareClass[1]}.${shareClass[2]}`;
    return {
      symbol,
      displaySymbol: symbol,
      market: "stocks",
      name: `${symbol} share class`,
      reasons: ["Exact"],
      resolutionQuery: symbol,
    };
  }

  if (
    /^\d+$/.test(compact) ||
    (compact.startsWith("BBG") && /^[A-Z0-9]{12}$/.test(compact)) ||
    /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(compact) ||
    (/^[A-Z0-9]{9}$/.test(compact) && !/^[A-Z]{1,6}$/.test(compact))
  ) {
    return {
      symbol: compact,
      displaySymbol: compact,
      market: "stocks",
      name: "Provider identifier lookup",
      reasons: ["Exact"],
      resolutionQuery: compact,
    };
  }

  return null;
};

const inferMarketForSymbol = (symbol, fallback = "stocks") => {
  const compact = compactSymbol(symbol);
  if (isFxPair(compact) || FX_CURRENCY_CODES.has(compact)) return "fx";
  const cryptoBase = compact.endsWith("USD") ? compact.slice(0, -3) : compact;
  if (CRYPTO_HINTS.has(cryptoBase)) return "crypto";
  if (INDEX_HINTS.has(compact)) return "indices";
  if (FUTURES_HINTS.has(compact)) return "futures";
  return fallback || "stocks";
};

const extractSuggestionSymbol = (value) => {
  if (typeof value === "string") return normalizeTickerSearchSymbol(value);
  if (!value || typeof value !== "object") return "";
  return normalizeTickerSearchSymbol(
    value.ticker ?? value.symbol ?? value.underlying ?? value.sym ?? "",
  );
};

const getRowStorageKey = (row) =>
  [
    normalizeTickerSearchSymbol(row?.ticker),
    row?.market || "",
    row?.normalizedExchangeMic ||
      row?.primaryExchange?.trim?.().toUpperCase?.() ||
      "",
  ].join("|");

const getRowSymbolKey = (row) =>
  [normalizeTickerSearchSymbol(row?.ticker), row?.market || ""].join("|");

const findCachedRow = (rowCache, symbol, market) => {
  const normalized = normalizeTickerSearchSymbol(symbol);
  if (!normalized) return null;
  const direct = rowCache?.[normalized];
  if (direct && (!market || direct.market === market)) return direct;

  return (
    Object.values(rowCache || {}).find(
      (row) =>
        normalizeTickerSearchSymbol(row?.ticker) === normalized &&
        (!market || row?.market === market),
    ) || null
  );
};

const buildUnresolvedSuggestionRow = ({ symbol, market, name, group, reasons, resolutionQuery }) => ({
  ticker: normalizeTickerSearchSymbol(symbol),
  name: name || DEFAULT_SYMBOL_NAMES[normalizeTickerSearchSymbol(symbol)] || "Search to resolve provider",
  market: market || inferMarketForSymbol(symbol),
  rootSymbol: normalizeTickerSearchSymbol(symbol),
  normalizedExchangeMic: null,
  exchangeDisplay: MARKET_LABELS[market] || null,
  logoUrl: null,
  countryCode: null,
  exchangeCountryCode: null,
  sector: null,
  industry: null,
  contractDescription: null,
  contractMeta: null,
  locale: null,
  type: null,
  active: true,
  primaryExchange: null,
  currencyName: null,
  cik: null,
  compositeFigi: null,
  shareClassFigi: null,
  lastUpdatedAt: null,
  provider: null,
  providers: [],
  tradeProvider: null,
  dataProviderPreference: null,
  providerContractId: null,
  _group: group,
  _kind: "suggestion",
  _disabled: true,
  _reasons: normalizeReasonList(reasons),
  _resolutionQuery: resolutionQuery || normalizeTickerSearchSymbol(symbol),
});

const buildSuggestionRow = ({
  rowCache,
  symbol,
  market,
  name,
  group,
  reasons,
  score,
  resolutionQuery,
}) => {
  const normalized = normalizeTickerSearchSymbol(symbol);
  if (!normalized) return null;
  const resolvedMarket = market || inferMarketForSymbol(normalized);
  const cached = findCachedRow(rowCache, normalized, resolvedMarket);
  const row = cached
    ? {
        ...cached,
        _disabled: false,
      }
    : buildUnresolvedSuggestionRow({
        symbol: normalized,
        market: resolvedMarket,
        name,
        group,
        reasons,
        resolutionQuery,
      });

  return {
    ...row,
    _group: group,
    _kind: "suggestion",
    _score: score,
    _reasons: normalizeReasonList([...(row._reasons || []), ...(reasons || [])]),
    _resolutionQuery: resolutionQuery || row._resolutionQuery || normalized,
  };
};

const rowAliases = (row) => {
  const ticker = normalizeTickerSearchSymbol(row?.ticker);
  const root = normalizeTickerSearchSymbol(row?.rootSymbol);
  const aliases = new Set([ticker, root].filter(Boolean));
  const compactTicker = compactSymbol(ticker);
  if (row?.market === "crypto" && compactTicker.endsWith("USD")) {
    aliases.add(compactTicker.slice(0, -3));
  }
  if (row?.market === "crypto" && compactTicker && !compactTicker.endsWith("USD")) {
    aliases.add(`${compactTicker}USD`);
  }
  if (row?.market === "fx" && /^[A-Z]{3}$/.test(ticker)) {
    aliases.add(`${ticker}USD`);
  }
  return aliases;
};

const hasExactLiveMatch = (liveResults, symbol, market, query) => {
  const normalizedSymbol = normalizeTickerSearchSymbol(symbol);
  const normalizedQuery = compactSymbol(query || symbol);
  return (liveResults || []).some((row) => {
    if (market && row?.market !== market) return false;
    const aliases = rowAliases(row);
    return aliases.has(normalizedSymbol) || aliases.has(normalizedQuery);
  });
};

const queryMatchesSymbol = (query, symbol) => {
  const normalizedQuery = compactSymbol(query);
  const normalizedSymbol = compactSymbol(symbol);
  if (!normalizedQuery || !normalizedSymbol) return false;
  return (
    normalizedSymbol === normalizedQuery ||
    normalizedSymbol.startsWith(normalizedQuery) ||
    normalizedSymbol.includes(normalizedQuery) ||
    normalizedQuery.includes(normalizedSymbol)
  );
};

const groupCandidates = (candidates, { query, liveResults, maxRows, maxRowsPerGroup }) => {
  const typed = Boolean(String(query ?? "").trim());
  const byKey = new Map();

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (
      typed &&
      hasExactLiveMatch(
        liveResults,
        candidate.ticker,
        candidate.market,
        query,
      )
    ) {
      continue;
    }

    const key = getRowSymbolKey(candidate);
    const current = byKey.get(key);
    if (!current || candidate._score > current._score) {
      byKey.set(key, candidate);
    } else {
      current._reasons = normalizeReasonList([
        ...(current._reasons || []),
        ...(candidate._reasons || []),
      ]);
    }
  }

  const grouped = new Map();
  for (const row of byKey.values()) {
    const label = row._group || (typed ? "Suggested" : "Popular today");
    const rows = grouped.get(label) || [];
    rows.push(row);
    grouped.set(label, rows);
  }

  const groups = Array.from(grouped.entries())
    .sort(([left], [right]) => {
      const leftIndex = GROUP_ORDER.indexOf(left);
      const rightIndex = GROUP_ORDER.indexOf(right);
      return (leftIndex === -1 ? 999 : leftIndex) - (rightIndex === -1 ? 999 : rightIndex);
    })
    .map(([label, rows]) => ({
      label,
      rows: rows
        .sort((left, right) => {
          if (right._score !== left._score) return right._score - left._score;
          return String(left.ticker).localeCompare(String(right.ticker));
        })
        .slice(0, maxRowsPerGroup),
    }))
    .filter((group) => group.rows.length);

  if (!Number.isFinite(maxRows)) return groups;

  let remaining = maxRows;
  return groups
    .map((group) => {
      const rows = group.rows.slice(0, Math.max(0, remaining));
      remaining -= rows.length;
      return { ...group, rows };
    })
    .filter((group) => group.rows.length);
};

const appendSymbols = (candidates, symbols, context) => {
  for (const entry of symbols || []) {
    const symbol = extractSuggestionSymbol(entry);
    if (!symbol) continue;
    if (context.query && !queryMatchesSymbol(context.query, symbol)) continue;
    const market =
      typeof entry === "object" && entry?.market
        ? entry.market
        : inferMarketForSymbol(symbol);
    const row = buildSuggestionRow({
      rowCache: context.rowCache,
      symbol,
      market,
      group: context.group,
      reasons: context.reasons,
      score: context.score,
    });
    if (row) candidates.push(row);
  }
};

export const buildSmartTickerSuggestions = ({
  query = "",
  currentTicker = "",
  recentTickerRows = [],
  watchlistSymbols = [],
  favoriteRows = [],
  popularTickers = [],
  rowCache = {},
  contextSymbols = [],
  flowSymbols = [],
  signalSymbols = [],
  liveResults = [],
  maxRows = 24,
  maxRowsPerGroup = 5,
} = {}) => {
  const typedQuery = String(query ?? "").trim();
  const typed = Boolean(typedQuery);
  const candidates = [];

  if (typed) {
    const intent = resolveTickerSearchIntent(typedQuery);
    if (intent) {
      const row = buildSuggestionRow({
        rowCache,
        symbol: intent.symbol,
        market: intent.market,
        name: intent.name,
        group: "Suggested",
        reasons: intent.reasons,
        resolutionQuery: intent.resolutionQuery,
        score: 5_000,
      });
      if (row) candidates.push(row);
    }

    appendSymbols(candidates, favoriteRows, {
      rowCache,
      query: typedQuery,
      group: "Suggested",
      reasons: ["Favorite"],
      score: 1_900,
    });
    appendSymbols(candidates, recentTickerRows, {
      rowCache,
      query: typedQuery,
      group: "Suggested",
      reasons: ["Recent"],
      score: 1_650,
    });
    appendSymbols(candidates, watchlistSymbols, {
      rowCache,
      query: typedQuery,
      group: "Suggested",
      reasons: ["Watchlist"],
      score: 1_400,
    });

    return groupCandidates(candidates, {
      query: typedQuery,
      liveResults,
      maxRows: Math.min(maxRows, 5),
      maxRowsPerGroup,
    });
  }

  appendSymbols(candidates, [currentTicker, ...contextSymbols], {
    rowCache,
    group: "Continue",
    reasons: ["Current"],
    score: 3_000,
  });
  appendSymbols(candidates, favoriteRows, {
    rowCache,
    group: "Favorites",
    reasons: ["Favorite"],
    score: 2_800,
  });
  appendSymbols(candidates, recentTickerRows, {
    rowCache,
    group: "Recent",
    reasons: ["Recent"],
    score: 2_500,
  });
  appendSymbols(candidates, watchlistSymbols, {
    rowCache,
    group: "Watchlist",
    reasons: ["Watchlist"],
    score: 2_100,
  });
  appendSymbols(candidates, signalSymbols, {
    rowCache,
    group: "Signals",
    reasons: ["Signal"],
    score: 1_900,
  });
  appendSymbols(candidates, flowSymbols, {
    rowCache,
    group: "Flow",
    reasons: ["Flow"],
    score: 1_700,
  });

  const currentRelated = RELATED_SYMBOLS[normalizeTickerSearchSymbol(currentTicker)] || [];
  appendSymbols(candidates, currentRelated, {
    rowCache,
    group: "Related",
    reasons: ["Related"],
    score: 1_500,
  });
  appendSymbols(candidates, popularTickers, {
    rowCache,
    group: "Popular today",
    reasons: ["Popular"],
    score: 1_000,
  });

  return groupCandidates(candidates, {
    query: "",
    liveResults,
    maxRows,
    maxRowsPerGroup,
  });
};

export const flattenTickerSuggestionGroups = (groups) =>
  (groups || []).flatMap((group) => group.rows || []);

export const getTickerSuggestionStorageKey = getRowStorageKey;
