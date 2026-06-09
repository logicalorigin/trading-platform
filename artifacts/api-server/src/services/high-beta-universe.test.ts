import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import { getHighBetaUniversePreview } from "./high-beta-universe";
import type { FmpHighBetaScreenerCandidate } from "../providers/fmp/client";
import type {
  HighBetaUniverseMassiveClient,
} from "./high-beta-universe";
import type {
  QuoteSnapshot,
  UniverseTicker,
} from "../providers/massive/market-data";

const candidate = (
  symbol: string,
  beta: number,
  overrides: Partial<FmpHighBetaScreenerCandidate> = {},
): FmpHighBetaScreenerCandidate => ({
  symbol,
  name: symbol,
  beta,
  price: 100,
  volume: 1_000_000,
  marketCap: 1_000_000_000,
  exchange: "NASDAQ",
  exchangeShortName: "NASDAQ",
  country: "US",
  isEtf: false,
  isActivelyTrading: true,
  source: "fmp-company-screener",
  ...overrides,
});

const quote = (
  symbol: string,
  overrides: Partial<QuoteSnapshot> = {},
): QuoteSnapshot => ({
  symbol,
  price: 100,
  bid: 99.5,
  ask: 100.5,
  bidSize: 100,
  askSize: 100,
  change: 0,
  changePercent: 0,
  open: 100,
  high: 101,
  low: 99,
  prevClose: 100,
  volume: 1_000_000,
  updatedAt: new Date("2026-06-01T14:30:00.000Z"),
  ...overrides,
});

const ticker = (symbol: string): UniverseTicker => ({
  ticker: symbol,
  name: symbol,
  market: "stocks",
  rootSymbol: symbol,
  normalizedExchangeMic: "XNAS",
  exchangeDisplay: "NASDAQ",
  logoUrl: null,
  countryCode: "US",
  exchangeCountryCode: "US",
  sector: null,
  industry: null,
  contractDescription: null,
  contractMeta: null,
  locale: "us",
  type: "CS",
  active: true,
  primaryExchange: "NASDAQ",
  currencyName: "usd",
  cik: null,
  compositeFigi: null,
  shareClassFigi: null,
  lastUpdatedAt: null,
  provider: "massive",
  providers: ["massive"],
  tradeProvider: "massive",
  dataProviderPreference: "massive",
});

test("high-beta universe ranks accepted symbols by beta before opportunity score", async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "pyrus-high-beta-test-"));
  process.env["PYRUS_HIGH_BETA_UNIVERSE_CACHE_FILE"] = join(
    cacheDir,
    "high-beta-cache.json",
  );
  try {
    const fmpClient = {
      async getHighBetaScreenerCandidates() {
        return [
          candidate("LOWBETA", 1.4),
          candidate("HIGHBETA", 2.4),
          candidate("MIDBETA", 1.9),
        ];
      },
    };
    const quotes = new Map([
      [
        "LOWBETA",
        quote("LOWBETA", {
          high: 135,
          low: 65,
          volume: 5_000_000,
        }),
      ],
      [
        "HIGHBETA",
        quote("HIGHBETA", {
          high: 101,
          low: 99,
          volume: 1_000_000,
        }),
      ],
      [
        "MIDBETA",
        quote("MIDBETA", {
          high: 104,
          low: 96,
          volume: 1_500_000,
        }),
      ],
    ]);
    const massiveClient: HighBetaUniverseMassiveClient = {
      async getUniverseTickerByTicker(symbol) {
        return ticker(symbol);
      },
      async getQuoteSnapshots(symbols) {
        return symbols.map((symbol) => quotes.get(symbol) ?? quote(symbol));
      },
      async getHistoricalOptionContracts(input) {
        const count = input.underlying === "LOWBETA" ? 10 : 1;
        return Array.from({ length: count }, (_, index) => ({ ticker: `OPT${index}` }));
      },
    };

    const preview = await getHighBetaUniversePreview({
      limit: 3,
      candidateLimit: 3,
      minBeta: 1,
      fmpClient,
      massiveClient,
      refresh: true,
    });

    assert.deepEqual(
      preview.accepted.map((row) => [row.symbol, row.beta, row.rank]),
      [
        ["HIGHBETA", 2.4, 1],
        ["MIDBETA", 1.9, 2],
        ["LOWBETA", 1.4, 3],
      ],
    );
    assert(
      preview.accepted[2]!.opportunityScore > preview.accepted[0]!.opportunityScore,
      "fixture should prove opportunity score would not produce beta order",
    );
  } finally {
    delete process.env["PYRUS_HIGH_BETA_UNIVERSE_CACHE_FILE"];
    rmSync(cacheDir, { recursive: true, force: true });
  }
});
