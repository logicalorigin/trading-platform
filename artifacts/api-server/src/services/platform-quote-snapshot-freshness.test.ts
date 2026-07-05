import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

process.env.MASSIVE_API_KEY = process.env.MASSIVE_API_KEY || "test-massive-key";
process.env.MASSIVE_STOCKS_RECENCY = "realtime";

const {
  getQuoteSnapshots,
  __platformQuoteSnapshotTestInternals: internals,
} = await import("./platform");

const platformSource = readFileSync(new URL("./platform.ts", import.meta.url), "utf8");

test("Massive realtime quote snapshots do not use provider REST fallback", async () => {
  internals.resetQuoteSnapshotCache();

  const payload = await getQuoteSnapshots({
    symbols: "PYRUS_NO_STORED_QUOTE_TEST",
    allowMassiveFallback: true,
  });

  assert.deepEqual(payload.quotes, []);
  assert.equal(payload.transport, null);
  assert.equal(payload.fallbackUsed, false);
});

test("stock quote snapshot service does not fall back to broker quote lines", () => {
  const start = platformSource.indexOf("async function getQuoteSnapshotsUncached");
  const end = platformSource.indexOf("\nfunction pruneQuoteSnapshotCache", start);
  assert.notEqual(start, -1, "getQuoteSnapshotsUncached is missing");
  assert.notEqual(end, -1, "getQuoteSnapshotsUncached end marker is missing");
  const body = platformSource.slice(start, end);

  assert.match(body, /fetchMassiveRestStockQuoteSnapshots\(symbols\)/);
  assert.doesNotMatch(body, /fetchBridgeQuoteSnapshots|getIbkrClient\(\)/);
});
