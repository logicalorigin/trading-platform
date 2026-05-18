import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSignalMonitorStatusSnapshot,
  isSignalMonitorDegradedProfile,
  isSignalMonitorRuntimeFallbackProfile,
  resolveSignalMonitorLastEvaluatedAt,
  resolveSignalMonitorStatus,
  summarizeSignalMonitorStates,
} from "./signalMonitorStatusModel";

test("signal monitor status treats DB fallback profiles as degraded", () => {
  const profile = {
    id: "db-unavailable-live",
    enabled: false,
    lastError: "Postgres is unavailable; signal monitor data is temporarily degraded.",
  };

  assert.equal(isSignalMonitorDegradedProfile(profile), true);
  assert.deepEqual(resolveSignalMonitorStatus({ profile }), {
    degraded: true,
    enabled: false,
    errored: true,
    label: "SCAN ERROR",
  });
});

test("signal monitor status labels runtime fallback profiles as degraded runtime", () => {
  const profile = {
    id: "runtime-fallback-live",
    enabled: true,
    lastError: "Postgres is unavailable; using runtime-only signal monitor evaluation.",
  };

  assert.equal(isSignalMonitorRuntimeFallbackProfile(profile), true);
  assert.equal(isSignalMonitorDegradedProfile(profile), true);
  assert.deepEqual(resolveSignalMonitorStatus({ profile }), {
    degraded: true,
    enabled: false,
    errored: false,
    label: "RUNTIME",
  });
});

test("signal monitor status distinguishes normal disabled profiles", () => {
  const profile = {
    id: "profile-1",
    enabled: false,
    lastError: null,
  };

  assert.equal(isSignalMonitorDegradedProfile(profile), false);
  assert.deepEqual(resolveSignalMonitorStatus({ profile }), {
    degraded: false,
    enabled: false,
    errored: false,
    label: "SCAN OFF",
  });
});

test("signal monitor status keeps pending scans distinct from degraded errors", () => {
  const profile = {
    id: "profile-1",
    enabled: true,
    lastError: null,
  };

  assert.deepEqual(resolveSignalMonitorStatus({ profile, pending: true }), {
    degraded: false,
    enabled: true,
    errored: false,
    label: "SCANNING",
  });
});

test("signal monitor state summary separates fresh, stale, and errored states", () => {
  assert.deepEqual(
    summarizeSignalMonitorStates([
      { status: "ok", fresh: true },
      { status: "ok", fresh: false },
      { status: "stale", fresh: true },
      { status: "error", lastError: "boom" },
      { status: "unavailable" },
    ]),
    {
      total: 5,
      fresh: 1,
      ok: 2,
      stale: 1,
      unavailable: 1,
      errored: 1,
      problem: 3,
      allProblem: false,
    },
  );
});

test("signal monitor status snapshot separates configured max from tracked states", () => {
  const snapshot = buildSignalMonitorStatusSnapshot({
    profile: {
      maxSymbols: 250,
      lastEvaluatedAt: "2026-05-18T18:55:00.000Z",
    },
    states: [
      { status: "ok", fresh: true, lastEvaluatedAt: "2026-05-18T18:56:00.000Z" },
      { status: "ok", fresh: false },
    ],
    universe: {
      mode: "all_watchlists_plus_universe",
      configuredMaxSymbols: 250,
      resolvedSymbols: 250,
      pinnedSymbols: 90,
      expansionSymbols: 160,
      shortfall: 0,
      source: "watchlists_plus_ranked_universe",
      fallbackUsed: false,
      degradedReason: null,
      rankedAt: "2026-05-18T18:45:00.000Z",
    },
  });

  assert.equal(snapshot.configuredMaxSymbols, 250);
  assert.equal(snapshot.stateSummary.total, 2);
  assert.equal(snapshot.resolvedSymbols, 250);
  assert.equal(snapshot.pinnedSymbols, 90);
  assert.equal(snapshot.expansionSymbols, 160);
  assert.equal(snapshot.lastEvaluatedAt, "2026-05-18T18:56:00.000Z");
});

test("signal monitor last evaluated ignores stale profile timestamps", () => {
  assert.equal(
    resolveSignalMonitorLastEvaluatedAt({
      profile: { lastEvaluatedAt: "2026-05-18T18:50:00.000Z" },
      states: [
        { lastEvaluatedAt: "2026-05-18T18:49:00.000Z" },
        { lastEvaluatedAt: "2026-05-18T18:53:00.000Z" },
      ],
    }),
    "2026-05-18T18:53:00.000Z",
  );
});
