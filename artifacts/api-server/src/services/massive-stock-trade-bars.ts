// Build 1-minute OHLCV bars from individual trade ticks (Massive "T" channel).
//
// Why this exists: Massive's "AM" aggregate-minute channel emits few/no bars
// during extended hours because most extended-hours prints carry Sale Conditions
// that exclude them from aggregates (per Massive's KB). The signal monitor drives
// off the aggregate stream, so overnight it stops advancing. Building minute bars
// directly from the raw trade stream recovers those minutes. Trade-derived bars
// are only surfaced for minutes the AM channel did NOT cover, so AM stays
// authoritative during regular trading hours (see massive-stock-aggregate-stream).
//
// This module is pure (no I/O, no timers) so the rollover/finalize logic is unit
// testable; the wiring file owns subscriptions, the flush cadence and AM dedup.

export type TradeTick = {
  symbol: string;
  price: number;
  size: number;
  /** Trade timestamp in epoch milliseconds. */
  tsMs: number;
};

export type TradeMinuteBar = {
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap: number | null;
  tradeCount: number;
  startMs: number;
  endMs: number;
};

type Bucket = {
  startMs: number;
  endMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  notional: number; // sum(price * size), for vwap
  tradeCount: number;
};

const MINUTE_MS = 60_000;

export function minuteStartMs(tsMs: number): number {
  return Math.floor(tsMs / MINUTE_MS) * MINUTE_MS;
}

function newBucket(startMs: number, tick: TradeTick): Bucket {
  return {
    startMs,
    endMs: startMs + MINUTE_MS,
    open: tick.price,
    high: tick.price,
    low: tick.price,
    close: tick.price,
    volume: tick.size,
    notional: tick.price * tick.size,
    tradeCount: 1,
  };
}

function toBar(symbol: string, bucket: Bucket): TradeMinuteBar {
  return {
    symbol,
    open: bucket.open,
    high: bucket.high,
    low: bucket.low,
    close: bucket.close,
    volume: bucket.volume,
    vwap: bucket.volume > 0 ? bucket.notional / bucket.volume : null,
    tradeCount: bucket.tradeCount,
    startMs: bucket.startMs,
    endMs: bucket.endMs,
  };
}

export class TradeBarAggregator {
  private buckets = new Map<string, Bucket>();
  // Highest minute already finalized per symbol, so a late/out-of-order trade
  // cannot resurrect a closed minute and double-emit a bar for it.
  private lastFinalizedStartMs = new Map<string, number>();

  /**
   * Ingest one trade. Returns a finalized bar when this trade rolls the symbol
   * into a new minute (completing the previous minute); otherwise null.
   */
  ingest(tick: TradeTick): TradeMinuteBar | null {
    if (
      !tick.symbol ||
      !Number.isFinite(tick.price) ||
      !Number.isFinite(tick.size) ||
      tick.price <= 0 ||
      tick.size <= 0 ||
      !Number.isFinite(tick.tsMs)
    ) {
      return null;
    }
    const start = minuteStartMs(tick.tsMs);
    const lastFinalized = this.lastFinalizedStartMs.get(tick.symbol);
    if (lastFinalized !== undefined && start <= lastFinalized) {
      // Trade belongs to a minute we already emitted; drop it.
      return null;
    }

    const existing = this.buckets.get(tick.symbol);
    if (!existing) {
      this.buckets.set(tick.symbol, newBucket(start, tick));
      return null;
    }
    if (start > existing.startMs) {
      const finalized = toBar(tick.symbol, existing);
      this.lastFinalizedStartMs.set(tick.symbol, existing.startMs);
      this.buckets.set(tick.symbol, newBucket(start, tick));
      return finalized;
    }
    if (start < existing.startMs) {
      // Out-of-order trade for a minute older than the open bucket; drop it.
      return null;
    }
    existing.high = Math.max(existing.high, tick.price);
    existing.low = Math.min(existing.low, tick.price);
    existing.close = tick.price;
    existing.volume += tick.size;
    existing.notional += tick.price * tick.size;
    existing.tradeCount += 1;
    return null;
  }

  /**
   * Finalize every open bucket whose minute fully closed before
   * `nowMs - graceMs`. The grace window lets a late AM bar for the same minute
   * arrive first (so the wiring layer can suppress the trade-derived duplicate).
   */
  flush(nowMs: number, graceMs: number): TradeMinuteBar[] {
    const out: TradeMinuteBar[] = [];
    for (const [symbol, bucket] of this.buckets) {
      if (bucket.endMs <= nowMs - graceMs) {
        out.push(toBar(symbol, bucket));
        this.lastFinalizedStartMs.set(symbol, bucket.startMs);
        this.buckets.delete(symbol);
      }
    }
    return out;
  }

  /** Drop a symbol's state when it is no longer subscribed (bounds memory). */
  forget(symbol: string): void {
    this.buckets.delete(symbol);
    this.lastFinalizedStartMs.delete(symbol);
  }

  /** Retain only the given symbols' state. */
  retainOnly(symbols: Iterable<string>): void {
    const keep = new Set(symbols);
    for (const symbol of this.buckets.keys()) {
      if (!keep.has(symbol)) {
        this.buckets.delete(symbol);
      }
    }
    for (const symbol of this.lastFinalizedStartMs.keys()) {
      if (!keep.has(symbol)) {
        this.lastFinalizedStartMs.delete(symbol);
      }
    }
  }

  reset(): void {
    this.buckets.clear();
    this.lastFinalizedStartMs.clear();
  }
}
