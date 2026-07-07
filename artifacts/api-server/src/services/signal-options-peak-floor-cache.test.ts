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
let shadowPositionSelects = 0;
let shadowMarkSelects = 0;

before(async () => {
  testDb = await createTestDb();
  const realSelect = testDb.db.select.bind(testDb.db);
  (
    testDb.db as unknown as { select: (...args: unknown[]) => unknown }
  ).select = (...args: unknown[]) => {
    const builder = realSelect(...(args as [])) as {
      from: (...fromArgs: unknown[]) => unknown;
    };
    const realFrom = builder.from.bind(builder);
    builder.from = (...fromArgs: unknown[]) => {
      if (fromArgs[0] === shadowPositionsTable) {
        shadowPositionSelects += 1;
      }
      if (fromArgs[0] === shadowPositionMarksTable) {
        shadowMarkSelects += 1;
      }
      return realFrom(...fromArgs);
    };
    return builder;
  };
});

after(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  internals.__resetSignalOptionsPeakFloorFallbackCacheForTests();
  shadowPositionSelects = 0;
  shadowMarkSelects = 0;
  await testDb.client.exec(
    "truncate table shadow_position_marks, shadow_positions, execution_events, algo_deployments, algo_strategies, shadow_accounts restart identity cascade",
  );
});

function shadowPositionKey() {
  return [
    "option",
    "TST",
    EXPIRATION,
    100,
    "call",
    PROVIDER_CONTRACT_ID,
  ].join(":");
}

function position(
  input: { id?: string; peakPrice?: number } = {},
): SignalOptionsPosition {
  return {
    id: input.id ?? "position-1",
    candidateId: "candidate-1",
    symbol: "TST",
    direction: "buy",
    optionRight: "call",
    timeframe: "1m",
    signalAt: OPENED_AT.toISOString(),
    openedAt: OPENED_AT.toISOString(),
    entryPrice: 1,
    quantity: 1,
    peakPrice: input.peakPrice ?? 1,
    stopPrice: 0.9,
    premiumAtRisk: 100,
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

async function seedShadowPositionWithMarks() {
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
    quantity: "1",
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

async function refresh(input: {
  position: SignalOptionsPosition;
  now?: Date;
  mark?: number;
  deployment?: Awaited<ReturnType<typeof seedDeployment>>;
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
    profile,
    position: input.position,
    quoteSnapshot: quote(input.mark ?? 1.1) as never,
    quoteSource: "provider_stream",
    enforcementSource: "option_quote_tick",
    recordMarkWhenChanged: false,
    now: input.now ?? NOW,
  });
}

test("same-position refreshes within the TTL reuse one shadow mark fallback DB read", async () => {
  await seedShadowPositionWithMarks();
  const openPosition = position();

  const first = await refresh({ position: openPosition });
  const second = await refresh({ position: openPosition });

  assert.equal(first.position?.peakPrice, 1.4);
  assert.equal(second.position?.peakPrice, 1.4);
  assert.equal(shadowPositionSelects, 1);
  assert.equal(shadowMarkSelects, 1);
});

test("expired peak-floor cache re-reads the shadow mark fallback", async () => {
  await seedShadowPositionWithMarks();
  const openPosition = position();
  const advancedNow = new Date(
    NOW.getTime() + internals.SIGNAL_OPTIONS_PEAK_FLOOR_CACHE_TTL_MS + 1,
  );

  await refresh({ position: openPosition, now: NOW });
  await refresh({
    position: { ...openPosition, lastMarkedAt: advancedNow.toISOString() },
    now: advancedNow,
  });

  assert.equal(shadowPositionSelects, 2);
  assert.equal(shadowMarkSelects, 2);
});

test("position exit deletes the peak-floor cache entry", async () => {
  await seedShadowPositionWithMarks();
  const deployment = await seedDeployment();
  const openPosition = position();

  await refresh({ position: openPosition, deployment });
  assert.equal(
    internals.__hasSignalOptionsPeakFloorFallbackCacheForTests(openPosition),
    true,
  );

  const exit = await refresh({
    position: openPosition,
    deployment,
    mark: 0.7,
  });

  assert.equal(exit.exited, true);
  assert.equal(
    internals.__hasSignalOptionsPeakFloorFallbackCacheForTests(openPosition),
    false,
  );

  const exitRows = await db.select().from(executionEventsTable);
  assert.equal(exitRows.length, 1);
});
