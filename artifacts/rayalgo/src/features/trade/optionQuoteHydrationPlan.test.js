import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTIVE_OPTION_QUOTE_LINE_BUDGET,
  BACKGROUND_OPTION_QUOTE_LINE_BUDGET,
  buildTradeOptionProviderContractIdPlan,
  resolveOptionQuoteLineBudget,
  selectRotatingProviderContractIds,
} from "./optionQuoteHydrationPlan.js";

const row = (strike) => ({
  k: strike,
  isAtm: strike === 100,
  cContract: { providerContractId: `C${strike}` },
  pContract: { providerContractId: `P${strike}` },
});

test("buildTradeOptionProviderContractIdPlan includes the full selected expiration in priority order", () => {
  const providerContractIds = buildTradeOptionProviderContractIdPlan({
    chainRows: [row(95), row(100), row(105), row(110)],
    contract: { strike: 105, cp: "P" },
    heldContracts: [{ providerContractId: "C95" }],
  });

  assert.deepEqual(providerContractIds, [
    "P105",
    "C95",
    "C105",
    "C100",
    "P100",
    "C110",
    "P110",
    "P95",
  ]);
});

test("buildTradeOptionProviderContractIdPlan prioritizes visible rows before tail rotation", () => {
  const providerContractIds = buildTradeOptionProviderContractIdPlan({
    chainRows: [row(90), row(95), row(100), row(105), row(110)],
    visibleRows: [row(110), row(90)],
    contract: { strike: 100, cp: "C" },
    heldContracts: [],
  });

  assert.deepEqual(providerContractIds.slice(0, 5), [
    "C100",
    "C110",
    "P110",
    "C90",
    "P90",
  ]);
});

test("resolveOptionQuoteLineBudget reserves more lines for active trade pages", () => {
  assert.equal(
    resolveOptionQuoteLineBudget({ active: true }),
    ACTIVE_OPTION_QUOTE_LINE_BUDGET,
  );
  assert.equal(
    resolveOptionQuoteLineBudget({ active: false }),
    BACKGROUND_OPTION_QUOTE_LINE_BUDGET,
  );
  assert.equal(
    resolveOptionQuoteLineBudget({ active: true, configuredLimit: 80 }),
    80,
  );
});

test("selectRotatingProviderContractIds pins priority ids and rotates the rest within budget", () => {
  const providerContractIds = Array.from({ length: 10 }, (_, index) => `id-${index}`);

  const first = selectRotatingProviderContractIds({
    providerContractIds,
    lineBudget: 4,
    rotationIndex: 0,
  });
  const second = selectRotatingProviderContractIds({
    providerContractIds,
    lineBudget: 4,
    rotationIndex: 1,
  });

  assert.deepEqual(first.pinnedProviderContractIds, ["id-0", "id-1"]);
  assert.deepEqual(first.activeProviderContractIds, [
    "id-0",
    "id-1",
    "id-2",
    "id-3",
  ]);
  assert.deepEqual(second.activeProviderContractIds, [
    "id-0",
    "id-1",
    "id-4",
    "id-5",
  ]);
  assert.equal(first.pendingProviderContractIds.length, 6);
  assert.equal(second.pendingProviderContractIds.length, 6);
});

test("selectRotatingProviderContractIds can disable background quote lines", () => {
  const providerContractIds = ["id-0", "id-1"];
  const plan = selectRotatingProviderContractIds({
    providerContractIds,
    lineBudget: 0,
  });

  assert.deepEqual(plan.activeProviderContractIds, []);
  assert.deepEqual(plan.pendingProviderContractIds, providerContractIds);
});
