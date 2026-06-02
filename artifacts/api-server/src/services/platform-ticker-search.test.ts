import assert from "node:assert/strict";
import test from "node:test";
import type { UniverseTicker } from "../providers/massive/market-data";
import { __platformTickerSearchTestInternals } from "./platform";

const buildIbkrTicker = (
  overrides: Partial<UniverseTicker> = {},
): UniverseTicker => ({
  ticker: "MSFT",
  name: "Microsoft Corp",
  market: "stocks",
  rootSymbol: "MSFT",
  normalizedExchangeMic: "XNAS",
  exchangeDisplay: "XNAS",
  logoUrl: null,
  countryCode: "US",
  exchangeCountryCode: "US",
  sector: null,
  industry: null,
  contractDescription: "Microsoft Corp",
  contractMeta: null,
  locale: null,
  type: "STK",
  active: true,
  primaryExchange: "XNAS",
  currencyName: "USD",
  cik: null,
  compositeFigi: null,
  shareClassFigi: null,
  lastUpdatedAt: null,
  provider: "ibkr",
  providers: ["ibkr"],
  tradeProvider: "ibkr",
  dataProviderPreference: "ibkr",
  providerContractId: "272093",
  ...overrides,
});

test("ticker search fast path treats company-name queries as immediate primary matches", () => {
  const {
    isTickerLikeSearch,
    shouldUseUniverseCatalogImmediateResponse,
  } = __platformTickerSearchTestInternals;

  assert.equal(isTickerLikeSearch("MICROSOFT"), true);
  assert.equal(
    shouldUseUniverseCatalogImmediateResponse({
      normalizedSearch: "MICROSOFT",
      requestedMarkets: [
        "stocks",
        "etf",
        "indices",
        "futures",
        "fx",
        "crypto",
        "otc",
      ],
      response: {
        count: 1,
        results: [buildIbkrTicker()],
      },
    }),
    true,
  );
});

test("ticker search fast path still requires primary tradable name matches", () => {
  const { shouldUseUniverseCatalogImmediateResponse } =
    __platformTickerSearchTestInternals;

  assert.equal(
    shouldUseUniverseCatalogImmediateResponse({
      normalizedSearch: "MICROSOFT",
      requestedMarkets: [
        "stocks",
        "etf",
        "indices",
        "futures",
        "fx",
        "crypto",
        "otc",
      ],
      response: {
        count: 1,
        results: [
          buildIbkrTicker({
            market: "indices",
            name: "Microsoft Sentiment Index",
            providerContractId: "idx-1",
          }),
        ],
      },
    }),
    false,
  );
});

test("ticker search returns primary catalog ticker prefixes without waiting for live fanout", () => {
  const { shouldUseUniverseCatalogImmediateResponse } =
    __platformTickerSearchTestInternals;

  assert.equal(
    shouldUseUniverseCatalogImmediateResponse({
      normalizedSearch: "BLD",
      requestedMarkets: [
        "stocks",
        "etf",
        "indices",
        "futures",
        "fx",
        "crypto",
        "otc",
      ],
      response: {
        count: 3,
        results: [
          buildIbkrTicker({
            ticker: "BLD",
            name: "TopBuild Corp",
            market: "stocks",
            rootSymbol: "BLD",
            providers: ["massive"],
            provider: "massive",
            tradeProvider: null,
            dataProviderPreference: "massive",
            providerContractId: null,
          }),
          buildIbkrTicker({
            ticker: "BLDP",
            name: "Ballard Power Systems Inc",
            market: "stocks",
            rootSymbol: "BLDP",
          }),
          buildIbkrTicker({
            ticker: "BLDG",
            name: "Cambria Global Real Estate ETF",
            market: "etf",
            rootSymbol: "BLDG",
            providers: ["massive"],
            provider: "massive",
            tradeProvider: null,
            dataProviderPreference: "massive",
            providerContractId: null,
          }),
        ],
      },
    }),
    true,
  );
});

test("ticker search does not use off-lane catalog prefixes for hinted markets", () => {
  const { shouldUseUniverseCatalogImmediateResponse } =
    __platformTickerSearchTestInternals;

  assert.equal(
    shouldUseUniverseCatalogImmediateResponse({
      normalizedSearch: "ES",
      requestedMarkets: [
        "stocks",
        "etf",
        "indices",
        "futures",
        "fx",
        "crypto",
        "otc",
      ],
      response: {
        count: 1,
        results: [
          buildIbkrTicker({
            ticker: "ESAB",
            name: "ESAB Corp",
            market: "stocks",
            rootSymbol: "ESAB",
            providers: ["massive"],
            provider: "massive",
            tradeProvider: null,
            dataProviderPreference: "massive",
            providerContractId: null,
          }),
        ],
      },
    }),
    false,
  );
});
