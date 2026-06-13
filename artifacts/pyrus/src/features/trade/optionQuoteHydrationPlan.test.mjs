import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFallbackOptionQuoteRows,
  buildTradeOptionQuoteSubscriptionPlan,
  resolveFallbackOptionQuoteRowLimit,
} from "./optionQuoteHydrationPlan.js";

const makeChainRows = (count, { startStrike = 90, atmStrike = 100 } = {}) =>
  Array.from({ length: count }, (_, index) => {
    const strike = startStrike + index;
    return {
      k: strike,
      isAtm: strike === atmStrike,
      cContract: { providerContractId: `C${strike}` },
      pContract: { providerContractId: `P${strike}` },
    };
  });

test("option quote plan reserves the selected chain coverage when visible rows are unavailable", () => {
  const chainRows = makeChainRows(31);

  const plan = buildTradeOptionQuoteSubscriptionPlan({
    chainRows,
    contract: { strike: 100, cp: "C" },
    visibleRows: [],
    visibleStrikeCoverage: 2,
  });

  assert.deepEqual(plan.executionProviderContractIds, ["C100"]);
  assert.deepEqual(plan.visibleProviderContractIds, [
    "C98",
    "P98",
    "C99",
    "P99",
    "P100",
    "C101",
    "P101",
    "C102",
    "P102",
  ]);
  assert.equal(plan.requestedProviderContractIds.length, 10);
});

test("option quote plan can suppress fallback chain demand when streaming is not active", () => {
  const chainRows = makeChainRows(11);

  const plan = buildTradeOptionQuoteSubscriptionPlan({
    chainRows,
    contract: { strike: 100, cp: "P" },
    visibleRows: [],
    maxVisibleProviderContractIds: 8,
    includeFallbackVisibleRows: false,
  });

  assert.deepEqual(plan.executionProviderContractIds, ["P100"]);
  assert.deepEqual(plan.visibleProviderContractIds, []);
  assert.deepEqual(plan.requestedProviderContractIds, ["P100"]);
});

test("option quote fallback rows center on the selected strike before falling back to ATM", () => {
  const chainRows = makeChainRows(21);

  assert.deepEqual(
    buildFallbackOptionQuoteRows({
      chainRows,
      contract: { strike: 104 },
      maxVisibleProviderContractIds: 6,
    }).map((row) => row.k),
    [103, 104, 105],
  );

  assert.deepEqual(
    buildFallbackOptionQuoteRows({
      chainRows,
      contract: { strike: 999 },
      maxVisibleProviderContractIds: 6,
    }).map((row) => row.k),
    [99, 100, 101],
  );
});

test("option quote fallback rows use all loaded rows for all-strikes coverage", () => {
  const chainRows = makeChainRows(7);

  assert.equal(
    resolveFallbackOptionQuoteRowLimit({
      chainRows,
      visibleStrikeCoverage: "all",
      maxVisibleProviderContractIds: 2,
    }),
    7,
  );
  assert.deepEqual(
    buildFallbackOptionQuoteRows({
      chainRows,
      contract: { strike: 100 },
      visibleStrikeCoverage: "all",
      maxVisibleProviderContractIds: 2,
    }).map((row) => row.k),
    [90, 91, 92, 93, 94, 95, 96],
  );
});
