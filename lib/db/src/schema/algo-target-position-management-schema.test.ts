import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { getTableConfig } from "drizzle-orm/pg-core";

import { algoTargetPositionsTable } from "./automation";

const migrationUrl = new URL(
  "../../migrations/20260722_algo_target_position_management.sql",
  import.meta.url,
);

test("algo-owned positions persist bounded live-management state", () => {
  const config = getTableConfig(algoTargetPositionsTable);
  const column = config.columns.find(
    (candidate) => candidate.name === "management_state",
  );

  assert.equal(column?.notNull, true);
  assert.ok(
    config.checks.some(
      (constraint) =>
        constraint.name === "algo_target_positions_management_state_chk",
    ),
  );
});

test("position-management migration is additive, idempotent, and never arms a target", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const client = new PGlite();
  try {
    await client.exec(`
      CREATE TABLE algo_target_positions (
        id uuid PRIMARY KEY,
        contract_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb
      );
      INSERT INTO algo_target_positions (id)
      VALUES ('00000000-0000-4000-8000-000000000001');
    `);

    await client.exec(sql);
    await assert.doesNotReject(client.exec(sql));

    const states = await client.query<{ management_state: unknown }>(`
      SELECT management_state FROM algo_target_positions
    `);
    assert.deepEqual(states.rows, [{ management_state: {} }]);
    assert.doesNotMatch(sql, /execution_enabled\s*=\s*true/i);
    assert.doesNotMatch(sql, /delete\s+from/i);
    assert.doesNotMatch(sql, /drop\s+table/i);
  } finally {
    await client.close();
  }
});
