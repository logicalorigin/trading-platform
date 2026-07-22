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

import {
  reconcileAlgoRobinhoodOptionExit,
  type ReconcileAlgoRobinhoodOptionExitDependencies,
} from "./algo-robinhood-option-reconciliation";

const NOW = new Date("2026-07-21T21:00:00.000Z");
const PROVIDER_POSITION_ID = "robinhood-option-aapl-210-call";

async function seedExitReconciliationFixture(
  input: {
    brokerOrderId?: string | null;
    status?: "submitted" | "reconciliation_required";
    requestedQuantity?: number;
    filledQuantity?: number;
    positionQuantity?: number;
    positionStatus?: "closing" | "attention";
  } = {},
) {
  const requestedQuantity = input.requestedQuantity ?? 2;
  const filledQuantity = input.filledQuantity ?? 0;
  const positionQuantity = input.positionQuantity ?? 2;
  const [owner] = await db
    .insert(usersTable)
    .values({
      email: "algo-robinhood-exit-reconcile@example.com",
      passwordHash: "unused",
      role: "admin",
    })
    .returning();
  const [strategy] = await db
    .insert(algoStrategiesTable)
    .values({
      name: "Robinhood exit reconciliation strategy",
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
      name: "Robinhood exit reconciliation deployment",
      mode: "live",
      enabled: true,
      isDraft: false,
      symbolUniverse: ["AAPL"],
      config: {},
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
      providerAccountId: "robinhood:246813579",
      displayName: "Agentic",
      mode: "live",
      includedInTrading: true,
      accountStatus: "open",
      capabilities: ["robinhood-agentic", "execution-ready"],
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
    contractSymbol: "O:AAPL260821C00210000",
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
      strategyPositionKey: "position:AAPL:owned",
      symbol: "AAPL",
      providerPositionId: PROVIDER_POSITION_ID,
      contractSnapshot,
      quantity: positionQuantity.toFixed(6),
      premiumBasis: (positionQuantity * 250).toFixed(6),
      status: input.positionStatus ?? "closing",
      openedAt: new Date("2026-07-21T18:00:00.000Z"),
      lastReconciledAt: new Date("2026-07-21T20:59:00.000Z"),
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
  const [execution] = await db
    .insert(algoTargetExecutionsTable)
    .values({
      appUserId: owner!.id,
      deploymentId: deployment!.id,
      targetId: target!.id,
      sourceEventId: sourceEvent!.id,
      executionKey: `algo-target:exit:${"b".repeat(64)}`,
      action: "exit",
      status: input.status ?? "submitted",
      clientOrderId: "99999999-9999-4999-8999-999999999999",
      brokerOrderId:
        input.brokerOrderId === undefined
          ? "robinhood-order-exit-1"
          : input.brokerOrderId,
      brokerOrderState: "confirmed",
      contractSnapshot,
      orderSnapshot: {
        positionId: position!.id,
        strategyPositionKey: position!.strategyPositionKey,
        side: "Sell",
        positionEffect: "Close",
        orderType: "Limit",
        timeInForce: "Day",
        marketHours: "regular_hours",
        quantity: requestedQuantity,
        limitPrice: 3,
        stopPrice: null,
        platformCaps: { maxQuoteAgeMs: 15_000 },
      },
      requestedQuantity: requestedQuantity.toFixed(6),
      filledQuantity: filledQuantity.toFixed(6),
      premiumAtRisk: null,
      occurredAt: new Date("2026-07-21T20:59:30.000Z"),
    })
    .returning();
  return {
    owner: owner!,
    deployment: deployment!,
    account: account!,
    target: target!,
    position: position!,
    execution: execution!,
    contractSnapshot,
  };
}

type ExitFixture = Awaited<ReturnType<typeof seedExitReconciliationFixture>>;

function providerOrders(input: {
  fixture: ExitFixture;
  state: string;
  processedQuantity: number;
}) {
  return {
    provider: "robinhood" as const,
    checkedAt: NOW.toISOString(),
    account: {
      id: input.fixture.account.id,
      connectionId: input.fixture.account.connectionId,
      accountNumberLast4: "3579",
      displayName: "Agentic",
      baseCurrency: "USD",
      mode: "live" as const,
      accountStatus: "open",
      executionReady: true,
      executionBlockers: [],
      lastSyncedAt: NOW.toISOString(),
    },
    orders: [
      {
        id: "robinhood-order-exit-1",
        chainSymbol: "AAPL",
        state: input.state,
        orderType: "Limit",
        quantity: Number(input.fixture.execution.requestedQuantity),
        processedQuantity: input.processedQuantity,
        price: 3,
        stopPrice: null,
        createdAt: "2026-07-21T20:59:35.000Z",
      },
    ],
  };
}

function providerPosition(fixture: ExitFixture, quantity: number) {
  return {
    accountId: fixture.account.id,
    symbol: "AAPL",
    assetClass: "option" as const,
    quantity,
    optionContract: {
      ticker: PROVIDER_POSITION_ID,
      underlying: "AAPL",
      expirationDate: new Date("2026-08-21T00:00:00.000Z"),
      strike: 210,
      right: "call" as const,
      multiplier: 100,
      sharesPerContract: 100,
      providerContractId: PROVIDER_POSITION_ID,
      brokerContractId: PROVIDER_POSITION_ID,
    },
  };
}

function reconciliationInput(fixture: ExitFixture) {
  return {
    appUserId: fixture.owner.id,
    executionId: fixture.execution.id,
  };
}

test("Robinhood exit reconciliation applies cumulative partial fills exactly once", async () => {
  await withTestDb(async () => {
    const fixture = await seedExitReconciliationFixture();
    let state = "confirmed";
    let processedQuantity = 1;
    let providerQuantity = 1;
    let providerReads = 0;
    const dependencies: ReconcileAlgoRobinhoodOptionExitDependencies = {
      now: () => NOW,
      loadOrders: async () => {
        providerReads += 1;
        return providerOrders({ fixture, state, processedQuantity });
      },
      loadPositions: async () => {
        providerReads += 1;
        return providerQuantity > 0
          ? [providerPosition(fixture, providerQuantity)]
          : [];
      },
    };

    const [partial, sameFillRetry] = await Promise.all([
      reconcileAlgoRobinhoodOptionExit(
        reconciliationInput(fixture),
        dependencies,
      ),
      reconcileAlgoRobinhoodOptionExit(
        reconciliationInput(fixture),
        dependencies,
      ),
    ]);
    assert.equal(partial.status, "submitted");
    assert.equal(partial.filledQuantity, "1.000000");
    assert.equal(sameFillRetry.status, "submitted");
    assert.equal(sameFillRetry.filledQuantity, "1.000000");
    let [position] = await db.select().from(algoTargetPositionsTable);
    assert.equal(position!.quantity, "1.000000");
    assert.equal(position!.premiumBasis, "250.000000");
    assert.equal(position!.status, "closing");

    state = "filled";
    processedQuantity = 2;
    providerQuantity = 0;
    const filled = await reconcileAlgoRobinhoodOptionExit(
      reconciliationInput(fixture),
      dependencies,
    );
    assert.equal(filled.status, "filled");
    assert.equal(filled.filledQuantity, "2.000000");
    [position] = await db.select().from(algoTargetPositionsTable);
    assert.equal(position!.quantity, "0.000000");
    assert.equal(position!.premiumBasis, "0.000000");
    assert.equal(position!.status, "closed");
    assert.equal(position!.closedAt?.toISOString(), NOW.toISOString());

    const terminalRetry = await reconcileAlgoRobinhoodOptionExit(
      reconciliationInput(fixture),
      dependencies,
    );
    assert.equal(terminalRetry.status, "filled");
    assert.equal(providerReads, 6);
  });
});

test("Robinhood exit reconciliation reopens a remainder after partial cancellation", async () => {
  await withTestDb(async () => {
    const fixture = await seedExitReconciliationFixture();
    const result = await reconcileAlgoRobinhoodOptionExit(
      reconciliationInput(fixture),
      {
        now: () => NOW,
        loadOrders: async () =>
          providerOrders({
            fixture,
            state: "cancelled",
            processedQuantity: 1,
          }),
        loadPositions: async () => [providerPosition(fixture, 1)],
      },
    );

    assert.equal(result.status, "cancelled");
    assert.equal(result.filledQuantity, "1.000000");
    const [position] = await db.select().from(algoTargetPositionsTable);
    assert.equal(position!.quantity, "1.000000");
    assert.equal(position!.premiumBasis, "250.000000");
    assert.equal(position!.status, "open");
    assert.equal(position!.closedAt, null);
  });
});

test("a filled scale-out leaves the remaining owned position open", async () => {
  await withTestDb(async () => {
    const fixture = await seedExitReconciliationFixture({
      requestedQuantity: 1,
    });
    const result = await reconcileAlgoRobinhoodOptionExit(
      reconciliationInput(fixture),
      {
        now: () => NOW,
        loadOrders: async () =>
          providerOrders({ fixture, state: "filled", processedQuantity: 1 }),
        loadPositions: async () => [providerPosition(fixture, 1)],
      },
    );

    assert.equal(result.status, "filled");
    const [position] = await db.select().from(algoTargetPositionsTable);
    assert.equal(position!.quantity, "1.000000");
    assert.equal(position!.premiumBasis, "250.000000");
    assert.equal(position!.status, "open");
  });
});

test("Robinhood exit reconciliation never guesses an order without a broker id", async () => {
  await withTestDb(async () => {
    const fixture = await seedExitReconciliationFixture({
      brokerOrderId: null,
      status: "reconciliation_required",
      positionStatus: "attention",
    });
    let providerReads = 0;
    const result = await reconcileAlgoRobinhoodOptionExit(
      reconciliationInput(fixture),
      {
        now: () => NOW,
        loadOrders: async () => {
          providerReads += 1;
          throw new Error("unsupported ref lookup");
        },
        loadPositions: async () => {
          providerReads += 1;
          return [];
        },
      },
    );

    assert.equal(result.status, "reconciliation_required");
    assert.equal(result.errorCode, "algo_robinhood_ref_lookup_unavailable");
    assert.equal(providerReads, 0);
  });
});

test("Robinhood exit reconciliation rejects provider state below remaining algo attribution", async () => {
  await withTestDb(async () => {
    const fixture = await seedExitReconciliationFixture();
    await db.insert(algoTargetPositionsTable).values({
      appUserId: fixture.owner.id,
      deploymentId: fixture.deployment.id,
      targetId: fixture.target.id,
      strategyPositionKey: "position:AAPL:other",
      symbol: "AAPL",
      providerPositionId: PROVIDER_POSITION_ID,
      contractSnapshot: fixture.contractSnapshot,
      quantity: "1.000000",
      premiumBasis: "250.000000",
      status: "open",
      openedAt: new Date("2026-07-21T19:00:00.000Z"),
      lastReconciledAt: new Date("2026-07-21T20:59:00.000Z"),
    });

    const result = await reconcileAlgoRobinhoodOptionExit(
      reconciliationInput(fixture),
      {
        now: () => NOW,
        loadOrders: async () =>
          providerOrders({
            fixture,
            state: "confirmed",
            processedQuantity: 1,
          }),
        loadPositions: async () => [providerPosition(fixture, 1)],
      },
    );

    assert.equal(result.status, "reconciliation_required");
    assert.equal(
      result.errorCode,
      "algo_provider_position_attribution_invalid",
    );
    const positions = await db.select().from(algoTargetPositionsTable);
    const closing = positions.find((row) => row.id === fixture.position.id);
    assert.equal(closing!.quantity, "2.000000");
    assert.equal(closing!.status, "attention");
  });
});
