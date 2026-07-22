import assert from "node:assert/strict";
import test from "node:test";

import { rollupMarketBars } from "./timeframeRollups";
import type { MarketBar } from "./types";

test("rollups preserve the closing bar's live-edge status", () => {
  const startMs = Date.UTC(2024, 0, 1);
  const bars: MarketBar[] = [
    {
      timestamp: startMs,
      o: 100,
      h: 102,
      l: 99,
      c: 101,
      v: 10,
      delayed: false,
      ageMs: 10,
    },
    {
      timestamp: startMs + 60_000,
      o: 101,
      h: 103,
      l: 100,
      c: 102,
      v: 20,
      delayed: true,
      ageMs: 250,
    },
  ];

  const [rolled] = rollupMarketBars(bars, "1m", "5m");

  assert.equal(rolled?.delayed, true);
  assert.equal(rolled?.ageMs, 250);
});
