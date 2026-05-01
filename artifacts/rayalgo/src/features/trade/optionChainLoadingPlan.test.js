import assert from "node:assert/strict";
import test from "node:test";
import {
  OPTION_CHAIN_FAST_STRIKES_AROUND_MONEY,
  OPTION_CHAIN_METADATA_HYDRATION,
  getExpirationChainKey,
  resolveTradeOptionChainHydrationPlan,
  shouldHydrateActiveFullCoverage,
} from "./optionChainLoadingPlan.js";

const expiration = (isoDate) => ({
  value: isoDate.slice(5).replace("-", "/"),
  chainKey: isoDate,
  isoDate,
});

test("option chain hydration defaults to metadata with about ten base strikes", () => {
  assert.equal(OPTION_CHAIN_METADATA_HYDRATION, "metadata");
  assert.equal(OPTION_CHAIN_FAST_STRIKES_AROUND_MONEY, 5);
});

test("option chain hydration plan schedules progressive full metadata batches for all expirations", () => {
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
  assert.deepEqual(plan.batchExpirationOptions.map(getExpirationChainKey), [
    "2026-05-01",
    "2026-05-08",
    "2026-05-15",
    "2026-05-22",
  ]);
  assert.deepEqual(
    plan.batchExpirationChunks.map((chunk) => chunk.map(getExpirationChainKey)),
    [
      ["2026-05-01", "2026-05-08"],
      ["2026-05-15", "2026-05-22"],
    ],
  );
});

test("option chain hydration plan does not schedule full coverage until selected expiration expands", () => {
  const active = expiration("2026-05-01");
  const inactive = expiration("2026-05-08");

  assert.equal(
    resolveTradeOptionChainHydrationPlan({
      activeExpiration: active,
      orderedExpirationOptions: [active, inactive],
      expandedChainKeys: [inactive.chainKey],
    }).expandedActiveExpiration,
    null,
  );

  const expanded = resolveTradeOptionChainHydrationPlan({
    activeExpiration: active,
    orderedExpirationOptions: [active, inactive],
    expandedChainKeys: [active.chainKey],
  });

  assert.equal(
    getExpirationChainKey(expanded.expandedActiveExpiration),
    active.chainKey,
  );
  assert.equal(expanded.expandedActiveChainKey, active.chainKey);
});

test("option chain hydration plan disables background batches in background mode", () => {
  const active = expiration("2026-05-01");
  const inactive = expiration("2026-05-08");
  const plan = resolveTradeOptionChainHydrationPlan({
    activeExpiration: active,
    orderedExpirationOptions: [active, inactive],
    expandedChainKeys: [active.chainKey],
    background: true,
  });

  assert.deepEqual(plan.batchExpirationOptions, []);
  assert.deepEqual(plan.batchExpirationChunks, []);
  assert.equal(plan.expandedActiveExpiration, null);
});

test("option chain hydration plan can schedule selected full fallback after fast miss", () => {
  const active = expiration("2026-05-01");

  assert.equal(
    shouldHydrateActiveFullCoverage({
      activeExpiration: active,
      activeFastHydrationStatus: "empty",
    }),
    true,
  );
  assert.equal(
    shouldHydrateActiveFullCoverage({
      activeExpiration: active,
      activeFastHydrationStatus: "failed",
    }),
    true,
  );
  assert.equal(
    shouldHydrateActiveFullCoverage({
      activeExpiration: active,
      activeFastHydrationStatus: "loaded",
    }),
    false,
  );
});

test("option chain hydration plan keeps full fallback off in background mode", () => {
  const active = expiration("2026-05-01");

  assert.equal(
    shouldHydrateActiveFullCoverage({
      activeExpiration: active,
      activeFastHydrationStatus: "failed",
      background: true,
    }),
    false,
  );
});
