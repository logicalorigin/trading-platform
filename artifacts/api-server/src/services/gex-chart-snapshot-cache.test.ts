import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

import { __setPoolQueryForTests, pool } from "@workspace/db";

import {
  __marketDataIngestInternalsForTests,
  getLatestChartGexSnapshot,
  getLatestGexSnapshotsForSymbols,
} from "./market-data-ingest";

const {
  __setChartGexSnapshotQueryForTests: setQuery,
  __setChartGexSnapshotCacheTtlMsForTests: setTtl,
  __resetChartGexSnapshotCacheForTests: resetCache,
} = __marketDataIngestInternalsForTests;

after(async () => {
  await pool.end();
});

let queryCount = 0;
function stubQuery(computedAt: Date, value: unknown = { options: [{}] }) {
  queryCount = 0;
  setQuery(async () => {
    queryCount += 1;
    return { payload: value as never, computedAt };
  });
}

beforeEach(() => {
  resetCache();
  setTtl(null);
  setQuery(null);
  queryCount = 0;
});

const opts = { maxExpirations: 6, strikesAroundMoney: 10 };

test("repeated reads within TTL run the heavy query once", async () => {
  stubQuery(new Date());
  setTtl(60_000);

  const a = await getLatestChartGexSnapshot("SPY", 60_000, opts);
  const b = await getLatestChartGexSnapshot("SPY", 60_000, opts);

  assert.equal(queryCount, 1, "second read served from cache");
  assert.ok(a && b);
  assert.equal(a.payload, b.payload);
});

test("concurrent reads are single-flighted into one query", async () => {
  stubQuery(new Date());
  setTtl(60_000);

  const [a, b, c] = await Promise.all([
    getLatestChartGexSnapshot("SPY", 60_000, opts),
    getLatestChartGexSnapshot("SPY", 60_000, opts),
    getLatestChartGexSnapshot("SPY", 60_000, opts),
  ]);

  assert.equal(queryCount, 1, "burst collapsed to one query");
  assert.ok(a && b && c);
});

test("stale/ageMs recompute live on a cache hit (not frozen)", async () => {
  const computedAt = new Date(Date.now() - 10_000); // 10s old
  stubQuery(computedAt);
  setTtl(60_000);

  const strict = await getLatestChartGexSnapshot("SPY", 5_000, opts); // maxAge 5s
  const lax = await getLatestChartGexSnapshot("SPY", 30_000, opts); // maxAge 30s

  assert.equal(queryCount, 1, "both served from one cached query");
  assert.equal(strict?.stale, true, "10s-old snapshot is stale at maxAge 5s");
  assert.equal(lax?.stale, false, "same snapshot is fresh at maxAge 30s");
});

test("a future-dated snapshot fails closed as stale", async () => {
  stubQuery(new Date(Date.now() + 60_000));
  setTtl(60_000);

  const snapshot = await getLatestChartGexSnapshot("SPY", 30_000, opts);

  assert.equal(snapshot?.ageMs, 0);
  assert.equal(snapshot?.stale, true);
});

test("bulk snapshots reject invalid dates and fail future dates closed", async (t) => {
  const previousDatabaseUrl = process.env["LOCAL_DATABASE_URL"];
  process.env["LOCAL_DATABASE_URL"] = "postgres://unit-test";
  const now = Date.now();
  const restorePool = __setPoolQueryForTests(async () => ({
    rows: [
      {
        symbol: "FUTURE",
        computed_at: new Date(now + 60_000),
        net_gex: "12.5",
      },
      {
        symbol: "INVALID",
        computed_at: new Date(Number.NaN),
        net_gex: "7",
      },
      {
        symbol: "FRESH",
        computed_at: new Date(now - 1_000),
        net_gex: "2",
      },
    ],
  }));
  t.after(() => {
    restorePool();
    if (previousDatabaseUrl === undefined) {
      delete process.env["LOCAL_DATABASE_URL"];
    } else {
      process.env["LOCAL_DATABASE_URL"] = previousDatabaseUrl;
    }
  });

  const snapshots = await getLatestGexSnapshotsForSymbols(
    ["FUTURE", "INVALID", "FRESH"],
    30_000,
  );
  const bySymbol = new Map(snapshots.map((snapshot) => [snapshot.symbol, snapshot]));

  assert.equal(bySymbol.get("FUTURE")?.ageMs, 0);
  assert.equal(bySymbol.get("FUTURE")?.stale, true);
  assert.equal(bySymbol.has("INVALID"), false);
  assert.equal(bySymbol.get("FRESH")?.stale, false);
});

test("a different symbol/scope does not collide; a new snapshot supersedes after TTL", async () => {
  // distinct keys → separate queries
  stubQuery(new Date());
  setTtl(60_000);
  await getLatestChartGexSnapshot("SPY", 60_000, opts);
  await getLatestChartGexSnapshot("QQQ", 60_000, opts);
  assert.equal(queryCount, 2, "different symbols are cached independently");

  // TTL=0 → every read re-queries (new snapshot picked up immediately)
  resetCache();
  stubQuery(new Date());
  setTtl(0);
  await getLatestChartGexSnapshot("SPY", 60_000, opts);
  await getLatestChartGexSnapshot("SPY", 60_000, opts);
  assert.equal(queryCount, 2, "expired entries re-query");
});

test("a missing snapshot is not cached (cheap to re-query)", async () => {
  queryCount = 0;
  setQuery(async () => {
    queryCount += 1;
    return null;
  });
  setTtl(60_000);

  assert.equal(await getLatestChartGexSnapshot("SPY", 60_000, opts), null);
  assert.equal(await getLatestChartGexSnapshot("SPY", 60_000, opts), null);
  assert.equal(queryCount, 2, "null results are not pinned for the TTL");
});
