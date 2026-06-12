import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSignalMatrixBySymbol,
  buildWatchlistRows,
} from "./watchlistModel.js";

test("signal matrix display index prefers real signal state over pending cells", () => {
  const states = [
    {
      symbol: "AAPL",
      timeframe: "5m",
      status: "ok",
      currentSignalDirection: "buy",
      currentSignalAt: "2026-06-08T13:30:00.000Z",
      latestBarAt: "2026-06-08T13:30:00.000Z",
      fresh: true,
    },
    {
      symbol: "AAPL",
      timeframe: "5m",
      status: "pending",
      currentSignalDirection: null,
      currentSignalAt: null,
      latestBarAt: null,
      fresh: false,
    },
  ];

  const bySymbol = buildSignalMatrixBySymbol(states, ["5m"]);

  assert.equal(bySymbol.AAPL["5m"].status, "ok");
  assert.equal(bySymbol.AAPL["5m"].currentSignalDirection, "buy");
});

test("signal matrix display index keeps the latest comparable state", () => {
  const states = [
    {
      symbol: "MSFT",
      timeframe: "5m",
      status: "stale",
      currentSignalDirection: "sell",
      currentSignalAt: "2026-06-08T12:00:00.000Z",
      latestBarAt: "2026-06-08T12:00:00.000Z",
      fresh: false,
    },
    {
      symbol: "MSFT",
      timeframe: "5m",
      status: "ok",
      currentSignalDirection: "buy",
      currentSignalAt: "2026-06-08T13:00:00.000Z",
      latestBarAt: "2026-06-08T13:00:00.000Z",
      fresh: false,
    },
  ];

  const bySymbol = buildSignalMatrixBySymbol(states, ["5m"]);

  assert.equal(bySymbol.MSFT["5m"].currentSignalDirection, "buy");
});

test("signal matrix display index keeps the latched signal over a no-signal copy", () => {
  // The signal matrix is a memory: a directionless evaluation never displaces
  // a latched buy/sell (the backend latches in eval/wire/DB; this pins the
  // same rule client-side). The directional copy wins wholesale — its bar
  // metadata updates on the next backend delta, never by client-side merging,
  // which is what used to fabricate impossible age/bar combinations.
  const states = [
    {
      symbol: "TSLA",
      timeframe: "5m",
      status: "ok",
      currentSignalDirection: "buy",
      currentSignalAt: "2026-06-08T12:00:00.000Z",
      latestBarAt: "2026-06-08T12:00:00.000Z",
      fresh: true,
    },
    {
      symbol: "TSLA",
      timeframe: "5m",
      status: "ok",
      currentSignalDirection: null,
      currentSignalAt: null,
      latestBarAt: "2026-06-08T13:00:00.000Z",
      lastEvaluatedAt: "2026-06-08T13:00:00.000Z",
      fresh: false,
    },
  ];

  const bySymbol = buildSignalMatrixBySymbol(states, ["5m"]);

  assert.equal(bySymbol.TSLA["5m"].currentSignalDirection, "buy");
  assert.equal(bySymbol.TSLA["5m"].latestBarAt, "2026-06-08T12:00:00.000Z");
});

test("watchlist rows still use broad signal states for monitored-only discovery", () => {
  const rows = buildWatchlistRows({
    activeWatchlist: {
      items: [{ id: "watch-aapl", symbol: "AAPL", name: "Apple" }],
    },
    signalStates: [
      { symbol: "AAPL", timeframe: "5m" },
      { symbol: "MSFT", timeframe: "5m" },
    ],
  });

  assert.deepEqual(
    rows.map((row) => [row.sym, row.monitoredOnly]),
    [
      ["AAPL", false],
      ["MSFT", true],
    ],
  );
});
