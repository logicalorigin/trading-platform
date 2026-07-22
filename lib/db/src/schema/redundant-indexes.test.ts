import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const marketDataSchema = readFileSync(
  new URL("./market-data.ts", import.meta.url),
  "utf8",
);
const automationSchema = readFileSync(
  new URL("./automation.ts", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL(
    "../../migrations/20260715_drop_redundant_signal_indexes.sql",
    import.meta.url,
  ),
  "utf8",
);

test("redundant signal-system indexes stay retired", () => {
  for (const [source, indexName] of [
    [marketDataSchema, "gex_snapshots_symbol_latest_idx"],
    [automationSchema, "signal_options_seen_signals_event_idx"],
    [automationSchema, "signal_options_seen_signals_deployment_reason_idx"],
  ] as const) {
    assert.doesNotMatch(source, new RegExp(`index\\("${indexName}"\\)`));
    assert.match(
      migration,
      new RegExp(`DROP INDEX CONCURRENTLY IF EXISTS "?${indexName}"?`, "i"),
    );
  }
});
