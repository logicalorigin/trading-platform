import assert from "node:assert/strict";
import test from "node:test";
import { startOfIsoWeek } from "./TradingPatternsPanel.jsx";

test("trading patterns weekly buckets parse date-only rows as calendar days", () => {
  const week = startOfIsoWeek("2026-05-13");

  assert.equal(week.getFullYear(), 2026);
  assert.equal(week.getMonth(), 4);
  assert.equal(week.getDate(), 11);
  assert.equal(startOfIsoWeek("2026-02-31"), null);
});
