export type GexProjectionOptionRow = {
  strike: number;
  cp: "C" | "P";
  expirationDate: string;
  gamma: number;
  delta: number;
  openInterest: number;
  impliedVol: number;
  bid: number;
  ask: number;
  multiplier: number;
  volume?: number | null;
};

export type GexProjectionRatesInput = {
  status: "ok" | "unavailable";
  source: string;
  asOf: string | null;
  points: Array<{ tenorYears: number; rate: number }>;
  message?: string | null;
};

export type GexProjectionDividendYieldInput = {
  status: "ok" | "unavailable";
  value: number;
  source: string;
  asOf?: string | null;
  message?: string | null;
};

export type GexProjectionSourceInput = {
  provider: string;
  status: "ok" | "partial" | "unavailable";
  expirationCoverage?: {
    requestedCount: number;
    returnedCount: number;
    loadedCount: number;
    failedCount: number;
    complete: boolean;
    capped: boolean;
  };
  optionCount: number;
  usableOptionCount: number;
  withGamma: number;
  withOpenInterest: number;
  withImpliedVolatility: number;
  flowStatus: "ok" | "unavailable" | string;
  flowEventCount: number;
  classifiedFlowEventCount: number;
  flowClassificationCoverage: number;
  flowClassificationConfidenceCounts?: {
    high: number;
    medium: number;
    low: number;
    none: number;
  };
};

export type GexProjectionFlowContextInput = {
  bullishShare: number;
  todayVol: number;
  avg30dVol: number | null;
  netDelta: number;
  refDelta: number;
  eventCount: number;
  volumeBaselineReady: boolean;
};

export type GexProjectionQualityStatus = "ok" | "partial" | "unavailable";

export type GexProjectionQuality = {
  status: GexProjectionQualityStatus;
  reasons: string[];
};

export type GexProjectionExpiration = {
  expirationDate: string;
  daysToExpiration: number;
  riskFreeRate: number;
  dividendYield: number;
  rawCenter: number;
  adjustedCenter: number;
  bands: {
    lower2: number;
    lower1: number;
    upper1: number;
    upper2: number;
  };
  gexLevels: {
    zeroGamma: number | null;
    callWall: number | null;
    putWall: number | null;
    peakGammaStrike: number | null;
    totalAbsGex: number;
    netGex: number;
  };
  dealerPositioning: {
    mode: "best_available";
    appliedSignBasis: "flow_adjusted" | "baseline_open_interest";
    confidence: number;
    direction: "bullish" | "bearish" | "neutral" | "unknown";
  };
  quality: GexProjectionQuality;
};

export type GexProjectionOverlayPoint = {
  expirationDate: string;
  time: string;
  lower2: number;
  lower1: number;
  center: number;
  upper1: number;
  upper2: number;
  qualityStatus: GexProjectionQualityStatus;
};

export type GexProjectionResponse = {
  ticker: string;
  spot: number;
  asOf: string;
  model: {
    pricingInput: "provider_iv";
    distribution: "provider_iv_risk_neutral_density";
    surfaceWeighting: "oi_volume_premium_spread_weighted_iv";
    dealerPositioningMode: "best_available";
    bands: "one_two_sigma_equivalent_quantiles";
  };
  source: GexProjectionSourceInput;
  rates: GexProjectionRatesInput;
  dividendYield: GexProjectionDividendYieldInput;
  quality: GexProjectionQuality;
  expirations: GexProjectionExpiration[];
  overlayPoints: GexProjectionOverlayPoint[];
};

export type BuildGexProjectionInput = {
  ticker: string;
  spot: number;
  asOf: string;
  options: GexProjectionOptionRow[];
  source: GexProjectionSourceInput;
  rates: GexProjectionRatesInput;
  dividendYield: GexProjectionDividendYieldInput;
  flowContext?: GexProjectionFlowContextInput | null;
};

type DensityPoint = {
  strike: number;
  mass: number;
};

type GexStrikeRow = {
  strike: number;
  callGex: number;
  putGex: number;
  netGex: number;
  absGex: number;
};

const MIN_VALID_STRIKES = 5;
const MIN_DAYS_TO_EXPIRATION = 0.25;
const OPTION_EXPIRATION_UTC_HOUR = 20;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundPrice(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function normalCdf(value: number): number {
  return 0.5 * (1 + erf(value / Math.sqrt(2)));
}

function erf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t -
      0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-x * x));
  return sign * y;
}

function blackScholesCallPrice(input: {
  spot: number;
  strike: number;
  timeToExpirationYears: number;
  volatility: number;
  riskFreeRate: number;
  dividendYield: number;
}): number {
  const years = Math.max(0, input.timeToExpirationYears);
  const discountedSpot = input.spot * Math.exp(-input.dividendYield * years);
  const discountedStrike = input.strike * Math.exp(-input.riskFreeRate * years);
  if (years === 0 || input.volatility <= 0) {
    return Math.max(0, discountedSpot - discountedStrike);
  }

  const sqrtYears = Math.sqrt(years);
  const d1 =
    (Math.log(input.spot / input.strike) +
      (input.riskFreeRate -
        input.dividendYield +
        0.5 * input.volatility * input.volatility) *
        years) /
    (input.volatility * sqrtYears);
  const d2 = d1 - input.volatility * sqrtYears;
  return Math.max(
    0,
    discountedSpot * normalCdf(d1) - discountedStrike * normalCdf(d2),
  );
}

function expirationDateTime(expirationDate: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expirationDate);
  if (!match) return null;
  return new Date(
    Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      OPTION_EXPIRATION_UTC_HOUR,
      0,
      0,
      0,
    ),
  );
}

function daysToExpiration(expirationDate: string, asOf: Date): number | null {
  const expiration = expirationDateTime(expirationDate);
  if (!expiration) return null;
  return (expiration.getTime() - asOf.getTime()) / (24 * 60 * 60 * 1000);
}

function resolveRiskFreeRate(
  rates: GexProjectionRatesInput,
  years: number,
): number {
  const points = rates.points
    .filter(
      (point) =>
        isFiniteNumber(point.tenorYears) &&
        point.tenorYears > 0 &&
        isFiniteNumber(point.rate),
    )
    .sort((left, right) => left.tenorYears - right.tenorYears);
  if (rates.status !== "ok" || points.length === 0) {
    return 0;
  }
  if (years <= points[0].tenorYears) {
    return points[0].rate;
  }
  const last = points[points.length - 1];
  if (years >= last.tenorYears) {
    return last.rate;
  }
  for (let index = 1; index < points.length; index += 1) {
    const right = points[index];
    const left = points[index - 1];
    if (years <= right.tenorYears) {
      const span = right.tenorYears - left.tenorYears;
      const ratio = span > 0 ? (years - left.tenorYears) / span : 0;
      return left.rate + (right.rate - left.rate) * ratio;
    }
  }
  return last.rate;
}

function groupByExpiration(
  options: GexProjectionOptionRow[],
): Map<string, GexProjectionOptionRow[]> {
  const groups = new Map<string, GexProjectionOptionRow[]>();
  options.forEach((option) => {
    if (!option?.expirationDate) return;
    const expirationDate = String(option.expirationDate).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expirationDate)) return;
    const current = groups.get(expirationDate) ?? [];
    current.push(option);
    groups.set(expirationDate, current);
  });
  return groups;
}

function optionMidPremium(row: GexProjectionOptionRow): number {
  const bid = isFiniteNumber(row.bid) && row.bid > 0 ? row.bid : 0;
  const ask = isFiniteNumber(row.ask) && row.ask > 0 ? row.ask : 0;
  if (bid > 0 && ask > 0) {
    return ask >= bid ? (bid + ask) / 2 : Math.max(bid, ask);
  }
  return Math.max(bid, ask);
}

function optionSpreadQuality(row: GexProjectionOptionRow): number {
  const bid = isFiniteNumber(row.bid) && row.bid > 0 ? row.bid : 0;
  const ask = isFiniteNumber(row.ask) && row.ask > 0 ? row.ask : 0;
  if (bid <= 0 || ask <= 0) {
    return 0.35;
  }
  const mid = optionMidPremium(row);
  if (mid <= 0) {
    return 0.2;
  }
  return clamp(1 - Math.abs(ask - bid) / mid, 0.2, 1);
}

function optionSurfaceWeight(row: GexProjectionOptionRow): number {
  const openInterest = Math.max(0, row.openInterest);
  const volume = Math.max(0, row.volume ?? 0);
  const midPremium = optionMidPremium(row);
  const multiplier = Math.max(1, row.multiplier);
  const contractInterest = openInterest + volume * 0.25;
  const premiumNotional = midPremium * multiplier * Math.max(1, contractInterest);
  const interestWeight = Math.sqrt(Math.max(1, contractInterest));
  const premiumWeight =
    midPremium > 0 ? clamp(Math.log1p(premiumNotional) / 10, 0.25, 4) : 0.25;
  return interestWeight * premiumWeight * optionSpreadQuality(row);
}

function buildStrikeVolSurface(rows: GexProjectionOptionRow[]): Array<{
  strike: number;
  volatility: number;
}> {
  const byStrike = new Map<
    number,
    Array<{ volatility: number; weight: number }>
  >();
  rows.forEach((row) => {
    if (
      !isFiniteNumber(row.strike) ||
      row.strike <= 0 ||
      !isFiniteNumber(row.impliedVol) ||
      row.impliedVol <= 0 ||
      row.impliedVol > 5
    ) {
      return;
    }
    const current = byStrike.get(row.strike) ?? [];
    current.push({
      volatility: row.impliedVol,
      weight: optionSurfaceWeight(row),
    });
    byStrike.set(row.strike, current);
  });

  return Array.from(byStrike.entries())
    .map(([strike, samples]) => {
      const totalWeight = samples.reduce(
        (sum, sample) => sum + sample.weight,
        0,
      );
      if (totalWeight > 0) {
        return {
          strike,
          volatility:
            samples.reduce(
              (sum, sample) => sum + sample.volatility * sample.weight,
              0,
            ) / totalWeight,
        };
      }
      const sorted = samples
        .map((sample) => sample.volatility)
        .sort((left, right) => left - right);
      const midpoint = Math.floor(sorted.length / 2);
      const volatility =
        sorted.length % 2 === 0
          ? (sorted[midpoint - 1] + sorted[midpoint]) / 2
          : sorted[midpoint];
      return { strike, volatility };
    })
    .sort((left, right) => left.strike - right.strike);
}

function buildRiskNeutralDensity(input: {
  spot: number;
  strikes: Array<{ strike: number; volatility: number }>;
  years: number;
  riskFreeRate: number;
  dividendYield: number;
}): { density: DensityPoint[]; reasons: string[] } {
  const reasons: string[] = [];
  const callPrices = input.strikes.map((point) => ({
    strike: point.strike,
    price: blackScholesCallPrice({
      spot: input.spot,
      strike: point.strike,
      timeToExpirationYears: input.years,
      volatility: point.volatility,
      riskFreeRate: input.riskFreeRate,
      dividendYield: input.dividendYield,
    }),
  }));

  const rawDensity: DensityPoint[] = [];
  for (let index = 1; index < callPrices.length - 1; index += 1) {
    const left = callPrices[index - 1];
    const mid = callPrices[index];
    const right = callPrices[index + 1];
    const leftSpan = mid.strike - left.strike;
    const rightSpan = right.strike - mid.strike;
    if (leftSpan <= 0 || rightSpan <= 0) continue;

    const leftSlope = (mid.price - left.price) / leftSpan;
    const rightSlope = (right.price - mid.price) / rightSpan;
    const secondDerivative =
      (2 * (rightSlope - leftSlope)) / (right.strike - left.strike);
    const adjustedDensity = Math.exp(input.riskFreeRate * input.years) * secondDerivative;
    if (adjustedDensity < -1e-5) {
      reasons.push("call price curve has local convexity noise");
    }
    const intervalWidth = (right.strike - left.strike) / 2;
    rawDensity.push({
      strike: mid.strike,
      mass: Math.max(0, adjustedDensity) * intervalWidth,
    });
  }

  const totalMass = rawDensity.reduce((sum, point) => sum + point.mass, 0);
  if (totalMass <= 0) {
    return {
      density: [],
      reasons: [...new Set([...reasons, "density did not produce positive mass"])],
    };
  }

  return {
    density: rawDensity.map((point) => ({
      strike: point.strike,
      mass: point.mass / totalMass,
    })),
    reasons: [...new Set(reasons)],
  };
}

function quantile(density: DensityPoint[], probability: number): number | null {
  if (!density.length) return null;
  const target = clamp(probability, 0, 1);
  let cumulative = 0;
  for (const point of density) {
    cumulative += point.mass;
    if (cumulative >= target) {
      return point.strike;
    }
  }
  return density[density.length - 1].strike;
}

function densityMean(density: DensityPoint[]): number | null {
  if (!density.length) return null;
  return density.reduce((sum, point) => sum + point.strike * point.mass, 0);
}

function resolveDealerPositioning(input: {
  source: GexProjectionSourceInput;
  flowContext?: GexProjectionFlowContextInput | null;
}): GexProjectionExpiration["dealerPositioning"] {
  const counts = input.source.flowClassificationConfidenceCounts;
  const high = counts?.high ?? 0;
  const medium = counts?.medium ?? 0;
  const classified = input.source.classifiedFlowEventCount;
  const confidenceShare = classified > 0 ? (high + medium) / classified : 0;
  const coverage = input.source.flowClassificationCoverage;
  const context = input.flowContext;
  const directionalEdge = isFiniteNumber(context?.bullishShare)
    ? Math.abs(Number(context?.bullishShare) - 0.5) * 2
    : 0;
  const volumeReady = Boolean(context?.volumeBaselineReady);
  const eventCount = Math.max(
    input.source.flowEventCount || 0,
    context?.eventCount || 0,
  );
  const confidence = clamp(
    coverage * 0.45 +
      confidenceShare * 0.35 +
      directionalEdge * 0.15 +
      (volumeReady ? 0.05 : 0),
    0,
    1,
  );
  const flowUsable =
    input.source.flowStatus === "ok" &&
    eventCount >= 10 &&
    coverage >= 0.55 &&
    confidenceShare >= 0.45 &&
    directionalEdge >= 0.18 &&
    confidence >= 0.5;

  if (!flowUsable) {
    return {
      mode: "best_available",
      appliedSignBasis: "baseline_open_interest",
      confidence: roundPrice(confidence * 0.45),
      direction: context?.bullishShare == null ? "unknown" : "neutral",
    };
  }

  return {
    mode: "best_available",
    appliedSignBasis: "flow_adjusted",
    confidence: roundPrice(confidence),
    direction: Number(context?.bullishShare) > 0.5 ? "bullish" : "bearish",
  };
}

function gexSign(
  option: GexProjectionOptionRow,
  dealerPositioning: GexProjectionExpiration["dealerPositioning"],
): number {
  if (dealerPositioning.appliedSignBasis !== "flow_adjusted") {
    return option.cp === "P" ? -1 : 1;
  }
  if (dealerPositioning.direction === "bullish") {
    return option.cp === "C" ? -1 : 1;
  }
  if (dealerPositioning.direction === "bearish") {
    return option.cp === "P" ? -1 : 1;
  }
  return option.cp === "P" ? -1 : 1;
}

function contractGex(
  option: GexProjectionOptionRow,
  spot: number,
  dealerPositioning: GexProjectionExpiration["dealerPositioning"],
): number {
  if (
    !isFiniteNumber(option.gamma) ||
    !isFiniteNumber(option.openInterest) ||
    !isFiniteNumber(option.multiplier)
  ) {
    return 0;
  }
  return (
    gexSign(option, dealerPositioning) *
    option.gamma *
    Math.max(0, option.openInterest) *
    Math.max(1, option.multiplier) *
    spot *
    spot *
    0.01
  );
}

function selectPeakGexRow(
  rows: GexStrikeRow[],
  valueForRow: (row: GexStrikeRow) => number,
  spot: number,
): GexStrikeRow | null {
  const best = rows.reduce<GexStrikeRow | null>((currentBest, row) => {
    const value = Math.abs(valueForRow(row));
    const bestValue =
      currentBest == null ? -1 : Math.abs(valueForRow(currentBest));
    if (value > bestValue + 1e-9) {
      return row;
    }
    if (Math.abs(value - bestValue) <= 1e-9 && currentBest != null) {
      const distance = Math.abs(row.strike - spot);
      const bestDistance = Math.abs(currentBest.strike - spot);
      return distance < bestDistance ? row : currentBest;
    }
    return currentBest;
  }, null);
  return best != null && Math.abs(valueForRow(best)) > 0 ? best : null;
}

function buildGexLevels(
  rows: GexProjectionOptionRow[],
  spot: number,
  dealerPositioning: GexProjectionExpiration["dealerPositioning"],
): GexProjectionExpiration["gexLevels"] {
  const profile = new Map<number, GexStrikeRow>();
  rows.forEach((row) => {
    if (!isFiniteNumber(row.strike) || row.strike <= 0) return;
    const current =
      profile.get(row.strike) ?? {
        strike: row.strike,
        callGex: 0,
        putGex: 0,
        netGex: 0,
        absGex: 0,
      };
    const value = contractGex(row, spot, dealerPositioning);
    if (row.cp === "C") {
      current.callGex += value;
    } else {
      current.putGex += value;
    }
    current.netGex = current.callGex + current.putGex;
    current.absGex = Math.abs(current.callGex) + Math.abs(current.putGex);
    profile.set(row.strike, current);
  });
  const ordered = Array.from(profile.values()).sort(
    (left, right) => left.strike - right.strike,
  );
  const totalAbsGex = ordered.reduce((sum, row) => sum + row.absGex, 0);
  const netGex = ordered.reduce((sum, row) => sum + row.netGex, 0);
  const callWall =
    selectPeakGexRow(ordered, (row) => row.callGex, spot)?.strike ?? null;
  const putWall =
    selectPeakGexRow(ordered, (row) => row.putGex, spot)?.strike ?? null;
  const peakGammaStrike =
    selectPeakGexRow(ordered, (row) => row.absGex, spot)?.strike ?? null;

  let zeroGamma: number | null = null;
  let previousStrike: number | null = null;
  let previousCum = 0;
  for (const row of ordered) {
    const nextCum = previousCum + row.netGex;
    if (previousStrike == null) {
      if (nextCum === 0) zeroGamma = row.strike;
    } else if (
      (previousCum < 0 && nextCum >= 0) ||
      (previousCum > 0 && nextCum <= 0) ||
      nextCum === 0
    ) {
      const denominator = Math.abs(previousCum) + Math.abs(nextCum);
      const ratio = denominator > 0 ? Math.abs(previousCum) / denominator : 0;
      zeroGamma = previousStrike + ratio * (row.strike - previousStrike);
      break;
    }
    previousStrike = row.strike;
    previousCum = nextCum;
  }

  return {
    zeroGamma: zeroGamma == null ? null : roundPrice(zeroGamma),
    callWall,
    putWall,
    peakGammaStrike,
    totalAbsGex: roundPrice(totalAbsGex),
    netGex: roundPrice(netGex),
  };
}

function resolveAdjustedCenter(input: {
  rawCenter: number;
  lower1: number;
  upper1: number;
  gexLevels: GexProjectionExpiration["gexLevels"];
}): number {
  const candidates = [
    input.gexLevels.peakGammaStrike,
    input.gexLevels.zeroGamma,
    input.gexLevels.callWall,
    input.gexLevels.putWall,
  ].filter(isFiniteNumber);
  if (!candidates.length || input.gexLevels.totalAbsGex <= 0) {
    return input.rawCenter;
  }
  const equilibrium =
    candidates.reduce((sum, value) => sum + value, 0) / candidates.length;
  const pull = clamp(input.gexLevels.totalAbsGex / 2_500_000, 0.05, 0.35);
  return clamp(
    input.rawCenter + (equilibrium - input.rawCenter) * pull,
    input.lower1,
    input.upper1,
  );
}

function unavailableExpiration(
  expirationDate: string,
  days: number,
  riskFreeRate: number,
  dividendYield: number,
  dealerPositioning: GexProjectionExpiration["dealerPositioning"],
  reasons: string[],
): GexProjectionExpiration {
  return {
    expirationDate,
    daysToExpiration: roundPrice(Math.max(0, days)),
    riskFreeRate,
    dividendYield,
    rawCenter: 0,
    adjustedCenter: 0,
    bands: { lower2: 0, lower1: 0, upper1: 0, upper2: 0 },
    gexLevels: {
      zeroGamma: null,
      callWall: null,
      putWall: null,
      peakGammaStrike: null,
      totalAbsGex: 0,
      netGex: 0,
    },
    dealerPositioning,
    quality: {
      status: "unavailable",
      reasons,
    },
  };
}

function buildExpirationProjection(input: {
  expirationDate: string;
  rows: GexProjectionOptionRow[];
  spot: number;
  asOfDate: Date;
  rates: GexProjectionRatesInput;
  dividendYield: GexProjectionDividendYieldInput;
  dealerPositioning: GexProjectionExpiration["dealerPositioning"];
}): GexProjectionExpiration {
  const days = daysToExpiration(input.expirationDate, input.asOfDate);
  const safeDays = days ?? 0;
  const years = Math.max(0, safeDays / 365);
  const riskFreeRate = resolveRiskFreeRate(input.rates, years);
  const dividendYield =
    isFiniteNumber(input.dividendYield.value) && input.dividendYield.value > 0
      ? input.dividendYield.value
      : 0;
  const commonUnavailable = (reasons: string[]) =>
    unavailableExpiration(
      input.expirationDate,
      safeDays,
      riskFreeRate,
      dividendYield,
      input.dealerPositioning,
      reasons,
    );

  if (days == null) {
    return commonUnavailable(["expiration date is invalid"]);
  }
  if (safeDays < MIN_DAYS_TO_EXPIRATION) {
    return commonUnavailable(["expiration is too close or already expired"]);
  }

  const strikeVolSurface = buildStrikeVolSurface(input.rows);
  if (strikeVolSurface.length < MIN_VALID_STRIKES) {
    return commonUnavailable([
      `expiration has fewer than ${MIN_VALID_STRIKES} strikes with valid IV`,
    ]);
  }

  const densityResult = buildRiskNeutralDensity({
    spot: input.spot,
    strikes: strikeVolSurface,
    years,
    riskFreeRate,
    dividendYield,
  });
  const lower2 = quantile(densityResult.density, 0.0228);
  const lower1 = quantile(densityResult.density, 0.1587);
  const median = quantile(densityResult.density, 0.5);
  const upper1 = quantile(densityResult.density, 0.8413);
  const upper2 = quantile(densityResult.density, 0.9772);
  const mean = densityMean(densityResult.density);

  if (
    !isFiniteNumber(lower2) ||
    !isFiniteNumber(lower1) ||
    !isFiniteNumber(median) ||
    !isFiniteNumber(upper1) ||
    !isFiniteNumber(upper2) ||
    lower2 > lower1 ||
    lower1 > median ||
    median > upper1 ||
    upper1 > upper2
  ) {
    return commonUnavailable([
      ...densityResult.reasons,
      "density quantiles are not monotonic",
    ]);
  }

  const rawCenter = mean ?? median;
  const gexLevels = buildGexLevels(input.rows, input.spot, input.dealerPositioning);
  const adjustedCenter = resolveAdjustedCenter({
    rawCenter,
    lower1,
    upper1,
    gexLevels,
  });
  const reasons = densityResult.reasons;
  const qualityStatus: GexProjectionQualityStatus = reasons.length
    ? "partial"
    : "ok";

  return {
    expirationDate: input.expirationDate,
    daysToExpiration: roundPrice(safeDays),
    riskFreeRate: roundPrice(riskFreeRate),
    dividendYield: roundPrice(dividendYield),
    rawCenter: roundPrice(rawCenter),
    adjustedCenter: roundPrice(adjustedCenter),
    bands: {
      lower2: roundPrice(lower2),
      lower1: roundPrice(lower1),
      upper1: roundPrice(upper1),
      upper2: roundPrice(upper2),
    },
    gexLevels,
    dealerPositioning: input.dealerPositioning,
    quality: {
      status: qualityStatus,
      reasons,
    },
  };
}

function summarizeQuality(
  source: GexProjectionSourceInput,
  rates: GexProjectionRatesInput,
  dividendYield: GexProjectionDividendYieldInput,
  expirations: GexProjectionExpiration[],
): GexProjectionQuality {
  const reasons: string[] = [];
  if (source.status !== "ok") {
    reasons.push("GEX source is partial or unavailable");
  }
  if (source.expirationCoverage?.complete === false) {
    reasons.push("expiration coverage is incomplete");
  }
  if (source.expirationCoverage?.capped) {
    reasons.push("expiration coverage is capped");
  }
  if (rates.status !== "ok") {
    reasons.push("risk-free rate source is unavailable");
  }
  if (dividendYield.status !== "ok") {
    reasons.push("dividend yield source is unavailable");
  }
  const usable = expirations.filter(
    (expiration) => expiration.quality.status !== "unavailable",
  );
  if (!usable.length) {
    reasons.push("no expiration produced a usable projection");
  }
  const hasPartialExpiration = expirations.some(
    (expiration) => expiration.quality.status === "partial",
  );
  const status: GexProjectionQualityStatus = !usable.length
    ? "unavailable"
    : reasons.length || hasPartialExpiration
      ? "partial"
      : "ok";
  return {
    status,
    reasons: [...new Set(reasons)],
  };
}

export function buildGexProjection(
  input: BuildGexProjectionInput,
): GexProjectionResponse {
  const spot = isFiniteNumber(input.spot) && input.spot > 0 ? input.spot : 0;
  const asOfDate = new Date(input.asOf);
  const asOf = Number.isNaN(asOfDate.getTime())
    ? new Date().toISOString()
    : asOfDate.toISOString();
  const normalizedTicker = String(input.ticker || "").trim().toUpperCase();
  const dealerPositioning = resolveDealerPositioning({
    source: input.source,
    flowContext: input.flowContext,
  });
  const groups = groupByExpiration(input.options || []);
  const expirations = Array.from(groups.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([expirationDate, rows]) =>
      buildExpirationProjection({
        expirationDate,
        rows,
        spot,
        asOfDate: new Date(asOf),
        rates: input.rates,
        dividendYield: input.dividendYield,
        dealerPositioning,
      }),
    );
  const overlayPoints = expirations
    .filter((expiration) => expiration.quality.status !== "unavailable")
    .map((expiration) => ({
      expirationDate: expiration.expirationDate,
      time: expiration.expirationDate,
      lower2: expiration.bands.lower2,
      lower1: expiration.bands.lower1,
      center: expiration.adjustedCenter,
      upper1: expiration.bands.upper1,
      upper2: expiration.bands.upper2,
      qualityStatus: expiration.quality.status,
    }));
  const quality = summarizeQuality(
    input.source,
    input.rates,
    input.dividendYield,
    expirations,
  );

  return {
    ticker: normalizedTicker,
    spot: roundPrice(spot),
    asOf,
    model: {
      pricingInput: "provider_iv",
      distribution: "provider_iv_risk_neutral_density",
      surfaceWeighting: "oi_volume_premium_spread_weighted_iv",
      dealerPositioningMode: "best_available",
      bands: "one_two_sigma_equivalent_quantiles",
    },
    source: input.source,
    rates: input.rates,
    dividendYield: input.dividendYield,
    quality,
    expirations,
    overlayPoints,
  };
}
