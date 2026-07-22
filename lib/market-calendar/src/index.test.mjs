import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  _testing,
  addTradingDays,
  listNyseHolidays,
  listNyseEarlyCloses,
  previousTradingDayOrSame,
  resolveNyseCalendarDay,
  resolvePreviousUsEquitySessionClose,
  resolveUsEquityMarketSession,
  rthBarsBack,
  rthBarsBetween,
  tradingDaysBetween,
} from "./index.ts";

test("trading-date checks do not build unused session timestamps", () => {
  const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const start = source.indexOf("const isNyseTradingDate =");
  const end = source.indexOf(";", start);
  assert.notEqual(start, -1);
  assert.doesNotMatch(
    source.slice(start, end + 1),
    /resolveNyseCalendarDayFromParts/,
  );
});

test("resolvePreviousUsEquitySessionClose returns the prior regular close, skipping holidays", () => {
  // Saturday 2026-06-20: the prior weekday (Fri 06-19) is Juneteenth, so the
  // previous session close is Thursday 2026-06-18 16:00 ET (20:00Z in EDT).
  const sat = resolvePreviousUsEquitySessionClose(
    new Date("2026-06-20T17:00:00Z"),
  );
  assert.equal(sat?.toISOString(), "2026-06-18T20:00:00.000Z");

  // Before today's close, the previous close is the prior trading day's close.
  const wedAfternoon = resolvePreviousUsEquitySessionClose(
    new Date("2026-06-17T15:00:00-04:00"),
  );
  assert.equal(wedAfternoon?.toISOString(), "2026-06-16T20:00:00.000Z");

  // After today's close, today's close qualifies as the previous close.
  const wedEvening = resolvePreviousUsEquitySessionClose(
    new Date("2026-06-17T17:00:00-04:00"),
  );
  assert.equal(wedEvening?.toISOString(), "2026-06-17T20:00:00.000Z");

  assert.equal(resolvePreviousUsEquitySessionClose("not-a-date"), null);
});

test("NYSE holiday records are computed once per year (memoized)", () => {
  _testing.resetCalendarCaches();
  const first = _testing.buildNyseHolidayRecords(2026);
  const second = _testing.buildNyseHolidayRecords(2026);
  // Same year returns the identical cached array — proves it is not rebuilt.
  assert.strictEqual(first, second);
  // A different year is a distinct computation/array.
  assert.notStrictEqual(first, _testing.buildNyseHolidayRecords(2027));
});

test("NYSE early-close records are computed once per year (memoized)", () => {
  _testing.resetCalendarCaches();
  const first = _testing.buildNyseEarlyCloseRecords(2026);
  const second = _testing.buildNyseEarlyCloseRecords(2026);
  assert.strictEqual(first, second);
  assert.notStrictEqual(first, _testing.buildNyseEarlyCloseRecords(2027));
});

test("memoization preserves correct holiday output for the requested year", () => {
  _testing.resetCalendarCaches();
  const holidays = listNyseHolidays(2026);
  const names = holidays.map((holiday) => holiday.name);
  assert.ok(names.includes("New Year's Day"));
  assert.ok(names.includes("Good Friday"));
  assert.ok(names.includes("Christmas Day"));
  // listNyseHolidays must only return dates within the requested year.
  assert.ok(holidays.every((holiday) => holiday.date.startsWith("2026-")));
});

test("historical holidays respect effective dates and ad-hoc NYSE closures", () => {
  assert.equal(
    resolveNyseCalendarDay("1997-01-20T12:00:00.000Z")?.tradingDay,
    true,
  );
  assert.equal(
    resolveNyseCalendarDay("1998-01-19T12:00:00.000Z")?.holiday,
    "Martin Luther King, Jr. Day",
  );
  assert.equal(
    resolveNyseCalendarDay("2021-06-18T12:00:00.000Z")?.tradingDay,
    true,
  );
  assert.equal(
    resolveNyseCalendarDay("2022-06-20T12:00:00.000Z")?.holiday,
    "Juneteenth National Independence Day",
  );

  for (const date of [
    "2001-09-11",
    "2001-09-12",
    "2001-09-13",
    "2001-09-14",
    "2004-06-11",
    "2007-01-02",
    "2012-10-29",
    "2012-10-30",
    "2018-12-05",
    "2025-01-09",
  ]) {
    assert.equal(
      resolveNyseCalendarDay(`${date}T12:00:00.000Z`)?.tradingDay,
      false,
      `${date} must remain closed`,
    );
  }
});

test("bare market-date keys resolve directly and reject impossible dates", () => {
  assert.equal(resolveNyseCalendarDay("2026-07-03")?.date, "2026-07-03");
  assert.equal(
    resolveNyseCalendarDay("2026-07-03")?.holiday,
    "Independence Day",
  );
  assert.equal(resolveNyseCalendarDay("2026-02-30"), null);
  assert.throws(() => previousTradingDayOrSame("2026-02-30"), RangeError);
  assert.throws(() => addTradingDays("2026-02-30", 0), RangeError);
  assert.deepEqual(listNyseHolidays(Number.MAX_SAFE_INTEGER), []);
  assert.deepEqual(listNyseEarlyCloses(Number.MAX_SAFE_INTEGER), []);
});

test("New York clock parts are memoized per minute (same minute shares one Intl conversion)", () => {
  _testing.resetCalendarCaches();
  const base = Date.UTC(2026, 5, 15, 14, 30, 0); // 14:30:00.000Z
  const sameMinute = _testing.resolveNewYorkClockParts(new Date(base + 12_345)); // +12.3s
  const sameMinuteAgain = _testing.resolveNewYorkClockParts(new Date(base + 58_000)); // +58s
  // Same UTC minute -> identical cached object (one conversion, reused).
  assert.strictEqual(sameMinute, sameMinuteAgain);
  // Output is minute-granular, so the seconds difference must not change it.
  assert.deepStrictEqual(sameMinute, _testing.resolveNewYorkClockParts(new Date(base)));
  // A different minute is a distinct conversion.
  assert.notStrictEqual(
    sameMinute,
    _testing.resolveNewYorkClockParts(new Date(base + 60_000)),
  );
});

test("session intervals are memoized per trading day", () => {
  _testing.resetCalendarCaches();
  const parts = { year: 2026, month: 6, day: 15 };
  const first = _testing.buildSessionIntervalsForTradingDay(parts);
  const second = _testing.buildSessionIntervalsForTradingDay({ ...parts });
  // Same day (even a different parts object) returns the identical cached array.
  assert.strictEqual(first, second);
  assert.notStrictEqual(
    first,
    _testing.buildSessionIntervalsForTradingDay({ year: 2026, month: 6, day: 16 }),
  );
});

test("session-only lookups do not build next-open interval metadata", () => {
  _testing.resetCalendarCaches();
  const observedAt = new Date("2026-06-15T15:00:00.000Z");
  const originalParse = Date.parse;
  let parseCalls = 0;
  Date.parse = (value) => {
    parseCalls += 1;
    return originalParse(value);
  };
  try {
    assert.equal(resolveUsEquityMarketSession(observedAt).key, "rth");
    assert.equal(parseCalls, 0);
  } finally {
    Date.parse = originalParse;
  }
});

test("public calendar results cannot mutate cached records or sessions", () => {
  _testing.resetCalendarCaches();
  const holidays = listNyseHolidays(2026);
  const originalHoliday = { ...holidays[0] };
  holidays[0].date = "2099-01-01";
  assert.deepEqual(listNyseHolidays(2026)[0], originalHoliday);

  const earlyCloses = listNyseEarlyCloses(2026);
  const originalEarlyClose = { ...earlyCloses[0] };
  earlyCloses[0].regularCloseAt = "poisoned";
  assert.deepEqual(listNyseEarlyCloses(2026)[0], originalEarlyClose);

  const session = resolveUsEquityMarketSession("2026-06-10T15:00:00.000Z");
  assert.equal(Object.isFrozen(session), true);
  assert.throws(() => {
    session.open = false;
  }, TypeError);
  assert.equal(
    resolveUsEquityMarketSession("2026-06-10T15:00:00.000Z").open,
    true,
  );
});

test("tradingDaysBetween counts NYSE trading-day boundaries, skipping weekends and holidays", () => {
  // Normal week: Mon 2026-06-08 -> Fri 2026-06-12 has 4 boundaries after Monday.
  assert.equal(tradingDaysBetween("2026-06-08", "2026-06-12"), 4);
  // Weekend span: Fri -> Mon is 1 trading day (Monday).
  assert.equal(tradingDaysBetween("2026-06-12", "2026-06-15"), 1);
  // Same-day and inverted spans are 0.
  assert.equal(tradingDaysBetween("2026-06-10", "2026-06-10"), 0);
  assert.equal(tradingDaysBetween("2026-06-12", "2026-06-08"), 0);
  // 2026-07-03 (Fri) is the observed Independence Day FULL holiday (Jul 4 is a
  // Saturday), so Thu 07-02 -> Mon 07-06 is 1 trading day, not 2.
  assert.equal(tradingDaysBetween("2026-07-02", "2026-07-06"), 1);
  // Juneteenth 2026-06-19 (Fri) is a full holiday: Thu -> Mon is 1.
  assert.equal(tradingDaysBetween("2026-06-18", "2026-06-22"), 1);
  // NY-day semantics: 2026-06-09T01:00Z is still NY Monday evening (06-08) and
  // 2026-06-09T20:00Z is NY Tuesday afternoon. A UTC-day count would say 0.
  assert.equal(
    tradingDaysBetween(
      new Date("2026-06-09T01:00:00Z"),
      new Date("2026-06-09T20:00:00Z"),
    ),
    1,
  );
  // Invalid input is 0, matching the degenerate-span contract.
  assert.equal(tradingDaysBetween("not-a-date", "2026-06-12"), 0);
});

test("previousTradingDayOrSame returns the same day when trading, else walks back past weekends/holidays", () => {
  // Wednesday 2026-06-10 is a trading day: unchanged.
  assert.equal(previousTradingDayOrSame("2026-06-10"), "2026-06-10");
  // Saturday 2026-07-04: Friday 07-03 is the observed holiday, so Thu 07-02.
  assert.equal(previousTradingDayOrSame("2026-07-04"), "2026-07-02");
  // The holiday itself also resolves to Thu 07-02.
  assert.equal(previousTradingDayOrSame("2026-07-03"), "2026-07-02");
  assert.throws(() => previousTradingDayOrSame("nope"), RangeError);
});

test("addTradingDays steps by trading days, skipping weekends and holidays", () => {
  // Mon 2026-07-06 minus 1 trading day skips the weekend AND the 07-03 holiday.
  assert.equal(addTradingDays("2026-07-06", -1), "2026-07-02");
  // Wed 2026-07-01 plus 2: Thu 07-02, then (07-03 holiday + weekend) Mon 07-06.
  assert.equal(addTradingDays("2026-07-01", 2), "2026-07-06");
  // past_week shape across Juneteenth: Wed 06-24 minus 4 lands on Wed 06-17
  // (Fri 06-19 does not count).
  assert.equal(addTradingDays("2026-06-24", -4), "2026-06-17");
  // Zero days returns the day unchanged (no snapping), matching the shape replaced.
  assert.equal(addTradingDays("2026-07-04", 0), "2026-07-04");
  assert.throws(() => addTradingDays("nope", 1), RangeError);
});

test("rthBarsBetween counts whole regular-session bars only", () => {
  const fiveMin = 5 * 60_000;
  // Full normal session (EDT: 13:30Z-20:00Z) is 390 min = 78 five-minute bars.
  assert.equal(
    rthBarsBetween(fiveMin, Date.parse("2026-06-10T13:30:00Z"), Date.parse("2026-06-10T20:00:00Z")),
    78,
  );
  // Weekend span Fri 12:00 ET -> Mon 12:00 ET: 48 Friday bars + 30 Monday bars.
  const friNoon = Date.parse("2026-06-12T16:00:00Z");
  const monNoon = Date.parse("2026-06-15T16:00:00Z");
  assert.equal(rthBarsBetween(fiveMin, friNoon, monNoon), 78);
  assert.equal(
    rthBarsBetween(fiveMin, friNoon, Date.parse("2026-06-12T20:00:00Z")) +
      rthBarsBetween(fiveMin, Date.parse("2026-06-15T13:30:00Z"), monNoon),
    78,
  );
  // Thu 2026-07-02 close -> Mon 2026-07-06 open bridges the 07-03 holiday: 0 bars.
  assert.equal(
    rthBarsBetween(fiveMin, Date.parse("2026-07-02T20:00:00Z"), Date.parse("2026-07-06T13:30:00Z")),
    0,
  );
  // Degenerate inputs are 0.
  assert.equal(rthBarsBetween(0, friNoon, monNoon), 0);
  assert.equal(rthBarsBetween(fiveMin, monNoon, friNoon), 0);
});

test("rthBarsBetween respects early closes (real date from listNyseEarlyCloses)", () => {
  const earlyCloses = listNyseEarlyCloses(2026);
  const dayAfterThanksgiving = earlyCloses.find((close) => close.date === "2026-11-27");
  assert.ok(dayAfterThanksgiving, "2026-11-27 must be a published early close");
  // 09:30-13:00 EST is 210 min = 7 thirty-minute bars, using the record's own close.
  const thirtyMin = 30 * 60_000;
  assert.equal(
    rthBarsBetween(
      thirtyMin,
      Date.parse("2026-11-27T14:30:00Z"),
      Date.parse(dayAfterThanksgiving.regularCloseAt),
    ),
    7,
  );
});

test("rthBarsBetween is DST-boundary sane (no hour gained or lost)", () => {
  const thirtyMin = 30 * 60_000;
  // Mon 2026-03-09, first session after spring-forward (open 13:30Z in EDT):
  // still exactly 13 thirty-minute bars across the whole UTC day.
  assert.equal(
    rthBarsBetween(thirtyMin, Date.parse("2026-03-09T00:00:00Z"), Date.parse("2026-03-10T00:00:00Z")),
    13,
  );
  // Mon 2026-11-02, first session after fall-back (open 14:30Z in EST): also 13.
  assert.equal(
    rthBarsBetween(thirtyMin, Date.parse("2026-11-02T00:00:00Z"), Date.parse("2026-11-03T00:00:00Z")),
    13,
  );
});

test("rthBarsBack steps whole session bars backward across gaps", () => {
  const fiveMin = 5 * 60_000;
  // 78 five-minute bars back from a normal close is that day's open.
  assert.equal(
    rthBarsBack(fiveMin, Date.parse("2026-06-10T20:00:00Z"), 78).toISOString(),
    "2026-06-10T13:30:00.000Z",
  );
  // 20 bars back from Mon 10:30 ET (12 Monday bars) reaches 8 bars into Friday:
  // Friday close 20:00Z minus 40 min.
  assert.equal(
    rthBarsBack(fiveMin, Date.parse("2026-06-15T14:30:00Z"), 20).toISOString(),
    "2026-06-12T19:20:00.000Z",
  );
  // Across the 2026-07-03 holiday weekend: 2 bars back from Mon 09:35 ET is one
  // bar into Thursday 07-02 (19:55Z).
  assert.equal(
    rthBarsBack(fiveMin, Date.parse("2026-07-06T13:35:00Z"), 2).toISOString(),
    "2026-07-02T19:55:00.000Z",
  );
  // Early-close aware: 7 thirty-minute bars back from Mon 2026-11-30 open is the
  // whole early session of Fri 2026-11-27 (open 14:30Z EST).
  assert.equal(
    rthBarsBack(30 * 60_000, Date.parse("2026-11-30T14:30:00Z"), 7).toISOString(),
    "2026-11-27T14:30:00.000Z",
  );
  // count <= 0 returns end unchanged.
  assert.equal(
    rthBarsBack(fiveMin, Date.parse("2026-06-10T15:00:00Z"), 0).toISOString(),
    "2026-06-10T15:00:00.000Z",
  );
});

test("rthBarsBack round-trips: barsBack then barsBetween >= count, within one bar", () => {
  const oneMin = 60_000;
  const end = Date.parse("2026-07-07T15:00:00Z"); // Tue mid-session
  const start = rthBarsBack(oneMin, end, 1000);
  const roundTrip = rthBarsBetween(oneMin, start.getTime(), end);
  assert.ok(roundTrip >= 1000, `round trip ${roundTrip} must be >= 1000`);
  assert.ok(roundTrip <= 1001, `round trip ${roundTrip} must be within one bar`);
});
