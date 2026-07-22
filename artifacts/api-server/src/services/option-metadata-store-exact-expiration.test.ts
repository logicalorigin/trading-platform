import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createTestDb, type TestDatabase } from "@workspace/db/testing";

import type { OptionChainContract } from "../providers/ibkr/client";

let testDb: TestDatabase;
let previousQueryLimit: string | undefined;
let store: typeof import("./option-metadata-store");

function contract(input: {
  ticker: string;
  expirationDate: Date;
  strike: number;
}): OptionChainContract {
  const updatedAt = new Date("2026-07-14T16:00:00.000Z");
  return {
    contract: {
      ticker: input.ticker,
      underlying: "SPY",
      expirationDate: input.expirationDate,
      strike: input.strike,
      right: "call",
      multiplier: 100,
      sharesPerContract: 100,
      providerContractId: input.ticker,
    },
    bid: 1,
    ask: 1.1,
    last: 1.05,
    mark: 1.05,
    impliedVolatility: 0.2,
    delta: 0.4,
    gamma: 0.03,
    theta: -0.02,
    vega: 0.1,
    openInterest: 100,
    volume: 10,
    updatedAt,
    quoteUpdatedAt: updatedAt,
    dataUpdatedAt: updatedAt,
  };
}

before(async () => {
  previousQueryLimit = process.env.OPTION_METADATA_QUERY_LIMIT;
  process.env.OPTION_METADATA_QUERY_LIMIT = "2";
  testDb = await createTestDb();
  store = await import("./option-metadata-store");
});

after(async () => {
  await testDb.cleanup();
  if (previousQueryLimit == null) {
    delete process.env.OPTION_METADATA_QUERY_LIMIT;
  } else {
    process.env.OPTION_METADATA_QUERY_LIMIT = previousQueryLimit;
  }
});

test("bounded option metadata reads do not truncate requested expirations", async () => {
  const firstExpiration = new Date("2026-07-17T00:00:00.000Z");
  const requestedExpiration = new Date("2026-07-24T00:00:00.000Z");
  const contracts = [
    contract({
      ticker: "O:SPY260717C00590000",
      expirationDate: firstExpiration,
      strike: 590,
    }),
    contract({
      ticker: "O:SPY260717C00600000",
      expirationDate: firstExpiration,
      strike: 600,
    }),
    contract({
      ticker: "O:SPY260724C00590000",
      expirationDate: requestedExpiration,
      strike: 590,
    }),
    contract({
      ticker: "O:SPY260724C00600000",
      expirationDate: requestedExpiration,
      strike: 600,
    }),
    contract({
      ticker: "O:SPY260724C00610000",
      expirationDate: requestedExpiration,
      strike: 610,
    }),
  ];

  await store.persistDurableOptionChain({
    contracts,
    source: "massive",
    asOf: new Date(),
  });

  const expirations = await store.loadDurableOptionExpirations({
    underlying: "SPY",
    maxAgeMs: 60 * 60_000,
    staleMaxAgeMs: 60 * 60_000,
    now: new Date("2026-07-14T16:01:00.000Z"),
  });
  assert.ok(expirations);
  assert.deepEqual(
    expirations.value.map((expiration) => expiration.toISOString()),
    ["2026-07-17T00:00:00.000Z", "2026-07-24T00:00:00.000Z"],
  );

  const result = await store.loadDurableOptionChain({
    underlying: "SPY",
    expirationDate: requestedExpiration,
    maxAgeMs: 60 * 60_000,
    staleMaxAgeMs: 60 * 60_000,
    now: new Date("2026-07-14T16:01:00.000Z"),
  });

  assert.ok(result);
  assert.deepEqual(
    result.value.map((entry) => entry.contract.ticker),
    ["O:SPY260724C00590000", "O:SPY260724C00600000", "O:SPY260724C00610000"],
  );
});
