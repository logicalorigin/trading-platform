import { normalizeTickerSymbol } from "./tickerIdentity";

export const getTickerSearchRowStorageKey = (result) =>
  [
    normalizeTickerSymbol(result?.ticker),
    result?.market || "",
    result?.normalizedExchangeMic ||
      result?.primaryExchange?.trim?.().toUpperCase?.() ||
      "",
  ].join("|");

export const isApiBackedTickerSearchRow = (result) =>
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

export const normalizePersistedTickerSearchRows = (
  rows,
  limit = Number.POSITIVE_INFINITY,
) => {
  const source = Array.isArray(rows) ? rows : [];
  const boundedSource = Number.isFinite(limit) ? source.slice(0, limit * 3) : source;
  const normalized = boundedSource
    .map(normalizeTickerSearchResultForStorage)
    .filter(Boolean);
  return Number.isFinite(limit) ? normalized.slice(0, limit) : normalized;
};
