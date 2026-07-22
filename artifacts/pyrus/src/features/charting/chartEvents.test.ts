import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getChartEventLookbackWindow,
  getStableFlowEventKey,
  resolveFlowEventChartLoadedWindow,
} from "./chartEvents.ts";

test("monthly and yearly chart flow use the long-term lookback window", () => {
  const now = new Date("2026-07-20T12:00:00.000Z");
  const ninetyDaysMs = 90 * 24 * 60 * 60 * 1_000;

  for (const timeframe of ["1month", "1year"]) {
    const window = getChartEventLookbackWindow(timeframe, now);
    assert.equal(
      window.to.getTime() - window.from.getTime(),
      ninetyDaysMs,
      timeframe,
    );
  }
});

test("snapshot keys do not treat an empty strike as a zero-dollar contract", () => {
  assert.equal(
    getStableFlowEventKey({
      id: "fallback-id",
      symbol: "SPY",
      sourceBasis: "snapshot_activity",
      time: "2026-07-20T14:00:00.000Z",
      expirationDate: "2026-07-24",
      right: "call",
      strike: "",
    }),
    "snapshot|flow|SPY|2026-07-20|id:fallback-id",
  );
});

test("loaded chart windows use the canonical millisecond timestamp boundary", () => {
  assert.deepEqual(
    resolveFlowEventChartLoadedWindow(
      [{ time: 1_000_000_000_000 }],
      "1m",
    ),
    {
      fromMs: 999_999_940_000,
      toMs: 1_000_000_060_000,
    },
  );
});
