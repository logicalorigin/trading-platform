import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  __resetHighBetaUniverseCacheForTests,
  getHighBetaUniverseAvailabilityStatus,
  getHighBetaUniversePreview,
  validateHighBetaUniverseCandidate,
  type HighBetaUniverseMassiveClient,
} from "./high-beta-universe";
import type { FmpHighBetaScreenerCandidate } from "../providers/fmp/client";

function candidate(
  symbol: string,
  beta: number,
  overrides: Partial<FmpHighBetaScreenerCandidate> = {},
): FmpHighBetaScreenerCandidate {
  return {
    symbol,
    name: `${symbol} Inc.`,
    beta,
    price: 25,
    volume: 2_000_000,
    marketCap: 1_000_000_000,
    exchange: "NASDAQ",
    exchangeShortName: "NASDAQ",
    country: "US",
    isEtf: false,
    isActivelyTrading: true,
    source: "fmp-company-screener",
    ...overrides,
  };
}

function massiveClient(
  overrides: Partial<HighBetaUniverseMassiveClient> = {},
): HighBetaUniverseMassiveClient {
  return {
    getUniverseTickerByTicker: async (symbol: string) => ({
      ticker: symbol,
      name: `${symbol} Inc.`,
      market: "stocks",
      rootSymbol: symbol,
      normalizedExchangeMic: "XNAS",
      exchangeDisplay: "XNAS",
      logoUrl: null,
      countryCode: null,
      exchangeCountryCode: null,
      sector: null,
      industry: null,
      contractDescription: `${symbol} Inc.`,
      contractMeta: { massiveMarket: "stocks", massiveType: "CS" },
      locale: "us",
      type: "CS",
      active: true,
      primaryExchange: "XNAS",
      currencyName: "usd",
      cik: null,
      compositeFigi: null,
      shareClassFigi: null,
      lastUpdatedAt: null,
      provider: "massive",
      providers: ["massive"],
      tradeProvider: null,
      dataProviderPreference: "massive",
      providerContractId: null,
    }),
    getQuoteSnapshots: async (symbols: string[]) =>
      symbols.map((symbol) => ({
        symbol,
        price: 25,
        bid: 24.99,
        ask: 25.01,
        bidSize: 1,
        askSize: 1,
        change: 0,
        changePercent: 0,
        open: 24,
        high: 26,
        low: 23,
        prevClose: 24,
        volume: 2_000_000,
        updatedAt: new Date("2026-06-04T15:00:00.000Z"),
      })),
    getHistoricalOptionContracts: async () => [
      {
        ticker: "O:ABC260619C00025000",
        underlying: "ABC",
        expirationDate: new Date("2026-06-19T00:00:00.000Z"),
        strike: 25,
        right: "call",
        sharesPerContract: 100,
      },
    ],
    ...overrides,
  };
}

async function withIsolatedHighBetaCache<T>(task: () => Promise<T>): Promise<T> {
  const previousCacheFile = process.env["PYRUS_HIGH_BETA_UNIVERSE_CACHE_FILE"];
  const previousFmpApiKey = process.env["FMP_API_KEY"];
  const previousFmpKey = process.env["FMP_KEY"];
  const previousFinancialModelingPrepApiKey =
    process.env["FINANCIAL_MODELING_PREP_API_KEY"];
  const previousMassiveApiKey = process.env["MASSIVE_API_KEY"];
  const previousMassiveMarketDataApiKey =
    process.env["MASSIVE_MARKET_DATA_API_KEY"];
  const dir = mkdtempSync(join(tmpdir(), "pyrus-high-beta-universe-test-"));
  process.env["PYRUS_HIGH_BETA_UNIVERSE_CACHE_FILE"] = join(
    dir,
    "universe.json",
  );
  delete process.env["FMP_API_KEY"];
  delete process.env["FMP_KEY"];
  delete process.env["FINANCIAL_MODELING_PREP_API_KEY"];
  process.env["MASSIVE_API_KEY"] = "massive-test-key";
  delete process.env["MASSIVE_MARKET_DATA_API_KEY"];
  __resetHighBetaUniverseCacheForTests();

  try {
    return await task();
  } finally {
    __resetHighBetaUniverseCacheForTests();
    rmSync(dir, { recursive: true, force: true });
    if (previousCacheFile === undefined) {
      delete process.env["PYRUS_HIGH_BETA_UNIVERSE_CACHE_FILE"];
    } else {
      process.env["PYRUS_HIGH_BETA_UNIVERSE_CACHE_FILE"] = previousCacheFile;
    }
    if (previousFmpApiKey === undefined) {
      delete process.env["FMP_API_KEY"];
    } else {
      process.env["FMP_API_KEY"] = previousFmpApiKey;
    }
    if (previousFmpKey === undefined) {
      delete process.env["FMP_KEY"];
    } else {
      process.env["FMP_KEY"] = previousFmpKey;
    }
    if (previousFinancialModelingPrepApiKey === undefined) {
      delete process.env["FINANCIAL_MODELING_PREP_API_KEY"];
    } else {
      process.env["FINANCIAL_MODELING_PREP_API_KEY"] =
        previousFinancialModelingPrepApiKey;
    }
    if (previousMassiveApiKey === undefined) {
      delete process.env["MASSIVE_API_KEY"];
    } else {
      process.env["MASSIVE_API_KEY"] = previousMassiveApiKey;
    }
    if (previousMassiveMarketDataApiKey === undefined) {
      delete process.env["MASSIVE_MARKET_DATA_API_KEY"];
    } else {
      process.env["MASSIVE_MARKET_DATA_API_KEY"] =
        previousMassiveMarketDataApiKey;
    }
  }
}

test("high-beta candidate validation rejects junk before accepting optionable liquid names", async () => {
  const accepted = await validateHighBetaUniverseCandidate({
    candidate: candidate("ABC", 2.4),
    massiveClient: massiveClient(),
    quote: {
      symbol: "ABC",
      price: 25,
      bid: 24.99,
      ask: 25.01,
      bidSize: 1,
      askSize: 1,
      change: 0,
      changePercent: 0,
      open: 24,
      high: 26,
      low: 23,
      prevClose: 24,
      volume: 2_000_000,
      updatedAt: new Date("2026-06-04T15:00:00.000Z"),
    },
    minPrice: 5,
    minVolume: 500_000,
    minDollarVolume: 10_000_000,
  });
  assert.equal(accepted.status, "accepted");
  if (accepted.status === "accepted") {
    assert.equal(accepted.value.optionContractCount, 1);
    assert.equal(accepted.value.intradayVolatility, 0.12);
  }

  const lowLiquidity = await validateHighBetaUniverseCandidate({
    candidate: candidate("THIN", 3.5),
    massiveClient: massiveClient(),
    quote: {
      symbol: "THIN",
      price: 4,
      bid: 3.99,
      ask: 4.01,
      bidSize: 1,
      askSize: 1,
      change: 0,
      changePercent: 0,
      open: 4,
      high: 4.5,
      low: 3.5,
      prevClose: 4,
      volume: 100_000,
      updatedAt: new Date("2026-06-04T15:00:00.000Z"),
    },
    minPrice: 5,
    minVolume: 500_000,
    minDollarVolume: 10_000_000,
  });
  assert.equal(lowLiquidity.status, "rejected");
  assert.equal(lowLiquidity.reason, "low_liquidity");

  const warrant = await validateHighBetaUniverseCandidate({
    candidate: candidate("WNT", 4.1),
    massiveClient: massiveClient({
      getUniverseTickerByTicker: async (symbol: string) => ({
        ...(await massiveClient().getUniverseTickerByTicker(symbol))!,
        type: "WARRANT",
        contractMeta: { massiveMarket: "stocks", massiveType: "WARRANT" },
      }),
    }),
    quote: {
      symbol: "WNT",
      price: 10,
      bid: 9.99,
      ask: 10.01,
      bidSize: 1,
      askSize: 1,
      change: 0,
      changePercent: 0,
      open: 10,
      high: 11,
      low: 9,
      prevClose: 10,
      volume: 2_000_000,
      updatedAt: new Date("2026-06-04T15:00:00.000Z"),
    },
    minPrice: 5,
    minVolume: 500_000,
    minDollarVolume: 10_000_000,
  });
  assert.equal(warrant.status, "rejected");
  assert.equal(warrant.reason, "unsupported_security_type");
});

test("high-beta universe preview ranks accepted candidates by blended options opportunity score", async () => {
  __resetHighBetaUniverseCacheForTests();
  const fmpClient = {
    getHighBetaScreenerCandidates: async () => [
      candidate("LOW", 1.8),
      candidate("JUNK", 9.9),
      candidate("HIGH", 4.2),
      candidate("VOL", 3.6),
    ],
  };
  const client = massiveClient({
    getQuoteSnapshots: async (symbols: string[]) =>
      symbols.map((symbol) => ({
        symbol,
        price: symbol === "JUNK" ? 1 : 25,
        bid: 24.99,
        ask: 25.01,
        bidSize: 1,
        askSize: 1,
        change: 0,
        changePercent: 0,
        open: 24,
        high: symbol === "VOL" ? 32 : symbol === "HIGH" ? 25.5 : 26,
        low: symbol === "VOL" ? 18 : symbol === "HIGH" ? 24.5 : 23,
        prevClose: 24,
        volume: symbol === "JUNK" ? 1_000 : symbol === "VOL" ? 8_000_000 : 600_000,
        updatedAt: new Date("2026-06-04T15:00:00.000Z"),
      })),
  });

  const preview = await getHighBetaUniversePreview({
    limit: 2,
    candidateLimit: 10,
    minPrice: 5,
    minVolume: 500_000,
    minDollarVolume: 10_000_000,
    fmpClient,
    massiveClient: client,
    refresh: true,
  });

  assert.deepEqual(
    preview.accepted.map((row) => row.symbol),
    ["VOL", "HIGH"],
  );
  assert.equal(preview.accepted[0]?.rank, 1);
  assert.equal(preview.accepted[0]?.score.source, "blended_options_opportunity_v1");
  assert.equal(preview.accepted[0]?.score.weights.beta, 0.45);
  assert.ok(
    (preview.accepted[0]?.opportunityScore ?? 0) >
      (preview.accepted[1]?.opportunityScore ?? 0),
  );
  assert.equal(preview.sourceStatus, "fresh");
  assert.equal(preview.importedCount, 4);
  assert.equal(preview.acceptedCount, 2);
  assert.equal(preview.rejectedCount, 1);
  assert.equal(preview.rejectedByReason.low_liquidity, 1);
  assert.equal(preview.source.provider, "fmp");
  assert.equal(preview.validation.provider, "massive");
});

test("high-beta universe availability is non-throwing and explains missing FMP config", async () => {
  await withIsolatedHighBetaCache(async () => {
    const status = await getHighBetaUniverseAvailabilityStatus({ limit: 500 });

    assert.equal(status.configured, false);
    assert.equal(status.provider, null);
    assert.equal(status.validatorProvider, "massive");
    assert.equal(status.available, false);
    assert.equal(status.cacheStatus, "unavailable");
    assert.equal(status.unavailableCode, "research_not_configured");
    assert.match(
      status.unavailableDetail ?? "",
      /FMP_API_KEY|FINANCIAL_MODELING_PREP_API_KEY/,
    );
  });
});

test("high-beta universe falls back to the last durable successful preview when FMP is unavailable", async () => {
  await withIsolatedHighBetaCache(async () => {
    process.env["FMP_API_KEY"] = "fmp-test-key";
    const fmpClient = {
      getHighBetaScreenerCandidates: async () => [
        candidate("HIGH", 4.2),
        candidate("VOL", 3.6),
      ],
    };

    const fresh = await getHighBetaUniversePreview({
      limit: 2,
      candidateLimit: 10,
      fmpClient,
      massiveClient: massiveClient(),
      refresh: true,
    });
    assert.equal(fresh.sourceStatus, "fresh");
    assert.equal(fresh.acceptedCount, 2);

    __resetHighBetaUniverseCacheForTests({ keepDurableCache: true });
    delete process.env["FMP_API_KEY"];

    const stale = await getHighBetaUniversePreview({ limit: 2 });
    assert.equal(stale.sourceStatus, "stale_cache");
    assert.deepEqual(
      stale.accepted.map((row) => row.symbol),
      fresh.accepted.map((row) => row.symbol),
    );

    const status = await getHighBetaUniverseAvailabilityStatus({ limit: 2 });
    assert.equal(status.available, true);
    assert.equal(status.cacheStatus, "stale_cache");
    assert.equal(status.lastAcceptedCount, 2);
  });
});
