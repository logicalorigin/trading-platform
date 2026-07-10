import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildAlgoMonitorSignalActionRows,
  buildAlgoMonitorStaSignalRows,
  filterAlgoMonitorStaSignalRowsForTable,
  resolveAlgoMonitorActionSignalTimeframes,
  resolveAlgoMonitorReadinessStatus,
  splitAlgoMonitorSignalRowsByMatrixHydration,
} from "./PlatformAlgoMonitorSidebar.jsx";
import {
  getAlgoStaExecutionTimeframeForTests,
  publishAlgoStaExecutionTimeframe,
  resetAlgoStaExecutionTimeframeForTests,
} from "./algoStaExecutionTimeframeStore.js";

const readLocalSource = (filename) =>
  readFileSync(new URL(filename, import.meta.url), "utf8");

test("Algo monitor sidebar ignores received history without a matrix cell", () => {
  const rows = buildAlgoMonitorStaSignalRows({
    signals: [],
    signalMatrixStates: [
      {
        symbol: "VRT",
        timeframe: "5m",
        currentSignalDirection: "buy",
        currentSignalAt: "2026-06-09T14:05:00.000Z",
        fresh: true,
        status: "ok",
      },
    ],
    candidates: [],
    signalEvents: [
      {
        id: "event-alit-previous-session",
        profileId: "profile-1",
        symbol: "ALIT",
        timeframe: "5m",
        direction: "sell",
        signalAt: "2026-06-08T20:05:00.000Z",
        emittedAt: "2026-06-08T20:05:00.695Z",
      },
    ],
    universeSymbols: ["ALIT", "VRT"],
    signalMonitorEventsLoaded: true,
  });

  assert.deepEqual(
    rows.map((row) => [row.symbol, row.signalAt, row.sourceType]),
    [["VRT", "2026-06-09T14:05:00.000Z", "signal_matrix_state"]],
  );
});

test("Algo monitor sidebar includes pushed Signal Matrix rows before options snapshots", () => {
  const rows = buildAlgoMonitorStaSignalRows({
    signals: [],
    candidates: [],
    signalMatrixStates: [
      {
        profileId: "profile-5m",
        symbol: "TSM",
        timeframe: "5m",
        currentSignalDirection: "buy",
        currentSignalAt: "2026-06-11T16:55:00.000Z",
        currentSignalPrice: 177.25,
        latestBarAt: "2026-06-11T16:55:00.000Z",
        fresh: true,
        status: "ok",
      },
      {
        profileId: "profile-15m",
        symbol: "TSM",
        timeframe: "15m",
        currentSignalDirection: "sell",
        currentSignalAt: "2026-06-11T16:45:00.000Z",
        fresh: true,
        status: "ok",
      },
    ],
    signalTimeframes: ["5m"],
    universeSymbols: ["TSM"],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].symbol, "TSM");
  assert.equal(rows[0].timeframe, "5m");
  assert.equal(rows[0].sourceType, "signal_matrix_state");
});

test("Algo monitor sidebar does not build action rows from candidates alone", () => {
  const rows = buildAlgoMonitorStaSignalRows({
    candidates: [
      {
        id: "candidate-without-matrix",
        symbol: "SPY",
        timeframe: "5m",
        direction: "buy",
        signalAt: "2026-06-09T14:05:00.000Z",
      },
    ],
    signalMatrixStates: [],
    universeSymbols: ["SPY"],
  });

  assert.deepEqual(rows, []);
});

test("Algo monitor sidebar can render pushed matrix rows before deployment metadata", () => {
  const rows = buildAlgoMonitorStaSignalRows({
    signals: [],
    candidates: [],
    signalMatrixStates: [
      {
        profileId: "profile-5m",
        symbol: "QQQ",
        timeframe: "5m",
        currentSignalDirection: "buy",
        currentSignalAt: "2026-06-17T16:55:00.000Z",
        fresh: true,
        status: "ok",
      },
    ],
    signalTimeframes: ["5m"],
    signalActionTimeframes: ["5m"],
    universeSymbols: [],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].symbol, "QQQ");
  assert.equal(rows[0].sourceType, "signal_matrix_state");
});

test("Algo monitor action rows follow signal time before live matrix activity", () => {
  const rows = buildAlgoMonitorSignalActionRows({
    signals: [
      {
        signalKey: "aapu",
        symbol: "AAPU",
        timeframe: "5m",
        direction: "buy",
        signalAt: "2026-06-25T23:15:00.000Z",
        latestBarAt: "2026-06-25T23:20:00.000Z",
        updatedAt: "2026-06-25T23:20:03.434Z",
      },
      {
        signalKey: "aisp",
        symbol: "AISP",
        timeframe: "5m",
        direction: "sell",
        signalAt: "2026-06-24T19:20:00.000Z",
        latestBarAt: "2026-06-25T23:20:00.000Z",
        updatedAt: "2026-06-25T23:28:19.971Z",
      },
    ],
    candidates: [],
  });

  assert.deepEqual(
    rows.map((row) => row.signal.symbol),
    ["AAPU", "AISP"],
  );
});

test("Algo monitor action rows use the STA table MTF-aligned subset", () => {
  const rows = [
    {
      symbol: "FAST",
      timeframe: "5m",
      direction: "buy",
      signalAt: "2026-06-25T23:20:00.000Z",
      updatedAt: "2026-06-25T23:30:00.000Z",
    },
    {
      symbol: "SLOW",
      timeframe: "5m",
      direction: "buy",
      signalAt: "2026-06-25T23:10:00.000Z",
      updatedAt: "2026-06-25T23:20:00.000Z",
    },
  ];

  const staTableRows = filterAlgoMonitorStaSignalRowsForTable({
    signals: rows,
    signalMatrixBySymbol: {
      // The gate reads currentSignalDirection (per-timeframe crossover), not the
      // lagging trend, since de14395d — FAST's 2m diverges, SLOW confirms on all.
      FAST: {
        "1m": { currentSignalDirection: "buy", status: "ok", active: true },
        "2m": { currentSignalDirection: "sell", status: "ok", active: true },
        "5m": { currentSignalDirection: "buy", status: "ok", active: true },
      },
      SLOW: {
        "1m": { currentSignalDirection: "buy", status: "ok", active: true },
        "2m": { currentSignalDirection: "buy", status: "ok", active: true },
        "5m": { currentSignalDirection: "buy", status: "ok", active: true },
      },
    },
    mtfAlignmentConfig: {
      enabled: true,
      timeframes: ["1m", "2m", "5m"],
      requiredCount: 3,
    },
  });
  const actionRows = buildAlgoMonitorSignalActionRows({
    signals: staTableRows,
    candidates: [],
  });

  assert.deepEqual(
    actionRows.map((row) => row.signal.symbol),
    ["SLOW"],
  );
});

test("Algo monitor sidebar action timeframe follows the STA profile timeframe first", () => {
  assert.deepEqual(
    resolveAlgoMonitorActionSignalTimeframes({
      signalActionTimeframe: "5m",
      automationProfileTimeframe: "15m",
      deploymentSignalTimeframe: "1m",
    }),
    ["5m"],
  );
  assert.deepEqual(
    resolveAlgoMonitorActionSignalTimeframes({
      automationProfileTimeframe: "15m",
      deploymentSignalTimeframe: "1m",
    }),
    ["15m"],
  );
  assert.deepEqual(
    resolveAlgoMonitorActionSignalTimeframes({
      signalActionTimeframe: "bad",
      automationProfileTimeframe: "2m",
      deploymentSignalTimeframe: "1m",
    }),
    ["2m"],
  );
});

test("Algo STA execution timeframe store publishes the active selector value", () => {
  resetAlgoStaExecutionTimeframeForTests();
  publishAlgoStaExecutionTimeframe("2m");
  assert.equal(getAlgoStaExecutionTimeframeForTests(), "2m");
  resetAlgoStaExecutionTimeframeForTests();
  assert.equal(getAlgoStaExecutionTimeframeForTests(), "");
});

test("Platform shells pass the STA profile timeframe into the algo monitor sidebar", () => {
  const appSource = readLocalSource("./PlatformApp.jsx");
  const algoScreenSource = readLocalSource("../../screens/AlgoScreen.jsx");
  const shellSource = readLocalSource("./PlatformShell.jsx");
  const mobileSource = readLocalSource("./MobileActivitySheet.jsx");
  const sidebarSource = readLocalSource("./PlatformAlgoMonitorSidebar.jsx");

  assert.match(
    appSource,
    /signalActionTimeframe=\{signalMonitorProfile\?\.timeframe\}/,
  );
  assert.match(
    algoScreenSource,
    /publishAlgoStaExecutionTimeframe\(staActionSignalTimeframes\[0\] \|\| ""\)/,
  );
  assert.match(
    algoScreenSource,
    /publishAlgoStaMtfAlignmentConfig\(\s*profileDraft\?\.entryGate\?\.mtfAlignment \|\| null,?\s*\)/,
  );
  assert.match(algoScreenSource, /clearAlgoStaExecutionTimeframe\(\)/);
  assert.match(shellSource, /signalActionTimeframe=\{signalActionTimeframe\}/);
  assert.match(mobileSource, /signalActionTimeframe=\{signalActionTimeframe\}/);
  assert.match(sidebarSource, /useAlgoStaExecutionTimeframe\(\)/);
  assert.match(sidebarSource, /useAlgoStaMtfAlignmentConfig\(\)/);
  assert.match(
    sidebarSource,
    /activeStaMtfAlignmentConfig \?\?[\s\S]*automationState\?\.profile\?\.entryGate\?\.mtfAlignment/,
  );
  assert.match(
    sidebarSource,
    /signalActionTimeframe:\s*activeStaExecutionTimeframe \|\| signalActionTimeframe/,
  );
  assert.match(
    sidebarSource,
    /signalActionTimeframe,\s*automationProfileTimeframe:\s*automationState\?\.profile\?\.timeframe/s,
  );
});

test("Platform shell algo stream pauses during blocking API mutations", () => {
  const shellSource = readLocalSource("./PlatformShell.jsx");

  assert.match(shellSource, /useCriticalApiMutationPause\(\)/);
  assert.match(
    shellSource,
    /const algoFrameRuntimeEnabled = Boolean\(\s*frameAuxiliaryDataEnabled &&\s*!tradeScreenConnectionPriority &&\s*!criticalApiMutationPaused &&/s,
  );
  assert.match(
    shellSource,
    /const algoMonitorSurfaceDataEnabled = Boolean\(\s*!criticalApiMutationPaused &&\s*!tradeScreenConnectionPriority &&/s,
  );
});

test("Algo monitor sidebar keeps independent signals without fabricating deployment metrics", () => {
  const sidebarSource = readLocalSource("./PlatformAlgoMonitorSidebar.jsx");

  assert.equal(sidebarSource.includes("useGetAccountPositions"), false);
  assert.equal(sidebarSource.includes("rowDeploymentIds"), false);
  assert.match(
    sidebarSource,
    /const loading = Boolean\([\s\S]*deploymentsQuery\.isLoading &&[\s\S]*!hasSignalActionRows/,
  );
  assert.match(
    sidebarSource,
    /const canRenderSignalSurface = Boolean\(focusedDeployment \|\| hasSignalActionRows\);/,
  );
  assert.match(
    sidebarSource,
    /!focusedDeployment \? \([\s\S]*title=\{[\s\S]*Deployment data unavailable[\s\S]*No algo deployment[\s\S]*\) : \([\s\S]*data-testid="algo-monitor-deployment"/,
  );
});

test("Algo monitor sidebar never renders retained data after a query changes or fails", () => {
  const sidebarSource = readLocalSource("./PlatformAlgoMonitorSidebar.jsx");

  assert.doesNotMatch(sidebarSource, /placeholderData/);
  assert.match(
    sidebarSource,
    /const deployments = deploymentsQuery\.isError\s*\? \[\]\s*:\s*deploymentsQuery\.data\?\.deployments \|\| \[\];/,
  );
  assert.match(
    sidebarSource,
    /const cockpit = cockpitQuery\.isError \? null : cockpitQuery\.data \|\| null;/,
  );
  assert.match(
    sidebarSource,
    /const automationState = automationStateQuery\.isError\s*\? null\s*:\s*automationStateQuery\.data \|\| null;/,
  );
  assert.match(
    sidebarSource,
    /const performance = performanceQuery\.isError\s*\? null\s*:\s*performanceQuery\.data \|\| null;/,
  );
  assert.match(sidebarSource, /const primaryDetailLoading =/);
  assert.match(sidebarSource, /const primaryDetailUnavailable =/);
  assert.match(sidebarSource, /const detailQueryErrors =/);
  assert.match(
    sidebarSource,
    /deploymentsQuery\.isError && !hasSignalActionRows \? \([\s\S]*title="Algo monitor unavailable"/,
  );
  assert.match(
    sidebarSource,
    /primaryDetailUnavailable && !hasSignalActionRows \? \([\s\S]*title="Algo monitor data unavailable"/,
  );
  assert.doesNotMatch(sidebarSource, /detailQueriesFailed \? \(/);
  assert.match(sidebarSource, /detailQueryErrors\.join\(", "\)/);
  assert.match(
    sidebarSource,
    /primaryDetailUnavailable \? \([\s\S]*Current cockpit and automation data could not be loaded[\s\S]*primaryDetailLoading \? \([\s\S]*Pulling current deployment data[\s\S]*!focusedDeployment \? \(/,
  );
  assert.match(
    sidebarSource,
    /readinessReady:\s*cockpit\s*\?\s*cockpit\?\.readiness\?\.ready !== false\s*:\s*false/,
  );
});

test("Algo monitor sidebar does not withhold action rows for companion bubbles", () => {
  const hydratedRow = {
    id: "sta-hydrated",
    signal: {
      symbol: "ABFL",
      timeframe: "5m",
      direction: "buy",
      signalAt: "2026-06-09T14:25:00.000Z",
    },
  };
  const companionMissingRow = {
    id: "sta-companion-missing",
    signal: {
      symbol: "ACIU",
      timeframe: "5m",
      direction: "sell",
      signalAt: "2026-06-09T14:25:00.000Z",
    },
  };

  const split = splitAlgoMonitorSignalRowsByMatrixHydration({
    rows: [hydratedRow, companionMissingRow],
    timeframes: ["2m", "5m", "15m"],
    signalMatrixBySymbol: {
      ABFL: {
        "2m": {
          status: "ok",
          active: true,
          latestBarAt: "2026-06-09T14:30:00.000Z",
        },
        "5m": {
          status: "ok",
          active: true,
          currentSignalAt: "2026-06-09T14:25:00.000Z",
        },
        "15m": {
          status: "stale",
          active: true,
          lastEvaluatedAt: "2026-06-09T14:15:00.000Z",
        },
      },
      ACIU: {
        "2m": {
          status: "ok",
          active: true,
          latestBarAt: "2026-06-09T14:30:00.000Z",
        },
        "5m": {
          status: "ok",
          active: true,
          currentSignalAt: "2026-06-09T14:25:00.000Z",
        },
      },
    },
  });

  assert.deepEqual(
    split.hydratedRows.map((row) => row.id),
    ["sta-hydrated", "sta-companion-missing"],
  );
  assert.deepEqual(split.pendingRows, []);
});

test("Algo monitor sidebar rows require a backing selected Signal Matrix bubble", () => {
  const split = splitAlgoMonitorSignalRowsByMatrixHydration({
    rows: [
      {
        id: "candidate-row",
        signal: {
          symbol: "HIST",
          timeframe: "5m",
          direction: "buy",
          signalAt: "2026-06-09T13:35:00.000Z",
        },
        candidate: {
          id: "candidate-row",
          symbol: "HIST",
          timeframe: "5m",
        },
      },
    ],
    signalMatrixBySymbol: {},
    timeframes: ["5m"],
  });

  assert.deepEqual(split.hydratedRows, []);
  assert.equal(split.pendingRows.length, 1);
});

test("Algo monitor sidebar treats evaluated diagnostic signal bubbles as hydrated", () => {
  const split = splitAlgoMonitorSignalRowsByMatrixHydration({
    rows: [
      {
        id: "sta-diagnostic",
        signal: {
          symbol: "VRT",
          timeframe: "5m",
        },
      },
    ],
    timeframes: ["2m", "5m", "15m"],
    signalMatrixBySymbol: {
      VRT: {
        "2m": {
          status: "unavailable",
          active: true,
          lastEvaluatedAt: "2026-06-09T14:30:00.000Z",
        },
        "5m": {
          status: "error",
          active: true,
          lastError: "bars unavailable",
        },
        "15m": {
          status: "ok",
          active: true,
          latestBarAt: "2026-06-09T14:15:00.000Z",
        },
      },
    },
  });

  assert.deepEqual(
    split.hydratedRows.map((row) => row.id),
    ["sta-diagnostic"],
  );
  assert.deepEqual(split.pendingRows, []);
});

test("Algo monitor sidebar treats info-only options session pause as scan paused, not market-data warning", () => {
  const status = resolveAlgoMonitorReadinessStatus({
    readinessReady: false,
    deploymentEnabled: true,
    attentionItems: [
      {
        severity: "info",
        summary: "Options session is closed.",
      },
    ],
  });

  assert.deepEqual(status, {
    marketDataReady: true,
    scanOn: false,
  });
});

test("Algo monitor sidebar preserves warning blockers as market-data warnings", () => {
  const status = resolveAlgoMonitorReadinessStatus({
    readinessReady: false,
    deploymentEnabled: true,
    attentionItems: [
      {
        severity: "warning",
        summary: "Market data unavailable.",
      },
    ],
  });

  assert.deepEqual(status, {
    marketDataReady: false,
    scanOn: false,
  });
});
