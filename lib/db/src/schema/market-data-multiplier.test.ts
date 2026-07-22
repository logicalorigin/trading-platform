import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationSource = readFileSync(
  new URL(
    "../../migrations/20260718_market_data_multiplier_backfill.sql",
    import.meta.url,
  ),
  "utf8",
);

test("Massive multiplier backfill repairs only stale premium multipliers", () => {
  assert.match(migrationSource, /update option_contracts/i);
  assert.match(migrationSource, /multiplier\s*=\s*100/i);
  assert.match(migrationSource, /where massive_ticker is not null/i);
  assert.match(migrationSource, /multiplier is distinct from 100/i);
  assert.doesNotMatch(
    migrationSource,
    /\bupdated_at\b/i,
    "a multiplier repair must preserve provider-observation freshness",
  );
  assert.doesNotMatch(migrationSource, /\b(delete|truncate|drop)\b/i);
});
