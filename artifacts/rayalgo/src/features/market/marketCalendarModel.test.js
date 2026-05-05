import assert from "node:assert/strict";
import test from "node:test";
import {
  attachMarketCalendarRelations,
  buildMarketCalendarEventsFromEarnings,
  buildMarketCalendarMonthGrid,
  filterMarketCalendarEvents,
  getMarketCalendarMonthWindow,
  normalizeMarketCalendarTiming,
  paginateMarketCalendarUniverse,
  resolveMarketCalendarProviderStatus,
  shiftMarketCalendarMonth,
} from "./marketCalendarModel.js";

const earningsEntry = (overrides = {}) => ({
  symbol: "AAPL",
  date: "2026-05-07",
  time: "bmo",
  epsEstimated: 1.45,
  revenueEstimated: 94_000_000_000,
  fiscalDateEnding: "2026-03-31",
  ...overrides,
});

test("buildMarketCalendarEventsFromEarnings normalizes extensible earnings events", () => {
  const events = buildMarketCalendarEventsFromEarnings([
    earningsEntry({ symbol: " nvda ", date: "2026-05-20", time: "amc" }),
  ]);

  assert.equal(events.length, 1);
  assert.equal(events[0].id, "earnings:NVDA:2026-05-20:amc:2026-03-31");
  assert.equal(events[0].symbol, "NVDA");
  assert.equal(events[0].eventType, "earnings");
  assert.equal(events[0].eventTypeLabel, "Earnings");
  assert.equal(events[0].timing, "amc");
  assert.equal(events[0].timingLabel, "AMC");
  assert.equal(events[0].provider, "fmp");
});

test("normalizeMarketCalendarTiming handles provider timing variants", () => {
  assert.equal(normalizeMarketCalendarTiming("Before Market Open"), "bmo");
  assert.equal(normalizeMarketCalendarTiming("after close"), "amc");
  assert.equal(normalizeMarketCalendarTiming("During Market Hours"), "dmh");
  assert.equal(normalizeMarketCalendarTiming("16:05:00"), "scheduled");
  assert.equal(normalizeMarketCalendarTiming(null), "unknown");
});

test("buildMarketCalendarMonthGrid creates a stable six-week month grid", () => {
  const events = buildMarketCalendarEventsFromEarnings([
    earningsEntry({ symbol: "AAPL", date: "2026-05-07" }),
    earningsEntry({ symbol: "MSFT", date: "2026-05-07", time: "amc" }),
  ]);
  const grid = buildMarketCalendarMonthGrid({
    monthDate: new Date(Date.UTC(2026, 4, 10)),
    events,
  });

  assert.equal(grid.from, "2026-05-01");
  assert.equal(grid.to, "2026-05-31");
  assert.equal(grid.days.length, 42);
  assert.equal(grid.weeks.length, 6);
  assert.equal(grid.days[0].date, "2026-04-26");

  const may7 = grid.days.find((day) => day.date === "2026-05-07");
  assert.equal(may7.events.length, 2);
  assert.deepEqual(
    may7.events.map((event) => event.symbol),
    ["AAPL", "MSFT"],
  );
});

test("filterMarketCalendarEvents respects scope, event type, timing, and date range", () => {
  const events = attachMarketCalendarRelations(
    buildMarketCalendarEventsFromEarnings([
      earningsEntry({ symbol: "AAPL", date: "2026-05-07", time: "bmo" }),
      earningsEntry({ symbol: "MSFT", date: "2026-05-08", time: "amc" }),
      earningsEntry({ symbol: "TSLA", date: "2026-05-20", time: "dmh" }),
    ]),
    {
      activeWatchlistSymbols: ["AAPL"],
      allWatchlistSymbols: ["AAPL", "MSFT"],
      heldSymbols: ["TSLA"],
    },
  );

  assert.deepEqual(
    filterMarketCalendarEvents(events, { scope: "active_watchlist" }).map(
      (event) => event.symbol,
    ),
    ["AAPL"],
  );
  assert.deepEqual(
    filterMarketCalendarEvents(events, { scope: "all_watchlists" }).map(
      (event) => event.symbol,
    ),
    ["AAPL", "MSFT"],
  );
  assert.deepEqual(
    filterMarketCalendarEvents(events, { scope: "held_positions" }).map(
      (event) => event.symbol,
    ),
    ["TSLA"],
  );
  assert.deepEqual(
    filterMarketCalendarEvents(events, {
      scope: "universe",
      timing: "amc",
      from: "2026-05-01",
      to: "2026-05-10",
    }).map((event) => event.symbol),
    ["MSFT"],
  );
});

test("paginateMarketCalendarUniverse dedupes symbols and preserves next-event order", () => {
  const events = attachMarketCalendarRelations(
    buildMarketCalendarEventsFromEarnings([
      earningsEntry({ symbol: "NVDA", date: "2026-05-20" }),
      earningsEntry({ symbol: "AAPL", date: "2026-05-07" }),
      earningsEntry({ symbol: "AAPL", date: "2026-05-27" }),
      earningsEntry({ symbol: "MSFT", date: "2026-05-08" }),
    ]),
    { allWatchlistSymbols: ["AAPL"] },
  );
  const firstPage = paginateMarketCalendarUniverse(events, {
    page: 0,
    pageSize: 2,
  });
  const secondPage = paginateMarketCalendarUniverse(events, {
    page: 1,
    pageSize: 2,
  });

  assert.equal(firstPage.total, 3);
  assert.equal(firstPage.pageCount, 2);
  assert.deepEqual(
    firstPage.rows.map((row) => [row.symbol, row.count, row.nextDate]),
    [
      ["AAPL", 2, "2026-05-07"],
      ["MSFT", 1, "2026-05-08"],
    ],
  );
  assert.deepEqual(secondPage.rows.map((row) => row.symbol), ["NVDA"]);
});

test("calendar month helpers expose query windows and navigation dates", () => {
  const window = getMarketCalendarMonthWindow("2026-05-15");
  const previous = getMarketCalendarMonthWindow(
    shiftMarketCalendarMonth("2026-05-15", -1),
  );
  const next = getMarketCalendarMonthWindow(
    shiftMarketCalendarMonth("2026-05-15", 1),
  );

  assert.equal(window.from, "2026-05-01");
  assert.equal(window.to, "2026-05-31");
  assert.equal(previous.monthKey, "2026-04");
  assert.equal(next.monthKey, "2026-06");
});

test("resolveMarketCalendarProviderStatus distinguishes loading and degraded states", () => {
  assert.equal(
    resolveMarketCalendarProviderStatus({ researchConfigured: false }).status,
    "research_off",
  );
  assert.equal(
    resolveMarketCalendarProviderStatus({
      researchConfigured: true,
      isPending: true,
    }).status,
    "loading",
  );
  assert.equal(
    resolveMarketCalendarProviderStatus({
      researchConfigured: true,
      isError: true,
    }).status,
    "degraded",
  );
  assert.equal(
    resolveMarketCalendarProviderStatus({
      researchConfigured: true,
      eventCount: 3,
    }).status,
    "live",
  );
});
