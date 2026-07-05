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
