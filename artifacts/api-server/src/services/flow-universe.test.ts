import assert from "node:assert/strict";
import test from "node:test";
import {
  createFlowUniverseManager,
  getFlowScannerIntervalMs,
  isOptionableUniverseContractMeta,
  isRegularTradingHours,
  rankFlowUniverseCandidates,
} from "./flow-universe";

test("flow universe ranks previous-session and live options activity ahead of liquidity", () => {
  const selected = rankFlowUniverseCandidates({
    targetSize: 3,
    pinnedSymbols: ["qqq"],
    now: new Date("2026-04-28T14:30:00.000Z"),
    candidates: [
      {
        symbol: "SPY",
        market: "etf",
        price: 500,
        volume: 40_000_000,
        dollarVolume: 20_000_000_000,
        liquidityRank: 1,
        flowScore: 0,
        previousSessionFlowScore: 1,
        rankedAt: null,
        selected: false,
        selectedAt: null,
        lastScannedAt: null,
        cooldownUntil: null,
      },
      {
        symbol: "NVDA",
        market: "stocks",
        price: 900,
        volume: 20_000_000,
        dollarVolume: 18_000_000_000,
        liquidityRank: 2,
        flowScore: 8,
        previousSessionFlowScore: 0,
        rankedAt: null,
        selected: false,
        selectedAt: null,
        lastScannedAt: null,
        cooldownUntil: null,
      },
      {
        symbol: "AAPL",
        market: "stocks",
        price: 200,
        volume: 25_000_000,
        dollarVolume: 5_000_000_000,
        liquidityRank: 3,
        flowScore: 0,
        previousSessionFlowScore: 50,
        rankedAt: null,
        selected: false,
        selectedAt: null,
        lastScannedAt: null,
        cooldownUntil: null,
      },
    ],
  });

  assert.deepEqual(selected, ["QQQ", "NVDA", "AAPL"]);
});

test("flow universe skips symbols under cooldown", () => {
  const selected = rankFlowUniverseCandidates({
    targetSize: 2,
    now: new Date("2026-04-28T14:30:00.000Z"),
    candidates: [
      {
        symbol: "TSLA",
        market: "stocks",
        price: 200,
        volume: 10_000_000,
        dollarVolume: 2_000_000_000,
        liquidityRank: 1,
        flowScore: 100,
        previousSessionFlowScore: 100,
        rankedAt: null,
        selected: false,
        selectedAt: null,
        lastScannedAt: null,
        cooldownUntil: new Date("2026-04-28T14:45:00.000Z"),
      },
      {
        symbol: "MSFT",
        market: "stocks",
        price: 400,
        volume: 8_000_000,
        dollarVolume: 3_200_000_000,
        liquidityRank: 2,
        flowScore: 1,
        previousSessionFlowScore: 1,
        rankedAt: null,
        selected: false,
        selectedAt: null,
        lastScannedAt: null,
        cooldownUntil: null,
      },
    ],
  });

  assert.deepEqual(selected, ["MSFT"]);
});

test("flow universe backfills short ranked candidates from fallback symbols", () => {
  const selected = rankFlowUniverseCandidates({
    targetSize: 5,
    now: new Date("2026-05-01T14:30:00.000Z"),
    pinnedSymbols: ["SPY"],
    fallbackSymbols: ["AAPL", "NVDA", "MSFT", "META", "TSLA"],
    candidates: [
      {
        symbol: "NVDA",
        market: "stocks",
        price: 900,
        volume: 20_000_000,
        dollarVolume: 18_000_000_000,
        liquidityRank: 2,
        flowScore: 8,
        previousSessionFlowScore: 0,
        rankedAt: null,
        selected: false,
        selectedAt: null,
        lastScannedAt: null,
        cooldownUntil: null,
      },
      {
        symbol: "AAPL",
        market: "stocks",
        price: 200,
        volume: 25_000_000,
        dollarVolume: 5_000_000_000,
        liquidityRank: 3,
        flowScore: 0,
        previousSessionFlowScore: 2,
        rankedAt: null,
        selected: false,
        selectedAt: null,
        lastScannedAt: null,
        cooldownUntil: null,
      },
    ],
  });

  assert.deepEqual(selected, ["SPY", "NVDA", "AAPL", "MSFT", "META"]);
});

test("flow universe prefers fallback liquidity pool over unrated catalog filler", () => {
  const selected = rankFlowUniverseCandidates({
    targetSize: 4,
    minPrice: 5,
    minDollarVolume: 25_000_000,
    now: new Date("2026-05-01T14:30:00.000Z"),
    fallbackSymbols: ["AMD", "SPY"],
    candidates: [
      {
        symbol: "AAPD",
        market: "etf",
        price: null,
        volume: null,
        dollarVolume: 0,
        liquidityRank: 1,
        flowScore: 0,
        previousSessionFlowScore: 0,
        rankedAt: null,
        selected: true,
        selectedAt: null,
        lastScannedAt: null,
        cooldownUntil: null,
      },
      {
        symbol: "NVDA",
        market: "stocks",
        price: 900,
        volume: 20_000_000,
        dollarVolume: 18_000_000_000,
        liquidityRank: 2,
        flowScore: 1,
        previousSessionFlowScore: 0,
        rankedAt: null,
        selected: false,
        selectedAt: null,
        lastScannedAt: null,
        cooldownUntil: null,
      },
    ],
  });

  assert.deepEqual(selected, ["NVDA", "AMD", "SPY", "AAPD"]);
});

test("flow universe cooldowns are skipped during fallback fill", () => {
  const selected = rankFlowUniverseCandidates({
    targetSize: 3,
    now: new Date("2026-05-01T14:30:00.000Z"),
    fallbackSymbols: ["TSLA", "MSFT", "META"],
    candidates: [
      {
        symbol: "TSLA",
        market: "stocks",
        price: 200,
        volume: 10_000_000,
        dollarVolume: 2_000_000_000,
        liquidityRank: 1,
        flowScore: 100,
        previousSessionFlowScore: 100,
        rankedAt: null,
        selected: false,
        selectedAt: null,
        lastScannedAt: null,
        cooldownUntil: new Date("2026-05-01T14:45:00.000Z"),
      },
      {
        symbol: "AAPL",
        market: "stocks",
        price: 200,
        volume: 25_000_000,
        dollarVolume: 5_000_000_000,
        liquidityRank: 3,
        flowScore: 1,
        previousSessionFlowScore: 0,
        rankedAt: null,
        selected: false,
        selectedAt: null,
        lastScannedAt: null,
        cooldownUntil: null,
      },
    ],
  });

  assert.deepEqual(selected, ["AAPL", "MSFT", "META"]);
});

test("flow universe dedupes duplicate candidate symbols before selection", () => {
  const selected = rankFlowUniverseCandidates({
    targetSize: 3,
    now: new Date("2026-04-28T14:30:00.000Z"),
    candidates: [
      {
        symbol: "AAL",
        market: "stocks",
        price: 10,
        volume: 100,
        dollarVolume: 1_000,
        liquidityRank: 1,
        flowScore: 10,
        previousSessionFlowScore: 0,
        rankedAt: null,
        selected: false,
        selectedAt: null,
        lastScannedAt: null,
        cooldownUntil: null,
      },
      {
        symbol: "AAL",
        market: "stocks",
        price: 10,
        volume: 90,
        dollarVolume: 900,
        liquidityRank: 2,
        flowScore: 9,
        previousSessionFlowScore: 0,
        rankedAt: null,
        selected: false,
        selectedAt: null,
        lastScannedAt: null,
        cooldownUntil: null,
      },
      {
        symbol: "SPY",
        market: "etf",
        price: 500,
        volume: 1_000,
        dollarVolume: 500_000,
        liquidityRank: 3,
        flowScore: 1,
        previousSessionFlowScore: 0,
        rankedAt: null,
        selected: false,
        selectedAt: null,
        lastScannedAt: null,
        cooldownUntil: null,
      },
    ],
  });

  assert.deepEqual(selected, ["AAL", "SPY"]);
});

test("flow scanner interval slows outside regular market hours", () => {
  assert.equal(
    isRegularTradingHours(new Date("2026-04-28T14:30:00.000Z")),
    true,
  );
  assert.equal(
    isRegularTradingHours(new Date("2026-04-28T22:30:00.000Z")),
    false,
  );
  assert.equal(
    getFlowScannerIntervalMs({
      baseIntervalMs: 15_000,
      alwaysOn: true,
      now: new Date("2026-04-28T22:30:00.000Z"),
    }),
    60_000,
  );
});

test("flow universe optionability gate recognizes IBKR derivative metadata", () => {
  assert.equal(
    isOptionableUniverseContractMeta({ derivativeSecTypes: "OPT" }),
    true,
  );
  assert.equal(
    isOptionableUniverseContractMeta({ derivativeSecTypes: "FUT,OPT" }),
    true,
  );
  assert.equal(
    isOptionableUniverseContractMeta({ derivativeSecTypes: ["STK", "OPT"] }),
    true,
  );
  assert.equal(
    isOptionableUniverseContractMeta({ derivativeSecTypes: "WAR" }),
    false,
  );
  assert.equal(isOptionableUniverseContractMeta(null), false);
});

function transientDbError() {
  return Object.assign(new Error("Connection terminated due to connection timeout"), {
    code: "ECONNRESET",
  });
}

function chainReturning<T>(value: T) {
  return {
    from() {
      return {
        leftJoin() {
          return {
            where() {
              return {
                orderBy() {
                  return {
                    limit: async () => value,
                  };
                },
              };
            },
          };
        },
        where() {
          return {
            orderBy() {
              return {
                limit: async () => value,
              };
            },
          };
        },
      };
    },
  };
}

function createFlowUniverseTestDb(input: {
  rows?: unknown[];
  selectError?: unknown;
  persistError?: unknown;
}) {
  return {
    select() {
      if (input.selectError) {
        return chainReturning(Promise.reject(input.selectError));
      }
      return chainReturning(input.rows ?? []);
    },
    update() {
      return {
        set() {
          return {
            where: async () => {
              if (input.persistError) {
                throw input.persistError;
              }
            },
          };
        },
      };
    },
    insert() {
      return {
        values() {
          return {
            onConflictDoUpdate: async () => {
              if (input.persistError) {
                throw input.persistError;
              }
            },
          };
        },
      };
    },
  } as never;
}

test("flow universe uses provider fallback when Helium-backed catalog reads fail", async () => {
  const manager = createFlowUniverseManager({
    db: createFlowUniverseTestDb({ selectError: transientDbError() }),
    mode: "market",
    targetSize: 4,
    refreshMs: 60_000,
    markets: ["stocks"],
    minPrice: 5,
    minDollarVolume: 25_000_000,
    fallbackSymbols: ["SPY"],
    fetchFallbackSymbols: async () => ["AAPL", "NVDA", "MSFT", "TSLA"],
    now: () => new Date("2026-05-08T15:30:00.000Z"),
  });

  const selected = await manager.refresh();
  const coverage = manager.getCoverage();

  assert.deepEqual(selected, ["AAPL", "NVDA", "MSFT", "TSLA"]);
  assert.equal(coverage.selectedShortfall, 0);
  assert.equal(coverage.fallbackUsed, true);
  assert.match(coverage.degradedReason || "", /database unavailable/i);
});

test("flow universe keeps selected symbols when DB selection persistence fails", async () => {
  const manager = createFlowUniverseManager({
    db: createFlowUniverseTestDb({
      persistError: transientDbError(),
      rows: [
        {
          symbol: "AAPL",
          market: "stocks",
          price: "200",
          volume: "1000000",
          dollarVolume: "200000000",
          liquidityRank: 1,
          flowScore: "10",
          previousSessionFlowScore: "0",
          rankedAt: null,
          selected: false,
          selectedAt: null,
          lastScannedAt: null,
          cooldownUntil: null,
        },
        {
          symbol: "NVDA",
          market: "stocks",
          price: "900",
          volume: "1000000",
          dollarVolume: "900000000",
          liquidityRank: 2,
          flowScore: "8",
          previousSessionFlowScore: "0",
          rankedAt: null,
          selected: false,
          selectedAt: null,
          lastScannedAt: null,
          cooldownUntil: null,
        },
      ],
    }),
    mode: "market",
    targetSize: 2,
    refreshMs: 60_000,
    markets: ["stocks"],
    minPrice: 5,
    minDollarVolume: 25_000_000,
    fallbackSymbols: ["SPY"],
    now: () => new Date("2026-05-08T15:30:00.000Z"),
  });

  const selected = await manager.refresh();
  const coverage = manager.getCoverage();

  assert.deepEqual(selected, ["AAPL", "NVDA"]);
  assert.equal(coverage.selectedShortfall, 0);
  assert.match(coverage.degradedReason || "", /persistence unavailable/i);
});

test("flow universe coverage reports current-cycle scan timestamps", async () => {
  let current = new Date("2026-05-08T15:05:00.000Z");
  const manager = createFlowUniverseManager({
    db: createFlowUniverseTestDb({}),
    mode: "watchlist",
    targetSize: 3,
    refreshMs: 60_000,
    markets: ["stocks"],
    minPrice: 5,
    minDollarVolume: 25_000_000,
    fallbackSymbols: ["SPY", "QQQ", "AAPL"],
    now: () => current,
  });

  await manager.recordObservation({
    symbol: "SPY",
    scannedAt: new Date("2026-05-08T15:00:00.000Z"),
  });
  await manager.recordObservation({
    symbol: "QQQ",
    scannedAt: new Date("2026-05-08T15:04:00.000Z"),
  });

  const fullWindow = manager.getCoverage({ scanWindowMs: 10 * 60_000 });
  assert.equal(fullWindow.scannedSymbols, 2);
  assert.deepEqual(fullWindow.lastScannedAt, {
    QQQ: Date.parse("2026-05-08T15:04:00.000Z"),
    SPY: Date.parse("2026-05-08T15:00:00.000Z"),
  });
  assert.equal(fullWindow.oldestScanAt, Date.parse("2026-05-08T15:00:00.000Z"));
  assert.equal(fullWindow.newestScanAt, Date.parse("2026-05-08T15:04:00.000Z"));

  current = new Date("2026-05-08T15:07:00.000Z");
  const narrowWindow = manager.getCoverage({ scanWindowMs: 2 * 60_000 });
  assert.equal(narrowWindow.scannedSymbols, 0);
  assert.deepEqual(narrowWindow.lastScannedAt, {});
  assert.equal(narrowWindow.oldestScanAt, null);
  assert.equal(narrowWindow.newestScanAt, null);
});
