import assert from "node:assert/strict";
import test from "node:test";
import {
  PNL_CALENDAR_WEEKDAYS,
  buildDailyPnlSeries,
  buildMonthPnlCalendarModel,
  buildYearPnlCalendarModel,
  findLatestCalendarActivityDate,
  formatCalendarPnlValue,
} from "./accountPnlCalendarModel.js";

const trade = (closeDate, realizedPnl, extra = {}) => ({
  closeDate,
  realizedPnl,
  ...extra,
});

const equityPoint = (timestamp, netLiquidation, extra = {}) => ({
  timestamp,
  netLiquidation,
  currency: "USD",
  deposits: 0,
  withdrawals: 0,
  dividends: 0,
  fees: 0,
  ...extra,
});

test("buildDailyPnlSeries groups closed trades by close date using realized P&L", () => {
  const series = buildDailyPnlSeries({
    startDate: new Date(2026, 4, 1),
    endDate: new Date(2026, 4, 4),
    trades: [
      trade("2026-05-01T14:30:00.000Z", 100, { pnl: -999 }),
      trade("2026-05-01T19:30:00.000Z", -20),
      trade("2026-05-04T15:00:00.000Z", null, { pnl: 15 }),
    ],
  });

  assert.deepEqual(
    series.map((day) => ({
      iso: day.iso,
      pnl: day.pnl,
      pnlSource: day.pnlSource,
      realized: day.realized,
      trades: day.trades,
    })),
    [
      {
        iso: "2026-05-01",
        pnl: 80,
        pnlSource: "realized",
        realized: 80,
        trades: 2,
      },
      {
        iso: "2026-05-02",
        pnl: 0,
        pnlSource: "realized",
        realized: 0,
        trades: 0,
      },
      {
        iso: "2026-05-03",
        pnl: 0,
        pnlSource: "realized",
        realized: 0,
        trades: 0,
      },
      {
        iso: "2026-05-04",
        pnl: 15,
        pnlSource: "realized",
        realized: 15,
        trades: 1,
      },
    ],
  );
});

test("buildDailyPnlSeries keeps date-only ledger rows on their stated calendar day", () => {
  const series = buildDailyPnlSeries({
    startDate: new Date(2026, 4, 13),
    endDate: new Date(2026, 4, 13),
    trades: [trade("2026-05-13", 42)],
  });

  assert.equal(series[0].iso, "2026-05-13");
  assert.equal(series[0].realized, 42);
});

test("buildDailyPnlSeries rejects impossible date-only ledger rows", () => {
  const series = buildDailyPnlSeries({
    startDate: new Date(2026, 2, 3),
    endDate: new Date(2026, 2, 3),
    trades: [trade("2026-02-31", 42)],
  });

  assert.equal(series[0].realized, 0);
});

test("buildDailyPnlSeries includes FLEX, SHADOW, and LIVE source rows", () => {
  const series = buildDailyPnlSeries({
    startDate: new Date(2026, 4, 4),
    endDate: new Date(2026, 4, 4),
    trades: [
      trade("2026-05-04T14:30:00.000Z", 10, { source: "FLEX" }),
      trade("2026-05-04T15:30:00.000Z", -4, { source: "SHADOW" }),
      trade("2026-05-04T16:30:00.000Z", 1250, { source: "LIVE" }),
    ],
  });

  assert.equal(series[0].realized, 1256);
  assert.equal(series[0].trades, 3);
});

test("buildDailyPnlSeries uses browser-local dates for trade buckets", () => {
  const localCloseDate = new Date(2026, 4, 5, 23, 45);
  const series = buildDailyPnlSeries({
    startDate: new Date(2026, 4, 5),
    endDate: new Date(2026, 4, 6),
    trades: [trade(localCloseDate, 12)],
  });

  assert.deepEqual(
    series.map((day) => ({ iso: day.iso, realized: day.realized })),
    [
      { iso: "2026-05-05", realized: 12 },
      { iso: "2026-05-06", realized: 0 },
    ],
  );
});

test("buildDailyPnlSeries ignores invalid dates and non-finite P&L values", () => {
  const series = buildDailyPnlSeries({
    startDate: new Date(2026, 4, 6),
    endDate: new Date(2026, 4, 6),
    trades: [
      trade("not-a-date", 100),
      trade("2026-05-06T14:30:00.000Z", "not-a-number"),
      trade("2026-05-06T15:30:00.000Z", 7),
    ],
  });

  assert.equal(series[0].realized, 7);
  assert.equal(series[0].trades, 1);
});

test("buildMonthPnlCalendarModel produces a Sunday-first full month grid", () => {
  const model = buildMonthPnlCalendarModel({
    monthDate: new Date(2022, 10, 15),
    today: new Date(2022, 10, 25, 12),
    trades: [trade("2022-11-29T15:30:00.000Z", 39.7)],
  });

  assert.equal(model.label, "Nov 2022");
  assert.deepEqual(PNL_CALENDAR_WEEKDAYS, ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]);
  assert.equal(model.days.length, 35);
  assert.equal(model.days[0].iso, "2022-10-30");
  assert.equal(model.days.at(-1).iso, "2022-12-03");
  assert.equal(model.days[0].inMonth, false);
  assert.equal(model.days.find((day) => day.iso === "2022-11-25").dayLabel, "Today");
  assert.equal(model.summary.pnl, 39.7);
  assert.equal(model.summary.realized, 39.7);
  assert.equal(model.summary.wins, 1);
});

test("buildDailyPnlSeries rolls weekend realized P&L into Monday", () => {
  const series = buildDailyPnlSeries({
    startDate: new Date(2026, 0, 2),
    endDate: new Date(2026, 0, 5),
    trades: [
      trade("2026-01-03T16:00:00.000Z", 40),
      trade("2026-01-04T16:00:00.000Z", -10),
    ],
  });

  assert.deepEqual(
    series.map((day) => ({
      iso: day.iso,
      pnl: day.pnl,
      realized: day.realized,
      trades: day.trades,
    })),
    [
      { iso: "2026-01-02", pnl: 0, realized: 0, trades: 0 },
      { iso: "2026-01-03", pnl: 0, realized: 0, trades: 0 },
      { iso: "2026-01-04", pnl: 0, realized: 0, trades: 0 },
      { iso: "2026-01-05", pnl: 30, realized: 30, trades: 2 },
    ],
  );
});

test("buildDailyPnlSeries rolls weekend NAV P&L into Monday", () => {
  const series = buildDailyPnlSeries({
    startDate: new Date(2026, 0, 2),
    endDate: new Date(2026, 0, 5),
    equityPoints: [
      equityPoint("2026-01-02T21:00:00.000Z", 1000),
      equityPoint("2026-01-03T21:00:00.000Z", 1015),
      equityPoint("2026-01-04T21:00:00.000Z", 1025),
      equityPoint("2026-01-05T21:00:00.000Z", 1030),
    ],
  });

  const friday = series.find((day) => day.iso === "2026-01-02");
  const saturday = series.find((day) => day.iso === "2026-01-03");
  const sunday = series.find((day) => day.iso === "2026-01-04");
  const monday = series.find((day) => day.iso === "2026-01-05");

  assert.equal(friday.pnl, 0);
  assert.equal(saturday.pnl, 0);
  assert.equal(saturday.total, null);
  assert.equal(sunday.pnl, 0);
  assert.equal(sunday.total, null);
  assert.equal(monday.total, 30);
  assert.equal(monday.unrealized, 30);
  assert.equal(monday.pnl, 30);
  assert.equal(monday.pnlSource, "total");
});

test("buildDailyPnlSeries derives total and unrealized only when NAV is anchored", () => {
  const series = buildDailyPnlSeries({
    startDate: new Date(2026, 0, 1),
    endDate: new Date(2026, 0, 3),
    trades: [trade("2026-01-02T16:00:00.000Z", 30)],
    equityPoints: [
      equityPoint("2025-12-31T21:00:00.000Z", 1000),
      equityPoint("2026-01-02T21:00:00.000Z", 1120, { deposits: 50 }),
    ],
  });

  const jan1 = series.find((day) => day.iso === "2026-01-01");
  const jan2 = series.find((day) => day.iso === "2026-01-02");
  assert.equal(jan1.total, null);
  assert.equal(jan1.unrealized, null);
  assert.equal(jan1.pnl, 0);
  assert.equal(jan1.pnlSource, "realized");
  assert.equal(jan2.total, 70);
  assert.equal(jan2.unrealized, 40);
  assert.equal(jan2.pnl, 70);
  assert.equal(jan2.pnlSource, "total");
});

test("buildDailyPnlSeries uses same-day opening NAV when the first available day has intraday snapshots", () => {
  const series = buildDailyPnlSeries({
    startDate: new Date(2026, 4, 8),
    endDate: new Date(2026, 4, 8),
    equityPoints: [
      equityPoint("2026-05-08T18:26:02.932Z", 5753.34),
      equityPoint("2026-05-08T19:56:58.939Z", 5778.57),
      equityPoint("2026-05-08T20:57:22.819Z", 5752.74),
    ],
  });

  assert.equal(Number(series[0].total.toFixed(2)), -0.6);
  assert.equal(Number(series[0].unrealized.toFixed(2)), -0.6);
  assert.equal(Number(series[0].pnl.toFixed(2)), -0.6);
  assert.equal(series[0].pnlSource, "total");
});

test("buildDailyPnlSeries does not subtract the same-day opening funding baseline", () => {
  const series = buildDailyPnlSeries({
    startDate: new Date(2026, 4, 11),
    endDate: new Date(2026, 4, 11),
    equityPoints: [
      equityPoint("2026-05-11T14:00:00.000Z", 30_000, { deposits: 30_000 }),
      equityPoint("2026-05-11T20:00:00.000Z", 34_182.66),
    ],
  });

  assert.equal(Number(series[0].total.toFixed(2)), 4182.66);
  assert.equal(Number(series[0].unrealized.toFixed(2)), 4182.66);
  assert.equal(Number(series[0].pnl.toFixed(2)), 4182.66);
  assert.equal(series[0].pnlSource, "total");
});

test("buildDailyPnlSeries still excludes same-day transfers after the opening baseline", () => {
  const series = buildDailyPnlSeries({
    startDate: new Date(2026, 4, 11),
    endDate: new Date(2026, 4, 11),
    equityPoints: [
      equityPoint("2026-05-11T14:00:00.000Z", 30_000),
      equityPoint("2026-05-11T16:00:00.000Z", 32_000, { deposits: 2_000 }),
      equityPoint("2026-05-11T20:00:00.000Z", 32_125),
    ],
  });

  assert.equal(series[0].total, 125);
  assert.equal(series[0].unrealized, 125);
  assert.equal(series[0].pnl, 125);
});

test("buildDailyPnlSeries does not let one unanchored NAV point mask realized P&L", () => {
  const series = buildDailyPnlSeries({
    startDate: new Date(2026, 4, 8),
    endDate: new Date(2026, 4, 8),
    trades: [trade("2026-05-08T16:00:00.000Z", 12)],
    equityPoints: [equityPoint("2026-05-08T20:00:00.000Z", 5752.74)],
  });

  assert.equal(series[0].total, null);
  assert.equal(series[0].unrealized, null);
  assert.equal(series[0].pnl, 12);
  assert.equal(series[0].pnlSource, "realized");
});

test("buildDailyPnlSeries uses current terminal NAV for same-day unrealized P&L", () => {
  const series = buildDailyPnlSeries({
    startDate: new Date(2026, 4, 12),
    endDate: new Date(2026, 4, 13),
    equityPoints: [
      equityPoint("2026-05-12T20:00:00.000Z", 36_321.61),
      equityPoint("2026-05-13T15:03:12.357Z", 36_433.75),
    ],
  });

  const today = series.find((day) => day.iso === "2026-05-13");
  assert.equal(Number(today.total.toFixed(2)), 112.14);
  assert.equal(Number(today.unrealized.toFixed(2)), 112.14);
  assert.equal(Number(today.pnl.toFixed(2)), 112.14);
  assert.equal(today.pnlSource, "total");
});

test("buildDailyPnlSeries falls back to realized P&L when NAV total is unavailable", () => {
  const series = buildDailyPnlSeries({
    startDate: new Date(2026, 0, 2),
    endDate: new Date(2026, 0, 2),
    trades: [trade("2026-01-02T16:00:00.000Z", 12)],
  });

  assert.equal(series[0].total, null);
  assert.equal(series[0].unrealized, null);
  assert.equal(series[0].pnl, 12);
  assert.equal(series[0].pnlSource, "realized");
});

test("buildMonthPnlCalendarModel summarizes NAV-populated unrealized-only days", () => {
  const model = buildMonthPnlCalendarModel({
    monthDate: new Date(2026, 0, 15),
    today: new Date(2026, 0, 31, 12),
    equityPoints: [
      equityPoint("2025-12-31T21:00:00.000Z", 1000),
      equityPoint("2026-01-02T21:00:00.000Z", 1025),
    ],
  });

  const jan2 = model.days.find((day) => day.iso === "2026-01-02");
  assert.equal(jan2.realized, 0);
  assert.equal(jan2.total, 25);
  assert.equal(jan2.unrealized, 25);
  assert.equal(jan2.pnl, 25);
  assert.equal(model.summary.pnl, 25);
  assert.equal(model.summary.realized, 0);
  assert.equal(model.summary.wins, 1);
  assert.equal(model.summary.losses, 0);
});

test("buildYearPnlCalendarModel summarizes monthly display P&L and win/loss days", () => {
  const model = buildYearPnlCalendarModel({
    year: 2026,
    today: new Date(2026, 4, 6, 12),
    trades: [
      trade("2026-01-02T15:00:00.000Z", 100),
      trade("2026-01-03T15:00:00.000Z", -25),
      trade("2026-02-10T15:00:00.000Z", -10),
    ],
  });

  assert.equal(model.months[0].summary.pnl, 75);
  assert.equal(model.months[0].summary.realized, 75);
  assert.equal(model.months[0].summary.wins, 1);
  assert.equal(model.months[0].summary.losses, 1);
  assert.equal(model.months[1].summary.pnl, -10);
  assert.equal(model.months[1].summary.realized, -10);
  assert.equal(model.months[4].isCurrentMonth, true);
  assert.equal(model.summary.pnl, 65);
  assert.equal(model.summary.realized, 65);
});

test("findLatestCalendarActivityDate uses the latest valid trade or equity point", () => {
  const latest = findLatestCalendarActivityDate({
    trades: [
      trade("2026-01-02T16:00:00.000Z", 12),
      trade("2026-03-05T16:00:00.000Z", "not-a-number"),
    ],
    equityPoints: [
      equityPoint("2026-02-04T21:00:00.000Z", 1010),
      equityPoint("2026-04-01T21:00:00.000Z", "not-a-number"),
    ],
  });

  assert.equal(latest.toISOString(), new Date(2026, 1, 4).toISOString());
});

test("formatCalendarPnlValue masks values and keeps day cells compact", () => {
  assert.equal(formatCalendarPnlValue(28.1), "+$28.10");
  assert.equal(formatCalendarPnlValue(-1200), "-$1.2K");
  assert.equal(formatCalendarPnlValue(125), "+$125");
  assert.equal(formatCalendarPnlValue(0), "--");
  assert.equal(formatCalendarPnlValue(null), "--");
  assert.equal(formatCalendarPnlValue(28.1, true), "****");
  assert.equal(formatCalendarPnlValue(null, true), "--");
});
