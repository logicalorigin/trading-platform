import assert from "node:assert/strict";
import test from "node:test";

import {
  ACCOUNT_VALUE_MASK,
  formatAccountPrice,
  formatMoney,
  formatNumber,
} from "./accountUtils.jsx";

test("account numeric formatters keep existing display semantics", () => {
  assert.equal(
    formatAccountPrice(1234.5, 2),
    new Intl.NumberFormat(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(1234.5),
  );
  assert.equal(
    formatNumber(1234.567, 2),
    new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 2,
    }).format(1234.567),
  );
  assert.equal(formatMoney(1234.5, "USD", true), "$1.2K");
  assert.equal(formatAccountPrice(1234.5, 2, true), ACCOUNT_VALUE_MASK);
});
