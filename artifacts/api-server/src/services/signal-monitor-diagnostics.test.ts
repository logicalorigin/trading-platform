import assert from "node:assert/strict";
import test from "node:test";

import {
  getSignalMonitorDbFallbackDiagnostics,
  recordSignalMonitorDbFallback,
  resetSignalMonitorDbFallbackDiagnosticsForTests,
} from "./signal-monitor-diagnostics";

test("signal monitor DB fallback diagnostics classify pool contention", () => {
  resetSignalMonitorDbFallbackDiagnosticsForTests();

  const diagnostic = recordSignalMonitorDbFallback(
    new Error("pool timed out while waiting for an open connection"),
    {
      operation: "list_signal_monitor_events",
      environment: "shadow",
      sourceStatus: "runtime-fallback",
      observedAt: new Date("2026-06-12T18:30:00.000Z"),
    },
  );

  assert.equal(diagnostic.observedAt, "2026-06-12T18:30:00.000Z");
  assert.equal(diagnostic.operation, "list_signal_monitor_events");
  assert.equal(diagnostic.environment, "shadow");
  assert.equal(diagnostic.sourceStatus, "runtime-fallback");
  assert.equal(diagnostic.transient, true);
  assert.equal(diagnostic.poolContention, true);
  assert.match(diagnostic.dbError.message, /pool timed out/i);
  assert.deepEqual(getSignalMonitorDbFallbackDiagnostics(), diagnostic);
});

test("signal monitor DB fallback diagnostics distinguish connectivity from pool contention", () => {
  resetSignalMonitorDbFallbackDiagnosticsForTests();

  const diagnostic = recordSignalMonitorDbFallback(
    Object.assign(new Error("connect ECONNREFUSED"), {
      code: "ECONNREFUSED",
    }),
    {
      operation: "read_signal_monitor_state",
      environment: "shadow",
    },
  );

  assert.equal(diagnostic.transient, true);
  assert.equal(diagnostic.poolContention, false);
  assert.equal(diagnostic.dbError.code, "ECONNREFUSED");
});

test("signal monitor DB fallback diagnostics report statement timeouts as retryable without SQL payloads", () => {
  resetSignalMonitorDbFallbackDiagnosticsForTests();

  const cause = Object.assign(
    new Error("canceling statement due to statement timeout"),
    { code: "57014" },
  );
  const diagnostic = recordSignalMonitorDbFallback(
    new Error(
      "Failed query: select event_key from signal_monitor_events where event_key in ($1, $2)\nparams: private-event-key",
      { cause },
    ),
    {
      operation: "persist_signal_monitor_matrix_states",
      environment: "shadow",
    },
  );

  assert.equal(diagnostic.transient, true);
  assert.equal(diagnostic.poolContention, false);
  assert.equal(diagnostic.dbError.message, "Database query failed");
  assert.doesNotMatch(JSON.stringify(diagnostic), /private-event-key/);
  assert.equal(diagnostic.dbError.cause?.code, "57014");
});
