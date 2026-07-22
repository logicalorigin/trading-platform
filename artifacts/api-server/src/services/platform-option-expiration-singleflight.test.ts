import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { createTestDb, type TestDatabase } from "@workspace/db/testing";

import { __resetProviderRuntimeConfigCacheForTests } from "../lib/runtime";
import { HttpError } from "../lib/errors";
import type { OptionChainContract } from "../providers/ibkr/client";
import {
  __resetDurableOptionMetadataStoreForTests,
  __resetOptionMetadataInstrumentCacheForTests,
  getDurableOptionMetadataDiagnostics,
  persistDurableOptionChain,
} from "./option-metadata-store";
import {
  __platformOptionBackoffTestInternals as optionBackoff,
  __resetOptionChainCachesForTests,
  __setMassiveMarketDataClientFactoryForTests,
  getOptionExpirationCacheDiagnostics,
  getOptionExpirationsWithDebug,
  getPlatformResourceDiagnostics,
} from "./platform";
import { __resetApiResourcePressureForTests } from "./resource-pressure";

let testDb: TestDatabase;

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
  __resetOptionChainCachesForTests({ resetFlowScanner: false });
  await testDb.client.exec(
    "truncate table option_chain_latest, option_contracts, instruments restart identity cascade",
  );
});

test("the lightweight expiration census matches platform diagnostics", () => {
  assert.deepEqual(
    getOptionExpirationCacheDiagnostics(),
    getPlatformResourceDiagnostics().optionExpirations,
  );
});

function optionContract(input: {
  ticker: string;
  expirationDate: Date;
}): OptionChainContract {
  const updatedAt = new Date();
  return {
    contract: {
      ticker: input.ticker,
      underlying: "SPY",
      expirationDate: input.expirationDate,
      strike: 600,
      right: "call",
      multiplier: 100,
      sharesPerContract: 100,
      providerContractId: input.ticker,
    },
    bid: 1.2,
    ask: 1.3,
    last: 1.25,
    mark: 1.25,
    impliedVolatility: 0.24,
    delta: 0.42,
    gamma: 0.03,
    theta: -0.02,
    vega: 0.11,
    openInterest: 1_200,
    volume: 340,
    updatedAt,
    quoteUpdatedAt: updatedAt,
    dataUpdatedAt: updatedAt,
  };
}

async function seedDurableExpirations(): Promise<Date[]> {
  const expirations = [
    new Date("2099-07-17T00:00:00.000Z"),
    new Date("2099-07-24T00:00:00.000Z"),
  ];
  await persistDurableOptionChain({
    contracts: expirations.map((expirationDate, index) =>
      optionContract({
        ticker: `O:SPY9907${17 + index * 7}C00600000`,
        expirationDate,
      }),
    ),
    source: "massive",
    asOf: new Date(),
  });
  __resetOptionChainCachesForTests({ resetFlowScanner: false });
  return expirations;
}

test("concurrent cold expiration requests share one durable metadata read", async () => {
  const expirations = await seedDurableExpirations();

  const freshHitsBefore = getDurableOptionMetadataDiagnostics().freshHit;
  const [first, second] = await Promise.all([
    getOptionExpirationsWithDebug({
      underlying: " spy ",
      maxExpirations: 2,
      foregroundWaitMs: null,
    }),
    getOptionExpirationsWithDebug({
      underlying: "SPY",
      maxExpirations: 2,
      foregroundWaitMs: null,
    }),
  ]);

  assert.deepEqual(
    first.expirations.map(({ expirationDate }) => expirationDate),
    expirations,
  );
  assert.deepEqual(second.expirations, first.expirations);
  assert.equal(
    getDurableOptionMetadataDiagnostics().freshHit - freshHitsBefore,
    1,
  );
});

test("aborting one expiration waiter leaves the shared durable read alive", async () => {
  const expirations = await seedDurableExpirations();
  const controller = new AbortController();
  const aborted = getOptionExpirationsWithDebug({
    underlying: "SPY",
    maxExpirations: 2,
    foregroundWaitMs: null,
    signal: controller.signal,
  });
  const live = getOptionExpirationsWithDebug({
    underlying: " spy ",
    maxExpirations: 2,
    foregroundWaitMs: null,
  });

  controller.abort(new Error("caller cancelled"));

  await assert.rejects(aborted, /caller cancelled/);
  const result = await live;
  assert.deepEqual(
    result.expirations.map(({ expirationDate }) => expirationDate),
    expirations,
  );
});

test("aborting the creator leaves a shared Massive expiration refresh alive", async () => {
  const previousMassiveApiKey = process.env["MASSIVE_API_KEY"];
  const expirationDate = new Date("2099-08-21T00:00:00.000Z");
  const controller = new AbortController();
  const cancellation = new Error("creator cancelled");
  let providerCalls = 0;
  let providerSignal: AbortSignal | undefined;
  let resolveProviderStarted!: () => void;
  let releaseProvider!: () => void;
  const providerStarted = new Promise<void>((resolve) => {
    resolveProviderStarted = resolve;
  });
  const providerGate = new Promise<void>((resolve) => {
    releaseProvider = resolve;
  });

  process.env["MASSIVE_API_KEY"] = "expiration-singleflight-test-key";
  __resetProviderRuntimeConfigCacheForTests();
  __setMassiveMarketDataClientFactoryForTests(
    () =>
      ({
        async getHistoricalOptionContracts(input: { signal?: AbortSignal }) {
          providerCalls += 1;
          providerSignal = input.signal;
          resolveProviderStarted();
          await new Promise<void>((resolve, reject) => {
            const abort = () => reject(input.signal?.reason);
            input.signal?.addEventListener("abort", abort, { once: true });
            providerGate.then(() => {
              input.signal?.removeEventListener("abort", abort);
              resolve();
            }, reject);
          });
          return [{ expirationDate }];
        },
      }) as never,
  );

  try {
    const creator = getOptionExpirationsWithDebug({
      underlying: "SPY",
      maxExpirations: 1,
      foregroundWaitMs: null,
      signal: controller.signal,
    });
    await providerStarted;

    const durableMissesBefore = getDurableOptionMetadataDiagnostics().miss;
    const liveOutcome = getOptionExpirationsWithDebug({
      underlying: " spy ",
      maxExpirations: 1,
      foregroundWaitMs: null,
    }).then(
      (value) => ({ value, error: null }),
      (error: unknown) => ({ value: null, error }),
    );

    while (getDurableOptionMetadataDiagnostics().miss === durableMissesBefore) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort(cancellation);

    await assert.rejects(creator, (error) => error === cancellation);
    assert.notEqual(providerSignal, controller.signal);
    assert.equal(providerSignal?.aborted ?? false, false);
    releaseProvider();

    const live = await liveOutcome;
    assert.equal(live.error, null);
    assert.deepEqual(
      live.value?.expirations.map((expiration) => expiration.expirationDate),
      [expirationDate],
    );
    assert.equal(providerCalls, 1);
  } finally {
    releaseProvider();
    __setMassiveMarketDataClientFactoryForTests(null);
    if (previousMassiveApiKey === undefined) {
      delete process.env["MASSIVE_API_KEY"];
    } else {
      process.env["MASSIVE_API_KEY"] = previousMassiveApiKey;
    }
    __resetProviderRuntimeConfigCacheForTests();
    __resetOptionChainCachesForTests({ resetFlowScanner: false });
  }
});

test("the 500-symbol expiration rotation survives identical passes and verifier churn", async () => {
  const previousMassiveApiKey = process.env["MASSIVE_API_KEY"];
  const expirationDate = new Date("2099-08-21T00:00:00.000Z");
  const symbols = Array.from(
    { length: 500 },
    (_, index) => `ROT${index.toString().padStart(3, "0")}`,
  );
  const firstVerifierWave = Array.from(
    { length: 160 },
    (_, index) => `VFA${index.toString().padStart(3, "0")}`,
  );
  const secondVerifierWave = Array.from(
    { length: 160 },
    (_, index) => `VFB${index.toString().padStart(3, "0")}`,
  );
  let providerCalls = 0;

  process.env["MASSIVE_API_KEY"] = "expiration-rotation-test-key";
  __resetProviderRuntimeConfigCacheForTests();
  __setMassiveMarketDataClientFactoryForTests(
    () =>
      ({
        async getHistoricalOptionContracts() {
          providerCalls += 1;
          return [{ expirationDate }];
        },
      }) as never,
  );

  try {
    for (const underlying of symbols) {
      await getOptionExpirationsWithDebug({
        underlying,
        foregroundWaitMs: null,
      });
    }
    const providerCallsAfterFirstPass = providerCalls;
    const firstPassDiagnostics =
      getPlatformResourceDiagnostics().optionExpirations;

    for (const underlying of firstVerifierWave) {
      await getOptionExpirationsWithDebug({
        underlying,
        maxExpirations: 1,
        foregroundWaitMs: null,
      });
    }
    const durableReadsBeforeSecondPass =
      getDurableOptionMetadataDiagnostics().miss;
    const providerCallsBeforeSecondPass = providerCalls;
    for (const underlying of symbols) {
      await getOptionExpirationsWithDebug({
        underlying,
        foregroundWaitMs: null,
      });
    }
    const secondPassDiagnostics =
      getPlatformResourceDiagnostics().optionExpirations;

    assert.equal(providerCallsAfterFirstPass, symbols.length);
    assert.equal(providerCalls - providerCallsBeforeSecondPass, 0);
    assert.equal(
      getDurableOptionMetadataDiagnostics().miss - durableReadsBeforeSecondPass,
      0,
    );
    assert.equal(firstPassDiagnostics.entries, symbols.length);
    assert.equal(firstPassDiagnostics.capacityEvictions, 0);
    assert.equal(secondPassDiagnostics.entries, 660);
    assert.equal(secondPassDiagnostics.capacityEvictions, 0);

    for (const underlying of secondVerifierWave) {
      await getOptionExpirationsWithDebug({
        underlying,
        maxExpirations: 1,
        foregroundWaitMs: null,
      });
    }
    const overflowDiagnostics =
      getPlatformResourceDiagnostics().optionExpirations;
    const durableReadsBeforeThirdPass =
      getDurableOptionMetadataDiagnostics().miss;
    const providerCallsBeforeThirdPass = providerCalls;

    for (const underlying of symbols) {
      await getOptionExpirationsWithDebug({
        underlying,
        foregroundWaitMs: null,
      });
    }
    assert.equal(providerCalls - providerCallsBeforeThirdPass, 0);
    assert.equal(
      getDurableOptionMetadataDiagnostics().miss - durableReadsBeforeThirdPass,
      0,
    );

    assert.equal(
      overflowDiagnostics.maxEntries,
      1_128,
      "the default retains both recurring key shapes for the configured 500-symbol owner plus foreground headroom",
    );
    assert.equal(overflowDiagnostics.entries, 820);
    assert.equal(overflowDiagnostics.capacityEvictions, 0);

    const overflowFillCount =
      overflowDiagnostics.maxEntries - overflowDiagnostics.entries + 1;
    for (let index = 0; index < overflowFillCount; index += 1) {
      await getOptionExpirationsWithDebug({
        underlying: `OVF${index.toString().padStart(3, "0")}`,
        maxExpirations: 1,
        foregroundWaitMs: null,
      });
    }
    const capacityDiagnostics =
      getPlatformResourceDiagnostics().optionExpirations;
    const providerCallsBeforeEvictionProbes = providerCalls;

    await getOptionExpirationsWithDebug({
      underlying: firstVerifierWave[0]!,
      maxExpirations: 1,
      foregroundWaitMs: null,
    });
    await getOptionExpirationsWithDebug({
      underlying: secondVerifierWave.at(-1)!,
      maxExpirations: 1,
      foregroundWaitMs: null,
    });
    const probedDiagnostics =
      getPlatformResourceDiagnostics().optionExpirations;

    assert.equal(capacityDiagnostics.entries, capacityDiagnostics.maxEntries);
    assert.equal(capacityDiagnostics.capacityEvictions, 1);
    assert.equal(providerCalls - providerCallsBeforeEvictionProbes, 1);
    assert.equal(probedDiagnostics.entries, probedDiagnostics.maxEntries);
    assert.equal(probedDiagnostics.capacityEvictions, 2);
  } finally {
    __setMassiveMarketDataClientFactoryForTests(null);
    if (previousMassiveApiKey === undefined) {
      delete process.env["MASSIVE_API_KEY"];
    } else {
      process.env["MASSIVE_API_KEY"] = previousMassiveApiKey;
    }
    __resetProviderRuntimeConfigCacheForTests();
    __resetOptionChainCachesForTests({ resetFlowScanner: false });
  }
});

test("expiration diagnostics distinguish stale-TTL eviction from capacity eviction", async (t) => {
  const previousMassiveApiKey = process.env["MASSIVE_API_KEY"];
  const expirationDate = new Date("2099-08-21T00:00:00.000Z");
  let now = Date.now();
  t.mock.method(Date, "now", () => now);

  process.env["MASSIVE_API_KEY"] = "expiration-ttl-test-key";
  __resetProviderRuntimeConfigCacheForTests();
  __setMassiveMarketDataClientFactoryForTests(
    () =>
      ({
        async getHistoricalOptionContracts() {
          return [{ expirationDate }];
        },
      }) as never,
  );

  try {
    await getOptionExpirationsWithDebug({
      underlying: "TTL0",
      foregroundWaitMs: null,
    });
    now += 24 * 60 * 60_000 + 1;
    await getOptionExpirationsWithDebug({
      underlying: "TTL1",
      foregroundWaitMs: null,
    });

    const diagnostics = getPlatformResourceDiagnostics().optionExpirations;
    assert.equal(diagnostics.entries, 1);
    assert.equal(diagnostics.capacityEvictions, 0);
    assert.equal(diagnostics.staleTtlEvictions, 1);
  } finally {
    __setMassiveMarketDataClientFactoryForTests(null);
    if (previousMassiveApiKey === undefined) {
      delete process.env["MASSIVE_API_KEY"];
    } else {
      process.env["MASSIVE_API_KEY"] = previousMassiveApiKey;
    }
    __resetProviderRuntimeConfigCacheForTests();
    __resetOptionChainCachesForTests({ resetFlowScanner: false });
  }
});

test("a stale expiration served during upstream backoff becomes most recently used", async (t) => {
  const previousMassiveApiKey = process.env["MASSIVE_API_KEY"];
  const expirationDate = new Date("2099-08-21T00:00:00.000Z");
  let now = Date.now();
  t.mock.method(Date, "now", () => now);

  process.env["MASSIVE_API_KEY"] = "expiration-stale-lru-test-key";
  __resetProviderRuntimeConfigCacheForTests();
  __setMassiveMarketDataClientFactoryForTests(
    () =>
      ({
        async getHistoricalOptionContracts() {
          return [{ expirationDate }];
        },
      }) as never,
  );

  try {
    await getOptionExpirationsWithDebug({
      underlying: "LRU0",
      foregroundWaitMs: null,
    });
    await getOptionExpirationsWithDebug({
      underlying: "LRU1",
      foregroundWaitMs: null,
    });
    const before = optionBackoff.getOptionExpirationCacheOrderForTests();
    const firstKey = before.find((key) => key.includes('"LRU0"'));
    assert.ok(firstKey);

    now += 24 * 60 * 60_000 + 1;
    optionBackoff.recordOptionUpstreamBackoff(
      "expiration",
      firstKey,
      new HttpError(503, "upstream unavailable", {
        code: "upstream_http_error",
      }),
    );

    const fallback = await getOptionExpirationsWithDebug({
      underlying: "LRU0",
      foregroundWaitMs: null,
    });

    assert.equal(fallback.debug?.cacheStatus, "hit");
    assert.equal(fallback.debug?.stale, true);
    assert.deepEqual(optionBackoff.getOptionExpirationCacheOrderForTests(), [
      before[1],
      before[0],
    ]);
  } finally {
    __setMassiveMarketDataClientFactoryForTests(null);
    if (previousMassiveApiKey === undefined) {
      delete process.env["MASSIVE_API_KEY"];
    } else {
      process.env["MASSIVE_API_KEY"] = previousMassiveApiKey;
    }
    __resetProviderRuntimeConfigCacheForTests();
    __resetOptionChainCachesForTests({ resetFlowScanner: false });
  }
});

test("a transient refresh failure returns a newer resident expiration entry instead of a captured stale snapshot", async (t) => {
  const previousMassiveApiKey = process.env["MASSIVE_API_KEY"];
  const capturedExpiration = new Date("2099-08-21T00:00:00.000Z");
  const replacementExpiration = new Date("2099-08-28T00:00:00.000Z");
  let now = Date.now();
  let providerCalls = 0;
  let resolveRefreshStarted!: () => void;
  let releaseRefresh!: () => void;
  const refreshStarted = new Promise<void>((resolve) => {
    resolveRefreshStarted = resolve;
  });
  const refreshGate = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  t.mock.method(Date, "now", () => now);

  process.env["MASSIVE_API_KEY"] = "expiration-replacement-race-test-key";
  __resetProviderRuntimeConfigCacheForTests();
  __setMassiveMarketDataClientFactoryForTests(
    () =>
      ({
        async getHistoricalOptionContracts() {
          providerCalls += 1;
          if (providerCalls === 1) {
            return [{ expirationDate: capturedExpiration }];
          }
          resolveRefreshStarted();
          await refreshGate;
          throw new HttpError(503, "upstream unavailable", {
            code: "upstream_http_error",
          });
        },
      }) as never,
  );

  try {
    await getOptionExpirationsWithDebug({
      underlying: "RACE",
      maxExpirations: 2,
      foregroundWaitMs: null,
    });
    const key = optionBackoff
      .getOptionExpirationCacheOrderForTests()
      .find((candidate) => candidate.includes('"RACE"'));
    assert.ok(key);

    now += 24 * 60 * 60_000 + 1;
    const request = getOptionExpirationsWithDebug({
      underlying: "RACE",
      maxExpirations: 2,
      foregroundWaitMs: null,
    });
    await refreshStarted;
    optionBackoff.seedOptionExpirationCacheForTests({
      key,
      expirations: [replacementExpiration],
      cachedAt: now,
    });
    releaseRefresh();

    const fallback = await request;
    assert.deepEqual(
      fallback.expirations.map(({ expirationDate }) => expirationDate),
      [replacementExpiration],
    );
    assert.equal(fallback.debug?.cacheStatus, "hit");
    assert.equal(fallback.debug?.stale, true);
  } finally {
    releaseRefresh();
    __setMassiveMarketDataClientFactoryForTests(null);
    if (previousMassiveApiKey === undefined) {
      delete process.env["MASSIVE_API_KEY"];
    } else {
      process.env["MASSIVE_API_KEY"] = previousMassiveApiKey;
    }
    __resetProviderRuntimeConfigCacheForTests();
    __resetOptionChainCachesForTests({ resetFlowScanner: false });
  }
});
