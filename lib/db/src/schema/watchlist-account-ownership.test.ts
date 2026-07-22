import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const schemaSource = readFileSync(
  new URL("./watchlists.ts", import.meta.url),
  "utf8",
);
const migrationSource = readFileSync(
  new URL(
    "../../migrations/20260722_watchlists_account_ownership.sql",
    import.meta.url,
  ),
  "utf8",
);

test("watchlists require an owner in schema and migration", () => {
  assert.match(
    schemaSource,
    /appUserId:\s*uuid\("app_user_id"\)\.notNull\(\)/,
  );
  assert.match(
    schemaSource,
    /uniqueIndex\("watchlists_app_user_name_unique_idx"\)[\s\S]*table\.appUserId[\s\S]*lower/,
  );
  assert.match(migrationSource, /watchlists_legacy_archive_20260722/i);
  assert.match(migrationSource, /watchlist_items_legacy_archive_20260722/i);
  assert.match(
    migrationSource,
    /ALTER COLUMN app_user_id SET NOT NULL/i,
  );
  assert.match(
    migrationSource,
    /CREATE UNIQUE INDEX IF NOT EXISTS watchlists_app_user_name_unique_idx/i,
  );
  assert.doesNotMatch(migrationSource, /logicalorigins|info@/i);
  assert.match(migrationSource.trim(), /COMMIT;$/);
});

test("ownership migration merges legacy rows into the referenced account and is retry-safe", async () => {
  const client = new PGlite();
  try {
    await client.exec(`
      CREATE TABLE watchlists (
        id uuid PRIMARY KEY,
        app_user_id uuid,
        name text NOT NULL,
        is_default boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      );
      CREATE TABLE watchlist_items (
        id uuid PRIMARY KEY,
        watchlist_id uuid NOT NULL,
        instrument_id uuid NOT NULL,
        sort_order integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      );
      CREATE TABLE signal_monitor_profiles (
        id uuid PRIMARY KEY,
        watchlist_id uuid
      );
      CREATE TABLE backtest_studies (
        id uuid PRIMARY KEY,
        watchlist_id uuid
      );

      INSERT INTO watchlists (
        id, app_user_id, name, is_default, created_at, updated_at
      ) VALUES
        (
          '00000000-0000-4000-8000-000000000101',
          '00000000-0000-4000-8000-000000000001',
          'Core', true, '2026-04-22', '2026-04-22'
        ),
        (
          '00000000-0000-4000-8000-000000000102',
          '00000000-0000-4000-8000-000000000001',
          'Core', true, '2026-07-02', '2026-07-02'
        ),
        (
          '00000000-0000-4000-8000-000000000103',
          NULL,
          'Core', true, '2026-07-16', '2026-07-16'
        ),
        (
          '00000000-0000-4000-8000-000000000104',
          '00000000-0000-4000-8000-000000000001',
          'Research', false, '2026-05-03', '2026-05-03'
        );

      INSERT INTO watchlist_items (
        id, watchlist_id, instrument_id, sort_order, created_at, updated_at
      ) VALUES
        (
          '00000000-0000-4000-8000-000000000201',
          '00000000-0000-4000-8000-000000000101',
          '00000000-0000-4000-8000-000000000301',
          0, '2026-04-22', '2026-04-22'
        ),
        (
          '00000000-0000-4000-8000-000000000202',
          '00000000-0000-4000-8000-000000000101',
          '00000000-0000-4000-8000-000000000302',
          1, '2026-04-22', '2026-04-22'
        ),
        (
          '00000000-0000-4000-8000-000000000203',
          '00000000-0000-4000-8000-000000000102',
          '00000000-0000-4000-8000-000000000303',
          0, '2026-07-02', '2026-07-02'
        ),
        (
          '00000000-0000-4000-8000-000000000204',
          '00000000-0000-4000-8000-000000000103',
          '00000000-0000-4000-8000-000000000304',
          0, '2026-07-16', '2026-07-16'
        );

      INSERT INTO signal_monitor_profiles (id, watchlist_id) VALUES (
        '00000000-0000-4000-8000-000000000401',
        '00000000-0000-4000-8000-000000000101'
      );
      INSERT INTO backtest_studies (id, watchlist_id) VALUES (
        '00000000-0000-4000-8000-000000000402',
        '00000000-0000-4000-8000-000000000103'
      );
    `);

    await client.exec(migrationSource);
    await client.exec(migrationSource);

    const watchlists = await client.query<{
      id: string;
      app_user_id: string;
      name: string;
    }>(`
      SELECT id, app_user_id, name
      FROM watchlists
      ORDER BY name, id
    `);
    assert.deepEqual(watchlists.rows, [
      {
        id: "00000000-0000-4000-8000-000000000101",
        app_user_id: "00000000-0000-4000-8000-000000000001",
        name: "Core",
      },
      {
        id: "00000000-0000-4000-8000-000000000104",
        app_user_id: "00000000-0000-4000-8000-000000000001",
        name: "Research",
      },
    ]);
    const coreItems = await client.query<{ instrument_id: string }>(`
      SELECT instrument_id
      FROM watchlist_items
      WHERE watchlist_id = '00000000-0000-4000-8000-000000000101'
      ORDER BY instrument_id
    `);
    assert.deepEqual(
      coreItems.rows.map(({ instrument_id }) => instrument_id),
      [
        "00000000-0000-4000-8000-000000000301",
        "00000000-0000-4000-8000-000000000302",
        "00000000-0000-4000-8000-000000000303",
        "00000000-0000-4000-8000-000000000304",
      ],
    );
    const references = await client.query<{ watchlist_id: string }>(`
      SELECT watchlist_id FROM signal_monitor_profiles
      UNION ALL
      SELECT watchlist_id FROM backtest_studies
      ORDER BY watchlist_id
    `);
    assert.deepEqual(
      references.rows.map(({ watchlist_id }) => watchlist_id),
      [
        "00000000-0000-4000-8000-000000000101",
        "00000000-0000-4000-8000-000000000101",
      ],
    );
    const archived = await client.query<{ id: string }>(`
      SELECT id FROM watchlists_legacy_archive_20260722 ORDER BY id
    `);
    assert.deepEqual(
      archived.rows.map(({ id }) => id),
      [
        "00000000-0000-4000-8000-000000000102",
        "00000000-0000-4000-8000-000000000103",
      ],
    );
    await assert.rejects(
      client.exec(`
        INSERT INTO watchlists (
          id, app_user_id, name, is_default, created_at, updated_at
        ) VALUES (
          '00000000-0000-4000-8000-000000000105',
          NULL, 'No owner', false, now(), now()
        )
      `),
      /app_user_id|null/i,
    );
    await assert.rejects(
      client.exec(`
        INSERT INTO watchlists (
          id, app_user_id, name, is_default, created_at, updated_at
        ) VALUES (
          '00000000-0000-4000-8000-000000000106',
          '00000000-0000-4000-8000-000000000001',
          'core', false, now(), now()
        )
      `),
      /watchlists_app_user_name_unique_idx|unique/i,
    );
  } finally {
    await client.close();
  }
});
