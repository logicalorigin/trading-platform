import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readLocalSource = (filename) =>
  readFileSync(new URL(filename, import.meta.url), "utf8");

const chartWidgetsSource = readLocalSource("./ResearchChartWidgets.tsx");
const chartWidgetSharedSource = readLocalSource("./chartWidgetShared.tsx");

test("chart symbol search trigger stays isolated from live quote header churn", () => {
  const triggerRender =
    /<ChartSymbolSearchTrigger[\s\S]*?\/>/.exec(chartWidgetsSource)?.[0] ?? "";

  assert.match(
    chartWidgetSharedSource,
    /export const ChartSymbolSearchTrigger = memo\(function ChartSymbolSearchTrigger/,
  );
  assert.match(
    chartWidgetsSource,
    /const palette = useMemo\(\(\) => getPanelPalette\(theme\), \[theme\]\);/,
  );
  assert.match(triggerRender, /theme=\{theme\}/);
  assert.match(triggerRender, /palette=\{palette\}/);
  assert.match(triggerRender, /searchOpen=\{searchOpen\}/);
});
