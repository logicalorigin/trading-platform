import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { __chartStreamingTestInternals } from "./useMassiveStreamedStockBars.ts";
import type { MarketBar } from "./types.ts";

const {
  areBarsEquivalent,
  buildLiveQuotePatchSignature,
  buildRuntimeQuotePatchSignature,
  patchBarsWithLiveQuote,
} = __chartStreamingTestInternals;
const source = readFileSync(
  new URL("./useMassiveStreamedStockBars.ts", import.meta.url),
  "utf8",
);

test("a Monday quote creates a Monday daily bar, not a weekend bar", () => {
  const fridayStartMs = Date.UTC(2026, 6, 17, 4);
  const mondayStartMs = Date.UTC(2026, 6, 20, 4);
  const bars: MarketBar[] = [
    {
      timestamp: new Date(fridayStartMs),
      open: 100,
      high: 102,
      low: 99,
      close: 101,
      volume: 1_000,
    },
  ];

  const patched = patchBarsWithLiveQuote(bars, "1d", {
    price: 103,
    updatedAt: new Date(Date.UTC(2026, 6, 20, 14)),
  });

  assert.equal(patched.length, 2);
  assert.equal((patched[1].timestamp as Date).getTime(), mondayStartMs);
});

test("a quote older than the latest bar cannot overwrite that bar", () => {
  const latestStartMs = Date.UTC(2026, 6, 20, 14);
  const bars: MarketBar[] = [
    {
      timestamp: new Date(latestStartMs),
      open: 100,
      high: 102,
      low: 99,
      close: 101,
      volume: 1_000,
    },
  ];

  const patched = patchBarsWithLiveQuote(bars, "1m", {
    price: 90,
    updatedAt: new Date(latestStartMs - 60_000),
  });

  assert.equal(patched[0].close, 101);
  assert.equal(patched[0].low, 99);
});

test("malformed quote timestamps leave the chart unchanged", () => {
  const bar: MarketBar = {
    timestamp: new Date("2026-07-20T14:00:00.000Z"),
    open: 100,
    high: 102,
    low: 99,
    close: 101,
    volume: 1_000,
  };

  for (const updatedAt of [{} as Date, new Date(Number.NaN)]) {
    assert.doesNotThrow(() => {
      const patched = patchBarsWithLiveQuote([bar], "1m", {
        price: 90,
        updatedAt,
      });
      assert.equal(patched[0].close, 101);
    });
  }
});

test("quote dataUpdatedAt can timestamp a live patch when updatedAt is absent", () => {
  const startMs = Date.UTC(2026, 6, 20, 14);
  const bar: MarketBar = {
    timestamp: new Date(startMs),
    open: 100,
    high: 102,
    low: 99,
    close: 101,
    volume: 1_000,
  };

  const patched = patchBarsWithLiveQuote([bar], "1m", {
    price: 103,
    dataUpdatedAt: new Date(startMs + 30_000),
  });

  assert.equal(patched[0].close, 103);
});

test("provider data time prevents a newer wrapper from applying stale quote data", () => {
  const startMs = Date.UTC(2026, 6, 20, 14);
  const bar: MarketBar = {
    timestamp: new Date(startMs),
    open: 100,
    high: 102,
    low: 99,
    close: 101,
    volume: 1_000,
    dataUpdatedAt: new Date(startMs + 30_000).toISOString(),
  };

  const patched = patchBarsWithLiveQuote([bar], "1m", {
    price: 90,
    updatedAt: new Date(startMs + 60_000),
    dataUpdatedAt: new Date(startMs - 60_000),
  });

  assert.equal(patched[0].close, 101);
  assert.equal(patched.length, 1);
});

test("Sunday overnight quotes patch the next trading day's daily candle", () => {
  const fridayStartMs = Date.UTC(2026, 6, 17, 4);
  const mondayStartMs = Date.UTC(2026, 6, 20, 4);
  const bars: MarketBar[] = [
    {
      timestamp: new Date(fridayStartMs),
      open: 100,
      high: 102,
      low: 99,
      close: 101,
      volume: 1_000,
    },
  ];

  const patched = patchBarsWithLiveQuote(bars, "1d", {
    price: 103,
    dataUpdatedAt: new Date("2026-07-20T00:05:00.000Z"),
  });

  assert.equal(patched.length, 2);
  assert.equal((patched[1].timestamp as Date).getTime(), mondayStartMs);
});

test("closed calendar days cannot create daily candles", () => {
  const thursdayStartMs = Date.UTC(2026, 6, 2, 4);
  const bars: MarketBar[] = [
    {
      timestamp: new Date(thursdayStartMs),
      open: 100,
      high: 102,
      low: 99,
      close: 101,
      volume: 1_000,
    },
  ];

  const patched = patchBarsWithLiveQuote(bars, "1d", {
    price: 103,
    dataUpdatedAt: new Date("2026-07-03T14:00:00.000Z"),
  });

  assert.equal(patched.length, 1);
  assert.equal(patched[0].close, 101);
});

test("changing option scope leaves the stored quote ready to be applied", () => {
  const effectStart = source.indexOf("setPatchedBars((current) => {");
  const scopeResetEffect = source.slice(
    effectStart,
    source.indexOf("}, [scopeKey]);", effectStart),
  );

  assert.match(
    scopeResetEffect,
    /lastAppliedQuoteSignatureRef\.current = null/,
  );
});

test("bar metadata changes are not mistaken for identical chart data", () => {
  const bar: MarketBar = {
    timestamp: new Date("2026-07-20T14:00:00.000Z"),
    open: 100,
    high: 102,
    low: 99,
    close: 101,
    volume: 1_000,
  };
  const changedMetadata: Array<Partial<MarketBar>> = [
    { vwap: 100.5 },
    { sessionVwap: 100.25 },
    { accumulatedVolume: 5_000 },
    { averageTradeSize: 20 },
    { ageMs: 1_000 },
    { delayed: true },
    { studyFallback: true },
  ];

  for (const metadata of changedMetadata) {
    assert.equal(areBarsEquivalent([bar], [{ ...bar, ...metadata }]), false);
  }
});

test("quote patch signatures include metadata that changes the rendered bar", () => {
  const quote = {
    price: 101,
    updatedAt: "2026-07-20T14:00:00.000Z",
    freshness: "live",
    marketDataMode: "live",
    dataUpdatedAt: "2026-07-20T14:00:00.000Z",
  };
  const signature = buildLiveQuotePatchSignature(quote);

  for (const changedQuote of [
    { ...quote, freshness: "stale" },
    { ...quote, marketDataMode: "delayed" },
    { ...quote, dataUpdatedAt: "2026-07-20T14:00:01.000Z" },
  ]) {
    assert.notEqual(buildLiveQuotePatchSignature(changedQuote), signature);
  }
});

test("runtime quote patch signatures include the rendered provider source", () => {
  const quote = {
    price: 101,
    dataUpdatedAt: "2026-07-20T14:00:00.000Z",
    freshness: "live",
    marketDataMode: "live",
  };

  assert.notEqual(
    buildRuntimeQuotePatchSignature({ ...quote, source: "ibkr" }),
    buildRuntimeQuotePatchSignature({ ...quote, source: "massive" }),
  );
});

test("fallback polling reports success and contains request failures", () => {
  const fallbackStart = source.indexOf("const runFallback = async () => {");
  const fallbackLoop = source.slice(
    fallbackStart,
    source.indexOf("const unsubscribe =", fallbackStart),
  );

  assert.match(fallbackLoop, /setStreamStatus\("fallback"\)/);
  assert.match(fallbackLoop, /catch\s*\{/);
  const successIndex = fallbackLoop.indexOf("lastFallbackCompletedAt = Date.now();");
  const emptyResultIndex = fallbackLoop.indexOf("if (!bars.length) return;");
  assert.ok(successIndex > -1 && successIndex < emptyResultIndex);
  assert.match(fallbackLoop.slice(successIndex, emptyResultIndex), /fallbackAttempt = 0/);
  const catchIndex = fallbackLoop.indexOf("} catch {");
  const finallyIndex = fallbackLoop.indexOf("} finally {", catchIndex);
  assert.match(fallbackLoop.slice(catchIndex, finallyIndex), /fallbackAttempt \+= 1/);
  assert.doesNotMatch(fallbackLoop.slice(finallyIndex), /fallbackAttempt \+= 1/);
});
