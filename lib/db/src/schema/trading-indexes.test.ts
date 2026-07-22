import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const schemaSource = readFileSync(
  new URL("./trading.ts", import.meta.url),
  "utf8",
);
const migrationSource = readFileSync(
  new URL(
    "../../migrations/20260629_shadow_account_stream_indexes.sql",
    import.meta.url,
  ),
  "utf8",
);
const peakMigrationSource = readFileSync(
  new URL(
    "../../migrations/20260629_shadow_position_marks_peak_idx.sql",
    import.meta.url,
  ),
  "utf8",
);
const idempotencyMigrationSource = readFileSync(
  new URL(
    "../../migrations/20260709_shadow_order_idempotency_account_scope.sql",
    import.meta.url,
  ),
  "utf8",
);
const fillSequenceMigrationSource = readFileSync(
  new URL(
    "../../migrations/20260718_shadow_fills_ledger_sequence.sql",
    import.meta.url,
  ),
  "utf8",
);

const requiredIndexes = [
  "shadow_orders_account_placed_at_idx",
  "shadow_orders_account_asset_side_symbol_placed_at_idx",
  "shadow_fills_account_occurred_at_idx",
  "shadow_balance_snapshots_account_as_of_idx",
] as const;

test("shadow account stream hot-path indexes stay in schema and migration", () => {
  for (const indexName of requiredIndexes) {
    assert.match(schemaSource, new RegExp(`index\\("${indexName}"\\)`));
    assert.match(
      migrationSource,
      new RegExp(`CREATE INDEX CONCURRENTLY IF NOT EXISTS ${indexName}`, "i"),
    );
  }

  assert.match(
    schemaSource,
    /shadow_orders_account_placed_at_idx"[\s\S]*table\.accountId[\s\S]*table\.placedAt\.desc\(\)/,
  );
  assert.match(
    schemaSource,
    /shadow_balance_snapshots_account_as_of_idx"[\s\S]*table\.accountId[\s\S]*table\.asOf/,
  );
  assert.match(
    migrationSource,
    /ON shadow_orders \(account_id, placed_at DESC\)/i,
  );
  assert.match(
    migrationSource,
    /ON shadow_balance_snapshots \(account_id, as_of\)/i,
  );
});

test("shadow position mark peak lookup index stays in schema and migration", () => {
  assert.match(
    schemaSource,
    /shadow_position_marks_position_mark_idx"[\s\S]*table\.positionId[\s\S]*table\.mark\.desc\(\)/,
  );
  assert.match(
    peakMigrationSource,
    /CREATE INDEX CONCURRENTLY IF NOT EXISTS shadow_position_marks_position_mark_idx/i,
  );
  assert.match(
    peakMigrationSource,
    /ON shadow_position_marks \(position_id, mark DESC\)/i,
  );
});

test("shadow order idempotency is unique within each account", () => {
  assert.match(
    schemaSource,
    /shadow_orders_account_source_event_idx"[\s\S]*table\.accountId[\s\S]*table\.sourceEventId/,
  );
  assert.match(
    schemaSource,
    /shadow_orders_account_client_order_idx"[\s\S]*table\.accountId[\s\S]*table\.clientOrderId/,
  );
  assert.match(
    schemaSource,
    /shadow_fills_account_source_event_idx"[\s\S]*table\.accountId[\s\S]*table\.sourceEventId/,
  );
  assert.doesNotMatch(schemaSource, /shadow_orders_source_event_idx/);
  assert.doesNotMatch(schemaSource, /shadow_orders_client_order_idx/);
  assert.doesNotMatch(schemaSource, /shadow_fills_source_event_idx/);

  assert.match(
    idempotencyMigrationSource,
    /CREATE UNIQUE INDEX IF NOT EXISTS shadow_orders_account_source_event_idx[\s\S]*ON shadow_orders \(account_id, source_event_id\)/i,
  );
  assert.match(
    idempotencyMigrationSource,
    /CREATE UNIQUE INDEX IF NOT EXISTS shadow_orders_account_client_order_idx[\s\S]*ON shadow_orders \(account_id, client_order_id\)/i,
  );
  assert.match(
    idempotencyMigrationSource,
    /CREATE UNIQUE INDEX IF NOT EXISTS shadow_fills_account_source_event_idx[\s\S]*ON shadow_fills \(account_id, source_event_id\)/i,
  );
  assert.match(
    idempotencyMigrationSource,
    /DROP INDEX IF EXISTS shadow_orders_source_event_idx/i,
  );
  assert.match(
    idempotencyMigrationSource,
    /DROP INDEX IF EXISTS shadow_orders_client_order_idx/i,
  );
  assert.match(
    idempotencyMigrationSource,
    /DROP INDEX IF EXISTS shadow_fills_source_event_idx/i,
  );
});

test("shadow fill causal sequence stays in schema and migration", () => {
  assert.match(
    schemaSource,
    /ledgerSequence:\s*bigserial\("ledger_sequence",\s*\{\s*mode:\s*"number"\s*\}\)\.notNull\(\)/,
  );
  assert.match(
    schemaSource,
    /uniqueIndex\("shadow_fills_ledger_sequence_idx"\)\.on\(table\.ledgerSequence\)/,
  );
  assert.match(fillSequenceMigrationSource, /\bBEGIN;/);
  assert.match(
    fillSequenceMigrationSource,
    /LOCK TABLE shadow_fills IN ACCESS EXCLUSIVE MODE/i,
  );
  assert.match(
    fillSequenceMigrationSource,
    /ORDER BY account_id, occurred_at, created_at, id/i,
  );
  assert.match(
    fillSequenceMigrationSource,
    /CREATE UNIQUE INDEX IF NOT EXISTS shadow_fills_ledger_sequence_idx[\s\S]*ON shadow_fills \(ledger_sequence\)/i,
  );
  assert.match(fillSequenceMigrationSource.trim(), /COMMIT;$/);
});

test("shadow fill sequence migration preserves causal sequence when rerun after a delayed fill", async () => {
  const client = new PGlite();
  try {
    await client.exec(`
      CREATE TABLE shadow_fills (
        id uuid PRIMARY KEY,
        account_id varchar(64) NOT NULL,
        occurred_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL
      );
      INSERT INTO shadow_fills (id, account_id, occurred_at, created_at)
      VALUES
        (
          '00000000-0000-4000-8000-000000000002',
          'shadow',
          '2026-07-18T12:00:00Z',
          '2026-07-18T12:00:00Z'
        ),
        (
          '00000000-0000-4000-8000-000000000001',
          'shadow',
          '2026-07-18T12:00:00Z',
          '2026-07-18T12:00:00Z'
        );
    `);

    await client.exec(fillSequenceMigrationSource);

    const backfilled = await client.query<{
      id: string;
      ledger_sequence: string;
    }>(`
      SELECT id, ledger_sequence::text
      FROM shadow_fills
      ORDER BY ledger_sequence
    `);
    assert.deepEqual(backfilled.rows, [
      {
        id: "00000000-0000-4000-8000-000000000001",
        ledger_sequence: "1",
      },
      {
        id: "00000000-0000-4000-8000-000000000002",
        ledger_sequence: "2",
      },
    ]);

    await client.exec(`
      INSERT INTO shadow_fills (id, account_id, occurred_at, created_at)
      VALUES (
        '00000000-0000-4000-8000-000000000003',
        'shadow',
        '2026-07-18T11:00:00Z',
        '2026-07-18T11:00:00Z'
      )
    `);
    const inserted = await client.query<{ ledger_sequence: string }>(`
      SELECT ledger_sequence::text
      FROM shadow_fills
      WHERE id = '00000000-0000-4000-8000-000000000003'
    `);
    assert.equal(inserted.rows[0]?.ledger_sequence, "3");

    await client.exec(fillSequenceMigrationSource);

    const rerun = await client.query<{
      id: string;
      ledger_sequence: string;
    }>(`
      SELECT id, ledger_sequence::text
      FROM shadow_fills
      ORDER BY ledger_sequence
    `);
    assert.deepEqual(rerun.rows, [
      {
        id: "00000000-0000-4000-8000-000000000001",
        ledger_sequence: "1",
      },
      {
        id: "00000000-0000-4000-8000-000000000002",
        ledger_sequence: "2",
      },
      {
        id: "00000000-0000-4000-8000-000000000003",
        ledger_sequence: "3",
      },
    ]);
  } finally {
    await client.close();
  }
});
