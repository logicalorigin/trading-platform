import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  normalizeBarsToStoreTimeframe,
  type MarketDataStoreTimeframe,
} from "./market-data-store";

const readMarketDataStoreSource = () =>
  readFileSync(new URL("./market-data-store.ts", import.meta.url), "utf8");

test("normalizeBarsToStoreTimeframe rebuilds malformed cached 5m bars", () => {
  const bars = [
    {
      timestamp: new Date("2026-04-27T18:56:00.000Z"),
      open: 100,
      high: 101,
      low: 99,
      close: 100.5,
      volume: 10,
    },
    {
      timestamp: new Date("2026-04-27T19:00:00.000Z"),
      open: 101,
      high: 102,
      low: 100,
      close: 101.5,
      volume: 20,
    },
    {
      timestamp: new Date("2026-04-27T19:01:00.000Z"),
      open: 102,
      high: 103,
      low: 101,
      close: 102.5,
      volume: 30,
    },
    {
      timestamp: new Date("2026-04-27T19:04:00.000Z"),
      open: 103,
      high: 104,
      low: 100.5,
      close: 103.5,
      volume: 40,
    },
  ];

  const normalized = normalizeBarsToStoreTimeframe(bars, "5m");

  assert.deepEqual(
    normalized.map((bar) => bar.timestamp.toISOString()),
    ["2026-04-27T18:55:00.000Z", "2026-04-27T19:00:00.000Z"],
  );
  assert.equal(normalized[1].open, 101);
  assert.equal(normalized[1].high, 104);
  assert.equal(normalized[1].low, 100);
  assert.equal(normalized[1].close, 103.5);
  assert.equal(normalized[1].volume, 90);
});

test("normalizeBarsToStoreTimeframe aligns every backend timeframe bucket", () => {
  const cases: Array<{
    timeframe: MarketDataStoreTimeframe;
    timestamps: string[];
    expected: string[];
  }> = [
    {
      timeframe: "1s",
      timestamps: ["2026-04-27T19:00:01.000Z", "2026-04-27T19:00:02.000Z"],
      expected: ["2026-04-27T19:00:01.000Z", "2026-04-27T19:00:02.000Z"],
    },
    {
      timeframe: "5s",
      timestamps: ["2026-04-27T19:00:01.000Z", "2026-04-27T19:00:04.000Z", "2026-04-27T19:00:06.000Z"],
      expected: ["2026-04-27T19:00:00.000Z", "2026-04-27T19:00:05.000Z"],
    },
    {
      timeframe: "15s",
      timestamps: ["2026-04-27T19:00:05.000Z", "2026-04-27T19:00:14.000Z", "2026-04-27T19:00:16.000Z"],
      expected: ["2026-04-27T19:00:00.000Z", "2026-04-27T19:00:15.000Z"],
    },
    {
      timeframe: "1m",
      timestamps: ["2026-04-27T19:00:05.000Z", "2026-04-27T19:00:40.000Z", "2026-04-27T19:01:01.000Z"],
      expected: ["2026-04-27T19:00:00.000Z", "2026-04-27T19:01:00.000Z"],
    },
    {
      timeframe: "15m",
      timestamps: ["2026-04-27T19:01:00.000Z", "2026-04-27T19:14:00.000Z", "2026-04-27T19:16:00.000Z"],
      expected: ["2026-04-27T19:00:00.000Z", "2026-04-27T19:15:00.000Z"],
    },
    {
      timeframe: "1h",
      timestamps: ["2026-04-27T19:05:00.000Z", "2026-04-27T19:55:00.000Z", "2026-04-27T20:01:00.000Z"],
      expected: ["2026-04-27T19:00:00.000Z", "2026-04-27T20:00:00.000Z"],
    },
    {
      timeframe: "1d",
      timestamps: ["2026-04-27T13:30:00.000Z", "2026-04-27T20:00:00.000Z", "2026-04-28T13:30:00.000Z"],
      expected: ["2026-04-27T00:00:00.000Z", "2026-04-28T00:00:00.000Z"],
    },
  ];

  cases.forEach(({ timeframe, timestamps, expected }) => {
    const bars = timestamps.map((timestamp, index) => ({
      timestamp: new Date(timestamp),
      open: 100 + index,
      high: 101 + index,
      low: 99 + index,
      close: 100.5 + index,
      volume: 10,
    }));

    assert.deepEqual(
      normalizeBarsToStoreTimeframe(bars, timeframe).map((bar) => bar.timestamp.toISOString()),
      expected,
      timeframe,
    );
  });
});

test("persistMarketDataBars upserts revised provider bars", () => {
  const source = readMarketDataStoreSource();

  assert.match(source, /onConflictDoUpdate\(\{/);
  assert.match(source, /barCacheTable\.instrumentId/);
  assert.match(source, /barCacheTable\.timeframe/);
  assert.match(source, /barCacheTable\.source/);
  assert.match(source, /barCacheTable\.startsAt/);
  assert.match(source, /open:\s*sql`excluded\.open`/);
  assert.match(source, /high:\s*sql`excluded\.high`/);
  assert.match(source, /low:\s*sql`excluded\.low`/);
  assert.match(source, /close:\s*sql`excluded\.close`/);
  assert.match(source, /volume:\s*sql`excluded\.volume`/);
});
