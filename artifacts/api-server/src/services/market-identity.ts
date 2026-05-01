import { normalizeSymbol } from "../lib/values";
import type { UniverseMarket } from "../providers/polygon/market-data";

type IdentityInput = {
  ticker?: string | null;
  market?: UniverseMarket | null;
  locale?: string | null;
  normalizedExchangeMic?: string | null;
  exchangeDisplay?: string | null;
  primaryExchange?: string | null;
  currencyName?: string | null;
  countryCode?: string | null;
  exchangeCountryCode?: string | null;
  sector?: string | null;
  industry?: string | null;
};

const LOCALE_COUNTRY_BY_CODE: Record<string, string> = {
  au: "AU",
  ca: "CA",
  ch: "CH",
  cn: "CN",
  de: "DE",
  eu: "EU",
  fr: "FR",
  gb: "GB",
  hk: "HK",
  il: "IL",
  in: "IN",
  jp: "JP",
  kr: "KR",
  se: "SE",
  sg: "SG",
  us: "US",
};

const EXCHANGE_COUNTRY_BY_KEY: Record<string, string> = {
  AMEX: "US",
  ARCA: "US",
  ARCX: "US",
  ASX: "AU",
  BATS: "US",
  CBOT: "US",
  CBOE: "US",
  CME: "US",
  COMEX: "US",
  EURONEXT: "EU",
  HKEX: "HK",
  ICEUS: "US",
  LSE: "GB",
  NASDAQ: "US",
  NYMEX: "US",
  NYSE: "US",
  TSX: "CA",
  TSXV: "CA",
  XAMS: "NL",
  XASE: "US",
  XASX: "AU",
  XBRU: "BE",
  XCME: "US",
  XCNQ: "CA",
  XCSE: "DK",
  XETR: "DE",
  XHEL: "FI",
  XHKG: "HK",
  XJSE: "ZA",
  XKRX: "KR",
  XLON: "GB",
  XMAD: "ES",
  XMIL: "IT",
  XNAS: "US",
  XNYS: "US",
  XOSL: "NO",
  XPAR: "FR",
  XSES: "SG",
  XSTO: "SE",
  XSWX: "CH",
  XTAE: "IL",
  XTAI: "TW",
  XTKS: "JP",
  XTSE: "CA",
  XTSX: "CA",
};

const CURRENCY_COUNTRY_BY_CODE: Record<string, string> = {
  AUD: "AU",
  BRL: "BR",
  CAD: "CA",
  CHF: "CH",
  CNH: "CN",
  CNY: "CN",
  DKK: "DK",
  EUR: "EU",
  GBP: "GB",
  HKD: "HK",
  ILS: "IL",
  INR: "IN",
  JPY: "JP",
  KRW: "KR",
  MXN: "MX",
  NOK: "NO",
  NZD: "NZ",
  SEK: "SE",
  SGD: "SG",
  TRY: "TR",
  USD: "US",
  ZAR: "ZA",
};

const VALID_UNIVERSE_MARKETS: readonly UniverseMarket[] = [
  "stocks",
  "etf",
  "indices",
  "futures",
  "fx",
  "crypto",
  "otc",
];

const STATIC_COMPANY_METADATA: Record<
  string,
  {
    market?: UniverseMarket;
    countryCode?: string;
    sector?: string;
    industry?: string;
  }
> = {
  AAPL: { countryCode: "US", sector: "Technology", industry: "Consumer Electronics" },
  AMD: { countryCode: "US", sector: "Technology", industry: "Semiconductors" },
  AMZN: { countryCode: "US", sector: "Consumer Discretionary", industry: "Internet Retail" },
  AVGO: { countryCode: "US", sector: "Technology", industry: "Semiconductors" },
  BAC: { countryCode: "US", sector: "Financials", industry: "Banks" },
  BTC: { market: "crypto", sector: "Crypto", industry: "Digital Asset" },
  BTCUSD: { market: "crypto", sector: "Crypto", industry: "Digital Asset" },
  COIN: { countryCode: "US", sector: "Financials", industry: "Crypto Exchange" },
  CVX: { countryCode: "US", sector: "Energy", industry: "Integrated Oil" },
  DIA: { market: "etf", countryCode: "US", sector: "ETF", industry: "Large Cap Equity" },
  ETH: { market: "crypto", sector: "Crypto", industry: "Digital Asset" },
  ETHUSD: { market: "crypto", sector: "Crypto", industry: "Digital Asset" },
  GLD: { market: "etf", countryCode: "US", sector: "ETF", industry: "Commodity" },
  GOOG: { countryCode: "US", sector: "Communication Services", industry: "Internet Content" },
  GOOGL: { countryCode: "US", sector: "Communication Services", industry: "Internet Content" },
  IWM: { market: "etf", countryCode: "US", sector: "ETF", industry: "Small Cap Equity" },
  JPM: { countryCode: "US", sector: "Financials", industry: "Banks" },
  META: { countryCode: "US", sector: "Communication Services", industry: "Social Platforms" },
  MSFT: { countryCode: "US", sector: "Technology", industry: "Software" },
  NVDA: { countryCode: "US", sector: "Technology", industry: "Semiconductors" },
  QQQ: { market: "etf", countryCode: "US", sector: "ETF", industry: "Growth Equity" },
  SOL: { market: "crypto", sector: "Crypto", industry: "Digital Asset" },
  SOLUSD: { market: "crypto", sector: "Crypto", industry: "Digital Asset" },
  SOXX: { market: "etf", countryCode: "US", sector: "ETF", industry: "Semiconductors" },
  SPY: { market: "etf", countryCode: "US", sector: "ETF", industry: "Broad Market Equity" },
  TLT: { market: "etf", countryCode: "US", sector: "ETF", industry: "Rates" },
  TSLA: { countryCode: "US", sector: "Consumer Discretionary", industry: "Automobiles" },
  UNH: { countryCode: "US", sector: "Health Care", industry: "Managed Care" },
  USO: { market: "etf", countryCode: "US", sector: "ETF", industry: "Commodity" },
  VIXY: { market: "etf", countryCode: "US", sector: "ETF", industry: "Volatility" },
  XOM: { countryCode: "US", sector: "Energy", industry: "Integrated Oil" },
};

export function normalizeUniverseMarket(value: unknown): UniverseMarket | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return VALID_UNIVERSE_MARKETS.includes(normalized as UniverseMarket)
    ? (normalized as UniverseMarket)
    : null;
}

export function normalizeCountryCode(value: string | null | undefined) {
  const normalized = value?.trim().toUpperCase() || "";
  return /^[A-Z]{2}$/.test(normalized) || normalized === "EU"
    ? normalized
    : null;
}

export function resolveExchangeCountryCode(input: IdentityInput) {
  const explicit = normalizeCountryCode(input.exchangeCountryCode);
  if (explicit) return explicit;

  const candidates = [
    input.normalizedExchangeMic,
    input.primaryExchange,
    input.exchangeDisplay,
  ];
  for (const candidate of candidates) {
    const normalized = candidate?.trim().toUpperCase();
    if (!normalized) continue;
    const direct = EXCHANGE_COUNTRY_BY_KEY[normalized];
    if (direct) return direct;
    const tokenMatch = normalized.match(/[A-Z]{3,5}/g) || [];
    const tokenCountry = tokenMatch.map((token) => EXCHANGE_COUNTRY_BY_KEY[token]).find(Boolean);
    if (tokenCountry) return tokenCountry;
  }

  return null;
}

export function resolveTickerCountryCode(input: IdentityInput) {
  const explicit = normalizeCountryCode(input.countryCode);
  if (explicit) return explicit;

  const symbol = normalizeSymbol(input.ticker ?? "");
  const staticCountry = STATIC_COMPANY_METADATA[symbol]?.countryCode;
  if (staticCountry) return staticCountry;

  const localeCountry =
    input.locale && LOCALE_COUNTRY_BY_CODE[input.locale.trim().toLowerCase()];
  if (localeCountry) return localeCountry;

  if (input.market === "fx") {
    const baseCurrency = symbol.replace(/^[A-Z]:/, "").slice(0, 3);
    return CURRENCY_COUNTRY_BY_CODE[baseCurrency] ?? null;
  }

  if (input.market === "stocks" || input.market === "etf" || input.market === "otc") {
    return resolveExchangeCountryCode(input);
  }

  if (input.market === "indices" || input.market === "futures") {
    return resolveExchangeCountryCode(input) ?? "US";
  }

  return null;
}

export function resolveTickerMarket(input: IdentityInput): UniverseMarket | null {
  const explicit = normalizeUniverseMarket(input.market);
  if (explicit) return explicit;

  const symbol = normalizeSymbol(input.ticker ?? "");
  const staticMarket = STATIC_COMPANY_METADATA[symbol]?.market;
  if (staticMarket) return staticMarket;

  if (/^C:[A-Z]{6}$/.test(symbol)) return "fx";
  if (/^X:[A-Z0-9]{2,16}(USD|USDT|USDC)$/.test(symbol)) return "crypto";

  return null;
}

export function resolveTickerSector(input: IdentityInput) {
  if (input.sector?.trim()) return input.sector.trim();
  const symbol = normalizeSymbol(input.ticker ?? "");
  if (STATIC_COMPANY_METADATA[symbol]?.sector) {
    return STATIC_COMPANY_METADATA[symbol].sector ?? null;
  }
  if (input.market === "etf") return "ETF";
  if (input.market === "crypto") return "Crypto";
  if (input.market === "fx") return "FX";
  if (input.market === "futures") return "Futures";
  if (input.market === "indices") return "Index";
  return null;
}

export function resolveTickerIndustry(input: IdentityInput) {
  if (input.industry?.trim()) return input.industry.trim();
  const symbol = normalizeSymbol(input.ticker ?? "");
  return STATIC_COMPANY_METADATA[symbol]?.industry ?? null;
}

export function resolveMarketIdentityMetadata(input: IdentityInput) {
  const exchangeCountryCode = resolveExchangeCountryCode(input);
  return {
    countryCode: resolveTickerCountryCode({ ...input, exchangeCountryCode }),
    exchangeCountryCode,
    sector: resolveTickerSector(input),
    industry: resolveTickerIndustry(input),
  };
}

export function resolveMarketIdentityFields(input: IdentityInput) {
  const market = resolveTickerMarket(input);
  const identityInput = {
    ...input,
    market: market ?? input.market ?? null,
  };
  const exchangeCountryCode = resolveExchangeCountryCode(identityInput);
  return {
    market,
    countryCode: resolveTickerCountryCode({
      ...identityInput,
      exchangeCountryCode,
    }),
    exchangeCountryCode,
    sector: resolveTickerSector(identityInput),
    industry: resolveTickerIndustry(identityInput),
  };
}
