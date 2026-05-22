import { normalizeSymbol } from "../lib/values";
import type {
  BrokerPositionSnapshot,
  OptionChainContract,
} from "../providers/ibkr/client";
import {
  positionSignedNotional,
  type PositionMarketHydration,
} from "./account-position-model";

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
  source: "IBKR_POSITIONS" | "IBKR_OPTION_CHAIN";
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

function formatDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

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
  return `${normalizeSymbol(optionContract.underlying)}:${formatDateOnly(optionContract.expirationDate)}`;
}

function optionContractTupleKey(input: {
  underlying: string;
  expirationDate: Date;
  strike: number;
  right: string;
}): string {
  return [
    normalizeSymbol(input.underlying),
    formatDateOnly(input.expirationDate),
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
  const filtered = values.filter(isFiniteRiskNumber);
  return filtered.length ? filtered.reduce((sum, value) => sum + value, 0) : null;
}

export function upsertNullableTotal(
  current: number | null,
  next: number | null,
): number | null {
  if (next === null) {
    return current;
  }
  return (current ?? 0) + next;
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
  const week = now + 7 * 86_400_000;
  const month = now + 30 * 86_400_000;
  const ninety = now + 90 * 86_400_000;
  const buckets = {
    thisWeek: 0,
    thisMonth: 0,
    next90Days: 0,
  };

  positions.forEach((position) => {
    const expiry = position.optionContract?.expirationDate?.getTime?.();
    if (!expiry) {
      return;
    }
    const notional = Math.abs(position.marketValue);
    if (expiry <= week) {
      buckets.thisWeek += notional;
    }
    if (expiry <= month) {
      buckets.thisMonth += notional;
    }
    if (expiry <= ninety) {
      buckets.next90Days += notional;
    }
  });

  return buckets;
}
