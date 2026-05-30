import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveAccountGreekScenarios,
  type AccountGreekScenarios,
} from "./account-greek-scenarios";
import {
  buildGreekScenarioMatrixInput,
  buildGreekScenarioMatrixInputWithCoverage,
  scaleOptionGreek,
  type PositionGreekSnapshot,
} from "./account-risk-model";

const optionPosition = {
  id: "U1:SPY-C",
  accountId: "U1",
  symbol: "SPY 500C",
  assetClass: "option",
  quantity: 2,
  averagePrice: 8,
  marketPrice: 10,
  marketValue: 2_000,
  unrealizedPnl: 400,
  unrealizedPnlPercent: 25,
  optionContract: {
    ticker: "SPY 500C",
    underlying: "SPY",
    expirationDate: new Date("2026-06-19T00:00:00.000Z"),
    strike: 500,
    right: "call",
    multiplier: 100,
    sharesPerContract: 100,
    providerContractId: "1",
  },
} as const;

const spyGreekSnapshot = {
  positionId: "U1:SPY-C",
  symbol: "SPY 500C",
  underlying: "SPY",
  delta: 100,
  betaWeightedDelta: 100,
  gamma: 4,
  theta: -20,
  vega: 40,
  impliedVolatility: 0.24,
  source: "IBKR_OPTION_CHAIN",
  matched: true,
  warning: null,
} satisfies PositionGreekSnapshot;

function greekMapFor(...ids: string[]): Map<string, PositionGreekSnapshot> {
  return new Map(
    ids.map((id) => [
      id,
      {
        ...spyGreekSnapshot,
        positionId: id,
      },
    ]),
  );
}

test("scaleOptionGreek converts option-chain per-contract greeks to position scale", () => {
  assert.equal(scaleOptionGreek(0.5, optionPosition as any), 100);
  assert.equal(scaleOptionGreek(0.02, optionPosition as any), 4);
  assert.equal(scaleOptionGreek(-0.1, optionPosition as any), -20);
  assert.equal(scaleOptionGreek(0.2, optionPosition as any), 40);
});

test("buildGreekScenarioMatrixInput converts scaled account greeks without rescaling", () => {
  const input = buildGreekScenarioMatrixInput([optionPosition as any], {
    underlyingPrices: new Map([["SPY", 500]]),
    greekByPositionId: greekMapFor("U1:SPY-C"),
    now: new Date("2026-05-29T00:00:00.000Z"),
  });

  assert.equal(input.positions.length, 1);
  assert.equal(input.positions[0]?.greekScale, "position");
  assert.equal(input.positions[0]?.delta, 100);
  assert.equal(input.positions[0]?.gamma, 4);
  assert.equal(input.positions[0]?.theta, -20);
  assert.equal(input.positions[0]?.vega, 40);
  assert.equal(input.positions[0]?.impliedVolatility, 0.24);
  assert.equal(input.positions[0]?.markPrice, 10);
  assert.equal(input.positions[0]?.spot, 500);
  assert.equal(input.positions[0]?.strike, 500);
  assert.equal(input.positions[0]?.right, "call");
  assert.equal(input.positions[0]?.pricingModel, "auto");
  assert.equal(input.positions[0]?.riskFreeRate, null);
  assert.equal(input.positions[0]?.dividendYield, null);
  assert.deepEqual(input.spotShocks, [-0.08, -0.05, -0.02, 0, 0.02, 0.05, 0.08]);
  assert.deepEqual(input.ivShocks, [-10, -5, 0, 5, 10]);
  assert.deepEqual(input.dayOffsets, [0, 1, 3, 5]);
});

test("buildGreekScenarioMatrixInputWithCoverage reports eligible and skipped option inputs", () => {
  const missingSpot = {
    ...optionPosition,
    id: "U1:QQQ-C",
    symbol: "QQQ 500C",
    optionContract: {
      ...optionPosition.optionContract,
      underlying: "QQQ",
    },
  };
  const missingMark = {
    ...optionPosition,
    id: "U1:SPY-NOMARK",
    symbol: "SPY no mark",
    marketPrice: null,
    marketValue: null,
  };
  const missingContractData = {
    ...optionPosition,
    id: "U1:SPY-ZERO",
    symbol: "SPY zero quantity",
    quantity: 0,
  };
  const missingGreekSnapshot = {
    ...optionPosition,
    id: "U1:SPY-NOGREEK",
    symbol: "SPY no greek",
  };

  const { jobInput, coverage } = buildGreekScenarioMatrixInputWithCoverage(
    [
      optionPosition as any,
      missingSpot as any,
      missingMark as any,
      missingContractData as any,
      missingGreekSnapshot as any,
    ],
    {
      underlyingPrices: new Map([["SPY", 500]]),
      greekByPositionId: greekMapFor(
        "U1:SPY-C",
        "U1:QQQ-C",
        "U1:SPY-NOMARK",
        "U1:SPY-ZERO",
      ),
      now: new Date("2026-05-29T00:00:00.000Z"),
    },
  );

  assert.equal(jobInput.positions.length, 1);
  assert.equal(coverage.totalOptionPositions, 5);
  assert.equal(coverage.eligiblePositions, 1);
  assert.equal(coverage.skippedPositions, 4);
  assert.equal(coverage.skipped.missingSpot, 1);
  assert.equal(coverage.skipped.missingMarkPrice, 1);
  assert.equal(coverage.skipped.missingContractData, 1);
  assert.equal(coverage.skipped.missingGreekSnapshot, 1);
});

test("resolveAccountGreekScenarios is disabled unless both feature flags are enabled", async () => {
  const disabled = await resolveAccountGreekScenarios({
    positions: [optionPosition as any],
    env: {},
  });

  assert.equal(disabled.enabled, false);
  assert.equal(disabled.status, "disabled");
  assert.equal(disabled.coverage, null);

  const computeDisabled = await resolveAccountGreekScenarios({
    positions: [optionPosition as any],
    env: { PYRUS_PYTHON_GREEK_SCENARIOS_ENABLED: "1" },
  });

  assert.equal(computeDisabled.enabled, false);
  assert.equal(computeDisabled.warning, "Python compute runtime is disabled.");
});

test("resolveAccountGreekScenarios returns empty when inputs cannot be built", async () => {
  const result = await resolveAccountGreekScenarios({
    positions: [optionPosition as any],
    env: {
      PYRUS_PYTHON_GREEK_SCENARIOS_ENABLED: "1",
      PYRUS_PYTHON_COMPUTE_ENABLED: "1",
    },
  });

  assert.equal(result.enabled, true);
  assert.equal(result.status, "empty");
  assert.equal(result.coverage?.totalOptionPositions, 1);
  assert.equal(result.coverage?.eligiblePositions, 0);
  assert.equal(result.coverage?.skipped.missingSpot, 1);
  assert.equal(result.coverage?.skipped.missingGreekSnapshot, 1);
  assert.equal(result.result?.["scenarioCount"], 0);
});

test("resolveAccountGreekScenarios includes completed Python result", async () => {
  let capturedInput: unknown = null;
  const result = await resolveAccountGreekScenarios({
    positions: [optionPosition as any],
    underlyingPrices: new Map([["SPY", 500]]),
    greekByPositionId: greekMapFor("U1:SPY-C"),
    env: {
      PYRUS_PYTHON_GREEK_SCENARIOS_ENABLED: "1",
      PYRUS_PYTHON_COMPUTE_ENABLED: "1",
    },
    runJob: async (request) => {
      capturedInput = request.input;
      return {
        jobId: "job-1",
        jobType: "greek_scenario_matrix",
        status: "completed",
        createdAt: "2026-05-29T20:00:00.000Z",
        startedAt: "2026-05-29T20:00:00.000Z",
        completedAt: "2026-05-29T20:00:00.010Z",
        durationMs: 10,
        warnings: [],
        result: { scenarioCount: 45, managementFlags: [] },
        error: null,
      };
    },
  });

  assert.equal(result.status, "completed");
  assert.equal(result.pythonJob.jobId, "job-1");
  assert.equal(result.coverage?.eligiblePositions, 1);
  assert.equal(result.result?.["scenarioCount"], 45);
  assert.equal((capturedInput as { positions: unknown[] }).positions.length, 1);
  assert.equal("coverage" in (capturedInput as Record<string, unknown>), false);
});

test("resolveAccountGreekScenarios reports Python failures as advisory", async () => {
  const result: AccountGreekScenarios = await resolveAccountGreekScenarios({
    positions: [optionPosition as any],
    underlyingPrices: new Map([["SPY", 500]]),
    greekByPositionId: greekMapFor("U1:SPY-C"),
    env: {
      PYRUS_PYTHON_GREEK_SCENARIOS_ENABLED: "1",
      PYRUS_PYTHON_COMPUTE_ENABLED: "1",
    },
    runJob: async () => {
      throw new Error("service unavailable");
    },
  });

  assert.equal(result.status, "unavailable");
  assert.equal(result.coverage?.eligiblePositions, 1);
  assert.equal(result.pythonJob.error?.code, "python_compute_unavailable");
});
