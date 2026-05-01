import assert from "node:assert/strict";
import test from "node:test";
import {
  accountBenchmarkLimitForRange,
  accountBenchmarkTimeframeForRange,
  accountRangeStart,
  accountSnapshotBucketSizeMs,
  normalizeAccountRange,
} from "./account-ranges";

test("account history ranges include trailing 1D and 6M semantics", () => {
  const now = new Date("2026-04-30T12:00:00.000Z");

  assert.equal(normalizeAccountRange("1d"), "1D");
  assert.equal(normalizeAccountRange("6m"), "6M");
  assert.equal(normalizeAccountRange("bogus"), "1M");
  assert.equal(accountRangeStart("1D", now)?.toISOString(), "2026-04-29T12:00:00.000Z");
  assert.equal(accountRangeStart("6M", now)?.toISOString(), "2025-10-30T12:00:00.000Z");
  assert.equal(accountRangeStart("ALL", now), null);
});

test("account history ranges choose chart-appropriate buckets and benchmarks", () => {
  assert.equal(accountSnapshotBucketSizeMs("1D"), 60_000);
  assert.equal(accountSnapshotBucketSizeMs("6M"), 60 * 60_000);
  assert.equal(accountBenchmarkTimeframeForRange("1D"), "1m");
  assert.equal(accountBenchmarkTimeframeForRange("6M"), "1d");
  assert.equal(accountBenchmarkLimitForRange("1D"), 1_500);
});
