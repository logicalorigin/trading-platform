import assert from "node:assert/strict";
import test from "node:test";

import {
  TradeBarAggregator,
  minuteStartMs,
} from "./massive-stock-trade-bars";

const M = 60_000;
const base = Math.floor(1_700_000_000_000 / M) * M; // minute-aligned epoch ms
assert.equal(minuteStartMs(base), base);
assert.equal(minuteStartMs(base + 37_123), base);

test("accumulates trades within a minute without emitting", () => {
  const agg = new TradeBarAggregator();
  assert.equal(agg.ingest({ symbol: "AAPL", price: 10, size: 1, tsMs: base + 1_000 }), null);
  assert.equal(agg.ingest({ symbol: "AAPL", price: 12, size: 2, tsMs: base + 2_000 }), null);
  assert.equal(agg.ingest({ symbol: "AAPL", price: 9, size: 3, tsMs: base + 3_000 }), null);
});

test("rolls over to a new minute and finalizes OHLCV + vwap of the prior minute", () => {
  const agg = new TradeBarAggregator();
  agg.ingest({ symbol: "AAPL", price: 10, size: 1, tsMs: base + 1_000 });
  agg.ingest({ symbol: "AAPL", price: 12, size: 2, tsMs: base + 2_000 });
  agg.ingest({ symbol: "AAPL", price: 9, size: 3, tsMs: base + 3_000 });
  // First trade of the next minute rolls the previous minute closed.
  const bar = agg.ingest({ symbol: "AAPL", price: 11, size: 1, tsMs: base + M + 500 });
  assert.ok(bar);
  assert.equal(bar.startMs, base);
  assert.equal(bar.endMs, base + M);
  assert.equal(bar.open, 10);
  assert.equal(bar.high, 12);
  assert.equal(bar.low, 9);
  assert.equal(bar.close, 9);
  assert.equal(bar.volume, 6); // 1 + 2 + 3
  assert.equal(bar.tradeCount, 3);
  // vwap = (10*1 + 12*2 + 9*3) / 6 = 61/6
  assert.ok(Math.abs((bar.vwap ?? 0) - 61 / 6) < 1e-9);
});

test("flush finalizes a trailing minute only after the grace window", () => {
  const agg = new TradeBarAggregator();
  agg.ingest({ symbol: "TSLA", price: 100, size: 5, tsMs: base + 10_000 });
  // Minute closes at base + M. With 12s grace, not ready at base + M + 5s.
  assert.deepEqual(agg.flush(base + M + 5_000, 12_000), []);
  const bars = agg.flush(base + M + 15_000, 12_000);
  assert.equal(bars.length, 1);
  assert.equal(bars[0]?.symbol, "TSLA");
  assert.equal(bars[0]?.close, 100);
  assert.equal(bars[0]?.volume, 5);
});

test("a closed minute is never emitted twice (rollover then flush)", () => {
  const agg = new TradeBarAggregator();
  agg.ingest({ symbol: "SPY", price: 50, size: 1, tsMs: base + 1_000 });
  const rolled = agg.ingest({ symbol: "SPY", price: 51, size: 1, tsMs: base + M + 1_000 });
  assert.ok(rolled); // minute `base` finalized via rollover
  // Late trade for the already-finalized minute must be dropped.
  assert.equal(agg.ingest({ symbol: "SPY", price: 49, size: 9, tsMs: base + 30_000 }), null);
  // Flush long after only emits the still-open second minute, once.
  const bars = agg.flush(base + 3 * M, 12_000);
  assert.equal(bars.length, 1);
  assert.equal(bars[0]?.startMs, base + M);
});

test("ignores non-physical trades (price/size <= 0, non-finite)", () => {
  const agg = new TradeBarAggregator();
  assert.equal(agg.ingest({ symbol: "X", price: 0, size: 1, tsMs: base }), null);
  assert.equal(agg.ingest({ symbol: "X", price: 10, size: 0, tsMs: base }), null);
  assert.equal(agg.ingest({ symbol: "X", price: -1, size: 1, tsMs: base }), null);
  assert.equal(agg.ingest({ symbol: "", price: 10, size: 1, tsMs: base }), null);
  // None of the above opened a bucket, so nothing flushes.
  assert.deepEqual(agg.flush(base + 5 * M, 12_000), []);
});

test("tracks symbols independently", () => {
  const agg = new TradeBarAggregator();
  agg.ingest({ symbol: "AAPL", price: 10, size: 1, tsMs: base + 1_000 });
  agg.ingest({ symbol: "MSFT", price: 20, size: 2, tsMs: base + 1_000 });
  const bars = agg.flush(base + 2 * M, 12_000).sort((a, b) => a.symbol.localeCompare(b.symbol));
  assert.equal(bars.length, 2);
  assert.equal(bars[0]?.symbol, "AAPL");
  assert.equal(bars[1]?.symbol, "MSFT");
  assert.equal(bars[1]?.volume, 2);
});

test("retainOnly / forget bound memory", () => {
  const agg = new TradeBarAggregator();
  agg.ingest({ symbol: "AAPL", price: 10, size: 1, tsMs: base + 1_000 });
  agg.ingest({ symbol: "MSFT", price: 20, size: 1, tsMs: base + 1_000 });
  agg.retainOnly(["AAPL"]);
  const bars = agg.flush(base + 2 * M, 12_000);
  assert.equal(bars.length, 1);
  assert.equal(bars[0]?.symbol, "AAPL");
});
