import assert from "node:assert/strict";
import test from "node:test";
import { __accountDataRecoveryInternalsForTests as recovery } from "./account-data-recovery";

const now = new Date("2026-07-13T00:00:00.000Z");

test("FLEX open-position recovery keeps distinct contracts at the same symbol and time", () => {
  const spec = recovery.FLEX_TABLES.find(
    (candidate) => candidate.table === "flex_open_positions",
  );
  assert.deepEqual(spec?.conflictColumns, [
    "provider_account_id",
    "symbol",
    "as_of",
    "contract_key",
  ]);

  const rows = recovery.dedupeRows(
    [
      {
        provider_account_id: "account-1",
        symbol: "SPY",
        as_of: now,
        contract_key: "option-1",
      },
      {
        provider_account_id: "account-1",
        symbol: "SPY",
        as_of: now,
        contract_key: "option-2",
      },
    ],
    spec?.conflictColumns ?? [],
  );

  assert.equal(rows.length, 2);
});

test("balance recovery does not collapse otherwise-identical snapshots in different currencies", async () => {
  const target = {
    async query() {
      return {
        rows: [
          {
            account_id: "target-account",
            currency: "USD",
            as_of: now,
            cash: "100",
            buying_power: "200",
            net_liquidation: "300",
          },
        ],
      };
    },
  };

  const result = await recovery.buildBalanceInsertRows(
    target as never,
    [
      {
        source_account_id: "source-account",
        currency: "EUR",
        cash: "100",
        buying_power: "200",
        net_liquidation: "300",
        maintenance_margin: null,
        as_of: now,
        created_at: now,
        updated_at: now,
      },
    ],
    new Map([["source-account", "target-account"]]),
  );

  assert.equal(result.unmappedRows, 0);
  assert.deepEqual(
    result.rows.map((row) => row.currency),
    ["EUR"],
  );
});

test("balance recovery preserves maintenance-margin-only snapshot changes", async () => {
  const target = {
    async query() {
      return {
        rows: [
          {
            account_id: "target-account",
            currency: "USD",
            as_of: now,
            cash: "100",
            buying_power: "200",
            net_liquidation: "300",
            maintenance_margin: "40",
          },
        ],
      };
    },
  };

  const result = await recovery.buildBalanceInsertRows(
    target as never,
    [
      {
        source_account_id: "source-account",
        currency: "USD",
        cash: "100",
        buying_power: "200",
        net_liquidation: "300",
        maintenance_margin: "50",
        as_of: now,
        created_at: now,
        updated_at: now,
      },
    ],
    new Map([["source-account", "target-account"]]),
  );

  assert.deepEqual(
    result.rows.map((row) => row.maintenance_margin),
    ["50"],
  );
});

test("database sameness identity is independent of the login role", () => {
  const base = {
    database_name: "heliumdb",
    database_bytes: "100",
    server_addr: "127.0.0.1",
    server_port: "5432",
    server_version: "17",
  };

  assert.equal(
    recovery.databaseIdentity({ ...base, user_name: "source_reader" }),
    recovery.databaseIdentity({ ...base, user_name: "target_writer" }),
  );
});

test("recovery CLI accepts only dry-run or one explicit execute flag", () => {
  assert.deepEqual(recovery.parseRecoveryArgs([]), { execute: false });
  assert.deepEqual(recovery.parseRecoveryArgs(["--execute"]), {
    execute: true,
  });
  assert.throws(
    () => recovery.parseRecoveryArgs(["--execute", "--force"]),
    /Usage: account-data-recovery \[--execute\]/,
  );
  assert.throws(
    () => recovery.parseRecoveryArgs(["--execute", "--execute"]),
    /Usage: account-data-recovery \[--execute\]/,
  );
});

test("broker-account recovery resolves duplicate provider IDs within each user scope", () => {
  const rows = recovery.buildBrokerAccountRows(
    [
      {
        id: "source-account-1",
        app_user_id: "user-1",
        connection_id: "source-connection-1",
        provider_account_id: "shared-provider-id",
      },
      {
        id: "source-account-2",
        app_user_id: "user-2",
        connection_id: "source-connection-2",
        provider_account_id: "shared-provider-id",
      },
    ],
    [
      {
        id: "source-connection-1",
        app_user_id: "user-1",
        connection_type: "broker",
        mode: "paper",
        name: "SnapTrade",
      },
      {
        id: "source-connection-2",
        app_user_id: "user-2",
        connection_type: "broker",
        mode: "paper",
        name: "SnapTrade",
      },
    ],
    [],
    [
      {
        id: "target-connection-1",
        app_user_id: "user-1",
        connection_type: "broker",
        mode: "paper",
        name: "SnapTrade",
      },
      {
        id: "target-connection-2",
        app_user_id: "user-2",
        connection_type: "broker",
        mode: "paper",
        name: "SnapTrade",
      },
    ],
  );

  assert.deepEqual(
    rows.map((row) => [row.id, row.connection_id]),
    [
      ["source-account-1", "target-connection-1"],
      ["source-account-2", "target-connection-2"],
    ],
  );
});

test("broker-account recovery rejects duplicate identities inside the source", () => {
  assert.throws(
    () =>
      recovery.buildBrokerAccountRows(
        [
          {
            id: "source-account-1",
            app_user_id: "user-1",
            connection_id: "source-connection-1",
            provider_account_id: "provider-account",
          },
          {
            id: "source-account-2",
            app_user_id: "user-1",
            connection_id: "source-connection-1",
            provider_account_id: "provider-account",
          },
        ],
        [
          {
            id: "source-connection-1",
            app_user_id: "user-1",
            connection_type: "broker",
            mode: "paper",
            name: "SnapTrade",
          },
        ],
        [],
        [
          {
            id: "target-connection-1",
            app_user_id: "user-1",
            connection_type: "broker",
            mode: "paper",
            name: "SnapTrade",
          },
        ],
      ),
    /Ambiguous source broker account identity/,
  );
});

test("broker-account recovery rejects a mismatched existing target connection", () => {
  assert.throws(
    () =>
      recovery.buildBrokerAccountRows(
        [
          {
            id: "source-account",
            app_user_id: "user-1",
            connection_id: "source-connection",
            provider_account_id: "provider-account",
          },
        ],
        [
          {
            id: "source-connection",
            app_user_id: "user-1",
            connection_type: "broker",
            mode: "paper",
            name: "SnapTrade",
          },
        ],
        [
          {
            id: "target-account",
            app_user_id: "user-1",
            connection_id: "target-other-connection",
            provider_account_id: "provider-account",
          },
        ],
        [
          {
            id: "target-other-connection",
            app_user_id: "user-1",
            connection_type: "broker",
            mode: "paper",
            name: "Other",
          },
        ],
      ),
    /Existing target broker connection does not match source account id=source-account/,
  );
});

test("partial unique-index predicates are emitted in broker-account upserts", async () => {
  const statements: string[] = [];
  const client = {
    async query(statement: string) {
      statements.push(statement);
      return { rows: [] };
    },
  };

  await recovery.insertRows(
    client as never,
    "broker_accounts",
    ["provider_account_id", "display_name"],
    [{ provider_account_id: "account-1", display_name: "Primary" }],
    {
      conflictColumns: ["provider_account_id"],
      conflictPredicate: { column: "app_user_id", isNull: true },
      updateColumns: ["display_name"],
    },
  );

  assert.match(
    statements[0] ?? "",
    /on conflict \("provider_account_id"\) where "app_user_id" is null do update/,
  );
});

test("FLEX report-run lookup does not widen an empty selector to every target row", async () => {
  const sourceQueries: string[] = [];
  const source = {
    async query(statement: string) {
      sourceQueries.push(statement);
      if (statement.includes("information_schema.columns")) {
        return {
          rows: [{ column_name: "id" }, { column_name: "reference_code" }],
        };
      }
      return {
        rows: [
          {
            id: "00000000-0000-0000-0000-000000000001",
            reference_code: "reference-1",
          },
        ],
      };
    },
  };
  let lookupStatement = "";
  let lookupValues: unknown[] | undefined;
  const target = {
    async query(statement: string, values?: unknown[]) {
      if (statement.includes("information_schema.columns")) {
        return {
          rows: [{ column_name: "id" }, { column_name: "reference_code" }],
        };
      }
      if (statement.startsWith("insert into")) {
        return { rows: [] };
      }
      lookupStatement = statement;
      lookupValues = values;
      return {
        rows: [
          {
            id: "00000000-0000-0000-0000-000000000002",
            reference_code: "reference-1",
          },
        ],
      };
    },
  };

  const map = await recovery.recoverFlexReportRuns(
    source as never,
    target as never,
  );

  assert.equal(sourceQueries.length, 2);
  assert.doesNotMatch(lookupStatement, /= '\{\}'/);
  assert.deepEqual(lookupValues, [["reference-1"], []]);
  assert.equal(
    map.get("00000000-0000-0000-0000-000000000001"),
    "00000000-0000-0000-0000-000000000002",
  );
});

test("FLEX child rows fail closed when their source report run was not recovered", () => {
  assert.throws(
    () =>
      recovery.remapSourceRunIds(
        [{ id: "trade-1", source_run_id: "missing-run" }],
        new Map(),
      ),
    /No recovered FLEX report run maps source_run_id=missing-run/,
  );
});

test("shadow-account broker references are remapped to recovered target account IDs", () => {
  assert.deepEqual(
    recovery.remapShadowAccountBrokerIds(
      [
        {
          id: "shadow-user-1",
          source_broker_account_id: "source-account-1",
        },
      ],
      new Map([["source-account-1", "target-account-1"]]),
    ),
    [
      {
        id: "shadow-user-1",
        source_broker_account_id: "target-account-1",
      },
    ],
  );
});
