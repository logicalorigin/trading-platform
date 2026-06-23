import assert from "node:assert/strict";
import test from "node:test";

import {
  alignSignalCycleStageWithStaTable,
  buildAlgoOptionQuoteStreamSubscription,
  resolveAlgoOverviewMetricGridTemplate,
  resolveAttentionSeverity,
  resolveHeaderScanWave,
} from "./AlgoLivePage.jsx";

test("algo header does not show warning for info-only options session pause", () => {
  const attentionSeverity = resolveAttentionSeverity([
    {
      severity: "info",
      summary: "Options session is closed.",
      detail: "Options strategy execution is outside the regular options session.",
    },
  ]);

  const wave = resolveHeaderScanWave({
    deploymentEnabled: true,
    signalScanReady: false,
    attentionSeverity,
  });

  assert.equal(attentionSeverity, "info");
  assert.equal(wave.badgeLabel, "paused");
  assert.notEqual(wave.badgeLabel, "warning");
  assert.notEqual(wave.status, "offline");
});

test("algo header still shows warning for warning-level scan blockers", () => {
  const wave = resolveHeaderScanWave({
    deploymentEnabled: true,
    signalScanReady: false,
    attentionSeverity: "warning",
  });

  assert.equal(wave.badgeLabel, "warning");
  assert.equal(wave.status, "offline");
});

test("algo option quote stream aggregation opens one subscription for visible groups", () => {
  const subscription = buildAlgoOptionQuoteStreamSubscription([
    {
      underlying: "NVDA",
      owner: "algo-operations:NVDA",
      providerContractIds: ["101", "102"],
      requiresGreeks: true,
    },
    {
      underlying: "TSLA",
      owner: "signal-options-preview:active:TSLA",
      providerContractIds: ["102", "201"],
      requiresGreeks: true,
    },
    {
      underlying: "",
      providerContractIds: ["ignored"],
      requiresGreeks: true,
    },
  ]);

  assert.deepEqual(subscription.providerContractIds, ["101", "102", "201"]);
  assert.equal(subscription.underlying, null);
  assert.equal(subscription.owner, "algo-option-quotes:3-contracts");
  assert.equal(subscription.requiresGreeks, true);
});

test("algo overview metrics use packed intrinsic tracks outside phone layouts", () => {
  assert.equal(
    resolveAlgoOverviewMetricGridTemplate({
      algoIsPhone: false,
      algoIsPocketWidth: false,
      denseOperationsLayout: false,
    }),
    "repeat(auto-fit, minmax(128px, max-content))",
  );

  assert.equal(
    resolveAlgoOverviewMetricGridTemplate({
      algoIsPhone: false,
      algoIsPocketWidth: false,
      denseOperationsLayout: true,
    }),
    "repeat(auto-fit, minmax(104px, max-content))",
  );

  assert.equal(
    resolveAlgoOverviewMetricGridTemplate({
      algoIsPhone: true,
      algoIsPocketWidth: true,
      denseOperationsLayout: true,
    }),
    "repeat(2, minmax(0, 1fr))",
  );

  assert.equal(
    resolveAlgoOverviewMetricGridTemplate({
      algoIsPhone: true,
      algoIsPocketWidth: false,
      denseOperationsLayout: true,
    }),
    "repeat(auto-fit, minmax(104px, max-content))",
  );
});

test("signal cycle display can follow the STA table snapshot without changing scan universe", () => {
  const stages = alignSignalCycleStageWithStaTable(
    [
      { id: "scan_universe", status: "healthy", count: 500 },
      {
        id: "signal_detected",
        status: "healthy",
        count: 463,
        detail: "463 live STA rows from Signal Matrix",
      },
      { id: "contract_selected", status: "healthy", count: 12 },
    ],
    {
      rowCount: 191,
      signalRows: [],
      signature: "table-visible",
    },
  );

  assert.equal(stages[0].count, 500);
  assert.equal(stages[1].count, 191);
  assert.equal(stages[1].detail, "191 table-visible STA rows");
  assert.equal(stages[2].count, 12);
});
