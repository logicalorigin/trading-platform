import assert from "node:assert/strict";
import test from "node:test";
import { withTestDb } from "@workspace/db/testing";
import { __dbPhase0AuditInternalsForTests as audit } from "./db-phase0-audit";

const metric = (totalBytes: number) => ({
  table_name: "option_chain_latest",
  estimated_rows: "10",
  estimated_dead_rows: "0",
  total_bytes: String(totalBytes),
  table_bytes: String(totalBytes),
  index_bytes: "0",
  last_vacuum: null,
  last_autovacuum: null,
  last_analyze: null,
  last_autoanalyze: null,
  reloptions: null,
});

test("audit CLI is strict and makes pressure-heavy range scans explicit", () => {
  assert.deepEqual(audit.parseAuditArgs([]), {
    limit: 30,
    fullScanRanges: false,
  });
  assert.deepEqual(
    audit.parseAuditArgs(["--", "--limit=25", "--full-scan-ranges"]),
    {
      limit: 25,
      fullScanRanges: true,
    },
  );

  for (const args of [
    ["--unknown"],
    ["report"],
    ["--limit"],
    ["--limit", "2.5"],
    ["--limit", "1e2"],
    ["--limit", "0x10"],
    ["--limit", "+5"],
    ["--limit", "201"],
    ["--limit", "5", "--limit", "6"],
    ["--full-scan-ranges", "--full-scan-ranges"],
  ]) {
    assert.throws(
      () => audit.parseAuditArgs(args),
      /Usage: pnpm run db:phase0:audit/,
    );
  }
});

test("focus contracts follow the current schema and retention owners", () => {
  assert.equal(
    audit.FOCUS_TABLES.some(
      (candidate) => candidate.name === "option_chain_snapshots",
    ),
    false,
  );
  assert.equal(
    audit.FOCUS_TABLES.find(
      (candidate) => candidate.name === "option_contracts",
    )?.timeColumn,
    "expiration_date",
  );
  assert.equal(
    audit.FOCUS_TABLES.find(
      (candidate) => candidate.name === "shadow_balance_snapshots",
    )?.timeColumn,
    "as_of",
  );
});

test("range planning avoids implicit large unindexed scans", () => {
  const spec = {
    name: "option_chain_latest",
    role: "cache" as const,
    timeColumn: "as_of",
    note: "test",
  };
  const large = metric(audit.DEFAULT_FULL_SCAN_MAX_BYTES + 1);
  const small = metric(audit.DEFAULT_FULL_SCAN_MAX_BYTES - 1);
  const indexHeavy = {
    ...large,
    total_bytes: String(audit.DEFAULT_FULL_SCAN_MAX_BYTES * 10),
    table_bytes: String(audit.DEFAULT_FULL_SCAN_MAX_BYTES - 1),
  };
  const columns = new Set(["as_of"]);

  assert.equal(
    audit.planTimeRangeProbe(spec, large, columns, new Set(), false).mode,
    "skipped",
  );
  assert.equal(
    audit.planTimeRangeProbe(spec, large, columns, new Set(), true).mode,
    "full-scan",
  );
  assert.equal(
    audit.planTimeRangeProbe(spec, small, columns, new Set(), false).mode,
    "full-scan",
  );
  assert.equal(
    audit.planTimeRangeProbe(spec, indexHeavy, columns, new Set(), false).mode,
    "full-scan",
  );
  assert.equal(
    audit.planTimeRangeProbe(spec, large, columns, new Set(["as_of"]), false)
      .mode,
    "indexed",
  );
  assert.deepEqual(
    audit.planTimeRangeProbe(spec, large, new Set(), new Set(), false),
    {
      mode: "failed",
      detail: "configured time column is missing: as_of",
    },
  );
});

test("indexed ranges use endpoint probes while explicit full scans use one aggregate", async () => {
  const indexedQueries: string[] = [];
  const indexed = await audit.loadTimeRange(
    "option_chain_latest",
    "as_of",
    "indexed",
    async (sql) => {
      indexedQueries.push(sql);
      return {
        rows: [
          {
            oldest: new Date("2026-07-01T00:00:00.000Z"),
            newest: new Date("2026-07-13T00:00:00.000Z"),
          },
        ],
      };
    },
  );
  assert.equal(indexed.error, undefined);
  assert.match(indexedQueries[0] ?? "", /order by "as_of" asc\s+limit 1/i);
  assert.match(indexedQueries[0] ?? "", /order by "as_of" desc\s+limit 1/i);
  assert.doesNotMatch(indexedQueries[0] ?? "", /min\(/i);

  const fullScanQueries: string[] = [];
  await audit.loadTimeRange(
    "option_chain_latest",
    "as_of",
    "full-scan",
    async (sql) => {
      fullScanQueries.push(sql);
      return { rows: [{ oldest: null, newest: null }] };
    },
  );
  assert.match(fullScanQueries[0] ?? "", /min\("as_of"\)/i);
  assert.match(fullScanQueries[0] ?? "", /max\("as_of"\)/i);
});

test("catalog discovery identifies only complete leading btree columns", async () => {
  await withTestDb(async () => {
    const columns = await audit.loadLeadingIndexColumns();
    assert.equal(columns.get("option_contracts")?.has("expiration_date"), true);
    assert.equal(
      columns.get("option_chain_latest")?.has("as_of") ?? false,
      false,
    );

    assert.deepEqual(
      await audit.loadTimeRange(
        "option_contracts",
        "expiration_date",
        "indexed",
      ),
      { oldest: null, newest: null },
    );
  });
});

test("probe failures are actionable, terminal-safe, and distinct from safe skips", async () => {
  const failed = await audit.loadTimeRange(
    "option_chain_latest",
    "as_of",
    "indexed",
    async () => {
      const error = new Error(
        "\u001b[31mcanceling statement due to statement timeout\n\u202elive-url",
      ) as Error & { code: string };
      error.code = "57014";
      throw error;
    },
  );

  assert.match(failed.error ?? "", /statement timeout/i);
  assert.match(failed.error ?? "", /database load or locks/i);
  assert.doesNotMatch(failed.error ?? "", /\u001b|\n|\u202e/u);
  assert.ok((failed.error?.length ?? 0) <= audit.MAX_DIAGNOSTIC_LENGTH);

  const ranges = new Map([
    [
      "option_chain_latest",
      {
        oldest: null,
        newest: null,
        skipped: "large unindexed range probe omitted",
      },
    ],
  ]);
  const findings = audit.buildFindings(
    new Map([["option_chain_latest", metric(1024)]]),
    ranges,
  );
  assert.ok(
    findings.some(
      (finding) => finding.issue === "time_range_probe_skipped_unindexed",
    ),
  );
  assert.equal(
    audit
      .failedTimeRangeTables(ranges)
      .some(([table]) => table === "option_chain_latest"),
    false,
  );

  const generic = audit.safeDiagnostic(
    new Error(
      `postgres://operator:super-secret@db.internal/audit \u001b[31m${"x".repeat(800)}`,
    ),
  );
  assert.match(generic, /postgres:\/\/\[redacted\]@db\.internal\/audit/);
  assert.doesNotMatch(generic, /super-secret|\u001b/u);
  assert.ok(generic.length <= audit.MAX_DIAGNOSTIC_LENGTH);
});
