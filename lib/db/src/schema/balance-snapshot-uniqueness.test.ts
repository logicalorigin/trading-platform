import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const schemaSource = readFileSync(new URL("./trading.ts", import.meta.url), "utf8");
const migrationSource = readFileSync(
  new URL(
    "../../migrations/20260716_balance_snapshots_account_as_of_unique.sql",
    import.meta.url,
  ),
  "utf8",
);

test("balance snapshot account-time uniqueness stays in schema and migration", () => {
  assert.match(
    schemaSource,
    /uniqueIndex\("balance_snapshots_account_as_of_unique_idx"\)[\s\S]*table\.accountId[\s\S]*table\.asOf/,
  );
  assert.match(migrationSource, /\bBEGIN;/);
  assert.match(
    migrationSource,
    /LOCK TABLE balance_snapshots IN SHARE ROW EXCLUSIVE MODE/i,
  );
  assert.match(
    migrationSource,
    /PARTITION BY account_id, as_of[\s\S]*ORDER BY updated_at DESC, created_at DESC, id DESC/i,
  );
  assert.match(
    migrationSource,
    /balance_snapshots_duplicate_archive_20260716[\s\S]*duplicate_rank/i,
  );
  assert.match(
    migrationSource,
    /CREATE UNIQUE INDEX IF NOT EXISTS balance_snapshots_account_as_of_unique_idx[\s\S]*ON balance_snapshots \(account_id, as_of\)/i,
  );
  assert.match(migrationSource.trim(), /COMMIT;$/);
});

test("balance snapshot migration keeps the newest duplicate and prevents recurrence", async () => {
  const client = new PGlite();
  try {
    await client.exec(`
      CREATE TABLE balance_snapshots (
        id uuid PRIMARY KEY,
        account_id uuid NOT NULL,
        currency text NOT NULL,
        cash numeric NOT NULL,
        buying_power numeric NOT NULL,
        net_liquidation numeric NOT NULL,
        maintenance_margin numeric,
        as_of timestamptz NOT NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      );
      INSERT INTO balance_snapshots (
        id, account_id, currency, cash, buying_power, net_liquidation,
        maintenance_margin, as_of, created_at, updated_at
      ) VALUES
        (
          '00000000-0000-4000-8000-000000000001',
          '00000000-0000-4000-8000-000000000011',
          'USD', 0, 0, 100, NULL,
          '2026-07-16T12:00:00Z', '2026-07-16T12:01:00Z', '2026-07-16T12:01:00Z'
        ),
        (
          '00000000-0000-4000-8000-000000000002',
          '00000000-0000-4000-8000-000000000011',
          'USD', 0, 0, 125, NULL,
          '2026-07-16T12:00:00Z', '2026-07-16T12:02:00Z', '2026-07-16T12:02:00Z'
        );
    `);

    await client.exec(migrationSource);

    const rows = await client.query<{ id: string; net_liquidation: string }>(`
      SELECT id, net_liquidation::text
      FROM balance_snapshots
    `);
    assert.deepEqual(rows.rows, [
      {
        id: "00000000-0000-4000-8000-000000000002",
        net_liquidation: "125",
      },
    ]);
    const archived = await client.query<{
      id: string;
      net_liquidation: string;
      duplicate_rank: number;
    }>(`
      SELECT id, net_liquidation::text, duplicate_rank
      FROM balance_snapshots_duplicate_archive_20260716
    `);
    assert.deepEqual(archived.rows, [
      {
        id: "00000000-0000-4000-8000-000000000001",
        net_liquidation: "100",
        duplicate_rank: 2,
      },
    ]);
    await assert.rejects(
      client.exec(`
        INSERT INTO balance_snapshots (
          id, account_id, currency, cash, buying_power, net_liquidation,
          maintenance_margin, as_of, created_at, updated_at
        ) VALUES (
          '00000000-0000-4000-8000-000000000003',
          '00000000-0000-4000-8000-000000000011',
          'USD', 0, 0, 130, NULL,
          '2026-07-16T12:00:00Z', '2026-07-16T12:03:00Z', '2026-07-16T12:03:00Z'
        )
      `),
      /balance_snapshots_account_as_of_unique_idx/,
    );
  } finally {
    await client.close();
  }
});
