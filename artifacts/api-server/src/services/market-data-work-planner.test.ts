import assert from "node:assert/strict";
import test from "node:test";

import { buildMarketDataWorkPlan } from "./market-data-work-planner";
import type { MarketDataLease } from "./market-data-admission";

function makeLease(input: {
  id: string;
  owner: string;
  ownerClass: MarketDataLease["ownerClass"];
  intent: MarketDataLease["intent"];
  pool: MarketDataLease["pool"];
  assetClass?: MarketDataLease["assetClass"];
  symbol: string;
  lineIds: string[];
  lineRoles?: MarketDataLease["lineRoles"];
}): MarketDataLease {
  return {
    id: input.id,
    owner: input.owner,
    ownerClass: input.ownerClass,
    intent: input.intent,
    pool: input.pool,
    priority: 100,
    assetClass: input.assetClass ?? "option",
    instrumentKey: `option:${input.symbol}`,
    symbol: input.symbol,
    providerContractId: null,
    role: "option-contract",
    lineIds: input.lineIds,
    lineRoles:
      input.lineRoles ??
      Object.fromEntries(
        input.lineIds.map((lineId) => [lineId, "option-contract"]),
      ),
    lineCost: input.lineIds.length,
    fallbackProvider: "massive",
    acquiredAt: "2026-06-26T15:00:00.000Z",
    expiresAt: null,
  };
}

test("work planner reports option market-data leases as Massive, not IBKR", () => {
  const plan = buildMarketDataWorkPlan({
    generatedAt: "2026-06-26T15:00:00.000Z",
    admission: {
      generatedAt: "2026-06-26T15:00:00.000Z",
      activeLineCount: 3,
      leaseCount: 2,
      flowScannerLineCount: 2,
      leases: [
        makeLease({
          id: "scanner-spy",
          owner: "flow-scanner:SPY",
          ownerClass: "flow-scanner",
          intent: "flow-scanner-live",
          pool: "flow-scanner",
          symbol: "SPY",
          lineIds: ["option:SPY:1", "option:SPY:2"],
        }),
        makeLease({
          id: "account-spy",
          owner: "account-monitor:SPY",
          ownerClass: "account-monitor",
          intent: "account-monitor-live",
          pool: "account-monitor",
          symbol: "SPY",
          lineIds: ["option:SPY:account"],
        }),
        makeLease({
          id: "account-underlier-spy",
          owner: "account-monitor:SPY:underlier",
          ownerClass: "account-monitor",
          intent: "account-monitor-live",
          pool: "account-monitor",
          assetClass: "equity",
          symbol: "SPY",
          lineIds: ["equity:SPY"],
          lineRoles: { "equity:SPY": "option-underlier-support" },
        }),
      ],
    },
  } as never);

  assert.equal(plan.summary.massiveOptionLineCount, 3);
  assert.equal(plan.summary.massiveOptionSymbolCount, 1);
  assert.equal(plan.summary.ibkrOptionLineCount, 0);
  assert.equal(plan.summary.ibkrOptionSymbolCount, 0);
  assert.equal(plan.summary.ibkrEquityLineCount, 0);
  assert.equal(plan.summary.ibkrLiveLineCount, 0);
  assert.equal(plan.massiveOptionLive[0]?.provider, "massive");
  assert.deepEqual(
    plan.massiveOptionLive.map((entry) => entry.owner).sort(),
    ["account-monitor:SPY", "flow-scanner:SPY"],
  );
  assert.equal(plan.ibkrOptionLive.length, 0);
  assert.equal(plan.ibkrEquityLive.length, 0);
});
