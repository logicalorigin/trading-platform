import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSmartTickerSuggestions,
  flattenTickerSuggestionGroups,
  normalizeTickerSearchSymbol,
  resolveTickerSearchIntent,
} from "./model.js";

const apiRow = (ticker, market = "stocks") => ({
  ticker,
  name: `${ticker} Corp.`,
  market,
  rootSymbol: ticker,
  normalizedExchangeMic: market === "stocks" ? "XNAS" : null,
  exchangeDisplay: market === "stocks" ? "NASDAQ" : null,
  logoUrl: null,
  contractDescription: `${ticker} Corp.`,
  contractMeta: null,
  locale: "us",
  type: "CS",
  active: true,
  primaryExchange: market === "stocks" ? "NASDAQ" : null,
  currencyName: market === "fx" ? "USD" : null,
  cik: null,
  compositeFigi: null,
  shareClassFigi: null,
  lastUpdatedAt: null,
  provider: "ibkr",
  providers: ["ibkr"],
  tradeProvider: "ibkr",
  dataProviderPreference: "ibkr",
  providerContractId: `conid-${ticker}-${market}`,
});

test("normalizes common suggestive-search symbol variants", () => {
  assert.equal(normalizeTickerSearchSymbol("$SPX"), "SPX");
  assert.equal(normalizeTickerSearchSymbol("^VIX"), "VIX");
  assert.equal(normalizeTickerSearchSymbol("eur.usd"), "EURUSD");
  assert.equal(normalizeTickerSearchSymbol("EUR USD"), "EURUSD");
  assert.equal(normalizeTickerSearchSymbol("BRK B"), "BRK.B");
});

test("resolves market intent for ambiguous user inputs", () => {
  assert.deepEqual(resolveTickerSearchIntent("$SPX"), {
    symbol: "SPX",
    displaySymbol: "SPX",
    market: "indices",
    name: "S&P 500 Index",
    reasons: ["Exact", "Index"],
    resolutionQuery: "SPX",
  });
  assert.equal(resolveTickerSearchIntent("EURUSD")?.symbol, "EUR");
  assert.equal(resolveTickerSearchIntent("EURUSD")?.market, "fx");
  assert.equal(resolveTickerSearchIntent("BTCUSD")?.symbol, "BTC");
  assert.equal(resolveTickerSearchIntent("BTCUSD")?.market, "crypto");
  assert.equal(resolveTickerSearchIntent("BRK.B")?.symbol, "BRK.B");
});

test("does not duplicate or outrank an exact live match", () => {
  const groups = buildSmartTickerSuggestions({
    query: "AAPL",
    watchlistSymbols: ["AAPL"],
    liveResults: [apiRow("AAPL")],
  });

  assert.equal(flattenTickerSuggestionGroups(groups).length, 0);
});

test("keeps index intent above stock false positives", () => {
  const groups = buildSmartTickerSuggestions({
    query: "spx",
    liveResults: [apiRow("SPX", "stocks")],
  });
  const rows = flattenTickerSuggestionGroups(groups);

  assert.equal(rows[0]?.ticker, "SPX");
  assert.equal(rows[0]?.market, "indices");
  assert.deepEqual(rows[0]?._reasons, ["Exact", "Index"]);
});

test("builds empty-input suggestions from context, favorites, recents, signals, and flow", () => {
  const groups = buildSmartTickerSuggestions({
    currentTicker: "SPY",
    favoriteRows: [apiRow("AAPL")],
    recentTickerRows: [apiRow("MSFT")],
    watchlistSymbols: ["NVDA", "AAPL"],
    signalSymbols: ["TSLA"],
    flowSymbols: [{ ticker: "AMD" }],
    popularTickers: ["META"],
    rowCache: {
      AAPL: apiRow("AAPL"),
      MSFT: apiRow("MSFT"),
    },
  });

  assert.deepEqual(
    groups.map((group) => group.label),
    ["Continue", "Favorites", "Recent", "Watchlist", "Signals", "Flow", "Related", "Popular today"],
  );

  const rows = flattenTickerSuggestionGroups(groups);
  assert.ok(rows.some((row) => row.ticker === "SPY" && row._reasons.includes("Current")));
  assert.ok(rows.some((row) => row.ticker === "AAPL" && row._reasons.includes("Favorite")));
  assert.ok(rows.some((row) => row.ticker === "TSLA" && row._reasons.includes("Signal")));
  assert.ok(rows.some((row) => row.ticker === "AMD" && row._reasons.includes("Flow")));
});
