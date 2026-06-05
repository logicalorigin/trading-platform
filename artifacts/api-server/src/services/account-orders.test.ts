import assert from "node:assert/strict";
import test from "node:test";

process.env["DATABASE_URL"] ??= "postgres://test:test@127.0.0.1:5432/test";
process.env["DIAGNOSTICS_SUPPRESS_DB_WARNINGS"] = "1";

test("account order internals classify order tabs and terminal statuses", async () => {
  const { __accountOrderInternalsForTests } = await import("./account");

  assert.equal(__accountOrderInternalsForTests.normalizeOrderTab("history"), "history");
  assert.equal(__accountOrderInternalsForTests.normalizeOrderTab("open"), "working");
  assert.equal(__accountOrderInternalsForTests.terminalOrderStatus("filled"), true);
  assert.equal(__accountOrderInternalsForTests.terminalOrderStatus("canceled"), true);
  assert.equal(__accountOrderInternalsForTests.workingOrderStatus("submitted"), true);
  assert.equal(__accountOrderInternalsForTests.workingOrderStatus("rejected"), false);
});

test("account order internals normalize trade asset classes", async () => {
  const { __accountOrderInternalsForTests } = await import("./account");

  assert.equal(
    __accountOrderInternalsForTests.normalizeTradeAssetClassLabel({
      assetClass: "Option",
      symbol: "AAPL",
    }),
    "Options",
  );
  assert.equal(
    __accountOrderInternalsForTests.normalizeTradeAssetClassLabel({
      assetClass: "stock",
      symbol: "SPY",
    }),
    "ETF",
  );
  assert.equal(
    __accountOrderInternalsForTests.normalizeTradeAssetClassLabel({
      assetClass: "stock",
      symbol: "AAPL",
    }),
    "Stocks",
  );
});

test("account order internals group equity and option positions with orders", async () => {
  const { __accountOrderInternalsForTests } = await import("./account");
  const optionContract = {
    underlying: "AAPL",
    expirationDate: new Date("2026-06-19T00:00:00.000Z"),
    strike: 200,
    right: "CALL",
  };

  assert.equal(
    __accountOrderInternalsForTests.positionGroupKey({
      symbol: "spy",
      optionContract: null,
    } as any),
    "equity:SPY",
  );
  assert.equal(
    __accountOrderInternalsForTests.orderGroupKey({
      symbol: "SPY",
      optionContract: null,
    } as any),
    "equity:SPY",
  );
  assert.equal(
    __accountOrderInternalsForTests.positionGroupKey({
      symbol: "AAPL  260619C00200000",
      optionContract,
    } as any),
    __accountOrderInternalsForTests.orderGroupKey({
      symbol: "AAPL  260619C00200000",
      optionContract,
    } as any),
  );
});

test("account order internals convert filled live orders into account activity rows", async () => {
  const { __accountOrderInternalsForTests } = await import("./account");
  const order = {
    id: "manual-f-call",
    accountId: "U24762790",
    mode: "live",
    symbol: "F",
    assetClass: "option",
    side: "buy",
    type: "LMT",
    timeInForce: "day",
    status: "filled",
    quantity: 5,
    filledQuantity: 5,
    limitPrice: 0.86,
    stopPrice: null,
    placedAt: new Date("2026-06-05T15:24:00.000Z"),
    updatedAt: new Date("2026-06-05T15:45:00.000Z"),
    optionContract: {
      underlying: "F",
      expirationDate: new Date("2026-06-26T00:00:00.000Z"),
      strike: 15,
      right: "CALL",
      multiplier: 100,
      providerContractId: "123",
    },
  } as any;

  const rows = __accountOrderInternalsForTests.mergeLiveOrderActivityTrades(
    [],
    [order],
    {
      from: new Date("2026-06-05T00:00:00.000Z"),
      to: new Date("2026-06-05T23:59:59.999Z"),
    },
    "USD",
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, "LIVE_ORDER");
  assert.equal(rows[0].sourceType, "manual");
  assert.equal(rows[0].strategyLabel, "Manual");
  assert.equal(rows[0].symbol, "F");
  assert.equal(rows[0].assetClass, "Options");
  assert.equal(rows[0].quantity, 5);
  assert.equal(rows[0].avgClose, 0.86);
  assert.equal(rows[0].realizedPnl, null);
  assert.equal(rows[0].closeDate?.toISOString(), "2026-06-05T15:45:00.000Z");
});

test("account order internals avoid duplicating filled orders already represented by FLEX", async () => {
  const { __accountOrderInternalsForTests } = await import("./account");
  const flexTrade = {
    id: "flex-f-call",
    source: "FLEX",
    accountId: "U24762790",
    symbol: "F",
    side: "buy",
    assetClass: "Options",
    quantity: 5,
    closeDate: new Date("2026-06-05T15:45:00.000Z"),
    avgClose: 0.86,
    realizedPnl: -137,
  } as any;
  const order = {
    id: "manual-f-call",
    accountId: "U24762790",
    mode: "live",
    symbol: "F",
    assetClass: "option",
    side: "buy",
    type: "LMT",
    timeInForce: "day",
    status: "filled",
    quantity: 5,
    filledQuantity: 5,
    limitPrice: 0.86,
    stopPrice: null,
    placedAt: new Date("2026-06-05T15:24:00.000Z"),
    updatedAt: new Date("2026-06-05T15:45:00.000Z"),
    optionContract: null,
  } as any;

  const rows = __accountOrderInternalsForTests.mergeLiveOrderActivityTrades(
    [flexTrade],
    [order],
    {},
    "USD",
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, "FLEX");
});

test("account order internals reconstruct realized P&L from live option executions", async () => {
  const { __accountOrderInternalsForTests } = await import("./account");
  const optionContract = {
    ticker: "SPY20260608P758",
    underlying: "SPY",
    expirationDate: new Date("2026-06-08T00:00:00.000Z"),
    strike: 758,
    right: "put",
    multiplier: 100,
    sharesPerContract: 100,
    providerContractId: "spy-put",
  };
  const executions = [
    {
      id: "buy-spy-put",
      accountId: "U24762790",
      symbol: "SPY",
      assetClass: "option",
      side: "buy",
      quantity: 6,
      price: 3.08,
      netAmount: null,
      exchange: "SMART",
      executedAt: new Date("2026-06-04T17:36:31.463Z"),
      orderDescription: null,
      contractDescription: "SPY Jun08'26 758 PUT",
      providerContractId: "spy-put",
      optionContract,
      orderRef: null,
    },
    {
      id: "sell-spy-put",
      accountId: "U24762790",
      symbol: "SPY",
      assetClass: "option",
      side: "sell",
      quantity: 6,
      price: 3.58,
      netAmount: null,
      exchange: "SMART",
      executedAt: new Date("2026-06-04T18:36:31.463Z"),
      orderDescription: null,
      contractDescription: "SPY Jun08'26 758 PUT",
      providerContractId: "spy-put",
      optionContract,
      orderRef: null,
    },
  ] as any[];

  const rows =
    __accountOrderInternalsForTests.buildLiveExecutionActivityTrades(
      executions,
      "USD",
    );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, "LIVE_EXECUTION");
  assert.equal(rows[0].symbol, "SPY");
  assert.equal(rows[0].assetClass, "Options");
  assert.equal(rows[0].quantity, 6);
  assert.equal(Number(rows[0].realizedPnl?.toFixed(2)), 300);
  assert.equal(rows[0].optionRight, "put");
  assert.equal(typeof rows[0].dte, "number");
});

test("account order internals keep distinct same-price live execution fills", async () => {
  const { __accountOrderInternalsForTests } = await import("./account");
  const optionContract = {
    ticker: "SPY20260608P758",
    underlying: "SPY",
    expirationDate: new Date("2026-06-08T00:00:00.000Z"),
    strike: 758,
    right: "put",
    multiplier: 100,
    sharesPerContract: 100,
    providerContractId: "spy-put",
  };
  const executions = [
    {
      id: "buy-spy-put",
      accountId: "U24762790",
      symbol: "SPY",
      assetClass: "option",
      side: "buy",
      quantity: 2,
      price: 2.06,
      netAmount: null,
      exchange: "SMART",
      executedAt: new Date("2026-06-04T17:36:31.463Z"),
      orderDescription: null,
      contractDescription: "SPY Jun08'26 758 PUT",
      providerContractId: "spy-put",
      optionContract,
      orderRef: null,
    },
    {
      id: "sell-spy-put-a",
      accountId: "U24762790",
      symbol: "SPY",
      assetClass: "option",
      side: "sell",
      quantity: 1,
      price: 5.21,
      netAmount: null,
      exchange: "SMART",
      executedAt: new Date("2026-06-04T18:36:31.463Z"),
      orderDescription: null,
      contractDescription: "SPY Jun08'26 758 PUT",
      providerContractId: "spy-put",
      optionContract,
      orderRef: null,
    },
    {
      id: "sell-spy-put-b",
      accountId: "U24762790",
      symbol: "SPY",
      assetClass: "option",
      side: "sell",
      quantity: 1,
      price: 5.21,
      netAmount: null,
      exchange: "SMART",
      executedAt: new Date("2026-06-04T18:36:31.463Z"),
      orderDescription: null,
      contractDescription: "SPY Jun08'26 758 PUT",
      providerContractId: "spy-put",
      optionContract,
      orderRef: null,
    },
  ] as any[];

  const rows = __accountOrderInternalsForTests.mergeLiveExecutionActivityTrades(
    [],
    executions,
    {
      from: new Date("2026-06-04T00:00:00.000Z"),
      to: new Date("2026-06-04T23:59:59.999Z"),
    },
    "USD",
  );

  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => row.id).sort(),
    ["sell-spy-put-a", "sell-spy-put-b"],
  );
  assert.equal(
    Number(rows.reduce((sum, row) => sum + (row.realizedPnl ?? 0), 0).toFixed(2)),
    630,
  );
});

test("account order internals parse option details from live execution contract descriptions", async () => {
  const { __accountOrderInternalsForTests } = await import("./account");
  const executions = [
    {
      id: "buy-spy-call",
      accountId: "U24762790",
      symbol: "SPY",
      assetClass: "option",
      side: "buy",
      quantity: 1,
      price: 2.06,
      netAmount: null,
      exchange: "ISE",
      executedAt: new Date("2026-06-04T17:36:31.463Z"),
      orderDescription: null,
      contractDescription: "SPY   260604C00753000",
      providerContractId: "885885495",
      optionContract: null,
      orderRef: null,
    },
    {
      id: "sell-spy-call",
      accountId: "U24762790",
      symbol: "SPY",
      assetClass: "option",
      side: "sell",
      quantity: 1,
      price: 5.21,
      netAmount: null,
      exchange: "BOX",
      executedAt: new Date("2026-06-04T18:36:31.463Z"),
      orderDescription: null,
      contractDescription: "SPY   260604C00753000",
      providerContractId: "885885495",
      optionContract: null,
      orderRef: null,
    },
  ] as any[];

  const rows =
    __accountOrderInternalsForTests.buildLiveExecutionActivityTrades(
      executions,
      "USD",
    );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, "LIVE_EXECUTION");
  assert.equal(rows[0].realizedPnl, 315);
  assert.equal(rows[0].optionRight, "call");
  assert.equal(rows[0].dte, 0);
  assert.equal(rows[0].optionContract?.underlying, "SPY");
  assert.equal(rows[0].optionContract?.strike, 753);
  assert.equal(rows[0].optionContract?.right, "call");
  assert.equal(
    rows[0].optionContract?.expirationDate?.toISOString(),
    "2026-06-04T00:00:00.000Z",
  );
  assert.equal(rows[0].optionContract?.providerContractId, "885885495");
});

test("account order internals backfill history order rows from live executions", async () => {
  const { __accountOrderInternalsForTests } = await import("./account");
  const executions = [
    {
      id: "sell-spy-call-a",
      accountId: "U24762790",
      symbol: "SPY",
      assetClass: "option",
      side: "sell",
      quantity: 1,
      price: 5.21,
      netAmount: null,
      exchange: "BOX",
      executedAt: new Date("2026-06-04T18:36:31.463Z"),
      orderDescription: null,
      contractDescription: "SPY   260604C00753000",
      providerContractId: "885885495",
      optionContract: null,
      orderRef: null,
    },
    {
      id: "sell-spy-call-b",
      accountId: "U24762790",
      symbol: "SPY",
      assetClass: "option",
      side: "sell",
      quantity: 1,
      price: 5.21,
      netAmount: null,
      exchange: "BOX",
      executedAt: new Date("2026-06-04T18:36:31.463Z"),
      orderDescription: null,
      contractDescription: "SPY   260604C00753000",
      providerContractId: "885885495",
      optionContract: null,
      orderRef: null,
    },
  ] as any[];

  const rows = __accountOrderInternalsForTests.mergeExecutionHistoryOrderRows(
    [],
    executions,
  );

  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => row.id).sort(),
    ["execution:sell-spy-call-a", "execution:sell-spy-call-b"],
  );
  assert.equal(rows[0].status, "filled");
  assert.equal(rows[0].source, "LIVE_EXECUTION");
  assert.equal(rows[0].sourceType, "manual");
  assert.equal(rows[0].strategyLabel, "Manual");
  assert.equal(rows[0].assetClass, "Options");
  assert.equal(rows[0].averageFillPrice, 5.21);
  assert.equal(rows[0].optionContract?.strike, 753);
});

test("account order internals keep unmatched live executions as manual activity without flat P&L", async () => {
  const { __accountOrderInternalsForTests } = await import("./account");
  const executions = [
    {
      id: "open-spy-put",
      accountId: "U24762790",
      symbol: "SPY",
      assetClass: "option",
      side: "buy",
      quantity: 6,
      price: 3.08,
      netAmount: null,
      exchange: "SMART",
      executedAt: new Date("2026-06-04T17:36:31.463Z"),
      orderDescription: null,
      contractDescription: "SPY Jun08'26 758 PUT",
      providerContractId: "spy-put",
      optionContract: {
        ticker: "SPY20260608P758",
        underlying: "SPY",
        expirationDate: new Date("2026-06-08T00:00:00.000Z"),
        strike: 758,
        right: "put",
        multiplier: 100,
        sharesPerContract: 100,
        providerContractId: "spy-put",
      },
      orderRef: null,
    },
  ] as any[];

  const rows = __accountOrderInternalsForTests.mergeLiveExecutionActivityTrades(
    [],
    executions,
    {
      from: new Date("2026-06-04T00:00:00.000Z"),
      to: new Date("2026-06-04T23:59:59.999Z"),
    },
    "USD",
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, "LIVE_EXECUTION");
  assert.equal(rows[0].realizedPnl, null);
  assert.equal(rows[0].sourceType, "manual");
});
