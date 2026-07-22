import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import type { AddressInfo } from "node:net";

import {
  algoDeploymentsTable,
  algoStrategiesTable,
  brokerAccountsTable,
  brokerConnectionsTable,
  db,
  shadowAccountsTable,
  usersTable,
} from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";
import { eq } from "drizzle-orm";

import app from "../app";
import { createAuthSession } from "../services/auth";
import { AUTH_CSRF_HEADER } from "./auth";

async function withServer<T>(fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  try {
    return await fn(`http://127.0.0.1:${address.port}/api`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

async function seedUser(
  label: string,
  role: "admin" | "member" = "member",
) {
  const [user] = await db
    .insert(usersTable)
    .values({
      email: `${label}@example.com`,
      passwordHash: "unused",
      role,
    })
    .returning();
  const session = await createAuthSession({ userId: user!.id });
  return {
    id: user!.id,
    cookie: `pyrus_session=${session.sessionToken}`,
    csrfToken: session.csrfToken,
  };
}

async function seedShadowAccount(appUserId: string, label: string) {
  const [account] = await db
    .insert(shadowAccountsTable)
    .values({
      id: `shadow-${label}`,
      appUserId,
      displayName: `${label} Shadow`,
      startingBalance: "100000",
      cash: "100000",
      status: "active",
    })
    .returning();
  return account!;
}

async function seedOptionsStrategy(label: string) {
  const [strategy] = await db
    .insert(algoStrategiesTable)
    .values({
      name: `${label} strategy`,
      mode: "shadow",
      enabled: true,
      symbolUniverse: ["AAPL"],
      config: { parameters: { executionMode: "signal_options" } },
    })
    .returning();
  return strategy!;
}

async function seedRobinhoodAccount(input: {
  appUserId: string;
  label: string;
  ready: boolean;
}) {
  const [connection] = await db
    .insert(brokerConnectionsTable)
    .values({
      appUserId: input.appUserId,
      name: `${input.label} connection`,
      connectionType: "broker",
      brokerProvider: "robinhood",
      mode: "live",
      status: "connected",
      capabilities: ["accounts", "positions"],
    })
    .returning();
  const [account] = await db
    .insert(brokerAccountsTable)
    .values({
      appUserId: input.appUserId,
      connectionId: connection!.id,
      providerAccountId: `robinhood:${input.label}`,
      displayName: input.label,
      mode: "live",
      accountStatus: "open",
      includedInTrading: true,
      capabilities: input.ready
        ? [
            "accounts",
            "positions",
            "robinhood-agentic",
            "execution-ready",
            "robinhood-option-level:option_level_2",
          ]
        : ["accounts", "positions", "robinhood"],
      executionBlockers: input.ready
        ? []
        : ["robinhood.account.non_agentic"],
    })
    .returning();
  return account!;
}

function writeHeaders(user: { cookie: string; csrfToken: string }) {
  return {
    cookie: user.cookie,
    "content-type": "application/json",
    [AUTH_CSRF_HEADER]: user.csrfToken,
  };
}

test("owner CRUD routes preserve a zero-account draft and deny a sibling owner", async () => {
  await withTestDb(async () =>
    withServer(async (baseUrl) => {
      const owner = await seedUser("route-owner");
      const other = await seedUser("route-other");
      const strategy = await seedOptionsStrategy("route-draft");

      const createResponse = await fetch(`${baseUrl}/algo/deployments`, {
        method: "POST",
        headers: writeHeaders(owner),
        body: JSON.stringify({
          strategyId: strategy.id,
          name: "Route draft",
          mode: "shadow",
        }),
      });
      assert.equal(createResponse.status, 201);
      const created = (await createResponse.json()) as {
        id: string;
        isDraft: boolean;
        targets: unknown[];
      };
      assert.equal(created.isDraft, true);
      assert.deepEqual(created.targets, []);

      const listResponse = await fetch(`${baseUrl}/algo/deployments`, {
        headers: { cookie: owner.cookie },
      });
      assert.equal(listResponse.status, 200);
      const listed = (await listResponse.json()) as {
        deployments: Array<{ id: string }>;
      };
      assert.equal(listed.deployments.some((row) => row.id === created.id), true);

      const denied = await fetch(
        `${baseUrl}/algo/deployments/${created.id}`,
        { headers: { cookie: other.cookie } },
      );
      assert.equal(denied.status, 403);
      assert.equal(
        ((await denied.json()) as { code?: string }).code,
        "algo_deployment_forbidden",
      );

      const patchResponse = await fetch(
        `${baseUrl}/algo/deployments/${created.id}`,
        {
          method: "PATCH",
          headers: writeHeaders(owner),
          body: JSON.stringify({ name: "Route reviewed", isDraft: false }),
        },
      );
      assert.equal(patchResponse.status, 200);
      assert.equal(
        ((await patchResponse.json()) as { name?: string }).name,
        "Route reviewed",
      );

      const archiveResponse = await fetch(
        `${baseUrl}/algo/deployments/${created.id}/archive`,
        { method: "POST", headers: writeHeaders(owner), body: "{}" },
      );
      assert.equal(archiveResponse.status, 200);
      assert.ok(
        ((await archiveResponse.json()) as { archivedAt?: string }).archivedAt,
      );

      const restoreResponse = await fetch(
        `${baseUrl}/algo/deployments/${created.id}/restore`,
        { method: "POST", headers: writeHeaders(owner), body: "{}" },
      );
      assert.equal(restoreResponse.status, 200);
      assert.equal(
        ((await restoreResponse.json()) as { archivedAt?: string | null })
          .archivedAt,
        null,
      );
    }),
  );
});

test("target Apply route returns independent account results and choices retain blockers", async () => {
  await withTestDb(async () =>
    withServer(async (baseUrl) => {
      const owner = await seedUser("route-target-owner");
      const strategy = await seedOptionsStrategy("route-target");
      const ready = await seedRobinhoodAccount({
        appUserId: owner.id,
        label: "Agentic route",
        ready: true,
      });
      const blocked = await seedRobinhoodAccount({
        appUserId: owner.id,
        label: "Personal route",
        ready: false,
      });
      const createResponse = await fetch(`${baseUrl}/algo/deployments`, {
        method: "POST",
        headers: writeHeaders(owner),
        body: JSON.stringify({
          strategyId: strategy.id,
          name: "Route live draft",
          mode: "live",
        }),
      });
      const deployment = (await createResponse.json()) as { id: string };

      const legacyApplyResponse = await fetch(
        `${baseUrl}/algo/deployments/${deployment.id}/targets/apply`,
        {
          method: "POST",
          headers: writeHeaders(owner),
          body: JSON.stringify({
            changes: [
              {
                accountType: "broker",
                accountId: ready.id,
                action: "upsert",
                allocationPercent: 25,
                hardCeilingPercent: 40,
              },
            ],
          }),
        },
      );
      assert.equal(legacyApplyResponse.status, 400);
      assert.equal(
        ((await legacyApplyResponse.json()) as { code?: string }).code,
        "algo_allowance_legacy_write_unsupported",
      );

      const applyResponse = await fetch(
        `${baseUrl}/algo/deployments/${deployment.id}/targets/apply`,
        {
          method: "POST",
          headers: writeHeaders(owner),
          body: JSON.stringify({
            changes: [
              {
                accountType: "broker",
                accountId: ready.id,
                action: "upsert",
                allowance: { unit: "percent", value: 25 },
                totalAlgoAllowance: { unit: "percent", value: 40 },
                accountDailyLossLimit: { unit: "usd", value: 750 },
              },
              {
                accountType: "broker",
                accountId: blocked.id,
                action: "upsert",
                allowance: { unit: "usd", value: 1_000 },
                totalAlgoAllowance: { unit: "usd", value: 4_000 },
              },
              {
                accountType: "broker",
                accountId: "00000000-0000-4000-8000-000000000001",
                action: "upsert",
                allowance: { unit: "usd", value: 500 },
                totalAlgoAllowance: { unit: "usd", value: 2_000 },
              },
            ],
          }),
        },
      );
      assert.equal(applyResponse.status, 200);
      const result = (await applyResponse.json()) as {
        succeeded: Array<{
          accountId: string;
          target: {
            accountDailyLossLimit: {
              unit: "usd";
              value: number;
              scope: string;
              timezone: string;
            } | null;
          };
        }>;
        failed: Array<{ accountId: string; code: string }>;
      };
      assert.deepEqual(result.succeeded.map((row) => row.accountId), [
        ready.id,
        blocked.id,
      ]);
      assert.deepEqual(result.failed, [
        {
          accountId: "00000000-0000-4000-8000-000000000001",
          code: "algo_target_account_not_found",
          message: "Broker account not found.",
        },
      ]);
      assert.deepEqual(result.succeeded[0]?.target.accountDailyLossLimit, {
        unit: "usd",
        value: 750,
        scope: "account_options_realized",
        timezone: "America/New_York",
      });

      const choicesResponse = await fetch(
        `${baseUrl}/algo/deployment-accounts?strategyKind=options`,
        { headers: { cookie: owner.cookie } },
      );
      assert.equal(choicesResponse.status, 200);
      const choices = (await choicesResponse.json()) as {
        accounts: Array<{
          accountId: string;
          available: boolean;
          configurable: boolean;
          activationReady: boolean;
          adapterImplemented: boolean;
          technicalReady: boolean;
          activationReleased: boolean;
          blockers: string[];
          activationBlockers: string[];
          accountDailyLossLimit: {
            unit: "usd";
            value: number;
            scope: string;
            timezone: string;
          } | null;
        }>;
      };
      assert.deepEqual(
        choices.accounts.find((account) => account.accountId === blocked.id),
        {
          accountType: "broker",
          accountId: blocked.id,
          providerAccountId: blocked.providerAccountId,
          provider: "robinhood",
          displayName: blocked.displayName,
          mode: "live",
          includedInTrading: true,
          configurable: true,
          activationReady: false,
          adapterImplemented: true,
          technicalReady: true,
          activationReleased: true,
          totalAlgoAllowance: { unit: "usd", value: 4_000 },
          accountDailyLossLimit: null,
          linkedDeploymentIds: [deployment.id],
          available: true,
          blockers: [
            "robinhood.account.non_agentic",
            "algo.account.daily_loss_limit_required",
          ],
          activationBlockers: [
            "robinhood.account.non_agentic",
            "algo.account.daily_loss_limit_required",
          ],
        },
      );
    }),
  );
});

test("compatibility enable and mode commands cannot mutate a sibling owner's deployment", async () => {
  await withTestDb(async () =>
    withServer(async (baseUrl) => {
      const owner = await seedUser("route-command-owner", "admin");
      const sibling = await seedUser("route-command-sibling", "admin");
      const strategy = await seedOptionsStrategy("route-command");
      const shadow = await seedShadowAccount(owner.id, "route-command");

      const createResponse = await fetch(`${baseUrl}/algo/deployments`, {
        method: "POST",
        headers: writeHeaders(owner),
        body: JSON.stringify({
          strategyId: strategy.id,
          name: "Owner-scoped command deployment",
          mode: "shadow",
        }),
      });
      assert.equal(createResponse.status, 201);
      const deployment = (await createResponse.json()) as { id: string };

      const applyResponse = await fetch(
        `${baseUrl}/algo/deployments/${deployment.id}/targets/apply`,
        {
          method: "POST",
          headers: writeHeaders(owner),
          body: JSON.stringify({
            changes: [
              {
                accountType: "shadow",
                accountId: shadow.id,
                action: "upsert",
                allowance: { unit: "usd", value: 10_000 },
              },
            ],
          }),
        },
      );
      assert.equal(applyResponse.status, 200);

      const readyResponse = await fetch(
        `${baseUrl}/algo/deployments/${deployment.id}`,
        {
          method: "PATCH",
          headers: writeHeaders(owner),
          body: JSON.stringify({ isDraft: false }),
        },
      );
      assert.equal(readyResponse.status, 200);

      const deniedEnable = await fetch(
        `${baseUrl}/algo/deployments/${deployment.id}/enable`,
        { method: "POST", headers: writeHeaders(sibling), body: "{}" },
      );
      assert.equal(deniedEnable.status, 403);
      assert.equal(
        ((await deniedEnable.json()) as { code?: string }).code,
        "algo_deployment_forbidden",
      );

      const deniedMode = await fetch(
        `${baseUrl}/algo/deployments/${deployment.id}/mode`,
        {
          method: "POST",
          headers: writeHeaders(sibling),
          body: JSON.stringify({ mode: "live" }),
        },
      );
      assert.equal(deniedMode.status, 403);
      assert.equal(
        ((await deniedMode.json()) as { code?: string }).code,
        "algo_deployment_forbidden",
      );

      const deniedDeviation = await fetch(
        `${baseUrl}/algo/deployments/${deployment.id}/signal-options/deviation`,
        {
          method: "POST",
          headers: writeHeaders(sibling),
          body: JSON.stringify({
            candidateId: "candidate-owner-scope",
            symbol: "AAPL",
            changedFields: ["limitPrice"],
          }),
        },
      );
      assert.equal(deniedDeviation.status, 403);
      assert.equal(
        ((await deniedDeviation.json()) as { code?: string }).code,
        "algo_deployment_forbidden",
      );

      const enableResponse = await fetch(
        `${baseUrl}/algo/deployments/${deployment.id}/enable`,
        { method: "POST", headers: writeHeaders(owner), body: "{}" },
      );
      assert.equal(enableResponse.status, 200);
      assert.equal(
        ((await enableResponse.json()) as { enabled?: boolean }).enabled,
        true,
      );

      const pauseResponse = await fetch(
        `${baseUrl}/algo/deployments/${deployment.id}/pause`,
        { method: "POST", headers: writeHeaders(owner), body: "{}" },
      );
      assert.equal(pauseResponse.status, 200);
      assert.equal(
        ((await pauseResponse.json()) as { enabled?: boolean }).enabled,
        false,
      );
    }),
  );
});

test("live activation route arms the explicitly selected reviewed Robinhood target", async () => {
  await withTestDb(async () =>
    withServer(async (baseUrl) => {
      const owner = await seedUser("route-live-activation-owner", "admin");
      const strategy = await seedOptionsStrategy("route-live-activation");
      const account = await seedRobinhoodAccount({
        appUserId: owner.id,
        label: "Agentic activation",
        ready: true,
      });
      const createResponse = await fetch(`${baseUrl}/algo/deployments`, {
        method: "POST",
        headers: writeHeaders(owner),
        body: JSON.stringify({
          strategyId: strategy.id,
          name: "Atomic live activation",
          mode: "shadow",
        }),
      });
      assert.equal(createResponse.status, 201);
      const deployment = (await createResponse.json()) as { id: string };

      const applyResponse = await fetch(
        `${baseUrl}/algo/deployments/${deployment.id}/targets/apply`,
        {
          method: "POST",
          headers: writeHeaders(owner),
          body: JSON.stringify({
            changes: [
              {
                accountType: "broker",
                accountId: account.id,
                action: "upsert",
                allowance: { unit: "percent", value: 100 },
                totalAlgoAllowance: { unit: "percent", value: 100 },
                accountDailyLossLimit: { unit: "usd", value: 1_000 },
              },
            ],
          }),
        },
      );
      assert.equal(applyResponse.status, 200);
      const applied = (await applyResponse.json()) as {
        succeeded: Array<{ target: { id: string; executionEnabled: boolean } }>;
      };
      assert.equal(applied.succeeded[0]?.target.executionEnabled, false);
      const targetId = applied.succeeded[0]!.target.id;

      const reviewResponse = await fetch(
        `${baseUrl}/algo/deployments/${deployment.id}`,
        {
          method: "PATCH",
          headers: writeHeaders(owner),
          body: JSON.stringify({ isDraft: false }),
        },
      );
      assert.equal(reviewResponse.status, 200);

      const activationResponse = await fetch(
        `${baseUrl}/algo/deployments/${deployment.id}/activate-live`,
        {
          method: "POST",
          headers: writeHeaders(owner),
          body: JSON.stringify({ targetIds: [targetId] }),
        },
      );
      assert.equal(activationResponse.status, 200);
      const activated = (await activationResponse.json()) as {
        mode: string;
        enabled: boolean;
        providerAccountId: string | null;
        targets: Array<{ id: string; executionEnabled: boolean }>;
      };
      assert.equal(activated.mode, "live");
      assert.equal(activated.enabled, true);
      assert.equal(activated.providerAccountId, account.providerAccountId);
      assert.equal(
        activated.targets.find((target) => target.id === targetId)
          ?.executionEnabled,
        true,
      );
    }),
  );
});

test("enable fails closed for drafts and broker targets without safe live routing", async () => {
  await withTestDb(async () =>
    withServer(async (baseUrl) => {
      const owner = await seedUser("route-preflight-owner", "admin");
      const strategy = await seedOptionsStrategy("route-preflight");

      const draftResponse = await fetch(`${baseUrl}/algo/deployments`, {
        method: "POST",
        headers: writeHeaders(owner),
        body: JSON.stringify({
          strategyId: strategy.id,
          name: "Unready draft",
          mode: "shadow",
        }),
      });
      assert.equal(draftResponse.status, 201);
      const draft = (await draftResponse.json()) as { id: string };
      const draftEnable = await fetch(
        `${baseUrl}/algo/deployments/${draft.id}/enable`,
        { method: "POST", headers: writeHeaders(owner), body: "{}" },
      );
      assert.equal(draftEnable.status, 409);
      assert.equal(
        ((await draftEnable.json()) as { code?: string }).code,
        "algo_deployment_draft",
      );

      const account = await seedRobinhoodAccount({
        appUserId: owner.id,
        label: "Agentic preflight",
        ready: true,
      });
      const liveResponse = await fetch(`${baseUrl}/algo/deployments`, {
        method: "POST",
        headers: writeHeaders(owner),
        body: JSON.stringify({
          strategyId: strategy.id,
          name: "Live routing candidate",
          mode: "live",
        }),
      });
      assert.equal(liveResponse.status, 201);
      const live = (await liveResponse.json()) as { id: string };
      const applyResponse = await fetch(
        `${baseUrl}/algo/deployments/${live.id}/targets/apply`,
        {
          method: "POST",
          headers: writeHeaders(owner),
          body: JSON.stringify({
            changes: [
              {
                accountType: "broker",
                accountId: account.id,
                action: "upsert",
                allowance: { unit: "percent", value: 25 },
                totalAlgoAllowance: { unit: "percent", value: 40 },
              },
            ],
          }),
        },
      );
      assert.equal(applyResponse.status, 200);
      const readyResponse = await fetch(
        `${baseUrl}/algo/deployments/${live.id}`,
        {
          method: "PATCH",
          headers: writeHeaders(owner),
          body: JSON.stringify({ isDraft: false }),
        },
      );
      assert.equal(readyResponse.status, 200);

      const liveEnable = await fetch(
        `${baseUrl}/algo/deployments/${live.id}/enable`,
        { method: "POST", headers: writeHeaders(owner), body: "{}" },
      );
      assert.equal(liveEnable.status, 409);
      assert.equal(
        ((await liveEnable.json()) as { code?: string }).code,
        "algo_target_execution_disabled",
      );
      const [stored] = await db
        .select({ enabled: algoDeploymentsTable.enabled })
        .from(algoDeploymentsTable)
        .where(eq(algoDeploymentsTable.id, live.id));
      assert.equal(stored?.enabled, false);
    }),
  );
});
