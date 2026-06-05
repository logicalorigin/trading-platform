import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const diagnosticsSource = () =>
  readFileSync(new URL("./DiagnosticsScreen.jsx", import.meta.url), "utf8");

test("diagnostics overview memory card uses memory signal instead of broad resource pressure", () => {
  const source = diagnosticsSource();

  assert.match(source, /const memoryOverviewSeverity\s*=/);
  assert.match(
    source,
    /<MetricCard label="Memory" value=\{String\(footerSignal\.level \|\| "normal"\)\.toUpperCase\(\)\}/,
  );
  assert.doesNotMatch(
    source,
    /<MetricCard label="Memory" value=\{String\(resourcePressureMetrics\.pressureLevel/,
  );
  assert.doesNotMatch(
    source,
    /footerMemoryMetrics\?\.level \|\|\s*resourcePressureMetrics\.clientPressureLevel \|\|\s*resourcePressureMetrics\.pressureLevel/,
  );
});

test("diagnostics failure points are wired to overview cards and event rows", () => {
  const source = diagnosticsSource();

  assert.match(source, /FailurePointTooltip/);
  assert.match(source, /FailurePointInlineIcon/);
  assert.match(source, /buildFailurePointFromDiagnosticsSnapshot/);
  assert.match(source, /buildFailurePointFromDiagnosticEvent/);
  assert.match(source, /buildMemoryPressureFailurePoint/);
  assert.match(source, /failurePoint=\{buildFailurePointFromDiagnosticsSnapshot\(apiSnapshot\)\}/);
  assert.match(source, /failurePoint=\{buildMemoryPressureFailurePoint\(\{ signal: footerSignal \}\)\}/);
  assert.match(source, /const failurePoint = buildFailurePointFromDiagnosticEvent\(event\)/);
  assert.match(source, /const failurePoint = buildFailurePointFromDiagnosticEvent\(alert\)/);
});

test("diagnostics work planner surfaces inactive persisted worker state", () => {
  const source = diagnosticsSource();

  assert.match(source, /persistClaimableQueuedJobCount/);
  assert.match(source, /persistWorkerInactive/);
  assert.match(source, /label="Persist worker"/);
  assert.match(source, /ready · inactive/);
});
