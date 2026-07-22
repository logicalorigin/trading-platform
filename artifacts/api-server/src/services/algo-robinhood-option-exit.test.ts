import assert from "node:assert/strict";
import test from "node:test";

import {
  algoDeploymentTargetsTable,
  algoDeploymentsTable,
  algoStrategiesTable,
  algoTargetExecutionsTable,
  algoTargetPositionsTable,
  brokerAccountsTable,
  brokerConnectionsTable,
  db,
  executionEventsTable,
  usersTable,
} from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";
import { eq } from "drizzle-orm";

import { HttpError } from "../lib/errors";
import {
  executePreparedAlgoRobinhoodOptionExit,
  type ExecuteAlgoRobinhoodOptionExitDependencies,
  type ExecutePreparedAlgoRobinhoodOptionExitInput,
} from "./algo-robinhood-option-exit";
import { reserveAlgoTargetExecution } from "./algo-target-execution-outbox";
import type {
  RobinhoodOptionOrderInput,
  RobinhoodOptionOrderPlaceResponse,
  RobinhoodOptionOrderReviewResponse,
} from "./robinhood-option-orders";

const TEST_NOW = new Date("2026-07-21T21:00:00.000Z");
const TEST_QUOTE_TIME = "2026-07-21T20:59:55.000Z";
const PROVIDER_POSITION_ID = "robinhood-option-aapl-210-call";

async function seedExitFixture() {
  const [owner] = await db
    .insert(usersTable)
    .values({
      email: "algo-robinhood-exit@example.com",
      passwordHash: "unused",
      role: "admin",
    })
    .returning();
  const [strategy] = await db
    .insert(algoStrategiesTable)
    .values({
      name: "Robinhood exit strategy",
      mode: "shadow",
      enabled: true,
      symbolUniverse: ["AAPL"],
      config: {},
    })
    .returning();
  const [deployment] = await db
    .insert(algoDeploymentsTable)
    .values({
      appUserId: owner!.id,
      strategyId: strategy!.id,
      name: "Robinhood exit deployment",
      mode: "live",
      enabled: true,
      isDraft: false,
      symbolUniverse: ["AAPL"],
      config: { parameters: { executionMode: "signal_options" } },
    })
    .returning();
  const [connection] = await db
    .insert(brokerConnectionsTable)
    .values({
      appUserId: owner!.id,
      name: "Robinhood Agentic",
      connectionType: "broker",
      brokerProvider: "robinhood",
      mode: "live",
      status: "connected",
    })
    .returning();
  const [account] = await db
    .insert(brokerAccountsTable)
    .values({
      appUserId: owner!.id,
      connectionId: connection!.id,
      providerAccountId: "robinhood:987654321",
      displayName: "Agentic",
      mode: "live",
      includedInTrading: true,
      accountStatus: "open",
      capabilities: [
        "robinhood-agentic",
        "execution-ready",
        "orders",
        "executions",
        "robinhood-option-level:option_level_2",
      ],
      executionBlockers: [],
    })
    .returning();
  const [target] = await db
    .insert(algoDeploymentTargetsTable)
    .values({
      deploymentId: deployment!.id,
      brokerAccountId: account!.id,
      lifecycle: "active",
      allocationPercent: "20.00",
      allowanceUnit: "percent",
      allowanceValue: "20.000000",
      executionEnabled: true,
    })
    .returning();
  const contractSnapshot = {
    contractSymbol: "AAPL  260821C00210000",
    occSymbol: "AAPL  260821C00210000",
    multiplier: 100,
    sharesPerContract: 100,
    chainSymbol: "AAPL",
    underlyingType: "equity",
    expiration: "2026-08-21",
    strike: 210,
    optionType: "Call",
  };
  const [position] = await db
    .insert(algoTargetPositionsTable)
    .values({
      appUserId: owner!.id,
      deploymentId: deployment!.id,
      targetId: target!.id,
      strategyPositionKey: "position:AAPL:1",
      symbol: "AAPL",
      providerPositionId: PROVIDER_POSITION_ID,
      contractSnapshot,
      quantity: "2.000000",
      premiumBasis: "490.000000",
      status: "open",
      openedAt: new Date("2026-07-21T18:00:00.000Z"),
      lastReconciledAt: new Date("2026-07-21T20:59:59.000Z"),
    })
    .returning();
  const [sourceEvent] = await db
    .insert(executionEventsTable)
    .values({
      deploymentId: deployment!.id,
      providerAccountId: account!.providerAccountId,
      symbol: "AAPL",
      eventType: "signal_options_exit_decision",
      summary: "Signal Options exit decision",
      payload: { strategyPositionKey: position!.strategyPositionKey },
    })
    .returning();
  const order = exitOrder();
  const execution = await reserveAlgoTargetExecution({
    appUserId: owner!.id,
    deploymentId: deployment!.id,
    targetId: target!.id,
    sourceEventId: sourceEvent!.id,
    action: "exit",
    actionIdentity: `${position!.strategyPositionKey}:full-close`,
    contractSnapshot,
    orderSnapshot: {
      positionId: position!.id,
      strategyPositionKey: position!.strategyPositionKey,
      side: order.side,
      positionEffect: order.positionEffect,
      orderType: order.orderType,
      timeInForce: order.timeInForce,
      marketHours: order.marketHours,
      quantity: order.quantity,
      limitPrice: order.limitPrice,
      stopPrice: order.stopPrice,
      platformCaps: { maxQuoteAgeMs: 15_000 },
    },
    requestedQuantity: order.quantity,
    premiumAtRisk: null,
    occurredAt: new Date("2026-07-21T20:59:58.000Z"),
  });
  return {
    owner: owner!,
    deployment: deployment!,
    account: account!,
    target: target!,
    position: position!,
    execution,
    order,
  };
}

type ExitFixture = Awaited<ReturnType<typeof seedExitFixture>>;

function exitOrder(): RobinhoodOptionOrderInput {
  return {
    contractSymbol: "O:AAPL260821C00210000",
    multiplier: 100,
    sharesPerContract: 100,
    chainSymbol: "AAPL",
    underlyingType: "equity",
    expiration: "2026-08-21",
    strike: 210,
    optionType: "Call",
    side: "Sell",
    positionEffect: "Close",
    orderType: "Limit",
    timeInForce: "Day",
    marketHours: "regular_hours",
    quantity: 2,
    limitPrice: 3,
    stopPrice: null,
  };
}

function exitInput(
  fixture: ExitFixture,
): ExecutePreparedAlgoRobinhoodOptionExitInput {
  return {
    appUserId: fixture.owner.id,
    accountId: fixture.account.id,
    algoContext: {
      deploymentId: fixture.deployment.id,
      targetId: fixture.target.id,
      positionId: fixture.position.id,
      targetExecutionId: fixture.execution.id,
    },
    order: fixture.order,
  };
}

function reviewResponse(input: {
  fixture: ExitFixture;
  alerts?: string[];
  orderChecks?: unknown;
}): RobinhoodOptionOrderReviewResponse {
  return {
    provider: "robinhood",
    checkedAt: TEST_NOW.toISOString(),
    account: {
      id: input.fixture.account.id,
      connectionId: input.fixture.account.connectionId,
      accountNumberLast4: "4321",
      displayName: "Agentic",
      baseCurrency: "USD",
      mode: "live",
      accountStatus: "open",
      executionReady: true,
      executionBlockers: [],
      lastSyncedAt: TEST_NOW.toISOString(),
    },
    order: {
      optionId: PROVIDER_POSITION_ID,
      occSymbol: "AAPL  260821C00210000",
      multiplier: 100,
      sharesPerContract: 100,
      chainSymbol: "AAPL",
      underlyingType: "equity",
      expiration: "2026-08-21",
      strike: 210,
      optionType: "Call",
      side: "Sell",
      positionEffect: "Close",
      orderType: "Limit",
      timeInForce: "Day",
      marketHours: "regular_hours",
      quantity: 2,
      limitPrice: 3,
      stopPrice: null,
    },
    review: {
      alerts: input.alerts ?? [],
      orderChecks: input.orderChecks ?? null,
      marketDataDisclosure: null,
      quote: {
        instrumentId: PROVIDER_POSITION_ID,
        markPrice: 3,
        adjustedMarkPrice: 3,
        bidPrice: 2.95,
        askPrice: 3.05,
        previousClosePrice: 2.8,
        impliedVolatility: 0.25,
        delta: 0.5,
        gamma: 0.02,
        theta: -0.01,
        vega: 0.08,
        updatedAt: TEST_QUOTE_TIME,
      },
      estimate: {
        premium: 600,
        totalFee: 0,
        collateralAmount: null,
        collateralDirection: null,
        collateralInfinite: false,
      },
    },
  };
}

function placeResponse(
  fixture: ExitFixture,
): RobinhoodOptionOrderPlaceResponse {
  const reviewed = reviewResponse({ fixture });
  return {
    provider: "robinhood",
    submittedAt: TEST_NOW.toISOString(),
    account: reviewed.account,
    order: {
      ...reviewed.order,
      brokerageOrderId: "robinhood-order-exit-1",
      state: "queued",
      refId: fixture.execution.clientOrderId,
    },
    alerts: [],
  };
}

function allowedTaxPreflight() {
  return { action: "allow" as const, preflightToken: "tax-exit-allow" };
}

test("Robinhood exit claims before placement and concurrent retries place once", async () => {
  await withTestDb(async () => {
    const fixture = await seedExitFixture();
    let placeCalls = 0;
    const dependencies: ExecuteAlgoRobinhoodOptionExitDependencies = {
      now: () => TEST_NOW,
      reviewOrder: async () => reviewResponse({ fixture }),
      createTaxPreflight: async () => allowedTaxPreflight(),
      placeOrder: async (options) => {
        placeCalls += 1;
        assert.equal(options.input.refId, fixture.execution.clientOrderId);
        assert.equal(options.input.taxAcknowledgements, undefined);
        return placeResponse(fixture);
      },
    };

    const results = await Promise.all([
      executePreparedAlgoRobinhoodOptionExit(exitInput(fixture), dependencies),
      executePreparedAlgoRobinhoodOptionExit(exitInput(fixture), dependencies),
    ]);
    assert.equal(placeCalls, 1);
    assert.equal(results[0].status, "submitted");
    assert.equal(results[1].status, "submitted");
    assert.equal(results[0].brokerOrderId, "robinhood-order-exit-1");
    const [position] = await db.select().from(algoTargetPositionsTable);
    assert.equal(position!.status, "closing");
  });
});

test("Robinhood exit rejects every unclassified review alert", async () => {
  await withTestDb(async () => {
    const fixture = await seedExitFixture();
    let placeCalls = 0;
    const result = await executePreparedAlgoRobinhoodOptionExit(
      exitInput(fixture),
      {
        now: () => TEST_NOW,
        reviewOrder: async () =>
          reviewResponse({ fixture, alerts: ["manual review required"] }),
        createTaxPreflight: async () => allowedTaxPreflight(),
        placeOrder: async () => {
          placeCalls += 1;
          return placeResponse(fixture);
        },
      },
    );

    assert.equal(result.status, "rejected");
    assert.equal(result.errorCode, "algo_robinhood_review_alert");
    assert.equal(placeCalls, 0);
  });
});

test("Robinhood exit never auto-acknowledges a tax warning", async () => {
  await withTestDb(async () => {
    const fixture = await seedExitFixture();
    let placeCalls = 0;
    const result = await executePreparedAlgoRobinhoodOptionExit(
      exitInput(fixture),
      {
        now: () => TEST_NOW,
        reviewOrder: async () => reviewResponse({ fixture }),
        createTaxPreflight: async (_input, options) => {
          assert.deepEqual(options, { appUserId: fixture.owner.id });
          return {
            action: "warn_ack_required",
            preflightToken: "tax-exit-warning",
          };
        },
        placeOrder: async () => {
          placeCalls += 1;
          return placeResponse(fixture);
        },
      },
    );

    assert.equal(result.status, "rejected");
    assert.equal(result.errorCode, "algo_tax_acknowledgement_required");
    assert.equal(placeCalls, 0);
  });
});

test("an ambiguous Robinhood exit is fenced and never blindly retried", async () => {
  await withTestDb(async () => {
    const fixture = await seedExitFixture();
    let placeCalls = 0;
    const dependencies: ExecuteAlgoRobinhoodOptionExitDependencies = {
      now: () => TEST_NOW,
      reviewOrder: async () => reviewResponse({ fixture }),
      createTaxPreflight: async () => allowedTaxPreflight(),
      placeOrder: async () => {
        placeCalls += 1;
        throw new HttpError(409, "unknown", {
          code: "robinhood_option_order_submit_reconcile_required",
        });
      },
    };

    const first = await executePreparedAlgoRobinhoodOptionExit(
      exitInput(fixture),
      dependencies,
    );
    const second = await executePreparedAlgoRobinhoodOptionExit(
      exitInput(fixture),
      dependencies,
    );
    assert.equal(first.status, "reconciliation_required");
    assert.equal(second.status, "reconciliation_required");
    assert.equal(placeCalls, 1);
    const [position] = await db.select().from(algoTargetPositionsTable);
    assert.equal(position!.status, "attention");
  });
});

test("a submitted exit stays unresolved when its owned position cannot transition", async () => {
  await withTestDb(async () => {
    const fixture = await seedExitFixture();
    const result = await executePreparedAlgoRobinhoodOptionExit(
      exitInput(fixture),
      {
        now: () => TEST_NOW,
        reviewOrder: async () => reviewResponse({ fixture }),
        createTaxPreflight: async () => allowedTaxPreflight(),
        placeOrder: async () => {
          await db
            .update(algoTargetPositionsTable)
            .set({ status: "manual_takeover" })
            .where(eq(algoTargetPositionsTable.id, fixture.position.id));
          return placeResponse(fixture);
        },
      },
    );

    assert.equal(result.status, "reconciliation_required");
    assert.equal(
      result.errorCode,
      "algo_target_close_position_transition_failed",
    );
    const [position] = await db.select().from(algoTargetPositionsTable);
    assert.equal(position!.status, "manual_takeover");
  });
});
