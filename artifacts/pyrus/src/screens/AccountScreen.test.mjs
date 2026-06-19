import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readLocalSource = (filename) =>
  readFileSync(new URL(filename, import.meta.url), "utf8");

test("account day PnL prefers live position row day changes over summary fallback", () => {
  const source = readLocalSource("./AccountScreen.jsx");
  const start = source.indexOf("const livePositionsDayPnlMetric =");
  const end = source.indexOf("const livePositionsNetLiquidation", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const block = source.slice(start, end);
  assert.match(
    block,
    /const totalDayPnl = hasDayChange \? openPositionsDayPnl : fallbackValue;/,
  );
  assert.doesNotMatch(block, /const totalDayPnl = fallbackValue \?\? openPositionsDayPnl;/);
});

test("shadow account equity curve uses the shadow account tone", () => {
  const source = readLocalSource("./AccountScreen.jsx");
  const panel = source.match(/<LazyEquityCurvePanel[\s\S]*?\/>/)?.[0];

  assert.ok(panel, "Missing LazyEquityCurvePanel render");
  assert.match(
    panel,
    /accentColor=\{shadowMode \? CSS_COLOR\.pink : CSS_COLOR\.green\}/,
  );
});
