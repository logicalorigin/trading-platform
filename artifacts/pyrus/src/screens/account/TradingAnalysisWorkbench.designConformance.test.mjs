import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./TradingAnalysisWorkbench.jsx", import.meta.url),
  "utf8",
);
const forensicsSource = readFileSync(
  new URL("./tradingAnalysis/TradeForensics.jsx", import.meta.url),
  "utf8",
);

test("trading analysis leads with one asymmetric performance brief", () => {
  assert.match(source, /data-testid="account-analysis-performance-brief"/);
  assert.match(source, /data-testid="account-analysis-decision-metrics"/);
  assert.match(source, /data-testid="account-analysis-secondary-metrics"/);
  assert.match(source, /Net P&L/);
  assert.match(source, /Decision metrics/);
  assert.match(source, /Risk & efficiency/);
  assert.match(source, /gridTemplateColumns: isPhone/);
  assert.doesNotMatch(source, /Trading Analysis Workbench/);
});

test("initial loading does not present zero-valued performance as settled data", () => {
  assert.match(source, /value=\{loading \? null : metrics\.netPnl\}/);
  assert.match(source, /loading\s*\?\s*"Loading closed trades"/);
  assert.match(source, /value=\{loading \? null : metric\.value\}/);
});

test("scope, view, range, and phone filters share one responsive toolbar", () => {
  assert.match(source, /data-testid="account-analysis-scope-toolbar"/);
  assert.match(source, /activeView/);
  assert.match(source, /onViewChange/);
  assert.match(source, /aria-label="Trading analysis range"/);
  assert.match(source, /radioGroup/);
  assert.match(source, /onOpenFilters/);
  assert.match(source, /handleRangeChange/);
  assert.match(source, /type: "clearDateRange"/);
});

test("filters and view content expose their accessible names and focus contract", () => {
  assert.match(source, /aria-label="Filter by symbol"/);
  assert.match(source, /aria-label="Trade source"/);
  assert.match(source, /aria-label="Trading strategy"/);
  assert.match(source, /aria-label="Start date"/);
  assert.match(source, /aria-label="End date"/);
  assert.doesNotMatch(source, /role="tabpanel"/);
  assert.match(source, /aria-label=\{\s*activeView === "patterns"/);
  assert.match(source, /FOCUSABLE_SELECTOR/);
  assert.match(source, /previousFocusRef/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /account-analysis-open-filters/);
  assert.match(source, /account-analysis-close-filters/);
});

test("redesign preserves analysis seams and masks chart tooltips", () => {
  [
    "account-trading-analysis-workbench",
    "account-analysis-kpi-strip",
    "account-analysis-insights",
    "account-analysis-filter-rail",
    "account-analysis-patterns-view",
    "account-analysis-trades-view",
    "account-analysis-trade-row",
    "account-analysis-trade-expanded",
  ].forEach((testId) => assert.match(source, new RegExp(testId)));

  assert.match(
    source,
    /formatAccountMoney\(item\.value, currency, true, maskValues\)/,
  );
  assert.match(source, /setActiveView\("trades"\)/);
  assert.match(source, /Performance chart hidden/);
  assert.match(source, /Decision notes hidden/);
  assert.match(source, /aria-label=\{`Remove filter/);
  assert.doesNotMatch(source, /ThresholdHistogram/);
  assert.doesNotMatch(source, /FilterSection title="Lens"/);
  assert.match(source, /window\.localStorage\.setItem/);
  assert.match(source, /persistState\(/);
  assert.doesNotMatch(source, /import .*\.css["']/);
});

test("the waterfall chart does not expose a pointer-only trade action", () => {
  const waterfallSource = source.slice(
    source.indexOf("const WaterfallChart"),
    source.indexOf("const SymbolTable"),
  );

  assert.doesNotMatch(waterfallSource, /onTradeSelect|onClick=/);
});

test("trade history exposes truthful execution and audit detail", () => {
  assert.match(
    source,
    /key: "realizedPnl",\s*label: "Realized P&L"/,
  );
  assert.doesNotMatch(source, /label="Gross"/);
  [
    "Return",
    "Premium at risk",
    "Opened",
    "Closed",
    "Signal price",
    "Strike distance",
    "Audit Trail",
    "Linked orders",
    "Source event",
  ].forEach((label) => assert.match(source, new RegExp(label)));
  assert.match(source, /resolveAccountTradeContractDetails/);
});

test("parent stream renders do not rebuild the trading-analysis model", () => {
  const workbench = source.slice(
    source.indexOf("export const TradingAnalysisWorkbench"),
  );
  const visibleTradesMemo = workbench.match(
    /const visibleTrades = useMemo\([\s\S]*?\n  \);/,
  )?.[0];

  assert.match(
    workbench,
    /const normalizedFilters = useMemo\(\s*\(\) => normalizeTradingAnalysisFilters\(filters\),\s*\[filters\],?\s*\);/,
  );
  assert.ok(visibleTradesMemo, "Missing visible-trades memo");
  assert.doesNotMatch(
    visibleTradesMemo,
    /\[filters,\s*normalizedFilters,/,
  );
});

test("trading analysis owns its filtered model without a dead override prop", () => {
  const workbench = source.slice(
    source.indexOf("export const TradingAnalysisWorkbench"),
  );

  assert.doesNotMatch(workbench, /^\s*analysis,\s*$/m);
  assert.doesNotMatch(workbench, /analysis\s*\|\|\s*buildAccountTradingAnalysisModel/);
});

test("trade-analysis charts do not turn missing outcomes into zero P&L", () => {
  const hourly = source.match(/const buildByHourRows[\s\S]*?\n};/)?.[0];

  assert.ok(hourly, "Missing hourly trade analysis model");
  assert.match(hourly, /const pnl = finiteNumber\(trade\.realizedPnl\);/);
  assert.match(hourly, /outcomeCount:\s*0/);
  assert.match(hourly, /current\.outcomeCount \+= 1/);
  assert.match(hourly, /row\.outcomeCount === row\.count \? row\.pnl : null/);
  assert.match(source, /group\.outcomeCount === group\.count/);
  assert.match(source, /value == null \|\| \(typeof value === "string" && value\.trim\(\) === ""\)/);
});

test("performance brief discloses incomplete outcome coverage", () => {
  assert.match(source, /metrics\.outcomeCount < metrics\.trades/);
  assert.match(source, /outcomes available/);
  assert.match(
    source,
    /detail=\{\s*metrics\.trades\s*\?\s*"The cumulative result will appear once complete outcomes are available\."/,
  );
});

test("trade forensics does not plot missing prices at zero", () => {
  assert.match(forensicsSource, /const finiteNumber = \(value\) =>/);
  assert.match(
    forensicsSource,
    /\[trade\?\.avgOpen, trade\?\.avgClose\]\s*\.map\(finiteNumber\)/,
  );
  assert.doesNotMatch(forensicsSource, /=\s*Number\(trade\?\.avgOpen\)/);
  assert.doesNotMatch(forensicsSource, /=\s*Number\(trade\?\.avgClose\)/);
  assert.match(forensicsSource, /role="img"/);
  assert.match(forensicsSource, /aria-label=\{`\$\{symbol\} price during the selected trade window`\}/);
});

test("trade sorting leaves missing values unknown and last", () => {
  const sortBlock = source.match(
    /const tradeSortValue[\s\S]*?const formatHold/,
  )?.[0];

  assert.ok(sortBlock, "Missing trade sort model");
  assert.doesNotMatch(sortBlock, /finiteNumber\(trade\?\.[^)]+\) \?\? 0/);
  assert.doesNotMatch(sortBlock, /new Date\([^)]*\|\| 0\)/);
  assert.match(sortBlock, /if \(leftValue == null \|\| rightValue == null\)/);
  assert.match(sortBlock, /return leftValue == null \? 1 : -1/);
});
