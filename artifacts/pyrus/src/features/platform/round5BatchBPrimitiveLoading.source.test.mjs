import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Badge remains static while accepting title and style passthrough", () => {
  const source = readSource("../../components/platform/primitives.jsx");
  const start = source.indexOf("export const Badge = ({");
  assert.notEqual(start, -1, "Badge primitive must exist");
  const block = source.slice(start, source.indexOf(");", start) + 2);

  assert.match(block, /\btitle,/);
  assert.match(block, /\bstyle = \{\},/);
  assert.match(block, /<span\s+title=\{title\}/);
  assert.doesNotMatch(block, /className=/);
  assert.doesNotMatch(block, /role=/);
  assert.doesNotMatch(block, /tabIndex=/);
});

test("Pattern discovery family chip uses the static Badge title passthrough", () => {
  const source = readSource("../backtesting/PatternDiscoveryPanel.tsx");
  const start = source.indexOf("function FamilyChip");
  assert.notEqual(start, -1, "FamilyChip must exist");
  const block = source.slice(start, source.indexOf("function edgeTone", start));

  assert.match(block, /<Badge/);
  assert.match(block, /title=\{family\.description\}/);
  assert.doesNotMatch(block, /<span\s+title=\{family\.description\}/);
});

test("Photonics period return chip uses static Badge instead of interactive Pill", () => {
  const source = readSource("../research/PhotonicsObservatory.jsx");
  const start = source.indexOf("isFiniteNumber(periodReturn)");
  assert.notEqual(start, -1, "period return branch must exist");
  const block = source.slice(start, start + 900);

  assert.match(block, /<Badge color=\{retColor\}/);
  assert.match(block, /title=\{`Return over \$\{pricePeriod\}`\}/);
  assert.doesNotMatch(block, /<Pill/);
});

test("Research chart loading empty state uses a flat merged label over the skeleton", () => {
  const source = readSource("../charting/ResearchChartSurface.tsx");
  const start = source.indexOf("{emptyStateIsLoading ? (");
  assert.notEqual(start, -1, "chart empty loading branch must exist");
  const block = source.slice(start, start + 1700);

  assert.match(block, /<ChartSkeleton/);
  assert.match(block, /\{emptyStateEyebrow\}: \{emptyStateTitle\}/);
  assert.doesNotMatch(block, /boxShadow: ELEVATION\.lg/);
  assert.doesNotMatch(block, /border: `1px solid \$\{withAlpha\(theme\.border/);
  assert.doesNotMatch(block, /background: theme\.bg2/);
});

test("Trade option chain loading uses the chart skeleton instead of the unavailable-state card", () => {
  const source = readSource("../trade/TradeChainPanel.jsx");
  const start = source.indexOf(") : showLoading ? (");
  assert.notEqual(start, -1, "chain loading branch must exist");
  const loadingBlock = source.slice(start, source.indexOf(") : (", start + 1));

  assert.match(loadingBlock, /<ChartSkeleton fill bars=\{18\}/);
  assert.match(loadingBlock, /aria-label="Loading option chain"/);
  assert.doesNotMatch(loadingBlock, /<DataUnavailableState/);
});
