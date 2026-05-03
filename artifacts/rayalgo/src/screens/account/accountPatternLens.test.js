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
    pnlSign: "losers",
    closeHour: "10",
    assetClass: "ETF",
    from: "2026-01-01",
  });

  assert.deepEqual(filters, {
    symbol: "",
    sourceType: "all",
    pnlSign: "all",
    closeHour: null,
    assetClass: "ETF",
    from: "2026-01-01",
  });
});

test("close-hour pattern matching uses New York market time", () => {
  assert.equal(closeDateMatchesPatternHour("2026-05-01T14:30:00.000Z", "10"), true);
  assert.equal(closeDateMatchesPatternHour("2026-05-01T14:30:00.000Z", "09"), false);
});
