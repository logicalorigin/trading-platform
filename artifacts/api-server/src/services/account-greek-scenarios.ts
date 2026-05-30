import type { BrokerPositionSnapshot } from "../providers/ibkr/client";
import type { PositionMarketHydration } from "./account-position-model";
import {
  buildGreekScenarioMatrixInputWithCoverage,
  type GreekScenarioInputCoverage,
  type PositionGreekSnapshot,
} from "./account-risk-model";
import {
  runPythonComputeJob,
  type PythonComputeJobResult,
  type PythonComputeJobType,
} from "./python-compute";

export type AccountGreekScenarios = {
  enabled: boolean;
  status: "disabled" | "empty" | "completed" | "failed" | "unavailable";
  source: "python_compute";
  warning: string | null;
  coverage: GreekScenarioInputCoverage | null;
  result: Record<string, unknown> | null;
  pythonJob: {
    jobId: string | null;
    jobType: PythonComputeJobType;
    durationMs: number | null;
    warnings: string[];
    error: { code: string; message: string } | null;
  };
};

type RunGreekScenarioJob = typeof runPythonComputeJob;

type ResolveInput = {
  positions: BrokerPositionSnapshot[];
  marketHydration?: Map<string, PositionMarketHydration>;
  greekByPositionId?: Map<string, PositionGreekSnapshot>;
  underlyingPrices?: Map<string, number>;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  runJob?: RunGreekScenarioJob;
  now?: Date;
};

function truthyEnv(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function disabledAccountGreekScenarios(warning: string | null): AccountGreekScenarios {
  return {
    enabled: false,
    status: "disabled",
    source: "python_compute",
    warning,
    coverage: null,
    result: null,
    pythonJob: {
      jobId: null,
      jobType: "greek_scenario_matrix",
      durationMs: null,
      warnings: [],
      error: null,
    },
  };
}

function resultToAccountGreekScenarios(
  result: PythonComputeJobResult,
  coverage: GreekScenarioInputCoverage,
): AccountGreekScenarios {
  return {
    enabled: true,
    status: result.status === "completed" ? "completed" : "failed",
    source: "python_compute",
    warning:
      result.status === "completed"
        ? null
        : (result.error?.message ?? "Python greek scenario job did not complete."),
    coverage,
    result: result.result,
    pythonJob: {
      jobId: result.jobId,
      jobType: "greek_scenario_matrix",
      durationMs: result.durationMs,
      warnings: result.warnings,
      error: result.error,
    },
  };
}

export async function resolveAccountGreekScenarios(
  input: ResolveInput,
): Promise<AccountGreekScenarios> {
  const env = input.env ?? process.env;
  if (!truthyEnv(env["PYRUS_PYTHON_GREEK_SCENARIOS_ENABLED"])) {
    return disabledAccountGreekScenarios(null);
  }
  if (!truthyEnv(env["PYRUS_PYTHON_COMPUTE_ENABLED"])) {
    return disabledAccountGreekScenarios("Python compute runtime is disabled.");
  }

  const { jobInput, coverage } = buildGreekScenarioMatrixInputWithCoverage(input.positions, {
    marketHydration: input.marketHydration,
    greekByPositionId: input.greekByPositionId,
    underlyingPrices: input.underlyingPrices,
    now: input.now,
  });
  if (jobInput.positions.length === 0) {
    return {
      enabled: true,
      status: "empty",
      source: "python_compute",
      warning: "No option positions had enough greek scenario inputs.",
      coverage,
      result: { scenarioCount: 0, scenarios: [], positions: [], managementFlags: [] },
      pythonJob: {
        jobId: null,
        jobType: "greek_scenario_matrix",
        durationMs: null,
        warnings: [],
        error: null,
      },
    };
  }

  const timeoutMs = readPositiveInteger(
    env["PYRUS_PYTHON_GREEK_SCENARIOS_TIMEOUT_MS"],
    2_500,
  );
  try {
    const result = await (input.runJob ?? runPythonComputeJob)(
      {
        jobType: "greek_scenario_matrix",
        input: jobInput,
        options: { timeoutMs },
      },
      {
        timeoutMs,
        pollIntervalMs: 75,
      },
    );
    return resultToAccountGreekScenarios(result, coverage);
  } catch (error) {
    return {
      enabled: true,
      status: "unavailable",
      source: "python_compute",
      warning: error instanceof Error ? error.message : String(error),
      coverage,
      result: null,
      pythonJob: {
        jobId: null,
        jobType: "greek_scenario_matrix",
        durationMs: null,
        warnings: [],
        error: {
          code: "python_compute_unavailable",
          message: error instanceof Error ? error.message : String(error),
        },
      },
    };
  }
}
