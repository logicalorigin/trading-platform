import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { withTestDb } from "@workspace/db/testing";
import { sql } from "drizzle-orm";

import {
  reconcileSignalMonitorSymbolStatesForProfileInTx,
  reconcileSignalMonitorSymbolStatesForProfileMinimalInTx,
} from "./signal-monitor";

// Behaviour-equality proof for the minimal-read-set reconcile rewrite: on the
// SAME seeded data, the legacy single-table build and the new three-set build
// must produce identical pass counts AND identical written column values.
// See docs/plans/signal-monitor-reconcile-minimal-read-set.md.
//
// Run with --test-force-exit: importing the service opens the real @workspace/db
// pool at module load, which otherwise keeps the node:test process alive:
//   pnpm --filter @workspace/api-server exec tsx --test --test-force-exit \
//     src/services/signal-monitor-reconcile-minimal-readset.test.ts

const PROFILE_ID = "00000000-0000-0000-0000-0000000000aa";
const COUNT_KEYS = [
  "identityAdopted",
  "signalCloseBackfilled",
  "filterStateBackfilled",
  "latestCloseBackfilled",
  "latestBarAdvanced",
  "untrustedIdentityCleared",
  "barsRecomputed",
  "freshCleared",
] as const;
const STATE_COLS = [
  "current_signal_direction",
  "current_signal_at",
  "current_signal_price",
  "current_signal_close",
  "current_signal_mfe_percent",
  "current_signal_mae_percent",
  "filter_state",
  "bars_since_signal",
  "fresh",
  "latest_bar_at",
  "latest_bar_close",
  "status",
] as const;

const norm = (v: unknown): string =>
  v === null || v === undefined
    ? "∅"
    : v instanceof Date
      ? v.toISOString()
      : typeof v === "object"
        ? JSON.stringify(v)
        : String(v);

test("reconcile minimal-read-set build is behaviour-identical to the legacy build", async () => {
  await withTestDb(async ({ db }) => {
    const exec = (q: ReturnType<typeof sql>) => db.execute(q);

    // --- profile + instrument (bar_cache needs a valid instrument_id FK) ---
    await exec(sql`
      INSERT INTO signal_monitor_profiles (id, environment, enabled, fresh_window_bars)
      VALUES (${PROFILE_ID}, 'shadow', true, 3)
    `);
    // bar_cache's unique index is on (instrument_id, timeframe, source, starts_at),
    // so each symbol needs its OWN instrument or same-time bars across symbols collide.
    const instrumentBySymbol = new Map<string, string>();
    const ensureInstrument = async (symbol: string): Promise<string> => {
      let id = instrumentBySymbol.get(symbol);
      if (!id) {
        id = randomUUID();
        instrumentBySymbol.set(symbol, id);
        await exec(sql`
          INSERT INTO instruments (id, symbol, asset_class)
          VALUES (${id}, ${"INST_" + symbol}, 'equity')
        `);
      }
      return id;
    };

    // signal_at -> bar anchor for 5m (signal_at - 5 minutes), matching the reconcile.
    const at = (iso: string) => iso;
    const barAt = (iso: string) =>
      new Date(new Date(iso).getTime() - 5 * 60_000).toISOString();
    let evtSeq = 0;
    const ev = async (o: {
      sym: string;
      dir: string;
      signalAt: string;
      close: number | null;
      payload?: Record<string, unknown>;
    }) => {
      evtSeq += 1;
      await exec(sql`
        INSERT INTO signal_monitor_events
          (id, profile_id, event_key, environment, symbol, timeframe, direction, signal_at, signal_price, close, payload)
        VALUES (gen_random_uuid(), ${PROFILE_ID}, ${"k" + evtSeq}, 'shadow', ${o.sym}, '5m', ${o.dir},
                ${o.signalAt}::timestamptz, ${o.close}, ${o.close},
                ${JSON.stringify(o.payload ?? {})}::jsonb)
      `);
    };
    const bar = async (o: {
      sym: string;
      startsAt: string;
      close: number;
      source?: string;
    }) => {
      const instrumentId = await ensureInstrument(o.sym);
      await exec(sql`
        INSERT INTO bar_cache
          (id, instrument_id, symbol, timeframe, starts_at, open, high, low, close, volume, source)
        VALUES (gen_random_uuid(), ${instrumentId}, ${o.sym}, '5m', ${o.startsAt}::timestamptz,
                ${o.close}, ${o.close}, ${o.close}, ${o.close}, 1000, ${o.source ?? "massive-history"})
      `);
    };
    const card = async (o: Record<string, unknown>) => {
      const cols = Object.keys(o);
      const vals = cols.map((c) => o[c]);
      await exec(sql`
        INSERT INTO signal_monitor_symbol_states (id, profile_id, ${sql.raw(cols.join(", "))})
        VALUES (gen_random_uuid(), ${PROFILE_ID}, ${sql.join(
          vals.map((v) => sql`${v}`),
          sql`, `,
        )})
      `);
    };

    const T1 = "2026-06-25T15:00:00.000Z";
    const T2 = "2026-06-25T15:05:00.000Z";
    const T3 = "2026-06-25T15:10:00.000Z";

    // AAA — null card + a trusted buy -> pass 1 adopts.
    await ev({ sym: "AAA", dir: "buy", signalAt: T2, close: 100 });
    await bar({ sym: "AAA", startsAt: barAt(T2), close: 100 });
    await card({ symbol: "AAA", timeframe: "5m", active: true, status: "ok" });

    // BBB — card already on the event but stale current_signal_close -> pass 2 backfills.
    await ev({ sym: "BBB", dir: "buy", signalAt: T2, close: 200 });
    await bar({ sym: "BBB", startsAt: barAt(T2), close: 200 });
    await card({
      symbol: "BBB",
      timeframe: "5m",
      active: true,
      status: "ok",
      current_signal_direction: "buy",
      current_signal_at: sql`${T2}::timestamptz`,
      current_signal_close: 199,
    });

    // CCC — card on the event, null filter_state, event carries one -> pass 3 backfills.
    await ev({
      sym: "CCC",
      dir: "buy",
      signalAt: T2,
      close: 300,
      payload: { filterState: { score: 7 } },
    });
    await bar({ sym: "CCC", startsAt: barAt(T2), close: 300 });
    await card({
      symbol: "CCC",
      timeframe: "5m",
      active: true,
      status: "ok",
      current_signal_direction: "buy",
      current_signal_at: sql`${T2}::timestamptz`,
      current_signal_close: 300,
    });

    // DDD — multi-source AMBIGUOUS latest (best source >2% off, lower source within 2%).
    // Legacy + correct minimal must treat the best-source bar as authoritative -> T3 UNTRUSTED,
    // so the latest trusted event stays T1 (which carries a filter_state). A bare-EXISTS bug
    // would trust T3 via the lower source and diverge (adopt T3).
    await ev({
      sym: "DDD",
      dir: "buy",
      signalAt: T1,
      close: 50,
      payload: { filterState: { score: 9 } },
    });
    await bar({ sym: "DDD", startsAt: barAt(T1), close: 50 });
    await ev({
      sym: "DDD",
      dir: "buy",
      signalAt: T3,
      close: 50,
      payload: { sourceIntegrity: { trusted: false } },
    });
    await bar({ sym: "DDD", startsAt: barAt(T3), close: 60, source: "massive-history" }); // best, >2% off
    await bar({ sym: "DDD", startsAt: barAt(T3), close: 50.5, source: "massive-websocket" }); // lower, within 2%
    await card({
      symbol: "DDD",
      timeframe: "5m",
      active: true,
      status: "ok",
      current_signal_direction: "buy",
      current_signal_at: sql`${T1}::timestamptz`,
      current_signal_close: 50,
    });

    // EEE — tiebreak: two trusted events at the SAME signal_at, opposite directions.
    // DISTINCT ON ... signal_at DESC, id DESC must pick the same one in both builds.
    await ev({ sym: "EEE", dir: "buy", signalAt: T2, close: 500 });
    await ev({ sym: "EEE", dir: "sell", signalAt: T2, close: 500 });
    await bar({ sym: "EEE", startsAt: barAt(T2), close: 500 });
    await card({ symbol: "EEE", timeframe: "5m", active: true, status: "ok" });

    // FFF — latest-bar advance (pass 5; bar_cache-direct, identical in both builds).
    await bar({ sym: "FFF", startsAt: T3, close: 600 });
    await card({
      symbol: "FFF",
      timeframe: "5m",
      active: true,
      status: "stale",
      latest_bar_at: sql`${T1}::timestamptz`,
      latest_bar_close: 590,
    });

    // GGG — fresh clear (pass 8; card columns only).
    await card({
      symbol: "GGG",
      timeframe: "5m",
      active: true,
      status: "stale",
      fresh: true,
    });

    const capture = async (
      tx: { execute: (q: ReturnType<typeof sql>) => Promise<{ rows: unknown[] }> },
    ): Promise<Map<string, Record<string, unknown>>> => {
      const r = await tx.execute(sql`
        SELECT id, symbol, ${sql.raw(STATE_COLS.join(", "))}
        FROM signal_monitor_symbol_states WHERE profile_id = ${PROFILE_ID} ORDER BY symbol
      `);
      return new Map(
        (r.rows as Record<string, unknown>[]).map((row) => [
          String(row["symbol"]),
          row,
        ]),
      );
    };

    const profile = { id: PROFILE_ID, freshWindowBars: 3 } as never;
    class Rollback extends Error {}
    // Run a build for real (writes captured), then roll back so the next build
    // sees the same seeded baseline — both read identical input, drift-free.
    const runIsolated = async (
      fn: typeof reconcileSignalMonitorSymbolStatesForProfileInTx,
    ) => {
      let counts: Record<string, number> | undefined;
      let rows: Map<string, Record<string, unknown>> | undefined;
      try {
        await db.transaction(async (tx) => {
          counts = (await fn(tx as never, profile, false)) as never;
          rows = await capture(tx as never);
          throw new Rollback();
        });
      } catch (e) {
        if (!(e instanceof Rollback)) throw e;
      }
      return { counts: counts!, rows: rows! };
    };

    const legacy = await runIsolated(
      reconcileSignalMonitorSymbolStatesForProfileInTx,
    );
    const minimal = await runIsolated(
      reconcileSignalMonitorSymbolStatesForProfileMinimalInTx,
    );

    // The fixture must actually exercise the logic (non-trivial work), or the
    // equality is vacuous.
    const totalWork = COUNT_KEYS.reduce((n, k) => n + (legacy.counts[k] ?? 0), 0);
    assert.ok(totalWork >= 5, `fixture too quiet (totalWork=${totalWork})`);

    for (const k of COUNT_KEYS) {
      assert.equal(
        minimal.counts[k],
        legacy.counts[k],
        `count ${k}: legacy=${legacy.counts[k]} minimal=${minimal.counts[k]}`,
      );
    }

    const symbols = new Set([...legacy.rows.keys(), ...minimal.rows.keys()]);
    for (const symbol of symbols) {
      const l = legacy.rows.get(symbol);
      const m = minimal.rows.get(symbol);
      assert.ok(l && m, `row ${symbol} present in both`);
      for (const c of STATE_COLS) {
        assert.equal(
          norm(m![c]),
          norm(l![c]),
          `value ${symbol}.${c}: legacy=${norm(l![c])} minimal=${norm(m![c])}`,
        );
      }
    }
  });
});
