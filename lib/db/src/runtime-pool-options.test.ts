import assert from "node:assert/strict";
import test from "node:test";

const runtimeEnvKeys = [
  "DATABASE_URL",
  "LOCAL_DATABASE_URL",
  "PGHOST",
  "PGDATABASE",
  "PGUSER",
  "PGPASSWORD",
  "PGPORT",
  "PGSSLMODE",
  "PYRUS_DATABASE_SOURCE",
  "PYRUS_DB_PROFILE",
  "DB_POOL_MAX",
  "DB_CONNECTION_TIMEOUT_MS",
  "DB_STATEMENT_TIMEOUT_MS",
] as const;

test("PGHOST Helium classification preserves Helium pool options", async () => {
  const previousEnv = new Map(
    runtimeEnvKeys.map((key) => [key, process.env[key]] as const),
  );
  for (const key of runtimeEnvKeys) {
    delete process.env[key];
  }
  Object.assign(process.env, {
    PGHOST: "helium",
    PGDATABASE: "pyrus_runtime_test",
    PGUSER: "runner",
    PGPASSWORD: "runtime-test-only",
    PGPORT: "5432",
  });

  let pools: Awaited<typeof import("./index")> | null = null;
  try {
    pools = await import("./index");
    assert.equal(pools.pool.options.max, 12);
    assert.equal(pools.pool.options.ssl, false);
    assert.equal(pools.pool.options.keepAlive, true);
    assert.equal(pools.pool.options.connectionTimeoutMillis, 30_000);
    assert.equal(pools.pool.options.statement_timeout, 15_000);
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
