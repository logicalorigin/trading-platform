import assert from "node:assert/strict";
import test from "node:test";
import type { BrokerPositionSnapshot } from "../providers/ibkr/client";
import type { AccountGreekScenarios } from "./account-greek-scenarios";
import {
  buildAccountRiskRecommendations,
  type AccountRiskRecommendations,
} from "./account-risk-recommendations";
import type {
  NotionalExposureSummary,
  PositionGreekSnapshot,
} from "./account-risk-model";

const disabledGreekScenarios: AccountGreekScenarios = {
  enabled: false,
  status: "disabled",
  source: "python_compute",
  warning: null,
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

const notional: NotionalExposureSummary = {
  grossUnderlyingNotional: 82_000,
  netDirectionalNotional: -22_000,
  deltaAdjustedNotional: -9_500,
  notionalToNavPercent: 164,
  coverage: {
    totalPositions: 2,
    pricedPositions: 2,
    deltaAdjustedPositions: 1,
  },
};

function optionPosition(
  overrides: Partial<BrokerPositionSnapshot> = {},
): BrokerPositionSnapshot {
  return {
    id: "U1:SPY-STRADDLE",
    accountId: "U1",
    symbol: "SPY short straddle",
    assetClass: "option",
    quantity: -1,
    averagePrice: 11,
    marketPrice: 12,
    marketValue: -1_200,
    unrealizedPnl: -100,
    unrealizedPnlPercent: -8.33,
    optionContract: {
      ticker: "SPY short straddle",
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
    positionId: "U1:SPY-STRADDLE",
    symbol: "SPY short straddle",
    underlying: "SPY",
    delta: -30,
    betaWeightedDelta: -30,
    gamma: -8,
    theta: -45,
    vega: -90,
    impliedVolatility: 0.28,
    source: "IBKR_OPTION_CHAIN",
    matched: true,
    warning: null,
    ...overrides,
  };
}

function assertNoTradeTicketFields(value: unknown) {
  const forbiddenKeys = new Set([
    "action",
    "contracts",
    "limitPrice",
    "order",
    "orderAction",
    "orderId",
    "quantity",
    "side",
  ]);
  const stack: unknown[] = [value];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object") {
      continue;
    }
    for (const [key, nested] of Object.entries(current)) {
      assert.equal(
        forbiddenKeys.has(key),
        false,
        `risk recommendation leaked trade-ticket key ${key}`,
      );
      stack.push(nested);
    }
  }
}

function assertReviewOnlyLanguage(payload: AccountRiskRecommendations) {
  const tradingVerb = /\b(buy|sell|submit|route|place order)\b/i;
  for (const recommendation of payload.recommendations) {
    assert.match(recommendation.suggestedReview, /^(Review|Monitor)\b/);
    assert.equal(
      tradingVerb.test(
        [
          recommendation.title,
          recommendation.rationale,
          recommendation.suggestedReview,
        ].join(" "),
      ),
      false,
    );
  }
}

test("buildAccountRiskRecommendations returns empty advisory payload without option positions", () => {
  const result = buildAccountRiskRecommendations({
    positions: [
      {
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
      } as BrokerPositionSnapshot,
    ],
    nav: 25_000,
    greekByPositionId: new Map(),
    greekScenarios: disabledGreekScenarios,
    notional,
    expiryConcentration: { thisWeek: 0, thisMonth: 0, next90Days: 0 },
  });

  assert.equal(result.advisoryOnly, true);
  assert.equal(result.source, "options_account_risk");
  assert.equal(result.scope, "options");
  assert.equal(result.status, "empty");
  assert.equal(result.summary.optionPositionCount, 0);
  assert.equal(result.summary.underlyingCount, 0);
  assert.equal(result.summary.totalPremiumExposure, 0);
  assert.deepEqual(result.recommendations, []);
  assertNoTradeTicketFields(result);
});

test("buildAccountRiskRecommendations derives read-only options risk reviews from greeks and scenarios", () => {
  const qqqOption = optionPosition({
    id: "U1:QQQ-C",
    symbol: "QQQ 450C",
    marketValue: 400,
    optionContract: {
      ticker: "QQQ 450C",
      underlying: "QQQ",
      expirationDate: new Date("2026-06-05T00:00:00.000Z"),
      strike: 450,
      right: "call",
      multiplier: 100,
      sharesPerContract: 100,
      providerContractId: "2",
    },
  });
  const result = buildAccountRiskRecommendations({
    positions: [optionPosition(), qqqOption],
    nav: 50_000,
    greekByPositionId: new Map([
      ["U1:SPY-STRADDLE", greekSnapshot()],
      ["U1:QQQ-C", greekSnapshot({ positionId: "U1:QQQ-C", matched: false })],
    ]),
    greekScenarios: {
      ...disabledGreekScenarios,
      enabled: true,
      status: "completed",
      coverage: {
        totalOptionPositions: 2,
        eligiblePositions: 1,
        skippedPositions: 1,
        skipped: {
          missingSpot: 0,
          missingMarkPrice: 0,
          missingContractData: 0,
          missingGreekSnapshot: 1,
        },
      },
      result: {
        scenarioCount: 2,
        scenarios: [
          {
            spotShock: -0.05,
            ivShockVolPoints: 5,
            dayOffset: 3,
            estimatedPnl: -6_200,
            components: { repricing: -6_200 },
            repricedPositionCount: 1,
          },
          {
            spotShock: 0.05,
            ivShockVolPoints: -5,
            dayOffset: 0,
            estimatedPnl: 1_500,
            components: { repricing: 1_500 },
            repricedPositionCount: 1,
          },
        ],
        managementFlags: [
          {
            symbol: "SPY short straddle",
            reasons: ["theta_burden", "short_gamma_convexity", "vega_sensitive"],
            severityScore: 2.4,
            thetaBurdenPct: 3.75,
            worstFivePctGammaPnlPct: -84,
            fiveVolPointVegaPnlPct: -37.5,
          },
        ],
      },
    },
    notional,
    expiryConcentration: { thisWeek: 400, thisMonth: 1_600, next90Days: 1_600 },
  });

  const categories = new Set(
    result.recommendations.map((recommendation) => recommendation.category),
  );

  assert.equal(result.advisoryOnly, true);
  assert.equal(result.status, "degraded");
  assert.equal(result.summary.optionPositionCount, 2);
  assert.equal(result.summary.underlyingCount, 2);
  assert.equal(result.summary.totalPremiumExposure, 1_600);
  assert.equal(result.summary.premiumToNavPercent, 3.2);
  assert.equal(result.summary.worstShockPnl, -6_200);
  assert.equal(result.summary.worstShockToNavPercent, -12.4);
  assert.equal(categories.has("coverage"), true);
  assert.equal(categories.has("scenario"), true);
  assert.equal(categories.has("theta"), true);
  assert.equal(categories.has("gamma"), true);
  assert.equal(categories.has("vega"), true);
  assert.equal(categories.has("concentration"), true);
  assert.equal(
    result.recommendations.some(
      (recommendation) =>
        recommendation.symbol === "SPY short straddle" &&
        recommendation.underlying === "SPY" &&
        recommendation.severity === "attention",
    ),
    true,
  );
  assertNoTradeTicketFields(result);
  assertReviewOnlyLanguage(result);
});
