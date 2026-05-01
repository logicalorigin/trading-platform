import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeCountryCode,
  normalizeUniverseMarket,
  resolveMarketIdentityFields,
  resolveMarketIdentityMetadata,
  resolveTickerMarket,
} from "./market-identity";

test("normalizeCountryCode accepts ISO country codes and EU", () => {
  assert.equal(normalizeCountryCode(" us "), "US");
  assert.equal(normalizeCountryCode("EU"), "EU");
  assert.equal(normalizeCountryCode("usa"), null);
  assert.equal(normalizeCountryCode(""), null);
});

test("normalizeUniverseMarket accepts canonical market identifiers", () => {
  assert.equal(normalizeUniverseMarket(" ETF "), "etf");
  assert.equal(normalizeUniverseMarket("stocks"), "stocks");
  assert.equal(normalizeUniverseMarket("stock"), null);
});

test("resolveTickerMarket uses explicit fields and safe symbol fallbacks", () => {
  assert.equal(resolveTickerMarket({ ticker: "SPY" }), "etf");
  assert.equal(resolveTickerMarket({ ticker: "C:EURUSD" }), "fx");
  assert.equal(resolveTickerMarket({ ticker: "BTCUSD" }), "crypto");
  assert.equal(resolveTickerMarket({ ticker: "X:BTCUSD" }), "crypto");
  assert.equal(resolveTickerMarket({ ticker: "AAPL", market: "stocks" }), "stocks");
});

test("resolveMarketIdentityFields returns canonical watchlist identity", () => {
  assert.deepEqual(
    resolveMarketIdentityFields({
      ticker: "QQQ",
      normalizedExchangeMic: "XNAS",
    }),
    {
      market: "etf",
      countryCode: "US",
      exchangeCountryCode: "US",
      sector: "ETF",
      industry: "Growth Equity",
    },
  );
});

test("resolveMarketIdentityMetadata enriches common listed tickers", () => {
  assert.deepEqual(
    resolveMarketIdentityMetadata({
      ticker: "aapl",
      market: "stocks",
      normalizedExchangeMic: "XNAS",
    }),
    {
      countryCode: "US",
      exchangeCountryCode: "US",
      sector: "Technology",
      industry: "Consumer Electronics",
    },
  );
});

test("resolveMarketIdentityMetadata prefers provider fields", () => {
  assert.deepEqual(
    resolveMarketIdentityMetadata({
      ticker: "AAPL",
      market: "stocks",
      normalizedExchangeMic: "XNAS",
      countryCode: "ie",
      exchangeCountryCode: "us",
      sector: " Hardware ",
      industry: " Phones ",
    }),
    {
      countryCode: "IE",
      exchangeCountryCode: "US",
      sector: "Hardware",
      industry: "Phones",
    },
  );
});

test("resolveMarketIdentityMetadata derives exchange and asset-class chrome", () => {
  assert.deepEqual(
    resolveMarketIdentityMetadata({
      ticker: "EURUSD",
      market: "fx",
    }),
    {
      countryCode: "EU",
      exchangeCountryCode: null,
      sector: "FX",
      industry: null,
    },
  );

  assert.deepEqual(
    resolveMarketIdentityMetadata({
      ticker: "SHOP",
      market: "stocks",
      normalizedExchangeMic: "XTSE",
    }),
    {
      countryCode: "CA",
      exchangeCountryCode: "CA",
      sector: null,
      industry: null,
    },
  );
});
