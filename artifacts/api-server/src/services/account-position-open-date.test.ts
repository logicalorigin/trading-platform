import assert from "node:assert/strict";
import test from "node:test";

import type {
  BrokerExecutionSnapshot,
  BrokerPositionSnapshot,
  QuoteSnapshot,
} from "../providers/ibkr/client";
import {
  buildPositionMarketHydration,
  buildPositionQuoteFromSnapshot,
} from "./account-position-model";
import { __accountPositionInternalsForTests } from "./account";

const optionContract = {
  ticker: "NVDA260612C00145000",
  underlying: "NVDA",
  expirationDate: new Date("2026-06-12T00:00:00.000Z"),
  strike: 145,
  right: "call" as const,
  multiplier: 100,
  sharesPerContract: 100,
  providerContractId: "12345",
};

const manualNvdaPosition = {
  id: "U123:12345",
  accountId: "U123",
  symbol: "NVDA",
  assetClass: "option",
  quantity: 1,
  averagePrice: 2,
  marketPrice: 2,
  marketValue: 200,
  unrealizedPnl: 0,
  unrealizedPnlPercent: 0,
  optionContract,
} satisfies BrokerPositionSnapshot;

const sameDayBuyExecution = {
  id: "exec-1",
  accountId: "U123",
  symbol: "NVDA",
  assetClass: "option",
  side: "buy",
  quantity: 1,
  price: 2,
  netAmount: -200,
  exchange: "SMART",
  executedAt: new Date("2026-06-08T14:35:00.000Z"),
  orderDescription: null,
  contractDescription: "NVDA260612C00145000",
  providerContractId: "12345",
  optionContract,
  orderRef: null,
} satisfies BrokerExecutionSnapshot;

const liveQuoteWithoutDayChange = {
  symbol: "NVDA",
  price: 2.45,
  bid: 2.4,
  ask: 2.5,
  updatedAt: new Date("2026-06-08T15:00:00.000Z"),
} as QuoteSnapshot;

test("manual same-day option executions infer openedAt for position day PnL", () => {
  const openDates =
    __accountPositionInternalsForTests.buildExecutionOpenDatesForPositions(
      [manualNvdaPosition],
      [sameDayBuyExecution],
    );

  assert.equal(openDates.get(manualNvdaPosition.id)?.openedAtSource, "execution");
  assert.equal(
    openDates.get(manualNvdaPosition.id)?.openedAt?.toISOString(),
    "2026-06-08T14:35:00.000Z",
  );

  const hydrated = buildPositionMarketHydration(
    manualNvdaPosition,
    liveQuoteWithoutDayChange,
    {
      openedAt: openDates.get(manualNvdaPosition.id)?.openedAt,
      now: new Date("2026-06-08T15:01:00.000Z"),
    },
  );

  assert.ok(Math.abs(hydrated.unrealizedPnl - 45) < 1e-9);
  assert.equal(hydrated.dayChange, hydrated.unrealizedPnl);
  assert.equal(hydrated.dayChangePercent, hydrated.unrealizedPnlPercent);
});

test("execution open dates stay stable through transient empty reads", () => {
  __accountPositionInternalsForTests.clearAccountPositionOpenDateCaches();
  const openDates =
    __accountPositionInternalsForTests.buildExecutionOpenDatesForPositions(
      [manualNvdaPosition],
      [sameDayBuyExecution],
    );
  const cacheKey = "test:execution-open-date-stability";
  const observed =
    __accountPositionInternalsForTests.stabilizeExecutionOpenDatesForPositions(
      cacheKey,
      [manualNvdaPosition],
      openDates,
      Date.parse("2026-06-08T15:00:00.000Z"),
    );

  assert.equal(observed.get(manualNvdaPosition.id)?.openedAtSource, "execution");

  const afterEmptyRead =
    __accountPositionInternalsForTests.stabilizeExecutionOpenDatesForPositions(
      cacheKey,
      [manualNvdaPosition],
      new Map(),
      Date.parse("2026-06-08T15:00:30.000Z"),
    );

  assert.equal(
    afterEmptyRead.get(manualNvdaPosition.id)?.openedAt?.toISOString(),
    "2026-06-08T14:35:00.000Z",
  );

  const differentPosition = {
    ...manualNvdaPosition,
    quantity: 2,
  } satisfies BrokerPositionSnapshot;
  const changedSignatureRead =
    __accountPositionInternalsForTests.stabilizeExecutionOpenDatesForPositions(
      "test:changed-position-signature",
      [differentPosition],
      new Map(),
      Date.parse("2026-06-08T15:00:30.000Z"),
    );

  assert.equal(changedSignatureRead.size, 0);
});

test("same-day expiring manual options infer today's open date when broker history is absent", () => {
  const spyPosition = {
    ...manualNvdaPosition,
    id: "U123:890576032",
    symbol: "SPY",
    optionContract: {
      ...optionContract,
      ticker: "SPY260623C00740000",
      underlying: "SPY",
      expirationDate: new Date("2026-06-23T00:00:00.000Z"),
      strike: 740,
      providerContractId: "890576032",
    },
  } satisfies BrokerPositionSnapshot;

  const openDates =
    __accountPositionInternalsForTests.inferSameDayExpiringOptionOpenDatesForPositions(
      [spyPosition],
      new Date("2026-06-23T17:05:00.000Z"),
    );

  assert.equal(
    openDates.get(spyPosition.id)?.openedAt?.toISOString(),
    "2026-06-23T12:00:00.000Z",
  );
  assert.equal(
    openDates.get(spyPosition.id)?.openedAtSource,
    "expiration_same_day",
  );

  const hydrated = buildPositionMarketHydration(
    spyPosition,
    liveQuoteWithoutDayChange,
    {
      openedAt: openDates.get(spyPosition.id)?.openedAt,
      now: new Date("2026-06-23T17:06:00.000Z"),
    },
  );

  assert.equal(hydrated.dayChange, hydrated.unrealizedPnl);

  const nextDay =
    __accountPositionInternalsForTests.inferSameDayExpiringOptionOpenDatesForPositions(
      [spyPosition],
      new Date("2026-06-24T14:00:00.000Z"),
    );
  assert.equal(nextDay.size, 0);
});

test("missing quote and broker market price do not fabricate mark from average price", () => {
  const positionWithoutMarketPrice = {
    ...manualNvdaPosition,
    marketPrice: 0,
    marketValue: 0,
    unrealizedPnl: 0,
    unrealizedPnlPercent: 0,
  } satisfies BrokerPositionSnapshot;

  const hydrated = buildPositionMarketHydration(
    positionWithoutMarketPrice,
    null,
  );

  assert.equal(hydrated.mark, null);
  assert.equal(
    buildPositionQuoteFromSnapshot(null, hydrated.mark, "bridge_quote"),
    null,
  );
});

test("manual option positions demand OPRA quote ids and alias numeric conids", () => {
  const demandProviderContractIds =
    __accountPositionInternalsForTests.optionQuoteDemandProviderContractIdsForPosition(
      manualNvdaPosition,
    );
  assert.equal(demandProviderContractIds.length, 1);
  assert.equal(demandProviderContractIds[0], "O:NVDA260612C00145000");

  const aliasProviderContractIds =
    __accountPositionInternalsForTests.optionQuoteProviderContractIdsForPosition(
      manualNvdaPosition,
    );
  assert.deepEqual(aliasProviderContractIds, [
    demandProviderContractIds[0],
    "12345",
  ]);
});
