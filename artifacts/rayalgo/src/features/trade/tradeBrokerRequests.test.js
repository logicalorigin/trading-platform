import assert from "node:assert/strict";
import test from "node:test";
import { sameOptionContract } from "./tradeBrokerRequests.js";

test("sameOptionContract compares validated option expiration dates", () => {
  assert.equal(
    sameOptionContract(
      { strike: 500, right: "call", expirationDate: "2026-05-01T00:00:00.000Z" },
      { strike: 500, right: "CALL", expirationDate: "2026-05-01" },
    ),
    true,
  );
});

test("sameOptionContract does not roll impossible dates into matches", () => {
  assert.equal(
    sameOptionContract(
      { strike: 500, right: "call", expirationDate: "2026-02-31" },
      { strike: 500, right: "call", expirationDate: "2026-03-03" },
    ),
    false,
  );
});
