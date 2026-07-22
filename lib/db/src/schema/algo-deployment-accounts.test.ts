import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";

import {
  algoAccountControlsTable,
  algoDeploymentTargetsTable,
  algoDeploymentsTable,
  algoTargetExecutionsTable,
  algoTargetPositionsTable,
} from "./automation";

const migrationUrl = new URL(
  "../../migrations/20260721_algo_deployment_accounts.sql",
  import.meta.url,
);

function columnNames(table: Parameters<typeof getTableConfig>[0]) {
  return new Set(getTableConfig(table).columns.map((column) => column.name));
}

test("deployment schema carries owner, draft, archive, and nullable legacy account", () => {
  const config = getTableConfig(algoDeploymentsTable);
  const columns = columnNames(algoDeploymentsTable);

  assert.ok(columns.has("app_user_id"));
  assert.ok(columns.has("is_draft"));
  assert.ok(columns.has("archived_at"));
  assert.equal(
    config.columns.find((column) => column.name === "provider_account_id")
      ?.notNull,
    false,
  );
});

test("deployment target schema preserves account lifecycle and allocation caps", () => {
  const config = getTableConfig(algoDeploymentTargetsTable);
  const columns = columnNames(algoDeploymentTargetsTable);

  assert.deepEqual(
    [
      "deployment_id",
      "broker_account_id",
      "shadow_account_id",
      "lifecycle",
      "allocation_percent",
      "risk_overrides",
      "joined_at",
      "draining_at",
      "detached_at",
    ].filter((name) => !columns.has(name)),
    [],
  );
  assert.ok(
    config.checks.some(
      (constraint) =>
        constraint.name === "algo_deployment_targets_exactly_one_account_chk",
    ),
  );
  assert.ok(
    config.checks.some(
      (constraint) =>
        constraint.name === "algo_deployment_targets_allocation_percent_chk",
    ),
  );
  assert.ok(
    config.indexes.some(
      (index) => index.config.name === "algo_deployment_targets_broker_key",
    ),
  );
  assert.ok(
    config.indexes.some(
      (index) => index.config.name === "algo_deployment_targets_shadow_key",
    ),
  );
});

test("account controls and live target ledgers are directly user scoped", () => {
  for (const table of [
    algoAccountControlsTable,
    algoTargetExecutionsTable,
    algoTargetPositionsTable,
  ]) {
    assert.ok(
      columnNames(table).has("app_user_id"),
      `${getTableConfig(table).name} must carry app_user_id`,
    );
  }

  assert.ok(columnNames(algoAccountControlsTable).has("hard_ceiling_percent"));
  assert.ok(columnNames(algoTargetExecutionsTable).has("execution_key"));
  assert.ok(columnNames(algoTargetExecutionsTable).has("client_order_id"));
  assert.ok(columnNames(algoTargetPositionsTable).has("strategy_position_key"));
  assert.ok(columnNames(algoTargetPositionsTable).has("last_reconciled_at"));
});

test("additive migration backfills legacy deployments and never deletes them", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /alter table algo_deployments[\s\S]*add column if not exists app_user_id/i);
  assert.match(sql, /alter column provider_account_id drop not null/i);
  assert.match(sql, /update algo_deployments[\s\S]*is_draft = false/i);
  assert.match(sql, /create table if not exists algo_deployment_targets/i);
  assert.match(sql, /create table if not exists algo_account_controls/i);
  assert.match(sql, /create table if not exists algo_target_executions/i);
  assert.match(sql, /create table if not exists algo_target_positions/i);
  assert.doesNotMatch(sql, /delete\s+from\s+algo_deployments/i);
  assert.doesNotMatch(sql, /drop\s+table/i);
});
