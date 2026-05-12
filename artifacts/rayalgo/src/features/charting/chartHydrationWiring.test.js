import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Trade spot chart wires pan and zoom history hydration through the shared planner", () => {
  const source = readSource("../trade/TradeEquityPanel.jsx");

  assert.match(source, /useProgressiveChartBarLimit\(\{/);
  assert.match(source, /useUnderfilledChartBackfill\(\{/);
  assert.match(source, /chartHydrationRole = "primary"/);
  assert.match(source, /normalizeChartHydrationRole\(chartHydrationRole\)/);
  assert.match(source, /resolveChartHydrationRequestPolicy\(\{/);
  assert.match(source, /role:\s*effectiveChartHydrationRole/);
  assert.match(source, /intervalChangeRevision/);
  assert.match(source, /setIntervalChangeRevision\(\(revision\) => revision \+ 1\)/);
  assert.match(source, /viewportLayoutKey=\{chartViewportLayoutKey\}/);
  assert.match(source, /progressiveBars\.expandForVisibleRange\(range,\s*bars\.length,\s*\{/);
  assert.match(source, /isHydratingRequestedWindow:/);
  assert.match(source, /isPrependingOlder:\s*prependableBars\.isPrependingOlder/);
  assert.match(source, /hasExhaustedOlderHistory:\s*prependableBars\.hasExhaustedOlderHistory/);
  assert.match(source, /prependOlderBars:\s*prependableBars\.prependOlderBars/);
  assert.match(source, /recheckKey:\s*\[/);
  assert.match(source, /onVisibleLogicalRangeChange=\{handleVisibleLogicalRangeChange\}/);
});

test("Trade option chart wires pan and zoom history hydration through the shared planner", () => {
  const source = readSource("../../screens/TradeScreen.jsx");

  assert.match(source, /const optionProgressiveBars = useProgressiveChartBarLimit\(\{/);
  assert.match(source, /useUnderfilledChartBackfill\(\{/);
  assert.match(source, /optionChartIntervalRevision/);
  assert.match(source, /handleOptionChartTimeframeChange/);
  assert.match(source, /viewportLayoutKey=\{optionChartViewportLayoutKey\}/);
  assert.match(source, /optionProgressiveBars\.expandForVisibleRange\(range,\s*displayBars\.length,\s*\{/);
  assert.match(source, /isHydratingRequestedWindow:/);
  assert.match(source, /isPrependingOlder/);
  assert.match(source, /hasExhaustedOlderHistory/);
  assert.match(source, /prependOlderBars/);
  assert.match(source, /recheckKey:\s*\[/);
  assert.match(source, /outsideRth:\s*DISPLAY_CHART_OUTSIDE_RTH/);
  assert.match(source, /onVisibleLogicalRangeChange=\{scheduleOptionVisibleRangeExpansion\}/);
});

test("Flow option inspection chart wires pan and zoom history hydration through the shared planner", () => {
  const source = readSource("../flow/ContractDetailInline.jsx");

  assert.match(source, /const optionProgressiveBars = useProgressiveChartBarLimit\(\{/);
  assert.match(source, /useUnderfilledChartBackfill\(\{/);
  assert.match(source, /optionChartIntervalRevision/);
  assert.match(source, /handleOptionChartTimeframeChange/);
  assert.match(source, /viewportLayoutKey=\{optionChartViewportLayoutKey\}/);
  assert.match(source, /optionProgressiveBars\.expandForVisibleRange\(range,\s*optionDisplayBars\.length,\s*\{/);
  assert.match(source, /isHydratingRequestedWindow:/);
  assert.match(source, /isPrependingOlder/);
  assert.match(source, /hasExhaustedOlderHistory/);
  assert.match(source, /prependOlderBars/);
  assert.match(source, /recheckKey:\s*\[/);
  assert.match(source, /outsideRth:\s*DISPLAY_CHART_OUTSIDE_RTH/);
  assert.match(source, /onVisibleLogicalRangeChange=\{scheduleOptionVisibleRangeExpansion\}/);
});
