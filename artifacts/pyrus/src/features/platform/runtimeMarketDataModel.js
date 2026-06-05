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
    timestamp: bar.timestamp ?? bar.time ?? bar.t ?? null,
  }));
};

const hasUsableSparklineBars = (bars) =>
  Array.isArray(bars) && bars.length >= 2;

const buildRuntimeSparklinePatch = (bars, fallbackSpark) =>
  hasUsableSparklineBars(bars)
    ? {
        spark: buildSparklineFromHistoricalBars(bars, fallbackSpark),
        sparkBars: bars,
      }
    : {};

const areRuntimeValuesEqual = (left, right) => {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (left.length !== right.length) return false;
    return left.every((value, index) => areRuntimeValuesEqual(value, right[index]));
  }
  if (
    left &&
    right &&
    typeof left === "object" &&
    typeof right === "object"
  ) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every((key) =>
      Object.hasOwn(right, key) && areRuntimeValuesEqual(left[key], right[key]),
    );
  }
  return false;
};

const areWatchlistItemsEqual = (left, right) =>
  areRuntimeValuesEqual(left, right);

const areWatchlistItemsListEqual = (leftItems = [], rightItems = []) =>
  leftItems.length === rightItems.length &&
  leftItems.every((item, index) => areWatchlistItemsEqual(item, rightItems[index]));

const replaceWatchlistIfChanged = (nextItems) => {
  if (areWatchlistItemsListEqual(WATCHLIST, nextItems)) {
    return false;
  }
  WATCHLIST.splice(0, WATCHLIST.length, ...nextItems);
  return true;
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

const buildRuntimeQuotePatch = (quote, current = {}) => ({
  price: quote?.price ?? current.price ?? null,
  bid: quote?.bid ?? current.bid ?? null,
  ask: quote?.ask ?? current.ask ?? null,
  chg: quote?.change ?? current.chg ?? null,
  pct: quote?.changePercent ?? current.pct ?? null,
  open: quote?.open ?? current.open ?? null,
  high: quote?.high ?? current.high ?? null,
  low: quote?.low ?? current.low ?? null,
  prevClose: quote?.prevClose ?? current.prevClose ?? null,
  volume: quote?.volume ?? current.volume ?? null,
  updatedAt: quote?.updatedAt ?? current.updatedAt ?? null,
  dataUpdatedAt: quote?.dataUpdatedAt ?? current.dataUpdatedAt ?? null,
  freshness: quote?.freshness ?? current.freshness ?? null,
  marketDataMode: quote?.marketDataMode ?? current.marketDataMode ?? null,
  delayed: quote?.delayed ?? current.delayed ?? null,
  source: quote?.source ?? current.source ?? null,
  transport: quote?.transport ?? current.transport ?? null,
  latency: quote?.latency ?? current.latency ?? null,
});

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

const buildWatchlistNameBySymbol = (watchlistItems = []) =>
  Object.fromEntries(
    (watchlistItems || []).map((item) => {
      const symbol = item?.symbol?.toUpperCase?.() || item?.sym?.toUpperCase?.();
      const fallbackName =
        item?.name ||
        DEFAULT_WATCHLIST_BY_SYMBOL[symbol]?.name ||
        TRADE_TICKER_INFO[symbol]?.name ||
        symbol;
      return symbol ? [symbol, fallbackName] : null;
    }).filter(Boolean),
  );

const resolveRuntimeQuoteFallbackName = (symbol, watchlistNameBySymbol = {}) =>
  watchlistNameBySymbol[symbol] ||
  DEFAULT_WATCHLIST_BY_SYMBOL[symbol]?.name ||
  INDICES.find((item) => item.sym === symbol)?.name ||
  MACRO_TICKERS.find((item) => item.sym === symbol)?.name ||
  TRADE_TICKER_INFO[symbol]?.name ||
  symbol;

export const applyRuntimeQuoteSnapshots = (quotes = [], watchlistItems = []) => {
  const changedSymbols = new Set();
  const watchlistNameBySymbol = buildWatchlistNameBySymbol(watchlistItems);

  (quotes || []).forEach((quote) => {
    const symbol = quote?.symbol?.toUpperCase?.();
    if (!symbol) {
      return;
    }
    const fallbackName = resolveRuntimeQuoteFallbackName(
      symbol,
      watchlistNameBySymbol,
    );
    const currentTradeInfo = ensureTradeTickerInfo(symbol, fallbackName);
    const prevClose = quote?.prevClose ?? currentTradeInfo.prevClose ?? null;
    const price = quote?.price ?? currentTradeInfo.price ?? null;
    const chg =
      Number.isFinite(price) && Number.isFinite(prevClose)
        ? price - prevClose
        : (quote?.change ?? currentTradeInfo.chg ?? null);
    const pct =
      Number.isFinite(price) && Number.isFinite(prevClose) && prevClose !== 0
        ? ((price - prevClose) / prevClose) * 100
        : (quote?.changePercent ?? currentTradeInfo.pct ?? null);

    if (
      applyRuntimeTickerInfoPatch(symbol, fallbackName, {
        name: fallbackName,
        ...buildRuntimeQuotePatch(quote, currentTradeInfo),
        price,
        chg,
        pct,
      }).changed
    ) {
      changedSymbols.add(symbol);
    }
  });

  if (changedSymbols.size > 0) {
    notifyRuntimeTickerSnapshotSymbols(Array.from(changedSymbols));
  }

  return changedSymbols.size;
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
  const watchlistNameBySymbol = buildWatchlistNameBySymbol(watchlistItems);

  const nextItems = symbols.map((symbol, index) => {
    const normalized = symbol.toUpperCase();
    const base = buildFallbackWatchlistItem(
      normalized,
      index,
      watchlistNameBySymbol[normalized],
    );
    const quote = quoteBySymbol[normalized];
    const tradeInfo = ensureTradeTickerInfo(normalized, base.name);
    const incomingSparkBars = sparklineBarsBySymbol[normalized];
    const spark = buildSparklineFromHistoricalBars(
      incomingSparkBars,
      tradeInfo.spark || base.spark,
    );
    const sparkBars = hasUsableSparklineBars(incomingSparkBars)
      ? incomingSparkBars
      : (tradeInfo.sparkBars || base.sparkBars || []);
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
        ...buildRuntimeQuotePatch(quote, tradeInfo),
        price,
        chg,
        pct,
        ...buildRuntimeSparklinePatch(incomingSparkBars, tradeInfo.spark),
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
      sparkBars,
    };
  });

  replaceWatchlistIfChanged(nextItems);

  Object.entries(quoteBySymbol).forEach(([symbol, quote]) => {
    const fallbackName = resolveRuntimeQuoteFallbackName(
      symbol,
      watchlistNameBySymbol,
    );
    const runtimeSparkBars = sparklineBarsBySymbol[symbol];

    const currentTradeInfo = ensureTradeTickerInfo(symbol, fallbackName);
    if (
      applyRuntimeTickerInfoPatch(symbol, fallbackName, {
        name: fallbackName,
        ...buildRuntimeQuotePatch(quote, currentTradeInfo),
        ...buildRuntimeSparklinePatch(runtimeSparkBars, currentTradeInfo.spark),
      }).changed
    ) {
      changedSymbols.add(symbol);
    }
  });

  Object.entries(sparklineBarsBySymbol).forEach(([symbol, sparkBars]) => {
    const normalized = symbol.toUpperCase();
    if (!Array.isArray(sparkBars) || sparkBars.length < 2) {
      return;
    }
    const fallbackName = resolveRuntimeQuoteFallbackName(
      normalized,
      watchlistNameBySymbol,
    );
    const currentTradeInfo = ensureTradeTickerInfo(normalized, fallbackName);
    if (
      applyRuntimeTickerInfoPatch(normalized, fallbackName, {
        name: fallbackName,
        spark: buildSparklineFromHistoricalBars(
          sparkBars,
          currentTradeInfo.spark,
        ),
        sparkBars,
      }).changed
    ) {
      changedSymbols.add(normalized);
    }
  });

  INDICES.forEach((item) => {
    const normalized = item.sym.toUpperCase();
    const quote = quoteBySymbol[normalized];
    const incomingSparkBars = sparklineBarsBySymbol[normalized];
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
    item.spark = buildSparklineFromHistoricalBars(incomingSparkBars, item.spark);
    item.sparkBars = hasUsableSparklineBars(incomingSparkBars)
      ? incomingSparkBars
      : (item.sparkBars || []);
    if (
      applyRuntimeTickerInfoPatch(item.sym, item.name || item.sym, {
        name: item.name || item.sym,
        price: item.price,
        chg: item.chg,
        pct: item.pct,
        prevClose: item.prevClose ?? TRADE_TICKER_INFO[item.sym]?.prevClose ?? null,
        ...buildRuntimeSparklinePatch(
          incomingSparkBars,
          TRADE_TICKER_INFO[item.sym]?.spark ?? item.spark,
        ),
      }).changed
    ) {
      changedSymbols.add(normalized);
    }
  });

  MACRO_TICKERS.forEach((item) => {
    const normalized = item.sym.toUpperCase();
    const quote = quoteBySymbol[normalized];
    const incomingSparkBars = sparklineBarsBySymbol[normalized];
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
    item.spark = buildSparklineFromHistoricalBars(incomingSparkBars, item.spark);
    item.sparkBars = hasUsableSparklineBars(incomingSparkBars)
      ? incomingSparkBars
      : (item.sparkBars || []);
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
          ...buildRuntimeSparklinePatch(
            incomingSparkBars,
            TRADE_TICKER_INFO[item.sym]?.spark ?? item.spark,
          ),
        },
      ).changed
    ) {
      changedSymbols.add(normalized);
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

  return changedSymbols.size;
};
