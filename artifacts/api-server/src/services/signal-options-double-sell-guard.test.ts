import assert from "node:assert/strict";
import test from "node:test";

import {
  db,
  executionEventsTable,
  shadowAccountsTable,
  shadowFillsTable,
  shadowOrdersTable,
  shadowPositionsTable,
  type ExecutionEvent,
} from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";
import { eq } from "drizzle-orm";
import { __signalOptionsAutomationInternalsForTests } from "./signal-options-automation";
import {
  __shadowWatchlistBacktestInternalsForTests as shadowInternals,
  placeShadowOrder,
  SHADOW_ACCOUNT_ID,
} from "./shadow-account";
import { createSignalOptionsWorker } from "./signal-options-worker";

// REAL-MONEY SCENARIO: double-sell after a process restart.
//
// tryClaimSignalOptionsPositionExit (signal-options-automation.ts) is the
// in-process race guard between the worker scan and the position tick
// manager, which both evaluate the same open positions with no shared lock
// (see the comment above signalOptionsClaimedExits in the source). The claim
// map is a plain in-memory Map keyed by "deploymentId:positionId" with a
// 10-minute TTL — it is NOT persisted, so a process restart wipes it exactly
// like calling __resetSignalOptionsClaimedExitsForTests().
//
// automation.test.ts (`a position's exit can only be claimed once`) already
// pins the claim/duplicate-claim/TTL-expiry behavior in the steady-state
// case. This file is scoped to the restart-adjacent gap that test leaves
// implicit in its trailing comment ("a real re-exit is still prevented by
// the persisted exit event") and pins the TWO things that actually matter
// for real money:
//   1. The claim map gives ZERO protection immediately after a restart
//      (no TTL wait is required — the map is just empty).
//   2. Persisted exit evidence suppresses later evaluations after commit, while
//      deterministic lifecycle event IDs cover the harder stale-read overlap.

const {
  insertSignalOptionsEventWithDependenciesForTests,
  signalOptionsLifecycleEventId,
  signalOptionsPositionExitClaimKey,
  terminalizeSignalOptionsReplayFailureForTests,
  tryClaimSignalOptionsPositionExit,
  __resetSignalOptionsClaimedExitsForTests,
} = __signalOptionsAutomationInternalsForTests;
const {
  repairSignalOptionsAutomationMirrorsForRead,
  signalOptionsShadowExitEventIsDuplicate,
} = shadowInternals;

const SIGNAL_OPTIONS_EXIT_CLAIM_TTL_MS = 10 * 60 * 1000;

test("order idempotency rejects an unrelated source-event owner without relabeling it", async () => {
  await withTestDb(async () => {
    const sourceEventId = "00000000-0000-4000-8000-000000000501";
    const existingOrderId = "00000000-0000-4000-8000-000000000502";
    const placedAt = new Date("2026-07-15T14:30:00.000Z");
    await db.insert(shadowAccountsTable).values({
      id: SHADOW_ACCOUNT_ID,
      displayName: "Shadow",
      startingBalance: "25000",
      cash: "25000",
    });
    await db.insert(shadowOrdersTable).values({
      id: existingOrderId,
      accountId: SHADOW_ACCOUNT_ID,
      source: "manual",
      sourceEventId,
      clientOrderId: "existing-buy",
      symbol: "CRM",
      assetClass: "equity",
      side: "buy",
      status: "filled",
      quantity: "1",
      filledQuantity: "1",
      averageFillPrice: "100",
      payload: { positionKey: "equity:CRM" },
      placedAt,
      filledAt: placedAt,
    });

    await assert.rejects(
      placeShadowOrder({
        symbol: "CRM",
        assetClass: "equity",
        optionContract: null,
        side: "sell",
        type: "limit",
        quantity: 1,
        limitPrice: 100,
        timeInForce: "day",
        source: "automation",
        sourceEventId,
        clientOrderId: "shadow-auto-exit-conflict",
        positionKey: "equity:CRM",
        requestedFillPrice: 100,
        placedAt,
      }),
      /idempotency conflict/u,
    );

    const [stored] = await db
      .select()
      .from(shadowOrdersTable)
      .where(eq(shadowOrdersTable.id, existingOrderId));
    assert.equal(stored?.side, "buy");
    assert.equal(stored?.source, "manual");
    assert.equal(stored?.clientOrderId, "existing-buy");
  });
});

test("a stale lifecycle entry cannot debit cash without mutating its position", async () => {
  await withTestDb(async () => {
    const staleAt = new Date("2026-07-15T14:30:00.000Z");
    const reopenedAt = new Date("2026-07-15T15:00:00.000Z");
    const positionKey = "equity:CRM";
    shadowInternals.invalidateShadowFreshStateCache();
    await db.insert(shadowAccountsTable).values({
      id: SHADOW_ACCOUNT_ID,
      displayName: "Shadow",
      startingBalance: "25000",
      cash: "25000",
    });
    const [position] = await db
      .insert(shadowPositionsTable)
      .values({
        accountId: SHADOW_ACCOUNT_ID,
        positionKey,
        symbol: "CRM",
        assetClass: "equity",
        positionType: "stock",
        quantity: "1",
        averageCost: "100",
        mark: "100",
        marketValue: "100",
        openedAt: reopenedAt,
        asOf: reopenedAt,
        status: "open",
      })
      .returning();
    assert.ok(position);

    await assert.rejects(
      placeShadowOrder({
        symbol: "CRM",
        assetClass: "equity",
        optionContract: null,
        side: "buy",
        type: "limit",
        quantity: 1,
        limitPrice: 100,
        timeInForce: "day",
        source: "automation",
        sourceEventId: "00000000-0000-4000-8000-000000000508",
        clientOrderId: "shadow-stale-lifecycle-entry",
        positionKey,
        requestedFillPrice: 100,
        payload: {
          position: {
            id: "deployment-1:CRM",
            openedAt: staleAt.toISOString(),
            positionKey,
          },
        },
        placedAt: staleAt,
      }),
      (error: unknown) =>
        (error as { code?: string }).code === "shadow_stale_position_lifecycle",
    );

    const [account] = await db
      .select()
      .from(shadowAccountsTable)
      .where(eq(shadowAccountsTable.id, SHADOW_ACCOUNT_ID));
    const [current] = await db
      .select()
      .from(shadowPositionsTable)
      .where(eq(shadowPositionsTable.id, position.id));
    assert.equal(account?.cash, "25000.000000");
    assert.equal(current?.quantity, "1.000000");
    assert.equal(current?.openedAt.getTime(), reopenedAt.getTime());
    assert.equal(
      (
        await db
          .select()
          .from(shadowOrdersTable)
          .where(
            eq(
              shadowOrdersTable.sourceEventId,
              "00000000-0000-4000-8000-000000000508",
            ),
          )
      ).length,
      0,
    );
    assert.equal(
      (
        await db
          .select()
          .from(shadowFillsTable)
          .where(
            eq(
              shadowFillsTable.sourceEventId,
              "00000000-0000-4000-8000-000000000508",
            ),
          )
      ).length,
      0,
    );
    shadowInternals.invalidateShadowFreshStateCache();
  });
});

test("a delayed entry cannot reopen its already-closed lifecycle", async () => {
  await withTestDb(async () => {
    const openedAt = new Date("2026-07-15T14:30:00.000Z");
    const delayedAt = new Date("2026-07-15T14:45:00.000Z");
    const closedAt = new Date("2026-07-15T15:00:00.000Z");
    const positionKey = "equity:CRM";
    shadowInternals.invalidateShadowFreshStateCache();
    await db.insert(shadowAccountsTable).values({
      id: SHADOW_ACCOUNT_ID,
      displayName: "Shadow",
      startingBalance: "25000",
      cash: "25000",
    });
    const [position] = await db
      .insert(shadowPositionsTable)
      .values({
        accountId: SHADOW_ACCOUNT_ID,
        positionKey,
        symbol: "CRM",
        assetClass: "equity",
        positionType: "stock",
        quantity: "0",
        averageCost: "100",
        mark: "100",
        marketValue: "0",
        openedAt,
        closedAt,
        asOf: closedAt,
        status: "closed",
      })
      .returning();
    assert.ok(position);

    await assert.rejects(
      placeShadowOrder({
        symbol: "CRM",
        assetClass: "equity",
        optionContract: null,
        side: "buy",
        type: "limit",
        quantity: 1,
        limitPrice: 100,
        timeInForce: "day",
        source: "automation",
        sourceEventId: "00000000-0000-4000-8000-000000000511",
        clientOrderId: "shadow-delayed-closed-lifecycle-entry",
        positionKey,
        requestedFillPrice: 100,
        payload: {
          position: {
            id: "deployment-1:CRM",
            openedAt: openedAt.toISOString(),
            positionKey,
          },
        },
        placedAt: delayedAt,
      }),
      (error: unknown) =>
        (error as { code?: string }).code === "shadow_stale_position_lifecycle",
    );

    const [account] = await db
      .select()
      .from(shadowAccountsTable)
      .where(eq(shadowAccountsTable.id, SHADOW_ACCOUNT_ID));
    const [current] = await db
      .select()
      .from(shadowPositionsTable)
      .where(eq(shadowPositionsTable.id, position.id));
    assert.equal(account?.cash, "25000.000000");
    assert.equal(current?.status, "closed");
    assert.equal(current?.asOf.getTime(), closedAt.getTime());
    assert.equal(
      (
        await db
          .select()
          .from(shadowOrdersTable)
          .where(
            eq(
              shadowOrdersTable.sourceEventId,
              "00000000-0000-4000-8000-000000000511",
            ),
          )
      ).length,
      0,
    );
    shadowInternals.invalidateShadowFreshStateCache();
  });
});

test("concurrent buys cannot spend the same Shadow cash twice", async () => {
  await withTestDb(async () => {
    shadowInternals.invalidateShadowFreshStateCache();
    await db.insert(shadowAccountsTable).values({
      id: SHADOW_ACCOUNT_ID,
      displayName: "Shadow",
      startingBalance: "25000",
      cash: "25000",
    });
    const buy = (symbol: string) =>
      placeShadowOrder({
        symbol,
        assetClass: "equity",
        optionContract: null,
        side: "buy",
        type: "limit",
        quantity: 200,
        limitPrice: 100,
        timeInForce: "day",
        source: "manual",
        requestedFillPrice: 100,
      });

    const results = await Promise.allSettled([buy("CRM"), buy("AAPL")]);
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assert.equal(
      results.filter(
        (result) =>
          result.status === "rejected" &&
          (result.reason as { code?: string }).code ===
            "shadow_insufficient_cash",
      ).length,
      1,
    );
    const [account] = await db
      .select()
      .from(shadowAccountsTable)
      .where(eq(shadowAccountsTable.id, SHADOW_ACCOUNT_ID));
    assert.ok(Number(account?.cash) >= 0);
    assert.equal(
      (
        await db
          .select()
          .from(shadowFillsTable)
          .where(eq(shadowFillsTable.accountId, SHADOW_ACCOUNT_ID))
      ).length,
      1,
    );
    shadowInternals.invalidateShadowFreshStateCache();
  });
});

test("concurrent identical buys return one idempotent order", async () => {
  await withTestDb(async () => {
    shadowInternals.invalidateShadowFreshStateCache();
    await db.insert(shadowAccountsTable).values({
      id: SHADOW_ACCOUNT_ID,
      displayName: "Shadow",
      startingBalance: "25000",
      cash: "25000",
    });
    const input = {
      symbol: "CRM",
      assetClass: "equity" as const,
      optionContract: null,
      side: "buy" as const,
      type: "limit" as const,
      quantity: 1,
      limitPrice: 100,
      timeInForce: "day" as const,
      source: "automation" as const,
      sourceEventId: "00000000-0000-4000-8000-000000000512",
      clientOrderId: "shadow-concurrent-idempotent-buy",
      positionKey: "equity:CRM",
      requestedFillPrice: 100,
      payload: {
        position: {
          id: "deployment-1:CRM",
          openedAt: "2026-07-15T14:30:00.000Z",
          positionKey: "equity:CRM",
        },
      },
      placedAt: new Date("2026-07-15T14:30:00.000Z"),
    };

    const [first, second] = await Promise.all([
      placeShadowOrder(input),
      placeShadowOrder(input),
    ]);

    assert.equal(first.id, second.id);
    assert.equal(
      (
        await db
          .select()
          .from(shadowFillsTable)
          .where(eq(shadowFillsTable.accountId, SHADOW_ACCOUNT_ID))
      ).length,
      1,
    );
    shadowInternals.invalidateShadowFreshStateCache();
  });
});

test("mirror repair does not replay a source event that already owns a ledger order", async () => {
  await withTestDb(async () => {
    const eventId = "00000000-0000-4000-8000-000000000503";
    const occurredAt = new Date("2026-07-15T18:00:00.000Z");
    const contract = {
      ticker: "O:CRM260717C00250000",
      underlying: "CRM",
      expirationDate: "2026-07-17",
      strike: 250,
      right: "call",
      multiplier: 100,
    };
    const eventPayload = {
      exitPrice: 1,
      exitQuantity: 1,
      selectedContract: contract,
      position: {
        id: "deployment-1:CRM",
        openedAt: "2026-07-15T14:30:00.000Z",
        positionKey: "option:CRM:2026-07-17:250:call:O:CRM260717C00250000",
        quantity: 1,
        selectedContract: contract,
      },
    };
    await db.insert(shadowAccountsTable).values({
      id: SHADOW_ACCOUNT_ID,
      displayName: "Shadow",
      startingBalance: "25000",
      cash: "25000",
    });
    await db.insert(executionEventsTable).values({
      id: eventId,
      deploymentId: null,
      providerAccountId: "shadow",
      symbol: "CRM",
      eventType: "signal_options_shadow_exit",
      summary: "CRM exit",
      payload: eventPayload,
      occurredAt,
    });
    await db.insert(shadowOrdersTable).values({
      id: "00000000-0000-4000-8000-000000000504",
      accountId: SHADOW_ACCOUNT_ID,
      source: "automation",
      sourceEventId: eventId,
      symbol: "CRM",
      assetClass: "option",
      side: "buy",
      status: "filled",
      quantity: "1",
      filledQuantity: "1",
      averageFillPrice: "1",
      optionContract: contract,
      payload: {},
      placedAt: occurredAt,
      filledAt: occurredAt,
    });
    const attempted: string[] = [];

    const summary = await repairSignalOptionsAutomationMirrorsForRead(
      "automation",
      {
        force: true,
        mirrorEvent: async (event) => {
          attempted.push(event.id);
          return {} as never;
        },
      },
    );

    assert.deepEqual(attempted, []);
    assert.equal(summary.checkedCount, 0);
    assert.equal(summary.missingCount, 0);

    await db
      .update(shadowOrdersTable)
      .set({ side: "sell", payload: eventPayload })
      .where(eq(shadowOrdersTable.sourceEventId, eventId));
    const exactAttempts: string[] = [];
    const exactSummary = await repairSignalOptionsAutomationMirrorsForRead(
      "automation",
      {
        force: true,
        mirrorEvent: async (event) => {
          exactAttempts.push(event.id);
          return {} as never;
        },
      },
    );
    assert.deepEqual(exactAttempts, []);
    assert.equal(exactSummary.checkedCount, 0);
  });
});

test("bounded mirror repair advances past permanent misses", async () => {
  await withTestDb(async () => {
    await repairSignalOptionsAutomationMirrorsForRead("automation", {
      force: true,
      candidateLimit: 1,
      mirrorEvent: async () => null,
    });
    const contract = {
      ticker: "O:CRM260717C00250000",
      underlying: "CRM",
      expirationDate: "2026-07-17",
      strike: 250,
      right: "call",
      multiplier: 100,
    };
    const event = (id: string, occurredAt: string) => ({
      id,
      deploymentId: null,
      providerAccountId: "shadow",
      symbol: "CRM",
      eventType: "signal_options_shadow_exit",
      summary: "CRM exit",
      payload: {
        exitPrice: 1,
        exitQuantity: 1,
        selectedContract: contract,
        position: {
          id: `deployment-1:${id}`,
          openedAt: "2026-07-15T14:30:00.000Z",
          positionKey: `option:CRM:${id}`,
          quantity: 1,
          selectedContract: contract,
        },
      },
      occurredAt: new Date(occurredAt),
    });
    const oldestId = "00000000-0000-4000-8000-000000000505";
    const middleId = "00000000-0000-4000-8000-000000000506";
    const newestId = "00000000-0000-4000-8000-000000000507";
    await db
      .insert(executionEventsTable)
      .values([
        event(oldestId, "2026-07-15T18:00:00.000Z"),
        event(middleId, "2026-07-15T18:01:00.000Z"),
        event(newestId, "2026-07-15T18:02:00.000Z"),
      ]);
    const attempted: string[] = [];
    const options = {
      force: true,
      candidateLimit: 2,
      mirrorEvent: async (candidate: ExecutionEvent) => {
        attempted.push(candidate.id);
        return candidate.id === newestId ? ({} as never) : null;
      },
    };

    await repairSignalOptionsAutomationMirrorsForRead("automation", options);
    assert.deepEqual(attempted, [oldestId, middleId]);

    attempted.length = 0;
    const second = await repairSignalOptionsAutomationMirrorsForRead(
      "automation",
      options,
    );
    assert.deepEqual(attempted, [newestId]);
    assert.equal(second.repairedCount, 1);
  });
});

test("bounded mirror repair does not retain a malformed production candidate", async () => {
  await withTestDb(async () => {
    await repairSignalOptionsAutomationMirrorsForRead("automation", {
      force: true,
      candidateLimit: 1,
      mirrorEvent: async () => null,
    });
    const event = (
      id: string,
      occurredAt: string,
      payloadOverrides: Record<string, unknown> = {},
    ) => ({
      id,
      deploymentId: null,
      providerAccountId: SHADOW_ACCOUNT_ID,
      symbol: "CRM",
      eventType: "signal_options_shadow_exit" as const,
      summary: "CRM malformed retry candidate",
      payload: {
        exitPrice: 1,
        exitQuantity: 1,
        ...payloadOverrides,
      },
      occurredAt: new Date(occurredAt),
    });
    const malformedId = "00000000-0000-4000-8000-000000000524";
    const validId = "00000000-0000-4000-8000-000000000525";
    await db.insert(executionEventsTable).values([
      event(malformedId, "2026-07-15T18:00:00.000Z", {
        maintenance: true,
        mirrorRequired: "true",
      }),
      event(validId, "2026-07-15T18:01:00.000Z"),
    ]);
    const attempted: string[] = [];
    const options = {
      force: true,
      candidateLimit: 1,
      mirrorEvent: async (candidate: ExecutionEvent) => {
        attempted.push(candidate.id);
        return null;
      },
    };

    const first = await repairSignalOptionsAutomationMirrorsForRead(
      "automation",
      options,
    );
    assert.equal(first.checkedCount, 0);

    await repairSignalOptionsAutomationMirrorsForRead("automation", options);
    assert.deepEqual(
      attempted,
      [validId],
      "a permanently rejected row must not consume the bounded retry lane",
    );
  });
});

test("bounded mirror repair retries transient failures independently of its forward cursor", async () => {
  await withTestDb(async () => {
    await repairSignalOptionsAutomationMirrorsForRead("automation", {
      force: true,
      candidateLimit: 1,
      mirrorEvent: async () => null,
    });
    const contract = {
      ticker: "O:CRM260717C00250000",
      underlying: "CRM",
      expirationDate: "2026-07-17",
      strike: 250,
      right: "call",
      multiplier: 100,
      providerContractId: "crm-transient-repair",
    };
    const event = (id: string, occurredAt: string) => ({
      id,
      deploymentId: null,
      providerAccountId: SHADOW_ACCOUNT_ID,
      symbol: "CRM",
      eventType: "signal_options_shadow_exit" as const,
      summary: "CRM transient mirror repair",
      payload: {
        exitPrice: 1,
        exitQuantity: 1,
        selectedContract: contract,
        position: {
          id: `deployment-transient:${id}`,
          openedAt: "2026-07-15T14:30:00.000Z",
          positionKey: `option:CRM:${id}`,
          quantity: 1,
          selectedContract: contract,
        },
      },
      occurredAt: new Date(occurredAt),
    });
    const failedId = "00000000-0000-4000-8000-000000000526";
    const newerId = "00000000-0000-4000-8000-000000000527";
    await db
      .insert(executionEventsTable)
      .values([
        event(failedId, "2026-07-15T18:00:00.000Z"),
        event(newerId, "2026-07-15T18:01:00.000Z"),
      ]);
    const attempted: string[] = [];
    let failedAttempts = 0;
    const mirrorEvent = async (candidate: ExecutionEvent) => {
      attempted.push(candidate.id);
      if (candidate.id === failedId && failedAttempts++ === 0) {
        throw new Error("synthetic transient mirror failure");
      }
      return candidate.id === failedId ? ({} as never) : null;
    };

    const first = await repairSignalOptionsAutomationMirrorsForRead(
      "automation",
      {
        force: true,
        candidateLimit: 1,
        mirrorEvent,
      },
    );
    assert.equal(first.errorCount, 1);

    await repairSignalOptionsAutomationMirrorsForRead("automation", {
      force: true,
      candidateLimit: 1,
      mirrorEvent,
    });
    assert.equal(
      attempted.filter((id) => id === failedId).length,
      2,
      "the failed event must retry even while the forward page remains full",
    );
  });
});

test("bounded mirror repair attempts newer forward events when a permanent retry fills the lane", async () => {
  await withTestDb(async () => {
    await repairSignalOptionsAutomationMirrorsForRead("automation", {
      force: true,
      candidateLimit: 1,
      mirrorEvent: async () => null,
    });
    const contract = {
      ticker: "O:CRM260717C00250000",
      underlying: "CRM",
      expirationDate: "2026-07-17",
      strike: 250,
      right: "call",
      multiplier: 100,
      providerContractId: "crm-permanent-repair",
    };
    const event = (id: string, occurredAt: string) => ({
      id,
      deploymentId: null,
      providerAccountId: SHADOW_ACCOUNT_ID,
      symbol: "CRM",
      eventType: "signal_options_shadow_exit" as const,
      summary: "CRM permanent mirror retry",
      payload: {
        exitPrice: 1,
        exitQuantity: 1,
        selectedContract: contract,
        position: {
          id: `deployment-permanent:${id}`,
          openedAt: "2026-07-15T14:30:00.000Z",
          positionKey: `option:CRM:${id}`,
          quantity: 1,
          selectedContract: contract,
        },
      },
      occurredAt: new Date(occurredAt),
    });
    const failedId = "00000000-0000-4000-8000-000000000531";
    const newerId = "00000000-0000-4000-8000-000000000532";
    await db
      .insert(executionEventsTable)
      .values([
        event(failedId, "2026-07-15T18:00:00.000Z"),
        event(newerId, "2026-07-15T18:01:00.000Z"),
      ]);
    const attempted: string[] = [];
    const mirrorEvent = async (candidate: ExecutionEvent) => {
      attempted.push(candidate.id);
      if (candidate.id === failedId) {
        throw new Error("synthetic permanent mirror failure");
      }
      return {} as never;
    };

    const first = await repairSignalOptionsAutomationMirrorsForRead(
      "automation",
      { force: true, candidateLimit: 1, mirrorEvent },
    );
    assert.equal(first.errorCount, 1);
    attempted.length = 0;

    try {
      await repairSignalOptionsAutomationMirrorsForRead("automation", {
        force: true,
        candidateLimit: 1,
        mirrorEvent,
      });
      assert.deepEqual(
        attempted,
        [failedId, newerId],
        "a full retry lane must not starve newer forward work",
      );
    } finally {
      await repairSignalOptionsAutomationMirrorsForRead("automation", {
        force: true,
        candidateLimit: 1,
        mirrorEvent: async () => ({}) as never,
      });
    }
  });
});

test("bounded mirror repair retains the unprocessed page when its lease is lost", async () => {
  await withTestDb(async () => {
    await repairSignalOptionsAutomationMirrorsForRead("automation", {
      force: true,
      candidateLimit: 2,
      mirrorEvent: async () => null,
    });
    const contract = {
      ticker: "O:CRM260717C00250000",
      underlying: "CRM",
      expirationDate: "2026-07-17",
      strike: 250,
      right: "call",
      multiplier: 100,
      providerContractId: "crm-aborted-repair-page",
    };
    const event = (id: string, occurredAt: string) => ({
      id,
      deploymentId: null,
      providerAccountId: SHADOW_ACCOUNT_ID,
      symbol: "CRM",
      eventType: "signal_options_shadow_exit" as const,
      summary: "CRM aborted mirror repair page",
      payload: {
        exitPrice: 1,
        exitQuantity: 1,
        selectedContract: contract,
        position: {
          id: `deployment-aborted:${id}`,
          openedAt: "2026-07-15T14:30:00.000Z",
          positionKey: `option:CRM:${id}`,
          quantity: 1,
          selectedContract: contract,
        },
      },
      occurredAt: new Date(occurredAt),
    });
    const oldestId = "00000000-0000-4000-8000-000000000529";
    const newestId = "00000000-0000-4000-8000-000000000530";
    await db
      .insert(executionEventsTable)
      .values([
        event(oldestId, "2026-07-15T18:00:00.000Z"),
        event(newestId, "2026-07-15T18:01:00.000Z"),
      ]);

    const controller = new AbortController();
    const leaseLost = new Error("synthetic mirror repair lease loss");
    const attempted: string[] = [];
    await assert.rejects(
      repairSignalOptionsAutomationMirrorsForRead("automation", {
        force: true,
        signal: controller.signal,
        candidateLimit: 2,
        mirrorEvent: async (candidate) => {
          attempted.push(candidate.id);
          controller.abort(leaseLost);
          return null;
        },
      }),
      (error) => error === leaseLost,
    );
    assert.deepEqual(attempted, [oldestId]);

    attempted.length = 0;
    await repairSignalOptionsAutomationMirrorsForRead("automation", {
      force: true,
      candidateLimit: 2,
      mirrorEvent: async (candidate) => {
        attempted.push(candidate.id);
        return null;
      },
    });
    assert.deepEqual(
      attempted,
      [oldestId, newestId],
      "every selected event must survive cursor advancement before processing",
    );
  });
});

test("bounded mirror repair preserves entry-before-exit dependency order across pages", async () => {
  await withTestDb(async () => {
    await repairSignalOptionsAutomationMirrorsForRead("automation", {
      force: true,
      candidateLimit: 1,
      mirrorEvent: async () => null,
    });
    const contract = {
      ticker: "O:CRM260717C00250000",
      underlying: "CRM",
      expirationDate: "2026-07-17",
      strike: 250,
      right: "call",
      multiplier: 100,
      providerContractId: "crm-repair-order",
    };
    const positionKey = "option:CRM:2026-07-17:250:call:crm-repair-order";
    const entryId = "00000000-0000-4000-8000-000000000509";
    const exitId = "00000000-0000-4000-8000-000000000510";
    const openedAt = new Date("2026-07-15T18:00:00.000Z");
    await db.insert(executionEventsTable).values([
      {
        id: entryId,
        deploymentId: null,
        providerAccountId: SHADOW_ACCOUNT_ID,
        symbol: "CRM",
        eventType: "signal_options_shadow_entry",
        summary: "CRM entry",
        payload: {
          selectedContract: contract,
          orderPlan: { quantity: 1, simulatedFillPrice: 1 },
          position: {
            id: "deployment-1:CRM",
            openedAt: openedAt.toISOString(),
            positionKey,
            quantity: 1,
            selectedContract: contract,
          },
          metadata: { positionKey },
        },
        occurredAt: openedAt,
      },
      {
        id: exitId,
        deploymentId: null,
        providerAccountId: SHADOW_ACCOUNT_ID,
        symbol: "CRM",
        eventType: "signal_options_shadow_exit",
        summary: "CRM exit",
        payload: {
          exitPrice: 1,
          exitQuantity: 1,
          selectedContract: contract,
          position: {
            id: "deployment-1:CRM",
            openedAt: openedAt.toISOString(),
            positionKey,
            quantity: 1,
            selectedContract: contract,
          },
          metadata: { positionKey },
        },
        occurredAt: new Date("2026-07-15T18:01:00.000Z"),
      },
    ]);
    let isOpen = false;
    const options = {
      force: true,
      candidateLimit: 1,
      mirrorEvent: async (event: ExecutionEvent) => {
        if (event.eventType === "signal_options_shadow_entry") {
          isOpen = true;
          return {};
        }
        if (!isOpen) {
          return null;
        }
        isOpen = false;
        return {};
      },
    };

    await repairSignalOptionsAutomationMirrorsForRead("automation", options);
    await repairSignalOptionsAutomationMirrorsForRead("automation", options);
    await repairSignalOptionsAutomationMirrorsForRead("automation", options);

    assert.equal(isOpen, false);
  });
});

test("bounded mirror repair orders equal-time entries before exits across pages", async () => {
  await withTestDb(async () => {
    await repairSignalOptionsAutomationMirrorsForRead("automation", {
      force: true,
      candidateLimit: 1,
      mirrorEvent: async () => null,
    });
    const contract = {
      ticker: "O:CRM260717C00250000",
      underlying: "CRM",
      expirationDate: "2026-07-17",
      strike: 250,
      right: "call",
      multiplier: 100,
      providerContractId: "crm-equal-time-repair-order",
    };
    const positionKey =
      "option:CRM:2026-07-17:250:call:crm-equal-time-repair-order";
    const exitId = "00000000-0000-4000-8000-000000000513";
    const entryId = "00000000-0000-4000-8000-000000000514";
    const occurredAt = new Date("2026-07-15T18:00:00.000Z");
    const position = {
      id: "deployment-1:CRM",
      openedAt: occurredAt.toISOString(),
      positionKey,
      quantity: 1,
      selectedContract: contract,
    };
    await db.insert(executionEventsTable).values([
      {
        id: exitId,
        deploymentId: null,
        providerAccountId: SHADOW_ACCOUNT_ID,
        symbol: "CRM",
        eventType: "signal_options_shadow_exit",
        summary: "CRM exit",
        payload: {
          exitPrice: 1,
          exitQuantity: 1,
          selectedContract: contract,
          position,
          metadata: { positionKey },
        },
        occurredAt,
      },
      {
        id: entryId,
        deploymentId: null,
        providerAccountId: SHADOW_ACCOUNT_ID,
        symbol: "CRM",
        eventType: "signal_options_shadow_entry",
        summary: "CRM entry",
        payload: {
          selectedContract: contract,
          orderPlan: { quantity: 1, simulatedFillPrice: 1 },
          position,
          metadata: { positionKey },
        },
        occurredAt,
      },
    ]);
    let isOpen = false;
    const options = {
      force: true,
      candidateLimit: 1,
      mirrorEvent: async (event: ExecutionEvent) => {
        if (event.eventType === "signal_options_shadow_entry") {
          isOpen = true;
          return {};
        }
        if (!isOpen) {
          return null;
        }
        isOpen = false;
        return {};
      },
    };

    await repairSignalOptionsAutomationMirrorsForRead("automation", options);
    await repairSignalOptionsAutomationMirrorsForRead("automation", options);
    await repairSignalOptionsAutomationMirrorsForRead("automation", options);

    assert.equal(isOpen, false);
  });
});

const repairEvent = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "repair-event-1",
    deploymentId: "deployment-1",
    algoRunId: null,
    providerAccountId: "provider-account-1",
    symbol: "O:CRM260717C00250000",
    eventType: "signal_options_shadow_exit",
    summary: "CRM shadow exit hard_stop",
    payload: {
      reason: "hard_stop",
      exitPrice: 1,
      pnl: -200,
      position: {
        id: "deployment-1:O:CRM260717C00250000",
        quantity: 2,
      },
      selectedContract: {
        ticker: "O:CRM260717C00250000",
        underlying: "CRM",
        expirationDate: "2026-07-17",
        strike: 250,
        right: "call",
        multiplier: 100,
      },
    },
    occurredAt: new Date("2026-07-15T18:00:00.000Z"),
    createdAt: new Date("2026-07-15T18:00:00.000Z"),
    updatedAt: new Date("2026-07-15T18:00:00.000Z"),
    ...overrides,
  }) as ExecutionEvent;

type MirrorOrder = { sourceEventId: string; side: "sell" };

const missingEvents = (
  events: Array<ReturnType<typeof repairEvent>>,
  orders: MirrorOrder[],
) =>
  events.filter(
    (event) => !orders.some((order) => order.sourceEventId === event.id),
  );

async function waitForAssertion(assertion: () => void) {
  let error: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion();
      return;
    } catch (candidate) {
      error = candidate;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
  throw error;
}

type FakeTimer = {
  callback: () => void;
  delayMs: number;
  cleared: boolean;
  fired: boolean;
  unref: () => void;
};

function createFakeTimers() {
  const timers: FakeTimer[] = [];
  return {
    setTimer(callback: () => void, delayMs: number) {
      const timer = {
        callback,
        delayMs,
        cleared: false,
        fired: false,
        unref() {},
      };
      timers.push(timer);
      return timer as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer(timer: ReturnType<typeof setTimeout>) {
      (timer as unknown as FakeTimer).cleared = true;
    },
    pending(delayMs: number) {
      return timers.filter(
        (timer) => !timer.cleared && !timer.fired && timer.delayMs === delayMs,
      );
    },
  };
}

test("exit claims are scoped to opened position lifecycles even when position and candidate ids are reused", () => {
  __resetSignalOptionsClaimedExitsForTests();
  const deploymentId = "deployment-1";
  const logicalPositionId = "deployment-1:BABA";
  const now = 1_700_000_000_000;

  const first = signalOptionsPositionExitClaimKey({
    deploymentId,
    position: {
      id: logicalPositionId,
      candidateId: "candidate-reused",
      openedAt: "2026-07-15T17:00:00.000Z",
    },
  } as never);
  const second = signalOptionsPositionExitClaimKey({
    deploymentId,
    position: {
      id: logicalPositionId,
      candidateId: "candidate-reused",
      openedAt: "2026-07-15T17:05:00.000Z",
    },
  } as never);
  const secondDuplicate = signalOptionsPositionExitClaimKey({
    deploymentId,
    position: {
      id: logicalPositionId,
      candidateId: "candidate-reused",
      openedAt: "2026-07-15T17:05:00.000Z",
    },
  } as never);

  assert.notEqual(first, second);
  assert.equal(second, secondDuplicate);
  assert.equal(tryClaimSignalOptionsPositionExit(first, now), true);
  assert.equal(tryClaimSignalOptionsPositionExit(second, now + 1), true);
  assert.equal(
    tryClaimSignalOptionsPositionExit(secondDuplicate, now + 2),
    false,
  );
});

test("opposite-signal partial-exit claims include the confirming signal", () => {
  const common = {
    deploymentId: "deployment-1",
    position: {
      id: "deployment-1:BABA",
      candidateId: "candidate-reused",
      openedAt: "2026-07-15T17:05:00.000Z",
    },
    scaleOutId: "opposite_signal_first_confirm",
  };

  assert.notEqual(
    signalOptionsPositionExitClaimKey({
      ...common,
      signalKey: "BABA|sell|2026-07-15T17:10:00.000Z",
    } as never),
    signalOptionsPositionExitClaimKey({
      ...common,
      signalKey: "BABA|sell|2026-07-15T17:11:00.000Z",
    } as never),
  );
});

test("restart wipes the in-process exit claim: a reclaim succeeds immediately, with no TTL wait", () => {
  __resetSignalOptionsClaimedExitsForTests();
  const now = 1_700_000_000_000;
  const key = "deployment-1:position-1";

  // Pre-restart: the tick manager claims the exit for this position.
  assert.equal(tryClaimSignalOptionsPositionExit(key, now), true);
  // A concurrent caller for the same position is correctly blocked while the
  // claim is live (steady-state protection, already pinned elsewhere).
  assert.equal(tryClaimSignalOptionsPositionExit(key, now + 1_000), false);

  // The process restarts. The claim map is an in-memory Map with no
  // persistence, so a restart clears it exactly like this reset call — there
  // is no code path that reloads claims from anywhere.
  __resetSignalOptionsClaimedExitsForTests();

  // Immediately after restart (same instant, no TTL elapsed) a second caller
  // re-evaluating the SAME position is allowed to claim again. This is the
  // vulnerability: unlike a natural TTL expiry (10 minutes), restart offers
  // an instantaneous reopening with no cooldown at all.
  assert.equal(tryClaimSignalOptionsPositionExit(key, now + 1_000), true);
});

test("claim TTL boundary: still blocked at exactly 10 minutes elapsed, reclaimable just after", () => {
  __resetSignalOptionsClaimedExitsForTests();
  const now = 1_700_000_000_000;
  const key = "deployment-1:position-2";

  assert.equal(tryClaimSignalOptionsPositionExit(key, now), true);
  // Prune condition in source is strictly `nowMs - claimedAt > TTL`, so at
  // exactly TTL elapsed the claim is NOT yet pruned.
  assert.equal(
    tryClaimSignalOptionsPositionExit(
      key,
      now + SIGNAL_OPTIONS_EXIT_CLAIM_TTL_MS,
    ),
    false,
  );
  // One millisecond later it is prunable and the same key can be reclaimed.
  assert.equal(
    tryClaimSignalOptionsPositionExit(
      key,
      now + SIGNAL_OPTIONS_EXIT_CLAIM_TTL_MS + 1,
    ),
    true,
  );
});

test("post-restart evaluation is rejected once persisted exit evidence is visible", () => {
  __resetSignalOptionsClaimedExitsForTests();
  const deploymentId = "deployment-1";
  const symbol = "CRM";
  const openedAt = new Date("2026-06-12T14:30:00.000Z");
  const key = `${deploymentId}:position-1`;

  // T1 (pre-restart): the position's stop is hit. The tick manager claims
  // the exit and (in the real system) persists a SIGNAL_OPTIONS_SHADOW_EXIT_EVENT
  // to the execution-events ledger before the process dies mid-flight.
  const t1 = openedAt.getTime() + 5 * 60 * 1000;
  assert.equal(tryClaimSignalOptionsPositionExit(key, t1), true);
  const lifecyclePositionId = "position-1";
  const persistedExitEvent = {
    deploymentId,
    symbol,
    occurredAt: new Date(t1),
    payload: {
      position: {
        id: lifecyclePositionId,
        openedAt: openedAt.toISOString(),
      },
    },
  };

  // Restart: the in-process claim map is gone.
  __resetSignalOptionsClaimedExitsForTests();

  // T2 (post-restart): a late/replayed evaluation of the SAME position (e.g.
  // the worker scan that was mid-flight when the process died) re-checks the
  // claim map first. With the map empty, the claim map alone says "go ahead".
  const t2 = t1 + 30_000;
  assert.equal(
    tryClaimSignalOptionsPositionExit(key, t2),
    true,
    "the claim map on its own no longer blocks this — restart erased it",
  );

  // But the real code path (force-close / mark-time exit / expiration
  // ledger-sync — see signalOptionsShadowExitEventIsDuplicate's callers in
  // shadow-account.ts) does not stop at the claim map: it loads recent
  // execution events for the deployment/symbol from the DB and runs this
  // pure duplicate check before ever calling placeShadowOrder again. That
  // persisted event survives the restart and correctly flags T2 as a
  // duplicate of the already-recorded T1 exit, so the second sell must not
  // be placed.
  const candidate = {
    deploymentId,
    symbol,
    since: openedAt,
    lifecyclePositionId,
    lifecycleOpenedAt: openedAt.toISOString(),
  };
  assert.equal(
    signalOptionsShadowExitEventIsDuplicate(candidate, [persistedExitEvent]),
    true,
  );
});

test("entry, partial-exit, and final-exit lifecycle identities are stable across stale owners", () => {
  const deploymentId = "deployment-1";
  const position = {
    id: "deployment-1:CRM",
    candidateId: "candidate-cycle-1",
    openedAt: "2026-07-15T17:00:00.000Z",
  };
  const idFor = (payload: Record<string, unknown>) =>
    signalOptionsLifecycleEventId({
      deploymentId,
      eventType: "signal_options_shadow_exit",
      payload,
    });

  assert.equal(
    signalOptionsLifecycleEventId({
      deploymentId,
      eventType: "signal_options_shadow_entry",
      payload: { signalKey: "CRM|buy|2026-07-15T17:00:00.000Z" },
    }),
    signalOptionsLifecycleEventId({
      deploymentId,
      eventType: "signal_options_shadow_entry",
      payload: {
        signalKey: "CRM|buy|2026-07-15T17:00:00.000Z",
        occurredAt: "different-owner-clock",
      },
    }),
  );
  assert.equal(
    idFor({ reason: "hard_stop", position }),
    idFor({
      reason: "expiration",
      maintenance: true,
      position: { ...position, candidateId: "legacy-candidate-alias" },
    }),
    "every final-exit creator for one position lifecycle must share one durable identity",
  );
  assert.equal(
    idFor({
      partial: true,
      scaleOutId: "first_trail_arm",
      position,
    }),
    idFor({
      partial: true,
      scaleOutId: "first_trail_arm",
      position,
      exitPrice: 9.99,
    }),
  );
  assert.notEqual(
    idFor({
      partial: true,
      scaleOutId: "first_trail_arm",
      position,
    }),
    idFor({
      partial: true,
      scaleOutId: "opposite_signal_first_confirm",
      position,
    }),
  );
  assert.notEqual(
    idFor({
      partial: true,
      scaleOutId: "opposite_signal_first_confirm",
      signalKey: "CRM|sell|2026-07-15T18:00:00.000Z",
      position,
    }),
    idFor({
      partial: true,
      scaleOutId: "opposite_signal_first_confirm",
      signalKey: "CRM|sell|2026-07-15T19:00:00.000Z",
      position,
    }),
    "separate opposite confirmations on one open lifecycle are separate partial exits",
  );
});

test("same-signal watched re-entries get a stable identity distinct from the original entry", () => {
  const deploymentId = "deployment-1";
  const signalKey = "CRM|buy|2026-07-15T17:00:00.000Z";
  const original = signalOptionsLifecycleEventId({
    deploymentId,
    eventType: "signal_options_shadow_entry",
    payload: { signalKey },
  });
  const reEntry = (ordinal: number, currentSignalKey = signalKey) =>
    signalOptionsLifecycleEventId({
      deploymentId,
      eventType: "signal_options_shadow_entry",
      payload: {
        signalKey: currentSignalKey,
        reEntry: true,
        reEntryWatch: {
          key: "CRM\u00001m\u0000buy\u0000source-signal",
          reEntries: ordinal,
        },
      },
    });

  assert.ok(original);
  assert.ok(reEntry(1));
  assert.notEqual(reEntry(1), original);
  assert.equal(reEntry(1), reEntry(1));
  assert.equal(
    reEntry(1),
    reEntry(1, "CRM|buy|2026-07-15T17:01:00.000Z"),
    "stale owners consuming one persisted watch slot must converge despite observing different signals",
  );
  assert.notEqual(reEntry(1), reEntry(2));
});

test("a watched re-entry without a complete persisted watch identity fails closed", () => {
  assert.throws(() =>
    signalOptionsLifecycleEventId({
      deploymentId: "deployment-1",
      eventType: "signal_options_shadow_entry",
      payload: {
        signalKey: "CRM|buy|2026-07-15T17:00:00.000Z",
        reEntry: true,
        reEntryWatch: {
          key: "CRM\u00001m\u0000buy\u0000source-signal",
          reEntries: 0,
        },
      },
    }),
  );
});

test("overlapping stale event creators mirror and notify only the deterministic insert winner", async () => {
  const persisted = new Map<string, ExecutionEvent>();
  const insertStarted: Array<() => void> = [];
  let releaseInserts!: () => void;
  const insertGate = new Promise<void>((resolve) => {
    releaseInserts = resolve;
  });
  let mirrorCount = 0;
  let notifyCount = 0;
  const dependencies = {
    insertLedgerEvent: async (event: ExecutionEvent) => {
      await new Promise<void>((resolve) => {
        insertStarted.push(resolve);
        if (insertStarted.length === 2) {
          insertStarted.forEach((started) => started());
        }
      });
      await insertGate;
      if (persisted.has(event.id)) {
        return null;
      }
      persisted.set(event.id, event);
      return event;
    },
    findLedgerEvent: async (id: string) => persisted.get(id) ?? null,
    mirrorEvent: async () => {
      mirrorCount += 1;
      return {};
    },
    notify: () => {
      notifyCount += 1;
    },
  };
  const input = {
    deployment: {
      id: "deployment-1",
      providerAccountId: "provider-account-1",
      mode: "shadow",
    } as never,
    symbol: "CRM",
    eventType: "signal_options_shadow_entry",
    summary: "CRM shadow entry",
    payload: {
      signalKey: "CRM|buy|2026-07-15T17:00:00.000Z",
      position: {
        id: "deployment-1:CRM",
        candidateId: "candidate-cycle-1",
        openedAt: "2026-07-15T17:00:00.000Z",
      },
    },
  };

  const first = insertSignalOptionsEventWithDependenciesForTests(
    { ...input, occurredAt: new Date("2026-07-15T17:00:00.000Z") },
    dependencies,
  );
  const second = insertSignalOptionsEventWithDependenciesForTests(
    { ...input, occurredAt: new Date("2026-07-15T17:00:01.000Z") },
    dependencies,
  );
  await waitForAssertion(() => assert.equal(insertStarted.length, 2));
  releaseInserts();
  const results = await Promise.all([first, second]);

  assert.equal(persisted.size, 1);
  assert.equal(results.filter((result) => result.inserted).length, 1);
  assert.equal(new Set(results.map((result) => result.event.id)).size, 1);
  assert.equal(mirrorCount, 1);
  assert.equal(notifyCount, 1);
});

test("a lifecycle-fenced stale exit never falls through to the ordinary insert or mirror", async () => {
  let ordinaryInsertCount = 0;
  let fenceCount = 0;
  let mirrorCount = 0;
  let notifyCount = 0;
  const occurredAt = new Date("2026-07-15T18:00:00.000Z");
  const result = await insertSignalOptionsEventWithDependenciesForTests(
    {
      deployment: {
        id: "deployment-1",
        providerAccountId: "provider-account-1",
        mode: "shadow",
      } as never,
      symbol: "CRM",
      eventType: "signal_options_shadow_exit",
      summary: "CRM shadow exit hard_stop",
      occurredAt,
      payload: {
        reason: "hard_stop",
        exitQuantity: 2,
        position: {
          id: "deployment-1:CRM",
          candidateId: "candidate-cycle-1",
          openedAt: "2026-07-15T17:00:00.000Z",
          quantity: 2,
        },
      },
    },
    {
      insertLedgerEvent: async (event: ExecutionEvent) => {
        ordinaryInsertCount += 1;
        return event;
      },
      insertLifecycleExitEvent: async () => {
        fenceCount += 1;
        return { status: "stale" as const };
      },
      findLedgerEvent: async () => null,
      mirrorEvent: async () => {
        mirrorCount += 1;
        return {};
      },
      notify: () => {
        notifyCount += 1;
      },
    } as never,
  );

  assert.equal(result.inserted, false);
  assert.equal(result.exitFenceStatus, "stale");
  assert.equal(fenceCount, 1);
  assert.equal(ordinaryInsertCount, 0);
  assert.equal(mirrorCount, 0);
  assert.equal(notifyCount, 0);
});

test("a malformed live exit rejected by the lifecycle fence has no durable side effects", async () => {
  let ordinaryInsertCount = 0;
  let fenceCount = 0;
  let mirrorCount = 0;
  let notifyCount = 0;
  const result = await insertSignalOptionsEventWithDependenciesForTests(
    {
      deployment: {
        id: "deployment-1",
        providerAccountId: "provider-account-1",
        mode: "shadow",
      } as never,
      symbol: "CRM",
      eventType: "signal_options_shadow_exit",
      summary: "CRM malformed shadow exit",
      occurredAt: new Date("2026-07-15T18:00:00.000Z"),
      payload: {
        reason: "hard_stop",
        exitQuantity: 2,
        position: {
          id: "deployment-1:CRM",
          quantity: 2,
        },
      },
    },
    {
      insertLedgerEvent: async (event: ExecutionEvent) => {
        ordinaryInsertCount += 1;
        return event;
      },
      insertLifecycleExitEvent: async () => {
        fenceCount += 1;
        return { status: "invalid" as const };
      },
      findLedgerEvent: async () => null,
      mirrorEvent: async () => {
        mirrorCount += 1;
        return {};
      },
      notify: () => {
        notifyCount += 1;
      },
    } as never,
  );

  assert.equal(result.inserted, false);
  assert.equal(result.exitFenceStatus, "invalid");
  assert.equal(fenceCount, 1);
  assert.equal(ordinaryInsertCount, 0);
  assert.equal(mirrorCount, 0);
  assert.equal(notifyCount, 0);
});

test("historical backfill exits keep their isolated ordinary ledger writer", async () => {
  let ordinaryInsertCount = 0;
  let fenceCount = 0;
  const result = await insertSignalOptionsEventWithDependenciesForTests(
    {
      deployment: {
        id: "deployment-1",
        providerAccountId: "provider-account-1",
        mode: "shadow",
      } as never,
      symbol: "CRM",
      eventType: "signal_options_shadow_exit",
      summary: "CRM historical exit",
      occurredAt: new Date("2026-07-15T18:00:00.000Z"),
      payload: {
        backfillEventKey: "signal_options_backfill:crm:exit",
        metadata: {
          runMode: "historical_backfill",
          runSource: "signal_options_backfill",
        },
        exitQuantity: 2,
        position: {
          id: "deployment-1:CRM",
          openedAt: "2026-07-15T17:00:00.000Z",
          quantity: 2,
        },
      },
    },
    {
      insertLedgerEvent: async (event: ExecutionEvent) => {
        ordinaryInsertCount += 1;
        return event;
      },
      insertLifecycleExitEvent: async () => {
        fenceCount += 1;
        return { status: "invalid" as const };
      },
      findLedgerEvent: async () => null,
      mirrorEvent: async () => ({}),
      notify: () => undefined,
    } as never,
  );

  assert.equal(result.inserted, true);
  assert.equal(ordinaryInsertCount, 1);
  assert.equal(fenceCount, 0);
});

test("an aborted owned replay is terminalized before its abort is rethrown", async () => {
  const controller = new AbortController();
  const leaseLost = new Error("replay lease lost");
  controller.abort(leaseLost);
  const failures: Array<{ runId: string; error: unknown }> = [];

  await assert.rejects(
    terminalizeSignalOptionsReplayFailureForTests({
      runId: "replay-run-1",
      error: new Error("superseded scan error"),
      signal: controller.signal,
      failRun: async (runId: string, error: unknown) => {
        failures.push({ runId, error });
      },
    }),
    (error) => error === leaseLost,
  );
  assert.deepEqual(failures, [{ runId: "replay-run-1", error: leaseLost }]);
});

test("an owned replay never hides a failed terminal-status write", async () => {
  const scanFailure = new Error("replay scan failed");
  const terminalWriteFailure = new Error("terminal status write failed");

  await assert.rejects(
    terminalizeSignalOptionsReplayFailureForTests({
      runId: "replay-run-1",
      error: scanFailure,
      failRun: async () => {
        throw terminalWriteFailure;
      },
    }),
    (error) => error === terminalWriteFailure,
  );
});

test("forced mirror repair heals one committed ordinary exit without duplicating its event, sell, or daily P&L", async () => {
  const events = [repairEvent()];
  const orders: MirrorOrder[] = [];
  const pnlAt = new Date("2026-07-15T19:00:00.000Z");
  const singleEventDailyPnl =
    __signalOptionsAutomationInternalsForTests.computeSignalOptionsDailyRealizedPnl(
      events,
      pnlAt,
    );
  let mirrorAttempts = 0;
  const mirrorEvent = async (event: ReturnType<typeof repairEvent>) => {
    mirrorAttempts += 1;
    if (mirrorAttempts === 1) {
      throw new Error("synthetic pre-commit mirror failure");
    }
    if (!orders.some((order) => order.sourceEventId === event.id)) {
      orders.push({ sourceEventId: event.id, side: "sell" });
    }
    return orders[0];
  };

  await assert.rejects(mirrorEvent(events[0]!));
  await shadowInternals.repairSignalOptionsAutomationMirrorsForRead(
    "automation",
    {
      force: true,
      listCandidates: async () => missingEvents(events, orders),
      mirrorEvent,
    },
  );
  await shadowInternals.repairSignalOptionsAutomationMirrorsForRead(
    "automation",
    {
      force: true,
      listCandidates: async () => missingEvents(events, orders),
      mirrorEvent,
    },
  );

  assert.equal(events.length, 1);
  assert.deepEqual(orders, [{ sourceEventId: events[0]!.id, side: "sell" }]);
  assert.equal(
    __signalOptionsAutomationInternalsForTests.computeSignalOptionsDailyRealizedPnl(
      events,
      pnlAt,
    ),
    singleEventDailyPnl,
  );
});

test("forced mirror repair does not double-sell after an ambiguous post-commit failure", async () => {
  const events = [repairEvent()];
  const orders: MirrorOrder[] = [];
  const ambiguousMirror = async (event: ReturnType<typeof repairEvent>) => {
    orders.push({ sourceEventId: event.id, side: "sell" });
    throw new Error("synthetic post-commit readback failure");
  };

  await assert.rejects(ambiguousMirror(events[0]!));
  const summary =
    await shadowInternals.repairSignalOptionsAutomationMirrorsForRead(
      "automation",
      {
        force: true,
        listCandidates: async () => missingEvents(events, orders),
        mirrorEvent: ambiguousMirror,
      },
    );

  assert.equal(summary.missingCount, 0);
  assert.deepEqual(orders, [{ sourceEventId: events[0]!.id, side: "sell" }]);
});

test("mirror repair excludes maintenance ledger-only exits", async () => {
  const events = [repairEvent({ payload: { maintenance: true, pnl: -200 } })];
  let mirrorCount = 0;

  const summary =
    await shadowInternals.repairSignalOptionsAutomationMirrorsForRead(
      "automation",
      {
        force: true,
        listCandidates: async () => events,
        mirrorEvent: async () => {
          mirrorCount += 1;
          return {};
        },
      },
    );

  assert.equal(summary.missingCount, 0);
  assert.equal(mirrorCount, 0);
});

test("mirror repair owns maintenance exits explicitly marked for post-commit sell", async () => {
  const events = [
    repairEvent({
      payload: { maintenance: true, mirrorRequired: true, pnl: -200 },
    }),
  ];
  let mirrorCount = 0;

  const summary =
    await shadowInternals.repairSignalOptionsAutomationMirrorsForRead(
      "automation",
      {
        force: true,
        listCandidates: async () => events,
        mirrorEvent: async () => {
          mirrorCount += 1;
          return {};
        },
      },
    );

  assert.equal(summary.missingCount, 1);
  assert.equal(summary.repairedCount, 1);
  assert.equal(mirrorCount, 1);
});

test("forced mirror repair stops before writes when its lease is lost during candidate loading", async () => {
  const controller = new AbortController();
  const leaseLost = new Error("maintenance lease lost");
  let mirrorCount = 0;

  await assert.rejects(
    shadowInternals.repairSignalOptionsAutomationMirrorsForRead("automation", {
      force: true,
      signal: controller.signal,
      listCandidates: async () => {
        controller.abort(leaseLost);
        return [repairEvent()];
      },
      mirrorEvent: async () => {
        mirrorCount += 1;
        return {};
      },
    } as never),
    (error) => error === leaseLost,
  );

  assert.equal(mirrorCount, 0);
});

test("a forced repair arriving during an in-flight scan waits and reruns after the new event exists", async () => {
  const events: Array<ReturnType<typeof repairEvent>> = [];
  const orders: MirrorOrder[] = [];
  let listCount = 0;
  let markFirstListSelected!: () => void;
  let releaseFirstList!: () => void;
  const firstListSelected = new Promise<void>((resolve) => {
    markFirstListSelected = resolve;
  });
  const firstListGate = new Promise<void>((resolve) => {
    releaseFirstList = resolve;
  });
  const options = {
    force: true,
    listCandidates: async () => {
      listCount += 1;
      const selected = missingEvents(events, orders);
      if (listCount === 1) {
        markFirstListSelected();
        await firstListGate;
      }
      return selected;
    },
    mirrorEvent: async (event: ReturnType<typeof repairEvent>) => {
      orders.push({ sourceEventId: event.id, side: "sell" });
      return orders[0];
    },
  };

  const first = shadowInternals.repairSignalOptionsAutomationMirrorsForRead(
    "automation",
    options,
  );
  await firstListSelected;
  events.push(repairEvent());
  const second = shadowInternals.repairSignalOptionsAutomationMirrorsForRead(
    "automation",
    options,
  );
  releaseFirstList();
  await Promise.all([first, second]);

  assert.equal(listCount, 2);
  assert.deepEqual(orders, [{ sourceEventId: events[0]!.id, side: "sell" }]);
});

test("repair cockpit requests received during closed reconciliation stay pending for the next normal tick", async () => {
  const timers = createFakeTimers();
  const cockpit: {
    listener?: (change: { reason: string }) => void;
  } = {};
  let closedCount = 0;
  const worker = createSignalOptionsWorker({
    listDeployments: async () => [],
    scanDeployment: async () => ({}),
    runOpenSafety: async () => ({}),
    runClosedReconciliation: async () => {
      closedCount += 1;
      if (closedCount === 2) {
        cockpit.listener?.({
          reason: "signal_options_shadow_repair_requested",
        });
      }
      return {};
    },
    acquireTickLock: async () =>
      Object.assign(async () => {}, {
        signal: new AbortController().signal,
      }),
    now: () => new Date("2026-07-15T12:00:00.000Z"),
    logger: { debug() {}, info() {}, warn() {} },
    scanTimeoutMs: null,
    subscribeCockpitChanges: (listener) => {
      cockpit.listener = listener;
      return () => {
        delete cockpit.listener;
      };
    },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  worker.start();
  await waitForAssertion(() => assert.equal(closedCount, 1));
  cockpit.listener?.({ reason: "signal_options_shadow_repair_requested" });
  const immediate = timers.pending(0)[0];
  assert.ok(immediate);
  immediate.fired = true;
  immediate.callback();
  await waitForAssertion(() => assert.equal(closedCount, 2));
  assert.equal(timers.pending(0).length, 0, "no zero-delay repair hot loop");

  const normalTick = timers.pending(5_000)[0];
  assert.ok(normalTick);
  normalTick.fired = true;
  normalTick.callback();
  await waitForAssertion(() => assert.equal(closedCount, 3));
  worker.stop();
});

test("lease loss during an explicit closed repair restores the request and its cooldown", async () => {
  const firstLease = new AbortController();
  const leaseLost = new Error("closed repair lease lost");
  let lockCount = 0;
  let closedCount = 0;
  const worker = createSignalOptionsWorker({
    listDeployments: async () => [],
    scanDeployment: async () => ({}),
    runOpenSafety: async () => ({}),
    runClosedReconciliation: async () => {
      closedCount += 1;
      if (closedCount === 1) {
        firstLease.abort(leaseLost);
      }
      return {};
    },
    acquireTickLock: async () => {
      lockCount += 1;
      const controller = lockCount === 1 ? firstLease : new AbortController();
      return Object.assign(async () => {}, { signal: controller.signal });
    },
    now: () => new Date("2026-07-15T12:00:00.000Z"),
    logger: { debug() {}, info() {}, warn() {} },
    scanTimeoutMs: null,
    subscribeCockpitChanges: () => () => {},
  });

  worker.requestClosedRepair();
  await worker.runOnce();
  await worker.runOnce();

  assert.equal(closedCount, 2);
});

test("worker snapshots and logger fields never retain credential-bearing dependency errors", async () => {
  const secret = "synthetic-worker-secret";
  const credentialError = new Error(
    `postgresql://demo:${secret}@db.invalid/pyrus?token=${secret}`,
  );
  const logged: unknown[] = [];
  const worker = createSignalOptionsWorker({
    listDeployments: async () => [
      {
        id: "deployment-credential-test",
        enabled: true,
        mode: "shadow",
        providerAccountId: null,
        symbolUniverse: ["CRM"],
        config: { signalOptions: { worker: { pollIntervalSeconds: 15 } } },
      } as never,
    ],
    scanDeployment: async () => {
      throw credentialError;
    },
    runOpenSafety: async () => ({
      errors: [{ reason: credentialError.message }],
    }),
    runClosedReconciliation: async () => ({
      errors: [{ reason: credentialError.message }],
    }),
    acquireTickLock: async () =>
      Object.assign(async () => {}, {
        signal: new AbortController().signal,
      }),
    now: () => new Date("2026-07-15T12:00:00.000Z"),
    logger: {
      debug() {},
      info() {},
      warn(fields: unknown) {
        logged.push(fields);
      },
    } as never,
    scanTimeoutMs: null,
    subscribeCockpitChanges: () => () => {},
  });

  await worker.runOnce();
  const serialized = JSON.stringify({
    snapshot: worker.getRuntimeSnapshot(),
    logged,
  });
  assert.doesNotMatch(serialized, new RegExp(secret, "u"));
  assert.doesNotMatch(serialized, /postgresql:\/\//u);
});

// NOT FULLY INTEGRATED WITHOUT A DB HARNESS:
//
// The dedup check above only proves the pure comparison is correct given
// events "as loaded from the DB". The actual order-placement-time guards
// that make double-selling real money impossible are both gated behind
// `db` queries and are not reachable through any exported pure seam:
//
//   - placeShadowOrder's sourceEventId/clientOrderId dedup
//     (shadow-account.ts, ~line 4437): looks up shadowOrdersTable by
//     sourceEventId/clientOrderId before inserting a new order/fill.
//   - buildShadowFillPlan's "Shadow account cannot sell more than the open
//     position" 409 (shadow-account.ts, ~line 4376, code
//     shadow_long_only_position_required): reads the live shadowPositionsTable
//     row's open quantity before allowing a sell.
//
// The overlapping-owner test above proves deterministic event ownership and
// winner-only side effects with a barrier fake. A database integration lane can
// additionally exercise the shadow-position FOR UPDATE sell serialization and
// unique sourceEventId/clientOrderId constraints end to end.
