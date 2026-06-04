import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DEFAULT_STRATEGY_SIGNAL_SETTINGS,
  PROFILE_BOOLEAN_FIELDS,
  PROFILE_NUMBER_FIELDS,
  SIGNAL_OPTIONS_AGGRESSIVE_PROGRESSIVE_TRAIL_STEPS,
  SIGNAL_OPTIONS_DEFAULT_WIRE_TRAIL_RUNGS,
  SIGNAL_OPTIONS_DEFAULT_PROFILE,
  SIGNAL_OPTIONS_HALT_CONTROL_GROUPS,
  buildStaSignalHistoryRows,
  buildVisibleSignalRows,
  candidateBlockerLabel,
  candidateLatestActivityLabel,
  deriveWireTrailControlSummary,
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
  normalizeSignalOptionsStrikeSlots,
  optionProviderContractId,
  parseProgressiveTrailSteps,
  resolvePositionWireTrailState,
  resolveCandidateGateDisplay,
  resolveCandidateSyncDisplay,
  resolveSignalAge,
  resolveSignalMove,
  resolveSignalScoreBreakdown,
  resolveStableStaActionSnapshot,
  resolveStrategySignalSettings,
  signalActionBlockerLabel,
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
import { AlgoSaveBar } from "./AlgoSaveBar.jsx";
import { saveAllAlgoAdjustments } from "./saveAllAlgoAdjustments";
import { __internalsForTests as draftInternals } from "./useServerSyncedDraft";

test("AlgoScreen keeps startup fallback collections stable before queries resolve", () => {
  const source = readFileSync(new URL("../AlgoScreen.jsx", import.meta.url), "utf8");

  assert.match(source, /const EMPTY_ALGO_DEPLOYMENTS = Object\.freeze\(\[\]\)/);
  assert.match(source, /const EMPTY_ALGO_DRAFTS = Object\.freeze\(\[\]\)/);
  assert.match(source, /const EMPTY_ALGO_EVENTS = Object\.freeze\(\[\]\)/);
  assert.match(source, /const EMPTY_SIGNAL_OPTIONS_CANDIDATES = Object\.freeze\(\[\]\)/);
  assert.match(source, /const EMPTY_SIGNAL_OPTIONS_SIGNALS = Object\.freeze\(\[\]\)/);
  assert.match(source, /const EMPTY_SIGNAL_OPTIONS_POSITIONS = Object\.freeze\(\[\]\)/);
  assert.match(source, /const sourceArrayLatestTimestampMs = \(items\) =>/);
  assert.match(source, /const latestIsoFromRows = \(items, fields\) =>/);
  assert.match(source, /previousStaActionSnapshotRef = useRef\(null\)/);
  assert.match(source, /resolveStableStaActionSnapshot\(\{/);
  assert.match(source, /previousSnapshot: previousStaActionSnapshotRef\.current/);
  assert.match(source, /cockpitFailed: cockpitQuery\.isError/);
  assert.match(source, /signalOptionsStateFailed: signalOptionsStateQuery\.isError/);
  assert.match(source, /signalMonitorEvents = \[\]/);
  assert.match(source, /signalMonitorEventsLoaded = false/);
  assert.match(source, /signalEvents: signalMonitorEventsLoaded \? signalMonitorEvents : \[\]/);
  assert.match(source, /universeSymbols: focusedDeployment\?\.symbolUniverse \|\| \[\]/);
  assert.match(source, /if \(staActionSnapshot\.cacheable\)/);
  assert.match(source, /const signalTableScanFallback = useMemo/);
  assert.match(source, /lastSignalScanAt: latestIsoFromRows\(visibleSignalRows,\s*\[\s*"lastEvaluatedAt",\s*"updatedAt"/);
  assert.match(source, /latestSignalBarAt: latestIsoFromRows\(visibleSignalRows,\s*\["latestBarAt"\]\)/);
  assert.match(source, /latestAt:\s*signalTableScanFallback\.lastSignalScanAt \|\|\s*focusedDeployment\?\.lastEvaluatedAt/);
  assert.match(source, /lastSignalScanAt: signalTableScanFallback\.lastSignalScanAt/);
  assert.match(source, /detail:[\s\S]*signal stream cache current/);
  assert.match(
    source,
    /setSelectedCandidateId\(\(current\) => \(current === null \? current : null\)\)/,
  );
  assert.match(
    source,
    /setFocusedDeploymentId\(\(current\) => \(current === null \? current : null\)\)/,
  );
  assert.doesNotMatch(source, /signalOptionsState\?\.candidates \|\| \[\]/);
  assert.doesNotMatch(source, /deploymentsQuery\.data\?\.deployments \|\| \[\]/);
});

test("AlgoRightRail surfaces wire trail state inside the controls container", () => {
  const source = readFileSync(new URL("./AlgoRightRail.jsx", import.meta.url), "utf8");

  assert.match(source, /data-testid="algo-wire-trail-status"/);
  assert.match(source, /deriveWireTrailControlSummary/);
  assert.match(source, /positions=\{signalOptionsPositions\}/);
  assert.match(source, /controlBaselineReady = true/);
  assert.match(source, /saveAllPending = false/);
  assert.match(source, /saveAllPending \|\|/);
  assert.match(source, /const controlsReady = Boolean\(focusedDeployment && controlBaselineReady\)/);
});

test("AlgoScreen uses shared server-synced draft model for live controls", () => {
  const source = readFileSync(
    new URL("../AlgoScreen.jsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /import \{ useServerSyncedDraft \} from "\.\/algo\/useServerSyncedDraft"/);
  assert.match(source, /deploymentSignalOptionsBaselineAvailable/);
  assert.match(source, /key\.startsWith\("signalOptions"\)/);
  assert.match(source, /const saveAllInFlightRef = useRef\(false\)/);
  assert.match(source, /const \[saveAllPending, setSaveAllPending\] = useState\(false\)/);
  assert.match(source, /if \(saveAllInFlightRef\.current\)/);
  assert.match(source, /setSaveAllPending\(true\)/);
  assert.match(source, /setSaveAllPending\(false\)/);
  assert.match(source, /saveAllPending=\{saveAllPending\}/);
  assert.match(
    source,
    /focusedDeployment\?\.config && deploymentSignalOptionsBaselineAvailable/,
  );
  assert.doesNotMatch(source, /const useServerSyncedDraft = \(/);
  assert.doesNotMatch(source, /const setDraftPathValue = /);
});

test("AlgoScreen profile save patches cached controls and refreshes state async", () => {
  const source = readFileSync(
    new URL("../AlgoScreen.jsx", import.meta.url),
    "utf8",
  );
  const profileSaveBlock = source.match(
    /const updateProfileMutation = useUpdateSignalOptionsExecutionProfile[\s\S]*?\n  const updateStrategySettingsMutation/,
  )?.[0];

  assert.ok(profileSaveBlock);
  assert.match(profileSaveBlock, /onSuccess:\s*\(payload, variables\)/);
  assert.match(profileSaveBlock, /setQueryData\([\s\S]*\(current\) =>/);
  assert.match(profileSaveBlock, /\.\.\.current/);
  assert.match(profileSaveBlock, /deployment:\s*payload\.deployment/);
  assert.match(profileSaveBlock, /profile:\s*payload\.profile/);
  assert.match(profileSaveBlock, /includeSignalMonitorProfile:\s*false/);
  assert.match(profileSaveBlock, /includeSignalOptionsState:\s*true/);
  assert.match(profileSaveBlock, /profileDraftState\.markClean\(payload\?\.profile \|\| variables\?\.data\)/);
});

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
  assert.deepEqual(SIGNAL_OPTIONS_DEFAULT_PROFILE.entryGate.mtfAlignment, {
    enabled: true,
    requiredCount: 2,
    timeframes: ["1m", "2m", "5m", "15m", "1h"],
    preset: "custom",
  });
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
      wireGreekTrail:
        SIGNAL_OPTIONS_DEFAULT_PROFILE.exitPolicy.wireGreekTrail,
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
      wireGreekTrail: {
        enabled: true,
        requireFreshGreeks: true,
        greekMaxAgeMs: 15000,
        deltaSizingEnabled: false,
        runnerPollIntervalSeconds: 20,
        rungByProfit: SIGNAL_OPTIONS_DEFAULT_WIRE_TRAIL_RUNGS,
        deltaLoosenThreshold: 0.05,
        deltaTightenThreshold: -0.1,
        thetaBurdenTightenPct: 8,
        strongGammaMin: 0.05,
        spreadWideningMultiplier: 1.5,
      },
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

test("profile merge normalizes signal-options MTF frame selection", () => {
  const profile = mergeSignalOptionsProfile({
    signalOptions: {
      entryGate: {
        mtfAlignment: {
          enabled: true,
          requiredCount: 9,
          timeframes: ["5m", "1h", "1d", "1h", "4h"],
          preset: "higher_timeframe",
        },
      },
    },
  });

  assert.deepEqual(profile.entryGate.mtfAlignment, {
    enabled: true,
    requiredCount: 3,
    timeframes: ["5m", "1h", "1d"],
    preset: "higher_timeframe",
  });
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

test("profile merge normalizes ordered strike slot preferences", () => {
  const profile = mergeSignalOptionsProfile({
    signalOptions: {
      optionSelection: {
        callStrikeSlots: [3, "4", 4, 9],
        putStrikeSlot: 1,
      },
    },
  });

  assert.deepEqual(profile.optionSelection.callStrikeSlots, [3, 4, 5]);
  assert.deepEqual(profile.optionSelection.putStrikeSlots, [1]);
  assert.equal(profile.optionSelection.callStrikeSlot, 3);
  assert.equal(profile.optionSelection.putStrikeSlot, 1);
  assert.deepEqual(normalizeSignalOptionsStrikeSlots(["bad"], [2]), [2]);
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

test("wire trail control summary derives active rungs and greek fallbacks", () => {
  const directState = resolvePositionWireTrailState({
    lastWireTrail: {
      enabled: true,
      active: true,
      selectedRung: "wire2",
      selectedWirePrice: 198.4,
      latestUnderlyingClose: 202.15,
      greekFresh: true,
    },
  });
  assert.deepEqual(
    {
      active: directState.active,
      selectedRung: directState.selectedRung,
      selectedRungLabel: directState.selectedRungLabel,
      greekFresh: directState.greekFresh,
    },
    {
      active: true,
      selectedRung: "wire2",
      selectedRungLabel: "W2",
      greekFresh: true,
    },
  );

  const summary = deriveWireTrailControlSummary({
    profile: SIGNAL_OPTIONS_DEFAULT_PROFILE,
    positions: [
      {
        lastWireTrail: {
          enabled: true,
          active: true,
          selectedRung: "wire2",
          selectedWirePrice: 198.4,
          latestUnderlyingClose: 202.15,
          greekFresh: true,
        },
      },
      {
        lastStop: {
          wireTrail: {
            enabled: true,
            active: false,
            greekFresh: false,
            greekFallbackReason: "stale_greeks",
          },
        },
      },
    ],
  });

  assert.equal(summary.status, "degraded");
  assert.equal(summary.statusLabel, "DEGRADED");
  assert.equal(summary.openPositions, 2);
  assert.equal(summary.activePositions, 1);
  assert.equal(summary.floorOnlyPositions, 1);
  assert.equal(summary.missingWireContextPositions, 1);
  assert.equal(summary.freshGreekPositions, 1);
  assert.equal(summary.greekFallbackPositions, 1);
  assert.equal(summary.staleGreekPositions, 1);
  assert.equal(summary.runnerPollIntervalSeconds, 20);
  assert.equal(summary.rungSummary, "W3 0 · W2 1 · W1 0 · TL 0");
  assert.equal(summary.greekSummary, "1/2 fresh · 1 fallback");
  assert.equal(summary.structureSummary, "1/2 wire");
});

test("wire trail control summary reports disabled and armed states", () => {
  assert.equal(
    deriveWireTrailControlSummary({
      profile: { exitPolicy: { wireGreekTrail: { enabled: false } } },
      positions: [{ lastWireTrail: { enabled: true, active: true } }],
    }).status,
    "off",
  );

  const armed = deriveWireTrailControlSummary({
    profile: SIGNAL_OPTIONS_DEFAULT_PROFILE,
    positions: [],
  });
  assert.equal(armed.status, "armed");
  assert.equal(armed.statusLabel, "ARMED");
  assert.equal(armed.structureSummary, "armed");
  assert.equal(armed.greekSummary, "ready");
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

test("unified algo save runs dirty slice writes sequentially to avoid config races", async () => {
  const calls = [];
  let profileResolved = false;
  const profileMutation = {
    mutateAsync: async (payload) => {
      calls.push(["profile-start", payload]);
      await Promise.resolve();
      profileResolved = true;
      calls.push(["profile-end"]);
      return { profile: payload.data };
    },
  };
  const strategyMutation = {
    mutateAsync: async (payload) => {
      calls.push(["strategy-start", payload, profileResolved]);
      return { deployment: { id: payload.deploymentId } };
    },
  };

  const result = await saveAllAlgoAdjustments({
    deploymentId: "dep-1",
    profileDraft: SIGNAL_OPTIONS_DEFAULT_PROFILE,
    strategySettingsDraft: {
      ...DEFAULT_STRATEGY_SIGNAL_SETTINGS,
      timeHorizon: 12,
    },
    profileDirty: true,
    strategyDirty: true,
    updateProfileMutation: profileMutation,
    updateStrategySettingsMutation: strategyMutation,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    calls.map((call) => call[0]),
    ["profile-start", "profile-end", "strategy-start"],
  );
  assert.equal(calls[2][2], true);
  assert.equal(calls[2][1].data.timeHorizon, 12);
});

test("algo save bar keeps Save clickable for dirty focused deployments", () => {
  const previousReact = globalThis.React;
  globalThis.React = React;
  let html = "";
  try {
    html = renderToStaticMarkup(
      React.createElement(AlgoSaveBar, {
        dirtyFields: [
          {
            slice: "profile",
            path: "riskCaps.maxOpenSymbols",
            sectionLabel: "Risk",
            label: "Max open symbols",
            previousValue: 2,
            currentValue: 3,
          },
        ],
        isDirty: true,
        pending: false,
        focusedDeployment: { id: "dep-1" },
        onDiscard: () => {},
        onSave: () => {},
      }),
    );
  } finally {
    globalThis.React = previousReact;
  }

  const saveButton = html.match(/<button[^>]*>Save changes<\/button>/)?.[0] || "";
  assert.match(saveButton, /Save changes/);
  assert.doesNotMatch(saveButton, /\sdisabled=""/);
});

test("algo row helpers summarize blocker, timeline, and entry quality fields", () => {
  assert.equal(
    candidateBlockerLabel({ reason: "spread_too_wide" }),
    "Spread Too Wide",
  );
  assert.equal(candidateBlockerLabel({}), "—");
  assert.equal(
    signalActionBlockerLabel({ actionBlocker: "signal_too_old" }),
    "Signal Too Old",
  );
  assert.equal(signalActionBlockerLabel({}), "—");
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
  assert.deepEqual(
    resolveSignalAge(
      {
        ...signal,
        barsSinceSignal: 5,
        freshWindowBars: 8,
        actionEligible: false,
        actionBlocker: "signal_too_old",
      },
      { now: Date.parse("2026-05-21T14:30:00.000Z") },
    ),
    {
      signalAt: "2026-05-21T14:00:00.000Z",
      barsSinceSignal: 5,
      freshWindowBars: 8,
      freshnessPct: 37.5,
      label: "5/8 bars",
      detail: "30m since signal",
    },
  );

  assert.deepEqual(resolveSignalMove(signal, { price: 510 }), {
    value: 10,
    pct: 2,
    label: "+2.0%",
    detail: "+10.00",
  });
  assert.deepEqual(resolveSignalMove({ signalPrice: 500 }, { last: 507.5 }), {
    value: 7.5,
    pct: 1.5,
    label: "+1.5%",
    detail: "+7.50",
  });
  assert.deepEqual(resolveSignalMove({ signalPrice: 500 }, { mark: 495 }), {
    value: -5,
    pct: -1,
    label: "-1.0%",
    detail: "-5.00",
  });
  assert.deepEqual(resolveSignalMove({ signalPrice: 500 }, { price: 490 }), {
    value: -10,
    pct: -2,
    label: "-2.0%",
    detail: "-10.00",
  });
  assert.deepEqual(resolveSignalMove({}, { price: 510 }, { signalPrice: 500 }), {
    value: 10,
    pct: 2,
    label: "+2.0%",
    detail: "+10.00",
  });
  assert.deepEqual(resolveSignalMove({}, null, { signalPrice: 500, currentPrice: 510 }), {
    value: null,
    pct: null,
    label: "—",
    detail: "—",
  });
  assert.deepEqual(
    resolveSignalMove(
      { signalPrice: null, currentPrice: null },
      { price: null },
      { signalPrice: 500, underlyingPrice: 510 },
    ),
    {
      value: null,
      pct: null,
      label: "—",
      detail: "—",
    },
  );
  assert.deepEqual(resolveSignalMove({ signalPrice: 500 }, null, {}), {
    value: null,
    pct: null,
    label: "—",
    detail: "—",
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

test("algo signal fallback score uses all five matrix MTF directions", () => {
  const score = resolveSignalScoreBreakdown({
    signal: {
      symbol: "SPY",
      direction: "buy",
      barsSinceSignal: 1,
      freshWindowBars: 4,
      fresh: true,
      filterState: {
        mtfDirections: [1, 1, 1, -1, -1],
        mtfTimeframes: ["1m", "2m", "5m", "15m", "1h"],
        adx: 31,
      },
    },
    candidate: {
      direction: "buy",
      status: "candidate",
      orderPlan: {
        premiumAtRisk: 240,
        liquidity: { spreadPctOfMid: 12 },
      },
      quote: { marketDataMode: "live" },
    },
  });

  assert.equal(score.score, 85);
  assert.equal(score.components.mtfAlignment, 15);
  assert.deepEqual(score.raw.mtfDirections, [1, 1, 1, -1, -1]);
  assert.equal(score.raw.mtfMatches, 3);
  assert.equal(score.reasons[0], "mtf_partial_alignment");
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

test("visible signal rows prefer live signal rows over same-family candidate fallbacks", () => {
  const rows = buildVisibleSignalRows({
    signals: [
      {
        symbol: "TLT",
        timeframe: "5m",
        direction: "sell",
        signalAt: "2026-06-02T22:15:00.000Z",
        signalKey: "profile:TLT:5m:sell:2026-06-02T22:15:00.000Z",
      },
    ],
    candidates: [
      {
        id: "SIGOPT-TLT-sell-1780438800000",
        symbol: "TLT",
        timeframe: "5m",
        direction: "sell",
        signalAt: "2026-06-02T22:20:00.000Z",
        signal: {
          source: "pyrus-signals",
          signalKey: "profile:TLT:5m:sell:2026-06-02T22:20:00.000Z",
        },
      },
      {
        id: "SIGOPT-TLT-buy-1780438800000",
        symbol: "TLT",
        timeframe: "5m",
        direction: "buy",
        signalAt: "2026-06-02T22:20:00.000Z",
      },
    ],
  });

  assert.deepEqual(
    rows.map((row) => [row.symbol, row.direction, row.signalAt]),
    [
      ["TLT", "sell", "2026-06-02T22:15:00.000Z"],
      ["TLT", "buy", "2026-06-02T22:20:00.000Z"],
    ],
  );
});

test("visible signal rows include same-day signal-monitor history without duplicating live action rows", () => {
  const rows = buildVisibleSignalRows({
    signals: [
      {
        profileId: "profile-1",
        symbol: "SPY",
        timeframe: "5m",
        direction: "buy",
        signalAt: "2026-06-03T14:35:12.000Z",
        signalKey: "profile-1:SPY:5m:buy:2026-06-03T14:35:12.000Z",
        actionEligible: true,
        fresh: true,
      },
    ],
    candidates: [
      {
        id: "candidate-spy",
        symbol: "SPY",
        timeframe: "5m",
        direction: "buy",
        signalAt: "2026-06-03T14:35:12.000Z",
      },
    ],
    signalEvents: [
      {
        id: "event-spy-duplicate",
        profileId: "profile-1",
        symbol: "SPY",
        timeframe: "5m",
        direction: "buy",
        signalAt: "2026-06-03T14:35:12.000Z",
        signalPrice: 542.1,
        source: "pyrus-signals",
        payload: { latestBarAt: "2026-06-03T14:35:00.000Z" },
      },
      {
        id: "event-glw-history",
        profileId: "profile-1",
        symbol: "GLW",
        timeframe: "5m",
        direction: "sell",
        signalAt: "2026-06-03T13:05:44.000Z",
        signalPrice: 49.4,
        source: "pyrus-signals",
        payload: {
          filterState: { adx: 28 },
          signalBarAt: "2026-06-03T13:05:00.000Z",
        },
      },
      {
        id: "event-msft-previous-day",
        profileId: "profile-1",
        symbol: "MSFT",
        timeframe: "5m",
        direction: "buy",
        signalAt: "2026-06-02T20:55:00.000Z",
        signalPrice: 477.2,
        source: "pyrus-signals",
        payload: {},
      },
    ],
    universeSymbols: ["SPY", "GLW", "MSFT"],
    now: "2026-06-03T18:00:00.000Z",
  });

  assert.deepEqual(
    rows.map((row) => [
      row.symbol,
      row.direction,
      row.signalAt,
      row.sourceType,
      row.actionEligible,
    ]),
    [
      ["SPY", "buy", "2026-06-03T14:35:12.000Z", undefined, true],
      [
        "GLW",
        "sell",
        "2026-06-03T13:05:44.000Z",
        "signal_monitor_event",
        false,
      ],
    ],
  );
  assert.equal(rows[1].signalKey, "profile-1:GLW:5m:sell:2026-06-03T13:05:44.000Z");
  assert.equal(rows[1].filterState.adx, 28);
});

test("current candidate fallback overlays matching signal-monitor history rows", () => {
  const rows = buildVisibleSignalRows({
    signals: [],
    candidates: [
      {
        id: "candidate-glw",
        symbol: "GLW",
        timeframe: "5m",
        direction: "sell",
        signalAt: "2026-06-03T15:00:30.000Z",
        signalPrice: 49.8,
      },
    ],
    signalEvents: [
      {
        id: "event-glw-current",
        profileId: "profile-1",
        symbol: "GLW",
        timeframe: "5m",
        direction: "sell",
        signalAt: "2026-06-03T15:00:30.000Z",
        signalPrice: 49.8,
        source: "pyrus-signals",
        payload: {},
      },
      {
        id: "event-glw-older",
        profileId: "profile-1",
        symbol: "GLW",
        timeframe: "5m",
        direction: "sell",
        signalAt: "2026-06-03T13:00:00.000Z",
        signalPrice: 49.1,
        source: "pyrus-signals",
        payload: {},
      },
    ],
    universeSymbols: ["GLW"],
    now: "2026-06-03T18:00:00.000Z",
  });

  assert.deepEqual(
    rows.map((row) => [row.symbol, row.signalAt, row.sourceType]),
    [
      ["GLW", "2026-06-03T15:00:30.000Z", undefined],
      ["GLW", "2026-06-03T13:00:00.000Z", "signal_monitor_event"],
    ],
  );
});

test("STA signal history uses the New York market date near UTC midnight", () => {
  const rows = buildStaSignalHistoryRows({
    signalEvents: [
      {
        id: "late-et",
        profileId: "profile-1",
        symbol: "QQQ",
        timeframe: "5m",
        direction: "buy",
        signalAt: "2026-06-04T02:15:00.000Z",
        source: "pyrus-signals",
        payload: {},
      },
      {
        id: "next-et",
        profileId: "profile-1",
        symbol: "QQQ",
        timeframe: "5m",
        direction: "sell",
        signalAt: "2026-06-04T04:15:00.000Z",
        source: "pyrus-signals",
        payload: {},
      },
    ],
    now: "2026-06-04T03:00:00.000Z",
  });

  assert.deepEqual(
    rows.map((row) => [row.eventId, row.signalAt]),
    [["late-et", "2026-06-04T02:15:00.000Z"]],
  );
});

test("STA action snapshot keeps last successful rows when the action source is failing", () => {
  const previous = resolveStableStaActionSnapshot({
    cockpit: {
      generatedAt: "2026-06-03T20:27:00.000Z",
      signals: [
        {
          symbol: "SPY",
          timeframe: "5m",
          direction: "buy",
          signalAt: "2026-06-03T20:26:00.000Z",
        },
        {
          symbol: "GLW",
          timeframe: "5m",
          direction: "sell",
          signalAt: "2026-06-03T20:25:00.000Z",
        },
      ],
      candidates: [{ id: "spy-candidate", symbol: "SPY" }],
      activePositions: [{ id: "spy-position", symbol: "SPY" }],
    },
    signalOptionsState: null,
  });

  const stable = resolveStableStaActionSnapshot({
    cockpit: null,
    signalOptionsState: {
      updatedAt: "2026-06-03T20:28:00.000Z",
      signals: [
        {
          symbol: "GLW",
          timeframe: "5m",
          direction: "sell",
          signalAt: "2026-06-03T20:25:00.000Z",
        },
      ],
      candidates: [{ id: "glw-candidate", symbol: "GLW" }],
      activePositions: [],
    },
    previousSnapshot: previous,
    cockpitFailed: true,
  });

  assert.equal(previous.cacheable, true);
  assert.equal(stable.cacheable, false);
  assert.equal(stable.sourceHealth.stale, true);
  assert.equal(stable.sourceHealth.degraded, true);
  assert.deepEqual(stable.sourceHealth.failedSources, ["cockpit"]);
  assert.deepEqual(
    stable.signals.map((signal) => signal.symbol),
    ["SPY", "GLW"],
  );
  assert.deepEqual(stable.candidates.map((candidate) => candidate.id), [
    "spy-candidate",
  ]);
});

test("STA action snapshot accepts row removals after a healthy action-source update", () => {
  const previous = resolveStableStaActionSnapshot({
    cockpit: {
      generatedAt: "2026-06-03T20:27:00.000Z",
      signals: [
        { symbol: "SPY", timeframe: "5m", direction: "buy" },
        { symbol: "GLW", timeframe: "5m", direction: "sell" },
      ],
      candidates: [{ id: "spy-candidate", symbol: "SPY" }],
      activePositions: [],
    },
  });

  const updated = resolveStableStaActionSnapshot({
    cockpit: {
      generatedAt: "2026-06-03T20:29:00.000Z",
      signals: [{ symbol: "GLW", timeframe: "5m", direction: "sell" }],
      candidates: [{ id: "glw-candidate", symbol: "GLW" }],
      activePositions: [],
    },
    previousSnapshot: previous,
  });

  assert.equal(updated.cacheable, true);
  assert.equal(updated.sourceHealth.stale, false);
  assert.deepEqual(
    updated.signals.map((signal) => signal.symbol),
    ["GLW"],
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

test("algo quote helpers surface pending and unavailable demand states", () => {
  assert.deepEqual(
    formatQuoteSummary(
      { freshness: "pending", reason: "awaiting_quote" },
      {},
    ),
    {
      main: "Pending",
      detail: "Awaiting Quote",
    },
  );
  assert.deepEqual(
    formatQuoteSummary(
      { freshness: "unavailable", reason: "ibkr_bridge_not_configured" },
      {},
    ),
    {
      main: "Unavailable",
      detail: "Ibkr Bridge Not Configured",
    },
  );
  assert.deepEqual(
    formatQuoteGreeksSummary({
      freshness: "pending",
      reason: "awaiting_greeks",
    }),
    {
      main: "Awaiting Greeks",
      detail: "Awaiting Greeks",
      full: "—",
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

test("algo account position merge keeps shadow ledger membership authoritative", () => {
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

  assert.deepEqual(merged.map((row) => row.symbol), ["HUT", "AAPL"]);
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
  assert.equal(merged[1].id, "shadow-aapl");
  assert.equal(merged[1].optionQuote.bid, 1);

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

  assert.deepEqual(
    ambiguousSymbolOnlyMerge.map((row) => row.id),
    ["shadow-hut-call", "shadow-hut-put"],
  );
  assert.equal(ambiguousSymbolOnlyMerge[0].optionQuote.bid, 15);
  assert.equal(ambiguousSymbolOnlyMerge[1].optionQuote.bid, 1);
});

test("algo profile UI exposes and saves expanded strategy and exit fields", () => {
  const settingPaths = new Set(allSettingFields.map((field) => field.path));
  const sectionItemPaths = (item) =>
    Array.isArray(item.fieldPaths)
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
    "entryGate.mtfAlignment.preset",
    "entryGate.mtfAlignment.timeframes",
    "exitPolicy.tightenAtFiveXGivebackPct",
    "exitPolicy.tightenAtTenXGivebackPct",
    "exitPolicy.progressiveTrailEnabled",
    "exitPolicy.progressiveTrailSteps",
    "exitPolicy.wireGreekTrail.enabled",
    "exitPolicy.wireGreekTrail.requireFreshGreeks",
    "exitPolicy.wireGreekTrail.rungByProfit",
    "exitPolicy.wireGreekTrail.runnerPollIntervalSeconds",
    "exitPolicy.wireGreekTrail.greekMaxAgeMs",
    "exitPolicy.wireGreekTrail.deltaSizingEnabled",
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
  assert.match(
    settingsFieldsSource,
    /path:\s*"entryGate\.mtfAlignment\.requiredCount"[\s\S]*?max:\s*6/,
  );
  assert.match(settingsRegionSource, /field\.unit === "matches"\) return "of 6"/);
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
  assert.ok(
    SETTINGS_SECTIONS.every((section) => Array.isArray(section.summary)),
    "each settings section should expose summary metadata",
  );
  assert.deepEqual(
    SETTINGS_SECTIONS.find((section) => section.id === "contract")?.summary.map(
      (item) => item.kind,
    ),
    ["dteWindow", "strikeSlots", "strikeSlots"],
  );
  assert.deepEqual(
    SETTINGS_SECTIONS.find((section) => section.id === "gates")?.summary.map(
      (item) => item.path || item.kind,
    ),
    [
      "entryGate.mtfAlignment.enabled",
      "entryGate.mtfAlignment.requiredCount",
      "entryGate.mtfAlignment.preset",
      "entryGate.mtfAlignment.timeframes",
      "entryGate.bearishRegime.enabled",
      "entryGate.bearishRegime.minAdx",
    ],
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
    "entryGate.mtfAlignment.preset",
    "entryGate.mtfAlignment.timeframes",
    "liquidityGate.requireFreshQuote",
    "fillPolicy.ttlSeconds",
    "optionSelection.allowZeroDte",
    "optionSelection.minDte",
    "exitPolicy.progressiveTrailEnabled",
    "exitPolicy.progressiveTrailSteps",
    "exitPolicy.wireGreekTrail.enabled",
    "exitPolicy.wireGreekTrail.rungByProfit",
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
  assert.match(settingsFieldsSource, /MTF TIMEFRAMES/);
  assert.match(settingsRegionSource, /field\.type === "timeframeChips"/);
  assert.match(settingsFieldsSource, /CHOCH ATR BUFFER/);
  assert.match(settingsFieldsSource, /5X GIVEBACK %/);
  assert.match(settingsFieldsSource, /10X GIVEBACK %/);
  assert.match(settingsFieldsSource, /PROGRESSIVE TRAIL/);
  assert.match(settingsFieldsSource, /WIRE GREEK TRAIL/);
  assert.match(settingsFieldsSource, /conditionalQualityExitsEnabled/);
  assert.match(settingsFieldsSource, /highQualityOvernightMinGainPct/);
  assert.match(settingsFieldsSource, /overnightExitEnabled/);
  assert.match(settingsFieldsSource, /SETTINGS_SECTIONS/);
  assert.match(settingsFieldsSource, /summary:\s*\[/);
  assert.match(settingsFieldsSource, /kind: "field"/);
  assert.match(settingsFieldsSource, /kind: "dteWindow"/);
  assert.match(settingsFieldsSource, /kind: "strikeSlots"/);
  assert.match(settingsFieldsSource, /kind: "contractSelect"/);
  assert.match(settingsFieldsSource, /kind: "exitTrack"/);
  assert.match(settingsFieldsSource, /kind: "exitProgressiveTrail"/);
  assert.match(settingsFieldsSource, /kind: "exitWireTrail"/);
  assert.match(settingsFieldsSource, /kind: "exitTimingRules"/);
  assert.match(settingsRegionSource, /SETTINGS_SECTIONS\.map/);
  assert.match(settingsRegionSource, /SectionSummaryStrip/);
  assert.match(settingsRegionSource, /buildSectionSummaryItem/);
  assert.match(settingsRegionSource, /summaryItemDirty/);
  assert.match(settingsRegionSource, /data-testid=\{`algo-settings-section-summary-\$\{section\.id\}`\}/);
  assert.match(settingsRegionSource, /data-algo-pocket-grid="two"/);
  assert.match(settingsRegionSource, /ContractSelectionCell/);
  assert.match(settingsRegionSource, /ExitLadderTrack/);
  assert.match(settingsRegionSource, /ProgressiveTrailCell/);
  assert.match(settingsRegionSource, /WireTrailCell/);
  assert.match(settingsRegionSource, /ExitTimingRulesCell/);
  assert.match(settingsRegionSource, /testId="algo-exit-progressive-trail"/);
  assert.match(settingsRegionSource, /data-testid="algo-progressive-trail-preview"/);
  assert.match(settingsRegionSource, /testId="algo-exit-wire-trail"/);
  assert.match(settingsRegionSource, /data-testid="algo-wire-trail-rung-preview"/);
  assert.match(settingsRegionSource, /testId="algo-exit-timing-rules"/);
  assert.match(settingsRegionSource, /className="algo-settings-grid"/);
  assert.match(settingsRegionSource, /openSections/);
  assert.match(settingsRegionSource, /setOpenSections/);
  assert.match(settingsRegionSource, /collapsible/);
  assert.match(settingsRegionSource, /section\.defaultOpen/);
  const sectionHeaderSource = readFileSync(
    new URL("./SettingsSectionHeader.jsx", import.meta.url),
    "utf8",
  );
  assert.match(sectionHeaderSource, /aria-expanded=\{open\}/);
  assert.match(sectionHeaderSource, /aria-controls=\{controlsId\}/);
  assert.match(sectionHeaderSource, /ChevronRight/);
  const coreSections = new Set(["risk", "contract", "exits"]);
  for (const section of SETTINGS_SECTIONS) {
    assert.equal(
      section.defaultOpen,
      coreSections.has(section.id),
      `section ${section.id} default open mismatch`,
    );
  }
  assert.match(settingsRegionSource, /DteTimelineEditor/);
  assert.match(settingsRegionSource, /data-testid="algo-contract-dte-timeline"/);
  assert.match(settingsRegionSource, /data-testid="algo-contract-dte-rail"/);
  assert.match(settingsRegionSource, /data-testid=\{`algo-contract-dte-handle-\$\{marker\.key\}`\}/);
  assert.match(settingsRegionSource, /data-testid="algo-contract-selection-summary"/);
  assert.match(settingsRegionSource, /data-testid="algo-mini-chain"/);
  assert.match(settingsRegionSource, /STRIKE_SLOT_META/);
  assert.match(settingsRegionSource, /const ChainStrikeButton/);
  assert.match(settingsRegionSource, /formatDteWindowLabel/);
  assert.match(settingsRegionSource, /data-testid=\{`algo-strike-ladder-\$\{side\.toLowerCase\(\)\}-\$\{slot\}`\}/);
  assert.match(settingsRegionSource, /role="checkbox"[\s\S]*?aria-checked=\{selected\}/);
  assert.match(settingsRegionSource, /MAX_SIGNAL_OPTIONS_STRIKE_SLOTS/);
  assert.match(settingsRegionSource, /normalizeSignalOptionsStrikeSlots/);
  assert.match(settingsRegionSource, /STRIKE_SLOT_VALUES_DESC/);
  assert.match(settingsRegionSource, /role="group"[\s\S]*?aria-label="Call strike slots"/);
  assert.match(settingsRegionSource, /role="group"[\s\S]*?aria-label="Put strike slots"/);
  assert.match(settingsRegionSource, /aria-label=\{`\$\{label\} strike slot unsaved`\}/);
  assert.match(settingsRegionSource, /patchProfileDraftPath\(slotsField\.path, normalized\)/);
  assert.match(settingsRegionSource, /patchProfileDraftPath\(primaryField\.path, normalized\[0\]\)/);
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
  const saveBarSource = readFileSync(
    new URL("./AlgoSaveBar.jsx", import.meta.url),
    "utf8",
  );
  assert.match(saveBarSource, /Save changes/);
  assert.match(
    saveBarSource,
    /const saveDisabled = !focusedDeployment \|\| !isDirty \|\| pending;/,
  );
  assert.doesNotMatch(saveBarSource, /controlBaselineReady/);
  assert.match(screenSource, /saveAllAlgoAdjustments/);
  assert.doesNotMatch(saveAllSource, /Promise\.allSettled/);
  assert.match(saveAllSource, /for \(const task of tasks\)/);
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
  assert.match(positionsSource, /Shadow algo positions/);
  assert.match(positionsSource, /Runtime algo positions/);
  assert.match(positionsSource, /assetFilter="all"/);
  assert.match(positionsSource, /filterAccountPositionRowsForDeployment/);
  assert.match(positionsSource, /accountPositionsSettled/);
  assert.match(positionsSource, /useAccountPositionRows/);
  assert.match(
    positionsSource,
    /useAccountPositionRows \? scopedAccountRows : runtimeRows/,
  );
  assert.doesNotMatch(positionsSource, /mergeAlgoRuntimeAndAccountPositionRows/);
  assert.match(positionsSource, /liveOptionQuotesEnabled=\{true\}/);
  assert.match(positionsSource, /streamLiveOptionQuotes=\{true\}/);
  assert.doesNotMatch(positionsSource, /hasAccountPositionsQuery/);
  assert.match(positionsSource, /useStoredOptionQuoteSnapshotVersion/);
  assert.match(positionsSource, /showFilters=\{false\}/);
  assert.match(accountPositionsSource, /column\.id === "quote"/);
  assert.match(accountPositionsSource, /formatPositionBidAskPair/);
  assert.match(accountPositionsSource, /column\.id === "greeks"/);
  assert.match(accountPositionsSource, /DenseSignalCell/);
  assert.match(accountPositionsSource, /data-testid="account-positions-table-scroll"/);
  assert.doesNotMatch(accountPositionsSource, /data-testid="account-position-context-strip"/);
  assert.match(screenSource, /useGetAccountPositions/);
  assert.match(screenSource, /assetClass:\s*"all"/);
  assert.match(screenSource, /source:\s*"automation"/);
  assert.match(screenSource, /liveQuotes:\s*false/);
  assert.match(livePageSource, /signalOptionsLedgerPositionsQuery/);
  assert.match(livePageSource, /ledgerPositions: focusedLedgerPositions/);
  assert.match(livePageSource, /signals: visibleSignalRows/);
  assert.match(livePageSource, /const hasClosedRecord = recordTradeCount > 0/);
  assert.match(livePageSource, /value: hasClosedRecord \? `\$\{wins\}W \/ \$\{losses\}L` : "No exits"/);
  assert.match(livePageSource, /: "no closed trades"/);
  assert.match(livePageSource, /hasClosedRecord && Number\.isFinite\(profitFactor\)/);
  assert.match(livePageSource, /Pyrus Signal-Options/);
  assert.match(livePageSource, /showClearState=\{false\}/);
  assert.match(livePageSource, /showEmptyState=\{false\}/);
  assert.match(livePageSource, /grouped/);
  assert.doesNotMatch(livePageSource, /Pyrus Signals Shadow/);
  assert.doesNotMatch(livePageSource, /label:\s*"Scan"/);
  assert.doesNotMatch(livePageSource, /label:\s*"Event"/);
  assert.doesNotMatch(livePageSource, /label:\s*"Signals"/);
  assert.doesNotMatch(livePageSource, /label:\s*"Flow"/);
  assert.match(livePageSource, /source === "preview" \? "preview" : "primary"/);
  assert.match(livePageSource, /signal-options-preview:\$\{focusedDeploymentId \|\| "active"\}:\$\{group\.underlying\}/);
  assert.match(livePageSource, /limitAlgoOptionQuoteGroups\(groups, ALGO_OPTION_QUOTE_CONTRACT_LIMIT\)/);
  assert.match(livePageSource, /owner=\{group\.owner\}/);
  assert.match(livePageSource, /requiresGreeks=\{group\.requiresGreeks\}/);
  assert.match(drillSource, /contractSelection/);
  assert.match(drillSource, /quoteUpdatedAt/);
  assert.match(livePageSource, /useIbkrOptionQuoteStream/);
  assert.match(livePageSource, /automation-live/);
});

test("algo setup does not hide operations shell before true empty deployment data", () => {
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
  assert.match(livePageSource, /const showEmptyOperationsState = Boolean\(setupDataSettled && !deployments\.length\)/);
  assert.match(livePageSource, /if \(showEmptyOperationsState\) \{/);
  assert.doesNotMatch(livePageSource, /if \(!deployments\.length\) \{/);
  assert.match(livePageSource, /data-testid="algo-setup-loading"/);
  assert.match(livePageSource, /Loading Signal Operations/);
  assert.match(livePageSource, /Loading algo deployments and signal-options state/);
  assert.match(livePageSource, /Signal-Options Deployment Unavailable/);
  assert.match(livePageSource, /CREATE SIGNAL-OPTIONS DEPLOYMENT/);
  assert.doesNotMatch(livePageSource, /Setup Shadow Deployment/);
  assert.doesNotMatch(livePageSource, /Shadow deployments paper-trade/);
  assert.doesNotMatch(livePageSource, /Loading promoted drafts and shadow deployments/);
  assert.doesNotMatch(livePageSource, /No promoted draft strategies/);
  assert.doesNotMatch(livePageSource, /CREATE SHADOW DEPLOYMENT/);
  assert.ok(
    livePageSource.indexOf("!setupDataSettled ?") <
      livePageSource.indexOf("Restart the API"),
  );
});

test("algo screen auto-runs an initial scan and labels sync separately", () => {
  const screenSource = readFileSync(
    new URL("../AlgoScreen.jsx", import.meta.url),
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
  assert.match(screenSource, /algoExecutionScanRunning/);
  assert.match(
    screenSource,
    /autoInitialScanDeploymentIdsRef\.current\.add\(deploymentId\)/,
  );
  assert.match(
    screenSource,
    /runShadowScanMutation\.mutate\(\{ deploymentId, requestSource: "auto" \}\)/,
  );
  assert.match(screenSource, /variables\?\.requestSource === "auto"/);
  assert.match(screenSource, /state\?\.status === "already_running"/);
  assert.match(screenSource, /Algo & Execution scan already running/);
  assert.match(screenSource, /The active options strategy scan will finish/);
  assert.doesNotMatch(screenSource, /Shadow scan already running/);
  assert.doesNotMatch(screenSource, /Shadow scan complete/);
  assert.doesNotMatch(screenSource, /Shadow scan failed/);
  assert.doesNotMatch(screenSource, /LazyAlgoStatusBar/);
  assert.doesNotMatch(screenSource, /data-testid="algo-status-bar"/);
  assert.match(livePageSource, /data-testid="algo-operations-deployment-select"/);
  assert.doesNotMatch(livePageSource, /watchlistId/);
  assert.match(livePageSource, /scanMutationPending/);
  assert.match(livePageSource, /scanOperationRunning/);
  assert.match(livePageSource, /\? "scan running"/);
  assert.match(livePageSource, /\? "syncing state"/);
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
  const livePageSource = readFileSync(
    new URL("./AlgoLivePage.jsx", import.meta.url),
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

  [
    haltSource,
    statusBarSource,
    auditSource,
    platformSidebarSource,
    livePageSource,
  ].forEach(
    (source) => {
      assert.match(source, /normalizeLegacyAlgoBrandText/);
      assert.doesNotMatch(source, /RAY\s*·/);
    },
  );
});
