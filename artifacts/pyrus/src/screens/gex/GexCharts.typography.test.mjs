import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const chartSource = readFileSync(new URL("./GexCharts.jsx", import.meta.url), "utf8");
const tooltipStyleSource = readFileSync(
  new URL("../../lib/tooltipStyles.ts", import.meta.url),
  "utf8",
);

test("shared chart tooltips keep prose sans and expose a tabular data-value role", () => {
  const containerStyle = tooltipStyleSource.match(
    /export const chartTooltipContentStyle = \{[\s\S]*?\n\} as const;/,
  )?.[0];
  const valueStyle = tooltipStyleSource.match(
    /export const chartTooltipValueStyle = \{[\s\S]*?\n\} as const;/,
  )?.[0];

  assert.ok(containerStyle, "Missing shared chart tooltip container style");
  assert.match(containerStyle, /fontFamily: T\.display/);
  assert.ok(valueStyle, "Missing shared chart tooltip numeric-value style");
  assert.match(valueStyle, /fontFamily: T\.data/);
  assert.match(valueStyle, /fontVariantNumeric: "tabular-nums"/);
});

test("every visible GEX chart axis uses the canonical data font", () => {
  const ticks = chartSource.match(
    /tick=\{\{[^{}\n]*fontFamily: T\.(?:sans|data)[^{}\n]*\}\}/g,
  ) ?? [];

  assert.equal(ticks.length, 18, "Expected all 18 visible GEX axis tick styles");
  ticks.forEach((tick) => assert.match(tick, /fontFamily: T\.data/));
});

test("GEX tooltip numbers use the shared value role without changing prose containers", () => {
  assert.match(
    chartSource,
    /import \{ chartTooltipValueStyle \} from "\.\.\/\.\.\/lib\/tooltipStyles";/,
  );
  assert.match(
    chartSource,
    /const GexTooltipValue = \(\{ children \}\) =>[\s\S]*?style=\{chartTooltipValueStyle\}/,
  );
  assert.equal(
    chartSource.match(/<GexTooltipValue>/g)?.length,
    37,
    "Expected every current GEX tooltip value to opt into the data role",
  );
  assert.equal(
    chartSource.match(/fontFamily: T\.sans/g)?.length,
    4,
    "Only tooltip/prose containers and the intraday label should remain Sans",
  );
});
