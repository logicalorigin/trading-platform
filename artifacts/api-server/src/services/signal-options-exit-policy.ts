import type {
  SignalOptionsExecutionProfile,
  SignalOptionsWireTrailRung,
} from "@workspace/backtest-core";
import { tradingDaysBetween } from "@workspace/market-calendar";

export type SignalOptionsEntryQuality = {
  tier: "high" | "standard" | "low";
  liquidityTier: "strong" | "standard" | "weak";
  score: number;
  reasons: string[];
  components?: {
    mtfAlignment?: number;
    trendStrength?: number;
    liquidity?: number;
    riskFit?: number;
    reversion?: number;
    confirmation?: number;
    extensionPenalty?: number;
    volumeSupport?: number;
    rangeReversion?: number;
    atrCalm?: number;
    adxCalm?: number;
    volumeCalm?: number;
    volatilityRegime?: number;
    volumeParticipation?: number;
    momentum?: number;
    reversionTilt?: number;
    conviction?: number;
    total: number;
  };
  raw?: Record<string, unknown>;
  adx: number | null;
  mtfMatches: number;
  mtfDirections: number[];
  spreadPctOfMid: number | null;
  bullishRegime: boolean;
};

export type SignalOptionsPositionDirection = "buy" | "sell" | "long" | "short";

export type SignalOptionsGreekSnapshot = {
  delta?: number | null;
  gamma?: number | null;
  theta?: number | null;
  vega?: number | null;
  impliedVolatility?: number | null;
  updatedAt?: Date | string | null;
  ageMs?: number | null;
};

export type SignalOptionsWireContext = {
  symbol?: string | null;
  timeframe?: string | null;
  latestBarAt: Date | string | null;
  previousBarAt?: Date | string | null;
  latestClose: number | null;
  regimeDirection: number | null;
  previousRegimeDirection?: number | null;
  trendLine?: number | null;
  upperBand?: number | null;
  lowerBand?: number | null;
  bullWires?: Array<number | null | undefined> | null;
  bearWires?: Array<number | null | undefined> | null;
  lastBullTrendLine?: number | null;
  lastBearTrendLine?: number | null;
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
  const exitPolicy = profile.exitPolicy as typeof profile.exitPolicy & {
    highQualityOvernightRunnerGivebackPct: number;
  };
  const enabled = exitPolicy.conditionalQualityExitsEnabled;
  const tier = signalQuality?.tier ?? "standard";
  const liquidityTier = signalQuality?.liquidityTier ?? "standard";
  const highQualityBullish =
    enabled && tier === "high" && signalQuality?.bullishRegime;
  return {
    earlyExitBars:
      enabled && tier === "low"
        ? exitPolicy.lowQualityEarlyExitBars
        : enabled && tier === "high"
          ? exitPolicy.highQualityEarlyExitBars
          : exitPolicy.earlyExitBars,
    earlyExitLossPct:
      enabled && tier === "low"
        ? exitPolicy.lowQualityEarlyExitLossPct
        : enabled && tier === "high"
          ? exitPolicy.highQualityEarlyExitLossPct
          : exitPolicy.earlyExitLossPct,
    trailGivebackPct:
      enabled && liquidityTier === "weak"
        ? exitPolicy.weakLiquidityTrailGivebackPct
        : enabled && liquidityTier === "strong"
          ? exitPolicy.strongLiquidityTrailGivebackPct
          : exitPolicy.trailGivebackPct,
    overnightMinGainPct:
      highQualityBullish
        ? exitPolicy.highQualityOvernightMinGainPct
        : exitPolicy.overnightMinGainPct,
    overnightRunnerGivebackPct: highQualityBullish
      ? exitPolicy.highQualityOvernightRunnerGivebackPct
      : exitPolicy.overnightRunnerGivebackPct,
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

const WIRE_RUNG_ORDER: SignalOptionsWireTrailRung[] = [
  "trendLine",
  "wire1",
  "wire2",
  "wire3",
];

function finiteNumber(value: unknown): number | null {
  // Number() also coerces null, booleans, blank strings, and arrays to finite
  // values. At this provider/config boundary those are missing or malformed,
  // not real zeroes; accepting them can create a phantom $0 wire or fresh age.
  if (
    typeof value !== "number" &&
    (typeof value !== "string" || value.trim() === "")
  ) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundedMetric(value: number | null): number | null {
  return value == null ? null : Number(value.toFixed(6));
}

function latestDate(value: unknown): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  return null;
}

function signalOptionsWireTimeframeMs(timeframe?: string | null): number | null {
  const match = String(timeframe ?? "").trim().match(/^(\d+)(m|h|d)$/i);
  if (!match) {
    return null;
  }
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  const unit = match[2]?.toLowerCase();
  return unit === "m"
    ? amount * 60_000
    : unit === "h"
      ? amount * 60 * 60_000
      : unit === "d"
        ? amount * 24 * 60 * 60_000
        : null;
}

function resolveWireBarFreshness(input: {
  context: SignalOptionsWireContext | null;
  now?: Date | null;
}) {
  const context = input.context;
  const latestBarAt = latestDate(context?.latestBarAt);
  if (!context) {
    return { stale: false, ageMs: null, intervalMs: null, reason: null };
  }
  if (!latestBarAt) {
    return {
      stale: true,
      ageMs: null,
      intervalMs: null,
      reason: "missing_bar_timestamp",
    };
  }
  const timeframeMs = signalOptionsWireTimeframeMs(context.timeframe);
  const dailyTimeframe = String(context.timeframe ?? "")
    .trim()
    .match(/^(\d+)d$/i);
  const previousBarAt = latestDate(context.previousBarAt);
  const spacingMs =
    previousBarAt && latestBarAt.getTime() > previousBarAt.getTime()
      ? latestBarAt.getTime() - previousBarAt.getTime()
      : null;
  const intervalMs = timeframeMs ?? spacingMs;
  const now = input.now ?? new Date();
  const ageMs = now.getTime() - latestBarAt.getTime();
  if (ageMs < 0) {
    return { stale: true, ageMs, intervalMs, reason: "future_bar" };
  }
  if (intervalMs == null) {
    return { stale: false, ageMs: null, intervalMs: null, reason: null };
  }
  const stale = dailyTimeframe
    ? tradingDaysBetween(latestBarAt, now) > Number(dailyTimeframe[1]) * 2
    : ageMs > intervalMs * 2;
  return {
    stale,
    ageMs,
    intervalMs,
    reason: stale ? "stale_bar" : null,
  };
}

function positionUnderlyingDirection(direction?: SignalOptionsPositionDirection | null) {
  return direction === "sell" || direction === "short" ? -1 : 1;
}

function selectWireBaselineRung(
  profile: SignalOptionsExecutionProfile,
  peakReturnPct: number,
): SignalOptionsExecutionProfile["exitPolicy"]["wireGreekTrail"]["rungByProfit"][number] | null {
  const steps = profile.exitPolicy.wireGreekTrail.rungByProfit;
  if (!profile.exitPolicy.wireGreekTrail.enabled || !steps.length) {
    return null;
  }
  return steps.reduce<(typeof steps)[number] | null>(
    (selected, step) =>
      peakReturnPct >= step.activationPct &&
      (!selected || step.activationPct > selected.activationPct)
        ? step
        : selected,
    null,
  );
}

function adjustWireRung(
  rung: SignalOptionsWireTrailRung,
  adjustment: -1 | 0 | 1,
): SignalOptionsWireTrailRung {
  const currentIndex = WIRE_RUNG_ORDER.indexOf(rung);
  const resolvedIndex = currentIndex >= 0 ? currentIndex : WIRE_RUNG_ORDER.length - 1;
  return WIRE_RUNG_ORDER[
    Math.min(WIRE_RUNG_ORDER.length - 1, Math.max(0, resolvedIndex + adjustment))
  ]!;
}

function wireValueForRung(input: {
  context: SignalOptionsWireContext;
  direction: number;
  rung: SignalOptionsWireTrailRung;
}): number | null {
  const context = input.context;
  if (input.rung === "trendLine") {
    const trend =
      finiteNumber(context.trendLine) ??
      (input.direction === 1
        ? finiteNumber(context.lowerBand) ?? finiteNumber(context.lastBullTrendLine)
        : finiteNumber(context.upperBand) ?? finiteNumber(context.lastBearTrendLine));
    return trend;
  }
  const index = input.rung === "wire1" ? 0 : input.rung === "wire2" ? 1 : 2;
  const wires = input.direction === 1 ? context.bullWires : context.bearWires;
  return finiteNumber(wires?.[index]);
}

function selectUsableWireValue(input: {
  context: SignalOptionsWireContext;
  direction: number;
  rung: SignalOptionsWireTrailRung;
}): { rung: SignalOptionsWireTrailRung; price: number } | null {
  const startIndex = WIRE_RUNG_ORDER.indexOf(input.rung);
  const resolvedStart =
    startIndex >= 0 ? startIndex : WIRE_RUNG_ORDER.indexOf("wire3");
  for (let index = resolvedStart; index >= 0; index -= 1) {
    const rung = WIRE_RUNG_ORDER[index]!;
    const price = wireValueForRung({ ...input, rung });
    if (price != null) {
      return { rung, price };
    }
  }
  for (let index = resolvedStart + 1; index < WIRE_RUNG_ORDER.length; index += 1) {
    const rung = WIRE_RUNG_ORDER[index]!;
    const price = wireValueForRung({ ...input, rung });
    if (price != null) {
      return { rung, price };
    }
  }
  return null;
}

function resolveGreekFreshness(input: {
  greeks?: SignalOptionsGreekSnapshot | null;
  profile: SignalOptionsExecutionProfile;
  now?: Date | null;
}) {
  const greeks = input.greeks ?? null;
  if (!greeks) {
    return { fresh: false, ageMs: null, reason: "missing_greeks" };
  }
  const explicitAge = finiteNumber(greeks.ageMs);
  const updatedAt = latestDate(greeks.updatedAt);
  const now = input.now ?? new Date();
  const ageMs =
    explicitAge ??
    (updatedAt ? now.getTime() - updatedAt.getTime() : null);
  const fresh =
    ageMs != null &&
    ageMs >= 0 &&
    ageMs <= input.profile.exitPolicy.wireGreekTrail.greekMaxAgeMs;
  return {
    fresh,
    ageMs,
    reason: fresh
      ? null
      : ageMs == null
        ? "missing_greek_timestamp"
        : ageMs < 0
          ? "future_greeks"
          : "stale_greeks",
  };
}

function resolveWireGreekAdjustment(input: {
  profile: SignalOptionsExecutionProfile;
  entryGreeks?: SignalOptionsGreekSnapshot | null;
  currentGreeks?: SignalOptionsGreekSnapshot | null;
  markPrice: number;
  spreadPctOfMid?: number | null;
  entrySpreadPctOfMid?: number | null;
  greekFresh: boolean;
}) {
  const policy = input.profile.exitPolicy.wireGreekTrail;
  if (policy.requireFreshGreeks && !input.greekFresh) {
    return {
      adjustment: 0 as -1 | 0 | 1,
      reasons: ["greeks_unavailable"],
      deltaImprovement: null,
      thetaBurdenPct: null,
    };
  }

  const currentDelta = finiteNumber(input.currentGreeks?.delta);
  const entryDelta = finiteNumber(input.entryGreeks?.delta);
  const gamma = finiteNumber(input.currentGreeks?.gamma);
  const theta = finiteNumber(input.currentGreeks?.theta);
  const deltaImprovement =
    currentDelta != null && entryDelta != null
      ? Math.abs(currentDelta) - Math.abs(entryDelta)
      : null;
  const thetaBurdenPct =
    theta != null && input.markPrice > 0
      ? Math.abs(theta) / input.markPrice * 100
      : null;
  const reasons: string[] = [];
  let adjustment: -1 | 0 | 1 = 0;

  if (
    deltaImprovement != null &&
    deltaImprovement <= policy.deltaTightenThreshold
  ) {
    reasons.push("delta_decay");
    adjustment = -1;
  }
  if (thetaBurdenPct != null && thetaBurdenPct >= policy.thetaBurdenTightenPct) {
    reasons.push("theta_burden");
    adjustment = -1;
  }

  const entrySpread = finiteNumber(input.entrySpreadPctOfMid);
  const spread = finiteNumber(input.spreadPctOfMid);
  const spreadThreshold = Math.max(
    input.profile.liquidityGate.maxSpreadPctOfMid,
    entrySpread != null
      ? entrySpread * policy.spreadWideningMultiplier
      : input.profile.liquidityGate.maxSpreadPctOfMid,
  );
  if (spread != null && spread > spreadThreshold) {
    reasons.push("spread_widening");
    adjustment = -1;
  }

  if (
    adjustment === 0 &&
    deltaImprovement != null &&
    deltaImprovement >= policy.deltaLoosenThreshold &&
    gamma != null &&
    gamma >= policy.strongGammaMin
  ) {
    reasons.push("delta_gamma_support");
    adjustment = 1;
  }

  return {
    adjustment,
    reasons,
    deltaImprovement,
    thetaBurdenPct,
  };
}

export function computeSignalOptionsPositionStop(input: {
  entryPrice: number;
  peakPrice: number;
  markPrice: number;
  profile: SignalOptionsExecutionProfile;
  direction?: SignalOptionsPositionDirection | null;
  underlyingSpot?: number | null;
  wireContext?: SignalOptionsWireContext | null;
  currentGreeks?: SignalOptionsGreekSnapshot | null;
  entryGreeks?: SignalOptionsGreekSnapshot | null;
  spreadPctOfMid?: number | null;
  barsSinceEntry?: number | null;
  quantity?: number | null;
  scaleOutAlreadyFired?: boolean | null;
  priorStopPrice?: number | null;
  signalQuality?: SignalOptionsEntryQuality | null;
  now?: Date | null;
  // Shadow-first gate: unless the caller passes the operator enforce flag, the wire
  // trail is telemetry-only — enforced stop behavior stays byte-for-byte identical to
  // a wire-disabled profile (the contract pinned by signal-options-wire-trail-gate).
  wireTrailEnforceEnabled?: boolean | null;
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
  const wireBaselineStep = selectWireBaselineRung(profile, returnPct);
  const greekFreshness = resolveGreekFreshness({
    greeks: input.currentGreeks,
    profile,
    now: input.now,
  });
  const greekAdjustment = wireBaselineStep
    ? resolveWireGreekAdjustment({
        profile,
        entryGreeks: input.entryGreeks,
        currentGreeks: input.currentGreeks,
        markPrice,
        spreadPctOfMid: input.spreadPctOfMid,
        entrySpreadPctOfMid: input.signalQuality?.spreadPctOfMid,
        greekFresh: greekFreshness.fresh,
      })
    : {
        adjustment: 0 as -1 | 0 | 1,
        reasons: [] as string[],
        deltaImprovement: null,
        thetaBurdenPct: null,
      };
  const greekManagementAdjustment = resolveWireGreekAdjustment({
    profile,
    entryGreeks: input.entryGreeks,
    currentGreeks: input.currentGreeks,
    markPrice,
    spreadPctOfMid: input.spreadPctOfMid,
    entrySpreadPctOfMid: input.signalQuality?.spreadPctOfMid,
    greekFresh: greekFreshness.fresh,
  });
  const selectedWireRung = wireBaselineStep
    ? adjustWireRung(wireBaselineStep.rung, greekAdjustment.adjustment)
    : null;
  const underlyingDirection = positionUnderlyingDirection(input.direction);
  const wireContext = input.wireContext ?? null;
  const regimeDirection = finiteNumber(wireContext?.regimeDirection);
  const previousRegimeDirection = finiteNumber(wireContext?.previousRegimeDirection);
  const regimeFlipAgainstPosition =
    regimeDirection != null &&
    previousRegimeDirection != null &&
    previousRegimeDirection === underlyingDirection &&
    regimeDirection !== underlyingDirection;
  const selectedWire =
    wireContext && selectedWireRung
      ? selectUsableWireValue({
          context: wireContext,
          direction: underlyingDirection,
          rung: regimeFlipAgainstPosition ? "trendLine" : selectedWireRung,
        })
      : null;
  const latestUnderlyingClose = finiteNumber(wireContext?.latestClose);
  const rawStructureBreak =
    Boolean(selectedWire && latestUnderlyingClose != null && !regimeFlipAgainstPosition) &&
    (underlyingDirection === 1
      ? latestUnderlyingClose! <= selectedWire!.price
      : latestUnderlyingClose! >= selectedWire!.price);
  const wireBarFreshness = rawStructureBreak
    ? resolveWireBarFreshness({ context: wireContext, now: input.now })
    : { stale: false, ageMs: null, intervalMs: null, reason: null };
  const structureBreak = rawStructureBreak && !wireBarFreshness.stale;
  // Full direction-resolved underlying ladder (not just the active rung) so the
  // frontend can draw/point-at every wire. Null when no wire context is loaded
  // (the *_WIRE_TRAIL_LIVE data-source flag is off).
  const wireLevels = wireContext
    ? (Object.fromEntries(
        WIRE_RUNG_ORDER.map((rung) => [
          rung,
          wireValueForRung({
            context: wireContext,
            direction: underlyingDirection,
            rung,
          }),
        ]),
      ) as Record<SignalOptionsWireTrailRung, number | null>)
    : null;
  // Signed % of the underlying still separating it from the active wire.
  // Positive = room before a structure break; <= 0 = at/through the wire. Sign
  // convention mirrors the rawStructureBreak comparison above.
  const distanceToBreakPct =
    selectedWire && latestUnderlyingClose != null && latestUnderlyingClose !== 0
      ? underlyingDirection === 1
        ? ((latestUnderlyingClose - selectedWire.price) / latestUnderlyingClose) *
          100
        : ((selectedWire.price - latestUnderlyingClose) / latestUnderlyingClose) *
          100
      : null;
  const usesProgressiveTrail =
    profile.exitPolicy.progressiveTrailEnabled &&
    profile.exitPolicy.progressiveTrailSteps.length > 0;
  const wireTrailEligible =
    profile.exitPolicy.wireGreekTrail.enabled &&
    wireBaselineStep != null &&
    selectedWire != null;
  const usesWireTrail = wireTrailEligible && input.wireTrailEnforceEnabled === true;
  const greekManagementUnavailable =
    !input.currentGreeks ||
    greekManagementAdjustment.reasons.includes("greeks_unavailable");
  const greekManagementRecommendation = greekManagementUnavailable
    ? "unavailable"
    : greekManagementAdjustment.adjustment < 0
      ? "tighten"
      : greekManagementAdjustment.adjustment > 0
        ? "loosen"
        : "hold";
  const legacyTrailActive = usesProgressiveTrail
    ? progressiveTrailStep != null
    : returnPct >= profile.exitPolicy.trailActivationPct;
  const priorStopPrice = finiteNumber(input.priorStopPrice);
  const trailActive =
    usesWireTrail ||
    legacyTrailActive ||
    (priorStopPrice != null && priorStopPrice > hardStopPrice);
  const scaleOutPolicy = profile.exitPolicy.scaleOut;
  const quantity = finiteNumber(input.quantity);
  const scaleOutArmed =
    scaleOutPolicy.enabled &&
    trailActive &&
    input.scaleOutAlreadyFired !== true &&
    quantity != null &&
    quantity >= 2;
  const exitQuantity = scaleOutArmed
    ? Math.min(
        quantity - 1,
        Math.max(1, Math.round(quantity * (scaleOutPolicy.sellFractionPct / 100))),
      )
    : undefined;
  const minLockedGainPct =
    progressiveTrailStep?.minLockedGainPct ?? profile.exitPolicy.minLockedGainPct;
  const trailRetracementPct =
    progressiveTrailStep?.givebackPct ?? conditional.trailGivebackPct;
  // Per-share premium giveback: |delta| × |spot − wire| is already in premium dollars
  // per share (delta = premium move per $1 underlying move). No contract multiplier —
  // peakPrice/markPrice are per-share premiums throughout this function.
  const deltaSizedGiveback =
    profile.exitPolicy.wireGreekTrail.deltaSizingEnabled &&
    wireTrailEligible &&
    greekFreshness.fresh &&
    selectedWire &&
    (finiteNumber(input.underlyingSpot) ?? latestUnderlyingClose) != null &&
    finiteNumber(input.currentGreeks?.delta) != null
      ? Math.abs(finiteNumber(input.currentGreeks?.delta)!) *
        Math.abs((finiteNumber(input.underlyingSpot) ?? latestUnderlyingClose)! - selectedWire.price)
      : null;
  // The candidate above is always visible as telemetry; it may shift the enforced trail
  // only when the operator enforce flag admitted the wire trail.
  const appliedDeltaSizedGiveback = usesWireTrail ? deltaSizedGiveback : null;
  const boundedTrailRetracementPct = Math.min(
    Math.max(trailRetracementPct, 0),
    100,
  );
  const accruedProfit = Math.max(0, peakPrice - entryPrice);
  const rawTrailStopPrice = trailActive
    ? Math.max(
        entryPrice * (1 + minLockedGainPct / 100),
        appliedDeltaSizedGiveback != null
          ? peakPrice - appliedDeltaSizedGiveback
          : entryPrice +
              accruedProfit * (1 - boundedTrailRetracementPct / 100),
      )
    : null;
  const trailStopPrice =
    rawTrailStopPrice == null
      ? null
      : Number(
          Math.max(rawTrailStopPrice, priorStopPrice ?? rawTrailStopPrice).toFixed(
            2,
          ),
        );
  const trailHasTakenOver =
    trailActive && trailStopPrice != null && trailStopPrice > hardStopPrice;
  const activeStopKind = trailHasTakenOver ? "trailing_stop" : "hard_stop";
  const activeStopPrice = trailHasTakenOver ? trailStopPrice : hardStopPrice;
  const stopPrice = Number(activeStopPrice.toFixed(2));
  const premiumExitReason =
    markPrice <= stopPrice
      ? activeStopKind === "trailing_stop"
        ? "runner_trail_stop"
        : "hard_stop"
      : !trailActive &&
          conditional.earlyExitBars > 0 &&
          conditional.earlyExitLossPct > 0 &&
          (input.barsSinceEntry ?? -1) >= conditional.earlyExitBars &&
          markReturnPct <= -conditional.earlyExitLossPct
        ? "early_invalidation"
      : null;
  const exitReason = premiumExitReason ?? (structureBreak ? "wire_structure_break" : null);

  return {
    hardStopPrice,
    activeStopPrice,
    activeStopKind,
    trailActive,
    scaleOutArmed,
    exitQuantity,
    trailStopPrice,
    trailHasTakenOver,
    // Compatibility key for persisted events and older clients. The value is now
    // unambiguously the allowed retracement of accrued profit, not total premium.
    givebackPct: trailRetracementPct,
    trailRetracementPct,
    stopPrice,
    exitReason,
    premiumExitReason,
    returnPct,
    markReturnPct,
    barsSinceEntry: input.barsSinceEntry ?? null,
    signalQuality: input.signalQuality ?? null,
    conditionalExitPolicy: conditional,
    progressiveTrailStep,
    greekManagement: {
      available: Boolean(input.currentGreeks),
      enforcing: usesWireTrail,
      recommendation: greekManagementRecommendation,
      reasons: greekManagementAdjustment.reasons,
      fresh: greekFreshness.fresh,
      ageMs: greekFreshness.ageMs,
      fallbackReason: greekFreshness.reason,
      currentDelta: roundedMetric(finiteNumber(input.currentGreeks?.delta)),
      entryDelta: roundedMetric(finiteNumber(input.entryGreeks?.delta)),
      deltaImprovement: roundedMetric(greekManagementAdjustment.deltaImprovement),
      currentGamma: roundedMetric(finiteNumber(input.currentGreeks?.gamma)),
      currentTheta: roundedMetric(finiteNumber(input.currentGreeks?.theta)),
      thetaBurdenPct: roundedMetric(greekManagementAdjustment.thetaBurdenPct),
    },
    wireTrail: {
      enabled: profile.exitPolicy.wireGreekTrail.enabled,
      // active = the wire trail is configured, rung-eligible, and has a usable wire
      // (what it WOULD do); enforced = the operator flag additionally admitted it to
      // change real stop behavior this evaluation.
      active: wireTrailEligible,
      enforced: usesWireTrail,
      baselineStep: wireBaselineStep,
      baselineRung: wireBaselineStep?.rung ?? null,
      selectedRung: selectedWire?.rung ?? selectedWireRung,
      selectedWirePrice: selectedWire?.price ?? null,
      latestUnderlyingClose,
      latestUnderlyingBarAt: wireContext?.latestBarAt ?? null,
      latestUnderlyingBarAgeMs: wireBarFreshness.ageMs,
      latestUnderlyingBarIntervalMs: wireBarFreshness.intervalMs,
      structureBreak,
      structureBreakSuppressed: wireBarFreshness.stale
        ? wireBarFreshness.reason
        : null,
      regimeDirection,
      previousRegimeDirection,
      regimeFlipAgainstPosition,
      greekFresh: greekFreshness.fresh,
      greekAgeMs: greekFreshness.ageMs,
      greekFallbackReason: greekFreshness.reason,
      greekAdjustment,
      deltaSizedGiveback,
      wireLevels,
      distanceToBreakPct,
    },
  };
}

export function computeSignalOptionsOvernightPositionExit(input: {
  entryPrice: number;
  peakPrice: number;
  markPrice: number;
  profile: SignalOptionsExecutionProfile;
  signalQuality?: SignalOptionsEntryQuality | null;
}) {
  const { entryPrice, markPrice, profile } = input;
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
  const exitReason =
    profile.exitPolicy.overnightMinGainExitEnabled &&
    markReturnPct < conditional.overnightMinGainPct
      ? "overnight_risk_exit"
      : null;

  return {
    exitReason,
    markReturnPct,
    // Trailing stops are evaluated once by computeSignalOptionsPositionStop.
    // Keep this field for event/API compatibility without reviving the obsolete
    // overnight runner policy as a second exit path.
    overnightTrailStopPrice: null,
    signalQuality: input.signalQuality ?? null,
    conditionalExitPolicy: conditional,
  };
}
