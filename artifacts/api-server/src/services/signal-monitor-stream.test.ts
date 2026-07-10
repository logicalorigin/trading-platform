import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";

import { pool } from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";
import { sql } from "drizzle-orm";
import { __signalMonitorInternalsForTests } from "./signal-monitor";

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
  const stateRouteStart = routeSource.indexOf('router.get("/signal-monitor/state"');
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
  assert.match(
    stateRoute,
    /GetSignalMonitorStateResponse\.parse\(\s*await getSignalMonitorState\(/s,
  );
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
  assert.match(signatureBlock, /currentSignalMfePercent: state\.currentSignalMfePercent/);
  assert.match(signatureBlock, /currentSignalMaePercent: state\.currentSignalMaePercent/);
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
  assert.match(statusBlock, /const state = available \? "open" : "unavailable";/);
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

  assert.match(persistBlock, /if \(!isSignalMonitorUuidLike\(input\.profile\.id\)\) \{\s*return;/s);
  assert.match(persistBlock, /recordSignalMonitorDbFallback\(\s*error,\s*\{/s);
  assert.match(persistBlock, /operation:\s*"persist_signal_monitor_matrix_states"/);
  assert.match(persistBlock, /sourceStatus:\s*"persistence-failed"/);
});

test("signal matrix persistence does not gate signal identity on latest-bar trust", () => {
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

  assert.doesNotMatch(persistBlock, /signalIdentityTrusted\s*&&\s*latestBarTrusted/);
  assert.match(persistBlock, /allowStoredSignalLatch:\s*signalIdentityTrusted/);
  assert.match(persistBlock, /fresh:\s*latestBarTrusted\s*&&\s*status === "ok"/);
});

test("non-durable stream profiles do not enqueue DB persistence", () => {
  const emitStart = serviceSource.indexOf(
    "export function emitSignalMonitorMatrixStreamAggregateDelta",
  );
  const emitEnd = serviceSource.indexOf(
    "persistByProfile.forEach",
    emitStart,
  );
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
      __signalMonitorInternalsForTests.createSignalMonitorMatrixStreamSubscriptionForTests({
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
      });
    let direction: "buy" | "sell" = "buy";
    const makeState = () => {
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

    __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta({
      message: { symbol: "AAPL" },
      environment: "shadow",
      evaluatedAt: new Date("2026-06-09T15:00:00.000Z"),
      evaluateState: () => makeState(),
    });
    direction = "sell";
    __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta({
      message: { symbol: "AAPL" },
      environment: "shadow",
      evaluatedAt: new Date("2026-06-09T15:05:00.000Z"),
      evaluateState: () => makeState(),
    });

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const events = await db.execute(sql`
        SELECT direction
        FROM signal_monitor_events
        WHERE profile_id = ${profileId}
        ORDER BY signal_at
      `);
      if (events.rows.length >= 2) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    const states = await db.execute(sql`
      SELECT current_signal_direction
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

    const emit = (evaluatedAt: Date, overrides: Record<string, unknown>) => {
      __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta({
        message: { symbol: "AAPL" },
        environment: "shadow",
        evaluatedAt,
        evaluateState: (input: { symbol: string; timeframe: string }) =>
          ({
            ...directionalStreamState(input.symbol, input.timeframe, overrides),
            profileId,
          }) as never,
      });
    };

    __signalMonitorInternalsForTests.resetSignalMonitorPersistScheduleStatsForTests();

    // 1) baseline: new cell → SSE delivered + persist enqueued.
    emit(new Date("2026-06-09T15:00:00.000Z"), {});
    const afterBaseline =
      __signalMonitorInternalsForTests.getSignalMonitorPersistScheduleStatsForTests();
    assert.equal(events.length, 1, "baseline SSE delivered");
    assert.equal(afterBaseline.states, 1, "baseline enqueues a persist");

    // 2) display-only change (mfe moved) — identity/freshness bucket unchanged,
    // so the persist dirty-key is unchanged.
    emit(new Date("2026-06-09T15:00:30.000Z"), { currentSignalMfePercent: 3.21 });
    const afterDisplay =
      __signalMonitorInternalsForTests.getSignalMonitorPersistScheduleStatsForTests();
    assert.equal(events.length, 2, "display-only delta still delivered over SSE");
    assert.equal(
      afterDisplay.states - afterBaseline.states,
      0,
      "display-only change enqueues NO persist",
    );

    // 3) pure latestBarAt/status churn inside the 5-minute heartbeat bucket is
    // durability-neutral: signal identity is unchanged and bounded freshness is
    // still covered by the next heartbeat.
    emit(new Date("2026-06-09T15:01:00.000Z"), {
      latestBarAt: new Date("2026-06-09T15:01:00.000Z"),
      status: "stale",
    });
    const afterChurn =
      __signalMonitorInternalsForTests.getSignalMonitorPersistScheduleStatsForTests();
    assert.equal(events.length, 3, "bar-advance delta delivered over SSE");
    assert.equal(
      afterChurn.states - afterDisplay.states,
      0,
      "pure latestBarAt/status churn inside the heartbeat enqueues NO persist",
    );

    // 4) heartbeat boundary → bounded freshness write.
    emit(new Date("2026-06-09T15:05:00.000Z"), {
      latestBarAt: new Date("2026-06-09T15:05:00.000Z"),
    });
    const afterHeartbeat =
      __signalMonitorInternalsForTests.getSignalMonitorPersistScheduleStatsForTests();
    assert.equal(events.length, 4, "heartbeat delta delivered over SSE");
    assert.equal(
      afterHeartbeat.states - afterChurn.states,
      1,
      "5-minute freshness heartbeat enqueues a persist",
    );

    // 5) signal identity change → immediate persist, independent of heartbeat.
    emit(new Date("2026-06-09T15:05:30.000Z"), {
      currentSignalDirection: "sell",
      currentSignalAt: new Date("2026-06-09T15:05:00.000Z"),
      latestBarAt: new Date("2026-06-09T15:05:00.000Z"),
    });
    const afterIdentity =
      __signalMonitorInternalsForTests.getSignalMonitorPersistScheduleStatsForTests();
    assert.equal(events.length, 5, "identity-change delta delivered over SSE");
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

test("subscriber persist gating filters by the persist dirty-key, not the display signature", () => {
  const emitStart = serviceSource.indexOf(
    "export function emitSignalMonitorMatrixStreamAggregateDelta",
  );
  const emitEnd = serviceSource.indexOf("persistByProfile.forEach", emitStart);
  const emitBlock = serviceSource.slice(emitStart, emitEnd);
  const realSseStart = emitBlock.indexOf("const displayStates");
  const subscriberBlock = emitBlock.slice(realSseStart);
  // The real-subscriber persist set is filtered through the tight persist
  // dirty-key filter (same as the producer path), not the broad display signature.
  assert.match(
    subscriberBlock,
    /changedSignalMonitorMatrixStreamPersistStates\(\s*subscriber,\s*latchedStates,?\s*\)/,
  );
  // SSE delivery still uses the display-signature changed set.
  assert.match(subscriberBlock, /subscriber\.onEvent\(/);
});

test("server-owned producer bypasses stream signature and delta event work", () => {
  const emitStart = serviceSource.indexOf(
    "export function emitSignalMonitorMatrixStreamAggregateDelta",
  );
  const emitEnd = serviceSource.indexOf(
    "persistByProfile.forEach",
    emitStart,
  );
  assert.notEqual(emitStart, -1);
  assert.notEqual(emitEnd, -1);
  const emitBlock = serviceSource.slice(emitStart, emitEnd);
  const serverOwnedStart = emitBlock.indexOf("if (subscriber.serverOwnedProducer)");
  const realSseStart = emitBlock.indexOf("const displayStates", serverOwnedStart);
  assert.notEqual(serverOwnedStart, -1);
  assert.notEqual(realSseStart, -1);
  const serverOwnedBlock = emitBlock.slice(serverOwnedStart, realSseStart);

  assert.match(serverOwnedBlock, /changedSignalMonitorMatrixStreamPersistStates/);
  assert.match(serverOwnedBlock, /continue;/);
  assert.doesNotMatch(serverOwnedBlock, /changedSignalMonitorMatrixStreamStates/);
  assert.doesNotMatch(serverOwnedBlock, /buildSignalMonitorMatrixStreamDeltaEvent/);
  assert.doesNotMatch(serverOwnedBlock, /subscriber\.onEvent/);
  assert.doesNotMatch(serverOwnedBlock, /signalMonitorMatrixStreamStateSignature/);
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
      process.env["SIGNAL_MONITOR_BAR_EVALUATION_ENABLED"] =
        previousLegacyFlag;
    }
  }
}

type TimerHandle = {
  callback: () => void;
  delayMs: number;
  unref: () => void;
};

function withFakeMatrixStreamTimers<T>(run: (timers: {
  delays: number[];
  activeDelays: () => number[];
}) => T): T {
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
    await __signalMonitorInternalsForTests.resolveSignalMonitorMatrixStreamScope({
      environment: "shadow",
      timeframes: ["1m", "5m"],
      universe: "profile",
      resolveProfileUniverseSymbols: async () => ["tsla", "NVDA", "TSLA", " "],
    });

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
  assert.match(resolverBlock, /await getSignalMonitorStoredState/);
  assert.match(resolverBlock, /symbols: snapshot\.universeSymbols/);
});

test("signal matrix stream scope keeps explicit symbols ahead of profile universe", async () => {
  let resolvedProfile = false;
  const scope =
    await __signalMonitorInternalsForTests.resolveSignalMonitorMatrixStreamScope({
      environment: "shadow",
      symbols: ["aapl"],
      timeframes: ["1m"],
      universe: "profile",
      resolveProfileUniverseSymbols: async () => {
        resolvedProfile = true;
        return ["TSLA"];
      },
    });

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
      __signalMonitorInternalsForTests.evaluateSignalMonitorMatrixStreamScopeDelta({
        scope,
        profile: profile(),
        symbol: "AAPL",
        evaluatedAt,
        evaluateState(input) {
          calls.push(`${input.symbol}:${input.timeframe}`);
          return streamState(input.symbol, input.timeframe, "delta");
        },
      });

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
      __signalMonitorInternalsForTests.evaluateSignalMonitorMatrixStreamScopeDelta({
        scope,
        profile: profile(),
        symbol: "AAPL",
        evaluatedAt,
        evaluateState(input) {
          calls.push(`${input.symbol}:${input.timeframe}`);
          return streamState(input.symbol, input.timeframe, "delta");
        },
      });

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
      process.env["SIGNAL_MONITOR_BAR_EVALUATION_ENABLED"] =
        previousLegacyFlag;
    }
  }
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

    __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta({
      message: { symbol: "AAPL" },
      evaluatedAt,
      evaluateState(input) {
        return streamState(input.symbol, input.timeframe, "first");
      },
    });
    __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta({
      message: { symbol: "AAPL" },
      evaluatedAt,
      evaluateState(input) {
        return streamState(input.symbol, input.timeframe, "first");
      },
    });

    assert.equal(events.length, 1);
    assert.equal(events[0]?.event, "state-delta");
    assert.equal(events[0]?.states?.length, 1);

    subscription.unsubscribe();
    __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta({
      message: { symbol: "AAPL" },
      evaluatedAt,
      evaluateState(input) {
        return streamState(input.symbol, input.timeframe, "after-cleanup");
      },
    });
    assert.equal(events.length, 1);
    __signalMonitorInternalsForTests.resetSignalMonitorMatrixStreamForTests();
  });
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

    __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta({
      message: { symbol: "AAPL" },
      evaluatedAt,
      evaluateState(input) {
        return directionalStreamState(input.symbol, input.timeframe);
      },
    });
    assert.equal(events.length, 1);
    const first = events[0]?.states?.[0];
    assert.equal(first?.["currentSignalDirection"], "buy");
    assert.equal(first?.["actionEligible"], true);
    assert.equal(first?.["actionBlocker"], null);

    // A re-evaluation with no new signal must not erase the latched buy on
    // the wire; bar age advances from timestamps and the cell stops being
    // action-eligible by age.
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
          latestBarAt: new Date("2026-06-09T15:40:00.000Z"),
        });
      },
    });
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
    __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta({
      message: { symbol: "AAPL" },
      evaluatedAt,
      evaluateState(input) {
        return directionalStreamState(input.symbol, input.timeframe);
      },
    });
    assert.equal(events[0]?.states?.[0]?.["currentSignalDirection"], "buy");

    // An under-warmed stream recompute rediscovers an OLDER, opposite crossover
    // (sell @ 06-01). A genuine new signal only moves signalAt forward, so this
    // is a regression and must NOT overwrite the newer latched buy (the STA
    // freeze / bad-sort / weeks-old-survives-refresh bug). Bar metadata still
    // advances so the cell is not frozen.
    __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta({
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
    });
    const regressed = events.at(-1)?.states?.[0];
    assert.equal(regressed?.["currentSignalDirection"], "buy");
    assert.equal(
      (regressed?.["currentSignalAt"] as Date).toISOString(),
      "2026-06-09T14:55:00.000Z",
    );

    // A genuinely NEWER crossover (sell @ 15:05) is a real flip and MUST win.
    __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta({
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
    });
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

    __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta({
      message: { symbol: "AAPL" },
      evaluatedAt,
      evaluateState(input) {
        return directionalStreamState(input.symbol, input.timeframe, {
          status: "stale",
          fresh: false,
        });
      },
    });
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
    __signalMonitorInternalsForTests.buildSignalMonitorServerOwnedProducerScope({
      environment: "shadow",
      symbols: ["aapl", "AAPL", " msft ", ""],
      timeframes: ["1m", "5m"],
    });

  assert.deepEqual(scope.symbols, ["AAPL", "MSFT"]);
  assert.equal(scope.exactCells, false);
  assert.deepEqual(scope.timeframes, ["1m", "5m"]);
  assert.equal(scope.requestedSymbolCount, 2);
});

test("producer backfill selects all cold cells and only caps warmed refreshes", () => {
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
      maxCells: 2,
    });

  assert.equal(withCold.length, 4);
  assert.deepEqual(
    new Set(withCold.map((cell) => cell.symbol)),
    new Set(["AAPL", "MSFT", "NVDA", "SPY"]),
  );

  const warmedOnly =
    __signalMonitorInternalsForTests.selectSignalMonitorBackfillDueCells({
      candidates: warmCandidates,
      nowMs,
      maxCells: 2,
    });

  assert.equal(warmedOnly.length, 2);
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
    __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta({
      message: { symbol: "AAPL" },
      evaluatedAt,
      evaluateState(input) {
        evalCalls.push(`${input.symbol}:${input.timeframe}`);
        return streamState(input.symbol, input.timeframe, "server-owned");
      },
    });

    // The producer evaluated the universe symbol despite zero UI subscribers,
    // and only for the tick's symbol (keystone gap fixed).
    assert.deepEqual(evalCalls, ["AAPL:1m"]);
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
    __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta({
      message: { symbol: "AAPL" },
      evaluatedAt,
      evaluateState(input) {
        waitForBarCloseValues.push(
          (input.profile.pyrusSignalsSettings as Record<string, unknown>)
            .waitForBarClose,
        );
        return streamState(input.symbol, input.timeframe, "server-owned");
      },
    });

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
    __signalMonitorInternalsForTests.buildSignalMonitorServerOwnedProducerScope({
      environment: "shadow",
      symbols: ["AAPL"],
      timeframes: ["1m"],
    });

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
    __signalMonitorInternalsForTests.emitSignalMonitorMatrixStreamAggregateDelta({
      message: { symbol: "AAPL" },
      evaluatedAt,
      evaluateState(input) {
        evalCalls.push(`${input.symbol}:${input.timeframe}`);
        return streamState(input.symbol, input.timeframe, "noop");
      },
    });

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
            id: "profile-test:SPY:5m",
            profileId: "profile-test",
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
            lastError: "No signal monitor state is available for this symbol/timeframe.",
          },
          {
            id: "profile-test:IPAY:5m",
            profileId: "profile-test",
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
    event.states.map((state) => `${state.symbol}:${state.timeframe}:${state.status}`),
    ["INN:5m:unavailable", "IPAY:5m:ok"],
  );
  assert.equal(event.coverage.stateCount, 2);
  assert.equal(event.states[0]?.actionEligible, false);
  assert.equal(event.states[0]?.actionBlocker, "no_signal");
});
