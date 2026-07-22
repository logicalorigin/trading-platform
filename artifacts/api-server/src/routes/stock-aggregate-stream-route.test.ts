import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createStockAggregateSnapshotHandoff,
  createStockAggregateSnapshotUpdateQueue,
} from "./stock-aggregate-snapshot-handoff";
import type { StockMinuteAggregateMessage } from "../services/stock-aggregate-stream";

const source = readFileSync(new URL("./platform.ts", import.meta.url), "utf8");

function routeSource(path: string, method = "get"): string {
  const start = source.indexOf(`router.${method}("${path}",`);
  assert.notEqual(start, -1, `Missing ${path}`);
  const next = source.indexOf("\nrouter.", start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

function aggregate(input: {
  startMs: number;
  close: number;
}): StockMinuteAggregateMessage {
  return {
    eventType: "AM",
    symbol: "SPY",
    open: input.close,
    high: input.close,
    low: input.close,
    close: input.close,
    volume: 1,
    accumulatedVolume: 1,
    vwap: input.close,
    sessionVwap: input.close,
    officialOpen: input.close,
    averageTradeSize: 1,
    startMs: input.startMs,
    endMs: input.startMs + 59_999,
    delayed: false,
    source: "massive-websocket",
  };
}

test("stock-aggregate snapshot handoff retains an event emitted during snapshot writes", async () => {
  const emitted: StockMinuteAggregateMessage[] = [];
  const handoff = createStockAggregateSnapshotHandoff((message) => {
    emitted.push(message);
  });
  const snapshotAggregate = aggregate({ startMs: 60_000, close: 500 });

  // A live value delivered before materialization is already represented by the
  // snapshot and must not be duplicated after the cutover.
  handoff.accept(snapshotAggregate);
  handoff.captureSnapshot([snapshotAggregate]);

  // Deterministically model the async snapshot-write yield: a newer correction
  // arrives after materialization but before ready. It must survive the handoff,
  // with repeated corrections for the same symbol/minute coalesced to the latest.
  handoff.accept(aggregate({ startMs: 60_000, close: 501 }));
  handoff.accept(aggregate({ startMs: 60_000, close: 502 }));
  assert.deepEqual(emitted, []);

  await handoff.finishSnapshot();

  assert.deepEqual(emitted.map(({ close }) => close), [502]);
});

test("stock-aggregate snapshot handoff drains every buffered correction in order", async () => {
  const emitted: number[] = [];
  const handoff = createStockAggregateSnapshotHandoff(async (message) => {
    await Promise.resolve();
    emitted.push(message.startMs);
  });

  for (let index = 0; index < 300; index += 1) {
    handoff.accept(aggregate({ startMs: index * 60_000, close: index }));
  }

  await handoff.finishSnapshot();

  assert.equal(emitted.length, 300);
  assert.deepEqual(
    emitted,
    Array.from({ length: 300 }, (_, index) => index * 60_000),
  );
});

test("stock-aggregate mutable snapshot updates execute one at a time", async () => {
  const enqueue = createStockAggregateSnapshotUpdateQueue();
  const events: string[] = [];
  let releaseFirst!: () => void;

  const first = enqueue(async () => {
    events.push("first:start");
    await new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    events.push("first:end");
  });
  const second = enqueue(async () => {
    events.push("second:start");
    events.push("second:end");
  });

  await Promise.resolve();
  assert.deepEqual(events, ["first:start"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, [
    "first:start",
    "first:end",
    "second:start",
    "second:end",
  ]);
});

test("stock-aggregate stream-open snapshot yields to the event loop in its write burst", () => {
  const handler = routeSource("/streams/stocks/aggregates");
  // The snapshot front-load can emit thousands of synchronous writes for a
  // multi-symbol subscribe; it must yield periodically so it does not monopolize
  // the single event loop during the market-open subscribe storm.
  assert.match(
    handler,
    /for \(const aggregate of snapshotAggregates\)/,
    "snapshot front-load loop is present",
  );
  assert.match(
    handler,
    /snapshotWritesSinceYield % SSE_SNAPSHOT_YIELD_EVERY === 0/,
    "snapshot loop must yield every SSE_SNAPSHOT_YIELD_EVERY writes",
  );
  assert.match(
    handler,
    /setImmediate\(resolve\)/,
    "snapshot loop yields via setImmediate",
  );
});

test("stock-aggregate stream subscribes before materializing its initial snapshot", () => {
  const handler = routeSource("/streams/stocks/aggregates");
  const subscriptionIndex = handler.indexOf(
    "subscribeMutableStockMinuteAggregates(",
  );
  const snapshotIndex = handler.indexOf("await writeSnapshotAggregates(symbols);");

  assert.notEqual(subscriptionIndex, -1, "live aggregate subscription exists");
  assert.notEqual(snapshotIndex, -1, "initial snapshot write exists");
  assert.ok(
    subscriptionIndex < snapshotIndex,
    "live subscription must be active before the yielding snapshot write begins",
  );
  assert.match(
    handler,
    /snapshotHandoff\.accept\(message, serializeEvent\)/,
    "live aggregate delivery passes through the snapshot handoff",
  );
});

test("stock-aggregate stream registers its mutable session before signaling ready", () => {
  const handler = routeSource("/streams/stocks/aggregates");
  const registrationIndex = handler.indexOf(
    "stockAggregateStreamSessions.set(sessionId",
  );
  const readyIndex = handler.indexOf("await writeReady(symbols);");

  assert.notEqual(registrationIndex, -1, "mutable session registration exists");
  assert.notEqual(readyIndex, -1, "initial ready signal exists");
  assert.ok(
    registrationIndex < readyIndex,
    "ready must not expose a session before it can accept symbol updates",
  );
});

test("SSE queue overflow closes visibly instead of silently dropping events", () => {
  assert.match(
    source,
    /if \(pendingChunks >= SSE_MAX_BUFFERED_CHUNKS\) \{\s*closeReason = "write_backpressure_overflow";\s*cleanup\(\);\s*return Promise\.resolve\(\);\s*\}/,
  );
});

test("SSE snapshot yield cadence is a bounded positive constant", () => {
  const match = source.match(/const SSE_SNAPSHOT_YIELD_EVERY = (\d+);/);
  assert.ok(match, "SSE_SNAPSHOT_YIELD_EVERY constant is defined");
  const cadence = Number(match![1]);
  assert.ok(
    cadence > 0 && cadence <= 64,
    `yield cadence ${cadence} should be a small positive batch size`,
  );
});

test("quote stream refreshes snapshots after quiet websocket periods", () => {
  const handler = routeSource("/streams/quotes");

  assert.match(
    source,
    /const QUOTE_STREAM_SNAPSHOT_REFRESH_MS = Math\.max\(/,
    "quote stream snapshot refresh interval is defined",
  );
  assert.match(
    handler,
    /setInterval\(\(\) => \{/,
    "quote stream should have a periodic snapshot refresh loop",
  );
  assert.match(
    handler,
    /payloadAgeMs < QUOTE_STREAM_SNAPSHOT_REFRESH_MS/,
    "quote stream should skip snapshot refresh while live payloads are recent",
  );
  assert.match(
    handler,
    /refreshSnapshot\("Quote snapshot refresh failed"\)/,
    "quote stream should fetch a snapshot when websocket payloads are quiet",
  );
  assert.match(
    handler,
    /clearInterval\(snapshotRefreshTimer\)/,
    "quote stream should clear the refresh interval on cleanup",
  );
});
