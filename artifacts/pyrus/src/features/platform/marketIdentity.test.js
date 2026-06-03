import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  __marketIdentityLogoTestHooks,
  buildMarketIdentityChips,
  countryCodeToFlagEmoji,
  normalizeCountryCode,
  resolveMarketIdentity,
  stableTickerColor,
} from "./marketIdentity.jsx";

const originalFetch = globalThis.fetch;

afterEach(() => {
  __marketIdentityLogoTestHooks.reset();
  if (originalFetch) {
    globalThis.fetch = originalFetch;
  } else {
    delete globalThis.fetch;
  }
});

test("normalizeCountryCode and countryCodeToFlagEmoji normalize flags", () => {
  assert.equal(normalizeCountryCode(" us "), "US");
  assert.equal(normalizeCountryCode("USA"), null);
  assert.equal(countryCodeToFlagEmoji("US"), "🇺🇸");
  assert.equal(countryCodeToFlagEmoji("bad"), "");
});

test("resolveMarketIdentity prefers API identity fields and exchange metadata", () => {
  const identity = resolveMarketIdentity({
    ticker: "aapl",
    name: "Apple Inc.",
    countryCode: "us",
    sector: "Technology",
    industry: "Consumer Electronics",
    normalizedExchangeMic: "XNAS",
  });

  assert.equal(identity.ticker, "AAPL");
  assert.equal(identity.name, "Apple Inc.");
  assert.equal(identity.countryCode, "US");
  assert.equal(identity.exchangeCountryCode, "US");
  assert.equal(identity.sector, "Technology");
  assert.equal(identity.industry, "Consumer Electronics");
  assert.equal(identity.marketLabel, "Stock");
  assert.equal(identity.fallbackText, "AA");
});

test("resolveMarketIdentity derives asset class chrome from symbols", () => {
  assert.equal(resolveMarketIdentity("EURUSD").market, "fx");
  assert.equal(resolveMarketIdentity("EURUSD").countryCode, "EU");
  assert.equal(resolveMarketIdentity("BTCUSD").market, "crypto");
  assert.equal(resolveMarketIdentity("SPY").market, "etf");
});

test("buildMarketIdentityChips returns stable display chips", () => {
  const chips = buildMarketIdentityChips(
    resolveMarketIdentity({
      ticker: "SHOP",
      market: "stocks",
      normalizedExchangeMic: "XTSE",
      provider: "ibkr",
    }),
    { showProvider: true },
  );

  assert.deepEqual(
    chips.map((chip) => [chip.key, chip.label]),
    [
      ["country", "🇨🇦 CA"],
      ["exchange", "XTSE"],
      ["market", "Stock"],
      ["provider", "IBKR"],
    ],
  );
});

test("stableTickerColor is deterministic and ticker-specific", () => {
  assert.equal(stableTickerColor("NVDA"), stableTickerColor("nvda"));
  assert.notEqual(stableTickerColor("NVDA"), stableTickerColor("MSFT"));
});

test("fetchTickerLogo batches same-turn visible logo hydration", async () => {
  const requestedUrls = [];
  globalThis.fetch = async (url, init) => {
    requestedUrls.push(String(url));
    assert.equal(init?.headers?.accept, "application/json");
    return new Response(
      JSON.stringify({
        logos: [
          { symbol: "AAPL", logoUrl: "/logos/aapl.svg" },
          { symbol: "MSFT", logoUrl: "/logos/msft.svg" },
          { symbol: "NVDA", logoUrl: "/logos/nvda.svg" },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const results = await Promise.all([
    __marketIdentityLogoTestHooks.fetchTickerLogo("aapl"),
    __marketIdentityLogoTestHooks.fetchTickerLogo("MSFT"),
    __marketIdentityLogoTestHooks.fetchTickerLogo("nvda"),
  ]);

  assert.deepEqual(results, [
    "/logos/aapl.svg",
    "/logos/msft.svg",
    "/logos/nvda.svg",
  ]);
  assert.equal(requestedUrls.length, 1);

  const requestUrl = new URL(requestedUrls[0], "http://pyrus.local");
  assert.equal(requestUrl.pathname, "/api/universe/logos");
  assert.deepEqual(requestUrl.searchParams.get("symbols")?.split(","), [
    "AAPL",
    "MSFT",
    "NVDA",
  ]);
});
