import assert from "node:assert/strict";
import test from "node:test";
import {
  isSignalMonitorDegradedProfile,
  resolveSignalMonitorStatus,
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
