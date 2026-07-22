import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { resolveSignalOptionsExecutionProfile } from "@workspace/backtest-core";
import {
  algoDeploymentsTable,
  algoStrategiesTable,
  db,
  executionEventsTable,
  shadowAccountsTable,
  shadowPositionMarksTable,
  shadowPositionsTable,
} from "@workspace/db";
import { createTestDb, type TestDatabase } from "@workspace/db/testing";

import {
  __signalOptionsAutomationInternalsForTests as internals,
  type SignalOptionsPosition,
} from "./signal-options-automation";
import {
  clearSignalOptionsStopElectionStateForTests,
  electSignalOptionsRegularStop,
} from "./signal-options-stop-election";
import { SHADOW_PROVIDER_ACCOUNT_ID } from "./algo-deployment-account";

const NOW = new Date("2026-07-07T15:30:00.000Z");
const OPENED_AT = new Date("2026-07-07T14:30:00.000Z");
const EXPIRATION = "2026-07-17";
const PROVIDER_CONTRACT_ID = "OPT-CACHE-1";
const SHADOW_POSITION_ID = "00000000-0000-0000-0000-000000000101";
const STRATEGY_ID = "00000000-0000-0000-0000-000000000201";
const DEPLOYMENT_ID = "00000000-0000-0000-0000-000000000301";

const selectedContract = {
  underlying: "TST",
  expirationDate: EXPIRATION,
  strike: 100,
  right: "call",
  multiplier: 100,
  sharesPerContract: 100,
  providerContractId: PROVIDER_CONTRACT_ID,
};

const profile = resolveSignalOptionsExecutionProfile({
  exitPolicy: {
    hardStopPct: -10,
    trailActivationPct: 500,
  },
});

let testDb: TestDatabase;

before(async () => {
  testDb = await createTestDb();
});

after(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  internals.__resetSignalOptionsPeakFloorFallbackCacheForTests();
  internals.__resetSignalOptionsClaimedExitsForTests();
  clearSignalOptionsStopElectionStateForTests();
  await testDb.client.exec(
    "truncate table shadow_position_marks, shadow_positions, execution_events, algo_deployments, algo_strategies, shadow_accounts restart identity cascade",
  );
});

function shadowPositionKey() {
  return ["option", "TST", EXPIRATION, 100, "call", PROVIDER_CONTRACT_ID].join(
    ":",
  );
}

function position(
  input: {
    id?: string;
    candidateId?: string;
    openedAt?: Date;
    peakPrice?: number;
    quantity?: number;
  } = {},
): SignalOptionsPosition {
  const openedAt = input.openedAt ?? OPENED_AT;
  const quantity = input.quantity ?? 1;
  return {
    id: input.id ?? "position-1",
    candidateId: input.candidateId ?? "candidate-1",
    symbol: "TST",
    direction: "buy",
    optionRight: "call",
    timeframe: "1m",
    signalAt: openedAt.toISOString(),
    openedAt: openedAt.toISOString(),
    entryPrice: 1,
    quantity,
    peakPrice: input.peakPrice ?? 1,
    stopPrice: 0.9,
    premiumAtRisk: 100 * quantity,
    selectedContract,
    lastMarkPrice: 1,
    lastMarkedAt: NOW.toISOString(),
  };
}

function quote(mark: number) {
  return {
    providerContractId: PROVIDER_CONTRACT_ID,
    bid: mark,
    ask: mark,
    price: mark,
    updatedAt: NOW,
    dataUpdatedAt: NOW,
    freshness: "live",
    marketDataMode: "live",
  };
}

function quoteWithTrade(input: { identity: string; occurredAt: Date }) {
  return {
    ...quote(0.92),
    bid: 0.84,
    ask: 1,
    last: 0.7,
    lastTrade: {
      provider: "massive" as const,
      identity: input.identity,
      price: 0.7,
      size: 1,
      occurredAt: input.occurredAt,
      sequenceNumber: null,
      exchange: "316",
      conditionCodes: ["209"],
      eligible: true,
    },
    updatedAt: input.occurredAt,
    dataUpdatedAt: input.occurredAt,
  };
}

function quoteWithWideStopBreach(observedAt: Date) {
  return {
    ...quote(0.175),
    bid: 0.05,
    ask: 0.3,
    updatedAt: observedAt,
    dataUpdatedAt: observedAt,
  };
}

async function seedShadowPositionWithMarks(quantity = 1) {
  await db.insert(shadowAccountsTable).values({
    id: "shadow",
    displayName: "Shadow",
    startingBalance: "100000",
    cash: "100000",
  });
  await db.insert(shadowPositionsTable).values({
    id: SHADOW_POSITION_ID,
    accountId: "shadow",
    positionKey: shadowPositionKey(),
    symbol: "TST",
    assetClass: "option",
    positionType: "long",
    quantity: String(quantity),
    averageCost: "1",
    mark: "1.2",
    marketValue: "120",
    optionContract: selectedContract,
    openedAt: OPENED_AT,
    asOf: NOW,
    status: "open",
  });
  await db.insert(shadowPositionMarksTable).values([
    {
      accountId: "shadow",
      positionId: SHADOW_POSITION_ID,
      mark: "1.2",
      marketValue: "120",
      unrealizedPnl: "20",
      source: "quote",
      asOf: new Date("2026-07-07T15:20:00.000Z"),
    },
    {
      accountId: "shadow",
      positionId: SHADOW_POSITION_ID,
      mark: "1.4",
      marketValue: "140",
      unrealizedPnl: "40",
      source: "quote",
      asOf: new Date("2026-07-07T15:10:00.000Z"),
    },
  ]);
}

async function seedDeployment() {
  await db.insert(algoStrategiesTable).values({
    id: STRATEGY_ID,
    name: "Signal options",
    mode: "shadow",
    enabled: true,
    symbolUniverse: ["TST"],
    config: {},
  });
  const [deployment] = await db
    .insert(algoDeploymentsTable)
    .values({
      id: DEPLOYMENT_ID,
      strategyId: STRATEGY_ID,
      name: "Signal options deployment",
      mode: "shadow",
      enabled: true,
      providerAccountId: SHADOW_PROVIDER_ACCOUNT_ID,
      symbolUniverse: ["TST"],
      config: {},
    })
    .returning();
  return deployment!;
}

async function seedLedgerEntry(openPosition: SignalOptionsPosition) {
  await db.insert(executionEventsTable).values({
    deploymentId: DEPLOYMENT_ID,
    providerAccountId: SHADOW_PROVIDER_ACCOUNT_ID,
    symbol: openPosition.symbol,
    eventType: "signal_options_shadow_entry",
    summary: `${openPosition.symbol} entry`,
    occurredAt: new Date(openPosition.openedAt),
    payload: { position: openPosition },
  });
}

async function refresh(input: {
  position: SignalOptionsPosition;
  now?: Date;
  mark?: number;
  quoteSnapshot?:
    | ReturnType<typeof quote>
    | ReturnType<typeof quoteWithTrade>
    | ReturnType<typeof quoteWithWideStopBreach>;
  deployment?: Awaited<ReturnType<typeof seedDeployment>>;
  profile?: typeof profile;
}) {
  return await internals.refreshActivePosition({
    deployment:
      input.deployment ??
      ({
        id: DEPLOYMENT_ID,
        mode: "shadow",
        providerAccountId: SHADOW_PROVIDER_ACCOUNT_ID,
        config: {},
      } as never),
    profile: input.profile ?? profile,
    position: input.position,
    quoteSnapshot: (input.quoteSnapshot ?? quote(input.mark ?? 1.1)) as never,
    quoteSource: "provider_stream",
    enforcementSource: "option_quote_tick",
    recordMarkWhenChanged: false,
    now: input.now ?? NOW,
  });
}

test("same-position refreshes within the TTL reuse one shadow mark fallback DB read", async () => {
  const openPosition = position();
  let reads = 0;
  const read = async () => {
    reads += 1;
    return {
      positionId: SHADOW_POSITION_ID,
      latestMarkPrice: 1.2,
      latestAsOf: NOW,
      peakMarkPrice: 1.4,
      peakAsOf: NOW,
      source: "quote",
    };
  };

  const first = await internals.readCachedShadowPositionMarkFallbackForTests({
    position: openPosition,
    now: NOW,
  }, { read });
  const second = await internals.readCachedShadowPositionMarkFallbackForTests({
    position: openPosition,
    now: NOW,
  }, { read });

  assert.equal(first?.latestMarkPrice, 1.2);
  assert.equal(second?.latestMarkPrice, 1.2);
  assert.equal(reads, 1);
});

test("fresh executable bids ratchet peaks despite entry-only liquidity gates", async () => {
  const openPosition = position();
  const entryBlockedProfile = resolveSignalOptionsExecutionProfile({
    liquidityGate: {
      minBid: 1.5,
      maxSpreadPctOfMid: 25,
      requireBidAsk: true,
      requireFreshQuote: true,
    },
    exitPolicy: {
      hardStopPct: -50,
      trailActivationPct: 500,
    },
  });

  const result = await refresh({
    position: openPosition,
    profile: entryBlockedProfile,
    quoteSnapshot: {
      ...quote(2),
      bid: 1.2,
      ask: 2.8,
    },
  });

  assert.equal(result.position?.peakPrice, 1.2);
  assert.equal(result.position?.lastStop?.peakEvidenceSource, "executable_bid");

  const crossedQuote = await refresh({
    position: result.position ?? openPosition,
    profile: entryBlockedProfile,
    quoteSnapshot: {
      ...quote(2.5),
      bid: 3,
      ask: 2,
    },
  });
  assert.equal(crossedQuote.position?.peakPrice, 1.2);
});

test("live position refresh cannot loosen a persisted trailing stop", async () => {
  const nonMonotonicProfile = resolveSignalOptionsExecutionProfile({
    exitPolicy: {
      progressiveTrailEnabled: true,
      progressiveTrailSteps: [
        { activationPct: 20, minLockedGainPct: 20, givebackPct: 10 },
        { activationPct: 30, minLockedGainPct: 0, givebackPct: 30 },
      ],
    },
  });
  const openPosition = {
    ...position({ peakPrice: 1.29 }),
    stopPrice: 1.2,
    lastStop: {
      stopPrice: 1.2,
      peakEvidenceSource: "executable_bid",
    },
  };

  const result = await refresh({
    position: openPosition,
    profile: nonMonotonicProfile,
    quoteSnapshot: {
      ...quote(1.35),
      bid: 1.3,
      ask: 1.4,
    },
  });

  assert.equal(result.position?.peakPrice, 1.3);
  assert.equal(result.position?.stopPrice, 1.21);
  assert.equal(result.position?.lastStop?.stopPrice, 1.21);
});

test("entry freshness overrides cannot admit stale peak evidence", async () => {
  const deployment = await seedDeployment();
  const staleEntryProfile = resolveSignalOptionsExecutionProfile({
    liquidityGate: {
      minBid: 0.01,
      maxSpreadPctOfMid: 25,
      requireBidAsk: true,
      requireFreshQuote: true,
    },
    liquidityHaltControls: {
      freshQuoteRequiredEnabled: false,
    },
    exitPolicy: {
      hardStopPct: -50,
      trailActivationPct: 500,
    },
  });

  const result = await refresh({
    position: position(),
    deployment,
    profile: staleEntryProfile,
    quoteSnapshot: {
      ...quote(2),
      freshness: "stale",
    },
  });

  assert.equal(result.managed, false);
  assert.equal(result.reason, "position_mark_unavailable");
});

test("expired peak-floor cache re-reads the shadow mark fallback", async () => {
  const openPosition = position();
  const advancedNow = new Date(
    NOW.getTime() + internals.SIGNAL_OPTIONS_PEAK_FLOOR_CACHE_TTL_MS + 1,
  );
  let reads = 0;
  const read = async () => {
    reads += 1;
    return null;
  };

  await internals.readCachedShadowPositionMarkFallbackForTests({
    position: openPosition,
    now: NOW,
  }, { read });
  await internals.readCachedShadowPositionMarkFallbackForTests({
    position: openPosition,
    now: advancedNow,
  }, { read });

  assert.equal(reads, 2);
});

test("a same-id re-entry cannot inherit the prior lifecycle executable peak", async () => {
  const firstLifecycle = position({ peakPrice: 1 });
  const secondLifecycle = position({
    openedAt: new Date(OPENED_AT.getTime() + 60_000),
    peakPrice: 1,
  });

  const first = await refresh({ position: firstLifecycle, mark: 4 });
  const second = await refresh({ position: secondLifecycle, mark: 1.1 });

  assert.equal(first.position?.peakPrice, 4);
  assert.equal(second.position?.peakPrice, 1.1);
});

test("a same-id re-entry cannot complete the prior lifecycle stop election", async () => {
  await seedShadowPositionWithMarks();
  const deployment = await seedDeployment();
  const trailingProfile = resolveSignalOptionsExecutionProfile({
    exitPolicy: {
      hardStopPct: -50,
      trailActivationPct: 0,
      minLockedGainPct: 0,
      trailGivebackPct: 10,
    },
  });
  const firstLifecycle = position();
  const secondLifecycle = position({
    openedAt: new Date(OPENED_AT.getTime() + 60_000),
  });

  const first = await refresh({
    position: firstLifecycle,
    deployment,
    profile: trailingProfile,
    quoteSnapshot: quoteWithTrade({
      identity: "massive:first-lifecycle-trade",
      occurredAt: NOW,
    }),
  });
  const secondAt = new Date(NOW.getTime() + 1_000);
  const second = await refresh({
    position: secondLifecycle,
    deployment,
    now: secondAt,
    profile: trailingProfile,
    quoteSnapshot: quoteWithTrade({
      identity: "massive:second-lifecycle-trade",
      occurredAt: secondAt,
    }),
  });

  assert.equal(first.exited, undefined);
  assert.equal(second.exited, undefined);
});

test("two hard-stop confirmations exit and delete the peak-floor cache entry", async () => {
  await seedShadowPositionWithMarks();
  const deployment = await seedDeployment();
  const openPosition = position();
  await seedLedgerEntry(openPosition);

  await internals.readCachedShadowPositionMarkFallbackForTests({
    position: openPosition,
    now: NOW,
  });
  assert.equal(
    internals.__hasSignalOptionsPeakFloorFallbackCacheForTests(openPosition),
    true,
  );

  const firstBreach = await refresh({
    position: openPosition,
    deployment,
    quoteSnapshot: quoteWithTrade({
      identity: "massive:trade-1",
      occurredAt: NOW,
    }),
  });

  assert.equal(firstBreach.exited, undefined);
  assert.equal(
    internals.__hasSignalOptionsPeakFloorFallbackCacheForTests(openPosition),
    true,
  );

  const confirmedAt = new Date(NOW.getTime() + 1_000);
  const exit = await refresh({
    position: firstBreach.position ?? openPosition,
    deployment,
    now: confirmedAt,
    quoteSnapshot: quoteWithTrade({
      identity: "massive:trade-2",
      occurredAt: confirmedAt,
    }),
  });

  assert.equal(exit.exited, true);
  assert.equal(exit.exitReason, "hard_stop");
  assert.equal(
    internals.__hasSignalOptionsPeakFloorFallbackCacheForTests(openPosition),
    false,
  );

  const exitRows = (await db.select().from(executionEventsTable)).filter(
    (event) => event.eventType === "signal_options_shadow_exit",
  );
  assert.equal(exitRows.length, 1);
});

test("entry liquidity gates do not suppress double-ask hard-stop confirmation", async () => {
  await seedShadowPositionWithMarks();
  const deployment = await seedDeployment();
  const openPosition = position();
  await seedLedgerEntry(openPosition);
  const lowBidWideSpreadProfile = resolveSignalOptionsExecutionProfile({
    liquidityGate: {
      minBid: 0.5,
      maxSpreadPctOfMid: 25,
      requireBidAsk: true,
      requireFreshQuote: true,
    },
    exitPolicy: {
      hardStopPct: -10,
      trailActivationPct: 500,
    },
  });

  const firstBreach = await refresh({
    position: openPosition,
    deployment,
    profile: lowBidWideSpreadProfile,
    quoteSnapshot: quoteWithWideStopBreach(NOW),
  });

  assert.equal(firstBreach.exited, undefined);
  const stopElection = firstBreach.position?.lastStop?.["stopElection"] as
    | { evidenceCount?: number }
    | undefined;
  assert.equal(stopElection?.evidenceCount, 1);

  const confirmedAt = new Date(NOW.getTime() + 1_000);
  const exit = await refresh({
    position: firstBreach.position ?? openPosition,
    deployment,
    now: confirmedAt,
    profile: lowBidWideSpreadProfile,
    quoteSnapshot: quoteWithWideStopBreach(confirmedAt),
  });

  assert.equal(exit.exited, true);
  assert.equal(exit.exitReason, "hard_stop");
});

test("an elected last-trade stop cannot exit after the current mark recovers", async () => {
  await seedShadowPositionWithMarks();
  const deployment = await seedDeployment();
  const openPosition = position();
  await seedLedgerEntry(openPosition);
  const positionKey = internals.signalOptionsPeakFloorCacheKey(openPosition);

  electSignalOptionsRegularStop({
    positionKey,
    stopPrice: 0.9,
    stopRevision: "0.900000",
    observedAt: new Date(NOW.getTime() - 1_000),
    trade: {
      price: 0.7,
      identity: "massive:stale-trade-1",
      eligible: true,
      fresh: true,
    },
  });
  const elected = electSignalOptionsRegularStop({
    positionKey,
    stopPrice: 0.9,
    stopRevision: "0.900000",
    observedAt: new Date(NOW.getTime() - 500),
    trade: {
      price: 0.7,
      identity: "massive:stale-trade-2",
      eligible: true,
      fresh: true,
    },
  });
  assert.equal(elected.elected, true);

  const recovered = await refresh({
    position: openPosition,
    deployment,
    quoteSnapshot: quote(1.1),
  });

  assert.equal(recovered.exited, undefined);
  const exitRows = (await db.select().from(executionEventsTable)).filter(
    (event) => event.eventType === "signal_options_shadow_exit",
  );
  assert.equal(exitRows.length, 0);
});

test("a stale lifecycle snapshot cannot report an exit or clear its peak cache", async () => {
  await seedShadowPositionWithMarks(2);
  const deployment = await seedDeployment();
  const stalePosition = position({ quantity: 2 });
  await seedLedgerEntry(stalePosition);
  await internals.readCachedShadowPositionMarkFallbackForTests({
    position: stalePosition,
    now: NOW,
  });
  await db.insert(executionEventsTable).values({
    id: "00000000-0000-4000-8000-000000000412",
    deploymentId: DEPLOYMENT_ID,
    providerAccountId: SHADOW_PROVIDER_ACCOUNT_ID,
    symbol: stalePosition.symbol,
    eventType: "signal_options_shadow_exit",
    summary: `${stalePosition.symbol} partial exit`,
    occurredAt: new Date(NOW.getTime() - 1_000),
    payload: {
      partial: true,
      scaleOutId: "already_committed_partial",
      exitQuantity: 1,
      remainingQuantity: 1,
      preExitPosition: stalePosition,
      position: { ...stalePosition, quantity: 1 },
      remainingPosition: { ...stalePosition, quantity: 1 },
    },
  });

  const result = await refresh({
    position: stalePosition,
    deployment,
    quoteSnapshot: quoteWithTrade({
      identity: "massive:stale-lifecycle-trade",
      occurredAt: NOW,
    }),
  });

  assert.equal(result.exited, undefined);
  assert.equal(result.scaledOut, undefined);
  assert.equal(
    internals.__hasSignalOptionsPeakFloorFallbackCacheForTests(stalePosition),
    true,
  );
  const exits = (await db.select().from(executionEventsTable)).filter(
    (event) => event.eventType === "signal_options_shadow_exit",
  );
  assert.deepEqual(
    exits.map((event) => event.id),
    ["00000000-0000-4000-8000-000000000412"],
  );
});

test("one runner-trail breach still waits for a distinct confirmation", async () => {
  await seedShadowPositionWithMarks();
  const deployment = await seedDeployment();
  const trailingProfile = resolveSignalOptionsExecutionProfile({});
  const openPosition = position();
  await seedLedgerEntry(openPosition);
  const peak = await refresh({
    position: openPosition,
    deployment,
    mark: 2,
    profile: trailingProfile,
  });
  const firstBreachAt = new Date(NOW.getTime() + 1_000);
  const firstBreach = await refresh({
    position: peak.position ?? openPosition,
    deployment,
    now: firstBreachAt,
    profile: trailingProfile,
    quoteSnapshot: quoteWithTrade({
      identity: "massive:trail-trade-1",
      occurredAt: firstBreachAt,
    }),
  });

  assert.equal(firstBreach.exited, undefined);
  assert.equal(firstBreach.position?.lastStop?.exitReason, null);

  const exitAt = new Date(firstBreachAt.getTime() + 1_000);
  const exit = await refresh({
    position: firstBreach.position ?? openPosition,
    deployment,
    now: exitAt,
    profile: trailingProfile,
    quoteSnapshot: quoteWithTrade({
      identity: "massive:trail-trade-2",
      occurredAt: exitAt,
    }),
  });
  assert.equal(exit.exited, true);
  assert.equal(exit.exitReason, "runner_trail_stop");
});

test("scale-out residual preserves executable peak provenance after cache clear", async () => {
  await seedShadowPositionWithMarks(2);
  const deployment = await seedDeployment();
  const scaleOutProfile = resolveSignalOptionsExecutionProfile({
    exitPolicy: {
      hardStopPct: -50,
      scaleOut: {
        enabled: true,
        sellFractionPct: 50,
        runnerGivebackPct: 30,
      },
    },
  });
  const openPosition = position({ quantity: 2 });
  await seedLedgerEntry(openPosition);

  const scaleOut = await refresh({
    position: openPosition,
    deployment,
    mark: 2,
    profile: scaleOutProfile,
  });

  assert.equal(scaleOut.scaledOut, true);
  assert.equal(scaleOut.position?.quantity, 1);
  assert.equal(scaleOut.position?.stopPrice, 1.75);
  assert.equal(scaleOut.position?.lastStop?.stopPrice, 1.75);
  assert.equal(
    scaleOut.position?.lastStop?.peakEvidenceSource,
    "executable_bid",
  );
  assert.equal(
    internals.__hasSignalOptionsPeakFloorFallbackCacheForTests(openPosition),
    false,
  );

  const lowerQuoteAt = new Date(NOW.getTime() + 1_000);
  const lower = await refresh({
    position: scaleOut.position ?? openPosition,
    deployment,
    now: lowerQuoteAt,
    mark: 1.2,
    profile: scaleOutProfile,
  });
  assert.equal(lower.position?.peakPrice, 2);
});
