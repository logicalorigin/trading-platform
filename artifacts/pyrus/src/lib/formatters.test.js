import assert from "node:assert/strict";
import test from "node:test";
import {
  formatExpirationLabel,
  formatIsoDate,
  formatOptionContractLabel,
  formatQuotePrice,
  normalizeOptionRightLabel,
  parseExpirationValue,
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

test("parseExpirationValue handles legacy month/day labels without Date parser rollover", () => {
  const parsed = parseExpirationValue("06/19");
  assert.equal(parsed?.getUTCMonth(), 5);
  assert.equal(parsed?.getUTCDate(), 19);
  assert.notEqual(parsed?.getUTCFullYear(), 2001);
});

test("parseExpirationValue rejects impossible calendar dates", () => {
  assert.equal(parseExpirationValue("02/31"), null);
  assert.equal(parseExpirationValue("2026-02-31"), null);
  assert.equal(parseExpirationValue("2026-02-31T00:00:00.000Z"), null);
  assert.equal(formatExpirationLabel("2026-02-31"), "2026-02-31");
});

test("formatIsoDate keeps date-only strings on their stated calendar day", () => {
  assert.equal(formatIsoDate("2026-05-01"), "2026-05-01");
  assert.equal(formatIsoDate("2026-02-31"), null);
});
