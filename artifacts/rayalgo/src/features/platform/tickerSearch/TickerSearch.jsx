import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchUniverseTickers } from "@workspace/api-client-react";
import {
  buildSmartTickerSuggestions,
  flattenTickerSuggestionGroups,
} from "./model";
import { DEFAULT_WATCHLIST_BY_SYMBOL } from "../../market/marketReferenceData";
import { normalizeTickerSymbol } from "../tickerIdentity";
import {
  MarketIdentityChips,
  MarketIdentityMark,
  resolveMarketIdentity,
} from "../marketIdentity";
import { T, dim, fs, sp } from "../../../lib/uiTokens";
import { joinMotionClasses, motionVars } from "../../../lib/motion";
import { _initialState, persistState } from "../../../lib/workspaceState";
import { AppTooltip } from "@/components/ui/tooltip";


const FONT_CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body,#root{width:100%;height:100%;overflow:hidden}
body,button,input,select,textarea{font-family:var(--ra-font-sans,'IBM Plex Sans',system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif)}
::-webkit-scrollbar{width:5px;height:5px}
::-webkit-scrollbar-thumb{background:#2a3348;border-radius:3px}
::-webkit-scrollbar-thumb:hover{background:#3a4560}
::-webkit-scrollbar-track{background:transparent}
input[type=range]{accent-color:#3b82f6}
`;

const TICKER_SEARCH_MARKET_FILTERS = [
  { value: "all", label: "All", markets: null },
  { value: "stocks", label: "Stocks", markets: ["stocks"] },
  { value: "etf", label: "ETF", markets: ["etf"] },
  { value: "indices", label: "Index", markets: ["indices"] },
  { value: "futures", label: "Futures", markets: ["futures"] },
  { value: "fx", label: "FX", markets: ["fx"] },
  { value: "crypto", label: "Crypto", markets: ["crypto"] },
];
const TICKER_SEARCH_MARKET_BY_VALUE = Object.fromEntries(
  TICKER_SEARCH_MARKET_FILTERS.map((filter) => [filter.value, filter]),
);
const TICKER_SEARCH_INITIAL_RESULT_LIMIT = 24;
const TICKER_SEARCH_RESULT_INCREMENT = 24;
const TICKER_SEARCH_SERVER_RESULT_BUFFER = 16;
const TICKER_SEARCH_CACHE_LIMIT = 500;
const TICKER_SEARCH_QUICK_PICK_LIMIT = 12;

const normalizeTickerSearchQuery = (value) =>
  value?.trim?.().replace?.(/^[\s$^]+/, "").toLowerCase?.() || "";
const normalizeTickerSearchMarketFilter = (value) =>
  TICKER_SEARCH_MARKET_BY_VALUE[value] ? value : "all";

const buildTickerSearchRowKey = (result) =>
  [
    normalizeTickerSymbol(result?.ticker),
    result?.market || "",
    result?.normalizedExchangeMic ||
      result?.primaryExchange?.trim?.().toUpperCase?.() ||
      "",
    result?.providerContractId || "",
  ].join("|");

export const getTickerSearchRowStorageKey = (result) =>
  [
    normalizeTickerSymbol(result?.ticker),
    result?.market || "",
    result?.normalizedExchangeMic ||
      result?.primaryExchange?.trim?.().toUpperCase?.() ||
      "",
  ].join("|");

const isApiBackedTickerSearchRow = (result) =>
  Boolean(
    result &&
      normalizeTickerSymbol(result.ticker) &&
      result.market &&
      Array.isArray(result.providers) &&
      result.providers.length,
  );

export const normalizeTickerSearchResultForStorage = (result) => {
  if (!isApiBackedTickerSearchRow(result)) return null;
  const ticker = normalizeTickerSymbol(result.ticker);
  return {
    ticker,
    name: result.name || ticker,
    market: result.market,
    rootSymbol: result.rootSymbol || ticker,
    normalizedExchangeMic:
      result.normalizedExchangeMic || result.primaryExchange || null,
    exchangeDisplay:
      result.exchangeDisplay || result.primaryExchange || result.normalizedExchangeMic || null,
    logoUrl: result.logoUrl || null,
    countryCode: result.countryCode || null,
    exchangeCountryCode: result.exchangeCountryCode || null,
    sector: result.sector || null,
    industry: result.industry || null,
    contractDescription: result.contractDescription || result.name || ticker,
    contractMeta: result.contractMeta || null,
    locale: result.locale || null,
    type: result.type || null,
    active: result.active !== false,
    primaryExchange: result.primaryExchange || result.exchangeDisplay || null,
    currencyName: result.currencyName || null,
    cik: result.cik || null,
    compositeFigi: result.compositeFigi || null,
    shareClassFigi: result.shareClassFigi || null,
    lastUpdatedAt: result.lastUpdatedAt || null,
    provider:
      result.provider ||
      result.tradeProvider ||
      (Array.isArray(result.providers) ? result.providers[0] : null) ||
      null,
    providers: [
      ...new Set((Array.isArray(result.providers) ? result.providers : []).filter(Boolean)),
    ],
    tradeProvider: result.tradeProvider || null,
    dataProviderPreference: result.dataProviderPreference || result.provider || null,
    providerContractId: result.providerContractId || null,
  };
};

export const normalizePersistedTickerSearchRows = (rows, limit = Number.POSITIVE_INFINITY) => {
  const normalized = (Array.isArray(rows) ? rows : [])
    .map(normalizeTickerSearchResultForStorage)
    .filter(Boolean);
  return Number.isFinite(limit) ? normalized.slice(0, limit) : normalized;
};

export const buildTickerSearchCache = (...rowLists) => {
  const cache = {};
  for (const row of rowLists.flat()) {
    const normalized = normalizeTickerSearchResultForStorage(row);
    if (!normalized) continue;
    const storageKey = getTickerSearchRowStorageKey(normalized);
    const symbolKey = normalizeTickerSymbol(normalized.ticker);
    if (!cache[storageKey]) cache[storageKey] = normalized;
    if (symbolKey && !cache[symbolKey]) cache[symbolKey] = normalized;
  }
  return cache;
};

const getTickerSearchCachedRow = (cache, symbol) => {
  const normalized = normalizeTickerSymbol(symbol);
  return normalized ? cache?.[normalized] || null : null;
};

export const compactTickerSearchCacheRows = (
  cache,
  limit = TICKER_SEARCH_CACHE_LIMIT,
) => {
  const rows = [];
  const seen = new Set();
  for (const value of Object.values(cache || {})) {
    const normalized = normalizeTickerSearchResultForStorage(value);
    if (!normalized) continue;
    const key = getTickerSearchRowStorageKey(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(normalized);
    if (Number.isFinite(limit) && rows.length >= limit) break;
  }
  return rows;
};

export const mergeTickerSearchCacheRows = (
  currentCache,
  rows,
  limit = TICKER_SEARCH_CACHE_LIMIT,
) => {
  const incomingRows = normalizePersistedTickerSearchRows(rows, limit);
  if (!incomingRows.length) {
    return currentCache || {};
  }

  const mergedRows = [
    ...incomingRows,
    ...compactTickerSearchCacheRows(currentCache, limit),
  ];
  return buildTickerSearchCache(
    Number.isFinite(limit) ? mergedRows.slice(0, limit) : mergedRows,
  );
};

const buildTickerSearchAliases = (result) => {
  const normalizedTicker = normalizeTickerSymbol(result?.ticker);
  const withoutProviderPrefix = normalizedTicker.replace(/^[A-Z]:/, "");
  const aliases = new Set([
    normalizedTicker,
    withoutProviderPrefix,
    normalizeTickerSymbol(result?.rootSymbol),
  ]);

  if (result?.market === "crypto" && withoutProviderPrefix.endsWith("USD")) {
    aliases.add(withoutProviderPrefix.slice(0, -3));
  }
  if (result?.market === "crypto" && withoutProviderPrefix && !withoutProviderPrefix.endsWith("USD")) {
    aliases.add(`${withoutProviderPrefix}USD`);
  }
  if (result?.market === "fx" && /^[A-Z]{3}$/.test(withoutProviderPrefix)) {
    aliases.add(`${withoutProviderPrefix}USD`);
    aliases.add(`${withoutProviderPrefix}.USD`);
  }
  if (/^[A-Z]{1,5}\.[A-Z]{1,2}$/.test(withoutProviderPrefix)) {
    aliases.add(withoutProviderPrefix.replace(".", " "));
    aliases.add(withoutProviderPrefix.replace(".", ""));
  }

  return Array.from(aliases).filter(Boolean);
};

const TICKER_SEARCH_US_PRIMARY_EXCHANGE_SCORES = {
  XNAS: 680,
  XNYS: 660,
  ARCX: 640,
  XASE: 520,
  BATS: 500,
};
const TICKER_SEARCH_FX_CURRENCY_CODES = new Set([
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
const TICKER_SEARCH_INDEX_HINTS = new Set([
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
const TICKER_SEARCH_CRYPTO_HINTS = new Set([
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
const TICKER_SEARCH_FUTURES_HINTS = new Set([
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

const normalizeTickerSearchHintQuery = (query) =>
  normalizeTickerSymbol(query).replace(/^[\s$^]+/, "").replace(/[ ./-]/g, "");

const isTickerSearchFxHint = (query) => {
  const normalized = normalizeTickerSearchHintQuery(query);
  if (TICKER_SEARCH_FX_CURRENCY_CODES.has(normalized)) return true;
  if (!/^[A-Z]{6}$/.test(normalized)) return false;
  return (
    TICKER_SEARCH_FX_CURRENCY_CODES.has(normalized.slice(0, 3)) &&
    TICKER_SEARCH_FX_CURRENCY_CODES.has(normalized.slice(3))
  );
};

const isTickerSearchIndexHint = (query) =>
  TICKER_SEARCH_INDEX_HINTS.has(normalizeTickerSearchHintQuery(query));

const isTickerSearchCryptoHint = (query) => {
  const normalized = normalizeTickerSearchHintQuery(query).replace(/^X:/, "");
  if (TICKER_SEARCH_CRYPTO_HINTS.has(normalized)) return true;
  return (
    normalized.endsWith("USD") &&
    TICKER_SEARCH_CRYPTO_HINTS.has(normalized.slice(0, -3))
  );
};

const isTickerSearchFuturesHint = (query) =>
  TICKER_SEARCH_FUTURES_HINTS.has(normalizeTickerSearchHintQuery(query));

const isLikelyTickerSearchInput = (query) => {
  const normalized = normalizeTickerSearchHintQuery(query);
  if (!normalized) return false;
  if (normalized.length <= 4) return true;
  if (/[\d.:-]/.test(normalized)) return true;
  return (
    isTickerSearchFxHint(normalized) ||
    isTickerSearchIndexHint(normalized) ||
    isTickerSearchCryptoHint(normalized) ||
    isTickerSearchFuturesHint(normalized)
  );
};

const getTickerSearchMinQueryLength = (query) =>
  isLikelyTickerSearchInput(query) ? 1 : 2;

const getTickerSearchRequestLimit = (limit) =>
  Math.max(
    Math.floor(Number(limit) || TICKER_SEARCH_INITIAL_RESULT_LIMIT) +
      TICKER_SEARCH_SERVER_RESULT_BUFFER,
    TICKER_SEARCH_INITIAL_RESULT_LIMIT,
  );

const normalizeTickerSearchExchangeKey = (result) => {
  const raw = (
    result?.normalizedExchangeMic ||
    result?.primaryExchange ||
    result?.exchangeDisplay ||
    ""
  )
    .trim()
    .toUpperCase();

  if (!raw) return "";
  if (raw === "NASDAQ") return "XNAS";
  if (raw === "NYSE") return "XNYS";
  if (raw === "ARCA") return "ARCX";
  return raw;
};

const isTickerSearchUsExactMatchCandidate = (result) =>
  result?.market === "stocks" || result?.market === "etf" || result?.market === "otc";

const scoreTickerSearchResult = (
  result,
  { query, currentTicker, recentTickerSet, watchlistTickerSet, favoriteTickerSet },
) => {
  const normalizedTicker = normalizeTickerSymbol(result?.ticker);
  const normalizedName = result?.name?.trim?.().toLowerCase?.() || "";
  const tickerAliases = buildTickerSearchAliases(result);
  if (!query || !normalizedTicker) return Number.NEGATIVE_INFINITY;

  let score = 0;
  const uppercaseQuery = query.toUpperCase();
  const exactTickerMatch =
    tickerAliases.includes(uppercaseQuery) || normalizedTicker === uppercaseQuery;
  const strongNamePrefixMatch =
    normalizedName === query || normalizedName.startsWith(query);
  if (exactTickerMatch) score += 3000;
  else if (normalizedTicker.startsWith(query.toUpperCase())) score += 1050;
  else if (normalizedTicker.includes(query.toUpperCase())) score += 780;

  if (normalizedName === query) score += 720;
  else if (normalizedName.startsWith(query)) score += 560;
  else if (
    normalizedName
      .split(/[\s./-]+/)
      .some((part) => part && part.startsWith(query))
  ) {
    score += 500;
  } else if (normalizedName.includes(query)) {
    score += 320;
  }

  if (!exactTickerMatch) {
    if (normalizedTicker === normalizeTickerSymbol(currentTicker)) score += 40;
    if (recentTickerSet.has(normalizedTicker)) score += 140;
    if (favoriteTickerSet.has(normalizedTicker)) score += 120;
    if (watchlistTickerSet.has(normalizedTicker)) score += 90;
  }
  if (result?.providers?.includes?.("ibkr")) score += 35;
  if (result?.providerContractId) score += 20;
  if (result?.normalizedExchangeMic || result?.primaryExchange) score += 10;

  if (strongNamePrefixMatch) {
    if (/^[A-Z]{1,6}$/.test(normalizedTicker)) score += 180;
    if (/^\d/.test(normalizedTicker)) score -= 260;
    if (isTickerSearchUsExactMatchCandidate(result)) {
      score +=
        TICKER_SEARCH_US_PRIMARY_EXCHANGE_SCORES[
          normalizeTickerSearchExchangeKey(result)
        ] || 0;
      if (result?.providers?.includes?.("ibkr")) score += 160;
      if (result?.providerContractId) score += 120;
    }
  }

  if (exactTickerMatch) {
    if (result?.market === "fx" && isTickerSearchFxHint(uppercaseQuery)) score += 1500;
    if (result?.market === "crypto" && isTickerSearchCryptoHint(uppercaseQuery)) score += 1500;
    if (result?.market === "indices" && isTickerSearchIndexHint(uppercaseQuery)) score += 1500;
    if (result?.market === "futures" && isTickerSearchFuturesHint(uppercaseQuery)) score += 1500;
  }

  if (exactTickerMatch && isTickerSearchUsExactMatchCandidate(result)) {
    score +=
      TICKER_SEARCH_US_PRIMARY_EXCHANGE_SCORES[
        normalizeTickerSearchExchangeKey(result)
      ] || 0;
    if (result?.providers?.includes?.("ibkr")) score += 220;
    if (result?.providerContractId) score += 180;
  }

  return score;
};

const buildTickerSearchContractLine = (result) => {
  const meta = result?.contractMeta || {};
  if (result?.market === "futures") {
    return [meta.expiry || meta.lastTradeDateOrContractMonth, meta.multiplier]
      .filter(Boolean)
      .join(" · ");
  }
  if (result?.market === "fx") {
    return result.currencyName ? `Quote currency ${result.currencyName}` : "Currency pair";
  }
  if (result?.market === "crypto") {
    return result.currencyName ? `Pair quoted in ${result.currencyName}` : "Crypto pair";
  }
  return result?.contractDescription && result.contractDescription !== result.name
    ? result.contractDescription
    : "";
};

const isTickerSearchIbkrTradable = (result) =>
  result?.tradeProvider === "ibkr" &&
  Boolean(result?.providerContractId) &&
  result?.providers?.includes?.("ibkr");

const TickerSearchRow = ({
  result,
  id,
  active,
  favorite,
  onSelect,
  onToggleFavorite,
  onMouseEnter,
}) => {
  const disabled = result?._disabled || !isApiBackedTickerSearchRow(result);
  const providerLabel = isTickerSearchIbkrTradable(result)
    ? "IBKR"
    : result?.providers?.length
      ? "Data only"
      : "Resolve";
  const contractLine = buildTickerSearchContractLine(result);
  const reasonChips = Array.isArray(result?._reasons)
    ? result._reasons.filter(Boolean).slice(0, 3)
    : [];
  const identity = resolveMarketIdentity(result);

  return (
    <AppTooltip key={buildTickerSearchRowKey(result)} content={disabled ? "Search this symbol to resolve provider metadata" : undefined}><button
      key={buildTickerSearchRowKey(result)}
      id={id}
      role="option"
      aria-selected={active}
      data-testid="ticker-search-row"
      data-ticker={normalizeTickerSymbol(result?.ticker)}
      data-market={result?.market || ""}
      data-provider-contract-id={result?.providerContractId || ""}
      disabled={false}
      className={joinMotionClasses(
        "ra-row-enter",
        "ra-interactive",
        active && "ra-focus-rail",
      )}
      onClick={() => onSelect?.(result)}
      onMouseEnter={onMouseEnter}
      style={{
        ...motionVars({ accent: T.accent }),
        width: "100%",
        display: "grid",
        gridTemplateColumns: "30px 1fr auto",
        gap: sp(8),
        alignItems: "center",
        padding: sp("8px 10px"),
        background: active ? T.bg3 : "transparent",
        border: "none",
        borderBottom: `1px solid ${T.border}20`,
        textAlign: "left",
        cursor: "pointer",
        opacity: disabled ? 0.62 : 1,
      }}
    >
      <MarketIdentityMark item={result} size={24} showMarketIcon />
      <span style={{ minWidth: 0 }}>
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: sp(5),
            minWidth: 0,
          }}
        >
          <span
            style={{
              fontSize: fs(10),
              fontWeight: 400,
              fontFamily: T.sans,
              color: T.text,
            }}
          >
            {result?.ticker}
          </span>
          <MarketIdentityChips
            identity={identity}
            compact
            maxChips={3}
            showProvider={false}
            showSector={false}
          />
        </span>
        <span
          style={{
            display: "block",
            fontSize: fs(9),
            color: T.textSec,
            fontFamily: T.sans,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
            {identity.name || result?.contractDescription || "Search to resolve"}
        </span>
        {contractLine ? (
          <span
            style={{
              display: "block",
              fontSize: fs(8),
              color: T.textDim,
              fontFamily: T.sans,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {contractLine}
          </span>
        ) : null}
        {reasonChips.length ? (
          <span
            style={{
              display: "flex",
              gap: sp(4),
              marginTop: sp(3),
              minWidth: 0,
              overflow: "hidden",
            }}
          >
            {reasonChips.map((reason) => (
              <span
                key={reason}
                style={{
                  border: `1px solid ${T.border}80`,
                  color: T.textMuted,
                  fontSize: fs(7),
                  fontFamily: T.mono,
                  lineHeight: 1.15,
                  padding: sp("1px 4px"),
                  textTransform: "uppercase",
                  whiteSpace: "nowrap",
                }}
              >
                {reason}
              </span>
            ))}
          </span>
        ) : null}
      </span>
      <span
        style={{
          display: "flex",
          alignItems: "center",
          gap: sp(5),
        }}
      >
        <span
          style={{
            fontSize: fs(7),
            color: disabled ? T.amber : T.textMuted,
            fontFamily: T.mono,
            textTransform: "uppercase",
            whiteSpace: "nowrap",
          }}
        >
          {disabled ? "Search" : providerLabel}
        </span>
        <span
          role="button"
          tabIndex={-1}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!disabled) onToggleFavorite?.(result);
          }}
          style={{
            color: favorite ? T.amber : T.textMuted,
            fontSize: fs(12),
            cursor: disabled ? "default" : "pointer",
            lineHeight: 1,
          }}
        >
          {favorite ? "★" : "☆"}
        </span>
      </span>
    </button></AppTooltip>
  );
};

const TickerSearchSkeletonRows = () => (
  <div style={{ padding: sp("4px 0") }}>
    {[0, 1, 2].map((index) => (
      <div
        key={index}
        style={{
          display: "grid",
          gridTemplateColumns: "28px 1fr auto",
          gap: sp(8),
          alignItems: "center",
          padding: sp("8px 10px"),
          borderBottom: `1px solid ${T.border}20`,
        }}
      >
        <span
          style={{
            width: dim(24),
            height: dim(24),
            borderRadius: 999,
            background: T.bg3,
          }}
        />
        <span>
          <span
            style={{
              display: "block",
              height: dim(8),
              width: `${58 + index * 10}%`,
              background: T.bg3,
              marginBottom: 5,
            }}
          />
          <span
            style={{
              display: "block",
              height: dim(7),
              width: `${72 - index * 8}%`,
              background: T.bg2,
            }}
          />
        </span>
        <span style={{ width: dim(42), height: dim(8), background: T.bg3 }} />
      </div>
    ))}
  </div>
);

const buildUnresolvedTickerSearchRow = (symbol, group) => {
  const ticker = normalizeTickerSymbol(symbol);
  return {
    ticker,
    name: DEFAULT_WATCHLIST_BY_SYMBOL[ticker]?.name || "Search to resolve provider",
    market: "stocks",
    rootSymbol: ticker,
    normalizedExchangeMic: null,
    exchangeDisplay: null,
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
    _disabled: true,
  };
};

const isIgnorableTickerSearchError = (error) => {
  if (!error) return false;

  const message =
    typeof error?.message === "string" ? error.message.toLowerCase() : "";
  const code =
    typeof error?.data?.code === "string" ? error.data.code.toLowerCase() : "";
  const name = typeof error?.name === "string" ? error.name.toLowerCase() : "";
  const causeName =
    typeof error?.cause?.name === "string" ? error.cause.name.toLowerCase() : "";

  return (
    error?.status === 499 ||
    code === "ticker_search_aborted" ||
    name === "aborterror" ||
    causeName === "aborterror" ||
    name === "cancellederror" ||
    message.includes("aborted") ||
    message.includes("canceled") ||
    message.includes("cancelled")
  );
};

const useDebouncedTickerSearchQuery = (query) => {
  const trimmedQuery = query.trim();
  const [debouncedQuery, setDebouncedQuery] = useState(trimmedQuery);
  const debounceDelayMs = isLikelyTickerSearchInput(trimmedQuery) ? 120 : 220;

  useEffect(() => {
    if (!trimmedQuery) {
      setDebouncedQuery("");
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setDebouncedQuery(trimmedQuery);
    }, debounceDelayMs);

    return () => window.clearTimeout(timeoutId);
  }, [debounceDelayMs, trimmedQuery]);

  return debouncedQuery;
};

const useTickerSearchController = ({
  open,
  query,
  marketFilter,
  currentTicker,
  recentTickerRows = [],
  watchlistSymbols = [],
  favoriteRows = [],
  popularTickers = [],
  contextSymbols = [],
  flowSuggestionSymbols = [],
  signalSuggestionSymbols = [],
  rowCache = {},
  limit = TICKER_SEARCH_INITIAL_RESULT_LIMIT,
}) => {
  const deferredQuery = useDeferredValue(query.trim());
  const debouncedQuery = useDebouncedTickerSearchQuery(deferredQuery);
  const normalizedQuery = normalizeTickerSearchQuery(debouncedQuery);
  const selectedFilter = TICKER_SEARCH_MARKET_BY_VALUE[marketFilter] || TICKER_SEARCH_MARKET_BY_VALUE.all;
  const minimumQueryLength = getTickerSearchMinQueryLength(debouncedQuery);
  const searchEnabled = open && normalizedQuery.length >= minimumQueryLength;
  const requestLimit = getTickerSearchRequestLimit(limit);
  const searchQuery = useSearchUniverseTickers(
    searchEnabled
      ? {
          search: debouncedQuery,
          ...(selectedFilter.markets ? { markets: selectedFilter.markets } : {}),
          active: true,
          limit: requestLimit,
        }
      : undefined,
    {
      query: {
        enabled: searchEnabled,
        staleTime: 30_000,
        placeholderData: (previousData) => previousData,
        retry: false,
      },
    },
  );
  const rawSearchResults = searchQuery.data?.results || [];
  const hasDisplayableSearchError =
    searchEnabled &&
    searchQuery.isError &&
    !isIgnorableTickerSearchError(searchQuery.error);

  const rankedResults = useMemo(() => {
    if (!searchEnabled) return [];

    const recentTickerSet = new Set(
      recentTickerRows.map((row) => normalizeTickerSymbol(row?.ticker)).filter(Boolean),
    );
    const watchlistTickerSet = new Set(
      watchlistSymbols.map((symbol) => normalizeTickerSymbol(symbol)).filter(Boolean),
    );
    const favoriteTickerSet = new Set(
      favoriteRows.map((row) => normalizeTickerSymbol(row?.ticker)).filter(Boolean),
    );

    return rawSearchResults
      .map((result) => ({
        ...result,
        _kind: "result",
        _score: scoreTickerSearchResult(result, {
          query: normalizedQuery,
          currentTicker,
          recentTickerSet,
          watchlistTickerSet,
          favoriteTickerSet,
        }),
      }))
      .filter((result) => Number.isFinite(result._score))
      .sort((left, right) => {
        if (right._score !== left._score) return right._score - left._score;
        return left.ticker.localeCompare(right.ticker);
      })
      .slice(0, limit);
  }, [
    currentTicker,
    favoriteRows,
    limit,
    normalizedQuery,
    recentTickerRows,
    searchEnabled,
    rawSearchResults,
    watchlistSymbols,
  ]);

  const quickPickGroups = useMemo(() => {
    if (searchEnabled) return [];
    const smartGroups = buildSmartTickerSuggestions({
      query: "",
      currentTicker,
      recentTickerRows,
      watchlistSymbols,
      favoriteRows,
      popularTickers,
      contextSymbols,
      flowSymbols: flowSuggestionSymbols,
      signalSymbols: signalSuggestionSymbols,
      rowCache,
      maxRows: TICKER_SEARCH_INITIAL_RESULT_LIMIT,
      maxRowsPerGroup: 5,
    });
    if (smartGroups.length) return smartGroups;

    const buildRows = (symbols, group, max = TICKER_SEARCH_QUICK_PICK_LIMIT) => {
      const uniqueSymbols = Array.from(
        new Set(symbols.map(normalizeTickerSymbol).filter(Boolean)),
      );
      return (Number.isFinite(max) ? uniqueSymbols.slice(0, max) : uniqueSymbols)
        .map((symbol) => {
          const cached = getTickerSearchCachedRow(rowCache, symbol);
          return cached
            ? { ...cached, _group: group, _kind: "quick-pick" }
            : buildUnresolvedTickerSearchRow(symbol, group);
        });
    };

    const recentRows = normalizePersistedTickerSearchRows(recentTickerRows, 8).map(
      (row) => ({ ...row, _group: "Recent", _kind: "quick-pick" }),
    );
    const favoriteGroupRows = normalizePersistedTickerSearchRows(favoriteRows, 8).map(
      (row) => ({ ...row, _group: "Favorites", _kind: "quick-pick" }),
    );
    const groups = [];
    if (favoriteGroupRows.length) groups.push({ label: "Favorites", rows: favoriteGroupRows });
    if (recentRows.length) groups.push({ label: "Recent", rows: recentRows });
    groups.push({ label: "Watchlist", rows: buildRows(watchlistSymbols, "Watchlist") });
    groups.push({ label: "Popular today", rows: buildRows(popularTickers, "Popular today") });
    return groups.filter((group) => group.rows.length);
  }, [
    favoriteRows,
    currentTicker,
    contextSymbols,
    flowSuggestionSymbols,
    popularTickers,
    recentTickerRows,
    rowCache,
    searchEnabled,
    signalSuggestionSymbols,
    watchlistSymbols,
  ]);

  const suggestionGroups = useMemo(() => {
    if (!searchEnabled) return [];
    return buildSmartTickerSuggestions({
      query: debouncedQuery,
      currentTicker,
      recentTickerRows,
      watchlistSymbols,
      favoriteRows,
      popularTickers,
      contextSymbols,
      flowSymbols: flowSuggestionSymbols,
      signalSymbols: signalSuggestionSymbols,
      liveResults: rankedResults,
      rowCache,
      maxRows: 5,
      maxRowsPerGroup: 5,
    });
  }, [
    currentTicker,
    debouncedQuery,
    favoriteRows,
    contextSymbols,
    flowSuggestionSymbols,
    popularTickers,
    rankedResults,
    recentTickerRows,
    rowCache,
    searchEnabled,
    signalSuggestionSymbols,
    watchlistSymbols,
  ]);

  const { prioritySuggestionGroups, secondarySuggestionGroups } = useMemo(() => {
    if (!searchEnabled || !suggestionGroups.length) {
      return { prioritySuggestionGroups: [], secondarySuggestionGroups: suggestionGroups };
    }

    const partitioned = suggestionGroups.reduce(
      (acc, group) => {
        const priorityRows = [];
        const secondaryRows = [];
        for (const row of group.rows) {
          const reasons = Array.isArray(row?._reasons) ? row._reasons : [];
          if (reasons.includes("Exact")) {
            priorityRows.push(row);
          } else {
            secondaryRows.push(row);
          }
        }
        if (priorityRows.length) {
          acc.prioritySuggestionGroups.push({ ...group, rows: priorityRows });
        }
        if (secondaryRows.length) {
          acc.secondarySuggestionGroups.push({ ...group, rows: secondaryRows });
        }
        return acc;
      },
      { prioritySuggestionGroups: [], secondarySuggestionGroups: [] },
    );

    return partitioned;
  }, [searchEnabled, suggestionGroups]);

  const prioritySuggestionRows = useMemo(
    () => flattenTickerSuggestionGroups(prioritySuggestionGroups),
    [prioritySuggestionGroups],
  );
  const secondarySuggestionRows = useMemo(
    () => flattenTickerSuggestionGroups(secondarySuggestionGroups),
    [secondarySuggestionGroups],
  );

  const selectableResults = searchEnabled
    ? [...prioritySuggestionRows, ...rankedResults, ...secondarySuggestionRows]
    : quickPickGroups.flatMap((group) => group.rows);

  return {
    deferredQuery: debouncedQuery,
    normalizedQuery,
    searchEnabled,
    searchQuery,
    hasDisplayableSearchError,
    quickPickGroups,
    suggestionGroups,
    prioritySuggestionGroups,
    secondarySuggestionGroups,
    results: rankedResults,
    selectableResults,
    rawResultCount: rawSearchResults.length,
    requestLimit,
    hasMoreResults:
      searchEnabled &&
      !hasDisplayableSearchError &&
      (rawSearchResults.length > rankedResults.length ||
        rawSearchResults.length >= requestLimit),
  };
};

export const MiniChartTickerSearch = ({
  open,
  ticker,
  recentTickerRows = [],
  watchlistSymbols = [],
  popularTickers = [],
  contextSymbols = [],
  flowSuggestionSymbols = [],
  signalSuggestionSymbols = [],
  embedded = false,
  strictTradeResolution = false,
  onClose,
  onSelectTicker,
  onRememberTickerRow,
}) => {
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const listboxIdRef = useRef(
    `ticker-search-listbox-${Math.random().toString(36).slice(2)}`,
  );
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [marketFilter, setMarketFilter] = useState(() =>
    normalizeTickerSearchMarketFilter(_initialState.marketGridTickerSearchMarketFilter),
  );
  const [visibleResultLimit, setVisibleResultLimit] = useState(
    TICKER_SEARCH_INITIAL_RESULT_LIMIT,
  );
  const [favoriteRows, setFavoriteRows] = useState(() =>
    normalizePersistedTickerSearchRows(_initialState.marketGridTickerSearchFavorites),
  );
  const [rowCache, setRowCache] = useState(() =>
    buildTickerSearchCache(
      normalizePersistedTickerSearchRows(_initialState.marketGridTickerSearchCache),
      recentTickerRows,
      favoriteRows,
    ),
  );
  const {
    deferredQuery,
    searchEnabled,
    searchQuery,
    hasDisplayableSearchError,
    quickPickGroups,
    prioritySuggestionGroups,
    secondarySuggestionGroups,
    results,
    selectableResults,
    rawResultCount,
    hasMoreResults,
  } = useTickerSearchController({
    open,
    query,
    marketFilter,
    currentTicker: ticker,
    recentTickerRows,
    watchlistSymbols,
    favoriteRows,
    popularTickers,
    contextSymbols,
    flowSuggestionSymbols,
    signalSuggestionSymbols,
    rowCache,
    limit: visibleResultLimit,
  });
  const hasLiveResults = searchEnabled && results.length > 0;
  const prioritySuggestionRowCount =
    flattenTickerSuggestionGroups(prioritySuggestionGroups).length;
  const secondarySuggestionRowCount =
    flattenTickerSuggestionGroups(secondarySuggestionGroups).length;
  const suggestionRowCount =
    prioritySuggestionRowCount + secondarySuggestionRowCount;
  const showLoadingSkeleton =
    searchEnabled && searchQuery.isPending && !hasLiveResults && !suggestionRowCount;
  const showUpdatingState =
    searchEnabled && searchQuery.isFetching && (hasLiveResults || suggestionRowCount > 0);

  useEffect(() => {
    persistState({ marketGridTickerSearchMarketFilter: marketFilter });
  }, [marketFilter]);

  useEffect(() => {
    persistState({ marketGridTickerSearchFavorites: favoriteRows });
  }, [favoriteRows]);

  useEffect(() => {
    const rows = (searchQuery.data?.results || [])
      .map(normalizeTickerSearchResultForStorage)
      .filter(Boolean);
    if (!rows.length) return;

    setRowCache((current) => mergeTickerSearchCacheRows(current, rows));
  }, [searchQuery.data?.results]);

  useEffect(() => {
    persistState({
      marketGridTickerSearchCache: compactTickerSearchCacheRows(rowCache),
    });
  }, [rowCache]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIndex(0);
      return undefined;
    }

    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });

    return () => cancelAnimationFrame(frame);
  }, [open, ticker]);

  useEffect(() => {
    setActiveIndex(0);
  }, [open, deferredQuery, selectableResults.length]);

  useEffect(() => {
    setVisibleResultLimit(TICKER_SEARCH_INITIAL_RESULT_LIMIT);
  }, [deferredQuery, marketFilter, open]);

  useEffect(() => {
    if (embedded || !open || typeof document === "undefined") {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (rootRef.current?.contains(event.target)) {
        return;
      }
      onClose?.();
    };

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose?.();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [embedded, onClose, open]);

  const handleCycleMarketFilter = useCallback((direction = 1) => {
    setMarketFilter((current) => {
      const index = TICKER_SEARCH_MARKET_FILTERS.findIndex(
        (filter) => filter.value === current,
      );
      const nextIndex =
        (Math.max(0, index) + direction + TICKER_SEARCH_MARKET_FILTERS.length) %
        TICKER_SEARCH_MARKET_FILTERS.length;
      return TICKER_SEARCH_MARKET_FILTERS[nextIndex].value;
    });
  }, []);

  const handleToggleFavorite = useCallback((result) => {
    const normalized = normalizeTickerSearchResultForStorage(result);
    if (!normalized) return;
    const key = getTickerSearchRowStorageKey(normalized);
    setFavoriteRows((current) => {
      const exists = current.some((row) => getTickerSearchRowStorageKey(row) === key);
      return exists
        ? current.filter((row) => getTickerSearchRowStorageKey(row) !== key)
        : [normalized, ...current];
    });
  }, []);

  const handleLoadMoreResults = useCallback(() => {
    setVisibleResultLimit((current) => current + TICKER_SEARCH_RESULT_INCREMENT);
  }, []);

  const handleSelect = useCallback(
    (result) => {
      if (!result) {
        return;
      }
      if (!isApiBackedTickerSearchRow(result)) {
        setQuery(normalizeTickerSymbol(result._resolutionQuery || result.ticker));
        return;
      }
      const normalized = normalizeTickerSearchResultForStorage(result);
      if (!normalized) return;
      if (!strictTradeResolution) {
        onRememberTickerRow?.(normalized);
      }
      onSelectTicker?.(normalized, {
        query: searchEnabled ? query || deferredQuery : "",
        searchEnabled,
        strictTradeResolution,
      });
    },
    [
      deferredQuery,
      onRememberTickerRow,
      onSelectTicker,
      query,
      searchEnabled,
      strictTradeResolution,
    ],
  );

  const handleInputKeyDown = useCallback(
    (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((current) =>
          selectableResults.length
            ? Math.min(current + 1, selectableResults.length - 1)
            : 0,
        );
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((current) =>
          selectableResults.length ? Math.max(current - 1, 0) : 0,
        );
        return;
      }
      if (event.key === "Enter") {
        if (selectableResults[activeIndex]) {
          event.preventDefault();
          handleSelect(selectableResults[activeIndex]);
        }
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        handleCycleMarketFilter(event.shiftKey ? -1 : 1);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onClose?.();
      }
    },
    [activeIndex, handleCycleMarketFilter, handleSelect, onClose, selectableResults],
  );

  const renderTickerSearchGroups = (groups, startIndex = 0) => {
    let baseIndex = startIndex;
    return groups.map((group) => {
      const groupBaseIndex = baseIndex;
      baseIndex += group.rows.length;
      return (
        <div key={group.label}>
          <div
            style={{
              padding: sp("7px 10px 3px"),
              fontSize: fs(8),
              color: T.textMuted,
              fontFamily: T.sans,
              fontWeight: 400,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            {group.label}
          </div>
          {group.rows.map((result, offset) => {
            const index = groupBaseIndex + offset;
            return (
              <TickerSearchRow
                key={`${group.label}-${buildTickerSearchRowKey(result)}`}
                id={`${listboxIdRef.current}-option-${index}`}
                result={result}
                active={index === activeIndex}
                favorite={favoriteRows.some(
                  (row) =>
                    getTickerSearchRowStorageKey(row) ===
                    getTickerSearchRowStorageKey(result),
                )}
                onSelect={handleSelect}
                onToggleFavorite={handleToggleFavorite}
                onMouseEnter={() => setActiveIndex(index)}
              />
            );
          })}
        </div>
      );
    });
  };

  if (!open) {
    return null;
  }

  const searchPanel = (
    <div
      className="ra-popover-enter"
      style={{
        background: T.bg2,
        border: `1px solid ${T.border}`,
        borderRadius: 0,
        boxShadow: "0 18px 36px rgba(0,0,0,0.32)",
        overflow: "hidden",
      }}
      >
      <div
        style={{
          display: "flex",
          gap: sp(4),
          padding: sp("7px 8px 0"),
          flexWrap: "wrap",
          background: T.bg2,
        }}
      >
        {TICKER_SEARCH_MARKET_FILTERS.map((filter) => {
          const active = marketFilter === filter.value;
          return (
            <button
              key={filter.value}
              type="button"
              data-testid={`ticker-search-filter-${filter.value}`}
              aria-pressed={active}
              className={joinMotionClasses("ra-interactive", active && "ra-focus-rail")}
              onClick={() => setMarketFilter(filter.value)}
              style={{
                ...motionVars({ accent: T.accent }),
                border: `1px solid ${active ? T.accent : T.border}`,
                background: active ? `${T.accent}20` : T.bg1,
                color: active ? T.accent : T.textDim,
                fontFamily: T.mono,
                fontSize: fs(8),
                padding: sp("2px 6px"),
                cursor: "pointer",
                textTransform: "uppercase",
              }}
            >
              {filter.label}
            </button>
          );
        })}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: sp(6),
          padding: sp("8px 8px 6px"),
          borderBottom: `1px solid ${T.border}`,
        }}
      >
        <input
          ref={inputRef}
          data-testid="ticker-search-input"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxIdRef.current}
          aria-autocomplete="list"
          aria-activedescendant={
            selectableResults[activeIndex]
              ? `${listboxIdRef.current}-option-${activeIndex}`
              : undefined
          }
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder={`Search symbol or company for ${ticker}…`}
          style={{
            width: "100%",
            background: T.bg3,
            border: `1px solid ${T.border}`,
            borderRadius: 0,
            padding: sp("6px 8px"),
            color: T.text,
            fontSize: fs(10),
            fontFamily: T.sans,
            outline: "none",
          }}
        />
        <AppTooltip content="Close search"><button
          type="button"
          className="ra-interactive"
          onClick={onClose}
          style={{
            background: "transparent",
            border: "none",
            color: T.textMuted,
            cursor: "pointer",
            fontSize: fs(12),
            lineHeight: 1,
            padding: 0,
          }}
        >
          ×
        </button></AppTooltip>
      </div>
      <div
        id={listboxIdRef.current}
        role="listbox"
        style={{ maxHeight: dim(260), overflowY: "auto", background: T.bg1 }}
      >
        {!searchEnabled ? renderTickerSearchGroups(quickPickGroups) : null}
        {searchEnabled && prioritySuggestionGroups.length
          ? renderTickerSearchGroups(prioritySuggestionGroups)
          : null}
        {showLoadingSkeleton && (
          <TickerSearchSkeletonRows />
        )}
        {showUpdatingState ? (
          <div
            style={{
              padding: sp("6px 10px 0"),
              fontSize: fs(8),
              color: T.textDim,
              fontFamily: T.mono,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            Updating…
          </div>
        ) : null}
        {hasDisplayableSearchError && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: sp(8),
              padding: sp("10px"),
              fontSize: fs(9),
              color: T.amber,
              fontFamily: T.sans,
              background: `${T.amber}10`,
            }}
          >
            <span>Search failed</span>
            <button
              type="button"
              className="ra-interactive"
              onClick={() => searchQuery.refetch()}
              style={{
                border: `1px solid ${T.amber}`,
                background: "transparent",
                color: T.amber,
                fontFamily: T.mono,
                fontSize: fs(8),
                cursor: "pointer",
                padding: sp("2px 6px"),
              }}
            >
              retry
            </button>
          </div>
        )}
        {searchEnabled &&
        !showLoadingSkeleton &&
        !hasDisplayableSearchError &&
        !results.length &&
        !suggestionRowCount ? (
          <div
            style={{
              padding: sp("12px 10px"),
              fontSize: fs(9),
              color: T.textDim,
              fontFamily: T.sans,
            }}
          >
            No results for "{deferredQuery}".
          </div>
        ) : null}
        {searchEnabled && !hasDisplayableSearchError && results.length ? (
          <div
            style={{
              padding: sp("6px 10px 4px"),
              fontSize: fs(8),
              color: T.textMuted,
              fontFamily: T.sans,
              fontWeight: 400,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            Live matches
          </div>
        ) : null}
        {searchEnabled &&
          !hasDisplayableSearchError &&
          results.map((result, index) => (
            <TickerSearchRow
              key={buildTickerSearchRowKey(result)}
              id={`${listboxIdRef.current}-option-${prioritySuggestionRowCount + index}`}
              result={result}
              active={prioritySuggestionRowCount + index === activeIndex}
              favorite={favoriteRows.some(
                (row) =>
                  getTickerSearchRowStorageKey(row) ===
                  getTickerSearchRowStorageKey(result),
              )}
              onSelect={handleSelect}
              onToggleFavorite={handleToggleFavorite}
              onMouseEnter={() => setActiveIndex(prioritySuggestionRowCount + index)}
            />
          ))}
        {searchEnabled && secondarySuggestionGroups.length
          ? renderTickerSearchGroups(
              secondarySuggestionGroups,
              prioritySuggestionRowCount + results.length,
            )
          : null}
        {searchEnabled && !hasDisplayableSearchError && hasLiveResults && hasMoreResults ? (
          <button
            type="button"
            className="ra-interactive"
            onClick={handleLoadMoreResults}
            style={{
              width: "100%",
              border: "none",
              borderTop: `1px solid ${T.border}`,
              background: T.bg2,
              color: T.accent,
              cursor: "pointer",
              fontFamily: T.mono,
              fontSize: fs(8),
              padding: sp("8px 10px"),
              textTransform: "uppercase",
            }}
          >
            Load more matches ({results.length}/{rawResultCount}+)
          </button>
        ) : null}
      </div>
    </div>
  );

  if (embedded) {
    return (
      <div
        data-testid="ticker-search-popover"
        ref={rootRef}
        className="ra-popover-enter"
        onClick={(event) => event.stopPropagation()}
      >
        {searchPanel}
      </div>
    );
  }

  return (
    <div
      data-testid="ticker-search-popover"
      ref={rootRef}
      className="ra-popover-enter"
      onClick={(event) => event.stopPropagation()}
      style={{
        position: "absolute",
        top: dim(34),
        left: sp(6),
        right: sp(6),
        zIndex: 12,
      }}
    >
      {searchPanel}
    </div>
  );
};

export function TickerSearchLab() {
  const [selectedTicker, setSelectedTicker] = useState("SPY");
  const [selectedRow, setSelectedRow] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const popularTickers = ["SPY", "QQQ", "IWM", "AAPL", "NVDA", "MSFT", "TSLA", "AMD"];

  return (
    <div
      style={{
        minHeight: "100vh",
        background: T.bg0,
        color: T.text,
        fontFamily: T.sans,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: sp(24),
      }}
    >
      <style>{FONT_CSS}</style>
      <div
        style={{
          width: dim(640),
          minHeight: dim(280),
          position: "relative",
          background: T.bg1,
          border: `1px solid ${T.border}`,
          boxShadow: "0 18px 45px rgba(0,0,0,0.22)",
          padding: sp(16),
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: sp(6),
            marginBottom: sp(14),
          }}
        >
          <div
            style={{
              fontSize: fs(13),
              fontWeight: 400,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            Ticker Search Lab
          </div>
          <div
            style={{
              fontSize: fs(10),
              color: T.textDim,
            }}
          >
            Real IBKR-backed ticker search, isolated from the rest of the platform.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: sp(12),
            marginBottom: sp(12),
          }}
        >
          <div>
            <div
              style={{
                fontSize: fs(9),
                color: T.textMuted,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginBottom: sp(3),
              }}
            >
              Selected
            </div>
            <AppTooltip content={`Search ${selectedTicker}`}><div
              data-testid="ticker-search-selected"
              style={{
                fontSize: fs(16),
                fontWeight: 400,
                color: T.text,
                fontFamily: T.mono,
              }}
            >
              {selectedTicker}
            </div></AppTooltip>
            {selectedRow?.providerContractId ? (
              <div
                style={{
                  marginTop: sp(4),
                  fontSize: fs(9),
                  color: T.textDim,
                  fontFamily: T.mono,
                }}
              >
                conid {selectedRow.providerContractId}
              </div>
            ) : null}
          </div>

          <AppTooltip content={`Search ${selectedTicker}`}><button
            type="button"
            data-testid="chart-symbol-search-button"
            onClick={() => setSearchOpen(true)}
            style={{
              border: `1px solid ${T.accent}`,
              background: `${T.accent}18`,
              color: T.accent,
              padding: sp("8px 12px"),
              fontSize: fs(10),
              fontWeight: 400,
              cursor: "pointer",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            Search Symbol
          </button></AppTooltip>
        </div>

        <div
          style={{
            fontSize: fs(10),
            color: T.textDim,
            lineHeight: 1.5,
            maxWidth: dim(460),
          }}
        >
          Search by ticker or company name. Enter selects the top live row; click selects any
          visible row. The popover below uses the same live search component as the chart grid.
        </div>

        <MiniChartTickerSearch
          open={searchOpen}
          ticker={selectedTicker}
          recentTickerRows={selectedRow ? [selectedRow] : []}
          watchlistSymbols={popularTickers}
          popularTickers={popularTickers}
          onClose={() => setSearchOpen(false)}
          onSelectTicker={(result) => {
            const nextTicker = normalizeTickerSymbol(result?.ticker);
            const normalized = normalizeTickerSearchResultForStorage(result);
            if (!nextTicker || !normalized) {
              return;
            }
            setSelectedTicker(nextTicker);
            setSelectedRow(normalized);
            setSearchOpen(false);
          }}
          onRememberTickerRow={(row) => setSelectedRow(row)}
        />
      </div>
    </div>
  );
}


export const TickerUniverseSearchPanel = ({
  open,
  onSelectTicker,
  onClose,
  currentTicker = "",
}) => {
  const inputRef = useRef(null);
  const listboxIdRef = useRef(
    `ticker-search-panel-listbox-${Math.random().toString(36).slice(2)}`,
  );
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [marketFilter, setMarketFilter] = useState(() =>
    normalizeTickerSearchMarketFilter(_initialState.marketGridTickerSearchMarketFilter),
  );
  const [visibleResultLimit, setVisibleResultLimit] = useState(
    TICKER_SEARCH_INITIAL_RESULT_LIMIT,
  );
  const [rowCache, setRowCache] = useState(() =>
    buildTickerSearchCache(
      normalizePersistedTickerSearchRows(_initialState.marketGridTickerSearchCache),
    ),
  );
  const {
    deferredQuery,
    searchEnabled,
    searchQuery,
    hasDisplayableSearchError,
    quickPickGroups,
    prioritySuggestionGroups,
    secondarySuggestionGroups,
    results,
    selectableResults,
    rawResultCount,
    hasMoreResults,
  } =
    useTickerSearchController({
      open,
      query,
      marketFilter,
      currentTicker,
      contextSymbols: currentTicker ? [currentTicker] : [],
      rowCache,
      limit: visibleResultLimit,
    });
  const hasLiveResults = searchEnabled && results.length > 0;
  const prioritySuggestionRowCount =
    flattenTickerSuggestionGroups(prioritySuggestionGroups).length;
  const secondarySuggestionRowCount =
    flattenTickerSuggestionGroups(secondarySuggestionGroups).length;
  const suggestionRowCount =
    prioritySuggestionRowCount + secondarySuggestionRowCount;
  const showLoadingSkeleton =
    searchEnabled && searchQuery.isPending && !hasLiveResults && !suggestionRowCount;
  const showUpdatingState =
    searchEnabled && searchQuery.isFetching && (hasLiveResults || suggestionRowCount > 0);

  useEffect(() => {
    persistState({ marketGridTickerSearchMarketFilter: marketFilter });
  }, [marketFilter]);

  useEffect(() => {
    const rows = (searchQuery.data?.results || [])
      .map(normalizeTickerSearchResultForStorage)
      .filter(Boolean);
    if (!rows.length) return;
    setRowCache((current) => mergeTickerSearchCacheRows(current, rows));
  }, [searchQuery.data?.results]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIndex(0);
      return undefined;
    }

    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });

    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [open, deferredQuery, selectableResults.length]);

  useEffect(() => {
    setVisibleResultLimit(TICKER_SEARCH_INITIAL_RESULT_LIMIT);
  }, [deferredQuery, marketFilter, open]);

  const handleSelect = useCallback(
    (result) => {
      if (!result) {
        return;
      }
      if (!isApiBackedTickerSearchRow(result)) {
        setQuery(normalizeTickerSymbol(result._resolutionQuery || result.ticker));
        return;
      }
      onSelectTicker(result);
    },
    [onSelectTicker],
  );

  const handleInputKeyDown = useCallback(
    (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((current) =>
          selectableResults.length
            ? Math.min(current + 1, selectableResults.length - 1)
            : 0,
        );
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((current) =>
          selectableResults.length ? Math.max(current - 1, 0) : 0,
        );
        return;
      }
      if (event.key === "Enter") {
        if (selectableResults[activeIndex]) {
          event.preventDefault();
          handleSelect(selectableResults[activeIndex]);
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onClose?.();
      }
      if (event.key === "Tab") {
        event.preventDefault();
        setMarketFilter((current) => {
          const index = TICKER_SEARCH_MARKET_FILTERS.findIndex(
            (filter) => filter.value === current,
          );
          const direction = event.shiftKey ? -1 : 1;
          const nextIndex =
            (Math.max(0, index) + direction + TICKER_SEARCH_MARKET_FILTERS.length) %
            TICKER_SEARCH_MARKET_FILTERS.length;
          return TICKER_SEARCH_MARKET_FILTERS[nextIndex].value;
        });
      }
    },
    [activeIndex, handleSelect, onClose, selectableResults],
  );

  const handleLoadMoreResults = useCallback(() => {
    setVisibleResultLimit((current) => current + TICKER_SEARCH_RESULT_INCREMENT);
  }, []);

  const renderTickerSearchGroups = (groups, startIndex = 0) => {
    let baseIndex = startIndex;
    return groups.map((group) => {
      const groupBaseIndex = baseIndex;
      baseIndex += group.rows.length;
      return (
        <div key={group.label}>
          <div
            style={{
              padding: sp("7px 10px 3px"),
              fontSize: fs(8),
              color: T.textMuted,
              fontFamily: T.sans,
              fontWeight: 400,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            {group.label}
          </div>
          {group.rows.map((result, offset) => {
            const index = groupBaseIndex + offset;
            return (
              <TickerSearchRow
                key={`${group.label}-${buildTickerSearchRowKey(result)}`}
                id={`${listboxIdRef.current}-option-${index}`}
                result={result}
                active={index === activeIndex}
                favorite={false}
                onSelect={handleSelect}
                onMouseEnter={() => setActiveIndex(index)}
              />
            );
          })}
        </div>
      );
    });
  };

  if (!open) {
    return null;
  }

  return (
    <div
      data-testid="ticker-search-panel"
      style={{
        padding: sp("6px 6px 0"),
        background: T.bg1,
        borderBottom: `1px solid ${T.border}`,
        flexShrink: 0,
      }}
    >
      <div
        style={{
          background: T.bg2,
          border: `1px solid ${T.border}`,
          borderRadius: dim(6),
          padding: sp("8px 10px"),
          display: "flex",
          flexDirection: "column",
          gap: sp(6),
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: sp(8),
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <span
              style={{
                fontSize: fs(10),
                fontWeight: 400,
                fontFamily: T.display,
                color: T.textSec,
                letterSpacing: "0.06em",
              }}
            >
              SEARCH UNIVERSE
            </span>
            <span
              style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}
            >
              Provider-backed ticker search · multi-market
            </span>
          </div>
          <AppTooltip content="Close search"><button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: T.textMuted,
              cursor: "pointer",
              fontSize: fs(12),
              lineHeight: 1,
              padding: 0,
            }}
          >
            ×
          </button></AppTooltip>
        </div>
        <div style={{ display: "flex", gap: sp(4), flexWrap: "wrap" }}>
          {TICKER_SEARCH_MARKET_FILTERS.map((filter) => {
            const active = marketFilter === filter.value;
            return (
              <button
                key={filter.value}
                type="button"
                data-testid={`ticker-search-filter-${filter.value}`}
                aria-pressed={active}
                onClick={() => setMarketFilter(filter.value)}
                style={{
                  border: `1px solid ${active ? T.accent : T.border}`,
                  background: active ? `${T.accent}20` : T.bg1,
                  color: active ? T.accent : T.textDim,
                  fontFamily: T.mono,
                  fontSize: fs(8),
                  padding: sp("2px 6px"),
                  cursor: "pointer",
                  textTransform: "uppercase",
                }}
              >
                {filter.label}
              </button>
            );
          })}
        </div>
        <input
          ref={inputRef}
          data-testid="ticker-search-input"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxIdRef.current}
          aria-autocomplete="list"
          aria-activedescendant={
            selectableResults[activeIndex]
              ? `${listboxIdRef.current}-option-${activeIndex}`
              : undefined
          }
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder="Search ticker or company..."
          style={{
            width: "100%",
            background: T.bg3,
            border: `1px solid ${T.border}`,
            borderRadius: dim(4),
            padding: sp("7px 10px"),
            color: T.text,
            fontSize: fs(11),
            fontFamily: T.sans,
            outline: "none",
          }}
        />
        <div
          id={listboxIdRef.current}
          role="listbox"
          style={{
            minHeight: dim(150),
            maxHeight: dim(220),
            overflowY: "auto",
            border: `1px solid ${T.border}`,
            borderRadius: dim(4),
            background: T.bg1,
          }}
        >
          {!searchEnabled && quickPickGroups.length
            ? renderTickerSearchGroups(quickPickGroups)
            : null}
          {!searchEnabled && !quickPickGroups.length ? (
            <div
              style={{
                padding: sp("12px 10px"),
                fontSize: fs(10),
                color: T.textDim,
                fontFamily: T.sans,
              }}
            >
              Type a ticker, name, CUSIP, ISIN, FIGI, or IBKR conid.
            </div>
          ) : null}
          {searchEnabled && prioritySuggestionGroups.length
            ? renderTickerSearchGroups(prioritySuggestionGroups)
            : null}
          {showLoadingSkeleton && (
            <TickerSearchSkeletonRows />
          )}
          {showUpdatingState ? (
            <div
              style={{
                padding: sp("6px 10px 0"),
                fontSize: fs(8),
                color: T.textDim,
                fontFamily: T.mono,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              Updating…
            </div>
          ) : null}
          {hasDisplayableSearchError && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: sp(8),
                padding: sp("10px"),
                fontSize: fs(10),
                color: T.amber,
                fontFamily: T.sans,
                background: `${T.amber}10`,
              }}
            >
              <span>Search failed</span>
              <button
                type="button"
                onClick={() => searchQuery.refetch()}
                style={{
                  border: `1px solid ${T.amber}`,
                  background: "transparent",
                  color: T.amber,
                  fontFamily: T.mono,
                  fontSize: fs(8),
                  cursor: "pointer",
                  padding: sp("2px 6px"),
                }}
              >
                retry
              </button>
            </div>
          )}
          {searchEnabled &&
          !showLoadingSkeleton &&
          !hasDisplayableSearchError &&
          !results.length &&
          !suggestionRowCount ? (
            <div
              style={{
                padding: sp("12px 10px"),
                fontSize: fs(10),
                color: T.textDim,
                fontFamily: T.sans,
              }}
            >
              No results for "{deferredQuery}".
            </div>
          ) : null}
          {searchEnabled &&
            !hasDisplayableSearchError &&
            results.map((result, index) => (
            <TickerSearchRow
              key={buildTickerSearchRowKey(result)}
              id={`${listboxIdRef.current}-option-${prioritySuggestionRowCount + index}`}
              result={result}
              active={prioritySuggestionRowCount + index === activeIndex}
              favorite={false}
              onSelect={handleSelect}
              onMouseEnter={() => setActiveIndex(prioritySuggestionRowCount + index)}
            />
          ))}
          {searchEnabled && secondarySuggestionGroups.length
            ? renderTickerSearchGroups(
                secondarySuggestionGroups,
                prioritySuggestionRowCount + results.length,
              )
            : null}
          {searchEnabled && !hasDisplayableSearchError && hasLiveResults && hasMoreResults ? (
            <button
              type="button"
              onClick={handleLoadMoreResults}
              style={{
                width: "100%",
                border: "none",
                borderTop: `1px solid ${T.border}`,
                background: T.bg2,
                color: T.accent,
                cursor: "pointer",
                fontFamily: T.mono,
                fontSize: fs(8),
                padding: sp("8px 10px"),
                textTransform: "uppercase",
              }}
            >
              Load more matches ({results.length}/{rawResultCount}+)
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
};
