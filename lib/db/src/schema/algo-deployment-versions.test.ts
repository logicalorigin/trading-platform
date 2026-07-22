import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";
import { getTableConfig } from "drizzle-orm/pg-core";

import {
  algoDeploymentsTable,
  algoDeploymentVersionsTable,
} from "./automation";

const migrationUrl = new URL(
  "../../migrations/20260722_algo_deployment_versions.sql",
  import.meta.url,
);

function column(
  table: Parameters<typeof getTableConfig>[0],
  name: string,
) {
  return getTableConfig(table).columns.find((candidate) => candidate.name === name);
}

test("deployment identity carries kind, optional provenance, and version pointers", () => {
  assert.equal(column(algoDeploymentsTable, "kind")?.notNull, true);
  assert.equal(column(algoDeploymentsTable, "strategy_id")?.notNull, false);
  assert.equal(column(algoDeploymentsTable, "draft_version_id")?.notNull, false);
  assert.equal(column(algoDeploymentsTable, "active_version_id")?.notNull, false);
});

test("deployment versions are immutable configuration snapshots", () => {
  const config = getTableConfig(algoDeploymentVersionsTable);

  for (const name of [
    "deployment_id",
    "version_number",
    "kind",
    "name",
    "symbol_universe",
    "config",
    "content_hash",
    "source",
    "source_strategy_id",
    "parent_version_id",
    "created_by_app_user_id",
    "created_at",
  ]) {
    assert.ok(column(algoDeploymentVersionsTable, name), `missing ${name}`);
  }
  assert.ok(
    config.indexes.some(
      (index) => index.config.name === "algo_deployment_versions_number_key",
    ),
  );
  assert.ok(
    config.checks.some(
      (constraint) => constraint.name === "algo_deployment_versions_kind_chk",
    ),
  );
});

test("version migration is additive and never arms execution", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /alter column strategy_id drop not null/i);
  assert.match(sql, /create table if not exists algo_deployment_versions/i);
  assert.match(sql, /insert into algo_deployment_versions/i);
  assert.match(sql, /draft_version_id = version\.id/i);
  assert.match(
    sql,
    /active_version_id = case when deployment\.enabled then version\.id else null end/i,
  );
  assert.doesNotMatch(sql, /execution_enabled\s*=\s*true/i);
  assert.doesNotMatch(sql, /update\s+algo_deployment_targets/i);
  assert.doesNotMatch(sql, /delete\s+from/i);
  assert.doesNotMatch(sql, /drop\s+table/i);
});

test("version migration executes twice and backfills enabled and paused deployments", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const client = new PGlite();
  try {
    await client.exec(`
      CREATE TYPE environment_mode AS ENUM ('shadow', 'live');
      CREATE TABLE users (
        id uuid PRIMARY KEY
      );
      CREATE TABLE algo_strategies (
        id uuid PRIMARY KEY
      );
      CREATE TABLE algo_deployments (
        id uuid PRIMARY KEY,
        app_user_id uuid REFERENCES users(id),
        strategy_id uuid NOT NULL REFERENCES algo_strategies(id),
        name text NOT NULL,
        mode environment_mode NOT NULL,
        enabled boolean NOT NULL DEFAULT false,
        provider_account_id varchar(128),
        is_draft boolean NOT NULL DEFAULT true,
        archived_at timestamptz,
        symbol_universe jsonb NOT NULL,
        config jsonb NOT NULL DEFAULT '{}'::jsonb,
        last_evaluated_at timestamptz,
        last_signal_at timestamptz,
        last_error text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE algo_deployment_targets (
        id uuid PRIMARY KEY,
        deployment_id uuid NOT NULL REFERENCES algo_deployments(id),
        execution_enabled boolean NOT NULL DEFAULT false
      );

      INSERT INTO users (id)
      VALUES ('00000000-0000-4000-8000-000000000001');
      INSERT INTO algo_strategies (id)
      VALUES
        ('00000000-0000-4000-8000-000000000010'),
        ('00000000-0000-4000-8000-000000000011');
      INSERT INTO algo_deployments (
        id, app_user_id, strategy_id, name, mode, enabled, is_draft,
        symbol_universe, config
      ) VALUES
        (
          '00000000-0000-4000-8000-000000000020',
          '00000000-0000-4000-8000-000000000001',
          '00000000-0000-4000-8000-000000000010',
          'Options', 'shadow', true, false, '["AAPL"]'::jsonb,
          '{"parameters":{"executionMode":"signal_options"}}'::jsonb
        ),
        (
          '00000000-0000-4000-8000-000000000021',
          '00000000-0000-4000-8000-000000000001',
          '00000000-0000-4000-8000-000000000011',
          'Equities', 'shadow', false, true, '["SPY"]'::jsonb,
          '{"source":"overnight_spot_repaired","parameters":{"signalTimeframe":"5m"}}'::jsonb
        );
      INSERT INTO algo_deployment_targets (id, deployment_id)
      VALUES (
        '00000000-0000-4000-8000-000000000030',
        '00000000-0000-4000-8000-000000000020'
      );
    `);

    await client.exec(sql);
    await assert.doesNotReject(client.exec(sql));

    const deployments = await client.query<{
      id: string;
      kind: string;
      strategy_id: string | null;
      draft_version_id: string | null;
      active_version_id: string | null;
      enabled: boolean;
    }>(`
      SELECT
        id::text,
        kind,
        strategy_id::text,
        draft_version_id::text,
        active_version_id::text,
        enabled
      FROM algo_deployments
      ORDER BY id
    `);
    assert.equal(deployments.rows[0]?.kind, "signal_options");
    assert.equal(deployments.rows[0]?.strategy_id, "00000000-0000-4000-8000-000000000010");
    assert.equal(deployments.rows[0]?.draft_version_id, deployments.rows[0]?.active_version_id);
    assert.equal(deployments.rows[1]?.kind, "overnight_spot");
    assert.equal(deployments.rows[1]?.strategy_id, "00000000-0000-4000-8000-000000000011");
    assert.ok(deployments.rows[1]?.draft_version_id);
    assert.equal(deployments.rows[1]?.active_version_id, null);

    const versions = await client.query<{
      deployment_id: string;
      version_number: number;
      kind: string;
      source: string;
    }>(`
      SELECT deployment_id::text, version_number, kind, source
      FROM algo_deployment_versions
      ORDER BY deployment_id
    `);
    assert.deepEqual(
      versions.rows.map((row) => ({
        ...row,
        version_number: Number(row.version_number),
      })),
      [
        {
          deployment_id: "00000000-0000-4000-8000-000000000020",
          version_number: 1,
          kind: "signal_options",
          source: "migration",
        },
        {
          deployment_id: "00000000-0000-4000-8000-000000000021",
          version_number: 1,
          kind: "overnight_spot",
          source: "migration",
        },
      ],
    );
    const targets = await client.query<{ execution_enabled: boolean }>(
      "SELECT execution_enabled FROM algo_deployment_targets",
    );
    assert.deepEqual(targets.rows, [{ execution_enabled: false }]);
  } finally {
    await client.close();
  }
});
