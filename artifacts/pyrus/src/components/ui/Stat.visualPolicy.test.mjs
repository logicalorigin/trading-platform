import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const stat = readFileSync(new URL("./Stat.jsx", import.meta.url), "utf8");

const statRegions = () => {
  const labelStart = stat.indexOf("{label ? (");
  const valueStart = stat.indexOf("\n      <div", labelStart);
  const detailStart = stat.indexOf("{detail ? (", valueStart);

  assert.notEqual(labelStart, -1, "missing optional label region");
  assert.notEqual(valueStart, -1, "missing canonical value region");
  assert.notEqual(detailStart, -1, "missing optional detail region");

  return {
    label: stat.slice(labelStart, valueStart),
    value: stat.slice(valueStart, detailStart),
    detail: stat.slice(detailStart),
  };
};

test("shared Stat applies the data voice only to its canonical value", () => {
  const { label, value, detail } = statRegions();

  assert.match(label, /fontFamily: T\.sans,/u);
  assert.doesNotMatch(label, /fontFamily: T\.data|fontVariantNumeric/u);
  assert.match(value, /fontFamily: T\.data,/u);
  assert.match(value, /fontVariantNumeric: "tabular-nums",/u);
  assert.doesNotMatch(value, /fontFamily: T\.sans/u);
  assert.match(detail, /fontFamily: T\.sans,/u);
  assert.doesNotMatch(detail, /fontFamily: T\.data|fontVariantNumeric/u);
});

test("shared Stat preserves label, value ReactNode, and detail structure", () => {
  const { label, value, detail } = statRegions();

  assert.match(label, /^\{label \? \([\s\S]*\{label\}[\s\S]*\) : null\}/u);
  assert.match(value, />\s*\{value\}\s*<\/div>\s*$/u);
  assert.match(detail, /^\{detail \? \([\s\S]*\{detail\}[\s\S]*\) : null\}/u);
});
