import assert from "node:assert/strict";
import test from "node:test";
import {
  buildUsEquityExtendedSessionWindows,
  countUsEquityMarketSessionBars,
  isNyseFullHoliday,
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
    "CLSD",
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

test("buildUsEquityExtendedSessionWindows groups premarket and after-hours bars", () => {
  const bars = [
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
      { label: "Premarket", startBarIndex: 0, endBarIndex: 2 },
      { label: "After-hours", startBarIndex: 4, endBarIndex: 5 },
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
    pre: 1,
    rth: 1,
    after: 1,
    closed: 1,
  });
});
