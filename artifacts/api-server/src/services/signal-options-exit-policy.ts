import type { SignalOptionsExecutionProfile } from "@workspace/backtest-core";

export type SignalOptionsEntryQuality = {
  tier: "high" | "standard" | "low";
  liquidityTier: "strong" | "standard" | "weak";
  score: number;
  reasons: string[];
  components?: {
    mtfAlignment: number;
    freshness: number;
    trendStrength: number;
    liquidity: number;
    riskFit: number;
    dataQuality: number;
    total: number;
  };
  raw?: Record<string, unknown>;
  adx: number | null;
  mtfMatches: number;
  mtfDirections: number[];
  spreadPctOfMid: number | null;
  bullishRegime: boolean;
};

export function buildInitialStopPrice(
  entryPrice: number,
  profile: SignalOptionsExecutionProfile,
) {
  return Number(
    (entryPrice * (1 + profile.exitPolicy.hardStopPct / 100)).toFixed(2),
  );
}

function resolveConditionalExitPolicy(input: {
  profile: SignalOptionsExecutionProfile;
  signalQuality?: SignalOptionsEntryQuality | null;
}) {
  const { profile, signalQuality } = input;
  const enabled = profile.exitPolicy.conditionalQualityExitsEnabled;
  const tier = signalQuality?.tier ?? "standard";
  const liquidityTier = signalQuality?.liquidityTier ?? "standard";
  return {
    earlyExitBars:
      enabled && tier === "low"
        ? profile.exitPolicy.lowQualityEarlyExitBars
        : enabled && tier === "high"
          ? profile.exitPolicy.highQualityEarlyExitBars
          : profile.exitPolicy.earlyExitBars,
    earlyExitLossPct:
      enabled && tier === "low"
        ? profile.exitPolicy.lowQualityEarlyExitLossPct
        : enabled && tier === "high"
          ? profile.exitPolicy.highQualityEarlyExitLossPct
          : profile.exitPolicy.earlyExitLossPct,
    trailGivebackPct:
      enabled && liquidityTier === "weak"
        ? profile.exitPolicy.weakLiquidityTrailGivebackPct
        : enabled && liquidityTier === "strong"
          ? profile.exitPolicy.strongLiquidityTrailGivebackPct
          : profile.exitPolicy.trailGivebackPct,
    overnightMinGainPct:
      enabled && tier === "high" && signalQuality?.bullishRegime
        ? profile.exitPolicy.highQualityOvernightMinGainPct
        : profile.exitPolicy.overnightMinGainPct,
  };
}

function selectProgressiveTrailStep(
  profile: SignalOptionsExecutionProfile,
  peakReturnPct: number,
) {
  if (
    !profile.exitPolicy.progressiveTrailEnabled ||
    !profile.exitPolicy.progressiveTrailSteps.length
  ) {
    return null;
  }
  return profile.exitPolicy.progressiveTrailSteps.reduce<
    SignalOptionsExecutionProfile["exitPolicy"]["progressiveTrailSteps"][number] | null
  >(
    (selected, step) =>
      peakReturnPct >= step.activationPct &&
      (!selected || step.activationPct > selected.activationPct)
        ? step
        : selected,
    null,
  );
}

export function computeSignalOptionsPositionStop(input: {
  entryPrice: number;
  peakPrice: number;
  markPrice: number;
  profile: SignalOptionsExecutionProfile;
  barsSinceEntry?: number | null;
  signalQuality?: SignalOptionsEntryQuality | null;
}) {
  const { entryPrice, peakPrice, markPrice, profile } = input;
  const conditional = resolveConditionalExitPolicy({
    profile,
    signalQuality: input.signalQuality,
  });
  const hardStopPrice = buildInitialStopPrice(entryPrice, profile);
  const returnPct = entryPrice > 0 ? ((peakPrice - entryPrice) / entryPrice) * 100 : 0;
  const markReturnPct =
    entryPrice > 0 ? ((markPrice - entryPrice) / entryPrice) * 100 : 0;
  const progressiveTrailStep = selectProgressiveTrailStep(profile, returnPct);
  const usesProgressiveTrail =
    profile.exitPolicy.progressiveTrailEnabled &&
    profile.exitPolicy.progressiveTrailSteps.length > 0;
  const trailActive = usesProgressiveTrail
    ? progressiveTrailStep != null
    : returnPct >= profile.exitPolicy.trailActivationPct;
  const minLockedGainPct =
    progressiveTrailStep?.minLockedGainPct ?? profile.exitPolicy.minLockedGainPct;
  const givebackPct =
    peakPrice >= entryPrice * 10
      ? profile.exitPolicy.tightenAtTenXGivebackPct
      : peakPrice >= entryPrice * 5
        ? profile.exitPolicy.tightenAtFiveXGivebackPct
        : (progressiveTrailStep?.givebackPct ?? conditional.trailGivebackPct);
  const trailStopPrice = trailActive
    ? Math.max(
        entryPrice * (1 + minLockedGainPct / 100),
        peakPrice * (1 - givebackPct / 100),
      )
    : null;
  const stopPrice = Number(
    Math.max(hardStopPrice, trailStopPrice ?? hardStopPrice).toFixed(2),
  );
  const exitReason =
    markPrice <= stopPrice
      ? trailActive && trailStopPrice != null && markPrice <= trailStopPrice
        ? "runner_trail_stop"
        : "hard_stop"
      : !trailActive &&
          conditional.earlyExitBars > 0 &&
          conditional.earlyExitLossPct > 0 &&
          (input.barsSinceEntry ?? -1) >= conditional.earlyExitBars &&
          markReturnPct <= -conditional.earlyExitLossPct
        ? "early_invalidation"
      : null;

  return {
    hardStopPrice,
    trailActive,
    trailStopPrice:
      trailStopPrice == null ? null : Number(trailStopPrice.toFixed(2)),
    givebackPct,
    stopPrice,
    exitReason,
    returnPct,
    markReturnPct,
    barsSinceEntry: input.barsSinceEntry ?? null,
    signalQuality: input.signalQuality ?? null,
    conditionalExitPolicy: conditional,
    progressiveTrailStep,
  };
}

export function computeSignalOptionsOvernightPositionExit(input: {
  entryPrice: number;
  peakPrice: number;
  markPrice: number;
  profile: SignalOptionsExecutionProfile;
  signalQuality?: SignalOptionsEntryQuality | null;
}) {
  const { entryPrice, peakPrice, markPrice, profile } = input;
  const conditional = resolveConditionalExitPolicy({
    profile,
    signalQuality: input.signalQuality,
  });
  if (!profile.exitPolicy.overnightExitEnabled) {
    return {
      exitReason: null,
      markReturnPct:
        entryPrice > 0 ? ((markPrice - entryPrice) / entryPrice) * 100 : 0,
      overnightTrailStopPrice: null,
    };
  }

  const markReturnPct =
    entryPrice > 0 ? ((markPrice - entryPrice) / entryPrice) * 100 : 0;
  const peakReturnPct =
    entryPrice > 0 ? ((peakPrice - entryPrice) / entryPrice) * 100 : 0;
  const trailActive = peakReturnPct >= profile.exitPolicy.trailActivationPct;
  const overnightTrailStopPrice =
    trailActive && profile.exitPolicy.overnightRunnerGivebackPct > 0
      ? Number(
          Math.max(
            entryPrice * (1 + profile.exitPolicy.minLockedGainPct / 100),
            peakPrice *
              (1 - profile.exitPolicy.overnightRunnerGivebackPct / 100),
          ).toFixed(2),
        )
      : null;
  const exitReason =
    markReturnPct < conditional.overnightMinGainPct
      ? "overnight_risk_exit"
      : overnightTrailStopPrice != null && markPrice <= overnightTrailStopPrice
        ? "overnight_runner_stop"
        : null;

  return {
    exitReason,
    markReturnPct,
    overnightTrailStopPrice,
    signalQuality: input.signalQuality ?? null,
    conditionalExitPolicy: conditional,
  };
}
