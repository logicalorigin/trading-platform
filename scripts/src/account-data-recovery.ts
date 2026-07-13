import { pathToFileURL } from "node:url";
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
  source_account_id: string;
  currency: string;
  cash: string;
  buying_power: string;
  net_liquidation: string;
  maintenance_margin: string | null;
  as_of: Date;
  created_at: Date;
  updated_at: Date;
};

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
    conflictColumns: ["provider_account_id", "symbol", "as_of", "contract_key"],
  },
];

const BALANCE_SNAPSHOT_KEY_COLUMNS = [
  "account_id",
  "currency",
  "as_of",
  "cash",
  "buying_power",
  "net_liquidation",
  "maintenance_margin",
] as const;

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
  return value
    .toISOString()
    .replaceAll(/[-:T.Z]/g, "")
    .slice(0, 14);
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

function databaseIdentity(fingerprint: DatabaseFingerprint): string {
  return [
    fingerprint.database_name,
    fingerprint.server_addr ?? "local-socket",
    fingerprint.server_port ?? "socket",
  ].join("|");
}

function brokerAccountIdentity(row: DbRow): string {
  return rowKey(row, ["app_user_id", "provider_account_id"]);
}

function brokerConnectionIdentity(row: DbRow): string {
  return rowKey(row, ["app_user_id", "connection_type", "mode", "name"]);
}

function rowsByKey(
  rows: readonly DbRow[],
  keyFor: (row: DbRow) => string,
  label: string,
): Map<string, DbRow> {
  const keyed = new Map<string, DbRow>();
  for (const row of rows) {
    const key = keyFor(row);
    if (keyed.has(key)) {
      throw new Error(`Ambiguous ${label} identity: ${key}`);
    }
    keyed.set(key, row);
  }
  return keyed;
}

function buildBrokerAccountRows(
  sourceAccounts: readonly DbRow[],
  sourceConnections: readonly DbRow[],
  targetAccounts: readonly DbRow[],
  targetConnections: readonly DbRow[],
): DbRow[] {
  const uniqueSourceAccounts = [
    ...rowsByKey(
      sourceAccounts,
      brokerAccountIdentity,
      "source broker account",
    ).values(),
  ];
  const sourceConnectionById = rowsByKey(
    sourceConnections,
    (row) => normalizeKeyValue(row.id),
    "source broker connection",
  );
  const targetAccountByIdentity = rowsByKey(
    targetAccounts,
    brokerAccountIdentity,
    "target broker account",
  );
  const targetConnectionByIdentity = rowsByKey(
    targetConnections,
    brokerConnectionIdentity,
    "target broker connection",
  );
  const targetConnectionById = rowsByKey(
    targetConnections,
    (row) => normalizeKeyValue(row.id),
    "target broker connection id",
  );

  return uniqueSourceAccounts.map((sourceAccount) => {
    const sourceConnection = sourceConnectionById.get(
      normalizeKeyValue(sourceAccount.connection_id),
    );
    if (!sourceConnection) {
      throw new Error(
        `No source broker connection found for account id=${normalizeKeyValue(sourceAccount.id)}`,
      );
    }
    if (
      normalizeKeyValue(sourceAccount.app_user_id) !==
      normalizeKeyValue(sourceConnection.app_user_id)
    ) {
      throw new Error(
        `Broker account id=${normalizeKeyValue(sourceAccount.id)} and its connection have different owners.`,
      );
    }

    const existingTarget = targetAccountByIdentity.get(
      brokerAccountIdentity(sourceAccount),
    );
    if (existingTarget) {
      const existingTargetConnection = targetConnectionById.get(
        normalizeKeyValue(existingTarget.connection_id),
      );
      if (
        !existingTargetConnection ||
        brokerConnectionIdentity(existingTargetConnection) !==
          brokerConnectionIdentity(sourceConnection)
      ) {
        throw new Error(
          `Existing target broker connection does not match source account id=${normalizeKeyValue(sourceAccount.id)}.`,
        );
      }
      return { ...sourceAccount, connection_id: existingTarget.connection_id };
    }

    const targetConnection = targetConnectionByIdentity.get(
      brokerConnectionIdentity(sourceConnection),
    );
    if (!targetConnection) {
      throw new Error(
        `No target broker connection matches source account id=${normalizeKeyValue(sourceAccount.id)}.`,
      );
    }
    return { ...sourceAccount, connection_id: targetConnection.id };
  });
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

function parseRecoveryArgs(argv: readonly string[]): { execute: boolean } {
  if (argv.length === 0) {
    return { execute: false };
  }
  if (argv.length === 1 && argv[0] === "--execute") {
    return { execute: true };
  }
  throw new Error("Usage: account-data-recovery [--execute]");
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
  // ponytail: manual recovery buffers one table at a time; move this boundary to
  // keyset/cursor batches if measured source tables outgrow the operator heap.
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

async function loadCommonTableColumns(
  source: PoolClient,
  target: PoolClient,
  table: string,
): Promise<string[]> {
  const [sourceColumns, targetColumns] = await Promise.all([
    loadTableColumns(source, table),
    loadTableColumns(target, table),
  ]);
  const availableFromSource = new Set(sourceColumns);
  return targetColumns.filter((column) => availableFromSource.has(column));
}

function assertColumnsPresent(
  table: string,
  columns: readonly string[],
  requiredColumns: readonly string[],
): void {
  const available = new Set(columns);
  const missing = requiredColumns.filter((column) => !available.has(column));
  if (missing.length > 0) {
    throw new Error(
      `Source and target schemas for ${table} do not share required columns: ${missing.join(", ")}`,
    );
  }
}

async function assertTargetUsersExist(
  target: PoolClient,
  rows: readonly DbRow[],
  label: string,
): Promise<void> {
  const sourceUserIds = [
    ...new Set(
      rows
        .map((row) => row.app_user_id)
        .filter(
          (value): value is string =>
            typeof value === "string" && value.length > 0,
        ),
    ),
  ];
  if (sourceUserIds.length === 0) {
    return;
  }
  const result = await target.query<{ id: string }>(
    `select id::text as id from users where id = any($1::uuid[])`,
    [sourceUserIds],
  );
  const existing = new Set(result.rows.map((row) => row.id));
  const missing = sourceUserIds.filter((id) => !existing.has(id));
  if (missing.length > 0) {
    throw new Error(
      `Cannot recover ${label}: target is missing app users ${missing.join(", ")}.`,
    );
  }
}

async function insertRows(
  client: PoolClient,
  table: string,
  columns: readonly string[],
  rows: readonly DbRow[],
  options: {
    conflictColumns?: readonly string[];
    conflictPredicate?: { column: string; isNull: boolean };
    updateColumns?: readonly string[];
  } = {},
): Promise<number> {
  if (rows.length === 0) {
    return 0;
  }

  const chunkSize = Math.max(
    1,
    Math.min(1000, Math.floor(50_000 / columns.length)),
  );
  const columnSql = columns.map(quoteIdentifier).join(", ");
  const conflictColumns = options.conflictColumns ?? [];
  const updateColumns = options.updateColumns ?? [];
  const conflictPredicate = options.conflictPredicate;
  if (conflictPredicate && conflictColumns.length === 0) {
    throw new Error("A conflict predicate requires conflict columns.");
  }
  const conflictPredicateSql = conflictPredicate
    ? ` where ${quoteIdentifier(conflictPredicate.column)} is ${
        conflictPredicate.isNull ? "null" : "not null"
      }`
    : "";
  const conflictSql =
    conflictColumns.length === 0
      ? ""
      : updateColumns.length === 0
        ? ` on conflict (${conflictColumns
            .map(quoteIdentifier)
            .join(", ")})${conflictPredicateSql} do nothing`
        : ` on conflict (${conflictColumns
            .map(quoteIdentifier)
            .join(", ")})${conflictPredicateSql} do update set ${updateColumns
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
    `select ba.id::text as source_account_id,
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

async function loadTargetAccountIdMap(
  target: PoolClient,
  sourceAccounts: readonly DbRow[],
): Promise<Map<string, string>> {
  const providerAccountIds = [
    ...new Set(
      sourceAccounts.map((row) => normalizeKeyValue(row.provider_account_id)),
    ),
  ].filter(Boolean);
  if (providerAccountIds.length === 0) {
    return new Map();
  }
  const result = await target.query<{
    id: string;
    app_user_id: string | null;
    provider_account_id: string;
  }>(
    `select id::text as id, app_user_id::text as app_user_id, provider_account_id
       from broker_accounts
      where provider_account_id = any($1::text[])`,
    [providerAccountIds],
  );
  const targetByIdentity = rowsByKey(
    result.rows,
    brokerAccountIdentity,
    "target broker account",
  );
  const accountIdMap = new Map<string, string>();
  for (const sourceAccount of sourceAccounts) {
    const sourceId = normalizeKeyValue(sourceAccount.id);
    const targetAccount = targetByIdentity.get(
      brokerAccountIdentity(sourceAccount),
    );
    if (sourceId && targetAccount) {
      accountIdMap.set(sourceId, normalizeKeyValue(targetAccount.id));
    }
  }
  return accountIdMap;
}

async function buildBalanceInsertRows(
  target: PoolClient,
  sourceRows: readonly SourceBalanceRow[],
  accountIdMap: ReadonlyMap<string, string>,
): Promise<{ rows: DbRow[]; unmappedRows: number }> {
  const targetAccountIds = [...new Set([...accountIdMap.values()])];

  const existingKeys = new Set<string>();
  if (targetAccountIds.length > 0) {
    const existing = await target.query<DbRow>(
      `select account_id,
              currency,
              as_of,
              cash::text as cash,
              buying_power::text as buying_power,
              net_liquidation::text as net_liquidation,
              maintenance_margin::text as maintenance_margin
         from balance_snapshots
        where account_id = any($1::uuid[])`,
      [targetAccountIds],
    );
    for (const row of existing.rows) {
      existingKeys.add(rowKey(row, BALANCE_SNAPSHOT_KEY_COLUMNS));
    }
  }

  const insertRowsForTarget: DbRow[] = [];
  let unmappedRows = 0;
  for (const row of sourceRows) {
    const accountId = accountIdMap.get(row.source_account_id);
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
    const key = rowKey(mapped, BALANCE_SNAPSHOT_KEY_COLUMNS);
    if (!existingKeys.has(key)) {
      insertRowsForTarget.push(mapped);
      existingKeys.add(key);
    }
  }

  return { rows: insertRowsForTarget, unmappedRows };
}

async function recoverBrokerAccounts(
  source: PoolClient,
  target: PoolClient,
): Promise<{ upserted: number; accountIdMap: Map<string, string> }> {
  const sourceRows = await loadTableRows(source, "broker_accounts");
  if (sourceRows.length === 0) {
    return { upserted: 0, accountIdMap: new Map() };
  }

  await assertTargetUsersExist(target, sourceRows, "broker accounts");
  const [sourceConnections, targetAccounts, targetConnections, commonColumns] =
    await Promise.all([
      loadTableRows(source, "broker_connections"),
      loadTableRows(target, "broker_accounts"),
      loadTableRows(target, "broker_connections"),
      loadCommonTableColumns(source, target, "broker_accounts"),
    ]);
  const columns = commonColumns.filter((column) => column !== "id");
  assertColumnsPresent("broker_accounts", columns, [
    "connection_id",
    "provider_account_id",
    "display_name",
    "mode",
  ]);
  const rows = buildBrokerAccountRows(
    sourceRows,
    sourceConnections,
    targetAccounts,
    targetConnections,
  );
  const updateColumns = columns.filter(
    (column) =>
      ![
        "app_user_id",
        "connection_id",
        "provider_account_id",
        "created_at",
      ].includes(column),
  );
  const globalRows = rows.filter((row) => row.app_user_id == null);
  const userRows = rows.filter((row) => row.app_user_id != null);
  await insertRows(target, "broker_accounts", columns, globalRows, {
    conflictColumns: ["provider_account_id"],
    conflictPredicate: { column: "app_user_id", isNull: true },
    updateColumns,
  });
  await insertRows(target, "broker_accounts", columns, userRows, {
    conflictColumns: ["app_user_id", "provider_account_id"],
    conflictPredicate: { column: "app_user_id", isNull: false },
    updateColumns,
  });
  const accountIdMap = await loadTargetAccountIdMap(target, sourceRows);
  if (accountIdMap.size !== sourceRows.length) {
    throw new Error(
      `Recovered ${accountIdMap.size} of ${sourceRows.length} broker-account identities.`,
    );
  }
  return { upserted: rows.length, accountIdMap };
}

async function recoverBalanceSnapshots(
  source: PoolClient,
  target: PoolClient,
  accountIdMap: ReadonlyMap<string, string>,
): Promise<{ inserted: number; unmappedRows: number }> {
  const sourceRows = await loadSourceBalanceRows(source);
  const planned = await buildBalanceInsertRows(
    target,
    sourceRows,
    accountIdMap,
  );
  if (planned.unmappedRows > 0) {
    throw new Error(
      `Cannot recover ${planned.unmappedRows} balance snapshots without target broker-account mappings.`,
    );
  }
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

  const columns = await loadCommonTableColumns(
    source,
    target,
    "flex_report_runs",
  );
  assertColumnsPresent("flex_report_runs", columns, ["id", "reference_code"]);
  const updateColumnsByReference = updateColumnsFor(columns, [
    "reference_code",
  ]);
  const updateColumnsById = updateColumnsFor(columns, ["id"]);
  const rowsWithReference = rows.filter((row) => row.reference_code !== null);
  const rowsWithoutReference = rows.filter(
    (row) => row.reference_code === null,
  );

  await insertRows(target, "flex_report_runs", columns, rowsWithReference, {
    conflictColumns: ["reference_code"],
    updateColumns: updateColumnsByReference,
  });
  await insertRows(target, "flex_report_runs", columns, rowsWithoutReference, {
    conflictColumns: ["id"],
    updateColumns: updateColumnsById,
  });

  const referenceCodes = rowsWithReference.map((row) =>
    String(row.reference_code),
  );
  const sourceIdsWithoutReference = rowsWithoutReference.map((row) =>
    String(row.id),
  );
  const targetRows = await target.query<{
    id: string;
    reference_code: string | null;
  }>(
    `select id, reference_code
       from flex_report_runs
      where reference_code = any($1::text[])
         or id = any($2::uuid[])`,
    [referenceCodes, sourceIdsWithoutReference],
  );

  const targetIdByReference = new Map(
    targetRows.rows
      .filter((row) => row.reference_code !== null)
      .map((row) => [String(row.reference_code), row.id] as const),
  );
  const targetIdById = new Map(
    targetRows.rows.map((row) => [row.id, row.id] as const),
  );
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
  if (map.size !== rows.length) {
    throw new Error(
      `Recovered ${map.size} of ${rows.length} FLEX report runs.`,
    );
  }
  return map;
}

function remapSourceRunIds(
  rows: DbRow[],
  sourceRunIdMap: Map<string, string>,
): DbRow[] {
  return rows.map((row) => {
    const sourceRunId = row.source_run_id;
    if (sourceRunId === null || sourceRunId === undefined) {
      return row;
    }
    const targetRunId = sourceRunIdMap.get(String(sourceRunId));
    if (!targetRunId) {
      throw new Error(
        `No recovered FLEX report run maps source_run_id=${String(sourceRunId)}.`,
      );
    }
    return {
      ...row,
      source_run_id: targetRunId,
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
    const columns = await loadCommonTableColumns(source, target, spec.table);
    assertColumnsPresent(spec.table, columns, spec.conflictColumns);
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

function remapShadowAccountBrokerIds(
  rows: readonly DbRow[],
  accountIdMap: ReadonlyMap<string, string>,
): DbRow[] {
  return rows.map((row) => {
    const sourceAccountId = row.source_broker_account_id;
    if (sourceAccountId === null || sourceAccountId === undefined) {
      return row;
    }
    const targetAccountId = accountIdMap.get(String(sourceAccountId));
    if (!targetAccountId) {
      throw new Error(
        `No recovered broker account maps shadow source_broker_account_id=${String(sourceAccountId)}.`,
      );
    }
    return { ...row, source_broker_account_id: targetAccountId };
  });
}

async function replaceShadowTables(
  source: PoolClient,
  target: PoolClient,
  accountIdMap: ReadonlyMap<string, string>,
): Promise<Record<string, number>> {
  const copied: Record<string, number> = {};
  await target.query(
    `truncate table ${SHADOW_REPLACE_TABLES.map(quoteIdentifier).join(
      ", ",
    )} restart identity`,
  );
  for (const table of SHADOW_INSERT_ORDER) {
    const columns = await loadCommonTableColumns(source, target, table);
    let rows = await loadTableRows(source, table);
    if (table === "shadow_accounts") {
      await assertTargetUsersExist(target, rows, "shadow accounts");
      rows = remapShadowAccountBrokerIds(rows, accountIdMap);
    }
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
  execute: boolean,
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

  const [
    sourceBrokerAccounts,
    sourceBrokerConnections,
    targetBrokerAccounts,
    targetBrokerConnections,
    brokerAccountColumns,
  ] = await Promise.all([
    loadTableRows(source, "broker_accounts"),
    loadTableRows(source, "broker_connections"),
    loadTableRows(target, "broker_accounts"),
    loadTableRows(target, "broker_connections"),
    loadCommonTableColumns(source, target, "broker_accounts"),
  ]);
  assertColumnsPresent("broker_accounts", brokerAccountColumns, [
    "connection_id",
    "provider_account_id",
    "display_name",
    "mode",
  ]);
  await assertTargetUsersExist(target, sourceBrokerAccounts, "broker accounts");
  buildBrokerAccountRows(
    sourceBrokerAccounts,
    sourceBrokerConnections,
    targetBrokerAccounts,
    targetBrokerConnections,
  );
  const flexReportColumns = await loadCommonTableColumns(
    source,
    target,
    "flex_report_runs",
  );
  assertColumnsPresent("flex_report_runs", flexReportColumns, [
    "id",
    "reference_code",
  ]);
  for (const spec of FLEX_TABLES) {
    const columns = await loadCommonTableColumns(source, target, spec.table);
    assertColumnsPresent(spec.table, columns, spec.conflictColumns);
  }
  const sourceShadowAccounts = await loadTableRows(source, "shadow_accounts");
  await assertTargetUsersExist(target, sourceShadowAccounts, "shadow accounts");
  const existingAccountIdMap = await loadTargetAccountIdMap(
    target,
    sourceBrokerAccounts,
  );
  const sourceBalanceRows = await loadSourceBalanceRows(source);
  const plannedBalanceRows = await buildBalanceInsertRows(
    target,
    sourceBalanceRows,
    existingAccountIdMap,
  );

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
          : sourceBrokerAccounts.length,
      targetRows: await loadTableCount(target, table),
      action:
        table === "balance_snapshots"
          ? `insert_missing=${plannedBalanceRows.rows.length}, unmapped=${plannedBalanceRows.unmappedRows}`
          : "upsert_by_app_user_and_provider_account_id",
    });
  }

  for (const table of [
    "flex_report_runs",
    ...FLEX_TABLES.map((spec) => spec.table),
  ]) {
    rowCounts.push({
      table,
      sourceRows: await loadTableCount(source, table),
      targetRows: await loadTableCount(target, table),
      action:
        table === "flex_report_runs"
          ? "upsert_by_reference_code"
          : "upsert_by_natural_key",
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
    console.log(
      "Pass --execute to create a Helium backup schema and apply recovery.",
    );
  }
}

function assertSafeUrls(): void {
  if (!sourceDatabaseUrl) {
    throw new Error("SOURCE_DATABASE_URL is required.");
  }
  if (!targetDatabaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }
  if (sourceDatabaseUrl === targetDatabaseUrl) {
    throw new Error(
      "SOURCE_DATABASE_URL and DATABASE_URL must not be identical.",
    );
  }
  if (!targetUrlLooksLikeHelium(targetDatabaseUrl)) {
    throw new Error(
      "Refusing to run: DATABASE_URL must be postgresql://...@helium/heliumdb...",
    );
  }
}

async function assertSafeConnections(
  source: PoolClient,
  target: PoolClient,
): Promise<{
  sourceFingerprint: DatabaseFingerprint;
  targetFingerprint: DatabaseFingerprint;
}> {
  const [sourceFingerprint, targetFingerprint] = await Promise.all([
    loadFingerprint(source),
    loadFingerprint(target),
  ]);

  if (targetFingerprint.database_name !== "heliumdb") {
    throw new Error(
      `Refusing to run: target database is ${targetFingerprint.database_name}, not heliumdb.`,
    );
  }

  if (
    databaseIdentity(sourceFingerprint) === databaseIdentity(targetFingerprint)
  ) {
    throw new Error(
      "Refusing to run: source and target resolved to the same database.",
    );
  }

  return { sourceFingerprint, targetFingerprint };
}

async function recover(source: PoolClient, target: PoolClient): Promise<void> {
  await target.query("begin transaction isolation level repeatable read");
  try {
    const backupSchema = await createBackupSchema(target);
    console.log(`backup_schema=${backupSchema}`);

    const brokerAccounts = await recoverBrokerAccounts(source, target);
    const balances = await recoverBalanceSnapshots(
      source,
      target,
      brokerAccounts.accountIdMap,
    );
    const flex = await recoverFlexTables(source, target);
    const shadow = await replaceShadowTables(
      source,
      target,
      brokerAccounts.accountIdMap,
    );

    await target.query("commit");
    console.log("recovery_complete=true");
    console.log("broker_accounts_upserted", brokerAccounts.upserted);
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
  const { execute } = parseRecoveryArgs(process.argv.slice(2));
  assertSafeUrls();
  const sourcePool = new Pool({ connectionString: sourceDatabaseUrl, max: 2 });
  const targetPool = new Pool({ connectionString: targetDatabaseUrl, max: 2 });
  let source: PoolClient | undefined;
  let target: PoolClient | undefined;
  let sourceTransactionOpen = false;

  try {
    source = await sourcePool.connect();
    target = await targetPool.connect();
    await source.query(
      "begin transaction isolation level repeatable read read only",
    );
    sourceTransactionOpen = true;
    const { sourceFingerprint, targetFingerprint } =
      await assertSafeConnections(source, target);
    await printPlan(
      source,
      target,
      sourceFingerprint,
      targetFingerprint,
      execute,
    );
    if (execute) {
      await recover(source, target);
    }
  } finally {
    try {
      if (sourceTransactionOpen && source) {
        await source.query("rollback");
      }
    } finally {
      source?.release();
      target?.release();
      await Promise.all([sourcePool.end(), targetPool.end()]);
    }
  }
}

export const __accountDataRecoveryInternalsForTests = {
  FLEX_TABLES,
  buildBalanceInsertRows,
  buildBrokerAccountRows,
  databaseIdentity,
  dedupeRows,
  insertRows,
  parseRecoveryArgs,
  recoverFlexReportRuns,
  remapShadowAccountBrokerIds,
  remapSourceRunIds,
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
