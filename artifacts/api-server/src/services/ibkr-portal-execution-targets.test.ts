import assert from "node:assert/strict";
import test from "node:test";

import { buildPortalExecutionTargets } from "./ibkr-portal-session";

test("IBKR execution targets preserve the full tradable set without selecting the first", () => {
  assert.deepEqual(
    buildPortalExecutionTargets(
      ["U1111111", "U2222222", "U3333333"],
      null,
    ),
    [
      { accountId: "U1111111", maskedAccountId: "••••1111", selected: false },
      { accountId: "U2222222", maskedAccountId: "••••2222", selected: false },
      { accountId: "U3333333", maskedAccountId: "••••3333", selected: false },
    ],
  );
});

test("IBKR execution targets retain an explicitly selected trading-only account", () => {
  const targets = buildPortalExecutionTargets(
    ["U1111111", "U2222222"],
    "U3333333",
  );
  assert.equal(targets.length, 3);
  assert.deepEqual(targets.at(-1), {
    accountId: "U3333333",
    maskedAccountId: "••••3333",
    selected: true,
  });
});
