import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMemoryPressureServerSummaryFromDiagnostics,
  buildResponseHeaderPressureSummary,
  clearDiagnosticsMemoryPressureSummary,
  mergeMemoryPressureRuntimeState,
  mergeMemoryPressureServerSummary,
} from "./useMemoryPressureSignal.js";
import { buildMemoryPressureState } from "./memoryPressureModel.js";

test("response-header pressure keeps resource level separate from held effective pressure", () => {
  const observedAt = "2026-06-18T12:00:00.000Z";
  const current = {
    effectivePressureLevel: "high",
    pressureLevel: "high",
    observedAt,
  };

  const summary = buildResponseHeaderPressureSummary(
    {
      pressureLevel: "watch",
      resourceLevel: "watch",
      routeClass: "active-screen",
      observedAt: "2026-06-18T12:00:05.000Z",
    },
    current,
  );

  assert.equal(summary.pressureLevel, "high");
  assert.equal(summary.effectivePressureLevel, "high");
  assert.equal(summary.resourceLevel, "watch");
  assert.equal(summary.routeClass, "active-screen");
});

test("server summary exposes DB resource pressure without turning it into memory pressure", () => {
  const summary = mergeMemoryPressureServerSummary({
    resourceMetrics: {
      apiResourcePressure: {
        resourceLevel: "watch",
      },
      pressureDrivers: [
        {
          kind: "db-pool",
          level: "watch",
        },
      ],
    },
  });

  assert.equal(summary.level, "normal");
  assert.equal(summary.resourceLevel, "watch");
  assert.deepEqual(summary.pressureDrivers, []);
});

test("diagnostics downgrade removes diagnostics-derived pressure but preserves header state", () => {
  const diagnosticState = {
    level: "high",
    score: 80,
    apiHeapUsedPercent: 91,
    activeWorkloadCount: 0,
    pollCount: 0,
    streamCount: 0,
    chartScopeCount: 0,
    prependScopeCount: 0,
    queryCount: 0,
    heavyQueryCount: 0,
    storeEntryCount: 0,
    measurement: { memory: null },
    server: { origin: "diagnostics", apiHeapUsedPercent: 91 },
  };

  const cleared = clearDiagnosticsMemoryPressureSummary(diagnosticState);
  assert.equal(cleared.server, null);
  assert.equal(cleared.apiHeapUsedPercent, null);
  assert.equal(cleared.level, "normal");

  const headerState = {
    ...diagnosticState,
    server: { origin: "response-header", pressureLevel: "watch" },
  };
  assert.equal(clearDiagnosticsMemoryPressureSummary(headerState), headerState);

  const mixedState = { ...headerState, diagnosticsMerged: true };
  const mixedCleared = clearDiagnosticsMemoryPressureSummary(mixedState);
  assert.equal(mixedCleared.server, mixedState.server);
  assert.equal(mixedCleared.apiHeapUsedPercent, null);
  assert.equal(mixedCleared.diagnosticsMerged, false);
});

test("fallback diagnostics provenance survives a header update until disable cleanup", () => {
  const fallbackSummary = buildMemoryPressureServerSummaryFromDiagnostics({
    footerMemoryPressure: {
      level: "high",
      apiHeapUsedPercent: 91,
      pressureDrivers: [{ kind: "api-heap", level: "high" }],
    },
  });
  assert.equal(fallbackSummary.origin, "diagnostics");

  const clientState = buildMemoryPressureState({
    browserMemoryMb: null,
    browserMemoryLimitMb: null,
    apiHeapUsedPercent: fallbackSummary.apiHeapUsedPercent,
  });
  const diagnosticsState = {
    ...mergeMemoryPressureRuntimeState(clientState, fallbackSummary),
    measurement: { memory: null },
    server: fallbackSummary,
    diagnosticsMerged: fallbackSummary.origin === "diagnostics",
  };
  const headerSummary = buildResponseHeaderPressureSummary({
    pressureLevel: "watch",
    resourceLevel: "watch",
    observedAt: "2026-06-18T12:01:00.000Z",
  });
  const cleared = clearDiagnosticsMemoryPressureSummary({
    ...diagnosticsState,
    server: headerSummary,
  });

  assert.equal(cleared.server, headerSummary);
  assert.equal(cleared.apiHeapUsedPercent, null);
  assert.equal(cleared.diagnosticsMerged, false);
});

test("nullable memory telemetry stays unavailable while numeric zero stays real", () => {
  const missing = buildMemoryPressureState({
    browserMemoryMb: null,
    browserMemoryLimitMb: null,
    apiHeapUsedPercent: null,
  });
  assert.equal(missing.browserMemoryMb, null);
  assert.equal(missing.browserMemoryLimitMb, null);
  assert.equal(missing.apiHeapUsedPercent, null);

  const zero = buildMemoryPressureState({
    browserMemoryMb: 0,
    browserMemoryLimitMb: 0,
    apiHeapUsedPercent: 0,
  });
  assert.equal(zero.browserMemoryMb, 0);
  assert.equal(zero.browserMemoryLimitMb, 0);
  assert.equal(zero.apiHeapUsedPercent, 0);

  const cleared = clearDiagnosticsMemoryPressureSummary({
    ...missing,
    measurement: {
      memory: {
        bytes: null,
        usedJsHeapSize: null,
        jsHeapSizeLimit: null,
      },
    },
    server: { origin: "diagnostics", apiHeapUsedPercent: 80 },
    diagnosticsMerged: true,
  });
  assert.equal(cleared.browserMemoryMb, null);
  assert.equal(cleared.browserMemoryLimitMb, null);
});
