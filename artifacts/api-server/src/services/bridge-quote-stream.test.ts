import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("quote stream watchdog uses transport signals before quote data age", () => {
  const source = readFileSync(new URL("./bridge-quote-stream.ts", import.meta.url), "utf8");
  const start = source.indexOf("function startStallTimer");
  const end = source.indexOf("function scheduleReconnect", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const block = source.slice(start, end);
  assert.match(block, /const currentSignalAt = resolveCurrentStreamSignalAt\(/);
  assert.match(block, /const currentActivityAt = currentSignalAt \?\? currentDataAt;/);
  assert.match(block, /now\.getTime\(\) - currentActivityAt\.getTime\(\)/);
});

test("rejected snapshot admissions release leases only for implicit owners", () => {
  const source = readFileSync(new URL("./bridge-quote-stream.ts", import.meta.url), "utf8");
  const start = source.indexOf("if (!admittedSymbols.length) {");
  assert.notEqual(start, -1);
  const block = source.slice(start, source.indexOf("return", start));
  // The all-rejected early return must mirror the normal-path finally:
  // explicit owners keep their TTL-managed leases; only implicit owners
  // release. A fully-rejected fetch under pressure must not tear down an
  // explicit owner's existing leases.
  assert.match(block, /if \(!explicitOwner\) \{\s*releaseMarketDataLeases\(owner, "snapshot_complete"\);/);
});
