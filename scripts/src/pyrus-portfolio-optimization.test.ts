import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPortfolioOptimizationInput,
  buildUrl,
  hasPortfolioOptimizationCapability,
  statusExitCode,
  summarizePortfolioOptimizationJob,
} from "./pyrus-portfolio-optimization";

test("portfolio optimization inspector URL builder preserves base paths", () => {
  assert.equal(
    buildUrl("http://127.0.0.1:18747/api", "/diagnostics/runtime"),
    "http://127.0.0.1:18747/api/diagnostics/runtime",
  );
  assert.equal(
    buildUrl("http://127.0.0.1:18768", "/jobs"),
    "http://127.0.0.1:18768/jobs",
  );
});

test("portfolio optimization sample input is advisory and deterministic", () => {
  const input = buildPortfolioOptimizationInput({
    objective: "risk_parity",
    maxWeight: 0.55,
    maxTurnover: 0.2,
  });

  assert.equal(input.objective, "risk_parity");
  assert.deepEqual(input.constraints, {
    longOnly: true,
    maxWeight: 0.55,
    maxTurnover: 0.2,
  });
  assert.deepEqual(
    input.positions.map((position) => position.symbol),
    ["SPY", "QQQ", "TLT"],
  );
  assert.equal(input.returns.length, 3);
});

test("portfolio optimization capability detection finds the Python compute job", () => {
  assert.equal(
    hasPortfolioOptimizationCapability({
      service: "pyrus-compute",
      capabilities: [
        { jobType: "benchmark_matrix", schemaVersion: 1 },
        { jobType: "portfolio_optimization", schemaVersion: 1 },
      ],
    }),
    true,
  );
  assert.equal(hasPortfolioOptimizationCapability({ capabilities: [] }), false);
});

test("portfolio optimization job summary preserves advisory-only result shape", () => {
  const summary = summarizePortfolioOptimizationJob({
    jobId: "job-1",
    jobType: "portfolio_optimization",
    status: "completed",
    createdAt: "2026-05-30T21:00:00.000Z",
    startedAt: "2026-05-30T21:00:00.001Z",
    completedAt: "2026-05-30T21:00:00.010Z",
    durationMs: 9,
    warnings: [],
    error: null,
    result: {
      advisoryOnly: true,
      objective: "min_variance",
      turnover: 0.123456,
      portfolioVariance: 0.0000123456,
      portfolioVolatility: 0.003513631,
      concentration: {
        maxWeight: 0.5,
        topSymbol: "SPY",
        effectivePositionCount: 2.9,
      },
      warnings: [],
      allocations: [
        {
          symbol: "SPY",
          currentWeight: 0.5,
          proposedWeight: 0.45,
          deltaWeight: -0.05,
          riskContribution: 0.4,
          expectedReturn: 0.0005,
        },
      ],
    },
  });

  assert.equal(summary.status, "completed");
  assert.equal(summary.advisoryOnly, true);
  assert.equal(summary.objective, "min_variance");
  assert.equal(summary.allocationCount, 1);
  assert.ok(Array.isArray(summary.allocations));
  assert.deepEqual(summary.allocations[0], {
    symbol: "SPY",
    currentWeight: 0.5,
    proposedWeight: 0.45,
    deltaWeight: -0.05,
    riskContribution: 0.4,
    expectedReturn: 0.0005,
  });
});

test("portfolio optimization inspector exits nonzero unless service and advisory job are healthy", () => {
  assert.equal(
    statusExitCode({
      pythonCompute: { enabled: true, status: "healthy" },
      capabilities: { hasPortfolioOptimization: true },
      portfolioOptimization: { status: "completed", advisoryOnly: true, error: null },
    }),
    0,
  );
  assert.equal(
    statusExitCode({
      pythonCompute: { enabled: true, status: "healthy" },
      capabilities: { hasPortfolioOptimization: false },
      portfolioOptimization: { status: "completed", advisoryOnly: true, error: null },
    }),
    2,
  );
  assert.equal(
    statusExitCode({
      pythonCompute: { enabled: true, status: "healthy" },
      capabilities: { hasPortfolioOptimization: true },
      portfolioOptimization: { status: "completed", advisoryOnly: false, error: null },
    }),
    2,
  );
});
