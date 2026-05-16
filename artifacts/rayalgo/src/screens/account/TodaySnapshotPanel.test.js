import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./TodaySnapshotPanel.jsx", import.meta.url), "utf8");

test("today snapshot panel exposes heatmap + intraday tabs", () => {
  assert.match(source, /value:\s*"heatmap"/);
  assert.match(source, /value:\s*"intraday"/);
});

test("today snapshot panel composes the two content components, not the legacy panels", () => {
  assert.match(source, /PositionTreemapContent/);
  assert.match(source, /IntradayPnlContent/);
  assert.doesNotMatch(source, /PositionTreemapPanel\s*\}/);
  assert.doesNotMatch(source, /IntradayPnlPanel\s*\}/);
});

test("today snapshot panel handles per-tab loading and error states", () => {
  assert.match(source, /positionsQuery\?\.isLoading/);
  assert.match(source, /positionsQuery\?\.error/);
  assert.match(source, /intradayQuery\?\.isLoading/);
  assert.match(source, /intradayQuery\?\.error/);
});
