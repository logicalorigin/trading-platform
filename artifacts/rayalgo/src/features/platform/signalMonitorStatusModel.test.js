import assert from "node:assert/strict";
import test from "node:test";
import {
  isSignalMonitorDegradedProfile,
  isSignalMonitorRuntimeFallbackProfile,
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
