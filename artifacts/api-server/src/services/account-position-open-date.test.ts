import assert from "node:assert/strict";
import test from "node:test";

import type {
  BrokerExecutionSnapshot,
  BrokerPositionSnapshot,
  QuoteSnapshot,
} from "../providers/ibkr/client";
import { buildPositionMarketHydration } from "./account-position-model";
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

test("manual option positions demand structured IBKR quote ids and alias numeric conids", () => {
  const demandProviderContractIds =
    __accountPositionInternalsForTests.optionQuoteDemandProviderContractIdsForPosition(
      manualNvdaPosition,
    );
  assert.equal(demandProviderContractIds.length, 1);
  assert.match(demandProviderContractIds[0], /^twsopt:/);

  const aliasProviderContractIds =
    __accountPositionInternalsForTests.optionQuoteProviderContractIdsForPosition(
      manualNvdaPosition,
    );
  assert.deepEqual(aliasProviderContractIds, [
    demandProviderContractIds[0],
    "12345",
  ]);
});
