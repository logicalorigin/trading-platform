import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";

import { pool } from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";
import { sql } from "drizzle-orm";
import { __signalMonitorInternalsForTests } from "./signal-monitor";
import { __stockAggregateStreamTestInternals } from "./stock-aggregate-stream";

const evaluatedAt = new Date("2026-06-09T15:00:00.000Z");
const fastFlushMs =
  __signalMonitorInternalsForTests.SIGNAL_MONITOR_MATRIX_STREAM_FLUSH_MS;
// Pin trading-day semantics: blocker assertions (signal_too_old/data_stale)
// must not flip to market_closed when the suite runs on a holiday/weekend.
__signalMonitorInternalsForTests.setSignalMonitorQuietMarketSessionNowForTests(
  false,
);
const routeSource = readFileSync(
  new URL("../routes/signal-monitor.ts", import.meta.url),
  "utf8",
);
const serviceSource = readFileSync(
  new URL("./signal-monitor.ts", import.meta.url),
  "utf8",
);

after(async () => {
  await pool.end();
});

test("signal monitor routes do not expose on-demand matrix evaluation", () => {
  assert.doesNotMatch(routeSource, /router\.post\("\/signal-monitor\/matrix"/);
  assert.doesNotMatch(routeSource, /await evaluateSignalMonitorMatrix/);
});

test("signal monitor state route does not serve cached matrix state responses", () => {
  const stateRouteStart = routeSource.indexOf(
    'router.get("/signal-monitor/state"',
  );
  const stateRouteEnd = routeSource.indexOf(
    'router.get("/signal-monitor/breadth-history"',
    stateRouteStart,
  );
  assert.notEqual(stateRouteStart, -1);
  assert.notEqual(stateRouteEnd, -1);
  const stateRoute = routeSource.slice(stateRouteStart, stateRouteEnd);

  assert.doesNotMatch(routeSource, /signalMonitorStateReadCache/);
  assert.doesNotMatch(routeSource, /getCachedSerializedSignalMonitorState/);
  assert.doesNotMatch(routeSource, /SIGNAL_MONITOR_STATE_CACHE_TTL_MS/);
  // Fresh read (not a cached matrix-state response), serialized directly. The
  // route no longer re-validates the full ~12k-state payload with zod on the hot
  // event loop — that reflective re-walk was the primary source of the periodic
  // ~1s /state event-loop stalls. The response-shape contract is enforced off the
  // hot path by signal-monitor-state-serialize.test.ts (byte-parity vs the schema).
  assert.match(
    stateRoute,
    /JSON\.stringify\(\s*await getSignalMonitorState\(/s,
  );
  assert.doesNotMatch(stateRoute, /GetSignalMonitorStateResponse\.parse/);
});

test("signal matrix stream signature includes latest bar close for STA move hydration", () => {
  const signatureStart = serviceSource.indexOf(
    "function signalMonitorMatrixStreamStateSignature",
  );
  const signatureEnd = serviceSource.indexOf(
    "function withSignalMonitorMatrixStreamActionability",
    signatureStart,
  );
  assert.notEqual(signatureStart, -1);
  assert.notEqual(signatureEnd, -1);
  const signatureBlock = serviceSource.slice(signatureStart, signatureEnd);

  assert.match(signatureBlock, /currentSignalClose: state\.currentSignalClose/);
  assert.match(signatureBlock, /latestBarClose: state\.latestBarClose/);
  assert.match(
    signatureBlock,
    /currentSignalMfePercent: state\.currentSignalMfePercent/,
  );
  assert.match(
    signatureBlock,
    /currentSignalMaePercent: state\.currentSignalMaePercent/,
  );
});

test("stable stock history reuses converted minute bars across stream flushes", () => {
  __stockAggregateStreamTestInternals.reset();
  __stockAggregateStreamTestInternals.ingestAggregateForTests({
    eventType: "stock-minute-aggregate",
    symbol: "SPY",
    startMs: evaluatedAt.getTime() - 60_000,
    endMs: evaluatedAt.getTime() - 1,
    open: 100,
    high: 101,
    low: 99,
    close: 100.5,
    volume: 1_000,
    accumulatedVolume: 1_000,
    vwap: 100.5,
    sessionVwap: 100.5,
    officialOpen: 100,
    averageTradeSize: null,
    source: "massive-websocket",
    delayed: false,
  });
  const load = () =>
    __signalMonitorInternalsForTests.loadSignalMonitorStreamSourceMinuteBars({
      symbol: "SPY",
      evaluatedAt,
      historyLimit: 240,
    });

  const first =
    __signalMonitorInternalsForTests.withSignalMonitorStreamSourceMinuteBarsMemo(
      load,
    );
  const second =
    __signalMonitorInternalsForTests.withSignalMonitorStreamSourceMinuteBarsMemo(
      load,
    );

  assert.equal(first.length, 1);
  assert.strictEqual(second[0], first[0]);

  __stockAggregateStreamTestInternals.ingestAggregateForTests({
    eventType: "stock-minute-aggregate",
    symbol: "SPY",
    startMs: evaluatedAt.getTime() - 60_000,
    endMs: evaluatedAt.getTime() - 1,
    open: 100,
    high: 102,
    low: 99,
    close: 101.5,
    volume: 1_200,
    accumulatedVolume: 1_200,
    vwap: 101,
    sessionVwap: 101,
    officialOpen: 100,
    averageTradeSize: null,
    source: "massive-websocket",
    delayed: false,
  });
  const corrected =
    __signalMonitorInternalsForTests.withSignalMonitorStreamSourceMinuteBarsMemo(
      load,
    );
  assert.notStrictEqual(corrected[0], first[0]);
  assert.equal(corrected[0]?.close, 101.5);
  __stockAggregateStreamTestInternals.reset();
});

test("signal matrix stream status uses a source bootstrap state, not fallback", () => {
  const statusTypeStart = serviceSource.indexOf(
    "type SignalMonitorMatrixStreamSourceState",
  );
  const statusTypeEnd = serviceSource.indexOf(
    "export type SignalMonitorMatrixStreamScope",
    statusTypeStart,
  );
  const statusStart = serviceSource.indexOf(
    "export function getSignalMonitorMatrixStreamStatus",
  );
  const statusEnd = serviceSource.indexOf(
    "export function buildSignalMonitorMatrixStreamCoverage",
    statusStart,
  );
  assert.notEqual(statusTypeStart, -1);
  assert.notEqual(statusTypeEnd, -1);
  assert.notEqual(statusStart, -1);
  assert.notEqual(statusEnd, -1);
  const statusTypeBlock = serviceSource.slice(statusTypeStart, statusTypeEnd);
  const statusBlock = serviceSource.slice(statusStart, statusEnd);

  assert.doesNotMatch(statusTypeBlock, /bootstrap-fallback|fallbackState/);
  assert.doesNotMatch(statusBlock, /bootstrap-fallback|fallbackState/);
  assert.match(statusTypeBlock, /"bootstrap"/);
  assert.match(
    statusBlock,
    /const state = available \? "open" : "unavailable";/,
  );
  assert.match(statusBlock, /sourceState/);
});

test("signal matrix stream coverage avoids full aggregate diagnostics on delta flushes", () => {
  const coverageStart = serviceSource.indexOf(
    "export function buildSignalMonitorMatrixStreamCoverage",
  );
  const coverageEnd = serviceSource.indexOf(
    "export function buildSignalMonitorMatrixStreamBootstrapEvent",
    coverageStart,
  );
  assert.notEqual(coverageStart, -1);
  assert.notEqual(coverageEnd, -1);
  const coverageBlock = serviceSource.slice(coverageStart, coverageEnd);

  assert.match(coverageBlock, /getSignalMonitorMatrixStreamCoverageStatus\(\)/);
  assert.doesNotMatch(coverageBlock, /getSignalMonitorMatrixStreamStatus\(/);
  assert.doesNotMatch(coverageBlock, /getStockAggregateStreamDiagnostics\(/);
});

test("matrix aggregate queue drops unchanged forming updates before scheduling", () => {
  const start = serviceSource.indexOf(
    "function queueSignalMonitorMatrixStreamAggregate",
  );
  const end = serviceSource.indexOf(
    "async function resolveSignalMonitorMatrixStreamProfile",
    start,
  );
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const block = serviceSource.slice(start, end);

  assert.match(
    block,
    /const completedInputChanged = recordSignalMonitorAggregateRevision\(/,
  );
  assert.match(block, /if \(!completedInputChanged\) \{\s*return;\s*\}/);
  assert.ok(
    block.indexOf("if (!completedInputChanged)") <
      block.indexOf("for (const subscriber"),
  );
});

test("signal matrix coverage-status helper restores delayed semantics without full diagnostics", () => {
  const helperStart = serviceSource.indexOf(
    "function getSignalMonitorMatrixStreamCoverageStatus",
  );
  const helperEnd = serviceSource.indexOf(
    "export function buildSignalMonitorMatrixStreamCoverage",
    helperStart,
  );
  assert.notEqual(helperStart, -1);
  assert.notEqual(helperEnd, -1);
  const helperBlock = serviceSource.slice(helperStart, helperEnd);

  // Perf win preserved: the coverage path must not fall back to the full
  // diagnostics/status helpers to derive delayed-ness.
  assert.doesNotMatch(helperBlock, /getSignalMonitorMatrixStreamStatus\(/);
  assert.doesNotMatch(helperBlock, /getStockAggregateStreamDiagnostics\(/);
  // Uses the O(1) active-source accessor instead.
  assert.match(helperBlock, /getActiveStockAggregateStreamSource\(\)/);
  // Restored semantics: delayed when EITHER the preferred source or the active
  // provider is the delayed websocket feed.
  assert.match(helperBlock, /source === "massive-delayed-websocket"/);
  assert.match(helperBlock, /activeProvider === "massive-delayed-websocket"/);
});

test("signal matrix persistence failures update DB fallback diagnostics", () => {
  const persistStart = serviceSource.indexOf(
    "async function persistSignalMonitorMatrixStatesBestEffort",
  );
  const persistEnd = serviceSource.indexOf(
    "// Coalescing single-flight for state persistence",
    persistStart,
  );
  assert.notEqual(persistStart, -1);
  assert.notEqual(persistEnd, -1);
  const persistBlock = serviceSource.slice(persistStart, persistEnd);

  assert.match(
    persistBlock,
    /if \(!isSignalMonitorUuidLike\(input\.profile\.id\)\) \{\s*return "success";/s,
  );
  assert.match(persistBlock, /\? "retryable-failure"\s*: "terminal-failure"/s);
  assert.match(persistBlock, /recordSignalMonitorDbFallback\(\s*error,\s*\{/s);
  assert.match(
    persistBlock,
    /operation:\s*"persist_signal_monitor_matrix_states"/,
  );
  assert.match(persistBlock, /sourceStatus:\s*"persistence-failed"/);
});

test("signal matrix persistence cannot disable the stored signal latch from candidate trust", () => {
  const persistStart = serviceSource.indexOf(
    "async function persistSignalMonitorMatrixStatesBestEffort",
  );
  const persistEnd = serviceSource.indexOf(
    "// Coalescing single-flight for state persistence",
    persistStart,
  );
  assert.notEqual(persistStart, -1);
  assert.notEqual(persistEnd, -1);
  const persistBlock = serviceSource.slice(persistStart, persistEnd);

  assert.doesNotMatch(
    persistBlock,
    /signalIdentityTrusted\s*&&\s*latestBarTrusted/,
  );
  assert.doesNotMatch(persistBlock, /allowStoredSignalLatch/);
  assert.match(
    persistBlock,
    /fresh:\s*latestBarTrusted\s*&&\s*status === "ok"/,
  );
});

test("non-durable stream profiles do not enqueue DB persistence", () => {
  const emitStart = serviceSource.indexOf(
    "export function emitSignalMonitorMatrixStreamAggregateDelta",
  );
  const emitEnd = serviceSource.indexOf("persistByProfile.forEach", emitStart);
  assert.notEqual(emitStart, -1);
  assert.notEqual(emitEnd, -1);
  const emitBlock = serviceSource.slice(emitStart, emitEnd);

  assert.match(
    emitBlock,
    /if \(isSignalMonitorUuidLike\(subscriber\.profile\.id\)\) \{/,
  );
});

test("server-owned producer persists direction flips through the canonical path", async () => {
  await withTestDb(async ({ db }) => {
    const profileId = "00000000-0000-4000-8000-0000000000c1";
    await db.execute(sql`
      INSERT INTO signal_monitor_profiles
        (id, environment, enabled, fresh_window_bars)
      VALUES (${profileId}, 'shadow', true, 3)
    `);
    const scope =
      __signalMonitorInternalsForTests.normalizeSignalMonitorMatrixStreamScope({
        environment: "shadow",
        cells: [{ symbol: "AAPL", timeframe: "5m" }] as never,
      });
    const subscription =
      __signalMonitorInternalsForTests.createSignalMonitorMatrixStreamSubscriptionForTests(
        {
          scope,
          profile: {
            ...profile(profileId),
            id: profileId,
            freshWindowBars: 3,
          } as never,
          prime: false,
          serverOwnedProducer: true,
          onEvent: () => {
            throw new Error("server-owned producer should not emit SSE events");
          },
        },
      );
    let direction: "buy" | "sell" = "buy";
    const makeState = (lastEvaluatedAt: Date) => {
      const signalAt =
        direction === "buy"
          ? new Date("2026-06-09T14:55:00.000Z")
          : new Date("2026-06-09T15:00:00.000Z");
      const latestBarAt =
        direction === "buy"
          ? new Date("2026-06-09T15:00:00.000Z")
          : new Date("2026-06-09T15:05:00.000Z");
      return {
        ...streamState("AAPL", "5m", ""),
        profileId,
        currentSignalDirection: direction,
        currentSignalAt: signalAt,
        currentSignalPrice: 100,
        currentSignalClose: 101,
        latestBarAt,
        latestBarClose: 102,
        barsSinceSignal: 0,
        fresh: true,
        status: "ok",
        lastEvaluatedAt,
        lastError: null,
        latestBarSourceIntegrity: { trusted: true, reason: null },
        canonicalSignalEvent: {
          signal: {
            id: `event-${direction}`,
            eventType: direction === "buy" ? "buy_signal" : "sell_signal",
            direction,
            barIndex: 1,
            time: Math.floor(signalAt.getTime() / 1000),
            ts: signalAt.toISOString(),
            price: 100,
            close: 101,
            actionable: true,
            filtered: false,
            filterState: {},
          },
          signalAt,
          signalBarAt: signalAt,
          latestBarAt,
          latestBarAnchorAt: latestBarAt,
          sourceBarPartial: false,
          sourceIntegrity: { trusted: true, reason: null },
        },
      } as any;
    };

    __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta(
      {
        message: { symbol: "AAPL" },
        environment: "shadow",
        evaluatedAt: new Date("2026-06-09T15:00:00.000Z"),
        evaluateState: ({ evaluatedAt }) => makeState(evaluatedAt),
      },
    );
    direction = "sell";
    __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta(
      {
        message: { symbol: "AAPL" },
        environment: "shadow",
        evaluatedAt: new Date("2026-06-09T15:05:00.000Z"),
        evaluateState: ({ evaluatedAt }) => makeState(evaluatedAt),
      },
    );

    await __signalMonitorInternalsForTests.waitForSignalMonitorPersistIdleForTests();

    const states = await db.execute(sql`
      SELECT current_signal_direction, last_evaluated_at
      FROM signal_monitor_symbol_states
      WHERE profile_id = ${profileId}
        AND symbol = 'AAPL'
        AND timeframe = '5m'
    `);
    const events = await db.execute(sql`
      SELECT direction
      FROM signal_monitor_events
      WHERE profile_id = ${profileId}
      ORDER BY signal_at
    `);

    subscription.unsubscribe();
    assert.equal(states.rows[0]?.current_signal_direction, "sell");
    assert.equal(
      new Date(String(states.rows[0]?.last_evaluated_at)).toISOString(),
      "2026-06-09T15:05:00.000Z",
    );
    assert.deepEqual(
      events.rows.map((row) => row.direction),
      ["buy", "sell"],
    );
  });
});

test("B3: subscriber SSE delta persists identity changes plus coarse freshness heartbeats", async () => {
  await withTestDb(async ({ db }) => {
    __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
    const profileId = "00000000-0000-4000-8000-0000000000b3";
    // signal_monitor_symbol_states FKs to signal_monitor_profiles; the async
    // persist drains into this test DB, so the enqueue counter is the observation.
    await db.execute(sql`
      INSERT INTO signal_monitor_profiles (id, environment, enabled, fresh_window_bars)
      VALUES (${profileId}, 'shadow', true, 3)
    `);
    const scope =
      __signalMonitorInternalsForTests.normalizeSignalMonitorMatrixStreamScope({
        environment: "shadow",
        symbols: ["AAPL"],
        timeframes: ["5m"],
      });
    const events: unknown[] = [];
    const subscription =
      __signalMonitorInternalsForTests.createSignalMonitorMatrixStreamSubscriptionForTests(
        {
          scope,
          profile: { ...profile(profileId), id: profileId } as never,
          prime: false,
          onEvent(event) {
            events.push(event);
          },
        },
      );
    // This test observes enqueue gating, not SQL persistence. Keep its drain
    // deterministic; the real DB boundary is covered by the warmed-trend test.
    __signalMonitorInternalsForTests.setSignalMonitorPersistWorkerForTests(
      async () => "success",
    );

    const emit = (evaluatedAt: Date, overrides: Record<string, unknown>) => {
      __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta(
        {
          message: { symbol: "AAPL" },
          environment: "shadow",
          evaluatedAt,
          evaluateState: (input: { symbol: string; timeframe: string }) =>
            ({
              ...directionalStreamState(
                input.symbol,
                input.timeframe,
                overrides,
              ),
              profileId,
            }) as never,
        },
      );
    };

    __signalMonitorInternalsForTests.resetSignalMonitorPersistScheduleStatsForTests();

    // 1) baseline: new cell → SSE delivered + persist enqueued.
    emit(new Date("2026-06-09T15:00:00.000Z"), {});
    const afterBaseline =
      __signalMonitorInternalsForTests.getSignalMonitorPersistScheduleStatsForTests();
    assert.equal(events.length, 1, "baseline SSE delivered");
    assert.equal(afterBaseline.states, 1, "baseline enqueues a persist");

    // 2) history warmup resolves a previously-null trend on the same signal/bar
    // identity. That is durable state, so it must bypass the display-only gate.
    emit(new Date("2026-06-09T15:00:15.000Z"), {
      indicatorSnapshot: { trendDirection: "bullish" },
    });
    const afterTrend =
      __signalMonitorInternalsForTests.getSignalMonitorPersistScheduleStatsForTests();
    assert.equal(events.length, 2, "trend delta is delivered over SSE");
    assert.equal(
      afterTrend.states - afterBaseline.states,
      1,
      "null-to-warmed trend enqueues a persist immediately",
    );

    // 3) display-only change (mfe moved) — identity/freshness bucket unchanged,
    // so the persist dirty-key is unchanged.
    emit(new Date("2026-06-09T15:00:30.000Z"), {
      currentSignalMfePercent: 3.21,
      indicatorSnapshot: { trendDirection: "bullish" },
    });
    const afterDisplay =
      __signalMonitorInternalsForTests.getSignalMonitorPersistScheduleStatsForTests();
    assert.equal(
      events.length,
      3,
      "display-only delta still delivered over SSE",
    );
    assert.equal(
      afterDisplay.states - afterTrend.states,
      0,
      "display-only change enqueues NO persist",
    );

    // 4) pure latestBarAt/status churn inside the 5-minute heartbeat bucket is
    // durability-neutral: signal identity is unchanged and bounded freshness is
    // still covered by the next heartbeat.
    emit(new Date("2026-06-09T15:01:00.000Z"), {
      latestBarAt: new Date("2026-06-09T15:01:00.000Z"),
      status: "stale",
      indicatorSnapshot: { trendDirection: "bullish" },
    });
    const afterChurn =
      __signalMonitorInternalsForTests.getSignalMonitorPersistScheduleStatsForTests();
    assert.equal(events.length, 4, "bar-advance delta delivered over SSE");
    assert.equal(
      afterChurn.states - afterDisplay.states,
      0,
      "pure latestBarAt/status churn inside the heartbeat enqueues NO persist",
    );

    // 5) heartbeat boundary → bounded freshness write.
    emit(new Date("2026-06-09T15:05:00.000Z"), {
      latestBarAt: new Date("2026-06-09T15:05:00.000Z"),
      indicatorSnapshot: { trendDirection: "bullish" },
    });
    const afterHeartbeat =
      __signalMonitorInternalsForTests.getSignalMonitorPersistScheduleStatsForTests();
    assert.equal(events.length, 5, "heartbeat delta delivered over SSE");
    assert.equal(
      afterHeartbeat.states - afterChurn.states,
      1,
      "5-minute freshness heartbeat enqueues a persist",
    );

    // 6) signal identity change → immediate persist, independent of heartbeat.
    emit(new Date("2026-06-09T15:05:30.000Z"), {
      currentSignalDirection: "sell",
      currentSignalAt: new Date("2026-06-09T15:05:00.000Z"),
      latestBarAt: new Date("2026-06-09T15:05:00.000Z"),
      indicatorSnapshot: { trendDirection: "bullish" },
    });
    const afterIdentity =
      __signalMonitorInternalsForTests.getSignalMonitorPersistScheduleStatsForTests();
    assert.equal(events.length, 6, "identity-change delta delivered over SSE");
    assert.equal(
      afterIdentity.states - afterHeartbeat.states,
      1,
      "signal identity change enqueues a persist immediately",
    );

    // The enqueued persists drain un-awaited; wait for idle BEFORE withTestDb
    // closes the PGlite instance and restores the real db, or the drain races
    // the close (suite hang / drain leaking onto the real pool).
    await __signalMonitorInternalsForTests.waitForSignalMonitorPersistIdleForTests();

    subscription.unsubscribe();
    __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
  });
});

test("a shallow live evaluation cannot erase a warmed durable trend", async () => {
  await withTestDb(async ({ db }) => {
    __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
    const profileId = "00000000-0000-4000-8000-0000000000d4";
    await db.execute(sql`
      INSERT INTO signal_monitor_profiles (id, environment, enabled, fresh_window_bars)
      VALUES (${profileId}, 'shadow', true, 3)
    `);
    await db.execute(sql`
      INSERT INTO signal_monitor_symbol_states
        (profile_id, symbol, timeframe, current_signal_direction,
         current_signal_at, latest_bar_at, last_evaluated_at, status,
         active, trend_direction)
      VALUES
        (${profileId}, 'AAPL', '5m', 'buy',
         '2026-06-09T14:55:00.000Z', '2026-06-09T15:00:00.000Z',
         '2026-06-09T15:00:00.000Z', 'ok', true, 'bullish')
    `);
    const scope =
      __signalMonitorInternalsForTests.normalizeSignalMonitorMatrixStreamScope({
        environment: "shadow",
        cells: [{ symbol: "AAPL", timeframe: "5m" }] as never,
      });
    const subscription =
      __signalMonitorInternalsForTests.createSignalMonitorMatrixStreamSubscriptionForTests(
        {
          scope,
          profile: { ...profile(profileId), id: profileId } as never,
          prime: false,
          serverOwnedProducer: true,
          onEvent: () => undefined,
        },
      );

    __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta(
      {
        message: { symbol: "AAPL" },
        environment: "shadow",
        evaluatedAt: new Date("2026-06-09T15:05:00.000Z"),
        evaluateState: () =>
          directionalStreamState("AAPL", "5m", {
            profileId,
            latestBarAt: new Date("2026-06-09T15:05:00.000Z"),
            lastEvaluatedAt: new Date("2026-06-09T15:05:00.000Z"),
            // A shallow/unwarmed evaluation has no measured trend.
            indicatorSnapshot: { trendDirection: null },
          }),
      },
    );
    await __signalMonitorInternalsForTests.waitForSignalMonitorPersistIdleForTests();

    const result = await db.execute(sql`
      SELECT trend_direction, latest_bar_at
      FROM signal_monitor_symbol_states
      WHERE profile_id = ${profileId}
        AND symbol = 'AAPL'
        AND timeframe = '5m'
    `);
    assert.equal(result.rows[0]?.trend_direction, "bullish");
    assert.equal(
      new Date(String(result.rows[0]?.latest_bar_at)).toISOString(),
      "2026-06-09T15:05:00.000Z",
    );

    subscription.unsubscribe();
    __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
  });
});

test("transient persistence failure requeues the latest cell state", async () => {
  __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
  const internals = __signalMonitorInternalsForTests as unknown as {
    setSignalMonitorPersistWorkerForTests(
      worker:
        | ((input: {
            states: Array<{ latestBarAt: Date }>;
          }) => Promise<"success" | "retryable-failure" | "terminal-failure">)
        | null,
    ): void;
    schedulePersistSignalMonitorMatrixStatesForTests(input: {
      profile: ReturnType<typeof profile>;
      states: unknown[];
      evaluatedAt: Date;
    }): void;
  };
  const attempts: string[] = [];
  internals.setSignalMonitorPersistWorkerForTests(async ({ states }) => {
    attempts.push(states[0]!.latestBarAt.toISOString());
    return attempts.length > 1 ? "success" : "retryable-failure";
  });
  try {
    internals.schedulePersistSignalMonitorMatrixStatesForTests({
      profile: profile("00000000-0000-4000-8000-0000000000d5"),
      states: [
        directionalStreamState("AAPL", "5m", {
          latestBarAt: new Date("2026-06-09T15:00:00.000Z"),
        }),
      ],
      evaluatedAt: new Date("2026-06-09T15:00:00.000Z"),
    });
    await __signalMonitorInternalsForTests.waitForSignalMonitorPersistIdleForTests();
    assert.deepEqual(attempts, [
      "2026-06-09T15:00:00.000Z",
      "2026-06-09T15:00:00.000Z",
    ]);
  } finally {
    internals.setSignalMonitorPersistWorkerForTests(null);
    __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
  }
});

test("terminal persistence failure does not start a retry treadmill", async () => {
  __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
  const internals = __signalMonitorInternalsForTests as unknown as {
    setSignalMonitorPersistWorkerForTests(
      worker:
        | (() => Promise<"success" | "retryable-failure" | "terminal-failure">)
        | null,
    ): void;
    schedulePersistSignalMonitorMatrixStatesForTests(input: {
      profile: ReturnType<typeof profile>;
      states: unknown[];
      evaluatedAt: Date;
    }): void;
    getSignalMonitorPersistQueueStatsForTests(): {
      inFlight: number;
      pending: number;
      retryTimers: number;
    };
  };
  let attempts = 0;
  internals.setSignalMonitorPersistWorkerForTests(async () => {
    attempts += 1;
    return attempts === 1 ? "terminal-failure" : "success";
  });
  const input = {
    profile: profile("00000000-0000-4000-8000-0000000000d6"),
    states: [directionalStreamState("AAPL", "5m")],
    evaluatedAt: new Date("2026-06-09T15:00:00.000Z"),
  };
  try {
    internals.schedulePersistSignalMonitorMatrixStatesForTests(input);
    await __signalMonitorInternalsForTests.waitForSignalMonitorPersistIdleForTests();
    assert.equal(attempts, 1);
    assert.deepEqual(internals.getSignalMonitorPersistQueueStatsForTests(), {
      inFlight: 0,
      pending: 0,
      retryTimers: 0,
    });

    internals.schedulePersistSignalMonitorMatrixStatesForTests(input);
    await __signalMonitorInternalsForTests.waitForSignalMonitorPersistIdleForTests();
    assert.equal(attempts, 2, "a later new enqueue gets a fresh attempt");
  } finally {
    internals.setSignalMonitorPersistWorkerForTests(null);
    __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
  }
});

test("a newer enqueue racing a terminal failure drains without a third enqueue", async () => {
  __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
  const internals = __signalMonitorInternalsForTests as unknown as {
    setSignalMonitorPersistWorkerForTests(
      worker:
        | ((input: {
            states: Array<{ latestBarAt: Date }>;
          }) => Promise<"success" | "retryable-failure" | "terminal-failure">)
        | null,
    ): void;
    schedulePersistSignalMonitorMatrixStatesForTests(input: {
      profile: ReturnType<typeof profile>;
      states: unknown[];
      evaluatedAt: Date;
    }): void;
  };
  let releaseFirst!: () => void;
  const firstBlocked = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let markFirstStarted!: () => void;
  const firstStarted = new Promise<void>((resolve) => {
    markFirstStarted = resolve;
  });
  const attempts: string[] = [];
  internals.setSignalMonitorPersistWorkerForTests(async ({ states }) => {
    attempts.push(states[0]!.latestBarAt.toISOString());
    if (attempts.length === 1) {
      markFirstStarted();
      await firstBlocked;
      return "terminal-failure";
    }
    return "success";
  });
  const profileId = "00000000-0000-4000-8000-0000000000d7";
  const schedule = (latestBarAt: Date) =>
    internals.schedulePersistSignalMonitorMatrixStatesForTests({
      profile: profile(profileId),
      states: [directionalStreamState("AAPL", "5m", { latestBarAt })],
      evaluatedAt: latestBarAt,
    });
  try {
    schedule(new Date("2026-06-09T15:00:00.000Z"));
    await firstStarted;
    schedule(new Date("2026-06-09T15:05:00.000Z"));
    releaseFirst();
    await __signalMonitorInternalsForTests.waitForSignalMonitorPersistIdleForTests();
    assert.deepEqual(attempts, [
      "2026-06-09T15:00:00.000Z",
      "2026-06-09T15:05:00.000Z",
    ]);
  } finally {
    releaseFirst();
    internals.setSignalMonitorPersistWorkerForTests(null);
    __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
  }
});

test("the selected cell owner persists by dirty-key independently of the display signature", () => {
  const emitStart = serviceSource.indexOf(
    "export function emitSignalMonitorMatrixStreamAggregateDelta",
  );
  const emitEnd = serviceSource.indexOf("persistByProfile.forEach", emitStart);
  const emitBlock = serviceSource.slice(emitStart, emitEnd);
  const persistStart = emitBlock.search(
    /const changedPersistStates\s*=\s*changedSignalMonitorMatrixStreamPersistStates/,
  );
  const realSseStart = emitBlock.indexOf("const displayStates");
  assert.notEqual(persistStart, -1);
  assert.notEqual(realSseStart, -1);
  assert.ok(persistStart < realSseStart);
  // Persistence is filtered through the tight dirty key only after exact-cell
  // ownership has selected the subset. Display signatures remain SSE-only.
  assert.match(
    emitBlock,
    /changedSignalMonitorMatrixStreamPersistStates\(\s*subscriber,\s*ownedStates,?\s*\)/,
  );
  assert.doesNotMatch(
    emitBlock,
    /changedSignalMonitorMatrixStreamPersistStates\(\s*subscriber,\s*displayStates/,
  );
  // SSE delivery still uses the display-signature changed set through the
  // subscriber delta boundary.
  assert.match(
    emitBlock.slice(realSseStart),
    /emitSignalMonitorMatrixStreamStateDelta\(\{\s*subscriber,\s*states:\s*changedStates,/,
  );
});

test("server-owned producer shares ownership gating but bypasses display and delta work", () => {
  const emitStart = serviceSource.indexOf(
    "export function emitSignalMonitorMatrixStreamAggregateDelta",
  );
  const emitEnd = serviceSource.indexOf("persistByProfile.forEach", emitStart);
  assert.notEqual(emitStart, -1);
  assert.notEqual(emitEnd, -1);
  const emitBlock = serviceSource.slice(emitStart, emitEnd);
  const persistStart = emitBlock.search(
    /const changedPersistStates\s*=\s*changedSignalMonitorMatrixStreamPersistStates/,
  );
  const serverOwnedStart = emitBlock.indexOf(
    "if (subscriber.serverOwnedProducer)",
  );
  const realSseStart = emitBlock.indexOf(
    "const displayStates",
    serverOwnedStart,
  );
  assert.notEqual(persistStart, -1);
  assert.notEqual(serverOwnedStart, -1);
  assert.notEqual(realSseStart, -1);
  assert.ok(persistStart < serverOwnedStart);
  const serverOwnedBlock = emitBlock.slice(serverOwnedStart, realSseStart);

  assert.match(serverOwnedBlock, /continue;/);
  assert.doesNotMatch(
    serverOwnedBlock,
    /changedSignalMonitorMatrixStreamStates/,
  );
  assert.doesNotMatch(
    serverOwnedBlock,
    /buildSignalMonitorMatrixStreamDeltaEvent/,
  );
  assert.doesNotMatch(serverOwnedBlock, /subscriber\.onEvent/);
  assert.doesNotMatch(
    serverOwnedBlock,
    /signalMonitorMatrixStreamStateSignature/,
  );
});

test("response display freshness is derived from bar-window age", () => {
  const state = {
    id: "state-1",
    profileId: "profile-test",
    symbol: "AAPL",
    timeframe: "5m",
    currentSignalDirection: "buy",
    currentSignalAt: new Date("2026-06-09T14:55:00.000Z"),
    currentSignalPrice: "100",
    currentSignalClose: "101",
    currentSignalMfePercent: null,
    currentSignalMaePercent: null,
    filterState: null,
    latestBarAt: new Date("2026-06-09T15:00:00.000Z"),
    latestBarClose: "101",
    barsSinceSignal: 2,
    fresh: false,
    status: "ok",
    active: true,
    lastEvaluatedAt: evaluatedAt,
    lastError: null,
    trendDirection: null,
  } as any;

  const inside = __signalMonitorInternalsForTests.stateToResponse(state, {
    freshWindowBars: 3,
  });
  assert.equal(inside.fresh, true);

  const aged = __signalMonitorInternalsForTests.stateToResponse(
    { ...state, barsSinceSignal: 4 } as never,
    { freshWindowBars: 3 },
  );
  assert.equal(aged.fresh, false);

  const stale = __signalMonitorInternalsForTests.stateToResponse(
    { ...state, status: "stale" } as never,
    { freshWindowBars: 3 },
  );
  assert.equal(stale.fresh, false);

  const unknownAge = __signalMonitorInternalsForTests.stateToResponse(
    { ...state, barsSinceSignal: null } as never,
    { freshWindowBars: 3 },
  );
  assert.equal(unknownAge.fresh, false);
});

test("matrix stream display freshness matches REST response freshness", () => {
  const state = {
    ...streamState("AAPL", "5m", "marker"),
    currentSignalDirection: "buy",
    currentSignalAt: new Date("2026-06-09T14:55:00.000Z"),
    latestBarAt: new Date("2026-06-09T15:00:00.000Z"),
    barsSinceSignal: 2,
    status: "ok",
    fresh: false,
  } as any;

  const streamed =
    __signalMonitorInternalsForTests.withSignalMonitorMatrixStreamActionability(
      state,
      profile(),
    );
  const response = __signalMonitorInternalsForTests.stateToResponse(
    {
      ...state,
      currentSignalPrice: null,
      currentSignalClose: null,
      currentSignalMfePercent: null,
      currentSignalMaePercent: null,
      filterState: null,
      latestBarClose: null,
      trendDirection: null,
    } as never,
    { freshWindowBars: 3 },
  );

  assert.equal(streamed.fresh, true);
  assert.equal(streamed.fresh, response.fresh);
});

function profile(id = "profile-test", overrides: Record<string, unknown> = {}) {
  return {
    id,
    environment: "shadow",
    enabled: true,
    watchlistId: null,
    timeframe: "15m",
    pyrusSignalsSettings: {},
    signalSettingsRevision: 1,
    freshWindowBars: 3,
    pollIntervalSeconds: 60,
    maxSymbols: 500,
    evaluationConcurrency: 6,
    ...overrides,
  } as any;
}

function streamState(symbol: string, timeframe: string, marker: string) {
  return {
    id: `profile-test:${symbol}:${timeframe}`,
    profileId: "profile-test",
    symbol,
    timeframe,
    currentSignalDirection: null,
    currentSignalAt: null,
    currentSignalPrice: null,
    latestBarAt: null,
    barsSinceSignal: null,
    fresh: false,
    status: "unavailable",
    active: true,
    lastEvaluatedAt: evaluatedAt,
    lastError: marker,
    indicatorSnapshot: null,
  } as any;
}

function withSignalMonitorBarEvaluationEnabled<T>(run: () => T): T {
  const previousPyrusFlag =
    process.env["PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED"];
  const previousLegacyFlag =
    process.env["SIGNAL_MONITOR_BAR_EVALUATION_ENABLED"];
  process.env["PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED"] = "1";
  delete process.env["SIGNAL_MONITOR_BAR_EVALUATION_ENABLED"];
  try {
    return run();
  } finally {
    if (previousPyrusFlag === undefined) {
      delete process.env["PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED"];
    } else {
      process.env["PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED"] =
        previousPyrusFlag;
    }
    if (previousLegacyFlag === undefined) {
      delete process.env["SIGNAL_MONITOR_BAR_EVALUATION_ENABLED"];
    } else {
      process.env["SIGNAL_MONITOR_BAR_EVALUATION_ENABLED"] = previousLegacyFlag;
    }
  }
}

type TimerHandle = {
  callback: () => void;
  delayMs: number;
  unref: () => void;
};

function withFakeMatrixStreamTimers<T>(
  run: (timers: { delays: number[]; activeDelays: () => number[] }) => T,
): T {
  const previousSetTimeout = globalThis.setTimeout;
  const previousClearTimeout = globalThis.clearTimeout;
  const handles = new Set<TimerHandle>();
  const delays: number[] = [];

  globalThis.setTimeout = ((callback: () => void, delayMs?: number) => {
    const handle = {
      callback,
      delayMs: Number(delayMs ?? 0),
      unref: () => {},
    };
    delays.push(handle.delayMs);
    handles.add(handle);
    return handle as never;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((handle?: TimerHandle) => {
    if (handle) {
      handles.delete(handle);
    }
  }) as typeof clearTimeout;

  try {
    return run({
      delays,
      activeDelays: () => Array.from(handles, (handle) => handle.delayMs),
    });
  } finally {
    __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
    globalThis.setTimeout = previousSetTimeout;
    globalThis.clearTimeout = previousClearTimeout;
  }
}

test("signal matrix stream scope treats exact cells as authoritative", () => {
  const scope =
    __signalMonitorInternalsForTests.normalizeSignalMonitorMatrixStreamScope({
      environment: "shadow",
      symbols: ["MSFT"],
      timeframes: ["1d"],
      cells: [
        { symbol: "aapl", timeframe: "5m" },
        { symbol: "AAPL", timeframe: "1m" },
        { symbol: "AAPL", timeframe: "1m" },
        { symbol: "TSLA", timeframe: "bad" },
      ] as never,
      clientRole: "leader",
      requestOrigin: "startup",
    });

  assert.equal(scope.exactCells, true);
  assert.deepEqual(scope.symbols, ["AAPL"]);
  assert.deepEqual(scope.timeframes, ["1m", "5m"]);
  assert.deepEqual(scope.cells, [
    { symbol: "AAPL", timeframe: "1m" },
    { symbol: "AAPL", timeframe: "5m" },
  ]);
});

test("signal matrix stream scope indexes exact-cell timeframes by symbol", () => {
  const scope =
    __signalMonitorInternalsForTests.normalizeSignalMonitorMatrixStreamScope({
      environment: "shadow",
      cells: [
        { symbol: "aapl", timeframe: "5m" },
        { symbol: "AAPL", timeframe: "1m" },
        { symbol: "MSFT", timeframe: "15m" },
      ] as never,
    });

  assert.deepEqual(
    __signalMonitorInternalsForTests.signalMonitorMatrixStreamTimeframesForSymbol(
      scope,
      "aapl",
    ),
    ["1m", "5m"],
  );
  assert.deepEqual(
    __signalMonitorInternalsForTests.signalMonitorMatrixStreamTimeframesForSymbol(
      scope,
      "MSFT",
    ),
    ["15m"],
  );
  assert.deepEqual(
    __signalMonitorInternalsForTests.signalMonitorMatrixStreamTimeframesForSymbol(
      scope,
      "TSLA",
    ),
    [],
  );
});

test("signal matrix stream scope resolves profile universe when no explicit symbols are supplied", async () => {
  const scope =
    await __signalMonitorInternalsForTests.resolveSignalMonitorMatrixStreamScope(
      {
        environment: "shadow",
        timeframes: ["1m", "5m"],
        universe: "profile",
        resolveProfileUniverseSymbols: async () => [
          "tsla",
          "NVDA",
          "TSLA",
          " ",
        ],
      },
    );

  assert.equal(scope.exactCells, false);
  assert.deepEqual(scope.symbols, ["NVDA", "TSLA"]);
  assert.deepEqual(scope.timeframes, ["1m", "5m"]);
  assert.equal(scope.requestedSymbolCount, 2);
  assert.equal(scope.truncated, false);
});

test("signal matrix stream profile scope uses the capped active profile universe only", () => {
  const symbols =
    __signalMonitorInternalsForTests.signalMonitorMatrixStreamProfileSymbols({
      symbols: ["SPY", "NVDA", "AAPL"],
      watchlistSymbols: ["SPY", "TSLA"],
      skippedSymbols: ["SQQQ"],
    } as never);

  assert.deepEqual(symbols, ["SPY", "NVDA", "AAPL"]);
});

test("signal monitor active universe excludes overflow watchlist/skipped symbols", () => {
  const symbols =
    __signalMonitorInternalsForTests.resolveSignalMonitorActiveUniverseSymbols({
      symbols: ["spy", "NVDA", "SPY"],
      watchlistSymbols: ["SPY", "TSLA"],
      skippedSymbols: ["SQQQ"],
    } as never);

  assert.deepEqual(symbols, ["SPY", "NVDA"]);
});

test("signal matrix profile streams use stored-state universe in passive mode", () => {
  const resolverStart = serviceSource.indexOf(
    "async function resolveSignalMonitorMatrixStreamProfileUniverseSymbols",
  );
  const resolverEnd = serviceSource.indexOf(
    "function signalMonitorEvaluationRotationKey",
    resolverStart,
  );
  assert.notEqual(resolverStart, -1);
  assert.notEqual(resolverEnd, -1);
  const resolverBlock = serviceSource.slice(resolverStart, resolverEnd);

  assert.match(resolverBlock, /!isSignalMonitorBarEvaluationEnabled\(\)/);
  assert.match(
    resolverBlock,
    /await readSignalMonitorStreamBootstrapSnapshot/,
    "passive profile scope and bootstrap must share one full-state read",
  );
  assert.doesNotMatch(resolverBlock, /await getSignalMonitorStoredState/);
  assert.match(resolverBlock, /symbols: snapshot\.universeSymbols/);
});

test("passive state reads use the configured universe, not freshness-ordered state rows", () => {
  const passiveStart = serviceSource.indexOf(
    "async function readSignalMonitorPassiveStoredStateFresh",
  );
  const passiveEnd = serviceSource.indexOf(
    "async function readSignalMonitorStateFresh",
    passiveStart,
  );
  const loadStart = serviceSource.indexOf(
    "async function loadSignalMonitorActiveStateRows",
  );
  const loadEnd = serviceSource.indexOf(
    "async function loadSignalMonitorEventRows",
    loadStart,
  );
  assert.ok(passiveStart >= 0 && passiveEnd > passiveStart);
  assert.ok(loadStart >= 0 && loadEnd > loadStart);

  const passiveBlock = serviceSource.slice(passiveStart, passiveEnd);
  assert.match(passiveBlock, /resolveSignalMonitorProfileUniverse\(/);
  assert.doesNotMatch(passiveBlock, /const stateSymbols =/);
  assert.doesNotMatch(serviceSource.slice(loadStart, loadEnd), /\.orderBy\(/);
});

test("history readiness is classified from the canonical signal profile", () => {
  const readinessStart = serviceSource.indexOf(
    "async function loadSignalMonitorBackfillReadinessPriorities",
  );
  const readinessEnd = serviceSource.indexOf(
    "async function replaySignalMonitorBackfilledCells",
    readinessStart,
  );
  assert.ok(readinessStart >= 0 && readinessEnd > readinessStart);
  const readinessBlock = serviceSource.slice(readinessStart, readinessEnd);

  assert.match(readinessBlock, /CANONICAL_SIGNAL_ENVIRONMENT/);
  assert.match(
    readinessBlock,
    /currentSignalDirection\} is null\s+and \$\{signalMonitorSymbolStatesTable\.trendDirection\} is null/,
  );
});

test("signal matrix stream scope keeps explicit symbols ahead of profile universe", async () => {
  let resolvedProfile = false;
  const scope =
    await __signalMonitorInternalsForTests.resolveSignalMonitorMatrixStreamScope(
      {
        environment: "shadow",
        symbols: ["aapl"],
        timeframes: ["1m"],
        universe: "profile",
        resolveProfileUniverseSymbols: async () => {
          resolvedProfile = true;
          return ["TSLA"];
        },
      },
    );

  assert.equal(resolvedProfile, false);
  assert.deepEqual(scope.symbols, ["AAPL"]);
  assert.deepEqual(scope.timeframes, ["1m"]);
});

test("signal matrix stream aggregate evaluation only touches the aggregate symbol", () => {
  withSignalMonitorBarEvaluationEnabled(() => {
    const scope =
      __signalMonitorInternalsForTests.normalizeSignalMonitorMatrixStreamScope({
        environment: "shadow",
        symbols: ["AAPL", "MSFT"],
        timeframes: ["1m", "5m"],
      });
    const calls: string[] = [];

    const states =
      __signalMonitorInternalsForTests.evaluateSignalMonitorMatrixStreamScopeDelta(
        {
          scope,
          profile: profile(),
          symbol: "AAPL",
          evaluatedAt,
          evaluateState(input) {
            calls.push(`${input.symbol}:${input.timeframe}`);
            return streamState(input.symbol, input.timeframe, "delta");
          },
        },
      );

    assert.deepEqual(calls, ["AAPL:1m", "AAPL:5m"]);
    assert.equal(states.length, 2);
  });
});

test("signal matrix stream aggregate evaluation runs regardless of bar-evaluation flag", () => {
  const previousPyrusFlag =
    process.env["PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED"];
  const previousLegacyFlag =
    process.env["SIGNAL_MONITOR_BAR_EVALUATION_ENABLED"];
  delete process.env["PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED"];
  delete process.env["SIGNAL_MONITOR_BAR_EVALUATION_ENABLED"];
  try {
    const scope =
      __signalMonitorInternalsForTests.normalizeSignalMonitorMatrixStreamScope({
        environment: "shadow",
        symbols: ["AAPL"],
        timeframes: ["1m"],
      });
    const calls: string[] = [];

    // The live emit path (stream -> delta) must produce signals even with
    // bar-evaluation off; that flag now only gates legacy backfill scanning.
    const states =
      __signalMonitorInternalsForTests.evaluateSignalMonitorMatrixStreamScopeDelta(
        {
          scope,
          profile: profile(),
          symbol: "AAPL",
          evaluatedAt,
          evaluateState(input) {
            calls.push(`${input.symbol}:${input.timeframe}`);
            return streamState(input.symbol, input.timeframe, "delta");
          },
        },
      );

    assert.deepEqual(calls, ["AAPL:1m"]);
    assert.equal(states.length, 1);
  } finally {
    if (previousPyrusFlag === undefined) {
      delete process.env["PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED"];
    } else {
      process.env["PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED"] =
        previousPyrusFlag;
    }
    if (previousLegacyFlag === undefined) {
      delete process.env["SIGNAL_MONITOR_BAR_EVALUATION_ENABLED"];
    } else {
      process.env["SIGNAL_MONITOR_BAR_EVALUATION_ENABLED"] = previousLegacyFlag;
    }
  }
});

test("equivalent producer and UI cells evaluate once and choose persistence ownership before dirty mutation", async () => {
  for (const uiFirst of [true, false]) {
    __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
    __signalMonitorInternalsForTests.setSignalMonitorPersistWorkerForTests(
      async () => "success",
    );
    const profileId = "00000000-0000-4000-8000-0000000000e1";
    const scope =
      __signalMonitorInternalsForTests.normalizeSignalMonitorMatrixStreamScope({
        environment: "shadow",
        cells: [{ symbol: "AAPL", timeframe: "5m" }] as never,
      });
    const subscriptions: Array<{
      kind: "producer" | "ui";
      unsubscribe(): void;
    }> = [];
    const subscribeUi = () => {
      const subscription =
        __signalMonitorInternalsForTests.createSignalMonitorMatrixStreamSubscriptionForTests(
          {
            scope,
            profile: profile(profileId, {
              watchlistId: "00000000-0000-4000-8000-000000000099",
              pollIntervalSeconds: 30,
              maxSymbols: 400,
              evaluationConcurrency: 2,
            }),
            prime: false,
            onEvent: () => undefined,
          },
        );
      subscriptions.push({ kind: "ui", ...subscription });
    };
    const subscribeProducer = () => {
      const subscription =
        __signalMonitorInternalsForTests.createSignalMonitorMatrixStreamSubscriptionForTests(
          {
            scope,
            profile: profile(profileId),
            prime: false,
            serverOwnedProducer: true,
            onEvent: () => undefined,
          },
        );
      subscriptions.push({ kind: "producer", ...subscription });
    };
    if (uiFirst) {
      subscribeUi();
      subscribeProducer();
    } else {
      subscribeProducer();
      subscribeUi();
    }

    let evaluationCalls = 0;
    const emit = () =>
      __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta(
        {
          message: { symbol: "AAPL" },
          environment: "shadow",
          evaluatedAt,
          evaluateState(input) {
            evaluationCalls += 1;
            return directionalStreamState(input.symbol, input.timeframe, {
              profileId,
            });
          },
        },
      );

    __signalMonitorInternalsForTests.resetSignalMonitorPersistScheduleStatsForTests();
    emit();
    assert.equal(
      evaluationCalls,
      1,
      `${uiFirst ? "UI" : "producer"}-first registration shares one evaluation`,
    );
    assert.deepEqual(
      __signalMonitorInternalsForTests.getSignalMonitorPersistScheduleStatsForTests(),
      { calls: 1, states: 1 },
      "the producer is the sole persistence owner",
    );
    await __signalMonitorInternalsForTests.waitForSignalMonitorPersistIdleForTests();

    subscriptions.find(({ kind }) => kind === "producer")?.unsubscribe();
    __signalMonitorInternalsForTests.resetSignalMonitorPersistScheduleStatsForTests();
    emit();
    assert.equal(evaluationCalls, 2);
    assert.deepEqual(
      __signalMonitorInternalsForTests.getSignalMonitorPersistScheduleStatsForTests(),
      { calls: 1, states: 1 },
      "the UI dirty key remained untouched and becomes the fallback owner",
    );
    await __signalMonitorInternalsForTests.waitForSignalMonitorPersistIdleForTests();
    subscriptions.find(({ kind }) => kind === "ui")?.unsubscribe();
  }
  __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
});

test("durable cell ownership ignores stale deployment scope environments", async () => {
  __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
  __signalMonitorInternalsForTests.setSignalMonitorPersistWorkerForTests(
    async () => "success",
  );
  const profileId = "00000000-0000-4000-8000-0000000000e5";
  const cells = [{ symbol: "AAPL", timeframe: "5m" }] as never;
  const ui =
    __signalMonitorInternalsForTests.createSignalMonitorMatrixStreamSubscriptionForTests(
      {
        scope:
          __signalMonitorInternalsForTests.normalizeSignalMonitorMatrixStreamScope(
            {
              environment: "live",
              cells,
            },
          ),
        profile: profile(profileId),
        prime: false,
        onEvent: () => undefined,
      },
    );
  const producer =
    __signalMonitorInternalsForTests.createSignalMonitorMatrixStreamSubscriptionForTests(
      {
        scope:
          __signalMonitorInternalsForTests.normalizeSignalMonitorMatrixStreamScope(
            {
              environment: "shadow",
              cells,
            },
          ),
        profile: profile(profileId),
        prime: false,
        serverOwnedProducer: true,
        onEvent: () => undefined,
      },
    );
  let evaluationCalls = 0;

  __signalMonitorInternalsForTests.resetSignalMonitorPersistScheduleStatsForTests();
  __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta({
    message: { symbol: "AAPL" },
    evaluatedAt,
    evaluateState(input) {
      evaluationCalls += 1;
      return directionalStreamState(input.symbol, input.timeframe, {
        profileId,
      });
    },
  });

  assert.equal(evaluationCalls, 1);
  assert.deepEqual(
    __signalMonitorInternalsForTests.getSignalMonitorPersistScheduleStatsForTests(),
    { calls: 1, states: 1 },
    "the server producer owns the one durable DB conflict target",
  );
  await __signalMonitorInternalsForTests.waitForSignalMonitorPersistIdleForTests();
  producer.unsubscribe();
  ui.unsubscribe();
  __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
});

test("canonical evaluation stays raw while each subscriber applies its own signal latch", () => {
  __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
  const scope =
    __signalMonitorInternalsForTests.normalizeSignalMonitorMatrixStreamScope({
      environment: "shadow",
      cells: [{ symbol: "AAPL", timeframe: "5m" }] as never,
    });
  const latchedEvents: Array<{ states?: Array<Record<string, unknown>> }> = [];
  const rawEvents: Array<{ states?: Array<Record<string, unknown>> }> = [];
  const latched =
    __signalMonitorInternalsForTests.createSignalMonitorMatrixStreamSubscriptionForTests(
      {
        scope,
        profile: profile(),
        prime: false,
        onEvent: (event) => {
          latchedEvents.push(event as never);
        },
      },
    );
  const raw =
    __signalMonitorInternalsForTests.createSignalMonitorMatrixStreamSubscriptionForTests(
      {
        scope,
        profile: profile(),
        prime: false,
        onEvent: (event) => {
          rawEvents.push(event as never);
        },
      },
    );
  latched.recordSnapshot([directionalStreamState("AAPL", "5m")]);
  let evaluationCalls = 0;

  __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta({
    message: { symbol: "AAPL" },
    environment: "shadow",
    evaluatedAt,
    evaluateState(input) {
      evaluationCalls += 1;
      return directionalStreamState(input.symbol, input.timeframe, {
        currentSignalDirection: null,
        currentSignalAt: null,
        currentSignalPrice: null,
        barsSinceSignal: null,
        fresh: false,
        latestBarAt: new Date("2026-06-09T15:05:00.000Z"),
      });
    },
  });

  assert.equal(evaluationCalls, 1);
  assert.equal(
    latchedEvents.at(-1)?.states?.[0]?.["currentSignalDirection"],
    "buy",
  );
  assert.equal(rawEvents.at(-1)?.states?.[0]?.["currentSignalDirection"], null);
  latched.unsubscribe();
  raw.unsubscribe();
  __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
});

test("producer persistence coverage is exact per cell and UI owns only the uncovered cell", async () => {
  __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
  __signalMonitorInternalsForTests.setSignalMonitorPersistWorkerForTests(
    async () => "success",
  );
  const profileId = "00000000-0000-4000-8000-0000000000e2";
  const producerScope =
    __signalMonitorInternalsForTests.normalizeSignalMonitorMatrixStreamScope({
      environment: "shadow",
      cells: [{ symbol: "AAPL", timeframe: "1m" }] as never,
    });
  const uiScope =
    __signalMonitorInternalsForTests.normalizeSignalMonitorMatrixStreamScope({
      environment: "shadow",
      cells: [
        { symbol: "AAPL", timeframe: "1m" },
        { symbol: "AAPL", timeframe: "5m" },
      ] as never,
    });
  const ui =
    __signalMonitorInternalsForTests.createSignalMonitorMatrixStreamSubscriptionForTests(
      {
        scope: uiScope,
        profile: profile(profileId),
        prime: false,
        onEvent: () => undefined,
      },
    );
  const producer =
    __signalMonitorInternalsForTests.createSignalMonitorMatrixStreamSubscriptionForTests(
      {
        scope: producerScope,
        profile: profile(profileId),
        prime: false,
        serverOwnedProducer: true,
        onEvent: () => undefined,
      },
    );
  const evaluationCalls: string[] = [];
  const emit = () =>
    __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta(
      {
        message: { symbol: "AAPL" },
        environment: "shadow",
        evaluatedAt,
        evaluateState(input) {
          evaluationCalls.push(`${input.symbol}:${input.timeframe}`);
          return directionalStreamState(input.symbol, input.timeframe, {
            profileId,
          });
        },
      },
    );

  __signalMonitorInternalsForTests.resetSignalMonitorPersistScheduleStatsForTests();
  emit();
  assert.deepEqual(evaluationCalls, ["AAPL:1m", "AAPL:5m"]);
  assert.deepEqual(
    __signalMonitorInternalsForTests.getSignalMonitorPersistScheduleStatsForTests(),
    { calls: 1, states: 2 },
  );
  await __signalMonitorInternalsForTests.waitForSignalMonitorPersistIdleForTests();

  producer.unsubscribe();
  __signalMonitorInternalsForTests.resetSignalMonitorPersistScheduleStatsForTests();
  emit();
  assert.deepEqual(
    __signalMonitorInternalsForTests.getSignalMonitorPersistScheduleStatsForTests(),
    { calls: 1, states: 1 },
    "only the formerly producer-owned 1m cell transfers to the UI",
  );
  await __signalMonitorInternalsForTests.waitForSignalMonitorPersistIdleForTests();
  ui.unsubscribe();
  __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
});

test("a per-cell evaluation failure does not suppress healthy canonical cells", async () => {
  __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
  __signalMonitorInternalsForTests.setSignalMonitorPersistWorkerForTests(
    async () => "success",
  );
  const profileId = "00000000-0000-4000-8000-0000000000e3";
  const scope =
    __signalMonitorInternalsForTests.normalizeSignalMonitorMatrixStreamScope({
      environment: "shadow",
      cells: [
        { symbol: "AAPL", timeframe: "1m" },
        { symbol: "AAPL", timeframe: "5m" },
      ] as never,
    });
  const events: Array<{
    event: string;
    states?: Array<{ timeframe: string }>;
  }> = [];
  const ui =
    __signalMonitorInternalsForTests.createSignalMonitorMatrixStreamSubscriptionForTests(
      {
        scope,
        profile: profile(profileId),
        prime: false,
        onEvent: (event) => {
          events.push(event as never);
        },
      },
    );
  const producer =
    __signalMonitorInternalsForTests.createSignalMonitorMatrixStreamSubscriptionForTests(
      {
        scope,
        profile: profile(profileId),
        prime: false,
        serverOwnedProducer: true,
        onEvent: () => undefined,
      },
    );
  const evaluationCalls: string[] = [];

  __signalMonitorInternalsForTests.resetSignalMonitorPersistScheduleStatsForTests();
  __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta({
    message: { symbol: "AAPL" },
    environment: "shadow",
    evaluatedAt,
    evaluateState(input) {
      evaluationCalls.push(`${input.symbol}:${input.timeframe}`);
      if (input.timeframe === "1m") {
        throw new Error("1m fixture failure");
      }
      return directionalStreamState(input.symbol, input.timeframe, {
        profileId,
      });
    },
  });

  assert.deepEqual(evaluationCalls, ["AAPL:1m", "AAPL:5m"]);
  assert.deepEqual(
    events.map(({ event }) => event),
    ["error", "state-delta"],
  );
  assert.deepEqual(
    events[1]?.states?.map(({ timeframe }) => timeframe),
    ["5m"],
  );
  assert.deepEqual(
    __signalMonitorInternalsForTests.getSignalMonitorPersistScheduleStatsForTests(),
    { calls: 1, states: 1 },
  );
  await __signalMonitorInternalsForTests.waitForSignalMonitorPersistIdleForTests();
  producer.unsubscribe();
  ui.unsubscribe();
  __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
});

test("a successful producer outranks divergent UI settings, with UI fallback on producer failure", async () => {
  __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
  const profileId = "00000000-0000-4000-8000-0000000000e4";
  const scope =
    __signalMonitorInternalsForTests.normalizeSignalMonitorMatrixStreamScope({
      environment: "shadow",
      cells: [{ symbol: "AAPL", timeframe: "5m" }] as never,
    });
  const persistedMarkers: Array<number | null> = [];
  __signalMonitorInternalsForTests.setSignalMonitorPersistWorkerForTests(
    async ({ states }) => {
      persistedMarkers.push(states[0]?.latestBarClose ?? null);
      return "success";
    },
  );
  const ui =
    __signalMonitorInternalsForTests.createSignalMonitorMatrixStreamSubscriptionForTests(
      {
        scope,
        profile: profile(profileId, {
          pyrusSignalsSettings: { timeHorizon: 4 },
        }),
        prime: false,
        onEvent: () => undefined,
      },
    );
  const producer =
    __signalMonitorInternalsForTests.createSignalMonitorMatrixStreamSubscriptionForTests(
      {
        scope,
        profile: profile(profileId, {
          pyrusSignalsSettings: { timeHorizon: 3 },
        }),
        prime: false,
        serverOwnedProducer: true,
        onEvent: () => undefined,
      },
    );
  let producerFails = false;
  const emit = () =>
    __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta(
      {
        message: { symbol: "AAPL" },
        environment: "shadow",
        evaluatedAt,
        evaluateState(input) {
          const marker = Number(
            input.profile.pyrusSignalsSettings["timeHorizon"],
          );
          if (marker === 3 && producerFails) {
            throw new Error("producer fixture failure");
          }
          return directionalStreamState(input.symbol, input.timeframe, {
            profileId,
            latestBarClose: marker,
          });
        },
      },
    );

  emit();
  await __signalMonitorInternalsForTests.waitForSignalMonitorPersistIdleForTests();
  assert.deepEqual(persistedMarkers, [3]);

  producerFails = true;
  __signalMonitorInternalsForTests.resetSignalMonitorPersistScheduleStatsForTests();
  emit();
  await __signalMonitorInternalsForTests.waitForSignalMonitorPersistIdleForTests();
  assert.deepEqual(persistedMarkers, [3, 4]);
  assert.deepEqual(
    __signalMonitorInternalsForTests.getSignalMonitorPersistScheduleStatsForTests(),
    { calls: 1, states: 1 },
  );

  producerFails = false;
  __signalMonitorInternalsForTests.resetSignalMonitorPersistScheduleStatsForTests();
  emit();
  await __signalMonitorInternalsForTests.waitForSignalMonitorPersistIdleForTests();
  assert.deepEqual(
    persistedMarkers,
    [3, 4, 3],
    "producer recovery must reassert canonical state even when its value is unchanged",
  );
  assert.deepEqual(
    __signalMonitorInternalsForTests.getSignalMonitorPersistScheduleStatsForTests(),
    { calls: 1, states: 1 },
  );

  producer.unsubscribe();
  ui.unsubscribe();
  __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
});

test("signal matrix stream subscription emits changed deltas and cleans up", () => {
  withSignalMonitorBarEvaluationEnabled(() => {
    __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
    const scope =
      __signalMonitorInternalsForTests.normalizeSignalMonitorMatrixStreamScope({
        environment: "shadow",
        symbols: ["AAPL"],
        timeframes: ["1m"],
      });
    const events: { event: string; states?: unknown[] }[] = [];
    const subscription =
      __signalMonitorInternalsForTests.createSignalMonitorMatrixStreamSubscriptionForTests(
        {
          scope,
          profile: profile(),
          prime: false,
          onEvent(event) {
            events.push(event);
          },
        },
      );

    __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta(
      {
        message: { symbol: "AAPL" },
        evaluatedAt,
        evaluateState(input) {
          return streamState(input.symbol, input.timeframe, "first");
        },
      },
    );
    __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta(
      {
        message: { symbol: "AAPL" },
        evaluatedAt,
        evaluateState(input) {
          return streamState(input.symbol, input.timeframe, "first");
        },
      },
    );

    assert.equal(events.length, 1);
    assert.equal(events[0]?.event, "state-delta");
    assert.equal(events[0]?.states?.length, 1);

    subscription.unsubscribe();
    __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta(
      {
        message: { symbol: "AAPL" },
        evaluatedAt,
        evaluateState(input) {
          return streamState(input.symbol, input.timeframe, "after-cleanup");
        },
      },
    );
    assert.equal(events.length, 1);
    __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
  });
});

test("signal matrix stream subscriber coalesces synchronous changed cell bursts", async () => {
  __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
  const scope =
    __signalMonitorInternalsForTests.normalizeSignalMonitorMatrixStreamScope({
      environment: "shadow",
      symbols: ["AAPL", "MSFT"],
      timeframes: ["5m"],
    });
  const events: { event: string; states?: Record<string, unknown>[] }[] = [];
  const subscription =
    __signalMonitorInternalsForTests.createSignalMonitorMatrixStreamSubscriptionForTests(
      {
        scope,
        profile: profile(),
        prime: false,
        coalesceStateDeltas: true,
        onEvent(event) {
          events.push(event as never);
        },
      },
    );

  for (const symbol of ["AAPL", "MSFT"]) {
    __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta(
      {
        message: { symbol },
        evaluatedAt,
        evaluateState(input) {
          return directionalStreamState(input.symbol, input.timeframe);
        },
      },
    );
  }

  assert.equal(events.length, 0);
  await new Promise((resolve) => setTimeout(resolve, fastFlushMs + 20));
  assert.equal(events.length, 1);
  assert.equal(events[0]?.event, "state-delta");
  assert.deepEqual(
    events[0]?.states?.map((state) => state["symbol"]),
    ["AAPL", "MSFT"],
  );

  subscription.unsubscribe();
  __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
});

test("signal matrix stream subscriber keeps only the newest queued cell state", async () => {
  __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
  const scope =
    __signalMonitorInternalsForTests.normalizeSignalMonitorMatrixStreamScope({
      environment: "shadow",
      symbols: ["AAPL"],
      timeframes: ["5m"],
    });
  const events: { event: string; states?: Record<string, unknown>[] }[] = [];
  const subscription =
    __signalMonitorInternalsForTests.createSignalMonitorMatrixStreamSubscriptionForTests(
      {
        scope,
        profile: profile(),
        prime: false,
        coalesceStateDeltas: true,
        onEvent(event) {
          events.push(event as never);
        },
      },
    );

  for (const latestBarClose of [101, 102]) {
    __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta(
      {
        message: { symbol: "AAPL" },
        evaluatedAt,
        evaluateState(input) {
          return directionalStreamState(input.symbol, input.timeframe, {
            latestBarClose,
            latestBarAt: new Date(
              `2026-06-09T15:${latestBarClose === 101 ? "00" : "05"}:00.000Z`,
            ),
          });
        },
      },
    );
  }

  await new Promise((resolve) => setTimeout(resolve, fastFlushMs + 20));
  assert.equal(events.length, 1);
  assert.equal(events[0]?.states?.length, 1);
  assert.equal(events[0]?.states?.[0]?.["latestBarClose"], 102);

  subscription.unsubscribe();
  __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
});

test("signal matrix stream subscriber splits coalesced frames at 2000 states", async () => {
  __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
  const symbols = Array.from({ length: 1_001 }, (_, index) => `SYM${index}`);
  const scope =
    __signalMonitorInternalsForTests.normalizeSignalMonitorMatrixStreamScope({
      environment: "shadow",
      symbols,
      timeframes: ["1m", "5m"],
    });
  const events: { event: string; states?: Record<string, unknown>[] }[] = [];
  const subscription =
    __signalMonitorInternalsForTests.createSignalMonitorMatrixStreamSubscriptionForTests(
      {
        scope,
        profile: profile(),
        prime: false,
        coalesceStateDeltas: true,
        onEvent(event) {
          events.push(event as never);
        },
      },
    );

  for (const symbol of symbols) {
    __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta(
      {
        message: { symbol },
        evaluatedAt,
        evaluateState(input) {
          return directionalStreamState(input.symbol, input.timeframe);
        },
      },
    );
  }

  await new Promise((resolve) => setTimeout(resolve, fastFlushMs + 20));
  assert.deepEqual(
    events.map((event) => event.states?.length),
    [2_000, 2],
  );

  subscription.unsubscribe();
  __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
});

test("signal matrix stream subscriber unsubscribe cancels queued deltas", async () => {
  __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
  const scope =
    __signalMonitorInternalsForTests.normalizeSignalMonitorMatrixStreamScope({
      environment: "shadow",
      symbols: ["AAPL"],
      timeframes: ["5m"],
    });
  const events: { event: string; states?: Record<string, unknown>[] }[] = [];
  const subscription =
    __signalMonitorInternalsForTests.createSignalMonitorMatrixStreamSubscriptionForTests(
      {
        scope,
        profile: profile(),
        prime: false,
        coalesceStateDeltas: true,
        onEvent(event) {
          events.push(event as never);
        },
      },
    );

  __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta({
    message: { symbol: "AAPL" },
    evaluatedAt,
    evaluateState(input) {
      return directionalStreamState(input.symbol, input.timeframe);
    },
  });
  subscription.unsubscribe();

  await new Promise((resolve) => setTimeout(resolve, fastFlushMs + 20));
  assert.equal(events.length, 0);
  __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
});

test("server-owned producer keeps coalesced subscriber path silent", async () => {
  __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
  const scope =
    __signalMonitorInternalsForTests.normalizeSignalMonitorMatrixStreamScope({
      environment: "shadow",
      symbols: ["AAPL"],
      timeframes: ["5m"],
    });
  const events: { event: string; states?: Record<string, unknown>[] }[] = [];
  const subscription =
    __signalMonitorInternalsForTests.createSignalMonitorMatrixStreamSubscriptionForTests(
      {
        scope,
        profile: profile(),
        prime: false,
        serverOwnedProducer: true,
        coalesceStateDeltas: true,
        onEvent(event) {
          events.push(event as never);
        },
      },
    );

  __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta({
    message: { symbol: "AAPL" },
    evaluatedAt,
    evaluateState(input) {
      return directionalStreamState(input.symbol, input.timeframe);
    },
  });

  await new Promise((resolve) => setTimeout(resolve, fastFlushMs + 20));
  assert.equal(events.length, 0);

  subscription.unsubscribe();
  __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
});

test("real stream subscriber defers pre-bootstrap deltas and snapshot seeds only missing cells", async () => {
  __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
  const subscriberProfile = profile();
  const scope =
    __signalMonitorInternalsForTests.normalizeSignalMonitorMatrixStreamScope({
      environment: "shadow",
      symbols: ["AAPL", "MSFT"],
      timeframes: ["5m"],
    });
  const events: { event: string; states?: Record<string, unknown>[] }[] = [];
  const subscription =
    __signalMonitorInternalsForTests.createSignalMonitorMatrixStreamSubscriptionForTests(
      {
        scope,
        profile: subscriberProfile,
        prime: false,
        coalesceStateDeltas: true,
        deferStateDeltasUntilSnapshot: true,
        onEvent(event) {
          events.push(event as never);
        },
      },
    );

  __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta({
    message: { symbol: "AAPL" },
    evaluatedAt,
    evaluateState(input) {
      return directionalStreamState(input.symbol, input.timeframe, {
        currentSignalDirection: null,
        currentSignalAt: null,
        currentSignalPrice: null,
        barsSinceSignal: null,
        fresh: false,
        latestBarClose: 102,
        latestBarAt: new Date("2026-06-09T15:05:00.000Z"),
      });
    },
  });

  await new Promise((resolve) => setTimeout(resolve, fastFlushMs + 20));
  assert.equal(events.length, 0);

  subscription.recordSnapshot(
    [
      directionalStreamState("AAPL", "5m", {
        latestBarClose: 101,
        latestBarAt: new Date("2026-06-09T15:00:00.000Z"),
      }),
      directionalStreamState("MSFT", "5m", {
        latestBarClose: 201,
        latestBarAt: new Date("2026-06-09T15:00:00.000Z"),
      }),
    ].map((state) =>
      __signalMonitorInternalsForTests.withSignalMonitorMatrixStreamActionability(
        state,
        subscriberProfile,
      ),
    ),
  );

  await new Promise((resolve) => setTimeout(resolve, fastFlushMs + 20));
  assert.equal(events.length, 1);
  assert.equal(events[0]?.states?.length, 1);
  assert.equal(events[0]?.states?.[0]?.["symbol"], "AAPL");
  assert.equal(events[0]?.states?.[0]?.["latestBarClose"], 102);
  assert.equal(events[0]?.states?.[0]?.["currentSignalDirection"], "buy");
  assert.equal(
    (events[0]?.states?.[0]?.["currentSignalAt"] as Date).toISOString(),
    "2026-06-09T14:55:00.000Z",
  );

  __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta({
    message: { symbol: "MSFT" },
    evaluatedAt,
    evaluateState(input) {
      return directionalStreamState(input.symbol, input.timeframe, {
        latestBarClose: 201,
        latestBarAt: new Date("2026-06-09T15:00:00.000Z"),
      });
    },
  });
  await new Promise((resolve) => setTimeout(resolve, fastFlushMs + 20));
  assert.equal(events.length, 1);

  subscription.unsubscribe();
  __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
});

test("pre-bootstrap queued deltas cannot regress a newer stored snapshot", async () => {
  __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
  const subscriberProfile = profile();
  const scope =
    __signalMonitorInternalsForTests.normalizeSignalMonitorMatrixStreamScope({
      environment: "shadow",
      symbols: ["AAPL"],
      timeframes: ["5m"],
    });
  const events: { event: string; states?: Record<string, unknown>[] }[] = [];
  const subscription =
    __signalMonitorInternalsForTests.createSignalMonitorMatrixStreamSubscriptionForTests(
      {
        scope,
        profile: subscriberProfile,
        prime: false,
        coalesceStateDeltas: true,
        deferStateDeltasUntilSnapshot: true,
        onEvent(event) {
          events.push(event as never);
        },
      },
    );

  __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta({
    message: { symbol: "AAPL" },
    evaluatedAt,
    evaluateState(input) {
      return directionalStreamState(input.symbol, input.timeframe, {
        currentSignalDirection: "buy",
        currentSignalAt: new Date("2026-06-09T14:55:00.000Z"),
        latestBarClose: 101,
        latestBarAt: new Date("2026-06-09T15:00:00.000Z"),
      });
    },
  });

  const storedSnapshot =
    __signalMonitorInternalsForTests.withSignalMonitorMatrixStreamActionability(
      directionalStreamState("AAPL", "5m", {
        currentSignalDirection: "sell",
        currentSignalAt: new Date("2026-06-09T15:05:00.000Z"),
        currentSignalPrice: 99,
        latestBarClose: 99,
        latestBarAt: new Date("2026-06-09T15:05:00.000Z"),
        lastEvaluatedAt: new Date("2026-06-09T15:05:30.000Z"),
      }),
      subscriberProfile,
    );
  subscription.recordSnapshot([storedSnapshot]);

  await new Promise((resolve) => setTimeout(resolve, fastFlushMs + 20));
  assert.equal(events.length, 0);

  const laterEvaluationAt = new Date("2026-06-09T15:10:00.000Z");
  __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta({
    message: { symbol: "AAPL" },
    evaluatedAt: laterEvaluationAt,
    evaluateState(input) {
      return directionalStreamState(input.symbol, input.timeframe, {
        currentSignalDirection: null,
        currentSignalAt: null,
        currentSignalPrice: null,
        latestBarClose: 100,
        latestBarAt: laterEvaluationAt,
        lastEvaluatedAt: laterEvaluationAt,
      });
    },
  });

  await new Promise((resolve) => setTimeout(resolve, fastFlushMs + 20));
  assert.equal(events.length, 1);
  assert.equal(events[0]?.states?.[0]?.["currentSignalDirection"], "sell");
  assert.equal(
    (events[0]?.states?.[0]?.["currentSignalAt"] as Date).toISOString(),
    "2026-06-09T15:05:00.000Z",
  );
  assert.equal(
    (events[0]?.states?.[0]?.["latestBarAt"] as Date).toISOString(),
    "2026-06-09T15:10:00.000Z",
  );

  subscription.unsubscribe();
  __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
});

function directionalStreamState(
  symbol: string,
  timeframe: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `profile-test:${symbol}:${timeframe}`,
    profileId: "profile-test",
    symbol,
    timeframe,
    currentSignalDirection: "buy",
    currentSignalAt: new Date("2026-06-09T14:55:00.000Z"),
    currentSignalPrice: 101.5,
    latestBarAt: new Date("2026-06-09T15:00:00.000Z"),
    barsSinceSignal: 1,
    fresh: true,
    status: "ok",
    active: true,
    lastEvaluatedAt: evaluatedAt,
    lastError: null,
    indicatorSnapshot: null,
    canonicalSignalEvent: null,
    ...overrides,
  } as any;
}

test("stream deltas latch direction across directionless re-evaluations", () => {
  withSignalMonitorBarEvaluationEnabled(() => {
    __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
    const scope =
      __signalMonitorInternalsForTests.normalizeSignalMonitorMatrixStreamScope({
        environment: "shadow",
        symbols: ["AAPL"],
        timeframes: ["5m"],
      });
    const events: { event: string; states?: Record<string, unknown>[] }[] = [];
    const subscription =
      __signalMonitorInternalsForTests.createSignalMonitorMatrixStreamSubscriptionForTests(
        {
          scope,
          profile: profile(),
          prime: false,
          onEvent(event) {
            events.push(event as never);
          },
        },
      );

    __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta(
      {
        message: { symbol: "AAPL" },
        evaluatedAt,
        evaluateState(input) {
          return directionalStreamState(input.symbol, input.timeframe);
        },
      },
    );
    assert.equal(events.length, 1);
    const first = events[0]?.states?.[0];
    assert.equal(first?.["currentSignalDirection"], "buy");
    assert.equal(first?.["actionEligible"], true);
    assert.equal(first?.["actionBlocker"], null);

    // A re-evaluation with no new signal must not erase the latched buy on
    // the wire; bar age advances from timestamps and the cell stops being
    // action-eligible by age.
    __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta(
      {
        message: { symbol: "AAPL" },
        evaluatedAt,
        evaluateState(input) {
          return directionalStreamState(input.symbol, input.timeframe, {
            currentSignalDirection: null,
            currentSignalAt: null,
            currentSignalPrice: null,
            barsSinceSignal: null,
            fresh: false,
            latestBarAt: new Date("2026-06-09T15:40:00.000Z"),
          });
        },
      },
    );
    assert.equal(events.length, 2);
    const latched = events[1]?.states?.[0];
    assert.equal(latched?.["currentSignalDirection"], "buy");
    assert.equal(
      (latched?.["currentSignalAt"] as Date).toISOString(),
      "2026-06-09T14:55:00.000Z",
    );
    assert.equal(latched?.["barsSinceSignal"], 9);
    assert.equal(latched?.["fresh"], false);
    assert.equal(latched?.["actionEligible"], false);
    assert.equal(latched?.["actionBlocker"], "signal_too_old");

    subscription.unsubscribe();
    __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
  });
});

test("trend-only bootstrap directions do not become latched signal identity", () => {
  withSignalMonitorBarEvaluationEnabled(() => {
    __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
    const scope =
      __signalMonitorInternalsForTests.normalizeSignalMonitorMatrixStreamScope({
        environment: "shadow",
        symbols: ["AAPL"],
        timeframes: ["5m"],
      });
    const events: { event: string; states?: Record<string, unknown>[] }[] = [];
    const subscription =
      __signalMonitorInternalsForTests.createSignalMonitorMatrixStreamSubscriptionForTests(
        {
          scope,
          profile: profile(),
          prime: false,
          onEvent(event) {
            events.push(event as never);
          },
        },
      );

    // REST/bootstrap responses expose the measured trend as a display direction,
    // but the missing timestamp proves this is not crossover signal identity.
    subscription.recordSnapshot([
      directionalStreamState("AAPL", "5m", {
        currentSignalDirection: "buy",
        currentSignalAt: null,
        currentSignalPrice: null,
        barsSinceSignal: null,
        fresh: false,
        trendDirection: "bullish",
        indicatorSnapshot: { trendDirection: "bullish" },
      }),
    ]);

    __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta(
      {
        message: { symbol: "AAPL" },
        evaluatedAt,
        evaluateState(input) {
          return directionalStreamState(input.symbol, input.timeframe, {
            currentSignalDirection: null,
            currentSignalAt: null,
            currentSignalPrice: null,
            barsSinceSignal: null,
            fresh: false,
            latestBarAt: new Date("2026-06-09T15:05:00.000Z"),
            indicatorSnapshot: { trendDirection: "bullish" },
          });
        },
      },
    );

    const state = events.at(-1)?.states?.[0];
    assert.equal(state?.["currentSignalDirection"], null);
    assert.equal(state?.["currentSignalAt"], null);
    assert.equal(state?.["trendDirection"], "bullish");
    assert.equal(state?.["actionBlocker"], "no_signal");

    subscription.unsubscribe();
    __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
  });
});

test("stream deltas do not regress a latched signal to an older recompute", () => {
  withSignalMonitorBarEvaluationEnabled(() => {
    __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
    const scope =
      __signalMonitorInternalsForTests.normalizeSignalMonitorMatrixStreamScope({
        environment: "shadow",
        symbols: ["AAPL"],
        timeframes: ["5m"],
      });
    const events: { event: string; states?: Record<string, unknown>[] }[] = [];
    const subscription =
      __signalMonitorInternalsForTests.createSignalMonitorMatrixStreamSubscriptionForTests(
        {
          scope,
          profile: profile(),
          prime: false,
          onEvent(event) {
            events.push(event as never);
          },
        },
      );

    // Latch the canonical signal: buy @ 14:55.
    __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta(
      {
        message: { symbol: "AAPL" },
        evaluatedAt,
        evaluateState(input) {
          return directionalStreamState(input.symbol, input.timeframe);
        },
      },
    );
    assert.equal(events[0]?.states?.[0]?.["currentSignalDirection"], "buy");

    // An under-warmed stream recompute rediscovers an OLDER, opposite crossover
    // (sell @ 06-01). A genuine new signal only moves signalAt forward, so this
    // is a regression and must NOT overwrite the newer latched buy (the STA
    // freeze / bad-sort / weeks-old-survives-refresh bug). Bar metadata still
    // advances so the cell is not frozen.
    __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta(
      {
        message: { symbol: "AAPL" },
        evaluatedAt,
        evaluateState(input) {
          return directionalStreamState(input.symbol, input.timeframe, {
            currentSignalDirection: "sell",
            currentSignalAt: new Date("2026-06-01T14:55:00.000Z"),
            currentSignalPrice: 90,
            barsSinceSignal: 200,
            fresh: false,
            latestBarAt: new Date("2026-06-09T15:10:00.000Z"),
          });
        },
      },
    );
    const regressed = events.at(-1)?.states?.[0];
    assert.equal(regressed?.["currentSignalDirection"], "buy");
    assert.equal(
      (regressed?.["currentSignalAt"] as Date).toISOString(),
      "2026-06-09T14:55:00.000Z",
    );

    // A genuinely NEWER crossover (sell @ 15:05) is a real flip and MUST win.
    __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta(
      {
        message: { symbol: "AAPL" },
        evaluatedAt,
        evaluateState(input) {
          return directionalStreamState(input.symbol, input.timeframe, {
            currentSignalDirection: "sell",
            currentSignalAt: new Date("2026-06-09T15:05:00.000Z"),
            currentSignalPrice: 99,
            barsSinceSignal: 1,
            fresh: true,
            latestBarAt: new Date("2026-06-09T15:10:00.000Z"),
          });
        },
      },
    );
    const advanced = events.at(-1)?.states?.[0];
    assert.equal(advanced?.["currentSignalDirection"], "sell");
    assert.equal(
      (advanced?.["currentSignalAt"] as Date).toISOString(),
      "2026-06-09T15:05:00.000Z",
    );

    subscription.unsubscribe();
    __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
  });
});

test("stale evaluations keep signal identity and report data_stale", () => {
  withSignalMonitorBarEvaluationEnabled(() => {
    __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
    const scope =
      __signalMonitorInternalsForTests.normalizeSignalMonitorMatrixStreamScope({
        environment: "shadow",
        symbols: ["AAPL"],
        timeframes: ["5m"],
      });
    const events: { event: string; states?: Record<string, unknown>[] }[] = [];
    const subscription =
      __signalMonitorInternalsForTests.createSignalMonitorMatrixStreamSubscriptionForTests(
        {
          scope,
          profile: profile(),
          prime: false,
          onEvent(event) {
            events.push(event as never);
          },
        },
      );

    __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta(
      {
        message: { symbol: "AAPL" },
        evaluatedAt,
        evaluateState(input) {
          return directionalStreamState(input.symbol, input.timeframe, {
            status: "stale",
            fresh: false,
          });
        },
      },
    );
    assert.equal(events.length, 1);
    const state = events[0]?.states?.[0];
    assert.equal(state?.["currentSignalDirection"], "buy");
    assert.equal(state?.["status"], "stale");
    assert.equal(state?.["actionEligible"], false);
    assert.equal(state?.["actionBlocker"], "data_stale");

    subscription.unsubscribe();
    __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
  });
});

test("server-owned producer scope normalizes and dedupes universe symbols", () => {
  const scope =
    __signalMonitorInternalsForTests.buildSignalMonitorServerOwnedProducerScope(
      {
        environment: "shadow",
        symbols: ["aapl", "AAPL", " msft ", ""],
        timeframes: ["1m", "5m"],
      },
    );

  assert.deepEqual(scope.symbols, ["AAPL", "MSFT"]);
  assert.equal(scope.exactCells, false);
  assert.deepEqual(scope.timeframes, ["1m", "5m"]);
  assert.equal(scope.requestedSymbolCount, 2);
});

test("server-owned producer startup and minute refresh enter the bulk DB lane", () => {
  const start = serviceSource.indexOf(
    "export function startSignalMonitorServerOwnedProducer",
  );
  const end = serviceSource.indexOf(
    "\n// ---------------------------------------------------------------------------\n// Stored-state reconciliation",
    start,
  );
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const startupBlock = serviceSource.slice(start, end);
  const bulkRefresh =
    /void runSignalMonitorDbLane\(\s*"bulk",\s*refreshSignalMonitorServerOwnedProducers,\s*\);/g;

  assert.equal(
    Array.from(startupBlock.matchAll(bulkRefresh)).length,
    2,
    "the immediate refresh and 60s timer refresh must both inherit the bulk lane",
  );
  assert.match(
    startupBlock,
    /setInterval\(\(\) => \{\s*void runSignalMonitorDbLane\(\s*"bulk",\s*refreshSignalMonitorServerOwnedProducers,\s*\);\s*\}, SIGNAL_MONITOR_SERVER_OWNED_PRODUCER_REFRESH_MS\)/,
  );
});

test("nonempty producer is marked active before durable scope reconciliation", () => {
  const start = serviceSource.indexOf(
    "async function refreshSignalMonitorServerOwnedProducers",
  );
  const end = serviceSource.indexOf(
    "\nexport function startSignalMonitorServerOwnedProducer",
    start,
  );
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const refreshBlock = serviceSource.slice(start, end);
  const registration = refreshBlock.indexOf(
    "registerSignalMonitorServerOwnedProducer({",
  );
  const reconciliation = refreshBlock.indexOf(
    "await reconcileSignalMonitorServerOwnedProducerStateScope({",
    registration,
  );
  const active = refreshBlock.indexOf(
    "activeEnvironments.add(universe.profile.environment);",
    registration,
  );

  assert.notEqual(registration, -1);
  assert.ok(reconciliation > registration);
  assert.ok(
    active > registration && active < reconciliation,
    "a registered producer must survive a failed durable reconciliation",
  );
});

test("empty producer scope deactivates every active row and invalidates cached state", async () => {
  await withTestDb(async ({ db }) => {
    const profileId = "00000000-0000-4000-8000-0000000000e6";
    await db.execute(sql`
      INSERT INTO signal_monitor_profiles
        (id, environment, enabled, fresh_window_bars)
      VALUES (${profileId}, 'shadow', true, 3)
    `);
    await db.execute(sql`
      INSERT INTO signal_monitor_symbol_states
        (profile_id, signal_settings_revision, symbol, timeframe, latest_bar_close, fresh, status, active)
      VALUES
        (${profileId}, 1, 'AAPL', '1m', 100, true, 'ok', true),
        (${profileId}, 1, 'MSFT', '5m', 200, true, 'ok', true)
    `);

    __signalMonitorInternalsForTests.clearSignalMonitorStateRowsCacheForTests();
    const before =
      await __signalMonitorInternalsForTests.loadSignalMonitorActiveStateRowsForTests(
        {
          profileId,
          signalSettingsRevision: 1,
          timeframes: ["1m", "5m"],
        },
      );
    assert.equal(before.length, 2);

    await __signalMonitorInternalsForTests.reconcileSignalMonitorServerOwnedProducerStateScope(
      {
        profile: profile(profileId),
        scope:
          __signalMonitorInternalsForTests.buildSignalMonitorServerOwnedProducerScope(
            {
              environment: "shadow",
              symbols: [],
              timeframes: ["1m", "5m"],
            },
          ),
        evaluatedAt,
      },
    );

    const persisted = await db.execute(sql`
      SELECT symbol, active
      FROM signal_monitor_symbol_states
      WHERE profile_id = ${profileId}
      ORDER BY symbol
    `);
    assert.deepEqual(
      persisted.rows.map((row) => [row.symbol, row.active]),
      [
        ["AAPL", false],
        ["MSFT", false],
      ],
    );
    const after =
      await __signalMonitorInternalsForTests.loadSignalMonitorActiveStateRowsForTests(
        {
          profileId,
          signalSettingsRevision: 1,
          timeframes: ["1m", "5m"],
        },
      );
    assert.equal(after.length, 0);
    assert.notEqual(
      after,
      before,
      "deactivation must invalidate the active-state cache",
    );
    __signalMonitorInternalsForTests.clearSignalMonitorStateRowsCacheForTests();
  });
});

test("producer reconciliation deactivates in-scope rows from an older signal-settings revision", async () => {
  await withTestDb(async ({ db }) => {
    const profileId = "00000000-0000-4000-8000-0000000000e7";
    await db.execute(sql`
      INSERT INTO signal_monitor_profiles
        (id, environment, enabled, signal_settings_revision, fresh_window_bars)
      VALUES (${profileId}, 'shadow', true, 2, 3)
    `);
    await db.execute(sql`
      INSERT INTO signal_monitor_symbol_states
        (profile_id, symbol, timeframe, signal_settings_revision, fresh, status, active)
      VALUES
        (${profileId}, 'AAPL', '1m', 2, false, 'ok', true),
        (${profileId}, 'MSFT', '1m', NULL, false, 'ok', true),
        (${profileId}, 'NVDA', '1m', 2, false, 'ok', true)
    `);

    await __signalMonitorInternalsForTests.reconcileSignalMonitorServerOwnedProducerStateScope(
      {
        profile: profile(profileId, { signalSettingsRevision: 2 }),
        scope:
          __signalMonitorInternalsForTests.buildSignalMonitorServerOwnedProducerScope(
            {
              environment: "shadow",
              symbols: ["AAPL", "MSFT"],
              timeframes: ["1m"],
            },
          ),
        evaluatedAt,
      },
    );

    const persisted = await db.execute(sql`
      SELECT symbol, active
      FROM signal_monitor_symbol_states
      WHERE profile_id = ${profileId}
      ORDER BY symbol
    `);
    assert.deepEqual(
      persisted.rows.map((row) => [row.symbol, row.active]),
      [
        ["AAPL", true],
        ["MSFT", false],
        ["NVDA", false],
      ],
    );
  });
});

test("producer reconciliation key changes with the signal-settings revision", () => {
  const reconciliationKey =
    __signalMonitorInternalsForTests.signalMonitorServerOwnedProducerReconciliationKeyForTests;
  const scope =
    __signalMonitorInternalsForTests.buildSignalMonitorServerOwnedProducerScope({
      environment: "shadow",
      symbols: ["AAPL"],
      timeframes: ["1m"],
    });

  assert.notEqual(
    reconciliationKey({
      profile: profile("profile-revision-key", {
        signalSettingsRevision: 1,
      }),
      scope,
    }),
    reconciliationKey({
      profile: profile("profile-revision-key", {
        signalSettingsRevision: 2,
      }),
      scope,
    }),
  );
});

test("empty producer universes reconcile once while fallback preserves the prior scope", () => {
  const refreshStart = serviceSource.indexOf(
    "async function refreshSignalMonitorServerOwnedProducers",
  );
  const refreshEnd = serviceSource.indexOf(
    "export function startSignalMonitorServerOwnedProducer",
    refreshStart,
  );
  assert.notEqual(refreshStart, -1);
  assert.notEqual(refreshEnd, -1);
  const refreshBlock = serviceSource.slice(refreshStart, refreshEnd);

  assert.match(
    refreshBlock,
    /if \(!symbols\.length\) \{[\s\S]*if \(!universe\.fallbackUsed\) \{[\s\S]*reconcileSignalMonitorServerOwnedProducerStateScope/,
  );
  assert.match(
    refreshBlock,
    /signalMonitorServerOwnedProducerReconciliationKeys\.get\([\s\S]*!==\s*reconciliationKey/,
  );
  assert.match(
    refreshBlock,
    /else if \(existing\) \{[\s\S]*primeSignalMonitorMatrixStockAggregateStream/,
  );
  assert.match(
    refreshBlock,
    /for \(\s*const environment of\s*signalMonitorServerOwnedProducerReconciliationKeys\.keys\(\)\s*\) \{[\s\S]*!profileEnvironments\.has\(environment\)/,
  );
});

test("producer backfill returns every due cell with cold cells first", () => {
  const nowMs = Date.parse("2026-06-23T18:30:00.000Z");
  const coldCandidates = ["AAPL", "MSFT", "NVDA", "SPY"].map((symbol) => ({
    symbol,
    timeframe: "1h" as const,
    refreshedAt: null,
  }));
  const warmCandidates = ["QQQ", "IWM", "DIA"].map((symbol) => ({
    symbol,
    timeframe: "1h" as const,
    refreshedAt: 0,
  }));

  const withCold =
    __signalMonitorInternalsForTests.selectSignalMonitorBackfillDueCells({
      candidates: [...coldCandidates, ...warmCandidates],
      nowMs,
    });

  assert.equal(withCold.length, 7);
  assert.ok(
    withCold
      .slice(0, coldCandidates.length)
      .every((cell) =>
        coldCandidates.some((candidate) => candidate.symbol === cell.symbol),
      ),
  );

  const warmedOnly =
    __signalMonitorInternalsForTests.selectSignalMonitorBackfillDueCells({
      candidates: warmCandidates,
      nowMs,
    });

  assert.equal(warmedOnly.length, 3);
});

test("producer backfill prioritizes history-unready cells without dropping ordinary work", () => {
  const selected =
    __signalMonitorInternalsForTests.selectSignalMonitorBackfillDueCells({
      candidates: [
        {
          symbol: "ORDINARY",
          timeframe: "1h" as const,
          refreshedAt: null,
          readinessPriority: 2,
        },
        {
          symbol: "ALSO-ORDINARY",
          timeframe: "15m" as const,
          refreshedAt: null,
          readinessPriority: 2,
        },
        {
          symbol: "NO-TREND",
          timeframe: "5m" as const,
          refreshedAt: null,
          readinessPriority: 1,
        },
        {
          symbol: "NO-DIRECTION",
          timeframe: "1h" as const,
          refreshedAt: null,
          readinessPriority: 0,
        },
      ],
      nowMs: Date.parse("2026-07-13T14:20:00.000Z"),
    });

  assert.deepEqual(selected, [
    { symbol: "NO-DIRECTION", timeframe: "1h" },
    { symbol: "NO-TREND", timeframe: "5m" },
    { symbol: "ORDINARY", timeframe: "1h" },
    { symbol: "ALSO-ORDINARY", timeframe: "15m" },
  ]);
});

test("server-owned producer selects only the canonical universal Signal profile", () => {
  const selected =
    __signalMonitorInternalsForTests.selectCanonicalSignalMonitorProducerProfiles(
      [
        profile("shadow-profile", {
          environment: "shadow",
          pyrusSignalsSettings: { basisLength: 20 },
        }),
        profile("live-profile", {
          environment: "live",
          pyrusSignalsSettings: { basisLength: 40 },
        }),
      ],
    );

  assert.deepEqual(
    selected.map((candidate) => candidate.environment),
    ["shadow"],
    "deployment environments must not create duplicate upstream Signal producers",
  );
});

test("server-owned producer reconciles persisted state only when its scope changes", () => {
  withSignalMonitorBarEvaluationEnabled(() => {
    __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
    const oneMinuteScope =
      __signalMonitorInternalsForTests.buildSignalMonitorServerOwnedProducerScope(
        {
          environment: "shadow",
          symbols: ["AAPL"],
          timeframes: ["1m"],
        },
      );
    const widerScope =
      __signalMonitorInternalsForTests.buildSignalMonitorServerOwnedProducerScope(
        {
          environment: "shadow",
          symbols: ["AAPL"],
          timeframes: ["1m", "5m"],
        },
      );
    const input = {
      environment: "shadow" as const,
      profile: profile(),
      scope: oneMinuteScope,
    };

    assert.equal(
      __signalMonitorInternalsForTests.registerSignalMonitorServerOwnedProducer(
        input,
      ),
      true,
    );
    assert.equal(
      __signalMonitorInternalsForTests.registerSignalMonitorServerOwnedProducer(
        input,
      ),
      false,
    );
    assert.equal(
      __signalMonitorInternalsForTests.registerSignalMonitorServerOwnedProducer(
        {
          ...input,
          scope: widerScope,
        },
      ),
      true,
    );

    __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
  });
});

test("server-owned producer evaluates bar-close ticks with no UI subscriber", () => {
  withSignalMonitorBarEvaluationEnabled(() => {
    __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
    const scope =
      __signalMonitorInternalsForTests.buildSignalMonitorServerOwnedProducerScope(
        {
          environment: "shadow",
          symbols: ["AAPL", "MSFT"],
          timeframes: ["1m"],
        },
      );
    // Register the server-owned producer (no UI client connected).
    __signalMonitorInternalsForTests.registerSignalMonitorServerOwnedProducer({
      environment: "shadow",
      profile: profile(),
      scope,
    });

    const evalCalls: string[] = [];
    __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta(
      {
        message: { symbol: "AAPL" },
        evaluatedAt,
        evaluateState(input) {
          evalCalls.push(`${input.symbol}:${input.timeframe}`);
          return streamState(input.symbol, input.timeframe, "server-owned");
        },
      },
    );

    // The producer evaluated the universe symbol despite zero UI subscribers,
    // and only for the tick's symbol (keystone gap fixed).
    assert.deepEqual(evalCalls, ["AAPL:1m"]);
    __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
  });
});

test("aggregate emission reports matching-cell evaluation failures to replay callers", () => {
  withSignalMonitorBarEvaluationEnabled(() => {
    __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
    const scope =
      __signalMonitorInternalsForTests.buildSignalMonitorServerOwnedProducerScope(
        {
          environment: "shadow",
          symbols: ["AAPL"],
          timeframes: ["1m"],
        },
      );
    __signalMonitorInternalsForTests.registerSignalMonitorServerOwnedProducer({
      environment: "shadow",
      profile: profile(),
      scope,
    });
    const evaluationFailure = new Error("replay evaluation failed");

    const outcome =
      __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta(
        {
          message: { symbol: "AAPL" },
          evaluatedAt,
          evaluateState() {
            throw evaluationFailure;
          },
        },
      );

    assert.equal(outcome.matchingEvaluationCount, 1);
    assert.deepEqual(outcome.evaluationErrors, [evaluationFailure]);
    __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
  });
});

test("server-owned producer replaces same-universe subscriber after profile settings change", () => {
  withSignalMonitorBarEvaluationEnabled(() => {
    __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
    const scope =
      __signalMonitorInternalsForTests.buildSignalMonitorServerOwnedProducerScope(
        {
          environment: "shadow",
          symbols: ["AAPL"],
          timeframes: ["1m"],
        },
      );

    __signalMonitorInternalsForTests.registerSignalMonitorServerOwnedProducer({
      environment: "shadow",
      profile: profile("profile-test", {
        pyrusSignalsSettings: { waitForBarClose: false },
      }),
      scope,
    });
    __signalMonitorInternalsForTests.registerSignalMonitorServerOwnedProducer({
      environment: "shadow",
      profile: profile("profile-test", {
        pyrusSignalsSettings: { waitForBarClose: true },
      }),
      scope,
    });

    const waitForBarCloseValues: unknown[] = [];
    __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta(
      {
        message: { symbol: "AAPL" },
        evaluatedAt,
        evaluateState(input) {
          waitForBarCloseValues.push(
            (input.profile.pyrusSignalsSettings as Record<string, unknown>)
              .waitForBarClose,
          );
          return streamState(input.symbol, input.timeframe, "server-owned");
        },
      },
    );

    assert.deepEqual(waitForBarCloseValues, [true]);
    __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
  });
});

test("matrix stream uses idle flush cadence with only synthetic subscribers", () => {
  withFakeMatrixStreamTimers(() => {
    __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
    const scope =
      __signalMonitorInternalsForTests.normalizeSignalMonitorMatrixStreamScope({
        environment: "shadow",
        symbols: ["AAPL"],
        timeframes: ["1m"],
      });
    const subscription =
      __signalMonitorInternalsForTests.createSignalMonitorMatrixStreamSubscriptionForTests(
        {
          scope,
          profile: profile(),
          prime: false,
          serverOwnedProducer: true,
          onEvent() {},
        },
      );

    __signalMonitorInternalsForTests.queueSignalMonitorMatrixStreamAggregate({
      symbol: "AAPL",
      startMs: evaluatedAt.getTime(),
    } as never);

    assert.equal(
      __signalMonitorInternalsForTests.getSignalMonitorMatrixStreamRealSubscriberCountForTests(),
      0,
    );
    assert.equal(
      __signalMonitorInternalsForTests.getSignalMonitorMatrixStreamFlushDelayForTests(),
      3000,
    );

    subscription.unsubscribe();
  });
});

test("matrix stream uses fast flush cadence with a real subscriber", () => {
  withFakeMatrixStreamTimers(() => {
    __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
    const scope =
      __signalMonitorInternalsForTests.normalizeSignalMonitorMatrixStreamScope({
        environment: "shadow",
        symbols: ["AAPL"],
        timeframes: ["1m"],
      });
    const subscription =
      __signalMonitorInternalsForTests.createSignalMonitorMatrixStreamSubscriptionForTests(
        {
          scope,
          profile: profile(),
          prime: false,
          onEvent() {},
        },
      );

    __signalMonitorInternalsForTests.queueSignalMonitorMatrixStreamAggregate({
      symbol: "AAPL",
      startMs: evaluatedAt.getTime(),
    } as never);

    assert.equal(
      __signalMonitorInternalsForTests.getSignalMonitorMatrixStreamRealSubscriberCountForTests(),
      1,
    );
    assert.equal(
      __signalMonitorInternalsForTests.getSignalMonitorMatrixStreamFlushDelayForTests(),
      fastFlushMs,
    );

    subscription.unsubscribe();
  });
});

test("server-owned producer subscriber does not count as real", () => {
  __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
  const scope =
    __signalMonitorInternalsForTests.buildSignalMonitorServerOwnedProducerScope(
      {
        environment: "shadow",
        symbols: ["AAPL"],
        timeframes: ["1m"],
      },
    );

  __signalMonitorInternalsForTests.registerSignalMonitorServerOwnedProducer({
    environment: "shadow",
    profile: profile(),
    scope,
  });

  assert.equal(
    __signalMonitorInternalsForTests.getSignalMonitorMatrixStreamRealSubscriberCountForTests(),
    0,
  );
  __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
});

test("matrix stream wakes promptly when a real subscriber attaches during idle cadence", () => {
  withFakeMatrixStreamTimers(({ delays, activeDelays }) => {
    __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
    const scope =
      __signalMonitorInternalsForTests.normalizeSignalMonitorMatrixStreamScope({
        environment: "shadow",
        symbols: ["AAPL"],
        timeframes: ["1m"],
      });
    const synthetic =
      __signalMonitorInternalsForTests.createSignalMonitorMatrixStreamSubscriptionForTests(
        {
          scope,
          profile: profile(),
          prime: false,
          serverOwnedProducer: true,
          onEvent() {},
        },
      );

    __signalMonitorInternalsForTests.queueSignalMonitorMatrixStreamAggregate({
      symbol: "AAPL",
      startMs: evaluatedAt.getTime(),
    } as never);

    assert.equal(
      __signalMonitorInternalsForTests.getSignalMonitorMatrixStreamFlushDelayForTests(),
      3000,
    );

    const real =
      __signalMonitorInternalsForTests.createSignalMonitorMatrixStreamSubscriptionForTests(
        {
          scope,
          profile: profile(),
          prime: false,
          onEvent() {},
        },
      );

    assert.deepEqual(delays.slice(-2), [3000, fastFlushMs]);
    assert.deepEqual(activeDelays(), [fastFlushMs]);
    assert.equal(
      __signalMonitorInternalsForTests.getSignalMonitorMatrixStreamFlushDelayForTests(),
      fastFlushMs,
    );

    real.unsubscribe();
    synthetic.unsubscribe();
  });
});

test("matrix producer still bails when neither client nor server-owned producer is present", () => {
  withSignalMonitorBarEvaluationEnabled(() => {
    __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
    const evalCalls: string[] = [];
    __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta(
      {
        message: { symbol: "AAPL" },
        evaluatedAt,
        evaluateState(input) {
          evalCalls.push(`${input.symbol}:${input.timeframe}`);
          return streamState(input.symbol, input.timeframe, "noop");
        },
      },
    );

    // No subscriber and no server-owned producer => no evaluation work.
    assert.equal(evalCalls.length, 0);
    __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
  });
});

test("signal matrix stream bootstrap event includes coverage metadata", () => {
  __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
  const scope =
    __signalMonitorInternalsForTests.normalizeSignalMonitorMatrixStreamScope({
      environment: "shadow",
      cells: [{ symbol: "AAPL", timeframe: "1m" }] as never,
    });
  const state = streamState("AAPL", "1m", "bootstrap");
  const event =
    __signalMonitorInternalsForTests.buildSignalMonitorMatrixStreamBootstrapEvent(
      {
        profile: { id: "profile-test" },
        states: [state],
        evaluatedAt,
        timeframes: ["1m"],
      } as never,
      scope,
    );

  assert.equal(event.event, "bootstrap");
  assert.equal(event.coverage.taskCount, 1);
  assert.equal(event.coverage.stateCount, 1);
  assert.equal(event.coverage.activeScopeSymbols, 1);
});

test("signal matrix stream bootstrap hydrates from stored canonical state", () => {
  __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
  const scope =
    __signalMonitorInternalsForTests.normalizeSignalMonitorMatrixStreamScope({
      environment: "shadow",
      symbols: ["DIA"],
      timeframes: ["5m", "15m"],
      clientRole: "leader",
      requestOrigin: "startup",
    });
  const event =
    __signalMonitorInternalsForTests.buildSignalMonitorMatrixStreamBootstrapEventFromStoredState(
      {
        profile: { id: "profile-test" },
        evaluatedAt,
        states: [
          {
            id: "profile-test:DIA:5m",
            profileId: "profile-test",
            signalSettingsRevision: 7,
            symbol: "DIA",
            timeframe: "5m",
            currentSignalDirection: "buy",
            currentSignalAt: new Date("2026-06-09T14:55:00.000Z"),
            currentSignalPrice: 430.12,
            latestBarAt: new Date("2026-06-09T15:00:00.000Z"),
            barsSinceSignal: 1,
            fresh: true,
            status: "ok",
            active: true,
            lastEvaluatedAt: evaluatedAt,
            lastError: null,
          },
          {
            id: "profile-test:DIA:15m:legacy",
            profileId: "profile-test",
            signalSettingsRevision: null,
            symbol: "DIA",
            timeframe: "15m",
            currentSignalDirection: "sell",
            currentSignalAt: new Date("2026-06-09T14:45:00.000Z"),
            currentSignalPrice: 429.5,
            latestBarAt: new Date("2026-06-09T15:00:00.000Z"),
            barsSinceSignal: 1,
            fresh: true,
            status: "ok",
            active: true,
            lastEvaluatedAt: evaluatedAt,
            lastError: null,
          },
          {
            id: "profile-test:SPY:5m",
            profileId: "profile-test",
            signalSettingsRevision: 7,
            symbol: "SPY",
            timeframe: "5m",
            currentSignalDirection: "sell",
            currentSignalAt: new Date("2026-06-09T14:55:00.000Z"),
            currentSignalPrice: 540.12,
            latestBarAt: new Date("2026-06-09T15:00:00.000Z"),
            barsSinceSignal: 1,
            fresh: true,
            status: "ok",
            active: true,
            lastEvaluatedAt: evaluatedAt,
            lastError: null,
          },
        ],
      } as never,
      scope,
    );

  assert.equal(event.event, "bootstrap");
  assert.deepEqual(
    event.states.map((state) => `${state.symbol}:${state.timeframe}`),
    ["DIA:5m"],
  );
  assert.equal(event.coverage.stateCount, 1);
  // Bootstrap states carry backend-authored actionability for the STA table.
  assert.equal(event.states[0]?.actionEligible, true);
  assert.equal(event.states[0]?.actionBlocker, null);
});

test("signal matrix stream bootstrap keeps stored unavailable cells as row placeholders", () => {
  __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
  const scope =
    __signalMonitorInternalsForTests.normalizeSignalMonitorMatrixStreamScope({
      environment: "shadow",
      symbols: ["INN", "IPAY"],
      timeframes: ["5m"],
      clientRole: "leader",
      requestOrigin: "startup",
    });
  const event =
    __signalMonitorInternalsForTests.buildSignalMonitorMatrixStreamBootstrapEventFromStoredState(
      {
        profile: { id: "profile-test", freshWindowBars: 3 },
        evaluatedAt,
        states: [
          {
            id: "profile-test:INN:5m:unavailable",
            profileId: "profile-test",
            signalSettingsRevision: 7,
            symbol: "INN",
            timeframe: "5m",
            currentSignalDirection: null,
            currentSignalAt: null,
            currentSignalPrice: null,
            latestBarAt: null,
            barsSinceSignal: null,
            fresh: false,
            status: "unavailable",
            active: true,
            lastEvaluatedAt: evaluatedAt,
            lastError:
              "No signal monitor state is available for this symbol/timeframe.",
          },
          {
            id: "profile-test:IPAY:5m",
            profileId: "profile-test",
            signalSettingsRevision: 7,
            symbol: "IPAY",
            timeframe: "5m",
            currentSignalDirection: "sell",
            currentSignalAt: new Date("2026-06-09T14:55:00.000Z"),
            currentSignalPrice: 12.34,
            latestBarAt: new Date("2026-06-09T15:00:00.000Z"),
            barsSinceSignal: 1,
            fresh: true,
            status: "ok",
            active: true,
            lastEvaluatedAt: evaluatedAt,
            lastError: null,
          },
        ],
      } as never,
      scope,
    );

  assert.equal(event.event, "bootstrap");
  assert.deepEqual(
    event.states.map(
      (state) => `${state.symbol}:${state.timeframe}:${state.status}`,
    ),
    ["INN:5m:unavailable", "IPAY:5m:ok"],
  );
  assert.equal(event.coverage.stateCount, 2);
  assert.equal(event.states[0]?.actionEligible, false);
  assert.equal(event.states[0]?.actionBlocker, "no_signal");
});
