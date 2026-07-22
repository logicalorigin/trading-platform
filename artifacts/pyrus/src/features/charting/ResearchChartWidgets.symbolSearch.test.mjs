import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ChartSymbolSearchTrigger,
  getPanelPalette,
} from "./chartWidgetShared.tsx";
import {
  T,
  getCurrentTheme,
  setCurrentTheme,
} from "../../lib/uiTokens.jsx";

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
    /const currentTheme = getCurrentTheme\(\);[\s\S]*?const palette = useMemo\([\s\S]*?getPanelPalette\(theme, currentTheme\)[\s\S]*?\[theme, currentTheme\]/,
  );
  assert.match(triggerRender, /theme=\{theme\}/);
  assert.match(triggerRender, /palette=\{palette\}/);
  assert.match(triggerRender, /searchOpen=\{searchOpen\}/);
  assert.match(triggerRender, /onSearchIntent=\{onSearchIntent\}/);
  assert.match(chartWidgetSharedSource, /const suppressNextTriggerClickRef = useRef\(false\);/);
  assert.match(chartWidgetSharedSource, /onSearchOpenChange\?\.\(true\);/);
  assert.match(chartWidgetSharedSource, /onPointerEnter=\{handleSearchIntent\}/);
  assert.match(
    chartWidgetSharedSource,
    /onPointerDownCapture=\{handleSearchPointerDownCapture\}/,
  );
  assert.match(chartWidgetSharedSource, /onClickCapture=\{handleSearchClickCapture\}/);
  assert.match(chartWidgetSharedSource, /onFocus=\{handleSearchFocus\}/);
});

test("dense chart chrome keeps every icon and compact value control named", () => {
  assert.equal(
    [...chartWidgetsSource.matchAll(/data-testid="chart-timeframe-menu-trigger"[\s\S]{0,180}?aria-label=\{`Timeframe \$\{timeframe\}`\}/g)].length,
    1,
  );
  assert.match(chartWidgetsSource, /aria-label=\{mode\.title\}/);
  assert.match(chartWidgetsSource, /aria-label="Auto-scale main price pane"/);
  assert.match(chartWidgetsSource, /aria-label="Invert scale"/);
  assert.match(chartWidgetsSource, /aria-label=\{button\.title\}/);
  assert.match(
    chartWidgetsSource,
    /aria-label=\{drawingCount \? `Remove all drawings \(\$\{drawingCount\}\)` : "No drawings to remove"\}/,
  );
});

test("the runtime token proxy produces distinct light and dark chart palettes", () => {
  const previousTheme = getCurrentTheme();
  try {
    setCurrentTheme("dark");
    const dark = getPanelPalette(T);
    setCurrentTheme("light");
    const light = getPanelPalette(T);
    assert.notDeepEqual(light, dark);
  } finally {
    setCurrentTheme(previousTheme);
  }
});

test("a chart identity without search intent is not rendered as a button", () => {
  assert.match(
    chartWidgetSharedSource,
    /if \(!canSearch\) \{[\s\S]*?return \([\s\S]*?<span/,
  );
  assert.doesNotMatch(
    chartWidgetSharedSource,
    /aria-label=\{canSearch \? `Search \$\{symbol\}` : symbol\}/,
  );
  assert.equal(typeof ChartSymbolSearchTrigger, "object");
});
