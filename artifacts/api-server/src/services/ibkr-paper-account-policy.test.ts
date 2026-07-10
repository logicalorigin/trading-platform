import assert from "node:assert/strict";
import test from "node:test";

import {
  areVerifiedIbkrPaperAccounts,
  isIbkrPaperAccountId,
} from "./ibkr-paper-account-policy";

test("IBKR paper account policy accepts only nonempty DU account sets", () => {
  assert.equal(isIbkrPaperAccountId("DU1234567"), true);
  assert.equal(isIbkrPaperAccountId("du7654321"), true);
  assert.equal(isIbkrPaperAccountId("U1234567"), false);
  assert.equal(isIbkrPaperAccountId("PAPER"), false);
  assert.equal(isIbkrPaperAccountId("DU"), false);

  assert.equal(areVerifiedIbkrPaperAccounts(["DU1234567"]), true);
  assert.equal(
    areVerifiedIbkrPaperAccounts(["DU1234567", "DU7654321"]),
    true,
  );
  assert.equal(areVerifiedIbkrPaperAccounts([]), false);
  assert.equal(
    areVerifiedIbkrPaperAccounts(["DU1234567", "U7654321"]),
    false,
  );
});
