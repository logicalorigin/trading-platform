import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (relativePath) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

const primitives = readSource("./primitives.jsx");
const stat = readSource("../ui/Stat.jsx");
const watchlist = readSource("../../features/platform/PlatformWatchlist.jsx");
const accountStrip = readSource("../../features/platform/HeaderAccountStrip.jsx");
const kpiStrip = readSource("../../features/platform/HeaderKpiStrip.jsx");

const between = (source, start, end) =>
  source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

test("shared fields use the data font for numeric and temporal input types", () => {
  const dataFieldTypes = between(
    primitives,
    "const DATA_TEXT_FIELD_TYPES",
    "export const TextField",
  );
  const textField = between(primitives, "export const TextField", "/**\n * Select");

  for (const type of ["date", "datetime-local", "month", "number", "time", "week"]) {
    assert.match(dataFieldTypes, new RegExp(`"${type}"`));
  }
  assert.doesNotMatch(dataFieldTypes, /"search"|"text"/);
  assert.match(
    textField,
    /fontFamily: DATA_TEXT_FIELD_TYPES\.has\(type\) \? T\.data : T\.sans/,
  );
});

test("shared stat and gauge values use the data font while labels stay sans", () => {
  const gauge = between(primitives, "export const RadialStrokeGauge", "/**\n * Variant surface");

  assert.match(gauge, /fill=\{valueColor\}[\s\S]{0,160}fontFamily=\{T\.data\}/);
  assert.match(gauge, /fill=\{levelColor \|\| tone\}[\s\S]{0,160}fontFamily=\{T\.sans\}/);
  assert.match(stat, /\{label \? \([\s\S]{0,180}fontFamily: T\.sans/);
  assert.match(stat, /color: valueColor,[\s\S]{0,80}fontFamily: T\.data/);
});

test("watchlist and header financial values use the data font", () => {
  assert.match(
    watchlist,
    /data-testid="watchlist-day-change"[\s\S]{0,220}fontFamily: T\.data/,
  );
  assert.match(
    watchlist,
    /data-testid="watchlist-extended-hours"[\s\S]{0,500}fontFamily: T\.data/,
  );
  const displayedPrices = [
    ...watchlist.matchAll(/\{formatQuotePrice\(displayedPrice\)\}/g),
  ];
  assert.equal(displayedPrices.length, 2);
  for (const displayedPrice of displayedPrices) {
    assert.match(
      watchlist.slice(Math.max(0, displayedPrice.index - 450), displayedPrice.index),
      /fontFamily: T\.data/,
    );
  }
  assert.match(
    between(accountStrip, "const labelStyle = {", "const valueStyle = {"),
    /fontFamily: T\.sans/,
  );
  assert.match(
    between(accountStrip, "const valueStyle = {", "const surfaceStyle = {"),
    /fontFamily: T\.data/,
  );
  assert.equal((kpiStrip.match(/fontFamily: T\.data/g) || []).length, 2);
});
