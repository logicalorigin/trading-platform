import { normalizeSymbol } from "../lib/values";
import type { BrokerPositionSnapshot } from "../providers/ibkr/client";
import type { PositionMarketHydration } from "./account-position-model";
import {
  buildNotionalExposure,
  contractMultiplierForPosition,
  hasOptionContract,
  hydratedPositionMarketValue,
  sectorForSymbol,
  type NotionalExposureSummary,
  type PositionGreekSnapshot,
} from "./account-risk-model";
import {
  resolvePythonComputeLaneDefinitions,
  routePythonComputeJobType,
  runPythonComputeJob,
  type PythonComputeJobRequest,
  type PythonComputeJobResult,
  type PythonComputeJobType,
} from "./python-compute";

type PortfolioRiskJobPosition = {
  symbol: string;
  quantity: number;
  price: number;
  delta: number | null;
  sector: string | null;
};

export type PortfolioRiskInputCoverage = {
  totalPositions: number;
  pricedPositions: number;
  deltaAdjustedPositions: number;
  skippedPositions: number;
  skipped: {
    missingContractData: number;
    missingMarketValue: number;
    missingUnderlyingPrice: number;
  };
};

export type PortfolioRiskJobInput = {
  positions: PortfolioRiskJobPosition[];
  returns: Array<{ symbol: string; values: number[] }>;
  shocks: number[];
};

export type AccountPortfolioRisk = {
  enabled: boolean;
  status: "disabled" | "empty" | "completed" | "failed" | "unavailable";
  source: "python_compute";
  warning: string | null;
  coverage: PortfolioRiskInputCoverage;
  notional: NotionalExposureSummary;
  result: Record<string, unknown> | null;
  pythonJob: {
    jobId: string | null;
    jobType: "portfolio_risk";
    durationMs: number | null;
    warnings: string[];
    error: { code: string; message: string } | null;
  };
};

type ResolveAccountPortfolioRiskInput = {
  positions: BrokerPositionSnapshot[];
  nav?: number | null;
  marketHydration?: Map<string, PositionMarketHydration>;
  greekByPositionId?: Map<string, PositionGreekSnapshot>;
  underlyingPrices?: Map<string, number>;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  runJob?: typeof runPythonComputeJob;
};

function truthyEnv(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readNumber(
  record: Record<string, unknown> | null | undefined,
  key: string,
): number | null {
  return finiteNumber(record?.[key]);
}

function pythonComputeEnabledForJob(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  jobType: PythonComputeJobType,
): boolean {
  const laneId = routePythonComputeJobType(jobType);
  return (
    resolvePythonComputeLaneDefinitions({ env }).find(
      (definition) => definition.id === laneId,
    )?.config.enabled === true
  );
}

function emptyCoverage(totalPositions: number): PortfolioRiskInputCoverage {
  return {
    totalPositions,
    pricedPositions: 0,
    deltaAdjustedPositions: 0,
    skippedPositions: 0,
    skipped: {
      missingContractData: 0,
      missingMarketValue: 0,
      missingUnderlyingPrice: 0,
    },
  };
}

function optionDirectionalMultiplier(position: BrokerPositionSnapshot): number {
  const right = String(position.optionContract?.right ?? "").toLowerCase();
  return right === "put" ? -1 : 1;
}

function normalizedMapLookup(
  values: Map<string, number>,
  symbol: string,
): number | null {
  const normalized = normalizeSymbol(symbol);
  const value = values.get(normalized) ?? values.get(normalized.toUpperCase());
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function portfolioRiskPositionForEquity(
  position: BrokerPositionSnapshot,
  input: {
    marketHydration?: Map<string, PositionMarketHydration>;
  },
): PortfolioRiskJobPosition | null {
  const marketValue = hydratedPositionMarketValue(
    position,
    input.marketHydration ?? new Map(),
  );
  if (!Number.isFinite(marketValue)) {
    return null;
  }
  const symbol = normalizeSymbol(position.symbol);
  return {
    symbol,
    quantity: marketValue,
    price: 1,
    delta: 1,
    sector: sectorForSymbol(symbol),
  };
}

function portfolioRiskPositionForOption(
  position: BrokerPositionSnapshot,
  input: {
    greekByPositionId?: Map<string, PositionGreekSnapshot>;
    underlyingPrices?: Map<string, number>;
  },
): { position: PortfolioRiskJobPosition | null; skipped: keyof PortfolioRiskInputCoverage["skipped"] | null; deltaAdjusted: boolean } {
  if (!hasOptionContract(position)) {
    return { position: null, skipped: null, deltaAdjusted: false };
  }

  const underlying = normalizeSymbol(position.optionContract.underlying);
  const underlyingPrice = normalizedMapLookup(
    input.underlyingPrices ?? new Map(),
    underlying,
  );
  if (underlyingPrice === null) {
    return {
      position: null,
      skipped: "missingUnderlyingPrice",
      deltaAdjusted: false,
    };
  }

  const quantity = finiteNumber(Number(position.quantity));
  const multiplier = contractMultiplierForPosition(position);
  if (
    quantity === null ||
    !Number.isFinite(multiplier) ||
    Math.abs(quantity) <= 0 ||
    multiplier <= 0
  ) {
    return {
      position: null,
      skipped: "missingContractData",
      deltaAdjusted: false,
    };
  }

  const grossNotional = underlyingPrice * Math.abs(quantity) * multiplier;
  const directionalNotional =
    grossNotional * Math.sign(quantity) * optionDirectionalMultiplier(position);
  const deltaShares = input.greekByPositionId?.get(position.id)?.delta;
  const deltaAdjustedNotional =
    typeof deltaShares === "number" && Number.isFinite(deltaShares)
      ? deltaShares * underlyingPrice
      : null;

  return {
    position: {
      symbol: underlying,
      quantity: directionalNotional,
      price: 1,
      delta:
        deltaAdjustedNotional !== null && directionalNotional !== 0
          ? deltaAdjustedNotional / directionalNotional
          : 0,
      sector: sectorForSymbol(underlying),
    },
    skipped: null,
    deltaAdjusted: deltaAdjustedNotional !== null,
  };
}

export function buildPortfolioRiskJobInputWithCoverage(
  positions: BrokerPositionSnapshot[],
  input: {
    nav?: number | null;
    marketHydration?: Map<string, PositionMarketHydration>;
    greekByPositionId?: Map<string, PositionGreekSnapshot>;
    underlyingPrices?: Map<string, number>;
    shocks?: number[];
  } = {},
): { jobInput: PortfolioRiskJobInput; coverage: PortfolioRiskInputCoverage } {
  const coverage = emptyCoverage(positions.length);
  const jobPositions: PortfolioRiskJobPosition[] = [];

  positions.forEach((position) => {
    if (hasOptionContract(position)) {
      const built = portfolioRiskPositionForOption(position, input);
      if (!built.position) {
        if (built.skipped) {
          coverage.skipped[built.skipped] += 1;
          coverage.skippedPositions += 1;
        }
        return;
      }
      jobPositions.push(built.position);
      coverage.pricedPositions += 1;
      if (built.deltaAdjusted) {
        coverage.deltaAdjustedPositions += 1;
      }
      return;
    }

    const built = portfolioRiskPositionForEquity(position, input);
    if (!built) {
      coverage.skipped.missingMarketValue += 1;
      coverage.skippedPositions += 1;
      return;
    }
    jobPositions.push(built);
    coverage.pricedPositions += 1;
    coverage.deltaAdjustedPositions += 1;
  });

  return {
    jobInput: {
      positions: jobPositions,
      returns: [],
      shocks: input.shocks ?? [-0.05, -0.02, 0.02, 0.05],
    },
    coverage,
  };
}

function fallbackNotional(
  input: ResolveAccountPortfolioRiskInput,
): NotionalExposureSummary {
  return buildNotionalExposure(input.positions, {
    nav: input.nav,
    marketHydration: input.marketHydration,
    greekByPositionId: input.greekByPositionId,
    underlyingPrices: input.underlyingPrices,
  });
}

function disabledAccountPortfolioRisk(input: {
  warning: string | null;
  fallback: NotionalExposureSummary;
  coverage: PortfolioRiskInputCoverage;
}): AccountPortfolioRisk {
  return {
    enabled: false,
    status: "disabled",
    source: "python_compute",
    warning: input.warning,
    coverage: input.coverage,
    notional: input.fallback,
    result: null,
    pythonJob: {
      jobId: null,
      jobType: "portfolio_risk",
      durationMs: null,
      warnings: [],
      error: null,
    },
  };
}

function completedNotionalFromPython(input: {
  result: Record<string, unknown>;
  coverage: PortfolioRiskInputCoverage;
  nav?: number | null;
}): NotionalExposureSummary | null {
  const gross = readNumber(input.result, "grossExposure");
  const net = readNumber(input.result, "netExposure");
  const deltaAdjusted = readNumber(input.result, "deltaAdjustedExposure");
  if (gross === null || net === null || deltaAdjusted === null) {
    return null;
  }

  return {
    grossUnderlyingNotional: input.coverage.pricedPositions > 0 ? gross : null,
    netDirectionalNotional: input.coverage.pricedPositions > 0 ? net : null,
    deltaAdjustedNotional:
      input.coverage.deltaAdjustedPositions > 0 ? deltaAdjusted : null,
    notionalToNavPercent:
      input.coverage.pricedPositions > 0 && input.nav
        ? (gross / input.nav) * 100
        : null,
    coverage: {
      totalPositions: input.coverage.totalPositions,
      pricedPositions: input.coverage.pricedPositions,
      deltaAdjustedPositions: input.coverage.deltaAdjustedPositions,
    },
  };
}

function resultToAccountPortfolioRisk(input: {
  result: PythonComputeJobResult;
  fallback: NotionalExposureSummary;
  coverage: PortfolioRiskInputCoverage;
  nav?: number | null;
}): AccountPortfolioRisk {
  const warning =
    input.result.status === "completed"
      ? input.result.warnings.join(" ") || null
      : (input.result.error?.message ?? "Python portfolio risk job did not complete.");

  if (input.result.status !== "completed" || !input.result.result) {
    return {
      enabled: true,
      status: "failed",
      source: "python_compute",
      warning,
      coverage: input.coverage,
      notional: input.fallback,
      result: input.result.result,
      pythonJob: {
        jobId: input.result.jobId,
        jobType: "portfolio_risk",
        durationMs: input.result.durationMs,
        warnings: input.result.warnings,
        error: input.result.error,
      },
    };
  }

  const notional = completedNotionalFromPython({
    result: input.result.result,
    coverage: input.coverage,
    nav: input.nav,
  });
  if (!notional) {
    return {
      enabled: true,
      status: "failed",
      source: "python_compute",
      warning: "Python portfolio risk job returned an incomplete exposure summary.",
      coverage: input.coverage,
      notional: input.fallback,
      result: input.result.result,
      pythonJob: {
        jobId: input.result.jobId,
        jobType: "portfolio_risk",
        durationMs: input.result.durationMs,
        warnings: input.result.warnings,
        error: input.result.error,
      },
    };
  }

  return {
    enabled: true,
    status: "completed",
    source: "python_compute",
    warning,
    coverage: input.coverage,
    notional,
    result: input.result.result,
    pythonJob: {
      jobId: input.result.jobId,
      jobType: "portfolio_risk",
      durationMs: input.result.durationMs,
      warnings: input.result.warnings,
      error: input.result.error,
    },
  };
}

export async function resolveAccountPortfolioRisk(
  input: ResolveAccountPortfolioRiskInput,
): Promise<AccountPortfolioRisk> {
  const env = input.env ?? process.env;
  const fallback = fallbackNotional(input);
  const { jobInput, coverage } = buildPortfolioRiskJobInputWithCoverage(
    input.positions,
    input,
  );

  if (!truthyEnv(env["PYRUS_PYTHON_PORTFOLIO_RISK_ENABLED"])) {
    return disabledAccountPortfolioRisk({ warning: null, fallback, coverage });
  }
  if (!pythonComputeEnabledForJob(env, "portfolio_risk")) {
    return disabledAccountPortfolioRisk({
      warning: "Python compute runtime is disabled.",
      fallback,
      coverage,
    });
  }
  if (jobInput.positions.length === 0) {
    return {
      enabled: true,
      status: "empty",
      source: "python_compute",
      warning: "No positions had enough portfolio risk inputs.",
      coverage,
      notional: fallback,
      result: {
        grossExposure: 0,
        netExposure: 0,
        deltaAdjustedExposure: 0,
        concentration: [],
        sectorExposure: [],
        scenarios: [],
      },
      pythonJob: {
        jobId: null,
        jobType: "portfolio_risk",
        durationMs: null,
        warnings: [],
        error: null,
      },
    };
  }

  const timeoutMs = readPositiveInteger(
    env["PYRUS_PYTHON_PORTFOLIO_RISK_TIMEOUT_MS"],
    2_500,
  );
  try {
    const request: PythonComputeJobRequest = {
      jobType: "portfolio_risk",
      input: jobInput,
      options: { timeoutMs },
    };
    const result = await (input.runJob ?? runPythonComputeJob)(request, {
      timeoutMs,
      pollIntervalMs: 75,
    });
    return resultToAccountPortfolioRisk({
      result,
      fallback,
      coverage,
      nav: input.nav,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      enabled: true,
      status: "unavailable",
      source: "python_compute",
      warning: message,
      coverage,
      notional: fallback,
      result: null,
      pythonJob: {
        jobId: null,
        jobType: "portfolio_risk",
        durationMs: null,
        warnings: [],
        error: {
          code: "python_compute_unavailable",
          message,
        },
      },
    };
  }
}
