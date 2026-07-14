import { createHash } from "node:crypto";

export const US_TAX_JURISDICTIONS = [
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "DC",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
] as const;

export type TaxJurisdiction = (typeof US_TAX_JURISDICTIONS)[number];
export type TaxEstimateScope = "connected_accounts_only";
export type TaxStateEstimateMode = "all_states";
export type TaxPreflightAction = "allow" | "warn_ack_required" | "block";
export type TaxWashSaleRisk = "none" | "exact" | "high" | "ambiguous" | "unknown";
export type TaxSelfTradeRisk = "none" | "possible" | "exact_self_match" | "blocked";
export type TaxStateRuleSetStatus =
  | "available"
  | "stale"
  | "unavailable"
  | "failed_validation";

export type TaxProfileConfig = {
  taxYear: number;
  filingStatus: "single" | "married_joint" | "married_separate" | "head_of_household";
  estimateScope: TaxEstimateScope;
  federalEstimateMode: "safe_harbor_plus_visible_gains";
  stateEstimateMode: TaxStateEstimateMode;
  residentState: TaxJurisdiction | null;
  marginalFederalRate: number | null;
  marginalStateRate: number | null;
  priorYearFederalTax: number | null;
  priorYearStateTax: number | null;
  annualizedIncomeEnabled: boolean;
  cpaOverrideAmount: number | null;
  reserveMode: "virtual_plus_broker_beta";
  reserveInstrumentAllowlist: string[];
  brokerReserveBetaEnabled: boolean;
};

export type TaxStateRuleSetRow = {
  jurisdiction: string;
  taxYear: number;
  status: TaxStateRuleSetStatus;
  version?: string | null;
  sourceUrl?: string | null;
  sourceName?: string | null;
  checksum?: string | null;
  verifiedAt?: Date | string | null;
};

export type TaxOptionOrderAction =
  | "buy_to_open"
  | "buy_to_close"
  | "sell_to_close"
  | "sell_to_open";
export type TaxOptionPositionEffect = "open" | "close";
export type TaxOptionStrategyIntent =
  | "long_option"
  | "sell_to_close"
  | "covered_call"
  | "cash_secured_put"
  | "uncovered_short_call"
  | "uncovered_short_put";

export type TaxOrderLike = {
  accountId: string;
  mode: "live" | "shadow";
  symbol: string;
  assetClass: "equity" | "option" | string;
  side: "buy" | "sell" | string;
  type: string;
  quantity: number;
  limitPrice?: number | null;
  stopPrice?: number | null;
  timeInForce: string;
  optionContract?: Record<string, unknown> | null;
  optionAction?: TaxOptionOrderAction | null;
  positionEffect?: TaxOptionPositionEffect | null;
  strategyIntent?: TaxOptionStrategyIntent | null;
  route?: string | null;
  intent?: string | null;
};

export function canonicalOptionTaxSemantics(
  action: TaxOptionOrderAction,
  right: "call" | "put",
): {
  optionAction: TaxOptionOrderAction;
  positionEffect: TaxOptionPositionEffect;
  strategyIntent: TaxOptionStrategyIntent | null;
  intent: string;
} {
  if (action === "buy_to_open") {
    return {
      optionAction: action,
      positionEffect: "open",
      strategyIntent: "long_option",
      intent: "long_option",
    };
  }
  if (action === "buy_to_close") {
    return {
      optionAction: action,
      positionEffect: "close",
      strategyIntent: null,
      intent: "close",
    };
  }
  if (action === "sell_to_close") {
    return {
      optionAction: action,
      positionEffect: "close",
      strategyIntent: "sell_to_close",
      intent: "sell_to_close",
    };
  }
  const strategyIntent =
    right === "call" ? "covered_call" : "cash_secured_put";
  return {
    optionAction: action,
    positionEffect: "open",
    strategyIntent,
    intent: strategyIntent,
  };
}

export type TaxPreflightEvaluation = {
  action: TaxPreflightAction;
  washSaleRisk: TaxWashSaleRisk;
  selfTradeRisk: TaxSelfTradeRisk;
  reasons: string[];
  warnings: string[];
  requiredAcknowledgements: string[];
  orderFingerprint: string;
};

const CURRENT_TAX_YEAR = new Date().getFullYear();
const JURISDICTION_SET = new Set<string>(US_TAX_JURISDICTIONS);

const numericOrNull = (value: unknown): number | null => {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const booleanValue = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const stringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .map((entry) => String(entry || "").trim().toUpperCase())
        .filter(Boolean)
        .slice(0, 64)
    : [];

const normalizeJurisdiction = (value: unknown): TaxJurisdiction | null => {
  const normalized = String(value || "").trim().toUpperCase();
  return JURISDICTION_SET.has(normalized)
    ? (normalized as TaxJurisdiction)
    : null;
};

const recordValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export function normalizeTaxProfileConfig(
  input: unknown = {},
): TaxProfileConfig {
  const record = recordValue(input);
  const taxYear = Number(record.taxYear);
  const filingStatus = String(record.filingStatus || "");
  return {
    taxYear:
      Number.isInteger(taxYear) && taxYear >= 2000 && taxYear <= 2100
        ? taxYear
        : CURRENT_TAX_YEAR,
    filingStatus:
      filingStatus === "married_joint" ||
      filingStatus === "married_separate" ||
      filingStatus === "head_of_household"
        ? filingStatus
        : "single",
    estimateScope: "connected_accounts_only",
    federalEstimateMode: "safe_harbor_plus_visible_gains",
    stateEstimateMode: "all_states",
    residentState: normalizeJurisdiction(record.residentState),
    marginalFederalRate: numericOrNull(record.marginalFederalRate),
    marginalStateRate: numericOrNull(record.marginalStateRate),
    priorYearFederalTax: numericOrNull(record.priorYearFederalTax),
    priorYearStateTax: numericOrNull(record.priorYearStateTax),
    annualizedIncomeEnabled: booleanValue(record.annualizedIncomeEnabled, false),
    cpaOverrideAmount: numericOrNull(record.cpaOverrideAmount),
    reserveMode: "virtual_plus_broker_beta",
    reserveInstrumentAllowlist: stringArray(record.reserveInstrumentAllowlist),
    brokerReserveBetaEnabled: booleanValue(record.brokerReserveBetaEnabled, false),
  };
}

export function buildStateRuleStatus(input: {
  taxYear: number;
  rows: TaxStateRuleSetRow[];
}) {
  const rowsByJurisdiction = new Map(
    input.rows
      .filter((row) => row.taxYear === input.taxYear)
      .map((row) => [row.jurisdiction.toUpperCase(), row]),
  );
  const jurisdictions = US_TAX_JURISDICTIONS.map((jurisdiction) => {
    const row = rowsByJurisdiction.get(jurisdiction);
    const verifiedAt =
      row?.verifiedAt instanceof Date
        ? row.verifiedAt.toISOString()
        : row?.verifiedAt ?? null;
    const hasVerificationEvidence = Boolean(
      row?.status === "available" &&
        verifiedAt &&
        row.checksum &&
        (row.sourceUrl || row.sourceName),
    );
    const effectiveStatus =
      row?.status === "available" && !hasVerificationEvidence
        ? "unavailable"
        : row?.status ?? "unavailable";
    return {
      jurisdiction,
      taxYear: input.taxYear,
      status: effectiveStatus,
      version: row?.version ?? null,
      sourceUrl: row?.sourceUrl ?? null,
      sourceName: row?.sourceName ?? null,
      checksum: row?.checksum ?? null,
      verifiedAt,
      evidenceStatus:
        row?.status === "available"
          ? hasVerificationEvidence
            ? "verified"
            : "missing_evidence"
          : "not_available",
    };
  });
  const summary = jurisdictions.reduce(
    (acc, row) => {
      acc.total += 1;
      acc[row.status] += 1;
      return acc;
    },
    {
      total: 0,
      available: 0,
      stale: 0,
      unavailable: 0,
      failed_validation: 0,
    } as Record<TaxStateRuleSetStatus | "total", number>,
  );
  return {
    taxYear: input.taxYear,
    ready: summary.total > 0 && summary.available === summary.total,
    summary,
    jurisdictions,
  };
}

const stableOrder = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableOrder);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, stableOrder(entry)]),
    );
  }
  return value;
};

const normalizeOptionRight = (value: unknown): string => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "c") return "call";
  if (normalized === "p") return "put";
  return normalized;
};

const normalizeOptionExpiration = (value: unknown): string | null => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const text = String(value || "").trim();
  if (!text) return null;
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime()) && /^\d{4}-\d{2}-\d{2}/u.test(text)) {
    return parsed.toISOString().slice(0, 10);
  }
  return text.toUpperCase();
};

const normalizeOptionContractForFingerprint = (
  value: unknown,
): Record<string, unknown> | null => {
  const contract = recordValue(value);
  if (!Object.keys(contract).length) return null;
  const expirationDate = normalizeOptionExpiration(
    contract.expirationDate ?? contract.expiration ?? contract.exp,
  );
  const strike = numericOrNull(contract.strike);
  const multiplier = numericOrNull(contract.multiplier);
  const sharesPerContract = numericOrNull(contract.sharesPerContract);
  return {
    underlying: String(contract.underlying ?? "").trim().toUpperCase() || null,
    expirationDate,
    strike,
    right: normalizeOptionRight(contract.right ?? contract.cp) || null,
    multiplier,
    sharesPerContract,
  };
};

export function fingerprintTaxOrder(order: TaxOrderLike): string {
  const normalized = stableOrder({
    accountId: order.accountId,
    mode: order.mode,
    symbol: String(order.symbol || "").trim().toUpperCase(),
    assetClass: order.assetClass,
    side: String(order.side || "").toLowerCase(),
    type: order.type,
    quantity: Number(order.quantity) || 0,
    limitPrice: order.limitPrice ?? null,
    stopPrice: order.stopPrice ?? null,
    timeInForce: order.timeInForce,
    optionContract:
      String(order.assetClass || "").toLowerCase() === "option"
        ? normalizeOptionContractForFingerprint(order.optionContract)
        : null,
    optionAction:
      String(order.optionAction || "").trim().toLowerCase() || null,
    positionEffect:
      String(order.positionEffect || "").trim().toLowerCase() || null,
    strategyIntent:
      String(order.strategyIntent || "").trim().toLowerCase() || null,
    intent: String(order.intent || "").trim().toLowerCase() || null,
  });
  return createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("hex");
}

const isOppositeSide = (left: string, right: string): boolean => {
  const l = left.toLowerCase();
  const r = right.toLowerCase();
  return (l === "buy" && r === "sell") || (l === "sell" && r === "buy");
};

const optionContractKey = (order: TaxOrderLike): string | null => {
  if (String(order.assetClass || "").toLowerCase() !== "option") {
    return null;
  }
  const contract = recordValue(order.optionContract);
  const expiration = normalizeOptionExpiration(
    contract.expirationDate ?? contract.expiration ?? contract.exp,
  );
  const strike = Number(contract.strike);
  const right = normalizeOptionRight(contract.right ?? contract.cp);
  if (!expiration || !Number.isFinite(strike) || !right) {
    return null;
  }
  const underlying = String(
    contract.underlying ?? contract.ticker ?? contract.symbol ?? order.symbol,
  )
    .trim()
    .toUpperCase();
  return `${underlying}|${expiration}|${strike.toFixed(6)}|${right}`;
};

const samePreflightInstrument = (
  order: TaxOrderLike,
  candidate: TaxOrderLike,
): boolean => {
  const symbol = String(order.symbol || "").trim().toUpperCase();
  const candidateSymbol = String(candidate.symbol || "").trim().toUpperCase();
  if (symbol !== candidateSymbol) return false;

  const orderIsOption = String(order.assetClass || "").toLowerCase() === "option";
  const candidateIsOption =
    String(candidate.assetClass || "").toLowerCase() === "option";
  if (!orderIsOption && !candidateIsOption) return true;
  if (orderIsOption !== candidateIsOption) return false;

  const orderOptionKey = optionContractKey(order);
  const candidateOptionKey = optionContractKey(candidate);
  if (orderOptionKey && candidateOptionKey) {
    return orderOptionKey === candidateOptionKey;
  }
  return true;
};

function hasSameAccountOppositeOpenOrder(
  order: TaxOrderLike,
  openOrders: TaxOrderLike[],
): boolean {
  return openOrders.some(
    (candidate) =>
      candidate.mode === order.mode &&
      candidate.accountId === order.accountId &&
      samePreflightInstrument(order, candidate) &&
      isOppositeSide(String(candidate.side), String(order.side)) &&
      Number(candidate.quantity) > 0,
  );
}

export function evaluateTaxOrderPreflight(input: {
  profile: TaxProfileConfig;
  order: TaxOrderLike;
  openOrders: TaxOrderLike[];
}): TaxPreflightEvaluation {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const requiredAcknowledgements: string[] = [];
  let action: TaxPreflightAction = "allow";
  let selfTradeRisk: TaxSelfTradeRisk = "none";
  let washSaleRisk: TaxWashSaleRisk = "none";

  if (input.order.mode === "shadow") {
    warnings.push("Shadow orders are simulation-only and excluded from real tax estimates.");
    return {
      action,
      washSaleRisk,
      selfTradeRisk,
      reasons,
      warnings,
      requiredAcknowledgements,
      orderFingerprint: fingerprintTaxOrder(input.order),
    };
  }

  if (hasSameAccountOppositeOpenOrder(input.order, input.openOrders)) {
    action = "block";
    selfTradeRisk = "blocked";
    washSaleRisk = "unknown";
    reasons.push("same_account_opposite_open_order");
    warnings.push(
      "This order could cross against your own open order and is blocked.",
    );
  }

  if (String(input.order.side).toLowerCase() === "sell") {
    washSaleRisk = "unknown";
    warnings.push(
      "PYRUS cannot yet determine final wash-sale treatment from visible lots.",
    );
    requiredAcknowledgements.push(
      "tax_estimate_visible_accounts_only",
      "wash_sale_basis_not_final",
    );
    if (action === "allow") {
      action = "warn_ack_required";
    }
  }

  if (input.profile.estimateScope === "connected_accounts_only") {
    warnings.push("Tax estimates only include connected PYRUS accounts.");
  }

  return {
    action,
    washSaleRisk,
    selfTradeRisk,
    reasons,
    warnings: Array.from(new Set(warnings)),
    requiredAcknowledgements: Array.from(new Set(requiredAcknowledgements)),
    orderFingerprint: fingerprintTaxOrder(input.order),
  };
}
