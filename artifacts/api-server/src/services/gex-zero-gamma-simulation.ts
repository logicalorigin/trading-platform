export type GexZeroGammaSimulationOption = {
  strike: number;
  cp: "C" | "P";
  expirationDate?: string | null;
  expireYear?: number | null;
  expireMonth?: number | null;
  expireDay?: number | null;
  openInterest: number;
  impliedVol: number;
  multiplier?: number | null;
};

export type GexZeroGammaSimulation = {
  version: "gex-zero-gamma-spot-sweep-v1";
  method: "black_scholes_gamma_spot_sweep";
  selection: "nearest_spot_crossing";
  ticker: string;
  spot: number;
  zeroGamma: number | null;
  netGexAtSpot: number;
  asOf: string;
  crossings: Array<{
    price: number;
    distancePct: number;
    bracket: [number, number];
    netGexBefore: number;
    netGexAfter: number;
  }>;
  scan: {
    lower: number;
    upper: number;
    pointCount: number;
    refinement: "bisection";
  };
  quality: {
    status: "ok" | "partial" | "unavailable";
    reasons: string[];
    usableOptionCount: number;
    expirationCount: number;
    ivCoverage: number;
    rateStatus: "ok" | "unavailable";
    dividendYieldStatus: "ok" | "unavailable";
  };
};

type BuildGexZeroGammaSimulationInput = {
  ticker: string;
  spot: number;
  asOf: string;
  options: GexZeroGammaSimulationOption[];
  riskFreeRate?: number | null;
  dividendYield?: number | null;
  scan?: {
    lower?: number;
    upper?: number;
    pointCount?: number;
  };
};

type PreparedOption = {
  strike: number;
  cp: "C" | "P";
  openInterest: number;
  impliedVol: number;
  multiplier: number;
  yearsToExpiration: number;
  expirationKey: string;
};

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const OPTION_EXPIRATION_UTC_HOUR = 20;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const roundPrice = (value: number) => Math.round(value * 10_000) / 10_000;

const roundGex = (value: number) => Math.round(value * 100) / 100;

const normalPdf = (value: number) =>
  Math.exp(-0.5 * value * value) / Math.sqrt(2 * Math.PI);

const parseExpirationKey = (
  option: GexZeroGammaSimulationOption,
): string | null => {
  const direct = String(option.expirationDate || "");
  const directMatch = direct.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (directMatch) return `${directMatch[1]}-${directMatch[2]}-${directMatch[3]}`;

  if (
    Number.isInteger(option.expireYear) &&
    Number.isInteger(option.expireMonth) &&
    Number.isInteger(option.expireDay)
  ) {
    return `${String(option.expireYear).padStart(4, "0")}-${String(
      option.expireMonth,
    ).padStart(2, "0")}-${String(option.expireDay).padStart(2, "0")}`;
  }

  return null;
};

const expirationTimeMs = (expirationKey: string): number | null => {
  const match = expirationKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const time = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    OPTION_EXPIRATION_UTC_HOUR,
    0,
    0,
    0,
  );
  return Number.isFinite(time) ? time : null;
};

const blackScholesGamma = ({
  spot,
  strike,
  yearsToExpiration,
  volatility,
  riskFreeRate,
  dividendYield,
}: {
  spot: number;
  strike: number;
  yearsToExpiration: number;
  volatility: number;
  riskFreeRate: number;
  dividendYield: number;
}) => {
  if (
    spot <= 0 ||
    strike <= 0 ||
    yearsToExpiration <= 0 ||
    volatility <= 0
  ) {
    return 0;
  }

  const sqrtYears = Math.sqrt(yearsToExpiration);
  const d1 =
    (Math.log(spot / strike) +
      (riskFreeRate - dividendYield + 0.5 * volatility * volatility) *
        yearsToExpiration) /
    (volatility * sqrtYears);
  return (
    Math.exp(-dividendYield * yearsToExpiration) *
    normalPdf(d1) /
    (spot * volatility * sqrtYears)
  );
};

const prepareOptions = (
  options: GexZeroGammaSimulationOption[],
  asOfMs: number,
) => {
  const reasons = new Set<string>();
  const expirations = new Set<string>();
  let candidateCount = 0;
  const prepared: PreparedOption[] = [];

  options.forEach((option) => {
    if (
      !isFiniteNumber(option.strike) ||
      option.strike <= 0 ||
      (option.cp !== "C" && option.cp !== "P") ||
      !isFiniteNumber(option.openInterest) ||
      option.openInterest <= 0
    ) {
      return;
    }

    const expirationKey = parseExpirationKey(option);
    const expirationMs = expirationKey ? expirationTimeMs(expirationKey) : null;
    if (expirationKey) expirations.add(expirationKey);
    if (expirationKey == null || expirationMs == null || expirationMs <= asOfMs) {
      reasons.add("expired or invalid expirations were skipped");
      return;
    }

    candidateCount += 1;
    if (
      !isFiniteNumber(option.impliedVol) ||
      option.impliedVol <= 0 ||
      option.impliedVol > 5
    ) {
      reasons.add("options with missing or invalid IV were skipped");
      return;
    }

    prepared.push({
      strike: option.strike,
      cp: option.cp,
      openInterest: option.openInterest,
      impliedVol: option.impliedVol,
      multiplier:
        isFiniteNumber(option.multiplier) && option.multiplier > 0
          ? option.multiplier
          : 100,
      yearsToExpiration: (expirationMs - asOfMs) / YEAR_MS,
      expirationKey,
    });
  });

  return { prepared, reasons, expirations, candidateCount };
};

const netGexAtPrice = (
  options: PreparedOption[],
  price: number,
  riskFreeRate: number,
  dividendYield: number,
) =>
  options.reduce((sum, option) => {
    const sign = option.cp === "P" ? -1 : 1;
    const gamma = blackScholesGamma({
      spot: price,
      strike: option.strike,
      yearsToExpiration: option.yearsToExpiration,
      volatility: option.impliedVol,
      riskFreeRate,
      dividendYield,
    });
    return (
      sum +
      sign *
        gamma *
        option.openInterest *
        option.multiplier *
        price *
        price *
        0.01
    );
  }, 0);

const signOf = (value: number) => (value > 0 ? 1 : value < 0 ? -1 : 0);

const refineCrossing = ({
  leftPrice,
  rightPrice,
  leftValue,
  rightValue,
  valueAt,
}: {
  leftPrice: number;
  rightPrice: number;
  leftValue: number;
  rightValue: number;
  valueAt: (price: number) => number;
}) => {
  if (leftValue === 0) return leftPrice;
  if (rightValue === 0) return rightPrice;

  let lowPrice = leftPrice;
  let highPrice = rightPrice;
  let lowValue = leftValue;
  let highValue = rightValue;

  for (let index = 0; index < 32; index += 1) {
    const midPrice = (lowPrice + highPrice) / 2;
    const midValue = valueAt(midPrice);
    if (midValue === 0) return midPrice;
    if (signOf(midValue) === signOf(lowValue)) {
      lowPrice = midPrice;
      lowValue = midValue;
    } else {
      highPrice = midPrice;
      highValue = midValue;
    }
    if (Math.abs(highPrice - lowPrice) < 0.0001) break;
  }

  return Math.abs(lowValue) < Math.abs(highValue) ? lowPrice : highPrice;
};

export function buildGexZeroGammaSimulation(
  input: BuildGexZeroGammaSimulationInput,
): GexZeroGammaSimulation {
  const spot = isFiniteNumber(input.spot) && input.spot > 0 ? input.spot : 0;
  const asOfDate = new Date(input.asOf);
  const asOfMs = asOfDate.getTime();
  const asOf = Number.isFinite(asOfMs) ? asOfDate.toISOString() : new Date(0).toISOString();
  const reasons = new Set<string>();
  const riskFreeRate = isFiniteNumber(input.riskFreeRate) ? input.riskFreeRate : 0;
  const dividendYield = isFiniteNumber(input.dividendYield) ? input.dividendYield : 0;
  const rateStatus: "ok" | "unavailable" = isFiniteNumber(input.riskFreeRate)
    ? "ok"
    : "unavailable";
  const dividendYieldStatus: "ok" | "unavailable" = isFiniteNumber(input.dividendYield)
    ? "ok"
    : "unavailable";

  if (rateStatus === "unavailable") {
    reasons.add("risk-free rate unavailable; using zero rate");
  }
  if (dividendYieldStatus === "unavailable") {
    reasons.add("dividend yield unavailable; using zero yield");
  }

  const {
    prepared,
    reasons: prepareReasons,
    expirations,
    candidateCount,
  } = Number.isFinite(asOfMs)
    ? prepareOptions(input.options, asOfMs)
    : {
        prepared: [],
        reasons: new Set(["as-of timestamp is invalid"]),
        expirations: new Set<string>(),
        candidateCount: 0,
      };
  prepareReasons.forEach((reason) => reasons.add(reason));

  const lower = Math.max(
    0.01,
    isFiniteNumber(input.scan?.lower) && input.scan.lower > 0
      ? input.scan.lower
      : spot * 0.85,
  );
  const upper =
    isFiniteNumber(input.scan?.upper) && input.scan.upper > lower
      ? input.scan.upper
      : spot * 1.15;
  const pointCount = Math.max(
    3,
    Math.min(
      301,
      Math.floor(
        isFiniteNumber(input.scan?.pointCount) ? input.scan.pointCount : 121,
      ),
    ),
  );

  const unavailable = (extraReason: string): GexZeroGammaSimulation => {
    reasons.add(extraReason);
    return {
      version: "gex-zero-gamma-spot-sweep-v1",
      method: "black_scholes_gamma_spot_sweep",
      selection: "nearest_spot_crossing",
      ticker: input.ticker,
      spot,
      zeroGamma: null,
      netGexAtSpot: 0,
      asOf,
      crossings: [],
      scan: {
        lower: roundPrice(lower),
        upper: roundPrice(upper),
        pointCount,
        refinement: "bisection",
      },
      quality: {
        status: "unavailable",
        reasons: Array.from(reasons),
        usableOptionCount: prepared.length,
        expirationCount: expirations.size,
        ivCoverage: candidateCount > 0 ? prepared.length / candidateCount : 0,
        rateStatus,
        dividendYieldStatus,
      },
    };
  };

  if (spot <= 0) return unavailable("spot price is unavailable");
  if (prepared.length < 2) return unavailable("fewer than two usable options");

  const valueAt = (price: number) =>
    netGexAtPrice(prepared, price, riskFreeRate, dividendYield);
  const step = (upper - lower) / (pointCount - 1);
  const points = Array.from({ length: pointCount }, (_, index) => {
    const price = index === pointCount - 1 ? upper : lower + step * index;
    return { price, netGex: valueAt(price) };
  });
  const crossings: GexZeroGammaSimulation["crossings"] = [];

  for (let index = 1; index < points.length; index += 1) {
    const left = points[index - 1];
    const right = points[index];
    const leftSign = signOf(left.netGex);
    const rightSign = signOf(right.netGex);
    if (leftSign !== 0 && leftSign === rightSign) continue;

    const price = refineCrossing({
      leftPrice: left.price,
      rightPrice: right.price,
      leftValue: left.netGex,
      rightValue: right.netGex,
      valueAt,
    });
    crossings.push({
      price: roundPrice(price),
      distancePct: roundPrice((price - spot) / spot),
      bracket: [roundPrice(left.price), roundPrice(right.price)],
      netGexBefore: roundGex(left.netGex),
      netGexAfter: roundGex(right.netGex),
    });
  }

  const selectedCrossing =
    crossings.length > 0
      ? crossings.reduce((best, crossing) =>
          Math.abs(crossing.price - spot) < Math.abs(best.price - spot)
            ? crossing
            : best,
        )
      : null;

  return {
    version: "gex-zero-gamma-spot-sweep-v1",
    method: "black_scholes_gamma_spot_sweep",
    selection: "nearest_spot_crossing",
    ticker: input.ticker,
    spot,
    zeroGamma: selectedCrossing?.price ?? null,
    netGexAtSpot: roundGex(valueAt(spot)),
    asOf,
    crossings,
    scan: {
      lower: roundPrice(lower),
      upper: roundPrice(upper),
      pointCount,
      refinement: "bisection",
    },
    quality: {
      status: reasons.size ? "partial" : "ok",
      reasons: Array.from(reasons),
      usableOptionCount: prepared.length,
      expirationCount: expirations.size,
      ivCoverage: candidateCount > 0 ? prepared.length / candidateCount : 0,
      rateStatus,
      dividendYieldStatus,
    },
  };
}
