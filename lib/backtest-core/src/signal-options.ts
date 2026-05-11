export type SignalOptionsStrikeSlot = 0 | 1 | 2 | 3 | 4 | 5;
export type SignalOptionsRight = "call" | "put";

export type SignalOptionsExecutionProfile = {
  version: "v1";
  mode: "shadow";
  optionSelection: {
    minDte: number;
    targetDte: number;
    maxDte: number;
    allowZeroDte: boolean;
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
    flipOnOppositeSignal: boolean;
  };
};

export const defaultSignalOptionsExecutionProfile: SignalOptionsExecutionProfile =
  {
    version: "v1",
    mode: "shadow",
    optionSelection: {
      minDte: 1,
      targetDte: 1,
      maxDte: 3,
      allowZeroDte: false,
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
      hardStopPct: -50,
      trailActivationPct: 150,
      minLockedGainPct: 25,
      trailGivebackPct: 45,
      tightenAtFiveXGivebackPct: 35,
      tightenAtTenXGivebackPct: 25,
      flipOnOppositeSignal: true,
    },
  };

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
  const resolved = finiteInteger(value, fallback, 0, 5);
  return resolved as SignalOptionsStrikeSlot;
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
  const bearishRegime = asRecord(
    entryGate.bearishRegime ?? root.bearishRegime,
  );
  const liquidityGate = asRecord(root.liquidityGate);
  const fillPolicy = asRecord(root.fillPolicy);
  const exitPolicy = asRecord(root.exitPolicy);
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
      callStrikeSlot: strikeSlot(
        optionSelection.callStrikeSlot ?? root.callStrikeSlot,
        defaults.optionSelection.callStrikeSlot,
      ),
      putStrikeSlot: strikeSlot(
        optionSelection.putStrikeSlot ?? root.putStrikeSlot,
        defaults.optionSelection.putStrikeSlot,
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
    },
    entryGate: {
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
      flipOnOppositeSignal: booleanValue(
        exitPolicy.flipOnOppositeSignal ?? root.flipOnOppositeSignal,
        defaults.exitPolicy.flipOnOppositeSignal,
      ),
    },
  };
}

export function signalOptionsRightForDirection(
  direction: "buy" | "sell" | "long" | "short",
): SignalOptionsRight {
  return direction === "sell" || direction === "short" ? "put" : "call";
}

export function signalOptionsStrikeSlotForRight(
  profile: SignalOptionsExecutionProfile,
  right: SignalOptionsRight,
): SignalOptionsStrikeSlot {
  return right === "put"
    ? profile.optionSelection.putStrikeSlot
    : profile.optionSelection.callStrikeSlot;
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
