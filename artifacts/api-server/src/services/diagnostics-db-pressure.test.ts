import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const diagnosticsSource = readFileSync(
  new URL("./diagnostics.ts", import.meta.url),
  "utf8",
);
const platformSource = readFileSync(
  new URL("./platform.ts", import.meta.url),
  "utf8",
);
const flightRecorderSource = readFileSync(
  new URL("./runtime-flight-recorder.ts", import.meta.url),
  "utf8",
);

function sourceBlock(start: string, end: string): string {
  const startIndex = diagnosticsSource.indexOf(start);
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`);
  const endIndex = diagnosticsSource.indexOf(end, startIndex);
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`);
  return diagnosticsSource.slice(startIndex, endIndex);
}

test("diagnostics resource pressure surfaces DB pool waiters", () => {
  assert.match(diagnosticsSource, /getPoolStats\(\)/);
  assert.match(diagnosticsSource, /"db-pool"/);
  assert.match(diagnosticsSource, /metricKey:\s*"resource_pressure\.db_pool_waiting"/);
  assert.match(diagnosticsSource, /dbPoolWaiting:\s*dbPool\.waiting/);
  assert.match(diagnosticsSource, /dbPoolTotalWaiting:\s*dbPool\.totalWaiting/);
  assert.match(diagnosticsSource, /db_pool_waiting:\s*dbPool\.waiting/);
  assert.match(diagnosticsSource, /db_pool_total_waiting:\s*dbPool\.totalWaiting/);
});

test("runtime diagnostics surfaces active DB pool admission lane gauges", () => {
  const start = platformSource.indexOf(
    "export async function getRuntimeDiagnostics()",
  );
  const end = platformSource.indexOf(
    "export async function getRuntimeDiagnosticsCompact()",
    start,
  );
  assert.notEqual(start, -1, "missing runtime diagnostics builder");
  assert.notEqual(end, -1, "missing compact diagnostics boundary");
  const runtimeDiagnosticsSource = platformSource.slice(start, end);

  assert.match(
    runtimeDiagnosticsSource,
    /Object\.entries\(getDbAdmissionDiagnostics\(\)\)/,
  );
  assert.match(
    runtimeDiagnosticsSource,
    /\.filter\(\(\[, stats\]\) => Object\.values\(stats\)\.some\(\(value\) => value > 0\)\)/,
  );
  assert.match(
    runtimeDiagnosticsSource,
    /lane,\s*queued: stats\.queued,\s*inFlight: stats\.inFlight,\s*admitted: stats\.admittedTotal,\s*maxWaitMs: stats\.maxWaitMs,\s*p95WaitMs: stats\.recentWaitMsP95/,
  );
  assert.match(
    runtimeDiagnosticsSource,
    /dbPoolAdmission:\s*{ lanes: dbPoolAdmissionLanes }/,
  );
});

test("runtime diagnostics includes signal-matrix stream status", () => {
  const start = platformSource.indexOf(
    "export async function getRuntimeDiagnostics()",
  );
  const end = platformSource.indexOf(
    "export async function getRuntimeDiagnosticsCompact()",
    start,
  );
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const runtimeDiagnosticsSource = platformSource.slice(start, end);

  assert.match(
    runtimeDiagnosticsSource,
    /{ getSignalMonitorMatrixStreamStatus }[\s\S]*import\("\.\/signal-monitor"\)/,
  );
  assert.match(
    runtimeDiagnosticsSource,
    /signalMatrix:\s*getSignalMonitorMatrixStreamStatus\(\)/,
  );
});

test("diagnostics collector avoids DB bursts while recording snapshots and events", () => {
  const storageStatsBlock = sourceBlock(
    "async function buildMonitoredStorageTableStats()",
    "async function buildDatabaseStorageStats()",
  );
  assert.match(storageStatsBlock, /for \(const table of MONITORED_STORAGE_TABLES\)/);
  assert.doesNotMatch(storageStatsBlock, /Promise\.all/);

  const eventResolutionBlock = sourceBlock(
    "async function resolveInactiveCollectorEvents",
    "function filterMemorySnapshots",
  );
  assert.match(eventResolutionBlock, /for \(const event of candidatesByKey\.values\(\)\)/);
  assert.doesNotMatch(eventResolutionBlock, /Promise\.all/);

  const collectorBlock = sourceBlock(
    "export async function collectDiagnosticSnapshot",
    "export async function getDiagnosticThresholds",
  );
  assert.match(collectorBlock, /for \(const event of activeEvents\)/);
  assert.match(collectorBlock, /await persistSnapshots\(snapshots\)/);
  assert.doesNotMatch(collectorBlock, /Promise\.all\(\s*snapshots\.map/);
  assert.doesNotMatch(collectorBlock, /Promise\.all\(\s*activeEvents\.map/);
});

test("diagnostics collector skips overlapping ticks", () => {
  const collectorStateIndex = diagnosticsSource.indexOf(
    "let diagnosticsCollectorInFlight = false;",
  );
  assert.notEqual(collectorStateIndex, -1, "missing collector in-flight state");

  const collectorBlock = diagnosticsSource.slice(
    diagnosticsSource.indexOf("export function startDiagnosticsCollector"),
  );
  assert.match(
    collectorBlock,
    /if \(diagnosticsCollectorInFlight\) {\s*return;\s*}/,
  );
  assert.match(
    collectorBlock,
    /diagnosticsCollectorInFlight = true;[\s\S]*\.finally\(\(\) => {\s*diagnosticsCollectorInFlight = false;/,
  );

  const guardIndex = collectorBlock.indexOf("if (diagnosticsCollectorInFlight)");
  const collectIndex = collectorBlock.indexOf(".then(collect)");
  assert.notEqual(guardIndex, -1);
  assert.notEqual(collectIndex, -1);
  assert.ok(guardIndex < collectIndex);
});

test("diagnostics heavy reads reuse cached telemetry under DB pool pressure", () => {
  const saturationBlock = sourceBlock(
    "function diagnosticsDbPoolIsSaturated",
    "function compactDiagnosticRawValue",
  );
  assert.match(saturationBlock, /getPoolStats\(\)/);
  assert.match(saturationBlock, /stats\.totalWaiting > 0/);
  assert.match(saturationBlock, /stats\.active >= stats\.max/);

  const automationBlock = sourceBlock(
    "async function readRecentAutomationEvents",
    "async function buildAutomationMetrics",
  );
  assert.match(automationBlock, /automationRecentEventsCache/);
  assert.match(automationBlock, /diagnosticsDbPoolIsSaturated\(\)/);
  assert.match(
    automationBlock,
    /eventType\} LIKE 'signal_options_%'/,
  );

  const storageBlock = sourceBlock(
    "async function buildStorageMetrics",
    "function classifyStorageSnapshot",
  );
  assert.match(storageBlock, /storageMetricsCache/);
  assert.match(storageBlock, /storageMetricsInFlight/);
  assert.match(storageBlock, /diagnosticsDbPoolIsSaturated\(\)/);
  assert.match(storageBlock, /storageStatsCacheStatus: "stale"/);
});

test("runtime flight recorder counts admission waiters as DB pressure", () => {
  assert.match(
    flightRecorderSource,
    /if \(stats\.totalWaiting <= 0\)/,
  );
  assert.match(
    flightRecorderSource,
    /waiting:\s*stats\.waiting/,
  );
  assert.match(
    flightRecorderSource,
    /totalWaiting:\s*stats\.totalWaiting/,
  );
  assert.match(
    flightRecorderSource,
    /dbPool\["totalWaiting"\]\s*\?\?\s*dbPool\["waiting"\]/,
  );
});

test("diagnostics event persistence yields to high resource pressure", () => {
  const upsertEventBlock = sourceBlock(
    "async function upsertEvent",
    "async function resolveEvent",
  );

  assert.match(
    upsertEventBlock,
    /getApiResourcePressureSnapshot\(\)\.resourceLevel === "high"/,
  );
  assert.match(
    upsertEventBlock,
    /appendRuntimeFlightRecorderEvent\("diagnostic-event-db-persist-skipped"/,
  );

  const skipIndex = upsertEventBlock.indexOf(
    'appendRuntimeFlightRecorderEvent("diagnostic-event-db-persist-skipped"',
  );
  const dbWriteIndex = upsertEventBlock.indexOf('"upsert diagnostic event"');
  assert.notEqual(skipIndex, -1);
  assert.notEqual(dbWriteIndex, -1);
  assert.ok(skipIndex < dbWriteIndex);
});

test("diagnostic history limits gate on resource pressure only", () => {
  const limitBlock = sourceBlock(
    "function resolveDiagnosticLimit",
    "function resolveResolutionMs",
  );

  assert.match(limitBlock, /getApiResourcePressureSnapshot\(\)\.resourceLevel/);
  assert.doesNotMatch(limitBlock, /getApiResourcePressureSnapshot\(\)\.level/);
});
