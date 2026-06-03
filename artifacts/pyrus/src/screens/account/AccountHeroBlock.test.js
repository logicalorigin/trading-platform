import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./AccountHeroBlock.jsx", import.meta.url), "utf8");
const accountScreenSource = readFileSync(new URL("../AccountScreen.jsx", import.meta.url), "utf8");

test("hero owns net liq, day P&L, and the performance summary", () => {
  assert.match(source, /data-testid="account-hero-block"/);
  assert.match(source, /data-testid="account-hero-primary-row"/);
  assert.match(source, /data-testid="account-hero-performance-rail"/);
  assert.match(source, /fontSize:\s*fs\(isPhone \? 16 : 20\)/);
  assert.match(source, /background:\s*cssColorAlpha\(dayTone, "12"\)/);
  assert.match(source, /returnsModel/);
  assert.match(source, /label:\s*"Adj return"/);
  assert.match(source, /label:\s*"P&L Δ"/);
  assert.doesNotMatch(source, /marginLeft:\s*"auto"/);
  assert.doesNotMatch(source, /sectionControl/);
});

test("hero uses tightened one-line spacing", () => {
  assert.match(source, /gap:\s*sp\(isPhone \? 4 : 6\)/);
  assert.match(source, /padding:\s*sp\("1px 3px 1px"\)/);
  assert.match(source, /gap:\s*sp\(2\)/);
  assert.match(source, /minHeight:\s*dim\(18\)/);
  assert.match(source, /maxWidth:\s*dim\(104\)/);
  assert.match(source, /padding:\s*sp\("0 5px"\)/);
  assert.match(source, /<DayIcon size=\{10\} \/>/);
  assert.doesNotMatch(source, /fontSize:\s*fs\(isPhone \? 18 : 24\)/);
  assert.doesNotMatch(source, /maxWidth:\s*dim\(112\)/);
  assert.doesNotMatch(source, /<DayIcon size=\{11\} \/>/);
});

test("hero keeps the old one-row height by using a horizontal performance rail", () => {
  assert.match(source, /display:\s*"flex"/);
  assert.match(source, /overflow:\s*"hidden"/);
  assert.match(source, /overflowX:\s*"auto"/);
  assert.match(source, /whiteSpace:\s*"nowrap"/);
  assert.match(source, /const performanceRailMetrics = \[\.\.\.performanceSummary, \.\.\.performanceMetrics\]/);
  assert.match(source, /<HeroMetricPill/);
  assert.doesNotMatch(source, /data-testid="account-hero-performance-grid"/);
  assert.doesNotMatch(source, /gridTemplateColumns:\s*isPhone/);
  assert.doesNotMatch(source, /flexWrap:\s*"wrap"/);
});

test("hero carries the full former performance metric set", () => {
  for (const label of [
    "Trades",
    "Real",
    "Open",
    "Win",
    "PF",
    "Exp",
    "MaxDD",
    "CurDD",
    "Vol",
    "Sharpe",
    "Sort",
    "Fees",
    "Div",
    "Int",
  ]) {
    assert.match(source, new RegExp(`label:\\s*"${label}"`));
  }
  assert.match(source, /formatAccountSignedMoney\(transferAdjustedPnl/);
  assert.match(source, /equity\.returnPercentDiscrepancy/);
});

test("account screen wires returns model into the hero", () => {
  assert.match(accountScreenSource, /import \{ retryDynamicImport \} from "\.\.\/lib\/dynamicImport"/);
  assert.match(accountScreenSource, /const LazyAccountHeroBlock = lazy/);
  assert.match(accountScreenSource, /retryDynamicImport\([\s\S]*label: "AccountHeroBlock"/);
  for (const label of [
    "TodaySnapshotPanel",
    "AccountReturnsPanel",
    "PortfolioExposurePanel",
    "EquityCurvePanel",
    "PositionsPanel",
    "TradingAnalysisWorkbench",
    "TradesOrdersPanel",
    "CashFundingPanel",
    "SetupHealthPanel",
  ]) {
    assert.match(accountScreenSource, new RegExp(`label:\\s*"${label}"`));
  }
  assert.doesNotMatch(
    accountScreenSource,
    /import AccountHeroBlock from "\.\/account\/AccountHeroBlock"/,
  );
  assert.match(
    accountScreenSource,
    /<LazyAccountHeroBlock[\s\S]*?equityHistory=\{equityQuery\.data\}[\s\S]*?range=\{range\}/,
  );
  assert.match(source, /buildAccountReturnsModel/);
});

test("hero no longer renders all-time P&L", () => {
  assert.doesNotMatch(source, /totalPnl/);
  assert.doesNotMatch(source, /totalPnlPercent/);
  assert.doesNotMatch(source, /All-time/);
});
