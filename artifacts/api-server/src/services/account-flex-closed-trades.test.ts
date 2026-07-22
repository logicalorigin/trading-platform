import assert from "node:assert/strict";
import test from "node:test";

import { __accountTradeAnnotationInternalsForTests as internals } from "./account";

function trade(input: {
  id: string;
  side: string;
  currency: string;
  commission: string | null;
  date: string;
  price?: string;
  quantity?: string;
  assetClass?: string;
  symbol?: string;
  description?: string | null;
  raw?: Record<string, unknown>;
}) {
  return {
    tradeId: input.id,
    providerAccountId: "DU-FLEX",
    symbol: input.symbol ?? "AAPL",
    description: input.description ?? null,
    assetClass: input.assetClass ?? "stock",
    positionType: input.assetClass === "option" ? "option" : "stock",
    side: input.side,
    quantity: input.quantity ?? "1",
    price: input.price ?? (input.side === "buy" ? "100" : "110"),
    tradeDate: new Date(input.date),
    realizedPnl: null,
    commission: input.commission,
    currency: input.currency,
    openClose: null,
    raw: input.raw ?? {},
  } as never;
}

test("inferred FLEX lots preserve unknown commission coverage", () => {
  const [result] = internals.buildInferredFlexClosedTrades([
    trade({
      id: "open",
      side: "buy",
      currency: "USD",
      commission: null,
      date: "2026-07-01T14:00:00.000Z",
    }),
    trade({
      id: "close",
      side: "sell",
      currency: "USD",
      commission: "1",
      date: "2026-07-02T14:00:00.000Z",
    }),
  ]);

  assert.equal(result?.realizedPnl, null);
  assert.equal(result?.realizedPnlPercent, null);
  assert.equal(result?.side, "buy");
  assert.equal(result?.commissions, null);
});

test("inferred FLEX lots normalize provider-signed commissions as costs", () => {
  const [result] = internals.buildInferredFlexClosedTrades([
    trade({
      id: "open",
      side: "buy",
      currency: "USD",
      commission: "-1.25",
      date: "2026-07-01T14:00:00.000Z",
    }),
    trade({
      id: "close",
      side: "sell",
      currency: "USD",
      commission: "-0.75",
      date: "2026-07-02T14:00:00.000Z",
    }),
  ]);

  assert.equal(result?.commissions, 2);
  assert.equal(result?.realizedPnl, 8);
  assert.ok(
    Math.abs((result?.realizedPnlPercent ?? 0) - (8 / 101.25) * 100) < 1e-9,
  );
});

test("inferred FLEX short lots preserve opening direction and return sign", () => {
  const [result] = internals.buildInferredFlexClosedTrades([
    trade({
      id: "short-open",
      side: "sell",
      currency: "USD",
      commission: "1",
      date: "2026-07-01T14:00:00.000Z",
    }),
    trade({
      id: "short-close",
      side: "buy",
      currency: "USD",
      commission: "1",
      date: "2026-07-02T14:00:00.000Z",
    }),
  ]);

  assert.equal(result?.side, "sell");
  assert.equal(result?.realizedPnl, 8);
  assert.ok(Math.abs((result?.realizedPnlPercent ?? 0) - (8 / 109) * 100) < 1e-9);
});

test("inferred FLEX reversals allocate closing commissions once", () => {
  const results = internals.buildInferredFlexClosedTrades([
    trade({
      id: "long-open",
      side: "buy",
      currency: "USD",
      commission: "1",
      price: "100",
      date: "2026-07-01T14:00:00.000Z",
    }),
    trade({
      id: "reverse",
      side: "sell",
      currency: "USD",
      commission: "2",
      quantity: "2",
      price: "110",
      date: "2026-07-02T14:00:00.000Z",
    }),
    trade({
      id: "short-close",
      side: "buy",
      currency: "USD",
      commission: "1",
      price: "105",
      date: "2026-07-03T14:00:00.000Z",
    }),
  ]);

  const longClose = results.find((result) => result.id === "inferred:reverse");
  const shortClose = results.find(
    (result) => result.id === "inferred:short-close",
  );
  assert.equal(longClose?.quantity, 1);
  assert.equal(longClose?.commissions, 2);
  assert.equal(longClose?.realizedPnl, 8);
  assert.equal(shortClose?.quantity, 1);
  assert.equal(shortClose?.commissions, 2);
  assert.equal(shortClose?.realizedPnl, 3);
});

test("inferred FLEX lots reject commission currency mismatches", () => {
  const [result] = internals.buildInferredFlexClosedTrades([
    trade({
      id: "open",
      side: "buy",
      currency: "USD",
      commission: "1",
      date: "2026-07-01T14:00:00.000Z",
      raw: { ibCommissionCurrency: "EUR" },
    }),
    trade({
      id: "close",
      side: "sell",
      currency: "USD",
      commission: "1",
      date: "2026-07-02T14:00:00.000Z",
      raw: { ibCommissionCurrency: "EUR" },
    }),
  ]);

  assert.equal(result?.commissions, null);
  assert.equal(result?.realizedPnl, null);
  assert.equal(result?.realizedPnlPercent, null);
});

test("FLEX direction normalization never fabricates a buy", () => {
  assert.equal(internals.normalizeFlexTradeSide("BUY", -1), "buy");
  assert.equal(internals.normalizeFlexTradeSide("SELL SHORT", 1), "sell");
  assert.equal(internals.normalizeFlexTradeSide("sideways", -2), "sell");
  assert.equal(internals.normalizeFlexTradeSide("sideways", 0), null);
});

test("inferred FLEX option P&L requires verified contract economics", () => {
  const unknownEconomics = internals.buildInferredFlexClosedTrades([
    trade({
      id: "option-open",
      side: "buy",
      currency: "USD",
      commission: "1",
      date: "2026-07-01T14:00:00.000Z",
      assetClass: "option",
      symbol: "AAPL",
    }),
    trade({
      id: "option-close",
      side: "sell",
      currency: "USD",
      commission: "1",
      date: "2026-07-02T14:00:00.000Z",
      assetClass: "option",
      symbol: "AAPL",
    }),
  ]);
  assert.equal(unknownEconomics[0]?.realizedPnl, null);

  const standardContract = internals.buildInferredFlexClosedTrades([
    trade({
      id: "occ-open",
      side: "buy",
      currency: "USD",
      commission: "1",
      date: "2026-07-01T14:00:00.000Z",
      assetClass: "option",
      symbol: "AAPL  260821C00200000",
    }),
    trade({
      id: "occ-close",
      side: "sell",
      currency: "USD",
      commission: "1",
      date: "2026-07-02T14:00:00.000Z",
      assetClass: "option",
      symbol: "AAPL  260821C00200000",
    }),
  ]);
  assert.equal(standardContract[0]?.realizedPnl, null);

  const verifiedStandardContract = internals.buildInferredFlexClosedTrades([
    trade({
      id: "verified-open",
      side: "buy",
      currency: "USD",
      commission: "1",
      date: "2026-07-01T14:00:00.000Z",
      assetClass: "option",
      symbol: "AAPL  260821C00200000",
      raw: { standardDeliverableVerified: true },
    }),
    trade({
      id: "verified-close",
      side: "sell",
      currency: "USD",
      commission: "1",
      date: "2026-07-02T14:00:00.000Z",
      assetClass: "option",
      symbol: "AAPL  260821C00200000",
      raw: { standardDeliverableVerified: true },
    }),
  ]);
  assert.equal(verifiedStandardContract[0]?.realizedPnl, 998);

  const adjustedContract = internals.buildInferredFlexClosedTrades([
    trade({
      id: "adjusted-open",
      side: "buy",
      currency: "USD",
      commission: "1",
      date: "2026-07-01T14:00:00.000Z",
      assetClass: "option",
      symbol: "AAPL1 260821C00200000",
    }),
    trade({
      id: "adjusted-close",
      side: "sell",
      currency: "USD",
      commission: "1",
      date: "2026-07-02T14:00:00.000Z",
      assetClass: "option",
      symbol: "AAPL1 260821C00200000",
    }),
  ]);
  assert.equal(adjustedContract[0]?.realizedPnl, null);
});

test("inferred FLEX lots never match across currencies", () => {
  const result = internals.buildInferredFlexClosedTrades([
    trade({
      id: "open",
      side: "buy",
      currency: "EUR",
      commission: "1",
      date: "2026-07-01T14:00:00.000Z",
    }),
    trade({
      id: "close",
      side: "sell",
      currency: "USD",
      commission: "1",
      date: "2026-07-02T14:00:00.000Z",
    }),
  ]);

  assert.deepEqual(result, []);
});
