import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schemaSource = readFileSync(new URL("./trading.ts", import.meta.url), "utf8");
const migrationSource = readFileSync(
  new URL("../../migrations/20260629_shadow_account_stream_indexes.sql", import.meta.url),
  "utf8",
);
const peakMigrationSource = readFileSync(
  new URL("../../migrations/20260629_shadow_position_marks_peak_idx.sql", import.meta.url),
  "utf8",
);
const idempotencyMigrationSource = readFileSync(
  new URL(
    "../../migrations/20260709_shadow_order_idempotency_account_scope.sql",
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
