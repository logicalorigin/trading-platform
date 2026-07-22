import assert from "node:assert/strict";
import test from "node:test";

process.env.TZ = "Asia/Tokyo";

const {
  buildDailyPnlSeries,
  buildMonthPnlCalendarModel,
  resolveAccountPnlMarketCalendar,
} = await import("./accountPnlCalendarModel.js");

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

test("Flex timestamps use the New York market day while date-only rows stay literal", () => {
  const series = buildDailyPnlSeries({
    trades: [
      {
        id: "flex-timestamp",
        source: "FLEX",
        closeDate: "2026-06-11T00:30:00.000Z",
        realizedPnl: 5,
      },
      {
        id: "flex-date",
        source: "FLEX",
        closeDate: "2026-06-11",
        realizedPnl: 7,
      },
    ],
    startDate: "2026-06-10",
    endDate: "2026-06-11",
  });

  assert.deepEqual(
    ["2026-06-10", "2026-06-11"].map((iso) => ({
      iso,
      realized: dayByIso(series, iso).realized,
      trades: dayByIso(series, iso).trades,
    })),
    [
      { iso: "2026-06-10", realized: 5, trades: 1 },
      { iso: "2026-06-11", realized: 7, trades: 1 },
    ],
  );
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

test("today follows the New York market date instead of the browser date", () => {
  const model = buildMonthPnlCalendarModel({
    monthDate: new Date(2026, 6, 1),
    today: new Date("2026-07-21T02:00:00.000Z"),
  });

  assert.equal(dayByIso(model.days, "2026-07-20").isToday, true);
  assert.equal(dayByIso(model.days, "2026-07-21").isToday, false);
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

test("a missing prior trading day uses today's opening NAV instead of carrying an older loss", () => {
  const series = buildDailyPnlSeries({
    equityPoints: [
      { timestamp: "2026-07-13T20:00:00.000Z", netLiquidation: 1000 },
      { timestamp: "2026-07-15T13:30:00.000Z", netLiquidation: 900 },
      { timestamp: "2026-07-15T20:00:00.000Z", netLiquidation: 950 },
    ],
    startDate: "2026-07-13",
    endDate: "2026-07-15",
  });

  const day = dayByIso(series, "2026-07-15");
  assert.equal(day.pnl, 50);
  assert.equal(day.total, 50);
});

test("NYSE weekends stay blank and do not advance Friday's baseline", () => {
  const series = buildDailyPnlSeries({
    equityPoints: [
      { timestamp: "2026-07-10T20:00:00.000Z", netLiquidation: 1000 },
      { timestamp: "2026-07-11T20:00:00.000Z", netLiquidation: 1015 },
      { timestamp: "2026-07-12T20:00:00.000Z", netLiquidation: 1025 },
      { timestamp: "2026-07-13T20:00:00.000Z", netLiquidation: 1040 },
    ],
    startDate: "2026-07-10",
    endDate: "2026-07-13",
  });

  for (const iso of ["2026-07-11", "2026-07-12"]) {
    assert.deepEqual(
      {
        pnl: dayByIso(series, iso).pnl,
        total: dayByIso(series, iso).total,
        realized: dayByIso(series, iso).realized,
        trades: dayByIso(series, iso).trades,
      },
      { pnl: 0, total: null, realized: 0, trades: 0 },
    );
  }
  assert.equal(dayByIso(series, "2026-07-13").total, 40);
});

test("continuous calendars retain each weekend NAV change", () => {
  const series = buildDailyPnlSeries({
    equityPoints: [
      { timestamp: "2026-07-17T20:00:00.000Z", netLiquidation: 1000 },
      { timestamp: "2026-07-18T20:00:00.000Z", netLiquidation: 1025 },
      { timestamp: "2026-07-19T20:00:00.000Z", netLiquidation: 1040 },
      { timestamp: "2026-07-20T20:00:00.000Z", netLiquidation: 1035 },
    ],
    startDate: "2026-07-17",
    endDate: "2026-07-20",
    marketCalendar: "continuous",
  });

  assert.equal(dayByIso(series, "2026-07-18").total, 25);
  assert.equal(dayByIso(series, "2026-07-19").total, 15);
  assert.equal(dayByIso(series, "2026-07-20").total, -5);
});

test("NYSE holiday points stay blank and do not advance the prior-session baseline", () => {
  const series = buildDailyPnlSeries({
    equityPoints: [
      { timestamp: "2026-07-02T20:00:00.000Z", netLiquidation: 1000 },
      { timestamp: "2026-07-03T20:00:00.000Z", netLiquidation: 1025 },
      { timestamp: "2026-07-06T20:00:00.000Z", netLiquidation: 1060 },
    ],
    startDate: "2026-07-02",
    endDate: "2026-07-06",
  });

  assert.equal(dayByIso(series, "2026-07-03").total, null);
  assert.equal(dayByIso(series, "2026-07-03").pnl, 0);
  assert.equal(dayByIso(series, "2026-07-06").total, 60);
});

test("NYSE transfers on a closed day carry into the next session adjustment", () => {
  const series = buildDailyPnlSeries({
    equityPoints: [
      { timestamp: "2026-07-17T20:00:00.000Z", netLiquidation: 1000 },
      {
        timestamp: "2026-07-18T20:00:00.000Z",
        netLiquidation: 1500,
        deposits: 500,
      },
      { timestamp: "2026-07-20T20:00:00.000Z", netLiquidation: 1525 },
    ],
    startDate: "2026-07-17",
    endDate: "2026-07-20",
  });

  assert.equal(dayByIso(series, "2026-07-18").total, null);
  assert.equal(dayByIso(series, "2026-07-20").total, 25);
});

test("closed NYSE days do not contribute to monthly totals or win/loss counts", () => {
  const model = buildMonthPnlCalendarModel({
    equityPoints: [
      { timestamp: "2026-07-17T20:00:00.000Z", netLiquidation: 1000 },
      { timestamp: "2026-07-18T20:00:00.000Z", netLiquidation: 1025 },
      { timestamp: "2026-07-20T20:00:00.000Z", netLiquidation: 1010 },
    ],
    monthDate: new Date(2026, 6, 1),
    today: new Date(2026, 6, 20, 12),
  });

  assert.equal(model.summary.pnl, 10);
  assert.equal(model.summary.wins, 1);
  assert.equal(model.summary.losses, 0);
  assert.equal(dayByIso(model.days, "2026-07-18").total, null);
});

test("account scope selects continuous semantics only for included crypto data", () => {
  const accounts = [
    { id: "equity-account", accountType: "equity" },
    { id: "crypto-account", accountType: "Crypto" },
  ];

  assert.equal(
    resolveAccountPnlMarketCalendar({ accountTab: "shadow", accounts }),
    "nyse",
  );
  assert.equal(
    resolveAccountPnlMarketCalendar({
      accountTab: "equity-account",
      accounts,
    }),
    "nyse",
  );
  assert.equal(
    resolveAccountPnlMarketCalendar({
      accountTab: "crypto-account",
      accounts,
    }),
    "continuous",
  );
  assert.equal(
    resolveAccountPnlMarketCalendar({ accountTab: "all", accounts }),
    "continuous",
  );
  assert.equal(
    resolveAccountPnlMarketCalendar({
      accountTab: "missing-account",
      accounts,
    }),
    "nyse",
  );
});

test("a premarket-only prior day is not a valid closing NAV baseline", () => {
  const series = buildDailyPnlSeries({
    equityPoints: [
      { timestamp: "2026-07-10T20:00:00.000Z", netLiquidation: 1000 },
      { timestamp: "2026-07-13T04:01:00.000Z", netLiquidation: 900 },
      { timestamp: "2026-07-14T13:30:00.000Z", netLiquidation: 800 },
      { timestamp: "2026-07-14T20:00:00.000Z", netLiquidation: 850 },
    ],
    startDate: "2026-07-10",
    endDate: "2026-07-14",
  });

  assert.equal(dayByIso(series, "2026-07-14").total, 50);
});

test("a FLEX daily NAV is a valid prior close despite its canonical noon-UTC timestamp", () => {
  const series = buildDailyPnlSeries({
    equityPoints: [
      {
        timestamp: "2026-07-08T12:00:00.000Z",
        netLiquidation: 1000,
        source: "FLEX",
      },
      {
        timestamp: "2026-07-09T12:00:00.000Z",
        netLiquidation: 1100,
        source: "FLEX",
      },
    ],
    startDate: "2026-07-08",
    endDate: "2026-07-09",
  });

  assert.equal(dayByIso(series, "2026-07-09").total, 100);
});

test("a later pre-close snapshot cannot mask the day's canonical FLEX close", () => {
  const series = buildDailyPnlSeries({
    equityPoints: [
      {
        timestamp: "2026-07-13T12:00:00.000Z",
        netLiquidation: 1000,
        source: "FLEX",
      },
      {
        timestamp: "2026-07-13T17:21:00.000Z",
        netLiquidation: 800,
        source: "LOCAL_LEDGER",
      },
      {
        timestamp: "2026-07-14T20:00:00.000Z",
        netLiquidation: 1175,
        source: "LOCAL_LEDGER",
      },
    ],
    startDate: "2026-07-13",
    endDate: "2026-07-14",
  });

  assert.equal(dayByIso(series, "2026-07-14").total, 175);
});

test("a completed day's own P&L uses its trustworthy close, not a later pre-close timestamp", () => {
  const series = buildDailyPnlSeries({
    equityPoints: [
      {
        timestamp: "2026-07-10T12:00:00.000Z",
        netLiquidation: 900,
        source: "FLEX",
      },
      {
        timestamp: "2026-07-13T12:00:00.000Z",
        netLiquidation: 1000,
        source: "FLEX",
      },
      {
        timestamp: "2026-07-13T17:21:00.000Z",
        netLiquidation: 800,
        source: "LOCAL_LEDGER",
      },
    ],
    startDate: "2026-07-10",
    endDate: "2026-07-13",
  });

  assert.equal(dayByIso(series, "2026-07-13").total, 100);
});

test("a true post-close snapshot supersedes an earlier FLEX close", () => {
  const series = buildDailyPnlSeries({
    equityPoints: [
      {
        timestamp: "2026-07-13T12:00:00.000Z",
        netLiquidation: 1000,
        source: "FLEX",
      },
      {
        timestamp: "2026-07-13T20:01:00.000Z",
        netLiquidation: 1100,
        source: "LOCAL_LEDGER",
      },
      {
        timestamp: "2026-07-14T20:00:00.000Z",
        netLiquidation: 1200,
        source: "LOCAL_LEDGER",
      },
    ],
    startDate: "2026-07-13",
    endDate: "2026-07-14",
  });

  assert.equal(dayByIso(series, "2026-07-14").total, 100);
});

test("an early-close terminal remains a valid prior-session baseline", () => {
  const series = buildDailyPnlSeries({
    equityPoints: [
      { timestamp: "2026-11-27T18:01:00.000Z", netLiquidation: 1000 },
      { timestamp: "2026-11-30T21:00:00.000Z", netLiquidation: 1050 },
    ],
    startDate: "2026-11-27",
    endDate: "2026-11-30",
  });

  assert.equal(dayByIso(series, "2026-11-30").total, 50);
});

test("conflicting equal-timestamp NAV points fail closed instead of depending on input order", () => {
  const build = (openingPoints) =>
    buildDailyPnlSeries({
      trades: [
        {
          id: "closed-profit",
          source: "LIVE_EXECUTION",
          executedAt: "2026-07-15T18:00:00.000Z",
          realizedPnl: 12,
        },
      ],
      equityPoints: [
        { timestamp: "2026-07-13T20:00:00.000Z", netLiquidation: 1000 },
        ...openingPoints,
        { timestamp: "2026-07-15T20:00:00.000Z", netLiquidation: 950 },
      ],
      startDate: "2026-07-13",
      endDate: "2026-07-15",
    });
  const openingA = { timestamp: "2026-07-15T13:30:00.000Z", netLiquidation: 900 };
  const openingB = { timestamp: "2026-07-15T13:30:00.000Z", netLiquidation: 1000 };

  for (const series of [build([openingA, openingB]), build([openingB, openingA])]) {
    const day = dayByIso(series, "2026-07-15");
    assert.equal(day.total, null);
    assert.equal(day.pnl, 12);
    assert.equal(day.pnlSource, "realized");
  }
});

test("identical equity rows do not double-subtract the same transfer", () => {
  const deposited = {
    timestamp: "2026-07-15T16:00:00.000Z",
    netLiquidation: 2000,
    deposits: 1000,
  };
  const series = buildDailyPnlSeries({
    equityPoints: [
      { timestamp: "2026-07-14T20:00:00.000Z", netLiquidation: 1000 },
      deposited,
      { ...deposited },
      { timestamp: "2026-07-15T20:00:00.000Z", netLiquidation: 2100 },
    ],
    startDate: "2026-07-14",
    endDate: "2026-07-15",
  });

  assert.equal(dayByIso(series, "2026-07-15").total, 100);
});

test("conflicting pre-window NAV points cannot seed an input-order-dependent baseline", () => {
  const build = (conflictingPoints) =>
    buildDailyPnlSeries({
      equityPoints: [
        ...conflictingPoints,
        { timestamp: "2026-07-15T20:00:00.000Z", netLiquidation: 1100 },
      ],
      startDate: "2026-07-15",
      endDate: "2026-07-15",
    });
  const pointA = { timestamp: "2026-07-14T20:00:00.000Z", netLiquidation: 1000 };
  const pointB = { timestamp: "2026-07-14T20:00:00.000Z", netLiquidation: 1200 };

  for (const series of [build([pointA, pointB]), build([pointB, pointA])]) {
    assert.equal(series[0].total, null);
    assert.equal(series[0].pnlSource, null);
    assert.equal(series[0].hasPnlData, false);
  }
});

test("a conflicting day clears older NAV state instead of bridging across it", () => {
  const series = buildDailyPnlSeries({
    equityPoints: [
      { timestamp: "2026-07-02T20:00:00.000Z", netLiquidation: 1000 },
      {
        timestamp: "2026-07-03T20:00:00.000Z",
        netLiquidation: 1100,
        deposits: 100,
      },
      {
        timestamp: "2026-07-03T20:00:00.000Z",
        netLiquidation: 1100,
        deposits: 200,
      },
      { timestamp: "2026-07-06T20:00:00.000Z", netLiquidation: 1200 },
    ],
    startDate: "2026-07-02",
    endDate: "2026-07-06",
  });

  assert.equal(dayByIso(series, "2026-07-03").total, null);
  assert.equal(dayByIso(series, "2026-07-06").total, null);
});

test("activity without finite realized P&L is counted without inventing a subtotal", () => {
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
  assert.equal(day.realized, null);
  assert.equal(day.unrealized, null);
  assert.equal(day.trades, 1);
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
    { pnl: 0, realized: null, trades: 1 },
  );
  assert.equal(unknownRealized[0].hasPnlData, false);
});

test("realized fallback rejects a mixed known and unknown trade population", () => {
  const [day] = buildDailyPnlSeries({
    trades: [
      {
        id: "known",
        source: "LIVE_EXECUTION",
        executedAt: "2026-07-09T18:00:00.000Z",
        realizedPnl: 25,
      },
      {
        id: "unknown",
        source: "LIVE_EXECUTION",
        executedAt: "2026-07-09T19:00:00.000Z",
        realizedPnl: null,
      },
    ],
    startDate: "2026-07-09",
    endDate: "2026-07-09",
  });

  assert.equal(day.trades, 2);
  assert.equal(day.realized, null);
  assert.equal(day.hasPnlData, false);
  assert.equal(day.pnlSource, null);
  assert.equal(day.pnl, 0);
});

test("calendar distinguishes an authoritative zero from an unavailable day", () => {
  const covered = buildDailyPnlSeries({
    equityPoints: [
      { timestamp: "2026-07-08T13:30:00.000Z", netLiquidation: 1_000 },
      { timestamp: "2026-07-08T20:00:00.000Z", netLiquidation: 1_000 },
    ],
    startDate: "2026-07-08",
    endDate: "2026-07-09",
  });

  assert.equal(dayByIso(covered, "2026-07-08").pnl, 0);
  assert.equal(dayByIso(covered, "2026-07-08").hasPnlData, true);
  assert.equal(dayByIso(covered, "2026-07-09").pnl, 0);
  assert.equal(dayByIso(covered, "2026-07-09").hasPnlData, false);
  assert.equal(dayByIso(covered, "2026-07-09").pnlSource, null);
});

test("calendar does not relocate an undated close onto its entry date", () => {
  const trades = [
    {
      id: "missing-close",
      source: "FLEX",
      openDate: "2026-07-09T14:00:00.000Z",
      realizedPnl: 25,
    },
  ];
  const series = buildDailyPnlSeries({
    trades,
    startDate: "2026-07-09",
    endDate: "2026-07-09",
  });
  const model = buildMonthPnlCalendarModel({
    trades,
    monthDate: new Date(2026, 6, 1),
    today: new Date(2026, 6, 9),
  });

  assert.equal(series[0].trades, 0);
  assert.equal(series[0].hasPnlData, false);
  assert.equal(model.summary.unbucketedTrades, 1);
  assert.equal(model.summary.pnlComplete, false);
  assert.equal(model.summary.realizedComplete, false);
});
