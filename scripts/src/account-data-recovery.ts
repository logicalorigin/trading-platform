import { Pool, type PoolClient } from "pg";

type DbRow = Record<string, unknown>;

type DatabaseFingerprint = {
  database_name: string;
  database_bytes: string;
  server_addr: string | null;
  server_port: string | null;
  server_version: string;
  user_name: string;
};

type FlexTableSpec = {
  table: string;
  conflictColumns: readonly string[];
};

type SourceBalanceRow = {
  provider_account_id: string;
  currency: string;
  cash: string;
  buying_power: string;
  net_liquidation: string;
  maintenance_margin: string | null;
  as_of: Date;
  created_at: Date;
  updated_at: Date;
};

const args = new Set(process.argv.slice(2));
const execute = args.has("--execute");
const sourceDatabaseUrl = process.env.SOURCE_DATABASE_URL ?? "";
const targetDatabaseUrl = process.env.DATABASE_URL ?? "";

const BACKUP_TABLES = [
  "broker_connections",
  "broker_accounts",
  "balance_snapshots",
  "flex_report_runs",
  "flex_nav_history",
  "flex_trades",
  "flex_cash_activity",
  "flex_dividends",
  "flex_open_positions",
  "shadow_accounts",
  "shadow_positions",
  "shadow_orders",
  "shadow_fills",
  "shadow_balance_snapshots",
  "shadow_position_marks",
  "shadow_portfolio_analysis_snapshots",
] as const;

const FLEX_TABLES: readonly FlexTableSpec[] = [
  {
    table: "flex_nav_history",
    conflictColumns: ["provider_account_id", "statement_date", "currency"],
  },
  {
    table: "flex_trades",
    conflictColumns: ["provider_account_id", "trade_id"],
  },
  {
    table: "flex_cash_activity",
    conflictColumns: ["provider_account_id", "activity_id"],
  },
  {
    table: "flex_dividends",
    conflictColumns: ["provider_account_id", "dividend_id"],
  },
  {
    table: "flex_open_positions",
    conflictColumns: ["provider_account_id", "symbol", "as_of"],
  },
];

const SHADOW_REPLACE_TABLES = [
  "shadow_portfolio_analysis_snapshots",
  "shadow_position_marks",
  "shadow_balance_snapshots",
  "shadow_fills",
  "shadow_orders",
  "shadow_positions",
  "shadow_accounts",
] as const;

const SHADOW_INSERT_ORDER = [
  "shadow_accounts",
  "shadow_positions",
  "shadow_orders",
  "shadow_fills",
  "shadow_balance_snapshots",
  "shadow_position_marks",
  "shadow_portfolio_analysis_snapshots",
] as const;

function quoteIdentifier(identifier: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }
  return `"${identifier.replaceAll('"', '""')}"`;
}

function formatBytes(value: string): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) {
    return value;
  }
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

function timestampSlug(value = new Date()): string {
  return value.toISOString().replaceAll(/[-:T.Z]/g, "").slice(0, 14);
}

function normalizeKeyValue(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function rowKey(row: DbRow, columns: readonly string[]): string {
  return columns.map((column) => normalizeKeyValue(row[column])).join("\u001f");
}

function targetUrlLooksLikeHelium(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return (
      parsed.hostname === "helium" &&
      parsed.pathname.replace(/^\/+/, "") === "heliumdb"
    );
  } catch {
    return false;
  }
}

function updateColumnsFor(
  columns: readonly string[],
  conflictColumns: readonly string[],
): string[] {
  const excluded = new Set(["id", ...conflictColumns]);
  return columns.filter((column) => !excluded.has(column));
}

function dedupeRows(rows: DbRow[], keyColumns: readonly string[]): DbRow[] {
  const deduped = new Map<string, DbRow>();
  for (const row of rows) {
    deduped.set(rowKey(row, keyColumns), row);
  }
  return [...deduped.values()];
}

async function loadFingerprint(
  client: PoolClient,
): Promise<DatabaseFingerprint> {
  const result = await client.query<DatabaseFingerprint>(
    `select current_database() as database_name,
            pg_database_size(current_database())::text as database_bytes,
            inet_server_addr()::text as server_addr,
            inet_server_port()::text as server_port,
            current_setting('server_version') as server_version,
            current_user as user_name`,
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("Unable to identify database connection.");
  }
  return row;
}

async function loadTableColumns(
  client: PoolClient,
  table: string,
): Promise<string[]> {
  const result = await client.query<{ column_name: string }>(
    `select column_name
       from information_schema.columns
      where table_schema = 'public'
        and table_name = $1
      order by ordinal_position`,
    [table],
  );
  return result.rows.map((row) => row.column_name);
}

async function loadTableRows(
  client: PoolClient,
  table: string,
): Promise<DbRow[]> {
  const result = await client.query<DbRow>(
    `select * from ${quoteIdentifier(table)}`,
  );
  return result.rows;
}

async function loadTableCount(
  client: PoolClient,
  table: string,
): Promise<number> {
  const result = await client.query<{ count: string }>(
    `select count(*)::text as count from ${quoteIdentifier(table)}`,
  );
  return Number(result.rows[0]?.count ?? "0");
}

async function insertRows(
  client: PoolClient,
  table: string,
  columns: readonly string[],
  rows: readonly DbRow[],
  options: {
    conflictColumns?: readonly string[];
    updateColumns?: readonly string[];
  } = {},
): Promise<number> {
  if (rows.length === 0) {
    return 0;
  }

  const chunkSize = Math.max(1, Math.min(1000, Math.floor(50_000 / columns.length)));
  const columnSql = columns.map(quoteIdentifier).join(", ");
  const conflictColumns = options.conflictColumns ?? [];
  const updateColumns = options.updateColumns ?? [];
  const conflictSql =
    conflictColumns.length === 0
      ? ""
      : updateColumns.length === 0
        ? ` on conflict (${conflictColumns.map(quoteIdentifier).join(", ")}) do nothing`
        : ` on conflict (${conflictColumns
            .map(quoteIdentifier)
            .join(", ")}) do update set ${updateColumns
            .map(
              (column) =>
                `${quoteIdentifier(column)} = excluded.${quoteIdentifier(column)}`,
            )
            .join(", ")}`;

  let inserted = 0;
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    const values: unknown[] = [];
    const rowSql = chunk
      .map((row) => {
        const placeholders = columns.map((column) => {
          values.push(row[column] ?? null);
          return `$${values.length}`;
        });
        return `(${placeholders.join(", ")})`;
      })
      .join(", ");
    await client.query(
      `insert into ${quoteIdentifier(table)} (${columnSql}) values ${rowSql}${conflictSql}`,
      values,
    );
    inserted += chunk.length;
  }
  return inserted;
}

async function createBackupSchema(client: PoolClient): Promise<string> {
  const schema = `account_recovery_backup_${timestampSlug()}`;
  await client.query(`create schema ${quoteIdentifier(schema)}`);
  for (const table of BACKUP_TABLES) {
    await client.query(
      `create table ${quoteIdentifier(schema)}.${quoteIdentifier(
        table,
      )} as table public.${quoteIdentifier(table)} with data`,
    );
  }
  return schema;
}

async function loadSourceBalanceRows(
  source: PoolClient,
): Promise<SourceBalanceRow[]> {
  const result = await source.query<SourceBalanceRow>(
    `select ba.provider_account_id,
            bs.currency,
            bs.cash::text as cash,
            bs.buying_power::text as buying_power,
            bs.net_liquidation::text as net_liquidation,
            bs.maintenance_margin::text as maintenance_margin,
            bs.as_of,
            bs.created_at,
            bs.updated_at
       from balance_snapshots bs
       join broker_accounts ba on ba.id = bs.account_id
      order by bs.as_of asc, bs.created_at asc`,
  );
  return result.rows;
}

async function loadTargetAccountMap(
  target: PoolClient,
  providerAccountIds: readonly string[],
): Promise<Map<string, string>> {
  if (providerAccountIds.length === 0) {
    return new Map();
  }
  const result = await target.query<{
    id: string;
    provider_account_id: string;
  }>(
    `select id, provider_account_id
       from broker_accounts
      where provider_account_id = any($1::text[])`,
    [providerAccountIds],
  );
  return new Map(
    result.rows.map((row) => [row.provider_account_id, row.id] as const),
  );
}

async function buildBalanceInsertRows(
  target: PoolClient,
  sourceRows: readonly SourceBalanceRow[],
): Promise<{ rows: DbRow[]; unmappedRows: number }> {
  const providers = [...new Set(sourceRows.map((row) => row.provider_account_id))];
  const accountMap = await loadTargetAccountMap(target, providers);
  const targetAccountIds = [...new Set([...accountMap.values()])];

  const existingKeys = new Set<string>();
  if (targetAccountIds.length > 0) {
    const existing = await target.query<DbRow>(
      `select account_id,
              as_of,
              cash::text as cash,
              buying_power::text as buying_power,
              net_liquidation::text as net_liquidation
         from balance_snapshots
        where account_id = any($1::uuid[])`,
      [targetAccountIds],
    );
    for (const row of existing.rows) {
      existingKeys.add(
        rowKey(row, [
          "account_id",
          "as_of",
          "cash",
          "buying_power",
          "net_liquidation",
        ]),
      );
    }
  }

  const insertRowsForTarget: DbRow[] = [];
  let unmappedRows = 0;
  for (const row of sourceRows) {
    const accountId = accountMap.get(row.provider_account_id);
    if (!accountId) {
      unmappedRows += 1;
      continue;
    }
    const mapped: DbRow = {
      account_id: accountId,
      currency: row.currency,
      cash: row.cash,
      buying_power: row.buying_power,
      net_liquidation: row.net_liquidation,
      maintenance_margin: row.maintenance_margin,
      as_of: row.as_of,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
    const key = rowKey(mapped, [
      "account_id",
      "as_of",
      "cash",
      "buying_power",
      "net_liquidation",
    ]);
    if (!existingKeys.has(key)) {
      insertRowsForTarget.push(mapped);
      existingKeys.add(key);
    }
  }

  return { rows: insertRowsForTarget, unmappedRows };
}

async function resolveConnectionId(
  target: PoolClient,
  sourceAccount: DbRow,
): Promise<string> {
  const existingAccount = await target.query<{ connection_id: string }>(
    `select connection_id
       from broker_accounts
      where provider_account_id = $1
      limit 1`,
    [sourceAccount.provider_account_id],
  );
  const existingConnectionId = existingAccount.rows[0]?.connection_id;
  if (existingConnectionId) {
    return existingConnectionId;
  }

  const fallbackConnection = await target.query<{ id: string }>(
    `select id
       from broker_connections
      where connection_type = 'broker'
        and mode = $1
      order by is_default desc, updated_at desc
      limit 1`,
    [sourceAccount.mode],
  );
  const fallbackConnectionId = fallbackConnection.rows[0]?.id;
  if (fallbackConnectionId) {
    return fallbackConnectionId;
  }

  throw new Error(
    `No target broker connection found for mode=${String(sourceAccount.mode)}`,
  );
}

async function recoverBrokerAccounts(
  source: PoolClient,
  target: PoolClient,
): Promise<number> {
  const sourceRows = await loadTableRows(source, "broker_accounts");
  if (sourceRows.length === 0) {
    return 0;
  }

  const columns = [
    "id",
    "connection_id",
    "provider_account_id",
    "display_name",
    "mode",
    "base_currency",
    "is_default",
    "last_synced_at",
    "created_at",
    "updated_at",
  ];
  const rows: DbRow[] = [];
  for (const sourceRow of sourceRows) {
    rows.push({
      ...sourceRow,
      connection_id: await resolveConnectionId(target, sourceRow),
    });
  }
  await insertRows(target, "broker_accounts", columns, rows, {
    conflictColumns: ["provider_account_id"],
    updateColumns: [
      "display_name",
      "mode",
      "base_currency",
      "is_default",
      "last_synced_at",
      "updated_at",
    ],
  });
  return rows.length;
}

async function recoverBalanceSnapshots(
  source: PoolClient,
  target: PoolClient,
): Promise<{ inserted: number; unmappedRows: number }> {
  const sourceRows = await loadSourceBalanceRows(source);
  const planned = await buildBalanceInsertRows(target, sourceRows);
  await insertRows(
    target,
    "balance_snapshots",
    [
      "account_id",
      "currency",
      "cash",
      "buying_power",
      "net_liquidation",
      "maintenance_margin",
      "as_of",
      "created_at",
      "updated_at",
    ],
    planned.rows,
  );
  return { inserted: planned.rows.length, unmappedRows: planned.unmappedRows };
}

async function recoverFlexReportRuns(
  source: PoolClient,
  target: PoolClient,
): Promise<Map<string, string>> {
  const rows = await loadTableRows(source, "flex_report_runs");
  if (rows.length === 0) {
    return new Map();
  }

  const columns = await loadTableColumns(target, "flex_report_runs");
  const updateColumnsByReference = updateColumnsFor(columns, ["reference_code"]);
  const updateColumnsById = updateColumnsFor(columns, ["id"]);
  const rowsWithReference = rows.filter((row) => row.reference_code !== null);
  const rowsWithoutReference = rows.filter((row) => row.reference_code === null);

  await insertRows(target, "flex_report_runs", columns, rowsWithReference, {
    conflictColumns: ["reference_code"],
    updateColumns: updateColumnsByReference,
  });
  await insertRows(target, "flex_report_runs", columns, rowsWithoutReference, {
    conflictColumns: ["id"],
    updateColumns: updateColumnsById,
  });

  const referenceCodes = rowsWithReference.map((row) => String(row.reference_code));
  const sourceIdsWithoutReference = rowsWithoutReference.map((row) => String(row.id));
  const targetRows = await target.query<{
    id: string;
    reference_code: string | null;
  }>(
    `select id, reference_code
       from flex_report_runs
      where ($1::text[] = '{}' or reference_code = any($1::text[]))
         or ($2::uuid[] = '{}' or id = any($2::uuid[]))`,
    [referenceCodes, sourceIdsWithoutReference],
  );

  const targetIdByReference = new Map(
    targetRows.rows
      .filter((row) => row.reference_code !== null)
      .map((row) => [String(row.reference_code), row.id] as const),
  );
  const targetIdById = new Map(targetRows.rows.map((row) => [row.id, row.id] as const));
  const map = new Map<string, string>();
  for (const row of rows) {
    const sourceId = String(row.id);
    if (row.reference_code !== null) {
      const targetId = targetIdByReference.get(String(row.reference_code));
      if (targetId) {
        map.set(sourceId, targetId);
      }
      continue;
    }
    const targetId = targetIdById.get(sourceId);
    if (targetId) {
      map.set(sourceId, targetId);
    }
  }
  return map;
}

function remapSourceRunIds(rows: DbRow[], sourceRunIdMap: Map<string, string>): DbRow[] {
  return rows.map((row) => {
    const sourceRunId = row.source_run_id;
    if (sourceRunId === null || sourceRunId === undefined) {
      return row;
    }
    return {
      ...row,
      source_run_id: sourceRunIdMap.get(String(sourceRunId)) ?? sourceRunId,
    };
  });
}

async function recoverFlexTables(
  source: PoolClient,
  target: PoolClient,
): Promise<Record<string, number>> {
  const sourceRunIdMap = await recoverFlexReportRuns(source, target);
  const recovered: Record<string, number> = {
    flex_report_runs: sourceRunIdMap.size,
  };

  for (const spec of FLEX_TABLES) {
    const columns = await loadTableColumns(target, spec.table);
    const sourceRows = remapSourceRunIds(
      dedupeRows(await loadTableRows(source, spec.table), spec.conflictColumns),
      sourceRunIdMap,
    );
    await insertRows(target, spec.table, columns, sourceRows, {
      conflictColumns: spec.conflictColumns,
      updateColumns: updateColumnsFor(columns, spec.conflictColumns),
    });
    recovered[spec.table] = sourceRows.length;
  }

  return recovered;
}

async function replaceShadowTables(
  source: PoolClient,
  target: PoolClient,
): Promise<Record<string, number>> {
  const copied: Record<string, number> = {};
  await target.query(
    `truncate table ${SHADOW_REPLACE_TABLES.map(quoteIdentifier).join(
      ", ",
    )} restart identity`,
  );
  for (const table of SHADOW_INSERT_ORDER) {
    const columns = await loadTableColumns(target, table);
    const rows = await loadTableRows(source, table);
    await insertRows(target, table, columns, rows);
    copied[table] = rows.length;
  }
  return copied;
}

async function printPlan(
  source: PoolClient,
  target: PoolClient,
  sourceFingerprint: DatabaseFingerprint,
  targetFingerprint: DatabaseFingerprint,
): Promise<void> {
  console.log("source_database", {
    database: sourceFingerprint.database_name,
    server: sourceFingerprint.server_addr ?? "local-socket",
    port: sourceFingerprint.server_port ?? "socket",
    size: formatBytes(sourceFingerprint.database_bytes),
  });
  console.log("target_database", {
    database: targetFingerprint.database_name,
    server: targetFingerprint.server_addr ?? "local-socket",
    port: targetFingerprint.server_port ?? "socket",
    size: formatBytes(targetFingerprint.database_bytes),
  });

  const sourceBalanceRows = await loadSourceBalanceRows(source);
  const plannedBalanceRows = await buildBalanceInsertRows(target, sourceBalanceRows);

  const rowCounts: Array<{
    table: string;
    sourceRows: number;
    targetRows: number;
    action: string;
  }> = [];
  for (const table of ["broker_accounts", "balance_snapshots"] as const) {
    rowCounts.push({
      table,
      sourceRows:
        table === "balance_snapshots"
          ? sourceBalanceRows.length
          : await loadTableCount(source, table),
      targetRows: await loadTableCount(target, table),
      action:
        table === "balance_snapshots"
          ? `insert_missing=${plannedBalanceRows.rows.length}, unmapped=${plannedBalanceRows.unmappedRows}`
          : "upsert_by_provider_account_id",
    });
  }

  for (const table of ["flex_report_runs", ...FLEX_TABLES.map((spec) => spec.table)]) {
    rowCounts.push({
      table,
      sourceRows: await loadTableCount(source, table),
      targetRows: await loadTableCount(target, table),
      action: table === "flex_report_runs" ? "upsert_by_reference_code" : "upsert_by_natural_key",
    });
  }

  for (const table of SHADOW_INSERT_ORDER) {
    rowCounts.push({
      table,
      sourceRows: await loadTableCount(source, table),
      targetRows: await loadTableCount(target, table),
      action: "replace_target_with_source",
    });
  }

  console.table(rowCounts);
  console.log(`dry_run=${execute ? "false" : "true"}`);
  if (!execute) {
    console.log("Pass --execute to create a Helium backup schema and apply recovery.");
  }
}

async function assertSafeConnections(
  source: PoolClient,
  target: PoolClient,
): Promise<{
  sourceFingerprint: DatabaseFingerprint;
  targetFingerprint: DatabaseFingerprint;
}> {
  if (!sourceDatabaseUrl) {
    throw new Error("SOURCE_DATABASE_URL is required.");
  }
  if (!targetDatabaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }
  if (sourceDatabaseUrl === targetDatabaseUrl) {
    throw new Error("SOURCE_DATABASE_URL and DATABASE_URL must not be identical.");
  }
  if (!targetUrlLooksLikeHelium(targetDatabaseUrl)) {
    throw new Error(
      "Refusing to run: DATABASE_URL must be postgresql://...@helium/heliumdb...",
    );
  }

  const [sourceFingerprint, targetFingerprint] = await Promise.all([
    loadFingerprint(source),
    loadFingerprint(target),
  ]);

  if (targetFingerprint.database_name !== "heliumdb") {
    throw new Error(
      `Refusing to run: target database is ${targetFingerprint.database_name}, not heliumdb.`,
    );
  }

  const sourceIdentity = [
    sourceFingerprint.database_name,
    sourceFingerprint.server_addr ?? "local-socket",
    sourceFingerprint.server_port ?? "socket",
    sourceFingerprint.user_name,
  ].join("|");
  const targetIdentity = [
    targetFingerprint.database_name,
    targetFingerprint.server_addr ?? "local-socket",
    targetFingerprint.server_port ?? "socket",
    targetFingerprint.user_name,
  ].join("|");
  if (sourceIdentity === targetIdentity) {
    throw new Error("Refusing to run: source and target resolved to the same database.");
  }

  return { sourceFingerprint, targetFingerprint };
}

async function recover(source: PoolClient, target: PoolClient): Promise<void> {
  await target.query("begin");
  try {
    const backupSchema = await createBackupSchema(target);
    console.log(`backup_schema=${backupSchema}`);

    const brokerAccounts = await recoverBrokerAccounts(source, target);
    const balances = await recoverBalanceSnapshots(source, target);
    const flex = await recoverFlexTables(source, target);
    const shadow = await replaceShadowTables(source, target);

    await target.query("commit");
    console.log("recovery_complete=true");
    console.log("broker_accounts_upserted", brokerAccounts);
    console.log("balance_snapshots_inserted", balances.inserted);
    console.log("balance_snapshots_unmapped", balances.unmappedRows);
    console.log("flex_rows_processed", flex);
    console.log("shadow_rows_replaced", shadow);
  } catch (error) {
    await target.query("rollback");
    throw error;
  }
}

async function main(): Promise<void> {
  const sourcePool = new Pool({ connectionString: sourceDatabaseUrl, max: 2 });
  const targetPool = new Pool({ connectionString: targetDatabaseUrl, max: 2 });
  const source = await sourcePool.connect();
  const target = await targetPool.connect();

  try {
    const { sourceFingerprint, targetFingerprint } = await assertSafeConnections(
      source,
      target,
    );
    await printPlan(source, target, sourceFingerprint, targetFingerprint);
    if (execute) {
      await recover(source, target);
    }
  } finally {
    source.release();
    target.release();
    await Promise.all([sourcePool.end(), targetPool.end()]);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
