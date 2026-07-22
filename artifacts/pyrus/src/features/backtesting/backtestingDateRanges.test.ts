import assert from "node:assert/strict";
import test from "node:test";

import { toUtcDateRangeIso } from "./backtestingDateRanges";

test("toUtcDateRangeIso preserves explicit UTC day boundaries", () => {
  assert.deepEqual(toUtcDateRangeIso("2026-07-01", "2026-07-03"), {
    startsAt: "2026-07-01T00:00:00.000Z",
    endsAt: "2026-07-03T23:59:59.999Z",
  });
});

test("toUtcDateRangeIso rejects missing and impossible calendar dates", () => {
  assert.equal(toUtcDateRangeIso("", "2026-07-03"), null);
  assert.equal(toUtcDateRangeIso("2026-07-01", ""), null);
  assert.equal(toUtcDateRangeIso("2026-02-30", "2026-07-03"), null);
});

test("toUtcDateRangeIso rejects a reversed range", () => {
  assert.equal(toUtcDateRangeIso("2026-07-04", "2026-07-03"), null);
});
