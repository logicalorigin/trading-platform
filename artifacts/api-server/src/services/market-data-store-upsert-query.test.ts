import assert from "node:assert/strict";
import { test } from "node:test";

import { PGlite } from "@electric-sql/pglite";
import { PgDialect } from "drizzle-orm/pg-core";

import { buildBarCacheUpsertQuery } from "./market-data-store";

test("constant-shape bar-cache upsert preserves conflict and RETURNING semantics", async () => {
  const client = new PGlite();
  try {
    await client.exec(`
      create table bar_cache (
        instrument_id uuid not null,
        symbol varchar(64) not null,
        timeframe varchar(16) not null,
        starts_at timestamptz not null,
        open numeric(18, 6) not null,
        high numeric(18, 6) not null,
        low numeric(18, 6) not null,
        close numeric(18, 6) not null,
        volume numeric(20, 4) not null,
        source varchar(32) not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (symbol, timeframe, source, starts_at)
      )
    `);
    const firstUpdatedAt = new Date("2026-07-17T00:00:00.000Z");
    const rows = [0, 1].map((index) => ({
      instrumentId: "11111111-1111-4111-8111-111111111111",
      symbol: "AAPL",
      timeframe: "1m" as const,
      startsAt: new Date(firstUpdatedAt.getTime() + index * 60_000),
      open: String(100 + index),
      high: String(101 + index),
      low: String(99 + index),
      close: String(100.5 + index),
      volume: String(1_000 + index),
      source: "massive-history",
    }));
    const dialect = new PgDialect();
    const execute = async (
      inputRows: typeof rows,
      updatedAt: Date,
    ): Promise<Record<string, unknown>[]> => {
      const query = dialect.sqlToQuery(
        buildBarCacheUpsertQuery(inputRows, updatedAt),
      );
      const result = await client.query(query.sql, query.params as never[]);
      return result.rows as Record<string, unknown>[];
    };

    const inserted = await execute(rows, firstUpdatedAt);
    assert.equal(inserted.length, 2);
    assert.deepEqual(
      inserted.map((row) => row.sourceName),
      ["massive-history", "massive-history"],
    );

    const noOp = await execute(rows, new Date("2026-07-17T00:05:00.000Z"));
    assert.equal(noOp.length, 0);

    const changed = await execute(
      [{ ...rows[0]!, close: "999" }],
      new Date("2026-07-17T00:10:00.000Z"),
    );
    assert.equal(changed.length, 1);
    assert.equal(changed[0]?.startsAt instanceof Date, true);

    const stored = await client.query<{
      close: string;
      updated_at: Date | string;
    }>("select close, updated_at from bar_cache order by starts_at");
    assert.equal(Number(stored.rows[0]?.close), 999);
    assert.equal(
      new Date(stored.rows[0]!.updated_at).toISOString(),
      "2026-07-17T00:10:00.000Z",
    );
    assert.equal(
      new Date(stored.rows[1]!.updated_at).toISOString(),
      firstUpdatedAt.toISOString(),
    );
  } finally {
    await client.close();
  }
});
