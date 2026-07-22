import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultIndicatorRegistry } from "./indicators";
import type { ChartBar } from "./types";

const buildBars = (count: number): ChartBar[] =>
  Array.from({ length: count }, (_, index) => ({
    time: index + 1,
    ts: new Date(index * 60_000).toISOString(),
    date: "1970-01-01",
    o: 100 + index,
    h: 101 + index,
    l: 99 + index,
    c: 100.5 + index,
    v: 1_000,
  }));

test("MACD signal waits for nine real MACD values instead of warming on zeros", () => {
  const chartBars = buildBars(50);
  const output = defaultIndicatorRegistry["macd-12-26-9"].compute({
    chartBars,
    chartBarRanges: chartBars.map((bar) => ({
      startMs: bar.time * 1_000,
      endMs: bar.time * 1_000 + 60_000,
    })),
    rawBars: chartBars,
    timeframe: "1m",
    selectedIndicators: ["macd-12-26-9"],
  });

  const specs = new Map(
    output.studySpecs?.map((spec) => [spec.key, spec.data]) ?? [],
  );
  const macd = specs.get("macd-12-26-9-macd") ?? [];
  const signal = specs.get("macd-12-26-9-signal") ?? [];
  const histogram = specs.get("macd-12-26-9-histogram") ?? [];

  assert.equal(macd[0]?.time, chartBars[25].time);
  assert.equal(signal[0]?.time, chartBars[33].time);
  assert.equal(histogram[0]?.time, chartBars[33].time);
});

test("VWAP uses canonical session values and resets its fallback by session date", () => {
  const chartBars: ChartBar[] = [
    {
      time: 1,
      ts: "2026-07-20T14:30:00.000Z",
      date: "2026-07-20",
      o: 100,
      h: 100,
      l: 100,
      c: 100,
      v: 10,
      sessionVwap: 99.5,
    },
    {
      time: 2,
      ts: "2026-07-21T14:30:00.000Z",
      date: "2026-07-21",
      o: 200,
      h: 200,
      l: 200,
      c: 200,
      v: 10,
    },
  ];
  const output = defaultIndicatorRegistry.vwap.compute({
    chartBars,
    chartBarRanges: chartBars.map((bar) => ({
      startMs: bar.time * 1_000,
      endMs: bar.time * 1_000 + 60_000,
    })),
    rawBars: chartBars,
    timeframe: "1m",
    selectedIndicators: ["vwap"],
  });
  const values = output.studySpecs?.[0]?.data.map((point) => point.value);

  assert.deepEqual(values, [99.5, 200]);
});
