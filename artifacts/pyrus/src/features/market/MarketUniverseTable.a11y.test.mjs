import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./MarketUniverseTable.jsx", import.meta.url),
  "utf8",
);

test("rounded options premium shares always total 100 percent", () => {
  const flowHeatCell = source.slice(
    source.indexOf("const FlowHeatCell"),
    source.indexOf("export default function MarketUniverseTable"),
  );

  assert.match(flowHeatCell, /const callPercent = Math\.round\(row\.bullShare \* 100\)/);
  assert.match(flowHeatCell, /\$\{100 - callPercent\}% puts/);
  assert.doesNotMatch(flowHeatCell, /Math\.round\(\(1 - row\.bullShare\) \* 100\)/);
});
