import assert from "node:assert/strict";
import test from "node:test";
import { msUntilNextLocalDay } from "./AccountReturnsPanel.jsx";

test("account returns calendar schedules today refresh at local midnight", () => {
  const now = new Date(2026, 4, 13, 23, 59, 30, 0);
  const delay = msUntilNextLocalDay(now);

  assert.equal(delay, 30_025);
});

test("account returns calendar midnight refresh delay is bounded for bad dates", () => {
  assert.equal(msUntilNextLocalDay("not-a-date"), 60_000);
});
