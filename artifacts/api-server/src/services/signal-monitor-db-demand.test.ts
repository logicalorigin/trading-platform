import assert from "node:assert/strict";
import test from "node:test";

import { withTestDb } from "@workspace/db/testing";
import { sql } from "drizzle-orm";

import {
  __signalMonitorInternalsForTests,
  getSignalDirectionsForSymbolAsOf,
  updateSignalMonitorProfileEvaluationMetadata,
} from "./signal-monitor";

// DB read/write-demand cuts for signal-monitor (work-order B). Importing the
// service opens the real @workspace/db pool at module load, so run with
// --test-force-exit:
//   pnpm --filter @workspace/api-server exec tsx --test --test-force-exit \
//     src/services/signal-monitor-db-demand.test.ts
const I = __signalMonitorInternalsForTests;

// ── B1: universe-expansion JOIN memo ────────────────────────────────────────
test("B1: catalog expansion JOIN is memoized per effective limit and re-reads after invalidation", async () => {
  await withTestDb(async () => {
    I.invalidateSignalMonitorCatalogExpansionMemo();
    const base = I.getSignalMonitorCatalogExpansionMemoStats();

    // Empty catalog/rankings tables exercise the fallback path (leftJoin returns
    // []) while still running the real query + memo. seedSymbols shorter than
    // maxSymbols so the DB path (not the early return) runs.
    const first = await I.loadSignalMonitorCatalogExpansionSymbols({
      seedSymbols: ["AAA"],
      maxSymbols: 5,
    });
    const afterFirst = I.getSignalMonitorCatalogExpansionMemoStats();
    assert.equal(afterFirst.misses - base.misses, 1, "first call reads the DB");

    const second = await I.loadSignalMonitorCatalogExpansionSymbols({
      seedSymbols: ["AAA"],
      maxSymbols: 5,
    });
    const afterSecond = I.getSignalMonitorCatalogExpansionMemoStats();
    assert.equal(
      afterSecond.misses - afterFirst.misses,
      0,
      "second call is served from the memo (no DB read)",
    );
    assert.equal(afterSecond.hits - afterFirst.hits, 1, "second call is a memo hit");
    assert.deepEqual(first.symbols, second.symbols, "memoized result is identical");
    assert.deepEqual(first.symbols, ["AAA"], "fallback keeps the seed symbols");

    I.invalidateSignalMonitorCatalogExpansionMemo();
    await I.loadSignalMonitorCatalogExpansionSymbols({
      seedSymbols: ["AAA"],
      maxSymbols: 5,
    });
    const afterInvalidate = I.getSignalMonitorCatalogExpansionMemoStats();
    assert.equal(
      afterInvalidate.misses - afterSecond.misses,
      1,
      "invalidation forces a fresh read",
    );
  });
});

// ── B2: event_key dedup batch ───────────────────────────────────────────────
test("B2: event-anchor resolution is identical via prefetched map (0 reads) and per-cell query (1 read)", async () => {
  await withTestDb(async ({ db }) => {
    const profileId = "00000000-0000-4000-8000-0000000000b2";
    const symbol = "AAPL";
    const timeframe = "5m" as const;
    const direction = "buy" as const;
    const signalAt = new Date("2026-06-09T14:55:00.000Z");
    const anchoredSignalAt = new Date("2026-06-09T14:50:00.000Z");

    const input = { profileId, symbol, timeframe, direction, signalAt };
    const eventKeys = I.resolveSignalMonitorEventLookupKeys(input);
    assert.ok(eventKeys.length > 0, "directional cell yields lookup keys");

    // signal_monitor_events FKs to signal_monitor_profiles.
    await db.execute(sql`
      INSERT INTO signal_monitor_profiles (id, environment, enabled, fresh_window_bars)
      VALUES (${profileId}, 'shadow', true, 3)
    `);
    // Seed the first-anchor event so the per-cell query has a hit.
    await db.execute(sql`
      INSERT INTO signal_monitor_events
        (id, profile_id, event_key, environment, symbol, timeframe, direction, signal_at, signal_price, close, payload)
      VALUES (gen_random_uuid(), ${profileId}, ${eventKeys[0]}, 'shadow', ${symbol}, ${timeframe}, ${direction},
              ${anchoredSignalAt.toISOString()}::timestamptz, 100, 101, '{}'::jsonb)
    `);

    // The prefetched map is exactly what the batch pre-pass produces for these keys.
    const prefetched = new Map<string, Date>([[eventKeys[0]!, anchoredSignalAt]]);

    const before = I.getSignalMonitorEventDedupQueryCountForTests();
    const viaPrefetch = await I.resolveStoredSignalMonitorSignalAt(input, prefetched);
    const afterPrefetch = I.getSignalMonitorEventDedupQueryCountForTests();
    assert.equal(afterPrefetch - before, 0, "prefetched path issues no events read");

    const viaQuery = await I.resolveStoredSignalMonitorSignalAt(input);
    const afterQuery = I.getSignalMonitorEventDedupQueryCountForTests();
    assert.equal(
      afterQuery - afterPrefetch,
      1,
      "un-prefetched path issues exactly 1 events read",
    );

    assert.equal(
      viaPrefetch?.toISOString(),
      anchoredSignalAt.toISOString(),
      "prefetched path resolves the anchored signalAt",
    );
    assert.equal(
      viaQuery?.toISOString(),
      anchoredSignalAt.toISOString(),
      "query path resolves the identical signalAt",
    );
  });
});

test("event MTF directions match six latest-at-or-before queries with deterministic tie-breaks", async () => {
  await withTestDb(async ({ db }) => {
    const profileId = "00000000-0000-4000-8000-0000000000a6";
    const symbol = "AAPL";
    const asOf = new Date("2026-06-09T15:06:00.000Z");
    await db.execute(sql`
      INSERT INTO signal_monitor_profiles (id, environment, enabled, fresh_window_bars)
      VALUES (${profileId}, 'shadow', true, 3)
    `);
    const seedEvent = async (input: {
      id: string;
      timeframe: string;
      direction: "buy" | "sell";
      signalAt: string;
    }) => {
      await db.execute(sql`
        INSERT INTO signal_monitor_events
          (id, profile_id, event_key, environment, symbol, timeframe, direction, signal_at, signal_price, close, payload)
        VALUES (
          ${input.id},
          ${profileId},
          ${`mtf-${input.timeframe}-${input.id}`},
          'shadow',
          ${symbol},
          ${input.timeframe},
          ${input.direction},
          ${input.signalAt}::timestamptz,
          100,
          101,
          '{}'::jsonb
        )
      `);
    };

    await seedEvent({
      id: "00000000-0000-4000-8000-000000000101",
      timeframe: "1m",
      direction: "buy",
      signalAt: "2026-06-09T15:00:00.000Z",
    });
    await seedEvent({
      id: "00000000-0000-4000-8000-000000000102",
      timeframe: "1m",
      direction: "sell",
      signalAt: "2026-06-09T15:04:00.000Z",
    });
    await seedEvent({
      id: "00000000-0000-4000-8000-000000000103",
      timeframe: "1m",
      direction: "buy",
      signalAt: "2026-06-09T15:07:00.000Z",
    });
    await seedEvent({
      id: "00000000-0000-4000-8000-000000000201",
      timeframe: "2m",
      direction: "buy",
      signalAt: "2026-06-09T15:02:00.000Z",
    });
    await seedEvent({
      id: "00000000-0000-4000-8000-000000000202",
      timeframe: "2m",
      direction: "sell",
      signalAt: "2026-06-09T15:02:00.000Z",
    });
    await seedEvent({
      id: "00000000-0000-4000-8000-000000000501",
      timeframe: "5m",
      direction: "buy",
      signalAt: "2026-06-09T14:55:00.000Z",
    });

    const timeframes = ["1m", "2m", "5m", "15m", "bogus"];
    const expected: Record<string, "buy" | "sell" | null> = {};
    for (const timeframe of timeframes.filter((value) => value !== "bogus")) {
      expected[timeframe] = null;
      const rows = await db.execute(sql`
        SELECT direction
        FROM signal_monitor_events
        WHERE profile_id = ${profileId}
          AND symbol = ${symbol}
          AND timeframe = ${timeframe}
          AND signal_at <= ${asOf}
        ORDER BY signal_at DESC, id DESC
        LIMIT 1
      `);
      const direction = (rows.rows[0] as Record<string, unknown> | undefined)?.[
        "direction"
      ];
      expected[timeframe] =
        direction === "buy" || direction === "sell" ? direction : null;
    }

    assert.deepEqual(
      await getSignalDirectionsForSymbolAsOf({
        environment: "shadow",
        symbol,
        timeframes,
        asOf,
      }),
      expected,
    );
    assert.equal(expected["1m"], "sell", "future 1m event is ignored");
    assert.equal(expected["2m"], "sell", "same-time tie uses id DESC");
    assert.equal(expected["15m"], null, "missing timeframe stays null");
  });
});

// ── B4: profile heartbeat gate ──────────────────────────────────────────────
test("B4: heartbeat gate — write on first eval, at most 1/min, immediate on error transition", () => {
  I.resetSignalMonitorProfileHeartbeatForTests();
  const pid = "00000000-0000-4000-8000-0000000000b4";
  const t0 = new Date("2026-07-07T15:00:00.000Z");
  const at = (ms: number) => new Date(t0.getTime() + ms);
  const should = (lastError: string | null, evaluatedAt: Date) =>
    I.shouldWriteSignalMonitorProfileEvaluationMetadata({
      profileId: pid,
      lastError,
      evaluatedAt,
    });

  // First eval for a profile has no prior record → write (establishes baseline).
  assert.equal(should(null, t0), true, "first eval writes");
  I.recordSignalMonitorProfileEvaluationMetadataWrite({
    profileId: pid,
    lastError: null,
    evaluatedAt: t0,
  });

  // No error change, inside 60s → skip.
  assert.equal(should(null, at(5_000)), false, "+5s no-change skips");
  assert.equal(should(null, at(59_999)), false, "+59.999s no-change skips");

  // At 60s → heartbeat due.
  assert.equal(should(null, at(60_000)), true, "+60s heartbeat writes");

  // Error transition inside 60s of the last write → immediate write.
  assert.equal(
    should("All signal monitor symbol evaluations failed.", at(3_000)),
    true,
    "error transition writes immediately",
  );
});

test("B4: profile metadata UPDATE fires once per 60s and on error transition", async () => {
  await withTestDb(async ({ db }) => {
    I.resetSignalMonitorProfileHeartbeatForTests();
    const pid = "00000000-0000-4000-8000-0000000000b5";
    await db.execute(sql`
      INSERT INTO signal_monitor_profiles (id, environment, enabled, fresh_window_bars)
      VALUES (${pid}, 'shadow', true, 3)
    `);
    const profile = { id: pid, environment: "shadow" } as never;
    const t0 = new Date("2026-07-07T15:00:00.000Z");
    const at = (ms: number) => new Date(t0.getTime() + ms);
    const readMeta = async () => {
      const rows = (
        await db.execute(sql`
          SELECT last_evaluated_at, last_error
          FROM signal_monitor_profiles
          WHERE id = ${pid}
        `)
      ).rows;
      return rows[0] as { last_evaluated_at: string | null; last_error: string | null };
    };

    await updateSignalMonitorProfileEvaluationMetadata({
      profile,
      evaluatedAt: t0,
      states: [],
    });
    assert.equal(
      new Date((await readMeta()).last_evaluated_at!).toISOString(),
      t0.toISOString(),
      "baseline write",
    );

    await updateSignalMonitorProfileEvaluationMetadata({
      profile,
      evaluatedAt: at(5_000),
      states: [],
    });
    assert.equal(
      new Date((await readMeta()).last_evaluated_at!).toISOString(),
      t0.toISOString(),
      "within 60s: no write",
    );

    await updateSignalMonitorProfileEvaluationMetadata({
      profile,
      evaluatedAt: at(65_000),
      states: [],
    });
    assert.equal(
      new Date((await readMeta()).last_evaluated_at!).toISOString(),
      at(65_000).toISOString(),
      "heartbeat write at >=60s",
    );

    // Error transition writes immediately even though <60s since the last write.
    await updateSignalMonitorProfileEvaluationMetadata({
      profile,
      evaluatedAt: at(66_000),
      states: [{ status: "error" }] as never,
    });
    const m4 = await readMeta();
    assert.equal(
      new Date(m4.last_evaluated_at!).toISOString(),
      at(66_000).toISOString(),
      "error-transition write",
    );
    assert.equal(
      m4.last_error,
      "All signal monitor symbol evaluations failed.",
      "lastError persisted on transition",
    );
  });
});
