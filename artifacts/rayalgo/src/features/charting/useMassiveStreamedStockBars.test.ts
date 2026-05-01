import assert from "node:assert/strict";
import test from "node:test";
import { getChartHydrationStatsSnapshot } from "./chartHydrationStats";
import {
  normalizeChartBarsPagePayload,
  normalizeLatestChartBarsPayload,
} from "./chartBarsPayloads";
import { __chartStreamingTestInternals } from "./useMassiveStreamedStockBars";

const buildBar = (index: number) => {
  const timestamp = new Date(1_700_000_000_000 + index * 60_000);
  return {
    timestamp,
    time: timestamp.getTime(),
    ts: timestamp.toISOString(),
    open: 100 + index,
    high: 101 + index,
    low: 99 + index,
    close: 100.5 + index,
    volume: 1_000 + index,
  };
};

test("live chart patch caps preserve hydrated base bars before trimming", () => {
  const baseBars = Array.from({ length: 2_000 }, (_item, index) =>
    buildBar(index),
  );
  const liveBars = Array.from({ length: 20 }, (_item, index) =>
    buildBar(2_000 + index),
  );
  const limit = __chartStreamingTestInternals.resolvePatchedBarLimit(
    "15m",
    baseBars,
  );
  const patchedBars = __chartStreamingTestInternals.mergeAndCapPatchedBars(
    baseBars,
    liveBars,
    limit,
  );

  assert.equal(limit >= baseBars.length + liveBars.length, true);
  assert.equal(patchedBars.length, baseBars.length + liveBars.length);
  assert.equal(patchedBars[0]?.time, baseBars[0]?.time);
});

test("5m historical stream patches merge into the hydrated candle bucket", () => {
  const baseStart = Date.parse("2026-04-27T13:30:00.000Z");
  const baseBars = [
    {
      timestamp: new Date(baseStart + 61_000).toISOString(),
      time: baseStart + 61_000,
      open: 100,
      high: 101,
      low: 99,
      close: 100.5,
      volume: 1_000,
    },
  ];

  const patched = __chartStreamingTestInternals.patchBarsWithHistoricalBarStream(
    baseBars,
    {
      timestamp: new Date(baseStart + 240_000).toISOString(),
      open: 100,
      high: 102,
      low: 98,
      close: 101.5,
      volume: 1_500,
    },
    "5m",
  );

  assert.equal(patched.length, 1);
  assert.equal(patched[0]?.time, baseStart);
  assert.equal(patched[0]?.close, 101.5);
  assert.equal(patched[0]?.volume, 1_500);
});

test("5m patched bar merging dedupes timestamps within the same interval", () => {
  const bucketStart = Date.parse("2026-04-27T13:30:00.000Z");
  const baseBars = [
    {
      timestamp: new Date(bucketStart + 10_000),
      open: 100,
      high: 101,
      low: 99,
      close: 100.25,
      volume: 1_000,
    },
  ];
  const liveBars = [
    {
      timestamp: new Date(bucketStart + 250_000),
      open: 100,
      high: 102,
      low: 98,
      close: 101,
      volume: 1_200,
    },
  ];

  const patched = __chartStreamingTestInternals.mergeAndCapPatchedBars(
    baseBars,
    liveBars,
    20,
    "5m",
  );

  assert.equal(patched.length, 1);
  assert.equal(patched[0]?.time, bucketStart);
  assert.equal(patched[0]?.close, 101);
});

test("prepend lookback spans sparse intraday calendar gaps", () => {
  const lookbackMs = __chartStreamingTestInternals.resolvePrependLookbackMs(
    "5s",
    360,
  );

  assert.equal(lookbackMs >= 7 * 24 * 60 * 60 * 1_000, true);
});

test("older bars payload preserves server history metadata", () => {
  const bar = buildBar(1);
  const historyPage = {
    requestedFrom: "2026-04-24T00:00:00.000Z",
    requestedTo: "2026-04-30T00:00:00.000Z",
    oldestBarAt: "2026-04-29T13:30:00.000Z",
    newestBarAt: "2026-04-29T20:00:00.000Z",
    returnedCount: 1,
    nextBefore: "2026-04-29T13:29:59.999Z",
    provider: "polygon-history",
    exhaustedBefore: false,
    providerCursor: "https://api.polygon.io/v2/aggs/ticker/SPY/range/1/minute/1/2",
    providerNextUrl: "https://api.polygon.io/v2/aggs/ticker/SPY/range/1/minute/1/2",
    providerPageCount: 2,
    providerPageLimitReached: true,
    historyCursor: "opaque-history-cursor",
  };

  const normalized = __chartStreamingTestInternals.normalizeHistoricalBarsPayload({
    bars: [bar],
    historyPage,
  });

  assert.equal(normalized.bars.length, 1);
  assert.equal(normalized.historyPage?.nextBefore, historyPage.nextBefore);
  assert.equal(normalized.historyPage?.provider, "polygon-history");
  assert.equal(normalized.historyPage?.providerCursor, historyPage.providerCursor);
  assert.equal(normalized.historyPage?.providerPageCount, 2);
  assert.equal(normalized.historyPage?.providerPageLimitReached, true);
  assert.equal(normalized.historyPage?.historyCursor, "opaque-history-cursor");
});

test("base bar normalization rejects accidental response envelopes without crashing", () => {
  const normalized = __chartStreamingTestInternals.normalizeBaseBars(
    {
      bars: [buildBar(1)],
      historyPage: null,
    },
    "1m",
  );

  assert.equal(normalized.length, 0);
});

test("chart bars payload helpers normalize API envelopes for latest and older fetches", () => {
  const bar = buildBar(1);
  const latest = normalizeLatestChartBarsPayload(
    {
      bars: [bar],
      historyPage: null,
    },
    { context: "test-latest" },
  );
  const older = normalizeChartBarsPagePayload(
    {
      bars: [bar],
      historyPage: {
        provider: "polygon-history",
        providerCursor:
          "https://api.polygon.io/v2/aggs/ticker/SPY/range/1/minute/1/2",
        providerPageCount: 2,
        providerPageLimitReached: true,
        historyCursor: "opaque-history-cursor",
      },
    },
    { context: "test-older" },
  );

  assert.equal(latest.length, 1);
  assert.equal(older.bars.length, 1);
  assert.equal(older.historyPage?.providerCursor?.includes("SPY"), true);
  assert.equal(older.historyPage?.providerPageCount, 2);
  assert.equal(older.historyPage?.historyCursor, "opaque-history-cursor");
});

test("chart bars payload helper records shape errors", () => {
  const before =
    getChartHydrationStatsSnapshot().counters.payloadShapeError ?? 0;
  const normalized = normalizeLatestChartBarsPayload(
    {
      bars: { unexpected: true },
    },
    { context: "test-shape-error" },
  );
  const after =
    getChartHydrationStatsSnapshot().counters.payloadShapeError ?? 0;

  assert.equal(normalized.length, 0);
  assert.equal(after >= before + 1, true);
});
