import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const automationSchemaSource = readFileSync(
  new URL("./automation.ts", import.meta.url),
  "utf8",
);
const migrationSource = readFileSync(
  new URL(
    "../../migrations/20260702_signal_quality_kpi_snapshots.sql",
    import.meta.url,
  ),
  "utf8",
);

test("signal-quality KPI snapshot table stays in schema and migration", () => {
  assert.match(automationSchemaSource, /signalQualityKpiSnapshotsTable/);
  assert.match(automationSchemaSource, /"signal_quality_kpi_snapshots"/);
  assert.match(
    automationSchemaSource,
    /uniqueIndex\("signal_quality_kpi_snapshots_deployment_settings_day_idx"\)[\s\S]*table\.deploymentId[\s\S]*table\.settingsHash[\s\S]*table\.asOfDay/,
  );
  assert.match(
    automationSchemaSource,
    /index\("signal_quality_kpi_snapshots_deployment_generated_idx"\)[\s\S]*table\.deploymentId[\s\S]*table\.generatedAt\.desc\(\)/,
  );
  assert.match(
    automationSchemaSource,
    /index\("signal_quality_kpi_snapshots_deployment_day_generated_idx"\)[\s\S]*table\.deploymentId[\s\S]*table\.asOfDay[\s\S]*table\.generatedAt\.desc\(\)/,
  );

  assert.match(
    migrationSource,
    /CREATE TABLE IF NOT EXISTS "signal_quality_kpi_snapshots"/i,
  );
  assert.match(
    migrationSource,
    /CREATE UNIQUE INDEX IF NOT EXISTS "signal_quality_kpi_snapshots_deployment_settings_day_idx"[\s\S]*ON "signal_quality_kpi_snapshots" \("deployment_id", "settings_hash", "as_of_day"\)/i,
  );
  assert.match(
    migrationSource,
    /CREATE INDEX IF NOT EXISTS "signal_quality_kpi_snapshots_deployment_generated_idx"[\s\S]*ON "signal_quality_kpi_snapshots" \("deployment_id", "generated_at" DESC\)/i,
  );
  assert.match(
    migrationSource,
    /CREATE INDEX IF NOT EXISTS "signal_quality_kpi_snapshots_deployment_day_generated_idx"[\s\S]*ON "signal_quality_kpi_snapshots" \("deployment_id", "as_of_day", "generated_at" DESC\)/i,
  );
});
