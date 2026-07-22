import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveBarTimestampMs } from "./chartBarTime.ts";

test("resolveBarTimestampMs: Date -> getTime()", () => {
  const d = new Date("2026-06-13T12:00:00.000Z");
  assert.equal(resolveBarTimestampMs(d), d.getTime());
  assert.equal(resolveBarTimestampMs(new Date(Number.NaN)), null);
});

test("resolveBarTimestampMs: ms-scale number (>=1e12) floored, kept as ms", () => {
  assert.equal(resolveBarTimestampMs(1_000_000_000_000), 1_000_000_000_000);
  assert.equal(resolveBarTimestampMs(1_700_000_000_000), 1_700_000_000_000);
  assert.equal(resolveBarTimestampMs(1_700_000_000_000.9), 1_700_000_000_000);
});

test("resolveBarTimestampMs: seconds-scale number (<1e12) scaled to ms", () => {
  assert.equal(resolveBarTimestampMs(1_700_000_000), 1_700_000_000 * 1000);
  assert.equal(resolveBarTimestampMs(1_700_000_000.5), Math.floor(1_700_000_000.5 * 1000));
});

test("resolveBarTimestampMs: non-finite number -> null", () => {
  assert.equal(resolveBarTimestampMs(Number.NaN), null);
  assert.equal(resolveBarTimestampMs(Number.POSITIVE_INFINITY), null);
});

test("resolveBarTimestampMs: parseable string -> Date.parse", () => {
  const iso = "2026-06-13T12:00:00.000Z";
  assert.equal(resolveBarTimestampMs(iso), Date.parse(iso));
});

test("resolveBarTimestampMs: unparseable string / other -> null", () => {
  assert.equal(resolveBarTimestampMs("not-a-date"), null);
  assert.equal(resolveBarTimestampMs(null), null);
  assert.equal(resolveBarTimestampMs(undefined), null);
  assert.equal(resolveBarTimestampMs({}), null);
});
