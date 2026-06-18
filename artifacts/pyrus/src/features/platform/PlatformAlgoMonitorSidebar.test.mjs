import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildAlgoMonitorStaSignalRows,
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
    /clearAlgoStaExecutionTimeframe\(\)/,
  );
  assert.match(
    shellSource,
    /signalActionTimeframe=\{signalActionTimeframe\}/,
  );
  assert.match(
    mobileSource,
    /signalActionTimeframe=\{signalActionTimeframe\}/,
  );
  assert.match(
    sidebarSource,
    /useAlgoStaExecutionTimeframe\(\)/,
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

test("Algo monitor sidebar first paint is not coupled to shadow account position fallback", () => {
  const sidebarSource = readLocalSource("./PlatformAlgoMonitorSidebar.jsx");

  assert.equal(sidebarSource.includes("useGetAccountPositions"), false);
  assert.equal(sidebarSource.includes("rowDeploymentIds"), false);
  assert.match(
    sidebarSource,
    /const loading =[\s\S]*deploymentsQuery\.isLoading[\s\S]*!hasSignalActionRows;/,
  );
  assert.match(
    sidebarSource,
    /const canRenderSignalSurface = Boolean\(focusedDeployment \|\| hasSignalActionRows\);/,
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

  assert.deepEqual(split.hydratedRows.map((row) => row.id), ["sta-diagnostic"]);
  assert.deepEqual(split.pendingRows, []);
});

test("Algo monitor sidebar treats info-only options session pause as scan paused, not gateway warning", () => {
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
    gatewayReady: true,
    scanOn: false,
  });
});

test("Algo monitor sidebar preserves warning blockers as gateway warnings", () => {
  const status = resolveAlgoMonitorReadinessStatus({
    readinessReady: false,
    deploymentEnabled: true,
    attentionItems: [
      {
        severity: "warning",
        summary: "Gateway unavailable.",
      },
    ],
  });

  assert.deepEqual(status, {
    gatewayReady: false,
    scanOn: false,
  });
});
