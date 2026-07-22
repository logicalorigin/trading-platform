export type PatternDirection = "buy" | "sell" | "none";

export type PatternSetupFamilyId =
  | "bull_confluence"
  | "bear_confluence"
  | "fast_bullish_reversal"
  | "fast_bearish_reversal"
  | "mixed_divergence"
  | "inactive";

export type PatternSetupFamily = {
  id: PatternSetupFamilyId;
  label: string;
  shortLabel: string;
  description: string;
};

export const PATTERN_SETUP_FAMILIES: PatternSetupFamily[] = [
  {
    id: "bull_confluence",
    label: "Bull confluence",
    shortLabel: "Bull",
    description: "All active timeframes are buy.",
  },
  {
    id: "bear_confluence",
    label: "Bear confluence",
    shortLabel: "Bear",
    description: "All active timeframes are sell.",
  },
  {
    id: "fast_bullish_reversal",
    label: "Fast bullish reversal",
    shortLabel: "Fast bull rev",
    description: "Fast frames are buying against slower sell context.",
  },
  {
    id: "fast_bearish_reversal",
    label: "Fast bearish reversal",
    shortLabel: "Fast bear rev",
    description: "Fast frames are selling against slower buy context.",
  },
  {
    id: "mixed_divergence",
    label: "Mixed divergence",
    shortLabel: "Mixed",
    description: "Buy and sell are both present without a clean fast/slow reversal.",
  },
  {
    id: "inactive",
    label: "Inactive / no signal",
    shortLabel: "Inactive",
    description: "No buy or sell direction is active.",
  },
];

const FAMILY_BY_ID = new Map(PATTERN_SETUP_FAMILIES.map((family) => [family.id, family]));

export type ParsedPatternLeg = {
  timeframe: string;
  direction: PatternDirection;
};

export function setupFamilyById(id: PatternSetupFamilyId): PatternSetupFamily {
  return FAMILY_BY_ID.get(id) ?? PATTERN_SETUP_FAMILIES[PATTERN_SETUP_FAMILIES.length - 1];
}

function normalizeDirection(value: string | undefined): PatternDirection {
  return value === "buy" || value === "sell" ? value : "none";
}

export function parsePatternKey(patternKey: string): ParsedPatternLeg[] {
  return String(patternKey || "")
    .split("|")
    .filter(Boolean)
    .map((part) => {
      const [timeframe, direction] = part.split(":");
      return {
        timeframe: timeframe ?? "",
        direction: normalizeDirection(direction),
      };
    })
    .filter((leg) => leg.timeframe.length > 0);
}

function dominantDirection(legs: ParsedPatternLeg[]): "buy" | "sell" | null {
  const buy = legs.filter((leg) => leg.direction === "buy").length;
  const sell = legs.filter((leg) => leg.direction === "sell").length;
  if (buy === sell) return null;
  return buy > sell ? "buy" : "sell";
}

const TIMEFRAME_UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

function timeframeDurationMs(timeframe: string): number {
  const match = /^(\d+)([smhdw])$/i.exec(timeframe.trim());
  return match ? Number(match[1]) * TIMEFRAME_UNIT_MS[match[2].toLowerCase()] : Infinity;
}

export function classifyPatternSetup(patternKey: string): PatternSetupFamily {
  const legs = parsePatternKey(patternKey).sort(
    (left, right) =>
      timeframeDurationMs(left.timeframe) - timeframeDurationMs(right.timeframe),
  );
  const buyCount = legs.filter((leg) => leg.direction === "buy").length;
  const sellCount = legs.filter((leg) => leg.direction === "sell").length;
  if (buyCount === 0 && sellCount === 0) return setupFamilyById("inactive");
  if (buyCount > 0 && sellCount === 0) return setupFamilyById("bull_confluence");
  if (sellCount > 0 && buyCount === 0) return setupFamilyById("bear_confluence");

  const splitIndex = Math.max(1, Math.floor(legs.length / 2));
  const fastDirection = dominantDirection(legs.slice(0, splitIndex));
  const slowDirection = dominantDirection(legs.slice(splitIndex));
  if (fastDirection === "buy" && slowDirection === "sell") {
    return setupFamilyById("fast_bullish_reversal");
  }
  if (fastDirection === "sell" && slowDirection === "buy") {
    return setupFamilyById("fast_bearish_reversal");
  }
  return setupFamilyById("mixed_divergence");
}

export function totalPossiblePatternCombinations(timeframeSet: string[]): number {
  return 3 ** Math.max(0, timeframeSet.length);
}

export type PatternFamilyResultLike = {
  patternKey: string;
  sampleCount: number;
  meanReturnPct: number | null;
  tStat: number | null;
};

export type PatternSetupFamilySummary = PatternSetupFamily & {
  patternCount: number;
  sampleCount: number;
  weightedMeanReturnPct: number | null;
  bestPatternKey: string | null;
  bestAbsTStat: number | null;
};

export type PatternExpectedBias = "long" | "short";
export type PatternBiasAlignment = "aligned" | "counter" | "neutral";

export function expectedBiasForPatternSetup(
  familyId: PatternSetupFamilyId,
): PatternExpectedBias | null {
  switch (familyId) {
    case "bull_confluence":
    case "fast_bullish_reversal":
      return "long";
    case "bear_confluence":
    case "fast_bearish_reversal":
      return "short";
    case "mixed_divergence":
    case "inactive":
    default:
      return null;
  }
}

export function classifyPatternBiasAlignment(
  patternKey: string,
  bias: string,
): PatternBiasAlignment {
  const expectedBias = expectedBiasForPatternSetup(classifyPatternSetup(patternKey).id);
  const observedBias = bias === "long" || bias === "short" ? bias : null;
  if (!expectedBias || !observedBias) return "neutral";
  return expectedBias === observedBias ? "aligned" : "counter";
}

const round6 = (value: number): number => Number(value.toFixed(6));

export function summarizePatternSetupFamilies(
  rows: PatternFamilyResultLike[],
): PatternSetupFamilySummary[] {
  const summaries = new Map<
    PatternSetupFamilyId,
    {
      patternCount: number;
      sampleCount: number;
      weightedReturnSum: number;
      weightedReturnSampleCount: number;
      bestPatternKey: string | null;
      bestAbsTStat: number | null;
    }
  >();
  for (const family of PATTERN_SETUP_FAMILIES) {
    summaries.set(family.id, {
      patternCount: 0,
      sampleCount: 0,
      weightedReturnSum: 0,
      weightedReturnSampleCount: 0,
      bestPatternKey: null,
      bestAbsTStat: null,
    });
  }

  for (const row of rows) {
    const family = classifyPatternSetup(row.patternKey);
    const summary = summaries.get(family.id);
    if (!summary) continue;
    summary.patternCount += 1;
    summary.sampleCount += row.sampleCount;
    if (typeof row.meanReturnPct === "number" && Number.isFinite(row.meanReturnPct)) {
      summary.weightedReturnSum += row.meanReturnPct * row.sampleCount;
      summary.weightedReturnSampleCount += row.sampleCount;
    }
    const absTStat =
      typeof row.tStat === "number" && Number.isFinite(row.tStat)
        ? Math.abs(row.tStat)
        : null;
    if (
      absTStat != null &&
      (summary.bestAbsTStat == null || absTStat > summary.bestAbsTStat)
    ) {
      summary.bestAbsTStat = absTStat;
      summary.bestPatternKey = row.patternKey;
    }
  }

  return PATTERN_SETUP_FAMILIES.map((family) => {
    const summary = summaries.get(family.id);
    const sampleCount = summary?.sampleCount ?? 0;
    return {
      ...family,
      patternCount: summary?.patternCount ?? 0,
      sampleCount,
      weightedMeanReturnPct:
        summary && summary.weightedReturnSampleCount > 0
          ? round6(
              summary.weightedReturnSum / summary.weightedReturnSampleCount,
            )
          : null,
      bestPatternKey: summary?.bestPatternKey ?? null,
      bestAbsTStat:
        summary?.bestAbsTStat == null ? null : round6(summary.bestAbsTStat),
    };
  });
}
