export type OptionGreekSelectorRight = "call" | "put";

export type BlackScholesResult = {
  price: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
};

export type OptionGreekSnapshot = BlackScholesResult & {
  impliedVolatility: number;
  timeToExpirationYears: number;
};

export type OptionGreekScoreComponents = {
  deltaFit: number;
  breakevenFit: number;
  gammaTheta: number;
  ivValue: number;
  liquidity: number;
  dataQuality: number;
};

export type OptionGreekScore = {
  total: number;
  components: OptionGreekScoreComponents;
  notes: string[];
  breakevenMovePct: number | null;
  expectedMovePct: number | null;
  thetaDailyPct: number | null;
};

export type ScoreOptionGreekCandidateInput = {
  right: OptionGreekSelectorRight;
  spot: number;
  strike: number;
  entryPrice: number;
  volume?: number | null;
  hasExitPrice?: boolean;
  greeks: OptionGreekSnapshot;
};

const MIN_VOLATILITY = 0.0001;
const MAX_VOLATILITY = 5;

function finitePositive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, decimals = 6): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

export function normalPdf(value: number): number {
  return Math.exp(-0.5 * value * value) / Math.sqrt(2 * Math.PI);
}

export function normalCdf(value: number): number {
  return 0.5 * (1 + erf(value / Math.sqrt(2)));
}

function erf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-x * x));
  return sign * y;
}

function deterministicBlackScholes(input: {
  spot: number;
  strike: number;
  timeToExpirationYears: number;
  right: OptionGreekSelectorRight;
  riskFreeRate: number;
  dividendYield: number;
}): BlackScholesResult {
  const years = Math.max(input.timeToExpirationYears, 0);
  const forward = input.spot * Math.exp((input.riskFreeRate - input.dividendYield) * years);
  const discountedPayoff = Math.exp(-input.riskFreeRate * years);
  if (input.right === "put") {
    return {
      price: discountedPayoff * Math.max(input.strike - forward, 0),
      delta: forward < input.strike ? -Math.exp(-input.dividendYield * years) : 0,
      gamma: 0,
      theta: 0,
      vega: 0,
    };
  }
  return {
    price: discountedPayoff * Math.max(forward - input.strike, 0),
    delta: forward > input.strike ? Math.exp(-input.dividendYield * years) : 0,
    gamma: 0,
    theta: 0,
    vega: 0,
  };
}

export function blackScholes(input: {
  spot: number;
  strike: number;
  timeToExpirationYears: number;
  volatility: number;
  right: OptionGreekSelectorRight;
  riskFreeRate?: number;
  dividendYield?: number;
}): BlackScholesResult {
  const spot = finitePositive(input.spot);
  const strike = finitePositive(input.strike);
  const years = input.timeToExpirationYears;
  const volatility = input.volatility;
  const riskFreeRate = input.riskFreeRate ?? 0;
  const dividendYield = input.dividendYield ?? 0;
  if (spot == null) throw new Error("spot must be a positive finite number");
  if (strike == null) throw new Error("strike must be a positive finite number");
  if (!Number.isFinite(years) || years < 0) {
    throw new Error("timeToExpirationYears must be a non-negative finite number");
  }
  if (!Number.isFinite(volatility) || volatility < 0) {
    throw new Error("volatility must be a non-negative finite number");
  }
  if (!Number.isFinite(riskFreeRate)) throw new Error("riskFreeRate must be finite");
  if (!Number.isFinite(dividendYield)) throw new Error("dividendYield must be finite");

  if (years === 0 || volatility <= 0) {
    return deterministicBlackScholes({
      spot,
      strike,
      timeToExpirationYears: years,
      right: input.right,
      riskFreeRate,
      dividendYield,
    });
  }

  const sqrtYears = Math.sqrt(years);
  const d1 =
    (Math.log(spot / strike) +
      (riskFreeRate - dividendYield + 0.5 * volatility * volatility) * years) /
    (volatility * sqrtYears);
  const d2 = d1 - volatility * sqrtYears;
  const discountedSpot = spot * Math.exp(-dividendYield * years);
  const discountedStrike = strike * Math.exp(-riskFreeRate * years);
  const pdfD1 = normalPdf(d1);

  if (input.right === "put") {
    const price = discountedStrike * normalCdf(-d2) - discountedSpot * normalCdf(-d1);
    const thetaAnnual =
      -(discountedSpot * pdfD1 * volatility) / (2 * sqrtYears) +
      riskFreeRate * discountedStrike * normalCdf(-d2) -
      dividendYield * discountedSpot * normalCdf(-d1);
    return {
      price: Math.max(0, price),
      delta: Math.exp(-dividendYield * years) * (normalCdf(d1) - 1),
      gamma: Math.exp(-dividendYield * years) * pdfD1 / (spot * volatility * sqrtYears),
      theta: thetaAnnual / 365,
      vega: (discountedSpot * pdfD1 * sqrtYears) / 100,
    };
  }

  const price = discountedSpot * normalCdf(d1) - discountedStrike * normalCdf(d2);
  const thetaAnnual =
    -(discountedSpot * pdfD1 * volatility) / (2 * sqrtYears) -
    riskFreeRate * discountedStrike * normalCdf(d2) +
    dividendYield * discountedSpot * normalCdf(d1);
  return {
    price: Math.max(0, price),
    delta: Math.exp(-dividendYield * years) * normalCdf(d1),
    gamma: Math.exp(-dividendYield * years) * pdfD1 / (spot * volatility * sqrtYears),
    theta: thetaAnnual / 365,
    vega: (discountedSpot * pdfD1 * sqrtYears) / 100,
  };
}

export function impliedVolatilityFromPrice(input: {
  spot: number;
  strike: number;
  timeToExpirationYears: number;
  optionPrice: number;
  right: OptionGreekSelectorRight;
  riskFreeRate?: number;
  dividendYield?: number;
  minVolatility?: number;
  maxVolatility?: number;
}): number | null {
  const spot = finitePositive(input.spot);
  const strike = finitePositive(input.strike);
  const optionPrice = finitePositive(input.optionPrice);
  const years = input.timeToExpirationYears;
  if (spot == null || strike == null || optionPrice == null || !Number.isFinite(years) || years <= 0) {
    return null;
  }

  const minVolatility = input.minVolatility ?? MIN_VOLATILITY;
  const maxVolatility = input.maxVolatility ?? MAX_VOLATILITY;
  const lowPrice = blackScholes({
    spot,
    strike,
    timeToExpirationYears: years,
    volatility: minVolatility,
    right: input.right,
    riskFreeRate: input.riskFreeRate,
    dividendYield: input.dividendYield,
  }).price;
  const highPrice = blackScholes({
    spot,
    strike,
    timeToExpirationYears: years,
    volatility: maxVolatility,
    right: input.right,
    riskFreeRate: input.riskFreeRate,
    dividendYield: input.dividendYield,
  }).price;
  if (!Number.isFinite(lowPrice) || !Number.isFinite(highPrice)) return null;
  if (optionPrice <= lowPrice) return minVolatility;
  if (optionPrice >= highPrice) return maxVolatility;

  let low = minVolatility;
  let high = maxVolatility;
  for (let index = 0; index < 64; index += 1) {
    const mid = (low + high) / 2;
    const price = blackScholes({
      spot,
      strike,
      timeToExpirationYears: years,
      volatility: mid,
      right: input.right,
      riskFreeRate: input.riskFreeRate,
      dividendYield: input.dividendYield,
    }).price;
    if (price < optionPrice) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return (low + high) / 2;
}

export function timeToExpirationYears(input: {
  at: Date;
  expirationDate: Date;
}): number {
  const expirationCloseUtc = Date.UTC(
    input.expirationDate.getUTCFullYear(),
    input.expirationDate.getUTCMonth(),
    input.expirationDate.getUTCDate(),
    20,
    0,
    0,
    0,
  );
  return Math.max(0, (expirationCloseUtc - input.at.getTime()) / (365 * 24 * 60 * 60 * 1000));
}

export function computeOptionGreeksFromPrice(input: {
  spot: number;
  strike: number;
  optionPrice: number;
  right: OptionGreekSelectorRight;
  at: Date;
  expirationDate: Date;
  riskFreeRate?: number;
  dividendYield?: number;
}): OptionGreekSnapshot | null {
  const years = timeToExpirationYears({
    at: input.at,
    expirationDate: input.expirationDate,
  });
  const impliedVolatility = impliedVolatilityFromPrice({
    spot: input.spot,
    strike: input.strike,
    timeToExpirationYears: years,
    optionPrice: input.optionPrice,
    right: input.right,
    riskFreeRate: input.riskFreeRate,
    dividendYield: input.dividendYield,
  });
  if (impliedVolatility == null) return null;
  return {
    ...blackScholes({
      spot: input.spot,
      strike: input.strike,
      timeToExpirationYears: years,
      volatility: impliedVolatility,
      right: input.right,
      riskFreeRate: input.riskFreeRate,
      dividendYield: input.dividendYield,
    }),
    impliedVolatility,
    timeToExpirationYears: years,
  };
}

function breakevenMovePct(input: ScoreOptionGreekCandidateInput): number | null {
  if (input.spot <= 0) return null;
  const breakeven =
    input.right === "put"
      ? input.spot - (input.strike - input.entryPrice)
      : input.strike + input.entryPrice - input.spot;
  return breakeven / input.spot;
}

// A directional options entry must carry real directional exposure. Below this
// delta the contract barely tracks the underlying — it's a lottery ticket, not a
// trade (the DIA 471P that triggered this work had |delta| ~= 0). Such a contract
// is disqualified outright so the scorer never RANKS it as selectable, rather than
// relying on a downstream moneyness guard to catch the pick after the fact.
export const MIN_TRADEABLE_ABS_DELTA = 0.15;

export function scoreOptionGreekCandidate(input: ScoreOptionGreekCandidateInput): OptionGreekScore {
  const notes: string[] = [];
  const absDelta = Math.abs(input.greeks.delta);
  const deltaFit = clamp(1 - Math.abs(absDelta - 0.45) / 0.35, 0, 1) * 30;
  if (absDelta < 0.2) notes.push("low_delta");
  if (absDelta > 0.8) notes.push("deep_itm_delta");

  const expectedMovePct =
    input.greeks.impliedVolatility * Math.sqrt(input.greeks.timeToExpirationYears);
  const breakevenPct = breakevenMovePct(input);
  const breakevenFit =
    breakevenPct == null || expectedMovePct <= 0
      ? 0
      : clamp((expectedMovePct - Math.max(0, breakevenPct)) / expectedMovePct, -1, 1) * 20;
  if (breakevenPct != null && expectedMovePct > 0 && breakevenPct > expectedMovePct) {
    notes.push("breakeven_beyond_expected_move");
  }

  const thetaDailyPct =
    input.entryPrice > 0 ? Math.abs(input.greeks.theta) / input.entryPrice : null;
  // Premium-fraction gained from gamma on a 1% underlying move. Dividing by the
  // entry premium keeps the ratio with thetaDailyPct (premium-fraction lost per
  // day) dimensionless, so the component compares gamma efficiency across
  // underlying price levels instead of saturating on expensive underlyings.
  const gammaMovePremiumFraction =
    input.entryPrice > 0
      ? (input.greeks.gamma * input.spot * input.spot * 0.0001) / input.entryPrice
      : null;
  const gammaTheta =
    thetaDailyPct == null || gammaMovePremiumFraction == null
      ? 0
      : clamp(gammaMovePremiumFraction / Math.max(thetaDailyPct, 0.002), 0, 1) * 15;
  if (thetaDailyPct != null && thetaDailyPct > 0.08) notes.push("high_theta_burden");

  const premiumMovePct = input.entryPrice / input.spot;
  const premiumToExpectedMove =
    expectedMovePct > 0 ? premiumMovePct / expectedMovePct : Number.POSITIVE_INFINITY;
  const ivPenalty = clamp((input.greeks.impliedVolatility - 1.2) / 1.8, 0, 1) * 10;
  const valuePenalty = clamp((premiumToExpectedMove - 0.45) / 0.75, 0, 1) * 10;
  const ivValue = 15 - ivPenalty - valuePenalty;
  if (ivPenalty > 0 || valuePenalty > 0) notes.push("overprice_penalty");

  const liquidity = clamp((input.volume ?? 0) / 100, 0, 1) * 10;
  if ((input.volume ?? 0) < 10) notes.push("thin_option_volume");

  const dataQuality = input.hasExitPrice === false ? 0 : 10;
  if (input.hasExitPrice === false) notes.push("missing_exit_price");

  const components = {
    deltaFit: round(deltaFit, 3),
    breakevenFit: round(breakevenFit, 3),
    gammaTheta: round(gammaTheta, 3),
    ivValue: round(ivValue, 3),
    liquidity: round(liquidity, 3),
    dataQuality: round(dataQuality, 3),
  };
  const rawTotal = Object.values(components).reduce((sum, value) => sum + value, 0);
  // Disqualify a contract with no real directional exposure: drive the total
  // strongly negative so it falls below any sane minScore and is never selected,
  // instead of letting the baseline ivValue/dataQuality components float it above
  // the threshold.
  const disqualified = absDelta < MIN_TRADEABLE_ABS_DELTA;
  if (disqualified) notes.push("below_min_tradeable_delta");
  const total = disqualified ? Math.min(rawTotal, -100) : rawTotal;
  return {
    total: round(total, 3),
    components,
    notes,
    breakevenMovePct: breakevenPct == null ? null : round(breakevenPct, 6),
    expectedMovePct: round(expectedMovePct, 6),
    thetaDailyPct: thetaDailyPct == null ? null : round(thetaDailyPct, 6),
  };
}
