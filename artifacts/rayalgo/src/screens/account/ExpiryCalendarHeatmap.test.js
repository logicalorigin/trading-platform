import assert from "node:assert/strict";
import test from "node:test";
import {
  buildForwardCalendar,
  startOfExpiryCalendarDay,
} from "./ExpiryCalendarHeatmap.jsx";

test("expiry heatmap parses date-only expirations as calendar days", () => {
  const expiry = startOfExpiryCalendarDay("2026-05-15");

  assert.equal(expiry.getFullYear(), 2026);
  assert.equal(expiry.getMonth(), 4);
  assert.equal(expiry.getDate(), 15);
  assert.equal(startOfExpiryCalendarDay("2026-02-31"), null);
});

test("expiry heatmap places date-only option expirations on their stated day", () => {
  const days = buildForwardCalendar(
    [
      {
        marketValue: -250,
        optionContract: { expirationDate: "2026-05-15" },
      },
    ],
    new Date(2026, 4, 14),
  );

  const expiryDay = days.find((day) => day.iso === "2026-05-15");
  assert.equal(expiryDay?.notional, 250);
});
