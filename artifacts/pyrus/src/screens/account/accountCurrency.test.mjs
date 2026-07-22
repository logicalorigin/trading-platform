import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeAccountCurrency,
  resolveCompleteAccountCurrency,
} from "./accountCurrency.js";

test("account currency normalization accepts only three-letter codes", () => {
  assert.equal(normalizeAccountCurrency(" cad "), "CAD");
  assert.equal(normalizeAccountCurrency("$"), null);
});

test("complete account currency authority requires every populated source to agree", () => {
  assert.equal(resolveCompleteAccountCurrency(["usd", "USD"]), "USD");
  assert.equal(resolveCompleteAccountCurrency(["USD", "CAD"]), null);
  assert.equal(resolveCompleteAccountCurrency(["USD", null]), null);
  assert.equal(resolveCompleteAccountCurrency([]), null);
});
