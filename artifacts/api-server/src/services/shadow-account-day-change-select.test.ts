import assert from "node:assert/strict";
import test from "node:test";

import { selectShadowPositionDayChange } from "./shadow-account";

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
