import assert from "node:assert/strict";
import test from "node:test";

import { __accountOrderInternalsForTests } from "./account";

const { accountTradeMatchesClosedTradeFilters } = __accountOrderInternalsForTests;

const trade = (positionType: "stock" | "etf" | "option") => ({
  id: `${positionType}:1`,
  source: "FLEX",
  accountId: "U123",
  symbol: positionType === "option" ? "AAPL" : positionType === "etf" ? "VOO" : "AAPL",
  side: "sell",
  assetClass:
    positionType === "option" ? "Options" : positionType === "etf" ? "ETF" : "Stocks",
  positionType,
  quantity: 1,
  openDate: null,
  closeDate: new Date("2026-06-08T14:30:00.000Z"),
  avgOpen: null,
  avgClose: 100,
  realizedPnl: 10,
  realizedPnlPercent: null,
  holdDurationMinutes: null,
  commissions: null,
  currency: "USD",
});

test("closed-trade account position filters use canonical position type", () => {
  assert.equal(
    accountTradeMatchesClosedTradeFilters(trade("stock") as never, {
      assetClass: "stock",
    }),
    true,
  );
  assert.equal(
    accountTradeMatchesClosedTradeFilters(trade("etf") as never, {
      assetClass: "stock",
    }),
    false,
  );
  assert.equal(
    accountTradeMatchesClosedTradeFilters(trade("etf") as never, {
      assetClass: "etf",
    }),
    true,
  );
  assert.equal(
    accountTradeMatchesClosedTradeFilters(trade("stock") as never, {
      assetClass: "equity",
    }),
    true,
  );
  assert.equal(
    accountTradeMatchesClosedTradeFilters(trade("etf") as never, {
      assetClass: "equity",
    }),
    true,
  );
  assert.equal(
    accountTradeMatchesClosedTradeFilters(trade("option") as never, {
      assetClass: "equity",
    }),
    false,
  );
});

