import assert from "node:assert/strict";
import test from "node:test";

test("shared Postgres pool installs an error listener during module initialization", async () => {
  const previousDatabaseUrl = process.env["DATABASE_URL"];
  process.env["DATABASE_URL"] =
    "postgres://test:test@helium:5432/heliumdb?sslmode=disable";

  try {
    const { pool } = await import("./index");
    assert.equal(pool.listenerCount("error") > 0, true);
    await pool.end();
  } finally {
    if (previousDatabaseUrl === undefined) {
      delete process.env["DATABASE_URL"];
    } else {
      process.env["DATABASE_URL"] = previousDatabaseUrl;
    }
  }
});
