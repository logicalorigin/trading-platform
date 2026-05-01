import assert from "node:assert/strict";
import test from "node:test";
import {
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
