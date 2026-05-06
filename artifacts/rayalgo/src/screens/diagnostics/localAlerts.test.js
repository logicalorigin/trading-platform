import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  LOCAL_ALERT_STORAGE_KEY,
  applyDiagnosticAlert,
  dismissLocalAlertPreference,
  readLocalAlertPreferences,
  reduceDiagnosticAlerts,
  syncDiagnosticSnapshotAlerts,
  writeLocalAlertPreferences,
} from "./localAlerts.js";

const readSource = (path) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

const warningEvent = {
  id: "event-1",
  incidentKey: "orders:visibility:read_probe_failed",
  subsystem: "orders",
  category: "visibility",
  code: "read_probe_failed",
  severity: "warning",
  message: "Orders probe failed",
  firstSeenAt: "2026-04-28T12:00:00.000Z",
  lastSeenAt: "2026-04-28T12:00:00.000Z",
  eventCount: 1,
};

test("repeated incident samples update one grouped alert without repeating audio", () => {
  const first = applyDiagnosticAlert({}, warningEvent, {
    nowMs: Date.parse("2026-04-28T12:00:00.000Z"),
  });
  assert.equal(first.shouldNotify, true);

  const second = applyDiagnosticAlert(first.alerts, {
    ...warningEvent,
    id: "event-2",
    lastSeenAt: "2026-04-28T12:00:15.000Z",
    eventCount: 2,
  }, {
    nowMs: Date.parse("2026-04-28T12:00:15.000Z"),
  });

  assert.equal(second.shouldNotify, false);
  assert.deepEqual(Object.keys(second.alerts), ["event:orders:visibility:read_probe_failed"]);
  assert.equal(second.alert.repeatCount, 2);
  assert.equal(second.alert.lastSeenAt, "2026-04-28T12:00:15.000Z");
});

test("snapshot sync seeds alerts without notification", () => {
  const result = reduceDiagnosticAlerts({}, [warningEvent], {
    source: "snapshot",
    notify: false,
    nowMs: Date.parse("2026-04-28T12:00:00.000Z"),
  });

  assert.equal(result.notifications.length, 0);
  assert.equal(Object.keys(result.alerts).length, 1);
  assert.equal(result.alerts["event:orders:visibility:read_probe_failed"].lastNotifiedAt, null);
});

test("snapshot sync removes resolved alerts from the active alert list", () => {
  const first = applyDiagnosticAlert({}, {
    ...warningEvent,
    severity: "critical",
    message: "Quote stream ended",
    incidentKey: "market-data:stream:bridge_quote_stream_error",
    subsystem: "market-data",
    category: "stream",
    code: "bridge_quote_stream_error",
  }, {
    nowMs: Date.parse("2026-04-28T12:00:00.000Z"),
  });

  const synced = syncDiagnosticSnapshotAlerts(first.alerts, [warningEvent], {
    nowMs: Date.parse("2026-04-28T12:00:15.000Z"),
  });

  assert.deepEqual(Object.keys(synced.alerts), ["event:orders:visibility:read_probe_failed"]);
  assert.equal(synced.notifications.length, 0);
});

test("severity escalation triggers notification before cooldown", () => {
  const first = applyDiagnosticAlert({}, warningEvent, {
    nowMs: Date.parse("2026-04-28T12:00:00.000Z"),
  });
  const escalation = applyDiagnosticAlert(first.alerts, {
    ...warningEvent,
    severity: "critical",
    message: "Orders probe is down",
    lastSeenAt: "2026-04-28T12:01:00.000Z",
  }, {
    nowMs: Date.parse("2026-04-28T12:01:00.000Z"),
  });

  assert.equal(escalation.shouldNotify, true);
  assert.equal(escalation.alert.severity, "critical");
});

test("threshold audible false displays without notification", () => {
  const result = applyDiagnosticAlert({}, {
    threshold: {
      metricKey: "api.heap_used_mb",
      label: "API heap used",
      subsystem: "api",
      unit: "mb",
      audible: false,
    },
    value: 920,
    severity: "critical",
    observedAt: "2026-04-28T12:00:00.000Z",
  }, {
    source: "threshold",
    nowMs: Date.parse("2026-04-28T12:00:00.000Z"),
  });

  assert.equal(result.shouldNotify, false);
  assert.equal(Object.keys(result.alerts)[0], "threshold:api.heap_used_mb");
  assert.equal(result.alert.audible, false);
});

test("threshold breach and persisted threshold event share one alert key", () => {
  const breach = applyDiagnosticAlert({}, {
    threshold: {
      metricKey: "orders.visibility_failures",
      label: "Order/account visibility failures",
      subsystem: "orders",
      unit: "count",
      audible: true,
    },
    value: 1,
    severity: "critical",
    observedAt: "2026-04-28T12:00:00.000Z",
  }, {
    source: "threshold",
    nowMs: Date.parse("2026-04-28T12:00:00.000Z"),
  });

  const event = applyDiagnosticAlert(breach.alerts, {
    id: "event-threshold-1",
    incidentKey: "orders:threshold:orders.visibility_failures",
    subsystem: "orders",
    category: "threshold",
    code: "orders.visibility_failures",
    severity: "critical",
    message: "Order/account visibility failures 1count breached critical threshold",
    firstSeenAt: "2026-04-28T12:00:00.000Z",
    lastSeenAt: "2026-04-28T12:00:01.000Z",
    eventCount: 1,
    raw: {
      threshold: {
        metricKey: "orders.visibility_failures",
        audible: true,
      },
    },
  }, {
    nowMs: Date.parse("2026-04-28T12:00:01.000Z"),
  });

  assert.equal(breach.shouldNotify, true);
  assert.equal(event.shouldNotify, false);
  assert.deepEqual(Object.keys(event.alerts), ["threshold:orders.visibility_failures"]);
});

test("dismissed alert suppresses repeats until severity escalates", () => {
  const first = applyDiagnosticAlert({}, warningEvent, {
    nowMs: Date.parse("2026-04-28T12:00:00.000Z"),
  });
  const preferences = dismissLocalAlertPreference(
    { audioEnabled: true, audioMutedUntil: 0, dismissedAlerts: {} },
    first.alert,
    { nowMs: Date.parse("2026-04-28T12:00:10.000Z") },
  );

  const repeat = applyDiagnosticAlert(first.alerts, {
    ...warningEvent,
    lastSeenAt: "2026-04-28T12:20:00.000Z",
  }, {
    nowMs: Date.parse("2026-04-28T12:20:00.000Z"),
    dismissedAlerts: preferences.dismissedAlerts,
  });
  assert.equal(repeat.shouldNotify, false);

  const escalation = applyDiagnosticAlert(first.alerts, {
    ...warningEvent,
    severity: "critical",
    lastSeenAt: "2026-04-28T12:21:00.000Z",
  }, {
    nowMs: Date.parse("2026-04-28T12:21:00.000Z"),
    dismissedAlerts: preferences.dismissedAlerts,
  });
  assert.equal(escalation.shouldNotify, true);
});

test("alert preferences persist with expired records pruned", () => {
  const storage = new Map();
  const fakeStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  writeLocalAlertPreferences({
    audioEnabled: false,
    audioMutedUntil: Date.now() + 60_000,
    dismissedAlerts: {
      active: { severity: "warning", until: Date.now() + 60_000 },
      expired: { severity: "warning", until: Date.now() - 1 },
    },
  }, fakeStorage);

  const persisted = JSON.parse(storage.get(LOCAL_ALERT_STORAGE_KEY));
  assert.deepEqual(Object.keys(persisted.dismissedAlerts), ["active"]);
  assert.equal(readLocalAlertPreferences(fakeStorage).audioEnabled, false);
});

test("diagnostics surfaces use generated clients for generated REST endpoints", () => {
  const diagnosticsScreen = readSource("../DiagnosticsScreen.jsx");
  const thresholdsPanel = readSource(
    "../settings/DiagnosticThresholdSettingsPanel.jsx",
  );
  const runtimeControl = readSource(
    "../../features/platform/useRuntimeControlSnapshot.js",
  );
  const memoryPressure = readSource(
    "../../features/platform/useMemoryPressureSignal.js",
  );

  assert.match(diagnosticsScreen, /listDiagnosticHistory/);
  assert.match(diagnosticsScreen, /listDiagnosticEvents/);
  assert.match(diagnosticsScreen, /getLatestDiagnostics/);
  assert.match(diagnosticsScreen, /getDiagnosticEventDetail/);
  assert.match(diagnosticsScreen, /recordClientDiagnosticEvent/);
  assert.doesNotMatch(diagnosticsScreen, /fetch\(`\/api\/diagnostics\/history/);
  assert.doesNotMatch(diagnosticsScreen, /fetch\(`\/api\/diagnostics\/events/);
  assert.doesNotMatch(diagnosticsScreen, /fetch\("\/api\/diagnostics\/latest"/);
  assert.doesNotMatch(diagnosticsScreen, /fetch\("\/api\/diagnostics\/client-events"/);
  assert.match(diagnosticsScreen, /new EventSource\("\/api\/diagnostics\/stream"\)/);
  assert.match(diagnosticsScreen, /fetch\("\/api\/diagnostics\/client-metrics"/);

  assert.match(thresholdsPanel, /useGetDiagnosticThresholds/);
  assert.match(thresholdsPanel, /useUpdateDiagnosticThresholds/);
  assert.doesNotMatch(thresholdsPanel, /fetch\("\/api\/diagnostics\/thresholds"/);

  assert.match(runtimeControl, /getRuntimeDiagnostics/);
  assert.doesNotMatch(runtimeControl, /platformJsonRequest\("\/api\/diagnostics\/runtime"/);

  assert.match(memoryPressure, /getLatestDiagnostics/);
  assert.doesNotMatch(memoryPressure, /platformJsonRequest\("\/api\/diagnostics\/latest"/);
});
