import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  __marketingShadowDashboardInternalsForTests,
  normalizeMarketingShadowDashboardInput,
} from "./marketing-shadow-dashboard";

const { readGenuineDegraded, readGenuineStale, buildWarnings } =
  __marketingShadowDashboardInternalsForTests;

const DB_FALLBACK_REASON =
  "Shadow account database is unavailable; using runtime-only shadow account fallback.";

test("pool-contention markers do not count as degraded or stale", () => {
  const stalecache = { degraded: true, stale: true, reason: "shadow_read_stale_cache" };
  const pressure = {
    degraded: true,
    stale: true,
    reason: "shadow_positions_pressure_fallback",
  };
  for (const subRead of [stalecache, pressure]) {
    assert.equal(readGenuineDegraded(subRead), false);
    assert.equal(readGenuineStale(subRead), false);
  }
});

test("genuine DB-unavailable fallback still counts as degraded", () => {
  const subRead = { degraded: true, stale: true, reason: DB_FALLBACK_REASON };
  assert.equal(readGenuineDegraded(subRead), true);
  assert.equal(readGenuineStale(subRead), true);
});

test("degraded with no reason is treated as genuine (not silently swallowed)", () => {
  const subRead = { degraded: true };
  assert.equal(readGenuineDegraded(subRead), true);
});

test("staleReason markers are read alongside reason", () => {
  const subRead = { stale: true, staleReason: "shadow_read_stale_cache" };
  assert.equal(readGenuineStale(subRead), false);
});

test("buildWarnings filters out contention markers but keeps real warnings", () => {
  const warnings = buildWarnings([
    { reason: "shadow_read_stale_cache" },
    { reason: "shadow_positions_pressure_fallback" },
    { reason: DB_FALLBACK_REASON },
  ]);
  assert.deepEqual(warnings, [DB_FALLBACK_REASON]);
});

test("marketing dashboard defaults to a bounded equity range unless ALL is explicit", () => {
  assert.equal(normalizeMarketingShadowDashboardInput({}).equityRange, "1D");
  assert.equal(
    normalizeMarketingShadowDashboardInput({ equityRange: "ALL" }).equityRange,
    "ALL",
  );
});

test("marketing dashboard snapshot stages cold DB reads", () => {
  const source = readFileSync(
    new URL("./marketing-shadow-dashboard.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf(
    "export async function fetchMarketingShadowDashboardSnapshot",
  );
  const end = source.indexOf("function signatureForPayload", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const block = source.slice(start, end);
  assert.doesNotMatch(block, /Promise\.all/);
});
