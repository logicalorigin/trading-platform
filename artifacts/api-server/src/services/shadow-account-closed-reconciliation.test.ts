import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { eq } from "drizzle-orm";
import {
  algoDeploymentsTable,
  algoStrategiesTable,
  db,
  executionEventsTable,
  shadowAccountsTable,
  shadowFillsTable,
  shadowOrdersTable,
  shadowPositionsTable,
  type ExecutionEvent,
} from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";

import { __signalOptionsAutomationInternalsForTests as automationInternals } from "./signal-options-automation";
import {
  __shadowOptionMaintenanceInternalsForTests as maintenanceInternals,
  runShadowOptionClosedReconciliation,
  SHADOW_ACCOUNT_ID,
  type ShadowOptionMaintenanceSummary,
} from "./shadow-account";

const DEPLOYMENT_ID = "10000000-0000-4000-8000-000000000001";
const POSITION_ID = "20000000-0000-4000-8000-000000000001";
const ENTRY_EVENT_ID = "30000000-0000-4000-8000-000000000001";
const OPENED_AT = new Date("2026-07-15T14:30:00.000Z");
const CLOSED_AT = new Date("2026-07-15T18:00:00.000Z");
const NOW = new Date("2026-07-15T19:00:00.000Z");
const SYMBOL = "O:CRM260717C00250000";
const CONTRACT = {
  ticker: SYMBOL,
  underlying: "CRM",
  expirationDate: "2026-07-17",
  strike: 250,
  right: "call",
  multiplier: 10,
};

const emptySummary = (): ShadowOptionMaintenanceSummary => ({
  checkedCount: 0,
  dueCount: 0,
  closedCount: 0,
  skippedCount: 0,
  orphanCount: 0,
  forceClosedCount: 0,
  reconciledCount: 0,
  errors: [],
});

const closedPosition = (overrides: Record<string, unknown> = {}) =>
  ({
    id: POSITION_ID,
    accountId: "shadow-default",
    positionKey: SYMBOL,
    symbol: SYMBOL,
    assetClass: "option",
    quantity: "0",
    averageCost: "2.00",
    mark: "1.25",
    realizedPnl: "9876.54",
    fees: "12.34",
    optionContract: CONTRACT,
    openedAt: OPENED_AT,
    closedAt: CLOSED_AT,
    status: "closed",
    ...overrides,
  }) as never;

const entryOrder = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "40000000-0000-4000-8000-000000000001",
    accountId: "shadow-default",
    source: "automation",
    sourceEventId: ENTRY_EVENT_ID,
    symbol: SYMBOL,
    assetClass: "option",
    side: "buy",
    positionKey: SYMBOL,
    placedAt: OPENED_AT,
    payload: {
      metadata: { deploymentId: DEPLOYMENT_ID, positionKey: SYMBOL },
    },
    ...overrides,
  }) as never;

const entryEvent: ExecutionEvent = {
  id: ENTRY_EVENT_ID,
  deploymentId: DEPLOYMENT_ID,
  algoRunId: null,
  providerAccountId: "provider-account-1",
  symbol: SYMBOL,
  eventType: "signal_options_shadow_entry",
  summary: "CRM entry",
  occurredAt: OPENED_AT,
  createdAt: OPENED_AT,
  updatedAt: OPENED_AT,
  payload: {
    candidate: { id: "candidate-current" },
    position: {
      id: `${DEPLOYMENT_ID}:${SYMBOL}`,
      candidateId: "candidate-current",
    },
  },
};

type InsertedEvent = {
  id?: string;
  deploymentId: string;
  providerAccountId?: string | null;
  symbol: string;
  eventType: string;
  occurredAt: Date;
  payload: Record<string, unknown>;
};

const batchFixture = (index: number) => {
  const suffix = String(index + 1).padStart(12, "0");
  const symbol = `O:CRM260717C${String(25_000_000 + index).padStart(8, "0")}`;
  const positionId = `20000000-0000-4000-8000-${suffix}`;
  const eventId = `30000000-0000-4000-8000-${suffix}`;
  const candidateId = `candidate-${index + 1}`;
  const ledgerPositionId = `${DEPLOYMENT_ID}:${symbol}`;
  return {
    position: closedPosition({
      id: positionId,
      positionKey: symbol,
      symbol,
      optionContract: {
        ...CONTRACT,
        ticker: symbol,
        strike: 250 + index / 1_000,
      },
    }),
    order: entryOrder({
      id: `40000000-0000-4000-8000-${suffix}`,
      sourceEventId: eventId,
      positionKey: symbol,
      symbol,
      optionContract: {
        ...CONTRACT,
        ticker: symbol,
        strike: 250 + index / 1_000,
      },
      payload: {
        metadata: { deploymentId: DEPLOYMENT_ID, positionKey: symbol },
      },
    }),
    event: {
      ...(entryEvent as unknown as Record<string, unknown>),
      id: eventId,
      symbol,
      payload: {
        candidate: { id: candidateId },
        position: { id: ledgerPositionId, candidateId },
      },
    } as never,
    fill: {
      side: "sell" as const,
      quantity: "2",
      price: "1.25",
      occurredAt: CLOSED_AT,
    },
    exit: {
      positionId,
      openedAt: OPENED_AT,
      closedAt: CLOSED_AT,
      deploymentId: DEPLOYMENT_ID,
      symbol,
      occurredAt: CLOSED_AT,
      payload: {},
    },
    candidateId,
    ledgerPositionId,
    positionId,
    symbol,
  };
};

async function runInjectedClosedPass(input: {
  fixtures: ReturnType<typeof batchFixture>[];
  missingPositionId?: string;
}) {
  let reads = 0;
  let notifications = 0;
  let eligibleCount = 0;
  const inserted: InsertedEvent[] = [];
  const byPositionId = new Map(
    input.fixtures.map((fixture) => [fixture.positionId, fixture]),
  );

  maintenanceInternals.setDependenciesForTests({
    listDeployments: async () => {
      reads += 1;
      return [{ id: DEPLOYMENT_ID }];
    },
    repairAutomationMirrors: async () => {
      reads += 1;
      return {
        checkedCount: 0,
        missingCount: 0,
        repairedCount: 0,
        errorCount: 0,
      };
    },
    reconcileClosedWithoutExit: async ({ now, deploymentIds, summary }) => {
      reads += 1;
      await maintenanceInternals.reconcileClosedRowsForTests({
        now,
        deploymentIds,
        summary,
        closedRows: input.fixtures.map((fixture) => fixture.position),
        dependencies: {
          loadEntryBundles: async (rows) => {
            reads += 1;
            return rows.flatMap(({ position }) => {
              const fixture = byPositionId.get(position.id);
              return fixture
                ? [
                    {
                      positionId: position.id,
                      order: fixture.order,
                      entryEvent: fixture.event,
                    },
                  ]
                : [];
            });
          },
          loadLifecycleEvidence: async (candidates) => {
            reads += 1;
            eligibleCount = candidates.length;
            return {
              finalFills: candidates.flatMap((candidate) => {
                const fixture = byPositionId.get(candidate.position.id);
                return fixture
                  ? [
                      {
                        positionId: candidate.position.id,
                        openedAt: candidate.openedAt,
                        closedAt: candidate.closedAt,
                        fill: fixture.fill,
                        order: fixture.order,
                      },
                    ]
                  : [];
              }),
              finalExits: candidates.flatMap((candidate) => {
                const fixture = byPositionId.get(candidate.position.id);
                return fixture && fixture.positionId !== input.missingPositionId
                  ? [fixture.exit]
                  : [];
              }),
            };
          },
          insertExitEvent: async (event: unknown) => {
            inserted.push(event as InsertedEvent);
            return true;
          },
          notify: () => {
            notifications += 1;
          },
        },
      });
    },
  });

  try {
    const summary = await runShadowOptionClosedReconciliation({ now: NOW });
    return { eligibleCount, inserted, notifications, reads, summary };
  } finally {
    maintenanceInternals.setDependenciesForTests(null);
  }
}

type ClosedTestDependencies = NonNullable<
  Parameters<
    typeof maintenanceInternals.reconcileClosedRowsForTests
  >[0]["dependencies"]
>;
type ClosedTestRow = Parameters<
  ClosedTestDependencies["loadEntryBundles"]
>[0][number];
type ClosedTestEntryBundle = Awaited<
  ReturnType<ClosedTestDependencies["loadEntryBundles"]>
>[number];
type ClosedTestEvidence = Awaited<
  ReturnType<ClosedTestDependencies["loadLifecycleEvidence"]>
>;

function batchedDependencies(input: {
  findEntryOrder(
    position: ClosedTestRow["position"],
  ): Promise<ClosedTestEntryBundle["order"] | null>;
  findEntryEvent(id: string): Promise<ClosedTestEntryBundle["entryEvent"]>;
  listLifecycleExitFills(
    position: ClosedTestRow["position"],
  ): Promise<ClosedTestEvidence["finalFills"][number]["fill"][]>;
  listExitEvents(candidate: {
    deploymentId: string;
    symbol: string;
    since: Date;
    until: Date;
  }): Promise<
    Array<{
      deploymentId: string | null;
      symbol: string | null;
      occurredAt: Date;
      payload?: unknown;
    }>
  >;
  insertExitEvent: ClosedTestDependencies["insertExitEvent"];
  notify: ClosedTestDependencies["notify"];
}): ClosedTestDependencies {
  return {
    loadEntryBundles: async (rows) => {
      const bundles: ClosedTestEntryBundle[] = [];
      for (const row of rows) {
        const order = await input.findEntryOrder(row.position);
        if (!order) {
          continue;
        }
        bundles.push({
          positionId: row.position.id,
          order,
          entryEvent: order.sourceEventId
            ? await input.findEntryEvent(order.sourceEventId)
            : undefined,
        });
      }
      return bundles;
    },
    loadLifecycleEvidence: async (candidates) => {
      const finalFills: ClosedTestEvidence["finalFills"] = [];
      const finalExits: ClosedTestEvidence["finalExits"] = [];
      for (const candidate of candidates) {
        const fills = await input.listLifecycleExitFills(candidate.position);
        finalFills.push(
          ...fills.map((fill) => ({
            positionId: candidate.position.id,
            openedAt: candidate.openedAt,
            closedAt: candidate.closedAt,
            fill,
            order: candidate.sourceOrder,
          })),
        );
        const latestExit = (
          await input.listExitEvents({
            deploymentId: candidate.deploymentId,
            symbol: candidate.normalizedSymbol,
            since: candidate.openedAt,
            until: candidate.closedAt,
          })
        )
          .filter(
            (event) =>
              event.deploymentId === candidate.deploymentId &&
              event.symbol === candidate.normalizedSymbol &&
              event.occurredAt.getTime() >= candidate.openedAt.getTime() &&
              event.occurredAt.getTime() <= candidate.closedAt.getTime() &&
              (event.payload as Record<string, unknown> | undefined)
                ?.partial !== true,
          )
          .sort(
            (left, right) =>
              right.occurredAt.getTime() - left.occurredAt.getTime(),
          )[0];
        if (latestExit) {
          finalExits.push({
            positionId: candidate.position.id,
            openedAt: candidate.openedAt,
            closedAt: candidate.closedAt,
            deploymentId: candidate.deploymentId,
            symbol: candidate.normalizedSymbol,
            occurredAt: latestExit.occurredAt,
          } as never);
        }
      }
      return { finalFills, finalExits };
    },
    insertExitEvent: input.insertExitEvent,
    notify: input.notify,
  };
}

test("production closed reconciliation keeps exactly two fixed batch queries", () => {
  const source = readFileSync(
    new URL("./shadow-account.ts", import.meta.url),
    "utf8",
  );
  const loadersStart = source.indexOf(
    "const defaultShadowOptionClosedReconciliationDependencies",
  );
  const loadersEnd = source.indexOf(
    "// ponytail: this process-local claim",
    loadersStart,
  );
  assert.ok(loadersStart >= 0 && loadersEnd > loadersStart);

  const loaders = source.slice(loadersStart, loadersEnd);
  const evidenceStart = loaders.indexOf("loadLifecycleEvidence:");
  assert.ok(evidenceStart > 0);
  const entryLoader = loaders.slice(0, evidenceStart);
  const evidenceLoader = loaders.slice(evidenceStart);

  assert.equal((loaders.match(/pool\.query/g) ?? []).length, 2);
  assert.equal((entryLoader.match(/pool\.query/g) ?? []).length, 1);
  assert.equal((evidenceLoader.match(/pool\.query/g) ?? []).length, 1);
  assert.match(entryLoader, /if \(!rows\.length\)/);
  assert.match(evidenceLoader, /if \(!candidates\.length\)/);
  assert.match(entryLoader, /cross join lateral[\s\S]*limit 2/);
  assert.match(
    entryLoader,
    /positionKey[\s\S]*= candidate\.position_key[\s\S]*order by[\s\S]*limit 2/,
  );
  assert.match(entryLoader, /candidate_order\.source = 'automation'/);
  assert.doesNotMatch(
    entryLoader,
    /candidate_order\.source in \('automation', 'signal_options_replay'\)/,
  );
  assert.match(evidenceLoader, /cross join lateral[\s\S]*limit 2/);
  assert.match(evidenceLoader, /candidate\.position_key/);
  assert.match(evidenceLoader, /candidate\.ledger_position_id/);
  assert.match(evidenceLoader, /candidate\.ledger_opened_at/);
  assert.match(evidenceLoader, /candidate\.contract_ticker/);
  assert.match(evidenceLoader, /candidate\.contract_provider_id/);
  assert.match(evidenceLoader, /lifecycle_universe as/i);
  assert.doesNotMatch(
    evidenceLoader,
    /from candidates competing_(?:contract|candidate)/,
  );
  assert.match(
    evidenceLoader,
    /from lifecycle_universe competing_(?:contract|candidate)/,
  );
  assert.match(
    evidenceLoader,
    /exit_event\.payload->'metadata'->>'positionKey'[\s\S]*candidate\.position_key/,
  );
  assert.match(
    evidenceLoader,
    /exit_event\.occurred_at <= candidate\.closed_at/,
  );
  const exitJoin = evidenceLoader.indexOf("join execution_events exit_event");
  const historicalExitFilter = evidenceLoader.indexOf(
    "and not coalesce((",
    exitJoin,
  );
  const exitAggregation = evidenceLoader.indexOf(
    "group by",
    historicalExitFilter,
  );
  assert.notEqual(exitJoin, -1);
  assert.notEqual(historicalExitFilter, -1);
  assert.notEqual(exitAggregation, -1);
  assert.ok(historicalExitFilter < exitAggregation);
  for (const historicalMarker of [
    "backfillEventKey",
    "metadata'->>'runSource",
    "metadata'->>'sourceType",
    "metadata'->>'runMode",
    "backfill'->>'source",
    "replay'->>'source",
  ]) {
    assert.ok(
      evidenceLoader.indexOf(historicalMarker, historicalExitFilter) <
        exitAggregation,
      `missing pre-aggregation historical marker ${historicalMarker}`,
    );
  }
  for (const loader of [entryLoader, evidenceLoader]) {
    const queryIndex = loader.indexOf("pool.query");
    for (const loopMarker of ["for (", "while (", ".map("]) {
      const loopIndex = loader.indexOf(loopMarker);
      assert.ok(loopIndex < 0 || queryIndex < loopIndex);
    }
  }
  assert.doesNotMatch(
    loaders,
    /findSignalOptionsEntryOrderForPosition|hasExistingSignalOptionsShadowExitEvent/,
  );

  const reconcileStart = source.indexOf(
    "async function reconcileShadowOptionClosedRows",
  );
  const reconcileEnd = source.indexOf(
    "async function reconcileShadowOptionClosedWithoutExit",
    reconcileStart,
  );
  const reconciliation = source.slice(reconcileStart, reconcileEnd);
  assert.doesNotMatch(
    reconciliation,
    /dependencies\.(findEntryOrder|findEntryEvent|listLifecycleExitFills|listExitEvents)/,
  );

  const schedulerStart = source.indexOf(
    "async function reconcileShadowOptionClosedWithoutExit",
  );
  const schedulerEnd = source.indexOf(
    "function normalizeSignalOptionsReplaySource",
    schedulerStart,
  );
  const scheduler = source.slice(schedulerStart, schedulerEnd);
  assert.match(source, /const SHADOW_RECONCILE_BATCH_SIZE = 250/);
  assert.match(scheduler, /\.limit\(SHADOW_RECONCILE_BATCH_SIZE\)/);
  assert.match(scheduler, /shadowOptionClosedReconciliationCursor/);
  assert.match(
    scheduler,
    /lt\(shadowPositionsTable\.closedAt, cursor\.closedAt\)/,
  );
  assert.match(scheduler, /lte\(shadowPositionsTable\.closedAt, input\.now\)/);
});

async function assertGlobalLegacyFinalAmbiguity(input: {
  linkSecondOrder: boolean;
  firstEntryOpenedAt?: string;
  secondEntryOpenedAt: string;
  secondClosedAt?: Date;
  legacyExitOpenedAt?: string | null;
  legacyExitCandidateId?: string;
  candidateLedgerOpenedAt?: string;
  expectedFirstFinals?: number;
  expectedSecondFinals?: number;
}) {
  await withTestDb(async () => {
    const strategyId = "10000000-0000-4000-8000-000000000002";
    const secondPositionId = "20000000-0000-4000-8000-000000000002";
    const secondEntryEventId = "30000000-0000-4000-8000-000000000002";
    const legacyExitEventId = "30000000-0000-4000-8000-000000000003";
    const ledgerPositionId = `${DEPLOYMENT_ID}:CRM`;
    const secondSymbol = "O:CRM260717C00255000";
    const secondContract = {
      ...CONTRACT,
      ticker: secondSymbol,
      strike: 255,
    };
    await db.insert(shadowAccountsTable).values({
      id: SHADOW_ACCOUNT_ID,
      displayName: "Shadow",
      startingBalance: "25000",
      cash: "25000",
    });
    await db.insert(algoStrategiesTable).values({
      id: strategyId,
      name: "Cross-page legacy ambiguity",
      mode: "shadow",
      enabled: true,
      symbolUniverse: ["CRM"],
      config: {},
    });
    await db.insert(algoDeploymentsTable).values({
      id: DEPLOYMENT_ID,
      strategyId,
      name: "Cross-page legacy ambiguity",
      mode: "shadow",
      enabled: true,
      providerAccountId: SHADOW_ACCOUNT_ID,
      symbolUniverse: ["CRM"],
      config: {},
    });
    const entry = (
      id: string,
      candidateId: string,
      positionKey: string,
      contract: typeof CONTRACT,
      openedAt = OPENED_AT.toISOString(),
    ) => ({
      id,
      deploymentId: DEPLOYMENT_ID,
      providerAccountId: SHADOW_ACCOUNT_ID,
      symbol: "CRM",
      eventType: "signal_options_shadow_entry",
      summary: "CRM entry",
      occurredAt: OPENED_AT,
      payload: {
        metadata: { positionKey },
        selectedContract: contract,
        candidate: { id: candidateId },
        position: {
          id: ledgerPositionId,
          candidateId,
          openedAt,
          positionKey,
          selectedContract: contract,
        },
      },
    });
    const firstEntry = entry(
      ENTRY_EVENT_ID,
      "candidate-first",
      SYMBOL,
      CONTRACT,
      input.firstEntryOpenedAt,
    );
    const secondEntry = entry(
      secondEntryEventId,
      "candidate-second",
      secondSymbol,
      secondContract,
      input.secondEntryOpenedAt,
    );
    await db.insert(executionEventsTable).values([
      firstEntry,
      secondEntry,
      {
        id: legacyExitEventId,
        deploymentId: DEPLOYMENT_ID,
        providerAccountId: SHADOW_ACCOUNT_ID,
        symbol: "CRM",
        eventType: "signal_options_shadow_exit",
        summary: "legacy final",
        occurredAt: CLOSED_AT,
        payload: {
          exitQuantity: 2,
          position: {
            id: ledgerPositionId,
            ...(input.legacyExitOpenedAt === null
              ? {}
              : {
                  openedAt: input.legacyExitOpenedAt ?? OPENED_AT.toISOString(),
                }),
            ...(input.legacyExitCandidateId
              ? { candidateId: input.legacyExitCandidateId }
              : {}),
            quantity: 2,
          },
        },
      },
    ]);
    const positions = [
      closedPosition({ accountId: SHADOW_ACCOUNT_ID, symbol: "CRM" }),
      closedPosition({
        id: secondPositionId,
        accountId: SHADOW_ACCOUNT_ID,
        positionKey: secondSymbol,
        symbol: "CRM",
        optionContract: secondContract,
        closedAt: input.secondClosedAt ?? CLOSED_AT,
      }),
    ];
    await db.insert(shadowPositionsTable).values(positions as never);
    const orders = [
      {
        id: "40000000-0000-4000-8000-000000000001",
        sourceEventId: ENTRY_EVENT_ID,
        symbol: "CRM",
        optionContract: CONTRACT,
        positionKey: SYMBOL,
      },
      {
        id: "40000000-0000-4000-8000-000000000002",
        sourceEventId: input.linkSecondOrder ? secondEntryEventId : null,
        symbol: "CRM",
        optionContract: secondContract,
        positionKey: secondSymbol,
      },
    ].map((order) => ({
      id: order.id,
      accountId: SHADOW_ACCOUNT_ID,
      source: "automation",
      sourceEventId: order.sourceEventId,
      symbol: order.symbol,
      assetClass: "option",
      side: "buy" as const,
      quantity: "2",
      filledQuantity: "2",
      averageFillPrice: "2",
      optionContract: order.optionContract,
      payload: {
        selectedContract: order.optionContract,
        metadata: {
          deploymentId: DEPLOYMENT_ID,
          positionKey: order.positionKey,
        },
        candidate: {
          id:
            order.positionKey === SYMBOL
              ? "candidate-first"
              : "candidate-second",
        },
        position: {
          id: ledgerPositionId,
          candidateId:
            order.positionKey === SYMBOL
              ? "candidate-first"
              : "candidate-second",
          openedAt: OPENED_AT.toISOString(),
          positionKey: order.positionKey,
          quantity: 2,
          selectedContract: order.optionContract,
        },
      },
      placedAt: OPENED_AT,
    }));
    await db.insert(shadowOrdersTable).values(orders);
    const candidates = [
      {
        position: positions[0],
        contract: CONTRACT,
        openedAt: OPENED_AT,
        closedAt: CLOSED_AT,
        sourceOrder: orders[0],
        sourceEntryEvent: firstEntry,
        deploymentId: DEPLOYMENT_ID,
        normalizedSymbol: "CRM",
        positionKey: SYMBOL,
        ledgerPositionId,
        ledgerOpenedAt:
          input.candidateLedgerOpenedAt ?? OPENED_AT.toISOString(),
        ledgerCandidateId: "candidate-first",
      },
      {
        position: positions[1],
        contract: secondContract,
        openedAt: OPENED_AT,
        closedAt: input.secondClosedAt ?? CLOSED_AT,
        sourceOrder: orders[1],
        sourceEntryEvent: input.linkSecondOrder ? secondEntry : undefined,
        deploymentId: DEPLOYMENT_ID,
        normalizedSymbol: "CRM",
        positionKey: secondSymbol,
        ledgerPositionId,
        ledgerOpenedAt:
          input.candidateLedgerOpenedAt ?? OPENED_AT.toISOString(),
        ledgerCandidateId: input.linkSecondOrder ? "candidate-second" : null,
      },
    ];

    const firstPage =
      await maintenanceInternals.loadClosedLifecycleEvidenceForTests([
        candidates[0] as never,
      ]);
    const secondPage =
      await maintenanceInternals.loadClosedLifecycleEvidenceForTests([
        candidates[1] as never,
      ]);
    const samePage =
      await maintenanceInternals.loadClosedLifecycleEvidenceForTests(
        candidates as never,
      );

    assert.equal(samePage.finalExits.length, input.expectedFirstFinals ?? 0);
    assert.equal(firstPage.finalExits.length, input.expectedFirstFinals ?? 0);
    assert.equal(secondPage.finalExits.length, input.expectedSecondFinals ?? 0);
  });
}

test("legacy final-exit ambiguity canonicalizes equivalent entry timestamps across pages", async () => {
  await assertGlobalLegacyFinalAmbiguity({
    linkSecondOrder: true,
    secondEntryOpenedAt: "2026-07-15T14:30:00+00:00",
  });
});

test("legacy final-exit ambiguity trims JavaScript whitespace around entry timestamps", async () => {
  const openedAt = "2026-07-15T15:00:00.000Z";
  const paddedOpenedAt = `\u00a0${openedAt}\t`;
  await assertGlobalLegacyFinalAmbiguity({
    linkSecondOrder: true,
    firstEntryOpenedAt: paddedOpenedAt,
    secondEntryOpenedAt: paddedOpenedAt,
    legacyExitOpenedAt: openedAt,
    candidateLedgerOpenedAt: openedAt,
  });
});

test("legacy final-exit ambiguity includes an exact unlinked entry order across pages", async () => {
  await assertGlobalLegacyFinalAmbiguity({
    linkSecondOrder: false,
    secondEntryOpenedAt: OPENED_AT.toISOString(),
  });
});

test("legacy final-exit ambiguity falls back safely from a malformed entry timestamp", async () => {
  await assertGlobalLegacyFinalAmbiguity({
    linkSecondOrder: true,
    secondEntryOpenedAt: "not-a-timestamp",
  });
});

for (const specialTimestamp of ["infinity", "now"]) {
  test(`legacy final-exit ambiguity falls back safely from PostgreSQL timestamp ${specialTimestamp}`, async () => {
    await assertGlobalLegacyFinalAmbiguity({
      linkSecondOrder: true,
      secondEntryOpenedAt: specialTimestamp,
    });
  });
}

test("contract ambiguity ignores a lifecycle that closed before the legacy exit", async () => {
  await assertGlobalLegacyFinalAmbiguity({
    linkSecondOrder: true,
    secondEntryOpenedAt: OPENED_AT.toISOString(),
    secondClosedAt: new Date("2026-07-15T17:00:00.000Z"),
    legacyExitOpenedAt: null,
    legacyExitCandidateId: "candidate-first",
    expectedFirstFinals: 1,
  });
});

test("closed reconciliation recognizes provider-only final evidence for an enriched contract", async () => {
  await withTestDb(async () => {
    const strategyId = "10000000-0000-4000-8000-000000000004";
    await db.insert(algoStrategiesTable).values({
      id: strategyId,
      name: "Provider alias evidence",
      mode: "shadow",
      enabled: true,
      symbolUniverse: ["CRM"],
      config: {},
    });
    await db.insert(algoDeploymentsTable).values({
      id: DEPLOYMENT_ID,
      strategyId,
      name: "Provider alias evidence",
      mode: "shadow",
      enabled: true,
      providerAccountId: SHADOW_ACCOUNT_ID,
      symbolUniverse: ["CRM"],
      config: {},
    });
    const providerContractId = "crm-250-call";
    await db.insert(executionEventsTable).values({
      id: "30000000-0000-4000-8000-000000000004",
      deploymentId: DEPLOYMENT_ID,
      providerAccountId: SHADOW_ACCOUNT_ID,
      symbol: "CRM",
      eventType: "signal_options_shadow_exit",
      summary: "provider-only final",
      occurredAt: CLOSED_AT,
      payload: {
        exitQuantity: 2,
        selectedContract: { providerContractId },
        position: {
          id: `${DEPLOYMENT_ID}:CRM`,
          openedAt: OPENED_AT.toISOString(),
          quantity: 2,
          selectedContract: { providerContractId },
        },
      },
    });
    const enrichedContract = { ...CONTRACT, providerContractId };
    const [position] = [
      closedPosition({
        accountId: SHADOW_ACCOUNT_ID,
        symbol: "CRM",
        optionContract: enrichedContract,
      }),
    ];
    const evidence =
      await maintenanceInternals.loadClosedLifecycleEvidenceForTests([
        {
          position,
          contract: enrichedContract,
          openedAt: OPENED_AT,
          closedAt: CLOSED_AT,
          sourceOrder: entryOrder({ symbol: "CRM" }),
          sourceEntryEvent: entryEvent,
          deploymentId: DEPLOYMENT_ID,
          normalizedSymbol: "CRM",
          positionKey: SYMBOL,
          ledgerPositionId: `${DEPLOYMENT_ID}:CRM`,
          ledgerOpenedAt: OPENED_AT.toISOString(),
          ledgerCandidateId: "candidate-current",
        } as never,
      ]);

    assert.equal(evidence.finalExits.length, 1);

    await db.update(executionEventsTable).set({
      payload: {
        exitQuantity: 2,
        selectedContract: { providerContractId },
        position: {
          id: `${DEPLOYMENT_ID}:CRM`,
          openedAt: "not-a-timestamp",
          quantity: 2,
          selectedContract: { providerContractId },
        },
      },
    });
    const malformed =
      await maintenanceInternals.loadClosedLifecycleEvidenceForTests([
        {
          position,
          contract: enrichedContract,
          openedAt: OPENED_AT,
          closedAt: CLOSED_AT,
          sourceOrder: entryOrder({ symbol: "CRM" }),
          sourceEntryEvent: entryEvent,
          deploymentId: DEPLOYMENT_ID,
          normalizedSymbol: "CRM",
          positionKey: SYMBOL,
          ledgerPositionId: `${DEPLOYMENT_ID}:CRM`,
          ledgerOpenedAt: OPENED_AT.toISOString(),
          ledgerCandidateId: "candidate-current",
        } as never,
      ]);
    assert.equal(malformed.finalExits.length, 0);

    const conflictingProviderContractId = "crm-255-call";
    await db.update(executionEventsTable).set({
      payload: {
        exitQuantity: 2,
        selectedContract: {
          providerContractId: conflictingProviderContractId,
        },
        position: {
          id: `${DEPLOYMENT_ID}:CRM`,
          openedAt: OPENED_AT.toISOString(),
          positionKey: SYMBOL,
          quantity: 2,
          selectedContract: {
            providerContractId: conflictingProviderContractId,
          },
        },
      },
    });
    const conflicting =
      await maintenanceInternals.loadClosedLifecycleEvidenceForTests([
        {
          position,
          contract: enrichedContract,
          openedAt: OPENED_AT,
          closedAt: CLOSED_AT,
          sourceOrder: entryOrder({ symbol: "CRM" }),
          sourceEntryEvent: entryEvent,
          deploymentId: DEPLOYMENT_ID,
          normalizedSymbol: "CRM",
          positionKey: SYMBOL,
          ledgerPositionId: `${DEPLOYMENT_ID}:CRM`,
          ledgerOpenedAt: OPENED_AT.toISOString(),
          ledgerCandidateId: "candidate-current",
        } as never,
      ]);
    assert.equal(conflicting.finalExits.length, 0);
  });
});

test("closed reconciliation persists one final from an exact filled order after its entry event ages out", async () => {
  await withTestDb(async () => {
    const strategyId = "10000000-0000-4000-8000-000000000005";
    const buyOrderId = "40000000-0000-4000-8000-000000000001";
    const sellOrderId = "40000000-0000-4000-8000-000000000005";
    const sellFillId = "50000000-0000-4000-8000-000000000005";
    const ledgerPositionId = `${DEPLOYMENT_ID}:CRM`;
    await db.insert(shadowAccountsTable).values({
      id: SHADOW_ACCOUNT_ID,
      displayName: "Shadow",
      startingBalance: "25000",
      cash: "25000",
    });
    await db.insert(algoStrategiesTable).values({
      id: strategyId,
      name: "Aged entry reconciliation",
      mode: "shadow",
      enabled: true,
      symbolUniverse: ["CRM"],
      config: {},
    });
    await db.insert(algoDeploymentsTable).values({
      id: DEPLOYMENT_ID,
      strategyId,
      name: "Aged entry reconciliation",
      mode: "shadow",
      enabled: true,
      providerAccountId: SHADOW_ACCOUNT_ID,
      symbolUniverse: ["CRM"],
      config: {},
    });
    const position = closedPosition({
      accountId: SHADOW_ACCOUNT_ID,
      symbol: "CRM",
    });
    await db.insert(shadowPositionsTable).values(position);
    await db.insert(shadowOrdersTable).values([
      {
        id: buyOrderId,
        accountId: SHADOW_ACCOUNT_ID,
        source: "automation",
        sourceEventId: ENTRY_EVENT_ID,
        symbol: "CRM",
        assetClass: "option",
        side: "buy",
        quantity: "2",
        filledQuantity: "2",
        averageFillPrice: "2",
        optionContract: CONTRACT,
        payload: {
          metadata: {
            deploymentId: DEPLOYMENT_ID,
            positionKey: SYMBOL,
          },
          selectedContract: CONTRACT,
          position: {
            id: ledgerPositionId,
            candidateId: "candidate-current",
            openedAt: OPENED_AT.toISOString(),
            positionKey: SYMBOL,
            quantity: 2,
            selectedContract: CONTRACT,
          },
        },
        placedAt: OPENED_AT,
      },
      {
        id: sellOrderId,
        accountId: SHADOW_ACCOUNT_ID,
        source: "automation",
        symbol: "CRM",
        assetClass: "option",
        side: "sell",
        quantity: "2",
        filledQuantity: "2",
        averageFillPrice: "1.25",
        optionContract: CONTRACT,
        payload: { metadata: { positionKey: SYMBOL } },
        placedAt: CLOSED_AT,
      },
    ]);
    await db.insert(shadowFillsTable).values({
      id: sellFillId,
      accountId: SHADOW_ACCOUNT_ID,
      orderId: sellOrderId,
      symbol: "CRM",
      assetClass: "option",
      side: "sell",
      quantity: "2",
      price: "1.25",
      grossAmount: "250",
      cashDelta: "250",
      optionContract: CONTRACT,
      occurredAt: CLOSED_AT,
    });

    await db
      .update(shadowOrdersTable)
      .set({ source: "signal_options_replay" })
      .where(eq(shadowOrdersTable.id, sellOrderId));
    const replaySummary = emptySummary();
    await maintenanceInternals.reconcileClosedRowsForTests({
      now: NOW,
      deploymentIds: new Set([DEPLOYMENT_ID]),
      summary: replaySummary,
      closedRows: [position],
    });
    assert.equal(replaySummary.reconciledCount, 0);
    assert.equal((await db.select().from(executionEventsTable)).length, 0);
    await db
      .update(shadowOrdersTable)
      .set({ source: "automation" })
      .where(eq(shadowOrdersTable.id, sellOrderId));

    const firstSummary = emptySummary();
    await maintenanceInternals.reconcileClosedRowsForTests({
      now: NOW,
      deploymentIds: new Set([DEPLOYMENT_ID]),
      summary: firstSummary,
      closedRows: [position],
    });
    const firstEvents = await db.select().from(executionEventsTable);
    assert.equal(firstSummary.reconciledCount, 1);
    assert.equal(
      firstEvents.filter(
        ({ eventType }) => eventType === "signal_options_shadow_entry",
      ).length,
      0,
    );
    assert.equal(
      firstEvents.filter(
        ({ eventType }) => eventType === "signal_options_shadow_exit",
      ).length,
      1,
    );
    assert.equal(firstEvents[0]?.payload.sourceOrderId, buyOrderId);

    const secondSummary = emptySummary();
    await maintenanceInternals.reconcileClosedRowsForTests({
      now: NOW,
      deploymentIds: new Set([DEPLOYMENT_ID]),
      summary: secondSummary,
      closedRows: [position],
    });
    assert.equal(secondSummary.reconciledCount, 0);
    assert.equal((await db.select().from(executionEventsTable)).length, 1);
  });
});

test("scheduled closed reconciliation uses five reads for 123 already-healed lifecycles", async () => {
  const result = await runInjectedClosedPass({
    fixtures: Array.from({ length: 123 }, (_, index) => batchFixture(index)),
  });

  assert.equal(result.reads, 5);
  assert.equal(result.eligibleCount, 123);
  assert.equal(result.inserted.length, 0);
  assert.equal(result.notifications, 0);
  assert.equal(result.summary.reconciledCount, 0);
  assert.deepEqual(result.summary.errors, []);
});

test("scheduled closed reconciliation heals one of 124 lifecycles in five reads", async () => {
  const fixtures = Array.from({ length: 124 }, (_, index) =>
    batchFixture(index),
  );
  const missing = fixtures.at(-1)!;
  const result = await runInjectedClosedPass({
    fixtures,
    missingPositionId: missing.positionId,
  });

  assert.equal(result.reads, 5);
  assert.equal(result.eligibleCount, 124);
  assert.deepEqual(result.summary.errors, []);
  assert.equal(result.inserted.length, 1);
  assert.equal(result.notifications, 1);
  assert.equal(result.summary.reconciledCount, 1);
  assert.equal(result.inserted[0]?.occurredAt.getTime(), CLOSED_AT.getTime());
  assert.equal(result.inserted[0]?.payload.exitPrice, 1.25);
  assert.equal(result.inserted[0]?.payload.exitQuantity, 2);
  assert.equal(result.inserted[0]?.payload.pnl, -15);
  assert.equal(result.inserted[0]?.payload.candidateId, missing.candidateId);
  assert.equal(
    (result.inserted[0]?.payload.metadata as Record<string, unknown>)
      .positionKey,
    missing.symbol,
  );
  assert.equal(
    (result.inserted[0]?.payload.selectedContract as Record<string, unknown>)
      .ticker,
    missing.symbol,
  );
  assert.equal(
    (result.inserted[0]?.payload.position as Record<string, unknown>).id,
    missing.ledgerPositionId,
  );
  assert.equal(result.inserted[0]?.providerAccountId, "provider-account-1");
  assert.equal(result.inserted[0]?.deploymentId, DEPLOYMENT_ID);
  assert.equal(result.inserted[0]?.symbol, missing.symbol);
});

test("scheduled closed reconciliation uses three reads when no closed rows exist", async () => {
  const result = await runInjectedClosedPass({ fixtures: [] });

  assert.equal(result.reads, 3);
  assert.equal(result.inserted.length, 0);
  assert.equal(result.notifications, 0);
  assert.equal(result.summary.reconciledCount, 0);
  assert.deepEqual(result.summary.errors, []);
});

test("closed reconciliation selects the current lifecycle's final fill and emits creator-equivalent same-day P&L", async () => {
  const inserted: InsertedEvent[] = [];
  const summary = emptySummary();
  const finalQuantity = 2;
  const finalPrice = 1.25;
  const creatorPnl = automationInternals.signalOptionsRealizedPnl(
    finalPrice,
    2,
    finalQuantity,
    CONTRACT,
  );

  await maintenanceInternals.reconcileClosedRowsForTests({
    now: NOW,
    deploymentIds: new Set([DEPLOYMENT_ID]),
    summary,
    closedRows: [closedPosition()],
    dependencies: batchedDependencies({
      findEntryOrder: async () => entryOrder(),
      findEntryEvent: async () => entryEvent,
      listLifecycleExitFills: async () => [
        {
          side: "sell",
          quantity: String(finalQuantity),
          price: String(finalPrice),
          occurredAt: CLOSED_AT,
        },
        {
          side: "sell",
          quantity: "1",
          price: "1.50",
          occurredAt: new Date("2026-07-15T16:00:00.000Z"),
        },
      ],
      listExitEvents: async () => [
        {
          deploymentId: DEPLOYMENT_ID,
          symbol: SYMBOL,
          occurredAt: new Date("2026-07-14T18:00:00.000Z"),
          payload: {},
        },
        {
          deploymentId: DEPLOYMENT_ID,
          symbol: SYMBOL,
          occurredAt: new Date("2026-07-15T16:00:00.000Z"),
          payload: { partial: true, scaleOutId: "first_trail_arm" },
        },
      ],
      insertExitEvent: async (event: unknown) => {
        inserted.push(event as InsertedEvent);
        return true;
      },
      notify: () => undefined,
    }),
  });

  assert.equal(inserted.length, 1);
  assert.equal(summary.reconciledCount, 1);
  assert.equal(inserted[0]?.payload.pnl, creatorPnl);
  assert.notEqual(inserted[0]?.payload.pnl, 9876.54);
  assert.equal(inserted[0]?.payload.exitPrice, finalPrice);
  assert.equal(inserted[0]?.payload.exitQuantity, finalQuantity);
  assert.equal(inserted[0]?.occurredAt.getTime(), CLOSED_AT.getTime());

  const repairedDailyPnl =
    automationInternals.computeSignalOptionsDailyRealizedPnl(
      [
        {
          id: "repair-event",
          ...inserted[0],
        } as never,
      ],
      NOW,
    );
  const creatorDailyPnl =
    automationInternals.computeSignalOptionsDailyRealizedPnl(
      [
        {
          id: "creator-event",
          ...inserted[0],
          payload: { ...inserted[0]?.payload, pnl: creatorPnl },
        } as never,
      ],
      NOW,
    );
  assert.equal(repairedDailyPnl, creatorDailyPnl);
  assert.equal(
    automationInternals.computeSignalOptionsDailyRealizedPnl(
      [{ id: "repair-event", ...inserted[0] } as never],
      new Date("2026-07-16T19:00:00.000Z"),
    ),
    0,
  );
});

test("closed reconciliation fails closed for two exact final-fill candidates in either order", async () => {
  const fills = [
    {
      side: "sell" as const,
      quantity: "2",
      price: "1.25",
      occurredAt: CLOSED_AT,
    },
    {
      side: "sell" as const,
      quantity: "2",
      price: "1.30",
      occurredAt: CLOSED_AT,
    },
  ];

  for (const finalFills of [fills, [...fills].reverse()]) {
    const summary = emptySummary();
    let inserts = 0;
    let notifications = 0;
    await maintenanceInternals.reconcileClosedRowsForTests({
      now: NOW,
      deploymentIds: new Set([DEPLOYMENT_ID]),
      summary,
      closedRows: [closedPosition()],
      dependencies: batchedDependencies({
        findEntryOrder: async () => entryOrder(),
        findEntryEvent: async () => entryEvent,
        listLifecycleExitFills: async () => finalFills,
        listExitEvents: async () => [],
        insertExitEvent: async () => {
          inserts += 1;
          return true;
        },
        notify: () => {
          notifications += 1;
        },
      }),
    });

    assert.equal(inserts, 0);
    assert.equal(notifications, 0);
    assert.equal(summary.reconciledCount, 0);
    assert.equal(summary.errors.length, 1);
  }
});

test("closed reconciliation does not count an indeterminate insert as success", async () => {
  const summary = emptySummary();
  let notifications = 0;
  const dependencies = batchedDependencies({
    findEntryOrder: async () => entryOrder(),
    findEntryEvent: async () => entryEvent,
    listLifecycleExitFills: async () => [
      {
        side: "sell",
        quantity: "2",
        price: "1.25",
        occurredAt: CLOSED_AT,
      },
    ],
    listExitEvents: async () => [],
    insertExitEvent: async () => true,
    notify: () => {
      notifications += 1;
    },
  });
  dependencies.insertExitEvent = async () => undefined as never;

  await maintenanceInternals.reconcileClosedRowsForTests({
    now: NOW,
    deploymentIds: new Set([DEPLOYMENT_ID]),
    summary,
    closedRows: [closedPosition()],
    dependencies,
  });

  assert.equal(summary.reconciledCount, 0);
  assert.equal(notifications, 0);
});

test("a later same-symbol lifecycle exit cannot suppress repair of an earlier lifecycle", async () => {
  const earlyOpenedAt = new Date("2026-07-15T14:00:00.000Z");
  const earlyClosedAt = new Date("2026-07-15T15:00:00.000Z");
  const laterOpenedAt = new Date("2026-07-15T16:00:00.000Z");
  const laterClosedAt = new Date("2026-07-15T17:00:00.000Z");
  const earlyId = "20000000-0000-4000-8000-000000000010";
  const laterId = "20000000-0000-4000-8000-000000000011";
  const inserted: InsertedEvent[] = [];
  const summary = emptySummary();

  await maintenanceInternals.reconcileClosedRowsForTests({
    now: NOW,
    deploymentIds: new Set([DEPLOYMENT_ID]),
    summary,
    closedRows: [
      closedPosition({
        id: earlyId,
        openedAt: earlyOpenedAt,
        closedAt: earlyClosedAt,
      }),
      closedPosition({
        id: laterId,
        openedAt: laterOpenedAt,
        closedAt: laterClosedAt,
      }),
    ],
    dependencies: {
      loadEntryBundles: async (rows) =>
        rows.map((row, index) => ({
          positionId: row.position.id,
          order: entryOrder({
            id: `40000000-0000-4000-8000-00000000001${index}`,
            placedAt: row.openedAt,
          }),
          entryEvent,
        })),
      loadLifecycleEvidence: async (candidates) => ({
        finalFills: candidates.map((candidate) => ({
          positionId: candidate.position.id,
          openedAt: candidate.openedAt,
          closedAt: candidate.closedAt,
          fill: {
            side: "sell" as const,
            quantity: "1",
            price: "1.25",
            occurredAt: candidate.closedAt,
          },
          order: candidate.sourceOrder,
        })),
        finalExits: [
          {
            positionId: laterId,
            openedAt: laterOpenedAt,
            closedAt: laterClosedAt,
            deploymentId: DEPLOYMENT_ID,
            symbol: SYMBOL,
            occurredAt: laterClosedAt,
          } as never,
        ],
      }),
      insertExitEvent: async (event: unknown) => {
        inserted.push(event as InsertedEvent);
        return true;
      },
      notify: () => undefined,
    },
  });

  assert.equal(inserted.length, 1);
  assert.equal(inserted[0]?.occurredAt.getTime(), earlyClosedAt.getTime());
  assert.equal(summary.reconciledCount, 1);
});

test("closed reconciliation isolates malformed contracts and timestamps", async () => {
  const malformedContractId = "20000000-0000-4000-8000-000000000002";
  const invalidTimestampId = "20000000-0000-4000-8000-000000000003";
  const reversedTimestampId = "20000000-0000-4000-8000-000000000004";
  const futureTimestampId = "20000000-0000-4000-8000-000000000006";
  const validId = "20000000-0000-4000-8000-000000000005";
  const inserted: InsertedEvent[] = [];
  const summary = emptySummary();

  await maintenanceInternals.reconcileClosedRowsForTests({
    now: NOW,
    deploymentIds: new Set([DEPLOYMENT_ID]),
    summary,
    closedRows: [
      closedPosition({
        id: malformedContractId,
        optionContract: { ticker: SYMBOL },
      }),
      closedPosition({
        id: invalidTimestampId,
        openedAt: new Date("invalid"),
      }),
      closedPosition({
        id: reversedTimestampId,
        closedAt: new Date("2026-07-15T13:30:00.000Z"),
      }),
      closedPosition({
        id: futureTimestampId,
        closedAt: new Date("2026-07-15T20:00:00.000Z"),
      }),
      closedPosition({ id: validId }),
    ],
    dependencies: batchedDependencies({
      findEntryOrder: async () => entryOrder(),
      findEntryEvent: async () => entryEvent,
      listLifecycleExitFills: async () => [
        {
          side: "sell",
          quantity: "2",
          price: "1.25",
          occurredAt: CLOSED_AT,
        },
      ],
      listExitEvents: async () => [],
      insertExitEvent: async (event: unknown) => {
        inserted.push(event as InsertedEvent);
        return true;
      },
      notify: () => undefined,
    }),
  });

  assert.equal(inserted.length, 1);
  assert.equal(summary.reconciledCount, 1);
  assert.deepEqual(summary.errors, [
    {
      positionId: malformedContractId,
      symbol: SYMBOL,
      reason: "closed reconciliation option contract is invalid",
    },
    {
      positionId: invalidTimestampId,
      symbol: SYMBOL,
      reason: "closed reconciliation lifecycle timestamps are invalid",
    },
    {
      positionId: reversedTimestampId,
      symbol: SYMBOL,
      reason: "closed reconciliation lifecycle timestamps are invalid",
    },
    {
      positionId: futureTimestampId,
      symbol: SYMBOL,
      reason: "closed reconciliation lifecycle timestamps are invalid",
    },
  ]);
});

for (const failedLoader of ["entry", "evidence"] as const) {
  test(`closed reconciliation performs no creator action when the ${failedLoader} batch fails`, async () => {
    const summary = emptySummary();
    let inserts = 0;
    let notifications = 0;

    await assert.rejects(
      maintenanceInternals.reconcileClosedRowsForTests({
        now: NOW,
        deploymentIds: new Set([DEPLOYMENT_ID]),
        summary,
        closedRows: [closedPosition()],
        dependencies: {
          loadEntryBundles: async () => {
            if (failedLoader === "entry") {
              throw new Error("synthetic entry batch failure");
            }
            return [
              {
                positionId: POSITION_ID,
                order: entryOrder(),
                entryEvent,
              },
            ];
          },
          loadLifecycleEvidence: async () => {
            throw new Error("synthetic evidence batch failure");
          },
          insertExitEvent: async () => {
            inserts += 1;
            return true;
          },
          notify: () => {
            notifications += 1;
          },
        },
      }),
      new RegExp(`synthetic ${failedLoader} batch failure`),
    );

    assert.equal(inserts, 0);
    assert.equal(notifications, 0);
    assert.equal(summary.reconciledCount, 0);
    assert.deepEqual(summary.errors, []);
  });
}

test("closed reconciliation rejects a reused-symbol source order from a prior lifecycle", async () => {
  const inserted: InsertedEvent[] = [];
  const staleSummary = emptySummary();
  const currentSummary = emptySummary();
  const dependencies = (order: ReturnType<typeof entryOrder>) =>
    batchedDependencies({
      findEntryOrder: async () => order,
      findEntryEvent: async () => entryEvent,
      listLifecycleExitFills: async () => [
        {
          side: "sell" as const,
          quantity: "2",
          price: "1.25",
          occurredAt: CLOSED_AT,
        },
      ],
      listExitEvents: async () => [],
      insertExitEvent: async (event: unknown) => {
        inserted.push(event as InsertedEvent);
        return true;
      },
      notify: () => undefined,
    });

  await maintenanceInternals.reconcileClosedRowsForTests({
    now: NOW,
    deploymentIds: new Set([DEPLOYMENT_ID]),
    summary: staleSummary,
    closedRows: [closedPosition()],
    dependencies: dependencies(
      entryOrder({
        id: "40000000-0000-4000-8000-000000000000",
        sourceEventId: "30000000-0000-4000-8000-000000000000",
        placedAt: new Date("2026-07-14T14:30:00.000Z"),
      }),
    ),
  });
  assert.equal(inserted.length, 0);

  await maintenanceInternals.reconcileClosedRowsForTests({
    now: NOW,
    deploymentIds: new Set([DEPLOYMENT_ID]),
    summary: currentSummary,
    closedRows: [closedPosition()],
    dependencies: dependencies(entryOrder()),
  });
  assert.equal(inserted.length, 1);
  assert.equal(staleSummary.reconciledCount, 0);
  assert.equal(currentSummary.reconciledCount, 1);
});

for (const excludedOrder of [
  {
    label: "backfill",
    order: entryOrder({
      payload: {
        backfill: { source: "signal_options_backfill" },
        metadata: { deploymentId: DEPLOYMENT_ID, positionKey: SYMBOL },
      },
    }),
  },
  {
    label: "replay",
    order: entryOrder({
      source: "signal_options_replay",
      payload: {
        metadata: { deploymentId: DEPLOYMENT_ID, positionKey: SYMBOL },
        replay: { source: "signal_options_replay" },
      },
    }),
  },
  {
    label: "clean replay-source",
    order: entryOrder({
      source: "signal_options_replay",
      payload: {
        metadata: { deploymentId: DEPLOYMENT_ID, positionKey: SYMBOL },
      },
    }),
  },
] as const) {
  for (const excludedFirst of [true, false]) {
    test(`closed reconciliation rejects the exact ${excludedOrder.label} order ${excludedFirst ? "before" : "after"} a live row`, async () => {
      const inserted: InsertedEvent[] = [];
      const summary = emptySummary();
      let evidenceCandidateCount = -1;
      const bundles = [
        {
          positionId: POSITION_ID,
          order: excludedOrder.order,
          entryEvent,
        },
        {
          positionId: POSITION_ID,
          order: entryOrder({
            id: "40000000-0000-4000-8000-000000000099",
          }),
          entryEvent,
        },
      ];

      await maintenanceInternals.reconcileClosedRowsForTests({
        now: NOW,
        deploymentIds: new Set([DEPLOYMENT_ID]),
        summary,
        closedRows: [closedPosition()],
        dependencies: {
          loadEntryBundles: async () =>
            excludedFirst ? bundles : [...bundles].reverse(),
          loadLifecycleEvidence: async (candidates) => {
            evidenceCandidateCount = candidates.length;
            return { finalFills: [], finalExits: [] };
          },
          insertExitEvent: async (event: unknown) => {
            inserted.push(event as InsertedEvent);
            return true;
          },
          notify: () => undefined,
        },
      });

      assert.equal(evidenceCandidateCount, 0);
      assert.equal(inserted.length, 0);
      assert.equal(summary.reconciledCount, 0);
      assert.deepEqual(summary.errors, []);
    });
  }
}

test("closed reconciliation rejects a clean replay-source order as its only exact row", async () => {
  let evidenceCandidateCount = -1;

  await maintenanceInternals.reconcileClosedRowsForTests({
    now: NOW,
    deploymentIds: new Set([DEPLOYMENT_ID]),
    summary: emptySummary(),
    closedRows: [closedPosition()],
    dependencies: {
      loadEntryBundles: async () => [
        {
          positionId: POSITION_ID,
          order: entryOrder({
            source: "signal_options_replay",
            payload: {
              metadata: {
                deploymentId: DEPLOYMENT_ID,
                positionKey: SYMBOL,
              },
            },
          }),
          entryEvent,
        },
      ],
      loadLifecycleEvidence: async (candidates) => {
        evidenceCandidateCount = candidates.length;
        return { finalFills: [], finalExits: [] };
      },
      insertExitEvent: async () => true,
      notify: () => undefined,
    },
  });

  assert.equal(evidenceCandidateCount, 0);
});

test("closed reconciliation rejects a historical source entry event on an exact live order", async () => {
  let evidenceCandidateCount = -1;

  await maintenanceInternals.reconcileClosedRowsForTests({
    now: NOW,
    deploymentIds: new Set([DEPLOYMENT_ID]),
    summary: emptySummary(),
    closedRows: [closedPosition()],
    dependencies: {
      loadEntryBundles: async () => [
        {
          positionId: POSITION_ID,
          order: entryOrder(),
          entryEvent: {
            ...entryEvent,
            payload: {
              ...entryEvent.payload,
              metadata: {
                runSource: "signal_options_replay",
              },
            },
          },
        },
      ],
      loadLifecycleEvidence: async (candidates) => {
        evidenceCandidateCount = candidates.length;
        return { finalFills: [], finalExits: [] };
      },
      insertExitEvent: async () => true,
      notify: () => undefined,
    },
  });

  assert.equal(evidenceCandidateCount, 0);
});

test("closed reconciliation skips ambiguous exact live entry rows", async () => {
  const summary = emptySummary();
  let evidenceCandidateCount = -1;
  let inserts = 0;

  await maintenanceInternals.reconcileClosedRowsForTests({
    now: NOW,
    deploymentIds: new Set([DEPLOYMENT_ID]),
    summary,
    closedRows: [closedPosition()],
    dependencies: {
      loadEntryBundles: async () => [
        { positionId: POSITION_ID, order: entryOrder(), entryEvent },
        {
          positionId: POSITION_ID,
          order: entryOrder({
            id: "40000000-0000-4000-8000-000000000050",
            positionKey: "unrelated-position-key",
            payload: {
              metadata: {
                deploymentId: DEPLOYMENT_ID,
                positionKey: "unrelated-position-key",
              },
            },
          }),
          entryEvent,
        },
        {
          positionId: POSITION_ID,
          order: entryOrder({
            id: "40000000-0000-4000-8000-000000000099",
            sourceEventId: "30000000-0000-4000-8000-000000000099",
          }),
          entryEvent,
        },
      ],
      loadLifecycleEvidence: async (candidates) => {
        evidenceCandidateCount = candidates.length;
        return { finalFills: [], finalExits: [] };
      },
      insertExitEvent: async () => {
        inserts += 1;
        return true;
      },
      notify: () => undefined,
    },
  });

  assert.equal(evidenceCandidateCount, 0);
  assert.equal(inserts, 0);
  assert.equal(summary.reconciledCount, 0);
  assert.deepEqual(summary.errors, []);
});

test("closed reconciliation releases a failed insert for retry and then suppresses the persisted duplicate", async () => {
  const persisted: InsertedEvent[] = [];
  const summary = emptySummary();
  let insertAttempts = 0;
  const dependencies = batchedDependencies({
    findEntryOrder: async () => entryOrder(),
    findEntryEvent: async () => entryEvent,
    listLifecycleExitFills: async () => [
      {
        side: "sell" as const,
        quantity: "2",
        price: "1.25",
        occurredAt: CLOSED_AT,
      },
    ],
    listExitEvents: async () => persisted,
    insertExitEvent: async (event: unknown) => {
      insertAttempts += 1;
      if (insertAttempts === 1) {
        throw new Error("synthetic insert failure");
      }
      persisted.push(event as InsertedEvent);
      return true;
    },
    notify: () => undefined,
  });
  const run = () =>
    maintenanceInternals.reconcileClosedRowsForTests({
      now: NOW,
      deploymentIds: new Set([DEPLOYMENT_ID]),
      summary,
      closedRows: [closedPosition()],
      dependencies,
    });

  await run();
  assert.equal(persisted.length, 0);
  assert.equal(summary.reconciledCount, 0);
  assert.equal(summary.errors.length, 1);

  await run();
  assert.equal(persisted.length, 1);
  assert.equal(summary.reconciledCount, 1);

  await run();
  assert.equal(persisted.length, 1);
  assert.equal(insertAttempts, 2);
});

test("closed reconciliation coalesces overlapping attempts without double emit", async () => {
  const inserted: InsertedEvent[] = [];
  let releaseInsert!: () => void;
  let markInsertStarted!: () => void;
  const insertStarted = new Promise<void>((resolve) => {
    markInsertStarted = resolve;
  });
  const insertGate = new Promise<void>((resolve) => {
    releaseInsert = resolve;
  });
  const dependencies = batchedDependencies({
    findEntryOrder: async () => entryOrder(),
    findEntryEvent: async () => entryEvent,
    listLifecycleExitFills: async () => [
      {
        side: "sell" as const,
        quantity: "2",
        price: "1.25",
        occurredAt: CLOSED_AT,
      },
    ],
    listExitEvents: async () => [],
    insertExitEvent: async (event: unknown) => {
      inserted.push(event as InsertedEvent);
      markInsertStarted();
      await insertGate;
      return true;
    },
    notify: () => undefined,
  });
  const firstSummary = emptySummary();
  const secondSummary = emptySummary();
  const run = (summary: ShadowOptionMaintenanceSummary) =>
    maintenanceInternals.reconcileClosedRowsForTests({
      now: NOW,
      deploymentIds: new Set([DEPLOYMENT_ID]),
      summary,
      closedRows: [closedPosition()],
      dependencies,
    });

  const firstRun = run(firstSummary);
  await insertStarted;
  await run(secondSummary);
  releaseInsert();
  await firstRun;

  assert.equal(inserted.length, 1);
  assert.equal(firstSummary.reconciledCount, 1);
  assert.equal(secondSummary.reconciledCount, 0);
  assert.deepEqual(firstSummary.errors, []);
  assert.deepEqual(secondSummary.errors, []);
});

test("closed reconciliation stops before evidence or writes when its lease is lost during entry loading", async () => {
  const controller = new AbortController();
  const leaseLost = new Error("maintenance lease lost");
  let evidenceLoads = 0;
  let inserts = 0;
  let notifications = 0;
  const summary = emptySummary();

  await assert.rejects(
    maintenanceInternals.reconcileClosedRowsForTests({
      now: NOW,
      deploymentIds: new Set([DEPLOYMENT_ID]),
      summary,
      signal: controller.signal,
      closedRows: [closedPosition()],
      dependencies: {
        loadEntryBundles: async () => {
          controller.abort(leaseLost);
          return [
            {
              positionId: POSITION_ID,
              order: entryOrder(),
              entryEvent,
            },
          ];
        },
        loadLifecycleEvidence: async () => {
          evidenceLoads += 1;
          return { finalFills: [], finalExits: [] };
        },
        insertExitEvent: async () => {
          inserts += 1;
          return true;
        },
        notify: () => {
          notifications += 1;
        },
      },
    } as never),
    (error) => error === leaseLost,
  );

  assert.equal(evidenceLoads, 0);
  assert.equal(inserts, 0);
  assert.equal(notifications, 0);
  assert.deepEqual(summary, emptySummary());
});

test("closed reconciliation forwards its exact lease signal into the durable exit insert", async () => {
  const controller = new AbortController();
  const leaseLost = new Error("maintenance lease lost during exit insert");
  const summary = emptySummary();
  let receivedSignal: AbortSignal | undefined;
  let notifications = 0;

  await assert.rejects(
    maintenanceInternals.reconcileClosedRowsForTests({
      now: NOW,
      deploymentIds: new Set([DEPLOYMENT_ID]),
      summary,
      signal: controller.signal,
      closedRows: [closedPosition()],
      dependencies: {
        loadEntryBundles: async () => [
          {
            positionId: POSITION_ID,
            order: entryOrder(),
            entryEvent,
          },
        ],
        loadLifecycleEvidence: async () => ({
          finalFills: [
            {
              positionId: POSITION_ID,
              openedAt: OPENED_AT,
              closedAt: CLOSED_AT,
              fill: {
                side: "sell",
                quantity: "2",
                price: "1.25",
                occurredAt: CLOSED_AT,
              },
              order: entryOrder(),
            },
          ],
          finalExits: [],
        }),
        insertExitEvent: async (_event: unknown, signal?: AbortSignal) => {
          receivedSignal = signal;
          controller.abort(leaseLost);
          signal?.throwIfAborted();
          return true;
        },
        notify: () => {
          notifications += 1;
        },
      },
    } as never),
    (error) => error === leaseLost,
  );

  assert.equal(receivedSignal, controller.signal);
  assert.equal(notifications, 0);
  assert.deepEqual(summary, emptySummary());
});

test("closed reconciliation uses one durable event identity when two owners read stale evidence", async () => {
  const persistedIds = new Set<string>();
  const attemptedIds: string[] = [];
  let notifications = 0;
  const dependencies = batchedDependencies({
    findEntryOrder: async () => entryOrder(),
    findEntryEvent: async () => entryEvent,
    listLifecycleExitFills: async () => [
      {
        side: "sell" as const,
        quantity: "2",
        price: "1.25",
        occurredAt: CLOSED_AT,
      },
    ],
    // Both owners took their snapshots before either insert committed.
    listExitEvents: async () => [],
    insertExitEvent: async (event: unknown) => {
      const id = (event as InsertedEvent).id;
      assert.ok(id);
      attemptedIds.push(id);
      if (persistedIds.has(id)) {
        return false;
      }
      persistedIds.add(id);
      return true;
    },
    notify: () => {
      notifications += 1;
    },
  });
  const firstSummary = emptySummary();
  const secondSummary = emptySummary();
  const run = (summary: ShadowOptionMaintenanceSummary) =>
    maintenanceInternals.reconcileClosedRowsForTests({
      now: NOW,
      deploymentIds: new Set([DEPLOYMENT_ID]),
      summary,
      closedRows: [closedPosition()],
      dependencies,
    });

  await run(firstSummary);
  await run(secondSummary);

  assert.equal(persistedIds.size, 1);
  assert.equal(new Set(attemptedIds).size, 1);
  assert.equal(firstSummary.reconciledCount, 1);
  assert.equal(secondSummary.reconciledCount, 0);
  assert.equal(notifications, 1);
  assert.deepEqual(firstSummary.errors, []);
  assert.deepEqual(secondSummary.errors, []);
});

test("closed reconciliation refreshes final-exit evidence after an insert in the same pass", async () => {
  const inserted: InsertedEvent[] = [];
  const summary = emptySummary();

  await maintenanceInternals.reconcileClosedRowsForTests({
    now: NOW,
    deploymentIds: new Set([DEPLOYMENT_ID]),
    summary,
    closedRows: [
      closedPosition(),
      closedPosition({ id: "20000000-0000-4000-8000-000000000099" }),
    ],
    dependencies: batchedDependencies({
      findEntryOrder: async () => entryOrder(),
      findEntryEvent: async () => entryEvent,
      listLifecycleExitFills: async () => [
        {
          side: "sell",
          quantity: "2",
          price: "1.25",
          occurredAt: CLOSED_AT,
        },
      ],
      listExitEvents: async () => [],
      insertExitEvent: async (event: unknown) => {
        inserted.push(event as InsertedEvent);
        return true;
      },
      notify: () => undefined,
    }),
  });

  assert.equal(inserted.length, 1);
  assert.equal(summary.reconciledCount, 1);
  assert.deepEqual(summary.errors, []);
});

test("explicit closed repair forces ordinary mirrors before repairing close-without-final-event drift", async () => {
  const calls: string[] = [];
  maintenanceInternals.setDependenciesForTests({
    listDeployments: async () => [{ id: DEPLOYMENT_ID }],
    repairAutomationMirrors: async () => {
      calls.push("ordinary-mirror");
      return {
        checkedCount: 0,
        missingCount: 0,
        repairedCount: 0,
        errorCount: 0,
      };
    },
    reconcileClosedWithoutExit: async () => {
      calls.push("closed-final-event");
    },
  });

  try {
    await runShadowOptionClosedReconciliation({ now: NOW });
  } finally {
    maintenanceInternals.setDependenciesForTests(null);
  }

  assert.deepEqual(calls, ["ordinary-mirror", "closed-final-event"]);
});

for (const maintenanceReason of ["expiration", "force-stop"] as const) {
  test(`${maintenanceReason} close with a failed final-event insert is repaired once from its committed lifecycle fill`, async () => {
    const inserted: InsertedEvent[] = [];
    const summary = emptySummary();
    const finalPrice = maintenanceReason === "expiration" ? 0 : 0.75;
    const expectedPnl = automationInternals.signalOptionsRealizedPnl(
      finalPrice,
      2,
      2,
      CONTRACT,
    );
    const dependencies = batchedDependencies({
      findEntryOrder: async () => entryOrder(),
      findEntryEvent: async () => entryEvent,
      listLifecycleExitFills: async () => [
        {
          side: "sell" as const,
          quantity: "2",
          price: String(finalPrice),
          occurredAt: CLOSED_AT,
        },
      ],
      listExitEvents: async () => inserted,
      insertExitEvent: async (event: unknown) => {
        inserted.push(event as InsertedEvent);
        return true;
      },
      notify: () => undefined,
    });
    const repair = () =>
      maintenanceInternals.reconcileClosedRowsForTests({
        now: NOW,
        deploymentIds: new Set([DEPLOYMENT_ID]),
        summary,
        closedRows: [closedPosition()],
        dependencies,
      });

    await repair();
    await repair();

    assert.equal(inserted.length, 1);
    assert.equal(inserted[0]?.payload.pnl, expectedPnl);
    assert.equal(inserted[0]?.payload.exitPrice, finalPrice);
    assert.equal(inserted[0]?.occurredAt.getTime(), CLOSED_AT.getTime());
  });
}
