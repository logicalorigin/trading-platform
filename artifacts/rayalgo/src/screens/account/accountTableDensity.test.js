import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const accountUtilsSource = readFileSync(new URL("./accountUtils.jsx", import.meta.url), "utf8");
const positionsSource = readFileSync(new URL("./PositionsPanel.jsx", import.meta.url), "utf8");
const tradesOrdersSource = readFileSync(new URL("./TradesOrdersPanel.jsx", import.meta.url), "utf8");
const cashFundingSource = readFileSync(new URL("./CashFundingPanel.jsx", import.meta.url), "utf8");

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
  assert.match(tradesOrdersSource, /data-testid="account-closed-trades-table-scroll"/);
  assert.doesNotMatch(tradesOrdersSource, /maxHeight:\s*248/);
  assert.doesNotMatch(tradesOrdersSource, /maxHeight:\s*278/);

  assert.match(cashFundingSource, /data-testid="account-cash-activity-table-scroll"/);
  assert.doesNotMatch(cashFundingSource, /maxHeight:\s*170/);

  for (const source of [positionsSource, tradesOrdersSource, cashFundingSource]) {
    assert.match(source, /overflowX:\s*"auto"/);
  }
});

test("account mobile scan rows use the denser row target", () => {
  assert.match(positionsSource, /gap:\s*sp\(1\)/);
  assert.match(positionsSource, /minHeight:\s*dim\(40\)/);
  assert.match(tradesOrdersSource, /gap:\s*sp\(1\)/);
  assert.match(tradesOrdersSource, /minHeight:\s*dim\(40\)/);
});
