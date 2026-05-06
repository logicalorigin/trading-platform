import assert from "node:assert/strict";
import test from "node:test";
import {
  TRADE_OPTION_VISIBLE_QUOTE_CONTRACT_LIMIT,
  buildTradeOptionProviderContractIdPlan,
  buildTradeOptionQuoteSubscriptionPlan,
} from "./optionQuoteHydrationPlan.js";

const row = (strike) => ({
  k: strike,
  isAtm: strike === 100,
  cContract: { providerContractId: `C${strike}` },
  pContract: { providerContractId: `P${strike}` },
});

test("buildTradeOptionProviderContractIdPlan includes selected, held, and visible row contracts only", () => {
  const providerContractIds = buildTradeOptionProviderContractIdPlan({
    chainRows: [row(95), row(100), row(105), row(110)],
    contract: { strike: 105, cp: "P" },
    heldContracts: [{ providerContractId: "C95" }],
    visibleRows: [row(100), row(110)],
  });

  assert.deepEqual(providerContractIds, [
    "P105",
    "C95",
    "C100",
    "P100",
    "C110",
    "P110",
  ]);
});

test("buildTradeOptionProviderContractIdPlan protects held contracts outside visible rows", () => {
  const providerContractIds = buildTradeOptionProviderContractIdPlan({
    chainRows: [row(100)],
    contract: { strike: 100, cp: "C" },
    heldContracts: [{ providerContractId: "C200" }],
  });

  assert.deepEqual(providerContractIds, ["C100", "C200"]);
});

test("buildTradeOptionQuoteSubscriptionPlan separates execution from visible contracts", () => {
  const plan = buildTradeOptionQuoteSubscriptionPlan({
    chainRows: [row(90), row(95), row(100), row(105), row(110)],
    visibleRows: [row(100), row(110), row(90)],
    contract: { strike: 100, cp: "C" },
    heldContracts: [{ providerContractId: "P95" }],
  });

  assert.deepEqual(plan.executionProviderContractIds, ["C100", "P95"]);
  assert.deepEqual(plan.visibleProviderContractIds, [
    "P100",
    "C110",
    "P110",
    "C90",
    "P90",
  ]);
  assert.deepEqual(plan.requestedProviderContractIds, [
    "C100",
    "P95",
    "P100",
    "C110",
    "P110",
    "C90",
    "P90",
  ]);
});

test("buildTradeOptionProviderContractIdPlan does not add non-visible hydrated tail rows", () => {
  const providerContractIds = buildTradeOptionProviderContractIdPlan({
    chainRows: [row(90), row(95), row(100), row(105), row(110)],
    visibleRows: [row(110), row(90)],
    contract: { strike: 100, cp: "C" },
    heldContracts: [],
  });

  assert.deepEqual(providerContractIds, [
    "C100",
    "C110",
    "P110",
    "C90",
    "P90",
  ]);
});

test("buildTradeOptionQuoteSubscriptionPlan caps visible contracts while pinning execution contracts", () => {
  const plan = buildTradeOptionQuoteSubscriptionPlan({
    chainRows: [row(100)],
    visibleRows: [row(100), row(101), row(102), row(103), row(104)],
    contract: { strike: 100, cp: "C" },
    heldContracts: [{ providerContractId: "P104" }],
    maxVisibleProviderContractIds: 4,
  });

  assert.deepEqual(plan.executionProviderContractIds, ["C100", "P104"]);
  assert.deepEqual(plan.visibleProviderContractIds, [
    "P100",
    "C101",
    "P101",
    "C102",
  ]);
  assert.equal(
    TRADE_OPTION_VISIBLE_QUOTE_CONTRACT_LIMIT,
    40,
  );
});
