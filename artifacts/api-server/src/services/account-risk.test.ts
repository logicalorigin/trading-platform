import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

process.env["DATABASE_URL"] ??= "postgres://test:test@127.0.0.1:5432/test";
process.env["DIAGNOSTICS_SUPPRESS_DB_WARNINGS"] = "1";

test("account risk internals summarize static risk metadata and nullable totals", async () => {
  const { __accountRiskInternalsForTests } = await import("./account");

  assert.equal(__accountRiskInternalsForTests.normalizeAccountRiskDetail(undefined), "fast");
  assert.equal(__accountRiskInternalsForTests.normalizeAccountRiskDetail("fast"), "fast");
  assert.equal(__accountRiskInternalsForTests.normalizeAccountRiskDetail("full"), "full");
  assert.equal(__accountRiskInternalsForTests.sectorForSymbol("AAPL"), "Technology");
  assert.equal(__accountRiskInternalsForTests.sectorForSymbol("UNKNOWN"), "Unknown");
  assert.equal(__accountRiskInternalsForTests.betaForSymbol("TSLA"), 2.1);
  assert.equal(__accountRiskInternalsForTests.betaForSymbol("UNKNOWN"), 1);
  assert.equal(__accountRiskInternalsForTests.weightPercent(25, 100), 25);
  assert.equal(__accountRiskInternalsForTests.weightPercent(25, 0), null);
  assert.equal(
    __accountRiskInternalsForTests.sumNullableValues([1, null, 2, Number.NaN]),
    3,
  );
  assert.equal(__accountRiskInternalsForTests.sumNullableValues([null]), null);
  assert.equal(__accountRiskInternalsForTests.upsertNullableTotal(null, 3), 3);
  assert.equal(__accountRiskInternalsForTests.upsertNullableTotal(2, null), 2);
});

test("account risk full detail is nonblocking and uses a pending cold response", async () => {
  const { __accountRiskInternalsForTests } = await import("./account");
  const pending = __accountRiskInternalsForTests.buildPendingAccountGreekScenarios();

  assert.equal(pending.enabled, true);
  assert.equal(pending.status, "pending");
  assert.equal(pending.pythonJob.jobType, "greek_scenario_matrix");
  assert.match(pending.warning ?? "", /refreshing asynchronously/);

  const source = readFileSync(new URL("./account.ts", import.meta.url), "utf8");
  const getRiskBody = source.match(
    /export async function getAccountRisk\([\s\S]*?\nasync function getAccountRiskUncached/,
  )?.[0];
  const uncachedBody = source.match(
    /async function getAccountRiskUncached\([\s\S]*?\nfunction accountFullRiskCacheKey/,
  )?.[0];
  const fullBody = source.match(
    /async function getAccountRiskWithNonBlockingFullDetail\([\s\S]*?\nfunction buildDeferredAccountGreekScenarios/,
  )?.[0];

  assert.ok(getRiskBody);
  assert.match(getRiskBody, /const detail = normalizeAccountRiskDetail\(input\.detail\);/);
  assert.match(getRiskBody, /if \(detail === "full"\) \{/);
  assert.match(getRiskBody, /getAccountRiskWithNonBlockingFullDetail\(\{ \.\.\.input, mode \}\)/);
  assert.match(getRiskBody, /getAccountRiskUncached\(\{ \.\.\.input, mode, detail \}\)/);

  assert.ok(uncachedBody);
  assert.match(uncachedBody, /const detail = normalizeAccountRiskDetail\(input\.detail\);/);
  assert.match(uncachedBody, /const deferGreekRefresh = detail === "fast";/);
  assert.match(uncachedBody, /const notional = deferGreekRefresh/);
  assert.match(uncachedBody, /buildNotionalExposure\(positions,/);
  assert.match(uncachedBody, /const greekScenarios = deferGreekRefresh/);
  assert.match(uncachedBody, /buildDeferredAccountGreekScenarios\(\)/);

  assert.ok(fullBody);
  assert.match(fullBody, /const cached = accountFullRiskCache\.get\(cacheKey\);/);
  assert.match(fullBody, /scheduleAccountFullRiskRefresh\(\{ \.\.\.input, mode \}\);/);
  assert.match(fullBody, /return markAccountRiskFullRefreshPending\(fastRisk\);/);
  assert.doesNotMatch(fullBody, /await refreshAccountFullRiskCache/);
});

test("account risk internals match and merge option-chain contracts", async () => {
  const { __accountRiskInternalsForTests } = await import("./account");
  const tupleContract = {
    contract: {
      underlying: "AAPL",
      expirationDate: new Date("2026-06-19T00:00:00.000Z"),
      strike: 200,
      right: "CALL",
      providerContractId: null,
    },
    delta: 0.5,
    gamma: null,
    theta: null,
    vega: null,
  };
  const directContract = {
    contract: {
      underlying: "MSFT",
      expirationDate: new Date("2026-07-17T00:00:00.000Z"),
      strike: 420,
      right: "PUT",
      providerContractId: "123",
    },
    delta: -0.4,
    gamma: null,
    theta: null,
    vega: null,
  };

  assert.equal(
    __accountRiskInternalsForTests.matchOptionChainContract(
      [tupleContract, directContract] as any,
      {
        underlying: "MSFT",
        expirationDate: new Date("2026-07-17T00:00:00.000Z"),
        strike: 420,
        right: "PUT",
        providerContractId: "123",
      } as any,
    ),
    directContract,
  );
  assert.equal(
    __accountRiskInternalsForTests.matchOptionChainContract(
      [tupleContract] as any,
      {
        underlying: "AAPL",
        expirationDate: new Date("2026-06-19T00:00:00.000Z"),
        strike: 200,
        right: "CALL",
        providerContractId: null,
      } as any,
    ),
    tupleContract,
  );
  assert.equal(
    __accountRiskInternalsForTests.mergeOptionChainContracts([
      [tupleContract],
      [{ ...tupleContract, delta: 0.6 }],
      [directContract],
    ] as any).length,
    2,
  );
});

test("account risk internals bucket option expiry notional", async () => {
  const { __accountRiskInternalsForTests } = await import("./account");
  const now = new Date("2026-05-01T00:00:00.000Z").getTime();
  const buckets = __accountRiskInternalsForTests.buildExpiryConcentration(
    [
      {
        marketValue: 100,
        optionContract: {
          expirationDate: new Date("2026-05-05T00:00:00.000Z"),
        },
      },
      {
        marketValue: -200,
        optionContract: {
          expirationDate: new Date("2026-05-20T00:00:00.000Z"),
        },
      },
      {
        marketValue: 300,
        optionContract: {
          expirationDate: new Date("2026-07-15T00:00:00.000Z"),
        },
      },
    ] as any,
    now,
  );

  assert.deepEqual(buckets, {
    thisWeek: 100,
    thisMonth: 300,
    next90Days: 600,
  });
});

test("account risk internals treat equity notional as market value exposure", async () => {
  const { __accountRiskInternalsForTests } = await import("./account");
  const summary = __accountRiskInternalsForTests.buildNotionalExposure(
    [
      {
        id: "U1:AAPL",
        accountId: "U1",
        symbol: "AAPL",
        assetClass: "equity",
        quantity: 10,
        averagePrice: 180,
        marketPrice: 200,
        marketValue: 2_000,
        unrealizedPnl: 200,
        unrealizedPnlPercent: 11.11,
        optionContract: null,
      },
    ] as any,
    { nav: 10_000 },
  );

  assert.equal(summary.grossUnderlyingNotional, 2_000);
  assert.equal(summary.netDirectionalNotional, 2_000);
  assert.equal(summary.deltaAdjustedNotional, 2_000);
  assert.equal(summary.notionalToNavPercent, 20);
  assert.deepEqual(summary.coverage, {
    totalPositions: 1,
    pricedPositions: 1,
    deltaAdjustedPositions: 1,
  });
});

test("account risk internals calculate option gross, directional, and delta-adjusted notional", async () => {
  const { __accountRiskInternalsForTests } = await import("./account");
  const expirationDate = new Date("2026-06-19T00:00:00.000Z");
  const positions = [
    {
      id: "U1:AAPL-C",
      accountId: "U1",
      symbol: "AAPL 200C",
      assetClass: "option",
      quantity: 2,
      averagePrice: 5,
      marketPrice: 6,
      marketValue: 1_200,
      unrealizedPnl: 200,
      unrealizedPnlPercent: 20,
      optionContract: {
        ticker: "AAPL 200C",
        underlying: "AAPL",
        expirationDate,
        strike: 200,
        right: "call",
        multiplier: 100,
        sharesPerContract: 100,
        providerContractId: "1",
      },
    },
    {
      id: "U1:MSFT-P",
      accountId: "U1",
      symbol: "MSFT 300P",
      assetClass: "option",
      quantity: 1,
      averagePrice: 4,
      marketPrice: 5,
      marketValue: 500,
      unrealizedPnl: 100,
      unrealizedPnlPercent: 25,
      optionContract: {
        ticker: "MSFT 300P",
        underlying: "MSFT",
        expirationDate,
        strike: 300,
        right: "put",
        multiplier: 100,
        sharesPerContract: 100,
        providerContractId: "2",
      },
    },
    {
      id: "U1:TSLA-C",
      accountId: "U1",
      symbol: "TSLA 250C",
      assetClass: "option",
      quantity: -1,
      averagePrice: 8,
      marketPrice: 7,
      marketValue: -700,
      unrealizedPnl: 100,
      unrealizedPnlPercent: 12.5,
      optionContract: {
        ticker: "TSLA 250C",
        underlying: "TSLA",
        expirationDate,
        strike: 250,
        right: "call",
        multiplier: 100,
        sharesPerContract: 100,
        providerContractId: "3",
      },
    },
  ];
  const summary = __accountRiskInternalsForTests.buildNotionalExposure(
    positions as any,
    {
      nav: 50_000,
      underlyingPrices: new Map([
        ["AAPL", 200],
        ["MSFT", 300],
        ["TSLA", 250],
      ]),
      greekByPositionId: new Map([
        ["U1:AAPL-C", { delta: 120 }],
        ["U1:MSFT-P", { delta: -40 }],
        ["U1:TSLA-C", { delta: -55 }],
      ] as any),
    },
  );

  assert.equal(summary.grossUnderlyingNotional, 95_000);
  assert.equal(summary.netDirectionalNotional, -15_000);
  assert.equal(summary.deltaAdjustedNotional, -1_750);
  assert.equal(summary.notionalToNavPercent, 190);
  assert.deepEqual(summary.coverage, {
    totalPositions: 3,
    pricedPositions: 3,
    deltaAdjustedPositions: 3,
  });
});

test("account risk internals report partial notional coverage for missing option quote or greek", async () => {
  const { __accountRiskInternalsForTests } = await import("./account");
  const expirationDate = new Date("2026-06-19T00:00:00.000Z");
  const summary = __accountRiskInternalsForTests.buildNotionalExposure(
    [
      {
        id: "U1:AAPL-C",
        accountId: "U1",
        symbol: "AAPL 200C",
        assetClass: "option",
        quantity: 1,
        averagePrice: 5,
        marketPrice: 6,
        marketValue: 600,
        unrealizedPnl: 100,
        unrealizedPnlPercent: 20,
        optionContract: {
          ticker: "AAPL 200C",
          underlying: "AAPL",
          expirationDate,
          strike: 200,
          right: "call",
          multiplier: 100,
          sharesPerContract: 100,
          providerContractId: "1",
        },
      },
      {
        id: "U1:MSFT-P",
        accountId: "U1",
        symbol: "MSFT 300P",
        assetClass: "option",
        quantity: 1,
        averagePrice: 4,
        marketPrice: 5,
        marketValue: 500,
        unrealizedPnl: 100,
        unrealizedPnlPercent: 25,
        optionContract: {
          ticker: "MSFT 300P",
          underlying: "MSFT",
          expirationDate,
          strike: 300,
          right: "put",
          multiplier: 100,
          sharesPerContract: 100,
          providerContractId: "2",
        },
      },
    ] as any,
    {
      nav: 50_000,
      underlyingPrices: new Map([["AAPL", 200]]),
      greekByPositionId: new Map([["U1:AAPL-C", { delta: null }]] as any),
    },
  );

  assert.equal(summary.grossUnderlyingNotional, 20_000);
  assert.equal(summary.netDirectionalNotional, 20_000);
  assert.equal(summary.deltaAdjustedNotional, null);
  assert.deepEqual(summary.coverage, {
    totalPositions: 2,
    pricedPositions: 1,
    deltaAdjustedPositions: 0,
  });
});
