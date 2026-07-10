import assert from "node:assert/strict";
import test from "node:test";

import {
  selectShadowPositionDayChange,
  shadowPositionMarkStaleForDayChange,
} from "./shadow-account";

// Regression for the "prior-day shadow options show $0 day change" bug (e.g. RH, ABSI):
// a gaining prior-day option (baseline mark 1920 -> current 2920 => +$1000) rendered $0
// because the unreliable option-quote day change (0) overrode the accurate baseline.
test("prior-day position prefers the accurate baseline over a zero option-quote day change", () => {
  const result = selectShadowPositionDayChange({
    sameDayPosition: false,
    valuationEligible: true,
    // For a prior-day position the caller passes quoteDayChange here; it must NOT win.
    valuationDayChange: { dayChange: 0, dayChangePercent: 0 },
    storedDayChange: { dayChange: 1000, dayChangePercent: 52.08 },
    quoteDayChange: { dayChange: 0, dayChangePercent: 0 },
  });
  assert.equal(result.dayChange, 1000);
  assert.equal(result.dayChangePercent, 52.08);
});

test("same-day position uses the live-mark valuation day change", () => {
  const result = selectShadowPositionDayChange({
    sameDayPosition: true,
    valuationEligible: true,
    valuationDayChange: { dayChange: 400, dayChangePercent: 28.17 },
    storedDayChange: { dayChange: 400, dayChangePercent: 28.17 },
    quoteDayChange: { dayChange: 0, dayChangePercent: 0 },
  });
  assert.equal(result.dayChange, 400);
});

test("prior-day position falls back to the option quote only when there is no baseline", () => {
  const result = selectShadowPositionDayChange({
    sameDayPosition: false,
    valuationEligible: true,
    valuationDayChange: { dayChange: 270, dayChangePercent: 17.4 },
    storedDayChange: { dayChange: null, dayChangePercent: null },
    quoteDayChange: { dayChange: 270, dayChangePercent: 17.4 },
  });
  assert.equal(result.dayChange, 270);
});

test("returns the (null) stored day change when nothing is available", () => {
  const result = selectShadowPositionDayChange({
    sameDayPosition: false,
    valuationEligible: true,
    valuationDayChange: null,
    storedDayChange: { dayChange: null, dayChangePercent: null },
    quoteDayChange: null,
  });
  assert.equal(result.dayChange, null);
});

// Regression for the "same-day option with no post-fill quote serves $0" bug
// (2026-07-09: UCTT/SAIL/HON opened intraday, quote fetch failed all session, mark
// stayed on the opening fill => marketValue == entry baseline => fabricated $0 day
// change instead of the honest unknown/null).
test("mark still sitting on the opening fill is stale for day change", () => {
  const dayStart = new Date("2026-07-09T04:00:00.000Z");
  const openedAt = new Date("2026-07-09T17:58:15.605Z");
  assert.equal(
    shadowPositionMarkStaleForDayChange({
      asOf: openedAt, // never re-observed after the fill
      openedAt,
      dayStart,
    }),
    true,
  );
});

test("mark observed after the opening fill is fresh for day change", () => {
  const dayStart = new Date("2026-07-09T04:00:00.000Z");
  assert.equal(
    shadowPositionMarkStaleForDayChange({
      asOf: new Date("2026-07-09T19:30:00.000Z"),
      openedAt: new Date("2026-07-09T17:58:15.605Z"),
      dayStart,
    }),
    false,
  );
});

test("mark from before the day-change baseline stays stale", () => {
  assert.equal(
    shadowPositionMarkStaleForDayChange({
      asOf: new Date("2026-07-08T20:00:00.000Z"),
      openedAt: new Date("2026-07-01T14:30:00.000Z"),
      dayStart: new Date("2026-07-09T04:00:00.000Z"),
    }),
    true,
  );
});

test("missing openedAt falls back to baseline-only staleness", () => {
  assert.equal(
    shadowPositionMarkStaleForDayChange({
      asOf: new Date("2026-07-09T19:30:00.000Z"),
      openedAt: null,
      dayStart: new Date("2026-07-09T04:00:00.000Z"),
    }),
    false,
  );
});
