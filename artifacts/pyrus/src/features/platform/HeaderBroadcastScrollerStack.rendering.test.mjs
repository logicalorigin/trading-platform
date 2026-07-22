import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./HeaderBroadcastScrollerStack.jsx", import.meta.url),
  "utf8",
);

test("the aria-hidden signal tape copy does not instantiate interactive tooltips", () => {
  assert.match(
    source,
    /<HeaderSignalIntervalContext[\s\S]*?tooltipsEnabled=\{!duplicate\}/,
  );
  assert.match(
    source,
    /const HeaderSignalIntervalContext = \(\{[\s\S]*?tooltipsEnabled = true,[\s\S]*?\}\) =>/,
  );
  assert.match(
    source,
    /return tooltipsEnabled \? \(\s*<AppTooltip[\s\S]*?\{pellet\}[\s\S]*?<\/AppTooltip>\s*\) : pellet;/,
  );
});

test("the header treats an explicitly stale Flow snapshot as stale while scanning", () => {
  assert.match(
    source,
    /const flowScanStale = Boolean\(\s*broadFlowSnapshot\.staleFlowEvents \|\|\s*flowCoverage\.stale \|\|/,
  );
  assert.match(source, /value=\{flowScanStale \? "STALE" : flowStatus\.toUpperCase\(\)\}/);
});
