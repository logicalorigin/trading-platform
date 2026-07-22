import assert from "node:assert/strict";
import test from "node:test";

import {
  algoDeploymentsTable,
  algoStrategiesTable,
  db,
  executionEventsTable,
  shadowOrdersTable,
  shadowPositionsTable,
  type ExecutionEvent,
} from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";

import {
  persistSignalOptionsLifecycleExitWithFence,
  resolveSignalOptionsLifecycleExitFenceKey,
  type SignalOptionsLifecycleExitFenceDependencies,
} from "./signal-options-exit-claims";
import {
  __shadowOptionMaintenanceInternalsForTests as maintenanceInternals,
  deterministicExecutionEventId,
  recordShadowAutomationEvent,
  runShadowOptionOpenSafety,
  signalOptionsLifecycleEventId,
} from "./shadow-account";

const STRATEGY_ID = "00000000-0000-4000-8000-000000000401";
const DEPLOYMENT_ID = "00000000-0000-4000-8000-000000000402";
const POSITION_ID = `${DEPLOYMENT_ID}:CRM`;
const OPENED_AT = new Date("2026-07-16T14:30:00.000Z");

async function seedDeployment() {
  await db.insert(algoStrategiesTable).values({
    id: STRATEGY_ID,
    name: "Lifecycle exit fence",
    mode: "shadow",
    enabled: true,
    symbolUniverse: ["CRM"],
    config: {},
  });
  await db.insert(algoDeploymentsTable).values({
    id: DEPLOYMENT_ID,
    strategyId: STRATEGY_ID,
    name: "Lifecycle exit fence",
    mode: "shadow",
    enabled: true,
    providerAccountId: "shadow",
    symbolUniverse: ["CRM"],
    config: {},
  });
}

function entryEvent(quantity: number): ExecutionEvent {
  const occurredAt = OPENED_AT;
  return {
    id: "00000000-0000-4000-8000-000000000403",
    deploymentId: DEPLOYMENT_ID,
    algoRunId: null,
    providerAccountId: "shadow",
    symbol: "CRM",
    eventType: "signal_options_shadow_entry",
    summary: "CRM entry",
    payload: {
      position: {
        id: POSITION_ID,
        candidateId: "candidate-1",
        openedAt: OPENED_AT.toISOString(),
        quantity,
      },
    },
    occurredAt,
    createdAt: occurredAt,
    updatedAt: occurredAt,
  };
}

function exitEvent(input: {
  id: string;
  occurredAt: string;
  snapshotQuantity: number;
  exitQuantity: number;
  partial?: boolean;
  scaleOutId?: string;
  metadata?: Record<string, unknown>;
}): ExecutionEvent {
  const occurredAt = new Date(input.occurredAt);
  const remainingQuantity = Number(
    (input.snapshotQuantity - input.exitQuantity).toFixed(8),
  );
  const lifecycle = {
    id: POSITION_ID,
    candidateId: "candidate-1",
    openedAt: OPENED_AT.toISOString(),
  };
  return {
    id: input.id,
    deploymentId: DEPLOYMENT_ID,
    algoRunId: null,
    providerAccountId: "shadow",
    symbol: "CRM",
    eventType: "signal_options_shadow_exit",
    summary: "CRM exit",
    payload: {
      metadata: input.metadata,
      partial: input.partial === true,
      scaleOutId: input.scaleOutId ?? null,
      exitQuantity: input.exitQuantity,
      remainingQuantity: input.partial ? remainingQuantity : null,
      position: {
        ...lifecycle,
        quantity: input.partial ? input.exitQuantity : input.snapshotQuantity,
      },
      preExitPosition: input.partial
        ? { ...lifecycle, quantity: input.snapshotQuantity }
        : null,
      remainingPosition: input.partial
        ? { ...lifecycle, quantity: remainingQuantity }
        : null,
    },
    occurredAt,
    createdAt: occurredAt,
    updatedAt: occurredAt,
  };
}

test("one lifecycle fence rejects a stale final after a committed partial exit", async () => {
  await withTestDb(async () => {
    await seedDeployment();
    await db.insert(executionEventsTable).values(entryEvent(4));

    const partial = await persistSignalOptionsLifecycleExitWithFence(
      exitEvent({
        id: "00000000-0000-4000-8000-000000000404",
        occurredAt: "2026-07-16T14:35:00.000Z",
        snapshotQuantity: 4,
        exitQuantity: 1,
        partial: true,
        scaleOutId: "first_trail_arm",
      }),
    );
    assert.equal(partial.status, "inserted");

    const staleFinal = await persistSignalOptionsLifecycleExitWithFence(
      exitEvent({
        id: "00000000-0000-4000-8000-000000000405",
        occurredAt: "2026-07-16T14:36:00.000Z",
        snapshotQuantity: 4,
        exitQuantity: 4,
      }),
    );
    assert.equal(staleFinal.status, "stale");

    const freshFinal = await persistSignalOptionsLifecycleExitWithFence(
      exitEvent({
        id: "00000000-0000-4000-8000-000000000406",
        occurredAt: "2026-07-16T14:37:00.000Z",
        snapshotQuantity: 3,
        exitQuantity: 3,
      }),
    );
    assert.equal(freshFinal.status, "inserted");

    const afterFinal = await persistSignalOptionsLifecycleExitWithFence(
      exitEvent({
        id: "00000000-0000-4000-8000-000000000407",
        occurredAt: "2026-07-16T14:38:00.000Z",
        snapshotQuantity: 3,
        exitQuantity: 1,
        partial: true,
        scaleOutId: "late_partial",
      }),
    );
    assert.equal(afterFinal.status, "inactive");

    const rows = await db.select().from(executionEventsTable);
    assert.deepEqual(rows.map((row) => row.id).sort(), [
      "00000000-0000-4000-8000-000000000403",
      "00000000-0000-4000-8000-000000000404",
      "00000000-0000-4000-8000-000000000406",
    ]);
  });
});

test("future exits cannot close the present lifecycle fence", async () => {
  await withTestDb(async () => {
    await seedDeployment();
    await db.insert(executionEventsTable).values(entryEvent(1));

    const future = await persistSignalOptionsLifecycleExitWithFence(
      exitEvent({
        id: "00000000-0000-4000-8000-000000000515",
        occurredAt: "2099-07-16T14:35:00.000Z",
        snapshotQuantity: 1,
        exitQuantity: 1,
      }),
    );
    assert.equal(future.status, "invalid");

    const present = await persistSignalOptionsLifecycleExitWithFence(
      exitEvent({
        id: "00000000-0000-4000-8000-000000000516",
        occurredAt: "2026-07-16T14:35:00.000Z",
        snapshotQuantity: 1,
        exitQuantity: 1,
      }),
    );
    assert.equal(present.status, "inserted");
  });
});

test("committed later-timestamp actions block delayed stale exits", async () => {
  await withTestDb(async () => {
    await seedDeployment();
    await db.insert(executionEventsTable).values(entryEvent(4));

    assert.equal(
      (
        await persistSignalOptionsLifecycleExitWithFence(
          exitEvent({
            id: "00000000-0000-4000-8000-000000000408",
            occurredAt: "2026-07-16T14:36:00.000Z",
            snapshotQuantity: 4,
            exitQuantity: 1,
            partial: true,
            scaleOutId: "committed_later_partial",
          }),
        )
      ).status,
      "inserted",
    );

    assert.equal(
      (
        await persistSignalOptionsLifecycleExitWithFence(
          exitEvent({
            id: "00000000-0000-4000-8000-000000000409",
            occurredAt: "2026-07-16T14:35:00.000Z",
            snapshotQuantity: 4,
            exitQuantity: 4,
          }),
        )
      ).status,
      "stale",
    );

    assert.equal(
      (
        await persistSignalOptionsLifecycleExitWithFence(
          exitEvent({
            id: "00000000-0000-4000-8000-000000000410",
            occurredAt: "2026-07-16T14:38:00.000Z",
            snapshotQuantity: 3,
            exitQuantity: 3,
          }),
        )
      ).status,
      "inserted",
    );

    assert.equal(
      (
        await persistSignalOptionsLifecycleExitWithFence(
          exitEvent({
            id: "00000000-0000-4000-8000-000000000411",
            occurredAt: "2026-07-16T14:37:00.000Z",
            snapshotQuantity: 3,
            exitQuantity: 1,
            partial: true,
            scaleOutId: "delayed_older_partial",
          }),
        )
      ).status,
      "inactive",
    );

    assert.deepEqual(
      (await db.select().from(executionEventsTable))
        .map((event) => event.id)
        .sort(),
      [
        "00000000-0000-4000-8000-000000000403",
        "00000000-0000-4000-8000-000000000408",
        "00000000-0000-4000-8000-000000000410",
      ],
    );
  });
});

test("an unrelated execution-event id conflict fails loudly", async () => {
  await withTestDb(async () => {
    await seedDeployment();
    await db.insert(executionEventsTable).values(entryEvent(1));
    const candidate = exitEvent({
      id: "00000000-0000-4000-8000-000000000419",
      occurredAt: "2026-07-16T14:35:00.000Z",
      snapshotQuantity: 1,
      exitQuantity: 1,
    });
    await db.insert(executionEventsTable).values({
      ...entryEvent(1),
      id: candidate.id,
      symbol: "MSFT",
      payload: {
        position: {
          id: `${DEPLOYMENT_ID}:MSFT`,
          openedAt: OPENED_AT.toISOString(),
          quantity: 1,
        },
      },
    });

    await assert.rejects(
      persistSignalOptionsLifecycleExitWithFence(candidate),
      /execution-event id conflict/u,
    );
    assert.equal(
      (await db.select().from(executionEventsTable)).filter(
        ({ eventType, symbol }) =>
          eventType === "signal_options_shadow_exit" && symbol === "CRM",
      ).length,
      0,
    );
  });
});

test("an exit before its lifecycle openedAt cannot escape later fence folds", async () => {
  await withTestDb(async () => {
    await seedDeployment();
    await db.insert(executionEventsTable).values(entryEvent(2));

    const result = await persistSignalOptionsLifecycleExitWithFence(
      exitEvent({
        id: "00000000-0000-4000-8000-000000000414",
        occurredAt: "2026-07-16T14:29:59.999Z",
        snapshotQuantity: 2,
        exitQuantity: 2,
      }),
    );

    assert.equal(result.status, "invalid");
    assert.deepEqual(
      (await db.select().from(executionEventsTable)).map((event) => event.id),
      ["00000000-0000-4000-8000-000000000403"],
    );
  });
});

test("the lifecycle fence fails closed when its exact scan exceeds the row ceiling", async () => {
  const entry = entryEvent(1);
  const candidate = exitEvent({
    id: "00000000-0000-4000-8000-000000000420",
    occurredAt: "2026-07-16T14:35:00.000Z",
    snapshotQuantity: 1,
    exitQuantity: 1,
  });
  const unrelated = Array.from({ length: 1_024 }, (_, index) => {
    const event = exitEvent({
      id: `overflow-${index}`,
      occurredAt: "2026-07-16T14:34:00.000Z",
      snapshotQuantity: 1,
      exitQuantity: 1,
    });
    event.payload = {
      ...event.payload,
      position: {
        ...(event.payload.position as Record<string, unknown>),
        id: `other-position-${index}`,
      },
    };
    return event;
  });
  const listInputs: Record<string, unknown>[] = [];
  let inserts = 0;
  const dependencies: SignalOptionsLifecycleExitFenceDependencies = {
    withLifecycleLock: async (_key, work) => ({
      acquired: true,
      result: await work({
        listEvents: async (input) => {
          listInputs.push(input as unknown as Record<string, unknown>);
          return [entry, ...unrelated];
        },
        insertEvent: async (event) => {
          inserts += 1;
          return event;
        },
      }),
    }),
  };

  assert.equal(
    (
      await persistSignalOptionsLifecycleExitWithFence(
        candidate,
        undefined,
        dependencies,
      )
    ).status,
    "invalid",
  );
  assert.equal(inserts, 0);
  const listInput = listInputs[0];
  assert.equal(listInput?.symbol, "CRM");
  assert.equal(listInput?.positionId, POSITION_ID);
  assert.equal(listInput?.maxRows, 1_024);
  assert.equal(listInput?.occurredAt, undefined);
});

test("contract-distinct lifecycle rows do not consume another contract's fence scan ceiling", async () => {
  await withTestDb(async () => {
    await seedDeployment();
    const targetContract = {
      ticker: "O:CRM260716C00250000",
      underlying: "CRM",
      expirationDate: "2026-07-16",
      strike: 250,
      right: "call",
      multiplier: 100,
      providerContractId: "crm-target-contract",
    };
    const otherContract = {
      ...targetContract,
      ticker: "O:CRM260716C00255000",
      strike: 255,
      providerContractId: "crm-other-contract",
    };
    const targetEntry = entryEvent(1);
    targetEntry.payload = {
      ...targetEntry.payload,
      metadata: { positionKey: targetContract.ticker },
      selectedContract: targetContract,
      position: {
        ...(targetEntry.payload.position as Record<string, unknown>),
        positionKey: targetContract.ticker,
        selectedContract: targetContract,
      },
    };
    const unrelated = Array.from({ length: 1_024 }, (_, index) => {
      const event = exitEvent({
        id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        occurredAt: "2026-07-16T14:34:00.000Z",
        snapshotQuantity: 1,
        exitQuantity: 1,
      });
      event.payload = {
        ...event.payload,
        metadata: { positionKey: otherContract.ticker },
        selectedContract: otherContract,
        position: {
          ...(event.payload.position as Record<string, unknown>),
          positionKey: otherContract.ticker,
          selectedContract: otherContract,
        },
      };
      return event;
    });
    await db.insert(executionEventsTable).values([targetEntry, ...unrelated]);

    const candidate = exitEvent({
      id: "00000000-0000-4000-8000-000000000421",
      occurredAt: "2026-07-16T14:35:00.000Z",
      snapshotQuantity: 1,
      exitQuantity: 1,
    });
    candidate.payload = {
      ...candidate.payload,
      metadata: { positionKey: targetContract.ticker },
      selectedContract: targetContract,
      position: {
        ...(candidate.payload.position as Record<string, unknown>),
        positionKey: targetContract.ticker,
        selectedContract: targetContract,
      },
    };

    assert.equal(
      (await persistSignalOptionsLifecycleExitWithFence(candidate)).status,
      "inserted",
    );
  });
});

test("lease loss during insert rolls the lifecycle event back before commit", async () => {
  const controller = new AbortController();
  const leaseLost = new Error("lifecycle lease lost");
  const committed = [entryEvent(1)];
  const dependencies: SignalOptionsLifecycleExitFenceDependencies = {
    withLifecycleLock: async (_key, work) => {
      const transaction = [...committed];
      const result = await work({
        listEvents: async () => transaction,
        insertEvent: async (event) => {
          transaction.push(event);
          controller.abort(leaseLost);
          return event;
        },
      });
      committed.splice(0, committed.length, ...transaction);
      return { acquired: true, result };
    },
  };

  await assert.rejects(
    persistSignalOptionsLifecycleExitWithFence(
      exitEvent({
        id: "00000000-0000-4000-8000-000000000415",
        occurredAt: "2026-07-16T14:35:00.000Z",
        snapshotQuantity: 1,
        exitQuantity: 1,
      }),
      controller.signal,
      dependencies,
    ),
    (error) => error === leaseLost,
  );
  assert.deepEqual(
    committed.map((event) => event.id),
    [entryEvent(1).id],
  );
});

test("historical replay evidence cannot close a live lifecycle fence", async () => {
  await withTestDb(async () => {
    await seedDeployment();
    await db.insert(executionEventsTable).values([
      entryEvent(2),
      exitEvent({
        id: "00000000-0000-4000-8000-000000000408",
        occurredAt: "2026-07-16T14:34:00.000Z",
        snapshotQuantity: 2,
        exitQuantity: 2,
        metadata: {
          runMode: "replay",
          runSource: "signal_options_replay",
        },
      }),
    ]);

    const live = await persistSignalOptionsLifecycleExitWithFence(
      exitEvent({
        id: "00000000-0000-4000-8000-000000000409",
        occurredAt: "2026-07-16T14:35:00.000Z",
        snapshotQuantity: 2,
        exitQuantity: 1,
        partial: true,
        scaleOutId: "live_partial",
      }),
    );
    assert.equal(live.status, "inserted");
  });
});

test("distinct action ids for one lifecycle contend on the same lock key", async () => {
  const entry = entryEvent(2);
  const committed = [entry];
  let lockHeld = false;
  let releaseRead!: () => void;
  const readGate = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  let firstRead = true;
  const dependencies: SignalOptionsLifecycleExitFenceDependencies = {
    withLifecycleLock: async (_key, work) => {
      if (lockHeld) return { acquired: false };
      lockHeld = true;
      try {
        return {
          acquired: true,
          result: await work({
            listEvents: async () => {
              if (firstRead) {
                firstRead = false;
                await readGate;
              }
              return [...committed];
            },
            insertEvent: async (event) => {
              committed.push(event);
              return event;
            },
          }),
        };
      } finally {
        lockHeld = false;
      }
    },
  };
  const partialEvent = exitEvent({
    id: "00000000-0000-4000-8000-000000000410",
    occurredAt: "2026-07-16T14:35:00.000Z",
    snapshotQuantity: 2,
    exitQuantity: 1,
    partial: true,
    scaleOutId: "partial-action",
  });
  const finalEvent = exitEvent({
    id: "00000000-0000-4000-8000-000000000411",
    occurredAt: "2026-07-16T14:35:01.000Z",
    snapshotQuantity: 2,
    exitQuantity: 2,
  });

  assert.notEqual(partialEvent.id, finalEvent.id);
  assert.equal(
    resolveSignalOptionsLifecycleExitFenceKey(partialEvent),
    resolveSignalOptionsLifecycleExitFenceKey(finalEvent),
  );

  const first = persistSignalOptionsLifecycleExitWithFence(
    partialEvent,
    undefined,
    dependencies,
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  const competing = await persistSignalOptionsLifecycleExitWithFence(
    finalEvent,
    undefined,
    dependencies,
  );
  assert.equal(competing.status, "busy");
  releaseRead();
  assert.equal((await first).status, "inserted");
  assert.deepEqual(
    committed.map((event) => event.id),
    [entry.id, partialEvent.id],
  );
});

test("distinct same-symbol contracts keep independent durable exit lifecycles", async () => {
  await withTestDb(async () => {
    await seedDeployment();
    const contract = (suffix: string, strike: number) => ({
      ticker: `O:CRM260716C00${strike}000`,
      underlying: "CRM",
      expirationDate: "2026-07-16",
      strike,
      right: "call",
      multiplier: 100,
      providerContractId: `crm-${suffix}`,
    });
    const entryFor = (
      id: string,
      candidateId: string,
      selectedContract: ReturnType<typeof contract>,
    ): ExecutionEvent => {
      const entry = entryEvent(1);
      return {
        ...entry,
        id,
        payload: {
          ...entry.payload,
          selectedContract,
          position: {
            ...(entry.payload.position as Record<string, unknown>),
            candidateId,
            selectedContract,
          },
        },
      };
    };
    const exitFor = (
      id: string,
      candidateId: string,
      selectedContract: ReturnType<typeof contract>,
    ): ExecutionEvent => {
      const exit = exitEvent({
        id,
        occurredAt: "2026-07-16T14:35:00.000Z",
        snapshotQuantity: 1,
        exitQuantity: 1,
      });
      return {
        ...exit,
        payload: {
          ...exit.payload,
          selectedContract,
          position: {
            ...(exit.payload.position as Record<string, unknown>),
            candidateId,
            selectedContract,
          },
        },
      };
    };
    const firstContract = contract("250-call", 250);
    const secondContract = contract("255-call", 255);
    await db
      .insert(executionEventsTable)
      .values([
        entryFor(
          "00000000-0000-4000-8000-000000000416",
          "candidate-contract-250",
          firstContract,
        ),
        entryFor(
          "00000000-0000-4000-8000-000000000417",
          "candidate-contract-255",
          secondContract,
        ),
      ]);
    const firstExit = exitFor(
      "00000000-0000-4000-8000-000000000418",
      "candidate-contract-250",
      firstContract,
    );
    const secondExit = exitFor(
      "00000000-0000-4000-8000-000000000419",
      "candidate-contract-255",
      secondContract,
    );

    assert.notEqual(
      signalOptionsLifecycleEventId({
        deploymentId: DEPLOYMENT_ID,
        eventType: firstExit.eventType,
        payload: firstExit.payload,
      }),
      signalOptionsLifecycleEventId({
        deploymentId: DEPLOYMENT_ID,
        eventType: secondExit.eventType,
        payload: secondExit.payload,
      }),
    );
    assert.equal(
      (await persistSignalOptionsLifecycleExitWithFence(firstExit)).status,
      "inserted",
    );
    assert.equal(
      (await persistSignalOptionsLifecycleExitWithFence(secondExit)).status,
      "inserted",
    );
  });
});

for (const reverseEntryOrder of [false, true]) {
  test(`a contractless legacy final cannot poison a contract lifecycle (${reverseEntryOrder ? "reverse" : "forward"} entry order)`, async () => {
    await withTestDb(async () => {
      await seedDeployment();
      const contract = (suffix: string, strike: number) => ({
        ticker: `O:CRM260716C00${strike}000`,
        underlying: "CRM",
        expirationDate: "2026-07-16",
        strike,
        right: "call",
        multiplier: 100,
        providerContractId: `crm-${suffix}`,
      });
      const firstContract = contract("legacy-250-call", 250);
      const secondContract = contract("legacy-255-call", 255);
      const entryFor = (
        id: string,
        positionKey: string,
        selectedContract: ReturnType<typeof contract>,
      ): ExecutionEvent => {
        const entry = entryEvent(1);
        return {
          ...entry,
          id,
          payload: {
            ...entry.payload,
            metadata: { positionKey },
            selectedContract,
            position: {
              ...(entry.payload.position as Record<string, unknown>),
              positionKey,
              selectedContract,
            },
          },
        };
      };
      const firstEntry = entryFor(
        "00000000-0000-4000-8000-000000000530",
        "option:CRM:legacy-250",
        firstContract,
      );
      const secondEntry = entryFor(
        "00000000-0000-4000-8000-000000000531",
        "option:CRM:legacy-255",
        secondContract,
      );
      await db
        .insert(executionEventsTable)
        .values(
          reverseEntryOrder
            ? [secondEntry, firstEntry]
            : [firstEntry, secondEntry],
        );
      await db.insert(executionEventsTable).values({
        ...exitEvent({
          id: "00000000-0000-4000-8000-000000000532",
          occurredAt: "2026-07-16T14:34:00.000Z",
          snapshotQuantity: 1,
          exitQuantity: 1,
        }),
        payload: {
          exitQuantity: 1,
          position: {
            id: POSITION_ID,
            openedAt: OPENED_AT.toISOString(),
            quantity: 1,
          },
        },
      });
      const validExit = exitEvent({
        id: "00000000-0000-4000-8000-000000000533",
        occurredAt: "2026-07-16T14:35:00.000Z",
        snapshotQuantity: 1,
        exitQuantity: 1,
        metadata: { positionKey: "option:CRM:legacy-255" },
      });
      validExit.payload = {
        ...validExit.payload,
        selectedContract: secondContract,
        position: {
          ...(validExit.payload.position as Record<string, unknown>),
          positionKey: "option:CRM:legacy-255",
          selectedContract: secondContract,
        },
      };

      assert.equal(
        (await persistSignalOptionsLifecycleExitWithFence(validExit)).status,
        "inserted",
      );
    });
  });
}

test("ticker-only and provider-enriched views of one contract share one durable exit", async () => {
  await withTestDb(async () => {
    await seedDeployment();
    await db.insert(executionEventsTable).values(entryEvent(1));
    const tickerOnly = {
      ticker: "O:CRM260716C00250000",
      underlying: "CRM",
      expirationDate: "2026-07-16",
      strike: 250,
      right: "call",
      multiplier: 100,
    };
    const enriched = {
      ...tickerOnly,
      providerContractId: "crm-250-call",
    };
    const exitFor = (
      selectedContract: typeof tickerOnly | typeof enriched,
      occurredAt: string,
    ) => {
      const event = exitEvent({
        id: "temporary",
        occurredAt,
        snapshotQuantity: 1,
        exitQuantity: 1,
      });
      event.payload = {
        ...event.payload,
        selectedContract,
        position: {
          ...(event.payload.position as Record<string, unknown>),
          selectedContract,
        },
      };
      event.id = signalOptionsLifecycleEventId({
        deploymentId: DEPLOYMENT_ID,
        eventType: event.eventType,
        payload: event.payload,
      })!;
      return event;
    };
    const tickerOnlyExit = exitFor(tickerOnly, "2026-07-16T14:35:00.000Z");
    const enrichedExit = exitFor(enriched, "2026-07-16T14:35:01.000Z");
    enrichedExit.payload = {
      ...enrichedExit.payload,
      metadata: { positionKey: enriched.ticker },
      position: {
        ...(enrichedExit.payload.position as Record<string, unknown>),
        positionKey: enriched.ticker,
      },
    };
    enrichedExit.id = signalOptionsLifecycleEventId({
      deploymentId: DEPLOYMENT_ID,
      eventType: enrichedExit.eventType,
      payload: enrichedExit.payload,
    })!;

    assert.equal(
      resolveSignalOptionsLifecycleExitFenceKey(tickerOnlyExit),
      resolveSignalOptionsLifecycleExitFenceKey(enrichedExit),
    );
    assert.equal(tickerOnlyExit.id, enrichedExit.id);
    assert.equal(
      (await persistSignalOptionsLifecycleExitWithFence(tickerOnlyExit)).status,
      "inserted",
    );
    assert.equal(
      (await persistSignalOptionsLifecycleExitWithFence(enrichedExit)).status,
      "duplicate",
    );
    assert.equal((await db.select().from(executionEventsTable)).length, 2);
  });
});

test("provider-only legacy and enriched views share one durable exit fence", async () => {
  await withTestDb(async () => {
    await seedDeployment();
    await db.insert(executionEventsTable).values(entryEvent(1));
    const providerOnly = {
      providerContractId: "crm-250-call",
    };
    const enriched = {
      ticker: "O:CRM260716C00250000",
      underlying: "CRM",
      expirationDate: "2026-07-16",
      strike: 250,
      right: "call",
      multiplier: 100,
      providerContractId: providerOnly.providerContractId,
    };
    const exitFor = (
      selectedContract: typeof providerOnly | typeof enriched,
      occurredAt: string,
    ) => {
      const event = exitEvent({
        id: "temporary",
        occurredAt,
        snapshotQuantity: 1,
        exitQuantity: 1,
      });
      event.payload = {
        ...event.payload,
        selectedContract,
        position: {
          ...(event.payload.position as Record<string, unknown>),
          selectedContract,
        },
      };
      event.id = signalOptionsLifecycleEventId({
        deploymentId: DEPLOYMENT_ID,
        eventType: event.eventType,
        payload: event.payload,
      })!;
      return event;
    };
    const providerOnlyExit = exitFor(providerOnly, "2026-07-16T14:35:00.000Z");
    (providerOnlyExit.payload.position as Record<string, unknown>).openedAt =
      "2026-07-16T10:30:00-04:00";
    const enrichedExit = exitFor(enriched, "2026-07-16T14:35:01.000Z");

    assert.equal(
      resolveSignalOptionsLifecycleExitFenceKey(providerOnlyExit),
      resolveSignalOptionsLifecycleExitFenceKey(enrichedExit),
    );
    assert.equal(
      (await persistSignalOptionsLifecycleExitWithFence(providerOnlyExit))
        .status,
      "inserted",
    );
    assert.ok(
      ["duplicate", "inactive"].includes(
        (await persistSignalOptionsLifecycleExitWithFence(enrichedExit)).status,
      ),
    );
    assert.equal((await db.select().from(executionEventsTable)).length, 2);
  });
});

test("provider-only legacy and enriched retries share one partial action", async () => {
  await withTestDb(async () => {
    await seedDeployment();
    await db.insert(executionEventsTable).values(entryEvent(3));
    const providerOnly = {
      providerContractId: "crm-250-call",
    };
    const enriched = {
      ticker: "O:CRM260716C00250000",
      providerContractId: providerOnly.providerContractId,
    };
    const partialFor = (
      selectedContract: typeof providerOnly | typeof enriched,
      occurredAt: string,
      snapshotQuantity: number,
    ) => {
      const event = exitEvent({
        id: "temporary",
        occurredAt,
        snapshotQuantity,
        exitQuantity: 1,
        partial: true,
        scaleOutId: "shared-scale-out",
      });
      event.payload = {
        ...event.payload,
        selectedContract,
        position: {
          ...(event.payload.position as Record<string, unknown>),
          selectedContract,
        },
        preExitPosition: {
          ...(event.payload.preExitPosition as Record<string, unknown>),
          selectedContract,
        },
        remainingPosition: {
          ...(event.payload.remainingPosition as Record<string, unknown>),
          selectedContract,
        },
      };
      event.id = signalOptionsLifecycleEventId({
        deploymentId: DEPLOYMENT_ID,
        eventType: event.eventType,
        payload: event.payload,
      })!;
      return event;
    };
    const providerOnlyPartial = partialFor(
      providerOnly,
      "2026-07-16T14:35:00.000Z",
      3,
    );
    const enrichedRetry = partialFor(enriched, "2026-07-16T14:35:01.000Z", 2);

    assert.notEqual(providerOnlyPartial.id, enrichedRetry.id);
    assert.equal(
      (await persistSignalOptionsLifecycleExitWithFence(providerOnlyPartial))
        .status,
      "inserted",
    );
    assert.equal(
      (await persistSignalOptionsLifecycleExitWithFence(enrichedRetry)).status,
      "duplicate",
    );
    assert.equal((await db.select().from(executionEventsTable)).length, 2);
  });
});

test("all current contract views acquire only the stable lifecycle lock key", async () => {
  const contract = {
    ticker: "O:CRM260716C00250000",
    providerContractId: "crm-250-call",
  };
  const event = exitEvent({
    id: "00000000-0000-4000-8000-000000000497",
    occurredAt: "2026-07-16T14:35:00.000Z",
    snapshotQuantity: 1,
    exitQuantity: 1,
  });
  event.payload = {
    ...event.payload,
    selectedContract: contract,
    position: {
      ...(event.payload.position as Record<string, unknown>),
      selectedContract: contract,
    },
  };
  let observedKeys: readonly string[] = [];
  const result = await persistSignalOptionsLifecycleExitWithFence(
    event,
    undefined,
    {
      withLifecycleLock: async (keys) => {
        observedKeys = keys;
        return { acquired: false };
      },
    },
  );

  assert.equal(result.status, "busy");
  assert.deepEqual(observedKeys, [
    JSON.stringify([
      "pyrus:signal-options:exit-fence:v3",
      DEPLOYMENT_ID,
      POSITION_ID,
      OPENED_AT.toISOString(),
    ]),
  ]);
});

test("a pre-fix provider-only event id cannot suppress a distinct current ticker", async () => {
  await withTestDb(async () => {
    await seedDeployment();
    const sharedIdentifier = "O:CRM260716C00250000";
    const legacyProviderFinal = exitEvent({
      id: "00000000-0000-4000-8000-000000000496",
      occurredAt: "2026-07-16T14:34:00.000Z",
      snapshotQuantity: 1,
      exitQuantity: 1,
    });
    const providerOnlyContract = {
      providerContractId: sharedIdentifier,
    };
    legacyProviderFinal.payload = {
      ...legacyProviderFinal.payload,
      selectedContract: providerOnlyContract,
      position: {
        ...(legacyProviderFinal.payload.position as Record<string, unknown>),
        selectedContract: providerOnlyContract,
      },
    };
    const legacyId = deterministicExecutionEventId(
      "pyrus:signal-options:position-action:v2",
      [
        DEPLOYMENT_ID,
        POSITION_ID,
        OPENED_AT.toISOString(),
        JSON.stringify(["option-contract", sharedIdentifier]),
        "final",
      ],
    );
    legacyProviderFinal.id = legacyId;
    await db
      .insert(executionEventsTable)
      .values([entryEvent(1), legacyProviderFinal]);

    const currentTickerFinal = exitEvent({
      id: "00000000-0000-4000-8000-000000000495",
      occurredAt: "2026-07-16T14:35:00.000Z",
      snapshotQuantity: 1,
      exitQuantity: 1,
    });
    const tickerOnlyContract = { ticker: sharedIdentifier };
    currentTickerFinal.payload = {
      ...currentTickerFinal.payload,
      selectedContract: tickerOnlyContract,
      position: {
        ...(currentTickerFinal.payload.position as Record<string, unknown>),
        selectedContract: tickerOnlyContract,
      },
    };
    currentTickerFinal.id =
      signalOptionsLifecycleEventId({
        deploymentId: DEPLOYMENT_ID,
        eventType: currentTickerFinal.eventType,
        payload: currentTickerFinal.payload,
      }) ?? "";

    assert.notEqual(currentTickerFinal.id, legacyId);
    assert.equal(
      (await persistSignalOptionsLifecycleExitWithFence(currentTickerFinal))
        .status,
      "inserted",
    );
    const finals = (await db.select().from(executionEventsTable)).filter(
      ({ eventType }) => eventType === "signal_options_shadow_exit",
    );
    assert.equal(finals.length, 2);
  });
});

test("the durable fence accepts an exact Shadow entry order after its source event ages out", async () => {
  await withTestDb(async () => {
    await seedDeployment();
    const contract = {
      ticker: "O:CRM260716C00250000",
      underlying: "CRM",
      expirationDate: "2026-07-16",
      strike: 250,
      right: "call",
      multiplier: 100,
      providerContractId: "crm-aged-entry",
    };
    const agedEntry = entryEvent(1);
    agedEntry.payload = {
      metadata: {
        deploymentId: DEPLOYMENT_ID,
        positionKey: contract.ticker,
      },
      orderPlan: { quantity: 1, simulatedFillPrice: 2 },
      selectedContract: contract,
      position: {
        id: POSITION_ID,
        candidateId: "candidate-1",
        openedAt: OPENED_AT.toISOString(),
        positionKey: contract.ticker,
        quantity: 1,
        selectedContract: contract,
      },
    };
    await recordShadowAutomationEvent(agedEntry);
    assert.equal((await db.select().from(executionEventsTable)).length, 0);
    const [sourceOrder] = await db.select().from(shadowOrdersTable);
    assert.ok(sourceOrder);

    const exit = exitEvent({
      id: "00000000-0000-4000-8000-000000000499",
      occurredAt: "2026-07-16T14:35:00.000Z",
      snapshotQuantity: 1,
      exitQuantity: 1,
    });
    exit.payload = {
      ...exit.payload,
      maintenance: true,
      reason: "ledger_reconcile",
      exitReason: "ledger_reconcile",
      sourceOrderId: sourceOrder.id,
      metadata: {
        deploymentId: DEPLOYMENT_ID,
        positionKey: contract.ticker,
      },
      selectedContract: contract,
      position: {
        ...(exit.payload.position as Record<string, unknown>),
        positionKey: contract.ticker,
        selectedContract: contract,
      },
    };

    assert.equal(
      (await persistSignalOptionsLifecycleExitWithFence(exit)).status,
      "inserted",
    );
    assert.equal((await db.select().from(executionEventsTable)).length, 1);

    await db.delete(executionEventsTable);
    const linkedEntry = {
      ...agedEntry,
      payload: {
        ...agedEntry.payload,
        position: {
          ...(agedEntry.payload.position as Record<string, unknown>),
          id: `${DEPLOYMENT_ID}:OTHER`,
        },
      },
    };
    assert.equal(sourceOrder.sourceEventId, linkedEntry.id);
    await db.insert(executionEventsTable).values(linkedEntry);
    assert.equal(
      (await persistSignalOptionsLifecycleExitWithFence(exit)).status,
      "invalid",
    );
    assert.equal(
      (await db.select().from(executionEventsTable)).filter(
        ({ eventType }) => eventType === "signal_options_shadow_exit",
      ).length,
      0,
    );
  });
});

test("entry-order recovery is maintenance-only and never masks invalid entry evidence", async () => {
  const sourceOrderId = "00000000-0000-4000-8000-000000000498";
  const contract = {
    ticker: "O:CRM260716C00250000",
    providerContractId: "crm-aged-entry",
  };
  const candidate = exitEvent({
    id: "00000000-0000-4000-8000-000000000499",
    occurredAt: "2026-07-16T14:35:00.000Z",
    snapshotQuantity: 1,
    exitQuantity: 1,
  });
  candidate.payload = {
    ...candidate.payload,
    maintenance: true,
    reason: "ledger_reconcile",
    sourceOrderId,
    metadata: { positionKey: contract.ticker },
    selectedContract: contract,
    position: {
      ...(candidate.payload.position as Record<string, unknown>),
      positionKey: contract.ticker,
      selectedContract: contract,
    },
  };
  const order = {
    id: sourceOrderId,
    symbol: "CRM",
    quantity: "1",
    filledQuantity: "1",
    optionContract: contract,
    placedAt: OPENED_AT,
    payload: {
      metadata: {
        deploymentId: DEPLOYMENT_ID,
        positionKey: contract.ticker,
      },
      selectedContract: contract,
      position: {
        id: POSITION_ID,
        openedAt: OPENED_AT.toISOString(),
        positionKey: contract.ticker,
        quantity: 1,
        selectedContract: contract,
      },
    },
  };
  const dependencies = (
    events: ExecutionEvent[],
    entryOrder = order,
    onOrderRead: () => void = () => undefined,
  ): SignalOptionsLifecycleExitFenceDependencies => ({
    withLifecycleLock: async (_key, work) => ({
      acquired: true,
      result: await work({
        listEvents: async () => events,
        loadEntryOrder: async () => {
          onOrderRead();
          return entryOrder as never;
        },
        insertEvent: async (event) => event,
      }),
    }),
  });

  const ordinary = {
    ...candidate,
    payload: { ...candidate.payload, maintenance: false },
  };
  assert.equal(
    (
      await persistSignalOptionsLifecycleExitWithFence(
        ordinary,
        undefined,
        dependencies([]),
      )
    ).status,
    "invalid",
  );
  assert.equal(
    (
      await persistSignalOptionsLifecycleExitWithFence(
        candidate,
        undefined,
        dependencies([], { ...order, filledQuantity: "0.5" } as never),
      )
    ).status,
    "invalid",
  );

  let orderReads = 0;
  assert.equal(
    (
      await persistSignalOptionsLifecycleExitWithFence(
        candidate,
        undefined,
        dependencies([entryEvent(0)], order, () => {
          orderReads += 1;
        }),
      )
    ).status,
    "invalid",
  );
  assert.equal(orderReads, 0);

  let provenanceReads = 0;
  const forgedOrder = {
    ...order,
    quantity: "2",
    filledQuantity: "2",
    payload: {
      ...order.payload,
      position: {
        ...order.payload.position,
        quantity: 2,
      },
    },
  };
  assert.equal(
    (
      await persistSignalOptionsLifecycleExitWithFence(
        candidate,
        undefined,
        dependencies([entryEvent(1)], forgedOrder, () => {
          provenanceReads += 1;
        }),
      )
    ).status,
    "invalid",
  );
  assert.equal(provenanceReads, 1);
});

test("expiration waits for a committed partial mirror, then closes the fresh residual", async () => {
  await withTestDb(async () => {
    await seedDeployment();
    const contract = {
      ticker: "O:CRM260716C00250000",
      underlying: "CRM",
      expirationDate: "2026-07-16",
      strike: 250,
      right: "call",
      multiplier: 100,
      providerContractId: "crm-expiration-fence",
    };
    const entry = {
      ...entryEvent(2),
      payload: {
        metadata: {
          deploymentId: DEPLOYMENT_ID,
          runMode: "live_shadow",
          runSource: "automation",
        },
        selectedContract: contract,
        orderPlan: { quantity: 2, simulatedFillPrice: 1 },
        position: {
          id: POSITION_ID,
          candidateId: "candidate-1",
          symbol: "CRM",
          openedAt: OPENED_AT.toISOString(),
          entryPrice: 1,
          quantity: 2,
          selectedContract: contract,
        },
      },
    } satisfies ExecutionEvent;
    await db.insert(executionEventsTable).values(entry);
    assert.ok(
      await recordShadowAutomationEvent(entry, { source: "automation" }),
    );
    const [openPosition] = await db.select().from(shadowPositionsTable);
    assert.ok(openPosition);

    const partial = exitEvent({
      id: "00000000-0000-4000-8000-000000000413",
      occurredAt: "2026-07-16T15:00:00.000Z",
      snapshotQuantity: 2,
      exitQuantity: 1,
      partial: true,
      scaleOutId: "committed_before_mirror",
    });
    partial.payload = {
      ...partial.payload,
      metadata: {
        deploymentId: DEPLOYMENT_ID,
        positionKey: openPosition.positionKey,
        runMode: "live_shadow",
        runSource: "automation",
      },
      selectedContract: contract,
      exitPrice: 0.8,
    };
    await db.insert(executionEventsTable).values(partial);

    maintenanceInternals.setDependenciesForTests({
      resolveMaintenanceOptionExitPrice: async () => ({
        price: 0.5,
        source: "test_expiration_price",
      }),
    });
    try {
      const blocked = await runShadowOptionOpenSafety({
        now: new Date("2026-07-16T21:00:00.000Z"),
      });
      assert.equal(blocked.dueCount, 1);
      assert.equal(blocked.closedCount, 0);
      const [stillOpen] = await db.select().from(shadowPositionsTable);
      assert.equal(stillOpen?.status, "open");
      assert.equal(stillOpen?.quantity, "2.000000");
      assert.equal((await db.select().from(shadowOrdersTable)).length, 1);

      assert.ok(
        await recordShadowAutomationEvent(partial, { source: "automation" }),
      );
      const [residual] = await db.select().from(shadowPositionsTable);
      assert.equal(residual?.status, "open");
      assert.equal(residual?.quantity, "1.000000");

      const closed = await runShadowOptionOpenSafety({
        now: new Date("2026-07-16T21:01:00.000Z"),
      });
      assert.equal(closed.closedCount, 1, JSON.stringify(closed));
      const [finalPosition] = await db.select().from(shadowPositionsTable);
      assert.equal(finalPosition?.status, "closed");
      assert.equal(finalPosition?.quantity, "0.000000");
      assert.equal((await db.select().from(shadowOrdersTable)).length, 3);
      const exits = (await db.select().from(executionEventsTable)).filter(
        (event) => event.eventType === "signal_options_shadow_exit",
      );
      assert.equal(exits.length, 2);
      assert.equal(
        exits.filter((event) => event.payload.mirrorRequired === true).length,
        1,
      );
    } finally {
      maintenanceInternals.setDependenciesForTests(null);
    }
  });
});
