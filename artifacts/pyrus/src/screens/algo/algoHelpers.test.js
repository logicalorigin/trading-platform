import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DEFAULT_STRATEGY_SIGNAL_SETTINGS,
  PROFILE_BOOLEAN_FIELDS,
  PROFILE_NUMBER_FIELDS,
  SIGNAL_OPTIONS_AGGRESSIVE_PROGRESSIVE_TRAIL_STEPS,
  SIGNAL_OPTIONS_DEFAULT_PROFILE,
  SIGNAL_OPTIONS_HALT_CONTROL_GROUPS,
  candidateBlockerLabel,
  candidateLatestActivityLabel,
  deriveSignalOptionsHaltControlStatus,
  entryQualityLabel,
  formatCompactMetric,
  formatContractDetail,
  formatContractProviderLabel,
  formatContractSelectionSummary,
  formatDteLabel,
  findSignalOptionsCandidateForSignal,
  formatQuoteGreeksSummary,
  formatQuoteSummary,
  formatProgressiveTrailSteps,
  mergeOptionQuoteSnapshot,
  mergeSignalOptionsProfile,
  optionProviderContractId,
  parseProgressiveTrailSteps,
  resolveCandidateGateDisplay,
  resolveCandidateSyncDisplay,
  resolveSignalAge,
  resolveSignalMove,
  resolveSignalScoreBreakdown,
  resolveStrategySignalSettings,
  signalOptionsHaltControlsChanged,
} from "./algoHelpers";
import {
  buildAlgoAccountPositionRows,
  buildAlgoAccountPositionsResponse,
  collectAlgoRuntimeProviderContractIds,
  filterAccountPositionRowsForDeployment,
  filterAccountPositionRowsForRuntimePositions,
  mergeAlgoRuntimeAndAccountPositionRows,
} from "./algoAccountPositions";
import {
  COMPACT_HALT_SETTING_PAIRS,
  COMPACT_HALT_STANDALONE_SETTINGS,
  SETTINGS_SECTIONS,
  allSettingFields,
  getCompactHaltSettingField,
  getCompactHaltStandaloneFields,
} from "./algoSettingsFields";
import { saveAllAlgoAdjustments } from "./saveAllAlgoAdjustments";
import { __internalsForTests as draftInternals } from "./useServerSyncedDraft";

test("algo profile defaults match the tuned h8 signal-options profile", () => {
  assert.equal(DEFAULT_STRATEGY_SIGNAL_SETTINGS.signalTimeframe, "5m");
  assert.equal(DEFAULT_STRATEGY_SIGNAL_SETTINGS.timeHorizon, 8);
  assert.equal(DEFAULT_STRATEGY_SIGNAL_SETTINGS.bosConfirmation, "wicks");
  assert.equal(DEFAULT_STRATEGY_SIGNAL_SETTINGS.chochAtrBuffer, 0);
  assert.equal(SIGNAL_OPTIONS_DEFAULT_PROFILE.riskCaps.maxOpenSymbols, 10);
  assert.equal(
    SIGNAL_OPTIONS_DEFAULT_PROFILE.riskCaps.maxPremiumPerEntry,
    1500,
  );
  assert.deepEqual(
    {
      hardStopPct: SIGNAL_OPTIONS_DEFAULT_PROFILE.exitPolicy.hardStopPct,
      trailActivationPct:
        SIGNAL_OPTIONS_DEFAULT_PROFILE.exitPolicy.trailActivationPct,
      minLockedGainPct:
        SIGNAL_OPTIONS_DEFAULT_PROFILE.exitPolicy.minLockedGainPct,
      trailGivebackPct:
        SIGNAL_OPTIONS_DEFAULT_PROFILE.exitPolicy.trailGivebackPct,
      tightenAtFiveXGivebackPct:
        SIGNAL_OPTIONS_DEFAULT_PROFILE.exitPolicy.tightenAtFiveXGivebackPct,
      tightenAtTenXGivebackPct:
        SIGNAL_OPTIONS_DEFAULT_PROFILE.exitPolicy.tightenAtTenXGivebackPct,
      progressiveTrailEnabled:
        SIGNAL_OPTIONS_DEFAULT_PROFILE.exitPolicy.progressiveTrailEnabled,
      progressiveTrailSteps:
        SIGNAL_OPTIONS_DEFAULT_PROFILE.exitPolicy.progressiveTrailSteps,
      overnightExitEnabled:
        SIGNAL_OPTIONS_DEFAULT_PROFILE.exitPolicy.overnightExitEnabled,
      overnightMinGainPct:
        SIGNAL_OPTIONS_DEFAULT_PROFILE.exitPolicy.overnightMinGainPct,
      overnightRunnerGivebackPct:
        SIGNAL_OPTIONS_DEFAULT_PROFILE.exitPolicy.overnightRunnerGivebackPct,
      earlyExitBars: SIGNAL_OPTIONS_DEFAULT_PROFILE.exitPolicy.earlyExitBars,
      earlyExitLossPct:
        SIGNAL_OPTIONS_DEFAULT_PROFILE.exitPolicy.earlyExitLossPct,
    },
    {
      hardStopPct: -30,
      trailActivationPct: 35,
      minLockedGainPct: 15,
      trailGivebackPct: 20,
      tightenAtFiveXGivebackPct: 30,
      tightenAtTenXGivebackPct: 15,
      progressiveTrailEnabled: true,
      progressiveTrailSteps: SIGNAL_OPTIONS_AGGRESSIVE_PROGRESSIVE_TRAIL_STEPS,
      overnightExitEnabled: true,
      overnightMinGainPct: 10,
      overnightRunnerGivebackPct: 15,
      earlyExitBars: 8,
      earlyExitLossPct: 25,
    },
  );
  assert.deepEqual(SIGNAL_OPTIONS_DEFAULT_PROFILE.riskHaltControls, {
    dailyLossHaltEnabled: true,
    openSymbolCapEnabled: true,
    premiumBudgetEnabled: true,
  });
  assert.equal(
    SIGNAL_OPTIONS_DEFAULT_PROFILE.positionHaltControls.positionMarkFeedHaltEnabled,
    true,
  );
});

test("strategy settings resolve expanded Pyrus Signals settings from profile first", () => {
  const settings = resolveStrategySignalSettings(
    {
      config: {
        parameters: {
          signalTimeframe: "15m",
          timeHorizon: 12,
          bosConfirmation: "close",
        },
      },
    },
    {
      timeframe: "5m",
      pyrusSignalsSettings: {
        timeHorizon: 8,
        bosConfirmation: "wicks",
        chochAtrBuffer: 0.25,
        chochBodyExpansionAtr: 1.5,
        chochVolumeGate: 1.2,
      },
    },
  );

  assert.deepEqual(settings, {
    signalTimeframe: "5m",
    timeHorizon: 8,
    bosConfirmation: "wicks",
    chochAtrBuffer: 0.25,
    chochBodyExpansionAtr: 1.5,
    chochVolumeGate: 1.2,
  });
});

test("profile merge preserves tuned early and overnight defaults", () => {
  const profile = mergeSignalOptionsProfile({
    parameters: { executionMode: "signal_options" },
    signalOptions: {
      exitPolicy: {
        hardStopPct: -35,
      },
    },
  });

  assert.equal(profile.exitPolicy.hardStopPct, -35);
  assert.equal(profile.exitPolicy.earlyExitBars, 8);
  assert.equal(profile.exitPolicy.earlyExitLossPct, 25);
  assert.equal(profile.exitPolicy.overnightExitEnabled, true);
  assert.equal(profile.exitPolicy.overnightMinGainPct, 10);
  assert.equal(profile.exitPolicy.trailActivationPct, 35);
  assert.equal(profile.exitPolicy.minLockedGainPct, 15);
  assert.equal(profile.exitPolicy.trailGivebackPct, 20);
  assert.equal(profile.exitPolicy.tightenAtFiveXGivebackPct, 30);
  assert.equal(profile.exitPolicy.tightenAtTenXGivebackPct, 15);
  assert.equal(profile.exitPolicy.progressiveTrailEnabled, true);
  assert.deepEqual(
    profile.exitPolicy.progressiveTrailSteps,
    SIGNAL_OPTIONS_AGGRESSIVE_PROGRESSIVE_TRAIL_STEPS,
  );
  assert.equal(profile.exitPolicy.conditionalQualityExitsEnabled, false);
  assert.equal(profile.exitPolicy.lowQualityEarlyExitBars, 4);
  assert.equal(profile.exitPolicy.lowQualityEarlyExitLossPct, 15);
  assert.equal(profile.exitPolicy.highQualityEarlyExitBars, 8);
  assert.equal(profile.exitPolicy.highQualityEarlyExitLossPct, 25);
  assert.equal(profile.exitPolicy.weakLiquidityTrailGivebackPct, 15);
  assert.equal(profile.exitPolicy.strongLiquidityTrailGivebackPct, 25);
  assert.equal(profile.exitPolicy.highQualityOvernightMinGainPct, -100);
  assert.equal(profile.positionHaltControls.positionMarkFeedHaltEnabled, true);
  assert.equal(profile.infrastructureHaltControls.gatewayReadinessBlockEnabled, true);
});

test("progressive trail ladder text round-trips through settings helpers", () => {
  const text = formatProgressiveTrailSteps(
    SIGNAL_OPTIONS_AGGRESSIVE_PROGRESSIVE_TRAIL_STEPS,
  );

  assert.equal(text, "20/0/30, 30/15/25, 45/25/20, 65/40/20, 100/60/15");
  assert.deepEqual(
    parseProgressiveTrailSteps("45/25/20, 20/0/30"),
    [
      { activationPct: 20, minLockedGainPct: 0, givebackPct: 30 },
      { activationPct: 45, minLockedGainPct: 25, givebackPct: 20 },
    ],
  );
});

test("algo halt control helpers detect dirty controls and active states", () => {
  const dailyLossControl = SIGNAL_OPTIONS_HALT_CONTROL_GROUPS[0].controls[0];
  const gatewayControl = SIGNAL_OPTIONS_HALT_CONTROL_GROUPS.find(
    (group) => group.id === "infrastructure",
  ).controls[0];
  const draft = mergeSignalOptionsProfile({
    signalOptions: {
      riskHaltControls: {
        dailyLossHaltEnabled: false,
      },
    },
  });

  assert.equal(signalOptionsHaltControlsChanged(draft, SIGNAL_OPTIONS_DEFAULT_PROFILE), true);
  assert.deepEqual(
    deriveSignalOptionsHaltControlStatus({
      control: dailyLossControl,
      profile: SIGNAL_OPTIONS_DEFAULT_PROFILE,
      cockpit: { risk: { dailyHaltActive: true } },
    }),
    { state: "active", label: "ACTIVE", reasonCount: 0 },
  );
  assert.equal(
    deriveSignalOptionsHaltControlStatus({
      control: gatewayControl,
      profile: {
        ...SIGNAL_OPTIONS_DEFAULT_PROFILE,
        infrastructureHaltControls: {
          ...SIGNAL_OPTIONS_DEFAULT_PROFILE.infrastructureHaltControls,
          gatewayReadinessBlockEnabled: false,
        },
      },
      cockpit: { readiness: { ready: false } },
    }).state,
    "forced",
  );
});

test("server-synced draft model keeps dirty local edits across stale refreshes", () => {
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const isEqual = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const baseline = { profile: { riskCaps: { maxOpenSymbols: 5 } } };
  const dirtyDraft = { profile: { riskCaps: { maxOpenSymbols: 12 } } };

  assert.deepEqual(
    draftInternals.createServerSyncedDraftState({
      draft: dirtyDraft,
      baseline,
      serverValue: baseline,
      syncChanged: false,
      clone,
      isEqual,
    }).draft,
    dirtyDraft,
  );

  const switched = draftInternals.createServerSyncedDraftState({
    draft: dirtyDraft,
    baseline,
    serverValue: { profile: { riskCaps: { maxOpenSymbols: 3 } } },
    syncChanged: true,
    clone,
    isEqual,
  });
  assert.equal(switched.draft.profile.riskCaps.maxOpenSymbols, 3);
  assert.deepEqual(switched.draft, switched.baseline);
});

test("unified algo save fans out only dirty slices and reports partial failure", async () => {
  const calls = [];
  const profileMutation = {
    mutateAsync: async (payload) => {
      calls.push(["profile", payload]);
      return { profile: payload.data };
    },
  };
  const strategyMutation = {
    mutateAsync: async (payload) => {
      calls.push(["strategy", payload]);
      throw new Error("strategy failed");
    },
  };
  const failures = [];

  const result = await saveAllAlgoAdjustments({
    deploymentId: "dep-1",
    profileDraft: SIGNAL_OPTIONS_DEFAULT_PROFILE,
    strategySettingsDraft: {
      ...DEFAULT_STRATEGY_SIGNAL_SETTINGS,
      timeHorizon: 99,
    },
    profileDirty: true,
    strategyDirty: true,
    updateProfileMutation: profileMutation,
    updateStrategySettingsMutation: strategyMutation,
    onPartialFailure: (payload) => failures.push(payload),
  });

  assert.equal(result.ok, false);
  assert.equal(result.failures[0].section, "Signal");
  assert.equal(calls.length, 2);
  assert.equal(calls[0][1].silent, true);
  assert.equal(calls[1][1].data.timeHorizon, 50);
  assert.equal(failures.length, 1);
});

test("algo row helpers summarize blocker, timeline, and entry quality fields", () => {
  assert.equal(
    candidateBlockerLabel({ reason: "spread_too_wide" }),
    "Spread Too Wide",
  );
  assert.equal(candidateBlockerLabel({}), "—");
  assert.equal(
    candidateLatestActivityLabel({
      timeline: [
        {
          type: "signal_options_candidate",
          summary: "SPY candidate resolved",
        },
        {
          type: "signal_options_entry",
          summary: "SPY shadow CALL filled",
        },
      ],
    }),
    "SPY shadow CALL filled",
  );
  assert.equal(
    candidateLatestActivityLabel({
      timeline: [{ type: "signal_options_skipped" }],
    }),
    "Signal Options Skipped",
  );
  assert.equal(
    entryQualityLabel({ tier: "high", score: 87.234 }),
    "High · 87.2",
  );
});

test("algo signal enrichment derives counters scoring gates and sync", () => {
  const signal = {
    symbol: "SPY",
    direction: "buy",
    signalAt: "2026-05-21T14:00:00.000Z",
    signalPrice: 500,
    barsSinceSignal: 1,
    freshWindowBars: 4,
    fresh: true,
    filterState: {
      mtfDirections: [1, 1, 1],
      adx: 31,
    },
  };
  const candidate = {
    status: "open",
    actionStatus: "shadow_filled",
    syncStatus: "synced",
    signal,
    orderPlan: {
      premiumAtRisk: 240,
      liquidity: { spreadPctOfMid: 12 },
    },
    quote: { marketDataMode: "live" },
    shadowLink: {
      orderId: "order-1",
      fillId: "fill-1",
      positionId: "position-1",
      attributionStatus: "attributed",
    },
  };

  assert.deepEqual(
    resolveSignalAge(signal, { now: Date.parse("2026-05-21T14:30:00.000Z") }),
    {
      signalAt: "2026-05-21T14:00:00.000Z",
      barsSinceSignal: 1,
      freshWindowBars: 4,
      freshnessPct: 75,
      label: "1/4 bars",
      detail: "30m since signal",
    },
  );

  assert.deepEqual(resolveSignalMove(signal, { price: 510 }), {
    value: 10,
    pct: 2,
    label: "+10.00",
    detail: "+2.0% since signal",
  });

  const score = resolveSignalScoreBreakdown({ signal, candidate });
  assert.equal(score.tier, "high");
  assert.equal(score.score, 95);
  assert.deepEqual(score.reasonLabels.slice(0, 3), [
    "MTF Full Alignment",
    "Fresh Signal",
    "ADX Confirmed",
  ]);

  assert.equal(resolveCandidateGateDisplay(candidate).label, "Gate clear");
  assert.equal(resolveCandidateSyncDisplay(candidate).label, "Synced");
  assert.equal(
    resolveCandidateGateDisplay({ reason: "spread_too_wide" }).category,
    "liquidity",
  );
  assert.equal(
    resolveCandidateGateDisplay({ reason: "market_session_quiet" }).category,
    "gateway",
  );
});

test("signal quality score overrides raw signal score", () => {
  const score = resolveSignalScoreBreakdown({
    signal: {
      symbol: "SPY",
      score: 12,
      filterState: {
        mtfDirections: [-1, -1, -1],
      },
    },
    candidate: {
      signalQuality: {
        tier: "high",
        score: 88.4,
        liquidityTier: "strong",
        reasons: ["mtf_full_alignment", "risk_sized"],
      },
    },
  });

  assert.equal(score.score, 88.4);
  assert.equal(score.tier, "high");
  assert.equal(score.label, "High · 88.4");
  assert.deepEqual(score.reasonLabels, ["MTF Full Alignment", "Risk Sized"]);
});

test("signal rows match candidates by key and signal identity fallback", () => {
  const keyedCandidate = {
    id: "cand-1",
    signal: { signalKey: " SPY:5m:buy:001 " },
    selectedContract: { ticker: "SPY keyed" },
  };
  const fallbackCandidate = {
    id: "cand-2",
    symbol: "QQQ",
    timeframe: "15m",
    direction: "sell",
    selectedContract: { ticker: "QQQ fallback" },
  };
  const mismatchCandidate = {
    id: "cand-3",
    symbol: "QQQ",
    timeframe: "15m",
    direction: "buy",
  };

  assert.equal(
    findSignalOptionsCandidateForSignal(
      [mismatchCandidate, keyedCandidate, fallbackCandidate],
      { signalKey: "SPY:5m:buy:001", symbol: "SPY" },
    ),
    keyedCandidate,
  );
  assert.equal(
    findSignalOptionsCandidateForSignal(
      [mismatchCandidate, fallbackCandidate],
      { symbol: "qqq", timeframe: "15m", direction: "SELL" },
    ),
    fallbackCandidate,
  );
  assert.equal(
    findSignalOptionsCandidateForSignal([fallbackCandidate], {
      symbol: "QQQ",
      timeframe: "15m",
      direction: "buy",
    }),
    null,
  );
});

test("algo contract and quote helpers expose contract identity and live quote detail", () => {
  const now = new Date("2026-05-19T14:30:00Z");
  const contract = {
    ticker: "SPY 20260522C700",
    underlying: "SPY",
    expirationDate: "2026-05-22",
    strike: 700,
    right: "call",
    multiplier: 100,
    providerContractId: "12345678901234567890",
  };
  const quote = {
    bid: 1.2,
    ask: 1.4,
    mark: 1.31,
    last: 1.29,
    impliedVolatility: 0.315,
    delta: 0.42,
    gamma: 0.0123,
    theta: -0.0412,
    vega: 0.0831,
    openInterest: 1200,
    volume: 98765,
    quoteFreshness: "live",
    marketDataMode: "live",
  };
  const liquidity = {
    mid: 1.3,
    spreadPctOfMid: 15.4,
  };

  assert.equal(formatDteLabel(contract.expirationDate, now), "3DTE");
  assert.equal(
    formatContractProviderLabel(contract),
    "conid 12345678...567890",
  );
  assert.deepEqual(formatContractDetail(contract, { now }), {
    main: "05/22 700C",
    detail: "3DTE · x100 · conid 12345678...567890",
  });
  assert.deepEqual(formatQuoteSummary(quote, liquidity), {
    main: "$1.20 / $1.40",
    detail: "mid $1.30 · mark $1.31 · spr 15.4% · Live",
  });
  assert.deepEqual(formatQuoteGreeksSummary(quote), {
    main: "d 0.42 / IV 31.5%",
    detail: "OI 1.2K / Vol 99K",
    full: "g 0.012 / th -0.041 / v 0.083",
  });
  assert.equal(formatCompactMetric(2500000), "2.5M");
});

test("algo contract helpers degrade cleanly for missing fields and selection fallback", () => {
  assert.deepEqual(formatContractDetail(null), {
    main: "—",
    detail: "—",
  });
  assert.deepEqual(formatQuoteSummary({}, {}), {
    main: "—",
    detail: "—",
  });
  assert.deepEqual(formatQuoteGreeksSummary({}), {
    main: "—",
    detail: "—",
    full: "—",
  });
  assert.deepEqual(
    formatContractSelectionSummary({
      preferredSlot: 3,
      selectedSlot: 4,
      fallbackUsed: true,
      attempts: [
        { slot: 3, reason: "no_contract_for_strike_slot" },
        { slot: 4, reason: null },
      ],
    }),
    {
      main: "selected slot 4 · preferred 3",
      detail: "fallback used · 2 attempts · No Contract For Strike Slot",
    },
  );
});

test("algo quote helpers merge live option snapshots over static candidate quotes", () => {
  const merged = mergeOptionQuoteSnapshot(
    {
      bid: 1.1,
      ask: 1.3,
      last: 1.2,
      delta: 0.31,
      quoteFreshness: "metadata",
    },
    {
      bid: 0,
      ask: 1.28,
      price: 1.25,
      delta: 0.36,
      openInterest: 3200,
      freshness: "live",
      marketDataMode: "live",
      updatedAt: "2026-05-19T14:35:00.000Z",
    },
  );

  assert.equal(merged.bid, 1.1);
  assert.equal(merged.ask, 1.28);
  assert.equal(merged.last, 1.25);
  assert.equal(merged.mark, 1.25);
  assert.equal(merged.delta, 0.36);
  assert.equal(merged.openInterest, 3200);
  assert.equal(merged.quoteFreshness, "live");
  assert.equal(merged.quoteUpdatedAt, "2026-05-19T14:35:00.000Z");
  assert.equal(optionProviderContractId({ providerContractId: " conid-1 " }), "conid-1");
});

test("algo positions adapt to the account positions row contract with live option marks", () => {
  const rows = buildAlgoAccountPositionRows({
    positions: [
      {
        id: "pos-1",
        candidateId: "cand-1",
        symbol: "SPY",
        quantity: 2,
        entryPrice: 1.1,
        openedAt: "2026-05-21T14:33:00.000Z",
        signalAt: "2026-05-21T14:30:00.000Z",
        lastMarkPrice: 1.2,
        premiumAtRisk: 220,
        signalQuality: {
          tier: "high",
          score: 88.5,
          reasons: ["fresh_signal", "strong_liquidity"],
        },
        selectedContract: {
          ticker:
            "twsopt:eyJ2IjoxLCJ1IjoiU1BZIiwiZSI6IjIwMjYwNTIyIiwicyI6NzAwLCJyIjoiQyJ9",
          localSymbol: "SPY  260522C00700000",
          underlying: "SPY",
          expirationDate: "2026-05-22",
          strike: 700,
          right: "call",
          multiplier: 100,
          providerContractId: "conid-1",
        },
      },
    ],
    symbolIndex: {
      SPY: {
        signal: { score: 91.2, signalPrice: 504.12, barsSinceSignal: 2 },
        candidate: {
          quote: { bid: 1.05, ask: 1.2, delta: 0.4 },
          liquidity: { mid: 1.125, spreadPctOfMid: 13.3 },
        },
      },
    },
    liveQuoteByContractId: {
      "conid-1": {
        bid: 1.3,
        ask: 1.5,
        price: 1.4,
        delta: 0.45,
        freshness: "live",
      },
    },
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].symbol, "SPY");
  assert.equal(rows[0].assetClass, "Options");
  assert.equal(rows[0].sourceType, "automation");
  assert.equal(rows[0].optionContract.ticker, "SPY  260522C00700000");
  assert.equal(rows[0].optionContract.expirationDate, "2026-05-22");
  assert.equal(rows[0].optionQuote.bid, 1.3);
  assert.equal(rows[0].optionQuote.ask, 1.5);
  assert.equal(rows[0].mark, 1.4);
  assert.equal(rows[0].marketValue, 280);
  assert.equal(rows[0].unrealizedPnl, 59.99999999999997);
  assert.equal(rows[0].underlyingMarket.price, 504.12);
  assert.equal(rows[0].automationContext.purchasedAt, "2026-05-21T14:33:00.000Z");
  assert.equal(rows[0].automationContext.signalAt, "2026-05-21T14:30:00.000Z");
  assert.equal(rows[0].automationContext.barsSinceSignal, 2);
  assert.equal(rows[0].automationContext.signalScore, 88.5);
  assert.deepEqual(rows[0].automationContext.signalReasons, [
    "fresh_signal",
    "strong_liquidity",
  ]);

  const response = buildAlgoAccountPositionsResponse(rows);
  assert.equal(response.totals.netExposure, 280);
  assert.equal(response.totals.unrealizedPnl, 59.99999999999997);
  assert.equal(response.totals.weightPercent, 100);
});

test("same-day algo position rows keep day P&L aligned with unrealized P&L", () => {
  const openedAt = new Date().toISOString();
  const rows = buildAlgoAccountPositionRows({
    positions: [
      {
        id: "pos-same-day",
        symbol: "SPY",
        quantity: 1,
        entryPrice: 1,
        openedAt,
        selectedContract: {
          localSymbol: "SPY  260522C00500000",
          underlying: "SPY",
          expirationDate: "2026-05-22",
          strike: 500,
          right: "call",
          multiplier: 100,
          providerContractId: "conid-same-day",
        },
      },
    ],
    symbolIndex: {
      SPY: {
        signal: { signalPrice: 500 },
        candidate: {
          quote: { bid: 1, ask: 1.2, change: 0.02, changePercent: 1.8 },
        },
      },
    },
    liveQuoteByContractId: {
      "conid-same-day": {
        bid: 1.45,
        ask: 1.55,
        price: 1.5,
        change: 0.05,
        changePercent: 3.45,
      },
    },
  });

  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].unrealizedPnl.toFixed(2)), 50);
  assert.equal(Number(rows[0].dayChange.toFixed(2)), 50);
  assert.equal(Number(rows[0].dayChangePercent.toFixed(2)), 50);
});

test("algo account ledger rows can be scoped to the focused deployment without runtime churn", () => {
  const runtimePositions = [
    {
      symbol: "TSLA",
      selectedContract: { providerContractId: "tsla-contract" },
    },
    {
      symbol: "TLT",
      selectedContract: { providerContractId: "tlt-contract" },
    },
  ];
  const accountRows = [
    {
      symbol: "TSLA",
      optionContract: { providerContractId: "tsla-contract" },
      sourceAttribution: [{ deploymentId: "focused-deployment" }],
    },
    {
      symbol: "TLT",
      optionContract: { providerContractId: "tlt-contract" },
      sourceAttribution: [{ deploymentId: "focused-deployment" }],
    },
    {
      symbol: "AAPL",
      optionContract: { providerContractId: "aapl-contract" },
      sourceAttribution: [{ deploymentId: "other-deployment" }],
    },
    {
      symbol: "NVDA",
      optionContract: { providerContractId: "replay-contract" },
      sourceAttribution: [
        {
          sourceType: "signal_options_replay",
          deploymentId: "focused-deployment",
        },
      ],
    },
  ];

  assert.deepEqual(
    collectAlgoRuntimeProviderContractIds(runtimePositions),
    ["tsla-contract", "tlt-contract"],
  );
  assert.deepEqual(
    filterAccountPositionRowsForRuntimePositions({
      rows: accountRows,
      positions: runtimePositions,
      deploymentId: "focused-deployment",
    }).map((row) => row.symbol),
    ["TSLA", "TLT"],
  );
  assert.deepEqual(
    filterAccountPositionRowsForDeployment({
      rows: accountRows,
      deploymentId: "focused-deployment",
    }).map((row) => row.symbol),
    ["TSLA", "TLT", "NVDA"],
  );
});

test("algo runtime positions borrow shadow projection quotes without changing membership", () => {
  const runtimeRows = buildAlgoAccountPositionRows({
    positions: [
      {
        id: "runtime-hut",
        candidateId: "candidate-hut",
        symbol: "HUT",
        quantity: 1,
        entryPrice: 7.7,
        underlyingPrice: 10.12,
        underlyingBid: 0,
        underlyingAsk: 0,
        selectedContract: {
          ticker: "O:HUT260522C00090000",
          underlying: "HUT",
          expirationDate: "2026-05-22",
          strike: 90,
          right: "call",
          multiplier: 100,
          providerContractId: null,
        },
      },
      {
        id: "runtime-smci",
        candidateId: "candidate-smci",
        symbol: "SMCI",
        quantity: 5,
        entryPrice: 1.03,
        selectedContract: {
          ticker: "O:SMCI260522C00032000",
          underlying: "SMCI",
          expirationDate: "2026-05-22",
          strike: 32,
          right: "call",
          multiplier: 100,
          providerContractId: null,
        },
      },
    ],
  });
  const accountRows = [
    {
      id: "shadow-hut",
      symbol: "HUT",
      mark: 16.7,
      marketValue: 1670,
      unrealizedPnl: 900,
      optionContract: {
        ticker: "O:HUT260522C00090000",
        underlying: "HUT",
        expirationDate: "2026-05-22T00:00:00.000Z",
        strike: 90,
        right: "call",
        multiplier: 100,
        providerContractId: null,
      },
      optionQuote: {
        providerContractId: "twsopt:hut",
        bid: 15.2,
        ask: 18.2,
        mark: 16.7,
      },
      underlyingMarket: {
        symbol: "HUT",
        price: 12.34,
        bid: 12.31,
        ask: 12.35,
        updatedAt: "2026-05-22T14:30:00.000Z",
      },
      sourceAttribution: [{ deploymentId: "focused-deployment" }],
      sourceType: "automation",
    },
    {
      id: "shadow-aapl",
      symbol: "AAPL",
      optionContract: {
        underlying: "AAPL",
        expirationDate: "2026-05-22",
        strike: 200,
        right: "call",
        providerContractId: "twsopt:aapl",
      },
      optionQuote: {
        providerContractId: "twsopt:aapl",
        bid: 1,
        ask: 1.2,
      },
      sourceAttribution: [{ deploymentId: "focused-deployment" }],
    },
  ];

  const merged = mergeAlgoRuntimeAndAccountPositionRows({
    runtimeRows,
    accountRows,
  });

  assert.deepEqual(merged.map((row) => row.symbol), ["HUT", "SMCI"]);
  assert.equal(runtimeRows[0].underlyingMarket.bid, null);
  assert.equal(runtimeRows[0].underlyingMarket.ask, null);
  assert.equal(merged[0].id, "shadow-hut");
  assert.equal(merged[0].optionContract.providerContractId, "twsopt:hut");
  assert.equal(merged[0].optionQuote.providerContractId, "twsopt:hut");
  assert.equal(merged[0].optionQuote.bid, 15.2);
  assert.equal(merged[0].optionQuote.ask, 18.2);
  assert.equal(merged[0].underlyingMarket.price, 12.34);
  assert.equal(merged[0].underlyingMarket.bid, 12.31);
  assert.equal(merged[0].underlyingMarket.ask, 12.35);
  assert.equal(merged[0].marketValue, 1670);
  assert.equal(merged[0].automationContext.entryPrice, 7.7);
  assert.equal(merged[1].id, runtimeRows[1].id);
  assert.equal(merged[1].optionQuote.bid, null);

  const ambiguousSymbolOnlyMerge = mergeAlgoRuntimeAndAccountPositionRows({
    runtimeRows: [
      {
        id: "runtime-symbol-only",
        symbol: "HUT",
        optionContract: { underlying: "HUT" },
        optionQuote: { bid: null, ask: null },
      },
    ],
    accountRows: [
      {
        id: "shadow-hut-call",
        symbol: "HUT",
        optionContract: {
          underlying: "HUT",
          expirationDate: "2026-05-22",
          strike: 90,
          right: "call",
        },
        optionQuote: { providerContractId: "twsopt:hut-call", bid: 15, ask: 18 },
      },
      {
        id: "shadow-hut-put",
        symbol: "HUT",
        optionContract: {
          underlying: "HUT",
          expirationDate: "2026-05-22",
          strike: 90,
          right: "put",
        },
        optionQuote: { providerContractId: "twsopt:hut-put", bid: 1, ask: 2 },
      },
    ],
  });

  assert.equal(ambiguousSymbolOnlyMerge[0].id, "runtime-symbol-only");
  assert.equal(ambiguousSymbolOnlyMerge[0].optionQuote.bid, null);
});

test("algo profile UI exposes and saves expanded strategy and exit fields", () => {
  const settingPaths = new Set(allSettingFields.map((field) => field.path));
  const sectionItemPaths = (item) =>
    item.kind === "contractSelect" || item.kind === "exitTrack"
      ? item.fieldPaths
      : [item.path];
  const renderedSettingPaths = SETTINGS_SECTIONS.flatMap((section) =>
    section.fields.flatMap(sectionItemPaths),
  );
  const renderedPathSet = new Set(renderedSettingPaths);
  const settingsFieldsSource = readFileSync(
    new URL("./algoSettingsFields.js", import.meta.url),
    "utf8",
  );
  const settingsRegionSource = readFileSync(
    new URL("./AlgoSettingsRegion.jsx", import.meta.url),
    "utf8",
  );
  const screenSource = readFileSync(
    new URL("../AlgoScreen.jsx", import.meta.url),
    "utf8",
  );
  const saveAllSource = readFileSync(
    new URL("./saveAllAlgoAdjustments.js", import.meta.url),
    "utf8",
  );

  assert.ok(
    PROFILE_NUMBER_FIELDS.some(
      ([section, key]) => section === "exitPolicy" && key === "earlyExitBars",
    ),
  );
  assert.ok(
    PROFILE_BOOLEAN_FIELDS.some(
      ([section, key]) =>
        section === "exitPolicy" && key === "overnightExitEnabled",
    ),
  );
  [
    "entryGate.mtfAlignment.enabled",
    "entryGate.mtfAlignment.requiredCount",
    "exitPolicy.tightenAtFiveXGivebackPct",
    "exitPolicy.tightenAtTenXGivebackPct",
    "exitPolicy.progressiveTrailEnabled",
    "exitPolicy.progressiveTrailSteps",
    "exitPolicy.conditionalQualityExitsEnabled",
    "exitPolicy.lowQualityEarlyExitBars",
    "exitPolicy.lowQualityEarlyExitLossPct",
    "exitPolicy.highQualityEarlyExitBars",
    "exitPolicy.highQualityEarlyExitLossPct",
    "exitPolicy.weakLiquidityTrailGivebackPct",
    "exitPolicy.strongLiquidityTrailGivebackPct",
    "exitPolicy.highQualityOvernightMinGainPct",
  ].forEach((path) => {
    assert.ok(settingPaths.has(path), `${path} should be editable in settings`);
  });
  assert.deepEqual(
    COMPACT_HALT_SETTING_PAIRS.map((pair) => [
      pair.controlId,
      getCompactHaltSettingField(pair.controlId)?.path,
    ]),
    [
      ["dailyLoss", "riskCaps.maxDailyLoss"],
      ["openSymbols", "riskCaps.maxOpenSymbols"],
      ["premiumBudget", "riskCaps.maxPremiumPerEntry"],
      ["bearishRegime", "entryGate.bearishRegime.minAdx"],
      ["spreadGate", "liquidityGate.maxSpreadPctOfMid"],
      ["minBidGate", "liquidityGate.minBid"],
    ],
  );
  assert.deepEqual(COMPACT_HALT_STANDALONE_SETTINGS, [
    { groupId: "risk", id: "maxContracts", settingPath: "riskCaps.maxContracts", label: "Contracts" },
  ]);
  assert.equal(
    getCompactHaltStandaloneFields("risk")[0]?.path,
    "riskCaps.maxContracts",
  );
  [
    ...COMPACT_HALT_SETTING_PAIRS.map((pair) => pair.settingPath),
    ...COMPACT_HALT_STANDALONE_SETTINGS.map((item) => item.settingPath),
  ].forEach((settingPath) => {
    assert.ok(settingPaths.has(settingPath), `${settingPath} should stay dirty-trackable`);
    assert.ok(renderedPathSet.has(settingPath), `${settingPath} should also render in settings`);
  });
  assert.deepEqual(
    SETTINGS_SECTIONS.map((section) => section.id),
    ["signal", "risk", "gates", "contract", "fills", "exits", "qualityExits"],
  );
  assert.equal(
    renderedSettingPaths.length,
    renderedPathSet.size,
    "each settings field should render once in SETTINGS_SECTIONS",
  );
  assert.deepEqual(
    [...settingPaths].sort(),
    [...renderedPathSet].sort(),
    "SETTINGS_SECTIONS should cover every editable setting field",
  );
  [
    "signalTimeframe",
    "entryGate.mtfAlignment.enabled",
    "entryGate.mtfAlignment.requiredCount",
    "liquidityGate.requireFreshQuote",
    "fillPolicy.ttlSeconds",
    "optionSelection.allowZeroDte",
    "optionSelection.minDte",
    "exitPolicy.progressiveTrailEnabled",
    "exitPolicy.progressiveTrailSteps",
    "exitPolicy.overnightExitEnabled",
    "exitPolicy.overnightMinGainPct",
    "exitPolicy.conditionalQualityExitsEnabled",
  ].forEach((settingPath) => {
    assert.ok(renderedPathSet.has(settingPath), `${settingPath} should render in the unified rail`);
  });
  assert.ok(
    PROFILE_NUMBER_FIELDS.some(
      ([section, key]) =>
        section === "exitPolicy" && key === "highQualityOvernightMinGainPct",
    ),
  );
  assert.ok(
    PROFILE_BOOLEAN_FIELDS.some(
      ([section, key]) =>
        section === "exitPolicy" && key === "progressiveTrailEnabled",
    ),
  );
  assert.ok(
    PROFILE_BOOLEAN_FIELDS.some(
      ([section, key]) =>
        section === "exitPolicy" && key === "conditionalQualityExitsEnabled",
    ),
  );
  assert.match(settingsFieldsSource, /BOS CONFIRMATION/);
  assert.match(settingsFieldsSource, /MTF REQUIRED COUNT/);
  assert.match(settingsFieldsSource, /CHOCH ATR BUFFER/);
  assert.match(settingsFieldsSource, /5X GIVEBACK %/);
  assert.match(settingsFieldsSource, /10X GIVEBACK %/);
  assert.match(settingsFieldsSource, /PROGRESSIVE TRAIL/);
  assert.match(settingsFieldsSource, /conditionalQualityExitsEnabled/);
  assert.match(settingsFieldsSource, /highQualityOvernightMinGainPct/);
  assert.match(settingsFieldsSource, /overnightExitEnabled/);
  assert.match(settingsFieldsSource, /SETTINGS_SECTIONS/);
  assert.match(settingsFieldsSource, /kind: "contractSelect"/);
  assert.match(settingsFieldsSource, /kind: "exitTrack"/);
  assert.match(settingsRegionSource, /SETTINGS_SECTIONS\.map/);
  assert.match(settingsRegionSource, /ContractSelectionCell/);
  assert.match(settingsRegionSource, /ExitLadderTrack/);
  assert.match(settingsRegionSource, /className="algo-settings-grid"/);
  assert.match(settingsRegionSource, /data-testid="algo-contract-dte-rail"/);
  assert.match(settingsRegionSource, /data-testid="algo-contract-selection-summary"/);
  assert.match(settingsRegionSource, /data-testid="algo-mini-chain"/);
  assert.match(settingsRegionSource, /STRIKE_SLOT_META/);
  assert.match(settingsRegionSource, /const ChainStrikeButton/);
  assert.match(settingsRegionSource, /formatDteWindowLabel/);
  assert.match(settingsRegionSource, /data-testid=\{`algo-strike-ladder-\$\{side\.toLowerCase\(\)\}-\$\{slot\}`\}/);
  assert.match(settingsRegionSource, /aria-checked=\{selected\}/);
  assert.match(settingsRegionSource, /STRIKE_SLOT_VALUES_DESC/);
  assert.match(settingsRegionSource, /role="radiogroup"[\s\S]*?aria-label="Call strike slot"/);
  assert.match(settingsRegionSource, /role="radiogroup"[\s\S]*?aria-label="Put strike slot"/);
  assert.match(settingsRegionSource, /aria-label=\{`\$\{label\} strike slot unsaved`\}/);
  assert.match(settingsRegionSource, /patchProfileDraftPath\(field\.path, Number\(slot\)\)/);
  assert.match(settingsRegionSource, /moveStrikeSlot/);
  assert.match(settingsRegionSource, /data-testid=\{`algo-exit-track-marker-\$\{marker\.key\}`\}/);
  assert.match(settingsRegionSource, /data-testid=\{`algo-exit-track-input-\$\{editingMarker\.key\}`\}/);
  assert.match(settingsRegionSource, /onBlur=\{commitEditor\}/);
  assert.match(settingsRegionSource, /event\.key === "Escape"/);
  assert.match(settingsRegionSource, /event\.key === "Enter"/);
  assert.doesNotMatch(settingsRegionSource, /SettingsFormRow/);
  assert.doesNotMatch(settingsRegionSource, /compactRailSettingGroups/);
  assert.doesNotMatch(settingsRegionSource, /settingsRegionFields/);
  assert.doesNotMatch(settingsRegionSource, /gridTemplateFor|compactGridTemplateFor/);
  assert.match(settingsRegionSource, /patchStrategySettingsPath/);
  const haltSource = readFileSync(new URL("./HaltStrip.jsx", import.meta.url), "utf8");
  assert.match(haltSource, /algo-halt-input-/);
  assert.doesNotMatch(haltSource, /StatePill/);
  assert.doesNotMatch(haltSource, /algo-halt-state-pill/);
  assert.match(haltSource, /data-state=\{status\.state\}/);
  assert.match(haltSource, /state=\{status\.state\}/);
  assert.match(haltSource, /className="algo-settings-grid"/);
  assert.doesNotMatch(haltSource, /controlColumns/);
  assert.match(
    readFileSync(new URL("./AlgoSaveBar.jsx", import.meta.url), "utf8"),
    /Save changes/,
  );
  assert.match(screenSource, /saveAllAlgoAdjustments/);
  assert.match(saveAllSource, /bosConfirmation,/);
  assert.match(saveAllSource, /chochBodyExpansionAtr:/);
  assert.match(saveAllSource, /chochVolumeGate:/);
});

test("algo operations views surface contract quote and greeks fields", () => {
  const rowSource = readFileSync(
    new URL("./OperationsSignalRow.jsx", import.meta.url),
    "utf8",
  );
  const positionsSource = readFileSync(
    new URL("./OperationsPositionsTable.jsx", import.meta.url),
    "utf8",
  );
  const drillSource = readFileSync(
    new URL("./OperationsSignalDrill.jsx", import.meta.url),
    "utf8",
  );
  const livePageSource = readFileSync(
    new URL("./AlgoLivePage.jsx", import.meta.url),
    "utf8",
  );
  const screenSource = readFileSync(
    new URL("../AlgoScreen.jsx", import.meta.url),
    "utf8",
  );
  const accountPositionsSource = readFileSync(
    new URL("../account/PositionsPanel.jsx", import.meta.url),
    "utf8",
  );

  assert.match(rowSource, /formatContractDetail/);
  assert.match(rowSource, /mergeOptionQuoteSnapshot/);
  assert.match(rowSource, /getStoredOptionQuoteSnapshot/);
  assert.match(positionsSource, /PositionsPanel/);
  assert.match(positionsSource, /buildAlgoAccountPositionRows/);
  assert.match(positionsSource, /accountPositionsQuery/);
  assert.match(positionsSource, /Runtime positions \+ shadow projection quotes/);
  assert.match(positionsSource, /filterAccountPositionRowsForDeployment/);
  assert.match(positionsSource, /mergeAlgoRuntimeAndAccountPositionRows/);
  assert.match(positionsSource, /liveOptionQuotesEnabled=\{true\}/);
  assert.match(positionsSource, /streamLiveOptionQuotes=\{true\}/);
  assert.match(positionsSource, /hasAccountPositionsQuery/);
  assert.match(positionsSource, /scopedAccountRows\.length\s*>\s*0/);
  assert.match(positionsSource, /useStoredOptionQuoteSnapshotVersion/);
  assert.match(positionsSource, /showFilters=\{false\}/);
  assert.match(accountPositionsSource, /column\.id === "quote"/);
  assert.match(accountPositionsSource, /formatPositionBidAskPair/);
  assert.match(accountPositionsSource, /column\.id === "greeks"/);
  assert.match(accountPositionsSource, /DenseSignalCell/);
  assert.match(accountPositionsSource, /data-testid="account-positions-table-scroll"/);
  assert.doesNotMatch(accountPositionsSource, /data-testid="account-position-context-strip"/);
  assert.match(screenSource, /useGetAccountPositions/);
  assert.match(screenSource, /assetClass:\s*"Options"/);
  assert.match(livePageSource, /signalOptionsLedgerPositionsQuery/);
  assert.match(livePageSource, /ledgerPositions: focusedLedgerPositions/);
  assert.match(drillSource, /contractSelection/);
  assert.match(drillSource, /quoteUpdatedAt/);
  assert.match(livePageSource, /useIbkrOptionQuoteStream/);
  assert.match(livePageSource, /automation-live/);
});

test("algo setup shows a loading state before true empty deployment data", () => {
  const livePageSource = readFileSync(
    new URL("./AlgoLivePage.jsx", import.meta.url),
    "utf8",
  );
  const screenSource = readFileSync(
    new URL("../AlgoScreen.jsx", import.meta.url),
    "utf8",
  );
  const setupSettledBlock =
    screenSource.match(/const algoSetupDataSettled = Boolean\([\s\S]*?\);/)?.[0] ?? "";

  assert.match(screenSource, /const deploymentsSettled = Boolean/);
  assert.match(screenSource, /const draftsSettled = Boolean/);
  assert.match(screenSource, /const algoSetupDataSettled = Boolean/);
  assert.match(screenSource, /deploymentsQuery\.isFetched/);
  assert.match(screenSource, /draftsQuery\.isFetched/);
  assert.match(setupSettledBlock, /deploymentsSettled && draftsSettled/);
  assert.doesNotMatch(setupSettledBlock, /algoCriticalFallbackReady/);
  assert.doesNotMatch(setupSettledBlock, /algoCockpitStreamFreshness/);
  assert.match(screenSource, /setupDataSettled=\{algoSetupDataSettled\}/);
  assert.match(livePageSource, /setupDataSettled = true/);
  assert.match(livePageSource, /data-testid="algo-setup-loading"/);
  assert.match(livePageSource, /Loading promoted drafts and shadow deployments/);
  assert.ok(
    livePageSource.indexOf("!setupDataSettled") <
      livePageSource.indexOf("No promoted draft strategies"),
  );
});

test("algo screen auto-runs an initial scan and labels sync separately", () => {
  const screenSource = readFileSync(
    new URL("../AlgoScreen.jsx", import.meta.url),
    "utf8",
  );
  const statusBarSource = readFileSync(
    new URL("./AlgoStatusBar.jsx", import.meta.url),
    "utf8",
  );
  const livePageSource = readFileSync(
    new URL("./AlgoLivePage.jsx", import.meta.url),
    "utf8",
  );
  const surfaceSettledBlock =
    screenSource.match(/const algoSignalSurfaceSettled = Boolean\([\s\S]*?\);/)?.[0] ?? "";

  assert.match(screenSource, /autoInitialScanDeploymentIdsRef/);
  assert.match(screenSource, /const signalOptionsStateSettled = Boolean/);
  assert.match(screenSource, /const cockpitSettled = Boolean/);
  assert.match(screenSource, /const algoSignalSurfaceSettled = Boolean/);
  assert.match(surfaceSettledBlock, /signalOptionsStateSettled \|\| cockpitSettled/);
  assert.doesNotMatch(surfaceSettledBlock, /algoCockpitStreamFreshness\.algoCriticalFresh/);
  assert.match(screenSource, /const algoSignalSurfaceEmpty = Boolean/);
  assert.match(screenSource, /focusedDeployment\?\.enabled/);
  assert.match(screenSource, /gatewayReady/);
  assert.match(
    screenSource,
    /autoInitialScanDeploymentIdsRef\.current\.has\(deploymentId\)/,
  );
  assert.match(
    screenSource,
    /autoInitialScanDeploymentIdsRef\.current\.add\(deploymentId\)/,
  );
  assert.match(screenSource, /runShadowScanMutation\.mutate\(\{ deploymentId \}\)/);
  assert.match(screenSource, /state\?\.status === "already_running"/);
  assert.match(screenSource, /Shadow scan already running/);
  assert.match(statusBarSource, /pendingLabel="Syncing\.\.\."/);
  assert.doesNotMatch(statusBarSource, /pendingLabel="Refreshing\.\.\."/);
  assert.match(livePageSource, /scanMutationPending/);
  assert.match(livePageSource, /\? "scanning"/);
  assert.match(livePageSource, /\? "syncing data"/);
  assert.doesNotMatch(livePageSource, /\? "refreshing"/);
});

test("algo display surfaces normalize retired Ray branding", () => {
  const haltSource = readFileSync(
    new URL("./HaltStrip.jsx", import.meta.url),
    "utf8",
  );
  const statusBarSource = readFileSync(
    new URL("./AlgoStatusBar.jsx", import.meta.url),
    "utf8",
  );
  const auditSource = readFileSync(
    new URL("./AlgoAuditPanel.jsx", import.meta.url),
    "utf8",
  );
  const platformSidebarSource = readFileSync(
    new URL("../../features/platform/PlatformAlgoMonitorSidebar.jsx", import.meta.url),
    "utf8",
  );

  [haltSource, statusBarSource, auditSource, platformSidebarSource].forEach(
    (source) => {
      assert.match(source, /normalizeLegacyAlgoBrandText/);
      assert.doesNotMatch(source, /RAY\s*·/);
    },
  );
});
