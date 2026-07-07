import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./OperationsPositionsTable.jsx", import.meta.url),
  "utf8",
);

test("algo operations positions do not register stock underlyings into account position quote stream", () => {
  const positionsPanelUsage = source.match(
    /<PositionsPanel[\s\S]*?surfaceId="algo"[\s\S]*?\/>/,
  )?.[0];

  assert.ok(positionsPanelUsage, "Missing algo PositionsPanel usage");
  assert.match(positionsPanelUsage, /streamLiveOptionQuotes=\{false\}/);
  assert.match(positionsPanelUsage, /optionQuoteStreamOwner="algo-position-option-quotes"/);
  assert.match(positionsPanelUsage, /optionQuoteStreamIntent="automation-live"/);
  assert.match(positionsPanelUsage, /registerMarketDataSymbols=\{false\}/);
});

test("algo operations positions switch between shadow overlay and raw broker rows", () => {
  assert.match(source, /filterByDeployment = true/);
  assert.match(source, /sourceLabel = "Shadow algo positions"/);
  assert.match(
    source,
    /filterByDeployment\s*\?\s*filterAccountPositionRowsForDeployment\(\{[\s\S]*?rows: accountRows,[\s\S]*?deploymentId,[\s\S]*?\}\)\s*:\s*accountRows/,
  );
  assert.match(
    source,
    /const positionsSourceLabel = useAccountPositionRows\s*\?\s*sourceLabel\s*:\s*"Runtime algo positions"/,
  );

  const positionsPanelUsage = source.match(
    /<PositionsPanel[\s\S]*?surfaceId="algo"[\s\S]*?\/>/,
  )?.[0];
  assert.ok(positionsPanelUsage, "Missing algo PositionsPanel usage");
  assert.match(positionsPanelUsage, /rightRail=\{positionsSourceLabel\}/);
});
