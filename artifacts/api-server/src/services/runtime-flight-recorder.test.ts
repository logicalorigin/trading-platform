import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  appendRuntimeFlightRecorderEvent,
  getRuntimeFlightRecorderDiagnostics,
  importRuntimeFlightRecorderIncidents,
  writeRuntimeFlightRecorderHeartbeat,
} from "./runtime-flight-recorder";
import {
  __resetRequestMetricsForTests,
  recordApiRequest,
} from "./request-metrics";
import {
  __resetApiResourcePressureForTests,
  resolveApiRssPressureThresholds,
  updateApiResourcePressure,
} from "./resource-pressure";
import type { DiagnosticEventPayload } from "./diagnostics";

function useFreshRecorderDir(): string {
  const dir = path.join(
    mkdtempSync(path.join(tmpdir(), "pyrus-api-flight-recorder-")),
    "flight-recorder",
  );
  process.env["PYRUS_FLIGHT_RECORDER_DIR"] = dir;
  mkdirSync(dir, { recursive: true });
  return dir;
}

function diagnosticEvent(input: {
  subsystem: "runtime";
  category: string;
  severity: "info" | "warning" | "critical";
  message: string;
  code?: string | null;
  dimensions?: Record<string, unknown>;
  raw?: Record<string, unknown>;
}): DiagnosticEventPayload {
  const now = new Date().toISOString();
  return {
    id: "diagnostic-event-id",
    incidentKey: `${input.subsystem}:${input.category}:${input.code ?? "unknown"}`,
    subsystem: input.subsystem,
    category: input.category,
    code: input.code ?? null,
    severity: input.severity,
    status: "open",
    message: input.message,
    firstSeenAt: now,
    lastSeenAt: now,
    eventCount: 1,
    dimensions: input.dimensions ?? {},
    raw: input.raw ?? {},
  };
}

test.afterEach(() => {
  delete process.env["PYRUS_FLIGHT_RECORDER_DIR"];
  delete process.env["PYRUS_RUNTIME_PROCESS_SCAN_DIR"];
  delete process.env["PYRUS_RUNTIME_TEST_PROCESS_MIN_AGE_MS"];
  delete process.env["PYRUS_RUNTIME_TEST_PROCESS_SCAN"];
  __resetRequestMetricsForTests();
  __resetApiResourcePressureForTests();
});

test("imports persisted restart incidents into diagnostics once", async () => {
  const dir = useFreshRecorderDir();
  writeFileSync(
    path.join(dir, "incidents.jsonl"),
    `${JSON.stringify({
      incidentId: "incident-1",
      observedAt: "2026-05-28T15:10:00.000Z",
      classification: "api-child-exit",
      confidence: "high",
      severity: "critical",
      message: "Previous Replit/PYRUS run classified as api child exit.",
      evidence: ["api-exit:code=1 signal=null"],
    })}\n`,
  );

  const recorded: Array<Parameters<typeof diagnosticEvent>[0]> = [];
  const first = await importRuntimeFlightRecorderIncidents(async (input) => {
    recorded.push(input);
    return diagnosticEvent(input);
  });
  const second = await importRuntimeFlightRecorderIncidents(async (input) => {
    recorded.push(input);
    return diagnosticEvent(input);
  });

  assert.deepEqual(first, { imported: 1, skipped: 0 });
  assert.deepEqual(second, { imported: 0, skipped: 1 });
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].subsystem, "runtime");
  assert.equal(recorded[0].category, "replit-restart");
  assert.equal(recorded[0].code, "api-child-exit");
  assert.equal(recorded[0].severity, "critical");
  assert.equal(recorded[0].dimensions?.incidentId, "incident-1");
  assert.equal(existsSync(path.join(dir, "diagnostics-imported.json")), true);
});

test("writes API heartbeat and exposes recorder diagnostics", () => {
  const dir = useFreshRecorderDir();
  const criticalRssMb = resolveApiRssPressureThresholds().critical + 1;
  recordApiRequest({
    method: "GET",
    path: "/api/healthz",
    statusCode: 200,
    durationMs: 42,
  });
  updateApiResourcePressure({ rssMb: criticalRssMb });
  appendRuntimeFlightRecorderEvent("api-test-event", { detail: "present" });

  const heartbeat = writeRuntimeFlightRecorderHeartbeat();
  const current = JSON.parse(
    readFileSync(path.join(dir, "api-current.json"), "utf8"),
  );
  const diagnostics = getRuntimeFlightRecorderDiagnostics();
  const eventLog = readFileSync(
    path.join(dir, `api-events-${new Date().toISOString().slice(0, 10)}.jsonl`),
    "utf8",
  );

  assert.ok(heartbeat);
  assert.equal(current.pid, process.pid);
  assert.equal(current.apiPressure.level, "critical");
  assert.equal(current.requests.sampleCount, 1);
  assert.equal(current.requests.p95Ms, 42);
  assert.equal(diagnostics.metrics.apiPressureLevel, "critical");
  assert.equal(diagnostics.metrics.apiRequestP95Ms, 42);
  assert.match(eventLog, /api-test-event/);
});

test("reports long-running workspace test processes in recorder diagnostics", () => {
  useFreshRecorderDir();
  const procRoot = mkdtempSync(path.join(tmpdir(), "pyrus-proc-scan-"));
  const pidDir = path.join(procRoot, "4242");
  mkdirSync(pidDir, { recursive: true });
  writeFileSync(
    path.join(pidDir, "cmdline"),
    [
      process.execPath,
      "--import",
      "tsx",
      "--test",
      "/home/runner/workspace/artifacts/api-server/src/services/options-flow-scanner.test.ts",
    ].join("\0"),
  );
  symlinkSync("/home/runner/workspace", path.join(pidDir, "cwd"));
  const oldTime = new Date(Date.now() - 60_000);
  utimesSync(pidDir, oldTime, oldTime);
  process.env["PYRUS_RUNTIME_PROCESS_SCAN_DIR"] = procRoot;
  process.env["PYRUS_RUNTIME_TEST_PROCESS_MIN_AGE_MS"] = "1000";

  const diagnostics = getRuntimeFlightRecorderDiagnostics();

  assert.equal(diagnostics.metrics.workspaceTestProcessScanEnabled, true);
  assert.equal(diagnostics.metrics.workspaceTestProcessCount, 1);
  assert.equal(diagnostics.metrics.workspaceLongRunningTestProcessCount, 1);
  assert.match(
    JSON.stringify(diagnostics.raw.workspaceTestProcesses),
    /options-flow-scanner\.test\.ts/,
  );
});
