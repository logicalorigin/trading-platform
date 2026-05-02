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
