import assert from "node:assert/strict";
import test from "node:test";

import { _testing, listNyseHolidays, listNyseEarlyCloses } from "./index.ts";

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

test("listNyseEarlyCloses returns a fresh array (cache is not mutable by callers)", () => {
  _testing.resetCalendarCaches();
  const a = listNyseEarlyCloses(2026);
  const b = listNyseEarlyCloses(2026);
  // Public API hands back independent arrays even though the build is cached.
  assert.notStrictEqual(a, b);
  assert.deepStrictEqual(a, b);
});
