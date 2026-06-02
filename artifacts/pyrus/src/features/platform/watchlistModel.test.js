import assert from "node:assert/strict";
import test from "node:test";
import {
  WATCHLIST_SIGNAL_TIMEFRAMES,
  WATCHLIST_SORT_MODE,
  buildSignalMatrixBySymbol,
  buildWatchlistIdentityPayload,
  buildWatchlistRows,
  countWatchlistSymbols,
  getBestWatchlistSignalState,
  sortWatchlistRows,
} from "./watchlistModel.js";

test("buildWatchlistIdentityPayload normalizes ticker-search identity fields", () => {
  assert.deepEqual(
    buildWatchlistIdentityPayload({
      market: "stocks",
      primaryExchange: " XNAS ",
      countryCode: "US",
      exchangeCountryCode: "US",
      sector: "Technology",
      industry: "Semiconductors",
      empty: "",
    }),
    {
      market: "stocks",
      normalizedExchangeMic: "XNAS",
      exchangeDisplay: "XNAS",
      countryCode: "US",
      exchangeCountryCode: "US",
      sector: "Technology",
      industry: "Semiconductors",
    },
  );

  assert.deepEqual(buildWatchlistIdentityPayload(null), {});
});

test("buildWatchlistRows preserves canonical watchlist item metadata", () => {
  const rows = buildWatchlistRows({
    activeWatchlist: {
      id: "wl-1",
      items: [
        {
          id: "item-2",
          symbol: "qqq",
          name: "Nasdaq 100",
          market: "etf",
          normalizedExchangeMic: "XNAS",
          exchangeDisplay: "NASDAQ",
          countryCode: "US",
          exchangeCountryCode: "US",
          sector: "ETF",
          industry: "Growth Equity",
          sortOrder: 2,
          addedAt: "2026-04-25T00:00:00Z",
        },
      ],
    },
  });

  assert.deepEqual(rows, [
    {
      id: "item-2",
      key: "item-2",
      sym: "QQQ",
      name: "Nasdaq 100",
      source: "watchlist",
      monitoredOnly: false,
      market: "etf",
      normalizedExchangeMic: "XNAS",
      exchangeDisplay: "NASDAQ",
      countryCode: "US",
      exchangeCountryCode: "US",
      sector: "ETF",
      industry: "Growth Equity",
      sortOrder: 2,
      addedAt: "2026-04-25T00:00:00Z",
      canReorder: true,
      canRemove: true,
    },
  ]);
});

test("buildWatchlistRows keeps null identity fields for legacy rows", () => {
  const [row] = buildWatchlistRows({
    activeWatchlist: {
      symbols: ["SPY"],
    },
  });

  assert.deepEqual(
    {
      market: row.market,
      normalizedExchangeMic: row.normalizedExchangeMic,
      exchangeDisplay: row.exchangeDisplay,
      countryCode: row.countryCode,
      exchangeCountryCode: row.exchangeCountryCode,
      sector: row.sector,
      industry: row.industry,
    },
    {
      market: null,
      normalizedExchangeMic: null,
      exchangeDisplay: null,
      countryCode: null,
      exchangeCountryCode: null,
      sector: null,
      industry: null,
    },
  );
});

test("buildWatchlistRows supports legacy symbol arrays", () => {
  const rows = buildWatchlistRows({
    activeWatchlist: {
      id: "default",
      name: "Default",
      symbols: ["SPY", "qqq", "SPY", ""],
    },
  });

  assert.deepEqual(
    rows.map((row) => [row.sym, row.monitoredOnly, row.canReorder]),
    [
      ["SPY", false, false],
      ["QQQ", false, false],
    ],
  );
  assert.equal(countWatchlistSymbols({ symbols: ["SPY", "QQQ"] }), 2);
});

test("buildWatchlistRows appends monitored-only symbols without duplicating active rows", () => {
  const rows = buildWatchlistRows({
    activeWatchlist: {
      id: "default",
      items: [{ id: "spy-item", symbol: "SPY", name: "S&P 500" }],
    },
    signalStates: [
      { symbol: "SPY", currentSignalDirection: "buy" },
      { symbol: "NVDA", currentSignalDirection: "sell" },
    ],
  });

  assert.deepEqual(
    rows.map((row) => [row.sym, row.monitoredOnly, row.source]),
    [
      ["SPY", false, "watchlist"],
      ["NVDA", true, "monitor"],
    ],
  );
});

test("sortWatchlistRows ranks fresh signals, aged signals, and quote fields", () => {
  const rows = buildWatchlistRows({
    activeWatchlist: { symbols: ["SPY", "QQQ", "NVDA"] },
  });
  const signalSorted = sortWatchlistRows(rows, {
    mode: WATCHLIST_SORT_MODE.SIGNAL,
    signalMatrixBySymbol: buildSignalMatrixBySymbol([
      { symbol: "SPY", timeframe: "5m", currentSignalDirection: "buy", fresh: false, barsSinceSignal: 6 },
      { symbol: "QQQ", timeframe: "2m", currentSignalDirection: "sell", fresh: true, barsSinceSignal: 1 },
      { symbol: "NVDA", timeframe: "15m", currentSignalDirection: null, fresh: false },
    ]),
  });

  assert.deepEqual(
    signalSorted.map((row) => row.sym),
    ["QQQ", "SPY", "NVDA"],
  );

  const percentSorted = sortWatchlistRows(rows, {
    mode: WATCHLIST_SORT_MODE.PERCENT,
    direction: "desc",
    snapshotsBySymbol: {
      SPY: { pct: 0.3 },
      QQQ: { pct: -0.5 },
      NVDA: { pct: 2.4 },
    },
  });

  assert.deepEqual(
    percentSorted.map((row) => row.sym),
    ["NVDA", "SPY", "QQQ"],
  );
});

test("watchlist signal matrix groups timeframe dots by symbol", () => {
  assert.deepEqual(WATCHLIST_SIGNAL_TIMEFRAMES, ["1m", "2m", "5m", "15m", "1h"]);
  const matrix = buildSignalMatrixBySymbol([
    { symbol: "SPY", timeframe: "1m", currentSignalDirection: "sell", fresh: false },
    { symbol: "spy", timeframe: "2m", currentSignalDirection: "buy", fresh: true },
    { symbol: "SPY", timeframe: "5m", currentSignalDirection: "sell", fresh: false },
    { symbol: "QQQ", timeframe: "1h", currentSignalDirection: "buy", fresh: true },
    { symbol: "IWM", timeframe: "1d", currentSignalDirection: "buy", fresh: true },
  ]);

  assert.equal(matrix.SPY["1m"].currentSignalDirection, "sell");
  assert.equal(matrix.SPY["2m"].currentSignalDirection, "buy");
  assert.equal(matrix.SPY["5m"].currentSignalDirection, "sell");
  assert.equal(matrix.QQQ["1h"].currentSignalDirection, "buy");
  assert.equal(matrix.IWM, undefined);
});

test("signal sort ignores legacy monitor state when matrix is missing", () => {
  const rows = buildWatchlistRows({
    activeWatchlist: { symbols: ["SPY", "QQQ", "NVDA"] },
  });
  const signalMatrixBySymbol = buildSignalMatrixBySymbol([
    { symbol: "SPY", timeframe: "2m", currentSignalDirection: "buy", fresh: false, barsSinceSignal: 8 },
    { symbol: "QQQ", timeframe: "15m", currentSignalDirection: "sell", fresh: true, barsSinceSignal: 0 },
  ]);

  assert.equal(
    getBestWatchlistSignalState(signalMatrixBySymbol.SPY).currentSignalDirection,
    "buy",
  );
  assert.equal(
    getBestWatchlistSignalState(undefined, {
      symbol: "NVDA",
      currentSignalDirection: "buy",
      fresh: true,
    }),
    null,
  );

  const sorted = sortWatchlistRows(rows, {
    mode: WATCHLIST_SORT_MODE.SIGNAL,
    signalMatrixBySymbol,
  });

  assert.deepEqual(
    sorted.map((row) => row.sym),
    ["QQQ", "SPY", "NVDA"],
  );
});

test("signal sort ignores stale matrix directions", () => {
  const rows = buildWatchlistRows({
    activeWatchlist: { symbols: ["SPY", "QQQ"] },
  });
  const signalMatrixBySymbol = buildSignalMatrixBySymbol([
    {
      symbol: "SPY",
      timeframe: "1m",
      status: "stale",
      currentSignalDirection: "buy",
      fresh: false,
      barsSinceSignal: 1,
    },
    {
      symbol: "QQQ",
      timeframe: "5m",
      status: "ok",
      currentSignalDirection: "sell",
      fresh: false,
      barsSinceSignal: 8,
    },
  ]);

  assert.equal(getBestWatchlistSignalState(signalMatrixBySymbol.SPY), null);
  assert.equal(
    getBestWatchlistSignalState(signalMatrixBySymbol.QQQ).currentSignalDirection,
    "sell",
  );
  assert.deepEqual(
    sortWatchlistRows(rows, {
      mode: WATCHLIST_SORT_MODE.SIGNAL,
      signalMatrixBySymbol,
    }).map((row) => row.sym),
    ["QQQ", "SPY"],
  );
});
