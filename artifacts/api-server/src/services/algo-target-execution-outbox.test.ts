import assert from "node:assert/strict";
import test from "node:test";

import {
  algoAccountControlsTable,
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

import {
  reserveAlgoTargetExecution,
  type ReserveAlgoTargetExecutionInput,
} from "./algo-target-execution-outbox";

async function seedOutboxFixture() {
  const [owner] = await db
    .insert(usersTable)
    .values({
      email: "algo-outbox-owner@example.com",
      passwordHash: "unused",
      role: "admin",
    })
    .returning();
  const [other] = await db
    .insert(usersTable)
    .values({
      email: "algo-outbox-other@example.com",
      passwordHash: "unused",
      role: "admin",
    })
    .returning();
  const [strategy] = await db
    .insert(algoStrategiesTable)
    .values({
      name: "Outbox strategy",
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
      name: "Outbox deployment",
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
      name: "Outbox Robinhood",
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
      providerAccountId: "robinhood:123456789",
      displayName: "Agentic",
      mode: "live",
    })
    .returning();
  const [target] = await db
    .insert(algoDeploymentTargetsTable)
    .values({
      deploymentId: deployment!.id,
      brokerAccountId: account!.id,
      lifecycle: "active",
      allocationPercent: "20.00",
      allowanceUnit: "usd",
      allowanceValue: "1000.000000",
      executionEnabled: true,
    })
    .returning();
  await db.insert(algoAccountControlsTable).values({
    appUserId: owner!.id,
    brokerAccountId: account!.id,
    hardCeilingPercent: "50.00",
    totalAlgoAllowanceUnit: "usd",
    totalAlgoAllowanceValue: "1000.000000",
  });
  const [sourceEvent] = await db
    .insert(executionEventsTable)
    .values({
      deploymentId: deployment!.id,
      providerAccountId: account!.providerAccountId,
      symbol: "AAPL",
      eventType: "signal_options_entry_decision",
      summary: "Signal Options entry decision",
      payload: { strategyPositionKey: "position:AAPL:1" },
    })
    .returning();
  return {
    owner: owner!,
    other: other!,
    strategy: strategy!,
    deployment: deployment!,
    account: account!,
    target: target!,
    sourceEvent: sourceEvent!,
  };
}

function reservationInput(
  fixture: Awaited<ReturnType<typeof seedOutboxFixture>>,
  overrides:
    | Partial<
        Extract<ReserveAlgoTargetExecutionInput, { action: "entry" }>
      >
    | ({ action: "exit" } & Partial<
        Omit<
          Extract<ReserveAlgoTargetExecutionInput, { action: "exit" }>,
          "action"
        >
      >) = {},
): ReserveAlgoTargetExecutionInput {
  const base = {
    appUserId: fixture.owner.id,
    deploymentId: fixture.deployment.id,
    targetId: fixture.target.id,
    sourceEventId: fixture.sourceEvent.id,
    actionIdentity: "position:AAPL:1",
    contractSnapshot: {
      occSymbol: "AAPL  260821C00210000",
      multiplier: 100,
    },
    orderSnapshot: {
      side: "Buy",
      positionEffect: "Open",
      orderType: "Limit",
      limitPrice: 2.5,
    },
    requestedQuantity: 2,
    occurredAt: new Date("2026-07-21T20:00:00.000Z"),
  };
  if (overrides.action === "exit") {
    return {
      ...base,
      premiumAtRisk: null,
      ...overrides,
      action: "exit",
    };
  }
  return {
    ...base,
    action: "entry",
    premiumAtRisk: 500,
    entryAdmission: {
      netLiquidation: 10_000,
      buyingPower: 4_000,
      observedAt: new Date("2026-07-21T19:59:45.000Z"),
      maxCapitalAgeMs: 45_000,
    },
    ...overrides,
  };
}

test("target outbox reservation is deterministic and idempotent", async () => {
  await withTestDb(async () => {
    const fixture = await seedOutboxFixture();
    const first = await reserveAlgoTargetExecution(reservationInput(fixture));
    const second = await reserveAlgoTargetExecution(reservationInput(fixture));

    assert.equal(first.id, second.id);
    assert.equal(first.executionKey, second.executionKey);
    assert.equal(first.clientOrderId, second.clientOrderId);
    assert.match(
      first.clientOrderId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    assert.equal(first.status, "pending");
    assert.equal(first.requestedQuantity, "2.000000");
    assert.equal(first.premiumAtRisk, "500.000000");
    assert.equal((await db.select().from(algoTargetExecutionsTable)).length, 1);
  });
});

test("one broker account cannot reserve concurrent unresolved entries", async () => {
  await withTestDb(async () => {
    const fixture = await seedOutboxFixture();
    const [secondDeployment] = await db
      .insert(algoDeploymentsTable)
      .values({
        appUserId: fixture.owner.id,
        strategyId: fixture.strategy.id,
        name: "Second outbox deployment",
        mode: "live",
        enabled: true,
        isDraft: false,
        symbolUniverse: ["MSFT"],
        config: { parameters: { executionMode: "signal_options" } },
      })
      .returning();
    const [secondTarget] = await db
      .insert(algoDeploymentTargetsTable)
      .values({
        deploymentId: secondDeployment!.id,
        brokerAccountId: fixture.account.id,
        lifecycle: "active",
        allocationPercent: "20.00",
        allowanceUnit: "percent",
        allowanceValue: "20.000000",
        executionEnabled: true,
      })
      .returning();
    const [secondSourceEvent] = await db
      .insert(executionEventsTable)
      .values({
        deploymentId: secondDeployment!.id,
        providerAccountId: fixture.account.providerAccountId,
        symbol: "MSFT",
        eventType: "signal_options_entry_decision",
        summary: "Second Signal Options entry decision",
        payload: { strategyPositionKey: "position:MSFT:2" },
      })
      .returning();

    const results = await Promise.allSettled([
      reserveAlgoTargetExecution(reservationInput(fixture)),
      reserveAlgoTargetExecution(
        reservationInput(fixture, {
          deploymentId: secondDeployment!.id,
          targetId: secondTarget!.id,
          sourceEventId: secondSourceEvent!.id,
          actionIdentity: "position:MSFT:2",
          contractSnapshot: {
            occSymbol: "MSFT  260821C00500000",
            multiplier: 100,
          },
        }),
      ),
    ]);

    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    const rejected = results.find((result) => result.status === "rejected");
    assert.equal(rejected?.status, "rejected");
    assert.equal(
      (rejected as PromiseRejectedResult).reason?.code,
      "algo_broker_mutation_unresolved",
    );
    assert.equal((await db.select().from(algoTargetExecutionsTable)).length, 1);
  });
});

test("final reservation rechecks shared cross-deployment exposure under the account lock", async () => {
  await withTestDb(async () => {
    const fixture = await seedOutboxFixture();
    const [secondDeployment] = await db
      .insert(algoDeploymentsTable)
      .values({
        appUserId: fixture.owner.id,
        strategyId: fixture.strategy.id,
        name: "Shared pool neighbor",
        mode: "live",
        enabled: true,
        isDraft: false,
        symbolUniverse: ["MSFT"],
        config: { parameters: { executionMode: "signal_options" } },
      })
      .returning();
    const [secondTarget] = await db
      .insert(algoDeploymentTargetsTable)
      .values({
        deploymentId: secondDeployment!.id,
        brokerAccountId: fixture.account.id,
        lifecycle: "active",
        allowanceUnit: "usd",
        allowanceValue: "1000.000000",
        executionEnabled: true,
      })
      .returning();
    const [position] = await db
      .insert(algoTargetPositionsTable)
      .values({
        appUserId: fixture.owner.id,
        deploymentId: secondDeployment!.id,
        targetId: secondTarget!.id,
        strategyPositionKey: "position:MSFT:shared",
        symbol: "MSFT",
        contractSnapshot: { occSymbol: "MSFT  260821C00500000" },
        quantity: "1.000000",
        premiumBasis: "600.000000",
        status: "open",
        openedAt: new Date("2026-07-21T18:00:00.000Z"),
      })
      .returning();

    await assert.rejects(
      reserveAlgoTargetExecution(reservationInput(fixture)),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "algo_entry_cap_exhausted");
        return true;
      },
    );
    assert.equal((await db.select().from(algoTargetExecutionsTable)).length, 0);

    await db
      .update(algoTargetPositionsTable)
      .set({ status: "closed", closedAt: new Date("2026-07-21T19:00:00.000Z") })
      .where(eq(algoTargetPositionsTable.id, position!.id));
    const reserved = await reserveAlgoTargetExecution(reservationInput(fixture));
    assert.equal(reserved.status, "pending");
  });
});

test("target outbox rejects cross-owner access and payload drift", async () => {
  await withTestDb(async () => {
    const fixture = await seedOutboxFixture();
    await assert.rejects(
      reserveAlgoTargetExecution(
        reservationInput(fixture, { appUserId: fixture.other.id }),
      ),
      (error: unknown) => {
        assert.equal((error as { statusCode?: number }).statusCode, 403);
        assert.equal(
          (error as { code?: string }).code,
          "algo_deployment_forbidden",
        );
        return true;
      },
    );

    await reserveAlgoTargetExecution(reservationInput(fixture));
    await assert.rejects(
      reserveAlgoTargetExecution(
        reservationInput(fixture, { requestedQuantity: 1 }),
      ),
      (error: unknown) => {
        assert.equal((error as { statusCode?: number }).statusCode, 409);
        assert.equal(
          (error as { code?: string }).code,
          "algo_target_execution_conflict",
        );
        return true;
      },
    );
  });
});

test("draining targets reject entries but retain exit reservations", async () => {
  await withTestDb(async () => {
    const fixture = await seedOutboxFixture();
    await db
      .update(algoDeploymentTargetsTable)
      .set({ lifecycle: "draining" })
      .where(eq(algoDeploymentTargetsTable.id, fixture.target.id));

    await assert.rejects(
      reserveAlgoTargetExecution(reservationInput(fixture)),
      (error: unknown) => {
        assert.equal(
          (error as { code?: string }).code,
          "algo_target_lifecycle_blocked",
        );
        return true;
      },
    );

    const exit = await reserveAlgoTargetExecution(
      reservationInput(fixture, {
        action: "exit",
        actionIdentity: "position:AAPL:1:full-close",
        orderSnapshot: {
          side: "Sell",
          positionEffect: "Close",
          orderType: "Limit",
          limitPrice: 3,
        },
        requestedQuantity: 1,
        premiumAtRisk: null,
      }),
    );
    assert.equal(exit.action, "exit");
  });
});

test("staged targets reject entry reservations but retain protective exits", async () => {
  await withTestDb(async () => {
    const fixture = await seedOutboxFixture();
    await db
      .update(algoDeploymentTargetsTable)
      .set({ executionEnabled: false })
      .where(eq(algoDeploymentTargetsTable.id, fixture.target.id));

    await assert.rejects(
      reserveAlgoTargetExecution(reservationInput(fixture)),
      (error: unknown) => {
        assert.equal(
          (error as { code?: string }).code,
          "algo_target_execution_disabled",
        );
        return true;
      },
    );

    const exit = await reserveAlgoTargetExecution(
      reservationInput(fixture, {
        action: "exit",
        actionIdentity: "position:AAPL:1:protective-close",
        orderSnapshot: {
          side: "Sell",
          positionEffect: "Close",
          orderType: "Limit",
          limitPrice: 3,
        },
        requestedQuantity: 1,
        premiumAtRisk: null,
      }),
    );
    assert.equal(exit.action, "exit");
  });
});

test("a target cannot reserve overlapping unresolved exits", async () => {
  await withTestDb(async () => {
    const fixture = await seedOutboxFixture();
    const first = await reserveAlgoTargetExecution(
      reservationInput(fixture, {
        action: "exit",
        actionIdentity: "position:AAPL:1:first-close",
        orderSnapshot: {
          side: "Sell",
          positionEffect: "Close",
          orderType: "Limit",
          limitPrice: 3,
        },
        requestedQuantity: 1,
        premiumAtRisk: null,
      }),
    );

    await assert.rejects(
      reserveAlgoTargetExecution(
        reservationInput(fixture, {
          action: "exit",
          actionIdentity: "position:AAPL:1:second-close",
          orderSnapshot: {
            side: "Sell",
            positionEffect: "Close",
            orderType: "Limit",
            limitPrice: 3.1,
          },
          requestedQuantity: 1,
          premiumAtRisk: null,
        }),
      ),
      (error: unknown) => {
        assert.equal((error as { statusCode?: number }).statusCode, 409);
        assert.equal(
          (error as { code?: string }).code,
          "algo_target_close_conflict",
        );
        return true;
      },
    );

    await db
      .update(algoTargetExecutionsTable)
      .set({ status: "filled", filledQuantity: "1.000000" })
      .where(eq(algoTargetExecutionsTable.id, first.id));
    const next = await reserveAlgoTargetExecution(
      reservationInput(fixture, {
        action: "exit",
        actionIdentity: "position:AAPL:1:second-close",
        orderSnapshot: {
          side: "Sell",
          positionEffect: "Close",
          orderType: "Limit",
          limitPrice: 3.1,
        },
        requestedQuantity: 1,
        premiumAtRisk: null,
      }),
    );
    assert.equal(next.status, "pending");
  });
});
