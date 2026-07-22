import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildResearchChartModel,
  buildResearchChartModelIncremental,
} from "./model.ts";

const barAt = (time: number | Date) => ({
  time,
  open: 100,
  high: 101,
  low: 99,
  close: 100,
  volume: 1_000,
});

test("chart model uses the canonical millisecond timestamp boundary", () => {
  const model = buildResearchChartModel({
    bars: [barAt(1_000_000_000_000)],
    timeframe: "1m",
  });

  assert.equal(model.chartBars[0]?.time, 1_000_000_000);
});

test("chart model ignores an invalid Date timestamp", () => {
  const model = buildResearchChartModel({
    bars: [barAt(new Date(Number.NaN))],
    timeframe: "1m",
  });

  assert.equal(model.chartBars.length, 0);
});

test("incremental append matches a full rebuild when prior bar metadata changes", () => {
  const firstBar = {
    ...barAt(1_700_000_000),
    sessionVwap: 100,
    freshness: "snapshot",
    delayed: false,
  };
  const initial = buildResearchChartModelIncremental({
    bars: [firstBar],
    timeframe: "1m",
  });
  const bars = [
    {
      ...firstBar,
      sessionVwap: 101,
      freshness: "stream",
      delayed: true,
    },
    barAt(1_700_000_060),
  ];
  const incremental = buildResearchChartModelIncremental(
    { bars, timeframe: "1m" },
    initial.state,
  ).model;
  const full = buildResearchChartModel({ bars, timeframe: "1m" });

  assert.deepEqual(incremental.chartBars, full.chartBars);
});

test("incremental tail patch refreshes ranges after a subsecond time correction", () => {
  const initialBars = [
    barAt(1_700_000_000),
    barAt(1_700_000_059.1),
  ];
  const initial = buildResearchChartModelIncremental({
    bars: initialBars,
    timeframe: "1m",
  });
  const bars = [
    initialBars[0],
    barAt(1_700_000_059.9),
  ];
  const incremental = buildResearchChartModelIncremental(
    { bars, timeframe: "1m" },
    initial.state,
  ).model;
  const full = buildResearchChartModel({ bars, timeframe: "1m" });

  assert.deepEqual(incremental.chartBarRanges, full.chartBarRanges);
});
