import assert from "node:assert/strict";
import { test } from "node:test";
import { isTransientPostgresError } from "./transient-postgres-error";

test("classifies pg/sqlx pool acquire timeouts as transient", () => {
  assert.equal(
    isTransientPostgresError(
      new Error("pool timed out while waiting for an open connection"),
    ),
    true,
  );
});
