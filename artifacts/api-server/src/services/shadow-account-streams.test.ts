import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./shadow-account-streams.ts", import.meta.url), "utf8");

test("shadow account stream snapshot uses live quote hydration", () => {
  const start = source.indexOf("export async function fetchShadowAccountSnapshotBase");
  assert.notEqual(start, -1, "Missing fetchShadowAccountSnapshotBase");
  const nextFunction = source.indexOf("\nexport function", start + 1);
  const body = source.slice(start, nextFunction === -1 ? undefined : nextFunction);

  assert.match(body, /getShadowAccountPositions\(\{ liveQuotes: true \}\)/);
  assert.doesNotMatch(body, /getShadowAccountPositions\(\{ liveQuotes: false \}\)/);
});

test("shadow account stream snapshot cache spans multiple poll ticks", () => {
  const ttl = source.match(/const SHADOW_ACCOUNT_SNAPSHOT_TTL_MS = ([0-9_]+);/);
  const interval = source.match(
    /export const SHADOW_ACCOUNT_STREAM_INTERVAL_MS = ([0-9_]+);/,
  );
  assert.ok(ttl, "Missing shadow snapshot TTL");
  assert.ok(interval, "Missing shadow stream interval");

  const ttlMs = Number(ttl[1]?.replaceAll("_", ""));
  const intervalMs = Number(interval[1]?.replaceAll("_", ""));
  assert.ok(ttlMs >= intervalMs * 4);
});

test("shadow account stream skips full signature work for reused cached snapshots", () => {
  const start = source.indexOf("function createPollingStream");
  assert.notEqual(start, -1, "Missing createPollingStream");
  const end = source.indexOf("\nexport async function", start + 1);
  const body = source.slice(start, end === -1 ? undefined : end);

  assert.match(body, /let lastSnapshot: T \| null = null/);
  assert.match(body, /snapshot !== lastSnapshot/);
  assert.match(body, /lastSnapshot = snapshot/);
});
