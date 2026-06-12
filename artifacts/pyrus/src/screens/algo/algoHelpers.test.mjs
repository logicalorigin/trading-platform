import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStaSignalHistoryRows,
  buildVisibleSignalRows,
  findSignalOptionsCandidateForSignal,
  resolveStableStaActionSnapshot,
  resolveSignalAge,
  resolveSignalMove,
  signalActionLabel,
} from "./algoHelpers.js";

test("poll-derived Signal Options state/candidates do not create STA rows (live matrix is the sole source)", () => {
  // Signal-options does not produce signals; it only evaluates matrix signals.
  // So with no live matrix signal, neither a signal-options signal nor a candidate
  // may fabricate an STA row — that fabrication is what made STA show stale rows.
  const rows = buildVisibleSignalRows({
    universeSymbols: ["LITE"],
    signalActionTimeframes: ["5m"],
    signals: [
      {
        profileId: "signal-options-profile",
        symbol: "LITE",
        timeframe: "5m",
        direction: "buy",
        signalAt: "2026-06-08T14:40:00.000Z",
        fresh: true,
      },
    ],
    candidates: [
      {
        id: "SIGOPT-paper-LITE-buy-1780929600000",
        symbol: "LITE",
        timeframe: "5m",
        direction: "buy",
        signalAt: "2026-06-08T14:40:00.000Z",
      },
    ],
    signalMatrixStates: [],
  });

  assert.equal(rows.length, 0);
});

test("visible signal rows use pushed Signal Matrix execution timeframe before options state exists", () => {
  const rows = buildVisibleSignalRows({
    signals: [],
    candidates: [],
    universeSymbols: ["SPY"],
    signalTimeframes: ["2m", "5m", "15m"],
    signalActionTimeframes: ["5m"],
    signalMatrixStates: [
      {
        profileId: "profile-2m",
        symbol: "SPY",
        timeframe: "2m",
        currentSignalDirection: "sell",
        currentSignalAt: "2026-06-11T16:54:00.000Z",
        fresh: true,
        status: "ok",
      },
      {
        profileId: "profile-5m",
        symbol: "SPY",
        timeframe: "5m",
        currentSignalDirection: "buy",
        currentSignalAt: "2026-06-11T16:55:00.000Z",
        currentSignalPrice: 545.25,
        latestBarAt: "2026-06-11T16:55:00.000Z",
        barsSinceSignal: 0,
        fresh: true,
        status: "ok",
      },
      {
        profileId: "profile-15m",
        symbol: "SPY",
        timeframe: "15m",
        currentSignalDirection: "sell",
        currentSignalAt: "2026-06-11T16:45:00.000Z",
        fresh: true,
        status: "ok",
      },
      {
        profileId: "profile-5m",
        symbol: "QQQ",
        timeframe: "5m",
        currentSignalDirection: "buy",
        currentSignalAt: "2026-06-11T16:55:00.000Z",
        fresh: true,
        status: "ok",
      },
    ],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].symbol, "SPY");
  assert.equal(rows[0].timeframe, "5m");
  assert.equal(rows[0].direction, "buy");
  assert.equal(rows[0].sourceType, "signal_matrix_state");
  assert.equal(rows[0].actionEligible, true);
  assert.equal(rows[0].signalPrice, 545.25);
});

test("visible signal rows use the live Signal Matrix as the STA action source over Signal Options duplicates", () => {
  const rows = buildVisibleSignalRows({
    universeSymbols: ["VRT"],
    signalTimeframes: ["5m"],
    signalActionTimeframes: ["5m"],
    signalMatrixStates: [
      {
        profileId: "matrix-profile",
        symbol: "VRT",
        timeframe: "5m",
        currentSignalDirection: "sell",
        currentSignalAt: "2026-06-11T16:50:00.000Z",
        fresh: true,
        status: "ok",
      },
    ],
    signals: [
      {
        profileId: "signal-options-profile",
        symbol: "VRT",
        timeframe: "5m",
        direction: "sell",
        signalAt: "2026-06-11T16:50:00.000Z",
        sourceType: "signal_options_state",
        fresh: true,
      },
    ],
    candidates: [
      {
        id: "SIGOPT-paper-VRT-sell-1781196600000",
        symbol: "VRT",
        timeframe: "5m",
        direction: "sell",
        signalAt: "2026-06-11T16:50:00.000Z",
      },
    ],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].profileId, "matrix-profile");
  assert.equal(rows[0].sourceType, "signal_matrix_state");
});

test("STA action rows use backend one-bar execution age instead of matrix fresh flag", () => {
  const rows = buildVisibleSignalRows({
    universeSymbols: ["TSM", "DIA", "BGC"],
    signalActionTimeframes: ["5m"],
    signalMatrixStates: [
      {
        profileId: "profile-1",
        symbol: "TSM",
        timeframe: "5m",
        currentSignalDirection: "sell",
        currentSignalAt: "2026-06-11T17:05:00.000Z",
        latestBarAt: "2026-06-11T17:10:00.000Z",
        barsSinceSignal: 1,
        fresh: false,
        status: "ok",
      },
      {
        profileId: "profile-1",
        symbol: "DIA",
        timeframe: "5m",
        currentSignalDirection: "sell",
        currentSignalAt: "2026-06-11T15:05:00.000Z",
        latestBarAt: "2026-06-11T15:20:00.000Z",
        barsSinceSignal: 2,
        fresh: true,
        status: "ok",
      },
      {
        profileId: "profile-1",
        symbol: "BGC",
        timeframe: "5m",
        currentSignalDirection: "buy",
        currentSignalAt: "2026-06-11T15:05:00.000Z",
        latestBarAt: "2026-06-11T15:20:00.000Z",
        barsSinceSignal: null,
        fresh: true,
        status: "ok",
      },
    ],
  });

  const bySymbol = Object.fromEntries(rows.map((row) => [row.symbol, row]));

  assert.equal(bySymbol.TSM.actionEligible, true);
  assert.equal(bySymbol.TSM.actionBlocker, null);
  assert.equal(bySymbol.DIA.actionEligible, false);
  assert.equal(bySymbol.DIA.actionBlocker, "signal_too_old");
  assert.equal(bySymbol.BGC.actionEligible, false);
  assert.equal(bySymbol.BGC.actionBlocker, "signal_age_unavailable");
});

test("visible signal rows keep received history on the execution timeframe only", () => {
  const rows = buildVisibleSignalRows({
    now: Date.parse("2026-06-09T14:00:00.000Z"),
    includeSignalHistory: true,
    universeSymbols: ["ALIT", "VRT"],
    signalActionTimeframes: ["5m"],
    signalMatrixStates: [],
    signalEvents: [
      {
        id: "event-alit-one-minute",
        profileId: "profile-1",
        symbol: "ALIT",
        timeframe: "1m",
        direction: "sell",
        signalAt: "2026-06-09T14:06:00.000Z",
      },
      {
        id: "event-vrt-five-minute",
        profileId: "profile-1",
        symbol: "VRT",
        timeframe: "5m",
        direction: "buy",
        signalAt: "2026-06-09T14:05:00.000Z",
      },
    ],
  });

  assert.deepEqual(
    rows.map((row) => [row.symbol, row.timeframe, row.sourceType]),
    [["VRT", "5m", "signal_monitor_event"]],
  );
});

test("STA signal history keeps received events from the fetched lookback window", () => {
  const rows = buildStaSignalHistoryRows({
    now: Date.parse("2026-06-09T14:00:00.000Z"),
    universeSymbols: ["ALIT", "ABFL"],
    signalEvents: [
      {
        id: "event-alit-previous-session",
        profileId: "profile-1",
        symbol: "ALIT",
        timeframe: "5m",
        direction: "sell",
        signalAt: "2026-06-08T20:05:00.000Z",
        emittedAt: "2026-06-08T20:05:00.695Z",
        signalPrice: 9.42,
      },
      {
        id: "event-abfl-current-session",
        profileId: "profile-1",
        symbol: "ABFL",
        timeframe: "5m",
        direction: "buy",
        signalAt: "2026-06-09T14:05:00.000Z",
        emittedAt: "2026-06-09T14:05:03.100Z",
        signalPrice: 14.18,
      },
    ],
  });

  assert.deepEqual(
    rows.map((row) => [row.symbol, row.signalAt, row.sourceType]),
    [
      ["ABFL", "2026-06-09T14:05:00.000Z", "signal_monitor_event"],
      ["ALIT", "2026-06-08T20:05:00.000Z", "signal_monitor_event"],
    ],
  );
  assert.equal(rows[1].direction, "sell");
  assert.equal(rows[1].signalPrice, 9.42);
  assert.equal(rows[1].currentSignalPrice, 9.42);
  assert.equal(rows[1].emittedAt, "2026-06-08T20:05:00.695Z");
});

test("visible signal rows overlay current matrix action rows on received history", () => {
  const rows = buildVisibleSignalRows({
    now: Date.parse("2026-06-09T14:00:00.000Z"),
    includeSignalHistory: true,
    universeSymbols: ["ALIT", "VRT"],
    signalActionTimeframes: ["5m"],
    signalMatrixStates: [
      {
        profileId: "profile-1",
        symbol: "VRT",
        timeframe: "5m",
        currentSignalDirection: "buy",
        currentSignalAt: "2026-06-09T14:05:00.000Z",
        fresh: true,
        status: "ok",
      },
    ],
    signalEvents: [
      {
        id: "event-vrt-current-overlay",
        profileId: "profile-1",
        symbol: "VRT",
        timeframe: "5m",
        direction: "buy",
        signalAt: "2026-06-09T14:05:00.000Z",
        emittedAt: "2026-06-09T14:05:02.000Z",
      },
      {
        id: "event-alit-previous-session",
        profileId: "profile-1",
        symbol: "ALIT",
        timeframe: "5m",
        direction: "sell",
        signalAt: "2026-06-08T20:05:00.000Z",
        emittedAt: "2026-06-08T20:05:00.695Z",
        signalPrice: 9.42,
        close: 9.4,
        payload: {
          filterState: { adx: 21.1, sessionPass: true },
          latestBarAt: "2026-06-08T20:05:00.000Z",
          signalBarAt: "2026-06-08T20:00:00.000Z",
        },
      },
    ],
  });

  assert.deepEqual(
    rows.map((row) => [row.symbol, row.signalAt, row.sourceType]),
    [
      ["VRT", "2026-06-09T14:05:00.000Z", "signal_matrix_state"],
      ["ALIT", "2026-06-08T20:05:00.000Z", "signal_monitor_event"],
    ],
  );
  assert.equal(rows[1].signalPrice, 9.42);
  assert.equal(rows[1].close, 9.4);
  assert.equal(rows[1].latestBarAt, "2026-06-08T20:05:00.000Z");
  assert.deepEqual(rows[1].filterState, { adx: 21.1, sessionPass: true });
});

test("visible signal rows collapse to one row per cell (no signal multiples)", () => {
  const rows = buildVisibleSignalRows({
    now: Date.parse("2026-06-09T14:00:00.000Z"),
    includeSignalHistory: true,
    universeSymbols: ["USO"],
    signals: [
      {
        profileId: "profile-1",
        symbol: "USO",
        timeframe: "1m",
        direction: "buy",
        signalAt: "2026-06-09T13:25:00.000Z",
        fresh: false,
      },
    ],
    candidates: [],
    // Same cell fired buy three times over the day — must NOT become three rows.
    signalEvents: [
      {
        id: "uso-1",
        profileId: "profile-1",
        symbol: "USO",
        timeframe: "1m",
        direction: "buy",
        signalAt: "2026-06-09T13:25:00.000Z",
      },
      {
        id: "uso-2",
        profileId: "profile-1",
        symbol: "USO",
        timeframe: "1m",
        direction: "buy",
        signalAt: "2026-06-09T12:17:00.000Z",
      },
      {
        id: "uso-3",
        profileId: "profile-1",
        symbol: "USO",
        timeframe: "1m",
        direction: "buy",
        signalAt: "2026-06-08T19:34:00.000Z",
      },
    ],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].symbol, "USO");
  assert.equal(rows[0].timeframe, "1m");
  assert.equal(rows[0].signalAt, "2026-06-09T13:25:00.000Z");
});

test("STA candidate lookup does not attach newer candidates to historical signal rows", () => {
  const candidate = {
    id: "SIGOPT-paper-AVAV-buy-1780930800000",
    symbol: "AVAV",
    timeframe: "5m",
    direction: "buy",
    signalAt: "2026-06-08T15:00:00.000Z",
    signal: {
      symbol: "AVAV",
      timeframe: "5m",
      direction: "buy",
      signalAt: "2026-06-08T15:00:00.000Z",
    },
  };

  assert.equal(
    findSignalOptionsCandidateForSignal([candidate], {
      symbol: "AVAV",
      timeframe: "5m",
      direction: "buy",
      signalAt: "2026-06-08T14:00:00.000Z",
    }),
    null,
  );

  assert.equal(
    findSignalOptionsCandidateForSignal([candidate], {
      symbol: "AVAV",
      timeframe: "5m",
      direction: "buy",
      signalAt: "2026-06-08T15:00:00.000Z",
    }),
    candidate,
  );
});

test("STA signal age falls back to elapsed time when bar age is unavailable", () => {
  const age = resolveSignalAge(
    {
      signalAt: "2026-06-08T14:00:00.000Z",
      barsSinceSignal: null,
    },
    { now: new Date("2026-06-08T15:02:00.000Z") },
  );

  assert.equal(age.label, "1h");
  assert.equal(age.detail, "1h since signal");
});

test("STA signal age display uses elapsed time even when bar age is present", () => {
  const age = resolveSignalAge(
    {
      signalAt: "2026-06-08T14:00:00.000Z",
      barsSinceSignal: 2,
      freshWindowBars: 8,
    },
    { now: new Date("2026-06-08T14:17:00.000Z") },
  );

  assert.equal(age.label, "17m");
  assert.equal(age.detail, "17m since signal");
  assert.equal(age.barsLabel, "2/8 bars");
  assert.equal(age.freshnessPct, 75);
});

test("Signal action labels stay long-options only", () => {
  assert.equal(signalActionLabel({ direction: "buy" }, null), "BUY CALL");
  assert.equal(signalActionLabel({ direction: "sell" }, null), "BUY PUT");
  assert.equal(
    signalActionLabel(null, {
      signalDirection: "sell",
      optionAction: "buy_put",
      orderSide: "buy",
      orderIntent: "open_long_option",
    }),
    "BUY PUT",
  );
});

test("STA signal move uses signal basis aliases and current quote", () => {
  const move = resolveSignalMove(
    {
      symbol: "APLD",
      currentSignalPrice: 40,
    },
    {
      symbol: "APLD",
      price: 42,
    },
  );

  assert.equal(move.label, "+5.0%");
  assert.equal(move.detail, "+2.00");
});

test("STA source selection does not let cockpit wrapper generatedAt beat fuller state rows", () => {
  const snapshot = resolveStableStaActionSnapshot({
    signalOptionsState: {
      signals: [
        {
          symbol: "HEI",
          timeframe: "5m",
          direction: "sell",
          signalAt: "2026-06-08T16:15:00.000Z",
        },
        {
          symbol: "ADM",
          timeframe: "2m",
          direction: "buy",
          signalAt: "2026-06-08T16:12:00.000Z",
        },
      ],
      candidates: [
        {
          id: "SIGOPT-paper-HEI-sell-1780935300000",
          symbol: "HEI",
          signalAt: "2026-06-08T16:15:00.000Z",
        },
      ],
    },
    cockpit: {
      generatedAt: "2026-06-08T16:25:00.000Z",
      signals: [
        {
          symbol: "HEI",
          timeframe: "5m",
          direction: "sell",
          signalAt: "2026-06-08T16:15:00.000Z",
        },
      ],
      candidates: [],
    },
  });

  assert.equal(snapshot.source, "state");
  assert.equal(snapshot.signals.length, 2);
  assert.equal(snapshot.candidates.length, 1);
});

test("STA source selection does not reuse previous rows through empty refresh frames", () => {
  const snapshot = resolveStableStaActionSnapshot({
    cockpit: {
      generatedAt: "2026-06-09T19:10:00.000Z",
      signals: [],
      candidates: [],
      activePositions: [],
    },
    signalOptionsState: {
      updatedAt: "2026-06-09T19:10:00.000Z",
      signals: [],
      candidates: [],
      activePositions: [],
    },
  });

  assert.equal(snapshot.source, "empty");
  assert.equal(snapshot.cacheable, true);
  assert.equal(snapshot.sourceHealth.degraded, false);
  assert.equal(snapshot.signals.length, 0);
  assert.equal(snapshot.candidates.length, 0);
});

test("STA source selection rejects stale cached action rows", () => {
  const snapshot = resolveStableStaActionSnapshot({
    signalOptionsState: {
      cacheStatus: "stale",
      signals: [
        {
          symbol: "NOC",
          timeframe: "5m",
          direction: "sell",
          signalAt: "2026-06-11T18:10:00.000Z",
        },
      ],
      candidates: [
        {
          id: "SIGOPT-paper-NOC-sell-1781201400000",
          symbol: "NOC",
          signalAt: "2026-06-11T18:10:00.000Z",
        },
      ],
    },
    cockpit: {
      cacheStatus: "stale",
      signals: [
        {
          symbol: "NOC",
          timeframe: "5m",
          direction: "sell",
          signalAt: "2026-06-11T18:10:00.000Z",
        },
      ],
      candidates: [],
    },
  });

  assert.equal(snapshot.source, "empty");
  assert.equal(snapshot.sourceHealth.stale, true);
  assert.equal(snapshot.sourceHealth.degraded, true);
  assert.deepEqual(snapshot.sourceHealth.failedSources, ["cockpit", "state"]);
  assert.equal(snapshot.signals.length, 0);
  assert.equal(snapshot.candidates.length, 0);
});
