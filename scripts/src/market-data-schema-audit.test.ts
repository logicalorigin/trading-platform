import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { __setPoolQueryForTests } from "@workspace/db";
import {
  barCacheTable,
  flowSummariesTable,
  gexSnapshotsTable,
  marketDataIngestJobsTable,
  optionChainLatestTable,
  providerRequestLogTable,
  quoteCacheTable,
} from "@workspace/db/schema";
import { getTableConfig } from "drizzle-orm/pg-core";
import { __marketDataSchemaAuditInternalsForTests as schemaAudit } from "./market-data-schema-audit";

const scriptPath = resolve(import.meta.dirname, "market-data-schema-audit.ts");
const scriptSource = readFileSync(scriptPath, "utf8");
const isolatedDatabaseEnv = {
  ...process.env,
  DATABASE_URL:
    "postgresql://schema-audit-test:unused@127.0.0.1:1/schema-audit-test?connect_timeout=1",
  LOCAL_DATABASE_URL: "",
  PGDATABASE: "",
  PGHOST: "",
  PGPASSWORD: "",
  PGPORT: "",
  PGUSER: "",
  PYRUS_DATABASE_SOURCE: "database_url",
};

test("importing the schema audit does not open a database connection", () => {
  const imported = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      `await import(${JSON.stringify(pathToFileURL(scriptPath).href)})`,
    ],
    {
      cwd: resolve(import.meta.dirname, ".."),
      encoding: "utf8",
      env: isolatedDatabaseEnv,
      timeout: 10_000,
    },
  );

  assert.equal(
    imported.status,
    0,
    `import unexpectedly ran the audit:\n${imported.stdout}${imported.stderr}`,
  );
});

test("unknown command input fails before database work", () => {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", scriptPath, "--unknown"],
    {
      cwd: resolve(import.meta.dirname, ".."),
      encoding: "utf8",
      env: isolatedDatabaseEnv,
      timeout: 10_000,
    },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage: pnpm run db:market-data:audit/);
  assert.doesNotMatch(result.stderr, /ECONNREFUSED|127\.0\.0\.1/);
});

test("audit scope follows the current market-data schema source", () => {
  const schemaTables = [
    quoteCacheTable,
    barCacheTable,
    optionChainLatestTable,
    marketDataIngestJobsTable,
    providerRequestLogTable,
    gexSnapshotsTable,
    flowSummariesTable,
  ];
  const expected = schemaTables.map((table) => {
    const config = getTableConfig(table);
    return {
      name: config.name,
      columns: config.columns.map((column) => column.name),
      indexes: config.indexes.map((index) => ({
        name: index.config.name,
        columns: index.config.columns.map((column) =>
          "name" in column ? column.name : null,
        ),
        unique: index.config.unique,
      })),
      reloptions:
        config.name === "bar_cache"
          ? [
              "autovacuum_vacuum_scale_factor=0.02",
              "autovacuum_vacuum_threshold=1000",
              "autovacuum_analyze_scale_factor=0.02",
              "autovacuum_analyze_threshold=1000",
              "autovacuum_vacuum_cost_limit=2000",
            ]
          : [],
    };
  });
  const actual = (
    schemaAudit.TABLES as unknown as Array<{
      name: string;
      columns: string[];
      indexes: Array<
        | string
        | { name: string; columns: Array<string | null>; unique: boolean }
      >;
      reloptions?: string[];
    }>
  ).map((spec) => ({
    name: spec.name,
    columns: spec.columns,
    indexes: spec.indexes.map((index) =>
      typeof index === "string"
        ? { name: index, columns: [], unique: null }
        : index,
    ),
    reloptions: spec.reloptions ?? [],
  }));

  assert.deepEqual(actual, expected);
});

test("migration audit rejects comment-only tables and incomplete DDL", () => {
  const commentOnly = schemaAudit.auditMigrationSql(
    "-- create table if not exists sample (id uuid, symbol text);",
    [
      {
        name: "sample",
        columns: ["id", "symbol"],
        indexes: [],
        reloptions: [],
      },
    ],
  );
  assert.ok(commentOnly.includes("migration missing table sample"));

  const incomplete = schemaAudit.auditMigrationSql(
    `
      create table if not exists sample (id uuid);
      create index if not exists sample_symbol_idx on wrong_table (symbol);
    `,
    [
      {
        name: "sample",
        columns: ["id", "symbol"],
        indexes: [
          { name: "sample_symbol_idx", columns: ["symbol"], unique: false },
        ],
        reloptions: [],
      },
    ],
  );
  assert.ok(incomplete.includes("migration missing column symbol on sample"));
  assert.ok(
    incomplete.includes("migration missing index sample_symbol_idx on sample"),
  );
});

test("migration audit ignores quoted pseudo-DDL and checks exact index signatures", () => {
  const spec = {
    name: "sample",
    columns: ["id", "source"],
    indexes: [
      {
        name: "sample_id_source_key",
        columns: ["id", "source"],
        unique: true,
      },
    ],
    reloptions: [],
  };
  const quotedOnly = schemaAudit.auditMigrationSql(
    `
      select 'create table if not exists sample (id uuid, source text)';
      do $$ begin raise notice 'create unique index if not exists sample_id_source_key on sample (id, source)'; end $$;
    `,
    [spec],
  );
  assert.ok(quotedOnly.includes("migration missing table sample"));
  assert.ok(
    quotedOnly.includes(
      "migration missing index sample_id_source_key on sample",
    ),
  );

  const wrongSignature = schemaAudit.auditMigrationSql(
    `
      create table if not exists sample (id uuid, source text);
      create index if not exists sample_id_source_key on sample (source, id);
    `,
    [spec],
  );
  assert.ok(
    wrongSignature.includes(
      "migration missing index sample_id_source_key on sample",
    ),
  );

  assert.deepEqual(
    schemaAudit.auditMigrationSql(
      `
        create table sample (id uuid, source text);
        create unique index concurrently sample_id_source_key on sample (id, source);
      `,
      [spec],
    ),
    [],
  );

  assert.deepEqual(
    schemaAudit.auditMigrationSql(
      `
        create table sample (id uuid);
        alter table sample add column if not exists source text;
        create unique index sample_id_source_key on sample (id, source);
      `,
      [spec],
    ),
    [],
  );
});

test("the repository migration corpus satisfies the current schema contract", () => {
  assert.deepEqual(schemaAudit.auditMigrationFile(), []);
});

test("live index discovery requires ready valid definitions", () => {
  assert.match(scriptSource, /idx\.indisvalid/);
  assert.match(scriptSource, /idx\.indisready/);
  assert.match(scriptSource, /idx\.indisunique/);
  assert.match(scriptSource, /idx\.indnkeyatts/);
});

test("audit rejects an index with the right name but the wrong signature", () => {
  const buildAuditRows = (
    schemaAudit as unknown as {
      buildAuditRows?: (
        specs: unknown[],
        catalog: unknown,
      ) => Array<{
        missingIndexes: string[];
        mismatchedIndexes: string[];
      }>;
    }
  ).buildAuditRows;
  assert.ok(buildAuditRows, "expected a pure catalog comparison boundary");

  const [row] = buildAuditRows(
    [
      {
        name: "sample",
        columns: ["id", "source"],
        indexes: [
          {
            name: "sample_id_source_key",
            columns: ["id", "source"],
            unique: true,
          },
        ],
        reloptions: [],
      },
    ],
    {
      tables: new Set(["sample"]),
      columnsByTable: new Map([["sample", new Set(["id", "source"])]]),
      indexesByTable: new Map([
        [
          "sample",
          new Map([
            [
              "sample_id_source_key",
              { columns: ["source", "id"], unique: false },
            ],
          ]),
        ],
      ]),
      reloptionsByTable: new Map(),
    },
  );

  assert.deepEqual(row?.missingIndexes, []);
  assert.deepEqual(row?.mismatchedIndexes, ["sample_id_source_key"]);
});

test("catalog reads are scoped and never claim concurrent pool slots", async () => {
  const calls: Array<{ sql: string; values: unknown }> = [];
  let active = 0;
  let maxActive = 0;
  const restore = __setPoolQueryForTests(async (...args: unknown[]) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise<void>((resolvePromise) => setImmediate(resolvePromise));
    calls.push({ sql: String(args[0]), values: args[1] });
    active -= 1;
    return { rows: [] };
  });
  try {
    await schemaAudit.audit();
  } finally {
    restore();
  }

  assert.equal(calls.length, 4);
  assert.equal(maxActive, 1);
  const tableNames = schemaAudit.TABLES.map((spec) => spec.name);
  for (const call of calls) {
    assert.match(call.sql, /any\(\$1::text\[\]\)/);
    assert.deepEqual(call.values, [tableNames]);
  }
  const indexCall = calls.find((call) => call.sql.includes("from pg_index"));
  assert.ok(indexCall, "expected the index catalog query");
  assert.match(
    indexCall.sql,
    /array_agg\(attribute\.attname::text order by/,
    "pg does not decode name[]; aggregate text[] for an actual string array",
  );
});

test("diagnostics are bounded terminal-safe and redact URL credentials", () => {
  const diagnostic = schemaAudit.safeDiagnostic(
    new Error(
      `postgres://operator:super-secret@db.internal/audit \u001b[31m\n\u202e${"x".repeat(800)}`,
    ),
  );
  assert.match(diagnostic, /postgres:\/\/\[redacted\]@db\.internal\/audit/);
  assert.doesNotMatch(diagnostic, /super-secret|\u001b|\n|\u202e/u);
  assert.ok(diagnostic.length <= schemaAudit.MAX_DIAGNOSTIC_LENGTH);
});
