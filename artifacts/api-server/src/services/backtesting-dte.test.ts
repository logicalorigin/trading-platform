import assert from "node:assert/strict";
import test from "node:test";

import { __backtestingInternalsForTests } from "./backtesting";

const { calculateDte } = __backtestingInternalsForTests;

// Wave-2 C1 (trading-day DTE, product ruling 2026-07-07): backtest tenor
// selection must count NY trading days from the signal to the expiry's calendar
// date, not UTC calendar days — mirrors the live automation lane. Disclosed in
// .codex-watch/handoff-signal-options-lane-2026-07-07.md.
test("C1 calculateDte counts NY trading days from the signal to the expiry", () => {
  // Friday signal -> Monday expiry across the weekend = 1 trading day (was 3
  // calendar days; the Finding-1 Friday blackout for maxDte<=2 profiles).
  assert.equal(
    calculateDte(
      new Date("2026-06-12T18:00:00.000Z"),
      new Date("2026-06-15T00:00:00.000Z"),
    ),
    1,
  );

  // Holiday-adjacent: Thu 2026-07-02 -> Mon 2026-07-06 across the 2026-07-03
  // Independence Day holiday = 1 trading day (was 4 calendar days).
  assert.equal(
    calculateDte(
      new Date("2026-07-02T14:00:00.000Z"),
      new Date("2026-07-06T00:00:00.000Z"),
    ),
    1,
  );

  // Monday -> same-week Friday weekly = 4 trading days (HONEST count; the
  // work-order's "2" was arithmetically wrong, verified against the landed
  // market-calendar util). The conversion fixes weekend/holiday shrinkage, not
  // the same-week Monday->Friday distance.
  assert.equal(
    calculateDte(
      new Date("2026-06-08T13:30:00.000Z"),
      new Date("2026-06-12T00:00:00.000Z"),
    ),
    4,
  );
});
