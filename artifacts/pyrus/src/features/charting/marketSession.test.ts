import assert from "node:assert/strict";
import test from "node:test";
import {
  buildUsEquityExtendedSessionWindows,
  countUsEquityMarketSessionBars,
  isNyseFullHoliday,
  listNyseEarlyCloses,
  listNyseHolidays,
  resolveNyseCalendarDay,
  resolveUsEquityMarketStatus,
  resolveUsEquityMarketSession,
} from "./marketSession";

test("resolveUsEquityMarketSession classifies US equity sessions in New York time", () => {
  assert.equal(
    resolveUsEquityMarketSession("2026-04-30T12:15:00Z").label,
    "PRE",
  );
  assert.equal(
    resolveUsEquityMarketSession("2026-04-30T14:00:00Z").label,
    "RTH",
  );
  assert.equal(
    resolveUsEquityMarketSession("2026-04-30T20:30:00Z").label,
    "AFT",
  );
  assert.equal(
    resolveUsEquityMarketSession("2026-04-30T02:00:00Z").label,
    "OVN",
  );
});

test("resolveUsEquityMarketSession closes weekends and NYSE full holidays", () => {
  assert.equal(
    resolveUsEquityMarketSession("2026-05-02T14:00:00Z").label,
    "CLSD",
  );
  assert.equal(isNyseFullHoliday(new Date("2026-01-01T15:00:00Z")), true);
  assert.equal(isNyseFullHoliday(new Date("2026-04-03T15:00:00Z")), true);
  assert.equal(isNyseFullHoliday(new Date("2026-05-25T15:00:00Z")), true);
  assert.equal(isNyseFullHoliday(new Date("2026-11-26T15:00:00Z")), true);
  assert.equal(
    resolveUsEquityMarketSession("2026-11-26T15:00:00Z").label,
    "CLSD",
  );
});

test("resolveUsEquityMarketSession handles observed fixed-date holidays", () => {
  assert.equal(isNyseFullHoliday(new Date("2027-12-24T15:00:00Z")), true);
  assert.equal(
    resolveUsEquityMarketSession("2027-12-24T15:00:00Z").label,
    "CLSD",
  );
  assert.equal(isNyseFullHoliday(new Date("2026-07-03T15:00:00Z")), true);
  assert.equal(
    resolveUsEquityMarketSession("2026-07-03T15:00:00Z").label,
    "CLSD",
  );
});

test("resolveNyseCalendarDay exposes full holidays and early closes", () => {
  assert.deepEqual(resolveNyseCalendarDay("2026-06-19T15:00:00Z"), {
    date: "2026-06-19",
    timeZone: "America/New_York",
    tradingDay: false,
    holiday: "Juneteenth National Independence Day",
    earlyClose: false,
    regularOpenAt: null,
    regularCloseAt: null,
    extendedOpenAt: null,
    extendedCloseAt: null,
  });

  assert.deepEqual(resolveNyseCalendarDay("2026-11-27T17:30:00Z"), {
    date: "2026-11-27",
    timeZone: "America/New_York",
    tradingDay: true,
    holiday: null,
    earlyClose: true,
    regularOpenAt: "2026-11-27T14:30:00.000Z",
    regularCloseAt: "2026-11-27T18:00:00.000Z",
    extendedOpenAt: "2026-11-27T09:00:00.000Z",
    extendedCloseAt: "2026-11-27T22:00:00.000Z",
  });
});

test("resolveUsEquityMarketStatus returns session status and next boundaries", () => {
  const earlyCloseAfternoon = resolveUsEquityMarketStatus(
    "2026-11-27T18:30:00Z",
  );
  const afterEarlyClose = resolveUsEquityMarketStatus("2026-11-27T22:30:00Z");

  assert.deepEqual(
    {
      session: earlyCloseAfternoon.session.label,
      nextOpenAt: earlyCloseAfternoon.nextOpenAt,
      nextCloseAt: earlyCloseAfternoon.nextCloseAt,
      earlyClose: earlyCloseAfternoon.calendarDay?.earlyClose,
    },
    {
      session: "AFT",
      nextOpenAt: null,
      nextCloseAt: "2026-11-27T22:00:00.000Z",
      earlyClose: true,
    },
  );

  assert.deepEqual(
    {
      session: afterEarlyClose.session.label,
      nextOpenAt: afterEarlyClose.nextOpenAt,
      nextCloseAt: afterEarlyClose.nextCloseAt,
    },
    {
      session: "CLSD",
      nextOpenAt: "2026-11-30T01:00:00.000Z",
      nextCloseAt: null,
    },
  );
});

test("resolveUsEquityMarketStatus handles DST regular-session boundaries", () => {
  const daylightSavingStatus = resolveUsEquityMarketStatus(
    "2026-07-01T13:30:00Z",
  );
  const standardTimeStatus = resolveUsEquityMarketStatus(
    "2026-12-01T14:30:00Z",
  );

  assert.deepEqual(
    {
      session: daylightSavingStatus.session.label,
      close: daylightSavingStatus.nextCloseAt,
    },
    { session: "RTH", close: "2026-07-01T20:00:00.000Z" },
  );

  assert.deepEqual(
    {
      session: standardTimeStatus.session.label,
      close: standardTimeStatus.nextCloseAt,
    },
    { session: "RTH", close: "2026-12-01T21:00:00.000Z" },
  );
});

test("resolveUsEquityMarketStatus closes invalid, weekend, and full-holiday dates", () => {
  const invalidStatus = resolveUsEquityMarketStatus("not-a-date");
  const weekendStatus = resolveUsEquityMarketStatus("2026-05-02T14:00:00Z");
  const goodFridayStatus = resolveUsEquityMarketStatus(
    "2026-04-03T15:00:00Z",
  );

  assert.deepEqual(
    {
      session: invalidStatus.session.label,
      nextOpenAt: invalidStatus.nextOpenAt,
      nextCloseAt: invalidStatus.nextCloseAt,
      calendarDay: invalidStatus.calendarDay,
      holiday: isNyseFullHoliday(new Date("not-a-date")),
    },
    {
      session: "CLSD",
      nextOpenAt: null,
      nextCloseAt: null,
      calendarDay: null,
      holiday: false,
    },
  );

  assert.deepEqual(
    {
      session: weekendStatus.session.label,
      nextOpenAt: weekendStatus.nextOpenAt,
    },
    { session: "CLSD", nextOpenAt: "2026-05-04T00:00:00.000Z" },
  );

  assert.deepEqual(
    {
      session: goodFridayStatus.session.label,
      holiday: goodFridayStatus.calendarDay?.holiday,
      nextOpenAt: goodFridayStatus.nextOpenAt,
    },
    {
      session: "CLSD",
      holiday: "Good Friday",
      nextOpenAt: "2026-04-06T00:00:00.000Z",
    },
  );
});

test("NYSE calendar lists holidays and early closes for UI/admission callers", () => {
  assert.deepEqual(listNyseEarlyCloses(2026), [
    {
      date: "2026-11-27",
      regularCloseAt: "2026-11-27T18:00:00.000Z",
      extendedCloseAt: "2026-11-27T22:00:00.000Z",
      reason: "Day after Thanksgiving",
    },
    {
      date: "2026-12-24",
      regularCloseAt: "2026-12-24T18:00:00.000Z",
      extendedCloseAt: "2026-12-24T22:00:00.000Z",
      reason: "Christmas Eve",
    },
  ]);

  assert.equal(
    listNyseHolidays(2026).some(
      (holiday) =>
        holiday.date === "2026-06-19" &&
        holiday.name === "Juneteenth National Independence Day",
    ),
    true,
  );
});

test("buildUsEquityExtendedSessionWindows groups premarket and after-hours bars", () => {
  const bars = [
    "2026-04-30T02:00:00Z",
    "2026-04-30T02:15:00Z",
    "2026-04-30T12:00:00Z",
    "2026-04-30T12:15:00Z",
    "2026-04-30T13:15:00Z",
    "2026-04-30T14:00:00Z",
    "2026-04-30T20:15:00Z",
    "2026-04-30T20:30:00Z",
  ].map((ts) => ({
    ts,
    time: Date.parse(ts) / 1000,
  }));

  const windows = buildUsEquityExtendedSessionWindows(bars);

  assert.deepEqual(
    windows.map((window) => ({
      label: window.meta?.label,
      startBarIndex: window.startBarIndex,
      endBarIndex: window.endBarIndex,
    })),
    [
      { label: "Overnight", startBarIndex: 0, endBarIndex: 1 },
      { label: "Premarket", startBarIndex: 2, endBarIndex: 4 },
      { label: "After-hours", startBarIndex: 6, endBarIndex: 7 },
    ],
  );
});

test("countUsEquityMarketSessionBars counts extended and regular bars", () => {
  const bars = [
    "2026-04-30T12:00:00Z",
    "2026-04-30T14:00:00Z",
    "2026-04-30T20:15:00Z",
    "2026-05-01T01:00:00Z",
  ].map((ts) => ({
    ts,
    time: Date.parse(ts) / 1000,
  }));

  assert.deepEqual(countUsEquityMarketSessionBars(bars), {
    overnight: 1,
    pre: 1,
    rth: 1,
    after: 1,
    closed: 0,
  });
});
