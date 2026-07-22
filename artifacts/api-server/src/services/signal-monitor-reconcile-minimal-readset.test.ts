import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { withTestDb } from "@workspace/db/testing";
import { sql } from "drizzle-orm";

import {
  buildEmptySignalMonitorCurrentCellParityReport,
  buildSignalMonitorEventAnchorBackfillPlan,
  buildSignalMonitorBreadthParityReport,
  buildSignalMonitorCurrentCellParityReport,
  listLatestTrustedSignalMonitorEventsForProfile,
  reconcileSignalMonitorSymbolStatesFromCanonicalEvents,
} from "./signal-monitor";

// Reconcile regression fixture. This keeps the multi-pass edge cases that used
// to compare the retired legacy/minimal private implementations, but now tests
// the public reconcile entry point that production actually calls.
//
// Run with --test-force-exit: importing the service opens the real @workspace/db
// pool at module load, which otherwise keeps the node:test process alive:
//   pnpm --filter @workspace/api-server exec tsx --test --test-force-exit \
//     src/services/signal-monitor-reconcile-minimal-readset.test.ts

const PROFILE_ID = "00000000-0000-0000-0000-0000000000aa";
const SOURCE = readFileSync(new URL("./signal-monitor.ts", import.meta.url), "utf8");
const COUNT_KEYS = [
  "identityAdopted",
  "signalCloseBackfilled",
  "filterStateBackfilled",
  "latestCloseBackfilled",
  "latestBarAdvanced",
  "untrustedIdentityCleared",
  "barsRecomputed",
  "freshCleared",
  "eventAnchorsInserted",
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
const numeric = (v: unknown): number => Number(v);
const dateIso = (v: unknown): string => new Date(String(v)).toISOString();

test("state reconciliation corroborates only untrusted events and materializes reused canonical reads", () => {
  const reconcileStart = SOURCE.indexOf(
    "async function reconcileSignalMonitorSymbolStatesForProfile",
  );
  const reconcileEnd = SOURCE.indexOf(
    "export async function reconcileSignalMonitorSymbolStatesFromCanonicalEvents",
    reconcileStart,
  );
  assert.notEqual(reconcileStart, -1);
  assert.notEqual(reconcileEnd, -1);
  const reconcileBlock = SOURCE.slice(reconcileStart, reconcileEnd);

  assert.match(reconcileBlock, /corroborateOnlyUntrusted:\s*true/);

  const identityStart = reconcileBlock.indexOf("const identityTrustedEventsCte");
  const identityEnd = reconcileBlock.indexOf(
    "const signalCloseBackfillJoin",
    identityStart,
  );
  assert.notEqual(identityStart, -1);
  assert.notEqual(identityEnd, -1);
  const identityBlock = reconcileBlock.slice(identityStart, identityEnd);
  assert.match(
    identityBlock,
    /WITH trusted_signal_monitor_events AS MATERIALIZED \$\{trustedEvents\}/,
  );
  assert.equal(
    identityBlock.match(/\$\{trustedEvents\}/g)?.length,
    1,
    "the identity statement must not expand the event-to-bar corroboration query twice",
  );

  const cleanupStart = reconcileBlock.indexOf(
    "const untrustedIdentityTrustedEventsCte",
  );
  const cleanupEnd = reconcileBlock.indexOf(
    "const elapsedBars",
    cleanupStart,
  );
  assert.notEqual(cleanupStart, -1);
  assert.notEqual(cleanupEnd, -1);
  const cleanupBlock = reconcileBlock.slice(cleanupStart, cleanupEnd);
  assert.match(
    cleanupBlock,
    /WITH trusted_signal_monitor_events AS MATERIALIZED \$\{trustedEvents\}/,
  );
  assert.equal(
    cleanupBlock.match(/\$\{trustedEvents\}/g)?.length,
    1,
    "the cleanup statement must not expand the event-to-bar corroboration query twice",
  );
});

test("reconcile canonical events updates signal-monitor state from the trusted fixture", async () => {
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
                ${JSON.stringify({
                  signalSettingsRevision: 1,
                  ...(o.payload ?? {}),
                })}::jsonb)
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
          (instrument_id, symbol, timeframe, starts_at, open, high, low, close, volume, source)
        VALUES (${instrumentId}, ${o.sym}, '5m', ${o.startsAt}::timestamptz,
                ${o.close}, ${o.close}, ${o.close}, ${o.close}, 1000, ${o.source ?? "massive-history"})
      `);
    };
    const card = async (o: Record<string, unknown>) => {
      const cols = Object.keys(o);
      const vals = cols.map((c) => o[c]);
      await exec(sql`
        INSERT INTO signal_monitor_symbol_states
          (id, profile_id, signal_settings_revision, ${sql.raw(cols.join(", "))})
        VALUES (gen_random_uuid(), ${PROFILE_ID}, 1, ${sql.join(
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

    // HHH — Friday-to-Monday age must count only bars that can form during
    // regular sessions. Wall-clock division would inflate this to ~794 bars;
    // the producer's canonical session-aware count is 8 (1 Friday + 7 Monday).
    const crossSessionSignalAt = "2026-06-26T19:55:00.000Z";
    const crossSessionLatestBarAt = "2026-06-29T14:05:00.000Z";
    await ev({
      sym: "HHH",
      dir: "buy",
      signalAt: crossSessionSignalAt,
      close: 800,
    });
    await card({
      symbol: "HHH",
      timeframe: "5m",
      active: true,
      status: "ok",
      current_signal_direction: "buy",
      current_signal_at: sql`${crossSessionSignalAt}::timestamptz`,
      current_signal_close: 800,
      latest_bar_at: sql`${crossSessionLatestBarAt}::timestamptz`,
      latest_bar_close: 805,
      bars_since_signal: 0,
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

    const [counts] = await reconcileSignalMonitorSymbolStatesFromCanonicalEvents({
      dryRun: false,
    });
    assert.ok(counts, "expected reconcile counts for the seeded profile");
    assert.equal(counts.profileId, PROFILE_ID);
    const rows = await capture(db);

    // The fixture must actually exercise the logic (non-trivial work), or the
    // test is vacuous.
    const totalWork = COUNT_KEYS.reduce((n, k) => n + (counts[k] ?? 0), 0);
    assert.ok(totalWork >= 5, `fixture too quiet (totalWork=${totalWork})`);

    assert.equal(norm(rows.get("AAA")?.current_signal_direction), "buy");
    assert.equal(numeric(rows.get("BBB")?.current_signal_close), 200);
    assert.match(norm(rows.get("CCC")?.filter_state), /"score":7/);
    assert.equal(dateIso(rows.get("DDD")?.current_signal_at), T1);
    assert.match(norm(rows.get("DDD")?.filter_state), /"score":9/);
    assert.equal(dateIso(rows.get("FFF")?.latest_bar_at), T3);
    assert.equal(numeric(rows.get("FFF")?.latest_bar_close), 600);
    assert.equal(norm(rows.get("FFF")?.status), "ok");
    assert.equal(norm(rows.get("GGG")?.fresh), "false");
    assert.equal(numeric(rows.get("HHH")?.bars_since_signal), 8);
  });
});

test("latest trusted event reader returns one canonical event per signal-monitor cell", async () => {
  await withTestDb(async ({ db }) => {
    const exec = (q: ReturnType<typeof sql>) => db.execute(q);
    await exec(sql`
      INSERT INTO signal_monitor_profiles (id, environment, enabled, fresh_window_bars)
      VALUES (${PROFILE_ID}, 'shadow', true, 3)
    `);

    const instrumentBySymbol = new Map<string, string>();
    const ensureInstrument = async (symbol: string): Promise<string> => {
      let id = instrumentBySymbol.get(symbol);
      if (!id) {
        id = randomUUID();
        instrumentBySymbol.set(symbol, id);
        await exec(sql`
          INSERT INTO instruments (id, symbol, asset_class)
          VALUES (${id}, ${"LATEST_" + symbol}, 'equity')
        `);
      }
      return id;
    };
    const barAt = (iso: string) =>
      new Date(new Date(iso).getTime() - 5 * 60_000).toISOString();
    const ev = async (o: {
      id: string;
      sym: string;
      dir: string;
      signalAt: string;
      close: number | null;
      payload?: Record<string, unknown>;
    }) => {
      await exec(sql`
        INSERT INTO signal_monitor_events
          (id, profile_id, event_key, environment, symbol, timeframe, direction, signal_at, signal_price, close, payload)
        VALUES (${o.id}, ${PROFILE_ID}, ${"latest-" + o.id}, 'shadow', ${o.sym}, '5m', ${o.dir},
                ${o.signalAt}::timestamptz, ${o.close}, ${o.close},
                ${JSON.stringify({
                  signalSettingsRevision: 1,
                  ...(o.payload ?? {}),
                })}::jsonb)
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
          (instrument_id, symbol, timeframe, starts_at, open, high, low, close, volume, source)
        VALUES (${instrumentId}, ${o.sym}, '5m', ${o.startsAt}::timestamptz,
                ${o.close}, ${o.close}, ${o.close}, ${o.close}, 1000, ${o.source ?? "massive-history"})
      `);
    };

    const T1 = "2026-06-25T15:00:00.000Z";
    const T2 = "2026-06-25T15:05:00.000Z";
    const T3 = "2026-06-25T15:10:00.000Z";

    await ev({
      id: "00000000-0000-0000-0000-000000000101",
      sym: "AAA",
      dir: "buy",
      signalAt: T1,
      close: 100,
    });
    await ev({
      id: "00000000-0000-0000-0000-000000000102",
      sym: "AAA",
      dir: "sell",
      signalAt: T2,
      close: 110,
      payload: { filterState: { score: 2 } },
    });
    await bar({ sym: "AAA", startsAt: barAt(T1), close: 100 });
    await bar({ sym: "AAA", startsAt: barAt(T2), close: 110 });

    await ev({
      id: "00000000-0000-0000-0000-000000000201",
      sym: "BBB",
      dir: "buy",
      signalAt: T1,
      close: 50,
      payload: { filterState: { score: 9 } },
    });
    await ev({
      id: "00000000-0000-0000-0000-000000000202",
      sym: "BBB",
      dir: "sell",
      signalAt: T3,
      close: 50,
      payload: { sourceIntegrity: { trusted: false } },
    });
    await bar({ sym: "BBB", startsAt: barAt(T1), close: 50 });
    await bar({
      sym: "BBB",
      startsAt: barAt(T3),
      close: 60,
      source: "massive-history",
    });
    await bar({
      sym: "BBB",
      startsAt: barAt(T3),
      close: 50.5,
      source: "massive-websocket",
    });

    await ev({
      id: "00000000-0000-0000-0000-000000000301",
      sym: "CCC",
      dir: "buy",
      signalAt: T2,
      close: 30,
    });
    await ev({
      id: "00000000-0000-0000-0000-000000000302",
      sym: "CCC",
      dir: "sell",
      signalAt: T2,
      close: 31,
    });
    await bar({ sym: "CCC", startsAt: barAt(T2), close: 31 });

    const events = await listLatestTrustedSignalMonitorEventsForProfile({
      profile: { id: PROFILE_ID, environment: "shadow" },
    });
    assert.deepEqual(
      events.map((event) => [
        event.symbol,
        event.timeframe,
        event.direction,
        event.signalAt.toISOString(),
        event.close,
      ]),
      [
        ["AAA", "5m", "sell", T2, 110],
        ["BBB", "5m", "buy", T1, 50],
        ["CCC", "5m", "sell", T2, 31],
      ],
    );
    assert.deepEqual(events[0]?.filterState, { score: 2 });
    assert.deepEqual(events[1]?.filterState, { score: 9 });

    const filtered = await listLatestTrustedSignalMonitorEventsForProfile({
      profile: { id: PROFILE_ID, environment: "shadow" },
      symbols: ["aaa", "bbb"],
      timeframes: ["5m"],
    });
    assert.deepEqual(
      filtered.map((event) => `${event.symbol}:${event.timeframe}`),
      ["AAA:5m", "BBB:5m"],
    );
  });
});

test("current-cell parity report starts empty with normalized scope", () => {
  const generatedAt = new Date("2026-06-26T12:00:00.000Z");
  const report = buildEmptySignalMonitorCurrentCellParityReport({
    profile: { id: PROFILE_ID, environment: "shadow" },
    generatedAt,
    symbols: [" spy ", "SPY", "", "aapl"],
    timeframes: ["5m", "bogus" as never],
  });

  assert.equal(report.profileId, PROFILE_ID);
  assert.equal(report.environment, "shadow");
  assert.equal(report.generatedAt.toISOString(), generatedAt.toISOString());
  assert.deepEqual(report.requested.symbols, ["AAPL", "SPY"]);
  assert.deepEqual(report.requested.timeframes, ["5m"]);
  assert.deepEqual(report.counts, {
    comparedCells: 0,
    missingStoredCells: 0,
    missingDerivedCells: 0,
    mismatches: 0,
  });
  assert.deepEqual(report.mismatches, []);
});

test("current-cell parity checker reports event-derived identity drift without writes", async () => {
  await withTestDb(async ({ db }) => {
    const exec = (q: ReturnType<typeof sql>) => db.execute(q);
    await exec(sql`
      INSERT INTO signal_monitor_profiles (id, environment, enabled, fresh_window_bars)
      VALUES (${PROFILE_ID}, 'shadow', true, 3)
    `);

    const instrumentBySymbol = new Map<string, string>();
    const ensureInstrument = async (symbol: string): Promise<string> => {
      let id = instrumentBySymbol.get(symbol);
      if (!id) {
        id = randomUUID();
        instrumentBySymbol.set(symbol, id);
        await exec(sql`
          INSERT INTO instruments (id, symbol, asset_class)
          VALUES (${id}, ${"PARITY_" + symbol}, 'equity')
        `);
      }
      return id;
    };
    const ev = async (o: {
      id: string;
      sym: string;
      dir: string;
      signalAt: string;
      close: number;
      filterState?: Record<string, unknown>;
    }) => {
      await exec(sql`
        INSERT INTO signal_monitor_events
          (id, profile_id, event_key, environment, symbol, timeframe, direction, signal_at, signal_price, close, payload)
        VALUES (${o.id}, ${PROFILE_ID}, ${"parity-" + o.id}, 'shadow', ${o.sym}, '5m', ${o.dir},
                ${o.signalAt}::timestamptz, ${o.close}, ${o.close},
                ${JSON.stringify(
                  o.filterState
                    ? {
                        signalSettingsRevision: 1,
                        filterState: o.filterState,
                      }
                    : { signalSettingsRevision: 1 },
                )}::jsonb)
      `);
    };
    const card = async (o: {
      sym: string;
      dir?: string | null;
      signalAt?: string | null;
      price?: number | null;
      close?: number | null;
      filterState?: Record<string, unknown> | null;
      active?: boolean;
      latestBarAt?: string | null;
      latestBarClose?: number | null;
      barsSinceSignal?: number | null;
      fresh?: boolean;
      status?: string;
    }) => {
      await exec(sql`
        INSERT INTO signal_monitor_symbol_states
          (id, profile_id, signal_settings_revision, symbol, timeframe, active, status, current_signal_direction,
           current_signal_at, current_signal_price, current_signal_close, filter_state,
           latest_bar_at, latest_bar_close, bars_since_signal, fresh)
        VALUES (
          gen_random_uuid(), ${PROFILE_ID}, 1, ${o.sym}, '5m', ${o.active ?? true}, ${o.status ?? "ok"},
          ${o.dir ?? null},
          ${o.signalAt ? sql`${o.signalAt}::timestamptz` : sql`NULL`},
          ${o.price ?? null},
          ${o.close ?? null},
          ${
            o.filterState === undefined
              ? sql`NULL`
              : sql`${JSON.stringify(o.filterState)}::jsonb`
          },
          ${o.latestBarAt ? sql`${o.latestBarAt}::timestamptz` : sql`NULL`},
          ${o.latestBarClose ?? null},
          ${o.barsSinceSignal ?? null},
          ${o.fresh ?? false}
        )
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
          (instrument_id, symbol, timeframe, starts_at, open, high, low, close, volume, source)
        VALUES (${instrumentId}, ${o.sym}, '5m', ${o.startsAt}::timestamptz,
                ${o.close}, ${o.close}, ${o.close}, ${o.close}, 1000, ${o.source ?? "massive-history"})
      `);
    };

    const T1 = "2026-06-25T15:00:00.000Z";
    const T2 = "2026-06-25T15:05:00.000Z";

    await ev({
      id: "00000000-0000-0000-0000-000000000401",
      sym: "AAA",
      dir: "buy",
      signalAt: T1,
      close: 100,
      filterState: { score: 1 },
    });
    await card({
      sym: "AAA",
      dir: "buy",
      signalAt: T1,
      price: 100,
      close: 100,
      filterState: { score: 1 },
    });

    await ev({
      id: "00000000-0000-0000-0000-000000000501",
      sym: "BBB",
      dir: "sell",
      signalAt: T2,
      close: 210,
      filterState: { score: 2 },
    });
    await card({
      sym: "BBB",
      dir: "buy",
      signalAt: T1,
      price: 200,
      close: 200,
      filterState: { score: 0 },
    });

    await ev({
      id: "00000000-0000-0000-0000-000000000601",
      sym: "CCC",
      dir: "buy",
      signalAt: T1,
      close: 300,
    });
    await card({
      sym: "DDD",
      dir: "sell",
      signalAt: T1,
      price: 400,
      close: 400,
    });
    await card({ sym: "EEE" });

    await ev({
      id: "00000000-0000-0000-0000-000000000701",
      sym: "FFF",
      dir: "buy",
      signalAt: T1,
      close: 500,
    });
    await bar({ sym: "FFF", startsAt: T2, close: 505 });
    await card({
      sym: "FFF",
      dir: "buy",
      signalAt: T1,
      price: 500,
      close: 500,
      latestBarAt: T1,
      latestBarClose: 500,
      barsSinceSignal: 0,
      fresh: false,
      status: "stale",
    });

    await ev({
      id: "00000000-0000-0000-0000-000000000801",
      sym: "GGG",
      dir: "sell",
      signalAt: T1,
      close: 700,
    });
    await bar({ sym: "GGG", startsAt: T1, close: 700 });
    await card({
      sym: "GGG",
      dir: "sell",
      signalAt: T1,
      price: 700,
      close: 700,
      latestBarAt: T2,
      latestBarClose: 710,
      barsSinceSignal: 1,
      fresh: true,
      status: "ok",
    });

    const report = await buildSignalMonitorCurrentCellParityReport({
      profile: { id: PROFILE_ID, environment: "shadow", freshWindowBars: 3 },
      generatedAt: new Date("2026-06-26T12:00:00.000Z"),
      symbols: ["aaa", "bbb", "ccc", "ddd", "eee", "fff", "ggg"],
      timeframes: ["5m"],
    });

    assert.equal(report.counts.comparedCells, 7);
    assert.equal(report.counts.missingStoredCells, 1);
    assert.equal(report.counts.missingDerivedCells, 1);
    assert.equal(report.counts.mismatches, 12);
    assert.deepEqual(
      report.mismatches
        .map(
          (mismatch) =>
            `${mismatch.symbol}:${mismatch.field}:${mismatch.reason}`,
        )
        .sort(),
      [
        "BBB:currentSignalAt:value_mismatch",
        "BBB:currentSignalClose:value_mismatch",
        "BBB:currentSignalDirection:value_mismatch",
        "BBB:currentSignalPrice:value_mismatch",
        "BBB:filterState:value_mismatch",
        "CCC:currentSignalDirection:stored_missing",
        "DDD:currentSignalDirection:derived_missing",
        "FFF:barsSinceSignal:value_mismatch",
        "FFF:fresh:value_mismatch",
        "FFF:latestBarAt:value_mismatch",
        "FFF:latestBarClose:value_mismatch",
        "FFF:status:value_mismatch",
      ],
    );

    const after = await exec(sql`
      SELECT symbol, current_signal_direction, latest_bar_at, latest_bar_close, fresh, status
      FROM signal_monitor_symbol_states
      WHERE profile_id = ${PROFILE_ID} AND symbol IN ('BBB', 'DDD', 'FFF')
      ORDER BY symbol
    `);
    assert.deepEqual(
      (after.rows as Record<string, unknown>[]).map((row) => [
        row["symbol"],
        row["current_signal_direction"],
        row["latest_bar_at"] ? dateIso(row["latest_bar_at"]) : null,
        row["latest_bar_close"] == null
          ? null
          : numeric(row["latest_bar_close"]),
        row["fresh"],
        row["status"],
      ]),
      [
        ["BBB", "buy", null, null, false, "ok"],
        ["DDD", "sell", null, null, false, "ok"],
        ["FFF", "buy", T1, 500, false, "stale"],
      ],
    );
  });
});

test("breadth parity report matches snapshot breadth against seeded event replay", async () => {
  await withTestDb(async ({ db }) => {
    const exec = (q: ReturnType<typeof sql>) => db.execute(q);
    await exec(sql`
      INSERT INTO signal_monitor_profiles (id, environment, enabled)
      VALUES (${PROFILE_ID}, 'shadow', true)
    `);
    const event = async (o: {
      key: string;
      symbol: string;
      direction: "buy" | "sell";
      at: string;
    }) => {
      await exec(sql`
        INSERT INTO signal_monitor_events
          (id, profile_id, event_key, environment, symbol, timeframe, direction, signal_at, payload)
        VALUES (
          gen_random_uuid(), ${PROFILE_ID}, ${"breadth-" + o.key}, 'shadow',
          ${o.symbol}, '5m', ${o.direction}, ${o.at}::timestamptz,
          '{"signalSettingsRevision":1}'::jsonb
        )
      `);
    };
    const state = async (o: {
      symbol: string;
      direction: "buy" | "sell" | null;
      active?: boolean;
    }) => {
      await exec(sql`
        INSERT INTO signal_monitor_symbol_states
          (id, profile_id, signal_settings_revision, symbol, timeframe, active, status, current_signal_direction)
        VALUES (
          gen_random_uuid(), ${PROFILE_ID}, 1, ${o.symbol}, '5m',
          ${o.active ?? true}, 'ok', ${o.direction}
        )
      `);
    };
    const snapshot = async (o: {
      timeframe: string;
      at: string;
      buy: number;
      sell: number;
    }) => {
      await exec(sql`
        INSERT INTO signal_monitor_breadth_snapshots
          (id, environment, timeframe, captured_at, buy, sell, total)
        VALUES (
          gen_random_uuid(), 'shadow', ${o.timeframe}, ${o.at}::timestamptz,
          ${o.buy}, ${o.sell}, ${o.buy + o.sell}
        )
      `);
    };

    await event({
      key: "aaa-seed",
      symbol: "AAA",
      direction: "buy",
      at: "2026-06-25T14:50:00.000Z",
    });
    await event({
      key: "bbb-seed",
      symbol: "BBB",
      direction: "sell",
      at: "2026-06-25T14:55:00.000Z",
    });
    await event({
      key: "aaa-flip",
      symbol: "AAA",
      direction: "sell",
      at: "2026-06-25T15:04:00.000Z",
    });
    await event({
      key: "ccc-inactive",
      symbol: "CCC",
      direction: "buy",
      at: "2026-06-25T14:58:00.000Z",
    });
    await state({ symbol: "AAA", direction: "sell" });
    await state({ symbol: "BBB", direction: "sell" });
    await state({ symbol: "CCC", direction: "buy", active: false });
    for (const timeframe of ["5m", "all"]) {
      await snapshot({
        timeframe,
        at: "2026-06-25T15:00:00.000Z",
        buy: 1,
        sell: 1,
      });
      await snapshot({
        timeframe,
        at: "2026-06-25T15:04:00.000Z",
        buy: 0,
        sell: 2,
      });
    }

    const report = await buildSignalMonitorBreadthParityReport({
      environment: "shadow",
      ranges: ["hour"],
      now: new Date("2026-06-25T16:00:00.000Z"),
    });

    assert.equal(report.counts.ranges, 1);
    assert.equal(report.counts.mismatches, 0);
    assert.ok(report.counts.comparedPoints > 0);
    assert.equal(report.ranges[0]?.snapshotsCoverWindow, true);
    assert.equal(report.ranges[0]?.snapshotRows, 4);
    assert.equal(report.ranges[0]?.seedRows, 2);
    assert.equal(report.ranges[0]?.eventRows, 1);
    assert.deepEqual(report.eventAnchorCoverage, {
      activeCells: 2,
      cellsWithEvent: 2,
      cellsMissingEvent: 0,
      cellsDirectionMismatch: 0,
    });
  });
});

test("breadth parity report classifies snapshot drift by field", async () => {
  await withTestDb(async ({ db }) => {
    const exec = (q: ReturnType<typeof sql>) => db.execute(q);
    await exec(sql`
      INSERT INTO signal_monitor_profiles (id, environment, enabled)
      VALUES (${PROFILE_ID}, 'shadow', true)
    `);
    await exec(sql`
      INSERT INTO signal_monitor_symbol_states
        (id, profile_id, signal_settings_revision, symbol, timeframe, active, status, current_signal_direction)
      VALUES
        (gen_random_uuid(), ${PROFILE_ID}, 1, 'AAA', '5m', true, 'ok', 'sell'),
        (gen_random_uuid(), ${PROFILE_ID}, 1, 'BBB', '5m', true, 'ok', 'sell')
    `);
    await exec(sql`
      INSERT INTO signal_monitor_events
        (id, profile_id, event_key, environment, symbol, timeframe, direction, signal_at, payload)
      VALUES
        (gen_random_uuid(), ${PROFILE_ID}, 'breadth-drift-seed-a', 'shadow', 'AAA', '5m', 'buy', '2026-06-25T14:50:00.000Z'::timestamptz, '{"signalSettingsRevision":1}'::jsonb),
        (gen_random_uuid(), ${PROFILE_ID}, 'breadth-drift-seed-b', 'shadow', 'BBB', '5m', 'sell', '2026-06-25T14:55:00.000Z'::timestamptz, '{"signalSettingsRevision":1}'::jsonb),
        (gen_random_uuid(), ${PROFILE_ID}, 'breadth-drift-flip', 'shadow', 'AAA', '5m', 'sell', '2026-06-25T15:04:00.000Z'::timestamptz, '{"signalSettingsRevision":1}'::jsonb)
    `);
    await exec(sql`
      INSERT INTO signal_monitor_breadth_snapshots
        (id, environment, timeframe, captured_at, buy, sell, total)
      VALUES
        (gen_random_uuid(), 'shadow', 'all', '2026-06-25T15:00:00.000Z'::timestamptz, 1, 1, 2),
        (gen_random_uuid(), 'shadow', 'all', '2026-06-25T15:04:00.000Z'::timestamptz, 1, 1, 2),
        (gen_random_uuid(), 'shadow', '5m', '2026-06-25T15:00:00.000Z'::timestamptz, 1, 1, 2),
        (gen_random_uuid(), 'shadow', '5m', '2026-06-25T15:04:00.000Z'::timestamptz, 1, 1, 2)
    `);

    const report = await buildSignalMonitorBreadthParityReport({
      environment: "shadow",
      ranges: ["hour"],
      now: new Date("2026-06-25T16:00:00.000Z"),
      mismatchLimit: 10,
    });

    assert.equal(report.ranges[0]?.snapshotsCoverWindow, true);
    assert.ok(report.counts.mismatches > 0);
    assert.equal(report.mismatchSummary.byField.buy, 58);
    assert.equal(report.mismatchSummary.byField.sell, 58);
    assert.equal(report.mismatchSummary.byField.net, 58);
    assert.equal(report.mismatchSummary.byReason.value_mismatch, 174);
    assert.deepEqual(
      report.mismatches.slice(0, 3).map((mismatch) => [
        mismatch.range,
        mismatch.timeframe,
        mismatch.field,
        mismatch.reason,
      ]),
      [
        ["hour", "5m", "buy", "value_mismatch"],
        ["hour", "5m", "sell", "value_mismatch"],
        ["hour", "5m", "net", "value_mismatch"],
      ],
    );
  });
});

test("breadth parity report quantifies active cells missing event anchors", async () => {
  await withTestDb(async ({ db }) => {
    const exec = (q: ReturnType<typeof sql>) => db.execute(q);
    await exec(sql`
      INSERT INTO signal_monitor_profiles (id, environment, enabled)
      VALUES (${PROFILE_ID}, 'shadow', true)
    `);
    await exec(sql`
      INSERT INTO signal_monitor_symbol_states
        (id, profile_id, signal_settings_revision, symbol, timeframe, active, status, current_signal_direction)
      VALUES
        (gen_random_uuid(), ${PROFILE_ID}, 1, 'AAA', '5m', true, 'ok', 'buy'),
        (gen_random_uuid(), ${PROFILE_ID}, 1, 'BBB', '5m', true, 'ok', 'buy'),
        (gen_random_uuid(), ${PROFILE_ID}, 1, 'CCC', '5m', false, 'ok', 'sell')
    `);
    await exec(sql`
      INSERT INTO signal_monitor_events
        (id, profile_id, event_key, environment, symbol, timeframe, direction, signal_at, payload)
      VALUES
        (gen_random_uuid(), ${PROFILE_ID}, 'breadth-anchor-bbb', 'shadow', 'BBB', '5m', 'sell', '2026-06-25T15:00:00.000Z'::timestamptz, '{"signalSettingsRevision":1}'::jsonb),
        (gen_random_uuid(), ${PROFILE_ID}, 'breadth-anchor-ccc-inactive', 'shadow', 'CCC', '5m', 'sell', '2026-06-25T15:00:00.000Z'::timestamptz, '{"signalSettingsRevision":1}'::jsonb)
    `);

    const report = await buildSignalMonitorBreadthParityReport({
      environment: "shadow",
      ranges: ["hour"],
      now: new Date("2026-06-25T16:00:00.000Z"),
      mismatchLimit: 0,
    });

    assert.deepEqual(report.eventAnchorCoverage, {
      activeCells: 2,
      cellsWithEvent: 1,
      cellsMissingEvent: 1,
      cellsDirectionMismatch: 1,
    });
  });
});

test("event-anchor backfill planner is dry-run and explains missing anchors", async () => {
  await withTestDb(async ({ db }) => {
    const exec = (q: ReturnType<typeof sql>) => db.execute(q);
    await exec(sql`
      INSERT INTO signal_monitor_profiles (id, environment, enabled)
      VALUES (${PROFILE_ID}, 'shadow', true)
    `);
    await exec(sql`
      INSERT INTO signal_monitor_symbol_states
        (id, profile_id, signal_settings_revision, symbol, timeframe, active, status, current_signal_direction,
         current_signal_at, current_signal_price, current_signal_close, filter_state)
      VALUES
        (gen_random_uuid(), ${PROFILE_ID}, 1, 'AAA', '5m', true, 'ok', 'buy',
          '2026-06-25T15:00:00.000Z'::timestamptz, 100, 101, '{"score":1}'::jsonb),
        (gen_random_uuid(), ${PROFILE_ID}, 1, 'BBB', '5m', true, 'ok', 'buy',
          '2026-06-25T15:05:00.000Z'::timestamptz, 200, 201, '{"score":2}'::jsonb),
        (gen_random_uuid(), ${PROFILE_ID}, 1, 'CCC', '5m', true, 'ok', 'sell',
          NULL, 300, 301, '{}'::jsonb),
        (gen_random_uuid(), ${PROFILE_ID}, 1, 'DDD', '5m', false, 'ok', 'sell',
          '2026-06-25T15:10:00.000Z'::timestamptz, 400, 401, '{}'::jsonb)
    `);
    await exec(sql`
      INSERT INTO signal_monitor_events
        (id, profile_id, event_key, environment, symbol, timeframe, direction, signal_at, payload)
      VALUES
        (gen_random_uuid(), ${PROFILE_ID}, 'event-anchor-plan-bbb', 'shadow', 'BBB', '5m', 'sell', '2026-06-25T15:01:00.000Z'::timestamptz, '{"signalSettingsRevision":1}'::jsonb),
        (gen_random_uuid(), ${PROFILE_ID}, 'event-anchor-plan-ddd-inactive', 'shadow', 'DDD', '5m', 'sell', '2026-06-25T15:10:00.000Z'::timestamptz, '{"signalSettingsRevision":1}'::jsonb)
    `);

    const before = await exec(sql`select count(*)::int as n from signal_monitor_events`);
    const plan = await buildSignalMonitorEventAnchorBackfillPlan({
      environment: "shadow",
      generatedAt: new Date("2026-06-26T12:00:00.000Z"),
      candidateLimit: 10,
    });
    const after = await exec(sql`select count(*)::int as n from signal_monitor_events`);

    assert.equal(plan.dryRun, true);
    assert.deepEqual(plan.counts, {
      activeCellsNeedingAnchor: 3,
      candidateEvents: 2,
      skippedNoSignalAt: 1,
      sampledCandidates: 2,
      sampledSkipped: 1,
    });
    assert.deepEqual(plan.applied, {
      attemptedEvents: 0,
      insertedEvents: 0,
      skippedExistingEvents: 0,
    });
    assert.deepEqual(
      plan.candidates.map((candidate) => [
        candidate.symbol,
        candidate.timeframe,
        candidate.reason,
        candidate.direction,
        candidate.signalAt,
        candidate.close,
      ]),
      [
        ["AAA", "5m", "missing_event_anchor", "buy", "2026-06-25T15:00:00.000Z", 101],
        ["BBB", "5m", "latest_direction_mismatch", "buy", "2026-06-25T15:05:00.000Z", 201],
      ],
    );
    assert.equal(plan.skipped[0]?.symbol, "CCC");
    assert.equal(plan.skipped[0]?.reason, "missing_signal_at");
    assert.equal(Number((before.rows[0] as Record<string, unknown>).n), 2);
    assert.equal(Number((after.rows[0] as Record<string, unknown>).n), 2);
  });
});

test("event-anchor backfill apply inserts synthetic anchors", async () => {
  await withTestDb(async ({ db }) => {
    const exec = (q: ReturnType<typeof sql>) => db.execute(q);
    await exec(sql`
      INSERT INTO signal_monitor_profiles (id, environment, enabled)
      VALUES (${PROFILE_ID}, 'shadow', true)
    `);
    await exec(sql`
      INSERT INTO signal_monitor_symbol_states
        (id, profile_id, signal_settings_revision, symbol, timeframe, active, status, current_signal_direction,
         current_signal_at, current_signal_price, current_signal_close, filter_state)
      VALUES
        (gen_random_uuid(), ${PROFILE_ID}, 1, 'AAA', '5m', true, 'ok', 'buy',
          '2026-06-25T15:00:00.000Z'::timestamptz, 100, 101, '{"score":1}'::jsonb),
        (gen_random_uuid(), ${PROFILE_ID}, 1, 'BBB', '5m', true, 'ok', 'buy',
          '2026-06-25T15:05:00.000Z'::timestamptz, 200, 201, '{"score":2}'::jsonb)
    `);
    await exec(sql`
      INSERT INTO signal_monitor_events
        (id, profile_id, event_key, environment, symbol, timeframe, direction, signal_at, payload)
      VALUES
        (gen_random_uuid(), ${PROFILE_ID}, 'event-anchor-apply-bbb', 'shadow', 'BBB', '5m', 'sell', '2026-06-25T15:01:00.000Z'::timestamptz, '{"signalSettingsRevision":1}'::jsonb)
    `);

    const plan = await buildSignalMonitorEventAnchorBackfillPlan({
      environment: "shadow",
      generatedAt: new Date("2026-06-26T12:00:00.000Z"),
      candidateLimit: 10,
      apply: true,
    });
    const inserted = await exec(sql`
      SELECT event_key, symbol, direction, signal_at, signal_price, close, source, payload
      FROM signal_monitor_events
      WHERE source = 'state-anchor-backfill'
      ORDER BY symbol
    `);
    const afterPlan = await buildSignalMonitorEventAnchorBackfillPlan({
      environment: "shadow",
      generatedAt: new Date("2026-06-26T12:05:00.000Z"),
      candidateLimit: 10,
    });

    assert.equal(plan.dryRun, false);
    assert.deepEqual(plan.counts, {
      activeCellsNeedingAnchor: 2,
      candidateEvents: 2,
      skippedNoSignalAt: 0,
      sampledCandidates: 2,
      sampledSkipped: 0,
    });
    assert.deepEqual(plan.applied, {
      attemptedEvents: 2,
      insertedEvents: 2,
      skippedExistingEvents: 0,
    });
    assert.equal(inserted.rows.length, 2);
    assert.deepEqual(
      inserted.rows.map((row) => [
        row.symbol,
        row.direction,
        dateIso(row.signal_at),
        numeric(row.signal_price),
        numeric(row.close),
        row.source,
      ]),
      [
        [
          "AAA",
          "buy",
          "2026-06-25T15:00:00.000Z",
          100,
          101,
          "state-anchor-backfill",
        ],
        [
          "BBB",
          "buy",
          "2026-06-25T15:05:00.000Z",
          200,
          201,
          "state-anchor-backfill",
        ],
      ],
    );
    assert.equal(
      String((inserted.rows[0] as Record<string, unknown>).event_key).startsWith(
        "state-anchor:",
      ),
      true,
    );
    assert.deepEqual(
      ((inserted.rows[0] as Record<string, unknown>).payload as Record<string, unknown>)
        .filterState,
      { score: 1 },
    );
    assert.equal(
      (((inserted.rows[1] as Record<string, unknown>).payload as Record<string, unknown>)
        .stateAnchorBackfill as Record<string, unknown>).reason,
      "latest_direction_mismatch",
    );
    assert.equal(afterPlan.counts.activeCellsNeedingAnchor, 0);
    assert.equal(afterPlan.counts.candidateEvents, 0);
  });
});

test("state reconciliation inserts event anchors for active latched cells", async () => {
  await withTestDb(async ({ db }) => {
    const exec = (q: ReturnType<typeof sql>) => db.execute(q);
    await exec(sql`
      INSERT INTO signal_monitor_profiles (id, environment, enabled)
      VALUES (${PROFILE_ID}, 'shadow', true)
    `);
    await exec(sql`
      INSERT INTO signal_monitor_symbol_states
        (id, profile_id, signal_settings_revision, symbol, timeframe, active, status, current_signal_direction,
         current_signal_at, current_signal_price, current_signal_close, filter_state)
      VALUES
        (gen_random_uuid(), ${PROFILE_ID}, 1, 'AAA', '5m', true, 'ok', 'buy',
          '2026-06-25T15:00:00.000Z'::timestamptz, 100, 101, '{"score":1}'::jsonb),
        (gen_random_uuid(), ${PROFILE_ID}, 1, 'BBB', '5m', true, 'ok', 'buy',
          '2026-06-25T15:05:00.000Z'::timestamptz, 200, 201, '{"score":2}'::jsonb),
        (gen_random_uuid(), ${PROFILE_ID}, 1, 'CCC', '5m', false, 'ok', 'sell',
          '2026-06-25T15:10:00.000Z'::timestamptz, 300, 301, '{}'::jsonb)
    `);
    await exec(sql`
      INSERT INTO signal_monitor_events
        (id, profile_id, event_key, environment, symbol, timeframe, direction, signal_at, payload)
      VALUES
        (gen_random_uuid(), ${PROFILE_ID}, 'reconcile-anchor-bbb-old', 'shadow', 'BBB', '5m', 'sell', '2026-06-25T15:01:00.000Z'::timestamptz, '{"signalSettingsRevision":1}'::jsonb),
        (gen_random_uuid(), ${PROFILE_ID}, 'reconcile-anchor-ccc-inactive', 'shadow', 'CCC', '5m', 'sell', '2026-06-25T15:10:00.000Z'::timestamptz, '{"signalSettingsRevision":1}'::jsonb)
    `);

    const firstRun = await reconcileSignalMonitorSymbolStatesFromCanonicalEvents({
      dryRun: false,
    });
    const inserted = await exec(sql`
      SELECT event_key, symbol, direction, signal_at, source, payload
      FROM signal_monitor_events
      WHERE source = 'state-anchor-backfill'
      ORDER BY symbol
    `);
    const secondRun = await reconcileSignalMonitorSymbolStatesFromCanonicalEvents({
      dryRun: false,
    });
    const insertedAfterSecondRun = await exec(sql`
      SELECT count(*)::int AS n
      FROM signal_monitor_events
      WHERE source = 'state-anchor-backfill'
    `);

    assert.equal(firstRun[0]?.eventAnchorsInserted, 2);
    assert.equal(secondRun[0]?.eventAnchorsInserted, 0);
    assert.equal(inserted.rows.length, 2);
    assert.deepEqual(
      inserted.rows.map((row) => [
        row.symbol,
        row.direction,
        dateIso(row.signal_at),
        row.source,
        ((row.payload as Record<string, unknown>).stateAnchorBackfill as Record<
          string,
          unknown
        >).reason,
      ]),
      [
        [
          "AAA",
          "buy",
          "2026-06-25T15:00:00.000Z",
          "state-anchor-backfill",
          "missing_event_anchor",
        ],
        [
          "BBB",
          "buy",
          "2026-06-25T15:05:00.000Z",
          "state-anchor-backfill",
          "latest_direction_mismatch",
        ],
      ],
    );
    assert.equal(
      Number((insertedAfterSecondRun.rows[0] as Record<string, unknown>).n),
      2,
    );
  });
});

test("stored-state reconciliation is opt-in at startup", () => {
  assert.match(SOURCE, /PYRUS_SIGNAL_MONITOR_STATE_RECONCILE_ON_STARTUP/);
  assert.match(
    SOURCE,
    /if \(!signalMonitorStateReconciliationOnStartupEnabled\(\)\) \{/,
  );
});
