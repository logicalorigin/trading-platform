import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  algoDeploymentsTable,
  algoStrategiesTable,
  db,
  executionEventsTable,
} from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";

import {
  __shadowWatchlistBacktestInternalsForTests as internals,
  signalOptionsLifecycleEventId,
} from "./shadow-account";

const { signalOptionsShadowExitEventIsDuplicate } = internals;
const source = readFileSync(
  new URL("./shadow-account.ts", import.meta.url),
  "utf8",
);

const openedAt = new Date("2026-06-12T14:30:00.000Z");
const candidate = {
  deploymentId: "deployment-1",
  symbol: "CRM",
  since: openedAt,
  lifecyclePositionId: "deployment-1:CRM",
  lifecycleOpenedAt: openedAt.toISOString(),
};
const matchingLifecycle = {
  position: {
    id: candidate.lifecyclePositionId,
    openedAt: candidate.lifecycleOpenedAt,
  },
};

test("Signal Options shadow exit dedup: suppresses the same final-exit lifecycle", () => {
  const isDuplicate = signalOptionsShadowExitEventIsDuplicate(candidate, [
    {
      deploymentId: "deployment-1",
      symbol: "CRM",
      occurredAt: new Date("2026-06-12T17:00:00.000Z"),
      payload: matchingLifecycle,
    },
  ]);

  assert.equal(isDuplicate, true);
});

test("Signal Options shadow exit dedup: does not let an overlapping same-symbol lifecycle suppress another position", () => {
  const isDuplicate = signalOptionsShadowExitEventIsDuplicate(candidate, [
    {
      deploymentId: "deployment-1",
      symbol: "CRM",
      occurredAt: new Date("2026-06-12T17:00:00.000Z"),
      payload: {
        position: {
          id: "deployment-1:CRM:other",
          openedAt: candidate.lifecycleOpenedAt,
        },
      },
    },
  ]);

  assert.equal(isDuplicate, false);
});

test("Signal Options shadow exit dedup: distinguishes contracts sharing the coarse lifecycle clock", () => {
  const contract = (providerContractId: string, strike: number) => ({
    ticker: `O:CRM260619C00${strike}000`,
    underlying: "CRM",
    expirationDate: "2026-06-19",
    strike,
    right: "call",
    multiplier: 100,
    providerContractId,
  });
  const firstContract = contract("crm-250-call", 250);
  const secondContract = contract("crm-255-call", 255);
  const contractAwareCandidate = {
    ...candidate,
    lifecyclePositionKey: "option:CRM:2026-06-19:250:call:crm-250-call",
    lifecycleCandidateId: "candidate-250-call",
    lifecycleSelectedContract: firstContract,
  };
  const event = (
    selectedContract: ReturnType<typeof contract>,
    candidateId: string,
  ) => ({
    deploymentId: candidate.deploymentId,
    symbol: candidate.symbol,
    occurredAt: new Date("2026-06-12T17:00:00.000Z"),
    payload: {
      selectedContract,
      position: {
        ...matchingLifecycle.position,
        candidateId,
        selectedContract,
      },
    },
  });

  assert.equal(
    signalOptionsShadowExitEventIsDuplicate(contractAwareCandidate, [
      event(firstContract, "candidate-250-call"),
    ]),
    true,
  );
  assert.equal(
    signalOptionsShadowExitEventIsDuplicate(contractAwareCandidate, [
      event(secondContract, "candidate-255-call"),
    ]),
    false,
  );
});

test("Signal Options shadow exit dedup: provider enrichment does not split one contract", () => {
  const tickerOnly = {
    ticker: "O:CRM260619C00250000",
    underlying: "CRM",
    expirationDate: "2026-06-19",
    strike: 250,
    right: "call",
    multiplier: 100,
  };
  const enriched = {
    ...tickerOnly,
    providerContractId: "crm-250-call",
  };
  const candidateFor = (
    selectedContract: typeof tickerOnly | typeof enriched,
  ) => ({
    ...candidate,
    lifecycleSelectedContract: selectedContract,
  });
  const eventFor = (selectedContract: typeof tickerOnly | typeof enriched) => ({
    deploymentId: candidate.deploymentId,
    symbol: candidate.symbol,
    occurredAt: new Date("2026-06-12T17:00:00.000Z"),
    payload: {
      selectedContract,
      position: {
        ...matchingLifecycle.position,
        selectedContract,
      },
    },
  });

  assert.equal(
    signalOptionsShadowExitEventIsDuplicate(candidateFor(enriched), [
      eventFor(tickerOnly),
    ]),
    true,
  );
  assert.equal(
    signalOptionsShadowExitEventIsDuplicate(candidateFor(tickerOnly), [
      eventFor(enriched),
    ]),
    true,
  );
});

test("Signal Options shadow exit dedup: provider-only legacy evidence matches an enriched contract", () => {
  const providerOnly = {
    providerContractId: "crm-250-call",
  };
  const enriched = {
    ticker: "O:CRM260619C00250000",
    underlying: "CRM",
    expirationDate: "2026-06-19",
    strike: 250,
    right: "call",
    multiplier: 100,
    providerContractId: providerOnly.providerContractId,
  };
  const candidateFor = (
    selectedContract: typeof providerOnly | typeof enriched,
  ) => ({
    ...candidate,
    lifecycleSelectedContract: selectedContract,
  });
  const eventFor = (
    selectedContract: typeof providerOnly | typeof enriched,
  ) => ({
    deploymentId: candidate.deploymentId,
    symbol: candidate.symbol,
    occurredAt: new Date("2026-06-12T17:00:00.000Z"),
    payload: {
      selectedContract,
      position: {
        ...matchingLifecycle.position,
        selectedContract,
      },
    },
  });

  assert.equal(
    signalOptionsShadowExitEventIsDuplicate(candidateFor(enriched), [
      eventFor(providerOnly),
    ]),
    true,
  );
  assert.equal(
    signalOptionsShadowExitEventIsDuplicate(candidateFor(providerOnly), [
      eventFor(enriched),
    ]),
    true,
  );
});

test("Signal Options shadow exit dedup: does not cross-match ticker and provider namespaces", () => {
  const tickerOnly = { ticker: "shared-identifier-text" };
  const providerOnly = { providerContractId: "shared-identifier-text" };
  const eventFor = (selectedContract: typeof providerOnly) => ({
    deploymentId: candidate.deploymentId,
    symbol: candidate.symbol,
    occurredAt: new Date("2026-06-12T17:00:00.000Z"),
    payload: {
      selectedContract,
      position: {
        ...matchingLifecycle.position,
        selectedContract,
      },
    },
  });

  assert.equal(
    signalOptionsShadowExitEventIsDuplicate(
      { ...candidate, lifecycleSelectedContract: tickerOnly },
      [eventFor(providerOnly)],
    ),
    false,
  );
  const eventIdFor = (
    selectedContract: typeof tickerOnly | typeof providerOnly,
  ) =>
    signalOptionsLifecycleEventId({
      deploymentId: candidate.deploymentId,
      eventType: "signal_options_shadow_exit",
      payload: {
        exitQuantity: 1,
        selectedContract,
        position: {
          ...matchingLifecycle.position,
          quantity: 1,
          selectedContract,
        },
      },
    });
  assert.notEqual(eventIdFor(tickerOnly), eventIdFor(providerOnly));
});

test("Signal Options shadow exit dedup: equal-time reentry is not suppressed by the prior lifecycle", () => {
  const reentryOpenedAt = new Date("2026-06-12T17:00:00.000Z");
  const isDuplicate = signalOptionsShadowExitEventIsDuplicate(
    {
      ...candidate,
      since: reentryOpenedAt,
      lifecycleOpenedAt: reentryOpenedAt.toISOString(),
    },
    [
      {
        deploymentId: "deployment-1",
        symbol: "CRM",
        occurredAt: reentryOpenedAt,
        payload: matchingLifecycle,
      },
    ],
  );

  assert.equal(isDuplicate, false);
});

test("Signal Options shadow exit dedup: pre-exit lifecycle identity matches the durable fence", () => {
  const isDuplicate = signalOptionsShadowExitEventIsDuplicate(candidate, [
    {
      deploymentId: "deployment-1",
      symbol: "CRM",
      occurredAt: new Date("2026-06-12T17:00:00.000Z"),
      payload: {
        preExitPosition: matchingLifecycle.position,
      },
    },
  ]);

  assert.equal(isDuplicate, true);
});

test("Signal Options shadow exit dedup: legacy payload-less finals retain the conservative restart guard", () => {
  const isDuplicate = signalOptionsShadowExitEventIsDuplicate(candidate, [
    {
      deploymentId: "deployment-1",
      symbol: "CRM",
      occurredAt: new Date("2026-06-12T17:00:00.000Z"),
      payload: {},
    },
  ]);

  assert.equal(isDuplicate, true);
});

test("Signal Options shadow exit dedup: allows the exit when no matching event exists", () => {
  const isDuplicate = signalOptionsShadowExitEventIsDuplicate(candidate, []);

  assert.equal(isDuplicate, false);
});

test("Signal Options shadow exit dedup: does not suppress a different symbol on the same deployment", () => {
  const isDuplicate = signalOptionsShadowExitEventIsDuplicate(candidate, [
    {
      deploymentId: "deployment-1",
      symbol: "MSFT",
      occurredAt: new Date("2026-06-12T17:00:00.000Z"),
      payload: matchingLifecycle,
    },
  ]);

  assert.equal(isDuplicate, false);
});

test("Signal Options shadow exit dedup: does not suppress a matching symbol on a different deployment", () => {
  const isDuplicate = signalOptionsShadowExitEventIsDuplicate(candidate, [
    {
      deploymentId: "deployment-2",
      symbol: "CRM",
      occurredAt: new Date("2026-06-12T17:00:00.000Z"),
      payload: matchingLifecycle,
    },
  ]);

  assert.equal(isDuplicate, false);
});

test("Signal Options shadow exit dedup: does not suppress an exit event from a prior entry->exit cycle (before openedAt)", () => {
  const isDuplicate = signalOptionsShadowExitEventIsDuplicate(candidate, [
    {
      deploymentId: "deployment-1",
      symbol: "CRM",
      occurredAt: new Date("2026-06-10T12:00:00.000Z"),
      payload: matchingLifecycle,
    },
  ]);

  assert.equal(isDuplicate, false);
});

test("Signal Options shadow exit dedup: symbol matching is case-insensitive", () => {
  const isDuplicate = signalOptionsShadowExitEventIsDuplicate(candidate, [
    {
      deploymentId: "deployment-1",
      symbol: "crm",
      occurredAt: new Date("2026-06-12T17:00:00.000Z"),
      payload: matchingLifecycle,
    },
  ]);

  assert.equal(isDuplicate, true);
});

test("Signal Options shadow exit dedup: partial scale-outs do not suppress the later final exit", () => {
  const isDuplicate = signalOptionsShadowExitEventIsDuplicate(candidate, [
    {
      deploymentId: "deployment-1",
      symbol: "CRM",
      occurredAt: new Date("2026-06-12T17:00:00.000Z"),
      payload: { partial: true, scaleOutId: "first_trail_arm" },
    },
  ]);

  assert.equal(isDuplicate, false);
});

test("Signal Options shadow exit lookup treats malformed string partials as conservative finals", async () => {
  await withTestDb(async () => {
    const strategyId = "00000000-0000-4000-8000-000000000451";
    const deploymentId = "00000000-0000-4000-8000-000000000452";
    await db.insert(algoStrategiesTable).values({
      id: strategyId,
      name: "Malformed partial dedup",
      mode: "shadow",
      enabled: true,
      symbolUniverse: ["CRM"],
      config: {},
    });
    await db.insert(algoDeploymentsTable).values({
      id: deploymentId,
      strategyId,
      name: "Malformed partial dedup",
      mode: "shadow",
      enabled: true,
      providerAccountId: "shadow",
      symbolUniverse: ["CRM"],
      config: {},
    });
    await db.insert(executionEventsTable).values({
      id: "00000000-0000-4000-8000-000000000453",
      deploymentId,
      symbol: "CRM",
      eventType: "signal_options_shadow_exit",
      summary: "malformed legacy partial",
      occurredAt: new Date("2026-06-12T17:00:00.000Z"),
      payload: {
        partial: "true",
        remainingQuantity: 1,
        position: {
          id: `${deploymentId}:CRM`,
          openedAt: openedAt.toISOString(),
        },
      },
    });

    assert.equal(
      await internals.hasExistingSignalOptionsShadowExitEventForTests({
        deploymentId,
        symbol: "CRM",
        since: openedAt,
        lifecyclePositionId: `${deploymentId}:CRM`,
        lifecycleOpenedAt: openedAt.toISOString(),
      }),
      true,
    );
  });
});

test("Signal Options shadow exit dedup: historical final exits do not suppress a live final exit", () => {
  const isDuplicate = signalOptionsShadowExitEventIsDuplicate(candidate, [
    {
      deploymentId: "deployment-1",
      symbol: "CRM",
      occurredAt: new Date("2026-06-12T17:00:00.000Z"),
      payload: {
        backfillEventKey: "signal_options_backfill:CRM:exit",
        metadata: {
          runMode: "historical_backfill",
          runSource: "signal_options_backfill",
        },
      },
    },
  ]);

  assert.equal(isDuplicate, false);
});

test("Signal Options shadow exit dedup: a live final wins beside a historical row in either order", () => {
  const historical = {
    deploymentId: "deployment-1",
    symbol: "CRM",
    occurredAt: new Date("2026-06-12T17:00:00.000Z"),
    payload: { metadata: { runMode: "historical_backfill" } },
  };
  const live = {
    deploymentId: "deployment-1",
    symbol: "CRM",
    occurredAt: new Date("2026-06-12T17:01:00.000Z"),
    payload: matchingLifecycle,
  };

  assert.equal(
    signalOptionsShadowExitEventIsDuplicate(candidate, [historical, live]),
    true,
  );
  assert.equal(
    signalOptionsShadowExitEventIsDuplicate(candidate, [live, historical]),
    true,
  );
});

test("Signal Options shadow exit lookup never limits before historical classification", () => {
  const lookup =
    source.match(
      /async function hasExistingSignalOptionsShadowExitEvent[\s\S]*?^}/m,
    )?.[0] ?? "";

  assert.ok(lookup);
  assert.doesNotMatch(lookup, /\.limit\(1\)/);
});
