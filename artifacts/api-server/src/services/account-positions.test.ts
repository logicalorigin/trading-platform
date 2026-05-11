import assert from "node:assert/strict";
import test from "node:test";

process.env["DATABASE_URL"] ??= "postgres://test:test@127.0.0.1:5432/test";
process.env["DIAGNOSTICS_SUPPRESS_DB_WARNINGS"] = "1";

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
