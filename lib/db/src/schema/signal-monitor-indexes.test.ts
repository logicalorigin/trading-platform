import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schemaSource = readFileSync(
  new URL("./signal-monitor.ts", import.meta.url),
  "utf8",
);
const migrationSource = readFileSync(
  new URL(
    "../../migrations/20260701_signal_monitor_events_latest_composite_idx.sql",
    import.meta.url,
  ),
  "utf8",
);

test("signal_monitor_events latest-event composite index stays in schema and migration", () => {
  const indexName = "signal_monitor_events_profile_symbol_tf_signal_at_idx";
  assert.match(schemaSource, new RegExp(`index\\("${indexName}"\\)`));
  // schema: (profileId, symbol, timeframe, signalAt DESC)
  assert.match(
    schemaSource,
    new RegExp(
      `${indexName}"[\\s\\S]*table\\.profileId[\\s\\S]*table\\.symbol[\\s\\S]*table\\.timeframe[\\s\\S]*table\\.signalAt\\.desc\\(\\)`,
    ),
  );
  assert.match(
    migrationSource,
    new RegExp(`CREATE INDEX CONCURRENTLY IF NOT EXISTS ${indexName}`, "i"),
  );
  assert.match(
    migrationSource,
    /ON signal_monitor_events \(profile_id, symbol, timeframe, signal_at DESC\)/i,
  );
});
