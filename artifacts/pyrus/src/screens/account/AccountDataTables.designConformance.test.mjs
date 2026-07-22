import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (name) =>
  readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

const positions = readSource("PositionsPanel.jsx");
const orders = readSource("TradesOrdersPanel.jsx");
const cash = readSource("CashFundingPanel.jsx");
const analysis = readSource("TradingAnalysisWorkbench.jsx");

test("account native tables expose stable accessible names and column scopes", () => {
  [
    [positions, /aria-label="Open positions"/],
    [positions, /aria-label="Selected date account balances"/],
    [positions, /aria-label="Selected date positions"/],
    [positions, /aria-label="Selected date account activity"/],
    [positions, /aria-label=\{`\$\{row\.symbol\} tax lots`\}/],
    [orders, /aria-label=\{tab === "working" \? "Working orders" : "Order history"\}/],
    [cash, /aria-label="Cash activity"/],
    [analysis, /aria-label="Trading performance by symbol"/],
  ].forEach(([source, pattern]) => assert.match(source, pattern));

  assert.match(orders, /<th\s+key=\{column\}\s+scope="col"/);
  assert.match(cash, /<th\s+key=\{column\}\s+scope="col"/);
  assert.match(analysis, /<th\s+key=\{column\}\s+scope="col"/);
});

test("cash activity distinguishes a settled empty result from unavailable data", () => {
  assert.match(cash, /!activities\.length\s*\?/);
  assert.match(cash, /title="No cash activity"/);
  assert.match(cash, /body="Deposits, withdrawals, dividends, interest, and fees will appear here\."/);
});

test("dense account row controls use the shared touch-target contract", () => {
  assert.match(
    positions,
    /aria-label=\{expanded \? `Collapse \$\{row\.symbol\}` : `Expand \$\{row\.symbol\}`\}[\s\S]{0,120}className="ra-interactive ra-touch-target"/,
  );
  assert.match(
    positions,
    /aria-label=\{`Open \$\{row\.symbol\} chart`\}[\s\S]{0,120}className="ra-interactive ra-touch-target-y"/,
  );
  assert.match(
    orders,
    /className="ra-interactive ra-touch-target"[\s\S]{0,220}onClick=\{\(\) => onCancelOrder\(order\)\}/,
  );
});

test("the custom closed-trade surface has a screen-reader landmark", () => {
  assert.match(
    analysis,
    /data-testid="account-analysis-trades-view"\s+role="region"\s+aria-label="Closed trades"/,
  );
});
