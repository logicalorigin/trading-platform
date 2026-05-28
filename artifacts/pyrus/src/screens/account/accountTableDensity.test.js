import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const accountUtilsSource = readFileSync(new URL("./accountUtils.jsx", import.meta.url), "utf8");
const positionsSource = readFileSync(new URL("./PositionsPanel.jsx", import.meta.url), "utf8");
const tradesOrdersSource = readFileSync(new URL("./TradesOrdersPanel.jsx", import.meta.url), "utf8");
const tradingAnalysisSource = readFileSync(new URL("./TradingAnalysisWorkbench.jsx", import.meta.url), "utf8");
const cashFundingSource = readFileSync(new URL("./CashFundingPanel.jsx", import.meta.url), "utf8");
const cssSource = readFileSync(new URL("../../index.css", import.meta.url), "utf8");

test("account table tokens use the balanced density contract", () => {
  assert.match(accountUtilsSource, /return textSize\("caption"\);/);
  assert.match(accountUtilsSource, /letterSpacing:\s*"0\.06em"/);
  assert.match(accountUtilsSource, /textTransform:\s*"uppercase"/);
  assert.match(accountUtilsSource, /return sp\("3px 8px"\);/);
  assert.match(accountUtilsSource, /minHeight:\s*dim\(14\)/);
  assert.match(accountUtilsSource, /padding:\s*sp\("0 5px"\)/);
  assert.match(accountUtilsSource, /top:\s*0/);
});

test("account desktop tables keep horizontal access without vertical caps", () => {
  assert.match(positionsSource, /data-testid="account-positions-table-scroll"/);
  assert.doesNotMatch(positionsSource, /maxHeight:\s*"34vh"/);

  assert.match(tradesOrdersSource, /data-testid="account-orders-table-scroll"/);
  assert.match(tradingAnalysisSource, /data-testid="account-analysis-trades-view"/);
  assert.doesNotMatch(tradesOrdersSource, /maxHeight:\s*248/);
  assert.doesNotMatch(tradesOrdersSource, /maxHeight:\s*278/);
  assert.doesNotMatch(tradingAnalysisSource, /maxHeight:\s*248/);
  assert.doesNotMatch(tradingAnalysisSource, /maxHeight:\s*278/);

  assert.match(cashFundingSource, /data-testid="account-cash-activity-table-scroll"/);
  assert.doesNotMatch(cashFundingSource, /maxHeight:\s*170/);

  for (const source of [positionsSource, tradesOrdersSource, cashFundingSource]) {
    assert.match(source, /overflowX:\s*"auto"/);
  }
});

test("account phone layouts keep the dense horizontal table path", () => {
  assert.match(positionsSource, /data-testid="account-positions-table-scroll"/);
  assert.match(positionsSource, /ra-dense-table-scroll/);
  assert.doesNotMatch(positionsSource, /data-testid="account-positions-row-list"/);
  assert.match(tradesOrdersSource, /data-testid="account-orders-table-scroll"/);
  assert.match(tradesOrdersSource, /ra-dense-table-scroll/);
  assert.doesNotMatch(tradesOrdersSource, /data-testid="account-orders-row-list"/);
  assert.match(tradingAnalysisSource, /dataTestId="account-analysis-trade-row"/);
  assert.match(tradingAnalysisSource, /rowHeight=\{isPhone \? 54 : 38\}/);
  assert.match(cssSource, /ra-dense-table-scroll \*/);
  assert.match(
    cssSource,
    /\[data-testid="account-screen"\] \[style\*="min-width"\]:not\(\.ra-dense-table-scroll\):not\(\.ra-dense-table-scroll \*\)/,
  );
});

test("position tables use the compact brokerage density treatment", () => {
  assert.match(positionsSource, /const POSITION_TABLE_ROW_HEIGHT = 38/);
  assert.match(positionsSource, /const POSITION_TABLE_HEADER_HEIGHT = 28/);
  assert.match(positionsSource, /padding:\s*sp\("3px 6px"\)/);
  assert.match(positionsSource, /textTransform:\s*"none"/);
  assert.match(positionsSource, /compactPositionHeaderStyle/);
  assert.match(positionsSource, /compactPositionCellStyle/);
  assert.match(positionsSource, /ra-position-table-row--alt/);
  assert.match(cssSource, /\.ra-position-table-row--alt/);
  assert.match(cssSource, /--ra-surface-1/);
});

test("account report tables use shared client-side pagination", () => {
  assert.match(positionsSource, /POSITIONS_PAGE_SIZE = 50/);
  assert.match(positionsSource, /dataTestId="account-positions-pagination"/);
  assert.match(positionsSource, /pageRows\.map/);

  assert.match(tradesOrdersSource, /ORDERS_PAGE_SIZE = 25/);
  assert.match(tradesOrdersSource, /dataTestId="account-orders-pagination"/);
  assert.match(tradesOrdersSource, /pageOrders\.map/);

  assert.match(cashFundingSource, /CASH_ACTIVITY_PAGE_SIZE = 25/);
  assert.match(cashFundingSource, /dataTestId="account-cash-activity-pagination"/);
  assert.match(cashFundingSource, /paginatedActivities\.pageRows\.map/);

  assert.match(tradingAnalysisSource, /SYMBOL_PAGE_SIZE = 8/);
  assert.match(tradingAnalysisSource, /dataTestId="account-analysis-symbol-pagination"/);
  assert.doesNotMatch(tradingAnalysisSource, /Show all/);
});

test("account tables keep their frames while stream-owned data is pending", () => {
  assert.match(positionsSource, /query\.isPending \|\| query\.isLoading/);
  assert.match(positionsSource, /&& !query\.data/);
  assert.match(tradesOrdersSource, /query\.isPending \|\| query\.isLoading/);
  assert.match(tradesOrdersSource, /&& !query\.data/);
  assert.match(cashFundingSource, /query\.isPending \|\| query\.isLoading/);
  assert.match(cashFundingSource, /&& !query\.data/);
});
