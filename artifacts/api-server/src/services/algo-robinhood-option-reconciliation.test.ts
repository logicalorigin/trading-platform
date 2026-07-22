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
  reconcileAlgoRobinhoodOptionEntry,
  type ReconcileAlgoRobinhoodOptionEntryDependencies,
} from "./algo-robinhood-option-reconciliation";

const NOW = new Date("2026-07-21T21:00:00.000Z");

async function seedReconciliationFixture(
  input: {
    brokerOrderId?: string | null;
    status?: "submitted" | "reconciliation_required";
  } = {},
) {
  const [owner] = await db
    .insert(usersTable)
    .values({
      email: "algo-robinhood-reconcile@example.com",
      passwordHash: "unused",
      role: "admin",
    })
    .returning();
  const [strategy] = await db
    .insert(algoStrategiesTable)
    .values({
      name: "Robinhood reconciliation strategy",
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
      name: "Robinhood reconciliation deployment",
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
  const [sourceEvent] = await db
    .insert(executionEventsTable)
    .values({
      deploymentId: deployment!.id,
      providerAccountId: account!.providerAccountId,
      symbol: "AAPL",
      eventType: "signal_options_entry_decision",
      summary: "Signal Options entry decision",
      payload: { strategyPositionKey: "position:AAPL:new" },
    })
    .returning();
  const [execution] = await db
    .insert(algoTargetExecutionsTable)
    .values({
      appUserId: owner!.id,
      deploymentId: deployment!.id,
      targetId: target!.id,
      sourceEventId: sourceEvent!.id,
      executionKey: `algo-target:entry:${"a".repeat(64)}`,
      action: "entry",
      status: input.status ?? "submitted",
      clientOrderId: "88888888-8888-4888-8888-888888888888",
      brokerOrderId:
        input.brokerOrderId === undefined
          ? "robinhood-order-entry-1"
          : input.brokerOrderId,
      brokerOrderState: "confirmed",
      contractSnapshot: {
        contractSymbol: "O:AAPL260821C00210000",
        occSymbol: "AAPL  260821C00210000",
        multiplier: 100,
        sharesPerContract: 100,
        chainSymbol: "AAPL",
        underlyingType: "equity",
        expiration: "2026-08-21",
        strike: 210,
        optionType: "Call",
      },
      orderSnapshot: {
        strategyPositionKey: "position:AAPL:new",
        side: "Buy",
        positionEffect: "Open",
        orderType: "Limit",
        timeInForce: "Day",
        marketHours: "regular_hours",
        quantity: 2,
        requestedQuantity: 10,
        limitPrice: 2.5,
        stopPrice: null,
        platformCaps: {
          maxContracts: 6,
          maxPremium: 1_000,
          maxBalanceAgeMs: 45_000,
          maxQuoteAgeMs: 15_000,
        },
      },
      requestedQuantity: "2.000000",
      filledQuantity: "0.000000",
      premiumAtRisk: "500.000000",
      occurredAt: new Date("2026-07-21T20:59:00.000Z"),
    })
    .returning();
  return {
    owner: owner!,
    deployment: deployment!,
    account: account!,
    target: target!,
    execution: execution!,
  };
}

function providerOrder(input: {
  fixture: Awaited<ReturnType<typeof seedReconciliationFixture>>;
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
        id: "robinhood-order-entry-1",
        chainSymbol: "AAPL",
        state: input.state,
        orderType: "Limit",
        quantity: 2,
        processedQuantity: input.processedQuantity,
        price: 2.5,
        stopPrice: null,
        createdAt: "2026-07-21T20:59:05.000Z",
      },
    ],
  };
}

function providerPosition(input: {
  fixture: Awaited<ReturnType<typeof seedReconciliationFixture>>;
  quantity: number;
}) {
  return {
    accountId: input.fixture.account.id,
    symbol: "AAPL",
    assetClass: "option" as const,
    quantity: input.quantity,
    optionContract: {
      ticker: "robinhood-option-aapl-210-call",
      underlying: "AAPL",
      expirationDate: new Date("2026-08-21T00:00:00.000Z"),
      strike: 210,
      right: "call" as const,
      multiplier: 100,
      sharesPerContract: 100,
      providerContractId: "robinhood-option-aapl-210-call",
      brokerContractId: "robinhood-option-aapl-210-call",
    },
  };
}

test("Robinhood reconciliation creates an algo position only after a proven fill", async () => {
  await withTestDb(async () => {
    const fixture = await seedReconciliationFixture();
    let orderReads = 0;
    let positionReads = 0;
    const dependencies: ReconcileAlgoRobinhoodOptionEntryDependencies = {
      now: () => NOW,
      loadOrders: async () => {
        orderReads += 1;
        return providerOrder({
          fixture,
          state: "filled",
          processedQuantity: 2,
        });
      },
      loadPositions: async (input) => {
        positionReads += 1;
        assert.equal(input.accountNumber, "246813579");
        return [providerPosition({ fixture, quantity: 2 })];
      },
    };

    const filled = await reconcileAlgoRobinhoodOptionEntry(
      {
        appUserId: fixture.owner.id,
        executionId: fixture.execution.id,
      },
      dependencies,
    );
    const retry = await reconcileAlgoRobinhoodOptionEntry(
      {
        appUserId: fixture.owner.id,
        executionId: fixture.execution.id,
      },
      dependencies,
    );

    assert.equal(filled.status, "filled");
    assert.equal(filled.filledQuantity, "2.000000");
    assert.equal(retry.status, "filled");
    assert.equal(orderReads, 1);
    assert.equal(positionReads, 1);
    const [position] = await db.select().from(algoTargetPositionsTable);
    assert.equal(position?.strategyPositionKey, "position:AAPL:new");
    assert.equal(
      position?.providerPositionId,
      "robinhood-option-aapl-210-call",
    );
    assert.equal(position?.quantity, "2.000000");
    assert.equal(position?.premiumBasis, "500.000000");
    assert.equal(position?.status, "open");
    assert.equal(position?.lastReconciledAt?.toISOString(), NOW.toISOString());
  });
});

test("Robinhood reconciliation tracks a partial fill without freeing the execution fence", async () => {
  await withTestDb(async () => {
    const fixture = await seedReconciliationFixture();
    let filledQuantity = 1;
    let state = "confirmed";
    const dependencies: ReconcileAlgoRobinhoodOptionEntryDependencies = {
      now: () => NOW,
      loadOrders: async () =>
        providerOrder({ fixture, state, processedQuantity: filledQuantity }),
      loadPositions: async () => [
        providerPosition({ fixture, quantity: filledQuantity }),
      ],
    };

    const partial = await reconcileAlgoRobinhoodOptionEntry(
      {
        appUserId: fixture.owner.id,
        executionId: fixture.execution.id,
      },
      dependencies,
    );
    assert.equal(partial.status, "submitted");
    assert.equal(partial.filledQuantity, "1.000000");
    let [position] = await db.select().from(algoTargetPositionsTable);
    assert.equal(position?.status, "opening");
    assert.equal(position?.quantity, "1.000000");
    assert.equal(position?.premiumBasis, "250.000000");

    filledQuantity = 2;
    state = "filled";
    const full = await reconcileAlgoRobinhoodOptionEntry(
      {
        appUserId: fixture.owner.id,
        executionId: fixture.execution.id,
      },
      dependencies,
    );
    assert.equal(full.status, "filled");
    [position] = await db.select().from(algoTargetPositionsTable);
    assert.equal(position?.status, "open");
    assert.equal(position?.quantity, "2.000000");
    assert.equal(position?.premiumBasis, "500.000000");
  });
});

test("Robinhood reconciliation keeps missing broker ids unresolved without heuristic matching", async () => {
  await withTestDb(async () => {
    const fixture = await seedReconciliationFixture({
      brokerOrderId: null,
      status: "reconciliation_required",
    });
    let providerReads = 0;
    const result = await reconcileAlgoRobinhoodOptionEntry(
      {
        appUserId: fixture.owner.id,
        executionId: fixture.execution.id,
      },
      {
        now: () => NOW,
        loadOrders: async () => {
          providerReads += 1;
          throw new Error("ref-id lookup is not provider-supported");
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
    assert.equal((await db.select().from(algoTargetPositionsTable)).length, 0);
  });
});

test("Robinhood reconciliation rejects a provider position that cannot cover algo attribution", async () => {
  await withTestDb(async () => {
    const fixture = await seedReconciliationFixture();
    await db.insert(algoTargetPositionsTable).values({
      appUserId: fixture.owner.id,
      deploymentId: fixture.deployment.id,
      targetId: fixture.target.id,
      strategyPositionKey: "position:AAPL:existing",
      symbol: "AAPL",
      providerPositionId: "robinhood-option-aapl-210-call",
      contractSnapshot: fixture.execution.contractSnapshot,
      quantity: "1.000000",
      premiumBasis: "250.000000",
      status: "open",
      openedAt: new Date("2026-07-21T20:00:00.000Z"),
      lastReconciledAt: new Date("2026-07-21T20:30:00.000Z"),
    });

    const result = await reconcileAlgoRobinhoodOptionEntry(
      {
        appUserId: fixture.owner.id,
        executionId: fixture.execution.id,
      },
      {
        now: () => NOW,
        loadOrders: async () =>
          providerOrder({ fixture, state: "filled", processedQuantity: 2 }),
        loadPositions: async () => [providerPosition({ fixture, quantity: 2 })],
      },
    );
    assert.equal(result.status, "reconciliation_required");
    assert.equal(
      result.errorCode,
      "algo_provider_position_attribution_invalid",
    );
    assert.equal((await db.select().from(algoTargetPositionsTable)).length, 1);
  });
});

test("Robinhood reconciliation never reopens a closed strategy-position identity", async () => {
  await withTestDb(async () => {
    const fixture = await seedReconciliationFixture();
    await db.insert(algoTargetPositionsTable).values({
      appUserId: fixture.owner.id,
      deploymentId: fixture.deployment.id,
      targetId: fixture.target.id,
      strategyPositionKey: "position:AAPL:new",
      symbol: "AAPL",
      providerPositionId: "robinhood-option-aapl-210-call",
      contractSnapshot: fixture.execution.contractSnapshot,
      quantity: "0.000000",
      premiumBasis: "500.000000",
      status: "closed",
      openedAt: new Date("2026-07-21T20:00:00.000Z"),
      closedAt: new Date("2026-07-21T20:30:00.000Z"),
      lastReconciledAt: new Date("2026-07-21T20:30:00.000Z"),
    });

    const result = await reconcileAlgoRobinhoodOptionEntry(
      {
        appUserId: fixture.owner.id,
        executionId: fixture.execution.id,
      },
      {
        now: () => NOW,
        loadOrders: async () =>
          providerOrder({ fixture, state: "filled", processedQuantity: 2 }),
        loadPositions: async () => [providerPosition({ fixture, quantity: 2 })],
      },
    );
    assert.equal(result.status, "reconciliation_required");
    assert.equal(
      result.errorCode,
      "algo_provider_position_attribution_invalid",
    );
    const [position] = await db.select().from(algoTargetPositionsTable);
    assert.equal(position?.status, "closed");
    assert.equal(position?.quantity, "0.000000");
  });
});
