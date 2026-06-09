import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAlgoMonitorStaSignalRows,
  buildAlgoMonitorSignalMatrixHydrationRequest,
  resolveAlgoMonitorReadinessStatus,
  splitAlgoMonitorSignalRowsByMatrixHydration,
} from "./PlatformAlgoMonitorSidebar.jsx";

test("Algo monitor sidebar includes received signal history rows", () => {
  const rows = buildAlgoMonitorStaSignalRows({
    signals: [
      {
        symbol: "VRT",
        timeframe: "5m",
        direction: "buy",
        signalAt: "2026-06-09T14:05:00.000Z",
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
    [
      ["VRT", "2026-06-09T14:05:00.000Z", undefined],
      ["ALIT", "2026-06-08T20:05:00.000Z", "signal_monitor_event"],
    ],
  );
});

test("Algo monitor sidebar hydration uses selected trading frames and execution priority", () => {
  const request = buildAlgoMonitorSignalMatrixHydrationRequest({
    rows: [
      {
        signal: {
          symbol: "MU",
          timeframe: "5m",
        },
      },
    ],
    currentStates: [],
    timeframes: ["2m", "5m", "15m"],
  });

  assert.deepEqual(request.requestSymbols, ["MU"]);
  assert.deepEqual(request.requestTimeframes, ["5m", "2m", "15m"]);
  assert.deepEqual(
    request.requestCells.map((cell) => `${cell.symbol}:${cell.timeframe}`),
    ["MU:5m", "MU:2m", "MU:15m"],
  );
});

test("Algo monitor sidebar withholds action rows until all selected signal bubbles are hydrated", () => {
  const hydratedRow = {
    id: "sta-hydrated",
    signal: {
      symbol: "ABFL",
      timeframe: "5m",
    },
  };
  const pendingRow = {
    id: "sta-pending",
    signal: {
      symbol: "ACIU",
      timeframe: "5m",
    },
  };

  const split = splitAlgoMonitorSignalRowsByMatrixHydration({
    rows: [hydratedRow, pendingRow],
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
          status: "pending",
          active: true,
        },
      },
    },
  });

  assert.deepEqual(split.hydratedRows.map((row) => row.id), ["sta-hydrated"]);
  assert.deepEqual(split.pendingRows.map((row) => row.id), ["sta-pending"]);
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
