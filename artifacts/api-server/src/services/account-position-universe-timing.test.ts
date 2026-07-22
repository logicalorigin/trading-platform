import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { __accountUniverseInternalsForTests } from "./account";

const source = readFileSync(new URL("./account.ts", import.meta.url), "utf8");

const account = (input: {
  id: string;
  provider: "ibkr" | "snaptrade" | "robinhood";
}) => ({
  id: input.id,
  providerAccountId: input.id,
  provider: input.provider,
  mode: "live" as const,
  displayName: input.id,
  currency: "USD",
  buyingPower: 100,
  cash: 100,
  netLiquidation: 100,
  updatedAt: new Date("2026-07-21T12:00:00.000Z"),
});

test("cold account universe reads time each provider lane", async () => {
  const timing = {
    startedAt: performance.now(),
    universeCache: null,
    positionsCache: null,
    positionCount: null,
    stagesMs: {} as Record<string, number>,
  };

  await __accountUniverseInternalsForTests.readLiveAccountUniverseUncached(
    "combined",
    "live",
    {
      appUserId: "positions-timing-user",
      allowDirectIbkr: true,
      listLiveAccounts: async () => [
        account({ id: "ibkr-1", provider: "ibkr" }),
      ],
      getSnapTradeAccounts: async () => [
        account({ id: "snaptrade-1", provider: "snaptrade" }),
      ],
      getRobinhoodAccounts: async () => [
        account({ id: "robinhood-1", provider: "robinhood" }),
      ],
      timing,
    } as never,
  );

  for (const stage of [
    "universe_ibkr_accounts",
    "universe_snaptrade_accounts",
    "universe_robinhood_accounts",
    "universe_provider_fanout",
  ]) {
    assert.equal(typeof timing.stagesMs[stage], "number", `Missing ${stage}`);
  }
});

test("account positions capture universe cache disposition", () => {
  const start = source.indexOf("async function getLiveAccountUniverse");
  const end = source.indexOf(
    "\nasync function readLiveAccountUniverseUncached",
    start,
  );
  assert.notEqual(start, -1, "Missing universe cache reader");
  assert.notEqual(end, -1, "Missing universe cache reader boundary");
  const reader = source.slice(start, end);

  assert.match(reader, /timing\?: AccountPositionsTimingState/);
  assert.match(reader, /timing\.universeCache = disposition/);
});
