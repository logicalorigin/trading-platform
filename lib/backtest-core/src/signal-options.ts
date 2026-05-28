export type SignalOptionsStrikeSlot = 0 | 1 | 2 | 3 | 4 | 5;
export type SignalOptionsRight = "call" | "put";

export type SignalOptionsProgressiveTrailStep = {
  activationPct: number;
  minLockedGainPct: number;
  givebackPct: number;
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
  };
  riskCaps: {
    maxPremiumPerEntry: number;
    maxContracts: number;
    maxOpenSymbols: number;
    maxDailyLoss: number;
  };
  entryGate: {
    mtfAlignment: {
      enabled: boolean;
      requiredCount: number;
    };
    blockedPutSymbols: string[];
    bearishRegime: {
      enabled: boolean;
      minAdx: number;
      rejectFullyBullishMtf: boolean;
    };
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
    hardStopPct: number;
    trailActivationPct: number;
    minLockedGainPct: number;
    trailGivebackPct: number;
    tightenAtFiveXGivebackPct: number;
    tightenAtTenXGivebackPct: number;
    progressiveTrailEnabled: boolean;
    progressiveTrailSteps: SignalOptionsProgressiveTrailStep[];
    flipOnOppositeSignal: boolean;
    earlyExitBars: number;
    earlyExitLossPct: number;
    overnightExitEnabled: boolean;
    overnightMinGainPct: number;
    overnightRunnerGivebackPct: number;
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
  };
  entryHaltControls: {
    mtfAlignmentEnabled: boolean;
    inversePutBlocklistEnabled: boolean;
    bearishRegimeEnabled: boolean;
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
    },
    riskCaps: {
      maxPremiumPerEntry: 500,
      maxContracts: 3,
      maxOpenSymbols: 5,
      maxDailyLoss: 1_000,
    },
    entryGate: {
      mtfAlignment: {
        enabled: true,
        requiredCount: 2,
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
      bearishRegime: {
        enabled: true,
        minAdx: 25,
        rejectFullyBullishMtf: true,
      },
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
      hardStopPct: -40,
      trailActivationPct: 40,
      minLockedGainPct: 10,
      trailGivebackPct: 25,
      tightenAtFiveXGivebackPct: 30,
      tightenAtTenXGivebackPct: 15,
      progressiveTrailEnabled: false,
      progressiveTrailSteps: [],
      flipOnOppositeSignal: true,
      earlyExitBars: 0,
      earlyExitLossPct: 0,
      overnightExitEnabled: false,
      overnightMinGainPct: 20,
      overnightRunnerGivebackPct: 15,
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
    },
    entryHaltControls: {
      mtfAlignmentEnabled: true,
      inversePutBlocklistEnabled: true,
      bearishRegimeEnabled: true,
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
  riskCaps: {
    maxOpenSymbols: 10,
    maxPremiumPerEntry: 1_500,
  },
  exitPolicy: {
    hardStopPct: -30,
    trailActivationPct: 35,
    minLockedGainPct: 15,
    trailGivebackPct: 20,
    tightenAtFiveXGivebackPct: 30,
    tightenAtTenXGivebackPct: 15,
    progressiveTrailEnabled: true,
    progressiveTrailSteps: aggressiveSignalOptionsProgressiveTrailSteps,
    overnightExitEnabled: true,
    overnightMinGainPct: 10,
    overnightRunnerGivebackPct: 15,
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

function strikeSlot(
  value: unknown,
  fallback: SignalOptionsStrikeSlot,
): SignalOptionsStrikeSlot {
  return parseStrikeSlot(value) ?? fallback;
}

const MAX_SIGNAL_OPTIONS_STRIKE_SLOTS = 3;

function parseStrikeSlot(value: unknown): SignalOptionsStrikeSlot | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.min(5, Math.max(0, Math.round(parsed))) as SignalOptionsStrikeSlot;
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
    .map((step) => Number(step))
    .filter((step) => Number.isFinite(step))
    .map((step) => Math.min(1, Math.max(0, step)));
  return steps.length ? Array.from(new Set(steps)).sort((a, b) => a - b) : fallback;
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
  const bearishRegime = asRecord(
    entryGate.bearishRegime ?? root.bearishRegime,
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
    45,
  );
  const maxDte = finiteInteger(
    optionSelection.maxDte ?? root.maxDte,
    Math.max(minDte, defaults.optionSelection.maxDte),
    minDte,
    90,
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
    },
    entryGate: {
      mtfAlignment: {
        enabled: booleanValue(
          mtfAlignment.enabled ?? root.mtfAlignmentEnabled,
          defaults.entryGate.mtfAlignment.enabled,
        ),
        requiredCount: finiteInteger(
          mtfAlignment.requiredCount ?? root.mtfAlignmentRequiredCount,
          defaults.entryGate.mtfAlignment.requiredCount,
          1,
          3,
        ),
      },
      blockedPutSymbols: symbolList(
        entryGate.blockedPutSymbols ?? root.blockedPutSymbols,
        defaults.entryGate.blockedPutSymbols,
      ),
      bearishRegime: {
        enabled: booleanValue(
          bearishRegime.enabled ?? root.bearishRegimeEnabled,
          defaults.entryGate.bearishRegime.enabled,
        ),
        minAdx: finiteNumber(
          bearishRegime.minAdx ?? root.bearishRegimeMinAdx,
          defaults.entryGate.bearishRegime.minAdx,
          0,
          200,
        ),
        rejectFullyBullishMtf: booleanValue(
          bearishRegime.rejectFullyBullishMtf ??
            root.bearishRegimeRejectFullyBullishMtf,
          defaults.entryGate.bearishRegime.rejectFullyBullishMtf,
        ),
      },
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
      requireBidAsk: booleanValue(
        liquidityGate.requireBidAsk ?? root.requireBidAsk,
        defaults.liquidityGate.requireBidAsk,
      ),
      requireFreshQuote: booleanValue(
        liquidityGate.requireFreshQuote ?? root.requireFreshQuote,
        defaults.liquidityGate.requireFreshQuote,
      ),
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
      tightenAtFiveXGivebackPct: finiteNumber(
        exitPolicy.tightenAtFiveXGivebackPct ?? root.tightenAtFiveXGivebackPct,
        defaults.exitPolicy.tightenAtFiveXGivebackPct,
        0,
        100,
      ),
      tightenAtTenXGivebackPct: finiteNumber(
        exitPolicy.tightenAtTenXGivebackPct ?? root.tightenAtTenXGivebackPct,
        defaults.exitPolicy.tightenAtTenXGivebackPct,
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
      bearishRegimeEnabled: booleanValue(
        entryHaltControls.bearishRegimeEnabled ?? root.bearishRegimeEnabled,
        defaults.entryHaltControls.bearishRegimeEnabled,
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
