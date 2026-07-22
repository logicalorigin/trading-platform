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
  "PGOPTIONS",
  "PYRUS_DATABASE_SOURCE",
  "PYRUS_DB_PROFILE",
  "DB_CONNECTION_TIMEOUT_MS",
] as const;

test("external database pools retain a bounded default acquire timeout", async () => {
  const previousEnv = new Map(
    runtimeEnvKeys.map((key) => [key, process.env[key]] as const),
  );
  for (const key of runtimeEnvKeys) {
    delete process.env[key];
  }
  process.env.DATABASE_URL =
    "postgres://runner@db.example.invalid/pyrus_runtime_test";

  let pools: Awaited<typeof import("./index")> | null = null;
  try {
    pools = await import("./index");
    for (const [name, targetPool] of [
      ["shared", pools.pool],
      ["trading", pools.tradingPool],
      ["auth", pools.authPool],
    ] as const) {
      assert.equal(targetPool.options.connectionTimeoutMillis, 30_000, name);
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
