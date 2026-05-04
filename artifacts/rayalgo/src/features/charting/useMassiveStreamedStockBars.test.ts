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

test("historical live patch scheduler coalesces one frame to latest bar per bucket", () => {
  const callbacks: Array<() => void> = [];
  const applied: Array<{
    items: Array<{ timestamp: string; close: number }>;
    stats: { queued: number; applied: number; coalesced: number; duplicates: number };
  }> = [];
  const scheduler = __chartStreamingTestInternals.createLiveBarFrameScheduler<{
    timestamp: string;
    close: number;
  }>({
    getBucketKey: (item) => item.timestamp,
    getSignature: (item) => `${item.timestamp}:${item.close}`,
    requestFrame: (callback) => {
      callbacks.push(callback);
      return callbacks.length;
    },
    cancelFrame: () => {},
    apply: (items, stats) => {
      applied.push({ items, stats });
    },
  });

  scheduler.enqueue({ timestamp: "2026-04-27T13:30:00.000Z", close: 100 });
  scheduler.enqueue({ timestamp: "2026-04-27T13:30:00.000Z", close: 101 });
  scheduler.enqueue({ timestamp: "2026-04-27T13:31:00.000Z", close: 102 });

  assert.equal(callbacks.length, 1);
  callbacks[0]?.();

  assert.equal(applied.length, 1);
  assert.deepEqual(
    applied[0]?.items.map((item) => item.close),
    [101, 102],
  );
  assert.deepEqual(applied[0]?.stats, {
    queued: 3,
    applied: 2,
    coalesced: 1,
    duplicates: 0,
  });
});

test("historical live patch scheduler counts duplicate pending bucket payloads", () => {
  const scheduler =
    __chartStreamingTestInternals.createLiveBarFrameScheduler<{
      timestamp: string;
      close: number;
    }>({
      getBucketKey: (item) => item.timestamp,
      getSignature: (item) => `${item.timestamp}:${item.close}`,
      requestFrame: () => 1,
      cancelFrame: () => {},
      apply: (_items, stats) => {
        assert.deepEqual(stats, {
          queued: 2,
          applied: 1,
          coalesced: 1,
          duplicates: 1,
        });
      },
    });

  scheduler.enqueue({ timestamp: "2026-04-27T13:30:00.000Z", close: 100 });
  scheduler.enqueue({ timestamp: "2026-04-27T13:30:00.000Z", close: 100 });
  scheduler.flush();
});

test("daily live aggregate patch appends a missing current-session bar", () => {
  const dailyBars = [
    {
      timestamp: "2026-04-29T04:00:00.000Z",
      open: 100,
      high: 103,
      low: 99,
      close: 102,
      volume: 1_000,
      source: "ibkr-history",
    },
  ];
  const patched = __chartStreamingTestInternals.mergeBarsWithMinuteAggregateList(
    "1d",
    dailyBars,
    [
      {
        eventType: "stock-aggregate",
        symbol: "SPY",
        open: 103,
        high: 104,
        low: 102.5,
        close: 103.5,
        volume: 100,
        accumulatedVolume: 100,
        vwap: 103.3,
        sessionVwap: 103.3,
        officialOpen: 103,
        averageTradeSize: 10,
        startMs: Date.parse("2026-04-30T13:30:00.000Z"),
        endMs: Date.parse("2026-04-30T13:31:00.000Z"),
        delayed: false,
        source: "ibkr-websocket-derived",
      },
      {
        eventType: "stock-aggregate",
        symbol: "SPY",
        open: 103.5,
        high: 105,
        low: 103.25,
        close: 104.75,
        volume: 150,
        accumulatedVolume: 250,
        vwap: 104,
        sessionVwap: 103.75,
        officialOpen: 103,
        averageTradeSize: 12,
        startMs: Date.parse("2026-04-30T13:31:00.000Z"),
        endMs: Date.parse("2026-04-30T13:32:00.000Z"),
        delayed: false,
        source: "ibkr-websocket-derived",
      },
    ],
  );

  assert.equal(patched.length, 2);
  assert.equal(patched[0]?.ts?.startsWith("2026-04-29"), true);
  assert.equal(patched[1]?.ts?.startsWith("2026-04-30"), true);
  assert.equal(patched[1]?.open, 103);
  assert.equal(patched[1]?.high, 105);
  assert.equal(patched[1]?.low, 102.5);
  assert.equal(patched[1]?.close, 104.75);
  assert.equal(patched[1]?.volume, 250);
});

test("historical bar streams reject stale payloads for prior symbols or intervals", () => {
  const url = "/api/streams/bars?symbol=SPY&timeframe=5m&source=trades";
  const bar = {
    timestamp: "2026-04-27T13:30:00.000Z",
    open: 100,
    high: 101,
    low: 99,
    close: 100.5,
    volume: 1_000,
  };

  assert.equal(
    __chartStreamingTestInternals.isHistoricalBarStreamPayloadForUrl(url, {
      symbol: "SPY",
      timeframe: "5m",
      bar,
    }),
    true,
  );
  assert.equal(
    __chartStreamingTestInternals.isHistoricalBarStreamPayloadForUrl(url, {
      symbol: "QQQ",
      timeframe: "5m",
      bar,
    }),
    false,
  );
  assert.equal(
    __chartStreamingTestInternals.isHistoricalBarStreamPayloadForUrl(url, {
      symbol: "SPY",
      timeframe: "1m",
      bar,
    }),
    false,
  );
});

test("prepend lookback spans sparse intraday calendar gaps", () => {
  const lookbackMs = __chartStreamingTestInternals.resolvePrependLookbackMs(
    "5s",
    360,
  );

  assert.equal(lookbackMs >= 7 * 24 * 60 * 60 * 1_000, true);
});

test("older history page sizes convert rolled intervals to base bars", () => {
  assert.equal(
    __chartStreamingTestInternals.resolvePrependRequestPageSize({
      pageSize: 480,
      pageSizeTimeframe: "4h",
      timeframe: "1h",
    }),
    1_920,
  );
  assert.equal(
    __chartStreamingTestInternals.resolvePrependRequestPageSize({
      pageSize: 360,
      pageSizeTimeframe: "15s",
      timeframe: "5s",
    }),
    1_080,
  );
  assert.equal(
    __chartStreamingTestInternals.resolvePrependRequestPageSize({
      pageSize: 240,
      pageSizeTimeframe: "5m",
      timeframe: "5m",
    }),
    240,
  );
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
