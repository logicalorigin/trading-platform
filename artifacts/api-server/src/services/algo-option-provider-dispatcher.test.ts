import assert from "node:assert/strict";
import test from "node:test";

import {
  algoDeploymentTargetsTable,
  algoDeploymentsTable,
  algoStrategiesTable,
  brokerAccountsTable,
  brokerConnectionsTable,
  db,
  usersTable,
} from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";
import { eq } from "drizzle-orm";

import {
  authorizeAlgoOptionBrokerMutation,
  createDefaultAlgoOptionBrokerDispatcher,
} from "./algo-option-provider-dispatcher";

async function seedAuthorityFixture() {
  const [owner, other] = await db
    .insert(usersTable)
    .values([
      {
        email: "algo-provider-authority@example.com",
        passwordHash: "unused",
        role: "admin",
      },
      {
        email: "algo-provider-other@example.com",
        passwordHash: "unused",
        role: "admin",
      },
    ])
    .returning();
  const [strategy] = await db
    .insert(algoStrategiesTable)
    .values({
      name: "Provider authority",
      mode: "shadow",
      enabled: true,
      symbolUniverse: ["SPY"],
      config: {},
    })
    .returning();
  const [deployment] = await db
    .insert(algoDeploymentsTable)
    .values({
      appUserId: owner!.id,
      strategyId: strategy!.id,
      name: "Provider authority deployment",
      mode: "live",
      enabled: true,
      isDraft: false,
      symbolUniverse: ["SPY"],
      config: { parameters: { executionMode: "signal_options" } },
    })
    .returning();
  const [connection] = await db
    .insert(brokerConnectionsTable)
    .values({
      appUserId: owner!.id,
      name: "Provider authority Robinhood",
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
      providerAccountId: "robinhood:authority",
      displayName: "Authority account",
      mode: "live",
      includedInTrading: true,
      accountStatus: "open",
      executionBlockers: [],
    })
    .returning();
  const [target] = await db
    .insert(algoDeploymentTargetsTable)
    .values({
      deploymentId: deployment!.id,
      brokerAccountId: account!.id,
      lifecycle: "active",
      allowanceUnit: "usd",
      allowanceValue: "1000.000000",
      executionEnabled: false,
    })
    .returning();
  return {
    owner: owner!,
    other: other!,
    deployment: deployment!,
    account: account!,
    target: target!,
  };
}

test("persisted mutation authority rejects staged and cross-owner targets", async () => {
  await withTestDb(async () => {
    const fixture = await seedAuthorityFixture();
    const input = {
      provider: "robinhood" as const,
      appUserId: fixture.owner.id,
      accountId: fixture.account.id,
      deploymentId: fixture.deployment.id,
      targetId: fixture.target.id,
      action: "entry" as const,
    };

    await assert.rejects(authorizeAlgoOptionBrokerMutation(input), (error: unknown) => {
      assert.equal((error as { code?: string }).code, "algo_target_execution_disabled");
      return true;
    });
    await db
      .update(algoDeploymentTargetsTable)
      .set({ executionEnabled: true })
      .where(eq(algoDeploymentTargetsTable.id, fixture.target.id));
    await authorizeAlgoOptionBrokerMutation(input);

    await assert.rejects(
      authorizeAlgoOptionBrokerMutation({ ...input, appUserId: fixture.other.id }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "algo_target_forbidden");
        return true;
      },
    );
  });
});

test("protective exits remain authorized while a target drains", async () => {
  await withTestDb(async () => {
    const fixture = await seedAuthorityFixture();
    await db
      .update(algoDeploymentTargetsTable)
      .set({ lifecycle: "draining", executionEnabled: false })
      .where(eq(algoDeploymentTargetsTable.id, fixture.target.id));
    const context = {
      provider: "robinhood" as const,
      appUserId: fixture.owner.id,
      accountId: fixture.account.id,
      deploymentId: fixture.deployment.id,
      targetId: fixture.target.id,
    };

    await authorizeAlgoOptionBrokerMutation({ ...context, action: "exit" });
    await authorizeAlgoOptionBrokerMutation({ ...context, action: "cancel" });
    await assert.rejects(
      authorizeAlgoOptionBrokerMutation({ ...context, action: "entry" }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "algo_target_lifecycle_blocked");
        return true;
      },
    );
  });
});

test("default dispatcher releases only Robinhood", () => {
  const dispatcher = createDefaultAlgoOptionBrokerDispatcher();

  for (const provider of ["robinhood", "schwab", "snaptrade", "ibkr"] as const) {
    const description = dispatcher.describe(provider);
    assert.equal(description.adapterComplete, true);
    assert.equal(description.activationReleased, provider === "robinhood");
  }
});
