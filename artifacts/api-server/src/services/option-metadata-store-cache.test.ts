import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, test } from "node:test";

import { db, instrumentsTable, optionContractsTable } from "@workspace/db";
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

test("durable option metadata yields to finite DB pool pressure", async () => {
  updateApiResourcePressure({ dbPoolActive: 12, dbPoolWaiting: 2, dbPoolMax: 12 });

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
  const diagnostics = getDurableOptionMetadataDiagnostics();

  assert.deepEqual(instruments, []);
  assert.deepEqual(contracts, []);
  assert.equal(diagnostics.writeSuccess, 0);
  assert.equal(diagnostics.writeSkippedPressure, 1);
  assert.equal(__getOptionMetadataInstrumentCacheSizeForTests(), 0);
});

test("durable option metadata reads yield to hard DB pool pressure", async () => {
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
    maxAgeMs: Number.POSITIVE_INFINITY,
    staleMaxAgeMs: Number.POSITIVE_INFINITY,
    now: new Date("2026-06-26T16:00:00.000Z"),
  });
  const chain = await loadDurableOptionChain({
    underlying: "SPY",
    expirationDate: new Date("2026-07-17T00:00:00.000Z"),
    maxAgeMs: Number.POSITIVE_INFINITY,
    staleMaxAgeMs: Number.POSITIVE_INFINITY,
    now: new Date("2026-06-26T16:00:00.000Z"),
  });
  const diagnostics = getDurableOptionMetadataDiagnostics();

  assert.equal(expirations, null);
  assert.equal(chain, null);
  assert.equal(diagnostics.miss, 2);
});
