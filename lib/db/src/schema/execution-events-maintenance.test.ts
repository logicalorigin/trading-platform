import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../migrations/20260715_execution_events_autovacuum_tuning.sql",
    import.meta.url,
  ),
  "utf8",
);

test("execution-events retention has matching autovacuum tuning", () => {
  assert.match(migration, /ALTER TABLE execution_events SET/i);
  assert.match(migration, /autovacuum_vacuum_scale_factor\s*=\s*0\.02/i);
  assert.match(migration, /autovacuum_vacuum_threshold\s*=\s*100/i);
  assert.match(migration, /autovacuum_analyze_scale_factor\s*=\s*0\.02/i);
  assert.match(migration, /autovacuum_analyze_threshold\s*=\s*100/i);
});
