import assert from "node:assert/strict";
import test from "node:test";
import { defaultSignalOptionsExecutionProfile } from "@workspace/backtest-core";
import {
  SIGNAL_OPTIONS_ENTRY_EVENT,
  SIGNAL_OPTIONS_EXIT_EVENT,
  SIGNAL_OPTIONS_GATEWAY_BLOCKED_EVENT,
  SIGNAL_OPTIONS_MARK_EVENT,
  SIGNAL_OPTIONS_SKIPPED_EVENT,
  __signalOptionsAutomationInternalsForTests,
  buildSignalOptionsPerformanceFromInputs,
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

test("position mark quote snapshots map onto signal option quotes", () => {
  const quote =
    __signalOptionsAutomationInternalsForTests.quoteSnapshotToSignalOptionsQuote({
      contract: {
        ticker: "SMCI20260515P32",
        underlying: "SMCI",
        expirationDate: "2026-05-15",
        strike: 32,
        right: "put",
        multiplier: 100,
        sharesPerContract: 100,
        providerContractId: "old-conid",
      },
      quote: {
        symbol: "SMCI",
        price: 1.29,
        bid: 1.27,
        ask: 1.34,
        bidSize: 10,
        askSize: 12,
        change: 0,
        changePercent: 0,
        volume: 2541,
        openInterest: 12,
        impliedVolatility: 0.7,
        delta: -0.42,
        gamma: 0.03,
        theta: -0.01,
        vega: 0.04,
        updatedAt: new Date("2026-05-12T16:32:18.332Z"),
        providerContractId: "fresh-conid",
        transport: "client_portal",
        delayed: false,
        freshness: "live",
        marketDataMode: "live",
        dataUpdatedAt: new Date("2026-05-12T16:32:18.332Z"),
        ageMs: 25,
      } as never,
    });

  assert.equal(quote.contract?.providerContractId, "fresh-conid");
  assert.equal(quote.contract?.right, "put");
  assert.equal(quote.bid, 1.27);
  assert.equal(quote.ask, 1.34);
  assert.equal(quote.last, 1.29);
  assert.equal(quote.mark, 1.29);
  assert.equal(quote.quoteFreshness, "live");
  assert.equal(quote.marketDataMode, "live");
  assert.equal(quote.ageMs, 25);
});

test("active position marks record changed downside prices", () => {
  const position = {
    peakPrice: 2.55,
    stopPrice: 1.27,
    lastMarkPrice: null,
  };

  assert.equal(
    __signalOptionsAutomationInternalsForTests.shouldRecordActivePositionMark({
      position: position as never,
      peakPrice: 2.55,
      stopPrice: 1.27,
      markPrice: 2.4,
    }),
    true,
  );
  assert.equal(
    __signalOptionsAutomationInternalsForTests.shouldRecordActivePositionMark({
      position: { ...position, lastMarkPrice: 2.4 } as never,
      peakPrice: 2.55,
      stopPrice: 1.27,
      markPrice: 2.4,
    }),
    false,
  );
  assert.equal(
    __signalOptionsAutomationInternalsForTests.shouldRecordActivePositionMark({
      position: { ...position, lastMarkPrice: 2.4 } as never,
      peakPrice: 2.55,
      stopPrice: 1.27,
      markPrice: 2.39,
    }),
    true,
  );
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

test("signal-options performance filters automation trades and reports rule blockers", () => {
  const deploymentId = "11111111-1111-1111-1111-111111111111";
  const expandedProfile = {
    ...profile,
    riskCaps: {
      ...profile.riskCaps,
      maxOpenSymbols: 2,
      maxDailyLoss: 2000,
    },
  };
  const occurredAt = new Date("2026-05-12T15:00:00.000Z");
  const state = {
    activePositions: [
      {
        id: "pos-1",
        symbol: "SPY",
        lastMarkPrice: 1.4,
        premiumAtRisk: 375,
      },
      {
        id: "pos-2",
        symbol: "QQQ",
        lastMarkPrice: null,
        premiumAtRisk: 450,
      },
    ],
    risk: {
      openSymbols: 2,
      openPremium: 825,
      openUnrealizedPnl: 50,
      dailyRealizedPnl: 0,
      dailyPnl: 50,
      dailyHaltActive: false,
    },
  };
  const events = [
    {
      id: "entry-1",
      eventType: SIGNAL_OPTIONS_ENTRY_EVENT,
      symbol: "SPY",
      deploymentId,
      occurredAt,
      payload: {
        action: { brokerSubmission: false },
        candidate: {
          id: "SIGOPT-11111111-SPY-buy-1",
          deploymentId,
          symbol: "SPY",
          direction: "buy",
          optionRight: "call",
          timeframe: "15m",
          signalAt: occurredAt.toISOString(),
          signal: { filterState: { adx: 35, mtfDirections: [1, 1] } },
        },
        selectedExpiration: { dte: 1 },
        selectedContract: {
          right: "call",
          expirationDate: "2026-05-13",
          strike: 101,
          multiplier: 100,
        },
        orderPlan: {
          ok: true,
          quantity: 3,
          premiumAtRisk: 375,
          liquidity: { ok: true },
        },
      },
    },
    {
      id: "skip-1",
      eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
      symbol: "MSFT",
      deploymentId,
      occurredAt: new Date("2026-05-12T15:01:00.000Z"),
      payload: {
        reason: "max_open_symbols_reached",
      },
    },
    {
      id: "mark-1",
      eventType: SIGNAL_OPTIONS_MARK_EVENT,
      symbol: "QQQ",
      deploymentId,
      occurredAt: new Date("2026-05-12T15:02:00.000Z"),
      payload: {
        reason: "position_mark_unavailable",
      },
    },
  ];
  const performance = buildSignalOptionsPerformanceFromInputs({
    deploymentId,
    profile: expandedProfile,
    state: state as never,
    events: events as never,
    shadowPatterns: {
      context: { range: "1M" },
      tradeEvents: [
        {
          sourceType: "automation",
          strategyLabel: "Signal Options",
          candidateId: "SIGOPT-11111111-SPY-buy-1",
          deploymentId,
        },
      ],
      openLots: [
        {
          sourceType: "automation",
          strategyLabel: "Signal Options",
          candidateId: "SIGOPT-11111111-QQQ-buy-1",
          metadata: { candidate: { deploymentId } },
        },
      ],
      roundTrips: [
        {
          id: "trade-1",
          symbol: "SPY",
          assetClass: "option",
          quantity: 3,
          openDate: "2026-05-12T15:00:00.000Z",
          closeDate: "2026-05-12T16:00:00.000Z",
          avgOpen: 1.25,
          avgClose: 1.65,
          realizedPnl: 120,
          realizedPnlPercent: 32,
          fees: 2,
          holdDurationMinutes: 60,
          sourceType: "automation",
          strategyLabel: "Signal Options",
          candidateId: "SIGOPT-11111111-SPY-buy-1",
          entryMetadata: {
            candidate: { deploymentId, optionRight: "call" },
            selectedExpiration: { dte: 1 },
            selectedContract: {
              right: "call",
              expirationDate: "2026-05-13",
              strike: 101,
            },
          },
          metadata: { reason: "runner_trail_stop" },
        },
        {
          id: "manual-trade",
          symbol: "AAPL",
          realizedPnl: 999,
          sourceType: "manual",
          strategyLabel: null,
          entryMetadata: {},
          metadata: {},
        },
        {
          id: "other-deployment",
          symbol: "NVDA",
          realizedPnl: 999,
          sourceType: "automation",
          strategyLabel: "Signal Options",
          candidateId: "SIGOPT-other-NVDA-buy-1",
          entryMetadata: {
            candidate: {
              deploymentId: "22222222-2222-2222-2222-222222222222",
            },
          },
          metadata: {},
        },
      ],
    },
  });

  assert.equal(performance.summary.closedTrades, 1);
  assert.equal(performance.summary.realizedPnl, 120);
  assert.equal(performance.summary.openLots, 1);
  assert.equal(performance.openExposure.maxOpenSymbols, 2);
  assert.equal(performance.openExposure.atOpenSymbolCapacity, true);
  assert.deepEqual(performance.topBlockers[0], {
    reason: "max_open_symbols_reached",
    label: "max open symbols reached",
    count: 1,
  });
  assert.equal(
    performance.ruleAdherence.find((rule) => rule.id === "max_open_symbols")?.status,
    "warning",
  );
  assert.equal(
    performance.ruleAdherence.find((rule) => rule.id === "position_marking")?.status,
    "warning",
  );
  assert.equal(performance.recentClosedTrades[0]?.symbol, "SPY");
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

test("signal-options scan requests a bounded strike window for selected slots", () => {
  const strikesAroundMoney =
    __signalOptionsAutomationInternalsForTests.signalOptionsStrikesAroundMoney;

  assert.equal(
    strikesAroundMoney({ profile, optionRight: "put" }),
    1,
  );
  assert.equal(
    strikesAroundMoney({ profile, optionRight: "call" }),
    1,
  );
  assert.equal(
    strikesAroundMoney({
      profile: {
        ...profile,
        optionSelection: {
          ...profile.optionSelection,
          putStrikeSlot: 0,
          callStrikeSlot: 5,
        },
      },
      optionRight: "put",
    }),
    3,
  );
  assert.equal(
    strikesAroundMoney({
      profile: {
        ...profile,
        optionSelection: {
          ...profile.optionSelection,
          putStrikeSlot: 0,
          callStrikeSlot: 5,
        },
      },
      optionRight: "call",
    }),
    3,
  );
});

test("seen signal keys allow retries after transient option-chain skips", () => {
  const signalKey = "profile:SPY:15m:sell:2026-05-12T15:00:00.000Z";
  const seenSignalKeys =
    __signalOptionsAutomationInternalsForTests.seenSignalKeys;

  assert.deepEqual(
    Array.from(
      seenSignalKeys([
        {
          eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
          payload: {
            signalKey,
            reason: "no_contract_for_strike_slot",
            chainDebug: {
              reason: "options_upstream_failure",
            },
          },
        },
      ] as never),
    ),
    [],
  );
  assert.deepEqual(
    Array.from(
      seenSignalKeys([
        {
          eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
          payload: {
            signalKey,
            reason: "bear_regime_gate_failed",
            entryGate: {
              reasons: ["adx_below_minimum"],
            },
          },
        },
      ] as never),
    ),
    [signalKey],
  );
  assert.deepEqual(
    Array.from(
      seenSignalKeys([
        {
          eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
          payload: {
            signalKey,
            reason: "no_expiration_in_dte_window",
            expirationsDebug: {
              reason: "options_backoff",
            },
          },
        },
        {
          eventType: SIGNAL_OPTIONS_ENTRY_EVENT,
          payload: { signalKey },
        },
      ] as never),
    ),
    [signalKey],
  );
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
  };
  const candidate =
    __signalOptionsAutomationInternalsForTests.buildCandidateFromSignal({
      deployment: {
        id: "deployment-123456789",
        name: "Shadow Options",
      } as never,
      state: state as never,
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

test("fresh signal snapshots create potential shadow action candidates", () => {
  const signalAt = "2026-04-28T15:30:00.000Z";
  const deployment = {
    id: "deployment-123456789",
    name: "Shadow Options",
  } as never;
  const baseSignal = {
    profileId: "11111111-1111-1111-1111-111111111111",
    signalKey: "profile:SPY:15m:buy:2026-04-28T15:30:00.000Z",
    source: "rayreplica",
    eventId: null,
    symbol: "spy",
    timeframe: "15m",
    direction: "buy",
    signalAt,
    signalPrice: 508.25,
    latestBarAt: "2026-04-28T15:45:00.000Z",
    barsSinceSignal: 1,
    fresh: true,
    status: "ok",
    filterState: { mtf: "aligned" },
  };

  const buyCandidate =
    __signalOptionsAutomationInternalsForTests.candidateFromSignalSnapshot({
      deployment,
      signal: baseSignal as never,
    });
  const sellCandidate =
    __signalOptionsAutomationInternalsForTests.candidateFromSignalSnapshot({
      deployment,
      signal: {
        ...baseSignal,
        signalKey: "profile:QQQ:15m:sell:2026-04-28T15:30:00.000Z",
        symbol: "qqq",
        direction: "sell",
      } as never,
    });
  const staleCandidate =
    __signalOptionsAutomationInternalsForTests.candidateFromSignalSnapshot({
      deployment,
      signal: {
        ...baseSignal,
        fresh: false,
      } as never,
    });

  assert.ok(buyCandidate);
  assert.equal(buyCandidate.symbol, "SPY");
  assert.equal(buyCandidate.status, "candidate");
  assert.equal(buyCandidate.optionRight, "call");
  assert.equal(buyCandidate.action?.optionAction, "buy_call");
  assert.equal(buyCandidate.action?.executionMode, "shadow");
  assert.equal(buyCandidate.selectedContract, null);
  assert.equal(buyCandidate.reason, null);
  assert.ok(sellCandidate);
  assert.equal(sellCandidate.optionRight, "put");
  assert.equal(sellCandidate.action?.optionAction, "buy_put");
  assert.equal(staleCandidate, null);
});

test("scan events override matching live signal previews without losing mappings", () => {
  const signalAt = "2026-04-28T15:30:00.000Z";
  const deployment = {
    id: "deployment-123456789",
    name: "Shadow Options",
  } as never;
  const preview =
    __signalOptionsAutomationInternalsForTests.candidateFromSignalSnapshot({
      deployment,
      signal: {
        profileId: "11111111-1111-1111-1111-111111111111",
        signalKey: "profile:SPY:15m:buy:2026-04-28T15:30:00.000Z",
        source: "rayreplica",
        eventId: null,
        symbol: "SPY",
        timeframe: "15m",
        direction: "buy",
        signalAt,
        signalPrice: 508.25,
        latestBarAt: "2026-04-28T15:45:00.000Z",
        barsSinceSignal: 1,
        fresh: true,
        status: "ok",
        filterState: null,
      } as never,
    });
  assert.ok(preview);

  const eventCandidate =
    __signalOptionsAutomationInternalsForTests.candidateFromEvent({
      id: "event-1",
      deploymentId: "deployment-123456789",
      symbol: "SPY",
      eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
      occurredAt: new Date("2026-04-28T15:31:00.000Z"),
      payload: {
        candidate: {
          id: preview.id,
          deploymentId: "deployment-123456789",
          deploymentName: "Shadow Options",
          symbol: "SPY",
          direction: "buy",
          optionRight: "call",
          timeframe: "15m",
          signalAt,
          signalPrice: 508.25,
        },
        selectedContract: {
          ticker: "SPY260429C510",
          strike: 510,
          right: "call",
        },
        reason: "spread_too_wide",
      },
    } as never);
  assert.ok(eventCandidate);

  const merged =
    __signalOptionsAutomationInternalsForTests.mergeSignalOptionsCandidate(
      preview,
      eventCandidate,
    );

  assert.equal(eventCandidate.id, preview.id);
  assert.equal(merged.id, preview.id);
  assert.equal(merged.status, "skipped");
  assert.equal(merged.reason, "spread_too_wide");
  assert.deepEqual(merged.selectedContract, {
    ticker: "SPY260429C510",
    strike: 510,
    right: "call",
  });
  assert.equal(merged.action?.optionAction, "buy_call");
  assert.equal(merged.signal?.signalKey, preview.signal?.signalKey);
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
    {
      entryPrice: 4,
      lastMarkPrice: null,
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
    {
      id: "candidate-3",
      symbol: "SPY",
      status: "candidate",
      actionStatus: "candidate",
      syncStatus: "synced",
      signalAt: now.toISOString(),
      action: { optionAction: "buy_call", executionMode: "shadow" },
      selectedContract: null,
      timeline: [],
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
  assert.equal(
    stages.find((stage) => stage.id === "action_mapped")?.count,
    1,
  );
  assert.ok(
    attention.some((item) => item.id === "daily-loss-halt"),
  );
  assert.ok(
    attention.some((item) => item.id === "shadow-candidate-2"),
  );
});

test("cockpit diagnostics summarize trade blockers and signal freshness", () => {
  const now = new Date("2026-04-28T18:00:00.000Z");
  const events = [
    {
      eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
      occurredAt: new Date("2026-04-28T17:55:00.000Z"),
      payload: {
        reason: "bear_regime_gate_failed",
        entryGate: {
          reasons: ["adx_below_minimum", "mtf_fully_bullish"],
        },
      },
    },
    {
      eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
      occurredAt: new Date("2026-04-28T17:56:00.000Z"),
      payload: {
        reason: "no_contract_for_strike_slot",
        chainDebug: {
          reason: "options_upstream_failure",
        },
      },
    },
    {
      eventType: SIGNAL_OPTIONS_GATEWAY_BLOCKED_EVENT,
      occurredAt: new Date("2026-04-28T17:57:00.000Z"),
      payload: {
        reason: "ibkr_not_configured",
      },
    },
    {
      eventType: SIGNAL_OPTIONS_ENTRY_EVENT,
      occurredAt: now,
      payload: {},
    },
  ] as never;
  const signals = [
    {
      symbol: "SPY",
      direction: "sell",
      fresh: true,
      status: "ok",
    },
    {
      symbol: "QQQ",
      direction: null,
      fresh: false,
      status: "stale",
    },
  ] as never;
  const candidates = [
    {
      id: "candidate-1",
      status: "skipped",
      actionStatus: "blocked",
      selectedContract: null,
    },
    {
      id: "candidate-2",
      status: "open",
      actionStatus: "ready",
      selectedContract: { strike: 510 },
    },
  ] as never;

  const diagnostics =
    __signalOptionsAutomationInternalsForTests.buildCockpitDiagnostics({
      signals,
      candidates,
      activePositions: [{}] as never,
      events,
    });

  assert.equal(diagnostics.eventWindow.total, 4);
  assert.equal(diagnostics.tradePath.blockedCandidates, 1);
  assert.equal(diagnostics.tradePath.contractsSelected, 1);
  assert.equal(diagnostics.tradePath.shadowFilledCandidates, 1);
  assert.equal(diagnostics.tradePath.entryEvents, 1);
  assert.equal(diagnostics.tradePath.gatewayBlocks, 1);
  assert.equal(diagnostics.signalFreshness.fresh, 1);
  assert.equal(diagnostics.signalFreshness.notFresh, 1);
  assert.equal(diagnostics.signalFreshness.withoutDirection, 1);
  assert.equal(diagnostics.skipReasons.bear_regime_gate_failed, 1);
  assert.equal(diagnostics.skipReasons.ibkr_not_configured, 1);
  assert.equal(diagnostics.entryGateReasons.mtf_fully_bullish, 1);
  assert.equal(diagnostics.optionChainReasons.options_upstream_failure, 1);
});
