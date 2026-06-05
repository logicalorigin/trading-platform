import assert from "node:assert/strict";
import test from "node:test";
import type { HighBetaUniversePreview } from "./high-beta-universe";
import type { EnqueueMarketDataJobInput } from "./market-data-ingest";
import {
  __gexUniverseRefreshInternalsForTests,
  buildGexUniverseRefreshPlan,
  refreshGexUniverseSnapshots,
  resolveGexUniverseSymbols,
  type GexUniverseRefreshInventory,
} from "./gex-universe-refresh";

function highBetaPreview(symbols: string[]): HighBetaUniversePreview {
  return {
    generatedAt: new Date("2026-06-04T12:00:00.000Z"),
    dryRun: true,
    sourceStatus: "fresh",
    limit: symbols.length,
    importedCount: symbols.length,
    acceptedCount: symbols.length,
    rejectedCount: 0,
    rejectedByReason: {},
    accepted: symbols.map((symbol, index) => ({
      rank: index + 1,
      symbol,
      name: symbol,
      beta: 2,
      intradayVolatility: 0.05,
      optionContractCount: 100,
      opportunityScore: 1,
      score: {
        source: "blended_options_opportunity_v1",
        betaScore: 1,
        intradayVolatilityScore: 1,
        liquidityScore: 1,
        optionsTradabilityScore: 1,
        weights: {
          beta: 0.45,
          intradayVolatility: 0.25,
          liquidity: 0.15,
          optionsTradability: 0.15,
        },
      },
      price: 100,
      volume: 1_000_000,
      dollarVolume: 100_000_000,
      marketCap: 10_000_000_000,
      exchange: "NASDAQ",
      massiveMarket: "stocks",
      massiveType: "CS",
      optionable: true,
      quoteUpdatedAt: new Date("2026-06-04T11:59:00.000Z"),
    })),
    rejectedSample: [],
    source: {
      provider: "fmp",
      endpoint: "company-screener",
      betaField: "beta",
      candidateLimit: symbols.length,
      exchanges: ["NASDAQ"],
    },
    validation: {
      provider: "massive",
      minPrice: 5,
      minVolume: 500_000,
      minDollarVolume: 10_000_000,
      minMarketCap: 250_000_000,
      requireOptionable: true,
    },
  };
}

function gexOption(input: {
  strike: number;
  cp: "C" | "P";
  expirationDate?: string;
  gamma?: number;
  openInterest?: number;
  impliedVol?: number;
}) {
  return {
    strike: input.strike,
    cp: input.cp,
    expirationDate: input.expirationDate ?? "2026-06-19",
    gamma: input.gamma ?? 0.01,
    delta: input.cp === "C" ? 0.5 : -0.5,
    openInterest: input.openInterest ?? 10,
    impliedVol: input.impliedVol ?? 0.3,
    bid: 1,
    ask: 1.1,
    multiplier: 100,
    volume: 1,
  };
}

function generatedSymbols(count: number, prefix = "T"): string[] {
  return Array.from(
    { length: count },
    (_, index) => `${prefix}${String(index + 1).padStart(3, "0")}`,
  );
}

test("GEX universe refresh normalizes explicit symbols and caps the universe", async () => {
  const resolved = await resolveGexUniverseSymbols({
    symbols: [" spy ", "AAPL", "spy", "  ", "tsla"],
    limit: 2,
  });

  assert.deepEqual(resolved, {
    scope: "symbols",
    limit: 2,
    symbols: ["SPY", "AAPL"],
    sourceUniverse: null,
  });
  assert.deepEqual(
    __gexUniverseRefreshInternalsForTests.normalizeGexUniverseSymbols(
      ["msft", "MSFT", "nvda"],
      5,
    ),
    ["MSFT", "NVDA"],
  );
});

test("GEX universe refresh resolves the High Beta 500 universe", async () => {
  const resolved = await resolveGexUniverseSymbols(
    { limit: 500 },
    {
      getHighBetaUniversePreview: async (input) => {
        const params = input ?? {};
        assert.equal(params.limit, 500);
        assert.equal(params.dryRun, true);
        return highBetaPreview(["AAOI", "CRDO", "NVDA"]);
      },
      readFallbackUniverseSymbols: async () => null,
    },
  );

  assert.equal(resolved.scope, "high_beta_500");
  assert.equal(resolved.limit, 500);
  assert.deepEqual(resolved.symbols, ["AAOI", "CRDO", "NVDA"]);
  assert.deepEqual(resolved.sourceUniverse, {
    acceptedCount: 3,
    importedCount: 3,
    sourceStatus: "fresh",
    generatedAt: "2026-06-04T12:00:00.000Z",
  });
});

test("GEX universe refresh falls back to live catalog inventory when high-beta is unavailable", async () => {
  const fallbackSymbols = generatedSymbols(500);
  const resolved = await resolveGexUniverseSymbols(
    { limit: 500 },
    {
      getHighBetaUniversePreview: async () => {
        throw new Error("research_not_configured");
      },
      readFallbackUniverseSymbols: async (limit) => ({
        symbols: fallbackSymbols.slice(0, limit),
        acceptedCount: limit,
        importedCount: limit,
        sourceStatus: "signal_monitor_catalog_fallback",
        generatedAt: "2026-06-04T12:00:00.000Z",
      }),
    },
  );

  assert.equal(resolved.scope, "high_beta_500");
  assert.equal(resolved.limit, 500);
  assert.equal(resolved.symbols.length, 500);
  assert.deepEqual(resolved.symbols.slice(0, 3), ["T001", "T002", "T003"]);
  assert.deepEqual(resolved.sourceUniverse, {
    acceptedCount: 500,
    importedCount: 500,
    sourceStatus: "signal_monitor_catalog_fallback",
    generatedAt: "2026-06-04T12:00:00.000Z",
  });
});

test("GEX universe refresh fills a short high-beta universe from live catalog inventory", async () => {
  const fallbackSymbols = generatedSymbols(500);
  const resolved = await resolveGexUniverseSymbols(
    { limit: 500 },
    {
      getHighBetaUniversePreview: async () =>
        highBetaPreview(["AAOI", "CRDO", "NVDA"]),
      readFallbackUniverseSymbols: async (limit) => ({
        symbols: fallbackSymbols.slice(0, limit),
        acceptedCount: limit,
        importedCount: limit,
        sourceStatus: "catalog_flow_fallback",
        generatedAt: "2026-06-04T12:00:00.000Z",
      }),
    },
  );

  assert.equal(resolved.symbols.length, 500);
  assert.deepEqual(resolved.symbols.slice(0, 5), [
    "AAOI",
    "CRDO",
    "NVDA",
    "T001",
    "T002",
  ]);
  assert.equal(resolved.sourceUniverse?.acceptedCount, 500);
  assert.equal(resolved.sourceUniverse?.sourceStatus, "high_beta_catalog_fallback");
});

test("GEX universe refresh plans only missing, stale, and failed symbols", () => {
  const now = new Date("2026-06-04T12:00:00.000Z");
  const plan = buildGexUniverseRefreshPlan({
    scope: "high_beta_500",
    symbols: ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"],
    snapshots: [
      {
        symbol: "AAA",
        computedAt: new Date("2026-06-04T11:59:30.000Z"),
        sourceStatus: "ok",
        optionCount: 120,
        usableOptionCount: 118,
      },
      {
        symbol: "BBB",
        computedAt: new Date("2026-06-04T11:55:00.000Z"),
        sourceStatus: "ok",
        optionCount: "90",
        usableOptionCount: "88",
      },
      {
        symbol: "EEE",
        computedAt: new Date("2026-06-04T11:40:00.000Z"),
        sourceStatus: "partial",
        optionCount: 10,
        usableOptionCount: 8,
      },
    ],
    jobs: [
      {
        symbol: "DDD",
        kind: "option_chain_snapshot",
        status: "queued",
        updatedAt: new Date("2026-06-04T11:59:50.000Z"),
      },
      {
        symbol: "EEE",
        kind: "option_chain_snapshot",
        status: "failed",
        updatedAt: new Date("2026-06-04T11:58:00.000Z"),
        lastError: "option-chain snapshot failed",
      },
      {
        symbol: "FFF",
        kind: "stock_snapshot",
        status: "running",
        updatedAt: new Date("2026-06-04T11:59:55.000Z"),
      },
    ],
    staleAfterMs: 60_000,
    batchSize: 2,
    now,
  });

  assert.equal(plan.targetSymbolCount, 6);
  assert.equal(plan.eligibleSymbolCount, 3);
  assert.equal(plan.selectedSymbolCount, 2);
  assert.equal(plan.remainingEligibleSymbolCount, 1);
  assert.deepEqual(plan.statusCounts, {
    fresh: 1,
    stale: 1,
    missing: 1,
    queued: 1,
    running: 1,
    failed: 1,
  });
  assert.deepEqual(plan.plannedSymbols, ["BBB", "CCC", "EEE"]);
  assert.deepEqual(plan.selectedSymbols, ["BBB", "CCC"]);
  assert.equal(plan.symbols.find((row) => row.symbol === "AAA")?.status, "fresh");
  assert.equal(plan.symbols.find((row) => row.symbol === "BBB")?.ageMs, 300_000);
  assert.deepEqual(
    plan.symbols.find((row) => row.symbol === "DDD")?.activeJobKinds,
    ["option_chain_snapshot"],
  );
  assert.equal(
    plan.symbols.find((row) => row.symbol === "EEE")?.lastError,
    "option-chain snapshot failed",
  );
});

test("GEX universe refresh reports page and chart-overlay hydration coverage", () => {
  const plan = buildGexUniverseRefreshPlan({
    scope: "high_beta_500",
    symbols: ["AAA", "BBB", "CCC"],
    now: new Date("2026-06-04T12:00:00.000Z"),
    snapshots: [
      {
        symbol: "AAA",
        computedAt: new Date("2026-06-04T11:59:30.000Z"),
        sourceStatus: "ok",
        optionCount: 6,
        usableOptionCount: 6,
        payload: {
          ticker: "AAA",
          spot: 100,
          timestamp: "2026-06-04T11:59:30.000Z",
          options: [
            gexOption({ strike: 80, cp: "P", openInterest: 50 }),
            gexOption({ strike: 90, cp: "P", openInterest: 50 }),
            gexOption({ strike: 100, cp: "C", openInterest: 80 }),
            gexOption({ strike: 110, cp: "C", openInterest: 80 }),
            gexOption({ strike: 120, cp: "C", openInterest: 80 }),
            gexOption({ strike: 130, cp: "C", openInterest: 80 }),
          ],
          source: {
            status: "ok",
            optionCount: 6,
            usableOptionCount: 6,
            expirationCoverage: {
              requestedCount: 1,
              returnedCount: 1,
              loadedCount: 1,
              failedCount: 0,
              complete: true,
              capped: false,
            },
          },
        },
      },
      {
        symbol: "BBB",
        computedAt: new Date("2026-06-04T11:59:30.000Z"),
        sourceStatus: "partial",
        optionCount: 1,
        usableOptionCount: 1,
        payload: {
          ticker: "BBB",
          spot: 50,
          timestamp: "2026-06-04T11:59:30.000Z",
          options: [gexOption({ strike: 50, cp: "C" })],
          source: {
            status: "partial",
            optionCount: 1,
            usableOptionCount: 1,
            expirationCoverage: {
              requestedCount: 2,
              returnedCount: 1,
              loadedCount: 1,
              failedCount: 1,
              complete: false,
              capped: true,
            },
          },
        },
      },
    ],
  });

  assert.deepEqual(plan.hydration, {
    pagePopulatedCount: 2,
    pageCompleteCount: 1,
    zeroGammaPayloadReadyCount: 2,
    zeroGammaLineReadyCount: 1,
    zeroGammaLineRenderableCount: 1,
    projectionOverlayReadyCount: 1,
  });
  const aaa = plan.symbols.find((row) => row.symbol === "AAA");
  assert.equal(aaa?.hydration.pagePopulated, true);
  assert.equal(aaa?.hydration.pageComplete, true);
  assert.equal(aaa?.hydration.zeroGammaLineReady, true);
  assert.equal(aaa?.hydration.zeroGammaLineRenderable, true);
  assert.equal(aaa?.hydration.projectionOverlayReady, true);
  assert.equal(aaa?.hydration.projectionExpirationCount, 1);
  const bbb = plan.symbols.find((row) => row.symbol === "BBB");
  assert.equal(bbb?.hydration.pagePopulated, true);
  assert.equal(bbb?.hydration.pageComplete, false);
  assert.equal(bbb?.hydration.projectionOverlayReady, false);
  assert.equal(bbb?.hydration.reason, "gex_snapshot_incomplete");
  const ccc = plan.symbols.find((row) => row.symbol === "CCC");
  assert.equal(ccc?.hydration.pagePopulated, false);
  assert.equal(ccc?.hydration.reason, "gex_snapshot_missing");
});

test("GEX universe refresh dry-run does not enqueue jobs", async () => {
  let enqueueCalls = 0;
  const result = await refreshGexUniverseSnapshots(
    {
      symbols: ["SPY", "QQQ"],
      dryRun: true,
      now: new Date("2026-06-04T12:00:00.000Z"),
    },
    {
      readInventory: async (): Promise<GexUniverseRefreshInventory> => ({
        available: true,
        unavailableReason: null,
        snapshots: [],
        jobs: [],
      }),
      enqueueMarketDataJob: async () => {
        enqueueCalls += 1;
        return { queued: true, dedupeKey: "unused" };
      },
    },
  );

  assert.equal(result.dryRun, true);
  assert.equal(result.eligibleSymbolCount, 2);
  assert.deepEqual(result.selectedSymbols, ["SPY", "QQQ"]);
  assert.equal(result.enqueuedJobCount, 0);
  assert.equal(enqueueCalls, 0);
});

test("GEX universe refresh enqueues capped job triplets for selected symbols", async () => {
  const calls: EnqueueMarketDataJobInput[] = [];
  const result = await refreshGexUniverseSnapshots(
    {
      limit: 500,
      batchSize: 2,
      dryRun: false,
      now: new Date("2026-06-04T12:34:56.000Z"),
      reason: "manual_gex_500_backfill",
    },
    {
      getHighBetaUniversePreview: async () =>
        highBetaPreview(["SPY", "TSLA", "AAPL", "NVDA"]),
      readFallbackUniverseSymbols: async () => null,
      readInventory: async (): Promise<GexUniverseRefreshInventory> => ({
        available: true,
        unavailableReason: null,
        snapshots: [
          {
            symbol: "SPY",
            computedAt: new Date("2026-06-04T12:34:40.000Z"),
            sourceStatus: "ok",
            optionCount: 500,
            usableOptionCount: 500,
          },
          {
            symbol: "NVDA",
            computedAt: new Date("2026-06-04T12:20:00.000Z"),
            sourceStatus: "ok",
            optionCount: 400,
            usableOptionCount: 395,
          },
        ],
        jobs: [
          {
            symbol: "AAPL",
            kind: "gex_snapshot",
            status: "queued",
            updatedAt: new Date("2026-06-04T12:34:00.000Z"),
          },
        ],
      }),
      enqueueMarketDataJob: async (input) => {
        calls.push(input);
        return { queued: true, dedupeKey: `${input.kind}:${input.symbol}` };
      },
    },
  );

  assert.equal(result.dryRun, false);
  assert.deepEqual(result.plannedSymbols, ["TSLA", "NVDA"]);
  assert.deepEqual(result.selectedSymbols, ["TSLA", "NVDA"]);
  assert.equal(result.enqueuedJobCount, 6);
  assert.equal(result.enqueueFailures.length, 0);
  assert.deepEqual(
    calls.map((call) => [call.symbol, call.kind, call.priority]),
    [
      ["TSLA", "stock_snapshot", 1],
      ["TSLA", "option_chain_snapshot", 2],
      ["TSLA", "gex_snapshot", 3],
      ["NVDA", "stock_snapshot", 1],
      ["NVDA", "option_chain_snapshot", 2],
      ["NVDA", "gex_snapshot", 3],
    ],
  );
  assert.deepEqual(calls[0]?.payload, {
    reason: "manual_gex_500_backfill",
    dedupeBucket: Math.floor(
      new Date("2026-06-04T12:34:56.000Z").getTime() / 60_000,
    ),
    scope: "high_beta_500",
    refreshPlan: "gex_universe_refresh",
  });
});
