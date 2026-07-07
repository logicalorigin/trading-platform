import assert from "node:assert/strict";
import test from "node:test";

import { classifyBrokerAccountCategory } from "./broker-account-category";

const cases = [
  ["Webull Crypto Cash", "crypto", false],
  ["Webull Futures", "futures", false],
  ["Webull Events Cash", "prediction", false],
  ["E*Trade GROWTH", "equity", true],
  ["E*Trade RETIREMENT ROTH IRA", "equity", true],
  ["E*Trade Rollover IRA", "equity", true],
  ["IBKR U24762790", "equity", true],
  ["IBKR U24947962", "equity", true],
  ["Interactive Brokers (Riley Bishop)", "equity", true],
  ["Webull Individual Cash", "equity", true],
  ["Webull Individual Margin", "equity", true],
] as const;

test("classifyBrokerAccountCategory matches confirmed broker account display names", () => {
  for (const [displayName, category, included] of cases) {
    assert.equal(classifyBrokerAccountCategory(displayName), category);
    assert.equal(category === "equity", included, displayName);
  }
});
