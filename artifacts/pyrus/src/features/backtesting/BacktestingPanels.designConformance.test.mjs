import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./BacktestingPanels.tsx", import.meta.url),
  "utf8",
);

test("backtesting does not render future-only optimizer chrome", () => {
  assert.doesNotMatch(source, /Optimizer Snapshots/);
  assert.doesNotMatch(source, /Optimizer history is not surfaced/);
});

test("backtesting keeps the full workbench header out of the phone scroll lock", () => {
  assert.match(source, /position:\s*backtestIsPhone\s*\?\s*"static"\s*:\s*"sticky"/);
});

test("backtesting composes the empty workbench when its visible content has room", () => {
  assert.match(
    source,
    /const canComposeEmptyWorkbench = backtestRootSize\.width >= 900;/,
  );
  assert.match(
    source,
    /gridTemplateColumns:\s*canComposeEmptyWorkbench\s*&&\s*studies\.length\s*===\s*0[\s\S]*?minmax\(0,\s*1fr\)[\s\S]*?minmax\(320px,\s*400px\)/,
  );
});

test("compact promoted drafts auto-fit horizontally when room exists", () => {
  assert.match(
    source,
    /gridTemplateColumns:\s*compact[\s\S]*?repeat\(auto-fit,\s*minmax\(min\(220px,\s*100%\),\s*1fr\)\)/,
  );
});

test("backtesting forms expose their visible field labels programmatically", () => {
  for (const label of [
    "Study",
    "Run",
    "Symbol",
    "Strategy",
    "Timeframe",
    "Direction",
    "Universe watchlist",
    "Trade symbol",
    "Trade direction",
    "Trade outcome",
    "Trade exit reason",
    "Default pane",
    "Script status",
    "Chart access",
  ]) {
    assert.match(source, new RegExp(`ariaLabel="${label}"`));
  }

  for (const label of [
    "Queue run name",
    "Study name",
    "Backtest start date",
    "Backtest end date",
    "Universe symbols",
    "Trade start date",
    "Trade end date",
    "Pine script name",
    "Script key override",
    "Pine script description",
    "Pine script tags",
    "Pine script notes",
    "Pine source",
  ]) {
    assert.match(source, new RegExp(`aria-label="${label}"`));
  }

  assert.match(source, /"aria-label": "Trade search"/);
});

test("backtesting delegates regular-session filtering to the market calendar", () => {
  assert.match(
    source,
    /import \{ resolveUsEquityMarketSession \} from "@workspace\/market-calendar";/,
  );
  assert.match(
    source,
    /return resolveUsEquityMarketSession\(timestamp\)\.key === "rth";/,
  );
  assert.doesNotMatch(source, /totalMinutes >= 570/);
});

test("backtesting suspends hidden strategy work and settled collection polls", () => {
  assert.match(
    source,
    /const strategyWorkbenchVisible = isVisible && workbenchView === "strategy";/,
  );
  assert.ok(
    (source.match(/enabled: Boolean\(strategyWorkbenchVisible &&/g) ?? []).length >= 2,
    "run-chart and preview-chart queries should require the strategy view",
  );
  assert.match(
    source,
    /if \(!strategyWorkbenchVisible\) \{\s*void queryClient\.cancelQueries\(\{ queryKey: \["backtest-spot-history"\] \}\);/,
  );
  assert.ok(
    (source.match(/shouldPollBacktestCollection\(query\.state\.data\?\.(?:runs|jobs)\)/g) ?? [])
      .length === 2,
    "run and job lists should stop polling once every item is terminal",
  );
});

test("trade-derived analysis uses one filtered population and a numeric hour key", () => {
  assert.match(
    source,
    /const filteredBestTrade = filteredTradeRows\.reduce/,
  );
  assert.match(
    source,
    /const filteredWorstTrade = filteredTradeRows\.reduce/,
  );
  assert.match(source, /filteredTradeRows\.forEach\(\(trade\) => \{/);
  assert.match(source, /hourCycle: "h23"/);
  assert.match(source, /\(left, right\) => left\.sortHour - right\.sortHour/);
  assert.match(
    source,
    /label="Best Trade"[\s\S]*?filteredBestTrade\?\.netPnl/,
  );
  assert.match(
    source,
    /label="Worst Trade"[\s\S]*?filteredWorstTrade\?\.netPnl/,
  );
  assert.doesNotMatch(source, /Number\.parseInt\(left\.hour/);
});

test("backtest completion makes the Algo draft destination explicit", () => {
  assert.match(source, /Create Algo Draft/);
  assert.match(
    source,
    /aria-label=\{`Create Algo draft from \$\{runDetail\?\.run\.name \?\? "selected run"\}`\}/,
  );
  assert.doesNotMatch(source, />\s*Promote\s*</);
  assert.match(source, /title: "Algo draft created"/);
});

test("backtest result hierarchy exposes stable regions in reading order", () => {
  const inputs = source.indexOf('testId="backtest-inputs"');
  const results = source.indexOf('testId="backtest-results"');
  const warnings = source.indexOf('data-testid="backtest-validation-warnings"');
  const trades = source.indexOf('testId="backtest-trades"');
  const logs = source.indexOf('testId="backtest-logs"');
  const history = source.indexOf('testId="backtest-history"');

  for (const [label, index] of Object.entries({
    inputs,
    results,
    warnings,
    trades,
    logs,
    history,
  })) {
    assert.ok(index >= 0, `${label} region should be explicit`);
  }
  assert.ok(inputs < results);
  assert.ok(results < warnings);
  assert.ok(warnings < trades);
  assert.ok(trades < logs);
  assert.ok(logs < history);
});
