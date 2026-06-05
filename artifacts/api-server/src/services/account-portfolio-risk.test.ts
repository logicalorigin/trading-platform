import assert from "node:assert/strict";
import test from "node:test";
import type { BrokerPositionSnapshot } from "../providers/ibkr/client";
import {
  buildPortfolioRiskJobInputWithCoverage,
  resolveAccountPortfolioRisk,
} from "./account-portfolio-risk";
import type { PositionGreekSnapshot } from "./account-risk-model";

function equityPosition(
  overrides: Partial<BrokerPositionSnapshot> = {},
): BrokerPositionSnapshot {
  return {
    id: "U1:AAPL",
    accountId: "U1",
    symbol: "AAPL",
    assetClass: "equity",
    quantity: 10,
    averagePrice: 180,
    marketPrice: 200,
    marketValue: 2_000,
    unrealizedPnl: 200,
    unrealizedPnlPercent: 11.11,
    optionContract: null,
    ...overrides,
  } as BrokerPositionSnapshot;
}

function optionPosition(
  overrides: Partial<BrokerPositionSnapshot> = {},
): BrokerPositionSnapshot {
  return {
    id: "U1:SPY-C",
    accountId: "U1",
    symbol: "SPY 500C",
    assetClass: "option",
    quantity: 2,
    averagePrice: 5,
    marketPrice: 6,
    marketValue: 1_200,
    unrealizedPnl: 200,
    unrealizedPnlPercent: 20,
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
    ...overrides,
  } as BrokerPositionSnapshot;
}

function greekSnapshot(
  overrides: Partial<PositionGreekSnapshot> = {},
): PositionGreekSnapshot {
  return {
    positionId: "U1:SPY-C",
    symbol: "SPY 500C",
    underlying: "SPY",
    delta: 120,
    betaWeightedDelta: 120,
    gamma: 8,
    theta: -45,
    vega: 90,
    impliedVolatility: 0.28,
    source: "IBKR_OPTION_CHAIN",
    matched: true,
    warning: null,
    ...overrides,
  };
}

test("buildPortfolioRiskJobInputWithCoverage maps account positions into portfolio_risk input", () => {
  const { jobInput, coverage } = buildPortfolioRiskJobInputWithCoverage(
    [
      equityPosition(),
      optionPosition(),
      optionPosition({
        id: "U1:SPY-P",
        symbol: "SPY 500P",
        quantity: 1,
        optionContract: {
          ticker: "SPY 500P",
          underlying: "SPY",
          expirationDate: new Date("2026-06-19T00:00:00.000Z"),
          strike: 500,
          right: "put",
          multiplier: 100,
          sharesPerContract: 100,
          providerContractId: "2",
        },
      }),
    ],
    {
      nav: 50_000,
      underlyingPrices: new Map([["SPY", 500]]),
      greekByPositionId: new Map([
        ["U1:SPY-C", greekSnapshot()],
        ["U1:SPY-P", greekSnapshot({ positionId: "U1:SPY-P", delta: -40 })],
      ]),
    },
  );

  assert.deepEqual(coverage, {
    totalPositions: 3,
    pricedPositions: 3,
    deltaAdjustedPositions: 3,
    skippedPositions: 0,
    skipped: {
      missingContractData: 0,
      missingMarketValue: 0,
      missingUnderlyingPrice: 0,
    },
  });
  assert.equal(jobInput.positions.length, 3);
  assert.deepEqual(
    jobInput.positions.map((position) => ({
      symbol: position.symbol,
      quantity: position.quantity,
      price: position.price,
      delta: position.delta,
    })),
    [
      { symbol: "AAPL", quantity: 2_000, price: 1, delta: 1 },
      { symbol: "SPY", quantity: 100_000, price: 1, delta: 0.6 },
      { symbol: "SPY", quantity: -50_000, price: 1, delta: 0.4 },
    ],
  );
});

test("resolveAccountPortfolioRisk falls back to TypeScript notional when disabled", async () => {
  let called = false;
  const result = await resolveAccountPortfolioRisk({
    positions: [equityPosition()],
    nav: 10_000,
    env: {},
    runJob: async () => {
      called = true;
      throw new Error("should not run");
    },
  });

  assert.equal(called, false);
  assert.equal(result.enabled, false);
  assert.equal(result.status, "disabled");
  assert.equal(result.notional.grossUnderlyingNotional, 2_000);
  assert.equal(result.notional.notionalToNavPercent, 20);
});

test("resolveAccountPortfolioRisk maps completed Python portfolio_risk output to notional", async () => {
  let capturedRequest: { jobType?: string; input?: unknown } | null = null;
  const result = await resolveAccountPortfolioRisk({
    positions: [equityPosition(), optionPosition()],
    nav: 50_000,
    underlyingPrices: new Map([["SPY", 500]]),
    greekByPositionId: new Map([["U1:SPY-C", greekSnapshot()]]),
    env: {
      PYRUS_PYTHON_PORTFOLIO_RISK_ENABLED: "1",
      PYRUS_PYTHON_RISK_COMPUTE_ENABLED: "1",
    },
    runJob: async (request) => {
      capturedRequest = request;
      return {
        jobId: "risk:job-portfolio-1",
        jobType: "portfolio_risk",
        status: "completed",
        createdAt: "2026-06-04T20:00:00.000Z",
        startedAt: "2026-06-04T20:00:00.000Z",
        completedAt: "2026-06-04T20:00:00.020Z",
        durationMs: 20,
        warnings: ["insufficient_return_history_for_covariance"],
        result: {
          grossExposure: 102_000,
          netExposure: 102_000,
          deltaAdjustedExposure: 62_000,
          concentration: [],
          sectorExposure: [],
          scenarios: [],
        },
        error: null,
      };
    },
  });

  const captured = capturedRequest as { jobType?: string; input?: unknown } | null;

  assert.equal(captured?.jobType, "portfolio_risk");
  assert.equal(
    (captured?.input as { positions: unknown[] }).positions.length,
    2,
  );
  assert.equal(result.enabled, true);
  assert.equal(result.status, "completed");
  assert.equal(result.pythonJob.jobId, "risk:job-portfolio-1");
  assert.equal(result.notional.grossUnderlyingNotional, 102_000);
  assert.equal(result.notional.netDirectionalNotional, 102_000);
  assert.equal(result.notional.deltaAdjustedNotional, 62_000);
  assert.equal(result.notional.notionalToNavPercent, 204);
  assert.deepEqual(result.notional.coverage, {
    totalPositions: 2,
    pricedPositions: 2,
    deltaAdjustedPositions: 2,
  });
});

test("resolveAccountPortfolioRisk reports Python failure without losing fallback notional", async () => {
  const result = await resolveAccountPortfolioRisk({
    positions: [equityPosition()],
    nav: 10_000,
    env: {
      PYRUS_PYTHON_PORTFOLIO_RISK_ENABLED: "1",
      PYRUS_PYTHON_COMPUTE_ENABLED: "1",
    },
    runJob: async () => {
      throw new Error("python lane unavailable");
    },
  });

  assert.equal(result.enabled, true);
  assert.equal(result.status, "unavailable");
  assert.equal(result.warning, "python lane unavailable");
  assert.equal(result.notional.grossUnderlyingNotional, 2_000);
  assert.equal(result.notional.notionalToNavPercent, 20);
});
