import assert from "node:assert/strict";
import test from "node:test";

import { __diagnosticsInternalsForTests } from "./diagnostics";

const { shouldPersistDiagnosticEventToDb, shouldRunDiagnosticsRetentionCleanup } =
  __diagnosticsInternalsForTests;

const TOUCH_MS = 5 * 60 * 1000;
const sig = (over: Partial<{
  status: "open" | "resolved";
  severity: "info" | "warning";
  message: string;
  lastSeenAtMs: number;
}> = {}) => ({
  status: "open" as const,
  severity: "warning" as const,
  message: "unchanged incident",
  lastSeenAtMs: 1_000_000,
  ...over,
});

test("diagnostic-event upsert persists the first time an incident is seen", () => {
  assert.equal(
    shouldPersistDiagnosticEventToDb(undefined, sig(), TOUCH_MS),
    true,
  );
});

test("diagnostic-event upsert is skipped when nothing changed within the touch window", () => {
  const last = sig({ lastSeenAtMs: 1_000_000 });
  // Same status/severity/message, 4m59s later — still inside the 5m touch window.
  const next = sig({ lastSeenAtMs: 1_000_000 + TOUCH_MS - 1_000 });
  assert.equal(shouldPersistDiagnosticEventToDb(last, next, TOUCH_MS), false);
});

test("diagnostic-event upsert does a coarse touch once past the 5m window", () => {
  const last = sig({ lastSeenAtMs: 1_000_000 });
  const next = sig({ lastSeenAtMs: 1_000_000 + TOUCH_MS });
  assert.equal(shouldPersistDiagnosticEventToDb(last, next, TOUCH_MS), true);
});

test("diagnostic-event upsert always persists a material change (severity/message/status)", () => {
  const last = sig();
  assert.equal(
    shouldPersistDiagnosticEventToDb(last, sig({ severity: "info" }), TOUCH_MS),
    true,
  );
  assert.equal(
    shouldPersistDiagnosticEventToDb(last, sig({ message: "now different" }), TOUCH_MS),
    true,
  );
  assert.equal(
    shouldPersistDiagnosticEventToDb(last, sig({ status: "resolved" }), TOUCH_MS),
    true,
  );
});

test("retention cleanup runs on first tick then only every 6h, not every 15s", () => {
  const sixHours = 6 * 60 * 60 * 1000;
  const base = 1_700_000_000_000; // realistic epoch ms (>> 6h so first tick runs)
  // First tick: lastRun 0 -> runs.
  assert.equal(shouldRunDiagnosticsRetentionCleanup(base, 0, sixHours), true);
  // 15s later: skipped.
  assert.equal(
    shouldRunDiagnosticsRetentionCleanup(base + 15_000, base, sixHours),
    false,
  );
  // Just under 6h: still skipped.
  assert.equal(
    shouldRunDiagnosticsRetentionCleanup(base + sixHours - 1, base, sixHours),
    false,
  );
  // At 6h: runs again.
  assert.equal(
    shouldRunDiagnosticsRetentionCleanup(base + sixHours, base, sixHours),
    true,
  );
});
