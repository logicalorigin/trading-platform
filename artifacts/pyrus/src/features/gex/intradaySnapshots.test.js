import assert from "node:assert/strict";
import test from "node:test";
import { buildIntradaySnapshots } from "./gexModel.js";

const minute = 60_000;

test("buildIntradaySnapshots handles empty input", () => {
  const result = buildIntradaySnapshots();
  assert.deepEqual(result.series, []);
  assert.equal(result.deltaSession, null);
  assert.equal(result.deltaRecent, null);
  assert.equal(result.isSparse, true);
  assert.equal(result.recentAnchorTs, null);
});

test("buildIntradaySnapshots returns zero deltas for a single point", () => {
  const result = buildIntradaySnapshots([{ ts: 1_000, netGex: 5 }]);
  assert.equal(result.series.length, 1);
  assert.equal(result.deltaSession, 0);
  assert.equal(result.deltaRecent, 0);
});

test("buildIntradaySnapshots computes deltas across a full session", () => {
  const base = Date.UTC(2026, 4, 10, 13, 30); // 9:30am ET
  const snapshots = Array.from({ length: 8 }, (_, index) => ({
    ts: new Date(base + index * 30 * minute).toISOString(),
    netGex: 10 + index * 5,
  }));

  const result = buildIntradaySnapshots(snapshots, { recentWindowMinutes: 30 });

  assert.equal(result.series.length, 8);
  assert.equal(result.deltaSession, snapshots[7].netGex - snapshots[0].netGex);
  // Recent window 30m -> anchor is the previous 30-min point (snapshot index 6).
  assert.equal(
    result.deltaRecent,
    snapshots[7].netGex - snapshots[6].netGex,
  );
  assert.equal(result.isSparse, false);
});

test("buildIntradaySnapshots falls back to last-N points when timestamps are sparse", () => {
  const base = Date.UTC(2026, 4, 10, 13, 30);
  // All snapshots within the last 5 minutes — the 30-min anchor doesn't exist.
  const snapshots = Array.from({ length: 7 }, (_, index) => ({
    ts: base + index * 30_000,
    netGex: 100 + index,
  }));

  const result = buildIntradaySnapshots(snapshots, {
    recentWindowMinutes: 30,
    sparseFallbackPoints: 5,
  });

  assert.equal(result.isSparse, true);
  assert.equal(result.deltaSession, 6);
  // Fallback uses the point 5 indices before the last (series[1] -> series[6]).
  assert.equal(result.deltaRecent, snapshots[6].netGex - snapshots[1].netGex);
});

test("buildIntradaySnapshots ignores invalid points and sorts by ts", () => {
  const out = buildIntradaySnapshots([
    { ts: 3_000, netGex: 30 },
    { ts: "not-a-date", netGex: 0 },
    { ts: 1_000, netGex: 10 },
    { ts: 2_000, netGex: null },
    { ts: 4_000, netGex: 40 },
  ]);
  assert.deepEqual(
    out.series.map((point) => point.ts),
    [1_000, 3_000, 4_000],
  );
  assert.equal(out.deltaSession, 30);
});

test("buildIntradaySnapshots delta sign matches direction", () => {
  const ts = Date.UTC(2026, 4, 10, 13, 30);
  const dropping = buildIntradaySnapshots([
    { ts, netGex: 100 },
    { ts: ts + 30 * minute, netGex: 80 },
    { ts: ts + 60 * minute, netGex: 50 },
  ]);
  assert.equal(dropping.deltaSession, -50);
  assert.ok(dropping.deltaRecent < 0);
});
