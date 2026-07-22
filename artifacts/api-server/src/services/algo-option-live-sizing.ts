import { HttpError } from "../lib/errors";
import {
  AlgoAllowancePolicyError,
  resolveAlgoAllowancePool,
  type AlgoAllowanceSetting,
} from "./algo-allowance-policy";

const MONEY_SCALE = 1_000_000;

export type AlgoOptionLiveSizingInput = {
  requestedQuantity: number;
  limitPrice: number;
  multiplier: number;
  strategyMaxContracts: number;
  strategyMaxPremium: number;
  targetAllowance: AlgoAllowanceSetting;
  targetPremiumAtRisk: number;
  targetPremiumReserved: number;
  totalAlgoAllowance: AlgoAllowanceSetting;
  accountPremiumAtRisk: number;
  accountPremiumReserved: number;
  platformMaxContracts: number;
  platformMaxPremium: number;
  netLiquidation: number;
  buyingPower: number;
  balanceObservedAt: Date;
  now: Date;
  maxBalanceAgeMs: number;
};

export type AlgoOptionLiveSizingResult = {
  quantity: number;
  requestedQuantity: number;
  premiumPerContract: number;
  requestedPremium: number;
  allowedPremium: number;
  spendingBase: number;
  targetPremiumLimit: number;
  targetPremiumRemaining: number;
  accountPremiumLimit: number;
  accountPremiumRemaining: number;
  sizedDown: boolean;
};

function invalidSizing(): never {
  throw new HttpError(422, "Live option sizing inputs are invalid.", {
    code: "algo_live_sizing_invalid",
    expose: true,
  });
}

function positiveInteger(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : invalidSizing();
}

function moneyMicros(value: number, allowZero: boolean): bigint {
  if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) {
    return invalidSizing();
  }
  const scaled = Math.round(value * MONEY_SCALE);
  if (!Number.isSafeInteger(scaled) || (!allowZero && scaled === 0)) {
    return invalidSizing();
  }
  return BigInt(scaled);
}

function minimum(values: readonly bigint[]): bigint {
  return values.reduce((current, value) =>
    value < current ? value : current,
  );
}

function dollars(value: bigint): number {
  return Number(value) / MONEY_SCALE;
}

export function sizeAlgoOptionLiveEntry(
  input: AlgoOptionLiveSizingInput,
): AlgoOptionLiveSizingResult {
  const requestedQuantity = positiveInteger(input.requestedQuantity);
  const strategyMaxContracts = positiveInteger(input.strategyMaxContracts);
  const platformMaxContracts = positiveInteger(input.platformMaxContracts);
  if (input.multiplier !== 100) invalidSizing();

  const limitPrice = moneyMicros(input.limitPrice, false);
  const strategyMaxPremium = moneyMicros(input.strategyMaxPremium, false);
  const platformMaxPremium = moneyMicros(input.platformMaxPremium, false);
  const buyingPower = moneyMicros(input.buyingPower, true);
  let allowancePool;
  try {
    allowancePool = resolveAlgoAllowancePool({
      targetAllowance: input.targetAllowance,
      totalAlgoAllowance: input.totalAlgoAllowance,
      targetExposureUsd: input.targetPremiumAtRisk,
      targetReservationUsd: input.targetPremiumReserved,
      accountExposureUsd: input.accountPremiumAtRisk,
      accountReservationUsd: input.accountPremiumReserved,
      netLiquidation: input.netLiquidation,
      buyingPower: input.buyingPower,
      capitalObservedAt: input.balanceObservedAt,
      now: input.now,
      maxCapitalAgeMs: input.maxBalanceAgeMs,
    });
  } catch (error) {
    if (
      error instanceof AlgoAllowancePolicyError &&
      error.code === "algo_allowance_capital_stale"
    ) {
      throw new HttpError(409, "A fresh account capital base is required.", {
        code: "algo_capital_base_stale",
        expose: true,
      });
    }
    if (
      error instanceof AlgoAllowancePolicyError &&
      error.code === "algo_allowance_exposure_inconsistent"
    ) {
      throw new HttpError(409, error.message, {
        code: error.code,
        expose: true,
      });
    }
    return invalidSizing();
  }
  const targetPremiumRemaining = moneyMicros(
    allowancePool.target.remainingUsd,
    true,
  );
  const accountPremiumRemaining = moneyMicros(
    allowancePool.account.remainingUsd,
    true,
  );
  const allowedPremium = minimum([
    strategyMaxPremium,
    targetPremiumRemaining,
    accountPremiumRemaining,
    buyingPower,
    platformMaxPremium,
  ]);
  const premiumPerContract = limitPrice * BigInt(input.multiplier);
  const premiumQuantity = Number(allowedPremium / premiumPerContract);
  const quantity = Math.min(
    requestedQuantity,
    strategyMaxContracts,
    platformMaxContracts,
    premiumQuantity,
  );
  if (quantity < 1) {
    throw new HttpError(409, "No whole option contract fits the live caps.", {
      code: "algo_entry_cap_exhausted",
      expose: true,
      data: { allowedPremium: dollars(allowedPremium) },
    });
  }

  return {
    quantity,
    requestedQuantity,
    premiumPerContract: dollars(premiumPerContract),
    requestedPremium: dollars(
      premiumPerContract * BigInt(requestedQuantity),
    ),
    allowedPremium: dollars(allowedPremium),
    spendingBase: allowancePool.spendingBaseUsd,
    targetPremiumLimit: allowancePool.target.limitUsd,
    targetPremiumRemaining: dollars(targetPremiumRemaining),
    accountPremiumLimit: allowancePool.account.limitUsd,
    accountPremiumRemaining: dollars(accountPremiumRemaining),
    sizedDown: quantity < requestedQuantity,
  };
}
