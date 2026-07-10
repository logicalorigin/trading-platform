import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildAlgoAccountPositionsResponse,
  filterAccountPositionRowsForDeployment,
} from "./algoAccountPositions.js";

const source = readFileSync(
  new URL("./OperationsPositionsTable.jsx", import.meta.url),
  "utf8",
);

test("algo position scoping keeps only canonical deployment attribution", () => {
  const direct = { id: "direct", deploymentId: "deployment-1" };
  const source = { id: "source", sourceDeploymentId: "deployment-1" };
  const attributed = {
    id: "attributed",
    sourceAttribution: [{ deploymentId: "deployment-1" }],
  };
  const other = { id: "other", deploymentId: "deployment-2" };
  const rows = [direct, source, attributed, other];

  assert.deepEqual(
    filterAccountPositionRowsForDeployment({
      rows,
      deploymentId: "deployment-1",
    }),
    [direct, source, attributed],
  );
  assert.equal(filterAccountPositionRowsForDeployment({ rows }), rows);

  assert.deepEqual(
    buildAlgoAccountPositionsResponse([
      { marketValue: 125, unrealizedPnl: 20, dayChange: 4, weightPercent: 12.5 },
      { marketValue: -50, unrealizedPnl: -5, dayChange: -2, weightPercent: -5 },
    ]).totals,
    {
      netExposure: 75,
      grossLong: 125,
      grossShort: -50,
      unrealizedPnl: 15,
      dayChange: 2,
      weightPercent: 7.5,
    },
  );
});

test("algo broker positions register the same live quote demand as Accounts", () => {
  const positionsPanelUsage = source.match(
    /<PositionsPanel[\s\S]*?surfaceId="algo"[\s\S]*?\/>/,
  )?.[0];

  assert.ok(positionsPanelUsage, "Missing algo PositionsPanel usage");
  assert.match(
    positionsPanelUsage,
    /streamLiveOptionQuotes=\{!filterByDeployment\}/,
  );
  assert.match(positionsPanelUsage, /optionQuoteStreamOwner="algo-position-option-quotes"/);
  assert.match(positionsPanelUsage, /optionQuoteStreamIntent="automation-live"/);
  assert.match(
    positionsPanelUsage,
    /registerMarketDataSymbols=\{!filterByDeployment\}/,
  );
});

test("algo operations positions use the canonical account query without runtime substitution", () => {
  assert.match(source, /filterByDeployment = true/);
  assert.match(source, /sourceLabel = "Shadow algo positions"/);
  assert.match(
    source,
    /filterByDeployment\s*\?\s*filterAccountPositionRowsForDeployment\(\{[\s\S]*?rows: accountRows,[\s\S]*?deploymentId,[\s\S]*?\}\)\s*:\s*accountRows/,
  );
  assert.match(source, /const query = useMemo\(\s*\(\) => \(\{\s*\.\.\.accountPositionsQuery,/);
  assert.match(
    source,
    /data: accountPositionsQuery\?\.data\s*\?\s*\{[\s\S]*?positions: scopedAccountRows,[\s\S]*?\}\s*:\s*accountPositionsQuery\?\.data,/,
  );
  assert.doesNotMatch(source, /Runtime algo positions/);
  assert.doesNotMatch(source, /buildAlgoAccountPositionRows/);
  assert.doesNotMatch(source, /getStoredOptionQuoteSnapshot/);
  assert.doesNotMatch(source, /useAccountPositionRows/);

  const positionsPanelUsage = source.match(
    /<PositionsPanel[\s\S]*?surfaceId="algo"[\s\S]*?\/>/,
  )?.[0];
  assert.ok(positionsPanelUsage, "Missing algo PositionsPanel usage");
  assert.match(positionsPanelUsage, /rightRail=\{sourceLabel\}/);
});
