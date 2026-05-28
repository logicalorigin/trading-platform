import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

process.env["DATABASE_URL"] ??= "postgres://test:test@127.0.0.1:5432/test";
process.env["DIAGNOSTICS_SUPPRESS_DB_WARNINGS"] = "1";

test("account position quote hydration opts out of Polygon fallback", () => {
  const source = readFileSync(new URL("./account.ts", import.meta.url), "utf8");
  const equityBody = source.match(
    /async function fetchEquityQuoteSnapshotsForPositions\([\s\S]*?\nasync function fetchOptionQuoteSnapshotsForPositions/,
  )?.[0];
  const optionBody = source.match(
    /async function fetchOptionQuoteSnapshotsForPositions\([\s\S]*?\nasync function hydratePositionMarkets/,
  )?.[0];
  const underlyingBody = source.match(
    /async function hydrateOptionUnderlyingPrices\([\s\S]*?\nasync function getCachedOptionChainContracts/,
  )?.[0];

  assert.ok(equityBody);
  assert.ok(optionBody);
  assert.ok(underlyingBody);
  assert.match(equityBody, /allowPolygonFallback: false/);
  assert.match(optionBody, /intent: "visible-live"/);
  assert.match(underlyingBody, /allowPolygonFallback: false/);
});

test("live quote and flow defaults require explicit Polygon opt-in", () => {
  const source = readFileSync(new URL("./platform.ts", import.meta.url), "utf8");
  const quoteSnapshotsBody = source.match(
    /export async function getQuoteSnapshots\([\s\S]*?\nexport async function getNews/,
  )?.[0];
  const prewarmBody = source.match(
    /function scheduleIbkrWatchlistPrewarm\([\s\S]*?\nfunction scheduleIbkrWatchlistPrewarmFromDb/,
  )?.[0];
  const flowUniverseBody = source.match(
    /const flowUniverseManager = createFlowUniverseManager\([\s\S]*?\nconst optionsFlowRadarObservationCache/,
  )?.[0];
  const liveFlowBody = source.match(
    /async function listFlowEventsUncached\([\s\S]*?\ntype FlowScannerBenchmarkLineUsage/,
  )?.[0];

  assert.ok(quoteSnapshotsBody);
  assert.match(quoteSnapshotsBody, /input\.allowPolygonFallback === true/);
  assert.ok(prewarmBody);
  assert.doesNotMatch(prewarmBody, /fallbackProvider: "polygon"/);
  assert.match(prewarmBody, /fallbackProvider: "cache"/);
  assert.ok(flowUniverseBody);
  assert.match(flowUniverseBody, /fetchBridgeQuoteSnapshots/);
  assert.doesNotMatch(flowUniverseBody, /getPolygonClient\(\)\.getQuoteSnapshots/);
  assert.ok(liveFlowBody);
  assert.match(liveFlowBody, /input\.allowPolygonFallback === true/);
});

test("account position internals remove closed broker rows", async () => {
  const { __accountPositionInternalsForTests } = await import("./account");
  const rows = __accountPositionInternalsForTests.filterOpenBrokerPositions([
    { symbol: "AAL", quantity: 0 },
    { symbol: "FCEL", quantity: 30 },
    { symbol: "SHORT", quantity: -5 },
    { symbol: "TINY", quantity: 1e-12 },
  ]);

  assert.deepEqual(
    rows.map((row) => row.symbol),
    ["FCEL", "SHORT"],
  );
  assert.equal(
    __accountPositionInternalsForTests.isOpenBrokerPosition({ quantity: 0 }),
    false,
  );
});

test("account position totals include cash balances for the footer", async () => {
  const { __accountPositionInternalsForTests } = await import("./account");
  const totals = __accountPositionInternalsForTests.buildAccountPositionTotals({
    accounts: [
      {
        cash: 1_200,
        totalCashValue: null,
        buyingPower: 3_500,
        netLiquidation: 10_000,
      },
      {
        cash: 250,
        totalCashValue: 300,
        buyingPower: 900,
        netLiquidation: 2_500,
      },
    ],
    rows: [
      { weightPercent: 20, unrealizedPnl: 125 },
      { weightPercent: 10, unrealizedPnl: -25 },
    ],
    grossLong: 4_000,
    grossShort: -500,
    netExposure: 3_500,
  } as any);

  assert.equal(totals.cash, 1_450);
  assert.equal(totals.totalCash, 1_450);
  assert.equal(totals.buyingPower, 4_400);
  assert.equal(totals.netLiquidation, 12_500);
  assert.equal(totals.unrealizedPnl, 100);
  assert.equal(totals.weightPercent, 30);
});

test("account position hydration derives mark, day P&L, and unrealized P&L from quotes", async () => {
  const { __accountPositionInternalsForTests } = await import("./account");
  const hydrated =
    __accountPositionInternalsForTests.buildPositionMarketHydration(
      {
        id: "U1:INDI",
        accountId: "U1",
        symbol: "INDI",
        assetClass: "equity",
        quantity: 200,
        averagePrice: 4.42275,
        marketPrice: 4.42275,
        marketValue: 884.55,
        unrealizedPnl: 0,
        unrealizedPnlPercent: 0,
        optionContract: null,
      },
      {
        symbol: "INDI",
        price: 4.64,
        bid: 4.48,
        ask: 4.75,
        bidSize: 0,
        askSize: 300,
        change: 0.13,
        changePercent: 2.882483370288246,
        open: 4.09,
        high: 4.62,
        low: 4.04,
        prevClose: 4.51,
        volume: 2,
        openInterest: null,
        impliedVolatility: null,
        delta: null,
        gamma: null,
        theta: null,
        vega: null,
        providerContractId: "496414757",
        delayed: false,
        freshness: "live",
        marketDataMode: "live",
        dataUpdatedAt: new Date("2026-05-01T00:08:40.151Z"),
        ageMs: null,
        cacheAgeMs: 0,
        latency: null,
        transport: "tws",
        updatedAt: new Date("2026-05-01T00:08:40.151Z"),
      },
    );

  assert.equal(hydrated.mark, 4.64);
  assert.equal(Number(hydrated.marketValue.toFixed(2)), 928);
  assert.equal(Number(hydrated.dayChange?.toFixed(2)), 26);
  assert.equal(Number(hydrated.dayChangePercent?.toFixed(6)), 2.882483);
  assert.equal(Number(hydrated.unrealizedPnl.toFixed(2)), 43.45);
  assert.equal(hydrated.source, "QUOTE_SNAPSHOT");
});

test("same-day account position hydration uses entry cost basis for day P&L", async () => {
  const { __accountPositionInternalsForTests } = await import("./account");
  const hydrated =
    __accountPositionInternalsForTests.buildPositionMarketHydration(
      {
        id: "U1:XYZ",
        accountId: "U1",
        symbol: "XYZ",
        assetClass: "equity",
        quantity: 5,
        averagePrice: 10,
        marketPrice: 10,
        marketValue: 50,
        unrealizedPnl: 0,
        unrealizedPnlPercent: 0,
        optionContract: null,
        openedAt: new Date("2026-05-27T14:30:00.000Z"),
      },
      {
        symbol: "XYZ",
        price: 11,
        bid: 10.95,
        ask: 11.05,
        bidSize: 100,
        askSize: 100,
        change: 0.25,
        changePercent: 2.3255813953488373,
        open: 10.7,
        high: 11.1,
        low: 10.65,
        prevClose: 10.75,
        volume: 1_000,
        openInterest: null,
        impliedVolatility: null,
        delta: null,
        gamma: null,
        theta: null,
        vega: null,
        providerContractId: "123",
        delayed: false,
        freshness: "live",
        marketDataMode: "live",
        dataUpdatedAt: new Date("2026-05-27T19:00:00.000Z"),
        ageMs: null,
        cacheAgeMs: 0,
        latency: null,
        transport: "tws",
        updatedAt: new Date("2026-05-27T19:00:00.000Z"),
      },
      { now: new Date("2026-05-27T19:01:00.000Z") },
    );

  assert.equal(hydrated.mark, 11);
  assert.equal(Number(hydrated.unrealizedPnl.toFixed(2)), 5);
  assert.equal(Number(hydrated.dayChange?.toFixed(2)), 5);
  assert.equal(Number(hydrated.dayChangePercent?.toFixed(6)), 10);
  assert.equal(Number(hydrated.unrealizedPnlPercent.toFixed(6)), 10);
});

test("same-day account position hydration treats date-only open dates as market dates", async () => {
  const { __accountPositionInternalsForTests } = await import("./account");
  const basePosition = {
    id: "U1:DATEONLY",
    accountId: "U1",
    symbol: "DATEONLY",
    assetClass: "equity",
    quantity: 10,
    averagePrice: 20,
    marketPrice: 20,
    marketValue: 200,
    unrealizedPnl: 0,
    unrealizedPnlPercent: 0,
    optionContract: null,
  } as any;
  const quote = {
    symbol: "DATEONLY",
    price: 21,
    bid: 20.95,
    ask: 21.05,
    bidSize: 100,
    askSize: 100,
    change: 0.1,
    changePercent: 0.4784688995215311,
    open: 20.9,
    high: 21.1,
    low: 20.8,
    prevClose: 20.9,
    volume: 1_000,
    openInterest: null,
    impliedVolatility: null,
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
    providerContractId: "date-only",
    delayed: false,
    freshness: "live",
    marketDataMode: "live",
    dataUpdatedAt: new Date("2026-05-27T19:00:00.000Z"),
    ageMs: null,
    cacheAgeMs: 0,
    latency: null,
    transport: "tws",
    updatedAt: new Date("2026-05-27T19:00:00.000Z"),
  } as any;

  for (const openedAt of [
    "2026-05-27",
    "20260527",
    new Date("2026-05-27T00:00:00.000Z"),
  ]) {
    const hydrated =
      __accountPositionInternalsForTests.buildPositionMarketHydration(
        { ...basePosition, openedAt },
        quote,
        { now: new Date("2026-05-27T19:01:00.000Z") },
      );
    assert.equal(Number(hydrated.dayChange?.toFixed(2)), 10);
    assert.equal(Number(hydrated.unrealizedPnl.toFixed(2)), 10);
  }
});

test("same-day option position hydration uses option quote mark and entry basis", async () => {
  const { __accountPositionInternalsForTests } = await import("./account");
  const hydrated =
    __accountPositionInternalsForTests.buildPositionMarketHydration(
      {
        id: "U1:SPY:CALL",
        accountId: "U1",
        symbol: "SPY 260522C00500000",
        assetClass: "option",
        quantity: 1,
        averagePrice: 1.2,
        marketPrice: 1.2,
        marketValue: 120,
        unrealizedPnl: 0,
        unrealizedPnlPercent: 0,
        openedAt: new Date("2026-05-27T14:31:00.000Z"),
        optionContract: {
          underlying: "SPY",
          expirationDate: "2026-05-22",
          strike: 500,
          right: "call",
          multiplier: 100,
          providerContractId: "12345",
        },
      } as any,
      {
        symbol: "SPY 260522C00500000",
        price: 1.48,
        mark: 1.5,
        last: 1.46,
        bid: 1.4,
        ask: 1.6,
        bidSize: 20,
        askSize: 15,
        change: 0.05,
        changePercent: 3.4482758620689653,
        open: null,
        high: null,
        low: null,
        prevClose: 1.45,
        volume: 80,
        openInterest: 500,
        impliedVolatility: 0.2,
        delta: 0.5,
        gamma: 0.01,
        theta: -0.02,
        vega: 0.08,
        providerContractId: "12345",
        delayed: false,
        freshness: "live",
        marketDataMode: "live",
        dataUpdatedAt: new Date("2026-05-27T19:00:00.000Z"),
        ageMs: null,
        cacheAgeMs: 0,
        latency: null,
        transport: "tws",
        updatedAt: new Date("2026-05-27T19:00:00.000Z"),
      },
      { now: new Date("2026-05-27T19:01:00.000Z") },
    );

  assert.equal(hydrated.mark, 1.5);
  assert.equal(Number(hydrated.marketValue.toFixed(2)), 150);
  assert.equal(Number(hydrated.unrealizedPnl.toFixed(2)), 30);
  assert.equal(Number(hydrated.dayChange?.toFixed(2)), 30);
  assert.equal(Number(hydrated.dayChangePercent?.toFixed(6)), 25);
  assert.equal(hydrated.source, "QUOTE_SNAPSHOT");
});

test("account position quote display model derives bid ask spread from snapshots", async () => {
  const { __accountPositionInternalsForTests } = await import("./account");
  const quote = __accountPositionInternalsForTests.buildPositionQuoteFromSnapshot(
    {
      symbol: "SPY",
      price: 501,
      bid: 500.9,
      ask: 501.1,
      bidSize: 10,
      askSize: 12,
      change: 0,
      changePercent: 0,
      open: null,
      high: null,
      low: null,
      prevClose: null,
      volume: null,
      openInterest: null,
      impliedVolatility: null,
      delta: null,
      gamma: null,
      theta: null,
      vega: null,
      providerContractId: null,
      delayed: false,
      freshness: "live",
      marketDataMode: "live",
      dataUpdatedAt: new Date("2026-05-21T14:00:00.000Z"),
      ageMs: null,
      cacheAgeMs: 0,
      latency: null,
      transport: "tws",
      updatedAt: new Date("2026-05-21T14:00:00.000Z"),
    },
    501,
  );

  assert.equal(quote?.bid, 500.9);
  assert.equal(quote?.ask, 501.1);
  assert.equal(Number(quote?.spread?.toFixed(2)), 0.2);
  assert.equal(quote?.source, "bridge_quote");
});

test("account position quote display model preserves option last and mark fields", async () => {
  const { __accountPositionInternalsForTests } = await import("./account");
  const quote = __accountPositionInternalsForTests.buildPositionQuoteFromSnapshot(
    {
      symbol: "O:SPY260522C00500000",
      price: 1.11,
      last: 1.09,
      mark: 1.14,
      bid: null,
      ask: null,
      dataUpdatedAt: new Date("2026-05-22T14:00:00.000Z"),
      updatedAt: new Date("2026-05-22T14:00:01.000Z"),
    } as any,
    1,
    "option_quote",
  );

  assert.equal(quote?.last, 1.09);
  assert.equal(quote?.mark, 1.14);
  assert.equal(quote?.source, "option_quote");
});

test("account position quote display model preserves zero bid ask from IBKR options", async () => {
  const { __accountPositionInternalsForTests } = await import("./account");
  const quote = __accountPositionInternalsForTests.buildPositionQuoteFromSnapshot(
    {
      symbol: "O:SPY260522C00500000",
      price: 2.45,
      last: null,
      mark: 2.45,
      bid: 0,
      ask: 2.5,
      bidSize: 0,
      askSize: 20,
      change: 0.15,
      changePercent: 6.52,
      open: null,
      high: null,
      low: null,
      prevClose: 2.3,
      volume: null,
      openInterest: null,
      impliedVolatility: null,
      delta: null,
      gamma: null,
      theta: null,
      vega: null,
      providerContractId: "12345",
      delayed: false,
      freshness: "live",
      marketDataMode: "live",
      dataUpdatedAt: new Date("2026-05-22T14:00:00.000Z"),
      ageMs: null,
      cacheAgeMs: 0,
      latency: null,
      transport: "tws",
      updatedAt: new Date("2026-05-22T14:00:01.000Z"),
    } as any,
    2.4,
    "option_quote",
  );

  assert.equal(quote?.bid, 0);
  assert.equal(quote?.ask, 2.5);
  assert.equal(quote?.mark, 2.45);
  assert.equal(quote?.spread, 2.5);
});

test("account position internals derive opened date from Flex open-position raw fields", async () => {
  const { __accountPositionInternalsForTests } = await import("./account");
  const opened =
    __accountPositionInternalsForTests.flexOpenPositionOpenedAt({
      asOf: new Date("2026-05-21T21:00:00.000Z"),
      raw: {
        symbol: "SPY",
        openDateTime: "20260520;14:31:05",
      },
    });

  assert.equal(opened.openedAt?.toISOString(), "2026-05-20T14:31:05.000Z");
  assert.equal(opened.openedAtSource, "flex_open_position");
});

test("account position internals fall back to Flex snapshot date when raw open date is absent", async () => {
  const { __accountPositionInternalsForTests } = await import("./account");
  const opened =
    __accountPositionInternalsForTests.flexOpenPositionOpenedAt({
      asOf: new Date("2026-05-21T21:00:00.000Z"),
      raw: {
        symbol: "SPY",
      },
    });

  assert.equal(opened.openedAt?.toISOString(), "2026-05-21T21:00:00.000Z");
  assert.equal(opened.openedAtSource, "flex_snapshot");
});

test("account position internals ignore old Flex open-position streaks", async () => {
  const { __accountPositionInternalsForTests } = await import("./account");
  const opened =
    __accountPositionInternalsForTests.selectFlexOpenPositionCandidate([
      {
        accountId: "U1",
        symbol: "SPY",
        description: "",
        contractId: null,
        asOf: new Date("2026-04-01T21:00:00.000Z"),
        openedAt: new Date("2026-04-01T21:00:00.000Z"),
        openedAtSource: "flex_snapshot",
        raw: null,
      },
      {
        accountId: "U1",
        symbol: "SPY",
        description: "",
        contractId: null,
        asOf: new Date("2026-05-20T21:00:00.000Z"),
        openedAt: new Date("2026-05-20T21:00:00.000Z"),
        openedAtSource: "flex_snapshot",
        raw: null,
      },
      {
        accountId: "U1",
        symbol: "SPY",
        description: "",
        contractId: null,
        asOf: new Date("2026-05-21T21:00:00.000Z"),
        openedAt: new Date("2026-05-21T21:00:00.000Z"),
        openedAtSource: "flex_snapshot",
        raw: null,
      },
    ]);

  assert.equal(opened?.openedAt?.toISOString(), "2026-05-20T21:00:00.000Z");
  assert.equal(opened?.openedAtSource, "flex_snapshot");
});

test("account position rows expose a canonical market-data symbol", async () => {
  const { __accountPositionInternalsForTests } = await import("./account");

  assert.equal(
    __accountPositionInternalsForTests.accountPositionMarketDataSymbol({
      symbol: "twsopt:123456",
      optionContract: { underlying: "aapl" },
    }),
    "AAPL",
  );
  assert.equal(
    __accountPositionInternalsForTests.accountPositionMarketDataSymbol({
      symbol: "ibm  260116C00180000",
      raw: { underlyingSymbol: "IBM" },
    }),
    "IBM",
  );
  assert.equal(
    __accountPositionInternalsForTests.accountPositionMarketDataSymbol({
      symbol: "SPY",
      optionContract: null,
    }),
    "SPY",
  );
  assert.equal(
    __accountPositionInternalsForTests.normalizeMarketDataSymbol("twsopt:123456"),
    "",
  );
});

test("account margin usage is sourced from IBKR initial margin", async () => {
  const { __accountMarginInternalsForTests } = await import("./account");
  const margin =
    __accountMarginInternalsForTests.buildAccountMarginSnapshot([
      {
        initialMargin: 12_500,
        maintenanceMargin: 9_400,
        excessLiquidity: 80_000,
        cushion: 0.82,
        netLiquidation: 100_000,
        dayTradingBuyingPower: 260_000,
        sma: 50_000,
        regTInitialMargin: 11_250,
      },
    ] as any);

  assert.equal(margin.marginUsed, 12_500);
  assert.equal(margin.maintenanceMargin, 9_400);
  assert.equal(margin.providerFields.marginUsed, "InitMarginReq");
  assert.equal(margin.marginUsedUsesMaintenanceFallback, false);
});

test("account margin usage labels maintenance fallback when initial margin is missing", async () => {
  const { __accountMarginInternalsForTests } = await import("./account");
  const margin =
    __accountMarginInternalsForTests.buildAccountMarginSnapshot([
      {
        initialMargin: null,
        maintenanceMargin: 7_300,
        excessLiquidity: 45_000,
        cushion: 0.74,
        netLiquidation: 70_000,
      },
    ] as any);

  assert.equal(margin.marginUsed, 7_300);
  assert.equal(
    margin.providerFields.marginUsed,
    "MaintMarginReq (fallback; InitMarginReq missing)",
  );
  assert.equal(margin.providerFields.marginUsedAuthoritative, "InitMarginReq");
  assert.equal(margin.providerFields.marginUsedFallback, "MaintMarginReq");
  assert.equal(margin.marginUsedUsesMaintenanceFallback, true);
});

test("account position date balance internals aggregate per-account boundary snapshots", async () => {
  const { __accountPositionInternalsForTests } = await import("./account");
  const rows = [
    {
      providerAccountId: "U1",
      asOf: new Date("2026-05-08T14:00:00.000Z"),
      currency: "USD",
      cash: "100",
      buyingPower: "400",
      netLiquidation: "1000",
      maintenanceMargin: "25",
    },
    {
      providerAccountId: "U1",
      asOf: new Date("2026-05-08T20:00:00.000Z"),
      currency: "USD",
      cash: "150",
      buyingPower: "450",
      netLiquidation: "1100",
      maintenanceMargin: "30",
    },
    {
      providerAccountId: "U2",
      asOf: new Date("2026-05-08T19:00:00.000Z"),
      currency: "USD",
      cash: "25",
      buyingPower: "75",
      netLiquidation: "200",
      maintenanceMargin: null,
    },
  ];

  const latest =
    __accountPositionInternalsForTests.selectBalanceBoundaryRows(rows, "latest");
  const aggregate =
    __accountPositionInternalsForTests.aggregateBalanceRows(latest, "USD");

  assert.deepEqual(
    latest.map((row) => `${row.providerAccountId}:${row.netLiquidation}`).sort(),
    ["U1:1100", "U2:200"],
  );
  assert.equal(aggregate?.netLiquidation, 1300);
  assert.equal(aggregate?.cash, 175);
  assert.equal(aggregate?.buyingPower, 525);
  assert.equal(aggregate?.maintenanceMargin, 30);
});
