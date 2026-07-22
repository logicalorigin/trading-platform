import assert from "node:assert/strict";
import test from "node:test";

import { syncDiagnosticSnapshotAlerts } from "./localAlerts.js";

test("snapshot alert reconciliation accepts one event without treating it as an array", () => {
  const result = syncDiagnosticSnapshotAlerts(
    {},
    {
      incidentKey: "api:latency",
      subsystem: "api",
      category: "latency",
      severity: "warning",
      status: "open",
      message: "API latency elevated",
      firstSeenAt: "2026-07-22T18:00:00.000Z",
      lastSeenAt: "2026-07-22T18:00:00.000Z",
      eventCount: 1,
    },
    { nowMs: Date.parse("2026-07-22T18:00:00.000Z") },
  );

  assert.deepEqual(Object.keys(result.alerts), ["event:api:latency"]);
  assert.deepEqual(result.notifications, []);
});
