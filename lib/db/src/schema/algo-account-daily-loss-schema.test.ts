import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { getTableConfig } from "drizzle-orm/pg-core";

import { algoAccountControlsTable } from "./automation";

const migrationUrl = new URL(
  "../../migrations/20260722_algo_account_daily_loss.sql",
  import.meta.url,
);

function column(name: string) {
  return getTableConfig(algoAccountControlsTable).columns.find(
    (candidate) => candidate.name === name,
  );
}

test("account controls persist an optional account-wide realized-options daily-loss limit", () => {
  const config = getTableConfig(algoAccountControlsTable);

  assert.equal(column("daily_loss_limit_usd")?.notNull, false);
  assert.equal(column("daily_loss_scope")?.notNull, true);
  assert.ok(
    config.checks.some(
      (constraint) =>
        constraint.name === "algo_account_controls_daily_loss_limit_chk",
    ),
  );
  assert.ok(
    config.checks.some(
      (constraint) =>
        constraint.name === "algo_account_controls_daily_loss_scope_chk",
    ),
  );
});

test("daily-loss migration is idempotent, leaves legacy controls unset, and never arms targets", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const client = new PGlite();
  try {
    await client.exec(`
      CREATE TABLE algo_account_controls (
        id uuid PRIMARY KEY
      );
      INSERT INTO algo_account_controls (id)
      VALUES ('00000000-0000-4000-8000-000000000001');
    `);

    await client.exec(sql);
    await assert.doesNotReject(client.exec(sql));

    const controls = await client.query<{
      daily_loss_limit_usd: string | null;
      daily_loss_scope: string;
    }>(`
      SELECT daily_loss_limit_usd::text, daily_loss_scope
      FROM algo_account_controls
    `);
    assert.deepEqual(controls.rows, [
      {
        daily_loss_limit_usd: null,
        daily_loss_scope: "account_options_realized",
      },
    ]);
    assert.doesNotMatch(sql, /execution_enabled\s*=\s*true/i);
    assert.doesNotMatch(sql, /delete\s+from/i);
    assert.doesNotMatch(sql, /drop\s+table/i);
  } finally {
    await client.close();
  }
});
