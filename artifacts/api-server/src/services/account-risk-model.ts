import { normalizeSymbol, toIsoDateString } from "../lib/values";
import type {
  BrokerPositionSnapshot,
  OptionChainContract,
} from "../providers/ibkr/client";
import {
  positionSignedNotional,
  type PositionMarketHydration,
} from "./account-position-model";
import { accountOptionCalendarDayDifference } from "./account-trade-model";

const STATIC_SECTOR_BY_SYMBOL: Record<string, string> = {
  AAPL: "Technology",
  MSFT: "Technology",
  NVDA: "Technology",
  AMD: "Technology",
  AVGO: "Technology",
  META: "Communication Services",
  GOOGL: "Communication Services",
  GOOG: "Communication Services",
  AMZN: "Consumer Discretionary",
  TSLA: "Consumer Discretionary",
  JPM: "Financials",
  BAC: "Financials",
  XOM: "Energy",
  CVX: "Energy",
  FCEL: "Energy",
  UNH: "Health Care",
  JNJ: "Health Care",
  INDI: "Technology",
  SPY: "Broad Market ETF",
  QQQ: "Growth ETF",
  IWM: "Small-Cap ETF",
  DIA: "Blue-Chip ETF",
  TLT: "Rates ETF",
  GLD: "Commodity ETF",
  SOXX: "Semiconductor ETF",
};

const BETA_BY_SYMBOL: Record<string, number> = {
  SPY: 1,
  QQQ: 1.15,
  IWM: 1.25,
  AAPL: 1.2,
  MSFT: 0.95,
  NVDA: 1.8,
  AMD: 1.9,
  TSLA: 2.1,
  META: 1.25,
  GOOGL: 1.05,
  AMZN: 1.25,
};

export type OptionPositionSnapshot = BrokerPositionSnapshot & {
  optionContract: NonNullable<BrokerPositionSnapshot["optionContract"]>;
};

export type PositionGreekSnapshot = {
  positionId: string;
  symbol: string;
  underlying: string;
  delta: number | null;
  betaWeightedDelta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  impliedVolatility: number | null;
  source:
    | "IBKR_POSITIONS"
    | "IBKR_OPTION_CHAIN"
    | "ROBINHOOD_OPTION_QUOTE"
    | "SHADOW_OPTION_QUOTE";
  matched: boolean;
  warning: string | null;
};

export type OptionGreekEnrichmentResult = {
  byPositionId: Map<string, PositionGreekSnapshot>;
  totalOptionPositions: number;
  matchedOptionPositions: number;
  warnings: string[];
};

export type NotionalExposureSummary = {
  grossUnderlyingNotional: number | null;
  netDirectionalNotional: number | null;
  deltaAdjustedNotional: number | null;
  notionalToNavPercent: number | null;
  coverage: {
    totalPositions: number;
    pricedPositions: number;
    deltaAdjustedPositions: number;
  };
};

export type GreekScenarioMatrixPositionInput = {
  symbol: string;
  underlying: string;
  quantity: number;
  multiplier: number;
  spot: number;
  markPrice: number;
  strike: number | null;
  right: "call" | "put" | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  impliedVolatility: number | null;
  riskFreeRate: number | null;
  dividendYield: number | null;
  pricingModel: "auto";
  greekScale: "position";
  daysToExpiration: number | null;
};

export type GreekScenarioMatrixJobInput = {
  positions: GreekScenarioMatrixPositionInput[];
  spotShocks: number[];
  ivShocks: number[];
  dayOffsets: number[];
};

export type GreekScenarioInputCoverage = {
  totalOptionPositions: number;
  eligiblePositions: number;
  skippedPositions: number;
  skipped: {
    missingSpot: number;
    missingMarkPrice: number;
    missingContractData: number;
    missingGreekSnapshot: number;
  };
};

export type GreekScenarioMatrixBuildResult = {
  jobInput: GreekScenarioMatrixJobInput;
  coverage: GreekScenarioInputCoverage;
};

function toRiskNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const normalized = value.replace(/[$,%\s,]/g, "");
    if (!normalized) {
      return null;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function isFiniteRiskNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizedScenarioImpliedVolatility(value: unknown): number | null {
  const parsed = toRiskNumber(value);
  if (parsed === null || parsed <= 0) {
    return null;
  }
  return parsed > 3 ? parsed / 100 : parsed;
}

export function sectorForSymbol(symbol: string): string {
  return STATIC_SECTOR_BY_SYMBOL[symbol.toUpperCase()] ?? "Unknown";
}

export function betaForSymbol(symbol: string): number {
  return BETA_BY_SYMBOL[symbol.toUpperCase()] ?? 1;
}

export function weightPercent(value: number, nav: number | null): number | null {
  if (!nav || nav === 0) {
    return null;
  }
  return (value / nav) * 100;
}

export function hydratedPositionMarketValue(
  position: BrokerPositionSnapshot,
  hydration: Map<string, PositionMarketHydration>,
): number {
  return hydration.get(position.id)?.marketValue ?? positionSignedNotional(position);
}

export function exposureSummary(
  positions: BrokerPositionSnapshot[],
  valueForPosition: (position: BrokerPositionSnapshot) => number = (position) =>
    position.marketValue,
) {
  const grossLong = positions
    .map(valueForPosition)
    .filter((marketValue) => marketValue > 0)
    .reduce((sum, marketValue) => sum + marketValue, 0);
  const grossShort = Math.abs(
    positions
      .map(valueForPosition)
      .filter((marketValue) => marketValue < 0)
      .reduce((sum, marketValue) => sum + marketValue, 0),
  );
  const netExposure = positions.reduce(
    (sum, position) => sum + valueForPosition(position),
    0,
  );

  return {
    grossLong,
    grossShort,
    netExposure,
  };
}

function optionDirectionalMultiplier(position: OptionPositionSnapshot): number {
  const right = String(position.optionContract.right || "").toLowerCase();
  return right === "put" ? -1 : 1;
}

function underlyingPriceForPosition(
  position: OptionPositionSnapshot,
  underlyingPrices: Map<string, number>,
): number | null {
  const price = underlyingPrices.get(normalizeSymbol(position.optionContract.underlying));
  return Number.isFinite(price) && Number(price) > 0 ? Number(price) : null;
}

function optionMarkPriceForPosition(
  position: OptionPositionSnapshot,
  input: {
    marketHydration?: Map<string, PositionMarketHydration>;
  },
): number | null {
  const hydratedMark = input.marketHydration?.get(position.id)?.mark;
  if (typeof hydratedMark === "number" && Number.isFinite(hydratedMark) && hydratedMark >= 0) {
    return hydratedMark;
  }

  const marketPrice = toRiskNumber(position.marketPrice);
  if (marketPrice !== null && marketPrice >= 0) {
    return marketPrice;
  }

  const quantity = toRiskNumber(position.quantity);
  const multiplier = contractMultiplierForPosition(position);
  const marketValue = toRiskNumber(position.marketValue);
  if (
    quantity !== null &&
    marketValue !== null &&
    Number.isFinite(multiplier) &&
    Math.abs(quantity) > 0 &&
    multiplier > 0
  ) {
    return Math.abs(marketValue / (quantity * multiplier));
  }

  return null;
}

function daysToExpiration(value: Date, now = new Date()): number | null {
  const expiresAt = value.getTime();
  const nowAt = now.getTime();
  if (!Number.isFinite(expiresAt) || !Number.isFinite(nowAt)) {
    return null;
  }
  return Math.max(0, (expiresAt - nowAt) / 86_400_000);
}

function emptyGreekScenarioCoverage(): GreekScenarioInputCoverage {
  return {
    totalOptionPositions: 0,
    eligiblePositions: 0,
    skippedPositions: 0,
    skipped: {
      missingSpot: 0,
      missingMarkPrice: 0,
      missingContractData: 0,
      missingGreekSnapshot: 0,
    },
  };
}

function hasUsableGreekSnapshot(greek: PositionGreekSnapshot | undefined): boolean {
  return Boolean(
    greek &&
      [greek.delta, greek.gamma, greek.theta, greek.vega].some(isFiniteRiskNumber),
  );
}

export function buildGreekScenarioMatrixInputWithCoverage(
  positions: BrokerPositionSnapshot[],
  input: {
    marketHydration?: Map<string, PositionMarketHydration>;
    greekByPositionId?: Map<string, PositionGreekSnapshot>;
    underlyingPrices?: Map<string, number>;
    now?: Date;
    spotShocks?: number[];
    ivShocks?: number[];
    dayOffsets?: number[];
  } = {},
): GreekScenarioMatrixBuildResult {
  const greekByPositionId = input.greekByPositionId ?? new Map<string, PositionGreekSnapshot>();
  const underlyingPrices = input.underlyingPrices ?? new Map<string, number>();
  const coverage = emptyGreekScenarioCoverage();
  const matrixPositions: GreekScenarioMatrixPositionInput[] = [];

  positions.filter(hasOptionContract).forEach((position) => {
    coverage.totalOptionPositions += 1;

    const spot = underlyingPriceForPosition(position, underlyingPrices);
    const markPrice = optionMarkPriceForPosition(position, input);
    const multiplier = contractMultiplierForPosition(position);
    const quantity = toRiskNumber(position.quantity);
    const greek = greekByPositionId.get(position.id);
    const missingContractData =
      quantity === null ||
      Math.abs(quantity) <= 0 ||
      !Number.isFinite(multiplier) ||
      multiplier <= 0;
    const missingSpot = spot === null;
    const missingMarkPrice = markPrice === null;
    const missingGreekSnapshot = !hasUsableGreekSnapshot(greek);

    if (missingSpot) {
      coverage.skipped.missingSpot += 1;
    }
    if (missingMarkPrice) {
      coverage.skipped.missingMarkPrice += 1;
    }
    if (missingContractData) {
      coverage.skipped.missingContractData += 1;
    }
    if (missingGreekSnapshot) {
      coverage.skipped.missingGreekSnapshot += 1;
    }

    if (
      missingSpot ||
      missingMarkPrice ||
      missingContractData ||
      missingGreekSnapshot
    ) {
      coverage.skippedPositions += 1;
      return;
    }

    matrixPositions.push({
      symbol: position.symbol,
      underlying: normalizeSymbol(position.optionContract.underlying),
      quantity,
      multiplier,
      spot,
      markPrice,
      strike: toRiskNumber(position.optionContract.strike),
      right: position.optionContract.right,
      delta: greek?.delta ?? null,
      gamma: greek?.gamma ?? null,
      theta: greek?.theta ?? null,
      vega: greek?.vega ?? null,
      impliedVolatility: normalizedScenarioImpliedVolatility(
        greek?.impliedVolatility,
      ),
      riskFreeRate: null,
      dividendYield: null,
      pricingModel: "auto",
      greekScale: "position",
      daysToExpiration: daysToExpiration(position.optionContract.expirationDate, input.now),
    });
    coverage.eligiblePositions += 1;
  });

  return {
    jobInput: {
      positions: matrixPositions,
      spotShocks: input.spotShocks ?? [-0.08, -0.05, -0.02, 0, 0.02, 0.05, 0.08],
      ivShocks: input.ivShocks ?? [-10, -5, 0, 5, 10],
      dayOffsets: input.dayOffsets ?? [0, 1, 3, 5],
    },
    coverage,
  };
}

export function buildGreekScenarioMatrixInput(
  positions: BrokerPositionSnapshot[],
  input: {
    marketHydration?: Map<string, PositionMarketHydration>;
    greekByPositionId?: Map<string, PositionGreekSnapshot>;
    underlyingPrices?: Map<string, number>;
    now?: Date;
    spotShocks?: number[];
    ivShocks?: number[];
    dayOffsets?: number[];
  } = {},
): GreekScenarioMatrixJobInput {
  return buildGreekScenarioMatrixInputWithCoverage(positions, input).jobInput;
}

export function buildNotionalExposure(
  positions: BrokerPositionSnapshot[],
  input: {
    nav?: number | null;
    marketHydration?: Map<string, PositionMarketHydration>;
    greekByPositionId?: Map<string, PositionGreekSnapshot>;
    underlyingPrices?: Map<string, number>;
  } = {},
): NotionalExposureSummary {
  const marketHydration = input.marketHydration ?? new Map<string, PositionMarketHydration>();
  const greekByPositionId = input.greekByPositionId ?? new Map<string, PositionGreekSnapshot>();
  const underlyingPrices = input.underlyingPrices ?? new Map<string, number>();
  let grossUnderlyingNotional = 0;
  let netDirectionalNotional = 0;
  let deltaAdjustedNotional = 0;
  let pricedPositions = 0;
  let deltaAdjustedPositions = 0;

  positions.forEach((position) => {
    if (!hasOptionContract(position)) {
      const marketValue = hydratedPositionMarketValue(position, marketHydration);
      if (!Number.isFinite(marketValue)) {
        return;
      }
      grossUnderlyingNotional += Math.abs(marketValue);
      netDirectionalNotional += marketValue;
      deltaAdjustedNotional += marketValue;
      pricedPositions += 1;
      deltaAdjustedPositions += 1;
      return;
    }

    const underlyingPrice = underlyingPriceForPosition(position, underlyingPrices);
    if (underlyingPrice === null) {
      return;
    }

    const quantity = Number(position.quantity);
    const multiplier = contractMultiplierForPosition(position);
    if (
      !Number.isFinite(quantity) ||
      !Number.isFinite(multiplier) ||
      Math.abs(quantity) <= 0 ||
      multiplier <= 0
    ) {
      return;
    }

    const rawNotional = underlyingPrice * Math.abs(quantity) * multiplier;
    const direction = Math.sign(quantity) * optionDirectionalMultiplier(position);
    grossUnderlyingNotional += rawNotional;
    netDirectionalNotional += rawNotional * direction;
    pricedPositions += 1;

    const deltaShares = greekByPositionId.get(position.id)?.delta;
    if (typeof deltaShares === "number" && Number.isFinite(deltaShares)) {
      deltaAdjustedNotional += deltaShares * underlyingPrice;
      deltaAdjustedPositions += 1;
    }
  });

  const hasPricedPositions = pricedPositions > 0;
  const hasDeltaAdjustedPositions = deltaAdjustedPositions > 0;
  return {
    grossUnderlyingNotional: hasPricedPositions ? grossUnderlyingNotional : null,
    netDirectionalNotional: hasPricedPositions ? netDirectionalNotional : null,
    deltaAdjustedNotional: hasDeltaAdjustedPositions ? deltaAdjustedNotional : null,
    notionalToNavPercent:
      hasPricedPositions && input.nav ? (grossUnderlyingNotional / input.nav) * 100 : null,
    coverage: {
      totalPositions: positions.length,
      pricedPositions,
      deltaAdjustedPositions,
    },
  };
}

export function hasOptionContract(
  position: BrokerPositionSnapshot,
): position is OptionPositionSnapshot {
  return position.assetClass === "option" && Boolean(position.optionContract);
}

export function optionChainGroupKey(
  optionContract: NonNullable<BrokerPositionSnapshot["optionContract"]>,
): string {
  return `${normalizeSymbol(optionContract.underlying)}:${toIsoDateString(optionContract.expirationDate)}`;
}

function optionContractTupleKey(input: {
  underlying: string;
  expirationDate: Date;
  strike: number;
  right: string;
}): string {
  return [
    normalizeSymbol(input.underlying),
    toIsoDateString(input.expirationDate),
    String(Number(input.strike)),
    input.right.toLowerCase(),
  ].join(":");
}

export function contractMultiplierForPosition(position: OptionPositionSnapshot): number {
  const optionContract = position.optionContract;
  return (
    toRiskNumber(optionContract.sharesPerContract) ??
    toRiskNumber(optionContract.multiplier) ??
    100
  );
}

export function scaleOptionGreek(
  value: number | null,
  position: OptionPositionSnapshot,
): number | null {
  return value === null
    ? null
    : value * position.quantity * contractMultiplierForPosition(position);
}

export function sumNullableValues(
  values: Array<number | null | undefined>,
): number | null {
  if (!values.length || values.some((value) => !isFiniteRiskNumber(value))) {
    return null;
  }
  return values.reduce<number>((sum, value) => sum + value!, 0);
}

type UnderlyingGreekContribution = {
  underlying: string;
  exposure: number;
  isOption: boolean;
  greek:
    | Pick<
        PositionGreekSnapshot,
        "delta" | "betaWeightedDelta" | "gamma" | "theta" | "vega"
      >
    | null
    | undefined;
};

export function aggregateGreeksByUnderlying(
  rows: UnderlyingGreekContribution[],
) {
  const grouped = new Map<string, UnderlyingGreekContribution[]>();
  rows.forEach((row) => {
    grouped.set(row.underlying, [...(grouped.get(row.underlying) ?? []), row]);
  });
  return Array.from(grouped, ([underlying, contributions]) => ({
    underlying,
    exposure: contributions.reduce((sum, row) => sum + row.exposure, 0),
    delta: sumNullableValues(contributions.map((row) => row.greek?.delta)),
    betaWeightedDelta: sumNullableValues(
      contributions.map((row) => row.greek?.betaWeightedDelta),
    ),
    gamma: sumNullableValues(contributions.map((row) => row.greek?.gamma)),
    theta: sumNullableValues(contributions.map((row) => row.greek?.theta)),
    vega: sumNullableValues(contributions.map((row) => row.greek?.vega)),
    positionCount: contributions.length,
    optionPositionCount: contributions.filter((row) => row.isOption).length,
  }));
}

export function matchOptionChainContract(
  contracts: OptionChainContract[],
  optionContract: NonNullable<BrokerPositionSnapshot["optionContract"]>,
): OptionChainContract | null {
  const providerContractId = optionContract.providerContractId
    ? String(optionContract.providerContractId)
    : null;

  if (providerContractId) {
    const directMatch =
      contracts.find(
        (contract) =>
          contract.contract.providerContractId &&
          String(contract.contract.providerContractId) === providerContractId,
      ) ?? null;
    if (directMatch) {
      return directMatch;
    }
  }

  const tupleKey = optionContractTupleKey({
    underlying: optionContract.underlying,
    expirationDate: optionContract.expirationDate,
    strike: optionContract.strike,
    right: optionContract.right,
  });

  return (
    contracts.find(
      (contract) =>
        optionContractTupleKey({
          underlying: contract.contract.underlying,
          expirationDate: contract.contract.expirationDate,
          strike: contract.contract.strike,
          right: contract.contract.right,
        }) === tupleKey,
    ) ?? null
  );
}

export function mergeOptionChainContracts(
  contractSets: OptionChainContract[][],
): OptionChainContract[] {
  const merged = new Map<string, OptionChainContract>();

  contractSets.flat().forEach((contract) => {
    const key =
      contract.contract.providerContractId
        ? `conid:${contract.contract.providerContractId}`
        : `tuple:${optionContractTupleKey({
            underlying: contract.contract.underlying,
            expirationDate: contract.contract.expirationDate,
            strike: contract.contract.strike,
            right: contract.contract.right,
          })}`;
    merged.set(key, contract);
  });

  return Array.from(merged.values());
}

export function buildExpiryConcentration(
  positions: BrokerPositionSnapshot[],
  now = Date.now(),
) {
  const buckets = {
    thisWeek: 0,
    thisMonth: 0,
    next90Days: 0,
  };
  const activityDate = new Date(now);
  if (!Number.isFinite(activityDate.getTime())) return null;

  for (const position of positions) {
    const isOption =
      position.optionContract != null ||
      String(position.assetClass ?? "").trim().toLowerCase() === "option";
    if (!isOption) continue;
    if (!position.optionContract) return null;
    const daysToExpiry = accountOptionCalendarDayDifference(
      position.optionContract.expirationDate,
      activityDate,
    );
    const marketValue = toRiskNumber(position.marketValue);
    if (daysToExpiry == null || marketValue == null) return null;
    if (daysToExpiry < 0) continue;
    const notional = Math.abs(marketValue);
    if (daysToExpiry <= 7) {
      buckets.thisWeek += notional;
    }
    if (daysToExpiry <= 30) {
      buckets.thisMonth += notional;
    }
    if (daysToExpiry <= 90) {
      buckets.next90Days += notional;
    }
  }

  return buckets;
}
