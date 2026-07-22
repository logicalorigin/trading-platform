import assert from "node:assert/strict";
import test from "node:test";

import {
  __shadowWatchlistBacktestInternalsForTests as internals,
  selectShadowPositionDayChange,
  shadowPositionMarkStaleForDayChange,
} from "./shadow-account";

test("live long-option day P&L uses executable bid instead of ask-inflated midpoint", () => {
  const receivedAt = new Date();
  const result = internals.buildShadowPositionDayChangeFromQuote({
    quantity: 1,
    multiplier: 100,
    quote: {
      bid: 2.75,
      ask: 3.8,
      prevClose: 2.5,
      freshness: "live",
      marketDataMode: "live",
      latency: { apiServerReceivedAt: receivedAt },
    },
  });

  assert.equal(result.dayChange, 25);
  assert.equal(result.dayChangePercent, 10);
});

test("account Day P&L uses the prior trading close, matching the calendar", () => {
  const result = internals.calculateLatestShadowMarketDayPnlFromHistory([
    {
      timestamp: new Date("2026-07-15T20:00:00.000Z"),
      netLiquidation: 100_000,
      deposits: 0,
      withdrawals: 0,
    },
    {
      timestamp: new Date("2026-07-16T13:30:00.000Z"),
      netLiquidation: 101_000,
      deposits: 0,
      withdrawals: 0,
    },
    {
      timestamp: new Date("2026-07-16T20:00:00.000Z"),
      netLiquidation: 102_500,
      deposits: 0,
      withdrawals: 0,
    },
  ] as never);

  assert.equal(result?.marketDate, "2026-07-16");
  assert.equal(result?.value, 2_500);
  assert.equal(result?.capitalBase, 100_000);
});

test("shadow 1D history begins at the prior trading close", () => {
  assert.equal(
    internals
      .shadowEquityHistoryRangeStart(
        "1D",
        new Date("2026-07-17T03:00:00.000Z"),
      )
      ?.toISOString(),
    "2026-07-15T20:00:00.000Z",
  );
});

test("weekend account Day P&L remains on Friday and 1D starts at Thursday close", () => {
  const result = internals.calculateLatestShadowMarketDayPnlFromHistory([
    {
      timestamp: new Date("2026-07-16T20:00:00.000Z"),
      netLiquidation: 100_000,
      deposits: 0,
      withdrawals: 0,
    },
    {
      timestamp: new Date("2026-07-17T20:00:00.000Z"),
      netLiquidation: 102_000,
      deposits: 0,
      withdrawals: 0,
    },
    {
      timestamp: new Date("2026-07-18T16:00:00.000Z"),
      netLiquidation: 102_000,
      deposits: 0,
      withdrawals: 0,
    },
  ] as never);

  assert.equal(result?.marketDate, "2026-07-17");
  assert.equal(result?.value, 2_000);
  assert.equal(
    internals
      .shadowEquityHistoryRangeStart(
        "1D",
        new Date("2026-07-18T16:00:00.000Z"),
      )
      ?.toISOString(),
    "2026-07-16T20:00:00.000Z",
  );
});

test("full-market holiday account Day P&L remains on the prior session", () => {
  const result = internals.calculateLatestShadowMarketDayPnlFromHistory([
    {
      timestamp: new Date("2026-07-01T20:00:00.000Z"),
      netLiquidation: 100_000,
      deposits: 0,
      withdrawals: 0,
    },
    {
      timestamp: new Date("2026-07-02T20:00:00.000Z"),
      netLiquidation: 102_000,
      deposits: 0,
      withdrawals: 0,
    },
    {
      timestamp: new Date("2026-07-03T16:00:00.000Z"),
      netLiquidation: 102_000,
      deposits: 0,
      withdrawals: 0,
    },
  ] as never);

  assert.equal(result?.marketDate, "2026-07-02");
  assert.equal(result?.value, 2_000);
  assert.equal(
    internals
      .shadowEquityHistoryRangeStart(
        "1D",
        new Date("2026-07-03T16:00:00.000Z"),
      )
      ?.toISOString(),
    "2026-07-01T20:00:00.000Z",
  );
});

// Regression for the "prior-day shadow options show $0 day change" bug (e.g. RH, ABSI):
// a gaining prior-day option (baseline mark 1920 -> current 2920 => +$1000) rendered $0
// because the unreliable option-quote day change (0) overrode the accurate baseline.
test("prior-day position prefers the accurate baseline over a zero option-quote day change", () => {
  const result = selectShadowPositionDayChange({
    sameDayPosition: false,
    valuationEligible: true,
    // For a prior-day position the caller passes quoteDayChange here; it must NOT win.
    valuationDayChange: { dayChange: 0, dayChangePercent: 0 },
    storedDayChange: { dayChange: 1000, dayChangePercent: 52.08 },
    quoteDayChange: { dayChange: 0, dayChangePercent: 0 },
  });
  assert.equal(result.dayChange, 1000);
  assert.equal(result.dayChangePercent, 52.08);
});

test("same-day position uses the live-mark valuation day change", () => {
  const result = selectShadowPositionDayChange({
    sameDayPosition: true,
    valuationEligible: true,
    valuationDayChange: { dayChange: 400, dayChangePercent: 28.17 },
    storedDayChange: { dayChange: 400, dayChangePercent: 28.17 },
    quoteDayChange: { dayChange: 0, dayChangePercent: 0 },
  });
  assert.equal(result.dayChange, 400);
});

test("prior-day position falls back to the option quote only when there is no baseline", () => {
  const result = selectShadowPositionDayChange({
    sameDayPosition: false,
    valuationEligible: true,
    valuationDayChange: { dayChange: 270, dayChangePercent: 17.4 },
    storedDayChange: { dayChange: null, dayChangePercent: null },
    quoteDayChange: { dayChange: 270, dayChangePercent: 17.4 },
  });
  assert.equal(result.dayChange, 270);
});

test("returns the (null) stored day change when nothing is available", () => {
  const result = selectShadowPositionDayChange({
    sameDayPosition: false,
    valuationEligible: true,
    valuationDayChange: null,
    storedDayChange: { dayChange: null, dayChangePercent: null },
    quoteDayChange: null,
  });
  assert.equal(result.dayChange, null);
});

// Regression for the "same-day option with no post-fill quote serves $0" bug
// (2026-07-09: UCTT/SAIL/HON opened intraday, quote fetch failed all session, mark
// stayed on the opening fill => marketValue == entry baseline => fabricated $0 day
// change instead of the honest unknown/null).
test("mark still sitting on the opening fill is stale for day change", () => {
  const dayStart = new Date("2026-07-09T04:00:00.000Z");
  const openedAt = new Date("2026-07-09T17:58:15.605Z");
  assert.equal(
    shadowPositionMarkStaleForDayChange({
      asOf: openedAt, // never re-observed after the fill
      openedAt,
      dayStart,
    }),
    true,
  );
});

test("mark observed after the opening fill is fresh for day change", () => {
  const dayStart = new Date("2026-07-09T04:00:00.000Z");
  assert.equal(
    shadowPositionMarkStaleForDayChange({
      asOf: new Date("2026-07-09T19:30:00.000Z"),
      openedAt: new Date("2026-07-09T17:58:15.605Z"),
      dayStart,
    }),
    false,
  );
});

test("mark from before the day-change baseline stays stale", () => {
  assert.equal(
    shadowPositionMarkStaleForDayChange({
      asOf: new Date("2026-07-08T20:00:00.000Z"),
      openedAt: new Date("2026-07-01T14:30:00.000Z"),
      dayStart: new Date("2026-07-09T04:00:00.000Z"),
    }),
    true,
  );
});

test("missing openedAt falls back to baseline-only staleness", () => {
  assert.equal(
    shadowPositionMarkStaleForDayChange({
      asOf: new Date("2026-07-09T19:30:00.000Z"),
      openedAt: null,
      dayStart: new Date("2026-07-09T04:00:00.000Z"),
    }),
    false,
  );
});
