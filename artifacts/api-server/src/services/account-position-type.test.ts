import assert from "node:assert/strict";
import test from "node:test";

import {
  accountPositionTypeDisplayLabel,
  accountPositionTypeMatchesFilter,
  classifyAccountPositionType,
  normalizeAccountPositionTypeFilter,
} from "./account-position-type";

test("normalizes account position type filters and legacy aliases", () => {
  assert.deepEqual(normalizeAccountPositionTypeFilter("all"), {
    kind: "all",
  });
  assert.deepEqual(normalizeAccountPositionTypeFilter("Stocks"), {
    kind: "single",
    value: "stock",
  });
  assert.deepEqual(normalizeAccountPositionTypeFilter("ETF"), {
    kind: "single",
    value: "etf",
  });
  assert.deepEqual(normalizeAccountPositionTypeFilter("Options"), {
    kind: "single",
    value: "option",
  });
  assert.deepEqual(normalizeAccountPositionTypeFilter("equity"), {
    kind: "equity",
  });
  assert.deepEqual(normalizeAccountPositionTypeFilter("nonsense"), {
    kind: "invalid",
    raw: "nonsense",
  });
});

test("classifies option, ETF, and stock account positions", () => {
  assert.equal(
    classifyAccountPositionType({
      symbol: "AAPL",
      assetClass: "option",
      optionContract: { underlying: "AAPL" },
    }),
    "option",
  );
  assert.equal(
    classifyAccountPositionType({
      symbol: "SPY",
      assetClass: "equity",
      providerSecurityType: "ETF",
    }),
    "etf",
  );
  assert.equal(
    classifyAccountPositionType({
      symbol: "QQQ",
      assetClass: "stock",
      raw: { assetCategory: "STK" },
    }),
    "etf",
  );
  assert.equal(
    classifyAccountPositionType({
      symbol: "VOO",
      assetClass: "equity",
      raw: { secType: "STK" },
    }),
    "etf",
  );
  assert.equal(
    classifyAccountPositionType({
      symbol: "AAPL",
      assetClass: "equity",
      raw: { secType: "STK" },
    }),
    "stock",
  );
});

test("matches canonical and equity filters against position types", () => {
  assert.equal(accountPositionTypeMatchesFilter("stock", { kind: "all" }), true);
  assert.equal(accountPositionTypeMatchesFilter("etf", { kind: "equity" }), true);
  assert.equal(accountPositionTypeMatchesFilter("option", { kind: "equity" }), false);
  assert.equal(
    accountPositionTypeMatchesFilter("etf", { kind: "single", value: "stock" }),
    false,
  );
});

test("formats display labels without leaking canonical values", () => {
  assert.equal(accountPositionTypeDisplayLabel("stock"), "Stocks");
  assert.equal(accountPositionTypeDisplayLabel("etf"), "ETF");
  assert.equal(accountPositionTypeDisplayLabel("option"), "Options");
});
