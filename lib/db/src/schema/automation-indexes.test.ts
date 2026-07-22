import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schemaSource = readFileSync(
  new URL("./automation.ts", import.meta.url),
  "utf8",
);
const migrationSource = readFileSync(
  new URL(
    "../../migrations/20260629_execution_events_shadow_hot_indexes.sql",
    import.meta.url,
  ),
  "utf8",
);
const clientOrderMigrationSource = readFileSync(
  new URL(
    "../../migrations/20260716_execution_events_client_order_idx.sql",
    import.meta.url,
  ),
  "utf8",
);

test("shadow execution-event hot-path indexes stay in schema and migration", () => {
  for (const indexName of [
    "execution_events_shadow_entry_exit_occurred_idx",
    "execution_events_shadow_mark_symbol_occurred_idx",
  ] as const) {
    assert.match(schemaSource, new RegExp(`index\\("${indexName}"\\)`));
    assert.match(
      migrationSource,
      new RegExp(`CREATE INDEX CONCURRENTLY IF NOT EXISTS ${indexName}`, "i"),
    );
  }

  assert.match(
    schemaSource,
    /execution_events_shadow_entry_exit_occurred_idx"[\s\S]*table\.occurredAt\.desc\(\)[\s\S]*signal_options_shadow_entry[\s\S]*signal_options_shadow_exit/,
  );
  assert.match(
    schemaSource,
    /execution_events_shadow_mark_symbol_occurred_idx"[\s\S]*table\.symbol[\s\S]*table\.occurredAt\.desc\(\)[\s\S]*signal_options_shadow_mark/,
  );
  assert.match(
    migrationSource,
    /ON execution_events \(occurred_at DESC\)[\s\S]*signal_options_shadow_entry[\s\S]*signal_options_shadow_exit/i,
  );
  assert.match(
    migrationSource,
    /ON execution_events \(symbol, occurred_at DESC\)[\s\S]*signal_options_shadow_mark/i,
  );
});

test("overnight idempotency lookup has matching ledger expression indexes", () => {
  assert.equal(schemaSource.includes("U&'\\\\0009"), true);
  assert.equal(schemaSource.includes("\\\\FEFF'"), true);
  assert.equal(clientOrderMigrationSource.includes("U&'\\0009"), true);
  assert.equal(clientOrderMigrationSource.includes("\\FEFF'"), true);
  assert.match(
    schemaSource,
    /index\("execution_events_deployment_client_order_idx"\)[\s\S]*table\.deploymentId[\s\S]*coalesce[\s\S]*nullif[\s\S]*btrim[\s\S]*clientOrderId[\s\S]*'order'[\s\S]*clientOrderId[\s\S]*'plan'[\s\S]*clientOrderId/,
  );
  assert.match(
    clientOrderMigrationSource,
    /CREATE INDEX CONCURRENTLY IF NOT EXISTS execution_events_deployment_client_order_idx[\s\S]*ON execution_events[\s\S]*coalesce[\s\S]*nullif[\s\S]*btrim[\s\S]*payload->>'clientOrderId'[\s\S]*payload->'order'->>'clientOrderId'[\s\S]*payload->'plan'->>'clientOrderId'/i,
  );
  assert.match(
    schemaSource,
    /index\("automation_diagnostics_deployment_client_order_any_idx"\)[\s\S]*table\.deploymentId[\s\S]*coalesce[\s\S]*nullif[\s\S]*btrim[\s\S]*clientOrderId[\s\S]*'order'[\s\S]*clientOrderId[\s\S]*'plan'[\s\S]*clientOrderId/,
  );
  assert.match(
    clientOrderMigrationSource,
    /CREATE INDEX CONCURRENTLY IF NOT EXISTS automation_diagnostics_deployment_client_order_any_idx[\s\S]*ON automation_diagnostics[\s\S]*coalesce[\s\S]*nullif[\s\S]*btrim[\s\S]*payload->>'clientOrderId'[\s\S]*payload->'order'->>'clientOrderId'[\s\S]*payload->'plan'->>'clientOrderId'/i,
  );
});
