import assert from "node:assert/strict";
import test from "node:test";
import {
  formatOptionContractLabel,
  formatQuotePrice,
  normalizeOptionRightLabel,
} from "./formatters.js";

test("formatQuotePrice renders ticker and option prices without currency symbols", () => {
  assert.equal(formatQuotePrice(1.2356), "1.236");
  assert.equal(formatQuotePrice(112.3), "112.30");
});

test("formatOptionContractLabel builds compact non-redundant option labels", () => {
  assert.equal(
    formatOptionContractLabel({
      symbol: "aapl",
      expirationDate: "2026-05-15",
      strike: 200,
      right: "call",
    }),
    "AAPL 05/15 200C",
  );
  assert.equal(
    formatOptionContractLabel(
      {
        expirationDate: "2026-05-15",
        strike: 200.5,
        cp: "P",
      },
      { symbol: "AAPL", includeSymbol: false },
    ),
    "05/15 200.5P",
  );
  assert.equal(
    formatOptionContractLabel(
      { symbol: "AAPL", contract: "AAPL 05/15 200C" },
      { includeSymbol: false },
    ),
    "05/15 200C",
  );
});

test("normalizeOptionRightLabel accepts long and compact option sides", () => {
  assert.equal(normalizeOptionRightLabel("CALL"), "C");
  assert.equal(normalizeOptionRightLabel("put"), "P");
  assert.equal(normalizeOptionRightLabel(""), "");
});
