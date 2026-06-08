import assert from "node:assert/strict";
import test from "node:test";

import {
  buildVisibleSignalRows,
  findSignalOptionsCandidateForSignal,
  resolveStableStaActionSnapshot,
  resolveSignalAge,
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
