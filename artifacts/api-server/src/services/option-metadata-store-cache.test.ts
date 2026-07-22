import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, test } from "node:test";

import {
  __setDbForTests,
  currentDbLane,
  db,
  instrumentsTable,
  optionContractsTable,
  runInDbLane,
  runWithPostgresDiagnosticContext,
} from "@workspace/db";
import { createTestDb, type TestDatabase } from "@workspace/db/testing";

import type { OptionChainContract } from "../providers/ibkr/client";
import {
  __getOptionMetadataInstrumentCacheSizeForTests,
  __resetDurableOptionMetadataStoreForTests,
  __resetOptionMetadataInstrumentCacheForTests,
  getDurableOptionMetadataDiagnostics,
  loadDurableOptionChain,
  loadDurableOptionExpirations,
  persistDurableOptionChain,
} from "./option-metadata-store";
import {
  __resetApiResourcePressureForTests,
  updateApiResourcePressure,
} from "./resource-pressure";

let testDb: TestDatabase;
const source = readFileSync(new URL("./option-metadata-store.ts", import.meta.url), "utf8");

before(async () => {
  testDb = await createTestDb();
});

after(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  __resetApiResourcePressureForTests();
  __resetDurableOptionMetadataStoreForTests();
  __resetOptionMetadataInstrumentCacheForTests();
  await testDb.client.exec(
    "truncate table option_chain_latest, option_contracts, instruments restart identity cascade",
  );
});

function optionContract(input: {
  ticker: string;
  underlying?: string;
  expirationDate?: Date;
  strike: number;
  right: "call" | "put";
}): OptionChainContract {
  const updatedAt = new Date("2026-06-26T16:00:00.000Z");
  return {
    contract: {
      ticker: input.ticker,
      underlying: input.underlying ?? "SPY",
      expirationDate: input.expirationDate ?? new Date("2026-07-17T00:00:00.000Z"),
      strike: input.strike,
      right: input.right,
      multiplier: 100,
      sharesPerContract: 100,
      providerContractId: input.ticker,
    },
    bid: 1.2,
    ask: 1.35,
    last: 1.28,
    mark: 1.27,
    impliedVolatility: 0.24,
    delta: 0.42,
    gamma: 0.03,
    theta: -0.02,
    vega: 0.11,
    openInterest: 1200,
    volume: 340,
    updatedAt,
    quoteUpdatedAt: updatedAt,
    dataUpdatedAt: updatedAt,
  };
}

test("durable option metadata caches instrument ids across repeated chain writes", async () => {
  const contracts = [
    optionContract({
      ticker: "O:SPY260717C00600000",
      strike: 600,
      right: "call",
    }),
    optionContract({
      ticker: "O:SPY260717P00580000",
      strike: 580,
      right: "put",
    }),
  ];

  await persistDurableOptionChain({
    contracts,
    source: "massive",
    asOf: new Date("2026-06-26T16:00:00.000Z"),
  });

  assert.equal(
    __getOptionMetadataInstrumentCacheSizeForTests(),
    3,
    "underlying plus two option instruments should be cached",
  );

  const firstInstruments = await db
    .select({ symbol: instrumentsTable.symbol })
    .from(instrumentsTable);
  const firstContracts = await db
    .select({ massiveTicker: optionContractsTable.massiveTicker })
    .from(optionContractsTable);
  assert.deepEqual(
    firstInstruments.map((row) => row.symbol).sort(),
    ["O:SPY260717C00600000", "O:SPY260717P00580000", "SPY"],
  );
  assert.equal(firstContracts.length, 2);

  await persistDurableOptionChain({
    contracts,
    source: "massive",
    asOf: new Date("2026-06-26T16:01:00.000Z"),
  });

  assert.equal(
    __getOptionMetadataInstrumentCacheSizeForTests(),
    3,
    "repeated writes should reuse the same cached instrument ids",
  );

  const secondInstruments = await db
    .select({ symbol: instrumentsTable.symbol })
    .from(instrumentsTable);
  const secondContracts = await db
    .select({ massiveTicker: optionContractsTable.massiveTicker })
    .from(optionContractsTable);
  assert.equal(secondInstruments.length, firstInstruments.length);
  assert.equal(secondContracts.length, firstContracts.length);
});

test("unchanged contract metadata is not rewritten while its quote advances", async () => {
  const contract = optionContract({
    ticker: "O:SPY260717C00600000",
    strike: 600,
    right: "call",
  });
  const changedContract = optionContract({
    ticker: "O:SPY260717P00580000",
    strike: 580,
    right: "put",
  });
  await persistDurableOptionChain({
    contracts: [contract, changedContract],
    source: "massive",
    asOf: new Date("2026-06-26T16:00:00.000Z"),
  });

  const metadataTimestamp = new Date("2020-01-01T00:00:00.000Z");
  await testDb.client.exec(
    `update option_contracts set updated_at = '${metadataTimestamp.toISOString()}'`,
  );
  const quoteTimestamp = new Date("2026-06-26T16:01:00.000Z");
  await persistDurableOptionChain({
    contracts: [
      {
        ...contract,
        bid: 2.4,
        updatedAt: quoteTimestamp,
        quoteUpdatedAt: quoteTimestamp,
        dataUpdatedAt: quoteTimestamp,
      },
      {
        ...changedContract,
        contract: {
          ...changedContract.contract,
          multiplier: 50,
        },
        bid: 3.4,
        updatedAt: quoteTimestamp,
        quoteUpdatedAt: quoteTimestamp,
        dataUpdatedAt: quoteTimestamp,
      },
    ],
    source: "massive",
    asOf: quoteTimestamp,
  });

  const storedContracts = await db
    .select({
      massiveTicker: optionContractsTable.massiveTicker,
      updatedAt: optionContractsTable.updatedAt,
    })
    .from(optionContractsTable);
  const storedContract = storedContracts.find(
    (row) => row.massiveTicker === contract.contract.ticker,
  );
  const storedChain = await loadDurableOptionChain({
    underlying: "SPY",
    expirationDate: new Date("2026-07-17T00:00:00.000Z"),
    maxAgeMs: 365 * 24 * 60 * 60_000,
    staleMaxAgeMs: 365 * 24 * 60 * 60_000,
    now: quoteTimestamp,
  });

  assert.equal(
    storedContract?.updatedAt.toISOString(),
    metadataTimestamp.toISOString(),
  );
  const storedQuote = storedChain?.value.find(
    (row) => row.contract.ticker === contract.contract.ticker,
  );
  assert.equal(storedQuote?.bid, 2.4);
  assert.equal(
    storedQuote?.dataUpdatedAt?.toISOString(),
    quoteTimestamp.toISOString(),
  );
});

test("changed contract metadata is updated and remains available to quote writes", async () => {
  const contract = optionContract({
    ticker: "O:SPY260717C00600000",
    strike: 600,
    right: "call",
  });
  await persistDurableOptionChain({
    contracts: [contract],
    source: "massive",
    asOf: new Date("2026-06-26T16:00:00.000Z"),
  });

  const metadataTimestamp = new Date("2020-01-01T00:00:00.000Z");
  await testDb.client.exec(
    `update option_contracts set updated_at = '${metadataTimestamp.toISOString()}'`,
  );
  const quoteTimestamp = new Date("2026-06-26T16:01:00.000Z");
  await persistDurableOptionChain({
    contracts: [
      {
        ...contract,
        contract: {
          ...contract.contract,
          multiplier: 50,
          sharesPerContract: 50,
          providerContractId: "12345",
        },
        bid: 2.4,
        updatedAt: quoteTimestamp,
        quoteUpdatedAt: quoteTimestamp,
        dataUpdatedAt: quoteTimestamp,
      },
    ],
    source: "massive",
    asOf: quoteTimestamp,
  });

  const [storedContract] = await db
    .select({
      brokerContractId: optionContractsTable.brokerContractId,
      multiplier: optionContractsTable.multiplier,
      sharesPerContract: optionContractsTable.sharesPerContract,
      updatedAt: optionContractsTable.updatedAt,
    })
    .from(optionContractsTable);
  const storedChain = await loadDurableOptionChain({
    underlying: "SPY",
    expirationDate: new Date("2026-07-17T00:00:00.000Z"),
    maxAgeMs: 365 * 24 * 60 * 60_000,
    staleMaxAgeMs: 365 * 24 * 60 * 60_000,
    now: quoteTimestamp,
  });

  assert.equal(storedContract?.brokerContractId, "12345");
  assert.equal(storedContract?.multiplier, 50);
  assert.equal(storedContract?.sharesPerContract, 50);
  assert.notEqual(
    storedContract?.updatedAt.toISOString(),
    metadataTimestamp.toISOString(),
  );
  assert.equal(storedChain?.value[0]?.bid, 2.4);
});

test("broker alias conflicts fall back to per-contract reconciliation", async () => {
  const brokerContractId = "12345";
  const original = optionContract({
    ticker: "O:SPY260717C00600000",
    strike: 600,
    right: "call",
  });
  original.contract.providerContractId = brokerContractId;
  await persistDurableOptionChain({
    contracts: [original],
    source: "massive",
    asOf: new Date("2026-06-26T16:00:00.000Z"),
  });

  const [seeded] = await db
    .select({ id: optionContractsTable.id })
    .from(optionContractsTable);
  const corrected = optionContract({
    ticker: "O:SPY260717C00610000",
    strike: 610,
    right: "call",
  });
  corrected.contract.providerContractId = brokerContractId;

  await persistDurableOptionChain({
    contracts: [corrected],
    source: "massive",
    asOf: new Date("2026-06-26T16:01:00.000Z"),
  });

  const storedContracts = await db
    .select({
      id: optionContractsTable.id,
      massiveTicker: optionContractsTable.massiveTicker,
      brokerContractId: optionContractsTable.brokerContractId,
    })
    .from(optionContractsTable);

  assert.equal(storedContracts.length, 1);
  assert.equal(storedContracts[0]?.id, seeded?.id);
  assert.equal(storedContracts[0]?.massiveTicker, corrected.contract.ticker);
  assert.equal(storedContracts[0]?.brokerContractId, brokerContractId);
});

test("durable option metadata uses batched contract persistence", () => {
  assert.match(
    source,
    /const savedContracts = await upsertOptionContracts\(input\.contracts\)/,
  );
  assert.match(source, /target:\s*optionContractsTable\.massiveTicker/);
  assert.doesNotMatch(
    source,
    /for \(const contract of input\.contracts\)[\s\S]*await upsertOptionContract/,
  );
});

test("durable option metadata resolves lazy queries in the background DB lane when diagnostic context already exists", async () => {
  const observedLanes: string[] = [];
  type LazyRows = PromiseLike<unknown[]> & {
    from: () => LazyRows;
    where: () => LazyRows;
    limit: () => LazyRows;
  };
  const lazyRows: LazyRows = {
    from: () => lazyRows,
    where: () => lazyRows,
    limit: () => lazyRows,
    then: (onfulfilled, onrejected) => {
      observedLanes.push(currentDbLane());
      return Promise.resolve([]).then(onfulfilled, onrejected);
    },
  };
  const restoreDb = __setDbForTests({
    select: () => lazyRows,
  } as unknown as Parameters<typeof __setDbForTests>[0]);

  try {
    const result = await runWithPostgresDiagnosticContext(
      { routeClass: "live-data", workloadFamily: "option-chain-request" },
      () =>
        runInDbLane("interactive", () =>
          loadDurableOptionExpirations({
            underlying: "SPY",
            maxAgeMs: 60_000,
            staleMaxAgeMs: 120_000,
          }),
        ),
    );

    assert.equal(result, null);
    assert.deepEqual(observedLanes, ["background"]);
  } finally {
    restoreDb();
  }
});

test("durable option metadata still persists through event-loop-only API pressure", async () => {
  updateApiResourcePressure({ eventLoopUtilization: 0.95 });

  await persistDurableOptionChain({
    contracts: [
      optionContract({
        ticker: "O:SPY260717C00600000",
        strike: 600,
        right: "call",
      }),
    ],
    source: "massive",
    asOf: new Date("2026-06-26T16:00:00.000Z"),
  });

  const instruments = await db
    .select({ symbol: instrumentsTable.symbol })
    .from(instrumentsTable);
  const contracts = await db
    .select({ massiveTicker: optionContractsTable.massiveTicker })
    .from(optionContractsTable);

  assert.deepEqual(
    instruments.map((row) => row.symbol).sort(),
    ["O:SPY260717C00600000", "SPY"],
  );
  assert.deepEqual(
    contracts.map((row) => row.massiveTicker),
    ["O:SPY260717C00600000"],
  );
  assert.equal(__getOptionMetadataInstrumentCacheSizeForTests(), 2);
});

test("durable option metadata completes every write batch under finite DB pool pressure", async () => {
  updateApiResourcePressure({ dbPoolActive: 12, dbPoolWaiting: 2, dbPoolMax: 12 });

  const pressuredContracts = Array.from({ length: 129 }, (_, index) =>
    optionContract({
      ticker: `SPY-${index}`,
      strike: 500 + index / 1_000,
      right: "call",
    }),
  );

  await persistDurableOptionChain({
    contracts: pressuredContracts,
    source: "massive",
    asOf: new Date("2026-06-26T16:00:00.000Z"),
  });

  const instruments = await db
    .select({ symbol: instrumentsTable.symbol })
    .from(instrumentsTable);
  const contracts = await db
    .select({ massiveTicker: optionContractsTable.massiveTicker })
    .from(optionContractsTable);
  const diagnostics = getDurableOptionMetadataDiagnostics();

  assert.equal(
    instruments.length,
    130,
    "underlying plus every option is durable",
  );
  assert.equal(
    contracts.length,
    129,
    "no later batch may be reported as success without writing",
  );
  assert.equal(diagnostics.writeSuccess, 1);
  assert.equal(diagnostics.writeSkippedPressure, 0);
  assert.equal(__getOptionMetadataInstrumentCacheSizeForTests(), 130);
});

test("durable option metadata reads do not manufacture cache misses from DB pressure labels", async () => {
  await persistDurableOptionChain({
    contracts: [
      optionContract({
        ticker: "O:SPY260717C00600000",
        strike: 600,
        right: "call",
      }),
    ],
    source: "massive",
    asOf: new Date("2026-06-26T16:00:00.000Z"),
  });
  __resetApiResourcePressureForTests();
  updateApiResourcePressure({ dbPoolActive: 12, dbPoolWaiting: 8, dbPoolMax: 12 });
  updateApiResourcePressure({ dbPoolActive: 12, dbPoolWaiting: 8, dbPoolMax: 12 });

  const expirations = await loadDurableOptionExpirations({
    underlying: "SPY",
    maxAgeMs: 365 * 24 * 60 * 60_000,
    staleMaxAgeMs: 365 * 24 * 60 * 60_000,
    now: new Date("2026-06-26T16:00:00.000Z"),
  });
  const chain = await loadDurableOptionChain({
    underlying: "SPY",
    expirationDate: new Date("2026-07-17T00:00:00.000Z"),
    maxAgeMs: 365 * 24 * 60 * 60_000,
    staleMaxAgeMs: 365 * 24 * 60 * 60_000,
    now: new Date("2026-06-26T16:00:00.000Z"),
  });
  const diagnostics = getDurableOptionMetadataDiagnostics();

  assert.deepEqual(
    expirations?.value.map((expiration) => expiration.toISOString()),
    ["2026-07-17T00:00:00.000Z"],
  );
  assert.deepEqual(
    chain?.value.map((contract) => contract.contract.ticker),
    ["O:SPY260717C00600000"],
  );
  assert.equal(diagnostics.miss, 0);
});

test("concurrent durable option metadata writes complete instead of dropping a caller", async () => {
  const first = persistDurableOptionChain({
    contracts: [
      optionContract({
        ticker: "O:SPY260717C00600000",
        strike: 600,
        right: "call",
      }),
    ],
    source: "massive",
    asOf: new Date("2026-06-26T16:00:00.000Z"),
  });
  const second = persistDurableOptionChain({
    contracts: [
      optionContract({
        ticker: "O:QQQ260717P00500000",
        underlying: "QQQ",
        strike: 500,
        right: "put",
      }),
    ],
    source: "massive",
    asOf: new Date("2026-06-26T16:00:00.000Z"),
  });

  await Promise.all([first, second]);

  const instruments = await db
    .select({ symbol: instrumentsTable.symbol })
    .from(instrumentsTable);
  const contracts = await db
    .select({ massiveTicker: optionContractsTable.massiveTicker })
    .from(optionContractsTable);
  const diagnostics = getDurableOptionMetadataDiagnostics();

  assert.deepEqual(
    instruments.map((row) => row.symbol).sort(),
    ["O:QQQ260717P00500000", "O:SPY260717C00600000", "QQQ", "SPY"],
  );
  assert.deepEqual(
    contracts.map((row) => row.massiveTicker).sort(),
    ["O:QQQ260717P00500000", "O:SPY260717C00600000"],
  );
  assert.equal(diagnostics.writeSuccess, 2);
  assert.equal(diagnostics.writeSkippedConcurrency, 0);
});
