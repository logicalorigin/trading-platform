import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const diagnosticsSource = readFileSync(
  new URL("./diagnostics.ts", import.meta.url),
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
  assert.match(diagnosticsSource, /db_pool_waiting:\s*dbPool\.waiting/);
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

test("diagnostics heavy reads reuse cached telemetry under DB pool pressure", () => {
  const saturationBlock = sourceBlock(
    "function diagnosticsDbPoolIsSaturated",
    "function compactDiagnosticRawValue",
  );
  assert.match(saturationBlock, /getPoolStats\(\)/);
  assert.match(saturationBlock, /stats\.waiting > 0/);
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
