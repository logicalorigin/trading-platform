import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  new URL(
    "../../migrations/20260720_broker_order_mutation_journal.sql",
    import.meta.url,
  ),
  "utf8",
);

test("broker mutation migration keeps one unresolved account action and releases resolved rows", async () => {
  const client = new PGlite();
  try {
    await client.exec(`
      CREATE TYPE broker_provider AS ENUM ('snaptrade');
      CREATE TABLE users (id uuid PRIMARY KEY);
      CREATE TABLE broker_accounts (id uuid PRIMARY KEY);
      INSERT INTO users VALUES ('00000000-0000-4000-8000-000000000001');
      INSERT INTO broker_accounts VALUES (
        '00000000-0000-4000-8000-000000000011'
      );
    `);
    await client.exec(migration);

    const unresolvedInsert = `
      INSERT INTO broker_order_mutations (
        app_user_id, account_id, provider, operation
      ) VALUES (
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000011',
        'snaptrade',
        'submit'
      )
    `;
    await client.exec(unresolvedInsert);
    await assert.rejects(
      client.exec(unresolvedInsert),
      /broker_order_mutations_unresolved_account_idx/,
    );

    await client.exec(`
      UPDATE broker_order_mutations
      SET status = 'succeeded', resolved_at = now()
      WHERE operation = 'submit'
    `);
    await client.exec(
      unresolvedInsert.replace("'submit'", "'cancel'"),
    );

    const rows = await client.query<{ operation: string; status: string }>(`
      SELECT operation, status
      FROM broker_order_mutations
      ORDER BY operation
    `);
    assert.deepEqual(rows.rows, [
      { operation: "cancel", status: "inflight" },
      { operation: "submit", status: "succeeded" },
    ]);
    await assert.rejects(
      client.exec(`
        UPDATE broker_order_mutations
        SET status = 'rejected', resolved_at = NULL
        WHERE operation = 'cancel'
      `),
      /broker_order_mutations_resolution_chk/,
    );
  } finally {
    await client.close();
  }
});
