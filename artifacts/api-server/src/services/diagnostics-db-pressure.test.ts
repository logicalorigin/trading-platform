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
