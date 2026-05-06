import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_OPTION_CHAIN_COVERAGE,
  OPTION_CHAIN_COVERAGE_ALL,
  OPTION_CHAIN_FAST_STRIKES_AROUND_MONEY,
  OPTION_CHAIN_FULL_STRIKE_COVERAGE,
  OPTION_CHAIN_METADATA_HYDRATION,
  getExpirationChainKey,
  normalizeTradeOptionChainCoverage,
  resolveActiveOptionChainRequestParams,
  resolveBackgroundOptionChainRequestParams,
  resolveTradeOptionChainHydrationPlan,
} from "./optionChainLoadingPlan.js";

const expiration = (isoDate) => ({
  value: isoDate.slice(5).replace("-", "/"),
  chainKey: isoDate,
  isoDate,
});

test("option chain hydration defaults to metadata with about ten base strikes", () => {
  assert.equal(OPTION_CHAIN_METADATA_HYDRATION, "metadata");
  assert.equal(OPTION_CHAIN_FAST_STRIKES_AROUND_MONEY, 5);
  assert.equal(DEFAULT_OPTION_CHAIN_COVERAGE, 5);
});

test("option chain coverage normalizes to supported dropdown values", () => {
  assert.equal(normalizeTradeOptionChainCoverage(undefined), 5);
  assert.equal(normalizeTradeOptionChainCoverage("10"), 10);
  assert.equal(normalizeTradeOptionChainCoverage(15), 15);
  assert.equal(normalizeTradeOptionChainCoverage("all"), OPTION_CHAIN_COVERAGE_ALL);
  assert.equal(normalizeTradeOptionChainCoverage(12), 5);
});

test("option chain coverage maps selected expiration to window or full requests", () => {
  assert.deepEqual(resolveActiveOptionChainRequestParams(10), {
    strikesAroundMoney: 10,
    strikeCoverage: null,
    coverage: "window",
  });
  assert.deepEqual(resolveActiveOptionChainRequestParams("all"), {
    strikesAroundMoney: undefined,
    strikeCoverage: OPTION_CHAIN_FULL_STRIKE_COVERAGE,
    coverage: "full",
  });
});

test("option chain coverage keeps background reduced while selected expiration is all", () => {
  assert.deepEqual(resolveBackgroundOptionChainRequestParams("all"), {
    strikesAroundMoney: 5,
    strikeCoverage: null,
    coverage: "window",
  });
  assert.deepEqual(resolveBackgroundOptionChainRequestParams(20), {
    strikesAroundMoney: 20,
    strikeCoverage: null,
    coverage: "window",
  });
});

test("option chain hydration plan schedules reduced background batches excluding active expiration", () => {
  const active = expiration("2026-05-01");
  const plan = resolveTradeOptionChainHydrationPlan({
    activeExpiration: active,
    orderedExpirationOptions: [
      active,
      expiration("2026-05-08"),
      expiration("2026-05-15"),
      expiration("2026-05-22"),
    ],
  });

  assert.equal(plan.activeChainKey, "2026-05-01");
  assert.deepEqual(plan.activeRequest, {
    strikesAroundMoney: 5,
    strikeCoverage: null,
    coverage: "window",
  });
  assert.deepEqual(plan.batchExpirationOptions.map(getExpirationChainKey), [
    "2026-05-08",
    "2026-05-15",
    "2026-05-22",
  ]);
  assert.deepEqual(
    plan.batchExpirationChunks.map((chunk) => chunk.map(getExpirationChainKey)),
    [
      ["2026-05-08", "2026-05-15"],
      ["2026-05-22"],
    ],
  );
});

test("option chain hydration plan only full-hydrates the selected expiration when all is selected", () => {
  const active = expiration("2026-05-01");
  const inactive = expiration("2026-05-08");
  const plan = resolveTradeOptionChainHydrationPlan({
    activeExpiration: active,
    orderedExpirationOptions: [active, inactive],
    coverage: "all",
  });

  assert.deepEqual(plan.activeRequest, {
    strikesAroundMoney: undefined,
    strikeCoverage: OPTION_CHAIN_FULL_STRIKE_COVERAGE,
    coverage: "full",
  });
  assert.deepEqual(plan.backgroundRequest, {
    strikesAroundMoney: 5,
    strikeCoverage: null,
    coverage: "window",
  });
  assert.deepEqual(plan.batchExpirationOptions.map(getExpirationChainKey), [
    inactive.chainKey,
  ]);
});

test("option chain hydration plan disables background batches in background mode", () => {
  const active = expiration("2026-05-01");
  const inactive = expiration("2026-05-08");
  const plan = resolveTradeOptionChainHydrationPlan({
    activeExpiration: active,
    orderedExpirationOptions: [active, inactive],
    background: true,
  });

  assert.deepEqual(plan.batchExpirationOptions, []);
  assert.deepEqual(plan.batchExpirationChunks, []);
});
