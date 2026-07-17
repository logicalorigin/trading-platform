import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { eq } from "drizzle-orm";

import {
  universeCatalogListingsTable,
  universeCatalogSyncStatesTable,
} from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";
import type { UniverseTicker } from "../providers/massive/market-data";
import {
  hydrateUniverseCatalogListingWithIbkr,
  upsertUniverseCatalogRows,
} from "./platform";

const ticker: UniverseTicker = {
  ticker: "AAPL",
  name: "Apple Inc.",
  market: "stocks",
  rootSymbol: "AAPL",
  normalizedExchangeMic: "XNAS",
  exchangeDisplay: "NASDAQ",
  logoUrl: null,
  countryCode: "US",
  exchangeCountryCode: "US",
  sector: null,
  industry: null,
  contractDescription: null,
  contractMeta: null,
  locale: "us",
  type: "CS",
  active: true,
  primaryExchange: "NASDAQ",
  currencyName: "USD",
  cik: null,
  compositeFigi: null,
  shareClassFigi: null,
  lastUpdatedAt: null,
  provider: "massive",
  providers: ["massive"],
  tradeProvider: null,
  dataProviderPreference: "massive",
  providerContractId: null,
};

test("a superseded universe writer cannot commit catalog rows", async () => {
  await withTestDb(async ({ db }) => {
    await db.insert(universeCatalogSyncStatesTable).values({
      scopeKey: "catalog:writer",
      phase: "writer",
      market: "stocks",
      activeOnly: true,
      metadata: { leaseFenceToken: "11" },
    });
    const fencedUpsert = upsertUniverseCatalogRows as unknown as (
      rows: UniverseTicker[],
      options: { writerFenceToken: string },
    ) => Promise<void>;

    await assert.rejects(
      fencedUpsert([ticker], { writerFenceToken: "10" }),
      /superseded/iu,
    );
    assert.equal(
      (await db.select().from(universeCatalogListingsTable)).length,
      0,
    );
  });
});

test("an unfenced universe writer cannot overwrite a fenced catalog row", async () => {
  await withTestDb(async ({ db }) => {
    await db.insert(universeCatalogSyncStatesTable).values({
      scopeKey: "catalog:writer",
      phase: "writer",
      market: "stocks",
      activeOnly: true,
      metadata: { leaseFenceToken: "11" },
    });
    await upsertUniverseCatalogRows([ticker], { writerFenceToken: "11" });
    const unfencedUpsert = upsertUniverseCatalogRows as unknown as (
      rows: UniverseTicker[],
    ) => Promise<void>;

    await assert.rejects(
      unfencedUpsert([{ ...ticker, name: "Stale Apple" }]),
      /writer fence token is required/iu,
    );
    const [persisted] = await db.select().from(universeCatalogListingsTable);
    assert.equal(persisted?.name, ticker.name);
  });
});

test("lease loss during a bulk catalog upsert rolls back the batch", async () => {
  await withTestDb(async ({ db }) => {
    await db.insert(universeCatalogSyncStatesTable).values({
      scopeKey: "catalog:writer",
      phase: "writer",
      market: "stocks",
      activeOnly: true,
      metadata: { leaseFenceToken: "14" },
    });
    const leaseLost = new Error("Universe-catalog lease lost");
    let signalChecks = 0;
    const signal = {
      throwIfAborted() {
        signalChecks += 1;
        if (signalChecks === 5) throw leaseLost;
      },
    } as AbortSignal;
    const fencedUpsert = upsertUniverseCatalogRows as unknown as (
      rows: UniverseTicker[],
      options: {
        writerFenceToken: string;
        signal?: AbortSignal;
      },
    ) => Promise<void>;

    await assert.rejects(
      fencedUpsert(
        [
          ticker,
          {
            ...ticker,
            ticker: "MSFT",
            name: "Microsoft Corporation",
            rootSymbol: "MSFT",
          },
        ],
        { writerFenceToken: "14", signal },
      ),
      (error) => error === leaseLost,
    );
    assert.equal(signalChecks, 5);
    assert.equal(
      (await db.select().from(universeCatalogListingsTable)).length,
      0,
    );
  });
});

test("IBKR catalog hydration requires a writer fence before provider work", async () => {
  await withTestDb(async () => {
    const unfencedHydrate =
      hydrateUniverseCatalogListingWithIbkr as unknown as (input: {
        listingKey: string;
      }) => Promise<unknown>;
    await assert.rejects(
      unfencedHydrate({ listingKey: "missing" }),
      /writer fence token is required/iu,
    );
  });
});

test("a lost writer lease aborts catalog hydration before state changes", async () => {
  await withTestDb(async ({ db }) => {
    await db.insert(universeCatalogSyncStatesTable).values({
      scopeKey: "catalog:writer",
      phase: "writer",
      market: "stocks",
      activeOnly: true,
      metadata: { leaseFenceToken: "12" },
    });
    const controller = new AbortController();
    const leaseLost = new Error("Universe-catalog lease lost");
    controller.abort(leaseLost);

    await assert.rejects(
      hydrateUniverseCatalogListingWithIbkr(
        {
          listingKey: "missing",
          writerFenceToken: "12",
        },
        { signal: controller.signal },
      ),
      (error) => error === leaseLost,
    );
    assert.equal(
      (await db.select().from(universeCatalogListingsTable)).length,
      0,
    );
  });
});

test("catalog hydration rechecks its lease after the listing read", async () => {
  await withTestDb(async ({ db }) => {
    await db.insert(universeCatalogSyncStatesTable).values({
      scopeKey: "catalog:writer",
      phase: "writer",
      market: "stocks",
      activeOnly: true,
      metadata: { leaseFenceToken: "12" },
    });
    const leaseLost = new Error("Universe-catalog lease lost");
    let signalChecks = 0;
    const signal = {
      throwIfAborted() {
        signalChecks += 1;
        if (signalChecks === 3) throw leaseLost;
      },
    } as AbortSignal;

    await assert.rejects(
      hydrateUniverseCatalogListingWithIbkr(
        {
          listingKey: "missing",
          writerFenceToken: "12",
        },
        { signal },
      ),
      (error) => error === leaseLost,
    );
    assert.equal(signalChecks, 3);
  });
});

test("persisted hydration errors reject opaque credentials", async () => {
  const platformModule = (await import("./platform")) as unknown as {
    __safeUniverseCatalogHydrationErrorForTests: (error: unknown) => string;
  };
  const sanitize = platformModule.__safeUniverseCatalogHydrationErrorForTests;
  assert.equal(typeof sanitize, "function");
  const credential = `sk-${"a".repeat(24)}`;

  const sanitized = sanitize(
    new Error(
      `provider rejected ${credential}; https://api.example.test/path?access_token=${credential}`,
    ),
  );
  assert.doesNotMatch(sanitized, new RegExp(credential, "u"));
  assert.equal(sanitized, "IBKR hydration failed.");
  assert.equal(
    sanitize(new Error("IBKR provider unavailable.")),
    "IBKR provider unavailable.",
  );
});

test("fenced hydration merges provider metadata into the latest catalog metadata", async () => {
  const platformModule = (await import("./platform")) as unknown as {
    __updateUniverseCatalogListingWithWriterFenceForTests: (input: {
      id: string;
      set: Record<string, unknown>;
      contractMetaPatch?: Record<string, unknown> | null;
      writerFenceToken: string;
      signal?: AbortSignal;
    }) => Promise<void>;
  };
  const update =
    platformModule.__updateUniverseCatalogListingWithWriterFenceForTests;
  assert.equal(typeof update, "function");

  await withTestDb(async ({ db }) => {
    await db.insert(universeCatalogSyncStatesTable).values({
      scopeKey: "catalog:writer",
      phase: "writer",
      market: "stocks",
      activeOnly: true,
      metadata: { leaseFenceToken: "13" },
    });
    await upsertUniverseCatalogRows([ticker], { writerFenceToken: "13" });
    const [row] = await db.select().from(universeCatalogListingsTable);
    assert.ok(row);

    const providerPatch = {
      secType: "STK",
      rootConid: "265598",
    };
    const concurrentOptionability = {
      optionabilityStatus: "verified",
      optionability: {
        status: "verified",
        source: "test",
        reason: "contract-resolved",
        verifiedAt: "2026-07-17T19:00:00.000Z",
      },
    };
    await db
      .update(universeCatalogListingsTable)
      .set({ contractMeta: concurrentOptionability })
      .where(eq(universeCatalogListingsTable.id, row.id));

    await update({
      id: row.id,
      set: { ibkrHydrationStatus: "hydrated" },
      contractMetaPatch: providerPatch,
      writerFenceToken: "13",
    });

    const [persisted] = await db
      .select()
      .from(universeCatalogListingsTable)
      .where(eq(universeCatalogListingsTable.id, row.id));
    assert.deepEqual(persisted?.contractMeta, {
      ...concurrentOptionability,
      ...providerPatch,
    });
  });
});

test("interactive ticker search cannot schedule durable catalog hydration", async () => {
  const source = await readFile(
    new URL("./platform.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("export async function searchUniverseTickers(");
  const end = source.indexOf("export async function getBarsWithDebug(", start);
  assert.ok(start >= 0 && end > start);

  assert.doesNotMatch(
    source.slice(start, end),
    /enqueueUniverseCatalogIbkrHydrationRows|hydrateUniverseCatalogListingWithIbkr/u,
  );
});

test("IBKR hydration rechecks lease loss after provider I/O and in its error path", async () => {
  const source = await readFile(
    new URL("./platform.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf(
    "export async function hydrateUniverseCatalogListingWithIbkr(",
  );
  const provider = source.indexOf(
    "const results = await getIbkrClient().searchTickers(",
    start,
  );
  const scored = source.indexOf("const bestCandidate =", provider);
  const afterProviderAbort = source.indexOf(
    "options.signal?.throwIfAborted();",
    provider,
  );
  const catchStart = source.indexOf("} catch (error) {", provider);
  const failedSet = source.indexOf("const failedSet =", catchStart);
  const catchAbort = source.indexOf(
    "options.signal?.throwIfAborted();",
    catchStart,
  );

  assert.ok(
    start >= 0 &&
      provider > start &&
      afterProviderAbort > provider &&
      afterProviderAbort < scored,
  );
  assert.ok(
    catchStart > scored && catchAbort > catchStart && catchAbort < failedSet,
  );
});

test("IBKR hydration commits only through the fenced transaction helper", async () => {
  const source = await readFile(
    new URL("./platform.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf(
    "export async function hydrateUniverseCatalogListingWithIbkr(",
  );
  const helper = source.indexOf(
    "async function updateUniverseCatalogListingWithWriterFence(",
    start,
  );
  const end = source.indexOf("function createClientAbortedError(", helper);
  assert.ok(start >= 0 && helper > start && end > helper);

  const hydrationBody = source.slice(start, helper);
  assert.equal(
    hydrationBody.match(/updateUniverseCatalogListingWithWriterFence\(\{/gu)
      ?.length,
    3,
  );
  assert.doesNotMatch(
    hydrationBody,
    /\bdb\s*\.\s*update\(universeCatalogListingsTable\)/u,
  );

  const helperBody = source.slice(helper, end);
  assert.match(helperBody, /db\.transaction\(async \(tx\)/u);
  assert.match(helperBody, /assertUniverseCatalogWriterFence\(\{/u);
  assert.match(helperBody, /input\.signal\?\.throwIfAborted\(\);/u);
  assert.match(
    helperBody,
    /await tx\s*\.update\(universeCatalogListingsTable\)/u,
  );
});
