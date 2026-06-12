import assert from "node:assert/strict";
import test from "node:test";

import { buildSignalMatrixBySymbol } from "../platform/watchlistModel.js";
import { getCurrentSignalDirection } from "./signalStateFreshness.js";
import {
  canonicalSignalMonitorEventsForMatrixMerge,
  mergeSignalEventsIntoMatrixStates,
  preferSignalMatrixCellState,
  signalMonitorEventToMatrixState,
} from "./signalMatrixStateMerge.js";

test("a directionless newer update does not clobber a cached signal direction", () => {
  const cached = {
    symbol: "SPY",
    timeframe: "5m",
    status: "ok",
    currentSignalDirection: "sell",
    currentSignalAt: "2026-06-09T15:00:00.000Z",
    latestBarAt: "2026-06-09T20:00:00.000Z",
    lastEvaluatedAt: "2026-06-09T20:00:00.000Z",
    fresh: false,
  };
  const directionlessNewer = {
    symbol: "SPY",
    timeframe: "5m",
    status: "ok",
    currentSignalDirection: null,
    currentSignalAt: null,
    latestBarAt: "2026-06-10T22:00:00.000Z",
    lastEvaluatedAt: "2026-06-10T22:00:00.000Z",
    fresh: false,
  };
  // Even though the directionless state is newer, the cached sell is kept.
  assert.equal(
    preferSignalMatrixCellState(cached, directionlessNewer).currentSignalDirection,
    "sell",
  );
  assert.equal(
    preferSignalMatrixCellState(cached, directionlessNewer).latestBarAt,
    "2026-06-10T22:00:00.000Z",
  );
  assert.equal(
    preferSignalMatrixCellState(directionlessNewer, cached).currentSignalDirection,
    "sell",
  );
  assert.equal(
    preferSignalMatrixCellState(directionlessNewer, cached).latestBarAt,
    "2026-06-10T22:00:00.000Z",
  );
});

test("latched signal bar age advances when newer bar metadata arrives", () => {
  const cached = {
    symbol: "CEG",
    timeframe: "5m",
    status: "ok",
    currentSignalDirection: "buy",
    currentSignalAt: "2026-06-12T16:25:00.000Z",
    latestBarAt: "2026-06-12T16:30:00.000Z",
    lastEvaluatedAt: "2026-06-12T16:30:00.000Z",
    barsSinceSignal: 1,
    fresh: true,
  };
  const directionlessNewer = {
    symbol: "CEG",
    timeframe: "5m",
    status: "ok",
    currentSignalDirection: null,
    currentSignalAt: null,
    latestBarAt: "2026-06-12T17:10:00.000Z",
    lastEvaluatedAt: "2026-06-12T17:10:00.000Z",
    barsSinceSignal: null,
    fresh: false,
  };

  const result = preferSignalMatrixCellState(cached, directionlessNewer);
  assert.equal(result.currentSignalDirection, "buy");
  assert.equal(result.latestBarAt, "2026-06-12T17:10:00.000Z");
  assert.equal(result.barsSinceSignal, 9);
  assert.equal(result.fresh, false);
});

test("an opposite directional update still replaces the cached direction", () => {
  const cachedSell = {
    symbol: "SPY",
    timeframe: "5m",
    status: "ok",
    currentSignalDirection: "sell",
    currentSignalAt: "2026-06-09T15:00:00.000Z",
    latestBarAt: "2026-06-09T20:00:00.000Z",
    fresh: false,
  };
  const freshBuy = {
    symbol: "SPY",
    timeframe: "5m",
    status: "ok",
    currentSignalDirection: "buy",
    currentSignalAt: "2026-06-10T21:00:00.000Z",
    latestBarAt: "2026-06-10T21:00:00.000Z",
    fresh: true,
  };
  assert.equal(
    preferSignalMatrixCellState(cachedSell, freshBuy).currentSignalDirection,
    "buy",
  );
});

test("equivalent matrix cell updates keep the current object identity", () => {
  const current = {
    symbol: "CEG",
    timeframe: "5m",
    status: "ok",
    currentSignalDirection: "buy",
    currentSignalAt: "2026-06-12T16:25:00.000Z",
    latestBarAt: "2026-06-12T16:30:00.000Z",
    lastEvaluatedAt: "2026-06-12T16:30:00.000Z",
    currentSignalPrice: 93.12,
    barsSinceSignal: 1,
    fresh: true,
    active: true,
  };
  const equivalentCandidate = {
    ...current,
    symbol: "ceg",
    currentSignalPrice: "93.12",
    barsSinceSignal: "1",
  };

  assert.equal(
    preferSignalMatrixCellState(current, equivalentCandidate),
    current,
  );
});

test("missing and zero matrix values are not treated as equivalent", () => {
  const current = {
    symbol: "CEG",
    timeframe: "5m",
    status: "ok",
    currentSignalDirection: "buy",
    currentSignalAt: "2026-06-12T16:25:00.000Z",
    latestBarAt: "2026-06-12T16:30:00.000Z",
    lastEvaluatedAt: "2026-06-12T16:30:00.000Z",
    currentSignalPrice: null,
    barsSinceSignal: null,
    fresh: true,
  };
  const candidate = {
    ...current,
    currentSignalPrice: 0,
    barsSinceSignal: 0,
  };

  assert.equal(preferSignalMatrixCellState(current, candidate), candidate);
});

test("newer directional signal beats older bar activity", () => {
  const olderSignalWithNewerBars = {
    symbol: "CEG",
    timeframe: "5m",
    status: "ok",
    currentSignalDirection: "sell",
    currentSignalAt: "2026-06-12T15:55:00.000Z",
    latestBarAt: "2026-06-12T16:35:00.000Z",
    lastEvaluatedAt: "2026-06-12T16:37:00.000Z",
    fresh: false,
  };
  const newerSignal = {
    symbol: "CEG",
    timeframe: "5m",
    status: "ok",
    currentSignalDirection: "buy",
    currentSignalAt: "2026-06-12T16:25:00.000Z",
    latestBarAt: "2026-06-12T16:25:00.000Z",
    lastEvaluatedAt: "2026-06-12T16:25:05.000Z",
    fresh: true,
  };

  assert.equal(
    preferSignalMatrixCellState(
      olderSignalWithNewerBars,
      newerSignal,
    ).currentSignalDirection,
    "buy",
  );
  assert.equal(
    preferSignalMatrixCellState(
      newerSignal,
      olderSignalWithNewerBars,
    ).currentSignalDirection,
    "buy",
  );
});

test("signal monitor events hydrate stale matrix cells for shared signal bubbles", () => {
  const merged = mergeSignalEventsIntoMatrixStates({
    states: [
      {
        symbol: "spy",
        timeframe: "5m",
        status: "stale",
        currentSignalDirection: null,
        currentSignalAt: null,
        latestBarAt: "2026-06-09T20:10:00.000Z",
        lastEvaluatedAt: "2026-06-09T20:10:00.000Z",
        fresh: false,
      },
    ],
    events: [
      {
        id: "event-spy-5m",
        symbol: "SPY",
        timeframe: "5m",
        direction: "buy",
        signalAt: "2026-06-09T20:05:00.000Z",
        emittedAt: "2026-06-09T20:11:00.000Z",
        signalPrice: 735.94,
        payload: {
          latestBarAt: "2026-06-09T20:10:00.000Z",
        },
      },
    ],
  });

  const cell = buildSignalMatrixBySymbol(merged, ["5m"]).SPY["5m"];

  assert.equal(cell.status, "ok");
  assert.equal(cell.currentSignalDirection, "buy");
  assert.equal(cell.currentSignalAt, "2026-06-09T20:05:00.000Z");
  assert.equal(cell.latestBarAt, "2026-06-09T20:10:00.000Z");
  assert.equal(cell.lastEvaluatedAt, "2026-06-09T20:11:00.000Z");
  assert.equal(cell.barsSinceSignal, 1);
  assert.equal(cell.fresh, false);
  assert.equal(cell.actionEligible, false);
  assert.equal(getCurrentSignalDirection(cell), "buy");
});

test("runtime fallback signal events are not canonical matrix merge input", () => {
  const events = [
    {
      id: "runtime-event-spy-5m",
      symbol: "SPY",
      timeframe: "5m",
      direction: "buy",
      signalAt: "2026-06-09T20:05:00.000Z",
      emittedAt: "2026-06-09T20:11:00.000Z",
    },
  ];

  assert.deepEqual(
    canonicalSignalMonitorEventsForMatrixMerge({
      events,
      sourceStatus: "runtime-fallback",
    }),
    [],
  );
  assert.deepEqual(
    canonicalSignalMonitorEventsForMatrixMerge({
      events,
      sourceStatus: "database",
    }),
    events,
  );

  const merged = mergeSignalEventsIntoMatrixStates({
    states: [
      {
        symbol: "SPY",
        timeframe: "5m",
        status: "stale",
        currentSignalDirection: null,
        currentSignalAt: null,
        latestBarAt: "2026-06-09T20:10:00.000Z",
        fresh: false,
      },
    ],
    events: canonicalSignalMonitorEventsForMatrixMerge({
      events,
      sourceStatus: "runtime-fallback",
    }),
  });
  const cell = buildSignalMatrixBySymbol(merged, ["5m"]).SPY["5m"];
  assert.equal(cell.currentSignalDirection, null);
  assert.equal(cell.displayHydrationSource, undefined);
});

test("signal monitor events create display matrix cells when no stored cell exists", () => {
  const state = signalMonitorEventToMatrixState({
    symbol: "CRWV",
    timeframe: "5m",
    direction: "sell",
    signalAt: "2026-06-09T20:00:00.000Z",
    close: 48.12,
  });

  assert.equal(state.symbol, "CRWV");
  assert.equal(state.timeframe, "5m");
  assert.equal(state.status, "ok");
  assert.equal(state.currentSignalDirection, "sell");
  assert.equal(state.currentSignalPrice, 48.12);
  assert.equal(state.displayHydrationSource, "signal_monitor_event");
  assert.equal(getCurrentSignalDirection(state), "sell");
});

test("stale stored signal states hydrate aged display bubbles without event overlay", () => {
  const merged = mergeSignalEventsIntoMatrixStates({
    states: [
      {
        symbol: "CRWV",
        timeframe: "1m",
        status: "stale",
        currentSignalDirection: "sell",
        currentSignalAt: "2026-06-08T17:02:00.000Z",
        latestBarAt: "2026-06-08T17:44:00.000Z",
        fresh: false,
      },
    ],
    events: [],
  });

  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, "ok");
  assert.equal(merged[0].fresh, false);
  assert.equal(merged[0].displayHydrationSource, "signal_monitor_stored_state");
  assert.equal(getCurrentSignalDirection(merged[0]), "sell");
});

test("signal monitor events do not clobber a newer current matrix signal", () => {
  const merged = mergeSignalEventsIntoMatrixStates({
    states: [
      {
        symbol: "AVGO",
        timeframe: "5m",
        status: "ok",
        currentSignalDirection: "buy",
        currentSignalAt: "2026-06-09T20:10:00.000Z",
        latestBarAt: "2026-06-09T20:10:00.000Z",
        fresh: true,
      },
    ],
    events: [
      {
        symbol: "AVGO",
        timeframe: "5m",
        direction: "sell",
        signalAt: "2026-06-09T20:00:00.000Z",
        emittedAt: "2026-06-09T20:01:00.000Z",
      },
    ],
  });

  assert.equal(merged.length, 1);
  assert.equal(merged[0].currentSignalDirection, "buy");
  assert.equal(merged[0].fresh, true);
});

test("event overlays are canonical before AlgoScreen display receives matrix states", () => {
  const rawState = {
    symbol: "NVDA",
    timeframe: "2m",
    status: "stale",
    currentSignalDirection: "buy",
    currentSignalAt: "2026-06-09T19:00:00.000Z",
    latestBarAt: "2026-06-09T19:50:00.000Z",
    lastEvaluatedAt: "2026-06-09T20:16:00.000Z",
    fresh: false,
  };
  const published = mergeSignalEventsIntoMatrixStates({
    states: [rawState],
    events: [
      {
        symbol: "NVDA",
        timeframe: "2m",
        direction: "sell",
        signalAt: "2026-06-09T19:11:00.000Z",
        emittedAt: "2026-06-09T19:21:34.508Z",
      },
    ],
  });

  const bySymbol = buildSignalMatrixBySymbol(
    published,
    ["2m"],
  );

  assert.equal(bySymbol.NVDA["2m"].status, "ok");
  assert.equal(bySymbol.NVDA["2m"].currentSignalDirection, "sell");
  assert.equal(
    bySymbol.NVDA["2m"].displayHydrationSource,
    "signal_monitor_event",
  );
  assert.equal(getCurrentSignalDirection(bySymbol.NVDA["2m"]), "sell");
});

test("signal monitor events do not downgrade an already-current matching matrix signal", () => {
  const merged = mergeSignalEventsIntoMatrixStates({
    states: [
      {
        symbol: "PLTR",
        timeframe: "5m",
        status: "ok",
        currentSignalDirection: "buy",
        currentSignalAt: "2026-06-09T20:00:00.000Z",
        latestBarAt: "2026-06-09T20:00:00.000Z",
        fresh: true,
      },
    ],
    events: [
      {
        symbol: "PLTR",
        timeframe: "5m",
        direction: "buy",
        signalAt: "2026-06-09T20:00:00.000Z",
        emittedAt: "2026-06-09T20:01:00.000Z",
      },
    ],
  });

  assert.equal(merged.length, 1);
  assert.equal(merged[0].displayHydrationSource, undefined);
  assert.equal(merged[0].fresh, true);
});
