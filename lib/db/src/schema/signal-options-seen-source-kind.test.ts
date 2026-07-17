import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { getTableConfig } from "drizzle-orm/pg-core";

import { signalOptionsSeenSignalsTable } from "./automation";

const phaseOneMigration = readFileSync(
  new URL(
    "../../migrations/20260717_signal_options_seen_signal_source_kind.sql",
    import.meta.url,
  ),
  "utf8",
);
const phaseTwoMigration = readFileSync(
  new URL(
    "../../migrations/20260717_signal_options_seen_signal_source_kind_phase2.sql",
    import.meta.url,
  ),
  "utf8",
);

test("seen-signal provenance defaults to fail-closed unknown", () => {
  const table = getTableConfig(signalOptionsSeenSignalsTable);
  const sourceKind = table.columns.find(
    (column) => column.name === "source_kind",
  );

  assert.ok(sourceKind);
  assert.equal(sourceKind.notNull, true);
  assert.equal(sourceKind.hasDefault, true);
  assert.equal(sourceKind.default, "unknown");
  assert.ok(
    table.checks.some(
      (constraint) =>
        constraint.name === "signal_options_seen_signals_source_kind_chk",
    ),
  );
});

test("source-kind migrations keep the additive and classification phases separate", () => {
  assert.match(
    phaseOneMigration,
    /ADD COLUMN IF NOT EXISTS "source_kind"[\s\S]*NOT NULL DEFAULT 'unknown'/,
  );
  assert.match(
    phaseOneMigration,
    /CHECK \("source_kind" IN \('live', 'historical', 'unknown'\)\)/,
  );
  assert.doesNotMatch(phaseOneMigration, /UPDATE "signal_options_seen_signals"/);

  assert.match(
    phaseTwoMigration,
    /event\."deployment_id" = sidecar\."deployment_id"/,
  );
  assert.match(
    phaseTwoMigration,
    /sidecar\."event_id" IS NOT DISTINCT FROM classified\.event_id/,
  );
  assert.match(
    phaseTwoMigration,
    /THEN 'historical'[\s\S]*ELSE 'live'/,
  );
});

test("phased source-kind classification is fail-closed and idempotent", async () => {
  const client = new PGlite();
  try {
    await client.exec(`
      CREATE TABLE execution_events (
        id uuid PRIMARY KEY,
        deployment_id uuid,
        payload jsonb NOT NULL
      );
      CREATE TABLE signal_options_seen_signals (
        id uuid PRIMARY KEY,
        deployment_id uuid NOT NULL,
        event_id uuid
      );
    `);
    await client.exec(phaseOneMigration);
    await client.exec(phaseOneMigration);
    await client.exec(`
      INSERT INTO execution_events (id, deployment_id, payload) VALUES
        (
          '00000000-0000-4000-8000-000000000101',
          '00000000-0000-4000-8000-000000000201',
          '{"metadata":{"runMode":"historical_backfill"}}'
        ),
        (
          '00000000-0000-4000-8000-000000000102',
          '00000000-0000-4000-8000-000000000201',
          '{}'
        ),
        (
          '00000000-0000-4000-8000-000000000103',
          '00000000-0000-4000-8000-000000000299',
          '{}'
        );
      INSERT INTO signal_options_seen_signals (
        id, deployment_id, event_id, source_kind
      ) VALUES
        (
          '00000000-0000-4000-8000-000000000301',
          '00000000-0000-4000-8000-000000000201',
          '00000000-0000-4000-8000-000000000101',
          'live'
        ),
        (
          '00000000-0000-4000-8000-000000000302',
          '00000000-0000-4000-8000-000000000201',
          '00000000-0000-4000-8000-000000000102',
          'historical'
        ),
        (
          '00000000-0000-4000-8000-000000000303',
          '00000000-0000-4000-8000-000000000201',
          '00000000-0000-4000-8000-000000000103',
          'unknown'
        ),
        (
          '00000000-0000-4000-8000-000000000304',
          '00000000-0000-4000-8000-000000000201',
          '00000000-0000-4000-8000-000000000199',
          'unknown'
        );
    `);

    await client.exec(phaseTwoMigration);
    await client.exec(phaseTwoMigration);

    const rows = await client.query<{ id: string; source_kind: string }>(`
      SELECT id, source_kind
      FROM signal_options_seen_signals
      ORDER BY id
    `);
    assert.deepEqual(rows.rows, [
      {
        id: "00000000-0000-4000-8000-000000000301",
        source_kind: "historical",
      },
      {
        id: "00000000-0000-4000-8000-000000000302",
        source_kind: "live",
      },
      {
        id: "00000000-0000-4000-8000-000000000303",
        source_kind: "unknown",
      },
      {
        id: "00000000-0000-4000-8000-000000000304",
        source_kind: "unknown",
      },
    ]);
    await assert.rejects(
      client.exec(`
        INSERT INTO signal_options_seen_signals (
          id, deployment_id, source_kind
        ) VALUES (
          '00000000-0000-4000-8000-000000000305',
          '00000000-0000-4000-8000-000000000201',
          'guessed'
        )
      `),
      /signal_options_seen_signals_source_kind_chk/,
    );
  } finally {
    await client.close();
  }
});
