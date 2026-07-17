export type SignalOptionsStrikeSlot = 0 | 1 | 2 | 3 | 4 | 5;
export type SignalOptionsRight = "call" | "put";

export type SignalOptionsProgressiveTrailStep = {
  activationPct: number;
  minLockedGainPct: number;
  givebackPct: number;
};

export type SignalOptionsWireTrailRung =
  | "trendLine"
  | "wire1"
  | "wire2"
  | "wire3";

export type SignalOptionsWireTrailStep = {
  activationPct: number;
  rung: SignalOptionsWireTrailRung;
};

export type SignalOptionsWireGreekTrailPolicy = {
  enabled: boolean;
  requireFreshGreeks: boolean;
  greekMaxAgeMs: number;
  deltaSizingEnabled: boolean;
  runnerPollIntervalSeconds: number;
  rungByProfit: SignalOptionsWireTrailStep[];
  deltaLoosenThreshold: number;
  deltaTightenThreshold: number;
  thetaBurdenTightenPct: number;
  strongGammaMin: number;
  spreadWideningMultiplier: number;
};

export type SignalOptionsGreekPositionManagementPolicy = {
  enabled: boolean;
};

export type SignalOptionsScaleOutPolicy = {
  enabled: boolean;
  sellFractionPct: number;
  runnerGivebackPct: number;
};

export type SignalOptionsOppositeSignalDualConfirmPolicy = {
  enabled: boolean;
  firstBarSellFractionPct: number;
};

export type SignalOptionsReEntryWatchPolicy = {
  enabled: boolean;
  watchWindowBars: number;
  maxReEntriesPerSignal: number;
};

export type SignalOptionsGreekSelectorMode = "off" | "shadow" | "live" | "all";
export type SignalOptionsMtfTimeframe = "1m" | "2m" | "5m" | "15m" | "1h" | "1d";
export type SignalOptionsMtfPreset =
  | "custom"
  | "scalp"
  | "balanced"
  | "higher_timeframe"
  | "six_frame";

export type SignalOptionsGreekSelectorPolicy = {
  enabled: boolean;
  mode: SignalOptionsGreekSelectorMode;
  fallbackToLegacy: boolean;
  maxCandidates: number;
  minScore: number;
  requireLiveGreeks: boolean;
};

export type SignalOptionsExecutionProfile = {
  version: "v1";
  mode: "shadow";
  optionSelection: {
    minDte: number;
    targetDte: number;
    maxDte: number;
    allowZeroDte: boolean;
    callStrikeSlots: SignalOptionsStrikeSlot[];
    putStrikeSlots: SignalOptionsStrikeSlot[];
    callStrikeSlot: SignalOptionsStrikeSlot;
    putStrikeSlot: SignalOptionsStrikeSlot;
    greekSelector: SignalOptionsGreekSelectorPolicy;
  };
  riskCaps: {
    maxPremiumPerEntry: number;
    maxContracts: number;
    maxOpenSymbols: number;
    maxDailyLoss: number;
    tradingAllowance: number;
    allowanceBasis: "cost" | "mark";
  };
  entryGate: {
    entryCutoffMinutesBeforeClose: number;
    mtfAlignment: {
      enabled: boolean;
      requiredCount: number;
      timeframes: SignalOptionsMtfTimeframe[];
      preset: SignalOptionsMtfPreset;
    };
    // Divergence-aware gate: requires the LIVE per-timeframe signal matrix to
    // match every non-"any" entry EXACTLY. Populated by promoting a
    // discovered MTF pattern. Optional so existing profiles need no migration.
    mtfPattern?: {
      enabled: boolean;
      pattern: Record<string, "buy" | "sell" | "any">;
    };
    blockedPutSymbols: string[];
  };
  liquidityGate: {
    maxSpreadPctOfMid: number;
    minBid: number;
    requireBidAsk: boolean;
    requireFreshQuote: boolean;
  };
  fillPolicy: {
    chaseMode: "aggressive";
    ttlSeconds: number;
    chaseSteps: number[];
  };
  exitPolicy: {
    stopConfirmationWindowMs: number;
    stopConfirmationMaxQuoteAgeMs: number;
    hardStopPct: number;
    trailActivationPct: number;
    minLockedGainPct: number;
    trailGivebackPct: number;
    progressiveTrailEnabled: boolean;
    progressiveTrailSteps: SignalOptionsProgressiveTrailStep[];
    scaleOut: SignalOptionsScaleOutPolicy;
    oppositeSignalDualConfirm: SignalOptionsOppositeSignalDualConfirmPolicy;
    reEntryWatch: SignalOptionsReEntryWatchPolicy;
    wireGreekTrail: SignalOptionsWireGreekTrailPolicy;
    greekPositionManagement: SignalOptionsGreekPositionManagementPolicy;
    flipOnOppositeSignal: boolean;
    earlyExitBars: number;
    earlyExitLossPct: number;
    overnightExitEnabled: boolean;
    overnightMinGainExitEnabled: boolean;
    overnightMinGainPct: number;
    overnightRunnerGivebackPct: number;
    highQualityOvernightRunnerGivebackPct: number;
    conditionalQualityExitsEnabled: boolean;
    lowQualityEarlyExitBars: number;
    lowQualityEarlyExitLossPct: number;
    highQualityEarlyExitBars: number;
    highQualityEarlyExitLossPct: number;
    weakLiquidityTrailGivebackPct: number;
    strongLiquidityTrailGivebackPct: number;
    highQualityOvernightMinGainPct: number;
  };
  riskHaltControls: {
    dailyLossHaltEnabled: boolean;
    openSymbolCapEnabled: boolean;
    premiumBudgetEnabled: boolean;
    tradingAllowanceEnabled: boolean;
  };
  entryHaltControls: {
    mtfAlignmentEnabled: boolean;
    inversePutBlocklistEnabled: boolean;
  };
  liquidityHaltControls: {
    bidAskRequiredEnabled: boolean;
    freshQuoteRequiredEnabled: boolean;
    spreadGateEnabled: boolean;
    minBidGateEnabled: boolean;
  };
  positionHaltControls: {
    sameDirectionPositionBlockEnabled: boolean;
    oppositeSignalFlipBlockEnabled: boolean;
    positionMarkFeedHaltEnabled: boolean;
  };
  infrastructureHaltControls: {
    gatewayReadinessBlockEnabled: boolean;
    resourcePressureScanBlockEnabled: boolean;
    contractResolutionBackoffEnabled: boolean;
  };
};

export const tunedSignalOptionsStrategySettings = {
  signalTimeframe: "5m",
  pyrusSignalsSettings: {
    timeHorizon: 8,
    bosConfirmation: "wicks",
    chochAtrBuffer: 0,
    chochBodyExpansionAtr: 0,
    chochVolumeGate: 0,
  },
} as const;

export const signalOptionsDefaultWireTrailRungs = [
  { activationPct: 35, rung: "wire3" },
  { activationPct: 65, rung: "wire2" },
  { activationPct: 100, rung: "wire1" },
  { activationPct: 200, rung: "trendLine" },
] as const satisfies readonly SignalOptionsWireTrailStep[];

export const signalOptionsAvailableMtfTimeframes = [
  "1m",
  "2m",
  "5m",
  "15m",
  "1h",
  "1d",
] as const satisfies readonly SignalOptionsMtfTimeframe[];

export const signalOptionsDefaultMtfTimeframes = [
  "1m",
  "2m",
  "5m",
  "15m",
  "1h",
] as const satisfies readonly SignalOptionsMtfTimeframe[];

export const signalOptionsMtfPresets = [
  "custom",
  "scalp",
  "balanced",
  "higher_timeframe",
  "six_frame",
] as const satisfies readonly SignalOptionsMtfPreset[];

export const defaultSignalOptionsExecutionProfile: SignalOptionsExecutionProfile =
  {
    version: "v1",
    mode: "shadow",
    optionSelection: {
      minDte: 1,
      targetDte: 1,
      maxDte: 3,
      allowZeroDte: false,
      callStrikeSlots: [3],
      putStrikeSlots: [2],
      callStrikeSlot: 3,
      putStrikeSlot: 2,
      greekSelector: {
        enabled: false,
        mode: "off",
        fallbackToLegacy: true,
        maxCandidates: 24,
        minScore: 0,
        requireLiveGreeks: true,
      },
    },
    riskCaps: {
      maxPremiumPerEntry: 500,
      maxContracts: 3,
      maxOpenSymbols: 5,
      maxDailyLoss: 1_000,
      tradingAllowance: 10_000,
      allowanceBasis: "cost",
    },
    entryGate: {
      entryCutoffMinutesBeforeClose: 15,
      mtfAlignment: {
        enabled: true,
        // Full alignment is invariant: all selected frames must agree.
        requiredCount: signalOptionsDefaultMtfTimeframes.length,
        timeframes: [...signalOptionsDefaultMtfTimeframes],
        preset: "custom",
      },
      mtfPattern: {
        enabled: false,
        pattern: {},
      },
      blockedPutSymbols: [
        "SQQQ",
        "SH",
        "PSQ",
        "DOG",
        "SDS",
        "QID",
        "TWM",
        "SPXU",
        "SDOW",
        "TZA",
      ],
    },
    liquidityGate: {
      maxSpreadPctOfMid: 35,
      minBid: 0.01,
      requireBidAsk: true,
      requireFreshQuote: true,
    },
    fillPolicy: {
      chaseMode: "aggressive",
      ttlSeconds: 20,
      chaseSteps: [0, 0.35, 0.65, 0.9],
    },
    exitPolicy: {
      stopConfirmationWindowMs: 10_000,
      stopConfirmationMaxQuoteAgeMs: 10_000,
      hardStopPct: -40,
      trailActivationPct: 40,
      minLockedGainPct: 10,
      trailGivebackPct: 25,
      progressiveTrailEnabled: false,
      progressiveTrailSteps: [],
      scaleOut: {
        enabled: false,
        sellFractionPct: 60,
        runnerGivebackPct: 30,
      },
      oppositeSignalDualConfirm: {
        enabled: false,
        firstBarSellFractionPct: 50,
      },
      reEntryWatch: {
        enabled: false,
        watchWindowBars: 6,
        maxReEntriesPerSignal: 1,
      },
      wireGreekTrail: {
        enabled: false,
        requireFreshGreeks: true,
        // Default must exceed the worst-case greek poll interval (20s) with margin,
        // else freshness gating silently disables all greek adjustments.
        greekMaxAgeMs: 45_000,
        deltaSizingEnabled: false,
        runnerPollIntervalSeconds: 20,
        rungByProfit: [...signalOptionsDefaultWireTrailRungs],
        deltaLoosenThreshold: 0.05,
        deltaTightenThreshold: -0.1,
        thetaBurdenTightenPct: 8,
        strongGammaMin: 0.05,
        spreadWideningMultiplier: 1.5,
      },
      greekPositionManagement: {
        enabled: false,
      },
      flipOnOppositeSignal: true,
      earlyExitBars: 0,
      earlyExitLossPct: 0,
      overnightExitEnabled: false,
      overnightMinGainExitEnabled: false,
      overnightMinGainPct: 20,
      overnightRunnerGivebackPct: 15,
      highQualityOvernightRunnerGivebackPct: 25,
      conditionalQualityExitsEnabled: false,
      lowQualityEarlyExitBars: 4,
      lowQualityEarlyExitLossPct: 15,
      highQualityEarlyExitBars: 8,
      highQualityEarlyExitLossPct: 25,
      weakLiquidityTrailGivebackPct: 15,
      strongLiquidityTrailGivebackPct: 25,
      highQualityOvernightMinGainPct: -100,
    },
    riskHaltControls: {
      dailyLossHaltEnabled: true,
      openSymbolCapEnabled: true,
      premiumBudgetEnabled: true,
      tradingAllowanceEnabled: false,
    },
    entryHaltControls: {
      mtfAlignmentEnabled: true,
      inversePutBlocklistEnabled: true,
    },
    liquidityHaltControls: {
      bidAskRequiredEnabled: true,
      freshQuoteRequiredEnabled: true,
      spreadGateEnabled: true,
      minBidGateEnabled: true,
    },
    positionHaltControls: {
      sameDirectionPositionBlockEnabled: true,
      oppositeSignalFlipBlockEnabled: true,
      positionMarkFeedHaltEnabled: true,
    },
    infrastructureHaltControls: {
      gatewayReadinessBlockEnabled: true,
      resourcePressureScanBlockEnabled: true,
      contractResolutionBackoffEnabled: true,
    },
  };

export const aggressiveSignalOptionsProgressiveTrailSteps = [
  { activationPct: 20, minLockedGainPct: 0, givebackPct: 30 },
  { activationPct: 30, minLockedGainPct: 15, givebackPct: 25 },
  { activationPct: 45, minLockedGainPct: 25, givebackPct: 20 },
  { activationPct: 65, minLockedGainPct: 40, givebackPct: 20 },
  { activationPct: 100, minLockedGainPct: 60, givebackPct: 15 },
] as const;

export const tunedSignalOptionsExecutionProfilePatch = {
  optionSelection: {
    greekSelector: {
      enabled: true,
      mode: "all",
      fallbackToLegacy: true,
      maxCandidates: 24,
      minScore: 0,
      requireLiveGreeks: true,
    },
  },
  riskCaps: {
    maxOpenSymbols: 10,
    maxPremiumPerEntry: 1_500,
  },
  exitPolicy: {
    hardStopPct: -30,
    trailActivationPct: 35,
    minLockedGainPct: 15,
    trailGivebackPct: 20,
    progressiveTrailEnabled: true,
    progressiveTrailSteps: aggressiveSignalOptionsProgressiveTrailSteps,
    scaleOut: {
      enabled: false,
      sellFractionPct: 60,
      runnerGivebackPct: 30,
    },
    oppositeSignalDualConfirm: {
      enabled: false,
      firstBarSellFractionPct: 50,
    },
    reEntryWatch: {
      enabled: false,
      watchWindowBars: 6,
      maxReEntriesPerSignal: 1,
    },
    wireGreekTrail: {
      enabled: true,
      requireFreshGreeks: true,
      // Default must exceed the worst-case greek poll interval (20s) with margin,
      // else freshness gating silently disables all greek adjustments.
      greekMaxAgeMs: 45_000,
      deltaSizingEnabled: false,
      runnerPollIntervalSeconds: 20,
      rungByProfit: signalOptionsDefaultWireTrailRungs,
      deltaLoosenThreshold: 0.05,
      deltaTightenThreshold: -0.1,
      thetaBurdenTightenPct: 8,
      strongGammaMin: 0.05,
      spreadWideningMultiplier: 1.5,
    },
    overnightExitEnabled: true,
    overnightMinGainExitEnabled: false,
    overnightMinGainPct: 10,
    overnightRunnerGivebackPct: 15,
    highQualityOvernightRunnerGivebackPct: 25,
    // P3 2026-07-07: high-quality bullish runners carry overnight on wider trails by default.
    conditionalQualityExitsEnabled: true,
    earlyExitBars: 8,
    earlyExitLossPct: 25,
  },
} as const;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function finiteNumber(value: unknown, fallback: number, min: number, max: number) {
  if (
    typeof value !== "number" &&
    (typeof value !== "string" || value.trim() === "")
  ) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function finiteInteger(value: unknown, fallback: number, min: number, max: number) {
  return Math.round(finiteNumber(value, fallback, min, max));
}

function booleanValue(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function signalOptionsMtfTimeframes(
  value: unknown,
  fallback: readonly SignalOptionsMtfTimeframe[],
): SignalOptionsMtfTimeframe[] {
  const allowed = new Set<SignalOptionsMtfTimeframe>(
    signalOptionsAvailableMtfTimeframes,
  );
  const source = Array.isArray(value) ? value : [];
  const timeframes: SignalOptionsMtfTimeframe[] = [];
  for (const item of source) {
    const timeframe = String(item || "").trim() as SignalOptionsMtfTimeframe;
    if (allowed.has(timeframe) && !timeframes.includes(timeframe)) {
      timeframes.push(timeframe);
    }
  }
  return timeframes.length ? timeframes : [...fallback];
}

function signalOptionsMtfPreset(value: unknown): SignalOptionsMtfPreset {
  const preset = String(value || "").trim() as SignalOptionsMtfPreset;
  return signalOptionsMtfPresets.includes(preset) ? preset : "custom";
}

const MAX_SIGNAL_OPTIONS_STRIKE_SLOTS = 3;

function parseStrikeSlot(value: unknown): SignalOptionsStrikeSlot | null {
  const parsed = finiteNumber(value, Number.NaN, 0, 5);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.round(parsed) as SignalOptionsStrikeSlot;
}

function strikeSlots(
  value: unknown,
  legacyValue: unknown,
  fallback: SignalOptionsStrikeSlot[],
): SignalOptionsStrikeSlot[] {
  const source = Array.isArray(value) ? value : [legacyValue];
  const slots: SignalOptionsStrikeSlot[] = [];
  for (const item of source) {
    const slot = parseStrikeSlot(item);
    if (slot != null && !slots.includes(slot)) {
      slots.push(slot);
    }
    if (slots.length >= MAX_SIGNAL_OPTIONS_STRIKE_SLOTS) {
      break;
    }
  }
  if (slots.length) {
    return slots;
  }
  return fallback.length ? fallback.slice(0, MAX_SIGNAL_OPTIONS_STRIKE_SLOTS) : [3];
}

function chaseSteps(value: unknown, fallback: number[]) {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const steps = value
    .map((step) => finiteNumber(step, Number.NaN, 0, 1))
    .filter((step) => Number.isFinite(step));
  return steps.length ? Array.from(new Set(steps)).sort((a, b) => a - b) : fallback;
}

const SIGNAL_OPTIONS_GREEK_SELECTOR_MODES: readonly SignalOptionsGreekSelectorMode[] =
  ["off", "shadow", "live", "all"];

function greekSelectorMode(
  value: unknown,
  fallback: SignalOptionsGreekSelectorMode,
): SignalOptionsGreekSelectorMode {
  const normalized = String(value || "").trim() as SignalOptionsGreekSelectorMode;
  return SIGNAL_OPTIONS_GREEK_SELECTOR_MODES.includes(normalized)
    ? normalized
    : fallback;
}

function greekSelectorPolicy(
  value: unknown,
  root: Record<string, unknown>,
  fallback: SignalOptionsGreekSelectorPolicy,
): SignalOptionsGreekSelectorPolicy {
  const source = asRecord(value);
  const enabled = booleanValue(
    source.enabled ?? root.greekSelectorEnabled,
    fallback.enabled,
  );
  const mode = greekSelectorMode(
    source.mode ?? root.greekSelectorMode,
    fallback.mode,
  );
  return {
    enabled,
    mode: enabled ? mode : "off",
    fallbackToLegacy: booleanValue(
      source.fallbackToLegacy ?? root.greekSelectorFallbackToLegacy,
      fallback.fallbackToLegacy,
    ),
    maxCandidates: finiteInteger(
      source.maxCandidates ?? root.greekSelectorMaxCandidates,
      fallback.maxCandidates,
      1,
      200,
    ),
    minScore: finiteNumber(
      source.minScore ?? root.greekSelectorMinScore,
      fallback.minScore,
      0,
      100,
    ),
    requireLiveGreeks: booleanValue(
      source.requireLiveGreeks ?? root.greekSelectorRequireLiveGreeks,
      fallback.requireLiveGreeks,
    ),
  };
}

function progressiveTrailSteps(
  value: unknown,
  fallback: SignalOptionsProgressiveTrailStep[],
) {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const steps = value
    .map((step) => asRecord(step))
    .map((step) => ({
      activationPct: finiteNumber(step.activationPct, Number.NaN, 0, 10_000),
      minLockedGainPct: finiteNumber(step.minLockedGainPct, Number.NaN, 0, 10_000),
      givebackPct: finiteNumber(step.givebackPct, Number.NaN, 0, 100),
    }))
    .filter(
      (step) =>
        Number.isFinite(step.activationPct) &&
        Number.isFinite(step.minLockedGainPct) &&
        Number.isFinite(step.givebackPct),
    )
    .sort((left, right) => left.activationPct - right.activationPct);

  return steps.length ? steps : fallback;
}

function scaleOutPolicy(
  value: unknown,
  root: Record<string, unknown>,
  fallback: SignalOptionsScaleOutPolicy,
): SignalOptionsScaleOutPolicy {
  const source = asRecord(value);
  return {
    enabled: booleanValue(source.enabled ?? root.scaleOutEnabled, fallback.enabled),
    sellFractionPct: finiteNumber(
      source.sellFractionPct ?? root.scaleOutSellFractionPct,
      fallback.sellFractionPct,
      1,
      99,
    ),
    runnerGivebackPct: finiteNumber(
      source.runnerGivebackPct ?? root.scaleOutRunnerGivebackPct,
      fallback.runnerGivebackPct,
      0,
      100,
    ),
  };
}

function oppositeSignalDualConfirmPolicy(
  value: unknown,
  root: Record<string, unknown>,
  fallback: SignalOptionsOppositeSignalDualConfirmPolicy,
): SignalOptionsOppositeSignalDualConfirmPolicy {
  const source = asRecord(value);
  return {
    enabled: booleanValue(
      source.enabled ?? root.oppositeSignalDualConfirmEnabled,
      fallback.enabled,
    ),
    firstBarSellFractionPct: finiteNumber(
      source.firstBarSellFractionPct ??
        root.oppositeSignalDualConfirmFirstBarSellFractionPct,
      fallback.firstBarSellFractionPct,
      1,
      99,
    ),
  };
}

function reEntryWatchPolicy(
  value: unknown,
  root: Record<string, unknown>,
  fallback: SignalOptionsReEntryWatchPolicy,
): SignalOptionsReEntryWatchPolicy {
  const source = asRecord(value);
  return {
    enabled: booleanValue(
      source.enabled ?? root.reEntryWatchEnabled,
      fallback.enabled,
    ),
    watchWindowBars: finiteInteger(
      source.watchWindowBars ?? root.reEntryWatchWindowBars,
      fallback.watchWindowBars,
      1,
      100,
    ),
    maxReEntriesPerSignal: finiteInteger(
      source.maxReEntriesPerSignal ?? root.reEntryWatchMaxReEntriesPerSignal,
      fallback.maxReEntriesPerSignal,
      1,
      20,
    ),
  };
}

const SIGNAL_OPTIONS_WIRE_TRAIL_RUNGS: readonly SignalOptionsWireTrailRung[] = [
  "trendLine",
  "wire1",
  "wire2",
  "wire3",
];

function wireTrailRung(
  value: unknown,
  fallback: SignalOptionsWireTrailRung,
): SignalOptionsWireTrailRung {
  const resolved = String(value || "").trim() as SignalOptionsWireTrailRung;
  return SIGNAL_OPTIONS_WIRE_TRAIL_RUNGS.includes(resolved)
    ? resolved
    : fallback;
}

function wireTrailSteps(
  value: unknown,
  fallback: SignalOptionsWireTrailStep[],
): SignalOptionsWireTrailStep[] {
  if (!Array.isArray(value)) {
    return fallback.map((step) => ({ ...step }));
  }

  const steps = value
    .map((step) => asRecord(step))
    .map((step) => ({
      activationPct: finiteNumber(step.activationPct, Number.NaN, 0, 10_000),
      rung: wireTrailRung(step.rung, "wire3"),
    }))
    .filter((step) => Number.isFinite(step.activationPct))
    .sort((left, right) => left.activationPct - right.activationPct);

  return steps.length ? steps : fallback.map((step) => ({ ...step }));
}

function wireGreekTrailPolicy(
  value: unknown,
  root: Record<string, unknown>,
  fallback: SignalOptionsWireGreekTrailPolicy,
): SignalOptionsWireGreekTrailPolicy {
  const source = asRecord(value);
  return {
    enabled: booleanValue(source.enabled ?? root.wireGreekTrailEnabled, fallback.enabled),
    requireFreshGreeks: booleanValue(
      source.requireFreshGreeks ?? root.wireGreekTrailRequireFreshGreeks,
      fallback.requireFreshGreeks,
    ),
    greekMaxAgeMs: finiteInteger(
      source.greekMaxAgeMs ?? root.wireGreekTrailGreekMaxAgeMs,
      fallback.greekMaxAgeMs,
      1_000,
      300_000,
    ),
    deltaSizingEnabled: booleanValue(
      source.deltaSizingEnabled ?? root.wireGreekTrailDeltaSizingEnabled,
      fallback.deltaSizingEnabled,
    ),
    runnerPollIntervalSeconds: finiteInteger(
      source.runnerPollIntervalSeconds ??
        root.wireGreekTrailRunnerPollIntervalSeconds,
      fallback.runnerPollIntervalSeconds,
      15,
      3_600,
    ),
    rungByProfit: wireTrailSteps(
      source.rungByProfit ?? root.wireGreekTrailRungByProfit,
      fallback.rungByProfit,
    ),
    deltaLoosenThreshold: finiteNumber(
      source.deltaLoosenThreshold ?? root.wireGreekTrailDeltaLoosenThreshold,
      fallback.deltaLoosenThreshold,
      -10,
      10,
    ),
    deltaTightenThreshold: finiteNumber(
      source.deltaTightenThreshold ?? root.wireGreekTrailDeltaTightenThreshold,
      fallback.deltaTightenThreshold,
      -10,
      10,
    ),
    thetaBurdenTightenPct: finiteNumber(
      source.thetaBurdenTightenPct ?? root.wireGreekTrailThetaBurdenTightenPct,
      fallback.thetaBurdenTightenPct,
      0,
      1_000,
    ),
    strongGammaMin: finiteNumber(
      source.strongGammaMin ?? root.wireGreekTrailStrongGammaMin,
      fallback.strongGammaMin,
      0,
      10,
    ),
    spreadWideningMultiplier: finiteNumber(
      source.spreadWideningMultiplier ?? root.wireGreekTrailSpreadWideningMultiplier,
      fallback.spreadWideningMultiplier,
      1,
      100,
    ),
  };
}

function greekPositionManagementPolicy(
  value: unknown,
  exitPolicy: Record<string, unknown>,
  root: Record<string, unknown>,
  fallback: SignalOptionsGreekPositionManagementPolicy,
): SignalOptionsGreekPositionManagementPolicy {
  const source = asRecord(value);
  return {
    enabled: booleanValue(
      source.enabled ??
        exitPolicy.greekPositionManagementEnabled ??
        root.greekPositionManagementEnabled,
      fallback.enabled,
    ),
  };
}

function symbolList(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const symbols = value
    .map((symbol) => String(symbol).trim().toUpperCase())
    .filter(Boolean);
  return symbols.length ? Array.from(new Set(symbols)).sort() : fallback;
}

export function resolveSignalOptionsExecutionProfile(
  input: unknown,
): SignalOptionsExecutionProfile {
  const source = asRecord(input);
  const signalOptions = asRecord(source.signalOptions);
  const signalOptionsProfile = asRecord(source.signalOptionsProfile);
  const nested =
    Object.keys(signalOptions).length > 0
      ? signalOptions
      : Object.keys(signalOptionsProfile).length > 0
        ? signalOptionsProfile
        : asRecord(asRecord(source.executionProfile).signalOptions);
  const root = Object.keys(nested).length ? nested : source;
  const defaults = defaultSignalOptionsExecutionProfile;
  const optionSelection = asRecord(root.optionSelection);
  const riskCaps = asRecord(root.riskCaps);
  const entryGate = asRecord(root.entryGate);
  const mtfAlignment = asRecord(entryGate.mtfAlignment ?? root.mtfAlignment);
  const mtfPattern = asRecord(entryGate.mtfPattern);
  const mtfTimeframes = signalOptionsMtfTimeframes(
    mtfAlignment.timeframes ?? root.mtfTimeframes,
    defaults.entryGate.mtfAlignment.timeframes,
  );
  const liquidityGate = asRecord(root.liquidityGate);
  const fillPolicy = asRecord(root.fillPolicy);
  const exitPolicy = asRecord(root.exitPolicy);
  const riskHaltControls = asRecord(root.riskHaltControls);
  const entryHaltControls = asRecord(root.entryHaltControls);
  const liquidityHaltControls = asRecord(root.liquidityHaltControls);
  const positionHaltControls = asRecord(root.positionHaltControls);
  const infrastructureHaltControls = asRecord(root.infrastructureHaltControls);
  const minDte = finiteInteger(
    optionSelection.minDte ?? root.minDte,
    defaults.optionSelection.minDte,
    0,
    730,
  );
  const maxDte = finiteInteger(
    optionSelection.maxDte ?? root.maxDte,
    Math.max(minDte, defaults.optionSelection.maxDte),
    minDte,
    730,
  );
  const callStrikeSlots = strikeSlots(
    optionSelection.callStrikeSlots ?? root.callStrikeSlots,
    optionSelection.callStrikeSlot ?? root.callStrikeSlot,
    defaults.optionSelection.callStrikeSlots,
  );
  const putStrikeSlots = strikeSlots(
    optionSelection.putStrikeSlots ?? root.putStrikeSlots,
    optionSelection.putStrikeSlot ?? root.putStrikeSlot,
    defaults.optionSelection.putStrikeSlots,
  );

  return {
    version: "v1",
    mode: "shadow",
    optionSelection: {
      minDte,
      targetDte: finiteInteger(
        optionSelection.targetDte ?? root.targetDte,
        defaults.optionSelection.targetDte,
        minDte,
        maxDte,
      ),
      maxDte,
      allowZeroDte: booleanValue(
        optionSelection.allowZeroDte ?? root.allowZeroDte,
        defaults.optionSelection.allowZeroDte,
      ),
      callStrikeSlots,
      putStrikeSlots,
      callStrikeSlot: callStrikeSlots[0] ?? defaults.optionSelection.callStrikeSlot,
      putStrikeSlot: putStrikeSlots[0] ?? defaults.optionSelection.putStrikeSlot,
      greekSelector: greekSelectorPolicy(
        optionSelection.greekSelector ?? root.greekSelector,
        root,
        defaults.optionSelection.greekSelector,
      ),
    },
    riskCaps: {
      maxPremiumPerEntry: finiteNumber(
        riskCaps.maxPremiumPerEntry ?? root.maxPremiumPerEntry,
        defaults.riskCaps.maxPremiumPerEntry,
        1,
        1_000_000,
      ),
      maxContracts: finiteInteger(
        riskCaps.maxContracts ?? root.maxContracts,
        defaults.riskCaps.maxContracts,
        1,
        500,
      ),
      maxOpenSymbols: finiteInteger(
        riskCaps.maxOpenSymbols ?? root.maxOpenSymbols,
        defaults.riskCaps.maxOpenSymbols,
        1,
        500,
      ),
      maxDailyLoss: finiteNumber(
        riskCaps.maxDailyLoss ?? root.maxDailyLoss,
        defaults.riskCaps.maxDailyLoss,
        1,
        10_000_000,
      ),
      tradingAllowance: finiteNumber(
        riskCaps.tradingAllowance ?? root.tradingAllowance,
        defaults.riskCaps.tradingAllowance,
        100,
        10_000_000,
      ),
      allowanceBasis:
        (riskCaps.allowanceBasis ?? root.allowanceBasis) === "mark"
          ? "mark"
          : "cost",
    },
    entryGate: {
      entryCutoffMinutesBeforeClose: finiteInteger(
        entryGate.entryCutoffMinutesBeforeClose ??
          root.entryCutoffMinutesBeforeClose,
        defaults.entryGate.entryCutoffMinutesBeforeClose,
        0,
        390,
      ),
      mtfAlignment: {
        // The control panel exposes this toggle (entryGate.mtfAlignment.enabled)
        // and is authoritative; only an unset value falls back to enabled.
        enabled: booleanValue(
          mtfAlignment.enabled,
          defaults.entryGate.mtfAlignment.enabled,
        ),
        // Full alignment is invariant: every selected timeframe must agree.
        // Derive this value so stale profiles written by the retired N-of-N
        // control normalize safely on every read and subsequent persistence.
        requiredCount: Math.max(1, mtfTimeframes.length),
        timeframes: mtfTimeframes,
        preset: signalOptionsMtfPreset(
          mtfAlignment.preset ?? root.mtfAlignmentPreset,
        ),
      },
      mtfPattern: {
        enabled: booleanValue(
          mtfPattern.enabled,
          defaults.entryGate.mtfPattern?.enabled ?? false,
        ),
        pattern: Object.fromEntries(
          Object.entries(asRecord(mtfPattern.pattern)).filter(
            ([, direction]) =>
              direction === "buy" ||
              direction === "sell" ||
              direction === "any",
          ),
        ) as Record<string, "buy" | "sell" | "any">,
      },
      blockedPutSymbols: symbolList(
        entryGate.blockedPutSymbols ?? root.blockedPutSymbols,
        defaults.entryGate.blockedPutSymbols,
      ),
    },
    liquidityGate: {
      maxSpreadPctOfMid: finiteNumber(
        liquidityGate.maxSpreadPctOfMid ?? root.maxSpreadPctOfMid,
        defaults.liquidityGate.maxSpreadPctOfMid,
        0,
        500,
      ),
      minBid: finiteNumber(
        liquidityGate.minBid ?? root.minBid,
        defaults.liquidityGate.minBid,
        0,
        1_000,
      ),
      // No UI control exists; a stored false is stale data, never intent.
      requireBidAsk: true,
      requireFreshQuote: true,
    },
    fillPolicy: {
      chaseMode: "aggressive",
      ttlSeconds: finiteInteger(
        fillPolicy.ttlSeconds ?? root.ttlSeconds,
        defaults.fillPolicy.ttlSeconds,
        1,
        600,
      ),
      chaseSteps: chaseSteps(
        fillPolicy.chaseSteps ?? root.chaseSteps,
        defaults.fillPolicy.chaseSteps,
      ),
    },
    exitPolicy: {
      stopConfirmationWindowMs: finiteInteger(
        exitPolicy.stopConfirmationWindowMs ?? root.stopConfirmationWindowMs,
        defaults.exitPolicy.stopConfirmationWindowMs,
        100,
        300_000,
      ),
      stopConfirmationMaxQuoteAgeMs: finiteInteger(
        exitPolicy.stopConfirmationMaxQuoteAgeMs ?? root.stopConfirmationMaxQuoteAgeMs,
        defaults.exitPolicy.stopConfirmationMaxQuoteAgeMs,
        100,
        300_000,
      ),
      hardStopPct: finiteNumber(
        exitPolicy.hardStopPct ?? root.hardStopPct,
        defaults.exitPolicy.hardStopPct,
        -100,
        0,
      ),
      trailActivationPct: finiteNumber(
        exitPolicy.trailActivationPct ?? root.trailActivationPct,
        defaults.exitPolicy.trailActivationPct,
        0,
        10_000,
      ),
      minLockedGainPct: finiteNumber(
        exitPolicy.minLockedGainPct ?? root.minLockedGainPct,
        defaults.exitPolicy.minLockedGainPct,
        0,
        10_000,
      ),
      trailGivebackPct: finiteNumber(
        exitPolicy.trailGivebackPct ?? root.trailGivebackPct,
        defaults.exitPolicy.trailGivebackPct,
        0,
        100,
      ),
      progressiveTrailEnabled: booleanValue(
        exitPolicy.progressiveTrailEnabled ?? root.progressiveTrailEnabled,
        defaults.exitPolicy.progressiveTrailEnabled,
      ),
      progressiveTrailSteps: progressiveTrailSteps(
        exitPolicy.progressiveTrailSteps ?? root.progressiveTrailSteps,
        defaults.exitPolicy.progressiveTrailSteps,
      ),
      scaleOut: scaleOutPolicy(
        exitPolicy.scaleOut ?? root.scaleOut,
        root,
        defaults.exitPolicy.scaleOut,
      ),
      oppositeSignalDualConfirm: oppositeSignalDualConfirmPolicy(
        exitPolicy.oppositeSignalDualConfirm ?? root.oppositeSignalDualConfirm,
        root,
        defaults.exitPolicy.oppositeSignalDualConfirm,
      ),
      reEntryWatch: reEntryWatchPolicy(
        exitPolicy.reEntryWatch ?? root.reEntryWatch,
        root,
        defaults.exitPolicy.reEntryWatch,
      ),
      wireGreekTrail: wireGreekTrailPolicy(
        exitPolicy.wireGreekTrail ?? root.wireGreekTrail,
        root,
        defaults.exitPolicy.wireGreekTrail,
      ),
      greekPositionManagement: greekPositionManagementPolicy(
        exitPolicy.greekPositionManagement ?? root.greekPositionManagement,
        exitPolicy,
        root,
        defaults.exitPolicy.greekPositionManagement,
      ),
      flipOnOppositeSignal: booleanValue(
        exitPolicy.flipOnOppositeSignal ?? root.flipOnOppositeSignal,
        defaults.exitPolicy.flipOnOppositeSignal,
      ),
      earlyExitBars: finiteInteger(
        exitPolicy.earlyExitBars ?? root.earlyExitBars,
        defaults.exitPolicy.earlyExitBars,
        0,
        100,
      ),
      earlyExitLossPct: finiteNumber(
        exitPolicy.earlyExitLossPct ?? root.earlyExitLossPct,
        defaults.exitPolicy.earlyExitLossPct,
        0,
        100,
      ),
      overnightExitEnabled: booleanValue(
        exitPolicy.overnightExitEnabled ?? root.overnightExitEnabled,
        defaults.exitPolicy.overnightExitEnabled,
      ),
      overnightMinGainExitEnabled: booleanValue(
        exitPolicy.overnightMinGainExitEnabled ??
          root.overnightMinGainExitEnabled,
        defaults.exitPolicy.overnightMinGainExitEnabled,
      ),
      overnightMinGainPct: finiteNumber(
        exitPolicy.overnightMinGainPct ?? root.overnightMinGainPct,
        defaults.exitPolicy.overnightMinGainPct,
        -100,
        10_000,
      ),
      overnightRunnerGivebackPct: finiteNumber(
        exitPolicy.overnightRunnerGivebackPct ??
          root.overnightRunnerGivebackPct,
        defaults.exitPolicy.overnightRunnerGivebackPct,
        0,
        100,
      ),
      highQualityOvernightRunnerGivebackPct: finiteNumber(
        exitPolicy.highQualityOvernightRunnerGivebackPct ??
          root.highQualityOvernightRunnerGivebackPct,
        defaults.exitPolicy.highQualityOvernightRunnerGivebackPct,
        0,
        100,
      ),
      conditionalQualityExitsEnabled: booleanValue(
        exitPolicy.conditionalQualityExitsEnabled ??
          root.conditionalQualityExitsEnabled,
        defaults.exitPolicy.conditionalQualityExitsEnabled,
      ),
      lowQualityEarlyExitBars: finiteInteger(
        exitPolicy.lowQualityEarlyExitBars ?? root.lowQualityEarlyExitBars,
        defaults.exitPolicy.lowQualityEarlyExitBars,
        0,
        100,
      ),
      lowQualityEarlyExitLossPct: finiteNumber(
        exitPolicy.lowQualityEarlyExitLossPct ?? root.lowQualityEarlyExitLossPct,
        defaults.exitPolicy.lowQualityEarlyExitLossPct,
        0,
        100,
      ),
      highQualityEarlyExitBars: finiteInteger(
        exitPolicy.highQualityEarlyExitBars ?? root.highQualityEarlyExitBars,
        defaults.exitPolicy.highQualityEarlyExitBars,
        0,
        100,
      ),
      highQualityEarlyExitLossPct: finiteNumber(
        exitPolicy.highQualityEarlyExitLossPct ??
          root.highQualityEarlyExitLossPct,
        defaults.exitPolicy.highQualityEarlyExitLossPct,
        0,
        100,
      ),
      weakLiquidityTrailGivebackPct: finiteNumber(
        exitPolicy.weakLiquidityTrailGivebackPct ??
          root.weakLiquidityTrailGivebackPct,
        defaults.exitPolicy.weakLiquidityTrailGivebackPct,
        0,
        100,
      ),
      strongLiquidityTrailGivebackPct: finiteNumber(
        exitPolicy.strongLiquidityTrailGivebackPct ??
          root.strongLiquidityTrailGivebackPct,
        defaults.exitPolicy.strongLiquidityTrailGivebackPct,
        0,
        100,
      ),
      highQualityOvernightMinGainPct: finiteNumber(
        exitPolicy.highQualityOvernightMinGainPct ??
          root.highQualityOvernightMinGainPct,
        defaults.exitPolicy.highQualityOvernightMinGainPct,
        -100,
        10_000,
      ),
    },
    riskHaltControls: {
      dailyLossHaltEnabled: booleanValue(
        riskHaltControls.dailyLossHaltEnabled ?? root.dailyLossHaltEnabled,
        defaults.riskHaltControls.dailyLossHaltEnabled,
      ),
      openSymbolCapEnabled: booleanValue(
        riskHaltControls.openSymbolCapEnabled ?? root.openSymbolCapEnabled,
        defaults.riskHaltControls.openSymbolCapEnabled,
      ),
      premiumBudgetEnabled: booleanValue(
        riskHaltControls.premiumBudgetEnabled ?? root.premiumBudgetEnabled,
        defaults.riskHaltControls.premiumBudgetEnabled,
      ),
      tradingAllowanceEnabled: booleanValue(
        riskHaltControls.tradingAllowanceEnabled ??
          root.tradingAllowanceEnabled,
        defaults.riskHaltControls.tradingAllowanceEnabled,
      ),
    },
    entryHaltControls: {
      mtfAlignmentEnabled: booleanValue(
        entryHaltControls.mtfAlignmentEnabled ?? root.mtfAlignmentEnabled,
        defaults.entryHaltControls.mtfAlignmentEnabled,
      ),
      inversePutBlocklistEnabled: booleanValue(
        entryHaltControls.inversePutBlocklistEnabled ??
          root.inversePutBlocklistEnabled,
        defaults.entryHaltControls.inversePutBlocklistEnabled,
      ),
    },
    liquidityHaltControls: {
      bidAskRequiredEnabled: booleanValue(
        liquidityHaltControls.bidAskRequiredEnabled ?? root.bidAskRequiredEnabled,
        defaults.liquidityHaltControls.bidAskRequiredEnabled,
      ),
      freshQuoteRequiredEnabled: booleanValue(
        liquidityHaltControls.freshQuoteRequiredEnabled ??
          root.freshQuoteRequiredEnabled,
        defaults.liquidityHaltControls.freshQuoteRequiredEnabled,
      ),
      spreadGateEnabled: booleanValue(
        liquidityHaltControls.spreadGateEnabled ?? root.spreadGateEnabled,
        defaults.liquidityHaltControls.spreadGateEnabled,
      ),
      minBidGateEnabled: booleanValue(
        liquidityHaltControls.minBidGateEnabled ?? root.minBidGateEnabled,
        defaults.liquidityHaltControls.minBidGateEnabled,
      ),
    },
    positionHaltControls: {
      sameDirectionPositionBlockEnabled: booleanValue(
        positionHaltControls.sameDirectionPositionBlockEnabled ??
          root.sameDirectionPositionBlockEnabled,
        defaults.positionHaltControls.sameDirectionPositionBlockEnabled,
      ),
      oppositeSignalFlipBlockEnabled: booleanValue(
        positionHaltControls.oppositeSignalFlipBlockEnabled ??
          root.oppositeSignalFlipBlockEnabled,
        defaults.positionHaltControls.oppositeSignalFlipBlockEnabled,
      ),
      positionMarkFeedHaltEnabled: booleanValue(
        positionHaltControls.positionMarkFeedHaltEnabled ??
          root.positionMarkFeedHaltEnabled,
        defaults.positionHaltControls.positionMarkFeedHaltEnabled,
      ),
    },
    infrastructureHaltControls: {
      gatewayReadinessBlockEnabled: booleanValue(
        infrastructureHaltControls.gatewayReadinessBlockEnabled ??
          root.gatewayReadinessBlockEnabled,
        defaults.infrastructureHaltControls.gatewayReadinessBlockEnabled,
      ),
      resourcePressureScanBlockEnabled: booleanValue(
        infrastructureHaltControls.resourcePressureScanBlockEnabled ??
          root.resourcePressureScanBlockEnabled,
        defaults.infrastructureHaltControls.resourcePressureScanBlockEnabled,
      ),
      contractResolutionBackoffEnabled: booleanValue(
        infrastructureHaltControls.contractResolutionBackoffEnabled ??
          root.contractResolutionBackoffEnabled,
        defaults.infrastructureHaltControls.contractResolutionBackoffEnabled,
      ),
    },
  };
}

export const tunedSignalOptionsExecutionProfile =
  resolveSignalOptionsExecutionProfile(tunedSignalOptionsExecutionProfilePatch);

export function signalOptionsRightForDirection(
  direction: "buy" | "sell" | "long" | "short",
): SignalOptionsRight {
  return direction === "sell" || direction === "short" ? "put" : "call";
}

export function signalOptionsStrikeSlotForRight(
  profile: SignalOptionsExecutionProfile,
  right: SignalOptionsRight,
): SignalOptionsStrikeSlot {
  return signalOptionsStrikeSlotsForRight(profile, right)[0]!;
}

export function signalOptionsStrikeSlotsForRight(
  profile: SignalOptionsExecutionProfile,
  right: SignalOptionsRight,
): SignalOptionsStrikeSlot[] {
  const optionSelection = profile.optionSelection;
  const slots =
    right === "put"
      ? optionSelection.putStrikeSlots
      : optionSelection.callStrikeSlots;
  if (Array.isArray(slots) && slots.length) {
    return slots.slice(0, MAX_SIGNAL_OPTIONS_STRIKE_SLOTS);
  }
  return [
    right === "put"
      ? optionSelection.putStrikeSlot
      : optionSelection.callStrikeSlot,
  ];
}

export function resolveSignalOptionsStrike(input: {
  strikes: number[];
  spotPrice: number;
  slot: SignalOptionsStrikeSlot | number;
}): number | null {
  const strikes = [...new Set(input.strikes)]
    .filter((strike) => Number.isFinite(strike))
    .sort((left, right) => left - right);
  if (!strikes.length) {
    return null;
  }

  const belowIndex = strikes.reduce(
    (bestIndex, strike, index) =>
      strike <= input.spotPrice && index > bestIndex ? index : bestIndex,
    -1,
  );
  const aboveIndex = strikes.findIndex((strike) => strike >= input.spotPrice);
  const resolvedBelowIndex =
    belowIndex >= 0 ? belowIndex : Math.max(0, aboveIndex);
  const resolvedAboveIndex =
    aboveIndex >= 0 ? aboveIndex : Math.max(0, resolvedBelowIndex);
  const slot = Math.round(Math.min(5, Math.max(0, Number(input.slot))));
  const targetIndex =
    slot === 0
      ? resolvedBelowIndex - 2
      : slot === 1
        ? resolvedBelowIndex - 1
        : slot === 2
          ? resolvedBelowIndex
          : slot === 3
            ? resolvedAboveIndex
            : slot === 4
              ? resolvedAboveIndex + 1
              : resolvedAboveIndex + 2;

  return strikes[Math.min(strikes.length - 1, Math.max(0, targetIndex))] ?? null;
}
