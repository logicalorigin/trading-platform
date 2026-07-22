import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (name) =>
  readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

const toggleFiles = [
  "PositionsPanel.jsx",
  "AccountReturnsPanel.jsx",
  "TradesOrdersPanel.jsx",
  "TodaySnapshotPanel.jsx",
  "PositionTreemapPanel.jsx",
];

const segmentedFiles = [
  "EquityCurvePanel.jsx",
  "TradingAnalysisWorkbench.jsx",
];

const openingTags = (source, component) =>
  source.match(new RegExp(`<${component}\\b[\\s\\S]*?\\/>`, "g")) ?? [];

test("Account toggle groups forward labelled radiogroup semantics", () => {
  const accountUtils = readSource("accountUtils.jsx");
  assert.match(accountUtils, /export const ToggleGroup = \(\{[\s\S]*ariaLabel[\s\S]*radioGroup/);
  assert.match(accountUtils, /<SegmentedControl[\s\S]*ariaLabel=\{ariaLabel\}[\s\S]*radioGroup=\{radioGroup\}/);

  for (const file of toggleFiles) {
    const tags = openingTags(readSource(file), "ToggleGroup");
    assert.ok(tags.length > 0, `${file} has no ToggleGroup controls`);
    for (const tag of tags) {
      assert.match(tag, /ariaLabel=/, `${file} has an unnamed ToggleGroup: ${tag}`);
      assert.match(tag, /\bradioGroup\b/, `${file} has non-radio toggle semantics: ${tag}`);
    }
  }
});

test("Account segmented selectors are labelled radiogroups, not orphan tabs", () => {
  for (const file of segmentedFiles) {
    const source = readSource(file);
    const tags = openingTags(source, "SegmentedControl");
    assert.ok(tags.length > 0, `${file} has no SegmentedControl controls`);
    for (const tag of tags) {
      assert.match(tag, /ariaLabel=/, `${file} has an unnamed segmented control: ${tag}`);
      assert.match(tag, /\bradioGroup\b/, `${file} has orphan tab semantics: ${tag}`);
    }
    assert.doesNotMatch(source, /role="tabpanel"/);
  }
});
