import assert from "node:assert/strict";
import test from "node:test";

import {
  __signalOptionsAutomationInternalsForTests,
  runSignalOptionsShadowBackfill,
} from "./signal-options-automation";

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
      message: "IB Gateway is connected, but the broker session is not authenticated.",
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

test("Signal Options MTF matrix symbols follow cursor, seen set, and worker cap", () => {
  const states = [
    signalState("SPY", "2026-06-08T14:20:00.000Z"),
    signalState("AAPL", "2026-06-08T14:19:00.000Z"),
    signalState("MSFT", "2026-06-08T14:18:00.000Z", "sell"),
    signalState("TSLA", "2026-06-08T14:17:00.000Z"),
  ];
  const seenSignals = new Set([
    __signalOptionsAutomationInternalsForTests.buildSignalKey(
      states[1],
      "2026-06-08T14:19:00.000Z",
    ),
  ]);

  assert.deepEqual(
    __signalOptionsAutomationInternalsForTests.selectSignalOptionsMtfMatrixSymbols({
      states,
      universe: new Set(["SPY", "AAPL", "MSFT", "TSLA"]),
      seenSignals,
      startIndex: 1,
      maxSymbols: 2,
    }),
    ["MSFT", "TSLA"],
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

test("Signal Options still rejects signals outside the one-bar execution window", () => {
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
    barsSinceSignal: 6,
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
        latestBarAt: "2026-06-11T15:35:00.000Z",
        barsSinceSignal: 6,
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
        latestBarAt: "2026-06-11T15:35:00.000Z",
        barsSinceSignal: 6,
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
