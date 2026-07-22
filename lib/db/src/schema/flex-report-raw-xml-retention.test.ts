import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";
import { getTableColumns } from "drizzle-orm";

import { flexReportRunsTable } from "./trading";

const migrationUrl = new URL(
  "../../migrations/20260720_purge_flex_report_raw_xml.sql",
  import.meta.url,
);
const migrationSource = existsSync(migrationUrl)
  ? readFileSync(migrationUrl, "utf8")
  : "";
const accountSource = readFileSync(
  new URL(
    "../../../../artifacts/api-server/src/services/account.ts",
    import.meta.url,
  ),
  "utf8",
);

test("Flex run storage has no raw XML column or write path", () => {
  assert.equal("rawXml" in getTableColumns(flexReportRunsTable), false);

  const flexFetchStart = accountSource.indexOf(
    "async function fetchFlexEndpoint",
  );
  const flexParseStart = accountSource.indexOf(
    "\nasync function upsertFlexReport",
    flexFetchStart,
  );
  assert.notEqual(flexFetchStart, -1);
  assert.notEqual(flexParseStart, -1);
  assert.doesNotMatch(
    accountSource.slice(flexFetchStart, flexParseStart),
    /detail:\s*(?:text|rawXml|lastXml)\.slice/,
  );

  const refreshStart = accountSource.indexOf(
    "export async function refreshFlexReport",
  );
  const refreshEnd = accountSource.indexOf(
    "\nasync function flexTablesHaveRows",
    refreshStart,
  );
  assert.notEqual(refreshStart, -1);
  assert.notEqual(refreshEnd, -1);

  const refreshSource = accountSource.slice(refreshStart, refreshEnd);
  assert.doesNotMatch(refreshSource, /\brawXml\s*:/);

  const normalizedAt = refreshSource.indexOf(
    "const counts = await upsertFlexReport(xml, run.id)",
  );
  const completedAt = refreshSource.indexOf('status: "completed"');
  assert.notEqual(normalizedAt, -1);
  assert.notEqual(completedAt, -1);
  assert.ok(normalizedAt < completedAt);
});

test("Flex raw XML purge migration removes existing payloads and preserves audit metadata", async () => {
  assert.match(
    migrationSource,
    /UPDATE\s+flex_report_runs\s+SET\s+raw_xml\s*=\s*NULL/is,
  );
  assert.match(
    migrationSource,
    /ALTER\s+TABLE\s+flex_report_runs\s+DROP\s+COLUMN\s+IF\s+EXISTS\s+raw_xml/is,
  );

  const client = new PGlite();
  try {
    await client.exec(`
      CREATE TABLE flex_report_runs (
        id uuid PRIMARY KEY,
        query_id varchar(128) NOT NULL,
        status varchar(32) NOT NULL,
        raw_xml text,
        metadata jsonb
      );
      INSERT INTO flex_report_runs (id, query_id, status, raw_xml, metadata)
      VALUES (
        '00000000-0000-4000-8000-000000000001',
        'query-1',
        'completed',
        '<FlexStatement sensitive="must-be-discarded" />',
        '{"counts":{"trades":1}}'
      );
    `);

    await client.exec(migrationSource);
    await assert.doesNotReject(
      client.exec(migrationSource),
      "the purge migration must be safe to retry",
    );

    const columns = await client.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'flex_report_runs'
      ORDER BY column_name
    `);
    assert.equal(
      columns.rows.some((column) => column.column_name === "raw_xml"),
      false,
    );

    const retained = await client.query<{
      query_id: string;
      status: string;
      metadata: { counts: { trades: number } };
    }>(`
      SELECT query_id, status, metadata
      FROM flex_report_runs
    `);
    assert.deepEqual(retained.rows, [
      {
        query_id: "query-1",
        status: "completed",
        metadata: { counts: { trades: 1 } },
      },
    ]);
  } finally {
    await client.close();
  }
});
