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

test("candidate-derived STA rows preserve candidate identity as signal key", () => {
  const rows = buildVisibleSignalRows({
    signals: [],
    candidates: [
      {
        id: "SIGOPT-paper-LITE-buy-1780929600000",
        symbol: "LITE",
        timeframe: "5m",
        direction: "buy",
        signalAt: "2026-06-08T14:40:00.000Z",
        signal: {
          source: "pyrus-signals",
          symbol: "LITE",
          timeframe: "5m",
          direction: "buy",
          signalAt: "2026-06-08T14:40:00.000Z",
        },
      },
    ],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].signalKey, "SIGOPT-paper-LITE-buy-1780929600000");
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

test("visible signal rows overlay current action rows on received history", () => {
  const rows = buildVisibleSignalRows({
    now: Date.parse("2026-06-09T14:00:00.000Z"),
    includeSignalHistory: true,
    universeSymbols: ["ALIT", "VRT"],
    signals: [
      {
        profileId: "profile-1",
        symbol: "VRT",
        timeframe: "5m",
        direction: "buy",
        signalAt: "2026-06-09T14:05:00.000Z",
        fresh: true,
      },
    ],
    candidates: [],
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
      ["VRT", "2026-06-09T14:05:00.000Z", undefined],
      ["ALIT", "2026-06-08T20:05:00.000Z", "signal_monitor_event"],
    ],
  );
  assert.equal(rows[1].signalPrice, 9.42);
  assert.equal(rows[1].close, 9.4);
  assert.equal(rows[1].latestBarAt, "2026-06-08T20:05:00.000Z");
  assert.deepEqual(rows[1].filterState, { adx: 21.1, sessionPass: true });
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
