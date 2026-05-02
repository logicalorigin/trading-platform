import {
  DEFAULT_WATCHLIST_BY_SYMBOL,
  INDICES,
  MACRO_TICKERS,
  RATES_PROXIES,
  SECTORS,
  WATCHLIST,
} from "../market/marketReferenceData";
import {
  TRADE_TICKER_INFO,
  applyRuntimeTickerInfoPatch,
  ensureTradeTickerInfo,
  notifyRuntimeTickerSnapshotSymbols,
} from "./runtimeTickerStore";

const rng = (seed) => {
  let x = seed;
  return () => {
    x = (x * 16807 + 7) % 2147483647;
    return (x - 1) / 2147483646;
  };
};

const buildSparklineFromHistoricalBars = (bars, fallback) => {
  if (!Array.isArray(bars) || bars.length < 2) {
    return Array.isArray(fallback) ? fallback : [];
  }

  return bars.map((bar, index) => ({
    i: index,
    v: bar.close,
  }));
};

const computeTrailingReturnPercent = (currentPrice, baselinePrice) => {
  if (
    typeof currentPrice !== "number" ||
    Number.isNaN(currentPrice) ||
    typeof baselinePrice !== "number" ||
    Number.isNaN(baselinePrice) ||
    baselinePrice === 0
  ) {
    return null;
  }

  return ((currentPrice - baselinePrice) / baselinePrice) * 100;
};

const genTradeFlowMarkers = (seed) => {
  const r = rng(seed);
  const n = 5 + Math.floor(r() * 4);
  return Array.from({ length: n }, () => ({
    barIdx: Math.floor(r() * 70) + 2,
    cp: r() > 0.45 ? "C" : "P",
    size: r() > 0.7 ? "lg" : r() > 0.35 ? "md" : "sm",
    golden: r() > 0.82,
  }));
};

const TRADE_FLOW_MARKERS = Object.fromEntries(
  Object.entries(TRADE_TICKER_INFO).map(([sym, info]) => [
    sym,
    genTradeFlowMarkers(info.barSeed + 555),
  ]),
);

export const buildFallbackWatchlistItem = (symbol, index, name) => {
  const existing = DEFAULT_WATCHLIST_BY_SYMBOL[symbol];
  if (existing) {
    return {
      ...existing,
      price: null,
      chg: null,
      pct: null,
      spark: [],
      name: existing.name || name || symbol,
      sparkBars: existing.sparkBars || [],
    };
  }

  return {
    sym: symbol,
    name: name || symbol,
    price: null,
    chg: null,
    pct: null,
    spark: [],
    sparkBars: [],
  };
};

export const syncRuntimeMarketData = (
  symbols,
  watchlistItems,
  quotes,
  { sparklineBarsBySymbol = {}, performanceBaselineBySymbol = {} } = {},
) => {
  const changedSymbols = new Set();
  const quoteBySymbol = Object.fromEntries(
    (quotes || []).map((quote) => [quote.symbol.toUpperCase(), quote]),
  );
  const watchlistNameBySymbol = Object.fromEntries(
    (watchlistItems || []).map((item) => {
      const symbol = item.symbol.toUpperCase();
      const fallbackName =
        DEFAULT_WATCHLIST_BY_SYMBOL[symbol]?.name ||
        TRADE_TICKER_INFO[symbol]?.name ||
        symbol;
      return [symbol, fallbackName];
    }),
  );

  const nextItems = symbols.map((symbol, index) => {
    const normalized = symbol.toUpperCase();
    const base = buildFallbackWatchlistItem(
      normalized,
      index,
      watchlistNameBySymbol[normalized],
    );
    const quote = quoteBySymbol[normalized];
    const spark = buildSparklineFromHistoricalBars(
      sparklineBarsBySymbol[normalized],
      base.spark,
    );
    const tradeInfo = ensureTradeTickerInfo(normalized, base.name);
    const prevClose = quote?.prevClose ?? tradeInfo.prevClose ?? null;
    const price = quote?.price ?? tradeInfo.price ?? null;
    const chg =
      Number.isFinite(price) && Number.isFinite(prevClose)
        ? price - prevClose
        : (quote?.change ?? tradeInfo.chg ?? null);
    const pct =
      Number.isFinite(price) && Number.isFinite(prevClose) && prevClose !== 0
        ? ((price - prevClose) / prevClose) * 100
        : (quote?.changePercent ?? tradeInfo.pct ?? null);
    const open = quote?.open ?? tradeInfo.open ?? null;
    const high = quote?.high ?? tradeInfo.high ?? null;
    const low = quote?.low ?? tradeInfo.low ?? null;
    const volume = quote?.volume ?? tradeInfo.volume ?? null;
    const updatedAt = quote?.updatedAt ?? tradeInfo.updatedAt ?? null;

    if (
      applyRuntimeTickerInfoPatch(normalized, base.name, {
        name: base.name,
        price,
        chg,
        pct,
        open,
        high,
        low,
        prevClose,
        volume,
        updatedAt,
        spark,
        sparkBars: sparklineBarsBySymbol[normalized] || [],
      }).changed
    ) {
      changedSymbols.add(normalized);
    }

    if (!TRADE_FLOW_MARKERS[normalized]) {
      TRADE_FLOW_MARKERS[normalized] = genTradeFlowMarkers(
        tradeInfo.barSeed + 555,
      );
    }

    return {
      ...base,
      sym: normalized,
      price,
      chg,
      pct,
      spark,
      open,
      high,
      low,
      prevClose,
      volume,
      updatedAt,
      sparkBars: sparklineBarsBySymbol[normalized] || [],
    };
  });

  WATCHLIST.splice(0, WATCHLIST.length, ...nextItems);

  Object.entries(quoteBySymbol).forEach(([symbol, quote]) => {
    const fallbackName =
      watchlistNameBySymbol[symbol] ||
      INDICES.find((item) => item.sym === symbol)?.name ||
      TRADE_TICKER_INFO[symbol]?.name ||
      symbol;
    const runtimeSparkBars = sparklineBarsBySymbol[symbol] || [];

    const currentTradeInfo = ensureTradeTickerInfo(symbol, fallbackName);
    if (
      applyRuntimeTickerInfoPatch(symbol, fallbackName, {
        name: fallbackName,
        price: quote.price ?? currentTradeInfo.price,
        chg: quote.change ?? currentTradeInfo.chg,
        pct: quote.changePercent ?? currentTradeInfo.pct,
        open: quote.open ?? currentTradeInfo.open ?? null,
        high: quote.high ?? currentTradeInfo.high ?? null,
        low: quote.low ?? currentTradeInfo.low ?? null,
        prevClose: quote.prevClose ?? currentTradeInfo.prevClose ?? null,
        volume: quote.volume ?? currentTradeInfo.volume ?? null,
        updatedAt: quote.updatedAt ?? currentTradeInfo.updatedAt ?? null,
        spark: buildSparklineFromHistoricalBars(
          runtimeSparkBars,
          currentTradeInfo.spark,
        ),
        sparkBars: runtimeSparkBars,
      }).changed
    ) {
      changedSymbols.add(symbol);
    }
  });

  INDICES.forEach((item) => {
    const quote = quoteBySymbol[item.sym.toUpperCase()];
    const prevClose = quote?.prevClose ?? item.prevClose ?? null;
    item.prevClose = quote?.prevClose ?? item.prevClose ?? null;
    item.price = quote?.price ?? item.price ?? null;
    item.chg =
      Number.isFinite(item.price) && Number.isFinite(prevClose)
        ? item.price - prevClose
        : quote?.change ?? null;
    item.pct =
      Number.isFinite(item.price) &&
      Number.isFinite(prevClose) &&
      prevClose !== 0
        ? ((item.price - prevClose) / prevClose) * 100
        : quote?.changePercent ?? null;
    item.spark = buildSparklineFromHistoricalBars(
      sparklineBarsBySymbol[item.sym.toUpperCase()],
      item.spark,
    );
    item.sparkBars = sparklineBarsBySymbol[item.sym.toUpperCase()] || [];
    if (
      applyRuntimeTickerInfoPatch(item.sym, item.name || item.sym, {
        name: item.name || item.sym,
        price: item.price,
        chg: item.chg,
        pct: item.pct,
        prevClose: item.prevClose ?? TRADE_TICKER_INFO[item.sym]?.prevClose ?? null,
        spark: item.spark,
        sparkBars: item.sparkBars,
      }).changed
    ) {
      changedSymbols.add(item.sym.toUpperCase());
    }
  });

  MACRO_TICKERS.forEach((item) => {
    const quote = quoteBySymbol[item.sym.toUpperCase()];
    const prevClose = quote?.prevClose ?? item.prevClose ?? null;
    item.prevClose = quote?.prevClose ?? item.prevClose ?? null;
    item.price = quote?.price ?? item.price ?? null;
    item.chg =
      Number.isFinite(item.price) && Number.isFinite(prevClose)
        ? item.price - prevClose
        : quote?.change ?? null;
    item.pct =
      Number.isFinite(item.price) &&
      Number.isFinite(prevClose) &&
      prevClose !== 0
        ? ((item.price - prevClose) / prevClose) * 100
        : quote?.changePercent ?? null;
    item.spark = buildSparklineFromHistoricalBars(
      sparklineBarsBySymbol[item.sym.toUpperCase()],
      item.spark,
    );
    item.sparkBars = sparklineBarsBySymbol[item.sym.toUpperCase()] || [];
    if (
      applyRuntimeTickerInfoPatch(
        item.sym,
        item.label || item.name || item.sym,
        {
          name: item.label || item.name || item.sym,
          price: item.price,
          chg: item.chg,
          pct: item.pct,
          prevClose:
            item.prevClose ?? TRADE_TICKER_INFO[item.sym]?.prevClose ?? null,
          spark: item.spark,
          sparkBars: item.sparkBars,
        },
      ).changed
    ) {
      changedSymbols.add(item.sym.toUpperCase());
    }
  });

  RATES_PROXIES.forEach((item) => {
    const normalized = item.sym.toUpperCase();
    const quote = quoteBySymbol[normalized];
    const currentPrice = quote?.price ?? item.price;
    const baseline = performanceBaselineBySymbol[normalized] ?? null;
    const d5 = computeTrailingReturnPercent(currentPrice, baseline);

    item.price = quote?.price ?? null;
    item.chg = quote?.change ?? null;
    item.pct = quote?.changePercent ?? null;
    item.d5 = d5 ?? null;
  });

  SECTORS.forEach((item) => {
    const normalized = item.sym.toUpperCase();
    const quote = quoteBySymbol[normalized];
    const currentPrice =
      quote?.price ?? TRADE_TICKER_INFO[normalized]?.price ?? null;
    const baseline = performanceBaselineBySymbol[normalized] ?? null;
    const d5 = computeTrailingReturnPercent(currentPrice, baseline);

    item.chg = quote?.changePercent ?? null;
    item.d5 = d5 ?? null;
  });

  if (changedSymbols.size > 0) {
    notifyRuntimeTickerSnapshotSymbols(Array.from(changedSymbols));
  }
};
