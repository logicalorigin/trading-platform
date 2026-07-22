import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (name) =>
  readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

const accountHeroSource = readSource("AccountHeroBlock.jsx");
const equityCurveSource = readSource("EquityCurvePanel.jsx");
const accountReturnsSource = readSource("AccountReturnsPanel.jsx");
const portfolioExposureSource = readSource("PortfolioExposurePanel.jsx");
const accountUtilsSource = readSource("accountUtils.jsx");

test("account hero keeps financial values in the data font and prose in the interface font", () => {
  assert.match(
    accountHeroSource,
    /const HeroMetricPill[\s\S]*?fontFamily: T\.data,[\s\S]*?\{value\}/,
  );
  assert.match(
    accountHeroSource,
    /fontFamily: T\.data,\s*fontSize: fs\(isPhone \? 17 : 22\)/,
  );
  assert.match(
    accountHeroSource,
    /fontFamily: T\.data[^\n]*\}\}>\{formatMoney\(displayDayPnl/,
  );
  assert.match(
    accountHeroSource,
    /fontFamily: T\.sans[^\n]*\}\}>today<\/span>/,
  );
});

test("equity curve uses the data font for money, percentages, quantities, and timestamps", () => {
  assert.match(
    equityCurveSource,
    /fontSize: fs\(compact \? 22 : 28\),\s*fontFamily: T\.data/,
  );
  assert.match(
    equityCurveSource,
    /color: toneColor\(displayedDeltaPercent \?\? displayedDelta\)[\s\S]*?fontFamily: T\.data/,
  );
  assert.match(
    equityCurveSource,
    /<span style=\{\{ fontFamily: T\.data \}\}>\s*\{formatAppDateTime\(activeEvent\.timestamp\)\}/,
  );
  assert.match(
    equityCurveSource,
    /<span style=\{\{ fontFamily: T\.data \}\}>\s*\{Number\(activeEvent\.quantity\)\.toLocaleString\(\)\} sh/,
  );
  assert.match(
    equityCurveSource,
    /<span style=\{\{ fontFamily: T\.data \}\}>\s*@ \{formatAccountPrice\(activeEvent\.price/,
  );
  assert.match(
    equityCurveSource,
    /\{sourceLabel\} · <span style=\{\{ fontFamily: T\.data \}\}>\s*\{formatAppDateTime\(latestSnapshotTimestamp\)\}/,
  );
});

test("returns calendar distinguishes interface labels from financial and date values", () => {
  assert.match(
    accountReturnsSource,
    /fontFamily: T\.data,[\s\S]*?\{dayNumber\}/,
  );
  assert.match(
    accountReturnsSource,
    /fontFamily: T\.data,[\s\S]*?\{formatCalendarCellValue\(displayPnl, currency, maskValues\)\}/,
  );
  assert.match(
    accountReturnsSource,
    /const valueStyle = \{[\s\S]*?fontFamily: T\.data/,
  );
  assert.match(
    accountReturnsSource,
    /fontFamily: day \? T\.data : T\.sans/,
  );
  assert.match(
    accountReturnsSource,
    /data-testid="account-pnl-calendar-period"[\s\S]*?fontFamily: T\.data/,
  );
});

test("exposure labels stay Sans while reusable financial values use the data font", () => {
  for (const component of ["ExposureMetric", "DonutLegend", "CompactFact", "RiskMetric"]) {
    const start = portfolioExposureSource.indexOf(`const ${component}`);
    assert.notEqual(start, -1, `Missing ${component}`);
    const nextComponent = portfolioExposureSource.indexOf("\nconst ", start + 1);
    const source = portfolioExposureSource.slice(
      start,
      nextComponent === -1 ? undefined : nextComponent,
    );
    assert.match(source, /fontFamily: T\.data/, `${component} value must use T.data`);
  }
  assert.match(portfolioExposureSource, /fontFamily: T\.sans,[\s\S]*?\{item\.label\}/);
  assert.match(
    portfolioExposureSource,
    /fontFamily: T\.data \}\}>\s*\{formatAccountPercent\(sector\.weightPercent/,
  );
});

test("secondary cell text defaults to prose and allows an explicit data role", () => {
  assert.match(
    accountUtilsSource,
    /cellSubTextStyle = \(tone = CSS_COLOR\.textMuted, role = "text"\)/,
  );
  assert.match(
    accountUtilsSource,
    /fontFamily: role === "data" \? T\.data : T\.sans/,
  );
});
