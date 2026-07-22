const MONEY_SCALE = 1_000_000;
const MONEY_SCALE_BIGINT = BigInt(MONEY_SCALE);
const PERCENT_SCALE = 10_000;
const PERCENT_DENOMINATOR = BigInt(100 * PERCENT_SCALE);
const MAX_ALLOWANCE_USD = 10_000_000;

export type AlgoAllowanceUnit = "usd" | "percent";

export type AlgoAllowanceSetting = {
  unit: AlgoAllowanceUnit;
  value: number;
};

export type AlgoAllowancePolicyErrorCode =
  | "algo_allowance_invalid"
  | "algo_allowance_capital_invalid"
  | "algo_allowance_capital_stale"
  | "algo_allowance_exposure_invalid"
  | "algo_allowance_exposure_inconsistent";

export class AlgoAllowancePolicyError extends Error {
  readonly code: AlgoAllowancePolicyErrorCode;

  constructor(code: AlgoAllowancePolicyErrorCode, message: string) {
    super(message);
    this.name = "AlgoAllowancePolicyError";
    this.code = code;
  }
}

function fail(
  code: AlgoAllowancePolicyErrorCode,
  message: string,
): never {
  throw new AlgoAllowancePolicyError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rounded(value: number, scale: number): number {
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

export function parseAlgoAllowanceSetting(
  value: unknown,
): AlgoAllowanceSetting {
  if (!isRecord(value)) {
    return fail("algo_allowance_invalid", "Allowance must be an object.");
  }
  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== "unit" || keys[1] !== "value") {
    return fail(
      "algo_allowance_invalid",
      "Allowance accepts only unit and value.",
    );
  }
  const unit = value.unit;
  const amount = value.value;
  if (
    (unit !== "usd" && unit !== "percent") ||
    typeof amount !== "number" ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    (unit === "usd" && amount > MAX_ALLOWANCE_USD) ||
    (unit === "percent" && amount > 100)
  ) {
    return fail("algo_allowance_invalid", "Allowance value is invalid.");
  }
  return {
    unit,
    value: rounded(amount, unit === "usd" ? 100 : PERCENT_SCALE),
  };
}

function moneyMicros(
  value: number,
  code:
    | "algo_allowance_capital_invalid"
    | "algo_allowance_exposure_invalid",
): bigint {
  if (!Number.isFinite(value) || value < 0) {
    return fail(code, "Allowance financial input is invalid.");
  }
  const scaled = Math.round(value * MONEY_SCALE);
  if (!Number.isSafeInteger(scaled)) {
    return fail(code, "Allowance financial input is outside the safe range.");
  }
  return BigInt(scaled);
}

function dateMilliseconds(
  value: Date,
  code: "algo_allowance_capital_invalid",
): number {
  const milliseconds = value instanceof Date ? value.getTime() : Number.NaN;
  return Number.isFinite(milliseconds)
    ? milliseconds
    : fail(code, "Allowance capital timestamp is invalid.");
}

function dollars(value: bigint): number {
  return Number(value) / MONEY_SCALE;
}

function remaining(limit: bigint, used: bigint): bigint {
  return used >= limit ? 0n : limit - used;
}

function allowanceLimitMicros(
  setting: AlgoAllowanceSetting,
  spendingBase: bigint,
): bigint {
  if (setting.unit === "usd") {
    return moneyMicros(setting.value, "algo_allowance_capital_invalid");
  }
  const percentUnits = Math.round(setting.value * PERCENT_SCALE);
  if (!Number.isSafeInteger(percentUnits) || percentUnits <= 0) {
    return fail("algo_allowance_invalid", "Allowance percentage is invalid.");
  }
  return (spendingBase * BigInt(percentUnits)) / PERCENT_DENOMINATOR;
}

export type ResolveAlgoAllowancePoolInput = {
  targetAllowance: AlgoAllowanceSetting;
  totalAlgoAllowance: AlgoAllowanceSetting;
  targetExposureUsd: number;
  targetReservationUsd: number;
  accountExposureUsd: number;
  accountReservationUsd: number;
  netLiquidation: number;
  buyingPower: number;
  capitalObservedAt: Date;
  now: Date;
  maxCapitalAgeMs: number;
};

export type ResolvedAlgoAllowanceScope = {
  configured: AlgoAllowanceSetting;
  limitUsd: number;
  usedUsd: number;
  remainingUsd: number;
};

export type ResolvedAlgoAllowancePool = {
  spendingBaseUsd: number;
  capitalObservedAt: Date;
  target: ResolvedAlgoAllowanceScope;
  account: ResolvedAlgoAllowanceScope;
  effectiveRemainingUsd: number;
};

export function resolveAlgoAllowancePool(
  input: ResolveAlgoAllowancePoolInput,
): ResolvedAlgoAllowancePool {
  const targetAllowance = parseAlgoAllowanceSetting(input.targetAllowance);
  const totalAlgoAllowance = parseAlgoAllowanceSetting(
    input.totalAlgoAllowance,
  );
  const netLiquidation = moneyMicros(
    input.netLiquidation,
    "algo_allowance_capital_invalid",
  );
  const buyingPower = moneyMicros(
    input.buyingPower,
    "algo_allowance_capital_invalid",
  );
  if (
    !Number.isSafeInteger(input.maxCapitalAgeMs) ||
    input.maxCapitalAgeMs <= 0
  ) {
    return fail(
      "algo_allowance_capital_invalid",
      "Allowance capital freshness limit is invalid.",
    );
  }
  const capitalObservedAtMs = dateMilliseconds(
    input.capitalObservedAt,
    "algo_allowance_capital_invalid",
  );
  const nowMs = dateMilliseconds(input.now, "algo_allowance_capital_invalid");
  const capitalAgeMs = nowMs - capitalObservedAtMs;
  if (capitalAgeMs < 0 || capitalAgeMs > input.maxCapitalAgeMs) {
    return fail(
      "algo_allowance_capital_stale",
      "A fresh account capital base is required.",
    );
  }

  const targetExposure = moneyMicros(
    input.targetExposureUsd,
    "algo_allowance_exposure_invalid",
  );
  const targetReservation = moneyMicros(
    input.targetReservationUsd,
    "algo_allowance_exposure_invalid",
  );
  const accountExposure = moneyMicros(
    input.accountExposureUsd,
    "algo_allowance_exposure_invalid",
  );
  const accountReservation = moneyMicros(
    input.accountReservationUsd,
    "algo_allowance_exposure_invalid",
  );
  const targetUsed = targetExposure + targetReservation;
  const accountUsed = accountExposure + accountReservation;
  if (targetUsed > accountUsed) {
    return fail(
      "algo_allowance_exposure_inconsistent",
      "Target exposure cannot exceed its containing account exposure.",
    );
  }

  const spendingBase = netLiquidation < buyingPower ? netLiquidation : buyingPower;
  const targetLimit = allowanceLimitMicros(targetAllowance, spendingBase);
  const accountLimit = allowanceLimitMicros(totalAlgoAllowance, spendingBase);
  const targetRemaining = remaining(targetLimit, targetUsed);
  const accountRemaining = remaining(accountLimit, accountUsed);

  return {
    spendingBaseUsd: dollars(spendingBase),
    capitalObservedAt: input.capitalObservedAt,
    target: {
      configured: targetAllowance,
      limitUsd: dollars(targetLimit),
      usedUsd: dollars(targetUsed),
      remainingUsd: dollars(targetRemaining),
    },
    account: {
      configured: totalAlgoAllowance,
      limitUsd: dollars(accountLimit),
      usedUsd: dollars(accountUsed),
      remainingUsd: dollars(accountRemaining),
    },
    effectiveRemainingUsd: dollars(
      targetRemaining < accountRemaining ? targetRemaining : accountRemaining,
    ),
  };
}
