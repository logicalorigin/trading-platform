import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  GEX_GLOSSARY,
  formatGexGlossaryTooltip,
  getGexGlossaryEntry,
} from "./gexGlossary.js";

const screenSource = readFileSync(
  new URL("../../screens/GexScreen.jsx", import.meta.url),
  "utf8",
);

test("every GEX_GLOSSARY entry has a label, definition, and interpretation", () => {
  const entries = Object.entries(GEX_GLOSSARY);
  assert.ok(entries.length > 0, "glossary must not be empty");
  for (const [key, entry] of entries) {
    assert.ok(entry.label, `${key} missing label`);
    assert.ok(entry.definition, `${key} missing definition`);
    assert.ok(entry.interpretation, `${key} missing interpretation`);
  }
});

test("getGexGlossaryEntry returns null for unknown keys", () => {
  assert.equal(getGexGlossaryEntry("nonexistent"), null);
});

test("formatGexGlossaryTooltip concatenates definition and interpretation", () => {
  const text = formatGexGlossaryTooltip("netGex");
  assert.match(text, /Net Gamma Exposure/);
  assert.match(text, /dampening/);
});

test("every glossary key referenced from GexScreen.jsx exists in GEX_GLOSSARY", () => {
  const matches = screenSource.matchAll(/glossaryKey=["']([^"']+)["']/g);
  const referenced = new Set();
  for (const match of matches) {
    referenced.add(match[1]);
  }
  for (const key of referenced) {
    assert.ok(
      key in GEX_GLOSSARY,
      `GexScreen.jsx references glossary key "${key}" but it's missing from GEX_GLOSSARY`,
    );
  }
});

test("GexScreen.jsx surfaces glossary tooltips on the primary metrics", () => {
  const expectedKeys = [
    "netGex",
    "callGex",
    "putGex",
    "totalGex",
    "callWall",
    "putWall",
    "zeroGamma",
    "concentration0dte",
    "concentrationWeekly",
    "concentrationMonthly",
  ];
  for (const key of expectedKeys) {
    assert.match(
      screenSource,
      new RegExp(`glossaryKey=["']${key}["']`),
      `GexScreen.jsx missing glossaryKey="${key}"`,
    );
  }
});

test("GexScreen.jsx mounts the heatmap color legend", () => {
  assert.match(screenSource, /<HeatmapColorLegend\b/);
  assert.match(screenSource, /heatmapColors/);
});
