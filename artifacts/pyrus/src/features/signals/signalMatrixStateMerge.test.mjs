import assert from "node:assert/strict";
import test from "node:test";

import { buildSignalMatrixBySymbol } from "../platform/watchlistModel.js";
import { getCurrentSignalDirection } from "./signalStateFreshness.js";
import { preferSignalMatrixCellState } from "./signalMatrixStateMerge.js";

// The backend latches direction across directionless re-evaluations (eval,
// SSE wire, DB), so the frontend merge only ranks copies of a cell. These
// tests pin that ranking: a real signal can never be displaced by a copy
// whose only claim is newer bar metadata.

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
  // The directional cell wins outright in both argument orders. (The backend
  // wire latch means directionless updates for latched cells should no longer
  // arrive at all; this pins the client-side safety ordering.)
  assert.equal(
    preferSignalMatrixCellState(cached, directionlessNewer),
    cached,
  );
  assert.equal(
    preferSignalMatrixCellState(directionlessNewer, cached),
    cached,
  );
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

test("matrix cell merge treats filterState as a real state change", () => {
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
    filterState: null,
  };
  const candidate = {
    ...current,
    filterState: { mtfDirections: [1, 1, 1], adx: 30 },
  };

  assert.equal(preferSignalMatrixCellState(current, candidate), candidate);
});

test("matrix cell merge treats latestBarClose as a real state change", () => {
  const current = {
    symbol: "CEG",
    timeframe: "5m",
    status: "ok",
    currentSignalDirection: "buy",
    currentSignalAt: "2026-06-12T16:25:00.000Z",
    latestBarAt: "2026-06-12T16:30:00.000Z",
    lastEvaluatedAt: "2026-06-12T16:30:00.000Z",
    currentSignalClose: 90,
    latestBarClose: 93.12,
    barsSinceSignal: 1,
    fresh: true,
    active: true,
  };
  const candidate = {
    ...current,
    latestBarClose: 94.5,
  };

  assert.equal(preferSignalMatrixCellState(current, candidate), candidate);
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

test("backend fields pass through the merge unrewritten", () => {
  const newer = {
    symbol: "NVDA",
    timeframe: "5m",
    status: "stale",
    currentSignalDirection: "buy",
    currentSignalAt: "2026-06-12T16:25:00.000Z",
    latestBarAt: "2026-06-12T17:10:00.000Z",
    lastEvaluatedAt: "2026-06-12T17:10:00.000Z",
    barsSinceSignal: 9,
    fresh: false,
    actionEligible: false,
    actionBlocker: "data_stale",
  };
  const older = {
    ...newer,
    latestBarAt: "2026-06-12T16:30:00.000Z",
    lastEvaluatedAt: "2026-06-12T16:30:00.000Z",
    barsSinceSignal: 1,
    status: "ok",
    actionEligible: true,
    actionBlocker: null,
  };

  const result = preferSignalMatrixCellState(older, newer);
  assert.equal(result, newer);
  assert.equal(result.barsSinceSignal, 9);
  assert.equal(result.fresh, false);
  assert.equal(result.actionEligible, false);
  assert.equal(result.actionBlocker, "data_stale");
});

test("stale states keep their latched direction for display without rewrites", () => {
  // status "stale" styles a signal; it does not hide it. No client-side
  // stale->ok rewrite exists any more — the display helper reads the latched
  // direction straight off the state.
  const staleState = {
    symbol: "CRWV",
    timeframe: "1m",
    status: "stale",
    currentSignalDirection: "sell",
    currentSignalAt: "2026-06-08T17:02:00.000Z",
    latestBarAt: "2026-06-08T17:44:00.000Z",
    fresh: false,
  };

  assert.equal(getCurrentSignalDirection(staleState), "sell");
  const cell = buildSignalMatrixBySymbol([staleState], ["1m"]).CRWV["1m"];
  assert.equal(cell.status, "stale");
  assert.equal(getCurrentSignalDirection(cell), "sell");
});

test("error and unavailable states hide their direction", () => {
  const base = {
    symbol: "CRWV",
    timeframe: "1m",
    currentSignalDirection: "sell",
    currentSignalAt: "2026-06-08T17:02:00.000Z",
    latestBarAt: "2026-06-08T17:44:00.000Z",
    fresh: false,
  };
  assert.equal(getCurrentSignalDirection({ ...base, status: "error" }), "");
  assert.equal(getCurrentSignalDirection({ ...base, status: "unavailable" }), "");
  assert.equal(getCurrentSignalDirection({ ...base, active: false }), "");
});
