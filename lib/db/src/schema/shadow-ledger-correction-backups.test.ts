import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migrationSource = readFileSync(
  new URL(
    "../../migrations/20260722_shadow_ledger_correction_backups.sql",
    import.meta.url,
  ),
  "utf8",
);

test("ledger correction backup migration is idempotent and preserves original rows", async () => {
  const client = new PGlite();
  try {
    await client.exec(migrationSource);
    await client.exec(migrationSource);
    await client.exec(`
      INSERT INTO shadow_ledger_correction_backups (
        correction_id, table_name, row_id, row_data
      ) VALUES (
        '00000000-0000-4000-8000-000000000001',
        'shadow_positions',
        'position-1',
        '{"status":"open"}'::jsonb
      )
      ON CONFLICT DO NOTHING;
    `);
    const result = await client.query<{
      table_name: string;
      row_id: string;
      row_data: { status: string };
    }>(`
      SELECT table_name, row_id, row_data
      FROM shadow_ledger_correction_backups
    `);
    assert.deepEqual(result.rows, [
      {
        table_name: "shadow_positions",
        row_id: "position-1",
        row_data: { status: "open" },
      },
    ]);
  } finally {
    await client.close();
  }
});
