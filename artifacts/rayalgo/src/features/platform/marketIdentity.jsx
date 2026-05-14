import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BadgeDollarSign,
  Bitcoin,
  Building2,
  CandlestickChart,
  CircleDollarSign,
  Globe2,
  Landmark,
} from "lucide-react";
import { T, dim, fs, sp } from "../../lib/uiTokens";
import { AppTooltip } from "@/components/ui/tooltip";


const EXCHANGE_COUNTRY_BY_KEY = {
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

const CURRENCY_COUNTRY_BY_CODE = {
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

const STATIC_MARKET_BY_TICKER = {
  BTC: "crypto",
  BTCUSD: "crypto",
  DIA: "etf",
  ETH: "crypto",
  ETHUSD: "crypto",
  GLD: "etf",
  IWM: "etf",
  QQQ: "etf",
  SOL: "crypto",
  SOLUSD: "crypto",
  SOXX: "etf",
  SPY: "etf",
  TLT: "etf",
  USO: "etf",
  VIXY: "etf",
};

const MARKET_LABELS = {
  crypto: "Crypto",
  etf: "ETF",
  futures: "Futures",
  fx: "FX",
  indices: "Index",
  options: "Option",
  otc: "OTC",
  stocks: "Stock",
};

const MARKET_ICON_BY_KEY = {
  crypto: Bitcoin,
  etf: BadgeDollarSign,
  futures: CandlestickChart,
  fx: CircleDollarSign,
  indices: Landmark,
  options: BadgeDollarSign,
  otc: Globe2,
  stocks: Building2,
};

const logoCache = new Map();
const logoInFlight = new Map();
const LOGO_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const readCachedLogo = (ticker) => {
  const cached = logoCache.get(ticker);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    logoCache.delete(ticker);
    return null;
  }
  return cached.logoUrl || null;
};

const hasFreshLogoCacheEntry = (ticker) => {
  const cached = logoCache.get(ticker);
  if (!cached) return false;
  if (cached.expiresAt <= Date.now()) {
    logoCache.delete(ticker);
    return false;
  }
  return true;
};

const writeCachedLogo = (ticker, logoUrl) => {
  logoCache.set(ticker, {
    logoUrl: logoUrl || null,
    expiresAt: Date.now() + LOGO_CACHE_TTL_MS,
  });
};

const fetchTickerLogo = async (ticker) => {
  const normalized = normalizeIdentitySymbol(ticker);
  if (!normalized) return null;

  const cached = readCachedLogo(normalized);
  if (cached || hasFreshLogoCacheEntry(normalized)) return cached;

  const inFlight = logoInFlight.get(normalized);
  if (inFlight) return inFlight;

  const request = fetch(
    `/api/universe/logos?symbols=${encodeURIComponent(normalized)}`,
    { headers: { accept: "application/json" } },
  )
    .then(async (response) => {
      if (!response.ok) return null;
      const payload = await response.json();
      const logoUrl = payload?.logos?.[0]?.logoUrl || null;
      writeCachedLogo(normalized, logoUrl);
      return logoUrl;
    })
    .catch(() => null)
    .finally(() => {
      logoInFlight.delete(normalized);
    });

  logoInFlight.set(normalized, request);
  return request;
};

export const normalizeIdentitySymbol = (value) =>
  String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/^[\s$^]+/, "");

export const normalizeCountryCode = (value) => {
  const normalized = String(value ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) || normalized === "EU" ? normalized : null;
};

export const countryCodeToFlagEmoji = (value) => {
  const code = normalizeCountryCode(value);
  if (!code) return "";
  return String.fromCodePoint(
    ...Array.from(code).map((char) => 0x1f1e6 + char.charCodeAt(0) - 65),
  );
};

export const stableTickerColor = (ticker) => {
  const normalized = normalizeIdentitySymbol(ticker) || "X";
  const hash = Array.from(normalized).reduce(
    (total, char) => (total * 33 + char.charCodeAt(0)) % 9973,
    17,
  );
  const hue = hash % 360;
  return `hsl(${hue} 58% 38%)`;
};

const extractExchangeCountryCode = (value) => {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (!normalized) return null;
  if (EXCHANGE_COUNTRY_BY_KEY[normalized]) return EXCHANGE_COUNTRY_BY_KEY[normalized];
  return (
    (normalized.match(/[A-Z]{3,5}/g) || [])
      .map((token) => EXCHANGE_COUNTRY_BY_KEY[token])
      .find(Boolean) || null
  );
};

const inferMarket = (ticker, input) => {
  if (input?.market) return input.market;
  const normalized = normalizeIdentitySymbol(ticker).replace(/^X:/, "");
  if (STATIC_MARKET_BY_TICKER[normalized]) {
    return STATIC_MARKET_BY_TICKER[normalized];
  }
  if (/^[A-Z]{6}$/.test(normalized)) return "fx";
  return "stocks";
};

export const resolveMarketIdentity = (input) => {
  const source = typeof input === "string" ? { ticker: input } : input || {};
  const ticker = normalizeIdentitySymbol(
    source.ticker || source.symbol || source.sym || source.rootSymbol || "",
  );
  const compactTicker = ticker.replace(/^[A-Z]:/, "");
  const market = inferMarket(compactTicker, source);
  const exchange =
    source.exchangeDisplay ||
    source.normalizedExchangeMic ||
    source.primaryExchange ||
    source.exchange ||
    null;
  const exchangeCountryCode =
    normalizeCountryCode(source.exchangeCountryCode) ||
    extractExchangeCountryCode(source.normalizedExchangeMic) ||
    extractExchangeCountryCode(source.primaryExchange) ||
    extractExchangeCountryCode(source.exchangeDisplay) ||
    null;
  const fxCountryCode =
    market === "fx" ? CURRENCY_COUNTRY_BY_CODE[compactTicker.slice(0, 3)] : null;
  const countryCode =
    normalizeCountryCode(source.countryCode) ||
    fxCountryCode ||
    (["stocks", "etf", "otc", "indices", "futures"].includes(market)
      ? exchangeCountryCode
      : null);
  const sector =
    source.sector ||
    (market === "etf"
      ? "ETF"
      : market === "crypto"
        ? "Crypto"
        : market === "fx"
          ? "FX"
          : market === "futures"
            ? "Futures"
            : market === "indices"
              ? "Index"
              : null);
  const industry = source.industry || null;
  const providers = Array.isArray(source.providers)
    ? source.providers.filter(Boolean)
    : [source.provider, source.tradeProvider, source.dataProviderPreference].filter(Boolean);

  return {
    ticker: compactTicker || ticker || "?",
    name: source.name || source.contractDescription || compactTicker || ticker || "",
    market,
    marketLabel: MARKET_LABELS[market] || "Asset",
    exchange,
    exchangeCountryCode,
    countryCode,
    flag: countryCodeToFlagEmoji(countryCode),
    sector,
    industry,
    logoUrl: source.logoUrl || null,
    providers: Array.from(new Set(providers)),
    providerLabel: Array.from(new Set(providers))
      .map((provider) => String(provider).toUpperCase())
      .join(" + "),
    fallbackText:
      source.brandText ||
      (compactTicker || ticker || "?").replace(/[^A-Z0-9]/g, "").slice(0, 2) ||
      "?",
    fallbackColor: source.brandColor || stableTickerColor(compactTicker || ticker),
    Icon: MARKET_ICON_BY_KEY[market] || Activity,
  };
};

export const buildMarketIdentityChips = (input, options = {}) => {
  const identity = input?.ticker ? input : resolveMarketIdentity(input);
  const {
    showCountry = true,
    showExchange = true,
    showMarket = true,
    showProvider = false,
    showSector = false,
  } = options;
  const chips = [];
  if (showCountry && identity.countryCode) {
    chips.push({
      key: "country",
      label: `${identity.flag || identity.countryCode} ${identity.countryCode}`.trim(),
      title: "Issuer country",
    });
  }
  if (showExchange && identity.exchange) {
    chips.push({ key: "exchange", label: identity.exchange, title: "Listing exchange" });
  }
  if (showMarket && identity.marketLabel) {
    chips.push({ key: "market", label: identity.marketLabel, title: "Market" });
  }
  if (showProvider && identity.providerLabel) {
    chips.push({ key: "provider", label: identity.providerLabel, title: "Data provider" });
  }
  if (showSector && identity.sector) {
    chips.push({ key: "sector", label: identity.sector, title: "Sector" });
  }
  return chips;
};

export function MarketIdentityMark({
  item,
  ticker,
  size = 22,
  showMarketIcon = false,
  style = {},
  title,
}) {
  const identity = useMemo(
    () => resolveMarketIdentity(item || ticker || ""),
    [item, ticker],
  );
  const [failedLogoUrl, setFailedLogoUrl] = useState(null);
  const [hydratedLogoUrl, setHydratedLogoUrl] = useState(() =>
    identity.logoUrl ? null : readCachedLogo(identity.ticker),
  );
  const resolvedLogoUrl = identity.logoUrl || hydratedLogoUrl;
  const logoReady = resolvedLogoUrl && failedLogoUrl !== resolvedLogoUrl;
  const isSymbolIconLogo = /s3-symbol-logo\.tradingview\.com/i.test(
    resolvedLogoUrl || "",
  );
  const Icon = identity.Icon;
  const rounded = 999;

  useEffect(() => {
    let cancelled = false;
    setFailedLogoUrl(null);
    if (identity.logoUrl) {
      setHydratedLogoUrl(null);
      return () => {
        cancelled = true;
      };
    }

    const cached = readCachedLogo(identity.ticker);
    if (cached || hasFreshLogoCacheEntry(identity.ticker)) {
      setHydratedLogoUrl(cached);
      return () => {
        cancelled = true;
      };
    }

    if (
      !identity.ticker ||
      !["stocks", "etf", "otc"].includes(identity.market)
    ) {
      setHydratedLogoUrl(null);
      return () => {
        cancelled = true;
      };
    }

    fetchTickerLogo(identity.ticker).then((logoUrl) => {
      if (!cancelled) {
        setHydratedLogoUrl(logoUrl);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [identity.logoUrl, identity.market, identity.ticker]);

  return (
    <AppTooltip content={title || `${identity.ticker} ${identity.marketLabel}`}><span
      style={{
        width: dim(size),
        height: dim(size),
        minWidth: dim(size),
        minHeight: dim(size),
        borderRadius: rounded,
        display: "inline-grid",
        placeItems: "center",
        position: "relative",
        overflow: "hidden",
        background: logoReady ? T.bg0 : identity.fallbackColor,
        color: "#fff",
        border: "none",
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12)",
        fontFamily: T.sans,
        fontSize: fs(size <= 14 ? 6 : size <= 20 ? 8 : 9),
        fontWeight: 400,
        lineHeight: 1,
        flexShrink: 0,
        ...style,
      }}
    >
      {logoReady ? (
        <img
          src={resolvedLogoUrl}
          alt=""
          onError={() => setFailedLogoUrl(resolvedLogoUrl)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: isSymbolIconLogo ? "cover" : "contain",
            padding: isSymbolIconLogo
              ? 0
              : dim(Math.max(1, Math.round(size * 0.1))),
            background: "transparent",
            filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.35))",
          }}
        />
      ) : showMarketIcon && size >= 22 ? (
        <Icon size={Math.max(12, Math.round(size * 0.58))} strokeWidth={2.3} />
      ) : (
        identity.fallbackText
      )}
      {identity.flag && size >= 20 && !logoReady ? (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            right: -1,
            bottom: -1,
            width: dim(Math.max(10, Math.round(size * 0.46))),
            height: dim(Math.max(8, Math.round(size * 0.36))),
            display: "grid",
            placeItems: "center",
            background: T.bg1,
            borderLeft: `1px solid ${T.border}`,
            borderTop: `1px solid ${T.border}`,
            fontSize: fs(7),
            lineHeight: 1,
          }}
        >
          {identity.flag}
        </span>
      ) : null}
    </span></AppTooltip>
  );
}

export function MarketIdentityChips({
  item,
  identity: identityProp,
  compact = false,
  maxChips = 3,
  showCountry = true,
  showExchange = true,
  showMarket = true,
  showProvider = false,
  showSector = false,
  style = {},
}) {
  const identity = identityProp || resolveMarketIdentity(item);
  const chips = buildMarketIdentityChips(identity, {
    showCountry,
    showExchange,
    showMarket,
    showProvider,
    showSector,
  }).slice(0, maxChips);

  if (!chips.length) return null;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: sp(3),
        minWidth: 0,
        overflow: "hidden",
        ...style,
      }}
    >
      {chips.map((chip) => (
        <AppTooltip key={chip.key} content={chip.title}><span
          key={chip.key}
          style={{
            border: "none",
            color: T.textMuted,
            background: compact ? "transparent" : T.bg2,
            fontSize: fs(compact ? 7 : 8),
            fontFamily: T.sans,
            fontWeight: 400,
            lineHeight: 1,
            padding: sp(compact ? "2px 3px" : "2px 4px"),
            textTransform: chip.key === "country" ? "none" : "uppercase",
            whiteSpace: "nowrap",
            maxWidth: dim(compact ? 76 : 112),
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {chip.label}
        </span></AppTooltip>
      ))}
    </span>
  );
}

export function MarketIdentityInline({
  item,
  ticker,
  size = 18,
  showMark = true,
  showName = false,
  showChips = true,
  style = {},
}) {
  const identity = resolveMarketIdentity(item || ticker || "");
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: sp(5),
        minWidth: 0,
        ...style,
      }}
    >
      {showMark ? <MarketIdentityMark item={item || ticker} size={size} /> : null}
      <span
        style={{
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: T.text,
          fontFamily: T.sans,
          fontWeight: 400,
        }}
      >
        {identity.ticker}
      </span>
      {showName && identity.name ? (
        <span
          style={{
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: T.textDim,
            fontFamily: T.sans,
          }}
        >
          {identity.name}
        </span>
      ) : null}
      {showChips ? (
        <MarketIdentityChips identity={identity} compact maxChips={2} />
      ) : null}
    </span>
  );
}
