import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { getTableConfig } from "drizzle-orm/pg-core";

import {
  algoAccountControlsTable,
  algoDeploymentTargetsTable,
} from "./automation";

const migrationUrl = new URL(
  "../../migrations/20260722_algo_allowance_pool.sql",
  import.meta.url,
);

function column(
  table: Parameters<typeof getTableConfig>[0],
  name: string,
) {
  return getTableConfig(table).columns.find((candidate) => candidate.name === name);
}

test("target allowance is explicit and every target defaults execution off", () => {
  const config = getTableConfig(algoDeploymentTargetsTable);

  assert.ok(column(algoDeploymentTargetsTable, "allowance_unit")?.notNull);
  assert.ok(column(algoDeploymentTargetsTable, "allowance_value")?.notNull);
  assert.equal(
    column(algoDeploymentTargetsTable, "execution_enabled")?.notNull,
    true,
  );
  assert.equal(
    column(algoDeploymentTargetsTable, "allocation_percent")?.notNull,
    false,
  );
  assert.ok(
    config.checks.some(
      (constraint) =>
        constraint.name === "algo_deployment_targets_allowance_chk",
    ),
  );
});

test("account controls persist one shared total algo allowance", () => {
  const config = getTableConfig(algoAccountControlsTable);

  assert.ok(column(algoAccountControlsTable, "total_algo_allowance_unit")?.notNull);
  assert.ok(column(algoAccountControlsTable, "total_algo_allowance_value")?.notNull);
  assert.equal(
    column(algoAccountControlsTable, "hard_ceiling_percent")?.notNull,
    false,
  );
  assert.ok(
    config.checks.some(
      (constraint) => constraint.name === "algo_account_controls_allowance_chk",
    ),
  );
});

test("allowance migration preserves legacy percentages and never arms targets", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(
    sql,
    /update algo_deployment_targets[\s\S]*allowance_unit = 'percent'[\s\S]*allowance_value = allocation_percent/i,
  );
  assert.match(
    sql,
    /update algo_account_controls[\s\S]*total_algo_allowance_unit = 'percent'[\s\S]*total_algo_allowance_value = hard_ceiling_percent/i,
  );
  assert.match(
    sql,
    /execution_enabled boolean not null default false/i,
  );
  assert.match(sql, /alter column allocation_percent drop not null/i);
  assert.match(sql, /alter column hard_ceiling_percent drop not null/i);
  assert.doesNotMatch(sql, /execution_enabled\s*=\s*true/i);
  assert.doesNotMatch(sql, /delete\s+from/i);
  assert.doesNotMatch(sql, /drop\s+table/i);
});

test("allowance migration executes twice and preserves legacy values fail-closed", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const client = new PGlite();
  try {
    await client.exec(`
      CREATE TABLE algo_deployment_targets (
        id uuid PRIMARY KEY,
        allocation_percent numeric(5, 2) NOT NULL
      );
      CREATE TABLE algo_account_controls (
        id uuid PRIMARY KEY,
        hard_ceiling_percent numeric(5, 2) NOT NULL
      );
      INSERT INTO algo_deployment_targets (id, allocation_percent)
      VALUES ('00000000-0000-4000-8000-000000000001', 25);
      INSERT INTO algo_account_controls (id, hard_ceiling_percent)
      VALUES ('00000000-0000-4000-8000-000000000002', 60);
    `);

    await client.exec(sql);
    await assert.doesNotReject(client.exec(sql));

    const targets = await client.query<{
      allocation_percent: string;
      allowance_unit: string;
      allowance_value: string;
      execution_enabled: boolean;
    }>(`
      SELECT
        allocation_percent::text,
        allowance_unit,
        allowance_value::text,
        execution_enabled
      FROM algo_deployment_targets
    `);
    assert.deepEqual(targets.rows, [
      {
        allocation_percent: "25.00",
        allowance_unit: "percent",
        allowance_value: "25.000000",
        execution_enabled: false,
      },
    ]);
    const controls = await client.query<{
      hard_ceiling_percent: string;
      total_algo_allowance_unit: string;
      total_algo_allowance_value: string;
    }>(`
      SELECT
        hard_ceiling_percent::text,
        total_algo_allowance_unit,
        total_algo_allowance_value::text
      FROM algo_account_controls
    `);
    assert.deepEqual(controls.rows, [
      {
        hard_ceiling_percent: "60.00",
        total_algo_allowance_unit: "percent",
        total_algo_allowance_value: "60.000000",
      },
    ]);
  } finally {
    await client.close();
  }
});
