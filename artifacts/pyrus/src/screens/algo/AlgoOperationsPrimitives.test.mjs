import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AlgoIndicatorKpiTable,
  buildAlgoPipelinePhases,
  buildIndicatorKpiTableRows,
  buildScoreBucketAuditMatrix,
  buildScoreCalibrationSummary,
  buildScoreOutcomeGroupedTable,
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
    byScoreBucket: {
      high: { signalCount: 30, avgDirectionalMovePercent: 0.5 },
      standard: { signalCount: 40, avgDirectionalMovePercent: 0.1 },
      low: { signalCount: 20, avgDirectionalMovePercent: -0.6 },
      unknown: { signalCount: 0 },
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
  assert.deepEqual(
    rows.map((row) => row.group),
    ["direction", "direction", "direction"],
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

test("buildScoreBucketAuditMatrix shows every 10-point score bucket as a column", () => {
  const metrics = {
    signalCount: 12,
    scoreBuckets: [
      {
        key: "90-100",
        label: "90-100",
        min: 90,
        max: 100,
        signalCount: 1,
        avgDirectionalMovePercent: 1.2,
        expectancyPercent: 0.7,
        moveTimeline: [{ bar: 1, avgMovePercent: 0.4, observationCount: 1 }],
      },
      {
        key: "80-90",
        label: "80-90",
        min: 80,
        max: 90,
        signalCount: 2,
      },
      {
        key: "70-80",
        label: "70-80",
        min: 70,
        max: 80,
        signalCount: 3,
      },
      {
        key: "60-70",
        label: "60-70",
        min: 60,
        max: 70,
        signalCount: 4,
      },
      {
        key: "50-60",
        label: "50-60",
        min: 50,
        max: 60,
        signalCount: 5,
      },
      {
        key: "unknown",
        label: "Unknown",
        signalCount: 1,
      },
    ],
  };

  const matrix = buildScoreBucketAuditMatrix(metrics);
  assert.deepEqual(
    matrix.buckets.map((bucket) => bucket.key),
    [
      "90-100",
      "80-90",
      "70-80",
      "60-70",
      "50-60",
      "40-50",
      "30-40",
      "20-30",
      "10-20",
      "0-10",
      "unknown",
    ],
  );
  assert.deepEqual(
    matrix.rows.map((row) => row.key),
    ["signals", "medianMove", "avgMove", "correctness", "expectancy", "excursion", "path"],
  );

  const topBucket = matrix.buckets.find((bucket) => bucket.key === "90-100");
  assert.equal(topBucket.signalCount, 1);
  assert.equal(topBucket.avgMovePercent, 1.2);
  assert.equal(topBucket.expectancyPercent, 0.7);
  assert.deepEqual(topBucket.moveTimeline, [
    { bar: 1, avgMovePercent: 0.4, observationCount: 1 },
  ]);
});

test("buildScoreBucketAuditMatrix keeps empty score bucket columns visible", () => {
  const matrix = buildScoreBucketAuditMatrix({
    signalCount: 17,
    scoreBuckets: [
      { key: "90-100", label: "90-100", min: 90, max: 100, signalCount: 0 },
      { key: "80-90", label: "80-90", min: 80, max: 90, signalCount: 0 },
      { key: "70-80", label: "70-80", min: 70, max: 80, signalCount: 0 },
      { key: "60-70", label: "60-70", min: 60, max: 70, signalCount: 7 },
      { key: "50-60", label: "50-60", min: 50, max: 60, signalCount: 6 },
      { key: "40-50", label: "40-50", min: 40, max: 50, signalCount: 4 },
      { key: "30-40", label: "30-40", min: 30, max: 40, signalCount: 0 },
    ],
  });

  assert.deepEqual(
    matrix.buckets.map((bucket) => bucket.key),
    [
      "90-100",
      "80-90",
      "70-80",
      "60-70",
      "50-60",
      "40-50",
      "30-40",
      "20-30",
      "10-20",
      "0-10",
    ],
  );
  assert.equal(matrix.buckets.find((bucket) => bucket.key === "90-100").signalCount, 0);
  assert.equal(matrix.buckets.find((bucket) => bucket.key === "60-70").signalCount, 7);
});

test("buildScoreBucketAuditMatrix appends unknown only when populated", () => {
  const metrics = {
    signalCount: 8,
    scoreBuckets: [
      { key: "90-100", label: "90-100", min: 90, max: 100, signalCount: 1 },
      { key: "80-90", label: "80-90", min: 80, max: 90, signalCount: 1 },
      { key: "70-80", label: "70-80", min: 70, max: 80, signalCount: 1 },
      { key: "60-70", label: "60-70", min: 60, max: 70, signalCount: 1 },
      { key: "50-60", label: "50-60", min: 50, max: 60, signalCount: 1 },
      { key: "40-50", label: "40-50", min: 40, max: 50, signalCount: 1 },
      { key: "30-40", label: "30-40", min: 30, max: 40, signalCount: 0 },
      { key: "20-30", label: "20-30", min: 20, max: 30, signalCount: 0 },
      { key: "10-20", label: "10-20", min: 10, max: 20, signalCount: 0 },
      { key: "0-10", label: "0-10", min: 0, max: 10, signalCount: 0 },
      { key: "unknown", label: "Unknown", signalCount: 1 },
    ],
  };

  const expandedMatrix = buildScoreBucketAuditMatrix(metrics);
  assert.deepEqual(
    expandedMatrix.buckets.map((bucket) => bucket.key),
    [
      "90-100",
      "80-90",
      "70-80",
      "60-70",
      "50-60",
      "40-50",
      "30-40",
      "20-30",
      "10-20",
      "0-10",
      "unknown",
    ],
  );
});

test("buildScoreCalibrationSummary exposes calibrated and gated states", () => {
  const calibrated = buildScoreCalibrationSummary({
    scoreModelComparisons: {
      calibration: {
        state: "calibrated",
        recommendedModelKey: "sot-outcome-v1",
        candidateModelKey: "sot-outcome-v1",
        supportedModelCount: 2,
        reasons: [],
      },
    },
  });
  assert.equal(calibrated.text, "Calibrated: SOT OUTCOME V1");
  assert.equal(calibrated.modelKey, "sot-outcome-v1");
  assert.equal(calibrated.supportedModelCount, 2);

  const sparse = buildScoreCalibrationSummary({
    scoreModelComparisons: {
      calibration: {
        state: "needs_more_data",
        recommendedModelKey: null,
        candidateModelKey: "balanced-sot-v2",
        supportedModelCount: 0,
        reasons: ["min_observation_count", "min_lower_baseline_signal_count"],
      },
    },
  });
  assert.equal(sparse.text, "Needs more data: sample, baseline");
  assert.deepEqual(sparse.reasonLabels, ["sample", "baseline"]);

  const coverage = buildScoreCalibrationSummary({
    scoreModelComparisons: {
      calibration: {
        state: "uncalibrated",
        recommendedModelKey: null,
        candidateModelKey: "balanced-sot-v2",
        supportedModelCount: 0,
        reasons: ["coverage_degraded", "min_alignment_score"],
      },
    },
  });
  assert.equal(coverage.text, "Uncalibrated: coverage, alignment");
  assert.deepEqual(coverage.reasonLabels, ["coverage", "alignment"]);
});

test("buildScoreOutcomeGroupedTable groups score buckets into All/Buy/Sell signal rows", () => {
  const table = buildScoreOutcomeGroupedTable({
    signalCount: 12,
    avgDirectionalMovePercent: 0.2,
    scoreBuckets: [
      {
        key: "90-100",
        label: "90-100",
        min: 90,
        max: 100,
        signalCount: 3,
        byDirection: {
          buy: { signalCount: 2, expectancyPercent: 0.4 },
          sell: { signalCount: 1, expectancyPercent: -0.1 },
        },
      },
      {
        key: "80-90",
        label: "80-90",
        min: 80,
        max: 90,
        signalCount: 2,
        byDirection: {
          buy: { signalCount: 0 },
          sell: { signalCount: 2, expectancyPercent: 0.2 },
        },
      },
      { key: "70-80", label: "70-80", min: 70, max: 80, signalCount: 3 },
      { key: "60-70", label: "60-70", min: 60, max: 70, signalCount: 4 },
      { key: "50-60", label: "50-60", min: 50, max: 60, signalCount: 5 },
    ],
  });

  assert.deepEqual(
    table.scoreBuckets.map((bucket) => bucket.key),
    [
      "90-100",
      "80-90",
      "70-80",
      "60-70",
      "50-60",
      "40-50",
      "30-40",
      "20-30",
      "10-20",
      "0-10",
    ],
  );
  assert.equal(table.scoreSubcolumnCount, 10);
  assert.deepEqual(
    table.bucketBreakdownRows.map((row) => row.key),
    ["all", "buy", "sell"],
  );

  const [all, buy, sell] = table.bucketBreakdownRows;
  assert.deepEqual(
    all.buckets.slice(0, 2).map((bucket) => [bucket.key, bucket.signalCount]),
    [
      ["90-100", 3],
      ["80-90", 2],
    ],
  );
  assert.deepEqual(
    buy.buckets.slice(0, 2).map((bucket) => [bucket.key, bucket.signalCount]),
    [
      ["90-100", 2],
      ["80-90", 0],
    ],
  );
  assert.deepEqual(
    sell.buckets.slice(0, 2).map((bucket) => [
      bucket.key,
      bucket.signalCount,
      bucket.expectancyPercent,
    ]),
    [
      ["90-100", 1, -0.1],
      ["80-90", 2, 0.2],
    ],
  );
});

test("AlgoIndicatorKpiTable renders KPI metric groups with score buckets as sub-columns", () => {
  const html = renderToStaticMarkup(
    React.createElement(AlgoIndicatorKpiTable, {
      metrics: {
        signalCount: 12,
        avgDirectionalMovePercent: 0.2,
        scoreBuckets: [
          {
            key: "90-100",
            label: "90-100",
            min: 90,
            max: 100,
            signalCount: 1,
            byDirection: {
              buy: { signalCount: 1 },
              sell: { signalCount: 0 },
            },
          },
          {
            key: "80-90",
            label: "80-90",
            min: 80,
            max: 90,
            signalCount: 2,
            byDirection: {
              buy: { signalCount: 0 },
              sell: { signalCount: 2 },
            },
          },
          {
            key: "70-80",
            label: "70-80",
            min: 70,
            max: 80,
            signalCount: 3,
          },
          {
            key: "60-70",
            label: "60-70",
            min: 60,
            max: 70,
            signalCount: 4,
          },
        ],
        scoreModelComparisons: {
          calibration: {
            state: "calibrated",
            recommendedModelKey: "sot-outcome-v1",
            candidateModelKey: "sot-outcome-v1",
            supportedModelCount: 1,
            reasons: [],
          },
        },
      },
    }),
  );

  assert.equal((html.match(/<table/g) ?? []).length, 1);
  assert.equal((html.match(/role="table"/g) ?? []).length, 0);
  assert.match(html, /data-testid="algo-indicator-kpi-metric-table"/);
  assert.match(html, />Signal</);
  // KPI metrics are the top-level column groups (each spans its sub-columns).
  assert.match(html, />Signals</);
  assert.match(html, />Median</);
  assert.match(html, />Avg Move</);
  assert.match(html, />Correct</);
  assert.match(html, />Excursion</);
  // Expect column removed (redundant with Avg Move).
  assert.doesNotMatch(html, />Expect</);
  assert.match(html, /colspan=/i);
  // Rows = All/Buy/Sell.
  assert.match(html, /data-testid="algo-kpi-row-all"/);
  assert.match(html, /data-testid="algo-kpi-row-buy"/);
  assert.match(html, /data-testid="algo-kpi-row-sell"/);
  // Each metric has an "All" aggregate sub-column plus one sub-column per bucket.
  assert.match(html, /data-testid="algo-kpi-cell-all-signals-all"/);
  assert.match(html, /data-testid="algo-kpi-cell-all-avgMove-all"/);
  assert.match(html, /data-testid="algo-kpi-cell-all-avgMove-90-100"/);
  assert.match(html, /data-testid="algo-kpi-cell-all-avgMove-60-70"/);
  assert.match(html, /data-testid="algo-kpi-cell-sell-correctness-80-90"/);
  assert.doesNotMatch(html, /data-testid="algo-kpi-cell-all-expectancy-all"/);
  // Score buckets are sub-columns (60-100 by default); sub-60 hidden until "Show all".
  assert.doesNotMatch(html, /data-testid="algo-kpi-cell-all-avgMove-50-60"/);
  assert.doesNotMatch(html, /data-testid="algo-kpi-cell-all-signals-0-10"/);
  assert.match(html, /data-testid="algo-score-calibration-summary"/);
  assert.match(html, /Calibrated: SOT OUTCOME V1/);
  assert.doesNotMatch(html, /<select/);
  assert.match(html, /data-testid="algo-kpi-score-range-toggle"/);
  assert.match(html, />Show all scores</);
  assert.match(html, /overflow-x:auto/);
});

test("AlgoIndicatorKpiTable keeps empty bucket state inside the dense score grid", () => {
  const html = renderToStaticMarkup(
    React.createElement(AlgoIndicatorKpiTable, {
      metrics: {
        signalCount: 0,
        scoreBuckets: [],
      },
    }),
  );

  assert.match(html, /data-testid="algo-kpi-row-all"/);
  assert.match(html, /data-testid="algo-kpi-cell-all-signals-all"/);
  assert.match(html, /data-testid="algo-kpi-cell-all-signals-90-100"/);
  assert.match(html, /No signals yet/);
  assert.match(html, /overflow-x:auto/);
  assert.doesNotMatch(html, /overflow-x:hidden/);
});

test("buildIndicatorKpiTableRows tolerates missing metrics / byDirection / byScoreBucket", () => {
  const rows = buildIndicatorKpiTableRows(null);
  assert.deepEqual(
    rows.map((row) => row.key),
    ["all", "buy", "sell"],
  );
  for (const row of rows) {
    assert.equal(row.signalCount, 0);
    assert.equal(row.avgMovePercent, undefined);
    assert.equal(row.avgMfePercent, undefined);
  }
});

test("buildScoreBucketAuditMatrix falls back to legacy score buckets", () => {
  const matrix = buildScoreBucketAuditMatrix({
    signalCount: 5,
    byScoreBucket: {
      high: { signalCount: 2 },
      standard: { signalCount: 1 },
      low: { signalCount: 1 },
      unknown: { signalCount: 1 },
    },
  });
  assert.deepEqual(
    matrix.buckets.map((bucket) => bucket.key),
    ["high", "standard", "low", "unknown"],
  );
  const unknown = matrix.buckets.find((bucket) => bucket.key === "unknown");
  assert.ok(unknown, "Unknown column present when populated");
  assert.equal(unknown.signalCount, 1);
});

test("buildScoreOutcomeGroupedTable hides sub-threshold score buckets when scoreDisplayThreshold is set", () => {
  const metrics = {
    signalCount: 6,
    scoreBuckets: [
      { key: "90-100", label: "90-100", min: 90, max: 100, signalCount: 1 },
      { key: "60-70", label: "60-70", min: 60, max: 70, signalCount: 2 },
      { key: "50-60", label: "50-60", min: 50, max: 60, signalCount: 3 },
      { key: "0-10", label: "0-10", min: 0, max: 10, signalCount: 4 },
    ],
  };

  const filtered = buildScoreOutcomeGroupedTable(metrics, {
    scoreDisplayThreshold: 60,
  });
  const filteredKeys = filtered.scoreBuckets.map((bucket) => bucket.key);
  assert.ok(filteredKeys.every((key) => Number(key.split("-")[0]) >= 60));
  assert.ok(filteredKeys.includes("60-70"));
  assert.ok(!filteredKeys.includes("50-60"));
  assert.ok(!filteredKeys.includes("0-10"));
  assert.equal(filtered.scoreSubcolumnCount, filtered.scoreBuckets.length);
  for (const row of filtered.bucketBreakdownRows) {
    assert.deepEqual(
      row.buckets.map((bucket) => bucket.key),
      filteredKeys,
    );
  }

  // No threshold (the "Show all scores" toggle path) restores every bucket.
  const all = buildScoreOutcomeGroupedTable(metrics);
  const allKeys = all.scoreBuckets.map((bucket) => bucket.key);
  assert.ok(allKeys.includes("50-60"));
  assert.ok(allKeys.includes("0-10"));
  assert.equal(all.scoreBuckets.length, 10);
});

test("buildScoreOutcomeGroupedTable keeps legacy score buckets even when a threshold is set", () => {
  const legacy = buildScoreOutcomeGroupedTable(
    {
      signalCount: 4,
      byScoreBucket: {
        high: { signalCount: 2 },
        standard: { signalCount: 1 },
        low: { signalCount: 1 },
      },
    },
    { scoreDisplayThreshold: 60 },
  );
  assert.deepEqual(
    legacy.scoreBuckets.map((bucket) => bucket.key),
    ["high", "standard", "low"],
  );
});
