import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAlgoMonitorStaSignalRows,
  resolveAlgoMonitorReadinessStatus,
  splitAlgoMonitorSignalRowsByMatrixHydration,
} from "./PlatformAlgoMonitorSidebar.jsx";

test("Algo monitor sidebar includes received signal history rows", () => {
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
    [
      ["VRT", "2026-06-09T14:05:00.000Z", "signal_matrix_state"],
      ["ALIT", "2026-06-08T20:05:00.000Z", "signal_monitor_event"],
    ],
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
      },
    },
  });

  assert.deepEqual(
    split.hydratedRows.map((row) => row.id),
    ["sta-hydrated", "sta-companion-missing"],
  );
  assert.deepEqual(split.pendingRows, []);
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
