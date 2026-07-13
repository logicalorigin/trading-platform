import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  algoDeploymentsTable,
  algoStrategiesTable,
  executionEventsTable,
  signalMonitorSymbolStatesTable,
  type AlgoDeployment,
  type ExecutionEvent,
} from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";
import { sql } from "drizzle-orm";
import {
  __signalOptionsAutomationInternalsForTests,
  evaluateMtfPatternGate,
  invalidateSignalOptionsDashboardCaches,
  runSignalOptionsShadowBackfill,
  selectSignalOptionsExpiration,
  SIGNAL_OPTIONS_EXIT_EVENT,
  SIGNAL_OPTIONS_SKIPPED_EVENT,
  type SignalOptionsPosition,
} from "./signal-options-automation";
import { __signalQualityKpisInternalsForTests } from "./signal-quality-kpis";
import { __signalMonitorInternalsForTests } from "./signal-monitor";

// Pin trading-day semantics: snapshot blocker assertions must not flip to
// market_closed when the suite runs on a holiday/weekend.
__signalMonitorInternalsForTests.setSignalMonitorQuietMarketSessionNowForTests(
  false,
);

test("Signal Options signal shaping single-flights, reuses for 5s, and invalidates with dashboard caches", async () => {
  const {
    getSignalOptionsSignalSnapshotCacheTtlMsForTests,
    withSignalOptionsSignalSnapshotsCacheForTests,
  } = __signalOptionsAutomationInternalsForTests;
  const deploymentId = "00000000-0000-4000-8000-000000000005";
  const options = { includeEventMetadata: true };
  let loads = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const load = async () => {
    loads += 1;
    await gate;
    return [];
  };

  invalidateSignalOptionsDashboardCaches();
  const first = withSignalOptionsSignalSnapshotsCacheForTests({
    deploymentId,
    options,
    nowMs: 1_000,
    load,
  });
  const joined = withSignalOptionsSignalSnapshotsCacheForTests({
    deploymentId,
    options,
    nowMs: 1_001,
    load,
  });
  await Promise.resolve();
  assert.equal(loads, 1, "concurrent shaping joins one read");
  release();
  assert.equal(await joined, await first);

  const reused = await withSignalOptionsSignalSnapshotsCacheForTests({
    deploymentId,
    options,
    nowMs: 5_999,
    load: async () => {
      loads += 1;
      return [];
    },
  });
  assert.equal(reused, await first);
  assert.equal(loads, 1, "fresh shaping is reused for the full visible window");
  assert.equal(getSignalOptionsSignalSnapshotCacheTtlMsForTests(), 5_000);

  await withSignalOptionsSignalSnapshotsCacheForTests({
    deploymentId,
    options,
    nowMs: 6_000,
    load: async () => {
      loads += 1;
      return [];
    },
  });
  assert.equal(loads, 2, "the 5s boundary forces fresh shaping");

  invalidateSignalOptionsDashboardCaches(deploymentId);
  await withSignalOptionsSignalSnapshotsCacheForTests({
    deploymentId,
    options,
    nowMs: 6_001,
    load: async () => {
      loads += 1;
      return [];
    },
  });
  assert.equal(loads, 3, "dashboard invalidation clears signal shaping");
  invalidateSignalOptionsDashboardCaches();
});

test("Signal Options signal shaping sweeps expired dormant deployment entries", async () => {
  const {
    getSignalOptionsSignalSnapshotCacheSizeForTests,
    withSignalOptionsSignalSnapshotsCacheForTests,
  } = __signalOptionsAutomationInternalsForTests;
  const options = { includeEventMetadata: true };

  invalidateSignalOptionsDashboardCaches();
  await withSignalOptionsSignalSnapshotsCacheForTests({
    deploymentId: "00000000-0000-4000-8000-000000000006",
    options,
    nowMs: 1_000,
    load: async () => [],
  });
  assert.equal(getSignalOptionsSignalSnapshotCacheSizeForTests(), 1);

  await withSignalOptionsSignalSnapshotsCacheForTests({
    deploymentId: "00000000-0000-4000-8000-000000000007",
    options,
    nowMs: 6_000,
    load: async () => [],
  });
  assert.equal(
    getSignalOptionsSignalSnapshotCacheSizeForTests(),
    1,
    "reading another deployment removes the expired dormant entry",
  );
  invalidateSignalOptionsDashboardCaches();
});

test("action-bearing Signal Options scans require the scoped direct stored-state read", () => {
  const { shouldUseScopedSignalOptionsStoredState } =
    __signalOptionsAutomationInternalsForTests;

  assert.equal(
    shouldUseScopedSignalOptionsStoredState({
      source: "manual",
      preferStoredMonitorState: false,
      requireDecisionFreshState: true,
    }),
    true,
  );
  assert.equal(
    shouldUseScopedSignalOptionsStoredState({
      source: "manual",
      preferStoredMonitorState: true,
      requireDecisionFreshState: true,
    }),
    true,
  );
  assert.equal(
    shouldUseScopedSignalOptionsStoredState({
      source: "manual",
      preferStoredMonitorState: true,
      requireDecisionFreshState: false,
    }),
    false,
  );
  assert.equal(
    shouldUseScopedSignalOptionsStoredState({
      source: "worker",
      preferStoredMonitorState: true,
      requireDecisionFreshState: false,
    }),
    true,
    "the existing worker direct-read policy is preserved",
  );

  const source = readFileSync(
    new URL("./signal-options-automation.ts", import.meta.url),
    "utf8",
  );
  const runStart = source.indexOf(
    "async function runSignalOptionsShadowScanUnlocked",
  );
  const runEnd = source.indexOf("\n  const signalScanCompletedAt", runStart);
  assert.ok(runStart >= 0 && runEnd > runStart);
  assert.match(
    source.slice(runStart, runEnd),
    /loadSignalOptionsMonitorState\(\{[\s\S]*requireDecisionFreshState:\s*input\.skipActionWork !== true/,
  );

  const routeSource = readFileSync(
    new URL("../routes/automation.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    routeSource,
    /runSignalOptionsShadowScan\(\{[\s\S]*skipActionWork:\s*runActions !== true/,
    "the manual route maps runActions=true to an action-bearing scan",
  );
});

test("resolveSameScanEntryAction: a symbol opened earlier this scan defers (no duplicate entry); block/flip/proceed preserved", () => {
  const { resolveSameScanEntryAction } = __signalOptionsAutomationInternalsForTests;
  const pos = (direction: "buy" | "sell") =>
    ({ symbol: "AAPL", direction }) as unknown as SignalOptionsPosition;
  const call = (o: {
    candidateDirection: "buy" | "sell";
    currentPosition: SignalOptionsPosition | undefined;
    openedThisScan: ReadonlySet<string>;
    sameDirectionBlockEnabled?: boolean;
    flipOnOppositeSignal?: boolean;
    oppositeFlipBlockEnabled?: boolean;
  }) =>
    resolveSameScanEntryAction({
      symbol: "AAPL",
      sameDirectionBlockEnabled: true,
      flipOnOppositeSignal: false,
      oppositeFlipBlockEnabled: true,
      ...o,
    }).kind;

  const empty = new Set<string>();
  // THE FIX: a symbol already opened earlier this scan defers, even though the
  // snapshot still shows no position for it (that is exactly the stale-snapshot
  // double-entry the loop used to allow)...
  assert.equal(
    call({ candidateDirection: "buy", currentPosition: undefined, openedThisScan: new Set(["AAPL"]) }),
    "defer_opened_this_scan",
  );
  // ...and defer wins even if a same-direction snapshot position exists.
  assert.equal(
    call({ candidateDirection: "buy", currentPosition: pos("buy"), openedThisScan: new Set(["AAPL"]) }),
    "defer_opened_this_scan",
  );
  // Regression guard — existing branches unchanged when nothing opened this scan:
  assert.equal(call({ candidateDirection: "buy", currentPosition: pos("buy"), openedThisScan: empty }), "block_same_direction");
  assert.equal(call({ candidateDirection: "buy", currentPosition: pos("buy"), openedThisScan: empty, sameDirectionBlockEnabled: false }), "proceed");
  assert.equal(call({ candidateDirection: "sell", currentPosition: pos("buy"), openedThisScan: empty }), "flip_disabled");
  assert.equal(call({ candidateDirection: "sell", currentPosition: pos("buy"), openedThisScan: empty, flipOnOppositeSignal: true }), "flip");
  assert.equal(call({ candidateDirection: "sell", currentPosition: pos("buy"), openedThisScan: empty, oppositeFlipBlockEnabled: false }), "flip");
  assert.equal(call({ candidateDirection: "buy", currentPosition: undefined, openedThisScan: empty }), "proceed");
});

test("evaluateMtfPatternGate requires an EXACT per-timeframe match (divergence-aware)", () => {
  type Pat = Record<string, "buy" | "sell" | "any">;
  type Live = Record<string, "buy" | "sell" | null>;
  const confluence: Pat = { "1m": "buy", "5m": "buy", "15m": "buy" };
  const divergence: Pat = { "1m": "sell", "2m": "sell", "5m": "sell", "15m": "buy" };

  // Full match (confluence) -> ok.
  assert.equal(
    evaluateMtfPatternGate(confluence, {
      "1m": "buy",
      "5m": "buy",
      "15m": "buy",
    } as Live),
    "ok",
  );
  // The divergence setup present exactly -> ok (this is the whole point).
  assert.equal(
    evaluateMtfPatternGate(divergence, {
      "1m": "sell",
      "2m": "sell",
      "5m": "sell",
      "15m": "buy",
    } as Live),
    "ok",
  );
  // One timeframe disagrees -> mismatch (an N-agree confluence gate would have
  // wrongly allowed this 3-of-4).
  assert.equal(
    evaluateMtfPatternGate(divergence, {
      "1m": "buy",
      "2m": "sell",
      "5m": "sell",
      "15m": "buy",
    } as Live),
    "mismatch",
  );
  // A required timeframe has no live signal -> unavailable (don't fire blind).
  assert.equal(
    evaluateMtfPatternGate(divergence, {
      "1m": "sell",
      "2m": "sell",
      "5m": "sell",
      "15m": null,
    } as Live),
    "unavailable",
  );
  // "any" entries are unconstrained; empty pattern imposes no constraint.
  assert.equal(
    evaluateMtfPatternGate({ "1m": "any", "5m": "buy" }, {
      "1m": "sell",
      "5m": "buy",
    } as Live),
    "ok",
  );
  assert.equal(evaluateMtfPatternGate({}, { "1m": "sell" } as Live), "ok");
});

test("classifySignalOptionsEntryQuality uses calibrated expected-move-v2 directional features before setup quality", () => {
  const { classifySignalOptionsEntryQuality } =
    __signalOptionsAutomationInternalsForTests;
  const directionalFeatures = {
    rangePosition20: 0.95,
    mtfAlignment: 3,
    adxComponent: 2,
    volatilityComponent: -0.2,
    shortMomentumPct: 4,
    riskAdjustedMomentum: 3,
    atrPct: 0.9,
    volumeRatio20: 1.8,
  };

  const quality = classifySignalOptionsEntryQuality({
    candidate: {
      direction: "buy",
      signal: {
        filterState: {
          mtfDirections: [1, 1, 1],
          adx: 30,
          directionalFeatures,
        },
      },
      quote: { spreadPctOfMid: 10 },
    },
    orderPlan: { premiumAtRisk: 100 },
  } as never);
  const calibratedScore =
    __signalQualityKpisInternalsForTests.scoreSignalWithModel(
      {
        symbol: "CAL",
        direction: "long",
        directionalFeatures,
        realizedReturnPercent: 0,
        mfePercent: 0,
        maePercent: 0,
      },
      "expected-move-v2",
    );

  // The classifier score must not drift from the KPI-calibration scorer.
  assert.equal(quality.score, calibratedScore);
  // Hand-computed: atr=max(0.9,0.02)=0.9, vr=max(1.8,0.25)=1.8.
  // volatilityRegime=5*clamp(log2(1.5),-2,3.5)=2.9, volumeParticipation=
  // 3*clamp(log2(1.8),-2,7)=2.5, momentum=0.6*3+0.5*(4/0.9)=4.0,
  // reversionTilt=4*(0.5-0.95)=-1.8 -> raw=42+2.9+2.5+4.0-1.8=49.7.
  // volumeRatio20=1.8 is below the vspike (>=10) conviction threshold, so
  // conviction=0 and the v2 score is unchanged from v1's raw output.
  assert.equal(quality.score, 49.7);
  assert.equal(quality.raw?.modelVersion, "expected-move-v2");
  assert.equal(quality.components?.reversionTilt, -1.8);
  assert.equal(quality.components?.conviction, 0);
  assert.ok(quality.reasons.includes("expected_move_v2"));
  assert.ok(quality.reasons.includes("extension_risk"));
});

test("classifySignalOptionsEntryQuality keeps setup-quality fallback without directional features", () => {
  const { classifySignalOptionsEntryQuality } =
    __signalOptionsAutomationInternalsForTests;

  const quality = classifySignalOptionsEntryQuality({
    candidate: {
      direction: "buy",
      signal: { filterState: { mtfDirections: [1, 1, 1], adx: 30 } },
      quote: { spreadPctOfMid: 10 },
    },
    orderPlan: { premiumAtRisk: 100 },
  } as never);

  assert.equal(quality.score, 100);
  assert.equal(quality.tier, "high");
  assert.equal(quality.components?.mtfAlignment, 35.7);
  assert.equal(quality.raw?.modelVersion, undefined);
});

const signalState = (
  symbol: string,
  signalAt: string,
  direction: "buy" | "sell" = "buy",
) =>
  ({
    id: `${symbol}:5m`,
    profileId: "paper-profile",
    symbol,
    timeframe: "5m",
    currentSignalDirection: direction,
    currentSignalAt: signalAt,
    currentSignalPrice: 100,
    latestBarAt: signalAt,
    barsSinceSignal: 0,
    fresh: true,
    status: "ok",
    active: true,
    lastEvaluatedAt: signalAt,
    lastError: null,
	  }) as never;

const source = readFileSync(
  new URL("./signal-options-automation.ts", import.meta.url),
  "utf8",
);

test("Signal Options does not evaluate Signal Matrix directly", () => {
  assert.doesNotMatch(source, /evaluateSignalMonitorMatrix/);
  assert.doesNotMatch(source, /loadSignalOptionsMtfMatrixBySymbol/);
  assert.doesNotMatch(source, /enrichSignalOptionsCandidateWithMatrixMtf/);
});

test("active-position quote metadata persistence runs only in a live option session", () => {
  const start = source.indexOf("async function refreshActivePosition");
  const end = source.indexOf(
    "export async function manageSignalOptionsActivePositionQuote",
    start,
  );
  assert.notEqual(start, -1, "missing active-position refresh function");
  assert.notEqual(end, -1, "missing active-position refresh boundary");
  const body = source.slice(start, end);

  assert.match(
    body,
    /const liveOptionSession =\s*isLiveOptionTradingSession\(now, contract\);/,
  );
  assert.match(
    body,
    /if \(liveOptionSession\) \{\s*await persistSignalOptionsQuoteSnapshot\(/,
  );
  assert.match(
    body,
    /if \(\(exitReason \|\| scaleOutExit\) && liveOptionSession\)/,
  );
});

test("Signal Options default state endpoint bypasses cached fast-summary state", () => {
  const stateFunctionStart = source.indexOf(
    "export async function listSignalOptionsAutomationState",
  );
  const cockpitFunctionStart = source.indexOf(
    "async function buildAlgoDeploymentCockpitPayload",
  );
  assert.notEqual(stateFunctionStart, -1);
  assert.notEqual(cockpitFunctionStart, -1);
  const stateFunction = source.slice(stateFunctionStart, cockpitFunctionStart);

  assert.doesNotMatch(
    stateFunction,
    /return buildSignalOptionsFastSummaryState\(input\)/,
  );
  assert.match(stateFunction, /getSignalOptionsDashboardSnapshot\(\{\s*\.\.\.input,/);
  assert.match(stateFunction, /withFreshSignalOptionsStateSignals\(snapshot, input\)/);
});

test("Signal Options default cockpit summary bypasses cached fast-summary state", () => {
  const cockpitFunctionStart = source.indexOf(
    "async function buildAlgoDeploymentCockpitPayload",
  );
  const cockpitExportStart = source.indexOf(
    "export async function getAlgoDeploymentCockpit",
  );
  assert.notEqual(cockpitFunctionStart, -1);
  assert.notEqual(cockpitExportStart, -1);
  const cockpitFunction = source.slice(cockpitFunctionStart, cockpitExportStart);

  assert.doesNotMatch(
    cockpitFunction,
    /buildSignalOptionsFastSummarySnapshot/,
  );
  assert.match(cockpitFunction, /getSignalOptionsDashboardSnapshot\(\{\s*deploymentId: input\.deploymentId,/);
  assert.match(cockpitFunction, /withFreshSignalOptionsStateSignals\(snapshot, \{/);
});

test("Signal Options performance ignores pressure and only serves fresh cached data", () => {
  const start = source.indexOf("export async function getSignalOptionsPerformance");
  const end = source.indexOf("\nfunction formatEnumReason", start + 1);
  assert.notEqual(start, -1, "Missing Signal Options performance function");
  assert.notEqual(end, -1, "Missing function boundary after performance function");
  const body = source.slice(start, end);
  assert.match(
    body,
    /readSignalOptionsCachedPayload\(\s*signalOptionsPerformanceCache,\s*input\.deploymentId,\s*\);/,
    "normal and cache-only reads must reject stale performance payloads",
  );
  assert.match(
    body,
    /if \(cacheMode === "cache-only"\) \{\s*throw new HttpError\(503,/,
    "a cache-only miss must be an explicit error, not fabricated zero performance",
  );
  assert.match(body, /return startSignalOptionsPerformanceRefresh\(\{/);
  assert.doesNotMatch(body, /shouldServeSignalOptionsPerformancePressureFallback/);
  assert.doesNotMatch(body, /buildSignalOptionsPerformancePressureFallback/);
  assert.doesNotMatch(body, /buildSignalOptionsPerformanceColdPressureFallback/);
  assert.doesNotMatch(source, /function buildSignalOptionsPerformanceFallbackFromSnapshot/);
  assert.doesNotMatch(source, /function buildSignalOptionsPerformanceColdPressureFallback/);
  assert.doesNotMatch(source, /allowStale/);
  assert.doesNotMatch(source, /staleExpiresAt/);
});

test("Signal Options state and cockpit never fabricate or serve stale cache fallbacks", () => {
  const fullStart = source.indexOf(
    "async function getSignalOptionsFullDashboardSnapshot",
  );
  const summaryStart = source.indexOf(
    "async function getSignalOptionsSummaryDashboardSnapshot",
  );
  const dashboardStart = source.indexOf(
    "async function getSignalOptionsDashboardSnapshot",
  );
  const refreshStart = source.indexOf(
    "async function withFreshSignalOptionsStateSignals",
  );
  const stateStart = source.indexOf(
    "export async function listSignalOptionsAutomationState",
  );
  const cockpitStart = source.indexOf(
    "export async function getAlgoDeploymentCockpit",
  );
  const pnlStart = source.indexOf(
    "export type SignalOptionsTodayPnl",
    cockpitStart,
  );
  assert.ok([fullStart, summaryStart, dashboardStart, refreshStart, stateStart, cockpitStart, pnlStart].every((index) => index >= 0));

  const fullBody = source.slice(fullStart, summaryStart);
  const summaryBody = source.slice(summaryStart, dashboardStart);
  const refreshBody = source.slice(refreshStart, stateStart);
  const cockpitBody = source.slice(cockpitStart, pnlStart);

  assert.match(fullBody, /signal_options_dashboard_cache_unavailable/);
  assert.match(summaryBody, /signal_options_summary_cache_unavailable/);
  assert.match(cockpitBody, /signal_options_cockpit_cache_unavailable/);
  assert.doesNotMatch(source, /buildSignalOptionsColdDashboardSnapshot/);
  assert.doesNotMatch(source, /cold_cache_only_fallback/);
  assert.doesNotMatch(source, /cacheStatus:\s*"stale"/);
  assert.doesNotMatch(source, /allowStale/);
  assert.doesNotMatch(source, /staleExpiresAt/);
  assert.match(refreshBody, /catch \(error\) \{[\s\S]*?throw error;\s*\}/);
  assert.doesNotMatch(
    refreshBody,
    /catch \(error\) \{[\s\S]*?return snapshot\.state;/,
  );
});

test("Signal Options performance refresh avoids full dashboard hydration", () => {
  const start = source.indexOf("function startSignalOptionsPerformanceRefresh");
  const end = source.indexOf("\nexport async function getSignalOptionsPerformance", start);
  assert.notEqual(start, -1, "Missing Signal Options performance refresh helper");
  assert.notEqual(end, -1, "Missing performance refresh helper boundary");
  const body = source.slice(start, end);

  assert.match(body, /listDeploymentEvents\(\s*deployment\.id,\s*SIGNAL_OPTIONS_STATE_EVENT_LIMIT,/);
  assert.match(body, /buildStatePayload\(\{\s*deployment,\s*profile,\s*events,\s*view:\s*"summary",/);
  assert.doesNotMatch(body, /view:\s*"full"/);
  assert.doesNotMatch(body, /getSignalOptionsDashboardSnapshot/);
});

test("Signal Options worker signal_refresh uses the deployment-scoped stored-state reader", async () => {
  const fastReaderStart = source.indexOf(
    "async function listSignalOptionsStoredSignalStatesFast",
  );
  const fastReaderEnd = source.indexOf(
    "\nfunction resolveSignalOptionsMonitorFullRefresh",
    fastReaderStart,
  );
  assert.notEqual(fastReaderStart, -1, "Missing fast stored-state reader");
  assert.notEqual(fastReaderEnd, -1, "Missing fast reader boundary");
  const fastReader = source.slice(fastReaderStart, fastReaderEnd);
  assert.match(
    fastReader,
    /inArray\(signalMonitorSymbolStatesTable\.symbol, universeSymbols\)/,
    "fast reader must scope signal states to the deployment universe",
  );
  assert.match(fastReader, /\.limit\(500\)/, "fast reader must keep the row cap");

  await withTestDb(async ({ db }) => {
    let symbolStateSelects = 0;
    let symbolStateLimit: unknown = null;
    const realSelect = db.select.bind(db);
    (db as unknown as { select: (...args: unknown[]) => unknown }).select = (
      ...args: unknown[]
    ) => {
      const builder = realSelect(...(args as [])) as {
        from: (...fromArgs: unknown[]) => unknown;
      };
      const realFrom = builder.from.bind(builder);
      builder.from = (...fromArgs: unknown[]) => {
        const query = realFrom(...fromArgs) as {
          limit?: (...limitArgs: unknown[]) => unknown;
        };
        if (fromArgs[0] === signalMonitorSymbolStatesTable) {
          symbolStateSelects += 1;
          if (typeof query.limit === "function") {
            const realLimit = query.limit.bind(query);
            query.limit = (...limitArgs: unknown[]) => {
              symbolStateLimit = limitArgs[0];
              return realLimit(...limitArgs);
            };
          }
        }
        return query;
      };
      return builder;
    };

    const profileId = "00000000-0000-4000-8000-000000000909";
    const evaluatedAt = new Date();
    const latestBarAt = new Date(evaluatedAt.getTime() - 5 * 60_000);
    const deployment = {
      id: "00000000-0000-4000-8000-000000000919",
      name: "Scoped Signal Options Worker",
      enabled: true,
      mode: "shadow",
      providerAccountId: "shadow",
      symbolUniverse: ["AAPL"],
      config: { signalOptions: {} },
      updatedAt: evaluatedAt,
    } as unknown as AlgoDeployment;

    await db.execute(sql`
      INSERT INTO signal_monitor_profiles
        (id, environment, enabled, timeframe, pyrus_signals_settings, fresh_window_bars, last_evaluated_at)
      VALUES
        (${profileId}, 'shadow', true, '5m', ${JSON.stringify({ alpha: "kept" })}::jsonb, 3, ${evaluatedAt.toISOString()}::timestamptz)
    `);
    await db.execute(sql`
      INSERT INTO signal_monitor_symbol_states
        (id, profile_id, symbol, timeframe, current_signal_direction, current_signal_at, current_signal_price,
         latest_bar_at, bars_since_signal, fresh, status, active, last_evaluated_at)
      VALUES
        ('00000000-0000-4000-8000-000000000910', ${profileId}, 'AAPL', '5m', 'buy',
         ${latestBarAt.toISOString()}::timestamptz, 187.12, ${latestBarAt.toISOString()}::timestamptz,
         0, true, 'ok', true, ${evaluatedAt.toISOString()}::timestamptz),
        ('00000000-0000-4000-8000-000000000911', ${profileId}, 'MSFT', '5m', 'sell',
         ${latestBarAt.toISOString()}::timestamptz, 412.34, ${latestBarAt.toISOString()}::timestamptz,
         0, true, 'ok', true, ${evaluatedAt.toISOString()}::timestamptz)
    `);

    const universe = new Set(["AAPL"]);
    const result =
      await __signalOptionsAutomationInternalsForTests.loadSignalOptionsMonitorState({
        deployment,
        universe,
        preferStoredMonitorState: true,
        source: "worker",
      });
    const states = result.states as Record<string, unknown>[];
    const state = states[0] ?? {};
    const profile = result.profile as Record<string, unknown>;

    assert.equal(symbolStateSelects, 1);
    assert.equal(symbolStateLimit, 500);
    assert.deepEqual(
      states.map((entry) => entry["symbol"]),
      ["AAPL"],
      "worker refresh must not return out-of-deployment stored states",
    );
    assert.equal(state["profileId"], profileId);
    assert.equal(state["currentSignalDirection"], "buy");
    assert.equal(state["currentSignalPrice"], 187.12);
    assert.equal(state["barsSinceSignal"], 0);
    assert.equal(state["fresh"], true);
    assert.equal(state["status"], "ok");
    assert.ok(state["currentSignalAt"], "currentSignalAt is needed for signal keys");
    assert.ok(state["latestBarAt"], "latestBarAt is needed for worker summaries");
    assert.ok(
      state["lastEvaluatedAt"],
      "lastEvaluatedAt is needed for refresh currentness checks",
    );
    assert.equal(profile["timeframe"], "5m");
    assert.equal(profile["freshWindowBars"], 3);
    assert.equal(
      (profile["pyrusSignalsSettings"] as Record<string, unknown>)["alpha"],
      "kept",
    );

    const summary =
      __signalOptionsAutomationInternalsForTests.buildWorkerScanSummary({
        states: states as never,
        universe,
        candidateCount: 0,
        blockedCandidateCount: 0,
        activeScanPhase: "signal_refresh",
      });
    assert.equal(summary.signalCount, 1);
    assert.equal(summary.freshSignalCount, 1);
    assert.equal(summary.latestSignalBarAt, latestBarAt.toISOString());

    const ordered =
      __signalOptionsAutomationInternalsForTests.orderSignalOptionsActionStates({
        states: states as never,
        universe,
        timeframe: profile["timeframe"] as never,
      });
    const signalAt =
      state["currentSignalAt"] instanceof Date
        ? state["currentSignalAt"].toISOString()
        : String(state["currentSignalAt"]);
    const candidate =
      __signalOptionsAutomationInternalsForTests.buildCandidateFromSignal({
        deployment,
        state: ordered[0] as never,
        signalAt,
        freshWindowBars: profile["freshWindowBars"] as number,
      });
    assert.equal(candidate.symbol, "AAPL");
    assert.ok(candidate.signal);
    assert.equal(candidate.signal.latestBarAt, latestBarAt.toISOString());
    assert.equal(candidate.signal.freshWindowBars, 3);
  });
});

test("Signal Options backfill requires explicit bar-evaluation opt-in", async () => {
  const previousPyrusFlag =
    process.env["PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED"];
  const previousLegacyFlag =
    process.env["SIGNAL_MONITOR_BAR_EVALUATION_ENABLED"];
  delete process.env["PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED"];
  delete process.env["SIGNAL_MONITOR_BAR_EVALUATION_ENABLED"];
  try {
    await assert.rejects(
      () =>
        runSignalOptionsShadowBackfill({
          deploymentId: "deployment-test",
          start: "2026-06-08",
          end: "2026-06-08",
        }),
      (error) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code ===
          "signal_options_backfill_requires_bar_evaluation_opt_in",
    );
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

test("Signal Options cockpit treats after-hours execution gate as info", () => {
  const items = __signalOptionsAutomationInternalsForTests.buildCockpitAttention({
    deployment: {
      lastError: null,
      lastEvaluatedAt: null,
      updatedAt: new Date("2026-06-09T00:00:00.000Z"),
    },
    readiness: {
      ready: false,
      reason: "market_session_quiet",
      message: "Options strategy execution is outside the regular options session.",
      diagnostics: {},
    },
    candidates: [],
    activePositions: [],
    risk: {},
    events: [],
  } as never);

  assert.equal(items.length, 1);
  assert.equal(items[0].id, "gateway-readiness");
  assert.equal(items[0].severity, "info");
  assert.equal(items[0].summary, "Options session is closed.");
});

test("Signal Options cockpit keeps real gateway failures as warnings", () => {
  const items = __signalOptionsAutomationInternalsForTests.buildCockpitAttention({
    deployment: {
      lastError: null,
      lastEvaluatedAt: null,
      updatedAt: new Date("2026-06-09T00:00:00.000Z"),
    },
    readiness: {
      ready: false,
      reason: "gateway_login_required",
      message: "IBKR Client Portal is connected, but the broker session is not authenticated.",
      diagnostics: {},
    },
    candidates: [],
    activePositions: [],
    risk: {},
    events: [],
  } as never);

  assert.equal(items.length, 1);
  assert.equal(items[0].id, "gateway-readiness");
  assert.equal(items[0].severity, "warning");
});

test("Signal Options position_marking rule composes detail from only nonzero clauses", () => {
  const { buildRuleAdherence } = __signalOptionsAutomationInternalsForTests;
  const profile = {
    riskHaltControls: { dailyLossHaltEnabled: false },
    riskCaps: { maxPremiumPerEntry: 1000, maxContracts: 10, maxDailyLoss: 5000, maxOpenSymbols: 10 },
    optionSelection: { allowZeroDte: false, minDte: 0, maxDte: 60 },
  } as never;

  // All zero counts: should pass with no detail about marking.
  const allZero = buildRuleAdherence({
    profile,
    activePositions: [],
    risk: {},
    events: [],
  });
  const allZeroRule = allZero.find((r) => r.id === "position_marking");
  assert.equal(allZeroRule?.status, "pass");
  assert.equal(allZeroRule?.detail, "Open positions have marks for current exposure.");

  // One nonzero count (unmarkedPositions): should contain only that clause.
  const oneNonzero = buildRuleAdherence({
    profile,
    activePositions: [{ lastMarkPrice: undefined }, { lastMarkPrice: undefined }] as never[],
    risk: {},
    events: [],
  });
  const oneNonzeroRule = oneNonzero.find((r) => r.id === "position_marking");
  assert.equal(oneNonzeroRule?.status, "warning");
  assert.equal(oneNonzeroRule?.detail, "2 open positions lack marks.");

  // Two nonzero counts: should contain only those two clauses, semicolon-separated.
  const twoNonzero = buildRuleAdherence({
    profile,
    activePositions: [{ lastMarkPrice: undefined }] as never[],
    risk: {},
    events: [
      { eventType: "signal_options_candidate_skipped", payload: { reason: "position_mark_unavailable" } },
      { eventType: "signal_options_candidate_skipped", payload: { reason: "position_mark_unavailable" } },
      { eventType: "signal_options_candidate_skipped", payload: { reason: "position_mark_unavailable" } },
    ] as never[],
  });
  const twoNonzeroRule = twoNonzero.find((r) => r.id === "position_marking");
  assert.equal(twoNonzeroRule?.status, "warning");
  assert.equal(twoNonzeroRule?.detail, "1 open positions lack marks; 3 mark events reported quote issues.");
});

test("Signal Options gateway blocker: shadow deployments bypass broker readiness but keep the RTH gate", () => {
  const { signalOptionsGatewayExecutionBlocker } =
    __signalOptionsAutomationInternalsForTests;
  const profile = {
    infrastructureHaltControls: { gatewayReadinessBlockEnabled: true },
  } as never;
  const readiness = (reason: string | null) =>
    ({
      ready: reason === null,
      reason,
      message: "",
      diagnostics: {},
    }) as never;

  // Shadow + broker-not-configured -> NOT blocked (shadow fills never touch IBKR).
  assert.equal(
    signalOptionsGatewayExecutionBlocker(
      readiness("ibkr_not_configured"),
      profile,
      { isShadow: true },
    ),
    null,
  );
  // Shadow + outside RTH -> STILL blocked (time-based session gate is preserved).
  assert.equal(
    signalOptionsGatewayExecutionBlocker(
      readiness("market_session_quiet"),
      profile,
      { isShadow: true },
    )?.reason,
    "market_session_quiet",
  );
  // Live (non-shadow) + broker-not-configured -> blocked, unchanged behavior.
  assert.equal(
    signalOptionsGatewayExecutionBlocker(
      readiness("ibkr_not_configured"),
      profile,
      { isShadow: false },
    )?.reason,
    "ibkr_not_configured",
  );
  // Explicit operator override still wins for any deployment.
  assert.equal(
    signalOptionsGatewayExecutionBlocker(
      readiness("ibkr_not_configured"),
      {
        infrastructureHaltControls: { gatewayReadinessBlockEnabled: false },
      } as never,
      { isShadow: false },
    ),
    null,
  );
});

test("Signal Options action states stay on configured execution timeframe", () => {
  const states = [
    {
      ...(signalState("SPY", "2026-06-08T18:31:00.000Z") as Record<
        string,
        unknown
      >),
      id: "SPY:2m",
      timeframe: "2m",
      barsSinceSignal: 1,
    },
    {
      ...(signalState(
        "SPY",
        "2026-06-08T16:35:00.000Z",
        "sell",
      ) as Record<string, unknown>),
      barsSinceSignal: 25,
    },
    {
      ...(signalState("AAPL", "2026-06-08T18:30:00.000Z") as Record<
        string,
        unknown
      >),
      id: "AAPL:15m",
      timeframe: "15m",
      barsSinceSignal: 1,
    },
  ] as never[];

  const ordered = __signalOptionsAutomationInternalsForTests.orderSignalOptionsActionStates({
    states,
    universe: new Set(["SPY", "AAPL"]),
    timeframe: "5m",
  });

  assert.deepEqual(
    ordered.map((state) => [
      state.symbol,
      state.timeframe,
      state.currentSignalDirection,
    ]),
    [["SPY", "5m", "sell"]],
  );

  const unfiltered = __signalOptionsAutomationInternalsForTests.orderSignalOptionsActionStates({
    states,
    universe: new Set(["SPY", "AAPL"]),
  });

  assert.deepEqual(
    unfiltered.map((state) => state.timeframe),
    ["2m", "15m", "5m"],
  );
});

test("Signal Options monitor refresh stops mid-universe scan when aborted", () => {
  const { shouldRefreshSignalOptionsMonitorState } =
    __signalOptionsAutomationInternalsForTests;
  const controller = new AbortController();
  const now = "2026-06-09T16:40:00.000Z";
  const universe = {
    size: 3,
    has: () => true,
    *[Symbol.iterator]() {
      yield "AAA";
      controller.abort(new Error("mid-batch abort"));
      yield "BBB";
    },
  } as unknown as Set<string>;

  assert.throws(
    () =>
      shouldRefreshSignalOptionsMonitorState({
        evaluated: {
          profile: { id: "runtime-fallback-test", timeframe: "5m" },
          states: [
            signalState("AAA", now),
            signalState("BBB", now),
            signalState("CCC", now),
          ],
        },
        universe,
        now: new Date(now),
        signal: controller.signal,
      }),
    /mid-batch abort/,
  );
});

test("Signal Options monitor batch cursor resumes at the first unprocessed symbol after abort", () => {
  const {
    resolveSignalOptionsMonitorBatch,
    rememberSignalOptionsMonitorBatchSymbolProcessed,
  } = __signalOptionsAutomationInternalsForTests;
  const deploymentId = `cursor-resume-${Date.now()}`;
  const universe = new Set(["AAA", "BBB", "CCC", "DDD"]);
  const profile = {} as never;

  const planned = resolveSignalOptionsMonitorBatch({
    deploymentId,
    universe,
    profile,
    capacity: 2,
  });
  assert.deepEqual(planned.symbols, ["AAA", "BBB"]);
  assert.equal(planned.startIndex, 0);
  assert.equal(planned.nextIndex, 2);

  rememberSignalOptionsMonitorBatchSymbolProcessed({
    deploymentId,
    universe,
    symbol: "AAA",
  });

  const resumed = resolveSignalOptionsMonitorBatch({
    deploymentId,
    universe,
    profile,
    capacity: 2,
  });
  assert.deepEqual(resumed.symbols, ["BBB", "CCC"]);
  assert.equal(resumed.startIndex, 1);
  assert.equal(resumed.nextIndex, 3);
});

test("Signal Options action states require canonical signal monitor events", () => {
  const states = [
    signalState("AERO", "2026-06-09T16:35:00.000Z", "sell"),
    signalState("BGC", "2026-06-09T16:40:00.000Z"),
  ] as never[];

  const ordered =
    __signalOptionsAutomationInternalsForTests.orderSignalOptionsActionStates({
      states,
      universe: new Set(["AERO", "BGC"]),
      timeframe: "5m",
      canonicalSignalKeys: new Set([
        __signalOptionsAutomationInternalsForTests.buildSignalKey(
          states[0],
          "2026-06-09T16:35:00.000Z",
        ),
      ]),
    });

  assert.deepEqual(
    ordered.map((state) => [state.symbol, state.currentSignalDirection]),
    [["AERO", "sell"]],
  );
});

test("Signal Options keeps one-bar monitor signals executable even after matrix freshness flips false", () => {
  const {
    buildSignalOptionsSignalSnapshot,
    candidateFromSignalSnapshot,
    isSignalOptionsActionableSignalState,
    previewCandidateFromSignalSnapshot,
  } = __signalOptionsAutomationInternalsForTests;
  const oneBarSignal = {
    ...(signalState("TSM", "2026-06-11T17:05:00.000Z", "sell") as Record<
      string,
      unknown
    >),
    latestBarAt: "2026-06-11T17:10:00.000Z",
    barsSinceSignal: 1,
    fresh: false,
  } as never;

  assert.equal(isSignalOptionsActionableSignalState(oneBarSignal), true);

  const snapshot = buildSignalOptionsSignalSnapshot({
    state: oneBarSignal,
    signalAt: "2026-06-11T17:05:00.000Z",
    signalKey: "paper-profile:TSM:5m:sell:2026-06-11T17:05:00.000Z",
    source: "pyrus-signals",
    eventId: "event-tsm",
    freshWindowBars: 8,
  });
  assert.equal(snapshot.fresh, false);
  assert.equal(snapshot.actionEligible, true);
  assert.equal(snapshot.actionBlocker, null);

  const candidate = candidateFromSignalSnapshot({
    deployment: {
      id: "deployment-test",
      name: "Signal Options Test",
    },
    signal: snapshot,
  } as never);
  assert.equal(candidate?.symbol, "TSM");
  assert.equal(candidate?.optionRight, "put");

  const previewCandidate = previewCandidateFromSignalSnapshot({
    deployment: {
      id: "deployment-test",
      name: "Signal Options Test",
    },
    signal: snapshot,
  } as never);
  assert.equal(previewCandidate?.symbol, "TSM");
  assert.equal(previewCandidate?.optionRight, "put");
});

test("shadow fallback marks older than 60s cannot trigger stop exits", () => {
  // User-confirmed policy: stops wait for fresh data. A fallback mark may be
  // up to 3 minutes old to RECORD marks, but exits demand <= 60s.
  const { isSignalOptionsShadowMarkFallbackExitEligible } =
    __signalOptionsAutomationInternalsForTests;
  const latestAsOf = new Date("2026-06-11T17:05:00.000Z");
  const base = {
    deployment: { providerAccountId: "shadow" },
    markSource: "shadow_position_mark",
    usedShadowMarkFallback: true,
    position: {
      selectedContract: { expirationDate: "2026-06-19" },
    },
    fallback: {
      positionId: "shadow-position",
      latestMarkPrice: 1.25,
      latestAsOf,
      peakMarkPrice: 1.5,
      peakAsOf: latestAsOf,
      source: "option_quote",
    },
  } as never;

  assert.equal(
    isSignalOptionsShadowMarkFallbackExitEligible({
      ...(base as Record<string, unknown>),
      now: new Date("2026-06-11T17:05:30.000Z"),
    } as never),
    true,
  );
  assert.equal(
    isSignalOptionsShadowMarkFallbackExitEligible({
      ...(base as Record<string, unknown>),
      now: new Date("2026-06-11T17:07:00.000Z"),
    } as never),
    false,
  );
});

test("Signal Options snapshot blocks non-ok signal states regardless of bar age", () => {
  // Seatbelt: callers pre-filter to status="ok", but the snapshot itself must
  // never mark a stale/error state actionable — even at zero bars of age.
  const { buildSignalOptionsSignalSnapshot } =
    __signalOptionsAutomationInternalsForTests;
  const staleSignal = {
    ...(signalState("TSM", "2026-06-11T17:05:00.000Z", "sell") as Record<
      string,
      unknown
    >),
    latestBarAt: "2026-06-11T17:05:00.000Z",
    barsSinceSignal: 0,
    fresh: false,
    status: "stale",
  } as never;

  const snapshot = buildSignalOptionsSignalSnapshot({
    state: staleSignal,
    signalAt: "2026-06-11T17:05:00.000Z",
    freshWindowBars: 8,
  });
  assert.equal(snapshot.actionEligible, false);
  assert.equal(snapshot.actionBlocker, "data_stale");
});

test("Signal Options still rejects signals outside the actionable execution window", () => {
  const {
    candidateFromSignalSnapshot,
    isSignalOptionsActionableSignalState,
    previewCandidateFromSignalSnapshot,
  } = __signalOptionsAutomationInternalsForTests;
  const agedSignal = {
    ...(signalState("DIA", "2026-06-11T15:05:00.000Z", "sell") as Record<
      string,
      unknown
    >),
    barsSinceSignal: 9,
    fresh: true,
  } as never;

  assert.equal(isSignalOptionsActionableSignalState(agedSignal), false);
  assert.equal(
    candidateFromSignalSnapshot({
      deployment: { id: "deployment-test", name: "Signal Options Test" },
      signal: {
        profileId: "paper-profile",
        signalKey: "paper-profile:DIA:5m:sell:2026-06-11T15:05:00.000Z",
        source: "pyrus-signals",
        eventId: "event-dia",
        symbol: "DIA",
        timeframe: "5m",
        direction: "sell",
        signalAt: "2026-06-11T15:05:00.000Z",
        signalPrice: 100,
        latestBarAt: "2026-06-11T15:50:00.000Z",
        barsSinceSignal: 9,
        freshWindowBars: 8,
        fresh: true,
        actionEligible: false,
        actionBlocker: null,
        status: "ok",
        filterState: null,
      },
    } as never),
    null,
  );
  assert.equal(
    previewCandidateFromSignalSnapshot({
      deployment: { id: "deployment-test", name: "Signal Options Test" },
      signal: {
        profileId: "paper-profile",
        signalKey: "paper-profile:DIA:5m:sell:2026-06-11T15:05:00.000Z",
        source: "pyrus-signals",
        eventId: "event-dia",
        symbol: "DIA",
        timeframe: "5m",
        direction: "sell",
        signalAt: "2026-06-11T15:05:00.000Z",
        signalPrice: 100,
        latestBarAt: "2026-06-11T15:50:00.000Z",
        barsSinceSignal: 9,
        freshWindowBars: 8,
        fresh: true,
        actionEligible: false,
        actionBlocker: null,
        status: "ok",
        filterState: null,
      },
    } as never),
    null,
  );
});

test("Signal Options cockpit signal snapshots require canonical event metadata", () => {
  const state = signalState("BGC", "2026-06-09T16:40:00.000Z");
  const signalAt = "2026-06-09T16:40:00.000Z";
  const signalKey = __signalOptionsAutomationInternalsForTests.buildSignalKey(
    state,
    signalAt,
  );

  assert.equal(
    __signalOptionsAutomationInternalsForTests.buildCanonicalSignalOptionsSignalSnapshot({
      state,
      signalAt,
      signalKey,
      metadata: null,
      freshWindowBars: 3,
    }),
    null,
  );

  const snapshot =
    __signalOptionsAutomationInternalsForTests.buildCanonicalSignalOptionsSignalSnapshot({
      state,
      signalAt,
      signalKey,
      metadata: {
        eventId: "event-bgc",
        source: "pyrus-signals",
        filterState: { adx: 22.1 },
      },
      freshWindowBars: 3,
    });

  assert.equal(snapshot?.eventId, "event-bgc");
  assert.equal(snapshot?.source, "pyrus-signals");
  assert.deepEqual(snapshot?.filterState, { adx: 22.1 });
});

test("Signal Options cockpit signal stage counts received signals, not stale candidates", () => {
  const signal = __signalOptionsAutomationInternalsForTests.buildSignalOptionsSignalSnapshot({
    state: signalState("AERO", "2026-06-09T16:35:00.000Z", "sell"),
    signalAt: "2026-06-09T16:35:00.000Z",
    signalKey: "paper-profile:AERO:5m:sell:2026-06-09T16:35:00.000Z",
    source: "pyrus-signals",
    eventId: "event-aero",
    freshWindowBars: 3,
  });
  const stages = __signalOptionsAutomationInternalsForTests.buildCockpitPipeline({
    deployment: {
      symbolUniverse: ["AERO", "BGC"],
      lastEvaluatedAt: new Date("2026-06-09T16:40:00.000Z"),
    },
    readiness: {
      ready: true,
      message: "ready",
      reason: null,
      diagnostics: {},
    },
    signals: [signal],
    candidates: [
      {
        id: "stale-candidate-bgc",
        symbol: "BGC",
        signalAt: "2026-06-09T16:30:00.000Z",
        action: {},
      },
      {
        id: "stale-candidate-late",
        symbol: "LATE",
        signalAt: "2026-06-09T16:25:00.000Z",
        action: {},
      },
    ],
    activePositions: [],
    risk: {},
    events: [],
  } as never);
  const signalStage = stages.find((stage) => stage.id === "signal_detected");

  assert.equal(signalStage?.label, "Signal Received");
  assert.equal(signalStage?.count, 1);
  assert.equal(signalStage?.latestAt, "2026-06-09T16:35:00.000Z");
});

test("Signal Options dashboard candidates use deterministic display tie-breakers", () => {
  const candidates = [
    {
      id: "SIGOPT-paper-TSLA-buy-1780617600000",
      symbol: "TSLA",
      direction: "buy",
      signalAt: "2026-06-05T00:00:00.000Z",
      timeline: [],
    },
    {
      id: "SIGOPT-paper-META-buy-1780617600000",
      symbol: "META",
      direction: "buy",
      signalAt: "2026-06-05T00:00:00.000Z",
      timeline: [],
    },
    {
      id: "SIGOPT-paper-LITE-buy-1780929600000",
      symbol: "LITE",
      direction: "buy",
      signalAt: "2026-06-08T14:40:00.000Z",
      timeline: [],
    },
  ];
  const compare =
    __signalOptionsAutomationInternalsForTests.compareSignalOptionsCandidatesForDisplay as (
      left: Record<string, unknown>,
      right: Record<string, unknown>,
    ) => number;

  candidates.sort(compare);

  assert.deepEqual(
    candidates.map((candidate) => candidate.symbol),
    ["LITE", "META", "TSLA"],
  );
});

test("Signal Options position mark keeps stale quote distinct from missing bid/ask", () => {
  const resolution =
    __signalOptionsAutomationInternalsForTests.resolvePositionMarkQuote({
      quote: {
        bid: 3.5,
        ask: 4.4,
        mark: 4.5,
        last: 4.5,
        quoteFreshness: "stale",
        marketDataMode: "live",
      },
      profile: {
        liquidityGate: {
          requireBidAsk: true,
          requireFreshQuote: true,
          minBid: 0.01,
          maxSpreadPctOfMid: 35,
        },
        liquidityHaltControls: {
          bidAskRequiredEnabled: true,
          freshQuoteRequiredEnabled: true,
          spreadGateEnabled: true,
          minBidGateEnabled: true,
        },
      },
    } as never) as {
      ok: boolean;
      reason: string | null;
      markPrice: number | null;
      liquidity: {
        bid: number | null;
        ask: number | null;
        reasons: string[];
      };
    };

  assert.equal(resolution.ok, false);
  assert.equal(resolution.reason, "quote_not_fresh");
  assert.equal(resolution.markPrice, 3.95);
  assert.equal(resolution.liquidity.bid, 3.5);
  assert.equal(resolution.liquidity.ask, 4.4);
  assert.deepEqual(resolution.liquidity.reasons, ["quote_not_fresh"]);
});

test("Signal Options stale position mark summary names stale quote", () => {
  assert.equal(
    __signalOptionsAutomationInternalsForTests.positionMarkUnavailableSummary({
      symbol: "CLS",
      markReason: "quote_not_fresh",
    }),
    "CLS shadow mark skipped: option quote stale",
  );
  assert.equal(
    __signalOptionsAutomationInternalsForTests.positionMarkUnavailableMessage(
      "quote_not_fresh",
    ),
    "The option quote was stale or unavailable for the open shadow position.",
  );
});

test("realized P&L uses the contract multiplier, not a hardcoded 100", () => {
  const { signalOptionsContractMultiplier, signalOptionsRealizedPnl } =
    __signalOptionsAutomationInternalsForTests;

  // Standard equity option (multiplier 100) — behavior unchanged.
  assert.equal(
    signalOptionsContractMultiplier({ multiplier: 100 }),
    100,
  );
  assert.equal(signalOptionsRealizedPnl(3, 2, 1, { multiplier: 100 }), 100);

  // Missing/invalid multiplier falls back to 100 (matches the unrealized path).
  assert.equal(signalOptionsContractMultiplier({}), 100);
  assert.equal(signalOptionsContractMultiplier(null), 100);
  assert.equal(signalOptionsRealizedPnl(3, 2, 1, undefined), 100);

  // Adjusted/mini contract (multiplier 10) — realized P&L must scale by 10,
  // not 100, so it agrees with unrealized P&L and the daily-loss halt.
  assert.equal(signalOptionsContractMultiplier({ multiplier: 10 }), 10);
  assert.equal(signalOptionsRealizedPnl(3, 2, 1, { multiplier: 10 }), 10);
  assert.equal(signalOptionsRealizedPnl(3.0, 2.0, 5, { multiplier: 10 }), 50);
});

test("a position's exit can only be claimed once (duplicate-exit race guard)", () => {
  const internals = __signalOptionsAutomationInternalsForTests;
  internals.__resetSignalOptionsClaimedExitsForTests();
  const now = 1_700_000_000_000;
  const key = "deployment-1:position-1";

  // First concurrent caller (e.g. tick manager) claims the exit and emits.
  assert.equal(internals.tryClaimSignalOptionsPositionExit(key, now), true);
  // Second concurrent caller (e.g. worker scan) for the SAME position is
  // blocked, so it cannot emit a duplicate SIGNAL_OPTIONS_EXIT_EVENT and the
  // realized P&L / daily-loss halt are not double-counted.
  assert.equal(internals.tryClaimSignalOptionsPositionExit(key, now), false);
  assert.equal(
    internals.tryClaimSignalOptionsPositionExit(key, now + 5_000),
    false,
  );

  // A different position is independent.
  assert.equal(
    internals.tryClaimSignalOptionsPositionExit("deployment-1:position-2", now),
    true,
  );

  // After the TTL the claim is pruned (memory bound); a real re-exit is still
  // prevented by the persisted exit event, so re-claimability here is safe.
  assert.equal(
    internals.tryClaimSignalOptionsPositionExit(key, now + 11 * 60 * 1000),
    true,
  );
});

test("dashboard event read covers the full trading day for >100-event realized P&L", async () => {
  const internals = __signalOptionsAutomationInternalsForTests;
  const uuid = (value: number) =>
    `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
  const strategyId = uuid(3100);
  const deploymentId = uuid(3101);
  const now = new Date("2026-07-07T18:00:00.000Z");
  const firstExitAt = new Date("2026-07-07T14:30:00.000Z");

  await withTestDb(async ({ db }) => {
    await db.insert(algoStrategiesTable).values({
      id: strategyId,
      name: "Signal Options PnL Window",
      mode: "shadow",
      enabled: true,
      symbolUniverse: ["AAPL"],
      config: {},
    });
    await db.insert(algoDeploymentsTable).values({
      id: deploymentId,
      strategyId,
      name: "Signal Options PnL Window",
      mode: "shadow",
      enabled: true,
      providerAccountId: "shadow",
      symbolUniverse: ["AAPL"],
      config: { signalOptions: {} },
    });
    await db.insert(executionEventsTable).values(
      Array.from({ length: 120 }, (_, index) => ({
        id: uuid(4000 + index),
        deploymentId,
        providerAccountId: "shadow",
        symbol: "AAPL",
        eventType: SIGNAL_OPTIONS_EXIT_EVENT,
        summary: `exit ${index}`,
        occurredAt: new Date(firstExitAt.getTime() + index * 60_000),
        payload: {
          pnl: -1,
          position: { id: `position-${index}` },
        },
      })),
    );

    const read = await internals.readSignalOptionsDashboardEvents({
      deploymentId,
      recentLimit: 100,
      now,
    });
    assert.equal(read.recentEvents.length, 100);
    assert.equal(read.dayEvents.length, 120);
    assert.equal(read.dayOverflow, false);
    assert.equal(
      read.sessionStartAt?.toISOString(),
      "2026-07-07T13:30:00.000Z",
    );

    const recentOnlyPnl = internals.computeSignalOptionsDailyRealizedPnl(
      internals.stateSignalOptionsEvents(read.recentEvents).signalEvents,
      now,
    );
    const fullDayPnl = internals.computeSignalOptionsDailyRealizedPnl(
      internals.stateSignalOptionsEvents(read.events).signalEvents,
      now,
    );
    assert.equal(recentOnlyPnl, -100);
    assert.equal(fullDayPnl, -120);
  });
});

test("dashboard event read excludes persisted candidate-skip firehose rows", async () => {
  const internals = __signalOptionsAutomationInternalsForTests;
  const uuid = (value: number) =>
    `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
  const strategyId = uuid(5100);
  const deploymentId = uuid(5101);
  const now = new Date("2026-07-07T18:00:00.000Z");
  const firstEventAt = new Date("2026-07-07T14:30:00.000Z");

  await withTestDb(async ({ db }) => {
    await db.insert(algoStrategiesTable).values({
      id: strategyId,
      name: "Signal Options Dashboard Firehose",
      mode: "shadow",
      enabled: true,
      symbolUniverse: ["AAPL"],
      config: {},
    });
    await db.insert(algoDeploymentsTable).values({
      id: deploymentId,
      strategyId,
      name: "Signal Options Dashboard Firehose",
      mode: "shadow",
      enabled: true,
      providerAccountId: "shadow",
      symbolUniverse: ["AAPL"],
      config: { signalOptions: {} },
    });
    await db.insert(executionEventsTable).values([
      ...Array.from({ length: 3 }, (_, index) => ({
        id: uuid(5200 + index),
        deploymentId,
        providerAccountId: "shadow",
        symbol: "AAPL",
        eventType: SIGNAL_OPTIONS_EXIT_EVENT,
        summary: `exit ${index}`,
        occurredAt: new Date(firstEventAt.getTime() + index * 60_000),
        payload: {
          pnl: -1,
          position: { id: `position-${index}` },
        },
      })),
      ...Array.from({ length: 25 }, (_, index) => ({
        id: uuid(5300 + index),
        deploymentId,
        providerAccountId: "shadow",
        symbol: "AAPL",
        eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
        summary: `skip ${index}`,
        occurredAt: new Date(firstEventAt.getTime() + (10 + index) * 60_000),
        payload: {
          reason: "mtf_not_aligned",
          signalKey: `AAPL|buy|${index}`,
        },
      })),
    ]);

    const read = await internals.readSignalOptionsDashboardEvents({
      deploymentId,
      recentLimit: 10,
      now,
    });

    assert.deepEqual(
      read.recentEvents.map((event) => event.eventType),
      [
        SIGNAL_OPTIONS_EXIT_EVENT,
        SIGNAL_OPTIONS_EXIT_EVENT,
        SIGNAL_OPTIONS_EXIT_EVENT,
      ],
    );
    assert.equal(read.dayEvents.length, 3);
    assert.equal(read.dayOverflow, false);
  });
});

test("deriveCandidateActionStatus: a resolved shadow link marks an open position shadow_filled even when its entry event aged out of the view window", () => {
  const { deriveCandidateActionStatus } =
    __signalOptionsAutomationInternalsForTests;

  const shadowLink = {
    orderId: "order-1",
    fillId: "fill-1",
    positionId: "position-1",
    sourceEventId: "entry-1",
    quantity: 2,
    filledQuantity: 2,
    positionQuantity: 2,
    sourceType: "automation",
    strategyLabel: "Signal Options",
    attributionStatus: "attributed",
  };

  // Entry event is intentionally absent from `events` — it has aged out of the
  // bounded view window (the 100-event summary view). Before the fix this
  // returned actionStatus "candidate" because hasEntry was false; the resolved
  // shadow link must now drive the filled status so an open, filled position is
  // not mislabeled "candidate" / "shadow link pending".
  const filled = deriveCandidateActionStatus({
    candidate: { status: "candidate", orderPlan: {} },
    events: [],
    shadowLink,
  } as never);
  assert.equal(filled.actionStatus, "shadow_filled");
  assert.equal(filled.syncStatus, "synced");

  // A partial fill (positionQuantity < planned) stays partial_shadow.
  const partial = deriveCandidateActionStatus({
    candidate: { status: "candidate", orderPlan: { quantity: 3 } },
    events: [],
    shadowLink: { ...shadowLink, positionQuantity: 1 },
  } as never);
  assert.equal(partial.actionStatus, "partial_shadow");

  // Without a resolved link and no entry event, it remains a plain candidate.
  const pending = deriveCandidateActionStatus({
    candidate: { status: "candidate", orderPlan: {} },
    events: [],
  } as never);
  assert.equal(pending.actionStatus, "candidate");
});

test("reconcileActivePositionsWithShadowLedger reuses a provided shadow index instead of rebuilding it (fix A)", async () => {
  const { reconcileActivePositionsWithShadowLedger } =
    __signalOptionsAutomationInternalsForTests;

  const position = {
    id: "position-1",
    candidateId: "cand-1",
    symbol: "AAPL",
    selectedContract: {},
  } as unknown as SignalOptionsPosition;

  // The provided index reports this candidate's position fully closed
  // (positionQuantity <= 0), so reconcile must DROP it. A DB rebuild here would
  // read an empty index (no such row in the unit-test DB) and KEEP the position,
  // so an empty result can only mean the provided index was consulted — i.e. no
  // rebuild and none of its batched shadow_positions/orders/fills queries ran
  // (which would otherwise touch the DB and fail in this test environment).
  const providedIndex = {
    byEventId: new Map(),
    byCandidateId: new Map([["cand-1", { positionQuantity: 0 }]]),
    cashByPositionKey: new Map(),
  } as never;

  const result = await reconcileActivePositionsWithShadowLedger({
    positions: [position],
    events: [],
    shadowIndex: providedIndex,
  });

  assert.deepEqual(result, []);
});

test("Signal Options reconcile takes an optional shadow index and buildStatePayload passes the one it built (fix A)", () => {
  const reconcileStart = source.indexOf(
    "async function reconcileActivePositionsWithShadowLedger",
  );
  assert.notEqual(reconcileStart, -1);
  const reconcileEnd = source.indexOf(
    "const RETRYABLE_SIGNAL_OPTION_SKIP_REASONS",
    reconcileStart,
  );
  assert.notEqual(reconcileEnd, -1);
  const reconcileBody = source.slice(reconcileStart, reconcileEnd);
  assert.match(reconcileBody, /shadowIndex\?:\s*SignalOptionsShadowIndex;/);
  // Reuse the provided index, else fall back to a rebuild (unchanged for other callers).
  assert.match(
    reconcileBody,
    /input\.shadowIndex\s*\?\?\s*\(await buildSignalOptionsShadowIndex\(input\.events\)\)/,
  );

  // buildStatePayload builds the index once (from the identical events) and hands
  // that exact index to reconcile instead of letting it rebuild.
  const buildReconcile = source.indexOf(
    "reconcileActivePositionsWithShadowLedger({",
    source.indexOf("async function buildStatePayload"),
  );
  assert.notEqual(buildReconcile, -1);
  const buildCall = source.slice(buildReconcile, buildReconcile + 520);
  assert.match(buildCall, /events:\s*activeSignalEventsBeforeReconciliation,/);
  assert.match(buildCall, /deploymentId:\s*input\.deployment\.id,/);
  assert.match(buildCall, /\n\s*shadowIndex,\n/);
});

test("Signal Options summary snapshot serves a fresh cache in normal mode before rebuilding (fix C)", () => {
  const start = source.indexOf(
    "async function getSignalOptionsSummaryDashboardSnapshot",
  );
  const end = source.indexOf(
    "async function getSignalOptionsDashboardSnapshot",
    start,
  );
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const body = source.slice(start, end);

  // Anchor after the cache-ONLY branch (its explicit error code) so we inspect
  // the new normal-mode read, not the pre-existing cache-only read.
  const afterCacheOnly = body.indexOf(
    "signal_options_summary_cache_unavailable",
  );
  assert.notEqual(afterCacheOnly, -1);
  const normalCacheIdx = body.indexOf(
    "signalOptionsSummaryDashboardCache.get(input.deploymentId)",
    afterCacheOnly,
  );
  const inFlightIdx = body.indexOf(
    "const inFlight = readSignalOptionsDashboardInFlight",
  );
  const rebuildIdx = body.indexOf("const work = (async () =>");

  assert.ok(
    normalCacheIdx > afterCacheOnly,
    "normal-mode cache read must come after the cache-only branch",
  );
  assert.ok(
    inFlightIdx > normalCacheIdx,
    "normal-mode cache read must precede the in-flight check",
  );
  assert.ok(
    rebuildIdx > normalCacheIdx,
    "normal-mode cache read must precede the rebuild",
  );
  // Same 15s freshness gate as cache-only (expiresAt > now), not the stale window.
  assert.match(
    body.slice(normalCacheIdx, inFlightIdx),
    /if\s*\(cached\s*&&\s*cached\.expiresAt\s*>\s*now\)\s*\{\s*return cached;/,
  );
});

test("Signal Options flags cold rebuilds freshlyBuilt and skips the refresh only for them, not cache hits (fix B)", () => {
  const summaryStart = source.indexOf(
    "async function getSignalOptionsSummaryDashboardSnapshot",
  );
  const fullStart = source.indexOf(
    "async function getSignalOptionsFullDashboardSnapshot",
  );
  assert.notEqual(summaryStart, -1);
  assert.notEqual(fullStart, -1);
  // getSignalOptionsFullDashboardSnapshot precedes the summary function.
  const fullBody = source.slice(fullStart, summaryStart);
  const summaryBody = source.slice(
    summaryStart,
    source.indexOf(
      "async function getSignalOptionsDashboardSnapshot",
      summaryStart,
    ),
  );

  // Both cold-rebuild closures flag the RETURNED value (the cached object stays clean).
  assert.match(
    fullBody,
    /return\s*\{\s*\.\.\.snapshot,\s*freshlyBuilt:\s*true\s*\}/,
  );
  assert.match(
    summaryBody,
    /return\s*\{\s*\.\.\.snapshot,\s*freshlyBuilt:\s*true\s*\}/,
  );

  // The live-signal refresh returns early for a freshly-built snapshot...
  const refreshStart = source.indexOf(
    "async function withFreshSignalOptionsStateSignals",
  );
  const refreshEnd = source.indexOf(
    "export async function listSignalOptionsAutomationState",
    refreshStart,
  );
  assert.notEqual(refreshStart, -1);
  assert.notEqual(refreshEnd, -1);
  const refreshBody = source.slice(refreshStart, refreshEnd);
  assert.match(
    refreshBody,
    /if\s*\(snapshot\.freshlyBuilt === true\)\s*\{\s*return snapshot\.state;/,
  );

  // ...but the normal-mode cache hit returns the clean cached snapshot (no
  // freshlyBuilt), so its stale signals still fall through to the refresh.
  const cacheHit = summaryBody.slice(
    summaryBody.indexOf("signal_options_summary_cache_unavailable"),
  );
  assert.match(
    cacheHit,
    /if\s*\(cached\s*&&\s*cached\.expiresAt\s*>\s*now\)\s*\{\s*return cached;/,
  );
});

test("MTF entry gate requires unanimity despite a stale lower requiredCount", async () => {
  const { evaluateSignalOptionsEntryGate, requiredSignalOptionsMtfCount } =
    __signalOptionsAutomationInternalsForTests;
  const { resolveSignalOptionsExecutionProfile } = await import(
    "@workspace/backtest-core"
  );

  // Required count is derived from the selected frame count.
  assert.equal(requiredSignalOptionsMtfCount(undefined, [1, 1, 1]), 3);
  assert.equal(requiredSignalOptionsMtfCount(2, [1, 1, 1]), 3);
  assert.equal(requiredSignalOptionsMtfCount(9, [1, 1, 1]), 3);
  assert.equal(requiredSignalOptionsMtfCount(0, [1, 1, 1]), 3);

  const candidate = {
    symbol: "PLTR",
    direction: "sell",
    optionRight: "put",
    signal: { filterState: {} },
  } as unknown as Parameters<
    typeof evaluateSignalOptionsEntryGate
  >[0]["candidate"];
  const mtfTimeframeDirections = {
    "1m": "sell",
    "2m": "sell",
    "5m": "buy",
  } as Parameters<
    typeof evaluateSignalOptionsEntryGate
  >[0]["mtfTimeframeDirections"];

  // A stale configured 2-of-3 count normalizes to 3-of-3.
  const partialProfile = resolveSignalOptionsExecutionProfile({
    signalOptions: {
      entryGate: {
        mtfAlignment: {
          enabled: true,
          timeframes: ["1m", "2m", "5m"],
          requiredCount: 2,
        },
      },
    },
  });
  assert.equal(partialProfile.entryGate.mtfAlignment.requiredCount, 3);
  const partial = evaluateSignalOptionsEntryGate({
    candidate,
    profile: partialProfile,
    mtfTimeframeDirections,
  });
  assert.equal(partial.requiredMtfCount, 3);
  assert.equal(partial.mtfMatches, 2);
  assert.equal(partial.reasons.includes("mtf_not_aligned"), true);

  // Unconfigured count also resolves to full selected-frame alignment.
  const strictProfile = resolveSignalOptionsExecutionProfile({
    signalOptions: {
      entryGate: {
        mtfAlignment: { enabled: true, timeframes: ["1m", "2m", "5m"] },
      },
    },
  });
  assert.equal(strictProfile.entryGate.mtfAlignment.requiredCount, 3);
  const strict = evaluateSignalOptionsEntryGate({
    candidate,
    profile: strictProfile,
    mtfTimeframeDirections,
  });
  assert.equal(strict.requiredMtfCount, 3);
  assert.equal(strict.reasons.includes("mtf_not_aligned"), true);
});

const greekSlotQuote = (
  right: "call" | "put",
  strike: number,
  delta: number,
) =>
  ({
    contract: {
      ticker: `TST-${right}-${strike}`,
      underlying: "TST",
      expirationDate: "2026-07-10",
      strike,
      right,
      multiplier: 100,
      sharesPerContract: 100,
      providerContractId: `conid-${right}-${strike}`,
    },
    bid: 1,
    ask: 1.1,
    last: 1.05,
    mark: 1.05,
    impliedVolatility: 0.35,
    delta,
    gamma: 0.03,
    theta: -0.02,
    vega: 0.08,
    openInterest: 500,
    volume: 100,
    quoteFreshness: "fresh",
    marketDataMode: "live",
    quoteUpdatedAt: "2026-07-07T14:30:00.000Z",
    updatedAt: "2026-07-07T14:30:00.000Z",
  }) as never;

const greekSlotStrikes = (selection: { attempts: Array<{ quote: unknown }> }) =>
  selection.attempts.map(
    (attempt) =>
      (attempt.quote as { contract?: { strike?: number } }).contract?.strike,
  );

async function greekSlotProfile(input: {
  callStrikeSlots?: number[];
  putStrikeSlots?: number[];
  minScore?: number;
  fallbackToLegacy?: boolean;
}) {
  const { resolveSignalOptionsExecutionProfile } = await import(
    "@workspace/backtest-core"
  );
  return resolveSignalOptionsExecutionProfile({
    optionSelection: {
      callStrikeSlots: input.callStrikeSlots,
      putStrikeSlots: input.putStrikeSlots,
      greekSelector: {
        enabled: true,
        mode: "all",
        fallbackToLegacy: input.fallbackToLegacy ?? true,
        maxCandidates: 24,
        minScore: input.minScore ?? 0,
        requireLiveGreeks: true,
      },
    },
    riskCaps: { maxPremiumPerEntry: 5_000, maxContracts: 10 },
  });
}

test("greek selector scores only configured call strike slots", async () => {
  const { selectSignalOptionsGreekContractPlanFromChain } =
    __signalOptionsAutomationInternalsForTests;
  const profile = await greekSlotProfile({ callStrikeSlots: [2, 1, 3] });
  const contracts = [94, 96, 98, 100, 102, 104, 106].map((strike) =>
    greekSlotQuote("call", strike, 0.45),
  );

  const selection = selectSignalOptionsGreekContractPlanFromChain({
    contracts,
    direction: "buy",
    signalPrice: 101,
    profile,
    at: new Date("2026-07-07T14:30:00.000Z"),
  });

  assert.equal(selection.candidateCount, 3);
  assert.deepEqual(greekSlotStrikes(selection).sort((a, b) => a! - b!), [
    98,
    100,
    102,
  ]);
  assert.equal(greekSlotStrikes(selection).includes(94), false);
  assert.equal(greekSlotStrikes(selection).includes(106), false);
});

test("greek selector scores only configured put strike slots", async () => {
  const { selectSignalOptionsGreekContractPlanFromChain } =
    __signalOptionsAutomationInternalsForTests;
  const profile = await greekSlotProfile({ putStrikeSlots: [4, 3, 2] });
  const contracts = [94, 96, 98, 100, 102, 104, 106].map((strike) =>
    greekSlotQuote("put", strike, -0.45),
  );

  const selection = selectSignalOptionsGreekContractPlanFromChain({
    contracts,
    direction: "sell",
    signalPrice: 101,
    profile,
    at: new Date("2026-07-07T14:30:00.000Z"),
  });

  assert.equal(selection.candidateCount, 3);
  assert.deepEqual(greekSlotStrikes(selection).sort((a, b) => a! - b!), [
    100,
    102,
    104,
  ]);
  assert.equal(greekSlotStrikes(selection).includes(94), false);
  assert.equal(greekSlotStrikes(selection).includes(106), false);
});

test("greek selector proceeds with remaining slot matches when configured slots collapse on a thin chain", async () => {
  const { selectSignalOptionsGreekContractPlanFromChain } =
    __signalOptionsAutomationInternalsForTests;
  const profile = await greekSlotProfile({ callStrikeSlots: [2, 3, 4] });
  const contracts = [100, 102].map((strike) =>
    greekSlotQuote("call", strike, 0.45),
  );

  const selection = selectSignalOptionsGreekContractPlanFromChain({
    contracts,
    direction: "buy",
    signalPrice: 101,
    profile,
    at: new Date("2026-07-07T14:30:00.000Z"),
  });

  assert.equal(selection.candidateCount, 2);
  assert.deepEqual(greekSlotStrikes(selection), [100, 102]);
  assert.equal(selection.fallbackReason, null);
});

test("zero slot-matching greek candidates follows the existing fallback_legacy no-candidate path", async () => {
  const { selectSignalOptionsContractPlanFromChain } =
    __signalOptionsAutomationInternalsForTests;
  const profile = await greekSlotProfile({ callStrikeSlots: [2, 1, 3] });
  const selection = selectSignalOptionsContractPlanFromChain({
    contracts: [94, 96, 98].map((strike) =>
      greekSlotQuote("put", strike, -0.45),
    ),
    direction: "buy",
    signalPrice: 100,
    profile,
    runtimeMode: "live",
  });

  assert.equal(selection.selectedBy, "fallback_legacy");
  assert.equal(selection.ok, false);
  assert.equal(selection.candidateCount, 0);
  assert.equal(selection.fallbackReason, "greek_selector_no_candidates");
  assert.equal(selection.greekSelection?.candidateCount, 0);
  assert.equal(selection.greekSelection?.fallbackReason, "greek_selector_no_candidates");
});

test("slot-excluded greek contracts are absent from scored attempts and the selection payload", async () => {
  const {
    selectSignalOptionsGreekContractPlanFromChain,
    signalOptionsContractSelectionPayload,
  } = __signalOptionsAutomationInternalsForTests;
  const profile = await greekSlotProfile({ callStrikeSlots: [2, 1, 3] });
  const selection = selectSignalOptionsGreekContractPlanFromChain({
    contracts: [94, 96, 98, 100, 102, 104, 106].map((strike) =>
      greekSlotQuote("call", strike, 0.45),
    ),
    direction: "buy",
    signalPrice: 101,
    profile,
    at: new Date("2026-07-07T14:30:00.000Z"),
  });
  const payload = signalOptionsContractSelectionPayload(selection);
  const payloadAttempts = (payload.greekSelection as {
    attempts: Array<{ selectedContract: { strike: number } }>;
    topCandidates: Array<{ selectedContract: { strike: number } }>;
  }).attempts;
  const payloadTopCandidates = (payload.greekSelection as {
    attempts: Array<{ selectedContract: { strike: number } }>;
    topCandidates: Array<{ selectedContract: { strike: number } }>;
  }).topCandidates;

  assert.equal(greekSlotStrikes(selection).includes(94), false);
  assert.equal(greekSlotStrikes(selection).includes(106), false);
  assert.deepEqual(
    payloadAttempts
      .map((attempt) => attempt.selectedContract.strike)
      .sort((left, right) => left - right),
    [98, 100, 102],
  );
  assert.equal(
    payloadTopCandidates.some((attempt) =>
      [94, 96, 104, 106].includes(attempt.selectedContract.strike),
    ),
    false,
  );
});

// ---------------------------------------------------------------------------
// Wave-2 CD: trading-lane market-time correctness + MTF payload mapping.
// Product rulings 2026-07-07; disclosed in
// .codex-watch/handoff-signal-options-lane-2026-07-07.md.
// ---------------------------------------------------------------------------

test("C1 selectSignalOptionsExpiration: DTE counts NY trading days, not UTC calendar days", () => {
  const profile = {
    optionSelection: { allowZeroDte: false, minDte: 1, targetDte: 1, maxDte: 3 },
  } as unknown as Parameters<typeof selectSignalOptionsExpiration>[1];

  // Friday signal -> Monday expiry across the weekend = 1 trading day (was 3
  // calendar days; a maxDte<=2 profile previously dropped every Friday entry).
  assert.equal(
    selectSignalOptionsExpiration(
      [{ expirationDate: new Date("2026-06-15T00:00:00.000Z") }],
      profile,
      new Date("2026-06-12T18:00:00.000Z"),
    )?.dte,
    1,
  );

  // Holiday-adjacent: Thu 2026-07-02 -> Mon 2026-07-06 across the 2026-07-03
  // Independence Day holiday = 1 trading day (was 4 calendar days).
  assert.equal(
    selectSignalOptionsExpiration(
      [{ expirationDate: new Date("2026-07-06T00:00:00.000Z") }],
      profile,
      new Date("2026-07-02T14:00:00.000Z"),
    )?.dte,
    1,
  );

  // Monday -> same-week Friday weekly = 4 trading days. This is the HONEST count
  // (the work-order's "2 trading days within maxDte 3" was arithmetically wrong;
  // verified against the landed market-calendar util). 4 > maxDte 3 => still
  // skipped. The trading-day conversion fixes weekend/holiday window shrinkage,
  // NOT the same-week Monday->Friday blackout, which is a maxDte product lever.
  assert.equal(
    selectSignalOptionsExpiration(
      [{ expirationDate: new Date("2026-06-12T00:00:00.000Z") }],
      profile,
      new Date("2026-06-08T13:30:00.000Z"),
    ),
    null,
  );
});

test("C2 session gates are holiday/early-close aware", () => {
  const {
    isRegularMarketSession,
    isLiveOptionTradingSession,
    isLiveOvernightExitWindow,
  } = __signalOptionsAutomationInternalsForTests;

  // Early close 2026-11-27 (day after Thanksgiving, 13:00 ET close). EST = UTC-5.
  assert.equal(isRegularMarketSession(new Date("2026-11-27T17:30:00.000Z")), true); // 12:30 ET
  assert.equal(isRegularMarketSession(new Date("2026-11-27T19:00:00.000Z")), false); // 14:00 ET (closed)
  assert.equal(isLiveOptionTradingSession(new Date("2026-11-27T17:30:00.000Z")), true);
  assert.equal(isLiveOptionTradingSession(new Date("2026-11-27T19:00:00.000Z")), false);
  // Overnight exit window shifts to 12:45-13:00 on early closes (was: never fired).
  assert.equal(isLiveOvernightExitWindow(new Date("2026-11-27T17:50:00.000Z")), true); // 12:50 ET
  assert.equal(isLiveOvernightExitWindow(new Date("2026-11-27T20:50:00.000Z")), false); // 15:50 ET
  // Early close overrides the extended-close (16:15) underlyings too.
  assert.equal(
    isLiveOptionTradingSession(new Date("2026-11-27T18:10:00.000Z"), { underlying: "SPY" }), // 13:10 ET
    false,
  );

  // Full holiday 2026-07-03 (observed Independence Day): all three false. EDT = UTC-4.
  assert.equal(isRegularMarketSession(new Date("2026-07-03T15:00:00.000Z")), false); // 11:00 ET
  assert.equal(isLiveOptionTradingSession(new Date("2026-07-03T15:00:00.000Z")), false);
  assert.equal(isLiveOvernightExitWindow(new Date("2026-07-03T19:50:00.000Z")), false); // 15:50 ET

  // Normal day 2026-07-06 (Monday) unchanged: RTH 09:30-16:00, exit 15:45-16:00.
  assert.equal(isRegularMarketSession(new Date("2026-07-06T14:00:00.000Z")), true); // 10:00 ET
  assert.equal(isRegularMarketSession(new Date("2026-07-06T20:30:00.000Z")), false); // 16:30 ET
  assert.equal(isLiveOvernightExitWindow(new Date("2026-07-06T19:50:00.000Z")), true); // 15:50 ET
  assert.equal(isLiveOvernightExitWindow(new Date("2026-07-06T19:30:00.000Z")), false); // 15:30 ET
  // Extended-close underlying keeps 16:15 on a normal day.
  assert.equal(
    isLiveOptionTradingSession(new Date("2026-07-06T20:10:00.000Z"), { underlying: "SPY" }), // 16:10 ET
    true,
  );
  assert.equal(isLiveOptionTradingSession(new Date("2026-07-06T20:10:00.000Z")), false); // 16:10 ET, regular
});

test("C3 daily-loss halt keys off the NY trading day, not the UTC calendar day", () => {
  const { computeSignalOptionsDailyRealizedPnl } =
    __signalOptionsAutomationInternalsForTests;
  // maintenance:true admits the exit past the option session so this isolates
  // the day-key logic (the C3 change) rather than the session gate.
  const exit = (id: string, occurredAt: string, pnl: number) =>
    ({
      id,
      eventType: SIGNAL_OPTIONS_EXIT_EVENT,
      occurredAt: new Date(occurredAt),
      payload: { pnl, maintenance: true },
    }) as unknown as ExecutionEvent;

  const now = new Date("2026-07-07T23:00:00.000Z"); // 19:00 ET -> NY day 2026-07-07
  const sameNyDay = exit("a", "2026-07-08T01:00:00.000Z", -100); // 21:00 ET 07-07 (UTC rolled)
  const nextNyDay = exit("b", "2026-07-08T13:30:00.000Z", -50); // 09:30 ET 07-08

  // Only the same-NY-day exit counts; the old UTC-calendar-day logic would have
  // dropped the 07-08Z timestamp even though it is the same NY evening.
  assert.equal(
    computeSignalOptionsDailyRealizedPnl([sameNyDay, nextNyDay], now),
    -100,
  );
});

test("C4 latestCompletedBackfillMarketDate skips holidays, not just weekends", () => {
  const { latestCompletedBackfillMarketDate } =
    __signalOptionsAutomationInternalsForTests;
  // On the 2026-07-03 holiday (observed Independence Day, a Friday) the latest
  // completed market date is Thursday 2026-07-02, not the holiday itself.
  assert.equal(
    latestCompletedBackfillMarketDate(new Date("2026-07-03T15:00:00.000Z")), // 11:00 ET holiday
    "2026-07-02",
  );
  // Weekend -> most recent trading day, skipping the adjacent holiday.
  assert.equal(
    latestCompletedBackfillMarketDate(new Date("2026-07-04T18:00:00.000Z")), // Sat
    "2026-07-02",
  );
  // Normal trading day after the close returns today.
  assert.equal(
    latestCompletedBackfillMarketDate(new Date("2026-07-06T20:30:00.000Z")), // 16:30 ET Mon
    "2026-07-06",
  );
});

test("D1 candidateFromEvent maps payload.entryGate onto the candidate", () => {
  const { candidateFromEvent } = __signalOptionsAutomationInternalsForTests;
  const entryGate = {
    ok: false,
    reason: "mtf_not_aligned",
    reasons: ["mtf_not_aligned"],
    adx: 21.5,
    mtfMatches: 1,
    mtfDirections: [1, -1],
    mtfTimeframes: ["1m", "5m"],
    requiredMtfCount: 2,
    missingMtfTimeframes: [],
  };
  const candidate = candidateFromEvent({
    id: "evt-1",
    symbol: "AAPL",
    eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
    occurredAt: new Date("2026-07-07T14:00:00.000Z"),
    payload: { candidate: { id: "cand-1", symbol: "AAPL" }, entryGate },
  } as unknown as ExecutionEvent);
  assert.deepEqual(candidate?.entryGate, entryGate);
});

test("D1 mergeSignalOptionsCandidate keeps the freshest non-null entryGate", () => {
  const { mergeSignalOptionsCandidate } =
    __signalOptionsAutomationInternalsForTests;
  type Cand = Parameters<typeof mergeSignalOptionsCandidate>[1];
  const base = (entryGate: Record<string, unknown> | null) =>
    ({
      id: "c",
      symbol: "AAPL",
      direction: "buy",
      optionRight: "call",
      timeframe: "15m",
      signalAt: new Date(0).toISOString(),
      signalPrice: null,
      status: "skipped",
      entryGate,
    }) as unknown as Cand;

  const oldGate = { ok: false, reason: "mtf_not_aligned", mtfMatches: 1 };
  const freshGate = { ok: false, reason: "mtf_unavailable", mtfMatches: 0 };

  // The candidate arg (the newer event, or durable state) wins when it has a gate.
  assert.deepEqual(
    mergeSignalOptionsCandidate(base(oldGate), base(freshGate)).entryGate,
    freshGate,
  );
  // A newer/merged candidate with no gate must NOT drop the preserved gate
  // (the object spread would otherwise overwrite it with null).
  assert.deepEqual(
    mergeSignalOptionsCandidate(base(oldGate), base(null)).entryGate,
    oldGate,
  );
});
