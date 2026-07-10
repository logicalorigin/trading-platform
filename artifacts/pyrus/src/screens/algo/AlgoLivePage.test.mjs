import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  alignSignalCycleStageWithStaTable,
  buildAlgoOptionQuoteStreamSubscription,
  resolveEffectiveStaMtfAlignmentConfig,
  resolveAlgoOverviewMetricGridTemplate,
  resolveAttentionSeverity,
  resolveHeaderScanWave,
} from "./AlgoLivePage.jsx";

const source = readFileSync(
  new URL("./AlgoLivePage.jsx", import.meta.url),
  "utf8",
);
const algoScreenSource = readFileSync(
  new URL("../AlgoScreen.jsx", import.meta.url),
  "utf8",
);

test("algo header does not show warning for info-only options session pause", () => {
  const attentionSeverity = resolveAttentionSeverity([
    {
      severity: "info",
      summary: "Options session is closed.",
      detail:
        "Options strategy execution is outside the regular options session.",
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

test("algo header still shows offline for warning-level scan blockers", () => {
  const wave = resolveHeaderScanWave({
    deploymentEnabled: true,
    signalScanReady: false,
    attentionSeverity: "warning",
  });

  assert.equal(wave.badgeLabel, "offline");
  assert.equal(wave.status, "offline");
});

test("algo header labels readiness as market data and drops bridge runtime chips", () => {
  assert.match(source, /marketDataReady,/);
  assert.match(
    source,
    /label: marketDataReady \? "market data" : "market data off"/,
  );
  assert.doesNotMatch(source, /broker ready|broker off/);
  assert.doesNotMatch(source, /bridgeToneLabel|bridgeToneDuplicatesHeaderWave/);
  assert.doesNotMatch(source, /\bbridgeTone\b/);
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

test("AlgoLivePage keeps hooks before the empty-state return", () => {
  const emptyStateReturnIndex = source.indexOf("if (showEmptyOperationsState)");
  assert.ok(emptyStateReturnIndex > 0, "empty-state return exists");
  const beforeEmptyReturn = source.slice(0, emptyStateReturnIndex);
  const afterEmptyReturn = source.slice(emptyStateReturnIndex);

  assert.match(
    beforeEmptyReturn,
    /const effectiveMtfAlignmentConfig = useMemo/,
  );
  assert.match(
    beforeEmptyReturn,
    /const cockpitStageItemsForDisplay = useMemo/,
  );
  assert.match(beforeEmptyReturn, /const liveIndicatorMetrics = useMemo/);
  assert.doesNotMatch(
    afterEmptyReturn,
    /const effectiveMtfAlignmentConfig = useMemo/,
  );
  assert.doesNotMatch(
    afterEmptyReturn,
    /const cockpitStageItemsForDisplay = useMemo/,
  );
  assert.doesNotMatch(afterEmptyReturn, /const liveIndicatorMetrics = useMemo/);
});

test("AlgoLivePage keeps normal chrome during deployment fetches and only shows a settled empty state", () => {
  assert.match(
    source,
    /const emptyOperationsSetupSettled = Boolean\(setupDataSettled\);/,
  );
  assert.match(
    source,
    /const showEmptyOperationsState = Boolean\(\s*emptyOperationsSetupSettled && !deployments\.length,\s*\);/,
  );
  assert.doesNotMatch(
    source,
    /setupDataSettled=\{emptyOperationsSetupSettled\}/,
  );
  assert.doesNotMatch(source, /algo-setup-loading/);
  assert.doesNotMatch(source, /Loading Signal Operations/);
  assert.doesNotMatch(
    source,
    /const showEmptyOperationsState = Boolean\(!deployments\.length\);/,
  );
  assert.match(
    source,
    /deploymentListUnavailable=\{deploymentListUnavailable\}/,
  );
  assert.doesNotMatch(source, /setupDataSettled && !refreshPending/);
});

test("Algo overview keeps missing cockpit and performance values neutral", () => {
  const pnlStart = source.indexOf('label: "P&L"');
  const riskStart = source.indexOf('label: "Risk"');
  const recordStart = source.indexOf('label: "Record"', riskStart);
  const pnlMetric = source.slice(
    pnlStart,
    source.indexOf('label: "Exposure"', pnlStart),
  );
  const riskMetric = source.slice(riskStart, recordStart);
  const recordMetric = source.slice(
    recordStart,
    source.indexOf("  ];", recordStart),
  );
  assert.match(source, /cockpitPnlDataAvailable = false/);
  assert.match(source, /cockpitRiskDataAvailable = false/);
  assert.match(source, /cockpitPositionDataAvailable = false/);
  assert.match(source, /performanceDataAvailable = false/);
  assert.match(source, /positionDataAvailable = false/);
  assert.match(pnlMetric, /value: cockpitPnlDataAvailable/);
  assert.match(pnlMetric, /: MISSING_VALUE/);
  assert.match(pnlMetric, /: CSS_COLOR\.textMuted/);
  assert.match(riskMetric, /value: cockpitRiskDataAvailable/);
  assert.match(riskMetric, /: MISSING_VALUE/);
  assert.match(riskMetric, /: CSS_COLOR\.textMuted/);
  assert.match(riskMetric, /: Shield,/);
  assert.match(recordMetric, /value: performanceDataAvailable/);
  assert.match(recordMetric, /: "No exits"/);
  assert.match(recordMetric, /: MISSING_VALUE/);
  assert.match(recordMetric, /: CSS_COLOR\.textMuted/);
  assert.match(
    recordMetric,
    /icon: performanceDataAvailable \? ShieldCheck : Shield/,
  );
  assert.match(
    algoScreenSource,
    /cockpitPnlDataAvailable=\{cockpitPnlDataAvailable\}/,
  );
  assert.match(
    algoScreenSource,
    /cockpitRiskDataAvailable=\{cockpitRiskDataAvailable\}/,
  );
  assert.match(
    algoScreenSource,
    /cockpitPositionDataAvailable=\{cockpitPositionDataAvailable\}/,
  );
  assert.match(
    algoScreenSource,
    /performanceDataAvailable=\{performanceDataAvailable\}/,
  );
  assert.match(
    algoScreenSource,
    /positionDataAvailable=\{positionDataAvailable\}/,
  );
  assert.match(
    algoScreenSource,
    /typeof cockpitRisk\.dailyHaltActive === "boolean"/,
  );
  assert.match(
    algoScreenSource,
    /cockpitKpis\.dailyRealizedPnl != null[\s\S]*?cockpitKpis\.openUnrealizedPnl != null/,
  );
});

test("Algo deployment list query does not retain placeholder data", () => {
  const start = algoScreenSource.indexOf(
    "const deploymentsQuery = useListAlgoDeployments",
  );
  const end = algoScreenSource.indexOf("const deployments =", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.doesNotMatch(algoScreenSource.slice(start, end), /placeholderData/);
  assert.doesNotMatch(algoScreenSource, /deploymentListEmptyUnavailable/);
  assert.doesNotMatch(
    algoScreenSource,
    /deploymentsQuery\.data\?\.cacheStatus/,
  );
});

test("STA MTF config uses the configured draft timeframe set for table and KPI consumers", () => {
  const config = resolveEffectiveStaMtfAlignmentConfig({
    mtfAlignmentDraft: {
      enabled: true,
      requiredCount: 1,
      timeframes: ["1m", "2m"],
    },
    signalOptionsProfile: {
      entryGate: {
        mtfAlignment: {
          enabled: true,
          requiredCount: 3,
          timeframes: ["15m", "1h", "1d"],
        },
      },
    },
    staSignalTimeframes: ["1m", "2m", "5m"],
  });

  // product ruling 2026-07-07: the draft's requiredCount is honored (clamped
  // to the selection), not forced to full-count.
  assert.deepEqual(config.timeframes, ["1m", "2m"]);
  assert.equal(config.requiredCount, 1);
});

test("STA MTF config honors the configured n-of-N", () => {
  // product ruling 2026-07-07: overrules the prior full-count intent.
  const config = resolveEffectiveStaMtfAlignmentConfig({
    mtfAlignmentDraft: {
      enabled: true,
      requiredCount: 2,
      timeframes: ["5m", "15m", "1h"],
    },
    staSignalTimeframes: ["5m", "15m"],
  });

  assert.deepEqual(config.timeframes, ["5m", "15m", "1h"]);
  assert.equal(config.requiredCount, 2);
});

test("algo account tabs route shadow to automation overlay and live tabs to broker rows", () => {
  const accountTabsUsage = source.match(
    /<AccountTabs[\s\S]*?dataTestId="algo-account-tabs"[\s\S]*?\/>/,
  )?.[0];
  assert.ok(accountTabsUsage, "Missing algo account tabs");
  assert.match(accountTabsUsage, /accounts=\{positionAccounts\}/);
  assert.match(accountTabsUsage, /activeTabId=\{positionAccountTabId\}/);
  assert.match(accountTabsUsage, /onSelectTab=\{onSelectPositionAccountTab\}/);

  const positionsUsage = source.match(
    /<OperationsPositionsTable[\s\S]*?algoIsPhone=\{algoIsPhone\}[\s\S]*?\/>/,
  )?.[0];
  assert.ok(positionsUsage, "Missing operations positions table usage");
  assert.doesNotMatch(positionsUsage, /\bpositions=/);
  assert.doesNotMatch(positionsUsage, /\bsymbolIndex=/);
  assert.match(
    positionsUsage,
    /deploymentId=\{\s*positionAccountUsesShadowOverlay \? focusedDeploymentId : null\s*\}/,
  );
  assert.match(
    positionsUsage,
    /filterByDeployment=\{positionAccountUsesShadowOverlay\}/,
  );
  assert.match(
    positionsUsage,
    /positionAccountUsesShadowOverlay\s*\?\s*"Shadow algo positions"\s*:\s*"Broker positions"/,
  );
});
