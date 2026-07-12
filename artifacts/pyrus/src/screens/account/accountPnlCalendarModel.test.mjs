import assert from "node:assert/strict";
import test from "node:test";

process.env.TZ = "Asia/Tokyo";

const { buildDailyPnlSeries, buildMonthPnlCalendarModel } = await import(
  "./accountPnlCalendarModel.js"
);

const dayByIso = (days, iso) => days.find((day) => day.iso === iso);

test("equity-history P&L buckets by New York market date, not browser-local day", () => {
  const series = buildDailyPnlSeries({
    equityPoints: [
      {
        timestamp: "2026-06-25T20:00:00.000Z",
        netLiquidation: 1000,
      },
      {
        timestamp: "2026-06-26T20:00:00.000Z",
        netLiquidation: 900,
      },
    ],
    startDate: new Date("2026-06-25T00:00:00.000Z"),
    endDate: new Date("2026-06-30T00:00:00.000Z"),
  });

  const activeDays = series
    .filter((day) => day.pnl !== 0)
    .map((day) => ({
      iso: day.iso,
      pnl: day.pnl,
      pnlSource: day.pnlSource,
    }));

  assert.deepEqual(activeDays, [
    { iso: "2026-06-26", pnl: -100, pnlSource: "total" },
  ]);
});

test("today uses whole-account NAV P&L instead of the open-position header metric", () => {
  const model = buildMonthPnlCalendarModel({
    trades: [
      {
        id: "closed-loss",
        source: "SHADOW",
        closeDate: "2026-07-09T18:00:00.000Z",
        realizedPnl: -50,
      },
    ],
    equityPoints: [
      { timestamp: "2026-07-08T20:00:00.000Z", netLiquidation: 1000 },
      { timestamp: "2026-07-09T19:00:00.000Z", netLiquidation: 1050 },
    ],
    dailyPnl: {
      marketDate: "2026-07-09",
      totalDayPnl: 100,
      realizedDayPnl: -50,
      realizedTradeCount: 1,
      openPositionsDayPnl: 100,
    },
    monthDate: new Date(2026, 6, 1),
    today: new Date(2026, 6, 9, 12),
  });

  const day = dayByIso(model.days, "2026-07-09");
  assert.equal(day.pnl, 50);
  assert.equal(day.total, 50);
  assert.equal(day.realized, -50);
  assert.equal(day.unrealized, 100);
  assert.equal(day.pnlSource, "total");
});

test("a completed calendar day keeps the same whole-account value after midnight", () => {
  const shared = {
    trades: [
      {
        id: "closed-loss",
        source: "SHADOW",
        closeDate: "2026-07-09T18:00:00.000Z",
        realizedPnl: -50,
      },
    ],
    equityPoints: [
      { timestamp: "2026-07-08T20:00:00.000Z", netLiquidation: 1000 },
      { timestamp: "2026-07-09T19:00:00.000Z", netLiquidation: 1050 },
    ],
    monthDate: new Date(2026, 6, 1),
  };
  const beforeMidnight = buildMonthPnlCalendarModel({
    ...shared,
    dailyPnl: { marketDate: "2026-07-09", totalDayPnl: 100 },
    today: new Date(2026, 6, 9, 23, 59),
  });
  const afterMidnight = buildMonthPnlCalendarModel({
    ...shared,
    dailyPnl: { marketDate: "2026-07-10", totalDayPnl: 0 },
    today: new Date(2026, 6, 10, 0, 1),
  });

  assert.equal(dayByIso(beforeMidnight.days, "2026-07-09").pnl, 50);
  assert.equal(
    dayByIso(beforeMidnight.days, "2026-07-09").pnl,
    dayByIso(afterMidnight.days, "2026-07-09").pnl,
  );
});

test("whole-account P&L removes deposits from the NAV change", () => {
  const series = buildDailyPnlSeries({
    equityPoints: [
      { timestamp: "2026-07-08T20:00:00.000Z", netLiquidation: 1000 },
      {
        timestamp: "2026-07-09T20:00:00.000Z",
        netLiquidation: 2100,
        deposits: 1000,
      },
    ],
    startDate: "2026-07-08",
    endDate: "2026-07-09",
  });

  const day = dayByIso(series, "2026-07-09");
  assert.equal(day.pnl, 100);
  assert.equal(day.total, 100);
  assert.equal(day.unrealized, 100);
});

test("activity without finite realized P&L is not a realized trade", () => {
  const series = buildDailyPnlSeries({
    trades: [
      {
        id: "unmatched-live-order",
        source: "LIVE_EXECUTION",
        executedAt: "2026-07-09T18:00:00.000Z",
        realizedPnl: null,
      },
    ],
    equityPoints: [
      { timestamp: "2026-07-08T20:00:00.000Z", netLiquidation: 1000 },
      { timestamp: "2026-07-09T20:00:00.000Z", netLiquidation: 1010 },
    ],
    startDate: "2026-07-08",
    endDate: "2026-07-09",
  });

  const day = dayByIso(series, "2026-07-09");
  assert.equal(day.pnl, 10);
  assert.equal(day.realized, 0);
  assert.equal(day.unrealized, 10);
  assert.equal(day.trades, 0);
});

test("realized fallback remains honest when no NAV baseline exists", () => {
  const finiteRealized = buildDailyPnlSeries({
    trades: [
      {
        id: "closed-profit",
        source: "LIVE_EXECUTION",
        executedAt: "2026-07-09T18:00:00.000Z",
        realizedPnl: 25,
      },
    ],
    startDate: "2026-07-09",
    endDate: "2026-07-09",
  });
  const unknownRealized = buildDailyPnlSeries({
    trades: [
      {
        id: "unmatched-opening",
        source: "LIVE_ORDER",
        filledAt: "2026-07-09T18:00:00.000Z",
        realizedPnl: null,
      },
    ],
    startDate: "2026-07-09",
    endDate: "2026-07-09",
  });

  assert.deepEqual(
    {
      pnl: finiteRealized[0].pnl,
      pnlSource: finiteRealized[0].pnlSource,
      realized: finiteRealized[0].realized,
      trades: finiteRealized[0].trades,
    },
    { pnl: 25, pnlSource: "realized", realized: 25, trades: 1 },
  );
  assert.deepEqual(
    {
      pnl: unknownRealized[0].pnl,
      realized: unknownRealized[0].realized,
      trades: unknownRealized[0].trades,
    },
    { pnl: 0, realized: 0, trades: 0 },
  );
});
