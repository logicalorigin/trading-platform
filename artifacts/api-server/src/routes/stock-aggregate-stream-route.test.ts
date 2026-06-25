import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./platform.ts", import.meta.url), "utf8");

function routeSource(path: string, method = "get"): string {
  const start = source.indexOf(`router.${method}("${path}",`);
  assert.notEqual(start, -1, `Missing ${path}`);
  const next = source.indexOf("\nrouter.", start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

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

test("SSE snapshot yield cadence is a bounded positive constant", () => {
  const match = source.match(/const SSE_SNAPSHOT_YIELD_EVERY = (\d+);/);
  assert.ok(match, "SSE_SNAPSHOT_YIELD_EVERY constant is defined");
  const cadence = Number(match![1]);
  assert.ok(
    cadence > 0 && cadence <= 64,
    `yield cadence ${cadence} should be a small positive batch size`,
  );
});
