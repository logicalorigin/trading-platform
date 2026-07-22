import assert from "node:assert/strict";
import test from "node:test";

import pg from "pg";

const runtimeEnvKeys = [
  "DATABASE_URL",
  "LOCAL_DATABASE_URL",
  "PGHOST",
  "PGDATABASE",
  "PGUSER",
  "PGPASSWORD",
  "PGPORT",
  "PGSSLMODE",
  "PGOPTIONS",
  "PYRUS_DATABASE_SOURCE",
  "PYRUS_DB_PROFILE",
  "DB_POOL_MAX",
  "DB_CONNECTION_TIMEOUT_MS",
  "DB_STATEMENT_TIMEOUT_MS",
  "DB_IDLE_TX_TIMEOUT_MS",
  "DB_QUERY_TIMEOUT_MS",
  "DB_IDLE_TIMEOUT_MS",
  "DB_TRADING_POOL_MAX",
  "DB_AUTH_POOL_MAX",
] as const;

test("Helium construction enforces pool policy and redirects every test database lane", async () => {
  const previousEnv = new Map(
    runtimeEnvKeys.map((key) => [key, process.env[key]] as const),
  );
  for (const key of runtimeEnvKeys) {
    delete process.env[key];
  }
  Object.assign(process.env, {
    DATABASE_URL:
      "postgres://runner:runtime-test-only@helium/pyrus_runtime_test?application_name=url-app&statement_timeout=0&query_timeout=7&idle_in_transaction_session_timeout=0&options=-c%20statement_timeout%3D0",
    PGHOST: "helium",
    PGDATABASE: "pyrus_runtime_test",
    PGUSER: "runner",
    PGPASSWORD: "runtime-test-only",
    PGPORT: "5432",
    PGSSLMODE: "require",
    PGOPTIONS:
      "-c statement_timeout=0 -c idle_in_transaction_session_timeout=0",
    DB_POOL_MAX: "0.5",
    DB_CONNECTION_TIMEOUT_MS: "2147483648",
    DB_STATEMENT_TIMEOUT_MS: "0.5",
    DB_IDLE_TX_TIMEOUT_MS: "0.5",
  });

  let pools: Awaited<typeof import("./index")> | null = null;
  try {
    pools = await import("./index");
    assert.equal(pools.pool.options.max, 12);
    assert.equal(pools.pool.options.ssl, false);
    assert.equal(pools.pool.options.keepAlive, true);
    assert.equal(pools.pool.options.connectionTimeoutMillis, 30_000);
    assert.equal(pools.pool.options.statement_timeout, 15_000);
    assert.equal(
      pools.pool.options.idle_in_transaction_session_timeout,
      10_000,
    );

    for (const [
      name,
      targetPool,
      expectedStatementTimeout,
      expectedAppName,
    ] of [
      ["shared", pools.pool, 15_000, "pyrus-app"],
      ["trading", pools.tradingPool, 5_000, "pyrus-api-trading"],
      ["auth", pools.authPool, 5_000, "pyrus-api-auth"],
    ] as const) {
      const client = new pg.Client(targetPool.options);
      const connectionParameters = (
        client as unknown as {
          connectionParameters: Record<string, unknown>;
        }
      ).connectionParameters;
      assert.equal(client.ssl, false, name);
      assert.equal(
        connectionParameters["statement_timeout"],
        expectedStatementTimeout,
        name,
      );
      assert.equal(
        connectionParameters["idle_in_transaction_session_timeout"],
        10_000,
        name,
      );
      assert.equal(
        connectionParameters["application_name"],
        expectedAppName,
        name,
      );
      assert.equal(connectionParameters["query_timeout"], false, name);
      assert.equal(
        connectionParameters["options"],
        "-c idle_in_transaction_session_timeout=10000",
        name,
      );
    }

    const testDatabase = { lane: "pglite-test" } as never;
    const restoreDatabase = pools.__setDbForTests(testDatabase);
    try {
      for (const [name, database] of [
        ["shared", pools.db],
        ["trading", pools.dbTrading],
        ["auth", pools.dbAuth],
      ] as const) {
        assert.equal(
          (database as unknown as { lane?: string }).lane,
          "pglite-test",
          name,
        );
      }
    } finally {
      restoreDatabase();
    }
  } finally {
    if (pools) {
      await Promise.all([
        pools.pool.end(),
        pools.tradingPool.end(),
        pools.authPool.end(),
      ]);
    }
    for (const [key, value] of previousEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});
