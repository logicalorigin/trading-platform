import assert from "node:assert/strict";
import test from "node:test";
import { defaultSignalOptionsExecutionProfile } from "@workspace/backtest-core";
import {
  SIGNAL_OPTIONS_ENTRY_EVENT,
  SIGNAL_OPTIONS_EXIT_EVENT,
  __signalOptionsAutomationInternalsForTests,
  buildSignalOptionsShadowOrderPlan,
  resolveSignalOptionsLiquidity,
  selectSignalOptionsContractFromChain,
  selectSignalOptionsExpiration,
  type SignalOptionsOptionQuote,
} from "./signal-options-automation";
import {
  normalizeAlgoDeploymentProviderAccountId,
  SHADOW_PROVIDER_ACCOUNT_ID,
} from "./algo-deployment-account";

const profile = defaultSignalOptionsExecutionProfile;

function quote(strike: number, right: "call" | "put"): SignalOptionsOptionQuote {
  return {
    contract: {
      ticker: `SPY260429${right === "call" ? "C" : "P"}${strike}`,
      underlying: "SPY",
      expirationDate: "2026-04-29",
      strike,
      right,
      multiplier: 100,
      sharesPerContract: 100,
      providerContractId: `${right}-${strike}`,
    },
    bid: 1,
    ask: 1.2,
    last: 1.1,
    mark: 1.1,
    openInterest: 100,
    volume: 25,
    updatedAt: "2026-04-28T15:00:00.000Z",
    quoteFreshness: "live",
  };
}

test("selectSignalOptionsExpiration excludes 0DTE by default", () => {
  const selected = selectSignalOptionsExpiration(
    [
      { expirationDate: "2026-04-28" },
      { expirationDate: "2026-04-29" },
      { expirationDate: "2026-05-01" },
    ],
    profile,
    new Date("2026-04-28T15:00:00.000Z"),
  );

  assert.equal(selected?.expirationDate.toISOString().slice(0, 10), "2026-04-29");
  assert.equal(selected?.dte, 1);
});

test("historical backfill expiration candidates skip weekends within DTE window", () => {
  const candidates =
    __signalOptionsAutomationInternalsForTests.selectHistoricalExpirationCandidates(
      new Date("2026-05-08T15:00:00.000Z"),
      profile,
    );

  assert.deepEqual(
    candidates.map((candidate) => ({
      date: candidate.expirationDate.toISOString().slice(0, 10),
      dte: candidate.dte,
    })),
    [{ date: "2026-05-11", dte: 3 }],
  );
});

test("historical backfill strike and ticker helpers mirror signal-options defaults", () => {
  const callStrikes =
    __signalOptionsAutomationInternalsForTests.selectHistoricalStrikeCandidates({
      signalPrice: 100.25,
      direction: "buy",
      profile,
    });
  const putStrikes =
    __signalOptionsAutomationInternalsForTests.selectHistoricalStrikeCandidates({
      signalPrice: 100.25,
      direction: "sell",
      profile,
    });
  const ticker =
    __signalOptionsAutomationInternalsForTests.buildHistoricalPolygonOptionTicker({
      underlying: "SPY",
      expirationDate: new Date("2026-05-11T00:00:00.000Z"),
      strike: callStrikes[0]!,
      right: "call",
    });

  assert.equal(callStrikes[0], 101);
  assert.equal(putStrikes[0], 100);
  assert.equal(ticker, "O:SPY260511C00101000");
});

test("historical backfill order plan sizes from option bar close", () => {
  const orderPlan =
    __signalOptionsAutomationInternalsForTests.buildHistoricalOrderPlan(
      1.25,
      profile,
    );

  assert.equal(orderPlan.ok, true);
  assert.equal(orderPlan.simulatedFillPrice, 1.25);
  assert.equal(orderPlan.quantity, 3);
  assert.equal(orderPlan.premiumAtRisk, 375);
  assert.equal(orderPlan.historicalPricing, true);
});

test("historical backfill closes expired positions after option bars are exhausted", () => {
  const position = {
    nextBarIndex: 1,
    optionBars: [{ timestamp: "2026-05-01T19:45:00.000Z" }],
    selectedContract: { expirationDate: "2026-05-01" },
  } as any;

  assert.equal(
    __signalOptionsAutomationInternalsForTests.shouldCloseBackfillPositionAtExpiration({
      position,
      until: new Date("2026-05-01T20:00:00.000Z"),
    }),
    true,
  );
  assert.equal(
    __signalOptionsAutomationInternalsForTests.shouldCloseBackfillPositionAtExpiration({
      position: { ...position, nextBarIndex: 0 },
      until: new Date("2026-05-01T20:00:00.000Z"),
    }),
    false,
  );
});

test("historical backfill defaults to the requested May 4-8 regular window", () => {
  const window =
    __signalOptionsAutomationInternalsForTests.resolveSignalOptionsBackfillWindow(
      {},
    );
  const eventKey =
    __signalOptionsAutomationInternalsForTests.backfillEventKey([
      "deployment",
      "SPY",
      "entry",
    ]);

  assert.equal(window.startDate, "2026-05-04");
  assert.equal(window.endDate, "2026-05-08");
  assert.equal(window.session, "regular");
  assert.equal(
    eventKey,
    "signal_options_backfill:1:deployment:SPY:entry",
  );
});

test("historical backfill uses signal monitor watchlist symbols before deployment symbols", () => {
  const universe =
    __signalOptionsAutomationInternalsForTests.buildSignalOptionsBackfillUniverse({
      deploymentSymbols: ["SPY", "QQQ"],
      signalMonitorSymbols: ["spy", "qqq", "aapl", "nvda", "AAPL"],
      watchlistId: "watchlist-1",
    });

  assert.equal(universe.source, "signal_monitor_watchlist");
  assert.equal(universe.watchlistId, "watchlist-1");
  assert.deepEqual(universe.symbols, ["SPY", "QQQ", "AAPL", "NVDA"]);
});

test("historical backfill falls back to deployment symbols without a watchlist universe", () => {
  const universe =
    __signalOptionsAutomationInternalsForTests.buildSignalOptionsBackfillUniverse({
      deploymentSymbols: ["spy", "QQQ", "spy"],
      signalMonitorSymbols: [],
    });

  assert.equal(universe.source, "deployment");
  assert.deepEqual(universe.symbols, ["SPY", "QQQ"]);
});

test("selectSignalOptionsContractFromChain maps buy to call above and sell to put below", () => {
  const contracts = [
    quote(99, "call"),
    quote(101, "call"),
    quote(102, "call"),
    quote(98, "put"),
    quote(99, "put"),
    quote(101, "put"),
  ];

  const call = selectSignalOptionsContractFromChain({
    contracts,
    direction: "buy",
    signalPrice: 100,
    profile,
  });
  const put = selectSignalOptionsContractFromChain({
    contracts,
    direction: "sell",
    signalPrice: 100,
    profile,
  });

  assert.equal(call?.contract?.right, "call");
  assert.equal(call?.contract?.strike, 101);
  assert.equal(put?.contract?.right, "put");
  assert.equal(put?.contract?.strike, 99);
});

test("signal-options candidates preserve RayReplica signal to shadow action mapping", () => {
  const signalAt = "2026-04-28T15:30:00.000Z";
  const state = {
    profileId: "11111111-1111-1111-1111-111111111111",
    symbol: "spy",
    timeframe: "15m",
    currentSignalDirection: "sell",
    currentSignalAt: signalAt,
    currentSignalPrice: 508.25,
    latestBarAt: "2026-04-28T15:45:00.000Z",
    barsSinceSignal: 1,
    fresh: true,
    status: "ok",
  } as never;
  const candidate =
    __signalOptionsAutomationInternalsForTests.buildCandidateFromSignal({
      deployment: {
        id: "deployment-123456789",
        name: "Shadow Options",
      } as never,
      state,
      signalAt,
      signalKey: "profile:SPY:15m:sell:2026-04-28T15:30:00.000Z",
      signalMetadata: {
        eventId: "event-1",
        source: "rayreplica",
        filterState: { mtf: "aligned" },
      },
    });

  assert.equal(candidate.optionRight, "put");
  assert.equal(candidate.action?.optionAction, "buy_put");
  assert.equal(candidate.action?.executionMode, "shadow");
  assert.equal(candidate.action?.destinationAccountId, "shadow");
  assert.equal(candidate.action?.brokerSubmission, false);
  assert.equal(candidate.signal?.source, "rayreplica");
  assert.equal(candidate.signal?.barsSinceSignal, 1);
  assert.deepEqual(candidate.signal?.filterState, { mtf: "aligned" });
});

test("signal-options deployments normalize execution to the shadow account", () => {
  assert.equal(
    normalizeAlgoDeploymentProviderAccountId({
      providerAccountId: "DU1234567",
      config: { signalOptions: profile },
    }),
    SHADOW_PROVIDER_ACCOUNT_ID,
  );
  assert.equal(
    normalizeAlgoDeploymentProviderAccountId({
      providerAccountId: "DU1234567",
      config: { parameters: { executionMode: "signal_options" } },
    }),
    SHADOW_PROVIDER_ACCOUNT_ID,
  );
  assert.equal(
    normalizeAlgoDeploymentProviderAccountId({
      providerAccountId: "DU1234567",
      config: { parameters: { executionMode: "backtest" } },
    }),
    "DU1234567",
  );
});

test("signal-options entry gate blocks weak bearish put regimes only", () => {
  const buildCandidate = (
    direction: "buy" | "sell",
    filterState: Record<string, unknown>,
  ) =>
    __signalOptionsAutomationInternalsForTests.buildCandidateFromSignal({
      deployment: {
        id: "deployment-123456789",
        name: "Shadow Options",
      } as never,
      state: {
        profileId: "11111111-1111-1111-1111-111111111111",
        symbol: "SPY",
        timeframe: "15m",
        currentSignalDirection: direction,
        currentSignalAt: "2026-04-28T15:30:00.000Z",
        currentSignalPrice: 508.25,
        latestBarAt: "2026-04-28T15:45:00.000Z",
        barsSinceSignal: 1,
        fresh: true,
        status: "ok",
      } as never,
      signalAt: "2026-04-28T15:30:00.000Z",
      signalKey: `profile:SPY:15m:${direction}:2026-04-28T15:30:00.000Z`,
      signalMetadata: {
        eventId: "event-1",
        source: "rayreplica",
        filterState,
      },
    });

  const bullishPut =
    __signalOptionsAutomationInternalsForTests.evaluateSignalOptionsEntryGate({
      candidate: buildCandidate("sell", {
        adx: 18,
        mtfDirections: [1, 1, 1],
      }),
      profile,
    });
  const acceptedPut =
    __signalOptionsAutomationInternalsForTests.evaluateSignalOptionsEntryGate({
      candidate: buildCandidate("sell", {
        adx: 28,
        mtfDirections: [-1, 1, 1],
      }),
      profile,
    });
  const call =
    __signalOptionsAutomationInternalsForTests.evaluateSignalOptionsEntryGate({
      candidate: buildCandidate("buy", {
        adx: 12,
        mtfDirections: [1, 1, 1],
      }),
      profile,
    });

  assert.equal(bullishPut.ok, false);
  assert.equal(bullishPut.reason, "bear_regime_gate_failed");
  assert.deepEqual(bullishPut.reasons, [
    "adx_below_minimum",
    "mtf_fully_bullish",
  ]);
  assert.equal(acceptedPut.ok, true);
  assert.equal(call.ok, true);
});

test("buildSignalOptionsShadowOrderPlan enforces liquidity and premium budget", () => {
  const liquid = quote(101, "call");
  const orderPlan = buildSignalOptionsShadowOrderPlan(liquid, profile);

  assert.equal(orderPlan.ok, true);
  assert.equal(orderPlan.quantity, 3);
  assert.equal(orderPlan.premiumAtRisk, 357);

  const wide = {
    ...liquid,
    bid: 1,
    ask: 2,
    mark: 1.5,
  };
  const liquidity = resolveSignalOptionsLiquidity(wide, profile);

  assert.equal(liquidity.ok, false);
  assert.ok(liquidity.reasons.includes("spread_too_wide"));
});

test("daily signal-options pnl includes realized exits and open marked positions", () => {
  const now = new Date("2026-04-28T18:00:00.000Z");
  const realizedExit = {
    id: "exit-1",
    eventType: SIGNAL_OPTIONS_EXIT_EVENT,
    payload: { pnl: -25 },
    occurredAt: now,
  } as never;
  const yesterdayExit = {
    id: "exit-0",
    eventType: SIGNAL_OPTIONS_EXIT_EVENT,
    payload: { pnl: -500 },
    occurredAt: new Date("2026-04-27T18:00:00.000Z"),
  } as never;
  const positions = [
    {
      entryPrice: 1.25,
      lastMarkPrice: 0.75,
      quantity: 2,
      selectedContract: { multiplier: 100 },
    },
    {
      entryPrice: 3,
      lastMarkPrice: 3.5,
      quantity: 1,
      selectedContract: { multiplier: 50 },
    },
    {
      entryPrice: 2,
      quantity: 1,
      selectedContract: { multiplier: 100 },
    },
  ] as never;

  assert.equal(
    __signalOptionsAutomationInternalsForTests.computeSignalOptionsDailyRealizedPnl(
      [realizedExit, yesterdayExit],
      now,
    ),
    -25,
  );
  assert.equal(
    __signalOptionsAutomationInternalsForTests.computeSignalOptionsOpenUnrealizedPnl(
      positions,
    ),
    -75,
  );
  assert.equal(
    __signalOptionsAutomationInternalsForTests.computeSignalOptionsDailyPnl(
      [realizedExit, yesterdayExit],
      positions,
      now,
    ),
    -100,
  );
});

test("cockpit snapshot helpers classify pipeline stages and attention items", () => {
  const now = new Date("2026-04-28T18:00:00.000Z");
  const deployment = {
    id: "deployment-1",
    name: "Signal Options Paper",
    mode: "paper",
    enabled: true,
    providerAccountId: "DU123",
    symbolUniverse: ["SPY", "QQQ"],
    lastEvaluatedAt: now,
    lastSignalAt: now,
    lastError: null,
    updatedAt: now,
  } as never;
  const readiness = {
    ready: true,
    reason: null,
    message: "ready",
  } as never;
  const candidates = [
    {
      id: "candidate-1",
      symbol: "SPY",
      status: "skipped",
      actionStatus: "blocked",
      syncStatus: "synced",
      reason: "spread_too_wide",
      signalAt: now.toISOString(),
      selectedContract: { strike: 510, right: "call" },
      liquidity: { spreadPctOfMid: 80 },
      timeline: [
        {
          type: "signal_options_candidate_skipped",
          occurredAt: now.toISOString(),
        },
      ],
    },
    {
      id: "candidate-2",
      symbol: "QQQ",
      status: "open",
      actionStatus: "mismatch",
      syncStatus: "event_only",
      signalAt: now.toISOString(),
      selectedContract: { strike: 430, right: "call" },
      shadowLink: null,
      timeline: [
        {
          type: SIGNAL_OPTIONS_ENTRY_EVENT,
          occurredAt: now.toISOString(),
        },
      ],
    },
  ] as never;
  const activePositions = [
    {
      id: "position-1",
      symbol: "QQQ",
      openedAt: now.toISOString(),
      entryPrice: 1,
      lastMarkPrice: 0.95,
      stopPrice: 0.85,
      quantity: 1,
      selectedContract: { multiplier: 100 },
      lastMarkedAt: now.toISOString(),
    },
  ] as never;
  const risk = {
    dailyPnl: -1250,
    maxDailyLoss: 1000,
    dailyHaltActive: true,
  };

  const stages =
    __signalOptionsAutomationInternalsForTests.buildCockpitPipeline({
      deployment,
      readiness,
      candidates,
      activePositions,
      risk,
      events: [],
    });
  const attention =
    __signalOptionsAutomationInternalsForTests.buildCockpitAttention({
      deployment,
      readiness,
      candidates,
      activePositions,
      risk,
      events: [],
    });

  assert.equal(stages.length, 8);
  assert.equal(
    stages.find((stage) => stage.id === "liquidity_risk_gate")?.status,
    "blocked",
  );
  assert.ok(
    attention.some((item) => item.id === "daily-loss-halt"),
  );
  assert.ok(
    attention.some((item) => item.id === "shadow-candidate-2"),
  );
});
