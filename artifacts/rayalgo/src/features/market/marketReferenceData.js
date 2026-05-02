import { isFiniteNumber } from "../../lib/formatters";

export const WATCHLIST = [
  {
    sym: "SPY",
    name: "SPDR S&P 500",
    price: null,
    chg: null,
    pct: null,
    spark: [],
  },
  {
    sym: "QQQ",
    name: "Invesco QQQ",
    price: null,
    chg: null,
    pct: null,
    spark: [],
  },
  {
    sym: "IWM",
    name: "iShares Russ 2000",
    price: null,
    chg: null,
    pct: null,
    spark: [],
  },
  {
    sym: "VIXY",
    name: "ProShares VIX Short-Term Futures ETF",
    price: null,
    chg: null,
    pct: null,
    spark: [],
  },
  {
    sym: "AAPL",
    name: "Apple Inc",
    price: null,
    chg: null,
    pct: null,
    spark: [],
  },
  {
    sym: "MSFT",
    name: "Microsoft Corp",
    price: null,
    chg: null,
    pct: null,
    spark: [],
  },
  {
    sym: "NVDA",
    name: "NVIDIA Corp",
    price: null,
    chg: null,
    pct: null,
    spark: [],
  },
  {
    sym: "AMZN",
    name: "Amazon.com",
    price: null,
    chg: null,
    pct: null,
    spark: [],
  },
  {
    sym: "META",
    name: "Meta Platforms",
    price: null,
    chg: null,
    pct: null,
    spark: [],
  },
  {
    sym: "TSLA",
    name: "Tesla Inc",
    price: null,
    chg: null,
    pct: null,
    spark: [],
  },
  {
    sym: "UUP",
    name: "Invesco DB US Dollar Index Bullish Fund",
    price: null,
    chg: null,
    pct: null,
    spark: [],
  },
  {
    sym: "IEF",
    name: "iShares 7-10 Year Treasury Bond ETF",
    price: null,
    chg: null,
    pct: null,
    spark: [],
  },
];

export const DEFAULT_WATCHLIST_BY_SYMBOL = Object.fromEntries(
  WATCHLIST.map((item) => [item.sym, { ...item, spark: [...item.spark] }]),
);

export const INDICES = [
  {
    sym: "SPY",
    name: "S&P 500",
    price: null,
    chg: null,
    pct: null,
    spark: [],
  },
  {
    sym: "QQQ",
    name: "Nasdaq 100",
    price: null,
    chg: null,
    pct: null,
    spark: [],
  },
  {
    sym: "IWM",
    name: "Russell 2k",
    price: null,
    chg: null,
    pct: null,
    spark: [],
  },
  {
    sym: "DIA",
    name: "Dow Jones",
    price: null,
    chg: null,
    pct: null,
    spark: [],
  },
];

export const MACRO_TICKERS = [
  { sym: "VIXY", price: null, chg: null, pct: null, label: "Volatility" },
  { sym: "IEF", price: null, chg: null, pct: null, label: "Treasuries" },
  { sym: "UUP", price: null, chg: null, pct: null, label: "Dollar" },
  { sym: "GLD", price: null, chg: null, pct: null, label: "Gold" },
  { sym: "USO", price: null, chg: null, pct: null, label: "Crude" },
];

export const RATES_PROXIES = [
  { term: "1-3M", sym: "BIL", price: null, chg: null, pct: null, d5: null },
  {
    term: "1-3Y",
    sym: "SHY",
    price: null,
    chg: null,
    pct: null,
    d5: null,
  },
  { term: "3-7Y", sym: "IEI", price: null, chg: null, pct: null, d5: null },
  { term: "7-10Y", sym: "IEF", price: null, chg: null, pct: null, d5: null },
  { term: "20Y+", sym: "TLT", price: null, chg: null, pct: null, d5: null },
];

export const SECTORS = [
  { name: "Technology", sym: "XLK", chg: null, d5: null },
  { name: "Financials", sym: "XLF", chg: null, d5: null },
  { name: "Healthcare", sym: "XLV", chg: null, d5: null },
  { name: "Industrials", sym: "XLI", chg: null, d5: null },
  { name: "Energy", sym: "XLE", chg: null, d5: null },
  { name: "Cons Disc", sym: "XLY", chg: null, d5: null },
  { name: "Utilities", sym: "XLU", chg: null, d5: null },
  { name: "Comm Svcs", sym: "XLC", chg: null, d5: null },
  { name: "Materials", sym: "XLB", chg: null, d5: null },
  { name: "Staples", sym: "XLP", chg: null, d5: null },
  { name: "Real Estate", sym: "XLRE", chg: null, d5: null },
];

export const MARKET_SNAPSHOT_SYMBOLS = [
  ...new Set([
    ...INDICES.map((item) => item.sym),
    ...MACRO_TICKERS.map((item) => item.sym),
    ...RATES_PROXIES.map((item) => item.sym),
    ...SECTORS.map((item) => item.sym),
  ]),
];

export const MARKET_PERFORMANCE_SYMBOLS = [
  ...new Set([
    ...MACRO_TICKERS.map((item) => item.sym),
    ...RATES_PROXIES.map((item) => item.sym),
    ...SECTORS.map((item) => item.sym),
  ]),
];

export const buildTrackedBreadthSummary = () => {
  const trackedSymbols = new Set();
  const trackedRows = [...WATCHLIST, ...INDICES, ...MACRO_TICKERS, ...SECTORS]
    .filter((item) => {
      const symbol = item?.sym?.toUpperCase();
      if (!symbol || trackedSymbols.has(symbol)) return false;
      trackedSymbols.add(symbol);
      return true;
    });
  const observedDaily = trackedRows.filter((item) =>
    isFiniteNumber(item.pct ?? item.chg),
  );
  const observedFiveDay = [...SECTORS, ...RATES_PROXIES].filter((item) =>
    isFiniteNumber(item.d5),
  );
  const observedSectors = SECTORS.filter((sector) =>
    isFiniteNumber(sector.chg),
  );
  const total = observedDaily.length;
  const getDailyChange = (item) => item.pct ?? item.chg;
  const advancers = observedDaily.filter((item) => getDailyChange(item) > 0)
    .length;
  const decliners = observedDaily.filter((item) => getDailyChange(item) < 0)
    .length;
  const unchanged = observedDaily.filter((item) => getDailyChange(item) === 0)
    .length;
  const positive5d = observedFiveDay.filter((item) => item.d5 > 0).length;
  const positiveSectors = observedSectors.filter((sector) => sector.chg > 0)
    .length;
  const sortedSectors = [...observedSectors].sort(
    (left, right) => right.chg - left.chg,
  );
  const leader = sortedSectors[0] || null;
  const laggard = sortedSectors[sortedSectors.length - 1] || null;

  return {
    total,
    advancers,
    decliners,
    unchanged,
    fiveDayCoverage: observedFiveDay.length,
    sectorCoverage: observedSectors.length,
    advancePct: total > 0 ? (advancers / total) * 100 : null,
    positive5dPct:
      observedFiveDay.length > 0
        ? (positive5d / observedFiveDay.length) * 100
        : null,
    positiveSectors,
    leader,
    laggard,
  };
};

export const buildRatesProxySummary = () => {
  const sorted = [...RATES_PROXIES]
    .filter((item) => isFiniteNumber(item.pct))
    .sort((left, right) => right.pct - left.pct);
  return {
    leader: sorted[0] || null,
    laggard: sorted[sorted.length - 1] || null,
  };
};
