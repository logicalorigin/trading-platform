import assert from "node:assert/strict";
import test from "node:test";
import {
  WATCHLIST_SIGNAL_TIMEFRAMES,
  WATCHLIST_SORT_MODE,
  activeWatchlistSymbols,
  allWatchlistSymbols,
  buildSignalMatrixBySymbol,
  buildWatchlistBadges,
  buildWatchlistEarningsSymbols,
  buildWatchlistFlowBySymbol,
  buildWatchlistIdentityPayload,
  buildWatchlistPositionSymbols,
  buildWatchlistRows,
  countWatchlistSymbols,
  formatWatchlistSignalBars,
  getBestWatchlistSignalState,
  sortWatchlistRows,
  widerUniverseSymbols,
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

test("watchlist symbol helpers preserve priority and de-dupe symbols", () => {
  const watchlists = [
    {
      id: "growth",
      symbols: ["spy", "QQQ", "spy"],
    },
    {
      id: "semis",
      items: [
        { symbol: "nvda" },
        { sym: "AMD" },
        { symbol: "qqq" },
      ],
    },
  ];

  assert.deepEqual(activeWatchlistSymbols(watchlists[0]), ["SPY", "QQQ"]);
  assert.deepEqual(allWatchlistSymbols(watchlists), ["SPY", "QQQ", "NVDA", "AMD"]);
  assert.deepEqual(
    widerUniverseSymbols({
      watchlists,
      universeSymbols: ["AAPL", "NVDA", "MSFT"],
    }),
    ["SPY", "QQQ", "NVDA", "AMD", "AAPL", "MSFT"],
  );
  assert.deepEqual(
    allWatchlistSymbols([], ["iwm", "SPY", ""]),
    ["IWM", "SPY"],
  );
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

test("sortWatchlistRows ranks fresh signals, stale signals, and quote fields", () => {
  const rows = buildWatchlistRows({
    activeWatchlist: { symbols: ["SPY", "QQQ", "NVDA"] },
  });
  const signalSorted = sortWatchlistRows(rows, {
    mode: WATCHLIST_SORT_MODE.SIGNAL,
    signalStatesBySymbol: {
      SPY: { symbol: "SPY", currentSignalDirection: "buy", fresh: false, barsSinceSignal: 6 },
      QQQ: { symbol: "QQQ", currentSignalDirection: "sell", fresh: true, barsSinceSignal: 1 },
      NVDA: { symbol: "NVDA", currentSignalDirection: null, fresh: false },
    },
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
  assert.deepEqual(WATCHLIST_SIGNAL_TIMEFRAMES, ["2m", "5m", "15m"]);
  const matrix = buildSignalMatrixBySymbol([
    { symbol: "spy", timeframe: "2m", currentSignalDirection: "buy", fresh: true },
    { symbol: "SPY", timeframe: "5m", currentSignalDirection: "sell", fresh: false },
    { symbol: "QQQ", timeframe: "1h", currentSignalDirection: "buy", fresh: true },
  ]);

  assert.equal(matrix.SPY["2m"].currentSignalDirection, "buy");
  assert.equal(matrix.SPY["5m"].currentSignalDirection, "sell");
  assert.equal(matrix.QQQ, undefined);
});

test("signal sort prefers fresh matrix dots over legacy monitor state", () => {
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

  const sorted = sortWatchlistRows(rows, {
    mode: WATCHLIST_SORT_MODE.SIGNAL,
    signalStatesBySymbol: {
      NVDA: { symbol: "NVDA", currentSignalDirection: "buy", fresh: true, barsSinceSignal: 1 },
    },
    signalMatrixBySymbol,
  });

  assert.deepEqual(
    sorted.map((row) => row.sym),
    ["QQQ", "NVDA", "SPY"],
  );
});

test("formatWatchlistSignalBars keeps compact badge labels", () => {
  assert.equal(formatWatchlistSignalBars(0), "0");
  assert.equal(formatWatchlistSignalBars(18.9), "18");
  assert.equal(formatWatchlistSignalBars(99), "99");
  assert.equal(formatWatchlistSignalBars(100), "99+");
  assert.equal(formatWatchlistSignalBars(null), "-");
});

test("watchlist badge helpers aggregate flow, positions, and earnings symbols", () => {
  const nowMs = Date.parse("2026-05-05T16:00:00.000Z");

  assert.deepEqual(
    buildWatchlistPositionSymbols([
      { symbol: "SPY" },
      { symbol: "NVDA 260515C900", optionContract: { underlying: "nvda" } },
      { underlyingSymbol: "msft" },
    ]),
    ["SPY", "NVDA", "MSFT"],
  );

  assert.deepEqual(
    buildWatchlistEarningsSymbols(
      [
        { symbol: "nvda", date: "2026-05-06" },
        { symbol: "AAPL", date: "2026-05-25" },
        { symbol: "MSFT", date: "2026-05-01" },
      ],
      { nowMs, horizonDays: 14 },
    ),
    ["NVDA"],
  );

  const flowBySymbol = buildWatchlistFlowBySymbol(
    [
      {
        underlying: "nvda",
        premium: 350_000,
        unusualScore: 2.2,
        occurredAt: "2026-05-05T15:55:00.000Z",
      },
      {
        ticker: "NVDA",
        premium: 90_000,
        isUnusual: true,
        occurredAt: "2026-05-05T15:58:00.000Z",
      },
      {
        underlying: "AAPL",
        premium: 500_000,
        occurredAt: "2026-05-05T12:00:00.000Z",
      },
    ],
    { nowMs },
  );

  assert.deepEqual(
    {
      count: flowBySymbol.NVDA.count,
      premium: flowBySymbol.NVDA.premium,
      latestAt: flowBySymbol.NVDA.latestAt,
    },
    {
      count: 2,
      premium: 440_000,
      latestAt: "2026-05-05T15:58:00.000Z",
    },
  );
  assert.equal(flowBySymbol.AAPL, undefined);
});

test("buildWatchlistBadges returns compact badges for active row state", () => {
  const badges = buildWatchlistBadges({
    symbol: "nvda",
    selectedSymbol: "NVDA",
    snapshot: {
      price: 905,
      updatedAt: "2026-05-05T15:50:00.000Z",
    },
    signalState: {
      currentSignalDirection: "buy",
      fresh: true,
    },
    earningsSymbols: new Set(["NVDA"]),
    flowBySymbol: new Map([
      ["NVDA", { count: 2, premium: 440_000 }],
    ]),
    positionSymbols: ["nvda"],
    nowMs: Date.parse("2026-05-05T16:00:00.000Z"),
  });

  assert.deepEqual(
    badges.map((badge) => [badge.id, badge.label, badge.tone]),
    [
      ["linked", "LINK", "linked"],
      ["earnings", "EARN", "earnings"],
      ["signal", "BUY", "buy"],
      ["flow", "FLOW+", "flow"],
      ["position", "POS", "position"],
    ],
  );
});

test("buildWatchlistBadges reports no-data and stale quote states", () => {
  assert.deepEqual(
    buildWatchlistBadges({ symbol: "SPY", snapshot: null }).map((badge) => badge.id),
    ["no-data"],
  );

  assert.deepEqual(
    buildWatchlistBadges({
      symbol: "SPY",
      snapshot: {
        price: 510,
        updatedAt: "2026-05-05T15:00:00.000Z",
      },
      nowMs: Date.parse("2026-05-05T16:00:00.000Z"),
    }).map((badge) => badge.id),
    ["stale"],
  );
});
