import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

const screenSource = read("../DiagnosticsScreen.jsx");
const briefSource = read("./DiagnosticsRecoveryBrief.jsx");

test("overview scans recovery, alerts, metrics, and detailed topology in that order", () => {
  const recoveryIndex = screenSource.indexOf("<DiagnosticsRecoveryBrief");
  const alertsIndex = screenSource.indexOf("{activeAlertsPanel}", recoveryIndex);
  const metricsIndex = screenSource.indexOf('<MetricCard label="API p95"', recoveryIndex);
  const topologyIndex = screenSource.indexOf("<MachineStateDiagram", recoveryIndex);

  assert.ok(recoveryIndex >= 0, "missing recovery brief");
  assert.ok(alertsIndex > recoveryIndex, "alerts must follow the recovery brief");
  assert.ok(metricsIndex > alertsIndex, "metric evidence must follow active alerts");
  assert.ok(topologyIndex > metricsIndex, "detailed topology must not dominate recovery");
});

test("legacy empty degraded banner no longer competes with the recovery brief", () => {
  assert.doesNotMatch(
    screenSource,
    /latest\?\.status === "degraded" \|\| latest\?\.status === "down"/,
  );
  assert.match(
    screenSource,
    /latest\?\.status === "down"\s*\?\s*CSS_COLOR\.red\s*:\s*severityTone\(topSeverity\)/,
  );
});

test("phone status stays separate from one non-wrapping time-window rail", () => {
  assert.match(screenSource, /data-testid="diagnostics-status-row"/);
  assert.match(screenSource, /data-testid="diagnostics-window-controls"/);
  assert.match(
    screenSource,
    /data-testid="diagnostics-window-controls"[\s\S]*?flexWrap: "nowrap"[\s\S]*?overflowX: diagnosticsIsPhone \? "auto"/,
  );
});

test("recovery brief exposes the four-step hierarchy and a native panel action", () => {
  const labels = [
    "Current failure",
    "Impact",
    "Evidence",
    "Next safe action",
  ];
  let previousIndex = -1;
  for (const label of labels) {
    const index = briefSource.indexOf(`label: "${label}"`);
    assert.ok(index > previousIndex, `${label} must keep recovery scan order`);
    previousIndex = index;
  }

  assert.match(briefSource, /data-testid="diagnostics-recovery-brief"/);
  assert.match(briefSource, /data-testid=\{`diagnostics-recovery-\$\{block\.id\}`\}/);
  assert.match(briefSource, /onClick=\{\(\) => onOpenTab\(model\.targetTab\)\}/);
  assert.match(briefSource, /Review \{model\.targetTab\}/);
});
