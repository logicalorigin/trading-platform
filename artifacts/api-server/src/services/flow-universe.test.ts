import assert from "node:assert/strict";
import test from "node:test";
import {
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
