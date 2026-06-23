import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAlgoPipelinePhases,
  buildIndicatorKpiTableRows,
  resolveAlgoPipelineGridTemplate,
} from "./AlgoOperationsPrimitives.jsx";

test("Signal Cycle phase describes received signals", () => {
  const phases = buildAlgoPipelinePhases([
    { id: "scan_universe", status: "healthy", count: 28 },
    { id: "signal_detected", status: "healthy", count: 8 },
    { id: "action_mapped", status: "healthy", count: 3 },
    { id: "contract_selected", status: "healthy", count: 2 },
    { id: "liquidity_risk_gate", status: "healthy", count: 0 },
  ]);

  const signalCycle = phases.find((phase) => phase.id === "signal-cycle");
  const entryPath = phases.find((phase) => phase.id === "entry-path");

  assert.equal(signalCycle?.count, "8");
  assert.equal(signalCycle?.detail, "28 symbols -> 8 STA rows");
  assert.equal(entryPath?.count, "2");
  assert.equal(entryPath?.detail, "3 actions -> 2 contracts");
});

test("algo pipeline overview uses packed intrinsic tracks outside phone layouts", () => {
  assert.equal(
    resolveAlgoPipelineGridTemplate({ pocket: false, dense: false }),
    "repeat(auto-fit, minmax(120px, max-content))",
  );
  assert.equal(
    resolveAlgoPipelineGridTemplate({ pocket: false, dense: true }),
    "repeat(auto-fit, minmax(104px, max-content))",
  );
  assert.equal(
    resolveAlgoPipelineGridTemplate({ pocket: true, dense: true }),
    "repeat(auto-fit, minmax(150px, 1fr))",
  );
});

test("buildIndicatorKpiTableRows maps All/Buy/Sell rows from overall + byDirection", () => {
  const metrics = {
    signalCount: 90,
    avgDirectionalMovePercent: -0.13,
    medianDirectionalMovePercent: -0.1,
    correctnessPercent: 49,
    expectancyPercent: -0.13,
    avgMfePercent: 1.7,
    avgMaePercent: -1.8,
    byDirection: {
      buy: {
        signalCount: 51,
        avgDirectionalMovePercent: 0.82,
        medianDirectionalMovePercent: 0.7,
        correctnessPercent: 64,
        expectancyPercent: 0.21,
        avgMfePercent: 1.5,
        avgMaePercent: -2.0,
      },
      sell: {
        signalCount: 39,
        avgDirectionalMovePercent: -0.41,
        medianDirectionalMovePercent: -0.3,
        correctnessPercent: 58,
        expectancyPercent: -0.05,
        avgMfePercent: 2.0,
        avgMaePercent: -1.6,
      },
    },
  };

  const rows = buildIndicatorKpiTableRows(metrics);
  assert.deepEqual(
    rows.map((row) => row.key),
    ["all", "buy", "sell"],
  );
  assert.deepEqual(
    rows.map((row) => row.label),
    ["All", "Buy", "Sell"],
  );

  const [all, buy, sell] = rows;
  // All row reads overall fields (avgDirectionalMovePercent -> avgMovePercent).
  assert.equal(all.signalCount, 90);
  assert.equal(all.avgMovePercent, -0.13);
  assert.equal(all.medianMovePercent, -0.1);
  assert.equal(buy.medianMovePercent, 0.7);
  assert.equal(sell.medianMovePercent, -0.3);
  assert.equal(all.correctnessPercent, 49);
  assert.equal(all.expectancyPercent, -0.13);
  assert.equal(all.avgMfePercent, 1.7);
  assert.equal(all.avgMaePercent, -1.8);
  // Buy/Sell read byDirection; the two directional counts reconstruct the total.
  assert.equal(buy.signalCount, 51);
  assert.equal(buy.avgMovePercent, 0.82);
  assert.equal(sell.signalCount, 39);
  assert.equal(sell.avgMovePercent, -0.41);
  assert.equal(buy.signalCount + sell.signalCount, all.signalCount);
});

test("buildIndicatorKpiTableRows tolerates missing metrics / byDirection", () => {
  const rows = buildIndicatorKpiTableRows(null);
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.equal(row.signalCount, 0);
    assert.equal(row.avgMovePercent, undefined);
    assert.equal(row.avgMfePercent, undefined);
  }
});
