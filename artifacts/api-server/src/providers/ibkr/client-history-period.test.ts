import assert from "node:assert/strict";
import test from "node:test";
import { __ibkrClientTestInternals } from "./client";

test("IBKR historical duration uses years for windows longer than twelve months", () => {
  assert.equal(
    __ibkrClientTestInternals.buildHistoryPeriod("1d", 1_000, true),
    "3y",
  );
});

test("IBKR historical duration preserves shorter intraday windows", () => {
  assert.equal(
    __ibkrClientTestInternals.buildHistoryPeriod("15m", 1_000, false),
    "53d",
  );
});
