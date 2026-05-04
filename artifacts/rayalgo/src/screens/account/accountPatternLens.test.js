import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPatternLensToTradeFilters,
  buildAccountPatternLens,
  clearPatternLensFromTradeFilters,
  closeDateMatchesPatternHour,
} from "./accountPatternLens.js";

test("account pattern lens maps symbol clicks into trade filters", () => {
  const lens = buildAccountPatternLens("symbol", { symbol: "sqqq" });
  const filters = applyPatternLensToTradeFilters(
    { assetClass: "ETF", from: "2026-01-01" },
    lens,
  );

  assert.equal(lens.label, "Symbol SQQQ");
  assert.equal(filters.symbol, "SQQQ");
  assert.equal(filters.assetClass, "ETF");
  assert.equal(filters.pnlSign, "all");
});

test("account pattern lens maps source and close-hour drilldowns", () => {
  const sourceLens = buildAccountPatternLens("source", {
    sourceType: "watchlist_backtest",
    label: "Watchlist Backtest",
  });
  const hourLens = buildAccountPatternLens("hour", { hour: "9" });

  assert.equal(sourceLens.sourceType, "watchlist_backtest");
  assert.equal(sourceLens.label, "Source Watchlist Backtest");
  assert.equal(hourLens.closeHour, "09");
  assert.equal(hourLens.label, "Close hour 09:00 ET");
});

test("account pattern lens clears only pattern-owned filters", () => {
  const filters = clearPatternLensFromTradeFilters({
    symbol: "SQQQ",
    sourceType: "manual",
    side: "sell",
    holdDuration: "intraday",
    strategy: "Signal Bot",
    feeDrag: "high",
    pnlSign: "losers",
    closeHour: "10",
    assetClass: "ETF",
    from: "2026-01-01",
  });

  assert.deepEqual(filters, {
    symbol: "",
    sourceType: "all",
    side: "all",
    holdDuration: "all",
    strategy: "all",
    feeDrag: "all",
    pnlSign: "all",
    closeHour: null,
    assetClass: "ETF",
    from: "2026-01-01",
  });
});

test("account pattern lens maps extended account drilldowns", () => {
  const holdLens = buildAccountPatternLens("holdDuration", {
    holdDuration: "intraday-fast",
  });
  const strategyLens = buildAccountPatternLens("strategy", {
    strategy: "Signal Bot",
  });
  const feeLens = buildAccountPatternLens("feeDrag", { feeDrag: "high" });
  const assetLens = buildAccountPatternLens("assetClass", { assetClass: "Options" });

  assert.equal(holdLens.label, "Hold <= 30m");
  assert.equal(strategyLens.label, "Strategy Signal Bot");
  assert.equal(feeLens.label, "High fee drag");
  assert.equal(assetLens.label, "Asset Options");

  const filters = applyPatternLensToTradeFilters({}, holdLens);
  assert.equal(filters.holdDuration, "intraday-fast");

  assert.equal(
    clearPatternLensFromTradeFilters({ assetClass: "Options" }, assetLens).assetClass,
    "all",
  );
});

test("close-hour pattern matching uses New York market time", () => {
  assert.equal(closeDateMatchesPatternHour("2026-05-01T14:30:00.000Z", "10"), true);
  assert.equal(closeDateMatchesPatternHour("2026-05-01T14:30:00.000Z", "09"), false);
});
