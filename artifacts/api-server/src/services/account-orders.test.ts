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
