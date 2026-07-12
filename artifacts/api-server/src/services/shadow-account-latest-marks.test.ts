import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./shadow-account.ts", import.meta.url), "utf8");

test("snapshot totals read one latest mark per requested position", () => {
  const start = source.indexOf("async function latestShadowPositionMarksAt");
  const end = source.indexOf("async function computeShadowSnapshotTotalsAt", start);
  assert.notEqual(start, -1, "Missing latestShadowPositionMarksAt");
  assert.notEqual(end, -1, "Missing latestShadowPositionMarksAt end marker");
  const body = source.slice(start, end);

  assert.match(body, /from unnest\(\$2::uuid\[\]\) as requested\(position_id\)/);
  assert.match(body, /join lateral \(/);
  assert.match(body, /order by as_of desc, created_at desc/);
  assert.match(body, /limit 1/);
  assert.doesNotMatch(body, /\.select\(\)\s*\.from\(shadowPositionMarksTable\)/);
});

test("position peak marks use lateral top-one probes instead of grouped scans", () => {
  const start = source.indexOf("async function readShadowPositionPeakMarkPrices");
  const end = source.indexOf("function signalOptionsShadowQuotePayload", start);
  assert.notEqual(start, -1, "Missing readShadowPositionPeakMarkPrices");
  assert.notEqual(end, -1, "Missing readShadowPositionPeakMarkPrices end marker");
  const body = source.slice(start, end);

  assert.match(body, /from unnest\(\$1::uuid\[\]\) as requested\(position_id\)/);
  assert.match(body, /left join lateral \(/);
  assert.match(body, /order by mark desc/);
  assert.match(body, /limit 1/);
  assert.doesNotMatch(body, /max\(\$\{shadowPositionMarksTable\.mark\}\)/);
  assert.doesNotMatch(body, /\.groupBy\(shadowPositionMarksTable\.positionId\)/);
});

test("shadow position mark refresh batches mark writes", () => {
  const refreshStart = source.indexOf(
    "export async function refreshShadowPositionMarks",
  );
  const refreshEnd = source.indexOf("async function ensureFreshShadowState", refreshStart);
  assert.notEqual(refreshStart, -1, "Missing refreshShadowPositionMarks");
  assert.notEqual(refreshEnd, -1, "Missing refreshShadowPositionMarks end marker");
  const refreshBody = source.slice(refreshStart, refreshEnd);

  assert.match(refreshBody, /const markWrites: ShadowPositionMarkRefreshWrite\[\] = \[\]/);
  assert.match(refreshBody, /await writeShadowPositionMarkBatch\(markWrites\)/);
  assert.doesNotMatch(refreshBody, /\.update\(shadowPositionsTable\)/);
  assert.doesNotMatch(refreshBody, /db\.insert\(shadowPositionMarksTable\)/);

  const batchStart = source.indexOf("async function writeShadowPositionMarkBatch");
  const batchEnd = source.indexOf(
    "export async function refreshShadowPositionMarks",
    batchStart,
  );
  assert.notEqual(batchStart, -1, "Missing writeShadowPositionMarkBatch");
  assert.notEqual(batchEnd, -1, "Missing writeShadowPositionMarkBatch end marker");
  const batchBody = source.slice(batchStart, batchEnd);

  assert.match(batchBody, /\.insert\(shadowPositionMarksTable\)\.values\(/);
  assert.match(batchBody, /update shadow_positions as p/);
  assert.match(batchBody, /from unnest\(/);
  assert.match(batchBody, /array\[\$\{positionIds\}\]::uuid\[\]/);
});

test("shadow automation event reads keep literal predicates for partial indexes", () => {
  assert.match(
    source,
    /SIGNAL_OPTIONS_SHADOW_ENTRY_EXIT_EVENT_PREDICATE\s*=\s*sql`\$\{executionEventsTable\.eventType\} IN \('signal_options_shadow_entry', 'signal_options_shadow_exit'\)`/,
  );
  assert.match(
    source,
    /SIGNAL_OPTIONS_SHADOW_MARK_EVENT_PREDICATE\s*=\s*sql`\$\{executionEventsTable\.eventType\} = 'signal_options_shadow_mark'`/,
  );

  const repairStart = source.indexOf(
    "shadowAutomationMirrorRepairInFlight = (async () => {",
  );
  const repairEnd = source.indexOf("const missing = candidates", repairStart);
  assert.notEqual(repairStart, -1, "Missing mirror repair query");
  assert.notEqual(repairEnd, -1, "Missing mirror repair query end marker");
  const repairBody = source.slice(repairStart, repairEnd);
  assert.match(repairBody, /SIGNAL_OPTIONS_SHADOW_ENTRY_EXIT_EVENT_PREDICATE/);
  assert.doesNotMatch(repairBody, /inArray\(executionEventsTable\.eventType/);

  const marksStart = source.indexOf(
    "async function latestShadowAutomationManagementEvents",
  );
  const marksEnd = source.indexOf("const byPositionKey", marksStart);
  assert.notEqual(marksStart, -1, "Missing latest mark-event query");
  assert.notEqual(marksEnd, -1, "Missing latest mark-event query end marker");
  const marksBody = source.slice(marksStart, marksEnd);
  assert.match(marksBody, /SIGNAL_OPTIONS_SHADOW_MARK_EVENT_PREDICATE/);
  assert.doesNotMatch(marksBody, /eq\(executionEventsTable\.eventType/);
});

test("shadow automation management reads only the latest mark per requested contract", () => {
  const marksStart = source.indexOf(
    "async function latestShadowAutomationManagementEvents",
  );
  const marksEnd = source.indexOf(
    "function buildShadowAutomationContext",
    marksStart,
  );
  assert.notEqual(marksStart, -1, "Missing latest mark-event query");
  assert.notEqual(marksEnd, -1, "Missing latest mark-event query end marker");
  const marksBody = source.slice(marksStart, marksEnd);

  assert.match(
    marksBody,
    /FROM \(VALUES \$\{requestedContractsSql\}\) AS requested/i,
  );
  assert.match(marksBody, /JOIN LATERAL \(/i);
  assert.match(
    marksBody,
    /SELECT id[\s\S]*ORDER BY occurred_at DESC[\s\S]*LIMIT 1/i,
  );
  assert.match(marksBody, /inArray\(executionEventsTable\.id, eventIds\)/);
  assert.match(marksBody, /shadowAutomationEventPositionKey\(event\)/);
  assert.doesNotMatch(marksBody, /\.limit\(1000\)/);
});

test("shadow automation mirror repair excludes mirrored events before decoding payloads", () => {
  const repairStart = source.indexOf(
    "shadowAutomationMirrorRepairInFlight = (async () => {",
  );
  const repairEnd = source.indexOf("for (const event of missing)", repairStart);
  assert.notEqual(repairStart, -1, "Missing mirror repair query");
  assert.notEqual(repairEnd, -1, "Missing mirror repair loop");
  const repairBody = source.slice(repairStart, repairEnd);

  assert.match(repairBody, /\.leftJoin\(\s*shadowOrdersTable,/);
  assert.match(repairBody, /isNull\(shadowOrdersTable\.sourceEventId\)/);
  assert.doesNotMatch(
    repairBody,
    /const mirrored = eventIds\.length/,
    "already-mirrored history must not be loaded and decoded in Node",
  );
});
