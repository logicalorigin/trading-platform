import { normalizeSymbol } from "../lib/values";
import type { BrokerPositionSnapshot } from "../providers/ibkr/client";
import type { AccountGreekScenarios } from "./account-greek-scenarios";
import type { PositionMarketHydration } from "./account-position-model";
import {
  hasOptionContract,
  hydratedPositionMarketValue,
  weightPercent,
  type NotionalExposureSummary,
  type PositionGreekSnapshot,
} from "./account-risk-model";

export type AccountRiskRecommendationCategory =
  | "coverage"
  | "concentration"
  | "theta"
  | "gamma"
  | "vega"
  | "expiry"
  | "scenario";

export type AccountRiskRecommendationSeverity = "info" | "watch" | "attention";

export type AccountRiskRecommendation = {
  id: string;
  category: AccountRiskRecommendationCategory;
  severity: AccountRiskRecommendationSeverity;
  symbol: string | null;
  underlying: string | null;
  title: string;
  rationale: string;
  suggestedReview: string;
  evidence: Record<string, unknown>;
};

export type AccountRiskRecommendations = {
  advisoryOnly: true;
  source: "options_account_risk";
  status: "empty" | "ready" | "degraded";
  scope: "options";
  summary: {
    optionPositionCount: number;
    underlyingCount: number;
    totalPremiumExposure: number;
    premiumToNavPercent: number | null;
    worstShockPnl: number | null;
    worstShockToNavPercent: number | null;
  };
  recommendations: AccountRiskRecommendation[];
};

type ExpiryConcentration = {
  thisWeek?: number | null;
  thisMonth?: number | null;
  next90Days?: number | null;
};

type BuildAccountRiskRecommendationsInput = {
  positions: BrokerPositionSnapshot[];
  nav?: number | null;
  marketHydration?: Map<string, PositionMarketHydration>;
  greekByPositionId?: Map<string, PositionGreekSnapshot>;
  greekScenarios?: AccountGreekScenarios | null;
  notional?: NotionalExposureSummary | null;
  expiryConcentration?: ExpiryConcentration | null;
  maxRecommendations?: number;
};

type ScenarioRow = {
  spotShock: number | null;
  ivShockVolPoints: number | null;
  dayOffset: number | null;
  estimatedPnl: number;
  components: Record<string, unknown> | null;
};

const MANAGEMENT_REASON_COPY: Record<
  string,
  {
    category: AccountRiskRecommendationCategory;
    title: string;
    rationale: (flag: Record<string, unknown>) => string;
    suggestedReview: string;
  }
> = {
  theta_burden: {
    category: "theta",
    title: "Review theta burn",
    rationale: (flag) =>
      `Scenario Greeks flag daily theta decay at ${formatPercent(readNumber(flag, "thetaBurdenPct"))} of option premium.`,
    suggestedReview:
      "Review whether the position's theta profile still matches the intended holding period.",
  },
  short_gamma_convexity: {
    category: "gamma",
    title: "Review short gamma convexity",
    rationale: (flag) =>
      `A +/-5% underlying move is estimated to create gamma PnL of ${formatPercent(readNumber(flag, "worstFivePctGammaPnlPct"))} of option premium.`,
    suggestedReview:
      "Review the position's convexity exposure around fast underlying moves.",
  },
  vega_sensitive: {
    category: "vega",
    title: "Review volatility exposure",
    rationale: (flag) =>
      `A 5 vol-point IV move is estimated to change option PnL by ${formatPercent(readNumber(flag, "fiveVolPointVegaPnlPct"))} of premium.`,
    suggestedReview:
      "Review whether the volatility exposure still fits the event and IV regime assumptions.",
  },
};

const SEVERITY_RANK: Record<AccountRiskRecommendationSeverity, number> = {
  attention: 0,
  watch: 1,
  info: 2,
};

function readNumber(
  record: Record<string, unknown> | null | undefined,
  key: string,
): number | null {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readString(
  record: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function roundRiskNumber(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  return Math.round(value * 1_000_000) / 1_000_000;
}

function finiteValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatCurrency(value: number | null): string {
  if (value === null) {
    return "n/a";
  }
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(value);
}

function formatPercent(value: number | null): string {
  if (value === null) {
    return "n/a";
  }
  return `${roundRiskNumber(value)?.toFixed(2)}%`;
}

function recommendationId(...parts: Array<string | number | null>): string {
  return parts
    .filter((part): part is string | number => part !== null)
    .map((part) =>
      String(part)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, ""),
    )
    .filter(Boolean)
    .join(":");
}

function premiumExposureForPosition(
  position: BrokerPositionSnapshot,
  marketHydration?: Map<string, PositionMarketHydration>,
): number {
  const hydrated = hydratedPositionMarketValue(
    position,
    marketHydration ?? new Map(),
  );
  return Number.isFinite(hydrated) ? Math.abs(hydrated) : 0;
}

function worstScenarioRow(
  greekScenarios: AccountGreekScenarios | null | undefined,
): ScenarioRow | null {
  const result = readRecord(greekScenarios?.result);
  const rows = readArray(result?.["scenarios"])
    .map(readRecord)
    .filter((row): row is Record<string, unknown> => row !== null)
    .map((row) => {
      const estimatedPnl = readNumber(row, "estimatedPnl");
      if (estimatedPnl === null) {
        return null;
      }
      return {
        spotShock: readNumber(row, "spotShock"),
        ivShockVolPoints: readNumber(row, "ivShockVolPoints"),
        dayOffset: readNumber(row, "dayOffset"),
        estimatedPnl,
        components: readRecord(row["components"]),
      };
    })
    .filter((row): row is ScenarioRow => row !== null);

  return rows.sort((left, right) => left.estimatedPnl - right.estimatedPnl)[0] ?? null;
}

function managementFlags(
  greekScenarios: AccountGreekScenarios | null | undefined,
): Array<Record<string, unknown>> {
  const result = readRecord(greekScenarios?.result);
  return readArray(result?.["managementFlags"])
    .map(readRecord)
    .filter((flag): flag is Record<string, unknown> => flag !== null);
}

function severityFromScore(score: number | null): AccountRiskRecommendationSeverity {
  if (score !== null && score >= 2) {
    return "attention";
  }
  if (score !== null && score >= 1) {
    return "watch";
  }
  return "info";
}

function severityForPercent(
  percent: number | null,
  watchThreshold: number,
  attentionThreshold: number,
): AccountRiskRecommendationSeverity {
  const absolute = percent === null ? null : Math.abs(percent);
  if (absolute !== null && absolute >= attentionThreshold) {
    return "attention";
  }
  if (absolute !== null && absolute >= watchThreshold) {
    return "watch";
  }
  return "info";
}

function optionUnderlying(position: BrokerPositionSnapshot): string | null {
  if (!hasOptionContract(position)) {
    return null;
  }
  const underlying = normalizeSymbol(position.optionContract.underlying);
  return underlying || null;
}

function findUnderlyingForSymbol(
  symbol: string | null,
  optionPositions: BrokerPositionSnapshot[],
  greekByPositionId: Map<string, PositionGreekSnapshot>,
): string | null {
  if (!symbol) {
    return null;
  }
  const exactPosition = optionPositions.find((position) => position.symbol === symbol);
  const exactUnderlying = exactPosition ? optionUnderlying(exactPosition) : null;
  if (exactUnderlying) {
    return exactUnderlying;
  }
  const greek = Array.from(greekByPositionId.values()).find(
    (snapshot) => snapshot.symbol === symbol,
  );
  return greek?.underlying ? normalizeSymbol(greek.underlying) : null;
}

function buildCoverageRecommendation(input: {
  optionPositionCount: number;
  matchedOptionPositions: number;
  greekScenarios?: AccountGreekScenarios | null;
}): AccountRiskRecommendation | null {
  const coverage = input.greekScenarios?.coverage;
  const scenarioSkipped = coverage?.skippedPositions ?? 0;
  const scenarioEligible = coverage?.eligiblePositions ?? null;
  const scenarioStatus = input.greekScenarios?.status ?? null;
  const hasGreekGap = input.matchedOptionPositions < input.optionPositionCount;
  const hasScenarioGap = scenarioSkipped > 0;
  const hasScenarioRuntimeGap =
    scenarioStatus === "failed" || scenarioStatus === "unavailable";

  if (!hasGreekGap && !hasScenarioGap && !hasScenarioRuntimeGap) {
    return null;
  }

  const severity =
    input.matchedOptionPositions === 0 || hasScenarioRuntimeGap
      ? "attention"
      : "watch";
  return {
    id: "coverage:option-greeks",
    category: "coverage",
    severity,
    symbol: null,
    underlying: null,
    title: "Review option Greek coverage",
    rationale:
      "Some option positions are missing matched Greeks or scenario inputs, so account-level theta, gamma, vega, and shock PnL may be incomplete.",
    suggestedReview:
      "Review quote freshness and option-chain coverage before relying on the aggregate risk view.",
    evidence: {
      optionPositionCount: input.optionPositionCount,
      matchedOptionPositions: input.matchedOptionPositions,
      scenarioEligiblePositions: scenarioEligible,
      scenarioSkippedPositions: scenarioSkipped,
      scenarioStatus,
    },
  };
}

function buildScenarioRecommendation(input: {
  nav: number | null;
  totalPremiumExposure: number;
  worst: ScenarioRow | null;
  notional?: NotionalExposureSummary | null;
}): AccountRiskRecommendation | null {
  const worst = input.worst;
  if (!worst || worst.estimatedPnl >= 0) {
    return null;
  }

  const worstToNavPercent = roundRiskNumber(weightPercent(worst.estimatedPnl, input.nav));
  const worstToPremiumPercent =
    input.totalPremiumExposure > 0
      ? roundRiskNumber((worst.estimatedPnl / input.totalPremiumExposure) * 100)
      : null;
  const navSeverity = severityForPercent(worstToNavPercent, 5, 10);
  const premiumSeverity = severityForPercent(worstToPremiumPercent, 25, 50);
  const severity =
    SEVERITY_RANK[navSeverity] < SEVERITY_RANK[premiumSeverity]
      ? navSeverity
      : premiumSeverity;

  if (severity === "info") {
    return null;
  }

  return {
    id: "scenario:worst-option-shock",
    category: "scenario",
    severity,
    symbol: null,
    underlying: null,
    title: "Review worst option shock",
    rationale: `The worst completed option shock is ${formatCurrency(worst.estimatedPnl)} (${formatPercent(worstToNavPercent)} of NAV).`,
    suggestedReview:
      "Review hedging, expiries, and volatility assumptions against this downside scenario.",
    evidence: {
      spotShock: worst.spotShock,
      ivShockVolPoints: worst.ivShockVolPoints,
      dayOffset: worst.dayOffset,
      estimatedPnl: roundRiskNumber(worst.estimatedPnl),
      worstToNavPercent,
      worstToPremiumPercent,
      notionalToNavPercent: input.notional?.notionalToNavPercent ?? null,
      components: worst.components,
    },
  };
}

function buildConcentrationRecommendation(input: {
  premiumByUnderlying: Map<string, number>;
  totalPremiumExposure: number;
  nav: number | null;
}): AccountRiskRecommendation | null {
  if (input.totalPremiumExposure <= 0 || input.premiumByUnderlying.size === 0) {
    return null;
  }

  const [top] = Array.from(input.premiumByUnderlying.entries()).sort(
    (left, right) => right[1] - left[1],
  );
  if (!top) {
    return null;
  }
  const [underlying, premiumExposure] = top;
  const premiumSharePercent = roundRiskNumber(
    (premiumExposure / input.totalPremiumExposure) * 100,
  );
  const premiumToNavPercent = roundRiskNumber(
    weightPercent(premiumExposure, input.nav),
  );

  const shareSeverity = severityForPercent(premiumSharePercent, 50, 75);
  const navSeverity = severityForPercent(premiumToNavPercent, 10, 20);
  const severity =
    SEVERITY_RANK[shareSeverity] < SEVERITY_RANK[navSeverity]
      ? shareSeverity
      : navSeverity;
  if (severity === "info") {
    return null;
  }

  return {
    id: recommendationId("concentration", underlying),
    category: "concentration",
    severity,
    symbol: null,
    underlying,
    title: "Review underlying option concentration",
    rationale: `${underlying} represents ${formatPercent(premiumSharePercent)} of current option premium exposure.`,
    suggestedReview:
      "Review whether this underlying concentration fits the account's intended options risk budget.",
    evidence: {
      underlying,
      premiumExposure: roundRiskNumber(premiumExposure),
      premiumSharePercent,
      premiumToNavPercent,
    },
  };
}

function buildExpiryRecommendation(input: {
  expiryConcentration?: ExpiryConcentration | null;
  totalPremiumExposure: number;
  nav: number | null;
}): AccountRiskRecommendation | null {
  const thisWeek = finiteValue(input.expiryConcentration?.thisWeek) ?? 0;
  if (thisWeek <= 0) {
    return null;
  }
  const premiumSharePercent =
    input.totalPremiumExposure > 0
      ? roundRiskNumber((thisWeek / input.totalPremiumExposure) * 100)
      : null;
  const navPercent = roundRiskNumber(weightPercent(thisWeek, input.nav));
  const shareSeverity = severityForPercent(premiumSharePercent, 25, 50);
  const navSeverity = severityForPercent(navPercent, 5, 10);
  const severity =
    SEVERITY_RANK[shareSeverity] < SEVERITY_RANK[navSeverity]
      ? shareSeverity
      : navSeverity;
  if (severity === "info") {
    return null;
  }

  return {
    id: "expiry:this-week",
    category: "expiry",
    severity,
    symbol: null,
    underlying: null,
    title: "Review near-expiry option premium",
    rationale: `${formatCurrency(thisWeek)} of option premium expires within one week.`,
    suggestedReview:
      "Review assignment, pin, and decay risk for positions approaching expiration.",
    evidence: {
      thisWeekPremiumExposure: roundRiskNumber(thisWeek),
      thisWeekPremiumSharePercent: premiumSharePercent,
      thisWeekToNavPercent: navPercent,
      thisMonthPremiumExposure:
        roundRiskNumber(finiteValue(input.expiryConcentration?.thisMonth) ?? 0),
      next90DaysPremiumExposure:
        roundRiskNumber(finiteValue(input.expiryConcentration?.next90Days) ?? 0),
    },
  };
}

function buildManagementRecommendations(input: {
  flags: Array<Record<string, unknown>>;
  optionPositions: BrokerPositionSnapshot[];
  greekByPositionId: Map<string, PositionGreekSnapshot>;
}): AccountRiskRecommendation[] {
  const recommendations: AccountRiskRecommendation[] = [];
  input.flags.forEach((flag) => {
    const symbol = readString(flag, "symbol");
    const underlying = findUnderlyingForSymbol(
      symbol,
      input.optionPositions,
      input.greekByPositionId,
    );
    const severity = severityFromScore(readNumber(flag, "severityScore"));
    readArray(flag["reasons"])
      .filter((reason): reason is string => typeof reason === "string")
      .forEach((reason) => {
        const copy = MANAGEMENT_REASON_COPY[reason];
        if (!copy) {
          return;
        }
        recommendations.push({
          id: recommendationId("management", reason, symbol ?? underlying),
          category: copy.category,
          severity,
          symbol,
          underlying,
          title: copy.title,
          rationale: copy.rationale(flag),
          suggestedReview: copy.suggestedReview,
          evidence: {
            reason,
            severityScore: readNumber(flag, "severityScore"),
            thetaBurdenPct: readNumber(flag, "thetaBurdenPct"),
            worstFivePctGammaPnlPct: readNumber(flag, "worstFivePctGammaPnlPct"),
            fiveVolPointVegaPnlPct: readNumber(flag, "fiveVolPointVegaPnlPct"),
          },
        });
      });
  });
  return recommendations;
}

function dedupeAndSortRecommendations(
  recommendations: AccountRiskRecommendation[],
  maxRecommendations: number,
): AccountRiskRecommendation[] {
  const seen = new Set<string>();
  return recommendations
    .filter((recommendation) => {
      if (seen.has(recommendation.id)) {
        return false;
      }
      seen.add(recommendation.id);
      return true;
    })
    .sort((left, right) => {
      const severityDelta = SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity];
      if (severityDelta !== 0) {
        return severityDelta;
      }
      return left.id.localeCompare(right.id);
    })
    .slice(0, maxRecommendations);
}

export function buildAccountRiskRecommendations(
  input: BuildAccountRiskRecommendationsInput,
): AccountRiskRecommendations {
  const marketHydration = input.marketHydration ?? new Map<string, PositionMarketHydration>();
  const greekByPositionId = input.greekByPositionId ?? new Map<string, PositionGreekSnapshot>();
  const nav = typeof input.nav === "number" && Number.isFinite(input.nav) ? input.nav : null;
  const optionPositions = input.positions.filter(hasOptionContract);
  const premiumByUnderlying = new Map<string, number>();
  let totalPremiumExposure = 0;
  let matchedOptionPositions = 0;

  optionPositions.forEach((position) => {
    const premiumExposure = premiumExposureForPosition(position, marketHydration);
    const underlying = optionUnderlying(position);
    totalPremiumExposure += premiumExposure;
    if (underlying) {
      premiumByUnderlying.set(
        underlying,
        (premiumByUnderlying.get(underlying) ?? 0) + premiumExposure,
      );
    }
    if (greekByPositionId.get(position.id)?.matched === true) {
      matchedOptionPositions += 1;
    }
  });

  const worst = worstScenarioRow(input.greekScenarios);
  const summary = {
    optionPositionCount: optionPositions.length,
    underlyingCount: premiumByUnderlying.size,
    totalPremiumExposure: roundRiskNumber(totalPremiumExposure) ?? 0,
    premiumToNavPercent: roundRiskNumber(weightPercent(totalPremiumExposure, nav)),
    worstShockPnl: worst ? roundRiskNumber(worst.estimatedPnl) : null,
    worstShockToNavPercent: worst
      ? roundRiskNumber(weightPercent(worst.estimatedPnl, nav))
      : null,
  };

  if (optionPositions.length === 0) {
    return {
      advisoryOnly: true,
      source: "options_account_risk",
      status: "empty",
      scope: "options",
      summary,
      recommendations: [],
    };
  }

  const rawRecommendations = [
    buildCoverageRecommendation({
      optionPositionCount: optionPositions.length,
      matchedOptionPositions,
      greekScenarios: input.greekScenarios,
    }),
    buildScenarioRecommendation({
      nav,
      totalPremiumExposure,
      worst,
      notional: input.notional,
    }),
    buildConcentrationRecommendation({
      premiumByUnderlying,
      totalPremiumExposure,
      nav,
    }),
    buildExpiryRecommendation({
      expiryConcentration: input.expiryConcentration,
      totalPremiumExposure,
      nav,
    }),
    ...buildManagementRecommendations({
      flags: managementFlags(input.greekScenarios),
      optionPositions,
      greekByPositionId,
    }),
  ].filter(
    (recommendation): recommendation is AccountRiskRecommendation =>
      recommendation !== null,
  );
  const recommendations = dedupeAndSortRecommendations(
    rawRecommendations,
    input.maxRecommendations ?? 10,
  );
  const scenarioRuntimeGap =
    input.greekScenarios?.status === "failed" ||
    input.greekScenarios?.status === "unavailable";
  const coverageDegraded =
    matchedOptionPositions < optionPositions.length ||
    (input.greekScenarios?.coverage?.skippedPositions ?? 0) > 0 ||
    scenarioRuntimeGap;

  return {
    advisoryOnly: true,
    source: "options_account_risk",
    status: coverageDegraded ? "degraded" : "ready",
    scope: "options",
    summary,
    recommendations,
  };
}
