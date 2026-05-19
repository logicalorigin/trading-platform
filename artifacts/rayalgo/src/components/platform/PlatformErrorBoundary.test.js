import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./PlatformErrorBoundary.tsx", import.meta.url),
  "utf8",
);

test("PlatformErrorBoundary fallback exposes crash diagnostic actions", () => {
  assert.match(source, /buildRootCrashDiagnosticBundle/);
  assert.match(source, /redactCrashDiagnosticValue/);
  assert.match(source, /openDiagnosticsScreen/);
  assert.match(source, /Copy bundle/);
  assert.match(source, /Open Diagnostics/);
  assert.match(source, /componentStack=\{lastErrorInfoRef\.current\?\.componentStack \?\? null\}/);
});
